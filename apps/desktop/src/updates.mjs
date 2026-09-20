export const RELEASE_API_URL = 'https://api.github.com/repos/dieWehmut/Sandkasten/releases/latest';
const RELEASE_PAGE = 'https://github.com/dieWehmut/Sandkasten/releases/tag/';

function versionParts(value) {
  const match = typeof value === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/.exec(value);
  if (!match) throw new Error('Invalid release version');
  const numbers = match.slice(1, 4).map(Number);
  const prerelease = match[4]?.split('.') ?? [];
  if (numbers.some((number) => !Number.isSafeInteger(number)) || prerelease.some((part) => /^0\d+$/.test(part))) {
    throw new Error('Invalid release version');
  }
  return { numbers, prerelease };
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numericX = /^\d+$/.test(x);
    const numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export async function checkForRelease({ currentVersion, fetchImpl = fetch, timeoutMs = 12_000 }) {
  versionParts(currentVersion);
  const response = await fetchImpl(RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Sandkasten-Update-Check',
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  if (response.status === 404) return { status: 'no-release', currentVersion };
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  const release = await response.json();
  if (release?.draft || release?.prerelease) return { status: 'no-release', currentVersion };
  const parts = versionParts(release?.tag_name);
  if (parts.prerelease.length) return { status: 'no-release', currentVersion };
  const comparison = compareVersions(release.tag_name, currentVersion);
  return {
    status: comparison > 0 ? 'available' : comparison < 0 ? 'ahead' : 'current',
    currentVersion,
    latestVersion: release.tag_name.replace(/^v/, ''),
    // Never use a server-supplied download URL as a shell target.
    url: RELEASE_PAGE + encodeURIComponent(release.tag_name),
  };
}

const COPY = {
  en: {
    title: 'Sandkasten updates',
    available: 'A new version is available',
    current: 'You are using the latest release',
    ahead: 'This build is newer than the latest release',
    'no-release': 'No stable release is available yet',
    error: 'Could not check for updates',
    errorDetail: 'Check your internet connection and try again. GitHub may be temporarily unavailable or rate limiting requests.',
    currentVersion: 'Current version', latestVersion: 'Latest release',
    download: 'Open release page', later: 'Later', ok: 'OK',
  },
  'zh-CN': {
    title: 'Sandkasten 更新',
    available: '发现新版本',
    current: '当前已是最新发布版本',
    ahead: '本机构建比最新 Release 更新',
    'no-release': '仓库暂未发布稳定版本',
    error: '无法检查更新',
    errorDetail: '请检查网络连接后重试。GitHub 可能暂时不可用或限制了请求频率。',
    currentVersion: '当前版本', latestVersion: '最新发布版本',
    download: '打开发布页', later: '稍后', ok: '确定',
  },
};

export function createUpdateChecker({ currentVersion, locale = 'en', fetchImpl, timeoutMs, showMessageBox, openExternal, onCheckingChange = () => {} }) {
  const copy = COPY[locale] ?? COPY.en;
  let inFlight;
  async function run() {
    try {
      const result = await checkForRelease({ currentVersion, fetchImpl, timeoutMs });
      const available = result.status === 'available';
      const detail = [`${copy.currentVersion}: ${currentVersion}`];
      if (result.latestVersion) detail.push(`${copy.latestVersion}: ${result.latestVersion}`);
      const choice = await showMessageBox({
        type: 'info', title: copy.title, message: copy[result.status], detail: detail.join('\n'),
        buttons: available ? [copy.download, copy.later] : [copy.ok],
        defaultId: 0, cancelId: available ? 1 : 0, noLink: true,
      });
      if (available && choice.response === 0) await openExternal(result.url);
      return result;
    } catch {
      await showMessageBox({ type: 'error', title: copy.title, message: copy.error, detail: copy.errorDetail, buttons: [copy.ok], noLink: true });
      return { status: 'error', currentVersion };
    }
  }
  return {
    check() {
      if (inFlight) return inFlight;
      onCheckingChange(true);
      inFlight = run().finally(() => {
        inFlight = undefined;
        onCheckingChange(false);
      });
      return inFlight;
    },
  };
}
