// From server/: node --test tests/bank-pin.test.cjs (after yarn build).
//
// The Bank PIN against the OSRS Wiki (Bank_PIN) and the rsprox recordings in
// plugins/interface/data/bank-pin.json: the settings screen for each state, setting, changing,
// deleting and cancelling a PIN, the keypad's answer, the bank's lock, wrong entries and their
// lockouts, the logout behaviour, and the PIN never stored as digits.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Keypad, Settings, tasks, time, bankOpen;
const DAY = 24 * 60 * 60 * 1000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/interface/bankpin/Common.BankPin');
  Keypad = require('../plugins/interface/bankpin/Keypad.BankPin');
  Settings = require('../plugins/interface/bankpin/Settings.BankPin');
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
      Bank: { isOpen: (player) => bankOpen.has(player) },
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
  Common.setClock(() => time);
});

beforeEach(() => {
  tasks = [];
  time = 1_000_000;
  bankOpen = new Set();
});

function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    const due = tasks;
    tasks = [];
    for (const task of due) if (task.tick()) tasks.push(task);
  }
}

function fakePlayer(name = 'pintest') {
  const player = {
    attributes: {}, messages: [], strings: {}, hidden: {}, interface: -1, amount: null, banksOpened: 0,
    getUsername: () => name,
    getInterfaceId: () => player.interface,
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    sendMessage: (m) => player.messages.push(m),
    setEnteredAmountAction: (action) => { player.amount = action; },
    getCurrentBankTab: () => 0,
    getBank: () => ({ open: () => { player.banksOpened++; bankOpen.add(player); } }),
    getPacketSender: () => ({
      sendInterfaceRemoval: () => { player.interface = -1; },
      sendInterface: (id) => { player.interface = id; },
      sendString: (text, uid) => { player.strings[uid] = text; },
      sendInterfaceDisplayState: (uid, hide) => { player.hidden[uid] = hide; },
    }),
  };
  return player;
}

const u = () => Common.ids.uids;
/** Answers the open keypad, as the client's script does (one amount for the four digits). */
function enter(player, pin) {
  const action = player.amount;
  assert.ok(action, 'a keypad is waiting');
  player.amount = null;
  action.execute(Number(pin));
}
const click = (player, uid) => {
  const event = { player, groupId: uid >> 16, childId: uid & 0xffff, handled: false };
  Settings.onClick(event);
  return event;
};
const shown = (player, uid) => player.hidden[uid] === false;

/** A player with an active PIN. */
function withPin(pin = '1234') {
  const player = fakePlayer();
  Common.set(player, 'hash', Common.hash(player, pin));
  return player;
}

test('the interfaces and components resolve from the cache', () => {
  assert.deepEqual(Common.ids.groups, { settings: 14, keypad: 213 });
  assert.equal(u().settings.logoutToggle, (14 << 16) | 25, 'the recorded logout button');
  assert.equal(u().keypad.title, (213 << 16) | 2);
});

test('the Banker\'s "check my PIN settings": no PIN shows Set a PIN and the delay', () => {
  const player = fakePlayer();
  const action = { player, action: 'open_interface', target: 'Bank PIN', handled: false };
  Settings.onAction(action);
  assert.deepEqual([action.handled, action.end], [true, true]);
  tick();
  assert.equal(player.interface, 14);
  assert.equal(player.strings[u().settings.status], 'You do not have a PIN');
  assert.equal(player.strings[u().settings.delay], '7 days');
  assert.equal(player.strings[u().settings.logout], 'Always lock');
  assert.equal(player.strings[u().settings.message], Common.data.texts.message);
  assert.equal(shown(player, u().settings.noPin), true);
  assert.equal(shown(player, u().settings.hasPin), false);
  assert.equal(Settings.onAction({ player, action: 'open_interface', target: 'Bank', handled: false }), undefined);
});

