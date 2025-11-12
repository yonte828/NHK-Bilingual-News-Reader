import type { NewsArticle } from '../types';

const RSS_URL = 'https://www3.nhk.or.jp/rss/news/cat0.xml';
// Switched to a different CORS proxy that is generally more reliable.
const CORS_PROXY = 'https://cors.eu.org/';

export const fetchAndParseRss = async (): Promise<NewsArticle[]> => {
  // This proxy doesn't require URL encoding the target URL.
  const response = await fetch(`${CORS_PROXY}${RSS_URL}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed: ${response.statusText}`);
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
    const description = item.querySelector('description')?.textContent || '';
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