// Run after `yarn build`: node --test tests/league-fragments-production.test.cjs
// Shattered Relics' production fragments, The Alchemist, The Craftsman and Unchained Talent
// (docs/leagues.md "Shattered Relics"), with real players: a Shattered Relics character with the
// fragment equipped, the same character with it owned but not equipped, and a main character.
// Herblore's own cleaning and mixing, Smithing's own session loop and Construction's own use of a
// build's materials run as they do in game; the other events are built by hand in the shape the
// skills send them (the enchant loop, the Lunar batch and the alchemy policy are checked live).
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
  plankStretcher: 28, smithingDouble: 31, rumpleBowString: 32, dragonOnABit: 33, imcandosApprentice: 34,
  enchantedJeweler: 35, alchemaniac: 36, profletchional: 37, proTips: 38, dineAndDash: 40, mixologist: 43,
  justDruid: 44, rootyTooty: 47,
  // Unchained Talent pieces that do nothing to production themselves.
  catchOfTheDay: 22, slashAndBurn: 25,
};

let core;
let I;
let obj;
const hooks = {};
const custom = {};
let worldLeague = 3;
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  I = core.ItemIdentifiers;
  obj = (name) => core.CacheDefinitions.getObjId(name);
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
  require("../plugins/skills/herblore/Events.Herblore")(api);
});

afterEach(() => {
  Math.random = realRandom;
});

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

function character(name, { league = 3, profile = "league" } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new core.Location(3200, 3200, 0));
  player.setRegistered(true);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  const previous = worldLeague;
  worldLeague = league;
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  worldLeague = previous;
  return player;
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

function unequipAll(player) {
  const previousLocation = player.getLocation();
  player.setLocation(new core.Location(2809, 3440, 0));
  player.setInterfaceId(FRAGMENTS);
  hooks[`button:${uid(FRAGMENTS, 16)}`]({ player, buttonId: uid(FRAGMENTS, 16) });
  player.setInterfaceId(-1);
  player.setLocation(previousLocation);
  assert.ok(player.getAttribute("league:fragment-slots").every((id) => id === 0), "native Unequip all cleared the loadout");
}

/** Level 3 (8,000 fragment XP, script 5789). */
function master(player, id) {
  player.setAttribute("league:fragments", { ...player.getAttribute("league:fragments"), [id]: 8000 });
}

/** The owner (equipped, at level 3 when asked), the same character with it owned but not equipped, and a main character. */
function cases(id, level = 1) {
  const owner = shattered(`owner${id}`);
  equip(owner, id);
  if (level === 3) master(owner, id);
  const unequipped = shattered(`unequipped${id}`);
  own(unequipped, id);
  return { owner, others: [unequipped, character(`main${id}`, { profile: "main" })] };
}

function xp(player, skill) {
  return player.getSkillManager().getExperience(core.Skill[skill]);
}

function banked(player, itemId) {
  return player.getBank(core.Bank.getTabForItem(player, itemId)).getAmount(itemId);
}

/** `skills:produced`, as the skill's loop sends it. */
function produce(player, skill, kind, itemId, amount, xpEach, materials = null) {
  return emit("skills:produced", { player, skill: core.Skill[skill], itemId, amount, xp: xpEach, kind, materials });
}

const actions = (player, skill, kind) => emit("skills:actions-per-cycle", { player, skill: core.Skill[skill], kind, actions: 1 }).actions;

/** XP `amount` is worth at the league's rate, from a fresh character. */
function rated(skill, amount) {
  const player = shattered(`rated${skill}${amount}`);
  const before = xp(player, skill);
  player.getSkillManager().addExperiences(core.Skill[skill], amount);
  return xp(player, skill) - before;
}

// ---- The sets ----

test("The Alchemist: cooking, cleaning and mixing all at once with three pieces; nothing else", () => {
  const player = shattered("alchemist");
  equip(player, F.dineAndDash, F.mixologist);
  assert.equal(actions(player, "COOKING", "cook"), 1, "two pieces are no set");
  equip(player, F.justDruid);
  assert.equal(actions(player, "COOKING", "cook"), 28);
  assert.equal(actions(player, "HERBLORE", "clean"), 28);
  assert.equal(actions(player, "HERBLORE", "mix"), 28);
  assert.equal(actions(player, "SMITHING", "smelt"), 1, "The Craftsman's");
  assert.equal(actions(character("alchemistmain", { profile: "main" }), "COOKING", "cook"), 1);
});

