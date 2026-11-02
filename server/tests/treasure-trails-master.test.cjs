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
const Puzzle = require("../plugins/treasuretrails/trails/Puzzle.TreasureTrails");
const Light = require("../plugins/treasuretrails/trails/Light.TreasureTrails");
const Falo = require("../plugins/treasuretrails/trails/Falo.TreasureTrails");
const MimicReward = require("../plugins/bosses/mimic/Reward.Mimic");
const MimicShared = require("../plugins/bosses/mimic/Shared.Mimic");
const Caskets = require("../plugins/treasuretrails/trails/Caskets.TreasureTrails");
const Stash = require("../plugins/treasuretrails/trails/Stash.TreasureTrails");
const { byName } = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails");
const TRANSCRIPTS = require("../data/definitions/npc-dialogues.json");
const MASTER = byName.get("master");
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
  const player = { getUsername: () => "Tester", getDisplayName: () => "Tester", getInventory: () => inventory, getSkillManager: () => skills, getEquipment: () => ({ getItems: () => worn }),
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
  function place(step, { length = 7, completed = 1, slot = 0 } = {}) {
    items[slot] = new core.Item(step.itemId, 1).setMetaValue(Runtime.metaKey(MASTER),
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
    state: () => items[0]?.getMetaValue(Runtime.metaKey(MASTER)),
    finish: () => { const current = chain; chain = null; for (const d of current?.getDialogues().values() ?? []) if (d instanceof core.ActionDialogue) d.send(player); },
  };
}

const steps = () => Runtime.data(MASTER).steps;
const GROUP_PARAM = require("../plugins/treasuretrails/trails/Catalogue.TreasureTrails").TRAIL_ITEM_GROUP_PARAM;
const outfit = step => step.equipment.filter(requirement => requirement.emptySlot == null).map(requirement => new core.Item(requirement.anyOf?.[0] ??
  [...C.getObjNames().keys()].find(id => C.getItem(id)?.params?.get?.(GROUP_PARAM) === requirement.group), 1));
const ofKind = (family, target) => steps().filter(step => step.family === family && (!target || step.target === target));
const SKILL_CHALLENGES = require("../plugins/treasuretrails/trails/data/skill-challenges.json");
const rollable = () => Runtime.data(MASTER).rollable;
const npcEvent = (f, step, npcId = step.npcIds[0]) => ({ player: f.player, npcId, npc: { getLocation: () => step.location }, clickType: 1, handled: false,
  definition: { getActions: () => ["Talk-to"] } });

test("every master row is a step on the one master clue scroll; Falo's songs and Sherlock's tasks load", () => {
  fixture();
  const data = Runtime.data(MASTER);
  assert.equal(data.oneItem, true);
  for (const [family, count] of [["anagram", 16], ["coordinate", 28], ["cryptic", 33], ["emote", 25], ["hotcold", 136], ["skillchallenge", 27]])
    assert.equal(ofKind(family).length, count, family);
  assert.ok(steps().every(step => step.itemId === I.CLUE_SCROLL_MASTER_));
  assert.equal(data.songs.length, 20);
  assert.ok(data.songs.every(song => song.answer.anyOf?.length || Number.isInteger(song.answer.group)));
  assert.equal(steps().filter(step => step.falo).map(step => step.key).join(), "cluehelper_cryptic_master_falo_the_bard");
  for (const step of ofKind("anagram")) {
    assert.deepEqual(step.puzzle.itemIds.map(id => C.getObjNames().get(id)).sort(), ["trail_master_cerberus_puzzlebox", "trail_master_gnomechild_puzzlebox",
      "trail_master_tob_puzzlebox", "trail_master_zulrah_puzzlebox"], step.key);
    assert.equal(C.getObjNames().get(step.light.itemId), "light_puzzle_box", step.key);
  }
  const fights = {};
  for (const step of steps().filter(entry => entry.encounter && entry.family !== "hotcold")) fights[`${step.family}:${step.encounter.npcIds.join("/")}`] = (fights[`${step.family}:${step.encounter.npcIds.join("/")}`] ?? 0) + 1;
  assert.deepEqual(fights, { "coordinate:7310": 19, "coordinate:7307/7308/7309": 9, "emote:7312": 25 });
  assert.ok(ofKind("emote").every(step => step.stash));
  assert.equal(data.uri, C.getNpcId("trail_master_uri"));
});

test("hot/cold starts from Jorral and three-part steps draw their parts; the targets themselves are never rolled", () => {
  fixture();
  const data = Runtime.data(MASTER);
  const out = steps().filter(step => !rollable().includes(step));
  assert.equal(out.filter(step => step.family === "hotcold").length, 136, "hot/cold targets come through Jorral");
  assert.deepEqual(rollable().filter(step => step.family === "cryptic").map(step => step.key).sort(),
    ["cluehelper_cryptic_master_falo_the_bard", "cluehelper_cryptic_master_jorral"]);
  assert.ok(rollable().some(step => step.key === "cluehelper_skillchallenge_master_25"), "the three-part step");
  // Viggora (no Curse of the Empty Lord), Piles (no Resource Area fee) and Lovada (not spawned) are never parts.
  assert.equal(data.parts.length, 27);
  assert.deepEqual(ofKind("cryptic").filter(step => !step.falo && !/_(jorral|watson)$/.test(step.key) && !data.parts.includes(step)).map(step => step.key).sort(),
    ["cluehelper_cryptic_master_lovada", "cluehelper_cryptic_master_piles", "cluehelper_cryptic_master_viggora"]);
  for (const family of ["anagram", "coordinate", "emote"]) assert.ok(ofKind(family).every(step => rollable().includes(step)), family);
  for (const step of ofKind("skillchallenge").filter(entry => entry.target !== "none")) assert.equal(rollable().includes(step), Boolean(SKILL_CHALLENGES[step.key]), step.key);
});

test("a fresh master clue starts a 6-8 step trail whose step lives in the clue's meta", () => {
  const f = fixture();
  const lengths = new Set();
  for (let i = 0; i < 60; i++) {
    f.items.fill(null);
    f.items[0] = new core.Item(I.CLUE_SCROLL_MASTER_, 1);
    f.actions.get("Clue scroll (master)").Read(f.event());
    const state = f.state();
    assert.equal(f.items[0].getId(), I.CLUE_SCROLL_MASTER_);
    assert.ok(rollable().some(step => step.row === state.row));
    lengths.add(state.length);
  }
  assert.deepEqual([...lengths].sort(), [6, 7, 8]);
  const step = ofKind("emote")[0];
  f.items.fill(null);
  f.place(step, { completed: 0 });
  const before = f.state();
  Runtime.advance(f.player, { state: before });
  assert.equal(f.items[0].getId(), I.CLUE_SCROLL_MASTER_);
  assert.equal(f.state().token, before.token);
  assert.equal(f.state().completed, 1);
});

/** Hands the step's box over, with `random` deciding puzzle (>= 0.5) or light (< 0.5) and the image. */
function handOver(f, step, random) {
  const trail = Runtime.trails(f.player)[0];
  Runtime.handOutPuzzle(f.player, { getLocation: () => step.location }, step.npcIds[0], trail, random);
  f.finish();
  return f.items.findIndex((item, slot) => slot > 0 && item);
}

test("a master puzzle box is the image's own box with that image's 24 pieces, and solving it gives the next clue", () => {
  const f = fixture();
  for (const image of MASTER.puzzleImages) {
    const ids = Puzzle.pieces(image);
    assert.equal(new Set(ids).size, 24, `image ${image}`);
  }
  const step = ofKind("anagram")[0];
  f.place(step);
  const slot = handOver(f, step, () => 0.9);
  const box = f.items[slot];
  const image = box.getMetaValue(Runtime.metaKey(MASTER)).image;
  assert.equal(box.getId(), C.getObjId(MASTER.puzzleBoxes[image]));
  f.talk(step.npcIds[0]); f.finish();
  assert.equal(f.state().completed, 1, "refused unsolved");
  f.actions.get("Puzzle box (master)").Open(f.event(slot));
  const board = Puzzle.boards().get(f.player).board;
  board.splice(0, 25, ...Puzzle.solvedBoard());
  Puzzle.slide(board, 23);
  Puzzle.click({ player: f.player, slot: 24 });
  f.talk(step.npcIds[0]); f.finish();
  assert.equal(f.state().completed, 2);
  assert.equal(f.items.filter(item => item && item.getAmount() > 0).length, 1, "the box goes with the step");
});

/** The presses (a subset of switches) that light every light of a box. */
function solution(box) {
  for (let set = 0; set < 1 << Light.SWITCHES; set++) {
    let unlit = box.unlit;
    for (let i = 0; i < Light.SWITCHES; i++) if (set & 1 << i) unlit ^= box.masks[i];
    if (unlit === 0) return [...Array(Light.SWITCHES).keys()].filter(i => set & 1 << i);
  }
  return null;
}

test("a light box is always solvable, its switches toggle their own lights, and lighting them all gives the next clue", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) {
    const box = Light.newBox(random);
    assert.equal(new Set(box.masks).size, Light.SWITCHES);
    assert.notEqual(box.unlit, 0);
    assert.ok(solution(box), "solvable");
  }
  const f = fixture();
  const step = ofKind("anagram")[1];
  f.place(step);
  const slot = handOver(f, step, () => 0.1);
  assert.equal(f.items[slot].getId(), step.light.itemId);
  f.sent.length = 0;
  f.actions.get("Light box").Open(f.event(slot));
  const varp = C.getVarpId("trail_lights");
  const meta = () => f.items[slot].getMetaValue(Runtime.metaKey(MASTER));
  assert.ok(f.sent.some(([name, id, value]) => name === "sendConfig" && id === varp && value === meta().unlit && value !== 0));
  assert.ok(f.sent.some(([name, group]) => name === "sendInterface" && group === C.getInterfaceId("light_puzzle")));
  f.talk(step.npcIds[0]); f.finish();
  assert.equal(f.state().completed, 1, "refused unsolved");
  const buttons = [...Array(Light.SWITCHES).keys()].map(i => C.getComponentId(`light_puzzle:button${i + 1}`));
  const before = meta().unlit;
  Light.click({ player: f.player, buttonId: buttons[0] });
  assert.equal(meta().unlit, (before ^ meta().masks[0]) >>> 0);
  Light.click({ player: f.player, buttonId: buttons[0] });
  assert.equal(meta().unlit, before, "pressing twice undoes");
  for (const i of solution(meta())) Light.click({ player: f.player, buttonId: buttons[i] });
  assert.equal(meta().solved, true);
  assert.ok(f.sent.some(([name, id, value]) => name === "sendConfig" && id === varp && value === 0));
  f.talk(step.npcIds[0]); f.finish();
  assert.equal(f.state().completed, 2);
});

