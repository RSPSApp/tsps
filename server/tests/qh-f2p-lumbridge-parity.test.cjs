// Quest Helper parity for The Restless Ghost, Rune Mysteries and X Marks the Spot.
// Run from server/: node --test tests/qh-f2p-lumbridge-parity.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function register(name, key) {
  const hooks = new Map(), variants = [], conditions = [], custom = new Map(), tasks = [];
  const api = new Proxy({
    core: { ...core, TaskManager: {
      submit: (task) => { task.setRunning(true); tasks.push(task); },
      cancelTasks: (key) => tasks.filter((task) => task.key === key).forEach((task) => task.stop()),
    } },
    persistAttribute() {},
    onNpcDialogueVariant: (fn) => variants.push(fn),
    onNpcDialogueCondition: (fn) => conditions.push(fn),
    onCustomEvent: (event, fn) => {
      if (!custom.has(event)) custom.set(event, []);
      custom.get(event).push(fn);
      // The real shared-NPC dispatch below also needs QuestRuntime's public query.
      if (event === 'quest:get-stage') PluginManager.createApi('QuestRuntimeTest').onCustomEvent(event, fn);
    },
    emitCustomEvent: (event, payload) => { for (const fn of custom.get(event) || []) fn(payload); },
  }, { get(target, prop) {
    if (prop in target) return target[prop];
    return (...args) => {
      const fn = args.findLast((arg) => typeof arg === 'function');
      if (fn) { if (!hooks.has(prop)) hooks.set(prop, []); hooks.get(prop).push(fn); }
    };
  } });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return {
    quest: getRegisteredQuests().findLast((quest) => quest.key === key),
    variant: (event) => variants.map((fn) => fn(event)).find(Boolean) ?? null,
    condition: (event) => conditions.map((fn) => fn(event)).find((answer) => answer !== null && answer !== undefined) ?? null,
    emit: (event, payload) => api.emitCustomEvent(event, payload),
    call: (event, payload) => { for (const fn of hooks.get(event) || []) fn(payload); },
  };
}

function player() {
  const attributes = new Map(), items = new Map(), bank = new Map(), packets = [];
  let location = new core.Location(3228, 3242, 0);
  const p = {
    attributes, items, bank, packets, amulet: undefined, full: false, varbits: new Map(), messages: [], xp: [],
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0, isFull: () => p.full, getFreeSlots: () => p.full ? 0 : 28,
      adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    }),
    getBanks: () => [{ getAmount: (id) => bank.get(id) ?? 0 }],
    getEquipment: () => ({ get: () => p.amulet === undefined ? null : { getId: () => p.amulet } }),
    getPacketSender: () => new Proxy({ getVarbit: (id) => p.varbits.get(id) ?? 0, isChatboxInterface: (id) => id === 219, sendVarbit: (id, value) => { p.varbits.set(id, value); packets.push(['sendVarbit', id, value]); return proxy; } }, {
      get: (target, key) => key in target ? target[key] : (...args) => { packets.push([key, ...args]); return proxy; },
    }),
    getDialogueManager: () => ({ reset() {}, startDialogues() {} }),
    getSkillManager: () => ({ getCombatLevel: () => 20, addExperiences: (skill, amount) => p.xp.push([skill.getIndex(), amount]) }),
    getLocation: () => location, moveTo: (value) => { location = value; },
    getUsername: () => 'QhParity', sendMessage: (text) => p.messages.push(text),
    performAnimation: () => {}, isRegistered: () => true,
  };
  const proxy = p.getPacketSender();
  p.getPacketSender = () => proxy;
  return p;
}

