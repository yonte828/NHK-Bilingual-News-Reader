import { GoogleGenAI, Type, Modality } from '@google/genai';
import type { NewsArticle } from '../types';
import { USER_API_KEY_STORAGE } from '../components/SettingsModal';

function getAi(): GoogleGenAI {
    const apiKey = localStorage.getItem(USER_API_KEY_STORAGE);
    if (!apiKey) {
        throw new Error("API_KEY_MISSING");
    }
    return new GoogleGenAI({ apiKey });
}

export const translateText = async (text: string): Promise<string> => {
    try {
        const aiInstance = getAi();
        const response = await aiInstance.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `You are an expert news editor and translator.
Translate the following Japanese news text into natural, professional English.
If the text ends with '…' or is truncated, complete the thought naturally in English so that it forms a full, complete sentence without trailing ellipsis.
No preamble.

Text: "${text}"`,
        });
        return response.text || "";
    } catch (error: any) {
        console.error("Translation failed:", error);
        if (error.message === "API_KEY_MISSING") throw error;
        throw new Error("Failed to translate text with Gemini API.");
    }
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
    
    try {
        const aiInstance = getAi();
        
        const itemsToProcess = articles.map(a => ({
            id: a.id,
            t: a.title || '', 
            d: (a.description || a.title || '').replace(/<[^>]*>?/gm, '').trim()
        }));

        const response = await aiInstance.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: JSON.stringify(itemsToProcess),
            config: {
                systemInstruction: `You are an expert bilingual news editor and translator specializing in Japanese and English news.
You will receive a JSON array of news items with Japanese title (t) and Japanese description (d).

NHK RSS descriptions are often truncated with '…' or cut off mid-sentence due to character limits.
For each news item, you must perform two tasks simultaneously:

1. "completedDescription":
   - Inspect the Japanese title (t) and the description (d).
   - If the description ends abruptly with '…', '...', or an incomplete clause, complete the sentence naturally so it ends with a natural, complete Japanese closing (e.g. 「〜と述べました。」、「〜と発表しました。」、「〜見込みです。」、「〜方針です。」、「〜呼びかけています。」など).
   - Do NOT leave any trailing '…' or ellipsis.
   - If the description was already complete, keep it clean and intact.

2. "translatedTitle":
   - Translate the Japanese title into a professional, concise English news headline.

3. "translatedDescription":
   - Translate the completed Japanese description into natural, clear English sentence(s).
   - Ensure the English translation is a grammatically complete sentence with proper punctuation and no trailing ellipsis.

Return a JSON array of objects with keys: id, completedDescription, translatedTitle, translatedDescription.`,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            completedDescription: { 
                                type: Type.STRING,
                                description: "Natural completed Japanese description with no trailing ellipsis" 
                            },
                            translatedTitle: { 
                                type: Type.STRING,
                                description: "Concise English news headline" 
                            },
                            translatedDescription: { 
                                type: Type.STRING,
                                description: "Full, natural English translation of the description" 
                            }
                        },
                        required: ["id", "completedDescription", "translatedTitle", "translatedDescription"]
                    }
                }
            }
        });

        const rawText = response.text || "";
        if (!rawText.trim()) {
            throw new Error("Gemini APIから空の応答が返されました。");
        }

        let cleanJson = rawText.trim();
        if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        }
        
        const parsed = JSON.parse(cleanJson);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error: any) {
        console.error("Batch translation and completion failed:", error);
        throw error;
    }
};

// --- Token Bucket Rate Limiter ---
class RequestQueue {
    private queue: (() => Promise<void>)[] = [];
    private isProcessing = false;
    
    // Config for 10 RPM (Requests Per Minute)
    // We allow a burst of 3 requests, then refill 1 token every 6 seconds.
    private tokens = 3; 
    private maxTokens = 3;
    private refillInterval = 6000; // 6000ms = 6 seconds
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

// Global cache to store generated audio (key: "v2-lang-voice-textHash", value: base64)
const staticAudioCache = new Map<string, string>();
const getCacheKey = (text: string, voice: string, lang: string) => `v2-${lang}-${voice}-${text.substring(0, 32)}-${text.length}`;

export const generateSpeech = async (text: string, voice: 'Kore' | 'Puck', lang: 'en' | 'ja'): Promise<string> => {
    const cleanText = text.trim();
    if (!cleanText) return "";

    const cacheKey = getCacheKey(cleanText, voice, lang);
    // 1. Immediate Cache Check (Before Queue)
    if (staticAudioCache.has(cacheKey)) {
        return staticAudioCache.get(cacheKey)!;
    }

    // Wrap the API call in the rate-limited queue
    return speechQueue.add(async () => {
        // 2. Double Check Cache (Inside Queue)
        if (staticAudioCache.has(cacheKey)) { 
            return staticAudioCache.get(cacheKey)!;
        }

        const MAX_RETRIES = 3;
        let lastError: any;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const aiInstance = getAi();
                
                const speechStyle = lang === 'ja'
                    ? "Clear, natural Japanese news anchor"
                    : "Clear, professional English news anchor";

                const response = await aiInstance.models.generateContent({
                    model: "gemini-3.8-flash-lite-tts",
                    contents: [
                        {
                            role: "user",
                            parts: [
                                { 
                                    text: cleanText,
                                    speechMetadata: {
                                        style: speechStyle,
                                    }
                                }
                            ]
                        }
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
                    throw new Error("No audio data received from Gemini API.");
                }
                
                // Save to global cache on success
                staticAudioCache.set(cacheKey, base64Audio);
                return base64Audio;
            } catch (error: any) {
                if (error.message === "API_KEY_MISSING") throw error;
                console.warn(`Text-to-speech generation failed (Attempt ${attempt + 1}/${MAX_RETRIES}):`, error);
                lastError = error;
                
                // Retry on rate limit or transient errors
                if (attempt < MAX_RETRIES - 1) {
                    const delay = 2000 * Math.pow(2, attempt); 
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }
        }
        throw lastError;
    });
};
