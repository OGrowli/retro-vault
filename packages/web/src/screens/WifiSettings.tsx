import { useState, useEffect, useCallback, useRef } from 'react'
import type { WifiNetwork, WifiStatus } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'
import { VirtualKeyboard } from '../components/VirtualKeyboard'

interface Props {
  onBack: () => void
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

// Four signal bars filled by strength (nmcli SIGNAL is 0–100).
function SignalBars({ signal }: { signal: number }) {
  const bars = Math.round(clamp(signal, 0, 100) / 25) // 0..4
  return (
    <span className="flex items-end gap-0.5 h-4" aria-label={`${signal}%`}>
      {[1, 2, 3, 4].map(i => (
        <span
          key={i}
          className={['w-1 rounded-sm', i <= bars ? 'bg-vault-accent' : 'bg-vault-surface'].join(' ')}
          style={{ height: `${i * 25}%` }}
        />
      ))}
    </span>
  )
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-vault-muted">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export function WifiSettings({ onBack }: Props) {
  const [status, setStatus] = useState<WifiStatus | null>(null)
  const [networks, setNetworks] = useState<WifiNetwork[]>([])
  const [scanning, setScanning] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Non-null while entering a password for a secured network.
  const [pwSsid, setPwSsid] = useState<string | null>(null)
  const [pwValue, setPwValue] = useState('')
  const [focused, setFocused] = useState(0)
  // itemRefs[0]=Rescan, [1..N]=networks, [N+1]=Back.
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  const backIdx = networks.length + 1

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(t => (t === msg ? null : t)), 2600)
  }, [])

  const refreshStatus = useCallback(() => {
    api.wifi.status().then(setStatus).catch(() => {})
  }, [])

  const scan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const [nets] = await Promise.all([api.wifi.scan(), api.wifi.status().then(setStatus)])
      setNetworks(nets)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => { void scan() }, [scan])

  const connect = useCallback(async (ssid: string, password?: string) => {
    setPwSsid(null)
    setPwValue('')
    setConnecting(ssid)
    setError(null)
    try {
      const res = await api.wifi.connect(ssid, password)
      if (res.connected) {
        showToast(`Connected to ${ssid}`)
        refreshStatus()
        void scan()
      } else {
        showToast(res.error ? `Couldn't connect: ${res.error}` : `Couldn't connect to ${ssid}`)
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setConnecting(null)
    }
  }, [scan, refreshStatus, showToast])

  const disconnect = useCallback(async () => {
    setConnecting(null)
    try {
      await api.wifi.disconnect()
      showToast('Disconnected')
      refreshStatus()
      void scan()
    } catch {
      showToast('Disconnect failed')
    }
  }, [scan, refreshStatus, showToast])

  const activateNetwork = useCallback((net: WifiNetwork) => {
    if (connecting) return
    if (net.active) { void disconnect(); return }
    // Secured and no saved profile → need a password. Open networks and saved
    // networks connect straight through (NM reuses the stored credentials).
    if (net.security && !net.saved) { setPwSsid(net.ssid); setPwValue(''); return }
    void connect(net.ssid)
  }, [connecting, disconnect, connect])

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    if (action === 'up') setFocused(i => clamp(i - 1, 0, backIdx))
    if (action === 'down') setFocused(i => clamp(i + 1, 0, backIdx))
    if (action === 'confirm') {
      if (focused === 0) { void scan(); return }
      if (focused === backIdx) { onBack(); return }
      const net = networks[focused - 1]
      if (net) activateNetwork(net)
    }
  }, pwSsid === null)

  useEffect(() => {
    itemRefs.current[focused]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  const statusLine = status?.connected
    ? `Connected to ${status.ssid}${status.ip ? ` · ${status.ip}` : ''}`
    : status?.enabled === false
      ? 'Wi-Fi is turned off'
      : 'Not connected'

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">
            <span className="text-vault-muted font-medium">Settings / </span>Wi-Fi
          </h1>
          <p className="text-vault-muted text-xs uppercase tracking-widest mt-0.5">
            <span className={status?.connected ? 'text-vault-accent' : ''}>{statusLine}</span>
          </p>
        </div>
        <div className="ml-auto"><Clock /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-6" style={{ scrollbarWidth: 'none' }}>
        <div className="space-y-2 max-w-lg">
          <button
            ref={el => { itemRefs.current[0] = el }}
            onClick={() => void scan()}
            onMouseEnter={() => setFocused(0)}
            className={[
              'w-full py-3 px-5 rounded-xl text-left flex items-center justify-between',
              'bg-vault-surface border transition-colors duration-150 motion-reduce:transition-none',
              focused === 0 ? 'ring-2 ring-white border-vault-accent' : 'border-vault-muted',
            ].join(' ')}
          >
            <span className="text-white font-bold uppercase tracking-wide text-sm">
              {scanning ? 'Scanning…' : 'Rescan Networks'}
            </span>
            {scanning && <span className="w-4 h-4 rounded-full border-2 border-vault-muted border-t-vault-accent animate-spin motion-reduce:animate-none" />}
          </button>

          {error && <p className="text-red-400 text-sm px-1 py-2">{error}</p>}

          {!scanning && networks.length === 0 && !error && (
            <p className="text-vault-muted text-sm px-1 py-4">No networks found.</p>
          )}

          {networks.map((net, i) => {
            const idx = i + 1
            const isConnecting = connecting === net.ssid
            return (
              <button
                key={net.ssid}
                ref={el => { itemRefs.current[idx] = el }}
                onClick={() => activateNetwork(net)}
                onMouseEnter={() => setFocused(idx)}
                className={[
                  'w-full py-3.5 px-5 rounded-xl text-left flex items-center gap-4',
                  'bg-vault-surface border transition-colors duration-150 motion-reduce:transition-none',
                  focused === idx ? 'ring-2 ring-white border-vault-accent' : 'border-vault-muted',
                ].join(' ')}
              >
                <SignalBars signal={net.signal} />
                <div className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 text-white font-semibold text-sm truncate">
                    {net.ssid}
                    {net.security && <LockIcon />}
                  </span>
                  <span className="block text-vault-muted text-[0.7rem] uppercase tracking-wide mt-0.5">
                    {net.active ? 'Connected' : net.saved ? 'Saved' : net.security || 'Open'}
                  </span>
                </div>
                {isConnecting ? (
                  <span className="text-vault-accent text-xs uppercase tracking-wide">Connecting…</span>
                ) : net.active ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-vault-accent flex-shrink-0" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-[5%] py-4 border-t border-vault-surface flex items-center gap-4">
        <button
          ref={el => { itemRefs.current[backIdx] = el }}
          onClick={onBack}
          onMouseEnter={() => setFocused(backIdx)}
          className={[
            'px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wide transition-colors duration-150',
            'bg-vault-surface text-white border border-vault-muted inline-flex items-center gap-2',
            'motion-reduce:transition-none',
            focused === backIdx ? 'ring-2 ring-white' : '',
          ].join(' ')}
        >
          <Glyph type="circle" /> Back
        </button>
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5">
          <Glyph type="circle" /> Back  ·  D-Pad Navigate  ·  <Glyph type="cross" /> Connect
        </p>
      </div>

      {/* Password entry for a secured network. */}
      {pwSsid !== null && (
        <>
          <div className="fixed inset-0 bg-black/80 z-40" onClick={() => setPwSsid(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div
              className="bg-vault-card rounded-2xl p-6 w-full max-w-[460px] flex flex-col gap-4 animate-rise-in motion-reduce:animate-none"
              style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
            >
              <div>
                <h2 className="text-white text-xl font-extrabold">Enter Password</h2>
                <p className="text-vault-accent-bright text-xs font-semibold uppercase tracking-wide mt-0.5">{pwSsid}</p>
              </div>
              <VirtualKeyboard
                value={pwValue}
                onChange={setPwValue}
                onDone={() => { if (pwValue) void connect(pwSsid, pwValue) }}
                onCancel={() => setPwSsid(null)}
                enabled={pwSsid !== null}
                masked
              />
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-10 z-[60] bg-vault-accent text-white text-sm font-bold px-4 py-2.5 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  )
}
