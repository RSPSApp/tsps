// From server/: node --test tests/qh728-q083.test.cjs (after yarn build).
// Focused A Night at the Theatre contracts: the canonical completion wire,
// helper-leg stage edges, the two dialogue-line gates, registered item/object
// handlers, lamp rewards/reclaim, and login replay. Fixture stages and supplies
// are labelled; no natural playthrough is claimed.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const dialogues = require('../data/definitions/npc-dialogues.json');
const noop = () => {};
/** The quest the harness registered last, so the emitted lines can be read against its stage. */
let questRef = null;

const PAGE = 'A Night at the Theatre';
const WIRE = 12276;
const VARP = 3055;
const STRANGER = core.NpcIdentifiers.MYSTERIOUS_STRANGER;
const DAER = core.NpcIdentifiers.DAER_KRAND;
const NATURE = core.NpcIdentifiers.NATURE_SPIRIT;
const I = core.ItemIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const bank = new Map();
  const equipment = [];
  const messages = [];
  const moves = [];
  const log = [];
  const xp = new Map();
  let full = false;
  let location = new core.Location(0, 0, 0);
  let area = null;
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        messages.push('Not enough space in your inventory.');
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      const left = (items.get(id) ?? 0) - amount;
      if (left <= 0) items.delete(id); else items.set(id, left);
      return true;
    },
    getFreeSlots: () => (full ? 0 : Math.max(0, 28 - [...items.values()].filter(amount => amount > 0).length)),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    getItems: () => [...items].map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  const sender = new Proxy({}, { get: (_target, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  const player = {
    attrs, items, bank, equipment, messages, moves, log, xp,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getBank: () => ({ getAmount: id => bank.get(id) ?? 0 }),
    getEquipment: () => ({ getItems: () => equipment, contains: id => equipment.some(item => item.getId() === id) }),
    getSkillManager: () => ({
      getExperience: skill => xp.get(skill) ?? 0,
      addExperience: (skill, amount) => { xp.set(skill, (xp.get(skill) ?? 0) + amount); return amount; },
    }),
    getUsername: () => 'q083-test',
    getPrivateArea: () => area,
    getArea: () => area,
    setArea: next => { area = next; },
    getIndex: () => 1,
    isPlayer: () => true,
    getAsPlayer: () => player,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
  };
  return player;
}

function harness(options = {}) {
  const events = {}, conditions = [], itemActions = [], npcDeaths = [];
  const objectInteractions = [], npcInteractions = [], itemOnObject = [];
  const state = { tasteOfHope: options.tasteOfHope ?? true, axe: options.axe ?? true, raidComplete: options.raidComplete ?? false, challenge: null, xpReward: null, spoken: [], emitted: [], prompts: [], tasks: [], shops: [] };
  const testCore = { ...core,
    ObjectManager: { register: noop },
    // The quest opens the Stranger's crystal shop a tick after the chatbox closes.
    TaskManager: { submit: task => state.tasks.push(task) },
    CountdownTask: class { constructor(player, delay, callback) { this.player = player; this.delay = delay; this.callback = callback; } },
    ShopManager: { open: (player, shopId) => { state.shops.push(shopId); return true; } } };
  const emit = (key, event) => {
    const handlers = events[key] ?? [];
    if (key === 'quest:is-complete' && event?.key === 'taste_of_hope') event.complete = state.tasteOfHope;
    // The quest's raid query: a real provider (the Theatre of Blood plugin) answers it
    // when one is registered; the fake stand-in only fills in when there is none.
    if (key === 'tob:has-completion' && handlers.length === 0) event.complete = state.raidComplete;
    if (key === 'woodcutting:axe' && state.axe && !event.axe) event.axe = { id: 1 };
    if (key === 'hespori:quest-challenge') state.challenge = event;
    if (key === 'xpreward:open') state.xpReward = event;
    if (key === 'npc-dialogue:line') state.spoken.push({ text: event.text, stage: questRef ? questRef.getStage(event.player) : 0 });
    state.emitted.push(key);
    handlers.forEach(handler => handler(event));
  };
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    // The transcript runner asks for a menu: the test takes the first option.
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      const labels = pairs.filter((_, index) => index % 2 === 0);
      state.prompts.push({ player, title, labels });
      const wanted = labels.findIndex(label => state.menuChoice && state.menuChoice.test(label));
      const choice = wanted < 0 ? 0 : wanted;
      pairs[choice * 2 + 1]?.(player);
      return true;
    },
    onNpcInteraction: (name, handlers) => Object.entries(handlers).forEach(([option, handler]) => npcInteractions.push({ name, option, handler })),
    onObjectInteraction: (name, handlers) => {
      // A plugin may register a raw handler instead of a named object.
      if (typeof name === 'function') { objectInteractions.push({ name: 'handler', option: null, handler: name }); return; }
      Object.entries(handlers ?? {}).forEach(([option, handler]) => objectInteractions.push({ name, option, handler }));
    },
    onObjectRoute: handler => { state.route = handler; },
    onItemOnObject: (itemName, objectName, handler) => itemOnObject.push({ itemName, objectName, handler }),
    onItemAction: handler => itemActions.push(handler),
    onNpcDeath: handler => npcDeaths.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onPlayerLogin: noop,
    onInterfaceActionButton: noop,
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: emit,
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/ANightAtTheTheatre.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);
  questRef = quest;
  // The normal-mode Theatre of Blood plugin, when asked for, brings its own
  // completion count and its own answer to the quest's raid query.
  if (options.rewards) require('../plugins/minigames/tob/Rewards.TheatreOfBlood')(api);
  const npc = (npcId, x = 3673, y = 3223) => ({ getId: () => npcId, getLocation: () => new core.Location(x, y, 0) });
  const fireObject = (objectId, option, player, extra = {}) => {
    const event = { player, objectId, option, location: player.getLocation(), handled: false, ...extra };
    objectInteractions.filter(entry => !option || entry.option === option).forEach(entry => {
      if (entry.handler(event) === true) event.handled = true;
    });
    return event;
  };
  const fireNpc = (name, option, player, extra = {}) => {
    const event = { player, npcId: extra.npcId ?? STRANGER, npc: extra.npc, option, handled: false, ...extra };
    npcInteractions.filter(entry => entry.name === name && entry.option === option).forEach(entry => {
      if (entry.handler(event) === true) event.handled = true;
    });
    return event;
  };
  const fireAction = event => (events['npc-dialogue:action'] ?? []).forEach(handler => handler(event));
  const fireLine = event => {
    (events['npc-dialogue:line'] ?? []).forEach(handler => handler(event));
    if (typeof event.after === 'function') event.after();
  };
  const wire = (player, id = WIRE) => player.log.filter(row => row[0] === 'sendVarbit' && row[1] === id).at(-1)?.[2];
  return { quest, events, conditions, itemActions, npcDeaths, objectInteractions, npcInteractions, itemOnObject, state,
    emit, npc, fireObject, fireNpc, fireAction, fireLine, wire };
}

