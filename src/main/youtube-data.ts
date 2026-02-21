/**
 * YouTube InnerTube API を使ってログイン済みユーザーのデータを取得
 * persist:youtube-login セッションの Cookie を利用
 */
import { session, app } from 'electron'
import { createHash } from 'crypto'
import { request as httpsRequest } from 'https'
import { appendFileSync } from 'fs'
import { join } from 'path'

function debugLog(msg: string): void {
  const ts = new Date().toISOString()
  console.log(`[ytdata ${ts}] ${msg}`)
  try {
    let logPath: string
    try {
      logPath = join(app.getPath('userData'), 'ytdata-debug.log')
    } catch {
      logPath = '/tmp/ytdata-debug.log'
    }
    appendFileSync(logPath, `[${ts}] ${msg}\n`, 'utf8')
  } catch { /* ignore */ }
}

const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const CLIENT_VERSION = '2.20260220.00.00'
const ORIGIN = 'https://www.youtube.com'

interface SimpleVideo {
  videoId: string
  title: string
  author: string
  authorId: string
  viewCount: number
  lengthSeconds: number
  publishedText: string
  published: number
  videoThumbnails: Array<{ url: string; quality: string }>
}

interface SimplePlaylist {
  playlistId: string
  title: string
  videoCount: number
  thumbnailUrl: string
}

async function getYouTubeCookies(): Promise<Electron.Cookie[]> {
  const ses = session.fromPartition('persist:youtube-login')
  return ses.cookies.get({ domain: '.youtube.com' })
}

export async function isLoggedIn(): Promise<boolean> {
  try {
    const cookies = await getYouTubeCookies()
    const cookieNames = cookies.map(c => c.name)
    const hasSID = cookieNames.includes('SID')
    const hasHSID = cookieNames.includes('HSID')
    const hasSSID = cookieNames.includes('SSID')
    debugLog(`[isLoggedIn] cookieCount=${cookies.length} SID=${hasSID} HSID=${hasHSID} SSID=${hasSSID}`)
    return hasSID && hasHSID && hasSSID
  } catch (e) {
    debugLog(`[isLoggedIn] error: ${e}`)
    return false
  }
}

