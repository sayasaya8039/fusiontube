<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

interface LocalPlaylistVideo { videoId: string; title: string; author?: string; thumbnail?: string; lengthSeconds?: number }
interface LocalPlaylist { id: string; name: string; videos: LocalPlaylistVideo[]; createdAt: number }
interface YouTubePlaylist { playlistId: string; title: string; author: string; videoCount: number; addedAt: number }
interface PlaylistVideo { videoId: string; title: string; lengthSeconds: number; videoThumbnails: Array<{ url: string }> }
interface YTPlaylistItem { playlistId: string; title: string; videoCount: number; thumbnailUrl: string }

const router = useRouter()
const activeTab = ref<'account' | 'youtube' | 'local'>('account')
const loggedIn = ref(false)

// アカウントプレイリスト (InnerTube)
const accountPlaylists = ref<YTPlaylistItem[]>([])
const accountLoading = ref(true)
const accountError = ref('')

// アカウントプレイリスト動画
const accountSelectedId = ref('')
const accountSelectedTitle = ref('')
const accountVideos = ref<Record<string, unknown>[]>([])
const accountVideosLoading = ref(false)

// ローカルプレイリスト
const localPlaylists = ref<LocalPlaylist[]>([])
const newLocalName = ref('')
const localSelectedPlaylist = ref<LocalPlaylist | null>(null)

// YouTubeプレイリスト (URL追加)
const youtubePlaylists = ref<YouTubePlaylist[]>([])
const urlInput = ref('')
const addLoading = ref(false)
const addError = ref('')

// プレイリスト詳細
const selectedPlaylist = ref<YouTubePlaylist | null>(null)
const playlistVideos = ref<PlaylistVideo[]>([])
const videosLoading = ref(false)

async function load() {
  const s = await window.api.settings.get() as Record<string, unknown>
  localPlaylists.value = (s.localPlaylists as LocalPlaylist[]) || []
  youtubePlaylists.value = (s.youtubePlaylists as YouTubePlaylist[]) || []
}

// アカウントプレイリスト取得
async function loadAccountPlaylists() {
  accountLoading.value = true
  accountError.value = ''
  try {
    accountPlaylists.value = await window.api.youtube.userPlaylists() as YTPlaylistItem[]
  } catch (e) {
    accountError.value = 'プレイリスト取得に失敗しました'
  } finally {
    accountLoading.value = false
  }
}

async function openAccountPlaylist(pl: YTPlaylistItem) {
  accountSelectedId.value = pl.playlistId
  accountSelectedTitle.value = pl.title
  accountVideosLoading.value = true
  accountVideos.value = []
  try {
    accountVideos.value = await window.api.youtube.playlistVideos(pl.playlistId) as Record<string, unknown>[]
  } catch (e) {
    console.error(e)
  } finally {
    accountVideosLoading.value = false
  }
}

// YouTubeプレイリストを追加
async function addYouTubePlaylist() {
  const url = urlInput.value.trim()
  if (!url) return
  addLoading.value = true
  addError.value = ''
  try {
    const playlistId = await window.api.youtube.extractPlaylistId(url) as string | null
    if (!playlistId) throw new Error('URLからプレイリストIDを取得できませんでした')

    const info = await window.api.youtube.getPlaylist(playlistId) as Record<string, unknown>
    const playlist: YouTubePlaylist = {
      playlistId,
      title: info.title as string,
      author: info.author as string,
      videoCount: info.videoCount as number,
      addedAt: Date.now()
    }
    youtubePlaylists.value = await window.api.settings.addYouTubePlaylist(playlist) as YouTubePlaylist[]
    urlInput.value = ''
  } catch (e) {
    addError.value = String(e).replace('Error: ', '')
  } finally {
    addLoading.value = false
  }
}

