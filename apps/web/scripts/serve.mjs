#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distributionFiles = new Set(['index.html', 'app.js', 'styles.css', 'config.js']);

export function resolveOptions(argv, environment = process.env) {
  let directory = environment.SANDKASTEN_PREVIEW_DIR ?? null;
  let host = '127.0.0.1';
  let port = 4173;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--directory' || flag === '--port' || flag === '--host') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      index += 1;
      if (flag === '--directory') directory = value;
      if (flag === '--host') host = value;
      if (flag === '--port') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) throw new Error(`invalid port: ${value}`);
        port = parsed;
      }
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }

  return { directory, host, port };
}

export async function createPreviewServer({ directory } = {}) {
  const root = directory ? path.resolve(directory) : null;
  if (!root) throw new Error('a distribution directory is required');
  const stats = await stat(root).catch(() => null);
  if (!stats || !stats.isDirectory()) throw new Error(`distribution directory does not exist: ${root}`);
  for (const name of distributionFiles) {
    const entry = await stat(path.join(root, name)).catch(() => null);
    if (!entry || !entry.isFile()) throw new Error(`distribution is missing ${name}: ${root}`);
  }

  const server = createServer(async (request, response) => {
    const requested = new URL(request.url, 'http://localhost').pathname;
    const name = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');

    if (!distributionFiles.has(name) || name !== path.basename(name)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found\n');
      return;
    }

    const target = path.join(root, name);
    if (path.dirname(target) !== root || !existsSync(target)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found\n');
      return;
    }

    const contentTypes = {
      'index.html': 'text/html; charset=utf-8',
      'app.js': 'text/javascript; charset=utf-8',
      'config.js': 'text/javascript; charset=utf-8',
      'styles.css': 'text/css; charset=utf-8',
    };
    const body = await readFile(target);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': body.length,
      'content-type': contentTypes[name],
    });
    response.end(body);
  });

  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  return server;
}

async function main() {
  const options = resolveOptions(process.argv.slice(2));
  const directory = options.directory ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const server = await createPreviewServer({ directory });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    process.stdout.write(`sandkasten web preview: http://${options.host}:${address.port}/\n`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`sandkasten web preview: ${error.message}\n`);
    process.exitCode = 1;
  });
}
