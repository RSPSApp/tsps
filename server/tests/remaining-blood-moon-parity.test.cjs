// Focused parity checks for The Blood Moon Rises (Quest Helper pinned
// 06da90f982518a093f2fe1c9cfac5547fa7053d3 + RSProx captures).
// Run from server/: node --test tests/remaining-blood-moon-parity.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
let nextIndex = 1;
const noop = () => {};

before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); });

function harness({ realObjects = false } = {}) {
  const events = {}, tasks = [], npcs = [], removed = [], objects = [], variants = [], npcInteractions = new Map(), objectInteractions = new Map(), anyNpcHooks = [], objectHooks = [], itemOnObject = [];
  let failSpawnId = null, failSpawnCount = 0;
  const api = new Proxy({
    core: { ...core, ObjectManager: realObjects
      ? { register(o, update) { objects.push(o); core.ObjectManager.register(o, update); },
        deregister(o, update) { core.ObjectManager.deregister(o, update); } }
      : { register: o => objects.push(o), deregister: noop },
      CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run, stopped: false }); } },
      TaskManager: { submit(task) { tasks.push(task); }, cancelTasks(key) { for (const task of tasks) if (task.key === key) task.stopped = true; } } },
    registerArea: noop,
    getObjectManager: () => ({ register: o => objects.push(o), deregister: noop }),
    getItemOnGroundManager: () => ({ registerLocation: noop }),
    onNpcDialogueVariant(fn) { variants.push(fn); },
    onNpcDialogueCondition() {},
    onNpcInteraction(name, actions) { npcInteractions.set(name, actions); },
    onAnyNpcInteraction(actions) { anyNpcHooks.push(actions); },
    onObjectInteraction(target, actions) { if (typeof target === 'string') objectInteractions.set(target, actions); else objectHooks.push(target); },
    onObjectRoute() {},
    onItemOnObject(fn) { itemOnObject.push(fn); },
    onItemOnItem() {},
    onItemOnNpc() {},
    onItemAction() {},
    onGroundItemPickup() {},
    onPlayerProcess(fn) { (events['player:process'] ??= []).push(fn); },
    onPlayerLogin() {},
    onPlayerLogout() {},
    onPlayerMapSquareChange() {},
    onPlayerBeforeDeath() {},
    onCombatHitRoll() {},
    onNpcHitModify() {},
    onNpcBeforeDeath(fn) { (events['npc-before-death'] ??= []).push(fn); },
    onNpcHitModify(fn) { (events['npc-hit-modify'] ??= []).push(fn); },
    onPlayerLogin(fn) { (events['player:login'] ??= []).push(fn); },
    onPlayerLogout(fn) { (events['player:logout'] ??= []).push(fn); },
    onNpcDeath(fn) { (events['npc-death'] ??= []).push(fn); },
    onWalkRoute() {},
    registerCommand() {},
    persistAttribute: noop,
    sendMultiChatboxPrompt(target, title, ...pairs) { target.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    onCustomEvent(key, fn) { (events[key] ??= []).push(fn); },
    emitCustomEvent(key, event) { for (const fn of events[key] ?? []) fn(event); },
    spawnNpc(definition) {
      if (failSpawnId === definition.id && failSpawnCount > 0) { failSpawnCount--; return null; }
      const npc = { ...definition, getId: () => definition.id, getIndex: () => nextIndex++, isNpc: () => true, isRegistered: () => !removed.includes(npc),
        getCurrentDefinition: () => core.NpcDefinition.forId(definition.id), isVisible: () => true,
        isOwnerOnly: () => definition.ownerOnly === true, getPrivateArea: () => npc.area ?? null,
        isPlayer: () => false, getAsNpc() { return npc; }, getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        getHitpoints: () => npc.hp ?? 1, setHitpoints(value) { npc.hp = value; }, getArea: () => npc.area ?? null, setArea(value) { npc.area = value; }, getOwner: () => definition.owner,
        getMovementQueue: () => ({ reset() { return this; }, setBlockMovement: noop, addFirstStep: noop }),
        getCombat: () => ({ reset: noop, attack: noop, getLastAttack: () => ({ reset: noop }) }), remove: noop,
        setMaxHitpoints: noop, setScriptedMovement: noop, setMultiCombat: noop, setNpcTransformationId: noop,
        setFlag: noop, performAnimation: noop, performGraphic: noop, forceChat: text => { npc.chat = text; },
        setPositionToFace: noop, exactMove: noop, setFollowing: noop };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => removed.push(npc),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/TheBloodMoonRises.Quest')(api);
  return { api, events, tasks, npcs, removed, objects, variants, npcInteractions, objectInteractions, anyNpcHooks, objectHooks, itemOnObject, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => { for (const fn of events[name] ?? []) fn(event); },
    tick(count) { while (count-- > 0) for (const task of [...tasks]) if (!task.stopped && !task.done) { task.done = true; task.run(); } },
    failNextSpawns(id, count = 1) { failSpawnId = id; failSpawnCount = count; } };
}

function player(name = 'Parity') {
  const attrs = new Map(), items = new Map(), varbits = new Map(), varbitHistory = [], configs = new Map(), messages = [], xp = [], equipment = new Map();
  let location = new core.Location(3210, 3220, 0), area = null;
  const packets = { interfaces: [], closes: [], cameras: [], varbits: [], scripts: [], strings: [] };
  const inv = { getAmount: id => items.get(id) ?? 0, contains: id => (items.get(id) ?? 0) > 0,
    getFreeSlots: () => 28, isFull: () => false,
    adds(id, n = 1) { items.set(id, (items.get(id) ?? 0) + n); },
    forceAdd(_player, item) { items.set(item.getId(), (items.get(item.getId()) ?? 0) + (item.getAmount?.() ?? 1)); },
    deleteNumber(id, n = 1) { items.set(id, (items.get(id) ?? 0) - n); } };
  const packet = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); varbitHistory.push([id, value]); packets.varbits.push([id, value]); return packet; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    sendSubInterface(...args) { packets.interfaces.push(args); return packet; },
    closeSubInterface(...args) { packets.closes.push(args); return packet; },
    sendString(text, uid) { packets.strings.push([text, uid]); return packet; },
    sendClientScript(id, ...args) { packets.scripts.push([id, ...args]); return packet; },
    sendCameraMoveTo(...args) { packets.cameras.push(['move', ...args]); return packet; },
    sendCameraLookAt(...args) { packets.cameras.push(['look', ...args]); return packet; },
    sendCameraReset() { packets.cameras.push(['reset']); return packet; },
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); return packet; },
  }, { get: (t, key) => t[key] ?? (() => packet) });
  const p = {
    attrs, items, varbits, varbitHistory, configs, messages, xp, equipment, packets, index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inv, getEquipment: () => ({ get: slot => equipment.get(slot), contains: id => [...equipment.values()].some(e => e?.getId() === id) }),
    getPacketSender: () => packet, getDialogueManager: () => p.manager,
    getSkillManager: () => ({ getMaxLevel: () => p.skillLevel ?? 99, getCurrentLevel: () => 99, addExperiences: (s, a) => xp.push([s, a]) }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.movementBlocked = value; return this; }, isBlockMovement: () => Boolean(p.movementBlocked), addSteps: to => { location = to; } }),
    getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; },
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getIndex: () => p.index, getUsername: () => name, getAppearance: () => ({ isMale: () => true }), sendMessage: text => messages.push(text),
    getHitpoints: () => p.hitpoints ?? 99,
    setPositionToFace: noop, forceChat: noop, performAnimation: noop, setUntargetable: noop, getCombat: () => ({ reset: noop, getHitQueue: () => ({ addPendingDamage: noop }) }),
  };
  p.manager = new DialogueManager(p);
  return p;
}

function continueUntil(p, predicate, limit = 200) {
  while (!predicate()) {
    assert.ok(limit-- > 0, `dialogue stalled at ${p.manager.getCurrent()?.getText?.()}`);
    assert.ok(p.manager.getCurrent(), 'dialogue ended before the expected step');
    p.manager.advance();
  }
}

function choose(p, text) {
  const prompt = p.prompt;
  assert.ok(prompt, `no prompt for ${text}`);
  const index = prompt.options.findIndex(label => label === text);
  assert.ok(index >= 0, `missing ${text} in ${prompt.options}`);
  p.prompt = null;
  prompt.pairs[index * 2 + 1]();
}

const PREREQS = ['sins_of_the_father', 'a_night_at_the_theatre'];

function enablePrereqs(h, completed) {
  (h.events['quest:is-complete'] ??= []).push(event => {
    if (completed.has(event.key)) event.complete = true;
  });
}

test('Sarius starts the quest only with prereqs, then the recorded Yes choice marks stage 4', () => {
  const h = harness(), p = player(), completed = new Set(PREREQS);
  enablePrereqs(h, completed);
  p.skillLevel = 99;
  const sarius = { npcId: N.SARIUS_GUILE_4, definition: { getName: () => 'Sarius Guile' },
    pages: [{ page: 'The Blood Moon Rises', variants: ['starting-out', 'starting-out-in-the-myreque-hideout'] }] };
  const variant = who => h.variants.map(fn => fn({ player: who, ...sarius })).find(Boolean) ?? null;
  assert.equal(variant(p)?.variant, 'starting-out');

  const weak = player(); weak.skillLevel = 99;
  completed.clear();
  assert.equal(variant(weak), null, 'missing prereqs must not offer the start');
  completed.add('sins_of_the_father');
  assert.equal(variant(weak), null, 'both prereqs are required');
  completed.add('a_night_at_the_theatre');
  weak.skillLevel = 50;
  assert.equal(variant(weak), null, 'skill requirements gate the transcript');
  weak.skillLevel = 99;
  assert.equal(variant(weak)?.variant, 'starting-out');

  h.emit('npc-dialogue:choice', { player: p, option: 'No.', definition: { getName: () => 'Sarius Guile' } });
  assert.equal(h.quest.getStage(p), 0, 'declining must not start the quest');
  h.emit('npc-dialogue:choice', { player: p, option: 'Yes.', definition: { getName: () => 'Sarius Guile' } });
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.varbits.get(15464), 2, 'accepting Sarius sets captured native stage 2');
});

test('hideout shrine is only inspectable in the hideout and outfit gates departure', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS)); h.quest.setStage(p, 10);
  const shrine = { objectId: 61174, location: new core.Location(3601, 9614, 0) };
  p.moveTo(shrine.location);
  const far = { ...shrine, location: new core.Location(3200, 3200, 0) };
  p.moveTo(far.location);
  h.emit('world:object-examine', { player: p, ...far });
  p.moveTo(shrine.location);
  assert.equal(p.attrs.get('quest.the_blood_moon_rises.hideout-shrine-inspected'), undefined);
  p.varbitHistory.length = 0;
  h.emit('world:object-examine', { player: p, ...shrine });
  assert.equal(p.attrs.get('quest.the_blood_moon_rises.hideout-shrine-inspected'), true);
  const shrineStages = p.varbitHistory.filter(([id]) => id === 15464).map(([, value]) => value);
  assert.ok(shrineStages.includes(6), 'shrine objectbox opens at native stage 6');
  assert.equal(p.varbits.get(15464), 8, 'first shrine line sets native stage 8');

  h.emit('npc-dialogue:choice', { player: p, option: "I'm ready.", definition: { getName: () => 'Ivan Strom' } });
  assert.equal(h.quest.getStage(p), 10, 'cannot leave without wearing the vyre outfit');
  for (const [slot, item] of [[core.Equipment.BODY_SLOT, I.VYRE_NOBLE_TOP], [core.Equipment.LEG_SLOT, I.VYRE_NOBLE_LEGS], [core.Equipment.FEET_SLOT, I.VYRE_NOBLE_SHOES]])
    p.equipment.set(slot, { getId: () => item });
  h.emit('npc-dialogue:choice', { player: p, option: "I'm ready.", definition: { getName: () => 'Ivan Strom' } });
  assert.equal(h.quest.getStage(p), 20);
  assert.equal(p.varbits.get(15464), 10, 'Ivan arms the trip at native stage 10');
  p.attrs.set('the-blood-moon-rises:hideout-cutscene-started', true);
  assert.equal(h.quest.varbitValue(20, p), 12, 'Lowerniel cutscene sets native stage 12');
});

test('final council scene completes once, awards 4 QP and a single Tome', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS)); h.quest.setStage(p, 100);
  p.attrs.set('quest.the_blood_moon_rises.drakan-defeated', true);
  const end = { player: p, stepId: 'BzMe5D' };
  h.emit('npc-dialogue:action', end);
  assert.equal(h.quest.getStage(p), 110);
  assert.equal(p.attrs.get('quest.points'), 4);
  assert.equal(p.items.get(I.TOME_OF_EXPERIENCE_3), 1);
  assert.ok(p.messages.some(line => line.includes('Congratulations')));
  h.emit('npc-dialogue:action', end);
  assert.equal(p.items.get(I.TOME_OF_EXPERIENCE_3), 1, 'replaying the scene must not duplicate the reward');
  assert.equal(p.attrs.get('quest.points'), 4);
});

test('post-quest Efaritay reclaims a lost Tome once and never duplicates or loses it', () => {
  const h = harness(), p = player('LostTome');
  const TOME = I.TOME_OF_EXPERIENCE_3;
  const USES = 'quest.the_blood_moon_rises.tome-uses';
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 100);
  p.attrs.set('quest.the_blood_moon_rises.drakan-defeated', true);

  // The real QA completion happened with 28/28 slots. The shared completion
  // add cannot store the Tome there; Efaritay's canonical reclaim covers it.
  const realInventory = p.getInventory;
  p.getInventory = () => ({ contains: () => false, adds: () => false, getFreeSlots: () => 0,
    isFull: () => true, forceAdd: () => {} });
  h.emit('npc-dialogue:action', { player: p, stepId: 'BzMe5D' });
  assert.equal(h.quest.getStage(p), 110);
  assert.equal(p.items.get(TOME), undefined, 'a full inventory does not drop the reward on the floor');
  p.getInventory = realInventory;

  const postQuest = () => h.npcs.find(npc => npc.id === core.NpcIdentifiers.EFARITAY_HALLOW_3 && !h.removed.includes(npc));
  const efaritay = postQuest();
  assert.ok(efaritay, 'normal post-quest Efaritay spawns in Castle Drakan');
  assert.deepEqual([efaritay.getLocation().getX(), efaritay.getLocation().getY()],
    [3163, 7717], 'the wiki map pin inside Castle Drakan');

  const variant = () => h.variants.map(fn => fn({ player: p,
    definition: { getName: () => 'Efaritay Hallow' },
    pages: [
      { page: 'Efaritay Hallow', variants: ['standard-dialogue', 'if-the-tome-of-experience-was-destroyed'] },
      { page: 'The Blood Moon Rises', variants: ['post-quest-dialogue-efaritay'] },
    ] })).find(Boolean) ?? null;
  const reclaim = () => ({ player: p, stepId: '8qI8YD', handled: false });
  assert.deepEqual(variant(), { page: 'Efaritay Hallow', variant: 'if-the-tome-of-experience-was-destroyed' });

  const { PluginManager } = require('../dist/plugins/PluginManager');
  const originalVariant = PluginManager.emitNpcDialogueVariant;
  const talkToEfaritay = () => {
    PluginManager.emitNpcDialogueVariant = event => {
      for (const fn of h.variants) { const result = fn(event); if (result) return result; }
      return null;
    };
    const hooks = [];
    const api2 = new Proxy({}, { get: (_, key) => key === 'onAnyNpcInteraction'
      ? actions => hooks.push(actions) : h.api[key] });
    require('../plugins/npcs/NpcDialogues.plugin').register(api2);
    const definition = core.NpcDefinition.forId(core.NpcIdentifiers.EFARITAY_HALLOW_3);
    hooks[0]['Talk-to']({ player: p, npc: { getId: () => core.NpcIdentifiers.EFARITAY_HALLOW_3 },
      npcId: core.NpcIdentifiers.EFARITAY_HALLOW_3, definition });
    PluginManager.emitNpcDialogueVariant = originalVariant;
  };
  const endDialogue = () => {
    if (p.prompt) choose(p, 'I\'d best get going.');
    continueUntil(p, () => !p.manager.isActive(), 100);
  };

  // The real shipped transcript graph refuses cleanly with a full bag.
  p.getInventory = () => ({ contains: () => false, adds: () => false, getFreeSlots: () => 0,
    isFull: () => true, forceAdd: () => {} });
  talkToEfaritay();
  assert.ok(String(p.manager.getCurrent()?.getText?.()).startsWith('I have a tome here for you'),
    'the destroyed-Tome variant is selected by the real Talk-to dispatch');
  continueUntil(p, () => p.messages.some(line => line.includes('empty inventory slot')), 100);
  assert.equal(p.items.get(TOME), undefined, 'a full bag does not lose or create the Tome');
  assert.equal(p.manager.isActive(), false, 'the refusal closes cleanly');
  p.getInventory = realInventory;

  // The same real graph hands over exactly one Tome and finishes its tail.
  talkToEfaritay();
  continueUntil(p, () => p.items.get(TOME) === 1, 100);
  assert.equal(p.items.get(TOME), 1, 'the empty slot receives one Tome');
  continueUntil(p, () => !p.manager.isActive(), 100);

  // The wiki "same as above" tail is reached by the next normal Talk-to.
  talkToEfaritay();
  assert.ok(String(p.manager.getCurrent()?.getText?.()).startsWith('Hello there'),
    'the next Talk-to uses the canonical standard dialogue');
  continueUntil(p, () => Boolean(p.prompt), 100);
  assert.ok(p.prompt.options.includes('I could use a new weapon.'), 'standard shop option is available');
  endDialogue();

  // A repeated real Talk-to with the Tome held opens the standard dialogue.
  talkToEfaritay();
  assert.ok(String(p.manager.getCurrent()?.getText?.()).startsWith('Hello there'),
    'a held Tome falls through to the standard dialogue');
  endDialogue();
  assert.equal(p.items.get(TOME), 1, 'talking again cannot duplicate a held Tome');
  assert.equal(variant(), null, 'the dispatcher also refuses the reclaim variant when held');

  p.items.delete(TOME);
  p.equipment.set(core.Equipment.WEAPON_SLOT, { getId: () => TOME });
  h.emit('npc-dialogue:action', reclaim());
  assert.equal(p.items.get(TOME), undefined, 'an equipped Tome counts as owned');
  p.equipment.clear();

  p.getBank = () => ({ contains: id => id === TOME });
  h.emit('npc-dialogue:action', reclaim());
  assert.equal(p.items.get(TOME), undefined, 'a banked Tome counts as owned');
  p.getBank = () => ({ contains: () => false });

  p.attrs.set(USES, 6);
  h.emit('npc-dialogue:action', reclaim());
  assert.equal(p.items.get(TOME), undefined, 'six spent chapters need no replacement');
  assert.equal(variant(), null, 'a fully read Tome is not offered again');

  p.attrs.set(USES, 3);
  h.emit('npc-dialogue:action', reclaim());
  assert.equal(p.items.get(TOME), 1, 'remaining chapters are reclaimed from a destroyed Tome');
  assert.equal(p.attrs.get(USES), 3, 'the six-chapter counter is never reset by reclaiming');

  h.emit('player:logout', { player: p });
  assert.ok(h.removed.includes(efaritay), 'logout cleans up the post-quest actor');
  h.emit('player:login', { player: p });
  assert.ok(postQuest(), 'a normal relog restores post-quest Efaritay for the earned completion');
  assert.equal(h.quest.getStage(p), 110, 'the completed stage is not reset');
});

