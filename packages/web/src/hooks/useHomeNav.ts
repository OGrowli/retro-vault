import { useState, useCallback, useRef, useEffect } from 'react'
import type { GamepadAction } from './useGamepad'

// Flat Home is a vertical stack of single-axis regions — no 2-D grid, no rails.
// top-bar and chips walk horizontally; lists and all-games walk vertically.
// Up/down at a region's edge crosses into the next non-empty region.
export type HomeRegion = 'top' | 'chips' | 'lists' | 'all-games'

interface Options {
  topCount: number
  chipCount: number
  listCount: number
  allGamesCount: number
  /** Suspend nav while a dropdown/keyboard/modal owns input. */
  disabled: boolean
  onConfirm: (region: HomeRegion, index: number) => void
  onFavorite: (region: HomeRegion, index: number) => void
  onBack: () => void
  onSettings: () => void
}

const HORIZONTAL: HomeRegion[] = ['top', 'chips']

export function useHomeNav(opts: Options) {
  const [region, setRegion] = useState<HomeRegion>('top')
  const [indices, setIndices] = useState<Record<HomeRegion, number>>({
    top: 0, chips: 0, lists: 0, 'all-games': 0,
  })
  const optsRef = useRef(opts)
  optsRef.current = opts

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  // Regions in vertical order, skipping any that currently hold nothing.
  const order = useCallback((o: Options): HomeRegion[] => {
    const r: HomeRegion[] = ['top']
    if (o.chipCount > 0) r.push('chips')
    if (o.listCount > 0) r.push('lists')
    if (o.allGamesCount > 0) r.push('all-games')
    return r
  }, [])

  const countOf = (o: Options, r: HomeRegion): number =>
    r === 'top' ? o.topCount : r === 'chips' ? o.chipCount : r === 'lists' ? o.listCount : o.allGamesCount

  const setIndex = useCallback((r: HomeRegion, i: number) => {
    setIndices(prev => ({ ...prev, [r]: i }))
  }, [])

  const focus = useCallback((r: HomeRegion, i = 0) => {
    setRegion(r)
    setIndices(prev => ({ ...prev, [r]: i }))
  }, [])

  const resetAllGames = useCallback(() => setIndex('all-games', 0), [setIndex])

  // If the focused region empties out (filter clears the grid, a list is hidden),
  // snap focus back to a region that still has something in it.
  useEffect(() => {
    const ord = order(optsRef.current)
    if (!ord.includes(region)) setRegion(ord[ord.length - 1] ?? 'top')
  }, [opts.chipCount, opts.listCount, opts.allGamesCount, region, order])

  const handleAction = useCallback((action: GamepadAction) => {
    const o = optsRef.current
    if (o.disabled) return

    if (action === 'settings') { o.onSettings(); return }
    if (action === 'back') { o.onBack(); return }

    const ord = order(o)
    const pos = ord.indexOf(region)
    const idx = indices[region]
    const max = Math.max(0, countOf(o, region) - 1)

    if (action === 'favorite') { o.onFavorite(region, idx); return }
    if (action === 'confirm') { o.onConfirm(region, idx); return }

    // X (filter) jumps straight to the chip row from anywhere.
    if (action === 'filter') { if (o.chipCount > 0) focus('chips', 0); return }

    const horizontal = HORIZONTAL.includes(region)

    if (action === 'left' && horizontal) { setIndex(region, clamp(idx - 1, 0, max)); return }
    if (action === 'right' && horizontal) { setIndex(region, clamp(idx + 1, 0, max)); return }

    if (action === 'up') {
      if (!horizontal && idx > 0) { setIndex(region, idx - 1); return }
      if (pos > 0) focus(ord[pos - 1]!, 0)
      return
    }
    if (action === 'down') {
      if (!horizontal && idx < max) { setIndex(region, idx + 1); return }
      if (pos < ord.length - 1) focus(ord[pos + 1]!, 0)
      return
    }
  }, [region, indices, order, focus, setIndex])

  const indexOf = useCallback((r: HomeRegion) => indices[r], [indices])

  return { region, indexOf, handleAction, focus, resetAllGames }
}
