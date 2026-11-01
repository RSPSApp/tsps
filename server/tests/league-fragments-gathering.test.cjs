// Run after `yarn build`: node --test tests/league-fragments-gathering.test.cjs
// Shattered Relics' harvesting fragments, Message In A Bottle, Greedy Gatherer and Personal Banker
// (docs/leagues.md "Shattered Relics"), with real players: a Shattered Relics character with the
// fragment equipped, the same character with it owned but not equipped, and a main character. The
// skills' payloads are built as Mining, Woodcutting and Fishing build them; the cooking, smelting,
// log and rare drop table answers are the real plugins'; Farming's harvest and Woodcutting's nest
// roll are the plugins' own code.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../dist/game/GameConstants");

const uid = (group, child) => (group << 16) | child;
const CLASS = 737;
const FRAGMENTS = 735;
const F = {
  chefsCatch: 21, catchOfTheDay: 22, slashAndBurn: 25, homewrecker: 26, rockSolid: 29, moltenMiner: 30,
  chinchonkers: 39, certifiedFarmer: 41, seedyBusiness: 42, messageInABottle: 50,
  // Personal Banker pieces that do nothing to gathering themselves.
  smithingDouble: 31, alchemaniac: 36, deeperPockets: 24,
  // A Greedy Gatherer piece that does nothing to gathering itself.
  justDruid: 44,
};

let core;
let I;
let Fragments;
let Gathering;
const hooks = {};
const custom = {};
let worldLeague = 3;
const ground = [];
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  I = core.ItemIdentifiers;
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (...args) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(...args);
        if (answer !== undefined) result = answer;
      }
      return result;
    };
  };
  const api = new Proxy({
    core,
    persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value),
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getTaskManager: () => ({ submit() {} }),
    getItemOnGroundManager: () => ({ registers: (player, item) => ground.push([player, item.getId(), item.getAmount()]) }),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) {
        const key = `button:${id}`;
        (lists[key] ??= []).push(handler);
        hooks[key] = (event) => {
          for (const attached of lists[key]) {
            if (attached(event) !== false) return (event.handled = true);
          }
          return false;
        };
      }
    },
    onItemAction() {},
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => emit(name, payload),
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  Fragments = require("../plugins/modes/league/Fragments.LeagueMode");
  Gathering = require("../plugins/modes/league/FragmentGathering.LeagueMode")._test;
  // The real answers: Smelting's bar for an ore, Cooking's cooked fish, Firemaking's log XP, NpcDrops' tables.
  require("../plugins/skills/smithing/Data.Smithing").load(core);
  custom["smithing:bar-for-ore"] = [require("../plugins/skills/smithing/Smelting.Smithing").answerBarForOre];
  const Cooking = require("../plugins/skills/Cooking.plugin");
  Cooking._test.setApi({ core });
  const cookable = Cooking._test.COOKABLE_BY_RAW;
  custom["cooking:cooked"] = [(request) => {
    const entry = cookable.get(request.rawId);
    if (entry) Object.assign(request, { cookedId: entry.cooked, xp: entry.xp });
  }];
  // Firemaking's own attach fills its log table and answers the lookup; its other hooks are dropped here.
  const nothing = new Proxy(function nothing() {}, { get: () => nothing, apply: () => nothing });
  require("../plugins/skills/firemaking/Logs.Firemaking").attach(new Proxy({ core }, {
    get: (target, key) => (key in target ? target[key] : key === "onCustomEvent"
      ? (name, handler) => { if (name === "firemaking:log-xp") custom[name] = [handler]; }
      : nothing),
  }));
  const drops = require("../plugins/npcs/NpcDrops.plugin").__internals;
  drops.loadDrops();
  custom["npc-drops:roll-table"] = [(request) => request.drops.push(...drops.rollTable(request.table, request.player, null))];
});

afterEach(() => {
  Math.random = realRandom;
  ground.length = 0;
});

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

