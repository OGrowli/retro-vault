import { Hono } from 'hono'
import type { HotkeyConfig } from '@retro-vault/shared'
import { db } from '../db.js'
import { writeHotkeyOverride } from '../retroarch-overrides.js'

export const hotkeySettingsRouter = new Hono()

const EMPTY: HotkeyConfig = {}
const ROW_ID = 1

hotkeySettingsRouter.get('/', (c) => {
  const row = db.prepare('SELECT config_json FROM hotkey_settings WHERE id = ?').get(ROW_ID) as
    { config_json: string } | undefined
  if (!row) return c.json(EMPTY)
  try {
    return c.json(JSON.parse(row.config_json) as HotkeyConfig)
  } catch {
    return c.json(EMPTY)
  }
})

hotkeySettingsRouter.put('/', async (c) => {
  const body = await c.req.json<HotkeyConfig>().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid hotkey config' }, 400)
  }

  // Keep only known numeric keys.
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const config: HotkeyConfig = {
    enableHotkey: num(body.enableHotkey),
    saveState: num(body.saveState),
    loadState: num(body.loadState),
    slotIncrease: num(body.slotIncrease),
    slotDecrease: num(body.slotDecrease),
    fastForward: num(body.fastForward),
    reset: num(body.reset),
    fastForwardRatio: num(body.fastForwardRatio),
  }

  db.prepare(`
    INSERT INTO hotkey_settings (id, config_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')
  `).run(ROW_ID, JSON.stringify(config))

  writeHotkeyOverride(config)
  return c.json({ saved: true, config })
})
