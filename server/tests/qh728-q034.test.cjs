// Source-contract checks for Ethically Acquired Antiquities (Quest Helper q034).
// Run from server/: node --test tests/qh728-q034.test.cjs
//
// Quest Helper source: pinned /tmp/tsps-600-parallel/quest-helper
// src/main/java/com/questhelper/helpers/quests/ethicallyacquiredantiquities/
// EthicallyAcquiredAntiquities.java at 06da90f982518a093f2fe1c9cfac5547fa7053d3.
//
// The route starts at fresh stage 0 but fixture-sets the two prerequisite quests
// and 25 Thieving. Handler edges are driven with the transcript's own lines,
// condition ids, choice ids and action ids. The interrogation/cutscene body between
// stage 28 and stage 34 needs its game-tick scene runner, so those tests fixture-set
// stage 30/32/34 and prove the recovery and hand-in edges around it. These tests
// prove registered-handler contracts and the durable-stage/wire graph, not a live
// playthrough or the visual Quest Helper overlay.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const DIALOGUES = process.env.QH_DIALOGUES_CANDIDATE
  ? JSON.parse(fs.readFileSync(process.env.QH_DIALOGUES_CANDIDATE, 'utf8'))
  : require('../data/definitions/npc-dialogues.json');

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

const PAGE = 'Ethically Acquired Antiquities';
const STAGE_VARBIT = 11193;
const STAGE_COMPLETE = 38;

const transcripts = [];
const realStartTranscript = runtime.startTranscript;
runtime.startTranscript = (api, player, npcId, page, variant, select) => {
  transcripts.push({ player, npcId, page, variant, select });
  return true;
};