function character(name, { league = 3, profile = "league" } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  const previous = worldLeague;
  worldLeague = league;
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  worldLeague = previous;
  return Object.assign(player, { messages });
}

/** A Shattered Relics Warrior with every slot open. */
function shattered(name) {
  const player = character(name);
  player.setInterfaceId(CLASS);
  hooks[`button:${uid(CLASS, 6)}`]({ player, buttonId: uid(CLASS, 6) });
  hooks[`button:${uid(CLASS, 26)}`]({ player, buttonId: uid(CLASS, 26) });
  hooks["command:leaguetask"]({ player, parts: ["leaguetask", `points-${name}`, "15000"] });
  return player;
}

function own(player, ...ids) {
  for (const id of ids) emit("league:grant-fragment", { player, id });
}

function equip(player, ...ids) {
  const previousLocation = player.getLocation();
  player.setLocation(new core.Location(2809, 3440, 0)); // Catherby's bank, as fragment swapping requires.
  own(player, ...ids);
  player.setInterfaceId(FRAGMENTS);
  for (const id of ids) hooks[`button:${uid(FRAGMENTS, 18)}`]({ player, buttonId: uid(FRAGMENTS, 18), slot: 9 * (id - 1), opId: 2 });
  player.setInterfaceId(-1);
  player.setLocation(previousLocation);
}

/** Level 3 (8,000 fragment XP, script 5789). */
function master(player, id) {
  player.setAttribute("league:fragments", { ...player.getAttribute("league:fragments"), [id]: 8000 });
}

/**
 * The owner (equipped at `level`), the same character with it owned but not equipped, and a main
 * character, for one fragment.
 */
function cases(id, level = 1) {
  const owner = shattered(`owner${id}`);
  equip(owner, id);
  if (level === 3) master(owner, id);
  const unequipped = shattered(`unequipped${id}`);
  own(unequipped, id);
  return { owner, unequipped, main: character(`main${id}`, { profile: "main" }) };
}

/** A skill's `storage:gather`, as Mining, Woodcutting and Fishing send it. */
function gather(player, skill, itemId, xp, amount = 1) {
  const request = emit("storage:gather", { player, itemId, amount, stored: 0, skill: core.Skill[skill], xp });
  // The skill adds what nobody stored.
  if (amount > request.stored) player.getInventory().adds(itemId, amount - request.stored);
  return request;
}

function xp(player, skill) {
  return player.getSkillManager().getExperience(core.Skill[skill]);
}

function banked(player, itemId) {
  return player.getBank(core.Bank.getTabForItem(player, itemId)).getAmount(itemId);
}

// ---- The fragments that change what is gathered ----

test("Chef's Catch: fish caught are cooked at its chance, with the Cooking XP whatever the level", () => {
  const { owner, unequipped, main } = cases(F.chefsCatch);
  Math.random = () => 0.1; // under 20%
  gather(owner, "FISHING", I.RAW_SHARK, 110);
  assert.equal(owner.getInventory().getAmount(I.SHARK), 1, "a raw shark comes cooked at Cooking 1");
  assert.equal(owner.getInventory().getAmount(I.RAW_SHARK), 0);
  assert.equal(xp(owner, "COOKING"), 210);
  for (const player of [unequipped, main]) {
    gather(player, "FISHING", I.RAW_SHARK, 110);
    assert.equal(player.getInventory().getAmount(I.RAW_SHARK), 1, player.getUsername());
  }
  Math.random = () => 0.5; // over 20%
  gather(owner, "FISHING", I.RAW_SHARK, 110);
  assert.equal(owner.getInventory().getAmount(I.RAW_SHARK), 1, "raw past the chance");
});

