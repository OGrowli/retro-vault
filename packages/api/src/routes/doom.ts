import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

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
