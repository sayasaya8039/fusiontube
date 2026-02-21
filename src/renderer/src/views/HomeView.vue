<script setup lang="ts">
import { ref, onMounted } from 'vue'
import VideoCard from '../components/VideoCard.vue'
import { useSettingsStore } from '../stores/settings'
import { useDownloadStore } from '../stores/downloads'
import { useRouter } from 'vue-router'

const settingsStore = useSettingsStore()
const downloadStore = useDownloadStore()
const router = useRouter()
const videos = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const error = ref('')
const activeTab = ref<'home' | 'trending' | 'history' | 'url'>('home')
const loggedIn = ref(false)

// YouTube おすすめ
const homeVideos = ref<Record<string, unknown>[]>([])
const homeLoading = ref(true)
const homeError = ref('')

async function loadHomeFeed() {
  homeLoading.value = true
  homeError.value = ''
  try {
    homeVideos.value = await window.api.youtube.homeFeed() as Record<string, unknown>[]
  } catch (e) {
    homeError.value = 'おすすめ動画の取得に失敗しました。YouTubeにログインしてください。'
  } finally {
    homeLoading.value = false
  }
}

// 視聴履歴
const historyVideos = ref<Record<string, unknown>[]>([])
async function loadHistory() {
  const settings = await window.api.settings.get() as Record<string, unknown>
  historyVideos.value = ((settings.watchHistory as Record<string, unknown>[]) || []).slice(0, 40)
}

// トレンド
async function loadTrending() {
  loading.value = true
  error.value = ''
  try {
    videos.value = await window.api.youtube.getTrending('JP') as Record<string, unknown>[]
  } catch (e) {
    error.value = 'トレンド動画の取得に失敗しました。Invidiousインスタンスを確認してください。'
  } finally {
    loading.value = false
  }
}

// URLから開く
const urlInput = ref('')
const urlVideoInfo = ref<Record<string, unknown> | null>(null)
const urlLoading = ref(false)
const supportedSites = [
  'YouTube', 'Niconico', 'Twitter/X', 'TikTok', 'Instagram',
  'SoundCloud', 'Bilibili', 'Twitch', 'Dailymotion', 'Vimeo',
  'Facebook', 'Reddit', 'Twitch Clips', '+1000サイト対応'
]

async function openUrl() {
  if (!urlInput.value.trim()) return
  const ytMatch = urlInput.value.match(/[?&]v=([^&]+)/) || urlInput.value.match(/youtu\.be\/([^?]+)/)
  if (ytMatch) {
    router.push(`/watch/${ytMatch[1]}`)
    return
  }
  urlLoading.value = true
  urlVideoInfo.value = null
  try {
    urlVideoInfo.value = await window.api.download.getVideoInfo(urlInput.value) as Record<string, unknown>
  } catch (e) {
    console.error('URL info error:', e)
  } finally {
    urlLoading.value = false
  }
}

async function downloadUrl() {
  if (!urlInput.value.trim()) return
  const settings = await window.api.settings.get() as Record<string, unknown>
  const outputPath = (settings.downloadPath as string) || 'C:/Users/Public/Videos'
  downloadStore.addToQueue({
    id: `url-${Date.now()}`,
    url: urlInput.value,
    title: (urlVideoInfo.value?.title as string) || urlInput.value.slice(-40),
    thumbnail: urlVideoInfo.value?.thumbnail as string,
    outputPath, format: 'mp4', audioOnly: false, subtitles: false, embedThumbnail: true
  })
  router.push('/downloads')
}

onMounted(async () => {
  // ログイン状態を確認
  try {
    loggedIn.value = await window.api.youtube.isLoggedIn() as boolean
  } catch { loggedIn.value = false }

  if (loggedIn.value) {
    activeTab.value = 'home'
    loadHomeFeed()
  } else {
    activeTab.value = 'trending'
  }
  loadTrending()
  loadHistory()
})
</script>

