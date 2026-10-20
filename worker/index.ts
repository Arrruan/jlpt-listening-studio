import { parseByteRange } from './range'

interface Env {
  LIBRARY_BUCKET: R2Bucket
  ASSETS: Fetcher
}

const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  },
})

const objectHeaders = (object: R2Object) => {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  return headers
}

const serveJsonObject = async (bucket: R2Bucket, key: string, method: string) => {
  const object = await bucket.get(key)
  if (!object) return json({ detail: 'Not found' }, 404)
  const headers = objectHeaders(object)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Content-Length', String(object.size))
  headers.set('Cache-Control', 'private, no-store')
  return new Response(method === 'HEAD' ? null : object.body, { status: 200, headers })
}

const serveMedia = async (request: Request, bucket: R2Bucket, fileName: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) return json({ detail: 'Invalid media path' }, 400)
  const key = `media/${fileName}`
  const head = await bucket.head(key)
  if (!head) return json({ detail: 'Media not found' }, 404)

  const headers = objectHeaders(head)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'private, max-age=3600')
  headers.set('Content-Disposition', 'inline')
  const range = parseByteRange(request.headers.get('Range'), head.size)
  if (range && !range.valid) {
    headers.set('Content-Range', `bytes */${head.size}`)
    return new Response(null, { status: 416, headers })
  }

  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(range?.valid ? range.length : head.size))
    if (range?.valid) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`)
    return new Response(null, { status: range?.valid ? 206 : 200, headers })
  }

  const object = await bucket.get(key, range?.valid ? { range: { offset: range.offset, length: range.length } } : undefined)
  if (!object) return json({ detail: 'Media not found' }, 404)
  if (range?.valid) {
    headers.set('Content-Length', String(range.length))
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`)
    return new Response(object.body, { status: 206, headers })
  }
  headers.set('Content-Length', String(head.size))
  return new Response(object.body, { status: 200, headers })
}

const withSecurityHeaders = (response: Response) => {
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'")
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (!['GET', 'HEAD'].includes(request.method)) return json({ detail: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' })

    if (url.pathname === '/api/health') {
      return json({ ok: true, library: 'private-r2' })
    }
    if (url.pathname === '/api/library/catalog') {
      return serveJsonObject(env.LIBRARY_BUCKET, 'library/catalog.json', request.method)
    }
    if (url.pathname.startsWith('/api/library/exams/')) {
      const examId = decodeURIComponent(url.pathname.slice('/api/library/exams/'.length))
      if (!/^[a-zA-Z0-9._-]+$/.test(examId)) return json({ detail: 'Invalid exam id' }, 400)
      return serveJsonObject(env.LIBRARY_BUCKET, `library/exams/${examId}.json`, request.method)
    }
    if (url.pathname.startsWith('/api/media/')) {
      const fileName = decodeURIComponent(url.pathname.slice('/api/media/'.length))
      return serveMedia(request, env.LIBRARY_BUCKET, fileName)
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request))
  },
} satisfies ExportedHandler<Env>
