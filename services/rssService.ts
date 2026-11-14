import type { NewsArticle, DiagnosticStep } from '../types';
import { DetailedApiError } from '../types';

const RSS_API_URL = '/api/news-rss';
const TARGET_RSS_URL = 'https://news.web.nhk/n-data/conf/na/rss/cat0.xml';

export const fetchAndParseRss = async (): Promise<NewsArticle[]> => {
  const steps: DiagnosticStep[] = [];
  const startInternal = performance.now();

  try {
    const response = await fetch(`${RSS_API_URL}?t=${Date.now()}`, { cache: 'no-store' });
    const durationMs = Math.round(performance.now() - startInternal);
    if (!response.ok) {
      steps.push({
        step: '1. 内部RSSプロキシ取得',
        status: 'failed',
        target: RSS_API_URL,
        httpStatus: response.status,
        durationMs,
        detail: `HTTP ${response.status} ${response.statusText}`,
      });
      throw new Error(`HTTP ${response.status}`);
    }

    const xmlText = await response.text();

    if (xmlText.trim().toLowerCase().startsWith('<!doctype html>')) {
      steps.push({
        step: '1. 内部RSSプロキシ取得',
        status: 'failed',
        target: RSS_API_URL,
        httpStatus: 'HTML_FALLBACK',
        durationMs,
        detail: 'XMLではなくHTMLが返却されました（静的ホスティングのフォールバック等）',
      });
      throw new Error('Proxy returned HTML instead of XML');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    const errorNode = xmlDoc.querySelector('parsererror');
    if (errorNode) {
      steps.push({
        step: '1. 内部RSSプロキシ取得 & XML解析',
        status: 'failed',
        target: RSS_API_URL,
        httpStatus: 'XML_PARSE_ERROR',
        durationMs,
        detail: 'RSSフィードのXML解析に失敗しました',
      });
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
  } catch (err: any) {
    if (steps.length === 0) {
      steps.push({
        step: '1. 内部RSSプロキシ取得',
        status: 'failed',
        target: RSS_API_URL,
        httpStatus: 'NETWORK_ERROR',
        durationMs: Math.round(performance.now() - startInternal),
        detail: String(err?.message || err),
      });
    }

    console.warn('Internal RSS proxy failed or is not available. Falling back to public JSON CORS proxy...', err);
    const fallbackUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(TARGET_RSS_URL)}`;
    const startFallback = performance.now();

    try {
      const fallbackResponse = await fetch(fallbackUrl, { cache: 'no-store' });
      const fallbackDuration = Math.round(performance.now() - startFallback);

      if (!fallbackResponse.ok) {
        steps.push({
          step: '2. 外部CORSフォールバック (rss2json)',
          status: 'failed',
          target: 'api.rss2json.com',
          httpStatus: fallbackResponse.status,
          durationMs: fallbackDuration,
          detail: `HTTP ${fallbackResponse.status} ${fallbackResponse.statusText}`,
        });
        throw new DetailedApiError({
          operation: 'NHKニュースRSS取得',
          failedStep: '2. 外部CORSフォールバック (rss2json)',
          summary: 'NHKニュースフィードの取得に失敗しました（内部プロキシ・フォールバックともに応答エラー）。',
          steps,
          timestamp: new Date().toLocaleTimeString('ja-JP'),
        });
      }

      const data = await fallbackResponse.json();
      if (data.status !== 'ok') {
        steps.push({
          step: '2. 外部CORSフォールバック (rss2json)',
          status: 'failed',
          target: 'api.rss2json.com',
          httpStatus: 'API_ERROR',
          durationMs: fallbackDuration,
          detail: data.message || 'rss2json status was not ok',
        });
        throw new DetailedApiError({
          operation: 'NHKニュースRSS取得',
          failedStep: '2. 外部CORSフォールバック (rss2json)',
          summary: `RSSプロキシからエラーが返却されました: ${data.message || '不明なエラー'}`,
          steps,
          timestamp: new Date().toLocaleTimeString('ja-JP'),
        });
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
    } catch (fallbackErr: any) {
      if (fallbackErr instanceof DetailedApiError) throw fallbackErr;

      steps.push({
        step: '2. 外部CORSフォールバック (rss2json)',
        status: 'failed',
        target: 'api.rss2json.com',
        httpStatus: 'NETWORK_ERROR',
        durationMs: Math.round(performance.now() - startFallback),
        detail: String(fallbackErr?.message || fallbackErr),
      });

      throw new DetailedApiError({
        operation: 'NHKニュースRSS取得',
        failedStep: '2. 外部CORSフォールバック (rss2json)',
        summary: 'NHKニュースフィードの取得に失敗しました。ネットワーク接続をご確認ください。',
        steps,
        timestamp: new Date().toLocaleTimeString('ja-JP'),
      });
    }
  }
};
