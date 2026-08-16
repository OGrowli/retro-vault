import { useState, useEffect, useRef, useCallback } from 'react'
import type { Game, User, RomHack } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from './Glyph'

interface Props {
  game: Game
  user: User
  onClose: () => void
}

const FMT_CLS: Record<string, string> = {
  ips: 'bg-amber-500/15 text-amber-300',
  bps: 'bg-emerald-500/15 text-emerald-300',
  ups: 'bg-sky-500/15 text-sky-300',
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
          className="bg-vault-card rounded-2xl p-6 w-full max-w-[520px] max-h-[85vh] flex flex-col gap-4 animate-rise-in motion-reduce:animate-none"
          style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
        >
          <div>
            <h2 className="text-white text-xl font-extrabold">ROM Hacks</h2>
            <p className="text-vault-accent-bright text-xs font-semibold uppercase tracking-wide mt-0.5">{game.name}</p>
          </div>

          <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[320px] pr-0.5" style={{ scrollbarWidth: 'none' }}>
            {loading ? (
              <p className="text-vault-muted text-sm text-center py-6">Loading…</p>
            ) : hacks.length === 0 ? (
              <p className="text-vault-muted text-sm text-center py-6">
                No hacks matched to this game yet.
              </p>
            ) : (
              hacks.map((h, i) => {
                const focused = focus === i
                return (
                  <div
                    key={h.id}
                    ref={el => { rowRefs.current[i] = el }}
                    onMouseEnter={() => setFocus(i)}
                    onClick={() => void compileAndPlay(h)}
                    className={[
                      'flex items-center gap-3 px-3.5 py-3 rounded-2xl cursor-pointer border',
                      focused ? 'bg-vault-surface ring-2 ring-vault-accent border-transparent' : 'bg-vault-surface/40 border-transparent',
                    ].join(' ')}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[0.92rem] font-semibold text-white truncate">{h.title}</span>
                      <span className="block text-xs text-vault-muted truncate mt-0.5">
                        {h.author || 'Unknown'}{h.match_confidence === 'fuzzy' ? ' · fuzzy match' : h.match_confidence === 'manual' ? ' · assigned' : ''}
                      </span>
                    </span>
                    {h.patch_format && (
                      <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${FMT_CLS[h.patch_format] ?? 'bg-slate-500/20 text-slate-300'}`}>
                        {h.patch_format}
                      </span>
                    )}
                    {focused && <span className="text-vault-accent text-xs font-bold uppercase flex-shrink-0">Play</span>}
                  </div>
                )
              })
            )}
          </div>

          {status && <p className={`text-sm text-center ${status.includes('fail') || status.includes('not') ? 'text-red-400' : 'text-vault-accent-bright'}`}>{status}</p>}

          <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center justify-center gap-1.5 flex-wrap">
            <Glyph type="cross" /> Compile &amp; Play  ·  <Glyph type="circle" /> Close  ·  ↑↓ Navigate
          </p>
        </div>
      </div>
    </>
  )
}
