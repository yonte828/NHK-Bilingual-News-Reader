import type { NewsArticle } from '../types';
import { USER_API_KEY_STORAGE } from '../components/SettingsModal';

function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(USER_API_KEY_STORAGE)?.trim() || null;
  } catch {
    return null;
  }
}

// System instruction for news completion and translation
const SYSTEM_INSTRUCTION = `You are an expert bilingual news editor.
You receive a JSON array of news items with Japanese title (t) and description (d).
NHK descriptions often end abruptly with '…' or incomplete clauses.
For each item, output:
1. "completedDescription": Complete any truncated Japanese sentence naturally so it ends with proper closure (e.g. 「〜と発表しました。」、「〜見込みです。」、「〜方針です。」). No trailing '…'.
2. "translatedTitle": Concise, professional English news headline.
3. "translatedDescription": Natural, complete English translation with no trailing ellipsis.
Return a JSON array of objects with keys: id, completedDescription, translatedTitle, translatedDescription.`;

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      completedDescription: {
        type: 'STRING',
        description: 'Natural completed Japanese description with no trailing ellipsis',
      },
      translatedTitle: {
        type: 'STRING',
        description: 'Concise English news headline',
      },
      translatedDescription: {
        type: 'STRING',
        description: 'Full, natural English translation of the description',
      },
    },
    required: ['id', 'completedDescription', 'translatedTitle', 'translatedDescription'],
  },
};

// Client-side direct call to Gemini REST API
async function directTranslateBatch(
  items: { id: string; t: string; d: string }[],
  apiKey: string
): Promise<any[]> {
  const models = [
    {
      name: 'gemini-3.1-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    },
    {
      name: 'gemini-3.8-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
    },
  ];

  let lastError: any;

  for (const { name, generationConfig } of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: JSON.stringify(items) }],
          },
        ],
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        generationConfig,
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        const msg = errJson.error?.message || `HTTP ${resp.status}`;
        throw new Error(msg);
      }

      const data = await resp.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!rawText.trim()) {
        throw new Error('Gemini APIから空の応答が返されました。');
      }

      let cleanJson = rawText.trim();
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }

      const parsed = JSON.parse(cleanJson);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (err: any) {
      console.warn(`Direct client translate using ${name} failed:`, err);
      lastError = err;
    }
  }

  throw lastError;
}

export const translateText = async (text: string): Promise<string> => {
  const cleanText = text.trim();
  if (!cleanText) return '';

  const userKey = getStoredApiKey();

  // Try server first if available
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userKey) headers['x-api-key'] = userKey;

    const response = await fetch('/api/gemini/translate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: cleanText }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.translated || '';
    }
  } catch (e) {
    console.warn('Server translate endpoint unreachable, trying client-direct...', e);
  }

  // Fallback to direct client call if server is not available (404/static)
  if (!userKey) {
    throw new Error('API_KEY_MISSING: Gemini APIキーが設定されていません。右上の設定アイコンからAPIキーを入力してください。');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(userKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `Translate into natural English: "${cleanText}"` }],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

export const translateArticlesBatch = async (
  articles: NewsArticle[]
): Promise<{
  id: string;
  completedDescription: string;
  translatedTitle: string;
  translatedDescription: string;
}[]> => {
  if (articles.length === 0) return [];

  const userKey = getStoredApiKey();
  const items = articles.map(a => ({
    id: a.id,
    t: a.title || '',
    d: (a.description || a.title || '').replace(/<[^>]*>?/gm, '').trim(),
  }));

  // 1. First attempt: call server endpoint (/api/gemini/translate-batch)
  let serverFailed404 = false;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userKey) headers['x-api-key'] = userKey;

    const response = await fetch('/api/gemini/translate-batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({ items }),
    });

    if (response.ok) {
      const data = await response.json();
      return Array.isArray(data.results) ? data.results : [];
    }

    if (response.status === 404) {
      serverFailed404 = true;
    } else {
      const errorData = await response.json().catch(() => ({}));
      if (errorData.error && String(errorData.error).includes('GEMINI_API_KEY_NOT_CONFIGURED')) {
        serverFailed404 = true; // Fall through to client direct
      } else {
        throw new Error(errorData.error || `Batch translation failed with status ${response.status}`);
      }
    }
  } catch (err: any) {
    if (err.message?.includes('404') || serverFailed404 || err.message?.includes('Failed to fetch')) {
      serverFailed404 = true;
    } else {
      throw err;
    }
  }

  // 2. Fallback: Direct client execution (essential for static Vercel / mobile BYOK usage)
  if (serverFailed404) {
    if (!userKey) {
      throw new Error(
        'API_KEY_MISSING: Gemini APIキーが設定されていません。右上の設定アイコン（歯車）からAPIキーを入力してください。'
      );
    }
    return directTranslateBatch(items, userKey);
  }

  return [];
};

