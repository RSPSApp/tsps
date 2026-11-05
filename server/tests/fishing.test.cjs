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
  assert.equal(tool(N.FISHING_SPOT_58, "Net"), TOOLS.KARAMBWANJI_NET, "Holy Lake karambwanji");
  for (const id of [N.FISHING_SPOT_60, N.FISHING_SPOT_61, N.FISHING_SPOT_62]) {
    assert.equal(tool(id, "Fish"), TOOLS.KARAMBWAN_VESSEL, `karambwan spot ${id}`);
  }
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
      getPacketSender: () => ({ sendTypedMessage: (type, message) => messages.push(message), sendSoundEffect() {} }),
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

  // Big net: every roll stands alone, so one cast can land the junk, two mackerel, cod and bass.
  const junk = [FISH.LEATHER_BOOTS, FISH.SEAWEED, FISH.LEATHER_GLOVES, FISH.OYSTER, FISH.CASKET];
  assert.deepEqual(rollCatch(player(), TOOLS.BIG_NET, () => 0), [...junk, FISH.MACKEREL, FISH.MACKEREL, FISH.COD, FISH.BASS]);
  assert.deepEqual(rollCatch(player({ fishing: 20 }), TOOLS.BIG_NET, () => 0), [...junk, FISH.MACKEREL, FISH.MACKEREL]);
  // Wiki charts: boots and seaweed 10/256 at every level, a casket 1 to 2.
  assert.equal(catchChance(99, FISH.LEATHER_BOOTS), 11 / 256);
  assert.equal(catchChance(1, FISH.CASKET), 2 / 256);
  assert.equal(FISH.OYSTER.experience, 10);
  assert.equal(FISH.SEAWEED.experience, 1);
  assert.equal(FISH.SHARK.message(1), "You catch a shark!");
  assert.equal(FISH.TROUT.message(1), "You catch a raw trout");
  assert.equal(FISH.LOBSTER.message(1), "You catch a lobster.");

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
        getAmount: (id) => items.reduce((sum, item) => sum + (item?.getId() === id ? item.getAmount() : 0), 0),
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
      getPacketSender: () => ({ sendTypedMessage: (type, message) => messages.push(message), sendSoundEffect() {} }),
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

  // A fishing:success listener can stop the session (Tutorial Island's one shrimp).
  events.set("fishing:success", (payload) => { payload.stop = true; });
  const stopCatch = player({ inventory: [I.SMALL_FISHING_NET] });
  assert.equal(landCatch(stopCatch, TOOLS.NET, findTool(stopCatch, TOOLS.NET), [FISH.SHRIMP]), true);
  events.delete("fishing:success");
  const keepCatch = player({ inventory: [I.SMALL_FISHING_NET] });
  assert.equal(landCatch(keepCatch, TOOLS.NET, findTool(keepCatch, TOOLS.NET), [FISH.SHRIMP]), false);

  const check = player({ inventory: [I.INFERNAL_HARPOON] });
  itemActions.get("Infernal harpoon").Check({ player: check, item: check.items[0] });
  assert.equal(check.messages[0], "Your infernal harpoon has 5,000 charges left.");

  // Crystal harpoon: one charge per catch, 10,000 start, elven signet saves 10%.
  const CrystalHarpoon = require("../plugins/skills/fishing/CrystalHarpoon.Fishing");
  const crystal = player({ weapon: I.CRYSTAL_HARPOON });
  assert.equal(CrystalHarpoon.tryUseCharge(crystal, () => 0.5), true);
  assert.equal(CrystalHarpoon.charges(crystal.equipment[Equipment.WEAPON_SLOT]), 9999);

  const signet = player({ weapon: I.CRYSTAL_HARPOON });
  signet.equipment[Equipment.RING_SLOT] = new Item(I.ELVEN_SIGNET, 1);
  assert.equal(CrystalHarpoon.tryUseCharge(signet, () => 0.05), false, "the signet saves the charge");
  assert.equal(CrystalHarpoon.charges(signet.equipment[Equipment.WEAPON_SLOT]), 10000);
  assert.equal(CrystalHarpoon.tryUseCharge(signet, () => 0.5), true, "outside the 10% roll it spends one");

  // Wiki: Celestial signet inherits the elven signet effect in both charge states.
  // Exercise actual catch delivery so saved charges still award the fish and its XP.
  for (const ringId of [I.CELESTIAL_SIGNET, I.CELESTIAL_SIGNET_UNCHARGED_]) {
    for (const carried of [false, true]) {
      const fisher = player(carried ? { inventory: [I.CRYSTAL_HARPOON] } : { weapon: I.CRYSTAL_HARPOON });
      const harpoon = carried ? fisher.items[0] : fisher.equipment[Equipment.WEAPON_SLOT];
      fisher.equipment[Equipment.RING_SLOT] = new Item(ringId, 1);
      harpoon.setMetaValue("crystal-harpoon", { charges: 1 });
      const previousRandom = Math.random;
      try {
        Math.random = () => 0.099999;
        landCatch(fisher, TOOLS.HARPOON, findTool(fisher, TOOLS.HARPOON), [FISH.SWORDFISH]);
      } finally {
        Math.random = previousRandom;
      }
      assert.equal(harpoon.getId(), I.CRYSTAL_HARPOON, `worn ring ${ringId} saves the final charge`);
      assert.equal(CrystalHarpoon.charges(harpoon), 1);
      assert.equal(fisher.items.at(-1).getId(), I.RAW_SWORDFISH);
      assert.equal(fisher.xp.get("Fishing"), 100);
      assert.deepEqual(fisher.messages, ["You catch a raw swordfish."]);
      assert.equal(CrystalHarpoon.tryUseCharge(fisher, () => 0.1), true, "10% boundary spends the final charge");
      assert.equal(harpoon.getId(), I.CRYSTAL_HARPOON_INACTIVE_);
      assert.equal(findTool(fisher, TOOLS.HARPOON).bonus, 120);

      const carriedRing = player({ weapon: I.CRYSTAL_HARPOON, inventory: [ringId] });
      assert.equal(CrystalHarpoon.tryUseCharge(carriedRing, () => 0), true, "a carried ring cannot save charges");
      assert.equal(CrystalHarpoon.charges(carriedRing.equipment[Equipment.WEAPON_SLOT]), 9999);
    }
  }

  const crystalLast = player({ inventory: [I.CRYSTAL_HARPOON] });
  crystalLast.items[0].setMetaValue("crystal-harpoon", { charges: 1 });
  assert.equal(CrystalHarpoon.tryUseCharge(crystalLast, () => 0.5), true);
  assert.equal(crystalLast.items[0].getId(), I.CRYSTAL_HARPOON_INACTIVE_);
  assert.equal(findTool(crystalLast, TOOLS.HARPOON).bonus, 120, "inactive fishes as a dragon harpoon");

  const crystalCheck = player({ inventory: [I.CRYSTAL_HARPOON] });
  itemActions.get("Crystal harpoon").Check({ player: crystalCheck, item: crystalCheck.items[0] });
  assert.equal(crystalCheck.messages[0], "Your crystal harpoon has 10,000 charges left.");

  const shardRecharge = itemOnItem.find(([a, b]) => a === "Crystal shard" && b === "Crystal harpoon (inactive)")[2];
  const recharget = player({ inventory: [I.CRYSTAL_HARPOON_INACTIVE_], });
  recharget.items[0].setMetaValue("crystal-harpoon", { charges: 5000 });
  recharget.items.push(new Item(I.CRYSTAL_SHARD, 60));
  shardRecharge({
    player: recharget,
    usedItem: recharget.items[1],
    usedItemId: I.CRYSTAL_SHARD,
    usedItemSlot: 1,
    usedWithItem: recharget.items[0],
    usedWithItemId: I.CRYSTAL_HARPOON_INACTIVE_,
    usedWithItemSlot: 0,
    handled: false,
  });
  assert.equal(CrystalHarpoon.charges(recharget.items[0]), 11000, "60 shards add 6,000 charges");
  assert.equal(recharget.items[0].getId(), I.CRYSTAL_HARPOON, "recharging reactivates the harpoon");
  assert.equal(recharget.items.filter((item) => item.getId() === I.CRYSTAL_SHARD).length, 0);

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
      getPacketSender: () => ({ sendObjectRemoval: () => log.removed++, sendObject() {}, sendTypedMessage: (type, message) => log.messages.push(message) }),
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
      getPacketSender: () => ({ sendInterfaceRemoval() {}, sendEnterAmountPrompt: (text) => { p.promptText = text; }, sendTypedMessage: (type, message) => p.messages.push(message), sendSoundEffect() {} }),
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

