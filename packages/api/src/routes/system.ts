import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const systemRouter = new Hono()

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
