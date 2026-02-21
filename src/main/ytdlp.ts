import { spawn, execFile } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, appendFileSync, mkdirSync } from 'fs'
import { prepareStream } from './stream-proxy'
import { getSettings } from './store/settings'

function debugLog(msg: string): void {
  try {
    const logPath = join(app.getPath('userData'), 'download-debug.log')
    const ts = new Date().toISOString()
    appendFileSync(logPath, `[${ts}] ${msg}\n`, 'utf8')
  } catch { /* ignore */ }
}

export interface DownloadOptions {
  url: string
  outputPath: string
  format?: string
  quality?: string
  audioOnly?: boolean
  subtitles?: boolean
  embedThumbnail?: boolean
  customArgs?: string[]
  cookiesPath?: string
}

export interface DownloadProgress {
  percent: number
  speed: string
  eta: string
  size: string
  status: 'downloading' | 'merging' | 'completed' | 'error'
}

export interface VideoInfo {
  id: string
  title: string
  duration: number
  thumbnail: string
  formats: VideoFormat[]
  subtitles: Record<string, unknown>
  chapters?: Chapter[]
}

export interface VideoFormat {
  formatId: string
  ext: string
  quality: string
  filesize?: number
  vcodec?: string
  acodec?: string
}

export interface Chapter {
  startTime: number
  endTime: number
  title: string
}

function getYtdlpPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'yt-dlp.exe')
  }
  return join(__dirname, '..', '..', 'resources', 'yt-dlp.exe')
}

function getFfmpegPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ffmpeg.exe')
  }
  return join(__dirname, '..', '..', 'resources', 'ffmpeg.exe')
}

function getAria2cPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', 'aria2c.exe')
  }
  return join(__dirname, '..', '..', 'resources', 'bin', 'aria2c.exe')
}

function isAria2Available(): boolean {
  try {
    return existsSync(getAria2cPath())
  } catch {
    return false
  }
}

/**
 * クッキー引数を生成
 * 優先順位: cookiesPath(ファイル) > cookiesBrowser(ブラウザ) > なし
 */
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

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const ytdlp = getYtdlpPath()
    const cookieArgs = getCookieArgs()
    execFile(
      ytdlp,
      [...cookieArgs, '--js-runtimes', 'node', '--dump-json', '--no-playlist', url],
      { encoding: 'utf8' },
      (err, stdout) => {
        if (err) return reject(err)
        try {
          const info = JSON.parse(stdout)
          resolve({
            id: info.id,
            title: info.title,
            duration: info.duration,
            thumbnail: info.thumbnail,
            formats: (info.formats || []).map((f: Record<string, unknown>) => ({
              formatId: f.format_id as string,
              ext: f.ext as string,
              quality: (f.format_note as string) || `${f.height}p`,
              filesize: f.filesize as number,
              vcodec: f.vcodec as string,
              acodec: f.acodec as string
            })),
            subtitles: info.subtitles || {},
            chapters: (info.chapters || []).map((c: Record<string, unknown>) => ({
              startTime: c.start_time as number,
              endTime: c.end_time as number,
              title: c.title as string
            }))
          })
        } catch (e) {
          reject(e)
        }
      }
    )
  })
}

function buildFormatArgs(options: DownloadOptions): string[] {
  const args: string[] = []
  const fmt = options.format || 'mp4'
  const qual = options.quality || 'best'

  if (options.audioOnly || qual === 'audio' || ['mp3', 'opus', 'flac'].includes(fmt)) {
    args.push('-f', 'bestaudio')
    args.push('-x', '--audio-format', ['mp3', 'opus', 'flac'].includes(fmt) ? fmt : 'mp3')
  } else if (qual === 'best') {
    if (fmt === 'mp4') {
      args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best')
    } else if (fmt === 'mkv') {
      args.push('-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mkv')
    } else if (fmt === 'webm') {
      args.push('-f', 'bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best')
    } else {
      args.push('-f', 'bestvideo+bestaudio/best')
    }
  } else {
    const height = parseInt(qual, 10)
    if (fmt === 'mp4') {
      args.push(
        '-f',
        `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best`
      )
    } else if (fmt === 'mkv') {
      args.push(
        '-f',
        `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
        '--merge-output-format',
        'mkv'
      )
    } else if (fmt === 'webm') {
      args.push(
        '-f',
        `bestvideo[height<=${height}][ext=webm]+bestaudio[ext=webm]/best[height<=${height}]`
      )
    } else {
      args.push('-f', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`)
    }
  }

  return args
}

