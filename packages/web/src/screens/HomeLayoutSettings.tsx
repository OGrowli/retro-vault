import { useState, useEffect } from 'react'
import type { User, GameList, HomePrefs } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'

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

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export function HomeLayoutSettings({ user, prefs, onChange, onBack }: Props) {
  const [lists, setLists] = useState<GameList[]>([])
  const [focused, setFocused] = useState(0)

  useEffect(() => {
    api.lists.forUser(user.id).then(setLists).catch(() => {})
  }, [user.id])

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

  // rows.length + 1 focus targets — the trailing one is the Back button.
  const backIdx = rows.length

  const isHidden = (key: string) => prefs.hiddenKeys.includes(key)

  const toggle = (row: Row) => {
    if (row.locked) return
    const hiddenKeys = isHidden(row.key)
      ? prefs.hiddenKeys.filter(k => k !== row.key)
      : [...prefs.hiddenKeys, row.key]
    onChange({ ...prefs, hiddenKeys })
  }

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    if (action === 'up') setFocused(i => clamp(i - 1, 0, backIdx))
    if (action === 'down') setFocused(i => clamp(i + 1, 0, backIdx))
    if (action === 'confirm') {
      if (focused === backIdx) { onBack(); return }
      const row = rows[focused]
      if (row) toggle(row)
    }
  }, true)

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">Home Screen</h1>
          <p className="text-vault-muted text-xs uppercase tracking-widest mt-1">Choose which rails appear</p>
        </div>
        <div className="ml-auto"><Clock /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-8" style={{ scrollbarWidth: 'none' }}>
        <div className="space-y-3 max-w-lg">
          {rows.map((row, i) => {
            const on = row.locked || !isHidden(row.key)
            return (
              <button
                key={row.key}
                onClick={() => toggle(row)}
                onMouseEnter={() => setFocused(i)}
                disabled={row.locked}
                className={[
                  'w-full py-4 px-5 rounded-xl text-left flex items-center gap-4',
                  'bg-vault-surface border transition-colors duration-150 motion-reduce:transition-none',
                  focused === i ? 'ring-2 ring-white border-vault-accent' : 'border-vault-muted',
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
          <Glyph type="circle" /> Back  ·  D-Pad Navigate  ·  <Glyph type="cross" /> Toggle
        </p>
      </div>
    </div>
  )
}
