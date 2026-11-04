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


test("bird-nest: a nest falls from a tree being chopped (Obtain a Bird Nest)", async (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.WOODCUTTING, 99);
  skills.setCurrentLevel(core.Skill.WOODCUTTING, 99);
  f.player.getInventory().add(new core.Item(item("Rune axe")), true);
  core.RegionManager.loadMapFiles(1666, 3136);
  const tree = new core.GameObject(core.ObjectIdentifiers.MAGIC_TREE, new core.Location(1667, 3136, 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => core.ObjectManager.deregister(tree, true));
  t.mock.method(Math, "random", () => 0); // every roll succeeds, the nest's too
  await send(f, { type: "object_option", id: tree.getId(), x: 1667, y: 3136, action: "Chop down" }, 12);
  assert.ok(done(f, "obtain-a-bird-nest"), `the real Woodcutting drops a nest: ${f.messages}`);
});

test("buy: an item bought from the shop named (Purchase an Onyx in Mor Ul Rek)", (t) => {
  const f = pactsCharacter(t);
  const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
  const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
  assert.equal(new ShopDefinitionLoader().load(), true, "the server's shops");
  ShopManager.initialize();
  const shopId = 1468; // TzHaar-Hur-Lek's Ore and Gem Store (Default)
  f.player.getInventory().add(new core.Item(item("Tokkul"), 1000000), true);
  ShopManager.open(f.player, shopId);
  const slot = ShopManager.displayEntries(ShopManager.shopsById.get(shopId)).findIndex(({ itemId }) => itemId === item("Uncut onyx"));
  ShopManager.handleWidgetAction(f.player, { groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 1", slot: slot + 1, itemId: item("Uncut onyx") });
  assert.equal(f.player.getInventory().getAmount(item("Uncut onyx")), 1, `the real shop sells it: ${f.messages}`);
  assert.ok(done(f, "purchase-an-onyx-in-mor-ul-rek"));
});

test("bank: a bank opened inside the town's bank (Use the Bank in Nardah), not elsewhere", async (t) => {
  // A character with the town's area unlocked, standing before its bank's counter or booth.
  const at = (x, y, areas) => {
    core.RegionManager.loadMapFiles(x, y);
    const f = pactsCharacter(t);
    f.player.setAttribute("league:areas", areas);
    f.player.moveTo(new core.Location(x, y, 0));
    f.player.needsPlacement = false;
    return f;
  };
  const lletya = at(2351, 3164, [21, 7]); // Varlamore and Tirannwn
  await send(lletya, { type: "object_option", id: 20127, x: 2351, y: 3165, action: "Bank" }, 4);
  assert.ok(core.Bank.isOpen(lletya.player), `the real counter opens the bank: ${lletya.messages}`);
  assert.ok(done(lletya, "use-the-bank-in-lletya") && !done(lletya, "use-the-bank-in-nardah"), "Lletya's bank, not Nardah's");
  // Nardah bank's booths stand at x 3426, the player before them.
  const nardah = at(3427, 2891, [21, 6]); // and the Kharidian Desert
  await send(nardah, { type: "object_option", id: 10517, x: 3426, y: 2891, action: "Bank" }, 4);
  assert.ok(core.Bank.isOpen(nardah.player), `the real booth opens the bank: ${nardah.messages}`);
  assert.ok(done(nardah, "use-the-bank-in-nardah"));
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

test("enter: inside a named place's bounds, by its zones (Enter the Crafting Guild)", (t) => {
  const f = pactsCharacter(t);
  f.player.setAttribute("league:areas", [21, 2, 3]); // Varlamore, Karamja and Asgarnia unlocked
  f.player.moveTo(new core.Location(2933, 3290, 0));
  PM.emitPlayerProcess({ player: f.player });
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [2933, 3290], "in Asgarnia");
  assert.ok(!done(f, "enter-the-crafting-guild"), "outside its door");
  f.player.moveTo(new core.Location(2933, 3285, 0));
  PM.emitPlayerProcess({ player: f.player });
  assert.ok(done(f, "enter-the-crafting-guild"), "inside its walls");
});

test("kill with a place: a death inside its bounds counts, elsewhere not (Defeat a Runite Golem in the Resource Area)", (t) => {
  const at = (x, y) => {
    const f = pactsCharacter(t);
    f.player.setAttribute("league:areas", [21, 2, 11]); // Varlamore, Karamja and the Wilderness unlocked
    f.player.moveTo(new core.Location(x, y, 0));
    return f;
  };
  const away = at(3185, 3950);
  kill(away, "Runite Golem");
  assert.ok(!done(away, "defeat-a-runite-golem"), "north of its fence");
  const there = at(3185, 3934);
  kill(there, "Runite Golem");
  assert.ok(done(there, "defeat-a-runite-golem"));
});

/** A raw shark cooked on a fire beside the player through the real Cooking (at 99, never burnt). */
async function cookShark(t, f) {
  const at = f.player.getLocation();
  core.RegionManager.loadMapFiles(at.getX(), at.getY());
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.COOKING, 99);
  skills.setCurrentLevel(core.Skill.COOKING, 99);
  const fire = new core.GameObject(core.ObjectIdentifiers.FIRE, new core.Location(at.getX() + 1, at.getY(), 0), 10, 0, null);
  core.ObjectManager.register(fire, true);
  t.after(() => core.ObjectManager.deregister(fire, true));
  f.player.getInventory().add(new core.Item(item("Raw shark")), true);
  await send(f, { type: "item_on_object", itemId: item("Raw shark"), slot: 0, widgetId: 149 << 16, objectId: fire.getId(), x: at.getX() + 1, y: at.getY() }, 10);
  return f.player.getInventory().getAmount(item("Shark"));
}

test("produce with a place: a shark cooked in Darkmeyer counts for its task, outside its walls not", async (t) => {
  const at = (x, y) => {
    const f = pactsCharacter(t);
    f.player.setAttribute("league:areas", [21, 2, 5]); // Varlamore, Karamja and Morytania unlocked
    f.player.moveTo(new core.Location(x, y, 0));
    f.player.needsPlacement = false;
    return f;
  };
  const there = at(3606, 3361);
  assert.equal(await cookShark(t, there), 1, `the real Cooking cooks it: ${there.messages}`);
  assert.equal((there.player.getAttribute("league:task-progress") ?? {})["cook-20-sharks-in-darkmeyer"], 1, "inside the city's walls");
  const away = at(3580, 3360);
  assert.equal(await cookShark(t, away), 1, `cooked west of the walls: ${away.messages}`);
  assert.equal((away.player.getAttribute("league:task-progress") ?? {})["cook-20-sharks-in-darkmeyer"], undefined, "outside Darkmeyer");
});

test("teleport: a teleport spell cast and landed (Teleport to Civitas illa Fortis)", async (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.MAGIC, 99);
  skills.setCurrentLevel(core.Skill.MAGIC, 99);
  for (const [rune, amount] of [["Law rune", 2], ["Earth rune", 1], ["Fire rune", 1]]) f.player.getInventory().add(new core.Item(item(rune), amount), true);
  assert.equal(core.SpellTeleports.handleSelf(f.player, "Civitas illa Fortis Teleport"), true);
  assert.equal(f.player.getInventory().getAmount(item("Law rune")), 0, `the real cast pays its runes: ${f.messages}`);
  assert.ok(!done(f, "teleport-to-civitas-illa-fortis"), "not until it lands");
  await ticks(f, 8);
  assert.ok(done(f, "teleport-to-civitas-illa-fortis"), `landed at ${f.player.getLocation()}`);
  assert.ok(done(f, "teleport-using-law-runes"), "a law rune teleport too");
});

test("rifts: Guardians of the Rift's own count of rifts closed (Guardians of the Rift 1 Rift closed)", (t) => {
  const f = pactsCharacter(t);
  const Rewards = require("../plugins/minigames/guardiansoftherift/Rewards.GuardiansOfTheRift");
  Rewards.closed({ player: f.player, state: { elemental: 150, catalytic: 150 } });
  assert.ok(f.messages.some((text) => /closed the rift/.test(text)), `the real close: ${f.messages}`);
  assert.ok(done(f, "guardians-of-the-rift-1-rift-closed"));
  assert.ok(!done(f, "guardians-of-the-rift-10-rifts-closed"), "one of ten");
});

test("tob: a Theatre of Blood raid finished in a mode the task names (Complete the Theatre of Blood 25 Times)", (t) => {
  const f = pactsCharacter(t);
  // Verzik beaten: the raid counts the completion, by its mode, for each player still in it.
  const Stats = require("../plugins/minigames/tob/Stats.TheatreOfBlood");
  Stats.countCompletion(f.player, "entry");
  assert.equal((f.player.getAttribute("league:task-progress") ?? {})["complete-the-theatre-of-blood-25-times"], undefined, "Entry Mode is not the task's");
  Stats.countCompletion(f.player, "normal");
  assert.ok(f.messages.some((text) => /Theatre of Blood count is/.test(text)), `the real count: ${f.messages}`);
  assert.equal(f.player.getAttribute("league:task-progress")["complete-the-theatre-of-blood-25-times"], 1);
  Stats.countCompletion(f.player, "hard");
  assert.equal(f.player.getAttribute("league:task-progress")["complete-the-theatre-of-blood-25-times"], 2, "Hard Mode counts too");
});

test("emote: an emote performed from the tab, by its slot (Use the Fortis Salute emote)", async (t) => {
  const f = pactsCharacter(t);
  const emote = async () => {
    f.player.getPacketSender().sendInterfaceRemoval(); // whatever the login left open
    await send(f, { type: "widget_action", widgetId: (216 << 16) | 2, groupId: 216, childId: 2, slot: 53, itemId: -1, buttonNum: 1 }, 1);
  };
  await emote();
  assert.ok(!done(f, "use-the-fortis-salute-emote"), `locked until Grand Champion: ${f.messages}`);
  f.player.getPacketSender().sendConfig(core.CacheDefinitions.getVarpId("colosseum_glory"), 20000);
  await emote();
  assert.ok(done(f, "use-the-fortis-salute-emote"), `the real Emotes performs it: ${f.messages}`);
});

test("take: a ground item picked up or telegrabbed where the task says (White berries in Tirannwn; a Bloody bracer in Slepe)", (t) => {
  const manager = core.ItemOnGroundManager;
  const at = (x, y, areas) => {
    const f = pactsCharacter(t);
    f.player.setAttribute("league:areas", areas);
    f.player.moveTo(new core.Location(x, y, 0));
    f.player.needsPlacement = false;
    return f;
  };
  const lletya = at(2341, 3171, [21, 2, 7]); // Varlamore, Karamja and Tirannwn unlocked
  manager.pickup(lletya.player, manager.registers(lletya.player, new core.Item(item("White berries"))));
  assert.equal(lletya.player.getInventory().getAmount(item("White berries")), 1, `the real pick-up: ${lletya.messages}`);
  assert.equal(lletya.player.getAttribute("league:task-progress")["pick-up-10-whiteberries-in-tirannwn"], 1);
  const slepe = at(3724, 3335, [21, 2, 5]); // and Morytania
  const { MagicOnItemPacketListener } = require("../dist/net/packet/impl/MagicOnItemPacketListener");
  const bracer = manager.registers(slepe.player, new core.Item(item("Bloody bracer")));
  manager.pickup(slepe.player, manager.registers(slepe.player, new core.Item(item("Bloody bracer"))));
  assert.ok(!done(slepe, "telegrab-a-bloody-bracer"), "picked up by hand is no telegrab");
  new MagicOnItemPacketListener().landGroundItemGrab(slepe.player, bracer.getItem().getId(), bracer.getPosition());
  assert.equal(slepe.player.getInventory().getAmount(item("Bloody bracer")), 2, `the real grab lands: ${slepe.messages}`);
  assert.ok(done(slepe, "telegrab-a-bloody-bracer"));
});

test("pickpocket-loot: an item in the pocket's loot (Pickpocket a Diamond From a TzHaar)", async (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.THIEVING, 99);
  skills.setCurrentLevel(core.Skill.THIEVING, 99);
  f.player.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(item("Fire cape"))); // the TzHaar's requirement
  core.RegionManager.loadMapFiles(1666, 3136);
  const id = [...Array(20000).keys()].find((each) => core.CacheDefinitions.getNpc(each)?.name === "TzHaar-Hur" && (core.CacheDefinitions.getNpc(each).actions ?? []).includes("Pickpocket"));
  const hur = core.NPC.create(id, new core.Location(1667, 3136, 0));
  core.World.getNpcs().add(hur);
  t.after(() => core.World.getNpcs().remove(hur));
  const option = hur.getCurrentDefinition(f.player).getActions().findIndex((action) => action?.toLowerCase() === "pickpocket") + 1;
  // Pickpocketing's own rolls: the success roll, then the table's last row, the uncut diamond.
  const rolls = [0, 0.999];
  t.mock.method(Math, "random", () => (new Error().stack.includes("Pickpocket.Thieving") ? rolls.shift() ?? 0.5 : 0.5));
  await send(f, { type: "npc_option", index: hur.getIndex(), clickType: option }, 6);
  assert.equal(f.player.getInventory().getAmount(item("Uncut diamond")), 1, `the real Thieving picks it: ${f.messages}`);
  assert.ok(done(f, "pickpocket-a-diamond-from-a-tzhaar"));
});

