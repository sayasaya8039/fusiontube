<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useDownloadStore } from '../stores/downloads'
import VideoCard from '../components/VideoCard.vue'
import Hls from 'hls.js'
import { marked } from 'marked'

// marked設定: セキュアかつシンプルに
marked.setOptions({ breaks: true, gfm: true })

function renderMarkdown(text: string): string {
  return marked.parse(text) as string
}

const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()
const downloadStore = useDownloadStore()

const videoId = ref(route.params.videoId as string)
const videoInfo = ref<Record<string, unknown> | null>(null)
const loading = ref(true)
const error = ref('')
const videoRef = ref<HTMLVideoElement>()
const audioRef = ref<HTMLAudioElement>()
const subscribed = ref(false)
const showFullDesc = ref(false)

// ストリーム状態
const streamReady = ref(false)
const streamStatus = ref<'loading' | 'downloading' | 'merging' | 'ready' | 'error'>('loading')
const proxyUrl = ref('')
const hasAudio = ref(false)
const isLive = ref(false)
let hlsInstance: Hls | null = null
const volume = ref(settingsStore.playerVolume)
const muted = ref(settingsStore.playerMuted)
const dlProgress = ref(0)
const dlSpeed = ref('')
const dlEta = ref('')
const dlSize = ref('')

// Enhancer: Web Audio API Volume Boost
let audioContext: AudioContext | null = null
let gainNode: GainNode | null = null
let sourceNode: MediaElementAudioSourceNode | null = null
const playerHovered = ref(false)
const currentSpeed = ref(1.0)
const speedOverlayVisible = ref(false)
let speedOverlayTimer: ReturnType<typeof setTimeout> | null = null

function setupAudioBoost(mediaEl: HTMLMediaElement) {
  if (sourceNode) return // already connected
  try {
    audioContext = new AudioContext()
    sourceNode = audioContext.createMediaElementSource(mediaEl)
    gainNode = audioContext.createGain()
    sourceNode.connect(gainNode)
    gainNode.connect(audioContext.destination)
    applyVolumeBoost()
  } catch (e) {
    console.warn('[VolumeBoost] setup failed:', e)
  }
}

function applyVolumeBoost() {
  if (!gainNode) return
  const boost = settingsStore.volumeBoostLevel
  // boost 0 = 1x, boost 1 = 1.5x, boost 2 = 2x ... boost 10 = 10x
  gainNode.gain.value = boost === 0 ? 1 : Math.max(1, boost)
}

function destroyAudioBoost() {
  try {
    sourceNode?.disconnect()
    gainNode?.disconnect()
    audioContext?.close()
  } catch { /* ignore */ }
  sourceNode = null
  gainNode = null
  audioContext = null
}

function applyDefaultPlaybackSpeed() {
  if (!settingsStore.forceDefaultSpeed) return
  const el = videoRef.value
  if (!el) return
  el.playbackRate = settingsStore.defaultPlaybackSpeed
  currentSpeed.value = settingsStore.defaultPlaybackSpeed
  // sync audio element too
  if (hasAudio.value && audioRef.value) {
    audioRef.value.playbackRate = settingsStore.defaultPlaybackSpeed
  }
}

function applyDefaultVolume() {
  if (!settingsStore.forceDefaultVolume) return
  const vol = Math.max(0, Math.min(1, settingsStore.defaultVolume / 100))
  volume.value = vol
  if (hasAudio.value && audioRef.value) {
    audioRef.value.volume = vol
  } else if (videoRef.value) {
    videoRef.value.volume = vol
  }
}

function showSpeedOverlay() {
  speedOverlayVisible.value = true
  if (speedOverlayTimer) clearTimeout(speedOverlayTimer)
  speedOverlayTimer = setTimeout(() => { speedOverlayVisible.value = false }, 1200)
}

