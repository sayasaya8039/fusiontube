import { createServer, IncomingMessage, ServerResponse, Server, request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { URL } from 'url'
import { execFile } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, appendFileSync } from 'fs'
import { getSettings } from './store/settings'

function debugLog(msg: string): void {
  try {
    const logPath = join(app.getPath('userData'), 'stream-debug.log')
    const ts = new Date().toISOString()
    appendFileSync(logPath, `[${ts}] ${msg}\n`, 'utf8')
  } catch { /* ignore */ }
}

interface StreamJob {
  videoId: string
  /** 直接ストリームURL (video) */
  videoUrl: string
  /** 直接ストリームURL (audio, 分離の場合) */
  audioUrl: string
  status: 'resolving' | 'ready' | 'error'
  error: string | null
  isLive: boolean
  contentLength: number
}

const jobs = new Map<string, StreamJob>()
let server: Server | null = null
let proxyPort = 0

function getYtdlpPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'yt-dlp.exe')
  }
  return join(__dirname, '..', '..', 'resources', 'yt-dlp.exe')
}

function getCookieArgs(cookiesPathOverride?: string): string[] {
  const settings = getSettings()
  const cookiesPath = cookiesPathOverride || settings.cookiesPath
  if (cookiesPath && existsSync(cookiesPath)) {
    return ['--cookies', cookiesPath]
  }
  if (settings.cookiesBrowser) {
    return ['--cookies-from-browser', settings.cookiesBrowser]
  }
  return []
}

/**
 * yt-dlp -g でストリームURLを直接取得
 */
async function resolveStreamUrl(
  videoId: string,
  cookiesPath?: string
): Promise<{ videoUrl: string; audioUrl: string; isLive: boolean }> {
  const ytdlp = getYtdlpPath()
  const cookieArgs = getCookieArgs(cookiesPath)
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`

  debugLog(`resolveStreamUrl: videoId=${videoId}`)
  return new Promise((resolve, reject) => {
    // まず --dump-json で is_live を確認
    debugLog(`exec: --dump-json ${ytUrl}`)
    execFile(
      ytdlp,
      [...cookieArgs, '--js-runtimes', 'node', '--dump-json', '--no-playlist', ytUrl],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          debugLog(`dump-json error: ${err.message}`)
          return reject(err)
        }
        try {
          const info = JSON.parse(stdout)
          const isLive = !!info.is_live
          debugLog(`dump-json ok: isLive=${isLive} title=${info.title}`)

          // ライブ配信: HLS manifest URL を直接使用
          if (isLive) {
            const manifestUrl = info.manifest_url || ''
            debugLog(`live: manifestUrl=${manifestUrl ? 'yes' : 'no'}`)
            if (manifestUrl) {
              return resolve({ videoUrl: manifestUrl, audioUrl: '', isLive: true })
            }
            const hlsFormats = (info.formats || []).filter(
              (f: Record<string, unknown>) => f.protocol === 'hls' || f.protocol === 'm3u8_native'
            )
            if (hlsFormats.length > 0) {
              const best = hlsFormats[hlsFormats.length - 1]
              debugLog(`live fallback: format=${best.format_id} url=${(best.url as string).substring(0, 80)}...`)
              return resolve({ videoUrl: best.url as string, audioUrl: '', isLive: true })
            }
          }

          // VOD: protocol=https の直接URLを -g で取得
          const fmtArg = 'bv[ext=mp4][height<=1080][protocol=https]+ba[ext=m4a][protocol=https]/b[ext=mp4][protocol=https]/bv*[height<=1080]+ba/b'
          debugLog(`exec: -g -f '${fmtArg}'`)
          execFile(
            ytdlp,
            [...cookieArgs, '--js-runtimes', 'node', '-g', '-f', fmtArg, '--no-playlist', ytUrl],
            { encoding: 'utf8', maxBuffer: 1024 * 1024 },
            (err2, stdout2, stderr2) => {
              if (err2) {
                debugLog(`-g error: ${err2.message} stderr: ${stderr2}`)
                return reject(err2)
              }
              const urls = stdout2.trim().split('\n').filter(Boolean)
              debugLog(`-g ok: ${urls.length} URLs returned`)
              urls.forEach((u, i) => debugLog(`  url[${i}]: ${u.substring(0, 100)}...`))
              if (urls.length === 0) return reject(new Error('No stream URL returned'))
              resolve({
                videoUrl: urls[0],
                audioUrl: urls.length > 1 ? urls[1] : '',
                isLive: false
              })
            }
          )
        } catch (e) {
          debugLog(`parse error: ${e}`)
          reject(e)
        }
      }
    )
  })
}

export function prepareStream(videoId: string, cookiesPath?: string): string {
  const existing = jobs.get(videoId)
  if (existing && existing.status !== 'error') {
    return `http://127.0.0.1:${proxyPort}/stream/${encodeURIComponent(videoId)}`
  }

  const job: StreamJob = {
    videoId,
    videoUrl: '',
    audioUrl: '',
    status: 'resolving',
    error: null,
    isLive: false,
    contentLength: 0
  }
  jobs.set(videoId, job)

  resolveStreamUrl(videoId, cookiesPath)
    .then(({ videoUrl, audioUrl, isLive }) => {
      job.videoUrl = videoUrl
      job.audioUrl = audioUrl
      job.isLive = isLive
      job.status = 'ready'
      debugLog(`resolved ${videoId}: live=${isLive} hasAudio=${!!audioUrl} videoUrl=${videoUrl.substring(0, 80)}`)
      console.log(`[stream] resolved ${videoId}: live=${isLive} hasAudio=${!!audioUrl}`)
    })
    .catch((err) => {
      job.error = String(err)
      job.status = 'error'
      console.error(`[stream] resolve error ${videoId}:`, err)
    })

  return `http://127.0.0.1:${proxyPort}/stream/${encodeURIComponent(videoId)}`
}

