// Shared by tests/between-a-rock*.test.cjs (run after `yarn build`). Real Player, PlayerSession
// and ClientConnection, the real plugins, cache and map: talks and clicks are packets, each tick
// runs as World.process does. Every packet sender call is recorded with its tick.
const assert = require("node:assert/strict");
const path = require("node:path");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const DONDAKAN_TILE = [2824, 10168, 0];
const MAP_TILES = [[2824, 10168], [2871, 10198], [2862, 9876], [3022, 3451], [3018, 9850], [2400, 4960], [2330, 4940], [2057, 4978], [2976, 3368]];

let core;
let next = 8100;

async function boot() {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of MAP_TILES) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
  return core;
}
const shutdown = () => PM.emitServerShutdown({});

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "between_a_rock");

function actor(t, { stage = 0, items = [], at = [2825, 10168, 0], worn = [] } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("rock" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  player.setNeedsPlacement?.(false);
  player.needsPlacement = false;
  const f = { t, player, connection, tick: 0, calls: [], said: [], messages: [], npcs: [], animations: [], xp: [] };
  record(f);
  t.after(() => {
    for (const npc of f.npcs) core.World.getNpcs().remove(npc);
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  if (stage) quest().setStage(player, stage);
  for (const entry of items) {
    const [id, amount] = Array.isArray(entry) ? entry : [entry, 1];
    player.getInventory().add(new core.Item(id, amount), false);
  }
  for (const id of worn) {
    const slot = core.ItemDefinition.forId(id).getEquipmentType?.()?.getSlot?.() ?? core.Equipment.HEAD_SLOT;
    player.getEquipment().setItem(slot, new core.Item(id, 1));
  }
  return f;
}

/** A world NPC at `tile` for this test only (the quest's own spawns are not loaded here). */
function spawn(f, id, tile) {
  const npc = core.NPC.create(id, new core.Location(...tile));
  core.World.getNpcs().add(npc);
  f.npcs.push(npc);
  return npc;
}

const RECORDED = /^(sendVarbit|sendConfig|sendSubInterface|mountSubInterface|closeSubInterface|sendInterface|sendInterfaceRemoval|sendString|sendSound|sendJingle|sendSong|sendObject|sendObjectRemoval|sendCameraMoveTo|sendCameraLookAt|sendCameraReset|sendCameraShake|sendInterfaceDisplayState|sendInterfacePosition|sendInterfaceAnimation|sendItemOnInterface|sendEntityHint|sendChatboxInterface|sendClientScript)$/;
function record(f) {
  const sender = f.player.getPacketSender();
  const proto = Object.getPrototypeOf(sender);
  let depth = 0;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!RECORDED.test(name) || typeof proto[name] !== "function") continue;
    const original = proto[name];
    sender[name] = function (...args) {
      if (depth === 0) f.calls.push({ tick: f.tick, name, args });
      depth++;
      try { return original.apply(this, args); } finally { depth--; }
    };
  }
  const perform = f.player.performAnimation.bind(f.player);
  f.player.performAnimation = (animation, ...rest) => {
    f.animations.push({ tick: f.tick, id: animation?.getId?.() });
    return perform(animation, ...rest);
  };
  const skills = f.player.getSkillManager();
  const addExperiences = skills.addExperiences.bind(skills);
  skills.addExperiences = (skill, amount, ...rest) => {
    f.xp.push({ tick: f.tick, skill: skill?.getName?.() ?? skill?.getIndex?.(), amount });
    return addExperiences(skill, amount, ...rest);
  };
  const send = f.player.sendMessage.bind(f.player);
  f.player.sendMessage = (text, ...rest) => {
    f.messages.push({ tick: f.tick, text });
    return send(text, ...rest);
  };
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  for (const npc of core.World.getNpcs()) {
    if (!npc) continue;
    npc.getMovementQueue().process();
    npc.getCombat?.()?.process?.();
  }
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  f.player.getCombat?.()?.process?.();
  f.player.getCombat?.()?.getHitQueue?.()?.process?.(core.World.processCycle);
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
  const line = shown(f);
  if (line && f.said.at(-1)?.text !== line.text) f.said.push({ tick: f.tick, ...line });
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", text: menu.options.join(" | "), title: menu.title };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  const text = current.getText();
  return { who: current.constructor.name, text: Array.isArray(text) ? text.join(" ") : text, npcId: current.getNpcId?.() };
}

async function talk(f, npc, clickType = 1) {
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType }]);
  for (let i = 0; i < 20 && !shown(f); i++) tick(f);
}

async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0), childIndex: -1 }]);
  tick(f);
}

async function choose(f, text) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.findIndex((option) => option === text || option.startsWith(text));
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

/** Continues until `text` shows (each continue is one tick), then returns its tick. */
async function until(f, text, limit = 120) {
  for (let i = 0; i < limit; i++) {
    const line = shown(f);
    if (line && (line.text === text || line.text.startsWith(text) || (line.who === "menu" && line.text.includes(text)))) return f.tick;
    if (line && line.who !== "menu") await continueLine(f);
    else tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

/** Continues every line until the chatbox is clear (stops at a menu). */
async function finishChat(f, limit = 60) {
  for (let i = 0; i < limit && shown(f); i++) {
    if (shown(f).who === "menu") return;
    await continueLine(f);
  }
}

async function button(f, group, child, extra = {}) {
  await f.connection.dispatch([{ type: "widget_action", widgetId: (group << 16) | child, groupId: group, childId: child, buttonNum: 1, opId: 1, slot: -1, itemId: -1, ...extra }]);
  tick(f);
}

async function itemOption(f, itemId, option) {
  const inventory = f.player.getInventory();
  const slot = inventory.getSlotForItemId(itemId);
  const optionIndex = core.CacheDefinitions.getItem(itemId).inventoryActions.indexOf(option) + 1;
  await f.connection.dispatch([{ type: "inventory_action", widgetId: core.Inventory.INTERFACE_ID, slot, itemId, option, optionIndex }]);
  tick(f);
}

async function useOnNpc(f, itemId, npc) {
  const slot = f.player.getInventory().getSlotForItemId(itemId);
  await f.connection.dispatch([{ type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot, widgetId: core.Inventory.INTERFACE_ID << 16 }]);
  for (let i = 0; i < 10 && !shown(f); i++) tick(f);
}

async function useOnObject(f, itemId, objectId, [x, y]) {
  const slot = f.player.getInventory().getSlotForItemId(itemId);
  await f.connection.dispatch([{ type: "item_on_object", objectId, x, y, itemId, slot, widgetId: core.Inventory.INTERFACE_ID }]);
  for (let i = 0; i < 10 && !shown(f); i++) tick(f);
}

async function objectOption(f, id, [x, y], clickType = 1) {
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType }]);
  tick(f);
}

const callsNamed = (f, name, from = 0) => f.calls.filter((call) => call.name === name && call.tick >= from);
const xy = (location) => [location.getX(), location.getY(), location.getZ()];

module.exports = {
  boot, shutdown, quest, actor, spawn, tick, ticks, shown, talk, continueLine, choose, until, finishChat, button,
  itemOption, useOnNpc, useOnObject, objectOption, callsNamed, xy, DONDAKAN_TILE, get core() { return core; }, PM, MultiChatboxPrompt,
};
