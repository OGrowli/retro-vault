import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const DATA_DIR = process.env['RETROVAULT_DATA_DIR'] ?? '/tmp/retrovault-test'
const DB_PATH = process.env['RETROVAULT_DB_PATH'] ?? path.join(DATA_DIR, 'retrovault.db')
const MEDIA_DIR = path.join(DATA_DIR, 'media')

fs.mkdirSync(MEDIA_DIR, { recursive: true })

const db = new Database(DB_PATH)
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
  PRAGMA user_version = 2;
`)

// ── Placeholder box art ──────────────────────────────────────────────────────

const SYSTEM_COLORS: Record<string, [number, number, number]> = {
  nes:        [188,  40,  40],
  snes:       [106,  50, 168],
  n64:        [200, 100,  10],
  psx:        [ 20,  60, 160],
  gb:         [100, 140,  60],
  gbc:        [ 60, 160, 100],
  gba:        [160,  60, 120],
  megadrive:  [ 30,  30, 200],
  arcade:     [180,  30, 100],
}

async function makePlaceholderArt(system: string, gameId: number): Promise<string> {
  const [r, g, b] = SYSTEM_COLORS[system] ?? [80, 80, 80]
  const dir = path.join(MEDIA_DIR, system)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${gameId}.jpg`)
  await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r, g, b } },
  })
    .jpeg({ quality: 75 })
    .toFile(dest)
  return `/media/${system}/${gameId}.jpg`
}

// ── Seed data ────────────────────────────────────────────────────────────────

const USERS = [
  { username: 'Player1',   avatar_color: '#0070D1' },
  { username: 'Retronaut', avatar_color: '#e74c3c' },
  { username: 'GbaKing',   avatar_color: '#2ecc71' },
  { username: 'ArcadePro', avatar_color: '#f39c12' },
]

interface GameSeed {
  system: string
  name: string
  genre: string
  year: number
  players: number
  description: string
  roms: Array<{ region: string | null; revision: string | null; ext: string }>
}

