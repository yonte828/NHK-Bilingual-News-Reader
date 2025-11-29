
import { GoogleGenAI, Modality, Type } from "@google/genai";
import type { NewsArticle } from '../types';

const getAi = () => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable not set");
    }
    // Always create a new instance to ensure the latest API key is used,
    // which can help prevent race conditions on initialization.
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
}

export const translateText = async (text: string): Promise<string> => {
    try {
        const aiInstance = getAi();
        const response = await aiInstance.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Translate to English. Keep it concise. No preamble.\n\nText: "${text}"`,
        });
        return response.text || "";
    } catch (error) {
        console.error("Translation failed:", error);
        throw new Error("Failed to translate text with Gemini API.");
    }
};

export const translateArticlesBatch = async (articles: NewsArticle[]): Promise<{id: string, translatedTitle: string, translatedDescription: string}[]> => {
    if (articles.length === 0) return [];
    
    try {
        const aiInstance = getAi();
        
        // Simplified payload
        const itemsToTranslate = articles.map(a => ({
            id: a.id,
            t: a.title, // Use short keys to save tokens
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
    } catch (error) {
        console.error("Batch translation failed:", error);
        // Return empty array instead of throwing to allow other chunks to proceed if this is used in a loop
        return [];
    }
}

export const generateSpeech = async (text: string, voice: 'Kore' | 'Puck'): Promise<string> => {
    try {
        const aiInstance = getAi();
        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
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
        return base64Audio;
    } catch (error) {
        console.error("Text-to-speech generation failed:", error);
        throw new Error("Failed to generate speech with Gemini API.");
    }
};

export const generatePodcastAudio = async (script: string): Promise<string> => {
    try {
        console.log(`[GeminiService] Generating podcast audio for script length: ${script.length}`);
        const aiInstance = getAi();
        
        // Updated prompt to match the new newline-separated format in App.tsx
        const prompt = `
    Read the following bilingual news script aloud.
    The format is:
    SpeakerName
    Text to read

    Rules:
    1. EnglishSpeaker MUST read the English text.
    2. JapaneseSpeaker MUST read the Japanese text.
    3. Do NOT skip any lines. Read exactly what is written.
    4. Do NOT read the speaker names aloud (like "EnglishSpeaker"), just switch voices.

    Script:
    ${script}
        `.trim();
        
        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    multiSpeakerVoiceConfig: {
                        speakerVoiceConfigs: [
                            {
                                speaker: 'EnglishSpeaker',
                                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
                            },
                            {
                                speaker: 'JapaneseSpeaker',
                                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
                            }
                        ]
                    }
                },
            },
        });
        
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
            throw new Error("No audio data received from Gemini API.");
        }

        // Basic check for very short audio (likely error or skip)
        // 1KB is arbitrary but usually too small for a meaningful bilingual news snippet
        if (base64Audio.length < 1000) {
            console.warn("⚠️ [Warning] Audio output seems too short. Possible content skipping.");
        }

        return base64Audio;
    } catch (error) {
        console.error("Podcast generation failed:", error);
        throw new Error("Failed to generate podcast audio.");
    }
};
