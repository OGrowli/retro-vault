import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../db.js'
import { getSystemConfig } from '../systems.config.js'

export const romsRouter = new Hono()

// One-shot resume hint for the kiosk. Launching kills the browser, and the
// replacement only boots after the game exits — localStorage writes made at
// launch time routinely die with the browser, so the API tracks it instead.
// Registered before ':id' so it isn't captured as a rom id.
let resumeHint: { userId: number; gameId: number; endedAt: number } | null = null
const RESUME_WINDOW_MS = 3 * 60 * 1000

romsRouter.get('resume', (c) => {
  const hint = resumeHint
  resumeHint = null
  if (!hint || Date.now() - hint.endedAt > RESUME_WINDOW_MS) {
    return c.json({ resume: null })
  }
  return c.json({ resume: { user_id: hint.userId, game_id: hint.gameId } })
})

// Wrapper that frees the display (stops the kiosk), runs the game on the
// console, and restores the kiosk on exit. Resolved from the service's
// WorkingDirectory (repo root). Logs to ~/.retrovault/launch.log
const LAUNCH_WRAPPER = path.resolve('scripts/launch-game.sh')

const SAVES_DIR = process.env['RETROVAULT_SAVES_DIR'] ?? '/home/pi/RetroPie/saves'

// RetroArch auto-saves as .state.auto; manual slots are .state / .state0–9
const SAVE_EXTS = ['.state.auto', '.state', '.state0']

function hasSaveState(system: string, romPath: string): boolean {
  const stem = path.parse(romPath).name
  const dir = path.join(SAVES_DIR, system)
  return SAVE_EXTS.some(ext => fs.existsSync(path.join(dir, stem + ext)))
}

function hideSaveStates(system: string, romPath: string): void {
  const stem = path.parse(romPath).name
  const dir = path.join(SAVES_DIR, system)
  for (const ext of SAVE_EXTS) {
    const p = path.join(dir, stem + ext)
    if (fs.existsSync(p)) fs.renameSync(p, p + '.bak')
  }
}

