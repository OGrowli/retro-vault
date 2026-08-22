import { Hono } from 'hono'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSetting, setSetting } from '../db.js'

const execFileAsync = promisify(execFile)

export const doomRouter = new Hono()

// Which engine local Doom launches use: standalone 'lzdoom' (GZDoom features)
// or 'retroarch' (lr-prboom libretro core — inherits RetroArch's controller
// config). Persisted in the settings store; the launcher reads it via env.
type DoomEngine = 'lzdoom' | 'retroarch'
const getEngine = (): DoomEngine => (getSetting('doom_engine') === 'retroarch' ? 'retroarch' : 'lzdoom')

doomRouter.get('/settings', (c) => c.json({ engine: getEngine(), onlineReady: !!process.env['DOOM_ONLINE_CMD'] }))

doomRouter.post('/settings', async (c) => {
  const body = await c.req.json<{ engine?: string }>().catch(() => ({} as { engine?: string }))
  if (body.engine !== 'lzdoom' && body.engine !== 'retroarch') {
    return c.json({ error: 'engine must be "lzdoom" or "retroarch"' }, 400)
  }
  setSetting('doom_engine', body.engine)
  return c.json({ engine: body.engine })
})

// Where the user drops IWADs + custom PWADs. On the exFAT roms mount so it's
// editable from Windows; not a registered system, so the importer ignores it.
// Kept deliberately separate from the SQLite game/ROM pipeline.
const DOOM_DIR = process.env['RETROVAULT_DOOM_DIR'] ?? '/home/pi/RetroPie/roms/doom'

// Resolved from the API service's WorkingDirectory (repo root), like launch-game.sh.
const LAUNCH_DOOM = path.resolve('scripts/launch-doom.sh')

// Recognised base games — everything else in the folder is treated as a custom
// PWAD the user can launch on top of an IWAD.
const IWAD_NAMES = new Set([
  'doom.wad', 'doom1.wad', 'doom2.wad', 'tnt.wad', 'plutonia.wad',
  'freedoom1.wad', 'freedoom2.wad', 'freedm.wad',
  'heretic.wad', 'hexen.wad', 'hexdd.wad', 'strife1.wad', 'chex.wad',
])

const PWAD_EXTS = new Set(['.wad', '.pk3', '.pk7', '.ipk3'])

function listWadDir(): { iwads: string[]; wads: string[] } {
  let entries: string[] = []
  try {
    entries = fs.readdirSync(DOOM_DIR)
  } catch {
    return { iwads: [], wads: [] } // folder not created yet
  }
  const files = entries.filter(f => {
    try { return fs.statSync(path.join(DOOM_DIR, f)).isFile() } catch { return false }
  })
  const sort = (a: string, b: string) => a.localeCompare(b)
  // Base games the user can launch directly.
  const iwads = files.filter(f => IWAD_NAMES.has(f.toLowerCase())).sort(sort)
  // Custom PWADs = playable extensions that aren't a base-game IWAD.
  const wads = files
    .filter(f => PWAD_EXTS.has(path.extname(f).toLowerCase()) && !IWAD_NAMES.has(f.toLowerCase()))
    .sort(sort)
  return { iwads, wads }
}

// ---- downloaded-WAD metadata sidecar ------------------------------------
// idgames downloads are just files once extracted, so the rich archive record
// (title/author/rating/description) is otherwise lost. We stash it in a small
// JSON index next to the WADs, keyed by lowercased extracted filename, so the
// WAD detail page can show it later. `.wadmeta.json` is a dotfile with a .json
// ext, so listWadDir() never lists it as a playable WAD.
interface WadMeta {
  title?: string
  author?: string
  description?: string
  rating?: number
  votes?: number
  date?: string
  size?: number
  dir?: string
  sourceId?: number
  sourceFilename?: string
  downloadedAt?: string
  /** How scripts/backfill-wadmeta.mjs arrived at this record (absent = written at download time). */
  matchedBy?: 'filename' | 'title' | 'fuzzy' | 'manual'
  matchScore?: number
  /** Tombstone from `--clear`: this WAD has no archive record — don't re-match it. */
  ignored?: boolean
}
const WAD_META_FILE = () => path.join(DOOM_DIR, '.wadmeta.json')
function readWadMeta(): Record<string, WadMeta> {
  try { return JSON.parse(fs.readFileSync(WAD_META_FILE(), 'utf8')) as Record<string, WadMeta> }
  catch { return {} }
}
function writeWadMeta(map: Record<string, WadMeta>): void {
  fs.writeFileSync(WAD_META_FILE(), JSON.stringify(map, null, 2))
}