test('Restless Ghost dispatches the QH pre-quest, amulet-recovery and post-quest branches', () => {
  const q = register('RestlessGhost', 'the_restless_ghost'), p = player();
  const variant = (npcId) => q.variant({ player: p, npcId });

  q.quest.setStage(p, 0);
  assert.deepEqual(variant(N.FATHER_AERECK), { page: 'The Restless Ghost', variant: 'starting-out' });
  assert.deepEqual(variant(N.FATHER_URHNEY), { page: 'Father Urhney', variant: 'before-the-restless-ghost' });

  q.quest.setStage(p, 1);
  assert.deepEqual(variant(N.FATHER_AERECK), { page: 'The Restless Ghost', variant: 'starting-out-talking-to-father-aereck-again' });
  assert.deepEqual(variant(N.FATHER_URHNEY), { page: 'The Restless Ghost', variant: 'talking-to-father-urhney' });

  q.quest.setStage(p, 2);
  assert.deepEqual(variant(N.FATHER_URHNEY), { page: 'The Restless Ghost', variant: 'talking-to-father-urhney-if-the-ghostspeak-amulet-is-ever-lost' });
  assert.deepEqual(variant(N.RESTLESS_GHOST), { page: 'The Restless Ghost', variant: 'talking-to-the-restless-ghost-without-wearing-the-amulet-of-ghostspeak' });
  p.amulet = I.GHOSTSPEAK_AMULET;
  assert.deepEqual(variant(N.RESTLESS_GHOST), { page: 'The Restless Ghost', variant: 'talking-to-the-restless-ghost-while-wearing-the-amulet-of-ghostspeak' });

  q.quest.setStage(p, 3);
  assert.deepEqual(variant(N.FATHER_AERECK), { page: 'The Restless Ghost', variant: 'talking-to-the-restless-ghost-talking-to-father-aereck' });
  assert.deepEqual(variant(N.RESTLESS_GHOST), { page: 'The Restless Ghost', variant: 'talking-to-the-restless-ghost-talking-to-the-restless-ghost-again-with-the-amulet-of-ghostspeak' });

  q.quest.setStage(p, 4);
  assert.deepEqual(variant(N.FATHER_AERECK), { page: 'The Restless Ghost', variant: 'after-retrieving-the-skull-talking-to-father-aereck-with-the-skull' });
  assert.deepEqual(variant(N.FATHER_URHNEY), { page: 'The Restless Ghost', variant: 'talking-to-father-urhney-if-the-ghostspeak-amulet-is-ever-lost' });

  q.quest.setStage(p, 5);
  assert.deepEqual(variant(N.FATHER_URHNEY), { page: 'Father Urhney', variant: 'after-the-restless-ghost' });

  p.items.clear(); p.amulet = undefined; p.full = false;
  const condition = (text) => q.condition({ player: p, npcId: N.FATHER_URHNEY, text });
  assert.equal(condition("If they player currently has it in their inventory:"), false);
  p.items.set(I.GHOSTSPEAK_AMULET, 1);
  assert.equal(condition("If they player currently has it in their inventory:"), true);
  p.items.clear(); p.bank.set(I.GHOSTSPEAK_AMULET, 1);
  assert.equal(condition("If the amulet if stored in a bank, Death's Office, Item Retrieval Service:"), true);
  p.bank.clear(); p.full = true;
  assert.equal(condition('If the player does not have inventory space:'), true);
  assert.equal(condition('If the player has inventory space:'), false);
});

