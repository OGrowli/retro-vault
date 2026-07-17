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

// All lists for a user with a game count. Pass ?gameId=N to also get an
// `included` flag per list (whether that game is already in the list) — lets
// the Add to List modal render toggle state in one request instead of N.
usersRouter.get('/:id/lists', (c) => {
  const userId = parseInt(c.req.param('id'), 10)
  const gameIdParam = c.req.query('gameId')
  const gameId = gameIdParam ? parseInt(gameIdParam, 10) : undefined

  if (gameId !== undefined && !Number.isNaN(gameId)) {
    const rows = db.prepare(`
      SELECT l.*,
        COUNT(lg.id) as game_count,
        MAX(CASE WHEN lg.game_id = ? THEN 1 ELSE 0 END) as included
      FROM lists l
      LEFT JOIN list_games lg ON lg.list_id = l.id
      WHERE l.user_id = ?
      GROUP BY l.id
      ORDER BY l.created_at ASC
    `).all(gameId, userId) as Array<Record<string, unknown>>
    return c.json(rows.map(r => ({ ...r, included: Boolean(r['included']) })))
  }

  const rows = db.prepare(`
    SELECT l.*, COUNT(lg.id) as game_count
    FROM lists l
    LEFT JOIN list_games lg ON lg.list_id = l.id
    WHERE l.user_id = ?
    GROUP BY l.id
    ORDER BY l.created_at ASC
  `).all(userId)
  return c.json(rows)
})

usersRouter.post('/:id/lists', async (c) => {
  const userId = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ name: string }>().catch(() => ({ name: '' }))
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400)

  const result = db.prepare('INSERT INTO lists (user_id, name) VALUES (?, ?)').run(userId, body.name.trim())
  const list = db.prepare(`
    SELECT l.*, 0 as game_count FROM lists l WHERE l.id = ?
  `).get(result.lastInsertRowid)
  return c.json(list, 201)
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
