import type { NewsArticle, DiagnosticStep, ErrorReport } from '../types';
import { DetailedApiError } from '../types';
import { USER_API_KEY_STORAGE } from '../components/SettingsModal';

export function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(USER_API_KEY_STORAGE)?.trim() || null;
  } catch {
    return null;
  }
}

export function maskApiKey(key: string): string {
  const clean = key.trim();
  if (clean.length <= 10) return '****';
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

function sanitizeText(text: string, apiKey?: string | null): string {
  let out = text;
  if (apiKey && apiKey.trim().length > 6) {
    const masked = maskApiKey(apiKey);
    out = out.split(apiKey.trim()).join(masked);
    out = out.split(encodeURIComponent(apiKey.trim())).join(masked);
  }
  // Mask any AIza... style key pattern
  out = out.replace(/AIza[0-9A-Za-z_-]{10,}/g, (match) => maskApiKey(match));
  return out;
}

function classifyDirectApiFailure(status: number | string, rawMessage: string): { summary: string; needSettings: boolean } {
  const lower = rawMessage.toLowerCase();
  if (status === 'TIMEOUT' || lower.includes('abort')) {
    return {
      summary: 'Gemini APIへのリクエストが15秒でタイムアウトしました。回線状況またはサーバー混雑の可能性があります。',
      needSettings: false,
    };
  }
  if (status === 'NETWORK_ERROR' || lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return {
      summary: 'Gemini APIサーバーに接続できませんでした。インターネット接続や広告ブロッカー・ファイアウォールをご確認ください。',
      needSettings: false,
    };
  }
  if (lower.includes('api_key_invalid') || lower.includes('api key not valid') || (status === 400 && lower.includes('key'))) {
    return {
      summary: '入力されたGemini APIキーが無効です（API_KEY_INVALID）。設定画面でキーを再度ご確認ください。',
      needSettings: true,
    };
  }
  if (status === 403 || lower.includes('permission_denied') || lower.includes('referer') || lower.includes('blocked')) {
    return {
      summary: 'APIキーの権限またはリファラー制限で拒否されました（403）。Google Cloud Consoleのキー制限設定をご確認ください。',
      needSettings: true,
    };
  }
  if (status === 404 || lower.includes('not found')) {
    return {
      summary: '指定されたGeminiモデルまたはAPIエンドポイントが見つかりません（404）。詳細ステップのモデル名・URLをご確認ください。',
      needSettings: false,
    };
  }
  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return {
      summary: 'Gemini APIの利用上限（レート制限／クォータ）に達しました（429）。1〜2分待ってから再試行してください。',
      needSettings: false,
    };
  }
  if (status === 503 || lower.includes('overloaded') || lower.includes('high demand') || lower.includes('unavailable')) {
    return {
      summary: 'Geminiサーバーが一時的に混雑しています（503）。少し時間をおいて再度お試しください。',
      needSettings: false,
    };
  }
  return {
    summary: `API処理中にエラーが発生しました（${status}）: ${rawMessage}`,
    needSettings: false,
  };
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

// Client-side direct call to Gemini REST API with full step tracing
async function directTranslateBatch(
  items: { id: string; t: string; d: string }[],
  apiKey: string,
  steps: DiagnosticStep[],
  operationLabel: string
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
    {
      name: 'gemini-flash-latest',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    },
  ];

  let lastStatus: number | string = 'UNKNOWN';
  let lastErrorMsg = '不明なエラー';
  let lastFailedStep = 'Gemini API 直接リクエスト';

  for (const { name, generationConfig } of models) {
    const stepName = `Gemini API 直接リクエスト (${name})`;
    const maskedTarget = `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent?key=${maskApiKey(apiKey)}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const startedAt = performance.now();

    try {
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

      let resp: Response;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        clearTimeout(timer);
        const durationMs = Math.round(performance.now() - startedAt);
        const isAbort = fetchErr?.name === 'AbortError';
        lastStatus = isAbort ? 'TIMEOUT' : 'NETWORK_ERROR';
        lastErrorMsg = isAbort
          ? '15秒以内に応答がありませんでした (AbortError)'
          : String(fetchErr?.message || fetchErr || 'Network request failed');
        lastFailedStep = stepName;

        steps.push({
          step: stepName,
          status: 'failed',
          target: maskedTarget,
          httpStatus: lastStatus,
          durationMs,
          detail: sanitizeText(lastErrorMsg, apiKey),
        });
        continue;
      }

      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - startedAt);

      if (!resp.ok) {
        const rawBody = await resp.text().catch(() => '');
        let parsedMsg = `HTTP ${resp.status}`;
        try {
          const errJson = JSON.parse(rawBody);
          parsedMsg = errJson.error?.message || parsedMsg;
        } catch {
          if (rawBody.trim()) parsedMsg = `${parsedMsg}: ${rawBody.slice(0, 180)}`;
        }

        lastStatus = resp.status;
        lastErrorMsg = parsedMsg;
        lastFailedStep = stepName;

        steps.push({
          step: stepName,
          status: 'failed',
          target: maskedTarget,
          httpStatus: resp.status,
          durationMs,
          detail: sanitizeText(parsedMsg, apiKey),
        });

        // Fast-fail on invalid API key / auth error without burning retries on other models
        if (resp.status === 400 && parsedMsg.toLowerCase().includes('key')) break;
        if (resp.status === 403) break;
        continue;
      }

      steps.push({
        step: stepName,
        status: 'success',
        target: maskedTarget,
        httpStatus: resp.status,
        durationMs,
        detail: `${items.length}件の応答を受信`,
      });

      // Step: JSON Parse & Validation
      const parseStart = performance.now();
      const data = await resp.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!rawText.trim()) {
        const blockReason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'EMPTY_TEXT';
        const parseDuration = Math.round(performance.now() - parseStart);
        lastStatus = 'EMPTY_RESPONSE';
        lastErrorMsg = `応答テキストが空でした (finishReason: ${blockReason})`;
        lastFailedStep = `応答JSON解析 (${name})`;
        steps.push({
          step: lastFailedStep,
          status: 'failed',
          target: name,
          httpStatus: 'EMPTY_RESPONSE',
          durationMs: parseDuration,
          detail: lastErrorMsg,
        });
        continue;
      }

      let cleanJson = rawText.trim();
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }

      try {
        const parsed = JSON.parse(cleanJson);
        const resultArr = Array.isArray(parsed) ? parsed : [parsed];
        steps.push({
          step: `応答JSON解析 (${name})`,
          status: 'success',
          target: name,
          durationMs: Math.round(performance.now() - parseStart),
          detail: `${resultArr.length}件のJSONデータを正常にパース完了`,
        });
        return resultArr;
      } catch (jsonErr: any) {
        lastStatus = 'JSON_PARSE_ERROR';
        lastErrorMsg = `JSONパース失敗: ${jsonErr?.message || jsonErr} / 受信内容先頭: ${cleanJson.slice(0, 120)}`;
        lastFailedStep = `応答JSON解析 (${name})`;
        steps.push({
          step: lastFailedStep,
          status: 'failed',
          target: name,
          httpStatus: 'JSON_PARSE_ERROR',
          durationMs: Math.round(performance.now() - parseStart),
          detail: sanitizeText(lastErrorMsg, apiKey),
        });
        continue;
      }
    } catch (unexpectedErr: any) {
      lastStatus = 'UNEXPECTED_ERROR';
      lastErrorMsg = String(unexpectedErr?.message || unexpectedErr);
      lastFailedStep = stepName;
      steps.push({
        step: stepName,
        status: 'failed',
        target: maskedTarget,
        httpStatus: 'ERROR',
        durationMs: Math.round(performance.now() - startedAt),
        detail: sanitizeText(lastErrorMsg, apiKey),
      });
    }
  }

  const classified = classifyDirectApiFailure(lastStatus, lastErrorMsg);
  const report: ErrorReport = {
    operation: operationLabel,
    failedStep: lastFailedStep,
    summary: classified.summary,
    needSettings: classified.needSettings,
    steps,
    timestamp: new Date().toLocaleTimeString('ja-JP'),
  };
  throw new DetailedApiError(report);
}

export const translateArticlesBatch = async (
  articles: NewsArticle[],
  contextLabel: string = '一括翻訳・補完'
): Promise<{
  id: string;
  completedDescription: string;
  translatedTitle: string;
  translatedDescription: string;
}[]> => {
  if (articles.length === 0) return [];

  const steps: DiagnosticStep[] = [];
  const userKey = getStoredApiKey();
  const items = articles.map(a => ({
    id: a.id,
    t: a.title || '',
    d: (a.description || a.title || '').replace(/<[^>]*>?/gm, '').trim(),
  }));

  // Step 1: API Key & Route Selection
  if (userKey) {
    steps.push({
      step: '1. APIキー確認 & 通信ルート判定',
      status: 'success',
      target: `ブラウザ直接通信 (保存キー: ${maskApiKey(userKey)})`,
      detail: '設定画面のAPIキーが保存されているため、/api/gemini/* をスキップしてGoogle Gemini APIへ直接通信します。',
    });

    return directTranslateBatch(items, userKey, steps, contextLabel);
  }

  // No user API key -> Try server route (/api/gemini/translate-batch)
  steps.push({
    step: '1. APIキー確認 & 通信ルート判定',
    status: 'success',
    target: 'サーバー中継ルート (/api/gemini/translate-batch)',
    detail: '端末にAPIキーが未入力のため、アプリ内蔵サーバー経由での実行を試行します。',
  });

  const serverStart = performance.now();
  try {
    const response = await fetch('/api/gemini/translate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const durationMs = Math.round(performance.now() - serverStart);
    const contentType = response.headers.get('content-type') || '';

    if (response.ok) {
      if (!contentType.includes('application/json')) {
        const snippet = (await response.text().catch(() => '')).slice(0, 120);
        steps.push({
          step: '2. サーバー中継API呼び出し',
          status: 'failed',
          target: '/api/gemini/translate-batch',
          httpStatus: `${response.status} (Non-JSON)`,
          durationMs,
          detail: `JSONではなく ${contentType || 'HTML'} が返却されました（静的ホスティングのフォールバック等）: ${snippet}`,
        });
        throw new DetailedApiError({
          operation: contextLabel,
          failedStep: '2. サーバー中継API呼び出し',
          summary: 'この配信環境ではサーバーAPIが稼働していないため、設定（歯車アイコン）からご自身のGemini APIキーを入力してください。',
          needSettings: true,
          steps,
          timestamp: new Date().toLocaleTimeString('ja-JP'),
        });
      }

      const data = await response.json();
      steps.push({
        step: '2. サーバー中継API呼び出し',
        status: 'success',
        target: '/api/gemini/translate-batch',
        httpStatus: response.status,
        durationMs,
        detail: `${Array.isArray(data.results) ? data.results.length : 0}件取得`,
      });
      return Array.isArray(data.results) ? data.results : [];
    }

    const rawErrText = await response.text().catch(() => '');
    let parsedErrMsg = `HTTP ${response.status}`;
    try {
      const errJson = JSON.parse(rawErrText);
      parsedErrMsg = errJson.error || parsedErrMsg;
    } catch {
      if (rawErrText.trim()) parsedErrMsg = `${parsedErrMsg}: ${rawErrText.slice(0, 120)}`;
    }

    steps.push({
      step: '2. サーバー中継API呼び出し',
      status: 'failed',
      target: '/api/gemini/translate-batch',
      httpStatus: response.status,
      durationMs,
      detail: parsedErrMsg,
    });

    const isMissingConfig =
      response.status === 404 ||
      parsedErrMsg.includes('GEMINI_API_KEY_NOT_CONFIGURED');

    throw new DetailedApiError({
      operation: contextLabel,
      failedStep: '2. サーバー中継API呼び出し',
      summary: isMissingConfig
        ? 'サーバーAPIが利用できないかキー未設定（' + response.status + '）です。右上の設定（歯車アイコン）からご自身のGemini APIキーを入力してください。'
        : `サーバーAPIエラー（HTTP ${response.status}）: ${parsedErrMsg}`,
      needSettings: isMissingConfig,
      steps,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
    });
  } catch (err: any) {
    if (err instanceof DetailedApiError) throw err;

    const durationMs = Math.round(performance.now() - serverStart);
    const errMsg = String(err?.message || err);
    steps.push({
      step: '2. サーバー中継API呼び出し',
      status: 'failed',
      target: '/api/gemini/translate-batch',
      httpStatus: 'NETWORK_ERROR',
      durationMs,
      detail: errMsg,
    });

    throw new DetailedApiError({
      operation: contextLabel,
      failedStep: '2. サーバー中継API呼び出し',
      summary: 'サーバーAPIへの接続に失敗しました。設定（歯車アイコン）からAPIキーを入力すると直接通信モードで動作します。',
      needSettings: true,
      steps,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
    });
  }
};

export const translateText = async (text: string): Promise<string> => {
  const cleanText = text.trim();
  if (!cleanText) return '';

  const userKey = getStoredApiKey();
  const steps: DiagnosticStep[] = [];

  if (userKey) {
    steps.push({
      step: '1. APIキー確認 & 通信ルート判定',
      status: 'success',
      target: `ブラウザ直接通信 (${maskApiKey(userKey)})`,
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(userKey)}`;
    const startedAt = performance.now();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Translate into natural English: "${cleanText}"` }] }],
      }),
    });
    const durationMs = Math.round(performance.now() - startedAt);

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const msg = errData.error?.message || `HTTP ${resp.status}`;
      steps.push({
        step: '2. Gemini API 直接翻訳',
        status: 'failed',
        target: `gemini-3.1-flash-lite`,
        httpStatus: resp.status,
        durationMs,
        detail: sanitizeText(msg, userKey),
      });
      const classified = classifyDirectApiFailure(resp.status, msg);
      throw new DetailedApiError({
        operation: 'テキスト翻訳',
        failedStep: '2. Gemini API 直接翻訳',
        summary: classified.summary,
        needSettings: classified.needSettings,
        steps,
        timestamp: new Date().toLocaleTimeString('ja-JP'),
      });
    }

    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const response = await fetch('/api/gemini/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleanText }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new DetailedApiError({
      operation: 'テキスト翻訳',
      failedStep: 'サーバー中継API (/api/gemini/translate)',
      summary: errorData.error || `HTTP ${response.status}`,
      needSettings: response.status === 404,
      steps: [
        {
          step: 'サーバー中継API (/api/gemini/translate)',
          status: 'failed',
          target: '/api/gemini/translate',
          httpStatus: response.status,
          detail: errorData.error || `HTTP ${response.status}`,
        },
      ],
      timestamp: new Date().toLocaleTimeString('ja-JP'),
    });
  }

  const data = await response.json();
  return data.translated || '';
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

// Direct client TTS with detailed error steps
async function directGenerateSpeech(
  text: string,
  voice: 'Kore' | 'Puck',
  lang: 'en' | 'ja',
  apiKey: string,
  steps: DiagnosticStep[]
): Promise<string> {
  const speechStyle =
    lang === 'ja'
      ? 'Clear, natural Japanese news anchor'
      : 'Clear, professional English news anchor';

  const models = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
  let lastStatus: number | string = 'UNKNOWN';
  let lastErrorMsg = '音声生成に失敗しました';
  let lastFailedStep = 'TTS音声生成';

  for (const model of models) {
    for (const withMetadata of [true, false]) {
      const stepName = `TTS直接生成 (${model}${withMetadata ? '' : ' / 簡易形式'})`;
      const maskedTarget = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${maskApiKey(apiKey)}`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const startedAt = performance.now();

      try {
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
        const durationMs = Math.round(performance.now() - startedAt);

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          const msg = errData.error?.message || `HTTP ${resp.status}`;
          lastStatus = resp.status;
          lastErrorMsg = msg;
          lastFailedStep = stepName;
          steps.push({
            step: stepName,
            status: 'failed',
            target: maskedTarget,
            httpStatus: resp.status,
            durationMs,
            detail: sanitizeText(msg, apiKey),
          });
          if (!String(msg).includes('speechMetadata') && withMetadata) {
            break;
          }
          continue;
        }

        const data = await resp.json();
        const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!b64) {
          lastStatus = 'EMPTY_AUDIO';
          lastErrorMsg = '音声データ(inlineData)が含まれていませんでした';
          lastFailedStep = stepName;
          steps.push({
            step: stepName,
            status: 'failed',
            target: maskedTarget,
            httpStatus: 'EMPTY_AUDIO',
            durationMs,
            detail: lastErrorMsg,
          });
          continue;
        }
        return b64;
      } catch (err: any) {
        const durationMs = Math.round(performance.now() - startedAt);
        lastStatus = 'NETWORK_ERROR';
        lastErrorMsg = String(err?.message || err);
        lastFailedStep = stepName;
        steps.push({
          step: stepName,
          status: 'failed',
          target: maskedTarget,
          httpStatus: 'NETWORK_ERROR',
          durationMs,
          detail: sanitizeText(lastErrorMsg, apiKey),
        });
        if (withMetadata) break;
      }
    }
  }

  const classified = classifyDirectApiFailure(lastStatus, lastErrorMsg);
  throw new DetailedApiError({
    operation: `音声生成 (${lang === 'ja' ? '日本語' : '英語'})`,
    failedStep: lastFailedStep,
    summary: classified.summary,
    needSettings: classified.needSettings,
    steps,
    timestamp: new Date().toLocaleTimeString('ja-JP'),
  });
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
    const steps: DiagnosticStep[] = [];

    // Direct mode when userKey exists
    if (userKey) {
      steps.push({
        step: '1. APIキー確認 & 通信ルート判定',
        status: 'success',
        target: `ブラウザ直接TTS (${maskApiKey(userKey)})`,
        detail: '設定済みのAPIキーを使用し、直接TTSエンドポイントへリクエストします。',
      });

      const audioB64 = await directGenerateSpeech(cleanText, voice, lang, userKey, steps);
      staticAudioCache.set(cacheKey, audioB64);
      return audioB64;
    }

    // Server mode when no userKey
    steps.push({
      step: '1. APIキー確認 & 通信ルート判定',
      status: 'success',
      target: 'サーバー中継TTS (/api/gemini/speech)',
    });

    const serverStart = performance.now();
    try {
      const response = await fetch('/api/gemini/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText, voice, lang }),
      });
      const durationMs = Math.round(performance.now() - serverStart);

      if (response.ok) {
        const data = await response.json();
        if (data.audioData) {
          staticAudioCache.set(cacheKey, data.audioData);
          return data.audioData;
        }
      }

      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.error || `HTTP ${response.status}`;
      steps.push({
        step: '2. サーバー中継TTS呼び出し',
        status: 'failed',
        target: '/api/gemini/speech',
        httpStatus: response.status,
        durationMs,
        detail: msg,
      });

      const needSettings = response.status === 404 || String(msg).includes('GEMINI_API_KEY_NOT_CONFIGURED');
      throw new DetailedApiError({
        operation: `音声生成 (${lang === 'ja' ? '日本語' : '英語'})`,
        failedStep: '2. サーバー中継TTS呼び出し',
        summary: needSettings
          ? 'サーバー側TTSが利用できません。設定（歯車アイコン）からAPIキーを入力してください。'
          : `音声生成エラー（HTTP ${response.status}）: ${msg}`,
        needSettings,
        steps,
        timestamp: new Date().toLocaleTimeString('ja-JP'),
      });
    } catch (err: any) {
      if (err instanceof DetailedApiError) throw err;
      throw new DetailedApiError({
        operation: `音声生成 (${lang === 'ja' ? '日本語' : '英語'})`,
        failedStep: '2. サーバー中継TTS呼び出し',
        summary: '音声生成サーバーへの通信に失敗しました。',
        needSettings: true,
        steps: [
          ...steps,
          {
            step: '2. サーバー中継TTS呼び出し',
            status: 'failed',
            target: '/api/gemini/speech',
            httpStatus: 'NETWORK_ERROR',
            durationMs: Math.round(performance.now() - serverStart),
            detail: String(err?.message || err),
          },
        ],
        timestamp: new Date().toLocaleTimeString('ja-JP'),
      });
    }
  });
};

