import { useState, useEffect } from 'react'

// Small wall clock pinned to a screen's top bar. TV UI — a 20s tick is plenty,
// no need for per-second churn. Locale decides 12- vs 24-hour.
function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Clock() {
  const [time, setTime] = useState(now)

  useEffect(() => {
    const id = setInterval(() => setTime(now()), 20_000)
    return () => clearInterval(id)
  }, [])

  return <span className="text-white text-sm font-semibold tabular-nums">{time}</span>
}
