import { Clock } from './Clock'
import { HealthIndicator } from './HealthIndicator'

// The status cluster every screen pins to its top bar: Pi health first (it only
// renders when there's a reading, so on a dev machine this is just the clock),
// then the wall clock. One component so a screen can't end up with the clock but
// no health readout.
export function StatusBar() {
  return (
    <span className="flex items-center gap-3">
      <HealthIndicator />
      <Clock />
    </span>
  )
}