async function removeYouTubePlaylist(playlistId: string) {
  youtubePlaylists.value = await window.api.settings.removeYouTubePlaylist(playlistId) as YouTubePlaylist[]
  if (selectedPlaylist.value?.playlistId === playlistId) selectedPlaylist.value = null
}

async function openPlaylist(pl: YouTubePlaylist) {
  selectedPlaylist.value = pl
  videosLoading.value = true
  playlistVideos.value = []
  try {
    const data = await window.api.youtube.getPlaylist(pl.playlistId) as Record<string, unknown>
    playlistVideos.value = (data.videos as PlaylistVideo[]) || []
  } catch (e) {
    console.error(e)
  } finally {
    videosLoading.value = false
  }
}

// ローカルプレイリスト
function openLocalPlaylist(pl: LocalPlaylist) {
  localSelectedPlaylist.value = pl
}

async function createLocalPlaylist() {
  if (!newLocalName.value.trim()) return
  localPlaylists.value.push({ id: `pl-${Date.now()}`, name: newLocalName.value.trim(), videos: [], createdAt: Date.now() })
  await window.api.settings.set({ localPlaylists: localPlaylists.value })
  newLocalName.value = ''
}

async function deleteLocalPlaylist(id: string) {
  localPlaylists.value = localPlaylists.value.filter(p => p.id !== id)
  if (localSelectedPlaylist.value?.id === id) localSelectedPlaylist.value = null
  await window.api.settings.set({ localPlaylists: localPlaylists.value })
}

// プレイリスト一括ダウンロード
async function downloadPlaylist(pl: YouTubePlaylist) {
  const s = await window.api.settings.get() as Record<string, unknown>
  const outputPath = (s.downloadPath as string) || 'C:/Users/Public/Videos'
  const url = `https://www.youtube.com/playlist?list=${pl.playlistId}`
  const { useDownloadStore } = await import('../stores/downloads')
  const downloadStore = useDownloadStore()
  downloadStore.addToQueue({
    id: `playlist-${pl.playlistId}-${Date.now()}`,
    url,
    title: `[プレイリスト] ${pl.title}`,
    outputPath, format: 'mp4', audioOnly: false, subtitles: false, embedThumbnail: true,
    customArgs: ['--yes-playlist']
  })
  router.push('/downloads')
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60); const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

onMounted(async () => {
  try {
    loggedIn.value = await window.api.youtube.isLoggedIn() as boolean
  } catch { loggedIn.value = false }

  if (loggedIn.value) {
    activeTab.value = 'account'
    loadAccountPlaylists()
  } else {
    activeTab.value = 'youtube'
  }
  load()
})
</script>

