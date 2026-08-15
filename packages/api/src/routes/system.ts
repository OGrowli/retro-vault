import { Hono } from 'hono'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export const systemRouter = new Hono()

// CPU temperature from sysfs — millidegrees C, a sub-ms kernel read (no subprocess).
const THERMAL_PATH = '/sys/class/thermal/thermal_zone0/temp'

function readTempC(): number | null {
  try {
    const milli = parseInt(fs.readFileSync(THERMAL_PATH, 'utf8').trim(), 10)
    return Number.isFinite(milli) ? milli / 1000 : null
  } catch {
    return null
  }
}

// `vcgencmd get_throttled` → `throttled=0x<hex>` bitmask. Bits 0-3 are the
// live state (under-voltage / arm-capped / throttled / soft-temp-limit now),
// bits 16-19 the same conditions latched since boot. Absolute path in case the
// systemd unit runs with a minimal PATH.
async function readThrottle(): Promise<number | null> {
  for (const bin of ['/usr/bin/vcgencmd', 'vcgencmd']) {
    try {
      const { stdout } = await execFileAsync(bin, ['get_throttled'], { timeout: 2000 })
      const m = stdout.match(/0x([0-9a-fA-F]+)/)
      if (m) return parseInt(m[1]!, 16)
    } catch { /* try next / give up */ }
  }
  return null
}

// Cheap health snapshot for the Home indicator: CPU temp + power/throttle flags
// so the user knows when to power down and let the Pi rest. Polled ~every 30s.
systemRouter.get('/health', async (c) => {
  if (process.platform !== 'linux') {
    return c.json({
      tempC: null,
      throttleNow: false,
      underVoltageNow: false,
      throttleEver: false,
      underVoltageEver: false,
    })
  }

  const tempC = readTempC()
  const bits = await readThrottle()
  const b = bits ?? 0

  return c.json({
    tempC,
    throttleNow: (b & 0b1111) !== 0,          // bits 0-3
    underVoltageNow: (b & (1 << 0)) !== 0,    // bit 0
    throttleEver: (b & (0b1111 << 16)) !== 0, // bits 16-19
    underVoltageEver: (b & (1 << 16)) !== 0,  // bit 16
  })
})

// Resolved from the service's WorkingDirectory (repo root), same as launch-game.sh.
const DEPLOY_SCRIPT = path.resolve('scripts/deploy.sh')
const DATA_DIR = process.env['RETROVAULT_DATA_DIR'] ?? path.join(os.homedir(), '.retrovault')
const DEPLOY_LOG = path.join(DATA_DIR, 'deploy.log')

// Runs scripts/deploy.sh (git pull → npm build → restart service → reboot).
// Detached + unref'd so it outlives this request and the reboot that ends it;
// output is appended to ~/.retrovault/deploy.log for post-mortem.
systemRouter.post('/update', (c) => {
  if (process.platform !== 'linux') {
    return c.json({ error: 'Update is only available on the device' }, 400)
  }
  if (!fs.existsSync(DEPLOY_SCRIPT)) {
    return c.json({ error: `Deploy script not found: ${DEPLOY_SCRIPT}` }, 500)
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })

  // The log is appended across deploys — capture where this run starts so the
  // client can stream just this update's output, not the whole history.
  let offset = 0
  try { offset = fs.statSync(DEPLOY_LOG).size } catch { /* no prior log */ }

  const out = fs.openSync(DEPLOY_LOG, 'a')

  const child = spawn('bash', [DEPLOY_SCRIPT], {
    detached: true,
    stdio: ['ignore', out, out],
    cwd: path.dirname(path.dirname(DEPLOY_SCRIPT)),
  })
  child.unref()

  return c.json({ started: true, offset })
})

// Tails the deploy log from a byte offset so the app can show a live feed of
// the running update. Returns new content plus the offset to poll from next.
systemRouter.get('/update/log', (c) => {
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0)

  let size = 0
  try {
    size = fs.statSync(DEPLOY_LOG).size
  } catch {
    return c.json({ content: '', offset: 0, size: 0 })
  }
  if (offset >= size) return c.json({ content: '', offset: size, size })

  const fd = fs.openSync(DEPLOY_LOG, 'r')
  try {
    const len = size - offset
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, offset)
    return c.json({ content: buf.toString('utf8'), offset: size, size })
  } finally {
    fs.closeSync(fd)
  }
})
