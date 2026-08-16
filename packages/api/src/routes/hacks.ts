import { Hono } from 'hono'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { db, nameKey } from '../db.js'

export const hacksRouter = new Hono()

// Where the ingested patch tree + index.json live on the Pi (rsynced from the
// Windows ingest). Overridable for dev.
const ROMHACKS_DIR = process.env['RETROVAULT_ROMHACKS_DIR'] ?? '/home/pi/.retrovault/romhacks'

// --- matching helpers -------------------------------------------------------

const flat = (s: string) => nameKey(s).replace(/ /g, '')

// Starter alias map for heavily-hacked titles whose hacks rarely spell out the
// full game name. Keyed on a normalized token; value is a base-game nameKey.
const ALIASES: Record<string, string> = {
  smw: 'super mario world',
  smb: 'super mario bros',
  smb1: 'super mario bros',
  smb3: 'super mario bros 3',
  som: 'secret of mana',
  mmx: 'mega man x',
  mmx2: 'mega man x2',
  mmx3: 'mega man x3',
  ct: 'chrono trigger',
  ff: 'final fantasy',
  ff4: 'final fantasy ii', // US naming (FFIV JP = FFII US)
  ff6: 'final fantasy iii',
  dkc: 'donkey kong country',
  lttp: 'legend of zelda a link to the past',
  smrpg: 'super mario rpg',
  sd3: 'seiken densetsu 3',
}

interface GameRow { id: number; system: string; name: string }
interface IdxGame { id: number; key: string; flat: string; toks: string[] }

// Build system -> games (sorted longest-key-first so the most specific base
// game wins a prefix/subset match).
function buildGameIndex(): Map<string, IdxGame[]> {
  const rows = db.prepare('SELECT id, system, name FROM games').all() as GameRow[]
  const bySys = new Map<string, IdxGame[]>()
  for (const g of rows) {
    const key = nameKey(g.name)
    if (!key) continue
    const arr = bySys.get(g.system) ?? []
    arr.push({ id: g.id, key, flat: key.replace(/ /g, ''), toks: key.split(' ').filter(Boolean) })
    bySys.set(g.system, arr)
  }
  for (const arr of bySys.values()) arr.sort((a, b) => b.key.length - a.key.length)
  return bySys
}

// Title -> base game within one of the candidate systems. Longest game wins.
function fuzzyMatch(title: string, systems: string[], idx: Map<string, IdxGame[]>): number | null {
  let hk = nameKey(title)
  // Alias expansion: replace a leading alias token with its full game key.
  const first = hk.split(' ')[0]
  if (first && ALIASES[first]) hk = (ALIASES[first] + hk.slice(first.length))
  const hf = hk.replace(/ /g, '')
  const hset = new Set(hk.split(' ').filter(Boolean))
  for (const sys of systems) {
    const games = idx.get(sys)
    if (!games) continue
    for (const g of games) {
      if (hk === g.key || hk.startsWith(g.key + ' ')) return g.id
      if (g.toks.length >= 2 && g.toks.every(t => hset.has(t))) return g.id
      if (g.flat.length >= 6 && hf.startsWith(g.flat)) return g.id
    }
  }
  return null
}

// --- CRC32 (table-based, dependency-free) — for the exact BPS/UPS tier -------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0 }
  return t
})()
function crc32(buf: Buffer, start = 0): string {
  let crc = 0xFFFFFFFF
  for (let i = start; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]!) & 0xFF]! ^ (crc >>> 8)
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0')
}
const hex = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0')

