import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import { db, buildFilterClause, parseFilter } from '../db.js'
import { getSystemConfig } from '../systems.config.js'

export const gamesRouter = new Hono()

gamesRouter.get('/', (c) => {
  const query = c.req.query() as Record<string, string>
  const userId = query['userId'] ? parseInt(query['userId'], 10) : undefined
  const filter = parseFilter(query)
  const { where, params } = buildFilterClause(filter, userId)

  const rows = db.prepare(`SELECT g.* FROM games g ${where} ORDER BY g.name ASC`).all(...params)
  return c.json(rows)
})

gamesRouter.get('/random', (c) => {
  const query = c.req.query() as Record<string, string>
  const userId = query['userId'] ? parseInt(query['userId'], 10) : undefined
  const filter = parseFilter(query)
  const { where, params } = buildFilterClause(filter, userId)

  const row = db.prepare(`SELECT g.* FROM games g ${where} ORDER BY RANDOM() LIMIT 1`).get(...params)
  if (!row) return c.json({ error: 'No games found' }, 404)
  return c.json(row)
})

gamesRouter.get('/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

gamesRouter.post('/:id/launch', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as {
    id: number; system: string; rom_path: string; name: string
  } | undefined

  if (!game) return c.json({ error: 'Game not found' }, 404)

  const sysConfig = getSystemConfig(game.system)
  if (!sysConfig) return c.json({ error: `No core configured for system: ${game.system}` }, 422)

  const child = spawn('retroarch', ['-L', sysConfig.corePath, game.rom_path], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  db.prepare('UPDATE games SET play_count = play_count + 1 WHERE id = ?').run(id)

  return c.json({ launched: true, pid: child.pid })
})

gamesRouter.post('/:id/session', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ user_id: number; duration_seconds: number; started_at?: string }>()

  const result = db.prepare(`
    INSERT INTO play_sessions (user_id, game_id, started_at, duration_seconds)
    VALUES (?, ?, ?, ?)
  `).run(
    body.user_id,
    id,
    body.started_at ?? new Date().toISOString(),
    body.duration_seconds ?? 0,
  )

  return c.json({ id: result.lastInsertRowid })
})
