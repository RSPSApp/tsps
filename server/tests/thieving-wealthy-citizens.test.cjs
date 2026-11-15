// Run after `yarn build`: node --test tests/thieving-wealthy-citizens.test.cjs
// Civitas illa Fortis: street urchins distract the Wealthy citizens (Wiki: Wealthy citizen; rsprox captures
// 1695, 2332, 3273, 1098-1105, local 1001312, 1001568, 1001592), and the house key's dry streak (1104, 3273).
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Location } = require("../dist/game/model/Location");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");

const Thieving = require("../plugins/skills/Thieving.plugin");
const Wealthy = require("../plugins/skills/thieving/WealthyCitizens.Thieving");
const Pickpocket = require("../plugins/skills/thieving/Pickpocket.Thieving");

const { DATA } = Wealthy._test;
const log = [];
const world = { cycle: 1000, npcs: [], players: [] };
const submitted = [];
const handlers = new Map();
let core;

function seq(name) {
  return CacheDefinitions.getSeqId(name);
}

function npcOf(gameval, x, y) {
  const id = CacheDefinitions.getNpcId(gameval);
  let at = new Location(x, y, 0);
  let interacting = null;
  return {
    gameval,
    scripted: false,
    getId: () => id,
    getIndex: () => id,
    isRegistered: () => true,
    getPrivateArea: () => null,
    getLocation: () => at,
    moveTo(tile) { at = tile; },
    getTimers: () => ({ registers: () => {} }),
    setScriptedMovement(value) { this.scripted = value; },
    getMovementQueue: () => ({ reset: () => {}, hasPendingWork: () => false }),
    flags: new Set(),
    setFlag(flag, on = true) { if (on) this.flags.add(flag); else this.flags.delete(flag); },
    setMobileInteraction(mobile) { interacting = mobile; log.push(`${gameval} face ${mobile ? mobile.gameval : "null"}`); },
    getInteractingMobile: () => interacting,
    setPositionToFace: () => {},
    forceChat(text) { log.push(`${gameval} says ${text}`); },
    performAnimation(animation) { log.push(`${gameval} seq ${animation.getId()} delay ${animation.getDelay?.() ?? 0}`); },
    getAttackAnim: () => 422,
  };
}

function playerAt(x, y, attributes = {}, level = 99) {
  const attrs = new Map(Object.entries(attributes));
  const items = new Map();
  let interacting = null;
  const me = {
    log: [],
    items,
    attrs,
    isRegistered: () => true,
    getLocation: () => new Location(x, y, 0),
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    sendMessage(text) { me.log.push(`game: ${text}`); },
    getPacketSender: () => ({
      sendTypedMessage: (_type, text) => me.log.push(`spam: ${text}`),
      sendSoundEffect: (id, loops, delay) => me.log.push(`sound ${id} delay ${delay}`),
      sendVarbit: (id, value) => me.log.push(`varbit ${id}=${value}`),
    }),
    getClickDelay: () => ({ elapsedTime: () => true, reset: () => {} }),
    getSkillManager: () => ({ getCurrentLevel: () => level, getMaxLevel: () => level, addExperiences: (_s, xp) => me.log.push(`xp ${xp}`) }),
    getTimers: () => ({ getTicks: () => 0 }),
    getInventory: () => ({
      isFull: () => false,
      getAmount: (id) => items.get(id) ?? 0,
      forceAdd: (_p, item) => items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()),
      getItems: () => [],
    }),
    getBank: () => ({ getItems: () => [] }),
    getEquipment: () => ({ get: () => null }),
    getMovementQueue: () => ({ reset: () => {}, walkToEntity: (_npc, then) => { me.log.push("walk to the citizen"); then(); } }),
    setPositionToFace: () => {},
    getInteractingMobile: () => interacting,
    setMobileInteraction(mobile) { interacting = mobile; },
    performAnimation: (animation) => me.log.push(`anim ${animation.getId()}`),
    getIndex: () => 7,
    getDialogueManager: () => ({ startDialogues: () => me.log.push("level box") }),
    getHitpoints: () => 10,
  };
  return me;
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const real = PM.getCoreApi();
  core = {
    ...real,
    World: {
      getNpcs: () => world.npcs,
      getPlayers: () => world.players,
      getProcessCycle: () => world.cycle,
    },
    TaskManager: { submit: (task) => { task.setRunning?.(true); submitted.push(task); } },
    CombatFactory: { inCombat: () => false },
    PathFinder: { calculateWalkRoute: (npc, x, y) => { log.push(`${npc.gameval} walks to ${x},${y}`); npc.moveTo(new Location(x, y, 0)); } },
    RegionManager: { blocked: () => false },
    Sounds: { sendSound: () => {} },
  };
  const api = {
    core,
    onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    emitCustomEvent: (name, payload) => (handlers.get(name) ?? []).forEach((handler) => handler(payload)),
    persistAttribute() {}, onPlayerLogin() {}, onPlayerLogout() {}, onServerStartup() {},
    onNpcsInteraction() {}, onNpcInteraction() {}, onObjectInteraction() {}, onBeforeObjectInteraction() {}, onItemAction() {},
    onItemOnObject() {}, onItemOnNpc() {}, log: () => {},
  };
  Thieving.register(api);
});

