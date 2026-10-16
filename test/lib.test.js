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

test("rememberKey is lowercase and per repo", () => {
  assert.equal(L.rememberKey("Me", "Proj"), "last:me/proj");
});

test("pickTarget: remembered target wins", () => {
  const computed = { owner: "up", repo: "proj", branch: "main" };
  assert.deepEqual(L.pickTarget({ owner: "up", repo: "proj", branch: "develop", at: 1 }, computed),
    { owner: "up", repo: "proj", branch: "develop", remembered: true });
});

test("pickTarget: missing or incomplete remembered target uses the computed one", () => {
  const computed = { owner: "up", repo: "proj", branch: "main" };
  assert.deepEqual(L.pickTarget(null, computed), { ...computed, remembered: false });
  assert.deepEqual(L.pickTarget({ owner: "up", repo: "proj" }, computed), { ...computed, remembered: false });
});

test("normalizeAction cleans values and validates", () => {
  const { action, error } = L.normalizeAction({
    id: "a1", name: " Upstream dev ", target: "up/proj:develop", repos: "me/*\nteam/app",
    labels: "bug, ui", assignees: "@octocat, me", titlePrefix: "[FEAT] "
  });
  assert.equal(error, null);
  assert.deepEqual(action, {
    id: "a1", name: "Upstream dev", target: "up/proj:develop", repos: "me/*, team/app",
    titlePrefix: "[FEAT] ", body: "", labels: "bug,ui", assignees: "octocat,me"
  });
  assert.match(L.normalizeAction({ name: "", target: ":dev" }).error, /name/);
  assert.match(L.normalizeAction({ name: "x", target: "up/proj" }).error, /target/);
  assert.match(L.normalizeAction({ name: "x", target: ":dev", repos: "bad pattern" }).error, /pattern/);
  assert.equal(L.normalizeAction({ name: "x", target: ":dev", repos: "*" }).error, null);
});

test("matchesRepo and actionsForRepo", () => {
  assert.equal(L.matchesRepo("", "me", "p"), true);
  assert.equal(L.matchesRepo("*", "me", "p"), true);
  assert.equal(L.matchesRepo("Me/*", "me", "p"), true);
  assert.equal(L.matchesRepo("me/P", "me", "p"), true);
  assert.equal(L.matchesRepo("me/q, team/*", "me", "p"), false);
  const actions = [{ id: 1, repos: "" }, { id: 2, repos: "other/*" }, { id: 3, repos: "me/p" }];
  assert.deepEqual(L.actionsForRepo(actions, "me", "p").map((a) => a.id), [1, 3]);
});

test("actionTarget: ':branch' uses the computed repo, full target is used as is", () => {
  const computed = { owner: "up", repo: "proj", branch: "main" };
  assert.deepEqual(L.actionTarget({ target: ":develop" }, computed), { owner: "up", repo: "proj", branch: "develop" });
  assert.deepEqual(L.actionTarget({ target: "friend/proj:feature/x" }, computed), { owner: "friend", repo: "proj", branch: "feature/x" });
  assert.equal(L.actionTarget({ target: "friend/proj" }, computed), null);
});

test("applyTitlePrefix does not add the prefix twice", () => {
  assert.equal(L.applyTitlePrefix("[FEAT] ", "Add x"), "[FEAT] Add x");
  assert.equal(L.applyTitlePrefix("[FEAT] ", "[FEAT] Add x"), "[FEAT] Add x");
  assert.equal(L.applyTitlePrefix("", "Add x"), "Add x");
});

test("export, import and merge", () => {
  const existing = [{ id: "x", name: "Upstream", target: ":main", repos: "", titlePrefix: "", body: "", labels: "", assignees: "" }];
  const text = L.exportActions([
    { id: "y", name: "upstream", target: ":develop" },
    { id: "z", name: "Friend fork", target: "friend/proj:main" }
  ]);
  assert.equal(text.includes('"id"'), false);
  const { actions, errors } = L.parseImport(text);
  assert.deepEqual(errors, []);
  let n = 0;
  const merged = L.mergeActions(existing, actions, () => `new${++n}`);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "x");
  assert.equal(merged[0].target, ":develop");
  assert.equal(merged[1].id, "new1");
  assert.match(L.parseImport("nope").errors[0], /JSON/);
  assert.equal(L.parseImport('[{"name":"a","target":":b"},{"name":""}]').actions.length, 1);
});

test("buildCompareUrl adds body, labels and assignees", () => {
  const url = L.buildCompareUrl({ owner: "me", repo: "proj", branch: "dev" }, { owner: "up", repo: "proj", branch: "main" },
    "T", { body: "Line 1\nLine 2", labels: "bug,ui", assignees: "octocat" });
  const q = new URL(url).searchParams;
  assert.equal(q.get("title"), "T");
  assert.equal(q.get("body"), "Line 1\nLine 2");
  assert.equal(q.get("labels"), "bug,ui");
  assert.equal(q.get("assignees"), "octocat");
});
