<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VideoCard from '../components/VideoCard.vue'

const route = useRoute()
const router = useRouter()
const query = ref('')
const results = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const showFilters = ref(false)
const sortBy = ref('relevance')
const dateFilter = ref('')

const sortOptions = [['relevance','関連度'],['date','新しい順'],['views','再生数'],['rating','評価順']]
const dateOptions = [['','すべて'],['hour','1時間以内'],['today','今日'],['week','今週'],['month','今月'],['year','今年']]

async function doSearch(q: string) {
  if (!q.trim()) return
  loading.value = true
  results.value = []
  try {
    const data = await window.api.youtube.search(q, 1) as Record<string, unknown>[]
    results.value = data.filter(r => r.type === 'video')
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

function handleSearch(e: Event) {
  e.preventDefault()
  if (query.value.trim()) {
    router.push({ name: 'search', query: { q: query.value.trim() } })
    doSearch(query.value.trim())
  }
}

watch(() => route.query.q, (q) => {
  if (q) { query.value = q as string; doSearch(q as string) }
}, { immediate: true })
</script>

<template>
  <div class="p-6">
    <form @submit="handleSearch" class="mb-4">
      <div class="flex gap-2 max-w-3xl">
        <input v-model="query" type="text" placeholder="動画を検索..."
          class="flex-1 bg-[#1a1a1a] border border-[#333] rounded-full px-5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#555]" />
        <button type="submit" class="bg-[#1a1a1a] border border-[#333] hover:bg-[#2a2a2a] rounded-full px-5 py-2.5 text-sm transition-colors">
          🔍 検索
        </button>
        <button type="button" @click="showFilters = !showFilters"
          :class="['px-4 py-2 rounded-full text-sm transition-colors border',
            showFilters ? 'border-red-500 text-red-400 bg-red-500/10' : 'border-[#333] text-gray-400 hover:bg-[#1a1a1a]']">
          フィルタ
        </button>
      </div>
    </form>

    <div v-if="showFilters" class="bg-[#1a1a1a] rounded-xl p-4 mb-5 flex flex-wrap gap-5">
      <div>
        <label class="text-xs text-gray-400 block mb-1.5">並び順</label>
        <div class="flex gap-1.5 flex-wrap">
          <button v-for="[val,label] in sortOptions" :key="val"
            @click="sortBy = val; doSearch(query)"
            :class="['px-3 py-1 rounded text-xs transition-colors',
              sortBy === val ? 'bg-red-500 text-white' : 'bg-[#222] text-gray-400 hover:bg-[#333]']">
            {{ label }}
          </button>
        </div>
      </div>
      <div>
        <label class="text-xs text-gray-400 block mb-1.5">投稿日</label>
        <div class="flex gap-1.5 flex-wrap">
          <button v-for="[val,label] in dateOptions" :key="val"
            @click="dateFilter = val; doSearch(query)"
            :class="['px-3 py-1 rounded text-xs transition-colors',
              dateFilter === val ? 'bg-red-500 text-white' : 'bg-[#222] text-gray-400 hover:bg-[#333]']">
            {{ label }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      <div v-for="i in 8" :key="i" class="rounded-xl overflow-hidden">
        <div class="aspect-video bg-[#1a1a1a] animate-pulse" />
      </div>
    </div>
    <div v-else-if="results.length > 0">
      <p class="text-xs text-gray-500 mb-4">「{{ query }}」の検索結果 {{ results.length }}件</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <VideoCard v-for="v in results" :key="(v.videoId as string)"
          :video-id="(v.videoId as string)" :title="(v.title as string)" :author="(v.author as string)"
          :thumbnail="((v.videoThumbnails as Record<string,unknown>[])?.[0]?.url as string)"
          :view-count="(v.viewCount as number)" :length-seconds="(v.lengthSeconds as number)"
          :published-text="(v.publishedText as string)" :published="(v.published as number)" />
      </div>
    </div>
    <div v-else-if="query && !loading" class="text-center py-16 text-gray-500 text-sm">
      「{{ query }}」の検索結果はありません
    </div>
  </div>
</template>
