// Pure logic. No DOM, no extension APIs. Shared by content.js and the Node tests.
(function (root) {
  "use strict";

  // First path segments that are GitHub pages, not repository owners.
  const RESERVED_OWNERS = new Set([
    "about", "account", "apps", "codespaces", "collections", "contact", "copilot",
    "dashboard", "enterprise", "enterprises", "explore", "features", "issues",
    "login", "logout", "marketplace", "new", "notifications", "orgs", "organizations",
    "pricing", "pulls", "search", "security", "settings", "signup", "sponsors",
    "topics", "trending", "users"
  ]);

  // Returns { owner, repo, ref } for a repository code page, else null.
  // ref is the first segment after /tree/ (a guess: branch names can contain "/").
  // ref is null on the repository root page (the default branch).
  function parseCodePage(pathname) {
    const parts = pathname.split("/").filter(Boolean).map(safeDecode);
    if (parts.length < 2 || RESERVED_OWNERS.has(parts[0].toLowerCase())) return null;
    const [owner, repo] = parts;
    if (parts.length === 2) return { owner, repo, ref: null };
    if (parts[2] === "tree" && parts.length >= 4) return { owner, repo, ref: parts[3] };
    return null;
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (_) { return s; }
  }

  // Searches parsed embedded page JSON for GitHub's refInfo object.
  // Returns { name, refType } or null.
  function findRefInfo(value, depth) {
    depth = depth || 0;
    if (!value || typeof value !== "object" || depth > 12) return null;
    const info = value.refInfo;
    if (info && typeof info === "object" && typeof info.name === "string" && info.name) {
      return { name: info.name, refType: info.refType || null };
    }
    for (const key of Object.keys(value)) {
      const found = findRefInfo(value[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  // Parses "owner/repo:branch", "owner/repo" or ":branch".
  // Missing parts are null. Returns null when the text is not valid.
  function parseTarget(text) {
    const s = String(text || "").trim();
    if (!s) return null;
    const colon = s.indexOf(":");
    const repoPart = colon === -1 ? s : s.slice(0, colon);
    const branch = colon === -1 ? null : s.slice(colon + 1).trim() || null;
    if (!repoPart) return branch ? { owner: null, repo: null, branch } : null;
    const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(repoPart.trim());
    if (!m) return null;
    return { owner: m[1], repo: m[2], branch };
  }

  // Parses override lines: "source/repo = target/repo:branch".
  // Empty lines and lines that start with "#" are ignored.
  // Returns { map, errors }. Map keys are lowercase "owner/repo".
  function parseOverrides(text) {
    const map = {};
    const errors = [];
    String(text || "").split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const eq = line.indexOf("=");
      const src = eq === -1 ? null : parseTarget(line.slice(0, eq));
      const dst = eq === -1 ? null : parseTarget(line.slice(eq + 1));
      if (!src || !src.owner || src.branch || !dst) {
        errors.push(`Line ${i + 1}: "${line}"`);
        return;
      }
      map[`${src.owner}/${src.repo}`.toLowerCase()] = dst;
    });
    return { map, errors };
  }

  // Decides the PR target. Order:
  //   1. Per-repo override.
  //   2. Repo: fork parent, else the same repo.
  //   3. Branch: global default branch setting, else the target repo's default branch, else "main".
  // repoInfo: { fork, defaultBranch, parent: { owner, repo, defaultBranch } | null } or null.
  function resolveTarget(current, repoInfo, settings) {
    const overrides = parseOverrides(settings && settings.overrides).map;
    const override = overrides[`${current.owner}/${current.repo}`.toLowerCase()] || {};

    let owner = current.owner;
    let repo = current.repo;
    let repoDefault = repoInfo ? repoInfo.defaultBranch : null;
    if (repoInfo && repoInfo.fork && repoInfo.parent) {
      owner = repoInfo.parent.owner;
      repo = repoInfo.parent.repo;
      repoDefault = repoInfo.parent.defaultBranch || null;
    }
    if (override.owner) {
      const sameAsComputed = override.owner.toLowerCase() === owner.toLowerCase() &&
        override.repo.toLowerCase() === repo.toLowerCase();
      if (!sameAsComputed) repoDefault = null;
      owner = override.owner;
      repo = override.repo;
    }
    const globalBranch = ((settings && settings.defaultBranch) || "").trim();
    const branch = override.branch || globalBranch || repoDefault || "main";
    return { owner, repo, branch };
  }

  // Encodes a ref for a URL path. Keeps "/" so branch names like "feature/x" work.
  function encodeRef(ref) {
    return String(ref).split("/").map(encodeURIComponent).join("/");
  }

  // Builds the compare URL that opens the "Open a pull request" form.
  // head: { owner, repo, branch }. target: { owner, repo, branch }.
  function buildCompareUrl(head, target, title) {
    const sameRepo = head.owner.toLowerCase() === target.owner.toLowerCase() &&
      head.repo.toLowerCase() === target.repo.toLowerCase();
    let headSpec;
    if (sameRepo) headSpec = encodeRef(head.branch);
    else if (head.repo.toLowerCase() === target.repo.toLowerCase()) headSpec = `${head.owner}:${encodeRef(head.branch)}`;
    else headSpec = `${head.owner}:${head.repo}:${encodeRef(head.branch)}`;

    const params = new URLSearchParams({ expand: "1" });
    if (title) params.set("title", title);
    return `https://github.com/${target.owner}/${target.repo}/compare/` +
      `${encodeRef(target.branch)}...${headSpec}?${params.toString()}`;
  }

  // True when head and target point to the same branch of the same repo.
  function isSameRef(head, target) {
    return head.owner.toLowerCase() === target.owner.toLowerCase() &&
      head.repo.toLowerCase() === target.repo.toLowerCase() &&
      head.branch === target.branch;
  }

  const api = {
    parseCodePage, findRefInfo, parseTarget, parseOverrides,
    resolveTarget, encodeRef, buildCompareUrl, isSameRef
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QuickPrLib = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
