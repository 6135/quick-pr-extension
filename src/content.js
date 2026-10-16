// Adds a "Quick PR" button next to the "Code" button on GitHub repository code pages.
"use strict";

(function () {
  const L = globalThis.QuickPrLib;
  const BUTTON_ID = "qpr-button";
  const DIALOG_ID = "qpr-dialog";
  const DEFAULT_SETTINGS = { defaultBranch: "", overrides: "", openInNewTab: false };

  let scheduled = false;
  // Data for the open dialog: { actions, computed }.
  let current = { actions: [], computed: null };

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      ensureButton();
    }, 150);
  }

  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    const ctx = L.parseCodePage(location.pathname);
    if (!ctx) {
      if (existing) existing.remove();
      return;
    }
    if (existing && existing.isConnected) return;
    const anchor = findCodeButton();
    if (!anchor) return;
    anchor.insertAdjacentElement("beforebegin", createButton());
  }

  // Finds the green "Code" button. Returns the outermost single-child wrapper,
  // so the new button sits in the same flex row.
  function findCodeButton() {
    const candidates = Array.from(document.querySelectorAll("button, summary"))
      .filter((el) => el.textContent.trim() === "Code" && !el.closest(`#${DIALOG_ID}`));
    if (!candidates.length) return null;
    const primary = candidates.find((el) =>
      el.matches('[data-variant="primary"], .btn-primary, .Button--primary')) || candidates[0];
    let node = primary;
    while (node.parentElement && node.parentElement.children.length === 1 &&
      node.parentElement !== document.body) {
      node = node.parentElement;
    }
    return node;
  }

  function createButton() {
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.className = "qpr-btn";
    btn.textContent = "Quick PR";
    btn.title = "Open a pull request from this branch";
    btn.addEventListener("click", onButtonClick);
    return btn;
  }

  async function onButtonClick() {
    const ctx = L.parseCodePage(location.pathname);
    if (!ctx) return;
    const dialog = getDialog();
    setStatus(dialog, "Loading…", false);
    dialog.querySelector("[name=title]").value = "";
    dialog.querySelector("[name=head]").value = "";
    dialog.querySelector("[name=target]").value = "";
    dialog.querySelector("[data-action=default]").hidden = true;
    dialog.querySelector(".qpr-action-row").hidden = true;
    dialog.showModal();
    dialog.querySelector("[name=title]").focus();

    const [settings, repoInfo, remembered, allActions] = await Promise.all([
      loadSettings(), loadRepoInfo(ctx), loadRemembered(ctx), loadActions()
    ]);
    const headBranch = detectHeadBranch(ctx, repoInfo);
    const computed = L.resolveTarget(ctx, repoInfo, settings);
    const actions = L.actionsForRepo(allActions, ctx.owner, ctx.repo);
    current = { actions, computed };
    const lastAction = remembered && actions.find((a) => a.id === remembered.actionId);
    const target = lastAction
      ? { ...L.actionTarget(lastAction, computed), remembered: true }
      : L.pickTarget(remembered, computed);
    fillActionSelect(dialog, actions, lastAction ? lastAction.id : "");

    dialog.dataset.owner = ctx.owner;
    dialog.dataset.repo = ctx.repo;
    dialog.dataset.newTab = settings.openInNewTab ? "1" : "";
    dialog.dataset.defaultTarget = formatTarget(computed);
    dialog.querySelector("[name=head]").value = headBranch || "";
    dialog.querySelector("[name=target]").value = formatTarget(target);
    dialog.querySelector("[data-action=default]").hidden = !target.remembered;

    const notes = [];
    if (lastAction) notes.push(`Quick action from your last PR in this repo: ${lastAction.name}.`);
    else if (target.remembered) notes.push("Target from your last PR in this repo.");
    else if (!repoInfo) notes.push("Could not read repo data. Check the target.");
    if (!headBranch) notes.push("Could not detect the branch. Type it.");
    setStatus(dialog, notes.join(" "), !target.remembered && notes.length > 0);
  }

  function fillActionSelect(dialog, actions, selectedId) {
    const select = dialog.querySelector("[name=action]");
    select.replaceChildren(new Option("None (use the target below)", ""));
    for (const a of actions) select.appendChild(new Option(a.name, a.id));
    select.value = selectedId;
    dialog.querySelector(".qpr-action-row").hidden = actions.length === 0;
  }

  function selectedAction(dialog) {
    const id = dialog.querySelector("[name=action]").value;
    return current.actions.find((a) => a.id === id) || null;
  }

  function loadActions() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ quickActions: [] }, (out) => resolve((out && out.quickActions) || []));
      } catch (_) {
        resolve([]);
      }
    });
  }

  function formatTarget(t) {
    return `${t.owner}/${t.repo}:${t.branch}`;
  }

  // Remembered targets are kept in storage.local: one key for each source repo.
  function loadRemembered(ctx) {
    const key = L.rememberKey(ctx.owner, ctx.repo);
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (out) => resolve((out && out[key]) || null));
      } catch (_) {
        resolve(null);
      }
    });
  }

  function saveRemembered(owner, repo, target, actionId) {
    const key = L.rememberKey(owner, repo);
    const value = { owner: target.owner, repo: target.repo, branch: target.branch, actionId: actionId || null, at: Date.now() };
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      } catch (_) {
        resolve();
      }
    });
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (s) => resolve(s || DEFAULT_SETTINGS));
      } catch (_) {
        resolve(DEFAULT_SETTINGS);
      }
    });
  }

  // Asks the background worker for API data. Falls back to the page DOM
  // (private repos and rate limits make the API call fail without a token).
  async function loadRepoInfo(ctx) {
    try {
      const res = await chrome.runtime.sendMessage({ type: "repoInfo", owner: ctx.owner, repo: ctx.repo });
      if (res && !res.error) return res;
    } catch (_) {
      // Fall through to the DOM fallback.
    }
    return repoInfoFromDom();
  }

  function repoInfoFromDom() {
    const header = document.querySelector("#repository-container-header") || document.body;
    const holder = Array.from(header.querySelectorAll("span, div, p"))
      .find((el) => /^\s*forked from\b/i.test(el.textContent) && el.querySelector("a[href]"));
    if (!holder) return null;
    const href = holder.querySelector("a[href]").getAttribute("href") || "";
    const parts = href.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { fork: true, defaultBranch: null, parent: { owner: parts[0], repo: parts[1], defaultBranch: null } };
  }

  // Branch detection, most reliable first:
  //   1. GitHub's embedded React JSON (refInfo).
  //   2. The branch picker text.
  //   3. The URL (wrong for names with "/", so the user can edit the field).
  //   4. The repo default branch on the root page.
  function detectHeadBranch(ctx, repoInfo) {
    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const s of scripts) {
      if (!s.textContent.includes("refInfo")) continue;
      try {
        const info = L.findRefInfo(JSON.parse(s.textContent));
        if (info) return info.name;
      } catch (_) {
        // Not valid JSON. Try the next one.
      }
    }
    const picker = document.querySelector(
      "#branch-picker-repos-header-ref-selector, #ref-picker-repos-header-ref-selector, [data-hotkey='w'] .css-truncate-target");
    const pickerText = picker && picker.textContent.trim();
    if (pickerText) return pickerText;
    if (ctx.ref) return ctx.ref;
    return repoInfo ? repoInfo.defaultBranch : null;
  }

  function getDialog() {
    let dialog = document.getElementById(DIALOG_ID);
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = DIALOG_ID;
    dialog.className = "qpr-dialog";
    dialog.innerHTML = `
      <form method="dialog" class="qpr-form">
        <h2 class="qpr-heading">Open a pull request</h2>
        <label class="qpr-action-row">Quick action <select name="action"></select></label>
        <label>Title <input name="title" type="text" required autocomplete="off"></label>
        <label>From branch <input name="head" type="text" required autocomplete="off"></label>
        <label>Into (owner/repo:branch) <input name="target" type="text" required autocomplete="off"></label>
        <p class="qpr-status" role="status"></p>
        <div class="qpr-actions">
          <button type="button" class="qpr-btn qpr-btn-left" data-action="default" hidden>Use default target</button>
          <button type="button" class="qpr-btn" data-action="cancel">Cancel</button>
          <button type="submit" class="qpr-btn qpr-btn-primary">OK</button>
        </div>
      </form>`;
    dialog.querySelector("[data-action=cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-action=default]").addEventListener("click", (e) => {
      dialog.querySelector("[name=target]").value = dialog.dataset.defaultTarget || "";
      dialog.querySelector("[name=action]").value = "";
      e.currentTarget.hidden = true;
      setStatus(dialog, "Default target. Click OK to remember it.", false);
    });
    dialog.querySelector("[name=action]").addEventListener("change", () => {
      const action = selectedAction(dialog);
      if (!action) return setStatus(dialog, "", false);
      const t = L.actionTarget(action, current.computed);
      dialog.querySelector("[name=target]").value = formatTarget(t);
      setStatus(dialog, describeAction(action), false);
    });
    // Editing the target by hand turns the quick action off.
    dialog.querySelector("[name=target]").addEventListener("input", () => {
      const select = dialog.querySelector("[name=action]");
      if (select.value) setStatus(dialog, "Custom target. The quick action is off.", false);
      select.value = "";
    });
    dialog.querySelector("form").addEventListener("submit", (e) => onSubmit(e, dialog));
    document.body.appendChild(dialog);
    return dialog;
  }

  async function onSubmit(event, dialog) {
    event.preventDefault();
    const title = dialog.querySelector("[name=title]").value.trim();
    const headBranch = dialog.querySelector("[name=head]").value.trim();
    const target = L.parseTarget(dialog.querySelector("[name=target]").value);
    if (!title || !headBranch) return setStatus(dialog, "Title and branch are required.", true);
    if (!target || !target.owner || !target.branch) {
      return setStatus(dialog, "Use the format owner/repo:branch for the target.", true);
    }
    const head = { owner: dialog.dataset.owner, repo: dialog.dataset.repo, branch: headBranch };
    if (L.isSameRef(head, target)) return setStatus(dialog, "The source and the target are the same branch.", true);

    const action = selectedAction(dialog);
    const url = action
      ? L.buildCompareUrl(head, target, L.applyTitlePrefix(action.titlePrefix, title), action)
      : L.buildCompareUrl(head, target, title);
    const actionId = action ? action.id : null;
    dialog.close();
    if (dialog.dataset.newTab) {
      // Open first: the popup blocker can stop window.open after an await.
      window.open(url, "_blank", "noopener");
      saveRemembered(head.owner, head.repo, target, actionId);
    } else {
      // Save first: the page unload can stop a pending write.
      await saveRemembered(head.owner, head.repo, target, actionId);
      location.assign(url);
    }
  }

  function describeAction(a) {
    const parts = [];
    if (a.titlePrefix) parts.push(`title prefix "${a.titlePrefix.trim()}"`);
    if (a.body) parts.push("body");
    if (a.labels) parts.push(`labels ${a.labels}`);
    if (a.assignees) parts.push(`assignees ${a.assignees}`);
    return parts.length ? `Adds: ${parts.join(", ")}.` : "";
  }

  function setStatus(dialog, text, isError) {
    const el = dialog.querySelector(".qpr-status");
    el.textContent = text;
    el.classList.toggle("qpr-error", !!isError);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("turbo:load", schedule);
  window.addEventListener("popstate", schedule);
  ensureButton();
})();
