import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const LOCAL_LIBRARY_ROUTE = '/api/local-library/packages'
const packageRoot = resolve(process.cwd(), 'backend/data/library_packages')

interface PreparedPackage {
  id?: unknown
  packageFile?: unknown
  status?: unknown
  [key: string]: unknown
}

const isLoopback = (request: IncomingMessage) => {
  const address = request.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

const readPackageIndex = (): PreparedPackage[] => {
  const path = resolve(packageRoot, 'index.json')
  if (!existsSync(path)) return []
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(value))
}

/** Development-only, loopback-only access to packages prepared from the ignored Listen folder. */
const localLibraryPlugin = () => ({
  name: 'jlpt-local-library',
  configureServer(server: { middlewares: { use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void } }) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname.replace(/\/$/, '')
      if (pathname !== LOCAL_LIBRARY_ROUTE && !pathname.startsWith(`${LOCAL_LIBRARY_ROUTE}/`)) {
        next()
        return
      }
      if (!isLoopback(request)) {
        sendJson(response, 403, { detail: 'Local library access is restricted to this computer' })
        return
      }
      if (request.method !== 'GET') {
        sendJson(response, 405, { detail: 'Method not allowed' })
        return
      }
      const resources = readPackageIndex()
      if (pathname === LOCAL_LIBRARY_ROUTE) {
        sendJson(response, 200, resources)
        return
      }
      const packageId = decodeURIComponent(pathname.slice(LOCAL_LIBRARY_ROUTE.length + 1))
      const resource = resources.find((item) => item.id === packageId && item.status === 'ready')
      if (!resource || typeof resource.packageFile !== 'string') {
        sendJson(response, 404, { detail: 'Unknown local library package' })
        return
      }
      const packagePath = resolve(packageRoot, resource.packageFile)
      if (dirname(packagePath) !== packageRoot || !existsSync(packagePath)) {
        sendJson(response, 404, { detail: 'Local library package is missing' })
        return
      }
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/zip')
      response.setHeader('Content-Length', statSync(packagePath).size)
      response.setHeader('Content-Disposition', `inline; filename="${packageId}.jlpt.zip"`)
      response.setHeader('Cache-Control', 'no-store')
      createReadStream(packagePath).pipe(response)
    })
  },
})

export default defineConfig({
  base: './',
  plugins: [react(), localLibraryPlugin()],
  server: {
    host: '127.0.0.1',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: { reporter: ['text', 'html'] },
  },
})
