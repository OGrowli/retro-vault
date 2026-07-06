import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import type { ScrapeProgress } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { VirtualKeyboard } from '../components/VirtualKeyboard'

interface Props {
  systems: string[]
  onBack: () => void
}

const FOCUS_ITEMS = ['dev-id', 'dev-password', 'username', 'password', 'save-creds', 'scrape-all', 'scrape-system', 'back'] as const
type FocusItem = (typeof FOCUS_ITEMS)[number]

type CredField = 'dev-id' | 'dev-password' | 'username' | 'password'

const CRED_LABELS: Record<CredField, string> = {
  'dev-id': 'Dev ID',
  'dev-password': 'Dev Password',
  'username': 'Username',
  'password': 'Password',
}

function parseSseChunks(text: string): ScrapeProgress[] {
  const events: ScrapeProgress[] = []
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        events.push(JSON.parse(line.slice(6)) as ScrapeProgress)
      } catch { /* skip malformed */ }
    }
  }
  return events
}

async function streamScrape(
  response: Response,
  onProgress: (p: ScrapeProgress) => void
): Promise<void> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = parseSseChunks(buf)
    // Only keep last partial line in buffer
    const lastNl = buf.lastIndexOf('\n')
    if (lastNl !== -1) buf = buf.slice(lastNl + 1)
    for (const e of events) onProgress(e)
  }
}

