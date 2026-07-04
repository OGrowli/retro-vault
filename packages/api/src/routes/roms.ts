import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import { db } from '../db.js'
import { getSystemConfig } from '../systems.config.js'

export const romsRouter = new Hono()

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

romsRouter.post('/:id/launch', (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const rom = db.prepare('SELECT * FROM roms WHERE id = ?').get(id) as {
    id: number; system: string; rom_path: string; game_id: number
  } | undefined
  if (!rom) return c.json({ error: 'ROM not found' }, 404)

  const sysConfig = getSystemConfig(rom.system)
  if (!sysConfig) return c.json({ error: `No core configured for system: ${rom.system}` }, 422)

  const child = spawn('retroarch', ['-L', sysConfig.corePath, rom.rom_path], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  return c.json({ launched: true, pid: child.pid })
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
