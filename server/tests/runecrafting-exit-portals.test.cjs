// Run after `yarn build`: node --test tests/runecrafting-exit-portals.test.cjs
// An altar's exit portal leads back outside its ruins, as rsprox captures show (docs/loc-teleports.md).
// Crafting at the altars: docs/runecrafting.md.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Item } = require("../dist/game/model/Item");
const ruinsData = require("../plugins/skills/data/runecrafting-ruins.json");
const handlers = {};
/** Tasks the plugin submits, run a tick at a time by `ticks`; custom events it emits. */
const tasks = [];
const emitted = [];
/** Whether the medium Ardougne Diary answers complete. */
let ardougneMedium = false;
function ticks(count = 1) {
  for (let tick = 0; tick < count; tick++) {
    for (const task of [...tasks]) task.tick();
    tasks.splice(0, tasks.length, ...tasks.filter((task) => task.isRunning()));
  }
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  const realApi = PluginManager.createApi("RunecraftingTest");
  const base = {
    ...realApi,
    // The tiaras' login sync registers first; the pouches' one comes after it.
    onPlayerLogin: (handler) => (handlers.login ??= handler),
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => {
      Object.entries(actions).forEach(([option, handler]) => (handlers[`${name}:${option}`] = handler));
      realApi.onObjectInteraction(name, actions);
    },
    onNpcInteraction: (name, actions) => Object.entries(actions).forEach(([option, handler]) => (handlers[`${name}:${option}`] = handler)),
    getTaskManager: () => ({ submit: (task) => { task.setRunning(true); tasks.push(task); } }),
    onPlayerDeath: (handler) => (handlers.death = handler),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      if (name === "diary:is-complete" && payload.diary === "ardougne" && payload.tier === "medium") payload.complete = ardougneMedium;
      if (payload.key === "mournings_end_part_ii" && Number.isInteger(payload.player?.mourningsEndPartIIStage)) {
        if (name === "quest:is-complete") payload.complete = payload.player.mourningsEndPartIIStage >= 60;
        if (name === "quest:get-stage") payload.stage = payload.player.mourningsEndPartIIStage;
      }
      return realApi.emitCustomEvent(name, payload);
    },
  };
  const api = new Proxy(base, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/skills/Runecrafting.plugin").register(api);
});

function visitor() {
  const log = [];
  return {
    log,
    moveTo: (location) => log.push(`move ${location.getX()},${location.getY()},${location.getZ()}`),
    sendMessage: (text) => log.push(`message ${text}`),
    getPacketSender: () => ({ sendSound: (id) => log.push(`sound ${id}`), sendTypedMessage: (_type, text) => log.push(`spam ${text}`) }),
  };
}

test("each altar's exit portal leads outside its ruins, with the portal's sound and message", () => {
  // Captured: earth, fire, water, nature, cosmic and blood; the rest from the ruins' tiles.
  const exits = { 43478: [3559, 9780], 34751: [3302, 3477], 34752: [3310, 3252], 34750: [3182, 3162], 34756: [2865, 3022], 34754: [2405, 4381],
    34748: [2983, 3288], 34749: [2980, 3511], 34753: [3050, 3442], 34755: [2858, 3378], 34757: [3060, 3585], 34758: [1863, 4639] };
  for (const [objectId, [x, y]] of Object.entries(exits)) {
    const player = visitor();
    assert.equal(handlers["Portal:Use"]({ player, objectId: Number(objectId) }), true);
    assert.deepEqual(player.log, [`move ${x},${y},0`, "sound 200", "spam You step through the portal..."], objectId);
  }
  assert.equal(handlers["Portal:Use"]({ player: visitor(), objectId: 12345 }), false, "other portals fall through");
});

function miner({ x = 2889, y = 4814, attributes = {}, land = true } = {}) {
  const log = [];
  const attrs = new Map(Object.entries(attributes));
  const { Location } = PluginManager.getCoreApi();
  let location = new Location(x, y, 0);
  const sender = {
    sendSound: (id) => log.push(`sound ${id}`),
    sendAreaSound: (id) => { log.push(`area sound ${id}`); return sender; },
    sendProjectile: (_from, _to, _offset, _speed, id) => log.push(`projectile ${id}`),
    sendTypedMessage: (_type, text) => log.push(`spam ${text}`),
    sendInterfaceRemoval() {},
  };
  return {
    log,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getLocation: () => location,
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {}, isMovementBlocked: () => false }),
    setUntargetable(value) { this.untargetable = value; },
    setTeleporting() {},
    dying: false,
    isDyingReturn() { return this.dying; },
    busy: () => false,
    getCombat: () => ({ getTeleblockTimer: () => ({ finished: () => true }) }),
    getArea: () => null,
    getWildernessLevel: () => 0,
    moveTo: (destination) => {
      log.push(`move ${destination.getX()},${destination.getY()},${destination.getZ()}`);
      if (land) location = destination;
    },
    sendMessage: (text) => log.push(`message ${text}`),
    performGraphic: (graphic) => log.push(`graphic ${graphic.getId()}`),
    getPacketSender: () => sender,
  };
}

test("the Rune Essence mine's portals send the player back to the wizard who sent them", () => {
  // Aubury's Teleport records where the player stood (Rune Mysteries complete).
  const visitor = miner({ x: 3253, y: 3402, attributes: { "quest.rune_mysteries.stage": 6 } });
  const { Location } = PluginManager.getCoreApi();
  const said = [];
  const aubury = {
    getLocation: () => new Location(3253, 3401, 0),
    forceChat: (text) => said.push(text),
    setPositionToFace() {},
    performGraphic: (graphic) => said.push(`graphic ${graphic.getId()}`),
  };
  emitted.length = 0;
  assert.equal(handlers["Aubury:Teleport"]({ player: visitor, npc: aubury }), true);
  assert.deepEqual(visitor.getAttribute("runecrafting:essence-mine-return"), [3253, 3402, 0]);
  assert.deepEqual(said, ["Senventior Disthine Molenko!", "graphic 108"], "the wizard says the line overhead and casts Curse");
  assert.equal(visitor.untargetable, true, "held as the core's teleports hold");
  ticks(3);
  assert.deepEqual(visitor.log, ["projectile 109", "graphic 110", "area sound 127", "area sound 126"], "the Curse on the click");
  ticks(1);
  assert.deepEqual(visitor.log.slice(4), ["move 2913,4832,0"], "as captured (1628, 2280): the landing four ticks later, no spellbook teleport");
  assert.equal(visitor.untargetable, false);
  const landed = emitted.filter(([name]) => name === "teleport:landed").map(([, payload]) => payload);
  assert.equal(landed.length, 1, "the landing is a teleport:landed, as the core's teleports (Last Recall remembers it)");
  assert.deepEqual([landed[0].from.getX(), landed[0].from.getY(), landed[0].from.getZ(), landed[0].fromInstance], [3253, 3402, 0, false]);

  const player = miner({ attributes: { "runecrafting:essence-mine-return": [2591, 3086, 0] } });
  assert.equal(handlers["Portal:Use"]({ player, objectId: 34825, location: { x: 2889, y: 4813, z: 0 } }), true);
  ticks(1);
  assert.deepEqual(player.log, [
    "spam You step through the portal...", "projectile 109", "graphic 110", "move 2591,3086,0", "sound 200",
  ], "as captured: message and the portal's Curse, then the teleport and sound");

  const unknown = miner();
  handlers["Portal:Use"]({ player: unknown, objectId: 34825, location: { x: 2933, y: 4815, z: 0 } });
  ticks(1);
  assert.ok(unknown.log.includes("move 3252,3400,0"), "nobody recorded: back beside Aubury");
});