test('Rune Mysteries dispatches every QH stage branch and its item conditions', () => {
  const q = register('RuneMysteries', 'rune_mysteries'), p = player();
  const variant = (npcId) => q.variant({ player: p, npcId });
  const sedridor = N.ARCHMAGE_SEDRIDOR, aubury = N.AUBURY_2, duke = N.DUKE_HORACIO;

  q.quest.setStage(p, 0);
  assert.deepEqual(variant(duke), { page: 'Rune Mysteries', variant: 'starting-off-talking-to-duke-horacio' });
  assert.deepEqual(variant(sedridor), { page: 'Archmage Sedridor', variant: 'standard-dialogue-before-rune-mysteries' });
  assert.deepEqual(variant(aubury), { page: 'Aubury', variant: 'standard-dialogue-if-the-player-isn-t-carrying-a-combat-path-voucher-or-is-carrying-a-combat-path-voucher-and-has-received-all-possible-rewards-already' });

  q.quest.setStage(p, 1);
  assert.deepEqual(variant(duke), { page: 'Rune Mysteries', variant: 'starting-off-talking-to-duke-horacio-talking-to-duke-horacio-again' });
  assert.deepEqual(variant(sedridor), { page: 'Rune Mysteries', variant: 'delivering-the-talisman-talking-to-archmage-sedridor-talking-to-sedridor-again-after-not-having-the-talisman-when-first-going-through-the-dialogue' });
  p.items.set(I.AIR_TALISMAN, 1);
  assert.deepEqual(variant(sedridor), { page: 'Rune Mysteries', variant: 'delivering-the-talisman-talking-to-archmage-sedridor' });

  q.quest.setStage(p, 2);
  assert.deepEqual(variant(sedridor), { page: 'Rune Mysteries', variant: 'delivering-the-talisman-talking-to-archmage-sedridor-talking-to-sedridor-after-giving-him-the-talisman-but-before-agreeing-to-go-see-aubury' });

  q.quest.setStage(p, 3);
  assert.deepEqual(variant(sedridor), { page: 'Rune Mysteries', variant: 'delivering-the-talisman-talking-to-archmage-sedridor-talking-to-sedridor-after-agreeing-to-go-see-aubury-but-before-receiving-the-package' });
  assert.deepEqual(variant(aubury), { page: 'Rune Mysteries', variant: 'delivering-the-research-package-talking-to-aubury' });
  p.setAttribute('rune-mysteries:package-issued', 1);
  assert.deepEqual(variant(sedridor), { page: 'Rune Mysteries', variant: 'delivering-the-talisman-talking-to-archmage-sedridor-talking-to-sedridor-again' });

  q.quest.setStage(p, 4);
  assert.deepEqual(variant(aubury), { page: 'Rune Mysteries', variant: 'delivering-the-research-package-talking-to-aubury-talking-to-aubury-after-giving-him-the-package-but-before-he-goes-through-it' });

  q.quest.setStage(p, 5);
  assert.deepEqual(variant(sedridor), { page: 'Rune Mysteries', variant: 'delivering-the-research-notes-talking-to-sedridor' });
  assert.deepEqual(variant(aubury), { page: 'Rune Mysteries', variant: 'delivering-the-research-package-talking-to-aubury-talking-to-aubury-after-he-looked-through-the-package-but-before-he-hands-you-the-research-notes' });
  p.items.set(I.RESEARCH_NOTES_4, 1);
  assert.deepEqual(variant(aubury), { page: 'Rune Mysteries', variant: 'delivering-the-research-package-talking-to-aubury-talking-to-aubury-again' });

  q.quest.setStage(p, 6);
  assert.equal(variant(duke), null);
  assert.deepEqual(variant(sedridor), { page: 'Archmage Sedridor', variant: 'standard-dialogue-after-rune-mysteries' });

  const condition = (text) => q.condition({ player: p, npcId: sedridor, text });
  q.quest.setStage(p, 1); p.items.clear();
  assert.equal(condition('If the player lost the talisman:'), true);
  assert.equal(condition('If the player has the talisman:'), false);
  p.items.set(I.AIR_TALISMAN, 1);
  assert.equal(condition('If the player lost the talisman:'), false);
  assert.equal(condition('If the player has the talisman:'), true);
  q.quest.setStage(p, 3); p.items.clear();
  assert.equal(condition('If the player lost the package:'), true);
  assert.equal(condition('If the player has the package:'), false);
  q.quest.setStage(p, 5); p.items.clear();
  assert.equal(condition('If the player lost the notes:'), true);
  p.items.set(I.RESEARCH_NOTES_4, 1);
  assert.equal(condition('If the player has the notes:'), true);
  q.emit('npc-dialogue:choice', { player: p, npcId: sedridor, option: "No, I don't think you are Sedridor." });
  assert.equal(condition('If the player gave the talisman to him while doubting his identity:'), true);
  assert.equal(condition('If the player gave the talisman to him without doubting his identity:'), false);
});

