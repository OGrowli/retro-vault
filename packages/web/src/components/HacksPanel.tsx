import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Game, User, RomHack } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { VirtualKeyboard } from './VirtualKeyboard'
import { Title, HintBar, rowClass, Caret } from './ui'

interface Props {
  game: Game
  user: User
  onClose: () => void
}

// A search row only earns its place once the list is long enough to scroll past.
const SEARCH_THRESHOLD = 10

// Hack titles run long ("... Redux Hard Mode (v1.3 English)") and the row
// truncates them. On the focused row, after a short dwell, slide the text so the
// tail is readable. Cheap on the Pi: one transform-only animation on one element
// at a time — composited, no layout or paint per frame.
function ScrollingTitle({ text, focused }: { text: string; focused: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)

  useEffect(() => {
    setShift(0)
    if (!focused) return
    const el = ref.current
    if (!el) return
    const over = el.scrollWidth - el.clientWidth
    if (over <= 4) return
    const t = setTimeout(() => setShift(over), 700)
    return () => clearTimeout(t)
  }, [focused, text])

  // ~55px/s of travel, with the keyframe holds folded in.
  const duration = Math.round(shift * 18 + 1800)

  return (
    <span className="flex-1 min-w-0 overflow-hidden">
      <span
        ref={ref}
        className={
          shift
            ? 'block whitespace-nowrap text-xl animate-marquee motion-reduce:animate-none'
            : 'block truncate text-xl'
        }
        style={shift ? ({ '--mq-shift': `-${shift}px`, animationDuration: `${duration}ms` } as CSSProperties) : undefined}
      >
        {text}
      </span>
    </span>
  )
}

