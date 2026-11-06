const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const plugin = require("../plugins/treasuretrails/TreasureTrails.plugin");
const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
const Dialogue = require("../plugins/treasuretrails/trails/Dialogue.TreasureTrails");
const Skills = require("../plugins/treasuretrails/trails/Skills.TreasureTrails");
const MimicReward = require("../plugins/bosses/mimic/Reward.Mimic");
const MimicShared = require("../plugins/bosses/mimic/Shared.Mimic");
const Caskets = require("../plugins/treasuretrails/trails/Caskets.TreasureTrails");
const Stash = require("../plugins/treasuretrails/trails/Stash.TreasureTrails");
const { byName } = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails");
const TRANSCRIPTS = require("../data/definitions/npc-dialogues.json");
const ELITE = byName.get("elite");
const I = core.ItemIdentifiers;
const C = core.CacheDefinitions;

const played = [];
const play = Dialogue.play;
Dialogue.play = (player, npcId, spoken, onEnd) => { played.push(...spoken); return play(player, npcId, spoken, onEnd); };

function fixture() {
  const actions = new Map(), events = new Map(), attributes = new Map(), sent = [], ground = [], spawned = [];
  let position = new core.Location(3222, 3218, 0), chain, placed = 0;
  const items = Array(28).fill(null), worn = Array(14).fill(null);
  const inventory = {
    getItems: () => items, getSlotForItemId: id => items.findIndex(i => i?.getId() === id), refreshItems() {}, setItem(slot, item) { items[slot] = item; return inventory; },
    getFreeSlots: () => items.filter(i => !i).length, isFull() { return this.getFreeSlots() === 0; },
    delete(id, amount) { while (amount > 0) { const slot = items.findIndex(i => i?.getId() === id); if (slot < 0) return; const take = Math.min(amount, items[slot].getAmount()); this.deleteAtSlot(slot, take); amount -= take; } },
    deleteAtSlot(slot, amount) { const item = items[slot]; if (!item) return; if (item.getAmount() <= amount) items[slot] = null; else item.setAmount(item.getAmount() - amount); },
    adds(id, amount) { this.forceAdd(null, new core.Item(id, amount)); },
    forceAdd(player, item) { const slot = items.findIndex(i => !i); if (slot < 0) ground.push(item); else items[slot] = item; },
  };
  const sender = new Proxy({}, { get: (_, name) => (...args) => (sent.push([name, ...args]), sender) });
  const skills = { level: 1, xp: 0, getCurrentLevel() { return this.level; }, addExperiences(skill, xp) { this.xp += xp; } };
  const player = { getUsername: () => "Tester", getInventory: () => inventory, getSkillManager: () => skills, getEquipment: () => ({ getItems: () => worn }),
    getPacketSender: () => sender, getLocation: () => position, getPrivateArea: () => null, isPlayer: () => true,
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: message => sent.push(["message", message]), performAnimation: value => sent.push(["animation", value]),
    setEnteredAmountAction() {}, getDialogueManager: () => ({ startDialogues: value => { chain = value; } }) };
  const api = { core, persistAttribute() {}, onItemAction: (name, handlers) => actions.set(name, { ...actions.get(name), ...handlers }),
    onBeforeNpcInteraction() {}, onItemOnNpc() {}, onBeforeObjectInteraction() {}, onCanUseItem() {}, onInterfaceActionButton() {},
    onCustomEvent: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent: (name, request) => { for (const fn of events.get(name) ?? []) fn(request); },
    onPlayerLogout() {}, onPlayerDisconnect() {}, onPlayerLogin() {}, onPlayerDeath() {}, onNpcDeath() {},
    spawnNpc: def => {
      const npc = { def, removed: false, hitpoints: 10, attacked: null, getLocation: () => new core.Location(def.x, def.y, def.z),
        getHitpoints() { return this.hitpoints; }, isRegistered() { return !this.removed; }, getCombat() { return { attack: target => { npc.attacked = target; } }; } };
      spawned.push(npc);
      return npc;
    },
    removeNpc: npc => { npc.removed = true; }, getRegionManager: () => ({ blocked: () => false, canMovestart: () => true }) };
  plugin.register(api);
  api.onCustomEvent("treasure-trails:milestone-rewards", request => { request.handled = true; });
  api.onCustomEvent("npc-dialogue:start", request => {
    const steps = TRANSCRIPTS[C.getNpc(request.npcId)?.name]?.variants?.[request.variant];
    if (steps?.length && request.select) request.select(steps);
  });
  function place(step, { length = 5, completed = 1, slot = 0 } = {}) {
    items[slot] = new core.Item(step.itemId, 1).setMetaValue(Runtime.metaKey(ELITE),
      { version: 1, token: `t${slot}-${++placed}`, revision: 0, completed, length, row: step.row });
    position = new core.Location(step.location.x, step.location.y, step.location.z);
  }
  const talk = (npcId, npc = { getLocation: () => position }) => {
    const event = { player, npcId, npc, clickType: 1, handled: false, definition: { getActions: () => ["Talk-to"] } };
    Runtime.talk(event);
    return event;
  };
  const digHere = () => { const event = { player, itemId: I.SPADE, option: "Dig", allow: true }; Runtime.dig(event); return event.allow; };
  return { api, player, items, worn, skills, attributes, actions, sent, spawned, place, talk, digHere,
    event: (slot = 0) => ({ player, slot, item: items[slot], itemId: items[slot]?.getId() }),
    // A challenge scroll is carried beside the clue (slot 0), linked by the trail's token.
    scrollSlot: id => items.findIndex((item, slot) => slot > 0 && item?.getId() === id && item.getAmount() > 0),
    state: () => items[0]?.getMetaValue(Runtime.metaKey(ELITE)),
    finish: () => { const current = chain; chain = null; for (const d of current?.getDialogues().values() ?? []) if (d instanceof core.ActionDialogue) d.send(player); },
  };
}

