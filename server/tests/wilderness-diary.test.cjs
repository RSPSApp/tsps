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
const runeBypassHandlers = [];
const experienceHandlers = [];
const registeredAreas = [];
const startupHandlers = [];
const api = new Proxy({
  core,
  emitCustomEvent: (name, payload) => {
    events.push({ name, ...payload });
    for (const handler of customHandlers.get(name) ?? []) handler(payload);
  },
  onNpcDeath: (handler) => deathHandlers.push(handler),
  onCustomEvent: (name, handler) => customHandlers.set(name, [...(customHandlers.get(name) ?? []), handler]),
  onSpellRuneBypass: (handler) => runeBypassHandlers.push(handler),
  onCanGainExperience: (handler) => experienceHandlers.push(handler),
  onServerStartup: (handler) => startupHandlers.push(handler),
  registerArea: (area) => registeredAreas.push(area),
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
  const messages = [];
  const who = { ...player(), ...attributes(), sendMessage: (message) => messages.push(message) };
  const take = (itemId, at, amount = 1) => fire('ground-items:taken', { player: who, itemId, amount, groundItem: { getPosition: () => at } });
  const EGG = core.ItemIdentifiers.RED_SPIDERS_EGGS;
  for (let i = 0; i < 4; i++) take(EGG, IN);
  assert.deepEqual(messages, [
    "You have collected 1 of 5 Red spiders' eggs from the Wilderness.",
    "You have collected 2 of 5 Red spiders' eggs from the Wilderness.",
    "You have collected 3 of 5 Red spiders' eggs from the Wilderness.",
    "You have collected 4 of 5 Red spiders' eggs from the Wilderness.",
  ]);
  take(EGG, OUT);
  take(core.ItemIdentifiers.IRON_ORE, IN);
  assert.deepEqual(tasks(), [], 'four in the Wilderness are not enough');
  take(EGG, IN);
  assert.deepEqual(tasks(), ["wilderness:collect-5-red-spiders-eggs-from-the-wilderness"]);
  assert.equal(events[0].player, who);
});

test('the Demonic Ruins restore Prayer every five ticks and credit the diary when Prayer increases', () => {
  events.length = 0;
  const area = registeredAreas.find((registered) => registered.getName() === 'DemonicRuinsArea');
  assert.ok(area, 'the prayer effect is registered as an area');

  let cycle = 100;
  let prayer = 0;
  let wildernessLevel = 0;
  let multiIcon = 0;
  const messages = [];
  const originalGetProcessCycle = core.World.getProcessCycle;
  core.World.getProcessCycle = () => cycle;
  let sender;
  sender = new Proxy({}, { get: () => () => sender });
  const who = {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getWildernessLevel: () => wildernessLevel,
    setWildernessLevel: (value) => { wildernessLevel = value; },
    getMultiIcon: () => multiIcon,
    setMultiIcon: (value) => { multiIcon = value; },
    sendMessage: (message) => messages.push(message),
    getSkillManager: () => ({
      getCurrentLevel: () => prayer,
      getMaxLevel: () => 10,
      setCurrentLevels: (_skill, value) => { prayer = value; },
      updateSkill: () => {},
    }),
  };

  try {
    area.postEnter(who);
    assert.equal(messages.length, 1, 'entering the ruins shows the restoration message');
    cycle += 4;
    area.process(who);
    assert.equal(prayer, 0, 'Prayer does not restore before five ticks');
    cycle += 1;
    area.process(who);
    assert.equal(prayer, 1);
    assert.deepEqual(tasks(), ['wilderness:restore-some-prayer-points-at-the-demonic-ruins']);
  } finally {
    area.postLeave(who);
    core.World.getProcessCycle = originalGetProcessCycle;
  }
});