// Lightweight folder listing — intentionally NOT part of the game metadata /
// scraping pipeline. Splits base games (IWADs) from custom PWADs.
doomRouter.get('/wads', (c) => {
  const { iwads, wads } = listWadDir()
  // Online multiplayer is only usable once a source-built port + browser is
  // wired via DOOM_ONLINE_CMD (inherited by the launcher). Gate the UI on it.
  return c.json({ dir: DOOM_DIR, iwads, wads, onlineReady: !!process.env['DOOM_ONLINE_CMD'], engine: getEngine() })
})

// GET /doom/wads/meta?name=  — stored archive record for one downloaded WAD,
// plus on-disk size/mtime so side-loaded WADs (no record) still render.
doomRouter.get('/wads/meta', (c) => {
  const name = path.basename(c.req.query('name') ?? '')
  if (!name) return c.json({ error: 'bad name' }, 400)
  // A tombstoned entry means "known to have no archive record" — render it the
  // same as a WAD we've never looked up.
  const stored = readWadMeta()[name.toLowerCase()]
  const meta = stored && !stored.ignored ? stored : null
  let size: number | undefined
  let mtime: string | undefined
  try {
    const st = fs.statSync(path.join(DOOM_DIR, name))
    size = st.size; mtime = st.mtime.toISOString()
  } catch { /* not on disk (dev) — meta-only render */ }
  return c.json({ name, meta, size, mtime })
})

// DELETE /doom/wads/:name  — remove a downloaded WAD (and its sidecar record).
// Guarded to a bare filename inside DOOM_DIR; base-game IWADs are protected.
doomRouter.delete('/wads/:name', (c) => {
  const name = path.basename(c.req.param('name'))
  if (IWAD_NAMES.has(name.toLowerCase())) return c.json({ error: 'refusing to delete a base-game IWAD' }, 400)
  const full = path.join(DOOM_DIR, name)
  let freed = 0
  try { freed = fs.statSync(full).size } catch { return c.json({ error: 'WAD not found' }, 404) }
  try { fs.unlinkSync(full) } catch (e) { return c.json({ error: e instanceof Error ? e.message : 'delete failed' }, 500) }
  const map = readWadMeta()
  if (map[name.toLowerCase()]) { delete map[name.toLowerCase()]; try { writeWadMeta(map) } catch { /* ignore */ } }
  return c.json({ deleted: true, freed })
})

// Launch Doom. Body:
//   { online: true }        → jump to the server browser
//   { iwad: "DOOM2.WAD" }   → play a base game directly
//   { wad: "NERVE.WAD" }    → play a custom PWAD on the default IWAD
//   {}                      → default IWAD, no PWAD
// Deliberately sets no resume hint (unlike ROM launch), so exiting Doom lands
// back on the landing/choice screen instead of deep-linking into RetroVault.
doomRouter.post('/launch', async (c) => {
  const body = await c.req.json<{ online?: boolean; iwad?: string; wad?: string }>()
    .catch(() => ({} as { online?: boolean; iwad?: string; wad?: string }))

  if (process.platform !== 'linux') {
    return c.json({ error: 'Doom launch is only available on the device' }, 400)
  }
  if (!fs.existsSync(LAUNCH_DOOM)) {
    return c.json({ error: `Launcher not found: ${LAUNCH_DOOM}` }, 500)
  }

  // Guard against path traversal — only a bare filename from the folder.
  const inDir = (name: string) => fs.existsSync(path.join(DOOM_DIR, path.basename(name)))

  let args: string[]
  if (body.online) {
    args = [LAUNCH_DOOM, 'online']
  } else if (body.wad) {
    const wad = path.basename(body.wad)
    if (!inDir(wad)) return c.json({ error: `WAD not found: ${wad}` }, 422)
    args = [LAUNCH_DOOM, 'wad', wad]
  } else if (body.iwad) {
    const iwad = path.basename(body.iwad)
    if (!inDir(iwad)) return c.json({ error: `IWAD not found: ${iwad}` }, 422)
    args = [LAUNCH_DOOM, 'iwad', iwad]
  } else {
    args = [LAUNCH_DOOM, 'iwad']
  }

  // Pass the selected engine to the launcher (lzdoom vs retroarch/lr-prboom).
  const env = { ...process.env, DOOM_ENGINE: getEngine() }

  return new Promise<Response>((resolve) => {
    const child = spawn('bash', args, { detached: true, stdio: 'ignore', env })
    let settled = false
    const settle = (r: Response) => { if (!settled) { settled = true; resolve(r) } }

    child.on('error', (err) => settle(c.json({ error: `Doom launch failed: ${err.message}` }, 500)))
    // A fast nonzero exit means the launch itself failed (missing port binary /
    // IWAD); a later exit is Doom quitting normally.
    child.on('exit', (code) => {
      if (!settled && code !== 0) {
        settle(c.json({ error: `Doom launcher exited with code ${code} — check ~/.retrovault/doom.log on the Pi` }, 500))
        return
      }
      settle(c.json({ launched: true }))
    })
    setTimeout(() => { child.unref(); settle(c.json({ launched: true, pid: child.pid })) }, 3000)
  })
})

