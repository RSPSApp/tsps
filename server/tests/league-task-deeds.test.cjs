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

/** An inventory item's option, as the client clicks it. */
async function inventoryOption(f, name, option, optionIndex = 1, count = 4) {
  const id = item(name);
  await send(f, { type: "inventory_action", slot: f.player.getInventory().getSlotForItemId(id), itemId: id, widgetId: 149 << 16, option, optionIndex }, count);
}

test("bury: bones buried by hand count, any kind for 'Bury 6 bones' and the named ones for theirs", async (t) => {
  const f = pactsCharacter(t);
  f.player.getInventory().add(new core.Item(item("Dragon bones")), true);
  await inventoryOption(f, "Dragon bones", "Bury");
  assert.equal(f.player.getInventory().getAmount(item("Dragon bones")), 0, `the real Prayer buries it: ${f.messages}`);
  assert.ok(done(f, "bury-some-wyvern-or-dragon-bones"));
  assert.equal(f.player.getAttribute("league:task-progress")["bury-6-bones"], 1);
});

test("burn: logs lit for a fire (Burn Some Normal Logs)", async (t) => {
  const f = pactsCharacter(t);
  core.RegionManager.loadMapFiles(1666, 3136);
  f.player.getInventory().add(new core.Item(item("Tinderbox")), true);
  f.player.getInventory().add(new core.Item(item("Logs")), true);
  t.mock.method(Math, "random", () => 0);
  await send(f, { type: "inventory_use_on", itemId: item("Tinderbox"), slot: 0, target: { kind: "inventory", slot: 1 } }, 10);
  assert.equal(f.player.getInventory().getAmount(item("Logs")), 0, `the real Firemaking lights it: ${f.messages}`);
  assert.ok(done(f, "burn-some-normal-logs"));
});

test("burn-food: food burnt on a fire (Burn Some Food)", async (t) => {
  const f = pactsCharacter(t);
  core.RegionManager.loadMapFiles(1666, 3136);
  const range = new core.GameObject(core.ObjectIdentifiers.FIRE, new core.Location(1667, 3136, 0), 10, 0, null);
  core.ObjectManager.register(range, true);
  t.after(() => core.ObjectManager.deregister(range, true));
  f.player.getInventory().add(new core.Item(item("Raw shrimps")), true);
  t.mock.method(Math, "random", () => 0); // a roll of 0 is under any burn chance
  await send(f, { type: "item_on_object", itemId: item("Raw shrimps"), slot: 0, widgetId: 149 << 16, objectId: range.getId(), x: 1667, y: 3136 }, 10);
  assert.equal(f.player.getInventory().getAmount(item("Burnt shrimp")), 1, `the real Cooking burns it: ${f.messages}`);
  assert.ok(done(f, "burn-some-food"));
});

test("cast: a spell whose cost is paid, named by the server's registries (Cast Low Level Alchemy)", async (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.MAGIC, 99);
  skills.setCurrentLevel(core.Skill.MAGIC, 99);
  const inventory = f.player.getInventory();
  inventory.add(new core.Item(item("Nature rune"), 1), true);
  inventory.add(new core.Item(item("Fire rune"), 3), true);
  inventory.add(new core.Item(item("Bronze dagger")), true);
  const spell = core.CacheDefinitions.getSpellByName("Low Level Alchemy");
  const slot = inventory.getSlotForItemId(item("Bronze dagger"));
  await send(f, { type: "widget_target", sourceWidgetId: spell.widgetId, sourceItemId: spell.itemId, sourceSlot: -1, targetWidgetId: 149 << 16, targetItemId: item("Bronze dagger"), targetSlot: slot }, 4);
  assert.equal(inventory.getAmount(item("Bronze dagger")), 0, `the real alchemy casts: ${f.messages}`);
  assert.ok(done(f, "cast-low-level-alchemy"));
});

test("cast: a combat spell's cost paid is its cast (Cast Ice Burst)", (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.MAGIC, 99);
  skills.setCurrentLevel(core.Skill.MAGIC, 99);
  f.player.setSpellbook(core.MagicSpellbook.ANCIENT);
  const inventory = f.player.getInventory();
  for (const [rune, amount] of [["Death rune", 2], ["Chaos rune", 4], ["Water rune", 4]]) inventory.add(new core.Item(item(rune), amount), true);
  assert.equal(core.CombatSpells.ICE_BURST.canCast(f.player, true), true, `the real cast: ${f.messages}`);
  assert.equal(inventory.getAmount(item("Death rune")), 0, "its runes paid");
  assert.ok(done(f, "cast-ice-burst"));
});

