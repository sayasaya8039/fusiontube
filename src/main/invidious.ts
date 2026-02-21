const INSTANCES = [
  'https://iv.melmac.space',
  'https://invidious.slipfox.xyz',
  'https://invidious.private.coffee',
  'https://invidious.dhusch.de'
]

let currentInstance = INSTANCES[0]

export function setInstance(url: string): void {
  currentInstance = url.replace(/\/$/, '')
}

export function getInstance(): string {
  return currentInstance
}

async function apiGet<T>(path: string, tryFallback = true): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const url = `${currentInstance}/api/v1${path}${separator}hl=ja`
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'FusionTube/1.0' },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return response.json() as T
  } catch (err) {
    // フォールバック: 別インスタンスを試す
    if (tryFallback) {
      const others = INSTANCES.filter(i => i !== currentInstance)
      for (const fallback of others) {
        try {
          const r = await fetch(`${fallback}/api/v1${path}${separator}hl=ja`, {
            headers: { 'User-Agent': 'FusionTube/1.0' },
            signal: AbortSignal.timeout(15000)
          })
          if (r.ok) {
            currentInstance = fallback
            console.log(`Switched to fallback: ${fallback}`)
            return r.json() as T
          }
        } catch {}
      }
    }
    throw err
  }
}

export interface SearchResult {
  type: 'video' | 'channel' | 'playlist'
  videoId?: string
  channelId?: string
  title: string
  author?: string
  authorId?: string
  videoThumbnails?: Array<{ url: string; width: number; height: number; quality: string }>
  publishedText?: string
  published?: number
  viewCount?: number
  lengthSeconds?: number
  description?: string
}

export interface VideoDetails {
  videoId: string
  title: string
  description: string
  author: string
  authorId: string
  viewCount: number
  lengthSeconds: number
  published: number
  videoThumbnails: Array<{ url: string; quality: string }>
  adaptiveFormats: Array<{
    url: string; itag: number; type: string; container: string
    encoding: string; audioQuality?: string; bitrate: number
    size: string; resolution?: string; qualityLabel?: string
  }>
  formatStreams: Array<{
    url: string; itag: number; type: string; quality: string
    container: string; resolution: string; qualityLabel: string
  }>
  captions: Array<{ label: string; languageCode: string; url: string }>
  recommendedVideos: SearchResult[]
  chapters?: Array<{ title: string; startTime: number; endTime: number }>
}

export interface ChannelData {
  authorId: string
  author: string
  description: string
  subscriberCount: number
  authorThumbnails: Array<{ url: string }>
  latestVideos: SearchResult[]
}

export async function search(query: string, page = 1): Promise<SearchResult[]> {
  return apiGet<SearchResult[]>(`/search?q=${encodeURIComponent(query)}&page=${page}&type=all`)
}

export async function getVideo(videoId: string): Promise<VideoDetails> {
  return apiGet<VideoDetails>(`/videos/${videoId}`)
}

export async function getChannel(channelId: string): Promise<ChannelData> {
  return apiGet<ChannelData>(`/channels/${channelId}`)
}

export async function getChannelVideos(channelId: string, page = 1): Promise<SearchResult[]> {
  const data = await apiGet<{ videos: SearchResult[] }>(`/channels/${channelId}/videos?page=${page}`)
  return data.videos || []
}

export async function getSubscriptionFeed(channelIds: string[]): Promise<SearchResult[]> {
  const results = await Promise.allSettled(
    channelIds.slice(0, 20).map(id => getChannelVideos(id, 1))
  )
  return results
    .filter((r): r is PromiseFulfilledResult<SearchResult[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
}

export async function getTrending(region = 'JP'): Promise<SearchResult[]> {
  return apiGet<SearchResult[]>(`/trending?region=${region}&type=default`)
}

export interface PlaylistInfo {
  title: string
  playlistId: string
  author: string
  authorId: string
  description: string
  videoCount: number
  videos: SearchResult[]
}

export async function getPlaylist(playlistId: string, page = 1): Promise<PlaylistInfo> {
  return apiGet<PlaylistInfo>(`/playlists/${playlistId}?page=${page}`)
}

export function extractPlaylistId(url: string): string | null {
  const match = url.match(/[?&]list=([^&]+)/) || url.match(/playlist\?list=([^&]+)/)
  return match?.[1] || null
}
