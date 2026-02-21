import { ipcMain, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

export function setupAutoUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('updater:available', info)
  })

  autoUpdater.on('update-not-available', () => {
    win.webContents.send('updater:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('updater:progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('updater:downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    win.webContents.send('updater:error', err.message)
  })

  ipcMain.handle('updater:check', async () => {
    try {
      return await autoUpdater.checkForUpdates()
    } catch (e) {
      return null
    }
  })

  ipcMain.handle('updater:download', async () => {
    return autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })
}
