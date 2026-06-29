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

// ── Palette for placeholder box art ─────────────────────────────────────────

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

async function makePlaceholderArt(system: string, slug: string): Promise<string | null> {
  const [r, g, b] = SYSTEM_COLORS[system] ?? [80, 80, 80]
  const dir = path.join(MEDIA_DIR, system)
  fs.mkdirSync(dir, { recursive: true })
  const filename = `${slug}.jpg`
  const dest = path.join(dir, filename)
  await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r, g, b } },
  })
    .jpeg({ quality: 75 })
    .toFile(dest)
  return `/media/${system}/${filename}`
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
}

const GAMES: GameSeed[] = [
  // NES
  { system: 'nes', name: 'Super Mario Bros.',       genre: 'Platform',   year: 1985, players: 2, description: 'The iconic platformer that defined a generation.' },
  { system: 'nes', name: 'Mega Man 2',              genre: 'Action',     year: 1988, players: 1, description: 'The definitive Mega Man experience.' },
  { system: 'nes', name: 'Contra',                  genre: 'Run & Gun',  year: 1987, players: 2, description: 'Legendary co-op run and gun action.' },
  { system: 'nes', name: 'Castlevania',             genre: 'Action',     year: 1986, players: 1, description: 'Hunt Dracula through his cursed castle.' },
  { system: 'nes', name: 'Metroid',                 genre: 'Action',     year: 1986, players: 1, description: 'Explore the alien world of Zebes.' },
  { system: 'nes', name: 'The Legend of Zelda',     genre: 'Adventure',  year: 1986, players: 1, description: 'Link sets out to rescue Princess Zelda.' },
  // SNES
  { system: 'snes', name: 'Super Mario World',      genre: 'Platform',   year: 1990, players: 2, description: 'Mario explores Dinosaur Land.' },
  { system: 'snes', name: 'Super Metroid',          genre: 'Action',     year: 1994, players: 1, description: 'The pinnacle of the Metroid series.' },
  { system: 'snes', name: 'Chrono Trigger',         genre: 'RPG',        year: 1995, players: 1, description: 'A time-traveling RPG masterpiece.' },
  { system: 'snes', name: 'Street Fighter II',      genre: 'Fighting',   year: 1992, players: 2, description: 'The fighting game that changed everything.' },
  { system: 'snes', name: 'Donkey Kong Country',    genre: 'Platform',   year: 1994, players: 2, description: 'Stunning pre-rendered visuals, tight platforming.' },
  { system: 'snes', name: 'Final Fantasy VI',       genre: 'RPG',        year: 1994, players: 1, description: 'An operatic masterpiece of storytelling.' },
  { system: 'snes', name: 'The Legend of Zelda: A Link to the Past', genre: 'Adventure', year: 1991, players: 1, description: 'The gold standard of top-down Zelda.' },
  // N64
  { system: 'n64', name: 'Super Mario 64',          genre: 'Platform',   year: 1996, players: 1, description: 'Defined 3D platforming for a generation.' },
  { system: 'n64', name: 'The Legend of Zelda: Ocarina of Time', genre: 'Adventure', year: 1998, players: 1, description: 'Widely considered the greatest game ever made.' },
  { system: 'n64', name: 'GoldenEye 007',           genre: 'Shooter',    year: 1997, players: 4, description: 'The multiplayer FPS that ruined friendships.' },
  { system: 'n64', name: 'Mario Kart 64',           genre: 'Racing',     year: 1996, players: 4, description: 'Four-player chaos on Rainbow Road.' },
  { system: 'n64', name: 'Banjo-Kazooie',           genre: 'Platform',   year: 1998, players: 1, description: 'Rare\'s answer to Super Mario 64.' },
  // PSX
  { system: 'psx', name: 'Crash Bandicoot',         genre: 'Platform',   year: 1996, players: 1, description: 'The PlayStation\'s unofficial mascot.' },
  { system: 'psx', name: 'Final Fantasy VII',       genre: 'RPG',        year: 1997, players: 1, description: 'Cloud, Sephiroth, and Aerith forever.' },
  { system: 'psx', name: 'Metal Gear Solid',        genre: 'Stealth',    year: 1998, players: 1, description: 'Tactical espionage action.' },
  { system: 'psx', name: 'Castlevania: SOTN',       genre: 'Action',     year: 1997, players: 1, description: 'What is a man? The metroidvania blueprint.' },
  { system: 'psx', name: 'Spyro the Dragon',        genre: 'Platform',   year: 1998, players: 1, description: 'Glide through colourful dragon worlds.' },
  { system: 'psx', name: 'Tony Hawk\'s Pro Skater', genre: 'Sports',     year: 1999, players: 2, description: 'Two-minute combo chasing perfection.' },
  // GBA
  { system: 'gba', name: 'Metroid Fusion',          genre: 'Action',     year: 2002, players: 1, description: 'Samus vs. the X Parasite.' },
  { system: 'gba', name: 'Fire Emblem',             genre: 'Strategy',   year: 2003, players: 1, description: 'Permadeath tactical RPG that hooked the west.' },
  { system: 'gba', name: 'Pokemon FireRed',         genre: 'RPG',        year: 2004, players: 2, description: 'Kanto remade for the GBA.' },
  { system: 'gba', name: 'Castlevania: Aria of Sorrow', genre: 'Action', year: 2003, players: 1, description: 'Soul-collecting Belmont adventure.' },
  { system: 'gba', name: 'Advance Wars',            genre: 'Strategy',   year: 2001, players: 4, description: 'Turn-based warfare done brilliantly.' },
  // Mega Drive
  { system: 'megadrive', name: 'Sonic the Hedgehog 2', genre: 'Platform', year: 1992, players: 2, description: 'Blast through Chemical Plant Zone.' },
  { system: 'megadrive', name: 'Streets of Rage 2',    genre: 'Beat \'em up', year: 1992, players: 2, description: 'The best beat \'em up on any system.' },
  { system: 'megadrive', name: 'Gunstar Heroes',        genre: 'Run & Gun', year: 1993, players: 2, description: 'Treasure\'s frenetic debut.' },
  { system: 'megadrive', name: 'Phantasy Star IV',      genre: 'RPG',      year: 1993, players: 1, description: 'Epic sci-fi RPG finale.' },
  // Arcade
  { system: 'arcade', name: 'Pac-Man',             genre: 'Maze',       year: 1980, players: 2, description: 'Chomp dots, dodge ghosts.' },
  { system: 'arcade', name: 'Street Fighter II CE',genre: 'Fighting',   year: 1992, players: 2, description: 'The original tournament fighter.' },
  { system: 'arcade', name: 'Metal Slug',          genre: 'Run & Gun',  year: 1996, players: 2, description: 'Beautiful sprite-work run and gun.' },
  { system: 'arcade', name: 'Mortal Kombat II',    genre: 'Fighting',   year: 1993, players: 2, description: 'Fatality.' },
]

