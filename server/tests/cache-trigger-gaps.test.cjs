// Rev 241 cache triggers the server used to drop or misroute: Accept Aid (116:29), the Wilderness
// teleports' op10 warning toggle (218), and Close buttons with no client-side close. Real Player,
// Inventory and ClientConnection; clicks go through the native widget_action packet.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let playerIndex = 1900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
});

function createPlayer(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(playerIndex++);
  player.setUsername(`trigger-gaps-${playerIndex}`);
  player.setRegistered(true);
  player.needsPlacement = false;
  const messages = [];
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (text) => { messages.push(String(text)); return sendMessage(text); };
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
  });
  return { player, connection, messages };
}

async function click(connection, uid, buttonNum = 1, extra = {}) {
  await connection.dispatch([{
    type: "widget_action", widgetId: uid, groupId: uid >>> 16, childId: uid & 0xffff, slot: -1, buttonNum, ...extra,
  }]);
  connection.processTurnPackets();
}

const varbit = (player, name) => player.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(name));
const component = (name) => core.CacheDefinitions.getComponentId(name);

test("Accept Aid (116:29) toggles the accept-aid attribute the Lunar spells read, and its varbit", async (t) => {
  const { player, connection } = createPlayer(t);
  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  assert.equal(player.getAttribute("accept-aid"), true, "on, as before, for a normal account");
  assert.equal(varbit(player, "option_acceptaid"), 1);
  await click(connection, component("settings_side:acceptaid"));
  assert.equal(player.getAttribute("accept-aid"), false);
  assert.equal(varbit(player, "option_acceptaid"), 0);
  await click(connection, component("settings_side:acceptaid"));
  assert.equal(player.getAttribute("accept-aid"), true);
  assert.equal(varbit(player, "option_acceptaid"), 1);
});

test("an Ironman can never turn Accept Aid on (Wiki: Accept Aid)", async (t) => {
  const { player, connection, messages } = createPlayer(t);
  const request = { player, mode: "ironman", handled: false };
  PluginManager.emitCustomEvent("ironman:set-mode", request);
  assert.equal(request.handled, true);
  assert.equal(player.getAttribute("accept-aid"), false, "becoming an Ironman turns it off");
  await click(connection, component("settings_side:acceptaid"));
  assert.equal(player.getAttribute("accept-aid"), false);
  assert.equal(varbit(player, "option_acceptaid"), 0, "the client's own flip is undone");
  assert.equal(messages.at(-1), "Ironmen do not accept aid.");
  player.setAttribute("accept-aid", true); // an old save
  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  assert.equal(player.getAttribute("accept-aid"), false, "login turns it off again");
});

test("op10 on a Wilderness teleport toggles its warning and never casts", async (t) => {
  const cases = [
    ["Dareeyak Teleport", "dareeyak_teleport_warning"],
    ["Carrallanger Teleport", "carrallagar_teleport_warning"],
    ["Annakarl Teleport", "annakarl_teleport_warning"],
    ["Ghorrock Teleport", "ghorrock_teleport_warning"],
    ["Teleport to Target", "bounty_teleport_warning"],
  ];
  for (const [name, warning] of cases) {
    const { player, connection } = createPlayer(t);
    player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
    for (const id of [554, 555, 556, 560, 562, 563, 565, 566]) player.getInventory().add(new core.Item(id, 100), false);
    const spell = core.CacheDefinitions.getSpellByName(name);
    assert.ok(spell, name);
    const start = player.getLocation().clone();
    const runes = player.getInventory().getAmount(563);
    await click(connection, spell.widgetId, 10, { itemId: spell.itemId });
    assert.equal(varbit(player, warning), 1, `${name}: warning on`);
    assert.equal(player.getInventory().getAmount(563), runes, `${name}: no law rune spent`);
    assert.equal(player.isTeleportingReturn?.() ?? false, false, `${name}: no teleport`);
    assert.ok(player.getLocation().equals(start));
    await click(connection, spell.widgetId, 10, { itemId: spell.itemId });
    assert.equal(varbit(player, warning), 0, `${name}: warning off`);
    PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
    assert.equal(varbit(player, warning), 0);
  }
});

test("a toggled warning survives a relog", async (t) => {
  const { player, connection } = createPlayer(t);
  const spell = core.CacheDefinitions.getSpellByName("Ghorrock Teleport");
  await click(connection, spell.widgetId, 10, { itemId: spell.itemId });
  player.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId("ghorrock_teleport_warning"), 0);
  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  assert.equal(varbit(player, "ghorrock_teleport_warning"), 1);
});

test("Close buttons with no client-side close now close their interface", async (t) => {
  for (const name of require("../plugins/interface/CloseButtons.plugin").CLOSE_BUTTONS) {
    const { player, connection } = createPlayer(t);
    const group = component(name) >>> 16;
    player.getPacketSender().sendInterface(group);
    assert.equal(player.getInterfaceId(), group);
    await click(connection, component(name));
    assert.notEqual(player.getInterfaceId(), group, name);
  }
});