test('post-quest Castle Drakan medallion destination is unlocked and reaches Efaritay on foot', () => {
  const h = harness(), p = player('PostRoute');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 110);
  p.attrs.set('quest.the_blood_moon_rises.slepe-story', { refineryComplete: true });
  p.attrs.set('quest.the_blood_moon_rises.castle-shrine-prayed', true);
  const destinations = [];
  h.emit('drakan-medallion:destinations', { player: p, destinations });
  const castle = destinations.find(entry => entry.label === 'Castle Drakan.');
  assert.deepEqual(castle?.tile, { x: 3167, y: 7707, z: 0 },
    'the completed quest keeps the canonical medallion destination');
});

test('earned 158/160 castle handoffs survive logout/login without moving or regressing native', () => {
  const h = harness(), p = player('Relog158');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  const NATIVE = 'quest.the_blood_moon_rises.final-native-stage';
  p.attrs.set(NATIVE, 158);
  p.moveTo(new core.Location(2845, 7388, 0));

  // Exercise QuestRuntime's real login varp refresh, the same function its
  // onPlayerLogin/bootstrap hooks call. The plugin login hooks add no second
  // correction layer.
  p.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(15464), 158, 'QuestRuntime login refresh publishes the earned 158');
  assert.equal(h.quest.varbitValue(96, p), 158, 'the quest mapper also keeps 158');
  p.varbitHistory.length = 0;
  h.emit('player:login', { player: p });
  assert.equal(p.varbitHistory.some(([id]) => id === 15464), false,
    'the plugin login hooks do not resend a second 15464 correction');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2845, 7388]);

  const ivan = h.npcs.find(npc => npc.id === 15852 && !h.removed.includes(npc));
  assert.ok(ivan, 'castle Ivan is present with his cache morph');
  h.emit('player:logout', { player: p });
  assert.ok(h.removed.includes(ivan), 'logout removes castle Ivan');
  p.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(15464), 158, 'a fresh login refresh still publishes 158');
  h.emit('player:login', { player: p });
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2845, 7388],
    'the earned castle landing is preserved');
  assert.ok(h.npcs.some(npc => npc.id === 15852 && !h.removed.includes(npc)),
    'castle Ivan is restored after relog');

  p.attrs.set(NATIVE, 160);
  p.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  h.emit('player:logout', { player: p });
  h.emit('player:login', { player: p });
  assert.equal(p.varbits.get(15464), 160, 'the Sugadinti handoff also survives relog');
  assert.ok(h.npcs.some(npc => npc.id === 15957 && !h.removed.includes(npc)),
    'castle Sugadinti is restored at native 160');
});

test('a stale 158 attribute cannot override another stage on login refresh', () => {
  const h = harness(), p = player('RelogFinal');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 100);
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 158);
  p.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(15464), 164, 'STAGE.FINAL uses its own mapper, not the stale fence attr');
});

test('interrupted 152-156 gathering saves retry at Burgh instead of faking a castle handoff', () => {
  const h = harness(), p = player('Relog156');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 156);
  p.moveTo(new core.Location(2845, 7388, 0));
  p.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(15464), 150, 'QuestRuntime publishes 150 for an unfinished gathering');
  h.emit('player:login', { player: p });
  assert.equal(p.varbits.get(15464), 150, 'the login hooks do not fake 156');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3490, 9631],
    'the canonical Burgh retry landing');
  assert.equal(h.npcs.some(npc => npc.id === 15852 && !h.removed.includes(npc)), false,
    'no unearned castle Ivan is spawned');
});

test('the ending scene cannot complete from an earlier chapter', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS)); h.quest.setStage(p, 70);
  p.attrs.set('quest.the_blood_moon_rises.drakan-defeated', true);
  h.emit('npc-dialogue:action', { player: p, stepId: 'BzMe5D' });
  assert.equal(h.quest.getStage(p), 70);
  assert.equal(p.items.get(I.TOME_OF_EXPERIENCE_3), undefined);
});

test('Slepe/Paterdomus chapters mirror Quest Helper native stages and defer to the refinery', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS));
  const STORY = 'quest.the_blood_moon_rises.slepe-story';
  h.quest.setStage(p, 30);
  const run = () => h.emit('player:process', { player: p });
  run(); assert.equal(p.varbits.get(15464), 16, 'Ivan outside Slepe church');
  p.attrs.set(STORY, { royClue: true }); run(); assert.equal(p.varbits.get(15464), 18);
  p.attrs.set(STORY, { royClue: true, manorEntered: true }); run(); assert.equal(p.varbits.get(15464), 20);
  p.attrs.set(STORY, { manorEnemiesDefeated: true }); run(); assert.equal(p.varbits.get(15464), 22);
  p.attrs.set(STORY, { manorComplete: true }); run(); assert.equal(p.varbits.get(15464), 24);
  p.attrs.set(STORY, { manorComplete: true, journalGiven: true }); run(); assert.equal(p.varbits.get(15464), 26);
  p.attrs.set(STORY, { journalGiven: true, journalRead: true }); run(); assert.equal(p.varbits.get(15464), 28);
  p.attrs.set(STORY, { journalRead: true, upstairsTalked: true }); run(); assert.equal(p.varbits.get(15464), 30);
  p.attrs.set(STORY, { upstairsTalked: true, monksRequested: true }); run(); assert.equal(p.varbits.get(15464), 32);
  p.attrs.set(STORY, { monksRequested: true, monksBattleStarted: true }); run(); assert.equal(p.varbits.get(15464), 34);
  p.attrs.set(STORY, { monksCleared: true }); run(); assert.equal(p.varbits.get(15464), 36);
  p.attrs.set(STORY, { booksPlaced: true }); run(); assert.equal(p.varbits.get(15464), 38);
  p.attrs.set(STORY, { writingsGiven: true }); run(); assert.equal(p.varbits.get(15464), 40);
  p.attrs.set(STORY, { writingsRead: true }); run(); assert.equal(p.varbits.get(15464), 42);
  p.attrs.set(STORY, { tombRouteStarted: true }); run(); assert.equal(p.varbits.get(15464), 44);
  assert.equal(h.quest.varbitValue(30, p), 44, 'relog resends the granular Slepe stage');
  p.attrs.set('the-blood-moon-rises:refinery-progress', { phase: 'mined' });
  p.varbits.set(15464, 54); run();
  assert.equal(p.varbits.get(15464), 54, 'refinery native stage is not overwritten by the story mirror');
  assert.equal(h.quest.varbitValue(30, p), 54, 'relog during the refinery resumes its stage');
});

test('post-Theatre recorded stages 138/140/142/144 advance in order', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 80);
  p.attrs.set('quest.the_blood_moon_rises.tob-challenge', { started: true, completed: false });
  p.varbitHistory.length = 0;
  h.emit('tob:bmr-completed', { player: p });
  assert.equal(h.quest.getStage(p), 80, 'ToB completion keeps the Theatre chapter open');
  const stages = p.varbitHistory.filter(([id]) => id === 15464).map(([, value]) => value);
  assert.ok(stages.includes(138), 'Sugadinti scene starts at 138');
  assert.equal(p.varbits.get(15464), 140, 'leaving the scene sets 140');
  h.emit('npc-dialogue:action', { player: p, stepId: '4G5OZg' });
  assert.equal(h.quest.getStage(p), 90, 'entering the ruins starts the Wyrd chapter');
  assert.equal(p.varbits.get(15464), 144, 'Wyrd fight stage 144');
});

test('Blood Moon gathering replaces the premature jump to the final chapter', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.wyrd-defeated', true);
  p.varbitHistory.length = 0;
  h.emit('npc-dialogue:action', { player: p, stepId: '2QgFZA', kind: 'action' });
  assert.equal(h.quest.getStage(p), 96, 'still in the Wyrd chapter for the gathering conversations');
  assert.ok(p.varbitHistory.some(([id, value]) => id === 15464 && value === 152), 'gathering starts at native 152');
  const sceneLine = { player: p, text: "I suppose we're about to find out...", pages: [{ page: "The Blood Moon Rises", variants: ["night-of-the-blood-moon"] }], step: { speaker: "Sugadinti Vitur" } };
  h.emit('npc-dialogue:line', sceneLine); sceneLine.after();
  assert.equal(p.varbits.get(15464), 154, 'the gathering fight starts at 154');
  const boss = h.npcs.find(npc => npc.id === core.NpcIdentifiers.LOWERNIEL_DRAKAN_18);
  assert.ok(boss, 'spawns the captured combat_3 Lowerniel');
  p.varbitHistory.length = 0;
  h.emit('npc-before-death', { npc: boss, killer: p });
  assert.ok(p.varbitHistory.some(([id, value]) => id === 15464 && value === 156), 'Safalaan intervention sets 156');
  assert.equal(h.quest.getStage(p), 96, 'the final chapter is not entered until Efaritay is met');
});

test('captured native 14 spans the hideout conversation until "What is it?"', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 20);
  p.attrs.set('quest.the_blood_moon_rises.hideout-defense-complete', true);
  h.emit('npc-dialogue:action', { player: p, stepId: 'fiqzZ7', kind: 'action' });
  assert.equal(h.quest.getStage(p), 25, 'post-escape hideout stage');
  assert.equal(p.varbits.get(15464), 14, 'captured native 14');
  h.emit('npc-dialogue:line', { player: p, text: 'What is it?', pages: [{ page: 'The Blood Moon Rises', variants: ['starting-out-back-at-the-hideout'] }], step: { } });
  assert.equal(h.quest.getStage(p), 30);
  assert.equal(p.varbits.get(15464), 16, 'native 16 at the Veliaf discussion');
});

test('gathering fight uses the captured 900 HP intervention and fires once', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.wyrd-defeated', true);
  h.emit('npc-dialogue:action', { player: p, stepId: '2QgFZA', kind: 'action' });
  const sceneLine = { player: p, text: "I suppose we're about to find out...", pages: [{ page: "The Blood Moon Rises", variants: ["night-of-the-blood-moon"] }], step: { speaker: "Sugadinti Vitur" } };
  h.emit('npc-dialogue:line', sceneLine); sceneLine.after();
  const boss = h.npcs.find(npc => npc.id === core.NpcIdentifiers.LOWERNIEL_DRAKAN_18);
  assert.ok(boss);
  const fight = p.attrs.get('the-blood-moon-rises:gathering-fight');
  assert.equal(fight.boss, boss);
  boss.setHitpoints(950);
  assert.equal(boss.getHitpoints(), 950);
  p.varbitHistory.length = 0;
  const part = { getDamage: () => 100, setDamage(value) { this.value = value; } };
  const hit = { getHits: () => [part], updateTotalDamage: noop };
  h.emit('npc-hit-modify', { npc: boss, hit });
  assert.equal(part.value, 50, 'damage is clamped at the 900 HP story threshold');
  assert.equal(p.varbits.get(15464), 156);
  assert.equal(h.removed.filter(npc => npc === boss).length, 1, 'boss removed once');
  h.emit('npc-hit-modify', { npc: boss, hit: { getHits: () => [{ getDamage: () => 50, setDamage: noop }], updateTotalDamage: noop } });
  const interventions = p.varbitHistory.filter(([id, value]) => id === 15464 && value === 156).length;
  assert.equal(interventions, 1, 'repeated hits do not replay the intervention');
});

test('final victory resumes at 172 after death and cannot be confirmed twice', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 100);
  p.attrs.set('quest.the_blood_moon_rises.drakan-death-confirmed', true);
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 170);
  h.emit('player:login', { player: p });
  assert.equal(p.varbits.get(15464), 172, 'relog after death resumes the 172 cutscene');
  p.attrs.set('quest.the_blood_moon_rises.drakan-defeated', true);
  h.emit('npc-dialogue:action', { player: p, stepId: 'BzMe5D' });
  assert.equal(h.quest.getStage(p), 110);
  const once = h.removed.length;
  h.emit('npc-dialogue:action', { player: p, stepId: 'BzMe5D' });
  assert.equal(p.items.get(I.TOME_OF_EXPERIENCE_3), 1, 'final reward stays one-shot');
  assert.equal(h.removed.length, once);
});

test('repeated gather input spawns one boss and logout cleans every actor', () => {
  const h = harness(), p = player();
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.wyrd-defeated', true);
  h.emit('npc-dialogue:action', { player: p, stepId: '2QgFZA', kind: 'action' });
  const line = { player: p, text: "I suppose we're about to find out...", pages: [{ page: "The Blood Moon Rises", variants: ["night-of-the-blood-moon"] }], step: { speaker: "Sugadinti Vitur" } };
  h.emit('npc-dialogue:line', line); line.after();
  const bosses = () => h.npcs.filter(npc => npc.id === core.NpcIdentifiers.LOWERNIEL_DRAKAN_18);
  assert.equal(bosses().length, 1);
  line.after();
  assert.equal(bosses().length, 1, 'replaying the cutscene line does not spawn a second boss');
  const gathering = [bosses()[0], ...h.npcs.filter(npc => [core.NpcIdentifiers.IVAN_STROM_23, core.NpcIdentifiers.SUGADINTI_VITUR_6, core.NpcIdentifiers.ARANEI_92].includes(npc.id))];
  assert.ok(gathering.length >= 2);
  h.emit('player:logout', { player: p });
  for (const npc of gathering) assert.ok(h.removed.includes(npc), 'gathering actor removed on logout');
});

function startTranscript(h, p, npcId, variant, npc = null) {
  assert.equal(runtime.startTranscript(h.api, p, npcId, 'The Blood Moon Rises', variant, undefined, npc), true);
}

