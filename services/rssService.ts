import type { NewsArticle } from '../types';

// Using internal server-side proxy to avoid CORS issues
const RSS_API_URL = '/api/news-rss';
const TARGET_RSS_URL = 'https://www.japantimes.co.jp/feed/';

export const fetchAndParseRss = async (): Promise<NewsArticle[]> => {
  try {
    const response = await fetch(`${RSS_API_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch RSS feed from proxy: ${response.statusText}`);
    }
    const xmlText = await response.text();
    
    // If it's HTML, it means the API route doesn't exist (e.g. GitHub Pages static host)
    if (xmlText.trim().toLowerCase().startsWith('<!doctype html>')) {
      throw new Error('Proxy returned HTML instead of XML');
    }

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
  } catch (err) {
    console.warn('Internal RSS proxy failed or is not available. Falling back to public JSON CORS proxy...', err);
    // Fallback for static hosting (e.g., GitHub Pages) where the Express backend isn't running
    const fallbackUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(TARGET_RSS_URL)}`;
    const fallbackResponse = await fetch(fallbackUrl, { cache: 'no-store' });
    if (!fallbackResponse.ok) {
      throw new Error('Both internal proxy and fallback CORS proxy failed.');
    }
    const data = await fallbackResponse.json();
    
    if (data.status !== 'ok') {
      throw new Error('rss2json proxy returned an error: ' + data.message);
    }
    
    return data.items.map((item: any) => ({
      id: item.guid || item.link || item.title,
      title: item.title,
      link: item.link,
      description: item.description,
      pubDate: new Date(item.pubDate).toLocaleString(),
    }));
  }
};