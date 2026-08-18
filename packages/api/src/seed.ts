/**
 * Dev seed. Wipes the DB, lets db.ts rebuild the canonical schema, then fills it
 * with data chosen so every element of the Game Detail screen has something to
 * render: each ROM kind badge, each region flag, the mixed official/hack
 * subheaders, the no-ROM and no-art empty states, per-ROM play counts, the
 * Continue-from-save-state dialog, lists for Add to List, and matched ROM hacks.
 *
 * Also writes dummy ROM files under ~/.retrovault/roms so launch and save-state
 * detection hit real paths on a dev machine instead of /home/pi/...
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type { RomKind } from '@retro-vault/shared'

const DATA_DIR = process.env['RETROVAULT_DATA_DIR'] ?? path.join(os.homedir(), '.retrovault')
const DB_PATH = process.env['RETROVAULT_DB_PATH'] ?? path.join(DATA_DIR, 'retrovault.db')
const MEDIA_DIR = path.join(DATA_DIR, 'media')
// Dummy ROM files live here so the API's fs.existsSync checks pass in dev.
const ROMS_DIR = process.env['RETROVAULT_SEED_ROMS_DIR'] ?? path.join(DATA_DIR, 'roms')

fs.mkdirSync(MEDIA_DIR, { recursive: true })
fs.mkdirSync(ROMS_DIR, { recursive: true })

// ── Wipe ─────────────────────────────────────────────────────────────────────
// Drop every table and reset user_version, then let db.ts create the schema. The
// seed deliberately does not carry its own CREATE TABLE statements — that copy
// always drifted from db.ts (it predates lists, rom_hacks, roms.kind, …).

{
  const raw = new Database(DB_PATH)
  raw.pragma('foreign_keys = OFF')
  const tables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>
  for (const t of tables) raw.exec(`DROP TABLE IF EXISTS "${t.name}"`)
  raw.pragma('user_version = 0')
  raw.close()
  console.log(`Dropped ${tables.length} table(s) — rebuilding schema from db.ts`)
}

// Imported after the wipe so its CREATE TABLE / migration path runs on a blank DB.
const { db, nameKey } = await import('./db.js')

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

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Greedy wrap so long titles stay inside the 300px artwork.
function wrap(title: string, maxChars: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of title.split(/\s+/)) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= maxChars) line += ' ' + word
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines.slice(0, 5)
}

/**
 * Writes `<id>.jpg` (box art, 3:4 like the detail screen's w-60 h-80 frame) and
 * `<id>-bg.jpg`, the tiny pre-blurred variant the UI derives via bgVariant().
 * Text rendering needs librsvg with font support; falls back to a flat tile.
 */
async function makeArt(system: string, gameId: number, title: string): Promise<string> {
  const [r, g, b] = SYSTEM_COLORS[system] ?? [80, 80, 80]
  const dir = path.join(MEDIA_DIR, system)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${gameId}.jpg`)

  const lines = wrap(title, 14)
  const startY = 200 - (lines.length - 1) * 16
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">
    <rect width="300" height="400" fill="rgb(${r},${g},${b})"/>
    <rect x="10" y="10" width="280" height="380" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="3"/>
    <rect x="0" y="330" width="300" height="70" fill="rgba(0,0,0,0.35)"/>
    <text x="150" y="368" font-family="sans-serif" font-size="20" font-weight="bold"
      fill="rgba(255,255,255,0.85)" text-anchor="middle">${escapeXml(system.toUpperCase())}</text>
    ${lines.map((l, i) => `<text x="150" y="${startY + i * 32}" font-family="sans-serif" font-size="26"
      font-weight="bold" fill="white" text-anchor="middle">${escapeXml(l)}</text>`).join('\n')}
  </svg>`

  let buf: Buffer
  try {
    buf = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer()
  } catch {
    buf = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r, g, b } } })
      .jpeg({ quality: 75 })
      .toBuffer()
  }
  await fs.promises.writeFile(dest, buf)

  // Same recipe as the scraper: downscale + blur; the fullscreen upscale is the blur.
  await sharp(buf)
    .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
    .blur(3)
    .jpeg({ quality: 60 })
    .toFile(path.join(dir, `${gameId}-bg.jpg`))

  return `/media/${system}/${gameId}.jpg`
}