test('real starting-out transcript keys on placeholders for two different players', () => {
  for (const name of ['Alice', 'ZezimaTwo']) {
    const h = harness(), p = player(name);
    enablePrereqs(h, new Set(PREREQS));
    startTranscript(h, p, N.SARIUS_GUILE_4, 'starting-out');
    continueUntil(p, () => Boolean(p.prompt));
    choose(p, 'Yes.');
    assert.equal(h.quest.getStage(p), 10, `${name}: quest accepted`);
    assert.equal(p.varbits.get(15464), 4, `${name}: closing Sarius line reaches native 4`);
  }
});

test('real shrine transcript advances on the substituted line for two different players', () => {
  for (const name of ['Alice', 'ZezimaTwo']) {
    const h = harness(), p = player(name);
    enablePrereqs(h, new Set(PREREQS));
    h.quest.setStage(p, 10);
    p.attrs.set('quest.the_blood_moon_rises.hideout-shrine-inspected', true);
    p.varbits.set(15464, 6);
    startTranscript(h, p, N.IVAN_STROM_4, 'starting-out-inspecting-the-shrine');
    continueUntil(p, () => p.manager.getCurrent()?.getText?.() === `${name}.`);
    assert.equal(p.varbits.get(15464), 8, `${name}: substituted shrine line reaches native 8`);
  }
});

test('same raw line on another quest page cannot advance Blood Moon state', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 10);
  p.attrs.set('quest.the_blood_moon_rises.hideout-shrine-inspected', true);
  h.emit('npc-dialogue:line', { player: p, text: 'Good luck, [player name].',
    pages: [{ page: 'Another Quest', variants: ['starting-out'] }], step: { speaker: 'Sarius Guile' } });
  assert.equal(p.attrs.get('the-blood-moon-rises:start-dialogue-complete'), undefined);
});

test('hideout departure runs the captured fade and hideout camera, then resets', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 20);
  p.attrs.set('quest.the_blood_moon_rises.hideout-shrine-inspected', true);
  for (const [slot, item] of [[core.Equipment.BODY_SLOT, I.VYRE_NOBLE_TOP], [core.Equipment.LEG_SLOT, I.VYRE_NOBLE_LEGS], [core.Equipment.FEET_SLOT, I.VYRE_NOBLE_SHOES]])
    p.equipment.set(slot, { getId: () => item });
  const talk = h.npcInteractions.get('Ivan Strom')['Talk-to'];
  assert.ok(talk({ player: p, npcId: N.IVAN_STROM_13, definition: { getName: () => 'Ivan Strom' } }));
  choose(p, "I'm ready.");
  assert.ok(p.packets.interfaces.some(args => args[0] === ((161 << 16) | 1)), 'fade overlay opened');
  assert.ok(p.packets.cameras.some(args => args[0] === 'move' && args[1] === 3597 && args[2] === 9617 && args[3] === 370));
  assert.ok(p.packets.cameras.some(args => args[0] === 'look' && args[1] === 3602 && args[2] === 9610 && args[3] === 369));
  h.tick(2);
  assert.ok(p.packets.interfaces.some(args => args[3]?.postScripts?.[0]?.args?.[1] === 0), 'fade back in scheduled');
  p.attrs.set('quest.the_blood_moon_rises.hideout-defense-complete', true);
  p.packets.cameras.length = 0;
  h.emit('npc-dialogue:action', { player: p, stepId: 'fiqzZ7', kind: 'action' });
  assert.ok(p.packets.cameras.some(args => args[0] === 'reset'), 'escape restores the camera');
});

test('gathering scene plays the captured crowd camera and fade, and relog resets it', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.wyrd-defeated', true);
  h.emit('npc-dialogue:action', { player: p, stepId: '2QgFZA', kind: 'action' });
  const line = { player: p, text: 'Myreque prevail.', pages: [{ page: 'The Blood Moon Rises', variants: ['fighting-wyrds-inspecting-the-broken-fence'] }], step: {} };
  h.emit('npc-dialogue:line', line); line.after();
  assert.ok(p.packets.cameras.some(args => args[0] === 'move' && args[1] === 3594 && args[2] === 3358 && args[3] === 120));
  assert.ok(p.packets.cameras.some(args => args[0] === 'look' && args[1] === 3566 && args[2] === 3355 && args[3] === 180));
  h.tick(6);
  assert.ok(p.packets.cameras.some(args => args[0] === 'move' && args[1] === 3571 && args[2] === 3350 && args[3] === 360));
  p.packets.cameras.length = 0;
  h.emit('player:login', { player: p });
  assert.ok(p.packets.cameras.some(args => args[0] === 'reset'), 'relog clears the cutscene camera');
  assert.equal(p.varbits.get(6719), 0, 'minimap restored');
});

test('post-Drakan graveyard camera, actors and fade clean up at 176 and completion', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 100);
  p.attrs.set('quest.the_blood_moon_rises.drakan-death-confirmed', true);
  h.emit('npc-dialogue:action', { player: p, stepId: 'HNA3XS' });
  assert.equal(p.varbits.get(15464), 174);
  assert.ok(p.packets.cameras.some(args => args[0] === 'move' && args[1] === 3715 && args[2] === 3210 && args[3] === 345));
  assert.ok(p.packets.cameras.some(args => args[0] === 'look' && args[1] === 3707 && args[2] === 3211 && args[3] === 65));
  const actors = h.npcs.filter(npc => [core.NpcIdentifiers.EFARITAY_HALLOW_3, core.NpcIdentifiers.WYRD_4, core.NpcIdentifiers.EFARITAY_HALLOW_5].includes(npc.id));
  assert.ok(actors.length >= 2, 'Efaritay and Wyrd actors spawned for the scene');
  p.packets.cameras.length = 0;
  h.emit('npc-dialogue:action', { player: p, stepId: 'I_SfUV' });
  h.tick(1);
  assert.equal(p.varbits.get(15464), 176);
  assert.ok(actors.every(npc => h.removed.includes(npc)), 'graveyard actors removed at 176');
  assert.ok(p.packets.cameras.some(args => args[0] === 'reset'));
  h.emit('npc-dialogue:action', { player: p, stepId: 'BzMe5D' });
  h.tick(2);
  assert.equal(h.quest.getStage(p), 110);
  assert.equal(p.items.get(I.TOME_OF_EXPERIENCE_3), 1);
  assert.ok(p.packets.cameras.some(args => args[0] === 'reset'), 'camera reset on completion');
});

test('shipped index resolves world Sarius 15839 to the real starting-out dispatch', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  const def = core.NpcDefinition.forId(15839);
  assert.equal(def?.getName?.(), 'Sarius Guile');
  const index = require('../data/definitions/npc-dialogue-index.json');
  assert.deepEqual(index['15839'], [{ page: 'Transcript:The Blood Moon Rises', variants: ['pre-release-dialogue', 'starting-out'] }]);

  const dialogueHooks = [];
  const api2 = new Proxy({}, { get: (_, key) => key === 'onAnyNpcInteraction'
    ? actions => dialogueHooks.push(actions) : h.api[key] });
  require('../plugins/npcs/NpcDialogues.plugin').register(api2);
  const talk = dialogueHooks[0]['Talk-to'];
  const npc = { getId: () => 15839 };
  talk({ player: p, npc, npcId: 15839, definition: def });
  assert.ok(p.manager.getCurrent(), 'NPC dialogue started from the shipped index');
  assert.notEqual(p.manager.getCurrent().getText?.(), "Sorry, i've nothing interesting to talk about yet");
  continueUntil(p, () => p.manager.getCurrent()?.getText?.() === "I was hoping I'd find you here.");
  assert.equal(p.manager.getCurrent().getText(), "I was hoping I'd find you here.");
});

test('shipped Makeshift shrine 61177 Inspect follows the normal object hook to stage 6', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const loc = CacheDefinitions.getObject(61177);
  assert.equal(loc?.name, 'Makeshift shrine');
  assert.equal(loc?.actions?.[0], 'Inspect');
  assert.equal(loc?.actions?.filter(Boolean).length, 1);

  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 10);
  p.moveTo(new core.Location(3600, 9614, 0));
  const actions = h.objectInteractions.get('Makeshift shrine');
  assert.ok(actions?.Inspect, 'registered named Inspect hook');
  const event = { player: p, objectId: 61177, option: 'inspect', handled: false,
    definition: { getId: () => 61177, getName: () => 'Makeshift shrine' },
    location: new core.Location(3601, 9614, 0) };
  actions.Inspect(event);
  assert.equal(event.handled, true);
  assert.equal(p.attrs.get('quest.the_blood_moon_rises.hideout-shrine-inspected'), true);
  const stages = p.varbitHistory.filter(([id]) => id === 15464).map(([, value]) => value);
  assert.ok(stages.includes(6), 'Inspect sends the captured stage 6');
  assert.equal(p.varbits.get(15464), 8, 'real shrine transcript advances to 8');
});

test('shipped Fence 61269 Inspect follows the named object hook at the broken fence', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const loc = CacheDefinitions.getObject(61269);
  assert.equal(loc?.name, 'Fence');
  assert.equal(loc?.actions?.[0], 'Inspect');

  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  p.attrs.set('quest.the_blood_moon_rises.wyrd-defeated', true);
  p.moveTo(new core.Location(3562, 3322, 0));
  const actions = h.objectInteractions.get('Fence');
  assert.ok(actions?.Inspect, 'registered named Fence Inspect hook');
  const event = { player: p, objectId: 61269, option: 'inspect', handled: false,
    definition: { getId: () => 61269, getName: () => 'Fence' },
    location: new core.Location(3562, 3323, 0) };
  assert.equal(actions.Inspect(event), true);
  assert.equal(event.handled, true);
  assert.ok(p.manager.getCurrent(), 'inspection transcript started');
});

test('real Lowerniel speech releases departure controls before the defence fight', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 20);
  p.attrs.set('quest.the_blood_moon_rises.hideout-shrine-inspected', true);
  for (const [slot, item] of [[core.Equipment.BODY_SLOT, I.VYRE_NOBLE_TOP], [core.Equipment.LEG_SLOT, I.VYRE_NOBLE_LEGS], [core.Equipment.FEET_SLOT, I.VYRE_NOBLE_SHOES]])
    p.equipment.set(slot, { getId: () => item });

  const talk = h.npcInteractions.get('Ivan Strom')['Talk-to'];
  assert.ok(talk({ player: p, npcId: N.IVAN_STROM_13, definition: { getName: () => 'Ivan Strom' } }));
  choose(p, "I'm ready.");
  assert.equal(h.quest.getStage(p), 20);
  assert.equal(p.movementBlocked, true, 'departure holds the player during the speech');
  assert.equal(p.varbits.get(542), 1);

  // Real transcript: advance to the final Lowerniel line, then continue past it.
  continueUntil(p, () => p.manager.getCurrent()?.getText?.()?.startsWith('As a starting point'));
  p.manager.advance();
  h.tick(2);

  assert.equal(p.movementBlocked, false, 'controls released before the fight starts');
  assert.equal(p.varbits.get(542), 0);
  assert.equal(p.varbits.get(6719), 0);
  const area = p.attrs.get('quest.the_blood_moon_rises.hideout-defense-area');
  assert.ok(area && area.name === undefined && typeof area.canAttack === 'function', 'real defence area created');
  const enemies = h.npcs.filter(npc => [3717, 3718, 3719].includes(npc.id));
  assert.equal(enemies.length, 3, 'opening vyrewatch spawned');
  for (const npc of enemies) {
    assert.equal(npc.getArea(), area);
    assert.equal(area.canAttack(p, npc), true, 'defence NPCs are targetable after release');
  }
});

test('real gathering scene releases held controls before the combat encounter', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.wyrd-defeated', true);
  h.quest.setStage(p, 96);
  h.emit('npc-dialogue:action', { player: p, stepId: '2QgFZA', kind: 'action' });
  const line = { player: p, text: 'Myreque prevail.', pages: [{ page: 'The Blood Moon Rises', variants: ['fighting-wyrds-inspecting-the-broken-fence'] }], step: {} };
  h.emit('npc-dialogue:line', line); line.after();
  assert.equal(p.movementBlocked, true, 'gathering holds the player during the scene');
  // Real night-of-the-blood-moon transcript is already running; drive to the fight line.
  continueUntil(p, () => p.manager.getCurrent()?.getText?.() === "I suppose we're about to find out...");
  p.manager.advance();
  assert.equal(p.movementBlocked, false, 'controls released before the gathering fight');
  assert.ok(h.npcs.some(npc => npc.id === core.NpcIdentifiers.LOWERNIEL_DRAKAN_18), 'combat_3 Lowerniel spawned');
});

function runFenceToGathering(h, p) {
  startTranscript(h, p, 0, 'fighting-wyrds-inspecting-the-broken-fence');
  continueUntil(p, () => Boolean(p.prompt));
  choose(p, "I'm ready.");
  continueUntil(p, () => p.manager.getCurrent()?.getText?.() === "I suppose we're about to find out...");
  p.manager.advance();
}

test('gathering spawn failure clears the scene and the real fence route retries', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.wyrd-defeated', true);
  h.failNextSpawns(core.NpcIdentifiers.LOWERNIEL_DRAKAN_18, 1);
  runFenceToGathering(h, p);
  assert.equal(p.attrs.get('the-blood-moon-rises:gathering-scene-started'), null,
    'scene marker cleared after spawn failure');
  assert.equal(p.movementBlocked, false);
  assert.ok(p.packets.cameras.some(args => args[0] === 'reset'));
  assert.equal(p.getLocation().getX(), 3490);
  assert.equal(p.getLocation().getY(), 9631);
  assert.ok(p.messages.some(m => m.includes('Inspect the broken fence again')));

  h.failNextSpawns(core.NpcIdentifiers.LOWERNIEL_DRAKAN_18, 0);
  runFenceToGathering(h, p);
  const bosses = h.npcs.filter(npc => npc.id === core.NpcIdentifiers.LOWERNIEL_DRAKAN_18);
  assert.equal(bosses.length, 1, 'real fence rerun spawns exactly one boss');
  assert.equal(p.varbits.get(15464), 154);
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 152);
  const again = { player: p, text: "I suppose we're about to find out...", pages: [{ page: 'The Blood Moon Rises', variants: ['night-of-the-blood-moon'] }], step: { speaker: 'Sugadinti Vitur' } };
  h.emit('npc-dialogue:line', again); again.after();
  assert.equal(h.npcs.filter(npc => npc.id === core.NpcIdentifiers.LOWERNIEL_DRAKAN_18).length, 1,
    'replaying the fight line keeps a single live boss');
});

test('relog at FENCE_FOUND clears a stale gathering scene without a live fight', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('the-blood-moon-rises:gathering-scene-started', true);
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 152);
  p.moveTo(new core.Location(3570, 3351, 0));
  h.emit('player:login', { player: p });
  assert.equal(p.attrs.get('the-blood-moon-rises:gathering-scene-started'), null);
  assert.equal(p.getLocation().getX(), 3490);
  assert.equal(p.getLocation().getY(), 9631);
  assert.equal(p.movementBlocked, false);
  assert.ok(p.packets.cameras.some(args => args[0] === 'reset'));
});

test('real escape action transports to the captured hideout landing and cleans the scene', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 20);
  p.attrs.set('quest.the_blood_moon_rises.hideout-defense-complete', true);
  p.attrs.set('the-blood-moon-rises:gathering-scene-started', true);
  p.moveTo(new core.Location(3574, 3362, 0));
  p.movementBlocked = true;
  p.getLocalNpcs = () => h.npcs;
  const ivan = h.api.spawnNpc({ id: N.IVAN_STROM_13, x: 3574, y: 3362, z: 0 });
  startTranscript(h, p, N.IVAN_STROM_13, 'starting-out-escaping-the-vampyres', ivan);
  for (let i = 0; i < 80 && h.quest.getStage(p) !== 25; i++) h.tick(2);
  assert.equal(h.quest.getStage(p), 25);
  assert.equal(p.getLocation().getX(), 3599);
  assert.equal(p.getLocation().getY(), 9615);
  assert.equal(p.varbits.get(15464), 14);
  assert.equal(p.movementBlocked, false);
  assert.equal(p.attrs.get('the-blood-moon-rises:gathering-scene-started'), null);
  assert.ok(p.packets.cameras.some(args => args[0] === 'reset'));
  assert.ok(h.tasks.every(task => task.stopped || task.done), 'scene timers cancelled');
});