const steps = () => Runtime.data(ELITE).steps;
const GROUP_PARAM = require("../plugins/treasuretrails/trails/Catalogue.TreasureTrails").TRAIL_ITEM_GROUP_PARAM;
const outfit = step => step.equipment.filter(requirement => requirement.emptySlot == null).map(requirement => new core.Item(requirement.anyOf?.[0] ??
  [...C.getObjNames().keys()].find(id => C.getItem(id)?.params?.get?.(GROUP_PARAM) === requirement.group), 1));
const ofKind = (family, target) => steps().filter(step => step.family === family && (!target || step.target === target));
const SKILL_CHALLENGES = require("../plugins/treasuretrails/trails/data/skill-challenges.json");
const sherlockStep = () => steps().find(step => step.skill);

/** Ground drops go to `dropped` instead of the world while `run` runs. */
function catchingDrops(run) {
  const manager = core.ItemOnGroundManager, original = manager.registerLocation, dropped = [];
  manager.registerLocation = (player, item, location) => { dropped.push({ player, item, location }); };
  try { run(); } finally { manager.registerLocation = original; }
  return dropped;
}

test("every elite step is a cache clue item; the guards, challenges and Sherlock resolve", () => {
  fixture();
  const data = Runtime.data(ELITE);
  assert.equal(data.steps.length, 124);
  for (const [family, target, count] of [["anagram", "npc", 12], ["coordinate", "coord", 41], ["cryptic", "npc", 15], ["cryptic", "loc", 2],
    ["cryptic", "coord", 12], ["cryptic", "kill", 14], ["cryptic", "key", 1], ["emote", "coord", 19], ["map", "coord", 5], ["map", "loc", 1], ["music", "npc", 2]])
    assert.equal(ofKind(family, target).length, count, `${family}/${target}`);
  const fights = {};
  for (const step of data.steps.filter(entry => entry.encounter)) fights[`${step.family}:${step.encounter.npcIds[0]}`] = (fights[`${step.family}:${step.encounter.npcIds[0]}`] ?? 0) + 1;
  assert.deepEqual(fights, { "coordinate:6587": 40, "coordinate:6588": 1 });
  assert.equal(data.steps.filter(step => step.puzzle).length, 0, "the cache gives elite no puzzle or light boxes");
  const challenges = data.steps.filter(step => step.challenge);
  assert.equal(challenges.length, 12);
  for (const step of challenges) assert.equal(C.getObjNames().get(step.challenge.itemId), "trail_elite_anagram_challenge", step.key);
  assert.equal(sherlockStep().text, "Show this to Sherlock.");
  assert.equal(C.getObjNames().get(sherlockStep().skill.itemId), "trail_elite_skill_challenge");
  for (const step of data.steps.filter(entry => entry.family === "map")) assert.ok(step.interfaceId != null, `${step.key} has no map interface`);
  assert.equal(data.uri, C.getNpcId("trail_elite_uri"));
});

