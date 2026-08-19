import type { NewsArticle } from '../types';

// Using internal server-side proxy to avoid CORS issues
const RSS_API_URL = '/api/news-rss';

export const fetchAndParseRss = async (): Promise<NewsArticle[]> => {
  const response = await fetch(`${RSS_API_URL}?t=${Date.now()}`, { cache: 'no-store' });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed from proxy: ${response.statusText}`);
  }

  const xmlText = await response.text();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
  
  const errorNode = xmlDoc.querySelector('parsererror');
  if (errorNode) {
    throw new Error('Failed to parse RSS feed XML.');
  }

  const items = Array.from(xmlDoc.querySelectorAll('item'));

  return items.map(item => {
    const title = item.querySelector('title')?.textContent || '';
    const link = item.querySelector('link')?.textContent || '';
    let description = item.querySelector('description')?.textContent || '';
    
    // Clean up HTML tags and normalize whitespace
    description = description
        .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1') // Remove CDATA if present
        .replace(/<[^>]*>?/gm, ' ') // Strip remaining HTML tags
        .replace(/\s+/g, ' ')       // Normalize whitespace
        .trim();

    const pubDate = item.querySelector('pubDate')?.textContent || '';
    const guid = item.querySelector('guid')?.textContent || link || title;

    return {
      id: guid,
      title,
      link,
      description,
      pubDate: new Date(pubDate).toLocaleString(),
    };
  });
};