test('setting a PIN: entered twice, pending for the delay, then active; a mismatch sets nothing', () => {
  const player = fakePlayer();
  Settings.show(player);
  click(player, u().settings.setPin);
  assert.equal(player.interface, 213);
  assert.equal(player.strings[u().keypad.title], 'Bank of Gielinor');
  enter(player, '0042');
  tick();
  assert.equal(player.strings[u().keypad.instruction], 'Now please enter that number again.');
  enter(player, '0042');
  assert.equal(Common.hasPin(player), false, 'not yet');
  assert.equal(Common.pendingPin(player), true);
  assert.equal(player.strings[u().settings.status], 'PIN coming soon');
  assert.equal(shown(player, u().settings.pending), true);
  assert.equal(player.attributes['bank-pin:pending-hash'].includes('0042'), false, 'never the digits');
  time += 7 * DAY;
  Common.settle(player);
  assert.equal(Common.hasPin(player), true);
  assert.equal(player.messages.at(-1), 'Your Bank PIN is now active.');

  const other = fakePlayer();
  Settings.show(other);
  click(other, u().settings.setPin);
  enter(other, '1111');
  tick();
  enter(other, '2222');
  assert.equal(Common.pendingPin(other), false);
  assert.equal(other.strings[u().settings.message], 'Those numbers did not match. Your PIN has not been set.');
});

test('0000 is a PIN: the keypad takes 0', () => {
  const player = withPin('0000');
  Settings.canBank({ player, allow: null, source: 'open' });
  assert.equal(player.amount.acceptsZero, true);
  enter(player, '0000');
  assert.equal(player.messages.at(-1), 'You have correctly entered your PIN.');
});

test('the bank: locked asks for the PIN, then opens; unlocked until logout; no PIN, no ask', () => {
  const player = withPin('1234');
  const event = { player, allow: null, source: 'open' };
  Settings.canBank(event);
  assert.equal(event.allow, false);
  assert.equal(player.interface, 213);
  enter(player, '1234');
  assert.equal(player.messages.at(-1), 'You have correctly entered your PIN.');
  tick();
  assert.equal(player.banksOpened, 1);
  bankOpen.clear();
  const again = { player, allow: null, source: 'open' };
  Settings.canBank(again);
  assert.equal(again.allow, null, 'unlocked this session');
  Settings.logout({ player });
  const after = { player, allow: null, source: 'open' };
  Settings.canBank(after);
  assert.equal(after.allow, false, 'locked again after logout');

  const free = fakePlayer();
  const none = { player: free, allow: null, source: 'open' };
  Settings.canBank(none);
  assert.equal(none.allow, null);
  const tabs = withPin();
  bankOpen.add(tabs);
  const switching = { player: tabs, allow: null, source: 'open' };
  Settings.canBank(switching);
  assert.equal(switching.allow, null, 'tab switches in an open bank pass');
});

test('wrong entries: a lockout after two, three and four, kept over logout; a right one clears it', () => {
  const player = withPin('1234');
  const wrong = () => {
    Settings.canBank({ player, allow: null, source: 'open' });
    if (player.amount) enter(player, '9999');
  };
  wrong();
  assert.equal(Common.get(player, 'failures'), 1);
  assert.equal(Keypad.lockedSeconds(player), 0);
  wrong();
  assert.equal(Keypad.lockedSeconds(player), 10);
  Settings.canBank({ player, allow: null, source: 'open' });
  assert.equal(player.amount, null, 'no keypad while locked out');
  time += 10_000;
  wrong();
  assert.equal(Keypad.lockedSeconds(player), 15);
  time += 15_000;
  Settings.logout({ player });
  Settings.login({ player });
  wrong();
  assert.equal(Keypad.lockedSeconds(player), 600, 'the fourth: 10 minutes, the count kept over logout');
  time += 600_000;
  Settings.canBank({ player, allow: null, source: 'open' });
  enter(player, '1234');
  assert.equal(Common.get(player, 'failures'), 0);
});

test('change and delete need the current PIN; delete asks yes or no', () => {
  const player = withPin('1234');
  Settings.show(player);
  assert.equal(shown(player, u().settings.hasPin), true);
  click(player, u().settings.changePin);
  enter(player, '1234');
  tick();
  enter(player, '5678');
  tick();
  enter(player, '5678');
  assert.equal(Common.get(player, 'hash'), Common.hash(player, '5678'));
  assert.equal(player.messages.at(-1), 'Your PIN has been changed.');

  click(player, u().settings.deletePin);
  enter(player, '5678');
  tick();
  assert.equal(shown(player, u().settings.warning), true);
  assert.equal(player.strings[u().settings.question], 'Do you really wish to delete your PIN?');
  click(player, u().settings.no);
  assert.equal(Common.hasPin(player), true);
  click(player, u().settings.deletePin);
  enter(player, '5678');
  tick();
  click(player, u().settings.yes);
  assert.equal(Common.hasPin(player), false);
  assert.equal(player.messages.at(-1), 'Your PIN has been deleted.');

  const wrong = withPin('1234');
  Settings.show(wrong);
  click(wrong, u().settings.changePin);
  enter(wrong, '0001');
  assert.equal(Common.get(wrong, 'hash'), Common.hash(wrong, '1234'), 'unchanged');
});

