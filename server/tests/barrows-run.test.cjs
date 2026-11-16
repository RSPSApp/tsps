// Run after `yarn build`: node --test tests/barrows-run.test.cjs
// The Barrows run (plugins/minigames/Barrows.plugin.js): a looted run stays looted until the next
// crypt is dug into, as live keeps it (237/04057: looted, teleported to the surface, reset only by
// the spade's dig), so a teleport out of the chest room and back into it (the league Evil eye's
// "Barrows (chest)") finds the chest empty.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

let core;
let Barrows;
let diaryApi;
let cleanupPlayer;
const subjects = new Set();
let originalError;
let errors;
beforeEach(() => {
  errors = [];
  originalError = console.error;
  console.error = (...args) => errors.push(args);
});
afterEach(() => {
  const cleanupErrors = [];
  try {
    for (const subject of subjects) {
      try { cleanupPlayer?.({ player: subject }); } catch (error) { cleanupErrors.push(error); }
      try {
        core.TaskManager.cancelTasks(subject);
        assert.equal(core.TaskManager.hasActiveTask(subject), false);
      } catch (error) { cleanupErrors.push(error); }
      try { subject.setRegistered(false); } catch (error) { cleanupErrors.push(error); }
    }
  } finally {
    subjects.clear();
    console.error = originalError;
    assert.deepEqual({ cleanupErrors, errors }, { cleanupErrors: [], errors: [] }, "no hook or cleanup errors");
  }
});
const CHEST_ROOM = new Location(3551, 9694, 0);
const SURFACE = new Location(3565, 3288, 0);
const AHRIM_MOUND = new Location(3565, 3289, 0);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3551, 9694);
  Barrows = require("../plugins/minigames/Barrows.plugin");
  diaryApi = PluginManager.createApi("barrows-diary-native-test");
  diaryApi.onCustomEvent("diary:is-complete", Diaries._test.onIsComplete);
  diaryApi.onCustomEvent("collection-log:obtain", (event) => event.player.collected?.push([event.itemId, event.amount]));
  diaryApi.onCustomEvent("barrows:chest-looted", (event) => { event.player.chestEvents = (event.player.chestEvents ?? 0) + 1; });
  Barrows.register(new Proxy({
    core,
    getWorld: () => core.World,
    getRegionManager: () => core.RegionManager,
    getTaskManager: () => core.TaskManager,
    onPlayerLogout: (fn) => { cleanupPlayer = fn; },
    emitCustomEvent: (name, request) => diaryApi.emitCustomEvent(name, request),
    // A menu is logged as [title, ...option texts] on its player.
    sendMultiChatboxPrompt: (subject, title, ...rest) => (subject.prompts ??= []).push([title, ...rest.filter((entry) => typeof entry === "string")]),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function player() {
  const subject = new Player(null);
  subjects.add(subject);
  subject.setUsername("barrows-run");
  subject.setRegistered(true);
  const sent = { messages: [], spam: [], varbits: new Map(), rewards: null, camera: [], scripts: [], mounts: [], calls: [] };
  subject.collected = [];
  const handlers = {
    sendVarbit: (id, value) => sent.varbits.set(id, value),
    sendMessage: (text) => sent.messages.push(text),
    sendTypedMessage: (type, text) => sent.spam.push(text),
    sendInterfaceScript: (id, args, _a, _b, inventories) => (sent.scripts.push([id, args]), sent.rewards = inventories ?? sent.rewards),
    sendSubInterface: (...args) => sent.mounts.push(args),
    sendCameraShake: (...shake) => sent.camera.push(shake),
    sendCameraReset: () => sent.camera.push("reset"),
  };
  // Every call is also logged in order (sent.calls), the getVarbit read aside.
  const sender = new Proxy({}, {
    get: (target, key) => (key === "getVarbit" ? (id) => sent.varbits.get(id) ?? 0
      : (...args) => (sent.calls.push([key, ...args]), handlers[key]?.(...args), sender)),
  });
  subject.getPacketSender = () => sender;
  subject.sendMessage = (text) => sent.messages.push(text);
  return Object.assign(subject, { sent });
}

function arrive(subject, location) {
  subject.setLocation(location.clone());
  Barrows._test.processPlayer({ player: subject });
}

test("Barrows: a looted run stays looted through a teleport out and back to the chest; the next crypt's dig starts a new one", () => {
  const subject = player();
  arrive(subject, CHEST_ROOM);
  const run = subject.getAttribute("barrows");
  Object.assign(run, { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 600, chestOpen: true });
  Barrows._test.searchChest(subject, 1);
  assert.equal(subject.getAttribute("barrows").looted, true);
  arrive(subject, SURFACE);
  assert.equal(subject.getAttribute("barrows"), run, "still the looted run on the surface");
  arrive(subject, CHEST_ROOM);
  subject.sent.messages.length = 0;
  Barrows._test.searchChest(subject, 1);
  assert.deepEqual(subject.sent.messages, ["The chest is empty."]);
  arrive(subject, AHRIM_MOUND);
  Barrows._test.dig({ player: subject });
  const fresh = subject.getAttribute("barrows");
  assert.notEqual(fresh, run);
  assert.deepEqual([fresh.looted, fresh.kills, fresh.killed, fresh.chests], [false, 0, [], run.chests]);
  assert.equal(subject.sent.varbits.get(1394), 0, "the chest shut");
});


// rsprox_transcripts/226/01694.txt and 234/03276.txt: opening the lid plays sound 54 with barrows_chest_open
// 0->1, closing it sound 53 with 1->0. 237/04057.txt tick 9526: the loot tick sends the messages, then the
// area's track (147) and jingle 77, toplevel_mainmodal_open, barrows_reward in the main modal with its items
// Examine-able, the shake, and barrows_overlay closes; it stays shut until the next crypt is dug into.
test("Barrows: the chest's lid sounds, and the loot's jingle, main-modal reward window and closed overlay", () => {
  const subject = player();
  arrive(subject, CHEST_ROOM);
  Object.assign(subject.getAttribute("barrows"), { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 600 });
  const sounds = () => subject.sent.calls.filter(([key]) => key === "sendSoundEffect").map(([, id]) => id);
  Barrows._test.searchChest(subject, 1);
  assert.deepEqual([sounds(), subject.sent.varbits.get(1394)], [[54], 1], "opened");
  Barrows._test.searchChest(subject, 2);
  assert.deepEqual([sounds(), subject.sent.varbits.get(1394)], [[54, 53], 0], "closed");
  Barrows._test.searchChest(subject, 1);
  subject.sent.calls.length = 0;
  Barrows._test.searchChest(subject, 1);
  assert.deepEqual(sounds(), [], "no lid sound on the loot itself");
  const keys = subject.sent.calls.map(([key]) => key);
  const at = (key) => keys.indexOf(key);
  assert.deepEqual(subject.sent.calls.find(([key]) => key === "sendJingle"), ["sendJingle", 77]);
  assert.deepEqual(subject.sent.mounts.filter(([, id]) => id === 155), [[(161 << 16) | 16, 155, 0]], "barrows_reward in the main modal");
  assert.deepEqual(subject.sent.scripts[0], [2524, [-1, -1]], "toplevel_mainmodal_open first");
  assert.deepEqual(subject.sent.calls.find(([key]) => key === "sendInterfaceFlagsRange"), ["sendInterfaceFlagsRange", (155 << 16) | 3, 0, 11, 1 << 10]);
  assert.deepEqual(subject.sent.calls.find(([key]) => key === "closeInterface"), ["closeInterface", 24], "barrows_overlay closes");
  assert.ok(at("sendMessage") < at("sendJingle") && at("sendJingle") < at("sendSubInterface") &&
    at("sendSubInterface") < at("closeInterface"), keys.join(" "));

  // Out to the surface and back into the tunnels: the overlay stays shut while the run is looted.
  subject.sent.mounts.length = 0;
  arrive(subject, SURFACE);
  arrive(subject, CHEST_ROOM);
  assert.deepEqual(subject.sent.mounts.filter(([, id]) => id === 24), [], "no overlay while looted");
  arrive(subject, AHRIM_MOUND);
  Barrows._test.dig({ player: subject });
  for (let i = 0; i < 5 && subject.getLocation().getZ() === 0; i++) Barrows._test.processPlayer({ player: subject });
  assert.deepEqual(subject.sent.mounts.filter(([, id]) => id === 24), [[(161 << 16) | 1, 24, 1]], "the next crypt reopens it");
});

// rsprox_transcripts/237/04055.txt: the looting tick sends cam_shake slot 0, random 5 with the reward
// interface; the teleport out resets the camera. 227/01885.txt tick 10592: a looted run's chest room,
// teleported back into, shakes again on arrival.
test("Barrows: the looted tunnels shake until left, again on each return, and not with the row off", () => {
  const subject = player();
  arrive(subject, CHEST_ROOM);
  Object.assign(subject.getAttribute("barrows"), { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 600, chestOpen: true });
  Barrows._test.searchChest(subject, 1);
  assert.deepEqual(subject.sent.camera, [[0, 5, 0, 0]]);
  arrive(subject, SURFACE);
  assert.deepEqual(subject.sent.camera, [[0, 5, 0, 0], "reset"]);
  arrive(subject, CHEST_ROOM);
  assert.deepEqual(subject.sent.camera, [[0, 5, 0, 0], "reset", [0, 5, 0, 0]]);

  const unlooted = player();
  arrive(unlooted, CHEST_ROOM);
  arrive(unlooted, SURFACE);
  assert.deepEqual(unlooted.sent.camera, [], "an unlooted run never shakes");

  const off = player();
  off.sent.varbits.set(14198, 1); // option_camera_effect_barrows_disabled
  arrive(off, CHEST_ROOM);
  Object.assign(off.getAttribute("barrows"), { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 600, chestOpen: true });
  Barrows._test.searchChest(off, 1);
  assert.deepEqual(off.sent.camera, []);
});

// rsprox_transcripts/226/01694.txt (a normal world): "You've broken into a crypt!" (spam, :165471); a brother-raising
// search "You don't find anything." (spam, :165522); at the chest the diary's rune line (spam) and then
// "Your Barrows chest count is: <col=ff0000>N</col>." (:170767-170768).
test("Barrows: the recorded crypt and search lines", () => {
  const subject = player();
  arrive(subject, AHRIM_MOUND);
  Barrows._test.dig({ player: subject });
  // The line comes with the dig itself, before the plane change (226/01694 tick 8800, moved 8801).
  assert.deepEqual(subject.sent.spam, ["You've broken into a crypt!"]);
  assert.equal(subject.getLocation().getZ(), 0, "still on the mound when the line shows");
  for (let i = 0; i < 5 && subject.getLocation().getZ() === 0; i++) Barrows._test.processPlayer({ player: subject });
  assert.equal(subject.getLocation().getZ(), 3, "then in the crypt");
  assert.deepEqual(subject.sent.spam, ["You've broken into a crypt!"], "sent once, not again on the move");
  assert.ok(!subject.sent.messages.includes("You've found a crypt!"));

  const run = subject.getAttribute("barrows");
  const index = [0, 1, 2, 3, 4, 5].find((i) => i !== run.tunnel);
  Barrows._test.searchCrypt(subject, index);
  assert.ok(subject.sent.spam.includes("You don't find anything."), subject.sent.spam.join(" | "));
});

test("Barrows: the chest's diary rune line (spam), then 'Your Barrows chest count is: N.' (226/01694:170767)", () => {
  const looter = player();
  const diary = DiaryData.BY_KEY.get("morytania");
  looter.setAttribute(DiaryProgress.TASKS_ATTRIBUTE, {
    morytania: ["easy", "medium", "hard"].flatMap((tier) => diary.tiers[tier].tasks.map((task) => task.key)),
  });
  arrive(looter, CHEST_ROOM);
  Object.assign(looter.getAttribute("barrows"), { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 1000, chestOpen: true });
  Barrows._test.searchChest(looter, 1);
  assert.ok(looter.sent.spam.includes("You receive more runes for completing the hard tier of the Morytania achievement diary."), looter.sent.spam.join(" | "));
  assert.ok(looter.sent.messages.some((m) => /^Your Barrows chest count is: <col=ff0000>\d+<\/col>\.$/.test(m)), looter.sent.messages.join(" | "));
});

// rsprox_transcripts/226/01694.txt: into crypts at ticks 8801, 8868, 8916, 8966 and 9046, drained at 8831, 8898, 8946,
// 8996 and 9076: 30 ticks after each entry, however long the last crypt's countdown had run. Since the 24 September
// 2025 update each drain tick also sends "<col=ff3045>Your prayers have been drained!</col>"
// (rsprox_transcripts/236/03929.txt tick 388, 237/01107.txt:93512, 94565 and 98836); 226/01694.txt predates it.
test("Barrows: the Prayer drain lands 30 ticks after each entry into a crypt, with its chat line on that tick only", () => {
  const DRAINED = "<col=ff3045>Your prayers have been drained!</col>";
  const subject = player();
  const skills = subject.getSkillManager();
  skills.setMaxLevel(core.Skill.PRAYER, 99).setCurrentLevel(core.Skill.PRAYER, 99);
  const prayer = () => skills.getCurrentLevel(core.Skill.PRAYER);
  const drainLines = () => subject.sent.messages.filter((m) => m === DRAINED).length;
  const ticksToDrain = () => {
    const from = prayer();
    for (let n = 1; n <= 40; n++) {
      const lines = drainLines();
      Barrows._test.processPlayer({ player: subject });
      // The line is sent on the drain's tick and on no other.
      assert.equal(drainLines() - lines, prayer() < from ? 1 : 0, `tick ${n}`);
      if (prayer() < from) return n;
    }
    return -1;
  };
  arrive(subject, AHRIM_MOUND);
  Barrows._test.dig({ player: subject });
  for (let i = 0; i < 5 && subject.getLocation().getZ() === 0; i++) Barrows._test.processPlayer({ player: subject });
  const crypt = subject.getLocation().clone();
  assert.equal(crypt.getZ(), 3);
  assert.equal(ticksToDrain(), 30, "the first crypt");
  assert.equal(prayer(), 99 - 8, "8 with no brother killed");
  for (let i = 0; i < 12; i++) Barrows._test.processPlayer({ player: subject });
  assert.equal(drainLines(), 1, "no line on the ticks between drains");
  arrive(subject, SURFACE);
  for (let i = 0; i < 5; i++) Barrows._test.processPlayer({ player: subject });
  arrive(subject, crypt);
  assert.equal(ticksToDrain(), 30, "back in: a fresh 30 ticks, not the 18 that were left");
  assert.equal(drainLines(), 2, "one line per drain");
  assert.ok(!subject.sent.messages.some((m) => /drains your Prayer/.test(m)), "the old text is gone");
});

test("Barrows: defeated brothers appear on the drain tick, on the atmosphere overlay; looting and leaving stop the faces", () => {
  const subject = player();
  const skills = subject.getSkillManager();
  skills.setMaxLevel(core.Skill.PRAYER, 99).setCurrentLevel(core.Skill.PRAYER, 99);
  arrive(subject, new Location(3557, 9703, 3));
  assert.ok(subject.sent.mounts.some(([uid, group]) => uid === ((161 << 16) | 1) && group === 24));
  const run = subject.getAttribute("barrows");
  const faceScripts = () => subject.sent.scripts.filter(([id]) => id === 894);
  for (let i = 0; i < 30; i++) Barrows._test.processPlayer({ player: subject });
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 91);
  assert.equal(faceScripts().length, 0, "there is no face before a brother is defeated");
  run.killed = [1];
  for (let i = 0; i < 29; i++) Barrows._test.processPlayer({ player: subject });
  assert.equal(faceScripts().length, 0);
  Barrows._test.processPlayer({ player: subject });
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 82);
  assert.equal(faceScripts().length, 1);
  assert.equal(faceScripts()[0][1][0], (24 << 16) | 7);
  assert.ok([6738, 29225].includes(faceScripts()[0][1][1]));
  run.looted = true;
  for (let i = 0; i < 30; i++) Barrows._test.processPlayer({ player: subject });
  assert.equal(faceScripts().length, 1, "looted runs do not show a brother");
  arrive(subject, SURFACE);
  for (let i = 0; i < 40; i++) Barrows._test.processPlayer({ player: subject });
  assert.equal(faceScripts().length, 1);
});

test("Barrows: tunnel entry starts a fresh countdown and protected hilts suppress drain and faces", () => {
  const subject = player();
  const skills = subject.getSkillManager();
  skills.setMaxLevel(core.Skill.PRAYER, 99).setCurrentLevel(core.Skill.PRAYER, 99);
  arrive(subject, CHEST_ROOM);
  const run = subject.getAttribute("barrows");
  run.killed = [2, 3, 4];
  for (let i = 0; i < 29; i++) Barrows._test.processPlayer({ player: subject });
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 99);
  Barrows._test.processPlayer({ player: subject });
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 88);
  for (const id of [core.ItemIdentifiers.GHOMMALS_HILT_2, core.ItemIdentifiers.GHOMMALS_HILT_6,
    core.ItemIdentifiers.GHOMMALS_AVERNIC_DEFENDER_5, core.ItemIdentifiers.GHOMMALS_AVERNIC_DEFENDER_6_L_]) {
    subject.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(id));
    const scripts = subject.sent.scripts.length;
    const messages = subject.sent.messages.length;
    for (let i = 0; i < 30; i++) Barrows._test.processPlayer({ player: subject });
    assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 88, `protected by ${id}`);
    assert.equal(subject.sent.scripts.length, scripts);
    assert.equal(subject.sent.messages.length, messages);
  }
  subject.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(core.ItemIdentifiers.GHOMMALS_HILT_1));
  for (let i = 0; i < 30; i++) Barrows._test.processPlayer({ player: subject });
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 77, "hilt 1 does not protect");
});

