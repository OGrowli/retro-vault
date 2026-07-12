import { useState, useEffect, useCallback } from 'react'
import type { Game, GameWithRoms, Rom, User } from '@retro-vault/shared'
import { api, bgVariant } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'

interface Props {
  game: Game
  user: User
  onBack: () => void
}

type ActionFocus = 'favorite' | 'scrape' | 'back'
const ACTIONS: ActionFocus[] = ['favorite', 'scrape', 'back']

const REGION_FLAGS: Record<string, string> = {
  USA: '🇺🇸',
  Europe: '🇪🇺',
  Japan: '🇯🇵',
  World: '🌍',
  Australia: '🇦🇺',
  Spain: '🇪🇸',
  France: '🇫🇷',
  Germany: '🇩🇪',
}

function regionFlag(region: string | null): string {
  if (!region) return '🌐'
  return REGION_FLAGS[region] ?? '🌐'
}

function RomRow({
  rom,
  focused,
  launching,
  onLaunch,
}: {
  rom: Rom
  focused: boolean
  launching: boolean
  onLaunch: (rom: Rom) => void
}) {
  const lastPlayed = rom.last_played
    ? new Date(rom.last_played).toLocaleDateString()
    : null

  return (
    <div
      data-focusable="true"
      onClick={() => onLaunch(rom)}
      className={[
        'flex items-center gap-4 px-4 py-3 rounded-xl transition-colors duration-150 cursor-pointer',
        'motion-reduce:transition-none',
        focused
          ? 'bg-vault-surface ring-4 ring-vault-accent-bright'
          : 'bg-vault-card hover:bg-vault-surface',
      ].join(' ')}
    >
      <span className="text-2xl flex-shrink-0">{regionFlag(rom.region)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold truncate">{rom.full_name}</p>
        <p className="text-vault-muted text-xs mt-0.5 uppercase tracking-wide">
          {[rom.region, rom.revision].filter(Boolean).join(' · ') || 'No region info'}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-vault-muted text-xs">{rom.play_count ?? 0}× played</p>
        {lastPlayed && <p className="text-vault-muted text-xs mt-0.5">{lastPlayed}</p>}
      </div>
      {focused && (
        <div className="flex-shrink-0">
          {launching ? (
            <span className="text-vault-muted text-xs uppercase tracking-wide">Launching…</span>
          ) : (
            <span className="text-vault-accent text-xs font-bold uppercase tracking-wide flex items-center gap-1">
              <Glyph type="cross" /> Launch
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function GameDetail({ game: initialGame, user, onBack }: Props) {
  const [detail, setDetail] = useState<GameWithRoms | null>(null)
  const [game, setGame] = useState<Game>(initialGame)
  const [isFavorite, setIsFavorite] = useState(false)
  const [focusSection, setFocusSection] = useState<'description' | 'versions' | 'actions'>('versions')
  const [descExpanded, setDescExpanded] = useState(false)
  const [versionIdx, setVersionIdx] = useState(0)
  const [actionIdx, setActionIdx] = useState(0)
  const [launching, setLaunching] = useState<number | null>(null)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [continueRom, setContinueRom] = useState<Rom | null>(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeError, setScrapeError] = useState<string | null>(null)

  useEffect(() => {
    api.games.get(game.id).then(d => {
      setDetail(d)
      if (d.roms.length === 1) setVersionIdx(0)
    }).catch(() => {})

    api.users.favorites(user.id).then(favs => {
      setIsFavorite(favs.some(f => f.id === game.id))
    }).catch(() => {})
  }, [game.id, user.id])

  const roms = detail?.roms ?? []
  const singleRom = roms.length === 1

  const launch = useCallback(async (rom: Rom, fresh = false) => {
    if (launching !== null) return
    if (!fresh) {
      try {
        const { exists } = await api.roms.saveState(rom.id)
        if (exists) { setContinueRom(rom); return }
      } catch { /* if check fails, proceed */ }
    }
    setContinueRom(null)
    setLaunching(rom.id)
    setLaunchError(null)
    try {
      await api.roms.launch(rom.id, user.id, fresh)
      // RetroArch takes over the display; clear the spinner in case it exits
      setTimeout(() => setLaunching(null), 10_000)
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : 'Launch failed')
      setLaunching(null)
    }
  }, [launching, user.id])

  const toggleFavorite = useCallback(async () => {
    try {
      const result = await api.games.favorite(game.id, user.id)
      setIsFavorite(result.favorited)
    } catch {}
  }, [game.id, user.id])

  // Credentials come from Settings (stored server-side) — scrape directly
  const scrape = useCallback(async () => {
    if (scraping) return
    setScraping(true)
    setScrapeError(null)
    try {
      const updated = await api.games.scrape(game.id)
      setGame(updated)
      const d = await api.games.get(updated.id)
      setDetail(d)
    } catch (e) {
      setScrapeError(e instanceof Error ? e.message : 'Scrape failed')
    } finally {
      setScraping(false)
    }
  }, [game.id, scraping])

  useGamepad((action) => {
    if (continueRom) {
      if (action === 'confirm') void launch(continueRom, false)
      if (action === 'back') void launch(continueRom, true)
      return
    }
    if (action === 'back') { onBack(); return }
    if (action === 'favorite') { void toggleFavorite(); return }

    if (focusSection === 'description') {
      if (action === 'up') setFocusSection('actions')
      if (action === 'down') setFocusSection(roms.length > 0 ? 'versions' : 'actions')
      if (action === 'confirm') setDescExpanded(v => !v)
    }

    if (focusSection === 'versions') {
      if (action === 'up') {
        if (versionIdx === 0) setFocusSection(game.description ? 'description' : 'actions')
        else setVersionIdx(i => i - 1)
      }
      if (action === 'down') {
        if (versionIdx < roms.length - 1) setVersionIdx(i => i + 1)
        else setFocusSection('actions')
      }
      if (action === 'confirm' && roms[versionIdx]) {
        void launch(roms[versionIdx])
      }
    }

    if (focusSection === 'actions') {
      if (action === 'left') setActionIdx(i => Math.max(0, i - 1))
      if (action === 'right') setActionIdx(i => Math.min(ACTIONS.length - 1, i + 1))
      if (action === 'up') setFocusSection('versions')
      if (action === 'confirm') {
        const act = ACTIONS[actionIdx]
        if (act === 'favorite') void toggleFavorite()
        if (act === 'scrape') void scrape()
        if (act === 'back') onBack()
      }
    }
  }, true)

  const lastPlayedDate = detail?.last_played
    ? new Date(detail.last_played).toLocaleDateString()
    : null

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col overflow-hidden">
      {game.box_art_path && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${bgVariant(game.box_art_path)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.15,
          }}
        />
      )}

      <div className="relative flex-1 flex gap-12 px-[5%] pt-[5%] overflow-hidden">
        {/* Box art */}
        <div className="flex-shrink-0">
          {game.box_art_path ? (
            <img
              src={game.box_art_path}
              alt={game.name}
              className="w-60 h-80 object-cover rounded-2xl shadow-2xl"
            />
          ) : (
            <div className="w-60 h-80 bg-vault-card rounded-2xl flex flex-col items-center justify-center gap-3">
              <svg width="72" height="72" viewBox="0 0 48 48" fill="none" className="opacity-20">
                <rect x="4" y="14" width="40" height="24" rx="12" stroke="white" strokeWidth="2"/>
                <rect x="12" y="23" width="8" height="2.5" rx="1.25" fill="white"/>
                <rect x="14.75" y="20.25" width="2.5" height="8" rx="1.25" fill="white"/>
                <circle cx="31" cy="22" r="2" fill="white"/>
                <circle cx="35" cy="26" r="2" fill="white"/>
                <line x1="17" y1="14" x2="17" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                <line x1="31" y1="14" x2="31" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span className="text-vault-muted text-xs uppercase tracking-widest">{game.system}</span>
            </div>
          )}
          {game.scraped_at && (
            <div className="mt-3 flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-vault-accent inline-block" />
              <span className="text-vault-accent text-xs uppercase tracking-wide">Scraped</span>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden">
          {/* Metadata */}
          <div>
            <p className="text-vault-accent text-sm font-semibold uppercase tracking-widest mb-1">{game.system}</p>
            <h1 className="text-white text-4xl font-bold leading-tight">{game.name}</h1>
          </div>

          <div className="grid grid-cols-4 gap-3 py-3 border-y border-vault-surface">
            {game.genre && (
              <div>
                <p className="text-vault-muted text-xs uppercase tracking-wide">Genre</p>
                <p className="text-white text-sm font-medium mt-0.5">{game.genre}</p>
              </div>
            )}
            {game.year && (
              <div>
                <p className="text-vault-muted text-xs uppercase tracking-wide">Year</p>
                <p className="text-white text-sm font-medium mt-0.5">{game.year}</p>
              </div>
            )}
            {game.players && (
              <div>
                <p className="text-vault-muted text-xs uppercase tracking-wide">Players</p>
                <p className="text-white text-sm font-medium mt-0.5">{game.players}</p>
              </div>
            )}
            <div>
              <p className="text-vault-muted text-xs uppercase tracking-wide">Played</p>
              <p className="text-white text-sm font-medium mt-0.5">{detail?.total_play_count ?? 0}×</p>
            </div>
            {lastPlayedDate && (
              <div>
                <p className="text-vault-muted text-xs uppercase tracking-wide">Last Played</p>
                <p className="text-white text-sm font-medium mt-0.5">{lastPlayedDate}</p>
              </div>
            )}
          </div>

          {game.description && (
            <div
              onClick={() => setDescExpanded(v => !v)}
              className={[
                'rounded-lg cursor-pointer transition-colors duration-150 motion-reduce:transition-none -mx-2 px-2 py-1',
                focusSection === 'description' ? 'ring-2 ring-vault-accent bg-vault-card' : '',
              ].join(' ')}
            >
              <p
                className={[
                  'text-vault-muted text-sm leading-relaxed',
                  descExpanded ? 'overflow-y-auto' : 'line-clamp-3',
                ].join(' ')}
                style={descExpanded ? { maxHeight: '30vh', scrollbarWidth: 'none' } : undefined}
              >
                {game.description}
              </p>
              {focusSection === 'description' && (
                <span className="text-vault-accent text-xs font-bold uppercase tracking-wide flex items-center gap-1 mt-1">
                  <Glyph type="cross" /> {descExpanded ? 'Collapse' : 'Expand'}
                </span>
              )}
            </div>
          )}

          {launchError && (
            <p className="text-red-400 text-sm px-1">{launchError}</p>
          )}
          {scrapeError && (
            <p className="text-red-400 text-sm px-1">{scrapeError}</p>
          )}

          {/* Versions section */}
          <div className="flex-1 overflow-hidden">
            {detail === null ? (
              <div className="space-y-2">
                {[0, 1].map(i => (
                  <div key={i} className="h-14 bg-vault-card rounded-xl animate-pulse" />
                ))}
              </div>
            ) : roms.length === 0 ? (
              <p className="text-vault-muted text-sm">No ROMs found for this game.</p>
            ) : (
              <div>
                {!singleRom && (
                  <p className="text-vault-muted text-xs uppercase tracking-widest mb-2">
                    Versions — {roms.length} ROM{roms.length !== 1 ? 's' : ''}
                  </p>
                )}
                <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '280px', scrollbarWidth: 'none' }}>
                  {roms.map((rom, i) => (
                    <RomRow
                      key={rom.id}
                      rom={rom}
                      focused={focusSection === 'versions' && versionIdx === i}
                      launching={launching === rom.id}
                      onLaunch={(r) => void launch(r)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="relative px-[5%] pb-[5%] pt-5 border-t border-vault-surface">
        <div className="flex items-center gap-4 mb-3">
          {ACTIONS.map((act, i) => {
            const focused = focusSection === 'actions' && actionIdx === i
            const label = act === 'favorite'
              ? (isFavorite ? 'Unfavorite' : 'Favorite')
              : act === 'scrape' ? (scraping ? 'Scraping…' : 'Scrape Metadata')
              : 'Back'
            const glyph = act === 'favorite' ? 'square' : act === 'scrape' ? 'triangle' : 'circle'
            return (
              <button
                key={act}
                disabled={act === 'scrape' && scraping}
                onClick={() => {
                  if (act === 'favorite') void toggleFavorite()
                  if (act === 'scrape') void scrape()
                  if (act === 'back') onBack()
                }}
                className={[
                  'px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wide transition-colors duration-150',
                  'inline-flex items-center gap-2 motion-reduce:transition-none',
                  act === 'back'
                    ? 'bg-vault-surface text-white border border-vault-muted'
                    : act === 'scrape'
                    ? 'bg-vault-surface text-white border border-vault-muted'
                    : isFavorite
                    ? 'bg-vault-accent text-white'
                    : 'bg-vault-surface text-white border border-vault-muted',
                  focused ? 'ring-2 ring-white' : '',
                ].join(' ')}
              >
                <Glyph type={glyph as 'square' | 'triangle' | 'circle'} /> {label}
              </button>
            )
          })}
        </div>
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> Launch  ·  <Glyph type="square" /> Favorite  ·  <Glyph type="triangle" /> Scrape  ·  <Glyph type="circle" /> Back  ·  D-Pad Navigate
        </p>
      </div>

      {continueRom && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-vault-card rounded-2xl p-8 w-full max-w-sm space-y-5">
            <div>
              <h2 className="text-white text-xl font-bold">Continue?</h2>
              <p className="text-vault-muted text-sm mt-1">A save state was found for this game.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => void launch(continueRom, false)}
                className="flex-1 px-4 py-3 bg-vault-accent text-white rounded-xl font-bold text-sm uppercase tracking-wide flex items-center justify-center gap-2"
              >
                <Glyph type="cross" /> Continue
              </button>
              <button
                onClick={() => void launch(continueRom, true)}
                className="flex-1 px-4 py-3 bg-vault-surface text-white rounded-xl font-bold text-sm uppercase tracking-wide border border-vault-muted flex items-center justify-center gap-2"
              >
                <Glyph type="circle" /> New Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
