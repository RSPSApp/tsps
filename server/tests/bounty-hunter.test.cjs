// node --test tests/bounty-hunter.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const Targets = require("../plugins/minigames/bountyhunter/Targets.BountyHunter");

const { inRange, canPair, matchPairs, skipOutcome, SKIP_WINDOW_MS } = Targets._test;

const player = (name, level, band = 5) => ({ name, level, band });
const rules = (avoided = []) => ({
  levelOf: (p) => p.level,
  bandOf: (p) => p.band,
  avoids: (a, b) => avoided.some(([x, y]) => (x === a && y === b) || (x === b && y === a)),
});
const names = (pairs) => pairs.map((pair) => pair.map((p) => p.name).join("+"));

test("rogues need to be within five levels; assigned targets use their matchmaking range", () => {
  const Area = require("../plugins/minigames/bountyhunter/Area.BountyHunter");
  const bh = require("../plugins/minigames/bountyhunter/State.BountyHunter");
  const areas = [];
  const state = { ...bh, arena: new Set(), targets: new Map(), immuneUntil: new WeakMap() };
  Area(new Proxy({
    core: { Area: class {}, Boundary: class {}, World: { getProcessCycle: () => 100 } },
    registerArea: (area) => areas.push(area),
  }, { get: (object, key) => object[key] ?? (() => {}) }), state);
  const actor = (level) => ({ isPlayer: () => true,
    getSkillManager: () => ({ getCombatLevel: () => level }), sendMessage() {},
    getPacketSender: () => ({ sendVarbit() {} }) });
  const attacker = actor(100);
  state.arena.add(attacker);
  state.immuneUntil.set(attacker, 110);
  for (const [level, allowed] of [[94, false], [95, true], [105, true], [106, false], [115, false]]) {
    const target = actor(level);
    state.arena.add(target);
    assert.equal(areas[1].canAttack(attacker, target), allowed, `rogue level ${level}`);
    state.targets.set(attacker, target);
    state.targets.set(target, attacker);
    state.immuneUntil.set(target, 110);
    assert.equal(areas[1].canAttack(attacker, target), true, `assigned level ${level}`);
    assert.equal(areas[1].canAttack(target, attacker), true, 'assigned targets can retaliate');
    state.targets.clear();
    state.immuneUntil.set(target, 110);
    assert.equal(areas[1].canAttack(attacker, target), false, 'rogue entry immunity still applies');
    state.arena.delete(target);
    assert.equal(areas[1].canAttack(attacker, target), false, 'cannot attack into the lobby');
  }
  assert.equal(state.immuneUntil.has(attacker), true, 'asking canAttack leaves the attacker immune');
  require("../plugins/minigames/bountyhunter/Hud.BountyHunter")({ core: { CacheDefinitions: { getVarbitId: (name) => name } } }, state);
  Area._test.endImmunity({ attacker, target: actor(100) });
  assert.equal(state.immuneUntil.has(attacker), false, 'a hit on a player ends it');
});

test("an Exit gate takes a player from the arena into the lobby", (t) => {
  const { AreaManager } = require("../dist/game/model/areas/AreaManager");
  const { Area: CoreArea } = require("../dist/game/model/areas/Area");
  const { Boundary } = require("../dist/game/model/Boundary");
  const { Location } = require("../dist/game/model/Location");
  const Area = require("../plugins/minigames/bountyhunter/Area.BountyHunter");
  const bh = require("../plugins/minigames/bountyhunter/State.BountyHunter");
  const state = { ...bh, lobby: new Set(), arena: new Set(), targets: new Map(), immuneUntil: new WeakMap(), lobbyTicks: new WeakMap() };
  const areas = [];
  Area(new Proxy({
    core: { Area: CoreArea, Boundary, World: { getProcessCycle: () => 100 }, PrayerHandler: { PROTECTION_PRAYERS: [] },
      TimerKey: {}, },
    registerArea: (area) => areas.push(area),
  }, { get: (object, key) => object[key] ?? (() => {}) }), state);
  const previousAreas = AreaManager.areas;
  AreaManager.areas = areas;
  t.after(() => { AreaManager.areas = previousAreas; });

  let at = new Location(3423, 4050, 0);
  let area = null;
  const player = {
    isPlayer: () => true, isNpc: () => false, isPlayerBot: () => true, getIndex: () => 1,
    getAsPlayer: () => player, getLocation: () => at, getArea: () => area, setArea: (next) => { area = next; },
    getAttribute: () => undefined, sendMessage() {}, getMultiIcon: () => 0, setMultiIcon() {},
    getTimers: () => ({ has: () => false }),
  };
  AreaManager.process(player);
  assert.deepEqual([state.inArena(player), state.inLobby(player)], [true, false], "south of the fort is the arena");
  for (const exit of bh.CRATER.exits) {
    at = new Location(exit.to.x, exit.to.y, 0);
    AreaManager.process(player);
    assert.deepEqual([state.inArena(player), state.inLobby(player)], [false, true], `exit to ${exit.to.x},${exit.to.y}`);
    at = new Location(exit.x, exit.y, 0);
    AreaManager.process(player);
    assert.deepEqual([state.inArena(player), state.inLobby(player)], [true, false], `back out at ${exit.x},${exit.y}`);
  }
});

