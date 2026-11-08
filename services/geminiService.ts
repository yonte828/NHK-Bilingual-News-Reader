import type { NewsArticle } from '../types';

export const translateText = async (text: string): Promise<string> => {
  const cleanText = text.trim();
  if (!cleanText) return '';

  const response = await fetch('/api/gemini/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleanText }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Translation request failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.translated || '';
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

  const items = articles.map(a => ({
    id: a.id,
    t: a.title || '',
    d: (a.description || a.title || '').replace(/<[^>]*>?/gm, '').trim(),
  }));

  const response = await fetch('/api/gemini/translate-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Batch translation failed with status ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
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

    const response = await fetch('/api/gemini/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, voice, lang }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Speech generation failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data.audioData) {
      throw new Error('No audio data received from server');
    }

    staticAudioCache.set(cacheKey, data.audioData);
    return data.audioData;
  });
};
