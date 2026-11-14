import React, { useState, useEffect, useCallback } from 'react';
import type { NewsArticle, PlaylistItem, ErrorReport } from './types';
import { DetailedApiError } from './types';
import { fetchAndParseRss } from './services/rssService';
import { translateArticlesBatch } from './services/geminiService';
import { useTextToSpeech } from './hooks/useTextToSpeech';
import NewsItem from './components/NewsItem';
import PlayerControls from './components/PlayerControls';
import { LoadingSpinner, ErrorIcon, BrandIcon, RefreshIcon, SettingsIcon } from './components/IconComponents';
import SettingsModal, { USER_API_KEY_STORAGE } from './components/SettingsModal';

const LOCAL_STORAGE_KEY = 'nhk-bilingual-news-articles';

const getInitialArticles = (): NewsArticle[] => {
  try {
    localStorage.removeItem('japan-times-bilingual-news-articles');

    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedData) {
      const parsedArticles = JSON.parse(savedData) as NewsArticle[];
      if (Array.isArray(parsedArticles) && parsedArticles.length > 0) {
        if (parsedArticles[0].link?.includes('japantimes.co.jp')) {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          return [];
        }
        return parsedArticles;
      }
    }
  } catch (error) {
    console.error('Error reading articles from localStorage:', error);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }
  return [];
};

const toErrorReport = (err: any, fallbackOperation: string): ErrorReport => {
  if (err instanceof DetailedApiError && err.report) {
    return err.report;
  }

  const errMsg = err?.message || String(err || '不明なエラー');
  const lower = errMsg.toLowerCase();
  const needSettings =
    errMsg.includes('API_KEY_MISSING') ||
    lower.includes('gemini_api_key_not_configured') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid');

  return {
    operation: fallbackOperation,
    failedStep: '処理実行中（予期しない例外）',
    summary: errMsg,
    needSettings,
    steps: [
      {
        step: fallbackOperation,
        status: 'failed',
        detail: errMsg,
      },
    ],
    timestamp: new Date().toLocaleTimeString('ja-JP'),
  };
};

const formatReportForCopy = (report: ErrorReport): string => {
  const lines: string[] = [
    `[NHK News Reader 診断ログ]`,
    `時刻: ${report.timestamp}`,
    `処理: ${report.operation}`,
    `失敗工程: ${report.failedStep}`,
    `要約: ${report.summary}`,
    `--- 実行ステップ詳細 ---`,
  ];

  report.steps.forEach((s, i) => {
    const tag = s.status === 'success' ? 'OK' : s.status === 'failed' ? 'NG' : 'SKIP';
    const metaParts: string[] = [];
    if (s.httpStatus !== undefined) metaParts.push(`HTTP ${s.httpStatus}`);
    if (s.durationMs !== undefined) metaParts.push(`${s.durationMs}ms`);
    const meta = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : '';
    lines.push(`${i + 1}. [${tag}] ${s.step}${meta}`);
    if (s.target) lines.push(`   接続先: ${s.target}`);
    if (s.detail) lines.push(`   詳細: ${s.detail}`);
  });

  return lines.join('\n');
};

