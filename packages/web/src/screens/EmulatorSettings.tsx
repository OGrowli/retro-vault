import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { HotkeyConfig } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { useButtonCapture } from '../hooks/useButtonCapture'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'

interface Props {
  onBack: () => void
}

// The remappable hotkeys, in display order. `key` is the HotkeyConfig field.
type HotkeyField = 'enableHotkey' | 'saveState' | 'loadState' | 'slotIncrease' | 'slotDecrease' | 'fastForward' | 'reset'

const ROWS: { key: HotkeyField; label: string }[] = [
  { key: 'enableHotkey', label: 'Hotkey Modifier' },
  { key: 'saveState', label: 'Save State' },
  { key: 'loadState', label: 'Load State' },
  { key: 'slotIncrease', label: 'Next Save Slot' },
  { key: 'slotDecrease', label: 'Previous Save Slot' },
  { key: 'fastForward', label: 'Fast Forward (hold)' },
  { key: 'reset', label: 'Reset Game' },
]

const FF_MIN = 1.5
const FF_MAX = 8
const FF_STEP = 0.5

type FocusItem = { kind: 'bind'; key: HotkeyField } | { kind: 'ratio' } | { kind: 'save' }

export function EmulatorSettings({ onBack }: Props) {
  const [config, setConfig] = useState<HotkeyConfig>({})
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [binding, setBinding] = useState<HotkeyField | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const rowRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    api.hotkeySettings.get().then(setConfig).catch(() => setConfig({}))
  }, [])

  const focusItems = useMemo<FocusItem[]>(() => [
    ...ROWS.map(r => ({ kind: 'bind', key: r.key }) as FocusItem),
    { kind: 'ratio' },
    { kind: 'save' },
  ], [])

  useButtonCapture(binding !== null, (btn) => {
    const key = binding
    setBinding(null)
    if (key) setConfig(c => ({ ...c, [key]: btn }))
  })

  useEffect(() => {
    if (binding === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBinding(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [binding])

  const adjustRatio = useCallback((dir: 1 | -1) => {
    setConfig(c => {
      const cur = c.fastForwardRatio ?? 2
      const next = Math.max(FF_MIN, Math.min(FF_MAX, Math.round((cur + dir * FF_STEP) * 10) / 10))
      return { ...c, fastForwardRatio: next }
    })
  }, [])

  const save = useCallback(async () => {
    setSaveMsg(null)
    try {
      await api.hotkeySettings.save(config)
      setSaveMsg('Saved')
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed')
    }
  }, [config])

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    const item = focusItems[focusedIndex]
    if (!item) return

    if (action === 'up') { setFocusedIndex(i => Math.max(0, i - 1)); return }
    if (action === 'down') { setFocusedIndex(i => Math.min(focusItems.length - 1, i + 1)); return }

    if (item.kind === 'bind') {
      if (action === 'confirm') setBinding(item.key)
      if (action === 'favorite') setConfig(c => { const n = { ...c }; delete n[item.key]; return n })
    } else if (item.kind === 'ratio') {
      if (action === 'left') adjustRatio(-1)
      if (action === 'right') adjustRatio(1)
    } else if (item.kind === 'save') {
      if (action === 'confirm') void save()
    }
  }, binding === null)

  useEffect(() => {
    rowRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIndex])

  const isFocused = (predicate: (i: FocusItem) => boolean) => {
    const item = focusItems[focusedIndex]
    return !!item && predicate(item)
  }

  const ratio = config.fastForwardRatio ?? 2
  const ratioIdx = ROWS.length

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">
            <span className="text-vault-muted font-medium">Settings / </span>Emulator Hotkeys
          </h1>
          <p className="text-vault-muted text-xs uppercase tracking-widest mt-0.5">Applies to all systems</p>
        </div>
        <div className="ml-auto"><Clock /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-6 space-y-2 max-w-2xl" style={{ scrollbarWidth: 'none' }}>
        {ROWS.map((r, i) => {
          const bound = config[r.key]
          const focused = isFocused(it => it.kind === 'bind' && it.key === r.key)
          return (
            <div
              key={r.key}
              ref={el => { rowRefs.current[i] = el }}
              onClick={() => { setFocusedIndex(i); setBinding(r.key) }}
              className={[
                'flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer transition-colors',
                focused ? 'bg-vault-surface ring-2 ring-vault-accent' : 'bg-vault-card',
              ].join(' ')}
            >
              <span className="text-white text-sm font-semibold">{r.label}</span>
              <span className={['text-sm font-mono', bound !== undefined ? 'text-vault-accent' : 'text-vault-muted'].join(' ')}>
                {bound !== undefined ? `Btn ${bound}` : 'Not set'}
              </span>
            </div>
          )
        })}

        {/* Fast-forward speed */}
        {(() => {
          const focused = isFocused(it => it.kind === 'ratio')
          return (
            <div
              ref={el => { rowRefs.current[ratioIdx] = el }}
              className={[
                'px-4 py-3 rounded-xl transition-colors',
                focused ? 'bg-vault-surface ring-2 ring-vault-accent' : 'bg-vault-card',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <span className="text-white text-sm font-semibold">Fast-Forward Speed</span>
                <span className="text-vault-accent text-sm font-mono">{ratio.toFixed(1)}×</span>
              </div>
              {focused && <p className="text-vault-muted text-[0.65rem] mt-1.5 uppercase tracking-wide">← → adjust</p>}
            </div>
          )
        })()}

        {/* Reset — fixed, non-interactive */}
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-vault-card/60">
          <div>
            <span className="text-vault-muted text-sm font-semibold">Exit to RetroVault</span>
            <p className="text-vault-muted text-[0.7rem] mt-0.5">Hold Select + Start · fixed so a rebind can't lock the kiosk</p>
          </div>
          <span className="text-[0.65rem] font-bold uppercase tracking-wide text-vault-muted border border-vault-muted rounded-full px-2 py-0.5">Fixed</span>
        </div>

        {/* Rewind — deliberately excluded */}
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-vault-card/40 opacity-60">
          <div>
            <span className="text-vault-muted text-sm font-semibold">Rewind</span>
            <p className="text-vault-muted text-[0.7rem] mt-0.5">Disabled — too expensive on a Pi 3B (constant state snapshotting)</p>
          </div>
          <span className="text-[0.65rem] font-bold uppercase tracking-wide text-vault-muted border border-vault-muted rounded-full px-2 py-0.5">Off</span>
        </div>

        {(() => {
          const focused = isFocused(it => it.kind === 'save')
          const idx = focusItems.length - 1
          return (
            <button
              ref={el => { rowRefs.current[idx] = el }}
              onClick={() => void save()}
              className={[
                'mt-3 w-full py-3 rounded-xl font-bold text-white uppercase tracking-wide text-sm bg-vault-accent transition-colors',
                focused ? 'ring-2 ring-white' : '',
              ].join(' ')}
            >
              Save Hotkeys
            </button>
          )
        })()}
        {saveMsg && <p className="text-vault-accent text-sm">{saveMsg}</p>}
      </div>

      <div className="px-[5%] py-4 border-t border-vault-surface flex items-center gap-4">
        <button
          onClick={onBack}
          className="px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wide bg-vault-surface text-white border border-vault-muted inline-flex items-center gap-2"
        >
          <Glyph type="circle" /> Back
        </button>
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="circle" /> Back  ·  D-Pad Navigate  ·  <Glyph type="cross" /> Bind / Select  ·  <Glyph type="square" /> Clear
        </p>
      </div>

      {binding !== null && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center px-4">
          <div className="bg-vault-card rounded-2xl p-8 w-full max-w-sm text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full border-2 border-vault-accent border-dashed flex items-center justify-center animate-pulse">
              <Glyph type="cross" />
            </div>
            <div>
              <h2 className="text-white text-lg font-bold">
                Press a button for {ROWS.find(r => r.key === binding)?.label}
              </h2>
              <p className="text-vault-muted text-sm mt-1">Press any button on your controller to bind it.</p>
            </div>
            <button onClick={() => setBinding(null)} className="text-vault-muted text-xs uppercase tracking-wide">
              Cancel (Esc / click)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
