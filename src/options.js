"use strict";

const DEFAULTS = { defaultBranch: "", overrides: "", openInNewTab: false };
const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(DEFAULTS, (s) => {
  $("defaultBranch").value = s.defaultBranch;
  $("overrides").value = s.overrides;
  $("openInNewTab").checked = !!s.openInNewTab;
});

function renderRemembered() {
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all || {}).filter((k) => k.startsWith("last:")).sort();
    const list = $("remembered");
    list.replaceChildren();
    for (const key of keys) {
      const t = all[key];
      const li = document.createElement("li");
      const text = document.createElement("code");
      text.textContent = `${key.slice(5)} → ${t.owner}/${t.repo}:${t.branch}`;
      const forget = document.createElement("button");
      forget.type = "button";
      forget.textContent = "Forget";
      forget.addEventListener("click", () => chrome.storage.local.remove(key, renderRemembered));
      li.append(text, " ", forget);
      list.appendChild(li);
    }
    if (!keys.length) list.textContent = "None yet.";
    $("forgetAll").hidden = !keys.length;
    $("forgetAll").onclick = () => chrome.storage.local.remove(keys, renderRemembered);
  });
}

renderRemembered();

$("save").addEventListener("click", () => {
  const overrides = $("overrides").value;
  const { errors } = globalThis.QuickPrLib.parseOverrides(overrides);
  const status = $("status");
  if (errors.length) {
    status.textContent = `Not saved. Incorrect override lines: ${errors.join("; ")}`;
    status.className = "error";
    return;
  }
  chrome.storage.sync.set({
    defaultBranch: $("defaultBranch").value.trim(),
    overrides,
    openInNewTab: $("openInNewTab").checked
  }, () => {
    status.textContent = "Saved.";
    status.className = "";
  });
});
