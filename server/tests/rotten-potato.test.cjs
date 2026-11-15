// Run after `yarn build`: node --test tests/rotten-potato.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const RottenPotato = require("../plugins/items/RottenPotato.plugin");
const Rares = require("../plugins/items/rottenpotato/Rares.RottenPotato");

let core;
const actions = {};
const uses = {};
const tasks = [];
const events = [];
const grounds = [];
const spawned = [];
let worldPlayers = [];
let responders = {};
let map = { blocked: new Set(), water: new Set(), objects: [] };
const tileKey = (x, y) => `${x},${y}`;
const isBlocked = (x, y) => map.blocked.has(tileKey(x, y));

/** Scenery for the test map: `type` 10 stands in the middle of its tile(s), 22 is ground decoration. */
function scenery(name, x, y, { type = 10, sizeX = 1, sizeY = 1, blocks = true } = {}) {
  const object = {
    getType: () => type,
    getFace: () => 0,
    getLocation: () => new core.Location(x, y, 0),
    getPrivateArea: () => null,
    getDefinition: () => ({ getName: () => name, getSizeX: () => sizeX, getSizeY: () => sizeY }),
  };
  map.objects.push(object);
  if (blocks) for (let dx = 0; dx < sizeX; dx++) for (let dy = 0; dy < sizeY; dy++) map.blocked.add(tileKey(x + dx, y + dy));
  return object;
}

before(async () => {
  await CachePipeline.initialize();
  const real = PluginManager.getCoreApi();
  core = {
    ...real,
    TaskManager: { submit: (task) => tasks.push(task), cancelTasks() {} },
    WeaponInterfaceManager: { assign() {} },
    ItemOnGroundManager: { register: (item) => grounds.push(item) },
    // A test map: `map.blocked` tiles (trees, walls, tables) can't be stood on, `map.water` is water,
    // `map.objects` are scenery by tile. A diagonal step needs both of its sides open, as in the game.
    RegionManager: {
      canMove: (x, y, nx, ny) => !isBlocked(nx, ny) && (x === nx || y === ny || (!isBlocked(nx, y) && !isBlocked(x, ny))),
      blocked: (location) => isBlocked(location.getX(), location.getY()),
      isWater: (location) => map.water.has(tileKey(location.getX(), location.getY())),
    },
    MapObjects: { getObjectsAt: (location) => map.objects.filter((object) => object.getLocation().equals(location)) },
    ObjectManager: { objectsAt: () => [] },
    World: {
      getPlayerByName: (name) => worldPlayers.find((p) => p.getUsername() === name) ?? null,
      forEachNetworkPlayer: (visit) => worldPlayers.forEach(visit),
      getItems: () => grounds,
    },
  };
  RottenPotato.register({
    core,
    onItemAction(name, handlers) {
      assert.equal(name, "Rotten potato");
      Object.assign(actions, handlers);
    },
    onItemOnItem: (handler) => { uses.item = handler; },
    onItemOnObject: (handler) => { uses.object = handler; },
    onItemOnPlayer: (handler) => { uses.player = handler; },
    emitCustomEvent(name, request) {
      events.push({ name, request });
      responders[name]?.(request);
    },
    spawnNpc(definition) {
      const npc = { definition, hp: 0, attacked: null, getHitpoints() { return this.hp; }, setHitpoints(v) { this.hp = v; }, getCombat: () => ({ attack: (target) => { npc.attacked = target; } }) };
      spawned.push(npc);
      return npc;
    },
    getRegionManager: () => ({ blocked: () => false }),
  });
});

beforeEach(() => {
  tasks.length = 0;
  events.length = 0;
  grounds.length = 0;
  spawned.length = 0;
  worldPlayers = [];
  responders = {};
  map = { blocked: new Set(), water: new Set(), objects: [] };
});

const id = (name) => core.ItemIdentifiers[name];