test("Barrows: each slain brother selects his own captured face models", () => {
  const models = [[6737, 29228], [6738, 29225], [6739, 29224], [6740, 29226], [6741, 29227], [6742, 29223]];
  const subject = player();
  const skills = subject.getSkillManager();
  skills.setMaxLevel(core.Skill.PRAYER, 99).setCurrentLevel(core.Skill.PRAYER, 99);
  arrive(subject, CHEST_ROOM);
  const run = subject.getAttribute("barrows");
  const random = Math.random;
  try {
    for (let brother = 0; brother < models.length; brother++) {
      run.killed = [brother];
      for (const [rng, expected] of [[0.5, models[brother][0]], [0, models[brother][1]]]) {
        skills.setCurrentLevel(core.Skill.PRAYER, 99);
        Math.random = () => rng;
        for (let tick = 0; tick < 30; tick++) Barrows._test.processPlayer({ player: subject });
        assert.deepEqual(subject.sent.scripts.filter(([id]) => id === 894).at(-1), [894, [(24 << 16) | (6 + brother), expected]]);
      }
    }
  } finally { Math.random = random; }
});

// rsprox_transcripts/227/00086.txt:233214-233215 (546 times over the recordings): the tunnel's brother rising at the
// chest says "You dare steal from us!"; a brother woken in his crypt, "You dare disturb my rest!" (226/01694:165530).
test("Barrows: the brother at the chest says 'You dare steal from us!', one in his crypt 'You dare disturb my rest!'", () => {
  const shoutOf = (queued) => {
    const npc = queued.at(-1);
    const said = [];
    npc.forceChat = (text) => { said.push(text); return npc; };
    try { npc.onAdd(); } catch { /* the fixture world has no combat target wiring; the shout comes first */ }
    return said;
  };
  const queue = core.World.getAddNPCQueue();
  const before = queue.length;
  try {
    const subject = player();
    arrive(subject, CHEST_ROOM);
    Object.assign(subject.getAttribute("barrows"), { killed: [], kills: 0, chestOpen: false });
    Barrows._test.searchChest(subject, 1);
    assert.equal(queue.length, before + 1, "the tunnel's brother rises");
    assert.deepEqual(shoutOf(queue), ["You dare steal from us!"]);

    const digger = player();
    arrive(digger, AHRIM_MOUND);
    Barrows._test.dig({ player: digger });
    for (let i = 0; i < 5 && digger.getLocation().getZ() === 0; i++) Barrows._test.processPlayer({ player: digger });
    const run = digger.getAttribute("barrows");
    Barrows._test.searchCrypt(digger, [0, 1, 2, 3, 4, 5].find((i) => i !== run.tunnel));
    assert.deepEqual(shoutOf(queue), ["You dare disturb my rest!"]);
  } finally {
    queue.length = before;
  }
});

