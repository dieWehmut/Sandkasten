import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

export const VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ name: 'tablet', width: 1024, height: 768 }),
  Object.freeze({ name: 'mobile', width: 390, height: 844 }),
]);

const WINDOWS_BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const UNIX_BROWSER_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

export function findBrowserExecutable({ env = process.env, platform = process.platform, existsSync: exists = existsSync } = {}) {
  const explicit = [env.SANDKASTEN_BROWSER_PATH, env.CHROME_PATH, env.EDGE_PATH]
    .find((candidate) => typeof candidate === 'string' && candidate.trim());
  if (explicit && exists(explicit)) return explicit;

  const candidates = platform === 'win32' ? WINDOWS_BROWSER_PATHS : UNIX_BROWSER_PATHS;
  return candidates.find((candidate) => exists(candidate));
}

export function loadPlaywrightChromium({ webuiDirectory, createRequireImpl = createRequire } = {}) {
  if (!webuiDirectory) throw new Error('webuiDirectory is required to load Playwright Core');
  const requireFromWebui = createRequireImpl(path.join(webuiDirectory, 'package.json'));
  const playwright = requireFromWebui('playwright-core');
  if (!playwright?.chromium?.launch) throw new Error('playwright-core did not provide Chromium');
  return playwright.chromium;
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function unfilterRows(compressed, width, height, bytesPerPixel, rowBytes) {
  const encoded = inflateSync(compressed);
  const expectedLength = height * (rowBytes + 1);
  if (encoded.length !== expectedLength) throw new Error(`Unsupported PNG row data length: ${encoded.length}`);
  const rows = Buffer.alloc(height * rowBytes);
  let offset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = encoded[offset];
    offset += 1;
    const sourceStart = offset;
    const targetStart = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const source = encoded[sourceStart + column];
      const left = column >= bytesPerPixel ? rows[targetStart + column - bytesPerPixel] : 0;
      const above = row ? rows[targetStart - rowBytes + column] : 0;
      const upperLeft = row && column >= bytesPerPixel ? rows[targetStart - rowBytes + column - bytesPerPixel] : 0;
      let value;
      if (filter === 0) value = source;
      else if (filter === 1) value = source + left;
      else if (filter === 2) value = source + above;
      else if (filter === 3) value = source + Math.floor((left + above) / 2);
      else if (filter === 4) value = source + paeth(left, above, upperLeft);
      else throw new Error(`Unsupported PNG filter: ${filter}`);
      rows[targetStart + column] = value & 0xff;
    }
    offset += rowBytes;
  }
  return rows;
}

