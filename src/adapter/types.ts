export interface SitePage {
  url: string;
  status: number;
  html: string;
  fetchedAt: Date;
}

export interface SiteAdapter {
  fetchPage(url: string): Promise<SitePage>;
  close(): Promise<void>;
}

export class ProtectiveScreenError extends Error {
  readonly url: string;
  readonly status: number;
  readonly howToContinue: string;

  constructor(url: string, status: number) {
    const howToContinue = 'Stop fetching and continue manually in visible mode (IMOTI_VISIBLE=1).';
    super(`A protective screen was detected at ${url}. ${howToContinue}`);
    this.name = 'ProtectiveScreenError';
    this.url = url;
    this.status = status;
    this.howToContinue = howToContinue;
  }
}