test('completion uses the cache threshold on varbit 12276 and keeps stage-80 saves complete', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(h.quest.varbitId, WIRE);
  assert.equal(h.quest.varpId, VARP);

  h.quest.setStage(p, 0);
  assert.equal(h.wire(p), 0);
  // The client stores this quest's progress on the native even grid; the durable
  // mid-conversation stages 31, 33, 35 and 41 are values OSRS never sends.
  const NATIVE = { 10: 10, 14: 14, 20: 20, 22: 22, 30: 30, 31: 32, 32: 32, 33: 34, 35: 36,
    40: 40, 41: 42, 44: 44, 48: 48, 50: 50, 52: 52, 56: 56, 78: 78 };
  for (const [durable, native] of Object.entries(NATIVE)) {
    h.quest.setStage(p, Number(durable));
    assert.equal(h.wire(p), native, `durable stage ${durable} is sent as native ${native}`);
    assert.equal(h.wire(p) % 2, 0, `durable stage ${durable} stays on the native even grid`);
    assert.ok(h.wire(p) >= 0 && h.wire(p) <= 86, `durable stage ${durable} stays inside the native range`);
  }

  h.quest.setStage(p, 80);
  assert.equal(h.wire(p), 86, 'durable completion stage 80 is sent at the cache threshold');
  assert.equal(h.quest.isComplete(p), true);

  h.quest.setStage(p, 84);
  assert.equal(h.wire(p), 86, 'later helper finish keys also clamp to the completion threshold');

  // A save written by the old plugin (stage 80) must replay complete after relog.
  h.quest.setStage(p, 80);
  p.log.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.equal(h.wire(p), 86, 'login replay maps a stage-80 save to native 86');
  assert.equal(h.quest.isComplete(p), true);
});