test('relog repairs only the stranded stage-25 courtyard save', () => {
  const h = harness();
  const stranded = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(stranded, 25);
  stranded.moveTo(new core.Location(3574, 3362, 0));
  h.emit('player:login', { player: stranded });
  assert.equal(stranded.getLocation().getX(), 3599);
  assert.equal(stranded.getLocation().getY(), 9615);
  assert.ok(stranded.messages.some(m => m.includes('teleport sets you down')));

  const elsewhere = player('Bob');
  h.quest.setStage(elsewhere, 25);
  elsewhere.moveTo(new core.Location(3200, 3200, 0));
  h.emit('player:login', { player: elsewhere });
  assert.equal(elsewhere.getLocation().getX(), 3200);
  assert.equal(elsewhere.getLocation().getY(), 3200);
  assert.equal(elsewhere.messages.some(m => m.includes('teleport sets you down')), false);
});

test('completed Blood Moon selects canonical post-quest Ivan dialogue without stealing active quests', () => {
  const h = harness(), p = player('PostIvan');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 110);
  const definition = { getName: () => 'Ivan Strom' };
  const pages = [
    { page: 'Ivan Strom', variants: ['standard-dialogue-after-completing-in-search-of-the-myreque'] },
    { page: 'Sins of the Father', variants: [] },
    { page: 'The Blood Moon Rises', variants: ['post-quest-dialogue-ivan'] },
  ];
  const chooseVariant = () => h.variants.map(fn => fn({ player: p, definition, pages })).find(Boolean) ?? null;
  assert.deepEqual(chooseVariant(), { page: 'The Blood Moon Rises', variant: 'post-quest-dialogue-ivan' });

  const kingDefinition = { getName: () => 'King Roald' };
  const kingPages = [{ page: 'The Blood Moon Rises', variants: ['post-quest-dialogue-king-roald'] },
    { page: 'Shield of Arrav', variants: [] }];
  assert.equal(h.variants.map(fn => fn({ player: p, definition: kingDefinition, pages: kingPages })).find(Boolean) ?? null,
    null, 'other shared NPCs keep their canonical start/active dialogue');

  const stages = (h.events['quest:get-stage'] ??= []);
  const complete = (h.events['quest:is-complete'] ??= []);
  const setSins = (value, done) => {
    stages.push(event => { if (event.key === 'sins_of_the_father') event.stage = value; });
    complete.push(event => { if (event.key === 'sins_of_the_father') event.complete = done; });
  };
  setSins(0, false);
  assert.deepEqual(chooseVariant(), { page: 'The Blood Moon Rises', variant: 'post-quest-dialogue-ivan' },
    'a fresh competitor at stage 0 does not displace Ivan');
  stages.pop(); complete.pop();
  setSins(20, false);
  assert.equal(chooseVariant(), null, 'an active Sins chapter keeps its Ivan conversation');
  stages.pop(); complete.pop();
  setSins(20, true);
  assert.deepEqual(chooseVariant(), { page: 'The Blood Moon Rises', variant: 'post-quest-dialogue-ivan' },
    'a completed competitor releases Ivan back to Blood Moon');
  stages.pop(); complete.pop();

  const hooks = [];
  const api2 = new Proxy({}, { get: (_, key) => key === 'onAnyNpcInteraction'
    ? actions => hooks.push(actions) : h.api[key] });
  require('../plugins/npcs/NpcDialogues.plugin').register(api2);
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const originalVariant = PluginManager.emitNpcDialogueVariant;
  PluginManager.emitNpcDialogueVariant = event => {
    for (const fn of h.variants) { const result = fn(event); if (result) return result; }
    return null;
  };
  const realDefinition = core.NpcDefinition.forId(5053);
  hooks[0]['Talk-to']({ player: p, npc: { getId: () => 5053 }, npcId: 5053, definition: realDefinition });
  PluginManager.emitNpcDialogueVariant = originalVariant;
  assert.equal(String(p.manager.getCurrent()?.getText?.()).startsWith('Hey, PostIvan.'), true,
    'the real Talk-to dispatch plays the Blood Moon post-quest line');
});

test('shipped Roy index selects the Blood Moon variant at stage 30 and reaches royClue', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 30);
  p.attrs.set('quest.the_blood_moon_rises.slepe-story', { ivanFollowing: true });
  const def = core.NpcDefinition.forId(9768);
  assert.equal(def?.getName?.(), 'Roy');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  PluginManager.emitNpcDialogueVariant = event => {
    for (const fn of h.variants) { const result = fn(event); if (result) return result; }
    return null;
  };

  const dialogueHooks = [];
  const api2 = new Proxy({}, { get: (_, key) => key === 'onAnyNpcInteraction'
    ? actions => dialogueHooks.push(actions) : h.api[key] });
  require('../plugins/npcs/NpcDialogues.plugin').register(api2);
  dialogueHooks[0]['Talk-to']({ player: p, npc: { getId: () => 9768 }, npcId: 9768, definition: def });

  assert.ok(String(p.manager.getCurrent()?.getText?.()).startsWith('Good day, sir.'),
    'real Blood Moon Roy page selected, not the flat Sins page');
  continueUntil(p, () => Boolean(p.prompt));
  choose(p, "We're looking for a friend of ours.");
  continueUntil(p, () => String(p.manager.getCurrent()?.getText?.()).includes('commotion up at Crombwick Manor'));
  p.manager.advance();
  assert.equal(p.attrs.get('quest.the_blood_moon_rises.slepe-story').royClue, true);
  h.emit('player:process', { player: p });
  assert.equal(p.varbits.get(15464), 18, 'royClue mirrors native 18');
});

test('inactive Roy keeps the default Sins/flat page', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 0);
  const def = core.NpcDefinition.forId(9768);
  const dialogueHooks = [];
  const api2 = new Proxy({}, { get: (_, key) => key === 'onAnyNpcInteraction'
    ? actions => dialogueHooks.push(actions) : h.api[key] });
  require('../plugins/npcs/NpcDialogues.plugin').register(api2);
  dialogueHooks[0]['Talk-to']({ player: p, npc: { getId: () => 9768 }, npcId: 9768, definition: def });
  assert.ok(String(p.manager.getCurrent()?.getText?.()).startsWith('Good day sir.'),
    'default Roy page is used when Blood Moon is inactive');
});

test('Paterdomus 32 -> 34 spawns only the captured 16154/55/56 battle roster', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { World } = require('../dist/game/World');
  const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
  const { NPC } = require('../dist/game/entity/impl/npc/NPC');
  const m1 = CacheDefinitions.getNpc(3484), m2 = CacheDefinitions.getNpc(3485), m3 = CacheDefinitions.getNpc(3486);
  assert.equal(m1.transformVarbit, 15464, '3484 morphs on the myq6 varbit');
  assert.equal(m2.transformVarbit, 15464, '3485 morphs on the myq6 varbit');
  assert.deepEqual([m1.transforms[32], m1.transforms[34], m1.transforms[35]], [16271, 16271, -1],
    'ground-floor 3484 is 16271 until myq6 34, then hidden');
  assert.deepEqual([m2.transforms[32], m2.transforms[34], m2.transforms[35]], [16272, 16272, -1],
    'ground-floor 3485 is 16272 until myq6 34, then hidden');
  assert.deepEqual([m3.transformVarbit, m3.transforms], [15615, [16273, -1]],
    '3486 is the separate 16273 dead-monk morph');

  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 30);
  const STORY = 'quest.the_blood_moon_rises.slepe-story';
  p.attrs.set(STORY, { manorComplete: true, monksRequested: true });
  p.moveTo(new core.Location(3423, 3485, 0));
  h.emit('player:process', { player: p });
  assert.equal(h.npcs.some(npc => [16154, 16155, 16156, 15863, 16271, 16272, 16273].includes(npc.id)), false,
    'no pre-battle owner actors outside the temple front-door zone');
  assert.equal(p.varbits.get(15464), 32, 'monks requested is native 32 before entry');

  p.moveTo(new core.Location(3409, 3489, 0));
  h.emit('player:process', { player: p });
  const expected = [
    [15863, 3409, 3488],
    [16154, 3413, 3489], [16155, 3411, 3492], [16156, 3415, 3491],
    [16154, 3410, 3485], [16155, 3414, 3484], [16156, 3417, 3486],
  ].sort();
  const actors = h.npcs.filter(npc => [15863, 16154, 16155, 16156].includes(npc.id))
    .map(npc => [npc.id, npc.getLocation().getX(), npc.getLocation().getY()]).sort();
  assert.deepEqual(actors, expected, 'only the P1 tick-1740 battle adds, at their exact tiles');
  assert.equal(actors.length, 7, 'Ivan plus two of each combat monk');
  assert.equal(actors.filter(([id]) => id === 16154).length, 2);
  assert.equal(actors.filter(([id]) => id === 16155).length, 2);
  assert.equal(actors.filter(([id]) => id === 16156).length, 2);
  assert.equal(h.npcs.some(npc => [16271, 16272, 16273].includes(npc.id)), false,
    'the pre-fight 16271/72 world morphs are never duplicated as owner NPCs');
  assert.equal(h.npcs.filter(npc => [15863, 16154, 16155, 16156].includes(npc.id)).every(npc => npc.getOwner() === p), true);
  assert.equal(p.attrs.get(STORY).monksBattleStarted, true);
  assert.equal(p.varbits.get(15464), 34, 'normal temple entry advances native 32 -> 34');

  const battleArea = p.getArea();
  assert.ok(battleArea && battleArea.countsAsMainWorld() === false, 'the fight runs in a private area');
  assert.equal(p.getPrivateArea(), battleArea, 'the owner is inside the private battle area');
  assert.equal(BoatManager.syncArea(p), battleArea);
  assert.equal(battleArea.isMulti(), true, 'the captured fight is multi-combat');
  for (const npc of h.npcs.filter(n => [15863, 16154, 16155, 16156].includes(n.id))) {
    assert.equal(npc.getArea(), battleArea, 'every battle actor is attached to the private area');
  }
  const firstMonk = h.npcs.find(n => n.id === 16154);
  assert.equal(battleArea.canAttack(firstMonk, p), true);
  assert.equal(battleArea.canAttack(p, firstMonk), true);
  assert.ok(battleArea.getObjects().some(o => o.getId() === core.ObjectIdentifiers.LARGE_DOOR_110 &&
    o.getLocation().getX() === 3408 && o.getLocation().getY() === 3489), 'captured escape door 61187 at 3408,3489');
  assert.ok(battleArea.getObjects().some(o => o.getId() === core.ObjectIdentifiers.LARGE_DOOR_111 &&
    o.getLocation().getX() === 3408 && o.getLocation().getY() === 3488), 'captured escape door 61188 at 3408,3488');

  // Real World local-NPC sync: the main-world 3484 morph is dropped while the owner is in
  // the private area; an actor attached to that area is kept.
  const worldMonk = NPC.create(3484, new core.Location(3410, 3484, 0));
  const areaMonk = NPC.create(16154, new core.Location(3413, 3489, 0));
  try {
    assert.equal(World.getNpcs().add(worldMonk), true);
    assert.equal(World.getNpcs().add(areaMonk), true);
    battleArea.enter(areaMonk);
    assert.equal(BoatManager.syncArea(worldMonk), null);
    assert.equal(BoatManager.syncArea(areaMonk), battleArea);
    assert.equal(battleArea.canAttack(worldMonk, p), false, 'outside actors cannot attack into the private fight');
    const localNpcs = [];
    World.updateLocalNpcs({
      getLocalNpcs: () => localNpcs,
      getLocation: () => new core.Location(3410, 3489, 0),
      getPrivateArea: () => battleArea,
      getArea: () => battleArea,
      getNpcViewDistance: () => 15,
      getIndex: () => 9999,
      isNeedsPlacement: () => false,
      getAttribute: () => undefined,
    }, [worldMonk, areaMonk]);
    assert.equal(localNpcs.includes(worldMonk), false,
      'native-34 world 3484/16271 is not sent while the private fight is active');
    assert.equal(localNpcs.includes(areaMonk), true, 'the private battle actor is visible');
  } finally {
    World.getNpcs().remove(worldMonk);
    World.getNpcs().remove(areaMonk);
    battleArea.detach(areaMonk);
  }
});

test('Paterdomus battle clears native 34 -> 36 only after all six combat monks die', () => {
  const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
  const h = harness(), p = player('Alice');
  p.getLocalNpcs = () => h.npcs;
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 30);
  const STORY = 'quest.the_blood_moon_rises.slepe-story';
  p.attrs.set(STORY, { manorComplete: true, monksRequested: true, monksBattleStarted: true });
  p.moveTo(new core.Location(3409, 3489, 0));
  h.emit('player:process', { player: p });
  const actors = h.npcs.filter(npc => [15863, 16154, 16155, 16156].includes(npc.id));
  assert.equal(actors.length, 7, 'the replay starts the whole captured roster');
  const battleArea = p.getArea();
  const ivan = actors.find(npc => npc.id === 15863);
  const monks = actors.filter(npc => npc.id !== 15863);
  for (const npc of monks.slice(0, 5)) h.emit('npc-death', { npc, killer: p });
  assert.equal(p.attrs.get(STORY).monksCleared, undefined, 'five kills do not clear the fight');
  assert.equal(p.varbits.get(15464), 34, 'native stays 34 until the last monk');
  h.emit('npc-death', { npc: monks[5], killer: p });
  assert.equal(p.attrs.get(STORY).monksCleared, true);
  assert.equal(p.varbits.get(15464), 36, 'the sixth death advances native 34 -> 36');
  assert.ok(!h.removed.includes(ivan), 'the captured Ivan actor remains for the post-fight overhead');
  assert.ok(p.manager.getCurrent(), 'upon-killing-monks transcript starts');
  for (let step = 0; step < 20 && !ivan.chat; step++) p.manager.advance();
  assert.equal(ivan.chat, 'Nice job, Alice. Let\'s check upstairs.', 'the real battle Ivan speaks his captured overhead');
  h.tick(2);
  assert.ok(h.removed.includes(ivan), 'the battle actor is cleaned up after the overhead continuation');
  assert.equal(p.getArea(), null, 'the fight ends back in the ordinary temple');
  assert.equal(p.getPrivateArea(), null);
  assert.equal(BoatManager.syncArea(p), null);
  assert.equal(battleArea.isDestroyed(), true);
  assert.equal(battleArea.getObjects().length, 0, 'captured escape doors are removed with the scene');

  p.moveTo(new core.Location(3417, 3487, 1));
  h.emit('player:process', { player: p });
  assert.ok(h.npcs.some(npc => npc.id === N.IVAN_STROM_4 && npc.getLocation().getX() === 3417 &&
    npc.getLocation().getY() === 3487 && npc.getLocation().getZ() === 1),
  'the stage-36 Ivan is reachable on the temple first floor');
});

test('Paterdomus battle actors clean up on exit and restart as the full roster', () => {
  const h = harness(), p = player('Alice');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 30);
  const STORY = 'quest.the_blood_moon_rises.slepe-story';
  p.attrs.set(STORY, { manorComplete: true, monksRequested: true, monksBattleStarted: true });
  p.moveTo(new core.Location(3409, 3489, 0));
  h.emit('player:process', { player: p });
  const first = h.npcs.filter(npc => [15863, 16154, 16155, 16156].includes(npc.id));
  assert.equal(first.length, 7);
  const monks = first.filter(npc => npc.id !== 15863);
  h.emit('npc-death', { npc: monks[0], killer: p });
  h.emit('npc-death', { npc: monks[1], killer: p });
  assert.equal(p.attrs.get(STORY).monksCleared, undefined);
  assert.equal(p.attrs.get(STORY).monkKills, undefined, 'partial kills are not persisted');

  p.moveTo(new core.Location(3200, 3200, 0));
  h.emit('player:process', { player: p });
  for (const npc of first) if (![monks[0], monks[1]].includes(npc)) {
    assert.ok(h.removed.includes(npc), 'leaving the temple removes every surviving battle actor');
  }

  p.moveTo(new core.Location(3409, 3489, 0));
  h.emit('player:process', { player: p });
  const replay = h.npcs.filter(npc => [15863, 16154, 16155, 16156].includes(npc.id) && !first.includes(npc));
  assert.equal(replay.length, 7, 're-entry restarts the full captured roster');
  assert.equal(p.attrs.get(STORY).monksCleared, undefined);
  h.emit('player:logout', { player: p });
  for (const npc of replay) assert.ok(h.removed.includes(npc), 'logout removes every battle actor');
});