function createPlayer({ name = "tester", rights = "OWNER", at = new core.Location(3222, 3218, 0) } = {}) {
  const messages = [];
  const slots = Array.from({ length: 28 }, () => null);
  const levels = new Map();
  let location = at;
  let menu = null;
  let prompt = null;
  const player = {
    messages, slots, levels,
    hp: 99, transformation: -1, loggedOut: false, bankOpened: false,
    get menu() { return menu; },
    get prompt() { return prompt; },
    give(slot, itemId, amount = 1) { slots[slot] = new core.Item(itemId, amount); return slots[slot]; },
    getRights: () => core.PlayerRights[rights],
    getUsername: () => name,
    getDisplayName: () => name,
    isRegistered: () => true,
    sendMessage: (text) => messages.push(text),
    getLocation: () => location,
    moveTo: (to) => { location = to; },
    getPrivateArea: () => null,
    setHitpoints(value) { this.hp = value; },
    getHitpoints() { return this.hp; },
    performAnimation() {},
    setNpcTransformationId(value) { this.transformation = value; },
    requestLogout() { this.loggedOut = true; },
    getCurrentBankTab: () => 0,
    getBank: () => ({ open: () => { player.bankOpened = true; } }),
    getUpdateFlag: () => ({ flag() {} }),
    getDialogueManager: () => ({
      startDialogues(chain) { menu = [...chain.getDialogues().values()][0]; },
      reset() { menu = null; },
    }),
    setEnteredAmountAction(action) { prompt = action; },
    setEnteredSyntaxAction(action) { prompt = action; },
    chatbox: [],
    getPacketSender: () => ({
      sendEnterAmountPrompt(text) { player.promptText = text; player.chatbox.push("prompt"); },
      sendEnterInputPrompt(text) { player.promptText = text; player.chatbox.push("prompt"); },
      sendInterfaceRemoval() { player.chatbox.push("close"); },
    }),
    getSkillManager: () => {
      const manager = {
        setCurrentLevels: (skill, level) => { levels.set(skill, level); return manager; },
        setMaxLevel: () => manager,
        setExperience: () => manager,
      };
      return manager;
    },
    getInventory: () => ({
      getItems: () => slots,
      deleteAtSlot(slot) { slots[slot] = null; },
      refreshItems() {},
    }),
  };
  return player;
}

/** Chooses `label` in the player's open menu, turning pages with "More..." as needed. */
function choose(player, label) {
  for (let page = 0; page < 10; page++) {
    const options = player.menu?.getOptions();
    assert.ok(options, `a menu is open to choose "${label}" from`);
    const index = options.indexOf(label);
    if (index >= 0) return player.menu.execute(index + 1);
    assert.ok(options.includes("More..."), `"${label}" is in the menu: ${options.join(" | ")}`);
    player.menu.execute(options.indexOf("More...") + 1);
  }
  assert.fail(`never found "${label}"`);
}

function runTask(task) {
  task.running = true;
  for (let i = 0; i < 100 && task.isRunning(); i++) task.execute();
}

test("players below owner are refused by every option and use", () => {
  const player = createPlayer({ rights: "ADMINISTRATOR" });
  for (const option of ["Eat", "Slice", "Peel", "Mash"]) actions[option]({ player });
  assert.equal(player.menu, null);
  assert.deepEqual(player.messages, Array(4).fill("Nothing interesting happens."));
  const whip = player.give(1, id("ABYSSAL_WHIP"));
  const potato = player.give(0, id("ROTTEN_POTATO"));
  const event = { player, usedItem: whip, usedItemId: whip.getId(), usedItemSlot: 1, usedWithItem: potato, usedWithItemId: potato.getId(), usedWithItemSlot: 0, handled: false };
  uses.item(event);
  assert.equal(event.handled, false);
  assert.ok(player.slots[1], "the whip is kept");
});

