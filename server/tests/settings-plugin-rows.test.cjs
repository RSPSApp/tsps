// Run after `yarn build`: node --test tests/settings-plugin-rows.test.cjs
// All Settings rows whose state a plugin owns: clicking the row and using the feature's own switch
// change the same state, each click flips it once, and it comes back at login.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');

const Settings = require('../plugins/interface/Settings.plugin');
const AcceptAid = require('../plugins/interface/AcceptAid.plugin');
const Ammo = require('../plugins/items/dwarfcannon/Ammo.DwarfCannon');
const Cannon = require('../plugins/items/dwarfcannon/Common.DwarfCannon');
const LootingBag = require('../plugins/items/LootingBag.plugin');
const Barriers = require('../plugins/areas/ferox/Barriers.FeroxEnclave');
const Charter = require('../plugins/world/CharterShips.plugin');
const DrinkCrate = require('../plugins/skills/sailing/charting/DrinkCrate.Charting');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');

let core, Data, Patches, Services, clickSetting, restoreSettings;
const searchOrder = [];
let actorIndex = 300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2435, 3414);
  Data = require('../plugins/skills/farming/Data.Farming');
  Patches = require('../plugins/skills/farming/Patches.Farming');
  Services = require('../plugins/skills/farming/Services.Farming');
  PluginManager.emitServerStartup({});
  // The All Settings click handler itself, with every other plugin listening on the real event bus.
  const api = {
    core,
    emitCustomEvent: (name, payload) => PluginManager.emitCustomEvent(name, payload),
    onInterfaceActionButton: (_id, fn) => { if (fn.name === 'clickSetting') clickSetting = fn; },
    onPlayerLogin: (fn) => { if (fn.name === 'restoreSettings') restoreSettings = fn; },
  };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  // The search view lists every setting: categories, then their rows, in enum order.
  for (const [, structId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    for (const [, s] of [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b)) {
      searchOrder.push(Number(CacheDefinitions.getStructParams(Number(s)).get(1077)));
    }
  }
});
after(() => PluginManager.emitServerShutdown({}));

const PERSISTED = [
  AcceptAid.ACCEPT_AID_ATTRIBUTE, Cannon.LOAD_X_ATTRIBUTE, LootingBag._test.STORE_ALL_ATTRIBUTE, LootingBag._test.SKIP_SUPPLIES_ATTRIBUTE,
  'alfred-grimhands-barcrawl:auto-smash', 'levers:skip-wilderness-warning', Barriers.DONT_ASK_ATTRIBUTE,
  Charter._test.SKIP_CONFIRMATION_ATTRIBUTE, DrinkCrate.NO_WARNING_ATTRIBUTE, 'settings:values',
];

function actor(t, x = 3093, y = 3493) {
  const transport = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(transport));
  p.setUsername(`setrows${actorIndex}`);
  p.setIndex(actorIndex++);
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, 0));
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (text) => { messages.push(text); return p.getPacketSender(); });
  const connection = new ClientConnection(transport);
  connection.player = p;
  return { p, connection, messages };
}

/** The same player logging in again: their saved attributes on a fresh client, then every login hook. */
function relog(t, f) {
  const again = actor(t);
  for (const key of [...PERSISTED, Patches.FARM_ATTRIBUTE, 'ironman:mode']) {
    const value = f.p.getAttribute(key);
    if (value !== undefined) again.p.setAttribute(key, structuredClone(value));
  }
  restoreSettings({ player: again.p });
  PluginManager.emitPlayerLogin({ player: again.p, username: again.p.getUsername() });
  return again;
}

/** Clicks the row in the All Settings search results, as the client does. */
function click(p, settingId) {
  const slot = searchOrder.indexOf(settingId);
  assert.ok(slot >= 0, `setting ${settingId} is listed`);
  p.setAttribute('settings-view', -1);
  return clickSetting({ player: p, slot });
}

const varbit = (p, id) => p.getPacketSender().getVarbit(id);
const varbitId = (name) => CacheDefinitions.getVarbitId(name);

