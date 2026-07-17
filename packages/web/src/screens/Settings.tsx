import { useState, useCallback, useRef, useEffect } from 'react'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'

interface Props {
  onBack: () => void
  onOpenScraping: () => void
  onOpenControllers: () => void
  onOpenHotkeys: () => void
}

const FOCUS_ITEMS = ['scraping', 'controllers', 'hotkeys', 'update', 'back'] as const
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

export function Settings({ onBack, onOpenScraping, onOpenControllers, onOpenHotkeys }: Props) {
  const [focused, setFocused] = useState<FocusItem>('scraping')
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const itemRefs = useRef<Partial<Record<FocusItem, HTMLElement | null>>>({})

  const focusIdx = FOCUS_ITEMS.indexOf(focused)

  useEffect(() => {
    itemRefs.current[focused]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  const runUpdate = useCallback(async () => {
    setUpdating(true)
    setUpdateMsg(null)
    try {
      await api.system.update()
      setUpdateMsg('Update started — the device will rebuild and reboot shortly.')
    } catch (e) {
      setUpdateMsg(e instanceof Error ? e.message : 'Update failed to start')
    } finally {
      setUpdating(false)
      setUpdateOpen(false)
    }
  }, [])

  const activate = useCallback((item: FocusItem) => {
    if (item === 'scraping') onOpenScraping()
    if (item === 'controllers') onOpenControllers()
    if (item === 'hotkeys') onOpenHotkeys()
    if (item === 'update') setUpdateOpen(true)
    if (item === 'back') onBack()
  }, [onOpenScraping, onOpenControllers, onOpenHotkeys, onBack])

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    if (action === 'up') setFocused(FOCUS_ITEMS[Math.max(0, focusIdx - 1)])
    if (action === 'down') setFocused(FOCUS_ITEMS[Math.min(FOCUS_ITEMS.length - 1, focusIdx + 1)])
    if (action === 'confirm') activate(focused)
  }, !updateOpen)

  const isFocused = (item: FocusItem) => focused === item
  const setRef = (item: FocusItem) => (el: HTMLElement | null) => { itemRefs.current[item] = el }

  const menu: { item: FocusItem; title: string; subtitle: string }[] = [
    { item: 'scraping', title: 'Scraping', subtitle: 'ScreenScraper credentials & metadata' },
    { item: 'controllers', title: 'Controller Settings', subtitle: 'Remap buttons per system' },
    { item: 'hotkeys', title: 'Emulator Hotkeys', subtitle: 'Save states, fast-forward, reset — all systems' },
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
    </div>
  )
}
