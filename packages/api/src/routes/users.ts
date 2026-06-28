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
    SELECT g.* FROM games g
    JOIN favorites f ON f.game_id = g.id
    WHERE f.user_id = ?
    ORDER BY g.name ASC
  `).all(userId)
  return c.json(rows)
})

usersRouter.post('/:id/favorites/:gameId', (c) => {
  const userId = parseInt(c.req.param('id'), 10)
  const gameId = parseInt(c.req.param('gameId'), 10)

  try {
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, game_id) VALUES (?, ?)').run(userId, gameId)
    return c.json({ favorited: true })
  } catch {
    return c.json({ error: 'Failed to add favorite' }, 500)
  }
})

usersRouter.delete('/:id/favorites/:gameId', (c) => {
  const userId = parseInt(c.req.param('id'), 10)
  const gameId = parseInt(c.req.param('gameId'), 10)
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND game_id = ?').run(userId, gameId)
  return c.json({ favorited: false })
})

usersRouter.get('/:id/history', (c) => {
  const userId = parseInt(c.req.param('id'), 10)
  const rows = db.prepare(`
    SELECT
      ps.id as session_id,
      ps.started_at,
      ps.duration_seconds,
      g.*
    FROM play_sessions ps
    JOIN games g ON g.id = ps.game_id
    WHERE ps.user_id = ?
    ORDER BY ps.started_at DESC
    LIMIT 50
  `).all(userId)
  return c.json(rows)
})
