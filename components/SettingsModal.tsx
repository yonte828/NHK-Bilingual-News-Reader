
import React, { useState, useEffect } from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

export const USER_API_KEY_STORAGE = 'nhk_news_user_api_key';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave }) => {
  const [apiKey, setApiKey] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const storedKey = localStorage.getItem(USER_API_KEY_STORAGE);
    if (storedKey) {
      setApiKey(storedKey);
    }
  }, [isOpen]);

  const handleSave = () => {
    if (apiKey.trim()) {
      localStorage.setItem(USER_API_KEY_STORAGE, apiKey.trim());
    } else {
      localStorage.removeItem(USER_API_KEY_STORAGE);
    }
    onSave();
    onClose();
  };

  const handleClear = () => {
    setApiKey('');
    localStorage.removeItem(USER_API_KEY_STORAGE);
    onSave();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-nhk-red px-6 py-4 flex justify-between items-center">
          <h2 className="text-white text-lg font-bold">Settings</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="p-6">
          <div className="mb-6">
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Gemini API Key
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Gemini APIキーを入力してください。キーはお使いのブラウザ内（ローカルストレージ）にのみ保存され、外部サーバーには送信されません。
            </p>
            <div className="relative">
              <input
                id="apiKey"
                type={isVisible ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                autoFocus
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-nhk-red focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setIsVisible(!isVisible)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                {isVisible ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.414-1.414A9 9 0 0010 18a9 9 0 00-4.9-1.45L3.707 2.293zM10 16a7 7 0 01-5.61-2.61l7.02-7.02A7.05 7.05 0 0110 4a7 7 0 017 7 7.05 7.05 0 01-1.39 4.29L10 16z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </div>
            <div className="mt-2 text-right">
                <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                >
                    Get a free API key here &rarr;
                </a>
            </div>
          </div>

          <div className="flex justify-between items-center">
             <button
              type="button"
              onClick={handleClear}
              className="text-sm text-red-500 hover:text-red-700 hover:underline"
            >
              Clear Key
            </button>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-nhk-red rounded-md hover:bg-red-700 transition-colors"
              >
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;
