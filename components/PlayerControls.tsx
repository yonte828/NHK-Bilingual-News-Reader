
import React from 'react';
import type { PlaybackState, PlaylistItem } from '../types';
import { PlayIcon, PauseIcon, StopIcon, LoadingSpinner } from './IconComponents';

interface PlayerControlsProps {
  currentItem: PlaylistItem;
  playbackState: PlaybackState;
  onPlayPause: () => void;
  onStop: () => void;
}

const PlayerControls: React.FC<PlayerControlsProps> = ({ currentItem, playbackState, onPlayPause, onStop }) => {
  const languageLabel = currentItem.lang === 'en' ? 'English' : 'Japanese';
  const languageColor = currentItem.lang === 'en' ? 'bg-blue-500' : 'bg-red-500';

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-nhk-gray/80 backdrop-blur-sm shadow-[0_-4px_10px_rgba(0,0,0,0.1)] z-30">
      <div className="container mx-auto px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0 mr-4">
            <div className="flex items-center mb-1">
              <span className={`px-2 py-0.5 text-xs font-bold text-white rounded-full ${languageColor}`}>
                {languageLabel}
              </span>
              {playbackState === 'loading' && (
                <div className="ml-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
                    <LoadingSpinner className="h-4 w-4 mr-1" />
                    <span>Generating audio...</span>
                </div>
              )}
            </div>
            <p className="text-sm sm:text-base text-gray-800 dark:text-gray-200 font-medium truncate">
              {currentItem.text}
            </p>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-4">
            <button
              onClick={onPlayPause}
              className="p-3 bg-gray-200 dark:bg-gray-700 rounded-full text-nhk-gray dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              aria-label={playbackState === 'playing' ? 'Pause' : 'Play'}
            >
              {playbackState === 'playing' ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              onClick={onStop}
              className="p-3 bg-nhk-red text-white rounded-full hover:bg-red-700 transition-colors"
              aria-label="Stop"
            >
              <StopIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerControls;