export function downloadVideo(
  options: DownloadOptions,
  onProgress: (progress: DownloadProgress) => void,
  onComplete: (path: string) => void,
  onError: (error: Error) => void
): () => void {
  const ytdlp = getYtdlpPath()
  const ffmpeg = getFfmpegPath()
  const cookieArgs = getCookieArgs(options.cookiesPath)

  // Ensure output directory exists
  try {
    if (options.outputPath && !existsSync(options.outputPath)) {
      mkdirSync(options.outputPath, { recursive: true })
    }
  } catch (e) {
    debugLog('mkdir error: ' + String(e))
  }

  const args: string[] = [
    ...cookieArgs,
    '--js-runtimes', 'node',
    '--ffmpeg-location', ffmpeg,
    '--newline', '--progress',
    '-o', join(options.outputPath, '%(title)s.%(ext)s')
  ]

  args.push(...buildFormatArgs(options))

  // 高速モード: aria2c を外部ダウンローダーとして使用
  const settings = getSettings()
  if (settings.fastMode && isAria2Available()) {
    const aria2cPath = getAria2cPath()
    args.push(
      '--external-downloader', aria2cPath,
      '--external-downloader-args',
      'aria2c:-x 16 -s 16 -k 1M --file-allocation=none --console-log-level=warn'
    )
  }

  if (options.subtitles) {
    args.push('--write-subs', '--embed-subs', '--sub-langs', 'ja,en')
  }
  if (options.embedThumbnail) {
    args.push('--embed-thumbnail')
  }
  if (options.customArgs?.length) {
    args.push(...options.customArgs)
  }
  args.push(options.url)

  debugLog(`spawn: ${ytdlp} ${args.join(' ')}`)
  console.log('[yt-dlp] spawn:', ytdlp, args.join(' '))
  const proc = spawn(ytdlp, args)
  let killed = false
  const stderrChunks: string[] = []

  proc.stdout.on('data', (data: Buffer) => {
    const lines = data.toString().split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      debugLog(`stdout: ${line}`)
      console.log('[yt-dlp stdout]', line)
      // yt-dlp 標準プログレス (複数パターン対応)
      const match = line.match(
        /\[download\]\s+(\d+[\d.]*)%\s+of\s+~?\s*([\d.]+\s*\S+)\s+at\s+([\d.]+\s*\S+)\s+ETA\s+(\S+)/
      )
      if (match) {
        onProgress({
          percent: parseFloat(match[1]),
          size: match[2].trim(),
          speed: match[3].trim(),
          eta: match[4],
          status: 'downloading'
        })
        continue
      }
      // yt-dlp "of ~SIZE" の別パターン (速度なし)
      const match2 = line.match(/\[download\]\s+(\d+[\d.]*)%\s+of/)
      if (match2) {
        onProgress({
          percent: parseFloat(match2[1]),
          size: '',
          speed: '',
          eta: '',
          status: 'downloading'
        })
        continue
      }
      // aria2 プログレスパターン
      const a = line.match(
        /\[#\S+\s+[\d.]+\S+\/([\d.]+\S+)\((\d+)%\).*?DL:([\d.]+\S+).*?ETA:(\S+)\]/
      )
      if (a) {
        onProgress({
          percent: parseInt(a[2]),
          size: a[1],
          speed: a[3],
          eta: a[4],
          status: 'downloading'
        })
        continue
      }
      if (line.includes('[Merger]') || line.includes('[ffmpeg]')) {
        onProgress({ percent: 99, speed: '', eta: '', size: '', status: 'merging' })
      }
      // "Destination:" でファイル名表示 = ダウンロード開始の合図
      if (line.includes('Destination:') || line.includes('[download]')) {
        onProgress({ percent: 0, speed: '', eta: '', size: '', status: 'downloading' })
      }
    }
  })

  proc.stderr.on('data', (data: Buffer) => {
    const msg = data.toString()
    debugLog(`stderr: ${msg}`)
    console.error('[yt-dlp stderr]', msg)
    stderrChunks.push(msg)
    // aria2 プログレス (stderrに出ることがある)
    const a = msg.match(
      /\[#\S+\s+[\d.]+\S+\/([\d.]+\S+)\((\d+)%\).*?DL:([\d.]+\S+).*?ETA:(\S+)\]/
    )
    if (a) {
      onProgress({
        percent: parseInt(a[2]),
        size: a[1],
        speed: a[3],
        eta: a[4],
        status: 'downloading'
      })
    }
  })

  proc.on('close', (code) => {
    debugLog(`close: code=${code} killed=${killed}`)
    if (!killed) {
      if (code === 0) {
        onComplete(options.outputPath)
      } else {
        const stderrText = stderrChunks.join('').trim()
        const errMsg = stderrText
          ? `yt-dlp failed (code ${code}): ${stderrText.slice(-500)}`
          : `yt-dlp exited with code ${code}`
        debugLog(`error: ${errMsg}`)
        onError(new Error(errMsg))
      }
    }
  })

  proc.on('error', (err) => {
    debugLog(`spawn error: ${err.message}`)
    console.error('[yt-dlp spawn error]', err)
    onError(err)
  })

  return () => { killed = true; proc.kill() }
}

export async function getStreamUrl(
  videoId: string,
  cookiesPath?: string
): Promise<{
  proxyUrl: string
  title: string
  thumbnail: string
  duration: number
  description: string
  author: string
  authorId: string
  viewCount: number
  chapters: Chapter[]
  captions: Array<{ languageCode: string; label: string; url: string }>
}> {
  return new Promise((resolve, reject) => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`
    const cookieArgs = getCookieArgs(cookiesPath)
    const args = [...cookieArgs, '--js-runtimes', 'node', '--dump-json', '--no-playlist', ytUrl]

    execFile(
      getYtdlpPath(),
      args,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err)
        try {
          const info = JSON.parse(stdout)
          const proxyUrl = prepareStream(videoId, cookiesPath)

          // 字幕データを抽出（手動字幕 > 自動字幕）
          const captions: Array<{ languageCode: string; label: string; url: string }> = []
          const subs = info.subtitles || {}
          const autoSubs = info.automatic_captions || {}
          const seen = new Set<string>()

          // 字幕トラックからURLを選択（vtt > json3 > その他）
          function pickBestTrack(arr: Array<{ ext: string; url: string }>): { ext: string; url: string } | undefined {
            return arr.find(t => t.ext === 'vtt') || arr.find(t => t.ext === 'json3') || arr[0]
          }

          // 手動字幕を優先
          for (const [lang, tracks] of Object.entries(subs)) {
            const arr = tracks as Array<{ ext: string; url: string }>
            const best = pickBestTrack(arr)
            if (best?.url) {
              captions.push({ languageCode: lang, label: lang, url: best.url })
              seen.add(lang)
            }
          }
          // 自動字幕（手動がない言語のみ、ja/enのみ）
          for (const lang of ['ja', 'en']) {
            if (seen.has(lang)) continue
            const tracks = autoSubs[lang]
            if (!tracks) continue
            const arr = tracks as Array<{ ext: string; url: string }>
            const best = pickBestTrack(arr)
            if (best?.url) {
              captions.push({ languageCode: lang, label: `${lang} (auto)`, url: best.url })
            }
          }

          resolve({
            proxyUrl,
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            description: info.description || '',
            author: info.uploader || info.channel || '',
            authorId: info.channel_id || info.uploader_id || '',
            viewCount: info.view_count || 0,
            chapters: (info.chapters || []).map((c: Record<string, unknown>) => ({
              startTime: c.start_time as number,
              endTime: c.end_time as number,
              title: c.title as string
            })),
            captions
          })
        } catch (e) {
          reject(e)
        }
      }
    )
  })
}
