// Run after `yarn build`: node --test tests/fishing.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

test("fishing spots, catch chances and the catch cascade follow OSRS", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { NpcDefinition, NpcIdentifiers: N, ItemIdentifiers: I, Skill } = PluginManager.getCoreApi();
  const Fishing = require("../plugins/skills/Fishing.plugin");
  const { TOOLS, FISH, catchChance, catchLevel, rollCatch, findTool, getSpotTool, hasToolRequirements } = Fishing;

  // Click slot of an option, as the client sends it (second options sit in slot 3).
  function tool(npcId, option) {
    const definition = NpcDefinition.forId(npcId);
    const slot = definition.getActions().indexOf(option);
    return slot < 0 ? undefined : getSpotTool(npcId, definition, slot + 1);
  }
  assert.equal(tool(N.FISHING_SPOT_21, "Small Net"), TOOLS.NET);
  assert.equal(tool(N.FISHING_SPOT_21, "Bait"), TOOLS.FISHING_ROD);
  assert.equal(tool(N.FISHING_SPOT_43, "Net"), TOOLS.NET, "Tutorial Island pond");
  assert.equal(tool(N.FISHING_SPOT_30, "Net"), TOOLS.NET, "Lumbridge Swamp");
  assert.equal(tool(N.FISHING_SPOT_30, "Bait"), TOOLS.FISHING_ROD, "Lumbridge Swamp");
  assert.equal(tool(N.ROD_FISHING_SPOT_10, "Lure"), TOOLS.FLY_FISHING_ROD);
  assert.equal(tool(N.ROD_FISHING_SPOT_10, "Bait"), TOOLS.PIKE_ROD);
  assert.equal(tool(N.FISHING_SPOT_10, "Cage"), TOOLS.LOBSTER_POT);
  assert.equal(tool(N.FISHING_SPOT_10, "Harpoon"), TOOLS.HARPOON);
  assert.equal(tool(N.FISHING_SPOT_20, "Harpoon"), TOOLS.SHARK_HARPOON, "Catherby sharks");
  assert.equal(tool(N.FISHING_SPOT_20, "Big Net"), TOOLS.BIG_NET, "Catherby big net");
  assert.equal(tool(N.FISHING_SPOT_11, "Harpoon"), TOOLS.SHARK_HARPOON, "Fishing Guild sharks");
  assert.equal(tool(N.FISHING_SPOT_11, "Net"), TOOLS.BIG_NET, "Fishing Guild big net");
  assert.equal(tool(N.FISHING_SPOT_55, "Harpoon"), TOOLS.HARPOON, "Piscatoris tuna/swordfish");
  assert.equal(tool(N.FISHING_SPOT_55, "Net"), TOOLS.MONKFISH_NET, "Piscatoris monkfish");
  assert.equal(tool(N.FISHING_SPOT_2, "Small Net"), TOOLS.FROG_SPAWN_NET, "1497 is a cave spot, not shrimp");
  assert.equal(tool(N.FISHING_SPOT_2, "Bait"), TOOLS.CAVE_EEL_ROD);
  assert.equal(tool(N.FISHING_SPOT_4, "Net"), TOOLS.FROG_SPAWN_NET);
  assert.equal(tool(N.FISHING_SPOT_40, "Bait"), TOOLS.SWAMP_EEL_ROD, "Mort Myre");
  assert.equal(tool(N.FISHING_SPOT_63, "Bait"), TOOLS.LAVA_EEL_ROD, "Taverley lava eels");
  assert.equal(tool(N.FISHING_SPOT_68, "Bait"), TOOLS.SACRED_EEL_ROD);
  assert.equal(tool(N.ROD_FISHING_SPOT_16, "Bait"), TOOLS.ANGLERFISH_ROD);
  assert.equal(tool(N.ROD_FISHING_SPOT_20, "Bait"), TOOLS.INFERNAL_EEL_ROD);
  assert.equal(tool(N.FISHING_SPOT_35, "Cage"), TOOLS.DARK_CRAB_POT);
  assert.equal(tool(N.FISHING_SPOT_37, "Use-rod"), TOOLS.BARBARIAN_ROD);
  assert.equal(tool(N.FISHING_SPOT_58, "Net"), undefined, "karambwanji belongs to Tai Bwo Wannai Trio");
  assert.equal(tool(N.FISHING_SPOT_12, "Catch"), undefined, "aerial fishing is Hunter's");

  // Wiki skilling success chart: shark 12.5% at 76 and 41/256 at 99, shrimp certain at 99.
  assert.equal(catchChance(76, FISH.SHARK), 32 / 256);
  assert.equal(catchChance(99, FISH.SHARK), 41 / 256);
  assert.equal(catchChance(99, FISH.SHRIMP), 1);
  assert.equal(catchChance(1, FISH.SHRIMP), 49 / 256);
  // Mackerel's second big net roll is a flat 10/256.
  assert.equal(catchChance(16, FISH.MACKEREL, 100, 1), 11 / 256);
  assert.equal(catchChance(99, FISH.MACKEREL, 100, 1), 11 / 256);

  // Harpoon bonuses reproduce the Wiki's dragon (x1.2) and crystal (x1.35) chart values.
  const chartValue = (fish, bonus, level) => catchChance(level, fish, bonus) * 256 - 1;
  assert.equal(chartValue(FISH.TUNA, 120, 1), 9);
  assert.equal(chartValue(FISH.TUNA, 120, 99), 76);
  assert.equal(chartValue(FISH.SWORDFISH, 120, 99), 57);
  assert.equal(chartValue(FISH.SHARK, 120, 99), 48);
  assert.equal(chartValue(FISH.TUNA, 135, 99), 86);
  assert.equal(chartValue(FISH.SWORDFISH, 135, 1), 5);
  assert.equal(chartValue(FISH.SHARK, 135, 1), 4);
  assert.equal(chartValue(FISH.SHARK, 135, 99), 54);

  const location = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
  function player({ fishing = 99, levels = {}, inventory = [], equipment = [], at = location(3200, 3200) } = {}) {
    const messages = [];
    return {
      messages,
      getSkillManager: () => ({
        getCurrentLevel: (skill) => (skill === Skill.FISHING ? fishing : levels[skill.getName()] ?? 99),
      }),
      getInventory: () => ({ contains: (id) => inventory.includes(id) }),
      getEquipment: () => ({ contains: (id) => equipment.includes(id) }),
      getLocation: () => at,
      sendMessage: (message) => messages.push(message),
    };
  }

  assert.equal(findTool(player({ inventory: [I.HARPOON] }), TOOLS.HARPOON).bonus, 100);
  assert.equal(findTool(player({ equipment: [I.BARB_TAIL_HARPOON] }), TOOLS.HARPOON).bonus, 100, "wielded barb-tail");
  assert.equal(findTool(player({ inventory: [I.HARPOON], equipment: [I.DRAGON_HARPOON] }), TOOLS.HARPOON).bonus, 120);
  assert.equal(findTool(player({ inventory: [I.CRYSTAL_HARPOON] }), TOOLS.HARPOON).bonus, 135);
  assert.equal(findTool(player({ inventory: [I.CRYSTAL_HARPOON_INACTIVE_] }), TOOLS.HARPOON).bonus, 120);
  assert.equal(findTool(player({ fishing: 60, inventory: [I.HARPOON], equipment: [I.DRAGON_HARPOON] }), TOOLS.HARPOON).bonus, 100);
  assert.equal(findTool(player({ fishing: 60, equipment: [I.DRAGON_HARPOON] }), TOOLS.HARPOON), null);
  assert.equal(findTool(player({ inventory: [I.PEARL_FISHING_ROD] }), TOOLS.FISHING_ROD).bonus, 100, "pearl rod");
  assert.equal(FISH.SHRIMP.caught, "some raw shrimps");

  // Fishing Guild: +7 on top of a visible level capped at 99; the boost never unlocks fish.
  assert.equal(catchLevel(player({ fishing: 80, at: location(2605, 3420) })), 87);
  assert.equal(catchLevel(player({ fishing: 102, at: location(2605, 3420) })), 106);
  assert.equal(catchLevel(player({ fishing: 102 })), 99);
  assert.deepEqual(rollCatch(player({ fishing: 70, at: location(2605, 3420) }), TOOLS.SHARK_HARPOON, () => 0), []);

  // Cascade: highest fish first, one per cast; an attempt can miss.
  assert.deepEqual(rollCatch(player(), TOOLS.NET, () => 0), [FISH.ANCHOVY]);
  assert.deepEqual(rollCatch(player({ fishing: 14 }), TOOLS.NET, () => 0), [FISH.SHRIMP], "anchovies need 15");
  assert.deepEqual(rollCatch(player({ fishing: 50 }), TOOLS.HARPOON, () => 0.99), []);
  const rolls = [0.99, 0];
  assert.deepEqual(rollCatch(player({ fishing: 50 }), TOOLS.HARPOON, () => rolls.shift()), [FISH.TUNA]);

  // Big net: every roll stands alone, so one cast can land bass, cod and two mackerel.
  assert.deepEqual(rollCatch(player(), TOOLS.BIG_NET, () => 0), [FISH.BASS, FISH.COD, FISH.MACKEREL, FISH.MACKEREL]);
  assert.deepEqual(rollCatch(player({ fishing: 20 }), TOOLS.BIG_NET, () => 0), [FISH.MACKEREL, FISH.MACKEREL]);

  // Barbarian fishing: Strength and Agility gate each leaping fish.
  const weak = player({ fishing: 99, levels: { Strength: 30, Agility: 30 } });
  assert.deepEqual(rollCatch(weak, TOOLS.BARBARIAN_ROD, () => 0), [FISH.LEAPING_SALMON]);
  const tooWeak = player({ fishing: 99, levels: { Strength: 14 }, inventory: [I.BARBARIAN_ROD, I.FEATHER] });
  assert.equal(hasToolRequirements(tooWeak, TOOLS.BARBARIAN_ROD), null);
  assert.match(tooWeak.messages[0], /Strength level of at least 15/);
  assert.ok(hasToolRequirements(player({ inventory: [I.BARBARIAN_ROD, I.FISH_OFFCUTS] }), TOOLS.BARBARIAN_ROD));
  assert.deepEqual(FISH.LEAPING_STURGEON.extraXp, [[Skill.STRENGTH, 7], [Skill.AGILITY, 7]]);

  // Infernal eels need ice gloves worn; dark crabs need dark fishing bait.
  const eeler = { inventory: [I.OILY_FISHING_ROD, I.FISHING_BAIT] };
  assert.equal(hasToolRequirements(player(eeler), TOOLS.INFERNAL_EEL_ROD), null);
  assert.ok(hasToolRequirements(player({ ...eeler, equipment: [I.ICE_GLOVES] }), TOOLS.INFERNAL_EEL_ROD));
  assert.equal(hasToolRequirements(player({ inventory: [I.LOBSTER_POT, I.FISHING_BAIT] }), TOOLS.DARK_CRAB_POT), null);
  assert.ok(hasToolRequirements(player({ inventory: [I.LOBSTER_POT, I.DARK_FISHING_BAIT] }), TOOLS.DARK_CRAB_POT));
});