test('"I don\'t know it." deletes the PIN after the delay, unless cancelled', () => {
  const player = withPin('1234');
  Settings.canBank({ player, allow: null, source: 'open' });
  assert.equal(player.hidden[u().keypad.forgotten], false, 'offered');
  enter(player, String(Keypad.FORGOTTEN_ANSWER));
  assert.equal(player.amount, null);
  assert.equal(Common.pendingDelete(player), true);
  Settings.show(player);
  assert.equal(player.strings[u().settings.status], 'PIN being deleted');
  click(player, u().settings.cancelPending);
  enter(player, '1234');
  tick();
  assert.equal(Common.pendingDelete(player), false, 'cancelled, with the PIN');
  Settings.forgot(player);
  time += 7 * DAY;
  Common.settle(player);
  assert.equal(Common.hasPin(player), false);
  assert.equal(player.messages.at(-1), 'Your Bank PIN has now been deleted.');
});

test('the recovery delay and the logout behaviour toggle; stay unlocked within 5 minutes offline', () => {
  const player = withPin('1234');
  Settings.show(player);
  click(player, u().settings.hasPinDelay);
  enter(player, '1234');
  tick();
  assert.equal(player.strings[u().settings.delay], '3 days');
  click(player, u().settings.logoutToggle);
  enter(player, '1234');
  tick();
  assert.equal(player.strings[u().settings.logout], 'Lock after 5 minutes offline');
  Common.unlock(player);
  Settings.logout({ player });
  time += 4 * 60 * 1000;
  Settings.login({ player });
  assert.equal(Common.isUnlocked(player), true, 'back within 5 minutes');
  Settings.logout({ player });
  time += 6 * 60 * 1000;
  Settings.login({ player });
  assert.equal(Common.isUnlocked(player), false);
  click(player, u().settings.logoutToggle);
  enter(player, '1234');
  tick();
  assert.equal(player.strings[u().settings.message], 'On login, your PIN will always be locked.', 'as recorded');
});

test("agent:advance-time brings a pending PIN forward (for testing)", () => {
  const player = fakePlayer();
  Common.set(player, "pendingHash", Common.hash(player, "4321"));
  Common.set(player, "pendingAt", time + 7 * DAY);
  const event = { player, ms: 7 * DAY, handledBy: [] };
  Settings.advanceTime(event);
  assert.equal(Common.hasPin(player), true);
  assert.deepEqual(event.handledBy, ["BankPin"]);
  const idle = { player: fakePlayer(), ms: DAY, handledBy: [] };
  Settings.advanceTime(idle);
  assert.deepEqual(idle.handledBy, [], "nothing timed, not listed");
});

test('Seed Vault bank-policy query bypasses the PIN listener without unlocking it', () => {
  const player = withPin('1234');
  assert.equal(Common.hasPin(player), true);
  assert.equal(Common.isUnlocked(player), false);
  const saved = { ...player.attributes };
  const vault = { player, allow: null, source: 'seed-vault' };
  Settings.canBank(vault);
  assert.equal(vault.allow, null, 'the PIN listener leaves the Vault query unanswered');
  assert.deepEqual(player.attributes, saved, 'the PIN state is unchanged');
  assert.equal(player.interface, -1, 'no keypad is opened');
  assert.equal(player.amount, null);
  assert.deepEqual(player.messages, []);
  assert.equal(Common.isUnlocked(player), false);
  const other = { player, allow: null, source: 'servant' };
  Settings.canBank(other);
  assert.equal(other.allow, false, 'a different remote bank query is still refused');
  assert.equal(player.messages.at(-1), 'You need to enter your Bank PIN at a bank first.');
  assert.equal(player.interface, -1);
});

