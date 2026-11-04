// Run after `yarn build`: node --test tests/wilderness-diary.test.cjs
// The easy Wilderness Diary tasks the Wilderness plugin counts (OSRS Wiki: Wilderness Diary).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const Wilderness = require('../plugins/areas/Wilderness.plugin');
const Altars = require('../plugins/objects/Altars.plugin');
const core = PluginManager.getCoreApi();

const events = [];
const deathHandlers = [];
const customHandlers = new Map();
const api = new Proxy({
  core,
  emitCustomEvent: (name, payload) => events.push({ name, ...payload }),
  onNpcDeath: (handler) => deathHandlers.push(handler),
  onCustomEvent: (name, handler) => customHandlers.set(name, [...(customHandlers.get(name) ?? []), handler]),
}, { get: (target, key) => target[key] ?? (() => {}) });
Wilderness.register(api);
const altars = new Map();
Altars.register({ core, emitCustomEvent: api.emitCustomEvent, onObjectInteraction: (name, actions) => altars.set(name, actions) });

const tasks = () => events.filter((event) => event.name === 'diary:task').map((event) => `${event.diary}:${event.task}`);
const player = () => ({ isPlayer: () => true });
const npc = (name, x, y) => ({ getDefinition: () => ({ getName: () => name }), getLocation: () => new core.Location(x, y, 0) });
const kill = (killer, victim) => { for (const handler of deathHandlers) handler({ killer, npc: victim }); };

test('a Mammoth killed in the Wilderness counts, one killed outside it or another NPC does not', () => {
  events.length = 0;
  const who = player();
  kill(who, npc('Mammoth', 3170, 3600));
  assert.deepEqual(tasks(), ['wilderness:kill-a-mammoth-in-the-wilderness']);
  assert.equal(events[0].player, who);
  events.length = 0;
  kill(who, npc('Mammoth', 3170, 3400));
  kill(who, npc('Earth warrior', 3170, 3600));
  kill(npc('Mammoth', 3170, 3600), npc('Mammoth', 3170, 3600));
  assert.deepEqual(tasks(), []);
});

// "Pray at the Chaos Altar in Western Wilderness.": the Chaos Temple (church) at level 38, not the hut's altar.
test('praying at the western Wilderness Chaos altar counts, praying at any other Chaos altar does not', () => {
  const pray = altars.get('Chaos altar')['Pray-at'];
  const who = { ...player(), sendMessage() {}, performAnimation() {}, getSkillManager: () => ({ getCurrentLevel: () => 1, getMaxLevel: () => 1 }) };
  const at = (x, y, objectId = core.ObjectIdentifiers.CHAOS_ALTAR) => pray({ player: who, objectId, location: { x, y, z: 0 } });
  events.length = 0;
  assert.equal(at(2947, 3820), true);
  assert.deepEqual(tasks(), ['wilderness:pray-at-the-chaos-altar-in-western-wilderness']);
  assert.equal(events[0].player, who);
  events.length = 0;
  at(3239, 3608);
  at(2947, 3820, core.ObjectIdentifiers.CHAOS_ALTAR_3);
  assert.deepEqual(tasks(), []);
});

const fire = (name, payload) => { for (const handler of customHandlers.get(name) ?? []) handler(payload); };
// The diary module on an api of its own, so its login, equipment and persistence hooks run alone.
const diaryCustom = new Map();
const diaryLogins = [];
const persisted = [];
require('../plugins/areas/wilderness/Diary.Wilderness')(new Proxy({
  core,
  emitCustomEvent: (name, payload) => events.push({ name, ...payload }),
  onCustomEvent: (name, handler) => diaryCustom.set(name, [...(diaryCustom.get(name) ?? []), handler]),
  onPlayerLogin: (handler) => diaryLogins.push(handler),
  persistAttribute: (key, value) => persisted.push([key, value]),
}, { get: (target, key) => target[key] ?? (() => {}) }));
const login = (who) => { for (const handler of diaryLogins) handler({ player: who }); };
const changed = (who) => { for (const handler of diaryCustom.get('equipment:changed')) handler({ player: who }); };
const attributes = () => { const map = new Map(); return { getAttribute: (key) => map.get(key), setAttribute: (key, value) => map.set(key, value) }; };
const IN = new core.Location(3000, 3600, 0);
const OUT = new core.Location(3000, 3400, 0);