test("shortcut: an agility shortcut crossed, by its name (Take a Shortcut Across the Shilo Village River)", async (t) => {
  core.RegionManager.loadMapFiles(2863, 2971);
  const f = pactsCharacter(t);
  f.player.setAttribute("league:areas", [21, 2]); // Varlamore and Karamja
  f.player.moveTo(new core.Location(2863, 2971, 0)); // the south bank
  f.player.needsPlacement = false;
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.AGILITY, 99);
  skills.setCurrentLevel(core.Skill.AGILITY, 99);
  await send(f, { type: "object_option", id: 16466, x: 2863, y: 2974, action: "Cross" }, 16);
  assert.equal(f.player.getLocation().getY(), 2976, `the real shortcut crosses the river: ${f.messages}`);
  assert.ok(done(f, "take-a-shortcut-across-the-shilo-village-river"));
});

test("deed: a plugin's own event of the deed (Worship the Ectofuntus; Fill a Large Pouch, not a medium one)", async (t) => {
  core.RegionManager.loadMapFiles(3658, 3517);
  const ecto = pactsCharacter(t);
  ecto.player.setAttribute("league:areas", [21, 5]); // Varlamore and Morytania
  ecto.player.moveTo(new core.Location(3658, 3517, 0)); // south of the Ectofuntus
  ecto.player.needsPlacement = false;
  ecto.player.getInventory().add(new core.Item(item("Bucket of slime")), true);
  ecto.player.getInventory().add(new core.Item(item("Bonemeal")), true);
  await send(ecto, { type: "object_option", id: 16648, x: 3658, y: 3518, action: "Worship" }, 6);
  assert.equal(ecto.player.getInventory().getAmount(item("Bucket of slime")), 0, `the real Ectofuntus takes the slime: ${ecto.messages}`);
  assert.ok(done(ecto, "worship-the-ectofuntus"));

  const rc = pactsCharacter(t);
  const skills = rc.player.getSkillManager();
  skills.setMaxLevel(core.Skill.RUNECRAFTING, 99);
  skills.setCurrentLevel(core.Skill.RUNECRAFTING, 99);
  rc.player.getInventory().add(new core.Item(item("Medium pouch")), true);
  rc.player.getInventory().add(new core.Item(item("Large pouch")), true);
  rc.player.getInventory().add(new core.Item(item("Pure essence"), 20), true);
  await inventoryOption(rc, "Medium pouch", "Fill");
  assert.ok(!done(rc, "fill-a-large-pouch"), "a medium pouch is no large one");
  await inventoryOption(rc, "Large pouch", "Fill");
  assert.ok(rc.player.getInventory().getAmount(item("Pure essence")) < 20 - 6, `the real pouches take the essence: ${rc.messages}`);
  assert.ok(done(rc, "fill-a-large-pouch"));
});