test("steal: a theft from the stall named (Steal From a Gem Stall)", async (t) => {
  const f = pactsCharacter(t);
  core.RegionManager.loadMapFiles(1666, 3136);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.THIEVING, 99);
  skills.setCurrentLevel(core.Skill.THIEVING, 99);
  const stall = new core.GameObject(11731 /* Ardougne's gem stall, with Steal-from */, new core.Location(1668, 3136, 0), 10, 0, null);
  core.ObjectManager.register(stall, true);
  t.after(() => core.ObjectManager.deregister(stall, true));
  t.mock.method(Math, "random", () => 0);
  await send(f, { type: "object_option", id: stall.getId(), x: 1668, y: 3136, action: "Steal-from" }, 12);
  assert.ok(f.player.getInventory().getValidItems().length > 0, `the real Thieving steals: ${f.messages}`);
  assert.ok(done(f, "steal-from-a-gem-stall"));
});

/** A plant picked from a field through the real Pickable plugin (never depleting). */
async function pickPlant(t, f, objectId, option = "Pick") {
  core.RegionManager.loadMapFiles(1666, 3136);
  const plant = new core.GameObject(objectId, new core.Location(1667, 3136, 0), 10, 0, null);
  core.ObjectManager.register(plant, true);
  try {
    await send(f, { type: "object_option", id: objectId, x: 1667, y: 3136, action: option }, 4);
  } finally {
    core.ObjectManager.deregister(plant, true);
  }
}

test("pick: crops from a field, by the plant (Pick 6 flax; 6 wheat, 6 cabbages and 6 potatoes)", async (t) => {
  const f = pactsCharacter(t);
  t.mock.method(Math, "random", () => 0.99);
  for (let i = 0; i < 6; i++) await pickPlant(t, f, core.ObjectIdentifiers.FLAX);
  assert.equal(f.player.getInventory().getAmount(item("Flax")), 6, `the real Pickable picks: ${f.messages}`);
  assert.ok(done(f, "pick-6-flax"));
  await pickPlant(t, f, core.ObjectIdentifiers.WHEAT);
  assert.equal(f.player.getInventory().getAmount(item("Grain")), 1);
  assert.deepEqual(f.player.getAttribute("league:task-progress")["pick-6-wheat-6-cabbages-and-6-potatoes"], { Wheat: 1 }, "counted per plant: wheat's grain");
});

test("collection-log: a tier's Treasure Trails slots filled, as the real log keeps them", (t) => {
  const f = pactsCharacter(t);
  const Data = require("../plugins/achievements/collectionlog/Data.CollectionLog");
  const easy = Data.tabs().flatMap((tab) => tab.categories).find((category) => category.name === "Easy Treasure Trails");
  assert.ok(easy?.items.length >= 50, "the cache's Easy Treasure Trails category");
  PM.emitCustomEvent("collection-log:obtain", { player: f.player, itemId: easy.items[0], silent: true });
  assert.ok(done(f, "gain-a-unique-item-from-an-easy-clue"), "the first slot");
  assert.ok(!done(f, "fill-5-easy-clue-collection-log-slots"));
  for (const itemId of easy.items.slice(1, 5)) PM.emitCustomEvent("collection-log:obtain", { player: f.player, itemId, silent: true });
  assert.ok(done(f, "fill-5-easy-clue-collection-log-slots"), "the fifth");
  PM.emitCustomEvent("collection-log:obtain", { player: f.player, itemId: easy.items[0], silent: true });
  assert.ok(!done(f, "gain-10-unique-items-from-easy-clues"), "a slot already filled is no new one");
});

