"use strict";

// Used as the options page and as the toolbar popup (?popup=1).
const L = globalThis.QuickPrLib;
const DEFAULTS = { defaultBranch: "", overrides: "", openInNewTab: false };
const $ = (id) => document.getElementById(id);
let actions = [];
let editingId = null;

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function setStatus(id, text, isError) {
  $(id).textContent = text;
  $(id).className = isError ? "status error" : "status";
}

// ---- Popup ----

if (new URLSearchParams(location.search).get("popup") === "1") {
  $("tabLink").hidden = false;
  $("openTab").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

// ---- Quick actions ----

function saveActions(list, done) {
  chrome.storage.local.set({ quickActions: list }, () => {
    actions = list;
    renderActions();
    if (done) done();
  });
}

function renderActions() {
  const list = $("actions");
  list.replaceChildren();
  if (!actions.length) list.textContent = "None yet.";
  actions.forEach((a, i) => {
    const li = document.createElement("li");
    const text = document.createElement("div");
    text.className = "grow";
    const name = document.createElement("strong");
    name.textContent = a.name;
    const detail = document.createElement("small");
    detail.textContent = `→ ${a.target}` + (a.repos ? `  ·  repos: ${a.repos}` : "  ·  all repos");
    text.append(name, detail);
    li.appendChild(text);
    li.append(
      button("↑", "Move up", i === 0, () => move(i, -1)),
      button("↓", "Move down", i === actions.length - 1, () => move(i, 1)),
      button("Edit", "Edit", false, () => openEditor(a)),
      // Two clicks to delete: confirm() does not work in Firefox popups.
      button("Delete", "Delete", false, (e) => {
        if (e.currentTarget.dataset.armed) return saveActions(actions.filter((x) => x.id !== a.id));
        e.currentTarget.dataset.armed = "1";
        e.currentTarget.textContent = "Click again";
      })
    );
    list.appendChild(li);
  });
}

function button(label, title, disabled, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.title = title;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function move(i, delta) {
  const list = actions.slice();
  const [item] = list.splice(i, 1);
  list.splice(i + delta, 0, item);
  saveActions(list);
}

const FIELDS = { aName: "name", aTarget: "target", aRepos: "repos", aPrefix: "titlePrefix", aBody: "body", aLabels: "labels", aAssignees: "assignees" };

function openEditor(action) {
  editingId = action ? action.id : null;
  $("editorTitle").textContent = action ? `Edit "${action.name}"` : "New quick action";
  for (const [el, key] of Object.entries(FIELDS)) $(el).value = action ? action[key] || "" : "";
  $("editor").hidden = false;
  setStatus("actionStatus", "", false);
  $("aName").focus();
}

$("newAction").addEventListener("click", () => openEditor(null));
$("cancelAction").addEventListener("click", () => {
  $("editor").hidden = true;
  setStatus("actionStatus", "", false);
});

$("saveAction").addEventListener("click", () => {
  const raw = { id: editingId };
  for (const [el, key] of Object.entries(FIELDS)) raw[key] = $(el).value;
  const { action, error } = L.normalizeAction(raw);
  if (error) return setStatus("actionStatus", error, true);
  const clash = actions.find((a) => a.name.toLowerCase() === action.name.toLowerCase() && a.id !== editingId);
  if (clash) return setStatus("actionStatus", `A quick action named "${action.name}" already exists.`, true);
  const list = editingId
    ? actions.map((a) => (a.id === editingId ? action : a))
    : actions.concat({ ...action, id: newId() });
  saveActions(list, () => {
    $("editor").hidden = true;
    setStatus("actionStatus", "Saved.", false);
  });
});

// ---- Share ----

$("exportBtn").addEventListener("click", () => {
  $("shareText").value = L.exportActions(actions);
  $("shareText").select();
  setStatus("shareStatus", `${actions.length} quick action(s) exported.`, false);
});

$("copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("shareText").value);
    setStatus("shareStatus", "Copied.", false);
  } catch (_) {
    $("shareText").select();
    setStatus("shareStatus", "Could not copy. Press Ctrl+C.", true);
  }
});

$("importBtn").addEventListener("click", () => {
  const { actions: imported, errors } = L.parseImport($("shareText").value);
  if (!imported.length) return setStatus("shareStatus", errors.join(" ") || "Nothing to import.", true);
  saveActions(L.mergeActions(actions, imported, newId), () => {
    const skipped = errors.length ? ` Skipped ${errors.length}: ${errors.join(" ")}` : "";
    setStatus("shareStatus", `Imported ${imported.length} quick action(s).${skipped}`, errors.length > 0);
  });
});

// ---- Defaults ----

chrome.storage.sync.get(DEFAULTS, (s) => {
  $("defaultBranch").value = s.defaultBranch;
  $("overrides").value = s.overrides;
  $("openInNewTab").checked = !!s.openInNewTab;
});

$("save").addEventListener("click", () => {
  const overrides = $("overrides").value;
  const { errors } = L.parseOverrides(overrides);
  if (errors.length) return setStatus("status", `Not saved. Incorrect override lines: ${errors.join("; ")}`, true);
  chrome.storage.sync.set({
    defaultBranch: $("defaultBranch").value.trim(),
    overrides,
    openInNewTab: $("openInNewTab").checked
  }, () => setStatus("status", "Saved.", false));
});

// ---- Remembered targets ----

function renderRemembered() {
  chrome.storage.local.get(null, (all) => {
    const store = all || {};
    const keys = Object.keys(store).filter((k) => k.startsWith("last:")).sort();
    const list = $("remembered");
    list.replaceChildren();
    for (const key of keys) {
      const t = store[key];
      const action = t.actionId && actions.find((a) => a.id === t.actionId);
      const li = document.createElement("li");
      const text = document.createElement("code");
      text.className = "grow";
      text.textContent = `${key.slice(5)} → ${t.owner}/${t.repo}:${t.branch}` + (action ? ` (${action.name})` : "");
      li.append(text, button("Forget", "Forget", false, () => chrome.storage.local.remove(key, renderRemembered)));
      list.appendChild(li);
    }
    if (!keys.length) list.textContent = "None yet.";
    $("forgetAll").hidden = !keys.length;
    $("forgetAll").onclick = () => chrome.storage.local.remove(keys, renderRemembered);
  });
}

chrome.storage.local.get({ quickActions: [] }, (out) => {
  actions = (out && out.quickActions) || [];
  renderActions();
  renderRemembered();
});
