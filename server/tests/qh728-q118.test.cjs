// From server/: node --test tests/qh728-q118.test.cjs (after the baseline build).
// Focused Tribal Totem contracts: the two GPDT crates, employee delivery, the
// locked front door / KURT door, the thieving-gated stairs, the chest transform,
// the hand-in reward, post-quest dialogue and login replay of varp 200.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const dialogues = require('../data/definitions/npc-dialogues.json');
const dialogueIndex = require('../data/definitions/npc-dialogue-index.json');
const core = PluginManager.getCoreApi();
const noop = () => {};

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const bankItems = new Map();
  const messages = [];
  const moves = [];
  const log = [];
  const drops = [];
  const xp = [];
  const varbits = new Map();
  let full = false;
  let location = new core.Location(0, 0, 0);
  let interfaceId = -1;
  let thieving = 21;
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return inventory;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return inventory;
    },
    forceAdd: (_player, item) => {
      const id = item.getId();
      const amount = item.getAmount();
      if (full && !(id === core.ItemIdentifiers.COINS && items.has(id))) {
        drops.push([id, amount]);
        return;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter(amount => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
    getItems: () => [],
  };
  const sender = new Proxy({
    getVarbit: id => varbits.get(id) ?? 0,
    sendVarbit: (id, value) => { varbits.set(id, value); log.push(['sendVarbit', id, value]); return sender; },
    sendInterface: id => { interfaceId = id; log.push(['sendInterface', id]); return sender; },
    closeInterface: () => { interfaceId = -1; log.push(['closeInterface']); return sender; },
  }, { get: (target, prop) => target[prop] ?? ((...args) => { log.push([String(prop), ...args]); return sender; }) });
  return {
    attrs, items, bankItems, messages, moves, log, drops, xp, varbits,
    setFull(value) { full = value; },
    setThieving(value) { thieving = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getBank: () => ({ getAmount: id => bankItems.get(id) ?? 0 }),
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: skill => (skill === core.Skill.THIEVING ? thieving : 1),
      getMaxLevel: skill => (skill === core.Skill.THIEVING ? thieving : 1),
      addExperiences: (skill, amount) => xp.push([skill?.getIndex?.() ?? skill, amount]),
    }),
    getUsername: () => 'q118-test',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getInterfaceId: () => interfaceId,
    setInterfaceId: id => { interfaceId = id; },
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
  };
}

function harness() {
  const events = {}, variants = [], conditions = [], itemOnObject = [], objectInteraction = [], itemAction = [], logins = [], logouts = [], buttons = [];
  const registered = [], deregistered = [];
  const ObjectManager = {
    register: object => registered.push(object),
    deregister: object => { deregistered.push(object); object.removed = true; },
  };
  const testCore = { ...core, ObjectManager };
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onObjectInteraction: handler => objectInteraction.push(handler),
    onItemOnObject: handler => itemOnObject.push(handler),
    onItemAction: handler => itemAction.push(handler),
    onPlayerLogin: handler => logins.push(handler),
    onPlayerLogout: handler => logouts.push(handler),
    onInterfaceActionButton: (_uids, handler) => buttons.push(handler),
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/TribalTotem.Quest')(api);
  return { events, variants, conditions, itemOnObject, objectInteraction, itemAction, logins, logouts, buttons, registered, deregistered,
    quest: runtime.getRegisteredQuests().at(-1) };
}

const option = text => ({ definition: { getInteractions: () => [text] }, clickType: 1 });
const objectEvent = (player, objectId, x, y, z, action, object) =>
  ({ player, objectId, location: { x, y, z }, ...option(action), handled: false, ...(object ? { object } : {}) });
const objectAt = (id, x, y, z) => new core.GameObject(id, new core.Location(x, y, z), 10, 0, null);
const wire = (player, id = 200) => player.log.filter(row => row[0] === 'sendConfig' && row[1] === id).at(-1)?.[2];

