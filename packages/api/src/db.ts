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

// Migrate from schema v1 (single games table with rom_path) to v2
const { user_version: schemaVersion } = db.prepare('PRAGMA user_version').get() as { user_version: number }
if (schemaVersion < 2) {
  db.exec(`
    DROP TABLE IF EXISTS play_sessions;
    DROP TABLE IF EXISTS favorites;
    DROP TABLE IF EXISTS filter_presets;
    DROP TABLE IF EXISTS roms;
    DROP TABLE IF EXISTS games;
  `)
}

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
    genre TEXT,
    year INTEGER,
    players INTEGER,
    description TEXT,
    box_art_path TEXT,
    scraped_at TEXT,
    UNIQUE(name, system)
  );

  CREATE TABLE IF NOT EXISTS roms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    system TEXT NOT NULL,
    rom_path TEXT NOT NULL UNIQUE,
    region TEXT,
    revision TEXT,
    full_name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS play_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rom_id INTEGER NOT NULL REFERENCES roms(id) ON DELETE CASCADE,
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

  CREATE INDEX IF NOT EXISTS idx_roms_game ON roms(game_id);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_user ON play_sessions(user_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_rom ON play_sessions(rom_id);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_game ON play_sessions(game_id);
  CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
  CREATE INDEX IF NOT EXISTS idx_games_system ON games(system);
`)

if (schemaVersion < 2) {
  db.exec('PRAGMA user_version = 2')
}

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

  if (filter.noMetadata) {
    conditions.push(`g.scraped_at IS NULL`)
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
  if (query['noMetadata'] === 'true') filter.noMetadata = true

  const q = query['query']
  if (q) filter.query = q as string

  const userId = query['userId']
  if (userId) filter.userId = userId as string

  return filter
}