const GAMES: GameSeed[] = [
  {
    system: 'nes', name: 'Super Mario Bros.', genre: 'Platform', year: 1985, players: 2,
    description: 'The iconic platformer that defined a generation.',
    roms: [{ region: 'USA', revision: null, ext: 'nes' }, { region: 'Europe', revision: null, ext: 'nes' }],
  },
  {
    system: 'nes', name: 'Mega Man 2', genre: 'Action', year: 1988, players: 1,
    description: 'The definitive Mega Man experience.',
    roms: [{ region: 'USA', revision: null, ext: 'nes' }],
  },
  {
    system: 'nes', name: 'Contra', genre: 'Run & Gun', year: 1987, players: 2,
    description: 'Legendary co-op run and gun action.',
    roms: [{ region: 'USA', revision: null, ext: 'nes' }, { region: 'Japan', revision: null, ext: 'nes' }],
  },
  {
    system: 'nes', name: 'The Legend of Zelda', genre: 'Adventure', year: 1986, players: 1,
    description: 'Link sets out to rescue Princess Zelda.',
    roms: [{ region: 'USA', revision: 'Rev 1', ext: 'nes' }, { region: 'USA', revision: null, ext: 'nes' }],
  },
  {
    system: 'snes', name: 'Super Mario World', genre: 'Platform', year: 1990, players: 2,
    description: 'Mario explores Dinosaur Land.',
    roms: [{ region: 'USA', revision: null, ext: 'sfc' }, { region: 'Europe', revision: null, ext: 'sfc' }],
  },
  {
    system: 'snes', name: 'Super Metroid', genre: 'Action', year: 1994, players: 1,
    description: 'The pinnacle of the Metroid series.',
    roms: [{ region: 'USA', revision: null, ext: 'smc' }],
  },
  {
    system: 'snes', name: 'Chrono Trigger', genre: 'RPG', year: 1995, players: 1,
    description: 'A time-traveling RPG masterpiece.',
    roms: [{ region: 'USA', revision: null, ext: 'smc' }],
  },
  {
    system: 'snes', name: 'Street Fighter II', genre: 'Fighting', year: 1992, players: 2,
    description: 'The fighting game that changed everything.',
    roms: [{ region: 'USA', revision: null, ext: 'sfc' }, { region: 'Europe', revision: null, ext: 'sfc' }],
  },
  {
    system: 'snes', name: 'The Legend of Zelda: A Link to the Past', genre: 'Adventure', year: 1991, players: 1,
    description: 'The gold standard of top-down Zelda.',
    roms: [{ region: 'USA', revision: null, ext: 'smc' }],
  },
  {
    system: 'n64', name: 'Super Mario 64', genre: 'Platform', year: 1996, players: 1,
    description: 'Defined 3D platforming for a generation.',
    roms: [{ region: 'USA', revision: null, ext: 'z64' }],
  },
  {
    system: 'n64', name: 'The Legend of Zelda: Ocarina of Time', genre: 'Adventure', year: 1998, players: 1,
    description: 'Widely considered the greatest game ever made.',
    roms: [{ region: 'USA', revision: '1.0', ext: 'z64' }, { region: 'USA', revision: '1.2', ext: 'z64' }],
  },
  {
    system: 'n64', name: 'GoldenEye 007', genre: 'Shooter', year: 1997, players: 4,
    description: 'The multiplayer FPS that ruined friendships.',
    roms: [{ region: 'USA', revision: null, ext: 'z64' }],
  },
  {
    system: 'psx', name: 'Crash Bandicoot', genre: 'Platform', year: 1996, players: 1,
    description: "The PlayStation's unofficial mascot.",
    roms: [{ region: 'USA', revision: null, ext: 'bin' }],
  },
  {
    system: 'psx', name: 'Final Fantasy VII', genre: 'RPG', year: 1997, players: 1,
    description: 'Cloud, Sephiroth, and Aerith forever.',
    roms: [{ region: 'USA', revision: null, ext: 'bin' }],
  },
  {
    system: 'psx', name: 'Metal Gear Solid', genre: 'Stealth', year: 1998, players: 1,
    description: 'Tactical espionage action.',
    roms: [{ region: 'USA', revision: null, ext: 'bin' }, { region: 'Europe', revision: null, ext: 'bin' }],
  },
  {
    system: 'gba', name: 'Metroid Fusion', genre: 'Action', year: 2002, players: 1,
    description: 'Samus vs. the X Parasite.',
    roms: [{ region: 'USA', revision: null, ext: 'gba' }],
  },
  {
    system: 'gba', name: 'Fire Emblem', genre: 'Strategy', year: 2003, players: 1,
    description: 'Permadeath tactical RPG that hooked the west.',
    roms: [{ region: 'USA', revision: null, ext: 'gba' }],
  },
  {
    system: 'gba', name: 'Pokemon FireRed', genre: 'RPG', year: 2004, players: 2,
    description: 'Kanto remade for the GBA.',
    roms: [{ region: 'USA', revision: 'Rev 1', ext: 'gba' }],
  },
  {
    system: 'megadrive', name: 'Sonic the Hedgehog 2', genre: 'Platform', year: 1992, players: 2,
    description: 'Blast through Chemical Plant Zone.',
    roms: [{ region: 'USA', revision: null, ext: 'md' }, { region: 'Europe', revision: null, ext: 'md' }],
  },
  {
    system: 'megadrive', name: 'Streets of Rage 2', genre: 'Beat \'em up', year: 1992, players: 2,
    description: "The best beat 'em up on any system.",
    roms: [{ region: 'USA', revision: null, ext: 'md' }],
  },
  {
    system: 'arcade', name: 'Pac-Man', genre: 'Maze', year: 1980, players: 2,
    description: 'Chomp dots, dodge ghosts.',
    roms: [{ region: null, revision: null, ext: 'zip' }],
  },
  {
    system: 'arcade', name: 'Street Fighter II CE', genre: 'Fighting', year: 1992, players: 2,
    description: 'The original tournament fighter.',
    roms: [{ region: null, revision: null, ext: 'zip' }],
  },
  {
    system: 'arcade', name: 'Metal Slug', genre: 'Run & Gun', year: 1996, players: 2,
    description: 'Beautiful sprite-work run and gun.',
    roms: [{ region: null, revision: null, ext: 'zip' }],
  },
]

