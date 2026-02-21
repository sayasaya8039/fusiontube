import { ipcMain } from 'electron'
import * as Invidious from '../invidious'
import { getStreamUrl } from '../ytdlp'

export function registerYoutubeHandlers(): void {
  ipcMain.handle('youtube:search', async (_, query: string, page?: number) => {
    return Invidious.search(query, page)
  })

  ipcMain.handle('youtube:video', async (_, videoId: string) => {
    return Invidious.getVideo(videoId)
  })

  ipcMain.handle('youtube:channel', async (_, channelId: string) => {
    return Invidious.getChannel(channelId)
  })

  ipcMain.handle('youtube:channelVideos', async (_, channelId: string, page?: number) => {
    return Invidious.getChannelVideos(channelId, page)
  })

  ipcMain.handle('youtube:trending', async (_, region?: string) => {
    return Invidious.getTrending(region)
  })

  ipcMain.handle('youtube:subscriptionFeed', async (_, channelIds: string[]) => {
    return Invidious.getSubscriptionFeed(channelIds)
  })

  ipcMain.handle('youtube:setInstance', (_, url: string) => {
    Invidious.setInstance(url)
    return Invidious.getInstance()
  })

  ipcMain.handle('youtube:getInstance', () => {
    return Invidious.getInstance()
  })

  ipcMain.handle('youtube:playlist', async (_, playlistId: string, page?: number) => {
    return Invidious.getPlaylist(playlistId, page)
  })

  ipcMain.handle('youtube:extractPlaylistId', (_, url: string) => {
    return Invidious.extractPlaylistId(url)
  })

  // yt-dlpを使って直接ストリームURLを取得（Invidiousフォールバック）
  ipcMain.handle('youtube:streamUrl', async (_, videoId: string, cookiesPath?: string) => {
    return getStreamUrl(videoId, cookiesPath)
  })
}