/** The texts of every dialogue started while `run` runs (the fixture keeps only the last chain). */
function shownDuring(f, run) {
  const shown = [], manager = f.player.getDialogueManager;
  f.player.getDialogueManager = () => ({ startDialogues: chain => {
    shown.push(...[...chain.getDialogues().values()].map(entry => entry.getText?.()).filter(Boolean));
    manager().startDialogues(chain);
  } });
  try { run(); } finally { f.player.getDialogueManager = manager; }
  return shown;
}

test("master box NPCs use their own words; hand-overs and solving say what live OSRS does", () => {
  const f = fixture();
  const step = ofKind("anagram").find(entry => entry.key === "cluehelper_anagram_master_goreu");
  f.place(step);
  // Live captures (rsprox.net): "Wingstone hands you a light puzzle box." / "Immenizz hands you a puzzlebox!"
  assert.ok(shownDuring(f, () => handOver(f, step, () => 0.1)).includes("Goreu hands you a light puzzle box."));
  played.length = 0;
  f.talk(step.npcIds[0]); f.finish();
  assert.deepEqual(played, [{ npc: "That doesn't look solved to me." }]);
  const slot = f.items.findIndex((item, index) => index > 0 && item);
  f.sent.length = 0;
  f.actions.get("Light box").Open(f.event(slot));
  assert.ok(f.sent.some(([name, text]) => name === "message" && text === "You open the light box's control panel."));
  const meta = () => f.items[slot].getMetaValue(Runtime.metaKey(MASTER));
  const buttons = [...Array(Light.SWITCHES).keys()].map(i => C.getComponentId(`light_puzzle:button${i + 1}`));
  const shown = shownDuring(f, () => { for (const i of solution(meta())) Light.click({ player: f.player, buttonId: buttons[i] }); });
  assert.deepEqual(shown, ["Well done, hand this back!"]);
  assert.deepEqual(shownDuring(f, () => f.actions.get("Light box").Open(f.event(slot))), ["You've already solved this challenge! Go hand it back."]);
  f.items.fill(null);
  f.place(step);
  assert.ok(shownDuring(f, () => handOver(f, step, () => 0.9)).includes("Goreu hands you a puzzlebox!"));
});