beforeEach(() => {
  log.length = 0;
  submitted.length = 0;
  world.npcs = [];
  world.players = [];
  world.cycle += 1000;
});

/** Math.random answering the given values in turn, then the last one. */
function randoms(...values) {
  const original = Math.random;
  let i = 0;
  Math.random = () => values[Math.min(i++, values.length - 1)];
  return () => { Math.random = original; };
}

test("the data names cache npcs, sequences, the key and its varbit", () => {
  for (const name of [...DATA.urchins, ...DATA.citizens]) assert.notEqual(CacheDefinitions.getNpcId(name), null, name);
  assert.deepEqual(DATA.urchins.map((name) => NpcDefinition.forId(CacheDefinitions.getNpcId(name)).getName()), ["Leo", "Julia", "Aurelia"]);
  for (const scenario of DATA.scenarios) for (const name of [...scenario.urchinEmotes, scenario.citizenEmote]) assert.notEqual(seq(name), null, name);
  // Captured ids: emote_cry 860, emote_think 857, emote_clap 865, emote_dance 866, emote_dance_spin 2107.
  assert.deepEqual(["emote_cry", "emote_think", "emote_clap", "emote_dance", "emote_dance_spin"].map(seq), [860, 857, 865, 866, 2107]);
  assert.equal(CacheDefinitions.getObjId(DATA.keyPity.key), 29325);
  assert.equal(CacheDefinitions.getVarbitId(DATA.keyPity.varbit), 9942);
});

test("a scene plays the captured timeline: opening, walk-up, emotes every 4 ticks, lines on 20/23/39, release on 40, last line on 41", () => {
  const leo = npcOf("varlamore_thieving_street_urchin_a", 1681, 3106);
  const near = npcOf("varlamore_wealthy_citizen_d", 1679, 3101);
  const far = npcOf("varlamore_wealthy_citizen_a", 1690, 3106);
  world.npcs = [leo, far, near];
  const witness = playerAt(1680, 3101);
  const away = playerAt(1690, 3101);
  world.players = [witness, away];
  // Scenario 0 ("injured"), every list's first line, and the commotion line (random < 0.5).
  const restore = randoms(0);
  try {
    const scenes = Wealthy._test.startScenes();
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].citizen, near, "the nearest wealthy citizen answers");
    assert.ok(leo.scripted, "the urchin stands still");
    const byTick = { 0: [...log] };
    for (let t = 1; t <= 41; t++) {
      log.length = 0;
      const going = Wealthy._test.playScene(scenes[0], t);
      byTick[t] = [...log];
      assert.equal(going, t < 41, `tick ${t}`);
    }
    assert.deepEqual(byTick[0], ["varlamore_thieving_street_urchin_a says My leg! Someone please!"]);
    assert.deepEqual(byTick[2], [
      "varlamore_wealthy_citizen_d face varlamore_thieving_street_urchin_a",
      "varlamore_wealthy_citizen_d walks to 1681,3105",
      "varlamore_wealthy_citizen_d says What's all the commotion about?",
    ]);
    for (const t of [4, 8, 12, 16, 24, 28, 32, 36]) {
      assert.deepEqual(byTick[t], ["varlamore_thieving_street_urchin_a seq 860 delay 0", "varlamore_wealthy_citizen_d seq 857 delay 30"], `tick ${t}`);
    }
    for (const t of [1, 3, 5, 19, 21, 22, 37, 38]) assert.deepEqual(byTick[t], [], `tick ${t}`);
    assert.deepEqual(byTick[20], ["varlamore_thieving_street_urchin_a says It burns like an inferno!"]);
    assert.deepEqual(byTick[23], ["varlamore_wealthy_citizen_d says I hope you're okay."]);
    assert.deepEqual(byTick[39], ["varlamore_thieving_street_urchin_a says Woah! My leg has healed!", "varlamore_wealthy_citizen_d seq 857 delay 0"]);
    assert.deepEqual(byTick[40], ["varlamore_wealthy_citizen_d face null"]);
    assert.deepEqual(byTick[41], ["varlamore_wealthy_citizen_d says That was strange."]);
    assert.equal(near.scripted, false, "the citizen wanders again");
    assert.equal(near.flags.has("interaction:keep"), false, "and lets go of the urchin");
    assert.equal(leo.scripted, false, "and the urchin");
  } finally {
    restore();
  }
  // Players within 6 tiles of the urchin get the notice and the sound (synth 2119, delay 30); 9 tiles away don't.
  assert.deepEqual(witness.log, [`game: ${DATA.notice}`, "sound 2119 delay 30"]);
  assert.deepEqual(away.log, []);
});