test('fresh stage 0 starts on the canonical Kangai page and mirrors varp 200', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(h.quest.getStage(p), 0);
  assert.deepEqual(h.variants.at(-1)({ player: p, npcId: core.NpcIdentifiers.KANGAI_MAU }),
    { page: 'Tribal Totem', variant: 'getting-started-talking-to-kangai-mau' });
  assert.ok(dialogues['Tribal Totem'].variants['getting-started-talking-to-kangai-mau']);
  assert.ok(dialogueIndex['5316'].some(entry => entry.page === 'Transcript:Tribal Totem' &&
    entry.variants.includes('getting-started-talking-to-kangai-mau')));

  const start = { player: p, npcId: core.NpcIdentifiers.KANGAI_MAU, hook: 'quest:tribal-totem:start', handled: false };
  h.events['npc-dialogue:hook'].forEach(handler => handler(start));
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(wire(p), 1);
});

test('the north-east crate gives the label and Cromperty\'s south crate receives it', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  assert.equal(core.ObjectIdentifiers.CRATE_19, 2707, 'north-east crate is cache 2707');
  assert.equal(core.ObjectIdentifiers.CRATE_20, 2708, 'Cromperty crate is cache 2708');

  const south = objectEvent(p, 2708, 2650, 3271, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(south));
  assert.equal(south.handled, true);
  assert.equal(p.items.get(core.ItemIdentifiers.ADDRESS_LABEL) ?? 0, 0, 'Cromperty\'s crate does not give a label');
  assert.ok(p.messages.includes('Senior Patents Clerk, Chamber of Invention, The Wizards\' Tower, Misthalin. The crate is securely fastened shut and ready for delivery.'));

  const north = objectEvent(p, 2707, 2650, 3273, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(north));
  assert.equal(north.handled, true);
  assert.equal(p.items.get(core.ItemIdentifiers.ADDRESS_LABEL), 1, 'the north-east crate gives the address label');
  assert.ok(p.messages.includes('There is a label on this crate. It says: Lord Handelmort, Handelmort Mansion, Ardougne'));

  const again = objectEvent(p, 2707, 2650, 3273, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(again));
  assert.ok(p.messages.includes('You can see the gluey outline from where you peeled the address label off.'));
  assert.equal(p.items.get(core.ItemIdentifiers.ADDRESS_LABEL), 1);

  const wrongCrate = { player: p, itemId: core.ItemIdentifiers.ADDRESS_LABEL, objectId: 2707, location: { x: 2650, y: 3273, z: 0 }, handled: false };
  h.itemOnObject.forEach(handler => handler(wrongCrate));
  assert.equal(wrongCrate.handled, false, 'the label is not used on the crate it came from');
  assert.equal(p.items.get(core.ItemIdentifiers.ADDRESS_LABEL), 1);
  assert.equal(h.quest.getStage(p), 1);

  const useLabel = { player: p, itemId: core.ItemIdentifiers.ADDRESS_LABEL, objectId: 2708, location: { x: 2650, y: 3271, z: 0 }, handled: false };
  h.itemOnObject.forEach(handler => handler(useLabel));
  assert.equal(useLabel.handled, true);
  assert.equal(p.items.get(core.ItemIdentifiers.ADDRESS_LABEL) ?? 0, 0, 'the label is consumed');
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(wire(p), 2);
  assert.ok(p.messages.includes('Now I just need someone to deliver it for me.'));

  const relabelled = objectEvent(p, 2708, 2650, 3271, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(relabelled));
  assert.ok(p.messages.includes('To Lord Handelmort, Handelmort Mansion, Ardougne.'));
});