async function input(f, ...packets) {
  await f.connection.dispatch(packets);
  f.connection.processTurnPackets();
  for (let i = 0; i < 3; i++) {
    core.TaskManager.process();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
  }
}
const resume = (f, n) => input(f, { type: 'dialogue_continue', widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: n });

test('Accept aid (59): the row and the side panel button flip the same setting, and Ironmen are refused', (t) => {
  const f = actor(t);
  const aid = varbitId('option_acceptaid');
  assert.equal(click(f.p, 59), true);
  assert.equal(f.p.getAttribute(AcceptAid.ACCEPT_AID_ATTRIBUTE), false, 'row: off');
  assert.equal(varbit(f.p, aid), 0);
  AcceptAid._test.toggleAcceptAid({ player: f.p });
  assert.equal(f.p.getAttribute(AcceptAid.ACCEPT_AID_ATTRIBUTE), true, 'side panel: on again');
  click(f.p, 59);
  assert.equal(f.p.getAttribute(AcceptAid.ACCEPT_AID_ATTRIBUTE), false, 'row after the side panel: off');
  assert.equal(relog(t, f).p.getAttribute(AcceptAid.ACCEPT_AID_ATTRIBUTE), false, 'kept at login');

  const iron = actor(t);
  iron.p.setAttribute('ironman:mode', 'ironman');
  iron.p.setAttribute(AcceptAid.ACCEPT_AID_ATTRIBUTE, false);
  click(iron.p, 59);
  assert.equal(iron.p.getAttribute(AcceptAid.ACCEPT_AID_ATTRIBUTE), false, 'an Ironman stays off');
  assert.equal(varbit(iron.p, aid), 0);
  assert.deepEqual(iron.messages, ['Ironmen do not accept aid.']);
});

test("Load-x (450): the row asks the cannon's own question and the answer is the cannon's Load X", (t) => {
  const f = actor(t);
  assert.equal(click(f.p, 450), true);
  const action = f.p.getEnteredAmountAction();
  assert.ok(action, 'the Load-X prompt is open');
  action.execute(20);
  assert.equal(f.p.getAttribute(Cannon.LOAD_X_ATTRIBUTE), 20);
  assert.equal(varbit(f.p, 17870), 20);
  assert.deepEqual(f.messages, ['You will now load 20 cannonballs when using Load-x.']);
  Ammo.setLoadX(f.p, 7);
  click(f.p, 450);
  f.p.getEnteredAmountAction().execute(12);
  assert.equal(f.p.getAttribute(Cannon.LOAD_X_ATTRIBUTE), 12, 'the row after the cannon');
  assert.equal(varbit(relog(t, f).p, 17870), 12, 'kept at login');
});

test('Looting bag (352, 353): the rows and the bag menu flip the same choices and send their varbits', async (t) => {
  const f = actor(t);
  const { STORE_ALL_ATTRIBUTE, SKIP_SUPPLIES_ATTRIBUTE } = LootingBag._test;
  click(f.p, 352);
  assert.equal(f.p.getAttribute(STORE_ALL_ATTRIBUTE), true);
  assert.equal(varbit(f.p, 6068), 1);
  click(f.p, 353);
  assert.equal(f.p.getAttribute(SKIP_SUPPLIES_ATTRIBUTE), true);
  assert.equal(varbit(f.p, 15310), 1);
  assert.equal(f.messages.length, 0, 'the rows say nothing');
  // The bag's own Settings menu: its first line flips Store all back.
  LootingBag._test.settings({ player: f.p, item: new core.Item(11941, 1) });
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p).options.slice(0, 2),
    ['Ask how many items to store when using items on the bag.', 'Put supplies into the looting bag.']);
  MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: 1 });
  assert.equal(f.p.getAttribute(STORE_ALL_ATTRIBUTE), false, 'the bag menu: off');
  assert.equal(varbit(f.p, 6068), 0, 'and its varbit with it');
  click(f.p, 352);
  assert.equal(f.p.getAttribute(STORE_ALL_ATTRIBUTE), true, 'the row after the bag menu: on');
  click(f.p, 352);
  assert.equal(varbit(f.p, 6068), 0);
  const back = relog(t, f);
  assert.equal(varbit(back.p, 6068), 0);
  assert.equal(varbit(back.p, 15310), 1, 'sent at login');
});

