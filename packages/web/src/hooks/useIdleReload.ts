import { useEffect } from 'react'

// After this much inactivity the kiosk reloads itself. A long-lived Chromium on
// the 1GB Pi 3B never reclaims renderer/GPU/image-cache memory, so it creeps up
// over a browse-only session (launching a game already resets it by tearing the
// browser down). A reload drops the renderer back to baseline; filter/home prefs
// persist to localStorage, so it comes back seamlessly.
export const IDLE_RELOAD_MS = 30 * 60 * 1000

export function useIdleReload(timeoutMs: number = IDLE_RELOAD_MS, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    let last = Date.now()
    const bump = () => { last = Date.now() }

    // Keyboard/pointer cover a plugged-in keyboard or dev use...
    const domEvents = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']
    domEvents.forEach(e => window.addEventListener(e, bump, { passive: true }))

    // ...but the controller emits no DOM events, so sample the pad directly. 1s
    // is cheap and reliably catches brief presses a slower poll would miss.
    const tick = window.setInterval(() => {
      for (const p of navigator.getGamepads()) {
        if (!p) continue
        if (p.buttons.some(b => b.pressed) || p.axes.some(a => Math.abs(a) > 0.5)) {
          last = Date.now()
          break
        }
      }
      if (Date.now() - last >= timeoutMs) location.reload()
    }, 1000)

    return () => {
      domEvents.forEach(e => window.removeEventListener(e, bump))
      clearInterval(tick)
    }
  }, [timeoutMs, enabled])
}
