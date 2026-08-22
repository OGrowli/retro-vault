import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import type { DoomFavorite, IdgamesFile } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { StatusBar } from '../components/StatusBar'
import { Breadcrumb, Title, HintBar, Tag, rowClass, Caret } from '../components/ui'

interface Props {
  /** `changed` is true when a download or delete means the hub's WAD list is stale. */
  onBack: (changed: boolean) => void
}

const rateNum = (r?: number | null) => (r == null ? '—' : r.toFixed(2))
const mb = (b?: number | null) => (b == null ? '—' : `${(b / 1_048_576).toFixed(1)} mb`)
const label = (f: DoomFavorite) => f.title || f.name || f.filename || 'untitled'

// Saved WADs — the idgames-side equivalent of the RetroVault favorites list, as
// its own list view. Entries come in two states: already downloaded (A launches
// it) and saved-from-the-archive but not fetched yet (A downloads it). The
// archive fields were cached when the entry was saved, so this paints without
// waiting on Doomworld; only the description is fetched lazily.
export function DoomSaved({ onBack }: Props) {
  const [favorites, setFavorites] = useState<DoomFavorite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(false)
  const [detail, setDetail] = useState<Record<number, IdgamesFile>>({})
  // Archive ids whose text fetch failed — the Pi can be offline, or Doomworld
  // can be unreachable, and "loading…" forever reads as a hung screen.
  const [textFailed, setTextFailed] = useState<Set<number>>(new Set())
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  const load = useCallback(() => {
    api.doom.favorites()
      .then(r => setFavorites(r.favorites))
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load saved wads'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const current = favorites[focus]

  // Descriptions aren't cached with the saved row (they're long, and the row is
  // written from a trimmed record), so fill the focused one in after paint.
  useEffect(() => {
    const id = current?.sourceId
    if (id == null || detail[id] || textFailed.has(id)) return
    let alive = true
    const t = setTimeout(() => {
      api.doom.idgames.get(id)
        .then(r => { if (alive) setDetail(d => ({ ...d, [id]: r.file })) })
        .catch(() => { if (alive) setTextFailed(prev => new Set(prev).add(id)) })
    }, 180)
    return () => { alive = false; clearTimeout(t) }
  }, [current, detail, textFailed])

  useEffect(() => { rowRefs.current[focus]?.scrollIntoView({ block: 'nearest' }) }, [focus])

  // A = launch what's on disk, or fetch what isn't.
  const activate = useCallback(async (f: DoomFavorite) => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      if (f.downloaded && f.name) {
        await api.doom.launch({ wad: f.name })
        // On the device the kiosk tears down; still here after a moment = dev.
        setTimeout(() => setBusy(false), 4000)
        return
      }
      if (f.sourceId == null) { setError('This one is gone from the folder and has no archive record.'); return }
      await api.doom.idgames.download(f.sourceId)
      setChanged(true)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      if (!(f.downloaded && f.name)) setBusy(false)
    }
  }, [busy, load])

  const unsave = useCallback(async (f: DoomFavorite) => {
    setError(null)
    try {
      await api.doom.toggleFavorite(f.sourceId != null ? { sourceId: f.sourceId } : { name: f.name ?? '' })
      setFavorites(prev => prev.filter(x => x !== f))
      setFocus(i => Math.max(0, Math.min(i, favorites.length - 2)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unsave')
    }
  }, [favorites.length])

  useGamepad((action) => {
    if (action === 'back') { onBack(changed); return }
    if (action === 'up') setFocus(i => Math.max(0, i - 1))
    if (action === 'down') setFocus(i => Math.min(favorites.length - 1, i + 1))
    if (!current) return
    if (action === 'favorite') { void unsave(current); return }
    if (action === 'confirm') void activate(current)
  }, true)

  const d = current ? (current.sourceId != null ? detail[current.sourceId] : undefined) : undefined
  const description = d?.description

  return (
    <div className="fixed inset-0 bg-idg-bg text-idg-text flex flex-col px-[4%] pt-[2.5%] pb-5 font-sans">
      <div className="flex items-center justify-between flex-shrink-0">
        <Breadcrumb mode="idg">idgames / saved</Breadcrumb>
        <StatusBar />
      </div>

      <div className="flex items-baseline gap-4 mt-2 flex-shrink-0">
        <Title mode="idg" className="text-5xl">Saved</Title>
        <span className="font-mono text-[0.9rem] uppercase tracking-[0.1em] text-idg-muted">
          {favorites.length} wad{favorites.length === 1 ? '' : 's'}
          {' · '}
          {favorites.filter(f => f.downloaded).length} on disk
        </span>
      </div>

      <div className="flex-1 min-h-0 flex gap-8 pt-4">
        {/* Left: saved list */}
        <div className="w-[42%] flex flex-col gap-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
          {loading ? (
            <p className="text-idg-muted text-sm py-6 font-mono">loading…</p>
          ) : favorites.length === 0 ? (
            <p className="text-idg-muted text-sm py-6 font-mono">
              nothing saved yet. press y on an entry in browse, or on a downloaded wad, to save it here.
            </p>
          ) : (
            favorites.map((f, i) => {
              const focused = focus === i
              return (
                <div
                  key={`${f.sourceId ?? 'local'}:${f.name ?? ''}`}
                  ref={el => { rowRefs.current[i] = el }}
                  onMouseEnter={() => setFocus(i)}
                  onClick={() => setFocus(i)}
                  className={rowClass(focused, 'idg')}
                >
                  <Caret selected={focused} mode="idg" />
                  <span className="flex-1 min-w-0 text-lg truncate">{label(f)}</span>
                  <Tag mode="idg" dark={focused}>{f.downloaded ? 'on disk' : 'not downloaded'}</Tag>
                </div>
              )
            })
          )}
        </div>

        {/* Right: focused entry detail */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {!current ? (
            <div className="m-auto text-idg-muted text-sm font-mono">nothing selected.</div>
          ) : (
            <>
              <Title mode="idg" className="text-5xl">{label(current)}</Title>
              <div className="flex items-center gap-4 mt-3">
                <span className="text-idg-text/70 text-lg">{current.author || 'author unknown'}</span>
                {current.date && <><span className="text-idg-text/40">·</span><span className="text-idg-text/70 text-lg">{current.date}</span></>}
                <span className="flex-1" />
                <span className="font-display font-semibold text-4xl text-idg-accent">{rateNum(current.rating)}</span>
                <span className="font-mono text-[0.85rem] tracking-[0.06em] text-idg-muted">
                  of 5{current.votes != null ? ` · ${current.votes} votes` : ''}
                </span>
              </div>

              <div className="h-px bg-idg-text/15 my-5" />

              <p className="font-read text-[1.15rem] leading-[1.5] text-idg-text/82 overflow-y-auto flex-1" style={{ scrollbarWidth: 'none', ['textWrap' as string]: 'pretty' }}>
                {description || (current.sourceId == null
                  ? 'Saved from your wad folder — the archive has no record for this file.'
                  : textFailed.has(current.sourceId)
                    ? 'Could not reach the archive for the description — the saved details above still stand.'
                    : 'Loading the archive text…')}
              </p>

              <div className="flex items-center gap-4 mt-3 font-mono text-[0.75rem] text-idg-muted">
                <span>{mb(current.size)}</span>
                {current.name && <span className="truncate">{current.name}</span>}
                {current.dir && <span className="truncate">/idgames/{current.dir}{current.filename}</span>}
              </div>
            </>
          )}

          {error && <p className="text-red-400 text-sm py-2">{error}</p>}
          {busy && <p className="text-idg-accent text-sm py-2 font-mono">working…</p>}
        </div>
      </div>

      <footer className="flex-shrink-0 pt-4">
        <HintBar mode="idg" hints={['d-pad move', current?.downloaded ? 'a play' : 'a download', 'y unsave', 'b back to idgames']} />
      </footer>
    </div>
  )
}
