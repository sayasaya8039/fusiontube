<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDownloadStore } from '../stores/downloads'
import { useSettingsStore } from '../stores/settings'

const downloadStore = useDownloadStore()
const settingsStore = useSettingsStore()

// 入力
const urlsInput = ref('')
const showAdvanced = ref(false)
const format = ref('mp4')
const quality = ref('best')
const audioOnly = ref(false)
const subtitles = ref(false)
const embedThumbnail = ref(true)
const customArgs = ref('')

const formats = [
  { value: 'mp4', label: 'MP4 (動画)' },
  { value: 'mkv', label: 'MKV (動画)' },
  { value: 'webm', label: 'WebM (動画)' },
  { value: 'mp3', label: 'MP3 (音声)' },
  { value: 'opus', label: 'Opus (音声)' },
  { value: 'flac', label: 'FLAC (音声・無劣化)' }
]
const qualities = [
  { value: 'best', label: '最高画質' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: 'audio', label: '音声のみ' }
]

async function addDownloads() {
  const urls = urlsInput.value.split('\n').map(u => u.trim()).filter(u => u.length > 0)
  if (urls.length === 0) return
  const settings = await window.api.settings.get() as Record<string, unknown>
  const outputPath = (settings.downloadPath as string) || 'C:/Users/Public/Videos'
  const isAudio = audioOnly.value || quality.value === 'audio' || ['mp3', 'opus', 'flac'].includes(format.value)
  
  for (const url of urls) {
    const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/)
    const customArgsList = customArgs.value.trim() ? customArgs.value.trim().split(' ') : []
    
    downloadStore.addToQueue({
      id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      title: match?.[1] || url.slice(-20),
      outputPath,
      format: isAudio ? (format.value === 'mp4' ? 'mp3' : format.value) : format.value,
      quality: quality.value,
      audioOnly: isAudio,
      subtitles: subtitles.value,
      embedThumbnail: embedThumbnail.value,
      customArgs: customArgsList
    })
  }
  urlsInput.value = ''
}

const statusText: Record<string, string> = {
  queued: '待機中', downloading: 'ダウンロード中', merging: '処理中',
  completed: '完了', error: 'エラー', cancelled: 'キャンセル', paused: '一時停止'
}
const statusColor: Record<string, string> = {
  queued: 'text-gray-400', downloading: 'text-blue-400', merging: 'text-yellow-400',
  completed: 'text-green-400', error: 'text-red-400', cancelled: 'text-gray-500', paused: 'text-orange-400'
}

const stats = computed(() => ({
  total: downloadStore.queue.length,
  active: downloadStore.queue.filter(d => d.status === 'downloading' || d.status === 'merging').length,
  done: downloadStore.queue.filter(d => d.status === 'completed').length,
  queued: downloadStore.queue.filter(d => d.status === 'queued').length
}))
</script>

