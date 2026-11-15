// The "commands:custom" world switch (#5682). Default off: nothing changes. On: the player-level custom ::commands are
// refused through the unknown-command path; staff-level commands, ::bank and a commands:permissions rank are not changed.
// Real PluginManager.emitCommand and the real CommandPacketListener; the ::bank registration is the real AdminCommands one.
//
// Run after `yarn build`: node --test tests/command-custom-switch.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PlayerRights } = require("../dist/game/model/rights/PlayerRights");
const { CommandPacketListener } = require("../dist/net/packet/impl/CommandPacketListener");
const adminCommands = require("../plugins/commands/AdminCommands.plugin");

const UNKNOWN = "This command does not exist. Try ::players.";
const DENIED = "You do not have permission to use this command.";
const probe = PluginManager.createApi("CommandCustomSwitchProbe");
const ran = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const handler = (name) => ({ player }) => { ran.push(`${name}:${player.getUsername()}`); return true; };
  probe.registerCommand("probeplayer", handler("probeplayer"), PlayerRights.NONE, "player-level probe");
  probe.registerCommand("probenull", handler("probenull"), undefined, "no-rank probe");
  probe.registerCommand("probestaff", handler("probestaff"), PlayerRights.OWNER, "staff probe");
  probe.registerCommand("probeoverride", handler("probeoverride"), PlayerRights.NONE, "override probe");
  // The real ::bank: captured from the AdminCommands plugin file, then registered in the real manager.
  const captured = new Map();
  const capture = new Proxy({ registerCommand(name, handler, rights, description) { captured.set(name, { handler, rights, description }); } },
    { get: (target, key) => target[key] ?? (() => {}) });
  adminCommands.register(capture);
  const bank = captured.get("bank");
  assert.ok(bank, "AdminCommands registers ::bank");
  probe.registerCommand("bank", bank.handler, bank.rights, bank.description);
});

/** A player at `rights` who records what the command layer tells them. */
function player(rights, name = "switch-player") {
  const messages = [];
  return {
    messages,
    getUsername: () => name,
    getRights: () => rights,
    getHitpoints: () => 10,
    sendMessage: (text) => messages.push(text),
  };
}

/** Sets the world's pluginConfig for this test (the same cache the production read uses). */
function worldConfig(config) {
  PluginManager.pluginConfigCache = { ...config };
  PluginManager.commandPermissionsCache = null;
}

/** Runs a "::name" line through the real packet listener, as the client sends it. */
function chat(p, command) {
  CommandPacketListener.execute(p, `::${command}`);
}

test("default (switch absent): a player-level command runs for a player", () => {
  worldConfig({});
  ran.length = 0;
  const p = player(PlayerRights.NONE);
  chat(p, "probeplayer");
  assert.deepEqual(ran, ["probeplayer:switch-player"]);
  assert.deepEqual(p.messages, []);
});

test("switch on: a player-level command is refused through the unknown-command path", () => {
  worldConfig({ "commands:custom": true });
  ran.length = 0;
  const p = player(PlayerRights.NONE);
  chat(p, "probeplayer");
  assert.deepEqual(ran, [], "the handler does not run");
  assert.deepEqual(p.messages, [UNKNOWN], "the existing unknown-command message, not a new one");
});

test("switch on: a command with no rank entry (anyone) is refused too", () => {
  worldConfig({ "commands:custom": true });
  ran.length = 0;
  const p = player(PlayerRights.NONE);
  chat(p, "probenull");
  assert.deepEqual(ran, []);
  assert.deepEqual(p.messages, [UNKNOWN]);
});

test("switch on: a staff-level command is unchanged (a player gets the permission denial, staff run it)", () => {
  worldConfig({ "commands:custom": true });
  ran.length = 0;
  const low = player(PlayerRights.NONE);
  chat(low, "probestaff");
  assert.deepEqual(ran, []);
  assert.deepEqual(low.messages, [DENIED], "not the unknown-command path");
  const staff = player(PlayerRights.OWNER, "owner");
  chat(staff, "probestaff");
  assert.deepEqual(ran, ["probestaff:owner"]);
});

test("switch on: ::bank stays as it is (owner-only; a player gets the permission denial)", () => {
  worldConfig({ "commands:custom": true });
  ran.length = 0;
  const low = player(PlayerRights.NONE);
  chat(low, "bank");
  assert.deepEqual(low.messages, [DENIED]);
  assert.ok(!low.messages.includes(UNKNOWN));
});

test("switch on: a commands:permissions rank that raises a player-level command still applies", () => {
  worldConfig({ "commands:custom": true, "commands:permissions": { probeoverride: "OWNER" } });
  ran.length = 0;
  const low = player(PlayerRights.NONE);
  chat(low, "probeoverride");
  assert.deepEqual(low.messages, [DENIED], "the override makes it staff-level: a permission denial, not unknown");
  const owner = player(PlayerRights.OWNER, "owner");
  chat(owner, "probeoverride");
  assert.deepEqual(ran, ["probeoverride:owner"], "the override is honoured for staff");
});

test("switch on: only the exact boolean true enables it (a string does not)", () => {
  worldConfig({ "commands:custom": "true" });
  ran.length = 0;
  const p = player(PlayerRights.NONE);
  chat(p, "probeplayer");
  assert.deepEqual(ran, ["probeplayer:switch-player"]);
  assert.deepEqual(p.messages, []);
});

test("switch off explicitly: the same as the default", () => {
  worldConfig({ "commands:custom": false });
  ran.length = 0;
  const p = player(PlayerRights.NONE);
  chat(p, "probeplayer");
  assert.deepEqual(ran, ["probeplayer:switch-player"]);
});