test("three Ancient Wizards come together and all must die before the dig; a Brassican Mage comes alone", () => {
  const f = fixture();
  const wizards = ofKind("coordinate").find(step => step.encounter.npcIds.length === 3);
  f.place(wizards);
  f.items[1] = new core.Item(I.SPADE, 1);
  f.digHere();
  assert.deepEqual(f.spawned.map(npc => npc.def.id), [7307, 7308, 7309]);
  assert.ok(f.spawned.every(npc => npc.attacked === f.player));
  for (const npc of f.spawned.slice(0, 2)) { npc.hitpoints = 0; Runtime.encounterDied({ npc }); }
  f.digHere();
  assert.equal(f.state().completed, 1, "one still stands");
  assert.equal(f.spawned.length, 3, "no fresh fight while one lives");
  f.spawned[2].hitpoints = 0; Runtime.encounterDied({ npc: f.spawned[2] });
  assert.equal(f.state().defeated, true);
  f.digHere();
  assert.equal(f.state().completed, 2);
  const mage = ofKind("coordinate").find(step => step.encounter.npcIds[0] === 7310);
  f.items.fill(null); f.spawned.length = 0;
  f.place(mage);
  f.items[1] = new core.Item(I.SPADE, 1);
  f.digHere();
  assert.deepEqual(f.spawned.map(npc => npc.def.id), [7310]);
});

test("every master emote sends the level 141 double agent first, then Uri", () => {
  const f = fixture();
  for (const step of ofKind("emote")) {
    f.items.fill(null); f.worn.fill(null); f.spawned.length = 0;
    f.place(step);
    f.worn.splice(0, f.worn.length, ...outfit(step));
    Runtime.emote({ player: f.player, slot: step.emotes[0] });
    assert.equal(f.spawned[0]?.def.id, 7312, step.key);
    f.spawned[0].hitpoints = 0;
    Runtime.encounterDied({ npc: f.spawned[0] });
    assert.equal(f.spawned[1]?.def.id, Runtime.data(MASTER).uri, step.key);
  }
});

test("Falo sings a song, keeps singing it, refuses the wrong object and takes the right one for the next clue", () => {
  const f = fixture();
  const step = steps().find(entry => entry.falo);
  f.place(step);
  played.length = 0;
  let shown = [];
  const manager = f.player.getDialogueManager;
  f.player.getDialogueManager = () => ({ startDialogues: chain => {
    shown = [...chain.getDialogues().values()].map(entry => entry.getText?.()).filter(Boolean);
    manager().startDialogues(chain);
  } });
  Falo.talk(npcEvent(f, step)); f.finish();
  f.player.getDialogueManager = manager;
  const song = Runtime.data(MASTER).songs.find(entry => entry.row === f.state().song);
  assert.ok(song);
  assert.ok(played.some(line => line.npc === `Here goes... ${song.text}`), "he sings the song itself");
  assert.ok(shown.includes("Thank you for coming Tester, I need your help."), "the Fremennik name is filled in");
  played.length = 0;
  Falo.talk(npcEvent(f, step)); f.finish();
  assert.equal(f.state().song, song.row, "the same song again");
  assert.ok(played.some(line => line.npc === `Okay, here goes... ${song.text}`));
  const right = song.answer.anyOf?.[0] ?? [...C.getObjNames().keys()].find(id => C.getItem(id)?.params?.get?.(GROUP_PARAM) === song.answer.group &&
    !core.ItemDefinition.forId(id).isNoted());
  const wrong = I.BRONZE_DAGGER;
  const use = itemId => ({ player: f.player, npcId: step.npcIds[0], target: { getLocation: () => step.location }, itemId, handled: false });
  assert.equal(Falo.isAnswer(song, right), true);
  assert.equal(Falo.isAnswer(song, wrong), false);
  Falo.showItem(use(wrong)); f.finish();
  assert.equal(f.state().completed, 1);
  assert.ok(f.sent.some(([name, text]) => name === "message" && text === "Falo's eyes fail to light up."));
  Falo.showItem(use(right)); f.finish();
  assert.equal(f.state().completed, 2);
  assert.equal(f.state().song, undefined, "the next step has no song");
  const outlander = fixture();
  outlander.api.onCustomEvent("quest:is-started", request => { request.started = false; });
  outlander.place(step);
  played.length = 0;
  Falo.talk(npcEvent(outlander, step)); outlander.finish();
  assert.deepEqual(played, [{ player: "Hi there! Who are you?" }, { npc: "Get away! I do not speak to outlanders." }]);
});

