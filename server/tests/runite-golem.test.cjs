// Run after `yarn build`: node --test tests/runite-golem.test.cjs
//
// Wiki Runite Golem: a killed golem's head becomes a rock, minable by anyone with 85 Mining for 1 minute, and the
// golem respawns 5 minutes afterward. Wilderness Diary elite: "Smith a rune scimitar from scratch in the Resource
// Area". No capture shows a death or the rock, so the golem's rules are the Wiki's and ours (RuniteGolem.plugin.js).
//
// Real packets: npc_option on the rock, object_option and the creation menu at the furnace, the anvil's widget.
// Fixture seams: the killer is mocked into the NPCDeathTask setHitpoints(0) starts, rather than fought; Math.random
// is held low only inside Mining's own task, so a swing lands. Held across a whole tick it spun GemstoneCrab's pickSpot,
// a draw-until-different loop, whenever the crab burrowed in the hold from the spot the hold draws. Superheat goes through the spell's own handler, not a magic packet. Golems are made
// here at the spawn tiles, not the world's own spawns. The tick loop doesn't run npc.process(), so nothing here sees
// a golem wander; only the minute's test and the wander test run it, and the wander test gives the golem a radius and
// an active region by hand. Emitted directly, not played: smelting:success in the same-golem test, diary:task for the
// other task, smithing:success in the no-steps and outside-anvil tests, the step events for the reset tests.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { NPCOptionPacketListener } = require("../dist/net/packet/impl/NPCOptionPacketListener");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const Mining = require("../plugins/skills/Mining.plugin");
const SmithingData = require("../plugins/skills/smithing/Data.Smithing");
const Superheat = require("../plugins/skills/smithing/Superheat.Smithing");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const DIARY = Diaries.BY_KEY.get("wilderness");
const TASK = "smith-a-rune-scimitar-from-scratch-in-the-resour";
const OTHER_TASK = "mine-some-iron-ore-in-the-wilderness";
const ATTRIBUTE = "wilderness-diary:resource-area";
const GOLEM = 6600;
const ROCK = 6601;
const NO_ORE = 7722;
const SOUTH_EAST = [3191, 3934];
const NORTH_WEST = [3178, 3938];
const INSIDE = [3185, 3935];
const OUTSIDE = [3200, 3935];

let core;
let I;
let next = 9800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3184, 3944);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at = INSIDE, level = 99) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("golemqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  for (const skill of [core.Skill.SMITHING, core.Skill.MAGIC]) {
    p.getSkillManager().setCurrentLevel(skill, 99);
    p.getSkillManager().setMaxLevel(skill, 99);
  }
  p.getSkillManager().setCurrentLevel(core.Skill.MINING, level);
  p.getSkillManager().setMaxLevel(core.Skill.MINING, level);
  const f = { p, c, inv: p.getInventory(), messages };
  f.inv.add(new core.Item(I.RUNE_PICKAXE, 1), false);
  return f;
}

function tick(f, count) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    f.c.processTurnPackets();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getSession().flushClient(core.World.processCycle);
    f.p.resetUpdating();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function golemAt(t, tile) {
  const npc = core.NPC.create(GOLEM, new core.Location(tile[0], tile[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => { if (npc.isRegistered()) core.World.getNpcs().remove(npc); });
  return npc;
}

/** A real NPCDeathTask, with this player as the killer. */
function kill(t, f, npc) {
  t.mock.method(npc.getCombat(), "getKiller", () => f.p);
  npc.setHitpoints(0);
  for (let i = 0; i < 15 && npc.getNpcTransformationId() !== ROCK; i++) tick(f, 1);
  assert.equal(npc.getNpcTransformationId(), ROCK, "control: its head becomes a rock");
}

/**
 * Low enough for an ore (under 19/256) and an infernal burn (under 1/3), and never a gem (255/256), for Mining's task
 * alone: every other task keeps real draws.
 */
function holdMiningRollsLow(t) {
  const { prototype } = core.Task;
  const taskTick = prototype.tick;
  prototype.tick = function tick() {
    if (this.constructor.name !== "MiningTask") return taskTick.call(this);
    const real = Math.random;
    Math.random = () => 0.01;
    try {
      return taskTick.call(this);
    } finally {
      Math.random = real;
    }
  };
  const restore = () => { prototype.tick = taskTick; };
  t.after(restore);
  return { restore };
}

async function mine(t, f, npc) {
  const at = npc.getLocation();
  f.p.setLocation(new core.Location(at.getX() - 1, at.getY(), 0));
  const random = holdMiningRollsLow(t);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: 1 });
  tick(f, 30);
  random.restore();
}