test('banked label prevents a duplicate and a full bag can retry the label receipt', () => {
  const h = harness();
  const p = makePlayer();
  const labelId = core.ItemIdentifiers.ADDRESS_LABEL;
  h.quest.setStage(p, 1);
  p.bankItems.set(labelId, 1);
  const banked = objectEvent(p, 2707, 2650, 3273, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(banked));
  assert.equal(p.items.get(labelId) ?? 0, 0, 'the source does not duplicate a banked label');

  p.bankItems.set(labelId, 0);
  p.setFull(true);
  const full = objectEvent(p, 2707, 2650, 3273, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(full));
  assert.equal(p.items.get(labelId) ?? 0, 0);
  assert.equal(p.messages.includes('You carefully peel it off and take it.'), false);
  p.setFull(false);
  const retry = objectEvent(p, 2707, 2650, 3273, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(retry));
  assert.equal(p.items.get(labelId), 1, 'the label can be taken when capacity is available');
});

test('employee delivery and Cromperty teleport follow the helper order', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 2);
  const early = { player: p, npcId: core.NpcIdentifiers.GPDT_EMPLOYEE, option: 'So, when are you going to deliver this crate?' };
  h.events['npc-dialogue:choice'].forEach(handler => handler(early));
  assert.equal(h.quest.getStage(p), 3, 'the employee agrees to deliver the relabelled crate');
  assert.equal(wire(p), 3);

  const wrongNpc = { player: p, npcId: core.NpcIdentifiers.HORACIO, option: 'So, when are you going to deliver this crate?' };
  h.events['npc-dialogue:choice'].forEach(handler => handler(wrongNpc));
  assert.equal(h.quest.getStage(p), 3, 'only the GPDT employee owns the delivery choice');

  const delivery = { player: p, npcId: core.NpcIdentifiers.GPDT_EMPLOYEE, option: 'So, when are you going to deliver this crate?' };
  h.events['npc-dialogue:choice'].forEach(handler => handler(delivery));
  assert.equal(h.quest.getStage(p), 3, 'delivery is idempotent');

  const teleport = { player: p, npcId: core.NpcIdentifiers.WIZARD_CROMPERTY, stepId: 'bCwZ9I', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(teleport));
  assert.equal(teleport.handled, true);
  assert.deepEqual(p.moves.at(-1), [2638, 3322, 0]);
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(wire(p), 4);
  assert.ok(p.messages.includes('You find yourself inside Handelmort Mansion.'));

  const earlyPlayer = makePlayer();
  h.quest.setStage(earlyPlayer, 2);
  const earlyTeleport = { player: earlyPlayer, npcId: core.NpcIdentifiers.WIZARD_CROMPERTY, stepId: 'bCwZ9I', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(earlyTeleport));
  assert.equal(earlyTeleport.handled, false, 'the block is not in the mansion before delivery');
  assert.equal(earlyPlayer.moves.length, 0);
  assert.equal(h.quest.getStage(earlyPlayer), 2);
});

