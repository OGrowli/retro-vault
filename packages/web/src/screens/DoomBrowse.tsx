import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import type { IdgamesFile, IdgamesSearchType, IdgamesSortKey } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { Breadcrumb, Title, HintBar, Tag, rowClass, Caret } from '../components/ui'

interface Props {
  onBack: (didDownload: boolean) => void
}

const rateNum = (r?: number) => (r == null ? '—' : r.toFixed(2))

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
      <div className="fixed inset-0 bg-idg-bg text-idg-text flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-[560px] space-y-4">
          <Title mode="idg" className="text-4xl">Search the archive</Title>
          <div className="bg-black/20 border border-idg-dim rounded-[2px] px-4 py-3 text-idg-text text-lg min-h-[52px] break-all font-mono">
            {query || <span className="text-idg-muted">title or keyword…</span>}
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
    <div className="fixed inset-0 bg-idg-bg text-idg-text flex flex-col px-[4%] pt-[2.5%] pb-5 font-sans">
      <Breadcrumb mode="idg">idgames / browse</Breadcrumb>

      <div className="flex-1 min-h-0 flex gap-8 pt-4">
        {/* Left: control row + results list */}
        <div className="w-[42%] flex flex-col gap-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
          <div
            ref={el => { rowRefs.current[0] = el }}
            className="flex items-center gap-2 flex-wrap flex-shrink-0"
          >
            {(() => {
              const chip = (i: number) => [
                'flex items-center gap-2 px-3 py-2 rounded-[2px] font-mono text-[0.8rem] cursor-pointer border flex-shrink-0',
                focus === 0 && ctrl === i ? 'border-idg-dim bg-idg-fill text-idg-ink' : 'border-idg-dim/50 text-idg-text',
              ].join(' ')
              const lbl = (t: string) => <span className="text-idg-muted text-[0.6rem] uppercase tracking-[0.12em]">{t}</span>
              return (
                <>
                  <div onMouseEnter={() => { setFocus(0); setCtrl(0) }} onClick={() => { setFocus(0); setCtrl(0); setSearching(true) }} className={chip(0)}>
                    <span>search the archive</span>
                  </div>
                  <div onMouseEnter={() => { setFocus(0); setCtrl(1) }} onClick={() => { setFocus(0); setCtrl(1); cycleField() }} className={chip(1)}>
                    {lbl('field')}<span>{FIELDS.find(x => x.key === field)!.label.toLowerCase()}</span>
                  </div>
                  <div onMouseEnter={() => { setFocus(0); setCtrl(2) }} onClick={() => { setFocus(0); setCtrl(2); cycleSort() }} className={chip(2)}>
                    {lbl('sort')}<span>{SORTS.find(x => x.key === sort)!.label.toLowerCase()} {order === 'desc' ? '↓' : '↑'}</span>
                  </div>
                  <div onMouseEnter={() => { setFocus(0); setCtrl(3) }} onClick={() => { setFocus(0); setCtrl(3); toggleOrder() }} className={chip(3)}>
                    {lbl('order')}<span>{order === 'desc' ? 'desc' : 'asc'}</span>
                  </div>
                </>
              )
            })()}
          </div>

          {loading ? (
            <p className="text-idg-muted text-sm py-6 font-mono">loading…</p>
          ) : error && files.length === 0 ? (
            <p className="text-red-400 text-sm py-6">{error}</p>
          ) : files.length === 0 ? (
            <p className="text-idg-muted text-sm py-6 font-mono">no results.</p>
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
                  className={rowClass(focused, 'idg')}
                >
                  <Caret selected={focused} mode="idg" />
                  <span className="flex-1 min-w-0 text-lg truncate">{f.title || f.filename}</span>
                  {done.has(f.id) && <Tag mode="idg" dark={focused}>downloaded</Tag>}
                </div>
              )
            })
          )}
        </div>

        {/* Right: focused entry detail */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {!d ? (
            <div className="m-auto text-idg-muted text-sm font-mono">select an entry, or press search.</div>
          ) : (
            <>
              <Title mode="idg" className="text-5xl">{d.title || d.filename}</Title>
              <div className="flex items-center gap-4 mt-3">
                <span className="text-idg-text/70 text-lg">{d.author || 'author unknown'}</span>
                {d.date && <><span className="text-idg-text/40">·</span><span className="text-idg-text/70 text-lg">{d.date}</span></>}
                <span className="flex-1" />
                <span className="font-display font-semibold text-4xl text-idg-accent">{rateNum(d.rating)}</span>
                <span className="font-mono text-[0.85rem] tracking-[0.06em] text-idg-muted">of 5{d.votes != null ? ` · ${d.votes} votes` : ''}</span>
              </div>

              <div className="h-px bg-idg-text/15 my-5" />

              <p className="font-read text-[1.15rem] leading-[1.5] text-idg-text/82 overflow-y-auto flex-1" style={{ scrollbarWidth: 'none', ['textWrap' as string]: 'pretty' }}>
                {d.description || 'The archive carries no text file, so nothing here describes the file yet.'}
              </p>
              {d.dir && <p className="text-idg-muted text-[0.75rem] mt-3 font-mono truncate">/idgames/{d.dir}{d.filename}</p>}

              <div className="mt-5 flex items-center gap-4">
                <span className={[
                  'px-6 py-3 rounded-[2px] border-l-[6px] font-mono uppercase tracking-[0.08em] text-sm inline-flex items-center gap-3',
                  got ? 'border-idg-dim bg-idg-bg text-idg-accent' : 'border-idg-gold bg-idg-fill text-idg-ink',
                ].join(' ')}>
                  {downloading ? 'downloading…' : got ? '✓ in your wad list' : '▸ download'}
                </span>
                {error && <span className="text-red-400 text-sm">{error}</span>}
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="flex-shrink-0 pt-4">
        <HintBar mode="idg" hints={['d-pad move', 'a download', 'x field / sort', 'b back to idgames']} />
      </footer>
    </div>
  )
}
