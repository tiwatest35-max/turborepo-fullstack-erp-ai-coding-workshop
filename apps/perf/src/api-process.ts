import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const apiDir = join(config.repoRoot, 'apps', 'api');
const entry = join(apiDir, 'dist', 'main.js');

export const apiBaseUrl = `http://localhost:${config.apiPort}/api`;

export type RunningApi = { stop: () => Promise<void>; output: () => string };

/**
 * Starts the built API (the same `node dist/main.js` production runs) against the performance
 * database and waits until its health route answers.
 */
export async function startApi(): Promise<RunningApi> {
  if (!existsSync(entry)) {
    throw new Error(
      `${entry} does not exist. Build the API first: pnpm turbo run build --filter=@erp/api`,
    );
  }

  const child: ChildProcess = spawn(process.execPath, ['--enable-source-maps', entry], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(config.apiPort),
      DATABASE_URL: config.perfDatabaseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  const keep = (chunk: Buffer) => (log = (log + chunk.toString()).slice(-20_000));
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  let exited = false;
  child.once('exit', () => (exited = true));

  const api: RunningApi = {
    output: () => log,
    stop: async () => {
      if (exited) return;
      const closed = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await closed;
    },
  };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The API exited while starting:\n${log}`);
    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      if (response.ok) return api;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await api.stop();
  throw new Error(`The API did not answer ${apiBaseUrl}/health within 60 s:\n${log}`);
}