function rewardDraw() {
  const frames = new Error().stack.split("\n");
  return frames[3]?.includes("at randomInt ") && frames[4]?.includes("at rollRewards ");
}

function chestAtRoll(complete, roll, partial = false) {
  const subject = player();
  const diary = DiaryData.BY_KEY.get("morytania");
  if (complete) subject.setAttribute(DiaryProgress.TASKS_ATTRIBUTE, {
    morytania: ["easy", "medium", "hard"].flatMap((tier) => diary.tiers[tier].tasks.map((task) => task.key)),
  });
  if (partial) subject.setAttribute(DiaryProgress.TASKS_ATTRIBUTE, {
    morytania: diary.tiers.hard.tasks.slice(0, -1).map((task) => task.key),
  });
  const query = { player: subject, diary: "morytania", tier: "hard" };
  diaryApi.emitCustomEvent("diary:is-complete", query);
  assert.equal(query.complete, complete, "real diary completion producer");
  assert.equal(DiaryProgress.claimedTiers(subject, diary).has("hard"), false);
  arrive(subject, CHEST_ROOM);
  const run = subject.getAttribute("barrows");
  Object.assign(run, { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 1000, chestOpen: true });
  let n = 0;
  const random = Math.random;
  Math.random = () => {
    if (!rewardDraw()) return random();
    const call = n++;
    assert.ok(call < 21, "unexpected reward RNG draw");
    return call % 3 === 1 ? (roll + 0.25) / 1012 : 0.5;
  };
  try { Barrows._test.searchChest(subject, 1); } finally { Math.random = random; }
  assert.equal(n, 21, "seven equipment, table and clue draws");
  assert.equal(run.looted, true);
  assert.equal(subject.chestEvents, 1);
  assert.equal(subject.collected.length, 1);
  assert.ok(subject.sent.rewards, "reward interface was populated");
  const [id, amount] = subject.collected[0];
  assert.equal(subject.getInventory().getAmount(id), amount);
  assert.deepEqual(Object.values(subject.sent.rewards)[0].slots, [{ slot: 0, itemId: id, quantity: amount }]);
  const displayed = subject.sent.rewards;
  Barrows._test.searchChest(subject, 1);
  assert.equal(subject.getInventory().getAmount(id), amount, "re-looting does not add items");
  assert.deepEqual(subject.collected, [[id, amount]], "re-looting emits no rewards");
  assert.equal(subject.chestEvents, 1);
  assert.equal(subject.sent.rewards, displayed, "re-looting does not replace the reward pane");
  return subject.getInventory();
}

