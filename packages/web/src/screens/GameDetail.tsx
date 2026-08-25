import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
import type { Game, GameWithRoms, Rom, User } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { StatusBar } from '../components/StatusBar'
import { AddToListModal } from '../components/AddToListModal'
import { HacksPanel } from '../components/HacksPanel'
import { Breadcrumb, Title, SectionHeader, Rule, HintBar, KindTag, RegionChip, rowClass } from '../components/ui'

interface Props {
  game: Game
  user: User
  onBack: () => void
  /** Set when reached via Pick Random Game — shows a "Random Again" action. */
  fromRandom?: boolean
  onRandomAgain?: () => void
  /** Called after a new list is created from this game — id of the new list. */
  onListCreated?: (listId: number) => void
}

type ActionFocus = 'favorite' | 'add-to-list' | 'scrape' | 'hacks' | 'random-again' | 'back'

// A single ROM/version row. Launch is per-version — the focused row shows the
// "a launch" hint. Region chip + name + kind tag on the left, play meta right.
function RomRow({
  rom,
  focused,
  launching,
  onLaunch,
  rowRef,
}: {
  rom: Rom
  focused: boolean
  launching: boolean
  onLaunch: (rom: Rom) => void
  rowRef?: (el: HTMLDivElement | null) => void
}) {
  const lastPlayed = rom.last_played
    ? new Date(rom.last_played).toLocaleDateString()
    : null
  const plays = rom.play_count ?? 0
  const meta = `${plays}× played${lastPlayed ? ` · ${lastPlayed}` : ''}`

  return (
    <div
      ref={rowRef}
      data-focusable="true"
      onClick={() => onLaunch(rom)}
      className={rowClass(focused)}
    >
      <RegionChip region={rom.region} dark={focused} />
      <span className="min-w-0 truncate text-xl">{rom.full_name}</span>
      <KindTag kind={rom.kind} dark={focused} />
      <span className="flex-1" />
      <span className={`font-mono text-[0.85rem] tracking-[0.06em] ${focused ? 'text-vault-ink/70' : 'text-vault-muted'}`}>
        {launching ? 'launching…' : focused ? `${meta}  ·  a launch` : meta}
      </span>
    </div>
  )
}

