// Version checks for the About window. OTIS uses semantic versioning
// (MAJOR.MINOR.PATCH). package.json holds the version, and each release is
// published on GitHub as a release tagged vX.Y.Z. Pure apart from the fetch.

export const REPO = 'WolfBrandon/otis';
export const REPO_URL = 'https://github.com/' + REPO;

// -1, 0 or 1. Compares numerically, so 0.10.0 is newer than 0.9.0.
export function compareVersions(a, b) {
  const parse = v => { const p = String(v).replace(/^v/, '').split(/[.+-]/); return [0, 1, 2].map(i => parseInt(p[i], 10) || 0); };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// The newest published release → { version, url }, or null when that can't
// be found out (offline, no release yet, or the repository isn't public).
export async function latestRelease({ timeout = 5000 } = {}) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    const r = await res.json();
    return r.tag_name ? { version: r.tag_name.replace(/^v/, ''), url: r.html_url } : null;
  } catch {
    return null;
  }
}
