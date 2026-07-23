import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { AudioConfig } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'

interface Props {
  onBack: () => void
}

// RetroArch audio_volume is dB gain; audio_latency is the output buffer in ms.
const VOL_MIN = -40
const VOL_MAX = 12
const VOL_STEP = 1
const VOL_DEFAULT = 0

const LAT_MIN = 16
const LAT_MAX = 256
const LAT_STEP = 16
const LAT_DEFAULT = 64

// Driver cycle — the leading entry leaves audio_driver unset (RetroArch default).
const DRIVERS: { val: string | undefined; label: string }[] = [
  { val: undefined, label: 'Default' },
  { val: 'alsathread', label: 'ALSA (threaded)' },
  { val: 'alsa', label: 'ALSA' },
  { val: 'pulse', label: 'PulseAudio' },
]

type FocusKind = 'mute' | 'volume' | 'sync' | 'driver' | 'latency' | 'save'

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export function AudioSettings({ onBack }: Props) {
  const [config, setConfig] = useState<AudioConfig>({})
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const rowRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    api.audioSettings.get().then(setConfig).catch(() => setConfig({}))
  }, [])

  const items = useMemo<FocusKind[]>(() => ['mute', 'volume', 'sync', 'driver', 'latency', 'save'], [])

  // Effective values (undefined → RetroArch default, surfaced in the UI).
  const muted = config.muted ?? false
  const sync = config.sync ?? true
  const volumeDb = config.volumeDb ?? VOL_DEFAULT
  const latencyMs = config.latencyMs ?? LAT_DEFAULT
  const driverIdx = Math.max(0, DRIVERS.findIndex(d => d.val === config.driver))

  const adjustVolume = useCallback((dir: 1 | -1) => {
    setConfig(c => ({ ...c, volumeDb: clamp((c.volumeDb ?? VOL_DEFAULT) + dir * VOL_STEP, VOL_MIN, VOL_MAX) }))
  }, [])

  const adjustLatency = useCallback((dir: 1 | -1) => {
    setConfig(c => ({ ...c, latencyMs: clamp((c.latencyMs ?? LAT_DEFAULT) + dir * LAT_STEP, LAT_MIN, LAT_MAX) }))
  }, [])

  const cycleDriver = useCallback((dir: 1 | -1) => {
    setConfig(c => {
      const cur = Math.max(0, DRIVERS.findIndex(d => d.val === c.driver))
      const next = (cur + dir + DRIVERS.length) % DRIVERS.length
      return { ...c, driver: DRIVERS[next]!.val }
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
    if (action === 'down') { setFocusedIndex(i => Math.min(items.length - 1, i + 1)); return }

    const kind = items[focusedIndex]
    if (!kind) return
    const dir = action === 'right' ? 1 : action === 'left' ? -1 : 0

    switch (kind) {
      case 'mute':
        if (action === 'confirm' || dir !== 0) setConfig(c => ({ ...c, muted: !(c.muted ?? false) }))
        break
      case 'sync':
        if (action === 'confirm' || dir !== 0) setConfig(c => ({ ...c, sync: !(c.sync ?? true) }))
        break
      case 'volume':
        if (dir !== 0) adjustVolume(dir)
        break
      case 'latency':
        if (dir !== 0) adjustLatency(dir)
        break
      case 'driver':
        if (dir !== 0) cycleDriver(dir)
        break
      case 'save':
        if (action === 'confirm') void save()
        break
    }
  }, true)

  useEffect(() => {
    rowRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIndex])

  const rowClass = (i: number) => [
    'px-4 py-3 rounded-xl transition-colors',
    focusedIndex === i ? 'bg-vault-surface ring-2 ring-vault-accent' : 'bg-vault-card',
  ].join(' ')

  const Toggle = ({ on }: { on: boolean }) => (
    <span className={['flex-shrink-0 w-12 h-7 rounded-full flex items-center px-1 transition-colors duration-150', on ? 'bg-vault-accent justify-end' : 'bg-vault-bg justify-start'].join(' ')}>
      <span className="w-5 h-5 rounded-full bg-white" />
    </span>
  )

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">
            <span className="text-vault-muted font-medium">Settings / </span>Audio
          </h1>
          <p className="text-vault-muted text-xs uppercase tracking-widest mt-0.5">Applies to the emulator on every launch</p>
        </div>
        <div className="ml-auto"><Clock /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-6 space-y-2 max-w-2xl" style={{ scrollbarWidth: 'none' }}>
        {/* Mute */}
        <div ref={el => { rowRefs.current[0] = el }} onClick={() => { setFocusedIndex(0); setConfig(c => ({ ...c, muted: !(c.muted ?? false) })) }} className={`${rowClass(0)} flex items-center justify-between cursor-pointer`}>
          <div>
            <span className="text-white text-sm font-semibold">Mute</span>
            <p className="text-vault-muted text-[0.7rem] mt-0.5">Silence all emulator audio</p>
          </div>
          <Toggle on={muted} />
        </div>

        {/* Volume */}
        <div ref={el => { rowRefs.current[1] = el }} className={rowClass(1)}>
          <div className="flex items-center justify-between">
            <span className={['text-sm font-semibold', muted ? 'text-vault-muted' : 'text-white'].join(' ')}>Volume</span>
            <span className="text-vault-accent text-sm font-mono">{volumeDb > 0 ? `+${volumeDb}` : volumeDb} dB</span>
          </div>
          {focusedIndex === 1 && <p className="text-vault-muted text-[0.65rem] mt-1.5 uppercase tracking-wide">← → adjust · 0 dB = unity gain</p>}
        </div>

        {/* Audio sync */}
        <div ref={el => { rowRefs.current[2] = el }} onClick={() => { setFocusedIndex(2); setConfig(c => ({ ...c, sync: !(c.sync ?? true) })) }} className={`${rowClass(2)} flex items-center justify-between cursor-pointer`}>
          <div>
            <span className="text-white text-sm font-semibold">Audio Sync</span>
            <p className="text-vault-muted text-[0.7rem] mt-0.5">Sync emulation to the audio clock — smoother sound, off can reduce lag</p>
          </div>
          <Toggle on={sync} />
        </div>

        {/* Driver */}
        <div ref={el => { rowRefs.current[3] = el }} className={rowClass(3)}>
          <div className="flex items-center justify-between">
            <span className="text-white text-sm font-semibold">Audio Driver</span>
            <span className="text-vault-accent text-sm font-mono">{DRIVERS[driverIdx]!.label}</span>
          </div>
          {focusedIndex === 3 && <p className="text-vault-muted text-[0.65rem] mt-1.5 uppercase tracking-wide">← → change</p>}
        </div>

        {/* Latency */}
        <div ref={el => { rowRefs.current[4] = el }} className={rowClass(4)}>
          <div className="flex items-center justify-between">
            <span className="text-white text-sm font-semibold">Audio Latency</span>
            <span className="text-vault-accent text-sm font-mono">{latencyMs} ms</span>
          </div>
          {focusedIndex === 4 && <p className="text-vault-muted text-[0.65rem] mt-1.5 uppercase tracking-wide">← → adjust · higher = fewer crackles, more delay</p>}
        </div>

        <button
          ref={el => { rowRefs.current[5] = el }}
          onClick={() => void save()}
          className={[
            'mt-3 w-full py-3 rounded-xl font-bold text-white uppercase tracking-wide text-sm bg-vault-accent transition-colors',
            focusedIndex === 5 ? 'ring-2 ring-white' : '',
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