// --- Client-Side Request Queue for Smooth Speech Playback ---
class RequestQueue {
  private queue: (() => Promise<void>)[] = [];
  private isProcessing = false;

  private tokens = 4;
  private maxTokens = 4;
  private refillInterval = 3000;
  private lastRefillTime = Date.now();

  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private updateTokens() {
    const now = Date.now();
    const timePassed = now - this.lastRefillTime;
    const tokensToAdd = Math.floor(timePassed / this.refillInterval);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  private async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      this.updateTokens();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        const task = this.queue.shift();
        if (task) {
          await task();
        }
      } else {
        const now = Date.now();
        const timeSinceLastRefill = now - this.lastRefillTime;
        const timeToWait = Math.max(0, this.refillInterval - timeSinceLastRefill);
        await new Promise(r => setTimeout(r, timeToWait + 50));
      }
    }
    this.isProcessing = false;
  }
}

const speechQueue = new RequestQueue();

// Client-side cache to store generated audio (key: "v2-lang-voice-textHash", value: base64)
const staticAudioCache = new Map<string, string>();
const getCacheKey = (text: string, voice: string, lang: string) =>
  `v2-${lang}-${voice}-${text.substring(0, 32)}-${text.length}`;

// Direct client TTS fallback
async function directGenerateSpeech(
  text: string,
  voice: 'Kore' | 'Puck',
  lang: 'en' | 'ja',
  apiKey: string
): Promise<string> {
  const speechStyle =
    lang === 'ja'
      ? 'Clear, natural Japanese news anchor'
      : 'Clear, professional English news anchor';

  const models = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
  let lastError: any;

  for (const model of models) {
    for (const withMetadata of [true, false]) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const parts = withMetadata
          ? [{ text, speechMetadata: { style: speechStyle } }]
          : [{ text }];

        const payload = {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice },
              },
            },
          },
        };

        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!b64) throw new Error('No audio data in response');
        return b64;
      } catch (err: any) {
        lastError = err;
        if (!String(err?.message || '').includes('speechMetadata') && withMetadata) {
          break;
        }
      }
    }
  }

  throw lastError;
}

export const generateSpeech = async (
  text: string,
  voice: 'Kore' | 'Puck',
  lang: 'en' | 'ja'
): Promise<string> => {
  const cleanText = text.trim();
  if (!cleanText) return '';

  const cacheKey = getCacheKey(cleanText, voice, lang);
  if (staticAudioCache.has(cacheKey)) {
    return staticAudioCache.get(cacheKey)!;
  }

  return speechQueue.add(async () => {
    if (staticAudioCache.has(cacheKey)) {
      return staticAudioCache.get(cacheKey)!;
    }

    const userKey = getStoredApiKey();

    // 1. Try server endpoint
    let serverFailed404 = false;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (userKey) headers['x-api-key'] = userKey;

      const response = await fetch('/api/gemini/speech', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: cleanText, voice, lang }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.audioData) {
          staticAudioCache.set(cacheKey, data.audioData);
          return data.audioData;
        }
      }

      if (response.status === 404) {
        serverFailed404 = true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.error && String(errorData.error).includes('GEMINI_API_KEY_NOT_CONFIGURED')) {
          serverFailed404 = true;
        } else {
          throw new Error(errorData.error || `Speech generation failed with status ${response.status}`);
        }
      }
    } catch (err: any) {
      if (err.message?.includes('404') || serverFailed404 || err.message?.includes('Failed to fetch')) {
        serverFailed404 = true;
      } else {
        throw err;
      }
    }

    // 2. Direct client fallback
    if (serverFailed404) {
      if (!userKey) {
        throw new Error(
          'API_KEY_MISSING: Gemini APIキーが設定されていません。右上の設定アイコン（歯車）からAPIキーを入力してください。'
        );
      }
      const audioB64 = await directGenerateSpeech(cleanText, voice, lang, userKey);
      staticAudioCache.set(cacheKey, audioB64);
      return audioB64;
    }

    throw new Error('音声の生成に失敗しました。');
  });
};