test('Paterdomus fight is reached through the captured side trapdoor, cellar ladder and front door', async () => {
  // Primary capture BloodMoonRisesP1: surface side trapdoor 3432 at 3422,3485 opens to
  // 3433 in place, Climb-down lands 3440,9887; later the cellar ladder 17385 at 3405,9907
  // Climb-up lands 3405,3506; the player opens the large front doors 3489/3490 before the
  // monk scene. The previous blockers searched from outside with every door still closed.
  const path = require('node:path');
  const fs = require('node:fs');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { Location } = require('../dist/game/model/Location');
  const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
  const { Sounds } = require('../dist/game/Sounds');
  const { Task } = require('../dist/game/task/Task');
  const { ObjectIdentifiers } = require('../dist/util/ObjectIdentifiers');
  const { Sound } = require('../dist/game/Sound');
  const { Animation } = require('../dist/game/model/Animation');
  const { DialogueChainBuilder } = require('../dist/game/model/dialogues/builders/DialogueChainBuilder');
  const { StatementDialogue } = require('../dist/game/model/dialogues/entries/impl/StatementDialogue');
  const { NpcDialogue } = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');

  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init();
  RegionManager.init();
  for (const [x, y] of [[3408, 3489], [3405, 9907]]) {
    RegionManager.loadMapFiles(x, y, true);
    assert.ok(RegionManager.getRegionid(RegionManager.regionIdForTile(x, y))?.isLoaded(),
      `real map region around ${x},${y} is loaded`);
  }
  const raw = (id, x, y, z = 0) => MapObjects.get(id, new Location(x, y, z), null);
  assert.equal(raw(3432, 3422, 3485)?.isMapOriginal?.(), true, 'cache places the side trapdoor 3432 at 3422,3485');
  assert.equal(raw(3489, 3408, 3489)?.isMapOriginal?.(), true, 'cache places the south front-door leaf 3489');
  assert.equal(raw(3490, 3408, 3488)?.isMapOriginal?.(), true, 'cache places the north front-door leaf 3490');

  const swaps = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../plugins/world/data/loc-swaps.json'), 'utf8')).swaps;
  assert.deepEqual(
    swaps.find((swap) => swap.id === 3432 && swap.op === 1 && swap.option === 'Open')?.becomes,
    3433, 'the side trapdoor is canonical Open-in-place data');
  const locs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../plugins/world/data/loc-teleports.json'), 'utf8')).locs;
  assert.deepEqual([locs.find((loc) => loc.id === 3433 && loc.x === 3422 && loc.y === 3485)?.to,
    locs.find((loc) => loc.id === 17385 && loc.x === 3405 && loc.y === 9907)?.to],
  [[3440, 9887, 0], [3405, 3506, 0]], 'the captured trapdoor and cellar-ladder landings are canonical');

  // Register the real generic doors and teleports exactly as the loader does (Doors first,
  // then LocTeleports). No clipping is cleared by hand: every change below comes from the
  // registered handlers through ObjectManager/MapObjects.
  const pending = [];
  const TaskManager = { submit: task => pending.push(task), cancelTasks: () => {} };
  const custom = new Map(), generic = [], named = new Map();
  const pluginApi = {
    core: { CacheDefinitions, GameObject, Location, MapObjects,
      Sounds, ObjectIdentifiers, ObjectDefinition, Sound, Task, TaskManager, Animation,
      DialogueChainBuilder, StatementDialogue, NpcDialogue, ObjectManager },
    getObjectManager: () => ObjectManager,
    getTaskManager: () => TaskManager,
    emitCustomEvent: (name, event) => { for (const fn of custom.get(name) ?? []) fn(event); },
    onCustomEvent: (name, fn) => { if (!custom.has(name)) custom.set(name, []); custom.get(name).push(fn); },
    onObjectInteraction: (target, actions) => {
      if (typeof target === 'function') { generic.push(target); return; }
      for (const [option, fn] of Object.entries(actions)) {
        const key = `${target}|${option}`;
        if (!named.has(key)) named.set(key, []);
        named.get(key).push(fn);
      }
    },
    onRegionLoaded: noop, onObjectRoute: noop, onServerStartup: noop, onPlayerProcess: noop,
    onItemOnObject: noop, persistAttribute: noop, registerArea: noop, sendMultiChatboxPrompt: () => true,
  };
  delete require.cache[require.resolve('../plugins/objects/Doors.plugin')];
  delete require.cache[require.resolve('../plugins/world/LocTeleports.plugin')];
  require('../plugins/objects/Doors.plugin').register(pluginApi);
  require('../plugins/world/LocTeleports.plugin').register(pluginApi);
  const tick = (count) => {
    while (count-- > 0) {
      const run = pending.splice(0);
      for (const task of run) {
        if (!task.stopped) task.execute();
        if (!task.stopped) pending.push(task);
      }
    }
  };
  const dispatch = (name, option, event) => {
    for (const fn of named.get(`${name}|${option}`) ?? []) {
      if (event.handled) break;
      if (fn(event) !== false) event.handled = true;
    }
    for (const fn of generic) if (!event.handled) fn(event);
    return event;
  };

  let position = new Location(3423, 3485, 0);
  const packets = { sendSound: noop, sendSoundEffect: noop, sendVarbit: noop, sendSubInterface: noop, closeSubInterface: noop };
  const player = {
    getUsername: () => 'QA7', isPlayerBot: () => false, getPrivateArea: () => null,
    getLocation: () => position, moveTo: (to) => { position = to; },
    getAttribute: () => undefined, setAttribute: noop,
    getPacketSender: () => packets,
    getMovementQueue: () => ({ isMovementBlocked: () => false, setBlockMovement() { return this; }, reset() { return this; } }),
    isRegistered: () => true, getHitpoints: () => 99, performAnimation: noop,
    getSkillManager: () => ({ getTotalLevel: () => 2000 }),
    getEquipment: () => ({ contains: () => true }), getInventory: () => ({ contains: () => true }),
    getDialogueManager: () => ({ startDialogues: noop }),
  };
  const click = (id, x, y, option, name, z = 0) => {
    const object = raw(id, x, y, z);
    assert.ok(object, `real map object ${id} at ${x},${y},${z}`);
    return dispatch(name, option, { player, object, objectId: id, clickType: 1, option,
      location: object.getLocation(), definition: { id, getName: () => name }, handled: false });
  };

  // 1. Side trapdoor opens in place, then Climb-down uses the captured landing.
  assert.equal(click(3432, 3422, 3485, 'Open', 'Trapdoor').handled, true);
  assert.equal(raw(3433, 3422, 3485)?.getId(), 3433, 'trapdoor 3433 replaces 3432 on the same tile');
  assert.equal(raw(3433, 3422, 3486), null, 'the open trapdoor is not swung into the tile north');
  assert.equal(click(3433, 3422, 3485, 'Climb-down', 'Trapdoor').handled, true);
  tick(2);
  assert.deepEqual([position.getX(), position.getY(), position.getZ()], [3440, 9887, 0],
    'Climb-down lands on the captured cellar tile');

  // 2. The cellar ladder emerges beside the temple front door.
  position = new Location(3405, 9907, 0);
  assert.equal(click(17385, 3405, 9907, 'Climb-up', 'Ladder').handled, true);
  tick(3);
  assert.deepEqual([position.getX(), position.getY(), position.getZ()], [3405, 3506, 0],
    'Climb-up lands on the captured surface tile at the front door');

  // 3. With the front doors still closed the monks inside are unreachable, exactly as the
  //    rejected BFS showed. Opening the real double door through its registered handler is
  //    what frees the doorway, not any manual clip removal.
  const route = new RsmodRouteFinding((x, y, z, area) => RegionManager.getClipping(x, y, z, area));
  const routeTo = (x, y) => route.findRoute({ level: 0, srcX: 3405, srcY: 3506, srcSize: 1,
    destX: x, destY: y, privateArea: null, moveNear: false });
  const monks = [[3418, 3491], [3415, 3486], [3414, 3490], [3409, 3488]];
  for (const [x, y] of monks) assert.equal(routeTo(x, y).success, false,
    `closed front door keeps ${x},${y} unreachable`);
  assert.notEqual(RegionManager.getClipping(3409, 3489, 0, null), 0, 'the closed leaf blocks entry');

  assert.equal(click(3489, 3408, 3489, 'Open', 'Large door').handled, true);
  assert.equal(raw(3491, 3409, 3489)?.getId(), 3491, 'south leaf swings east into open loc 3491');
  assert.equal(raw(3492, 3409, 3488)?.getId(), 3492, 'north leaf swings east into open loc 3492');
  assert.equal(RegionManager.getClipping(3408, 3489, 0, null), 0, 'the door handler clears the doorway tile');
  for (const [x, y] of monks) {
    const path = routeTo(x, y);
    assert.equal(path.success, true, `open front door gives an ordinary route to ${x},${y}`);
    assert.deepEqual([path.endX, path.endY], [x, y], 'RSMOD reaches the actual monk tile, not a nearer tile');
  }
  assert.ok(raw(61189, 3417, 3492), 'the captured spiral stairs remain in the ordinary temple');
  const toStairs = route.findRoute({ level: 0, srcX: 3409, srcY: 3489, srcSize: 1,
    destX: 3417, destY: 3491, privateArea: null, moveNear: false });
  assert.equal(toStairs.success, true, 'after the fight the stairs to Ivan are reachable by ordinary walking');
});

test('escaped Castle-labyrinth reverse route returns to the landing and keeps the 61208 stairs usable', () => {
  const fs = require('node:fs');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
  const STORY = 'quest.the_blood_moon_rises.slepe-story';
  const PROGRESS = 'the-blood-moon-rises:refinery-progress';

  // The normal reverse packet is canonical LocTeleports data: castle landing -> lab source.
  const locs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../plugins/world/data/loc-teleports.json'), 'utf8')).locs;
  const reverse = locs.find((loc) => loc.id === 61206 && loc.x === 3170 && loc.y === 7572 && loc.z === 0);
  assert.deepEqual(reverse?.to, [3182, 7469, 0], 'normal 61206 returns to the lab source');
  const labTunnel = locs.find((loc) => loc.id === 61201 && loc.x === 3168 && loc.y === 7456 && loc.z === 0);
  assert.deepEqual(labTunnel?.to, [3116, 7473, 2], 'normal 61201 remains the lab-side tunnel exit');

  let npcIndex = 50000;
  const spawnNpc = () => {
    const npc = { isPlayer: () => false, isNpc: () => true, getAsNpc() { return npc; },
      getIndex: () => ++npcIndex, getLocation: () => new core.Location(0, 0, 0),
      setScriptedMovement: noop, getMovementQueue: () => ({ setBlockMovement: noop }),
      getArea: () => null, setArea: noop, isRegistered: () => true };
    return npc;
  };
  const makeRefinery = () => {
    const api = { core, registerArea: noop, persistAttribute: noop, spawnNpc,
      onCustomEvent: noop, onNpcDialogueCondition: noop, onNpcInteraction: noop,
      onObjectInteraction: noop, onNpcDeath: noop, onNpcHitModify: noop, onPlayerLogin: noop };
    return require('../plugins/quests/bmr/Refinery.TheBloodMoonRises')(api, () => 30);
  };
  const entryEvent = (player, x, y, id = 61203, name = 'Entry', z = 0) => ({
    player, objectId: id,
    definition: { id: id === 61203 ? core.ObjectIdentifiers.ENTRY_27 : id, getName: () => name },
    location: { x, y, z }, option: 'Enter', handled: false,
  });

  const refinery = makeRefinery();
  const p1 = player('Recovery');
  p1.getCombat = () => ({ reset: noop });
  p1.attrs.set(STORY, { tombRouteStarted: true });
  p1.attrs.set(PROGRESS, { started: true, phase: 'escaped', killed: [0, 1, 2, 3, 4] });
  p1.moveTo(new core.Location(3182, 7469, 0));

  // Phase escaped: the lab Entry is the ordinary return to the Castle landing.
  const back = entryEvent(p1, 3182, 7470);
  assert.equal(refinery.tombPassage(back), true);
  assert.equal(back.handled, true);
  assert.deepEqual([p1.getLocation().getX(), p1.getLocation().getY(), p1.getLocation().getZ()], [3166, 7577, 0]);
  assert.equal(p1.attrs.get(PROGRESS).phase, 'escaped', 'the earned escape state is preserved');

  // From the tunnel, the same phase may re-enter the cleared lab and then use the Entry.
  const p2 = player('Recovery2');
  p2.getCombat = () => ({ reset: noop });
  p2.attrs.set(STORY, { tombRouteStarted: true });
  p2.attrs.set(PROGRESS, { started: true, phase: 'escaped', killed: [0, 1, 2, 3, 4] });
  p2.moveTo(new core.Location(3116, 7473, 2));
  const tunnelEvent = entryEvent(p2, 3117, 7472, 61197, 'Tunnel', 2);
  assert.equal(refinery.tombPassage(tunnelEvent), true, 'escaped tunnel Enter re-opens the cleared lab');
  assert.ok(p2.getLocation().getX() >= 8192, 'the normal tunnel packet enters the exact lab scene');
  const area = refinery.sessions.get(p2);
  assert.ok(area, 'the lab session is the same normal RefineryArea');
  const labExit = entryEvent(p2,
    area.getBaseX() + (3182 - 3136), area.getBaseY() + (7470 - 7424), 61203, 'Entry');
  assert.equal(refinery.tombPassage(labExit), true, 'lab Entry maps back to the landing source tile');
  assert.deepEqual([p2.getLocation().getX(), p2.getLocation().getY(), p2.getLocation().getZ()], [3166, 7577, 0]);

  // Other phases keep the old gates.
  const p3 = player('Recovery3');
  p3.getCombat = () => ({ reset: noop });
  p3.attrs.set(PROGRESS, { started: true, phase: 'route', killed: [] });
  p3.moveTo(new core.Location(3182, 7469, 0));
  assert.equal(refinery.tombPassage(entryEvent(p3, 3182, 7470)), false);
  assert.equal(refinery.tombPassage(entryEvent(p3, 3117, 7472, 61197, 'Tunnel', 2)), false);
  // The source-lab Tunnel 61201 is deliberately not claimed by the quest handler, so the
  // shipped LocTeleports entry above still carries an escaped player to the tunnel.
  assert.equal(refinery.tombPassage(entryEvent(p3, 3168, 7456, 61201, 'Tunnel')), false);

  // Real cache/region: the normal castle stairs from the landing are present and reachable.
  ObjectDefinition.init();
  RegionManager.init();
  RegionManager.loadMapFiles(3147, 7585, true);
  assert.equal(RegionManager.getRegionid(RegionManager.regionIdForTile(3147, 7585))?.isLoaded(), true);
  const stairs = MapObjects.get(61208, new core.Location(3147, 7585, 0), null);
  assert.ok(stairs, 'cache places the Castle Drakan dungeon stairs 61208 at 3147,7585');
  assert.equal(CacheDefinitions.getObject(61208)?.name, 'Stairs');
  assert.deepEqual(locs.find((loc) => loc.id === 61208 && loc.x === 3147 && loc.y === 7585)?.to, [3150, 7717, 0]);
  const route = new RsmodRouteFinding((x, y, z, area) => RegionManager.getClipping(x, y, z, area));
  const routePath = route.findRoute({ level: 0, srcX: 3166, srcY: 7577, srcSize: 1,
    destX: 3147, destY: 7584, privateArea: null, moveNear: false });
  assert.equal(routePath.success, true, 'the landing connects by ordinary walking to the stairs');
});

