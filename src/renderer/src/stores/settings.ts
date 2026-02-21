import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface Subscription { channelId: string; channelName: string; thumbnail?: string; subscribedAt?: number }
interface HistoryEntry { videoId: string; title: string; thumbnail?: string; watchedAt: number }
interface LocalPlaylistVideo { videoId: string; title: string; author?: string; thumbnail?: string; lengthSeconds?: number }
interface LocalPlaylist { id: string; name: string; videos: LocalPlaylistVideo[]; createdAt: number }

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<'dark' | 'light' | 'system'>('dark')
  const language = ref('ja')
  const downloadPath = ref('')
  const invidiousInstance = ref('https://iv.melmac.space')
  const sponsorblockEnabled = ref(true)
  const sponsorblockCategories = ref(['sponsor', 'intro', 'outro', 'selfpromo'])
  const dearrowEnabled = ref(true)
  const autoMaxQuality = ref(true)
  const defaultFormat = ref('mp4')
  const concurrentDownloads = ref(3)
  const subscriptions = ref<Subscription[]>([])
  const watchHistory = ref<HistoryEntry[]>([])
  const watchLater = ref<string[]>([])
  const localPlaylists = ref<LocalPlaylist[]>([])
  const externalPlayer = ref('')
  const externalPlayerPath = ref('')
  const proxyEnabled = ref(false)
  const proxyUrl = ref('')
  const aiEnabled = ref(false)
  const aiApiKey = ref('')
  const aiModel = ref('gemini-3-flash')
  const cookiesPath = ref('')
  const cookiesBrowser = ref('')
  const youtubeDataApiKey = ref('')
  const fastMode = ref(false)
  const defaultPlaybackSpeed = ref(1.0)
  const forceDefaultSpeed = ref(false)
  const speedStep = ref(0.02)
  const wheelSpeedEnabled = ref(true)
  const wheelSpeedRightClickOnly = ref(false)
  const defaultVolume = ref(60)
  const forceDefaultVolume = ref(true)
  const volumeBoostLevel = ref(2)
  const autoVolumeBoost = ref(false)
  const wheelVolumeEnabled = ref(true)
  const wheelVolumeRightClickOnly = ref(false)
  const wheelVolumeStep = ref(5)
  const playerVolume = ref(1)
  const playerMuted = ref(false)

  async function init() {
    try {
      const s = await window.api.settings.get() as Record<string, unknown>
      theme.value = (s.theme as 'dark'|'light'|'system') || 'dark'
      language.value = (s.language as string) || 'ja'
      downloadPath.value = (s.downloadPath as string) || ''
      invidiousInstance.value = (s.invidiousInstance as string) || 'https://iv.melmac.space'
      sponsorblockEnabled.value = (s.sponsorblockEnabled as boolean) ?? true
      sponsorblockCategories.value = (s.sponsorblockCategories as string[]) || ['sponsor', 'intro', 'outro', 'selfpromo']
      dearrowEnabled.value = (s.dearrowEnabled as boolean) ?? true
      autoMaxQuality.value = (s.autoMaxQuality as boolean) ?? true
      defaultFormat.value = (s.defaultFormat as string) || 'mp4'
      concurrentDownloads.value = (s.concurrentDownloads as number) || 3
      subscriptions.value = (s.subscriptions as Subscription[]) || []
      watchHistory.value = (s.watchHistory as HistoryEntry[]) || []
      watchLater.value = (s.watchLater as string[]) || []
      localPlaylists.value = (s.localPlaylists as LocalPlaylist[]) || []
      externalPlayer.value = (s.externalPlayer as string) || ''
      externalPlayerPath.value = (s.externalPlayerPath as string) || ''
      proxyEnabled.value = (s.proxyEnabled as boolean) || false
      proxyUrl.value = (s.proxyUrl as string) || ''
      aiEnabled.value = (s.aiEnabled as boolean) || false
      aiApiKey.value = (s.aiApiKey as string) || ''
      aiModel.value = (s.aiModel as string) || 'gemini-3-flash'
      cookiesPath.value = (s.cookiesPath as string) || ''
      cookiesBrowser.value = (s.cookiesBrowser as string) || ''
      youtubeDataApiKey.value = (s.youtubeDataApiKey as string) || ''
      fastMode.value = (s.fastMode as boolean) || false
      defaultPlaybackSpeed.value = (s.defaultPlaybackSpeed as number) ?? 1.0
      forceDefaultSpeed.value = (s.forceDefaultSpeed as boolean) || false
      speedStep.value = (s.speedStep as number) ?? 0.02
      wheelSpeedEnabled.value = (s.wheelSpeedEnabled as boolean) ?? true
      wheelSpeedRightClickOnly.value = (s.wheelSpeedRightClickOnly as boolean) || false
      defaultVolume.value = (s.defaultVolume as number) ?? 6
      forceDefaultVolume.value = (s.forceDefaultVolume as boolean) ?? true
      volumeBoostLevel.value = (s.volumeBoostLevel as number) ?? 2
      autoVolumeBoost.value = (s.autoVolumeBoost as boolean) || false
      wheelVolumeEnabled.value = (s.wheelVolumeEnabled as boolean) ?? true
      wheelVolumeRightClickOnly.value = (s.wheelVolumeRightClickOnly as boolean) || false
      wheelVolumeStep.value = (s.wheelVolumeStep as number) ?? 1
      playerVolume.value = (s.playerVolume as number) ?? 1
      playerMuted.value = (s.playerMuted as boolean) || false
    } catch (e) { console.error('Failed to load settings:', e) }
  }

  async function save(partial: Record<string, unknown>) {
    const updated = await window.api.settings.set(partial) as Record<string, unknown>
    if ('theme' in partial) theme.value = partial.theme as 'dark'|'light'|'system'
    if ('downloadPath' in partial) downloadPath.value = partial.downloadPath as string
    if ('invidiousInstance' in partial) invidiousInstance.value = partial.invidiousInstance as string
    if ('sponsorblockEnabled' in partial) sponsorblockEnabled.value = partial.sponsorblockEnabled as boolean
    if ('dearrowEnabled' in partial) dearrowEnabled.value = partial.dearrowEnabled as boolean
    if ('defaultFormat' in partial) defaultFormat.value = partial.defaultFormat as string
    if ('concurrentDownloads' in partial) concurrentDownloads.value = partial.concurrentDownloads as number
    if ('externalPlayer' in partial) externalPlayer.value = partial.externalPlayer as string
    if ('externalPlayerPath' in partial) externalPlayerPath.value = partial.externalPlayerPath as string
    if ('proxyEnabled' in partial) proxyEnabled.value = partial.proxyEnabled as boolean
    if ('proxyUrl' in partial) proxyUrl.value = partial.proxyUrl as string
    if ('aiEnabled' in partial) aiEnabled.value = partial.aiEnabled as boolean
    if ('aiApiKey' in partial) aiApiKey.value = partial.aiApiKey as string
    if ('aiModel' in partial) aiModel.value = partial.aiModel as string
    if ('cookiesPath' in partial) cookiesPath.value = partial.cookiesPath as string
    if ('cookiesBrowser' in partial) cookiesBrowser.value = partial.cookiesBrowser as string
    if ('youtubeDataApiKey' in partial) youtubeDataApiKey.value = partial.youtubeDataApiKey as string
    if ('fastMode' in partial) fastMode.value = partial.fastMode as boolean
    if ('defaultPlaybackSpeed' in partial) defaultPlaybackSpeed.value = partial.defaultPlaybackSpeed as number
    if ('forceDefaultSpeed' in partial) forceDefaultSpeed.value = partial.forceDefaultSpeed as boolean
    if ('speedStep' in partial) speedStep.value = partial.speedStep as number
    if ('wheelSpeedEnabled' in partial) wheelSpeedEnabled.value = partial.wheelSpeedEnabled as boolean
    if ('wheelSpeedRightClickOnly' in partial) wheelSpeedRightClickOnly.value = partial.wheelSpeedRightClickOnly as boolean
    if ('defaultVolume' in partial) defaultVolume.value = partial.defaultVolume as number
    if ('forceDefaultVolume' in partial) forceDefaultVolume.value = partial.forceDefaultVolume as boolean
    if ('volumeBoostLevel' in partial) volumeBoostLevel.value = partial.volumeBoostLevel as number
    if ('autoVolumeBoost' in partial) autoVolumeBoost.value = partial.autoVolumeBoost as boolean
    if ('wheelVolumeEnabled' in partial) wheelVolumeEnabled.value = partial.wheelVolumeEnabled as boolean
    if ('wheelVolumeRightClickOnly' in partial) wheelVolumeRightClickOnly.value = partial.wheelVolumeRightClickOnly as boolean
    if ('wheelVolumeStep' in partial) wheelVolumeStep.value = partial.wheelVolumeStep as number
    if ('playerVolume' in partial) playerVolume.value = partial.playerVolume as number
    if ('playerMuted' in partial) playerMuted.value = partial.playerMuted as boolean
    if ('localPlaylists' in partial) localPlaylists.value = partial.localPlaylists as LocalPlaylist[]
    if (updated.subscriptions) subscriptions.value = updated.subscriptions as Subscription[]
  }

  async function addSubscription(sub: Subscription) {
    subscriptions.value = await window.api.settings.addSubscription(sub) as Subscription[]
  }

  async function removeSubscription(channelId: string) {
    subscriptions.value = await window.api.settings.removeSubscription(channelId) as Subscription[]
  }

  async function addHistory(entry: { videoId: string; title: string; thumbnail?: string }) {
    watchHistory.value = await window.api.settings.addHistory(entry) as HistoryEntry[]
  }

  const isSubscribed = computed(() =>
    (channelId: string) => subscriptions.value.some(s => s.channelId === channelId)
  )

  return {
    theme, language, downloadPath, invidiousInstance,
    sponsorblockEnabled, sponsorblockCategories, dearrowEnabled, autoMaxQuality,
    defaultFormat, concurrentDownloads, subscriptions,
    watchHistory, watchLater, localPlaylists,
    externalPlayer, externalPlayerPath, proxyEnabled, proxyUrl,
    aiEnabled, aiApiKey, aiModel, cookiesPath, cookiesBrowser, youtubeDataApiKey,
    fastMode,
    defaultPlaybackSpeed, forceDefaultSpeed, speedStep, wheelSpeedEnabled, wheelSpeedRightClickOnly,
    defaultVolume, forceDefaultVolume, volumeBoostLevel, autoVolumeBoost,
    wheelVolumeEnabled, wheelVolumeRightClickOnly, wheelVolumeStep,
    playerVolume, playerMuted,
    init, save, addSubscription, removeSubscription, addHistory, isSubscribed
  }
})
