import { useState } from 'react'
import type { User, Game } from '@retro-vault/shared'
import { ProfileSelect } from './screens/ProfileSelect'
import { Home } from './screens/Home'
import { GameDetail } from './screens/GameDetail'

type Screen = 'profile-select' | 'home' | 'game-detail'

export function App() {
  const [screen, setScreen] = useState<Screen>('profile-select')
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)

  const handleProfileSelect = (user: User) => {
    setCurrentUser(user)
    setScreen('home')
  }

  const handleGameSelect = (game: Game) => {
    setSelectedGame(game)
    setScreen('game-detail')
  }

  const handleBack = () => {
    setSelectedGame(null)
    setScreen('home')
  }

  return (
    <>
      {screen === 'profile-select' && (
        <ProfileSelect onSelect={handleProfileSelect} />
      )}
      {screen === 'home' && currentUser && (
        <Home
          user={currentUser}
          onGameSelect={handleGameSelect}
          onSwitchUser={() => setScreen('profile-select')}
        />
      )}
      {screen === 'game-detail' && currentUser && selectedGame && (
        <GameDetail
          game={selectedGame}
          user={currentUser}
          onBack={handleBack}
          onLaunched={handleBack}
        />
      )}
    </>
  )
}