test("deed: the heart invigorated, darts loaded, the looting bag opened, a prayer scroll read", async (t) => {
  const f = pactsCharacter(t);
  const inventory = f.player.getInventory();
  inventory.add(new core.Item(item("Imbued heart")), true);
  await inventoryOption(f, "Imbued heart", "Invigorate");
  assert.ok(f.player.getSkillManager().getCurrentLevel(core.Skill.MAGIC) > f.player.getSkillManager().getMaxLevel(core.Skill.MAGIC), `the real heart boosts Magic: ${f.messages}`);
  assert.ok(done(f, "activate-an-imbued-heart"));

  inventory.add(new core.Item(item("Toxic blowpipe")), true);
  inventory.add(new core.Item(item("Mithril dart"), 10), true);
  inventory.add(new core.Item(item("Rune dart"), 10), true);
  const useOn = (dart) => send(f, { type: "inventory_use_on", itemId: item(dart), slot: inventory.getSlotForItemId(item(dart)), target: { kind: "inventory", slot: inventory.getSlotForItemId(item("Toxic blowpipe")) } }, 2);
  await useOn("Mithril dart");
  assert.ok(f.messages.some((text) => /You load 10 mithril dart/i.test(text)), `the real blowpipe loads them: ${f.messages}`);
  assert.ok(!done(f, "load-a-blowpipe-with-rune-darts"), "mithril darts are no rune darts");
  await useOn("Rune dart");
  assert.ok(done(f, "load-a-blowpipe-with-rune-darts"), `rune darts loaded: ${f.messages}`);

  inventory.add(new core.Item(item("Looting bag")), true);
  await inventoryOption(f, "Looting bag", "Open");
  assert.ok(done(f, "open-a-looting-bag"), `the real bag opens: ${f.messages}`);

  inventory.add(new core.Item(item("Arcane prayer scroll")), true);
  await inventoryOption(f, "Arcane prayer scroll", "Read");
  await send(f, { type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: 1 }, 2);
  assert.equal(inventory.getAmount(item("Arcane prayer scroll")), 0, `the real scroll is read: ${f.messages}`);
  assert.ok(done(f, "activate-an-arcane-or-dexterous-prayer-scroll"));
});

