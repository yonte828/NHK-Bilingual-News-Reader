
import { GoogleGenAI, Modality, Type } from "@google/genai";
import type { NewsArticle } from '../types';
import { USER_API_KEY_STORAGE } from '../components/SettingsModal';

const getAi = () => {
    // Priority: Strictly User LocalStorage Key (BYOK) only.
    // We ignore process.env.API_KEY to ensure the app behaves exactly as it would for an end-user.
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
            model: 'gemini-2.5-flash',
            contents: `Translate to English. Keep it concise. No preamble.\n\nText: "${text}"`,
        });
        return response.text || "";
    } catch (error: any) {
        console.error("Translation failed:", error);
        if (error.message === "API_KEY_MISSING") throw error;
        throw new Error("Failed to translate text with Gemini API.");
    }
};

export const translateArticlesBatch = async (articles: NewsArticle[]): Promise<{id: string, translatedTitle: string, translatedDescription: string}[]> => {
    if (articles.length === 0) return [];
    
    try {
        const aiInstance = getAi();
        
        const itemsToTranslate = articles.map(a => ({
            id: a.id,
            t: a.title, 
            d: a.description.replace(/<[^>]*>?/gm, '') 
        }));

        const response = await aiInstance.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: JSON.stringify(itemsToTranslate),
            config: {
                systemInstruction: "Translate Japanese news titles (t) and descriptions (d) to English. Return JSON array with keys: id, translatedTitle, translatedDescription.",
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            translatedTitle: { type: Type.STRING },
                            translatedDescription: { type: Type.STRING }
                        },
                        required: ["id", "translatedTitle", "translatedDescription"]
                    }
                }
            }
        });

        const jsonText = response.text;
        if (!jsonText) return [];
        
        return JSON.parse(jsonText);
    } catch (error: any) {
        console.error("Batch translation failed:", error);
        if (error.message === "API_KEY_MISSING") throw error;
        return [];
    }
}

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
            this.lastRefillTime = now; // Reset anchor to now (conservative approach)
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
                    console.log(`[RateLimit] Executing request. Tokens remaining: ${this.tokens}`);
                    await task();
                }
            } else {
                // Calculate wait time
                const now = Date.now();
                const timeSinceLastRefill = now - this.lastRefillTime;
                const timeToWait = Math.max(0, this.refillInterval - timeSinceLastRefill);
                
                console.log(`[RateLimit] Bucket empty. Waiting ${timeToWait}ms for next token...`);
                
                // Wait until next token refill
                await new Promise(r => setTimeout(r, timeToWait + 50)); // +50ms buffer
            }
        }

        this.isProcessing = false;
    }
}

const speechQueue = new RequestQueue();

// Global cache to store generated audio (key: "lang-voice-textHash", value: base64)
const staticAudioCache = new Map<string, string>();
const getCacheKey = (text: string, voice: string, lang: string) => `${lang}-${voice}-${text.substring(0, 32)}-${text.length}`;

export const generateSpeech = async (text: string, voice: 'Kore' | 'Puck', lang: 'en' | 'ja'): Promise<string> => {
    const cacheKey = getCacheKey(text, voice, lang);

    // 1. Immediate Cache Check (Before Queue)
    if (staticAudioCache.has(cacheKey)) {
        console.log(`[GeminiService] Global cache hit for "${text.substring(0, 20)}..."`);
        return staticAudioCache.get(cacheKey)!;
    }

    // Wrap the API call in the rate-limited queue
    return speechQueue.add(async () => {
        // 2. Double Check Cache (Inside Queue - in case another request filled it while we waited)
        if (staticAudioCache.has(cacheKey)) {
             return staticAudioCache.get(cacheKey)!;
        }

        const MAX_RETRIES = 3;
        let lastError: any;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                console.log(`[GeminiService] Generating speech (${lang}/${voice}) Attempt ${attempt+1}: "${text.substring(0, 20)}..."`);
                const aiInstance = getAi();
                
                // Embed language instruction directly in the text prompt.
                const promptPrefix = lang === 'ja' 
                    ? "Read this text in Japanese:\n" 
                    : "Read this text in English:\n";
                
                const response = await aiInstance.models.generateContent({
                    model: "gemini-2.5-flash-preview-tts",
                    contents: [{ parts: [{ text: promptPrefix + text }] }],
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
                
                // Retry on rate limit or internal server errors
                if (attempt < MAX_RETRIES - 1) {
                    // Exponential backoff: 2s, 4s...
                    const delay = 2000 * Math.pow(2, attempt); 
                    console.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }
        }
        // If we exhausted all retries
        throw lastError;
    });
};
