import { DEFAULT_MAX_PAGES } from './adapter/playwright.js';

export function adapterPageLimit(command: string, searchMaxPages: number | undefined): number {
  return command === 'search' ? searchMaxPages ?? DEFAULT_MAX_PAGES : DEFAULT_MAX_PAGES;
}
