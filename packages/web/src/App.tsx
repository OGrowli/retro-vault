import { useState, useEffect, useCallback } from 'react'
import type { User, Game } from '@retro-vault/shared'
import { api } from './api/client'
import { ProfileSelect } from './screens/ProfileSelect'
import { Home } from './screens/Home'
import { GameDetail } from './screens/GameDetail'
import { Settings } from './screens/Settings'

type Screen = 'profile-select' | 'home' | 'game-detail' | 'settings'

// Navigation hierarchy: back always goes to the screen's parent.
const SCREEN_PARENT: Record<Screen, Screen | null> = {
  'profile-select': null,
  'home': 'profile-select',
  'game-detail': 'home',
  'settings': 'home',
}

export function App() {
  const [screen, setScreen] = useState<Screen>('profile-select')
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)
  const [systems, setSystems] = useState<string[]>([])
  const [genres, setGenres] = useState<string[]>([])

  const refreshMeta = useCallback(() => {
    Promise.all([api.meta.systems(), api.meta.genres()]).then(([s, g]) => {
      setSystems(s)
      setGenres(g)
    }).catch(() => {})
  }, [])

  useEffect(() => { refreshMeta() }, [refreshMeta])

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
    setSelectedGame(game)
    setScreen('game-detail')
  }

  const goBack = useCallback(() => {
    setScreen(s => {
      const parent = SCREEN_PARENT[s]
      if (!parent) return s
      if (s === 'game-detail') setSelectedGame(null)
      return parent
    })
  }, [])

  return (
    <>
      {screen === 'profile-select' && (
        <ProfileSelect onSelect={handleProfileSelect} />
      )}
      {(screen === 'home' || screen === 'game-detail') && currentUser && (
        <Home
          user={currentUser}
          systems={systems}
          genres={genres}
          onGameSelect={handleGameSelect}
          onSwitchUser={goBack}
          onSettings={() => setScreen('settings')}
          onLibraryChange={refreshMeta}
          inputActive={screen === 'home'}
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
          systems={systems}
          onBack={goBack}
        />
      )}
    </>
  )
}
