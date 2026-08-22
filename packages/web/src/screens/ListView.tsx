import { useState, useEffect, useRef } from 'react'
import type { Game, ListSource } from '@retro-vault/shared'
import { api, bgVariant } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { StatusBar } from '../components/StatusBar'
import { Breadcrumb, Title, HintBar, rowClass, Caret } from '../components/ui'

interface Props {
  sources: ListSource[]
  activeKey: string
  onBack: () => void
  onGameSelect: (game: Game) => void
  inputActive?: boolean
}

// Negative focus indices target the header controls above the rows.
const SELECTOR_INDEX = -1 // list-switcher dropdown
const SCRAPE_INDEX = -2    // "Scrape List" button

interface ScrapeProgress {
  total: number
  done: number
  failed: number
  current: string | null
  running: boolean
}

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
      className={rowClass(focused)}
    >
      <Caret selected={focused} />
      <span className="flex-1 min-w-0 text-lg truncate">{game.name}</span>
      <span
        className={[
          'flex-shrink-0 font-mono text-[0.8rem] uppercase tracking-[0.1em]',
          focused ? 'text-vault-ink/70' : 'text-vault-muted',
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
        <div className="w-64 h-80 overflow-hidden bg-vault-card border-[6px] border-vault-surface flex items-center justify-center">
          {game.box_art_path ? (
            <img src={game.box_art_path} alt={game.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-vault-surface">
              <CartridgeIcon />
              <span className="text-vault-muted text-[0.65rem] font-mono uppercase tracking-[0.14em]">{game.system}</span>
            </div>
          )}
        </div>
        {game.scraped_at && (
          <div className="mt-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-vault-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-vault-accent inline-block" />
            scraped
          </div>
        )}
      </div>

      {/* key on game.id restarts the rise-in animation on every focus change */}
      <div key={game.id} className="flex-1 min-w-0 flex flex-col gap-5 animate-rise-in motion-reduce:animate-none">
        <div>
          <p className="text-vault-accent font-mono text-[0.9rem] uppercase tracking-[0.14em]">{game.system}</p>
          <Title className="text-6xl mt-1">{game.name}</Title>
        </div>

        <div className="flex gap-8 py-4 border-y border-[#eaf0f8]/15 font-mono text-[0.9rem] tracking-[0.04em]">
          {game.genre && (
            <span><span className="text-vault-muted">genre </span>{game.genre}</span>
          )}
          {game.year && (
            <span><span className="text-vault-muted">year </span>{game.year}</span>
          )}
          {game.players && (
            <span><span className="text-vault-muted">players </span>{game.players}</span>
          )}
        </div>

        {game.description && (
          <p className="font-read text-[1.15rem] leading-[1.5] text-[#eaf0f8]/74 max-w-[60ch] line-clamp-[8]" style={{ ['textWrap' as string]: 'pretty' }}>
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
  const [scrape, setScrape] = useState<ScrapeProgress | null>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const dropdownRefs = useRef<(HTMLButtonElement | null)[]>([])
  // Set true to stop the sequential scrape between games.
  const cancelRef = useRef(false)

  const activeSource = sources.find(s => s.key === activeKey) ?? sources[0]
  const games = activeSource?.games ?? []
  const title = activeSource?.label ?? 'List'
  const pendingCount = games.reduce((n, g) => n + (g.scraped_at ? 0 : 1), 0)

  // Scrape every game in the active collection, one at a time so we don't
  // hammer ScreenScraper. Already-scraped games are skipped; individual
  // failures are counted, not fatal.
  const runScrape = async () => {
    if (scrape?.running) return
    const pending = games.filter(g => !g.scraped_at)
    if (!pending.length) return
    cancelRef.current = false
    setScrape({ total: pending.length, done: 0, failed: 0, current: null, running: true })
    let done = 0
    let failed = 0
    for (const g of pending) {
      if (cancelRef.current) break
      setScrape(s => (s ? { ...s, current: g.name } : s))
      try {
        await api.games.scrape(g.id)
      } catch {
        failed++
      }
      done++
      setScrape(s => (s ? { ...s, done, failed } : s))
    }
    setScrape(s => (s ? { ...s, running: false, current: null } : s))
  }

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
    if (scrape) {
      // Running: Back stops early. Done: Back/Confirm dismisses the summary.
      if (scrape.running) { if (action === 'back') cancelRef.current = true; return }
      if (action === 'back' || action === 'confirm') setScrape(null)
      return
    }
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
      if (focusedIndex === SCRAPE_INDEX) { void runScrape(); return }
      if (focusedIndex === SELECTOR_INDEX) { openDropdown(); return }
      if (focusedGame) onGameSelect(focusedGame)
      return
    }
    // The header holds two side-by-side controls: the list switcher (SELECTOR)
    // and, when the list is non-empty, Scrape (SCRAPE). Up from the rows lands
    // on the switcher; left/right hops between the header controls; down drops
    // back into the list.
    if (action === 'up') setFocusedIndex(i => (i > 0 ? i - 1 : i === 0 ? SELECTOR_INDEX : i))
    if (action === 'down') setFocusedIndex(i => (i < 0 ? (games.length > 0 ? 0 : i) : clamp(i + 1, 0, games.length - 1)))
    if (action === 'left' || action === 'right') {
      if (focusedIndex === SELECTOR_INDEX && games.length > 0) setFocusedIndex(SCRAPE_INDEX)
      else if (focusedIndex === SCRAPE_INDEX) setFocusedIndex(SELECTOR_INDEX)
    }
  }, inputActive)

  useEffect(() => {
    if (!inputActive || focusedIndex < 0) return
    rowRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, inputActive])

  // Opening a custom list counts as viewing it — bumps its recency so the
  // "Recently Viewed" list order floats it to the top next time.
  useEffect(() => {
    const m = /^list-(\d+)$/.exec(activeKey)
    if (m) api.lists.view(Number(m[1])).catch(() => {})
  }, [activeKey])

  // Keep the focused row visible inside the open list-switcher dropdown.
  useEffect(() => {
    if (dropdownOpen) dropdownRefs.current[dropdownFocus]?.scrollIntoView({ block: 'nearest' })
  }, [dropdownFocus, dropdownOpen])

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

      <div className="relative px-[5%] pt-[3%]"><Breadcrumb>home / lists</Breadcrumb></div>

      <header className="relative px-[5%] pt-3 pb-5 flex items-baseline justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              onClick={() => (dropdownOpen ? setDropdownOpen(false) : openDropdown())}
              onMouseEnter={() => setFocusedIndex(SELECTOR_INDEX)}
              className={[
                'flex items-center gap-3 rounded-[2px] px-4 py-2 -ml-4 transition-colors duration-150',
                'motion-reduce:transition-none',
                selectorFocused || dropdownOpen ? 'bg-vault-surface ring-2 ring-vault-accent' : 'hover:bg-vault-surface',
              ].join(' ')}
              title="Switch list"
            >
              <Title className="text-5xl">{title}</Title>
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={['text-vault-accent-bright transition-transform duration-150', dropdownOpen ? 'rotate-180' : ''].join(' ')}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-30 min-w-[280px] max-h-[60vh] overflow-y-auto rounded-[2px] bg-vault-panel border border-vault-surface py-2 shadow-2xl" style={{ scrollbarWidth: 'none' }}>
                {sources.map((src, i) => (
                  <button
                    key={src.key}
                    ref={el => { dropdownRefs.current[i] = el }}
                    onClick={() => selectSource(src.key)}
                    onMouseEnter={() => setDropdownFocus(i)}
                    className={[
                      'w-full flex items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors duration-100',
                      dropdownFocus === i ? 'bg-vault-surface' : '',
                    ].join(' ')}
                  >
                    <span className={['text-base truncate', src.key === activeKey ? 'text-vault-accent' : 'text-[#eaf0f8]'].join(' ')}>
                      {src.label}
                    </span>
                    <span className="text-vault-muted text-[0.7rem] font-mono uppercase tracking-[0.1em] flex-shrink-0">
                      {src.games.length}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-vault-muted font-mono text-[0.85rem] uppercase tracking-[0.1em]">{games.length} titles</span>
        </div>
        <div className="flex items-center gap-4">
          {games.length > 0 && (
            <button
              onClick={() => void runScrape()}
              onMouseEnter={() => setFocusedIndex(SCRAPE_INDEX)}
              disabled={pendingCount === 0}
              className={[
                'px-4 py-2 rounded-[2px] font-mono text-[0.8rem] uppercase tracking-[0.1em] inline-flex items-center gap-2',
                'border transition-colors duration-150 motion-reduce:transition-none',
                pendingCount === 0
                  ? 'border-vault-muted/40 text-vault-muted/40 cursor-default'
                  : focusedIndex === SCRAPE_INDEX && !dropdownOpen
                    ? 'ring-2 ring-white border-vault-accent-dim bg-vault-surface text-[#eaf0f8]'
                    : 'border-vault-muted text-vault-muted hover:text-vault-accent',
              ].join(' ')}
              title="Scrape metadata for unscraped games in this list"
            >
              {pendingCount === 0 ? 'all scraped' : `scrape list · ${pendingCount}`}
            </button>
          )}
          <StatusBar />
        </div>
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
        <HintBar hints={['d-pad move', dropdownOpen ? 'a choose list' : 'a open', 'b back to home', 'y unfavorite']} />
      </footer>

      {scrape && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/75" />
          <div className="relative bg-vault-panel border border-vault-surface p-8 w-full max-w-md space-y-5" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <h2 className="font-display text-3xl">
              {scrape.running ? `Scraping ${title}` : 'Scrape complete'}
            </h2>

            {/* Plain-text status, streamed — no animated progress bar (spec). */}
            <div className="font-mono text-sm tracking-[0.04em] text-vault-muted space-y-1">
              <p className="text-vault-accent">{scrape.done} / {scrape.total} scraped{scrape.failed > 0 ? ` · ${scrape.failed} failed` : ''}</p>
              {scrape.running && scrape.current && (
                <p className="truncate">current · {scrape.current}</p>
              )}
            </div>

            {scrape.running ? (
              <p className="font-mono text-xs uppercase tracking-[0.1em] text-vault-muted">b back to stop</p>
            ) : (
              <button
                onClick={() => setScrape(null)}
                className="w-full py-3 rounded-[2px] font-mono uppercase tracking-[0.08em] text-sm bg-vault-accent-bright text-vault-ink"
              >
                a done
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
