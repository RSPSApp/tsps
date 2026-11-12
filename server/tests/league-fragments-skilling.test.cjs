// Run after `yarn build`: node --test tests/league-fragments-skilling.test.cjs
// Shattered Relics' skilling fragments and Clued In (docs/leagues.md "Shattered Relics"), with real
// players: a Shattered Relics character with the fragment equipped, the same character with it owned
// but not equipped, and a main character. Prayer's own burial and Thieving's own success chance run
// as they do in game; the other events are built in the shape their content sends them.
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
const F = { prayingRespects: 10, smoothCriminal: 23, deeperPockets: 24, hotOnTheTrail: 27, goldenBrickRoad: 45, graveRobber: 46, cluedIn: 49, slashAndBurn: 25 };

let core;
let I;
let Pickpocket;
const hooks = {};
const custom = {};
let worldLeague = 3;
const realRandom = Math.random;
/** Stands in for the treasure trails' capacity: false refuses another scroll box. */
let mayReceive = true;

/** An api whose hooks this file doesn't need are no-ops, for attaching a skill's own module. */
const nothing = new Proxy(function nothing() {}, { get: () => nothing, apply: () => nothing });

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
  require("../plugins/modes/Base.LeagueMode").register(api);
  require("../plugins/modes/Points.LeagueMode").register(api);
  // Prayer's own "prayer:bury" answer; Thieving's own success chance.
  require("../plugins/skills/Prayer.plugin").register(new Proxy({ core }, {
    get: (target, key) => (key in target ? target[key] : key === "onCustomEvent"
      ? (name, handler) => { custom[name] = (custom[name] ?? []).concat(handler); }
      : key === "emitCustomEvent" ? (name, payload) => emit(name, payload) : nothing),
  }));
  Pickpocket = require("../plugins/skills/thieving/Pickpocket.Thieving");
  Pickpocket.register(new Proxy({ core }, { get: (target, key) => (key in target ? target[key] : nothing) }));
  custom["treasure-trails:can-receive"] = [(request) => { request.allowed = mayReceive; }];
});

