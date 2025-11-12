
export interface NewsArticle {
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
  translatedTitle?: string;
  translatedDescription?: string;
}

export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'loading';

export interface PlaylistItem {
  text: string;
  lang: 'en' | 'ja';
  voice: 'Kore' | 'Puck'; // Example voices
}