/** One golem killed and mined; returns it. */
async function killAndMine(t, f, tile) {
  const npc = golemAt(t, tile);
  kill(t, f, npc);
  await mine(t, f, npc);
  return npc;
}

const progress = (f) => f.p.getAttribute(ATTRIBUTE) ?? {};
const done = (f) => DiaryProgress.doneTasks(f.p, DIARY).has(TASK);

function findLoc(name, inside) {
  for (const list of MapObjects.mapObjects.values()) {
    for (const object of list) {
      const at = object.getLocation();
      if (at.getZ() === 0 && inside(at.getX(), at.getY()) && object.getDefinition?.()?.getName?.() === name) {
        return { id: object.getId(), x: at.getX(), y: at.getY() };
      }
    }
  }
  return null;
}

const inResourceArea = (x, y) => x >= 3174 && x <= 3197 && y >= 3925 && y <= 3944;

async function smeltTwo(f, furnace) {
  // The furnace's ops are [null, "Smelt", ...], so Smelt is the second, as the client sends it.
  const clickType = core.ObjectDefinition.forId(furnace.id).getInteractions().indexOf("Smelt") + 1;
  assert.ok(clickType > 0, "control: the furnace has Smelt");
  await send(f, { type: "object_option", id: furnace.id, x: furnace.x, y: furnace.y, clickType });
  tick(f, 30);
  const menu = f.p.getCreationMenu();
  assert.ok(menu, `control: the furnace opened its menu: ${JSON.stringify(f.messages.slice(-2))}`);
  const index = menu.getItems().indexOf(I.RUNITE_BAR);
  assert.ok(index >= 0, "control: runite bar is on the menu");
  await send(f, { type: "dialogue_continue", widgetId: (270 << 16) | (15 + index), childIndex: 2 });
  tick(f, 20);
  assert.equal(f.inv.getAmount(I.RUNITE_BAR), 2, "control: two bars");
}

async function smithScimitar(f) {
  const anvil = [2097, 2031].map((id) => {
    for (let x = 3174; x <= 3197; x++) {
      for (let y = 3925; y <= 3944; y++) if (core.MapObjects.get(id, new core.Location(x, y, 0), null)) return { id, x, y };
    }
    return null;
  }).find(Boolean);
  assert.ok(anvil, "control: an anvil in the area");
  await send(f, { type: "object_option", id: anvil.id, x: anvil.x, y: anvil.y, clickType: 1 });
  tick(f, 30);
  const product = SmithingData.productsFor(I.RUNITE_BAR).find((candidate) => candidate.itemId === I.RUNE_SCIMITAR);
  await send(f, {
    type: "widget_action", widgetId: (312 << 16) | product.component, groupId: 312, childId: product.component, buttonNum: 1, slot: 0,
  });
  tick(f, 12);
  assert.equal(f.inv.getAmount(I.RUNE_SCIMITAR), 1, "control: a scimitar was smithed");
}

function kit(f) {
  f.inv.add(new core.Item(I.HAMMER, 1), false);
  f.inv.add(new core.Item(I.COAL, 16), false);
}

// ------------------------------------------------------------------ the golem