test("Barrows: complete Hard diary boosts each even rune roll while no diary retains base", () => {
  const id = core.ItemIdentifiers.MIND_RUNE;
  assert.equal(chestAtRoll(false, 381).getAmount(id), 1778);
  assert.equal(chestAtRoll(false, 381, true).getAmount(id), 1778, "incomplete Hard retains base");
  assert.equal(chestAtRoll(true, 381).getAmount(id), 2667);
});

test("Barrows: completed Hard increases chaos and death rune rolls", () => {
  const items = core.ItemIdentifiers;
  assert.equal(chestAtRoll(false, 505).getAmount(items.CHAOS_RUNE), 784);
  assert.equal(chestAtRoll(true, 505).getAmount(items.CHAOS_RUNE), 1176);
  assert.equal(chestAtRoll(false, 630).getAmount(items.DEATH_RUNE), 490);
  assert.equal(chestAtRoll(true, 630).getAmount(items.DEATH_RUNE), 735);
});

test("Barrows: odd rune rolls use the server's per-roll integer rounding", () => {
  const id = core.ItemIdentifiers.MIND_RUNE;
  assert.equal(chestAtRoll(false, 380).getAmount(id), 1771);
  assert.equal(chestAtRoll(true, 380).getAmount(id), 2653);
});

