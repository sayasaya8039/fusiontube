<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore } from '../stores/settings'

const settingsStore = useSettingsStore()
const activeTab = ref('general')
const tabs = [
  { id: 'general', label: '一般' },
  { id: 'download', label: 'ダウンロード' },
  { id: 'player', label: 'プレイヤー' },
  { id: 'ai', label: 'AI要約' },
  { id: 'privacy', label: 'プライバシー' },
  { id: 'appearance', label: '外観' },
  { id: 'youtube', label: 'YouTubeアカウント' }
]
const invidiousInstances = [
  'https://iv.melmac.space',
  'https://invidious.slipfox.xyz',
  'https://invidious.private.coffee',
  'https://invidious.dhusch.de'
]
const historyCount = ref(0)
const importingSubscriptions = ref(false)
const importResult = ref<{ ok: boolean; message: string } | null>(null)
const loggingIn = ref(false)
const loginResult = ref<{ ok: boolean; message: string } | null>(null)

async function youtubeLogin() {
  loggingIn.value = true
  loginResult.value = null
  try {
    const result = await (window as Record<string, unknown>).api.youtube.login() as { success: boolean; cookiesPath: string; error?: string }
    if (result.success) {
      await settingsStore.save({ cookiesPath: result.cookiesPath })
      loginResult.value = { ok: true, message: `ログイン成功！クッキーを保存しました` }
    } else {
      loginResult.value = { ok: false, message: result.error || 'ログインがキャンセルされました' }
    }
  } catch (e) {
    loginResult.value = { ok: false, message: String(e) }
  } finally {
    loggingIn.value = false
  }
}