test("steps this server can't finish are never rolled: every Sherlock task is set", () => {
  fixture();
  const data = Runtime.data(ELITE);
  assert.deepEqual(data.steps.filter(step => !data.rollable.includes(step)).map(step => C.getDbRowName(step.targetRow)).sort(),
    // These are the only elite gaps left after accounting for plugin-backed NPC spawns.
    []);
  assert.deepEqual([...data.tasks.values()].filter(task => !SKILL_CHALLENGES[task.key]).map(task => task.text).sort(),
    []);
  for (const key of Object.keys(SKILL_CHALLENGES).filter(key => key.includes("_elite_"))) assert.ok(data.tasks.has([...data.tasks.values()].find(task => task.key === key)?.row), key);
});

test("one shared elite challenge scroll holds each anagram's own question; a wrong answer is free", () => {
  const f = fixture();
  let answer;
  f.player.setEnteredAmountAction = action => { answer = action; };
  for (const step of steps().filter(entry => entry.challenge)) {
    f.items.fill(null); f.sent.length = 0;
    f.place(step);
    f.talk(step.npcIds[0]); f.finish();
    const scroll = f.scrollSlot(step.challenge.itemId);
    assert.ok(scroll > 0, `${step.key} hands over the shared scroll beside the clue`);
    assert.equal(f.items[0].getId(), step.itemId);
    f.actions.get("Challenge scroll (elite)").Read(f.event(scroll));
    assert.ok(f.sent.some(([name, text]) => name === "sendString" && text === step.challenge.question), step.key);
    f.talk(step.npcIds[0]); f.finish();
    answer.execute(Number(step.challenge.answer) + 1); f.finish();
    assert.equal(f.state().completed, 1, `${step.key} a wrong answer`);
    f.talk(step.npcIds[0]); f.finish();
    answer.execute(step.challenge.answer); f.finish();
    assert.equal(f.state().completed, 2, step.key);
    assert.equal(f.scrollSlot(step.challenge.itemId), -1, `${step.key} the scroll goes with the step`);
  }
});

/** A payload the task's detector accepts. */
function payloadFor(rule) {
  const value = spec => spec?.item ? I[spec.item[0]] : spec?.npc ? core.NpcIdentifiers[spec.npc[0]] : spec?.prayer ? core.PrayerHandler[spec.prayer[0]] :
    spec?.min != null ? spec.min : spec;
  return Object.fromEntries(Object.entries(rule.match ?? {}).map(([field, spec]) => [field, value(spec)]));
}

function talkToSherlock(f, step) {
  const event = { player: f.player, npcId: step.npcIds[0], npc: { getLocation: () => step.location }, clickType: 1, handled: false,
    definition: { getActions: () => ["Talk-to"] } };
  Skills.talk(event);
  f.finish();
  return event;
}

test("Sherlock hands over every supported task, which counts only once done; then he gives the next clue", () => {
  const f = fixture();
  const step = sherlockStep();
  f.skills.level = 99;
  for (const task of Runtime.data(ELITE).supportedTasks) {
    f.items.fill(null); f.worn.fill(null); f.sent.length = 0;
    f.place(step);
    played.length = 0;
    assert.equal(talkToSherlock(f, step).handled, true);
    assert.deepEqual(played, [{ npc: "Ah, just what I was looking for. I have a challenge for you. If you complete it, I'll give you something." }]);
    const slot = f.scrollSlot(step.skill.itemId);
    assert.ok(slot > 0, "his scroll is carried beside the clue");
    const scroll = () => f.items[slot].getMetaValue(Runtime.metaKey(ELITE));
    f.items[slot].setMetaValue(Runtime.metaKey(ELITE), { ...scroll(), task: task.row });
    f.actions.get("Challenge scroll (elite)").Read(f.event(slot));
    assert.ok(f.sent.some(([name, text]) => name === "sendString" && text === task.text), task.key);
    played.length = 0;
    talkToSherlock(f, step);
    assert.deepEqual(played, [{ npc: "If you find a scroll that requires my attention, bring it to me and I shall handle it." }], `${task.key} before it's done`);
    assert.equal(f.state().completed, 1);
    const rule = SKILL_CHALLENGES[task.key];
    const payload = { player: f.player, killer: f.player, ...payloadFor(rule) };
    Skills.performed(rule.event, f.player, { ...payload, ...Object.fromEntries(Object.keys(rule.match ?? {}).map(field => [field, -1])) });
    assert.notEqual(scroll().taskDone, true, `${task.key} the wrong thing doesn't count`);
    if (rule.worn) f.worn[core.Equipment[rule.worn.slot]] = new core.Item(I[rule.worn.item[0]], 1);
    Skills.performed(rule.event, f.player, payload);
    assert.equal(scroll().taskDone, true, task.key);
    assert.ok(f.sent.some(([name, text]) => name === "message" && text === "You have completed your elite/master level challenge!"), task.key);
    played.length = 0;
    talkToSherlock(f, step);
    assert.deepEqual(played, [{ npc: "Fantastic! Here, have this." }]);
    assert.equal(f.state().completed, 2, task.key);
    assert.equal(f.scrollSlot(step.skill.itemId), -1, `${task.key} the scroll goes with the step`);
  }
});