test("the citizen keeps facing the urchin from afar, and walks again when a passer-by cut its walk short", () => {
  const leo = npcOf("varlamore_thieving_street_urchin_a", 1680, 3108);
  const citizen = npcOf("varlamore_wealthy_citizen_a", 1686, 3104);
  world.npcs = [leo, citizen];
  const [scene] = Wealthy._test.startScenes();
  const walk = core.PathFinder.calculateWalkRoute;
  const walks = [];
  // The first walk is blocked two tiles in; the next one gets there.
  core.PathFinder.calculateWalkRoute = (npc, x, y) => { walks.push(`${x},${y}`); npc.moveTo(walks.length === 1 ? new Location(1684, 3104, 0) : new Location(x, y, 0)); };
  try {
    for (let t = 1; t <= 5; t++) Wealthy._test.playScene(scene, t);
  } finally {
    core.PathFinder.calculateWalkRoute = walk;
  }
  assert.ok(citizen.flags.has("interaction:keep"), "NPC.process would drop the face past 2 tiles");
  assert.equal(citizen.getInteractingMobile(), leo);
  assert.equal(walks.length, 2, "one retry, then it stands beside Leo");
  assert.ok(Math.max(Math.abs(citizen.getLocation().getX() - 1680), Math.abs(citizen.getLocation().getY() - 3108)) <= 1);
});

test("the dancer gets dance emotes, claps and admiring replies", () => {
  const julia = npcOf("varlamore_thieving_street_urchin_b", 1712, 3104);
  const citizen = npcOf("varlamore_wealthy_citizen_b", 1710, 3104);
  world.npcs = [julia, citizen];
  const dancing = DATA.scenarios.findIndex((s) => s.key === "dancing");
  // Pick the dancing scenario, then no commotion (0.9), then first entries.
  const restore = randoms(dancing / DATA.scenarios.length, 0.9, 0);
  try {
    const [scene] = Wealthy._test.startScenes();
    assert.equal(scene.scenario.key, "dancing");
    log.length = 0;
    for (let t = 1; t <= 23; t++) Wealthy._test.playScene(scene, t);
    assert.ok(!log.some((line) => line.includes("commotion")));
    assert.ok(log.includes(`varlamore_thieving_street_urchin_b seq ${seq("emote_dance")} delay 0`));
    assert.ok(log.includes(`varlamore_wealthy_citizen_b seq ${seq("emote_clap")} delay 30`));
    assert.ok(log.includes("varlamore_thieving_street_urchin_b says I could do this all day!"));
    assert.ok(log.includes("varlamore_wealthy_citizen_b says Who taught you to move like that?"));
  } finally {
    restore();
  }
});

test("every urchin starts at once with its own citizen; one notice per player; no citizen in reach, no scene", () => {
  const leo = npcOf("varlamore_thieving_street_urchin_a", 1681, 3106);
  const aurelia = npcOf("varlamore_thieving_street_urchin_c", 1680, 3087);
  const julia = npcOf("varlamore_thieving_street_urchin_b", 1712, 3104);
  const one = npcOf("varlamore_wealthy_citizen_d", 1681, 3104);
  const two = npcOf("varlamore_wealthy_citizen_b", 1680, 3090);
  world.npcs = [leo, aurelia, julia, one, two];
  const between = playerAt(1680, 3097);
  const both = playerAt(1681, 3093);
  world.players = [between, both];
  const scenes = Wealthy._test.startScenes();
  assert.deepEqual(scenes.map((s) => [s.urchin.gameval, s.citizen.gameval]), [
    ["varlamore_thieving_street_urchin_a", "varlamore_wealthy_citizen_d"],
    ["varlamore_thieving_street_urchin_c", "varlamore_wealthy_citizen_b"],
  ], "Julia has no citizen within 10 tiles");
  assert.equal(julia.scripted, false);
  assert.deepEqual(between.log, [], "9 tiles from Leo and 10 from Aurelia");
  assert.deepEqual(both.log, [`game: ${DATA.notice}`, "sound 2119 delay 30"], "within 6 of Aurelia: one notice");
});