test('Vanescula cracked wall 61611 burns once and opens the Venator/third-emblem path', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const STORY = 'quest.the_blood_moon_rises.castle-story';
  const ROOM = 'quest.the_blood_moon_rises.castle-room';
  const FLOOR = 'quest.the_blood_moon_rises.castle-floor';
  const NATIVE = 'quest.the_blood_moon_rises.castle-native-stage';

  const wall = CacheDefinitions.getObject(61611);
  assert.equal(wall.transformVarbit, 15511);
  assert.deepEqual(wall.transforms, [61613, 61614], '61611 is the cached cracked-wall transform parent');
  assert.equal(CacheDefinitions.getObject(61613).actions[0], 'Inspect');
  assert.equal(CacheDefinitions.getObject(61614).actions[0], 'Enter');
  const definitionAt = (value) => ObjectDefinition.forPlayer(61611, {
    getPacketSender: () => ({ getVarbit: (id) => id === 15511 ? value : 0, getVarp: () => 0 }),
  });
  assert.equal(definitionAt(0).id, 61613, 'unblown state resolves to the cracked wall');
  assert.equal(definitionAt(1).id, 61614, 'blown state resolves to the hole in the wall');

  RegionManager.init();
  RegionManager.loadMapFiles(2492, 7364, true);
  assert.equal(RegionManager.getRegionid(RegionManager.regionIdForTile(2487, 7421))?.isLoaded(), true);
  assert.equal(RegionManager.getClipping(2487, 7421, 0, null) & RegionManager.BLOCKED_TILE, 0,
    'the Venator-room landing is walkable');
  assert.ok(MapObjects.get(61637, new core.Location(2486, 7421, 0), null), 'third-emblem receptacle is in cache');

  const h = harness(), p = player('Wall');
  h.quest.setStage(p, 40);
  p.attrs.set(NATIVE, 72);
  p.attrs.set(ROOM, 24);
  p.attrs.set(FLOOR, 2);
  p.attrs.set(STORY, { defeated: [] });
  p.getInventory().adds(I.EXPLOSIVE_BARREL, 2);
  p.getInventory().adds(I.TINDERBOX, 1);

  const wallHandler = h.objectHooks.find(fn => fn.name === 'handleCastleVanesculaWall');
  const itemHandler = h.itemOnObject.find(fn => fn.name === 'handleCastleVanesculaWallItem');
  const thirdHandler = h.objectHooks.find(fn => fn.name === 'handleCastleThirdEmblemReceptacle');
  assert.ok(wallHandler && itemHandler && thirdHandler);

  const objectEvent = (option, objectId = 61611, definitionId = 61613, x = 2492, y = 7364) => ({
    player: p, objectId, definition: { id: definitionId, getName: () => 'Cracked wall' },
    location: { x, y, z: 0 }, option, handled: false,
  });
  const inspect = objectEvent('Inspect');
  wallHandler(inspect);
  assert.equal(inspect.handled, true);
  assert.ok(p.messages.some(message => message.includes('cracked')), 'cracked wall inspection is informative');
  assert.equal(p.getInventory().getAmount(I.EXPLOSIVE_BARREL), 2, 'inspection consumes nothing');
  const otherWall = objectEvent('Inspect', 61612, 61612, 2482, 7412);
  assert.equal(wallHandler(otherWall), undefined);
  assert.equal(otherWall.handled, false, 'the separate 61612 return wall is not claimed by this handler');

  const use = { player: p, objectId: 61611, definition: { id: 61613, getName: () => 'Cracked wall' },
    location: { x: 2492, y: 7364, z: 0 }, itemId: I.EXPLOSIVE_BARREL, handled: false };
  itemHandler(use);
  assert.equal(use.handled, true);
  assert.equal(p.getInventory().getAmount(I.EXPLOSIVE_BARREL), 1, 'one explosive barrel is consumed');
  assert.equal(p.getInventory().getAmount(I.TINDERBOX), 1, 'the tinderbox is not consumed');
  assert.equal(p.varbits.get(15511), 1);
  assert.equal(p.attrs.get(STORY).vanesculaWallBlown, true);

  const secondUse = { ...use, handled: false };
  itemHandler(secondUse);
  assert.equal(secondUse.handled, true);
  assert.equal(p.getInventory().getAmount(I.EXPLOSIVE_BARREL), 1, 'a second barrel is not consumed once open');
  assert.ok(p.messages.some(message => message.includes('already broken')), 'duplicate use is refused');

  const enter = objectEvent('Enter', 61611, 61614);
  wallHandler(enter);
  assert.equal(enter.handled, true);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [2487, 7421, 0]);
  assert.equal(p.attrs.get(ROOM), 37);
  assert.equal(p.attrs.get(FLOOR), 2);
  const venator = h.npcs.find(npc => npc.id === 16213);
  assert.ok(venator, 'the crescent Venator spawns in the opened room');
  assert.equal(venator.getOwner(), p);

  const receptacle = { player: p, objectId: 61637,
    definition: { id: 61637, getName: () => 'Receptacle' }, location: { x: 2486, y: 7421, z: 0 },
    option: 'Remove-emblem', handled: false };
  thirdHandler(receptacle);
  assert.equal(receptacle.handled, true);
  assert.equal(p.getInventory().contains(I.DRAKAN_EMBLEM_3), false, 'the living Venator still guards the emblem');
  assert.ok(p.messages.some(message => message.includes('still guards')));

  h.emit('npc-death', { npc: venator, killer: p });
  const take = { ...receptacle, handled: false };
  thirdHandler(take);
  assert.equal(take.handled, true);
  assert.equal(p.getInventory().contains(I.DRAKAN_EMBLEM_3), true, 'the third emblem is earned after the real Venator death');
  assert.equal(p.attrs.get(STORY).thirdEmblemClaimed, true);
});

test('native 128 raw theatre parents resolve and native 140 spawns the captured Veliaf/Ivan', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const sender = value => ({ getVarbit: id => id === 15464 ? value : 0, getVarp: () => 0 });
  assert.equal(CacheDefinitions.resolveNpc(15872, sender(128))?.id, 15878,
    'raw 15872 resolves to the named Veliaf at native 128');
  assert.equal(CacheDefinitions.resolveNpc(15955, sender(128))?.id, 15960,
    'raw 15955 resolves to the named Sugadinti at native 128');
  assert.equal(CacheDefinitions.resolveNpc(15956, sender(132))?.id, 15962,
    'raw 15956 resolves to the named Sugadinti at the theatre entrance');
  assert.equal(CacheDefinitions.resolveNpc(15872, sender(128))?.name, 'Veliaf Hurtz');
  assert.equal(CacheDefinitions.resolveNpc(15955, sender(128))?.name, 'Sugadinti Vitur');

  const h = harness(), p = player('Theatre140');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 80);
  p.attrs.set('quest.the_blood_moon_rises.theatre-native-stage', 140);
  h.emit('quest:stage-changed', { player: p });
  const actors = h.npcs.filter(npc => [15874, 15851].includes(npc.id))
    .map(npc => [npc.id, npc.getLocation().getX(), npc.getLocation().getY()]).sort();
  assert.deepEqual(actors, [[15851, 3541, 3260], [15874, 3541, 3257]],
    'captured raw parents outside the old lab');
  assert.equal(CacheDefinitions.resolveNpc(15874, sender(140))?.id, 15878);
  assert.equal(CacheDefinitions.resolveNpc(15851, sender(140))?.id, 15855);

  const talk = h.npcInteractions.get('Veliaf Hurtz')['Talk-to'];
  assert.ok(talk({ player: p, npcId: 15874, definition: { getName: () => 'Veliaf Hurtz' } }));
  assert.equal(p.varbits.get(15464), 142);
  assert.ok(p.manager.getCurrent(), 'canonical fighting-wyrds conversation starts');
});

test('Wyrd 10% story starts on a real HP jump, survives a cancelled chatbox, and completes the scene', () => {
  const h = harness(), p = player('WyrdTen');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 90);
  h.emit('npc-dialogue:action', { player: p, stepId: '4G5OZg', kind: 'action' });
  const boss = h.npcs.find(npc => npc.id === core.NpcIdentifiers.WYRD_8);
  assert.ok(boss, 'the Wyrd spawns');
  boss.getMaxHitpoints = () => 1100;
  const activate = { player: p, text: 'Then stay... Stay and die!', step: { speaker: 'Wyrd' },
    pages: [{ page: 'The Blood Moon Rises', variants: ['fighting-wyrds'] }] };
  h.emit('npc-dialogue:line', activate);
  activate.after();
  const area = p.getPrivateArea();
  const originalCycle = h.api.core.World.getProcessCycle;
  let cycle = 1000;
  h.api.core.World.getProcessCycle = () => ++cycle;
  try {
    boss.setHitpoints(0);
    h.emit('npc-before-death', { npc: boss, killer: p });
    assert.equal(boss.getHitpoints(), 110, 'a lethal hit is held at the 10% story threshold');
    assert.equal(p.manager.getCurrent()?.getText?.(), 'Argh!', 'the real 10% transcript starts');
    assert.equal(p.movementBlocked, true, 'the mandatory story locks movement');

    p.manager.reset();
    area.process(boss);
    assert.equal(p.manager.getCurrent()?.getText?.(), 'Argh!', 'a cancelled chatbox reopens the 10% story');
    assert.equal(p.movementBlocked, true, 'the retry keeps movement locked');

    let guard = 200;
    while (p.manager.isActive() && guard-- > 0) p.manager.advance();
    assert.equal(h.quest.getStage(p), 95, 'the real scene action completes the Wyrd chapter');
    assert.equal(p.varbits.get(15464), 148, 'native 148 is reached');
    assert.equal(p.attrs.get('quest.the_blood_moon_rises.wyrd-defeated'), true);
    assert.equal(p.movementBlocked, false, 'movement is restored after the scene');
  } finally {
    h.api.core.World.getProcessCycle = originalCycle;
  }
});

test('Wyrd normal 80/50/10 story thresholds play in order without duplicates', () => {
  const h = harness(), p = player('WyrdNormal');
  p.getLocalNpcs = () => h.npcs;
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 90);
  h.emit('npc-dialogue:action', { player: p, stepId: '4G5OZg', kind: 'action' });
  const boss = h.npcs.find(npc => npc.id === core.NpcIdentifiers.WYRD_8);
  boss.getMaxHitpoints = () => 1100;
  const activate = { player: p, text: 'Then stay... Stay and die!', step: { speaker: 'Wyrd' },
    pages: [{ page: 'The Blood Moon Rises', variants: ['fighting-wyrds'] }] };
  h.emit('npc-dialogue:line', activate);
  activate.after();
  const area = p.getPrivateArea();
  const originalCycle = h.api.core.World.getProcessCycle;
  let cycle = 2000;
  h.api.core.World.getProcessCycle = () => ++cycle;
  const finish = () => { let guard = 100; while (p.manager.isActive() && guard-- > 0) { h.tick(2); p.manager.advance(); } };
  try {
    boss.setHitpoints(880);
    area.process(boss);
    h.tick(2);
    assert.ok(boss.chat?.includes('Leave!'), 'the captured 80% overhead line plays');
    finish();
    assert.equal(p.manager.isActive(), false, 'the 80% conversation completes once');

    boss.setHitpoints(550);
    area.process(boss);
    h.tick(2);
    assert.ok(boss.chat?.includes('Hunger!'), 'the captured 50% overhead line plays');
    finish();

    boss.setHitpoints(110);
    area.process(boss);
    assert.equal(p.manager.getCurrent()?.getText?.(), 'Argh!', 'the captured 10% line plays');
    finish();
    assert.equal(h.quest.getStage(p), 95, 'the normal threshold route also completes the scene');
    assert.equal(p.varbits.get(15464), 148);
    assert.equal(p.movementBlocked, false);
  } finally {
    h.api.core.World.getProcessCycle = originalCycle;
  }
});

test('Ivan 158 real Talk-to transcript reaches native 160 then 164 through its actual lines', () => {
  const h = harness(), p = player('Ivan158');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 158);
  p.moveTo(new core.Location(2846, 7391, 0));
  const talk = h.npcInteractions.get('Ivan Strom')['Talk-to'];
  const event = { player: p, npc: { getId: () => 15855 }, npcId: 15855,
    definition: { getName: () => 'Ivan Strom' }, handled: false };
  assert.equal(talk(event), true, 'the real Ivan Talk-to transcript starts');
  assert.ok(p.manager.getCurrent(), 'the captured Ivan conversation is on screen');

  let guard = 300;
  while (h.quest.getStage(p) !== 100 && guard-- > 0) {
    const current = p.manager.getCurrent();
    assert.ok(current, 'the real transcript ended before the final chapter');
    p.manager.advance();
  }
  assert.equal(h.quest.getStage(p), 100, 'the full normal conversation advances to the final chapter');
  assert.equal(Number(p.attrs.get('quest.the_blood_moon_rises.final-native-stage')), 164,
    'the Sugadinti handoff crosses 158 -> 160 -> 164');
  assert.equal(p.varbits.get(15464), 164, 'native 164 is published');
});

test('gathering threshold spawns Ivan then Sugadinti and both reach the same canon', () => {
  const h = harness(), p = player('GatherEnd');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 156);
  startTranscript(h, p, 0, 'night-of-the-blood-moon-upon-lowerniel-reaching-30-hp');
  continueUntil(p, () => p.manager.getCurrent()?.getText?.()?.startsWith("Efaritay's right!"));
  assert.equal(Number(p.attrs.get('quest.the_blood_moon_rises.final-native-stage')), 156,
    'gaf5Xw does not skip the conversation');
  assert.notEqual(p.getLocation().getX(), 2846);
  continueUntil(p, () => p.varbits.get(15464) === 158, 300);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2846, 7391]);
  const ivan = h.npcs.find(npc => npc.id === 15852);
  assert.ok(ivan, 'raw Ivan parent spawns at the castle');
  assert.deepEqual([ivan.getLocation().getX(), ivan.getLocation().getY()], [2845, 7387]);
  h.emit('player:logout', { player: p });
  assert.ok(h.removed.includes(ivan), 'logout removes the castle Ivan');
  h.emit('player:login', { player: p });
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2846, 7391],
    'a 158 relog stays at the captured castle landing');
  assert.ok(h.npcs.some(npc => npc.id === 15852 && !h.removed.includes(npc)),
    'the login sync restores castle Ivan');
  const line = { player: p,
    text: "My children, I'm sorry for rushing you inside. Time was of the essence in gaining control of the vampyres. However, I have promising news. It seems that for now at least, most are willing to accept me as their ruler.",
    pages: [{ page: 'The Blood Moon Rises', variants: ['night-of-the-blood-moon-talking-to-ivan'] }],
    step: { speaker: 'Sugadinti Vitur' } };
  h.emit('npc-dialogue:line', line);
  line.after?.();
  assert.equal(p.varbits.get(15464), 160);
  const sugadinti = h.npcs.find(npc => npc.id === 15957);
  assert.ok(sugadinti, 'raw Sugadinti parent spawns during native 160');
  assert.deepEqual([sugadinti.getLocation().getX(), sugadinti.getLocation().getY()], [2846, 7389]);
  const sugadintiTalk = h.npcInteractions.get('Sugadinti Vitur')['Talk-to'];
  assert.ok(sugadintiTalk({ player: p, npcId: 15957, definition: { getName: () => 'Sugadinti Vitur' } }));
  assert.ok(p.manager.getCurrent(), 'Sugadinti routes to the canonical talking-to-ivan transcript');
  h.emit('player:logout', { player: p });
  assert.ok(h.removed.includes(sugadinti), 'logout removes castle Sugadinti');
  h.emit('player:login', { player: p });
  assert.ok(h.npcs.some(npc => npc.id === 15957 && !h.removed.includes(npc)),
    'login restores castle Sugadinti at native 160');
});

test('supply chest opens the cache-owned vampyrium omnishop repeatedly, with no auto grant', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const base = CacheDefinitions.getObject(61764);
  assert.equal(base.transformVarbit, 15464);
  assert.equal(base.transforms[168], 61765, 'base chest resolves to the Search/Take/Deposit child');
  assert.deepEqual(CacheDefinitions.getObject(61765).actions.slice(0, 3),
    ['Search', 'Take-supplies', 'Deposit']);
  assert.equal(CacheDefinitions.getDbRowName(16873), 'vampyrium_consumable_shop');
  assert.ok(CacheDefinitions.getDbRow(16873), 'cache owns the vampyrium shop row');

  const h = harness(), p = player('Supplies');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 100);
  p.getInventory().adds(I.HALLOWED_FLAIL, 1);
  const opens = [], deposits = [];
  h.api.onCustomEvent('omnishop:open', event => opens.push(event));
  h.api.onCustomEvent('bank:open-deposit-box', event => deposits.push(event));
  const chest = h.objectHooks.find(fn => fn.name === 'handleFinalDrakanSupplyChest');
  const roof = h.objectHooks.find(fn => fn.name === 'handleFinalDrakanRoofDoor');
  assert.ok(chest && roof, 'named supply/roof handlers are registered');

  const search = { player: p, objectId: 61764, definition: { id: 61764, getName: () => 'Chest' },
    location: { x: 2503, y: 7386, z: 0 }, option: 'Search', handled: false };
  assert.equal(chest(search), true);
  assert.equal(search.handled, true);
  assert.equal(p.varbits.get(15480), 1, 'captured supply warning bit is set on Search');
  continueUntil(p, () => Boolean(p.prompt));
  assert.deepEqual(p.prompt.options, ['Take some supplies.', 'Deposit some items.']);
  choose(p, 'Take some supplies.');
  assert.equal(opens.length, 1, 'Take some supplies opens the real omnishop');
  assert.equal(opens[0].shop, 16873);
  assert.equal(p.attrs.get('quest.the_blood_moon_rises.final-drakan-supplies'), true);
  assert.equal(p.getInventory().getAmount(I.JAR_OF_CONGEALED_BLOOD), 0, 'no items are auto-granted');

  const explicit = { ...search, option: 'Take-supplies', handled: false };
  assert.equal(chest(explicit), true);
  assert.equal(opens.length, 2, 'explicit Take-supplies opens the same shop');
  assert.equal(opens[1].shop, 16873);
  const again = { ...explicit, handled: false };
  chest(again);
  assert.equal(opens.length, 3, 'resupplying after losing supplies is always allowed');
  assert.equal(p.getInventory().getAmount(I.JAR_OF_CONGEALED_BLOOD), 0, 'repeat open adds nothing');

  chest(search);
  continueUntil(p, () => Boolean(p.prompt));
  choose(p, 'Deposit some items.');
  assert.equal(deposits.length, 1, 'Deposit uses the existing deposit-box API');

  const enter = { player: p, objectId: 61628, definition: { id: 61628, getName: () => 'Door' },
    location: { x: 2506, y: 7387, z: 0 }, option: 'Enter', handled: false };
  assert.equal(roof(enter), true);
  continueUntil(p, () => h.npcs.some(npc => npc.id === N.LOWERNIEL_DRAKAN_17), 400);
  assert.ok(h.npcs.some(npc => npc.id === N.LOWERNIEL_DRAKAN_17), 'normal choice reaches the roof encounter');
});

