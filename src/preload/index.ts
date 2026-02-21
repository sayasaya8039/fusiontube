import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  youtube: {
    search: (query: string, page?: number) =>
      ipcRenderer.invoke('youtube:search', query, page),
    getVideo: (videoId: string) =>
      ipcRenderer.invoke('youtube:video', videoId),
    getChannel: (channelId: string) =>
      ipcRenderer.invoke('youtube:channel', channelId),
    getChannelVideos: (channelId: string, page?: number) =>
      ipcRenderer.invoke('youtube:channelVideos', channelId, page),
    getTrending: (region?: string) =>
      ipcRenderer.invoke('youtube:trending', region),
    getSubscriptionFeed: (ids: string[]) =>
      ipcRenderer.invoke('youtube:subscriptionFeed', ids),
    setInstance: (url: string) =>
      ipcRenderer.invoke('youtube:setInstance', url),
    getInstance: () =>
      ipcRenderer.invoke('youtube:getInstance'),
    getPlaylist: (playlistId: string, page?: number) =>
      ipcRenderer.invoke('youtube:playlist', playlistId, page),
    extractPlaylistId: (url: string) =>
      ipcRenderer.invoke('youtube:extractPlaylistId', url),
    getStreamUrl: (videoId: string, cookiesPath?: string) =>
      ipcRenderer.invoke('youtube:streamUrl', videoId, cookiesPath),
    login: () =>
      ipcRenderer.invoke('youtube:login'),
    isLoggedIn: () =>
      ipcRenderer.invoke('youtube:isLoggedIn'),
    homeFeed: () =>
      ipcRenderer.invoke('youtube:homeFeed'),
    userPlaylists: () =>
      ipcRenderer.invoke('youtube:userPlaylists'),
    playlistVideos: (playlistId: string) =>
      ipcRenderer.invoke('youtube:playlistVideos', playlistId)
  },
  download: {
    video: (options: unknown) =>
      ipcRenderer.invoke('download:video', options),
    cancel: (id: string) =>
      ipcRenderer.invoke('download:cancel', id),
    getVideoInfo: (url: string) =>
      ipcRenderer.invoke('download:videoInfo', url),
    getQueue: () =>
      ipcRenderer.invoke('download:queue'),
    onProgress: (id: string, callback: (progress: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => callback(data)
      ipcRenderer.on(`download:progress:${id}`, handler)
      return () => ipcRenderer.removeListener(`download:progress:${id}`, handler)
    },
    onComplete: (id: string, callback: (path: string) => void) => {
      ipcRenderer.once(`download:complete:${id}`, (_, path) => callback(path as string))
    },
    onError: (id: string, callback: (err: string) => void) => {
      ipcRenderer.once(`download:error:${id}`, (_, err) => callback(err as string))
    }
  },
  shell: {
    showItemInFolder: (path: string) =>
      ipcRenderer.invoke('shell:showItemInFolder', path),
    openPath: (path: string) =>
      ipcRenderer.invoke('shell:openPath', path)
  },
  ai: {
    summarize: (text: string, apiKey: string, model: string) =>
      ipcRenderer.invoke('ai:summarize', text, apiKey, model),
    getCaptions: (url: string) =>
      ipcRenderer.invoke('ai:getCaptions', url),
    generatePlaylistQueries: (
      title: string, author: string, description: string,
      recentHistory: string[], apiKey: string, model: string
    ) =>
      ipcRenderer.invoke('ai:generatePlaylistQueries', title, author, description, recentHistory, apiKey, model)
  },
  sponsorblock: {
    getSegments: (videoId: string, categories: string[]) =>
      ipcRenderer.invoke('sponsorblock:getSegments', videoId, categories)
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: unknown) => ipcRenderer.invoke('settings:set', partial),
    addSubscription: (sub: unknown) => ipcRenderer.invoke('settings:addSubscription', sub),
    removeSubscription: (id: string) => ipcRenderer.invoke('settings:removeSubscription', id),
    addHistory: (entry: unknown) => ipcRenderer.invoke('settings:addHistory', entry),
    clearHistory: () => ipcRenderer.invoke('settings:clearHistory'),
    addWatchLater: (videoId: string) => ipcRenderer.invoke('settings:addWatchLater', videoId),
    removeWatchLater: (videoId: string) => ipcRenderer.invoke('settings:removeWatchLater', videoId),
    addYouTubePlaylist: (playlist: unknown) => ipcRenderer.invoke('settings:addYouTubePlaylist', playlist),
    removeYouTubePlaylist: (playlistId: string) => ipcRenderer.invoke('settings:removeYouTubePlaylist', playlistId)
  },
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (theme: string) => ipcRenderer.invoke('theme:set', theme),
    onUpdated: (callback: (isDark: boolean) => void) => {
      const handler = (_: unknown, isDark: boolean) => callback(isDark)
      ipcRenderer.on('theme:updated', handler)
      return () => ipcRenderer.removeListener('theme:updated', handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