test("a failed mine landing does not emit teleport completion", () => {
  const player = miner({ x: 2682, y: 3326, land: false, attributes: { "quest.rune_mysteries.stage": 6 } });
  const { Location } = PluginManager.getCoreApi();
  const cromperty = {
    getCurrentDefinition: () => ({ getName: () => "Wizard Cromperty" }),
    getLocation: () => new Location(2683, 3326, 0),
    forceChat() {},
    setPositionToFace() {},
    performGraphic() {},
  };
  emitted.length = 0;

  assert.equal(handlers["Wizard Cromperty:Teleport"]({ player, npc: cromperty }), true);
  ticks(4);

  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2682, 3326]);
  assert.ok(player.log.includes("move 2913,4832,0"), "the fixture records the attempted move");
  assert.equal(emitted.some(([name]) => name === "teleport:landed"), false);
  assert.equal(emitted.some(([name, event]) => name === "diary:task" && event.task === "have-wizard-cromperty-teleport-you-to-the-rune-e"), false);
});

// Wiki: talismans are used on ruins; a matching worn tiara reveals the Enter option.
function runecrafter(headId = -1) {
  const player = visitor();
  player.mourningsEndPartIIStage = 60;
  player.onEquipmentChanged = () => {};
  const bits = new Map();
  const equipment = new Equipment(player);
  equipment.setItem(Equipment.HEAD_SLOT, new Item(headId, headId === -1 ? 0 : 1));
  player.getEquipment = () => equipment;
  const attrs = new Map();
  player.getAttribute = (key) => attrs.get(key);
  player.setAttribute = (key, value) => attrs.set(key, value);
  player.getMovementQueue = () => ({ reset() {}, setBlockMovement() {} });
  player.performAnimation = (animation) => player.log.push(`animation ${animation.getId()}`);
  player.getPacketSender = () => ({
    getVarbit: (id) => bits.get(id) ?? 0,
    sendVarbit: (id, value) => { bits.set(id, value); player.log.push(`varbit ${id} ${value}`); },
    sendSound: (id) => player.log.push(`sound ${id}`),
    sendTypedMessage: (_type, text) => player.log.push(`spam ${text}`),
    sendItemContainer() {},
  });
  return player;
}

function useOnRuins(player, objectId, itemId) {
  return PluginManager.emitItemOnObject({
    player, objectId, itemId, handled: false,
    object: { getDefinition: () => ObjectDefinition.forId(objectId) },
  });
}

const entrances = {
  // Water, earth and fire land where rsprox captures do (90, 91, 1549, 1757, 1858).
  Air: [2841, 4829, 0], Mind: [2793, 4828, 0], Water: [2725, 4832, 0],
  Earth: [2657, 4830, 0], Fire: [2576, 4848, 0], Body: [2522, 4833, 0],
  Cosmic: [2162, 4833, 0], Law: [2464, 4818, 0], Nature: [2400, 4835, 0],
  Chaos: [2281, 4837, 0], Death: [2208, 4830, 0], Blood: [3239, 4832, 0], Wrath: [2335, 4826, 0],
};

test("all altar entrances use matching talismans on base and transformed cache locs", () => {
  for (const ruins of ruinsData) {
    const definition = CacheDefinitions.getObject(ruins.ruinsId);
    assert.equal(CacheDefinitions.getItem(ruins.talismanId).name, `${ruins.name} talisman`);
    assert.equal(CacheDefinitions.getItem(ruins.tiaraId).name, `${ruins.name} tiara`);
    assert.ok(definition.transformVarbit >= 0, ruins.name);
    for (const id of [ruins.ruinsId, ...definition.transforms.filter((id) => id !== -1)]) {
      const player = runecrafter();
      assert.equal(useOnRuins(player, id, ruins.talismanId), true, `${ruins.name} ${id}`);
      ticks(3);
      // As captured: a tick after the click the hold (human_pickupfloor, sound, line, busy), two later the teleport.
      const held = ruins.name === "Blood" ? "Blood Talisman" : `${ruins.name} talisman`;
      assert.deepEqual(player.log, [
        "animation 827", "sound 200",
        `spam You hold the ${held} towards the mysterious ruins.<br>You feel a powerful force take hold of you...`,
        "varbit 12393 1", "varbit 12393 0", `move ${entrances[ruins.name].join(",")}`,
      ]);
    }
    const player = runecrafter();
    const wrong = ruins.name === "Air" ? 1448 : 1438;
    assert.equal(useOnRuins(player, ruins.ruinsId, wrong), false, "wrong talisman");
    assert.equal(useOnRuins(player, ruins.ruinsId, CacheDefinitions.getItem(ruins.talismanId).note), false, "noted talisman");
    assert.equal(useOnRuins(player, ruins.ruinsId, ruins.tiaraId), false, "inventory tiara");
    assert.deepEqual(player.log, []);
  }
  assert.equal(useOnRuins(runecrafter(), 12345, 1438), false, "unrelated object");
});