test("check-health: a grown crop's health checked, by its type (Check a grown fruit tree)", (t) => {
  const f = pactsCharacter(t);
  const Data = require("../plugins/skills/farming/Data.Farming");
  const Patches = require("../plugins/skills/farming/Patches.Farming");
  const patch = Data.CACHE.patches.find((each) => each.type === "FRUIT_TREE");
  const state = Patches.stateFor(f.player, patch);
  Object.assign(state, { crop: "APPLE", stage: 6, status: "grown", checked: false, lives: 6, weeds: 0, nextAt: Number.MAX_SAFE_INTEGER });
  f.player.moveTo(new core.Location(patch.x, patch.y, patch.z));
  t.mock.method(core.MapObjects, "get", () => null);
  t.mock.method(core.ObjectDefinition, "forPlayer", () => ({ getInteractions: () => ["Check-health"] }));
  PM.emitObjectInteraction({ player: f.player, object: { getId: () => patch.id, getLocation: () => new core.Location(patch.x, patch.y, patch.z), getDefinition: () => core.ObjectDefinition.forId(patch.id), getType: () => 10, getFace: () => 0, getPrivateArea: () => null }, objectId: patch.id, clickType: 1,
    location: { x: patch.x, y: patch.y, z: patch.z }, sourceLocation: { x: patch.x, y: patch.y, z: patch.z }, handled: false });
  assert.ok(f.messages.some((text) => /perfect health/.test(text)) || state.checked, `the real Farming checks it: ${f.messages}`);
  assert.ok(done(f, "check-a-grown-fruit-tree"));
});

test("equip-all: a set worn at once, a slot taking either (Equip a Full Bronze Set, with the plateskirt)", async (t) => {
  const f = pactsCharacter(t);
  for (const name of ["Bronze platebody", "Bronze full helm", "Bronze plateskirt"]) {
    f.player.getInventory().add(new core.Item(item(name)), true);
  }
  for (const name of ["Bronze platebody", "Bronze full helm"]) await inventoryOption(f, name, "Wear", 2, 2);
  assert.ok(!done(f, "equip-a-full-bronze-set"), "not yet the legs");
  await inventoryOption(f, "Bronze plateskirt", "Wear", 2, 2);
  assert.equal(f.player.getEquipment().getItems().filter((each) => each && each.getId() >= 0).length, 3, `the real Equipment wears them: ${f.messages}`);
  assert.ok(done(f, "equip-a-full-bronze-set"));
});

test("item sets from the cache: a piece, the whole set, one whole Barrows set (Verac's, worn for real)", async (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  for (const skill of [core.Skill.ATTACK, core.Skill.DEFENCE]) {
    skills.setMaxLevel(skill, 99);
    skills.setCurrentLevel(skill, 99);
  }
  const pieces = ["Verac's helm", "Verac's brassard", "Verac's plateskirt", "Verac's flail"];
  for (const name of pieces) f.player.getInventory().add(new core.Item(item(name)), true);
  await inventoryOption(f, "Verac's flail", "Wield", 2, 2);
  assert.ok(!done(f, "equip-a-piece-of-any-barrows-armour-set"), "the flail is no armour");
  await inventoryOption(f, "Verac's helm", "Wear", 2, 2);
  assert.ok(done(f, "equip-a-piece-of-any-barrows-armour-set"), `the helm is: ${f.messages}`);
  for (const name of pieces.slice(1, 3)) await inventoryOption(f, name, "Wear", 2, 2);
  assert.ok(done(f, "equip-full-veracs-armour-set"));
  assert.ok(done(f, "equip-any-full-barrows-armour-set"));
});

test("a minigame completed as its plugin credits it: the Fight Cave won, not a Jad dying elsewhere", (t) => {
  const f = pactsCharacter(t);
  kill(f, "TzTok-Jad");
  assert.equal((f.player.getAttribute("league:task-kills") ?? {})["complete-the-fight-caves-5-times"], undefined, "a TzTok-Jad death alone (TzHaar-Ket-Rak's Challenges) is no completion");
  const FightCaves = require("../plugins/minigames/tzhaar/CombatAchievements.TzhaarFightCaves");
  FightCaves.finish(f.player, true);
  assert.equal(f.player.getAttribute("league:task-kills")["complete-the-fight-caves-5-times"], 1, "the cave won");
});