// ── Seed data ────────────────────────────────────────────────────────────────

const USERS = [
  { username: 'Player1',   avatar_color: '#0070D1' },
  { username: 'Retronaut', avatar_color: '#e74c3c' },
  { username: 'GbaKing',   avatar_color: '#2ecc71' },
  { username: 'ArcadePro', avatar_color: '#f39c12' },
]

interface RomSeed {
  region: string | null
  revision: string | null
  ext: string
  /** Drives the badge + grouping on the detail screen. Defaults to 'official'. */
  kind?: RomKind
  /** Ranks first in the version list (see routes/games.ts ordering). */
  curated?: boolean
  /** Play sessions to generate for this exact ROM (per-ROM "N× played"). */
  plays?: number
  /** Writes a .state.auto next to the file → launch offers Continue / New Game. */
  saveState?: boolean
}

interface HackSeed {
  title: string
  author: string | null
  kind: 'hack' | 'translation'
  patch_format: 'ips' | 'bps' | 'ups' | null
  match_confidence: 'exact' | 'fuzzy' | 'manual' | null
}

interface GameSeed {
  system: string
  name: string
  genre?: string | null
  year?: number | null
  players?: number | null
  description?: string | null
  /** Leaves box_art_path NULL → detail screen shows the gamepad placeholder. */
  noArt?: boolean
  /** Leaves scraped_at NULL → no "Scraped" dot, and the detail auto-scrape fires. */
  unscraped?: boolean
  adult?: boolean
  roms: RomSeed[]
  hacks?: HackSeed[]
  /** Favorited by every user, so the action row reads "Unfavorite". */
  favorite?: boolean
}

const LONG_DESC =
  'Hyrule lies fractured beneath a sky that has not cleared in a hundred years. ' +
  'A boy wakes in a farmhouse on the edge of the Kokiri wood with no memory of the ' +
  'night before, only a wooden sword, a cracked shield, and the certainty that ' +
  'something in the castle town has gone badly wrong. What follows is a sprawling ' +
  'quest across seven dungeons, a dozen villages, and two eras of the same broken ' +
  'kingdom — pulling every thread the series had spun to that point into one long, ' +
  'deliberate journey. This description is intentionally long so the detail screen ' +
  'clamps it to three lines and the Expand / Collapse action has something to do.'

