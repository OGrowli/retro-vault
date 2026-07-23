import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Game, User, GameFilter, HistoryEntry, GameList, HomePrefs, ListSource } from '@retro-vault/shared'
import { api, bgVariant } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { useSpatialNav } from '../hooks/useSpatialNav'
import type { RailDef } from '../hooks/useSpatialNav'
import { Rail, RAIL_CAP } from '../components/Rail'
import { VirtualGrid, GRID_COLS } from '../components/VirtualGrid'
import { FilterDrawer } from '../components/FilterDrawer'
import type { DrawerRowKind } from '../components/FilterDrawer'
import { RandomGameModal } from '../components/RandomGameModal'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'
import type { GamepadAction } from '../hooks/useGamepad'

interface Props {
  user: User
  systems: string[]
  genres: string[]
  filter: GameFilter
  homePrefs: HomePrefs
  onFilterChange: (update: (f: GameFilter) => GameFilter) => void
  onGameSelect: (game: Game) => void
  onSwitchUser: () => void
  onSettings: () => void
  onShowMore: (sources: ListSource[], activeKey: string) => void
  onLibraryChange?: () => void
  inputActive?: boolean
}

const CONTINUE_THRESHOLD = 5 * 60

// Focusable columns in a rail: visible cards (capped) plus a Show More tile when there's overflow.
const railColCount = (len: number) => Math.min(len, RAIL_CAP) + (len > RAIL_CAP ? 1 : 0)

