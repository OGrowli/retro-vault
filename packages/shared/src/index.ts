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

// Single global audio config applied to every launch. Mirrors RetroArch's
// Audio settings menu — each field maps onto a retroarch.cfg audio_* key,
// written to an override cfg the emulator reads via --appendconfig. Undefined
// fields fall back to RetroArch's own defaults (shown below).
export interface AudioConfig {
  /** audio_enable — master audio on/off (default true) */
  enabled?: boolean
  /** audio_mute_enable — silences all output (default false) */
  muted?: boolean
  /** audio_volume — global gain in dB, 0 = unity (default 0.0) */
  volumeDb?: number
  /** audio_driver — e.g. 'alsathread', 'alsa', 'pulse' (default auto) */
  driver?: string
  /** audio_latency — output buffer size in ms (default 64) */
  latencyMs?: number
  /** audio_out_rate — output sample rate in Hz (default 48000) */
  outputRate?: number
  /** audio_resampler — 'sinc' | 'cc' | 'nearest' (default 'sinc') */
  resampler?: string
  /** audio_resampler_quality — 0 Don't Care … 5 Highest */
  resamplerQuality?: number
  /** audio_sync — sync emulation to the audio clock (default true) */
  sync?: boolean
  /** audio_max_timing_skew — max resample ratio deviation, 0.0–0.5 (default 0.05) */
  maxTimingSkew?: number
  /** audio_rate_control_delta — dynamic rate control range, 0 disables (default 0.005) */
  rateControlDelta?: number
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
