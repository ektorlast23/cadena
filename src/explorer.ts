import { readFileSync } from 'node:fs';

export const EXPLORER_HTML = readFileSync(new URL('./explorer.html', import.meta.url), 'utf8');