// Connection test tool used by SettingsModal
export async function testApiConnection(candidateKey: string): Promise<{
  ok: boolean;
  summary: string;
  activeModel?: string;
  steps: DiagnosticStep[];
}> {
  const steps: DiagnosticStep[] = [];
  const trimmed = candidateKey.trim();

  // Step 1: Key format validation
  if (!trimmed) {
    steps.push({
      step: '1. キー形式チェック',
      status: 'failed',
      detail: 'APIキーが空です。AIza... で始まるキーを入力してください。',
    });
    return {
      ok: false,
      summary: 'APIキーを入力してからテストを実行してください。',
      steps,
    };
  }

  if (!trimmed.startsWith('AIza')) {
    steps.push({
      step: '1. キー形式チェック',
      status: 'failed',
      target: maskApiKey(trimmed),
      detail: 'Gemini APIキーは通常 "AIza" で始まります。コピー時に不要な文字や空白が入っていないかご確認ください。',
    });
    return {
      ok: false,
      summary: 'APIキーの形式が正しくない可能性があります（"AIza" で始まっていません）。',
      steps,
    };
  }

  steps.push({
    step: '1. キー形式チェック',
    status: 'success',
    target: `${maskApiKey(trimmed)} (${trimmed.length}文字)`,
    detail: 'APIキーの基本形式は正常です。',
  });

  // Step 2: Live test against candidate models
  const testModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
  let lastStatus: number | string = 'UNKNOWN';
  let lastMsg = '';

  for (const model of testModels) {
    const maskedTarget = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${maskApiKey(trimmed)}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(trimmed)}`;
    const startedAt = performance.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - startedAt);

      if (resp.ok) {
        const data = await resp.json();
        const reply = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        steps.push({
          step: `2. 直接通信テスト (${model})`,
          status: 'success',
          target: maskedTarget,
          httpStatus: resp.status,
          durationMs,
          detail: `応答確認済み ("${reply.slice(0, 30)}")`,
        });
        return {
          ok: true,
          summary: `接続成功！ ${model} で直接通信できることを確認しました（${durationMs}ms）。「保存する」を押してご利用ください。`,
          activeModel: model,
          steps,
        };
      }

      const rawText = await resp.text().catch(() => '');
      let parsedMsg = `HTTP ${resp.status}`;
      try {
        const errJson = JSON.parse(rawText);
        parsedMsg = errJson.error?.message || parsedMsg;
      } catch {
        if (rawText.trim()) parsedMsg = `${parsedMsg}: ${rawText.slice(0, 120)}`;
      }

      lastStatus = resp.status;
      lastMsg = parsedMsg;
      steps.push({
        step: `2. 直接通信テスト (${model})`,
        status: 'failed',
        target: maskedTarget,
        httpStatus: resp.status,
        durationMs,
        detail: sanitizeText(parsedMsg, trimmed),
      });

      // Stop early on definite invalid key or forbidden error
      if ((resp.status === 400 && parsedMsg.toLowerCase().includes('key')) || resp.status === 403) {
        break;
      }
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startedAt);
      const isAbort = err?.name === 'AbortError';
      lastStatus = isAbort ? 'TIMEOUT' : 'NETWORK_ERROR';
      lastMsg = isAbort ? '10秒でタイムアウトしました' : String(err?.message || err);
      steps.push({
        step: `2. 直接通信テスト (${model})`,
        status: 'failed',
        target: maskedTarget,
        httpStatus: lastStatus,
        durationMs,
        detail: sanitizeText(lastMsg, trimmed),
      });
    }
  }

  const classified = classifyDirectApiFailure(lastStatus, lastMsg);
  return {
    ok: false,
    summary: classified.summary,
    steps,
  };
}