/** A payload the task's detector accepts. */
function payloadFor(rule) {
  const value = spec => spec?.item ? I[spec.item[0]] : spec?.npc ? core.NpcIdentifiers[spec.npc[0]] : spec?.prayer ? core.PrayerHandler[spec.prayer[0]] :
    spec?.min != null ? spec.min : Array.isArray(spec) ? spec[0] : spec;
  return Object.fromEntries(Object.entries(rule.match ?? {}).map(([field, spec]) => [field, value(spec)]));
}

test("a master clue is its own Sherlock task: done with the clue held, then he gives the next clue", () => {
  const f = fixture();
  const supported = ofKind("skillchallenge").filter(step => SKILL_CHALLENGES[step.key]);
  assert.ok(supported.length >= 10, `supported master tasks: ${supported.length}`);
  for (const step of supported) {
    f.items.fill(null); f.worn.fill(null); f.sent.length = 0;
    f.place(step);
    f.actions.get("Clue scroll (master)").Read(f.event());
    assert.ok(f.sent.some(([name, text]) => name === "sendString" && text === step.text), step.key);
    played.length = 0;
    Skills.talk(npcEvent(f, step)); f.finish();
    assert.deepEqual(played, [{ npc: "If you find a scroll that requires my attention, bring it to me and I shall handle it." }], step.key);
    const rule = SKILL_CHALLENGES[step.key];
    for (const { slot, item, name } of rule.worn ? [].concat(rule.worn) : []) {
      const id = item ? I[[].concat(item)[0]] : [...C.getObjNames().keys()].find(x => (C.getItem(x)?.name ?? "").toLowerCase().includes(name.toLowerCase()));
      f.worn[core.Equipment[slot]] = new core.Item(id, 1);
    }
    if (rule.worn || rule.area) {
      Skills.performed(rule.event, f.player, { player: f.player, killer: f.player, ...payloadFor(rule), location: { x: 0, y: 0, z: 0 } });
      if (rule.area) assert.notEqual(f.state().taskDone, true, `${step.key} elsewhere doesn't count`);
    }
    const payload = { player: f.player, killer: f.player, ...payloadFor(rule) };
    if (rule.area) payload.location = { x: rule.area.x[0], y: rule.area.y[0], z: rule.area.z ?? 0 };
    if (rule.area) f.player.getLocation = () => new core.Location(rule.area.x[0], rule.area.y[0], rule.area.z ?? 0);
    Skills.performed(rule.event, f.player, payload);
    assert.equal(f.state().taskDone, true, step.key);
    played.length = 0;
    Skills.talk(npcEvent(f, step)); f.finish();
    assert.deepEqual(played, [{ npc: "Fantastic! Here, have this." }], step.key);
    assert.equal(f.state().completed, 2, step.key);
    assert.equal(f.state().taskDone, undefined, `${step.key} the next step starts undone`);
  }
});

test("the master casket opens, and an opted-in player's 10th master casket is a guaranteed Mimic", () => {
  const f = fixture();
  MimicShared.bind({ core });
  f.api.onCustomEvent("treasure-trails:mimic-casket", MimicReward.fromCasket);
  assert.deepEqual(require("../data/definitions/clue-caskets.json").tables.master.rolls, [5, 7]);
  const random = Math.random;
  try {
    Math.random = () => 0.99;
    f.items[0] = new core.Item(I.REWARD_CASKET_MASTER_, 1);
    assert.equal(Caskets.open(f.event()), true);
    assert.equal(f.attributes.get(Runtime.completedAttribute(MASTER)), 1);
    // Live captures (rsprox.net): the order and colours of the casket's messages.
    const said = f.sent.filter(([name]) => name === "message").map(([, text]) => text);
    assert.deepEqual(said.slice(0, 2), ["Well done, you've completed the Treasure Trail!", "<col=ef1020>You have completed 1 master Treasure Trail.</col>"]);
    assert.match(said.at(-1), /^<col=ef1020>Your treasure is worth around [\d,]+ coins!<\/col>$/);
    f.items.fill(null);
    f.attributes.set("mimic:opted-in", true);
    f.attributes.set(Runtime.completedAttribute(MASTER), 9);
    f.items[0] = new core.Item(I.REWARD_CASKET_MASTER_, 1);
    Caskets.open(f.event());
    assert.equal(f.items[0].getId(), I.MIMIC, "the 10th master casket");
    assert.equal(f.items[0].getMetaValue(MimicShared.ROLLS_META_KEY).tier, "master");
  } finally { Math.random = random; }
});

test("master STASH units need Construction 88, mahogany planks and a gold leaf", () => {
  const f = fixture();
  const units = [...Stash.stashes().values()].filter(unit => unit.tier === MASTER);
  assert.equal(units.length, 25);
  [[I.HAMMER, 1], [I.SAW, 1], [I.MAHOGANY_PLANK, 2], [I.STEEL_NAILS, 10]].forEach(([id, amount], slot) => { f.items[slot] = new core.Item(id, amount); });
  f.skills.level = 88;
  const build = () => Stash.interact({ player: f.player, objectId: units[0].step.stash.locId, location: units[0].location, handled: false });
  build();
  assert.equal(f.attributes.get(Stash.BUILT_ATTRIBUTE), undefined, "no gold leaf, no unit");
  assert.ok(f.sent.some(([name, text]) => name === "message" && /gold leaf/.test(text)));
  f.items[4] = new core.Item(I.GOLD_LEAF, 1);
  build();
  assert.deepEqual(f.attributes.get(Stash.BUILT_ATTRIBUTE), [units[0].step.stash.locId]);
  assert.equal(f.skills.xp, 1500);
  assert.equal(f.items[4], null, "the gold leaf is used");
});

