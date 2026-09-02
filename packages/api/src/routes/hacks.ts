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

// Build crc -> game_id over ROMs in the given systems. Hashing is I/O-bound and
// can run for minutes over a full library, so it happens OUTSIDE any
// transaction — an earlier version hashed inside one and held the write lock
// (and the event loop) for the whole import. The cached CRCs are flushed after.
const setRomCrc = db.prepare('UPDATE roms SET crc = ? WHERE id = ?')
function buildCrcIndex(systems: string[], cachedOnly = false): Map<string, number> {
  const idx = new Map<string, number>()
  if (!systems.length) return idx
  const placeholders = systems.map(() => '?').join(',')
  const roms = db.prepare(`SELECT id, game_id, system, rom_path, crc FROM roms WHERE system IN (${placeholders})`)
    .all(...systems) as Array<{ id: number; game_id: number; system: string; rom_path: string; crc: string | null }>

  const fresh: Array<{ id: number; crc: string }> = []
  for (const r of roms) {
    let crcs = r.crc ? [r.crc] : []
    if (!crcs.length && !cachedOnly && fs.existsSync(r.rom_path)) {
      crcs = romCrcs(r.rom_path, r.system)
      if (crcs[0]) fresh.push({ id: r.id, crc: crcs[0] })
    }
    for (const c of crcs) if (!idx.has(c)) idx.set(c, r.game_id)
  }
  db.transaction((rows: typeof fresh) => { for (const f of rows) setRomCrc.run(f.crc, f.id) })(fresh)
  return idx
}

// --- RHDN dump metadata -----------------------------------------------------

// Produced by scripts/parse-rhdn-sql.mjs from the romhacking.sql dump. Keyed
// `hack:1234` / `translation:1234` — the same id ingest-romhacks.mjs parses out
// of `[1234]Title.zip`, so this joins index.json 1:1 with no fuzzy step.
interface RhdnMeta {
  kind: string
  gameKey: number | null
  gameTitle: string | null
  gameTitleAlt: string | null
  gameYear: number | null
  rhdnSystem: string | null
  baseCrcs: string[]
  baseSha1s: string[]
  baseMd5s: string[]
  datNames: string[]
  patchHint: string | null
  noFile: boolean
  title: string | null
  version: string | null
  released: string | null
  downloads: number
  description: string | null
  license: string | null
  youtube: string | null
  language?: string | null
}

function loadRhdnMeta(): Map<string, RhdnMeta> {
  const file = path.join(ROMHACKS_DIR, 'rhdn-meta.json')
  if (!fs.existsSync(file)) return new Map()
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries: Record<string, RhdnMeta> }
  return new Map(Object.entries(parsed.entries ?? {}))
}

// --- canonical-title tier ---------------------------------------------------

// RHDN writes game names in marketing order ("The Legend of Zelda: Majora's
// Mask"); No-Intro (and therefore games.name) uses sort order with the article
// moved and " - " for subtitles ("Legend of Zelda, The - Majora's Mask").
// nameKey() flattens punctuation but can't reorder, so emit both readings —
// plus an ampersand/"and" variant, since the two catalogues disagree there too.
// RHDN keeps accents ("Pokémon"); No-Intro strips them ("Pokemon"). nameKey's
// [^a-z0-9] pass turns é into a space, silently splitting the word — so fold
// combining marks away before it ever runs. Both sides of the comparison go
// through this, so it has to be applied to library names too.
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '')

// Every spelling of one title worth comparing, cheapest/safest first. Each key
// also gets an and-stripped and a space-stripped form: the two catalogues
// disagree on "&"/"and" ("Rockman & Forte") and on compounding ("Battle City"
// vs "BattleCity", "Battletoads/Double Dragon" vs "Battletoads-Double Dragon").
function keyForms(s: string): string[] {
  const k = nameKey(fold(s))
  if (!k) return []
  const noAnd = k.replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim()
  return [...new Set([k, noAnd, k.replace(/ /g, ''), noAnd.replace(/ /g, '')])].filter(Boolean)
}

