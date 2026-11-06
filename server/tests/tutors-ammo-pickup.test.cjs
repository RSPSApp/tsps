// Run after `yarn build`: node --test tests/tutors-ammo-pickup.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const plugin = require('../plugins/npcs/Tutors.plugin');

const RANGED_TUTOR = 3217;
const AMMO_PICKUP_ATTRIBUTE = 'ranged:equip-ammo-on-pickup';
const AMMO_PICKUP_VARBIT = 5697;
const AMMO_SLOT = 13;

function item(id, amount) {
  return {
    id, amount,
    getId() { return this.id; },
    getAmount() { return this.amount; },
    incrementAmountBy(delta) { this.amount += delta; },
  };
}

function harness({ varbit = 0 } = {}) {
  const attributes = new Map();
  const varbits = new Map([[AMMO_PICKUP_VARBIT, varbit]]);
  const worn = item(884, 100);
  const deregistered = [];
  const equipment = {
    get: (slot) => slot === AMMO_SLOT ? worn : item(-1, 0),
    refreshItems() {},
  };
  const player = {
    getAttribute(key) { return attributes.get(key); },
    setAttribute(key, value) { attributes.set(key, value); },
    getPacketSender() {
      return {
        getVarbit: (id) => varbits.get(id) ?? 0,
        sendVarbit: (id, value) => varbits.set(id, value),
        sendClientScript() {},
      };
    },
    getEquipment: () => equipment,
    getLastItemPickup: () => ({ reset() {} }),
  };
  const events = {};
  const emitted = [];
  const logins = [];
  let pickup;
  const api = {
    core: {
      NpcIdentifiers: { RANGED_COMBAT_TUTOR: RANGED_TUTOR },
      ItemIdentifiers: {},
      Equipment: { AMMUNITION_SLOT: AMMO_SLOT },
      ItemDefinition: { forId: () => ({ getName: () => 'Iron arrow' }) },
      ItemOnGroundManager: { deregister: (ground) => deregistered.push(ground) },
      Sounds: { sendSound() {} },
      Sound: { PICK_UP_ITEM: 1 },
      Skill: { values: () => [] },
      DialogueChainBuilder: class {},
      NpcDialogue: class {},
      ActionDialogue: class {},
    },
    persistAttribute() {},
    onPlayerLogin(handler) { logins.push(handler); },
    onNpcDialogueVariant() {},
    onNpcDialogueCondition() {},
    onNpcInteraction() {},
    onItemOnNpc() {},
    onGroundItemPickup(handler) { pickup = handler; },
    onCustomEvent(type, handler) { (events[type] ??= []).push(handler); },
    emitCustomEvent(type, payload) {
      emitted.push({ type, payload });
      for (const handler of events[type] ?? []) handler(payload);
    },
  };
  plugin.register(api);
  return {
    player, worn, varbits, attributes, deregistered, events, emitted,
    choose(option) { for (const handler of events['npc-dialogue:choice'] ?? []) handler({ player, npcId: RANGED_TUTOR, option }); },
    login() { for (const handler of logins) handler({ player }); },
    pickup(groundItemId = 884, amount = 5) {
      const ground = { getItem: () => item(groundItemId, amount) };
      const event = { player, groundItem: ground, groundItemId, handled: false };
      pickup(event);
      return event;
    },
  };
}

test('the tutor toggle enables the same setting row as Settings > Ammo-picking behaviour', () => {
  const h = harness();
  h.choose('Automatically equip it.');
  let setting = h.emitted.filter((entry) => entry.type === 'settings:set').at(-1).payload;
  assert.equal(setting.settingId, 305);
  assert.equal(setting.value, 1);

  h.choose('Place it in my inventory.');
  setting = h.emitted.filter((entry) => entry.type === 'settings:set').at(-1).payload;
  assert.equal(setting.value, 0);
  assert.equal(setting.settingId, 305);
});