function setup({ boneVoyage = false } = {}) {
  const realCore = PluginManager.getCoreApi();
  const hooks = {
    variants: [], conditions: [], custom: new Map(), login: [], logout: [],
    npc: new Map(), npcs: [], objects: new Map(), itemActions: new Map(),
    itemOnNpc: [],
  };
  const tasks = [];
  class FakeCountdownTask {
    constructor(key, ticks, callback) { Object.assign(this, { key, ticks, callback }); }
  }
  const TaskManager = {
    submit(task) { tasks.push(task); return task; },
    cancelTasks() {},
  };
  const core = {
    ...realCore,
    TaskManager,
    CountdownTask: FakeCountdownTask,
  };
  const messages = [], xp = [], jingles = [], varbits = new Map(), interfaces = [];
  const spawned = [];
  const completed = new Set();
  const api = new Proxy({
    core,
    persistAttribute() {},
    getTaskManager: () => TaskManager,
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(name, handlers) { hooks.npc.set(name, handlers); },
    onNpcsInteraction(names, handlers) { hooks.npcs.push({ names, handlers }); },
    onObjectInteraction(name, handlers) { hooks.objects.set(name, handlers); },
    onItemAction(name, handlers) { hooks.itemActions.set(name, handlers); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    onCustomEvent(name, fn) {
      const list = hooks.custom.get(name) ?? [];
      list.push(fn);
      hooks.custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') event.complete = completed.has(event.key);
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    spawnNpc(data) {
      const npc = { ...data, getId: () => data.id, performAnimation() {}, setPositionToFace() {},
        getMovementQueue: () => ({ addSteps() {} }), setMovementSteps() {} };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { if (npc) npc.removed = true; },
    sendMultiChatboxPrompt(player, prompt, ...pairs) {
      messages.push({ prompt, pairs });
      player.prompt = { prompt, pairs };
      return true;
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });

  require('../plugins/quests/quests/EthicallyAcquiredAntiquities.Quest')(api);
  if (boneVoyage) require('../plugins/quests/quests/BoneVoyage.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'ethically_acquired_antiquities');

  const attrs = new Map(), inventory = new Map();
  let location = new realCore.Location(1721, 3165, 0);
  let full = false;
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig() { return sender; },
    sendJingle(id) { jingles.push(id); return sender; },
    sendInterface(id, ...args) { interfaces.push([id, ...args]); return sender; },
    sendString() { return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  const inventoryApi = {
    getAmount: (id) => inventory.get(id) ?? 0,
    contains: (id) => (inventory.get(id) ?? 0) > 0,
    isFull: () => full,
    getFreeSlots: () => (full ? 0 : 28 - [...inventory.values()].filter((n) => n > 0).length),
    adds(id, amount = 1) {
      if (full) return false;
      inventory.set(id, (inventory.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd(id, amount = 1) { inventory.set(id, (inventory.get(id) ?? 0) + amount); return true; },
    deleteNumber(id, amount = 1) {
      assert.ok((inventory.get(id) ?? 0) >= amount, `missing item ${id}`);
      inventory.set(id, (inventory.get(id) ?? 0) - amount);
      return true;
    },
    getItems: () => [...inventory].filter(([, n]) => n > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getInventory: () => inventoryApi,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
    }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({
      startDialogues() {}, getCurrent: () => null, reset() {}, isActive: () => false, advance() {},
    }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() {}, addSteps() {} }),
    getLocation: () => location,
    moveTo(next) { location = next; },
    setPositionToFace() {},
    setUntargetable() {},
    performAnimation() {},
    getArea: () => null,
    sendMessage: (text) => messages.push(text),
    getUsername: () => 'qh728-q034',
    isRegistered: () => true,
    isPlayer: () => true,
    isPlayerBot: () => false,
  };

  const emit = (name, event = {}) => {
    if (name === 'quest:is-complete') event.complete = completed.has(event.key);
    for (const fn of hooks.custom.get(name) ?? []) fn({ player, ...event });
  };
  const fire = emit;
  const line = (npcId, text) => {
    const event = { player, npcId, text, step: {}, pages: [{ page: PAGE }] };
    for (const fn of hooks.custom.get('npc-dialogue:line') ?? []) fn(event);
    event.before?.();
    event.after?.();
    return event;
  };
  const action = (stepId, npcId, extra = {}) => emit('npc-dialogue:action', { npcId, stepId, handled: false, pages: [{ page: PAGE }], ...extra });
  const choice = (npcId, option, stepId) => emit('npc-dialogue:choice', { npcId, option, stepId });
  const chosen = (stepId, npcId) => emit('npc-dialogue:condition', { stepId, npcId });
  const answer = (stepId, npcId, text) => hooks.conditions
    .map((fn) => fn({ player, stepId, npcId, text, pages: [{ page: PAGE }] }))
    .find((value) => value !== null && value !== undefined);
  const variant = (npcId) => hooks.variants.map((fn) => fn({ player, npcId })).find(Boolean) ?? null;
  const namedNpc = (name, option, event = {}) => {
    const handlers = hooks.npc.get(name);
    assert.ok(handlers?.[option], `missing ${name}.${option}`);
    return handlers[option]({ player, option, handled: false, ...event });
  };
  const namedObject = (name, option, event = {}) => {
    const handlers = hooks.objects.get(name);
    assert.ok(handlers?.[option], `missing ${name}.${option}`);
    return handlers[option]({ player, option, handled: false, ...event });
  };
  const itemAction = (name, option, event = {}) => {
    const handlers = hooks.itemActions.get(name);
    assert.ok(handlers?.[option], `missing ${name}.${option}`);
    return handlers[option]({ player, option, handled: false, ...event });
  };
  const crewNames = new Set(['Trader Crewmember', 'Trader crewmember', 'Trader Stan']);
  const crewTalk = (npcId, event = {}) => {
    const entry = hooks.npcs.find(({ names }) => names.some((name) => crewNames.has(name)));
    assert.ok(entry, 'missing crew Talk-to registration');
    return entry.handlers['Talk-to']({ player, npcId, option: 'Talk-to', handled: false, ...event });
  };
  const itemOnNpc = (itemId, npcId) => {
    for (const fn of hooks.itemOnNpc) fn({ player, itemId, npcId, handled: false });
  };
  const login = () => hooks.login.forEach((fn) => fn({ player }));
  const logout = () => hooks.logout.forEach((fn) => fn({ player }));

  return {
    api, core, player, quest, attrs, inventory, messages, xp, jingles, varbits, interfaces, spawned, tasks, hooks,
    fire, line, action, choice, chosen, answer, variant, namedNpc, namedObject, itemAction, crewTalk, itemOnNpc, login, logout,
    completed, setLocation(x, y, z = 0) { location = new realCore.Location(x, y, z); },
    setFull(value) { full = value; },
    lastTranscript() { return transcripts.at(-1); },
  };
}

const I = () => PluginManager.getCoreApi().ItemIdentifiers;
const N = () => PluginManager.getCoreApi().NpcIdentifiers;
const O = () => PluginManager.getCoreApi().ObjectIdentifiers;
const STAGE = {
  started: 2, investigate: 4, clue: 6, regulus: 8, crew: 10, repair: 12,
  returnSails: 14, portSarim: 16, betty: 18, readNotes: 20, haig: 22,
  storeroom: 24, confront: 28, shame: 30, cutscene: 32, cutsceneEnd: 34, return_: 36, complete: 38,
};

function withPrerequisites(h) {
  h.completed.add('children_of_the_sun');
  h.completed.add('shield_of_arrav');
  return h;
}

function beginRealCrewDialogue(h) {
  const request = h.lastTranscript();
  const page = DIALOGUES[PAGE];
  const raw = page.variants[request.variant];
  const definition = h.core.NpcDefinition.forId(request.npcId);
  startDialogue(h.api, { player: h.player, npcId: request.npcId, npc: null, definition },
    raw, page.branches, { pages: [{ page: PAGE }] });
}

function advanceDialogueToOption(player, label) {
  const manager = player.getDialogueManager();
  for (let count = 0; count < 100; count++) {
    const prompt = player.prompt;
    if (prompt) {
      const labels = prompt.pairs.filter((_, index) => index % 2 === 0);
      if (labels.includes(label)) return;
      throw new Error(`unexpected transcript menu; wanted ${label}, saw ${labels.join(' | ')}`);
    }
    if (!manager.getCurrent()) break;
    manager.advance();
  }
  throw new Error(`transcript did not reach option ${label}`);
}

function chooseDialogueOption(player, label) {
  const prompt = player.prompt;
  const pairIndex = prompt.pairs.findIndex((value, index) => index % 2 === 0 && value === label);
  assert.notEqual(pairIndex, -1, `missing transcript option ${label}`);
  player.prompt = null;
  prompt.pairs[pairIndex + 1]();
}

function finishDialogue(player) {
  const manager = player.getDialogueManager();
  for (let count = 0; count < 100 && !player.prompt; count++) {
    if (!manager.getCurrent()) return;
    manager.advance();
  }
  assert.equal(player.prompt, undefined, 'transcript did not end cleanly');
}

test('fresh stage 0 follows the mandatory route to the final hand-in and the cache wire', () => {
  const h = withPrerequisites(setup());
  const ids = I(), npcs = N(), objects = O();
  const p = h.player;
  assert.equal(h.quest.getStage(p), 0);

  // Stage 0: the display's notice, its requirements gate, then the Yes hook.
  assert.equal(h.namedObject('Empty display', 'Inspect', { definition: { id: objects.EMPTY_DISPLAY_5 } }), true);
  assert.ok(h.interfaces.some(([id]) => id === 873), 'the empty display opens its notice');
  h.tasks.shift().callback();
  assert.equal(h.lastTranscript().variant, 'xerna-s-stolen-diadem-inpecting-the-empty-display');
  assert.equal(h.answer('CAzpP4', npcs.CURATOR_HERMINIUS), false);
  assert.equal(h.answer('MBl5US', npcs.CURATOR_HERMINIUS), true);
  h.fire('npc-dialogue:hook', { hook: 'quest:ethically-acquired-antiquities:start' });
  assert.equal(h.quest.getStage(p), STAGE.started);
  assert.equal(h.varbits.get(STAGE_VARBIT), STAGE.started);
  assert.ok(h.messages.some((m) => String(m).includes('Ethically Acquired Antiquities')));

  // Stage 2 -> 4: Herminius offers the investigation.
  h.line(npcs.CURATOR_HERMINIUS, "Perhaps you'll have better luck though. Maybe you could have a look around for any sort of clues and see if you can find anything wrong.");
  assert.equal(h.quest.getStage(p), STAGE.investigate);

  // Stage 4: tools and the display, then the visitors.
  assert.equal(h.namedObject('Tools', 'Investigate', { definition: { id: objects.TOOLS_13 } }), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-investigating-the-tools-on-ground');
  assert.equal(h.namedObject('Empty display', 'Inspect', { definition: { id: objects.EMPTY_DISPLAY_5 } }), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-inpecting-the-empty-display-once-more');
  h.line(npcs.CURATOR_HERMINIUS, "I don't think I'm going to find much more just lying around... Maybe I should try asking if anyone nearby saw anything.");
  assert.equal(h.quest.getStage(p), STAGE.clue);

  // Stage 6: a no-lead visitor marks their kind; the informant's lead opens Regulus.
  h.setLocation(1712, 3165);
  h.attrs.set('quest.ethically_acquired_antiquities.informant', 'citizen');
  assert.equal(h.namedNpc('Academic', 'Talk-to', { npcId: 13298 }), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-talking-to-an-academic-citizen-or-tourist-that-didn-t-see-anything');
  h.line(13298, "No, I don't think so...");
  assert.equal(h.attrs.get('quest.ethically_acquired_antiquities.flags') & (1 << 4), 1 << 4);
  assert.equal(h.quest.getStage(p), STAGE.clue);
  assert.equal(h.namedNpc('Citizen', 'Talk-to', { npcId: 11533 }), true);
  h.line(11533, 'They left through the front door and turned right, towards the quetzal landing site.');
  assert.equal(h.quest.getStage(p), STAGE.regulus);

  // Stage 8 -> 10: Regulus sends the player to the Cothon.
  h.setLocation(1701, 3143);
  assert.equal(h.variant(npcs.REGULUS_CENTO_3), 'clues-in-civitas-illa-fortis-talking-to-regulus-cento');
  h.line(npcs.REGULUS_CENTO_3, 'Yes, I thought it was quite strange. I told him no, and he made his way east, towards the Cothon.');
  assert.equal(h.quest.getStage(p), STAGE.crew);

  // Stage 10: crew favour, full bag first, then the hand-over.
  h.setLocation(1742, 3135);
  assert.equal(h.crewTalk(9312), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember');
  h.line(9312, 'Although, we could use a hand... Think you could do us a small favour?');
  h.setFull(true);
  assert.equal(h.answer('1yeeSP', 9312), true);
  h.chosen('1yeeSP', 9312);
  assert.equal(h.attrs.get('quest.ethically_acquired_antiquities.pending-sails'), true);
  assert.equal(h.inventory.get(ids.TATTERED_SAILS) ?? 0, 0);
  assert.equal(h.quest.getStage(p), STAGE.crew);
  h.setFull(false);
  assert.equal(h.answer('bnZg2R', 9312), true);
  h.chosen('bnZg2R', 9312);
  h.action('1wx5TB', 9312);
  assert.equal(h.inventory.get(ids.TATTERED_SAILS), 1);
  assert.equal(h.attrs.get('quest.ethically_acquired_antiquities.pending-sails'), false);
  assert.equal(h.quest.getStage(p), STAGE.repair);

  // Stage 12: Artima repairs the tattered sails without needing a free slot.
  assert.equal(h.variant(npcs.ARTIMA), 'clues-in-civitas-illa-fortis-talking-to-artima');
  h.line(npcs.ARTIMA, "There we have it! They might not look the prettiest, but they'll be sturdy enough for the job at least.");
  assert.equal(h.inventory.get(ids.TATTERED_SAILS) ?? 0, 0);
  assert.equal(h.inventory.get(ids.SAILS), 1);
  assert.equal(h.quest.getStage(p), STAGE.repair);

  // Stage 12 -> 14: give the fixed sails back to any Cothon crewmember.
  h.action('7Wg9ig', 9312);
  assert.equal(h.inventory.get(ids.SAILS) ?? 0, 0);
  assert.equal(h.quest.getStage(p), STAGE.returnSails);

  // Stage 14 -> 16: the same Cothon crew say the man sailed to Port Sarim.
  assert.equal(h.crewTalk(9312), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember-after-having-returned-the-sails');
  h.line(9312, 'Well, we explained how it does work and he then asked us to take him to Port Sarim...');
  assert.equal(h.quest.getStage(p), STAGE.portSarim);

  // Stage 16 -> 18: Port Sarim crew point north to the runes.
  h.setLocation(3036, 3194);
  assert.equal(h.crewTalk(9312), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-port-sarim-talking-to-a-trader-crewmember-in-port-sarim');
  h.line(9312, 'Wandered up north, I think. Said something about trying to get hold of some runes.');
  assert.equal(h.quest.getStage(p), 18);

  // Stage 18: a full bag does not earn the notes or the stage.
  assert.equal(h.variant(npcs.BETTY), 'clues-in-port-sarim-talking-to-betty');
  h.setFull(true);
  h.line(npcs.BETTY, "I did take some notes. It was driving me crazy trying to make sense of it!");
  assert.equal(h.quest.getStage(p), STAGE.betty);
  assert.equal(h.inventory.get(ids.BETTYS_NOTES) ?? 0, 0);
  assert.equal(h.answer('2mcH7X', npcs.BETTY), true);
  assert.equal(h.quest.getStage(p), STAGE.betty);
  h.setFull(false);
  assert.equal(h.answer('94fUqn', npcs.BETTY), true);
  h.action('zLd3nC', npcs.BETTY);
  assert.equal(h.inventory.get(ids.BETTYS_NOTES), 1);
  assert.equal(h.quest.getStage(p), STAGE.readNotes);

  // Stage 20 -> 22: reading the notes moves the hunt to Varrock.
  h.itemAction("Betty's notes", 'Read');
  assert.equal(h.quest.getStage(p), STAGE.haig);
  assert.ok(h.interfaces.some(([id]) => id === 291));
  h.fire('interface:closed', { interfaceId: 291 });
  assert.equal(h.lastTranscript().variant, 'clues-in-port-sarim-inspecting-betty-s-notes-for-the-first-time');

  // Stage 22 -> 24: Haig denies it; pickpocket the key.
  h.setLocation(3257, 3449);
  assert.equal(h.namedNpc('Curator Haig Halen', 'Talk-to', { npcId: npcs.CURATOR_HAIG_HALEN }), true);
  assert.equal(h.lastTranscript().variant, 'in-varrock-museum-talking-to-curtor-haig-halen');
  h.line(npcs.CURATOR_HAIG_HALEN, "What awful news! I'm not sure I can help you with that, though...");
  assert.equal(h.quest.getStage(p), STAGE.storeroom);
  assert.equal(h.namedNpc('Curator Haig Halen', 'Pickpocket', { npcId: npcs.CURATOR_HAIG_HALEN }), true);
  assert.equal(h.inventory.get(ids.STOREROOM_KEY_3), 1);
  assert.equal(h.quest.getStage(p), STAGE.storeroom);

  // Stage 24 -> 28: searching the crate finds the diadem and opens the confrontation.
  assert.equal(h.namedObject('Crate', 'Search', { definition: { id: objects.CRATE_340 } }), true);
  assert.equal(h.lastTranscript().variant, 'in-varrock-museum-searching-the-crate');
  h.action('XVW4Mv', npcs.CURATOR_HAIG_HALEN);
  assert.equal(h.quest.getStage(p), STAGE.confront);

  // Stage 28: the confrontation transcript is selected and starts the scene.
  assert.equal(h.namedNpc('Curator Haig Halen', 'Talk-to', { npcId: npcs.CURATOR_HAIG_HALEN }), true);
  assert.equal(h.lastTranscript().variant, 'in-varrock-museum-talking-to-curator-haig-halen-after-finding-the-diadem');
  h.line(npcs.CURATOR_HAIG_HALEN, 'Ah...');
  assert.ok(h.tasks.length > 0, 'the interrogation schedules its scene');
  h.logout();
  assert.equal(h.quest.getStage(p), STAGE.confront, 'a logout before the scene advances keeps the retry stage');

  // Stage 30 -> 32 is inside the shame scene; fixture the passed state, then drive
  // the cutscene-end recovery and Haig's return line through registered edges.
  h.quest.setStage(p, STAGE.cutscene);
  assert.equal(h.namedNpc('Curator Haig Halen', 'Talk-to', { npcId: npcs.CURATOR_HAIG_HALEN }), true);
  assert.equal(h.quest.getStage(p), STAGE.cutsceneEnd);
  h.line(npcs.CURATOR_HAIG_HALEN, "Okay... I'll have it sent back at once.");
  assert.equal(h.quest.getStage(p), STAGE.return_);

  // Stage 36 -> 38: the final hand-in is blocked by a full bag, then completes once.
  assert.equal(h.variant(npcs.CURATOR_HERMINIUS), 'in-varrock-museum-talking-to-curator-herminius');
  h.setFull(true);
  assert.equal(h.answer('krLq4g', npcs.CURATOR_HERMINIUS), true);
  assert.equal(h.quest.getStage(p), STAGE.return_, 'the full-bag branch ends without the completion action');
  h.setFull(false);
  assert.equal(h.answer('krLq4g', npcs.CURATOR_HERMINIUS), false);
  const beforeCoins = h.inventory.get(ids.COINS) ?? 0;
  h.action('i2moAx', npcs.CURATOR_HERMINIUS);
  assert.equal(h.quest.getStage(p), STAGE.complete);
  assert.equal(h.varbits.get(STAGE_VARBIT), STAGE.complete, 'canonical varbit 11193 reaches the cache threshold 38');
  assert.deepEqual(h.xp, [[PluginManager.getCoreApi().Skill.THIEVING.getIndex(), 6000]]);
  assert.equal(h.inventory.get(ids.COINS) ?? 0, beforeCoins + 5000);
  assert.equal(h.inventory.get(ids.BETTYS_NOTES) ?? 0, 0);
  assert.ok(h.jingles.length >= 1);

  // Repeat and relog: no duplicate reward, stage replays on the wire.
  h.action('i2moAx', npcs.CURATOR_HERMINIUS);
  assert.equal(h.quest.getStage(p), STAGE.complete);
  assert.equal(h.xp.length, 1);
  assert.equal(h.inventory.get(ids.COINS) ?? 0, beforeCoins + 5000);
  h.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(h.varbits.get(STAGE_VARBIT), STAGE.complete, 'login/bootstrap resends the saved completion stage');

  // Post-quest shared NPCs fall through; Herminius keeps the finished quest page.
  for (const npcId of [npcs.BETTY, npcs.REGULUS_CENTO_3, npcs.CURATOR_HAIG_HALEN]) {
    assert.equal(h.variant(npcId), null, `finished save must not claim shared NPC ${npcId}`);
  }
  assert.equal(h.namedNpc('Curator Haig Halen', 'Talk-to', { npcId: npcs.CURATOR_HAIG_HALEN }), false);
  assert.equal(h.variant(npcs.CURATOR_HERMINIUS), 'in-varrock-museum-talking-to-curator-herminius');
  assert.equal(h.crewTalk(9312), false, 'finished quest leaves the charter crew menu alone');
});

test('lost sails, notes and key recover through their canonical transcript branches', () => {
  const h = withPrerequisites(setup());
  const ids = I(), npcs = N();
  const p = h.player;
  h.setLocation(1742, 3135);

  // Stage 12 with no tattered sails: Artima must not create them from nothing,
  // and the Cothon crew hands a replacement over.
  h.quest.setStage(p, STAGE.repair);
  assert.equal(h.variant(npcs.ARTIMA), null, 'Artima needs a tattered pair');
  assert.equal(h.crewTalk(9312), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-talking-to-trader-crewmember-after-agreeing-to-the-favour');
  h.setFull(true);
  assert.equal(h.answer('QbESwT', 9312), false, 'the replacement branch must yield to the full-bag branch');
  assert.equal(h.answer('Y9Jo6i', 9312), true);
  h.action('-1DZ27', 9312);
  assert.equal(h.inventory.get(ids.TATTERED_SAILS) ?? 0, 0);
  assert.equal(h.quest.getStage(p), STAGE.repair, 'a refused replacement does not advance the quest');
  h.setFull(false);
  assert.equal(h.answer('QbESwT', 9312), true);
  h.action('-1DZ27', 9312);
  assert.equal(h.inventory.get(ids.TATTERED_SAILS), 1);
  assert.equal(h.quest.getStage(p), STAGE.repair);
  assert.equal(h.variant(npcs.ARTIMA), 'clues-in-civitas-illa-fortis-talking-to-artima');

  // Stage 20 without the notes: Betty's "About those notes..." branch replaces them.
  h.inventory.delete(ids.TATTERED_SAILS);
  h.quest.setStage(p, STAGE.readNotes);
  assert.equal(h.variant(npcs.BETTY), 'clues-in-port-sarim-talking-to-betty-again');
  assert.equal(h.answer('HItAxB', npcs.BETTY), true);
  h.action('9CiLQ7', npcs.BETTY);
  assert.equal(h.inventory.get(ids.BETTYS_NOTES), 1);
  assert.equal(h.quest.getStage(p), STAGE.readNotes);

  // Stage 24 without the key: pickpocketing yields it again.
  h.quest.setStage(p, STAGE.storeroom);
  h.setLocation(3257, 3449);
  assert.equal(h.namedNpc('Curator Haig Halen', 'Pickpocket', { npcId: npcs.CURATOR_HAIG_HALEN }), true);
  assert.equal(h.inventory.get(ids.STOREROOM_KEY_3), 1);

  // Stage 24 with the key already held: no duplicate pickpocket.
  const event = { player: p, npcId: npcs.CURATOR_HAIG_HALEN, option: 'Pickpocket', handled: false };
  h.hooks.npc.get('Curator Haig Halen').Pickpocket(event);
  assert.equal(event.handled, false);
  assert.equal(h.inventory.get(ids.STOREROOM_KEY_3), 1);

  // Stage 34 cutscene-end recovery: talking to Haig resumes the final reply.
  h.quest.setStage(p, STAGE.cutsceneEnd);
  assert.equal(h.namedNpc('Curator Haig Halen', 'Talk-to', { npcId: npcs.CURATOR_HAIG_HALEN }), true);
  assert.equal(h.lastTranscript().variant, 'in-varrock-museum-talking-to-curator-haig-halen-after-finding-the-diadem');
  h.line(npcs.CURATOR_HAIG_HALEN, "Okay... I'll have it sent back at once.");
  assert.equal(h.quest.getStage(p), STAGE.return_);

  // A save already at 36 still replays 36 on login before the final hand-in.
  h.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(h.varbits.get(STAGE_VARBIT), STAGE.return_);
});

test('declining the Cothon favour can be recovered and hands over once', () => {
  const h = withPrerequisites(setup());
  const ids = I(), npcs = N();
  const p = h.player;
  h.setLocation(1742, 3135);
  h.quest.setStage(p, STAGE.crew);

  // Decline first: only the flag persists, no sails and no stage.
  assert.equal(h.crewTalk(9312), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember');
  h.choice(9312, 'Not right now.');
  assert.equal(h.attrs.get('quest.ethically_acquired_antiquities.declined-favour'), true);
  assert.equal(h.inventory.get(ids.TATTERED_SAILS) ?? 0, 0);
  assert.equal(h.quest.getStage(p), STAGE.crew);

  // Later retry selects the declined variant. Reading it alone must not grant anything.
  assert.equal(h.crewTalk(9312), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember-after-declining-doing-the-favour');
  assert.equal(h.inventory.get(ids.TATTERED_SAILS) ?? 0, 0);
  assert.equal(h.quest.getStage(p), STAGE.crew);

  // The normal export carries both conditional acceptance options and their shared tail.
  const raw = DIALOGUES[PAGE].variants['clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember-after-declining-doing-the-favour'];
  assert.equal(h.lastTranscript().select, undefined, 'the quest consumes the canonical variant directly');
  const caseOption = raw.flatMap((step) => step.options ?? [])
    .find((option) => option.text === 'Have you seen a man with a case?');
  const favourMenu = caseOption.steps.find((step) => step.type === 'choice');
  assert.deepEqual(favourMenu.options.map((option) => option.text), [
    'Sure. What do you need?',
    'As long as it is just the one favour...',
    'No thanks.',
  ]);
  assert.equal(favourMenu.options[0].condition_id, 'jVFeXW');
  assert.equal(favourMenu.options[1].condition_id, 'wQ6LNT');
  const serialize = JSON.stringify(DIALOGUES[PAGE]);
  assert.equal(serialize.includes('1wx5TB'), true, 'the canonical hand-over remains in the export');
  assert.equal(serialize.includes('1yeeSP'), true);
  assert.equal(serialize.includes('bnZg2R'), true);
  assert.equal(serialize.includes('"Sure. What do you need?"'), true);

  // Capacity retry: full bag sets pending, no item and no stage; space then hands over once.
  h.setFull(true);
  assert.equal(h.answer('1yeeSP', 9312), true);
  h.chosen('1yeeSP', 9312);
  assert.equal(h.attrs.get('quest.ethically_acquired_antiquities.pending-sails'), true);
  assert.equal(h.inventory.get(ids.TATTERED_SAILS) ?? 0, 0);
  assert.equal(h.quest.getStage(p), STAGE.crew);
  h.setFull(false);
  assert.equal(h.answer('bnZg2R', 9312), true);
  h.chosen('bnZg2R', 9312);
  h.action('1wx5TB', 9312);
  assert.equal(h.inventory.get(ids.TATTERED_SAILS), 1);
  assert.equal(h.quest.getStage(p), STAGE.repair);
  assert.equal(h.attrs.get('quest.ethically_acquired_antiquities.pending-sails'), false);
});

test('real transcript runner retries the declined favour and executes its canonical hand-over', () => {
  const h = withPrerequisites(setup());
  const npcId = 9312;
  const oldConditionHooks = [...PluginManager.npcDialogueConditionHooks];
  h.player.getDialogueManager = () => h.player.dialogueManager;
  h.player.dialogueManager = new DialogueManager(h.player);
  for (const handler of h.hooks.conditions) {
    PluginManager.npcDialogueConditionHooks.push({ pluginName: 'qh728-q034-real-runner', handler });
  }
  try {
    h.setLocation(1742, 3135);
    h.quest.setStage(h.player, STAGE.crew);

    assert.equal(h.crewTalk(npcId), true);
    beginRealCrewDialogue(h);
    advanceDialogueToOption(h.player, 'Have you seen a man with a case?');
    chooseDialogueOption(h.player, 'Have you seen a man with a case?');
    advanceDialogueToOption(h.player, 'Not right now.');
    chooseDialogueOption(h.player, 'Not right now.');
    finishDialogue(h.player);
    assert.equal(h.attrs.get('quest.ethically_acquired_antiquities.declined-favour'), true);
    assert.equal(h.inventory.get(I().TATTERED_SAILS) ?? 0, 0);
    assert.equal(h.quest.getStage(h.player), STAGE.crew);

    assert.equal(h.crewTalk(npcId), true);
    assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember-after-declining-doing-the-favour');
    beginRealCrewDialogue(h);
    advanceDialogueToOption(h.player, 'Have you seen a man with a case?');
    chooseDialogueOption(h.player, 'Have you seen a man with a case?');
    advanceDialogueToOption(h.player, 'Sure. What do you need?');
    chooseDialogueOption(h.player, 'Sure. What do you need?');
    finishDialogue(h.player);

    assert.equal(h.inventory.get(I().TATTERED_SAILS), 1);
    assert.equal(h.quest.getStage(h.player), STAGE.repair);
    assert.notEqual(h.attrs.get('quest.ethically_acquired_antiquities.pending-sails'), true);
  } finally {
    PluginManager.npcDialogueConditionHooks.length = 0;
    PluginManager.npcDialogueConditionHooks.push(...oldConditionHooks);
  }
});

test('shared NPC selectors claim only their EAA dialogue windows', () => {
  const h = withPrerequisites(setup());
  const npcs = N();
  const p = h.player;

  // Regulus 8-9 only.
  h.quest.setStage(p, STAGE.regulus);
  assert.equal(h.variant(npcs.REGULUS_CENTO_3), 'clues-in-civitas-illa-fortis-talking-to-regulus-cento');
  h.quest.setStage(p, 9);
  assert.equal(h.variant(npcs.REGULUS_CENTO_3), 'clues-in-civitas-illa-fortis-talking-to-regulus-cento-again');
  h.quest.setStage(p, STAGE.crew);
  assert.equal(h.variant(npcs.REGULUS_CENTO_3), null);

  // Cothon crew 10-15 only.
  h.setLocation(1742, 3135);
  h.quest.setStage(p, STAGE.crew);
  assert.equal(h.crewTalk(9312), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember');
  h.quest.setStage(p, 15);
  assert.equal(h.crewTalk(9312), true);
  h.quest.setStage(p, STAGE.portSarim);
  assert.equal(h.crewTalk(9312), false, 'stage 16 Cothon crew fall through');

  // Artima 12-13 only.
  h.inventory.set(I().TATTERED_SAILS, 1);
  h.quest.setStage(p, STAGE.repair);
  assert.equal(h.variant(npcs.ARTIMA), 'clues-in-civitas-illa-fortis-talking-to-artima');
  h.quest.setStage(p, 14);
  assert.equal(h.variant(npcs.ARTIMA), null);

  // Port Sarim crew 16-17 only.
  h.setLocation(3036, 3194);
  h.quest.setStage(p, STAGE.portSarim);
  assert.equal(h.crewTalk(9312), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-port-sarim-talking-to-a-trader-crewmember-in-port-sarim');
  h.quest.setStage(p, 17);
  assert.equal(h.crewTalk(9312), true);
  assert.equal(h.lastTranscript().variant, 'clues-in-port-sarim-talking-to-a-trader-crewmember-in-port-sarim-again');
  h.quest.setStage(p, STAGE.betty);
  assert.equal(h.crewTalk(9312), false, 'stage 18 Port Sarim crew fall through');

  // Betty 18-21 only.
  h.quest.setStage(p, STAGE.betty);
  assert.equal(h.variant(npcs.BETTY), 'clues-in-port-sarim-talking-to-betty');
  h.quest.setStage(p, STAGE.readNotes);
  assert.equal(h.variant(npcs.BETTY), 'clues-in-port-sarim-talking-to-betty-again');
  h.quest.setStage(p, STAGE.haig);
  assert.equal(h.variant(npcs.BETTY), null);

  // Haig 22-35 only.
  h.quest.setStage(p, STAGE.haig);
  assert.equal(h.variant(npcs.CURATOR_HAIG_HALEN), 'in-varrock-museum-talking-to-curtor-haig-halen');
  h.quest.setStage(p, STAGE.storeroom);
  assert.equal(h.variant(npcs.CURATOR_HAIG_HALEN), 'in-varrock-museum-talking-to-curtor-haig-halen-talking-to-haig-again');
  h.quest.setStage(p, 35);
  assert.equal(h.variant(npcs.CURATOR_HAIG_HALEN), 'in-varrock-museum-talking-to-curator-haig-halen-after-finding-the-diadem');
  h.quest.setStage(p, STAGE.return_);
  assert.equal(h.variant(npcs.CURATOR_HAIG_HALEN), null);
});

test('registered order releases Haig to the real Bone Voyage hook after stage 35', () => {
  const h = withPrerequisites(setup({ boneVoyage: true }));
  const npcs = N();
  const p = h.player;
  h.completed.add('the_dig_site');
  const boneVoyage = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'bone_voyage');
  assert.ok(boneVoyage, 'real Bone Voyage plugin registered after EAA');
  assert.equal(boneVoyage.getStage(p), 0);

  // In-window: EAA's hook is first and still owns Haig.
  h.quest.setStage(p, STAGE.haig);
  assert.equal(h.variant(npcs.CURATOR_HAIG_HALEN), 'in-varrock-museum-talking-to-curtor-haig-halen');
  h.quest.setStage(p, STAGE.storeroom);
  assert.equal(h.variant(npcs.CURATOR_HAIG_HALEN), 'in-varrock-museum-talking-to-curtor-haig-halen-talking-to-haig-again');

  // Stage 36 is outside EAA's window: EAA yields and Bone Voyage's variant wins.
  h.quest.setStage(p, STAGE.return_);
  assert.equal(h.variant(npcs.CURATOR_HAIG_HALEN), 'starting-out-talking-to-curator-haig-halen');
  h.quest.setStage(p, STAGE.complete);
  assert.equal(h.variant(npcs.CURATOR_HAIG_HALEN), 'starting-out-talking-to-curator-haig-halen');
});
