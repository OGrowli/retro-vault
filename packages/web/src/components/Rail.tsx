import { useEffect, useRef } from 'react'
import type { Game } from '@retro-vault/shared'
import { GameCard } from './GameCard'
import { SkeletonCard } from './SkeletonCard'

// Home rails stay skimmable: show at most this many cards, then a "Show More"
// card that opens the full single-column List View.
const RAIL_CAP = 6

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
  /** When set and the rail has more than 6 titles, a trailing "Show More" card opens List View */
  onShowMore?: () => void
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
  onShowMore,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const visible = games.slice(0, RAIL_CAP)
  const showMore = !loading && !!onShowMore && games.length > RAIL_CAP

  // Depend on `games` (stable) rather than the freshly-sliced `visible` array,
  // which changes identity every render — otherwise this re-fires on unrelated
  // re-renders (e.g. background art updates) and re-pins the focused card to
  // the top, fighting Home's scroll-to-top when returning to the first rail.
  useEffect(() => {
    if (!isActiveRegion) return
    const el = cardRefs.current[focusedIndex]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    const focusedGame = games.slice(0, RAIL_CAP)[focusedIndex]
    if (focusedGame) onFocusGame?.(focusedGame)
  }, [focusedIndex, isActiveRegion, games, onFocusGame])

  return (
    <section className="px-[5%] py-3">
      <h2 className="text-white text-lg font-semibold mb-3 tracking-wide">
        {title}
        {!loading && (
          <span className="text-vault-muted text-sm font-normal"> · {games.length} titles</span>
        )}
      </h2>
      <div
        ref={containerRef}
        className="flex gap-4 overflow-x-auto py-3 -my-3 px-3 -mx-3"
        style={{ scrollbarWidth: 'none' }}
      >
        {loading
          ? Array.from({ length: skeletonCount }, (_, i) => <SkeletonCard key={i} size={size} />)
          : visible.map((game, i) => {
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

        {showMore && (
          <div ref={el => { cardRefs.current[visible.length] = el }}>
            <button
              onClick={onShowMore}
              className={[
                'flex-shrink-0 rounded-xl flex flex-col items-center justify-center gap-2',
                'bg-vault-card text-vault-muted hover:text-white transition-colors cursor-pointer',
                size === 'lg' ? 'w-56 h-72' : 'w-44 h-60',
                isActiveRegion && focusedIndex === visible.length ? 'ring-4 ring-vault-accent-bright' : 'ring-0',
              ].join(' ')}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
              <span className="text-sm font-semibold uppercase tracking-wide">Show More</span>
              <span className="text-xs text-vault-muted">{games.length} titles</span>
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export { RAIL_CAP }
