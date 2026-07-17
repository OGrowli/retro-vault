import { Hono } from 'hono'
import type { ControllerConfig } from '@retro-vault/shared'
import { db } from '../db.js'
import { writeControllerOverride } from '../retroarch-overrides.js'

export const controllerSettingsRouter = new Hono()

const EMPTY: ControllerConfig = { bindings: {} }

controllerSettingsRouter.get('/:system', (c) => {
  const system = c.req.param('system').toLowerCase()
  const row = db.prepare('SELECT config_json FROM controller_settings WHERE system = ?').get(system) as
    { config_json: string } | undefined
  if (!row) return c.json(EMPTY)
  try {
    return c.json(JSON.parse(row.config_json) as ControllerConfig)
  } catch {
    return c.json(EMPTY)
  }
})

controllerSettingsRouter.put('/:system', async (c) => {
  const system = c.req.param('system').toLowerCase()
  const body = await c.req.json<ControllerConfig>().catch(() => null)
  if (!body || typeof body !== 'object' || typeof body.bindings !== 'object') {
    return c.json({ error: 'Invalid controller config' }, 400)
  }

  const config: ControllerConfig = {
    bindings: body.bindings ?? {},
    ...(typeof body.deadzone === 'number' ? { deadzone: body.deadzone } : {}),
  }

  db.prepare(`
    INSERT INTO controller_settings (system, config_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(system) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')
  `).run(system, JSON.stringify(config))

  writeControllerOverride(system, config)
  return c.json({ saved: true, config })
})