test("deed: the Lunar spellbook switched to at an altar, the run turned off from the orb", async (t) => {
  core.RegionManager.loadMapFiles(1666, 3136);
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.DEFENCE, 40);
  skills.setCurrentLevel(core.Skill.DEFENCE, 40);
  const altar = new core.GameObject(core.ObjectIdentifiers.ALTAR_OF_THE_OCCULT, new core.Location(1667, 3136, 0), 10, 0, null);
  core.ObjectManager.register(altar, true);
  t.after(() => core.ObjectManager.deregister(altar, true));
  await send(f, { type: "object_option", id: altar.getId(), x: 1667, y: 3136, action: "Ancient" }, 4);
  assert.ok(!done(f, "switch-to-the-lunar-spellbook"), `the Ancient book is no Lunar one: ${f.messages}`);
  await send(f, { type: "object_option", id: altar.getId(), x: 1667, y: 3136, action: "Lunar" }, 4);
  assert.equal(f.player.getSpellbook(), core.MagicSpellbook.LUNAR, `the real altar switches the book: ${f.messages}`);
  assert.ok(done(f, "switch-to-the-lunar-spellbook"));

  f.player.setRunning(false);
  f.player.setRunEnergy?.(10000);
  await send(f, { type: "varp_transmit", varpId: 173, value: 1 }, 1);
  assert.ok(f.player.isRunningReturn() && !done(f, "turn-off-your-run"), "turned on is no turning off");
  await send(f, { type: "varp_transmit", varpId: 173, value: 0 }, 1);
  assert.ok(!f.player.isRunningReturn(), "the real toggle turns it off");
  assert.ok(done(f, "turn-off-your-run"));
});

