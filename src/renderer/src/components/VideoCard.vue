<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

interface Props {
  videoId: string
  title: string
  author?: string
  thumbnail?: string
  viewCount?: number
  lengthSeconds?: number
  publishedText?: string
  published?: number
}

const props = defineProps<Props>()
const router = useRouter()

function formatRelativeJa(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec
  if (diff < 300) return '' // 5分未満は不正確データの可能性が高いので非表示
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`
  if (diff < 604800) return `${Math.floor(diff / 86400)}日前`
  if (diff < 2592000) return `${Math.floor(diff / 604800)}週間前`
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}ヶ月前`
  return `${Math.floor(diff / 31536000)}年前`
}

// 日本語のみで構成されたテキストかチェック（アラビア語等の混入を検出）
function isJapaneseText(text: string): boolean {
  return /^[\u0000-\u007F\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF00-\uFFEF\s\d]+$/.test(text)
}

const timeText = computed(() => {
  const pt = props.publishedText || ''
  // publishedText が日本語なら（hl=ja 有効）そのまま使う
  // ただし「0秒前」等の不正確値は除外
  if (pt && isJapaneseText(pt) && !pt.match(/^0[秒分]/)) {
    return pt
  }
  // publishedText が非日本語 or 空 → ローカル計算
  if (props.published && props.published > 0) {
    return formatRelativeJa(props.published)
  }
  return ''
})

const duration = computed(() => {
  if (!props.lengthSeconds) return ''
  const h = Math.floor(props.lengthSeconds / 3600)
  const m = Math.floor((props.lengthSeconds % 3600) / 60)
  const s = props.lengthSeconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
})

const views = computed(() => {
  if (!props.viewCount) return ''
  if (props.viewCount >= 100000000) return `${(props.viewCount / 100000000).toFixed(1)}億回`
  if (props.viewCount >= 10000) return `${(props.viewCount / 10000).toFixed(1)}万回`
  if (props.viewCount >= 1000) return `${Math.floor(props.viewCount / 1000)}K回`
  return `${props.viewCount}回`
})

function openVideo() {
  router.push({ name: 'watch', params: { videoId: props.videoId } })
}
</script>

<template>
  <div
    class="bg-[#1a1a1a] rounded-xl overflow-hidden cursor-pointer hover:bg-[#222] transition-all duration-150 group"
    @click="openVideo"
  >
    <div class="relative aspect-video bg-[#111] overflow-hidden">
      <img
        v-if="thumbnail"
        :src="thumbnail"
        :alt="title"
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        loading="lazy"
      />
      <div v-else class="w-full h-full flex items-center justify-center text-gray-700">
        <span class="text-4xl">📺</span>
      </div>
      <div
        v-if="duration"
        class="absolute bottom-1.5 right-1.5 bg-black/90 text-white text-xs px-1.5 py-0.5 rounded font-mono"
      >
        {{ duration }}
      </div>
    </div>
    <div class="p-3">
      <h3 class="text-sm font-medium text-white line-clamp-2 mb-1.5 group-hover:text-red-400 transition-colors leading-snug">
        {{ title }}
      </h3>
      <p v-if="author" class="text-xs text-gray-400 hover:text-gray-200 transition-colors mb-1">
        {{ author }}
      </p>
      <div class="flex items-center gap-2 text-xs text-gray-500">
        <span v-if="views">{{ views }}</span>
        <span v-if="views && timeText">·</span>
        <span v-if="timeText">{{ timeText }}</span>
      </div>
    </div>
  </div>
</template>