async function importYouTubeSubscriptions() {
  const apiKey = settingsStore.youtubeDataApiKey
  if (!apiKey) return
  importingSubscriptions.value = true
  importResult.value = null
  try {
    let pageToken = ''
    let total = 0
    do {
      const url = `https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json() as Record<string, unknown>
        const msg = ((err.error as Record<string, unknown>)?.message as string) || `Error ${res.status}`
        if (res.status === 401 || res.status === 403) {
          throw new Error('このAPIはOAuth認証が必要です。購読リストはOPMLインポートをご利用ください。')
        }
        throw new Error(msg)
      }
      const data = await res.json() as Record<string, unknown>
      const items = (data.items as Array<Record<string, unknown>>) || []
      for (const item of items) {
        const snippet = item.snippet as Record<string, unknown>
        const resourceId = snippet.resourceId as Record<string, unknown>
        await settingsStore.addSubscription({
          channelId: resourceId.channelId as string,
          channelName: snippet.title as string,
          thumbnail: ((snippet.thumbnails as Record<string, unknown>)?.default as Record<string, unknown>)?.url as string
        })
        total++
      }
      pageToken = (data.nextPageToken as string) || ''
    } while (pageToken)
    importResult.value = { ok: true, message: `${total}件のチャンネルをインポートしました` }
  } catch (e) {
    importResult.value = { ok: false, message: String(e) }
  } finally {
    importingSubscriptions.value = false
  }
}

onMounted(async () => {
  const s = await window.api.settings.get() as Record<string, unknown>
  historyCount.value = ((s.watchHistory as unknown[]) || []).length
})

async function clearHistory() {
  await window.api.settings.clearHistory()
  historyCount.value = 0
}
</script>

<template>
  <div class="p-6 h-full overflow-y-auto">
    <h1 class="text-xl font-bold mb-6">設定</h1>

    <div class="flex gap-0 mb-6 border-b border-[#2a2a2a]">
      <button v-for="tab in tabs" :key="tab.id" @click="activeTab = tab.id"
        :class="['px-5 py-2.5 text-sm transition-colors border-b-2 -mb-px',
          activeTab === tab.id ? 'border-red-500 text-white' : 'border-transparent text-gray-400 hover:text-white']">
        {{ tab.label }}
      </button>
    </div>

    <div class="max-w-3xl space-y-6">

      <!-- 一般 -->
      <template v-if="activeTab === 'general'">
        <div>
          <label class="block text-sm font-medium mb-2">Invidiousインスタンス</label>
          <select :value="settingsStore.invidiousInstance"
            @change="settingsStore.save({ invidiousInstance: ($event.target as HTMLSelectElement).value })"
            class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none mb-2">
            <option v-for="inst in invidiousInstances" :key="inst" :value="inst">{{ inst }}</option>
          </select>
          <input :value="settingsStore.invidiousInstance"
            @change="settingsStore.save({ invidiousInstance: ($event.target as HTMLInputElement).value })"
            placeholder="カスタムURL..."
            class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none" />
        </div>
        <div class="space-y-4">
          <div v-for="item in [
            { key: 'sponsorblockEnabled', label: 'SponsorBlock', desc: 'スポンサー・イントロ・アウトロをスキップ' },
            { key: 'dearrowEnabled', label: 'DeArrow', desc: 'サムネイル・タイトルをコミュニティ版に改善' }
          ]" :key="item.key" class="flex items-center justify-between py-2 border-b border-[#222]">
            <div>
              <p class="text-sm font-medium">{{ item.label }}</p>
              <p class="text-xs text-gray-400 mt-0.5">{{ item.desc }}</p>
            </div>
            <button @click="settingsStore.save({ [item.key]: !(settingsStore as Record<string,unknown>)[item.key] })"
              :class="['relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer',
                (settingsStore as Record<string,unknown>)[item.key] ? 'bg-red-500' : 'bg-[#333]']">
              <span :class="['absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200',
                (settingsStore as Record<string,unknown>)[item.key] ? 'translate-x-6' : 'translate-x-1']" />
            </button>
          </div>
        </div>
      </template>

      <!-- ダウンロード -->
      <template v-if="activeTab === 'download'">
        <div>
          <label class="block text-sm font-medium mb-2">保存先フォルダ</label>
          <input :value="settingsStore.downloadPath"
            @change="settingsStore.save({ downloadPath: ($event.target as HTMLInputElement).value })"
            placeholder="例: C:/Users/Owner/Videos/FusionTube"
            class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">
            同時ダウンロード数: {{ settingsStore.concurrentDownloads }}
          </label>
          <input type="range" min="1" max="10" :value="settingsStore.concurrentDownloads"
            @input="settingsStore.save({ concurrentDownloads: parseInt(($event.target as HTMLInputElement).value) })"
            class="w-full accent-red-500" />
          <div class="flex justify-between text-xs text-gray-500 mt-1"><span>1</span><span>10</span></div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">デフォルトフォーマット</label>
          <select :value="settingsStore.defaultFormat"
            @change="settingsStore.save({ defaultFormat: ($event.target as HTMLSelectElement).value })"
            class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
            <option value="mp4">MP4（動画）</option>
            <option value="mkv">MKV（動画）</option>
            <option value="webm">WebM（動画）</option>
            <option value="mp3">MP3（音声）</option>
            <option value="opus">Opus（音声）</option>
            <option value="flac">FLAC（音声・無劣化）</option>
          </select>
        </div>

        <!-- 高速DLモード（aria2） -->
        <div class="bg-[#1a1a1a] rounded-xl p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium">高速DLモード（aria2使用）</p>
              <p class="text-xs text-gray-400 mt-0.5">
                aria2cによる16並列ダウンロードで高速化（通常の3〜5倍速）
              </p>
            </div>
            <button @click="settingsStore.save({ fastMode: !settingsStore.fastMode })"
              :class="['relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer',
                settingsStore.fastMode ? 'bg-red-500' : 'bg-[#333]']">
              <span :class="['absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200',
                settingsStore.fastMode ? 'translate-x-6' : 'translate-x-1']" />
            </button>
          </div>
          <div v-if="settingsStore.fastMode" class="mt-3 pt-3 border-t border-[#333]">
            <div class="flex items-center gap-2 text-xs text-green-400">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>高速モード有効 - aria2c x16並列接続</span>
            </div>
            <p class="text-xs text-gray-500 mt-1">
              yt-dlpの外部ダウンローダーとしてaria2cを使用します。
              大容量ファイルのダウンロードが大幅に高速化されます。
            </p>
          </div>
        </div>
      </template>

      <!-- プレイヤー -->
      <template v-if="activeTab === 'player'">
        <div>
          <label class="block text-sm font-medium mb-2">外部プレイヤー</label>
          <select :value="settingsStore.externalPlayer"
            @change="settingsStore.save({ externalPlayer: ($event.target as HTMLSelectElement).value })"
            class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none mb-2">
            <option value="">なし（内蔵プレイヤー）</option>
            <option value="vlc">VLC</option>
            <option value="mpv">mpv</option>
            <option value="custom">カスタム</option>
          </select>
          <input v-if="settingsStore.externalPlayer"
            :value="settingsStore.externalPlayerPath"
            @change="settingsStore.save({ externalPlayerPath: ($event.target as HTMLInputElement).value })"
            placeholder="例: C:/Program Files/VLC/vlc.exe"
            class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none" />
        </div>

        <!-- Enhancer Playback Controls: 2カラムカード -->
        <div class="grid grid-cols-2 gap-4">
          <!-- 左カード: 再生速度 -->
          <div class="bg-[#1a1a1a] rounded-xl p-4 space-y-4">
            <p class="text-sm font-bold">再生速度</p>

            <div>
              <label class="block text-xs text-gray-400 mb-1.5">デフォルト再生速度</label>
              <select :value="settingsStore.defaultPlaybackSpeed"
                @change="settingsStore.save({ defaultPlaybackSpeed: parseFloat(($event.target as HTMLSelectElement).value) })"
                class="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#555]">
                <option v-for="s in [0.07,0.1,0.25,0.5,0.75,1.0,1.25,1.5,1.75,2.0,2.5,3.0,4.0,5.0,8.0,10.0,16.0]"
                  :key="s" :value="s">{{ s }}</option>
              </select>
            </div>

            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" :checked="settingsStore.forceDefaultSpeed"
                @change="settingsStore.save({ forceDefaultSpeed: ($event.target as HTMLInputElement).checked })"
                class="accent-red-500 w-4 h-4 rounded" />
              <span class="text-gray-300">デフォルトの再生速度を上書きする</span>
            </label>

            <div>
              <label class="block text-xs text-gray-400 mb-1.5">マウスホイールや再生速度+-ボタンでの速度変化</label>
              <select :value="settingsStore.speedStep"
                @change="settingsStore.save({ speedStep: parseFloat(($event.target as HTMLSelectElement).value) })"
                class="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#555]">
                <option v-for="s in [0.01,0.02,0.05,0.1,0.25,0.5]" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>

            <label class="flex items-start gap-2 cursor-pointer text-sm">
              <input type="checkbox" :checked="settingsStore.wheelSpeedEnabled"
                @change="settingsStore.save({ wheelSpeedEnabled: ($event.target as HTMLInputElement).checked })"
                class="accent-red-500 w-4 h-4 rounded mt-0.5" />
              <span class="text-gray-300 leading-snug">Ctrlキーを押したままカーソルがプレイヤー上にあるときに、マウスホイールで再生速度を変更する</span>
            </label>

            <label class="flex items-center gap-2 cursor-pointer text-sm ml-6">
              <input type="checkbox" :checked="settingsStore.wheelSpeedRightClickOnly"
                @change="settingsStore.save({ wheelSpeedRightClickOnly: ($event.target as HTMLInputElement).checked })"
                class="accent-red-500 w-4 h-4 rounded"
                :disabled="!settingsStore.wheelSpeedEnabled" />
              <span :class="settingsStore.wheelSpeedEnabled ? 'text-gray-300' : 'text-gray-600'">右クリックしているときのみ</span>
            </label>
          </div>

          <!-- 右カード: 音量 -->
          <div class="bg-[#1a1a1a] rounded-xl p-4 space-y-4">
            <p class="text-sm font-bold">音量</p>

            <div>
              <label class="flex items-center gap-2 cursor-pointer text-sm mb-2">
                <input type="checkbox" :checked="settingsStore.forceDefaultVolume"
                  @change="settingsStore.save({ forceDefaultVolume: ($event.target as HTMLInputElement).checked })"
                  class="accent-red-500 w-4 h-4 rounded" />
                <span class="text-gray-300">デフォルト音量レベル</span>
                <span class="text-xs text-gray-500 ml-auto">{{ settingsStore.defaultVolume }}</span>
              </label>
              <input type="range" min="0" max="100" step="1" :value="settingsStore.defaultVolume"
                @input="settingsStore.save({ defaultVolume: parseFloat(($event.target as HTMLInputElement).value) })"
                class="w-full accent-red-500" />
              <div class="flex justify-between text-xs text-gray-500 mt-0.5"><span>0</span><span>100</span></div>
            </div>

            <div>
              <label class="block text-xs text-gray-400 mb-1.5">ボリュームブーストレベル</label>
              <select :value="settingsStore.volumeBoostLevel"
                @change="settingsStore.save({ volumeBoostLevel: parseInt(($event.target as HTMLSelectElement).value) })"
                class="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#555]">
                <option v-for="n in 11" :key="n-1" :value="n-1">{{ n - 1 }}</option>
              </select>
            </div>

            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" :checked="settingsStore.autoVolumeBoost"
                @change="settingsStore.save({ autoVolumeBoost: ($event.target as HTMLInputElement).checked })"
                class="accent-red-500 w-4 h-4 rounded" />
              <span class="text-gray-300">自動で音量を上げる</span>
            </label>

            <label class="flex items-start gap-2 cursor-pointer text-sm">
              <input type="checkbox" :checked="settingsStore.wheelVolumeEnabled"
                @change="settingsStore.save({ wheelVolumeEnabled: ($event.target as HTMLInputElement).checked })"
                class="accent-red-500 w-4 h-4 rounded mt-0.5" />
              <span class="text-gray-300 leading-snug">カーソルがプレイヤー上にあるときにマウスホイールで音量を変更する</span>
            </label>

            <label class="flex items-center gap-2 cursor-pointer text-sm ml-6">
              <input type="checkbox" :checked="settingsStore.wheelVolumeRightClickOnly"
                @change="settingsStore.save({ wheelVolumeRightClickOnly: ($event.target as HTMLInputElement).checked })"
                class="accent-red-500 w-4 h-4 rounded"
                :disabled="!settingsStore.wheelVolumeEnabled" />
              <span :class="settingsStore.wheelVolumeEnabled ? 'text-gray-300' : 'text-gray-600'">右クリックしているときのみ</span>
            </label>

            <div>
              <label class="block text-xs text-gray-400 mb-1.5">マウスホイールが回転したときの音量変化</label>
              <select :value="settingsStore.wheelVolumeStep"
                @change="settingsStore.save({ wheelVolumeStep: parseFloat(($event.target as HTMLSelectElement).value) })"
                class="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#555]">
                <option v-for="s in [1,2,5,10,15,20]" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>
        </div>

        <div class="bg-[#1a1a1a] rounded-xl p-4">
          <p class="text-sm font-medium mb-3">キーボードショートカット</p>
          <div class="grid grid-cols-2 gap-y-2 text-xs">
            <span class="text-gray-400">スペース</span><span class="text-gray-200">再生 / 一時停止</span>
            <span class="text-gray-400">← / →</span><span class="text-gray-200">5秒スキップ</span>
            <span class="text-gray-400">↑ / ↓</span><span class="text-gray-200">音量 ±10%</span>
            <span class="text-gray-400">F</span><span class="text-gray-200">フルスクリーン</span>
            <span class="text-gray-400">M</span><span class="text-gray-200">ミュート</span>
            <span class="text-gray-400">Ctrl+D</span><span class="text-gray-200">この動画を保存</span>
            <span class="text-gray-400">Ctrl+ホイール</span><span class="text-gray-200">再生速度変更</span>
            <span class="text-gray-400">ホイール</span><span class="text-gray-200">音量変更（プレイヤー上）</span>
          </div>
        </div>
      </template>

      <!-- AI要約 -->
      <template v-if="activeTab === 'ai'">
        <div class="flex items-center justify-between py-2">
          <div>
            <p class="text-sm font-medium">AI要約機能</p>
            <p class="text-xs text-gray-400 mt-0.5">動画の字幕をAIで要約します</p>
          </div>
          <button @click="settingsStore.save({ aiEnabled: !settingsStore.aiEnabled })"
            :class="['relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 cursor-pointer',
              settingsStore.aiEnabled ? 'bg-red-500' : 'bg-[#333]']">
            <span :class="['inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200',
              settingsStore.aiEnabled ? 'translate-x-6' : 'translate-x-1']" />
          </button>
        </div>
        <div v-if="settingsStore.aiEnabled" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-2">AIモデル</label>
            <select :value="settingsStore.aiModel"
              @change="settingsStore.save({ aiModel: ($event.target as HTMLSelectElement).value })"
              class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
              <optgroup label="Google Gemini（推奨）">
                <option value="gemini-3-flash">Gemini 3 Flash - 最新・高速・無料枠あり</option>
                <option value="gemini-3-pro">Gemini 3 Pro（最高精度）</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </optgroup>
              <optgroup label="Anthropic Claude">
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6 - 最新（2026/2/17）</option>
                <option value="claude-opus-4-6">Claude Opus 4.6 - 最新・最高精度</option>
                <option value="claude-haiku-4-5">Claude Haiku 4.5（高速・安価）</option>
              </optgroup>
              <optgroup label="OpenAI GPT">
                <option value="gpt-5.2">GPT-5.2 - 最新デフォルト</option>
                <option value="gpt-4o">GPT-4o（API利用可）</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">API Key</label>
            <input :value="settingsStore.aiApiKey" type="password"
              @change="settingsStore.save({ aiApiKey: ($event.target as HTMLInputElement).value })"
              placeholder="sk-... または claude-..."
              class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none" />
            <p class="text-xs text-gray-500 mt-1">APIキーはローカルにのみ保存されます</p>
          </div>
        </div>
      </template>

      <!-- プライバシー -->
      <template v-if="activeTab === 'privacy'">
        <div class="bg-[#1a1a1a] rounded-xl p-4">
          <p class="text-sm font-medium mb-2">プライバシー保護</p>
          <p class="text-xs text-gray-400">FusionTubeはInvidiousプロキシ経由でアクセス。Googleへの追跡なし。</p>
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">プロキシ (SOCKS5)</label>
          <div class="flex items-center gap-3 mb-3">
            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" :checked="settingsStore.proxyEnabled"
                @change="settingsStore.save({ proxyEnabled: ($event.target as HTMLInputElement).checked })"
                class="accent-red-500 w-4 h-4" />
              プロキシを使用
            </label>
          </div>
          <input v-if="settingsStore.proxyEnabled" :value="settingsStore.proxyUrl"
            @change="settingsStore.save({ proxyUrl: ($event.target as HTMLInputElement).value })"
            placeholder="socks5://127.0.0.1:9050"
            class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none" />
        </div>
        <div>
          <p class="text-sm font-medium mb-2">視聴履歴</p>
          <p class="text-xs text-gray-400 mb-3">{{ historyCount }}件保存中</p>
          <button @click="clearHistory"
            class="px-4 py-2 bg-[#333] hover:bg-[#444] rounded-lg text-sm transition-colors">
            すべて削除
          </button>
        </div>
      </template>

      <!-- 外観 -->
      <template v-if="activeTab === 'appearance'">
        <div>
          <label class="block text-sm font-medium mb-2">テーマ</label>
          <div class="flex gap-2">
            <button v-for="[val, label] in [['dark','ダーク'],['light','ライト'],['system','システム']]"
              :key="val" @click="settingsStore.save({ theme: val })"
              :class="['px-4 py-2 rounded-lg text-sm transition-colors',
                settingsStore.theme === val ? 'bg-red-500 text-white' : 'bg-[#1a1a1a] text-gray-400 hover:bg-[#2a2a2a]']">
              {{ label }}
            </button>
          </div>
        </div>
        <div class="bg-[#1a1a1a] rounded-xl p-4 text-xs text-gray-400 space-y-1">
          <p class="text-white text-sm font-medium">アプリ情報</p>
          <p>FusionTube v1.0.0</p>
          <p>Electron 34 + Vue 3 + yt-dlp</p>
          <p>Invidious: {{ settingsStore.invidiousInstance }}</p>
        </div>
      </template>
      <!-- YouTubeアカウント連携 -->
      <template v-if="activeTab === 'youtube'">
        <!-- アプリ内ログイン（推奨） -->
        <div class="bg-[#1a1a1a] rounded-xl p-4">
          <p class="text-sm font-medium mb-1">YouTube ログイン（推奨）</p>
          <p class="text-xs text-gray-400 mb-3">
            アプリ内でGoogleアカウントにログインすると、bot検出を回避し
            メンバー限定・年齢制限動画を再生できるようになります。
          </p>
          <button @click="youtubeLogin"
            :disabled="loggingIn"
            class="w-full py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-[#333] disabled:text-gray-500 rounded-lg text-sm text-white font-medium transition-colors">
            {{ loggingIn ? 'ログイン中...' : 'YouTube にログイン' }}
          </button>
          <p v-if="loginResult" class="text-xs text-center mt-2" :class="loginResult.ok ? 'text-green-400' : 'text-red-400'">
            {{ loginResult.message }}
          </p>
          <p v-if="settingsStore.cookiesPath" class="text-xs text-green-400 mt-2">
            ログイン済み: {{ settingsStore.cookiesPath }}
          </p>
        </div>

        <!-- クッキー連携（手動） -->
        <div class="bg-[#1a1a1a] rounded-xl p-4">
          <p class="text-sm font-medium mb-1">手動クッキー設定</p>
          <p class="text-xs text-gray-400 mb-3">
            上記ログインが使えない場合、ブラウザから手動でクッキーを設定できます。
          </p>
          <div class="space-y-3">
            <!-- ブラウザ自動取得 -->
            <div>
              <label class="block text-xs text-gray-400 mb-1">ブラウザから自動取得（推奨）</label>
              <select :value="settingsStore.cookiesBrowser"
                @change="settingsStore.save({ cookiesBrowser: ($event.target as HTMLSelectElement).value })"
                class="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#555]">
                <option value="">使用しない</option>
                <option value="edge">Microsoft Edge</option>
                <option value="chrome">Google Chrome</option>
                <option value="firefox">Firefox</option>
                <option value="brave">Brave</option>
                <option value="vivaldi">Vivaldi</option>
                <option value="opera">Opera</option>
              </select>
              <p class="text-xs text-gray-500 mt-1">
                ブラウザを閉じた状態で使用してください。DPAPI復号エラーが出る場合はcookies.txtを使用してください。
              </p>
            </div>
            <!-- cookies.txt -->
            <div>
              <label class="block text-xs text-gray-400 mb-1">または cookies.txt のパス</label>
              <input :value="settingsStore.cookiesPath"
                @change="settingsStore.save({ cookiesPath: ($event.target as HTMLInputElement).value })"
                placeholder="C:/Users/Owner/cookies.txt"
                class="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#555]" />
            </div>
            <div class="bg-[#111] rounded-xl p-4 text-xs text-gray-400 space-y-2">
              <p class="text-white font-medium">cookies.txt の取得方法</p>
              <p>1. Chrome/Firefox に「Get cookies.txt LOCALLY」拡張をインストール</p>
              <p>2. YouTube にログインした状態で youtube.com を開く</p>
              <p>3. 拡張のアイコンをクリック → 「Export」でcookies.txtを保存</p>
              <p>4. 上のパスに保存先を入力</p>
              <p class="text-yellow-400">※ cookies.txt は他人に渡さないでください</p>
            </div>
          </div>
        </div>

        <!-- YouTube Data API -->
        <div class="bg-[#1a1a1a] rounded-xl p-4">
          <p class="text-sm font-medium mb-1">YouTube Data API（購読同期）</p>
          <p class="text-xs text-gray-400 mb-3">
            Google Cloud ConsoleでAPIキーを取得すると、
            YouTubeの購読リストを直接インポートできます。
          </p>
          <div class="space-y-3">
            <div>
              <label class="block text-xs text-gray-400 mb-1">YouTube Data API v3 キー</label>
              <input :value="settingsStore.youtubeDataApiKey"
                @change="settingsStore.save({ youtubeDataApiKey: ($event.target as HTMLInputElement).value })"
                placeholder="AIzaSy..."
                class="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#555]" />
            </div>
            <button @click="importYouTubeSubscriptions"
              :disabled="!settingsStore.youtubeDataApiKey || importingSubscriptions"
              class="w-full py-2 bg-red-500 hover:bg-red-600 disabled:bg-[#333] disabled:text-gray-500 rounded-lg text-sm text-white transition-colors">
              {{ importingSubscriptions ? 'インポート中...' : '購読リストをインポート' }}
            </button>
            <p v-if="importResult" class="text-xs text-center" :class="importResult.ok ? 'text-green-400' : 'text-red-400'">
              {{ importResult.message }}
            </p>
            <div class="bg-[#111] rounded-xl p-4 text-xs text-gray-400 space-y-1">
              <p class="text-white font-medium">APIキーの取得方法</p>
              <p>1. Google Cloud Console → プロジェクト作成</p>
              <p>2. YouTube Data API v3 を有効化</p>
              <p>3. 認証情報 → APIキーを作成</p>
            </div>
          </div>
        </div>
      </template>

    </div>
  </div>
</template>
