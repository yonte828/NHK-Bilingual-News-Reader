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

export type DiagnosticStepStatus = 'success' | 'failed' | 'skipped';

export interface DiagnosticStep {
  step: string;
  status: DiagnosticStepStatus;
  target?: string;
  httpStatus?: number | string;
  durationMs?: number;
  detail?: string;
}

export interface ErrorReport {
  operation: string;
  failedStep: string;
  summary: string;
  needSettings?: boolean;
  steps: DiagnosticStep[];
  timestamp: string;
}

export class DetailedApiError extends Error {
  public readonly report: ErrorReport;

  constructor(report: ErrorReport) {
    super(report.summary);
    this.name = 'DetailedApiError';
    this.report = report;
  }
}
