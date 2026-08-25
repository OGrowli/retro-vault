#!/usr/bin/env node
// Ingest the ROMhacking.net patch archive into a compact patch tree + index for
// RetroVault. Run under WSL (needs unzip + 7z on PATH). The patch archive has no
// metadata, so we derive what we can from folder (system) + `[RHDN_id]Title.ext`
// — which is only the patch's own title, not the game it targets.
//
// Run parse-rhdn-sql.mjs alongside this. It turns the separate romhacking.sql
// database dump into rhdn-meta.json in the same output dir, keyed by the same
// `[id]`, and that is what tells the matcher each patch's canonical game and its
// base-ROM hashes. Without it the import is back to guessing from patch titles.
//
//   node ingest-romhacks.mjs index     # fast: build romhacks/index.json from the
//                                      #   zip listing only (no extraction)
//   node ingest-romhacks.mjs extract   # slow: extract each patch into
//                                      #   romhacks/<system>/<id>.<ext>, read
//                                      #   BPS/UPS source CRC, enrich index.json
//
// Env overrides: RHDN_ZIP, RHDN_OUT, RHDN_WORK, RHDN_CATEGORY (hacks|translations)

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const OUTER = process.env.RHDN_ZIP  || '/mnt/c/Users/Seamus/Downloads/rhdn_20240801.zip'
const OUT   = process.env.RHDN_OUT  || '/mnt/c/Users/Seamus/Downloads/games/romhacks'
const WORK  = process.env.RHDN_WORK || '/mnt/c/Users/Seamus/Downloads/games/_rhdn_work'
const CATEGORY = process.env.RHDN_CATEGORY || 'hacks' // hacks | translations
const KIND = CATEGORY === 'translations' ? 'translation' : 'hack'

// RHDN system folder -> RetroVault system key(s). First is primary (patch tree
// folder); the matcher may try the alternates too. Unmapped RHDN systems
// (3do/3ds/dc/ds/gc/pc*/ps2/ps3/psp/saturn/segacd/sg1k/wii/NA) are skipped.
const SYS_MAP = {
  '2600': ['atari2600'], '7800': ['atari7800'], '32x': ['sega32x'],
  arcade: ['arcade'], fds: ['fds'], gameboy: ['gb', 'gbc'], gamegear: ['gamegear'],
  gba: ['gba'], genesis: ['megadrive', 'genesis'], jaguar: ['atarijaguar'],
  lynx: ['atarilynx'], msx: ['msx', 'msx2'], n64: ['n64'], nes: ['nes'],
  ngcd: ['neogeo'], pokemin: ['pokemini'], psx: ['psx'], sgfx: ['supergrafx'],
  sms: ['mastersystem'], snes: ['snes'], tg16: ['pcengine'], tgcd: ['pcengine'],
  vb: ['virtualboy'],
}

const BUNDLE_RE = new RegExp(`^${CATEGORY}/([^/]+)/patches/(.+)\\.(zip|rar|7z)$`, 'i')
const OUT_INDEX = path.join(OUT, `index${CATEGORY === 'hacks' ? '' : '-' + CATEGORY}.json`)

// [123]Title.ext  |  123.ext  |  Title.ext (no id)
function parseName(file) {
  let m = file.match(/^\[(\d+)\](.+)$/)
  if (m) return { rhdnId: parseInt(m[1], 10), title: m[2].trim() }
  m = file.match(/^(\d+)$/)
  if (m) return { rhdnId: parseInt(m[1], 10), title: null }
  return { rhdnId: null, title: file }
}