// ---------------------------------------------------------------------------
// idgames Archive (Doomworld) — on-demand WAD browsing + download.
// Public, no key. We proxy the JSON API and download the actual file from an
// /idgames HTTP mirror, extracting the playable WAD/PK3 into DOOM_DIR so the
// existing picker lists it. Still separate from the SQLite/scrape pipeline.
// ---------------------------------------------------------------------------
const IDGAMES_API = 'https://www.doomworld.com/idgames/api/api.php'
// Download mirrors, tried in order (dir + filename appended).
const IDGAMES_MIRRORS = [
  'https://youfailit.net/pub/idgames/',
  'https://www.quaddicted.com/files/idgames/',
  'https://ftpmirror1.infania.net/pub/idgames/',
]

interface IdgamesFile {
  id: number
  title?: string
  author?: string
  description?: string
  rating?: number
  votes?: number
  dir?: string
  filename?: string
  size?: number
  date?: string
  url?: string
}

// Trim a raw idgames record to the fields the UI actually surfaces. The API
// also returns `textfile` (the whole WAD .txt — tens of KB) plus credits /
// reviews / editors we never render; dropping them shrinks the payload the Pi
// has to transfer, parse and re-serialize by an order of magnitude, which is
// what makes the latest-uploads list feel slow.
function pick(r: IdgamesFile): IdgamesFile {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    description: r.description,
    rating: r.rating,
    votes: r.votes,
    dir: r.dir,
    filename: r.filename,
    size: r.size,
    date: r.date,
    url: r.url,
  }
}

// The API returns content.file as an object for a single hit, an array for
// many, and content: {} / an { error } / { warning } wrapper otherwise.
async function idgames(params: Record<string, string>): Promise<IdgamesFile[]> {
  const qs = new URLSearchParams({ ...params, out: 'json' }).toString()
  const res = await fetch(`${IDGAMES_API}?${qs}`, { signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`idgames API ${res.status}`)
  const json = await res.json() as { content?: (IdgamesFile & { file?: IdgamesFile | IdgamesFile[] }); error?: { type: string; message: string } }
  if (json.error) throw new Error(json.error.message || 'idgames API error')
  // search/latestfiles nest records under content.file (array/object); the `get`
  // action returns the single record directly under content.
  const file = json.content?.file ?? (json.content?.id != null ? json.content : null)
  if (!file) return []
  const records = Array.isArray(file) ? file : [file]
  return records.map(pick)
}

// GET /doom/idgames/latest?limit=  — newest uploads.
doomRouter.get('/idgames/latest', async (c) => {
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20))
  try {
    return c.json({ files: await idgames({ action: 'latestfiles', limit: String(limit) }) })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'idgames unavailable' }, 502)
  }
})

// Which record field the query matches against, and how results are ordered.
// These mirror the idgames API's `search` action; anything outside the allowed
// sets falls back to a sensible default (the API itself is lenient, but we
// validate so the UI can't send junk).
const SEARCH_TYPES = new Set(['filename', 'title', 'author', 'email', 'description', 'credits', 'editors', 'textfile'])
const SORT_KEYS = new Set(['date', 'filename', 'size', 'rating'])

// GET /doom/idgames/search?q=&type=&sort=&dir=  — search the archive.
//   type: title | author | filename | email | description | credits | editors | textfile
//   sort: rating | date | size | filename      dir: desc | asc
doomRouter.get('/idgames/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) return c.json({ files: [] })
  const typeReq = c.req.query('type') ?? ''
  const sortReq = c.req.query('sort') ?? ''
  const type = SEARCH_TYPES.has(typeReq) ? typeReq : 'title'
  const sort = SORT_KEYS.has(sortReq) ? sortReq : 'rating'
  const dir = c.req.query('dir') === 'asc' ? 'asc' : 'desc'
  try {
    return c.json({ files: await idgames({ action: 'search', query: q, type, sort, dir }) })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'idgames unavailable' }, 502)
  }
})

// A single archive review, trimmed to what the detail page renders. The API
// nests them under content.reviews.review; username is an object (empty when
// the reviewer was anonymous), so we coerce it to a name or null.
interface IdgamesReview { vote: number; text?: string; username: string | null }

