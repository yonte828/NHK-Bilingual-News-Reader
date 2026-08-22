
import React, { useState, useEffect, useCallback } from 'react';
import type { NewsArticle, PlaylistItem } from './types';
import { fetchAndParseRss } from './services/rssService';
import { translateText, translateArticlesBatch, generateSpeech } from './services/geminiService';
import { useTextToSpeech } from './hooks/useTextToSpeech';
import NewsItem from './components/NewsItem';
import PlayerControls from './components/PlayerControls';
import { LoadingSpinner, ErrorIcon, BrandIcon, SettingsIcon, RefreshIcon } from './components/IconComponents';
import SettingsModal, { USER_API_KEY_STORAGE } from './components/SettingsModal';

const LOCAL_STORAGE_KEY = 'japan-times-bilingual-news-articles';
const LEGACY_LOCAL_STORAGE_KEY = 'nhk-bilingual-news-articles';

const getInitialArticles = (): NewsArticle[] => {
  try {
    // Clean up legacy NHK cache if present
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);

    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedData) {
      const parsedArticles = JSON.parse(savedData) as NewsArticle[];
      if (Array.isArray(parsedArticles)) {
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

  // Check for API Key (Strictly check localStorage only)
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
        return newsItems.map(newItem => {
          const existingItem = prevArticles.find(a => a.id === newItem.id);
          if (existingItem) {
            return {
              ...newItem,
              translatedTitle: existingItem.translatedTitle,
              translatedDescription: existingItem.translatedDescription
            };
          }
          return newItem;
        });
      });
    } catch (err) {
      console.error(err);
      setError('Failed to fetch or parse the news feed. Please try again later.');
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
    // Always fetch latest news on mount, keeping existing articles while loading
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
    stop();

    try {
      let translatedTitle = article.translatedTitle;
      let translatedDescription = article.translatedDescription;
      
      // 1. Translate Text if needed
      if (!translatedTitle || !translatedDescription) {
        const translatedData = await translateArticlesBatch([article]);
        if (translatedData.length > 0) {
            translatedTitle = translatedData[0].translatedTitle;
            translatedDescription = translatedData[0].translatedDescription;
        } else {
            throw new Error("Translation failed.");
        }
      }

      // Update State with text
      setArticles(prevArticles =>
        prevArticles.map(a =>
          a.id === articleId ? { 
            ...a, 
            translatedTitle, 
            translatedDescription
          } : a
        )
      );
      
      const cleanEnDesc = article.description.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
      
      // Combine title and description to reduce API calls (2 requests per article instead of 4)
      const englishText = `${article.title}.\n${cleanEnDesc}`;
      const japaneseText = `${translatedTitle}。\n${translatedDescription}`;

      const playlist: PlaylistItem[] = [
        { text: englishText, lang: 'en', voice: 'Kore' },
        { text: japaneseText, lang: 'ja', voice: 'Puck' },
      ];

      play(playlist);

    } catch (err: any) {
      console.error(err);
      if (err.message === "API_KEY_MISSING") {
          setError("API Key is missing. Please check settings.");
          setIsSettingsOpen(true);
      } else {
          setError(`Failed to process article. Please check your connection.`);
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
    stop();
  
    try {
      // 1. Translate Text First (Batched)
      const articlesToProcess = articles.filter(a => !a.translatedTitle || !a.translatedDescription);
      
      let localArticles = [...articles];
      
      if (articlesToProcess.length > 0) {
        const TEXT_CHUNK_SIZE = 5;
        const totalChunks = Math.ceil(articlesToProcess.length / TEXT_CHUNK_SIZE);

        for (let i = 0; i < articlesToProcess.length; i += TEXT_CHUNK_SIZE) {
            const chunkIndex = Math.floor(i / TEXT_CHUNK_SIZE) + 1;
            setTranslationProgress(`Translating text ${chunkIndex}/${totalChunks}...`);
            
            const chunk = articlesToProcess.slice(i, i + TEXT_CHUNK_SIZE);
            const translatedData = await translateArticlesBatch(chunk);

            // Update local cache
            translatedData.forEach(tItem => {
                const idx = localArticles.findIndex(a => a.id === tItem.id);
                if (idx !== -1) {
                    localArticles[idx] = {
                        ...localArticles[idx],
                        translatedTitle: tItem.translatedTitle,
                        translatedDescription: tItem.translatedDescription
                    };
                }
            });

            // --- Pre-generate Audio for First Article ---
            if (i === 0 && localArticles.length > 0) {
                const first = localArticles[0];
                if (first.translatedTitle && first.translatedDescription) {
                    const cleanEnDesc = first.description.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
                    const englishText = `${first.title}.\n${cleanEnDesc}`;
                    const japaneseText = `${first.translatedTitle}。\n${first.translatedDescription}`;
                    
                    console.log(`[App] Pre-generating audio for article "${first.title.substring(0,10)}..." to enable instant playback.`);
                    // Fire and forget (Token bucket will handle burst)
                    generateSpeech(englishText, 'Kore', 'en').catch(e => console.warn("Pre-gen en failed", e));
                    generateSpeech(japaneseText, 'Puck', 'ja').catch(e => console.warn("Pre-gen ja failed", e));
                }
            }
            
            setArticles([...localArticles]);
            
            if (i + TEXT_CHUNK_SIZE < articlesToProcess.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
      }
      
    } catch (e: any) {
      console.error(`Error in handleTranslateAll`, e);
      if (e.message === "API_KEY_MISSING") {
          setError("API Key is missing. Please check settings.");
          setIsSettingsOpen(true);
      } else {
          setError("Failed to complete translation.");
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
    
    const untranslated = articles.some(a => !a.translatedTitle);
    
    if (untranslated) {
        await handleTranslateAll();
    }

    // Build Playlist
    const playlist: PlaylistItem[] = [];
    
        articles.forEach(a => {
        if (!a.translatedTitle) return;
        const cleanEnDesc = a.description.replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim();
        
        const englishText = `${a.title}.\n${cleanEnDesc}`;
        const japaneseText = `${a.translatedTitle}。\n${a.translatedDescription || ""}`;
        
        playlist.push({ text: englishText, lang: "en", voice: "Kore" });
        playlist.push({ text: japaneseText, lang: "ja", voice: "Puck" });
    });

    if (playlist.length === 0) {
        setError("No translated articles available to play.");
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
            <h1 className="text-xl sm:text-2xl font-bold hidden sm:block">Japan Times Bilingual News Reader</h1>
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
                      <span className="text-xs sm:text-sm whitespace-nowrap">{translationProgress || 'Processing'}</span>
                  </div>
              ) : (
                <span>{allTranslated ? 'Translated' : 'Translate All'}</span>
              )}
            </button>
            <button
              onClick={handlePlayAll}
              disabled={articles.length === 0 || isTranslatingAll}
              className={`flex items-center justify-center px-3 py-2 bg-white/10 text-white font-semibold rounded-md hover:bg-white/20 transition-colors disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed ${!hasApiKey ? 'opacity-50 cursor-not-allowed' : ''}`}
              title="Play all translated articles"
            >
              <span>Play All</span>
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
          Please set your Gemini API Key in <button onClick={() => setIsSettingsOpen(true)} className="underline hover:text-yellow-900 dark:hover:text-white font-bold">Settings</button> to enable translation and audio.
        </div>
      )}
      
      <main className="container mx-auto p-4 sm:p-6 lg:p-8 pb-32">
        {isLoading && articles.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400">
            <LoadingSpinner className="h-12 w-12" />
            <p className="mt-4 text-lg">Fetching latest news from Japan Times...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-100 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-200 p-4 rounded-md shadow-md mb-6" role="alert">
            <div className="flex items-center">
              <ErrorIcon />
              <div className="ml-3">
                <p className="font-bold">An Error Occurred</p>
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
