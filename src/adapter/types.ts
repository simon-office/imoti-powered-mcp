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

  constructor(url: string, status: number) {
    super(`A protective screen was detected at ${url}. Stop fetching and continue manually in visible mode (IMOTI_VISIBLE=1).`);
    this.name = 'ProtectiveScreenError';
    this.url = url;
    this.status = status;
  }
}
