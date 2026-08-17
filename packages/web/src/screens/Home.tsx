import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Game, User, GameFilter, HistoryEntry, GameList, HomePrefs, ListSource } from '@retro-vault/shared'
import { api, bgVariant } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { useSpatialNav } from '../hooks/useSpatialNav'
import type { RailDef } from '../hooks/useSpatialNav'
import { Rail, RAIL_CAP } from '../components/Rail'
import { VirtualGrid, GRID_COLS } from '../components/VirtualGrid'
import { FilterDrawer } from '../components/FilterDrawer'
import { AddResultsToListModal } from '../components/AddResultsToListModal'
import { RandomGameModal } from '../components/RandomGameModal'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'
import { HealthIndicator } from '../components/HealthIndicator'
import { listOrderOf, gameSortOf } from '../prefs'
import type { GamepadAction } from '../hooks/useGamepad'

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

const CONTINUE_THRESHOLD = 5 * 60

// Grid page size: enough rows to cover several screens so scrolling rarely waits.
const PAGE_SIZE = 120
// How many pages of grid data to retain on each side of the visible window.
// Bounds the in-memory game store (~ (2·KEEP_PAGES + spanned pages)·PAGE_SIZE)
// so a huge library can't balloon the V8 heap on the 1GB Pi.
const KEEP_PAGES = 3

// Focusable columns in a rail: visible cards (capped) plus a Show More tile when there's overflow.
const railColCount = (len: number) => Math.min(len, RAIL_CAP) + (len > RAIL_CAP ? 1 : 0)