/** A fletching recipe's own group in plugins/skills/data/fletching.json (gem bolt tips are "boltTips" since d0710deec). */
function fletchingGroup(output) {
  const recipe = require("../plugins/skills/data/fletching.json").recipes.find((entry) => entry.output === output);
  assert.ok(recipe, `a fletching recipe makes ${output}`);
  return recipe.group;
}

test("The Craftsman: the Wiki's activities all at once, through Smithing's own session loop", () => {
  const player = shattered("craftsman");
  equip(player, F.rumpleBowString, F.dragonOnABit, F.imcandosApprentice);
  for (const [skill, kind] of [["SMITHING", "smelt"], ["SMITHING", "smith"], ["SMITHING", "cannonballs"], ["CRAFTING", "leather"],
    ["CRAFTING", "glassblowing"], ["CRAFTING", "gems"], ["CRAFTING", "pottery"], ["CRAFTING", "battlestaves"], ["CRAFTING", "spinning"],
    ["FLETCHING", "logs"], ["FLETCHING", "chisel"], ["FLETCHING", fletchingGroup("SAPPHIRE_BOLT_TIPS")]]) {
    assert.equal(actions(player, skill, kind), 28, `${skill} ${kind}`);
  }
  for (const [skill, kind] of [["CRAFTING", "jewellery"], ["CRAFTING", "weaving"], ["FLETCHING", "arrows"], ["COOKING", "cook"]]) {
    assert.equal(actions(player, skill, kind), 1, `${skill} ${kind} is not on the Wiki's list`);
  }

  const tasks = [];
  const loopApi = {
    core, emitCustomEvent: (name, payload) => emit(name, payload),
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }), onServerStartup: (start) => start(),
  };
  require("../plugins/skills/smithing/Core.Smithing").init(loopApi);
  const Sessions = require("../plugins/skills/smithing/Sessions.Smithing");
  Sessions(loopApi);
  const plain = shattered("plainsmith");
  const smithed = new Map([[player, 0], [plain, 0]]);
  for (const smith of smithed.keys()) {
    Sessions.start(smith, { type: "smith", remaining: 5, interval: 1, step: () => { smithed.set(smith, smithed.get(smith) + 1); return true; } });
  }
  tasks[0].execute();
  for (const smith of smithed.keys()) Sessions.stop(smith, false);
  assert.equal(smithed.get(player), 5, "five bars in the first cycle");
  assert.equal(smithed.get(plain), 1);
});

test("Unchained Talent: the non-combat skills 8 over their level every tick while the set is on, back once it is off", () => {
  const player = shattered("unchained");
  equip(player, F.plankStretcher, F.catchOfTheDay, F.slashAndBurn);
  const skills = player.getSkillManager();
  const level = (name) => skills.getCurrentLevel(core.Skill[name]);
  emit("league:fragment-tick", { player });
  assert.equal(level("MINING"), skills.getMaxLevel(core.Skill.MINING) + 8);
  assert.equal(level("AGILITY"), skills.getMaxLevel(core.Skill.AGILITY) + 8, "not limited to unlocked skills");
  assert.equal(level("ATTACK"), skills.getMaxLevel(core.Skill.ATTACK), "not a combat skill");
  skills.setCurrentLevel(core.Skill.MINING, skills.getMaxLevel(core.Skill.MINING) + 3, true);
  emit("league:fragment-tick", { player });
  assert.equal(level("MINING"), skills.getMaxLevel(core.Skill.MINING) + 8, "restored after it fell");
  unequipAll(player);
  emit("league:fragment-tick", { player });
  assert.equal(level("MINING"), skills.getMaxLevel(core.Skill.MINING), "off with the set");
  const main = character("unchainedmain", { profile: "main" });
  emit("league:fragment-tick", { player: main });
  assert.equal(main.getSkillManager().getCurrentLevel(core.Skill.MINING), main.getSkillManager().getMaxLevel(core.Skill.MINING));
});

