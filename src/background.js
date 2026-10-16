// Fetches repository data from the GitHub API for the content script.
// No token: public repositories only, 60 requests per hour per IP. Results are cached.
"use strict";

const CACHE_TTL_MS = 60 * 60 * 1000;
const memoryCache = new Map();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "repoInfo") {
    getRepoInfo(msg.owner, msg.repo).then(sendResponse, (err) => sendResponse({ error: String(err.message || err) }));
    return true; // Keep the channel open for the async response.
  }
  return false;
});

async function getRepoInfo(owner, repo) {
  const key = `repo:${owner}/${repo}`.toLowerCase();
  const cached = memoryCache.get(key) || (await readSessionCache(key));
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.info;

  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  const info = {
    fork: !!data.fork,
    defaultBranch: data.default_branch || null,
    parent: data.parent ? {
      owner: data.parent.owner.login,
      repo: data.parent.name,
      defaultBranch: data.parent.default_branch || null
    } : null
  };
  const entry = { at: Date.now(), info };
  memoryCache.set(key, entry);
  writeSessionCache(key, entry);
  return info;
}

// chrome.storage.session keeps the cache when the service worker restarts.
// Firefox before 115 does not have it, so failures are ignored.
async function readSessionCache(key) {
  try {
    const out = await chrome.storage.session.get(key);
    return out[key] || null;
  } catch (_) {
    return null;
  }
}

function writeSessionCache(key, entry) {
  try {
    chrome.storage.session.set({ [key]: entry }).catch(() => {});
  } catch (_) {
    // Ignore: cache is optional.
  }
}