function handlePlayerWheel(e: WheelEvent) {
  // Ctrl + ホイール → 再生速度変更
  if (e.ctrlKey && settingsStore.wheelSpeedEnabled) {
    if (settingsStore.wheelSpeedRightClickOnly && e.buttons !== 2) return
    const el = videoRef.value
    if (!el) return
    const step = settingsStore.speedStep
    const delta = e.deltaY < 0 ? step : -step
    const newSpeed = Math.max(0.07, Math.min(16, parseFloat((el.playbackRate + delta).toFixed(4))))
    el.playbackRate = newSpeed
    currentSpeed.value = newSpeed
    if (hasAudio.value && audioRef.value) audioRef.value.playbackRate = newSpeed
    showSpeedOverlay()
    return
  }

  // ホイール（Ctrlなし）→ 音量変更
  if (settingsStore.wheelVolumeEnabled) {
    if (settingsStore.wheelVolumeRightClickOnly && e.buttons !== 2) return
    const step = settingsStore.wheelVolumeStep / 100 // 0-100 scale → 0-1 scale
    const delta = e.deltaY < 0 ? step : -step
    setVolume(volume.value + delta)
  }
}

function handlePlayerContextMenu(e: Event) {
  // 右クリック限定モードの場合、コンテキストメニューを抑制
  if (
    (settingsStore.wheelSpeedEnabled && settingsStore.wheelSpeedRightClickOnly) ||
    (settingsStore.wheelVolumeEnabled && settingsStore.wheelVolumeRightClickOnly)
  ) {
    e.preventDefault()
  }
}

// SponsorBlock
const sponsorSegments = ref<Array<{ category: string; segment: [number, number] }>>([])
const skippedKeys = new Set<string>()

async function loadSponsorBlock(vid: string) {
  if (!settingsStore.sponsorblockEnabled) return
  try {
    const segments = await window.api.sponsorblock.getSegments(
      vid, settingsStore.sponsorblockCategories
    )
    sponsorSegments.value = segments
  } catch {
    sponsorSegments.value = []
  }
}

function handleTimeUpdate() {
  if (!videoRef.value || sponsorSegments.value.length === 0) return
  const t = videoRef.value.currentTime
  for (const seg of sponsorSegments.value) {
    const key = `${seg.segment[0]}-${seg.segment[1]}`
    if (t >= seg.segment[0] && t < seg.segment[1] && !skippedKeys.has(key)) {
      skippedKeys.add(key)
      videoRef.value.currentTime = seg.segment[1]
      break
    }
  }
}

// AIプレイリスト
const aiPlaylistVideos = ref<Array<Record<string, unknown>>>([])
const aiPlaylistLoading = ref(false)
const aiPlaylistError = ref('')
const showSavePlaylistDialog = ref(false)
const newPlaylistName = ref('')

async function generateAIPlaylist() {
  if (!videoInfo.value) return
  if (!settingsStore.aiEnabled || !settingsStore.aiApiKey) {
    aiPlaylistError.value = '設定 > AI要約 でAI機能を有効にしてAPIキーを設定してください'
    return
  }
  aiPlaylistLoading.value = true
  aiPlaylistError.value = ''
  aiPlaylistVideos.value = []
  try {
    // 視聴履歴から直近10件のタイトルを取得
    const recentHistory = settingsStore.watchHistory
      .slice(0, 10)
      .map(h => h.title)

    // AIに検索クエリを生成させる
    const queries = await window.api.ai.generatePlaylistQueries(
      videoInfo.value.title as string,
      videoInfo.value.author as string,
      (videoInfo.value.description as string) || '',
      recentHistory,
      settingsStore.aiApiKey,
      settingsStore.aiModel
    ) as string[]

    console.log('[AIプレイリスト] queries:', queries)

    // 3クエリを並列でInvidious検索
    let searchErrors = 0
    const results = await Promise.all(
      queries.map(q =>
        window.api.youtube.search(q).catch((e) => {
          console.warn('[AIプレイリスト] 検索失敗:', q, e)
          searchErrors++
          return []
        })
      )
    )

    console.log('[AIプレイリスト] 検索結果:', results.map((r, i) =>
      `${queries[i]}: ${(r as Array<unknown>).length}件`
    ))

    // 重複除去 + 現在の動画を除外
    const seen = new Set<string>([videoId.value])
    const historyIds = new Set(settingsStore.watchHistory.map(h => h.videoId))
    const merged: Array<Record<string, unknown>> = []

    for (const list of results) {
      const videos = (list as Array<Record<string, unknown>>) || []
      for (const v of videos) {
        const vid = v.videoId as string
        // videoIdがあればOK、チャンネル・プレイリストのみ除外
        if (!vid || seen.has(vid) || v.type === 'channel' || v.type === 'playlist') continue
        seen.add(vid)
        if (!historyIds.has(vid)) {
          merged.push(v)
        }
        if (merged.length >= 15) break
      }
      if (merged.length >= 15) break
    }

    aiPlaylistVideos.value = merged
    if (merged.length === 0) {
      if (searchErrors === queries.length) {
        aiPlaylistError.value = '検索サーバーに接続できませんでした。しばらく待ってから再試行してください'
      } else {
        aiPlaylistError.value = '関連動画が見つかりませんでした'
      }
    }
  } catch (e) {
    aiPlaylistError.value = `エラー: ${String(e).replace('Error: ', '')}`
  } finally {
    aiPlaylistLoading.value = false
  }
}