// systemd services don't have /opt/retropie/... on PATH, so resolve explicitly
function resolveRetroarch(): string | null {
  const candidates = [
    process.env['RETROVAULT_RETROARCH'],
    '/opt/retropie/emulators/retroarch/bin/retroarch',
    '/usr/local/bin/retroarch',
    '/usr/bin/retroarch',
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return null
}

romsRouter.get('/:id/savestate', (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const rom = db.prepare('SELECT system, rom_path FROM roms WHERE id = ?').get(id) as { system: string; rom_path: string } | undefined
  if (!rom) return c.json({ error: 'Not found' }, 404)
  const stem = path.parse(rom.rom_path).name
  const dir = path.join(SAVES_DIR, rom.system)
  const checked = SAVE_EXTS.map(ext => path.join(dir, stem + ext))
  const found = checked.find(p => fs.existsSync(p)) ?? null
  return c.json({ exists: found !== null, found, checked })
})

romsRouter.get('/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const rom = db.prepare(`
    SELECT r.*,
      COUNT(ps.id) as play_count,
      MAX(ps.started_at) as last_played
    FROM roms r
    LEFT JOIN play_sessions ps ON ps.rom_id = r.id
    WHERE r.id = ?
    GROUP BY r.id
  `).get(id)
  if (!rom) return c.json({ error: 'Not found' }, 404)
  return c.json(rom)
})

romsRouter.post('/:id/launch', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ user_id?: number; fresh?: boolean }>().catch(() => ({} as { user_id?: number; fresh?: boolean }))
  const rom = db.prepare('SELECT * FROM roms WHERE id = ?').get(id) as {
    id: number; system: string; rom_path: string; game_id: number
  } | undefined
  if (!rom) return c.json({ error: 'ROM not found' }, 404)

  if (!fs.existsSync(rom.rom_path)) {
    return c.json({ error: `ROM file not found: ${rom.rom_path}` }, 422)
  }

  let cmd: string
  let args: string[]

  if (process.platform === 'linux' && fs.existsSync(LAUNCH_WRAPPER)) {
    const sysConfig = getSystemConfig(rom.system)
    cmd = 'bash'
    args = [LAUNCH_WRAPPER, rom.system, rom.rom_path]
    // Core path lets the wrapper fall back to direct retroarch on non-RetroPie setups
    if (sysConfig && fs.existsSync(sysConfig.corePath)) args.push(sysConfig.corePath)
  } else {
    // Dev machines / no wrapper: direct retroarch
    const sysConfig = getSystemConfig(rom.system)
    if (!sysConfig) return c.json({ error: `No core configured for system: ${rom.system}` }, 422)

    const retroarch = resolveRetroarch()
    if (!retroarch) {
      return c.json({ error: 'retroarch binary not found — set RETROVAULT_RETROARCH to its full path' }, 500)
    }
    if (!fs.existsSync(sysConfig.corePath)) {
      return c.json({ error: `Libretro core not installed: ${sysConfig.corePath}` }, 422)
    }

    cmd = retroarch
    args = ['-L', sysConfig.corePath, rom.rom_path]
  }

  if (body.fresh) {
    hideSaveStates(rom.system, rom.rom_path)
  }

  return new Promise<Response>((resolve) => {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    })

    // Log the play session server-side: launching tears down the kiosk
    // browser, so the frontend cannot log it after the fact.
    const startedAt = new Date()
    let sessionId: number | null = null
    if (body.user_id) {
      const ins = db.prepare(`
        INSERT INTO play_sessions (user_id, rom_id, game_id, started_at, duration_seconds)
        VALUES (?, ?, ?, ?, 0)
      `).run(body.user_id, rom.id, rom.game_id, startedAt.toISOString())
      sessionId = Number(ins.lastInsertRowid)
    }
    const dropSession = () => {
      if (sessionId !== null) db.prepare('DELETE FROM play_sessions WHERE id = ?').run(sessionId)
      sessionId = null
    }
    const finishSession = () => {
      if (sessionId === null) return
      const secs = Math.round((Date.now() - startedAt.getTime()) / 1000)
      db.prepare('UPDATE play_sessions SET duration_seconds = ? WHERE id = ?').run(secs, sessionId)
      sessionId = null
      if (body.user_id) {
        resumeHint = { userId: body.user_id, gameId: rom.game_id, endedAt: Date.now() }
      }
    }

    let settled = false
    const settle = (r: Response) => {
      if (!settled) { settled = true; resolve(r) }
    }
    child.on('error', (err) => {
      dropSession()
      settle(c.json({ error: `Launch failed: ${err.message}` }, 500))
    })
    // The wrapper runs for the whole game session — an exit within the first
    // few seconds means the launch itself failed. A later exit is the game
    // ending (its code is unreliable: openvt returns 8 when it cannot
    // deallocate the VT that systemd-logind holds).
    child.on('exit', (code) => {
      if (!settled && code !== 0) {
        dropSession()
        settle(c.json({ error: `Launcher exited with code ${code} — check ~/.retrovault/launch.log on the Pi` }, 500))
        return
      }
      finishSession()
      settle(c.json({ launched: true }))
    })
    setTimeout(() => {
      child.unref()
      settle(c.json({ launched: true, pid: child.pid }))
    }, 3000)
  })
})

romsRouter.post('/:id/session', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const rom = db.prepare('SELECT game_id FROM roms WHERE id = ?').get(id) as { game_id: number } | undefined
  if (!rom) return c.json({ error: 'ROM not found' }, 404)

  const body = await c.req.json<{ user_id: number; duration_seconds: number; started_at?: string }>()

  const result = db.prepare(`
    INSERT INTO play_sessions (user_id, rom_id, game_id, started_at, duration_seconds)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    body.user_id,
    id,
    rom.game_id,
    body.started_at ?? new Date().toISOString(),
    body.duration_seconds ?? 0,
  )

  return c.json({ id: result.lastInsertRowid })
})