// Titles engineered per UI state. Everything below the SHOWCASE block is
// ordinary library filler so the home grid and rails look plausible.
const SHOWCASE: GameSeed[] = [
  {
    // Mixed official + non-official → "Official Releases" / "Translations & Hacks"
    // subheaders, and one of every RomKind badge.
    system: 'snes', name: 'Zelda no Densetsu - Kanzenban', genre: 'Adventure', year: 1991, players: 1,
    description: LONG_DESC,
    favorite: true,
    roms: [
      { region: 'USA',    revision: null,      ext: 'sfc', curated: true, plays: 12, saveState: true },
      { region: 'Europe', revision: 'Rev 1',   ext: 'sfc', plays: 3 },
      { region: 'Japan',  revision: null,      ext: 'sfc', plays: 0 },
      { region: 'Japan',  revision: 'v1.2',    ext: 'sfc', kind: 'translation', plays: 2 },
      { region: null,     revision: null,      ext: 'sfc', kind: 'hack' },
      { region: 'USA',    revision: 'Proto',   ext: 'sfc', kind: 'prototype' },
      { region: 'World',  revision: null,      ext: 'sfc', kind: 'homebrew' },
    ],
    hacks: [
      { title: 'The Second Reality Project', author: 'FPI',          kind: 'hack',        patch_format: 'bps', match_confidence: 'exact' },
      { title: 'Kaizo Hyrule',               author: 'T. Takemoto',  kind: 'hack',        patch_format: 'ips', match_confidence: 'fuzzy' },
      { title: 'Parallel Worlds',            author: null,           kind: 'hack',        patch_format: 'ups', match_confidence: 'manual' },
      { title: 'Kanzenban English Patch',    author: 'RHDN Team',    kind: 'translation', patch_format: null,  match_confidence: 'exact' },
    ],
  },
  {
    // Every region flag the detail screen knows, plus a region-less ROM.
    // All official → the plain "Versions — N ROMs" header.
    system: 'nes', name: 'Region Sampler', genre: 'Demo', year: 1989, players: 4,
    description: 'One release per region so every flag in the detail screen renders.',
    roms: [
      { region: 'USA',       revision: null,    ext: 'nes', plays: 4 },
      { region: 'Europe',    revision: 'Rev A', ext: 'nes', plays: 1 },
      { region: 'Japan',     revision: null,    ext: 'nes' },
      { region: 'World',     revision: null,    ext: 'nes' },
      { region: 'Australia', revision: null,    ext: 'nes' },
      { region: 'Spain',     revision: null,    ext: 'nes' },
      { region: 'France',    revision: null,    ext: 'nes' },
      { region: 'Germany',   revision: null,    ext: 'nes' },
      { region: null,        revision: null,    ext: 'nes' },
    ],
  },
  {
    // Exactly one ROM → no "Versions" header at all.
    system: 'gb', name: 'Solo Cart', genre: 'Puzzle', year: 1990, players: 1,
    description: 'Single release — the versions list renders without a header.',
    favorite: true,
    roms: [{ region: 'USA', revision: null, ext: 'gb', plays: 6 }],
  },
  {
    // No genre / year / players / description → the metadata grid collapses to
    // "Played", and the description block disappears entirely.
    system: 'gbc', name: 'Minimal Metadata Cart',
    genre: null, year: null, players: null, description: null,
    roms: [{ region: null, revision: null, ext: 'gbc' }],
  },
  {
    // No ROMs, no art → "No ROMs found for this game." + gamepad placeholder.
    system: 'psx', name: 'Phantom Cartridge', genre: 'Unknown', year: 1999, players: 1,
    description: 'Catalogued but the ROM file is gone.',
    noArt: true,
    roms: [],
  },
  {
    // Unscraped → no "Scraped" dot, and opening it fires the auto-scrape, which
    // surfaces the scrape error row when no ScreenScraper credentials are set.
    system: 'megadrive', name: 'Unscraped Test Cart',
    genre: null, year: null, players: null, description: null,
    noArt: true, unscraped: true,
    roms: [{ region: 'USA', revision: null, ext: 'md' }],
  },
  {
    // adult = 1 → hidden from grid/search/random unless Show Adult is on.
    system: 'psx', name: 'Adults Only Sample', genre: 'Adventure', year: 1997, players: 1,
    description: 'Flagged adult — hidden until the home prefs opt in.',
    adult: true,
    roms: [{ region: 'Japan', revision: null, ext: 'bin' }],
  },
]