test("tiaras reveal Enter on login, reset on removal, and are checked by the entry handler", () => {
  for (const ruins of ruinsData) {
    const player = runecrafter(ruins.tiaraId);
    const definition = CacheDefinitions.getObject(ruins.ruinsId);
    const sender = player.getPacketSender();
    handlers.login({ player });
    assert.equal(sender.getVarbit(definition.transformVarbit), 1);
    assert.equal(ObjectDefinition.forPlayer(ruins.ruinsId, player).getInteractions()[0], "Enter");
    player.log.length = 0;
    assert.equal(PluginManager.emitObjectInteraction({ player, object: { getDefinition: () => ObjectDefinition.forId(ruins.ruinsId) }, objectId: ruins.ruinsId, definition: ObjectDefinition.forPlayer(ruins.ruinsId, player), clickType: 1, handled: false }), true);
    assert.ok(player.log.includes(`move ${entrances[ruins.name].join(",")}`));
    player.getEquipment().setItem(Equipment.HEAD_SLOT, new Item(-1, 0)).refreshItems();
    assert.equal(sender.getVarbit(definition.transformVarbit), 0);
    assert.equal(ObjectDefinition.forPlayer(ruins.ruinsId, player).getInteractions(), null);
    player.log.length = 0;
    assert.equal(handlers["Mysterious ruins:Enter"]({ player, objectId: ruins.ruinsId }), false);
    assert.deepEqual(player.log, []);
  }
  const player = runecrafter(5527);
  player.getEquipment().refreshItems();
  assert.equal(player.getPacketSender().getVarbit(607), 1);
  player.getEquipment().setItem(Equipment.HEAD_SLOT, new Item(5529, 1)).refreshItems();
  assert.equal(player.getPacketSender().getVarbit(607), 0, "replacing a tiara clears its old option");
  assert.equal(player.getPacketSender().getVarbit(608), 1);
  player.log.length = 0;
  player.getEquipment().refreshItems();
  assert.deepEqual(player.log, [], "unchanged equipment sends no duplicate varbits");
  assert.equal(handlers["Mysterious ruins:Enter"]({ player, objectId: 34813 }), false, "wrong worn tiara");
});

test("Death Altar access requires the quest, except at the stage-six crystal step", () => {
  const deathRuins = ruinsData.find(({ name }) => name === "Death");
  const player = runecrafter(deathRuins.tiaraId);
  player.mourningsEndPartIIStage = 5;
  handlers.login({ player });
  player.log.length = 0;

  assert.equal(handlers["Mysterious ruins:Enter"]({ player, objectId: deathRuins.ruinsId }), true);
  assert.deepEqual(player.log, ["message You must solve the Death Altar puzzle during Mourning's End Part II before entering the Death Altar."]);

  player.log.length = 0;
  assert.equal(useOnRuins(player, deathRuins.ruinsId, deathRuins.talismanId), true);
  assert.deepEqual(player.log, ["message You must solve the Death Altar puzzle during Mourning's End Part II before entering the Death Altar."]);

  const stageSix = runecrafter(deathRuins.tiaraId);
  stageSix.mourningsEndPartIIStage = 6;
  const stageSixInventory = new Inventory(stageSix);
  stageSix.getInventory = () => stageSixInventory;
  stageSixInventory.addItem(new Item(ItemIdentifiers.NEWLY_MADE_CRYSTAL, 1));
  let landing;
  stageSix.moveTo = location => { landing = location; };
  assert.equal(handlers["Mysterious ruins:Enter"]({ player: stageSix, objectId: deathRuins.ruinsId }), true);
  assert.deepEqual([landing.getX(), landing.getY(), landing.getZ()], [2208, 4830, 0]);

  const incomplete = crafter(65, [[ItemIdentifiers.PURE_ESSENCE, 1]]);
  incomplete.mourningsEndPartIIStage = 5;
  assert.equal(craft(incomplete, ObjectIdentifiers.ALTAR_56), true);
  assert.equal(amount(incomplete, ItemIdentifiers.PURE_ESSENCE), 1);
  assert.equal(amount(incomplete, ItemIdentifiers.DEATH_RUNE), 0);
  assert.deepEqual(incomplete.xp, []);

  const gotr = crafter(65, [[ItemIdentifiers.PURE_ESSENCE, 1]]);
  gotr.mourningsEndPartIIStage = 5;
  gotr.__gotrTrip = {};
  assert.equal(craft(gotr, ObjectIdentifiers.ALTAR_56), true);
  assert.equal(amount(gotr, ItemIdentifiers.DEATH_RUNE), 1, "GOTR altar trips use their own quest gate");
});

test("elemental and catalytic talismans and tiaras only admit their own altar group", () => {
  for (const ruins of ruinsData) {
    const talismanId = ruins.elemental ? 5516 : 26798;
    const tiaraId = ruins.elemental ? 26804 : 26801;
    assert.equal(useOnRuins(runecrafter(), ruins.ruinsId, talismanId), true, ruins.name);
    ticks(3);
    assert.equal(useOnRuins(runecrafter(), ruins.ruinsId, ruins.elemental ? 26798 : 5516), false, ruins.name);
    const player = runecrafter(tiaraId);
    player.getEquipment().refreshItems();
    assert.equal(player.getPacketSender().getVarbit(CacheDefinitions.getObject(ruins.ruinsId).transformVarbit), 1);
    assert.equal(handlers["Mysterious ruins:Enter"]({ player, objectId: ruins.ruinsId }), true);
    assert.equal(handlers["Mysterious ruins:Enter"]({ player: runecrafter(ruins.elemental ? 26801 : 26804), objectId: ruins.ruinsId }), false);
  }
});

test("altar entry lands beside the portal on a walkable cache tile", () => {
  const { RegionManager, Location } = PluginManager.getCoreApi();
  RegionManager.init();
  for (const [name, [x, y, z]] of Object.entries(entrances)) {
    RegionManager.loadMapFiles(x, y, false);
    assert.equal(RegionManager.blocked(new Location(x, y, z), null), false, name);
  }
});


test('Named item-on-object hooks match the player-visible multiloc and reject its hidden state', () => {
  const hooks = PluginManager.itemOnObjectHooks;
  let state = 0, calls = 0;
  try {
    PluginManager.itemOnObjectHooks = [];
    const player = { getPacketSender: () => ({ getVarbit: () => state, getVarp: () => 0 }) };
    const object = { getDefinition: () => ObjectDefinition.forId(54089) };
    assert.equal(object.getDefinition().getName(), 'null');
    PluginManager.createApi('VisibleObjectTest').onItemOnObject('Air rune', 'Old battered door', () => { calls++; });
    const event = { player, objectId: 54089, object, itemId: 556, handled: false };
    assert.equal(PluginManager.emitItemOnObject(event), true);
    assert.equal(calls, 1);
    state = 2;
    event.handled = false;
    assert.equal(PluginManager.emitItemOnObject(event), true);
    assert.equal(calls, 2);
    state = 6;
    event.handled = false;
    assert.equal(PluginManager.emitItemOnObject(event), false);
    assert.equal(calls, 2);
  } finally { PluginManager.itemOnObjectHooks = hooks; }
});

// Crafting at the altars.
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { ObjectIdentifiers } = require("../dist/util/ObjectIdentifiers");

