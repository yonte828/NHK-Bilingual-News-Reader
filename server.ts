import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import {
  translateTextServer,
  translateArticlesBatchServer,
  generateSpeechServer,
} from './server/geminiService';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // RSS Proxy endpoint
  app.get('/api/news-rss', async (req, res) => {
    // NHK News (Top / Major News) RSS feed URL
    const RSS_URL = 'https://news.web.nhk/n-data/conf/na/rss/cat0.xml';
    try {
      const response = await fetch(`${RSS_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`RSS feed returned ${response.status}`);
      }
      const data = await response.text();
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Cache-Control', 'no-store');
      res.send(data);
    } catch (error) {
      console.error('Error fetching RSS:', error);
      res.status(500).json({ error: 'Failed to fetch RSS feed' });
    }
  });

  // Server-side Gemini API endpoints
  app.post('/api/gemini/translate-batch', async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) {
        res.status(400).json({ error: 'items must be an array' });
        return;
      }
      const apiKey = (req.headers['x-api-key'] as string) || undefined;
      const results = await translateArticlesBatchServer(items, apiKey);
      res.json({ results });
    } catch (error: any) {
      console.error('Error in /api/gemini/translate-batch:', error);
      res.status(500).json({ error: error.message || 'Failed to translate articles' });
    }
  });

  app.post('/api/gemini/translate', async (req, res) => {
    try {
      const { text } = req.body;
      if (typeof text !== 'string') {
        res.status(400).json({ error: 'text must be a string' });
        return;
      }
      const apiKey = (req.headers['x-api-key'] as string) || undefined;
      const translated = await translateTextServer(text, apiKey);
      res.json({ translated });
    } catch (error: any) {
      console.error('Error in /api/gemini/translate:', error);
      res.status(500).json({ error: error.message || 'Failed to translate text' });
    }
  });

  app.post('/api/gemini/speech', async (req, res) => {
    try {
      const { text, voice, lang } = req.body;
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
      res.json({ audioData });
    } catch (error: any) {
      console.error('Error in /api/gemini/speech:', error);
      res.status(500).json({ error: error.message || 'Failed to generate speech' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