test("targets are from 15 levels below up to the chosen band above", () => {
  assert.equal(inRange(100, 85, 5), true);
  assert.equal(inRange(100, 84, 5), false);
  assert.equal(inRange(100, 105, 5), true);
  assert.equal(inRange(100, 106, 5), false);
  assert.equal(inRange(100, 115, 15), true);
});

test("a pair has to suit both players' bands", () => {
  const strong = player("strong", 100, 15);
  const weak = player("weak", 90, 5);
  assert.equal(canPair(strong, weak, (p) => p.level, (p) => p.band), false, "weak only takes up to 95");
  weak.band = 10;
  assert.equal(canPair(strong, weak, (p) => p.level, (p) => p.band), true);
});

test("matching serves the longest waiting first and leaves misfits waiting", () => {
  const a = player("a", 100);
  const b = player("b", 60);
  const c = player("c", 98);
  const d = player("d", 62);
  const e = player("e", 126);
  assert.deepEqual(names(matchPairs([a, b, c, d, e], rules())), ["a+c", "b+d"]);
});

test("a skipped target isn't offered again", () => {
  const a = player("a", 100);
  const b = player("b", 100);
  const c = player("c", 100);
  assert.deepEqual(names(matchPairs([a, b, c], rules([[a, b]]))), ["a+c"]);
  assert.deepEqual(names(matchPairs([a, b], rules([[a, b]]))), []);
});

test("unskulled skips are free; the third skulled skip in 30 minutes blocks", () => {
  const now = 10 * SKIP_WINDOW_MS;
  let history = [];
  for (let i = 0; i < 5; i++) {
    const unskulled = skipOutcome(history, now, false);
    assert.equal(unskulled.blocks, false);
    history = unskulled.history;
  }
  const first = skipOutcome(history, now, true);
  const second = skipOutcome(first.history, now + 1, true);
  const third = skipOutcome(second.history, now + 2, true);
  assert.deepEqual([first.blocks, second.blocks, third.blocks], [false, false, true]);
  assert.deepEqual(third.history, [], "the block starts a fresh window");
});

test("skulled skips older than 30 minutes no longer count", () => {
  const now = 10 * SKIP_WINDOW_MS;
  const old = [now - SKIP_WINDOW_MS - 1, now - SKIP_WINDOW_MS];
  const outcome = skipOutcome(old, now, true);
  assert.equal(outcome.blocks, false);
  assert.deepEqual(outcome.history, [now]);
  assert.equal(skipOutcome([now - SKIP_WINDOW_MS + 1, now - 1], now, true).blocks, true);
});