export function GameDetail({ game: initialGame, user, onBack, fromRandom = false, onRandomAgain, onListCreated }: Props) {
  // "Random Again" only appears when we arrived here from a random pick.
  const ACTIONS: ActionFocus[] = fromRandom
    ? ['favorite', 'add-to-list', 'scrape', 'hacks', 'random-again', 'back']
    : ['favorite', 'add-to-list', 'scrape', 'hacks', 'back']
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
  const [continueIdx, setContinueIdx] = useState(0) // 0=Continue 1=New Game
  const [scraping, setScraping] = useState(false)
  const [scrapeError, setScrapeError] = useState<string | null>(null)
  const [addToListOpen, setAddToListOpen] = useState(false)
  const [hacksOpen, setHacksOpen] = useState(false)
  // versionRefs[i] — keeps the gamepad-focused ROM row visible as focus moves.
  const versionRefs = useRef<(HTMLDivElement | null)[]>([])
  // Guards the auto-scrape so it fires at most once per game id.
  const autoScrapedRef = useRef<number | null>(null)

  useEffect(() => {
    api.games.get(game.id).then(d => {
      setDetail(d)
      // Land on the first official release rather than index 0 (which, once
      // sorted, is official anyway — but stays correct if a title is hacks-only).
      const firstOfficial = d.roms.findIndex(r => r.kind === 'official')
      setVersionIdx(firstOfficial >= 0 ? firstOfficial : 0)
    }).catch(() => {})

    api.users.favorites(user.id).then(favs => {
      setIsFavorite(favs.some(f => f.id === game.id))
    }).catch(() => {})
  }, [game.id, user.id])

  const roms = detail?.roms ?? []
  const hackCount = detail?.hack_count ?? 0
  const singleRom = roms.length === 1
  // When a title has both official and non-official ROMs, split the list under
  // two subheaders. roms arrive official-first from the API, so the boundary is
  // just where kind flips.
  const mixed = roms.some(r => r.kind === 'official') && roms.some(r => r.kind !== 'official')

  // Follow the focused version past the scroll bounds.
  useEffect(() => {
    if (focusSection === 'versions') {
      versionRefs.current[versionIdx]?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusSection, versionIdx])

  const doLaunch = useCallback(async (rom: Rom, fresh: boolean) => {
    setContinueRom(null)
    setLaunching(rom.id)
    setLaunchError(null)
    try {
      await api.roms.launch(rom.id, user.id, fresh)
      setTimeout(() => setLaunching(null), 10_000)
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : 'Launch failed')
      setLaunching(null)
    }
  }, [user.id])

  const launch = useCallback(async (rom: Rom) => {
    if (launching !== null) return
    try {
      const result = await api.roms.saveState(rom.id)
      if (result.exists) { setContinueRom(rom); setContinueIdx(0); return }
    } catch (e) {
      setLaunchError(`Save state check failed: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    void doLaunch(rom, false)
  }, [launching, doLaunch])

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

  // Opening an unscraped game kicks off a scrape automatically (once per id).
  useEffect(() => {
    if (game.scraped_at || autoScrapedRef.current === game.id) return
    autoScrapedRef.current = game.id
    void scrape()
  }, [game.id, game.scraped_at, scrape])

  useGamepad((action) => {
    if (continueRom) {
      if (action === 'left' || action === 'up') setContinueIdx(0)
      if (action === 'right' || action === 'down') setContinueIdx(1)
      if (action === 'confirm') void doLaunch(continueRom, continueIdx === 1)
      if (action === 'back') setContinueRom(null)
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
      // Sidebar actions are a vertical column: up/down walk it, up off the top
      // returns to the version list. left/right retained as a fallback.
      if (action === 'up') {
        if (actionIdx === 0) setFocusSection(roms.length > 0 ? 'versions' : 'description')
        else setActionIdx(i => i - 1)
      }
      if (action === 'down') setActionIdx(i => Math.min(ACTIONS.length - 1, i + 1))
      if (action === 'left') setActionIdx(i => Math.max(0, i - 1))
      if (action === 'right') setActionIdx(i => Math.min(ACTIONS.length - 1, i + 1))
      if (action === 'confirm') {
        const act = ACTIONS[actionIdx]
        if (act === 'favorite') void toggleFavorite()
        if (act === 'add-to-list') setAddToListOpen(true)
        if (act === 'scrape') void scrape()
        if (act === 'hacks') setHacksOpen(true)
        if (act === 'random-again') onRandomAgain?.()
        if (act === 'back') onBack()
      }
    }
  }, !addToListOpen && !hacksOpen)

  const lastPlayedDate = detail?.last_played
    ? new Date(detail.last_played).toLocaleDateString()
    : null

  const scrapedDate = game.scraped_at ? new Date(game.scraped_at).toLocaleDateString() : null

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col overflow-hidden px-[5%] pt-[2.5%] pb-[3%] font-sans">
      <div className="flex items-center justify-between flex-shrink-0">
        <Breadcrumb>home / all games / detail</Breadcrumb>
        <StatusBar />
      </div>

      <div className="flex-1 flex gap-14 pt-6 min-h-0">
        {/* Left column — title, meta, description, versions */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden">
          <div>
            <p className="text-vault-accent font-mono text-[0.9rem] uppercase tracking-[0.14em]">{game.system}</p>
            <Title className="text-6xl mt-1">{game.name}</Title>
          </div>

          <div className="flex items-center gap-4 text-lg text-[#eaf0f8]/70">
            {game.year && <span>{game.year}</span>}
            {game.genre && <><span className="text-[#eaf0f8]/40">·</span><span>{game.genre}</span></>}
            {game.players && <><span className="text-[#eaf0f8]/40">·</span><span>{game.players} player{game.players > 1 ? 's' : ''}</span></>}
          </div>

          <p className="font-mono text-[0.9rem] tracking-[0.04em] text-vault-muted">
            {detail?.total_play_count ?? 0}× played
            {lastPlayedDate ? ` · last ${lastPlayedDate}` : ''}
            {roms.length ? ` · ${roms.length} version${roms.length > 1 ? 's' : ''} on disk` : ''}
            {game.scraped_at ? ' · rom verified' : ''}
          </p>

          {game.description && (
            <div
              onClick={() => setDescExpanded(v => !v)}
              className={[
                'cursor-pointer -mx-2 px-2 py-1',
                focusSection === 'description' ? 'border-l-[6px] border-vault-pink bg-vault-panel' : 'border-l-[6px] border-transparent',
              ].join(' ')}
            >
              <p
                className={[
                  'font-read text-[1.15rem] leading-[1.45] text-[#eaf0f8]/74',
                  descExpanded ? 'overflow-y-auto' : 'line-clamp-3',
                ].join(' ')}
                style={descExpanded ? { maxHeight: '24vh', scrollbarWidth: 'none' } : undefined}
              >
                {game.description}
              </p>
              {focusSection === 'description' && (
                <span className="text-vault-accent font-mono text-[0.8rem] uppercase tracking-[0.1em] mt-1 inline-block">
                  a {descExpanded ? 'collapse' : 'expand'}
                </span>
              )}
            </div>
          )}

          {launchError && <p className="text-red-400 text-sm">{launchError}</p>}
          {scrapeError && <p className="text-red-400 text-sm">{scrapeError}</p>}

          {/* Versions section */}
          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            {detail === null ? (
              <div className="flex flex-col gap-2">
                {[0, 1].map(i => (
                  <div key={i} className="h-14 bg-vault-panel animate-pulse" />
                ))}
              </div>
            ) : roms.length === 0 ? (
              <p className="text-vault-muted text-sm">No ROMs found for this game.</p>
            ) : (
              <div className="flex flex-col gap-3 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {!singleRom && !mixed && (
                  <SectionHeader label="versions" meta={`${roms.length} on disk`} />
                )}
                {roms.map((rom, i) => {
                  // Subheaders only in mixed mode, emitted at each group boundary.
                  const officialHdr = mixed && i === 0 && rom.kind === 'official'
                  const otherHdr = mixed && rom.kind !== 'official'
                    && (i === 0 || roms[i - 1]!.kind === 'official')
                  return (
                    <Fragment key={rom.id}>
                      {officialHdr && <SectionHeader label="official releases" />}
                      {otherHdr && <SectionHeader label="translations & hacks" />}
                      <RomRow
                        rom={rom}
                        focused={focusSection === 'versions' && versionIdx === i}
                        launching={launching === rom.id}
                        onLaunch={(r) => void launch(r)}
                        rowRef={(el) => { versionRefs.current[i] = el }}
                      />
                    </Fragment>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar — box art + actions */}
        <div className="w-[360px] flex-none flex flex-col gap-4">
          {game.box_art_path ? (
            <img
              src={game.box_art_path}
              alt={game.name}
              className="w-full h-[440px] object-cover border-[6px] border-vault-surface"
            />
          ) : (
            <div
              className="w-full h-[440px] border-[6px] border-vault-surface flex items-center justify-center text-center"
              style={{ background: 'repeating-linear-gradient(135deg,#1d1b33 0 10px,#16142a 10px 20px)' }}
            >
              <span className="font-mono text-[0.8rem] uppercase tracking-[0.1em] text-vault-muted leading-[1.7]">
                box art<br />lazy-loaded
              </span>
            </div>
          )}
          {scrapedDate && (
            <div className="font-mono text-[0.78rem] uppercase tracking-[0.08em] text-vault-muted">
              scraped {scrapedDate}
            </div>
          )}
          <Rule />

          {/* Action rows — favorite / add to list / scrape / hacks / (random) / back */}
          <div className="flex flex-col">
            {ACTIONS.map((act, i) => {
              const focused = focusSection === 'actions' && actionIdx === i
              const label = act === 'favorite' ? 'Favorite'
                : act === 'add-to-list' ? 'Add to List'
                : act === 'scrape' ? 'Scrape metadata'
                : act === 'hacks' ? 'Hacks'
                : act === 'random-again' ? 'Random Again'
                : 'Back'
              const status = act === 'favorite' ? (isFavorite ? 'on' : 'off')
                : act === 'scrape' ? (scraping ? 'scraping…' : scrapedDate ?? '')
                // Blank until the detail fetch lands, and when a game has none —
                // a bare "0" reads as an error next to an openable row.
                : act === 'hacks' ? (hackCount ? String(hackCount) : '')
                : ''
              return (
                <div
                  key={act}
                  onClick={() => {
                    if (act === 'favorite') void toggleFavorite()
                    if (act === 'add-to-list') setAddToListOpen(true)
                    if (act === 'scrape') void scrape()
                    if (act === 'hacks') setHacksOpen(true)
                    if (act === 'random-again') onRandomAgain?.()
                    if (act === 'back') onBack()
                  }}
                  className={[
                    'flex items-center gap-3 px-3 py-3 border-l-[6px] cursor-pointer',
                    focused ? 'bg-vault-accent-bright text-vault-ink border-vault-pink' : 'border-transparent',
                  ].join(' ')}
                >
                  <span className="text-xl">{label}</span>
                  <span className="flex-1" />
                  <span className={`font-mono text-[0.85rem] tracking-[0.06em] ${focused ? 'text-vault-ink/70' : act === 'favorite' && isFavorite ? 'text-vault-accent' : 'text-vault-muted'}`}>
                    {status}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 pt-4">
        <HintBar hints={['d-pad move', 'a launch version', 'y favorite', 'x scrape', 'b back']} />
      </div>

      {addToListOpen && (
        <AddToListModal game={game} user={user} onClose={() => setAddToListOpen(false)} onListCreated={onListCreated} />
      )}

      {hacksOpen && (
        <HacksPanel game={game} user={user} onClose={() => setHacksOpen(false)} />
      )}

      {continueRom && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-vault-panel border border-vault-surface p-8 w-full max-w-sm space-y-5">
            <div>
              <h2 className="font-display text-3xl">Continue?</h2>
              <p className="text-vault-muted text-sm mt-1 font-mono tracking-[0.04em]">A save state was found for this game.</p>
            </div>
            <div className="flex gap-3">
              {([
                { label: 'Continue', fresh: false },
                { label: 'New Game', fresh: true },
              ] as const).map(({ label, fresh }, i) => (
                <button
                  key={label}
                  onClick={() => void doLaunch(continueRom, fresh)}
                  className={[
                    'flex-1 px-4 py-3 rounded-[2px] font-mono uppercase tracking-[0.08em] text-sm',
                    i === 0 ? 'bg-vault-accent-bright text-vault-ink' : 'bg-vault-surface text-[#eaf0f8] border border-vault-muted',
                    continueIdx === i ? 'ring-4 ring-white' : '',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-vault-muted text-xs uppercase tracking-[0.08em] text-center font-mono">
              ← → select · a confirm · b cancel
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
