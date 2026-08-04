import type { HomePrefs, ListOrder, GameSort } from '@retro-vault/shared'
import { DEFAULT_LIST_ORDER, DEFAULT_GAME_SORT } from '@retro-vault/shared'

// Per-user home/display prefs, persisted in localStorage so they survive a full
// kiosk relaunch. Shared by App, Home, the settings screen, and the add-to-list
// modals (which read the list order directly rather than prop-drilling it).

export const DEFAULT_HOME_PREFS: HomePrefs = { hiddenKeys: [] }

const homePrefsKey = (userId: number) => `retrovault:home-prefs:${userId}`

export function loadHomePrefs(userId: number): HomePrefs {
  try {
    const raw = localStorage.getItem(homePrefsKey(userId))
    return raw ? { ...DEFAULT_HOME_PREFS, ...(JSON.parse(raw) as HomePrefs) } : DEFAULT_HOME_PREFS
  } catch {
    return DEFAULT_HOME_PREFS
  }
}

export function saveHomePrefs(userId: number, prefs: HomePrefs) {
  try {
    localStorage.setItem(homePrefsKey(userId), JSON.stringify(prefs))
  } catch { /* storage full / disabled — prefs just won't persist */ }
}

export const listOrderOf = (prefs: HomePrefs): ListOrder => prefs.listOrder ?? DEFAULT_LIST_ORDER
export const gameSortOf = (prefs: HomePrefs): GameSort => prefs.gameSort ?? DEFAULT_GAME_SORT