export function Home({ user, systems, genres, filter, homePrefs, onFilterChange, onGameSelect, onSwitchUser, onSettings, onShowMore, onLibraryChange, inputActive = true }: Props) {
  const [recent, setRecent] = useState<Game[]>([])
  const [favorites, setFavorites] = useState<Game[]>([])
  const [allGames, setAllGames] = useState<Game[]>([])
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

  const historyToGames = (history: HistoryEntry[]): Game[] =>
    history
      .filter((h, i, arr) => arr.findIndex(x => x.id === h.id) === i)
      .map(h => ({
        id: h.id, name: h.name, system: h.system, genre: h.genre,
        year: h.year, players: h.players, description: h.description,
        box_art_path: h.box_art_path, scraped_at: h.scraped_at,
      } as Game))

  // Fetch a user's custom lists and the games inside each non-empty one.
  const loadLists = useCallback(async () => {
    try {
      const userLists = await api.lists.forUser(user.id)
      setLists(userLists)
      const withGames = userLists.filter(l => l.game_count > 0)
      const entries = await Promise.all(
        withGames.map(async l => [l.id, await api.lists.games(l.id)] as const)
      )
      setListGames(Object.fromEntries(entries))
    } catch { /* lists are non-critical */ }
  }, [user.id])

  useEffect(() => {
    Promise.all([
      api.users.history(user.id),
      api.users.favorites(user.id),
      api.games.list(filter, user.id),
    ]).then(([history, favs, games]) => {
      const recentGames = historyToGames(history)
      setRecent(recentGames)
      setRawHistory(history.slice(0, 40))
      setFavorites(favs)
      setAllGames(games)
      setLoading(false)
      if (recentGames[0]) setBgGame(recentGames[0])
    }).catch(() => setLoading(false))
    void loadLists()
    // filter intentionally excluded — it drives refreshGames, not the initial load
  }, [user.id, loadLists])

  const refreshGames = useCallback(async () => {
    try {
      const games = await api.games.list(filter, user.id)
      setAllGames(games)
    } catch {}
  }, [filter, user.id])

  // Quiet refresh when returning from GameDetail/Settings (Home stays mounted)
  const prevActiveRef = useRef(inputActive)
  useEffect(() => {
    if (inputActive && !prevActiveRef.current) {
      Promise.all([api.users.history(user.id), api.users.favorites(user.id)])
        .then(([history, favs]) => {
          setRecent(historyToGames(history))
          setRawHistory(history.slice(0, 40))
          setFavorites(favs)
        }).catch(() => {})
      void refreshGames()
      void loadLists()
    }
    prevActiveRef.current = inputActive
  }, [inputActive, user.id, refreshGames, loadLists])

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
      const [games] = await Promise.all([api.games.list(filter, user.id)])
      setAllGames(games)
      onLibraryChange?.()
    } catch (e) {
      setImportMessage(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImportLoading(false)
    }
  }, [filter, user.id, onLibraryChange])

  // Drawer nav rows: chip sections first (only when non-empty), then search + action buttons.
  // Must mirror FilterDrawer's render order.
  const drawerRows = useMemo(() => {
    const rows: { kind: DrawerRowKind; count: number }[] = []
    if (systems.length > 0) rows.push({ kind: 'systems', count: systems.length })
    if (genres.length > 0) rows.push({ kind: 'genres', count: genres.length })
    rows.push({ kind: 'players', count: 3 })
    rows.push({ kind: 'options', count: 3 })
    rows.push({ kind: 'search', count: 1 })
    rows.push({ kind: 'apply', count: 1 })
    rows.push({ kind: 'random', count: 1 })
    rows.push({ kind: 'import', count: 1 })
    return rows
  }, [systems, genres])

  const toggleDrawerChip = (kind: DrawerRowKind, col: number) => {
    if (kind === 'systems') {
      const s = systems[col]
      if (!s) return
      onFilterChange(f => {
        const cur = f.systems ?? []
        return { ...f, systems: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] }
      })
    }
    if (kind === 'genres') {
      const g = genres[col]
      if (!g) return
      onFilterChange(f => {
        const cur = f.genres ?? []
        return { ...f, genres: cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g] }
      })
    }
    if (kind === 'players') {
      const p = [1, 2, 4][col]
      onFilterChange(f => ({ ...f, players: f.players === p ? undefined : p }))
    }
    if (kind === 'options') {
      if (col === 0) onFilterChange(f => ({ ...f, favoritesOnly: !f.favoritesOnly }))
      if (col === 1) onFilterChange(f => ({ ...f, neverPlayed: !f.neverPlayed }))
      if (col === 2) onFilterChange(f => ({ ...f, noMetadata: !f.noMetadata }))
    }
  }

  function applyFilters() {
    void refreshGames()
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
    allGamesCount: allGames.length,
    gridCols: GRID_COLS,
    filterDrawerRowCounts: drawerRows.map(r => r.count),
    filterDrawerOpen: filterOpen,
    onToggleFilter: () => setFilterOpen(v => !v),
    onSettings,
    onConfirm: (region, row, col) => {
      if (filterOpen) {
        const rowDef = drawerRows[row]
        if (!rowDef) return
        switch (rowDef.kind) {
          case 'search': setSearchVkOpen(true); break
          case 'apply': applyFilters(); break
          case 'random': setFilterOpen(false); void handleRandom(); break
          case 'import': void handleImport(); break
          default: toggleDrawerChip(rowDef.kind, col)
        }
        return
      }
      if (region === 'all-games') {
        const game = allGames[row * GRID_COLS + col]
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
      if (region === 'all-games') game = allGames[row * GRID_COLS + col]
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

  useGamepad(handleAction, inputActive && !randomGame && !randomLoading && !searchVkOpen)

  const gridIdx = nav.getIndex('all-games')
  const drawerIdx = nav.getIndex('filter-drawer')

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

      <div className="relative h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <header className="px-[5%] pt-[3%] pb-2 flex items-center justify-between">
          <h1 className="text-white text-2xl font-bold tracking-tight">RetroVault</h1>
          <div className="flex items-center gap-3">
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
          games={allGames}
          loading={loading}
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
        filter={filter}
        onChange={(f) => onFilterChange(() => f)}
        onApply={applyFilters}
        onRandom={() => { setFilterOpen(false); void handleRandom() }}
        onImport={() => void handleImport()}
        importLoading={importLoading}
        importMessage={importMessage}
        onClose={() => setFilterOpen(false)}
        systems={systems}
        genres={genres}
        focus={filterOpen && drawerRows[drawerIdx.row]
          ? { kind: drawerRows[drawerIdx.row].kind, col: drawerIdx.col }
          : null}
      />

      <RandomGameModal
        game={randomGame}
        loading={randomLoading}
        onClose={() => setRandomGame(null)}
        onView={(game) => { setRandomGame(null); onGameSelect(game) }}
        onAnother={() => void handleRandom()}
      />

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