/**
 * リモートURLへのリバースプロキシ
 */
function proxyRequest(
  targetUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
  redirectCount = 0
): void {
  if (redirectCount > 5) {
    res.writeHead(502, { 'Access-Control-Allow-Origin': '*' })
    res.end('Too many redirects')
    return
  }

  debugLog(`proxyRequest: ${targetUrl.substring(0, 100)}... range=${req.headers.range || 'none'}`)
  const parsed = new URL(targetUrl)
  const isHttps = parsed.protocol === 'https:'
  const requestFn = isHttps ? httpsRequest : httpRequest

  const headers: Record<string, string> = {
    'Referer': 'https://www.youtube.com',
    'Origin': 'https://www.youtube.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  }

  // Range ヘッダーを転送
  if (req.headers.range) {
    headers['Range'] = req.headers.range
  }

  const proxyReq = requestFn(
    targetUrl,
    { method: 'GET', headers },
    (proxyRes) => {
      // リダイレクト対応 (301, 302, 303, 307, 308)
      const status = proxyRes.statusCode || 200
      if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && proxyRes.headers.location) {
        const redirectUrl = proxyRes.headers.location
        debugLog(`redirect ${status} → ${redirectUrl.substring(0, 100)}...`)
        proxyRes.resume() // drain the response
        proxyRequest(redirectUrl, req, res, redirectCount + 1)
        return
      }

      const resHeaders: Record<string, string | number> = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        'Cache-Control': 'no-cache'
      }

      if (proxyRes.headers['content-type']) {
        resHeaders['Content-Type'] = proxyRes.headers['content-type']
      } else {
        resHeaders['Content-Type'] = 'video/mp4'
      }
      if (proxyRes.headers['content-length']) {
        resHeaders['Content-Length'] = proxyRes.headers['content-length']
      }
      if (proxyRes.headers['content-range']) {
        resHeaders['Content-Range'] = proxyRes.headers['content-range']
      }
      if (proxyRes.headers['accept-ranges']) {
        resHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges']
      } else {
        resHeaders['Accept-Ranges'] = 'bytes'
      }

      debugLog(`proxyRes: status=${status} ct=${proxyRes.headers['content-type']} cl=${proxyRes.headers['content-length']}`)
      res.writeHead(status, resHeaders)
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err) => {
    console.error('[proxy] request error:', err)
    if (!res.headersSent) {
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*' })
      res.end(`Proxy error: ${err.message}`)
    }
  })

  proxyReq.end()
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  debugLog(`handleRequest: ${req.method} ${req.url}`)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Max-Age': '86400'
    })
    res.end()
    return
  }

  // ステータスAPI
  const statusMatch = (req.url || '').match(/^\/status\/([^?]+)/)
  if (statusMatch) {
    const vid = decodeURIComponent(statusMatch[1])
    const job = jobs.get(vid)
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    })
    if (!job) {
      res.end(JSON.stringify({ status: 'not_found' }))
      return
    }
    // resolving → WatchView には "downloading" として見せる
    // ready → 即座に "ready"
    const mappedStatus = job.status === 'resolving' ? 'downloading' : job.status
    res.end(JSON.stringify({
      status: mappedStatus,
      progress: job.status === 'resolving' ? 50 : 100,
      speed: '',
      eta: '',
      dlSize: '',
      fileSize: 0,
      error: job.error,
      hasAudio: !!job.audioUrl,
      isLive: job.isLive,
      manifestUrl: job.isLive ? job.videoUrl : ''
    }))
    return
  }

  // ストリーム配信
  const streamMatch = (req.url || '').match(/^\/stream\/([^?]+)/)
  if (!streamMatch) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const videoId = decodeURIComponent(streamMatch[1])
  const job = jobs.get(videoId)

  if (!job) {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' })
    res.end('Stream not found')
    return
  }

  if (job.error) {
    res.writeHead(500, { 'Access-Control-Allow-Origin': '*' })
    res.end(`Stream error: ${job.error}`)
    return
  }

  if (job.status === 'resolving') {
    res.writeHead(202, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Retry-After': '1'
    })
    res.end(JSON.stringify({ status: 'resolving', progress: 50 }))
    return
  }

  // ?type=audio の場合は音声ストリームをプロキシ
  const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${proxyPort}`)
  const streamType = reqUrl.searchParams.get('type')

  if (streamType === 'audio' && job.audioUrl) {
    proxyRequest(job.audioUrl, req, res)
    return
  }

  // ready → リバースプロキシ (映像)
  proxyRequest(job.videoUrl, req, res)
}

export function getProxyPort(): number {
  return proxyPort
}

export async function startStreamProxy(): Promise<number> {
  if (server) return proxyPort
  return new Promise((resolve, reject) => {
    server = createServer(handleRequest)
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      proxyPort = typeof addr === 'object' && addr ? addr.port : 0
      console.log(`[stream-proxy] listening on port ${proxyPort}`)
      resolve(proxyPort)
    })
  })
}

export function stopStreamProxy(): void {
  server?.close()
  server = null
  jobs.clear()
}