afterEach(() => {
  Math.random = realRandom;
  mayReceive = true;
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

/** Level 2 (2,000 fragment XP) or 3 (8,000), script 5789. */
function level(player, id, which) {
  player.setAttribute("league:fragments", { ...player.getAttribute("league:fragments"), [id]: which === 3 ? 8000 : 2000 });
}

/** The owner (equipped, at `at` level), the same character with it owned but not equipped, and a main character. */
function cases(id, at = 1) {
  const owner = shattered(`owner${id}${at}`);
  equip(owner, id);
  if (at > 1) level(owner, id, at);
  const unequipped = shattered(`unequipped${id}${at}`);
  own(unequipped, id);
  return { owner, others: [unequipped, character(`main${id}${at}`, { profile: "main" })] };
}

function xp(player, skill) {
  return player.getSkillManager().getExperience(core.Skill[skill]);
}

// ---- Praying Respects ----

test("Praying Respects: a kill's bones and ashes are buried and scattered through Prayer's own burial, at 50% of their XP", () => {
  const { owner, others } = cases(F.prayingRespects);
  // What two bones at half their XP pay, through Prayer's own burial (fractional XP, as Prayer gives it).
  const plain = shattered("plainprayer");
  for (let bone = 0; bone < 2; bone++) emit("prayer:bury", { player: plain, itemId: I.BONES, scale: 0.5 });
  const drops = [{ itemId: I.BONES, amount: 2, noted: false }, { itemId: I.COINS, amount: 50, noted: false }, { itemId: I.VILE_ASHES, amount: 1, noted: false }];
  const roll = emit("npc-drops:roll", { player: owner, drops: drops.map((drop) => ({ ...drop })) });
  assert.deepEqual(roll.drops.map((drop) => drop.itemId), [I.COINS], "the remains are gone from the drop");
  const ashes = shattered("plainashes");
  const ashXp = (() => {
    const before = xp(ashes, "PRAYER");
    emit("prayer:bury", { player: ashes, itemId: I.VILE_ASHES, scale: 0.5 });
    return xp(ashes, "PRAYER") - before;
  })();
  assert.ok(ashXp > 0, "ashes scatter through prayer:bury too");
  assert.equal(xp(owner, "PRAYER"), xp(plain, "PRAYER") + ashXp, "two bones and the ashes at half their XP");
  for (const player of others) {
    const kept = emit("npc-drops:roll", { player, drops: drops.map((drop) => ({ ...drop })) });
    assert.equal(kept.drops.length, 3, player.getUsername());
  }
  assert.equal(emit("prayer:bury", { player: plain, itemId: I.VILE_ASHES, crushed: true, handled: false }).handled, false, "the bonecrusher still leaves ashes alone");
  const kept = emit("npc-drops:roll", { player: owner, drops: [{ itemId: I.SUPERIOR_DRAGON_BONES, amount: 1, noted: false }, { itemId: I.LONG_BONE, amount: 1, noted: false }] });
  assert.deepEqual(kept.drops.map((drop) => drop.itemId), [I.SUPERIOR_DRAGON_BONES, I.LONG_BONE], "not above the Prayer level, and not the long bone kept for Construction");
});

// ---- Smooth Criminal, Deeper Pockets ----

test("Smooth Criminal: Thieving's own success chance rises by its percent, stacking as the gloves do; no stun damage from level 2", () => {
  const man = Pickpocket.targetFor("Man", 3106) ?? Pickpocket.TARGETS[0];
  const { owner, others } = cases(F.smoothCriminal);
  const request = emit("thieving:pickpocket-target", { player: owner, target: man, chanceBonus: 0, painless: false });
  assert.equal(request.chanceBonus, 15);
  assert.equal(request.painless, false, "level 1 still hurts");
  const base = Pickpocket._test.successChance(owner, man);
  const boosted = Pickpocket._test.successChance(owner, { ...man, chanceBonus: request.chanceBonus });
  assert.ok(boosted > base, `${boosted} over ${base}`);
  for (const player of others) assert.equal(emit("thieving:pickpocket-target", { player, target: man, chanceBonus: 0, painless: false }).chanceBonus, 0);
  level(owner, F.smoothCriminal, 2);
  const two = emit("thieving:pickpocket-target", { player: owner, target: man, chanceBonus: 0, painless: false });
  assert.deepEqual([two.chanceBonus, two.painless], [25, true]);
});

test("Deeper Pockets: Thieving's own handover gives the loot twice at its chance: a pouch and its coins, never a second clue", () => {
  const { owner, others } = cases(F.deeperPockets);
  const target = Pickpocket.TARGETS.find((entry) => entry.coinPouch && !Array.isArray(entry.coinPouch.coins));
  const loot = [{ id: I.COINS, amount: 3 }, { id: I.BREAD, amount: 1 }, { id: I.SCROLL_BOX_EASY_, amount: 1, clue: true }];
  const pick = (player) => {
    const request = emit("thieving:loot", { player, loot, multiplier: 1 });
    Pickpocket._test.giveLoot(player, target, request.loot, () => 0.99, request.multiplier); // no rogue outfit
    const inventory = player.getInventory();
    return [inventory.getAmount(target.coinPouch.id), inventory.getAmount(I.COINS), inventory.getAmount(I.BREAD), inventory.getAmount(I.SCROLL_BOX_EASY_)];
  };
  Math.random = () => 0.1;
  assert.deepEqual(pick(owner), [1, target.coinPouch.coins, 2, 1], "one pouch and its coins, two breads, one clue");
  Math.random = () => 0.5;
  assert.deepEqual(pick(shattered("pocketslevel1")), [1, 0, 1, 1], "no fragment");
  Math.random = () => 0.1;
  for (const player of others) assert.deepEqual(pick(player), [1, 0, 1, 1], player.getUsername());

  // A full inventory holding a pouch stack and no coins: the pickpocket goes ahead (pouch loot only),
  // and the doubled pouch's coins fall to the floor rather than being lost.
  const fell = [];
  const registers = core.ItemOnGroundManager.registers;
  core.ItemOnGroundManager.registers = (player, item) => fell.push([item.getId(), item.getAmount()]);
  try {
    const full = shattered("pocketsfull");
    equip(full, F.deeperPockets);
    full.getInventory().adds(target.coinPouch.id, 1).adds(I.BRONZE_BAR, 26); // with the class's scimitar, 28 slots
    Math.random = () => 0.1;
    const request = emit("thieving:loot", { player: full, loot: [{ id: I.COINS, amount: 3 }], multiplier: 1 });
    Pickpocket._test.giveLoot(full, target, request.loot, () => 0.99, request.multiplier);
    assert.equal(full.getInventory().getAmount(target.coinPouch.id), 2, "the pouch stacks");
    assert.deepEqual(fell, [[I.COINS, target.coinPouch.coins]], "the bonus coins on the floor");
  } finally {
    core.ItemOnGroundManager.registers = registers;
  }
});

// ---- Hot On The Trail ----

test("Hot On The Trail: a lit log's tier of scroll box at its chance, Slash & Burn's logs too, only with room for another", () => {
  const { owner, others } = cases(F.hotOnTheTrail);
  Math.random = () => 0.01; // under 2%
  emit("firemaking:success", { player: owner, itemId: I.MAPLE_LOGS });
  assert.equal(owner.getInventory().getAmount(I.SCROLL_BOX_MEDIUM_), 1, "maple: medium");
  assert.match(owner.messages.at(-1), /medium scroll box/);
  emit("league:log-burnt", { player: owner, itemId: I.REDWOOD_LOGS });
  assert.equal(owner.getInventory().getAmount(I.SCROLL_BOX_MASTER_), 1, "a burnt redwood: master");
  const boxes = () => ["BEGINNER", "EASY", "MEDIUM", "HARD", "ELITE", "MASTER"].reduce((sum, tier) => sum + owner.getInventory().getAmount(I[`SCROLL_BOX_${tier}_`]), 0);
  emit("firemaking:success", { player: owner, itemId: I.JATOBA_LOGS });
  assert.equal(boxes(), 2, "no tier for a log the league predates");
  mayReceive = false;
  emit("firemaking:success", { player: owner, itemId: I.YEW_LOGS });
  assert.equal(owner.getInventory().getAmount(I.SCROLL_BOX_HARD_), 0, "not past the clue capacity");
  mayReceive = true;
  for (const player of others) {
    emit("firemaking:success", { player, itemId: I.MAPLE_LOGS });
    assert.equal(player.getInventory().getAmount(I.SCROLL_BOX_MEDIUM_), 0, player.getUsername());
  }
});

test("Slash & Burn's burnt logs reach Hot On The Trail", () => {
  require("../plugins/skills/firemaking/Logs.Firemaking").attach(new Proxy({ core }, {
    get: (target, key) => (key in target ? target[key] : key === "onCustomEvent"
      ? (name, handler) => { if (name === "firemaking:log-xp") custom[name] = [handler]; }
      : nothing),
  }));
  const player = shattered("burner");
  equip(player, F.slashAndBurn, F.hotOnTheTrail);
  Math.random = () => 0.01;
  emit("storage:gather", { player, itemId: I.WILLOW_LOGS, amount: 1, stored: 0, skill: core.Skill.WOODCUTTING, xp: 67.5 });
  assert.equal(player.getInventory().getAmount(I.WILLOW_LOGS), 0, "burnt");
  assert.equal(player.getInventory().getAmount(I.SCROLL_BOX_EASY_), 1, "willow: easy");
});

// ---- Golden Brick Road, Grave Robber, Clued In ----

test("Golden Brick Road: coins beside a mark of grace; Grave Robber: more hallowed marks; Clued In: 1 in 30 for each clue", () => {
  const road = cases(F.goldenBrickRoad, 3);
  const mark = emit("agility:mark", { player: road.owner, items: [[I.MARK_OF_GRACE, 1]] });
  assert.deepEqual(mark.items, [[I.MARK_OF_GRACE, 1], [I.COINS, 15000]]);
  assert.equal(emit("agility:mark", { player: road.others[0], items: [[I.MARK_OF_GRACE, 1]] }).items.length, 1);

  const robber = cases(F.graveRobber);
  Math.random = () => 0.6;
  assert.equal(emit("minigame:points", { player: robber.owner, minigame: "hallowed-sepulchre", points: 5 }).points, 7, "7.5 marks: the half mark missed");
  Math.random = () => 0.4;
  assert.equal(emit("minigame:points", { player: robber.owner, minigame: "hallowed-sepulchre", points: 1 }).points, 2, "1.5 marks: the half mark hit");
  assert.equal(emit("minigame:points", { player: robber.owner, minigame: "pest-control", points: 5 }).points, 5, "not another reward");
  assert.equal(emit("minigame:points", { player: robber.others[1], minigame: "hallowed-sepulchre", points: 5 }).points, 5);

  const clued = cases(F.cluedIn);
  const rules = emit("npc-drops:tertiary-chance", { player: clued.owner, rules: [] }).rules;
  assert.equal(rules.length, 1);
  assert.equal(rules[0].outOf, 30);
  assert.ok(rules[0].pattern.test("Clue scroll (hard)"), "every clue tier the NPC drops");
  assert.ok(!rules[0].pattern.test("Looting bag"), "not another tertiary");
  assert.equal(emit("npc-drops:tertiary-chance", { player: clued.others[0], rules: [] }).rules.length, 0);
});
