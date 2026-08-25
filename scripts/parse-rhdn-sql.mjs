#!/usr/bin/env node
// Parse the ROMhacking.net MySQL dump (romhacking.sql) into a compact metadata
// sidecar for the hack matcher: romhacks/rhdn-meta.json, keyed by
// `<kind>:<rhdn id>` — the same id ingest-romhacks.mjs pulls out of the
// `[1234]Title.zip` bundle names, so the two files join 1:1 with no fuzzing.
//
// Why this exists: index.json only knows what the patch *filename* says. The
// dump knows which game each patch targets (Hacks.gamekey -> gamedata) and, for
// ~90% of rows, the exact CRC32/SHA-1 of the base ROM it expects (rominfo) —
// including IPS patches, which carry no source checksum of their own.
//
//   node parse-rhdn-sql.mjs                     # -> $RHDN_OUT/rhdn-meta.json
//
// Env overrides: RHDN_SQL (.sql or .sql.zip), RHDN_OUT
//
// Deliberately dependency-free: a hand-rolled tokenizer for the dump's INSERT
// tuples beats pulling in a MySQL parser for six tables.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const SRC = process.env.RHDN_SQL || '/mnt/c/Users/Seamus/Downloads/romhacking.sql.zip'
const OUT = process.env.RHDN_OUT || '/mnt/c/Users/Seamus/Downloads/games/romhacks'
const OUT_FILE = path.join(OUT, 'rhdn-meta.json')

const WANT = new Set(['Hacks', 'transdata', 'gamedata', 'console', 'patchhints', 'language'])

// --- dump reading -----------------------------------------------------------

function readDump(src) {
  if (/\.zip$/i.test(src)) {
    // -p streams the single member to stdout; the dump is ~21MB uncompressed.
    return execFileSync('unzip', ['-p', src], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8')
  }
  return fs.readFileSync(src, 'utf8')
}

// MySQL string escapes as mysqldump writes them.
const ESC = { n: '\n', r: '\r', t: '\t', b: '\b', Z: '\x1a', 0: '\0' }

// Yield one array of column values per `(...)` tuple in a VALUES clause.
// Values are strings; unquoted NULL becomes null.
function* parseValues(s) {
  let row = [], cur = '', inQuote = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuote) {
      if (c === '\\') { const nx = s[++i]; cur += ESC[nx] ?? nx; continue }
      if (c === "'") {
        if (s[i + 1] === "'") { cur += "'"; i++; continue }   // '' escape
        inQuote = false; row.push(cur); cur = ''; continue
      }
      cur += c; continue
    }
    if (c === "'") { inQuote = true; cur = ''; continue }
    if (c === '(') { row = []; continue }
    if (c === ')') { yield row; continue }
    if (c === ',' || c === ' ' || c === '\n' || c === '\r' || c === '\t') continue
    // bare token: number, NULL, keyword
    let j = i
    while (j < s.length && s[j] !== ',' && s[j] !== ')') j++
    const tok = s.slice(i, j).trim()
    row.push(tok.toUpperCase() === 'NULL' ? null : tok)
    i = j - 1
  }
}

