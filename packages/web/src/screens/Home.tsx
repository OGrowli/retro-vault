import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Game, User, GameFilter, HomePrefs, GameList, ListSource } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { useHomeNav } from '../hooks/useHomeNav'
import { GameList as GameListView } from '../components/GameList'
import { FilterChips, buildChips } from '../components/FilterChips'
import type { ActionChipId, ChipId } from '../components/FilterChips'
import { AddResultsToListModal } from '../components/AddResultsToListModal'
import { RandomGameModal } from '../components/RandomGameModal'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { Clock } from '../components/Clock'
import { HealthIndicator } from '../components/HealthIndicator'
import { Breadcrumb, SectionHeader, HintBar, rowClass, Caret } from '../components/ui'
import { listOrderOf, gameSortOf } from '../prefs'

interface Props {
  user: User
  systems: string[]
  genres: string[]
  filter: GameFilter
  homePrefs: HomePrefs
  onFilterChange: (update: (f: GameFilter) => GameFilter) => void
  onGameSelect: (game: Game) => void
  onRandomView?: (game: Game) => void
  onSwitchUser: () => void
  onSettings: () => void
  onShowMore: (sources: ListSource[], activeKey: string) => void
  onLibraryChange?: () => void
  onListCreated?: (listId: number) => void
  inputActive?: boolean
}

// Grid page size: enough rows to cover several screens so scrolling rarely waits.
const PAGE_SIZE = 120
// How many pages to retain on each side of the visible window. Bounds the
// in-memory game store so a huge library can't balloon the V8 heap on the Pi.
const KEEP_PAGES = 3