test("a killed golem's rock gives a runite ore and 125 XP, once, then it is a spent rock", async (t) => {
  const f = actor(t);
  const xp = f.p.getSkillManager().getExperience(core.Skill.MINING);
  const npc = golemAt(t, SOUTH_EAST);
  kill(t, f, npc);
  await mine(t, f, npc);
  assert.equal(f.inv.getAmount(I.RUNITE_ORE), 1, "one ore");
  assert.ok(f.p.getSkillManager().getExperience(core.Skill.MINING) > xp, "and Mining XP");
  assert.equal(npc.getNpcTransformationId(), NO_ORE, "the cache's no-ore form");
  await mine(t, f, npc);
  assert.equal(f.inv.getAmount(I.RUNITE_ORE), 1, "a spent rock gives nothing");
});

test("the rock needs 85 Mining and a pickaxe; a living golem can't be mined", async (t) => {
  const low = actor(t, INSIDE, 84);
  const npc = golemAt(t, SOUTH_EAST);
  kill(t, low, npc);
  await mine(t, low, npc);
  assert.equal(low.inv.getAmount(I.RUNITE_ORE), 0, "84 Mining");
  assert.equal(npc.getNpcTransformationId(), ROCK, "and the rock stays");

  const bare = actor(t);
  bare.inv.setItem(0, new core.Item(-1, 0));
  await mine(t, bare, npc);
  assert.equal(bare.inv.getAmount(I.RUNITE_ORE), 0, "no pickaxe");

  const f = actor(t);
  const living = golemAt(t, NORTH_WEST);
  await mine(t, f, living);
  assert.equal(f.inv.getAmount(I.RUNITE_ORE), 0, "not before it dies");
});

test("two miners on one rock: one ore in all", async (t) => {
  const first = actor(t);
  const second = actor(t);
  const npc = golemAt(t, SOUTH_EAST);
  kill(t, first, npc);
  const at = npc.getLocation();
  first.p.setLocation(new core.Location(at.getX() - 1, at.getY(), 0));
  second.p.setLocation(new core.Location(at.getX() - 1, at.getY(), 0));
  const random = holdMiningRollsLow(t);
  await send(first, { type: "npc_option", index: npc.getIndex(), clickType: 1 });
  await send(second, { type: "npc_option", index: npc.getIndex(), clickType: 1 });
  assert.equal(Mining.isMiningActive(second.p), true, "control: the second miner did start");
  for (let i = 0; i < 30; i++) {
    tick(first, 1);
    tick(second, 1);
  }
  random.restore();
  assert.equal(first.inv.getAmount(I.RUNITE_ORE) + second.inv.getAmount(I.RUNITE_ORE), 1, "one ore");
});

test("an infernal pickaxe's destroyed ore still counts the step, as the Wiki says", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.INFERNAL_PICKAXE, 1));
  await killAndMine(t, f, SOUTH_EAST);
  assert.equal(f.inv.getAmount(I.RUNITE_ORE), 0, "control: the pinned roll burnt the ore");
  assert.equal(progress(f).golems.length, 1, "and the step counts");
});