test('the two helper dialogue-line gates match real transcript lines and advance the durable stage', () => {
  const h = harness();
  const p = makePlayer();
  const page = dialogues[PAGE];
  const barkVariant = page.variants['talking-to-the-mysterious-stranger-after-killing-the-hespori'];
  assert.ok(JSON.stringify(page).includes('My associates would prefer I remain here.'));
  assert.ok(JSON.stringify(barkVariant).includes('You can still take other people in as well of course. Just use the notice board to set up a party and find suitable allies. Once you\'re ready, I will join you in the Theatre.'));
  // The line the old gate listened for belongs to the stage-56+ variant, so a
  // stage-52 player never hears it.
  assert.ok(!JSON.stringify(barkVariant).includes("Don't forget you can use the notice board"));

  h.quest.setStage(p, 20);
  // The line is shared by the head hand-in and the "So about that memory..."
  // conversation; only the latter opens the nest leg.
  h.fireLine({ player: p, npcId: STRANGER, text: 'My associates would prefer I remain here.',
    pages: [{ page: PAGE, variants: ['talking-to-the-mysterious-stranger-after-getting-ranis-head'] }] });
  assert.equal(h.quest.getStage(p), 20, 'the hand-in conversation does not open the nest leg');
  h.fireLine({ player: p, npcId: STRANGER, text: 'My associates would prefer I remain here.',
    pages: [{ page: PAGE, variants: ['talking-to-the-mysterious-stranger-after-getting-ranis-head-after-finishing-the-first-memory-cutscene'] }] });
  assert.equal(h.quest.getStage(p), 22, 'the stage-20 conversation reaches the nest leg');

  h.quest.setStage(p, 52);
  h.fireLine({ player: p, npcId: STRANGER, text: "You can still take other people in as well of course. Just use the notice board to set up a party and find suitable allies. Once you're ready, I will join you in the Theatre." });
  assert.equal(h.quest.getStage(p), 56, 'fifth-memory conversation reaches the Theatre leg');
});

test('fresh stage 0 is gated by A Taste of Hope, and early object interactions are refused', () => {
  const h = harness({ tasteOfHope: false });
  const p = makePlayer();
  const start = { player: p, npcId: STRANGER, hook: 'quest:a-night-at-the-theatre:start', handled: false };
  h.events['npc-dialogue:hook'].forEach(handler => handler(start));
  assert.equal(h.quest.getStage(p), 0, 'start option does not start without A Taste of Hope');

  h.state.tasteOfHope = true;
  h.events['npc-dialogue:hook'].forEach(handler => handler(start));
  assert.equal(h.quest.getStage(p), 10, 'the canonical start option opens the quest');

  const early = makePlayer();
  const crypt = h.fireObject(42523, 'Climb-down', early);
  assert.equal(crypt.handled, true);
  assert.ok(early.messages.includes('The crypt is closed to you.'));
  assert.deepEqual(early.moves, [], 'fresh stage 0 cannot enter the crypt');

  h.quest.setStage(early, 10);
  const gate = h.fireObject(42529, 'Open', early);
  assert.equal(gate.handled, true);
  assert.ok(early.messages.includes('The gate is locked.'));
  assert.deepEqual(early.moves, [], 'a keyless gate does not move the player');

  const coffin = h.fireObject(42532, 'Search', early);
  assert.equal(coffin.handled, true);
  assert.ok(early.messages.includes("You need a saw to remove Ranis' head."));
  assert.equal(early.items.get(I.RANIS_HEAD) ?? 0, 0);
});