test("deed: a special attack performed, by its weapon (the Dragon Axe's Lumber Up); a cannon set up", async (t) => {
  core.RegionManager.loadMapFiles(1666, 3136);
  const f = pactsCharacter(t);
  f.player.getSkillManager().setMaxLevel(core.Skill.ATTACK, 60);
  f.player.getSkillManager().setCurrentLevel(core.Skill.ATTACK, 60);
  f.player.getInventory().add(new core.Item(item("Dragon axe")), true);
  await inventoryOption(f, "Dragon axe", "Wield", 2);
  assert.equal(f.player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(), item("Dragon axe"), `the real equipment wields it: ${f.messages}`);
  await send(f, { type: "varp_transmit", varpId: 301, value: 1 }, 2);
  assert.ok(f.player.getSpecialPercentage() < 100, `the real special spends its energy: ${f.messages}`);
  assert.ok(done(f, "use-the-special-attack-of-a-dragon-axe") && done(f, "perform-a-special-attack"));

  const gunner = pactsCharacter(t);
  for (const part of ["Cannon base", "Cannon stand", "Cannon barrels", "Cannon furnace"]) gunner.player.getInventory().add(new core.Item(item(part)), true);
  await inventoryOption(gunner, "Cannon base", "Set-up", 1, 12);
  assert.ok(gunner.player.getInventory().getAmount(item("Cannon furnace")) === 0, `the real set-up uses every part: ${gunner.messages}`);
  assert.ok(done(gunner, "set-up-a-dwarf-cannon"));
});

