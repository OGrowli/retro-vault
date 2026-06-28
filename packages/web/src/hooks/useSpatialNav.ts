import { useState, useCallback, useRef } from 'react'
import type { GamepadAction } from './useGamepad'

export type Region = 'profile-select' | 'recently-played' | 'favorites' | 'all-games' | 'filter-drawer' | 'game-detail'

interface RegionState {
  row: number
  col: number
}

interface UseSpatialNavOptions {
  recentCount: number
  favoritesCount: number
  allGamesCount: number
  gridCols: number
  filterDrawerItems: number
  onConfirm?: (region: Region, row: number, col: number) => void
  onBack?: () => void
  filterDrawerOpen: boolean
  onToggleFilter?: () => void
  onFavorite?: (region: Region, row: number, col: number) => void
}

export function useSpatialNav(opts: UseSpatialNavOptions) {
  const [region, setRegion] = useState<Region>('recently-played')
  const [indices, setIndices] = useState<Record<Region, RegionState>>({
    'profile-select': { row: 0, col: 0 },
    'recently-played': { row: 0, col: 0 },
    'favorites': { row: 0, col: 0 },
    'all-games': { row: 0, col: 0 },
    'filter-drawer': { row: 0, col: 0 },
    'game-detail': { row: 0, col: 0 },
  })

  const optsRef = useRef(opts)
  optsRef.current = opts

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  const getIndex = useCallback((r: Region) => indices[r], [indices])

  const updateIndex = useCallback((r: Region, update: Partial<RegionState>) => {
    setIndices(prev => ({
      ...prev,
      [r]: { ...prev[r], ...update },
    }))
  }, [])

  const handleAction = useCallback((action: GamepadAction) => {
    const o = optsRef.current

    if (action === 'filter') {
      o.onToggleFilter?.()
      return
    }

    if (o.filterDrawerOpen) {
      const cur = indices['filter-drawer']
      if (action === 'up') updateIndex('filter-drawer', { row: clamp(cur.row - 1, 0, o.filterDrawerItems - 1) })
      if (action === 'down') updateIndex('filter-drawer', { row: clamp(cur.row + 1, 0, o.filterDrawerItems - 1) })
      if (action === 'back') o.onToggleFilter?.()
      if (action === 'confirm') o.onConfirm?.('filter-drawer', cur.row, cur.col)
      return
    }

    if (action === 'back') {
      o.onBack?.()
      return
    }

    if (action === 'favorite') {
      const cur = indices[region]
      o.onFavorite?.(region, cur.row, cur.col)
      return
    }

    if (action === 'confirm') {
      const cur = indices[region]
      o.onConfirm?.(region, cur.row, cur.col)
      return
    }

    if (region === 'recently-played') {
      const cur = indices['recently-played']
      if (action === 'left') updateIndex('recently-played', { col: clamp(cur.col - 1, 0, o.recentCount - 1) })
      if (action === 'right') updateIndex('recently-played', { col: clamp(cur.col + 1, 0, o.recentCount - 1) })
      if (action === 'down') {
        if (o.favoritesCount > 0) setRegion('favorites')
        else setRegion('all-games')
      }
    }

    if (region === 'favorites') {
      const cur = indices['favorites']
      if (action === 'left') updateIndex('favorites', { col: clamp(cur.col - 1, 0, o.favoritesCount - 1) })
      if (action === 'right') updateIndex('favorites', { col: clamp(cur.col + 1, 0, o.favoritesCount - 1) })
      if (action === 'up') setRegion('recently-played')
      if (action === 'down') setRegion('all-games')
    }

    if (region === 'all-games') {
      const cur = indices['all-games']
      const totalRows = Math.ceil(o.allGamesCount / o.gridCols)
      if (action === 'left') updateIndex('all-games', { col: clamp(cur.col - 1, 0, o.gridCols - 1) })
      if (action === 'right') updateIndex('all-games', { col: clamp(cur.col + 1, 0, o.gridCols - 1) })
      if (action === 'down') updateIndex('all-games', { row: clamp(cur.row + 1, 0, totalRows - 1) })
      if (action === 'up') {
        if (cur.row === 0) {
          if (o.favoritesCount > 0) setRegion('favorites')
          else setRegion('recently-played')
        } else {
          updateIndex('all-games', { row: cur.row - 1 })
        }
      }
    }

    if (region === 'profile-select') {
      const cur = indices['profile-select']
      const cols = 4
      if (action === 'left') updateIndex('profile-select', { col: clamp(cur.col - 1, 0, cols - 1) })
      if (action === 'right') updateIndex('profile-select', { col: clamp(cur.col + 1, 0, cols - 1) })
      if (action === 'up') updateIndex('profile-select', { row: clamp(cur.row - 1, 0, 4) })
      if (action === 'down') updateIndex('profile-select', { row: clamp(cur.row + 1, 0, 4) })
    }
  }, [region, indices, updateIndex])

  return { region, setRegion, getIndex, handleAction }
}