test("Molten Miner: ore smelted into its bar with the Smithing XP; an ore with no bar stays ore", () => {
  const { owner, unequipped } = cases(F.moltenMiner, 3); // level 3: always
  Math.random = () => 0.99;
  gather(owner, "MINING", I.RUNITE_ORE, 125);
  assert.equal(owner.getInventory().getAmount(I.RUNITE_BAR), 1);
  gather(owner, "MINING", I.IRON_ORE, 35);
  assert.equal(owner.getInventory().getAmount(I.IRON_BAR), 1, "Molten Miner's default recipe remains iron");
  assert.equal(owner.getInventory().getAmount(I.STEEL_BAR), 0);
  assert.ok(xp(owner, "SMITHING") > 0, "Smithing XP at Smithing 1");
  gather(owner, "MINING", I.COAL, 50);
  assert.equal(owner.getInventory().getAmount(I.COAL), 1, "coal is no recipe's main ore");
  gather(unequipped, "MINING", I.RUNITE_ORE, 125);
  assert.equal(unequipped.getInventory().getAmount(I.RUNITE_ORE), 1);
});

test("Slash & Burn: logs chopped are burnt for their Firemaking XP and never reach the inventory", () => {
  const { owner, main } = cases(F.slashAndBurn);
  Math.random = () => 0.1;
  const request = gather(owner, "WOODCUTTING", I.YEW_LOGS, 175);
  assert.equal(request.stored, 1);
  assert.equal(owner.getInventory().getAmount(I.YEW_LOGS), 0);
  assert.ok(xp(owner, "FIREMAKING") > 0, "Firemaking XP at Firemaking 1");
  gather(main, "WOODCUTTING", I.YEW_LOGS, 175);
  assert.equal(main.getInventory().getAmount(I.YEW_LOGS), 1);
});

// ---- The sets ----

test("Greedy Gatherer: two pieces double each resource, three triple it, with the XP of each extra", () => {
  const player = shattered("greedy");
  equip(player, F.messageInABottle, F.justDruid);
  Math.random = () => 0.99;
  const before = xp(player, "MINING");
  gather(player, "MINING", I.IRON_ORE, 35);
  assert.equal(player.getInventory().getAmount(I.IRON_ORE), 2);
  const rated = shattered("rated");
  rated.getSkillManager().addExperiences(core.Skill.MINING, 35);
  assert.equal(xp(player, "MINING") - before, xp(rated, "MINING"), "the extra ore's 35 Mining XP, at the league's rate");
  equip(player, F.rockSolid);
  gather(player, "WOODCUTTING", I.LOGS, 25);
  assert.equal(player.getInventory().getAmount(I.LOGS), 3);
  gather(player, "THIEVING", I.COINS, 0);
  assert.equal(player.getInventory().getAmount(I.COINS), 1, "not a gathering skill");
  const one = shattered("onepiece");
  equip(one, F.justDruid);
  gather(one, "MINING", I.IRON_ORE, 35);
  assert.equal(one.getInventory().getAmount(I.IRON_ORE), 1, "one piece is no set");
});

test("Greedy Gatherer: an open container hears the gather first and takes the extras too, before the inventory", () => {
  // A stand-in fish barrel with room for 2, heard before the fragments as the storage items plugin is (it loads first).
  const barrel = { player: null, held: 0 };
  const container = (request) => {
    if (request.player !== barrel.player || request.itemId !== I.RAW_TROUT) return;
    const took = Math.min(2 - barrel.held, request.amount - request.stored);
    barrel.held += took;
    request.stored += took;
  };
  custom["storage:gather"].unshift(container);
  try {
    const player = shattered("greedybag");
    barrel.player = player;
    equip(player, F.messageInABottle, F.justDruid, F.rockSolid);
    gather(player, "FISHING", I.RAW_TROUT, 50);
    assert.equal(barrel.held, 2, "the catch and one extra in the barrel");
    assert.equal(player.getInventory().getAmount(I.RAW_TROUT), 1, "the extra the barrel had no room for");
  } finally {
    custom["storage:gather"].splice(custom["storage:gather"].indexOf(container), 1);
  }
});

