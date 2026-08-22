import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { WadInfo, IdgamesReview } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { StatusBar } from '../components/StatusBar'
import { Breadcrumb, Title, Rule, HintBar, Tag } from '../components/ui'

interface Props {
  name: string
  /** First base game on disk — a PWAD launches on top of it. */
  defaultIwad?: string
  /** No IWAD present → a custom WAD can't launch; the action is disabled. */
  hasIwad: boolean
  onBack: () => void
  onDeleted: () => void
}

const rateNum = (r?: number) => (r == null ? '—' : r.toFixed(2))
const mb = (b?: number) => (b == null ? '—' : `${(b / 1_048_576).toFixed(1)} mb`)
const ext = (f: string) => (f.split('.').pop() ?? 'wad').toLowerCase()
const stem = (f: string) => f.replace(/\.[^.]+$/, '')
// idgames dir → breadcrumb tail: "levels/doom2/Ports/" → "levels / doom2 / ports".
const dirCrumb = (dir?: string) =>
  dir ? dir.replace(/\/+$/, '').split('/').filter(Boolean).join(' / ').toLowerCase() : 'wads'

// Full-page detail for a downloaded/custom WAD (design frame 3b). Reached from
// the downloaded-wads list in the Doom hub. Renders the archive record persisted
// at download time (title/author/rating/description); reviews load lazily after
// paint. Two actions: launch on the default IWAD, or delete the file.
export function WadDetail({ name, defaultIwad, hasIwad, onBack, onDeleted }: Props) {
  const [info, setInfo] = useState<WadInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviews, setReviews] = useState<IdgamesReview[] | null>(null)
  const [reviewTotal, setReviewTotal] = useState(0)
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [action, setAction] = useState(0)          // 0 = launch, 1 = delete
  const [launching, setLaunching] = useState(false)
  const [armDelete, setArmDelete] = useState(false) // delete needs a second confirm
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.doom.wadMeta(name)
      .then(r => { if (alive) setInfo(r) })
      .catch(() => { if (alive) setInfo({ name, meta: null }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [name])

  const meta = info?.meta ?? null
  const sourceId = meta?.sourceId
  const size = meta?.size ?? info?.size

  // Reviews fetch lazily once we know the archive id — deliberately off the
  // detail load so the page paints first (matches the mockup note).
  useEffect(() => {
    if (sourceId == null) { setReviews([]); return }
    let alive = true
    setReviewsLoading(true)
    api.doom.idgames.reviews(sourceId)
      .then(r => { if (alive) { setReviews(r.reviews); setReviewTotal(r.total) } })
      .catch(() => { if (alive) setReviews([]) })
      .finally(() => { if (alive) setReviewsLoading(false) })
    return () => { alive = false }
  }, [sourceId])

  const launch = useCallback(async () => {
    if (launching || !hasIwad) return
    setLaunching(true); setError(null)
    try {
      await api.doom.launch({ wad: name })
      // On the device the kiosk tears down and relaunches; if we're still here
      // after a moment we're on a dev machine — clear the spinner.
      setTimeout(() => setLaunching(false), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Launch failed')
      setLaunching(false)
    }
  }, [launching, hasIwad, name])

  const remove = useCallback(async () => {
    setError(null)
    try { await api.doom.deleteWad(name); onDeleted() }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); setArmDelete(false) }
  }, [name, onDeleted])

  useGamepad((a) => {
    if (launching) return
    if (a === 'back') { onBack(); return }
    if (a === 'up') { setAction(0); setArmDelete(false) }
    if (a === 'down') { setAction(1) }
    if (a === 'confirm') {
      if (action === 0) void launch()
      else if (armDelete) void remove()
      else setArmDelete(true)
    }
  }, true)

  const title = meta?.title || name
  const author = meta?.author || 'author unknown'
  const downloaded = meta?.downloadedAt ? meta.downloadedAt.slice(0, 10) : null

  const launchFocused = action === 0
  const deleteFocused = action === 1

  return (
    <div className="fixed inset-0 bg-idg-bg text-idg-text flex flex-col px-[5%] pt-[3.2%] pb-[2.5%] font-sans gap-6 overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0">
        <Breadcrumb mode="idg">idgames / {dirCrumb(meta?.dir)}</Breadcrumb>
        <StatusBar />
      </div>

      {/* Title + meta row */}
      <div className="flex-shrink-0">
        <Title mode="idg" className="text-[4.4rem]">{title}</Title>
        <div className="flex items-center gap-5 mt-3 text-idg-text/72 text-[1.15rem]">
          <Tag mode="idg">{ext(name)}</Tag>
          {!meta?.title && <span className="font-mono text-[0.9rem] tracking-[0.06em] text-idg-muted">no title returned · filename shown</span>}
          <span>{author}</span>
          <span className="text-idg-text/40">·</span>
          <span>{mb(size)}</span>
          <span className="flex-1" />
          <span className={`font-display font-semibold text-4xl ${meta?.rating != null ? 'text-idg-accent' : 'text-idg-text/50'}`}>{rateNum(meta?.rating)}</span>
          <span className="font-mono text-[0.9rem] tracking-[0.06em] text-idg-muted">
            {meta?.rating != null ? `of 5 · ${meta.votes ?? 0} votes` : 'not rated · 0 votes'}
          </span>
        </div>
      </div>

      <Rule mode="idg" />

      {/* Body: left info column + right action/review column */}
      <div className="flex-1 min-h-0 flex gap-[4.5%]">
        {/* Left */}
        <div className="flex-1 min-w-0 flex flex-col gap-6 overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
          {meta?.description ? (
            <p className="font-read text-[1.35rem] leading-[1.5] text-idg-text/82" style={{ ['textWrap' as string]: 'pretty' }}>
              {meta.description}
            </p>
          ) : (
            <div className="border border-idg-text/20 rounded-[4px] px-8 py-6 flex flex-col gap-3">
              <div className="font-mono text-[1.05rem] tracking-[0.12em] uppercase text-idg-accent">no description</div>
              <p className="font-read text-[1.3rem] leading-[1.45] text-idg-text/72">
                The archive carries no text file, so the fields below stay unknown. Nothing here blocks play — the file is downloaded and runnable now.
              </p>
            </div>
          )}

          {/* Honest spec grid — most fields need the .txt we don't store. */}
          <div className="grid grid-cols-[auto_1fr] gap-x-10 gap-y-3 font-mono text-[1.1rem] tracking-[0.02em]">
            <span className="text-idg-text/50">maps</span><span className="text-idg-text/60">unknown</span>
            <span className="text-idg-text/50">co-op / dm</span><span className="text-idg-text/60">unknown</span>
            <span className="text-idg-text/50">engine</span><span className="text-idg-text/60">unknown · defaults to lzdoom</span>
            <span className="text-idg-text/50">base</span><span className="text-idg-text/60">unknown</span>
            <span className="text-idg-text/50">downloaded</span>
            <span>{downloaded ? `${downloaded} · /wads/${stem(name)}` : `side-loaded · /wads/${stem(name)}`}</span>
          </div>
        </div>

        {/* Right */}
        <div className="w-[38%] flex-none flex flex-col gap-5 min-h-0">
          {/* Launch — primary CTA */}
          <div
            onClick={() => { setAction(0); void launch() }}
            className={[
              'flex items-center gap-6 px-6 py-4 rounded-[2px] border-l-[6px] cursor-pointer',
              !hasIwad
                ? 'border-transparent bg-black/20 text-idg-muted'
                : launchFocused
                  ? 'border-idg-gold bg-idg-fill text-idg-ink'
                  : 'border-idg-dim bg-idg-fill/15 text-idg-accent',
            ].join(' ')}
          >
            <span className={`w-7 text-3xl leading-none ${launchFocused && hasIwad ? '' : 'text-transparent'}`}>▸</span>
            <span className="font-display font-semibold text-4xl">{launching ? 'Launching…' : 'Launch'}</span>
            <span className="flex-1" />
            <span className={`font-mono text-[0.9rem] tracking-[0.06em] ${launchFocused && hasIwad ? 'text-idg-ink/70' : 'text-idg-muted'}`}>
              {hasIwad ? `${defaultIwad ?? 'default iwad'} + ${stem(name)}` : 'needs an iwad'}
            </span>
          </div>
          <div className="px-6 font-mono text-[0.85rem] tracking-[0.06em] uppercase text-idg-muted">
            {downloaded ? `downloaded ${downloaded} · lzdoom` : 'custom wad · lzdoom'}
          </div>

          {/* Delete */}
          <div
            onClick={() => { setAction(1); armDelete ? void remove() : setArmDelete(true) }}
            className={[
              'flex items-center gap-6 px-6 py-3 rounded-[2px] border-l-[6px] cursor-pointer',
              deleteFocused ? 'border-idg-gold bg-idg-fill text-idg-ink' : 'border-transparent text-idg-text/85',
            ].join(' ')}
          >
            <span className={`w-7 text-3xl leading-none ${deleteFocused ? '' : 'text-transparent'}`}>▸</span>
            <span className="text-2xl">{armDelete && deleteFocused ? 'Delete file — press again' : 'Delete file'}</span>
            <span className="flex-1" />
            <span className={`font-mono text-[0.9rem] ${deleteFocused ? 'text-idg-ink/70' : 'text-idg-muted'}`}>frees {mb(size)}</span>
          </div>

          <Rule mode="idg" />

          {/* Reviews — lazy */}
          <div className="flex-1 min-h-0 flex flex-col gap-3.5 overflow-hidden">
            <div className="flex items-center gap-6 font-mono text-[0.85rem] tracking-[0.14em] uppercase text-idg-muted">
              <span>reviews</span>
              <span className="flex-1 h-px bg-idg-text/10" />
              <span>{reviews && reviews.length ? `1–${reviews.length} of ${reviewTotal}` : reviewTotal || 0}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3.5 pr-1" style={{ scrollbarWidth: 'none' }}>
              {reviewsLoading || reviews == null ? (
                <p className="font-mono text-[0.9rem] text-idg-muted">loading reviews…</p>
              ) : reviews.length === 0 ? (
                <p className="font-read text-[1.3rem] text-idg-text/72">No reviews came back for this file.</p>
              ) : (
                reviews.map((rv, i) => (
                  <div key={i} className="flex gap-5">
                    <span className="font-mono text-[0.95rem] text-idg-accent flex-none pt-1">{rv.vote}/5</span>
                    <span className="font-read text-[1.15rem] leading-[1.4] text-idg-text/82">
                      {rv.text || <span className="text-idg-muted italic">no comment</span>}
                      {rv.username && <span className="font-mono text-[0.85rem] text-idg-muted"> — {rv.username}</span>}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm flex-shrink-0">{error}</p>}
      {loading && !info && <p className="text-idg-muted text-sm font-mono flex-shrink-0">loading…</p>}

      <footer className="flex-shrink-0">
        <HintBar mode="idg" hints={['d-pad move', 'a launch', 'a·a delete', 'b back']} />
      </footer>
    </div>
  )
}