test('registered mandatory handlers carry a fixture-started route to completion', () => {
  const h = harness();
  const p = makePlayer();
  // Fixture prerequisites only: helper-required saw and a normal free inventory.
  p.items.set(I.SAW, 1);

  h.events['npc-dialogue:hook'].forEach(handler => handler({ player: p, npcId: STRANGER, hook: 'quest:a-night-at-the-theatre:start' }));
  assert.equal(h.quest.getStage(p), 10);

  h.fireObject(42523, 'Climb-down', p);
  assert.deepEqual(p.moves.at(-1), [3680, 9649, 0]);

  h.npcDeaths.forEach(handler => handler({ killer: p, npcId: core.NpcIdentifiers.VYREWATCH_76, location: { x: 3680, y: 9640 } }));
  assert.equal(p.items.get(I.CRYPT_KEY) ?? 0, 1, 'a crypt vyrewatch yields a key');

  h.fireObject(42529, 'Open', p);
  assert.equal(p.items.get(I.CRYPT_KEY) ?? 0, 0, 'the gate consumes the key');
  assert.equal(p.getAttribute('night-at-the-theatre:crypt-unlocked'), 1);

  h.fireObject(42532, 'Search', p);
  assert.equal(p.items.get(I.RANIS_HEAD) ?? 0, 1, 'the coffin yields Ranis head');

  h.fireAction({ player: p, npcId: STRANGER, stepId: 'T6VA-h' });
  assert.equal(p.items.get(I.RANIS_HEAD) ?? 0, 0, 'handing over the head consumes it');
  assert.equal(h.quest.getStage(p), 14);
  h.fireAction({ player: p, npcId: STRANGER, stepId: 'evA_XO' });
  assert.equal(h.quest.getStage(p), 20);

  h.fireLine({ player: p, npcId: STRANGER, text: 'My associates would prefer I remain here.',
    pages: [{ page: PAGE, variants: ['talking-to-the-mysterious-stranger-after-getting-ranis-head-after-finishing-the-first-memory-cutscene'] }] });
  assert.equal(h.quest.getStage(p), 22);

  h.fireObject(42601, 'Open', p);
  assert.ok(p.messages.includes("You try to rip open the egg sac, but it's too strong."), 'acid is required');
  assert.equal(h.quest.getStage(p), 22);

  h.fireAction({ player: p, npcId: DAER, stepId: 'IU5Rz7' });
  assert.equal(p.items.get(I.SULPHURIC_ACID) ?? 0, 1);
  assert.equal(p.getAttribute('night-at-the-theatre:acid-given'), 1);

  h.fireObject(42601, 'Open', p);
  assert.equal(p.items.get(I.SULPHURIC_ACID) ?? 0, 0, 'acid is consumed on the egg sac');
  assert.equal(p.items.get(I.STRANGE_SPIDER_EGGS) ?? 0, 1);
  assert.equal(h.quest.getStage(p), 30);

  h.fireAction({ player: p, npcId: STRANGER, stepId: 'DqxBs2' });
  assert.equal(p.items.get(I.STRANGE_SPIDER_EGGS) ?? 0, 0);
  assert.equal(h.quest.getStage(p), 31);
  h.fireAction({ player: p, npcId: STRANGER, stepId: '0vgPPw' });
  h.fireAction({ player: p, npcId: STRANGER, stepId: 'Jb3C2v' });
  assert.equal(h.quest.getStage(p), 33);
  h.fireLine({ player: p, npcId: STRANGER, text: 'Perfect. I will await your return.' });
  assert.equal(h.quest.getStage(p), 35);
  h.fireLine({ player: p, npcId: NATURE, text: 'For you my friend, it is no problem at all.' });
  assert.equal(h.quest.getStage(p), 40);

  // Cross the stepping stone so the registered Hespori area owns the player.
  p.setLocation(3498, 3355, 0);
  h.fireObject(42588, 'Cross', p);
  assert.deepEqual(p.moves.at(-1), [3501, 3355, 0]);
  h.fireObject(42591, 'Chop', p);
  assert.equal(h.quest.getStage(p), 41, 'chopping the ready hespori starts the encounter');
  assert.ok(h.state.challenge, 'the farming Hespori challenge is requested');
  h.emit('hespori:quest-defeated', { player: p });
  assert.equal(h.quest.getStage(p), 44);

  h.fireObject(42592, 'Chop', p);
  assert.equal(p.items.get(I.HESPORI_BARK) ?? 0, 1, 'chopping the dead hespori yields bark');
  h.fireAction({ player: p, npcId: STRANGER, stepId: 'iMEbae' });
  assert.equal(p.items.get(I.HESPORI_BARK) ?? 0, 0);
  assert.equal(h.quest.getStage(p), 48);
  h.fireAction({ player: p, npcId: STRANGER, stepId: 'MyJYx0' });
  h.fireAction({ player: p, npcId: STRANGER, stepId: 'BZhXee' });
  assert.equal(h.quest.getStage(p), 52);
  h.fireLine({ player: p, npcId: STRANGER, text: "You can still take other people in as well of course. Just use the notice board to set up a party and find suitable allies. Once you're ready, I will join you in the Theatre." });
  assert.equal(h.quest.getStage(p), 56);

  h.emit('tob:completed', { player: p, mode: 'entry' });
  assert.equal(h.quest.getStage(p), 78);
  h.fireAction({ player: p, npcId: STRANGER, stepId: 'dUYNsb' });
  assert.equal(h.quest.getStage(p), 80);
  assert.equal(h.wire(p), 86, 'the final hand-in sends native completion 86');
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.items.get(I.ANTIQUE_LAMP_23) ?? 0, 4, 'completion grants four antique lamps');
  assert.equal(Number(p.getAttribute('quest.points')), 2);

  h.fireAction({ player: p, npcId: STRANGER, stepId: 'dUYNsb' });
  assert.equal(p.items.get(I.ANTIQUE_LAMP_23) ?? 0, 4, 'repeating completion grants no extra lamps');
});