const HotCold = require("../plugins/treasuretrails/trails/HotCold.TreasureTrails");
const Parts = require("../plugins/treasuretrails/trails/Parts.TreasureTrails");
const MASTER_PARTS = require("../plugins/treasuretrails/trails/data/master-parts.json");

/** A fixture whose player takes hits, has given bonuses and answers quest checks. */
function masterFixture({ quests = true } = {}) {
  const f = fixture();
  f.hits = [];
  f.player.getCombat = () => ({ getHitQueue: () => ({ addPendingDamage: hits => f.hits.push(...hits) }) });
  f.bonuses = { attack: [0, 0, 0, 0, 0], other: [0, 0, 0, 0] };
  f.player.getBonusManager = () => ({ getAttackBonus: () => f.bonuses.attack, getOtherBonus: () => f.bonuses.other });
  f.player.setLocation = (x, y, z = 0) => { f.player.getLocation = () => new core.Location(x, y, z); };
  f.bank = [];
  f.player.getBanks = () => [{ getItems: () => f.bank }];
  f.api.onCustomEvent("quest:is-complete", request => { request.complete = quests; });
  return f;
}

const BONUS_UPDATE = core.BonusManager.update;
core.BonusManager.update = () => {};
const jorral = () => steps().find(step => step.key === "cluehelper_cryptic_master_jorral");
const threePart = () => steps().find(step => step.key === "cluehelper_skillchallenge_master_25");
const part = key => steps().find(step => step.key === `cluehelper_cryptic_master_${key}`);
const deviceId = () => C.getObjId("master_device");
const feel = f => HotCold.feel({ player: f.player, itemId: deviceId(), slot: f.items.findIndex(item => item?.getId() === deviceId()) });
const messages = f => f.sent.filter(([name]) => name === "message").map(([, text]) => text);

/** Puts a three-part step in slot 0 with these parts. */
function placeParts(f, keys, { completed = 1, length = 7 } = {}) {
  f.items[0] = new core.Item(I.CLUE_SCROLL_MASTER_, 1).setMetaValue(Runtime.metaKey(MASTER), { version: 1, token: `parts-${Math.random()}`, revision: 0,
    completed, length, row: threePart().row, parts: keys.map(key => part(key).row), found: [false, false, false] });
}

test("Jorral needs Making History, hands over the device once, and aims the clue at a master hot/cold target", () => {
  let f = masterFixture({ quests: false });
  f.place(jorral());
  played.length = 0;
  HotCold.talk(npcEvent(f, jorral())); f.finish();
  assert.ok(played.some(line => line.npc === "Stop! I can't help you unless you help me out first."));
  assert.equal(f.state().hotcold, undefined);
  f = masterFixture();
  f.place(jorral());
  assert.equal(f.talk(jorral().npcIds[0]).handled, false, "the generic NPC step leaves Jorral to hot/cold");
  assert.equal(f.state().completed, 1);
  const shown = shownDuring(f, () => { HotCold.talk(npcEvent(f, jorral())); f.finish(); });
  assert.ok(shown.includes("Ah! Remember that enchanted key you had to use previously?"));
  assert.ok(shown.includes("Jorral hands you the strange device."));
  assert.equal(f.items.filter(item => item?.getId() === deviceId()).length, 1);
  const target = Runtime.data(MASTER).byRow.get(f.state().hotcold);
  assert.equal(target.family, "hotcold");
  played.length = 0;
  HotCold.talk(npcEvent(f, jorral())); f.finish();
  assert.ok(played.some(line => /That strange device will guide you/.test(line.npc ?? "")));
  assert.equal(f.items.filter(item => item?.getId() === deviceId()).length, 1, "no second device");
  assert.equal(f.state().hotcold, target.row, "the target stays");
  const full = masterFixture();
  full.place(jorral());
  for (let slot = 1; slot < 28; slot++) full.items[slot] = new core.Item(I.BRONZE_DAGGER, 1);
  played.length = 0;
  HotCold.talk(npcEvent(full, jorral())); full.finish();
  assert.deepEqual(played, [{ npc: "You should make some room for it before I can give you it." }]);
});

test("feeling the device tells the temperature against last time and hurts; without a target it is inactive", () => {
  const f = masterFixture();
  f.items[1] = new core.Item(deviceId(), 1);
  feel(f);
  assert.deepEqual(messages(f), ["This device won't function yet."]);
  f.sent.length = 0;
  f.place(jorral());
  assert.deepEqual(shownDuring(f, () => feel(f)), ["The strange device is inactive."]);
  f.items[0].setMetaValue(Runtime.metaKey(MASTER), { ...f.state(), hotcold: Runtime.data(MASTER).hotcold[0].row, previous: null });
  const target = Runtime.data(MASTER).hotcold[0].location;
  f.sent.length = 0;
  f.player.setLocation(target.x + 120, target.y, target.z);
  feel(f);
  assert.deepEqual(messages(f), ["The device is warm.", "The power of the strange device hurts you in the process."]);
  assert.equal(f.hits.length, 1);
  assert.ok(f.hits[0].getDamage() >= 3 && f.hits[0].getDamage() <= 8);
  for (const [x, said] of [[60, "The device is very hot, and warmer than last time."], [60, "The device is very hot, and the same temperature as last time."],
    [600, "The device is ice cold, but colder than last time."], [2, "The device is visibly shaking, and warmer than last time."]]) {
    f.sent.length = 0;
    f.player.setLocation(target.x + x, target.y, target.z);
    feel(f);
    assert.equal(messages(f)[0], said);
  }
});

