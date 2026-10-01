import type { NewsArticle } from '../types';

// Using internal server-side proxy to avoid CORS issues
const RSS_API_URL = '/api/news-rss';
const TARGET_RSS_URL = 'https://news.web.nhk/n-data/conf/na/rss/cat0.xml';

export const fetchAndParseRss = async (): Promise<NewsArticle[]> => {
  try {
    const response = await fetch(`${RSS_API_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch RSS feed from proxy: ${response.statusText}`);
    }
    const xmlText = await response.text();
    
    // If it's HTML, it means the API route doesn't exist (e.g. static host)
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
      const title = (item.querySelector('title')?.textContent || '').trim();
      const link = (item.querySelector('link')?.textContent || '').trim();
      const description = (item.querySelector('description')?.textContent || '').trim();
      const pubDate = (item.querySelector('pubDate')?.textContent || '').trim();
      const guid = (item.querySelector('guid')?.textContent || link || title).trim();

      let formattedDate = pubDate;
      try {
        if (pubDate) {
          formattedDate = new Date(pubDate).toLocaleString('ja-JP');
        }
      } catch {
        formattedDate = pubDate;
      }

      return {
        id: guid,
        title,
        link,
        description,
        pubDate: formattedDate,
      };
    });
  } catch (err) {
    console.warn('Internal RSS proxy failed or is not available. Falling back to public JSON CORS proxy...', err);
    // Fallback for static hosting where the Express backend isn't running
    const fallbackUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(TARGET_RSS_URL)}`;
    const fallbackResponse = await fetch(fallbackUrl, { cache: 'no-store' });
    if (!fallbackResponse.ok) {
      throw new Error('Both internal proxy and fallback CORS proxy failed.');
    }
    const data = await fallbackResponse.json();
    
    if (data.status !== 'ok') {
      throw new Error('rss2json proxy returned an error: ' + data.message);
    }
    
    return data.items.map((item: any) => {
      let formattedDate = item.pubDate || '';
      try {
        if (item.pubDate) {
          formattedDate = new Date(item.pubDate).toLocaleString('ja-JP');
        }
      } catch {
        formattedDate = item.pubDate;
      }
      return {
        id: item.guid || item.link || item.title,
        title: (item.title || '').trim(),
        link: (item.link || '').trim(),
        description: (item.description || '').replace(/<[^>]*>?/gm, '').trim(),
        pubDate: formattedDate,
      };
    });
  }
};