test("Barrows: the Hard diary leaves bolt racks unchanged", () => {
  const id = core.ItemIdentifiers.BOLT_RACK;
  assert.equal(chestAtRoll(false, 900).getAmount(id), 252);
  assert.equal(chestAtRoll(true, 900).getAmount(id), 252);
});

test("Barrows: equipment, clue, coins, keys and racks keep their amounts in mixed rewards", () => {
  const subject = player();
  const diary = DiaryData.BY_KEY.get("morytania");
  subject.setAttribute(DiaryProgress.TASKS_ATTRIBUTE, {
    morytania: ["easy", "medium", "hard"].flatMap((tier) => diary.tiers[tier].tasks.map((task) => task.key)),
  });
  const query = { player: subject, diary: "morytania", tier: "hard" };
  diaryApi.emitCustomEvent("diary:is-complete", query);
  assert.equal(query.complete, true);
  arrive(subject, CHEST_ROOM);
  const run = subject.getAttribute("barrows");
  Object.assign(run, { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 1000, chestOpen: true });
  const value = (roll) => (roll + 0.25) / 1012;
  const draws = [0, 0, 0, 0.5, value(100), 0.5, 0.5, value(900),
    0.5, value(1006), 0.5, value(1009), 0.5, value(381), 0.5, value(760)];
  const random = Math.random;
  let n = 0;
  Math.random = () => {
    if (!rewardDraw()) return random();
    assert.ok(n < draws.length, "unexpected mixed reward RNG draw");
    return draws[n++];
  };
  try { Barrows._test.searchChest(subject, 1); } finally { Math.random = random; }
  assert.equal(n, draws.length);
  assert.equal(run.looted, true);
  assert.equal(subject.chestEvents, 1);
  const items = core.ItemIdentifiers;
  const expected = [[items.AHRIMS_HOOD, 1], [items.CLUE_SCROLL_ELITE_, 1], [items.COINS, 208],
    [items.BOLT_RACK, 36], [items.LOOP_HALF_OF_KEY, 1], [items.TOOTH_HALF_OF_KEY, 1],
    [items.MIND_RUNE, 381], [items.BLOOD_RUNE, 57]];
  assert.deepEqual(subject.collected, expected);
  for (const [id, amount] of expected) assert.equal(subject.getInventory().getAmount(id), amount);
  assert.deepEqual(Object.values(subject.sent.rewards)[0].slots,
    expected.map(([itemId, quantity], slot) => ({ slot, itemId, quantity })));
});