test("a hot/cold dig summons the target's fight, and once it is beaten the device cools and gives the next clue", () => {
  const f = masterFixture();
  const target = Runtime.data(MASTER).hotcold.find(step => step.encounter.npcIds.length === 3);
  f.place(jorral());
  f.items[0].setMetaValue(Runtime.metaKey(MASTER), { ...f.state(), hotcold: target.row, previous: null });
  f.items[1] = new core.Item(I.SPADE, 1);
  f.items[2] = new core.Item(deviceId(), 1);
  const dig = () => { const event = { player: f.player, itemId: I.SPADE, option: "Dig", allow: true }; HotCold.dig(event); return event.allow; };
  f.player.setLocation(target.location.x + 5, target.location.y, target.location.z);
  assert.equal(dig(), true, "outside the 9x9 square");
  f.player.setLocation(target.location.x + 4, target.location.y - 4, target.location.z);
  assert.equal(dig(), false);
  assert.deepEqual(f.spawned.map(npc => npc.def.id), [7307, 7308, 7309]);
  for (const npc of f.spawned) { npc.hitpoints = 0; Runtime.encounterDied({ npc }); }
  f.sent.length = 0;
  dig(); f.finish();
  assert.ok(messages(f).includes("The strange device cools as you find your treasure."));
  assert.equal(f.state().completed, 2);
  assert.equal(f.state().hotcold, undefined, "the next step has no target");
  assert.ok(f.items.some(item => item?.getId() === deviceId()), "the device is kept");
});

test("a three-part clue reads its three cryptics, striking each through once its torn part is found", () => {
  const f = masterFixture();
  placeParts(f, ["key_master", "1_47_77_35_46", "biblia"]);
  f.actions.get("Clue scroll (master)").Read(f.event());
  const text = keys => keys.map(([key, struck]) => struck ? `<str>${part(key).text}</str>` : part(key).text).join("<br><br>");
  assert.ok(f.sent.some(([name, value]) => name === "sendString" && value === text([["key_master"], ["1_47_77_35_46"], ["biblia"]])));
  const dig = part("1_47_77_35_46");
  f.player.setLocation(dig.location.x, dig.location.y, dig.location.z);
  f.items[1] = new core.Item(I.SPADE, 1);
  const shown = shownDuring(f, () => Parts.dig({ player: f.player, itemId: I.SPADE, option: "Dig", allow: true }));
  assert.deepEqual(shown, ["You find a torn part of a clue scroll."]);
  assert.ok(f.items.some(item => item?.getId() === C.getObjId("trail_master_part2")), "the second cryptic's part is part 2");
  assert.deepEqual(f.state().found, [false, true, false]);
  f.sent.length = 0;
  f.actions.get("Clue scroll (master)").Read(f.event());
  assert.ok(f.sent.some(([name, value]) => name === "sendString" && value === text([["key_master"], ["1_47_77_35_46", true], ["biblia"]])));
});

test("a part's NPC hands its torn part over in their own words, or asks for space", () => {
  const f = masterFixture();
  placeParts(f, ["key_master", "biblia", "mage_of_zamorak"]);
  const keyMaster = part("key_master");
  played.length = 0;
  const shown = shownDuring(f, () => { Parts.talk(npcEvent(f, keyMaster)); f.finish(); });
  assert.deepEqual(shown.slice(0, 2), ["Here you go.", "You are handed a torn part of a clue scroll."]);
  assert.ok(f.items.some(item => item?.getId() === C.getObjId("trail_master_part1")));
  assert.deepEqual(f.state().found, [true, false, false]);
  const full = masterFixture();
  placeParts(full, ["key_master", "biblia", "mage_of_zamorak"]);
  for (let slot = 1; slot < 28; slot++) full.items[slot] = new core.Item(I.BRONZE_DAGGER, 1);
  played.length = 0;
  Parts.talk(npcEvent(full, keyMaster)); full.finish();
  assert.deepEqual(played, [{ npc: "Hey, I have something for you but you don't have any space for it!" }]);
  assert.deepEqual(full.state().found, [false, false, false]);
});

