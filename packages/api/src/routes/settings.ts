import { Hono } from 'hono'
import { getSetting, setSetting } from '../db.js'

// Whitelisted setting keys — ScreenScraper credentials
const KEYS = ['ss_dev_id', 'ss_dev_password', 'ss_user', 'ss_user_password'] as const

export const settingsRouter = new Hono()

settingsRouter.get('/', (c) => {
  const out: Record<string, string> = {}
  for (const k of KEYS) out[k] = getSetting(k) ?? ''
  return c.json(out)
})

settingsRouter.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  for (const k of KEYS) {
    const v = body[k]
    if (typeof v === 'string') setSetting(k, v)
  }
  return c.json({ saved: true })
})