// CRC32 candidate(s) for a ROM. For .zip, read the inner file's CRC from the
// central directory (No-Intro hashes uncompressed data, which the zip stores) —
// reading only the tail so multi-MB ROMs aren't slurped whole. For raw ROMs,
// hash the file plus common header-stripped variants (nes/snes) that a patch
// author's source might use.
function romCrcs(romPath: string, system: string): string[] {
  try {
    if (path.extname(romPath).toLowerCase() === '.zip') {
      const size = fs.statSync(romPath).size
      const tailLen = Math.min(size, 256 * 1024)
      const fd = fs.openSync(romPath, 'r')
      const tail = Buffer.alloc(tailLen)
      fs.readSync(fd, tail, 0, tailLen, size - tailLen)
      fs.closeSync(fd)
      const base = size - tailLen
      let eocd = -1
      for (let i = tail.length - 22; i >= 0; i--) { if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break } }
      if (eocd < 0) return []
      const count = tail.readUInt16LE(eocd + 10)
      let p = tail.readUInt32LE(eocd + 16) - base
      if (p < 0) return []
      let best: { crc: string; size: number } | null = null
      for (let n = 0; n < count && p + 46 <= tail.length; n++) {
        if (tail.readUInt32LE(p) !== 0x02014b50) break
        const crc = tail.readUInt32LE(p + 16), usize = tail.readUInt32LE(p + 24)
        const fn = tail.readUInt16LE(p + 28), ex = tail.readUInt16LE(p + 30), cm = tail.readUInt16LE(p + 32)
        if (!best || usize > best.size) best = { crc: hex(crc), size: usize >>> 0 }
        p += 46 + fn + ex + cm
      }
      return best ? [best.crc] : []
    }
    const buf = fs.readFileSync(romPath)
    const out = new Set<string>([crc32(buf)])
    if (system === 'nes' && buf.length > 16 && buf[0] === 0x4E && buf[1] === 0x45 && buf[2] === 0x53 && buf[3] === 0x1A) out.add(crc32(buf, 16))
    if (system === 'snes' && buf.length % 1024 === 512) out.add(crc32(buf, 512))
    return [...out]
  } catch { return [] }
}

// Build crc -> game_id over ROMs in the given systems (once per import). Also
// caches each rom's primary CRC in roms.crc for reuse.
const setRomCrc = db.prepare('UPDATE roms SET crc = ? WHERE id = ?')
function buildCrcIndex(systems: string[]): Map<string, number> {
  const idx = new Map<string, number>()
  if (!systems.length) return idx
  const placeholders = systems.map(() => '?').join(',')
  const roms = db.prepare(`SELECT id, game_id, system, rom_path, crc FROM roms WHERE system IN (${placeholders})`)
    .all(...systems) as Array<{ id: number; game_id: number; system: string; rom_path: string; crc: string | null }>
  const save = db.transaction((rows: typeof roms) => {
    for (const r of rows) {
      let crcs = r.crc ? [r.crc] : []
      if (!crcs.length && fs.existsSync(r.rom_path)) {
        crcs = romCrcs(r.rom_path, r.system)
        if (crcs[0]) setRomCrc.run(crcs[0], r.id)
      }
      for (const c of crcs) if (!idx.has(c)) idx.set(c, r.game_id)
    }
  })
  save(roms)
  return idx
}

// Exact tier via a BPS/UPS source CRC. Scrape-independent: the on-demand CRC
// index (built from ROM files) → roms.crc → DAT entries.
const findGameByDatCrc = db.prepare(`
  SELECT g.id AS game_id FROM dat_entries d
  JOIN games g ON g.system = d.system AND g.name_key = d.name_key
  WHERE d.crc = ? LIMIT 1
`)
function exactMatch(sourceCrc: string | null, crcIndex: Map<string, number>): number | null {
  if (!sourceCrc) return null
  const crc = sourceCrc.toUpperCase()
  const hit = crcIndex.get(crc)
  if (hit) return hit
  const d = findGameByDatCrc.get(crc) as { game_id: number } | undefined
  return d?.game_id ?? null
}

// --- routes -----------------------------------------------------------------

interface IdxItem {
  rhdnId: number | null; kind: string; systems: string[]; title: string
  bundle: string; format: string | null; sourceCrc: string | null; patchPath: string | null
}

// Rebuild the rom_hacks catalogue from romhacks/index.json and (re)match every
// hack. Rows previously assigned by hand (match_confidence='manual') keep their
// game_id. Idempotent — safe to re-run after the patch extract fills in CRCs.
const upsert = db.prepare(`
  INSERT INTO rom_hacks (hack_key, rhdn_id, kind, system, title, author, patch_format, patch_path, source_crc, game_id, match_confidence)
  VALUES (@hack_key, @rhdn_id, @kind, @system, @title, @author, @patch_format, @patch_path, @source_crc, @game_id, @match_confidence)
  ON CONFLICT(hack_key) DO UPDATE SET
    rhdn_id=excluded.rhdn_id, kind=excluded.kind, system=excluded.system, title=excluded.title,
    author=excluded.author, patch_format=excluded.patch_format, patch_path=excluded.patch_path,
    source_crc=excluded.source_crc,
    -- preserve manual assignments; otherwise take the fresh match
    game_id=CASE WHEN rom_hacks.match_confidence='manual' THEN rom_hacks.game_id ELSE excluded.game_id END,
    match_confidence=CASE WHEN rom_hacks.match_confidence='manual' THEN 'manual' ELSE excluded.match_confidence END
`)

