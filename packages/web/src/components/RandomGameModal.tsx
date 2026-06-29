import { useState, useEffect } from 'react'
import type { Game } from '@retro-vault/shared'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from './Glyph'

interface Props {
  game: Game | null
  loading: boolean
  onClose: () => void
  onView: (game: Game) => void
  onAnother: () => void
}

type ActionFocus = 'view' | 'another'

export function RandomGameModal({ game, loading, onClose, onView, onAnother }: Props) {
  const [focused, setFocused] = useState<ActionFocus>('view')
  const actions: ActionFocus[] = ['view', 'another']

  useEffect(() => {
    if (game) setFocused('view')
  }, [game])

  useGamepad((action) => {
    if (action === 'back') { onClose(); return }
    if (action === 'left' || action === 'right') {
      setFocused(f => actions[(actions.indexOf(f) + 1) % actions.length])
    }
    if (action === 'confirm') {
      if (focused === 'view' && game) onView(game)
      if (focused === 'another') onAnother()
    }
  }, !!game)

  if (!game) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
        <div
          className="bg-vault-card rounded-2xl overflow-hidden w-full max-w-md"
          style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
        >
          <div className="flex gap-5 p-6">
            <div className="flex-shrink-0">
              {game.box_art_path ? (
                <img
                  src={game.box_art_path}
                  alt={game.name}
                  className="w-28 h-36 object-cover rounded-lg"
                />
              ) : (
                <div className="w-28 h-36 bg-vault-surface rounded-lg flex items-center justify-center">
                  <span className="text-vault-muted text-[10px] uppercase tracking-widest text-center px-1">
                    {game.system}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-vault-accent text-xs font-semibold uppercase tracking-widest mb-1">
                {game.system}
              </p>
              <h2 className="text-white text-xl font-bold leading-tight truncate">{game.name}</h2>

              <p className="text-vault-muted text-xs mt-2 uppercase tracking-wide">
                {[game.genre, game.year, game.players ? `${game.players}P` : null]
                  .filter(Boolean)
                  .join('  ·  ')}
              </p>

              {game.description && (
                <p className="text-vault-muted text-sm mt-3 leading-snug line-clamp-3">
                  {game.description}
                </p>
              )}
            </div>
          </div>

          <div className="p-6 pt-0 space-y-3">
            <button
              onClick={() => onView(game)}
              disabled={loading}
              className={[
                'w-full py-3 rounded-lg font-bold text-white uppercase tracking-wide text-sm',
                'inline-flex items-center justify-center gap-2',
                'bg-vault-accent hover:bg-vault-accent-bright transition-colors',
                focused === 'view' ? 'ring-2 ring-white' : '',
                loading ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              <Glyph type="cross" /> Go to Game Page
            </button>
            <button
              onClick={onAnother}
              disabled={loading}
              className={[
                'w-full py-3 rounded-lg font-bold text-white uppercase tracking-wide text-sm',
                'inline-flex items-center justify-center gap-2',
                'bg-vault-surface border border-vault-muted hover:border-vault-accent transition-colors',
                focused === 'another' ? 'ring-2 ring-white' : '',
                loading ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {loading ? 'Picking...' : <><Glyph type="square" /> Pick Another</>}
            </button>
            <p className="text-vault-muted text-xs flex items-center justify-center gap-1.5 flex-wrap">
              <Glyph type="cross" /> Select  ·  <Glyph type="circle" /> Close  ·  D-Pad Switch
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