function decodePng(buffer) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('Invalid PNG signature');
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  while (offset < buffer.length) {
    const length = readUInt32(buffer, offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;
    if (type === 'IHDR') {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0) throw new Error('Only non-interlaced 8-bit PNGs are supported');
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type: ${colorType}`);
  const rows = unfilterRows(Buffer.concat(idat), width, height, channels, width * channels);
  const rgba = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let targetOffset = 0;
  for (let index = 0; index < width * height; index += 1) {
    if (colorType === 6) {
      rows.copy(rgba, targetOffset, sourceOffset, sourceOffset + 4);
    } else if (colorType === 2) {
      rows.copy(rgba, targetOffset, sourceOffset, sourceOffset + 3);
      rgba[targetOffset + 3] = 255;
    } else if (colorType === 4) {
      rgba[targetOffset] = rows[sourceOffset];
      rgba[targetOffset + 1] = rows[sourceOffset];
      rgba[targetOffset + 2] = rows[sourceOffset];
      rgba[targetOffset + 3] = rows[sourceOffset + 1];
    } else {
      rgba[targetOffset] = rows[sourceOffset];
      rgba[targetOffset + 1] = rows[sourceOffset];
      rgba[targetOffset + 2] = rows[sourceOffset];
      rgba[targetOffset + 3] = 255;
    }
    sourceOffset += channels;
    targetOffset += 4;
  }
  return { width, height, rgba };
}

export function inspectScreenshot(buffer) {
  const { width, height, rgba } = decodePng(buffer);
  const colors = new Set();
  let opaquePixels = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    colors.add(rgba.subarray(offset, offset + 4).toString('hex'));
    if (rgba[offset + 3] > 0) opaquePixels += 1;
  }
  return { width, height, opaquePixels, distinctColors: colors.size };
}

export function measurePixelDifference(firstBuffer, secondBuffer) {
  const first = decodePng(firstBuffer);
  const second = decodePng(secondBuffer);
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error('Screenshots must have equal dimensions for pixel comparison');
  }
  let changedPixels = 0;
  for (let offset = 0; offset < first.rgba.length; offset += 4) {
    if (!first.rgba.subarray(offset, offset + 4).equals(second.rgba.subarray(offset, offset + 4))) changedPixels += 1;
  }
  const totalPixels = first.width * first.height;
  return { changedPixels, totalPixels, ratio: totalPixels ? changedPixels / totalPixels : 0 };
}

function json(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  response.end(body);
}

function staticResponse(response, filePath) {
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };
  try {
    const body = readFileSync(filePath);
    response.writeHead(200, {
      'content-type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    json(response, 404, { message: 'Not found' });
  }
}

export async function createMockAppServer({ distDir, jobSequence = ['JOB_STATUS_RUNNING', 'JOB_STATUS_SUCCEEDED'] } = {}) {
  if (!distDir) throw new Error('distDir is required');
  const jobs = new Map();
  let jobNumber = 0;
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname === '/healthz') {
      json(response, 200, { status: 'ok' });
      return;
    }
    if (requestUrl.pathname === '/v1/runtimes') {
      json(response, 200, {
        runtimes: [{ language: 'python', version: '3.13', image: 'python:3.13', status: 'ready', compile_phase: { enabled: false }, run_phase: { enabled: true } }],
      });
      return;
    }
    const runMatch = requestUrl.pathname.match(/^\/v1\/([^/]+)\/run$/);
    if (request.method === 'POST' && runMatch) {
      let body = '';
      for await (const chunk of request) body += chunk;
      let payload;
      try { payload = JSON.parse(body); } catch { json(response, 400, { message: 'Invalid JSON' }); return; }
      if (typeof payload.source !== 'string' || !payload.source.trim()) {
        json(response, 400, { message: 'Source is required' });
        return;
      }
      jobNumber += 1;
      const jobId = `browser-smoke-${jobNumber}`;
      const job = {
        jobId,
        language: decodeURIComponent(runMatch[1]),
        status: 'JOB_STATUS_QUEUED',
        source: payload.source,
        pollCount: 0,
        stdout: 'browser smoke output\n<em>rendered as text</em>',
        stderr: 'browser smoke stderr',
        compileStdout: '',
        compileStderr: '',
        stdoutEncoding: 'utf8',
        stderrEncoding: 'utf8',
        durationMs: 42,
        exitCode: 0,
      };
      jobs.set(jobId, job);
      json(response, 202, { ...job });
      return;
    }
    const jobMatch = requestUrl.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (request.method === 'GET' && jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1]));
      if (!job) { json(response, 404, { message: 'Job not found' }); return; }
      const nextStatus = jobSequence[Math.min(job.pollCount, jobSequence.length - 1)] ?? 'JOB_STATUS_SUCCEEDED';
      job.pollCount += 1;
      job.status = nextStatus;
      json(response, 200, { ...job });
      return;
    }
    const allowed = new Set(['index.html', 'app.js', 'styles.css', 'config.js']);
    const name = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
    if (allowed.has(name) && !name.includes('/')) {
      staticResponse(response, path.join(distDir, name));
      return;
    }
    json(response, 404, { message: 'Not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  if (!port) throw new Error('Mock server did not expose a port');
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