hacksRouter.post('/import', (c) => {
  const indexFile = path.join(ROMHACKS_DIR, 'index.json')
  if (!fs.existsSync(indexFile)) {
    return c.json({ error: `index.json not found at ${indexFile} — run the ingest + rsync first` }, 422)
  }
  const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as { items: IdxItem[] }
  const gameIndex = buildGameIndex()

  // Build a CRC index only over the systems that actually have a source-CRC hack
  // (BPS/UPS) — avoids hashing ROMs for systems that can't benefit. Done before
  // the matching transaction (it reads files + writes roms.crc).
  const crcSystems = [...new Set(
    idx.items.filter(it => it.sourceCrc).flatMap(it => it.systems)
  )]
  const crcIndex = buildCrcIndex(crcSystems)

  let exact = 0, fuzzy = 0, unmatched = 0
  const run = db.transaction((items: IdxItem[]) => {
    for (const it of items) {
      const hack_key = it.rhdnId != null ? String(it.rhdnId) : it.bundle
      const system = it.systems[0] ?? 'unknown'
      let gameId = exactMatch(it.sourceCrc, crcIndex)
      let conf: string | null = gameId ? 'exact' : null
      if (!gameId) { gameId = fuzzyMatch(it.title, it.systems, gameIndex); conf = gameId ? 'fuzzy' : null }
      if (conf === 'exact') exact++; else if (conf === 'fuzzy') fuzzy++; else unmatched++
      upsert.run({
        hack_key, rhdn_id: it.rhdnId, kind: it.kind ?? 'hack', system, title: it.title,
        author: (it as { author?: string }).author ?? null, patch_format: it.format,
        patch_path: it.patchPath, source_crc: it.sourceCrc, game_id: gameId, match_confidence: conf,
      })
    }
  })
  run(idx.items)

  return c.json({ total: idx.items.length, exact, fuzzy, unmatched, matched: exact + fuzzy })
})

// Hacks matched to a game (for the GameDetail Hacks tab).
hacksRouter.get('/for-game/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const rows = db.prepare(
    `SELECT * FROM rom_hacks WHERE game_id = ? ORDER BY match_confidence, title COLLATE NOCASE`
  ).all(id)
  return c.json({ hacks: rows })
})

