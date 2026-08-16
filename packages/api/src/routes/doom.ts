import { Hono } from 'hono'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export const doomRouter = new Hono()

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

// Lightweight folder listing — intentionally NOT part of the game metadata /
// scraping pipeline. Splits base games (IWADs) from custom PWADs.
doomRouter.get('/wads', (c) => {
  const { iwads, wads } = listWadDir()
  return c.json({ dir: DOOM_DIR, iwads, wads })
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

  return new Promise<Response>((resolve) => {
    const child = spawn('bash', args, { detached: true, stdio: 'ignore' })
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
const PLAYABLE_IN_ZIP = ['*.wad', '*.pk3', '*.pk7', '*.ipk3', '*.deh', '*.bex']

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

// The API returns content.file as an object for a single hit, an array for
// many, and content: {} / an { error } / { warning } wrapper otherwise.
async function idgames(params: Record<string, string>): Promise<IdgamesFile[]> {
  const qs = new URLSearchParams({ ...params, out: 'json' }).toString()
  const res = await fetch(`${IDGAMES_API}?${qs}`, { signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`idgames API ${res.status}`)
  const json = await res.json() as { content?: { file?: IdgamesFile | IdgamesFile[] }; error?: { type: string; message: string } }
  if (json.error) throw new Error(json.error.message || 'idgames API error')
  const file = json.content?.file
  if (!file) return []
  return Array.isArray(file) ? file : [file]
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

// GET /doom/idgames/search?q=&type=&sort=  — search the archive.
doomRouter.get('/idgames/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) return c.json({ files: [] })
  const type = c.req.query('type') ?? 'title'   // title | author | filename | textfile
  const sort = c.req.query('sort') ?? 'rating'  // rating | date | filename
  try {
    return c.json({ files: await idgames({ action: 'search', query: q, type, sort, dir: 'desc' }) })
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

  try {
    const isZip = path.extname(rec.filename).toLowerCase() === '.zip'
    if (isZip) {
      // Flatten playable files straight into DOOM_DIR (case-insensitive match).
      await execFileAsync('unzip', ['-o', '-j', '-C', tmp, ...PLAYABLE_IN_ZIP, '-d', DOOM_DIR])
    } else {
      fs.copyFileSync(tmp, path.join(DOOM_DIR, path.basename(rec.filename)))
    }
  } catch (e) {
    return c.json({ error: `Extract failed: ${e instanceof Error ? e.message : String(e)}` }, 500)
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }

  // Report what's now playable from this download.
  const exts = new Set(['.wad', '.pk3', '.pk7', '.ipk3', '.deh', '.bex'])
  const added = fs.readdirSync(DOOM_DIR)
    .filter(f => exts.has(path.extname(f).toLowerCase()))
  return c.json({ downloaded: rec.filename, title: rec.title, wads: added })
})