// ---- Extra products ----

test("Smithing Double: an anvil's product again with its XP at the chance; not a smelted bar", () => {
  const { owner, others } = cases(F.smithingDouble);
  Math.random = () => 0.01;
  const before = xp(owner, "SMITHING");
  produce(owner, "SMITHING", "smith", I.BRONZE_PLATEBODY, 1, 62.5);
  assert.equal(owner.getInventory().getAmount(I.BRONZE_PLATEBODY), 1);
  assert.equal(xp(owner, "SMITHING") - before, rated("SMITHING", 62.5));
  produce(owner, "SMITHING", "smelt", I.BRONZE_BAR, 1, 6.2);
  assert.equal(owner.getInventory().getAmount(I.BRONZE_BAR), 0);
  for (const player of others) {
    produce(player, "SMITHING", "smith", I.BRONZE_PLATEBODY, 1, 62.5);
    assert.equal(player.getInventory().getAmount(I.BRONZE_PLATEBODY), 0, player.getUsername());
  }
  Math.random = () => 0.5;
  produce(owner, "SMITHING", "smith", I.BRONZE_PLATEBODY, 1, 62.5);
  assert.equal(owner.getInventory().getAmount(I.BRONZE_PLATEBODY), 1, "past 5%");
});

test("Imcando's Apprentice: gemmed jewellery again with its XP, only with room; plain gold none", () => {
  const { owner, others } = cases(F.imcandosApprentice);
  Math.random = () => 0.1;
  produce(owner, "CRAFTING", "jewellery", I.SAPPHIRE_RING, 1, 40, [[I.GOLD_BAR, 1], [I.SAPPHIRE, 1]]);
  assert.equal(owner.getInventory().getAmount(I.SAPPHIRE_RING), 1);
  produce(owner, "CRAFTING", "jewellery", I.GOLD_RING, 1, 15, [[I.GOLD_BAR, 1]]);
  assert.equal(owner.getInventory().getAmount(I.GOLD_RING), 0, "no gem");
  owner.getInventory().adds(I.BRONZE_BAR, 26);
  produce(owner, "CRAFTING", "jewellery", I.SAPPHIRE_RING, 1, 40, [[I.GOLD_BAR, 1], [I.SAPPHIRE, 1]]);
  assert.equal(owner.getInventory().getAmount(I.SAPPHIRE_RING), 1, "a full inventory gets none");
  for (const player of others) {
    produce(player, "CRAFTING", "jewellery", I.SAPPHIRE_RING, 1, 40, [[I.GOLD_BAR, 1], [I.SAPPHIRE, 1]]);
    assert.equal(player.getInventory().getAmount(I.SAPPHIRE_RING), 0, player.getUsername());
  }
});

test("Dragon On A Bit: dragonhide armour's leather back to the bank; other leather not", () => {
  const { owner, others } = cases(F.dragonOnABit);
  Math.random = () => 0.05;
  produce(owner, "CRAFTING", "leather", I.GREEN_DHIDE_BODY, 1, 186, [[I.GREEN_DRAGON_LEATHER, 3]]);
  assert.equal(banked(owner, I.GREEN_DRAGON_LEATHER), 3);
  produce(owner, "CRAFTING", "leather", I.LEATHER_BODY, 1, 25, [[I.LEATHER, 1]]);
  assert.equal(banked(owner, I.LEATHER), 0);
  // A d'hide shield, as Leather's combine sends it: the leather back, the maple shield and nails used.
  produce(owner, "CRAFTING", "leather", I.GREEN_DHIDE_SHIELD, 1, 124, [[I.GREEN_DRAGON_LEATHER, 2], [I.MAPLE_SHIELD, 1], [I.STEEL_NAILS, 15]]);
  assert.deepEqual([banked(owner, I.GREEN_DRAGON_LEATHER), banked(owner, I.MAPLE_SHIELD), banked(owner, I.STEEL_NAILS)], [5, 0, 0]);
  for (const player of others) {
    produce(player, "CRAFTING", "leather", I.GREEN_DHIDE_BODY, 1, 186, [[I.GREEN_DRAGON_LEATHER, 3]]);
    assert.equal(banked(player, I.GREEN_DRAGON_LEATHER), 0, player.getUsername());
  }
});

