<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import Sidebar from './components/Sidebar.vue'
import TitleBar from './components/TitleBar.vue'
import { useSettingsStore } from './stores/settings'

const settingsStore = useSettingsStore()
const loading = ref(true)
const updateAvailable = ref(false)
const updateInfo = ref<unknown>(null)

function setThemeClass(isDark: boolean) {
  const root = document.documentElement
  if (isDark) {
    root.classList.add('dark')
    root.classList.remove('light')
  } else {
    root.classList.add('light')
    root.classList.remove('dark')
  }
}

async function applyTheme(theme: string) {
  // まずnativeThemeを更新し、結果（OS判定含む）を取得
  const shouldUseDark = await window.api.theme.set(theme as 'dark' | 'light' | 'system') as boolean
  if (theme === 'system') {
    setThemeClass(shouldUseDark)
  } else {
    setThemeClass(theme === 'dark')
  }
}

watch(() => settingsStore.theme, (newTheme) => {
  applyTheme(newTheme)
})

onMounted(async () => {
  await settingsStore.init()
  await applyTheme(settingsStore.theme)
  loading.value = false

  // OSテーマ変更時のリアルタイム反映
  if (window.api.theme.onUpdated) {
    window.api.theme.onUpdated((isDark: boolean) => {
      if (settingsStore.theme === 'system') {
        setThemeClass(isDark)
      }
    })
  }

  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.on('updater:available', (_, info) => {
      updateAvailable.value = true
      updateInfo.value = info
    })
  }
})

async function downloadUpdate() {
  await window.api.updater?.download()
}
</script>

<template>
  <div class="flex flex-col h-screen select-none overflow-hidden" style="background: var(--bg); color: var(--text)">
    <TitleBar />
    <!-- 更新通知バー -->
    <div v-if="updateAvailable"
      class="flex items-center justify-between px-4 py-2 bg-blue-600 text-white text-xs flex-shrink-0">
      <span>🔄 新バージョンが利用可能です</span>
      <div class="flex gap-2">
        <button @click="downloadUpdate" class="px-3 py-1 bg-white text-blue-600 rounded font-medium hover:bg-gray-100">
          ダウンロード
        </button>
        <button @click="updateAvailable = false" class="text-blue-200 hover:text-white">✕</button>
      </div>
    </div>
    <div class="flex flex-1 overflow-hidden">
      <Sidebar />
      <main class="flex-1 overflow-y-auto">
        <RouterView v-if="!loading" />
        <div v-else class="flex items-center justify-center h-full">
          <div class="text-gray-400 text-sm">読み込み中...</div>
        </div>
      </main>
    </div>
  </div>
</template>
