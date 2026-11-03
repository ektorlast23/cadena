import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChainFile } from './types.ts';

export class JsonStore {
  readonly dir: string;
  readonly file: string;

  constructor(dataDir: string) {
    this.dir = dataDir;
    this.file = join(dataDir, 'chain.json');
  }

  ensureDir(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  load(): ChainFile | undefined {
    if (!existsSync(this.file)) return undefined;
    const raw = readFileSync(this.file, 'utf8');
    return JSON.parse(raw) as ChainFile;
  }

  save(data: ChainFile): void {
    this.ensureDir();
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
    renameSync(temporary, this.file);
  }
}