test("the infernal harpoon cooks a third of its catch, runs on 5,000 charges and is made and recharged", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const { ItemIdentifiers: I, Skill, Item, Equipment } = core;

  // Register Fishing and Cooking against a stub api that wires custom events between them.
  const events = new Map();
  const itemActions = new Map();
  const itemOnItem = [];
  const api = new Proxy({
    core,
    getTaskManager: () => ({ submit() {} }),
    getWorld: () => ({}),
    onCustomEvent: (name, handler) => events.set(name, handler),
    emitCustomEvent: (name, payload) => events.get(name)?.(payload),
    onItemAction: (name, actions) => itemActions.set(name, actions),
    onItemOnItem: (a, b, handler) => itemOnItem.push([a, b, handler]),
  }, { get: (target, name) => target[name] ?? (() => {}) });
  const Fishing = require("../plugins/skills/Fishing.plugin");
  require("../plugins/skills/Cooking.plugin").register(api);
  Fishing.register(api);
  const InfernalHarpoon = require("../plugins/skills/fishing/InfernalHarpoon.Fishing");
  const { FISH, TOOLS, findTool, landCatch } = Fishing;

  function player({ inventory = [], weapon = null, fishing = 99, cooking = 99 } = {}) {
    const items = inventory.map((id) => new Item(id, 1));
    const equipment = new Array(14).fill(null);
    equipment[Equipment.WEAPON_SLOT] = weapon && new Item(weapon, 1);
    const xp = new Map();
    const messages = [];
    const container = (list) => ({
      getItems: () => list,
      contains: (id) => list.some((item) => item?.getId() === id),
      refreshItems() {},
    });
    return {
      items, equipment, xp, messages,
      getInventory: () => ({
        ...container(items),
        getFreeSlots: () => 28 - items.length,
        addItem: (item) => items.push(item),
        deleteNumber: (id) => items.splice(items.findIndex((item) => item.getId() === id), 1),
      }),
      getEquipment: () => container(equipment),
      getSkillManager: () => ({
        getCurrentLevel: (skill) => (skill === Skill.FISHING ? fishing : skill === Skill.COOKING ? cooking : 99),
        getMaxLevel: (skill) => (skill === Skill.FISHING ? fishing : skill === Skill.COOKING ? cooking : 99),
        addExperiences: (skill, amount) => xp.set(skill.getName(), (xp.get(skill.getName()) ?? 0) + amount),
      }),
      getLocation: () => null,
      sendMessage: (message) => messages.push(message),
    };
  }

  // A 1/3 roll cooks the shark for half its 210 Cooking XP and uses a charge.
  const fisher = player({ weapon: I.INFERNAL_HARPOON });
  assert.equal(InfernalHarpoon.tryCookFish(fisher, I.RAW_SHARK, () => 0.5), false, "2/3 of fish survive");
  assert.equal(InfernalHarpoon.tryCookFish(fisher, I.RAW_SHARK, () => 0.2), true);
  assert.equal(fisher.xp.get("Cooking"), 105);
  assert.equal(InfernalHarpoon.charges(fisher.equipment[Equipment.WEAPON_SLOT]), 4999);
  assert.equal(InfernalHarpoon.tryCookFish(player({ inventory: [I.DRAGON_HARPOON] }), I.RAW_SHARK, () => 0), false);

  // The last charge turns it into the uncharged harpoon, which fishes like a dragon harpoon.
  const lastCharge = player({ inventory: [I.INFERNAL_HARPOON_OR_] });
  lastCharge.items[0].setMetaValue("infernal-harpoon", { charges: 1 });
  assert.equal(InfernalHarpoon.tryCookFish(lastCharge, I.RAW_TUNA, () => 0), true);
  assert.equal(lastCharge.xp.get("Cooking"), 50);
  assert.equal(lastCharge.items[0].getId(), I.INFERNAL_HARPOON_UNCHARGED__2);
  assert.match(lastCharge.messages[0], /run out of charges/);
  assert.equal(findTool(lastCharge, TOOLS.HARPOON).infernal, undefined);
  assert.equal(findTool(lastCharge, TOOLS.HARPOON).bonus, 120);

  // A cooked catch still gives Fishing XP and the pet roll, but no fish.
  const random = Math.random;
  try {
    Math.random = () => 0;
    const landing = player({ weapon: I.INFERNAL_HARPOON });
    landCatch(landing, TOOLS.SHARK_HARPOON, findTool(landing, TOOLS.SHARK_HARPOON), [FISH.SHARK]);
    assert.equal(landing.items.length, 0);
    assert.equal(landing.xp.get("Fishing"), 110);
    assert.equal(landing.xp.get("Cooking"), 105);
    Math.random = () => 0.9;
    landCatch(landing, TOOLS.SHARK_HARPOON, findTool(landing, TOOLS.SHARK_HARPOON), [FISH.SHARK]);
    assert.equal(landing.items[0].getId(), I.RAW_SHARK);
  } finally {
    Math.random = random;
  }

  const check = player({ inventory: [I.INFERNAL_HARPOON] });
  itemActions.get("Infernal harpoon").Check({ player: check, item: check.items[0] });
  assert.equal(check.messages[0], "Your infernal harpoon has 5,000 charges left.");

  // Smouldering stone on a dragon harpoon: 75 Fishing and 85 Cooking.
  const make = itemOnItem.find(([a, b]) => a === "Smouldering stone" && b === "Dragon harpoon")[2];
  const crafter = (levels) => player({ inventory: [I.SMOULDERING_STONE, I.DRAGON_HARPOON], ...levels });
  const use = (p) => ({ player: p, usedItemId: p.items[0].getId(), usedItemSlot: 0, usedWithItemId: p.items[1].getId(), usedWithItemSlot: 1 });
  const novice = crafter({ cooking: 84 });
  make(use(novice));
  assert.deepEqual(novice.items.map((item) => item.getId()), [I.SMOULDERING_STONE, I.DRAGON_HARPOON]);
  const smith = crafter({});
  make(use(smith));
  assert.deepEqual(smith.items.map((item) => item.getId()), [I.INFERNAL_HARPOON]);
  assert.equal(smith.xp.get("Fishing"), 200);
  assert.equal(smith.xp.get("Cooking"), 350);

  // Angler's outfit: +2.5% Fishing XP for the full set, spirit pieces included.
  const { anglerXpMultiplier } = Fishing;
  const dressed = player();
  dressed.equipment[Equipment.HEAD_SLOT] = new Item(I.ANGLER_HAT, 1);
  assert.equal(anglerXpMultiplier(dressed), 1.004);
  dressed.equipment[Equipment.BODY_SLOT] = new Item(I.SPIRIT_ANGLER_TOP, 1);
  dressed.equipment[Equipment.LEG_SLOT] = new Item(I.ANGLER_WADERS, 1);
  dressed.equipment[Equipment.FEET_SLOT] = new Item(I.ANGLER_BOOTS, 1);
  assert.ok(Math.abs(anglerXpMultiplier(dressed) - 1.025) < 1e-12);
  assert.equal(anglerXpMultiplier(player()), 1);
  try {
    Math.random = () => 0.9;
    landCatch(dressed, TOOLS.HARPOON, findTool(player({ inventory: [I.HARPOON] }), TOOLS.HARPOON), [FISH.SWORDFISH]);
    assert.ok(Math.abs(dressed.xp.get("Fishing") - 102.5) < 1e-9);
  } finally {
    Math.random = random;
  }

  // Fishing Guild door (loc 20925 at 2611,3394): 68 Fishing to go in, boosts count, leaving is free.
  const Guild = require("../plugins/skills/fishing/Guild.Fishing");
  const { Location } = core;
  function visitor(level, [x, y]) {
    const log = { messages: [], removed: 0, moved: null };
    const attributes = new Map();
    return Object.assign(log, {
      getLocation: () => new Location(x, y, 0),
      getSkillManager: () => ({ getCurrentLevel: () => level }),
      sendMessage: (message) => log.messages.push(message),
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      getForceMovement: () => null,
      setForceMovement() {},
      getCombat: () => ({ reset() {} }),
      getMovementQueue: () => ({ reset() {}, setBlockMovement() {} }),
      getPacketSender: () => ({ sendObjectRemoval: () => log.removed++, sendObject() {} }),
      moveTo: (to) => { log.moved = to; },
    });
  }
  const door = { x: 2611, y: 3394, z: 0 };
  const knock = (p, objectId = core.ObjectIdentifiers.DOOR_422, location = door) => {
    const request = { player: p, object: {}, objectId, location, handled: false };
    Guild.useGuildDoor(request);
    return request;
  };
  assert.equal(core.ObjectIdentifiers.DOOR_422, 20925);
  const tooLow = visitor(67, Guild.OUTSIDE);
  assert.equal(knock(tooLow).handled, true);
  assert.equal(tooLow.messages[0], "You need a Fishing level of 68 to enter the Fishing Guild.");
  assert.equal(tooLow.removed, 0);
  const boosted = visitor(68, Guild.OUTSIDE);
  knock(boosted);
  assert.equal(boosted.removed, 1, "walks through");
  const leaving = visitor(1, Guild.INSIDE);
  knock(leaving);
  assert.equal(leaving.removed, 1, "anyone can leave");
  assert.equal(knock(visitor(1, Guild.OUTSIDE), core.ObjectIdentifiers.DOOR_422, { x: 3200, y: 3200, z: 0 }).handled, false);
  assert.equal(Guild.invisibleBoost({ getLocation: () => new Location(...Guild.OUTSIDE, 0) }), 0);
  assert.equal(Guild.invisibleBoost({ getLocation: () => new Location(...Guild.INSIDE, 0) }), 7);

  // A dragon harpoon recharges an uncharged one.
  const recharge = itemOnItem.find(([a, b]) => a === "Dragon harpoon" && b === "Infernal harpoon (uncharged)")[2];
  const owner = player({ inventory: [I.DRAGON_HARPOON, I.INFERNAL_HARPOON_UNCHARGED_] });
  recharge(use(owner));
  assert.deepEqual(owner.items.map((item) => item.getId()), [I.INFERNAL_HARPOON]);
  assert.equal(InfernalHarpoon.charges(owner.items[0]), 5000);
});

