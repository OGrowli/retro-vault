import type { ReactNode } from 'react'
import type { GameFilter } from '@retro-vault/shared'

interface Props {
  open: boolean
  filter: GameFilter
  onChange: (filter: GameFilter) => void
  onApply: () => void
  onRandom: () => void
  onClose: () => void
  systems: string[]
  genres: string[]
  focusedRow: number
}

export const AVATAR_COLORS = ['#0070D1', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e']

function Toggle({ active, onToggle, label }: { active: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      onClick={onToggle}
      className={[
        'px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide transition-colors',
        active
          ? 'bg-vault-accent text-white'
          : 'bg-vault-surface text-vault-muted border border-vault-muted',
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

export function FilterDrawer({ open, filter, onChange, onApply, onRandom, onClose, systems, genres, focusedRow }: Props) {
  const toggleSystem = (s: string) => {
    const cur = filter.systems ?? []
    onChange({ ...filter, systems: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] })
  }

  const toggleGenre = (g: string) => {
    const cur = filter.genres ?? []
    onChange({ ...filter, genres: cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g] })
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40"
          onClick={onClose}
        />
      )}
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
          <button onClick={onClose} className="text-vault-muted text-sm uppercase tracking-wide">
            ○ Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {systems.length > 0 && (
            <Section title="System">
              <div className="flex flex-wrap gap-2">
                {systems.map(s => (
                  <Toggle
                    key={s}
                    label={s}
                    active={(filter.systems ?? []).includes(s)}
                    onToggle={() => toggleSystem(s)}
                  />
                ))}
              </div>
            </Section>
          )}

          {genres.length > 0 && (
            <Section title="Genre">
              <div className="flex flex-wrap gap-2">
                {genres.map(g => (
                  <Toggle
                    key={g}
                    label={g}
                    active={(filter.genres ?? []).includes(g)}
                    onToggle={() => toggleGenre(g)}
                  />
                ))}
              </div>
            </Section>
          )}

          <Section title="Players">
            <div className="flex gap-2">
              {[1, 2, 3, 4].map(n => (
                <Toggle
                  key={n}
                  label={String(n)}
                  active={filter.players === n}
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
            <div className="space-y-2">
              <Toggle
                label="Favorites Only"
                active={filter.favoritesOnly ?? false}
                onToggle={() => onChange({ ...filter, favoritesOnly: !filter.favoritesOnly })}
              />
              <Toggle
                label="Never Played"
                active={filter.neverPlayed ?? false}
                onToggle={() => onChange({ ...filter, neverPlayed: !filter.neverPlayed })}
              />
            </div>
          </Section>

          <Section title="Search">
            <input
              type="text"
              placeholder="Game name..."
              value={filter.query ?? ''}
              onChange={e => onChange({ ...filter, query: e.target.value || undefined })}
              className="w-full bg-vault-surface border border-vault-muted rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-vault-accent"
            />
          </Section>
        </div>

        <div className="p-6 border-t border-vault-surface space-y-3">
          <button
            onClick={onApply}
            className={[
              'w-full py-3 rounded-lg font-bold text-white uppercase tracking-wide text-sm',
              'bg-vault-accent hover:bg-vault-accent-bright transition-colors',
              focusedRow === 8 ? 'ring-2 ring-white' : '',
            ].join(' ')}
          >
            Apply Filters
          </button>
          <button
            onClick={onRandom}
            className={[
              'w-full py-3 rounded-lg font-bold text-white uppercase tracking-wide text-sm',
              'bg-vault-surface border border-vault-muted hover:border-vault-accent transition-colors',
              focusedRow === 9 ? 'ring-2 ring-white' : '',
            ].join(' ')}
          >
            Pick Random Game
          </button>
          <p className="text-vault-muted text-xs text-center">
            Start → filter  ·  ○ Close
          </p>
        </div>
      </div>
    </>
  )
}

