import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import type { IdgamesFile } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import idGamesLogo from '../assets/idgames-logo.webp'

interface Props {
  onBack: (didDownload: boolean) => void
}

const star = (r?: number) => (r == null ? '—' : `${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))}`)

// Browse/download the Doomworld /idgames archive — "Id Games". Two-pane like a
// RetroVault list view: results on the left, the focused entry's details on the
// right, updating as you navigate. Downloads extract into the Doom WAD folder.
export function DoomBrowse({ onBack }: Props) {
  const [files, setFiles] = useState<IdgamesFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)              // 0 = Search row, 1.. = results
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

  const runSearch = useCallback((q: string) => {
    setSearching(false); setFocus(1); setLoading(true); setError(null)
    api.doom.idgames.search(q)
      .then(r => setFiles(r.files))
      .catch(e => setError(e instanceof Error ? e.message : 'Search failed'))
      .finally(() => setLoading(false))
  }, [])

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
    if (action === 'confirm') {
      if (focus === 0) { setSearching(true); return }
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
            onMouseEnter={() => setFocus(0)}
            onClick={() => setSearching(true)}
            className={[
              'flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer border border-dashed flex-shrink-0',
              focus === 0 ? 'border-vault-accent bg-vault-surface' : 'border-vault-muted',
            ].join(' ')}
          >
            <span className="text-vault-muted">🔍</span>
            <span className="text-[0.9rem] font-semibold text-white">Search…</span>
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
          <Glyph type="cross" /> Download / Search  ·  <Glyph type="circle" /> Back  ·  ↑↓ Browse
        </p>
      </footer>
    </div>
  )
}
