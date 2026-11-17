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

test("the world list carries the world type's flags and activity", () => {
  const { GameConstants } = require("../dist/game/GameConstants");
  const flagsOf = () => GatewayTarget.resolve(GatewayTarget.WORLD_LIST_PATH, PORT).body.readUInt32BE(8);
  const before = GameConstants.WORLD_TYPE;
  try {
    assert.equal(flagsOf(), 0x1, "a members world, no type of its own");
    assert.match(worldList(), /\0tsps\0/);
    GameConstants.setWorldType({ label: "HARDCORE WORLD", flags: 0x800, activity: "Hardcore World" });
    assert.equal(flagsOf(), 0x801, "live Hardcore Worlds: 2049");
    assert.match(worldList(), /\0Hardcore World\0/);
  } finally {
    GameConstants.WORLD_TYPE = before;
  }
});

test("username/password logins stay allowed: param 30 is true", () => {
  // False makes the client show "You now need to play via the Jagex Launcher", with no way to log in.
  assert.match(javConfig(), /^param=30=true$/m);
});
