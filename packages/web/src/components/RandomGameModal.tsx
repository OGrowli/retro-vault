import { useState, useEffect } from 'react'
import type { Game } from '@retro-vault/shared'
import { useGamepad } from '../hooks/useGamepad'
import { Title } from './ui'

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

  if (!game) {
    if (!loading) return null
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
        <div className="bg-vault-panel border border-vault-surface px-10 py-8 flex flex-col items-center gap-4" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
          <div className="w-8 h-8 border-2 border-vault-muted border-t-vault-accent rounded-full animate-spin" />
          <p className="text-vault-muted text-sm font-mono uppercase tracking-[0.1em]">picking a game…</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
        <div
          className="bg-vault-panel border border-vault-surface overflow-hidden w-full max-w-md"
          style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
        >
          <div className="flex gap-5 p-6">
            <div className="flex-shrink-0">
              {game.box_art_path ? (
                <img
                  src={game.box_art_path}
                  alt={game.name}
                  className="w-28 h-36 object-cover border-[3px] border-vault-surface"
                />
              ) : (
                <div className="w-28 h-36 bg-vault-surface flex items-center justify-center">
                  <span className="text-vault-muted text-xs font-mono uppercase tracking-[0.12em] text-center px-1">
                    {game.system}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-vault-accent text-xs font-mono uppercase tracking-[0.14em] mb-1">
                {game.system}
              </p>
              <Title className="text-3xl truncate">{game.name}</Title>

              <p className="text-vault-muted text-xs mt-2 font-mono uppercase tracking-[0.08em]">
                {[game.genre, game.year, game.players ? `${game.players}P` : null]
                  .filter(Boolean)
                  .join('  ·  ')}
              </p>

              {game.description && (
                <p className="text-[#eaf0f8]/70 font-read text-sm mt-3 leading-snug line-clamp-3">
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
                'w-full py-3 rounded-[2px] font-mono uppercase tracking-[0.08em] text-sm',
                'bg-vault-accent-bright text-vault-ink transition-colors',
                focused === 'view' ? 'ring-2 ring-white' : '',
                loading ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              a go to game page
            </button>
            <button
              onClick={onAnother}
              disabled={loading}
              className={[
                'w-full py-3 rounded-[2px] font-mono uppercase tracking-[0.08em] text-sm text-[#eaf0f8]',
                'bg-vault-surface border border-vault-muted hover:border-vault-accent transition-colors',
                focused === 'another' ? 'ring-2 ring-white' : '',
                loading ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {loading ? 'picking…' : 'y pick another'}
            </button>
            <p className="text-vault-muted text-xs font-mono uppercase tracking-[0.08em] text-center">
              a select · b close · ← → switch
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
