// End-to-end probe for the tray update flow. The real tray menu and the update
// dialog are native surfaces that no page-level driver can read, so a run that
// asks for the probe (SANDKASTEN_E2E_PROBE) publishes them instead of opening a
// modal that would block the asynchronous check. Normal launches stay inert.
export const E2E_PROBE_ENV = 'SANDKASTEN_E2E_PROBE';
export const E2E_RELEASE_ENV = 'SANDKASTEN_E2E_RELEASE';

function probeEnabled(environment) {
  const requested = environment?.[E2E_PROBE_ENV];
  return requested === '1' || requested === 'true';
}

// The update path is worth proving against a release this build cannot be, so a
// scripted run may serve its own latest-release response instead of asking
// GitHub for whatever happens to be published. The value is validated like a
// real tag, and "none" stands in for a repository without a stable release.
function scriptedFetch(environment) {
  const requested = environment?.[E2E_RELEASE_ENV];
  if (typeof requested !== 'string' || requested === '') return undefined;
  if (requested === 'none') return async () => new Response('{}', { status: 404 });
  // "live" keeps the real GitHub request so a run can prove the network path.
  if (requested === 'live') return undefined;
  if (!/^v?\d+\.\d+\.\d+$/.test(requested)) {
    throw new Error(`scripted release tag must be a plain version, "none", or "live": ${requested}`);
  }
  return async () => Response.json({ tag_name: requested, draft: false, prerelease: false });
}

export function createTrayProbe({ environment = process.env, target = globalThis } = {}) {
  if (!probeEnabled(environment)) {
    return { enabled: false, menu: () => undefined, onMenuChange: () => {}, showMessageBox: undefined };
  }

  let current;
  const dialogs = [];
  const downloads = [];
  const menus = [];
  let response;

  const probe = {
    enabled: true,
    menu: () => current,
    // Every rebuild is kept: the check may settle before a driver can sample
    // it, so the recorded sequence is what proves the progress state happened.
    menus: () => menus.slice(),
    onMenuChange: (template) => {
      current = template;
      menus.push(template);
    },
    dialogs,
    downloads: () => downloads.slice(),
    // Answering with the cancel button keeps a scripted run from opening a
    // release page it never asked for.
    answer(value = 1) { response = value; },
    async showMessageBox(options) {
      dialogs.push(options);
      if (response === undefined) return { response: options?.cancelId ?? 0 };
      const confirmed = response;
      response = undefined;
      return { response: confirmed };
    },
    openExternal(url) {
      downloads.push(url);
      return undefined;
    },
    fetch: scriptedFetch(environment),
  };

  target.__sandkastenTrayProbe = probe;
  return probe;
}
