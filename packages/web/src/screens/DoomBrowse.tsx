import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import type { IdgamesFile } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { VirtualKeyboard } from '../components/VirtualKeyboard'

interface Props {
  onBack: (didDownload: boolean) => void
}

type Mode = 'list' | 'detail' | 'search'

const star = (r?: number) => (r == null ? '—' : `${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))}`)

// On-demand browse/download of the Doomworld /idgames archive. Downloads extract
// straight into the Doom WAD folder, so the picker lists them on return.
export function DoomBrowse({ onBack }: Props) {
  const [mode, setMode] = useState<Mode>('list')
  const [files, setFiles] = useState<IdgamesFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)          // 0 = Search row, 1.. = results
  const [detail, setDetail] = useState<IdgamesFile | null>(null)
  const [query, setQuery] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [didDownload, setDidDownload] = useState(false)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  const loadLatest = useCallback(() => {
    setLoading(true); setError(null)
    api.doom.idgames.latest(25)
      .then(r => setFiles(r.files))
      .catch(e => setError(e instanceof Error ? e.message : 'idgames unavailable'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadLatest() }, [loadLatest])

  const runSearch = useCallback((q: string) => {
    setMode('list'); setFocus(1); setLoading(true); setError(null)
    api.doom.idgames.search(q)
      .then(r => setFiles(r.files))
      .catch(e => setError(e instanceof Error ? e.message : 'Search failed'))
      .finally(() => setLoading(false))
  }, [])

  const openDetail = useCallback((f: IdgamesFile) => {
    setDetail(f); setMode('detail')
    // Fetch the full record (list results are trimmed) for the description.
    api.doom.idgames.get(f.id).then(r => setDetail(r.file)).catch(() => {})
  }, [])

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

  useEffect(() => {
    if (mode === 'list') rowRefs.current[focus]?.scrollIntoView({ block: 'nearest' })
  }, [focus, mode])

  useGamepad((action) => {
    if (mode === 'detail') {
      if (action === 'back') { setMode('list'); return }
      if (action === 'confirm' && detail && !done.has(detail.id)) void download(detail)
      return
    }
    // list mode
    if (action === 'back') { onBack(didDownload); return }
    if (action === 'up') setFocus(i => Math.max(0, i - 1))
    if (action === 'down') setFocus(i => Math.min(files.length, i + 1))
    if (action === 'confirm') {
      if (focus === 0) { setMode('search'); return }
      const f = files[focus - 1]
      if (f) openDetail(f)
    }
  }, mode !== 'search')

  // ---- detail view ----
  if (mode === 'detail' && detail) {
    const got = done.has(detail.id)
    return (
      <div className="fixed inset-0 bg-vault-bg flex flex-col px-[6%] py-[4%]">
        <p className="text-vault-accent text-xs uppercase tracking-widest">idgames</p>
        <h1 className="text-white text-3xl font-extrabold mt-1">{detail.title || detail.filename}</h1>
        <p className="text-vault-muted text-sm mt-1">
          {detail.author || 'Unknown'} · {star(detail.rating)} {detail.votes != null ? `(${detail.votes})` : ''} · {detail.date || ''}
        </p>
        <p className="text-vault-muted text-[15px] leading-relaxed mt-4 max-w-3xl overflow-y-auto" style={{ maxHeight: '38vh', scrollbarWidth: 'none' }}>
          {detail.description || 'No description.'}
        </p>
        {detail.dir && <p className="text-vault-muted text-xs mt-3 font-mono">/idgames/{detail.dir}{detail.filename}</p>}
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

        <div className="mt-auto pt-6">
          <div className={[
            'inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wide',
            got ? 'bg-emerald-600/20 text-emerald-300' : 'bg-vault-accent text-white ring-2 ring-white',
          ].join(' ')}>
            {downloading ? 'Downloading…' : got ? '✓ Downloaded — in your WAD list' : <><Glyph type="cross" /> Download</>}
          </div>
          <p className="text-vault-muted text-xs uppercase tracking-wide mt-4 flex items-center gap-1.5">
            {!got && <><Glyph type="cross" /> Download  ·  </>}<Glyph type="circle" /> Back
          </p>
        </div>
      </div>
    )
  }

  // ---- search keyboard ----
  if (mode === 'search') {
    return (
      <div className="fixed inset-0 bg-vault-bg flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-[560px] space-y-4">
          <h2 className="text-white text-xl font-bold">Search idgames</h2>
          <div className="bg-vault-surface border border-vault-accent rounded-xl px-4 py-3 text-white text-lg min-h-[52px] break-all">
            {query || <span className="text-vault-muted">Title or keyword…</span>}
          </div>
          <VirtualKeyboard
            value={query}
            onChange={setQuery}
            onDone={() => { if (query.trim().length >= 2) runSearch(query.trim()) }}
            onCancel={() => setMode('list')}
            enabled={mode === 'search'}
            maxLength={40}
          />
        </div>
      </div>
    )
  }

  // ---- list view ----
  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <div className="flex items-center justify-between px-[5%] pt-[3%]">
        <div>
          <h1 className="text-white text-3xl font-extrabold tracking-tight">Get WADs</h1>
          <p className="text-vault-muted text-xs uppercase tracking-widest mt-1">Doomworld /idgames archive</p>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-[5%] pt-5">
        <div className="max-w-[640px] mx-auto flex flex-col gap-2 overflow-y-auto max-h-[68vh]" style={{ scrollbarWidth: 'none' }}>
          <div
            ref={el => { rowRefs.current[0] = el }}
            onMouseEnter={() => setFocus(0)}
            onClick={() => setMode('search')}
            className={[
              'flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer border border-dashed',
              focus === 0 ? 'border-vault-accent bg-vault-surface' : 'border-vault-muted',
            ].join(' ')}
          >
            <span className="text-vault-muted">🔍</span>
            <span className="text-[0.95rem] font-semibold text-white">Search…</span>
          </div>

          {loading ? (
            <p className="text-vault-muted text-sm text-center py-6">Loading…</p>
          ) : error ? (
            <p className="text-red-400 text-sm text-center py-6">{error}</p>
          ) : files.length === 0 ? (
            <p className="text-vault-muted text-sm text-center py-6">No results.</p>
          ) : (
            files.map((f, i) => {
              const idx = i + 1
              const focused = focus === idx
              const got = done.has(f.id)
              return (
                <div
                  key={f.id}
                  ref={el => { rowRefs.current[idx] = el }}
                  onMouseEnter={() => setFocus(idx)}
                  onClick={() => openDetail(f)}
                  className={[
                    'flex items-center gap-3.5 px-4 py-3 rounded-2xl cursor-pointer border',
                    focused ? 'bg-vault-surface ring-2 ring-vault-accent border-transparent' : 'bg-vault-card border-transparent',
                  ].join(' ')}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[0.95rem] font-semibold text-white truncate">{f.title || f.filename}</span>
                    <span className="block text-xs text-vault-muted uppercase tracking-wide mt-0.5 truncate">
                      {f.author || 'Unknown'} · {star(f.rating)}
                    </span>
                  </span>
                  {got && <span className="text-emerald-400 text-xs font-bold uppercase flex-shrink-0">✓ Got</span>}
                </div>
              )
            })
          )}
        </div>
      </div>

      <footer className="flex-shrink-0 px-[5%] pb-6 pt-3">
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> Open  ·  <Glyph type="circle" /> Back  ·  ↑↓ Navigate
        </p>
      </footer>
    </div>
  )
}
