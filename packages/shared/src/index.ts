export type GameFilter = {
  systems?: string[]
  genres?: string[]
  players?: number
  yearRange?: [number, number]
  favoritesOnly?: boolean
  neverPlayed?: boolean
  query?: string
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
  rom_path: string
  box_art_path: string | null
  genre: string | null
  year: number | null
  players: number | null
  description: string | null
  play_count: number
  scraped_at: string | null
}

export interface PlaySession {
  id: number
  user_id: number
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

export interface GameWithSession extends Game {
  last_played?: string
  session_duration?: number
}