test("a spell, an arrow and a melee click don't hit the rock, whole or spent, and a queued hit doesn't re-kill it", async (t) => {
  const f = actor(t);
  const spellId = CombatSpells.getCombatSpellByName("Wind Strike").spellId();
  const attack = (npc) => send(f, { type: "npc_option", index: npc.getIndex(), clickType: 2 });
  const gear = {
    melee: () => {},
    arrow: () => {
      f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.MAGIC_SHORTBOW, 1));
      f.p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(I.RUNE_ARROW, 100));
    },
  };

  const living = golemAt(t, NORTH_WEST);
  f.p.setLocation(new core.Location(living.getLocation().getX() - 1, living.getLocation().getY(), 0));
  for (const [name, equip] of Object.entries(gear)) {
    equip();
    await attack(living);
    // A boolean: an NPC as an operand would have the reporter serialise the world on a failure.
    assert.equal(f.p.getCombat().getTarget() === living, true, `control: ${name} targets a living golem`);
    f.p.getCombat().reset();
  }
  assert.equal(NPCOptionPacketListener.castSpell(f.p, living.getIndex(), spellId), true, "control: the spell takes a living golem");
  f.p.getCombat().reset();
  f.p.getCombat().setCastSpell(null);
  core.World.getNpcs().remove(living);

  const npc = golemAt(t, SOUTH_EAST);
  kill(t, f, npc);
  const unharmed = (form, label) => {
    assert.equal(npc.getNpcTransformationId(), form, `${label}: the form stays`);
    assert.equal(npc.getHitpoints(), 1, `${label}: its hitpoints stay`);
    assert.equal(npc.isDyingFunction(), false, `${label}: it doesn't die again`);
  };
  f.p.setLocation(new core.Location(npc.getLocation().getX() - 1, npc.getLocation().getY(), 0));
  for (const form of [ROCK, NO_ORE]) {
    if (form === NO_ORE) await mine(t, f, npc);
    for (const [name, equip] of Object.entries(gear)) {
      equip();
      await attack(npc);
      assert.equal(f.p.getCombat().getTarget() === npc, false, `${form}: ${name} doesn't target it`);
      tick(f, 6);
      unharmed(form, `${form}, ${name}`);
    }
    assert.equal(NPCOptionPacketListener.castSpell(f.p, npc.getIndex(), spellId), false, `${form}: the spell is refused`);
    tick(f, 6);
    unharmed(form, `${form}, spell`);
    npc.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(50, core.HitMask.RED)]);
    for (let i = 0; i < 3; i++) {
      npc.process();
      tick(f, 1);
    }
    unharmed(form, `${form}, a hit queued before it died`);
  }
});

test("a poisoned golem's rock takes no poison", async (t) => {
  const f = actor(t);
  const npc = golemAt(t, SOUTH_EAST);
  npc.setPoisonDamage(20);
  core.TaskManager.submit(new core.CombatPoisonEffect(npc));
  assert.equal(npc.isPoisoned(), true, "control: poisoned");
  kill(t, f, npc);
  const hits = t.mock.method(npc.getCombat().getHitQueue(), "addPendingDamage");
  tick(f, 35); // The effect's next hit is 30 ticks after it starts, past the death's.
  assert.equal(npc.isPoisoned(), false, "cured by the death");
  assert.equal(hits.mock.callCount(), 0, "no splat on a rock");
  assert.equal(npc.getHitpoints(), 1, "and its hitpoints stay");
  assert.equal(npc.getNpcTransformationId(), ROCK);
});

test("a golem wanders, and its rock stays where it died", async (t) => {
  const f = actor(t);
  const isLocationActive = core.World.isLocationActive;
  core.World.isLocationActive = () => true;
  t.after(() => { core.World.isLocationActive = isLocationActive; });
  const walk = (npc) => {
    // Under the wander roll of 0.26, for these npc.process() calls alone: no task runs in them.
    const real = Math.random;
    Math.random = () => 0.1;
    const from = npc.getLocation().clone();
    try {
      for (let i = 0; i < 10; i++) npc.process();
    } finally {
      Math.random = real;
    }
    return !npc.getLocation().equals(from);
  };
  const living = golemAt(t, NORTH_WEST);
  living.getMovementCoordinator().setRadius(3);
  assert.equal(walk(living), true, "control: a living golem walks");
  const npc = golemAt(t, SOUTH_EAST);
  npc.getMovementCoordinator().setRadius(3);
  kill(t, f, npc);
  assert.equal(walk(npc), false, "the rock doesn't");
});

