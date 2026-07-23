import { useState, useCallback, useRef, useEffect } from 'react'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'

// Streams scripts/deploy.sh output into a scrolling feed by polling the tail
// endpoint. The deploy ends in a reboot, so once polls start failing after
// we've seen output, we treat it as "rebooting" rather than an error.
function UpdateProgressModal({ startOffset, onClose }: { startOffset: number; onClose: () => void }) {
  const [log, setLog] = useState('')
  const [phase, setPhase] = useState<'running' | 'rebooting'>('running')
  const offsetRef = useRef(startOffset)
  const failsRef = useRef(0)
  const feedRef = useRef<HTMLPreElement>(null)

  const complete = /==> Deploy complete\./.test(log)

  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const res = await api.system.updateLog(offsetRef.current)
        if (!active) return
        failsRef.current = 0
        if (res.content) {
          offsetRef.current = res.offset
          setLog(prev => prev + res.content)
        }
      } catch {
        if (!active) return
        // The reboot tears down the API — a few failed polls means it's going down.
        failsRef.current += 1
        if (failsRef.current >= 3) setPhase('rebooting')
      }
    }
    void poll()
    const id = setInterval(poll, 1000)
    return () => { active = false; clearInterval(id) }
  }, [])

  // Follow the tail as new lines arrive.
  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  useGamepad((action) => {
    if (action === 'back' || action === 'confirm') onClose()
  }, true)

  const status = phase === 'rebooting'
    ? 'Device is rebooting — this screen will reload shortly.'
    : complete
      ? 'Build complete — rebooting the device…'
      : 'Updating… pulling latest, rebuilding, and restarting.'

  return (
    <>
      <div className="fixed inset-0 bg-black/80 z-40" />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
        <div className="bg-vault-card rounded-2xl p-6 w-full max-w-2xl space-y-4" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
          <div className="flex items-center gap-3">
            {phase === 'running' && !complete && (
              <span className="w-4 h-4 rounded-full border-2 border-vault-muted border-t-vault-accent animate-spin motion-reduce:animate-none" />
            )}
            <h2 className="text-white text-xl font-bold">Updating RetroVault</h2>
          </div>

          <pre
            ref={feedRef}
            className="h-72 overflow-y-auto rounded-xl bg-black/60 border border-vault-surface p-4 text-[0.72rem] leading-relaxed text-[#c8f7d0] font-mono whitespace-pre-wrap break-words"
            style={{ scrollbarWidth: 'thin' }}
          >
            {log || 'Waiting for output…'}
          </pre>

          <p className="text-vault-muted text-sm">{status}</p>

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl font-bold text-sm uppercase tracking-wide bg-vault-surface text-white border border-vault-muted inline-flex items-center gap-2"
            >
              <Glyph type="circle" /> Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

interface Props {
  onBack: () => void
  onOpenHome: () => void
  onOpenScraping: () => void
  onOpenControllers: () => void
  onOpenHotkeys: () => void
  onOpenAudio: () => void
}

const FOCUS_ITEMS = ['home', 'scraping', 'controllers', 'hotkeys', 'audio', 'update', 'back'] as const
type FocusItem = (typeof FOCUS_ITEMS)[number]

// Rebooting the device is disruptive — gate the update behind an explicit
// confirm (defaulting focus to Cancel) with its own gamepad handling.
function UpdateConfirmModal({ updating, onConfirm, onCancel }: {
  updating: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const [focus, setFocus] = useState<'confirm' | 'cancel'>('cancel')

  useGamepad((action) => {
    if (updating) return
    if (action === 'back') { onCancel(); return }
    if (action === 'left' || action === 'right') setFocus(f => (f === 'confirm' ? 'cancel' : 'confirm'))
    if (action === 'confirm') { if (focus === 'confirm') onConfirm(); else onCancel() }
  }, true)

  return (
    <>
      <div className="fixed inset-0 bg-black/80 z-40" onClick={updating ? undefined : onCancel} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
        <div className="bg-vault-card rounded-2xl p-8 w-full max-w-sm space-y-5" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
          <div>
            <h2 className="text-white text-xl font-bold">Update RetroVault?</h2>
            <p className="text-vault-muted text-sm mt-2">
              Pulls the latest code, rebuilds, and reboots the device. This can take a few minutes and
              will interrupt any running game.
            </p>
          </div>
          <div className="flex gap-3">
            {([
              { key: 'cancel', label: 'Cancel' },
              { key: 'confirm', label: updating ? 'Starting…' : 'Update & Reboot' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                disabled={updating}
                onClick={() => { if (key === 'confirm') onConfirm(); else onCancel() }}
                className={[
                  'flex-1 px-4 py-3 rounded-xl font-bold text-sm uppercase tracking-wide transition-colors duration-150',
                  key === 'confirm' ? 'bg-vault-accent text-white' : 'bg-vault-surface text-white border border-vault-muted',
                  focus === key ? 'ring-2 ring-white' : '',
                  updating ? 'opacity-60' : '',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-vault-muted text-xs uppercase tracking-wide text-center">
            ← → Select · <Glyph type="cross" /> Confirm · <Glyph type="circle" /> Cancel
          </p>
        </div>
      </div>
    </>
  )
}

export function Settings({ onBack, onOpenHome, onOpenScraping, onOpenControllers, onOpenHotkeys, onOpenAudio }: Props) {
  const [focused, setFocused] = useState<FocusItem>('home')
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  // Set once the deploy is kicked off — drives the live-log progress modal.
  const [progressOffset, setProgressOffset] = useState<number | null>(null)
  const itemRefs = useRef<Partial<Record<FocusItem, HTMLElement | null>>>({})

  const focusIdx = FOCUS_ITEMS.indexOf(focused)

  useEffect(() => {
    itemRefs.current[focused]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  const runUpdate = useCallback(async () => {
    setUpdating(true)
    setUpdateMsg(null)
    try {
      const { offset } = await api.system.update()
      setUpdateOpen(false)
      setProgressOffset(offset)
    } catch (e) {
      setUpdateMsg(e instanceof Error ? e.message : 'Update failed to start')
      setUpdateOpen(false)
    } finally {
      setUpdating(false)
    }
  }, [])

  const activate = useCallback((item: FocusItem) => {
    if (item === 'home') onOpenHome()
    if (item === 'scraping') onOpenScraping()
    if (item === 'controllers') onOpenControllers()
    if (item === 'hotkeys') onOpenHotkeys()
    if (item === 'audio') onOpenAudio()
    if (item === 'update') setUpdateOpen(true)
    if (item === 'back') onBack()
  }, [onOpenHome, onOpenScraping, onOpenControllers, onOpenHotkeys, onOpenAudio, onBack])

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    if (action === 'up') setFocused(FOCUS_ITEMS[Math.max(0, focusIdx - 1)])
    if (action === 'down') setFocused(FOCUS_ITEMS[Math.min(FOCUS_ITEMS.length - 1, focusIdx + 1)])
    if (action === 'confirm') activate(focused)
  }, !updateOpen && progressOffset === null)

  const isFocused = (item: FocusItem) => focused === item
  const setRef = (item: FocusItem) => (el: HTMLElement | null) => { itemRefs.current[item] = el }

  const menu: { item: FocusItem; title: string; subtitle: string }[] = [
    { item: 'home', title: 'Home Screen', subtitle: 'Choose which lists appear on the home page' },
    { item: 'scraping', title: 'Scraping', subtitle: 'ScreenScraper credentials & metadata' },
    { item: 'controllers', title: 'Controller Settings', subtitle: 'Remap buttons per system' },
    { item: 'hotkeys', title: 'Emulator Hotkeys', subtitle: 'Save states, fast-forward, reset — all systems' },
    { item: 'audio', title: 'Audio', subtitle: 'RetroArch audio config — volume, resampler, sync & more' },
    { item: 'update', title: 'Update RetroVault', subtitle: 'Pull latest, rebuild, and reboot' },
  ]

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <h1 className="text-white text-2xl font-bold tracking-tight">Settings</h1>
        <div className="ml-auto"><Clock /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-8" style={{ scrollbarWidth: 'none' }}>
        <div className="space-y-3 max-w-lg">
          {menu.map(({ item, title, subtitle }) => (
            <button
              key={item}
              ref={setRef(item)}
              onClick={() => activate(item)}
              onMouseEnter={() => setFocused(item)}
              className={[
                'w-full py-4 rounded-xl font-bold text-white uppercase tracking-wide text-sm text-left px-5',
                'bg-vault-surface border border-vault-muted transition-colors duration-150 motion-reduce:transition-none',
                isFocused(item) ? 'ring-2 ring-white border-vault-accent' : '',
              ].join(' ')}
            >
              {title}
              <span className="block text-vault-muted text-[0.7rem] font-normal normal-case tracking-normal mt-0.5">
                {subtitle}
              </span>
            </button>
          ))}
          {updateMsg && <p className="text-vault-accent text-sm">{updateMsg}</p>}
        </div>
      </div>

      {/* Footer */}
      <div className="px-[5%] py-4 border-t border-vault-surface flex items-center gap-4">
        <button
          ref={setRef('back')}
          onClick={onBack}
          className={[
            'px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wide transition-colors duration-150',
            'bg-vault-surface text-white border border-vault-muted inline-flex items-center gap-2',
            'motion-reduce:transition-none',
            isFocused('back') ? 'ring-2 ring-white' : '',
          ].join(' ')}
        >
          <Glyph type="circle" /> Back
        </button>
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5">
          <Glyph type="circle" /> Back  ·  D-Pad Navigate  ·  <Glyph type="cross" /> Select
        </p>
      </div>

      {updateOpen && (
        <UpdateConfirmModal
          updating={updating}
          onConfirm={() => void runUpdate()}
          onCancel={() => setUpdateOpen(false)}
        />
      )}

      {progressOffset !== null && (
        <UpdateProgressModal
          startOffset={progressOffset}
          onClose={() => setProgressOffset(null)}
        />
      )}
    </div>
  )
}