/** The real fishing loop against stub players, spots and a hand-driven task. */
async function fishingLoop() {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const { NpcDefinition, Skill, Item, Location } = core;
  const Fishing = require("../plugins/skills/Fishing.plugin");

  const npcs = new Map();
  const tasks = [];
  const handlers = new Map();
  const api = new Proxy({
    core,
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    getWorld: () => ({ getNpcs: () => npcs }),
    onNpcInteraction: (name, actions) => handlers.set(name, actions),
  }, { get: (target, name) => target[name] ?? (() => {}) });
  Fishing.register(api);
  const task = tasks.find((submitted) => submitted.constructor.name === "FishingTask");

  function fisher({ level = 99, items = [] } = {}) {
    const slots = items.map(([id, amount = 1]) => new Item(id, amount));
    const stackable = (id) => core.ItemDefinition.forId(id).isStackable();
    const p = {
      slots, messages: [], statements: [], animations: [], xp: 0, at: new Location(2900, 3119, 0),
      isRegistered: () => true,
      getHitpoints: () => 10,
      getMovementQueue: () => ({ size: () => 0 }),
      getForceMovement: () => null,
      getLocation: () => p.at,
      performAnimation: (animation) => p.animations.push(animation.getId()),
      sendMessage: (message) => p.messages.push(message),
      getPacketSender: () => ({ sendTypedMessage: (type, message) => p.messages.push(message), sendSoundEffect() {} }),
      getDialogueManager: () => ({ startDialogues: (chain) => p.statements.push(chain) }),
      getEquipment: () => ({ contains: () => false, getItems: () => new Array(14).fill(null) }),
      getSkillManager: () => ({
        getCurrentLevel: () => level,
        getMaxLevel: () => level,
        addExperiences: (skill, amount) => { if (skill === Skill.FISHING) p.xp += amount; },
      }),
      getInventory: () => ({
        contains: (id) => slots.some((item) => item.getId() === id && item.getAmount() > 0),
        getAmount: (id) => slots.filter((item) => item.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
        getFreeSlots: () => 28 - slots.length,
        isFull: () => slots.length >= 28,
        full() {},
        refreshItems() {},
        getSlotForItemId: (id) => slots.findIndex((item) => item.getId() === id),
        setItem: (slot, item) => { slots[slot] = item; },
        addItem: (item) => {
          const stack = stackable(item.getId()) && slots.find((held) => held.getId() === item.getId());
          if (stack) stack.setAmount(stack.getAmount() + item.getAmount());
          else if (slots.length < 28) slots.push(item);
        },
        deleteNumber: (id, amount) => {
          const index = slots.findIndex((held) => held.getId() === id);
          const left = slots[index].getAmount() - amount;
          if (left > 0 && stackable(id)) slots[index].setAmount(left); else slots.splice(index, 1);
        },
      }),
    };
    return p;
  }
  const amount = (p, id) => p.getInventory().getAmount(id);
  function spot(id, index) {
    const npc = { getId: () => id, getIndex: () => index, getLocation: () => new Location(2900, 3120, 0) };
    npcs.set(index, npc);
    return npc;
  }
  function start(p, npc, option) {
    const definition = NpcDefinition.forId(npc.getId());
    const event = { player: p, npc, npcId: npc.getId(), definition, clickType: definition.getActions().indexOf(option) + 1 };
    return handlers.get("Fishing spot")[option]?.(event);
  }
  const ticks = (count) => { for (let i = 0; i < count; i++) task.execute(); };
  ticks(1);
  return { core, Fishing, fisher, amount, spot, start, ticks };
}

/** Runs `body` with Math.random fixed, restoring it after. */
async function withRandom(value, body) {
  const random = Math.random;
  Math.random = typeof value === "function" ? value : () => value;
  try {
    await body((next) => { Math.random = typeof next === "function" ? next : () => next; });
  } finally {
    Math.random = random;
  }
}

test("fishing spots roll on the Wiki's tick lengths after the captured first roll", async () => {
  const { core, Fishing, fisher, amount, spot, start, ticks } = await fishingLoop();
  const { ItemIdentifiers: I, NpcIdentifiers: N } = core;
  const { TOOLS } = Fishing;
  // Every roll lands, and 0.02 keeps clear of the 1-in-91 random stop of moving spots.
  await withRandom(0.02, async () => {
    // rsprox captures: the first roll is 3 ticks after a cage's start line, then every 6
    // (Wiki: Game tick/Action lengths); 4 ticks after a rod's, then every 5.
    const lobster = fisher({ items: [[I.LOBSTER_POT]] });
    start(lobster, spot(N.FISHING_SPOT_10, 3), "Cage");
    assert.deepEqual(lobster.messages, ["You attempt to catch a lobster."]);
    ticks(2);
    assert.equal(amount(lobster, I.RAW_LOBSTER), 0, "no lobster before the third tick");
    ticks(1);
    assert.equal(amount(lobster, I.RAW_LOBSTER), 1);
    assert.equal(lobster.messages.at(-1), "You catch a lobster.");
    ticks(5);
    assert.equal(amount(lobster, I.RAW_LOBSTER), 1);
    ticks(1);
    assert.equal(amount(lobster, I.RAW_LOBSTER), 2);
    const fly = fisher({ items: [[I.FLY_FISHING_ROD], [I.FEATHER, 10]] });
    start(fly, spot(N.ROD_FISHING_SPOT_10, 4), "Lure");
    assert.deepEqual(fly.messages, ["You cast out your line...<br>You attempt to catch a fish."]);
    ticks(3);
    assert.equal(amount(fly, I.RAW_TROUT) + amount(fly, I.RAW_SALMON), 0);
    ticks(1);
    assert.equal(amount(fly, I.RAW_TROUT) + amount(fly, I.RAW_SALMON), 1);
    assert.match(fly.messages.at(-1), /^You catch a raw (trout|salmon)$/);
    // The rod casts once, then waits on the spot on every roll (human_fishing_casting, human_fish_onspot).
    assert.deepEqual(fly.animations, [622, 623]);
    ticks(5);
    assert.deepEqual(fly.animations, [622, 623, 623]);

    // Sea bait says its second line a tick after the first.
    const bait = fisher({ items: [[I.FISHING_ROD], [I.FISHING_BAIT, 10]] });
    start(bait, spot(N.FISHING_SPOT_21, 5), "Bait");
    assert.deepEqual(bait.messages, ["You cast out your line..."]);
    ticks(1);
    assert.deepEqual(bait.messages, ["You cast out your line...", "You attempt to catch a fish."]);

    // No bait, too low a level and a full inventory are message boxes.
    const noBait = fisher({ items: [[I.FISHING_ROD]] });
    start(noBait, spot(N.FISHING_SPOT_21, 6), "Bait");
    assert.equal(noBait.statements[0].getDialogues().get(0).getText(), "You don't have any fishing bait.");
    const weak = fisher({ level: 50, items: [[I.HARPOON]] });
    start(weak, spot(N.FISHING_SPOT_20, 7), "Harpoon");
    assert.equal(weak.statements[0].getDialogues().get(0).getText(), "You need to be at least level 76 Fishing to harpoon these fish.");
    const nearlyFull = fisher({ items: [[I.LOBSTER_POT], ...new Array(26).fill([I.LOGS])] });
    start(nearlyFull, spot(N.FISHING_SPOT_10, 8), "Cage");
    ticks(3);
    assert.equal(amount(nearlyFull, I.RAW_LOBSTER), 1);
    assert.equal(nearlyFull.statements.length, 0, "the box comes the tick after the catch");
    ticks(1);
    assert.equal(nearlyFull.statements[0].getDialogues().get(0).getText(), "You can't carry any more fish.");
  });
  for (const name of ["NET", "LOBSTER_POT", "HARPOON", "SHARK_HARPOON", "BIG_NET", "KARAMBWANJI_NET"]) {
    assert.equal(Fishing.rollInterval(TOOLS[name]), 6, name);
  }
  for (const name of ["FISHING_ROD", "FLY_FISHING_ROD", "BARBARIAN_ROD", "ANGLERFISH_ROD"]) {
    assert.equal(Fishing.rollInterval(TOOLS[name]), 5, name);
  }
  assert.equal(Fishing.pikeInterval(() => 0.1), 6, "pike: 6 ticks one time in 5");
  assert.equal(Fishing.pikeInterval(() => 0.5), 5);
});

test("a one-step walk stops fishing even after the route has drained", async () => {
  const { core, fisher, amount, spot, start, ticks } = await fishingLoop();
  const { ItemIdentifiers: I, NpcIdentifiers: N } = core;
  await withRandom(0.02, async () => {
    // FishingTask runs before player turns. A one-tile walk is a single step, so by the next
    // pass the queue is empty and only the moving flag says the player walked away (#2449).
    for (const walked of [false, true]) {
      const lobster = fisher({ items: [[I.LOBSTER_POT]] });
      let moving = false;
      lobster.getMovementQueue = () => ({ size: () => 0, isMovings: () => moving });
      start(lobster, spot(N.FISHING_SPOT_10, walked ? 21 : 20), "Cage");
      ticks(1);
      moving = walked;
      ticks(1);
      moving = false;
      ticks(4);
      assert.equal(amount(lobster, I.RAW_LOBSTER), walked ? 0 : 1, walked ? "the walk ends the session" : "control: the catch lands");
      if (walked) assert.equal(lobster.animations.at(-1), 65535, "the walk resets the fishing animation");
    }
  });
});

test("karambwan vessels fish every 4 ticks and every attempt uses the karambwanji", async () => {
  const { core, Fishing, fisher, amount, spot, start, ticks } = await fishingLoop();
  const { ItemIdentifiers: I, NpcIdentifiers: N } = core;
  const { FISH } = Fishing;
  await withRandom(0.99, async (setRandom) => {
    // An empty vessel loads itself on the click.
    const vessel = spot(N.FISHING_SPOT_60, 1);
    const p = fisher({ level: 70, items: [[I.KARAMBWAN_VESSEL], [I.RAW_KARAMBWANJI, 3]] });
    assert.equal(start(p, vessel, "Fish"), true, "the fishing loop takes karambwan spots");
    assert.deepEqual(p.messages, ["You lower the Karambwan vessel."]);
    assert.equal(amount(p, I.KARAMBWAN_VESSEL_3), 1);
    assert.equal(amount(p, I.KARAMBWAN_VESSEL), 0);
    assert.equal(amount(p, I.RAW_KARAMBWANJI), 2);
    ticks(3);
    assert.equal(p.messages.length, 1, "no attempt before the fourth tick");
    ticks(1);
    assert.equal(p.messages.at(-1), "A Karambwan deftly snatches the Karambwanji from your vessel!");
    assert.equal(amount(p, I.RAW_KARAMBWANJI), 1, "a miss still eats the bait; the vessel reloads");
    assert.equal(amount(p, I.KARAMBWAN_VESSEL_3), 1);
    // The spots never move, so no random stop either.
    setRandom(0);
    ticks(4);
    assert.equal(p.messages.at(-1), "You catch a Karambwan!");
    assert.equal(amount(p, I.RAW_KARAMBWAN), 1);
    assert.equal(p.xp, 50);
    assert.equal(amount(p, I.RAW_KARAMBWANJI), 0);
    assert.equal(amount(p, I.KARAMBWAN_VESSEL_3), 1, "reloaded with the last karambwanji");
    ticks(4);
    assert.equal(amount(p, I.RAW_KARAMBWAN), 2);
    assert.equal(amount(p, I.KARAMBWAN_VESSEL), 1, "out of bait: the vessel stays empty");
    ticks(8);
    assert.equal(amount(p, I.RAW_KARAMBWAN), 2, "and fishing stops");

    // No vessel: the message box live OSRS shows.
    const empty = fisher({ level: 70, items: [[I.RAW_KARAMBWANJI, 5]] });
    start(empty, vessel, "Fish");
    assert.equal(empty.statements.length, 1);
    assert.equal(empty.statements[0].getDialogues().get(0).getText(), "You need a Karambwan vessel to fish here.");
  });
  // Wiki skilling chart: 5/160 out of 256.
  assert.equal(Fishing.rollInterval(Fishing.TOOLS.KARAMBWAN_VESSEL), 4);
  assert.equal(Fishing.catchChance(99, FISH.KARAMBWAN), 161 / 256);
  assert.equal(Fishing.catchChance(65, FISH.KARAMBWAN), 107 / 256);
});

test("Holy Lake karambwanji: floor(level / 5) + 1 a catch, shrimps only with room", async () => {
  const { core, Fishing, fisher, amount, spot, start, ticks } = await fishingLoop();
  const { ItemIdentifiers: I, NpcIdentifiers: N } = core;
  const { TOOLS, FISH, rollCatch } = Fishing;
  await withRandom(0.02, async () => {
    const netter = fisher({ level: 65, items: [[I.SMALL_FISHING_NET]] });
    assert.equal(start(netter, spot(N.FISHING_SPOT_58, 2), "Net"), true, "the fishing loop takes the Holy Lake spot");
    assert.deepEqual(netter.messages, ["You cast out your net..."]);
    ticks(2);
    assert.equal(amount(netter, I.RAW_KARAMBWANJI), 0);
    ticks(1);
    assert.equal(amount(netter, I.RAW_KARAMBWANJI), 14);
    assert.equal(netter.messages.at(-1), "You catch 14 Karambwanji.");
    assert.equal(netter.xp, 5, "XP per catch, not per fish");
  });
  assert.equal(Fishing.catchChance(1, FISH.KARAMBWANJI), 101 / 256);

  // A full inventory keeps stacking karambwanji but has no room for the lake's shrimps.
  const crowded = fisher({ items: [[I.SMALL_FISHING_NET], [I.RAW_KARAMBWANJI, 1], ...new Array(26).fill([I.LOGS])] });
  const rolls = [0.99, 0];
  const missedShrimp = rollCatch(crowded, TOOLS.KARAMBWANJI_NET, () => rolls.shift());
  assert.deepEqual(missedShrimp, [FISH.SHRIMP], "shrimps when the karambwanji roll fails");
  await withRandom(0.99, async () => {
    Fishing.landCatch(crowded, TOOLS.KARAMBWANJI_NET, Fishing.findTool(crowded, TOOLS.KARAMBWANJI_NET), missedShrimp);
    assert.equal(amount(crowded, I.RAW_SHRIMPS), 0, "no room for shrimps");
    assert.equal(crowded.xp, 0);
    Fishing.landCatch(crowded, TOOLS.KARAMBWANJI_NET, Fishing.findTool(crowded, TOOLS.KARAMBWANJI_NET), [FISH.KARAMBWANJI]);
    assert.equal(amount(crowded, I.RAW_KARAMBWANJI), 21);
  });
});

test("Civitas illa Fortis's park pond: Cast with a big net lands its table, 7.5 XP a catch; another net is the wrong size", async () => {
  const { core, Fishing, fisher, amount, spot, start, ticks } = await fishingLoop();
  const { ItemIdentifiers: I, NpcIdentifiers: N, NpcDefinition } = core;
  const { TOOLS, FISH, rollTable, getSpotTool } = Fishing;
  const pond = NpcDefinition.forId(N.FISHING_SPOT_101);
  assert.equal(getSpotTool(N.FISHING_SPOT_101, pond, pond.getActions().indexOf("Cast") + 1), TOOLS.PARK_NET);

  // 0.02 lands every roll, past the pre-rolls and the tertiary, on the first weighted item.
  await withRandom(0.02, async () => {
    const caster = fisher({ level: 1, items: [[I.BIG_FISHING_NET]] });
    assert.equal(start(caster, spot(N.FISHING_SPOT_101, 9), "Cast"), true, "the fishing loop takes the park pond");
    assert.deepEqual(caster.messages, ["You cast out your net..."]);
    ticks(1);
    assert.equal(amount(caster, I.BROKEN_GLASS_2), 1);
    assert.equal(caster.messages.at(-1), "You find some broken glass.");
    assert.equal(caster.xp, 7.5);
    ticks(3);
    assert.equal(amount(caster, I.BROKEN_GLASS_2), 4, "a roll a tick, and the spot never moves");
    assert.ok(caster.animations.length >= 5 && caster.animations.every((id) => id === 620), "human_largenet each tick");

    const wrong = fisher({ items: [[I.SMALL_FISHING_NET]] });
    start(wrong, spot(N.FISHING_SPOT_101, 10), "Cast");
    assert.deepEqual(wrong.messages, ["This is the wrong size net for fishing here."]);
    assert.equal(wrong.statements.length, 0, "a chat line, not a box");
  });

  // The table: pre-rolls first, else the weights (glass 3, boot 2, net 2, casket 2, keys 1 of 10), a tertiary on top.
  const rolls = (...values) => () => values.shift();
  assert.deepEqual(rollTable(TOOLS.PARK_NET.table, rolls(0.005)), [FISH.PARK_JADE], "jade, 1/100");
  assert.deepEqual(rollTable(TOOLS.PARK_NET.table, rolls(0.5, 0.001, 0.5)), [FISH.PARK_RED_TOPAZ]);
  for (const [pick, fish] of [[0.29, FISH.PARK_BROKEN_GLASS], [0.31, FISH.PARK_OLD_BOOT], [0.55, FISH.PARK_BIG_FISHING_NET],
    [0.75, FISH.PARK_CASKET], [0.95, FISH.PARK_HOUSE_KEYS]]) {
    assert.deepEqual(rollTable(TOOLS.PARK_NET.table, rolls(0.5, 0.5, pick, 0.5)), [fish], `${pick}`);
  }
  assert.deepEqual(rollTable(TOOLS.PARK_NET.table, rolls(0.5, 0.5, 0.95, 0.0001)), [FISH.PARK_HOUSE_KEYS, FISH.PARK_LOOP_HALF]);
  assert.equal(FISH.PARK_LOOP_HALF.experience, 0, "a tertiary gives no experience of its own");
});

test("Gita Prymes upgrades angler kit to spirit kit for 1,200 flakes, then both ways free", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const { ItemIdentifiers: I, NpcIdentifiers: N } = core;
  const Angler = require("../plugins/skills/fishing/AnglerOutfit.Fishing");
  const handlers = {};
  const emitted = [];
  Angler.attach({
    core,
    persistAttribute() {},
    onItemOnNpc: (handler) => { handlers.item = handler; },
    onNpcDialogueCondition: (handler) => { handlers.condition = handler; },
    onCustomEvent: (name, handler) => { handlers[name] = handler; },
    emitCustomEvent: (name, payload) => emitted.push({ name, payload }),
  });

  function player(items = [], paid = {}) {
    const counts = new Map(items);
    const attributes = new Map([[Angler._test.PAID_ATTRIBUTE, paid]]);
    const messages = [];
    return {
      messages,
      getInventory: () => ({
        getAmount: (id) => counts.get(id) ?? 0,
        deleteNumber: (id, amount) => counts.set(id, Math.max(0, (counts.get(id) ?? 0) - amount)),
        adds: (id, amount) => counts.set(id, (counts.get(id) ?? 0) + amount),
        refreshItems() {},
      }),
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      sendMessage: (message) => messages.push(message),
    };
  }

  const exchange = (p, itemId) => {
    const event = { player: p, npcId: N.GITA_PRYMES, itemId, handled: false };
    handlers.item(event);
    return event;
  };

  const first = player([[I.ANGLER_HAT, 1], [I.SPIRIT_FLAKES, 1200]]);
  assert.equal(exchange(first, I.ANGLER_HAT).handled, true);
  assert.equal(first.getInventory().getAmount(I.ANGLER_HAT), 0);
  assert.equal(first.getInventory().getAmount(I.SPIRIT_ANGLER_HEADBAND), 1);
  assert.equal(first.getInventory().getAmount(I.SPIRIT_FLAKES), 0);
  assert.deepEqual(first.messages, ["Gita Prymes exchanges your Angler hat for Spirit Angler kit."]);
  assert.ok(emitted.some((event) => event.name === "collection-log:obtain"
    && event.payload.itemId === I.SPIRIT_ANGLER_HEADBAND && event.payload.player === first));

  // Converting back is free; upgrading again is free because that piece's fee is paid.
  exchange(first, I.SPIRIT_ANGLER_HEADBAND);
  assert.equal(first.getInventory().getAmount(I.ANGLER_HAT), 1);
  assert.equal(first.messages.at(-1), "Gita Prymes exchanges your Spirit angler headband for regular Angler kit.");
  emitted.length = 0;
  exchange(first, I.ANGLER_HAT);
  assert.equal(first.getInventory().getAmount(I.SPIRIT_ANGLER_HEADBAND), 1);
  assert.equal(first.getInventory().getAmount(I.SPIRIT_FLAKES), 0, "the fee is paid once per piece");
  assert.ok(emitted.some((event) => event.name === "collection-log:obtain" && event.payload.itemId === I.SPIRIT_ANGLER_HEADBAND));

  const short = player([[I.ANGLER_TOP, 1], [I.SPIRIT_FLAKES, 1199]]);
  exchange(short, I.ANGLER_TOP);
  assert.equal(short.getInventory().getAmount(I.ANGLER_TOP), 1);
  assert.equal(short.getInventory().getAmount(I.SPIRIT_FLAKES), 1199);
  assert.equal(short.messages.at(-1), "Gita Prymes wants 1,200 spirit flakes to upgrade your Angler top. Spirit Angler kit gives the same Fishing XP bonus as the regular Angler kit. If you change it back later, you will not get your spirit flakes back.");

  emitted.length = 0;
  const wrong = player([[I.LOGS, 1]]);
  assert.equal(exchange(wrong, I.LOGS).handled, true);
  assert.equal(emitted.at(-1).name, "npc-dialogue:start");
  assert.equal(emitted.at(-1).payload.variant, "if-given-anything-that-isn-t-an-angler-s-outfit-piece");

  assert.equal(handlers.condition({ npcId: N.GITA_PRYMES, player: player(), stepId: Angler._test.CONDITIONS.NO_ANGLER }), true);
  const unpaid = player([[I.ANGLER_BOOTS, 1]]);
  assert.equal(handlers.condition({ npcId: N.GITA_PRYMES, player: unpaid, stepId: Angler._test.CONDITIONS.FIRST_UPGRADE }), true);
  assert.equal(handlers.condition({ npcId: N.GITA_PRYMES, player: unpaid, stepId: Angler._test.CONDITIONS.ALREADY_UPGRADED }), false);
  const paid = player([[I.ANGLER_BOOTS, 1]], { boots: true });
  assert.equal(handlers.condition({ npcId: N.GITA_PRYMES, player: paid, stepId: Angler._test.CONDITIONS.FIRST_UPGRADE }), false);
  assert.equal(handlers.condition({ npcId: N.GITA_PRYMES, player: paid, stepId: Angler._test.CONDITIONS.ALREADY_UPGRADED }), true);
  const spirit = player([[I.SPIRIT_ANGLER_WADERS, 1]]);
  assert.equal(handlers.condition({ npcId: N.GITA_PRYMES, player: spirit, stepId: Angler._test.CONDITIONS.NO_SPIRIT }), false);
  assert.equal(handlers.condition({ npcId: N.GITA_PRYMES, player: spirit, stepId: Angler._test.CONDITIONS.HAS_SPIRIT }), true);

  // Talking through the first-time branch exchanges the piece and fills the message's blank.
  const talker = player([[I.ANGLER_TOP, 1], [I.SPIRIT_FLAKES, 1200]]);
  handlers["npc-dialogue:condition"]({ npcId: N.GITA_PRYMES, player: talker, stepId: Angler._test.CONDITIONS.FIRST_UPGRADE });
  const choice = { npcId: N.GITA_PRYMES, player: talker, option: "Proceed", end: false };
  handlers["npc-dialogue:choice"](choice);
  assert.equal(choice.end, false);
  assert.equal(talker.getInventory().getAmount(I.SPIRIT_ANGLER_TOP), 1);
  assert.equal(talker.getInventory().getAmount(I.SPIRIT_FLAKES), 0);
  const message = { npcId: N.GITA_PRYMES, player: talker, kind: "message", stepId: "3sMFrS", step: { text: "Gita Prymes exchanges your [outfit piece] for Spirit Angler kit." } };
  handlers["npc-dialogue:action"](message);
  assert.equal(talker.messages.at(-1), "Gita Prymes exchanges your Angler top for Spirit Angler kit.");

  // The warning messages before Proceed name the piece that will be converted.
  const warned = player([[I.ANGLER_WADERS, 1]]);
  const warning = { npcId: N.GITA_PRYMES, player: warned, kind: "message", stepId: "biLPTa", step: { text: "Gita Prymes wants 1,200 spirit flakes to upgrade your [outfit piece]. Spirit Angler kit gives the same Fishing XP bonus as the regular Angler kit. If you change it back later, you will not get your spirit flakes back." } };
  handlers["npc-dialogue:action"](warning);
  assert.equal(warned.messages.at(-1), "Gita Prymes wants 1,200 spirit flakes to upgrade your Angler waders. Spirit Angler kit gives the same Fishing XP bonus as the regular Angler kit. If you change it back later, you will not get your spirit flakes back.");
  const paidWarning = player([[I.ANGLER_WADERS, 1]], { waders: true });
  const paidMessage = { npcId: N.GITA_PRYMES, player: paidWarning, kind: "message", stepId: "y9-UMa", step: { text: "Gita Prymes will upgrade your [outfit piece] for free, as you have already paid the conversion fee. Spirit Angler kit gives the same Fishing XP bonus as the regular Angler kit." } };
  handlers["npc-dialogue:action"](paidMessage);
  assert.equal(paidWarning.messages.at(-1), "Gita Prymes will upgrade your Angler waders for free, as you have already paid the conversion fee. Spirit Angler kit gives the same Fishing XP bonus as the regular Angler kit.");

  const talkerShort = player([[I.ANGLER_WADERS, 1], [I.SPIRIT_FLAKES, 1199]]);
  handlers["npc-dialogue:condition"]({ npcId: N.GITA_PRYMES, player: talkerShort, stepId: Angler._test.CONDITIONS.FIRST_UPGRADE });
  const shortChoice = { npcId: N.GITA_PRYMES, player: talkerShort, option: "Proceed", end: false };
  handlers["npc-dialogue:choice"](shortChoice);
  assert.equal(shortChoice.end, true, "the branch ends without exchanging when the flakes are short");
  assert.equal(talkerShort.getInventory().getAmount(I.ANGLER_WADERS), 1);
  // NpcDialogues reuses message leaves from the cached transcript between players.
  const sharedStep = { type: "message", text: "Gita Prymes wants 1,200 spirit flakes to upgrade your [outfit piece]." };
  const messageFor = p => ({ npcId: N.GITA_PRYMES, player: p, kind: "message", step: sharedStep, text: sharedStep.text });
  const firstWarning = messageFor(player([[I.ANGLER_HAT, 1]]));
  handlers["npc-dialogue:action"](firstWarning);
  assert.equal(sharedStep.text, "Gita Prymes wants 1,200 spirit flakes to upgrade your [outfit piece].", "cached transcript is never personalized");
  assert.equal(firstWarning.handled, true);
  assert.equal(firstWarning.player.messages.at(-1), "Gita Prymes wants 1,200 spirit flakes to upgrade your Angler hat.");
  const nextWarning = messageFor(player([[I.ANGLER_BOOTS, 1]]));
  handlers["npc-dialogue:action"](nextWarning);
  assert.equal(nextWarning.player.messages.at(-1), "Gita Prymes wants 1,200 spirit flakes to upgrade your Angler boots.");

});
