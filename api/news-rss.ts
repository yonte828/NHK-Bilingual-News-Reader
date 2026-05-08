export default async function handler(req: any, res: any) {
  const RSS_URL = 'https://www3.nhk.or.jp/rss/news/cat0.xml';
  try {
    const response = await fetch(RSS_URL);
    if (!response.ok) {
      throw new Error(`NHK RSS returned ${response.status}`);
    }
    const data = await response.text();
    
    // キャッシュを有効にしてVercel上でのパフォーマンスを向上
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(data);
  } catch (error) {
    console.error('Vercel API Error fetching RSS:', error);
    res.status(500).json({ error: 'Failed to fetch RSS feed' });
  }
}
