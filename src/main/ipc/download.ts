import { ipcMain, BrowserWindow, app } from 'electron'
import { downloadVideo, getVideoInfo, DownloadOptions } from '../ytdlp'
import { appendFileSync } from 'fs'
import { join } from 'path'

function debugLog(msg: string): void {
  try {
    const logPath = join(app.getPath('userData'), 'download-debug.log')
    const ts = new Date().toISOString()
    appendFileSync(logPath, `[${ts}] [ipc] ${msg}\n`, 'utf8')
  } catch { /* ignore */ }
}

interface DownloadJob {
  id: string
  cancel: () => void
  status: 'queued' | 'downloading' | 'completed' | 'error'
}

const downloadJobs = new Map<string, DownloadJob>()

export function registerDownloadHandlers(): void {
  ipcMain.handle('download:video', async (event, options: DownloadOptions & { id: string }) => {
    const { id, ...dlOptions } = options
    const win = BrowserWindow.fromWebContents(event.sender)
    const logMsg = `start id=${id} url=${dlOptions.url} path=${dlOptions.outputPath} format=${dlOptions.format} quality=${dlOptions.quality} cookies=${dlOptions.cookiesPath || 'none'}`
    console.log(`[download] ${logMsg}`)
    debugLog(logMsg)

    return new Promise<string>((resolve, reject) => {
      const cancel = downloadVideo(
        dlOptions,
        (progress) => {
          win?.webContents.send(`download:progress:${id}`, progress)
        },
        (path) => {
          console.log(`[download] complete id=${id}`)
          downloadJobs.delete(id)
          win?.webContents.send(`download:complete:${id}`, path)
          resolve(path)
        },
        (err) => {
          console.error(`[download] error id=${id}:`, err.message)
          downloadJobs.delete(id)
          win?.webContents.send(`download:error:${id}`, err.message)
          reject(err)
        }
      )

      downloadJobs.set(id, { id, cancel, status: 'downloading' })
    })
  })

  ipcMain.handle('download:cancel', (_, id: string) => {
    const job = downloadJobs.get(id)
    if (job) {
      job.cancel()
      downloadJobs.delete(id)
      return true
    }
    return false
  })

  ipcMain.handle('download:videoInfo', async (_, url: string) => {
    return getVideoInfo(url)
  })

  ipcMain.handle('download:queue', () => {
    return Array.from(downloadJobs.entries()).map(([id, job]) => ({
      id,
      status: job.status
    }))
  })
}