test("the clock starts a scene every 140-165 ticks, start to start", () => {
  const { state } = Wealthy._test;
  const leo = npcOf("varlamore_thieving_street_urchin_a", 1681, 3106);
  world.npcs = [leo, npcOf("varlamore_wealthy_citizen_d", 1681, 3104)];
  state.scenes = [];
  state.tick = 0;
  state.nextStart = 0;
  const starts = [];
  const restore = randoms(0.99);
  try {
    for (let t = 0; t < 700; t++) {
      const before = state.scenes.length;
      Wealthy._test.processScenes();
      if (state.scenes.some((scene) => scene.startedAt === t) && state.scenes.length >= before) starts.push(t);
    }
  } finally {
    restore();
  }
  assert.deepEqual(starts.slice(1).map((t, i) => t - starts[i]), [165, 165, 165, 165], "random 0.99 is the long end, 165 ticks");
});

function distractedScene(witnesses) {
  const leo = npcOf("varlamore_thieving_street_urchin_a", 1681, 3106);
  const citizen = npcOf("varlamore_wealthy_citizen_d", 1681, 3104);
  world.npcs = [leo, citizen];
  world.players = witnesses;
  Wealthy._test.startScenes();
  return citizen;
}

function pickpocketEvent(player, npc) {
  return { player, npc, npcId: npc.getId(), definition: { getName: () => "Wealthy citizen" } };
}

/** Ticks every submitted task, as the TaskManager does, for `ticks` game ticks. */
function runTicks(ticks) {
  const active = [];
  for (let t = 0; t < ticks; t++) {
    active.push(...submitted.splice(0));
    world.cycle++;
    for (const task of [...active]) {
      if (!task.tick()) active.splice(active.indexOf(task), 1);
    }
    active.push(...submitted.splice(0));
  }
}

test("a witness's pickpocket on a distracted citizen always succeeds, every 2 ticks, until the distraction ends", () => {
  const thief = playerAt(1681, 3103);
  const citizen = distractedScene([thief]);
  const started = world.cycle;
  thief.setMobileInteraction(citizen);
  // A roll that always fails on its own: only the distraction makes it a success.
  const restore = randoms(0.999);
  const attempts = [];
  const logAttempt = thief.getPacketSender;
  thief.getPacketSender = () => ({ ...logAttempt(), sendTypedMessage: (_type, text) => { thief.log.push(`spam: ${text}`); if (text.startsWith("You attempt")) attempts.push(world.cycle - started); } });
  try {
    Pickpocket._test.pickpocket(pickpocketEvent(thief, citizen));
    runTicks(60);
  } finally {
    restore();
  }
  const successes = thief.log.filter((line) => line === "spam: You pick the wealthy citizen's pocket.").length;
  assert.equal(thief.log.filter((line) => line.startsWith("spam: You fail")).length, 0);
  // The click is tick 0; each success asks for the next attempt a tick later (rsprox 1104: an attempt every 2 ticks).
  assert.deepEqual(attempts, Array.from({ length: 20 }, (_, i) => i * 2), "the last attempt starts on tick 38, inside the 40");
  assert.equal(successes, attempts.length);
  assert.ok(!thief.log.includes(`spam: ${DATA.sweatyLine}`));
});

test("a thief who missed the start gets the sweaty-hands line (red, on the attempt) and no reward", () => {
  const late = playerAt(1681, 3103);
  const citizen = distractedScene([]);
  const restore = randoms(0);
  try {
    Pickpocket._test.pickpocket(pickpocketEvent(late, citizen));
  } finally {
    restore();
  }
  assert.deepEqual(late.log.slice(0, 2), [`game: ${DATA.sweatyLine}`, "spam: You attempt to pick the wealthy citizen's pocket."]);
  assert.ok(DATA.sweatyLine.startsWith("<col=ef1020>"), "Wiki: color=red");
  const done = { player: late, npc: citizen, kind: "pickpocket", succeeded: true, again: false };
  Wealthy._test.keepPickpocketing(done);
  assert.equal(done.again, false);
  submitted.length = 0;
});

