// Run after `yarn build`: node --test tests/ibans-staff.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { PluginManager } = require('../dist/plugins/PluginManager');
const staffPlugin = require('../plugins/items/IbansStaff.plugin');
const core = PluginManager.getCoreApi();
const { IBANS_STAFF, IBANS_STAFF_U_, COINS } = core.ItemIdentifiers;
const IBAN_BLAST = core.CombatSpells.IBAN_BLAST;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  new NpcDefinitionLoader().load();
});

function fixture(t) {
  const player = new Player(null);
  const messages = [];
  const handlers = { custom: new Map(), items: [], disabled: [], conditions: [], startup: [] };
  let target = null;
  player.setRegistered(true);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(player, 'sendMessage', (message) => messages.push(message));
  t.mock.method(player.getCombat(), 'getTarget', () => target);
  const api = {
    core,
    onServerStartup(handler) { handlers.startup.push(handler); },
    onSpellDisabled(handler) { handlers.disabled.push(handler); },
    onItemAction(name, actions) { handlers.items.push({ name, actions }); },
    onNpcDialogueCondition(handler) { handlers.conditions.push(handler); },
    onCustomEvent(name, handler) { handlers.custom.set(name, [...(handlers.custom.get(name) ?? []), handler]); },
  };
  staffPlugin.register(api);
  for (const start of handlers.startup) start();
  const emit = (name, event) => { for (const handler of handlers.custom.get(name) ?? []) handler(event); };
  return {
    player, messages, handlers, emit,
    aim(next) { target = next; },
    wield(id) {
      player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(id));
      return player.getEquipment().get(core.Equipment.WEAPON_SLOT);
    },
    cast(spell = IBAN_BLAST) { emit('magic:cast-committed', { player, spell }); },
    canCast(spell = IBAN_BLAST) {
      const event = { player, spell, spellId: spell.spellId(), disabled: null };
      for (const handler of handlers.disabled) handler(event);
      return event.disabled !== true;
    },
  };
}

const npcTarget = { isPlayer: () => false };
const playerTarget = { isPlayer: () => true };
const charges = (item) => staffPlugin._test.chargesOf(item);

test('a staff without a saved count is full: 120, and 2,500 for the upgraded staff', (t) => {
  const f = fixture(t);
  assert.equal(charges(new core.Item(IBANS_STAFF)), 120);
  assert.equal(charges(new core.Item(IBANS_STAFF_U_)), 2500);
  f.messages.length = 0;
});

test('Iban Blast spends one charge on an NPC and two on a player', (t) => {
  const f = fixture(t);
  const staff = f.wield(IBANS_STAFF);
  f.aim(npcTarget);
  f.cast();
  assert.equal(charges(staff), 119);
  f.aim(playerTarget);
  f.cast();
  assert.equal(charges(staff), 117);
});

test('the upgraded staff spends the same charges from 2,500', (t) => {
  const f = fixture(t);
  const staff = f.wield(IBANS_STAFF_U_);
  f.aim(playerTarget);
  f.cast();
  assert.equal(charges(staff), 2498);
});

test('other spells cost no charges', (t) => {
  const f = fixture(t);
  const staff = f.wield(IBANS_STAFF);
  f.aim(npcTarget);
  f.cast(core.CombatSpells.FIRE_BLAST);
  assert.equal(charges(staff), 120);
});

test('an empty staff cannot cast Iban Blast and says so; other spells still work', (t) => {
  const f = fixture(t);
  const staff = f.wield(IBANS_STAFF);
  staffPlugin._test.setCharges(staff, 1);
  f.aim(npcTarget);
  assert.equal(f.canCast(), true);
  f.cast();
  assert.equal(charges(staff), 0);
  assert.equal(f.canCast(), false);
  assert.match(f.messages.at(-1), /no charges/);
  assert.equal(f.canCast(core.CombatSpells.FIRE_BLAST), true);
});

test('a player cast on the last charge cannot take it below zero', (t) => {
  const f = fixture(t);
  const staff = f.wield(IBANS_STAFF);
  staffPlugin._test.setCharges(staff, 1);
  f.aim(playerTarget);
  f.cast();
  assert.equal(charges(staff), 0);
});