test("each option opens its Wiki menu", () => {
  const player = createPlayer();
  const expected = {
    Eat: ["Set all stats", "Wipe inventory", "Setup POH", "Teleport to player", "Spawn aggressive NPC"],
    Peel: ["Bank menu", "AMEs for all!", "Teleport to RARE!", "Spawn RARE!"],
    Mash: ["Keep me logged in.", "Kick me out.", "Kill me.", "Transmogrify me..."],
  };
  for (const [option, labels] of Object.entries(expected)) {
    actions[option]({ player });
    assert.deepEqual(player.menu.getOptions(), labels);
    assert.equal(player.menu.getTitle(), option);
  }
});

test("Set all stats sets one skill a tick in the Wiki's order, then finishes cheating", () => {
  const player = createPlayer();
  actions.Eat({ player });
  choose(player, "Set all stats");
  assert.equal(player.promptText, "Enter a level:");
  player.prompt.execute(99);
  assert.equal(tasks.length, 1);
  runTask(tasks[0]);
  assert.equal(player.messages[0], "setstat attack 99");
  assert.equal(player.messages[1], "setstat strength 99");
  assert.equal(player.messages.at(-2), "setstat hitpoints 99");
  assert.equal(player.messages.at(-1), "... finished cheating.");
  assert.equal(player.levels.get(core.Skill.SAILING), 99);
  assert.equal(player.levels.size, 24);
});

test("Set all stats keeps Hitpoints at 10 or more and refuses levels out of range", () => {
  const player = createPlayer();
  actions.Eat({ player });
  choose(player, "Set all stats");
  player.prompt.execute(100);
  assert.equal(tasks.length, 0);
  assert.equal(player.messages.at(-1), "Enter a level from 1 to 99.");
  actions.Eat({ player });
  choose(player, "Set all stats");
  player.prompt.execute(1);
  runTask(tasks[0]);
  assert.equal(player.levels.get(core.Skill.ATTACK), 1);
  assert.equal(player.levels.get(core.Skill.HITPOINTS), 10);
});

test("Wipe inventory keeps only the potato", () => {
  const player = createPlayer();
  player.give(0, id("COINS"), 500);
  player.give(3, id("ROTTEN_POTATO"));
  player.give(27, id("ABYSSAL_WHIP"));
  actions.Eat({ player });
  choose(player, "Wipe inventory");
  assert.deepEqual(player.slots.map((item, slot) => (item ? slot : null)).filter((slot) => slot !== null), [3]);
  assert.equal(player.slots[3].getId(), id("ROTTEN_POTATO"));
});

test("Setup POH asks Construction for a random house", () => {
  const player = createPlayer();
  actions.Eat({ player });
  choose(player, "Setup POH");
  assert.equal(events.at(-1).name, "construction:random-house");
  assert.equal(player.messages.at(-1), "Your house couldn't be set up.");
  responders["construction:random-house"] = (request) => { request.handled = true; };
  actions.Eat({ player });
  choose(player, "Setup POH");
  assert.equal(player.messages.length, 1);
});

test("Teleport to player moves to an online player by name", () => {
  const player = createPlayer();
  const other = createPlayer({ name: "friend", at: new core.Location(3093, 3493, 0) });
  worldPlayers = [player, other];
  actions.Eat({ player });
  choose(player, "Teleport to player");
  player.prompt.execute("Friend");
  assert.equal(player.getLocation().getX(), 3093);
  actions.Eat({ player });
  choose(player, "Teleport to player");
  player.prompt.execute("nobody");
  assert.equal(player.messages.at(-1), "nobody is not online.");
});

test("Spawn aggressive NPC spawns a cache NPC beside the player that attacks them", () => {
  const player = createPlayer();
  actions.Eat({ player });
  choose(player, "Spawn aggressive NPC");
  player.prompt.execute(core.NpcIdentifiers.GOBLIN);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].attacked, player);
  assert.ok(spawned[0].getHitpoints() > 0);
  const { x, y } = spawned[0].definition;
  assert.equal(Math.max(Math.abs(x - 3222), Math.abs(y - 3218)), 1);
  actions.Eat({ player });
  choose(player, "Spawn aggressive NPC");
  player.prompt.execute(-5);
  assert.equal(spawned.length, 1);
  assert.equal(player.messages.at(-1), "There is no NPC -5.");
});