// ── Insert ───────────────────────────────────────────────────────────────────

db.exec('DELETE FROM play_sessions; DELETE FROM favorites; DELETE FROM games; DELETE FROM users;')

console.log('Seeding users...')
const insertUser = db.prepare('INSERT INTO users (username, avatar_color) VALUES (?, ?)')
const userIds: number[] = []
for (const u of USERS) {
  const r = insertUser.run(u.username, u.avatar_color)
  userIds.push(r.lastInsertRowid as number)
}

console.log(`Seeding ${GAMES.length} games + placeholder art...`)
const insertGame = db.prepare(`
  INSERT INTO games (system, name, rom_path, box_art_path, genre, year, players, description, play_count, scraped_at)
  VALUES (@system, @name, @rom_path, @box_art_path, @genre, @year, @players, @description, @play_count, datetime('now'))
`)

const gameIds: number[] = []
for (const g of GAMES) {
  const slug = g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const boxArtPath = await makePlaceholderArt(g.system, slug)
  const r = insertGame.run({
    system: g.system,
    name: g.name,
    rom_path: `/home/pi/RetroPie/roms/${g.system}/${slug}.zip`,
    box_art_path: boxArtPath,
    genre: g.genre,
    year: g.year,
    players: g.players,
    description: g.description,
    play_count: Math.floor(Math.random() * 30),
  })
  gameIds.push(r.lastInsertRowid as number)
}

console.log('Seeding play sessions...')
const insertSession = db.prepare(`
  INSERT INTO play_sessions (user_id, game_id, started_at, duration_seconds)
  VALUES (?, ?, ?, ?)
`)

// Each user gets 8 recent sessions on random games
const now = Date.now()
for (const userId of userIds) {
  const shuffled = [...gameIds].sort(() => Math.random() - 0.5).slice(0, 8)
  shuffled.forEach((gameId, i) => {
    const ago = (8 - i) * 2 * 24 * 60 * 60 * 1000 // spread over last 16 days
    const started = new Date(now - ago - Math.random() * 3600000).toISOString()
    // Some sessions under 5 min to trigger "Continue" label
    const duration = i < 2 ? Math.floor(Math.random() * 240) : Math.floor(Math.random() * 3600) + 300
    insertSession.run(userId, gameId, started, duration)
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
