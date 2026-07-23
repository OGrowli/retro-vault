import { Hono } from 'hono'
import type { AudioConfig } from '@retro-vault/shared'
import { db } from '../db.js'
import { writeAudioOverride } from '../retroarch-overrides.js'

export const audioSettingsRouter = new Hono()

const EMPTY: AudioConfig = {}
const ROW_ID = 1

// Drivers we let the user pick — RetroPie ships these on the Pi.
const DRIVERS = new Set(['alsathread', 'alsa', 'pulse'])

audioSettingsRouter.get('/', (c) => {
  const row = db.prepare('SELECT config_json FROM audio_settings WHERE id = ?').get(ROW_ID) as
    { config_json: string } | undefined
  if (!row) return c.json(EMPTY)
  try {
    return c.json(JSON.parse(row.config_json) as AudioConfig)
  } catch {
    return c.json(EMPTY)
  }
})

audioSettingsRouter.put('/', async (c) => {
  const body = await c.req.json<AudioConfig>().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid audio config' }, 400)
  }

  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

  const config: AudioConfig = {
    muted: bool(body.muted),
    volumeDb: num(body.volumeDb),
    driver: DRIVERS.has(body.driver as string) ? body.driver : undefined,
    latencyMs: num(body.latencyMs),
    sync: bool(body.sync),
  }

  db.prepare(`
    INSERT INTO audio_settings (id, config_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')
  `).run(ROW_ID, JSON.stringify(config))

  writeAudioOverride(config)
  return c.json({ saved: true, config })
})