test('siege fall-back login resumes the real 118 conversation and vqg4qO opens the hall', () => {
  const h = harness(), p = player('Fallback');
  enablePrereqs(h, new Set(PREREQS));
  const SIEGE = 'quest.the_blood_moon_rises.siege-defence';
  h.quest.setStage(p, 70);
  p.attrs.set(SIEGE, { phase: 'fall-back', integrity: 0, qualified: true });
  p.varbits.set(15464, 118);
  h.emit('player:login', { player: p });
  assert.equal(h.quest.getStage(p), 70);
  assert.equal(p.varbits.get(15464), 118, 'login does not skip to 120');
  assert.equal(p.attrs.get(SIEGE).phase, 'fall-back');
  assert.ok(p.manager.getCurrent(), 'canonical fall-back transcript started');
  continueUntil(p, () => p.attrs.get(SIEGE)?.phase === 'hall', 100);
  assert.equal(p.varbits.get(15464), 120);
  assert.equal(p.attrs.get(SIEGE).integrity, 650, 'captured hall maximum');
  assert.equal(p.attrs.get(SIEGE).timer, 300, 'captured siege timer');
  assert.equal(h.quest.getStage(p), 70);
  h.emit('npc-dialogue:action', { player: p, stepId: 'vqg4qO', kind: 'action' });
  assert.equal(p.attrs.get(SIEGE).phase, 'hall', 'repeat completion does not reset the hall');
  assert.equal(p.attrs.get(SIEGE).integrity, 650);
});

test('hall ticks the measured per-source loss, publishes 9674, and fails back to 650', () => {
  const h = harness(), p = player('HallTicks');
  enablePrereqs(h, new Set(PREREQS));
  const SIEGE = 'quest.the_blood_moon_rises.siege-defence';
  h.quest.setStage(p, 70);
  p.attrs.set(SIEGE, { phase: 'hall', integrity: 100, participation: 2, repaired: ['3176,7858'] });
  p.varbits.set(15464, 120);
  h.emit('player:login', { player: p });
  const area = p.getPrivateArea();
  assert.ok(area, 'login enters the private hall area');
  assert.equal(p.attrs.get(SIEGE).integrity, 650, 'legacy 0-100 save migrates to the captured maximum');
  assert.equal(p.attrs.get(SIEGE).timer, 300);
  assert.equal(p.attrs.get(SIEGE).repaired, undefined, 'legacy permanent repair list is dropped');
  assert.ok(p.packets.interfaces.some(([uid, group]) => uid === ((161 << 16) | 8) && group === 968),
    'the captured integrity overlay opens');
  assert.deepEqual(p.packets.scripts.find(([id]) => id === 9674),
    [9674, 650, 650, 300, 300], 'current/max/timer/max timer');

  for (let tick = 0; tick < 14; tick++) area.process(p);
  assert.ok(p.attrs.get(SIEGE).damaged['3176,7858'], 'a window is damaged');
  assert.equal(p.attrs.get(SIEGE).integrity, 650, 'damaged windows cost no integrity');

  for (let tick = 0; tick < 14; tick++) area.process(p);
  assert.ok(p.attrs.get(SIEGE).damaged['3174,7855'], 'a pillar is damaged');
  assert.equal(p.attrs.get(SIEGE).integrity, 648, 'one damaged pillar costs 2 per tick');

  for (let tick = 0; tick < 15; tick++) area.process(p);
  assert.deepEqual(p.attrs.get(SIEGE).injured, { 0: true }, 'an Aranei falls');
  assert.equal(p.attrs.get(SIEGE).integrity, 617, 'one pillar plus one injured Aranei costs 3 per tick');
  assert.deepEqual(p.packets.scripts.filter(([id]) => id === 9674).at(-1),
    [9674, 617, 650, 257, 300], 'every fault republishes the real values');

  p.attrs.set(SIEGE, { ...p.attrs.get(SIEGE), integrity: 1, timer: 200 });
  area.process(p);
  assert.equal(p.attrs.get(SIEGE).integrity, 650, 'a breach before the timer fails to a fresh defence');
  assert.equal(p.attrs.get(SIEGE).timer, 300);
  assert.ok(p.messages.includes('You failed to defend the hideout!'));
  assert.equal(h.quest.getStage(p), 70, 'failure keeps the siege chapter for a retry');

  const qualified = player('HallQualified');
  h.quest.setStage(qualified, 70);
  qualified.attrs.set(SIEGE, { phase: 'hall', integrity: 40, qualified: true, participation: 4 });
  h.emit('player:login', { player: qualified });
  assert.equal(qualified.attrs.get(SIEGE).timer, 0,
    'a qualified 20-minute legacy defence has already passed the 300-tick story timer');
  assert.equal(qualified.attrs.get(SIEGE).integrity, 260, 'legacy integrity scales proportionally');
  assert.equal(qualified.attrs.get(SIEGE).qualified, undefined, 'old gate state is dropped');
});

test('hall repairs always need a hammer, never add integrity, and repeat after re-damage', () => {
  const h = harness(), p = player('HallRepair');
  enablePrereqs(h, new Set(PREREQS));
  const SIEGE = 'quest.the_blood_moon_rises.siege-defence';
  h.quest.setStage(p, 70);
  p.attrs.set(SIEGE, { version: 1, phase: 'hall', integrity: 500, timer: 250, elapsed: 100,
    damaged: { '3174,7855': true }, injured: {}, nextPillarTick: 200, nextWindowTick: 200,
    nextAraneiTick: 200 });
  p.varbits.set(15464, 120);
  h.emit('player:login', { player: p });
  const area = p.getPrivateArea();
  const repair = h.objectHooks.find(fn => fn.name === 'handleSiegeHallObject');
  const pillar = { player: p, objectId: 62155, definition: { id: 62155 },
    location: { x: 3174, y: 7855, z: 1 },
    object: { getPrivateArea: () => area, getLocation: () => new core.Location(3174, 7855, 1),
      getType: () => 10, getFace: () => 0 } };
  repair(pillar);
  assert.ok(p.attrs.get(SIEGE).damaged['3174,7855'], 'a damaged pillar still needs a hammer');
  assert.ok(p.messages.some(line => line.includes('need a hammer')));
  p.getInventory().adds(I.HAMMER, 1);
  repair(pillar);
  assert.deepEqual(p.attrs.get(SIEGE).damaged, {}, 'repair clears the pillar source');
  assert.equal(p.attrs.get(SIEGE).integrity, 500, 'repair does not restore integrity');

  p.attrs.set(SIEGE, { ...p.attrs.get(SIEGE), nextPillarTick: 101 });
  area.process(p);
  assert.ok(p.attrs.get(SIEGE).damaged['3174,7855'], 'the pillar is damaged again');
  repair(pillar);
  assert.deepEqual(p.attrs.get(SIEGE).damaged, {}, 'the same pillar can be repaired again');

  p.attrs.set(SIEGE, { ...p.attrs.get(SIEGE), damaged: { '3176,7858': true } });
  const window = { ...pillar, objectId: 62158, definition: { id: 62158 },
    location: { x: 3176, y: 7858, z: 1 } };
  repair(window);
  assert.deepEqual(p.attrs.get(SIEGE).damaged, {}, 'window repair clears its cosmetic damage');
  assert.ok(p.attrs.get(SIEGE).repaired === undefined, 'no permanent repaired list');
});

test('hall scheduled damage registers the real damaged loc and repair swaps it back', () => {
  const h = harness({ realObjects: true }), p = player('HallScene');
  enablePrereqs(h, new Set(PREREQS));
  const SIEGE = 'quest.the_blood_moon_rises.siege-defence';
  h.quest.setStage(p, 70);
  p.attrs.set(SIEGE, { version: 1, phase: 'hall', integrity: 650, timer: 300, elapsed: 0,
    damaged: {}, injured: {}, nextPillarTick: 1, nextWindowTick: 1, nextAraneiTick: 100 });
  p.varbits.set(15464, 120);
  h.emit('player:login', { player: p });
  const area = p.getPrivateArea();
  const at = (x, y) => core.ObjectManager.objectsAt(new core.Location(x, y, 1))
    .filter(object => object.getPrivateArea() === area);
  assert.equal(at(3174, 7855)[0].getId(), 62154, 'the private hall starts with the intact pillar');
  assert.equal(at(3176, 7858)[0].getId(), 62157, 'the private hall starts with the intact window');
  assert.deepEqual([62160, 3173, 7847, 10, 1], [at(3173, 7847)[0].getId(),
    at(3173, 7847)[0].getLocation().getX(), at(3173, 7847)[0].getLocation().getY(),
    at(3173, 7847)[0].getType(), at(3173, 7847)[0].getFace()], 'captured north hammer crate');
  assert.deepEqual([62160, 3162, 7849, 10, 0], [at(3162, 7849)[0].getId(),
    at(3162, 7849)[0].getLocation().getX(), at(3162, 7849)[0].getLocation().getY(),
    at(3162, 7849)[0].getType(), at(3162, 7849)[0].getFace()], 'captured west hammer crate');
  assert.deepEqual([62161, 3174, 7848, 11, 0], [at(3174, 7848)[0].getId(),
    at(3174, 7848)[0].getLocation().getX(), at(3174, 7848)[0].getLocation().getY(),
    at(3174, 7848)[0].getType(), at(3174, 7848)[0].getFace()], 'captured north potion crate');
  assert.deepEqual([62161, 3163, 7847, 11, 3], [at(3163, 7847)[0].getId(),
    at(3163, 7847)[0].getLocation().getX(), at(3163, 7847)[0].getLocation().getY(),
    at(3163, 7847)[0].getType(), at(3163, 7847)[0].getFace()], 'captured west potion crate');
  assert.deepEqual([62164, 3167, 7844, 10, 2], [at(3167, 7844)[0].getId(),
    at(3167, 7844)[0].getLocation().getX(), at(3167, 7844)[0].getLocation().getY(),
    at(3167, 7844)[0].getType(), at(3167, 7844)[0].getFace()], 'captured barricade');
  for (const [x, y] of [[3176, 7858], [3172, 7858], [3174, 7858], [3160, 7858], [3162, 7858], [3164, 7858]]) {
    assert.deepEqual([62157, 0, 3], [at(x, y)[0].getId(), at(x, y)[0].getType(),
      at(x, y)[0].getFace()], `captured window at ${x},${y}`);
  }

  area.process(p);
  assert.equal(at(3174, 7855).length, 1, 'refresh leaves one private pillar, no orphan');
  assert.equal(at(3174, 7855)[0].getId(), 62155, 'scheduled damage is the registered damaged pillar');
  assert.equal(at(3176, 7858)[0].getId(), 62158, 'scheduled damage is the registered damaged window');

  p.getInventory().adds(I.HAMMER, 1);
  const repair = h.objectHooks.find(fn => fn.name === 'handleSiegeHallObject');
  const pillar = at(3174, 7855)[0];
  repair({ player: p, objectId: pillar.getId(), definition: { id: pillar.getId() },
    location: { x: 3174, y: 7855, z: 1 }, object: pillar });
  assert.equal(at(3174, 7855).length, 1);
  assert.equal(at(3174, 7855)[0].getId(), 62154, 'Repair swaps the real object back to intact');
  const window = at(3176, 7858)[0];
  repair({ player: p, objectId: window.getId(), definition: { id: window.getId() },
    location: { x: 3176, y: 7858, z: 1 }, object: window });
  assert.equal(at(3176, 7858)[0].getId(), 62157, 'window Repair also swaps the real object');

  p.attrs.set(SIEGE, { ...p.attrs.get(SIEGE), nextPillarTick: 2, nextWindowTick: 2 });
  area.process(p);
  assert.equal(at(3174, 7855)[0].getId(), 62155, 're-damage registers the damaged pillar again');
  assert.equal(at(3176, 7858)[0].getId(), 62158, 're-damage registers the damaged window again');

  area.leave(p, true);
  assert.equal(at(3174, 7855).length, 0, 'logout removes every private hall object');
  for (const object of h.objects) core.ObjectManager.deregister(object, false);
});

test('hall crates take one item, refuse duplicates, and only report success when the item fits', () => {
  const h = harness({ realObjects: true }), p = player('HallCrates');
  enablePrereqs(h, new Set(PREREQS));
  const SIEGE = 'quest.the_blood_moon_rises.siege-defence';
  h.quest.setStage(p, 70);
  p.attrs.set(SIEGE, { version: 1, phase: 'hall', integrity: 650, timer: 300, elapsed: 0,
    damaged: {}, injured: {}, nextPillarTick: 100, nextWindowTick: 100, nextAraneiTick: 100 });
  p.varbits.set(15464, 120);
  h.emit('player:login', { player: p });
  const area = p.getPrivateArea();
  const at = (x, y) => core.ObjectManager.objectsAt(new core.Location(x, y, 1))
    .filter(object => object.getPrivateArea() === area)[0];
  const crate = h.objectHooks.find(fn => fn.name === 'handleSiegeHallObject');
  const take = (object, handled = false) => crate({ player: p, objectId: object.getId(),
    definition: { id: object.getId() }, location: { x: object.getLocation().getX(),
      y: object.getLocation().getY(), z: 1 }, object, handled });
  take(at(3173, 7847));
  assert.equal(p.getInventory().getAmount(I.HAMMER), 1, 'the captured hammer crate gives a hammer');
  take(at(3162, 7849));
  assert.equal(p.getInventory().getAmount(I.HAMMER), 1, 'a second crate gives no duplicate hammer');
  assert.ok(p.messages.some(line => line.includes('already have a hammer')));
  take(at(3174, 7848));
  assert.equal(p.getInventory().getAmount(I.HEALING_POTION), 1, 'the captured potion crate gives one potion');

  p.getInventory().deleteNumber(I.HAMMER, 1);
  const inv = p.getInventory();
  const adds = inv.adds;
  inv.adds = () => inv;
  take(at(3173, 7847));
  inv.adds = adds;
  assert.equal(inv.getAmount(I.HAMMER), 0, 'a full inventory gains no hammer');
  assert.ok(p.messages.some(line => line.includes('no room in your inventory')));
  assert.ok(!p.messages.some(line => line.includes('You take a hammer') && line.includes('no room')));

  area.leave(p, true);
  for (const object of h.objects) core.ObjectManager.deregister(object, false);
});