test('X Marks dispatches the QH clue branches, recovers lost items, and re-digs a lost casket', () => {
  const q = register('XMarksTheSpot', 'x_marks_the_spot'), p = player();
  const variant = () => q.variant({ player: p, npcId: N.VEOS });

  q.quest.setStage(p, 0);
  assert.equal(variant(), 'starting-off-if-the-player-has-not-visited-great-kourend-before');
  p.varbits.set(4897, 1);
  assert.equal(variant(), 'starting-off-if-the-player-has-visited-great-kourend-before');
  p.setAttribute('x-marks-the-spot:awaiting-scroll', 1);
  assert.equal(variant(), 'starting-off-talking-to-veos-again-if-the-player-previously-did-not-have-inventory-space-for-the-treasure-scroll');

  q.quest.setStage(p, 1);
  assert.equal(variant(), 'talking-to-veos-after-losing-an-item');
  p.items.set(23067, 1);
  assert.equal(variant(), 'talking-to-veos-after-receiving-the-first-clue');

  q.quest.setStage(p, 5);
  assert.equal(variant(), 'talking-to-veos-after-receiving-the-fourth-clue');
  p.items.set(23071, 1);
  assert.deepEqual(variant(), { page: 'X Marks the Spot', variant: 'finishing-up' });
  p.items.delete(23071); p.setAttribute('x-marks-the-spot:handed-casket', 1);
  assert.deepEqual(variant(), { page: 'X Marks the Spot', variant: 'finishing-up' });

  q.quest.setStage(p, 6);
  assert.equal(variant(), 'standard-dialogue-at-port-sarim-subsequent-dialogue');

  q.quest.setStage(p, 0); p.full = true;
  const condition = (text, npc) => q.condition({ player: p, npcId: N.VEOS, npc, text });
  assert.equal(condition('If the player does not have any free inventory space:'), true);
  assert.equal(condition('If the player has a free inventory space:'), false);
  p.full = false;
  assert.equal(condition('If the player talks to Veos in Lumbridge:', { getLocation: () => new core.Location(3228, 3242, 0) }), true);
  assert.equal(condition('If the player talks to Veos in Port Sarim:', { getLocation: () => new core.Location(3054, 3245, 0) }), true);

  const lost = register('XMarksTheSpot', 'x_marks_the_spot'), digger = player();
  lost.quest.setStage(digger, 5);
  digger.moveTo(new core.Location(3078, 3259, 0));
  const dig = { player: digger, itemId: I.SPADE, option: 'Dig' };
  lost.call('onCanUseItem', dig);
  assert.equal(dig.allow, false);
  assert.equal(digger.items.get(23071), 1, 'the lost casket is re-dug at the fourth clue');
  assert.equal(lost.quest.getStage(digger), 5);
});

test('X Marks reclaims only a missing unused lamp on Port Sarim Veos Talk-to', () => {
  const q = register('XMarksTheSpot', 'x_marks_the_spot'), p = player();
  q.quest.setStage(p, 6);
  p.attributes.set('x-marks-the-spot:clue-box-state', 2);
  p.varbits.set(8258, 1);
  const talk = () => q.call('onNpcInteraction', { player: p, npcId: 10723, clickType: 1, location: { x: 3054, y: 3245, z: 0 } });

  p.full = true;
  talk();
  assert.equal(p.items.get(23072), undefined, 'a full bag must not receive the reclaimed lamp');
  p.full = false;
  talk();
  assert.equal(p.items.get(23072), 1, 'Port Sarim Veos Talk-to reclaims the unused lamp');
  talk();
  assert.equal(p.items.get(23072), 1, 'repeat Talk-to must not duplicate the lamp');

  p.items.delete(23072);
  talk();
  assert.equal(p.items.get(23072), 1, 'a destroyed unused lamp is re-obtainable');

  p.items.delete(23072);
  p.setAttribute('x-marks-the-spot:lamp-used', 1);
  talk();
  assert.equal(p.items.get(23072), undefined, 'a used lamp is not reclaimable');

  p.setAttribute('x-marks-the-spot:lamp-used', 0);
  p.varbits.set(8066, 1);
  talk();
  assert.equal(p.items.get(23072), 1, 'the non-persisted 8066 bit alone cannot refuse a reclaim');
  assert.equal(p.varbits.get(8066), 0, 'the persisted attribute is mirrored back over the stale bit');

  p.items.delete(23072);
  p.bank.set(23072, 1);
  talk();
  assert.equal(p.items.get(23072), undefined, 'a lamp owned in the bank must not be duplicated');
  p.bank.clear();
  talk();
  assert.equal(p.items.get(23072), 1, 'the lamp can be reclaimed after the bank copy is gone');

  p.items.delete(23072);
  q.call('onPlayerLogin', { player: p });
  assert.equal(p.items.get(23072), undefined, 'login must not auto-grant the lamp');
  assert.equal(p.varbits.get(8066), 0, 'login mirrors the unused lamp flag');
  talk();
  assert.equal(p.items.get(23072), 1, 'Talk-to after login still reclaims it');

  const legacy = player();
  q.quest.setStage(legacy, 6);
  legacy.varbits.set(8066, 1);
  q.call('onPlayerLogin', { player: legacy });
  assert.notEqual(legacy.attributes.get('x-marks-the-spot:lamp-used'), 1, 'a transient 8066 bit is not migrated');
  assert.equal(legacy.varbits.get(8066), 0, 'login mirrors the persisted attribute, not the cached bit');
  q.call('onNpcInteraction', { player: legacy, npcId: 10723, clickType: 1, location: { x: 3054, y: 3245, z: 0 } });
  assert.equal(legacy.items.get(23072), 1, 'the persisted attribute is authoritative for reclaim');

  p.items.delete(23072);
  q.call('onNpcInteraction', { player: p, npcId: 10723, clickType: 2, location: { x: 3054, y: 3245, z: 0 } });
  assert.equal(p.items.get(23072), undefined, 'only the Talk-to click type reclaims');
  q.call('onNpcInteraction', { player: p, npcId: 8484, clickType: 1, location: { x: 3228, y: 3242, z: 0 } });
  assert.equal(p.items.get(23072), undefined, 'Lumbridge Veos does not reclaim the Port Sarim reward');
  q.call('onNpcInteraction', { player: p, npcId: 10723, clickType: 1, location: { x: 1825, y: 3691, z: 0 } });
  assert.equal(p.items.get(23072), undefined, 'Piscarilius Veos does not reclaim the Port Sarim reward');

  const dock = player();
  q.quest.setStage(dock, 6);
  q.call('onNpcInteraction', { player: dock, npcId: 8484, clickType: 1, location: { x: 3054, y: 3245, z: 0 } });
  assert.equal(dock.items.get(23072), 1, 'the existing 8484 dock Veos also reclaims at Port Sarim');
});

