import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameFilter } from '@retro-vault/shared'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from './Glyph'

interface Props {
  open: boolean
  /** Whether the drawer should handle gamepad input (open and no VK over it). */
  gamepadActive: boolean
  filter: GameFilter
  onChange: (filter: GameFilter) => void
  onApply: () => void
  onRandom: () => void
  onImport: () => void
  onSearch: () => void
  importLoading: boolean
  importMessage: string | null
  onClose: () => void
  systems: string[]
  genres: string[]
}

// Focus order top-to-bottom. The first four open a dropdown checklist; the rest
// are direct actions. (Year Range stays mouse-only, rendered outside the flow.)
type RowId = 'system' | 'genre' | 'players' | 'options' | 'search' | 'apply' | 'random' | 'import'
const DROPDOWN_ROWS = new Set<RowId>(['system', 'genre', 'players', 'options'])

type OptionKey = 'favoritesOnly' | 'neverPlayed' | 'noMetadata'
const OPTION_DEFS: { key: OptionKey; label: string }[] = [
  { key: 'favoritesOnly', label: 'Favorites Only' },
  { key: 'neverPlayed', label: 'Never Played' },
  { key: 'noMetadata', label: 'No Metadata' },
]

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

interface CheckItem {
  id: string
  label: string
  active: boolean
  toggle: () => void
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="px-2.5 py-1 rounded-full text-[0.7rem] font-semibold uppercase tracking-wide bg-vault-accent text-white">
      {children}
    </span>
  )
}

