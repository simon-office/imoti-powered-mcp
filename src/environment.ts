import { homedir } from 'node:os';
import { join } from 'node:path';

export function nonEmptyEnvironmentValue(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

export function dataDirectory(value: string | undefined = process.env.IMOTI_DATA_DIR): string {
  return nonEmptyEnvironmentValue(value) ?? join(homedir(), '.imoti-powered-mcp');
}
