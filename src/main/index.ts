import { app, shell, BrowserWindow, ipcMain, nativeTheme, session } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerDownloadHandlers } from './ipc/download'
import { registerYoutubeHandlers } from './ipc/youtube'
import { registerAIHandlers } from './ipc/ai'
import { registerSponsorBlockHandlers } from './ipc/sponsorblock'
import { registerSettingsHandlers, getSettings } from './store/settings'
import { startStreamProxy, stopStreamProxy } from './stream-proxy'
import { isLoggedIn, getHomeFeed, getUserPlaylists, getPlaylistVideos } from './youtube-data'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
      contextIsolation: true,
      devTools: true
    }
  })

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.googlevideo.com/*', '*://manifest.googlevideo.com/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://www.youtube.com'
      details.requestHeaders['Origin'] = 'https://www.youtube.com'
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.on('did-fail-load', (_, code, desc, url) => {
    console.error(`did-fail-load: ${code} ${desc} ${url}`)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * cookies を Netscape cookies.txt 形式に変換して保存
 */
function cookiesToNetscapeFormat(cookies: Electron.Cookie[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# https://curl.se/docs/http-cookies.html', '']
  for (const c of cookies) {
    const domain = c.domain?.startsWith('.') ? c.domain : `.${c.domain}`
    const flag = 'TRUE'
    const path = c.path || '/'
    const secure = c.secure ? 'TRUE' : 'FALSE'
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0
    const name = c.name
    const value = c.value
    lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expiry}\t${name}\t${value}`)
  }
  return lines.join('\n')
}

function getCookiesFilePath(): string {
  const dir = app.getPath('userData')
  return join(dir, 'cookies.txt')
}

/**
 * cookies.txt からCookieを読み込んで persist:youtube-login セッションに復元
 */
async function restoreCookiesFromFile(): Promise<void> {
  const cookiesPath = getCookiesFilePath()
  if (!existsSync(cookiesPath)) {
    console.log('[cookie-restore] cookies.txt not found, skipping')
    return
  }
  try {
    const content = readFileSync(cookiesPath, 'utf8')
    const lines = content.split('\n').filter(l => l && !l.startsWith('#'))
    const loginSession = session.fromPartition('persist:youtube-login')
    let restored = 0
    for (const line of lines) {
      const parts = line.split('\t')
      if (parts.length < 7) continue
      const [domain, , path, secure, expiry, name, value] = parts
      try {
        const url = `https://${domain.replace(/^\./, '')}${path}`
        const expirationDate = parseInt(expiry, 10) || Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
        await loginSession.cookies.set({
          url,
          name,
          value,
          domain,
          path,
          secure: secure === 'TRUE',
          httpOnly: true,
          expirationDate
        })
        restored++
      } catch { /* 個別Cookie復元失敗は無視 */ }
    }
    console.log(`[cookie-restore] Restored ${restored}/${lines.length} cookies from cookies.txt`)
  } catch (e) {
    console.error('[cookie-restore] Error:', e)
  }
}

/**
 * persist:youtube-login セッションのCookieを cookies.txt に保存
 */
async function saveCookiesToFile(): Promise<void> {
  try {
    const loginSession = session.fromPartition('persist:youtube-login')
    const allCookies = await loginSession.cookies.get({})
    const ytCookies = allCookies.filter(c =>
      c.domain?.includes('youtube.com') ||
      c.domain?.includes('google.com') ||
      c.domain?.includes('.google.') ||
      c.domain?.includes('accounts.google')
    )
    if (ytCookies.length === 0) return
    const cookiesPath = getCookiesFilePath()
    const content = cookiesToNetscapeFormat(ytCookies)
    writeFileSync(cookiesPath, content, 'utf8')
    console.log(`[cookie-save] Saved ${ytCookies.length} cookies on quit`)
  } catch (e) {
    console.error('[cookie-save] Error:', e)
  }
}

/**
 * YouTubeログインウィンドウを開き、ログイン完了後にcookies.txtを保存
 */
