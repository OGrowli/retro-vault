import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AudioConfig, ControllerConfig, HotkeyConfig } from '@retro-vault/shared'

const DATA_DIR = process.env['RETROVAULT_DATA_DIR'] ?? path.join(os.homedir(), '.retrovault')
export const OVERRIDES_DIR = path.join(DATA_DIR, 'retroarch-overrides')

// Exit is deliberately NOT user-remappable: gated behind the enable-hotkey
// modifier it becomes a two-button combo, so a bad rebind can't lock the kiosk.
const EXIT_BTN_DEFAULT = 9      // Start
const ENABLE_HOTKEY_DEFAULT = 8 // Select

// Systems that share one controller screen in the UI but launch under several
// system strings — write the override for every launch alias so it applies
// no matter which the ROM reports.
const LAUNCH_ALIASES: Record<string, string[]> = {
  megadrive: ['megadrive', 'genesis'],
  arcade: ['arcade', 'mame-libretro', 'mame-mame4all', 'fba', 'fbneo'],
}

function launchTargets(system: string): string[] {
  return LAUNCH_ALIASES[system.toLowerCase()] ?? [system.toLowerCase()]
}

function systemCfgPath(system: string): string {
  return path.join(OVERRIDES_DIR, `${system.toLowerCase()}.cfg`)
}

function hotkeyCfgPath(): string {
  return path.join(OVERRIDES_DIR, 'hotkeys.cfg')
}

function audioCfgPath(): string {
  return path.join(OVERRIDES_DIR, 'audio.cfg')
}

function writeCfg(file: string, lines: string[]): void {
  // No bindings to write → don't leave a stale/empty override behind.
  if (lines.length === 0) {
    if (fs.existsSync(file)) fs.rmSync(file)
    return
  }
  fs.mkdirSync(OVERRIDES_DIR, { recursive: true })
  fs.writeFileSync(file, lines.join('\n') + '\n')
}

// Writes ~/.retrovault/retroarch-overrides/<system>.cfg. Only emits keys that
// have a bound button; removes the file when nothing is bound.
export function writeControllerOverride(system: string, config: ControllerConfig): void {
  const lines: string[] = []
  for (const [input, btn] of Object.entries(config.bindings ?? {})) {
    if (typeof btn === 'number' && Number.isInteger(btn) && btn >= 0) {
      lines.push(`input_player1_${input}_btn = "${btn}"`)
    }
  }
  if (typeof config.deadzone === 'number' && config.deadzone >= 0) {
    lines.push(`input_player1_left_analog_deadzone = "${config.deadzone}"`)
  }
  for (const target of launchTargets(system)) {
    writeCfg(systemCfgPath(target), lines)
  }
}

// Writes ~/.retrovault/retroarch-overrides/hotkeys.cfg. Always writes the
// enable-hotkey + exit pair (safe default if the user hasn't set enable), so
// exit-to-kiosk survives any rebind. Other keys only when bound.
export function writeHotkeyOverride(config: HotkeyConfig): void {
  const lines: string[] = []
  const push = (key: string, val: number | undefined) => {
    if (typeof val === 'number' && Number.isInteger(val) && val >= 0) {
      lines.push(`${key} = "${val}"`)
    }
  }

  lines.push(`input_enable_hotkey_btn = "${config.enableHotkey ?? ENABLE_HOTKEY_DEFAULT}"`)
  lines.push(`input_exit_emulator_btn = "${EXIT_BTN_DEFAULT}"`)
  push('input_save_state_btn', config.saveState)
  push('input_load_state_btn', config.loadState)
  push('input_state_slot_increase_btn', config.slotIncrease)
  push('input_state_slot_decrease_btn', config.slotDecrease)
  push('input_toggle_fast_forward_btn', config.fastForward)
  push('input_reset_btn', config.reset)

  // fastforward_ratio is a plain float setting, not an input_ binding.
  if (typeof config.fastForwardRatio === 'number' && config.fastForwardRatio > 0) {
    lines.push(`fastforward_ratio = "${config.fastForwardRatio}"`)
  }

  writeCfg(hotkeyCfgPath(), lines)
}

// Writes ~/.retrovault/retroarch-overrides/audio.cfg. Only emits keys the user
// has actually set — everything else falls through to RetroArch's own defaults.
export function writeAudioOverride(config: AudioConfig): void {
  const lines: string[] = []
  if (typeof config.muted === 'boolean') lines.push(`audio_mute_enable = "${config.muted}"`)
  if (typeof config.volumeDb === 'number' && Number.isFinite(config.volumeDb)) {
    lines.push(`audio_volume = "${config.volumeDb.toFixed(6)}"`)
  }
  if (config.driver) lines.push(`audio_driver = "${config.driver}"`)
  if (typeof config.latencyMs === 'number' && config.latencyMs > 0) {
    lines.push(`audio_latency = "${Math.round(config.latencyMs)}"`)
  }
  if (typeof config.sync === 'boolean') lines.push(`audio_sync = "${config.sync}"`)
  writeCfg(audioCfgPath(), lines)
}

// Override files (hotkeys + audio first, then the system's) that actually
// exist, for building RetroArch's --appendconfig at launch. The audio and
// hotkey keys are disjoint, so their relative order doesn't matter; the
// per-system file goes last so it can win any future overlap. Empty when none
// are saved.
export function existingOverridePaths(system: string): string[] {
  return [hotkeyCfgPath(), audioCfgPath(), systemCfgPath(system)].filter(p => fs.existsSync(p))
}