export function FilterDrawer({
  open, gamepadActive, filter, onChange, onApply, onRandom, onImport, onSearch,
  importLoading, importMessage, onClose, systems, genres,
}: Props) {
  const [focusedRow, setFocusedRow] = useState(0)
  const [dropdown, setDropdown] = useState<RowId | null>(null)
  const [dropdownFocus, setDropdownFocus] = useState(0)

  const rowRefs = useRef<(HTMLElement | null)[]>([])
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  // Focus order — System/Genre only when there's something to filter on.
  const rows: RowId[] = [
    ...(systems.length ? (['system'] as RowId[]) : []),
    ...(genres.length ? (['genre'] as RowId[]) : []),
    'players', 'options', 'search', 'apply', 'random', 'import',
  ]

  // Reset navigation each time the drawer opens.
  useEffect(() => {
    if (open) { setFocusedRow(0); setDropdown(null) }
  }, [open])

  const toggleValue = (key: 'systems' | 'genres', v: string) => {
    const cur = filter[key] ?? []
    onChange({ ...filter, [key]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] })
  }

  // The checklist items for the currently open dropdown.
  const dropdownItems = (row: RowId | null): CheckItem[] => {
    if (row === 'system') return systems.map(s => ({ id: s, label: s, active: (filter.systems ?? []).includes(s), toggle: () => toggleValue('systems', s) }))
    if (row === 'genre') return genres.map(g => ({ id: g, label: g, active: (filter.genres ?? []).includes(g), toggle: () => toggleValue('genres', g) }))
    if (row === 'players') return [1, 2, 4].map(n => ({ id: String(n), label: `${n} Player${n > 1 ? 's' : ''}`, active: filter.players === n, toggle: () => onChange({ ...filter, players: filter.players === n ? undefined : n }) }))
    if (row === 'options') return OPTION_DEFS.map(o => ({ id: o.key, label: o.label, active: !!filter[o.key], toggle: () => onChange({ ...filter, [o.key]: !filter[o.key] }) }))
    return []
  }

  // Active-selection chips shown under each category row.
  const chipsFor = (row: RowId): string[] => {
    if (row === 'system') return filter.systems ?? []
    if (row === 'genre') return filter.genres ?? []
    if (row === 'players') return filter.players ? [`${filter.players} Player${filter.players > 1 ? 's' : ''}`] : []
    if (row === 'options') return OPTION_DEFS.filter(o => filter[o.key]).map(o => o.label)
    return []
  }

  const activateRow = (row: RowId) => {
    if (DROPDOWN_ROWS.has(row)) { setDropdown(row); setDropdownFocus(0); return }
    if (row === 'search') onSearch()
    if (row === 'apply') onApply()
    if (row === 'random') onRandom()
    if (row === 'import') onImport()
  }

  useGamepad((action) => {
    if (dropdown) {
      const items = dropdownItems(dropdown)
      if (action === 'back' || action === 'filter') { setDropdown(null); return }
      if (action === 'up') setDropdownFocus(i => clamp(i - 1, 0, items.length - 1))
      if (action === 'down') setDropdownFocus(i => clamp(i + 1, 0, items.length - 1))
      if (action === 'confirm') items[dropdownFocus]?.toggle()
      return
    }
    if (action === 'back' || action === 'filter') { onClose(); return }
    if (action === 'up') setFocusedRow(i => clamp(i - 1, 0, rows.length - 1))
    if (action === 'down') setFocusedRow(i => clamp(i + 1, 0, rows.length - 1))
    if (action === 'confirm') { const row = rows[focusedRow]; if (row) activateRow(row) }
  }, gamepadActive)

  // Keep the focused row / dropdown item in view.
  useEffect(() => {
    if (!dropdown) rowRefs.current[focusedRow]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedRow, dropdown])
  useEffect(() => {
    if (dropdown) itemRefs.current[dropdownFocus]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [dropdownFocus, dropdown])

  const CATEGORY_LABELS: Record<string, string> = { system: 'System', genre: 'Genre', players: 'Players', options: 'Options' }

  const categoryRow = (row: RowId) => {
    const i = rows.indexOf(row)
    const chips = chipsFor(row)
    return (
      <button
        key={row}
        ref={el => { rowRefs.current[i] = el }}
        onClick={() => { setFocusedRow(i); activateRow(row) }}
        onMouseEnter={() => setFocusedRow(i)}
        className={[
          'w-full text-left rounded-xl px-4 py-3 bg-vault-surface border transition-colors',
          focusedRow === i && !dropdown ? 'border-vault-accent ring-2 ring-vault-accent' : 'border-vault-muted',
        ].join(' ')}
      >
        <div className="flex items-center justify-between">
          <span className="text-white text-sm font-semibold">{CATEGORY_LABELS[row]}</span>
          <span className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1">
            {chips.length ? `${chips.length} selected` : 'Any'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </span>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.map(c => <Chip key={c}>{c}</Chip>)}
          </div>
        )}
      </button>
    )
  }

  const actionRow = (row: 'search' | 'apply' | 'random' | 'import') => {
    const i = rows.indexOf(row)
    const focused = focusedRow === i && !dropdown
    if (row === 'search') {
      return (
        <input
          key="search"
          ref={el => { rowRefs.current[i] = el }}
          type="text"
          placeholder="Search game name…"
          value={filter.query ?? ''}
          onFocus={() => setFocusedRow(i)}
          onChange={e => onChange({ ...filter, query: e.target.value || undefined })}
          onKeyDown={e => { if (e.key === 'Enter') onApply() }}
          className={[
            'w-full bg-vault-surface border rounded-xl px-3.5 py-3 text-white text-sm focus:outline-none',
            focused ? 'border-vault-accent ring-2 ring-vault-accent' : 'border-vault-muted',
          ].join(' ')}
        />
      )
    }
    const primary = row === 'apply'
    const label = row === 'apply' ? 'Apply Filters' : row === 'random' ? 'Pick Random Game' : (importLoading ? 'Scanning ROMs…' : 'Update Library')
    return (
      <button
        key={row}
        ref={el => { rowRefs.current[i] = el }}
        onClick={() => { setFocusedRow(i); activateRow(row) }}
        onMouseEnter={() => setFocusedRow(i)}
        disabled={row === 'import' && importLoading}
        className={[
          'w-full py-3 rounded-xl font-bold text-white uppercase tracking-wide text-sm',
          primary ? 'bg-vault-accent' : 'bg-vault-surface border border-vault-muted',
          focused ? 'ring-2 ring-white' : '',
          row === 'import' && importLoading ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        {label}
      </button>
    )
  }

  const openItems = dropdownItems(dropdown)

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />}
      <div
        className={[
          'fixed top-0 left-0 h-full w-80 bg-vault-card z-50 flex flex-col',
          'transition-transform duration-250 ease-out motion-reduce:transition-none',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        style={{ boxShadow: '4px 0 24px rgba(0,0,0,0.6)' }}
      >
        <div className="p-6 border-b border-vault-surface flex items-center justify-between">
          <h2 className="text-white text-xl font-bold">Filters</h2>
          <button onClick={onClose} className="text-vault-muted text-sm uppercase tracking-wide flex items-center gap-1.5">
            <Glyph type="circle" /> Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {systems.length > 0 && categoryRow('system')}
          {genres.length > 0 && categoryRow('genre')}
          {categoryRow('players')}
          {categoryRow('options')}

          {/* Year Range — mouse-only, not in the gamepad focus order. */}
          <div className="rounded-xl px-4 py-3 bg-vault-surface border border-vault-muted">
            <p className="text-vault-muted text-xs uppercase tracking-widest mb-2">Year Range</p>
            <div className="flex items-center gap-3">
              <input
                type="number" placeholder="From" min={1970} max={2010}
                value={filter.yearRange?.[0] ?? ''}
                onChange={e => { const v = parseInt(e.target.value, 10); onChange({ ...filter, yearRange: [isNaN(v) ? 1970 : v, filter.yearRange?.[1] ?? 2010] }) }}
                className="w-24 bg-vault-card border border-vault-muted rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-vault-accent"
              />
              <span className="text-vault-muted">–</span>
              <input
                type="number" placeholder="To" min={1970} max={2025}
                value={filter.yearRange?.[1] ?? ''}
                onChange={e => { const v = parseInt(e.target.value, 10); onChange({ ...filter, yearRange: [filter.yearRange?.[0] ?? 1970, isNaN(v) ? 2025 : v] }) }}
                className="w-24 bg-vault-card border border-vault-muted rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-vault-accent"
              />
            </div>
          </div>

          {actionRow('search')}
        </div>

        <div className="p-6 border-t border-vault-surface space-y-3">
          {actionRow('apply')}
          {actionRow('random')}
          {actionRow('import')}
          {importMessage && <p className="text-vault-accent text-xs text-center">{importMessage}</p>}
          <p className="text-vault-muted text-xs flex items-center justify-center gap-1.5">
            <Glyph type="cross" /> Open  ·  Options Close  ·  <Glyph type="circle" /> Back
          </p>
        </div>

        {/* Dropdown checklist overlay — closed with Back. */}
        {dropdown && (
          <div className="absolute inset-0 z-10 bg-vault-card flex flex-col">
            <div className="p-6 border-b border-vault-surface flex items-center justify-between">
              <h2 className="text-white text-xl font-bold">{CATEGORY_LABELS[dropdown]}</h2>
              <button onClick={() => setDropdown(null)} className="text-vault-muted text-sm uppercase tracking-wide flex items-center gap-1.5">
                <Glyph type="circle" /> Back
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {openItems.length === 0 && <p className="text-vault-muted text-sm text-center py-6">Nothing to filter.</p>}
              {openItems.map((item, i) => (
                <button
                  key={item.id}
                  ref={el => { itemRefs.current[i] = el }}
                  onClick={item.toggle}
                  onMouseEnter={() => setDropdownFocus(i)}
                  className={[
                    'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-colors',
                    dropdownFocus === i ? 'bg-vault-surface ring-2 ring-vault-accent' : 'bg-transparent',
                  ].join(' ')}
                >
                  <span className={[
                    'w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center border',
                    item.active ? 'bg-vault-accent border-vault-accent' : 'border-vault-muted',
                  ].join(' ')}>
                    {item.active && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 7" /></svg>
                    )}
                  </span>
                  <span className={['flex-1 text-sm font-semibold truncate', item.active ? 'text-white' : 'text-[#d6d6e2]'].join(' ')}>{item.label}</span>
                </button>
              ))}
            </div>
            <div className="p-4 border-t border-vault-surface">
              <p className="text-vault-muted text-xs flex items-center justify-center gap-1.5">
                <Glyph type="cross" /> Toggle  ·  <Glyph type="circle" /> Back  ·  D-Pad Navigate
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
