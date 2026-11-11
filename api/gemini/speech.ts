import { generateSpeechServer } from '../../server/geminiService';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { text, voice, lang } = body;
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const apiKey = (req.headers['x-api-key'] as string) || undefined;
    const audioData = await generateSpeechServer(
      text,
      voice === 'Puck' ? 'Puck' : 'Kore',
      lang === 'ja' ? 'ja' : 'en',
      apiKey
    );
    res.status(200).json({ audioData });
  } catch (error: any) {
    console.error('Error in Vercel /api/gemini/speech:', error);
    res.status(500).json({ error: error.message || 'Failed to generate speech' });
  }
}