test("deed: a weed raked from a flower patch (Rake a Flower Patch), not from an allotment", async (t) => {
  const { CACHE } = require("../plugins/skills/farming/Data.Farming");
  const rakeAt = async (type) => {
    // The Civitas illa Fortis patches, an open walk away.
    const patch = CACHE.patches.find((each) => each.type === type && each.x === 1585);
    core.RegionManager.loadMapFiles(patch.x, patch.y);
    const f = pactsCharacter(t, [1592, 3096, 0]);
    f.player.setAttribute("league:areas", [21, 1, 2, 3, 4, 5, 6, 7, 8, 11, 20]);
    f.player.getInventory().add(new core.Item(item("Rake")), true);
    await send(f, { type: "object_option", id: patch.id, x: patch.x, y: patch.y, action: "Rake" }, 12);
    return f;
  };
  const allotment = await rakeAt("ALLOTMENT");
  assert.ok(allotment.player.getInventory().getAmount(item("Weeds")) > 0, `the real rake weeds it: ${allotment.messages}`);
  assert.ok(!done(allotment, "rake-a-flower-patch"));
  const flower = await rakeAt("FLOWER");
  assert.ok(flower.player.getInventory().getAmount(item("Weeds")) > 0, `the real rake weeds it: ${flower.messages}`);
  assert.ok(done(flower, "rake-a-flower-patch"));
});

test("deed: a bucket filled from a compost bin of supercompost (Fill a Bucket With Supercompost)", async (t) => {
  const { CACHE } = require("../plugins/skills/farming/Data.Farming");
  const Patches = require("../plugins/skills/farming/Patches.Farming");
  const bin = CACHE.patches.find((each) => each.type === "COMPOST" && each.x === 3056); // Falador's
  core.RegionManager.loadMapFiles(bin.x, bin.y);
  const f = pactsCharacter(t);
  f.player.setAttribute("league:areas", [21, 3]); // Varlamore and Asgarnia
  f.player.moveTo(new core.Location(bin.x - 1, bin.y, bin.z));
  f.player.needsPlacement = false;
  // A bin rotted to supercompost and opened, as the bin's own state keeps it.
  Patches.stateFor(f.player, bin).bin = { count: 3, super: 3, tomatoes: 0, tier: 2, closedAt: 1, open: true };
  Patches.syncPatch(f.player, bin);
  f.player.getInventory().add(new core.Item(item("Bucket")), true);
  await send(f, { type: "object_option", id: bin.id, x: bin.x, y: bin.y, action: "Take" }, 2);
  for (let i = 0; i < 4; i++) Patches.tick();
  assert.equal(f.player.getInventory().getAmount(item("Supercompost")), 1, `the real bin fills the bucket: ${f.messages}`);
  assert.ok(done(f, "fill-a-bucket-with-supercompost"));
});

/** A cache NPC of the name with the option, beside the player; the option's click. */
function npcBeside(t, f, name, option) {
  const id = [...Array(20000).keys()].find((each) => core.CacheDefinitions.getNpc(each)?.name === name && (core.CacheDefinitions.getNpc(each).actions ?? []).some((action) => action?.toLowerCase() === option));
  const at = f.player.getLocation();
  const npc = core.NPC.create(id, new core.Location(at.getX() + 1, at.getY(), at.getZ()));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  return { npc, clickType: npc.getCurrentDefinition(f.player).getActions().findIndex((action) => action?.toLowerCase() === option) + 1 };
}