export function Settings({ systems, onBack }: Props) {
  const [devId, setDevId] = useState('')
  const [devPassword, setDevPassword] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [selectedSystem, setSelectedSystem] = useState(systems[0] ?? '')
  const [focused, setFocused] = useState<FocusItem>('scrape-all')
  const [progress, setProgress] = useState<ScrapeProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [vkField, setVkField] = useState<CredField | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const focusIdx = FOCUS_ITEMS.indexOf(focused)

  useEffect(() => {
    api.settings.get().then(s => {
      setDevId(s.ss_dev_id ?? '')
      setDevPassword(s.ss_dev_password ?? '')
      setUsername(s.ss_user ?? '')
      setPassword(s.ss_user_password ?? '')
    }).catch(() => {})
  }, [])

  const saveCreds = useCallback(async () => {
    setSaveMsg(null)
    try {
      await api.settings.save({
        ss_dev_id: devId,
        ss_dev_password: devPassword,
        ss_user: username,
        ss_user_password: password,
      })
      setSaveMsg('Credentials saved')
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed')
    }
  }, [devId, devPassword, username, password])

  const credValue = (f: CredField) =>
    f === 'dev-id' ? devId : f === 'dev-password' ? devPassword : f === 'username' ? username : password
  const credSetter = (f: CredField) =>
    f === 'dev-id' ? setDevId : f === 'dev-password' ? setDevPassword : f === 'username' ? setUsername : setPassword

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
  }, [])

  const scrapeAll = useCallback(async () => {
    if (running) return
    setRunning(true)
    setError(null)
    setProgress(null)
    abortRef.current = new AbortController()
    try {
      const res = await api.scrape.all(username, password, abortRef.current.signal)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      await streamScrape(res, setProgress)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(e instanceof Error ? e.message : 'Scrape failed')
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [running, username, password])

  const scrapeSystem = useCallback(async () => {
    if (running || !selectedSystem) return
    setRunning(true)
    setError(null)
    setProgress(null)
    abortRef.current = new AbortController()
    try {
      const res = await api.scrape.system(selectedSystem, username, password, abortRef.current.signal)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      await streamScrape(res, setProgress)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(e instanceof Error ? e.message : 'Scrape failed')
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [running, selectedSystem, username, password])

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    if (action === 'up') setFocused(FOCUS_ITEMS[Math.max(0, focusIdx - 1)])
    if (action === 'down') setFocused(FOCUS_ITEMS[Math.min(FOCUS_ITEMS.length - 1, focusIdx + 1)])
    if (focused === 'scrape-system' && (action === 'left' || action === 'right')) {
      const i = systems.indexOf(selectedSystem)
      const next = action === 'right'
        ? systems[(i + 1) % systems.length]
        : systems[(i - 1 + systems.length) % systems.length]
      if (next) setSelectedSystem(next)
      return
    }
    if (action === 'confirm') {
      if (focused === 'dev-id' || focused === 'dev-password' || focused === 'username' || focused === 'password') {
        setVkField(focused)
        return
      }
      if (focused === 'save-creds') void saveCreds()
      if (focused === 'scrape-all') void scrapeAll()
      if (focused === 'scrape-system') void scrapeSystem()
      if (focused === 'back') onBack()
    }
  }, !running && !vkField)

  const isFocused = (item: FocusItem) => focused === item

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <h1 className="text-white text-2xl font-bold tracking-tight">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-8 space-y-8" style={{ scrollbarWidth: 'none' }}>
        {/* ScreenScraper credentials */}
        <section>
          <h2 className="text-vault-muted text-xs uppercase tracking-widest mb-1.5">ScreenScraper Credentials</h2>
          <p className="text-vault-muted text-xs mb-4 max-w-sm">
            Dev credentials enable full metadata scraping (register at screenscraper.fr and request API access).
            Without them, box art comes free from libretro thumbnails.
          </p>
          <div className="space-y-3 max-w-sm">
            <div>
              <label className="text-vault-muted text-xs uppercase tracking-wide block mb-1.5">Dev ID</label>
              <input
                type="text"
                value={devId}
                onChange={e => setDevId(e.target.value)}
                onFocus={() => setFocused('dev-id')}
                className={[
                  'w-full bg-vault-surface border rounded-lg px-4 py-3 text-white text-sm focus:outline-none',
                  isFocused('dev-id') ? 'border-vault-accent ring-1 ring-vault-accent' : 'border-vault-muted',
                ].join(' ')}
                placeholder="ScreenScraper dev ID"
              />
            </div>
            <div>
              <label className="text-vault-muted text-xs uppercase tracking-wide block mb-1.5">Dev Password</label>
              <input
                type="password"
                value={devPassword}
                onChange={e => setDevPassword(e.target.value)}
                onFocus={() => setFocused('dev-password')}
                className={[
                  'w-full bg-vault-surface border rounded-lg px-4 py-3 text-white text-sm focus:outline-none',
                  isFocused('dev-password') ? 'border-vault-accent ring-1 ring-vault-accent' : 'border-vault-muted',
                ].join(' ')}
                placeholder="ScreenScraper dev password"
              />
            </div>
            <div>
              <label className="text-vault-muted text-xs uppercase tracking-wide block mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onFocus={() => setFocused('username')}
                className={[
                  'w-full bg-vault-surface border rounded-lg px-4 py-3 text-white text-sm focus:outline-none',
                  isFocused('username') ? 'border-vault-accent ring-1 ring-vault-accent' : 'border-vault-muted',
                ].join(' ')}
                placeholder="Optional — raises rate limit"
              />
            </div>
            <div>
              <label className="text-vault-muted text-xs uppercase tracking-wide block mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                className={[
                  'w-full bg-vault-surface border rounded-lg px-4 py-3 text-white text-sm focus:outline-none',
                  isFocused('password') ? 'border-vault-accent ring-1 ring-vault-accent' : 'border-vault-muted',
                ].join(' ')}
                placeholder="Optional — raises rate limit"
              />
            </div>
            <button
              onClick={() => void saveCreds()}
              className={[
                'w-full py-3 rounded-xl font-bold text-white uppercase tracking-wide text-sm',
                'bg-vault-surface border border-vault-muted transition-all duration-150 motion-reduce:transition-none',
                isFocused('save-creds') ? 'ring-2 ring-white border-vault-accent scale-105 motion-reduce:scale-100' : '',
              ].join(' ')}
            >
              Save Credentials
            </button>
            {saveMsg && <p className="text-vault-accent text-sm">{saveMsg}</p>}
          </div>
        </section>

        {/* Scrape actions */}
        <section>
          <h2 className="text-vault-muted text-xs uppercase tracking-widest mb-4">Scrape Library</h2>
          <div className="space-y-3 max-w-sm">
            <button
              onClick={() => void scrapeAll()}
              disabled={running}
              className={[
                'w-full py-4 rounded-xl font-bold text-white uppercase tracking-wide text-sm',
                'bg-vault-accent transition-all duration-150 motion-reduce:transition-none',
                isFocused('scrape-all') ? 'ring-2 ring-white scale-105 motion-reduce:scale-100' : '',
                running ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              Scrape Entire Library
            </button>

            <div className="flex gap-3">
              <select
                value={selectedSystem}
                onChange={e => setSelectedSystem(e.target.value)}
                className="flex-1 bg-vault-surface border border-vault-muted rounded-lg px-3 py-3 text-white text-sm focus:outline-none focus:border-vault-accent"
              >
                {systems.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={() => void scrapeSystem()}
                disabled={running || !selectedSystem}
                className={[
                  'px-6 py-3 rounded-xl font-bold text-white uppercase tracking-wide text-sm',
                  'bg-vault-surface border border-vault-muted transition-all duration-150 motion-reduce:transition-none',
                  isFocused('scrape-system') ? 'ring-2 ring-white border-vault-accent scale-105 motion-reduce:scale-100' : '',
                  running ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
              >
                Scrape System
              </button>
            </div>
          </div>
        </section>

        {/* Progress */}
        {(running || progress) && (
          <section>
            <h2 className="text-vault-muted text-xs uppercase tracking-widest mb-4">Progress</h2>
            <div className="max-w-sm bg-vault-card rounded-xl p-5 space-y-4">
              {progress && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-white font-semibold">{progress.done} scraped</span>
                    <span className="text-vault-muted">{progress.failed} failed</span>
                    <span className="text-vault-muted">{progress.total} total</span>
                  </div>
                  <div className="w-full bg-vault-surface rounded-full h-2">
                    <div
                      className="bg-vault-accent h-2 rounded-full transition-all duration-300"
                      style={{ width: progress.total > 0 ? `${((progress.done + progress.failed) / progress.total) * 100}%` : '0%' }}
                    />
                  </div>
                  {progress.current && (
                    <p className="text-vault-muted text-xs truncate">
                      Scraping: <span className="text-white">{progress.current}</span>
                    </p>
                  )}
                  {progress.complete && (
                    <p className="text-vault-accent text-sm font-semibold">
                      Complete — {progress.done} scraped, {progress.failed} failed
                    </p>
                  )}
                </>
              )}
              {running && !progress?.complete && (
                <button
                  onClick={cancel}
                  className="w-full py-2 rounded-lg text-sm font-bold uppercase tracking-wide text-vault-muted border border-vault-muted bg-vault-surface"
                >
                  Cancel
                </button>
              )}
            </div>
          </section>
        )}

        {error && (
          <p className="text-red-400 text-sm max-w-sm">{error}</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-[5%] py-4 border-t border-vault-surface flex items-center gap-4">
        <button
          onClick={onBack}
          className={[
            'px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wide transition-all duration-150',
            'bg-vault-surface text-white border border-vault-muted inline-flex items-center gap-2',
            'motion-reduce:transition-none',
            isFocused('back') ? 'ring-2 ring-white scale-105 motion-reduce:scale-100' : '',
          ].join(' ')}
        >
          <Glyph type="circle" /> Back
        </button>
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5">
          <Glyph type="circle" /> Back  ·  D-Pad Navigate  ·  <Glyph type="cross" /> Select
        </p>
      </div>
      {vkField && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-4">
          <div className="bg-vault-card rounded-2xl p-6 w-full max-w-[480px] max-h-[90vh] overflow-y-auto space-y-4" style={{ scrollbarWidth: 'none' }}>
            <h2 className="text-white text-lg font-bold">SS {CRED_LABELS[vkField]}</h2>
            <VirtualKeyboard
              value={credValue(vkField)}
              onChange={credSetter(vkField)}
              masked={vkField === 'dev-password' || vkField === 'password'}
              onDone={() => {
                // Advance to the next field, PS5-style; last field closes
                const order: CredField[] = ['dev-id', 'dev-password', 'username', 'password']
                const next = order[order.indexOf(vkField) + 1]
                setVkField(next ?? null)
                if (next) setFocused(next)
              }}
              onCancel={() => setVkField(null)}
              enabled={!!vkField}
            />
          </div>
        </div>
      )}
    </div>
  )
}
