import fs from 'node:fs'
import path from 'node:path'
import { db, nameKey } from './db.js'
import { DAT_SOURCES, loadDat, displayName } from './dat.js'
import type {
  AuditEntry, AuditStatus, AuditStrategy, AuditSystemReport, AuditSystemSummary,
} from '@retro-vault/shared'

// --- CRC32 (dependency-free, table-based) ---------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer, start = 0): string {
  let crc = 0xFFFFFFFF
  for (let i = start; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]!) & 0xFF]! ^ (crc >>> 8)
  crc = (crc ^ 0xFFFFFFFF) >>> 0
  return crc.toString(16).toUpperCase().padStart(8, '0')
}

// CRC32 of a zip's largest inner entry, read straight from the central
// directory — No-Intro's CRC is of the uncompressed data, which the zip stores.
function zipInnerCrc(buf: Buffer): string | null {
  let eocd = -1
  const min = Math.max(0, buf.length - 22 - 65536)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  let best: { crc: string; size: number } | null = null
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const crc = buf.readUInt32LE(p + 16) >>> 0
    const usize = buf.readUInt32LE(p + 24) >>> 0
    const fn = buf.readUInt16LE(p + 28)
    const ex = buf.readUInt16LE(p + 30)
    const cm = buf.readUInt16LE(p + 32)
    if (!best || usize > best.size) best = { crc: crc.toString(16).toUpperCase().padStart(8, '0'), size: usize }
    p += 46 + fn + ex + cm
  }
  return best?.crc ?? null
}

// Normalize an N64 ROM to big-endian .z64 order (what No-Intro hashes).
function toZ64(buf: Buffer): Buffer | null {
  if (buf.length < 4) return null
  const [b0, b1, b2, b3] = [buf[0], buf[1], buf[2], buf[3]]
  if (b0 === 0x80 && b1 === 0x37 && b2 === 0x12 && b3 === 0x40) return buf // already z64
  if (b0 === 0x37 && b1 === 0x80 && b2 === 0x40 && b3 === 0x12) { // .v64 — swap 16-bit
    const out = Buffer.from(buf)
    for (let i = 0; i + 1 < out.length; i += 2) { const t = out[i]!; out[i] = out[i + 1]!; out[i + 1] = t }
    return out
  }
  if (b0 === 0x40 && b1 === 0x12 && b2 === 0x37 && b3 === 0x80) { // .n64 — swap 32-bit
    const out = Buffer.from(buf)
    for (let i = 0; i + 3 < out.length; i += 4) {
      const a = out[i]!, b = out[i + 1]!, c = out[i + 2]!, d = out[i + 3]!
      out[i] = d; out[i + 1] = c; out[i + 2] = b; out[i + 3] = a
    }
    return out
  }
  return null
}

// Candidate CRC32s for a ROM. Multiple when headers/byte-order could differ, so
// any one matching the DAT counts as a hit.
function computeCandidates(romPath: string, system: string): string[] {
  const ext = path.extname(romPath).toLowerCase()
  const buf = fs.readFileSync(romPath)
  if (ext === '.zip') {
    const z = zipInnerCrc(buf)
    return z ? [z] : []
  }
  const cands = new Set<string>()
  cands.add(crc32(buf))
  // NES: No-Intro hashes without the 16-byte iNES header.
  if (system === 'nes' && buf.length > 16 && buf[0] === 0x4E && buf[1] === 0x45 && buf[2] === 0x53 && buf[3] === 0x1A) {
    cands.add(crc32(buf, 16))
  }
  // SNES: strip a 512-byte copier header when present.
  if (system === 'snes' && buf.length % 1024 === 512) cands.add(crc32(buf, 512))
  // N64: also try the byte-order-normalized form.
  if (system === 'n64') { const z = toZ64(buf); if (z) cands.add(crc32(z)) }
  return [...cands]
}

// --- Job state ------------------------------------------------------------
const job: AuditStatus = { running: false, done: 0, total: 0, currentSystem: null, currentFile: null }

export const auditStatus = (): AuditStatus => ({ ...job })

interface RomRow { id: number; rom_path: string; full_name: string; crc: string | null; region: string | null }