<template>
  <div class="p-6 h-full overflow-y-auto">
    <h1 class="text-xl font-bold mb-6">ダウンロード</h1>

    <!-- 追加フォーム -->
    <div class="bg-[#1a1a1a] rounded-xl p-4 mb-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-medium text-gray-300">URLを追加（1行1URL・複数可）</h2>
        <button @click="showAdvanced = !showAdvanced"
          class="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 hover:bg-[#333] rounded">
          {{ showAdvanced ? '▲ 詳細設定を閉じる' : '▼ 詳細設定' }}
        </button>
      </div>

      <textarea v-model="urlsInput" rows="3"
        placeholder="https://www.youtube.com/watch?v=...&#10;https://www.youtube.com/playlist?list=...&#10;（複数URLは改行区切り）"
        class="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#555] resize-none mb-3 font-mono" />

      <!-- 基本設定 -->
      <div class="flex flex-wrap gap-3 mb-3">
        <div class="flex-1 min-w-32">
          <label class="block text-xs text-gray-400 mb-1">フォーマット</label>
          <select v-model="format" @change="audioOnly = ['mp3','opus','flac'].includes(format)"
            class="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-sm text-white focus:outline-none">
            <option v-for="f in formats" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </div>
        <div class="flex-1 min-w-32" v-if="!audioOnly && !['mp3','opus','flac'].includes(format)">
          <label class="block text-xs text-gray-400 mb-1">画質</label>
          <select v-model="quality"
            class="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-sm text-white focus:outline-none">
            <option v-for="q in qualities" :key="q.value" :value="q.value">{{ q.label }}</option>
          </select>
        </div>
      </div>

      <!-- 詳細設定 -->
      <div v-if="showAdvanced" class="border-t border-[#333] pt-3 mb-3 space-y-3">
        <div class="flex flex-wrap gap-4 text-sm">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" v-model="subtitles" class="accent-red-500 w-4 h-4" />
            <span class="text-gray-300">字幕を埋め込む</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" v-model="embedThumbnail" class="accent-red-500 w-4 h-4" />
            <span class="text-gray-300">サムネイル埋め込み</span>
          </label>
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">カスタム yt-dlp フラグ（スペース区切り）</label>
          <input v-model="customArgs" placeholder="例: --sponsorblock-remove sponsor --no-playlist"
            class="w-full bg-[#111] border border-[#333] rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none font-mono" />
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">保存先フォルダ</label>
          <input :value="settingsStore.downloadPath" @change="settingsStore.save({ downloadPath: ($event.target as HTMLInputElement).value })"
            placeholder="C:/Users/Owner/Videos/FusionTube"
            class="w-full bg-[#111] border border-[#333] rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none" />
        </div>
      </div>

      <button @click="addDownloads" :disabled="!urlsInput.trim()"
        class="w-full py-2 bg-red-500 hover:bg-red-600 disabled:bg-[#333] disabled:text-gray-500 rounded-lg text-sm font-medium text-white transition-colors">
        キューに追加
      </button>
    </div>

    <!-- 統計バー -->
    <div class="flex gap-4 mb-4 text-xs text-gray-400">
      <span>全{{ stats.total }}件</span>
      <span v-if="stats.queued > 0">⏳ 待機{{ stats.queued }}</span>
      <span v-if="stats.active > 0" class="text-blue-400">⬇ 実行中{{ stats.active }}</span>
      <span v-if="stats.done > 0" class="text-green-400">✓ 完了{{ stats.done }}</span>
      <button v-if="downloadStore.queue.some(d => d.status === 'completed')"
        @click="downloadStore.queue = downloadStore.queue.filter(d => d.status !== 'completed')"
        class="ml-auto text-gray-500 hover:text-white transition-colors">完了済みを削除</button>
    </div>

    <!-- キューリスト -->
    <div class="space-y-2">
      <div v-for="item in downloadStore.queue" :key="item.id"
        class="bg-[#1a1a1a] rounded-xl p-3 flex items-center gap-3">
        <div class="w-16 h-9 flex-shrink-0 rounded overflow-hidden bg-[#111]">
          <img v-if="item.thumbnail" :src="item.thumbnail" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-gray-700 text-lg">📹</div>
        </div>

        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium truncate">{{ item.title }}</p>
          <div v-if="item.status === 'downloading' || item.status === 'merging'" class="mt-1">
            <div class="bg-[#333] rounded-full h-1 overflow-hidden">
              <div class="bg-red-500 h-full transition-all duration-300" :style="{ width: `${item.progress}%` }" />
            </div>
            <p class="text-xs text-gray-500 mt-0.5">
              {{ item.progress.toFixed(1) }}%
              <span v-if="item.speed"> · {{ item.speed }}</span>
              <span v-if="item.eta"> · {{ item.eta }}</span>
            </p>
          </div>
          <div v-else class="mt-0.5">
            <div class="flex items-center gap-2">
              <span :class="['text-xs', statusColor[item.status] || 'text-gray-400']">
                {{ statusText[item.status] || item.status }}
              </span>
              <span class="text-xs text-gray-600">{{ item.format.toUpperCase() }}</span>
            </div>
            <p v-if="item.status === 'error' && item.errorMessage"
              class="text-xs text-red-400/70 mt-1 truncate max-w-md" :title="item.errorMessage">
              {{ item.errorMessage.slice(0, 120) }}
            </p>
          </div>
        </div>

        <div class="flex gap-1 flex-shrink-0">
          <button v-if="item.status === 'downloading'"
            @click="downloadStore.cancelDownload(item.id)"
            class="text-xs px-2 py-1 text-gray-400 hover:text-white hover:bg-[#333] rounded transition-colors">
            停止
          </button>
          <template v-else-if="item.status === 'completed'">
            <button @click="downloadStore.openFolder(item.id)"
              class="text-xs px-2 py-1 text-gray-400 hover:text-white hover:bg-[#333] rounded transition-colors"
              title="保存先フォルダを開く">
              📂
            </button>
            <button v-if="item.filePath" @click="downloadStore.openFile(item.id)"
              class="text-xs px-2 py-1 text-gray-400 hover:text-white hover:bg-[#333] rounded transition-colors"
              title="ファイルを再生">
              ▶
            </button>
            <button @click="downloadStore.removeFromQueue(item.id)"
              class="text-xs px-2 py-1 text-gray-400 hover:text-white hover:bg-[#333] rounded transition-colors">
              削除
            </button>
          </template>
          <button v-else-if="item.status !== 'queued' && item.status !== 'merging'"
            @click="downloadStore.removeFromQueue(item.id)"
            class="text-xs px-2 py-1 text-gray-400 hover:text-white hover:bg-[#333] rounded transition-colors">
            削除
          </button>
        </div>
      </div>

      <div v-if="downloadStore.queue.length === 0" class="text-center py-16">
        <p class="text-4xl mb-3">📥</p>
        <p class="text-gray-500 text-sm">ダウンロードキューは空です</p>
        <p class="text-gray-600 text-xs mt-1">URLを貼り付けるか、動画ページの「保存」ボタンを使用</p>
      </div>
    </div>
  </div>
</template>
