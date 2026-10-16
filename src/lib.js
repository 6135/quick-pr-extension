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

  // Decides the default PR target (a remembered target wins over it, see pickTarget). Order:
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

  // Storage key for the last target used from a source repo.
  function rememberKey(owner, repo) {
    return `last:${owner}/${repo}`.toLowerCase();
  }

  // The target used last time wins over the computed default.
  // remembered: { owner, repo, branch } or null. Incomplete values are ignored.
  function pickTarget(remembered, computed) {
    if (remembered && remembered.owner && remembered.repo && remembered.branch) {
      return { owner: remembered.owner, repo: remembered.repo, branch: remembered.branch, remembered: true };
    }
    return { owner: computed.owner, repo: computed.repo, branch: computed.branch, remembered: false };
  }

  // ---- Quick actions ----
  // Stored shape: { id, name, target, repos, titlePrefix, body, labels, assignees }.
  //   target: "owner/repo:branch", or ":branch" for the default target repo with that branch.
  //   repos: source repo patterns ("owner/repo", "owner/*", "*"), split by comma or new line.
  //          Empty means all repos.
  //   labels, assignees: comma-separated lists.

  function splitList(text) {
    return String(text || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }

  // Returns { action, error }. action has clean values. error is a string or null.
  function normalizeAction(raw) {
    const r = raw || {};
    const name = String(r.name || "").trim();
    const targetText = String(r.target || "").trim();
    if (!name) return { action: null, error: "The name is required." };
    const t = parseTarget(targetText);
    if (!t || !t.branch) return { action: null, error: `"${name}": use owner/repo:branch or :branch for the target.` };
    const repos = splitList(r.repos);
    const badRepo = repos.find((p) => !/^(\*|[A-Za-z0-9-]+\/(\*|[A-Za-z0-9._-]+))$/.test(p));
    if (badRepo) return { action: null, error: `"${name}": incorrect repo pattern "${badRepo}".` };
    return {
      action: {
        id: String(r.id || ""),
        name,
        target: targetText,
        repos: repos.join(", "),
        titlePrefix: String(r.titlePrefix || ""),
        body: String(r.body || ""),
        labels: splitList(r.labels).join(","),
        assignees: splitList(r.assignees).map((a) => a.replace(/^@/, "")).join(",")
      },
      error: null
    };
  }

  function matchesRepo(patterns, owner, repo) {
    const list = splitList(patterns);
    if (!list.length) return true;
    const o = owner.toLowerCase();
    const full = `${o}/${repo.toLowerCase()}`;
    return list.some((p) => {
      const q = p.toLowerCase();
      return q === "*" || q === full || q === `${o}/*`;
    });
  }

  function actionsForRepo(actions, owner, repo) {
    return (actions || []).filter((a) => a && matchesRepo(a.repos, owner, repo));
  }

  // computed: the default target ({ owner, repo, branch }).
  function actionTarget(action, computed) {
    const t = parseTarget(action.target);
    if (!t || !t.branch) return null;
    if (!t.owner) return { owner: computed.owner, repo: computed.repo, branch: t.branch };
    return { owner: t.owner, repo: t.repo, branch: t.branch };
  }

  function applyTitlePrefix(prefix, title) {
    const p = String(prefix || "");
    if (!p || title.startsWith(p.trim())) return title;
    return p + title;
  }

  // Accepts the export format { quickActions: [...] } or a bare array.
  // Returns { actions, errors }. Only valid actions are returned.
  function parseImport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { actions: [], errors: ["The text is not valid JSON."] };
    }
    const list = Array.isArray(data) ? data : data && data.quickActions;
    if (!Array.isArray(list)) return { actions: [], errors: ['Expected a "quickActions" list.'] };
    const actions = [];
    const errors = [];
    list.forEach((raw) => {
      const { action, error } = normalizeAction(raw);
      if (error) errors.push(error);
      else actions.push(action);
    });
    return { actions, errors };
  }

  // Imported actions replace existing actions with the same name (case-insensitive).
  // Other imported actions are added. makeId gives new IDs.
  function mergeActions(existing, imported, makeId) {
    const out = (existing || []).slice();
    for (const a of imported) {
      const i = out.findIndex((e) => e.name.toLowerCase() === a.name.toLowerCase());
      if (i === -1) out.push({ ...a, id: makeId() });
      else out[i] = { ...a, id: out[i].id };
    }
    return out;
  }

  function exportActions(actions) {
    const clean = (actions || []).map(({ id, ...rest }) => rest);
    return JSON.stringify({ quickActions: clean }, null, 2);
  }

  // Encodes a ref for a URL path. Keeps "/" so branch names like "feature/x" work.
  function encodeRef(ref) {
    return String(ref).split("/").map(encodeURIComponent).join("/");
  }

  // Builds the compare URL that opens the "Open a pull request" form.
  // head: { owner, repo, branch }. target: { owner, repo, branch }.
  // extras (optional): { body, labels, assignees }. GitHub fills these form fields from the URL.
  function buildCompareUrl(head, target, title, extras) {
    const sameRepo = head.owner.toLowerCase() === target.owner.toLowerCase() &&
      head.repo.toLowerCase() === target.repo.toLowerCase();
    let headSpec;
    if (sameRepo) headSpec = encodeRef(head.branch);
    else if (head.repo.toLowerCase() === target.repo.toLowerCase()) headSpec = `${head.owner}:${encodeRef(head.branch)}`;
    else headSpec = `${head.owner}:${head.repo}:${encodeRef(head.branch)}`;

    const params = new URLSearchParams({ expand: "1" });
    if (title) params.set("title", title);
    const x = extras || {};
    if (x.body) params.set("body", x.body);
    if (x.labels) params.set("labels", x.labels);
    if (x.assignees) params.set("assignees", x.assignees);
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
    resolveTarget, rememberKey, pickTarget, encodeRef, buildCompareUrl, isSameRef,
    normalizeAction, matchesRepo, actionsForRepo, actionTarget, applyTitlePrefix,
    parseImport, mergeActions, exportActions
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QuickPrLib = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
