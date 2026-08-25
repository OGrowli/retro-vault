import { Hono } from 'hono'
import { db, buildFilterClause, parseFilter, logEvent } from '../db.js'
import { scrapeGame, describeError } from '../scraper.js'

export const gamesRouter = new Hono()

gamesRouter.get('/', (c) => {
  const query = c.req.query() as Record<string, string>
  const userId = query['userId'] ? parseInt(query['userId'], 10) : undefined
  const filter = parseFilter(query)
  const { where, params } = buildFilterClause(filter, userId)

  // Paginated path: the home grid asks for a window with ?limit=&offset= and
  // gets { total, items }. Avoids shipping the whole ~13k-row library (2.8 MB)
  // on every view. rom_count is unused by the grid, so no roms join is needed.
  const limitRaw = query['limit']
  if (limitRaw !== undefined) {
    const limit = Math.max(1, Math.min(1000, parseInt(limitRaw, 10) || 0))
    const offset = Math.max(0, parseInt(query['offset'] ?? '0', 10) || 0)
    const { total } = db.prepare(`SELECT COUNT(*) as total FROM games g ${where}`).get(...params) as { total: number }
    const items = db.prepare(`
      SELECT g.* FROM games g
      ${where}
      ORDER BY g.name ASC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)
    return c.json({ total, items })
  }

  // Unpaginated fallback (full array). Kept for compatibility; no roms join.
  const rows = db.prepare(`
    SELECT g.* FROM games g
    ${where}
    ORDER BY g.name ASC
  `).all(...params)
  return c.json(rows)
})

// Just the matching game ids (ordered), for bulk actions like "add all results
// to a list" that the paginated client no longer holds in memory.
gamesRouter.get('/ids', (c) => {
  const query = c.req.query() as Record<string, string>
  const userId = query['userId'] ? parseInt(query['userId'], 10) : undefined
  const filter = parseFilter(query)
  const { where, params } = buildFilterClause(filter, userId)
  const rows = db.prepare(`SELECT g.id FROM games g ${where} ORDER BY g.name ASC`).all(...params) as { id: number }[]
  return c.json(rows.map(r => r.id))
})

// Must be before /:id so Hono doesn't treat "random" as an id param
gamesRouter.get('/random', (c) => {
  const query = c.req.query() as Record<string, string>
  const userId = query['userId'] ? parseInt(query['userId'], 10) : undefined
  const filter = parseFilter(query)
  const { where, params } = buildFilterClause(filter, userId)

  const row = db.prepare(`
    SELECT g.*, COUNT(r.id) as rom_count
    FROM games g
    LEFT JOIN roms r ON r.game_id = g.id
    ${where}
    GROUP BY g.id
    ORDER BY RANDOM()
    LIMIT 1
  `).get(...params)
  if (!row) return c.json({ error: 'No games found' }, 404)
  return c.json(row)
})

gamesRouter.get('/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id)
  if (!game) return c.json({ error: 'Not found' }, 404)

  const roms = db.prepare(`
    SELECT r.*,
      COUNT(ps.id) as play_count,
      MAX(ps.started_at) as last_played
    FROM roms r
    LEFT JOIN play_sessions ps ON ps.rom_id = r.id
    WHERE r.game_id = ?
    GROUP BY r.id
    ORDER BY
      CASE WHEN r.curated = 1 THEN 0 ELSE 1 END,
      CASE r.kind WHEN 'official' THEN 0 WHEN 'translation' THEN 1 ELSE 2 END,
      CASE WHEN r.region IS NULL THEN 1 ELSE 0 END,
      r.region ASC,
      CASE WHEN r.revision IS NULL THEN 0 ELSE 1 END,
      r.revision ASC
  `).all(id)

  const stats = db.prepare(`
    SELECT COUNT(ps.id) as total_play_count, MAX(ps.started_at) as last_played
    FROM play_sessions ps
    WHERE ps.game_id = ?
  `).get(id) as { total_play_count: number; last_played: string | null }

  // Counts every row the Hacks panel would list, so the number on the action
  // row and the list behind it agree.
  const { hack_count } = db.prepare(
    'SELECT COUNT(*) AS hack_count FROM rom_hacks WHERE game_id = ?',
  ).get(id) as { hack_count: number }

  return c.json({
    ...(game as Record<string, unknown>),
    roms,
    total_play_count: stats.total_play_count,
    last_played: stats.last_played,
    hack_count,
  })
})

gamesRouter.post('/:id/favorite', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ userId: number }>()
  const userId = body.userId

  const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND game_id = ?').get(userId, id)
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND game_id = ?').run(userId, id)
    return c.json({ favorited: false })
  }
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, game_id) VALUES (?, ?)').run(userId, id)
  return c.json({ favorited: true })
})

gamesRouter.get('/:id/sessions', (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const rows = db.prepare(`
    SELECT
      ps.id, ps.started_at, ps.duration_seconds, ps.user_id, ps.rom_id,
      r.full_name as rom_full_name, r.region as rom_region, r.revision as rom_revision,
      u.username, u.avatar_color
    FROM play_sessions ps
    JOIN roms r ON r.id = ps.rom_id
    JOIN users u ON u.id = ps.user_id
    WHERE ps.game_id = ?
    ORDER BY ps.started_at DESC
    LIMIT 100
  `).all(id)
  return c.json(rows)
})

gamesRouter.post('/:id/scrape', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}))
  try {
    const result = await scrapeGame(
      id,
      (body as { username?: string }).username ?? '',
      (body as { password?: string }).password ?? ''
    )
    if (!result.success) {
      return c.json({ error: result.error }, 422)
    }
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id)
    return c.json(game)
  } catch (e) {
    // Anything scrapeGame didn't handle itself (DB/image failures, etc.) —
    // log it so the event feed captures the 500 instead of only the journal.
    const error = describeError(e)
    logEvent({ level: 'error', category: 'scrape', message: error, gameId: id })
    return c.json({ error }, 500)
  }
})