test("the rock lasts a minute in the NPC's own loop, and the golem comes back 5 minutes after", async (t) => {
  const f = actor(t);
  const npc = golemAt(t, SOUTH_EAST);
  // Other tests' golems come back in this one, so count this golem's own.
  const clones = [];
  const clone = npc.clone.bind(npc);
  t.mock.method(npc, "clone", () => {
    const made = clone();
    clones.push(made);
    return made;
  });
  kill(t, f, npc);
  for (let i = 0; i < 95; i++) {
    npc.process();
    tick(f, 1);
  }
  assert.equal(npc.isRegistered(), true, "still there just inside the minute");
  assert.equal(npc.getNpcTransformationId(), ROCK, "and still a rock");
  tick(f, 10);
  const removals = core.World.getRemoveNPCQueue();
  assert.ok(removals.includes(npc), "gone after it");
  removals.splice(removals.indexOf(npc), 1);
  tick(f, 490);
  assert.equal(clones.length, 0, "not yet back");
  tick(f, 15);
  assert.equal(clones.length, 1, "back");
  const [back] = clones;
  assert.equal(back.getId(), GOLEM, "a golem, not a rock");
  assert.ok(back.getHitpoints() > 1, "with its full hitpoints");
  assert.equal(back.isHitpointsLocked(), false, "and can be hit");
  const queue = core.World.getAddNPCQueue();
  queue.splice(queue.indexOf(back), 1);
});

// ------------------------------------------------------------------ the diary task

test("the whole chain by real packets credits the elite task, and not before the anvil", async (t) => {
  const furnace = findLoc("Furnace", inResourceArea);
  assert.ok(furnace, "control: a furnace in the area");
  const f = actor(t);
  kit(f);
  await killAndMine(t, f, SOUTH_EAST);
  await killAndMine(t, f, NORTH_WEST);
  assert.equal(f.inv.getAmount(I.RUNITE_ORE), 2, "control: two ores");
  assert.equal(progress(f).golems.length, 2);
  f.p.setLocation(new core.Location(INSIDE[0], INSIDE[1], 0));
  await smeltTwo(f, furnace);
  assert.equal(progress(f).bars, 2, "two bars count");
  assert.equal(done(f), false, "not before the scimitar");
  await smithScimitar(f);
  assert.equal(done(f), true, "credited");
  assert.deepEqual(progress(f).golems, [], "and the progress is spent");
});

test("the same golem twice doesn't count as two", async (t) => {
  const f = actor(t);
  await killAndMine(t, f, SOUTH_EAST);
  await killAndMine(t, f, SOUTH_EAST);
  assert.equal(f.inv.getAmount(I.RUNITE_ORE), 2, "control: both rocks gave ore");
  assert.equal(progress(f).golems.length, 1);
  PM.emitCustomEvent("smelting:success", { player: f.p, skill: core.Skill.SMITHING, itemId: I.RUNITE_BAR, furnaceId: 1 });
  assert.equal(progress(f).bars, 0, "and a bar doesn't count before the second golem");
});

test("Superheat Item doesn't count for the bars", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.COAL, 16), false);
  f.inv.add(new core.Item(I.NATURE_RUNE, 10), false);
  f.inv.add(new core.Item(I.FIRE_RUNE, 100), false);
  await killAndMine(t, f, SOUTH_EAST);
  await killAndMine(t, f, NORTH_WEST);
  const slot = f.inv.getItems().findIndex((held) => held?.getId() === I.RUNITE_ORE);
  Superheat.castOnItem({ spellName: "Superheat Item", player: f.p, itemId: I.RUNITE_ORE, slot, handled: false });
  tick(f, 3);
  assert.equal(f.inv.getAmount(I.RUNITE_BAR), 1, "control: the spell made a bar");
  assert.equal(progress(f).bars, 0, "and it doesn't count");
});

test("a furnace outside the area doesn't count for the bars", async (t) => {
  const f = actor(t);
  kit(f);
  await killAndMine(t, f, SOUTH_EAST);
  await killAndMine(t, f, NORTH_WEST);
  const at = new core.Location(OUTSIDE[0] + 1, OUTSIDE[1], 0);
  const furnaceId = core.ObjectIdentifiers.FURNACE; // On a test tile outside the fence.
  const loc = new core.GameObject(furnaceId, at, 10, 0);
  MapObjects.add(loc);
  t.after(() => MapObjects.remove(loc));
  f.p.setLocation(new core.Location(OUTSIDE[0], OUTSIDE[1], 0));
  await smeltTwo(f, { id: furnaceId, x: at.getX(), y: at.getY() });
  assert.equal(progress(f).bars, 0, "no bar counts");
});

