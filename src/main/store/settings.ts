import { ipcMain, app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface Subscription { channelId: string; channelName: string; thumbnail?: string; subscribedAt?: number }
interface HistoryEntry { videoId: string; title: string; thumbnail?: string; watchedAt: number }
interface LocalPlaylistVideo { videoId: string; title: string; author?: string; thumbnail?: string; lengthSeconds?: number }
interface LocalPlaylist { id: string; name: string; videos: LocalPlaylistVideo[]; createdAt: number }
interface YouTubePlaylist { playlistId: string; title: string; author: string; videoCount: number; addedAt: number }

interface AppSettings {
  invidiousInstance: string
  downloadPath: string
  theme: 'dark' | 'light' | 'system'
  language: string
  sponsorblockEnabled: boolean
  sponsorblockCategories: string[]
  dearrowEnabled: boolean
  autoMaxQuality: boolean
  defaultFormat: string
  concurrentDownloads: number
  externalPlayer: string
  externalPlayerPath: string
  proxyEnabled: boolean
  proxyUrl: string
  aiEnabled: boolean
  aiApiKey: string
  aiModel: string
  cookiesPath: string
  cookiesBrowser: string
  youtubeDataApiKey: string
  fastMode: boolean
  // Enhancer Playback Controls
  defaultPlaybackSpeed: number
  forceDefaultSpeed: boolean
  speedStep: number
  wheelSpeedEnabled: boolean
  wheelSpeedRightClickOnly: boolean
  defaultVolume: number
  forceDefaultVolume: boolean
  volumeBoostLevel: number
  autoVolumeBoost: boolean
  wheelVolumeEnabled: boolean
  wheelVolumeRightClickOnly: boolean
  wheelVolumeStep: number
  subscriptions: Subscription[]
  watchHistory: HistoryEntry[]
  localPlaylists: LocalPlaylist[]
  youtubePlaylists: YouTubePlaylist[]
  watchLater: string[]
}

const defaults: AppSettings = {
  invidiousInstance: 'https://iv.melmac.space',
  downloadPath: join(homedir(), 'Videos', 'FusionTube'),
  theme: 'dark',
  language: 'ja',
  sponsorblockEnabled: true,
  sponsorblockCategories: ['sponsor', 'intro', 'outro', 'selfpromo'],
  dearrowEnabled: true,
  autoMaxQuality: true,
  defaultFormat: 'mp4',
  concurrentDownloads: 3,
  externalPlayer: '',
  externalPlayerPath: '',
  proxyEnabled: false,
  proxyUrl: '',
  aiEnabled: false,
  aiApiKey: '',
  aiModel: 'gemini-3-flash',
  cookiesPath: '',
  cookiesBrowser: '',
  youtubeDataApiKey: '',
  fastMode: false,
  defaultPlaybackSpeed: 1.0,
  forceDefaultSpeed: false,
  speedStep: 0.02,
  wheelSpeedEnabled: true,
  wheelSpeedRightClickOnly: false,
  defaultVolume: 60,
  forceDefaultVolume: true,
  volumeBoostLevel: 2,
  autoVolumeBoost: false,
  wheelVolumeEnabled: true,
  wheelVolumeRightClickOnly: false,
  wheelVolumeStep: 5,
  subscriptions: [],
  watchHistory: [],
  localPlaylists: [],
  youtubePlaylists: [],
  watchLater: []
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): AppSettings {
  try {
    const p = getSettingsPath()
    if (!existsSync(p)) return { ...defaults }
    return { ...defaults, ...JSON.parse(readFileSync(p, 'utf8')) }
  } catch { return { ...defaults } }
}

function saveSettings(s: AppSettings): void {
  try {
    const p = getSettingsPath()
    const dir = p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(p, JSON.stringify(s, null, 2), 'utf8')
  } catch (e) { console.error('Failed to save settings:', e) }
}

let settings = loadSettings()

export function getSettings(): AppSettings {
  return settings
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => settings)

  ipcMain.handle('settings:set', (_, partial: Partial<AppSettings>) => {
    settings = { ...settings, ...partial }
    saveSettings(settings)
    return settings
  })

  ipcMain.handle('settings:addSubscription', (_, sub: Subscription) => {
    if (!settings.subscriptions.find(s => s.channelId === sub.channelId)) {
      settings.subscriptions = [...settings.subscriptions, { ...sub, subscribedAt: Date.now() }]
      saveSettings(settings)
    }
    return settings.subscriptions
  })

  ipcMain.handle('settings:removeSubscription', (_, channelId: string) => {
    settings.subscriptions = settings.subscriptions.filter(s => s.channelId !== channelId)
    saveSettings(settings)
    return settings.subscriptions
  })

  ipcMain.handle('settings:addHistory', (_, entry: { videoId: string; title: string; thumbnail?: string }) => {
    const idx = settings.watchHistory.findIndex(h => h.videoId === entry.videoId)
    const newEntry: HistoryEntry = { ...entry, watchedAt: Date.now() }
    if (idx >= 0) settings.watchHistory[idx] = newEntry
    else settings.watchHistory.unshift(newEntry)
    settings.watchHistory = settings.watchHistory.slice(0, 1000)
    saveSettings(settings)
    return settings.watchHistory
  })

  ipcMain.handle('settings:clearHistory', () => {
    settings.watchHistory = []
    saveSettings(settings)
    return []
  })

  ipcMain.handle('settings:addWatchLater', (_, videoId: string) => {
    if (!settings.watchLater.includes(videoId)) {
      settings.watchLater = [videoId, ...settings.watchLater]
      saveSettings(settings)
    }
    return settings.watchLater
  })

  ipcMain.handle('settings:removeWatchLater', (_, videoId: string) => {
    settings.watchLater = settings.watchLater.filter(id => id !== videoId)
    saveSettings(settings)
    return settings.watchLater
  })

  ipcMain.handle('settings:addYouTubePlaylist', (_, playlist: YouTubePlaylist) => {
    if (!settings.youtubePlaylists.find(p => p.playlistId === playlist.playlistId)) {
      settings.youtubePlaylists = [...settings.youtubePlaylists, { ...playlist, addedAt: Date.now() }]
      saveSettings(settings)
    }
    return settings.youtubePlaylists
  })

  ipcMain.handle('settings:removeYouTubePlaylist', (_, playlistId: string) => {
    settings.youtubePlaylists = settings.youtubePlaylists.filter(p => p.playlistId !== playlistId)
    saveSettings(settings)
    return settings.youtubePlaylists
  })
}