test("npc-op: an NPC's option that something answered (Talk to a Gladiator); one nothing answers is none", async (t) => {
  core.RegionManager.loadMapFiles(1666, 3136);
  const f = pactsCharacter(t);
  const gladiator = npcBeside(t, f, "Gladiator", "talk-to");
  await send(f, { type: "npc_option", index: gladiator.npc.getIndex(), clickType: gladiator.clickType }, 4);
  assert.ok(f.player.getDialogueManager().isActive(), `the real Talk-to starts the Wiki's dialogue: ${f.messages}`);
  assert.ok(done(f, "talk-to-a-gladiator"));
  // Renu's Pet has no handler on this server yet: "Nothing interesting happens" is no pet.
  const other = pactsCharacter(t);
  const renu = npcBeside(t, other, "Renu", "pet");
  await send(other, { type: "npc_option", index: renu.npc.getIndex(), clickType: renu.clickType }, 4);
  assert.ok(other.messages.includes("Nothing interesting happens."), `nothing answers: ${other.messages}`);
  assert.ok(!done(other, "pet-renu"));
});

test("kill-each: one death of each NPC, in the task's area (Defeat a Moss, Fire & Hill Giant in Kourend)", (t) => {
  const f = pactsCharacter(t);
  f.player.setAttribute("league:areas", [21, 2, 20]); // Varlamore, Karamja and Kourend unlocked
  f.player.moveTo(new core.Location(1640, 3670, 0)); // Kourend Castle's grounds
  f.player.needsPlacement = false;
  kill(f, "Moss giant");
  kill(f, "Moss giant");
  kill(f, "Fire giant");
  assert.ok(!done(f, "defeat-a-moss-fire-and-hill-giant-in-kourend"), "no Hill Giant yet");
  assert.deepEqual(f.player.getAttribute("league:task-kills")["defeat-a-moss-fire-and-hill-giant-in-kourend"], { "Moss giant": 1, "Fire giant": 1 });
  kill(f, "Hill Giant");
  assert.ok(done(f, "defeat-a-moss-fire-and-hill-giant-in-kourend"));
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

test("alch: an alchemy paying at least the coins (Convert an item into at least 500 coins)", async (t) => {
  const f = pactsCharacter(t);
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.MAGIC, 99);
  skills.setCurrentLevel(core.Skill.MAGIC, 99);
  const inventory = f.player.getInventory();
  inventory.add(new core.Item(item("Nature rune"), 2), true);
  inventory.add(new core.Item(item("Fire rune"), 10), true);
  const spell = core.CacheDefinitions.getSpellByName("High Level Alchemy");
  const { MagicOnItemPacketListener } = require("../dist/net/packet/impl/MagicOnItemPacketListener");
  const alch = async (name) => {
    f.player.setAttribute(MagicOnItemPacketListener.ALCH_NEXT_CAST_ATTRIBUTE, 0); // the last cast's delay over
    inventory.add(new core.Item(item(name)), true);
    await send(f, { type: "widget_target", sourceWidgetId: spell.widgetId, sourceItemId: spell.itemId, sourceSlot: -1, targetWidgetId: 149 << 16, targetItemId: item(name), targetSlot: inventory.getSlotForItemId(item(name)) }, 6);
  };
  await alch("Bronze dagger");
  assert.ok(inventory.getAmount(core.ItemIdentifiers.COINS) > 0, `the real alchemy pays: ${f.messages}`);
  assert.ok(!done(f, "convert-an-item-into-at-least-500-coins"), "a bronze dagger is worth less");
  await alch("Rune dagger");
  assert.ok(done(f, "convert-an-item-into-at-least-500-coins"), `a rune dagger is not: ${inventory.getAmount(core.ItemIdentifiers.COINS)} coins`);
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
  assert.ok(done(f, "5-collection-log-slots"), "five of the whole log too");
  assert.ok(!done(f, "15-collection-log-slots"));
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

// A successful felling action without its resource must not increment log-production tasks.
// These are real native Yew chops through the existing league character fixture, not
// hand-emitted woodcutting events or calls to the league consumer helper.
for (const row of [
  {name:"kept log",draw:0.2,logs:1,progress:1},
  {name:"omitted log",draw:0.199999,logs:0,progress:0},
]) {
  test("native felling yield and league production: "+row.name, async t => {
    // Demonic Pacts starts in Varlamore; Lumbridge is locked Misthalin in this league.
    const at=[1666,3136,0],f=pactsCharacter(t,at),ids=core.ItemIdentifiers,skill=core.Skill.WOODCUTTING;
    const position=()=>[f.player.getLocation().getX(),f.player.getLocation().getY(),f.player.getLocation().getZ()];
    assert.deepEqual(position(),at,"the native fixture must actually remain in its permitted area: "+JSON.stringify(f.messages));
    const skills=f.player.getSkillManager();
    skills.setMaxLevel(skill,99);
    skills.setCurrentLevel(skill,99);
    f.player.getInventory().add(new core.Item(ids.RUNE_FELLING_AXE),true);
    f.player.getInventory().add(new core.Item(ids.FORESTERS_RATION,2),true);
    core.RegionManager.loadMapFiles(at[0],at[1]);
    // The first display-name YEW_TREE is a POH decoration; use the wild tree's cache name.
    const yew=core.CacheDefinitions.getLocId("yewtree");
    assert.ok(Number.isInteger(yew),"the active cache must contain the named wild Yew tree");
    const tree=new core.GameObject(yew,new core.Location(at[0]+1,at[1],at[2]),10,0,null);
    core.ObjectManager.register(tree,true);
    t.after(()=>core.ObjectManager.deregister(tree,true));
    let observing=true,petRolls=0;
    const actions=[],xp=[],add=skills.addExperiences.bind(skills);
    t.mock.method(skills,"addExperiences",(which,amount)=>{
      if(which===skill) xp.push(amount);
      return add(which,amount);
    });
    const observer=PM.createApi("FellingLeagueObserve"+f.player.getIndex());
    observer.onCustomEvent("woodcutting:success",e=>{if(observing&&e.player===f.player)actions.push({logId:e.logId,logAmount:e.logAmount});});
    observer.onCustomEvent("pets:skilling-roll",e=>{if(observing&&e.player===f.player)petRolls++;});
    t.after(()=>{observing=false;});
    t.mock.method(Math,"random",()=>{
      const stack=new Error().stack;
      if(stack.includes("maybeDropBirdNest")) return 0.99;
      if(stack.includes("fellingChop")) return row.draw;
      return 0;
    });
    const definition=core.ObjectDefinition.forPlayer(tree.getId(),f.player);
    assert.ok(definition,"the actual per-player Yew definition must be present");
    assert.equal(definition.getName(),"Yew tree");
    assert.ok(definition.getActions()?.includes("Chop down"),"the actual Yew definition must expose the native action");
    assert.deepEqual(position(),at,"the actor must still be adjacent before native dispatch");
    await f.connection.dispatch([{type:"object_option",id:tree.getId(),x:at[0]+1,y:at[1],action:"Chop down"}]);
    f.connection.processTurnPackets();
    // Stop observation at the first actual successful action; no synthetic stop/success hook.
    for(let i=0;i<32&&actions.length===0;i++) await ticks(f,1);
    assert.equal(actions.length,1,"one actual Yew chop must complete before yield assertions: "+JSON.stringify({position:position(),messages:f.messages,xp,actions}));

    const floor=core.World.getItems().filter(g=>g.getItem().getId()===ids.YEW_LOGS&&g.getOwner()===f.player.getUsername());
    t.after(()=>{for(const g of floor)core.ItemOnGroundManager.deregister(g);});
    assert.equal(f.player.getInventory().getAmount(ids.YEW_LOGS)+floor.reduce((n,g)=>n+g.getItem().getAmount(),0),row.logs);
    const progress=f.player.getAttribute("league:task-progress")??{};
    assert.equal(progress["chop-100-yew-logs"]??0,row.progress,"the actual produce-count task only advances for its log");
    assert.deepEqual(xp,[192.5],"literal 175 x1.1 Yew XP before normal server/league scaling");
    assert.equal(petRolls,1,"both kept and omitted logs retain the genuine pet opportunity");
    assert.equal(f.player.getInventory().getAmount(ids.FORESTERS_RATION),1,"one completed chop spends one ration");
    assert.deepEqual(actions,[{logId:ids.YEW_LOGS,logAmount:row.logs}],"one real chop reports its actual felling yield");
  });
}
