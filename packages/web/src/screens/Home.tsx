import { useState, useEffect, useCallback } from 'react'
import type { Game, User, GameFilter } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { useSpatialNav } from '../hooks/useSpatialNav'
import { Rail } from '../components/Rail'
import { VirtualGrid, GRID_COLS } from '../components/VirtualGrid'
import { FilterDrawer } from '../components/FilterDrawer'
import { RandomGameModal } from '../components/RandomGameModal'
import { Glyph } from '../components/Glyph'

interface Props {
  user: User
  onGameSelect: (game: Game) => void
  onSwitchUser: () => void
}

const CONTINUE_THRESHOLD = 5 * 60

export function Home({ user, onGameSelect, onSwitchUser }: Props) {
  const [recent, setRecent] = useState<Game[]>([])
  const [favorites, setFavorites] = useState<Game[]>([])
  const [allGames, setAllGames] = useState<Game[]>([])
  const [systems, setSystems] = useState<string[]>([])
  const [genres, setGenres] = useState<string[]>([])
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

  const [rawHistory, setRawHistory] = useState<Array<Game & { duration_seconds: number }>>([])


  useEffect(() => {
    Promise.all([
      api.users.history(user.id),
      api.users.favorites(user.id),
      api.games.list(filter, user.id),
      api.meta.systems(),
      api.meta.genres(),
    ]).then(([history, favs, games, sysList, genreList]) => {
      const recentGames = history
        .filter((h, i, arr) => arr.findIndex(x => x.id === h.id) === i)
        .slice(0, 8)
        .map(h => ({ ...h } as Game))

      setRecent(recentGames)
      setRawHistory(history.slice(0, 8) as Array<Game & { duration_seconds: number }>)
      setFavorites(favs)
      setAllGames(games)
      setSystems(sysList)
      setGenres(genreList)
      setLoading(false)

      if (recentGames[0]) setBgGame(recentGames[0])
    }).catch(() => setLoading(false))
  }, [user.id])

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
      setImportMessage(
        result.errors.length
          ? `Imported ${result.imported} · ${result.errors.length} error(s)`
          : `Imported ${result.imported} game(s)`
      )
      const [games, sysList, genreList] = await Promise.all([
        api.games.list(filter, user.id),
        api.meta.systems(),
        api.meta.genres(),
      ])
      setAllGames(games)
      setSystems(sysList)
      setGenres(genreList)
    } catch {
      setImportMessage('Import failed')
    } finally {
      setImportLoading(false)
    }
  }, [filter, user.id])

  const nav = useSpatialNav({
    recentCount: recent.length,
    favoritesCount: favorites.length,
    allGamesCount: allGames.length,
    gridCols: GRID_COLS,
    filterDrawerItems: 11,
    filterDrawerOpen: filterOpen,
    onToggleFilter: () => setFilterOpen(v => !v),
    onConfirm: (region, row, col) => {
      if (filterOpen) {
        if (row === 8) { void refreshGames(); setFilterOpen(false) }
        if (row === 9) { setFilterOpen(false); void handleRandom() }
        if (row === 10) void handleImport()
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
      api.users.favorites(user.id).then(favs => {
        const isFav = favs.some(f => f.id === game!.id)
        if (isFav) {
          api.users.removeFavorite(user.id, game!.id).then(() =>
            setFavorites(prev => prev.filter(f => f.id !== game!.id))
          ).catch(() => {})
        } else {
          api.users.addFavorite(user.id, game!.id).then(() =>
            setFavorites(prev => [...prev, game!])
          ).catch(() => {})
        }
      }).catch(() => {})
    },
  })

  useGamepad(nav.handleAction, !randomGame)

  const recentIdx = nav.getIndex('recently-played')
  const favIdx = nav.getIndex('favorites')
  const gridIdx = nav.getIndex('all-games')
  const drawerIdx = nav.getIndex('filter-drawer')

  const getContinueLabel = useCallback((game: Game) => {
    const entry = rawHistory.find(r => r.id === game.id)
    if (entry !== undefined && entry.duration_seconds < CONTINUE_THRESHOLD) {
      return 'Continue'
    }
    return undefined
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
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{ background: user.avatar_color }}
            >
              {user.username.charAt(0).toUpperCase()}
            </div>
            <span className="text-white text-sm font-medium">{user.username}</span>
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
          />
        )}

        <VirtualGrid
          games={allGames}
          loading={loading}
          focusedRow={gridIdx.row}
          focusedCol={gridIdx.col}
          isActiveRegion={nav.region === 'all-games' && !filterOpen}
          onFocusGame={setBgGame}
        />

        <div className="h-16" />
      </div>

      <FilterDrawer
        open={filterOpen}
        filter={filter}
        onChange={setFilter}
        onApply={() => { void refreshGames(); setFilterOpen(false) }}
        onRandom={() => { setFilterOpen(false); void handleRandom() }}
        onImport={() => void handleImport()}
        importLoading={importLoading}
        importMessage={importMessage}
        onClose={() => setFilterOpen(false)}
        systems={systems}
        genres={genres}
        focusedRow={drawerIdx.row}
      />

      <RandomGameModal
        game={randomGame}
        loading={randomLoading}
        onClose={() => setRandomGame(null)}
        onView={(game) => { setRandomGame(null); onGameSelect(game) }}
        onAnother={() => void handleRandom()}
      />

      <div className="absolute bottom-0 left-0 right-0 h-12 flex items-center px-[5%] bg-gradient-to-t from-vault-bg to-transparent pointer-events-none">
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> Select  ·  <Glyph type="square" /> Favorite  ·  <Glyph type="circle" /> Back  ·  Start Filter  ·  D-Pad Navigate
        </p>
      </div>
    </div>
  )
}
