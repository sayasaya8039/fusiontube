<script setup lang="ts">
import { ref, onMounted } from 'vue'
import VideoCard from '../components/VideoCard.vue'

const videos = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const region = ref('JP')

async function loadTrending() {
  loading.value = true
  try {
    videos.value = await window.api.youtube.getTrending(region.value) as Record<string, unknown>[]
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

onMounted(loadTrending)
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-bold">🔥 トレンド</h1>
      <select v-model="region" @change="loadTrending"
        class="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none">
        <option value="JP">日本</option>
        <option value="US">アメリカ</option>
        <option value="GB">イギリス</option>
        <option value="KR">韓国</option>
      </select>
    </div>
    <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      <div v-for="i in 12" :key="i" class="rounded-xl overflow-hidden">
        <div class="aspect-video bg-[#1a1a1a] animate-pulse" />
      </div>
    </div>
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      <VideoCard v-for="v in videos" :key="(v.videoId as string)"
        :video-id="(v.videoId as string)" :title="(v.title as string)"
        :author="(v.author as string)"
        :thumbnail="((v.videoThumbnails as Record<string, unknown>[])?.[0]?.url as string)"
        :view-count="(v.viewCount as number)" :length-seconds="(v.lengthSeconds as number)"
        :published-text="(v.publishedText as string)" :published="(v.published as number)" />
    </div>
  </div>
</template>