test('Automatically smash empty vials (380): locked until the Barcrawl is done, then the same switch as the barbarian guard', (t) => {
  const quest = getRegisteredQuests().findLast((entry) => entry.key === 'alfred-grimhands-barcrawl');
  const f = actor(t);
  click(f.p, 380);
  assert.deepEqual(f.messages, ["You must have completed the Alfred Grimhand's Barcrawl miniquest to access this setting."]);
  assert.equal(varbit(f.p, 5668), 0);
  quest.setStage(f.p, 2);
  click(f.p, 380);
  assert.equal(f.p.getAttribute('alfred-grimhands-barcrawl:auto-smash'), true);
  assert.equal(varbit(f.p, 5668), 1);
  PluginManager.emitCustomEvent('npc-dialogue:action', { player: f.p, action: 'barcrawl:auto-smash-off', stepId: 'barcrawl:auto-smash-off', handled: false });
  assert.equal(varbit(f.p, 5668), 0, "the guard's switch: off");
  click(f.p, 380);
  assert.equal(varbit(f.p, 5668), 1, 'the row after the guard: on');
  assert.equal(varbit(relog(t, f).p, 5668), 1, 'kept at login');
});

test("Automatically smash empty plant pots (381): locked until Otto's Farming training is done, then the same switch as Otto's", (t) => {
  const f = actor(t);
  click(f.p, 381);
  assert.deepEqual(f.messages, ['You must complete the Farming portion of Barbarian Training to access this setting.']);
  const farm = Patches.farmFor(f.p);
  farm.barbarian = { planting: 3, smashing: 3, autoSmash: true };
  click(f.p, 381);
  assert.equal(farm.barbarian.autoSmash, false);
  assert.equal(varbit(f.p, 9614), 0);
  // Otto's "Toggle automatic pot-smashing".
  let options;
  t.mock.method(Patches, 'choose', (_p, entries) => { options = entries; });
  Services.farmingNpc({ player: f.p, npc: { getLocation: () => f.p.getLocation() },
    definition: { getName: () => 'Otto Godblessed', getActions: () => ['Talk-to'] }, clickType: 1 });
  options.find(([text]) => text === 'Toggle automatic pot-smashing')[1]();
  assert.equal(farm.barbarian.autoSmash, true);
  assert.equal(varbit(f.p, 9614), 1);
  click(f.p, 381);
  assert.equal(farm.barbarian.autoSmash, false, 'the row after Otto');
  click(f.p, 381);
  assert.equal(varbit(relog(t, f).p, 9614), 1, 'sent at login');
});

for (const [settingId, name, attribute, varbitName] of [
  [253, 'Wilderness teleport lever warning', 'levers:skip-wilderness-warning', 'wilderness_lever_blockwarning_standard'],
  [255, 'Ferox Enclave exit warning', Barriers.DONT_ASK_ATTRIBUTE, 'wildy_hub_warning'],
  [294, 'Charter Ships confirmation', Charter._test.SKIP_CONFIRMATION_ATTRIBUTE, 'settings_warning_confirmation_charter_ships'],
  [455, 'Forgotten drink crate warning', DrinkCrate.NO_WARNING_ATTRIBUTE, 'sailing_charting_drink_crate_warning'],
]) {
  test(`${name} (${settingId}): the row flips the warning's own "don't ask again", both ways, once per click`, (t) => {
    const id = varbitId(varbitName);
    const f = actor(t);
    click(f.p, settingId);
    assert.equal(f.p.getAttribute(attribute), true, 'row: no longer asks');
    assert.equal(varbit(f.p, id), 1);
    click(f.p, settingId);
    assert.equal(f.p.getAttribute(attribute), false, 'row again: asks');
    assert.equal(varbit(f.p, id), 0);
    // As the feature's "Yes, and don't ask again." leaves it, then the row turns the warning back on.
    f.p.setAttribute(attribute, true);
    f.p.getPacketSender().sendVarbit(id, 1);
    click(f.p, settingId);
    assert.equal(f.p.getAttribute(attribute), false);
    assert.equal(varbit(f.p, id), 0);
    click(f.p, settingId);
    assert.equal(varbit(relog(t, f).p, id), 1, 'kept at login');
    assert.equal(f.messages.length, 0);
  });
}