test("slayer: a task completed by the real Slayer plugin; a superior killed (on task or off)", (t) => {
  const f = pactsCharacter(t);
  const Tasks = require("../plugins/skills/slayer/Tasks.Slayer");
  const Data = require("../plugins/skills/slayer/Data.Slayer");
  const master = [...Data.get().masters.values()].find((each) => each.names.includes("Turael"));
  const assigned = Tasks.assign(f.player, master, () => 0);
  assert.ok(!assigned?.refused && Tasks.current(f.player), `the real Slayer assigns one: ${assigned?.refused}`);
  Tasks.complete(f.player, Tasks.current(f.player));
  assert.ok(done(f, "complete-1-slayer-task"));
  assert.equal(f.player.getAttribute("league:task-progress")["complete-200-slayer-tasks"], 1);
  kill(f, "Crushing hand");
  assert.ok(done(f, "defeat-a-superior-slayer-creature"), "the real Superiors' death handler");
});

test("pest-control: a real match won on the novice boat (Novice or higher, not Intermediate)", (t) => {
  const f = pactsCharacter(t);
  const plugin = require("../plugins/minigames/PestControl.plugin");
  const boat = plugin._test.BOATS.find((each) => each.key === "novice");
  const match = new plugin._test.PestControlMatch(boat, [f.player], () => {});
  match.players.get(f.player).activity = 100;
  match.finish(true, "won");
  assert.ok(f.messages.some((text) => /Void Knight commendation points/.test(text)), `rewarded: ${f.messages}`);
  assert.ok(done(f, "complete-a-game-of-novice-pest-control"));
  assert.ok(!done(f, "complete-a-game-of-intermediate-pest-control"));
});

test("temple-trek: a real trek rewarded, by its companion's difficulty (Complete a Hard Temple Trek)", (t) => {
  const f = pactsCharacter(t);
  const Common = require("../plugins/minigames/templetrekking/Common.TempleTrekking");
  const Trek = require("../plugins/minigames/templetrekking/Trek.TempleTrekking");
  const follower = Common.data.followers.find((entry) => entry.difficulty === "hard");
  const trek = new Trek.Trek(f.player, follower);
  trek.route = 0;
  t.mock.method(Common, "itemStatement", () => {});
  t.mock.method(trek, "finish", () => {});
  trek.reward();
  assert.ok(done(f, "complete-a-hard-temple-trek"));
  assert.ok(!done(f, "complete-an-easy-temple-trek"), "a trek of its own difficulty only");
});

test("a group encounter as its plugin credits it: a Wintertodt round subdued", (t) => {
  const f = pactsCharacter(t);
  require("../plugins/minigames/wintertodt/CombatAchievements.Wintertodt").subdued(f.player, 500, 1);
  assert.ok(done(f, "defeat-the-wintertodt-1-time"));
  assert.equal(f.player.getAttribute("league:task-kills")["defeat-the-wintertodt-10-times"], 1);
});

test("prayer: a prayer switched on by the real PrayerHandler (Use the Protect from Melee prayer)", (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.PRAYER, 99);
  skills.setCurrentLevel(core.Skill.PRAYER, 99);
  core.PrayerHandler.activatePrayerPrayerId(f.player, core.PrayerHandler.PROTECT_FROM_MELEE);
  assert.ok(core.PrayerHandler.isActivated(f.player, core.PrayerHandler.PROTECT_FROM_MELEE), `on: ${f.messages}`);
  assert.ok(done(f, "use-the-protect-from-melee-prayer"));
  assert.ok(!done(f, "use-the-piety-prayer"));
});

test("pet: a skilling pet awarded by the real Woodcutting (Obtain any Skilling Pet)", async (t) => {
  const f = pactsCharacter(t);
  assert.ok(await chop(t, f, 1666, 3136) > 0);
  assert.ok((f.player.getAttribute("pets.owned") ?? []).length > 0, "a roll of 0 also awards the Beaver");
  assert.ok(done(f, "obtain-a-skilling-pet"));
});

