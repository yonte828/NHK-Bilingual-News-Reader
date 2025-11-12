
import { GoogleGenAI, Modality } from "@google/genai";

let ai: GoogleGenAI;

const getAi = () => {
    if (!ai) {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set");
        }
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return ai;
}

export const translateText = async (text: string): Promise<string> => {
    try {
        const aiInstance = getAi();
        const response = await aiInstance.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Translate the following Japanese text to English. Keep the meaning as close as possible to the original. Do not add any extra explanations or introductory phrases, just the translation.\n\nJapanese Text: "${text}"`,
        });
        return response.text;
    } catch (error) {
        console.error("Translation failed:", error);
        throw new Error("Failed to translate text with Gemini API.");
    }
};

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