test('iron ore mined in the Wilderness counts, iron elsewhere or another ore does not', () => {
  events.length = 0;
  const wild = { ...player(), getLocation: () => IN };
  const safe = { ...player(), getLocation: () => OUT };
  fire('mining:success', { player: safe, itemId: core.ItemIdentifiers.IRON_ORE });
  fire('mining:success', { player: wild, itemId: core.ItemIdentifiers.ADAMANTITE_ORE });
  assert.deepEqual(tasks(), []);
  fire('mining:success', { player: wild, itemId: core.ItemIdentifiers.IRON_ORE });
  assert.deepEqual(tasks(), ['wilderness:mine-some-iron-ore-in-the-wilderness']);
  assert.equal(events[0].player, wild);
});

test("the fifth Red spiders' egg collected in the Wilderness counts; eggs elsewhere or other items do not", () => {
  events.length = 0;
  const who = { ...player(), ...attributes() };
  const take = (itemId, at, amount = 1) => fire('ground-items:taken', { player: who, itemId, amount, groundItem: { getPosition: () => at } });
  const EGG = core.ItemIdentifiers.RED_SPIDERS_EGGS;
  for (let i = 0; i < 4; i++) take(EGG, IN);
  take(EGG, OUT);
  take(core.ItemIdentifiers.IRON_ORE, IN);
  assert.deepEqual(tasks(), [], 'four in the Wilderness are not enough');
  take(EGG, IN);
  assert.deepEqual(tasks(), ["wilderness:collect-5-red-spiders-eggs-from-the-wilderness"]);
  assert.equal(events[0].player, who);
});

test("the eggs' count is saved with the player, starting at 0", () => {
  assert.deepEqual(persisted, [['wilderness-diary:red-spiders-eggs', 0]]);
});

const TASK = ['wilderness:equip-any-team-cape-in-the-wilderness'];
const TEAM = core.ItemIdentifiers.TEAM_1_CAPE;
/** A player wearing `cape` (-1 for none) at `at`; `wear` changes it and fires the equipment event. */
function wearer(at, cape = -1) {
  const who = { ...player(), getLocation: () => at, getEquipment: () => ({ getItems: () => [null, { getId: () => cape }] }) };
  return { who, wear: (id) => { cape = id; changed(who); } };
}

test('the first team cape equipped after logging in, with no cape, in the Wilderness counts', () => {
  events.length = 0;
  const bare = wearer(IN);
  login(bare.who);
  bare.wear(core.ItemIdentifiers.CAPE_OF_SKULLS);
  assert.deepEqual(tasks(), [], 'not a team cape');
  const first = wearer(IN);
  login(first.who);
  first.wear(TEAM);
  assert.deepEqual(tasks(), TASK);
  assert.equal(events[0].player, first.who);
});

test('a team cape already worn on logging in in the Wilderness does not count, whatever else changes', () => {
  events.length = 0;
  const worn = wearer(IN, TEAM);
  login(worn.who);
  changed(worn.who);
  assert.deepEqual(tasks(), []);
  worn.wear(TEAM);
  assert.deepEqual(tasks(), [], 'the same cape again');
});

test('a team cape equipped outside the Wilderness does not count on entering it; swapping to another inside does', () => {
  events.length = 0;
  const outside = wearer(OUT);
  login(outside.who);
  outside.wear(TEAM);
  outside.who.getLocation = () => IN;
  changed(outside.who);
  assert.deepEqual(tasks(), [], 'worn before entering');
  outside.wear(core.ItemIdentifiers.TEAM_2_CAPE);
  assert.deepEqual(tasks(), TASK, 'swapping to another team cape inside is an equip');
  events.length = 0;
  const safe = wearer(OUT);
  login(safe.who);
  safe.wear(TEAM);
  assert.deepEqual(tasks(), [], 'equipped outside');
});