// GET /doom/idgames/reviews?id=&limit=  — lazy reviews for the detail page.
// Kept off the list/get paths (those are trimmed for payload size) — the detail
// page fetches this on its own after painting.
doomRouter.get('/idgames/reviews', async (c) => {
  const id = parseInt(c.req.query('id') ?? '', 10)
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400)
  const limit = Math.min(40, Math.max(1, parseInt(c.req.query('limit') ?? '25', 10) || 25))
  try {
    const qs = new URLSearchParams({ action: 'get', id: String(id), out: 'json' }).toString()
    const res = await fetch(`${IDGAMES_API}?${qs}`, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) throw new Error(`idgames API ${res.status}`)
    const json = await res.json() as { content?: { reviews?: { review?: unknown } } }
    const raw = json.content?.reviews?.review
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : []
    const reviews: IdgamesReview[] = arr.map((r) => {
      const o = r as { vote?: unknown; text?: unknown; username?: unknown }
      return {
        vote: Number(o.vote) || 0,
        text: typeof o.text === 'string' && o.text.trim() ? o.text.trim() : undefined,
        username: typeof o.username === 'string' && o.username.trim() ? o.username.trim() : null,
      }
    })
    return c.json({ total: reviews.length, reviews: reviews.slice(0, limit) })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'idgames unavailable' }, 502)
  }
})

// GET /doom/idgames/get?id=  — full record for a detail view.
doomRouter.get('/idgames/get', async (c) => {
  const id = parseInt(c.req.query('id') ?? '', 10)
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400)
  try {
    const [file] = await idgames({ action: 'get', id: String(id) })
    return file ? c.json({ file }) : c.json({ error: 'not found' }, 404)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'idgames unavailable' }, 502)
  }
})

// POST /doom/idgames/download  { id }  — fetch from a mirror, extract the
// playable file(s) into DOOM_DIR. Returns the extracted filenames.
doomRouter.post('/idgames/download', async (c) => {
  if (process.platform !== 'linux') {
    return c.json({ error: 'Download is only available on the device' }, 400)
  }
  const body = await c.req.json<{ id?: number }>().catch(() => ({} as { id?: number }))
  if (!Number.isFinite(body.id)) return c.json({ error: 'bad id' }, 400)

  let rec: IdgamesFile | undefined
  try { [rec] = await idgames({ action: 'get', id: String(body.id) }) }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : 'idgames lookup failed' }, 502) }
  if (!rec?.dir || !rec.filename) return c.json({ error: 'record missing dir/filename' }, 502)

  fs.mkdirSync(DOOM_DIR, { recursive: true })
  const relPath = `${rec.dir}${rec.filename}` // dir already ends with '/'
  const tmp = path.join(os.tmpdir(), `idgames-${rec.id}-${path.basename(rec.filename)}`)

  // Try each mirror until one delivers the bytes.
  let ok = false
  let lastErr = ''
  for (const base of IDGAMES_MIRRORS) {
    try {
      const res = await fetch(base + relPath, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue }
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(tmp, buf)
      ok = true
      break
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e) }
  }
  if (!ok) return c.json({ error: `Could not download from any mirror (${lastErr})` }, 502)

  const PLAYABLE_EXTS = new Set(['.wad', '.pk3', '.pk7', '.ipk3', '.deh', '.bex'])
  const added: string[] = []
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idg-'))
  try {
    const isZip = path.extname(rec.filename).toLowerCase() === '.zip'
    if (isZip) {
      // Extract everything flat to a temp dir, then copy out the playable files.
      // unzip exits nonzero when an include pattern matches nothing, so we don't
      // pass patterns / rely on its exit code — we inspect the results instead.
      try { await execFileAsync('unzip', ['-o', '-j', '-C', tmp, '-d', workDir]) }
      catch { /* partial/benign unzip warnings — validate by contents below */ }
      for (const f of fs.readdirSync(workDir)) {
        if (!PLAYABLE_EXTS.has(path.extname(f).toLowerCase())) continue
        fs.copyFileSync(path.join(workDir, f), path.join(DOOM_DIR, f))
        added.push(f)
      }
    } else if (PLAYABLE_EXTS.has(path.extname(rec.filename).toLowerCase())) {
      fs.copyFileSync(tmp, path.join(DOOM_DIR, path.basename(rec.filename)))
      added.push(path.basename(rec.filename))
    }
  } catch (e) {
    return c.json({ error: `Extract failed: ${e instanceof Error ? e.message : String(e)}` }, 500)
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  if (!added.length) return c.json({ error: 'No playable WAD/PK3 found in the archive' }, 422)

  // Stash the archive record against each extracted file so the WAD detail page
  // can show title/author/rating/description later. Best-effort — never fail the
  // download over a metadata write.
  try {
    const map = readWadMeta()
    const now = new Date().toISOString()
    for (const f of added) {
      map[f.toLowerCase()] = {
        title: rec.title, author: rec.author, description: rec.description,
        rating: rec.rating, votes: rec.votes, date: rec.date, size: rec.size,
        dir: rec.dir, sourceId: rec.id, sourceFilename: rec.filename, downloadedAt: now,
      }
    }
    writeWadMeta(map)
  } catch { /* ignore — download still succeeded */ }

  return c.json({ downloaded: rec.filename, title: rec.title, wads: added })
})
