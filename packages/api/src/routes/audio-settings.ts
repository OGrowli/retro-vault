import { Hono } from 'hono'
import type { AudioConfig } from '@retro-vault/shared'
import { db } from '../db.js'
import { writeAudioOverride } from '../retroarch-overrides.js'

export const audioSettingsRouter = new Hono()

const EMPTY: AudioConfig = {}
const ROW_ID = 1

// Enumerated values RetroArch accepts, whitelisted so a bad payload can't write
// a garbage cfg line. Drivers are what RetroPie ships on the Pi.
const DRIVERS = new Set(['alsathread', 'alsa', 'pulse'])
const RESAMPLERS = new Set(['sinc', 'cc', 'nearest'])
const OUTPUT_RATES = new Set([32000, 44100, 48000])

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
  const clampNum = (v: unknown, min: number, max: number) => {
    const n = num(v)
    return n === undefined ? undefined : Math.max(min, Math.min(max, n))
  }

  const config: AudioConfig = {
    enabled: bool(body.enabled),
    muted: bool(body.muted),
    volumeDb: clampNum(body.volumeDb, -80, 12),
    driver: DRIVERS.has(body.driver as string) ? body.driver : undefined,
    latencyMs: clampNum(body.latencyMs, 8, 512),
    outputRate: OUTPUT_RATES.has(body.outputRate as number) ? body.outputRate : undefined,
    resampler: RESAMPLERS.has(body.resampler as string) ? body.resampler : undefined,
    resamplerQuality: clampNum(body.resamplerQuality, 0, 5),
    sync: bool(body.sync),
    maxTimingSkew: clampNum(body.maxTimingSkew, 0, 0.5),
    rateControlDelta: clampNum(body.rateControlDelta, 0, 0.2),
  }

  db.prepare(`
    INSERT INTO audio_settings (id, config_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')
  `).run(ROW_ID, JSON.stringify(config))

  writeAudioOverride(config)
  return c.json({ saved: true, config })
})
