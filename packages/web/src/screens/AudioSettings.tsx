import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { AudioConfig } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'

interface Props {
  onBack: () => void
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
// Avoid float drift from repeated small steps (e.g. 0.001 rate-control steps).
const roundTo = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6))

type BoolKey = 'enabled' | 'muted' | 'sync'
type NumKey = 'volumeDb' | 'latencyMs' | 'maxTimingSkew' | 'rateControlDelta'
type CycleKey = 'driver' | 'outputRate' | 'resampler' | 'resamplerQuality'

type Item =
  | { kind: 'toggle'; key: BoolKey; label: string; sub: string; def: boolean }
  | { kind: 'range'; key: NumKey; label: string; sub: string; min: number; max: number; step: number; def: number; fmt: (v: number) => string }
  | { kind: 'cycle'; key: CycleKey; label: string; sub: string; options: { val: string | number | undefined; label: string }[] }

// Mirrors RetroArch's Audio settings menu (retroarch.cfg keys in parens),
// grouped the same way. The leading "Default" option on cycles leaves the key
// unset so RetroArch uses its own default.
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Output',
    items: [
      { kind: 'toggle', key: 'enabled', label: 'Audio Enable', sub: 'Master audio on/off (audio_enable)', def: true },
      { kind: 'toggle', key: 'muted', label: 'Mute', sub: 'Silence all output (audio_mute_enable)', def: false },
      { kind: 'range', key: 'volumeDb', label: 'Volume Gain', sub: 'Global gain, 0 dB = unity (audio_volume)', min: -80, max: 12, step: 1, def: 0, fmt: v => `${v > 0 ? '+' : ''}${v} dB` },
      {
        kind: 'cycle', key: 'driver', label: 'Audio Driver', sub: 'Output backend (audio_driver)', options: [
          { val: undefined, label: 'Default' },
          { val: 'alsathread', label: 'ALSA (threaded)' },
          { val: 'alsa', label: 'ALSA' },
          { val: 'pulse', label: 'PulseAudio' },
        ],
      },
      { kind: 'range', key: 'latencyMs', label: 'Audio Latency', sub: 'Output buffer size — higher = fewer crackles, more lag (audio_latency)', min: 8, max: 512, step: 8, def: 64, fmt: v => `${v} ms` },
      {
        kind: 'cycle', key: 'outputRate', label: 'Output Rate', sub: 'Output sample rate (audio_out_rate)', options: [
          { val: undefined, label: 'Default' },
          { val: 32000, label: '32000 Hz' },
          { val: 44100, label: '44100 Hz' },
          { val: 48000, label: '48000 Hz' },
        ],
      },
    ],
  },
  {
    title: 'Resampler',
    items: [
      {
        kind: 'cycle', key: 'resampler', label: 'Resampler', sub: 'Resampler backend (audio_resampler)', options: [
          { val: undefined, label: 'Default' },
          { val: 'sinc', label: 'Sinc' },
          { val: 'cc', label: 'CC' },
          { val: 'nearest', label: 'Nearest' },
        ],
      },
      {
        kind: 'cycle', key: 'resamplerQuality', label: 'Resampler Quality', sub: 'Quality vs performance (audio_resampler_quality)', options: [
          { val: undefined, label: 'Default' },
          { val: 0, label: "Don't Care" },
          { val: 1, label: 'Lowest' },
          { val: 2, label: 'Lower' },
          { val: 3, label: 'Normal' },
          { val: 4, label: 'Higher' },
          { val: 5, label: 'Highest' },
        ],
      },
    ],
  },
  {
    title: 'Synchronization',
    items: [
      { kind: 'toggle', key: 'sync', label: 'Audio Sync', sub: 'Sync emulation to the audio clock (audio_sync)', def: true },
      { kind: 'range', key: 'maxTimingSkew', label: 'Max Timing Skew', sub: 'Max resample-ratio deviation (audio_max_timing_skew)', min: 0, max: 0.5, step: 0.01, def: 0.05, fmt: v => v.toFixed(2) },
      { kind: 'range', key: 'rateControlDelta', label: 'Dynamic Rate Control', sub: '0 disables rate control (audio_rate_control_delta)', min: 0, max: 0.2, step: 0.001, def: 0.005, fmt: v => (v === 0 ? 'Off' : v.toFixed(3)) },
    ],
  },
]

const ITEMS: Item[] = GROUPS.flatMap(g => g.items)