const LIBRARY: GameSeed[] = [
  {
    system: 'nes', name: 'Super Mario Bros.', genre: 'Platform', year: 1985, players: 2,
    description: 'The iconic platformer that defined a generation.',
    roms: [{ region: 'USA', revision: null, ext: 'nes' }, { region: 'Europe', revision: null, ext: 'nes' }],
  },
  {
    system: 'nes', name: 'Mega Man 2', genre: 'Action', year: 1988, players: 1,
    description: 'The definitive Mega Man experience.',
    roms: [{ region: 'USA', revision: null, ext: 'nes' }],
    hacks: [
      { title: 'Mega Man 2: Ultimate Rematch', author: 'Doc Lithium', kind: 'hack', patch_format: 'ips', match_confidence: 'exact' },
    ],
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
    roms: [
      { region: 'USA', revision: null, ext: 'sfc' },
      { region: 'Europe', revision: null, ext: 'sfc' },
      { region: null, revision: null, ext: 'sfc', kind: 'hack' },
    ],
    hacks: [
      { title: 'Super Demo World', author: 'FPI', kind: 'hack', patch_format: 'bps', match_confidence: 'exact' },
      { title: 'Kaizo Mario World', author: 'T. Takemoto', kind: 'hack', patch_format: 'ips', match_confidence: 'fuzzy' },
    ],
  },
  {
    system: 'snes', name: 'Super Metroid', genre: 'Action', year: 1994, players: 1,
    description: 'The pinnacle of the Metroid series.',
    roms: [{ region: 'USA', revision: null, ext: 'smc' }],
  },
  {
    system: 'snes', name: 'Chrono Trigger', genre: 'RPG', year: 1995, players: 1,
    description: 'A time-traveling RPG masterpiece.',
    roms: [
      { region: 'USA', revision: null, ext: 'smc' },
      { region: 'Japan', revision: null, ext: 'smc', kind: 'translation' },
    ],
    hacks: [
      { title: 'Crimson Echoes', author: 'Kajar Laboratories', kind: 'hack', patch_format: 'ips', match_confidence: 'exact' },
      { title: 'Retranslation Patch', author: 'Doctor L', kind: 'translation', patch_format: 'bps', match_confidence: 'exact' },
    ],
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

const GAMES: GameSeed[] = [...SHOWCASE, ...LIBRARY]

// Lists per user, so Add to List has rows (including an empty one) and ticks.
const LISTS: Array<{ owner: string; name: string; games: string[] }> = [
  { owner: 'Player1', name: 'Showcase', games: SHOWCASE.map(g => g.name) },
  { owner: 'Player1', name: 'Couch Co-op', games: ['Contra', 'Streets of Rage 2', 'Region Sampler', 'Street Fighter II'] },
  { owner: 'Player1', name: 'RPG Backlog', games: ['Chrono Trigger', 'Final Fantasy VII', 'Fire Emblem'] },
  { owner: 'Player1', name: 'Weekend Picks', games: [] },
  { owner: 'Retronaut', name: 'Classics', games: ['Super Mario Bros.', 'Pac-Man', 'Zelda no Densetsu - Kanzenban'] },
  { owner: 'GbaKing', name: 'Handhelds', games: ['Metroid Fusion', 'Pokemon FireRed', 'Solo Cart'] },
  { owner: 'ArcadePro', name: 'Coin-Op', games: ['Metal Slug', 'Street Fighter II CE'] },
]

// Unmatched hacks (game_id NULL) so the manual-assign bucket isn't empty.
const UNMATCHED_HACKS: Array<HackSeed & { system: string }> = [
  { system: 'snes', title: 'Unknown Platformer Hack', author: 'anon', kind: 'hack', patch_format: 'ips', match_confidence: null },
  { system: 'nes',  title: 'Untitled Translation',    author: null,   kind: 'translation', patch_format: 'ups', match_confidence: null },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

const KIND_TAG: Record<RomKind, string> = {
  official: '',
  translation: ' [T-Eng]',
  hack: ' [Hack]',
  prototype: ' [Proto]',
  homebrew: ' [Homebrew]',
}

// Windows-safe filename (the detail screen's ROM names contain ':' and similar).
const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim()

function writeRomFile(system: string, fileName: string, withSaveState: boolean): string {
  const dir = path.join(ROMS_DIR, system)
  fs.mkdirSync(dir, { recursive: true })
  const full = path.join(dir, fileName)
  fs.writeFileSync(full, Buffer.alloc(1024))
  if (withSaveState) {
    // routes/roms.ts looks for <stem>.state.auto beside the ROM.
    fs.writeFileSync(path.join(dir, path.parse(fileName).name + '.state.auto'), Buffer.alloc(64))
  }
  return full
}

// ── Insert ───────────────────────────────────────────────────────────────────

console.log('Seeding users...')
const insertUser = db.prepare('INSERT INTO users (username, avatar_color) VALUES (?, ?)')
const userIds: number[] = []
const userIdByName = new Map<string, number>()
for (const u of USERS) {
  const r = insertUser.run(u.username, u.avatar_color)
  userIds.push(r.lastInsertRowid as number)
  userIdByName.set(u.username, r.lastInsertRowid as number)
}

console.log(`Seeding ${GAMES.length} games + ROM files...`)
const insertGame = db.prepare(`
  INSERT INTO games (system, name, name_key, genre, year, players, description, box_art_path, scraped_at, adult)
  VALUES (@system, @name, @name_key, @genre, @year, @players, @description, NULL, @scraped_at, @adult)
`)
const insertRom = db.prepare(`
  INSERT INTO roms (game_id, system, rom_path, region, revision, full_name, kind, curated)
  VALUES (@game_id, @system, @rom_path, @region, @revision, @full_name, @kind, @curated)
`)

const gameIds: number[] = []
const gameIdByName = new Map<string, number>()
const romIdsByGame = new Map<number, number[]>()
// ROMs with an explicit play count — sessions are generated for these directly.
const explicitPlays: Array<{ romId: number; gameId: number; plays: number }> = []

for (const g of GAMES) {
  const gameResult = insertGame.run({
    system: g.system,
    name: g.name,
    name_key: nameKey(g.name) || g.name.toLowerCase(),
    genre: g.genre ?? null,
    year: g.year ?? null,
    players: g.players ?? null,
    description: g.description ?? null,
    scraped_at: g.unscraped ? null : new Date().toISOString(),
    adult: g.adult ? 1 : 0,
  })
  const gameId = gameResult.lastInsertRowid as number
  gameIds.push(gameId)
  gameIdByName.set(g.name, gameId)
  romIdsByGame.set(gameId, [])

  for (const rom of g.roms) {
    const kind: RomKind = rom.kind ?? 'official'
    const regionTag = rom.region ? ` (${rom.region})` : ''
    const revTag = rom.revision ? ` (${rom.revision})` : ''
    const full_name = `${g.name}${regionTag}${revTag}${KIND_TAG[kind]}`
    const rom_path = writeRomFile(
      g.system,
      `${sanitize(full_name)}.${rom.ext}`,
      rom.saveState === true,
    )
    const romResult = insertRom.run({
      game_id: gameId,
      system: g.system,
      rom_path,
      region: rom.region,
      revision: rom.revision,
      full_name,
      kind,
      curated: rom.curated ? 1 : 0,
    })
    const romId = romResult.lastInsertRowid as number
    romIdsByGame.get(gameId)!.push(romId)
    if (rom.plays !== undefined) explicitPlays.push({ romId, gameId, plays: rom.plays })
  }
}

console.log('Generating placeholder art...')
const updateBoxArt = db.prepare('UPDATE games SET box_art_path = ? WHERE id = ?')
for (const g of GAMES) {
  if (g.noArt) continue
  const gameId = gameIdByName.get(g.name)!
  updateBoxArt.run(await makeArt(g.system, gameId, g.name), gameId)
}

console.log('Seeding play sessions...')
const insertSession = db.prepare(`
  INSERT INTO play_sessions (user_id, rom_id, game_id, started_at, duration_seconds)
  VALUES (?, ?, ?, ?, ?)
`)

const now = Date.now()

// Explicit per-ROM counts first — these drive the "N× played" / last-played
// columns in the detail screen's version rows.
explicitPlays.forEach(({ romId, gameId, plays }, idx) => {
  for (let i = 0; i < plays; i++) {
    const userId = userIds[(idx + i) % userIds.length]!
    const started = new Date(now - (i + 1) * 36 * 60 * 60 * 1000).toISOString()
    insertSession.run(userId, romId, gameId, started, 600 + i * 420)
  }
})

// Random history across the library so the home rails have content.
for (const userId of userIds) {
  const playable = gameIds.filter(id => (romIdsByGame.get(id) ?? []).length > 0)
  const shuffled = playable.sort(() => Math.random() - 0.5).slice(0, 8)
  shuffled.forEach((gameId, i) => {
    const romIds = romIdsByGame.get(gameId)!
    const romId = romIds[Math.floor(Math.random() * romIds.length)]!
    const ago = (8 - i) * 2 * 24 * 60 * 60 * 1000
    const started = new Date(now - ago - Math.random() * 3600000).toISOString()
    const duration = i < 2 ? Math.floor(Math.random() * 240) : Math.floor(Math.random() * 3600) + 300
    insertSession.run(userId, romId, gameId, started, duration)
  })
}

console.log('Seeding favorites...')
const insertFav = db.prepare('INSERT OR IGNORE INTO favorites (user_id, game_id) VALUES (?, ?)')
const forcedFavorites = GAMES.filter(g => g.favorite).map(g => gameIdByName.get(g.name)!)
for (const userId of userIds) {
  for (const gameId of forcedFavorites) insertFav.run(userId, gameId)
  const picks = [...gameIds].sort(() => Math.random() - 0.5).slice(0, 6)
  for (const gameId of picks) insertFav.run(userId, gameId)
}

console.log('Seeding lists...')
const insertList = db.prepare('INSERT INTO lists (user_id, name) VALUES (?, ?)')
const insertListGame = db.prepare('INSERT OR IGNORE INTO list_games (list_id, game_id) VALUES (?, ?)')
for (const l of LISTS) {
  const userId = userIdByName.get(l.owner)
  if (userId === undefined) continue
  const listId = insertList.run(userId, l.name).lastInsertRowid as number
  for (const name of l.games) {
    const gameId = gameIdByName.get(name)
    if (gameId !== undefined) insertListGame.run(listId, gameId)
  }
}

console.log('Seeding ROM hacks...')
const insertHack = db.prepare(`
  INSERT INTO rom_hacks (hack_key, rhdn_id, kind, system, title, author, patch_format, patch_path, source_crc, game_id, match_confidence)
  VALUES (@hack_key, @rhdn_id, @kind, @system, @title, @author, @patch_format, @patch_path, NULL, @game_id, @match_confidence)
`)
let hackSeq = 1000
let hackCount = 0
for (const g of GAMES) {
  const gameId = gameIdByName.get(g.name)!
  for (const h of g.hacks ?? []) {
    const rhdnId = hackSeq++
    insertHack.run({
      hack_key: String(rhdnId),
      rhdn_id: rhdnId,
      kind: h.kind,
      system: g.system,
      title: h.title,
      author: h.author,
      patch_format: h.patch_format,
      // Deliberately points at a file that doesn't exist — compiling surfaces
      // the panel's error state rather than silently succeeding.
      patch_path: h.patch_format ? `${g.system}/${sanitize(h.title)}.${h.patch_format}` : null,
      game_id: gameId,
      match_confidence: h.match_confidence,
    })
    hackCount++
  }
}
for (const h of UNMATCHED_HACKS) {
  const rhdnId = hackSeq++
  insertHack.run({
    hack_key: String(rhdnId),
    rhdn_id: rhdnId,
    kind: h.kind,
    system: h.system,
    title: h.title,
    author: h.author,
    patch_format: h.patch_format,
    patch_path: h.patch_format ? `${h.system}/${sanitize(h.title)}.${h.patch_format}` : null,
    game_id: null,
    match_confidence: null,
  })
  hackCount++
}

const romTotal = GAMES.reduce((n, g) => n + g.roms.length, 0)

db.close()
console.log(`\nSeed complete.`)
console.log(`  DB:    ${DB_PATH}`)
console.log(`  Media: ${MEDIA_DIR}`)
console.log(`  ROMs:  ${ROMS_DIR}`)
console.log(`  Users: ${USERS.length}  Games: ${GAMES.length}  ROMs: ${romTotal}  Lists: ${LISTS.length}  Hacks: ${hackCount}`)
console.log(`\nDetail-screen states to try:`)
console.log(`  Zelda no Densetsu - Kanzenban  mixed subheaders, all 5 kind badges, save state -> Continue`)
console.log(`  Region Sampler                 every region flag + "Versions — 9 ROMs" header`)
console.log(`  Solo Cart                      single ROM, no header`)
console.log(`  Minimal Metadata Cart          no genre/year/players/description`)
console.log(`  Phantom Cartridge              no ROMs, no box art`)
console.log(`  Unscraped Test Cart            no scraped dot, auto-scrape error row`)
console.log(`  Adults Only Sample             hidden unless Show Adult is enabled`)