function saveAsLocalPlaylist() {
  const name = newPlaylistName.value.trim() ||
    `${(videoInfo.value?.title as string || 'AI').slice(0, 20)} Mix`
  const videoItems = aiPlaylistVideos.value.map(v => ({
    videoId: v.videoId as string,
    title: v.title as string,
    author: (v.author as string) || '',
    thumbnail: ((v.videoThumbnails as Array<Record<string, unknown>>)?.[0]?.url as string) || '',
    lengthSeconds: (v.lengthSeconds as number) || 0
  }))
  const playlist = {
    id: `ai-${Date.now()}`,
    name,
    videos: videoItems,
    createdAt: Date.now()
  }
  const updated = [...settingsStore.localPlaylists, playlist]
  settingsStore.save({ localPlaylists: updated })
  showSavePlaylistDialog.value = false
  newPlaylistName.value = ''
}

function handleVideoEnded() {
  if (settingsStore.aiEnabled && settingsStore.aiApiKey && aiPlaylistVideos.value.length === 0) {
    generateAIPlaylist()
  }
}

// AI要約
const summaryText = ref('')
const summaryLoading = ref(false)

async function generateSummary() {
  if (!videoInfo.value) return
  if (!settingsStore.aiEnabled) {
    summaryText.value = '設定 > AI要約 で機能を有効にしてください'
    return
  }
  if (!settingsStore.aiApiKey) {
    summaryText.value = '設定 > AI要約 でAPIキーを設定してください'
    return
  }
  summaryLoading.value = true
  summaryText.value = ''
  try {
    const captions = videoInfo.value.captions as Array<{ languageCode: string; url: string }>
    const jaCaption = captions?.find(c => c.languageCode === 'ja' || c.languageCode.startsWith('ja'))
    const enCaption = captions?.find(c => c.languageCode === 'en' || c.languageCode.startsWith('en'))
    const caption = jaCaption || enCaption || captions?.[0]
    if (!caption) {
      summaryText.value = 'この動画には字幕がありません'
      return
    }
    console.log('[AI要約] caption:', caption.languageCode, caption.url?.slice(0, 80))
    const text = await window.api.ai.getCaptions(caption.url)
    if (!text || text.length < 10) {
      summaryText.value = '字幕テキストを取得できませんでした'
      return
    }
    console.log('[AI要約] caption text length:', text.length)
    summaryText.value = await window.api.ai.summarize(
      text,
      settingsStore.aiApiKey,
      settingsStore.aiModel
    )
  } catch (e) {
    const msg = String(e).replace('Error: ', '')
    summaryText.value = `エラー: ${msg}`
  } finally {
    summaryLoading.value = false
  }
}

