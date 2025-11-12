
import React, { useState, useEffect, useCallback } from 'react';
import type { NewsArticle, PlaylistItem } from './types';
import { fetchAndParseRss } from './services/rssService';
import { translateText } from './services/geminiService';
import { useTextToSpeech } from './hooks/useTextToSpeech';
import NewsItem from './components/NewsItem';
import PlayerControls from './components/PlayerControls';
import { LoadingSpinner, ErrorIcon, BrandIcon } from './components/IconComponents';

const App: React.FC = () => {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [isTranslatingAll, setIsTranslatingAll] = useState<boolean>(false);
  const [allTranslated, setAllTranslated] = useState<boolean>(false);

  const { play, stop, pause, resume, playbackState, currentItem } = useTextToSpeech();

  const loadNews = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setAllTranslated(false);
    try {
      const newsItems = await fetchAndParseRss();
      setArticles(newsItems);
    } catch (err) {
      console.error(err);
      setError('Failed to fetch or parse the news feed. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  const handleTranslateAndRead = async (articleId: string) => {
    if (translatingId || isTranslatingAll) return;

    const article = articles.find(a => a.id === articleId);
    if (!article) return;
    
    setTranslatingId(articleId);
    stop();

    try {
      let translatedTitle = article.translatedTitle;
      let translatedDescription = article.translatedDescription;

      if (!translatedTitle || !translatedDescription) {
        [translatedTitle, translatedDescription] = await Promise.all([
          translateText(article.title),
          translateText(article.description)
        ]);
        
        setArticles(prevArticles =>
          prevArticles.map(a =>
            a.id === articleId ? { ...a, translatedTitle, translatedDescription } : a
          )
        );
      }
      
      const playlist: PlaylistItem[] = [
        { text: translatedTitle, lang: 'en', voice: 'Kore' },
        { text: article.title, lang: 'ja', voice: 'Puck' },
        { text: translatedDescription, lang: 'en', voice: 'Kore' },
        { text: article.description.replace(/<[^>]*>?/gm, ''), lang: 'ja', voice: 'Puck' },
      ];

      play(playlist);

    } catch (err) {
      console.error(err);
      setError(`Failed to process article. Please check your connection and API key.`);
    } finally {
      setTranslatingId(null);
    }
  };

  const handleTranslateAll = async () => {
    if (isTranslatingAll) return;
    setIsTranslatingAll(true);
    setError(null);
    stop();

    try {
      const updatedArticles = await Promise.all(
        articles.map(async (article) => {
          if (article.translatedTitle && article.translatedDescription) {
            return article;
          }
          try {
            const [translatedTitle, translatedDescription] = await Promise.all([
              translateText(article.title),
              translateText(article.description)
            ]);
            return { ...article, translatedTitle, translatedDescription };
          } catch (e) {
            console.error(`Failed to translate article ${article.id}`, e);
            return article;
          }
        })
      );

      setArticles(updatedArticles);
      if (updatedArticles.every(a => a.translatedTitle)) {
        setAllTranslated(true);
      } else {
        setError("Some articles could not be translated. Please check your connection and try again.");
        setAllTranslated(false);
      }
    } catch (err) {
      console.error(err);
      setError('A critical error occurred during batch translation.');
    } finally {
      setIsTranslatingAll(false);
    }
  };

  const handlePlayAll = () => {
    if (!allTranslated) return;
    stop();

    const fullPlaylist: PlaylistItem[] = articles.flatMap(article => {
      if (!article.translatedTitle || !article.translatedDescription) {
        return [];
      }
      return [
        { text: article.translatedTitle, lang: 'en', voice: 'Kore' },
        { text: article.title, lang: 'ja', voice: 'Puck' },
        { text: article.translatedDescription, lang: 'en', voice: 'Kore' },
        { text: article.description.replace(/<[^>]*>?/gm, ''), lang: 'ja', voice: 'Puck' },
      ];
    });

    if (fullPlaylist.length > 0) {
      play(fullPlaylist);
    }
  };


  return (
    <div className="min-h-screen bg-gray-50 dark:bg-nhk-gray transition-colors duration-500">
      <header className="bg-nhk-red text-white shadow-lg sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <BrandIcon />
            <h1 className="text-xl sm:text-2xl font-bold">NHK Bilingual News Reader</h1>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-3">
            <button
              onClick={handleTranslateAll}
              disabled={isLoading || articles.length === 0 || isTranslatingAll}
              className="hidden sm:flex items-center justify-center px-3 py-2 bg-white/10 text-white font-semibold rounded-md hover:bg-white/20 transition-colors disabled:bg-white/5 disabled:cursor-not-allowed"
              title="Translate all articles"
            >
              {isTranslatingAll && <LoadingSpinner className="h-5 w-5 mr-2" />}
              <span>Translate All</span>
            </button>
            <button
              onClick={handlePlayAll}
              disabled={!allTranslated || playbackState !== 'stopped'}
              className="hidden sm:flex items-center justify-center px-3 py-2 bg-white/10 text-white font-semibold rounded-md hover:bg-white/20 transition-colors disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Play all translated articles"
            >
              <span>Play All</span>
            </button>
            <button
              onClick={loadNews}
              disabled={isLoading || isTranslatingAll}
              className="p-2 rounded-full hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Refresh News"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M20 4h-5v5M4 20h5v-5M12 4V2M12 22v-2M4 12H2M22 12h-2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" transform="rotate(-45 12 12)" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" transform="rotate(45 12 12)" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto p-4 sm:p-6 lg:p-8 pb-32">
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400">
            <LoadingSpinner className="h-12 w-12" />
            <p className="mt-4 text-lg">Fetching latest news from NHK...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-100 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-200 p-4 rounded-md shadow-md" role="alert">
            <div className="flex items-center">
              <ErrorIcon />
              <div className="ml-3">
                <p className="font-bold">An Error Occurred</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}
        
        {!isLoading && !error && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <NewsItem 
                key={article.id} 
                article={article}
                onTranslateAndRead={handleTranslateAndRead}
                isTranslating={translatingId === article.id || isTranslatingAll}
                isReading={currentItem?.text === article.translatedTitle || currentItem?.text === article.title}
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
    </div>
  );
};

export default App;
