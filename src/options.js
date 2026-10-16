"use strict";

const DEFAULTS = { defaultBranch: "", overrides: "", openInNewTab: false };
const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(DEFAULTS, (s) => {
  $("defaultBranch").value = s.defaultBranch;
  $("overrides").value = s.overrides;
  $("openInNewTab").checked = !!s.openInNewTab;
});

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