export function Home({ user, systems, genres, filter, homePrefs, onFilterChange, onGameSelect, onRandomView, onSwitchUser, onSettings, onShowMore, onLibraryChange, onListCreated, inputActive = true }: Props) {
  const [recent, setRecent] = useState<Game[]>([])
  const [favorites, setFavorites] = useState<Game[]>([])
  // Paged "All Games" list: total count + a sparse index→game store filled on
  // demand as the list scrolls, instead of holding the whole library in memory.
  const [gamesTotal, setGamesTotal] = useState(0)
  const gamesStoreRef = useRef<Map<number, Game>>(new Map())
  const [storeVersion, setStoreVersion] = useState(0)
  const requestedPagesRef = useRef<Set<number>>(new Set())
  const filterRef = useRef(filter)
  filterRef.current = filter
  const [lists, setLists] = useState<GameList[]>([])
  const [listGames, setListGames] = useState<Record<number, Game[]>>({})
  const [loading, setLoading] = useState(true)
  const [randomGame, setRandomGame] = useState<Game | null>(null)
  const [randomLoading, setRandomLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [searchVkOpen, setSearchVkOpen] = useState(false)
  const [addToListOpen, setAddToListOpen] = useState(false)
  const [resultIds, setResultIds] = useState<number[]>([])
  const [openChip, setOpenChip] = useState<ChipId | null>(null)

  const historyToGames = (history: { id: number; name: string; system: string; genre: string | null; year: number | null; players: number | null; description: string | null; box_art_path: string | null; scraped_at: string | null }[]): Game[] =>
    history
      .filter((h, i, arr) => arr.findIndex(x => x.id === h.id) === i)
      .map(h => ({
        id: h.id, name: h.name, system: h.system, genre: h.genre,
        year: h.year, players: h.players, description: h.description,
        box_art_path: h.box_art_path, scraped_at: h.scraped_at,
      } as Game))

  const loadLists = useCallback(async () => {
    try {
      const userLists = await api.lists.forUser(user.id, undefined, listOrderOf(homePrefs))
      setLists(userLists)
      const sort = gameSortOf(homePrefs)
      const withGames = userLists.filter(l => l.game_count > 0)
      const entries = await Promise.all(
        withGames.map(async l => [l.id, await api.lists.games(l.id, { userId: user.id, sort })] as const)
      )
      setListGames(Object.fromEntries(entries))
    } catch { /* lists are non-critical */ }
  }, [user.id, homePrefs])

  // Load whatever pages back the [start, end) index window, once each, and evict
  // pages more than KEEP_PAGES away so the store never grows past a few hundred
  // games — the list re-requests an evicted page if scrolled back into view.
  const ensureRange = useCallback((start: number, end: number) => {
    const first = Math.floor(start / PAGE_SIZE)
    const last = Math.floor(Math.max(start, end - 1) / PAGE_SIZE)

    const keepLo = first - KEEP_PAGES
    const keepHi = last + KEEP_PAGES
    const store = gamesStoreRef.current
    let changed = false
    for (const pg of [...requestedPagesRef.current]) {
      if (pg < keepLo || pg > keepHi) {
        for (let i = 0; i < PAGE_SIZE; i++) store.delete(pg * PAGE_SIZE + i)
        requestedPagesRef.current.delete(pg)
        changed = true
      }
    }

    const toFetch: number[] = []
    for (let pg = first; pg <= last; pg++) {
      if (requestedPagesRef.current.has(pg)) continue
      requestedPagesRef.current.add(pg)
      toFetch.push(pg)
    }
    if (changed && toFetch.length === 0) setStoreVersion(v => v + 1)

    for (const pg of toFetch) {
      api.games.page(filterRef.current, user.id, { limit: PAGE_SIZE, offset: pg * PAGE_SIZE })
        .then(({ total, items }) => {
          setGamesTotal(total)
          items.forEach((g, i) => gamesStoreRef.current.set(pg * PAGE_SIZE + i, g))
          setStoreVersion(v => v + 1)
        })
        .catch(() => { requestedPagesRef.current.delete(pg) })
    }
  }, [user.id])

  const resetGrid = useCallback(() => {
    requestedPagesRef.current = new Set()
    gamesStoreRef.current = new Map()
    setStoreVersion(v => v + 1)
    setGamesTotal(0)
    ensureRange(0, PAGE_SIZE)
  }, [ensureRange])

  const getGame = useCallback((i: number) => gamesStoreRef.current.get(i), [storeVersion])

  useEffect(() => {
    Promise.all([
      api.users.history(user.id),
      api.users.favorites(user.id, gameSortOf(homePrefs)),
    ]).then(([history, favs]) => {
      setRecent(historyToGames(history))
      setFavorites(favs)
      setLoading(false)
    }).catch(() => setLoading(false))
    void loadLists()
    resetGrid()
  }, [user.id, loadLists, resetGrid])

  // Quiet refresh when returning from GameDetail/Settings (Home stays mounted).
  const prevActiveRef = useRef(inputActive)
  useEffect(() => {
    if (inputActive && !prevActiveRef.current) {
      Promise.all([api.users.history(user.id), api.users.favorites(user.id, gameSortOf(homePrefs))])
        .then(([history, favs]) => { setRecent(historyToGames(history)); setFavorites(favs) })
        .catch(() => {})
      void loadLists()
    }
    prevActiveRef.current = inputActive
  }, [inputActive, user.id, loadLists])

  const handleRandom = useCallback(async () => {
    setRandomLoading(true)
    try {
      const game = await api.games.random(filter, user.id)
      setRandomGame(game)
    } catch {} finally {
      setRandomLoading(false)
    }
  }, [filter, user.id])

  const handleImport = useCallback(async () => {
    setImportLoading(true)
    setImportMessage(null)
    try {
      const result = await api.import.run()
      const { games_created, games_updated, roms_created } = result
      setImportMessage(`+${games_created} games  +${games_updated} updated  +${roms_created} ROMs`)
      resetGrid()
      onLibraryChange?.()
    } catch (e) {
      setImportMessage(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImportLoading(false)
    }
  }, [resetGrid, onLibraryChange])

  // Every collection selectable from the list view (Recently Played, Favorites,
  // then custom lists). Games are preloaded so opening one is instant.
  const listSources = useMemo<ListSource[]>(() => {
    const sources: ListSource[] = [
      { key: 'recently-played', label: 'Recently Played', games: recent },
      { key: 'favorites', label: 'Favorites', games: favorites },
    ]
    for (const l of lists) {
      const games = listGames[l.id] ?? []
      if (games.length > 0) sources.push({ key: `list-${l.id}`, label: l.name, games })
    }
    return sources
  }, [recent, favorites, lists, listGames])

  // Lists shown on Home respect the Home-layout prefs (hidden collections drop
  // off the screen); the full set is still handed to List View's switcher.
  const visibleLists = useMemo(
    () => listSources.filter(s => s.key === 'recently-played' || !homePrefs.hiddenKeys.includes(s.key)),
    [listSources, homePrefs.hiddenKeys]
  )

  const chips = useMemo(() => buildChips(systems, genres, lists), [systems, genres, lists])

  const nav = useHomeNav({
    topCount: 2,
    chipCount: chips.length,
    listCount: visibleLists.length,
    allGamesCount: gamesTotal,
    disabled: !inputActive,
    onConfirm: (region, index) => {
      if (region === 'top') { if (index === 0) setSearchVkOpen(true); else void handleRandom(); return }
      if (region === 'chips') {
        const chip = chips[index]
        if (!chip) return
        if (chip.kind === 'filter') { setOpenChip(chip.id); return }
        runAction(chip.id as ActionChipId)
        return
      }
      if (region === 'lists') { const src = visibleLists[index]; if (src) onShowMore(listSources, src.key); return }
      if (region === 'all-games') { const g = gamesStoreRef.current.get(index); if (g) onGameSelect(g) }
    },
    onFavorite: (region, index) => {
      const g = region === 'all-games' ? gamesStoreRef.current.get(index) : undefined
      if (!g) return
      api.games.favorite(g.id, user.id).then(({ favorited }) => {
        setFavorites(prev => favorited
          ? (prev.some(f => f.id === g.id) ? prev : [...prev, g])
          : prev.filter(f => f.id !== g.id))
      }).catch(() => {})
    },
    onBack: onSwitchUser,
    onSettings,
  })

  const applyFilters = useCallback(() => {
    resetGrid()
    nav.resetAllGames()
  }, [resetGrid, nav])

  const runAction = (id: ActionChipId) => {
    if (id === 'clear') { onFilterChange(() => ({})); applyFilters() }
    if (id === 'update') void handleImport()
    if (id === 'addResults') void api.games.ids(filter, user.id).then(ids => { setResultIds(ids); setAddToListOpen(true) })
  }

  const handleAction = useCallback((action: Parameters<typeof nav.handleAction>[0]) => {
    nav.handleAction(action)
  }, [nav])

  // Home nav is suspended while a chip dropdown, the search keyboard, or a modal
  // owns input — those render their own gamepad handlers.
  useGamepad(handleAction, inputActive && !openChip && !searchVkOpen && !randomGame && !randomLoading && !addToListOpen)

  const gameCount = gamesTotal
  const searchFocused = nav.region === 'top' && nav.indexOf('top') === 0
  const randomFocused = nav.region === 'top' && nav.indexOf('top') === 1

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col px-[5%] py-[3%] font-sans overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <Breadcrumb>retrovault / home</Breadcrumb>
        <span className="flex-1" />
        <HealthIndicator />
        <Clock />
        <button onClick={onSettings} className="font-mono text-[0.8rem] uppercase tracking-[0.12em] text-vault-muted hover:text-vault-accent" title="Settings (Share / S)">settings</button>
        <button onClick={onSwitchUser} className="flex items-center gap-2.5 px-2 py-1 hover:bg-vault-surface transition-colors" title="Switch profile">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: user.avatar_color }}>
            {user.username.charAt(0).toUpperCase()}
          </div>
          <span className="font-mono text-[0.85rem] tracking-[0.06em] text-[#eaf0f8]">{user.username}</span>
        </button>
      </div>

      {/* Search + Random */}
      <div className="flex items-center gap-3 mt-5 flex-shrink-0">
        <button
          onClick={() => setSearchVkOpen(true)}
          className={[
            'flex-1 max-w-[560px] flex items-center gap-3 px-4 py-3 border-l-[6px] text-left',
            searchFocused ? 'bg-vault-accent-bright text-vault-ink border-vault-pink' : 'bg-vault-panel border-transparent',
          ].join(' ')}
        >
          <span className={`font-mono text-[0.7rem] uppercase tracking-[0.12em] ${searchFocused ? 'text-vault-ink/60' : 'text-vault-muted'}`}>search</span>
          <span className="text-lg truncate">{filter.query || `${gameCount.toLocaleString()} games`}</span>
        </button>
        <button
          onClick={() => void handleRandom()}
          className={[
            'px-5 py-3 border-l-[6px] font-mono uppercase tracking-[0.1em] text-sm',
            randomFocused ? 'bg-vault-accent-bright text-vault-ink border-vault-pink' : 'bg-vault-panel border-transparent text-[#eaf0f8]',
          ].join(' ')}
        >
          random
        </button>
      </div>

      {/* Filter chips */}
      <div className="relative mt-4 flex-shrink-0">
        <FilterChips
          filter={filter}
          onChange={(f) => onFilterChange(() => f)}
          onApply={applyFilters}
          systems={systems}
          genres={genres}
          lists={lists}
          chips={chips}
          focusedIndex={nav.indexOf('chips')}
          isActive={nav.region === 'chips'}
          openChip={openChip}
          onOpenChip={(id) => setOpenChip(id)}
          onAction={runAction}
          onCloseChip={() => setOpenChip(null)}
          resultCount={gamesTotal}
          importLoading={importLoading}
        />
        {importMessage && <p className="text-vault-accent text-xs font-mono mt-1">{importMessage}</p>}
      </div>

      {/* Lists */}
      {visibleLists.length > 0 && (
        <div className="mt-5 flex-shrink-0">
          <SectionHeader label="lists" meta={`${visibleLists.length} collections`} />
          <div className="flex flex-col mt-2 max-h-[22vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
            {visibleLists.map((src, i) => {
              const focused = nav.region === 'lists' && nav.indexOf('lists') === i
              return (
                <div key={src.key} onClick={() => onShowMore(listSources, src.key)} className={rowClass(focused)}>
                  <Caret selected={focused} />
                  <span className="truncate text-lg">{src.label}</span>
                  <span className="flex-1" />
                  <span className={`font-mono text-[0.85rem] tracking-[0.06em] ${focused ? 'text-vault-ink/70' : 'text-vault-muted'}`}>
                    {src.games.length} games
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All Games */}
      <div className="mt-5 flex-1 min-h-0 flex flex-col">
        <div className="flex-shrink-0">
          <SectionHeader label="all games" meta={`${gamesTotal.toLocaleString()} filtered`} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto mt-2" style={{ scrollbarWidth: 'none' }}>
          <GameListView
            total={gamesTotal}
            getGame={getGame}
            onNeedRange={ensureRange}
            loading={loading && gamesStoreRef.current.size === 0}
            focusedIndex={nav.indexOf('all-games')}
            isActive={nav.region === 'all-games'}
            onSelect={onGameSelect}
          />
        </div>
      </div>

      <div className="flex-shrink-0 pt-3">
        <HintBar hints={['d-pad move', 'a open', 'y favorite', 'x filter', 'start settings']} />
      </div>

      <RandomGameModal
        game={randomGame}
        loading={randomLoading}
        onClose={() => setRandomGame(null)}
        onView={(game) => { setRandomGame(null); (onRandomView ?? onGameSelect)(game) }}
        onAnother={() => void handleRandom()}
      />

      {addToListOpen && (
        <AddResultsToListModal
          gameIds={resultIds}
          user={user}
          onClose={() => setAddToListOpen(false)}
          onListCreated={onListCreated}
          onChanged={loadLists}
        />
      )}

      {searchVkOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] px-4">
          <div className="bg-vault-panel border border-vault-surface p-6 w-full max-w-[480px] space-y-4">
            <h2 className="font-display text-3xl">Search Games</h2>
            <VirtualKeyboard
              value={filter.query ?? ''}
              onChange={(v) => onFilterChange(f => ({ ...f, query: v || undefined }))}
              onDone={() => { setSearchVkOpen(false); applyFilters() }}
              onCancel={() => setSearchVkOpen(false)}
              enabled={searchVkOpen}
            />
          </div>
        </div>
      )}
    </div>
  )
}