<template>
  <div class="p-6">
    <!-- タブ -->
    <div class="flex items-center gap-5 mb-6 border-b border-[#222] pb-3">
      <button v-if="loggedIn"
        @click="activeTab = 'home'; if (homeVideos.length === 0 && !homeLoading) loadHomeFeed()"
        :class="['text-sm font-medium transition-colors pb-3 -mb-3 border-b-2',
          activeTab === 'home' ? 'text-white border-red-500' : 'text-gray-500 border-transparent hover:text-gray-300']">
        🏠 おすすめ
      </button>
      <button v-for="[tab, label] in [['trending','🔥 トレンド'],['history','📺 視聴履歴'],['url','🔗 URLから開く']]"
        :key="tab" @click="activeTab = tab as 'home' | 'trending' | 'history' | 'url'"
        :class="['text-sm font-medium transition-colors pb-3 -mb-3 border-b-2',
          activeTab === tab ? 'text-white border-red-500' : 'text-gray-500 border-transparent hover:text-gray-300']">
        {{ label }}
      </button>
      <div class="flex-1" />
      <button v-if="activeTab === 'home' && loggedIn" @click="loadHomeFeed" :disabled="homeLoading"
        class="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222] rounded-lg transition-colors disabled:opacity-50 -mb-0.5">
        <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': homeLoading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        リロード
      </button>
    </div>

    <!-- おすすめ (YouTube InnerTube) -->
    <template v-if="activeTab === 'home'">
      <div v-if="homeLoading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <div v-for="i in 12" :key="i" class="rounded-xl overflow-hidden">
          <div class="aspect-video bg-[#1a1a1a] animate-pulse" />
          <div class="p-3 bg-[#1a1a1a] mt-0.5 rounded-b space-y-1.5">
            <div class="h-3 bg-[#2a2a2a] rounded animate-pulse" />
            <div class="h-3 bg-[#2a2a2a] rounded w-2/3 animate-pulse" />
          </div>
        </div>
      </div>
      <div v-else-if="homeError" class="text-center py-16">
        <p class="text-4xl mb-4">⚠️</p>
        <p class="text-red-400 text-sm mb-4">{{ homeError }}</p>
        <button @click="loadHomeFeed"
          class="text-sm text-gray-300 hover:text-white px-4 py-2 bg-[#1a1a1a] hover:bg-[#222] rounded-lg transition-colors">
          再試行
        </button>
      </div>
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <VideoCard v-for="v in homeVideos" :key="(v.videoId as string)"
          :video-id="(v.videoId as string)" :title="(v.title as string)" :author="(v.author as string)"
          :thumbnail="((v.videoThumbnails as Record<string,unknown>[])?.[0]?.url as string)"
          :view-count="(v.viewCount as number)" :length-seconds="(v.lengthSeconds as number)"
          :published-text="(v.publishedText as string)" />
      </div>
    </template>

    <!-- トレンド -->
    <template v-if="activeTab === 'trending'">
      <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <div v-for="i in 12" :key="i" class="rounded-xl overflow-hidden">
          <div class="aspect-video bg-[#1a1a1a] animate-pulse" />
          <div class="p-3 bg-[#1a1a1a] mt-0.5 rounded-b space-y-1.5">
            <div class="h-3 bg-[#2a2a2a] rounded animate-pulse" />
            <div class="h-3 bg-[#2a2a2a] rounded w-2/3 animate-pulse" />
          </div>
        </div>
      </div>
      <div v-else-if="error" class="text-center py-16">
        <p class="text-4xl mb-4">⚠️</p>
        <p class="text-red-400 text-sm mb-4">{{ error }}</p>
        <div class="flex gap-3 justify-center">
          <button @click="loadTrending"
            class="text-sm text-gray-300 hover:text-white px-4 py-2 bg-[#1a1a1a] hover:bg-[#222] rounded-lg transition-colors">
            再試行
          </button>
          <button @click="router.push('/settings')"
            class="text-sm text-gray-300 hover:text-white px-4 py-2 bg-[#1a1a1a] hover:bg-[#222] rounded-lg transition-colors">
            設定を開く
          </button>
        </div>
      </div>
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <VideoCard v-for="v in videos" :key="(v.videoId as string)"
          :video-id="(v.videoId as string)" :title="(v.title as string)" :author="(v.author as string)"
          :thumbnail="((v.videoThumbnails as Record<string,unknown>[])?.[0]?.url as string)"
          :view-count="(v.viewCount as number)" :length-seconds="(v.lengthSeconds as number)"
          :published-text="(v.publishedText as string)" :published="(v.published as number)" />
      </div>
    </template>

    <!-- 視聴履歴 -->
    <template v-else-if="activeTab === 'history'">
      <div v-if="historyVideos.length === 0" class="text-center py-16">
        <p class="text-4xl mb-4">📺</p>
        <p class="text-gray-500 text-sm">視聴履歴がありません</p>
      </div>
      <div v-else>
        <div class="flex items-center justify-between mb-4">
          <p class="text-xs text-gray-400">{{ historyVideos.length }}件</p>
          <button @click="window.api.settings.clearHistory().then(() => { historyVideos = [] })"
            class="text-xs text-gray-500 hover:text-red-400 transition-colors">すべて削除</button>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <VideoCard v-for="v in historyVideos" :key="(v.videoId as string)"
            :video-id="(v.videoId as string)" :title="(v.title as string)"
            :thumbnail="(v.thumbnail as string)"
            :published-text="v.watchedAt ? new Date(v.watchedAt as number).toLocaleDateString('ja-JP') : ''" />
        </div>
      </div>
    </template>

    <!-- URLから開く -->
    <template v-else-if="activeTab === 'url'">
      <div class="max-w-2xl">
        <p class="text-gray-400 text-sm mb-5">YouTube以外のURLも貼り付けてダウンロード・情報取得ができます</p>
        <div class="bg-[#1a1a1a] rounded-xl p-5 mb-5">
          <label class="block text-sm font-medium mb-2">URLを貼り付け</label>
          <input v-model="urlInput" type="text"
            placeholder="https://... (YouTube, Niconico, Twitter, TikTok, SoundCloud, Bilibili...)"
            @keyup.enter="openUrl"
            class="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#555] mb-3" />
          <div class="flex gap-2">
            <button @click="openUrl" :disabled="!urlInput.trim() || urlLoading"
              class="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:bg-[#333] disabled:text-gray-500 rounded-lg text-sm text-white transition-colors">
              {{ urlLoading ? '取得中...' : '情報を取得' }}
            </button>
            <button @click="downloadUrl" :disabled="!urlInput.trim()"
              class="flex-1 py-2 bg-[#222] hover:bg-[#333] disabled:opacity-50 border border-[#333] rounded-lg text-sm text-white transition-colors">
              ⬇ ダウンロード
            </button>
          </div>
        </div>

        <!-- 動画情報 -->
        <div v-if="urlVideoInfo" class="bg-[#1a1a1a] rounded-xl p-4 mb-5">
          <div class="flex gap-3">
            <img v-if="urlVideoInfo.thumbnail" :src="(urlVideoInfo.thumbnail as string)"
              class="w-32 aspect-video object-cover rounded flex-shrink-0" />
            <div class="min-w-0">
              <h3 class="text-sm font-medium mb-1 truncate">{{ urlVideoInfo.title as string }}</h3>
              <p class="text-xs text-gray-400">{{ urlVideoInfo.duration }}秒</p>
              <p class="text-xs text-gray-500 mt-1">{{ (urlVideoInfo.formats as unknown[])?.length }}フォーマット利用可能</p>
            </div>
          </div>
        </div>

        <!-- 対応サイト -->
        <div>
          <p class="text-xs text-gray-500 mb-3">yt-dlp対応サイト（主要）</p>
          <div class="flex flex-wrap gap-2">
            <span v-for="site in supportedSites" :key="site"
              class="text-xs bg-[#1a1a1a] text-gray-400 px-3 py-1 rounded-full border border-[#2a2a2a]">
              {{ site }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