test("the equipment checks: Robin, Ghommal, Cromperty, the Abbot, god items, white plate, the monk and the ring", () => {
  const f = masterFixture();
  const meets = key => Parts.meets(f.player, part(key));
  assert.equal(meets("robin"), false);
  f.bonuses.attack[core.BonusManager.ATTACK_RANGE] = 180;
  assert.equal(meets("robin"), true);
  f.worn[core.Equipment.WEAPON_SLOT] = new core.Item(I.TOXIC_BLOWPIPE, 1);
  assert.equal(meets("robin"), false, "a toxic blowpipe doesn't count");
  f.worn.fill(null);
  assert.equal(meets("ghommal"), false);
  f.bonuses.other[core.BonusManager.STRENGTH] = 100;
  assert.equal(meets("ghommal"), true);
  assert.equal(meets("wizard_cromperty"), false);
  f.bonuses.attack[core.BonusManager.ATTACK_MAGIC] = 100;
  assert.equal(meets("wizard_cromperty"), true);
  assert.equal(meets("abbot_langley"), false);
  f.bonuses.other[core.BonusManager.PRAYER] = -1;
  assert.equal(meets("abbot_langley"), true);
  assert.equal(meets("monk_of_entrana"), false);
  f.worn[core.Equipment.HEAD_SLOT] = new core.Item(I.BRONZE_FULL_HELM, 1);
  assert.equal(meets("monk_of_entrana"), true);
  f.worn.fill(null);
  for (const key of ["mage_of_zamorak", "juna"]) {
    const slots = part(key).equipment.filter(requirement => requirement.anyOf?.length);
    slots.slice(0, 2).forEach((requirement, index) => { f.worn[index] = new core.Item(requirement.anyOf[0], 1); });
    assert.equal(meets(key), false, `${key}: two god items`);
    f.worn[2] = new core.Item(slots[2].anyOf[0], 1);
    assert.equal(meets(key), true, `${key}: three god items`);
    f.worn.fill(null);
  }
  assert.equal(meets("sir_vyvin"), false);
  part("sir_vyvin").equipment.forEach((requirement, index) => { f.worn[index] = new core.Item(requirement.anyOf[0], 1); });
  assert.equal(meets("sir_vyvin"), true);
  f.worn.fill(null);
  const shadow = part("0_42_79_56_60");
  placeParts(f, ["0_42_79_56_60", "key_master", "biblia"]);
  f.player.setLocation(shadow.location.x, shadow.location.y, shadow.location.z);
  f.items[1] = new core.Item(I.SPADE, 1);
  Parts.dig({ player: f.player, itemId: I.SPADE, option: "Dig", allow: true });
  assert.deepEqual(f.state().found, [false, false, false], "no ring of visibility");
  f.items[2] = new core.Item(I.RING_OF_VISIBILITY, 1);
  Parts.dig({ player: f.player, itemId: I.SPADE, option: "Dig", allow: true });
  assert.deepEqual(f.state().found, [true, false, false]);
});

test("Robin says why he isn't impressed; the torn parts combine only all together and with the clue", () => {
  const f = masterFixture();
  placeParts(f, ["robin", "key_master", "biblia"]);
  played.length = 0;
  Parts.talk(npcEvent(f, part("robin"))); f.finish();
  assert.ok(played[0]?.npc?.startsWith("As THE Master Bowman, I am quite impressed by your equipment, but it's not the sort"));
  assert.deepEqual(f.state().found, [false, false, false]);
  f.bonuses.attack[core.BonusManager.ATTACK_RANGE] = 200;
  Parts.talk(npcEvent(f, part("robin"))); f.finish();
  Parts.talk(npcEvent(f, part("key_master"))); f.finish();
  const slotOf = name => f.items.findIndex(item => item?.getId() === C.getObjId(name));
  assert.deepEqual(shownDuring(f, () => Parts.combine({ player: f.player, slot: slotOf("trail_master_part1") })), ["I cannot combine the pieces without having all 3."]);
  assert.deepEqual(shownDuring(f, () => Parts.inspect({ player: f.player, slot: slotOf("trail_master_part1") })),
    ["There must be more parts to this. If I can combine them together..."]);
  Parts.talk(npcEvent(f, part("biblia"))); f.finish();
  assert.deepEqual(f.state().found, [true, true, true]);
  const clue = f.items[0];
  f.items[0] = null;
  f.sent.length = 0;
  Parts.combine({ player: f.player, slot: slotOf("trail_master_part2") });
  assert.deepEqual(messages(f), ["You cannot see how to combine the 3 pieces without also carrying your clue scroll."]);
  f.items[0] = clue;
  assert.ok(shownDuring(f, () => Parts.combine({ player: f.player, slot: slotOf("trail_master_part3") })).includes("You've obtained a new clue!"));
  assert.equal(f.state().completed, 2);
  assert.deepEqual(["trail_master_part1", "trail_master_part2", "trail_master_part3"].map(slotOf), [-1, -1, -1], "the parts are used");
  assert.equal(f.state().parts, undefined);
});

test("a lost torn part is found again by solving its part again, but not while it is carried or banked", () => {
  const f = masterFixture();
  placeParts(f, ["key_master", "1_47_77_35_46", "biblia"]);
  const slotOf = name => f.items.findIndex(item => item?.getId() === C.getObjId(name));
  const count = name => f.items.filter(item => item?.getId() === C.getObjId(name)).length;
  Parts.talk(npcEvent(f, part("key_master"))); f.finish();
  assert.equal(count("trail_master_part1"), 1);
  const again = npcEvent(f, part("key_master"));
  Parts.talk(again); f.finish();
  assert.equal(again.handled, false, "a carried part isn't handed over twice");
  assert.equal(count("trail_master_part1"), 1);
  f.items[slotOf("trail_master_part1")] = null; // destroyed
  assert.ok(shownDuring(f, () => { Parts.talk(npcEvent(f, part("key_master"))); f.finish(); }).includes("You are handed a torn part of a clue scroll."), "the NPC hands it over again");
  assert.equal(count("trail_master_part1"), 1);
  const dig = part("1_47_77_35_46");
  f.player.setLocation(dig.location.x, dig.location.y, dig.location.z);
  f.items[f.items.indexOf(null)] = new core.Item(I.SPADE, 1);
  const digHere = () => { const event = { player: f.player, itemId: I.SPADE, option: "Dig", allow: true }; const shown = shownDuring(f, () => Parts.dig(event)); return { allow: event.allow, shown }; };
  assert.deepEqual(digHere().shown, ["You find a torn part of a clue scroll."]);
  f.bank.push(f.items[slotOf("trail_master_part2")]);
  f.items[slotOf("trail_master_part2")] = null;
  f.sent.length = 0;
  const banked = digHere();
  assert.equal(banked.allow, false);
  assert.deepEqual(messages(f), ["You distinctly remember already finding a torn clue scroll part here and there isn't another one to take."]);
  assert.equal(count("trail_master_part2"), 0, "a banked part isn't found twice");
  f.bank.length = 0; // destroyed from the bank
  assert.deepEqual(digHere().shown, ["You find a torn part of a clue scroll."]);
  assert.equal(count("trail_master_part2"), 1);
  Parts.talk(npcEvent(f, part("biblia"))); f.finish();
  assert.deepEqual(f.state().found, [true, true, true]);
  assert.ok(shownDuring(f, () => Parts.combine({ player: f.player, slot: slotOf("trail_master_part1") })).includes("You've obtained a new clue!"), "the clue can still be finished");
  assert.equal(f.state().completed, 2);
});