// チャプター
const chapters = computed(() => {
  const info = videoInfo.value
  if (!info?.chapters) return []
  return info.chapters as Array<{ title: string; startTime: number; endTime: number }>
})

// ポーリング
let pollTimer: ReturnType<typeof setInterval> | null = null

function startPolling(url: string) {
  const statusUrl = url.replace('/stream/', '/status/')
  streamStatus.value = 'downloading'

  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(statusUrl)
      const data = await res.json()

      dlProgress.value = data.progress || 0
      dlSpeed.value = data.speed || ''
      dlEta.value = data.eta || ''
      dlSize.value = data.dlSize || ''

      if (data.status === 'downloading') {
        streamStatus.value = 'downloading'
      } else if (data.status === 'merging') {
        streamStatus.value = 'merging'
      } else if (data.status === 'ready') {
        streamStatus.value = 'ready'
        streamReady.value = true
        hasAudio.value = !!data.hasAudio
        isLive.value = !!data.isLive
        stopPolling()
        await nextTick()
        attachPlayer()
      } else if (data.status === 'error') {
        streamStatus.value = 'error'
        error.value = `ストリームエラー: ${data.error}`
        stopPolling()
      }
    } catch { /* retry */ }
  }, 800)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function destroyHls() {
  if (hlsInstance) {
    hlsInstance.destroy()
    hlsInstance = null
  }
}

function setVolume(val: number) {
  volume.value = Math.max(0, Math.min(1, val))
  if (hasAudio.value && audioRef.value) {
    audioRef.value.volume = volume.value
    audioRef.value.muted = false
    muted.value = false
  } else if (videoRef.value) {
    videoRef.value.volume = volume.value
    videoRef.value.muted = false
    muted.value = false
  }
  settingsStore.save({ playerVolume: volume.value, playerMuted: false })
}

function toggleMute() {
  muted.value = !muted.value
  if (hasAudio.value && audioRef.value) {
    audioRef.value.muted = muted.value
  } else if (videoRef.value) {
    videoRef.value.muted = muted.value
  }
  settingsStore.save({ playerMuted: muted.value })
}

function attachPlayer() {
  const el = videoRef.value
  if (!el || !proxyUrl.value) return

  destroyHls()
  destroyAudioBoost()

  // ライブ配信 (HLS) → hls.js で再生
  if (isLive.value && Hls.isSupported()) {
    hlsInstance = new Hls({
      enableWorker: true,
      lowLatencyMode: true
    })
    hlsInstance.loadSource(proxyUrl.value)
    hlsInstance.attachMedia(el)
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      el.play().catch(() => {})
    })
    hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        console.error('[hls.js] fatal error:', data.type, data.details)
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hlsInstance?.startLoad()
        } else {
          destroyHls()
        }
      }
    })
    return
  }

  // VOD: 直接URLをプロキシ経由で再生
  el.src = proxyUrl.value
  el.load()

  // 別音声ストリームがある場合、hidden audio要素で同期再生
  if (hasAudio.value) {
    // video要素は映像のみなのでミュート（音声はaudio要素から出力）
    el.muted = true

    const audio = audioRef.value
    if (audio) {
      audio.src = proxyUrl.value + '?type=audio'
      audio.volume = volume.value
      audio.muted = muted.value
      audio.load()

      el.addEventListener('play', () => { audio.play().catch(() => {}) })
      el.addEventListener('pause', () => { audio.pause() })
      el.addEventListener('seeked', () => { audio.currentTime = el.currentTime })
      el.addEventListener('ratechange', () => { audio.playbackRate = el.playbackRate })
    }
  }

  el.play().catch(() => {})

  // Enhancer: デフォルト値適用 + Volume Boost
  el.addEventListener('loadedmetadata', () => {
    applyDefaultPlaybackSpeed()
    applyDefaultVolume()
    currentSpeed.value = el.playbackRate
  }, { once: true })

  // Volume Boost: audio要素がある場合はそちらに、なければvideo要素に接続
  const boostTarget = (hasAudio.value && audioRef.value) ? audioRef.value : el
  if (settingsStore.volumeBoostLevel > 0) {
    setupAudioBoost(boostTarget)
  }
}

