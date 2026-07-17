import { Hono } from 'hono'
import { db } from '../db.js'

export const eventsRouter = new Hono()

interface EventRow {
  id: number
  created_at: string
  level: string
  category: string
  message: string
  detail: string | null
  game_id: number | null
}

function buildWhere(q: Record<string, string>): { where: string; params: string[] } {
  const conditions: string[] = []
  const params: string[] = []

  // created_at is stored as 'YYYY-MM-DD HH:MM:SS' (UTC, sqlite datetime('now')).
  // from/to accept anything string-comparable against that, e.g. '2026-07-01' or a full timestamp.
  if (q['from']) {
    conditions.push('created_at >= ?')
    params.push(q['from'])
  }
  if (q['to']) {
    conditions.push('created_at <= ?')
    params.push(q['to'])
  }
  if (q['category']) {
    conditions.push('category = ?')
    params.push(q['category'])
  }
  if (q['level']) {
    conditions.push('level = ?')
    params.push(q['level'])
  }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

// GET /events?from=&to=&category=&level=&limit=  -> JSON, most recent first
eventsRouter.get('/', (c) => {
  const q = c.req.query() as Record<string, string>
  const { where, params } = buildWhere(q)
  const limit = Math.min(parseInt(q['limit'] ?? '200', 10) || 200, 2000)

  const rows = db.prepare(`
    SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ?
  `).all(...params, limit) as EventRow[]

  return c.json(rows.map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })))
})

// GET /events/export?from=&to=&category=&level=&format=csv|ndjson  -> file download, oldest first
eventsRouter.get('/export', (c) => {
  const q = c.req.query() as Record<string, string>
  const { where, params } = buildWhere(q)
  const format = q['format'] === 'ndjson' ? 'ndjson' : 'csv'

  const rows = db.prepare(`
    SELECT * FROM events ${where} ORDER BY created_at ASC
  `).all(...params) as EventRow[]

  const safe = (s: string) => s.replace(/[^\w-]/g, '_')
  const from = safe(q['from'] ?? 'all')
  const to = safe(q['to'] ?? 'now')

  if (format === 'ndjson') {
    const body = rows.map(r => JSON.stringify(r)).join('\n')
    return new Response(body, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="retrovault-events_${from}_${to}.ndjson"`,
      },
    })
  }

  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ['id', 'created_at', 'level', 'category', 'message', 'detail', 'game_id'].join(',')
  const lines = rows.map(r =>
    [r.id, r.created_at, r.level, r.category, r.message, r.detail, r.game_id].map(esc).join(',')
  )
  const csv = [header, ...lines].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="retrovault-events_${from}_${to}.csv"`,
    },
  })
})