test('Farming protection payment confirmation (295): the gardener\'s "don\'t ask again" and the row are one setting', async (t) => {
  const f = actor(t, 2435, 3415);
  click(f.p, 295);
  assert.equal(varbit(f.p, 98), 1, 'row: pay without asking');
  click(f.p, 295);
  assert.equal(varbit(f.p, 98), 0, 'row again: ask');

  const patch = Data.CACHE.patches.find((p) => p.x === 2435 && p.y === 3414);
  const coconutNote = core.ItemDefinition.forId(Data.itemId('Coconut')).getNoteId();
  const gardener = core.NPC.create(core.NpcIdentifiers.PRISSY_SCILLA, new core.Location(2436, 3415, 0));
  core.World.getNpcs().add(gardener);
  t.after(() => core.World.getNpcs().remove(gardener));
  const pay = gardener.getCurrentDefinition(f.p).getActions().findIndex((a) => a?.toLowerCase() === 'pay') + 1;
  const plant = () => {
    const state = Patches.stateFor(f.p, patch);
    Object.assign(state, { crop: 'MAGIC', stage: 0, status: 'growing', checked: false, protected: false, nextAt: Date.now() + 3600000 });
    f.p.getInventory().add(new core.Item(coconutNote, 25), false);
    return state;
  };
  const current = () => f.p.getDialogueManager().getCurrent();

  let state = plant();
  await input(f, { type: 'npc_option', index: gardener.getIndex(), clickType: pay });
  assert.equal(current().getTitle(), 'Pay 25 coconuts?');
  await resume(f, 3);
  assert.equal(state.protected, true);
  assert.equal(varbit(f.p, 98), 1, '"Yes and don\'t ask again." turns the row on');
  assert.equal(Patches.farmFor(f.p).gardenerNoAsk, undefined, 'no second copy in the farm state');

  state = plant();
  await input(f, { type: 'npc_option', index: gardener.getIndex(), clickType: pay });
  assert.equal(state.protected, true, 'paid without asking');

  click(f.p, 295);
  assert.equal(varbit(f.p, 98), 0, 'the row after the gardener: ask again');
  state = plant();
  await input(f, { type: 'npc_option', index: gardener.getIndex(), clickType: pay });
  assert.equal(current()?.getTitle?.(), 'Pay 25 coconuts?', 'asks again');
  assert.equal(state.protected, false);
});

test('Farming protection payment confirmation (295): an old save\'s "don\'t ask again" moves onto the setting once', (t) => {
  const old = actor(t);
  old.p.setAttribute(Patches.FARM_ATTRIBUTE, { offset: 0, patches: {}, tools: {}, gardenerNoAsk: true });
  const f = relog(t, old);
  assert.equal(varbit(f.p, 98), 1);
  assert.equal(f.p.getAttribute('settings:values')['varbit:98'], 1, 'saved as the setting');
  assert.equal('gardenerNoAsk' in Patches.farmFor(f.p), false, 'the old flag is gone');
  click(f.p, 295);
  const again = relog(t, f);
  assert.equal(varbit(again.p, 98), 0, 'turning it off sticks: the old flag does not come back');

  const never = actor(t);
  never.p.setAttribute(Patches.FARM_ATTRIBUTE, { offset: 0, patches: {}, tools: {}, gardenerNoAsk: false });
  const fresh = relog(t, never);
  assert.equal(varbit(fresh.p, 98), 0);
  assert.equal('gardenerNoAsk' in Patches.farmFor(fresh.p), false);
});