function crafter(level, items) {
  const player = visitor();
  player.mourningsEndPartIIStage = 60;
  const xp = [];
  const dialogues = [];
  const inventory = new Inventory(player);
  items.forEach(([id, amount], slot) => inventory.setItem(slot, new Item(id, amount)));
  Object.assign(player, {
    xp, dialogues, inventory,
    getInventory: () => inventory,
    getSkillManager: () => ({
      getCurrentLevel: () => level,
      addExperiences: (_skill, amount) => xp.push(amount),
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => dialogues.push(chain.getDialogues().get(0).getText()) }),
    performGraphic: (graphic) => player.log.push(`graphic ${graphic.getId()} height ${graphic.getHeight()}`),
    performAnimation: (animation) => player.log.push(`animation ${animation.getId()}`),
    getPacketSender: () => new Proxy({}, {
      get: (_target, key) => (key === "sendTypedMessage" ? (_type, text) => player.log.push(`spam ${text}`) : () => {}),
    }),
    getAttribute: () => undefined,
  });
  return player;
}

function amount(player, itemId) {
  return player.inventory.getAmount(itemId);
}

function craft(player, objectId, option = "Craft-rune") {
  const handler = handlers[`${option === "Bind" ? "Blood Altar" : "Altar"}:${option}`];
  return handler({ player, objectId, handled: false });
}

test("an altar converts every essence in the inventory, rune and pure together (Wiki: Runecraft)", () => {
  const player = crafter(99, [[ItemIdentifiers.RUNE_ESSENCE, 1], [ItemIdentifiers.RUNE_ESSENCE, 1], [ItemIdentifiers.PURE_ESSENCE, 1]]);
  assert.equal(craft(player, ObjectIdentifiers.ALTAR_35), true);
  assert.equal(amount(player, ItemIdentifiers.WATER_RUNE), 18, "three essence at 6 water runes each");
  assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 0);
  assert.equal(amount(player, ItemIdentifiers.PURE_ESSENCE), 0);
  assert.deepEqual(player.xp, [18], "6 XP for each of the three essence");
  assert.ok(player.log.includes("graphic 186 height 92"), "the craft graphic's captured height");
});

test("the Wrath Altar crafts wrath runes from pure essence at 95 Runecraft (Wiki: Wrath Altar)", () => {
  const player = crafter(99, [[ItemIdentifiers.PURE_ESSENCE, 1], [ItemIdentifiers.PURE_ESSENCE, 1], [ItemIdentifiers.RUNE_ESSENCE, 1]]);
  assert.equal(craft(player, ObjectIdentifiers.ALTAR_58), true);
  assert.equal(amount(player, ItemIdentifiers.WRATH_RUNE), 2, "one rune an essence, no multiples");
  assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 1, "rune essence stays");
  assert.deepEqual(player.xp, [16]);

  const low = crafter(94, [[ItemIdentifiers.PURE_ESSENCE, 1]]);
  craft(low, ObjectIdentifiers.ALTAR_58);
  assert.deepEqual(low.log, ["message You need a Runecrafting level of at least 95 to craft this."]);
  assert.equal(amount(low, ItemIdentifiers.PURE_ESSENCE), 1);
});

test("a pure essence altar without pure essence refuses in a message box (rsprox capture 1636)", () => {
  const player = crafter(99, [[ItemIdentifiers.RUNE_ESSENCE, 1]]);
  assert.equal(craft(player, ObjectIdentifiers.ALTAR_83), true);
  assert.deepEqual(player.dialogues, ["You do not have any pure essences to bind."]);
  assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 1);
  assert.equal(amount(player, ItemIdentifiers.BLOOD_RUNE), 0);
});

/** Runs `body` with Math.random returning `values` in turn (the last one repeated). */
function withRandom(values, body) {
  const random = Math.random;
  let index = 0;
  Math.random = () => values[Math.min(index++, values.length - 1)];
  try { body(); } finally { Math.random = random; }
}

test("the Ourania Altar binds pure and daeyalt essence into random runes at 1.7 times their XP (Wiki: Ourania Altar)", () => {
  const ourania = require("../plugins/skills/data/ourania-altar.json");
  for (const { weights } of ourania.levels) assert.equal(weights.reduce((a, b) => a + b, 0), ourania.rolls);

  // Rolls of 0 land on the first rune with weight: soul at every level.
  const player = crafter(1, [[ItemIdentifiers.PURE_ESSENCE, 1], [ItemIdentifiers.DAEYALT_ESSENCE, 1], [ItemIdentifiers.RUNE_ESSENCE, 1]]);
  emitted.length = 0;
  withRandom([0], () => assert.equal(craft(player, ObjectIdentifiers.ALTAR_31), true));
  assert.equal(amount(player, ItemIdentifiers.SOUL_RUNE), 2, "one rune an essence, no level needed");
  assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 1, "rune essence stays");
  assert.equal(player.xp.length, 1);
  assert.ok(Math.abs(player.xp[0] - (11 * 1.7 + 11 * 1.7 * 1.5)) < 1e-9, "daeyalt's XP is 1.5 times pure's");
  assert.ok(player.log.includes("spam You bind the temple's power into runes."));
  assert.ok(!player.log.some((line) => line.includes("medium level knowledge")));
  assert.deepEqual(emitted.filter(([name]) => name === "runecrafting:success").map(([, event]) => [event.runeId, event.rolls, event.petBase]), [[ItemIdentifiers.SOUL_RUNE, 2, 1487213]],
    "the rift guardian rolls at the Ourania Altar's base (Wiki: Rift guardian)");

  // The last roll lands on air runes, the most common at level 1.
  const low = crafter(1, [[ItemIdentifiers.PURE_ESSENCE, 1]]);
  emitted.length = 0;
  withRandom([0.9999], () => craft(low, ObjectIdentifiers.ALTAR_31));
  assert.equal(emitted.find(([name]) => name === "runecrafting:success")[1].petBase, 1487213, "the same base for any rune");
  assert.equal(amount(low, ItemIdentifiers.AIR_RUNE), 1);
  assert.ok(Math.abs(low.xp[0] - 5 * 1.7) < 1e-9);
});

