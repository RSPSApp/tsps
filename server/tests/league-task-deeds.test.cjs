// Demonic Pacts tasks completed by the deed itself, done through the plugin that does it (a real
// potion mixed, a real tree chopped...), so each task kind's event and names are proven to match
// what the content emits, not only a hand-emitted event (docs/leagues.md, Tasks).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { GameConstants } = require("../dist/game/GameConstants");

let core;
let next = 1700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  GameConstants.setWorldProfile("league");
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** An item's id by its display name: the first unnoted one ("Attack potion(3)"). */
let itemIds = null;
function item(name) {
  if (!itemIds) {
    itemIds = new Map();
    const count = core.CacheDefinitions.getCounts().items;
    for (let id = 0; id < count; id++) {
      const definition = core.CacheDefinitions.getItem(id);
      const key = definition?.name?.toLowerCase();
      if (key && key !== "null" && !itemIds.has(key) && !(definition.notedTemplate >= 0 || definition.certtemplate >= 0)) itemIds.set(key, id);
    }
  }
  const id = itemIds.get(name.toLowerCase());
  assert.ok(id !== undefined, `no item ${name}`);
  return id;
}

/** A new Demonic Pacts character, logged in through the real hooks, its tutorial done. */
function pactsCharacter(t, at = [1666, 3136, 0]) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(`deeds${next}`);
  player.setProfile("league");
  player.setRegistered(true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  PM.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: true, profile: "league" });
  // The login settles (the start in Yama's Lair, the welcome screen), then the deed's own place,
  // an empty pack (the automatic quests' rewards) and nothing open.
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  player.setAttribute("league:tutorial-stage", 14); // Leagues VI's tutorial over
  player.moveTo(new core.Location(...at));
  player.needsPlacement = false;
  player.getInventory().resetItems();
  player.getPacketSender().sendInterfaceRemoval();
  const messages = [];
  const send = player.sendMessage.bind(player);
  player.sendMessage = (text, ...rest) => (messages.push(String(text)), send(text, ...rest));
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection, messages };
}

async function ticks(f, count = 10) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.player.getIndex());
    f.player.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet, count = 10) {
  await f.connection.dispatch([packet]);
  f.connection.processTurnPackets();
  await ticks(f, count);
}

function completed(f) {
  const query = { player: f.player, ids: [] };
  PM.emitCustomEvent("league:completed-tasks", query);
  return query.ids;
}

function done(f, id) {
  const ids = completed(f);
  return Array.isArray(ids) ? ids.includes(id) : false;
}

test("a Demonic Pacts character: the deeds' tasks are the league's own", (t) => {
  const f = pactsCharacter(t);
  const query = { player: f.player, league: null };
  PM.emitCustomEvent("league:profile", query);
  assert.equal(query.league, 6);
});

test("produce: a potion mixed is the potion, whatever its doses (Make an Attack Potion)", async (t) => {
  const f = pactsCharacter(t);
  const inventory = f.player.getInventory();
  inventory.add(new core.Item(item("Guam potion (unf)")), true);
  inventory.add(new core.Item(item("Eye of newt")), true);
  await send(f, { type: "inventory_use_on", itemId: item("Guam potion (unf)"), slot: 0, target: { kind: "inventory", slot: 1 } }, 6);
  assert.equal(inventory.getAmount(item("Attack potion(3)")), 1, `the real Herblore mixes it: ${f.messages}`);
  assert.ok(done(f, "make-an-attack-potion"));
});

/** A real tree chopped where the player stands: `count` logs' worth of woodcutting:success. */
async function chop(t, f, x, y) {
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.WOODCUTTING, 99);
  skills.setCurrentLevel(core.Skill.WOODCUTTING, 99);
  f.player.getInventory().add(new core.Item(item("Rune axe")), true);
  core.RegionManager.loadMapFiles(x, y);
  const tree = new core.GameObject(core.ObjectIdentifiers.MAGIC_TREE, new core.Location(x + 1, y, 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => core.ObjectManager.deregister(tree, true));
  // Every roll succeeds but the bird's nest's (a nest takes a log's place).
  t.mock.method(Math, "random", () => (new Error().stack.includes("maybeDropBirdNest") ? 0.99 : 0));
  await send(f, { type: "object_option", id: tree.getId(), x: x + 1, y, action: "Chop down" }, 12);
  return f.player.getInventory().getAmount(item("Magic logs"));
}

test("produce with an area: logs chopped in Varlamore count for Varlamore's task, elsewhere not", async (t) => {
  const there = pactsCharacter(t, [1666, 3136, 0]);
  assert.ok(await chop(t, there, 1666, 3136) > 0, `the real Woodcutting chops magic logs: ${there.messages}`);
  const progress = there.player.getAttribute("league:task-progress") ?? {};
  assert.ok(progress["chop-20-magic-logs-in-varlamore"] > 0, `counted in Varlamore: ${JSON.stringify(progress)}`);
  // Zanaris: always open in Demonic Pacts, and no part of Varlamore.
  const away = pactsCharacter(t, [2412, 4434, 0]);
  assert.ok(await chop(t, away, 2412, 4434) > 0, `chopped in Zanaris: ${away.messages}`);
  assert.equal((away.player.getAttribute("league:task-progress") ?? {})["chop-20-magic-logs-in-varlamore"], undefined, "not outside Varlamore");
});


/** A real NPC of the cache's name dying to the player through the engine's death task. */
function kill(f, name) {
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
  const id = core.CacheDefinitions.getNpcId(name) ?? [...Array(20000).keys()].find((each) => core.CacheDefinitions.getNpc(each)?.name === name);
  assert.ok(id !== undefined && id !== null, `no NPC ${name}`);
  const at = f.player.getLocation();
  const npc = new NPC(id, new core.Location(at.getX() + 1, at.getY(), at.getZ()));
  npc.getCombat().addDamage(f.player, 1);
  const task = new NPCDeathTask(npc);
  task.execute();
  task.execute();
}

test("kill: a boss in its own lair counts its kills (Defeat Sarachnis in the Forthos Dungeon 50 times)", (t) => {
  const f = pactsCharacter(t);
  kill(f, "Sarachnis");
  assert.equal((f.player.getAttribute("league:task-kills") ?? {})["defeat-sarachnis-50-times"], 1, JSON.stringify(f.player.getAttribute("league:task-kills")));
});