test("Spawn aggressive NPC refuses an NPC with no Attack option", () => {
  const player = createPlayer();
  assert.ok(!(core.CacheDefinitions.getNpc(core.NpcIdentifiers.MAN).actions ?? []).includes("Attack"), "this Man is Talk-to only");
  actions.Eat({ player });
  choose(player, "Spawn aggressive NPC");
  player.prompt.execute(core.NpcIdentifiers.MAN);
  assert.equal(spawned.length, 0);
  assert.equal(player.messages.at(-1), "The Man can't fight.");
});

test("Slice lists the random events in pages and starts the chosen one on the player", () => {
  const player = createPlayer();
  const names = ["Genie", "Sandwich lady", "Drunken Dwarf", "Rick Turpentine", "Niles", "Mysterious Old Man"];
  responders["random-events:list"] = (request) => names.forEach((name, index) => request.events.push({ index, name }));
  responders["random-events:start"] = (request) => { request.result = "started"; };
  actions.Slice({ player });
  assert.equal(player.menu.getTitle(), "Anti-macro events");
  assert.deepEqual(player.menu.getOptions(), ["Genie", "Sandwich lady", "Drunken Dwarf", "Rick Turpentine", "More..."]);
  choose(player, "Mysterious Old Man");
  const start = events.find((event) => event.name === "random-events:start");
  assert.equal(start.request.player, player);
  assert.equal(start.request.index, 5);
  assert.equal(player.messages.at(-1), "Mysterious Old Man has been summoned.");
});

test("AMEs for all! starts the event on every player in view", () => {
  const player = createPlayer();
  const near = createPlayer({ name: "near", at: new core.Location(3225, 3218, 0) });
  const far = createPlayer({ name: "far", at: new core.Location(3093, 3493, 0) });
  worldPlayers = [player, near, far];
  responders["random-events:list"] = (request) => request.events.push({ index: 0, name: "Genie" });
  responders["random-events:start"] = (request) => { request.result = "started"; };
  actions.Peel({ player });
  choose(player, "AMEs for all!");
  choose(player, "Genie");
  const targets = events.filter((event) => event.name === "random-events:start").map((event) => event.request.player);
  assert.deepEqual(targets, [player, near]);
  assert.equal(player.messages.at(-1), "Genie has been summoned for 2 of 2 nearby players.");
});

test("Spawn RARE! drops a rare near the player and Teleport to RARE! finds it", () => {
  const player = createPlayer();
  actions.Peel({ player });
  choose(player, "Teleport to RARE!");
  assert.equal(player.messages.at(-1), "There are no rares on the ground.");
  actions.Peel({ player });
  choose(player, "Spawn RARE!");
  assert.equal(grounds.length, 1);
  const rare = grounds[0];
  assert.match(core.CacheDefinitions.getItem(rare.getItem().getId()).name, /partyhat|mask|Santa|cracker|Pumpkin|egg|Disk|wine/i);
  assert.equal(rare.getState(), core.GroundItemState.SEEN_BY_EVERYONE);
  const far = createPlayer({ name: "far", at: new core.Location(3093, 3493, 0) });
  actions.Peel({ player: far });
  choose(far, "Teleport to RARE!");
  assert.equal(far.getLocation().getX(), rare.getPosition().getX());
  assert.equal(far.getLocation().getY(), rare.getPosition().getY());
});

const at = (location) => tileKey(location.getX(), location.getY());