test("combat XP blocked in the arena still sends fake XP drops", async () => {
  const { Skill } = require("../dist/game/model/Skill");
  const { GameConstants } = require("../dist/game/GameConstants");
  const Area = require("../plugins/minigames/bountyhunter/Area.BountyHunter");
  const bh = require("../plugins/minigames/bountyhunter/State.BountyHunter");
  const state = { ...bh, arena: new Set(), lobby: new Set(), targets: new Map(), immuneUntil: new WeakMap() };
  const noop = () => {};
  Area({
    core: {
      Area: class { constructor(boundaries) { this.boundaries = boundaries; } },
      Boundary: class { constructor(...bounds) { this.bounds = bounds; } },
      Skill,
      GameConstants,
      XPDROPS_ENABLED_ATTRIBUTE: "xp-drops:enabled",
    },
    registerArea: noop,
    onPrayerDisabled: noop,
    onCanGainExperience: noop,
    onAttackTiming: noop,
    onCombatHitResolved: noop,
    onCustomEvent: noop,
  }, state);

  const sent = [];
  const attributes = new Map([["xp-drops:enabled", true]]);
  const xps = new Map(Skill.values().map((skill) => [skill.getClientId(), 1_000_000 + skill.getClientId()]));
  const fakeDropsOff = { value: 0 };
  const target = { isPlayer: () => true };
  const sender = {
    getVarbit: (id) => (id === Area._test.FAKE_DROPS_OFF_VARBIT ? fakeDropsOff.value : 0),
    sendClientScript(id, ...args) { sent.push([id, ...args]); return this; },
  };
  const player = {
    isPlayer: () => true,
    getAttribute: (key) => attributes.get(key),
    getPacketSender: () => sender,
    getCombat: () => ({ getTarget: () => target }),
    getSkillManager: () => ({ getExperience: (skill) => xps.get(skill.getClientId()) ?? 0 }),
  };
  state.arena.add(player);

  // A three-damage Strength hit awards Hitpoints and Strength in one synchronous batch.
  const hpEvent = { player, skill: Skill.HITPOINTS, experience: 4, allow: null };
  const strengthEvent = { player, skill: Skill.STRENGTH, experience: 12, allow: null };
  Area._test.noPvpCombatExperience(hpEvent);
  Area._test.noPvpCombatExperience(strengthEvent);
  assert.deepEqual([hpEvent.allow, strengthEvent.allow], [false, false], "the real XP stays blocked");
  assert.equal(sent.length, 2, "both skills queue before the render");
  await Promise.resolve();
  assert.equal(sent.length, 3, "one render drains the whole batch");
  assert.deepEqual(sent[0], [2091, Skill.HITPOINTS.getClientId(), 4]);
  assert.deepEqual(sent[1], [2091, Skill.STRENGTH.getClientId(), 12]);

  const render = sent[2];
  assert.equal(render[0], 1004);
  assert.equal(render[1], 1, "the fake-drop mode");
  assert.deepEqual(render.slice(2, 12), Area._test.FAKE_DROP_RENDER_ARGS);
  assert.deepEqual(render.slice(12), [0, 2, 4, 6, 1, 3, 5, 16, 15, 17, 12, 20, 14, 13, 10, 7, 11, 8, 9, 18, 19, 22, 21, 23]
    .map((clientId) => xps.get(clientId)), "the client's baseline table in its own order");

  sent.length = 0;
  fakeDropsOff.value = 1;
  Area._test.noPvpCombatExperience({ ...strengthEvent, allow: null });
  await Promise.resolve();
  assert.deepEqual(sent, [], "Fake drops: Off sends nothing");
  fakeDropsOff.value = 0;

  attributes.delete("xp-drops:enabled");
  Area._test.noPvpCombatExperience({ ...strengthEvent, allow: null });
  await Promise.resolve();
  assert.deepEqual(sent, [], "a hidden XP counter sends nothing");

  attributes.set("xp-drops:enabled", true);
  state.arena.delete(player);
  Area._test.noPvpCombatExperience({ ...strengthEvent, allow: null });
  await Promise.resolve();
  assert.deepEqual(sent, [], "XP outside the arena is not faked");
});

