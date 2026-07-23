import { useState, useEffect, useCallback } from 'react'
import type { User, Game, GameFilter, HomePrefs, ListSource } from '@retro-vault/shared'
import { api } from './api/client'
import { ProfileSelect } from './screens/ProfileSelect'
import { Home } from './screens/Home'
import { GameDetail } from './screens/GameDetail'
import { ListView } from './screens/ListView'
import { Settings } from './screens/Settings'
import { HomeLayoutSettings } from './screens/HomeLayoutSettings'
import { ScrapeSettings } from './screens/ScrapeSettings'
import { ControllerSettings } from './screens/ControllerSettings'
import { EmulatorSettings } from './screens/EmulatorSettings'

type Screen = 'profile-select' | 'home' | 'game-detail' | 'settings' | 'list-view' | 'home-settings' | 'scrape-settings' | 'controller-settings' | 'emulator-settings'

// Navigation hierarchy: back always goes to the screen's parent.
const SCREEN_PARENT: Record<Screen, Screen | null> = {
  'profile-select': null,
  'home': 'profile-select',
  'game-detail': 'home',
  'settings': 'home',
  'list-view': 'home',
  'home-settings': 'settings',
  'scrape-settings': 'settings',
  'controller-settings': 'settings',
  'emulator-settings': 'settings',
}

const filterKey = (userId: number) => `retrovault:filter:${userId}`

function loadFilter(userId: number): GameFilter {
  try {
    const raw = localStorage.getItem(filterKey(userId))
    return raw ? (JSON.parse(raw) as GameFilter) : {}
  } catch {
    return {}
  }
}

function saveFilter(userId: number, filter: GameFilter) {
  try {
    localStorage.setItem(filterKey(userId), JSON.stringify(filter))
  } catch { /* storage full / disabled — filter just won't persist */ }
}

const homePrefsKey = (userId: number) => `retrovault:home-prefs:${userId}`
const DEFAULT_HOME_PREFS: HomePrefs = { hiddenKeys: [] }

function loadHomePrefs(userId: number): HomePrefs {
  try {
    const raw = localStorage.getItem(homePrefsKey(userId))
    return raw ? (JSON.parse(raw) as HomePrefs) : DEFAULT_HOME_PREFS
  } catch {
    return DEFAULT_HOME_PREFS
  }
}

function saveHomePrefs(userId: number, prefs: HomePrefs) {
  try {
    localStorage.setItem(homePrefsKey(userId), JSON.stringify(prefs))
  } catch { /* storage full / disabled — prefs just won't persist */ }
}

export function App() {
  const [screen, setScreen] = useState<Screen>('profile-select')
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)
  const [listView, setListView] = useState<{ sources: ListSource[]; activeKey: string } | null>(null)
  // Where game-detail was opened from, so Back returns there (home or a list view).
  const [gameDetailFrom, setGameDetailFrom] = useState<Screen>('home')
  const [systems, setSystems] = useState<string[]>([])
  const [genres, setGenres] = useState<string[]>([])
  // Lifted out of Home so it survives Home's unmount/remount when launching a game.
  const [filter, setFilter] = useState<GameFilter>({})
  const [homePrefs, setHomePrefs] = useState<HomePrefs>(DEFAULT_HOME_PREFS)

  const refreshMeta = useCallback(() => {
    Promise.all([api.meta.systems(), api.meta.genres()]).then(([s, g]) => {
      setSystems(s)
      setGenres(g)
    }).catch(() => {})
  }, [])

  useEffect(() => { refreshMeta() }, [refreshMeta])

  // Hydrate the filter from localStorage whenever the active user changes, so it
  // survives a full page reload / kiosk relaunch, not just in-app navigation.
  useEffect(() => {
    if (currentUser) {
      setFilter(loadFilter(currentUser.id))
      setHomePrefs(loadHomePrefs(currentUser.id))
    }
  }, [currentUser?.id])

  useEffect(() => {
    if (currentUser) saveFilter(currentUser.id, filter)
  }, [filter, currentUser?.id])

  useEffect(() => {
    if (currentUser) saveHomePrefs(currentUser.id, homePrefs)
  }, [homePrefs, currentUser?.id])

  // Launching a game tears down the kiosk browser; the fresh Chromium after
  // the game exits asks the API who was playing what and returns to that
  // game's screen instead of profile select. (Server-side because the
  // browser dies too fast at launch for localStorage to reach disk.)
  useEffect(() => {
    api.roms.resume().then(({ resume }) => {
      if (!resume) return
      return Promise.all([api.users.list(), api.games.get(resume.game_id)])
        .then(([users, game]) => {
          const user = users.find(u => u.id === resume.user_id)
          if (!user || !game) return
          setCurrentUser(user)
          setSelectedGame(game)
          setScreen('game-detail')
        })
    }).catch(() => {})
  }, [])

  const handleProfileSelect = (user: User) => {
    setCurrentUser(user)
    setScreen('home')
  }

  const handleGameSelect = (game: Game) => {
    setGameDetailFrom(screen === 'list-view' ? 'list-view' : 'home')
    setSelectedGame(game)
    setScreen('game-detail')
  }

  const handleShowMore = (sources: ListSource[], activeKey: string) => {
    setListView({ sources, activeKey })
    setScreen('list-view')
  }

  const goBack = useCallback(() => {
    setScreen(s => {
      if (s === 'game-detail') {
        setSelectedGame(null)
        return gameDetailFrom
      }
      const parent = SCREEN_PARENT[s]
      return parent ?? s
    })
  }, [gameDetailFrom])

  return (
    <>
      {screen === 'profile-select' && (
        <ProfileSelect onSelect={handleProfileSelect} />
      )}
      {(screen === 'home' || screen === 'game-detail' || screen === 'list-view') && currentUser && (
        <Home
          user={currentUser}
          systems={systems}
          genres={genres}
          filter={filter}
          homePrefs={homePrefs}
          onFilterChange={setFilter}
          onGameSelect={handleGameSelect}
          onSwitchUser={goBack}
          onSettings={() => setScreen('settings')}
          onShowMore={handleShowMore}
          onLibraryChange={refreshMeta}
          inputActive={screen === 'home'}
        />
      )}
      {(screen === 'list-view' || (screen === 'game-detail' && gameDetailFrom === 'list-view')) && listView && (
        <ListView
          sources={listView.sources}
          activeKey={listView.activeKey}
          onGameSelect={handleGameSelect}
          onBack={goBack}
          inputActive={screen === 'list-view'}
        />
      )}
      {screen === 'game-detail' && currentUser && selectedGame && (
        <GameDetail
          game={selectedGame}
          user={currentUser}
          onBack={goBack}
        />
      )}
      {screen === 'settings' && (
        <Settings
          onBack={goBack}
          onOpenHome={() => setScreen('home-settings')}
          onOpenScraping={() => setScreen('scrape-settings')}
          onOpenControllers={() => setScreen('controller-settings')}
          onOpenHotkeys={() => setScreen('emulator-settings')}
        />
      )}
      {screen === 'home-settings' && currentUser && (
        <HomeLayoutSettings
          user={currentUser}
          prefs={homePrefs}
          onChange={setHomePrefs}
          onBack={goBack}
        />
      )}
      {screen === 'scrape-settings' && (
        <ScrapeSettings systems={systems} onBack={goBack} />
      )}
      {screen === 'controller-settings' && (
        <ControllerSettings onBack={goBack} />
      )}
      {screen === 'emulator-settings' && (
        <EmulatorSettings onBack={goBack} />
      )}
    </>
  )
}
