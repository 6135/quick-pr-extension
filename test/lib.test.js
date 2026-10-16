"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/lib.js");

test("parseCodePage", () => {
  assert.deepEqual(L.parseCodePage("/me/repo"), { owner: "me", repo: "repo", ref: null });
  assert.deepEqual(L.parseCodePage("/me/repo/"), { owner: "me", repo: "repo", ref: null });
  assert.deepEqual(L.parseCodePage("/me/repo/tree/dev/src"), { owner: "me", repo: "repo", ref: "dev" });
  assert.deepEqual(L.parseCodePage("/me/repo/tree/a%2Bb"), { owner: "me", repo: "repo", ref: "a+b" });
  assert.equal(L.parseCodePage("/me/repo/pulls"), null);
  assert.equal(L.parseCodePage("/me/repo/tree"), null);
  assert.equal(L.parseCodePage("/settings/profile"), null);
  assert.equal(L.parseCodePage("/me"), null);
});

test("findRefInfo finds a nested refInfo", () => {
  const payload = { props: { initialPayload: { repo: {}, refInfo: { name: "feature/x", refType: "branch" } } } };
  assert.deepEqual(L.findRefInfo(payload), { name: "feature/x", refType: "branch" });
  assert.equal(L.findRefInfo({ a: { b: 1 } }), null);
  assert.equal(L.findRefInfo(null), null);
});

test("parseTarget", () => {
  assert.deepEqual(L.parseTarget("up/proj:develop"), { owner: "up", repo: "proj", branch: "develop" });
  assert.deepEqual(L.parseTarget(" up/proj.js "), { owner: "up", repo: "proj.js", branch: null });
  assert.deepEqual(L.parseTarget("up/proj:feature/x"), { owner: "up", repo: "proj", branch: "feature/x" });
  assert.deepEqual(L.parseTarget(":dev"), { owner: null, repo: null, branch: "dev" });
  assert.equal(L.parseTarget(""), null);
  assert.equal(L.parseTarget("nope"), null);
  assert.equal(L.parseTarget("a/b/c:dev"), null);
});

test("parseOverrides", () => {
  const { map, errors } = L.parseOverrides("# c\n\nMe/Fork = up/proj:dev\nme/tool = me/tool\nbad line\nx/y:z = a/b");
  assert.deepEqual(map["me/fork"], { owner: "up", repo: "proj", branch: "dev" });
  assert.deepEqual(map["me/tool"], { owner: "me", repo: "tool", branch: null });
  assert.equal(errors.length, 2);
});

const fork = { fork: true, defaultBranch: "main", parent: { owner: "up", repo: "proj", defaultBranch: "master" } };
const plain = { fork: false, defaultBranch: "trunk", parent: null };
const cur = { owner: "me", repo: "proj" };

test("resolveTarget: fork goes to parent default branch", () => {
  assert.deepEqual(L.resolveTarget(cur, fork, {}), { owner: "up", repo: "proj", branch: "master" });
});

test("resolveTarget: non-fork goes to own default branch", () => {
  assert.deepEqual(L.resolveTarget(cur, plain, {}), { owner: "me", repo: "proj", branch: "trunk" });
});

test("resolveTarget: global setting beats repo default", () => {
  assert.deepEqual(L.resolveTarget(cur, fork, { defaultBranch: "develop" }), { owner: "up", repo: "proj", branch: "develop" });
});

test("resolveTarget: override beats everything", () => {
  const settings = { defaultBranch: "develop", overrides: "me/proj = other/thing:rel" };
  assert.deepEqual(L.resolveTarget(cur, fork, settings), { owner: "other", repo: "thing", branch: "rel" });
});

test("resolveTarget: override to another repo without branch does not reuse the parent default", () => {
  const settings = { overrides: "me/proj = other/thing" };
  assert.deepEqual(L.resolveTarget(cur, fork, settings), { owner: "other", repo: "thing", branch: "main" });
});

test("resolveTarget: no repo info falls back to same repo and main", () => {
  assert.deepEqual(L.resolveTarget(cur, null, {}), { owner: "me", repo: "proj", branch: "main" });
});

test("buildCompareUrl: same repo", () => {
  assert.equal(
    L.buildCompareUrl({ owner: "me", repo: "proj", branch: "feature/x" }, { owner: "me", repo: "proj", branch: "main" }, "Add x"),
    "https://github.com/me/proj/compare/main...feature/x?expand=1&title=Add+x");
});

test("buildCompareUrl: fork with the same repo name", () => {
  assert.equal(
    L.buildCompareUrl({ owner: "me", repo: "proj", branch: "fix#1" }, { owner: "up", repo: "proj", branch: "main" }, "T & U"),
    "https://github.com/up/proj/compare/main...me:fix%231?expand=1&title=T+%26+U");
});

test("buildCompareUrl: fork with a different repo name", () => {
  assert.equal(
    L.buildCompareUrl({ owner: "me", repo: "my-proj", branch: "dev" }, { owner: "up", repo: "proj", branch: "main" }, ""),
    "https://github.com/up/proj/compare/main...me:my-proj:dev?expand=1");
});

test("isSameRef", () => {
  assert.equal(L.isSameRef({ owner: "Me", repo: "p", branch: "main" }, { owner: "me", repo: "P", branch: "main" }), true);
  assert.equal(L.isSameRef({ owner: "me", repo: "p", branch: "dev" }, { owner: "me", repo: "p", branch: "main" }), false);
});