test('X Marks grants the beginner box once, defers owned/full rewards, and migrates old flags', () => {
  const complete = (q, p, ownedBox = false) => {
    if (ownedBox) p.items.set(24361, 1);
    q.quest.setStage(p, 5);
    p.setAttribute('x-marks-the-spot:handed-casket', 1);
    p.items.set(23071, 1);
    q.emit('npc-dialogue:action', { player: p, npcId: 10723, stepId: '03vD77' });
  };
  const talk = (q, p) => q.call('onNpcInteraction', { player: p, npcId: 10723, clickType: 1, location: { x: 3054, y: 3245, z: 0 } });

  const q = register('XMarksTheSpot', 'x_marks_the_spot'), p = player();
  complete(q, p, true);
  assert.equal(p.items.get(24361), 1, 'already-owned box is not duplicated at completion');
  assert.equal(p.attributes.get('x-marks-the-spot:clue-box-state'), 1, 'already-owned box becomes pending');
  assert.equal(p.varbits.get(8258), 0, 'clue reward is not marked granted before the real grant');
  talk(q, p);
  assert.equal(p.items.get(24361), 1, 'pending claim is refused while the player still owns a box');

  p.items.delete(24361);
  p.bank.set(24361, 1);
  talk(q, p);
  assert.equal(p.items.get(24361), undefined, 'bank ownership also blocks the deferred grant');
  p.bank.clear();
  talk(q, p);
  assert.equal(p.items.get(24361), 1, 'the deferred box is granted once the bank copy is gone');
  assert.equal(p.attributes.get('x-marks-the-spot:clue-box-state'), 2);
  assert.equal(p.varbits.get(8258), 1, 'clue reward is set only on the real grant');
  talk(q, p);
  assert.equal(p.items.get(24361), 1, 'repeat Talk-to must not duplicate after claiming');
  p.items.delete(24361);
  talk(q, p);
  assert.equal(p.items.get(24361), undefined, 'a claimed box is not re-granted');

  const qFull = register('XMarksTheSpot', 'x_marks_the_spot'), full = player();
  full.full = true;
  complete(qFull, full);
  assert.equal(full.items.get(24361), undefined, 'full bag defers the beginner box');
  assert.equal(full.attributes.get('x-marks-the-spot:clue-box-state'), 1);
  assert.equal(full.varbits.get(8258), 0);
  qFull.call('onPlayerLogin', { player: full });
  assert.equal(full.items.get(24361), undefined, 'login must not grant a pending box');
  assert.equal(full.varbits.get(8258), 0, 'login mirrors the pending box flag');
  talk(qFull, full);
  assert.equal(full.items.get(24361), undefined, 'pending box waits for space');
  full.full = false;
  talk(qFull, full);
  assert.equal(full.items.get(24361), 1, 'the deferred box is granted after making space');
  assert.equal(full.attributes.get('x-marks-the-spot:clue-box-state'), 2);
  full.items.delete(24361);
  qFull.call('onPlayerLogin', { player: full });
  assert.equal(full.items.get(24361), undefined, 'login must not auto-grant the box');
  assert.equal(full.varbits.get(8258), 1, 'login mirrors the claimed clue flag');

  const qOld = register('XMarksTheSpot', 'x_marks_the_spot'), oldFlagged = player();
  qOld.quest.setStage(oldFlagged, 6);
  oldFlagged.varbits.set(8258, 1);
  qOld.call('onPlayerLogin', { player: oldFlagged });
  assert.equal(oldFlagged.attributes.get('x-marks-the-spot:clue-box-state'), 2, 'old 8258=1 saves migrate to claimed');
  talk(qOld, oldFlagged);
  assert.equal(oldFlagged.items.get(24361), undefined, 'old claimed saves receive no retro box');

  const qPre = register('XMarksTheSpot', 'x_marks_the_spot'), oldUnflagged = player();
  qPre.quest.setStage(oldUnflagged, 6);
  oldUnflagged.varbits.set(8258, 0);
  qPre.call('onPlayerLogin', { player: oldUnflagged });
  assert.equal(oldUnflagged.attributes.get('x-marks-the-spot:clue-box-state'), 2, 'old completed saves default to claimed, not pending');
  assert.equal(oldUnflagged.items.get(24361), undefined, 'migration does not grant on login');
  talk(qPre, oldUnflagged);
  assert.equal(oldUnflagged.items.get(24361), undefined, 'transient 8258=0 cannot create a retro claim');

  const qNoAdd = register('XMarksTheSpot', 'x_marks_the_spot'), noAdd = player();
  const realInventory = noAdd.getInventory();
  noAdd.getInventory = () => ({
    ...realInventory,
    adds: (id, amount) => { if (id !== 24361) realInventory.adds(id, amount); },
  });
  complete(qNoAdd, noAdd);
  assert.equal(noAdd.attributes.get('x-marks-the-spot:clue-box-state'), 1, 'failed add leaves the box pending');
  assert.equal(noAdd.varbits.get(8258), 0, 'failed add does not mark the clue reward claimed');
});


