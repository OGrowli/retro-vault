import { useState, useEffect, useRef } from 'react'
import type { User, GameList, HomePrefs, ListOrder, GameSort } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { listOrderOf, gameSortOf } from '../prefs'
import { Glyph } from '../components/Glyph'
import { StatusBar } from '../components/StatusBar'

interface Props {
  user: User
  prefs: HomePrefs
  onChange: (prefs: HomePrefs) => void
  onBack: () => void
}

// A togglable row. `locked` rails (Recently Played, All Games) always show and
// can't be turned off — the requirement pins them on.
interface Row {
  key: string
  label: string
  subtitle: string
  locked: boolean
}

const LIST_ORDER_OPTS: { value: ListOrder; label: string }[] = [
  { value: 'recent', label: 'Recently Viewed' },
  { value: 'created', label: 'Recently Created' },
  { value: 'size', label: 'Most Games' },
  { value: 'name', label: 'Name (A–Z)' },
]
const GAME_SORT_OPTS: { value: GameSort; label: string }[] = [
  { value: 'recent', label: 'Recently Viewed' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'year', label: 'Year' },
  { value: 'added', label: 'Recently Added' },
  { value: 'system', label: 'System' },
]

// The two sort selectors occupy the first focus slots, then the rail toggles,
// then Back. Focus is a single linear index over all of them.
const SORT_COUNT = 2

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export function HomeLayoutSettings({ user, prefs, onChange, onBack }: Props) {
  const [lists, setLists] = useState<GameList[]>([])
  const [focused, setFocused] = useState(0)
  // itemRefs[0..SORT_COUNT + rows.length] — trailing entry is the Back button.
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    api.lists.forUser(user.id, undefined, listOrderOf(prefs)).then(setLists).catch(() => {})
  }, [user.id, prefs])

  // Keep the focused item in view as it moves past the scroll bounds.
  useEffect(() => {
    itemRefs.current[focused]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  const rows: Row[] = [
    { key: 'recently-played', label: 'Recently Played', subtitle: 'Always shown', locked: true },
    { key: 'favorites', label: 'Favorites', subtitle: 'Your favorited games', locked: false },
    ...lists.map(l => ({
      key: `list-${l.id}`,
      label: l.name,
      subtitle: `${l.game_count} ${l.game_count === 1 ? 'game' : 'games'}`,
      locked: false,
    })),
    { key: 'all-games', label: 'All Games', subtitle: 'Always shown', locked: true },
  ]

  const rowBase = SORT_COUNT             // first rail-row focus index
  const backIdx = SORT_COUNT + rows.length

  const isHidden = (key: string) => prefs.hiddenKeys.includes(key)

  const toggle = (row: Row) => {
    if (row.locked) return
    const hiddenKeys = isHidden(row.key)
      ? prefs.hiddenKeys.filter(k => k !== row.key)
      : [...prefs.hiddenKeys, row.key]
    onChange({ ...prefs, hiddenKeys })
  }

  const listOrder = listOrderOf(prefs)
  const gameSort = gameSortOf(prefs)

  const cycleListOrder = (dir: 1 | -1) => {
    const i = LIST_ORDER_OPTS.findIndex(o => o.value === listOrder)
    const next = LIST_ORDER_OPTS[(i + dir + LIST_ORDER_OPTS.length) % LIST_ORDER_OPTS.length]
    onChange({ ...prefs, listOrder: next.value })
  }
  const cycleGameSort = (dir: 1 | -1) => {
    const i = GAME_SORT_OPTS.findIndex(o => o.value === gameSort)
    const next = GAME_SORT_OPTS[(i + dir + GAME_SORT_OPTS.length) % GAME_SORT_OPTS.length]
    onChange({ ...prefs, gameSort: next.value })
  }

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    if (action === 'up') setFocused(i => clamp(i - 1, 0, backIdx))
    if (action === 'down') setFocused(i => clamp(i + 1, 0, backIdx))
    if (action === 'left' || action === 'right') {
      const dir = action === 'right' ? 1 : -1
      if (focused === 0) cycleListOrder(dir)
      else if (focused === 1) cycleGameSort(dir)
      return
    }
    if (action === 'confirm') {
      if (focused === 0) { cycleListOrder(1); return }
      if (focused === 1) { cycleGameSort(1); return }
      if (focused === backIdx) { onBack(); return }
      const row = rows[focused - rowBase]
      if (row) toggle(row)
    }
  }, true)

  const selectorRow = (
    slot: number,
    title: string,
    subtitle: string,
    valueLabel: string,
    onCycle: (dir: 1 | -1) => void,
  ) => (
    <div
      ref={el => { itemRefs.current[slot] = el }}
      onMouseEnter={() => setFocused(slot)}
      className={[
        'w-full py-4 px-5 rounded-xl text-left flex items-center gap-4',
        'bg-vault-surface border transition-colors duration-150 motion-reduce:transition-none',
        focused === slot ? 'ring-2 ring-white border-vault-accent' : 'border-vault-muted',
      ].join(' ')}
    >
      <div className="flex-1 min-w-0">
        <span className="block text-white font-bold uppercase tracking-wide text-sm truncate">{title}</span>
        <span className="block text-vault-muted text-[0.7rem] normal-case tracking-normal mt-0.5">{subtitle}</span>
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        <button
          onClick={() => { setFocused(slot); onCycle(-1) }}
          className="w-7 h-7 rounded-lg bg-vault-bg text-vault-muted hover:text-white flex items-center justify-center"
          aria-label="Previous"
        >‹</button>
        <span className="min-w-[9.5rem] text-center text-vault-accent-bright text-sm font-bold uppercase tracking-wide">
          {valueLabel}
        </span>
        <button
          onClick={() => { setFocused(slot); onCycle(1) }}
          className="w-7 h-7 rounded-lg bg-vault-bg text-vault-muted hover:text-white flex items-center justify-center"
          aria-label="Next"
        >›</button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">Home Screen</h1>
          <p className="text-vault-muted text-xs uppercase tracking-widest mt-1">Sort order & which rails appear</p>
        </div>
        <div className="ml-auto"><StatusBar /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-8" style={{ scrollbarWidth: 'none' }}>
        <div className="space-y-3 max-w-lg">
          <p className="text-vault-muted text-[0.7rem] uppercase tracking-widest">Sorting</p>
          {selectorRow(0, 'List Order', 'How your lists are ordered everywhere',
            LIST_ORDER_OPTS.find(o => o.value === listOrder)?.label ?? '', cycleListOrder)}
          {selectorRow(1, 'Games in a List', 'Order of titles inside a list & Favorites',
            GAME_SORT_OPTS.find(o => o.value === gameSort)?.label ?? '', cycleGameSort)}

          <p className="text-vault-muted text-[0.7rem] uppercase tracking-widest pt-3">Rails</p>
          {rows.map((row, i) => {
            const slot = rowBase + i
            const on = row.locked || !isHidden(row.key)
            return (
              <button
                key={row.key}
                ref={el => { itemRefs.current[slot] = el }}
                onClick={() => toggle(row)}
                onMouseEnter={() => setFocused(slot)}
                disabled={row.locked}
                className={[
                  'w-full py-4 px-5 rounded-xl text-left flex items-center gap-4',
                  'bg-vault-surface border transition-colors duration-150 motion-reduce:transition-none',
                  focused === slot ? 'ring-2 ring-white border-vault-accent' : 'border-vault-muted',
                  row.locked ? 'opacity-70' : '',
                ].join(' ')}
              >
                <div className="flex-1 min-w-0">
                  <span className="block text-white font-bold uppercase tracking-wide text-sm truncate">{row.label}</span>
                  <span className="block text-vault-muted text-[0.7rem] normal-case tracking-normal mt-0.5">{row.subtitle}</span>
                </div>
                <span
                  className={[
                    'flex-shrink-0 w-12 h-7 rounded-full flex items-center px-1 transition-colors duration-150',
                    on ? 'bg-vault-accent justify-end' : 'bg-vault-bg justify-start',
                  ].join(' ')}
                >
                  <span className="w-5 h-5 rounded-full bg-white" />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-[5%] py-4 border-t border-vault-surface flex items-center gap-4">
        <button
          ref={el => { itemRefs.current[backIdx] = el }}
          onClick={onBack}
          onMouseEnter={() => setFocused(backIdx)}
          className={[
            'px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wide transition-colors duration-150',
            'bg-vault-surface text-white border border-vault-muted inline-flex items-center gap-2',
            'motion-reduce:transition-none',
            focused === backIdx ? 'ring-2 ring-white' : '',
          ].join(' ')}
        >
          <Glyph type="circle" /> Back
        </button>
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5">
          <Glyph type="circle" /> Back  ·  D-Pad Navigate  ·  ← → Change  ·  <Glyph type="cross" /> Toggle
        </p>
      </div>
    </div>
  )
}
