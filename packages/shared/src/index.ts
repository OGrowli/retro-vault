export type GameFilter = {
  systems?: string[]
  genres?: string[]
  players?: number
  yearRange?: [number, number]
  favoritesOnly?: boolean
  neverPlayed?: boolean
  noMetadata?: boolean
  query?: string
  userId?: string
}

export interface User {
  id: number
  username: string
  avatar_color: string
  created_at: string
}

export interface Game {
  id: number
  system: string
  name: string
  genre: string | null
  year: number | null
  players: number | null
  description: string | null
  box_art_path: string | null
  scraped_at: string | null
  rom_count?: number
}

export interface Rom {
  id: number
  game_id: number
  system: string
  rom_path: string
  region: string | null
  revision: string | null
  full_name: string
  play_count?: number
  last_played?: string | null
}

export interface PlaySession {
  id: number
  user_id: number
  rom_id: number
  game_id: number
  started_at: string
  duration_seconds: number
}

export interface Favorite {
  id: number
  user_id: number
  game_id: number
}

export interface FilterPreset {
  id: number
  user_id: number
  name: string
  filter_json: string
}

export interface GameList {
  id: number
  user_id: number
  name: string
  created_at: string
  game_count: number
  /** Present when the list query is scoped to a specific game (add-to-list modal) */
  included?: boolean
}

// Per-user home screen layout prefs. Recently Played and All Games are always
// shown; everything else (Favorites, custom lists) can be hidden. Stored keys
// match the home rail region keys: 'favorites', 'list-<id>'.
export interface HomePrefs {
  hiddenKeys: string[]
}

// A selectable collection in the full-screen list view. Games are preloaded so
// the dropdown can switch between lists without a round-trip.
export interface ListSource {
  key: string
  label: string
  games: Game[]
}

// Per-system controller remap. `bindings` maps a RetroArch input suffix
// (e.g. 'a', 'b', 'start', 'l2') to the RAW joypad button index captured live
// from the Gamepad API — indices vary by controller/driver, never hardcoded.
export interface ControllerConfig {
  bindings: Record<string, number>
  /** 0..1 analog deadzone, for systems with an analog stick (n64, psx) */
  deadzone?: number
}

// Single global hotkey config applied to every launch. Each value is a raw
// joypad button index; fastForwardRatio is a plain speed multiplier.
export interface HotkeyConfig {
  enableHotkey?: number
  saveState?: number
  loadState?: number
  slotIncrease?: number
  slotDecrease?: number
  fastForward?: number
  reset?: number
  fastForwardRatio?: number
}

export interface GameWithRoms extends Game {
  roms: Rom[]
  total_play_count: number
  last_played: string | null
}

export interface HistoryEntry {
  session_id: number
  started_at: string
  duration_seconds: number
  rom_id: number
  rom_full_name: string
  rom_region: string | null
  rom_revision: string | null
  id: number
  name: string
  system: string
  genre: string | null
  year: number | null
  players: number | null
  description: string | null
  box_art_path: string | null
  scraped_at: string | null
}

export interface SessionWithRom {
  id: number
  started_at: string
  duration_seconds: number
  user_id: number
  rom_id: number
  rom_full_name: string
  rom_region: string | null
  rom_revision: string | null
  username: string
  avatar_color: string
}