test("deposit boxes need no PIN; any other check while locked is refused; the keypad's Exit does nothing", () => {
  const player = withPin("1234");
  const deposit = { player, allow: null, source: "deposit-box" };
  Settings.canBank(deposit);
  assert.equal(deposit.allow, null);
  const servant = { player, allow: null };
  Settings.canBank(servant);
  assert.equal(servant.allow, false);
  assert.equal(player.interface, -1, "no keypad for a remote check");
  assert.equal(player.messages.at(-1), "You need to enter your Bank PIN at a bank first.");
  Settings.canBank({ player, allow: null, source: "open" });
  enter(player, String(Keypad.EXIT_ANSWER));
  assert.equal(Common.get(player, "failures") || 0, 0, "not a wrong entry");
  assert.equal(Common.isUnlocked(player), false);
});

test("the offline window starts only from a session that entered the PIN", () => {
  const player = withPin("1234");
  Settings.show(player);
  Settings.canBank({ player, allow: null, source: "open" });
  player.interface = 14;
  Common.set(player, "stayUnlocked", true);
  Settings.logout({ player });
  time += 60 * 1000;
  Settings.login({ player });
  assert.equal(Common.isUnlocked(player), false, "a password-only session cannot unlock itself");
});

test("settings buttons act only with the screen open, from the layer shown, and with the PIN", () => {
  const player = withPin("1234");
  click(player, u().settings.hasPinDelay);
  assert.equal(Common.delayDays(player), 7, "screen not open: nothing");
  Settings.show(player);
  click(player, u().settings.setPin);
  assert.equal(player.interface, 14, "Set a PIN is not on the has-a-PIN layer");
  assert.equal(Common.pendingPin(player), false);
  click(player, u().settings.hasPinDelay);
  assert.equal(player.interface, 213, "the PIN first");
  enter(player, "9999");
  assert.equal(Common.delayDays(player), 7, "wrong PIN: unchanged");
});

// The other locks (Wiki: "Situations requiring a PIN"): "bank-pin:guard" and the point shops.
test('the guard: no PIN or an entered one passes; a locked PIN asks under the feature title, then resumes once', () => {
  const Guard = require('../plugins/interface/bankpin/Guard.BankPin');
  Guard.attach({ onCustomEvent() {}, onCanShop() {} }, { onForgotten: Settings.forgot });
  const free = fakePlayer();
  const open = { player: free, feature: 'grand-exchange', resume: () => assert.fail('no keypad, no resume') };
  Guard.guard(open);
  assert.equal(open.locked, undefined, 'no PIN: nothing asked');

  const player = withPin('2468');
  let resumed = 0;
  let request = { player, feature: 'grand-exchange', resume: () => resumed++ };
  Guard.guard(request);
  assert.equal(request.locked, true);
  assert.equal(player.interface, 213);
  assert.equal(player.strings[u().keypad.title], 'Grand Exchange', 'recorded (rsprox 3250)');
  assert.equal(shown(player, u().keypad.forgotten), true, '"I don\'t know it." is offered');
  enter(player, '1357');
  tick(2);
  assert.equal(resumed, 0, 'a wrong PIN opens nothing');
  Guard.guard(request = { player, feature: 'bond', resume: () => resumed++ });
  assert.equal(player.strings[u().keypad.title], 'Old School Bonds', 'recorded (rsprox 1375)');
  enter(player, '2468');
  assert.equal(player.messages.at(-1), 'You have correctly entered your PIN.');
  assert.equal(resumed, 0, 'a tick later');
  tick();
  assert.equal(resumed, 1);
  const next = { player, feature: 'stash', resume: () => assert.fail('already entered') };
  Guard.guard(next);
  assert.equal(next.locked, undefined, 'entered once for the session');
  const bank = { player, allow: null, source: 'open' };
  Settings.canBank(bank);
  assert.equal(bank.allow, null, 'the bank too');
});

test('an unlisted feature shows the bank title; a locked-out player gets no keypad', () => {
  const Guard = require('../plugins/interface/bankpin/Guard.BankPin');
  const player = withPin('1111');
  Guard.guard({ player, feature: 'reward-cart' });
  assert.equal(player.strings[u().keypad.title], 'Bank of Gielinor');
  Common.set(player, 'lockedUntil', time + 10_000);
  player.interface = -1;
  const request = { player, feature: 'reward-cart' };
  Guard.guard(request);
  assert.equal(request.locked, true, 'still refused');
  assert.equal(player.interface, -1, 'no keypad while locked out');
});

