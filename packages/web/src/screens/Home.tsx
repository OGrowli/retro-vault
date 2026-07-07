import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Game, User, GameFilter, HistoryEntry } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { useSpatialNav } from '../hooks/useSpatialNav'
import { Rail } from '../components/Rail'
import { VirtualGrid, GRID_COLS } from '../components/VirtualGrid'
import { FilterDrawer } from '../components/FilterDrawer'
import type { DrawerRowKind } from '../components/FilterDrawer'
import { RandomGameModal } from '../components/RandomGameModal'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { Glyph } from '../components/Glyph'
import type { GamepadAction } from '../hooks/useGamepad'

interface Props {
  user: User
  systems: string[]
  genres: string[]
  onGameSelect: (game: Game) => void
  onSwitchUser: () => void
  onSettings: () => void
  onLibraryChange?: () => void
  inputActive?: boolean
}

const CONTINUE_THRESHOLD = 5 * 60

export function Home({ user, systems, genres, onGameSelect, onSwitchUser, onSettings, onLibraryChange, inputActive = true }: Props) {
  const [recent, setRecent] = useState<Game[]>([])
  const [favorites, setFavorites] = useState<Game[]>([])
  const [allGames, setAllGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<GameFilter>({})
  const [filterOpen, setFilterOpen] = useState(false)
  const [bgGame, setBgGame] = useState<Game | null>(null)
  const [bgSrc, setBgSrc] = useState<string | null>(null)
  const [bgOpacity, setBgOpacity] = useState(0.15)
  const [randomGame, setRandomGame] = useState<Game | null>(null)
  const [randomLoading, setRandomLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [rawHistory, setRawHistory] = useState<HistoryEntry[]>([])
  const [searchVkOpen, setSearchVkOpen] = useState(false)

  const historyToRecent = (history: HistoryEntry[]): Game[] =>
    history
      .filter((h, i, arr) => arr.findIndex(x => x.id === h.id) === i)
      .slice(0, 8)
      .map(h => ({
        id: h.id, name: h.name, system: h.system, genre: h.genre,
        year: h.year, players: h.players, description: h.description,
        box_art_path: h.box_art_path, scraped_at: h.scraped_at,
      } as Game))

  useEffect(() => {
    Promise.all([
      api.users.history(user.id),
      api.users.favorites(user.id),
      api.games.list(filter, user.id),
    ]).then(([history, favs, games]) => {
      const recentGames = historyToRecent(history)
      setRecent(recentGames)
      setRawHistory(history.slice(0, 40))
      setFavorites(favs)
      setAllGames(games)
      setLoading(false)
      if (recentGames[0]) setBgGame(recentGames[0])
    }).catch(() => setLoading(false))
  }, [user.id])

  // Quiet refresh of recent/favorites when returning from GameDetail (Home stays mounted)
  const prevActiveRef = useRef(inputActive)
  useEffect(() => {
    if (inputActive && !prevActiveRef.current) {
      Promise.all([api.users.history(user.id), api.users.favorites(user.id)])
        .then(([history, favs]) => {
          setRecent(historyToRecent(history))
          setRawHistory(history.slice(0, 40))
          setFavorites(favs)
        }).catch(() => {})
    }
    prevActiveRef.current = inputActive
  }, [inputActive, user.id])

  useEffect(() => {
    if (!bgGame?.box_art_path) return
    setBgOpacity(0)
    const t = setTimeout(() => {
      setBgSrc(bgGame.box_art_path)
      setBgOpacity(0.15)
    }, 150)
    return () => clearTimeout(t)
  }, [bgGame])

  const refreshGames = useCallback(async () => {
    try {
      const games = await api.games.list(filter, user.id)
      setAllGames(games)
    } catch {}
  }, [filter, user.id])

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
      setFilter(f => {
        const cur = f.systems ?? []
        return { ...f, systems: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] }
      })
    }
    if (kind === 'genres') {
      const g = genres[col]
      if (!g) return
      setFilter(f => {
        const cur = f.genres ?? []
        return { ...f, genres: cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g] }
      })
    }
    if (kind === 'players') {
      const p = [1, 2, 4][col]
      setFilter(f => ({ ...f, players: f.players === p ? undefined : p }))
    }
    if (kind === 'options') {
      if (col === 0) setFilter(f => ({ ...f, favoritesOnly: !f.favoritesOnly }))
      if (col === 1) setFilter(f => ({ ...f, neverPlayed: !f.neverPlayed }))
      if (col === 2) setFilter(f => ({ ...f, noMetadata: !f.noMetadata }))
    }
  }

  function applyFilters() {
    void refreshGames()
    nav.resetIndex('all-games')
    setFilterOpen(false)
  }

  const nav = useSpatialNav({
    recentCount: recent.length,
    favoritesCount: favorites.length,
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
      let game: Game | undefined
      if (region === 'recently-played') game = recent[col]
      if (region === 'favorites') game = favorites[col]
      if (region === 'all-games') game = allGames[row * GRID_COLS + col]
      if (game) onGameSelect(game)
    },
    onBack: onSwitchUser,
    onFavorite: (region, row, col) => {
      let game: Game | undefined
      if (region === 'recently-played') game = recent[col]
      if (region === 'favorites') game = favorites[col]
      if (region === 'all-games') game = allGames[row * GRID_COLS + col]
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

  const recentIdx = nav.getIndex('recently-played')
  const favIdx = nav.getIndex('favorites')
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
          filter: 'blur(40px)',
          opacity: bgOpacity,
          transform: 'scale(1.05)',
        }}
      />

      <div className="relative h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <header className="px-[5%] pt-[3%] pb-2 flex items-center justify-between">
          <h1 className="text-white text-2xl font-bold tracking-tight">RetroVault</h1>
          <div className="flex items-center gap-3">
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
          focusedIndex={recentIdx.col}
          isActiveRegion={nav.region === 'recently-played' && !filterOpen}
          skeletonCount={6}
          size="lg"
          getContinueLabel={getContinueLabel}
          onFocusGame={setBgGame}
          onSelectGame={onGameSelect}
        />

        {(favorites.length > 0 || loading) && (
          <Rail
            title="Favorites"
            games={favorites}
            loading={loading}
            focusedIndex={favIdx.col}
            isActiveRegion={nav.region === 'favorites' && !filterOpen}
            skeletonCount={6}
            onFocusGame={setBgGame}
            onSelectGame={onGameSelect}
          />
        )}

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
        onChange={setFilter}
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
              onChange={(v) => setFilter(f => ({ ...f, query: v || undefined }))}
              onDone={() => { setSearchVkOpen(false); applyFilters() }}
              onCancel={() => setSearchVkOpen(false)}
              enabled={searchVkOpen}
            />
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 h-12 flex items-center px-[5%] bg-gradient-to-t from-vault-bg to-transparent pointer-events-none">
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> Select  ·  <Glyph type="square" /> Favorite  ·  <Glyph type="circle" /> Back  ·  Options Filter  ·  Share Settings
        </p>
      </div>
    </div>
  )
}