test("Kylie Minnow lets qualified fishers onto her platform, and the row boats follow her rules", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const { ItemIdentifiers: I, Skill, Item, Equipment, Location } = core;
  const api = new Proxy({ core, getTaskManager: () => ({ submit() {} }), getWorld: () => ({}) },
    { get: (target, name) => target[name] ?? (() => {}) });
  require("../plugins/skills/Fishing.plugin").register(api);
  const Platform = require("../plugins/skills/fishing/MinnowPlatform.Fishing");
  const Guild = require("../plugins/skills/fishing/Guild.Fishing");

  // Capture what Kylie would say instead of opening dialogue interfaces.
  const dialogues = require("../plugins/npcs/NpcDialogues.plugin.js");
  const played = [];
  const startDialogue = dialogues.startDialogue;
  dialogues.startDialogue = (_api, event, steps) => played.push({ npcId: event.npcId, steps });
  try {
    function fisher({ level = 99, outfit = false } = {}) {
      const attributes = new Map();
      const equipment = new Array(14).fill(null);
      if (outfit) {
        equipment[Equipment.HEAD_SLOT] = new Item(I.ANGLER_HAT, 1);
        equipment[Equipment.BODY_SLOT] = new Item(I.ANGLER_TOP, 1);
        equipment[Equipment.LEG_SLOT] = new Item(I.SPIRIT_ANGLER_WADERS, 1);
        equipment[Equipment.FEET_SLOT] = new Item(I.ANGLER_BOOTS, 1);
      }
      const p = {
        varbits: new Map(), movedTo: null,
        getAttribute: (key) => attributes.get(key),
        setAttribute: (key, value) => attributes.set(key, value),
        getPacketSender: () => ({ sendVarbit: (id, value) => p.varbits.set(id, value) }),
        getSkillManager: () => ({ getMaxLevel: (skill) => (skill === Skill.FISHING ? level : 99) }),
        getEquipment: () => ({ getItems: () => equipment }),
        getInventory: () => ({ getAmount: () => 0, getFreeSlots: () => 28 }),
        moveTo: (to) => { p.movedTo = [to.getX(), to.getY(), to.getZ()]; },
      };
      return p;
    }
    const lastNpcLine = () => played.at(-1).steps.find((step) => step.npc)?.npc;
    const ask = (p, text) => Platform.kylieCondition({ player: p, npcId: core.NpcIdentifiers.KYLIE_MINNOW, text });

    // The guild boat turns away anyone under 82 Fishing, then anyone Kylie has not let on yet.
    const novice = fisher({ level: 81 });
    Platform.travelToPlatform({ player: novice });
    assert.match(lastNpcLine(), /You need a fishing level of 82/);
    assert.equal(novice.movedTo, null);
    const stranger = fisher();
    Platform.travelToPlatform({ player: stranger });
    assert.match(lastNpcLine(), /I don't think I have given you access/);
    assert.equal(stranger.movedTo, null);

    // First talk is her introduction; after that the player just asks again.
    Platform.talkToKylie({ player: stranger });
    assert.equal(played.at(-1).steps[0].npc, "Strewth! Nippy little blighters!");
    assert.equal(stranger.varbits.get(Platform.ACCESS_VARBIT), 1);
    Platform.talkToKylie({ player: stranger });
    assert.equal(played.at(-1).steps[0].player, "So, how about letting me out onto your fishing platform?");

    // Without the outfit she says so and grants nothing.
    assert.equal(ask(stranger, "If the player meets all the requirements:"), false);
    assert.equal(ask(stranger, "If the player isn't wearing the Angler's outfit:"), true);
    assert.equal(ask(stranger, "If the player doesn't have 82 Fishing:"), false);
    assert.equal(Platform.hasAccess(stranger), false);

    // Meeting every requirement grants access for good (varbit 5669 = 2 shows her Trade option).
    const angler = fisher({ outfit: true });
    assert.equal(ask(angler, "If the player meets all the requirements:"), true);
    assert.equal(Platform.hasAccess(angler), true);
    assert.equal(angler.varbits.get(Platform.ACCESS_VARBIT), 2);
    Platform.talkToKylie({ player: angler });
    assert.match(lastNpcLine(), /Have you got any minnows for trade/);
    assert.equal(played.at(-1).npcId, core.NpcIdentifiers.KYLIE_MINNOW_2);

    // Boats: out to the platform and back to the dock; the platform is outside the guild boost.
    Platform.travelToPlatform({ player: angler });
    assert.deepEqual(angler.movedTo, [...Platform.PLATFORM_LANDING]);
    Platform.leavePlatform({ player: angler });
    assert.deepEqual(angler.movedTo, [...Platform.DOCK_LANDING]);
    assert.equal(Guild.invisibleBoost({ getLocation: () => new Location(...Platform.PLATFORM_LANDING) }), 0);
    assert.equal(Guild.invisibleBoost({ getLocation: () => new Location(...Platform.DOCK_LANDING) }), 7);
  } finally {
    dialogues.startDialogue = startDialogue;
  }
});

