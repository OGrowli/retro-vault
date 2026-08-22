#!/usr/bin/env node
// Backfill idgames archive records for WADs already sitting in $DOOM_DIR.
//
// Only WADs pulled through /doom/idgames/download get a sidecar record, so
// side-loaded files (and anything downloaded before that landed) show up on the
// detail page as a bare filename. This walks the folder, searches the idgames
// API by filename, and fills in .wadmeta.json with the same shape the download
// route writes.
//
//   node scripts/backfill-wadmeta.mjs --dry-run     # show what it would match
//   node scripts/backfill-wadmeta.mjs               # write the confident matches
//   node scripts/backfill-wadmeta.mjs --force       # re-resolve WADs that already have a record
//   node scripts/backfill-wadmeta.mjs --pick=av.wad=15067   # resolve one by archive id
//
//   node scripts/backfill-wadmeta.mjs --clear='Sewers (Xbox).wad'  # wrong match — forget it
//
// Flags: --dir=PATH --only=NAME (repeatable) --pick=NAME=ID (repeatable)
//        --clear=NAME (repeatable) --min=N --limit=N --loose --force --iwads
//        --dry-run --quiet
// Env:   RETROVAULT_DOOM_DIR (same default as the API)

import fs from 'node:fs'
import path from 'node:path'

const IDGAMES_API = 'https://www.doomworld.com/idgames/api/api.php'
// The archive is a free public service — space the lookups out rather than
// firing one request per WAD as fast as the Pi can manage.
const THROTTLE_MS = 400
// Below this score a candidate is a guess, not a match; --loose accepts them.
const AUTO_SCORE = 60
const LOOSE_SCORE = 40
// A zip that ships the local WAD is in the same size ballpark as it. An ancient
// 12 KB deathmatch map that happens to be called CANYON.ZIP is not the Master
// Level of the same name, so a wild ratio knocks a match down to a guess.
const SIZE_MIN_RATIO = 0.15
const SIZE_MAX_RATIO = 8
const SIZE_PENALTY = 35

// Mirrors the API's own lists so the script sees exactly the same set of files.
const IWAD_NAMES = new Set([
  'doom.wad', 'doom1.wad', 'doom2.wad', 'tnt.wad', 'plutonia.wad',
  'freedoom1.wad', 'freedoom2.wad', 'freedm.wad',
  'heretic.wad', 'hexen.wad', 'hexdd.wad', 'strife1.wad', 'chex.wad',
])
const PWAD_EXTS = new Set(['.wad', '.pk3', '.pk7', '.ipk3'])

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const multi = (name) => argv.filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3))

const DOOM_DIR = opt('dir', process.env.RETROVAULT_DOOM_DIR || '/home/pi/RetroPie/roms/doom')
const DRY = flag('dry-run')
const FORCE = flag('force')
const LOOSE = flag('loose')
const QUIET = flag('quiet')
const LIMIT = parseInt(opt('limit', '0'), 10) || 0
const ONLY = new Set(multi('only').map(s => s.toLowerCase()))
const INCLUDE_IWADS = flag('iwads')
const CLEAR = new Set(multi('clear').map(x => x.toLowerCase()))
const MIN_SCORE = parseInt(opt('min', ''), 10)
// --pick=av.wad=15067 → skip the search, fetch that record directly.
const PICKS = new Map(multi('pick').map(s => {
  const at = s.lastIndexOf('=')
  return [s.slice(0, at).toLowerCase(), parseInt(s.slice(at + 1), 10)]
}))

