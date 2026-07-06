import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { db, getSetting } from './db.js'

const DATA_DIR = process.env['RETROVAULT_DATA_DIR'] ?? path.join(os.homedir(), '.retrovault')
const MEDIA_DIR = path.join(DATA_DIR, 'media')
const DEV_ID = process.env['SCREENSCRAPER_DEV_ID'] ?? ''
const DEV_PASS = process.env['SCREENSCRAPER_DEV_PASSWORD'] ?? ''

// ScreenScraper system IDs — https://www.screenscraper.fr/api2/systemesListe.php?output=json
export const SCREENSCRAPER_SYSTEM_IDS: Record<string, number> = {
  nes: 3,
  snes: 4,
  megadrive: 1,
  genesis: 1,
  gba: 12,
  gb: 9,
  gbc: 10,
  n64: 14,
  mastersystem: 2,
  gamegear: 21,
  neogeo: 142,
  pcengine: 31,
  fds: 106,
  ngp: 25,
  ngpc: 82,
  'sg-1000': 109,
  arcade: 75,
  fba: 75,
  'mame-libretro': 75,
  'mame-mame4all': 75,
  psx: 57,
}

// libretro thumbnail repo names — https://thumbnails.libretro.com (free, no API key)
const LIBRETRO_THUMB_SYSTEMS: Record<string, string> = {
  nes: 'Nintendo - Nintendo Entertainment System',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  n64: 'Nintendo - Nintendo 64',
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  gba: 'Nintendo - Game Boy Advance',
  fds: 'Nintendo - Family Computer Disk System',
  megadrive: 'Sega - Mega Drive - Genesis',
  genesis: 'Sega - Mega Drive - Genesis',
  mastersystem: 'Sega - Master System - Mark III',
  gamegear: 'Sega - Game Gear',
  'sg-1000': 'Sega - SG-1000',
  psx: 'Sony - PlayStation',
  pcengine: 'NEC - PC Engine - TurboGrafx 16',
  neogeo: 'SNK - Neo Geo',
  ngp: 'SNK - Neo Geo Pocket',
  ngpc: 'SNK - Neo Geo Pocket Color',
  arcade: 'FBNeo - Arcade Games',
  fba: 'FBNeo - Arcade Games',
  fbneo: 'FBNeo - Arcade Games',
  'mame-libretro': 'MAME',
}

interface SSGameRow {
  id: number
  name: string
  system: string
  rom_path: string
  full_name: string
}

type ScrapeSuccess = { success: true; name: string }
type ScrapeFailure = { success: false; error: string }
type ScrapeResult = ScrapeSuccess | ScrapeFailure

async function saveBoxArt(buf: Buffer, system: string, gameId: number): Promise<string> {
  const dir = path.join(MEDIA_DIR, system)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${gameId}.jpg`)
  await sharp(buf)
    .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toFile(dest)
  return `/media/${system}/${gameId}.jpg`
}

// libretro thumbnails replace these characters with underscores in filenames
function libretroSanitize(name: string): string {
  return name.replace(/[&*/:`<>?\\|"]/g, '_')
}

async function scrapeLibretroThumb(game: SSGameRow): Promise<ScrapeResult> {
  const repo = LIBRETRO_THUMB_SYSTEMS[game.system.toLowerCase()]
  if (!repo) {
    return { success: false, error: `No libretro thumbnail repo for system: ${game.system}` }
  }

  // No-Intro naming: the ROM filename is usually the best match, then gamelist names
  const candidates = [...new Set([
    path.parse(game.rom_path).name,
    game.full_name,
    game.name,
  ])].filter(Boolean)

  for (const cand of candidates) {
    const url = `https://thumbnails.libretro.com/${encodeURIComponent(repo)}/Named_Boxarts/${encodeURIComponent(libretroSanitize(cand))}.png`
    let res: Response
    try {
      res = await fetch(url)
    } catch (e) {
      return { success: false, error: `Network error: ${e}` }
    }
    if (!res.ok) continue

    try {
      const buf = Buffer.from(await res.arrayBuffer())
      const boxArtPath = await saveBoxArt(buf, game.system, game.id)
      db.prepare(`
        UPDATE games SET box_art_path = ?, scraped_at = datetime('now') WHERE id = ?
      `).run(boxArtPath, game.id)
      return { success: true, name: game.name }
    } catch (e) {
      return { success: false, error: `Failed to save box art: ${e}` }
    }
  }

  return {
    success: false,
    error: `No libretro box art found for "${candidates[0]}" — filename must follow No-Intro naming`,
  }
}

async function fetchSS(params: URLSearchParams): Promise<Response> {
  const url = `https://www.screenscraper.fr/api2/jeuInfos.php?${params}`
  const res = await fetch(url)
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 10000))
    return fetch(url)
  }
  return res
}