test("Dine & Dash: another cooked food to the bank, with no XP; never in an instance", () => {
  const { owner, others } = cases(F.dineAndDash);
  Math.random = () => 0.05;
  const before = xp(owner, "COOKING");
  produce(owner, "COOKING", "cook", I.LOBSTER, 1, 120);
  assert.equal(banked(owner, I.LOBSTER), 1);
  assert.equal(xp(owner, "COOKING"), before, "no XP");
  owner.getPrivateArea = () => ({});
  produce(owner, "COOKING", "cook", I.LOBSTER, 1, 120);
  assert.equal(banked(owner, I.LOBSTER), 1, "not in an instance");
  for (const player of others) {
    produce(player, "COOKING", "cook", I.LOBSTER, 1, 120);
    assert.equal(banked(player, I.LOBSTER), 0, player.getUsername());
  }
});

test("Profletchional and Pro Tips: more XP for logs and stringing; more bolt tips a gem, rounded down", () => {
  const fletcher = cases(F.profletchional);
  let before = xp(fletcher.owner, "FLETCHING");
  produce(fletcher.owner, "FLETCHING", "logs", I.MAPLE_LONGBOW_U, 1, 58.3);
  assert.equal(xp(fletcher.owner, "FLETCHING") - before, rated("FLETCHING", 58.3 * 0.3));
  before = xp(fletcher.owner, "FLETCHING");
  produce(fletcher.owner, "FLETCHING", "arrows", I.HEADLESS_ARROW, 15, 15);
  assert.equal(xp(fletcher.owner, "FLETCHING"), before, "not arrows");
  for (const player of fletcher.others) {
    before = xp(player, "FLETCHING");
    produce(player, "FLETCHING", "stringing", I.MAPLE_LONGBOW, 1, 58.3);
    assert.equal(xp(player, "FLETCHING"), before, player.getUsername());
  }

  const tips = cases(F.proTips);
  const boltTips = fletchingGroup("SAPPHIRE_BOLT_TIPS");
  produce(tips.owner, "FLETCHING", boltTips, I.SAPPHIRE_BOLT_TIPS, 12, 4);
  assert.equal(tips.owner.getInventory().getAmount(I.SAPPHIRE_BOLT_TIPS), 3, "30% of 12, rounded down");
  for (const player of tips.others) {
    produce(player, "FLETCHING", boltTips, I.SAPPHIRE_BOLT_TIPS, 12, 4);
    assert.equal(player.getInventory().getAmount(I.SAPPHIRE_BOLT_TIPS), 0, player.getUsername());
  }
});

// ---- Herblore's own cleaning and mixing ----

test("through Herblore's own cleaning: Just Druid! adds 10% of each herb's XP; The Alchemist cleans all of them at once", () => {
  let clean;
  require("../plugins/skills/herblore/Cleaning.Herblore")(new Proxy({ core }, {
    get: (target, key) => (key in target ? target[key] : (handler) => { if (key === "onItemFirstAction") clean = handler; }),
  }));
  const grimy = obj("unidentified_guam");
  const leaf = obj("guam_leaf");
  const run = (player) => {
    const skills = player.getSkillManager();
    skills.setMaxLevels(core.Skill.HERBLORE, 10, false);
    skills.setCurrentLevels(core.Skill.HERBLORE, 10, false);
    player.getInventory().adds(grimy, 1).adds(grimy, 1).adds(grimy, 1);
    const before = xp(player, "HERBLORE");
    clean({ player, itemId: grimy, slot: player.getInventory().getItems().findIndex((item) => item?.getId() === grimy) });
    return [player.getInventory().getAmount(leaf), xp(player, "HERBLORE") - before];
  };
  const druid = cases(F.justDruid);
  const [plainCleaned, plainXp] = run(druid.others[0]);
  assert.equal(plainCleaned, 1);
  const [cleaned, gained] = run(druid.owner);
  assert.equal(cleaned, 1, "one a click without the set");
  assert.equal(gained, plainXp + rated("HERBLORE", 2.5 * 0.1), "the herb's 2.5 XP and 10% more");

  const alchemist = shattered("alchemistclean");
  equip(alchemist, F.dineAndDash, F.mixologist, F.justDruid);
  assert.equal(run(alchemist)[0], 3, "all three at once");
});

