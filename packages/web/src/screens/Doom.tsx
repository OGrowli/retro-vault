import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'
import { DoomBrowse } from './DoomBrowse'

interface Props {
  onBack: () => void
}

type Item =
  | { kind: 'online' }
  | { kind: 'browse' }
  | { kind: 'iwad'; name: string }
  | { kind: 'wad'; name: string }

// Friendly names for the recognised base games; falls back to the filename.
const IWAD_LABELS: Record<string, string> = {
  'doom.wad': 'Doom',
  'doom1.wad': 'Doom (Shareware)',
  'doom2.wad': 'Doom II',
  'tnt.wad': 'Final Doom — TNT: Evilution',
  'plutonia.wad': 'Final Doom — The Plutonia Experiment',
  'freedoom1.wad': 'Freedoom: Phase 1',
  'freedoom2.wad': 'Freedoom: Phase 2',
  'heretic.wad': 'Heretic',
  'hexen.wad': 'Hexen',
  'strife1.wad': 'Strife',
  'chex.wad': 'Chex Quest',
}
const iwadLabel = (f: string) => IWAD_LABELS[f.toLowerCase()] ?? f

// Simple folder-listing launcher — NOT wired into the SQLite game/scrape
// pipeline. Row order: Online (server browser), base games, then custom PWADs.
export function Doom({ onBack }: Props) {
  const [iwads, setIwads] = useState<string[]>([])
  const [wads, setWads] = useState<string[]>([])
  const [onlineReady, setOnlineReady] = useState(false)
  const [dir, setDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [focus, setFocus] = useState(0)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  const loadWads = useCallback(() => {
    api.doom.wads()
      .then(r => { setIwads(r.iwads); setWads(r.wads); setDir(r.dir); setOnlineReady(r.onlineReady); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadWads() }, [loadWads])

  const items: Item[] = [
    { kind: 'online' },
    { kind: 'browse' },
    ...iwads.map(name => ({ kind: 'iwad', name } as const)),
    ...wads.map(name => ({ kind: 'wad', name } as const)),
  ]
  const hasIwad = iwads.length > 0

  useEffect(() => {
    rowRefs.current[focus]?.scrollIntoView({ block: 'nearest' })
  }, [focus])

  const launch = useCallback(async (opts: { online?: boolean; iwad?: string; wad?: string }) => {
    if (launching) return
    setLaunching(true)
    setError(null)
    try {
      await api.doom.launch(opts)
      // On success the kiosk tears down and Chromium relaunches to the landing
      // screen; nothing more to do. If we're still here after a moment, the
      // launch didn't take the display (dev machine) — clear the spinner.
      setTimeout(() => setLaunching(false), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Launch failed')
      setLaunching(false)
    }
  }, [launching])

  const activate = useCallback((idx: number) => {
    const item = items[idx]
    if (!item) return
    if (item.kind === 'online') { if (onlineReady) void launch({ online: true }) }
    else if (item.kind === 'browse') setBrowsing(true)
    else if (item.kind === 'iwad') void launch({ iwad: item.name })
    else void launch({ wad: item.name })
  }, [items, launch, onlineReady])

  useGamepad((action) => {
    if (launching) return
    if (action === 'back') { onBack(); return }
    if (action === 'up') setFocus(i => Math.max(0, i - 1))
    if (action === 'down') setFocus(i => Math.min(items.length - 1, i + 1))
    if (action === 'confirm') activate(focus)
  }, !browsing)

  const Row = ({ idx, label, sub, dim }: { idx: number; label: string; sub?: string; dim?: boolean }) => {
    const focused = focus === idx
    return (
      <div
        ref={el => { rowRefs.current[idx] = el }}
        onMouseEnter={() => setFocus(idx)}
        onClick={() => activate(idx)}
        className={[
          'flex items-center gap-3.5 px-4 py-3.5 rounded-2xl cursor-pointer',
          'border transition-[box-shadow,transform] duration-150 motion-reduce:transition-none',
          focused ? 'bg-vault-surface ring-2 ring-vault-accent scale-[1.01] border-transparent' : 'bg-vault-card border-transparent',
        ].join(' ')}
      >
        <span className="flex-1 min-w-0">
          <span className={`block text-[0.95rem] font-semibold ${dim ? 'text-vault-muted' : 'text-white'} truncate`}>{label}</span>
          {sub && <span className="block text-xs text-vault-muted uppercase tracking-wide mt-0.5">{sub}</span>}
        </span>
        {focused && <span className="text-vault-accent text-xs font-bold uppercase tracking-wide flex-shrink-0">Play</span>}
      </div>
    )
  }

  const Header = ({ text }: { text: string }) => (
    <p className="text-vault-muted text-xs uppercase tracking-widest mt-4 mb-1 px-1">{text}</p>
  )

  if (browsing) {
    return <DoomBrowse onBack={(didDownload) => { setBrowsing(false); if (didDownload) loadWads() }} />
  }

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <div className="flex items-center justify-between px-[5%] pt-[3%]">
        <div>
          <h1 className="text-white text-3xl font-extrabold tracking-tight">DOOM</h1>
          <p className="text-vault-muted text-xs uppercase tracking-widest mt-1">Pick a game</p>
        </div>
        <Clock />
      </div>

      <div className="flex-1 overflow-hidden px-[5%] pt-6">
        <div className="max-w-[560px] mx-auto flex flex-col gap-2 overflow-y-auto max-h-[62vh]" style={{ scrollbarWidth: 'none' }}>
          {loading ? (
            <p className="text-vault-muted text-sm text-center py-6">Loading…</p>
          ) : (
            <>
              <Row idx={0}
                label={onlineReady ? 'Online — Server Browser' : 'Online — Coming Soon'}
                sub={onlineReady ? 'Browse & join live public games' : 'Multiplayer port not installed yet'}
                dim={!onlineReady} />
              <Row idx={1} label="Get More WADs" sub="Browse & download from /idgames" />

              {iwads.length > 0 && <Header text="Base Games" />}
              {iwads.map((f, i) => (
                <Row key={f} idx={2 + i} label={iwadLabel(f)} sub={f} />
              ))}

              {wads.length > 0 && <Header text="Custom WADs" />}
              {wads.map((w, i) => (
                <Row key={w} idx={2 + iwads.length + i} label={w} dim={!hasIwad} />
              ))}

              {iwads.length === 0 && wads.length === 0 && (
                <p className="text-vault-muted text-sm text-center py-4">
                  No WADs found. Drop IWADs / .wad / .pk3 files in{dir ? ` ${dir}` : ' the Doom folder'} to list them here.
                </p>
              )}
              {!hasIwad && wads.length > 0 && (
                <p className="text-amber-400/80 text-xs text-center py-2">
                  No IWAD (doom2.wad / freedoom2.wad) in the folder — custom WADs need one to launch.
                </p>
              )}
            </>
          )}

          {error && <p className="text-red-400 text-sm text-center py-2">{error}</p>}
          {launching && <p className="text-vault-accent-bright text-sm text-center py-2">Launching…</p>}
        </div>
      </div>

      <footer className="flex-shrink-0 px-[5%] pb-6 pt-3">
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> Play  ·  <Glyph type="circle" /> Back  ·  ↑↓ Navigate
        </p>
      </footer>
    </div>
  )
}
