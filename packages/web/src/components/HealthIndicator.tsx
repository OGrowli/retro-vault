import { useState, useEffect } from 'react'
import { api } from '../api/client'

type Health = Awaited<ReturnType<typeof api.system.health>>

// Pi health readout for the Home top bar — CPU temp plus power/throttle flags so
// the user knows when to power down and let it rest. TV UI, so a 30s poll is
// plenty. Self-contained: holds only its own state, never touches the Home grid.
const POLL_MS = 30_000

// Pi 3 soft-throttles at 80C; warn well before that.
const HOT_C = 75
const WARM_C = 60

type Level = 'ok' | 'warm' | 'hot'

function levelOf(h: Health): Level {
  if (h.throttleNow || h.underVoltageNow || (h.tempC !== null && h.tempC >= HOT_C)) return 'hot'
  if (h.throttleEver || h.underVoltageEver || (h.tempC !== null && h.tempC >= WARM_C)) return 'warm'
  return 'ok'
}

const DOT: Record<Level, string> = {
  ok: 'bg-emerald-400',
  warm: 'bg-amber-400',
  hot: 'bg-red-500',
}

export function HealthIndicator() {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    let alive = true
    const tick = () => { api.system.health().then(h => { if (alive) setHealth(h) }).catch(() => {}) }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // No reading (dev / non-Pi / read failed) — render nothing rather than a broken widget.
  if (!health || health.tempC === null) return null

  const level = levelOf(health)
  const title = health.underVoltageNow || health.underVoltageEver
    ? 'Under-voltage detected — check the power supply'
    : health.throttleEver
      ? 'Throttled earlier — consider a rest'
      : 'CPU temperature'

  return (
    <span
      className="flex items-center gap-1.5 text-sm font-semibold tabular-nums"
      title={title}
    >
      <span className={`w-2 h-2 rounded-full inline-block ${DOT[level]}`} />
      <span className={level === 'hot' ? 'text-red-400' : 'text-white'}>
        {Math.round(health.tempC)}°C
      </span>
      {level === 'hot' && (
        <span className="text-red-400 text-xs font-bold uppercase tracking-wide">
          Running hot — rest it
        </span>
      )}
    </span>
  )
}