async function loadVideo() {
  loading.value = true
  error.value = ''
  videoInfo.value = null
  summaryText.value = ''
  aiPlaylistVideos.value = []
  aiPlaylistError.value = ''
  aiPlaylistLoading.value = false
  showSavePlaylistDialog.value = false
  destroyHls()
  destroyAudioBoost()
  streamReady.value = false
  streamStatus.value = 'loading'
  proxyUrl.value = ''
  hasAudio.value = false
  isLive.value = false
  dlProgress.value = 0
  dlSpeed.value = ''
  dlEta.value = ''
  dlSize.value = ''
  skippedKeys?.clear()
  sponsorSegments.value = []
  stopPolling()

  try {
    const settings = await window.api.settings.get() as Record<string, unknown>
    const cookiesPath = (settings.cookiesPath as string) || undefined

    const sd = await window.api.youtube.getStreamUrl(videoId.value, cookiesPath) as Record<string, unknown>
    proxyUrl.value = sd.proxyUrl as string

    videoInfo.value = {
      videoId: videoId.value,
      title: sd.title,
      description: sd.description,
      author: sd.author,
      authorId: sd.authorId,
      viewCount: sd.viewCount,
      lengthSeconds: sd.duration,
      videoThumbnails: [{ url: sd.thumbnail, quality: 'default' }],
      captions: (sd.captions as Array<{ languageCode: string; label: string; url: string }>) || [],
      recommendedVideos: [],
      chapters: sd.chapters
    }
    subscribed.value = settingsStore.isSubscribed(sd.authorId as string)
    await window.api.settings.addHistory({
      videoId: videoId.value,
      title: sd.title as string,
      thumbnail: sd.thumbnail as string
    })
    loadSponsorBlock(videoId.value)
    startPolling(proxyUrl.value)
  } catch (e) {
    error.value = `動画の読み込みに失敗しました: ${String(e).replace('Error: ', '')}`
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function downloadVideo() {
  if (!videoInfo.value) return
  const settings = await window.api.settings.get() as Record<string, unknown>
  const outputPath = (settings.downloadPath as string) || 'C:/Users/Public/Videos'
  downloadStore.addToQueue({
    id: `${videoId.value}-${Date.now()}`,
    url: `https://www.youtube.com/watch?v=${videoId.value}`,
    title: videoInfo.value.title as string,
    thumbnail: ((videoInfo.value.videoThumbnails as Record<string, unknown>[])?.[0]?.url as string),
    outputPath, format: 'mp4', audioOnly: false, subtitles: false, embedThumbnail: true
  })
  router.push('/downloads')
}

async function toggleSubscription() {
  if (!videoInfo.value) return
  const channelId = videoInfo.value.authorId as string
  if (subscribed.value) {
    await settingsStore.removeSubscription(channelId)
    subscribed.value = false
  } else {
    await settingsStore.addSubscription({ channelId, channelName: videoInfo.value.author as string })
    subscribed.value = true
  }
}

function takeScreenshot() {
  if (!videoRef.value) return
  const canvas = document.createElement('canvas')
  canvas.width = videoRef.value.videoWidth
  canvas.height = videoRef.value.videoHeight
  canvas.getContext('2d')?.drawImage(videoRef.value, 0, 0)
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `screenshot-${videoId.value}-${Math.floor(videoRef.value.currentTime)}s.png`
  a.click()
}

function seekToChapter(startTime: number) {
  if (videoRef.value) videoRef.value.currentTime = startTime
}

async function openExternal() {
  window.open(`https://www.youtube.com/watch?v=${videoId.value}`, '_blank')
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

watch(() => route.params.videoId, (newId) => {
  if (newId) { videoId.value = newId as string; loadVideo() }
})
onMounted(loadVideo)
onBeforeUnmount(() => {
  stopPolling()
  destroyHls()
  destroyAudioBoost()
})
</script>

<template>
  <div class="p-4 min-h-full">
    <div v-if="loading" class="animate-pulse">
      <div class="bg-[#1a1a1a] rounded-xl aspect-video mb-4" />
      <div class="h-6 bg-[#1a1a1a] rounded mb-2 w-3/4" />
    </div>
    <div v-else-if="error && !videoInfo" class="text-center py-16">
      <p class="text-red-400 text-sm">{{ error }}</p>
      <button @click="loadVideo" class="mt-3 text-xs text-gray-400 hover:text-white px-3 py-1.5 bg-[#1a1a1a] rounded-lg">再試行</button>
    </div>
    <div v-else-if="videoInfo" class="flex gap-6 items-start">
      <div class="flex-1 min-w-0">
        <!-- プレイヤー -->
        <div class="relative bg-black rounded-xl overflow-hidden aspect-video mb-4 group"
          @mouseenter="playerHovered = true" @mouseleave="playerHovered = false"
          @wheel.prevent="handlePlayerWheel" @contextmenu="handlePlayerContextMenu">
          <!-- ダウンロード中 -->
          <div v-if="!streamReady" class="w-full h-full flex flex-col items-center justify-center gap-4">
            <div v-if="streamStatus === 'downloading' || streamStatus === 'merging'" class="flex flex-col items-center gap-4 w-full max-w-xs px-6">
              <!-- スピナー -->
              <div class="w-12 h-12 border-3 border-red-500 border-t-transparent rounded-full animate-spin" />
              <!-- テキスト -->
              <p class="text-gray-200 text-sm font-medium">
                {{ streamStatus === 'merging' ? '動画を結合中...' : '動画を準備中...' }}
              </p>
              <!-- プログレスバー -->
              <div class="w-full bg-[#222] rounded-full h-2 overflow-hidden">
                <div class="bg-red-500 h-full rounded-full transition-all duration-300 ease-out"
                  :style="{ width: `${dlProgress}%` }" />
              </div>
              <!-- 進捗詳細 -->
              <div class="flex items-center justify-between w-full text-xs text-gray-400">
                <span>{{ dlProgress.toFixed(1) }}%</span>
                <span v-if="dlSize">{{ dlSize }}</span>
              </div>
              <div v-if="dlSpeed || dlEta" class="flex items-center gap-3 text-xs text-gray-500">
                <span v-if="dlSpeed">{{ dlSpeed }}</span>
                <span v-if="dlEta">残り {{ dlEta }}</span>
              </div>
            </div>
            <div v-else-if="streamStatus === 'error'" class="text-center">
              <p class="text-red-400 text-sm">{{ error }}</p>
              <button @click="loadVideo" class="mt-2 text-xs text-gray-400 hover:text-white px-3 py-1.5 bg-[#1a1a1a] rounded-lg">再試行</button>
            </div>
            <div v-else class="flex items-center gap-2">
              <div class="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
              <p class="text-gray-500 text-sm">読み込み中...</p>
            </div>
          </div>
          <!-- プレイヤー本体 -->
          <video v-if="streamReady" ref="videoRef" class="w-full h-full" controls @timeupdate="handleTimeUpdate" @ended="handleVideoEnded" />
          <audio v-if="streamReady && hasAudio" ref="audioRef" class="hidden" />
          <!-- カスタム音量コントロール (映像音声分離時) -->
          <div v-if="streamReady && hasAudio"
            class="absolute bottom-12 right-3 flex items-center gap-2 bg-black/80 rounded-lg px-3 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button @click="toggleMute" class="text-white text-sm w-5 flex-shrink-0">
              <svg v-if="muted || volume === 0" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
              <svg v-else-if="volume < 0.5" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>
              <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
            <input type="range" min="0" max="1" step="0.05" :value="volume"
              @input="setVolume(parseFloat(($event.target as HTMLInputElement).value))"
              class="w-20 h-1 accent-white cursor-pointer" />
          </div>
          <!-- 速度オーバーレイ -->
          <Transition name="fade">
            <div v-if="speedOverlayVisible" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/80 text-white text-2xl font-bold px-6 py-3 rounded-xl pointer-events-none z-10">
              {{ currentSpeed.toFixed(2) }}x
            </div>
          </Transition>
          <!-- オーバーレイ -->
          <div v-if="streamReady" class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button @click="takeScreenshot" title="スクリーンショット"
              class="bg-black/70 hover:bg-black/90 text-white text-xs px-2 py-1 rounded transition-colors">📷</button>
            <button @click="openExternal" title="ブラウザで開く"
              class="bg-black/70 hover:bg-black/90 text-white text-xs px-2 py-1 rounded transition-colors">🔗</button>
          </div>
        </div>

        <!-- タイトル -->
        <h1 class="text-base font-bold mb-3 leading-snug">{{ videoInfo.title as string }}</h1>
        <div class="flex items-start justify-between gap-4 mb-4">
          <RouterLink :to="`/channel/${videoInfo.authorId}`"
            class="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div class="w-8 h-8 bg-[#333] rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
              {{ (videoInfo.author as string)?.[0] }}
            </div>
            <div>
              <p class="text-sm font-medium">{{ videoInfo.author as string }}</p>
              <p class="text-xs text-gray-400">{{ (videoInfo.viewCount as number)?.toLocaleString() }}回視聴</p>
            </div>
          </RouterLink>
          <div class="flex gap-2 flex-shrink-0">
            <button @click="toggleSubscription"
              :class="['px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                subscribed ? 'bg-[#333] text-gray-300 hover:bg-[#444]' : 'bg-white text-black hover:bg-gray-200']">
              {{ subscribed ? '✓ 登録済み' : '登録' }}
            </button>
            <button @click="downloadVideo"
              class="px-4 py-1.5 bg-red-500 rounded-full text-sm font-medium text-white hover:bg-red-600 transition-colors">⬇ 保存</button>
          </div>
        </div>

        <!-- チャプター -->
        <div v-if="chapters.length > 0" class="bg-[#1a1a1a] rounded-xl p-3 mb-3">
          <p class="text-xs font-medium text-gray-300 mb-2">チャプター</p>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="ch in chapters" :key="ch.startTime" @click="seekToChapter(ch.startTime)"
              class="text-xs bg-[#222] hover:bg-[#333] text-gray-300 hover:text-white px-2 py-1 rounded transition-colors">
              {{ formatTime(ch.startTime) }} {{ ch.title }}
            </button>
          </div>
        </div>

        <!-- 説明 -->
        <div class="bg-[#1a1a1a] rounded-xl p-4">
          <p :class="['text-gray-300 text-sm whitespace-pre-wrap', showFullDesc ? '' : 'line-clamp-3']">
            {{ videoInfo.description as string }}
          </p>
          <button v-if="videoInfo.description" @click="showFullDesc = !showFullDesc"
            class="text-xs text-gray-400 hover:text-white mt-2 transition-colors">
            {{ showFullDesc ? '折りたたむ' : '...続きを読む' }}
          </button>
        </div>

        <!-- AI要約 -->
        <div v-if="settingsStore.aiEnabled" class="bg-[#1a1a1a] rounded-xl p-4 mt-3">
          <div class="flex items-center justify-between mb-2">
            <p class="text-sm font-medium">🤖 AI要約</p>
            <button @click="generateSummary" :disabled="summaryLoading"
              class="text-xs px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:bg-[#333] disabled:text-gray-500 rounded-lg text-white transition-colors flex-shrink-0">
              {{ summaryLoading ? '生成中...' : '要約を生成' }}
            </button>
          </div>
          <div v-if="summaryLoading" class="flex items-center gap-2 text-sm text-gray-400">
            <div class="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            字幕を解析中...
          </div>
          <div v-else-if="summaryText" class="summary-content text-sm text-gray-300 leading-relaxed max-h-96 overflow-y-auto" v-html="renderMarkdown(summaryText)"></div>
          <div v-else class="text-xs text-gray-500">字幕から動画内容を要約します</div>
        </div>
      </div>

      <!-- AIプレイリスト サイドバー -->
      <div class="w-72 flex-shrink-0">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-medium text-gray-300">AIおすすめ</h2>
          <div class="flex gap-1.5">
            <button v-if="aiPlaylistVideos.length > 0 && !showSavePlaylistDialog"
              @click="showSavePlaylistDialog = true"
              class="text-xs px-2 py-1 bg-[#222] hover:bg-[#333] text-gray-300 rounded-lg transition-colors"
              title="プレイリストに保存">💾</button>
            <button @click="generateAIPlaylist" :disabled="aiPlaylistLoading"
              class="text-xs px-2.5 py-1 bg-red-500 hover:bg-red-600 disabled:bg-[#333] disabled:text-gray-500 rounded-lg text-white transition-colors">
              {{ aiPlaylistLoading ? '生成中...' : '✨ 生成' }}
            </button>
          </div>
        </div>

        <!-- 保存ダイアログ -->
        <div v-if="showSavePlaylistDialog" class="bg-[#1a1a1a] rounded-lg p-3 mb-3">
          <p class="text-xs text-gray-400 mb-2">プレイリスト名</p>
          <div class="flex gap-1.5">
            <input v-model="newPlaylistName" type="text"
              :placeholder="`${(videoInfo?.title as string || '').slice(0, 20)} Mix`"
              class="flex-1 text-xs bg-[#222] text-white rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-red-500"
              @keyup.enter="saveAsLocalPlaylist" />
            <button @click="saveAsLocalPlaylist"
              class="text-xs px-2.5 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded transition-colors">保存</button>
            <button @click="showSavePlaylistDialog = false"
              class="text-xs px-2 py-1.5 bg-[#333] hover:bg-[#444] text-gray-300 rounded transition-colors">✕</button>
          </div>
        </div>

        <!-- ローディング -->
        <div v-if="aiPlaylistLoading" class="flex flex-col items-center gap-3 py-8">
          <div class="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          <p class="text-xs text-gray-400">AIが関連動画を探しています...</p>
        </div>

        <!-- エラー -->
        <div v-else-if="aiPlaylistError && aiPlaylistVideos.length === 0" class="text-center py-6">
          <p class="text-xs text-gray-400">{{ aiPlaylistError }}</p>
        </div>

        <!-- 結果リスト -->
        <div v-else-if="aiPlaylistVideos.length > 0" class="flex flex-col gap-2 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div v-for="(v, idx) in aiPlaylistVideos" :key="v.videoId as string"
            class="flex gap-2 cursor-pointer hover:bg-[#1a1a1a] rounded-lg p-1.5 transition-colors group"
            @click="router.push(`/watch/${v.videoId}`)">
            <div class="relative flex-shrink-0">
              <img :src="((v.videoThumbnails as Record<string, unknown>[])?.[0]?.url as string)"
                class="w-28 aspect-video object-cover rounded" loading="lazy" />
              <span class="absolute bottom-0.5 right-0.5 bg-black/80 text-[10px] text-white px-1 rounded">
                {{ idx + 1 }}
              </span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium line-clamp-2 group-hover:text-red-400 leading-snug">{{ v.title as string }}</p>
              <p class="text-xs text-gray-500 mt-1">{{ v.author as string }}</p>
            </div>
          </div>
        </div>

        <!-- 初期状態 -->
        <div v-else class="text-center py-8">
          <p class="text-xs text-gray-500 leading-relaxed">
            AIが現在の動画と視聴履歴から<br/>関連動画をおすすめします
          </p>
          <p v-if="!settingsStore.aiEnabled" class="text-xs text-gray-600 mt-2">
            設定からAI機能を有効にしてください
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active { transition: opacity 0.15s ease; }
.fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
