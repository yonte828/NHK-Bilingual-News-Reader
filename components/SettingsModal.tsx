import React, { useState, useEffect } from 'react';
import type { DiagnosticStep } from '../types';
import { testApiConnection } from '../services/geminiService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

export const USER_API_KEY_STORAGE = 'nhk_news_user_api_key';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave }) => {
  const [apiKey, setApiKey] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    summary: string;
    steps: DiagnosticStep[];
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const storedKey = localStorage.getItem(USER_API_KEY_STORAGE);
      setApiKey(storedKey || '');
      setTestResult(null);
    }
  }, [isOpen]);

  const handleSave = () => {
    const trimmed = apiKey.trim();
    if (trimmed) {
      localStorage.setItem(USER_API_KEY_STORAGE, trimmed);
    } else {
      localStorage.removeItem(USER_API_KEY_STORAGE);
    }
    onSave();
    onClose();
  };

  const handleClear = () => {
    setApiKey('');
    setTestResult(null);
    localStorage.removeItem(USER_API_KEY_STORAGE);
    onSave();
  };

  const handleRunTest = async () => {
    if (isTesting) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testApiConnection(apiKey);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({
        ok: false,
        summary: `テスト実行中に予期しないエラーが発生しました: ${String(err?.message || err)}`,
        steps: [],
      });
    } finally {
      setIsTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-nhk-red px-6 py-4 flex justify-between items-center shrink-0">
          <h2 className="text-white text-lg font-bold">設定 (Settings)</h2>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="p-6 overflow-y-auto"
        >
          <div className="mb-5">
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Gemini API キー
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
              APIキーを保存すると、アプリはサーバー中継（/api/gemini/*）をバイパスし、お使いのブラウザから直接 Google Gemini API と通信します。キーは端末内にのみ保存されます。
            </p>
            <div className="relative">
              <input
                id="apiKey"
                type={isVisible ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (testResult) setTestResult(null);
                }}
                placeholder="AIzaSy..."
                autoFocus
                className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-nhk-red focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setIsVisible(!isVisible)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                aria-label={isVisible ? 'Hide key' : 'Show key'}
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

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleRunTest}
                disabled={isTesting}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                {isTesting ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 mr-1.5 text-nhk-red" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    接続テスト中...
                  </>
                ) : (
                  '接続テストを実行'
                )}
              </button>

              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center"
              >
                無料のGemini APIキーを取得 &rarr;
              </a>
            </div>
          </div>

          {testResult && (
            <div
              className={`mb-5 p-3 rounded-md border text-xs ${
                testResult.ok
                  ? 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-800 text-green-900 dark:text-green-200'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200'
              }`}
            >
              <p className="font-bold mb-2">{testResult.summary}</p>
              {testResult.steps.length > 0 && (
                <div className="space-y-1.5 font-mono text-[11px]">
                  {testResult.steps.map((s, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-white/70 dark:bg-black/25 border border-black/10 dark:border-white/10"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-semibold">
                          [{s.status === 'success' ? 'OK' : s.status === 'failed' ? 'NG' : 'SKIP'}] {s.step}
                        </span>
                        {(s.httpStatus !== undefined || s.durationMs !== undefined) && (
                          <span className="opacity-80">
                            {s.httpStatus !== undefined ? `HTTP ${s.httpStatus}` : ''}
                            {s.httpStatus !== undefined && s.durationMs !== undefined ? ' · ' : ''}
                            {s.durationMs !== undefined ? `${s.durationMs}ms` : ''}
                          </span>
                        )}
                      </div>
                      {s.target && <div className="opacity-75 break-all mt-0.5">{s.target}</div>}
                      {s.detail && <div className="mt-0.5 break-words">{s.detail}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-700">
            <button
              type="button"
              onClick={handleClear}
              className="text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              キーを消去
            </button>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-nhk-red rounded-md hover:bg-red-700 transition-colors"
              >
                保存する
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;