test('the point shops the Wiki lists ask for a locked PIN; other shops do not', () => {
  const Guard = require('../plugins/interface/bankpin/Guard.BankPin');
  const player = withPin('4321');
  const general = { player, shopId: 1027, allow: null };
  Guard.canShop(general);
  assert.equal(general.allow, null);
  const lms = { player, shopId: 1449, allow: null };
  Guard.canShop(lms);
  assert.equal(lms.allow, false);
  assert.equal(player.interface, 213);
});

test('a bond asks for a locked PIN before its Redeem options', () => {
  const Guard = require('../plugins/interface/bankpin/Guard.BankPin');
  const Bonds = require('../plugins/items/Bonds.plugin');
  const actions = {};
  let prompts = 0;
  Bonds.register(new Proxy({
    core,
    onItemAction: (name, handlers) => { actions[name] = handlers; },
    emitCustomEvent: (name, request) => { if (name === 'bank-pin:guard') Guard.guard(request); },
    sendMultiChatboxPrompt: () => { prompts++; },
  }, { get: (target, key) => target[key] ?? (() => {}) }));
  const player = withPin('9999');
  player.getInventory = () => ({ getAmount: () => 1, getItems: () => [] });
  actions['Old school bond'].Redeem({ player });
  assert.equal(prompts, 0);
  assert.equal(player.strings[u().keypad.title], 'Old School Bonds');
  enter(player, '9999');
  tick();
  assert.equal(prompts, 1, 'the options after the PIN');
});

function farmingStorage(t, { pin = true } = {}) {
  const Guard = require('../plugins/interface/bankpin/Guard.BankPin');
  require('../plugins/skills/farming/Core.Farming').init({ core });
  const Patches = require('../plugins/skills/farming/Patches.Farming');
  const Guild = require('../plugins/skills/farming/Guild.Farming');
  const Services = require('../plugins/skills/farming/Services.Farming');
  require('../plugins/skills/farming/Data.Farming').initializeFarmingData();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const owner = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  owner.getPacketSender = () => sender;
  const inventory = owner.getInventory();
  const player = pin ? withPin('2468') : fakePlayer();
  const mounted = new Set(), nativeSender = player.getPacketSender();
  Object.assign(nativeSender, {
    sendInterface(id) { player.interface = id; mounted.add(id); return this; },
    sendInterfaceRemoval() { player.interface = -1; mounted.clear(); return this; },
    sendSubInterface(_target, id) { mounted.add(id); return this; },
    sendVarbit() { return this; }, sendInterfaceFlagsRange() { return this; }, sendInterfaceScript() { return this; },
    isSubInterfaceOpen: id => mounted.has(id),
  });
  player.getPacketSender = () => nativeSender;
  player.getHitpoints = () => owner.getHitpoints();
  player.getStatus = () => core.PlayerStatus.NONE;
  player.isNeedsPlacement = () => false;
  player.isTeleportingReturn = () => false;
  player.getForceMovement = () => null;
  player.busy = () => false;
  player.setInterfaceId = id => { player.interface = id; return player; };
  let location = new core.Location(1240, 3720, 0);
  player.getLocation = () => location;
  player.getInventory = () => inventory;
  const target = { getLocation: () => new core.Location(1241, 3720, 0) };
  const menus = [], features = [];
  t.mock.method(Patches, 'choose', (_, entries) => menus.push(entries));
  t.mock.method(core.PluginManager, 'emitCustomEvent', (name, request) => {
    if (name === 'bank-pin:guard') { features.push(request.feature); Guard.guard(request); }
  });
  const vault = () => Guild.guildObject({ player, object: target, definition: { getName: () => 'Seed Vault' } });
  const leprechaun = action => Services.farmingNpc({ player, npc: target, clickType: 1,
    definition: { getName: () => 'Tool Leprechaun', getActions: () => [action] } });
  const spade = core.ItemIdentifiers.SPADE;
  const useTool = (itemId = spade) => Services.farmingItemOnNpc({ player, target, itemId, slot: 0,
    definition: { getName: () => 'Tool Leprechaun' } });
  return { player, inventory, Patches, Services, target, menus, features, vault, leprechaun, useTool, spade,
    leave: () => { location = new core.Location(3200, 3200, 0); } };
}

// Native Seed Vault PIN integration lives in farming-seed-vault-interface.test.cjs.