// table -> array of row objects
function parseDump(raw) {
  const cols = new Map()
  const createRe = /CREATE TABLE `([\w-]+)` \(([\s\S]*?)\n\) ENGINE/g
  for (let m; (m = createRe.exec(raw));) {
    if (!WANT.has(m[1])) continue
    cols.set(m[1], [...m[2].matchAll(/^\s*`([^`]+)`/gm)].map(x => x[1]))
  }

  const out = new Map([...cols.keys()].map(t => [t, []]))
  const insertRe = /INSERT INTO `([\w-]+)` \(([^)]*)\) VALUES\s*([\s\S]*?);\n/g
  for (let m; (m = insertRe.exec(raw));) {
    const table = m[1]
    if (!cols.has(table)) continue
    const insCols = [...m[2].matchAll(/`([^`]+)`/g)].map(x => x[1])
    const rows = out.get(table)
    for (const vals of parseValues(m[3])) {
      if (vals.length !== insCols.length) continue
      const o = {}
      insCols.forEach((c, i) => { o[c] = vals[i] })
      rows.push(o)
    }
  }
  return out
}

// --- text helpers -----------------------------------------------------------

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-' }

// gamedata/Hacks titles are stored HTML-escaped (&amp;, &#039;) — 364 game
// titles carry entities, and they poison any name comparison if left in.
function unescapeHtml(s) {
  if (!s) return s
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .trim()
}

// rominfo is free text pasted from ROM hashers / No-Intro DATs. Two quirks that
// matter: the site stores CRCs with leading zeros stripped ("ROM CRC32: D9F5BD1"
// is really 0D9F5BD1), and some hashers print SHA-1/MD5 in space-separated
// 8-char groups. Both silently break a naive 8/40-hex-digit match.
const CRC_RE = /CRC[-\s]?32\s*(?:of\s+)?[:=]?\s*([0-9A-Fa-f]{1,8})(?![0-9A-Fa-f])/g
const SHA1_RE = /SHA[-\s]?1\s*[:=]?\s*((?:[0-9A-Fa-f]{8}[ \t]+){4}[0-9A-Fa-f]{8}|[0-9A-Fa-f]{40})(?![0-9A-Fa-f])/g
const MD5_RE = /MD5\s*[:=]?\s*((?:[0-9A-Fa-f]{8}[ \t]+){3}[0-9A-Fa-f]{8}|[0-9A-Fa-f]{32})(?![0-9A-Fa-f])/g
const DBMATCH_RE = /Database match:\s*([^\r\n]+)/g

const uniq = a => [...new Set(a)]

// All base-ROM identifiers a rominfo blob asserts. Rows that list both a "File"
// and a "ROM" hash are giving the headered and header-stripped forms of the same
// dump — keep both, since which one the library holds depends on the system.
function parseRomInfo(text) {
  const t = text || ''
  const crcs = [...t.matchAll(CRC_RE)].map(m => m[1].toUpperCase().padStart(8, '0'))
  const sha1s = [...t.matchAll(SHA1_RE)].map(m => m[1].replace(/\s+/g, '').toUpperCase())
  const md5s = [...t.matchAll(MD5_RE)].map(m => m[1].replace(/\s+/g, '').toUpperCase())
  const names = [...t.matchAll(DBMATCH_RE)].map(m => unescapeHtml(m[1]).trim())
  return { crcs: uniq(crcs), sha1s: uniq(sha1s), md5s: uniq(md5s), datNames: uniq(names) }
}

// --- build ------------------------------------------------------------------

function build() {
  console.log(`Reading ${SRC} …`)
  const tables = parseDump(readDump(SRC))
  for (const [t, rows] of tables) console.log(`  ${t}: ${rows.length}`)

  const games = new Map(tables.get('gamedata').map(g => [String(g.gamekey), g]))
  // Hacks.consolekey (an int) points at console.consoleid — NOT console.consolekey,
  // which is the text slug ('nes'). Easy to get backwards; the join silently
  // returns near-nothing if you do.
  const consoles = new Map(tables.get('console').map(c => [String(c.consoleid), c.consolekey]))
  const hints = new Map(tables.get('patchhints').map(h => [String(h[Object.keys(h)[0]]), h[Object.keys(h)[1]]]))
  const langs = new Map(tables.get('language').map(l => {
    const k = Object.keys(l)
    return [String(l[k[0]]), l[k[1]]]
  }))

  const entries = {}
  const stats = { hack: 0, translation: 0, withHash: 0, withGame: 0, noFile: 0 }

  const add = (kind, row, idField, extra) => {
    const id = parseInt(row[idField], 10)
    if (!Number.isFinite(id)) return
    const g = games.get(String(row.gamekey))
    const info = parseRomInfo(row.rominfo)
    const hasHash = info.crcs.length > 0 || info.sha1s.length > 0
    stats[kind]++
    if (hasHash) stats.withHash++
    if (g) stats.withGame++
    if (row.nofile === '1') stats.noFile++

    entries[`${kind}:${id}`] = {
      kind,
      gameKey: row.gamekey ? parseInt(row.gamekey, 10) : null,
      // The canonical game this patch targets. This is the whole point: the
      // patch title ("Enhansa Edition") is often unrelated to the game name.
      gameTitle: g ? unescapeHtml(g.gametitle) : null,
      // Alternate-region title (2,111 games have one) — a free alias, and the
      // only way many Japanese-titled translation targets ever match.
      gameTitleAlt: g && g.japtitle ? unescapeHtml(g.japtitle) : null,
      gameYear: g && g.Year && g.Year !== '0' ? parseInt(g.Year, 10) : null,
      rhdnSystem: consoles.get(String(row.consolekey)) ?? null,
      baseCrcs: info.crcs,
      baseSha1s: info.sha1s,
      baseMd5s: info.md5s,
      // Verbatim No-Intro entry names ("Maniac Mansion (USA)") when the
      // submitter used a DAT-aware hasher.
      datNames: info.datNames,
      // 'Header (SNES)' | 'No-Header (SNES)' | 'Byte Swapped (N64)' |
      // 'BIN Format (GEN)' | 'Requires Custom Patcher' | …  — tells the compile
      // step which *form* of the base ROM the patch was authored against.
      patchHint: hints.get(String(row.patchhint)) ?? null,
      noFile: row.nofile === '1',
      ...extra,
    }
  }

  for (const h of tables.get('Hacks')) {
    add('hack', h, 'hackkey', {
      title: unescapeHtml(h.hacktitle),
      version: h.version || null,
      released: h.reldate && h.reldate !== 'Unknown' ? h.reldate : null,
      downloads: h.downloads ? parseInt(h.downloads, 10) : 0,
      description: unescapeHtml(h.description) || null,
      license: h.license || null,
      youtube: h.youtube || null,
    })
  }

  for (const t of tables.get('transdata')) {
    add('translation', t, 'transkey', {
      title: null, // translations have no title of their own — the game is the title
      version: t.patchver || null,
      released: t.patchrel && t.patchrel !== 'Unknown' ? t.patchrel : null,
      downloads: t.downloads ? parseInt(t.downloads, 10) : 0,
      description: unescapeHtml(t.description) || null,
      license: t.license || null,
      youtube: t.youtube || null,
      language: langs.get(String(t.language)) ?? null,
    })
  }

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    source: path.basename(SRC),
    generated: new Date().toISOString(),
    stats,
    entries,
  }))

  const mb = (fs.statSync(OUT_FILE).size / 1048576).toFixed(1)
  console.log(
    `\nWrote ${Object.keys(entries).length} entries to ${OUT_FILE} (${mb} MB)\n` +
    `  hacks=${stats.hack} translations=${stats.translation}\n` +
    `  with base-ROM hash=${stats.withHash} with canonical game=${stats.withGame} nofile=${stats.noFile}`
  )
}

build()
