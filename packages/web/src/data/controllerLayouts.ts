// Per-system controller layouts. Each layout is a set of remappable rows keyed
// by the RetroArch input suffix (written as input_player1_<key>_btn) with a
// label taken from that console's own button naming. Layouts vary widely —
// 2-button systems with no Select, keypads, generic-button consoles — so the UI
// renders whatever rows the system defines rather than assuming a standard pad.

export type PresetKind = 'default' | 'swapAB' | 'swapXY'

export interface BindRow {
  /** RetroArch input suffix, e.g. 'a', 'b', 'start', 'l2', 'keypad_1' */
  key: string
  /** Label using the console's real button name */
  label: string
}

export interface SystemLayout {
  label: string
  buttons: BindRow[]
  /** Analog stick → expose a deadzone slider (n64, psx) */
  hasDeadzone?: boolean
  presets: PresetKind[]
}

const std = (label: string, buttons: BindRow[], opts: Partial<SystemLayout> = {}): SystemLayout => ({
  label,
  buttons,
  presets: opts.presets ?? ['default'],
  ...(opts.hasDeadzone ? { hasDeadzone: true } : {}),
})

const nes: SystemLayout = std('NES', [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
  { key: 'start', label: 'Start' },
  { key: 'select', label: 'Select' },
], { presets: ['default', 'swapAB'] })

const gb: SystemLayout = std('Game Boy', [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
  { key: 'start', label: 'Start' },
  { key: 'select', label: 'Select' },
], { presets: ['default', 'swapAB'] })

const ngp: SystemLayout = std('Neo Geo Pocket', [
  { key: 'b', label: 'A' },
  { key: 'a', label: 'B' },
  { key: 'start', label: 'Option' },
], { presets: ['default', 'swapAB'] })