const App: React.FC = () => {
  const [articles, setArticles] = useState<NewsArticle[]>(getInitialArticles);
  const [isLoading, setIsLoading] = useState<boolean>(articles.length === 0);
  const [errorReport, setErrorReport] = useState<ErrorReport | null>(null);
  const [copiedLog, setCopiedLog] = useState<boolean>(false);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [isTranslatingAll, setIsTranslatingAll] = useState<boolean>(false);
  const [allTranslated, setAllTranslated] = useState<boolean>(false);
  const [translationProgress, setTranslationProgress] = useState<string>('');

  // Settings & User API Key State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem(USER_API_KEY_STORAGE);
    } catch {
      return false;
    }
  });

  const checkApiKey = useCallback(() => {
    try {
      const key = localStorage.getItem(USER_API_KEY_STORAGE);
      setHasApiKey(!!key);
    } catch {
      setHasApiKey(false);
    }
  }, []);

  const { play, stop, pause, resume, playbackState, currentItem } = useTextToSpeech({
    onError: (err) => {
      const report = toErrorReport(err, '音声再生・生成');
      setErrorReport(report);
      setCopiedLog(false);
      if (report.needSettings) {
        setIsSettingsOpen(true);
      }
    },
  });

  useEffect(() => {
    checkApiKey();
  }, [checkApiKey]);

  useEffect(() => {
    try {
      if (!isLoading && articles.length > 0) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(articles));
      }
    } catch (e) {
      console.error('Failed to save articles to localStorage:', e);
    }
  }, [articles, isLoading]);

  useEffect(() => {
    if (articles.length > 0) {
      const isAllDone = articles.every(
        article => article.translatedTitle && article.translatedDescription
      );
      setAllTranslated(isAllDone);
    } else {
      setAllTranslated(false);
    }
  }, [articles]);

  const handleCopyErrorLog = async () => {
    if (!errorReport) return;
    const text = formatReportForCopy(errorReport);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2500);
    } catch {
      // Fallback for older mobile browsers / non-HTTPS contexts
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopiedLog(true);
        setTimeout(() => setCopiedLog(false), 2500);
      } catch (e) {
        console.error('Copy failed:', e);
      }
    }
  };

  const loadNews = useCallback(async (forceRefresh: boolean = false) => {
    if (articles.length > 0 && !forceRefresh) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorReport(null);
    try {
      const newsItems = await fetchAndParseRss();
      setArticles(prevArticles => {
        const isPreviousSourceValid = prevArticles.length > 0 && !prevArticles[0].link?.includes('japantimes.co.jp');

        return newsItems.map(newItem => {
          if (!isPreviousSourceValid) return newItem;
          const existingItem = prevArticles.find(a => a.id === newItem.id);
          if (existingItem) {
            return {
              ...newItem,
              completedDescription: existingItem.completedDescription,
              translatedTitle: existingItem.translatedTitle,
              translatedDescription: existingItem.translatedDescription,
            };
          }
          return newItem;
        });
      });
    } catch (err) {
      console.error(err);
      setErrorReport(toErrorReport(err, 'NHKニュースRSS取得'));
      setCopiedLog(false);
      setArticles(prev => {
        if (prev.length === 0) {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
    }
  }, [articles.length]);

  useEffect(() => {
    loadNews(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTranslateAndRead = async (articleId: string) => {
    if (translatingId || isTranslatingAll) return;

    const article = articles.find(a => a.id === articleId);
    if (!article) return;

    setTranslatingId(articleId);
    setErrorReport(null);
    setCopiedLog(false);
    try {
      let completedDescription = article.completedDescription;
      let translatedTitle = article.translatedTitle;
      let translatedDescription = article.translatedDescription;

      // 1. Complete Japanese & Translate to English in ONE API call
      if (!translatedTitle || !translatedDescription || !completedDescription) {
        const translatedData = await translateArticlesBatch([article], '個別記事翻訳＆補完');
        if (translatedData.length > 0) {
          completedDescription = translatedData[0].completedDescription;
          translatedTitle = translatedData[0].translatedTitle;
          translatedDescription = translatedData[0].translatedDescription;

          setArticles(prev =>
            prev.map(a =>
              a.id === articleId
                ? {
                    ...a,
                    completedDescription,
                    translatedTitle,
                    translatedDescription,
                  }
                : a
            )
          );
        } else {
          throw new DetailedApiError({
            operation: '個別記事翻訳＆補完',
            failedStep: '応答データ検証',
            summary: '記事の翻訳結果が空でした。',
            steps: [
              {
                step: '応答データ検証',
                status: 'failed',
                detail: 'APIからの配列結果が0件でした',
              },
            ],
            timestamp: new Date().toLocaleTimeString('ja-JP'),
          });
        }
      }

      // 2. Play Audio (English and Japanese)
      const cleanJaDesc = (completedDescription || article.description)
        .replace(/<[^>]*>?/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
      const cleanEnDesc = (translatedDescription || '')
        .replace(/<[^>]*>?/gm, '')
        .replace(/\s+/g, ' ')
        .trim();

      const englishText = `${translatedTitle}.\n${cleanEnDesc}`;
      const japaneseText = `${article.title}。\n${cleanJaDesc}`;

      const playlist: PlaylistItem[] = [
        { text: englishText, lang: 'en', voice: 'Kore' },
        { text: japaneseText, lang: 'ja', voice: 'Puck' },
      ];

      play(playlist);
    } catch (err: any) {
      console.error('handleTranslateAndPlay error:', err);
      const report = toErrorReport(err, '個別記事翻訳＆再生');
      setErrorReport(report);
      if (report.needSettings) {
        setIsSettingsOpen(true);
      }
    } finally {
      setTranslatingId(null);
    }
  };

  const handleTranslateAll = async () => {
    if (isTranslatingAll) return;

    setIsTranslatingAll(true);
    setErrorReport(null);
    setCopiedLog(false);
    const articlesToProcess = articles.filter(
      a => !a.translatedTitle || !a.translatedDescription || !a.completedDescription
    );

    try {
      const TEXT_CHUNK_SIZE = 3;
      const totalChunks = Math.ceil(articlesToProcess.length / TEXT_CHUNK_SIZE);
      const localArticles = [...articles];

      if (articlesToProcess.length > 0) {
        for (let i = 0; i < articlesToProcess.length; i += TEXT_CHUNK_SIZE) {
          const chunkIndex = Math.floor(i / TEXT_CHUNK_SIZE) + 1;
          const progressLabel = `チャンク ${chunkIndex}/${totalChunks}`;
          setTranslationProgress(`翻訳＆補完中 ${chunkIndex}/${totalChunks}...`);

          const chunk = articlesToProcess.slice(i, i + TEXT_CHUNK_SIZE);
          const translatedData = await translateArticlesBatch(
            chunk,
            `一括翻訳・補完 (${progressLabel})`
          );

          translatedData.forEach(tItem => {
            const idx = localArticles.findIndex(a => a.id === tItem.id);
            if (idx !== -1) {
              localArticles[idx] = {
                ...localArticles[idx],
                completedDescription: tItem.completedDescription,
                translatedTitle: tItem.translatedTitle,
                translatedDescription: tItem.translatedDescription,
              };
            }
          });

          setArticles([...localArticles]);

          if (i + TEXT_CHUNK_SIZE < articlesToProcess.length) {
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
    } catch (e: any) {
      console.error('Error in handleTranslateAll:', e);
      const report = toErrorReport(e, '一括翻訳・補完');
      setErrorReport(report);
      if (report.needSettings) {
        setIsSettingsOpen(true);
      }
    } finally {
      setIsTranslatingAll(false);
      setTranslationProgress('');
    }
  };

  const handlePlayAll = async () => {
    stop();

    const untranslated = articles.some(a => !a.translatedTitle || !a.completedDescription);

    if (untranslated) {
      await handleTranslateAll();
    }

    const playlist: PlaylistItem[] = [];

    articles.forEach(a => {
      if (!a.translatedTitle) return;
      const cleanJaDesc = (a.completedDescription || a.description)
        .replace(/<[^>]*>?/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
      const cleanEnDesc = (a.translatedDescription || '')
        .replace(/<[^>]*>?/gm, '')
        .replace(/\s+/g, ' ')
        .trim();

      const englishText = `${a.translatedTitle}.\n${cleanEnDesc}`;
      const japaneseText = `${a.title}。\n${cleanJaDesc}`;

      playlist.push({ text: englishText, lang: 'en', voice: 'Kore' });
      playlist.push({ text: japaneseText, lang: 'ja', voice: 'Puck' });
    });

    if (playlist.length === 0) {
      setErrorReport({
        operation: 'すべて連続再生',
        failedStep: 'プレイリスト構築',
        summary: '再生可能な翻訳済み記事がありません。先に「一括翻訳・補完」を実行してください。',
        steps: [
          {
            step: '翻訳済み記事の確認',
            status: 'failed',
            detail: '翻訳済み記事が0件のため再生を開始できませんでした',
          },
        ],
        timestamp: new Date().toLocaleTimeString('ja-JP'),
      });
      return;
    }

    play(playlist);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-nhk-gray transition-colors duration-500">
      <header className="bg-nhk-red text-white shadow-lg sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <BrandIcon />
            <h1 className="text-xl sm:text-2xl font-bold hidden sm:block">NHK Bilingual News Reader</h1>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-3">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-full hover:bg-white/20 transition-colors"
              aria-label="Settings"
              title="設定 (APIキー入力・接続テスト)"
            >
              <SettingsIcon className="h-6 w-6" />
            </button>
            <button
              onClick={handleTranslateAll}
              disabled={isLoading || articles.length === 0 || isTranslatingAll || allTranslated}
              className="flex items-center justify-center px-3 py-2 bg-white/10 text-white font-semibold rounded-md hover:bg-white/20 transition-colors disabled:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 min-w-[140px]"
              title="Translate all articles"
            >
              {isTranslatingAll ? (
                <div className="flex items-center">
                  <LoadingSpinner className="h-4 w-4 mr-2" />
                  <span className="text-xs sm:text-sm whitespace-nowrap">
                    {translationProgress || '処理中...'}
                  </span>
                </div>
              ) : (
                <span>{allTranslated ? '翻訳済み' : '一括翻訳・補完'}</span>
              )}
            </button>
            <button
              onClick={handlePlayAll}
              disabled={articles.length === 0 || isTranslatingAll}
              className="flex items-center justify-center px-3 py-2 bg-white/10 text-white font-semibold rounded-md hover:bg-white/20 transition-colors disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Play all translated articles"
            >
              <span>すべて連続再生</span>
            </button>
            <button
              onClick={() => loadNews(true)}
              disabled={isLoading || isTranslatingAll}
              className="p-2 rounded-full hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Refresh News"
            >
              <RefreshIcon className={`h-6 w-6 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {!hasApiKey && !isLoading && (
        <div className="bg-amber-100 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-800/50 p-2.5 text-center text-amber-900 dark:text-amber-200 text-xs sm:text-sm font-medium">
          スマートフォンやVercelから翻訳を利用する場合、
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="underline font-bold hover:text-amber-700 dark:hover:text-amber-100 ml-1 mr-1"
          >
            設定（右上の歯車アイコン）
          </button>
          からご自身のGemini APIキーを入力してください。
        </div>
      )}

      <main className="container mx-auto p-4 sm:p-6 lg:p-8 pb-32">
        {isLoading && articles.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400">
            <LoadingSpinner className="h-12 w-12" />
            <p className="mt-4 text-lg">NHKニュースを取得中...</p>
          </div>
        )}

        {errorReport && (
          <div
            className="bg-red-50 dark:bg-red-950/40 border-l-4 border-red-500 text-red-900 dark:text-red-100 p-4 rounded-md shadow-md mb-6"
            role="alert"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="shrink-0 mt-0.5 text-red-600 dark:text-red-400">
                  <ErrorIcon />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-sm sm:text-base">
                      {errorReport.operation} でエラーが発生しました
                    </p>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-red-200/70 dark:bg-red-900/60 text-red-900 dark:text-red-200">
                      失敗工程: {errorReport.failedStep}
                    </span>
                    <span className="text-[11px] opacity-70 ml-auto">
                      {errorReport.timestamp}
                    </span>
                  </div>

                  <p className="text-sm mt-1.5 leading-relaxed">{errorReport.summary}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyErrorLog}
                      className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                    >
                      {copiedLog ? '診断ログをコピーしました！' : '診断ログをコピー'}
                    </button>

                    {errorReport.needSettings && (
                      <button
                        type="button"
                        onClick={() => setIsSettingsOpen(true)}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded bg-nhk-red text-white hover:bg-red-700 transition-colors"
                      >
                        設定画面を開く（キー確認・テスト）
                      </button>
                    )}
                  </div>

                  {errorReport.steps.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-red-200 dark:border-red-800/60">
                      <p className="text-xs font-semibold mb-2 opacity-80">
                        実行ステップ詳細（{errorReport.steps.length}工程）
                      </p>
                      <div className="space-y-1.5 font-mono text-[11px] sm:text-xs">
                        {errorReport.steps.map((s, idx) => (
                          <div
                            key={idx}
                            className={`p-2 rounded border ${
                              s.status === 'failed'
                                ? 'bg-red-100/80 dark:bg-red-900/40 border-red-300 dark:border-red-700'
                                : s.status === 'success'
                                ? 'bg-white/80 dark:bg-black/25 border-green-300/70 dark:border-green-800/50'
                                : 'bg-white/50 dark:bg-black/15 border-gray-300 dark:border-gray-700 opacity-75'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                    s.status === 'failed'
                                      ? 'bg-red-600 text-white'
                                      : s.status === 'success'
                                      ? 'bg-green-600 text-white'
                                      : 'bg-gray-500 text-white'
                                  }`}
                                >
                                  {s.status === 'failed' ? 'NG' : s.status === 'success' ? 'OK' : 'SKIP'}
                                </span>
                                <span className="font-semibold break-words">{s.step}</span>
                              </div>
                              {(s.httpStatus !== undefined || s.durationMs !== undefined) && (
                                <span className="text-[11px] opacity-80 shrink-0">
                                  {s.httpStatus !== undefined ? `HTTP ${s.httpStatus}` : ''}
                                  {s.httpStatus !== undefined && s.durationMs !== undefined ? ' · ' : ''}
                                  {s.durationMs !== undefined ? `${s.durationMs}ms` : ''}
                                </span>
                              )}
                            </div>
                            {s.target && (
                              <div className="mt-1 opacity-75 break-all">
                                接続先: {s.target}
                              </div>
                            )}
                            {s.detail && (
                              <div className="mt-1 break-words leading-snug">
                                詳細: {s.detail}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setErrorReport(null)}
                className="text-red-500 hover:text-red-700 dark:text-red-300 dark:hover:text-white p-1 rounded transition-colors shrink-0"
                aria-label="エラー表示を閉じる"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {articles.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {articles.map(article => (
              <NewsItem
                key={article.id}
                article={article}
                onTranslateAndRead={handleTranslateAndRead}
                isTranslating={translatingId === article.id}
                isReading={
                  (currentItem?.text.includes(article.translatedTitle || '') ||
                    currentItem?.text.includes(article.title)) &&
                  isTranslatingAll === false
                }
              />
            ))}
          </div>
        )}
      </main>

      {playbackState !== 'stopped' && currentItem && (
        <PlayerControls
          currentItem={currentItem}
          playbackState={playbackState}
          onPlayPause={playbackState === 'playing' ? pause : resume}
          onStop={stop}
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={checkApiKey}
      />
    </div>
  );
};

export default App;