test('Check reports the charges left', (t) => {
  const f = fixture(t);
  const check = f.handlers.items.find((entry) => entry.name === "Iban's staff").actions.Check;
  const staff = new core.Item(IBANS_STAFF);
  staffPlugin._test.setCharges(staff, 1);
  check({ player: f.player, item: staff });
  assert.equal(f.messages.at(-1), 'Your staff has 1 charge left.');
  const upgraded = f.handlers.items.find((entry) => entry.name === "Iban's staff (u)").actions.Check;
  upgraded({ player: f.player, item: new core.Item(IBANS_STAFF_U_) });
  assert.equal(f.messages.at(-1), 'Your staff has 2,500 charges left.');
});

function darkMage(f, stepId, extra = {}) {
  return { player: f.player, npcId: core.NpcIdentifiers.DARK_MAGE_2, stepId, ...extra };
}

test('the Dark Mage recharges a used staff for 100,000 coins and refuses a full one', (t) => {
  const f = fixture(t);
  const inventory = f.player.getInventory();
  inventory.setItem(0, new core.Item(IBANS_STAFF));
  inventory.setItem(1, new core.Item(COINS, 150000));
  staffPlugin._test.setCharges(inventory.getItems()[0], 7);
  const answer = (stepId) => f.handlers.conditions[0](darkMage(f, stepId));
  assert.equal(answer('tD91in'), false);
  assert.equal(answer('hReddn'), false);

  const payment = darkMage(f, 'LfIGD_', { handled: false });
  f.emit('npc-dialogue:action', payment);
  assert.equal(payment.handled, true);
  assert.equal(charges(inventory.getItems()[0]), 120);
  assert.equal(inventory.getAmount(COINS), 50000);

  assert.equal(answer('tD91in'), true);
  assert.equal(answer('hReddn'), true);
  const again = darkMage(f, 'LfIGD_', { handled: false });
  f.emit('npc-dialogue:action', again);
  assert.equal(inventory.getAmount(COINS), 50000);
});

test('the upgraded staff costs 250,000 coins to recharge', (t) => {
  const f = fixture(t);
  const inventory = f.player.getInventory();
  inventory.setItem(0, new core.Item(IBANS_STAFF_U_));
  inventory.setItem(1, new core.Item(COINS, 200000));
  staffPlugin._test.setCharges(inventory.getItems()[0], 10);
  assert.equal(f.handlers.conditions[0](darkMage(f, 'hReddn')), true);
  inventory.setItem(1, new core.Item(COINS, 300000));
  f.emit('npc-dialogue:action', darkMage(f, 'LfIGD_', { handled: false }));
  assert.equal(charges(inventory.getItems()[0]), 2500);
  assert.equal(inventory.getAmount(COINS), 50000);
});

test('the Dark Mage answers nothing for other NPCs', (t) => {
  const f = fixture(t);
  f.player.getInventory().setItem(0, new core.Item(IBANS_STAFF));
  const other = darkMage(f, 'tD91in', { npcId: core.NpcIdentifiers.DARK_MAGE });
  assert.equal(f.handlers.conditions[0](other), null);
});

// Wiki (Iban's staff (o), Iban's staff (u) (o)): the ornament kit only changes the look, so the ornamented staves
// hold and spend charges like the staff they decorate.
test('the ornamented staves hold and spend charges like the staff they decorate', (t) => {
  const f = fixture(t);
  const { IBANS_STAFF_O_, IBANS_STAFF_U_O_ } = core.ItemIdentifiers;
  assert.equal(charges(new core.Item(IBANS_STAFF_O_)), 120);
  assert.equal(charges(new core.Item(IBANS_STAFF_U_O_)), 2500);
  const staff = f.wield(IBANS_STAFF_O_);
  f.aim(npcTarget);
  f.cast();
  assert.equal(charges(staff), 119);
  staffPlugin._test.setCharges(staff, 0);
  assert.equal(f.canCast(), false);
  assert.deepEqual(f.messages.slice(-1), ['Your staff has no charges left.']);
  assert.ok(f.handlers.items.some(({ name }) => name === "Iban's staff (u) (o)"));
});