<template>
  <div class="p-6 h-full overflow-y-auto">
    <div class="flex items-center gap-5 mb-6 border-b border-[#222] pb-3">
      <button v-if="loggedIn"
        @click="activeTab = 'account'; accountSelectedId = ''; if (accountPlaylists.length === 0 && !accountLoading) loadAccountPlaylists()"
        :class="['text-sm font-medium transition-colors pb-3 -mb-3 border-b-2',
          activeTab === 'account' ? 'text-white border-red-500' : 'text-gray-500 border-transparent hover:text-gray-300']">
        🔑 マイプレイリスト
      </button>
      <button v-for="[tab, label] in [['youtube','📺 URLで追加'],['local','📋 ローカル']]"
        :key="tab" @click="activeTab = tab as 'account' | 'youtube' | 'local'; selectedPlaylist = null; accountSelectedId = ''; localSelectedPlaylist = null"
        :class="['text-sm font-medium transition-colors pb-3 -mb-3 border-b-2',
          activeTab === tab ? 'text-white border-red-500' : 'text-gray-500 border-transparent hover:text-gray-300']">
        {{ label }}
      </button>
    </div>

    <!-- マイプレイリスト (アカウント連携) -->
    <template v-if="activeTab === 'account'">
      <!-- 動画一覧 -->
      <div v-if="accountSelectedId">
        <div class="flex items-center gap-3 mb-5">
          <button @click="accountSelectedId = ''"
            class="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors">
            ← 戻る
          </button>
          <h2 class="text-base font-bold truncate flex-1">{{ accountSelectedTitle }}</h2>
        </div>

        <div v-if="accountVideosLoading" class="space-y-2">
          <div v-for="i in 8" :key="i" class="h-14 bg-[#1a1a1a] rounded-lg animate-pulse" />
        </div>
        <div v-else-if="accountVideos.length === 0" class="text-center py-12 text-gray-500 text-sm">
          動画がありません
        </div>
        <div v-else class="space-y-1">
          <div v-for="(v, idx) in accountVideos" :key="(v.videoId as string)"
            class="flex items-center gap-3 p-2 hover:bg-[#1a1a1a] rounded-lg cursor-pointer group transition-colors"
            @click="router.push(`/watch/${v.videoId}`)">
            <span class="text-xs text-gray-600 w-5 text-center flex-shrink-0">{{ idx + 1 }}</span>
            <img :src="((v.videoThumbnails as Record<string,unknown>[])?.[0]?.url as string)"
              class="w-16 aspect-video object-cover rounded flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm truncate group-hover:text-red-400 transition-colors">{{ v.title }}</p>
              <p class="text-xs text-gray-500">{{ v.author }} · {{ v.lengthSeconds ? formatDuration(v.lengthSeconds as number) : '' }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- プレイリスト一覧 -->
      <template v-else>
        <div v-if="accountLoading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <div v-for="i in 8" :key="i" class="rounded-xl overflow-hidden">
            <div class="aspect-video bg-[#1a1a1a] animate-pulse" />
            <div class="p-3 bg-[#1a1a1a] mt-0.5 rounded-b space-y-1.5">
              <div class="h-3 bg-[#2a2a2a] rounded animate-pulse" />
            </div>
          </div>
        </div>
        <div v-else-if="accountError" class="text-center py-16">
          <p class="text-4xl mb-4">⚠️</p>
          <p class="text-red-400 text-sm mb-4">{{ accountError }}</p>
          <button @click="loadAccountPlaylists"
            class="text-sm text-gray-300 hover:text-white px-4 py-2 bg-[#1a1a1a] hover:bg-[#222] rounded-lg transition-colors">
            再試行
          </button>
        </div>
        <div v-else-if="accountPlaylists.length === 0" class="text-center py-16">
          <p class="text-4xl mb-4">📺</p>
          <p class="text-gray-400 text-sm">プレイリストが見つかりません</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <div v-for="pl in accountPlaylists" :key="pl.playlistId"
            class="bg-[#1a1a1a] rounded-xl overflow-hidden hover:bg-[#222] transition-colors group cursor-pointer"
            @click="openAccountPlaylist(pl)">
            <div class="aspect-video bg-[#111] flex items-center justify-center relative overflow-hidden">
              <img v-if="pl.thumbnailUrl" :src="pl.thumbnailUrl"
                class="w-full h-full object-cover" loading="lazy" />
              <span v-else class="text-4xl">▶️</span>
              <div class="absolute bottom-0 right-0 bg-black/80 text-white text-xs px-2 py-1 rounded-tl">
                {{ pl.videoCount }}本
              </div>
            </div>
            <div class="p-3">
              <h3 class="text-sm font-medium truncate mb-1 group-hover:text-red-400">{{ pl.title }}</h3>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- YouTubeプレイリスト (URL追加) -->
    <template v-if="activeTab === 'youtube'">

      <!-- プレイリスト詳細表示 -->
      <div v-if="selectedPlaylist">
        <div class="flex items-center gap-3 mb-5">
          <button @click="selectedPlaylist = null; playlistVideos = []"
            class="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors">
            ← 戻る
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="text-base font-bold truncate">{{ selectedPlaylist.title }}</h2>
            <p class="text-xs text-gray-400">{{ selectedPlaylist.author }} · {{ selectedPlaylist.videoCount }}本</p>
          </div>
          <button @click="downloadPlaylist(selectedPlaylist)"
            class="px-4 py-1.5 bg-red-500 hover:bg-red-600 rounded-full text-sm text-white transition-colors flex-shrink-0">
            ⬇ 一括DL
          </button>
        </div>

        <div v-if="videosLoading" class="space-y-2">
          <div v-for="i in 8" :key="i" class="h-14 bg-[#1a1a1a] rounded-lg animate-pulse" />
        </div>
        <div v-else class="space-y-1">
          <div v-for="(v, idx) in playlistVideos" :key="v.videoId"
            class="flex items-center gap-3 p-2 hover:bg-[#1a1a1a] rounded-lg cursor-pointer group transition-colors"
            @click="router.push(`/watch/${v.videoId}`)">
            <span class="text-xs text-gray-600 w-5 text-center flex-shrink-0">{{ idx + 1 }}</span>
            <img :src="v.videoThumbnails?.[0]?.url" class="w-16 aspect-video object-cover rounded flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm truncate group-hover:text-red-400 transition-colors">{{ v.title }}</p>
              <p class="text-xs text-gray-500">{{ formatDuration(v.lengthSeconds) }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- プレイリスト一覧 -->
      <template v-else>
        <!-- URL追加フォーム -->
        <div class="bg-[#1a1a1a] rounded-xl p-4 mb-5">
          <label class="block text-sm font-medium mb-2">YouTubeプレイリストURLを追加</label>
          <div class="flex gap-2 mb-2">
            <input v-model="urlInput" type="text"
              placeholder="https://www.youtube.com/playlist?list=PL..."
              @keyup.enter="addYouTubePlaylist"
              class="flex-1 bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#555]" />
            <button @click="addYouTubePlaylist" :disabled="!urlInput.trim() || addLoading"
              class="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-[#333] disabled:text-gray-500 rounded-lg text-sm text-white transition-colors">
              {{ addLoading ? '取得中...' : '追加' }}
            </button>
          </div>
          <p v-if="addError" class="text-xs text-red-400">{{ addError }}</p>
          <p class="text-xs text-gray-500">動画ページのURLから「list=」部分を含むURLでも対応</p>
        </div>

        <!-- 登録済みプレイリスト -->
        <div v-if="youtubePlaylists.length === 0" class="text-center py-16">
          <p class="text-4xl mb-4">📺</p>
          <p class="text-gray-400 text-sm">YouTubeプレイリストがありません</p>
          <p class="text-gray-600 text-xs mt-2">上のフォームにプレイリストURLを貼り付けて追加</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <div v-for="pl in youtubePlaylists" :key="pl.playlistId"
            class="bg-[#1a1a1a] rounded-xl overflow-hidden hover:bg-[#222] transition-colors group cursor-pointer"
            @click="openPlaylist(pl)">
            <div class="aspect-video bg-[#111] flex items-center justify-center relative">
              <span class="text-4xl">▶️</span>
              <div class="absolute bottom-0 right-0 bg-black/80 text-white text-xs px-2 py-1 rounded-tl">
                {{ pl.videoCount }}本
              </div>
            </div>
            <div class="p-3">
              <h3 class="text-sm font-medium truncate mb-1 group-hover:text-red-400">{{ pl.title }}</h3>
              <p class="text-xs text-gray-400 truncate">{{ pl.author }}</p>
              <div class="flex gap-2 mt-2" @click.stop>
                <button @click="downloadPlaylist(pl)"
                  class="flex-1 text-xs py-1 bg-[#333] hover:bg-red-500 text-gray-300 hover:text-white rounded transition-colors">
                  ⬇ DL
                </button>
                <button @click="removeYouTubePlaylist(pl.playlistId)"
                  class="text-xs px-2 py-1 text-gray-500 hover:text-red-400 transition-colors">
                  削除
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- ローカルプレイリスト -->
    <template v-else-if="activeTab === 'local'">
      <!-- プレイリスト詳細表示 -->
      <div v-if="localSelectedPlaylist">
        <div class="flex items-center gap-3 mb-5">
          <button @click="localSelectedPlaylist = null"
            class="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors">
            ← 戻る
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="text-base font-bold truncate">{{ localSelectedPlaylist.name }}</h2>
            <p class="text-xs text-gray-400">{{ localSelectedPlaylist.videos.length }}本</p>
          </div>
          <button @click="deleteLocalPlaylist(localSelectedPlaylist.id)"
            class="text-xs px-3 py-1.5 text-gray-400 hover:text-red-400 hover:bg-[#1a1a1a] rounded-lg transition-colors">
            削除
          </button>
        </div>

        <div v-if="localSelectedPlaylist.videos.length === 0" class="text-center py-12 text-gray-500 text-sm">
          動画がありません
        </div>
        <div v-else class="space-y-1">
          <div v-for="(v, idx) in localSelectedPlaylist.videos" :key="v.videoId"
            class="flex items-center gap-3 p-2 hover:bg-[#1a1a1a] rounded-lg cursor-pointer group transition-colors"
            @click="router.push(`/watch/${v.videoId}`)">
            <span class="text-xs text-gray-600 w-5 text-center flex-shrink-0">{{ idx + 1 }}</span>
            <img v-if="v.thumbnail" :src="v.thumbnail"
              class="w-16 aspect-video object-cover rounded flex-shrink-0" loading="lazy" />
            <div v-else class="w-16 aspect-video bg-[#222] rounded flex-shrink-0 flex items-center justify-center text-xs text-gray-600">▶</div>
            <div class="flex-1 min-w-0">
              <p class="text-sm truncate group-hover:text-red-400 transition-colors">{{ v.title }}</p>
              <p class="text-xs text-gray-500">{{ v.author }}{{ v.lengthSeconds ? ' · ' + formatDuration(v.lengthSeconds) : '' }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- プレイリスト一覧 -->
      <template v-else>
        <div class="flex gap-2 mb-6 max-w-md">
          <input v-model="newLocalName" placeholder="新しいプレイリスト名..."
            @keyup.enter="createLocalPlaylist"
            class="flex-1 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none" />
          <button @click="createLocalPlaylist" :disabled="!newLocalName.trim()"
            class="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-[#333] disabled:text-gray-500 rounded-lg text-sm text-white transition-colors">
            作成
          </button>
        </div>
        <div v-if="localPlaylists.length === 0" class="text-center py-16">
          <p class="text-4xl mb-4">📋</p>
          <p class="text-gray-400 text-sm">ローカルプレイリストがありません</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <div v-for="pl in localPlaylists" :key="pl.id"
            class="bg-[#1a1a1a] rounded-xl overflow-hidden hover:bg-[#222] transition-colors group cursor-pointer"
            @click="openLocalPlaylist(pl)">
            <div class="aspect-video bg-[#111] flex items-center justify-center relative overflow-hidden">
              <img v-if="pl.videos[0]?.thumbnail" :src="pl.videos[0].thumbnail"
                class="w-full h-full object-cover" loading="lazy" />
              <span v-else class="text-4xl">📋</span>
              <div class="absolute bottom-0 right-0 bg-black/80 text-white text-xs px-2 py-1 rounded-tl">
                {{ pl.videos.length }}本
              </div>
            </div>
            <div class="p-3">
              <h3 class="text-sm font-medium truncate mb-1 group-hover:text-red-400">{{ pl.name }}</h3>
              <div class="flex gap-2 mt-2" @click.stop>
                <button @click="deleteLocalPlaylist(pl.id)"
                  class="text-xs px-2 py-1 text-gray-500 hover:text-red-400 transition-colors">
                  削除
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