export function Home({ user, systems, genres, filter, homePrefs, onFilterChange, onGameSelect, onRandomView, onSwitchUser, onSettings, onShowMore, onLibraryChange, onListCreated, inputActive = true }: Props) {
  const [recent, setRecent] = useState<Game[]>([])
  const [favorites, setFavorites] = useState<Game[]>([])
  // Paged "All Games" grid: total count + a sparse index→game store filled on
  // demand as the grid scrolls, instead of holding the whole library in memory.
  const [gamesTotal, setGamesTotal] = useState(0)
  // Sparse index→game store for the paged "All Games" grid. Held in a ref and
  // mutated in place (not cloned per page — cloning a growing Map on every one
  // of ~160 page loads was O(n²) GC churn). A version counter triggers the
  // re-render when its contents change; pages far from the viewport are evicted
  // (see ensureRange) so memory stays bounded no matter how big the library is.
  const gamesStoreRef = useRef<Map<number, Game>>(new Map())
  const [storeVersion, setStoreVersion] = useState(0)
  const requestedPagesRef = useRef<Set<number>>(new Set())
  const filterRef = useRef(filter)
  filterRef.current = filter
  const [lists, setLists] = useState<GameList[]>([])
  const [listGames, setListGames] = useState<Record<number, Game[]>>({})
  const [loading, setLoading] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [bgGame, setBgGame] = useState<Game | null>(null)
  const [bgSrc, setBgSrc] = useState<string | null>(null)
  // Game art is the only color on screen — let it work (pre-blurred, cheap)
  const [bgOpacity, setBgOpacity] = useState(0.25)
  const [randomGame, setRandomGame] = useState<Game | null>(null)
  const [randomLoading, setRandomLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [rawHistory, setRawHistory] = useState<HistoryEntry[]>([])
  const [searchVkOpen, setSearchVkOpen] = useState(false)
  const [addToListOpen, setAddToListOpen] = useState(false)
  const [resultIds, setResultIds] = useState<number[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const historyToGames = (history: HistoryEntry[]): Game[] =>
    history
      .filter((h, i, arr) => arr.findIndex(x => x.id === h.id) === i)
      .map(h => ({
        id: h.id, name: h.name, system: h.system, genre: h.genre,
        year: h.year, players: h.players, description: h.description,
        box_art_path: h.box_art_path, scraped_at: h.scraped_at,
      } as Game))

  // Fetch a user's custom lists (ordered per the list-order pref) and the games
  // inside each non-empty one (ordered per the game-sort pref).
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

  // Load whatever grid pages back the [start, end) index window, once each, and
  // evict pages more than KEEP_PAGES away from that window so the store never
  // grows past a few hundred games — the grid re-requests an evicted page (via
  // onNeedRange) if it's scrolled back into view. Reads the current filter from
  // a ref so its identity stays stable.
  const ensureRange = useCallback((start: number, end: number) => {
    const first = Math.floor(start / PAGE_SIZE)
    const last = Math.floor(Math.max(start, end - 1) / PAGE_SIZE)

    // Drop far-away pages to bound memory (V8 heap is capped on the Pi).
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

  // Discard the grid and reload from page 0 (filter changed or library changed).
  const resetGrid = useCallback(() => {
    requestedPagesRef.current = new Set()
    gamesStoreRef.current = new Map()
    setStoreVersion(v => v + 1)
    setGamesTotal(0)
    ensureRange(0, PAGE_SIZE)
  }, [ensureRange])

  // Resolve a game by absolute grid index for VirtualGrid. Reads the mutable
  // store from a ref; storeVersion is in the deps so its identity changes when
  // pages load or are evicted, prompting the grid to re-render with fresh data.
  const getGame = useCallback((i: number) => gamesStoreRef.current.get(i), [storeVersion])

  useEffect(() => {
    Promise.all([
      api.users.history(user.id),
      api.users.favorites(user.id, gameSortOf(homePrefs)),
    ]).then(([history, favs]) => {
      const recentGames = historyToGames(history)
      setRecent(recentGames)
      setRawHistory(history.slice(0, 40))
      setFavorites(favs)
      setLoading(false)
      if (recentGames[0]) setBgGame(recentGames[0])
    }).catch(() => setLoading(false))
    void loadLists()
    resetGrid()
    // filter intentionally excluded — applyFilters drives grid reloads
  }, [user.id, loadLists, resetGrid])

  // Quiet refresh when returning from GameDetail/Settings (Home stays mounted).
  // Only history/favorites/lists change from playing a game — the library grid
  // does not, so it's left cached (no full refetch = no stall on back).
  const prevActiveRef = useRef(inputActive)
  useEffect(() => {
    if (inputActive && !prevActiveRef.current) {
      Promise.all([api.users.history(user.id), api.users.favorites(user.id, gameSortOf(homePrefs))])
        .then(([history, favs]) => {
          setRecent(historyToGames(history))
          setRawHistory(history.slice(0, 40))
          setFavorites(favs)
        }).catch(() => {})
      void loadLists()
    }
    prevActiveRef.current = inputActive
  }, [inputActive, user.id, loadLists])

  useEffect(() => {
    const art = bgGame?.box_art_path
    if (!art) return
    setBgOpacity(0)
    const t = setTimeout(() => {
      setBgSrc(bgVariant(art))
      setBgOpacity(0.25)
    }, 150)
    return () => clearTimeout(t)
  }, [bgGame])

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

  function applyFilters() {
    resetGrid()
    nav.resetIndex('all-games')
    setFilterOpen(false)
  }

  // Home layout prefs: Recently Played and All Games are always shown; the
  // Favorites rail and custom lists can be hidden from the home screen.
  const showFavorites = !homePrefs.hiddenKeys.includes('favorites')

  // Rails above the grid, in render/nav order. Only non-empty, non-hidden lists become rails.
  const activeLists = useMemo(
    () => lists.filter(l => (listGames[l.id]?.length ?? 0) > 0 && !homePrefs.hiddenKeys.includes(`list-${l.id}`)),
    [lists, listGames, homePrefs]
  )

  // Every collection selectable from the list-view dropdown (independent of what's
  // hidden on the home screen). Games are preloaded so switching is instant.
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

  const showMore = useCallback((activeKey: string) => {
    onShowMore(listSources, activeKey)
  }, [onShowMore, listSources])

  // Region key → the collection + title it represents (for confirm/favorite/show-more).
  const collectionFor = useCallback((region: string): { title: string; games: Game[] } | null => {
    if (region === 'recently-played') return { title: 'Recently Played', games: recent }
    if (region === 'favorites') return { title: 'Favorites', games: favorites }
    if (region.startsWith('list-')) {
      const id = Number(region.slice(5))
      const list = lists.find(l => l.id === id)
      if (!list) return null
      return { title: list.name, games: listGames[id] ?? [] }
    }
    return null
  }, [recent, favorites, lists, listGames])

  const navRails = useMemo<RailDef[]>(() => {
    const rails: RailDef[] = [
      { key: 'recently-played', colCount: railColCount(recent.length) },
    ]
    if (showFavorites) rails.push({ key: 'favorites', colCount: railColCount(favorites.length) })
    for (const l of activeLists) {
      rails.push({ key: `list-${l.id}`, colCount: railColCount(listGames[l.id]?.length ?? 0) })
    }
    return rails
  }, [recent.length, showFavorites, favorites.length, activeLists, listGames])

  const nav = useSpatialNav({
    rails: navRails,
    allGamesCount: gamesTotal,
    gridCols: GRID_COLS,
    // The FilterDrawer owns its own gamepad nav now; spatial-nav only needs to
    // know the drawer is open (so it stops snapping the home region) and how to
    // toggle it via the Options button.
    filterDrawerRowCounts: [],
    filterDrawerOpen: filterOpen,
    onToggleFilter: () => setFilterOpen(v => !v),
    onSettings,
    onConfirm: (region, row, col) => {
      if (region === 'all-games') {
        const game = gamesStoreRef.current.get(row * GRID_COLS + col)
        if (game) onGameSelect(game)
        return
      }
      const coll = collectionFor(region)
      if (!coll) return
      const visible = Math.min(coll.games.length, RAIL_CAP)
      if (coll.games.length > RAIL_CAP && col === visible) {
        showMore(region)
        return
      }
      const game = coll.games[col]
      if (game) onGameSelect(game)
    },
    onBack: onSwitchUser,
    onFavorite: (region, row, col) => {
      let game: Game | undefined
      if (region === 'all-games') game = gamesStoreRef.current.get(row * GRID_COLS + col)
      else game = collectionFor(region)?.games[col]
      if (!game) return
      const g = game
      api.games.favorite(g.id, user.id).then(({ favorited }) => {
        if (favorited) {
          setFavorites(prev => prev.some(f => f.id === g.id) ? prev : [...prev, g])
        } else {
          setFavorites(prev => prev.filter(f => f.id !== g.id))
        }
      }).catch(() => {})
    },
  })

  const handleAction = useCallback((action: GamepadAction) => {
    if (action === 'settings') { onSettings(); return }
    nav.handleAction(action)
  }, [nav, onSettings])

  // Drawer open → the FilterDrawer's own gamepad handler takes over.
  useGamepad(handleAction, inputActive && !randomGame && !randomLoading && !searchVkOpen && !filterOpen && !addToListOpen)

  // Rail cards scroll into view with block:'nearest', which pins the topmost
  // rail's card to the viewport top and leaves the header hidden above it.
  // When focus reaches the first navigable rail, scroll all the way up so the
  // header comes back into view.
  const topRegion = navRails.find(r => r.colCount > 0)?.key
  useEffect(() => {
    if (topRegion && nav.region === topRegion && !filterOpen) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [nav.region, topRegion, filterOpen])

  const gridIdx = nav.getIndex('all-games')

  const getContinueLabel = useCallback((game: Game) => {
    const entry = rawHistory.find(r => r.id === game.id)
    if (!entry) return undefined
    if (entry.duration_seconds < CONTINUE_THRESHOLD) return 'Continue'
    return entry.rom_region ?? undefined
  }, [rawHistory])

  return (
    <div className="fixed inset-0 bg-vault-bg overflow-hidden">
      <div
        className="absolute inset-0 transition-opacity duration-500 pointer-events-none motion-reduce:transition-none"
        style={{
          backgroundImage: bgSrc ? `url(${bgSrc})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: bgOpacity,
        }}
      />

      <div ref={scrollRef} className="relative h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <header className="px-[5%] pt-[3%] pb-2 flex items-center justify-between">
          <h1 className="text-white text-2xl font-bold tracking-tight">RetroVault</h1>
          <div className="flex items-center gap-3">
            <HealthIndicator />
            <Clock />
            <button
              onClick={() => setFilterOpen(true)}
              className="px-3 py-1.5 rounded-lg text-vault-muted hover:text-white text-xs font-semibold uppercase tracking-wide border border-vault-muted hover:border-vault-accent transition-colors"
              title="Filters (Options / Tab)"
            >
              Filters
            </button>
            <button
              onClick={onSettings}
              className="p-2 rounded-lg text-vault-muted hover:text-white transition-colors"
              title="Settings (Share / S)"
              aria-label="Settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              onClick={onSwitchUser}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-vault-surface transition-colors"
              title="Switch profile"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                style={{ background: user.avatar_color }}
              >
                {user.username.charAt(0).toUpperCase()}
              </div>
              <span className="text-white text-sm font-medium">{user.username}</span>
            </button>
          </div>
        </header>

        <Rail
          title="Recently Played"
          games={recent}
          loading={loading}
          focusedIndex={nav.getIndex('recently-played').col}
          isActiveRegion={nav.region === 'recently-played' && !filterOpen}
          skeletonCount={6}
          size="lg"
          getContinueLabel={getContinueLabel}
          onFocusGame={setBgGame}
          onSelectGame={onGameSelect}
          onShowMore={() => showMore('recently-played')}
        />

        {showFavorites && (favorites.length > 0 || loading) && (
          <Rail
            title="Favorites"
            games={favorites}
            loading={loading}
            focusedIndex={nav.getIndex('favorites').col}
            isActiveRegion={nav.region === 'favorites' && !filterOpen}
            skeletonCount={6}
            onFocusGame={setBgGame}
            onSelectGame={onGameSelect}
            onShowMore={() => showMore('favorites')}
          />
        )}

        {activeLists.map(list => {
          const games = listGames[list.id] ?? []
          const region = `list-${list.id}`
          return (
            <Rail
              key={list.id}
              title={list.name}
              games={games}
              focusedIndex={nav.getIndex(region).col}
              isActiveRegion={nav.region === region && !filterOpen}
              onFocusGame={setBgGame}
              onSelectGame={onGameSelect}
              onShowMore={() => showMore(`list-${list.id}`)}
            />
          )
        })}

        <VirtualGrid
          total={gamesTotal}
          getGame={getGame}
          onNeedRange={ensureRange}
          loading={loading && gamesStoreRef.current.size === 0}
          focusedRow={gridIdx.row}
          focusedCol={gridIdx.col}
          isActiveRegion={nav.region === 'all-games' && !filterOpen}
          onFocusGame={setBgGame}
          onSelectGame={onGameSelect}
        />

        <div className="h-16" />
      </div>

      <FilterDrawer
        open={filterOpen}
        gamepadActive={filterOpen && !searchVkOpen}
        filter={filter}
        onChange={(f) => onFilterChange(() => f)}
        onApply={applyFilters}
        onRandom={() => { setFilterOpen(false); void handleRandom() }}
        onImport={() => void handleImport()}
        onSearch={() => setSearchVkOpen(true)}
        onAddToList={() => {
          setFilterOpen(false)
          void api.games.ids(filter, user.id).then(ids => { setResultIds(ids); setAddToListOpen(true) })
        }}
        resultCount={gamesTotal}
        importLoading={importLoading}
        importMessage={importMessage}
        onClose={() => setFilterOpen(false)}
        systems={systems}
        genres={genres}
        lists={lists}
      />

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
          <div className="bg-vault-card rounded-2xl p-6 w-full max-w-[480px] space-y-4">
            <h2 className="text-white text-lg font-bold">Search Games</h2>
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

      <div className="absolute bottom-0 left-0 right-0 h-20 flex items-end pb-3 px-[5%] bg-gradient-to-t from-vault-bg via-vault-bg/80 to-transparent pointer-events-none">
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> Select  ·  <Glyph type="square" /> Favorite  ·  <Glyph type="circle" /> Back  ·  Options Filter  ·  Share Settings
        </p>
      </div>
    </div>
  )
}
