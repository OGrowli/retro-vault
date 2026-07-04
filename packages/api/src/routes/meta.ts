import { Hono } from 'hono'
import { db } from '../db.js'

export const metaRouter = new Hono()

metaRouter.get('/systems', (c) => {
  const rows = db.prepare('SELECT DISTINCT system FROM games ORDER BY system ASC').all()
  return c.json(rows.map((r) => (r as Record<string, unknown>)['system']))
})

metaRouter.get('/genres', (c) => {
  const rows = db.prepare('SELECT DISTINCT genre FROM games WHERE genre IS NOT NULL ORDER BY genre ASC').all()
  return c.json(rows.map((r) => (r as Record<string, unknown>)['genre']))
})