test("the medium Ardougne Diary adds runes at the Ourania Altar, without XP (Wiki; rsprox captures 819, 822)", () => {
  ardougneMedium = true;
  try {
    // A roll of 0 picks the soul rune and passes its 10% extra chance.
    const player = crafter(99, [[ItemIdentifiers.PURE_ESSENCE, 1]]);
    withRandom([0], () => craft(player, ObjectIdentifiers.ALTAR_31));
    assert.equal(amount(player, ItemIdentifiers.SOUL_RUNE), 2);
    assert.ok(Math.abs(player.xp[0] - 11 * 1.7) < 1e-9, "the extra rune gives no XP");
    assert.deepEqual(player.log.filter((line) => line.startsWith("spam")), [
      "spam You bind the temple's power into runes.",
      "spam Your medium level knowledge of the local area allows you to bind additional runes.",
    ]);
  } finally {
    ardougneMedium = false;
  }
});

test("the Ourania Altar without pure or daeyalt essence refuses in a message box (rsprox capture 822)", () => {
  const player = crafter(99, [[ItemIdentifiers.RUNE_ESSENCE, 1]]);
  assert.equal(craft(player, ObjectIdentifiers.ALTAR_31), true);
  assert.deepEqual(player.dialogues, ["You do not have any pure or daeyalt essences to bind."]);
  assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 1);
});

test("Kourend's Blood Altar binds dark essence fragments, not pure essence (Wiki; rsprox capture 1673)", () => {
  const pure = crafter(99, [[ItemIdentifiers.PURE_ESSENCE, 1]]);
  assert.equal(craft(pure, ObjectIdentifiers.BLOOD_ALTAR, "Bind"), true);
  assert.deepEqual(pure.dialogues, ["You have nothing suitable to bind."]);
  assert.equal(amount(pure, ItemIdentifiers.BLOOD_RUNE), 0);
  assert.equal(amount(pure, ItemIdentifiers.PURE_ESSENCE), 1);

  const fragments = crafter(77, Array.from({ length: 10 }, () => [ItemIdentifiers.DARK_ESSENCE_FRAGMENTS, 1]));
  craft(fragments, ObjectIdentifiers.BLOOD_ALTAR, "Bind");
  assert.equal(amount(fragments, ItemIdentifiers.BLOOD_RUNE), 10, "one blood rune a fragment");
  assert.equal(amount(fragments, ItemIdentifiers.DARK_ESSENCE_FRAGMENTS), 0);
  assert.ok(Math.abs(fragments.xp[0] - 238) < 1e-9, "23.8 XP a fragment");

  const low = crafter(76, [[ItemIdentifiers.DARK_ESSENCE_FRAGMENTS, 1]]);
  craft(low, ObjectIdentifiers.BLOOD_ALTAR, "Bind");
  assert.deepEqual(low.log, ["message You need a Runecrafting level of at least 77 to craft this."]);
});

test("a talisman or the tiara used on its altar binds the tiara (Wiki: Tiara; rsprox capture 1636)", () => {
  const use = (player, objectId, itemId) => PluginManager.emitItemOnObject({
    player, objectId, itemId, handled: false, object: { getDefinition: () => ObjectDefinition.forId(objectId) },
  });
  const player = crafter(1, [[ItemIdentifiers.TIARA, 1], [ItemIdentifiers.BLOOD_TALISMAN, 1]]);
  player.getPacketSender = () => new Proxy({}, { get: (_target, key) => key === "sendTypedMessage" ? (_type, text) => player.log.push(`spam ${text}`) : () => {} });
  assert.equal(use(player, ObjectIdentifiers.ALTAR_83, ItemIdentifiers.TIARA), true);
  assert.equal(amount(player, ItemIdentifiers.BLOOD_TIARA), 1);
  assert.equal(amount(player, ItemIdentifiers.TIARA), 0);
  assert.equal(amount(player, ItemIdentifiers.BLOOD_TALISMAN), 0);
  assert.deepEqual(player.xp, [52.5], "the Wiki's 52.5 XP");
  assert.deepEqual(player.log, ["spam You bind the power of the talisman into your Tiara."]);

  const air = crafter(1, [[ItemIdentifiers.TIARA, 1], [ItemIdentifiers.AIR_TALISMAN, 1]]);
  assert.equal(use(air, ObjectIdentifiers.ALTAR_35, ItemIdentifiers.AIR_TALISMAN), false, "another altar's talisman");
  assert.equal(use(air, ObjectIdentifiers.ALTAR_33, ItemIdentifiers.AIR_TALISMAN), true);
  assert.equal(amount(air, ItemIdentifiers.AIR_TIARA), 1);
  assert.deepEqual(air.xp, [25]);
  assert.equal(use(crafter(1, [[ItemIdentifiers.AIR_TALISMAN, 1]]), ObjectIdentifiers.ALTAR_33, ItemIdentifiers.AIR_TALISMAN), false, "no tiara");
});

test("a death cancels a wizard's teleport: neither the dying nor the respawned player is moved to the mine", () => {
  const { Location } = PluginManager.getCoreApi();
  const aubury = { getLocation: () => new Location(3253, 3401, 0), forceChat() {}, setPositionToFace() {}, performGraphic() {} };
  const teleported = (player) => player.log.filter((line) => line.startsWith("move"));

  // Dying during the cast (live: no landing while dying; the death sequence owns the player).
  const dying = miner({ x: 3253, y: 3402, attributes: { "quest.rune_mysteries.stage": 6 } });
  handlers["Aubury:Teleport"]({ player: dying, npc: aubury });
  ticks(2);
  dying.dying = true;
  ticks(3);
  assert.deepEqual(teleported(dying), [], "the dying player stays");
  assert.equal(dying.getAttribute("runecrafting:travel"), null);

  // Died and respawned before the landing tick: the respawn's death event cancels it.
  const respawned = miner({ x: 3253, y: 3402, attributes: { "quest.rune_mysteries.stage": 6 } });
  handlers["Aubury:Teleport"]({ player: respawned, npc: aubury });
  ticks(3);
  handlers.death({ player: respawned });
  ticks(2);
  assert.deepEqual(teleported(respawned), [], "the respawned player stays where they respawned");
  assert.equal(respawned.getAttribute("runecrafting:travel"), null);

  // And a fresh teleport after it works.
  handlers["Aubury:Teleport"]({ player: respawned, npc: aubury });
  ticks(4);
  assert.deepEqual(teleported(respawned), ["move 2913,4832,0"]);
});

