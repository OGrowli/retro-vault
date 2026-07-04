import { Hono } from 'hono'
import { db } from '../db.js'
import { scrapeGame } from '../scraper.js'

export const scrapeRouter = new Hono()

interface ScrapeBody {
  username?: string
  password?: string
}

function makeSSEStream(
  fn: (send: (data: Record<string, unknown>) => void, signal: { aborted: boolean }) => Promise<void>
): Response {
  const encoder = new TextEncoder()
  const abort = { aborted: false }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (abort.aborted) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      try {
        await fn(send, abort)
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
    cancel() {
      abort.aborted = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

scrapeRouter.post('/system/:system', async (c) => {
  const system = c.req.param('system')
  const body = await c.req.json<ScrapeBody>().catch(() => ({} as ScrapeBody))
  const username = body.username ?? ''
  const password = body.password ?? ''

  const games = db.prepare(`
    SELECT id, name FROM games WHERE system = ? AND scraped_at IS NULL ORDER BY name ASC
  `).all(system) as Array<{ id: number; name: string }>

  return makeSSEStream(async (send, sig) => {
    const total = games.length
    let done = 0
    let failed = 0
    send({ total, done, failed, current: null, complete: false })

    for (const game of games) {
      if (sig.aborted) break
      send({ total, done, failed, current: game.name, complete: false })
      const result = await scrapeGame(game.id, username, password)
      if (result.success) done++; else failed++
    }

    send({ total, done, failed, current: null, complete: true })
  })
})

scrapeRouter.post('/all', async (c) => {
  const body = await c.req.json<ScrapeBody>().catch(() => ({} as ScrapeBody))
  const username = body.username ?? ''
  const password = body.password ?? ''

  const games = db.prepare(`
    SELECT id, name FROM games WHERE scraped_at IS NULL ORDER BY system ASC, name ASC
  `).all() as Array<{ id: number; name: string }>

  return makeSSEStream(async (send, sig) => {
    const total = games.length
    let done = 0
    let failed = 0
    send({ total, done, failed, current: null, complete: false })

    for (const game of games) {
      if (sig.aborted) break
      send({ total, done, failed, current: game.name, complete: false })
      const result = await scrapeGame(game.id, username, password)
      if (result.success) done++; else failed++
    }

    send({ total, done, failed, current: null, complete: true })
  })
})
