import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { GameFilter } from '@retro-vault/shared'
import { Glyph } from './Glyph'

export type DrawerRowKind =
  | 'systems' | 'genres' | 'players' | 'options'
  | 'search' | 'apply' | 'random' | 'import'

export interface DrawerFocus {
  kind: DrawerRowKind
  col: number
}

interface Props {
  open: boolean
  filter: GameFilter
  onChange: (filter: GameFilter) => void
  onApply: () => void
  onRandom: () => void
  onImport: () => void
  importLoading: boolean
  importMessage: string | null
  onClose: () => void
  systems: string[]
  genres: string[]
  focus: DrawerFocus | null
}

function Toggle({ active, focused, onToggle, label }: {
  active: boolean
  focused?: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      onClick={onToggle}
      data-drawer-focused={focused ? 'true' : undefined}
      className={[
        'px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide transition-colors',
        active
          ? 'bg-vault-accent text-white'
          : 'bg-vault-surface text-vault-muted border border-vault-muted',
        focused ? 'ring-2 ring-white' : '',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-vault-muted text-xs uppercase tracking-widest mb-2">{title}</p>
      {children}
    </div>
  )
}

export function FilterDrawer({
  open, filter, onChange, onApply, onRandom, onImport,
  importLoading, importMessage, onClose, systems, genres, focus,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const toggleSystem = (s: string) => {
    const cur = filter.systems ?? []
    onChange({ ...filter, systems: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] })
  }

  const toggleGenre = (g: string) => {
    const cur = filter.genres ?? []
    onChange({ ...filter, genres: cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g] })
  }

  // Keep the controller-focused chip visible in the scrollable area
  useEffect(() => {
    if (!focus) return
    const el = scrollRef.current?.querySelector('[data-drawer-focused="true"]')
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus])

  const isFocused = (kind: DrawerRowKind, col?: number) =>
    focus?.kind === kind && (col === undefined || focus.col === col)

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

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
          {systems.length > 0 && (
            <Section title="System">
              <div className="flex flex-wrap gap-2">
                {systems.map((s, i) => (
                  <Toggle
                    key={s}
                    label={s}
                    active={(filter.systems ?? []).includes(s)}
                    focused={isFocused('systems', i)}
                    onToggle={() => toggleSystem(s)}
                  />
                ))}
              </div>
            </Section>
          )}

          {genres.length > 0 && (
            <Section title="Genre">
              <div className="flex flex-wrap gap-2">
                {genres.map((g, i) => (
                  <Toggle
                    key={g}
                    label={g}
                    active={(filter.genres ?? []).includes(g)}
                    focused={isFocused('genres', i)}
                    onToggle={() => toggleGenre(g)}
                  />
                ))}
              </div>
            </Section>
          )}

          <Section title="Players">
            <div className="flex gap-2">
              {[1, 2, 4].map((n, i) => (
                <Toggle
                  key={n}
                  label={String(n)}
                  active={filter.players === n}
                  focused={isFocused('players', i)}
                  onToggle={() => onChange({ ...filter, players: filter.players === n ? undefined : n })}
                />
              ))}
            </div>
          </Section>

          <Section title="Year Range">
            <div className="flex items-center gap-3">
              <input
                type="number"
                placeholder="From"
                value={filter.yearRange?.[0] ?? ''}
                min={1970}
                max={2010}
                onChange={e => {
                  const v = parseInt(e.target.value, 10)
                  onChange({ ...filter, yearRange: [isNaN(v) ? 1970 : v, filter.yearRange?.[1] ?? 2010] })
                }}
                className="w-24 bg-vault-surface border border-vault-muted rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-vault-accent"
              />
              <span className="text-vault-muted">–</span>
              <input
                type="number"
                placeholder="To"
                value={filter.yearRange?.[1] ?? ''}
                min={1970}
                max={2025}
                onChange={e => {
                  const v = parseInt(e.target.value, 10)
                  onChange({ ...filter, yearRange: [filter.yearRange?.[0] ?? 1970, isNaN(v) ? 2025 : v] })
                }}
                className="w-24 bg-vault-surface border border-vault-muted rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-vault-accent"
              />
            </div>
          </Section>

          <Section title="Options">
            <div className="flex flex-wrap gap-2">
              <Toggle
                label="Favorites Only"
                active={filter.favoritesOnly ?? false}
                focused={isFocused('options', 0)}
                onToggle={() => onChange({ ...filter, favoritesOnly: !filter.favoritesOnly })}
              />
              <Toggle
                label="Never Played"
                active={filter.neverPlayed ?? false}
                focused={isFocused('options', 1)}
                onToggle={() => onChange({ ...filter, neverPlayed: !filter.neverPlayed })}
              />
              <Toggle
                label="No Metadata"
                active={filter.noMetadata ?? false}
                focused={isFocused('options', 2)}
                onToggle={() => onChange({ ...filter, noMetadata: !filter.noMetadata })}
              />
            </div>
          </Section>

          <Section title="Search">
            <input
              type="text"
              placeholder="Game name..."
              value={filter.query ?? ''}
              onChange={e => onChange({ ...filter, query: e.target.value || undefined })}
              onKeyDown={e => { if (e.key === 'Enter') onApply() }}
              data-drawer-focused={isFocused('search') ? 'true' : undefined}
              className={[
                'w-full bg-vault-surface border rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-vault-accent',
                isFocused('search') ? 'border-vault-accent ring-1 ring-vault-accent' : 'border-vault-muted',
              ].join(' ')}
            />
          </Section>
        </div>

        <div className="p-6 border-t border-vault-surface space-y-3">
          <button
            onClick={onApply}
            className={[
              'w-full py-3 rounded-lg font-bold text-white uppercase tracking-wide text-sm bg-vault-accent',
              isFocused('apply') ? 'ring-2 ring-white' : '',
            ].join(' ')}
          >
            Apply Filters
          </button>
          <button
            onClick={onRandom}
            className={[
              'w-full py-3 rounded-lg font-bold text-white uppercase tracking-wide text-sm bg-vault-surface border border-vault-muted',
              isFocused('random') ? 'ring-2 ring-white' : '',
            ].join(' ')}
          >
            Pick Random Game
          </button>
          <button
            onClick={onImport}
            disabled={importLoading}
            className={[
              'w-full py-3 rounded-lg font-bold text-white uppercase tracking-wide text-sm bg-vault-surface border border-vault-muted',
              isFocused('import') ? 'ring-2 ring-white' : '',
              importLoading ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {importLoading ? 'Scanning ROMs...' : 'Update Library'}
          </button>
          {importMessage && <p className="text-vault-accent text-xs text-center">{importMessage}</p>}
          <p className="text-vault-muted text-xs flex items-center justify-center gap-1.5">
            <Glyph type="cross" /> Toggle  ·  Start Filter  ·  <Glyph type="circle" /> Close
          </p>
        </div>
      </div>
    </>
  )
}
