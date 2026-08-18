import { useState, useEffect, useRef } from 'react'
import type { GameFilter, GameList } from '@retro-vault/shared'
import { useGamepad } from '../hooks/useGamepad'

// Inline replacement for the old slide-out FilterDrawer. The chip bar lives on
// Home (no route/overlay); each filter chip opens a small in-place checklist.
// Filter state + item logic are the same shape the drawer used.

export type FilterChipId = 'system' | 'genre' | 'players' | 'options' | 'lists' | 'year'
export type ActionChipId = 'clear' | 'update' | 'addResults'
export type ChipId = FilterChipId | ActionChipId

export interface ChipDef { id: ChipId; kind: 'filter' | 'action' }

type OptionKey = 'favoritesOnly' | 'neverPlayed' | 'noMetadata' | 'hasHacks'
const OPTION_DEFS: { key: OptionKey; label: string }[] = [
  { key: 'favoritesOnly', label: 'Favorites Only' },
  { key: 'neverPlayed', label: 'Never Played' },
  { key: 'noMetadata', label: 'No Metadata' },
  { key: 'hasHacks', label: 'Has Hacks' },
]
const DECADES = [1970, 1980, 1990, 2000, 2010]

// Ordered chip set — filter chips (only when there's something to filter on),
// then action chips. Home reads this so focus indices line up with the bar.
export function buildChips(systems: string[], genres: string[], lists: GameList[]): ChipDef[] {
  const chips: ChipDef[] = []
  if (systems.length) chips.push({ id: 'system', kind: 'filter' })
  if (genres.length) chips.push({ id: 'genre', kind: 'filter' })
  chips.push({ id: 'players', kind: 'filter' })
  chips.push({ id: 'options', kind: 'filter' })
  if (lists.length) chips.push({ id: 'lists', kind: 'filter' })
  chips.push({ id: 'year', kind: 'filter' })
  chips.push({ id: 'clear', kind: 'action' })
  chips.push({ id: 'addResults', kind: 'action' })
  chips.push({ id: 'update', kind: 'action' })
  return chips
}

interface CheckItem { id: string; label: string; active: boolean; toggle: () => void }

const CHIP_LABEL: Record<ChipId, string> = {
  system: 'Systems', genre: 'Genre', players: 'Players', options: 'Options',
  lists: 'Lists', year: 'Year', clear: 'clear filters', update: 'update library', addResults: 'add to list',
}

interface Props {
  filter: GameFilter
  onChange: (f: GameFilter) => void
  onApply: () => void
  systems: string[]
  genres: string[]
  lists: GameList[]
  chips: ChipDef[]
  focusedIndex: number
  isActive: boolean
  openChip: ChipId | null
  onOpenChip: (id: ChipId) => void
  onAction: (id: ActionChipId) => void
  onCloseChip: () => void
  resultCount: number
  importLoading: boolean
}