test("Personal Banker: half the resources at two pieces, all of them at three, to the bank; a full inventory gathers on", () => {
  const player = shattered("banker");
  equip(player, F.smithingDouble, F.alchemaniac);
  Math.random = () => 0.4; // under 50%
  gather(player, "FISHING", I.RAW_LOBSTER, 90);
  assert.equal(banked(player, I.RAW_LOBSTER), 1);
  assert.equal(player.getInventory().getAmount(I.RAW_LOBSTER), 0);
  Math.random = () => 0.6;
  gather(player, "FISHING", I.RAW_LOBSTER, 90);
  assert.equal(player.getInventory().getAmount(I.RAW_LOBSTER), 1, "past the 50%");
  assert.equal(emit("storage:room", { player, itemId: I.RAW_LOBSTER, room: false }).room, false, "not every resource is banked yet");
  equip(player, F.deeperPockets);
  gather(player, "FISHING", I.RAW_LOBSTER, 90);
  assert.equal(banked(player, I.RAW_LOBSTER), 2);
  assert.equal(emit("storage:room", { player, itemId: I.RAW_LOBSTER, room: false }).room, true);
});

test("the effects compose: Chef's Catch cooks every piece Greedy Gatherer brings, and Personal Banker banks them", () => {
  const player = shattered("composer");
  equip(player, F.chefsCatch, F.messageInABottle, F.smithingDouble, F.alchemaniac, F.deeperPockets);
  master(player, F.chefsCatch);
  Math.random = () => 0.3; // under Chef's Catch's 50%
  gather(player, "FISHING", I.RAW_TROUT, 50);
  assert.equal(banked(player, I.TROUT), 2, "two cooked trout in the bank");
  assert.equal(player.getInventory().getAmount(I.RAW_TROUT) + player.getInventory().getAmount(I.TROUT), 0);
});

test("extras that do not fit in the inventory fall to the floor", (t) => {
  t.mock.method(core.ItemOnGroundManager, "registers", (player, item) => ground.push([player, item.getId(), item.getAmount()]));
  const player = shattered("fullbag");
  equip(player, F.messageInABottle, F.justDruid);
  player.getInventory().adds(I.BRONZE_BAR, 26); // with the class's sword, one slot left
  gather(player, "MINING", I.TIN_ORE, 17.5);
  assert.equal(player.getInventory().getAmount(I.TIN_ORE), 1);
  assert.deepEqual(ground.map(([, id, amount]) => [id, amount]), [[I.TIN_ORE, 1]]);
});

// ---- Farming ----

