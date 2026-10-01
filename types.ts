export interface NewsArticle {
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
  completedDescription?: string; // Natural completed Japanese description (no trailing "…")
  translatedTitle?: string;      // English translated title
  translatedDescription?: string;// English translated description
  translatedTitleAudio?: string;
  titleAudio?: string;
  translatedDescriptionAudio?: string;
  descriptionAudio?: string;
}

export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'loading';

export interface PlaylistItem {
  text: string;
  lang: 'en' | 'ja';
  voice: 'Kore' | 'Puck'; // Kore (English), Puck (Japanese)
  audioB64?: string;
}