function cookieString(cookies: Electron.Cookie[]): string {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

function computeSapiSidHash(sapiSid: string): string {
  const ts = Math.floor(Date.now() / 1000)
  const hash = createHash('sha1').update(`${ts} ${sapiSid} ${ORIGIN}`).digest('hex')
  return `SAPISIDHASH ${ts}_${hash}`
}

async function innertubePost(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cookies = await getYouTubeCookies()
  const cookieStr = cookieString(cookies)
  const sapiSid = cookies.find(c => c.name === 'SAPISID')?.value

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cookie': cookieStr,
    'Origin': ORIGIN,
    'Referer': `${ORIGIN}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'X-Youtube-Client-Name': '1',
    'X-Youtube-Client-Version': CLIENT_VERSION
  }

  if (sapiSid) {
    headers['Authorization'] = computeSapiSidHash(sapiSid)
  }

  const requestBody = JSON.stringify({
    ...body,
    context: {
      client: {
        hl: 'ja',
        gl: 'JP',
        clientName: 'WEB',
        clientVersion: CLIENT_VERSION
      }
    }
  })

  const url = `${ORIGIN}/youtubei/v1/${endpoint}?key=${INNERTUBE_API_KEY}&prettyPrint=false`

  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = httpsRequest({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          debugLog(`[innertubePost] JSON parse error: ${data.substring(0, 500)}`)
          reject(new Error(`JSON parse error: ${data.substring(0, 200)}`))
        }
      })
    })
    req.on('error', (e) => {
      debugLog(`[innertubePost] request error: ${e.message}`)
      reject(e)
    })
    req.write(requestBody)
    req.end()
  })
}

// ---- レスポンスパーサー ----

function extractText(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  const o = obj as Record<string, unknown>
  if (typeof o.content === 'string') return o.content
  if (o.simpleText) return o.simpleText as string
  if (Array.isArray(o.runs)) {
    return (o.runs as Array<{ text: string }>).map(r => r.text).join('')
  }
  return ''
}

function extractNumber(text: string): number {
  // "85万 回視聴" → 850000, "1.2万 回視聴" → 12000
  const manMatch = text.match(/([\d.]+)\s*万/)
  if (manMatch) {
    return Math.round(parseFloat(manMatch[1]) * 10000)
  }
  const clean = text.replace(/[^\d]/g, '')
  return clean ? parseInt(clean, 10) : 0
}

function parseLengthText(text: string): number {
  const parts = text.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

function parseThumbnail(obj: unknown): Array<{ url: string; quality: string }> {
  if (!obj || typeof obj !== 'object') return []
  const o = obj as Record<string, unknown>
  const thumbs = o.thumbnails as Array<{ url: string; width: number }> | undefined
  if (!Array.isArray(thumbs)) return []
  return thumbs.map(t => ({ url: t.url, quality: `${t.width || 0}` }))
}

// ---- lockupViewModel パーサー (新YouTube UI) ----

function parseLockupViewModel(lockup: Record<string, unknown>): SimpleVideo | null {
  const videoId = lockup.contentId as string
  if (!videoId) return null
  const contentType = lockup.contentType as string
  if (contentType && contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null

  // サムネイル
  const contentImage = lockup.contentImage as Record<string, unknown>
  const thumbVM = contentImage?.thumbnailViewModel as Record<string, unknown>
  const thumbImage = thumbVM?.image as Record<string, unknown>
  const thumbSources = thumbImage?.sources as Array<{ url: string; width: number }> | undefined
  const videoThumbnails = (thumbSources || []).map(s => ({ url: s.url, quality: `${s.width || 0}` }))

  // 再生時間 (thumbnailBadgeViewModel内)
  let lengthSeconds = 0
  const overlays = thumbVM?.overlays as Array<Record<string, unknown>> | undefined
  if (overlays) {
    for (const overlay of overlays) {
      const bottomOverlay = overlay.thumbnailBottomOverlayViewModel as Record<string, unknown>
      if (bottomOverlay?.badges) {
        const badges = bottomOverlay.badges as Array<Record<string, unknown>>
        for (const badge of badges) {
          const tbvm = badge.thumbnailBadgeViewModel as Record<string, unknown>
          if (tbvm?.text && typeof tbvm.text === 'string') {
            lengthSeconds = parseLengthText(tbvm.text)
          }
        }
      }
    }
  }

  // メタデータ
  let title = ''
  let author = ''
  let authorId = ''
  let viewCount = 0
  let publishedText = ''

  const metadata = lockup.metadata as Record<string, unknown>
  const lmvm = metadata?.lockupMetadataViewModel as Record<string, unknown>
  if (lmvm) {
    // タイトル
    const titleObj = lmvm.title as Record<string, unknown>
    if (titleObj?.content) {
      title = titleObj.content as string
    }

    // metadataRows からチャンネル名、ビュー数、公開日を取得
    const md = lmvm.metadata as Record<string, unknown>
    const cmvm = md?.contentMetadataViewModel as Record<string, unknown>
    const rows = cmvm?.metadataRows as Array<Record<string, unknown>>
    if (rows) {
      // row[0]: チャンネル名
      if (rows[0]) {
        const parts0 = rows[0].metadataParts as Array<Record<string, unknown>>
        if (parts0?.[0]?.text) {
          const textObj = parts0[0].text as Record<string, unknown>
          author = (textObj.content as string) || ''
          // browseId を探す
          const cmdRuns = textObj.commandRuns as Array<Record<string, unknown>>
          if (cmdRuns?.[0]?.onTap) {
            const onTap = cmdRuns[0].onTap as Record<string, unknown>
            const cmd = onTap.innertubeCommand as Record<string, unknown>
            const browseEp = cmd?.browseEndpoint as Record<string, unknown>
            authorId = (browseEp?.browseId as string) || ''
          }
        }
      }
      // row[1]: ビュー数、公開日
      if (rows[1]) {
        const parts1 = rows[1].metadataParts as Array<Record<string, unknown>>
        if (parts1) {
          for (const part of parts1) {
            const textObj = part.text as Record<string, unknown>
            const content = (textObj?.content as string) || ''
            if (content.includes('回視聴') || content.includes('views') || content.includes('回')) {
              viewCount = extractNumber(content)
            } else if (content) {
              publishedText = content
            }
          }
        }
      }
    }
  }

  return {
    videoId, title, author, authorId, viewCount, lengthSeconds,
    publishedText, published: 0, videoThumbnails
  }
}

// ---- videoRenderer パーサー (旧YouTube UI / プレイリスト) ----

function parseVideoRenderer(renderer: Record<string, unknown>): SimpleVideo | null {
  const videoId = renderer.videoId as string
  if (!videoId) return null

  const title = extractText(renderer.title)
  const ownerText = renderer.ownerText || renderer.shortBylineText
  const author = extractText(ownerText)
  let authorId = ''
  if (ownerText && typeof ownerText === 'object') {
    const runs = (ownerText as Record<string, unknown>).runs as Array<Record<string, unknown>> | undefined
    if (runs?.[0]?.navigationEndpoint) {
      const nav = runs[0].navigationEndpoint as Record<string, unknown>
      const browse = nav.browseEndpoint as Record<string, unknown> | undefined
      authorId = (browse?.browseId as string) || ''
    }
  }

  const viewCountText = extractText(renderer.viewCountText)
  const viewCount = extractNumber(viewCountText)

  const lengthText = extractText(renderer.lengthText)
  const lengthSeconds = parseLengthText(lengthText)

  const publishedText = extractText(renderer.publishedTimeText)
  const thumbnails = parseThumbnail(renderer.thumbnail)

  return {
    videoId, title, author, authorId, viewCount, lengthSeconds,
    publishedText, published: 0, videoThumbnails: thumbnails
  }
}

// ---- playlistVideoRenderer パーサー (プレイリスト内の動画) ----

function parsePlaylistVideoRenderer(renderer: Record<string, unknown>): SimpleVideo | null {
  const videoId = renderer.videoId as string
  if (!videoId) return null

  const title = extractText(renderer.title)
  const shortByline = renderer.shortBylineText
  const author = extractText(shortByline)
  let authorId = ''
  if (shortByline && typeof shortByline === 'object') {
    const runs = (shortByline as Record<string, unknown>).runs as Array<Record<string, unknown>> | undefined
    if (runs?.[0]?.navigationEndpoint) {
      const nav = runs[0].navigationEndpoint as Record<string, unknown>
      const browse = nav.browseEndpoint as Record<string, unknown> | undefined
      authorId = (browse?.browseId as string) || ''
    }
  }

  const lengthText = extractText(renderer.lengthText)
  const lengthSeconds = parseLengthText(lengthText)
  const thumbnails = parseThumbnail(renderer.thumbnail)

  return {
    videoId, title, author, authorId, viewCount: 0, lengthSeconds,
    publishedText: '', published: 0, videoThumbnails: thumbnails
  }
}

// ---- 再帰コレクター ----

function collectVideoRenderers(obj: unknown, results: SimpleVideo[], depth = 0): void {
  if (depth > 20 || !obj || typeof obj !== 'object') return

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectVideoRenderers(item, results, depth + 1)
    }
    return
  }

  const o = obj as Record<string, unknown>

  // 新UI: lockupViewModel
  if (o.lockupViewModel) {
    const v = parseLockupViewModel(o.lockupViewModel as Record<string, unknown>)
    if (v) results.push(v)
    return // lockupViewModel の中を再帰する必要はない
  }

  // 旧UI: videoRenderer
  if (o.videoRenderer) {
    const v = parseVideoRenderer(o.videoRenderer as Record<string, unknown>)
    if (v) results.push(v)
  }

  // プレイリスト内: playlistVideoRenderer
  if (o.playlistVideoRenderer) {
    const v = parsePlaylistVideoRenderer(o.playlistVideoRenderer as Record<string, unknown>)
    if (v) results.push(v)
  }

  // richItemRenderer の content 内を探索
  if (o.richItemRenderer) {
    const content = (o.richItemRenderer as Record<string, unknown>).content
    if (content) collectVideoRenderers(content, results, depth + 1)
  }

  for (const key of Object.keys(o)) {
    if (key === 'videoRenderer' || key === 'richItemRenderer' ||
        key === 'lockupViewModel' || key === 'playlistVideoRenderer') continue
    const val = o[key]
    if (val && typeof val === 'object') {
      collectVideoRenderers(val, results, depth + 1)
    }
  }
}

function collectPlaylistRenderers(obj: unknown, results: SimplePlaylist[], depth = 0): void {
  if (depth > 20 || !obj || typeof obj !== 'object') return

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectPlaylistRenderers(item, results, depth + 1)
    }
    return
  }

  const o = obj as Record<string, unknown>

  // 旧UI
  if (o.gridPlaylistRenderer || o.playlistRenderer) {
    const r = (o.gridPlaylistRenderer || o.playlistRenderer) as Record<string, unknown>
    const playlistId = r.playlistId as string
    if (playlistId) {
      const title = extractText(r.title)
      const countText = extractText(r.videoCountText || r.videoCountShortText)
      const videoCount = extractNumber(countText)
      const thumbs = parseThumbnail(r.thumbnail || r.thumbnailRenderer)
      let thumbnailUrl = thumbs[0]?.url || ''
      if (!thumbnailUrl && r.thumbnailRenderer) {
        const tr = r.thumbnailRenderer as Record<string, unknown>
        const pte = tr.playlistVideoThumbnailRenderer || tr.playlistCustomThumbnailRenderer
        if (pte) {
          const t2 = parseThumbnail((pte as Record<string, unknown>).thumbnail)
          thumbnailUrl = t2[0]?.url || ''
        }
      }
      results.push({ playlistId, title, videoCount, thumbnailUrl })
    }
  }

  // 新UI: lockupViewModel で contentType が PLAYLIST のもの
  if (o.lockupViewModel) {
    const lockup = o.lockupViewModel as Record<string, unknown>
    const contentType = lockup.contentType as string
    if (contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
      const playlistId = lockup.contentId as string
      if (playlistId) {
        let title = ''
        let videoCount = 0
        let thumbnailUrl = ''

        // サムネイル
        const contentImage = lockup.contentImage as Record<string, unknown>
        const thumbVM = contentImage?.thumbnailViewModel as Record<string, unknown>
        const thumbImage = thumbVM?.image as Record<string, unknown>
        const thumbSources = thumbImage?.sources as Array<{ url: string }> | undefined
        if (thumbSources?.[0]) thumbnailUrl = thumbSources[0].url

        // collectionThumbnailViewModel もチェック
        if (!thumbnailUrl && contentImage?.collectionThumbnailViewModel) {
          const ctvm = contentImage.collectionThumbnailViewModel as Record<string, unknown>
          const primary = ctvm.primaryThumbnail as Record<string, unknown>
          const pThumbVM = primary?.thumbnailViewModel as Record<string, unknown>
          const pImage = pThumbVM?.image as Record<string, unknown>
          const pSources = pImage?.sources as Array<{ url: string }> | undefined
          if (pSources?.[0]) thumbnailUrl = pSources[0].url
        }

        // サムネイルオーバーレイから動画数を取得（バッジ表示）
        const overlays = thumbVM?.overlays as Array<Record<string, unknown>> | undefined
        if (overlays) {
          for (const overlay of overlays) {
            const bottomOverlay = overlay.thumbnailBottomOverlayViewModel as Record<string, unknown>
            if (bottomOverlay?.badges) {
              const badges = bottomOverlay.badges as Array<Record<string, unknown>>
              for (const badge of badges) {
                const tbvm = badge.thumbnailBadgeViewModel as Record<string, unknown>
                if (tbvm?.text && typeof tbvm.text === 'string') {
                  const n = extractNumber(tbvm.text)
                  if (n > 0) videoCount = n
                }
              }
            }
            // inlineTextOverlay からも取得
            const inlineOverlay = overlay.thumbnailHoverOverlayViewModel as Record<string, unknown>
            if (inlineOverlay?.text) {
              const t = extractText(inlineOverlay.text)
              const n = extractNumber(t)
              if (n > 0 && videoCount === 0) videoCount = n
            }
          }
        }

        // collectionThumbnailViewModel のオーバーレイからも動画数を取得
        if (videoCount === 0 && contentImage?.collectionThumbnailViewModel) {
          const ctvm = contentImage.collectionThumbnailViewModel as Record<string, unknown>
          const primary = ctvm.primaryThumbnail as Record<string, unknown>
          const pThumbVM = primary?.thumbnailViewModel as Record<string, unknown>
          const pOverlays = pThumbVM?.overlays as Array<Record<string, unknown>> | undefined
          if (pOverlays) {
            for (const overlay of pOverlays) {
              const bottomOverlay = overlay.thumbnailBottomOverlayViewModel as Record<string, unknown>
              if (bottomOverlay?.badges) {
                const badges = bottomOverlay.badges as Array<Record<string, unknown>>
                for (const badge of badges) {
                  const tbvm = badge.thumbnailBadgeViewModel as Record<string, unknown>
                  if (tbvm?.text && typeof tbvm.text === 'string') {
                    const n = extractNumber(tbvm.text)
                    if (n > 0) videoCount = n
                  }
                }
              }
            }
          }
        }

        // メタデータ
        const metadata = lockup.metadata as Record<string, unknown>
        const lmvm = metadata?.lockupMetadataViewModel as Record<string, unknown>
        if (lmvm) {
          const titleObj = lmvm.title as Record<string, unknown>
          if (titleObj?.content) title = titleObj.content as string

          const md = lmvm.metadata as Record<string, unknown>
          const cmvm = md?.contentMetadataViewModel as Record<string, unknown>
          const rows = cmvm?.metadataRows as Array<Record<string, unknown>>
          if (rows && videoCount === 0) {
            for (const row of rows) {
              const parts = row.metadataParts as Array<Record<string, unknown>>
              if (parts) {
                for (const part of parts) {
                  const textObj = part.text as Record<string, unknown>
                  const content = (textObj?.content as string) || ''
                  // 「12本の動画」「動画 12 件」「12 videos」等
                  if (content.includes('本') || content.includes('動画') || content.includes('video')) {
                    const n = extractNumber(content)
                    if (n > 0) videoCount = n
                  }
                }
              }
            }
          }

          // メタデータで見つからない場合、全metadataRowsから数字を探す
          if (rows && videoCount === 0) {
            for (const row of rows) {
              const parts = row.metadataParts as Array<Record<string, unknown>>
              if (parts) {
                for (const part of parts) {
                  const textObj = part.text as Record<string, unknown>
                  const content = (textObj?.content as string) || ''
                  const n = extractNumber(content)
                  if (n > 0 && videoCount === 0) videoCount = n
                }
              }
            }
          }
        }

        // accessibilityText からフォールバック
        if (videoCount === 0) {
          const accText = (lockup.accessibilityText as string) || ''
          if (accText) {
            const m = accText.match(/(\d+)\s*本/)
            if (m) videoCount = parseInt(m[1], 10)
            if (videoCount === 0) {
              const m2 = accText.match(/(\d+)\s*video/)
              if (m2) videoCount = parseInt(m2[1], 10)
            }
          }
        }

        // count=0の場合、生データをダンプして原因調査
        if (videoCount === 0) {
          const contentImage = lockup.contentImage as Record<string, unknown>
          const thumbVM2 = (contentImage?.thumbnailViewModel || contentImage?.collectionThumbnailViewModel) as Record<string, unknown>
          debugLog(`[playlist-debug] ${playlistId} "${title}" overlays=${JSON.stringify(thumbVM2?.overlays || 'none').slice(0, 500)}`)
          debugLog(`[playlist-debug] ${playlistId} metadata=${JSON.stringify(lmvm?.metadata || 'none').slice(0, 500)}`)
          debugLog(`[playlist-debug] ${playlistId} accessibilityText=${(lockup.accessibilityText as string) || 'none'}`)
          debugLog(`[playlist-debug] ${playlistId} rendererContext=${JSON.stringify(lockup.rendererContext || 'none').slice(0, 300)}`)
        }
        debugLog(`[playlist] ${playlistId} "${title}" count=${videoCount}`)
        results.push({ playlistId, title, videoCount, thumbnailUrl })
      }
    }
    return
  }

  for (const key of Object.keys(o)) {
    if (key === 'gridPlaylistRenderer' || key === 'playlistRenderer' || key === 'lockupViewModel') continue
    const val = o[key]
    if (val && typeof val === 'object') {
      collectPlaylistRenderers(val, results, depth + 1)
    }
  }
}

// ---- 公開API ----

export async function getHomeFeed(): Promise<SimpleVideo[]> {
  const data = await innertubePost('browse', { browseId: 'FEwhat_to_watch' })
  const videos: SimpleVideo[] = []
  collectVideoRenderers(data, videos)
  debugLog(`[homeFeed] parsed ${videos.length} videos`)
  return videos.slice(0, 40)
}

function extractContinuationToken(obj: unknown, depth = 0): string | null {
  if (depth > 15 || !obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const token = extractContinuationToken(item, depth + 1)
      if (token) return token
    }
    return null
  }
  const o = obj as Record<string, unknown>
  // nextContinuationData / continuationEndpoint
  if (o.nextContinuationData) {
    const ncd = o.nextContinuationData as Record<string, unknown>
    if (ncd.continuation) return ncd.continuation as string
  }
  if (o.continuationCommand) {
    const cc = o.continuationCommand as Record<string, unknown>
    if (cc.token) return cc.token as string
  }
  if (o.token && typeof o.token === 'string' && (o as Record<string, unknown>).trigger) {
    return o.token as string
  }
  for (const key of Object.keys(o)) {
    if (key === 'nextContinuationData' || key === 'continuationCommand') continue
    const val = o[key]
    if (val && typeof val === 'object') {
      const token = extractContinuationToken(val, depth + 1)
      if (token) return token
    }
  }
  return null
}

/**
 * FElibraryの棚構造をダンプ: タイトル、browseEndpoint、セクション種別
 */
function dumpLibrarySections(data: unknown): void {
  try {
    const d = data as Record<string, unknown>
    const contents = d.contents as Record<string, unknown>
    if (!contents) return
    const tcbr = contents.twoColumnBrowseResultsRenderer as Record<string, unknown>
    if (!tcbr) {
      debugLog(`[dump] no twoColumnBrowseResultsRenderer, contents keys: ${Object.keys(contents).join(', ')}`)
      return
    }
    const tabs = tcbr.tabs as Array<Record<string, unknown>>
    if (!tabs) {
      debugLog(`[dump] no tabs in twoColumnBrowseResultsRenderer, keys: ${Object.keys(tcbr).join(', ')}`)
      return
    }
    for (let ti = 0; ti < tabs.length; ti++) {
      const tab = tabs[ti]
      const tabR = (tab.tabRenderer || tab.expandableTabRenderer) as Record<string, unknown>
      if (!tabR) continue
      const tabTitle = extractText(tabR.title) || `tab${ti}`
      debugLog(`[dump] tab[${ti}]: "${tabTitle}"`)
      const tabContent = tabR.content as Record<string, unknown>
      if (!tabContent) continue
      // richGridRenderer or sectionListRenderer
      const renderer = (tabContent.richGridRenderer || tabContent.sectionListRenderer) as Record<string, unknown>
      if (!renderer) {
        debugLog(`[dump]   content keys: ${Object.keys(tabContent).join(', ')}`)
        continue
      }
      const items = (renderer.contents || renderer.items) as Array<Record<string, unknown>>
      if (!items) continue
      for (let si = 0; si < Math.min(items.length, 20); si++) {
        const section = items[si]
        const sectionKeys = Object.keys(section)
        // richSectionRenderer, itemSectionRenderer, shelfRenderer
        const sRenderer = (section.richSectionRenderer || section.itemSectionRenderer || section.shelfRenderer) as Record<string, unknown>
        if (sRenderer) {
          const sContent = sRenderer.content as Record<string, unknown>
          if (sContent) {
            const innerKeys = Object.keys(sContent)
            // richShelfRenderer に title がある
            for (const ik of innerKeys) {
              const inner = sContent[ik] as Record<string, unknown>
              if (inner && typeof inner === 'object') {
                const shelfTitle = extractText(inner.title) || ''
                const headerText = inner.header ? extractShelfHeaderInfo(inner.header) : ''
                debugLog(`[dump]   section[${si}] ${ik}: title="${shelfTitle}" header="${headerText}"`)
                // browseEndpoint を探す
                const be = extractBrowseEndpointFromObj(inner.header || inner)
                if (be) {
                  debugLog(`[dump]     browseEndpoint: browseId=${be.browseId} params=${(be.params as string || '').slice(0, 50)}`)
                }
              }
            }
          }
        } else {
          debugLog(`[dump]   section[${si}] keys: ${sectionKeys.join(', ')}`)
        }
      }
    }
  } catch (e) {
    debugLog(`[dump] error: ${e}`)
  }
}

function extractShelfHeaderInfo(header: unknown): string {
  if (!header || typeof header !== 'object') return ''
  const h = header as Record<string, unknown>
  // 各種headerRenderer
  for (const key of Object.keys(h)) {
    const hr = h[key] as Record<string, unknown>
    if (hr && typeof hr === 'object') {
      const title = extractText(hr.title) || ''
      return `${key}:"${title}"`
    }
  }
  return JSON.stringify(header).slice(0, 100)
}

/**
 * FElibraryレスポンス内のプレイリスト棚の「すべて表示」browseEndpointを探す
 */
function findPlaylistBrowseEndpoint(obj: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 20 || !obj || typeof obj !== 'object') return null

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = findPlaylistBrowseEndpoint(item, depth + 1)
      if (result) return result
    }
    return null
  }

  const o = obj as Record<string, unknown>

  // richShelfRenderer / shelfRenderer のヘッダーにbrowseEndpoint があるパターン
  const shelf = (o.richShelfRenderer || o.shelfRenderer) as Record<string, unknown> | undefined
  if (shelf) {
    const shelfTitle = extractText(shelf.title) || ''
    // プレイリスト関連の棚を特定
    if (shelfTitle.includes('プレイリスト') || shelfTitle.toLowerCase().includes('playlist')) {
      debugLog(`[findBrowse] found playlist shelf: "${shelfTitle}"`)
      // ヘッダーにbrowseEndpointがあるか
      const endpoint = extractBrowseEndpointFromObj(shelf)
      if (endpoint) return endpoint
    }
  }

  // lockupViewModel のセクションリスト内の browseEndpoint
  if (o.pageHeaderViewModel || o.chipCloudChipRenderer) {
    // チップ（タブ）にプレイリスト用があるか
    const text = extractText(o.text || o.title) || ''
    if (text.includes('プレイリスト') || text.toLowerCase().includes('playlist')) {
      const nav = o.navigationEndpoint as Record<string, unknown>
      if (nav?.browseEndpoint) {
        return nav.browseEndpoint as Record<string, unknown>
      }
    }
  }

  for (const key of Object.keys(o)) {
    const val = o[key]
    if (val && typeof val === 'object') {
      const result = findPlaylistBrowseEndpoint(val, depth + 1)
      if (result) return result
    }
  }
  return null
}

function extractBrowseEndpointFromObj(obj: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 10 || !obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = extractBrowseEndpointFromObj(item, depth + 1)
      if (r) return r
    }
    return null
  }
  const o = obj as Record<string, unknown>
  if (o.browseEndpoint) {
    const be = o.browseEndpoint as Record<string, unknown>
    if (be.browseId && be.params) return be
  }
  // headerRenderer や endpoint 内を探す
  for (const key of ['headerRenderer', 'endpoint', 'navigationEndpoint', 'title', 'header']) {
    if (o[key] && typeof o[key] === 'object') {
      const r = extractBrowseEndpointFromObj(o[key], depth + 1)
      if (r) return r
    }
  }
  return null
}

/**
 * FElibraryレスポンスからユーザーのチャンネルIDを抽出
 */
function extractChannelId(data: unknown, depth = 0): string | null {
  if (depth > 15 || !data || typeof data !== 'object') return null
  if (Array.isArray(data)) {
    for (const item of data) {
      const r = extractChannelId(item, depth + 1)
      if (r) return r
    }
    return null
  }
  const o = data as Record<string, unknown>
  // browseEndpoint で UC で始まる browseId を探す
  if (o.browseEndpoint) {
    const be = o.browseEndpoint as Record<string, unknown>
    const bid = be.browseId as string
    if (bid && bid.startsWith('UC') && bid.length > 20) return bid
  }
  // vanityChannelUrl や channelUrl からも
  if (typeof o.externalChannelId === 'string' && (o.externalChannelId as string).startsWith('UC')) {
    return o.externalChannelId as string
  }
  for (const key of Object.keys(o)) {
    if (key === 'responseContext') continue // レスポンスメタデータはスキップ
    const val = o[key]
    if (val && typeof val === 'object') {
      const r = extractChannelId(val, depth + 1)
      if (r) return r
    }
  }
  return null
}

/**
 * ユーザーチャンネルのプレイリストタブからプレイリスト一覧を取得
 */
async function getChannelPlaylists(channelId: string): Promise<SimplePlaylist[]> {
  // プレイリストタブ: params = "EglwbGF5bGlzdHPyBgQKAkIA" (base64 encoded playlists tab)
  const data = await innertubePost('browse', {
    browseId: channelId,
    params: 'EglwbGF5bGlzdHPyBgQKAkIA'
  })

  const playlists: SimplePlaylist[] = []
  collectPlaylistRenderers(data, playlists)
  debugLog(`[channelPlaylists] page1: ${playlists.length} playlists`)

  // continuation で追加取得
  let contToken = extractContinuationToken(data)
  let page = 2
  while (contToken && page <= 10) {
    try {
      const contData = await innertubePost('browse', { continuation: contToken })
      const before = playlists.length
      collectPlaylistRenderers(contData, playlists)
      const added = playlists.length - before
      debugLog(`[channelPlaylists] page${page}: +${added}`)
      if (added === 0) break
      contToken = extractContinuationToken(contData)
      page++
    } catch (e) {
      debugLog(`[channelPlaylists] continuation error: ${e}`)
      break
    }
  }
  return playlists
}

export async function getUserPlaylists(): Promise<SimplePlaylist[]> {
  const allPlaylists: SimplePlaylist[] = []
  const seenIds = new Set<string>()

  // 1回目: FElibrary（後で見る、高評価 を含む基本リスト）
  const feData = await innertubePost('browse', { browseId: 'FElibrary' })
  collectPlaylistRenderers(feData, allPlaylists)
  debugLog(`[playlists] FElibrary: ${allPlaylists.length} playlists`)
  for (const p of allPlaylists) seenIds.add(p.playlistId)

  // 2回目: FEplaylist_aggregation（/feed/playlists 相当、全プレイリスト一覧）
  try {
    const paData = await innertubePost('browse', { browseId: 'FEplaylist_aggregation' })
    const paKeys = Object.keys(paData as Record<string, unknown>)
    debugLog(`[playlists] FEplaylist_aggregation top keys: ${paKeys.join(', ')}`)
    dumpLibrarySections(paData)
    const paPlaylists: SimplePlaylist[] = []
    collectPlaylistRenderers(paData, paPlaylists)
    const newFromPA = paPlaylists.filter(p => !seenIds.has(p.playlistId))
    for (const p of newFromPA) { seenIds.add(p.playlistId); allPlaylists.push(p) }
    debugLog(`[playlists] FEplaylist_aggregation: ${paPlaylists.length} found, ${newFromPA.length} new (total: ${allPlaylists.length})`)

    // continuation でさらに取得
    let contToken = extractContinuationToken(paData)
    let page = 2
    while (contToken && page <= 10) {
      try {
        const contData = await innertubePost('browse', { continuation: contToken })
        const pagePL: SimplePlaylist[] = []
        collectPlaylistRenderers(contData, pagePL)
        const newP = pagePL.filter(p => !seenIds.has(p.playlistId))
        if (newP.length === 0) break
        for (const p of newP) { seenIds.add(p.playlistId); allPlaylists.push(p) }
        debugLog(`[playlists] PA page${page}: +${newP.length} (total: ${allPlaylists.length})`)
        contToken = extractContinuationToken(contData)
        page++
      } catch { break }
    }
  } catch (e) {
    debugLog(`[playlists] FEplaylist_aggregation failed: ${e}`)
  }

  // 3回目: チャンネルプレイリストタブ（フォールバック）
  if (allPlaylists.length <= 15) {
    const channelId = extractChannelId(feData)
    if (channelId) {
      debugLog(`[playlists] trying channel playlists: ${channelId}`)
      try {
        const channelPlaylists = await getChannelPlaylists(channelId)
        const newOnes = channelPlaylists.filter(p => !seenIds.has(p.playlistId))
        for (const p of newOnes) { seenIds.add(p.playlistId); allPlaylists.push(p) }
        debugLog(`[playlists] channel tab: +${newOnes.length} (total: ${allPlaylists.length})`)
      } catch (e) {
        debugLog(`[playlists] channel playlists error: ${e}`)
      }
    }
  }

  debugLog(`[playlists] total before count fetch: ${allPlaylists.length}`)

  // 全プレイリストの正確なカウントをVLエンドポイントから取得
  // （lockupViewModelのカウントはサムネイル数を誤認するため信頼できない）
  const countTargets = allPlaylists.filter(p => p.playlistId !== 'WL' && p.playlistId !== 'LL')
  debugLog(`[playlists] fetching accurate count for ${countTargets.length} playlists`)

  // 5件ずつバッチ処理（YouTube APIへの負荷を制限）
  for (let i = 0; i < countTargets.length; i += 5) {
    const batch = countTargets.slice(i, i + 5)
    await Promise.all(batch.map(async (p) => {
      try {
        const plData = await innertubePost('browse', { browseId: `VL${p.playlistId}` })
        const count = extractPlaylistVideoCount(plData)
        if (count > 0) p.videoCount = count
        debugLog(`[playlists] ${p.playlistId} "${p.title}" count=${count}`)
      } catch (e) {
        debugLog(`[playlists] count error ${p.playlistId}: ${e}`)
      }
    }))
  }

  debugLog(`[playlists] final: ${allPlaylists.length} playlists`)

  // 「後で見る」と「高評価」を先頭に固定表示
  const special: SimplePlaylist[] = []
  const rest: SimplePlaylist[] = []
  for (const p of allPlaylists) {
    if (p.playlistId === 'WL' || p.playlistId === 'LL') special.push(p)
    else rest.push(p)
  }
  return [...special, ...rest]
}

/**
 * VLプレイリストページのヘッダーから動画数を抽出（構造的パース）
 */
function extractPlaylistVideoCount(data: unknown): number {
  if (!data || typeof data !== 'object') return 0
  const d = data as Record<string, unknown>

  // 方法1: header → playlistHeaderRenderer → numVideosText / stats
  const header = d.header as Record<string, unknown>
  if (header) {
    const phr = header.playlistHeaderRenderer as Record<string, unknown>
    if (phr) {
      // numVideosText: {"runs": [{"text": "12"}]} or simpleText
      const nvt = extractText(phr.numVideosText)
      if (nvt) {
        const n = extractNumber(nvt)
        if (n > 0) {
          debugLog(`[countExtract] numVideosText: "${nvt}" → ${n}`)
          return n
        }
      }
      // stats: [{"runs":[{"text":"12本の動画"}]}, ...]
      const stats = phr.stats as Array<unknown>
      if (Array.isArray(stats)) {
        for (const stat of stats) {
          const t = extractText(stat)
          if (t && (t.includes('本') || t.includes('video') || /^\d+$/.test(t.replace(/[,.\s]/g, '')))) {
            const n = extractNumber(t)
            if (n > 0) {
              debugLog(`[countExtract] stats: "${t}" → ${n}`)
              return n
            }
          }
        }
      }
      // byline: 動画数が含まれることがある
      const byline = phr.byline as Record<string, unknown>
      if (byline) {
        const bt = extractText(byline)
        if (bt) {
          const n = extractNumber(bt)
          if (n > 0) {
            debugLog(`[countExtract] byline: "${bt}" → ${n}`)
            return n
          }
        }
      }
    }

    // 新UI: pageHeaderRenderer
    const pageHeader = header.pageHeaderRenderer as Record<string, unknown>
    if (pageHeader) {
      const phContent = pageHeader.content as Record<string, unknown>
      if (phContent) {
        // pageHeaderViewModel → description/metadata に動画数
        const phvm = phContent.pageHeaderViewModel as Record<string, unknown>
        if (phvm) {
          const desc = phvm.description as Record<string, unknown>
          if (desc) {
            const dt = extractText(desc)
            if (dt) {
              const n = extractNumber(dt)
              if (n > 0) {
                debugLog(`[countExtract] pageHeader desc: "${dt}" → ${n}`)
                return n
              }
            }
          }
          const md = phvm.metadata as Record<string, unknown>
          if (md) {
            const mt = extractText(md)
            if (mt) {
              const n = extractNumber(mt)
              if (n > 0) {
                debugLog(`[countExtract] pageHeader metadata: "${mt}" → ${n}`)
                return n
              }
            }
          }
        }
      }
    }
  }

  // 方法2: sidebar → playlistSidebarRenderer → items → stats
  const sidebar = d.sidebar as Record<string, unknown>
  if (sidebar) {
    const psr = sidebar.playlistSidebarRenderer as Record<string, unknown>
    if (psr) {
      const items = psr.items as Array<Record<string, unknown>>
      if (items) {
        for (const item of items) {
          const primary = item.playlistSidebarPrimaryInfoRenderer as Record<string, unknown>
          if (primary?.stats) {
            const stats = primary.stats as Array<unknown>
            for (const stat of stats) {
              const t = extractText(stat)
              if (t) {
                const n = extractNumber(t)
                if (n > 0) {
                  debugLog(`[countExtract] sidebar stats: "${t}" → ${n}`)
                  return n
                }
              }
            }
          }
        }
      }
    }
  }

  // 方法3: レスポンス全体をJSON文字列化してパターンマッチ（最終手段）
  const json = JSON.stringify(data).slice(0, 80000)
  const regexPatterns = [
    /"numVideosText"[^}]*?"(?:simpleText|text)":\s*"([^"]*\d+[^"]*)"/,
    /"videoCount":\s*"?(\d+)"?/,
    /"videoCountText"[^}]*?"(?:simpleText|text)":\s*"([^"]*\d+[^"]*)"/
  ]
  for (const pat of regexPatterns) {
    const m = json.match(pat)
    if (m) {
      const n = extractNumber(m[1])
      if (n > 0) {
        debugLog(`[countExtract] regex fallback: "${m[0].slice(0, 60)}" → ${n}`)
        return n
      }
    }
  }

  // 見つからない場合、生データの構造をダンプ
  const headerKeys = header ? Object.keys(header) : []
  debugLog(`[countExtract] NOT FOUND. header keys: ${headerKeys.join(', ')}, sidebar: ${!!sidebar}`)
  if (header) {
    for (const k of headerKeys) {
      const v = header[k] as Record<string, unknown>
      if (v && typeof v === 'object') {
        debugLog(`[countExtract]   header.${k} keys: ${Object.keys(v).join(', ')}`)
      }
    }
  }
  return 0
}

export async function getPlaylistVideos(playlistId: string): Promise<SimpleVideo[]> {
  const allVideos: SimpleVideo[] = []
  const seenIds = new Set<string>()

  const data = await innertubePost('browse', {
    browseId: `VL${playlistId}`
  })

  // playlistVideoRenderer のみ収集（videoRenderer はおすすめ動画を含むため使わない）
  collectPlaylistVideoRenderers(data, allVideos, seenIds)
  debugLog(`[playlistVideos] ${playlistId} page1: ${allVideos.length} videos`)

  // playlistVideoListRenderer 内の continuation のみ取得（おすすめ動画のcontinuationは無視）
  let contToken = extractPlaylistContinuation(data)
  let page = 2
  while (contToken && page <= 20) {
    try {
      const contData = await innertubePost('browse', { continuation: contToken })
      const before = allVideos.length
      collectPlaylistVideoRenderers(contData, allVideos, seenIds)
      const added = allVideos.length - before
      if (added === 0) break
      debugLog(`[playlistVideos] ${playlistId} page${page}: +${added} (total: ${allVideos.length})`)
      contToken = extractPlaylistContinuation(contData)
      page++
    } catch (e) {
      debugLog(`[playlistVideos] ${playlistId} continuation error: ${e}`)
      break
    }
  }

  debugLog(`[playlistVideos] ${playlistId} final: ${allVideos.length} videos`)
  return allVideos
}

/**
 * playlistVideoListRenderer 内の continuation token のみを抽出
 * おすすめ動画やその他セクションの continuation は無視する
 */
function extractPlaylistContinuation(obj: unknown, depth = 0): string | null {
  if (depth > 20 || !obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = extractPlaylistContinuation(item, depth + 1)
      if (r) return r
    }
    return null
  }
  const o = obj as Record<string, unknown>

  // playlistVideoListRenderer を見つけたら、その中の continuations だけ探す
  if (o.playlistVideoListRenderer) {
    const pvlr = o.playlistVideoListRenderer as Record<string, unknown>
    const continuations = pvlr.continuations as Array<Record<string, unknown>>
    if (continuations) {
      for (const cont of continuations) {
        const ncd = cont.nextContinuationData as Record<string, unknown>
        if (ncd?.continuation) return ncd.continuation as string
      }
    }
    // contents の末尾に continuationItemRenderer がある場合
    const contents = pvlr.contents as Array<Record<string, unknown>>
    if (contents) {
      for (const item of contents) {
        if (item.continuationItemRenderer) {
          const cir = item.continuationItemRenderer as Record<string, unknown>
          const ep = cir.continuationEndpoint as Record<string, unknown>
          if (ep) {
            const cc = ep.continuationCommand as Record<string, unknown>
            if (cc?.token) return cc.token as string
          }
        }
      }
    }
    return null // playlistVideoListRenderer 内にないなら null
  }

  // continuationItems 内の playlistVideoRenderer があるか確認
  // (continuation responseの場合、onResponseReceivedActions にプレイリスト動画が直接来る)
  if (o.onResponseReceivedActions) {
    const actions = o.onResponseReceivedActions as Array<Record<string, unknown>>
    for (const action of actions) {
      const appendItems = action.appendContinuationItemsAction as Record<string, unknown>
      if (appendItems?.continuationItems) {
        const items = appendItems.continuationItems as Array<Record<string, unknown>>
        // playlistVideoRenderer が含まれるなら、この continuation 内の次トークンを探す
        const hasPlaylistVideo = items.some(i => !!i.playlistVideoRenderer)
        if (hasPlaylistVideo) {
          for (const item of items) {
            if (item.continuationItemRenderer) {
              const cir = item.continuationItemRenderer as Record<string, unknown>
              const ep = cir.continuationEndpoint as Record<string, unknown>
              if (ep) {
                const cc = ep.continuationCommand as Record<string, unknown>
                if (cc?.token) return cc.token as string
              }
            }
          }
        }
      }
    }
    return null
  }

  for (const key of Object.keys(o)) {
    const val = o[key]
    if (val && typeof val === 'object') {
      const r = extractPlaylistContinuation(val, depth + 1)
      if (r) return r
    }
  }
  return null
}

/**
 * playlistVideoListRenderer 内の playlistVideoRenderer のみを収集
 * レスポンス全体ではなく、プレイリスト動画リスト内に限定する
 */
function collectPlaylistVideoRenderers(obj: unknown, results: SimpleVideo[], seenIds: Set<string>, depth = 0): void {
  if (depth > 20 || !obj || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    for (const item of obj) collectPlaylistVideoRenderers(item, results, seenIds, depth + 1)
    return
  }
  const o = obj as Record<string, unknown>

  // playlistVideoListRenderer を見つけたら、その contents 内の playlistVideoRenderer のみ収集
  if (o.playlistVideoListRenderer) {
    const pvlr = o.playlistVideoListRenderer as Record<string, unknown>
    const contents = pvlr.contents as Array<Record<string, unknown>>
    if (contents) {
      for (const item of contents) {
        if (item.playlistVideoRenderer) {
          addPlaylistVideo(item.playlistVideoRenderer as Record<string, unknown>, results, seenIds)
        }
      }
    }
    return // この中だけ見る、他のセクションは無視
  }

  // continuation response: onResponseReceivedActions → appendContinuationItemsAction
  if (o.onResponseReceivedActions) {
    const actions = o.onResponseReceivedActions as Array<Record<string, unknown>>
    for (const action of actions) {
      const append = action.appendContinuationItemsAction as Record<string, unknown>
      if (append?.continuationItems) {
        const items = append.continuationItems as Array<Record<string, unknown>>
        // playlistVideoRenderer があるブロックのみ
        for (const item of items) {
          if (item.playlistVideoRenderer) {
            addPlaylistVideo(item.playlistVideoRenderer as Record<string, unknown>, results, seenIds)
          }
        }
      }
    }
    return
  }

  // 再帰的に playlistVideoListRenderer を探す（ただし他のRendererには入らない）
  for (const key of Object.keys(o)) {
    const val = o[key]
    if (val && typeof val === 'object') {
      collectPlaylistVideoRenderers(val, results, seenIds, depth + 1)
    }
  }
}

function addPlaylistVideo(pvr: Record<string, unknown>, results: SimpleVideo[], seenIds: Set<string>): void {
  const videoId = pvr.videoId as string
  if (!videoId || seenIds.has(videoId)) return
  seenIds.add(videoId)
  const title = extractText(pvr.title) || ''
  const author = extractText(pvr.shortBylineText) || ''
  const lengthText = extractText(pvr.lengthText) || ''
  const lengthSeconds = parseDuration(lengthText)
  const thumbs = parseThumbnail(pvr.thumbnail)
  results.push({
    videoId,
    title,
    author,
    authorId: '',
    viewCount: 0,
    lengthSeconds,
    publishedText: '',
    published: 0,
    videoThumbnails: thumbs
  })
}

function parseDuration(text: string): number {
  if (!text) return 0
  const parts = text.split(':').map(p => parseInt(p, 10))
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}
