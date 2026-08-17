import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import type { IdgamesFile, IdgamesSearchType, IdgamesSortKey } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import idGamesLogo from '../assets/idgames-logo.webp'

interface Props {
  onBack: (didDownload: boolean) => void
}

const star = (r?: number) => (r == null ? '—' : `${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))}`)

// idgames `search` knobs surfaced as cycle-able chips. Field = which record
// field the query matches; Sort = ordering key; Order = direction. These only
// affect search — the latest-uploads view ignores them (the API has no sort on
// latestfiles), so cycling them just sets the pref for the next search.
const FIELDS: { key: IdgamesSearchType; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'filename', label: 'Filename' },
  { key: 'description', label: 'Description' },
  { key: 'textfile', label: 'Text file' },
]
const SORTS: { key: IdgamesSortKey; label: string }[] = [
  { key: 'rating', label: 'Rating' },
  { key: 'date', label: 'Date' },
  { key: 'size', label: 'Size' },
  { key: 'filename', label: 'Name' },
]
const CTRL_COUNT = 4 // Search · Field · Sort · Order

// Browse/download the Doomworld /idgames archive — "Id Games". Two-pane like a
// RetroVault list view: results on the left, the focused entry's details on the
// right, updating as you navigate. Downloads extract into the Doom WAD folder.
export function DoomBrowse({ onBack }: Props) {
  const [files, setFiles] = useState<IdgamesFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)              // 0 = control row, 1.. = results
  const [ctrl, setCtrl] = useState(0)                // which control chip (0..3) when focus === 0
  const [field, setField] = useState<IdgamesSearchType>('title')
  const [sort, setSort] = useState<IdgamesSortKey>('rating')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [lastQuery, setLastQuery] = useState('')     // active search query (empty = latest view)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)  // keyboard overlay open
  const [downloading, setDownloading] = useState(false)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [didDownload, setDidDownload] = useState(false)
  const [detail, setDetail] = useState<Record<number, IdgamesFile>>({}) // id -> full record
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  const loadLatest = useCallback(() => {
    setLoading(true); setError(null)
    api.doom.idgames.latest(40)
      .then(r => setFiles(r.files))
      .catch(e => setError(e instanceof Error ? e.message : 'Id Games unavailable'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadLatest() }, [loadLatest])

  // `over` lets a control chip re-run the active query with a just-changed knob
  // without waiting for the state update to land in this closure.
  const runSearch = useCallback((q: string, over?: { field?: IdgamesSearchType; sort?: IdgamesSortKey; order?: 'asc' | 'desc' }) => {
    setSearching(false); setLastQuery(q); setFocus(1); setLoading(true); setError(null)
    api.doom.idgames.search(q, {
      type: over?.field ?? field,
      sort: over?.sort ?? sort,
      dir: over?.order ?? order,
    })
      .then(r => setFiles(r.files))
      .catch(e => setError(e instanceof Error ? e.message : 'Search failed'))
      .finally(() => setLoading(false))
  }, [field, sort, order])

  // Cycle a control chip; if a search is active, re-run it with the new value.
  const cycleField = useCallback(() => {
    const next = FIELDS[(FIELDS.findIndex(x => x.key === field) + 1) % FIELDS.length].key
    setField(next); if (lastQuery) runSearch(lastQuery, { field: next })
  }, [field, lastQuery, runSearch])
  const cycleSort = useCallback(() => {
    const next = SORTS[(SORTS.findIndex(x => x.key === sort) + 1) % SORTS.length].key
    setSort(next); if (lastQuery) runSearch(lastQuery, { sort: next })
  }, [sort, lastQuery, runSearch])
  const toggleOrder = useCallback(() => {
    const next = order === 'desc' ? 'asc' : 'desc'
    setOrder(next); if (lastQuery) runSearch(lastQuery, { order: next })
  }, [order, lastQuery, runSearch])
  const activateCtrl = useCallback((i: number) => {
    if (i === 0) setSearching(true)
    else if (i === 1) cycleField()
    else if (i === 2) cycleSort()
    else toggleOrder()
  }, [cycleField, cycleSort, toggleOrder])

  const current = focus > 0 ? files[focus - 1] : undefined

  // Lazy-fetch the full record (dir/date/size/credits) for the focused entry.
  useEffect(() => {
    if (!current || detail[current.id]) return
    let alive = true
    api.doom.idgames.get(current.id).then(r => { if (alive) setDetail(d => ({ ...d, [current.id]: r.file })) }).catch(() => {})
    return () => { alive = false }
  }, [current, detail])

  useEffect(() => { rowRefs.current[focus]?.scrollIntoView({ block: 'nearest' }) }, [focus])

  const download = useCallback(async (f: IdgamesFile) => {
    if (downloading) return
    setDownloading(true); setError(null)
    try {
      await api.doom.idgames.download(f.id)
      setDone(prev => new Set(prev).add(f.id))
      setDidDownload(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }, [downloading])

  useGamepad((action) => {
    if (searching) return
    if (action === 'back') { onBack(didDownload); return }
    if (action === 'up') setFocus(i => Math.max(0, i - 1))
    if (action === 'down') setFocus(i => Math.min(files.length, i + 1))
    if (action === 'left' && focus === 0) setCtrl(i => Math.max(0, i - 1))
    if (action === 'right' && focus === 0) setCtrl(i => Math.min(CTRL_COUNT - 1, i + 1))
    if (action === 'confirm') {
      if (focus === 0) { activateCtrl(ctrl); return }
      if (current && !done.has(current.id)) void download(current)
    }
  }, !searching)

  // ---- search keyboard overlay ----
  if (searching) {
    return (
      <div className="fixed inset-0 bg-vault-bg flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-[560px] space-y-4">
          <h2 className="text-white text-xl font-bold">Search Id Games</h2>
          <div className="bg-vault-surface border border-vault-accent rounded-xl px-4 py-3 text-white text-lg min-h-[52px] break-all">
            {query || <span className="text-vault-muted">Title or keyword…</span>}
          </div>
          <VirtualKeyboard
            value={query}
            onChange={setQuery}
            onDone={() => { if (query.trim().length >= 2) runSearch(query.trim()) }}
            onCancel={() => setSearching(false)}
            enabled={searching}
            maxLength={40}
          />
        </div>
      </div>
    )
  }

  const d = current ? (detail[current.id] ?? current) : undefined
  const got = current ? done.has(current.id) : false

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="flex items-center gap-3 px-[4%] pt-[2.5%] pb-3">
        <img src={idGamesLogo} alt="Id Games" className="h-9 w-auto object-contain" />
        <div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight leading-none">Id Games</h1>
          <p className="text-vault-muted text-[0.65rem] uppercase tracking-widest mt-1">Doomworld archive · browse &amp; download</p>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex gap-5 px-[4%] pb-4">
        {/* Left: results list */}
        <div className="w-[42%] flex flex-col gap-1.5 overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
          <div
            ref={el => { rowRefs.current[0] = el }}
            className="flex items-center gap-1.5 flex-wrap flex-shrink-0"
          >
            {(() => {
              const chip = (i: number, dashed = false) => [
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-[0.8rem] text-white cursor-pointer border flex-shrink-0',
                dashed ? 'border-dashed' : '',
                focus === 0 && ctrl === i ? 'border-vault-accent bg-vault-surface' : 'border-transparent bg-vault-card',
              ].join(' ')
              const lbl = (t: string) => <span className="text-vault-muted text-[0.58rem] uppercase tracking-wider">{t}</span>
              return (
                <>
                  <div onMouseEnter={() => { setFocus(0); setCtrl(0) }} onClick={() => { setFocus(0); setCtrl(0); setSearching(true) }} className={chip(0, true)}>
                    <span className="text-vault-muted">🔍</span><span className="font-semibold">Search…</span>
                  </div>
                  <div onMouseEnter={() => { setFocus(0); setCtrl(1) }} onClick={() => { setFocus(0); setCtrl(1); cycleField() }} className={chip(1)}>
                    {lbl('Field')}<span className="font-semibold">{FIELDS.find(x => x.key === field)!.label}</span>
                  </div>
                  <div onMouseEnter={() => { setFocus(0); setCtrl(2) }} onClick={() => { setFocus(0); setCtrl(2); cycleSort() }} className={chip(2)}>
                    {lbl('Sort')}<span className="font-semibold">{SORTS.find(x => x.key === sort)!.label}</span>
                  </div>
                  <div onMouseEnter={() => { setFocus(0); setCtrl(3) }} onClick={() => { setFocus(0); setCtrl(3); toggleOrder() }} className={chip(3)}>
                    {lbl('Order')}<span className="font-semibold">{order === 'desc' ? '↓ Desc' : '↑ Asc'}</span>
                  </div>
                </>
              )
            })()}
          </div>

          {loading ? (
            <p className="text-vault-muted text-sm text-center py-6">Loading…</p>
          ) : error && files.length === 0 ? (
            <p className="text-red-400 text-sm text-center py-6">{error}</p>
          ) : files.length === 0 ? (
            <p className="text-vault-muted text-sm text-center py-6">No results.</p>
          ) : (
            files.map((f, i) => {
              const idx = i + 1
              const focused = focus === idx
              return (
                <div
                  key={f.id}
                  ref={el => { rowRefs.current[idx] = el }}
                  onMouseEnter={() => setFocus(idx)}
                  onClick={() => setFocus(idx)}
                  className={[
                    'flex items-center gap-2 px-4 py-2.5 rounded-xl cursor-pointer border flex-shrink-0',
                    focused ? 'bg-vault-surface ring-2 ring-vault-accent border-transparent' : 'bg-vault-card border-transparent',
                  ].join(' ')}
                >
                  <span className="flex-1 min-w-0 text-[0.88rem] font-semibold text-white truncate">{f.title || f.filename}</span>
                  {done.has(f.id) && <span className="text-emerald-400 text-[10px] font-bold uppercase flex-shrink-0">✓</span>}
                </div>
              )
            })
          )}
        </div>

        {/* Right: focused entry detail */}
        <div className="flex-1 min-w-0 bg-vault-card rounded-2xl p-6 flex flex-col overflow-hidden">
          {!d ? (
            <div className="m-auto text-vault-muted text-sm">Select an entry, or press Search.</div>
          ) : (
            <>
              <h2 className="text-white text-2xl font-extrabold leading-tight">{d.title || d.filename}</h2>
              <p className="text-vault-muted text-sm mt-1">
                {d.author || 'Unknown'} · {star(d.rating)}{d.votes != null ? ` (${d.votes})` : ''}{d.date ? ` · ${d.date}` : ''}
              </p>
              <p className="text-vault-muted text-[15px] leading-relaxed mt-4 overflow-y-auto flex-1" style={{ scrollbarWidth: 'none' }}>
                {d.description || 'No description.'}
              </p>
              {d.dir && <p className="text-vault-muted text-[0.65rem] mt-3 font-mono truncate">/idgames/{d.dir}{d.filename}</p>}

              <div className="mt-4 flex items-center gap-3">
                <span className={[
                  'px-5 py-2.5 rounded-xl font-bold text-sm uppercase tracking-wide inline-flex items-center gap-2',
                  got ? 'bg-emerald-600/20 text-emerald-300' : 'bg-vault-accent text-white',
                ].join(' ')}>
                  {downloading ? 'Downloading…' : got ? '✓ In your WAD list' : <><Glyph type="cross" /> Download</>}
                </span>
                {error && <span className="text-red-400 text-sm">{error}</span>}
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="flex-shrink-0 px-[4%] pb-5">
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> Download / Search  ·  <Glyph type="circle" /> Back  ·  ↑↓ Browse  ·  ←→ Filter &amp; sort
        </p>
      </footer>
    </div>
  )
}