export function FilterChips({
  filter, onChange, onApply, systems, genres, lists, chips,
  focusedIndex, isActive, openChip, onOpenChip, onAction, onCloseChip,
  resultCount, importLoading,
}: Props) {
  const itemsFor = (id: ChipId | null): CheckItem[] => {
    const toggleMulti = (key: 'systems' | 'genres', v: string) => {
      const cur = filter[key] ?? []
      onChange({ ...filter, [key]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] })
    }
    if (id === 'system') return systems.map(s => ({ id: s, label: s, active: (filter.systems ?? []).includes(s), toggle: () => toggleMulti('systems', s) }))
    if (id === 'genre') return genres.map(g => ({ id: g, label: g, active: (filter.genres ?? []).includes(g), toggle: () => toggleMulti('genres', g) }))
    if (id === 'players') return [1, 2, 4].map(n => ({ id: String(n), label: `${n} Player${n > 1 ? 's' : ''}`, active: filter.players === n, toggle: () => onChange({ ...filter, players: filter.players === n ? undefined : n }) }))
    if (id === 'options') return OPTION_DEFS.map(o => ({ id: o.key, label: o.label, active: !!filter[o.key], toggle: () => onChange({ ...filter, [o.key]: !filter[o.key] }) }))
    if (id === 'lists') return lists.map(l => ({ id: `list-${l.id}`, label: l.name, active: filter.listId === l.id, toggle: () => onChange({ ...filter, listId: filter.listId === l.id ? undefined : l.id }) }))
    if (id === 'year') return DECADES.map(d => ({ id: String(d), label: `${d}s`, active: filter.yearRange?.[0] === d && filter.yearRange?.[1] === d + 9, toggle: () => onChange({ ...filter, yearRange: (filter.yearRange?.[0] === d) ? undefined : [d, d + 9] }) }))
    return []
  }

  // Short active-selection summary shown inside each chip.
  const summary = (id: ChipId): string => {
    if (id === 'system') return filter.systems?.length ? String(filter.systems.length) : 'any'
    if (id === 'genre') return filter.genres?.length ? String(filter.genres.length) : 'any'
    if (id === 'players') return filter.players ? `${filter.players}p` : 'any'
    if (id === 'options') { const n = OPTION_DEFS.filter(o => filter[o.key]).length; return n ? `${n} on` : 'off' }
    if (id === 'lists') { const l = lists.find(x => x.id === filter.listId); return l ? l.name : 'any' }
    if (id === 'year') return filter.yearRange ? `${filter.yearRange[0]}s` : 'any'
    return ''
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {chips.map((chip, i) => {
        const focused = isActive && focusedIndex === i
        const label = CHIP_LABEL[chip.id]
        if (chip.kind === 'action') {
          const disabled = (chip.id === 'update' && importLoading) || (chip.id === 'addResults' && resultCount === 0)
          return (
            <button
              key={chip.id}
              disabled={disabled}
              onClick={() => onAction(chip.id as ActionChipId)}
              className={[
                'px-3 py-2 rounded-[2px] font-mono text-[0.78rem] uppercase tracking-[0.1em] border',
                focused ? 'border-vault-pink bg-vault-accent-bright text-vault-ink' : 'border-vault-muted/50 text-vault-muted',
                disabled ? 'opacity-40' : '',
              ].join(' ')}
            >
              {chip.id === 'addResults' && resultCount > 0 ? `${label} · ${resultCount}` : label}
              {chip.id === 'update' && importLoading ? '…' : ''}
            </button>
          )
        }
        return (
          <button
            key={chip.id}
            onClick={() => onOpenChip(chip.id)}
            className={[
              'flex items-center gap-2 px-3 py-2 rounded-[2px] border',
              focused || openChip === chip.id ? 'border-vault-pink bg-vault-accent-bright text-vault-ink' : 'border-vault-accent-dim/50',
            ].join(' ')}
          >
            <span className={`font-mono text-[0.6rem] uppercase tracking-[0.12em] ${focused || openChip === chip.id ? 'text-vault-ink/60' : 'text-vault-muted'}`}>{label}</span>
            <span className="font-mono text-[0.85rem]">{summary(chip.id)}</span>
          </button>
        )
      })}

      {openChip && <ChipDropdown row={openChip} items={itemsFor(openChip)} onApply={onApply} onClose={onCloseChip} />}
    </div>
  )
}

// In-place checklist for the open chip. Owns gamepad input while mounted; Home
// suspends its own nav via the `disabled` flag on useHomeNav.
function ChipDropdown({ row, items, onApply, onClose }: { row: ChipId; items: CheckItem[]; onApply: () => void; onClose: () => void }) {
  const [focus, setFocus] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const clamp = (v: number) => Math.max(0, Math.min(items.length - 1, v))

  useGamepad((action) => {
    if (action === 'back' || action === 'filter') { onApply(); onClose(); return }
    if (action === 'up') setFocus(i => clamp(i - 1))
    if (action === 'down') setFocus(i => clamp(i + 1))
    if (action === 'confirm') items[focus]?.toggle()
  }, true)

  useEffect(() => { refs.current[focus]?.scrollIntoView({ block: 'nearest' }) }, [focus])

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => { onApply(); onClose() }} />
      <div className="absolute left-0 top-full mt-2 z-50 min-w-[280px] max-h-[60vh] overflow-y-auto bg-vault-panel border border-vault-surface py-2" style={{ scrollbarWidth: 'none' }}>
        <div className="px-4 py-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-vault-muted">{CHIP_LABEL[row]}</div>
        {items.length === 0 && <p className="px-4 py-3 text-vault-muted text-sm font-mono">Nothing to filter.</p>}
        {items.map((item, i) => {
          const focused = focus === i
          return (
            <button
              key={item.id}
              ref={el => { refs.current[i] = el }}
              onClick={item.toggle}
              onMouseEnter={() => setFocus(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${focused ? 'bg-vault-accent-bright text-vault-ink' : ''}`}
            >
              <span className={[
                'w-5 h-5 rounded-[2px] flex-shrink-0 flex items-center justify-center border',
                item.active ? 'bg-vault-pink border-vault-pink' : focused ? 'border-vault-ink/40' : 'border-vault-muted',
              ].join(' ')}>
                {item.active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0c0a16" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 7" /></svg>
                )}
              </span>
              <span className="flex-1 truncate text-base">{item.label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
