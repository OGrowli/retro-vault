export type GameFilter = {
  systems?: string[]
  genres?: string[]
  players?: number
  yearRange?: [number, number]
  favoritesOnly?: boolean
  neverPlayed?: boolean
  noMetadata?: boolean
  /** Only games that have at least one matched ROM hack. */
  hasHacks?: boolean
  query?: string
  userId?: string
  /** Scope results to a premade list — search & random operate within it. */
  listId?: number
  /** Include adult-flagged games. Off by default → they're hidden from the
   *  grid, search, and random unless the user explicitly opts in. */
  includeAdult?: boolean
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

// Variant classification derived from a ROM's filename tags. 'official' is the
// default; the rest flag non-original dumps (fan translations, ROM hacks, etc.).
export type RomKind = 'official' | 'translation' | 'hack' | 'prototype' | 'homebrew'

export interface Rom {
  id: number
  game_id: number
  system: string
  rom_path: string
  region: string | null
  revision: string | null
  full_name: string
  kind: RomKind
  play_count?: number
  last_played?: string | null
}

// A ROM hack / translation catalogued from the ROMhacking.net dump, matched to
// a base game. Separate from the games/roms pipeline.
export interface RomHack {
  id: number
  hack_key: string
  rhdn_id: number | null
  kind: 'hack' | 'translation'
  system: string
  title: string
  author: string | null
  patch_format: 'ips' | 'bps' | 'ups' | null
  patch_path: string | null
  source_crc: string | null
  game_id: number | null
  match_confidence: 'exact' | 'canonical' | 'fuzzy' | 'manual' | null
  // From the RHDN database dump. description is pre-flattened and truncated by
  // the API (tags stripped, whitespace collapsed) — display text, not source.
  version?: string | null
  released?: string | null
  downloads?: number
  language?: string | null
  description?: string | null
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
  /** Bumped when the list is opened in List View or a game is added to it. */
  last_viewed_at: string
  game_count: number
  /** Present when the list query is scoped to a specific game (add-to-list modal) */
  included?: boolean
}

// How the user's lists are ordered (add-to-list menus, list switcher, home rails).
export type ListOrder = 'recent' | 'created' | 'name' | 'size'
// How games inside a list / Favorites are ordered.
export type GameSort = 'recent' | 'name' | 'year' | 'added' | 'system'

export const DEFAULT_LIST_ORDER: ListOrder = 'recent'
export const DEFAULT_GAME_SORT: GameSort = 'recent'

// Per-user home screen layout prefs. Recently Played and All Games are always
// shown; everything else (Favorites, custom lists) can be hidden. Stored keys
// match the home rail region keys: 'favorites', 'list-<id>'.
export interface HomePrefs {
  hiddenKeys: string[]
  /** Order of the lists themselves. Defaults to DEFAULT_LIST_ORDER. */
  listOrder?: ListOrder
  /** Order of games within a list / Favorites. Defaults to DEFAULT_GAME_SORT. */
  gameSort?: GameSort
  /** Reveal adult-flagged titles in the grid, search, and random. Default false. */
  showAdult?: boolean
}

// A selectable collection in the full-screen list view. Games are preloaded so
// the dropdown can switch between lists without a round-trip.
export interface ListSource {
  key: string
  label: string
  games: Game[]
}

// --- ROM collection audit (checksum vs No-Intro DATs) ---

export type AuditStrategy = 'crc' | 'name'

// One title in a DAT the user is missing, or an owned ROM not in any DAT.
export interface AuditEntry {
  name: string
  region: string | null
}

export interface AuditSystemSummary {
  system: string
  displayName: string
  family: string          // 'no-intro' | 'redump' | 'mame'
  strategy: AuditStrategy  // 'crc' (exact) | 'name' (approximate)
  total: number            // entries in the DAT
  have: number             // DAT entries owned
  missingCount: number
  unknownCount: number     // owned ROMs not in the DAT
  ran_at: string
}

export interface AuditSystemReport extends AuditSystemSummary {
  missing: AuditEntry[]
  unknown: AuditEntry[]
}

export interface AuditStatus {
  running: boolean
  done: number
  total: number
  currentSystem: string | null
  currentFile: string | null
  error?: string
}

// Per-system controller remap. `bindings` maps a RetroArch input suffix
// (e.g. 'a', 'b', 'start', 'l2') to the RAW joypad button index captured live
// from the Gamepad API — indices vary by controller/driver, never hardcoded.
export interface ControllerConfig {
  bindings: Record<string, number>
  /** 0..1 analog deadzone, for systems with an analog stick (n64, psx) */
  deadzone?: number
  /**
   * libretro port-1 device id, written as input_libretro_device_p1. Only used by
   * systems whose core exposes multiple pad modes — e.g. bluemsx (MSX): 1 =
   * Joystick, 513 = RetroPad Keyboard Map (D-pad→arrows, A=Enter, B=Space),
   * 3 = Keyboard. Undefined leaves the core default.
   */
  device?: number
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

// A Wi-Fi network as seen by a scan. `security` is null for open networks;
// `saved` means a NetworkManager profile already exists (connects without a
// password prompt). `signal` is 0–100.
export interface WifiNetwork {
  ssid: string
  signal: number
  security: string | null
  active: boolean
  saved: boolean
}

// Current Wi-Fi connection state for the header of the settings panel.
export interface WifiStatus {
  enabled: boolean
  connected: boolean
  ssid: string | null
  ip: string | null
}

export interface GameWithRoms extends Game {
  roms: Rom[]
  total_play_count: number
  last_played: string | null
  /** Hacks + translations matched to this game — what the Hacks panel lists. */
  hack_count: number
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
