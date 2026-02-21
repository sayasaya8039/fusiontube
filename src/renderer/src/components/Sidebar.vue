<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useDownloadStore } from '../stores/downloads'

const route = useRoute()
const downloadStore = useDownloadStore()
const collapsed = ref(false)

const navItems = [
  { icon: 'home', label: 'ホーム', path: '/' },
  { icon: 'search', label: '検索', path: '/search' },
  { icon: 'subscriptions', label: '購読', path: '/subscriptions' },
  { icon: 'playlist', label: 'プレイリスト', path: '/playlists' },
  { icon: 'trending', label: 'トレンド', path: '/trending' },
  { icon: 'download', label: 'ダウンロード', path: '/downloads', badge: true }
]

const isActive = (path: string) => route.path === path
</script>

<template>
  <nav
    :class="[
      'flex flex-col border-r transition-all duration-200 flex-shrink-0',
      collapsed ? 'w-12' : 'w-52'
    ]"
    style="background: var(--surface); border-color: var(--border)"
  >
    <div class="flex-1 py-2 overflow-y-auto">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        :class="[
          'flex items-center gap-3 px-3 py-2 mx-1 rounded-lg transition-colors text-sm relative',
          isActive(item.path)
            ? 'sidebar-active'
            : 'sidebar-inactive'
        ]"
      >
        <svg class="w-[18px] h-[18px] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <!-- Home -->
          <template v-if="item.icon === 'home'">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </template>
          <!-- Search -->
          <template v-else-if="item.icon === 'search'">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </template>
          <!-- Subscriptions -->
          <template v-else-if="item.icon === 'subscriptions'">
            <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
            <polyline points="17 2 12 7 7 2" />
          </template>
          <!-- Playlist -->
          <template v-else-if="item.icon === 'playlist'">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </template>
          <!-- Trending -->
          <template v-else-if="item.icon === 'trending'">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </template>
          <!-- Download -->
          <template v-else-if="item.icon === 'download'">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </template>
        </svg>
        <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
        <span
          v-if="item.badge && downloadStore.activeCount > 0"
          class="absolute right-2 top-1.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center"
        >
          {{ downloadStore.activeCount }}
        </span>
      </RouterLink>
    </div>
    <div class="border-t py-2" style="border-color: var(--border)">
      <RouterLink
        to="/settings"
        :class="[
          'flex items-center gap-3 px-3 py-2 mx-1 rounded-lg transition-colors text-sm',
          isActive('/settings') ? 'sidebar-active' : 'sidebar-inactive'
        ]"
      >
        <svg class="w-[18px] h-[18px] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span v-if="!collapsed">設定</span>
      </RouterLink>
      <button
        @click="collapsed = !collapsed"
        class="flex items-center gap-3 px-3 py-2 mx-1 rounded-lg transition-colors text-sm sidebar-inactive w-full text-left"
      >
        <svg class="w-[18px] h-[18px] flex-shrink-0 transition-transform" :class="collapsed ? 'rotate-180' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="11 17 6 12 11 7" />
          <polyline points="18 17 13 12 18 7" />
        </svg>
        <span v-if="!collapsed">折りたたむ</span>
      </button>
    </div>
  </nav>
</template>
