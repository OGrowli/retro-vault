import { useState, useEffect } from 'react'
import type { Game, User } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'

interface Props {
  game: Game
  user: User
  onBack: () => void
  onLaunched?: () => void
}

type ActionFocus = 'launch' | 'favorite' | 'back'

export function GameDetail({ game, user, onBack, onLaunched }: Props) {
  const [isFavorite, setIsFavorite] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [focused, setFocused] = useState<ActionFocus>('launch')
  const actions: ActionFocus[] = ['launch', 'favorite', 'back']

  useEffect(() => {
    api.users.favorites(user.id).then(favs => {
      setIsFavorite(favs.some(f => f.id === game.id))
    }).catch(() => {})
  }, [game.id, user.id])

  const launch = async () => {
    if (launching) return
    setLaunching(true)
    try {
      await api.games.launch(game.id)
      const startedAt = new Date().toISOString()
      setTimeout(() => {
        api.games.logSession(game.id, user.id, 0, startedAt).catch(() => {})
      }, 5000)
      onLaunched?.()
    } catch {
      setLaunching(false)
    }
  }

  const toggleFavorite = async () => {
    try {
      if (isFavorite) {
        await api.users.removeFavorite(user.id, game.id)
        setIsFavorite(false)
      } else {
        await api.users.addFavorite(user.id, game.id)
        setIsFavorite(true)
      }
    } catch {}
  }

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    if (action === 'left') setFocused(f => {
      const i = actions.indexOf(f)
      return actions[Math.max(0, i - 1)]
    })
    if (action === 'right') setFocused(f => {
      const i = actions.indexOf(f)
      return actions[Math.min(actions.length - 1, i + 1)]
    })
    if (action === 'confirm') {
      if (focused === 'launch') void launch()
      if (focused === 'favorite') void toggleFavorite()
      if (focused === 'back') onBack()
    }
    if (action === 'favorite') void toggleFavorite()
  })

  const lastPlayed = game.scraped_at
    ? new Date(game.scraped_at).toLocaleDateString()
    : null

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      {game.box_art_path && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${game.box_art_path})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(60px)',
            opacity: 0.08,
          }}
        />
      )}

      <div className="relative flex-1 flex items-center px-[5%] gap-16 pt-[5%]">
        <div className="flex-shrink-0">
          {game.box_art_path ? (
            <img
              src={game.box_art_path}
              alt={game.name}
              className="w-72 h-96 object-cover rounded-2xl shadow-2xl"
            />
          ) : (
            <div className="w-72 h-96 bg-vault-card rounded-2xl flex items-center justify-center">
              <span className="text-vault-muted text-sm uppercase tracking-widest">{game.system}</span>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <p className="text-vault-accent text-sm font-semibold uppercase tracking-widest mb-1">{game.system}</p>
            <h1 className="text-white text-5xl font-bold leading-tight">{game.name}</h1>
          </div>

          <div className="grid grid-cols-3 gap-4 py-4 border-y border-vault-surface">
            {game.genre && (
              <div>
                <p className="text-vault-muted text-xs uppercase tracking-wide">Genre</p>
                <p className="text-white text-base font-medium mt-0.5">{game.genre}</p>
              </div>
            )}
            {game.year && (
              <div>
                <p className="text-vault-muted text-xs uppercase tracking-wide">Year</p>
                <p className="text-white text-base font-medium mt-0.5">{game.year}</p>
              </div>
            )}
            {game.players && (
              <div>
                <p className="text-vault-muted text-xs uppercase tracking-wide">Players</p>
                <p className="text-white text-base font-medium mt-0.5">{game.players}</p>
              </div>
            )}
            <div>
              <p className="text-vault-muted text-xs uppercase tracking-wide">Play Count</p>
              <p className="text-white text-base font-medium mt-0.5">{game.play_count}</p>
            </div>
            {lastPlayed && (
              <div>
                <p className="text-vault-muted text-xs uppercase tracking-wide">Last Played</p>
                <p className="text-white text-base font-medium mt-0.5">{lastPlayed}</p>
              </div>
            )}
          </div>

          {game.description && (
            <p className="text-vault-muted text-base leading-relaxed line-clamp-4 max-w-xl">
              {game.description}
            </p>
          )}
        </div>
      </div>

      <div className="relative px-[5%] pb-[5%] pt-6 border-t border-vault-surface">
        <div className="flex items-center gap-6">
          <ActionButton
            focused={focused === 'launch'}
            disabled={launching}
            onClick={() => void launch()}
            primary
          >
            {launching ? 'Launching...' : <><Glyph type="cross" /> Launch</>}
          </ActionButton>

          <ActionButton
            focused={focused === 'favorite'}
            onClick={() => void toggleFavorite()}
          >
            <Glyph type="square" /> {isFavorite ? 'Unfavorite' : 'Favorite'}
          </ActionButton>

          <ActionButton
            focused={focused === 'back'}
            onClick={onBack}
          >
            <Glyph type="circle" /> Back
          </ActionButton>
        </div>

        <p className="text-vault-muted text-xs mt-4 uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> Launch  ·  <Glyph type="square" /> Favorite  ·  <Glyph type="circle" /> Back  ·  D-Pad Navigate
        </p>
      </div>
    </div>
  )
}

function ActionButton({
  children,
  focused,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode
  focused: boolean
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'px-8 py-4 rounded-xl font-bold text-base uppercase tracking-wide transition-all duration-150',
        'inline-flex items-center justify-center gap-2',
        'motion-reduce:transition-none',
        focused ? 'ring-2 ring-white scale-105 motion-reduce:scale-100' : '',
        primary
          ? 'bg-vault-accent text-white'
          : 'bg-vault-surface text-white border border-vault-muted',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