test("real Bounty Hunter deaths return humans to the lobby and honour Skully's loot-key settings", async (t) => {
  const { Server } = require('../dist/Server');
  Server.installProductionPathResolver();
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const { GameConstants } = require('../dist/game/GameConstants');
  const core = PluginManager.getCoreApi();
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  const bh = require('../plugins/minigames/bountyhunter/State.BountyHunter');
  const state = { ...bh, lobby: new Set(), arena: new Set(), targets: new Map(), skipped: new WeakMap(),
    noTargetUntil: new WeakMap(), immuneUntil: new WeakMap(), lobbyTicks: new WeakMap() };
  const oldAreas = AreaManager.areas;
  AreaManager.areas = [];
  t.after(() => { AreaManager.areas = oldAreas; });
  const api = PluginManager.createApi('BountyHunterDeathLootRegression');
  const prompts = new Map();
  api.sendMultiChatboxPrompt = (player, title, ...options) => prompts.set(player, { title, options });
  require('../plugins/minigames/bountyhunter/Hud.BountyHunter')(api, state);
  Targets(api, state);
  require('../plugins/minigames/bountyhunter/Area.BountyHunter')(api, state);
  require('../plugins/items/Food.plugin').register(api);
  const keys = require('../plugins/items/LootKeys.plugin');
  keys.register(api);
  const ironman = require('../plugins/modes/ironman/Common.Ironman');
  ironman.init(api);
  require('../plugins/modes/ironman/Hardcore.Ironman')(api);
  const floor = [];
  t.mock.method(core.ItemOnGroundManager, 'registerLocation', (owner, item, location) => floor.push({ owner, item, location: location.clone() }));
  t.mock.method(core.ItemOnGroundManager, 'registerNonGlobals', (owner, item, location) => floor.push({ owner, item, location: location.clone() }));
  t.mock.method(core.TaskManager, 'submit', () => {});
  const saves = [], deaths = new Map();
  t.mock.method(GameConstants.PLAYER_PERSISTENCE, 'requestSave', (player, reason) => saves.push({ player, reason, location: player.getLocation().clone() }));
  api.onPlayerDeath((event) => deaths.set(event.player, event));
  let index = 0;
  const at = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
  function fighter(t, bot = false, location = new core.Location(3446, 4005)) {
    const p = new Player(null, location);
    p.setUsername(`bh_loot_${++index}`); p.setIndex(index); p.setRegistered(true); p.setPlayerBot(bot);
    if (bot) p.setAttribute('bounty-hunter:bot', true);
    t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
    t.mock.method(p, 'sendMessage', () => {});
    AreaManager.process(p);
    t.after(() => { p.getArea()?.leave(p, true); p.setRegistered(false); });
    return p;
  }
  function toggleAtSkully(p) {
    const npc = new core.NPC(core.NpcIdentifiers.SKULLY, new core.Location(3138, 3626));
    assert.equal(PluginManager.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), npcIndex: 1, clickType: 1, location: { x: 3138, y: 3626, z: 0 }, handled: false }), true);
    assert.equal(prompts.get(p)?.title, "Skully's Loot Keys");
    prompts.get(p).options[1]();
  }
  function kill(victim, killer) {
    victim.setSkullTimer(100);
    PluginManager.emitPlayerBeforeDeath({ player: victim, killer, handled: false });
    if (killer) victim.getCombat().addDamage(killer, 10);
    const task = new PlayerDeathTask(victim);
    task.execute(); task.execute(); task.execute();
  }
  function chestValues(t, player) {
    const scripts = [];
    const record = (...args) => { scripts.push(args); return player.getPacketSender(); };
    t.mock.method(player.getPacketSender(), 'sendInterfaceScript', record);
    t.mock.method(player.getPacketSender(), 'sendClientScript', record);
    return (expected) => {
      assert.deepEqual(scripts.slice(-5), expected.map((value, tab) => [8013, tab, value]), 'all five native key labels are refreshed or cleared');
      assert.equal(scripts.at(-6)?.[0], 8006, 'create the cache dynamic text children before setting their values');
    };
  }
  await t.test('human respawn is saved in Fort Daimon after target cleanup without making death safe', (t) => {
    const victim = fighter(t), killer = fighter(t);
    victim.setAttribute('ironman:mode', 'hardcore');
    victim.getInventory().adds(core.ItemIdentifiers.RUNE_SCIMITAR, 1);
    state.targets.set(victim, killer); state.targets.set(killer, victim); state.lobbyTicks.set(victim, 77);
    kill(victim, killer);
    const arrival = [state.CRATER.lobbyArrival.x, state.CRATER.lobbyArrival.y, 0];
    assert.deepEqual(at(victim), arrival);
    assert.equal(state.inLobby(victim), true); assert.equal(state.inArena(victim), false);
    assert.equal(victim.getArea().hasMember(victim), true);
    assert.equal(state.targetOf(victim), null); assert.equal(state.targetOf(killer), null);
    assert.ok(state.noTargetUntil.get(victim) > Date.now());
    assert.equal(deaths.get(victim)?.itemsLost, true); assert.equal(ironman.modeOf(victim), 'ironman');
    assert.equal(victim.getInventory().getAmount(core.ItemIdentifiers.RUNE_SCIMITAR), 0);
    const saved = saves.findLast((s) => s.player === victim && s.reason === 'respawn');
    assert.deepEqual([saved.location.getX(), saved.location.getY(), saved.location.getZ()], arrival);
  });
  await t.test('bot deaths keep the runtime sigil respawn; deaths elsewhere keep their normal respawn', (t) => {
    const bot = fighter(t, true), outside = fighter(t, false, new core.Location(3200, 3200));
    bot.__botResolveRespawnLocation = () => new core.Location(3363, 4037);
    kill(bot, null); kill(outside, null);
    assert.deepEqual(at(bot), [3363, 4037, 0]);
    assert.deepEqual(at(outside), [GameConstants.DEFAULT_LOCATION.getX(), GameConstants.DEFAULT_LOCATION.getY(), 0]);
  });
  await t.test('an existing handled death keeps its destination without entering the fallback respawn phase', (t) => {
    const p = fighter(t);
    api.onPlayerDeath((event) => {
      if (event.player !== p) return;
      p.moveTo(new core.Location(3210, 3210));
      event.handled = true;
    });
    let fallback = false;
    api.onCustomEvent('player:respawn', (event) => { if (event.player === p) fallback = true; });
    kill(p, null);
    assert.deepEqual(at(p), [3210, 3210, 0]);
    assert.equal(fallback, false);
  });
  await t.test('the BH loot-key policy excludes the lobby and mixed/outside-area kills', (t) => {
    const a = fighter(t), b = fighter(t);
    keys.setLootKeysEnabled(a, true);
    assert.equal(keys.isEligibleKill(a, b), true);
    b.moveTo(new core.Location(state.CRATER.lobbyArrival.x, state.CRATER.lobbyArrival.y));
    assert.equal(keys.isEligibleKill(a, b), false);
    b.moveTo(new core.Location(3090, 3600));
    assert.equal(keys.isEligibleKill(a, b), false);
    a.moveTo(new core.Location(3091, 3600));
    assert.equal(keys.isEligibleKill(a, b), true, 'ordinary Wilderness keys keep working');
    a.moveTo(new core.Location(3200, 3200)); b.moveTo(new core.Location(3201, 3200));
    assert.equal(keys.isEligibleKill(a, b), false);
  });
  await t.test('using a key on the cache Loot Chest multiloc opens its real stored contents', (t) => {
    const p = fighter(t, false, new core.Location(state.CRATER.lobbyArrival.x, state.CRATER.lobbyArrival.y));
    const key = keys.createKey([new core.Item(core.ItemIdentifiers.COINS, 123)]);
    p.getInventory().addItem(key);
    const itemSlot = p.getInventory().getSlotForItemId(key.getId());
    const heldKey = p.getInventory().get(itemSlot);
    const chestId = core.CacheDefinitions.getLocId('wildy_hub_loot_chest_multi_small');
    const object = new core.GameObject(chestId, p.getLocation().clone(), 10, 0, null);
    const event = { player: p, object, objectId: chestId, item: heldKey, itemId: heldKey.getId(), itemSlot, handled: false };
    assert.equal(PluginManager.emitItemOnObject(event), true);
    assert.deepEqual(keys.chestItems(p), [{ id: core.ItemIdentifiers.COINS, amount: 123, meta: null }]);
    assert.equal(keys.countKeys(p), 0);
  });
  await t.test('the native key tabs open successive keys without losing unclaimed loot', (t) => {
    const p = fighter(t, false, new core.Location(3168, 3498));
    const messages = [];
    t.mock.method(p, 'sendMessage', (message) => messages.push(message));
    const I = core.ItemIdentifiers;
    const first = keys.createKey([new core.Item(I.COINS, 123)], 0);
    const second = keys.createKey([new core.Item(I.FIRE_RUNE, 7, { owner: 'second-key' })], 1);
    p.getInventory().addItem(first);
    p.getInventory().addItem(second);
    assert.equal(keys.openKey(p, 0), true);
    const flags = [], scripts = [];
    t.mock.method(p.getPacketSender(), 'sendInterfaceFlagsRange', (...args) => { flags.push(args); return p.getPacketSender(); });
    t.mock.method(p.getPacketSender(), 'sendInterfaceScript', (...args) => { scripts.push(args); return p.getPacketSender(); });
    keys._test.open(p);
    const tabs = (742 << 16) | 4, items = (742 << 16) | 5;
    assert.ok(flags.some(([uid, from, to, mask]) => uid === tabs && from === 0 && to === 4 && mask === 2), 'View tab must transmit, as well as running cache script 8017 locally');
    const tab = (slot, action = 1) => PluginManager.emitInterfaceActionClick({ player: p, buttonId: tabs, groupId: 742, childId: 4, slot, action, handled: false });
    assert.equal(tab(1), true);
    assert.equal(keys.countKeys(p), 1, 'switching cannot consume a key over unclaimed loot');
    assert.deepEqual(keys.chestItems(p), [{ id: I.COINS, amount: 123, meta: null }]);
    assert.match(messages.at(-1), /^Empty the current loot chest/);
    assert.equal(scripts.at(-1)[3][4842], 0, 'restore the server tab after the client switched locally');
    keys._test.handleInterfaceAction(p, { buttonId: items, slot: 0, action: 5 });
    assert.equal(keys.chestItems(p).length, 0);
    assert.equal(p.getInventory().getAmount(I.COINS), 123);
    for (const slot of [-1, 5, 1.5]) tab(slot);
    tab(1, 2);
    assert.equal(keys.countKeys(p), 1, 'invalid tab clicks cannot consume the key');
    assert.equal(tab(1), true);
    assert.equal(keys.countKeys(p), 0);
    assert.equal(keys.chestTab(p), 1);
    assert.deepEqual(keys.chestItems(p), [{ id: I.FIRE_RUNE, amount: 7, meta: { owner: 'second-key' } }]);
    assert.deepEqual(keys._test.nativeInventories(p)[559].slots, [{ slot: 0, itemId: I.FIRE_RUNE, quantity: 7 }]);
    keys._test.handleInterfaceAction(p, { buttonId: items, slot: 0, action: 5 });
    assert.equal(keys.chestItems(p)[0].amount, 7, 'a stale click from the previous tab cannot withdraw');
    keys._test.handleInterfaceAction(p, { buttonId: items, slot: 28, action: 5 });
    assert.equal(keys.chestItems(p).length, 0);
    assert.equal(p.getInventory().getAmount(I.FIRE_RUNE), 7);
    tab(1);
    assert.equal(keys.chestItems(p).length, 0, 'repeated empty-tab clicks never replay consumed keys');
  });
  await t.test('native key tabs show active and unopened loot values, clearing every absent tab on reopen', (t) => {
    const p = fighter(t, false, new core.Location(3168, 3498));
    const values = chestValues(t, p), I = core.ItemIdentifiers;
    p.getInventory().addItem(keys.createKey([new core.Item(I.COINS, 887_654)], 0));
    p.getInventory().addItem(keys.createKey([new core.Item(I.COINS, 1_234_567)], 3));
    assert.equal(keys.openKey(p, 0), true);
    keys._test.open(p);
    values(['887K', '', '', '1M', '']);
    p.getPacketSender().sendInterfaceRemoval();
    p.getInventory().deleteAtSlot(p.getInventory().getSlotForItemId(keys.KEY_IDS[3]), 1);
    keys._test.open(p);
    values(['887K', '', '', '', '']);
    assert.equal(keys.chestItems(p)[0].amount, 887_654, 'opening and refreshing labels never changes stored loot');
  });
  await t.test('key tab values refresh after partial withdrawal, discard, depletion and opening the next key', (t) => {
    const p = fighter(t, false, new core.Location(3168, 3498));
    const values = chestValues(t, p), I = core.ItemIdentifiers;
    const tabs = (742 << 16) | 4, items = (742 << 16) | 5;
    const click = (buttonId, slot, action) => PluginManager.emitInterfaceActionClick({ player: p, buttonId, slot, action, handled: false });
    p.getInventory().addItem(keys.createKey([new core.Item(I.COINS, 100)], 0));
    p.getInventory().addItem(keys.createKey([new core.Item(I.COINS, 2_147_483_647)], 1));
    assert.equal(keys.openKey(p, 0), true);
    keys._test.open(p);
    values(['100', '2147M', '', '', '']);
    assert.equal(click(items, 0, 3), true); // Take-10
    values(['90', '2147M', '', '', '']);
    assert.equal(click(items, 0, 8), true); // Destroy-X
    const discard = p.getEnteredAmountAction();
    discard.execute(20);
    values(['70', '2147M', '', '', '']);
    p.getPacketSender().sendInterfaceRemoval();
    discard.execute(20);
    assert.equal(keys.chestItems(p)[0].amount, 70, 'a stale closed-chest prompt cannot change the loot or its next label');
    keys._test.open(p);
    values(['70', '2147M', '', '', '']);
    assert.equal(click(items, 0, 5), true); // Take-All
    values(['', '2147M', '', '', '']);
    assert.equal(click(tabs, 1, 1), true);
    values(['', '2147M', '', '', '']);
    assert.equal(keys.countKeys(p), 0, 'the next key is consumed only when actually opened');
    assert.equal(click(items, 28, 9), true); // Destroy-All on tab 1
    values(['', '', '', '', '']);
  });
  await t.test('native key labels keep whole K/M boundaries and values above signed int32 in strings', (t) => {
    const p = fighter(t), values = chestValues(t, p), I = core.ItemIdentifiers;
    for (const [amount, expected] of [[999, '999'], [1000, '1K'], [999_999, '999K'], [1_000_000, '1M']]) {
      keys.setChestItems(p, [{ id: I.COINS, amount, meta: null }]);
      keys._test.open(p);
      values([expected, '', '', '', '']);
    }
    keys.setChestItems(p, [
      { id: I.COINS, amount: 2_000_000_000, meta: null },
      { id: I.COINS, amount: 1_500_000_000, meta: null },
    ]);
    keys._test.open(p);
    values(['3500M', '', '', '', '']);
  });
  for (const scenario of [
    { name: 'enabled keys collect a human victim', enabled: true },
    { name: 'enabled keys collect a BH bot victim', enabled: true, victimBot: true },
    { name: 'disabled keys leave ordinary ground loot', enabled: false },
    { name: 'bot killers leave ordinary ground loot', enabled: true, killerBot: true },
    { name: 'five keys leave ordinary ground loot', enabled: true, limit: true },
    { name: 'full inventory drops the key at the victim tile', enabled: true, full: true },
    { name: 'supply and floor-value settings still filter the key', enabled: true, settings: true },
  ]) await t.test(scenario.name, (t) => {
    floor.length = 0;
    const killer = fighter(t, scenario.killerBot, new core.Location(3138, 3626));
    killer.getInventory().adds(core.ItemIdentifiers.COINS, 1_000_000); toggleAtSkully(killer);
    assert.equal(keys.hasUnlockedLootKeys(killer), true); assert.equal(keys.hasEnabledLootKeys(killer), true);
    assert.equal(killer.getInventory().getAmount(core.ItemIdentifiers.COINS), 0, 'Skully charges only the initial unlock');
    if (!scenario.enabled) toggleAtSkully(killer);
    killer.moveTo(new core.Location(3447, 4005)); AreaManager.process(killer);
    const victim = fighter(t, scenario.victimBot), metadata = { 'bh-test': 'preserved' };
    victim.getInventory().addItem(new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR, 1, metadata));
    if (scenario.limit) for (let i = 0; i < keys.MAX_KEYS; i++) killer.getInventory().addItem(keys.createKey([new core.Item(core.ItemIdentifiers.COINS, 1)], i));
    if (scenario.full) killer.getInventory().adds(core.ItemIdentifiers.BRONZE_FULL_HELM, 28);
    if (scenario.settings) {
      keys.setSettings(killer, { includeSupplies: false, floorValue: 1000 });
      victim.getInventory().adds(core.ItemIdentifiers.SHARK, 1); victim.getInventory().adds(core.ItemIdentifiers.COINS, 10);
    }
    kill(victim, killer);
    const received = killer.getInventory().getValidItems().filter(keys.isLootKey), droppedKeys = floor.filter((x) => keys.isLootKey(x.item));
    if (scenario.enabled && !scenario.killerBot && !scenario.limit) {
      const key = scenario.full ? droppedKeys[0]?.item : received[0];
      assert.ok(key && keys.isLootKey(key));
      assert.deepEqual(keys.keyItems(key), scenario.settings ? [{ id: core.ItemIdentifiers.COINS, amount: 10, meta: null }]
        : [{ id: core.ItemIdentifiers.RUNE_SCIMITAR, amount: 1, meta: metadata }]);
      assert.equal(floor.some((x) => x.item.getId() === core.ItemIdentifiers.RUNE_SCIMITAR), scenario.settings === true);
      if (scenario.full) assert.deepEqual([droppedKeys[0].location.getX(), droppedKeys[0].location.getY()], [3446, 4005]);
      if (scenario.settings) assert.ok(floor.some((x) => x.item.getId() === core.ItemIdentifiers.SHARK));
    } else {
      assert.equal(received.length, scenario.limit ? keys.MAX_KEYS : 0); assert.equal(droppedKeys.length, 0);
      assert.ok(floor.some((x) => x.item.getId() === core.ItemIdentifiers.RUNE_SCIMITAR));
    }
  });
});
