export default async function handler(req: any, res: any) {
  // Using NHK RSS feed URL
  const RSS_URL = 'https://news.web.nhk/n-data/conf/na/rss/cat0.xml';
  try {
    const response = await fetch(`${RSS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`NHK RSS feed returned ${response.status}`);
    }
    const data = await response.text();
    
    // API Route (Vercel Edge/Serverless) cache & CORS settings
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(data);
  } catch (error: any) {
    console.error('Vercel API Error fetching NHK RSS:', error);
    res.status(500).json({ error: 'Failed to fetch NHK RSS feed', details: error?.message });
  }
}