// Full layout map. Keys here are the picker/save keys; launch aliases
// (megadrive↔genesis, arcade↔mame/fba/fbneo) are handled server-side.
export const LAYOUTS: Record<string, SystemLayout> = {
  nes,
  fds: { ...nes, label: 'Famicom Disk System' }, // shares NES layout, own config
  snes: std('SNES', [
    { key: 'a', label: 'A' }, { key: 'b', label: 'B' },
    { key: 'x', label: 'X' }, { key: 'y', label: 'Y' },
    { key: 'l', label: 'L' }, { key: 'r', label: 'R' },
    { key: 'start', label: 'Start' }, { key: 'select', label: 'Select' },
  ], { presets: ['default', 'swapAB', 'swapXY'] }),
  gb,
  gbc: { ...gb, label: 'Game Boy Color' },
  gba: std('Game Boy Advance', [
    { key: 'a', label: 'A' }, { key: 'b', label: 'B' },
    { key: 'l', label: 'L' }, { key: 'r', label: 'R' },
    { key: 'start', label: 'Start' }, { key: 'select', label: 'Select' },
  ], { presets: ['default', 'swapAB'] }),
  n64: std('Nintendo 64', [
    { key: 'a', label: 'A' }, { key: 'b', label: 'B' },
    { key: 'l', label: 'L' }, { key: 'r', label: 'R' }, { key: 'l2', label: 'Z' },
    { key: 'x', label: 'C-Up' }, { key: 'y', label: 'C-Down' },
    { key: 'l3', label: 'C-Left' }, { key: 'r3', label: 'C-Right' },
    { key: 'start', label: 'Start' },
  ], { hasDeadzone: true, presets: ['default'] }),
  psx: std('PlayStation', [
    { key: 'x', label: 'Triangle' }, { key: 'a', label: 'Circle' },
    { key: 'b', label: 'Cross' }, { key: 'y', label: 'Square' },
    { key: 'l', label: 'L1' }, { key: 'r', label: 'R1' },
    { key: 'l2', label: 'L2' }, { key: 'r2', label: 'R2' },
    { key: 'start', label: 'Start' }, { key: 'select', label: 'Select' },
  ], { hasDeadzone: true, presets: ['default', 'swapAB', 'swapXY'] }),
  megadrive: std('Mega Drive / Genesis', [
    { key: 'y', label: 'A' }, { key: 'b', label: 'B' }, { key: 'a', label: 'C' },
    { key: 'l', label: 'X' }, { key: 'x', label: 'Y' }, { key: 'r', label: 'Z' },
    { key: 'start', label: 'Start' }, { key: 'select', label: 'Mode' },
  ], { presets: ['default'] }),
  mastersystem: std('Master System', [
    { key: 'b', label: 'Button 1' }, { key: 'a', label: 'Button 2' },
    { key: 'start', label: 'Pause' },
  ], { presets: ['default', 'swapAB'] }),
  'sg-1000': std('SG-1000', [
    { key: 'b', label: 'Button 1' }, { key: 'a', label: 'Button 2' },
  ], { presets: ['default', 'swapAB'] }),
  gamegear: std('Game Gear', [
    { key: 'b', label: 'Button 1' }, { key: 'a', label: 'Button 2' },
    { key: 'start', label: 'Start' },
  ], { presets: ['default', 'swapAB'] }),
  neogeo: std('Neo Geo', [
    { key: 'b', label: 'A' }, { key: 'a', label: 'B' },
    { key: 'y', label: 'C' }, { key: 'x', label: 'D' },
    { key: 'start', label: 'Start' }, { key: 'select', label: 'Select' },
  ], { presets: ['default'] }),
  ngp,
  ngpc: { ...ngp, label: 'Neo Geo Pocket Color' },
  pcengine: std('PC Engine / TurboGrafx-16', [
    { key: 'a', label: 'I' }, { key: 'b', label: 'II' },
    { key: 'start', label: 'Run' }, { key: 'select', label: 'Select' },
  ], { presets: ['default', 'swapAB'] }),
  arcade: std('Arcade', [
    { key: 'y', label: 'Button 1' }, { key: 'x', label: 'Button 2' }, { key: 'l', label: 'Button 3' },
    { key: 'b', label: 'Button 4' }, { key: 'a', label: 'Button 5' }, { key: 'r', label: 'Button 6' },
    { key: 'select', label: 'Coin' }, { key: 'start', label: 'Start' },
  ], { presets: ['default'] }),
  atari5200: std('Atari 5200', [
    { key: 'a', label: 'Fire 1' }, { key: 'b', label: 'Fire 2' },
    { key: 'start', label: 'Start' }, { key: 'select', label: 'Pause' }, { key: 'l3', label: 'Reset' },
    { key: 'keypad_1', label: 'Keypad 1' }, { key: 'keypad_2', label: 'Keypad 2' }, { key: 'keypad_3', label: 'Keypad 3' },
    { key: 'keypad_4', label: 'Keypad 4' }, { key: 'keypad_5', label: 'Keypad 5' }, { key: 'keypad_6', label: 'Keypad 6' },
    { key: 'keypad_7', label: 'Keypad 7' }, { key: 'keypad_8', label: 'Keypad 8' }, { key: 'keypad_9', label: 'Keypad 9' },
    { key: 'keypad_0', label: 'Keypad 0' }, { key: 'keypad_star', label: 'Keypad *' }, { key: 'keypad_hash', label: 'Keypad #' },
  ], { presets: ['default'] }),
  atari7800: std('Atari 7800', [
    { key: 'a', label: 'Fire 1' }, { key: 'b', label: 'Fire 2' },
    { key: 'start', label: 'Start' }, { key: 'select', label: 'Select' },
    { key: 'l3', label: 'Pause' }, { key: 'r3', label: 'Reset' },
  ], { presets: ['default', 'swapAB'] }),
  atarilynx: std('Atari Lynx', [
    { key: 'a', label: 'A' }, { key: 'b', label: 'B' },
    { key: 'l', label: 'Option 1' }, { key: 'r', label: 'Option 2' },
  ], { presets: ['default', 'swapAB'] }),
  vectrex: std('Vectrex', [
    { key: 'a', label: 'Button 1' }, { key: 'b', label: 'Button 2' },
    { key: 'x', label: 'Button 3' }, { key: 'y', label: 'Button 4' },
  ], { presets: ['default'] }),
}

// Order shown in the system picker rail.
export const SYSTEM_ORDER: string[] = [
  'nes', 'snes', 'megadrive', 'mastersystem', 'gb', 'gbc', 'gba', 'n64', 'psx',
  'fds', 'gamegear', 'neogeo', 'ngp', 'ngpc', 'pcengine', 'sg-1000', 'arcade',
  'atari5200', 'atari7800', 'atarilynx', 'vectrex',
]

// Hand-drawn SVG diagrams live in ../assets/controllers/<system>.svg. Globbed so
// the build never breaks when a file is missing — the UI just shows a placeholder
// and picks the diagram up the moment it's dropped in.
const diagramModules = import.meta.glob('../assets/controllers/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export function diagramFor(system: string): string | null {
  const match = Object.entries(diagramModules).find(([p]) => p.endsWith(`/${system}.svg`))
  return match ? match[1] : null
}
