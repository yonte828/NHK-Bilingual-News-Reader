import React, { useState, useEffect, useCallback } from 'react';
import type { NewsArticle, PlaylistItem } from './types';
import { fetchAndParseRss } from './services/rssService';
import { translateArticlesBatch, generateSpeech } from './services/geminiService';
import { useTextToSpeech } from './hooks/useTextToSpeech';
import NewsItem from './components/NewsItem';
import PlayerControls from './components/PlayerControls';
import { LoadingSpinner, ErrorIcon, BrandIcon, SettingsIcon, RefreshIcon } from './components/IconComponents';
import SettingsModal, { USER_API_KEY_STORAGE } from './components/SettingsModal';

const LOCAL_STORAGE_KEY = 'nhk-bilingual-news-articles';

const getInitialArticles = (): NewsArticle[] => {
  try {
    // Clean up legacy Japan Times cache if present
    localStorage.removeItem('japan-times-bilingual-news-articles');

    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedData) {
      const parsedArticles = JSON.parse(savedData) as NewsArticle[];
      if (Array.isArray(parsedArticles) && parsedArticles.length > 0) {
        // If cached articles are from older Japan Times feeds, clear cache
        if (parsedArticles[0].link?.includes('japantimes.co.jp')) {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          return [];
        }
        return parsedArticles;
      }
    }
  } catch (error) {
    console.error("Error reading articles from localStorage:", error);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }
  return [];
};