test('the locked front door and the KURT combination door use the cache ids and tiles', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(core.ObjectIdentifiers.DOOR_101, 2706, 'front door is cache 2706');
  assert.equal(core.ObjectIdentifiers.DOOR_100, 2705, 'combination door is cache 2705');

  p.setLocation(2635, 3320, 0);
  const outside = { player: p, objectId: 2706, location: { x: 2635, y: 3321, z: 0 }, handled: false };
  h.events['door:toggle'].forEach(handler => handler(outside));
  assert.equal(outside.handled, true);
  assert.ok(p.messages.includes('This door is securely locked.'));

  p.setLocation(2635, 3322, 0);
  const inside = { player: p, objectId: 2706, location: { x: 2635, y: 3321, z: 0 }, handled: false };
  h.events['door:toggle'].forEach(handler => handler(inside));
  assert.equal(inside.handled, false, 'the front door is only locked from outside');

  p.setLocation(2635, 3323, 0);
  const wrong = objectEvent(p, 2705, 2635, 3321, 0, 'Open');
  h.objectInteraction.forEach(handler => handler(wrong));
  assert.equal(wrong.handled, false, 'the old swapped tile is not the combination door');

  const combination = objectEvent(p, 2705, 2634, 3323, 0, 'Open');
  h.objectInteraction.forEach(handler => handler(combination));
  assert.equal(combination.handled, true, 'opening the locked door enters its real combination interface');
  assert.ok(p.log.some(([method, group]) => method === 'sendInterface' && group === 369));
  assert.deepEqual([14807, 14808, 14809, 14810].map(id => p.varbits.get(id)), [1, 1, 1, 1],
    'cache code values are initialized in their valid 1..26 range');
  assert.equal(p.messages.includes('The combination seems correct!'), false, 'opening alone cannot auto-solve KURT');

  const enter = buttonId => h.buttons.forEach(handler => handler({ player: p, buttonId, handled: false }));
  enter(0x0171003c);
  assert.equal(p.varbits.get(14807), 26, 'left wraps from A to Z');
  enter(0x01710048);
  assert.equal(p.varbits.get(14807), 1, 'right wraps from Z to A');
  enter(0x0171003b);
  assert.ok(p.messages.includes('The combination is incorrect.'), 'wrong code is refused');
  p.setInterfaceId(-1);
  h.events['interface:closed'].forEach(handler => handler({ player: p, interfaceId: 369 }));
  enter(0x01710048);
  assert.equal(p.varbits.get(14807), 1, 'closed puzzle rejects a stale button packet');
  const reopened = objectEvent(p, 2705, 2634, 3323, 0, 'Open');
  h.objectInteraction.forEach(handler => handler(reopened));
  assert.equal(reopened.handled, true);
  const controls = [
    [0x01710048, 10], [0x0171004a, 20], [0x0171004c, 17], [0x0171004e, 19],
  ];
  for (const [button, turns] of controls) for (let i = 0; i < turns; i++) enter(button);
  enter(0x0171003b);
  assert.deepEqual([14807, 14808, 14809, 14810].map(id => p.varbits.get(id)), [11, 21, 18, 20]);
  assert.equal(p.getAttribute('tribal-totem:kurt-door-unlocked'), true);
  assert.ok(p.messages.includes('The combination seems correct!'));
  const unlocked = objectEvent(p, 2705, 2634, 3323, 0, 'Open');
  h.objectInteraction.forEach(handler => handler(unlocked));
  assert.equal(unlocked.handled, false, 'only the solved door yields to the normal Doors handler');
});

test('investigating the trap stairs needs 21 Thieving and climbing before that drops the player', () => {
  const h = harness();
  const p = makePlayer();
  p.setThieving(20);
  const low = objectEvent(p, 2711, 2631, 3322, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(low));
  assert.equal(low.handled, true);
  assert.equal(p.attrs.get('quest.tribal_totem.stairs_investigated'), undefined);
  assert.ok(p.messages.includes("You don't find anything interesting."));

  p.setThieving(21);
  const high = objectEvent(p, 2711, 2631, 3322, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(high));
  assert.equal(p.attrs.get('quest.tribal_totem.stairs_investigated'), 1);

  const faller = makePlayer();
  const stairs = objectAt(2711, 2631, 3322, 0);
  const climb = { player: faller, objectId: 2711, object: stairs, handled: false };
  h.events['ladders:climb'].forEach(handler => handler(climb));
  assert.equal(climb.handled, true);
  assert.deepEqual(faller.moves.at(-1), [2566, 9641, 0]);
  assert.ok(faller.messages.includes('You have fallen through a trap!'));

  const safe = { player: p, objectId: 2711, object: stairs, handled: false };
  h.events['ladders:climb'].forEach(handler => handler(safe));
  assert.equal(safe.handled, false, 'investigated stairs stay with the generic ladder');
  assert.equal(p.moves.length, 0);
});