// Issue #4343: a tunnel door is crossed by walking through the doorway, as live (236/03929.txt
// ~11290-11420: walk/run steps across barrows_door_o_l at 3562,9678, no exact move), not a slide.
test("Barrows: an open tunnel door is walked through, not slid across", () => {
  const subject = player();
  const { useDoor, doorSides, getTunnelMap, getRun, processPlayer, IGNORE_CLIPPING_FLAG } = Barrows._test;
  arrive(subject, CHEST_ROOM);
  const run = getRun(subject);
  const door = getTunnelMap().doors.find((entry) => run.openDoors.includes(entry.varbit) && entry.varbit !== run.puzzleDoor);
  assert.ok(door, "an open door this run");
  const [from, to] = doorSides(door);
  subject.setLocation(from.clone());
  processPlayer({ player: subject });
  useDoor(subject, door);
  assert.ok(!subject.getForceMovement(), "no exact move");
  assert.equal(subject.hasFlag(IGNORE_CLIPPING_FLAG), true, "the doorway's clipping is ignored for the step");
  subject.getMovementQueue().process();
  assert.ok(subject.getLocation().equals(to), `walked to the far side (${subject.getLocation()})`);
  for (let i = 0; i < 3; i++) processPlayer({ player: subject });
  assert.equal(subject.hasFlag(IGNORE_CLIPPING_FLAG), false, "clipping back once across");
});

// ------------------------------------------------------------------ The strange old lockpick
// User rsprox captures (revision 242.1): StrangeOldLockpickBarrows.bin ticks 52-68 and
// BarrowsMiniQuest.bin ticks 543-704; Jagex's Darkmeyer news; the Wiki's Trivia line.
const doorObject = (door) => ({ getId: () => door.id, getLocation: () => new Location(door.x, door.y, door.z) });

