import { useEffect, useRef, useMemo } from 'react'
import type { Game } from '@retro-vault/shared'
import { rowClass, Caret, Tag, ScrollingTitle } from './ui'

// Flat, image-free virtualized list for "All Games" — the perf win over the old
// cover-art grid. Only a window of text rows is mounted; the parent's sparse
// paging store (Home.tsx) fills game data on demand via onNeedRange.
const ROW_H = 52          // px per row (matches py-3 + text-lg line box)
const VISIBLE_ROWS = 16
const BUFFER_ROWS = 4

interface Props {
  total: number
  getGame: (index: number) => Game | undefined
  onNeedRange?: (startIndex: number, endIndexExclusive: number) => void
  loading?: boolean
  focusedIndex: number
  isActive: boolean
  onSelect?: (game: Game) => void
}

export function GameList({ total, getGame, onNeedRange, loading, focusedIndex, isActive, onSelect }: Props) {
  const windowStartRef = useRef(0)
  const focusedRowRef = useRef<HTMLDivElement>(null)

  const windowStart = useMemo(() => {
    const ws = windowStartRef.current
    if (focusedIndex < ws + BUFFER_ROWS) {
      windowStartRef.current = Math.max(0, focusedIndex - BUFFER_ROWS)
    } else if (focusedIndex >= ws + VISIBLE_ROWS - BUFFER_ROWS) {
      windowStartRef.current = Math.min(
        Math.max(0, total - VISIBLE_ROWS),
        focusedIndex - VISIBLE_ROWS + BUFFER_ROWS + 1,
      )
    }
    return windowStartRef.current
  }, [focusedIndex, total])

  const windowEnd = Math.min(total, windowStart + VISIBLE_ROWS + BUFFER_ROWS * 2)

  // Ask the parent to page in whatever backs the visible window.
  useEffect(() => {
    if (total === 0) return
    onNeedRange?.(windowStart, windowEnd)
  }, [windowStart, windowEnd, total, onNeedRange])

  useEffect(() => {
    if (isActive) focusedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, isActive])

  if (loading) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-[52px] border-l-[6px] border-transparent px-6 flex items-center">
            <div className="h-4 w-1/3 bg-vault-panel animate-pulse rounded-[2px]" />
          </div>
        ))}
      </div>
    )
  }

  if (total === 0) {
    return <p className="text-vault-muted text-sm py-8 font-mono">No games match the current filters.</p>
  }

  const paddingTop = windowStart * ROW_H
  const paddingBottom = Math.max(0, (total - windowEnd) * ROW_H)

  const rows = []
  for (let i = windowStart; i < windowEnd; i++) {
    const focused = isActive && focusedIndex === i
    const game = getGame(i)
    rows.push(
      <div key={i} ref={focused ? focusedRowRef : null} style={{ height: ROW_H }}>
        {game ? (
          <div onClick={() => onSelect?.(game)} className={`${rowClass(focused)} h-full`}>
            <Caret selected={focused} />
            <ScrollingTitle text={game.name} focused={focused} className="text-lg" wrap="min-w-0" />
            <Tag dark={focused}>{game.system}</Tag>
            <span className="flex-1" />
          </div>
        ) : (
          <div className="h-full border-l-[6px] border-transparent px-6 flex items-center">
            <div className="h-4 w-1/4 bg-vault-panel animate-pulse rounded-[2px]" />
          </div>
        )}
      </div>,
    )
  }

  return (
    <div style={{ paddingTop, paddingBottom }}>
      {rows}
    </div>
  )
}