test('a full bag at completion leaves lamps reclaimable, and lamp rub uses the 20k combat reward', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 78);
  p.setFull(true);
  h.fireAction({ player: p, npcId: STRANGER, stepId: 'dUYNsb' });
  assert.equal(h.quest.getStage(p), 80);
  assert.equal(p.items.get(I.ANTIQUE_LAMP_23) ?? 0, 0);
  assert.ok(p.messages.some(text => text.includes('Make room and speak to the Mysterious Stranger')));

  p.setFull(false);
  h.emit('night-at-the-theatre:claim-lamps', { player: p, handled: false });
  assert.equal(p.items.get(I.ANTIQUE_LAMP_23) ?? 0, 4, 'the pending lamps are reclaimable once there is room');
  h.emit('night-at-the-theatre:claim-lamps', { player: p, handled: false });
  assert.equal(p.items.get(I.ANTIQUE_LAMP_23) ?? 0, 4, 'reclaim never exceeds four lamps');

  const rub = { player: p, itemId: I.ANTIQUE_LAMP_23, option: 'Rub', handled: false };
  h.itemActions.forEach(handler => handler(rub));
  assert.equal(rub.handled, true);
  assert.ok(h.state.xpReward, 'rub opens the combat XP reward prompt');
  const before = p.xp.get(core.Skill.ATTACK) ?? 0;
  assert.equal(h.state.xpReward.onConfirm(core.Skill.ATTACK, 'Attack'), 'You have been awarded 20,000 Attack XP!');
  assert.equal(p.xp.get(core.Skill.ATTACK), before + 20000);
  assert.equal(p.items.get(I.ANTIQUE_LAMP_23) ?? 0, 3, 'one lamp is consumed');
  assert.equal(p.getAttribute('night-at-the-theatre:lamps-used'), 1);
});

