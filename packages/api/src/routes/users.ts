import { Hono } from 'hono'
import { db } from '../db.js'

export const usersRouter = new Hono()

usersRouter.get('/', (c) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all()
  return c.json(rows)
})

usersRouter.post('/', async (c) => {
  const body = await c.req.json<{ username: string; avatar_color?: string }>()
  if (!body.username?.trim()) return c.json({ error: 'username required' }, 400)

  try {
    const result = db.prepare(`
      INSERT INTO users (username, avatar_color) VALUES (?, ?)
    `).run(body.username.trim(), body.avatar_color ?? '#0070D1')

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)
    return c.json(user, 201)
  } catch {
    return c.json({ error: 'Username already taken' }, 409)
  }
})

usersRouter.get('/:id/favorites', (c) => {
  const userId = parseInt(c.req.param('id'), 10)
  const rows = db.prepare(`
    SELECT g.*, COUNT(r.id) as rom_count
    FROM games g
    JOIN favorites f ON f.game_id = g.id
    LEFT JOIN roms r ON r.game_id = g.id
    WHERE f.user_id = ?
    GROUP BY g.id
    ORDER BY g.name ASC
  `).all(userId)
  return c.json(rows)
})

usersRouter.get('/:id/history', (c) => {
  const userId = parseInt(c.req.param('id'), 10)
  const rows = db.prepare(`
    SELECT
      ps.id as session_id,
      ps.started_at,
      ps.duration_seconds,
      ps.rom_id,
      r.full_name as rom_full_name,
      r.region as rom_region,
      r.revision as rom_revision,
      g.id, g.name, g.system, g.genre, g.year, g.players,
      g.description, g.box_art_path, g.scraped_at
    FROM play_sessions ps
    JOIN roms r ON r.id = ps.rom_id
    JOIN games g ON g.id = ps.game_id
    WHERE ps.user_id = ?
    ORDER BY ps.started_at DESC
    LIMIT 50
  `).all(userId)
  return c.json(rows)
})
