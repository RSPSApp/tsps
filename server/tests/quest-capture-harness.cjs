// Shared harness for the quest capture tests (fairytale-i-capture.test.cjs, fairytale-ii-capture.test.cjs,
// jungle-potion-capture.test.cjs).
// Real Player, PlayerSession and ClientConnection, the real plugins, cache and map: talks and
// clicks are packets and each tick runs as World.process does.
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

// `key`: the quest the actor's `stage` and h.stage() refer to (Fairytale II's tests set it).
const h = { core: null, PM, MultiChatboxPrompt, QuestRuntime, key: "fairytale_i_growing_pains" };
let next = 9100;

h.setup = async function setup(regions) {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  h.core = PM.getCoreApi();
  h.core.ObjectDefinition.init();
  h.core.RegionManager.init();
  for (const [x, y] of regions) h.core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
};
h.teardown = () => PM.emitServerShutdown({});

h.quest = (key = h.key) => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === key);
h.stage = (f) => h.quest().getStage(f.player);

h.actor = function actor(t, { stage = 0, items = [], at, amulet = false, attributes = {}, done = ["lost_city", "nature_spirit"], farming = 30 } = {}) {
  const { core } = h;
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("fairy" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { t, player, connection, tick: 0, calls: [], said: [], messages: [], npcs: [], animations: [] };
  record(f);
  t.after(() => {
    for (const npc of f.npcs) core.World.getNpcs().remove(npc);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.World.getPlayers().remove(player);
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  for (const key of done) {
    const q = h.quest(key);
    q.setStage(player, q.completionValue);
  }
  player.getSkillManager().setMaxLevels(core.Skill.FARMING, farming);
  player.getSkillManager().setCurrentLevel(core.Skill.FARMING, farming, false);
  // The saved attributes first: the stage change re-sends the varbits derived from them.
  for (const [key, value] of Object.entries(attributes)) player.setAttribute(key, value);
  h.quest().setStage(player, stage);
  if (amulet) player.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(core.ItemIdentifiers.GHOSTSPEAK_AMULET, 1));
  for (const id of items) player.getInventory().add(new core.Item(id, 1), false);
  return f;
};

h.spawn = function spawn(f, id, tile) {
  const npc = h.core.NPC.create(id, new h.core.Location(...tile));
  h.core.World.getNpcs().add(npc);
  f.npcs.push(npc);
  return npc;
};

const RECORDED = /^(sendVarbit|sendConfig|sendSubInterface|sendInterfaceRemoval|sendString|sendSoundEffect|sendGraphic|sendItemOnInterface|sendItemOnInterfaces|sendNpcHeadOnInterface)$/;
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
  const send = f.player.sendMessage.bind(f.player);
  f.player.sendMessage = (text, ...rest) => {
    f.messages.push({ tick: f.tick, text });
    return send(text, ...rest);
  };
  const typed = sender.sendTypedMessage.bind(sender);
  sender.sendTypedMessage = (type, text, ...rest) => {
    f.messages.push({ tick: f.tick, text, type });
    return typed(type, text, ...rest);
  };
  const animate = f.player.performAnimation.bind(f.player);
  f.player.performAnimation = (animation) => {
    f.animations.push({ tick: f.tick, id: animation.getId() });
    return animate(animation);
  };
}

h.tick = function tick(f) {
  const { core } = h;
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  PM.updatePlayerZones(f.player);
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
  const line = h.shown(f);
  const last = f.said.at(-1);
  if (line && (last?.text !== line.text || last?.who !== line.who)) f.said.push({ tick: f.tick, ...line });
};
h.ticks = (f, count) => { for (let i = 0; i < count; i++) h.tick(f); };

const clean = (text) => String(text).replace(/<br>/g, " ").replace(/\s+/g, " ").trim();
h.shown = function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", text: menu.options.join("|"), title: menu.title };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  const kind = current.constructor.name;
  let who = kind;
  if (kind === "PlayerDialogue") who = "PLAYER";
  else if (kind === "NpcDialogue") who = current.speakerName ?? h.core.NpcDefinition?.forId?.(current.getNpcId())?.getName?.() ?? String(current.getNpcId());
  return { who, text: clean(current.getText()), npcId: current.getNpcId?.() };
};

h.dispatch = async function dispatch(f, packet) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([packet]);
  h.tick(f);
};

h.clickObject = async function clickObject(f, id, [x, y], clickType = 1) {
  await h.dispatch(f, { type: "object_option", id, x, y, clickType });
  for (let i = 0; i < 15 && !h.shown(f); i++) h.tick(f);
};

h.talk = async function talk(f, npc, clickType = 1) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType }]);
  for (let i = 0; i < 20 && !h.shown(f); i++) h.tick(f);
};

h.continueLine = async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0), childIndex: -1 }]);
  h.tick(f);
};

h.choose = async function choose(f, text) {
  const pending = MultiChatboxPrompt.getPending(f.player);
  if (!pending) assert.fail(`no menu for "${text}"; said: ${JSON.stringify(f.said.slice(-5))}`);
  const index = pending.options.indexOf(text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(pending.options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  h.tick(f);
};

/**
 * Plays one conversation: continues every line, answers each menu with the next pick, and stops
 * when the chat closes (or a menu has no pick left). Returns the lines shown, as "who: text".
 */
h.converse = async function converse(f, start, picks = []) {
  const from = f.said.length;
  const queue = [...picks];
  await start();
  for (let idle = 0, i = 0; i < 300 && idle < 4; i++) {
    const line = h.shown(f);
    if (!line) { idle++; h.tick(f); continue; }
    idle = 0;
    if (line.who === "menu") {
      if (!queue.length) break;
      await h.choose(f, queue.shift());
      continue;
    }
    await h.continueLine(f);
  }
  return f.said.slice(from).map((s) => s.who === "menu" ? `MENU[${s.title ?? ""}]: ${s.text}` : `${s.who}: ${s.text}`);
};

module.exports = h;
