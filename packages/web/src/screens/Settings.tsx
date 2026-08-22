import { useState, useCallback, useRef, useEffect } from 'react'
import type { HomePrefs } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { StatusBar } from '../components/StatusBar'
import { Breadcrumb, Title, HintBar, rowClass, Caret } from '../components/ui'

// Streams scripts/deploy.sh output into a scrolling feed by polling the tail
// endpoint. The deploy ends in a reboot, so once polls start failing after
// we've seen output, we treat it as "rebooting" rather than an error.
function UpdateProgressModal({ startOffset, onClose }: { startOffset: number; onClose: () => void }) {
  const [log, setLog] = useState('')
  const [phase, setPhase] = useState<'running' | 'rebooting'>('running')
  const offsetRef = useRef(startOffset)
  const failsRef = useRef(0)
  const feedRef = useRef<HTMLPreElement>(null)
  // Only auto-follow the tail while the user is scrolled to the bottom, so
  // scrolling up to read earlier output isn't yanked back down each poll.
  const stickToBottomRef = useRef(true)

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

  // Follow the tail as new lines arrive — unless the user scrolled up.
  useEffect(() => {
    const el = feedRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [log])

  const onFeedScroll = () => {
    const el = feedRef.current
    if (!el) return
    // Within a few px of the bottom counts as "following the tail".
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  }

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
        <div className="bg-vault-panel border border-vault-surface p-6 w-full max-w-2xl space-y-4" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
          <div className="flex items-center gap-3">
            {phase === 'running' && !complete && (
              <span className="w-4 h-4 rounded-full border-2 border-vault-muted border-t-vault-accent animate-spin motion-reduce:animate-none" />
            )}
            <h2 className="font-display text-3xl">Updating RetroVault</h2>
          </div>

          <pre
            ref={feedRef}
            onScroll={onFeedScroll}
            className="h-72 overflow-y-auto rounded-[2px] bg-black/60 border border-vault-surface p-4 text-[0.72rem] leading-relaxed text-[#c8f7d0] font-mono whitespace-pre-wrap break-words"
            style={{ scrollbarWidth: 'thin' }}
          >
            {log || 'Waiting for output…'}
          </pre>

          <p className="text-vault-muted text-sm font-mono tracking-[0.04em]">{status}</p>

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-[2px] font-mono uppercase tracking-[0.08em] text-sm bg-vault-surface text-[#eaf0f8] border border-vault-muted"
            >
              b close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

interface Props {
  onBack: () => void
  homePrefs: HomePrefs
  onHomePrefsChange: (prefs: HomePrefs) => void
  onOpenHome: () => void
  onOpenWifi: () => void
  onOpenScraping: () => void
  onOpenControllers: () => void
  onOpenHotkeys: () => void
  onOpenAudio: () => void
  onOpenRomAudit: () => void
}

const FOCUS_ITEMS = ['adult', 'doom-engine', 'home', 'wifi', 'scraping', 'controllers', 'hotkeys', 'audio', 'rom-audit', 'update'] as const
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
        <div className="bg-vault-panel border border-vault-surface p-8 w-full max-w-sm space-y-5" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
          <div>
            <h2 className="font-display text-3xl">Update RetroVault?</h2>
            <p className="text-vault-muted text-sm mt-2 font-read leading-relaxed">
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
                  'flex-1 px-4 py-3 rounded-[2px] font-mono uppercase tracking-[0.08em] text-sm',
                  key === 'confirm' ? 'bg-vault-accent-bright text-vault-ink' : 'bg-vault-surface text-[#eaf0f8] border border-vault-muted',
                  focus === key ? 'ring-2 ring-white' : '',
                  updating ? 'opacity-60' : '',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-vault-muted text-xs uppercase tracking-[0.08em] text-center font-mono">
            ← → select · a confirm · b cancel
          </p>
        </div>
      </div>
    </>
  )
}

export function Settings({ onBack, homePrefs, onHomePrefsChange, onOpenHome, onOpenWifi, onOpenScraping, onOpenControllers, onOpenHotkeys, onOpenAudio, onOpenRomAudit }: Props) {
  const [focused, setFocused] = useState<FocusItem>('home')
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  // Set once the deploy is kicked off — drives the live-log progress modal.
  const [progressOffset, setProgressOffset] = useState<number | null>(null)
  const [doomEngine, setDoomEngine] = useState<'lzdoom' | 'retroarch'>('lzdoom')
  const itemRefs = useRef<Partial<Record<FocusItem, HTMLElement | null>>>({})

  useEffect(() => {
    api.doom.getSettings().then(s => setDoomEngine(s.engine)).catch(() => {})
  }, [])

  const toggleDoomEngine = useCallback(() => {
    setDoomEngine(prev => {
      const next = prev === 'lzdoom' ? 'retroarch' : 'lzdoom'
      api.doom.setEngine(next).catch(() => {})
      return next
    })
  }, [])

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

  const toggleAdult = useCallback(() => {
    onHomePrefsChange({ ...homePrefs, showAdult: !homePrefs.showAdult })
  }, [homePrefs, onHomePrefsChange])

  const activate = useCallback((item: FocusItem) => {
    if (item === 'adult') toggleAdult()
    if (item === 'doom-engine') toggleDoomEngine()
    if (item === 'home') onOpenHome()
    if (item === 'wifi') onOpenWifi()
    if (item === 'scraping') onOpenScraping()
    if (item === 'controllers') onOpenControllers()
    if (item === 'hotkeys') onOpenHotkeys()
    if (item === 'audio') onOpenAudio()
    if (item === 'rom-audit') onOpenRomAudit()
    if (item === 'update') setUpdateOpen(true)
  }, [toggleAdult, toggleDoomEngine, onOpenHome, onOpenWifi, onOpenScraping, onOpenControllers, onOpenHotkeys, onOpenAudio, onOpenRomAudit])

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
    { item: 'wifi', title: 'Wi-Fi', subtitle: 'Connect to a network & view your IP address' },
    { item: 'scraping', title: 'Scraping', subtitle: 'ScreenScraper credentials & metadata' },
    { item: 'controllers', title: 'Controller Settings', subtitle: 'Remap buttons per system' },
    { item: 'hotkeys', title: 'Emulator Hotkeys', subtitle: 'Save states, fast-forward, reset — all systems' },
    { item: 'audio', title: 'Audio', subtitle: 'RetroArch audio config — volume, resampler, sync & more' },
    { item: 'rom-audit', title: 'ROM Audit', subtitle: 'Find missing ROMs by checksum vs No-Intro' },
    { item: 'update', title: 'Update RetroVault', subtitle: 'Pull latest, rebuild, and reboot' },
  ]

  // A flat settings row — title + optional inline status on the right.
  const SettingRow = ({ item, title, subtitle, status }: { item: FocusItem; title: string; subtitle: string; status?: string }) => {
    const focused = isFocused(item)
    return (
      <div
        ref={setRef(item)}
        onClick={() => activate(item)}
        onMouseEnter={() => setFocused(item)}
        className={rowClass(focused)}
      >
        <Caret selected={focused} />
        <div className="min-w-0">
          <div className="text-xl leading-tight">{title}</div>
          <div className={`text-[0.85rem] mt-0.5 truncate ${focused ? 'text-vault-ink/70' : 'text-vault-muted'}`}>{subtitle}</div>
        </div>
        <span className="flex-1" />
        {status && (
          <span className={`font-mono text-[0.9rem] tracking-[0.06em] ${focused ? 'text-vault-ink/80' : 'text-vault-accent'}`}>{status}</span>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col px-[5%] py-[3%] font-sans">
      <div className="flex items-center justify-between flex-shrink-0">
        <Breadcrumb>retrovault / settings</Breadcrumb>
        <StatusBar />
      </div>

      <div className="flex items-baseline gap-4 mt-4 flex-shrink-0">
        <Title className="text-6xl">Settings</Title>
        <span className="font-mono text-[0.9rem] uppercase tracking-[0.1em] text-vault-muted">retrovault · pi 3b+</span>
      </div>

      <div className="flex-1 overflow-y-auto py-6 min-h-0" style={{ scrollbarWidth: 'none' }}>
        <div className="flex flex-col max-w-2xl">
          <SettingRow item="adult" title="Show Adult Titles" subtitle="Reveal adult-flagged games in grid, search & random" status={homePrefs.showAdult ? 'on' : 'off'} />
          <SettingRow item="doom-engine" title="Doom Engine" subtitle="LZDoom (GZDoom features) or RetroArch/lr-prboom" status={doomEngine === 'retroarch' ? 'retroarch' : 'lzdoom'} />
          {menu.map(({ item, title, subtitle }) => (
            <SettingRow key={item} item={item} title={title} subtitle={subtitle} />
          ))}
          {updateMsg && <p className="text-vault-accent text-sm mt-3 font-mono">{updateMsg}</p>}
        </div>
      </div>

      <div className="flex-shrink-0 pt-4">
        <HintBar hints={['d-pad move', 'a select', 'b back']} />
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
