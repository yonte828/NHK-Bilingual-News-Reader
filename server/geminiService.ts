import { GoogleGenAI, Type, Modality, ThinkingLevel } from '@google/genai';

function getGeminiClient(apiKeyOverride?: string): GoogleGenAI {
  const apiKey = apiKeyOverride || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY_NOT_CONFIGURED: Server does not have GEMINI_API_KEY set in environment variables. Please configure GEMINI_API_KEY in your deployment settings.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface BatchItem {
  id: string;
  t: string;
  d: string;
}

export interface TranslatedResult {
  id: string;
  completedDescription: string;
  translatedTitle: string;
  translatedDescription: string;
}

export async function translateTextServer(text: string, apiKeyOverride?: string): Promise<string> {
  const cleanText = text.trim();
  if (!cleanText) return '';

  const ai = getGeminiClient(apiKeyOverride);
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: `You are an expert news editor and translator.
Translate the following Japanese news text into natural, professional English.
If the text ends with '…' or is truncated, complete the sentence naturally in English without trailing ellipsis.
No preamble.

Text: "${cleanText}"`,
  });

  return response.text || '';
}

export async function translateArticlesBatchServer(
  items: BatchItem[],
  apiKeyOverride?: string
): Promise<TranslatedResult[]> {
  if (!items || items.length === 0) return [];

  const ai = getGeminiClient(apiKeyOverride);

  const itemsToProcess = items.map(a => ({
    id: a.id,
    t: a.t || '',
    d: (a.d || a.t || '').replace(/<[^>]*>?/gm, '').trim(),
  }));

  const systemInstruction = `You are an expert bilingual news editor.
You receive a JSON array of news items with Japanese title (t) and description (d).
NHK descriptions often end abruptly with '…' or incomplete clauses.
For each item, output:
1. "completedDescription": Complete any truncated Japanese sentence naturally so it ends with proper closure (e.g. 「〜と発表しました。」、「〜見込みです。」、「〜方針です。」). No trailing '…'.
2. "translatedTitle": Concise, professional English news headline.
3. "translatedDescription": Natural, complete English translation with no trailing ellipsis.
Return a JSON array of objects with keys: id, completedDescription, translatedTitle, translatedDescription.`;

  const responseSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        completedDescription: {
          type: Type.STRING,
          description: 'Natural completed Japanese description with no trailing ellipsis',
        },
        translatedTitle: {
          type: Type.STRING,
          description: 'Concise English news headline',
        },
        translatedDescription: {
          type: Type.STRING,
          description: 'Full, natural English translation of the description',
        },
      },
      required: ['id', 'completedDescription', 'translatedTitle', 'translatedDescription'],
    },
  };

  const candidateModels = [
    {
      model: 'gemini-3.1-flash-lite',
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        systemInstruction,
      },
    },
    {
      model: 'gemini-3.8-flash',
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    },
  ];

  let lastError: any;

  for (const { model, config } of candidateModels) {
    const maxAttempts = 2;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const apiPromise = ai.models.generateContent({
          model,
          contents: JSON.stringify(itemsToProcess),
          config,
        });

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('API_REQUEST_TIMEOUT')), 15000)
        );

        const response = await Promise.race([apiPromise, timeoutPromise]);

        const rawText = response.text || '';
        if (!rawText.trim()) {
          throw new Error('Gemini API returned empty response');
        }

        let cleanJson = rawText.trim();
        if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        }

        const parsed = JSON.parse(cleanJson);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch (error: any) {
        lastError = error;
        const errStr = String(error?.message || error).toLowerCase();
        const isOverload =
          errStr.includes('503') ||
          errStr.includes('overloaded') ||
          errStr.includes('high demand') ||
          errStr.includes('unavailable') ||
          errStr.includes('resource_exhausted') ||
          errStr.includes('429') ||
          errStr.includes('timeout');

        if (isOverload) {
          console.warn(
            `Model ${model} overloaded or timed out (Attempt ${attempt + 1}/${maxAttempts}). Retrying/falling back...`
          );
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
          continue;
        } else {
          throw error;
        }
      }
    }
  }

  throw lastError;
}

// Server-side cache for speech audio
const speechCache = new Map<string, string>();
const getSpeechCacheKey = (text: string, voice: string, lang: string) =>
  `tts-${lang}-${voice}-${text.substring(0, 32)}-${text.length}`;

export async function generateSpeechServer(
  text: string,
  voice: 'Kore' | 'Puck',
  lang: 'en' | 'ja',
  apiKeyOverride?: string
): Promise<string> {
  const cleanText = text.trim();
  if (!cleanText) return '';

  const cacheKey = getSpeechCacheKey(cleanText, voice, lang);
  if (speechCache.has(cacheKey)) {
    return speechCache.get(cacheKey)!;
  }

  const ai = getGeminiClient(apiKeyOverride);

  const speechStyle =
    lang === 'ja'
      ? 'Clear, natural Japanese news anchor'
      : 'Clear, professional English news anchor';

  const models = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
  let lastError: any;

  for (const model of models) {
    for (const withMetadata of [true, false]) {
      try {
        const parts = withMetadata
          ? [{ text: cleanText, speechMetadata: { style: speechStyle } }]
          : [{ text: cleanText }];

        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
          throw new Error('No audio data received from Gemini TTS API.');
        }

        speechCache.set(cacheKey, base64Audio);
        return base64Audio;
      } catch (err: any) {
        console.warn(
          `TTS attempt with model ${model} (withMetadata: ${withMetadata}) failed:`,
          err?.message || err
        );
        lastError = err;
        const isSchemaError = String(err?.message || '').includes('speechMetadata');
        if (!isSchemaError && withMetadata) {
          break;
        }
      }
    }
  }

  throw lastError;
}
