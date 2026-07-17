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