test('the KURT interface stops accepting button events on logout', () => {
  const h = harness();
  const p = makePlayer();
  const door = objectEvent(p, 2705, 2634, 3323, 0, 'Open');
  h.objectInteraction.forEach(handler => handler(door));
  h.logouts.forEach(handler => handler({ player: p }));
  h.buttons.forEach(handler => handler({ player: p, buttonId: 0x01710048 }));
  assert.equal(p.varbits.get(14807), 1);
});

test('the chest opens into cache 2710 and searching yields the totem once', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 3);
  assert.equal(core.ObjectIdentifiers.CHEST_22, 2710, 'open chest is cache 2710');
  const closed = objectAt(2709, 2638, 3324, 1);
  const open = objectEvent(p, 2709, 2638, 3324, 1, 'Open', closed);
  h.objectInteraction.forEach(handler => handler(open));
  assert.equal(open.handled, true);
  assert.equal(h.deregistered.at(-1), closed);
  const opened = h.registered.at(-1);
  assert.equal(opened?.getId?.(), 2710);
  assert.deepEqual([opened.getLocation().getX(), opened.getLocation().getY(), opened.getLocation().getZ()], [2638, 3324, 1]);
  assert.equal(p.items.get(core.ItemIdentifiers.TOTEM) ?? 0, 0, 'opening alone does not grant the totem');
  assert.ok(p.messages.includes('You open the chest.'));

  const search = objectEvent(p, 2710, 2638, 3324, 1, 'Search', opened);
  h.objectInteraction.forEach(handler => handler(search));
  assert.equal(search.handled, true);
  assert.equal(p.items.get(core.ItemIdentifiers.TOTEM), 1);
  assert.ok(p.messages.includes('Inside the chest you find the tribal totem.'));

  const repeat = objectEvent(p, 2710, 2638, 3324, 1, 'Search', opened);
  h.objectInteraction.forEach(handler => handler(repeat));
  assert.equal(p.items.get(core.ItemIdentifiers.TOTEM), 1);
  assert.ok(p.messages.includes('The chest is empty.'));

  const close = objectEvent(p, 2710, 2638, 3324, 1, 'Close', opened);
  h.objectInteraction.forEach(handler => handler(close));
  assert.equal(h.registered.at(-1)?.getId?.(), 2709);

  const elsewhere = objectEvent(p, 2709, 3342, 5948, 1, 'Open', objectAt(2709, 3342, 5948, 1));
  h.objectInteraction.forEach(handler => handler(elsewhere));
  assert.equal(elsewhere.handled, false, 'the shared mansion-copy chest is untouched');
});

test('the totem chest refuses a full bag and does not duplicate a banked totem', () => {
  const h = harness();
  const p = makePlayer();
  const totem = core.ItemIdentifiers.TOTEM;
  h.quest.setStage(p, 3);
  p.setFull(true);
  const closed = objectAt(2709, 2638, 3324, 1);
  h.objectInteraction.forEach(handler => handler(objectEvent(p, 2709, 2638, 3324, 1, 'Open', closed)));
  const opened = h.registered.at(-1);
  const fullSearch = objectEvent(p, 2710, 2638, 3324, 1, 'Search', opened);
  h.objectInteraction.forEach(handler => handler(fullSearch));
  assert.equal(p.items.get(totem) ?? 0, 0);
  assert.equal(p.messages.includes('Inside the chest you find the tribal totem.'), false);

  p.setFull(false);
  const inventory = p.getInventory();
  const adds = inventory.adds;
  inventory.adds = () => inventory; // Container APIs may return themselves on failed insertion.
  const racedFailure = objectEvent(p, 2710, 2638, 3324, 1, 'Search', opened);
  h.objectInteraction.forEach(handler => handler(racedFailure));
  assert.equal(p.items.get(totem) ?? 0, 0);
  assert.equal(p.messages.includes('Inside the chest you find the tribal totem.'), false,
    'the success text requires an observed item receipt');
  inventory.adds = adds;
  const retry = objectEvent(p, 2710, 2638, 3324, 1, 'Search', opened);
  h.objectInteraction.forEach(handler => handler(retry));
  assert.equal(p.items.get(totem), 1);
  p.items.set(totem, 0);
  p.bankItems.set(totem, 1);
  h.quest.setStage(p, 4);

  assert.deepEqual(h.variants.at(-1)({ player: p, npcId: core.NpcIdentifiers.KANGAI_MAU }),
    { page: 'Tribal Totem', variant: 'returning-back-to-kangai-mau' });
  const condition = h.conditions.at(-1);
  assert.equal(condition({ player: p, npcId: core.NpcIdentifiers.KANGAI_MAU, text: 'If the player has the totem in their inventory:' }), true);
  const finish = { player: p, npcId: core.NpcIdentifiers.KANGAI_MAU, stepId: 'WkVGYP', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(finish));
  assert.equal(finish.handled, false, 'the hand-in still requires the totem in inventory');
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(p.bankItems.get(totem), 1);
});

