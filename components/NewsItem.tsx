
import React from 'react';
import type { NewsArticle } from '../types';
import { TranslateIcon, LoadingSpinner } from './IconComponents';

interface NewsItemProps {
  article: NewsArticle;
  onTranslateAndRead: (id: string) => void;
  isTranslating: boolean;
  isReading: boolean;
}

const NewsItem: React.FC<NewsItemProps> = ({ article, onTranslateAndRead, isTranslating, isReading }) => {
  return (
    <article className={`bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-xl transition-all duration-300 flex flex-col overflow-hidden ${isReading ? 'ring-4 ring-nhk-red' : ''}`}>
      <div className="p-5 flex-grow">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{article.pubDate}</p>
        <h2 className="text-lg font-bold text-nhk-gray dark:text-white mb-2 leading-snug">{article.title}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
          {article.completedDescription || article.description}
        </p>
        
        {article.translatedTitle && (
          <div className="mt-4 border-l-4 border-blue-500 pl-4 bg-blue-50 dark:bg-blue-900/20 p-2 rounded-r-md">
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300 mb-1">Japanese Translation</h3>
            <p className="text-md font-semibold text-gray-800 dark:text-gray-200 italic mb-2">{article.translatedTitle}</p>
            {article.translatedDescription && (
               <p className="text-sm text-gray-700 dark:text-gray-300">{article.translatedDescription}</p>
            )}
          </div>
        )}
      </div>

      <div className="bg-gray-50 dark:bg-gray-700/50 p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <a 
          href={article.link} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-sm text-nhk-red hover:underline font-semibold"
        >
          Read on Japan Times
        </a>
        <button
          onClick={() => onTranslateAndRead(article.id)}
          disabled={isTranslating}
          className="flex items-center justify-center px-4 py-2 bg-nhk-red text-white font-bold rounded-md hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-wait"
        >
          {isTranslating ? (
            <LoadingSpinner className="h-5 w-5" />
          ) : (
            <>
              <TranslateIcon />
              <span className="ml-2">{article.translatedTitle ? 'Read Aloud' : 'Translate & Read'}</span>
            </>
          )}
        </button>
      </div>
    </article>
  );
};

export default NewsItem;
