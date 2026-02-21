import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/watch/:videoId', name: 'watch', component: () => import('../views/WatchView.vue') },
    { path: '/search', name: 'search', component: () => import('../views/SearchView.vue') },
    { path: '/subscriptions', name: 'subscriptions', component: () => import('../views/SubscriptionsView.vue') },
    { path: '/downloads', name: 'downloads', component: () => import('../views/DownloadsView.vue') },
    { path: '/playlists', name: 'playlists', component: () => import('../views/PlaylistsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/channel/:channelId', name: 'channel', component: () => import('../views/ChannelView.vue') },
    { path: '/trending', name: 'trending', component: () => import('../views/TrendingView.vue') }
  ]
})