// Unmatched bucket, optionally filtered by system, for manual assignment.
hacksRouter.get('/unmatched', (c) => {
  const system = c.req.query('system')
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') ?? '100', 10) || 100))
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0)
  const where = system ? 'game_id IS NULL AND system = ?' : 'game_id IS NULL'
  const args = system ? [system, limit, offset] : [limit, offset]
  const total = (db.prepare(`SELECT COUNT(*) n FROM rom_hacks WHERE ${where}`).get(...(system ? [system] : [])) as { n: number }).n
  const items = db.prepare(`SELECT * FROM rom_hacks WHERE ${where} ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args)
  return c.json({ total, items })
})

// Manually assign a hack to a game (locks it against re-import overwrite).
hacksRouter.post('/:id/assign', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ gameId?: number | null }>()
    .catch(() => ({} as { gameId?: number | null }))
  const gameId = body.gameId ?? null
  db.prepare(`UPDATE rom_hacks SET game_id = ?, match_confidence = ? WHERE id = ?`)
    .run(gameId, gameId ? 'manual' : null, id)
  return c.json({ ok: true })
})

// Compile a hack: apply its patch onto a base ROM with flips, register the
// result as a kind='hack' rom under the game, and return the new rom id (the
// client then launches it via the normal /roms/:id/launch path).
hacksRouter.post('/:id/compile', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ baseRomId?: number }>().catch(() => ({} as { baseRomId?: number }))

  const hack = db.prepare('SELECT * FROM rom_hacks WHERE id = ?').get(id) as
    | { id: number; title: string; system: string; patch_path: string | null; game_id: number | null } | undefined
  if (!hack) return c.json({ error: 'hack not found' }, 404)
  if (!hack.game_id) return c.json({ error: 'hack is not matched to a game' }, 422)
  if (!hack.patch_path) return c.json({ error: 'no patch file for this hack (extract not complete?)' }, 422)

  const patchAbs = path.join(ROMHACKS_DIR, hack.patch_path)
  if (!fs.existsSync(patchAbs)) return c.json({ error: `patch missing on device: ${patchAbs}` }, 422)

  // Base ROM: explicit choice, else the game's primary (curated first).
  const base = (body.baseRomId
    ? db.prepare('SELECT * FROM roms WHERE id = ? AND game_id = ?').get(body.baseRomId, hack.game_id)
    : db.prepare('SELECT * FROM roms WHERE game_id = ? ORDER BY curated DESC, id ASC LIMIT 1').get(hack.game_id)
  ) as { id: number; system: string; rom_path: string } | undefined
  if (!base) return c.json({ error: 'no base ROM found for this game' }, 422)
  if (!fs.existsSync(base.rom_path)) return c.json({ error: `base ROM file missing: ${base.rom_path}` }, 422)

  // Patches target the raw ROM, not a .zip container. If the base is zipped,
  // extract the inner ROM and patch that; output a raw ROM (RetroArch loads it).
  let sourceRom = base.rom_path
  let tmpDir: string | null = null
  if (path.extname(base.rom_path).toLowerCase() === '.zip') {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hackbase-'))
    try { execFileSync('unzip', ['-o', '-j', base.rom_path, '-d', tmpDir], { stdio: 'ignore' }) }
    catch { /* fall through to the no-inner check */ }
    const inner = fs.readdirSync(tmpDir)
      .filter(f => !/\.(txt|nfo|dat|xml|md)$/i.test(f))
      .map(f => ({ f, size: fs.statSync(path.join(tmpDir!, f)).size }))
      .sort((a, b) => b.size - a.size)
    if (!inner.length) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      return c.json({ error: 'could not extract a ROM from the zipped base' }, 422)
    }
    sourceRom = path.join(tmpDir, inner[0]!.f)
  }

  // Output in a _hacks/ subdir beside the base ROM (importer scans top-level
  // only, so it won't be re-imported — we register it explicitly). Raw ROM ext.
  const outExt = path.extname(sourceRom) || '.rom'
  const safe = hack.title.replace(/[^\w.\- ]+/g, '_').slice(0, 80).trim()
  const outDir = path.join(path.dirname(base.rom_path), '_hacks')
  const outPath = path.join(outDir, `${safe} [hack ${hack.id}]${outExt}`)
  fs.mkdirSync(outDir, { recursive: true })

  try {
    // flips handles IPS/BPS/UPS and autodetects; overwrite output.
    execFileSync('flips', ['--apply', patchAbs, sourceRom, outPath], { stdio: 'pipe' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: `Patch failed (flips): ${msg.slice(0, 300)}` }, 500)
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ } }
  }
  if (!fs.existsSync(outPath)) return c.json({ error: 'flips produced no output' }, 500)

  // Reuse an existing row for this exact output, else insert a hack variant.
  let romId: number
  const existing = db.prepare('SELECT id FROM roms WHERE rom_path = ?').get(outPath) as { id: number } | undefined
  if (existing) {
    romId = existing.id
  } else {
    const ins = db.prepare(`
      INSERT INTO roms (game_id, system, rom_path, region, revision, full_name, kind)
      VALUES (?, ?, ?, NULL, NULL, ?, 'hack')
    `).run(hack.game_id, base.system, outPath, hack.title)
    romId = Number(ins.lastInsertRowid)
  }
  return c.json({ romId, outPath })
})

// Catalogue stats (per-system matched/unmatched) for a settings/overview view.
hacksRouter.get('/stats', (c) => {
  const rows = db.prepare(`
    SELECT system,
           COUNT(*) AS total,
           SUM(CASE WHEN game_id IS NOT NULL THEN 1 ELSE 0 END) AS matched
    FROM rom_hacks GROUP BY system ORDER BY total DESC
  `).all()
  return c.json({ systems: rows })
})
