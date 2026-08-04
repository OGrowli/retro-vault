import { Hono } from 'hono'
import { db, gamesOrderSql, parseGameSort } from '../db.js'

export const listsRouter = new Hono()

const touchList = db.prepare("UPDATE lists SET last_viewed_at = datetime('now') WHERE id = ?")

// Games in a list — same shape as the favorites query (g.* + rom_count).
// Order via ?sort= (recent|name|year|added|system); ?userId= enables 'recent'.
listsRouter.get('/:id/games', (c) => {
  const listId = parseInt(c.req.param('id'), 10)
  const userIdParam = c.req.query('userId')
  const userId = userIdParam ? parseInt(userIdParam, 10) : undefined
  const sort = parseGameSort(c.req.query('sort'))
  const { join, joinParams, orderBy } = gamesOrderSql(sort, { userId, addedCol: 'lg.id' })

  const rows = db.prepare(`
    SELECT g.*, COUNT(DISTINCT r.id) as rom_count
    FROM games g
    JOIN list_games lg ON lg.game_id = g.id
    LEFT JOIN roms r ON r.game_id = g.id
    ${join}
    WHERE lg.list_id = ?
    GROUP BY g.id
    ORDER BY ${orderBy}
  `).all(...joinParams, listId)
  return c.json(rows)
})

// Bump last_viewed_at so "recently viewed" list ordering reflects opens.
listsRouter.post('/:id/view', (c) => {
  const listId = parseInt(c.req.param('id'), 10)
  touchList.run(listId)
  return c.json({ ok: true })
})

// Bulk-add many games to a list in one shot — used when adding a whole set of
// search/filter results. INSERT OR IGNORE skips games already in the list, so
// the call is idempotent. Returns how many rows were actually added.
listsRouter.post('/:id/games', async (c) => {
  const listId = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ gameIds: number[] }>().catch(() => ({ gameIds: [] }))
  const gameIds = Array.isArray(body.gameIds)
    ? body.gameIds.filter(id => Number.isInteger(id))
    : []
  if (gameIds.length === 0) return c.json({ added: 0 })

  const insert = db.prepare('INSERT OR IGNORE INTO list_games (list_id, game_id) VALUES (?, ?)')
  const addMany = db.transaction((ids: number[]) => {
    let added = 0
    for (const gameId of ids) added += insert.run(listId, gameId).changes
    return added
  })
  const added = addMany(gameIds)
  touchList.run(listId)
  return c.json({ added })
})

// Toggle a game in/out of a list, mirroring gamesRouter's /:id/favorite.
listsRouter.post('/:listId/games/:gameId/toggle', (c) => {
  const listId = parseInt(c.req.param('listId'), 10)
  const gameId = parseInt(c.req.param('gameId'), 10)

  const existing = db.prepare('SELECT id FROM list_games WHERE list_id = ? AND game_id = ?').get(listId, gameId)
  if (existing) {
    db.prepare('DELETE FROM list_games WHERE list_id = ? AND game_id = ?').run(listId, gameId)
    return c.json({ included: false })
  }
  db.prepare('INSERT OR IGNORE INTO list_games (list_id, game_id) VALUES (?, ?)').run(listId, gameId)
  touchList.run(listId)
  return c.json({ included: true })
})

listsRouter.delete('/:id', (c) => {
  const listId = parseInt(c.req.param('id'), 10)
  db.prepare('DELETE FROM lists WHERE id = ?').run(listId)
  return c.json({ deleted: true })
})