test("rares land at random within 5 tiles, never on the player's own tile", () => {
  const player = createPlayer();
  const landed = new Set();
  for (let i = 0; i < 400; i++) {
    const tile = Rares.spawnRare(player).getPosition();
    assert.ok(Math.abs(tile.getX() - 3222) <= 5 && Math.abs(tile.getY() - 3218) <= 5, `within the square: ${at(tile)}`);
    assert.notEqual(at(tile), "3222,3218");
    landed.add(at(tile));
  }
  assert.ok(landed.size > 80, `spread over the square, not one tile: ${landed.size} tiles`);
});

test("rares never land on trees, water, or floor the player can't walk to", () => {
  const player = createPlayer();
  scenery("Tree", 3224, 3218);
  scenery("Oak tree", 3220, 3220, { sizeX: 2, sizeY: 2 });
  for (let x = 3218; x <= 3227; x++) map.water.add(tileKey(x, 3214));
  // A fenced pen to the north-east: open inside, but walled all round.
  for (let x = 3224; x <= 3227; x++) { map.blocked.add(tileKey(x, 3220)); map.blocked.add(tileKey(x, 3223)); }
  for (let y = 3220; y <= 3223; y++) { map.blocked.add(tileKey(3224, y)); map.blocked.add(tileKey(3227, y)); }
  scenery("Flowers", 3219, 3217, { type: 22, blocks: false });
  scenery("Crate", 3217, 3216, { blocks: false });
  const tiles = new Set(Rares.spawnTiles(player).map(at));
  for (const tree of ["3224,3218", "3220,3220", "3221,3221"]) assert.ok(!tiles.has(tree), `not on a tree: ${tree}`);
  for (let x = 3218; x <= 3227; x++) assert.ok(!tiles.has(tileKey(x, 3214)), "not in water");
  for (const pen of ["3225,3221", "3226,3222"]) assert.ok(!tiles.has(pen), `not in the closed pen: ${pen}`);
  assert.ok(!tiles.has("3217,3216"), "not on scenery standing on the tile");
  assert.ok(tiles.has("3219,3217"), "flowers are flat ground");
  assert.ok(tiles.has("3226,3218") && tiles.has("3218,3222"), "open floor round about");
});

test("rares can land on a table the player can reach, and Teleport to RARE! stands beside it", () => {
  const player = createPlayer();
  scenery("Table", 3224, 3219, { sizeX: 2 });
  // A table shut in behind walls is out of reach.
  for (const [x, y] of [[3218, 3222], [3218, 3224], [3217, 3223], [3219, 3223]]) map.blocked.add(tileKey(x, y));
  scenery("Long table", 3218, 3223);
  const tiles = new Set(Rares.spawnTiles(player).map(at));
  assert.ok(tiles.has("3224,3219") && tiles.has("3225,3219"), "both table tiles");
  assert.ok(!tiles.has("3218,3223"), "not the walled-in table");
  const onTable = { getPosition: () => new core.Location(3225, 3219, 0), getPrivateArea: () => null };
  const stand = Rares.standingTile(onTable);
  assert.ok(!isBlocked(stand.getX(), stand.getY()), "beside the table, not on it");
  assert.equal(Math.max(Math.abs(stand.getX() - 3225), Math.abs(stand.getY() - 3219)), 1);
});

test("a player boxed in by trees gets the rare on their own tile", () => {
  const player = createPlayer();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) map.blocked.add(tileKey(3222 + dx, 3218 + dy));
  assert.equal(at(Rares.spawnRare(player).getPosition()), "3222,3218");
});

test("a picked entry closes the chatbox, so it never stays on Please wait...", () => {
  const player = createPlayer();
  actions.Peel({ player });
  player.chatbox.length = 0;
  choose(player, "Teleport to RARE!");
  assert.deepEqual(player.chatbox, ["close"]);
  assert.equal(player.menu, null);
  actions.Eat({ player });
  player.chatbox.length = 0;
  choose(player, "Set all stats");
  assert.deepEqual(player.chatbox, ["close", "prompt"], "an entry with a prompt opens it after the close");
});

