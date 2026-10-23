// From server/: node --test tests/qh728-q111.test.cjs (dist/ exists from the baseline build).
// Focused source contracts for Tale of the Righteous (q111): Quest Helper setup and
// stage graph, the canonical varbit mapping at each handler edge, the complete
// registered mandatory route, the Archeio Teleport menu slot, the rope recovery
// guard, full-bag completion and reward-varbit replay.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

const PAGE = 'Tale of the Righteous';
const STAGE_ATTR = 'quest.tale_of_the_righteous.stage';
const VARBIT = 6358;
const REWARD_VARBIT = 6359;
const NPC = {
  PHILEAS: 7999,
  PAGIDA: 7608,
  ARCHEIO: 7614,
  ISTORIA: 11112,
  DUFFY_CAVE: 8007,
  DUFFY_SURFACE: 8163,
  GNOSI: 8006,
  LORD: 11038,
  LIZARD: 8000,
  VOICE: 8022,
};
const OBJ = {
  CAVE_MOUTH: 32502,
  CREVICE_NOROPE: 31965,
  CREVICE_ROPED: 31966,
  CAVE_ROPE: 31967,
  SKELETON_CELL: 31962,
  SKELETON_SEARCH: 41422,
  MAGIC_GATE: 32507,
  ALTAR: 32508,
};
const ITEM = {
  ROPE: core.ItemIdentifiers.ROPE,
  DUSTY_NOTE: core.ItemIdentifiers.DUSTY_NOTE,
  HISTORY_AND_HEARSAY: core.ItemIdentifiers.HISTORY_AND_HEARSAY,
  COINS: core.ItemIdentifiers.COINS,
};
const START_HOOK = 'quest:tale-of-the-righteous:start';
const ACTION = {
  SKELETON: 'oYSkWr',
  ALTAR: '7bxu8Q',
  COMPLETE: 'Iz9UXn',
  ARCHEIO_TELEPORT: 'CggcE8',
};
const HOUSE_ZONE = { minX: 1538, maxX: 1547, minY: 3567, maxY: 3574, levels: [0] };

let transcriptCalls = [];
const originalStartTranscript = runtime.startTranscript;
let harnesses = 0;
let kourendComplete = false;