function buildIndex() {
  console.log(`Listing ${CATEGORY}/ bundles in ${OUTER} …`)
  const listing = execFileSync('unzip', ['-Z1', OUTER, `${CATEGORY}/*/patches/*`], {
    maxBuffer: 512 * 1024 * 1024, encoding: 'utf8',
  }).split('\n')

  const items = []
  let skipped = 0
  for (const line of listing) {
    const mm = line.match(BUNDLE_RE)
    if (!mm) continue // dirs, readmes, other exts
    const [, sysRaw, fileNoExt, ext] = mm
    const systems = SYS_MAP[sysRaw.toLowerCase()]
    if (!systems) { skipped++; continue }
    const { rhdnId, title } = parseName(fileNoExt)
    items.push({
      rhdnId,
      kind: KIND,
      systemRaw: sysRaw,
      systems,
      title: title ?? fileNoExt,
      bundle: line,              // path within the outer zip
      bundleExt: ext.toLowerCase(),
      format: null,              // filled by extract
      sourceCrc: null,           // filled by extract (bps/ups only)
      patchPath: null,           // filled by extract (relative to OUT)
    })
  }
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(OUT_INDEX, JSON.stringify({
    generatedAt: new Date().toISOString(), category: CATEGORY, source: path.basename(OUTER),
    count: items.length, skippedUnmappedSystem: skipped, items,
  }, null, 2))
  const bySys = {}
  for (const it of items) bySys[it.systemRaw] = (bySys[it.systemRaw] || 0) + 1
  console.log(`Indexed ${items.length} ${CATEGORY} (skipped ${skipped} unmapped-system). Wrote ${OUT_INDEX}`)
  console.log('Per RHDN system:', Object.entries(bySys).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '))
}

// Little-endian uint32 CRC at a byte offset -> 8-char hex.
function crcAt(buf, off) {
  return buf.readUInt32LE(off).toString(16).toUpperCase().padStart(8, '0')
}
// BPS & UPS both store [ sourceCRC | targetCRC | patchCRC ] as the last 12 bytes.
function readSourceCrc(patchFile, ext) {
  if (ext !== 'bps' && ext !== 'ups') return null
  const buf = fs.readFileSync(patchFile)
  if (buf.length < 12) return null
  return crcAt(buf, buf.length - 12)
}

function extractPatches() {
  if (!fs.existsSync(OUT_INDEX)) { console.error(`No index; run 'index' first.`); process.exit(1) }
  const idx = JSON.parse(fs.readFileSync(OUT_INDEX, 'utf8'))

  // Bulk-extract all bundles under CATEGORY/*/patches/ to WORK. Use -n (skip
  // existing) and run every time so an interrupted extraction resumes instead
  // of being skipped wholesale. Point WORK at WSL-native disk (not /mnt/c) for
  // speed — see RHDN_WORK.
  console.log(`Extracting ${CATEGORY} bundles to ${WORK} (resumable) …`)
  fs.mkdirSync(WORK, { recursive: true })
  try {
    execFileSync('unzip', ['-q', '-n', OUTER, `${CATEGORY}/*/patches/*`, '-d', WORK], {
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch { /* unzip -n returns nonzero if nothing new to extract — fine */ }

  const tmp = path.join(WORK, '_patch_tmp')
  let done = 0, ok = 0, bps = 0, fail = 0
  for (const it of idx.items) {
    done++
    if (it.patchPath && fs.existsSync(path.join(OUT, it.patchPath))) { ok++; continue } // resume
    const bundleAbs = path.join(WORK, it.bundle)
    if (!fs.existsSync(bundleAbs)) { fail++; continue }
    try {
      fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true })
      // 7z handles zip/rar/7z uniformly; extract everything, then pick the patch
      // by extension case-insensitively (catches uppercase .IPS + .xdelta).
      execFileSync('7z', ['e', '-y', `-o${tmp}`, bundleAbs, '-r'], { stdio: 'ignore' })
      const patches = fs.readdirSync(tmp).filter(f => /\.(ips|bps|ups|xdelta)$/i.test(f))
      if (!patches.length) { fail++; continue }
      // Prefer bps/ups (carry a source CRC), then xdelta, then ips; then largest.
      patches.sort((a, b) => {
        const rank = e => (/\.bps$/i.test(e) ? 0 : /\.ups$/i.test(e) ? 1 : /\.xdelta$/i.test(e) ? 2 : 3)
        return rank(a) - rank(b) || fs.statSync(path.join(tmp, b)).size - fs.statSync(path.join(tmp, a)).size
      })
      const chosen = patches[0]
      const ext = chosen.split('.').pop().toLowerCase()
      const id = it.rhdnId ?? path.basename(it.bundle).replace(/\.[^.]+$/, '')
      const rel = path.join(it.systems[0], `${id}.${ext}`)
      const dest = path.join(OUT, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(path.join(tmp, chosen), dest)
      it.format = ext
      it.patchPath = rel
      it.sourceCrc = readSourceCrc(dest, ext)
      if (it.sourceCrc) bps++
      ok++
    } catch { fail++ }
    if (done % 500 === 0) {
      console.log(`… ${done}/${idx.items.length}  ok=${ok} bps/ups-crc=${bps} fail=${fail}`)
      fs.writeFileSync(OUT_INDEX, JSON.stringify(idx, null, 2)) // checkpoint
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.writeFileSync(OUT_INDEX, JSON.stringify(idx, null, 2))
  console.log(`Extract done: ${ok} patches, ${bps} with source CRC, ${fail} failed. Index: ${OUT_INDEX}`)
}

const mode = process.argv[2] || 'index'
if (mode === 'index') buildIndex()
else if (mode === 'extract') extractPatches()
else { console.error(`Unknown mode: ${mode} (use index|extract)`); process.exit(1) }