const META_FILE = path.join(DOOM_DIR, '.wadmeta.json')
const log = (...a) => { if (!QUIET) console.log(...a) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ---- idgames -------------------------------------------------------------
// Same unwrapping the API route does: content.file is an object for one hit, an
// array for many, and `get` puts the record directly under content.
async function idgames(params) {
  const qs = new URLSearchParams({ ...params, out: 'json' }).toString()
  const res = await fetch(`${IDGAMES_API}?${qs}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`idgames API ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message || 'idgames API error')
  const file = json.content?.file ?? (json.content?.id != null ? json.content : null)
  if (!file) return []
  return (Array.isArray(file) ? file : [file]).map(r => ({
    id: Number(r.id), title: r.title, author: r.author, description: r.description,
    rating: r.rating == null ? undefined : Number(r.rating),
    votes: r.votes == null ? undefined : Number(r.votes),
    dir: r.dir, filename: r.filename,
    size: r.size == null ? undefined : Number(r.size),
    date: r.date,
  }))
}

// ---- matching ------------------------------------------------------------
const stem = (f) => f.replace(/\.[^.]+$/, '')
// Archive filenames are terse and inconsistent about separators — compare on
// letters+digits only so "hr2final.zip" and "HR2FINAL.WAD" collapse together.
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

// A locally-curated folder names files for humans ("SIGIL (v1.1).wad",
// "Master Levels for Doom II - VESPERAS.WAD"), while the archive names them for
// DOS. So each file gets a few spellings to search and match on, each carrying a
// penalty so a hit on the verbatim name always outranks a hit on a derived one.
function variants(wadName) {
  const raw = stem(wadName)
  const bare = raw.replace(/[[(][^\])]*[\])]/g, ' ').replace(/\s+/g, ' ').trim()
  const tail = bare.includes(' - ') ? bare.slice(bare.lastIndexOf(' - ') + 3).trim() : ''
  // Curated sets file articles at the end ("Ultimate Doom, The"); the archive
  // never does, so put the article back before matching on titles.
  const straight = bare.replace(/^(.*?), (the|an?)\b/i, (_m, rest, art) => `${art} ${rest}`)
  const out = []
  for (const [v, penalty] of [[raw, 0], [bare, 5], [straight, 8], [tail, 10]]) {
    if (v.length < 2) continue
    if (out.some(x => norm(x.v) === norm(v))) continue
    out.push({ v, penalty })
  }
  return out
}

// How well one archive record explains one spelling of a local file. The
// filename is the strong signal (a zip almost always ships the WAD of the same
// name); the title is a weak one, kept for uploads whose zip is named after the
// release instead.
function scoreOne(name, rec) {
  const w = norm(name)
  const f = norm(stem(rec.filename ?? ''))
  const t = norm(rec.title)
  if (!w) return 0
  if (f && f === w) return 100
  if (t && t === w) return 70
  // Prefix either way covers "av.wad" from "av19.zip" and "sunlust.wad" from
  // "sunlust_v1_1.zip"; require 4 chars so short stems don't match everything.
  if (f && w.length >= 4 && (f.startsWith(w) || w.startsWith(f))) return 60
  if (t && w.length >= 4 && (t.startsWith(w) || w.startsWith(t))) return 45
  if (f && w.length >= 5 && (f.includes(w) || w.includes(f))) return 40
  return 0
}

// Local file size (bytes) for the WAD being resolved, or 0 when unknown —
// set per file in the main loop so scoring can use it without threading it
// through every helper.
let localSize = 0
function sizeOff(rec) {
  if (!localSize || !rec.size) return false
  const r = rec.size / localSize
  return r < SIZE_MIN_RATIO || r > SIZE_MAX_RATIO
}

const score = (vars, rec) => {
  const raw = vars.reduce((best, { v, penalty }) => {
    const s = scoreOne(v, rec)
    return s ? Math.max(best, s - penalty) : best
  }, 0)
  return raw && sizeOff(rec) ? Math.max(0, raw - SIZE_PENALTY) : raw
}