test('dialogue conditions answer the real lost-item, full-bag and raid-completion ids', () => {
  const h = harness();
  const p = makePlayer();
  const condition = h.conditions.at(-1);
  const pages = [{ page: 'Transcript:A Night at the Theatre' }];
  assert.equal(condition({ player: p, stepId: 'YudDDA', pages }), true, 'lost Ranis head branch');
  assert.equal(condition({ player: p, stepId: 'UuYs_j', pages }), true, 'lost hespori bark branch');
  p.setFull(true);
  assert.equal(condition({ player: p, stepId: 'ULZ-yE', pages }), true, 'Daer full inventory branch');
  assert.equal(condition({ player: p, stepId: '11lery', pages }), false);
  p.setFull(false);
  assert.equal(condition({ player: p, stepId: '11lery', pages }), true);
  assert.equal(condition({ player: p, stepId: 'tGIC8d', pages }), false, 'no ToB completion yet');
  h.state.raidComplete = true;
  assert.equal(condition({ player: p, stepId: 'tGIC8d', pages }), true, 'ToB completion branch');
});

test('the real bark transcript carries stage 52 to the canonical notice board line', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const h = harness();
  const p = makePlayer();
  const manager = new DialogueManager(p);
  p.getDialogueManager = () => manager;
  // The transcript runner asks the plugin for the prose conditions, so the quest's
  // own condition handler goes into the real PluginManager for this test only.
  const hook = { pluginName: 'q083-test', handler: h.conditions.at(-1) };
  PluginManager.npcDialogueConditionHooks.push(hook);
  try {
    h.quest.setStage(p, 44);
    p.items.set(I.HESPORI_BARK, 1);
    // The Stranger's own bark conversation, run by the real transcript runner.
    h.fireNpc('Mysterious Stranger', 'Talk-to', p, { npc: h.npc(STRANGER), npcId: STRANGER });
    for (let step = 0; step < 500 && manager.getCurrent(); step++) manager.advance();
  } finally {
    const index = PluginManager.npcDialogueConditionHooks.indexOf(hook);
    if (index >= 0) PluginManager.npcDialogueConditionHooks.splice(index, 1);
  }
  const notice = h.state.spoken.find(line => line.text === "You can still take other people in as well of course. Just use the notice board to set up a party and find suitable allies. Once you're ready, I will join you in the Theatre.");
  assert.ok(notice, 'the bark conversation reaches the notice board line');
  assert.equal(notice.stage, 52, 'the line is spoken while the player is at stage 52');
  assert.equal(h.quest.getStage(p), 56, 'the stage-52 bark conversation reaches the Theatre leg');
  assert.equal(p.items.get(I.HESPORI_BARK) ?? 0, 0, 'the bark is handed over in that conversation');
});

test('the real head hand-in and the separate "So about that memory..." conversation are two stages', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const h = harness();
  const p = makePlayer();
  const manager = new DialogueManager(p);
  p.getDialogueManager = () => manager;
  const hook = { pluginName: 'q083-test', handler: h.conditions.at(-1) };
  PluginManager.npcDialogueConditionHooks.push(hook);
  const play = () => { for (let step = 0; step < 500 && manager.getCurrent(); step++) manager.advance(); };
  try {
    h.quest.setStage(p, 10);
    p.items.set(I.RANIS_HEAD, 1);
    // The real transcript runner plays the hand-in conversation, cutscene included.
    h.fireNpc('Mysterious Stranger', 'Talk-to', p, { npc: h.npc(STRANGER), npcId: STRANGER });
    play();
    assert.equal(h.quest.getStage(p), 20, 'the hand-in conversation ends at the first memory');
    assert.ok(h.state.spoken.some(line => line.text === 'My associates would prefer I remain here.'),
      'the hand-in conversation speaks the shared line');
    assert.equal(p.items.get(I.RANIS_HEAD) ?? 0, 0, 'the head is handed over');

    // The wiki's separate stage-20 conversation opens the nest leg.
    const second = new DialogueManager(p);
    p.getDialogueManager = () => second;
    h.fireNpc('Mysterious Stranger', 'Talk-to', p, { npc: h.npc(STRANGER), npcId: STRANGER });
    for (let step = 0; step < 500 && second.getCurrent(); step++) second.advance();
    assert.equal(h.quest.getStage(p), 22, 'the "So about that memory..." conversation reaches the nest leg');
  } finally {
    const index = PluginManager.npcDialogueConditionHooks.indexOf(hook);
    if (index >= 0) PluginManager.npcDialogueConditionHooks.splice(index, 1);
  }
});