export function titleVariants(title: string, loose = false): string[] {
  const out: string[] = []
  const push = (s: string) => { for (const k of keyForms(s)) if (!out.includes(k)) out.push(k) }
  push(title)
  const colon = title.indexOf(':')
  const main = (colon === -1 ? title : title.slice(0, colon)).trim()
  const sub = colon === -1 ? '' : title.slice(colon + 1).trim()
  // RHDN writes marketing order ("The Legend of Zelda: Majora's Mask"); No-Intro
  // (and therefore games.name) uses sort order with the article moved and " - "
  // for subtitles ("Legend of Zelda, The - Majora's Mask"). nameKey flattens
  // punctuation but can't reorder, so emit both readings.
  const art = /^(The|A|An)\s+(.+)$/i.exec(main)
  if (art) {
    const bare = art[2]!, word = art[1]!
    push(sub ? `${bare} ${word} ${sub}` : `${bare} ${word}`)
    push(sub ? `${bare} ${sub}` : bare)                        // article dropped
  }
  // Last resort: the main title without its subtitle, for releases catalogued
  // without one ("Phantasy Star IV: The End of the Millennium" vs "Phantasy
  // Star IV"). Gated on loose + at least two words, because a bare one-word main
  // title ("Castlevania:", "Contra:") collides with a different game outright.
  if (loose && sub && main.split(/\s+/).filter(Boolean).length >= 2) {
    push(main)
    if (art) push(art[2]!)
  }
  return out
}

// system -> key -> game_id, over every spelling of every library game name.
export function buildCanonicalIndex(): Map<string, Map<string, number>> {
  const rows = db.prepare('SELECT id, system, name FROM games').all() as
    Array<{ id: number; system: string; name: string }>
  const bySys = new Map<string, Map<string, number>>()
  for (const g of rows) {
    let m = bySys.get(g.system)
    if (!m) { m = new Map(); bySys.set(g.system, m) }
    for (const k of keyForms(g.name)) if (!m.has(k)) m.set(k, g.id)
  }
  return bySys
}

// The canonical game the patch targets, per RHDN's own gamekey. This is the tier
// that rescues titles like "Enhansa Edition" (Chrono Trigger) or "Sheex is a
// Master Ninja" (Secret of Mana) — hack names that share no token with the game.
export function canonicalMatch(
  meta: RhdnMeta | undefined, systems: string[], idx: Map<string, Map<string, number>>,
): number | null {
  if (!meta) return null
  // datNames are verbatim No-Intro entry names, so they match hardest; then the
  // primary title, then the alternate-region title (the only hope for a JP-named
  // translation target).
  // "not found" is what RHDN's hasher writes when it couldn't identify the ROM —
  // it is stored verbatim in rominfo, so filter it out rather than matching a
  // game that happens to normalize to it.
  const titles = [...meta.datNames.filter(n => nameKey(n) !== 'not found'), meta.gameTitle, meta.gameTitleAlt]
    .filter(Boolean) as string[]
  const lookup = (t: string, loose: boolean) => {
    for (const key of titleVariants(t, loose)) {
      for (const sys of systems) {
        const hit = idx.get(sys)?.get(key)
        if (hit) return hit
      }
    }
    return null
  }
  // Strict over every title first; only then retry allowing the subtitle to be
  // dropped, so a precise match on the alternate title always beats a loose one
  // on the primary.
  for (const t of titles) { const hit = lookup(t, false); if (hit) return hit }
  for (const t of titles) { const hit = lookup(t, true); if (hit) return hit }
  return null
}

// --- exact (hash) tier ------------------------------------------------------

