import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'

export interface DownloadItem {
  id: string
  url: string
  title: string
  thumbnail?: string
  status: 'queued' | 'downloading' | 'merging' | 'completed' | 'error' | 'cancelled' | 'paused'
  progress: number
  speed: string
  eta: string
  size: string
  outputPath: string
  filePath?: string
  format: string
  quality?: string
  audioOnly: boolean
  subtitles: boolean
  embedThumbnail?: boolean
  customArgs?: string[]
  errorMessage?: string
}

export const useDownloadStore = defineStore('downloads', () => {
  const queue = ref<DownloadItem[]>([])
  const maxConcurrent = ref(3)

  function addToQueue(item: Omit<DownloadItem, 'status' | 'progress' | 'speed' | 'eta' | 'size'>) {
    const newItem: DownloadItem = { ...item, status: 'queued', progress: 0, speed: '', eta: '', size: '' }
    queue.value.push(newItem)
    processQueue()
  }

  function processQueue() {
    const active = queue.value.filter(d => d.status === 'downloading' || d.status === 'merging').length
    const pending = queue.value.filter(d => d.status === 'queued')
    const slots = maxConcurrent.value - active
    for (let i = 0; i < Math.min(slots, pending.length); i++) {
      startDownload(pending[i].id)
    }
  }

  async function startDownload(id: string) {
    const item = queue.value.find(d => d.id === id)
    if (!item) return
    if (item.status !== 'queued') return
    item.status = 'downloading'

    const unsub = window.api.download.onProgress(id, (p: unknown) => {
      const prog = p as { percent: number; speed: string; eta: string; size: string; status?: string }
      const found = queue.value.find(d => d.id === id)
      if (found) {
        found.progress = prog.percent || 0
        found.speed = prog.speed || ''
        found.eta = prog.eta || ''
        found.size = prog.size || ''
        if (prog.status === 'merging') found.status = 'merging'
      }
    })

    window.api.download.onComplete(id, (path: string) => {
      const found = queue.value.find(d => d.id === id)
      if (found) {
        found.status = 'completed'
        if (path) found.filePath = path
      }
      unsub()
      processQueue()
    })

    window.api.download.onError(id, (err: string) => {
      const found = queue.value.find(d => d.id === id)
      if (found) {
        found.status = 'error'
        found.errorMessage = err
      }
      console.error('Download error:', err)
      unsub()
      processQueue()
    })

    try {
      const settings = await window.api.settings.get() as Record<string, unknown>
      maxConcurrent.value = (settings.concurrentDownloads as number) || 3
      const rawItem = toRaw(item)
      const resultPath = await window.api.download.video({
        id,
        url: rawItem.url,
        outputPath: rawItem.outputPath,
        format: rawItem.format,
        quality: rawItem.quality,
        audioOnly: rawItem.audioOnly,
        subtitles: rawItem.subtitles,
        embedThumbnail: rawItem.embedThumbnail,
        customArgs: rawItem.customArgs ? [...rawItem.customArgs] : undefined,
        cookiesPath: (settings.cookiesPath as string) || undefined
      }) as string
      const found = queue.value.find(d => d.id === id)
      if (found && found.status !== 'completed' && found.status !== 'error') {
        found.status = 'completed'
        if (resultPath) found.filePath = resultPath
      }
    } catch (e) {
      const found = queue.value.find(d => d.id === id)
      if (found && found.status !== 'completed' && found.status !== 'error') {
        found.status = 'error'
        found.errorMessage = found.errorMessage || (e instanceof Error ? e.message : String(e))
      }
    } finally {
      processQueue()
    }
  }

  async function cancelDownload(id: string) {
    await window.api.download.cancel(id)
    const item = queue.value.find(d => d.id === id)
    if (item) item.status = 'cancelled'
    processQueue()
  }

  function removeFromQueue(id: string) {
    queue.value = queue.value.filter(d => d.id !== id)
  }

  async function openFolder(id: string) {
    const item = queue.value.find(d => d.id === id)
    if (!item) return
    const path = item.filePath || item.outputPath
    await window.api.shell.showItemInFolder(path)
  }

  async function openFile(id: string) {
    const item = queue.value.find(d => d.id === id)
    if (!item || !item.filePath) return
    await window.api.shell.openPath(item.filePath)
  }

  const activeCount = computed(() => queue.value.filter(d => d.status === 'downloading' || d.status === 'merging').length)
  const completedCount = computed(() => queue.value.filter(d => d.status === 'completed').length)

  return { queue, addToQueue, cancelDownload, removeFromQueue, openFolder, openFile, activeCount, completedCount }
})