test("Spawn RARE! opens the Peel menu again, so it can be picked over and over", () => {
  const player = createPlayer();
  actions.Peel({ player });
  for (let spawn = 1; spawn <= 3; spawn++) {
    player.chatbox.length = 0;
    choose(player, "Spawn RARE!");
    assert.equal(grounds.length, spawn);
    assert.deepEqual(player.chatbox, ["close"], "the picked option's Please wait... goes");
    assert.equal(player.menu?.getTitle(), "Peel");
    assert.deepEqual(player.menu.getOptions(), ["Bank menu", "AMEs for all!", "Teleport to RARE!", "Spawn RARE!"]);
  }
});

test("Bank menu opens the bank", () => {
  const player = createPlayer();
  actions.Peel({ player });
  choose(player, "Bank menu");
  assert.equal(player.bankOpened, true);
});

test("Mash kicks, kills and transmogrifies", () => {
  const player = createPlayer();
  actions.Mash({ player });
  choose(player, "Keep me logged in.");
  assert.equal(player.messages.at(-1), "You will not be logged out for inactivity.");
  actions.Mash({ player });
  choose(player, "Kick me out.");
  assert.equal(player.loggedOut, true);
  actions.Mash({ player });
  choose(player, "Kill me.");
  assert.equal(player.hp, 0);
  actions.Mash({ player });
  choose(player, "Transmogrify me...");
  choose(player, "Into an NPC...");
  player.prompt.execute(core.NpcIdentifiers.MAN);
  assert.equal(player.transformation, core.NpcIdentifiers.MAN);
  actions.Mash({ player });
  choose(player, "Transmogrify me...");
  choose(player, "Back to normal.");
  assert.equal(player.transformation, -1);
});

test("an item used on the potato is deleted: Whee... [Item] All gone!", () => {
  const player = createPlayer();
  const potato = player.give(0, id("ROTTEN_POTATO"));
  const coins = player.give(5, id("COINS"), 1000);
  const event = { player, usedItem: coins, usedItemId: coins.getId(), usedItemSlot: 5, usedWithItem: potato, usedWithItemId: potato.getId(), usedWithItemSlot: 0, handled: false };
  uses.item(event);
  assert.equal(event.handled, true);
  assert.equal(player.slots[5], null);
  assert.ok(player.slots[0], "the potato stays");
  assert.equal(player.messages.at(-1), "Whee... Coins All gone!");
});

test("the potato on the party chest asks the Party Room for one of each colour hat", () => {
  const player = createPlayer();
  const event = { player, itemId: id("ROTTEN_POTATO"), objectId: 26193, handled: false };
  responders["party-room:fill-chest"] = (request) => { request.handled = true; request.result = { ok: true }; };
  uses.object(event);
  const fill = events.find((entry) => entry.name === "party-room:fill-chest").request;
  assert.deepEqual(fill.items.map((item) => item.id), ["RED_PARTYHAT", "YELLOW_PARTYHAT", "BLUE_PARTYHAT", "GREEN_PARTYHAT", "PURPLE_PARTYHAT", "WHITE_PARTYHAT"].map(id));
  assert.equal(event.handled, true);
  assert.equal(player.messages.at(-1), "The chest fills with party hats.");
  responders["party-room:fill-chest"] = () => {};
  const other = { player, itemId: id("ROTTEN_POTATO"), objectId: 1, handled: false };
  uses.object(other);
  assert.equal(other.handled, false);
});

test("the potato on a player lists their inventory", () => {
  const player = createPlayer();
  const target = createPlayer({ name: "target" });
  target.give(0, id("COINS"), 1500);
  target.give(1, id("SHARK"));
  target.give(2, id("SHARK"));
  const event = { player, target, itemId: id("ROTTEN_POTATO"), handled: false };
  uses.player(event);
  assert.equal(event.handled, true);
  assert.deepEqual(player.messages, ["target's inventory:", "1,500 x Coins", "2 x Shark"]);
});
