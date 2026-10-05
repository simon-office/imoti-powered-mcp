declare module 'node:os' {
  export function homedir(): string;
}

declare module 'node:crypto' {
  export function randomUUID(): string;
  export function createHash(algorithm: string): {
    update(data: Uint8Array): { digest(encoding: 'hex'): string };
  };
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
  export function readdir(path: string): Promise<string[]>;
  export function writeFile(path: string, data: string): Promise<void>;
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

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  stdout: { write(value: string): void };
  stderr: { write(value: string): void };
  exitCode?: number;
};