test("a task done without the challenge scroll doesn't count, and Sherlock sets tasks the player has the levels for", () => {
  const f = fixture();
  const step = sherlockStep();
  const rule = SKILL_CHALLENGES.cluehelper_skillchallenge_elite_16;
  f.place(step);
  Skills.performed(rule.event, f.player, { player: f.player, ...payloadFor(rule) });
  assert.equal(f.state().taskDone, undefined, "the clue alone doesn't count");
  f.skills.level = 1;
  assert.deepEqual(Runtime.data(ELITE).supportedTasks.filter(task => Skills.meets(f.player, task)), [], "every elite task needs some level");
  f.skills.getCurrentLevel = skill => skill === core.Skill.WOODCUTTING ? 60 : 1;
  for (let i = 0; i < 20; i++) assert.equal(Skills.chooseTask(f.player, ELITE).key, "cluehelper_skillchallenge_elite_16");
});

test("a kill step's NPC drops the next clue for its killer, carrying the trail; without the clue it drops nothing", () => {
  const f = fixture();
  const npc = { getLocation: () => new core.Location(3000, 3000, 0) };
  for (const step of ofKind("cryptic", "kill").filter(entry => Runtime.data(ELITE).rollable.includes(entry))) {
    f.items.fill(null);
    f.place(step);
    const dropped = catchingDrops(() => Runtime.killDrop({ killer: f.player, npc, npcId: step.npcIds[0] }));
    assert.equal(f.items[0], null, `${step.key} the clue goes`);
    assert.ok(f.sent.some(([name, text]) => name === "message" && text === "<col=ff0000>You spot a new clue falling to the floor.</col>"), step.key);
    assert.equal(dropped.length, 1, step.key);
    assert.equal(dropped[0].player, f.player);
    assert.equal(dropped[0].item.getMetaValue(Runtime.metaKey(ELITE)).completed, 2, step.key);
    assert.ok(dropped[0].location.equals(npc.getLocation()));
    assert.equal(catchingDrops(() => Runtime.killDrop({ killer: f.player, npc, npcId: step.npcIds[0] })).length, 0, `${step.key} no clue, no drop`);
  }
  const last = ofKind("cryptic", "kill")[0];
  f.items.fill(null);
  f.place(last, { completed: 4, length: 5 });
  const dropped = catchingDrops(() => Runtime.killDrop({ killer: f.player, npc, npcId: last.npcIds[0] }));
  assert.equal(dropped[0].item.getId(), I.REWARD_CASKET_ELITE_, "the last step drops the casket");
});

test("both elite guards must die before the dig gives the clue", () => {
  const f = fixture();
  for (const id of [6587, 6588]) {
    const step = ofKind("coordinate").find(entry => entry.encounter.npcIds[0] === id);
    f.items.fill(null); f.spawned.length = 0;
    f.place(step);
    f.items[1] = new core.Item(I.SPADE, 1);
    f.digHere();
    assert.equal(f.spawned[0].def.id, id);
    assert.equal(f.spawned[0].attacked, f.player);
    f.digHere();
    assert.equal(f.state().completed, 1);
    f.spawned[0].hitpoints = 0;
    Runtime.encounterDied({ npc: f.spawned[0] });
    f.digHere();
    assert.equal(f.state().completed, 2, step.key);
  }
});

