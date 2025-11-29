
import React, { useState, useEffect, useCallback } from 'react';
import type { NewsArticle, PlaylistItem } from './types';
import { fetchAndParseRss } from './services/rssService';
import { translateText, translateArticlesBatch, generateSpeech, generatePodcastAudio } from './services/geminiService';
import { useTextToSpeech } from './hooks/useTextToSpeech';
import NewsItem from './components/NewsItem';
import PlayerControls from './components/PlayerControls';
import { LoadingSpinner, ErrorIcon, BrandIcon } from './components/IconComponents';

const LOCAL_STORAGE_KEY = 'nhk-bilingual-news-articles';

const getInitialArticles = (): NewsArticle[] => {
  try {
    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedData) {
      const parsedArticles = JSON.parse(savedData) as NewsArticle[];
      if (Array.isArray(parsedArticles)) {
        return parsedArticles;
      }
    }
  } catch (error) {
    console.error("Error reading articles from localStorage:", error);
    localStorage.removeItem(LOCAL_STORAGE_KEY); // Clear corrupted data
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
  // New state to hold the audio chunks for "Play All"
  const [podcastAudioChunks, setPodcastAudioChunks] = useState<string[] | null>(null);

  const { play, stop, pause, resume, playbackState, currentItem } = useTextToSpeech();

  // Save articles to localStorage whenever they change
  useEffect(() => {
    try {
      if (!isLoading && articles.length > 0) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(articles));
      }
    } catch (e) {
      console.error("Failed to save articles to localStorage:", e);
    }
  }, [articles, isLoading]);

  // Determine if all articles are translated based on current articles state (Text only)
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
    // If articles exist and we are not forcing a refresh, do nothing.
    if (articles.length > 0 && !forceRefresh) {
        setIsLoading(false);
        return;
    }

    setIsLoading(true);
    setError(null);
    setAllTranslated(false);
    setPodcastAudioChunks(null); // Reset podcast audio on reload
    try {
      const newsItems = await fetchAndParseRss();
      setArticles(newsItems);
    } catch (err) {
      console.error(err);
      setError('Failed to fetch or parse the news feed. Please try again later.');
      setArticles([]); // Clear articles on error
      localStorage.removeItem(LOCAL_STORAGE_KEY); // Clear storage on error
    } finally {
      setIsLoading(false);
    }
  }, [articles.length]);

  // Load news on initial mount if no articles are loaded from storage
  useEffect(() => {
    if (articles.length === 0) {
        loadNews();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTranslateAndRead = async (articleId: string) => {
    if (translatingId || isTranslatingAll) return;

    const article = articles.find(a => a.id === articleId);
    if (!article) return;
    
    setTranslatingId(articleId);
    stop();

    try {
      let translatedTitle = article.translatedTitle;
      let translatedDescription = article.translatedDescription;
      let translatedTitleAudio = article.translatedTitleAudio;
      let translatedDescriptionAudio = article.translatedDescriptionAudio;
      let titleAudio = article.titleAudio;
      let descriptionAudio = article.descriptionAudio;

      // 1. Translate Text if needed
      if (!translatedTitle || !translatedDescription) {
        [translatedTitle, translatedDescription] = await Promise.all([
          translateText(article.title),
          translateText(article.description)
        ]);
      }

      // 2. Generate Audio if needed (for both EN and JA to ensure smooth playback)
      const cleanJaDesc = article.description.replace(/<[^>]*>?/gm, '');
      
      if (!translatedTitleAudio) translatedTitleAudio = await generateSpeech(translatedTitle!, 'Kore');
      if (!translatedDescriptionAudio) translatedDescriptionAudio = await generateSpeech(translatedDescription!, 'Kore');
      if (!titleAudio) titleAudio = await generateSpeech(article.title, 'Puck');
      if (!descriptionAudio) descriptionAudio = await generateSpeech(cleanJaDesc, 'Puck');

      // 3. Update State
      setArticles(prevArticles =>
        prevArticles.map(a =>
          a.id === articleId ? { 
            ...a, 
            translatedTitle, 
            translatedDescription,
            translatedTitleAudio,
            translatedDescriptionAudio,
            titleAudio,
            descriptionAudio
          } : a
        )
      );
      
      const playlist: PlaylistItem[] = [
        { text: translatedTitle!, lang: 'en', voice: 'Kore', audioB64: translatedTitleAudio },
        { text: article.title, lang: 'ja', voice: 'Puck', audioB64: titleAudio },
        { text: translatedDescription!, lang: 'en', voice: 'Kore', audioB64: translatedDescriptionAudio },
        { text: cleanJaDesc, lang: 'ja', voice: 'Puck', audioB64: descriptionAudio },
      ];

      play(playlist);

    } catch (err) {
      console.error(err);
      setError(`Failed to process article. Please check your connection and API key.`);
    } finally {
      setTranslatingId(null);
    }
  };

  const handleTestAudio = async () => {
      if (isTranslatingAll) return;
      setIsTranslatingAll(true);
      setError(null);
      stop();
      console.log("🔍 [Debug] Starting Test Audio");

      try {
          const testScript = `
EnglishSpeaker
This is a test of the bilingual news reader system. We are checking if the audio generation works correctly without skipping any parts.
JapaneseSpeaker
これはバイリンガルニュースリーダーシステムのテストです。音声生成が部分的にスキップされずに正しく機能しているかを確認しています。
EnglishSpeaker
End of test message.
          `.trim();
          
          const audio = await generatePodcastAudio(testScript);
          console.log("🔍 [Debug] Test Audio Generated. Size:", audio.length);

          const playlist: PlaylistItem[] = [{
              text: "Audio Test Run",
              lang: 'en',
              voice: 'Kore',
              audioB64: audio
          }];
          play(playlist);

      } catch (e) {
          console.error("❌ [Debug] Test Audio Failed", e);
          setError("Test Audio Failed.");
      } finally {
          setIsTranslatingAll(false);
      }
  };

  const generateAudioChunks = async (articlesToProcess: NewsArticle[]) => {
    // RATE LIMIT FIX: Increase chunk size to 3 to reduce total requests.
    // Combined with a 6s delay, this keeps us under the 10 RPM limit.
    const AUDIO_CHUNK_SIZE = 3; 
    const audioChunks: string[] = [];
    const totalAudioChunks = Math.ceil(articlesToProcess.length / AUDIO_CHUNK_SIZE);

    for (let i = 0; i < articlesToProcess.length; i += AUDIO_CHUNK_SIZE) {
        const chunkIndex = Math.floor(i / AUDIO_CHUNK_SIZE) + 1;
        setTranslationProgress(`Creating audio digest Part ${chunkIndex}/${totalAudioChunks}...`);
        
        const chunk = articlesToProcess.slice(i, i + AUDIO_CHUNK_SIZE);
        
        // Skip chunks that don't have translations yet (sanity check)
        const validChunk = chunk.filter(a => a.translatedTitle && a.translatedDescription);
        
        if (chunk.length !== validChunk.length) {
            console.warn(`[Debug] Chunk ${chunkIndex} has skipped items due to missing translation.`, chunk.filter(a => !a.translatedTitle || !a.translatedDescription));
        }

        if (validChunk.length === 0) continue;

        // Build script strictly to avoid empty turns
        // UPDATED: Using Newlines instead of "Speaker: Text" to prevent skipping
        const scriptParts: string[] = [];
        
        validChunk.forEach(a => {
            // Add Title (Required)
            if (a.translatedTitle) {
                scriptParts.push(`EnglishSpeaker\n${a.translatedTitle}`);
            }
            if (a.title) {
                scriptParts.push(`JapaneseSpeaker\n${a.title}`);
            }
            
            // Add Description (Optional but common)
            if (a.translatedDescription && a.translatedDescription.trim() !== '') {
                scriptParts.push(`EnglishSpeaker\n${a.translatedDescription}`);
            }
            
            // Clean Japanese Description
            // Remove HTML, collapse spaces, trim
            let jaDesc = a.description.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
            if (jaDesc.length > 0) {
                // Truncate if too long to avoid model confusion/timeout
                if (jaDesc.length > 150) {
                    jaDesc = jaDesc.slice(0, 150) + "。";
                }
                scriptParts.push(`JapaneseSpeaker\n${jaDesc}`);
            }
        });

        const script = scriptParts.join('\n');
        console.log(`🔍 [Debug] Script for chunk ${chunkIndex} (length: ${script.length}):\n${script}`);

        // RETRY LOGIC for robustness against rate limits
        const maxRetries = 3;
        let attempt = 0;
        let success = false;

        while (attempt < maxRetries && !success) {
            try {
                const audioData = await generatePodcastAudio(script);
                audioChunks.push(audioData);
                success = true;
            } catch (err) {
                attempt++;
                console.error(`❌ [Debug] Failed to generate audio for chunk ${chunkIndex}, attempt ${attempt}`, err);
                
                if (attempt < maxRetries) {
                    setTranslationProgress(`Retrying Part ${chunkIndex}... (Attempt ${attempt}/${maxRetries})`);
                    // Wait 10 seconds before retry to let the rate limit bucket refill
                    await new Promise(r => setTimeout(r, 10000));
                } else {
                     console.error(`❌ [Debug] Gave up on chunk ${chunkIndex} after ${maxRetries} attempts.`);
                     // We continue to next chunk even if one fails, to not break everything
                }
            }
        }
        
        // RATE LIMIT FIX: 6000ms delay ensures we stay under 10 RPM.
        // 60s / 6s = 10 requests per minute max.
        if (i + AUDIO_CHUNK_SIZE < articlesToProcess.length) {
            setTranslationProgress(`Cooling down API (Part ${chunkIndex}/${totalAudioChunks})...`);
            await new Promise(r => setTimeout(r, 6000));
        }
    }
    return audioChunks;
  };

  const handleTranslateAll = async () => {
    if (isTranslatingAll) return;
    setIsTranslatingAll(true);
    setError(null);
    stop();
  
    console.log("🔍 [Debug] Start handleTranslateAll");

    try {
      // 1. Translate Text First (Batched)
      const articlesToProcess = articles.filter(a => !a.translatedTitle || !a.translatedDescription);
      console.log(`🔍 [Debug] Articles needing translation: ${articlesToProcess.length}`);
      
      // Use a local copy to accumulate changes
      let localArticles = [...articles];
      
      if (articlesToProcess.length > 0) {
        const TEXT_CHUNK_SIZE = 5;
        const totalChunks = Math.ceil(articlesToProcess.length / TEXT_CHUNK_SIZE);

        for (let i = 0; i < articlesToProcess.length; i += TEXT_CHUNK_SIZE) {
            const chunkIndex = Math.floor(i / TEXT_CHUNK_SIZE) + 1;
            console.log(`🔍 [Debug] Processing text chunk ${chunkIndex}/${totalChunks}`);
            setTranslationProgress(`Translating text ${chunkIndex}/${totalChunks}...`);
            
            const chunk = articlesToProcess.slice(i, i + TEXT_CHUNK_SIZE);
            const translatedData = await translateArticlesBatch(chunk);
            console.log(`🔍 [Debug] Received data from API for chunk ${chunkIndex}`, translatedData);

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
            
            // Also update UI incrementally
            setArticles([...localArticles]);
            
            if (i + TEXT_CHUNK_SIZE < articlesToProcess.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
      }

      // 2. Generate Podcast Audio in Chunks
      console.log("🔍 [Debug] Starting Audio Generation Phase");
      const chunks = await generateAudioChunks(localArticles);
      setPodcastAudioChunks(chunks);
      
      console.log(`🔍 [Debug] Generated ${chunks.length} audio chunks successfully.`);
      
    } catch (e) {
      console.error(`❌ [Debug] Error in handleTranslateAll`, e);
      setError("Failed to complete process. Please try again.");
    } finally {
      setIsTranslatingAll(false);
      setTranslationProgress('');
      console.log("🔍 [Debug] Finished handleTranslateAll");
    }
  };


  const handlePlayAll = async () => {
    stop();
    console.log("🔍 [Debug] Play All clicked");
    
    // If we have the podcast audio ready, play it.
    if (podcastAudioChunks && podcastAudioChunks.length > 0) {
        console.log("🔍 [Debug] Podcast audio exists, playing playlist.");
        const playlist = podcastAudioChunks.map((audio, index) => ({
            text: `News Digest Part ${index + 1}`,
            lang: 'en' as const,
            voice: 'Kore' as const,
            audioB64: audio
        }));
        play(playlist);
        return;
    }

    // If not ready, we need to generate it.
    console.log("🔍 [Debug] Audio missing. Checking if text needs translation...");
    
    // Check if we need text translation first
    const untranslated = articles.some(a => !a.translatedTitle);
    
    if (untranslated) {
        // If text is missing, redirect to Translate All logic effectively
        console.log("🔍 [Debug] Untranslated text found. Running full translate process.");
        await handleTranslateAll();
        return;
    }

    // All translated but audio missing (e.g. page reload or cleared)
    console.log("🔍 [Debug] All translated. Generating audio digest...");
    setIsTranslatingAll(true);
    
    try {
        const chunks = await generateAudioChunks(articles);
        setPodcastAudioChunks(chunks);
        
        const playlist = chunks.map((audio, index) => ({
            text: `News Digest Part ${index + 1}`,
            lang: 'en' as const,
            voice: 'Kore' as const,
            audioB64: audio
        }));
        play(playlist);

    } catch(e) {
         console.error("❌ [Debug] Error generating audio", e);
        setError("Failed to generate audio.");
    } finally {
        setIsTranslatingAll(false);
        setTranslationProgress('');
    }
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
              onClick={handleTranslateAll}
              disabled={isLoading || articles.length === 0 || isTranslatingAll || (allTranslated && !!podcastAudioChunks)}
              className="flex items-center justify-center px-3 py-2 bg-white/10 text-white font-semibold rounded-md hover:bg-white/20 transition-colors disabled:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 min-w-[140px]"
              title="Translate and generate audio for all articles"
            >
              {isTranslatingAll ? (
                  <div className="flex items-center">
                      <LoadingSpinner className="h-4 w-4 mr-2" />
                      <span className="text-xs sm:text-sm whitespace-nowrap">{translationProgress || 'Processing'}</span>
                  </div>
              ) : (
                <span>{(allTranslated && podcastAudioChunks) ? 'All Ready' : 'Translate All'}</span>
              )}
            </button>
            <button
              onClick={handlePlayAll}
              disabled={articles.length === 0 || isTranslatingAll}
              className="flex items-center justify-center px-3 py-2 bg-white/10 text-white font-semibold rounded-md hover:bg-white/20 transition-colors disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Play all translated articles"
            >
              <span>Play All</span>
            </button>
            
            <button
              onClick={handleTestAudio}
              disabled={isTranslatingAll}
              className="flex items-center justify-center px-3 py-2 bg-yellow-500/20 text-yellow-100 font-semibold rounded-md hover:bg-yellow-500/30 transition-colors disabled:opacity-50 text-sm border border-yellow-500/50"
              title="Run a quick audio test"
            >
              Test
            </button>

            <button
              onClick={() => loadNews(true)}
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
                isTranslating={translatingId === article.id}
                isReading={(currentItem?.text === article.translatedTitle || currentItem?.text === article.title) && !podcastAudioChunks}
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