// The medium, hard and elite tasks whose mechanic already exists (OSRS Wiki: Wilderness Diary).
const wildAt = (at) => ({ ...player(), getLocation: () => at });

test('mithril ore mined in the Wilderness counts, mithril elsewhere or iron does not', () => {
  events.length = 0;
  fire('mining:success', { player: wildAt(OUT), itemId: core.ItemIdentifiers.MITHRIL_ORE });
  fire('mining:success', { player: wildAt(IN), itemId: core.ItemIdentifiers.IRON_ORE });
  assert.ok(!tasks().includes('wilderness:mine-some-mithril-ore-in-the-wilderness'));
  fire('mining:success', { player: wildAt(IN), itemId: core.ItemIdentifiers.MITHRIL_ORE });
  assert.ok(tasks().includes('wilderness:mine-some-mithril-ore-in-the-wilderness'));
});

test('a Green dragon or Ankou killed in the Wilderness counts; outside it, or a baby or Dark Ankou, does not', () => {
  events.length = 0;
  const who = player();
  kill(who, npc('Green dragon', 3170, 3400));
  kill(who, npc('Baby green dragon', 3170, 3600));
  kill(who, npc('Brutal green dragon', 3170, 3600));
  kill(who, npc('Ankou', 3170, 3400));
  kill(who, npc('Dark Ankou', 3170, 3600));
  assert.deepEqual(tasks(), []);
  kill(who, npc('Green dragon', 3170, 3600));
  kill(who, npc('Ankou', 3170, 3600));
  assert.deepEqual(tasks(), ['wilderness:kill-a-green-dragon', 'wilderness:kill-an-ankou-in-the-wilderness']);
  assert.equal(events[0].player, who);
});

// Wiki: "Kill the Chaos Elemental" and a Lava Dragon, with no location condition.
test('the Chaos Elemental and a Lava dragon count wherever they die; other NPCs do not', () => {
  events.length = 0;
  const who = player();
  kill(who, npc('Chaos Elemental Jr.', 3170, 3600));
  kill(who, npc('Green dragon', 3170, 3400));
  assert.deepEqual(tasks(), []);
  kill(who, npc('Chaos Elemental', 3280, 3910));
  kill(who, npc('Lava dragon', 3200, 3820));
  assert.deepEqual(tasks(), ['wilderness:kill-the-chaos-elemental', 'wilderness:kill-a-lava-dragon']);
});

test('raw lava eel fished in the Wilderness counts, other fish or other places do not', () => {
  events.length = 0;
  fire('fishing:success', { player: wildAt(OUT), itemId: core.ItemIdentifiers.RAW_LAVA_EEL });
  fire('fishing:success', { player: wildAt(IN), itemId: core.ItemIdentifiers.RAW_SHARK });
  assert.deepEqual(tasks(), []);
  fire('fishing:success', { player: wildAt(IN), itemId: core.ItemIdentifiers.RAW_LAVA_EEL });
  assert.deepEqual(tasks(), ['wilderness:fish-some-raw-lava-eel-in-the-wilderness']);
});

test('a black salamander caught in the Wilderness counts, another salamander or place does not', () => {
  events.length = 0;
  const N = core.NpcIdentifiers;
  fire('hunter:success', { player: wildAt(OUT), npcId: N.BLACK_SALAMANDER });
  fire('hunter:success', { player: wildAt(IN), npcId: N.RED_SALAMANDER });
  assert.deepEqual(tasks(), []);
  fire('hunter:success', { player: wildAt(IN), npcId: N.BLACK_SALAMANDER });
  assert.deepEqual(tasks(), ['wilderness:catch-a-black-salamander-in-the-wilderness']);
});

test('arriving by the Ghorrock Teleport counts, another teleport does not', () => {
  events.length = 0;
  const who = player();
  fire('spell:teleport-arrival', { player: who, name: 'varrock teleport' });
  assert.deepEqual(tasks(), []);
  fire('spell:teleport-arrival', { player: who, name: 'ghorrock teleport' });
  assert.deepEqual(tasks(), ['wilderness:teleport-to-ghorrock']);
  assert.equal(events[0].player, who);
});
