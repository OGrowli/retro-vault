import fs from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import sharp from 'sharp'
import { db } from './db.js'

const ES_GAMELISTS_DIR = '/home/pi/.emulationstation/gamelists'
const MEDIA_DIR = '/home/pi/.retrovault/media'
const MAX_IMAGE_SIZE = 300
const JPEG_QUALITY = 75

interface ESGame {
  path: string
  name: string
  desc?: string
  image?: string
  thumbnail?: string
  genre?: string
  releasedate?: string
  players?: string | number
}

interface ESGameList {
  gameList: {
    game: ESGame | ESGame[]
  }
}

async function resizeBoxArt(srcPath: string, destPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  await sharp(srcPath)
    .resize(MAX_IMAGE_SIZE, MAX_IMAGE_SIZE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(destPath)
}

function parseYear(releasedate?: string): number | null {
  if (!releasedate) return null
  const m = releasedate.match(/^(\d{4})/)
  return m ? parseInt(m[1], 10) : null
}

const upsertGame = db.prepare(`
  INSERT INTO games (system, name, rom_path, box_art_path, genre, year, players, description, scraped_at)
  VALUES (@system, @name, @rom_path, @box_art_path, @genre, @year, @players, @description, datetime('now'))
  ON CONFLICT(rom_path) DO UPDATE SET
    name = excluded.name,
    box_art_path = excluded.box_art_path,
    genre = excluded.genre,
    year = excluded.year,
    players = excluded.players,
    description = excluded.description,
    scraped_at = excluded.scraped_at
`)

export async function runImport(): Promise<{ imported: number; errors: string[] }> {
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true })
  let imported = 0
  const errors: string[] = []

  if (!fs.existsSync(ES_GAMELISTS_DIR)) {
    throw new Error(`EmulationStation gamelists not found at ${ES_GAMELISTS_DIR}`)
  }

  const systems = fs.readdirSync(ES_GAMELISTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  for (const system of systems) {
    const xmlPath = path.join(ES_GAMELISTS_DIR, system, 'gamelist.xml')
    if (!fs.existsSync(xmlPath)) continue

    let parsed: ESGameList
    try {
      const xml = fs.readFileSync(xmlPath, 'utf-8')
      parsed = parser.parse(xml) as ESGameList
    } catch (e) {
      errors.push(`${system}: failed to parse XML: ${e}`)
      continue
    }

    const rawGames = parsed?.gameList?.game
    if (!rawGames) continue
    const games = Array.isArray(rawGames) ? rawGames : [rawGames]

    for (const g of games) {
      try {
        const romPath = g.path.startsWith('./')
          ? path.join(`/home/pi/RetroPie/roms/${system}`, g.path.slice(2))
          : g.path

        let boxArtPath: string | null = null
        const imageSrc = g.image || g.thumbnail
        if (imageSrc) {
          const resolved = imageSrc.startsWith('./')
            ? path.join(path.dirname(xmlPath), imageSrc.slice(2))
            : imageSrc

          if (fs.existsSync(resolved)) {
            const destName = `${system}_${path.basename(romPath, path.extname(romPath))}.jpg`
            const destPath = path.join(MEDIA_DIR, system, destName)
            await resizeBoxArt(resolved, destPath)
            boxArtPath = `/media/${system}/${destName}`
          }
        }

        upsertGame.run({
          system,
          name: g.name,
          rom_path: romPath,
          box_art_path: boxArtPath,
          genre: g.genre ?? null,
          year: parseYear(g.releasedate?.toString()),
          players: g.players ? parseInt(g.players.toString(), 10) : null,
          description: g.desc ?? null,
        })

        imported++
      } catch (e) {
        errors.push(`${system}/${g.name}: ${e}`)
      }
    }
  }

  return { imported, errors }
}

if (process.argv[1]?.endsWith('importer.ts') || process.argv[1]?.endsWith('importer.js')) {
  runImport().then(({ imported, errors }) => {
    console.log(`Imported ${imported} games`)
    if (errors.length) console.error('Errors:\n' + errors.join('\n'))
  }).catch(e => {
    console.error(e)
    process.exit(1)
  })
}
