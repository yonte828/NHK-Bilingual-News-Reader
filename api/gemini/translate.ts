import { translateTextServer } from '../../server/geminiService';

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
    const { text } = body;
    if (typeof text !== 'string') {
      res.status(400).json({ error: 'text must be a string' });
      return;
    }
    const apiKey = (req.headers['x-api-key'] as string) || undefined;
    const translated = await translateTextServer(text, apiKey);
    res.status(200).json({ translated });
  } catch (error: any) {
    console.error('Error in Vercel /api/gemini/translate:', error);
    res.status(500).json({ error: error.message || 'Failed to translate text' });
  }
}
