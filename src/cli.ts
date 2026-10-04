import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport as ClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport as ServerTransport } from '@modelcontextprotocol/server';
import { FixtureAdapter } from './adapter/fixture.js';
import { PlaywrightAdapter } from './adapter/playwright.js';
import { ProtectiveScreenError } from './adapter/types.js';
import { createServer } from './server.js';
import { openStorage } from './storage/index.js';

const usage = `Usage:
  npm run search -- [--deal sale|rent] [--district NAME ...] [--type TYPE ...] [--rooms N] [--max-price N] [--limit N] [--pages N] [--price-min N] [--price-max N] [--area-min N] [--area-max N] [--fixtures DIR] [--visible]
  npm run listing -- <ID|URL> [--refresh] [--fixtures DIR] [--visible]
  npm run refresh -- [--fixtures DIR]`;
type Options = { fixtures?: string; visible: boolean; refresh: boolean };

function parse(argv: string[]) {
  const [command, ...args] = argv;
  if (!['search', 'listing', 'refresh'].includes(command ?? '')) throw new Error('Choose search, listing, or refresh');
  const options: Options = { visible: false, refresh: false };
  const criteria: Record<string, unknown> = {};
  let target: string | undefined;
  const numeric: Record<string, string> = { '--price-min': 'priceMin', '--price-max': 'priceMax', '--max-price': 'priceMax', '--area-min': 'areaMin', '--area-max': 'areaMax', '--limit': 'limit', '--pages': 'maxPages' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--visible') options.visible = true;
    else if (arg === '--refresh') options.refresh = true;
    else if (arg === '--fixtures' && args[i + 1]) options.fixtures = args[++i];
    else if (arg === '--deal' && args[i + 1] && ['sale', 'rent'].includes(args[i + 1])) criteria.deal = args[++i];
    else if ((arg === '--district' || arg === '--type') && args[i + 1]) {
      const key = arg === '--district' ? 'districts' : 'propertyTypes';
      const values = (criteria[key] as string[] | undefined) ?? [];
      values.push(args[++i]);
      criteria[key] = values;
    } else if (arg === '--rooms' && args[i + 1] && Number.isInteger(Number(args[i + 1]))) {
      const rooms = Number(args[++i]);
      criteria.rooms = { min: rooms, max: rooms };
    } else if (numeric[arg] && args[i + 1] && Number.isFinite(Number(args[i + 1]))) criteria[numeric[arg]] = Number(args[++i]);
    else if (!arg.startsWith('--') && command === 'listing' && !target) target = arg;
    else throw new Error(`Invalid argument: ${arg}`);
  }
  if (command === 'listing' && !target) throw new Error('Listing requires an id or URL');
  if (command === 'refresh' && (options.visible || options.refresh || Object.keys(criteria).length || target)) throw new Error('Refresh accepts only --fixtures DIR');
  return { command: command!, target, options, criteria };
}

async function fixtureAdapter(directory: string) {
  const files = await readdir(directory);
  const search = files.find(file => /^search(?:-normal)?\.html$/i.test(file));
  const listing = files.find(file => /^listing(?:-street)?\.html$/i.test(file));
  const mapping: Array<[RegExp, string]> = [];
  if (search) mapping.push([/\/obiavi\//, join(directory, search)]);
  if (listing) mapping.push([/\/obiava-/, join(directory, listing)]);
  return new FixtureAdapter(mapping, { detectProtectiveScreen: true });
}

async function main() {
  let parsed;
  try { parsed = parse(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${(error as Error).message}\n${usage}\n`); process.exitCode = 2; return; }
  const dataDir = process.env.IMOTI_DATA_DIR ?? join(homedir(), '.imoti-powered-mcp');
  let adapter;
  try {
    if (parsed.options.visible) process.env.IMOTI_VISIBLE = '1';
    adapter = parsed.options.fixtures ? await fixtureAdapter(parsed.options.fixtures) : new PlaywrightAdapter({ dataDir });
    await mkdir(dataDir, { recursive: true });
    const storage = openStorage(join(dataDir, 'imoti.db'));
    const server = createServer({ adapter, storage });
    const client = new Client({ name: 'imoti-cli', version: '1.0.0' });
    const [clientTransport, serverTransport] = ClientTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const result = parsed.command === 'search'
        ? await client.callTool({ name: 'search_listings', arguments: { criteria: Object.fromEntries(Object.entries(parsed.criteria).filter(([key]) => key !== 'limit')), limit: parsed.criteria.limit } })
        : parsed.command === 'listing'
          ? await client.callTool({ name: 'get_listing', arguments: /^https?:/.test(parsed.target!) ? { url: parsed.target, refresh: parsed.options.refresh } : { id: parsed.target, refresh: parsed.options.refresh } })
          : await client.callTool({ name: 'refresh_watched', arguments: {} });
      if (result.isError) throw new Error(result.content?.filter(item => item.type === 'text').map(item => item.text).join(' ') ?? 'Command failed');
      const structured = result.structuredContent as Record<string, any>;
      if (parsed.command === 'search') {
        await mkdir(dataDir, { recursive: true });
        await writeFile(join(dataDir, 'last-search.json'), `${JSON.stringify(structured, null, 2)}\n`);
        process.stdout.write(`Verification: ${structured.verification.ok ? 'passed' : 'mismatches found'}\n`);
        process.stdout.write('ID | price | area | floor | district | seller kind | URL\n');
        for (const item of structured.listings) process.stdout.write(`${item.id} | ${item.price?.amount ?? 'unknown'} | ${item.areaM2 ?? 'unknown'} | ${item.floor ?? 'unknown'} | ${item.location?.district ?? 'unknown'} | ${item.seller?.kind ?? 'unknown'} | ${item.url ?? ''}\n`);
      } else if (parsed.command === 'listing') process.stdout.write(`${JSON.stringify(structured.listing, null, 2)}\n`);
      else process.stdout.write(`Refreshed ${structured.refreshedSearches} saved search${structured.refreshedSearches === 1 ? '' : 'es'} and ${structured.refreshedListings} watched listing${structured.refreshedListings === 1 ? '' : 's'}; recorded ${structured.changes} change${structured.changes === 1 ? '' : 's'}.\n`);
    } finally { await client.close(); await server.close(); storage.close(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    if (error instanceof ProtectiveScreenError || /protective screen/i.test(message)) {
      process.stderr.write(`${message} Continue in visible mode with --visible.\n`); process.exitCode = 3;
    } else { process.stderr.write(`${message.split('\n')[0]}\n`); process.exitCode = 1; }
  } finally { await adapter?.close(); }
}

void main();