export async function scrapeGame(gameId: number, username: string, password: string): Promise<ScrapeResult> {
  const game = db.prepare(`
    SELECT g.id, g.name, g.system, r.rom_path, r.full_name
    FROM games g
    JOIN roms r ON r.game_id = g.id
    WHERE g.id = ?
    ORDER BY r.id ASC
    LIMIT 1
  `).get(gameId) as SSGameRow | undefined

  if (!game) return { success: false, error: 'Game not found or has no ROMs' }

  // Credentials: saved settings first, env vars as fallback
  const devId = getSetting('ss_dev_id') || DEV_ID
  const devPass = getSetting('ss_dev_password') || DEV_PASS
  const ssUser = username || getSetting('ss_user') || ''
  const ssPass = password || getSetting('ss_user_password') || ''

  // No ScreenScraper dev credentials → free fallback: box art from libretro thumbnails.
  // (Full metadata — genre/year/description — still needs SS dev creds.)
  if (!devId || !devPass) {
    return scrapeLibretroThumb(game)
  }

  const systemId = SCREENSCRAPER_SYSTEM_IDS[game.system.toLowerCase()]
  if (!systemId) return { success: false, error: `No ScreenScraper ID for system: ${game.system}` }

  const params = new URLSearchParams({
    devid: devId,
    devpassword: devPass,
    softname: 'retrovault',
    output: 'json',
    ssid: ssUser,
    sspassword: ssPass,
    systemeid: String(systemId),
    romnom: path.basename(game.rom_path),
  })

  let res: Response
  try {
    res = await fetchSS(params)
  } catch (e) {
    return { success: false, error: `Network error: ${e}` }
  }

  if (!res.ok) {
    // ScreenScraper returns plain-text reasons (bad dev creds, closed API, bad ssid…)
    const text = (await res.text().catch(() => '')).trim().slice(0, 200)
    return { success: false, error: `ScreenScraper ${res.status}${text ? `: ${text}` : ''}` }
  }

  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    return { success: false, error: 'Invalid JSON from ScreenScraper' }
  }

  const response = (raw as Record<string, unknown>)?.['response'] as Record<string, unknown> | undefined
  const jeu = response?.['jeu'] as Record<string, unknown> | undefined
  if (!jeu) return { success: false, error: 'No game data in ScreenScraper response' }

  // Name
  const names = jeu['noms'] as Array<{ region: string; text: string }> | undefined
  let gameName = game.name
  if (names?.length) {
    const pick = names.find(n => n.region === 'us' || n.region === 'wor') ?? names[0]
    if (pick.text) gameName = pick.text
  }

  // Genre
  const genres = jeu['genres'] as Array<{ noms: Array<{ langue: string; text: string }> }> | undefined
  let genre: string | null = null
  if (genres?.length) {
    const noms = genres[0].noms ?? []
    const pick = noms.find(n => n.langue === 'en') ?? noms[0]
    genre = pick?.text ?? null
  }

  // Year
  const dates = jeu['dates'] as Array<{ region: string; text: string }> | undefined
  let year: number | null = null
  if (dates?.length) {
    const pick = dates.find(d => d.region === 'us' || d.region === 'wor') ?? dates[0]
    const y = parseInt((pick.text ?? '').slice(0, 4), 10)
    if (!isNaN(y)) year = y
  }

  // Players
  const joueurs = jeu['joueurs'] as { text: string } | undefined
  let players: number | null = null
  if (joueurs?.text) {
    const m = joueurs.text.match(/(\d+)/)
    if (m) players = parseInt(m[1], 10)
  }

  // Description
  const synopsis = jeu['synopsis'] as Array<{ langue: string; text: string }> | undefined
  let description: string | null = null
  if (synopsis?.length) {
    const pick = synopsis.find(s => s.langue === 'en') ?? synopsis[0]
    description = pick?.text ?? null
  }

  // Box art
  const medias = jeu['medias'] as Array<{ type: string; url: string }> | undefined
  let boxArtPath: string | null = null
  if (medias?.length) {
    const art = medias.find(m => m.type === 'box-2D') ?? medias.find(m => m.type === 'box-3D') ?? medias.find(m => /^box/.test(m.type))
    if (art?.url) {
      try {
        const imgRes = await fetch(art.url)
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer())
          boxArtPath = await saveBoxArt(buf, game.system, game.id)
        }
      } catch { /* box art is optional */ }
    }
  }

  db.prepare(`
    UPDATE games
    SET name = ?, genre = ?, year = ?, players = ?, description = ?,
        box_art_path = COALESCE(?, box_art_path),
        scraped_at = datetime('now')
    WHERE id = ?
  `).run(gameName, genre, year, players, description, boxArtPath, game.id)

  return { success: true, name: gameName }
}