test('hall maintains six Aranei and heals are repeatable after re-injury', () => {
  const h = harness(), p = player('HallHeal');
  enablePrereqs(h, new Set(PREREQS));
  const SIEGE = 'quest.the_blood_moon_rises.siege-defence';
  h.quest.setStage(p, 70);
  p.attrs.set(SIEGE, { version: 1, phase: 'hall', integrity: 500, timer: 250, elapsed: 100,
    damaged: {}, injured: { 0: true }, nextPillarTick: 200, nextWindowTick: 200,
    nextAraneiTick: 200 });
  p.varbits.set(15464, 120);
  h.emit('player:login', { player: p });
  const area = p.getPrivateArea();
  const aranei = h.npcs.filter(npc => [16256, 16257, 16258, 16259, 16260, 16261,
    16262, 16263, 16264, 16265, 16266, 16267].includes(npc.id));
  assert.equal(aranei.length, 6, 'all six hall Aranei are spawned');
  const heal = h.npcInteractions.get('Aranei').Heal;
  const injured = h.npcs.find(npc => npc.id === 16262 && npc.getOwner() === p);
  assert.ok(injured, 'the captured injured Aranei is present');
  p.getInventory().adds(I.HEALING_POTION, 2);
  heal({ player: p, npc: injured, npcId: 16262, handled: false });
  assert.deepEqual(p.attrs.get(SIEGE).injured, {}, 'healing removes one injured source');
  assert.equal(p.attrs.get(SIEGE).integrity, 500, 'healing does not add integrity');
  assert.ok(!h.removed.includes(injured), 'the cured Aranei stays in the hall');

  p.attrs.set(SIEGE, { ...p.attrs.get(SIEGE), injured: {}, nextAraneiTick: 101 });
  area.process(p);
  assert.deepEqual(p.attrs.get(SIEGE).injured, { 0: true }, 'the cadence can injure an Aranei again');
  heal({ player: p, npc: injured, npcId: 16262, handled: false });
  assert.deepEqual(p.attrs.get(SIEGE).injured, {}, 'the same Aranei can be healed again');
});

test('cog use on the Sangvesti mechanism is mandatory and consumes the earned cog once', () => {
  const h = harness(), p = player('Cog');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 50);
  p.attrs.set('quest.the_blood_moon_rises.blood-hunt', { nativeStage: 86 });
  p.getInventory().adds(I.OLD_COG, 1);
  const line = { player: p,
    text: "We don't have time for this. Whatever we do next, we can't stay here. Let's get across that bridge.",
    pages: [{ page: 'The Blood Moon Rises', variants: ['blood-hunt-after-finding-the-cog'] }],
    step: { player: "We don't have time for this." } };
  h.emit('npc-dialogue:line', line);
  line.after();
  assert.equal(p.getInventory().getAmount(I.OLD_COG), 1, 'the found-cog dialogue leaves the cog held');
  assert.equal(p.attrs.get('quest.the_blood_moon_rises.blood-hunt').drawbridgeRepaired, undefined);
  assert.equal(p.varbits.get(15485), 1, 'captured found-cog varbit is set');

  const use = h.itemOnObject.find(fn => fn.name === 'handleBloodHuntItemOnObject');
  const event = { player: p, objectId: 61804, definition: { id: 61804, getName: () => 'Drawbridge mechanism' },
    itemId: I.OLD_COG, location: { x: 2633, y: 7831, z: 0 }, handled: false };
  use(event);
  assert.equal(event.handled, true);
  assert.equal(p.getInventory().getAmount(I.OLD_COG), 0, 'the cog is consumed by the mechanism');
  assert.equal(p.attrs.get('quest.the_blood_moon_rises.blood-hunt').drawbridgeRepaired, true);
  assert.ok(p.manager.getCurrent(), 'the canonical crossing conversation starts');
  continueUntil(p, () => p.varbits.get(15464) === 88, 100);
  assert.equal(p.varbits.get(15464), 88, 'bridge lowering advances 86 -> 88');
});

test('mounted shield sends 15526 and gives the solid key through the compartment prompt', () => {
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  ObjectDefinition.init();
  const h = harness(), p = player('MountedShield');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 40);
  const STATE = 'quest.the_blood_moon_rises.castle-solid-key-puzzle';
  p.attrs.set(STATE, { shield: true, mounted: false, assembled: true, key: false });
  p.getInventory().adds(I.SHIELD_WITH_SYMBOL, 1);
  const mount = h.itemOnObject.find(fn => fn.name === 'handleMountShield');
  mount({ player: p, itemId: I.SHIELD_WITH_SYMBOL,
    location: { x: 2543, y: 7361, z: 0 }, handled: false });
  assert.equal(p.getInventory().getAmount(I.SHIELD_WITH_SYMBOL), 0);
  assert.equal(p.attrs.get(STATE).mounted, true);
  assert.equal(p.varbits.get(15526), 1, 'mount sends the captured transform varbit');
  assert.equal(ObjectDefinition.forPlayer(61698, p).id, 61700,
    'the saved mount resolves to Mounted shield for the player');

  const object = h.objectHooks.find(fn => fn.name === 'handleSolidKeyObjects');
  const search = { player: p, objectId: 61698,
    definition: { id: 61700, getName: () => 'Mounted shield' },
    option: 'Search', location: { x: 2543, y: 7361, z: 0 }, handled: false };
  object(search);
  assert.equal(search.handled, true);
  assert.equal(p.prompt?.title, 'Search the compartment?');
  choose(p, 'Yes.');
  assert.equal(p.getInventory().getAmount(I.SOLID_KEY), 1);
  assert.equal(p.attrs.get(STATE).key, true);

  object({ ...search, handled: false });
  assert.equal(p.getInventory().getAmount(I.SOLID_KEY), 1, 'searching while holding the key does not duplicate it');
  assert.equal(p.prompt, null);
  const inspect = { ...search, option: 'Inspect', handled: false };
  object(inspect);
  assert.equal(inspect.handled, false, 'Inspect does not use the compartment');

  const p2 = player('NotMounted');
  h.quest.setStage(p2, 40);
  p2.attrs.set(STATE, { shield: true, mounted: false, assembled: true, key: false });
  const unmounted = { ...search, player: p2, handled: false };
  object(unmounted);
  assert.equal(unmounted.handled, false);
  assert.equal(p2.getInventory().getAmount(I.SOLID_KEY), 0);

  p.getInventory().deleteNumber(I.SOLID_KEY, 1);
  object({ ...search, handled: false });
  choose(p, 'Yes.');
  assert.equal(p.getInventory().getAmount(I.SOLID_KEY), 1, 'a lost key can be recovered from the mount');

  const p3 = player('MountResync');
  h.quest.setStage(p3, 40);
  p3.attrs.set(STATE, { shield: true, mounted: true, assembled: true, key: false });
  h.emit('player:login', { player: p3 });
  assert.equal(p3.varbits.get(15526), 1, 'login resyncs the mounted shield varbit');
  assert.equal(ObjectDefinition.forPlayer(61698, p3).id, 61700);
});

test('stage 164 Efaritay uses the captured graveyard tile while 174 keeps its cutscene tile', () => {
  const h = harness(), p = player('Efaritay164');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 96);
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 160);
  const line = { player: p, text: 'Thank you, and good luck, my child.',
    pages: [{ page: 'The Blood Moon Rises', variants: ['night-of-the-blood-moon-talking-to-ivan'] }],
    step: { speaker: 'Sugadinti Vitur' } };
  h.emit('npc-dialogue:line', line);
  line.after?.();
  assert.equal(h.quest.getStage(p), 100);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3700, 3185]);
  const efaritay = h.npcs.find(npc => npc.id === N.EFARITAY_HALLOW_3);
  assert.ok(efaritay, 'the stage-164 Efaritay actor spawns');
  assert.deepEqual([efaritay.getLocation().getX(), efaritay.getLocation().getY()], [3700, 3185]);

  p.attrs.set('quest.the_blood_moon_rises.drakan-death-confirmed', true);
  h.emit('npc-dialogue:action', { player: p, stepId: 'HNA3XS', kind: 'action' });
  assert.equal(p.varbits.get(15464), 174);
  assert.ok(h.npcs.some(npc => npc.getLocation().getX() === 3706 && npc.getLocation().getY() === 3211),
    'the 174 cutscene actors remain on the primary 3706,3211 tiles');
});

test('Quest Helper sub-progress varbits publish from modeled actions and login restore', () => {
  const h = harness(), p = player('QhProgress');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p, 60);
  const prepLine = text => ({ player: p, text,
    pages: [{ page: 'The Blood Moon Rises', variants: ['hallowed-preparations-talking-to-ivan-and-sarei'] }],
    step: { speaker: 'Ivan Strom' } });
  const ivanLine = prepLine("I hope so too. We're going to need all the advantages we can find.");
  h.emit('npc-dialogue:line', ivanLine);
  ivanLine.after?.();
  assert.equal(p.varbits.get(15473), 1, 'Ivan hideout progress step 1');
  const veliafLine = prepLine('Well, if you want to try getting something out of her, be my guest.');
  h.emit('npc-dialogue:line', veliafLine);
  veliafLine.after?.();
  assert.equal(p.varbits.get(15474), 1, 'Veliaf hideout progress step 1');

  const p2 = player('QhStakes');
  enablePrereqs(h, new Set(PREREQS));
  h.quest.setStage(p2, 60);
  p2.attrs.set('quest.the_blood_moon_rises.preparations', { stakes: true });
  h.emit('player:login', { player: p2 });
  assert.equal(p2.varbits.get(15473), 2, 'login restores the fletched-stakes progress');

  p2.attrs.set('quest.the_blood_moon_rises.preparations',
    { stakes: true, ivanSareiIntroComplete: true, stakesConversationComplete: true });
  const ack = { player: p2, text: "I hope so too. We're going to need all the advantages we can find.",
    pages: [{ page: 'The Blood Moon Rises', variants: ['hallowed-preparations-talking-to-ivan-and-sarei-talking-to-them-again'] }],
    step: { player: 'I hope so too.' } };
  h.emit('npc-dialogue:line', ack);
  ack.after?.();
  assert.equal(p2.varbits.get(15473), 3, 'the actual stakes acknowledgement publishes step 3');

  p.attrs.set('quest.the_blood_moon_rises.preparations',
    { ...(p.attrs.get('quest.the_blood_moon_rises.preparations') ?? {}),
      veliafFirstTalkComplete: true, vanesculaTalkComplete: true, veliafFollowupComplete: true });
  h.emit('player:login', { player: p });
  assert.equal(p.varbits.get(15474), 3, 'login restores completed Veliaf progress');

  h.quest.setStage(p, 50);
  p.attrs.set('quest.the_blood_moon_rises.blood-hunt', { nativeStage: 84 });
  h.emit('npc-dialogue:action', { player: p, stepId: 'lvEeSL', kind: 'message', text: 'Ivan hands over supplies.' });
  assert.equal(p.varbits.get(15481), 1, 'actual Ivan supply handover publishes the supply warning');

  h.quest.setStage(p, 40);
  h.emit('npc-dialogue:action', { player: p, stepId: 'ikSyAR', kind: 'action' });
  assert.equal(p.varbits.get(15482), 1, 'actual Vampyrium arrival publishes in_vampyrium');
  p.moveTo(new core.Location(2846, 7391, 0));
  h.quest.setStage(p, 45);
  h.emit('quest:stage-changed', { player: p });
  assert.equal(p.varbits.get(15482), 0, 'returning to Morytania clears in_vampyrium');

  const realm = (stage, x, y, z = 0) => {
    p.moveTo(new core.Location(x, y, z));
    h.quest.setStage(p, stage);
    h.emit('quest:stage-changed', { player: p });
    return p.varbits.get(15482);
  };
  assert.equal(realm(45, 2576, 7838), 1, 'native-88 town');
  assert.equal(realm(50, 2950, 7831), 1, 'native-94/98 refuge');
  assert.equal(realm(50, 2700, 7840), 1, 'native-90/92 First Blood arena');
  assert.equal(realm(60, 3157, 7839, 1), 1, 'preparations palace');
  assert.equal(realm(70, 3168, 7855, 1), 1, 'siege hall');
  assert.equal(realm(60, 3161, 7710), 0, 'Morytania castle entry stays outside');
  assert.equal(realm(60, 2846, 7391), 0, 'Morytania gathering landing stays outside');
  assert.equal(realm(60, 2843, 7646), 1, 'temporary Vampyrium resupply remains inside');

  h.quest.setStage(p, 30);
  p.attrs.set('the-blood-moon-rises:refinery-progress', { started: true, phase: 'pickaxe' });
  h.emit('npc-dialogue:action', { player: p, stepId: 'O3RVAV', kind: 'action' });
  assert.equal(p.getInventory().getAmount(I.BRONZE_PICKAXE), 1, 'actual handover grants the pickaxe');
  assert.equal(p.attrs.get('the-blood-moon-rises:refinery-progress').borrowedPickaxe, true);
  assert.equal(p.varbits.get(15469), 1, 'actual Ivan pickaxe handover publishes 15469');

  const wrongPhase = player('WrongPhase');
  h.quest.setStage(wrongPhase, 30);
  wrongPhase.attrs.set('the-blood-moon-rises:refinery-progress', { started: true, phase: 'tomb' });
  h.emit('npc-dialogue:action', { player: wrongPhase, stepId: 'O3RVAV', kind: 'action' });
  assert.equal(wrongPhase.varbits.get(15469), 0, 'wrong phase does not publish the pickaxe flag');

  const fullBag = player('FullBag');
  h.quest.setStage(fullBag, 30);
  fullBag.attrs.set('the-blood-moon-rises:refinery-progress', { started: true, phase: 'pickaxe' });
  const fullInventory = { contains: () => false, adds: () => false, getFreeSlots: () => 0,
    isFull: () => true, deleteNumber: noop, getAmount: () => 0 };
  fullBag.getInventory = () => fullInventory;
  h.emit('npc-dialogue:action', { player: fullBag, stepId: 'O3RVAV', kind: 'action' });
  assert.equal(fullBag.varbits.get(15469), 0, 'full bag does not set the borrowed flag');
  assert.equal(fullBag.attrs.get('the-blood-moon-rises:refinery-progress').borrowedPickaxe, undefined);

  const noPickaxe = player('NoPickaxe');
  h.quest.setStage(noPickaxe, 30);
  noPickaxe.attrs.set('the-blood-moon-rises:refinery-progress', { phase: 'mined' });
  h.emit('player:login', { player: noPickaxe });
  assert.equal(noPickaxe.varbits.get(15469), 0, 'own-pickaxe progress does not claim Ivan\'s spare');
  const borrowed = player('Borrowed');
  h.quest.setStage(borrowed, 30);
  borrowed.attrs.set('the-blood-moon-rises:refinery-progress', { phase: 'mined', borrowedPickaxe: true });
  h.emit('player:login', { player: borrowed });
  assert.equal(borrowed.varbits.get(15469), 1, 'login restores the borrowed pickaxe flag');

  h.quest.setStage(p, 100);
  p.attrs.set('quest.the_blood_moon_rises.final-portal-used', true);
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 168);
  p.moveTo(new core.Location(3000, 3000, 0));
  h.emit('player:login', { player: p });
  assert.equal(p.varbits.get(15482), 0, 'portal-used alone outside the final realm is false');
  p.moveTo(new core.Location(2507, 7383, 0));
  h.emit('player:login', { player: p });
  assert.equal(p.varbits.get(15482), 1, 'final Vampyrium staging is true at 168');
  p.attrs.set('quest.the_blood_moon_rises.final-native-stage', 174);
  p.moveTo(new core.Location(3731, 3220, 0));
  h.emit('quest:stage-changed', { player: p });
  assert.equal(p.varbits.get(15482), 0, '174 outside Vampyrium is false');
});

test('prepared lobby portal returns to the captured palace entrance without resetting progress', () => {
  const h = harness();
  const portal = h.objectHooks.find(fn => fn.name === 'enterVampyriumPortal');
  assert.ok(portal);
  for (const [native, prep] of [[102, { introComplete: true, gatherStarted: true }],
    [114, { introComplete: true, flail: true, stakes: true }]]) {
    const p = player(`PrepPortal${native}`);
    enablePrereqs(h, new Set(PREREQS));
    p.attrs.set('quest.the_blood_moon_rises.slepe-story', { refineryComplete: true });
    p.attrs.set('quest.the_blood_moon_rises.castle-shrine-prayed', true);
    p.attrs.set('quest.the_blood_moon_rises.preparations', prep);
    h.quest.setStage(p, 60);
    assert.equal(p.varbits.get(15464), native);
    const event = { player: p, objectId: 61214, definition: { id: 61214, getName: () => 'Portal' },
      location: { x: 3161, y: 7710, z: 0 }, option: 'Enter', handled: false };
    assert.equal(portal(event), true);
    assert.equal(event.handled, true);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3168, 7859, 1]);
    assert.equal(h.quest.getStage(p), 60, 'preparations stage is preserved');
    assert.equal(p.varbits.get(15464), native, 'native preparation stage is preserved');
    assert.deepEqual(p.attrs.get('quest.the_blood_moon_rises.preparations'), prep,
      'preparation progress and items are untouched');
    assert.ok(h.npcs.some(npc => npc.getLocation().getX() === 3157 && npc.getLocation().getY() === 7841),
      'normal palace actors sync on the return');
  }
});