/** A locked hallway's two doorways (one varbit, two ends), the player on the first one's near side. */
function lockedHallway(subject) {
  const { getTunnelMap, getRun, doorSides, processPlayer } = Barrows._test;
  arrive(subject, CHEST_ROOM);
  const run = getRun(subject);
  const doors = getTunnelMap().doors;
  const varbit = doors.map((entry) => entry.varbit).find((id) => !run.openDoors.includes(id));
  // A doorway is two leaves side by side; the hallway's ends are its leaves three or more tiles apart.
  const [first] = doors.filter((entry) => entry.varbit === varbit);
  const second = doors.find((entry) => entry.varbit === varbit && Math.abs(entry.x - first.x) + Math.abs(entry.y - first.y) > 2);
  assert.ok(first && second, "a hallway has a door at each end");
  subject.setLocation(doorSides(first)[0].clone());
  processPlayer({ player: subject });
  return { run, varbit, first, second };
}

/** Finishes the crossing, then stands at the other end's door. */
function crossTo(subject, door) {
  const { doorSides, processPlayer } = Barrows._test;
  for (let i = 0; i < 4; i++) processPlayer({ player: subject });
  subject.setLocation(doorSides(door)[1].clone());
  processPlayer({ player: subject });
}

const lockpick = (charges) => {
  const item = new core.Item(charges === 50 ? core.ItemIdentifiers.STRANGE_OLD_LOCKPICK_FULL_ : core.ItemIdentifiers.STRANGE_OLD_LOCKPICK, 1);
  if (charges !== 50) item.setMetaValue("barrows:lockpick-charges", charges);
  return item;
};
const useOn = (subject, door, item) => Barrows._test.useLockpickOnDoor({ player: subject, object: doorObject(door), item, itemId: item.getId() });
const inspect = (subject, item) => (Barrows._test.inspectLockpick({ player: subject, item }), subject.sent.messages.at(-1));

test("Barrows: the lockpick used on a locked hallway's door opens it for a charge; its other door is free", () => {
  const subject = player();
  const { run, varbit, first, second } = lockedHallway(subject);
  const pick = lockpick(50);
  subject.getInventory().add(pick, false);
  assert.equal(useOn(subject, first, subject.getInventory().get(0)), true);
  const held = subject.getInventory().get(0);
  // The full pick becomes the used one in its slot (BarrowsMiniQuest.bin tick 543).
  assert.equal(held.getId(), core.ItemIdentifiers.STRANGE_OLD_LOCKPICK);
  assert.equal(inspect(subject, held), "Your Strange old lockpick has 49 charges remaining.");
  assert.ok(run.pickedDoors.includes(varbit), "the hallway stays open this layout");
  assert.equal(subject.sent.varbits.get(varbit), 1, "the door varbit is untouched (StrangeOldLockpickBarrows.bin)");
  assert.equal(subject.hasFlag(Barrows._test.IGNORE_CLIPPING_FLAG), true, "walking through the doorway (as Open does)");
  assert.ok(!subject.sent.messages.includes("This door is locked."));
  crossTo(subject, second);
  assert.equal(useOn(subject, second, held), true);
  assert.equal(inspect(subject, held), "Your Strange old lockpick has 49 charges remaining.", "no charge for the hallway's other door");
});

test("Barrows: a carried lockpick still opens a locked door's Open, once per hallway; none leaves it locked", () => {
  const subject = player();
  const { first, second } = lockedHallway(subject);
  Barrows._test.useDoor(subject, first);
  assert.deepEqual(subject.sent.messages.slice(-1), ["This door is locked."]);
  subject.getInventory().add(lockpick(10), false);
  Barrows._test.useDoor(subject, first);
  assert.equal(inspect(subject, subject.getInventory().get(0)), "Your Strange old lockpick has 9 charges remaining.");
  crossTo(subject, second);
  Barrows._test.useDoor(subject, second);
  assert.equal(inspect(subject, subject.getInventory().get(0)), "Your Strange old lockpick has 9 charges remaining.");
});

test("Barrows: the lockpick's last charge warns, keeps the charge through its hallway and crumbles as the tunnels are left unused", () => {
  const subject = player();
  const { first, second } = lockedHallway(subject);
  subject.getInventory().add(lockpick(1), false);
  assert.equal(useOn(subject, first, subject.getInventory().get(0)), true);
  assert.equal(subject.sent.messages.at(-1), "The Strange old lockpick almost breaks, but seems in good enough shape for one more use.");
  assert.equal(subject.getInventory().getAmount(core.ItemIdentifiers.STRANGE_OLD_LOCKPICK), 1, "kept for the way out");
  crossTo(subject, second);
  useOn(subject, second, subject.getInventory().get(0));
  assert.ok(!subject.sent.messages.includes("This door is locked."), "the hallway's other door is free");
  arrive(subject, SURFACE);
  assert.equal(subject.getInventory().getAmount(core.ItemIdentifiers.STRANGE_OLD_LOCKPICK), 0, "teleporting out with the last charge unused, it still crumbles");
});

