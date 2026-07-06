import { useEffect, useRef } from 'react'
import type { Game } from '@retro-vault/shared'
import { GameCard } from './GameCard'
import { SkeletonCard } from './SkeletonCard'

interface Props {
  title: string
  games: Game[]
  loading?: boolean
  focusedIndex: number
  isActiveRegion: boolean
  skeletonCount?: number
  onFocusGame?: (game: Game) => void
  onSelectGame?: (game: Game) => void
  getContinueLabel?: (game: Game) => string | undefined
  size?: 'sm' | 'lg'
}

export function Rail({
  title,
  games,
  loading,
  focusedIndex,
  isActiveRegion,
  skeletonCount = 6,
  onFocusGame,
  onSelectGame,
  getContinueLabel,
  size = 'sm',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (!isActiveRegion) return
    const el = cardRefs.current[focusedIndex]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    if (games[focusedIndex]) onFocusGame?.(games[focusedIndex])
  }, [focusedIndex, isActiveRegion, games, onFocusGame])

  return (
    <section className="px-[5%] py-3">
      <h2 className="text-white text-lg font-semibold mb-3 tracking-wide">{title}</h2>
      <div
        ref={containerRef}
        className="flex gap-4 overflow-x-auto py-3 -my-3 px-3 -mx-3"
        style={{ scrollbarWidth: 'none' }}
      >
        {loading
          ? Array.from({ length: skeletonCount }, (_, i) => <SkeletonCard key={i} size={size} />)
          : games.map((game, i) => {
              const focused = isActiveRegion && focusedIndex === i
              const label = getContinueLabel?.(game)
              return (
                <div
                  key={game.id}
                  ref={el => { cardRefs.current[i] = el }}
                >
                  <GameCard
                    game={game}
                    focused={focused}
                    label={label}
                    size={size}
                    onClick={onSelectGame}
                  />
                </div>
              )
            })}
      </div>
    </section>
  )
}