test('the post-quest Stranger conversation opens the crystal shop and hides the unimplemented shroud reward', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const h = harness();
  const p = makePlayer();
  const manager = new DialogueManager(p);
  p.getDialogueManager = () => manager;
  const hook = { pluginName: 'q083-test', handler: h.conditions.at(-1) };
  PluginManager.npcDialogueConditionHooks.push(hook);
  try {
    h.quest.setStage(p, 80);
    h.fireNpc('Mysterious Stranger', 'Talk-to', p, { npc: h.npc(STRANGER), npcId: STRANGER });
    for (let step = 0; step < 500 && manager.getCurrent(); step++) manager.advance();
    const labels = h.state.prompts.flatMap(prompt => prompt.labels);
    assert.ok(labels.includes('Can I get those teleport crystals you mentioned?'), 'the crystal option is offered');
    assert.ok(!labels.includes('What do you have for me?'), 'the shroud reward this server cannot award is not offered');
    // The cache's own shop definition: the Stranger sells the escape crystal.
    const shop = require('../data/definitions/shops.json').find(entry => entry.id === 1240);
    assert.equal(shop.name, 'Mysterious Stranger (shop)');
    assert.equal(shop.originalStock[0].id, 22517, 'the shop stocks the teleport crystal');
    h.state.tasks.forEach(task => task.callback());
    assert.deepEqual(h.state.shops, [1240], 'the crystal option opens the Stranger shop');
  } finally {
    const index = PluginManager.npcDialogueConditionHooks.indexOf(hook);
    if (index >= 0) PluginManager.npcDialogueConditionHooks.splice(index, 1);
  }
});

test('a normal-mode Theatre of Blood completion reaches the quest through the registered bridge', () => {
  const h = harness({ rewards: true });
  const p = makePlayer();
  const Rewards = require('../plugins/minigames/tob/Rewards.TheatreOfBlood');
  h.quest.setStage(p, 56);
  // The real normal-mode completion path: the count, the event, the query.
  Rewards.countCompletion(p);
  assert.equal(p.getAttribute('tob:completions'), 1, 'the normal completion is counted');
  assert.equal(h.quest.getStage(p), 78, 'the registered quest handler advances the stage');
  assert.equal(h.state.emitted.filter(key => key === 'tob:completed').length, 1, 'one completion event');
  const request = { player: p, complete: false };
  h.emit('tob:has-completion', request);
  assert.equal(request.complete, true, 'the query answers true for a normal completion');
  assert.equal(p.getAttribute('tob:entry-completions'), undefined, 'the normal path leaves the entry count alone');

  // Another player is untouched by somebody else's clear.
  const other = makePlayer();
  h.emit('tob:completed', { player: other });
  assert.equal(h.quest.getStage(other), 0, 'another player does not advance');
  const otherRequest = { player: other, complete: false };
  h.emit('tob:has-completion', otherRequest);
  assert.equal(otherRequest.complete, false, 'a player who never cleared has no completion');
  assert.equal(other.getAttribute('tob:completions'), undefined, 'no count for another player');

  // A player who cleared before still finds the quest on the completion path.
  const veteran = makePlayer();
  veteran.setAttribute('tob:completions', 1);
  h.quest.setStage(veteran, 56);
  Rewards.countCompletion(veteran);
  assert.equal(veteran.getAttribute('tob:completions'), 2, 'the count keeps counting');
  assert.equal(h.quest.getStage(veteran), 78, 'the prior completion still advances the stage');
});