test("Farming's harvest: Certified Farmer notes the produce; Greedy Gatherer more of it with the XP; Personal Banker banks it", (t) => {
  require("../plugins/skills/farming/Core.Farming").init({ core });
  const Data = require("../plugins/skills/farming/Data.Farming");
  const Model = require("../plugins/skills/farming/Model.Farming");
  const Patches = require("../plugins/skills/farming/Patches.Farming");
  Data.initializeFarmingData();
  const farmingHooks = {};
  Patches.attach(new Proxy({}, { get: (_, name) => (...args) => { farmingHooks[name] = args[0]; } }));
  t.mock.method(core.ObjectDefinition, "forPlayer", () => ({ getInteractions: () => ["Collect"] }));
  t.mock.method(core.MapObjects, "get", () => null);
  t.mock.method(require("../plugins/skills/farming/Services.Farming"), "cropRewards", () => {});
  t.mock.method(core.PluginManager, "emitCustomEvent", (name, payload) => emit(name, payload));
  const patch = Data.CACHE.patches.find((entry) => entry.type === "CORAL");
  const crop = Data.CROPS.get("ELKHORN_CORAL");
  const harvest = (player) => {
    player.performAnimation = () => {};
    player.busy = () => false;
    player.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
    player.moveTo(new core.Location(patch.x, patch.y, patch.z));
    const farm = { offset: 0, patches: {}, tools: {} };
    farm.patches[Data.patchKey(patch)] = { ...Model.emptyPatch(Date.now(), farm), crop: "ELKHORN_CORAL", status: "grown", stage: crop.stages, lives: 6 };
    player.setAttribute(Patches.FARM_ATTRIBUTE, farm);
    farmingHooks.onObjectInteraction({ player, object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: patch.z }, clickType: 1 });
  };
  const note = core.ItemDefinition.forId(crop.produce).getNoteId();

  const farmer = shattered("farmer");
  equip(farmer, F.certifiedFarmer);
  Math.random = () => 0.99; // no doubling, every life lost
  harvest(farmer);
  assert.equal(farmer.getInventory().getAmount(note), 1, "noted");
  assert.equal(farmer.getInventory().getAmount(crop.produce), 0);
  Math.random = () => 0.1; // under 25%: doubled
  harvest(farmer);
  assert.equal(farmer.getInventory().getAmount(note), 3);

  const greedy = shattered("greedyfarmer");
  equip(greedy, F.messageInABottle, F.justDruid, F.rockSolid);
  Math.random = () => 0.99;
  const plain = shattered("plainfarmer");
  harvest(plain);
  harvest(greedy);
  assert.equal(greedy.getInventory().getAmount(crop.produce), 3);
  assert.equal(xp(greedy, "FARMING"), 3 * xp(plain, "FARMING"), "XP for each of the three");

  const banker = shattered("bankfarmer");
  equip(banker, F.smithingDouble, F.alchemaniac, F.deeperPockets);
  harvest(banker);
  assert.equal(banked(banker, crop.produce), 1);
  assert.equal(banker.getInventory().getAmount(crop.produce), 0);
  assert.equal(xp(banker, "FARMING"), xp(plain, "FARMING"));

  const notedBanker = shattered("notedbanker");
  equip(notedBanker, F.certifiedFarmer, F.smithingDouble, F.alchemaniac, F.deeperPockets);
  harvest(notedBanker);
  assert.equal(banked(notedBanker, crop.produce), 1, "the bank keeps the item, not its note");
  assert.equal(banked(notedBanker, note), 0);

  t.mock.method(core.ItemOnGroundManager, "registers", (player, item) => ground.push([player, item.getId(), item.getAmount()]));
  const cramped = shattered("crampedfarmer");
  equip(cramped, F.messageInABottle, F.justDruid, F.rockSolid);
  cramped.getInventory().adds(I.BRONZE_BAR, 26); // with the class's sword, one slot left
  harvest(cramped);
  assert.equal(cramped.getInventory().getAmount(crop.produce), 1, "the pick itself fits, so the harvest goes on");
  assert.deepEqual(ground.map(([, id, amount]) => [id, amount]), [[crop.produce, 2]], "the extras fall");
});

test("Seedy Business: a seed kept at its chance", () => {
  const { owner, main } = cases(F.seedyBusiness);
  Math.random = () => 0.05;
  assert.equal(emit("farming:plant-rules", { player: owner, keepSeed: false }).keepSeed, true);
  assert.equal(emit("farming:plant-rules", { player: main, keepSeed: false }).keepSeed, false);
  Math.random = () => 0.2;
  assert.equal(emit("farming:plant-rules", { player: owner, keepSeed: false }).keepSeed, false);
});

// ---- Rocks, nests, vessels, rare catches, chinchompas ----

test("Rock Solid: iron, sandstone and granite stand at its chance; other rocks deplete", () => {
  const { owner, unequipped } = cases(F.rockSolid);
  Math.random = () => 0.1;
  for (const rock of ["Iron rocks", "Sandstone rocks", "Granite rocks"]) {
    assert.equal(emit("mining:deplete-rock", { player: owner, rock, handled: false }).handled, true, rock);
  }
  assert.equal(emit("mining:deplete-rock", { player: owner, rock: "Coal rocks", handled: false }).handled, false);
  assert.equal(emit("mining:deplete-rock", { player: unequipped, rock: "Iron rocks", handled: false }).handled, false);
});