test("equip in an area: worn there, also as the player walks in wearing it (Equip a dark bow in Tirannwn)", async (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.RANGED, 99);
  skills.setCurrentLevel(core.Skill.RANGED, 99);
  f.player.setAttribute("league:areas", [21, 7]); // Varlamore and Tirannwn unlocked
  f.player.getInventory().add(new core.Item(item("Dark bow")), true);
  await inventoryOption(f, "Dark bow", "Wield", 2, 2);
  assert.ok(f.player.getEquipment().getItems().some((each) => each?.getId() === item("Dark bow")), `the real Equipment wields it: ${f.messages}`);
  assert.ok(!done(f, "equip-a-dark-bow-in-tirannwn"), "not in Tirannwn yet");
  f.player.moveTo(new core.Location(2341, 3171, 0)); // Lletya
  assert.ok(done(f, "equip-a-dark-bow-in-tirannwn"), "crossing into Tirannwn wearing it");
});

test("tempoross: subdued, as the real fight rewards it (no NPC dies)", (t) => {
  const f = pactsCharacter(t);
  const { Fight } = require("../plugins/minigames/tempoross/Fight.Tempoross");
  Fight.prototype.reward.call({}, f.player, 300);
  assert.ok(f.messages.some((text) => /Tempoross kill count/.test(text)), `the real reward: ${f.messages}`);
  assert.ok(done(f, "defeat-tempoross-1-time"));
});

test("open-chest: a key chest opened by the real KeyChests (Open the Crystal Chest)", async (t) => {
  const f = pactsCharacter(t);
  core.RegionManager.loadMapFiles(1666, 3136);
  const Data = require("../plugins/objects/keychests/Data.KeyChests");
  const chest = Data.get().chests.find((each) => each.name === "Crystal chest");
  const loc = new core.GameObject(chest.locId, new core.Location(1667, 3136, 0), 10, 0, null);
  core.ObjectManager.register(loc, true);
  t.after(() => core.ObjectManager.deregister(loc, true));
  f.player.getInventory().add(new core.Item(chest.keyId), true);
  const option = core.ObjectDefinition.forId(chest.locId).getInteractions().find(Boolean);
  await send(f, { type: "object_option", id: chest.locId, x: 1667, y: 3136, action: option }, 8);
  assert.equal(f.player.getInventory().getAmount(chest.keyId), 0, `the key used: ${f.messages}`);
  assert.ok(done(f, "open-the-crystal-chest"));
});

test("plant: seeds dibbed in an allotment through the real Farming (Plant some seeds in an allotment patch)", (t) => {
  const f = pactsCharacter(t);
  const Data = require("../plugins/skills/farming/Data.Farming");
  const Patches = require("../plugins/skills/farming/Patches.Farming");
  const patch = Data.CACHE.patches.find((each) => each.type === "ALLOTMENT");
  Object.assign(Patches.stateFor(f.player, patch), { weeds: 0 });
  f.player.moveTo(new core.Location(patch.x, patch.y, patch.z));
  t.mock.method(core.MapObjects, "get", () => null);
  for (const name of ["Seed dibber", "Potato seed"]) f.player.getInventory().add(new core.Item(Data.itemId(name), name === "Potato seed" ? 3 : 1), true);
  const seed = Data.itemId("Potato seed");
  PM.emitItemOnObject({ player: f.player, object: { getId: () => patch.id, getLocation: () => new core.Location(patch.x, patch.y, patch.z), getDefinition: () => core.ObjectDefinition.forId(patch.id) },
    objectId: patch.id, item: f.player.getInventory().get(f.player.getInventory().getSlotForItemId(seed)), itemId: seed, itemSlot: f.player.getInventory().getSlotForItemId(seed),
    interfaceType: 0, location: { x: patch.x, y: patch.y, z: patch.z }, handled: false });
  for (let i = 0; i < 4; i++) { core.TaskManager.process(); Patches.tick(); }
  assert.ok(f.player.getInventory().getAmount(seed) < 3, `the real Farming plants them: ${f.messages}`);
  assert.ok(done(f, "plant-seeds-in-an-allotment-patch"));
});

