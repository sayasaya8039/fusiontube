import { ipcMain } from 'electron'

interface SponsorSegment {
  category: string
  segment: [number, number]
  UUID: string
  actionType: string
}

export function registerSponsorBlockHandlers(): void {
  ipcMain.handle('sponsorblock:getSegments', async (_, videoId: string, categories: string[]) => {
    try {
      const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${encodeURIComponent(JSON.stringify(categories))}`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return []
      const data = await res.json() as SponsorSegment[]
      return data.filter(s => s.actionType === 'skip')
    } catch {
      return []
    }
  })
}
