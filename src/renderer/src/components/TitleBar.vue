<script setup lang="ts">
// Vue3テンプレートからwindow.api直接参照が効かない場合の対策
// script setup内で関数定義して確実に呼べるようにする
function minimize() {
  try {
    window.api.window.minimize()
  } catch (e) {
    console.error('minimize failed:', e)
  }
}
function maximize() {
  try {
    window.api.window.maximize()
  } catch (e) {
    console.error('maximize failed:', e)
  }
}
function closeWindow() {
  try {
    window.api.window.close()
  } catch (e) {
    console.error('close failed:', e)
  }
}
</script>

<template>
  <div class="flex items-center h-8 border-b select-none flex-shrink-0 app-region-drag px-3" style="background: var(--surface); border-color: var(--border)">
    <!-- ロゴ・タイトル -->
    <div class="flex items-center gap-2 mr-auto app-region-no-drag">
      <div class="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
        <span class="text-white text-[8px] font-bold leading-none">F</span>
      </div>
      <span class="text-xs text-gray-400 font-medium">FusionTube</span>
    </div>

    <!-- ウィンドウ制御ボタン -->
    <div class="flex items-center gap-0.5 app-region-no-drag">
      <button
        @click.stop="minimize"
        class="w-8 h-6 hover:bg-[#333] rounded flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        title="最小化"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
          <rect width="10" height="1"/>
        </svg>
      </button>
      <button
        @click.stop="maximize"
        class="w-8 h-6 hover:bg-[#333] rounded flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        title="最大化"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="0.5" y="0.5" width="8" height="8"/>
        </svg>
      </button>
      <button
        @click.stop="closeWindow"
        class="w-8 h-6 hover:bg-red-600 rounded flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        title="閉じる"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" stroke="currentColor" stroke-width="1.2">
          <line x1="0" y1="0" x2="9" y2="9"/>
          <line x1="9" y1="0" x2="0" y2="9"/>
        </svg>
      </button>
    </div>
  </div>
</template>