// Browse the ROM hacks matched to this game, then compile a patch onto a base
// ROM and play it. Matching + patches come from the RHDN ingest; this panel is
// read-mostly and reuses the normal ROM launch under the hood.
export function HacksPanel({ game, user, onClose }: Props) {
  const [hacks, setHacks] = useState<RomHack[]>([])
  const [loading, setLoading] = useState(true)
  const [focus, setFocus] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false) // keyboard overlay open
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    api.hacks.forGame(game.id)
      .then(r => { setHacks(r.hacks); setLoading(false) })
      .catch(() => setLoading(false))
  }, [game.id])

  const searchable = hacks.length > SEARCH_THRESHOLD
  const off = searchable ? 1 : 0 // row 0 is the search row when present

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return hacks
    return hacks.filter(h =>
      h.title.toLowerCase().includes(q) || (h.author ?? '').toLowerCase().includes(q))
  }, [hacks, query])

  // The one row whose description is on screen (the search row has none).
  const focusedHack = filtered[focus - off]

  // Filtering shrinks the list under the cursor; keep focus in range.
  useEffect(() => {
    setFocus(f => Math.min(f, Math.max(0, filtered.length + off - 1)))
  }, [filtered.length, off])

  useEffect(() => { rowRefs.current[focus]?.scrollIntoView({ block: 'nearest' }) }, [focus])

  const compileAndPlay = useCallback(async (hack: RomHack) => {
    if (busy) return
    setBusy(true); setStatus(`Compiling ${hack.title}…`)
    try {
      const { romId } = await api.hacks.compile(hack.id)
      setStatus('Launching…')
      await api.roms.launch(romId, user.id, false)
      // Kiosk tears down on a real device; if we're still here it's dev.
      setTimeout(() => setBusy(false), 4000)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Compile failed')
      setBusy(false)
    }
  }, [busy, user.id])

  useGamepad((action) => {
    if (busy) return
    if (action === 'back') { onClose(); return }
    if (action === 'favorite' && searchable) { setSearching(true); return }
    if (action === 'up') setFocus(i => Math.max(0, i - 1))
    if (action === 'down') setFocus(i => Math.min(filtered.length + off - 1, i + 1))
    if (action === 'confirm') {
      if (searchable && focus === 0) { setSearching(true); return }
      const h = filtered[focus - off]
      if (h) void compileAndPlay(h)
    }
  }, !searching)

  const rows = searching ? (
    <VirtualKeyboard
      value={query}
      onChange={setQuery}
      onDone={() => { setSearching(false); setFocus(off) }}
      onCancel={() => { setSearching(false); setFocus(0) }}
      enabled={searching}
      maxLength={40}
    />
  ) : loading ? (
    <p className="text-vault-muted text-sm text-center py-6 font-mono">loading…</p>
  ) : hacks.length === 0 ? (
    <p className="text-vault-muted text-sm text-center py-6 font-mono">
      no hacks matched to this game yet.
    </p>
  ) : (
    <>
      {searchable && (() => {
        const focused = focus === 0
        return (
          <div
            ref={el => { rowRefs.current[0] = el }}
            onMouseEnter={() => setFocus(0)}
            onClick={() => { setFocus(0); setSearching(true) }}
            className={rowClass(focused)}
          >
            <Caret selected={focused} />
            <span className={`flex-1 min-w-0 truncate font-mono text-lg ${query ? '' : focused ? 'text-vault-ink/70' : 'text-vault-muted'}`}>
              {query || 'search hacks…'}
            </span>
            <span className={`flex-none font-mono text-[0.8rem] tracking-[0.06em] ${focused ? 'text-vault-ink/70' : 'text-vault-muted'}`}>
              {query ? `${filtered.length} of ${hacks.length}` : `${hacks.length} hacks`}
            </span>
          </div>
        )
      })()}

      {filtered.length === 0 ? (
        <p className="text-vault-muted text-sm text-center py-6 font-mono">no hacks match “{query.trim()}”.</p>
      ) : filtered.map((h, i) => {
        const idx = i + off
        const focused = focus === idx
        const meta = [
          h.author || 'unknown',
          h.patch_format,
          h.match_confidence === 'fuzzy' ? 'fuzzy match' : h.match_confidence === 'manual' ? 'assigned' : null,
        ].filter(Boolean).join(' · ')
        return (
          <div
            key={h.id}
            ref={el => { rowRefs.current[idx] = el }}
            onMouseEnter={() => setFocus(idx)}
            onClick={() => void compileAndPlay(h)}
            className={rowClass(focused)}
          >
            <Caret selected={focused} />
            <ScrollingTitle text={h.title} focused={focused} />
            <span className={`flex-none font-mono text-[0.8rem] tracking-[0.06em] lowercase ${focused ? 'text-vault-ink/70' : 'text-vault-muted'}`}>
              {focused ? 'a compile' : meta}
            </span>
          </div>
        )
      })}
    </>
  )

  return (
    <>
      <div className="fixed inset-0 bg-black/80 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div
          className="bg-vault-panel border border-vault-surface p-6 w-full max-w-[860px] max-h-[85vh] flex flex-col gap-4 animate-rise-in motion-reduce:animate-none"
          style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
        >
          <div>
            <Title className="text-4xl">Hacks &amp; translations</Title>
            <p className="text-vault-accent font-mono text-[0.8rem] uppercase tracking-[0.12em] mt-1">{game.name}</p>
          </div>

          <div className="flex flex-col overflow-y-auto max-h-[420px]" style={{ scrollbarWidth: 'none' }}>
            {rows}
          </div>

          {/* The focused hack's blurb, and only its blurb: one text node swapped
              on each move, inside a fixed-height box so the panel never reflows
              as focus travels. Rendering a description per row would multiply
              the Pi's layout cost by the list length for text nobody reads. */}
          {!searching && !loading && hacks.length > 0 && (
            <p className="h-[4.5rem] flex-none font-read text-[0.95rem] leading-[1.3] text-vault-ink/70 line-clamp-3 border-t border-vault-surface pt-3">
              {focusedHack?.description ?? ''}
            </p>
          )}

          {/* Compile progress is plain streamed text, not an animated bar. */}
          {status && <p className={`font-mono text-sm text-center tracking-[0.04em] ${status.includes('fail') || status.includes('not') ? 'text-red-400' : 'text-vault-accent'}`}>{status}</p>}

          <HintBar hints={searching
            ? ['d-pad move', 'a type', 'square backspace', 'b done']
            : ['d-pad move', 'a compile & play', ...(searchable ? ['square search'] : []), 'b close']}
          />
        </div>
      </div>
    </>
  )
}
