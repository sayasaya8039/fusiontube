<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import VideoCard from '../components/VideoCard.vue'

const route = useRoute()
const settingsStore = useSettingsStore()
const channelId = route.params.channelId as string
const channelInfo = ref<Record<string, unknown> | null>(null)
const videos = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const subscribed = ref(false)

onMounted(async () => {
  try {
    const [info, vids] = await Promise.all([
      window.api.youtube.getChannel(channelId) as Promise<Record<string, unknown>>,
      window.api.youtube.getChannelVideos(channelId, 1) as Promise<Record<string, unknown>[]>
    ])
    channelInfo.value = info
    videos.value = vids
    subscribed.value = settingsStore.isSubscribed.value(channelId)
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
})

async function toggleSubscription() {
  if (!channelInfo.value) return
  if (subscribed.value) {
    await settingsStore.removeSubscription(channelId)
    subscribed.value = false
  } else {
    await settingsStore.addSubscription({ channelId, channelName: channelInfo.value.author as string })
    subscribed.value = true
  }
}
</script>

<template>
  <div class="p-6">
    <div v-if="loading" class="animate-pulse"><div class="h-24 bg-[#1a1a1a] rounded-xl mb-4" /></div>
    <div v-else-if="channelInfo">
      <div class="flex items-center gap-4 mb-6 p-4 bg-[#1a1a1a] rounded-xl">
        <div class="w-16 h-16 bg-[#333] rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0">
          {{ (channelInfo.author as string)?.[0] }}
        </div>
        <div class="flex-1">
          <h1 class="text-xl font-bold">{{ channelInfo.author as string }}</h1>
          <p class="text-sm text-gray-400">{{ (channelInfo.subscriberCount as number)?.toLocaleString() }}人の登録者</p>
        </div>
        <button @click="toggleSubscription"
          :class="['px-5 py-2 rounded-full text-sm font-medium transition-colors',
            subscribed ? 'bg-[#333] text-gray-300 hover:bg-[#444]' : 'bg-white text-black hover:bg-gray-200']">
          {{ subscribed ? '✓ 登録済み' : '登録' }}
        </button>
      </div>
      <h2 class="text-sm font-medium mb-4 text-gray-300">動画</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <VideoCard v-for="v in videos" :key="(v.videoId as string)"
          :video-id="(v.videoId as string)" :title="(v.title as string)"
          :author="(channelInfo.author as string)"
          :thumbnail="((v.videoThumbnails as Record<string, unknown>[])?.[0]?.url as string)"
          :view-count="(v.viewCount as number)" :length-seconds="(v.lengthSeconds as number)"
          :published-text="(v.publishedText as string)" :published="(v.published as number)" />
      </div>
    </div>
  </div>
</template>
