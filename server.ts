import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3000;

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
