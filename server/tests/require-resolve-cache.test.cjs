// The production path resolver reuses a relative require's resolution while its module stays
// loaded (Server.installProductionPathResolver). Run after `yarn build`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");

// Count what reaches Node's own resolver: installed first, it is the one the patch wraps.
const nodeResolve = Module._resolveFilename;
const watched = new Set();
let nodeResolves = 0;
Module._resolveFilename = function (request, parent, ...rest) {
  if (watched.has(parent?.filename)) nodeResolves++;
  return nodeResolve.call(this, request, parent, ...rest);
};
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-cache-"));
  fs.writeFileSync(path.join(dir, "target.js"), "module.exports = { loadedAt: Math.random() };");
  // Node keeps its own fast path only for the first loader's directory and request. The first
  // loader sits elsewhere, as when Server.ts loads a module that a getter in another directory
  // requires lazily, so without the patch every `caller()` resolves in full.
  fs.mkdirSync(path.join(dir, "first"));
  fs.writeFileSync(path.join(dir, "first", "loader.js"), "module.exports = require('../target');");
  fs.writeFileSync(path.join(dir, "caller.js"), "module.exports = () => require('./target');");
  const target = require(path.join(dir, "first", "loader.js"));
  const callerFile = path.join(dir, "caller.js");
  const caller = require(callerFile);
  watched.add(callerFile);
  return { dir, target, caller, file: path.join(dir, "target.js") };
}

test("a call-time relative require resolves once while its module stays loaded", (t) => {
  const { dir, target, caller } = fixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  nodeResolves = 0;
  for (let i = 0; i < 1000; i++) assert.equal(caller(), target);
  assert.equal(nodeResolves, 1, "only the first call reaches Node's resolver");
});

test("a module dropped from require.cache resolves again and reloads", (t) => {
  const { dir, target, caller, file } = fixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(caller(), target);
  nodeResolves = 0;
  delete require.cache[file];
  const reloaded = caller();
  assert.notEqual(reloaded, target, "a reload is a fresh module, as tests that swap modules expect");
  assert.equal(nodeResolves, 1);
  assert.equal(caller(), reloaded);
  assert.equal(nodeResolves, 1);
});