// The easy Wilderness Diary's "Enter the Chaos Runecrafting temple." (Wiki: Chaos Altar): through the
// mysterious ruins or the Abyss; the Tunnel of Chaos and Guardians of the Rift do not count.
test("entering the Chaos altar by its ruins (tiara or talisman) or the Abyss rift completes the easy Wilderness Diary task", () => {
  const chaos = ruinsData.find((ruins) => ruins.name === "Chaos");
  const air = ruinsData.find((ruins) => ruins.name === "Air");
  const diary = () => emitted.filter(([name]) => name === "diary:task").map(([, event]) => `${event.diary}:${event.task}`);
  const TASK = "wilderness:enter-the-chaos-runecrafting-temple";
  emitted.length = 0;

  const tiara = runecrafter(chaos.tiaraId);
  tiara.getEquipment().refreshItems();
  assert.equal(handlers["Mysterious ruins:Enter"]({ player: tiara, objectId: chaos.ruinsId }), true);
  assert.ok(tiara.log.includes("move 2281,4837,0"), "the tiara takes the player in");
  assert.deepEqual(diary(), [TASK]);

  emitted.length = 0;
  const airTiara = runecrafter(air.tiaraId);
  airTiara.getEquipment().refreshItems();
  assert.equal(handlers["Mysterious ruins:Enter"]({ player: airTiara, objectId: air.ruinsId }), true);
  assert.deepEqual(diary(), [], "another altar's ruins");

  emitted.length = 0;
  const holder = runecrafter();
  assert.equal(useOnRuins(holder, chaos.ruinsId, chaos.talismanId), true);
  assert.deepEqual(diary(), [], "not before the landing");
  ticks(3);
  assert.ok(holder.log.includes("move 2281,4837,0"));
  assert.deepEqual(diary(), [TASK], "a talisman held to the ruins");

  emitted.length = 0;
  assert.equal(handlers["Chaos rift:Exit-through"]({ player: visitor(), objectId: ObjectIdentifiers.CHAOS_RIFT }), true);
  assert.deepEqual(diary(), [], "the rift's teleport has not landed yet");
  const riftTeleport = emitted.find(([name]) => name === "lever:teleport")[1];
  assert.equal(typeof riftTeleport.onArrival, "function", "the teleport reports its landing");
  riftTeleport.onArrival();
  assert.deepEqual(diary(), [TASK], "the Abyss's Chaos rift, on landing");
  emitted.length = 0;
  assert.equal(handlers["Air rift:Exit-through"]({ player: visitor(), objectId: ObjectIdentifiers.AIR_RIFT }), true);
  assert.deepEqual(diary(), [], "another altar's rift");
});

// Wiki: Runecraft#Multiple_runes (revision 15386331). These use the fixture's
// current-level stub; they do not simulate obtaining a boost from food or relics.
for (const [level, runes] of [[77, 3], [78, 4], [103, 4], [104, 5]]) {
  test(`the Earth Altar crafts ${runes} runes per essence at current Runecraft level ${level}`, () => {
    const player = crafter(level, [[ItemIdentifiers.PURE_ESSENCE, 1]]);

    assert.equal(craft(player, ObjectIdentifiers.ALTAR_36), true);
    assert.equal(amount(player, ItemIdentifiers.EARTH_RUNE), runes, `earth runes at current level ${level}`);
    assert.equal(amount(player, ItemIdentifiers.PURE_ESSENCE), 0, "the essence is consumed");
    assert.deepEqual(player.xp, [6.5], "XP is per essence, not per rune");
  });
}

// Ordinary Earth crafting: conserve carried materials at the signed stack limit.
// This reuses the registered-callback fixture's real Inventory/Item, not a native Player/wire.
{
  const MAX_EARTH_STACK = 2147483647;
  const cases = [
    { name: "roomy", beforeRunes: 50, maxCredit: 10, expectedCredit: 10, expectedDebit: 5 },
    { name: "exact fit", beforeRunes: MAX_EARTH_STACK - 10, maxCredit: 10, expectedCredit: 10, expectedDebit: 5 },
    { name: "two runes of headroom", beforeRunes: MAX_EARTH_STACK - 2, maxCredit: 2 },
    { name: "no headroom", beforeRunes: MAX_EARTH_STACK, maxCredit: 0, expectedCredit: 0, expectedDebit: 0 },
  ];
  for (const row of cases) {
    test(`ordinary Earth stack conservation: ${row.name}`, () => {
      const essence = Array.from({ length: 5 }, () => [ItemIdentifiers.RUNE_ESSENCE, 1]);
      const player = crafter(26, [[ItemIdentifiers.EARTH_RUNE, row.beforeRunes], ...essence]);
      const inventory = player.inventory;
      assert.equal(new Item(ItemIdentifiers.EARTH_RUNE, 1).getDefinition().isStackable(), true,
        "prerequisite: real Earth rune definition is stackable");
      assert.equal(new Item(ItemIdentifiers.RUNE_ESSENCE, 1).getDefinition().isStackable(), false,
        "prerequisite: real rune essence definition is nonstackable");
      assert.equal(amount(player, ItemIdentifiers.EARTH_RUNE), row.beforeRunes, "prerequisite: exact carried destination");
      assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 5, "prerequisite: five essence");
      const materialSlots = inventory.getItems().filter(item => item.getId() === ItemIdentifiers.RUNE_ESSENCE);
      assert.equal(materialSlots.length, 5, "prerequisite: five separate essence slots, not a fabricated stack");
      for (const item of materialSlots) {
        assert.equal(item.getAmount(), 1);
        assert.equal(item.getMeta(), null, "prerequisite: ordinary plain essence");
      }
      const destination = inventory.getItems().filter(item => item.getId() === ItemIdentifiers.EARTH_RUNE);
      assert.equal(destination.length, 1);
      assert.equal(destination[0].getMeta(), null, "prerequisite: ordinary matching destination metadata");
      assert.deepEqual(player.xp, [], "prerequisite: fresh raw XP collector");

      assert.equal(craft(player, ObjectIdentifiers.ALTAR_36), true, "registered ordinary altar callback handles the craft");
      const afterRunes = amount(player, ItemIdentifiers.EARTH_RUNE);
      const debit = 5 - amount(player, ItemIdentifiers.RUNE_ESSENCE);
      const credit = afterRunes - row.beforeRunes;
      assert.ok(Number.isInteger(debit) && debit >= 0 && debit <= 5, "literal bounded essence debit");
      assert.ok(Number.isInteger(credit) && credit >= 0 && credit <= row.maxCredit, "literal bounded carried rune credit");
      assert.ok(afterRunes <= MAX_EARTH_STACK, "signed destination limit remains intact");
      if (row.expectedCredit !== undefined) {
        assert.equal(credit, row.expectedCredit, "literal control rune credit");
        assert.equal(debit, row.expectedDebit, "literal control essence debit");
      }
      // Level26 independently means two Earth runes per essence; do not ask the production multiplier helper.
      assert.equal(credit, debit * 2, "actual carried rune credit equals consumed essence times literal multiplier2");
      const rawXp = player.xp.reduce((total, value) => total + value, 0);
      assert.equal(rawXp, debit * 6.5, "raw base XP request equals actually consumed essence times6.5");
    });
  }
}