test("a click the pickpocket refuses (too low a level) gets no sweaty line", () => {
  const novice = playerAt(1681, 3103, {}, 30);
  const citizen = distractedScene([]);
  Pickpocket._test.pickpocket(pickpocketEvent(novice, citizen));
  assert.deepEqual(novice.log, ["level box"]);
});

test("each urchin has its own witnesses: watching Leo doesn't count for Aurelia's citizen", () => {
  const leo = npcOf("varlamore_thieving_street_urchin_a", 1681, 3106);
  const aurelia = npcOf("varlamore_thieving_street_urchin_c", 1680, 3087);
  const leosCitizen = npcOf("varlamore_wealthy_citizen_d", 1681, 3104);
  const aureliasCitizen = npcOf("varlamore_wealthy_citizen_b", 1680, 3090);
  world.npcs = [leo, aurelia, leosCitizen, aureliasCitizen];
  const watcher = playerAt(1681, 3103);
  world.players = [watcher];
  Wealthy._test.startScenes();
  const atLeo = { player: watcher, npc: leosCitizen, target: { key: "wealthy_citizen" }, alwaysSucceeds: false };
  Wealthy._test.distractedTarget(atLeo);
  assert.equal(atLeo.alwaysSucceeds, true);
  const atAurelia = { player: watcher, npc: aureliasCitizen, target: { key: "wealthy_citizen" }, alwaysSucceeds: false };
  Wealthy._test.distractedTarget(atAurelia);
  assert.equal(atAurelia.alwaysSucceeds, false);
  assert.equal(typeof atAurelia.onAttempt, "function", "an unwitnessed scene: the sweaty line on the attempt");
});

test("other targets and undistracted citizens are left alone", () => {
  const thief = playerAt(1681, 3103);
  const citizen = npcOf("varlamore_wealthy_citizen_d", 1681, 3104);
  const request = { player: thief, npc: citizen, target: { key: "wealthy_citizen" }, alwaysSucceeds: false };
  Wealthy._test.distractedTarget(request);
  assert.equal(request.alwaysSucceeds, false);
  const distracted = distractedScene([thief]);
  const man = { player: thief, npc: distracted, target: { key: "man" }, alwaysSucceeds: false };
  Wealthy._test.distractedTarget(man);
  assert.equal(man.alwaysSucceeds, false);
  assert.deepEqual(thief.log.filter((l) => l.includes("sweaty")), []);
});

test("a caught wealthy citizen shouts the captured line", () => {
  const target = Pickpocket.targetFor("Wealthy citizen", CacheDefinitions.getNpcId("varlamore_wealthy_citizen_a"));
  assert.equal(target.catchLine, "Get out of my pockets!");
});

test("the house key's dry streak: counts successes, gives the key alone at 40, any key resets it", () => {
  const { keyDryStreak, KEY_DRY_STREAK_ATTRIBUTE } = Wealthy._test;
  const key = CacheDefinitions.getObjId(DATA.keyPity.key);
  const coins = core.ItemIdentifiers.COINS;
  const thief = playerAt(1681, 3103, { [KEY_DRY_STREAK_ATTRIBUTE]: 38 });
  const success = (loot) => { const event = { player: thief, target: "wealthy citizen", loot }; keyDryStreak(event); return event.loot; };
  assert.deepEqual(success([{ id: coins, amount: 85 }]), [{ id: coins, amount: 85 }]);
  assert.equal(thief.attrs.get(KEY_DRY_STREAK_ATTRIBUTE), 39);
  success([{ id: coins, amount: 85 }]);
  assert.equal(thief.attrs.get(KEY_DRY_STREAK_ATTRIBUTE), 40);
  // rsprox 1104/3273: old=40 -> new=0 with the key, and the loot tracker gets only the key.
  assert.deepEqual(success([{ id: coins, amount: 85 }]), [{ id: key, amount: 1 }]);
  assert.equal(thief.attrs.get(KEY_DRY_STREAK_ATTRIBUTE), 0);
  success([{ id: coins, amount: 85 }]);
  success([{ id: key, amount: 1 }]);
  assert.equal(thief.attrs.get(KEY_DRY_STREAK_ATTRIBUTE), 0, "a rolled key resets it too");
  assert.deepEqual(thief.log.filter((l) => l.startsWith("varbit")), ["varbit 9942=39", "varbit 9942=40", "varbit 9942=0", "varbit 9942=1", "varbit 9942=0"]);
  const other = { player: thief, target: "man", loot: [{ id: coins, amount: 3 }] };
  keyDryStreak(other);
  assert.equal(thief.log.filter((l) => l.startsWith("varbit")).length, 5, "other targets don't count");
});
