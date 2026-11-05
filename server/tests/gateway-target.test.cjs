// Run after `yarn build`: node --test tests/gateway-target.test.cjs
const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { GatewayTarget } = require("../dist/net/http/GatewayTarget");

const PORT = 43746;
const previous = process.env.PUBLIC_HOST;
afterEach(() => {
  if (previous === undefined) delete process.env.PUBLIC_HOST;
  else process.env.PUBLIC_HOST = previous;
});

const javConfig = () => GatewayTarget.resolve(GatewayTarget.JAV_CONFIG_PATH, PORT).body.toString("latin1");
const worldList = () => GatewayTarget.resolve(GatewayTarget.WORLD_LIST_PATH, PORT).body.toString("latin1");

test("without PUBLIC_HOST the client is pointed at 127.0.0.1", () => {
  delete process.env.PUBLIC_HOST;
  assert.match(javConfig(), /^codebase=http:\/\/127\.0\.0\.1\/$/m);
  assert.match(javConfig(), new RegExp(`^param=17=http://127\\.0\\.0\\.1:${PORT}/gateway/worldlist\\.ws$`, "m"));
  assert.ok(worldList().includes("127.0.0.1\0"));
});

test("PUBLIC_HOST goes into the codebase, the world list URL and the world", () => {
  process.env.PUBLIC_HOST = "play.example.com";
  assert.match(javConfig(), /^codebase=http:\/\/play\.example\.com\/$/m);
  assert.match(javConfig(), new RegExp(`^param=17=http://play\\.example\\.com:${PORT}/gateway/worldlist\\.ws$`, "m"));
  assert.ok(worldList().includes("play.example.com\0"));
  // The fixed game port stays selected.
  assert.match(javConfig(), /^param=15=0$/m);
});

test("a PUBLIC_HOST that isn't a bare host falls back to 127.0.0.1", () => {
  process.env.PUBLIC_HOST = "http://play.example.com:43594";
  assert.equal(GatewayTarget.host(), "127.0.0.1");
  assert.match(javConfig(), /^codebase=http:\/\/127\.0\.0\.1\/$/m);
});