// Most-voted wins ties — a re-upload or a dir variant of the same release is
// usually the one people actually reviewed.
function rank(vars, recs) {
  return recs
    .map(rec => ({ rec, s: score(vars, rec) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.rec.votes ?? 0) - (a.rec.votes ?? 0) || (b.rec.rating ?? 0) - (a.rec.rating ?? 0))
}

// One search per (query, type) for the whole run — different files in a curated
// set often reduce to the same query, and the archive shouldn't be asked twice.
const searchCache = new Map()
async function search(query, type) {
  const key = `${type}:${query.toLowerCase()}`
  if (searchCache.has(key)) return searchCache.get(key)
  await sleep(THROTTLE_MS)
  const recs = await idgames({ action: 'search', query, type, sort: 'rating', dir: 'desc' })
  searchCache.set(key, recs)
  return recs
}

// Filename passes first (cheapest signal, highest precision), then title passes
// only if nothing convincing turned up. Bails the moment a spelling matches an
// archive filename outright.
async function resolve(wadName) {
  const vars = variants(wadName)
  if (!vars.length) return []
  const pool = new Map()
  let ranked = []
  const absorb = (recs) => {
    for (const r of recs) pool.set(r.id, r)
    ranked = rank(vars, [...pool.values()])
    return ranked.length ? ranked[0].s : 0
  }

  let lastErr
  for (const type of ['filename', 'title']) {
    for (const { v } of vars) {
      try {
        if (absorb(await search(v, type)) >= 100) return ranked
      } catch (e) { lastErr = e }
    }
    if (ranked.length && ranked[0].s >= AUTO_SCORE) return ranked
  }
  if (!ranked.length && lastErr) throw new Error(`search failed: ${lastErr.message}`)
  return ranked
}

// ---- disk ------------------------------------------------------------------
// The folder holds ~90 commercial base games alongside the community WADs, and
// they aren't all named like the IWAD list (e.g. "Ultimate Doom, The (XBLA).wad").
// A WAD's first four bytes say which it is, so ask the file rather than the name.
// Non-WAD containers (.pk3/.pk7) are zips and are always add-on content.
function isIwadFile(full) {
  let fd
  try {
    fd = fs.openSync(full, 'r')
    const buf = Buffer.alloc(4)
    return fs.readSync(fd, buf, 0, 4, 0) === 4 && buf.toString('latin1') === 'IWAD'
  } catch { return false }
  finally { if (fd !== undefined) try { fs.closeSync(fd) } catch { /* ignore */ } }
}

// ---- sidecar -------------------------------------------------------------
function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')) }
  catch { return {} }
}
function writeMeta(map) {
  // Keep one rollback copy — this file is the only place download-time records
  // live, and a bad match shouldn't be a one-way door.
  try { if (fs.existsSync(META_FILE)) fs.copyFileSync(META_FILE, `${META_FILE}.bak`) } catch { /* best effort */ }
  const tmp = `${META_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2))
  fs.renameSync(tmp, META_FILE)
}

// Same field set the download route persists, plus how we arrived at it, so a
// hand-picked or fuzzy record is distinguishable from a download-time one.
const toMeta = (rec, matchedBy, matchScore) => ({
  title: rec.title, author: rec.author, description: rec.description,
  rating: rec.rating, votes: rec.votes, date: rec.date, size: rec.size,
  dir: rec.dir, sourceId: rec.id, sourceFilename: rec.filename,
  matchedBy, matchScore,
})

// ---- main ----------------------------------------------------------------
async function main() {
  if (!fs.existsSync(DOOM_DIR)) {
    console.error(`WAD folder not found: ${DOOM_DIR} (pass --dir=PATH or set RETROVAULT_DOOM_DIR)`)
    process.exit(1)
  }
  const map = readMeta()
  const accept = Number.isFinite(MIN_SCORE) ? MIN_SCORE : LOOSE ? LOOSE_SCORE : AUTO_SCORE

  // --clear is the escape hatch for a wrong match: the WAD goes back to
  // rendering its filename. It leaves a tombstone rather than deleting, because
  // a plain delete would just be re-matched to the same wrong record on the next
  // --force run. --pick on the same file overrules the tombstone.
  if (CLEAR.size) {
    for (const k of CLEAR) map[k] = { ignored: true }
    if (!DRY) writeMeta(map)
    log(`cleared ${CLEAR.size} record(s)${DRY ? ' [dry run]' : ''}: ${[...CLEAR].join(', ')}`)
  }

  let wads = fs.readdirSync(DOOM_DIR)
    .filter(f => { try { return fs.statSync(path.join(DOOM_DIR, f)).isFile() } catch { return false } })
    .filter(f => PWAD_EXTS.has(path.extname(f).toLowerCase()) && !IWAD_NAMES.has(f.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))

  // Base games have no idgames record to find — searching for them just burns
  // requests and invites a wrong match. --iwads forces them in anyway.
  const iwadCount = wads.length
  if (!INCLUDE_IWADS) wads = wads.filter(f => !isIwadFile(path.join(DOOM_DIR, f)))
  const baseGames = iwadCount - wads.length

  if (ONLY.size) wads = wads.filter(f => ONLY.has(f.toLowerCase()))
  // A record already carrying a sourceId came from the archive; leave it alone.
  // Tombstoned files stay out of every run unless --pick names one.
  const todo = wads.filter(f => {
    const m = map[f.toLowerCase()]
    if (PICKS.has(f.toLowerCase())) return true
    if (m?.ignored) return false
    return FORCE || m?.sourceId == null
  })
  const skipped = wads.length - todo.length
  const work = LIMIT ? todo.slice(0, LIMIT) : todo

  log(`${DOOM_DIR}: ${wads.length} add-on WAD(s), ${work.length} to resolve${skipped ? `, ${skipped} already have a record` : ''}${baseGames ? `, ${baseGames} base game(s) skipped` : ''}${DRY ? ' [dry run]' : ''}`)
  if (!work.length) return

  const filled = []
  const cleared = []
  const guesses = []
  const misses = []
  let dirty = false

  for (const name of work) {
    const key = name.toLowerCase()
    try { localSize = fs.statSync(path.join(DOOM_DIR, name)).size } catch { localSize = 0 }
    try {
      const pick = PICKS.get(key)
      let rec, s, how
      if (pick != null && Number.isFinite(pick)) {
        await sleep(THROTTLE_MS)
        ;[rec] = await idgames({ action: 'get', id: String(pick) })
        if (!rec) { misses.push([name, `no archive record for id ${pick}`]); continue }
        s = 100
        how = 'manual'
      } else {
        const ranked = await resolve(name)
        if (!ranked.length) { misses.push([name, 'no candidates']); continue }
        ;({ rec, s } = ranked[0])
        how = s >= 95 ? 'filename' : s >= AUTO_SCORE ? 'title' : 'fuzzy'
      }

      const line = `${name} → ${rec.filename ?? '?'} #${rec.id} "${rec.title ?? 'untitled'}" (${s})`
      if (s < accept) {
        guesses.push([name, rec, s])
        // A re-run that no longer trusts its own earlier match shouldn't leave
        // that match behind; download-time records (no matchScore) are kept.
        if (!DRY && map[key]?.matchScore != null) { delete map[key]; dirty = true; cleared.push(name) }
        log(`  ? ${line}`)
        continue
      }

      if (!DRY) {
        // Preserve a real download timestamp if one is already on file.
        const prev = map[key]
        map[key] = { ...toMeta(rec, how, s), downloadedAt: prev?.downloadedAt }
        dirty = true
      }
      filled.push([name, rec, s])
      log(`  ${DRY ? '·' : '+'} ${line}`)
    } catch (e) {
      misses.push([name, e.message])
      log(`  ! ${name} — ${e.message}`)
    }
  }

  if (dirty) writeMeta(map)

  log(`\n${filled.length} filled${DRY ? ' (dry run — nothing written)' : ''}, ${guesses.length} low confidence, ${misses.length} unresolved`)
  if (guesses.length) {
    log('\nLow confidence — re-run with --loose (or --min=N) to accept these, or pick the right archive id:')
    for (const [name, rec, s] of guesses) {
      const arg = `--pick=${name}=${rec.id}`
      log(`  ${/\s/.test(arg) ? `'${arg}'` : arg}   # ${rec.filename} "${rec.title ?? 'untitled'}" (${s})`)
    }
  }
  if (misses.length) {
    log('\nUnresolved:')
    for (const [name, why] of misses) log(`  ${name} — ${why}`)
    log('  search https://www.doomworld.com/idgames/ and re-run with --pick=NAME=ID')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