// crc -> game_id and sha1 -> game_id across every imported DAT. Built in one
// scan: the matcher looks up a base-ROM hash without knowing which system's DAT
// holds it, and doing that as 14k individual queries would be far slower.
function buildDatIndex(): { crc: Map<string, number>; sha1: Map<string, number> } {
  const rows = db.prepare(`
    SELECT d.crc, d.sha1, g.id AS game_id FROM dat_entries d
    JOIN games g ON g.system = d.system AND g.name_key = d.name_key
  `).all() as Array<{ crc: string | null; sha1: string | null; game_id: number }>
  const crc = new Map<string, number>(), sha1 = new Map<string, number>()
  for (const r of rows) {
    if (r.crc) { const k = r.crc.toUpperCase().padStart(8, '0'); if (!crc.has(k)) crc.set(k, r.game_id) }
    if (r.sha1) { const k = r.sha1.toUpperCase(); if (!sha1.has(k)) sha1.set(k, r.game_id) }
  }
  return { crc, sha1 }
}

interface HashIdx { dat: { crc: Map<string, number>; sha1: Map<string, number> }; rom: Map<string, number> }

// Exact tier. Candidate hashes are the base-ROM CRC32/SHA-1 the RHDN dump
// publishes for the patch, plus the BPS/UPS embedded source CRC when present.
// Crucially this covers IPS, which has no source checksum of its own — that gap
// is why the old CRC-only tier could only ever reach the BPS/UPS subset.
function hashMatch(crcs: string[], sha1s: string[], idx: HashIdx): number | null {
  for (const c of crcs) {
    const k = c.toUpperCase().padStart(8, '0')
    const hit = idx.dat.crc.get(k) ?? idx.rom.get(k)
    if (hit) return hit
  }
  for (const s of sha1s) {
    const hit = idx.dat.sha1.get(s.toUpperCase())
    if (hit) return hit
  }
  return null
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
  INSERT INTO rom_hacks (
    hack_key, rhdn_id, kind, system, title, author, patch_format, patch_path, source_crc,
    game_id, match_confidence,
    rhdn_game_key, rhdn_game_title, base_crcs, base_sha1s, patch_hint,
    version, released, downloads, description, language, license, youtube
  )
  VALUES (
    @hack_key, @rhdn_id, @kind, @system, @title, @author, @patch_format, @patch_path, @source_crc,
    @game_id, @match_confidence,
    @rhdn_game_key, @rhdn_game_title, @base_crcs, @base_sha1s, @patch_hint,
    @version, @released, @downloads, @description, @language, @license, @youtube
  )
  ON CONFLICT(hack_key) DO UPDATE SET
    rhdn_id=excluded.rhdn_id, kind=excluded.kind, system=excluded.system, title=excluded.title,
    author=excluded.author, patch_format=excluded.patch_format, patch_path=excluded.patch_path,
    source_crc=excluded.source_crc,
    rhdn_game_key=excluded.rhdn_game_key, rhdn_game_title=excluded.rhdn_game_title,
    base_crcs=excluded.base_crcs, base_sha1s=excluded.base_sha1s, patch_hint=excluded.patch_hint,
    version=excluded.version, released=excluded.released, downloads=excluded.downloads,
    description=excluded.description, language=excluded.language, license=excluded.license,
    youtube=excluded.youtube,
    -- preserve manual assignments; otherwise take the fresh match
    game_id=CASE WHEN rom_hacks.match_confidence='manual' THEN rom_hacks.game_id ELSE excluded.game_id END,
    match_confidence=CASE WHEN rom_hacks.match_confidence='manual' THEN 'manual' ELSE excluded.match_confidence END
`)

// Match tiers, best first:
//   exact     — a base-ROM hash (RHDN dump, or a BPS/UPS source CRC) resolved
//               via the DAT tables, or via hashes of the ROM files themselves
//   canonical — RHDN's own gamekey -> canonical game title -> games.name_key
//   fuzzy     — the legacy patch-title guess, now only a last resort
// The hash tiers need no ROM file reads when the systems have DATs imported, so
// the file-hashing pass is deferred until we know it would actually help.
hacksRouter.post('/import', (c) => {
  // The ingest runs once per RHDN category, so translations land in their own
  // index file. Both are optional; import whichever are present.
  const indexFiles = ['index.json', 'index-translations.json']
    .map(f => path.join(ROMHACKS_DIR, f)).filter(f => fs.existsSync(f))
  if (!indexFiles.length) {
    return c.json({ error: `no index.json in ${ROMHACKS_DIR} — run the ingest + rsync first` }, 422)
  }
  const idx = {
    items: indexFiles.flatMap(f => (JSON.parse(fs.readFileSync(f, 'utf8')) as { items: IdxItem[] }).items),
  }
  const meta = loadRhdnMeta()
  const gameIndex = buildGameIndex()
  const canonIndex = buildCanonicalIndex()

  const metaFor = (it: IdxItem): RhdnMeta | undefined =>
    it.rhdnId == null ? undefined : meta.get(`${it.kind ?? 'hack'}:${it.rhdnId}`)
  const crcsFor = (it: IdxItem, m: RhdnMeta | undefined): string[] =>
    [...(m?.baseCrcs ?? []), ...(it.sourceCrc ? [it.sourceCrc] : [])]

  // Every CRC we can get for free: the DAT tables, plus the crcs already cached
  // in roms.crc from previous imports/audits. Reading no ROM files here is what
  // keeps the common case sub-second — and it matters that this is available in
  // pass 1, so an exact hash beats a canonical title match rather than losing a
  // race to it.
  const allSystems = [...new Set(idx.items.flatMap(it => it.systems))]
  const hashIdx: HashIdx = { dat: buildDatIndex(), rom: buildCrcIndex(allSystems, true) }

  // Pass 1 — hash + canonical, both pure in-memory lookups.
  interface Resolved { it: IdxItem; m: RhdnMeta | undefined; gameId: number | null; conf: string | null }
  const resolved: Resolved[] = idx.items.map(it => {
    const m = metaFor(it)
    let gameId = hashMatch(crcsFor(it, m), m?.baseSha1s ?? [], hashIdx)
    let conf: string | null = gameId ? 'exact' : null
    if (!gameId) { gameId = canonicalMatch(m, it.systems, canonIndex); conf = gameId ? 'canonical' : null }
    return { it, m, gameId, conf }
  })

  // Pass 2 — only now, and only for systems that still have hash-bearing hacks
  // unmatched, pay for hashing ROM files off disk (minutes on a full library).
  // A hit here also upgrades a canonical match to exact.
  const needCrc = [...new Set(
    resolved.filter(r => r.conf !== 'exact' && crcsFor(r.it, r.m).length).flatMap(r => r.it.systems)
  )]
  if (needCrc.length) {
    hashIdx.rom = buildCrcIndex(needCrc)
    for (const r of resolved) {
      if (r.conf === 'exact') continue
      const hit = hashMatch(crcsFor(r.it, r.m), r.m?.baseSha1s ?? [], hashIdx)
      if (hit) { r.gameId = hit; r.conf = 'exact' }
    }
  }

  // Pass 3 — legacy title fuzz for whatever is left.
  for (const r of resolved) {
    if (r.gameId) continue
    const hit = fuzzyMatch(r.it.title, r.it.systems, gameIndex)
    if (hit) { r.gameId = hit; r.conf = 'fuzzy' }
  }

  const counts = { exact: 0, canonical: 0, fuzzy: 0, unmatched: 0 }
  const run = db.transaction((rows: Resolved[]) => {
    for (const { it, m, gameId, conf } of rows) {
      // Qualified by kind: RHDN numbers hacks and translations independently, so
      // the bare id is not unique across the two catalogues.
      const kind = it.kind ?? 'hack'
      const hack_key = it.rhdnId != null ? `${kind}:${it.rhdnId}` : it.bundle
      const system = it.systems[0] ?? 'unknown'
      if (conf === 'exact') counts.exact++
      else if (conf === 'canonical') counts.canonical++
      else if (conf === 'fuzzy') counts.fuzzy++
      else counts.unmatched++
      upsert.run({
        hack_key, rhdn_id: it.rhdnId, kind, system,
        // The dump's hack title beats the one scraped off the bundle filename.
        title: m?.title ?? it.title,
        author: (it as { author?: string }).author ?? null, patch_format: it.format,
        patch_path: it.patchPath, source_crc: it.sourceCrc, game_id: gameId, match_confidence: conf,
        rhdn_game_key: m?.gameKey ?? null, rhdn_game_title: m?.gameTitle ?? null,
        base_crcs: m?.baseCrcs.length ? m.baseCrcs.join(',') : null,
        base_sha1s: m?.baseSha1s.length ? m.baseSha1s.join(',') : null,
        patch_hint: m?.patchHint ?? null, version: m?.version ?? null, released: m?.released ?? null,
        downloads: m?.downloads ?? 0, description: m?.description ?? null,
        language: m?.language ?? null, license: m?.license ?? null, youtube: m?.youtube ?? null,
      })
    }
  })
  run(resolved)

  const matched = counts.exact + counts.canonical + counts.fuzzy
  return c.json({
    total: idx.items.length, ...counts, matched,
    meta: meta.size ? { entries: meta.size, joined: resolved.filter(r => r.m).length } : null,
  })
})

// RHDN descriptions are raw forum prose — HTML tags left in by the dump parser,
// hard-wrapped, and occasionally several screens long. Flatten them here, once
// per request, so the Pi's browser never parses markup or lays out text it will
// clamp away anyway. The cap is generous enough for the 3-line panel blurb.
const BLURB_MAX = 400
function blurb(s: string | null | undefined, max = BLURB_MAX): string | null {
  if (!s) return null
  const t = s
    .replace(/<br\s*\/?>|<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return null
  if (t.length <= max) return t
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…'
}

// Hacks matched to a game (for the GameDetail Hacks tab). Columns are listed
// explicitly rather than SELECT *: the row carries base_crcs/base_sha1s/patch
// paths the client never reads, and a heavily-hacked game (SMW ships 1k+ rows)
// turns that dead weight into a multi-MB response over the Pi's wifi.
const forGameStmt = db.prepare(`
  SELECT id, hack_key, rhdn_id, kind, system, title, author, patch_format,
         game_id, match_confidence, version, released, downloads, language, description
  FROM rom_hacks WHERE game_id = ?
  -- Explicit tier order — alphabetical on match_confidence would rank
  -- 'canonical' above 'exact' and 'fuzzy' above 'manual'.
  ORDER BY CASE match_confidence
    WHEN 'manual' THEN 0 WHEN 'exact' THEN 1 WHEN 'canonical' THEN 2 WHEN 'fuzzy' THEN 3 ELSE 4 END,
    title COLLATE NOCASE
`)
hacksRouter.get('/for-game/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const rows = forGameStmt.all(id) as Array<{ description: string | null }>
  for (const r of rows) r.description = blurb(r.description)
  return c.json({ hacks: rows })
})

// The full description for one hack, flattened the same way. The list payload
// carries only the 400-char blurb: dumps run to 15k characters, and shipping
// that for every row of a 600-hack game would cost megabytes for text the user
// reads one row at a time. The panel asks for this only when someone actually
// scrolls a truncated blurb.
hacksRouter.get('/:id/description', (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const row = db.prepare('SELECT description FROM rom_hacks WHERE id = ?').get(id) as
    | { description: string | null } | undefined
  if (!row) return c.json({ error: 'hack not found' }, 404)
  return c.json({ description: blurb(row.description, Infinity) })
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
    | { id: number; title: string; system: string; patch_path: string | null; game_id: number | null
        source_crc: string | null; patch_format: string | null; base_crcs: string | null
        patch_hint: string | null } | undefined
  if (!hack) return c.json({ error: 'hack not found' }, 404)
  if (!hack.game_id) return c.json({ error: 'hack is not matched to a game' }, 422)
  if (!hack.patch_path) return c.json({ error: 'no patch file for this hack (extract not complete?)' }, 422)
  // RHDN flags these as needing a bespoke tool; flips/xdelta will only produce
  // a broken ROM. Say so instead of shipping garbage into the library.
  if (hack.patch_hint === 'Requires Custom Patcher') {
    return c.json({ error: 'This hack ships its own patcher — it cannot be applied with flips.' }, 422)
  }

  const patchAbs = path.join(ROMHACKS_DIR, hack.patch_path)
  if (!fs.existsSync(patchAbs)) return c.json({ error: `patch missing on device: ${patchAbs}` }, 422)

  // Base ROM: explicit choice; else the ROM whose CRC matches the patch's source
  // CRC (BPS/UPS validate this — the primary/curated ROM is often a different
  // region or itself a hack); else the game's primary (curated first).
  // Prefer an official base over hack/enhanced variants (some games' curated
  // primary is itself a romhack, e.g. an SA-1 patch), then curated, then id.
  const pickPrimary = db.prepare(`
    SELECT * FROM roms WHERE game_id = ?
    ORDER BY (kind = 'official' OR kind IS NULL) DESC, curated DESC, id ASC LIMIT 1
  `)
  // Candidate base CRCs: the RHDN dump's base-ROM hashes (headered and
  // header-stripped forms of the dump the hack was authored against) plus the
  // BPS/UPS embedded source CRC. Any exact hit beats the game's primary ROM.
  const wantCrcs = [
    ...(hack.base_crcs ? hack.base_crcs.split(',') : []),
    ...(hack.source_crc ? [hack.source_crc] : []),
  ].map(s => s.trim().toUpperCase().padStart(8, '0')).filter(Boolean)

  const byCrc = db.prepare('SELECT * FROM roms WHERE game_id = ? AND crc = ? LIMIT 1')
  let base: { id: number; system: string; rom_path: string } | undefined
  if (body.baseRomId) {
    base = db.prepare('SELECT * FROM roms WHERE id = ? AND game_id = ?')
      .get(body.baseRomId, hack.game_id) as typeof base
  } else {
    for (const crc of wantCrcs) {
      base = byCrc.get(hack.game_id, crc) as typeof base
      if (base) break
    }
    base ??= pickPrimary.get(hack.game_id) as typeof base
  }
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
    // Exclude obvious text/metadata (NOT .md — that's the Megadrive ROM ext).
    const inner = fs.readdirSync(tmpDir)
      .filter(f => !/\.(txt|nfo|dat|xml|diz|html?)$/i.test(f))
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

  const fmt = (hack.patch_format || path.extname(patchAbs).slice(1)).toLowerCase()
  try {
    if (fmt === 'xdelta') {
      // xdelta3: -f force, -s source. No embedded source CRC to validate.
      execFileSync('xdelta3', ['-d', '-f', '-s', sourceRom, patchAbs, outPath], { stdio: 'pipe' })
    } else {
      // flips handles IPS/BPS/UPS and autodetects; overwrite output.
      execFileSync('flips', ['--apply', patchAbs, sourceRom, outPath], { stdio: 'pipe' })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // BPS/UPS reject a wrong-version base ROM; make that legible. When RHDN told
    // us what form the patch expects, that's usually the actual cause — a
    // headered-SNES patch against a No-Intro (unheadered) ROM, or a BIN-format
    // Genesis patch against an SMD dump — so name it.
    const hint = hack.patch_hint && hack.patch_hint !== 'No Special Requirements'
      ? ` RHDN lists this patch as “${hack.patch_hint}” — the base ROM must be in that form.`
      : ''
    const friendly = /checksum|crc|source/i.test(msg)
      ? `Patch rejected the base ROM — your library likely has a different region/revision than this hack needs.${hint}`
      : `Patch failed: ${msg.slice(0, 200)}${hint}`
    return c.json({ error: friendly }, 500)
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