before(() => {
  runtime.startTranscript = (_api, _player, npcId, page, variant) => {
    transcriptCalls.push({ npcId, page, variant });
    return true;
  };
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const calls = [];
  const moves = [];
  const dropped = [];
  const messages = [];
  const skillManager = {
    getMaxLevel: (skill) => ({ STRENGTH: 16, MINING: 10 })[String(skill?.getName?.() ?? skill?.name ?? skill).toUpperCase()] ?? 99,
    getCurrentLevel: (skill) => ({ STRENGTH: 16, MINING: 10 })[String(skill?.getName?.() ?? skill?.name ?? skill).toUpperCase()] ?? 99,
    setCurrentLevel: noop,
    getExperience: () => 0,
    addExperience: noop,
  };
  let full = false;
  let location = new core.Location(1542, 3560, 0);
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd: (_player, item) => {
      dropped.push(item.id);
      items.set(item.id, (items.get(item.id) ?? 0) + item.amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter((amount) => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    full: () => messages.push("You don't have enough inventory space."),
    get: () => null,
    getItems: () => [],
    capacity: () => 28,
  };
  const sender = {
    sendVarbit: (id, value) => {
      calls.push({ kind: 'varbit', id, value });
      return sender;
    },
    sendConfig: (id, value) => {
      calls.push({ kind: 'config', id, value });
      return sender;
    },
  };
  const proxy = new Proxy(sender, { get: (target, key) => (key in target ? target[key] : () => proxy) });
  const player = {
    attrs, items, calls, moves, dropped, messages,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => skillManager,
    getUsername: () => `q111-test-${harnesses}`,
    getPrivateArea: () => null,
    getPacketSender: () => proxy,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    setRunEnergy: noop,
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
    isPlayer: () => true,
    isPlayerBot: () => false,
  };
  return player;
}

function harness() {
  const events = new Map();
  const variants = [];
  const conditions = [];
  const objects = [];
  const itemOnObject = [];
  const deaths = [];
  const zoneEnters = [];
  const zoneExits = [];
  const logins = [];
  const logouts = [];
  const npcClicks = [];
  const spawns = [];
  const removed = [];
  const addEvent = (key, handler) => {
    if (!events.has(key)) events.set(key, []);
    events.get(key).push(handler);
  };
  addEvent('quest:is-complete', (request) => {
    if (request?.key === 'client_of_kourend') request.complete = kourendComplete;
  });
  const spawn = (definition) => {
    const npc = {
      id: definition.id,
      removed: false,
      owner: definition.owner,
      getLocation: () => new core.Location(definition.x, definition.y, definition.z),
      getId: () => definition.id,
      isRegistered() { return !npc.removed; },
    };
    spawns.push(npc);
    return npc;
  };
  const api = new Proxy({
    core: { ...core, CountdownTask: undefined, TaskManager: undefined },
    persistAttribute: noop,
    registerArea: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onObjectInteraction: (handler) => objects.push(handler),
    onItemOnObject: (handler) => itemOnObject.push(handler),
    onNpcClick: (ids, clickType, handler) => npcClicks.push({ ids, clickType, handler }),
    onNpcDeath: (handler) => deaths.push(handler),
    onZoneEnter: (zone, handler) => zoneEnters.push({ zone, handler }),
    onZoneExit: (zone, handler) => zoneExits.push({ zone, handler }),
    onPlayerLogin: (handler) => logins.push(handler),
    onPlayerLogout: (handler) => logouts.push(handler),
    onCustomEvent: addEvent,
    emitCustomEvent: (key, event) => (events.get(key) ?? []).forEach((handler) => handler(event)),
    spawnNpc: spawn,
    removeNpc: (npc) => { if (npc) { npc.removed = true; removed.push(npc); } },
  }, { get: (target, key) => target[key] ?? noop });
  harnesses += 1;
  require('../plugins/quests/quests/TaleOfTheRighteous.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);
  const player = makePlayer();
  const h = {
    api, player, quest, events, variants, conditions, objects, itemOnObject, deaths,
    zoneEnters, zoneExits, logins, logouts, npcClicks, spawns, removed,
    emit(key, event) { (events.get(key) ?? []).forEach((handler) => handler(event)); },
    stage() { return quest.getStage(player); },
    setStage(value) { player.attrs.set(STAGE_ATTR, value); },
    setKourend(value) { kourendComplete = value; },
    variant(npcId) {
      for (const handler of variants) {
        const result = handler({ player, npcId });
        if (result) return result;
      }
      return null;
    },
    action(stepId) {
      const event = { player, stepId, handled: false };
      h.emit('npc-dialogue:action', event);
      return event;
    },
    line(npcId, text) { h.emit('npc-dialogue:line', { player, npcId, text }); },
    hook(npcId, hook = START_HOOK) { h.emit('npc-dialogue:hook', { player, npcId, hook }); },
    choice(npcId, option) { h.emit('npc-dialogue:choice', { player, npcId, option }); },
    object(objectId) {
      const event = { player, objectId, definition: { id: objectId }, handled: false };
      for (const handler of objects) handler(event);
      return event;
    },
    itemOnObjectId(itemId, objectId) {
      const event = { player, itemId, objectId, handled: false };
      for (const handler of itemOnObject) handler(event);
      return event;
    },
    death(npc) {
      for (const handler of deaths) handler({ player, killer: player, npcId: npc.id, npc });
    },
    enterZone() { for (const { handler } of zoneEnters) handler({ player }); },
    exitZone() { for (const { handler } of zoneExits) handler({ player }); },
    login() { for (const handler of logins) handler({ player }); },
    logout() { for (const handler of logouts) handler({ player }); },
    bootstrap() { h.emit('player:bootstrap-complete', { player }); },
    click(npcId, clickType) {
      const entry = npcClicks.find((click) => click.clickType === clickType && click.ids.includes(npcId));
      if (!entry) return null;
      const event = { player, npcId, clickType, handled: false, definition: { id: npcId } };
      entry.handler(event);
      return event;
    },
  };
  return h;
}

function lastVarbit(player, id) {
  return [...player.calls].reverse().find((call) => call.kind === 'varbit' && call.id === id);
}

function varbits(player, id) {
  return player.calls.filter((call) => call.kind === 'varbit' && call.id === id);
}

test('Quest Helper setup requirements gate the Phileas start hook', () => {
  const h = harness();
  h.setStage(0);
  h.player.getSkillManager().getMaxLevel = (skill) =>
    String(skill?.getName?.() ?? skill?.name ?? skill).toUpperCase() === 'STRENGTH' ? 15 : 99;
  h.setKourend(true);
  h.hook(NPC.PHILEAS);
  assert.equal(h.stage(), 0, '15 Strength must not start the quest');

  h.player.getSkillManager().getMaxLevel = (skill) =>
    String(skill?.getName?.() ?? skill?.name ?? skill).toUpperCase() === 'MINING' ? 9 : 99;
  h.hook(NPC.PHILEAS);
  assert.equal(h.stage(), 0, '9 Mining must not start the quest');

  h.player.getSkillManager().getMaxLevel = (skill) => (String(skill?.name ?? skill).toUpperCase() === 'MINING' ? 10 : 99);
  h.setKourend(false);
  h.hook(NPC.PHILEAS);
  assert.equal(h.stage(), 0, 'Client of Kourend must be complete');

  h.setKourend(true);
  h.hook(NPC.PHILEAS);
  assert.equal(h.stage(), 1, 'requirements answered -> started');
});

test('durable stages 3-7 transmit the canonical varbit values at their handler edges', () => {
  const h = harness();
  h.player.getSkillManager().getMaxLevel = () => 99;
  h.setKourend(true);

  h.setStage(2);
  h.action(ACTION.SKELETON);
  assert.equal(h.stage(), 3);
  assert.equal(lastVarbit(h.player, VARBIT).value, 5, 'skeleton found is varbit 5');

  h.setStage(3);
  h.line(NPC.PHILEAS, "I guess I'll be on my way then.");
  assert.equal(h.stage(), 4);
  assert.equal(lastVarbit(h.player, VARBIT).value, 6, 'reported to Phileas is varbit 6');

  h.setStage(4);
  h.line(NPC.LORD, 'Good luck citizen.');
  assert.equal(h.stage(), 5);
  assert.equal(lastVarbit(h.player, VARBIT).value, 7, 'Lord permission is varbit 7');

  h.setStage(5);
  h.line(NPC.DUFFY_SURFACE, "Alright, I'll start there.");
  assert.equal(h.stage(), 6);
  assert.equal(lastVarbit(h.player, VARBIT).value, 8, 'Duffy told is varbit 8');

  h.setStage(6);
  h.object(OBJ.CREVICE_NOROPE);
  assert.equal(h.stage(), 7);
  assert.equal(lastVarbit(h.player, VARBIT).value, 8, 'crevice found stays at varbit 8 until the rope');

  h.setStage(7);
  const before = h.player.calls.length;
  runtime.sendQuestVarps({ player: h.player });
  const resent = h.player.calls.slice(before).filter((call) => call.kind === 'varbit' && call.id === VARBIT);
  assert.ok(resent.length > 0, 'login/resend sends the quest varbit');
  assert.ok(resent.every((call) => call.value === 8), 'login/resend maps durable 7 to wire 8');

  h.setStage(9);
  h.object(OBJ.CREVICE_NOROPE);
  assert.equal(h.stage(), 9);
});

test('the complete registered mandatory route reaches stage 17 and completion wire 17', () => {
  const h = harness();
  h.player.getSkillManager().getMaxLevel = () => 99;
  h.setKourend(true);
  h.player.getInventory().adds(ITEM.ROPE, 1);
  h.setStage(0);
  h.player.setLocation(1542, 3571, 0);

  h.hook(NPC.PHILEAS);
  assert.equal(h.stage(), 1);
  assert.equal(h.variant(NPC.PHILEAS), 'getting-started-talking-to-phileas-talking-to-phileas-again');

  h.choice(NPC.PAGIDA, 'Yes please.');
  assert.equal(h.stage(), 2);
  assert.deepEqual(h.player.moves.at(-1), [1577, 10199, 0]);

  h.action(ACTION.SKELETON);
  assert.equal(h.stage(), 3);
  h.line(NPC.PHILEAS, "I guess I'll be on my way then.");
  assert.equal(h.stage(), 4);
  h.line(NPC.LORD, 'Good luck citizen.');
  assert.equal(h.stage(), 5);
  assert.equal(h.variant(NPC.DUFFY_SURFACE), 'another-expedition-talking-to-historian-duffy');
  h.line(NPC.DUFFY_SURFACE, "Alright, I'll start there.");
  assert.equal(h.stage(), 6);
  assert.equal(h.variant(NPC.DUFFY_SURFACE), 'another-expedition-returning-to-duffy');

  h.object(OBJ.CREVICE_NOROPE);
  assert.equal(h.stage(), 7);
  assert.equal(h.variant(NPC.DUFFY_SURFACE), 'another-expedition-returning-to-duffy');
  h.itemOnObjectId(ITEM.ROPE, OBJ.CAVE_MOUTH);
  assert.equal(h.stage(), 9);
  assert.equal(h.player.getInventory().getAmount(ITEM.ROPE), 0, 'rope is consumed when attached');
  assert.equal(transcriptCalls.at(-1).variant, 'another-expedition-using-a-rope-on-the-crevice');

  h.choice(NPC.VOICE, 'Yes.');
  assert.deepEqual(h.player.moves.at(-1), [1168, 9972, 0]);
  const lizard = h.spawns.find((npc) => npc.id === NPC.LIZARD);
  assert.ok(lizard, 'entering at stage 9 spawns the Corrupt Lizardman');

  h.death(lizard);
  assert.equal(h.stage(), 10);
  h.object(OBJ.MAGIC_GATE);
  assert.deepEqual(h.player.moves.at(-1), [1171, 9945, 0]);
  h.object(OBJ.ALTAR);
  assert.equal(transcriptCalls.at(-1).variant, 'another-expedition-inspecting-the-unstable-altar');
  h.action(ACTION.ALTAR);
  assert.equal(h.stage(), 11);

  h.object(OBJ.CAVE_ROPE);
  assert.deepEqual(h.player.moves.at(-1), [1213, 3560, 0]);
  h.line(NPC.DUFFY_SURFACE, "Well in that case, we'll go take a look.");
  assert.equal(h.stage(), 12);
  assert.equal(h.variant(NPC.DUFFY_SURFACE), 'another-expedition-talking-to-duffy-in-the-cave');

  h.object(OBJ.CREVICE_ROPED);
  assert.deepEqual(h.player.moves.at(-1), [1168, 9972, 0]);
  h.line(NPC.DUFFY_CAVE, "Anyway, I'm going to carry on with my research. I'd recommend you talk to Gnosi.");
  assert.equal(h.stage(), 13);
  h.line(NPC.GNOSI, 'Will do, see you later.');
  assert.equal(h.stage(), 14);
  assert.equal(h.variant(NPC.LORD), 'finishing-up-reporting-to-lord-shayzien');

  h.line(NPC.LORD, "Eugh, so much walking. Fine, I'll go see Phileas.");
  assert.equal(h.stage(), 15);
  assert.equal(h.variant(NPC.LORD), 'finishing-up-reporting-to-lord-shayzien-talking-to-lord-shayzien-again');

  h.player.setLocation(1542, 3571, 0);
  h.enterZone();
  assert.equal(h.stage(), 16);
  assert.equal(transcriptCalls.at(-1).variant, 'finishing-up-entering-phileas-home');
  assert.equal(h.variant(NPC.LORD), 'finishing-up-returning-to-lord-shayzien');

  const event = h.action(ACTION.COMPLETE);
  assert.equal(event.handled, true);
  assert.equal(h.stage(), 17);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(lastVarbit(h.player, VARBIT).value, 17, 'completion sends the cache threshold 17');
  assert.equal(h.player.getInventory().getAmount(ITEM.COINS), 8000);
  assert.equal(h.player.getInventory().getAmount(ITEM.HISTORY_AND_HEARSAY), 1);
  assert.equal(lastVarbit(h.player, REWARD_VARBIT).value, 1);
});

test('completion from a full bag force-drops the coins and memoir page', () => {
  const h = harness();
  h.setStage(16);
  h.player.setFull(true);
  const event = h.action(ACTION.COMPLETE);
  assert.equal(event.handled, true);
  assert.equal(h.stage(), 17);
  assert.deepEqual(h.player.dropped.sort((a, b) => a - b), [ITEM.COINS, ITEM.HISTORY_AND_HEARSAY].sort((a, b) => a - b));
});

test('reward varbit 6359 is re-sent after login and bootstrap clobber', () => {
  const h = harness();
  h.setStage(17);
  h.login();
  assert.equal(varbits(h.player, REWARD_VARBIT).at(-1).value, 1);
  const before = h.player.calls.length;
  h.bootstrap();
  const replay = h.player.calls.slice(before).filter((call) => call.kind === 'varbit' && call.id === REWARD_VARBIT);
  assert.deepEqual(replay.map((call) => call.value), [1]);

  const fresh = harness();
  fresh.setStage(9);
  fresh.login();
  assert.equal(varbits(fresh.player, REWARD_VARBIT).length, 0, 'incomplete saves do not fabricate the reward bit');
});

test('Archeio Teleport is registered on the cache action slot 3 and enters the archive', () => {
  const h = harness();
  const entry = h.npcClicks.find((click) => click.ids.includes(NPC.ARCHEIO));
  assert.ok(entry);
  assert.equal(entry.clickType, 3);
  assert.equal(h.click(NPC.ARCHEIO, 2), null, 'the second action slot is empty');
  h.click(NPC.ARCHEIO, 3);
  assert.deepEqual(h.player.moves.at(-1), [1552, 10221, 0]);
});

test('the rope-entry prompt ignores unrelated yes choices and is cleared on logout', () => {
  const h = harness();
  h.setStage(6);
  h.player.getInventory().adds(ITEM.ROPE, 1);
  h.itemOnObjectId(ITEM.ROPE, OBJ.CAVE_MOUTH);
  assert.equal(h.stage(), 9);
  const moves = h.player.moves.length;

  h.choice(NPC.ISTORIA, 'Yes.');
  assert.equal(h.player.moves.length, moves, 'an unrelated Yes must not enter the cave');

  h.choice(NPC.VOICE, 'No.');
  assert.equal(h.player.moves.length, moves, 'No closes the prompt without entering');
  h.choice(NPC.VOICE, 'Yes.');
  assert.equal(h.player.moves.length, moves, 'the prompt is consumed once');

  h.setStage(6);
  h.player.getInventory().adds(ITEM.ROPE, 1);
  h.itemOnObjectId(ITEM.ROPE, OBJ.CAVE_MOUTH);
  h.logout();
  h.choice(NPC.VOICE, 'Yes.');
  assert.equal(h.player.moves.length, moves, 'logout clears a pending rope prompt');
});

test('skeleton search grants the dusty note only when a slot is free', () => {
  const h = harness();
  h.setStage(1);
  h.player.setFull(true);
  h.object(OBJ.SKELETON_SEARCH);
  assert.equal(h.player.getInventory().getAmount(ITEM.DUSTY_NOTE), 0);
  assert.equal(h.player.messages.at(-1), "You don't have enough inventory space.");
  h.player.setFull(false);
  h.object(OBJ.SKELETON_SEARCH);
  assert.equal(h.player.getInventory().getAmount(ITEM.DUSTY_NOTE), 1);
  h.object(OBJ.SKELETON_SEARCH);
  assert.equal(h.player.getInventory().getAmount(ITEM.DUSTY_NOTE), 1, 'the note is not duplicated');
});

test('post-quest Duffy and Gnosi use their canonical after-completion pages', () => {
  const h = harness();
  h.setStage(17);
  assert.equal(h.variant(NPC.DUFFY_SURFACE), 'after-completion-of-tale-of-the-righteous');
  assert.equal(h.variant(NPC.GNOSI), 'after-completion-of-tale-of-the-righteous');
  assert.equal(h.variant(NPC.PHILEAS), 'another-expedition-talking-to-phileas-talking-to-phileas-again');
});

after(() => {
  runtime.startTranscript = originalStartTranscript;
});