test("Homewrecker: Woodcutting's own nest roll is x2 likelier and the nest goes to the bank", () => {
  const Woodcutting = require("../plugins/skills/Woodcutting.plugin");
  Woodcutting._test.setApi({ emitCustomEvent: (name, payload) => emit(name, payload), getItemOnGroundManager: () => ({ registers: (player, item) => ground.push([player, item.getId(), item.getAmount()]) }) });
  const { owner, main } = cases(F.homewrecker);
  Math.random = () => 1.5 / 256; // past 1/256, inside 2/256
  Woodcutting._test.maybeDropBirdNest(owner);
  Woodcutting._test.maybeDropBirdNest(main);
  const nests = [I.BIRD_NEST, I.BIRD_NEST_2, I.BIRD_NEST_3, I.BIRD_NEST_10, I.BIRD_NEST_5];
  assert.equal(nests.reduce((sum, id) => sum + banked(owner, id), 0), 1, "a nest in the bank");
  assert.equal(ground.length, 0, "nothing on the floor, and nothing for the main character");
  assert.match(owner.messages.at(-1), /sent to your bank/);
});

test("Message In A Bottle: clue vessels x3 at level 1; Catch Of The Day rolls the rare drop table; Chinchonkers", () => {
  const bottle = cases(F.messageInABottle);
  assert.equal(emit("treasure-trails:vessel-chance", { player: bottle.owner, vessel: "nest", multiplier: 1 }).multiplier, 3);
  assert.equal(emit("treasure-trails:vessel-chance", { player: bottle.main, vessel: "nest", multiplier: 1 }).multiplier, 1);

  const fisher = cases(F.catchOfTheDay);
  const held = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0).length;
  const before = new Map([fisher.owner, fisher.unequipped].map((player) => [player, held(player)]));
  const loot = (player) => ({ length: held(player) - before.get(player) });
  Math.random = () => 0; // 1 in 300, and the table's first slot
  emit("fishing:success", { player: fisher.owner, itemId: I.RAW_SHRIMPS });
  emit("fishing:success", { player: fisher.unequipped, itemId: I.RAW_SHRIMPS });
  assert.equal(loot(fisher.owner).length, 1, "a rare drop table item");
  assert.match(fisher.owner.messages.at(-1), /while fishing/);
  assert.equal(loot(fisher.unequipped).length, 0);
  emit("fishing:success", { player: fisher.owner, itemId: null, source: "fishing-trawler" });
  assert.equal(loot(fisher.owner).length, 1, "a Fishing Trawler trip is no catch");

  const hunter = cases(F.chinchonkers);
  const chin = core.NpcIdentifiers.CHINCHOMPA;
  const level1 = emit("hunter:rewards", { player: hunter.owner, kind: "box", npcId: chin, rewards: [[I.CHINCHOMPA, 1]], xp: 198.4 });
  assert.equal(level1.xp, 198.4 * 1.5);
  assert.deepEqual(level1.rewards, [[I.CHINCHOMPA, 1]]);
  master(hunter.owner, F.chinchonkers);
  const level3 = emit("hunter:rewards", { player: hunter.owner, kind: "box", npcId: chin, rewards: [[I.CHINCHOMPA, 1]], xp: 198.4 });
  assert.equal(level3.xp, 198.4 * 2);
  assert.deepEqual(level3.rewards, [[I.CHINCHOMPA, 2]]);
  const ferret = emit("hunter:rewards", { player: hunter.owner, kind: "box", npcId: core.NpcIdentifiers.FERRET, rewards: [[I.FERRET, 1]], xp: 115 });
  assert.equal(ferret.xp, 115, "not a chinchompa");
});
