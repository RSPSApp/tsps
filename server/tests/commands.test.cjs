// Run after `yarn build`: node --test tests/commands.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PlayerRights } = require("../dist/game/model/rights/PlayerRights");
const Commands = require("../plugins/interface/Commands.plugin");

beforeEach(() => {
  PluginManager.commandHandlersByBase = new Map();
  PluginManager.commandRights = new Map();
  PluginManager.commandRightsOverrides = new Map();
  PluginManager.commandPermissionsCache = new Map();
});

function player(rights = PlayerRights.NONE) {
  const texts = new Map();
  const sender = {
    sendSubInterface() { return this; },
    sendString(text, uid) { texts.set(uid, text); return this; },
  };
  return { texts, getRights: () => rights, sendMessage() {},
    setInterfaceId() {}, getPacketSender: () => sender };
}

test("the live catalog includes aliases and legacy registrations, filtered by execution permissions", () => {
  const api = PluginManager.createApi("CommandsTest");
  let executed = false;
  api.registerCommand(" tele ", () => { executed = true; }, PlayerRights.OWNER, " Teleport to coordinates ");
  api.registerCommand("legacy", () => {});
  api.registerCommand("online", () => {}, undefined, "List online players");
  api.registerCommand("players", () => {}, undefined, "List online players");

  assert.deepEqual(api.getRegisteredCommands(player()), [
    { command: "legacy", description: "" },
    { command: "online", description: "List online players" },
    { command: "players", description: "List online players" },
  ]);
  assert.equal(api.getRegisteredCommands(player(PlayerRights.OWNER)).at(-1).description, "Teleport to coordinates");
  api.setCommandRights("tele", PlayerRights.NONE);
  assert.ok(api.getRegisteredCommands(player()).some(({ command }) => command === "tele"));
  PluginManager.commandPermissionsCache.set("tele", PlayerRights.DEVELOPER.getId());
  assert.ok(!api.getRegisteredCommands(player(PlayerRights.OWNER)).some(({ command }) => command === "tele"));
  PluginManager.emitCommand({ player: player(), base: "tele", raw: "tele", parts: ["tele"], handled: false });
  assert.equal(executed, false, "the catalog and dispatch enforce the same override");
});

test("commands sends its live permitted rows and optional prefill over the game socket", () => {
  const api = PluginManager.createApi("CommandsTest");
  Commands.register(api);
  for (let index = 0; index < 180; index++) {
    api.registerCommand(`extra${index}`, () => {}, undefined, "Plugin command");
  }
  api.registerCommand("secret", () => {}, PlayerRights.DEVELOPER, "Restricted command");
  const p = player();
  const run = (parts) => PluginManager.emitCommand({ player: p, raw: parts.join(" "), base: "commands", parts, handled: false });
  run(["commands", "plugin", "command"]);
  const { COMPONENT, uid } = Commands._test;
  const rows = JSON.parse(p.texts.get(uid(COMPONENT.DATA)));
  assert.equal(rows.length, 181, "the list is not truncated to the former 128 rows");
  assert.ok(rows.some(({ name }) => name.startsWith("::extra179 - ")));
  assert.ok(!rows.some(({ name }) => name.includes("secret")));
  assert.equal(p.texts.get(uid(COMPONENT.SEARCH_INPUT)), "plugin command");

  api.registerCommand("later", () => {}, undefined, "Registered after the interface");
  run(["commands"]);
  assert.equal(p.texts.get(uid(COMPONENT.SEARCH_INPUT)), "");
  assert.ok(JSON.parse(p.texts.get(uid(COMPONENT.DATA))).some(({ name }) => name.startsWith("::later - ")));
});