const saveReport = db.prepare(`
  INSERT INTO audit_report (system, json, ran_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(system) DO UPDATE SET json = excluded.json, ran_at = excluded.ran_at
`)
const setRomCrc = db.prepare('UPDATE roms SET crc = ? WHERE id = ?')

function auditSystem(system: string): AuditSystemReport {
  const strategy: AuditStrategy = DAT_SOURCES[system]!.strategy
  const datRows = db.prepare('SELECT name, name_key, region, crc FROM dat_entries WHERE system = ?')
    .all(system) as Array<{ name: string; name_key: string; region: string | null; crc: string | null }>
  const datCrc = new Set(datRows.filter(r => r.crc).map(r => r.crc as string))
  const datNames = new Set(datRows.map(r => r.name_key))

  const roms = db.prepare('SELECT id, rom_path, full_name, crc, region FROM roms WHERE system = ?')
    .all(system) as RomRow[]

  const ownedCrc = new Set<string>()
  const ownedNames = new Set<string>()
  const unknown: AuditEntry[] = []

  for (const rom of roms) {
    job.currentFile = rom.full_name
    let crc = rom.crc
    if (!crc) {
      try {
        const cands = computeCandidates(rom.rom_path, system)
        crc = cands.find(c => datCrc.has(c)) ?? cands[0] ?? null
        if (crc) setRomCrc.run(crc, rom.id)
      } catch { crc = null }
    }
    const nk = nameKey(rom.full_name)
    if (crc) ownedCrc.add(crc)
    ownedNames.add(nk)
    const matched = (crc !== null && datCrc.has(crc)) || datNames.has(nk)
    if (!matched) unknown.push({ name: rom.full_name, region: rom.region })
    job.done++
  }

  const missing: AuditEntry[] = []
  for (const d of datRows) {
    const present = (d.crc !== null && ownedCrc.has(d.crc)) || ownedNames.has(d.name_key)
    if (!present) missing.push({ name: d.name, region: d.region })
  }

  return {
    system,
    displayName: displayName(system),
    family: DAT_SOURCES[system]!.family,
    strategy,
    total: datRows.length,
    have: datRows.length - missing.length,
    missingCount: missing.length,
    unknownCount: unknown.length,
    ran_at: new Date().toISOString(),
    missing,
    unknown,
  }
}

// Run the audit for the given systems (defaults to all auditable systems that
// actually have ROMs). Sequential + cached, so re-runs are fast.
export async function runAudit(systems?: string[]): Promise<void> {
  if (job.running) return
  const scope = (systems && systems.length ? systems : Object.keys(DAT_SOURCES))
    .filter(s => DAT_SOURCES[s])
  // Only systems the user actually has ROMs for.
  const withRoms = scope.filter(s =>
    (db.prepare('SELECT COUNT(*) c FROM roms WHERE system = ?').get(s) as { c: number }).c > 0
  )

  Object.assign(job, { running: true, done: 0, total: 0, currentSystem: null, currentFile: null, error: undefined })
  job.total = withRoms.reduce((n, s) =>
    n + (db.prepare('SELECT COUNT(*) c FROM roms WHERE system = ?').get(s) as { c: number }).c, 0)

  try {
    for (const system of withRoms) {
      job.currentSystem = system
      await loadDat(system)
      const report = auditSystem(system)
      saveReport.run(system, JSON.stringify(report))
    }
  } catch (e) {
    job.error = e instanceof Error ? e.message : String(e)
  } finally {
    job.running = false
    job.currentSystem = null
    job.currentFile = null
  }
}

export function latestSummaries(): AuditSystemSummary[] {
  const rows = db.prepare('SELECT system, json FROM audit_report').all() as Array<{ system: string; json: string }>
  return rows
    .map(r => JSON.parse(r.json) as AuditSystemReport)
    .map(({ missing: _m, unknown: _u, ...summary }) => summary)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function systemReport(system: string): AuditSystemReport | null {
  const row = db.prepare('SELECT json FROM audit_report WHERE system = ?').get(system) as { json: string } | undefined
  return row ? (JSON.parse(row.json) as AuditSystemReport) : null
}