// ── Insert ───────────────────────────────────────────────────────────────────

db.exec('DELETE FROM play_sessions; DELETE FROM favorites; DELETE FROM roms; DELETE FROM games; DELETE FROM users;')

console.log('Seeding users...')
const insertUser = db.prepare('INSERT INTO users (username, avatar_color) VALUES (?, ?)')
const userIds: number[] = []
for (const u of USERS) {
  const r = insertUser.run(u.username, u.avatar_color)
  userIds.push(r.lastInsertRowid as number)
}

console.log(`Seeding ${GAMES.length} games + placeholder art...`)
const insertGame = db.prepare(`
  INSERT INTO games (system, name, genre, year, players, description, box_art_path, scraped_at)
  VALUES (@system, @name, @genre, @year, @players, @description, @box_art_path, datetime('now'))
`)
const insertRom = db.prepare(`
  INSERT INTO roms (game_id, system, rom_path, region, revision, full_name)
  VALUES (@game_id, @system, @rom_path, @region, @revision, @full_name)
`)

interface GameRow { id: number }
const gameIds: number[] = []
const romIdsByGame: Record<number, number[]> = {}

for (const g of GAMES) {
  const slug = g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const gameResult = insertGame.run({
    system: g.system,
    name: g.name,
    genre: g.genre,
    year: g.year,
    players: g.players,
    description: g.description,
    box_art_path: null,
  })
  const gameId = gameResult.lastInsertRowid as number
  gameIds.push(gameId)
  romIdsByGame[gameId] = []

  for (const rom of g.roms) {
    const regionTag = rom.region ? ` (${rom.region})` : ''
    const revTag = rom.revision ? ` (${rom.revision})` : ''
    const full_name = `${g.name}${regionTag}${revTag}`
    const rom_path = `/home/pi/RetroPie/roms/${g.system}/${slug}${regionTag}${revTag}.${rom.ext}`
    const romResult = insertRom.run({
      game_id: gameId,
      system: g.system,
      rom_path,
      region: rom.region,
      revision: rom.revision,
      full_name,
    })
    romIdsByGame[gameId].push(romResult.lastInsertRowid as number)
  }
}

// Generate placeholder art after we have game IDs
console.log('Generating placeholder art...')
const updateBoxArt = db.prepare('UPDATE games SET box_art_path = ? WHERE id = ?')
for (const gameId of gameIds) {
  const game = db.prepare('SELECT system FROM games WHERE id = ?').get(gameId) as GameRow & { system: string }
  const artPath = await makePlaceholderArt(game.system, gameId)
  updateBoxArt.run(artPath, gameId)
}

console.log('Seeding play sessions...')
const insertSession = db.prepare(`
  INSERT INTO play_sessions (user_id, rom_id, game_id, started_at, duration_seconds)
  VALUES (?, ?, ?, ?, ?)
`)

const now = Date.now()
for (const userId of userIds) {
  const shuffled = [...gameIds].sort(() => Math.random() - 0.5).slice(0, 8)
  shuffled.forEach((gameId, i) => {
    const romIds = romIdsByGame[gameId] ?? []
    if (!romIds.length) return
    const romId = romIds[Math.floor(Math.random() * romIds.length)]
    const ago = (8 - i) * 2 * 24 * 60 * 60 * 1000
    const started = new Date(now - ago - Math.random() * 3600000).toISOString()
    const duration = i < 2 ? Math.floor(Math.random() * 240) : Math.floor(Math.random() * 3600) + 300
    insertSession.run(userId, romId, gameId, started, duration)
  })
}

console.log('Seeding favorites...')
const insertFav = db.prepare('INSERT OR IGNORE INTO favorites (user_id, game_id) VALUES (?, ?)')
for (const userId of userIds) {
  const picks = [...gameIds].sort(() => Math.random() - 0.5).slice(0, 6)
  for (const gameId of picks) insertFav.run(userId, gameId)
}

db.close()
console.log(`\nSeed complete.`)
console.log(`  DB:    ${DB_PATH}`)
console.log(`  Media: ${MEDIA_DIR}`)
console.log(`  Users: ${USERS.length}  Games: ${GAMES.length}`)