test("minnow fishing: Wiki catch rates, rotating spots, flying fish and Kylie's shark exchange", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const { ItemIdentifiers: I, NpcIdentifiers: N, NpcDefinition, ItemDefinition, Skill, Item, Location } = core;

  // Spot NPCs where npc-spawns.json puts them, in a stub world the rotation task walks.
  const spawns = [[N.FISHING_SPOT_87, 2609, 3443], [N.FISHING_SPOT_88, 2612, 3444], [N.FISHING_SPOT_89, 2617, 3444], [N.FISHING_SPOT_90, 2620, 3443]];
  const npcs = spawns.map(([id, x, y], index) => {
    let at = new Location(x, y, 0);
    return { getId: () => id, getIndex: () => index + 1, getLocation: () => at, moveTo: (to) => { at = to; } };
  });
  const api = new Proxy({ core, getTaskManager: () => ({ submit() {} }), getWorld: () => ({ getNpcs: () => npcs }) },
    { get: (target, name) => target[name] ?? (() => {}) });
  const Fishing = require("../plugins/skills/Fishing.plugin");
  Fishing.register(api);
  const Platform = require("../plugins/skills/fishing/MinnowPlatform.Fishing");
  const { TOOLS, FISH, catchChance, getSpotTool, hasToolRequirements, landCatch, findTool } = Fishing;

  const definition = NpcDefinition.forId(N.FISHING_SPOT_87);
  assert.equal(getSpotTool(N.FISHING_SPOT_87, definition, definition.getActions().indexOf("Small Net") + 1), TOOLS.MINNOW_NET);

  function angler({ level = 99, boosted = level, minnows = 0, free = 27 } = {}) {
    const items = [];
    if (minnows) items.push(new Item(I.MINNOW, minnows));
    const p = {
      items, messages: [], xp: 0, prompt: null,
      getSkillManager: () => ({
        getCurrentLevel: (skill) => (skill === Skill.FISHING ? boosted : 99),
        getMaxLevel: (skill) => (skill === Skill.FISHING ? level : 99),
        addExperiences: (skill, amount) => { if (skill === Skill.FISHING) p.xp += amount; },
      }),
      getInventory: () => ({
        contains: (id) => items.some((item) => item.getId() === id),
        getAmount: (id) => items.filter((item) => item.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
        getFreeSlots: () => free,
        isFull: () => free === 0,
        addItem: (item) => {
          const stack = items.find((held) => held.getId() === item.getId());
          if (stack) stack.setAmount(stack.getAmount() + item.getAmount()); else items.push(item);
        },
        deleteNumber: (id, amount) => {
          const stack = items.find((held) => held.getId() === id);
          stack.setAmount(stack.getAmount() - amount);
        },
      }),
      getEquipment: () => ({ getItems: () => new Array(14).fill(null), contains: () => false }),
      getLocation: () => new Location(...Platform.PLATFORM_LANDING),
      getPacketSender: () => ({ sendInterfaceRemoval() {}, sendEnterAmountPrompt: (text) => { p.promptText = text; } }),
      setEnteredAmountAction: (action) => { p.prompt = action; },
      sendMessage: (message) => p.messages.push(message),
    };
    p.items.push(new Item(I.SMALL_FISHING_NET, 1));
    return p;
  }

  // 82 Fishing that boosts can't reach.
  assert.equal(hasToolRequirements(angler({ level: 81, boosted: 85 }), TOOLS.MINNOW_NET), null);
  assert.ok(hasToolRequirements(angler({ level: 82 }), TOOLS.MINNOW_NET));

  // The fitted chart reproduces the Wiki's catches per hour at a 2-tick attempt (3,000 attempts/h).
  const perHour = (level) => 3000 * catchChance(level, FISH.MINNOW);
  for (const [level, wiki] of [[82, 1500], [85, 1545], [90, 1625], [95, 1692]]) {
    assert.ok(Math.abs(perHour(level) - wiki) / wiki < 0.01, `${level}: ${perHour(level)} vs ${wiki}`);
  }
  assert.deepEqual([82, 84, 85, 90, 95, 98, 99].map((level) => Platform.minnowsPerCatch(angler({ level }))), [10, 10, 11, 12, 13, 13, 14]);

  // A catch stacks 10-14 minnows, gives 26.1 XP, and carries on with a full inventory.
  const full = angler({ level: 85, minnows: 100, free: 0 });
  landCatch(full, TOOLS.MINNOW_NET, findTool(full, TOOLS.MINNOW_NET), [FISH.MINNOW]);
  assert.equal(full.getInventory().getAmount(I.MINNOW), 111);
  assert.ok(Math.abs(full.xp - 26.1) < 1e-9);
  assert.match(full.messages[0], /You catch some minnows/);

  // Spots circle their 4x2 pond clockwise, one tile every 25 ticks, staying opposite each other.
  assert.deepEqual(Platform.nextSpotTile(2609, 3443), [2609, 3444]);
  assert.deepEqual(Platform.nextSpotTile(2612, 3444), [2612, 3443]);
  assert.equal(Platform.nextSpotTile(2614, 3444), null);
  let [x, y] = [2609, 3443];
  for (let step = 0; step < 8; step++) [x, y] = Platform.nextSpotTile(x, y);
  assert.deepEqual([x, y], [2609, 3443], "eight moves bring a spot home");
  Platform.rotateSpots();
  assert.deepEqual(npcs.map((npc) => [npc.getLocation().getX(), npc.getLocation().getY()]),
    [[2609, 3444], [2612, 3443], [2618, 3444], [2619, 3443]]);

  // Flying fish: rolled on the first click after a move, then it eats 16-26 minnows per catch.
  const spot = npcs[0];
  const victim = angler({ minnows: 50 });
  Platform.onStart(victim, spot, () => 0);
  Platform.onStart(angler(), spot, () => 0.99);
  assert.equal(Platform.takesCatch(victim, spot, () => 0), true, "a second player doesn't reroll the spot");
  assert.equal(victim.getInventory().getAmount(I.MINNOW), 34);
  assert.match(victim.messages[0], /flying fish/);
  Platform.takesCatch(victim, spot, () => 0.999);
  assert.equal(victim.getInventory().getAmount(I.MINNOW), 8);
  Platform.rotateSpots();
  Platform.onStart(victim, spot, () => 0.5);
  assert.equal(Platform.takesCatch(victim, spot), false, "moving clears the flying fish");

  // Kylie: 40 minnows for each noted raw shark.
  const trader = angler({ minnows: 130 });
  Platform.exchangeMinnows(trader);
  assert.equal(trader.promptText, "How many sharks would you like?");
  trader.prompt.execute("5");
  assert.equal(trader.getInventory().getAmount(I.MINNOW), 10);
  assert.equal(trader.getInventory().getAmount(ItemDefinition.forId(I.RAW_SHARK).getNoteId()), 3);
});