test("mining a rock another player's kill left gives ore, but no step", async (t) => {
  const killer = actor(t);
  const miner = actor(t);
  const npc = golemAt(t, SOUTH_EAST);
  kill(t, killer, npc);
  await mine(t, miner, npc);
  assert.equal(miner.inv.getAmount(I.RUNITE_ORE), 1, "the ore");
  assert.equal((progress(miner).golems ?? []).length, 0, "no step for the miner");
  assert.equal((progress(killer).golems ?? []).length, 0, "nor for the killer, who didn't mine it");
});

test("updating another task in between resets it, as the Wiki says; its own steps don't", async (t) => {
  const f = actor(t);
  await killAndMine(t, f, SOUTH_EAST);
  await killAndMine(t, f, NORTH_WEST);
  assert.equal(progress(f).golems.length, 2, "control: its own steps kept the first");
  PM.emitCustomEvent("fishing:success", { player: f.p, skill: core.Skill.FISHING, itemId: I.RAW_DARK_CRAB, petBase: 0, petRolled: false });
  assert.equal(progress(f).crab, true, "control: the crab step was taken");
  assert.deepEqual(progress(f).golems, [], "the other task's step reset this one");
});

test("a rune step resets a magic logs cut, too", async (t) => {
  const f = actor(t);
  PM.emitCustomEvent("woodcutting:success", {
    player: f.p, skill: core.Skill.WOODCUTTING, petBase: 0, petRolled: false, logId: I.MAGIC_LOGS, logAmount: 1, location: { x: 3180, y: 3932, z: 0 },
  });
  assert.equal(progress(f).cut, true, "control: the cut step");
  await killAndMine(t, f, SOUTH_EAST);
  assert.equal(progress(f).cut, false);
});

test("the progress survives a save and reload", async (t) => {
  const f = actor(t);
  await killAndMine(t, f, SOUTH_EAST);
  const reloaded = actor(t);
  PlayerSave.fromPlayer(f.p).applyToPlayer(reloaded.p);
  assert.equal(progress(reloaded).golems.length, 1);
});

test("an anvil outside the area doesn't count", async (t) => {
  const f = actor(t);
  f.p.setAttribute(ATTRIBUTE, { golems: ["a", "b"], bars: 2 });
  f.p.setLocation(new core.Location(OUTSIDE[0], OUTSIDE[1], 0));
  const smith = () => PM.emitCustomEvent("smithing:success", {
    player: f.p, skill: core.Skill.SMITHING, itemId: I.RUNE_SCIMITAR, amount: 1, source: "anvil", objectId: 2097,
  });
  smith();
  assert.equal(done(f), false);
  f.p.setLocation(new core.Location(INSIDE[0], INSIDE[1], 0));
  smith();
  assert.equal(done(f), true, "control: the same steps inside do");
});

test("another task completing in between resets it", async (t) => {
  const f = actor(t);
  await killAndMine(t, f, SOUTH_EAST);
  assert.equal(progress(f).golems.length, 1, "control: one golem counted");
  PM.emitCustomEvent("diary:task", { player: f.p, diary: "wilderness", task: OTHER_TASK });
  assert.equal(DiaryProgress.doneTasks(f.p, DIARY).has(OTHER_TASK), true, "control: the other task completed");
  assert.deepEqual(progress(f).golems, [], "the progress is gone");
});

test("smithing a rune scimitar without the steps credits nothing", (t) => {
  const f = actor(t);
  PM.emitCustomEvent("smithing:success", { player: f.p, skill: core.Skill.SMITHING, itemId: I.RUNE_SCIMITAR, amount: 1, source: "anvil", objectId: 2097 });
  assert.equal(done(f), false);
});
