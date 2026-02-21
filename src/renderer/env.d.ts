/// <reference types="vite/client" />

interface Window {
  api: {
    window: {
      minimize: () => void
      maximize: () => void
      close: () => void
    }
    youtube: {
      search: (query: string, page?: number) => Promise<unknown[]>
      getVideo: (videoId: string) => Promise<unknown>
      getChannel: (channelId: string) => Promise<unknown>
      getChannelVideos: (channelId: string, page?: number) => Promise<unknown[]>
      getTrending: (region?: string) => Promise<unknown[]>
      getSubscriptionFeed: (ids: string[]) => Promise<unknown[]>
      setInstance: (url: string) => Promise<string>
      getInstance: () => Promise<string>
      getPlaylist: (playlistId: string, page?: number) => Promise<unknown>
      extractPlaylistId: (url: string) => Promise<string | null>
      getStreamUrl: (videoId: string, cookiesPath?: string) => Promise<unknown>
    }
    download: {
      video: (options: unknown) => Promise<string>
      cancel: (id: string) => Promise<boolean>
      getVideoInfo: (url: string) => Promise<unknown>
      getQueue: () => Promise<unknown[]>
      onProgress: (id: string, callback: (progress: unknown) => void) => () => void
      onComplete: (id: string, callback: (path: string) => void) => void
      onError: (id: string, callback: (err: string) => void) => void
    }
    ai: {
      summarize: (text: string, apiKey: string, model: string) => Promise<string>
      getCaptions: (url: string) => Promise<string>
    }
    sponsorblock: {
      getSegments: (videoId: string, categories: string[]) => Promise<Array<{ category: string; segment: [number, number] }>>
    }
    settings: {
      get: () => Promise<unknown>
      set: (partial: unknown) => Promise<unknown>
      addSubscription: (sub: unknown) => Promise<unknown[]>
      removeSubscription: (id: string) => Promise<unknown[]>
      addHistory: (entry: unknown) => Promise<unknown[]>
      clearHistory: () => Promise<unknown[]>
      addWatchLater: (videoId: string) => Promise<string[]>
      removeWatchLater: (videoId: string) => Promise<string[]>
    }
    theme: {
      get: () => Promise<boolean>
      set: (theme: string) => void
    }
  }
}
