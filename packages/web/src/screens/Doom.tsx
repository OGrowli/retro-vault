import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { StatusBar } from '../components/StatusBar'
import { Breadcrumb, Title, SectionHeader, HintBar, Tag, rowClass, Caret } from '../components/ui'
import { DoomBrowse } from './DoomBrowse'
import { WadDetail } from './WadDetail'

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
  const [detailWad, setDetailWad] = useState<string | null>(null)
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
    else setDetailWad(item.name) // custom WAD → open its detail page
  }, [items, launch, onlineReady])

  useGamepad((action) => {
    if (launching) return
    if (action === 'back') { onBack(); return }
    if (action === 'up') setFocus(i => Math.max(0, i - 1))
    if (action === 'down') setFocus(i => Math.min(items.length - 1, i + 1))
    if (action === 'confirm') activate(focus)
  }, !browsing && !detailWad)

  const Row = ({ idx, label, sub, tag, dim }: { idx: number; label: string; sub?: string; tag?: string; dim?: boolean }) => {
    const focused = focus === idx
    return (
      <div
        ref={el => { rowRefs.current[idx] = el }}
        onMouseEnter={() => setFocus(idx)}
        onClick={() => activate(idx)}
        className={[rowClass(focused, 'idg'), dim && !focused ? 'opacity-60' : ''].join(' ')}
      >
        <Caret selected={focused} mode="idg" />
        <span className="truncate text-xl">{label}</span>
        {tag && <Tag mode="idg" dark={focused}>{tag}</Tag>}
        <span className="flex-1" />
        {sub && (
          <span className={`font-mono text-[0.85rem] tracking-[0.06em] ${focused ? 'text-idg-ink/70' : 'text-idg-muted'}`}>
            {focused && !tag ? `${sub}  ·  a launch` : sub}
          </span>
        )}
      </div>
    )
  }

  if (browsing) {
    return <DoomBrowse onBack={(didDownload) => { setBrowsing(false); if (didDownload) loadWads() }} />
  }

  if (detailWad) {
    return (
      <WadDetail
        name={detailWad}
        defaultIwad={iwads[0]}
        hasIwad={hasIwad}
        onBack={() => setDetailWad(null)}
        onDeleted={() => { setDetailWad(null); setFocus(0); loadWads() }}
      />
    )
  }

  return (
    <div className="fixed inset-0 bg-idg-bg text-idg-text flex flex-col px-[5%] py-[3%] font-sans">
      <div className="flex items-center justify-between flex-shrink-0">
        <Breadcrumb mode="idg">landing / idgames</Breadcrumb>
        <StatusBar />
      </div>

      <div className="flex items-baseline gap-4 mt-4 flex-shrink-0">
        <Title mode="idg" className="text-6xl">idGames</Title>
        <span className="font-mono text-[0.9rem] uppercase tracking-[0.1em] text-idg-muted">
          {iwads.length} iwads · {wads.length} custom wads · lzdoom
        </span>
      </div>

      <div className="flex-1 overflow-hidden pt-6 min-h-0">
        <div className="flex flex-col overflow-y-auto h-full" style={{ scrollbarWidth: 'none' }}>
          {loading ? (
            <p className="text-idg-muted text-sm py-6 font-mono">loading…</p>
          ) : (
            <>
              {iwads.length > 0 && <div className="mb-2"><SectionHeader mode="idg" label="base games" /></div>}
              {iwads.map((f, i) => (
                <Row key={f} idx={2 + i} label={iwadLabel(f)} tag="iwad" sub={f} />
              ))}

              <div className="my-2"><SectionHeader mode="idg" label="library" /></div>
              <Row idx={1} label="Get More — browse the archive" sub="search the doomworld archive" />
              <Row idx={0}
                label={onlineReady ? 'Online multiplayer' : 'Online multiplayer'}
                sub={onlineReady ? 'browse & join live public games' : 'unavailable · no server configured'}
                dim={!onlineReady} />

              {wads.length > 0 && <div className="mt-3 mb-2"><SectionHeader mode="idg" label="downloaded wads" /></div>}
              {wads.map((w, i) => (
                <Row key={w} idx={2 + iwads.length + i} label={w} tag="wad" dim={!hasIwad} />
              ))}

              {iwads.length === 0 && wads.length === 0 && (
                <p className="text-idg-muted text-sm py-4 font-mono">
                  no wads found. drop iwads / .wad / .pk3 files in{dir ? ` ${dir}` : ' the doom folder'} to list them here.
                </p>
              )}
              {!hasIwad && wads.length > 0 && (
                <p className="text-idg-accent text-xs py-2 font-mono">
                  no iwad (doom2.wad / freedoom2.wad) in the folder — custom wads need one to launch.
                </p>
              )}
            </>
          )}

          {error && <p className="text-red-400 text-sm py-2">{error}</p>}
          {launching && <p className="text-idg-accent text-sm py-2 font-mono">launching…</p>}
        </div>
      </div>

      <footer className="flex-shrink-0 pt-4">
        <HintBar mode="idg" hints={['d-pad move', 'a launch', 'b back to landing']} />
      </footer>
    </div>
  )
}
