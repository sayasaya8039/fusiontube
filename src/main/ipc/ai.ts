import { ipcMain } from 'electron'

function parseVttText(raw: string): string {
  return raw
    // VTTヘッダー・メタデータ
    .replace(/^WEBVTT[\s\S]*?\n\n/m, '')
    // NOTE ブロック
    .replace(/^NOTE[\s\S]*?\n\n/gm, '')
    // タイムスタンプ行（cue header含む）
    .replace(/^\d+\s*\n/gm, '')
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}.*\n?/g, '')
    // HTMLタグ
    .replace(/<[^>]+>/g, '')
    // 重複行を除去（YouTubeの自動字幕は同じテキストが連続する）
    .split('\n')
    .filter((line, i, arr) => line.trim() && line.trim() !== arr[i - 1]?.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseJson3Text(raw: string): string {
  try {
    const data = JSON.parse(raw)
    const events = data.events as Array<{ segs?: Array<{ utf8: string }> }>
    if (!events) return ''
    const lines: string[] = []
    for (const ev of events) {
      if (!ev.segs) continue
      const text = ev.segs.map(s => s.utf8).join('').trim()
      if (text && text !== '\n') lines.push(text)
    }
    // 重複除去
    return lines
      .filter((line, i, arr) => line !== arr[i - 1])
      .join('\n')
      .trim()
  } catch {
    return ''
  }
}

const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en;q=0.9',
  'Referer': 'https://www.youtube.com/'
}