test('fresh stage 0 reaches the hand-in and keeps the canonical completion wire', () => {
  const h = harness();
  const p = makePlayer();
  p.setThieving(21);
  // Fixture: the guide book is the reachable ground item at (2638,3292); its
  // pickup is not what this test exercises.
  p.items.set(core.ItemIdentifiers.GUIDE_BOOK, 1);

  assert.equal(h.quest.getStage(p), 0);
  const start = { player: p, npcId: core.NpcIdentifiers.KANGAI_MAU, hook: 'quest:tribal-totem:start', handled: false };
  h.events['npc-dialogue:hook'].forEach(handler => handler(start));
  assert.equal(h.quest.getStage(p), 1);

  const north = objectEvent(p, 2707, 2650, 3273, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(north));
  const use = { player: p, itemId: core.ItemIdentifiers.ADDRESS_LABEL, objectId: 2708, location: { x: 2650, y: 3271, z: 0 }, handled: false };
  h.itemOnObject.forEach(handler => handler(use));
  assert.equal(h.quest.getStage(p), 2);

  const delivery = { player: p, npcId: core.NpcIdentifiers.GPDT_EMPLOYEE, option: 'So, when are you going to deliver this crate?' };
  h.events['npc-dialogue:choice'].forEach(handler => handler(delivery));
  assert.equal(h.quest.getStage(p), 3);

  const teleport = { player: p, npcId: core.NpcIdentifiers.WIZARD_CROMPERTY, stepId: 'bCwZ9I', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(teleport));
  assert.equal(h.quest.getStage(p), 4);

  const read = { player: p, itemId: core.ItemIdentifiers.GUIDE_BOOK, option: 'Read', handled: false };
  h.itemAction.forEach(handler => handler(read));
  assert.equal(read.handled, true);
  assert.equal(p.attrs.get('quest.tribal_totem.guide_read'), 1);

  const door = objectEvent(p, 2705, 2634, 3323, 0, 'Open');
  h.objectInteraction.forEach(handler => handler(door));
  assert.equal(door.handled, true, 'the door opens the combination interface, not an automatic pass');
  for (const [button, turns] of [[0x01710048, 10], [0x0171004a, 20], [0x0171004c, 17], [0x0171004e, 19]]) {
    for (let i = 0; i < turns; i++) h.buttons.forEach(handler => handler({ player: p, buttonId: button }));
  }
  h.buttons.forEach(handler => handler({ player: p, buttonId: 0x0171003b }));
  const openedDoor = objectEvent(p, 2705, 2634, 3323, 0, 'Open');
  h.objectInteraction.forEach(handler => handler(openedDoor));
  assert.equal(openedDoor.handled, false, 'the correct KURT combination yields to the Doors handler');

  const stairs = objectEvent(p, 2711, 2631, 3322, 0, 'Investigate');
  h.objectInteraction.forEach(handler => handler(stairs));
  assert.equal(p.attrs.get('quest.tribal_totem.stairs_investigated'), 1);
  const climb = { player: p, objectId: 2711, object: objectAt(2711, 2631, 3322, 0), handled: false };
  h.events['ladders:climb'].forEach(handler => handler(climb));
  assert.equal(climb.handled, false);

  // Fixture: the ordinary Climb-up transitions the player to the first floor.
  p.setLocation(2638, 3324, 1);
  const closed = objectAt(2709, 2638, 3324, 1);
  const open = objectEvent(p, 2709, 2638, 3324, 1, 'Open', closed);
  h.objectInteraction.forEach(handler => handler(open));
  const search = objectEvent(p, 2710, 2638, 3324, 1, 'Search', h.registered.at(-1));
  h.objectInteraction.forEach(handler => handler(search));
  assert.equal(p.items.get(core.ItemIdentifiers.TOTEM), 1);

  assert.deepEqual(h.variants.at(-1)({ player: p, npcId: core.NpcIdentifiers.KANGAI_MAU }),
    { page: 'Tribal Totem', variant: 'returning-back-to-kangai-mau' });
  const condition = h.conditions.at(-1);
  assert.equal(condition({ player: p, npcId: core.NpcIdentifiers.KANGAI_MAU, text: 'If the player does not have the totem in their inventory:' }), false);
  assert.equal(condition({ player: p, npcId: core.NpcIdentifiers.KANGAI_MAU, text: 'If the player has the totem in their inventory:' }), true);

  const finish = { player: p, npcId: core.NpcIdentifiers.KANGAI_MAU, stepId: 'WkVGYP', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(finish));
  assert.equal(finish.handled, true);
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(wire(p), 5, 'cache DB row 151 column 19 threshold is 5 on varp 200');
  assert.equal(p.items.get(core.ItemIdentifiers.TOTEM) ?? 0, 0, 'the totem is handed in');
  assert.equal(p.items.get(core.ItemIdentifiers.SWORDFISH), 5);
  assert.deepEqual(p.xp, [[core.Skill.THIEVING.getIndex(), 1775]]);

  const post = h.variants.at(-1)({ player: p, npcId: core.NpcIdentifiers.KANGAI_MAU });
  assert.deepEqual(post, { page: 'Kangai Mau', variant: 'standard-dialogue-after-the-completion-of-the-quest' });
  assert.ok(dialogues['Kangai Mau'].variants['standard-dialogue-after-the-completion-of-the-quest']);
  assert.ok(dialogueIndex['5316'].some(entry => entry.page === 'Transcript:Kangai Mau' &&
    entry.variants.includes('standard-dialogue-after-the-completion-of-the-quest')));

  const repeat = { player: p, npcId: core.NpcIdentifiers.KANGAI_MAU, stepId: 'WkVGYP', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(repeat));
  assert.equal(p.items.get(core.ItemIdentifiers.SWORDFISH), 5, 'the reward is granted once');
  assert.equal(p.xp.length, 1);

  p.log.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.equal(wire(p), 5, 'login replay keeps completion on varp 200');

  const oldSave = makePlayer();
  oldSave.setAttribute('quest.tribal_totem.stage', 3);
  runtime.sendQuestVarps({ player: oldSave });
  assert.equal(wire(oldSave), 3, 'an existing stage-3 save replays unchanged');
});

test('a full bag still receives all five swordfish through the reward path', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 4);
  p.items.set(core.ItemIdentifiers.TOTEM, 1);
  p.setFull(true);
  const finish = { player: p, npcId: core.NpcIdentifiers.KANGAI_MAU, stepId: 'WkVGYP', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(finish));
  assert.equal(h.quest.getStage(p), 5);
  const held = p.items.get(core.ItemIdentifiers.SWORDFISH) ?? 0;
  const dropped = p.drops.filter(([id]) => id === core.ItemIdentifiers.SWORDFISH).reduce((sum, [, amount]) => sum + amount, 0);
  assert.equal(held + dropped, 5, 'all five swordfish are either held or dropped, never lost');
});
