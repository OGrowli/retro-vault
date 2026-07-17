import { Hono } from 'hono'
import { db } from '../db.js'

export const listsRouter = new Hono()

// Games in a list — same shape as the favorites query (g.* + rom_count).
listsRouter.get('/:id/games', (c) => {
  const listId = parseInt(c.req.param('id'), 10)
  const rows = db.prepare(`
    SELECT g.*, COUNT(r.id) as rom_count
    FROM games g
    JOIN list_games lg ON lg.game_id = g.id
    LEFT JOIN roms r ON r.game_id = g.id
    WHERE lg.list_id = ?
    GROUP BY g.id
    ORDER BY g.name ASC
  `).all(listId)
  return c.json(rows)
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
  return c.json({ included: true })
})

listsRouter.delete('/:id', (c) => {
  const listId = parseInt(c.req.param('id'), 10)
  db.prepare('DELETE FROM lists WHERE id = ?').run(listId)
  return c.json({ deleted: true })
})