test("a three-part step draws three different parts this server can finish", () => {
  const f = masterFixture();
  for (let i = 0; i < 100; i++) {
    f.items.fill(null);
    f.place(jorral(), { completed: 1, length: 7 });
    let seed = i * 7919 + 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const next = Runtime.nextItem({ tier: MASTER, state: f.state() }, () => {
      const rows = Runtime.data(MASTER).rollable;
      return (rows.indexOf(threePart()) + 0.5) / rows.length;
    });
    const state = next.item.getMetaValue(Runtime.metaKey(MASTER));
    assert.equal(state.row, threePart().row);
    assert.equal(new Set(state.parts).size, 3);
    assert.ok(state.parts.every(row => Runtime.data(MASTER).parts.some(step => step.row === row)));
    assert.ok(state.parts.every(row => !Object.keys(MASTER_PARTS.unrolled).includes(Runtime.data(MASTER).byRow.get(row).key)));
  }
});

test.after(() => { core.BonusManager.update = BONUS_UPDATE; });

const Watson = require("../plugins/treasuretrails/trails/Watson.TreasureTrails");

test("Watson takes one clue of each lower tier, says which he still needs, then hands over a master clue", () => {
  const f = masterFixture();
  const prompts = [];
  f.api.sendMultiChatboxPrompt = (player, title, ...pairs) => prompts.push({ title, pairs });
  const watsonId = 7304;
  const watson = { getLocation: () => new core.Location(1645, 3572, 0), getCurrentDefinition: () => C.getNpc(watsonId), getDefinition: () => C.getNpc(watsonId) };
  const check = () => { played.length = 0; Watson.check({ player: f.player, npcId: watsonId, npc: watson, clickType: 3, handled: false, definition: { getActions: () => C.getNpc(watsonId).actions } }); f.finish(); return played.map(line => line.npc); };
  assert.deepEqual(check(), ["I still need an easy clue, a medium clue, a hard clue and an elite clue from you before I give you a master clue scroll."]);
  const use = tier => {
    f.items[5] = new core.Item(I[`CLUE_SCROLL_${tier.toUpperCase()}_`], 1);
    prompts.length = 0;
    Watson.useClue({ player: f.player, target: watson, npcId: watsonId, itemId: f.items[5].getId(), slot: 5, handled: false });
    return prompts[0];
  };
  const medium = use("medium");
  assert.equal(medium.title, "Select an option");
  assert.deepEqual([medium.pairs[0], medium.pairs[2]], ["Hand over medium clue.", "Cancel."]);
  assert.deepEqual(shownDuring(f, () => medium.pairs[1]()), ["You hand over the clue scroll to Watson."]);
  assert.equal(f.items[5], null, "the clue is handed over");
  assert.equal(f.attributes.get("treasure-trails:watson-medium"), true);
  assert.ok(f.sent.some(([name, varbit, value]) => name === "sendVarbit" && varbit === C.getVarbitId("trail_watson_medium") && value === 1));
  f.sent.length = 0;
  assert.equal(use("medium"), undefined);
  assert.deepEqual(messages(f), ["You have already given Watson a clue scroll of that tier."]);
  assert.deepEqual(check(), ["I still need an easy clue, a hard clue and an elite clue from you before I give you a master clue scroll."]);
  // The generic clue is rolled into its step's item on use: the hand-over takes it all the same,
  // but not something else put in the slot.
  const easy = use("easy");
  f.items[5] = new core.Item(core.ItemIdentifiers.SHARK, 1);
  easy.pairs[1]();
  assert.equal(f.attributes.get("treasure-trails:watson-easy"), undefined, "not a clue any more");
  const rolled = 23154; // another "Clue scroll (easy)", as the step rolled it live
  assert.equal(core.ItemDefinition.forId(rolled).getName(), "Clue scroll (easy)");
  f.items[5] = new core.Item(rolled, 1);
  easy.pairs[1]();
  assert.equal(f.items[5], null, "a rolled clue of the tier is handed over");
  use("hard").pairs[1]();
  f.finish();
  const elite = use("elite");
  const shown = shownDuring(f, () => { elite.pairs[1](); f.finish(); });
  assert.ok(shown.includes("Nice work Tester, I've had one of each lower tier clue scroll from you."));
  assert.ok(shown.includes("Watson hands you a master clue scroll."));
  assert.ok(f.items.some(item => item?.getId() === I.CLUE_SCROLL_MASTER_));
  assert.ok(Watson.LOWER_TIERS.every(tier => f.attributes.get(`treasure-trails:watson-${tier}`) === false), "the tiers start again");
  const blocked = masterFixture();
  blocked.api.onCustomEvent("treasure-trails:can-receive", request => { if (request.tier === "master") request.allowed = false; });
  for (const tier of Watson.LOWER_TIERS) blocked.attributes.set(`treasure-trails:watson-${tier}`, true);
  assert.equal(Watson.settle(blocked.player, watsonId), false, "no room for another master clue");
  const master = masterFixture();
  master.place(ofKind("emote")[0]);
  played.length = 0;
  Watson.useClue({ player: master.player, target: watson, npcId: watsonId, itemId: I.CLUE_SCROLL_MASTER_, slot: 0, handled: false }); master.finish();
  assert.deepEqual(played, [{ npc: "Sorry [player name]. That scroll is for you, not me." }]);
});
