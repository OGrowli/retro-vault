import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { db, nameKey } from './db.js'
import { getSystemConfig } from './systems.config.js'

const DATA_DIR = process.env['RETROVAULT_DATA_DIR'] ?? path.join(os.homedir(), '.retrovault')
const DAT_DIR = path.join(DATA_DIR, 'dats')

const RAW_BASE = 'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat'

export interface DatSource {
  family: 'no-intro'
  /** DAT filename within the family folder (spaces get URL-encoded on fetch). */
  file: string
  strategy: 'crc'
}

// Cartridge systems only for this phase — all exact-CRC via No-Intro.
export const DAT_SOURCES: Record<string, DatSource> = {
  nes: { family: 'no-intro', file: 'Nintendo - Nintendo Entertainment System.dat', strategy: 'crc' },
  snes: { family: 'no-intro', file: 'Nintendo - Super Nintendo Entertainment System.dat', strategy: 'crc' },
  n64: { family: 'no-intro', file: 'Nintendo - Nintendo 64.dat', strategy: 'crc' },
  gb: { family: 'no-intro', file: 'Nintendo - Game Boy.dat', strategy: 'crc' },
  gbc: { family: 'no-intro', file: 'Nintendo - Game Boy Color.dat', strategy: 'crc' },
  gba: { family: 'no-intro', file: 'Nintendo - Game Boy Advance.dat', strategy: 'crc' },
  megadrive: { family: 'no-intro', file: 'Sega - Mega Drive - Genesis.dat', strategy: 'crc' },
  genesis: { family: 'no-intro', file: 'Sega - Mega Drive - Genesis.dat', strategy: 'crc' },
  mastersystem: { family: 'no-intro', file: 'Sega - Master System - Mark III.dat', strategy: 'crc' },
}

export const auditableSystems = () => Object.keys(DAT_SOURCES)

export interface DatRom {
  name: string
  region: string | null
  size: number | null
  crc: string | null
  md5: string | null
  sha1: string | null
}

// Split a clrmamepro DAT into top-level `game ( ... )` blocks, respecting nested
// parens inside rom(...) and quoted strings.
function gameBlocks(text: string): string[] {
  const blocks: string[] = []
  let i = 0
  while (true) {
    const start = text.indexOf('game (', i)
    if (start === -1) break
    let depth = 0
    let inStr = false
    let j = start
    for (; j < text.length; j++) {
      const ch = text[j]
      if (inStr) { if (ch === '"') inStr = false; continue }
      if (ch === '"') inStr = true
      else if (ch === '(') depth++
      else if (ch === ')') { depth--; if (depth === 0) { j++; break } }
    }
    blocks.push(text.slice(start, j))
    i = j
  }
  return blocks
}

export function parseClrmamepro(text: string): DatRom[] {
  const out: DatRom[] = []
  for (const block of gameBlocks(text)) {
    const gameName = /\bname\s+"([^"]*)"/.exec(block)?.[1]
    if (!gameName) continue
    const region = /\bregion\s+"([^"]*)"/.exec(block)?.[1] ?? null
    // First rom entry is the cartridge dump.
    const romInner = /\brom\s*\(([^)]*)\)/.exec(block)?.[1]
    if (!romInner) continue
    const size = /\bsize\s+(\d+)/.exec(romInner)?.[1]
    const crc = /\bcrc\s+([0-9A-Fa-f]{8})/.exec(romInner)?.[1]
    const md5 = /\bmd5\s+([0-9A-Fa-f]{32})/.exec(romInner)?.[1]
    const sha1 = /\bsha1\s+([0-9A-Fa-f]{40})/.exec(romInner)?.[1]
    out.push({
      name: gameName,
      region,
      size: size ? parseInt(size, 10) : null,
      crc: crc ? crc.toUpperCase() : null,
      md5: md5 ? md5.toUpperCase() : null,
      sha1: sha1 ? sha1.toUpperCase() : null,
    })
  }
  return out
}

// Fetch a DAT (cached under ~/.retrovault/dats). `force` re-downloads.
export async function fetchDat(system: string, force = false): Promise<string> {
  const src = DAT_SOURCES[system]
  if (!src) throw new Error(`No DAT source for system: ${system}`)
  fs.mkdirSync(DAT_DIR, { recursive: true })
  const cachePath = path.join(DAT_DIR, `${system}.dat`)
  if (!force && fs.existsSync(cachePath)) return fs.readFileSync(cachePath, 'utf-8')

  const url = `${RAW_BASE}/${src.family}/${encodeURIComponent(src.file)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`DAT download failed (${res.status}) for ${src.file}`)
  const text = await res.text()
  fs.writeFileSync(cachePath, text)
  return text
}

const replaceEntries = db.transaction((system: string, roms: DatRom[]) => {
  db.prepare('DELETE FROM dat_entries WHERE system = ?').run(system)
  const ins = db.prepare(`
    INSERT INTO dat_entries (system, name, name_key, region, crc, md5, sha1, size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const r of roms) ins.run(system, r.name, nameKey(r.name), r.region, r.crc, r.md5, r.sha1, r.size)
  db.prepare(`
    INSERT INTO dat_meta (system, family, source, imported_at, entry_count)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(system) DO UPDATE SET
      family = excluded.family, source = excluded.source,
      imported_at = excluded.imported_at, entry_count = excluded.entry_count
  `).run(system, DAT_SOURCES[system]!.family, DAT_SOURCES[system]!.file, roms.length)
})

// Ensure a system's DAT is downloaded + parsed into dat_entries. Returns count.
export async function loadDat(system: string, force = false): Promise<number> {
  const have = db.prepare('SELECT entry_count FROM dat_meta WHERE system = ?').get(system) as
    | { entry_count: number } | undefined
  if (have && !force) return have.entry_count
  const text = await fetchDat(system, force)
  const roms = parseClrmamepro(text)
  replaceEntries(system, roms)
  return roms.length
}

export const displayName = (system: string) => getSystemConfig(system)?.displayName ?? system