test('real PluginManager Veos Talk-to recovers rewards and keeps the Port Sarim menu', () => {
  if (!global.__lumbridgeRealNpcDialogues) {
    require('../plugins/quests/quests/XMarksTheSpot.Quest')(PluginManager.createApi('XMarksRecoveryReal'));
    assert.equal(PluginManager.registerPluginCandidate({
      pluginPath: 'NpcDialogues.plugin.js', pluginName: 'NpcDialogues',
      plugin: require('../plugins/npcs/NpcDialogues.plugin'), dependsOn: [],
    }), true, 'real NpcDialogues registers');
    global.__lumbridgeRealNpcDialogues = true;
  }
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const quest = getRegisteredQuests().findLast((entry) => entry.key === 'x_marks_the_spot');
  const emitTalk = (player, npcId, x, y) => {
    const definition = core.NpcDefinition.forId(npcId);
    const npc = {
      getId: () => npcId, getCurrentDefinition: () => definition,
      getLocation: () => new core.Location(x, y, 0), getIndex: () => 77,
    };
    const event = { player, npc, npcId, clickType: 1, location: { x, y, z: 0 }, handled: false };
    return { event, handled: PluginManager.emitNpcInteraction(event) };
  };
  const fresh = () => {
    const p = player();
    p.manager = new DialogueManager(p);
    p.getDialogueManager = () => p.manager;
    quest.setStage(p, 6);
    p.attributes.set('x-marks-the-spot:clue-box-state', 1);
    return p;
  };

  const p = fresh();
  const definition = core.NpcDefinition.forId(10723);
  assert.equal(PluginManager.emitNpcDialogueVariant({ player: p, npcId: 10723, definition, pages: [] }), 'standard-dialogue-at-port-sarim-subsequent-dialogue', 'the real quest variant hook answers postquest Veos');
  const first = emitTalk(p, 10723, 3054, 3245);
  assert.equal(first.handled, true, 'real NpcDialogues still handles the Talk-to');
  assert.equal(core.NpcDefinition.forId(10723).getName(), 'Veos', 'the actual cache id resolves to Veos');
  assert.equal(p.items.get(23072), 1, 'real dispatch reclaims the missing unused lamp');
  assert.equal(p.items.get(24361), 1, 'real dispatch claims the pending box');
  assert.equal(p.attributes.get('x-marks-the-spot:clue-box-state'), 2);
  assert.equal(p.varbits.get(8066), 0);
  assert.equal(p.varbits.get(8258), 1);
  let menu = MultiChatboxPrompt.getPending(p);
  for (let step = 0; step < 10 && !menu; step++) { p.manager.advance(); menu = MultiChatboxPrompt.getPending(p); }
  assert.ok(menu, 'the existing post-quest menu is shown');
  assert.deepEqual(menu.options, ['Can you take me somewhere?', 'Tell me more about Great Kourend.', 'Nothing.']);

  const repeat = emitTalk(p, 10723, 3054, 3245);
  assert.equal(repeat.handled, true);
  assert.equal(p.items.get(23072), 1, 'real repeat Talk-to does not duplicate the lamp');
  assert.equal(p.items.get(24361), 1, 'real repeat Talk-to does not duplicate the box');
  let repeatMenu = MultiChatboxPrompt.getPending(p);
  for (let step = 0; step < 10 && !repeatMenu; step++) { p.manager.advance(); repeatMenu = MultiChatboxPrompt.getPending(p); }
  assert.deepEqual(repeatMenu.options, ['Can you take me somewhere?', 'Tell me more about Great Kourend.', 'Nothing.']);

  p.items.delete(23072); p.items.delete(24361);
  PluginManager.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.equal(p.items.get(23072), undefined, 'relog does not auto-grant the lamp');
  assert.equal(p.items.get(24361), undefined, 'relog does not auto-grant the claimed box');
  assert.equal(p.attributes.get('x-marks-the-spot:clue-box-state'), 2, 'claimed state persists on relog');
  assert.equal(p.varbits.get(8066), 0);
  assert.equal(p.varbits.get(8258), 1);
  emitTalk(p, 10723, 3054, 3245);
  assert.equal(p.items.get(23072), 1, 'relog keeps the unused lamp reclaimable');
  assert.equal(p.items.get(24361), undefined, 'claimed box is not regranted after relog');

  const dockOldId = fresh();
  emitTalk(dockOldId, 8484, 3054, 3245);
  assert.equal(dockOldId.items.get(23072), 1, 'the existing 8484 dock Veos also recovers at Port Sarim');

  const lumbridge = fresh();
  emitTalk(lumbridge, 8484, 3228, 3242);
  assert.equal(lumbridge.items.get(23072), undefined, 'Lumbridge Veos must not recover the Port Sarim reward');

  const piscarilius = fresh();
  emitTalk(piscarilius, 10724, 1825, 3691);
  assert.equal(piscarilius.items.get(23072), undefined, 'Piscarilius Veos must not recover the Port Sarim reward');

  const legacy = player();
  quest.setStage(legacy, 6);
  PluginManager.emitPlayerLogin({ player: legacy, username: legacy.getUsername() });
  assert.equal(legacy.attributes.get('x-marks-the-spot:clue-box-state'), 2, 'old completed save safely becomes claimed');
  assert.equal(legacy.items.get(24361), undefined, 'old completed save gets no retro box');
  emitTalk(legacy, 10723, 3054, 3245);
  assert.equal(legacy.items.get(24361), undefined, 'old completed save still gets no retro box after Talk-to');
});

