import { Hono } from 'hono'
import { runImport } from '../importer.js'

export const importRouter = new Hono()

importRouter.post('/', (c) => {
  try {
    const result = runImport()
    return c.json(result)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})