function registerYoutubeLoginHandler(): void {
  ipcMain.handle('youtube:login', async () => {
    return new Promise<{ success: boolean; cookiesPath: string; error?: string }>((resolve) => {
      // ログイン用の独立セッションを使用
      const loginSession = session.fromPartition('persist:youtube-login')

      const loginWin = new BrowserWindow({
        width: 500,
        height: 700,
        parent: mainWindow || undefined,
        modal: true,
        autoHideMenuBar: true,
        title: 'YouTube にログイン',
        webPreferences: {
          session: loginSession,
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      let resolved = false

      // YouTubeのトップページに遷移後、クッキーを確認するタイマー
      let checkTimer: NodeJS.Timeout | null = null

      async function checkLoginStatus(): Promise<void> {
        try {
          const cookies = await loginSession.cookies.get({ domain: '.youtube.com' })
          // SID, HSID, SSID があればログイン済みと判断
          const hasAuth = cookies.some(c => c.name === 'SID') &&
                          cookies.some(c => c.name === 'HSID') &&
                          cookies.some(c => c.name === 'SSID')

          if (hasAuth && !resolved) {
            resolved = true
            if (checkTimer) clearInterval(checkTimer)

            // YouTube + Google のクッキーをすべて取得
            const allCookies = await loginSession.cookies.get({})
            const ytCookies = allCookies.filter(c =>
              c.domain?.includes('youtube.com') ||
              c.domain?.includes('google.com') ||
              c.domain?.includes('.google.') ||
              c.domain?.includes('accounts.google')
            )

            // セッションCookieに1年後の有効期限を強制設定して永続化
            const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
            for (const c of ytCookies) {
              if (!c.expirationDate || c.expirationDate < Date.now() / 1000) {
                try {
                  await loginSession.cookies.set({
                    url: `https://${(c.domain || '').replace(/^\./, '')}${c.path || '/'}`,
                    name: c.name,
                    value: c.value,
                    domain: c.domain || undefined,
                    path: c.path || '/',
                    secure: c.secure,
                    httpOnly: c.httpOnly,
                    sameSite: c.sameSite as 'unspecified' | 'no_restriction' | 'lax' | 'strict' || 'unspecified',
                    expirationDate: oneYearFromNow
                  })
                } catch { /* 個別Cookie設定失敗は無視 */ }
              }
            }
            // 更新されたCookieを再取得して保存
            const updatedCookies = await loginSession.cookies.get({})
            const updatedYtCookies = updatedCookies.filter(c =>
              c.domain?.includes('youtube.com') ||
              c.domain?.includes('google.com') ||
              c.domain?.includes('.google.') ||
              c.domain?.includes('accounts.google')
            )
            const cookiesPath = getCookiesFilePath()
            const content = cookiesToNetscapeFormat(updatedYtCookies)
            writeFileSync(cookiesPath, content, 'utf8')
            console.log(`[youtube:login] Saved ${updatedYtCookies.length} cookies (with expiry) to ${cookiesPath}`)

            loginWin.close()
            resolve({ success: true, cookiesPath })
          }
        } catch (e) {
          console.error('[youtube:login] check error:', e)
        }
      }

      // 2秒ごとにログイン状態を確認
      checkTimer = setInterval(checkLoginStatus, 2000)

      loginWin.on('closed', () => {
        if (checkTimer) clearInterval(checkTimer)
        if (!resolved) {
          resolved = true
          resolve({ success: false, cookiesPath: '', error: 'ログインウィンドウが閉じられました' })
        }
      })

      loginWin.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/')
    })
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.fusiontube.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 起動時にCookieを復元（InnerTube APIより先に実行）
  await restoreCookiesFromFile()

  try {
    const port = await startStreamProxy()
    console.log(`[main] stream proxy started on port ${port}`)
  } catch (err) {
    console.error('[main] stream proxy failed:', err)
  }

  registerDownloadHandlers()
  registerYoutubeHandlers()
  registerAIHandlers()
  registerSponsorBlockHandlers()
  registerSettingsHandlers()
  registerYoutubeLoginHandler()

  // YouTube Data API (InnerTube)
  ipcMain.handle('youtube:isLoggedIn', () => isLoggedIn())
  ipcMain.handle('youtube:homeFeed', () => getHomeFeed())
  ipcMain.handle('youtube:userPlaylists', () => getUserPlaylists())
  ipcMain.handle('youtube:playlistVideos', (_, playlistId: string) => getPlaylistVideos(playlistId))

  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    win?.minimize()
  })
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    win?.close()
  })

  ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors)
  ipcMain.handle('theme:set', (_, theme: 'dark' | 'light' | 'system') => {
    nativeTheme.themeSource = theme
    return nativeTheme.shouldUseDarkColors
  })

  // Shell operations for download file management
  ipcMain.handle('shell:showItemInFolder', (_, path: string) => {
    shell.showItemInFolder(path)
  })
  ipcMain.handle('shell:openPath', async (_, path: string) => {
    return shell.openPath(path)
  })

  // OSテーマ変更時にレンダラーへ通知
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme:updated', nativeTheme.shouldUseDarkColors)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let cookiesSaved = false
app.on('window-all-closed', async () => {
  // 終了前にCookieを保存
  if (!cookiesSaved) {
    cookiesSaved = true
    await saveCookiesToFile()
  }
  stopStreamProxy()
  if (process.platform !== 'darwin') app.quit()
})