export function AudioSettings({ onBack }: Props) {
  const [config, setConfig] = useState<AudioConfig>({})
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const rowRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    api.audioSettings.get().then(setConfig).catch(() => setConfig({}))
  }, [])

  const saveIndex = ITEMS.length

  const toggleItem = useCallback((item: Extract<Item, { kind: 'toggle' }>) => {
    setConfig(c => ({ ...c, [item.key]: !(c[item.key] ?? item.def) }))
  }, [])

  const adjustItem = useCallback((item: Extract<Item, { kind: 'range' }>, dir: 1 | -1) => {
    setConfig(c => {
      const cur = c[item.key] ?? item.def
      return { ...c, [item.key]: clamp(roundTo(cur + dir * item.step, item.step), item.min, item.max) }
    })
  }, [])

  const cycleItem = useCallback((item: Extract<Item, { kind: 'cycle' }>, dir: 1 | -1) => {
    setConfig(c => {
      const cur = Math.max(0, item.options.findIndex(o => o.val === c[item.key]))
      const next = (cur + dir + item.options.length) % item.options.length
      return { ...c, [item.key]: item.options[next]!.val }
    })
  }, [])

  const save = useCallback(async () => {
    setSaveMsg(null)
    try {
      const saved = await api.audioSettings.save(config)
      setConfig(saved.config)
      setSaveMsg('Saved — applies next time you launch a game')
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed')
    }
  }, [config])

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    if (action === 'up') { setFocusedIndex(i => Math.max(0, i - 1)); return }
    if (action === 'down') { setFocusedIndex(i => Math.min(saveIndex, i + 1)); return }

    if (focusedIndex === saveIndex) {
      if (action === 'confirm') void save()
      return
    }

    const item = ITEMS[focusedIndex]
    if (!item) return
    const dir = action === 'right' ? 1 : action === 'left' ? -1 : 0

    if (item.kind === 'toggle') {
      if (action === 'confirm' || dir !== 0) toggleItem(item)
    } else if (item.kind === 'range') {
      if (dir !== 0) adjustItem(item, dir)
    } else {
      if (dir !== 0) cycleItem(item, dir)
    }
  }, true)

  useEffect(() => {
    rowRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIndex])

  // Flat index each item occupies in the focus order (== position in ITEMS).
  const itemIndex = useMemo(() => new Map(ITEMS.map((it, i) => [it, i] as const)), [])

  const rowClass = (i: number) => [
    'px-4 py-3 rounded-xl transition-colors',
    focusedIndex === i ? 'bg-vault-surface ring-2 ring-vault-accent' : 'bg-vault-card',
  ].join(' ')

  const Toggle = ({ on }: { on: boolean }) => (
    <span className={['flex-shrink-0 w-12 h-7 rounded-full flex items-center px-1 transition-colors duration-150', on ? 'bg-vault-accent justify-end' : 'bg-vault-bg justify-start'].join(' ')}>
      <span className="w-5 h-5 rounded-full bg-white" />
    </span>
  )

  const renderItem = (item: Item) => {
    const i = itemIndex.get(item)!
    const focused = focusedIndex === i
    if (item.kind === 'toggle') {
      const on = config[item.key] ?? item.def
      return (
        <div key={item.key} ref={el => { rowRefs.current[i] = el }} onClick={() => { setFocusedIndex(i); toggleItem(item) }} className={`${rowClass(i)} flex items-center justify-between cursor-pointer`}>
          <div className="min-w-0">
            <span className="text-white text-sm font-semibold">{item.label}</span>
            <p className="text-vault-muted text-[0.7rem] mt-0.5">{item.sub}</p>
          </div>
          <Toggle on={on} />
        </div>
      )
    }
    if (item.kind === 'range') {
      const v = config[item.key] ?? item.def
      return (
        <div key={item.key} ref={el => { rowRefs.current[i] = el }} className={rowClass(i)}>
          <div className="flex items-center justify-between">
            <span className="text-white text-sm font-semibold">{item.label}</span>
            <span className="text-vault-accent text-sm font-mono">{item.fmt(v)}</span>
          </div>
          {focused ? <p className="text-vault-muted text-[0.65rem] mt-1.5 uppercase tracking-wide">← → adjust</p>
            : <p className="text-vault-muted text-[0.7rem] mt-0.5">{item.sub}</p>}
        </div>
      )
    }
    const opt = item.options[Math.max(0, item.options.findIndex(o => o.val === config[item.key]))]!
    return (
      <div key={item.key} ref={el => { rowRefs.current[i] = el }} className={rowClass(i)}>
        <div className="flex items-center justify-between">
          <span className="text-white text-sm font-semibold">{item.label}</span>
          <span className="text-vault-accent text-sm font-mono">{opt.label}</span>
        </div>
        {focused ? <p className="text-vault-muted text-[0.65rem] mt-1.5 uppercase tracking-wide">← → change</p>
          : <p className="text-vault-muted text-[0.7rem] mt-0.5">{item.sub}</p>}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">
            <span className="text-vault-muted font-medium">Settings / </span>Audio
          </h1>
          <p className="text-vault-muted text-xs uppercase tracking-widest mt-0.5">Mirrors RetroArch audio config · applies on every launch</p>
        </div>
        <div className="ml-auto"><Clock /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-6 space-y-2 max-w-2xl" style={{ scrollbarWidth: 'none' }}>
        {GROUPS.map(group => (
          <div key={group.title} className="space-y-2">
            <h2 className="text-vault-muted text-xs font-bold uppercase tracking-widest pt-3 pb-1">{group.title}</h2>
            {group.items.map(renderItem)}
          </div>
        ))}

        <button
          ref={el => { rowRefs.current[saveIndex] = el }}
          onClick={() => void save()}
          className={[
            'mt-4 w-full py-3 rounded-xl font-bold text-white uppercase tracking-wide text-sm bg-vault-accent transition-colors',
            focusedIndex === saveIndex ? 'ring-2 ring-white' : '',
          ].join(' ')}
        >
          Save Audio Settings
        </button>
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
          <Glyph type="circle" /> Back  ·  D-Pad Navigate  ·  ← → Adjust  ·  <Glyph type="cross" /> Toggle / Save
        </p>
      </div>
    </div>
  )
}