test('the Fountain of Rune waives runes and Magic XP and credits a successful Low Alchemy cast', () => {
  events.length = 0;
  const playerLocation = new core.Location(3379, 3895, 0);
  const player = { getLocation: () => playerLocation, getPrivateArea: () => null };
  const objectId = core.ObjectIdentifiers.FOUNTAIN_OF_RUNE;
  const fountain = { getId: () => objectId, getLocation: () => new core.Location(3380, 3895, 0) };
  const mapObjects = core.MapObjects.mapObjects;
  const regionManager = core.RegionManager;
  const existingObjects = mapObjects.get(-2435);
  const originalCanProjectileAttack = regionManager.canProjectileAttack;
  mapObjects.set(-2435, [fountain]);
  regionManager.canProjectileAttack = () => true;

  try {
    const bypass = { player, bypass: null };
    for (const handler of runeBypassHandlers) handler(bypass);
    assert.equal(bypass.bypass, true);

    const experience = { player, skill: core.Skill.MAGIC, allow: null };
    for (const handler of experienceHandlers) handler(experience);
    assert.equal(experience.allow, false);

    const payment = { player, experience: 65 };
    for (const handler of customHandlers.get('magic:alchemy-payment') ?? []) handler(payment);
    assert.equal(payment.experience, 0);

    for (const handler of customHandlers.get('magic:alchemy-completed') ?? []) {
      handler({ player, spellId: core.EffectSpells.LOW_ALCHEMY.spellId() });
    }
    assert.deepEqual(tasks(), ['wilderness:cast-low-alchemy-at-the-fountain-of-rune']);
  } finally {
    regionManager.canProjectileAttack = originalCanProjectileAttack;
    if (existingObjects) mapObjects.set(-2435, existingObjects);
    else mapObjects.delete(-2435);
  }
});

test('walking into the Demonic Ruins preserves Wilderness levels, teleport limits, and PvP rules', (t) => {
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const previousAreas = AreaManager.areas;
  const previousAreaSearchIndex = AreaManager.areaSearchIndex;
  const previousIsInSafeBuilding = core.Wilderness.isInSafeBuilding;
  const previousAreaCount = registeredAreas.length;
  AreaManager.areas = [];
  AreaManager.areaSearchIndex = null;
  core.Wilderness.isInSafeBuilding = () => false;

  try {
    for (const startup of startupHandlers) startup({});
    AreaManager.areas.push(...registeredAreas);
    const senderFor = () => {
      let sender;
      sender = new Proxy({}, { get: () => () => sender });
      return sender;
    };
    const makePlayer = (name, index, x) => {
      const actor = new Player(null, new core.Location(x, 3889, 0));
      actor.setUsername(name);
      actor.setIndex(index);
      actor.setRegistered(true);
      actor.getPacketSender = senderFor;
      return actor;
    };

    const player = makePlayer('RuinsWalker', 890, 3281);
    const opponent = makePlayer('RuinsOpponent', 891, 3283);
    AreaManager.process(player);
    assert.equal(player.getArea().getName(), 'WildernessArea');
    assert.equal(player.getWildernessLevel(), 47);
    assert.equal(core.TeleportHandler.checkReqs(player, new core.Location(3000, 3500, 0), 20), false,
      'the normal level-20 teleport limit applies before entering the ruins');

    player.moveTo(new core.Location(3282, 3889, 0));
    AreaManager.process(player);
    AreaManager.process(opponent);
    assert.equal(player.getArea().getName(), 'DemonicRuinsArea');
    assert.equal(player.getWildernessLevel(), 47, 'the Wilderness lifecycle restores the level on area entry');
    assert.equal(player.getArea().npcAggressionTolerance(player, {}), true,
      'the ruins area delegates Wilderness NPC aggression rules');
    assert.equal(core.TeleportHandler.checkReqs(player, new core.Location(3000, 3500, 0), 20), false,
      'the ruins area keeps the level-20 teleport restriction');
    assert.equal(core.CombatFactory.canAttackByPolicy(player, opponent), core.CanAttackResponse.CAN_ATTACK,
      'the ruins area delegates normal Wilderness PvP rules');
  } finally {
    AreaManager.areas = previousAreas;
    AreaManager.areaSearchIndex = previousAreaSearchIndex;
    core.Wilderness.isInSafeBuilding = previousIsInSafeBuilding;
    registeredAreas.splice(previousAreaCount);
  }
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