for (const action of ['Exchange', 'Deposit-all']) test(`Tool Leprechaun ${action} waits for the PIN`, t => {
  const f = farmingStorage(t);
  f.inventory.add(new core.Item(f.spade), false);
  f.leprechaun(action);
  assert.equal(f.player.interface, 213);
  assert.equal(f.player.getAttribute(f.Patches.FARM_ATTRIBUTE), undefined);
  assert.equal(f.inventory.getAmount(f.spade), 1);
  assert.deepEqual(f.features, ['tool-leprechaun']);
  enter(f.player, '2468');
  tick();
  if (action === 'Deposit-all') {
    assert.equal(f.inventory.getAmount(f.spade), 0);
    assert.equal(f.Patches.farmFor(f.player).tools[f.spade], 1);
  } else assert.equal(f.player.interface, 125, 'the native equipment store opens after the PIN');
});

test('using a tool on the leprechaun cannot bypass the PIN', t => {
  const f = farmingStorage(t);
  f.inventory.add(new core.Item(f.spade), false);
  f.useTool();
  assert.equal(f.player.interface, 213);
  assert.equal(f.inventory.getAmount(f.spade), 1);
  enter(f.player, '2468');
  tick();
  assert.equal(f.inventory.getAmount(f.spade), 0);
  assert.equal(f.Patches.farmFor(f.player).tools[f.spade], 1);
});

for (const action of ['vault', 'leprechaun', 'useTool']) test(`PIN resume rechecks proximity for ${action}`, t => {
  const f = farmingStorage(t);
  f.inventory.add(new core.Item(f.spade), false);
  if (action === 'leprechaun') f.leprechaun('Deposit-all'); else f[action]();
  assert.equal(f.player.interface, 213);
  f.leave();
  enter(f.player, '2468');
  tick();
  assert.equal(f.menus.length, 0);
  assert.equal(f.inventory.getAmount(f.spade), 1);
  assert.equal(f.player.getAttribute(f.Patches.FARM_ATTRIBUTE), undefined);
});

test('a changed inventory slot is not deposited by a delayed PIN resume', t => {
  const f = farmingStorage(t);
  f.inventory.add(new core.Item(f.spade), false);
  f.useTool();
  assert.equal(f.player.interface, 213);
  f.inventory.deleteAtSlot(0, 1, false);
  f.inventory.add(new core.Item(core.ItemIdentifiers.RAKE), false);
  enter(f.player, '2468');
  tick();
  assert.equal(f.inventory.getAmount(core.ItemIdentifiers.RAKE), 1);
  assert.equal(f.player.getAttribute(f.Patches.FARM_ATTRIBUTE), undefined);
});

test('a farmer without a PIN can access Tool Leprechaun storage normally', t => {
  const f = farmingStorage(t, { pin: false });
  f.inventory.add(new core.Item(f.spade), false);
  f.leprechaun('Deposit-all');
  assert.equal(f.inventory.getAmount(f.spade), 0);
  assert.equal(f.Patches.farmFor(f.player).tools[f.spade], 1);
});

// Native Seed Vault PIN integration lives in farming-seed-vault-interface.test.cjs.


test('produce noting does not access stored tools or prompt for a PIN', t => {
  const f = farmingStorage(t), id = core.ItemIdentifiers.POTATO;
  const note = core.CacheDefinitions.getItem(id).note;
  f.inventory.add(new core.Item(id, 3), false);
  f.Services.farmingItemOnNpc({ player: f.player, target: f.target, itemId: id, slot: 0,
    definition: { getName: () => 'Tool Leprechaun' } });
  assert.deepEqual(f.features, []);
  assert.equal(f.inventory.getAmount(id), 0);
  assert.equal(f.inventory.getAmount(note), 3);
  assert.equal(Common.isUnlocked(f.player), false);
});

test('every ordinary watering-can state requires a PIN before a tool deposit', t => {
  const Data = require('../plugins/skills/farming/Data.Farming');
  for (const name of ['Watering can', ...Array.from({ length: 8 }, (_, i) => `Watering can(${i + 1})`)]) {
    const f = farmingStorage(t), id = Data.itemId(name);
    f.inventory.add(new core.Item(id), false);
    f.useTool(id);
    assert.equal(f.player.interface, 213, name);
    assert.equal(f.inventory.getAmount(id), 1, name);
    assert.equal(f.player.getAttribute(f.Patches.FARM_ATTRIBUTE), undefined, name);
    enter(f.player, '2468');
    tick();
    assert.equal(f.inventory.getAmount(id), 0, name);
    assert.equal(f.Patches.farmFor(f.player).tools[id], 1, name);
  }
});