test('Rune Mysteries defers mid-quest Duke to real shared/other-quest dialogue', () => {
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  if (!global.__lumbridgeRealNpcDialogues) {
    PluginManager.registerPluginCandidate({
      pluginPath: 'NpcDialogues.plugin.js', pluginName: 'NpcDialogues',
      plugin: require('../plugins/npcs/NpcDialogues.plugin'), dependsOn: [],
    });
    global.__lumbridgeRealNpcDialogues = true;
  }
  if (!global.__lumbridgeRuneDukeRepro) {
    require('../plugins/quests/quests/DeathToTheDorgeshuun.Quest')(PluginManager.createApi('D2DDukeRepro'));
    require('../plugins/quests/quests/DragonSlayer.Quest')(PluginManager.createApi('DragonDukeRepro'));
    require('../plugins/quests/quests/IdesOfMilk.Quest')(PluginManager.createApi('IdesDukeRepro'));
    require('../plugins/quests/quests/LostTribe.Quest')(PluginManager.createApi('LostTribeDukeRepro'));
    require('../plugins/quests/quests/RuneMysteries.Quest')(PluginManager.createApi('RuneDukeRepro'));
    global.__lumbridgeRuneDukeRepro = true;
  }
  const rune = getRegisteredQuests().findLast((entry) => entry.key === 'rune_mysteries');
  const ides = getRegisteredQuests().findLast((entry) => entry.key === 'the_ides_of_milk');
  const dragon = getRegisteredQuests().findLast((entry) => entry.key === 'dragon_slayer_i');
  const definition = core.NpcDefinition.forId(815);
  const npc = {
    getId: () => 815, getCurrentDefinition: () => definition,
    getLocation: () => new core.Location(3209, 3222, 1), getIndex: () => 75,
  };
  const make = () => {
    const p = player();
    p.manager = new DialogueManager(p);
    p.getDialogueManager = () => p.manager;
    rune.setStage(p, 2);
    return p;
  };
  const talk = (p) => {
    const event = { player: p, npc, npcId: 815, clickType: 1, location: { x: 3209, y: 3222, z: 1 }, handled: false };
    assert.equal(PluginManager.emitNpcInteraction(event), true);
  };
  const toMenu = (p) => {
    const lines = [];
    for (let step = 0; step < 20; step++) {
      const menu = MultiChatboxPrompt.getPending(p);
      if (menu) return { menu, lines };
      const current = p.manager.getCurrent();
      if (!current) break;
      lines.push(current.getText?.());
      p.manager.advance();
    }
    return { menu: null, lines };
  };
  const finish = (p) => {
    const lines = [];
    for (let step = 0; step < 30; step++) {
      const current = p.manager.getCurrent();
      if (!current) break;
      lines.push(current.getText?.());
      p.manager.advance();
    }
    return lines;
  };

  const plain = make();
  talk(plain);
  const shared = toMenu(plain);
  assert.ok(shared.menu, 'no other active quest: shared Duke menu must show');
  assert.deepEqual(shared.menu.options, [
    'I seek a shield that will protect me from dragonbreath.',
    'Have you any quests for me?',
    'Where can I find money?',
  ]);
  assert.ok(!shared.menu.options.includes('What did you want me to do again?'), 'stale Rune mid-quest page must not play');
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: plain, groupId: 219, slot: 3 }), true);
  const moneyLines = finish(plain);
  assert.ok(moneyLines.some((line) => /blacksmiths are prosperous/.test(line ?? '')), 'real shared Duke response must play ' + JSON.stringify(moneyLines));

  const other = make();
  ides.setStage(other, 10);
  dragon.setStage(other, 1);
  talk(other);
  const opening = [];
  while (other.manager.getCurrent() && opening.length < 12) {
    const text = other.manager.getCurrent().getText?.();
    opening.push(text);
    if (text === "I'm looking to get into the milk trade!") break;
    other.manager.advance();
  }
  assert.ok(opening.includes('Greetings. I come seeking a business permit.'),
    'Ides must win over Dragon Slayer when its permit stage needs the Duke');
  assert.equal(ides.getStage(other), 10, 'closing the dialogue before the referral leaves the permit step unchanged');
  other.manager.reset();
  talk(other);
  const idesLines = finish(other);
  assert.ok(idesLines.includes('Greetings. I come seeking a business permit.'), 'the permit conversation reopens after close');
  assert.ok(idesLines.some(line => line?.startsWith('Why not speak to Gillie Groats?')));
  assert.equal(ides.getStage(other), 12, 'only the canonical Duke referral advances the Ides stage');
  assert.ok(!idesLines.includes('What did you want me to do again?'), 'Rune must not shadow an active shared Duke quest');

  const dragonOnly = make();
  dragon.setStage(dragonOnly, 1);
  talk(dragonOnly);
  const dragonDialogue = toMenu(dragonOnly);
  assert.ok(dragonDialogue.menu?.options.includes('I seek a shield that will protect me from dragonbreath.'),
    'Dragon Slayer keeps its Duke shield conversation when Ides is not at the permit step');
});