test('a Settings off after a tutor enable cannot be overridden by the stale legacy true', () => {
  const h = harness();
  h.choose('Automatically equip it.');
  h.attributes.set(AMMO_PICKUP_ATTRIBUTE, true);
  h.varbits.set(AMMO_PICKUP_VARBIT, 1);
  h.attributes.set('settings:values', { [`varbit:${AMMO_PICKUP_VARBIT}`]: 1 });

  h.varbits.set(AMMO_PICKUP_VARBIT, 0);
  h.attributes.set('settings:values', { [`varbit:${AMMO_PICKUP_VARBIT}`]: 0 });

  const event = h.pickup(884, 5);
  assert.equal(event.handled, false);
  assert.equal(h.worn.getAmount(), 100);
  assert.deepEqual(h.deregistered, []);
});

test('turning the setting on after a tutor disable enables pickup', () => {
  const h = harness();
  h.choose('Place it in my inventory.');
  h.attributes.set(AMMO_PICKUP_ATTRIBUTE, false);
  h.varbits.set(AMMO_PICKUP_VARBIT, 1);
  h.attributes.set('settings:values', { [`varbit:${AMMO_PICKUP_VARBIT}`]: 1 });

  const event = h.pickup(884, 5);
  assert.equal(event.handled, true);
  assert.equal(h.worn.getAmount(), 105);
});

test('the Settings-menu varbit alone auto-equips matching ground ammo', () => {
  const h = harness({ varbit: 1 });
  const event = h.pickup(884, 5);
  assert.equal(event.handled, true);
  assert.equal(h.worn.getAmount(), 105);
  assert.equal(h.deregistered.length, 1);
});

test('relog migrates a legacy tutor enable that has no saved setting', () => {
  const h = harness({ varbit: 0 });
  h.attributes.set(AMMO_PICKUP_ATTRIBUTE, true);
  h.login();
  const setting = h.emitted.filter((entry) => entry.type === 'settings:set').at(-1).payload;
  assert.equal(setting.settingId, 305);
  assert.equal(setting.value, 1);
});

test('relog keeps an explicit setting off after a legacy tutor enable', () => {
  const h = harness({ varbit: 0 });
  h.attributes.set(AMMO_PICKUP_ATTRIBUTE, true);
  h.attributes.set('settings:values', { [`varbit:${AMMO_PICKUP_VARBIT}`]: 0 });
  h.login();
  assert.equal(h.emitted.filter((entry) => entry.type === 'settings:set').length, 0);
  const event = h.pickup(884, 5);
  assert.equal(event.handled, false);
});

test('with the setting off, ammo is left to the normal pickup', () => {
  const h = harness({ varbit: 0 });
  const event = h.pickup(884, 5);
  assert.equal(event.handled, false);
  assert.equal(h.worn.getAmount(), 100);
  assert.deepEqual(h.deregistered, []);
});

test('only matching ammunition is diverted to the quiver', () => {
  const h = harness({ varbit: 1 });
  const event = h.pickup(882, 5);
  assert.equal(event.handled, false);
  assert.equal(h.worn.getAmount(), 100);
});

test('the All Settings catalog maps Ammo-picking behaviour to varbit 5697', () => {
  const settings = require('../plugins/interface/data/settings.json').settings;
  assert.equal(settings[305].varbit, AMMO_PICKUP_VARBIT);
});

test('the Settings plugin applies settings:set to varbit 5697 and saves it', () => {
  const Settings = require('../plugins/interface/Settings.plugin');
  const attributes = new Map();
  const sent = [];
  const events = new Map();
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({
      getVarbit: () => 0,
      getVarp: () => 0,
      sendVarbit: (id, value) => sent.push([id, value]),
      sendConfig() {},
      sendClientScript() {},
    }),
  };
  const base = {
    persistAttribute() {},
    onPlayerLogin() {},
    onInterfaceActionButton() {},
    onCustomEvent: (name, handler) => events.set(name, handler),
    core: { CacheDefinitions: { getComponentId: () => -1 } },
  };
  Settings.register(new Proxy(base, { get: (target, prop) => (prop in target ? target[prop] : () => {}) }));
  events.get('settings:set')({ player, settingId: 305, value: 1 });
  assert.deepEqual(sent.at(-1), [AMMO_PICKUP_VARBIT, 1]);
  assert.equal(attributes.get('settings:values')['varbit:5697'], 1);
});