export function registerAIHandlers(): void {
  ipcMain.handle('ai:summarize', async (_, text: string, apiKey: string, model: string) => {
    if (!apiKey) throw new Error('API Key が設定されていません')
    if (!text || text.length < 10) throw new Error('字幕テキストが取得できませんでした')

    console.log(`[ai:summarize] model=${model} textLen=${text.length}`)

    const isOpenAI = model.startsWith('gpt')
    const isGemini = model.startsWith('gemini')

    const prompt = `以下は動画の字幕テキストです。内容を日本語で箇条書き3〜5点で要約してください。\n\n---\n${text.slice(0, 12000)}\n---`

    if (isGemini) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048 }
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      })
      if (!res.ok) {
        const errText = await res.text()
        console.error(`[ai:summarize] Gemini error ${res.status}:`, errText)
        throw new Error(`Gemini API Error ${res.status}: ${errText}`)
      }
      const data = await res.json() as Record<string, unknown>
      console.log('[ai:summarize] Gemini raw response:', JSON.stringify(data).slice(0, 500))

      const candidates = data.candidates as Array<{
        content: { parts: Array<{ text: string }> }
        finishReason?: string
      }>
      if (!candidates || candidates.length === 0) {
        console.error('[ai:summarize] No candidates in response')
        throw new Error('AIからの応答がありません')
      }

      const finishReason = candidates[0]?.finishReason
      console.log('[ai:summarize] finishReason:', finishReason)

      // 全partsのテキストを結合
      const parts = candidates[0]?.content?.parts || []
      const result = parts.map(p => p.text).join('')
      console.log(`[ai:summarize] result length=${result.length}`)
      return result
    }

    if (isOpenAI) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'あなたは動画字幕を要約するアシスタントです。内容を日本語で箇条書き3〜5点で要約してください。' },
            { role: 'user', content: text.slice(0, 12000) }
          ],
          max_tokens: 2048
        }),
        signal: AbortSignal.timeout(60000)
      })
      if (!res.ok) {
        const errText = await res.text()
        console.error(`[ai:summarize] OpenAI error ${res.status}:`, errText)
        throw new Error(`OpenAI API Error ${res.status}: ${errText}`)
      }
      const data = await res.json() as Record<string, unknown>
      const choices = data.choices as Array<{ message: { content: string }; finish_reason?: string }>
      console.log(`[ai:summarize] OpenAI finish_reason=${choices[0]?.finish_reason} len=${choices[0]?.message?.content?.length}`)
      return choices[0]?.message?.content || ''
    }

    // Anthropic Claude API
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: prompt
        }]
      }),
      signal: AbortSignal.timeout(60000)
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error(`[ai:summarize] Claude error ${res.status}:`, errText)
      throw new Error(`Claude API Error ${res.status}: ${errText}`)
    }
    const data = await res.json() as Record<string, unknown>
    console.log(`[ai:summarize] Claude stop_reason=${data.stop_reason}`)
    const content = data.content as Array<{ type: string; text: string }>
    const result = content.filter(c => c.type === 'text').map(c => c.text).join('')
    console.log(`[ai:summarize] result length=${result.length}`)
    return result
  })

  ipcMain.handle('ai:generatePlaylistQueries', async (
    _,
    title: string,
    author: string,
    description: string,
    recentHistory: string[],
    apiKey: string,
    model: string
  ) => {
    if (!apiKey) throw new Error('API Key が設定されていません')

    console.log(`[ai:generatePlaylistQueries] model=${model} title="${title}" history=${recentHistory.length}`)

    const isOpenAI = model.startsWith('gpt')
    const isGemini = model.startsWith('gemini')

    const historySection = recentHistory.length > 0
      ? `\n最近の視聴履歴:\n${recentHistory.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : ''

    const prompt = `あなたはYouTube動画のレコメンドエンジンです。
以下の動画を視聴しているユーザーが次に見たいと思うような、関連動画を探すためのYouTube検索クエリを3つ考えてください。

動画タイトル: ${title}
チャンネル: ${author}
概要: ${(description || '').slice(0, 500)}${historySection}

条件:
- 検索クエリはYouTube検索に適した短いフレーズ（日本語または英語）
- 同じトピックの深堀りだけでなく、関連する別の切り口も含める
- 動画のジャンルや内容に関連するクエリのみ生成する

回答は以下の形式で、3つのクエリだけを出力してください。説明や補足は不要です:
["検索ワード1", "検索ワード2", "検索ワード3"]`

    let rawResult = ''

    if (isGemini) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 256 }
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Gemini API Error ${res.status}: ${errText}`)
      }
      const data = await res.json() as Record<string, unknown>
      const candidates = data.candidates as Array<{
        content: { parts: Array<{ text: string }> }
      }>
      rawResult = candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''
    } else if (isOpenAI) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'YouTube動画の関連検索クエリを生成するアシスタントです。JSON配列のみを出力してください。' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 256
        }),
        signal: AbortSignal.timeout(30000)
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`OpenAI API Error ${res.status}: ${errText}`)
      }
      const data = await res.json() as Record<string, unknown>
      const choices = data.choices as Array<{ message: { content: string } }>
      rawResult = choices[0]?.message?.content || ''
    } else {
      // Anthropic Claude
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: AbortSignal.timeout(30000)
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Claude API Error ${res.status}: ${errText}`)
      }
      const data = await res.json() as Record<string, unknown>
      const content = data.content as Array<{ type: string; text: string }>
      rawResult = content.filter(c => c.type === 'text').map(c => c.text).join('')
    }

    console.log('[ai:generatePlaylistQueries] raw:', rawResult.slice(0, 200))

    // JSON配列をパース（失敗時はregexフォールバック）
    try {
      const parsed = JSON.parse(rawResult.trim())
      if (Array.isArray(parsed)) return parsed.map(String).slice(0, 3)
    } catch { /* fallback */ }

    // regexフォールバック: ["..."] パターンを抽出
    const match = rawResult.match(/\[[\s\S]*?\]/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        if (Array.isArray(parsed)) return parsed.map(String).slice(0, 3)
      } catch { /* fallback */ }
    }

    // 最終フォールバック: 各行をクエリとして使用
    const lines = rawResult.split('\n').map(l => l.replace(/^[\d."\-*]+\s*/, '').trim()).filter(Boolean)
    return lines.slice(0, 3)
  })

  ipcMain.handle('ai:getCaptions', async (_, captionUrl: string) => {
    console.log('[ai:getCaptions] fetching:', captionUrl.slice(0, 120))

    const res = await fetch(captionUrl, {
      headers: YT_HEADERS,
      signal: AbortSignal.timeout(15000)
    })

    if (!res.ok) {
      console.error('[ai:getCaptions] fetch failed:', res.status)
      throw new Error(`字幕の取得に失敗しました (HTTP ${res.status})`)
    }

    const raw = await res.text()
    console.log('[ai:getCaptions] raw length:', raw.length, 'first100:', raw.slice(0, 100))

    // json3形式かVTT形式かを判定
    let text: string
    if (raw.trimStart().startsWith('{')) {
      text = parseJson3Text(raw)
    } else {
      text = parseVttText(raw)
    }

    console.log('[ai:getCaptions] parsed text length:', text.length, 'first200:', text.slice(0, 200))

    if (!text || text.length < 5) {
      throw new Error('字幕テキストが空です')
    }

    return text
  })
}
