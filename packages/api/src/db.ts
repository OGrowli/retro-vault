import Database, { type Database as DatabaseType } from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type { GameFilter } from '@retro-vault/shared'

const DATA_DIR = process.env['RETROVAULT_DATA_DIR'] ?? '/home/pi/.retrovault'
const DB_PATH = process.env['RETROVAULT_DB_PATH'] ?? path.join(DATA_DIR, 'retrovault.db')

fs.mkdirSync(path.join(DATA_DIR, 'media'), { recursive: true })

export const db: DatabaseType = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    avatar_color TEXT NOT NULL DEFAULT '#0070D1',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    system TEXT NOT NULL,
    name TEXT NOT NULL,
    rom_path TEXT NOT NULL UNIQUE,
    box_art_path TEXT,
    genre TEXT,
    year INTEGER,
    players INTEGER,
    description TEXT,
    play_count INTEGER NOT NULL DEFAULT 0,
    scraped_at TEXT
  );

  CREATE TABLE IF NOT EXISTS play_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    duration_seconds INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    UNIQUE(user_id, game_id)
  );

  CREATE TABLE IF NOT EXISTS filter_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filter_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_play_sessions_user ON play_sessions(user_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
  CREATE INDEX IF NOT EXISTS idx_games_system ON games(system);
`)

export interface FilterClause {
  where: string
  params: (string | number)[]
}

export function buildFilterClause(filter: GameFilter, userId?: number): FilterClause {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter.systems?.length) {
    conditions.push(`g.system IN (${filter.systems.map(() => '?').join(',')})`)
    params.push(...filter.systems)
  }

  if (filter.genres?.length) {
    conditions.push(`g.genre IN (${filter.genres.map(() => '?').join(',')})`)
    params.push(...filter.genres)
  }

  if (filter.players !== undefined) {
    conditions.push(`g.players = ?`)
    params.push(filter.players)
  }

  if (filter.yearRange) {
    conditions.push(`g.year BETWEEN ? AND ?`)
    params.push(filter.yearRange[0], filter.yearRange[1])
  }

  if (filter.query) {
    conditions.push(`g.name LIKE ?`)
    params.push(`%${filter.query}%`)
  }

  if (filter.favoritesOnly && userId !== undefined) {
    conditions.push(`EXISTS (SELECT 1 FROM favorites f WHERE f.game_id = g.id AND f.user_id = ?)`)
    params.push(userId)
  }

  if (filter.neverPlayed && userId !== undefined) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM play_sessions ps WHERE ps.game_id = g.id AND ps.user_id = ?)`)
    params.push(userId)
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

export function parseFilter(query: Record<string, string | string[]>): GameFilter {
  const filter: GameFilter = {}

  const systems = query['systems']
  if (systems) filter.systems = Array.isArray(systems) ? systems : systems.split(',').filter(Boolean)

  const genres = query['genres']
  if (genres) filter.genres = Array.isArray(genres) ? genres : genres.split(',').filter(Boolean)

  const players = query['players']
  if (players) filter.players = parseInt(players as string, 10)

  const yearRange = query['yearRange']
  if (yearRange) {
    const [from, to] = (yearRange as string).split(',').map(Number)
    if (!isNaN(from) && !isNaN(to)) filter.yearRange = [from, to]
  }

  if (query['favoritesOnly'] === 'true') filter.favoritesOnly = true
  if (query['neverPlayed'] === 'true') filter.neverPlayed = true

  const q = query['query']
  if (q) filter.query = q as string

  return filter
}