test("through Herblore's own mixing: Mixologist makes the 4-dose potion and keeps the secondary at its chances", () => {
  let mix;
  require("../plugins/skills/herblore/Mixing.Herblore")(new Proxy({ core }, {
    get: (target, key) => (key in target ? target[key] : (handler) => { if (key === "onItemOnItem") mix = handler; }),
  }));
  const unf = obj("guamvial");
  const newt = obj("eye_of_newt");
  const brew = (player) => {
    const skills = player.getSkillManager();
    skills.setMaxLevels(core.Skill.HERBLORE, 10, false);
    skills.setCurrentLevels(core.Skill.HERBLORE, 10, false);
    player.getInventory().adds(unf, 1).adds(newt, 1);
    mix({ player, usedItemId: newt, usedWithItemId: unf, handled: false });
    const inventory = player.getInventory();
    return [inventory.getAmount(obj("4dose1attack")), inventory.getAmount(obj("3dose1attack")), inventory.getAmount(newt)];
  };
  const { owner, others } = cases(F.mixologist, 3);
  Math.random = () => 0.99;
  assert.deepEqual(brew(owner), [1, 0, 1], "level 3: always four doses, the eye of newt kept");
  for (const player of others) assert.deepEqual(brew(player), [0, 1, 0], player.getUsername());
  const level1 = shattered("mixologist1");
  equip(level1, F.mixologist);
  Math.random = () => 0.22; // under 25% for the doses, over 20% for the secondary
  assert.deepEqual(brew(level1), [1, 0, 0]);

  // A recipe whose first ingredient is no potion (the haemostatic poultice): it is still used up; only the cotton yarn is kept.
  const poultice = obj("haemostatic_poultice");
  const yarn = obj("cotton_yarn");
  const skills = owner.getSkillManager();
  skills.setMaxLevels(core.Skill.HERBLORE, 60, false);
  skills.setCurrentLevels(core.Skill.HERBLORE, 60, false);
  owner.getInventory().adds(poultice, 1).adds(yarn, 1);
  Math.random = () => 0.99;
  mix({ player: owner, usedItemId: yarn, usedWithItemId: poultice, handled: false });
  assert.equal(owner.getInventory().getAmount(obj("4dosehaemostaticdressing")), 1, "level 3: four doses");
  assert.equal(owner.getInventory().getAmount(poultice), 0, "the poultice is used");
  assert.equal(owner.getInventory().getAmount(yarn), 1, "the cotton yarn is kept");
});

// ---- Runes, planks, enchanting, Spin Flax, High Alchemy ----

test("Rooty Tooty 2x Runeys: each rune crafted has its chance of another", () => {
  const { owner, others } = cases(F.rootyTooty);
  assert.equal(emit("runecrafting:success", { player: shattered("rootyNoAmount"), rolls: 3, runeId: I.AIR_RUNE }).amountPerEssence, undefined);
  const rolls = [0.1, 0.9, 0.1, 0.9, 0.9, 0.9];
  Math.random = () => rolls.shift() ?? 0.9;
  emit("runecrafting:success", { player: owner, rolls: 3, amountPerEssence: 2, runeId: I.AIR_RUNE });
  assert.equal(owner.getInventory().getAmount(I.AIR_RUNE), 2, "two of six runes passed 20%");
  for (const player of others) {
    Math.random = () => 0;
    emit("runecrafting:success", { player, rolls: 3, amountPerEssence: 2, runeId: I.AIR_RUNE });
    assert.equal(player.getInventory().getAmount(I.AIR_RUNE), 0, player.getUsername());
  }
});