test("Barrows: after the warning the last charge opens the next locked hallway, and the pick crumbles (Wiki Trivia)", () => {
  const subject = player();
  const { getTunnelMap, doorSides, processPlayer } = Barrows._test;
  const { run, varbit, first } = lockedHallway(subject);
  subject.getInventory().add(lockpick(1), false);
  useOn(subject, first, subject.getInventory().get(0));
  assert.equal(subject.sent.messages.at(-1), "The Strange old lockpick almost breaks, but seems in good enough shape for one more use.");
  assert.equal(inspect(subject, subject.getInventory().get(0)), "Your Strange old lockpick has 1 charges remaining.", "the warning keeps the charge");
  for (let i = 0; i < 4; i++) processPlayer({ player: subject });
  // A second hallway nobody has opened.
  const other = getTunnelMap().doors.find((entry) => entry.varbit !== varbit && !run.openDoors.includes(entry.varbit));
  assert.ok(other, "another locked hallway");
  subject.setLocation(doorSides(other)[0].clone());
  processPlayer({ player: subject });
  const messages = subject.sent.messages.length;
  assert.equal(useOn(subject, other, subject.getInventory().get(0)), true);
  assert.deepEqual(subject.sent.messages.slice(messages), [], "neither locked nor warned again");
  assert.ok(run.pickedDoors.includes(other.varbit), "it opens");
  assert.equal(subject.getInventory().getAmount(core.ItemIdentifiers.STRANGE_OLD_LOCKPICK), 0, "the last charge used: it crumbles");
  // With no pick left, a third locked hallway stays shut.
  const third = getTunnelMap().doors.find((entry) => ![varbit, other.varbit].includes(entry.varbit) && !run.openDoors.includes(entry.varbit));
  for (let i = 0; i < 4; i++) processPlayer({ player: subject });
  subject.setLocation(doorSides(third)[0].clone());
  processPlayer({ player: subject });
  Barrows._test.useDoor(subject, third);
  assert.equal(subject.sent.messages.at(-1), "This door is locked.");
});

test("Barrows: the lockpick on a door outside the tunnels, or another item on a door, is not ours", () => {
  const subject = player();
  const { first } = lockedHallway(subject);
  const coins = new core.Item(core.ItemIdentifiers.COINS, 1);
  assert.equal(Barrows._test.useLockpickOnDoor({ player: subject, object: doorObject(first), item: coins, itemId: coins.getId() }), false);
  arrive(subject, SURFACE);
  assert.equal(useOn(subject, first, lockpick(50)), false);
});

test("Barrows: condensed warnings put the tunnel line in the menu's title, with no box (StrangeOldLockpickBarrows.bin tick 23)", () => {
  const subject = player();
  arrive(subject, new Location(3557, 9703, 3));
  const run = Barrows._test.getRun(subject);
  subject.setAttribute(Barrows._test.WARNINGS_ATTRIBUTE, 1);
  Barrows._test.searchCrypt(subject, run.tunnel);
  assert.deepEqual(subject.prompts, [["You've found a hidden tunnel, do you want to enter?", "Yeah I'm fearless!", "No way, that looks scary!"]]);
  assert.equal(subject.getDialogueManager().getCurrent?.() ?? null, null, "no message box first");
});

test("Barrows: a plugin can refuse a mound's Spade dig before it starts; off the mounds, or another spade, it can't", () => {
  const subject = player();
  let asked = 0;
  const refuse = (request) => { if (request.player === subject) { asked++; request.blocked = true; } };
  diaryApi.onCustomEvent("barrows:dig", refuse);
  const onMound = { player: subject, itemId: core.ItemIdentifiers.SPADE, location: AHRIM_MOUND.clone(), refused: false };
  Barrows._test.refuseMoundDig(onMound);
  assert.equal(onMound.refused, true);
  const offMound = { player: subject, itemId: core.ItemIdentifiers.SPADE, location: new Location(3548, 3290, 0), refused: false };
  Barrows._test.refuseMoundDig(offMound);
  assert.equal(offMound.refused, false);
  // The mounds dig only with "Spade": another spade there is not refused in his name.
  const eastfloor = { player: subject, itemId: core.ItemIdentifiers.EASTFLOOR_SPADE, location: AHRIM_MOUND.clone(), refused: false };
  Barrows._test.refuseMoundDig(eastfloor);
  assert.equal(eastfloor.refused, false);
  assert.equal(asked, 1, "asked only for a brother's mound");
});
