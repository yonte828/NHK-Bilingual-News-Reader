export default async function handler(req: any, res: any) {
  // NHK's RSS has stopped updating since Aug 8, so we're using Yahoo News RSS instead
  const RSS_URL = 'https://news.yahoo.co.jp/rss/topics/top-picks.xml';
  try {
    const response = await fetch(`${RSS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`RSS feed returned ${response.status}`);
    }
    const data = await response.text();
    
    // API Route (Vercel Edge/Serverless) cache settings
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(data);
  } catch (error) {
    console.error('Vercel API Error fetching RSS:', error);
    res.status(500).json({ error: 'Failed to fetch RSS feed' });
  }
}
