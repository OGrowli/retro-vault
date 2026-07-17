import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { ControllerConfig } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { useButtonCapture } from '../hooks/useButtonCapture'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'
import { LAYOUTS, SYSTEM_ORDER, diagramFor } from '../data/controllerLayouts'
import type { PresetKind } from '../data/controllerLayouts'

interface Props {
  onBack: () => void
}

type FocusItem =
  | { kind: 'picker' }
  | { kind: 'bind'; bindKey: string }
  | { kind: 'deadzone' }
  | { kind: 'presets' }
  | { kind: 'save' }

const PRESET_LABEL: Record<PresetKind, string> = {
  default: 'Default',
  swapAB: 'Swap A-B',
  swapXY: 'Swap X-Y',
}

const clampDeadzone = (v: number) => Math.max(0, Math.min(0.95, Math.round(v * 100) / 100))

export function ControllerSettings({ onBack }: Props) {
  const [system, setSystem] = useState(SYSTEM_ORDER[0])
  const [config, setConfig] = useState<ControllerConfig>({ bindings: {} })
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [presetIdx, setPresetIdx] = useState(0)
  const [binding, setBinding] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const layout = LAYOUTS[system]
  const rowRefs = useRef<(HTMLElement | null)[]>([])
  const pickerRefs = useRef<(HTMLElement | null)[]>([])

  // Load this system's saved config whenever it changes.
  useEffect(() => {
    let cancelled = false
    api.controllerSettings.get(system)
      .then(cfg => { if (!cancelled) setConfig({ bindings: cfg.bindings ?? {}, ...(cfg.deadzone !== undefined ? { deadzone: cfg.deadzone } : {}) }) })
      .catch(() => { if (!cancelled) setConfig({ bindings: {} }) })
    setFocusedIndex(0)
    setPresetIdx(0)
    setSaveMsg(null)
    return () => { cancelled = true }
  }, [system])

  const focusItems = useMemo<FocusItem[]>(() => {
    const items: FocusItem[] = [{ kind: 'picker' }]
    for (const b of layout.buttons) items.push({ kind: 'bind', bindKey: b.key })
    if (layout.hasDeadzone) items.push({ kind: 'deadzone' })
    if (layout.presets.length) items.push({ kind: 'presets' })
    items.push({ kind: 'save' })
    return items
  }, [layout])

  useButtonCapture(binding !== null, (btn) => {
    const key = binding
    setBinding(null)
    if (key) setConfig(c => ({ ...c, bindings: { ...c.bindings, [key]: btn } }))
  })

  // Escape cancels the binder (keyboard/mouse). On a gamepad every button binds,
  // so there's no button to reserve for cancel — the user just presses the one
  // they want. (The screen's own gamepad nav is suspended while capturing.)
  useEffect(() => {
    if (binding === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBinding(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [binding])

  const changeSystem = useCallback((dir: 1 | -1) => {
    const i = SYSTEM_ORDER.indexOf(system)
    const next = SYSTEM_ORDER[(i + dir + SYSTEM_ORDER.length) % SYSTEM_ORDER.length]
    setSystem(next)
  }, [system])

  const applyPreset = useCallback((preset: PresetKind) => {
    setConfig(c => {
      if (preset === 'default') return { bindings: {} }
      const b = { ...c.bindings }
      const swap = (x: string, y: string) => {
        const tmp = b[x]; if (b[y] !== undefined) b[x] = b[y]; else delete b[x]
        if (tmp !== undefined) b[y] = tmp; else delete b[y]
      }
      if (preset === 'swapAB') swap('a', 'b')
      if (preset === 'swapXY') swap('x', 'y')
      return { ...c, bindings: b }
    })
  }, [])

  const save = useCallback(async () => {
    setSaveMsg(null)
    try {
      await api.controllerSettings.save(system, config)
      setSaveMsg('Saved')
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed')
    }
  }, [system, config])

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    const item = focusItems[focusedIndex]
    if (!item) return

    if (action === 'up') { setFocusedIndex(i => Math.max(0, i - 1)); return }
    if (action === 'down') { setFocusedIndex(i => Math.min(focusItems.length - 1, i + 1)); return }

    if (item.kind === 'picker') {
      if (action === 'left') changeSystem(-1)
      if (action === 'right') changeSystem(1)
    } else if (item.kind === 'deadzone') {
      if (action === 'left') setConfig(c => ({ ...c, deadzone: clampDeadzone((c.deadzone ?? 0) - 0.05) }))
      if (action === 'right') setConfig(c => ({ ...c, deadzone: clampDeadzone((c.deadzone ?? 0) + 0.05) }))
    } else if (item.kind === 'presets') {
      if (action === 'left') setPresetIdx(i => Math.max(0, i - 1))
      if (action === 'right') setPresetIdx(i => Math.min(layout.presets.length - 1, i + 1))
      if (action === 'confirm') applyPreset(layout.presets[presetIdx])
    } else if (item.kind === 'bind') {
      if (action === 'confirm') setBinding(item.bindKey)
      // Square clears a binding (falls back to core default at launch)
      if (action === 'favorite') setConfig(c => {
        const b = { ...c.bindings }; delete b[item.bindKey]; return { ...c, bindings: b }
      })
    } else if (item.kind === 'save') {
      if (action === 'confirm') void save()
    }
  }, binding === null)

  // Keep the focused row / picker chip in view.
  useEffect(() => {
    rowRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIndex])
  useEffect(() => {
    pickerRefs.current[SYSTEM_ORDER.indexOf(system)]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [system])

  const isFocused = (kind: FocusItem['kind'], bindKey?: string) => {
    const item = focusItems[focusedIndex]
    if (!item || item.kind !== kind) return false
    if (kind === 'bind') return (item as { bindKey: string }).bindKey === bindKey
    return true
  }

  const diagram = diagramFor(system)
  const deadzonePct = Math.round((config.deadzone ?? 0) * 100)

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <h1 className="text-white text-2xl font-bold tracking-tight">
          <span className="text-vault-muted font-medium">Settings / </span>Controllers
        </h1>
        <div className="ml-auto"><Clock /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-6 space-y-6" style={{ scrollbarWidth: 'none' }}>
        {/* System picker rail */}
        <section>
          <p className="text-vault-muted text-xs uppercase tracking-widest mb-2">System</p>
          <div className="flex gap-2 overflow-x-auto py-1" style={{ scrollbarWidth: 'none' }}>
            {SYSTEM_ORDER.map((s, i) => {
              const active = s === system
              const focusedChip = isFocused('picker') && active
              return (
                <button
                  key={s}
                  ref={el => { pickerRefs.current[i] = el }}
                  onClick={() => setSystem(s)}
                  className={[
                    'px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide whitespace-nowrap transition-colors',
                    active ? 'bg-vault-accent text-white' : 'bg-vault-surface text-vault-muted border border-vault-muted',
                    focusedChip ? 'ring-2 ring-white' : '',
                  ].join(' ')}
                >
                  {LAYOUTS[s].label}
                </button>
              )
            })}
          </div>
        </section>

        <div className="flex gap-8 flex-wrap">
          {/* Diagram */}
          <div className="flex-shrink-0">
            <div className="w-72 h-56 bg-vault-card rounded-2xl flex items-center justify-center overflow-hidden">
              {diagram ? (
                <img src={diagram} alt={`${layout.label} controller`} className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-vault-muted">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40">
                    <rect x="2" y="7" width="20" height="12" rx="6" />
                    <line x1="7" y1="11" x2="7" y2="15" /><line x1="5" y1="13" x2="9" y2="13" />
                    <circle cx="16" cy="11.5" r="1" /><circle cx="18.5" cy="14" r="1" />
                  </svg>
                  <span className="text-[0.65rem] uppercase tracking-widest">Diagram coming soon</span>
                </div>
              )}
            </div>
            <p className="text-vault-muted text-xs mt-2 text-center max-w-72">
              <Glyph type="cross" /> bind · <Glyph type="square" /> clear
            </p>
          </div>

          {/* Remap rows + deadzone + presets */}
          <div className="flex-1 min-w-[280px] space-y-2">
            <p className="text-vault-muted text-xs uppercase tracking-widest mb-1">Button Mapping</p>
            {layout.buttons.map((b) => {
              const idx = focusItems.findIndex(f => f.kind === 'bind' && f.bindKey === b.key)
              const bound = config.bindings[b.key]
              const focused = isFocused('bind', b.key)
              return (
                <div
                  key={b.key}
                  ref={el => { rowRefs.current[idx] = el }}
                  onClick={() => { setFocusedIndex(idx); setBinding(b.key) }}
                  className={[
                    'flex items-center justify-between px-4 py-2.5 rounded-xl cursor-pointer transition-colors',
                    focused ? 'bg-vault-surface ring-2 ring-vault-accent' : 'bg-vault-card',
                  ].join(' ')}
                >
                  <span className="text-white text-sm font-semibold">{b.label}</span>
                  <span className={['text-sm font-mono', bound !== undefined ? 'text-vault-accent' : 'text-vault-muted'].join(' ')}>
                    {bound !== undefined ? `Btn ${bound}` : 'Not set'}
                  </span>
                </div>
              )
            })}

            {layout.hasDeadzone && (() => {
              const idx = focusItems.findIndex(f => f.kind === 'deadzone')
              const focused = isFocused('deadzone')
              return (
                <div
                  ref={el => { rowRefs.current[idx] = el }}
                  className={[
                    'px-4 py-3 rounded-xl transition-colors',
                    focused ? 'bg-vault-surface ring-2 ring-vault-accent' : 'bg-vault-card',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white text-sm font-semibold">Analog Deadzone</span>
                    <span className="text-vault-accent text-sm font-mono">{deadzonePct}%</span>
                  </div>
                  <div className="w-full bg-vault-bg rounded-full h-2">
                    <div className="bg-vault-accent h-2 rounded-full" style={{ width: `${deadzonePct}%` }} />
                  </div>
                  {focused && <p className="text-vault-muted text-[0.65rem] mt-1.5 uppercase tracking-wide">← → adjust</p>}
                </div>
              )
            })()}

            {layout.presets.length > 0 && (() => {
              const idx = focusItems.findIndex(f => f.kind === 'presets')
              const focused = isFocused('presets')
              return (
                <div ref={el => { rowRefs.current[idx] = el }} className="pt-2">
                  <p className="text-vault-muted text-xs uppercase tracking-widest mb-2">Presets</p>
                  <div className="flex gap-2 flex-wrap">
                    {layout.presets.map((p, i) => (
                      <button
                        key={p}
                        onClick={() => { setFocusedIndex(idx); setPresetIdx(i); applyPreset(p) }}
                        className={[
                          'px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide bg-vault-surface border border-vault-muted text-white transition-colors',
                          focused && presetIdx === i ? 'ring-2 ring-white border-vault-accent' : '',
                        ].join(' ')}
                      >
                        {PRESET_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })()}

            {(() => {
              const idx = focusItems.findIndex(f => f.kind === 'save')
              const focused = isFocused('save')
              return (
                <button
                  ref={el => { rowRefs.current[idx] = el }}
                  onClick={() => void save()}
                  className={[
                    'mt-3 w-full py-3 rounded-xl font-bold text-white uppercase tracking-wide text-sm bg-vault-accent transition-colors',
                    focused ? 'ring-2 ring-white' : '',
                  ].join(' ')}
                >
                  Save {layout.label} Controls
                </button>
              )
            })()}
            {saveMsg && <p className="text-vault-accent text-sm">{saveMsg}</p>}
          </div>
        </div>
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
                Press a button for {layout.buttons.find(b => b.key === binding)?.label ?? binding}
              </h2>
              <p className="text-vault-muted text-sm mt-1">Press any button on your controller to bind it.</p>
            </div>
            <button
              onClick={() => setBinding(null)}
              className="text-vault-muted text-xs uppercase tracking-wide"
            >
              Cancel (Esc / click)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
