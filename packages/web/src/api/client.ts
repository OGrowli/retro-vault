import type {
  Game, GameFilter, GameWithRoms, Rom, User,
  HistoryEntry, SessionWithRom,
} from '@retro-vault/shared'

function filterToParams(filter: GameFilter, userId?: number): string {
  const p = new URLSearchParams()
  if (userId !== undefined) p.set('userId', String(userId))
  if (filter.systems?.length) p.set('systems', filter.systems.join(','))
  if (filter.genres?.length) p.set('genres', filter.genres.join(','))
  if (filter.players !== undefined) p.set('players', String(filter.players))
  if (filter.yearRange) p.set('yearRange', filter.yearRange.join(','))
  if (filter.favoritesOnly) p.set('favoritesOnly', 'true')
  if (filter.neverPlayed) p.set('neverPlayed', 'true')
  if (filter.noMetadata) p.set('noMetadata', 'true')
  if (filter.query) p.set('query', filter.query)
  return p.toString()
}

// Tiny pre-blurred background variant emitted at scrape time (and lazily by
// the API). Stretched fullscreen, the upscale IS the blur — no CSS filter.
export function bgVariant(boxArtPath: string): string {
  return boxArtPath.replace(/\.jpg$/, '-bg.jpg')
}

async function extractError(res: Response): Promise<string> {
  try {
    const data = await res.clone().json() as Record<string, unknown>
    if (typeof data.error === 'string') return data.error
  } catch { /* fall through */ }
  return `${res.status} ${res.statusText}`
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

export interface ImportResult {
  games_created: number
  games_updated: number
  roms_created: number
  roms_skipped: number
}

export interface ScrapeProgress {
  total: number
  done: number
  failed: number
  current: string | null
  complete: boolean
}

export const api = {
  games: {
    list: (filter: GameFilter = {}, userId?: number) =>
      get<Game[]>(`/games?${filterToParams(filter, userId)}`),
    random: (filter: GameFilter = {}, userId?: number) =>
      get<Game>(`/games/random?${filterToParams(filter, userId)}`),
    get: (id: number) => get<GameWithRoms>(`/games/${id}`),
    favorite: (id: number, userId: number) =>
      post<{ favorited: boolean }>(`/games/${id}/favorite`, { userId }),
    sessions: (id: number) => get<SessionWithRom[]>(`/games/${id}/sessions`),
    // Credentials come from saved settings on the server
    scrape: (id: number) => post<Game>(`/games/${id}/scrape`),
  },

  roms: {
    get: (id: number) => get<Rom>(`/roms/${id}`),
    saveState: (id: number) => get<{ exists: boolean }>(`/roms/${id}/savestate`),
    // user_id lets the server log the play session — the kiosk browser is
    // torn down during launch, so the frontend can't log it afterwards
    launch: (id: number, userId: number, fresh = false) =>
      post<{ launched: boolean; pid?: number }>(`/roms/${id}/launch`, { user_id: userId, fresh: fresh || undefined }),
    // One-shot: who was playing what, if a game just ended
    resume: () => get<{ resume: { user_id: number; game_id: number } | null }>('/roms/resume'),
  },

  users: {
    list: () => get<User[]>('/users'),
    create: (username: string, avatar_color: string) =>
      post<User>('/users', { username, avatar_color }),
    favorites: (userId: number) => get<Game[]>(`/users/${userId}/favorites`),
    history: (userId: number) => get<HistoryEntry[]>(`/users/${userId}/history`),
  },

  meta: {
    systems: () => get<string[]>('/meta/systems'),
    genres: () => get<string[]>('/meta/genres'),
  },

  settings: {
    get: () => get<Record<string, string>>('/settings'),
    save: (s: Record<string, string>) => post<{ saved: boolean }>('/settings', s),
  },

  import: {
    run: () => post<ImportResult>('/import'),
  },

  scrape: {
    all: (username: string, password: string, signal?: AbortSignal) =>
      fetch('/scrape/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal,
      }),
    system: (system: string, username: string, password: string, signal?: AbortSignal) =>
      fetch(`/scrape/system/${system}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal,
      }),
  },
}

export type { Game, GameWithRoms, Rom, User, GameFilter, HistoryEntry, SessionWithRom }
export { del }
