import { defineConfig } from 'vite'
import { apiMiddleware } from './server/api.mjs'

/** Serves /api from inside the Vite dev server, so `npm run dev` is the whole game locally. */
const api = () => ({
  name: 'bot-crossing-api',
  configureServer(server) {
    server.middlewares.use(apiMiddleware)
  },
})

// GitHub Pages serves the site under /<repo>/. In the Pages build we set BASE_PATH so assets
// resolve under that subpath; locally (dev) the base stays '/'. Override with BASE_PATH env.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [api()],
  // PORT lets a second copy run alongside the first without a flag on the command line.
  server: { port: Number(process.env.PORT) || 5274, strictPort: false },
  build: { target: 'esnext' },
})
