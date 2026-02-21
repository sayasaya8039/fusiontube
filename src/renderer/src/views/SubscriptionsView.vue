<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import VideoCard from '../components/VideoCard.vue'
import { useSettingsStore } from '../stores/settings'
import { useRouter } from 'vue-router'

const settingsStore = useSettingsStore()
const router = useRouter()
const feedVideos = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const sortBy = ref<'date' | 'views'>('date')
const filterChannel = ref('')

async function loadFeed() {
  if (settingsStore.subscriptions.length === 0) { loading.value = false; return }
  loading.value = true
  try {
    const ids = settingsStore.subscriptions.map(s => s.channelId)
    feedVideos.value = await window.api.youtube.getSubscriptionFeed(ids) as Record<string, unknown>[]
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

const filteredVideos = computed(() => {
  let videos = [...feedVideos.value]
  if (filterChannel.value) {
    videos = videos.filter(v => (v.author as string)?.includes(filterChannel.value))
  }
  if (sortBy.value === 'views') {
    videos.sort((a, b) => (b.viewCount as number || 0) - (a.viewCount as number || 0))
  }
  return videos
})

async function exportSubscriptions() {
  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.1">
  <head><title>FusionTube Subscriptions</title></head>
  <body>
    <outline text="YouTube Subscriptions" title="YouTube Subscriptions">
      ${settingsStore.subscriptions.map(s =>
        `<outline text="${s.channelName}" title="${s.channelName}" type="rss" xmlUrl="https://www.youtube.com/feeds/videos.xml?channel_id=${s.channelId}" />`
      ).join('\n      ')}
    </outline>
  </body>
</opml>`
  const blob = new Blob([opml], { type: 'text/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'subscriptions.opml'; a.click()
  URL.revokeObjectURL(url)
}

onMounted(loadFeed)
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h1 class="text-xl font-bold">購読</h1>
        <p class="text-xs text-gray-400 mt-1">{{ settingsStore.subscriptions.length }}チャンネル登録済み</p>
      </div>
      <div class="flex gap-2">
        <button @click="loadFeed" class="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] rounded-lg text-xs transition-colors">
          🔄 更新
        </button>
        <button @click="exportSubscriptions" class="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] rounded-lg text-xs transition-colors">
          📤 OPML出力
        </button>
      </div>
    </div>

    <div v-if="feedVideos.length > 0" class="flex gap-3 mb-5">
      <input v-model="filterChannel" placeholder="チャンネルで絞り込み..."
        class="flex-1 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none" />
      <div class="flex gap-1">
        <button v-for="[s, label] in [['date','新着順'],['views','人気順']]" :key="s"
          @click="sortBy = s as 'date' | 'views'"
          :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', sortBy === s ? 'bg-red-500 text-white' : 'bg-[#1a1a1a] text-gray-400 hover:bg-[#2a2a2a]']">
          {{ label }}
        </button>
      </div>
    </div>

    <div v-if="settingsStore.subscriptions.length === 0" class="text-center py-16">
      <p class="text-4xl mb-4">📺</p>
      <p class="text-gray-400 text-sm mb-2">チャンネルを登録してフィードを表示</p>
      <p class="text-gray-600 text-xs">動画再生ページで「登録」ボタンをクリック</p>
    </div>
    <div v-else-if="loading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      <div v-for="i in 8" :key="i" class="rounded-xl overflow-hidden">
        <div class="aspect-video bg-[#1a1a1a] animate-pulse" />
      </div>
    </div>
    <div v-else-if="filteredVideos.length > 0" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      <VideoCard v-for="v in filteredVideos" :key="(v.videoId as string)"
        :video-id="(v.videoId as string)" :title="(v.title as string)" :author="(v.author as string)"
        :thumbnail="((v.videoThumbnails as Record<string,unknown>[])?.[0]?.url as string)"
        :view-count="(v.viewCount as number)" :length-seconds="(v.lengthSeconds as number)"
        :published-text="(v.publishedText as string)" :published="(v.published as number)" />
    </div>
    <div v-else class="text-center py-12 text-gray-500 text-sm">フィードが空です</div>
  </div>
</template>
