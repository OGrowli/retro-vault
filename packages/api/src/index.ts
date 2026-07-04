import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gamesRouter } from './routes/games.js'
import { romsRouter } from './routes/roms.js'
import { usersRouter } from './routes/users.js'
import { metaRouter } from './routes/meta.js'
import { importRouter } from './routes/import.js'
import { scrapeRouter } from './routes/scrape.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIST = path.join(__dirname, '../../web/dist')

const app = new Hono()

app.use('*', cors({ origin: '*' }))

app.route('/games', gamesRouter)
app.route('/roms', romsRouter)
app.route('/users', usersRouter)
app.route('/meta', metaRouter)
app.route('/import', importRouter)
app.route('/scrape', scrapeRouter)

const DATA_DIR = process.env['RETROVAULT_DATA_DIR'] ?? '/home/pi/.retrovault'
app.use(
  '/media/*',
  serveStatic({
    root: path.join(DATA_DIR, 'media'),
    rewriteRequestPath: (p) => p.replace(/^\/media/, ''),
  })
)

app.use('/*', serveStatic({ root: WEB_DIST }))

app.get('/*', (c) => {
  const indexPath = path.join(WEB_DIST, 'index.html')
  if (fs.existsSync(indexPath)) {
    return c.html(fs.readFileSync(indexPath, 'utf-8'))
  }
  return c.text('Web build not found. Run: npm run build -w packages/web', 503)
})

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`RetroVault API running on http://localhost:${info.port}`)
})