test("elite emotes bring Uri straight away, and every one has a STASH unit", () => {
  const f = fixture();
  for (const step of ofKind("emote")) {
    f.items.fill(null); f.worn.fill(null); f.spawned.length = 0;
    f.place(step);
    f.worn.splice(0, f.worn.length, ...outfit(step));
    Runtime.emote({ player: f.player, slot: step.emotes[0] });
    assert.equal(f.spawned[0]?.def.id, Runtime.data(ELITE).uri, step.key);
    assert.ok(step.stash, step.key);
  }
});

test("an opted-in player's elite casket can become the Mimic, carrying its rolls; the 25th is guaranteed once", () => {
  const f = fixture();
  MimicShared.bind({ core });
  f.api.onCustomEvent("treasure-trails:mimic-casket", MimicReward.fromCasket);
  const open = (slot = 0) => { f.items[slot] = new core.Item(I.REWARD_CASKET_ELITE_, 1); return Caskets.open(f.event(slot)); };
  const mimics = () => f.items.filter(item => item?.getId() === I.MIMIC).length;
  const random = Math.random;
  try {
    Math.random = () => 0;
    open();
    assert.equal(mimics(), 0, "no Mimic without opting in");
    f.items.fill(null);
    f.attributes.set("mimic:opted-in", true);
    open();
    assert.equal(f.items[0].getId(), I.MIMIC);
    const record = f.items[0].getMetaValue(MimicShared.ROLLS_META_KEY);
    assert.equal(record.tier, "elite");
    assert.ok(record.clueRolls >= 4 && record.clueRolls <= 6);
    assert.equal(f.attributes.get(Runtime.completedAttribute(ELITE)), 2, "the trail counts as complete");
    assert.ok(f.sent.some(([name, text]) => name === "message" && text === "The chest turned out to be the Mimic!"));
    open(1);
    assert.equal(mimics(), 1, "only one Mimic at a time");
    // Dry protection: the 25th casket of a player who never had one.
    f.items.fill(null);
    f.attributes.set("mimic:encountered", false);
    f.attributes.set(Runtime.completedAttribute(ELITE), 23);
    Math.random = () => 0.99;
    open();
    assert.equal(mimics(), 0, "the 24th isn't guaranteed");
    f.items.fill(null);
    open();
    assert.equal(mimics(), 1, "the 25th is");
    f.items.fill(null);
    f.attributes.set(Runtime.completedAttribute(ELITE), 24);
    open();
    assert.equal(mimics(), 0, "only the first Mimic is guaranteed");
  } finally { Math.random = random; }
});

test("the elite casket rolls 4-6; elite STASH units need Construction 77 and mahogany planks", () => {
  const f = fixture();
  assert.deepEqual(require("../data/definitions/clue-caskets.json").tables.elite.rolls, [4, 6]);
  f.items[0] = new core.Item(I.REWARD_CASKET_ELITE_, 1);
  assert.equal(Caskets.open(f.event()), true);
  assert.equal(f.attributes.get(Runtime.completedAttribute(ELITE)), 1);
  const units = [...Stash.stashes().values()].filter(unit => unit.tier === ELITE);
  assert.equal(units.length, 19);
  f.items.fill(null);
  [[I.HAMMER, 1], [I.SAW, 1], [I.MAHOGANY_PLANK, 2], [I.STEEL_NAILS, 10]].forEach(([id, amount], slot) => { f.items[slot] = new core.Item(id, amount); });
  f.skills.level = 77;
  Stash.interact({ player: f.player, objectId: units[0].step.stash.locId, location: units[0].location, handled: false });
  assert.deepEqual(f.attributes.get(Stash.BUILT_ATTRIBUTE), [units[0].step.stash.locId]);
  assert.equal(f.skills.xp, 600);
});

test("the King Black Dragon drops the elite key only while its clue is held", () => {
  const f = fixture();
  const step = ofKind("cryptic", "key")[0];
  f.place(step);
  const drops = [];
  Runtime.keyDrop({ player: f.player, npcId: step.npcIds[0], drops });
  assert.deepEqual(drops, [{ itemId: step.keyItem, amount: 1 }]);
  f.items.fill(null);
  const none = [];
  Runtime.keyDrop({ player: f.player, npcId: step.npcIds[0], drops: none });
  assert.deepEqual(none, []);
});
