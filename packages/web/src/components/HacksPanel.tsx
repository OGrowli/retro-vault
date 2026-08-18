import { useState, useEffect, useRef, useCallback } from 'react'
import type { Game, User, RomHack } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Title, HintBar, rowClass, Caret } from './ui'

interface Props {
  game: Game
  user: User
  onClose: () => void
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
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    api.hacks.forGame(game.id)
      .then(r => { setHacks(r.hacks); setLoading(false) })
      .catch(() => setLoading(false))
  }, [game.id])

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
    if (action === 'up') setFocus(i => Math.max(0, i - 1))
    if (action === 'down') setFocus(i => Math.min(hacks.length - 1, i + 1))
    if (action === 'confirm') { const h = hacks[focus]; if (h) void compileAndPlay(h) }
  }, true)

  return (
    <>
      <div className="fixed inset-0 bg-black/80 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div
          className="bg-vault-panel border border-vault-surface p-6 w-full max-w-[560px] max-h-[85vh] flex flex-col gap-4 animate-rise-in motion-reduce:animate-none"
          style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
        >
          <div>
            <Title className="text-4xl">Hacks &amp; translations</Title>
            <p className="text-vault-accent font-mono text-[0.8rem] uppercase tracking-[0.12em] mt-1">{game.name}</p>
          </div>

          <div className="flex flex-col overflow-y-auto max-h-[340px]" style={{ scrollbarWidth: 'none' }}>
            {loading ? (
              <p className="text-vault-muted text-sm text-center py-6 font-mono">loading…</p>
            ) : hacks.length === 0 ? (
              <p className="text-vault-muted text-sm text-center py-6 font-mono">
                no hacks matched to this game yet.
              </p>
            ) : (
              hacks.map((h, i) => {
                const focused = focus === i
                const meta = [
                  h.author || 'unknown',
                  h.patch_format,
                  h.match_confidence === 'fuzzy' ? 'fuzzy match' : h.match_confidence === 'manual' ? 'assigned' : null,
                ].filter(Boolean).join(' · ')
                return (
                  <div
                    key={h.id}
                    ref={el => { rowRefs.current[i] = el }}
                    onMouseEnter={() => setFocus(i)}
                    onClick={() => void compileAndPlay(h)}
                    className={rowClass(focused)}
                  >
                    <Caret selected={focused} />
                    <span className="min-w-0 truncate text-xl">{h.title}</span>
                    <span className="flex-1" />
                    <span className={`font-mono text-[0.8rem] tracking-[0.06em] lowercase ${focused ? 'text-vault-ink/70' : 'text-vault-muted'}`}>
                      {focused ? 'a compile' : meta}
                    </span>
                  </div>
                )
              })
            )}
          </div>

          {/* Compile progress is plain streamed text, not an animated bar. */}
          {status && <p className={`font-mono text-sm text-center tracking-[0.04em] ${status.includes('fail') || status.includes('not') ? 'text-red-400' : 'text-vault-accent'}`}>{status}</p>}

          <HintBar hints={['d-pad move', 'a compile & play', 'b close']} />
        </div>
      </div>
    </>
  )
}
