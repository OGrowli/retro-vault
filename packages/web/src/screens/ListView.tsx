import { useState, useEffect, useRef } from 'react'
import type { Game, ListSource } from '@retro-vault/shared'
import { bgVariant } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Clock } from '../components/Clock'
import { Glyph } from '../components/Glyph'

interface Props {
  sources: ListSource[]
  activeKey: string
  onBack: () => void
  onGameSelect: (game: Game) => void
  inputActive?: boolean
}

// -1 focuses the list-switcher dropdown that sits above the rows.
const SELECTOR_INDEX = -1

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

function CartridgeIcon({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className="opacity-20">
      <rect x="4" y="14" width="40" height="24" rx="12" stroke="white" strokeWidth="2" />
      <rect x="12" y="23" width="8" height="2.5" rx="1.25" fill="white" />
      <rect x="14.75" y="20.25" width="2.5" height="8" rx="1.25" fill="white" />
      <circle cx="31" cy="22" r="2" fill="white" />
      <circle cx="35" cy="26" r="2" fill="white" />
      <line x1="17" y1="14" x2="17" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <line x1="31" y1="14" x2="31" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function GameListRow({
  game,
  focused,
  onFocus,
  onSelect,
  rowRef,
}: {
  game: Game
  focused: boolean
  onFocus: () => void
  onSelect: () => void
  rowRef: (el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={rowRef}
      onMouseEnter={onFocus}
      onClick={onSelect}
      className={[
        'flex items-center gap-3.5 px-3.5 py-2.5 mb-1.5 rounded-xl cursor-pointer',
        'transition-[background-color,transform,box-shadow] duration-150 motion-reduce:transition-none',
        focused ? 'bg-vault-surface ring-2 ring-vault-accent scale-[1.02] translate-x-0.5' : 'bg-transparent',
      ].join(' ')}
    >
      <span
        className={[
          'w-1.5 h-1.5 rounded-full flex-shrink-0 transition-transform duration-150',
          focused ? 'bg-vault-accent-bright scale-150' : 'bg-vault-muted',
        ].join(' ')}
      />
      <span
        className={[
          'flex-1 min-w-0 text-[0.95rem] font-semibold tracking-wide truncate',
          focused ? 'text-white' : 'text-[#d6d6e2]',
        ].join(' ')}
      >
        {game.name}
      </span>
      <span
        className={[
          'flex-shrink-0 text-[0.65rem] font-bold uppercase tracking-wider',
          focused ? 'text-vault-accent-bright' : 'text-vault-muted',
        ].join(' ')}
      >
        {game.system}
      </span>
    </div>
  )
}

function GamePreviewPanel({ game }: { game: Game | null }) {
  if (!game) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-vault-muted">
        <CartridgeIcon />
        <span className="text-xs uppercase tracking-widest">Move focus to a title to preview it</span>
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 flex gap-10 items-start">
      <div className="flex-shrink-0 w-64">
        <div className="w-64 h-80 rounded-2xl overflow-hidden bg-vault-card shadow-2xl flex items-center justify-center">
          {game.box_art_path ? (
            <img src={game.box_art_path} alt={game.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-vault-surface">
              <CartridgeIcon />
              <span className="text-vault-muted text-[0.65rem] uppercase tracking-widest">{game.system}</span>
            </div>
          )}
        </div>
        {game.scraped_at && (
          <div className="mt-3 flex items-center justify-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-vault-accent-bright inline-block" />
            <span className="text-vault-accent-bright text-xs uppercase tracking-wide font-semibold">Scraped</span>
          </div>
        )}
      </div>

      {/* key on game.id restarts the rise-in animation on every focus change */}
      <div key={game.id} className="flex-1 min-w-0 flex flex-col gap-4 animate-rise-in motion-reduce:animate-none">
        <div>
          <p className="text-vault-accent-bright text-sm font-bold uppercase tracking-widest">{game.system}</p>
          <h2 className="text-white text-4xl font-extrabold leading-tight mt-0.5">{game.name}</h2>
        </div>

        <div className="flex gap-7 py-3.5 border-y border-vault-surface">
          {game.genre && (
            <div>
              <p className="text-vault-muted text-xs uppercase tracking-wide">Genre</p>
              <p className="text-white text-sm font-semibold mt-0.5">{game.genre}</p>
            </div>
          )}
          {game.year && (
            <div>
              <p className="text-vault-muted text-xs uppercase tracking-wide">Year</p>
              <p className="text-white text-sm font-semibold mt-0.5">{game.year}</p>
            </div>
          )}
          {game.players && (
            <div>
              <p className="text-vault-muted text-xs uppercase tracking-wide">Players</p>
              <p className="text-white text-sm font-semibold mt-0.5">{game.players}</p>
            </div>
          )}
        </div>

        {game.description && (
          <p className="text-vault-muted text-[17px] leading-relaxed max-w-[60ch] line-clamp-[8]">
            {game.description}
          </p>
        )}
      </div>
    </div>
  )
}

export function ListView({ sources, activeKey: initialKey, onBack, onGameSelect, inputActive = true }: Props) {
  const [activeKey, setActiveKey] = useState(initialKey)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dropdownFocus, setDropdownFocus] = useState(0)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  const activeSource = sources.find(s => s.key === activeKey) ?? sources[0]
  const games = activeSource?.games ?? []
  const title = activeSource?.label ?? 'List'

  const focusedGame = focusedIndex >= 0 ? (games[focusedIndex] ?? null) : null

  const selectSource = (key: string) => {
    setActiveKey(key)
    setFocusedIndex(0)
    setDropdownOpen(false)
  }

  const openDropdown = () => {
    setDropdownFocus(Math.max(0, sources.findIndex(s => s.key === activeKey)))
    setDropdownOpen(true)
  }

  useGamepad((action) => {
    if (dropdownOpen) {
      if (action === 'back') { setDropdownOpen(false); return }
      if (action === 'up') setDropdownFocus(i => clamp(i - 1, 0, sources.length - 1))
      if (action === 'down') setDropdownFocus(i => clamp(i + 1, 0, sources.length - 1))
      if (action === 'confirm') {
        const src = sources[dropdownFocus]
        if (src) selectSource(src.key)
      }
      return
    }
    if (action === 'back') { onBack(); return }
    if (action === 'confirm') {
      if (focusedIndex === SELECTOR_INDEX) { openDropdown(); return }
      if (focusedGame) onGameSelect(focusedGame)
      return
    }
    if (action === 'up') setFocusedIndex(i => clamp(i - 1, SELECTOR_INDEX, games.length - 1))
    if (action === 'down') setFocusedIndex(i => clamp(i + 1, SELECTOR_INDEX, games.length - 1))
  }, inputActive)

  useEffect(() => {
    if (!inputActive || focusedIndex < 0) return
    rowRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, inputActive])

  const bgSrc = focusedGame?.box_art_path ? bgVariant(focusedGame.box_art_path) : null
  const selectorFocused = focusedIndex === SELECTOR_INDEX && !dropdownOpen

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-500 motion-reduce:transition-none"
        style={{
          backgroundImage: bgSrc ? `url(${bgSrc})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: bgSrc ? 0.18 : 0,
        }}
      />

      <header className="relative px-[5%] pt-[3%] pb-5 flex items-baseline justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              onClick={() => (dropdownOpen ? setDropdownOpen(false) : openDropdown())}
              onMouseEnter={() => setFocusedIndex(SELECTOR_INDEX)}
              className={[
                'flex items-center gap-3 rounded-xl px-4 py-2 -ml-4 transition-colors duration-150',
                'motion-reduce:transition-none',
                selectorFocused || dropdownOpen ? 'bg-vault-surface ring-2 ring-vault-accent' : 'hover:bg-vault-surface',
              ].join(' ')}
              title="Switch list"
            >
              <h1 className="text-white text-2xl font-bold tracking-tight">{title}</h1>
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={['text-vault-accent-bright transition-transform duration-150', dropdownOpen ? 'rotate-180' : ''].join(' ')}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-30 min-w-[280px] max-h-[60vh] overflow-y-auto rounded-xl bg-vault-card border border-vault-surface py-2 shadow-2xl" style={{ scrollbarWidth: 'none' }}>
                {sources.map((src, i) => (
                  <button
                    key={src.key}
                    onClick={() => selectSource(src.key)}
                    onMouseEnter={() => setDropdownFocus(i)}
                    className={[
                      'w-full flex items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors duration-100',
                      dropdownFocus === i ? 'bg-vault-surface' : '',
                    ].join(' ')}
                  >
                    <span className={['text-sm font-semibold truncate', src.key === activeKey ? 'text-vault-accent-bright' : 'text-white'].join(' ')}>
                      {src.label}
                    </span>
                    <span className="text-vault-muted text-[0.65rem] font-bold uppercase tracking-wider flex-shrink-0">
                      {src.games.length}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-vault-muted text-xs uppercase tracking-widest">{games.length} titles</span>
        </div>
        <Clock />
      </header>

      <main className="relative flex-1 flex gap-10 px-[5%] pb-6 min-h-0">
        <div className="w-[400px] flex-shrink-0 overflow-y-auto pr-2" style={{ scrollbarWidth: 'none' }}>
          {games.length === 0 ? (
            <p className="text-vault-muted text-sm py-8 text-center">This list is empty.</p>
          ) : (
            games.map((game, i) => (
              <GameListRow
                key={game.id}
                game={game}
                focused={focusedIndex === i}
                onFocus={() => setFocusedIndex(i)}
                onSelect={() => onGameSelect(game)}
                rowRef={el => { rowRefs.current[i] = el }}
              />
            ))
          )}
        </div>

        <GamePreviewPanel game={focusedGame} />
      </main>

      <footer className="relative flex-shrink-0 px-[5%] pb-4 pt-3 bg-gradient-to-t from-vault-bg to-transparent">
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> {dropdownOpen ? 'Choose list' : 'Select'}  ·  <Glyph type="circle" /> Back  ·  ↑↓ / D-Pad to move focus  ·  Focus title + <Glyph type="cross" /> to switch list
        </p>
      </footer>
    </div>
  )
}