test("plunder-chest: a room's Grand Gold Chest searched in a real Pyramid Plunder run", (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.THIEVING, 99);
  skills.setCurrentLevel(core.Skill.THIEVING, 99);
  const C = require("../plugins/minigames/pyramidplunder/Common.PyramidPlunder");
  const Entrance = require("../plugins/minigames/pyramidplunder/Entrance.PyramidPlunder");
  const Containers = require("../plugins/minigames/pyramidplunder/Containers.PyramidPlunder");
  require("../plugins/quests/QuestRuntime").questNamed("Icthlarin's Little Helper").setStage(f.player, 1);
  Entrance._test.tryStart(f.player, () => 0);
  t.after(() => C.endRun(f.player));
  const b = C.roomData(1).bounds;
  Containers._test.searchChest({ player: f.player, objectId: C.ids().chest, location: { x: b.minX + 2, y: b.minY + 2, z: 0 } }, () => 0.5);
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  assert.ok(done(f, "room-1-of-pyramid-plunder"), `the room 1 chest: ${f.messages}`);
  assert.ok(!done(f, "room-2-of-pyramid-plunder"));
});

test("sepulchre-floor: a floor credited by the real Hallowed Sepulchre run (Complete floor 3)", (t) => {
  const f = pactsCharacter(t);
  const { Run } = require("../plugins/minigames/hallowedsepulchre/Run.HallowedSepulchre");
  Run.prototype.credit.call({ player: f.player, floorNumber: 3, floorSpent: 100, floor: { xp: 1 } }, false);
  assert.ok(f.messages.some((text) => /3/.test(text)), `credited: ${f.messages}`);
  assert.ok(done(f, "floor-3-of-the-hallowed-sepulchre"));
  assert.ok(!done(f, "floor-4-of-the-hallowed-sepulchre"));
});

test("rumours: a Hunter rumour handed in to the real guild hunter (Complete a Hunter Rumour)", (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.HUNTER, 99);
  skills.setCurrentLevel(core.Skill.HUNTER, 99);
  const Rumours = require("../plugins/skills/hunter/Rumours.Hunter");
  const [taskKey, task] = Object.entries(Rumours.tasks).find(([, each]) => each.part && core.ItemIdentifiers[each.part]);
  const s = Rumours.state(f.player);
  s.unlocked = true;
  s.assignments[0] = { task: taskKey, found: true };
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers[task.part]), true);
  Rumours.assign(f.player, 0);
  assert.ok(f.messages.some((text) => /Rumour completed/.test(text)), `the real rumour: ${f.messages}`);
  assert.ok(done(f, "complete-a-hunter-rumour"));
  assert.equal(f.player.getAttribute("league:task-progress")["complete-10-hunter-rumours"], 1);
});

test("random-event: an event ended with its reward by the real random events plugin (the Maze)", (t) => {
  const f = pactsCharacter(t);
  const Teleports = require("../plugins/npcs/random-events/Teleports.RandomEvents");
  const session = { player: f.player, kind: "maze", data: {}, cleanup: [], finishing: false, returnLocation: f.player.getLocation().clone() };
  Teleports.finish(session, { reward: [{ id: item("Coins"), amount: 10 }], back: false });
  assert.ok(done(f, "complete-the-maze-random-event"));
  const pillory = { player: f.player, kind: "pillory", data: {}, cleanup: [], finishing: false, returnLocation: f.player.getLocation().clone() };
  Teleports.finish(pillory, { message: "You leave.", back: false });
  assert.ok(!done(f, "complete-the-pillory-random-event"), "left without its reward");
});

test("dummy: a dummy hit through the real attack dummies plugin (Attack a dummy)", async (t) => {
  const f = pactsCharacter(t);
  core.RegionManager.loadMapFiles(1666, 3136);
  const dummy = new core.GameObject(52645, new core.Location(1667, 3136, 0), 10, 0, null);
  core.ObjectManager.register(dummy, true);
  t.after(() => core.ObjectManager.deregister(dummy, true));
  await send(f, { type: "object_option", id: 52645, x: 1667, y: 3136, action: "Attack" }, 4);
  assert.ok(f.messages.includes("You hit the dummy."), `hit: ${f.messages}`);
  assert.ok(done(f, "attack-a-dummy"));
});

test("gather-with: logs chopped with the axe named (Chop Some Logs With a Rune Axe), not another", async (t) => {
  const f = pactsCharacter(t);
  assert.ok(await chop(t, f, 1666, 3136) > 0, "the real Woodcutting with a rune axe");
  assert.ok(done(f, "chop-some-logs-with-a-rune-axe"));
  assert.ok(!done(f, "chop-some-logs-with-a-steel-axe"));
});