// Capacity planning compatibility: actual Inventory semantics, registered callback, raw XP requests.
{
  const MAX = 2147483647;
  function fillers(count) {
    assert.equal(new Item(ItemIdentifiers.BRONZE_AXE, 1).getDefinition().isStackable(), false,
      "prerequisite: real filler definition is nonstackable");
    return Array.from({ length: count }, () => [ItemIdentifiers.BRONZE_AXE, 1]);
  }
  function rawXp(player) { return player.xp.reduce((sum, value) => sum + value, 0); }
  function successCount(player) {
    return emitted.filter(([name, payload]) => name === "runecrafting:success" && payload.player === player).length;
  }
  function snapshot(inventory) {
    return inventory.getItems().map(item => ({ item, id: item.getId(), amount: item.getAmount(), meta: JSON.stringify(item.getMeta()) }));
  }
  function unchanged(inventory, before) {
    inventory.getItems().forEach((item, slot) => {
      assert.equal(item, before[slot].item, `untouched item identity at slot ${slot}`);
      assert.equal(item.getId(), before[slot].id);
      assert.equal(item.getAmount(), before[slot].amount);
      assert.equal(JSON.stringify(item.getMeta()), before[slot].meta);
    });
  }
  function noCraftEffects(player) {
    assert.equal(rawXp(player), 0, "rejected whole action requests no XP");
    assert.equal(successCount(player), 0, "rejected whole action emits no success/pet roll");
    assert.equal(player.log.some(value => /^(graphic|animation) /.test(value)), false);
  }

  test("ordinary capacity: consuming the last essence frees a rune slot in a full bag", () => {
    const player = crafter(26, [...fillers(27), [ItemIdentifiers.RUNE_ESSENCE, 1]]);
    const before = snapshot(player.inventory);
    assert.equal(player.inventory.getItems().filter(item => item.getId() >= 0).length, 28);
    assert.equal(amount(player, ItemIdentifiers.EARTH_RUNE), 0);
    assert.equal(craft(player, ObjectIdentifiers.ALTAR_36), true);
    assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 0);
    assert.equal(amount(player, ItemIdentifiers.EARTH_RUNE), 2);
    assert.equal(rawXp(player), 6.5);
    assert.equal(successCount(player), 1);
    for (let slot = 0; slot < 27; slot++) assert.equal(player.inventory.getItems()[slot], before[slot].item);
  });

  test("ordinary capacity: complete real stackable soul-shard removal frees its one slot", () => {
    const shard = ItemIdentifiers.SOUL_SHARD;
    assert.ok(Number.isInteger(shard), "prerequisite: canonical soul-shard identifier");
    assert.equal(new Item(shard, 1).getDefinition().isStackable(), true,
      "prerequisite: real soul-shard stackability");
    const player = crafter(26, [...fillers(27), [shard, 5]]);
    const before = snapshot(player.inventory);
    const name = "runecrafting:essence";
    const hadHooks = PluginManager.customEventHooks.has(name);
    const prior = PluginManager.customEventHooks.get(name);
    const saved = prior?.slice();
    let requested = 0;
    try {
      PluginManager.createApi("RunecraftingCapacityTest").onCustomEvent(name, request => {
        if (request.player === player) { requested++; request.pure.push(shard); }
      });
      assert.equal(craft(player, ObjectIdentifiers.ALTAR_36), true);
      assert.equal(requested, 1, "registered provider contributes to this one ordinary bind");
      assert.equal(amount(player, shard), 0);
      assert.equal(amount(player, ItemIdentifiers.EARTH_RUNE), 10);
      assert.equal(rawXp(player), 32.5);
      assert.equal(successCount(player), 1);
      for (let slot = 0; slot < 27; slot++) assert.equal(player.inventory.getItems()[slot], before[slot].item);
    } finally {
      if (hadHooks) {
        prior.splice(0, prior.length, ...saved);
        PluginManager.customEventHooks.set(name, prior);
      } else PluginManager.customEventHooks.delete(name);
    }
  });

  test("ordinary capacity: mixed essence keeps debit-credit order and plans cumulative output", () => {
    const inputs = [[ItemIdentifiers.RUNE_ESSENCE, 1], [ItemIdentifiers.RUNE_ESSENCE, 1],
      ...Array.from({ length: 3 }, () => [ItemIdentifiers.PURE_ESSENCE, 1])];
    const player = crafter(26, [[ItemIdentifiers.EARTH_RUNE, 50], ...inputs]);
    const inventory = player.inventory;
    const trace = [];
    const descriptors = new Map(["deleteNumber", "addItem"].map(key => [key, Object.getOwnPropertyDescriptor(inventory, key)]));
    const remove = inventory.deleteNumber;
    const add = inventory.addItem;
    try {
      Object.defineProperty(inventory, "deleteNumber", { configurable: true, writable: true, value: function (id, count) {
        assert.equal(this, inventory); trace.push(["debit", id, count]); return remove.call(this, id, count);
      } });
      Object.defineProperty(inventory, "addItem", { configurable: true, writable: true, value: function (item) {
        assert.equal(this, inventory); trace.push(["credit", item.getId(), item.getAmount()]); return add.call(this, item);
      } });
      assert.equal(craft(player, ObjectIdentifiers.ALTAR_36), true);
    } finally {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(inventory, key, descriptor); else delete inventory[key];
      }
    }
    assert.deepEqual(trace, [["debit", ItemIdentifiers.RUNE_ESSENCE, 2], ["credit", ItemIdentifiers.EARTH_RUNE, 4],
      ["debit", ItemIdentifiers.PURE_ESSENCE, 3], ["credit", ItemIdentifiers.EARTH_RUNE, 6]]);
    assert.equal(amount(player, ItemIdentifiers.EARTH_RUNE), 60);
    assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 0);
    assert.equal(amount(player, ItemIdentifiers.PURE_ESSENCE), 0);
    assert.equal(rawXp(player), 32.5);

    const blocked = crafter(26, [[ItemIdentifiers.EARTH_RUNE, MAX - 6], ...inputs]);
    const before = snapshot(blocked.inventory);
    assert.equal(craft(blocked, ObjectIdentifiers.ALTAR_36), true);
    unchanged(blocked.inventory, before);
    noCraftEffects(blocked);
  });

  test("ordinary capacity: a different-metadata full stack does not block a newly freed plain slot", () => {
    const player = crafter(26, [[ItemIdentifiers.EARTH_RUNE, MAX], ...fillers(26), [ItemIdentifiers.RUNE_ESSENCE, 1]]);
    const tagged = new Item(ItemIdentifiers.EARTH_RUNE, MAX, { capacityControl: "untouched" });
    player.inventory.setItem(0, tagged);
    const before = snapshot(player.inventory);
    assert.equal(craft(player, ObjectIdentifiers.ALTAR_36), true);
    const plain = player.inventory.getItems().filter(item => item.getId() === ItemIdentifiers.EARTH_RUNE && item.getMeta() === null);
    assert.equal(plain.length, 1);
    assert.equal(plain[0].getAmount(), 2, "plain output uses the essence slot, not the tagged full stack");
    assert.equal(player.inventory.getItems()[0], tagged);
    assert.equal(tagged.getAmount(), MAX);
    assert.deepEqual(tagged.getMeta(), { capacityControl: "untouched" });
    for (let slot = 1; slot < 27; slot++) assert.equal(player.inventory.getItems()[slot], before[slot].item);
    assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 0);
    assert.equal(rawXp(player), 6.5);
  });

  test("ordinary capacity: other-metadata headroom cannot rescue a matching stack overflow", () => {
    const player = crafter(26, [[ItemIdentifiers.EARTH_RUNE, MAX - 2], [ItemIdentifiers.EARTH_RUNE, 1],
      ...Array.from({ length: 5 }, () => [ItemIdentifiers.RUNE_ESSENCE, 1])]);
    player.inventory.setItem(1, new Item(ItemIdentifiers.EARTH_RUNE, 1, { capacityControl: "other" }));
    const before = snapshot(player.inventory);
    assert.equal(craft(player, ObjectIdentifiers.ALTAR_36), true);
    unchanged(player.inventory, before);
    noCraftEffects(player);
  });
}