test("Plank Stretcher, Enchanted Jeweler, Rumple-Bow-String and Alchemaniac", () => {
  // Construction's own use of a build's materials (getBuildMaterials' map), as a hotspot, the stairs and the workbench use it.
  require("../plugins/skills/construction/Core.Construction").init({ core, emitCustomEvent: (name, payload) => emit(name, payload) });
  const House = require("../plugins/skills/construction/House.Construction");
  const build = (player) => {
    player.getInventory().adds(I.OAK_PLANK, 4).adds(I.STEEL_NAILS, 2);
    House.useMaterials(player, { key: "test" }, new Map([[I.OAK_PLANK, 4], [I.STEEL_NAILS, 2]]));
    return [player.getInventory().getAmount(I.OAK_PLANK), player.getInventory().getAmount(I.STEEL_NAILS)];
  };
  const planks = cases(F.plankStretcher);
  Math.random = () => 0.05;
  assert.deepEqual(build(planks.owner), [4, 0], "planks kept, nails used");
  for (const player of planks.others) assert.deepEqual(build(player), [0, 0], player.getUsername());
  Math.random = () => 0.5;
  assert.deepEqual(build(shattered("plankslevel1")), [0, 0], "no fragment, no saving");

  // The workbench's own flatpack build with a full inventory: the planks kept free no slot, so the flatpack falls.
  const Workbench = require("../plugins/skills/construction/Workbench.Construction")._test;
  const [key, flatpack] = [...Workbench.FLATPACK_OF.entries()][0];
  const bench = { house: {}, limit: 99 };
  const fell = [];
  const saved = { houseFor: House.houseFor, getBuildMaterials: House.getBuildMaterials };
  const registers = core.ItemOnGroundManager.registers;
  House.houseFor = () => bench.house;
  House.getBuildMaterials = () => new Map([[I.OAK_PLANK, 2]]);
  core.ItemOnGroundManager.registers = (player, item) => fell.push(item.getId());
  try {
    const crafter = cases(F.plankStretcher).owner;
    crafter.performAnimation = () => {};
    crafter.getInventory().adds(I.OAK_PLANK, 27); // with the class's scimitar, a full inventory
    Math.random = () => 0.05;
    Workbench.makeFlatpack(crafter, bench, { key, level: 1, experience: 60 });
    assert.equal(crafter.getInventory().getAmount(I.OAK_PLANK), 27, "the planks kept");
    assert.deepEqual(fell, [flatpack], "the flatpack on the floor, not lost");
  } finally {
    Object.assign(House, saved);
    core.ItemOnGroundManager.registers = registers;
  }

  const jeweler = cases(F.enchantedJeweler);
  assert.equal(emit("magic:enchant-pieces", { player: jeweler.owner, itemId: I.SAPPHIRE_RING, pieces: 1 }).pieces, 5);
  assert.equal(emit("magic:enchant-pieces", { player: jeweler.owner, itemId: obj("silvthrill_rod"), pieces: 1 }).pieces, 1, "a quest's rod is no jewellery");
  assert.equal(emit("magic:enchant-pieces", { player: jeweler.others[0], itemId: I.SAPPHIRE_RING, pieces: 1 }).pieces, 1);

  const spinner = cases(F.rumpleBowString, 3);
  assert.equal(emit("magic:spell-batch", { player: spinner.owner, spellName: "Spin Flax", batch: 5 }).batch, 27);
  assert.equal(emit("magic:spell-batch", { player: spinner.owner, spellName: "Tan Leather", batch: 5 }).batch, 5, "only Spin Flax");
  assert.equal(emit("magic:spell-batch", { player: spinner.others[1], spellName: "Spin Flax", batch: 5 }).batch, 5);

  const alcher = cases(F.alchemaniac);
  assert.equal(emit("magic:alchemy-policy", { player: alcher.owner, high: true, coins: 1000 }).coins, 1150);
  assert.equal(emit("magic:alchemy-policy", { player: alcher.owner, high: false, coins: 1000 }).coins, 1000, "High Alchemy only");
  assert.equal(emit("magic:alchemy-policy", { player: alcher.others[0], high: true, coins: 1000 }).coins, 1000);
});