const App: React.FC = () => {
  const [articles, setArticles] = useState<NewsArticle[]>(getInitialArticles);
  const [isLoading, setIsLoading] = useState<boolean>(articles.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [isTranslatingAll, setIsTranslatingAll] = useState<boolean>(false);
  const [allTranslated, setAllTranslated] = useState<boolean>(false);
  const [translationProgress, setTranslationProgress] = useState<string>('');
  
  // Settings & API Key State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);

  const { play, stop, pause, resume, playbackState, currentItem } = useTextToSpeech();

  // Check for API Key
  const checkApiKey = useCallback(() => {
     const userKey = localStorage.getItem(USER_API_KEY_STORAGE);
     setHasApiKey(!!userKey);
  }, []);

  useEffect(() => {
      checkApiKey();
  }, [checkApiKey]);

  useEffect(() => {
    try {
      if (!isLoading && articles.length > 0) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(articles));
      }
    } catch (e) {
      console.error("Failed to save articles to localStorage:", e);
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

  const loadNews = useCallback(async (forceRefresh: boolean = false) => {
    if (articles.length > 0 && !forceRefresh) {
        setIsLoading(false);
        return;
    }

    setIsLoading(true);
    setError(null);
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
              translatedDescription: existingItem.translatedDescription
            };
          }
          return newItem;
        });
      });
    } catch (err) {
      console.error(err);
      setError('NHKニュースフィードの取得に失敗しました。時間をおいて再読み込みしてください。');
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
    if (!hasApiKey) {
        setIsSettingsOpen(true);
        return;
    }

    if (translatingId || isTranslatingAll) return;

    const article = articles.find(a => a.id === articleId);
    if (!article) return;
    
    setTranslatingId(articleId);
    try {
      let completedDescription = article.completedDescription;
      let translatedTitle = article.translatedTitle;
      let translatedDescription = article.translatedDescription;
      
      // 1. Complete Japanese & Translate to English in ONE API call
      if (!translatedTitle || !translatedDescription || !completedDescription) {
        const translatedData = await translateArticlesBatch([article]);
        if (translatedData.length > 0) {
            completedDescription = translatedData[0].completedDescription;
            translatedTitle = translatedData[0].translatedTitle;
            translatedDescription = translatedData[0].translatedDescription;

            setArticles(prev => prev.map(a => a.id === articleId ? {
                ...a,
                completedDescription,
                translatedTitle,
                translatedDescription
            } : a));
        } else {
            throw new Error("Translation failed.");
        }
      }

      // 2. Play Audio (Both English and Japanese with clean, completed sentences)
      const cleanJaDesc = (completedDescription || article.description).replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
      const cleanEnDesc = (translatedDescription || '').replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();

      const englishText = `${translatedTitle}.\n${cleanEnDesc}`;
      const japaneseText = `${article.title}。\n${cleanJaDesc}`;

      const playlist: PlaylistItem[] = [
        { text: englishText, lang: 'en', voice: 'Kore' },
        { text: japaneseText, lang: 'ja', voice: 'Puck' },
      ];

      play(playlist);

    } catch (err: any) {
      console.error(err);
      if (err.message === "API_KEY_MISSING") {
          setError("API Keyが設定されていません。設定画面からGemini APIキーを入力してください。");
          setIsSettingsOpen(true);
      } else {
          setError(`記事の翻訳・音声生成に失敗しました。接続をご確認ください。`);
      }
    } finally {
      setTranslatingId(null);
    }
  };

  const handleTranslateAll = async () => {
    if (!hasApiKey) {
        setIsSettingsOpen(true);
        return;
    }

    if (isTranslatingAll) return;
    
    setIsTranslatingAll(true);
    setError(null);
    const articlesToProcess = articles.filter(a => !a.translatedTitle || !a.translatedDescription || !a.completedDescription);

    try {
      const TEXT_CHUNK_SIZE = 5;
      const totalChunks = Math.ceil(articlesToProcess.length / TEXT_CHUNK_SIZE);
      const localArticles = [...articles];

      if (articlesToProcess.length > 0) {
        for (let i = 0; i < articlesToProcess.length; i += TEXT_CHUNK_SIZE) {
            const chunkIndex = Math.floor(i / TEXT_CHUNK_SIZE) + 1;
            setTranslationProgress(`翻訳＆補完中 ${chunkIndex}/${totalChunks}...`);
            
            const chunk = articlesToProcess.slice(i, i + TEXT_CHUNK_SIZE);
            const translatedData = await translateArticlesBatch(chunk);

            // Update local cache
            translatedData.forEach(tItem => {
                const idx = localArticles.findIndex(a => a.id === tItem.id);
                if (idx !== -1) {
                    localArticles[idx] = {
                        ...localArticles[idx],
                        completedDescription: tItem.completedDescription,
                        translatedTitle: tItem.translatedTitle,
                        translatedDescription: tItem.translatedDescription
                    };
                }
            });

            // Pre-generate Audio for First Article for instant playback
            if (i === 0 && localArticles.length > 0) {
                const first = localArticles[0];
                if (first.translatedTitle && first.translatedDescription) {
                    const cleanJaDesc = (first.completedDescription || first.description).replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
                    const cleanEnDesc = first.translatedDescription.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();

                    const englishText = `${first.translatedTitle}.\n${cleanEnDesc}`;
                    const japaneseText = `${first.title}。\n${cleanJaDesc}`;
                    
                    generateSpeech(englishText, 'Kore', 'en').catch(e => console.warn("Pre-gen en failed", e));
                    generateSpeech(japaneseText, 'Puck', 'ja').catch(e => console.warn("Pre-gen ja failed", e));
                }
            }
            
            setArticles([...localArticles]);
            
            if (i + TEXT_CHUNK_SIZE < articlesToProcess.length) {
                await new Promise(r => setTimeout(r, 400));
            }
        }
      }
      
    } catch (e: any) {
      console.error(`Error in handleTranslateAll`, e);
      if (e.message === "API_KEY_MISSING") {
          setError("API Keyが設定されていません。設定画面からGemini APIキーを入力してください。");
          setIsSettingsOpen(true);
      } else {
          setError("一括翻訳に失敗しました。");
      }
    } finally {
      setIsTranslatingAll(false);
      setTranslationProgress('');
    }
  };

  const handlePlayAll = async () => {
    if (!hasApiKey) {
        setIsSettingsOpen(true);
        return;
    }

    stop();
    
    const untranslated = articles.some(a => !a.translatedTitle || !a.completedDescription);
    
    if (untranslated) {
        await handleTranslateAll();
    }

    // Build Playlist
    const playlist: PlaylistItem[] = [];
        
    articles.forEach(a => {
        if (!a.translatedTitle) return;
        const cleanJaDesc = (a.completedDescription || a.description).replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim();
        const cleanEnDesc = (a.translatedDescription || "").replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim();
        
        const englishText = `${a.translatedTitle}.\n${cleanEnDesc}`;
        const japaneseText = `${a.title}。\n${cleanJaDesc}`;
        
        playlist.push({ text: englishText, lang: "en", voice: "Kore" });
        playlist.push({ text: japaneseText, lang: "ja", voice: "Puck" });
    });

    if (playlist.length === 0) {
        setError("再生可能な翻訳済み記事がありません。");
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
            >
              <SettingsIcon className="h-6 w-6" />
            </button>
            <button
              onClick={handleTranslateAll}
              disabled={isLoading || articles.length === 0 || isTranslatingAll || allTranslated}
              className={`flex items-center justify-center px-3 py-2 bg-white/10 text-white font-semibold rounded-md hover:bg-white/20 transition-colors disabled:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 min-w-[140px] ${!hasApiKey ? 'opacity-50 cursor-not-allowed' : ''}`}
              title="Translate all articles"
            >
              {isTranslatingAll ? (
                  <div className="flex items-center">
                      <LoadingSpinner className="h-4 w-4 mr-2" />
                      <span className="text-xs sm:text-sm whitespace-nowrap">{translationProgress || '処理中...'}</span>
                  </div>
              ) : (
                <span>{allTranslated ? '翻訳済み' : '一括翻訳・補完'}</span>
              )}
            </button>
            <button
              onClick={handlePlayAll}
              disabled={articles.length === 0 || isTranslatingAll}
              className={`flex items-center justify-center px-3 py-2 bg-white/10 text-white font-semibold rounded-md hover:bg-white/20 transition-colors disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed ${!hasApiKey ? 'opacity-50 cursor-not-allowed' : ''}`}
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
        <div className="bg-yellow-100 dark:bg-yellow-900/40 p-3 text-center text-yellow-800 dark:text-yellow-200 text-sm font-medium">
          翻訳と読み上げ機能を利用するには、<button onClick={() => setIsSettingsOpen(true)} className="underline hover:text-yellow-900 dark:hover:text-white font-bold">設定（歯車アイコン）</button>からご自身のGemini APIキーを入力してください。
        </div>
      )}
      
      <main className="container mx-auto p-4 sm:p-6 lg:p-8 pb-32">
        {isLoading && articles.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400">
            <LoadingSpinner className="h-12 w-12" />
            <p className="mt-4 text-lg">NHKニュースを取得中...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-100 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-200 p-4 rounded-md shadow-md mb-6" role="alert">
            <div className="flex items-center">
              <ErrorIcon />
              <div className="ml-3">
                <p className="font-bold">エラーが発生しました</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}
        
        {articles.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <NewsItem 
                key={article.id} 
                article={article}
                onTranslateAndRead={handleTranslateAndRead}
                isTranslating={translatingId === article.id}
                isReading={(currentItem?.text.includes(article.translatedTitle || '') || currentItem?.text.includes(article.title)) && isTranslatingAll === false}
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
