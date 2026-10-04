declare module 'node:os' {
  export function homedir(): string;
}

declare module 'node:util' {
  export function isDeepStrictEqual(value1: unknown, value2: unknown): boolean;
}

declare module 'node:fs' {
  export function mkdirSync(path: string, options: { recursive: boolean }): void;
}

declare module 'node:fs/promises' {
  export function readFile(path: string | URL): Promise<Uint8Array>;
  export function mkdir(path: string, options: { recursive: boolean }): Promise<void>;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...values: unknown[]): unknown;
      all(...values: unknown[]): unknown[];
      run(...values: unknown[]): unknown;
    };
    close(): void;
  }
}

declare const process: { env: Record<string, string | undefined> };
