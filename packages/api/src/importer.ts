import fs from 'node:fs'
import path from 'node:path'
import { db } from './db.js'

const ROMS_DIR = '/home/pi/RetroPie/roms'

const EXCLUDE_EXTENSIONS = new Set([
  '.txt', '.xml', '.sh', '.cfg', '.srm', '.state', '.png', '.jpg',
  '.gif', '.bmp', '.mp3', '.ogg', '.db', '.dat', '.nfo', '.cue',
])

const REGION_MAP: Record<string, string> = {
  USA: 'USA', U: 'USA', UE: 'USA', 'USA, Europe': 'USA',
  Europe: 'Europe', E: 'Europe', EU: 'Europe',
  Japan: 'Japan', J: 'Japan', JU: 'Japan', 'Japan, USA': 'Japan',
  World: 'World', W: 'World',
  Australia: 'Australia', A: 'Australia',
  Spain: 'Spain', S: 'Spain',
  France: 'France', F: 'France',
  Germany: 'Germany', G: 'Germany',
}

export interface ParsedRom {
  base_name: string
  region: string | null
  revision: string | null
  full_name: string
}

export function parseRomFilename(filename: string): ParsedRom {
  const full_name = path.parse(filename).name

  const tags: string[] = []
  const tagRegex = /\(([^)]+)\)/g
  let match
  while ((match = tagRegex.exec(full_name)) !== null) {
    tags.push(match[1])
  }

  const base_name = full_name.replace(/\s*\([^)]*\)/g, '').trim() || full_name

  let region: string | null = null
  for (const tag of tags) {
    const norm = REGION_MAP[tag] ?? REGION_MAP[tag.split(',')[0]?.trim() ?? '']
    if (norm) { region = norm; break }
  }

  let revision: string | null = null
  for (const tag of tags) {
    if (/^Rev\s*[\dA-Z]/i.test(tag)) { revision = tag; break }
    if (/^(Beta|Proto|Sample|Demo|Hack|Unl|Pirate)/i.test(tag)) { revision = tag; break }
  }

  return { base_name, region, revision, full_name }
}

const upsertGame = db.prepare(`
  INSERT INTO games (name, system)
  VALUES (@name, @system)
  ON CONFLICT(name, system) DO NOTHING
`)

const findGame = db.prepare(`SELECT id FROM games WHERE name = ? AND system = ?`)

const upsertRom = db.prepare(`
  INSERT INTO roms (game_id, system, rom_path, region, revision, full_name)
  VALUES (@game_id, @system, @rom_path, @region, @revision, @full_name)
  ON CONFLICT(rom_path) DO NOTHING
`)

export interface ImportResult {
  games_created: number
  games_updated: number
  roms_created: number
  roms_skipped: number
}

export function runImport(): ImportResult {
  if (!fs.existsSync(ROMS_DIR)) {
    throw new Error(`ROMs directory not found: ${ROMS_DIR}`)
  }

  const result: ImportResult = { games_created: 0, games_updated: 0, roms_created: 0, roms_skipped: 0 }
  const gamesWithNewRoms = new Set<number>()

  const systems = fs.readdirSync(ROMS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)

  const doImport = db.transaction(() => {
    for (const system of systems) {
      const systemDir = path.join(ROMS_DIR, system)
      let files: string[]
      try {
        files = fs.readdirSync(systemDir)
      } catch { continue }

      for (const filename of files) {
        if (filename.startsWith('.')) continue
        const ext = path.extname(filename).toLowerCase()
        if (EXCLUDE_EXTENSIONS.has(ext)) continue

        const rom_path = path.join(systemDir, filename)
        try {
          if (!fs.statSync(rom_path).isFile()) continue
        } catch { continue }

        const { base_name, region, revision, full_name } = parseRomFilename(filename)

        const gameInsert = upsertGame.run({ name: base_name, system })
        if (gameInsert.changes > 0) result.games_created++

        const game = findGame.get(base_name, system) as { id: number } | undefined
        if (!game) continue

        const romInsert = upsertRom.run({ game_id: game.id, system, rom_path, region, revision, full_name })
        if (romInsert.changes > 0) {
          result.roms_created++
          if (gameInsert.changes === 0) gamesWithNewRoms.add(game.id)
        } else {
          result.roms_skipped++
        }
      }
    }
  })

  doImport()
  result.games_updated = gamesWithNewRoms.size
  return result
}