// With no diary bonus, each accepted essence should credit its rolled rune.
for (const headroom of [null, 2, 1, 0]) {
  test(`Ourania preserves rolled runes with stack headroom ${headroom}`, () => {
    const core = PluginManager.getCoreApi(), data = require("../plugins/skills/data/ourania-altar.json");
    assert.equal(ItemIdentifiers.SOUL_RUNE, 566); assert.equal(ItemIdentifiers.PURE_ESSENCE, 7936);
    for (const [id, name, stackable] of [[ItemIdentifiers.SOUL_RUNE, "Soul rune", true],
      [ItemIdentifiers.PURE_ESSENCE, "Pure essence", false]]) {
      const def = core.ItemDefinition.forId(id);
      assert.equal(def.getId(), id); assert.equal(def.getName(), name); assert.equal(def.isStackable(), stackable);
    }
    assert.equal(data.runes[0].rune, "SOUL_RUNE"); assert.ok(data.levels[0].weights[0] > 0);
    assert.equal(ardougneMedium, false, "no diary bonus");
    const held = headroom === null ? 0 : 0x7fffffff - headroom;
    const items = [[ItemIdentifiers.PURE_ESSENCE, 1], [ItemIdentifiers.PURE_ESSENCE, 1],
      [ItemIdentifiers.RUNE_ESSENCE, 1]];
    if (held) items.push([ItemIdentifiers.SOUL_RUNE, held]);
    const player = crafter(1, items);
    assert.equal(amount(player, ItemIdentifiers.PURE_ESSENCE), 2);
    assert.equal(amount(player, ItemIdentifiers.SOUL_RUNE), held);
    emitted.length = 0;
    withRandom([0], () => assert.equal(craft(player, ObjectIdentifiers.ALTAR_31), true));
    const credited = amount(player, ItemIdentifiers.SOUL_RUNE) - held;
    const consumed = 2 - amount(player, ItemIdentifiers.PURE_ESSENCE);
    assert.equal(credited, consumed, "one rolled rune per accepted pure essence");
    assert.equal(amount(player, ItemIdentifiers.RUNE_ESSENCE), 1, "unrelated essence stays");
    assert.ok(Math.abs(player.xp.reduce((a, n) => a + n, 0) - credited * 11 * 1.7) < 1e-9);
    const successes = emitted.filter(([name, event]) => name === "runecrafting:success" && event.player === player);
    assert.equal(successes.reduce((n, [, event]) => n + event.runeAmount, 0), credited);
    assert.equal(successes.reduce((n, [, event]) => n + event.rolls, 0), consumed);
    if (headroom === null || headroom === 2) assert.equal(credited, 2, "room control completes");
  });
}

for (const headroom of [2, 1]) {
  test(`Ourania diary bonus respects stack headroom ${headroom}`, () => {
    ardougneMedium = true;
    try {
      const held = 0x7fffffff - headroom;
      const player = crafter(99, [[ItemIdentifiers.PURE_ESSENCE, 1], [ItemIdentifiers.SOUL_RUNE, held]]);
      emitted.length = 0;
      withRandom([0], () => assert.equal(craft(player, ObjectIdentifiers.ALTAR_31), true));
      const credit = amount(player, ItemIdentifiers.SOUL_RUNE) - held;
      const consumed = 1 - amount(player, ItemIdentifiers.PURE_ESSENCE);
      assert.equal(credit, 2 * consumed, "bonus runes are fully credited or the essence remains");
      assert.equal(consumed, headroom === 2 ? 1 : 0, "exact capacity crafts; insufficient capacity refuses");
      assert.ok(Math.abs(player.xp.reduce((a, n) => a + n, 0) - consumed * 11 * 1.7) < 1e-9);
      const events = emitted.filter(([name, event]) => name === "runecrafting:success" && event.player === player);
      assert.equal(events.reduce((n, [, e]) => n + e.runeAmount, 0), credit);
      assert.equal(events.reduce((n, [, e]) => n + e.rolls, 0), consumed);
    } finally { ardougneMedium = false; }
  });
}

test("Ourania refuses the whole mixed batch when a later rolled stack is full", () => {
  const player = crafter(1, [[ItemIdentifiers.PURE_ESSENCE, 1], [ItemIdentifiers.PURE_ESSENCE, 1],
    [ItemIdentifiers.SOUL_RUNE, 0x7fffffff]]);
  emitted.length = 0;
  withRandom([0.9999, 0], () => assert.equal(craft(player, ObjectIdentifiers.ALTAR_31), true));
  assert.equal(amount(player, ItemIdentifiers.PURE_ESSENCE), 2);
  assert.equal(amount(player, ItemIdentifiers.SOUL_RUNE), 0x7fffffff);
  assert.equal(amount(player, ItemIdentifiers.AIR_RUNE), 0);
  assert.deepEqual(player.xp, []);
  assert.equal(emitted.filter(([name, event]) => name === "runecrafting:success" && event.player === player).length, 0);
});
