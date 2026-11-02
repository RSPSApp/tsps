// Run after `yarn build`: node --test tests/bot-brain.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize();
  require('../plugins/bots/behaviours/pvp/PvpTierLoadouts.PlayerBots').initPvpTierLoadouts({
    core: require('../dist/plugins/PluginManager').PluginManager.getCoreApi(),
  });
  require('../plugins/items/ItemDefinitionLoader.plugin').register({
    log() {}, onPlayerLogin() {}, registerContentEndpoint() {},
  });
});
const { BotBrain } = require('../plugins/bots/brain/Brain.PlayerBots');
const {
  buildPvpSeekIndex,
  nearby,
  activeTargetCount,
  hotspotFightCount,
  trackEngagement,
} = require('../plugins/bots/brain/pvp/PvpSeekIndex.PlayerBots');

const fakePlayer = (name = 'bot', x = 3100, y = 3600) => ({
  getUsername: () => name,
  getForceMovement: () => null,
  getMovementQueue: () => ({ size: () => 0 }),
  getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => 0 }),
});

/** Registry stub that counts capacity slots and records cooldown blocks. */
function fakeRegistry(next = []) {
  const slots = new Map();
  const blocked = [];
  return {
    slots,
    blocked,
    occupy: (a) => slots.set(a.id, (slots.get(a.id) ?? 0) + 1),
    release: (a) => slots.set(a.id, (slots.get(a.id) ?? 0) - 1),
    blockActivity: (_, id) => blocked.push(id),
    pickActivity: () => next.shift() ?? null,
    resolversFor: (req) => req.resolvers ?? [],
  };
}

const action = (id, results) => ({ id, update: () => results.shift() ?? 'running' });
const tickN = (brain, n) => { for (let i = 0; i < n; i++) brain.tick(i); };

test('unmet setup pushes a resolver; the parent resumes once it succeeds', () => {
  let hasAxe = false;
  const resolver = {
    id: 'withdraw_axe', resolver: true,
    actions: [{ id: 'bank', update: () => { hasAxe = true; return 'success'; } }],
  };
  const chop = action('chop', []);
  const activity = {
    id: 'woodcutting', mode: 'woodcutting', repeat: true,
    setup: [{ id: 'axe', check: () => hasAxe, resolvers: [resolver] }],
    actions: [chop],
  };
  const registry = fakeRegistry();
  const state = { mode: 'roaming' };
  const brain = new BotBrain({ player: fakePlayer(), state, registry, activity });
  brain.tick(0);
  assert.equal(brain.frames.at(-1).behaviour.id, 'withdraw_axe');
  tickN(brain, 4);
  assert.equal(brain.frames.length, 1);
  assert.equal(brain.frames[0].action().id, 'chop');
  assert.equal(state.mode, 'woodcutting');
  assert.equal(registry.slots.get('woodcutting'), 1, 'resolvers take no capacity slot');
});

test('a failed activity is blocked, releases its slot and the brain picks the next one', () => {
  const roam = { id: 'roam', mode: 'roaming', actions: [action('wander', [])] };
  const registry = fakeRegistry([roam]);
  const activity = { id: 'mining', mode: 'mining', actions: [action('mine', ['failed'])] };
  const brain = new BotBrain({ player: fakePlayer(), state: {}, registry, activity });
  tickN(brain, 3);
  assert.deepEqual(registry.blocked, ['mining']);
  assert.equal(registry.slots.get('mining'), 0);
  assert.equal(brain.frames[0].behaviour.id, 'roam');
});

test('an ended action takes its pending walk with it', () => {
  const { requestMovement, peekMovementRequest } = require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  // A busy queue keeps the brain from dispatching the walk for real.
  const player = { ...fakePlayer('walker'), getMovementQueue: () => ({ size: () => 1 }) };
  let pendingAtMine = 'unset';
  const bank = { id: 'bank', update: () => { requestMovement(player, 3268, 3169, { reason: 'brain_bank_approach' }); return 'success'; } };
  const mine = { id: 'mine', update: () => { pendingAtMine = peekMovementRequest(player); return 'running'; } };
  const brain = new BotBrain({ player, state: {}, registry: fakeRegistry(), activity: { id: 'mining', repeat: true, actions: [bank, mine] } });
  tickN(brain, 3);
  assert.equal(pendingAtMine, null, 'a booth walk that never completes must not hold up the next action');
});

test('an ended action closes the interface it left open (bank screen after a deposit)', () => {
  let interfaceId = 12;
  let closed = 0;
  const player = {
    ...fakePlayer('banker'), getInterfaceId: () => interfaceId,
    getPacketSender: () => ({ sendInterfaceRemoval: () => { closed += 1; interfaceId = -1; } }),
  };
  const bank = { id: 'bank', update: () => 'success' };
  const train = { id: 'train', update: () => 'running' };
  const brain = new BotBrain({ player, state: {}, registry: fakeRegistry(), activity: { id: 'a', repeat: true, actions: [bank, train] } });
  tickN(brain, 2);
  assert.equal(closed, 1);
  assert.equal(interfaceId, -1, 'the next action starts with no interface open (not busy)');
});

test('the wilderness ditch is jumped across its own axis (north-south piece at 2996,3530-3533)', () => {
  const { resolveJump } = require('../plugins/objects/WildernessDitch.plugin');
  const at = (x, y) => ({ getLocation: () => ({ getX: () => x, getY: () => y }) });
  assert.deepEqual(resolveJump(at(3090, 3520), { x: 3090, y: 3521 }, { x: 3090, y: 3520 }, 0), { dx: 0, dy: 3, direction: 0 });
  assert.deepEqual(resolveJump(at(3090, 3523), { x: 3090, y: 3521 }, { x: 3090, y: 3523 }, 2), { dx: 0, dy: -3, direction: 2 });
  assert.deepEqual(resolveJump(at(2995, 3533), { x: 2996, y: 3533 }, { x: 2995, y: 3533 }, 3), { dx: 3, dy: 0, direction: 1 }, 'west side jumps east');
  assert.deepEqual(resolveJump(at(2998, 3533), { x: 2996, y: 3533 }, { x: 2998, y: 3533 }, 3), { dx: -3, dy: 0, direction: 3 }, 'east side jumps west');
});

test('a bot without a rotation returns to its own activity, never a random one (wilderness pvp bots)', () => {
  const pvp = { id: 'pvp', mode: 'pvp', actions: [action('fight', ['failed'])] };
  const asked = [];
  const registry = { ...fakeRegistry(), pickActivity: (_, __, options) => { asked.push(options); return options.own === 'pvp' ? pvp : null; } };
  const brain = new BotBrain({ player: fakePlayer('WildyBot1'), state: {}, registry, activity: pvp });
  tickN(brain, 3);
  assert.deepEqual(asked[0], { own: 'pvp' }, 'only its own activity, whatever the capacity');
  assert.equal(brain.frames[0]?.behaviour.id, 'pvp');
});

test('cooking: food goes on a fire nearby; with no range or fire about, the bot lights one', () => {
  const Cooking = require('../plugins/skills/Cooking.plugin');
  Cooking._test.setApi({ core: require('../dist/plugins/PluginManager').PluginManager.getCoreApi() });
  const Firemaking = require('../plugins/skills/Firemaking.plugin');
  const { createCookAction } = require('../plugins/bots/brain/actions/Cook.PlayerBots');
  const { Skill } = require('../dist/game/model/Skill');
  const { Location: Loc } = require('../dist/game/model/Location');
  const real = { cooking: Cooking.isCookingActive, firemaking: Firemaking.isFiremakingActive,
    light: Firemaking.startBotInventoryFiremaking, canBurn: Firemaking.canPlayerBurnLog, logs: Firemaking.LIGHTABLE_LOGS };
  const RAW_SHRIMPS = 317;
  const LOGS = 1511;
  const items = new Map([[RAW_SHRIMPS, 27]]);
  const used = [];
  let lit = null;
  const fire = { getId: () => 26185, getLocation: () => new Loc(3230, 3220, 0), getDefinition: () => ({ getName: () => 'Fire' }) };
  const objects = [];
  try {
    Cooking.isCookingActive = () => false;
    Firemaking.isFiremakingActive = () => false;
    Firemaking.canPlayerBurnLog = () => true;
    Firemaking.LIGHTABLE_LOGS = [{ itemId: LOGS }];
    Firemaking.startBotInventoryFiremaking = (_, logId) => { lit = logId; return true; };
    const world = {
      core: { Skill, World: { getObjects: () => objects } },
      objectSearch: { findCandidatesByIds: () => [] },
      emitItemOnObject: (event) => used.push([event.itemId, event.objectId]),
    };
    const a = createCookAction({}, world);
    const player = {
      ...fakePlayer('cook', 3225, 3220),
      getSkillManager: () => ({ getCurrentLevel: () => 1 }),
      getInventory: () => ({
        getItems: () => [...items].flatMap(([id, n]) => Array.from({ length: n }, () => ({ getId: () => id }))),
        getAmount: (id) => items.get(id) ?? 0,
        adds: (id, n) => items.set(id, (items.get(id) ?? 0) + n),
        isFull: () => false,
        deleteNumber: () => {},
      }),
      getMovementQueue: () => ({ size: () => 0, walkToObject: (object, { execute }) => execute() }),
    };
    items.set(LOGS, 1);
    assert.equal(a.update({ player, nowMs: 1000 }), 'running');
    assert.equal(lit, LOGS, 'no range or fire nearby: lights one fire with its log');
    assert.ok(items.get(590) > 0, 'with a tinderbox it was given (a tool)');
    objects.push(fire);
    a.update({ player, nowMs: 5000 });
    assert.deepEqual(used, [[RAW_SHRIMPS, 26185]], 'then uses the raw food on the fire');
    items.set(RAW_SHRIMPS, 0);
    assert.equal(a.update({ player, nowMs: 9000 }), 'success', 'nothing left to cook');
  } finally {
    Object.assign(Cooking, { isCookingActive: real.cooking });
    Object.assign(Firemaking, { isFiremakingActive: real.firemaking, startBotInventoryFiremaking: real.light, canPlayerBurnLog: real.canBurn, LIGHTABLE_LOGS: real.logs });
  }
});

test('fishing spots are indexed by the tools they take (from the cache option list)', () => {
  const { spotKeys } = require('../plugins/bots/brain/actions/Fish.PlayerBots');
  const spot = (name, actions) => ({ getName: () => name, getId: () => 1520, getActions: () => actions });
  assert.deepEqual(spotKeys(spot('Fishing spot', ['Cage', 'Harpoon', null, null, null])), ['LOBSTER_POT', 'HARPOON']);
  assert.deepEqual(spotKeys(spot('Rod Fishing spot', ['Lure', 'Bait', null, null, null])), ['FLY_FISHING_ROD', 'PIKE_ROD']);
  assert.equal(spotKeys(spot('Goblin', ['Attack'])), null);
});

/** Fishing action scene: a spot the bot cannot route into reach, and one it can. */
function fishingScene(reachableDestX, playerX = 2600, playerY = 3400) {
  const { Location: Loc } = require('../dist/game/model/Location');
  const spotNpc = (x, y) => ({
    getLocation: () => new Loc(x, y, 0),
    getSpawnPosition: () => new Loc(x, y, 0),
    getDefinition: () => ({ getName: () => 'Fishing spot', getId: () => 1520, getActions: () => ['Cage'] }),
    getId: () => 1520,
    getSize: () => 1,
    isRegistered: () => true,
  });
  const near = spotNpc(2600, 3400);
  const far = spotNpc(2608, 3400);
  const walked = [];
  const world = {
    core: {
      World: { getNpcs: () => [near, far], getNpcsNear: () => [near, far] },
      RsmodRouteFinding: class {
        findRoute({ destX, destY }) { return { success: true, endX: destX, endY: destY }; }
        reachedAbsolute({ destX }) { return destX === reachableDestX; }
      },
    },
    routes: { canReachSpot: () => true },
  };
  const player = {
    ...fakePlayer('fisher', playerX, playerY),
    getPrivateArea: () => null,
    getSize: () => 1,
    getInventory: () => ({ isFull: () => false, getAmount: () => 0, adds: () => {}, deleteNumber: () => {} }),
    getMovementQueue: () => ({ size: () => 0, walkToEntity: (spot) => walked.push(spot) }),
  };
  return { world, player, walked, near, far };
}

test('a fishing spot the bot cannot reach is skipped for a reachable one', () => {
  const { createFishAction } = require('../plugins/bots/brain/actions/Fish.PlayerBots');
  const Fishing = require('../plugins/skills/Fishing.plugin');
  const real = { spotTools: Fishing.spotTools, isFishingActive: Fishing.isFishingActive };
  Fishing.spotTools = () => [{ tool: 'LOBSTER_POT', clickType: 1 }];
  Fishing.isFishingActive = () => false;
  try {
    // Only the far spot (2608) can be routed into reach; the near one is locked away.
    const s = fishingScene(2608);
    const a = createFishAction({ tool: 'LOBSTER_POT' }, s.world);
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 10000 }), 'running');
    assert.equal(s.walked.length, 0, 'never walks at the unreachable spot');
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 20000 }), 'running');
    assert.deepEqual(s.walked, [s.far], 'walks at the reachable spot instead');
  } finally {
    Fishing.spotTools = real.spotTools;
    Fishing.isFishingActive = real.isFishingActive;
  }
});

test('a fishing cluster with no reachable spot is dropped, not idled on', () => {
  const { createFishAction } = require('../plugins/bots/brain/actions/Fish.PlayerBots');
  const Fishing = require('../plugins/skills/Fishing.plugin');
  const real = { spotTools: Fishing.spotTools, isFishingActive: Fishing.isFishingActive };
  Fishing.spotTools = () => [{ tool: 'LOBSTER_POT', clickType: 1 }];
  Fishing.isFishingActive = () => false;
  try {
    // No spot can be routed into reach: the level-locked Fishing Guild.
    const s = fishingScene(0);
    const a = createFishAction({ tool: 'LOBSTER_POT' }, s.world);
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 10000 }), 'running');
    assert.equal(s.walked.length, 0, 'never walks at any of them');
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 20000 }), 'failed', 'the cluster is abandoned');
  } finally {
    Fishing.spotTools = real.spotTools;
    Fishing.isFishingActive = real.isFishingActive;
  }
});

test('a fishing site whose planning is starved is taken after a short grace, not stood on', () => {
  const { createFishAction } = require('../plugins/bots/brain/actions/Fish.PlayerBots');
  const Fishing = require('../plugins/skills/Fishing.plugin');
  const real = { spotTools: Fishing.spotTools, isFishingActive: Fishing.isFishingActive };
  Fishing.spotTools = () => [{ tool: 'LOBSTER_POT', clickType: 1 }];
  Fishing.isFishingActive = () => false;
  try {
    const s = fishingScene(2608);
    s.world.routes.canReachSpot = () => undefined; // the planner's budget is always spent
    const a = createFishAction({ tool: 'LOBSTER_POT' }, s.world);
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 10000 }), 'running');
    assert.equal(s.walked.length, 0, 'waits out the short grace');
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 20000 }), 'running');
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 30000 }), 'running');
    assert.deepEqual(s.walked, [s.far], 'then takes the best cluster and walks at a spot');
  } finally {
    Fishing.spotTools = real.spotTools;
    Fishing.isFishingActive = real.isFishingActive;
  }
});

test('a site walk that produces no movement at all is dropped quickly', () => {
  const { createFishAction } = require('../plugins/bots/brain/actions/Fish.PlayerBots');
  const { peekMovementRequest: peek } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const Fishing = require('../plugins/skills/Fishing.plugin');
  const real = { spotTools: Fishing.spotTools, isFishingActive: Fishing.isFishingActive };
  Fishing.spotTools = () => [{ tool: 'LOBSTER_POT', clickType: 1 }];
  Fishing.isFishingActive = () => false;
  try {
    const s = fishingScene(2608, 2500, 3400);
    s.world.core.World.getNpcsNear = () => []; // none near: the bot is walking to the site
    const a = createFishAction({ tool: 'LOBSTER_POT' }, s.world);
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 10000 }), 'running');
    assert.notEqual(peek(s.player), null, 'walk request to the site is out');
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 20000 }), 'running');
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 30000 }), 'running');
    assert.equal(peek(s.player), null, 'no-movement site walk is dropped and its request cleared');
    assert.equal(a.update({ player: s.player, state: {}, nowMs: 40000 }), 'failed', 'the site is abandoned');
  } finally {
    Fishing.spotTools = real.spotTools;
    Fishing.isFishingActive = real.isFishingActive;
  }
});

for (const outcome of ['success', 'failed']) {
  test(`an overlay hands state.mode back to its parent on ${outcome}`, () => {
    const state = {};
    const registry = fakeRegistry();
    const parent = { id: 'roam', mode: 'roaming', repeat: true, actions: [action('wander', [])] };
    const brain = new BotBrain({ player: fakePlayer(), state, registry, activity: parent });
    brain.tick(0);
    brain.pushActivity({ id: 'pvp_engage', mode: 'pvp', actions: [action('fight', [outcome])] }, 1);
    assert.equal(state.mode, 'pvp');
    tickN(brain, 3);
    assert.equal(state.mode, 'roaming');
    assert.equal(brain.frames.length, 1);
    assert.equal(registry.slots.get('pvp_engage'), 0);
  });
}

test('an exhausted ephemeral brain calls onExhausted instead of picking work', () => {
  let exhausted = 0;
  const registry = fakeRegistry([{ id: 'roam', actions: [action('wander', [])] }]);
  const brain = new BotBrain({
    player: fakePlayer(), state: {}, registry, ephemeral: true,
    onExhausted: () => exhausted++,
    activity: { id: 'bank_trip', actions: [action('bank', ['success'])] },
  });
  tickN(brain, 3);
  assert.equal(exhausted, 1);
  assert.equal(brain.frames.length, 0);
});

test('reset releases every frame slot, not just the top one', () => {
  const registry = fakeRegistry();
  const brain = new BotBrain({
    player: fakePlayer(), state: {}, registry,
    activity: { id: 'roam', actions: [action('wander', [])] },
  });
  brain.pushActivity({ id: 'pvp_engage', actions: [action('fight', [])] }, 0);
  brain.reset();
  assert.equal(registry.slots.get('roam'), 0);
  assert.equal(registry.slots.get('pvp_engage'), 0);
});

test('pvp seek index buckets nearby bots and tracks target caps within a tick', () => {
  const a = fakePlayer('a', 3100, 3600);
  const b = fakePlayer('b', 3105, 3600);
  const far = fakePlayer('far', 3300, 3900);
  const entries = [
    { player: a, state: { mode: 'pvp', pvp: {} } },
    { player: b, state: { mode: 'pvp', pvp: { targetUsername: 'victim', hotspotId: 'edge', phase: 'combat' } } },
    { player: far, state: { mode: 'pvp', pvp: {} } },
  ];
  const index = buildPvpSeekIndex({
    entries,
    world: { getPlayers: () => [] },
    pvpMode: 'pvp',
    isInCombat: () => true,
  });
  const near = nearby(index.botBuckets, a, 16).map((entry) => entry.player.getUsername());
  assert.deepEqual(near.sort(), ['a', 'b']);
  assert.equal(index.entryByPlayer.get(a), entries[0]);
  assert.equal(activeTargetCount(index, 'victim'), 1);
  assert.equal(activeTargetCount(index, 'victim', 'b'), 0, 'a bot does not count against itself');
  trackEngagement(index, a, { pvp: { hotspotId: 'edge' } }, 'victim');
  assert.equal(activeTargetCount(index, 'victim'), 2);
  assert.equal(hotspotFightCount(index, 'edge'), 1);
});

test('with nothing in live range a gatherer walks to the nearest indexed object, else searches home', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  // Swamp copper sits 70 tiles from the Lumbridge spawn: outside the live 3x3 search.
  // The nearer indexed rock has no route (the planner says so), the next one does.
  const indexed = [{ id: 7, x: 3200, y: 3150 }, { id: 7, x: 3229, y: 3148 }];
  const asked = [];
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [],
      findNearestIndexedLocation: (_, ids, { accept }) => {
        asked.push(ids);
        const hit = indexed.find((entry) => accept(entry.id, entry.x, entry.y, 0));
        return hit ? { x: hit.x, y: hit.y, z: 0 } : null;
      },
    },
    routes: { canReachSpot: (_player, spot) => spot.x !== 3200 },
  };
  const run = () => {
    const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
    const player = {
      ...fakePlayer('miner'), getLocation: () => new Loc(3222, 3218, 0), getPrivateArea: () => null,
      getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    };
    assert.equal(a.update({ player, state: { home: { x: 3222, y: 3218 } }, nowMs: 0, frame: { lastProgressAt: 0 } }), 'wait');
    const request = peek(player);
    clear(player);
    return request;
  };
  const toMine = run();
  assert.ok(Math.abs(toMine.x - 3229) <= 10 && Math.abs(toMine.y - 3148) <= 10,
    `walks to the nearest reachable indexed rock, got ${toMine.x},${toMine.y}`);
  indexed.length = 0;
  const home = run();
  assert.ok(Math.abs(home.x - 3222) <= 10 && Math.abs(home.y - 3218) <= 10, 'nothing indexed: searches around home');
  assert.ok(asked.length >= 2 && asked[0].length > 0, 'asks the index with the catalog ids');
});

test('re-mining a respawned rock from the same tile is not mistaken for an unreachable rock', () => {
  const { createInteractObjectAction, CLAIMS } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const rock = { getId: () => 11161, getLocation: () => new Loc(3230, 3145, 0) };
  CLAIMS.clear();
  let clicks = 0;
  const world = {
    objectSearch: { findCandidatesByIds: () => [rock] },
    emitObjectInteraction: () => { clicks += 1; },
  };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => new Loc(3230, 3146, 0),
    // The instance branch of MapObjects.get resolves the rock without loading map files.
    getPrivateArea: () => ({ getObjects: () => [rock] }),
    getInventory: () => ({ isFull: () => false }),
    getMovementQueue: () => ({ size: () => 0, walkToObject: (_, { execute }) => execute() }),
  };
  const frame = { lastProgressAt: 0 };
  const tick = (nowMs) => a.update({ player, state: {}, nowMs, frame });
  for (let nowMs = 2000; nowMs <= 10000; nowMs += 2000) {
    tick(nowMs);
    frame.lastProgressAt = nowMs + 500; // mining:success - an ore landed, the rock respawned
  }
  assert.equal(clicks, 5);
  assert.match(a.describe({ player, nowMs: 10000 }), /target=11161@3230,3145/, 'a productive rock is kept');
  for (let nowMs = 12000; nowMs <= 26000; nowMs += 2000) tick(nowMs); // >= 10 s of clicks doing nothing
  assert.match(a.describe({ player, nowMs: 26000 }), /target=none/, 'clicks that do nothing: this bot moves on');
  CLAIMS.clear();
  const other = { ...player, getUsername: () => 'other' };
  a.update({ player: other, state: {}, nowMs: 27000, frame: { lastProgressAt: 0 } });
  assert.match(a.describe({ player: other, nowMs: 27000 }), /target=11161@3230,3145/, 'other bots still use the rock');
});

test('idle bots re-send their facing so it survives the final walk step', () => {
  const { refreshIdleFace } = require('../plugins/bots/behaviours/task/BehaviorTask.PlayerBots');
  let forced = 0;
  const player = {
    getPositionToFace: () => ({ x: 1, y: 2 }),
    getMovementQueue: () => ({ size: () => 0 }),
    getForceMovement: () => null,
    forcePositionToFace: () => { forced += 1; },
  };
  assert.equal(refreshIdleFace(player), true, 'idle with a face target re-sends it');
  assert.equal(forced, 1);
  player.getMovementQueue = () => ({ size: () => 1 });
  assert.equal(refreshIdleFace(player), false, 'not while walking');
  player.getMovementQueue = () => ({ size: () => 0 });
  player.getPositionToFace = () => null;
  assert.equal(refreshIdleFace(player), false, 'nothing to face');
});

test('forced facing is re-sent after walking (same-coordinate setPositionToFace no-ops)', () => {
  const { Mobile } = require('../dist/game/entity/impl/Mobile');
  const { UpdateFlag } = require('../dist/game/model/UpdateFlag');
  const { Location: Loc } = require('../dist/game/model/Location');
  const { Flag } = require('../dist/game/model/Flag');
  const { Direction } = require('../dist/game/model/Direction');
  const mobile = Object.assign(Object.create(Mobile.prototype), {
    positionToFace: null,
    updateFlag: new UpdateFlag(),
  });
  mobile.setLocation(new Loc(0, 0, 0));
  const tree = new Loc(2, 2, 0);
  mobile.setPositionToFace(tree);
  assert.ok(mobile.updateFlag.flagged(Flag.FACE_POSITION), 'the first set flags the face');
  assert.equal(mobile.getFacingDirection(), Direction.NORTH_EAST, 'the real helper updates the heading');
  mobile.updateFlag.reset(); // the packet was sent; walking turned the visual facing
  mobile.setPositionToFace(tree);
  assert.equal(mobile.updateFlag.flagged(Flag.FACE_POSITION), false, 'same coordinates no-op');
  mobile.forcePositionToFace(tree);
  assert.ok(mobile.updateFlag.flagged(Flag.FACE_POSITION), 'force re-sends the face');
});

test('walking at a live gather target counts as progress for the brain stall', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const world = { objectSearch: { findCandidatesByIds: () => [] }, emitObjectInteraction: () => {} };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'tin', option: 'Mine' }, world);
  const player = { ...fakePlayer('miner'), getPrivateArea: () => null };
  let moved = true;
  const ctx = { player, state: {}, nowMs: 1000, brain: { movedSinceLastTick: () => moved } };
  assert.equal(a.madeProgress(ctx), true, 'a long approach is progress');
  moved = false;
  assert.equal(a.madeProgress(ctx), false, 'standing still is not');
});

test('a gather walk that produces no movement is dropped instead of retried forever', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const rock = { getId: () => 11361, getLocation: () => new Loc(3155, 3340, 0), getType: () => 10, getFace: () => 0 };
  const world = {
    core: { RsmodRouteFinding: class { findRoute() { return { success: false }; } } },
    objectSearch: { findCandidatesByIds: () => [rock] },
    emitObjectInteraction: () => {},
  };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'tin', option: 'Mine' }, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => new Loc(3161, 3347, 0),
    getPrivateArea: () => ({ getObjects: () => [rock] }),
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0, walkToObject: () => {} }),
  };
  const frame = { lastProgressAt: 0 };
  a.update({ player, state: {}, nowMs: 2000, frame });
  assert.match(a.describe({ player, nowMs: 2000 }), /target=11361@3155,3340/, 'approaches the rock first');
  for (let nowMs = 4000; nowMs <= 26000; nowMs += 2000) {
    frame.lastProgressAt = nowMs; // the activity is alive; only movement is missing
    a.update({ player, state: {}, nowMs, frame });
  }
  assert.match(a.describe({ player, nowMs: 26000 }), /target=none/, 'the stalled walk is dropped');
});

test('an object behind a fence is walked at with brain movement, not clicked blindly', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const rock = { getId: () => 11361, getLocation: () => new Loc(3172, 3366, 0), getType: () => 10, getFace: () => 0 };
  let clicks = 0;
  const world = {
    core: { RsmodRouteFinding: class { findRoute() { return { success: false }; } } },
    objectSearch: { findCandidatesByIds: () => [rock] },
    emitObjectInteraction: () => { clicks += 1; },
  };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'tin', option: 'Mine' }, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => new Loc(3161, 3347, 0),
    getPrivateArea: () => ({ getObjects: () => [rock] }),
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0, walkToObject: (_, { execute }) => execute() }),
  };
  const frame = { lastProgressAt: 0 };
  a.update({ player, state: {}, nowMs: 2000, frame });
  assert.equal(clicks, 0, 'no click that cannot arrive');
  assert.deepEqual([peek(player)?.x, peek(player)?.y, peek(player)?.reason], [3172, 3366, 'brain_target_approach']);
  for (let nowMs = 4000; nowMs <= 16000; nowMs += 2000) a.update({ player, state: {}, nowMs, frame });
  assert.match(a.describe({ player, nowMs: 16000 }), /target=none/, 'this bot gives the rock up');
  assert.equal(a.madeProgress({ player }), true, 'giving the rock up is progress: no frame stall');
  clear(player);
});

test('a far spot the route planner cannot reach (an island) is never picked', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const { clearMovementRequest: clear } = require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const spots = [{ x: 3100, y: 3100, z: 0 }, { x: 3150, y: 3230, z: 0 }]; // Tutorial Island, then the mainland
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [],
      findNearestIndexedLocation: (_player, _ids, { accept }) => spots.find((spot) => accept(1276, spot.x, spot.y, 0)) ?? null,
    },
    routes: { canReachSpot: (_player, spot) => spot.x !== 3100 },
  };
  const a = createInteractObjectAction({ catalog: 'tree', tier: 'normal', option: 'Chop down' }, world);
  const player = {
    ...fakePlayer('chopper'), getLocation: () => new Loc(3155, 3147, 0), getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }),
  };
  a.update({ player, state: {}, nowMs: 1000, frame: { lastProgressAt: 1000 } });
  assert.match(a.describe({ player, nowMs: 1000 }), /far=3150,3230/, 'the island is skipped for the next reachable spot');
  clear(player);
});

test('gatherers claim their rock; a crowd moves on to the next spot instead of queueing', () => {
  const { createInteractObjectAction, CLAIMS } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  CLAIMS.clear();
  const rock = { getId: () => 11161, getLocation: () => new Loc(3230, 3145, 0) };
  const asked = [];
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [rock],
      // Another copper mine 150 tiles away, plus the crowded rock itself.
      findNearestIndexedLocation: (player, _ids, { accept }) => {
        const hit = [[3230, 3145], [3300, 3290]].find(([x, y]) => accept(11161, x, y, 0));
        asked.push(hit);
        return hit ? { x: hit[0], y: hit[1], z: 0 } : null;
      },
    },
    emitObjectInteraction: () => {},
  };
  const miner = (name) => ({
    ...fakePlayer(name), getLocation: () => new Loc(3230, 3146, 0), isRegistered: () => true,
    getPrivateArea: () => ({ getObjects: () => [rock] }),
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0, walkToObject: (_, { execute }) => execute() }),
  });
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const first = miner('first');
  const second = miner('second');
  const { requestMovement } = require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  requestMovement(first, 3308, 3015, { reason: 'brain_search_walk' }); // leftover far search walk
  a.update({ player: first, state: {}, nowMs: 1000, frame: { lastProgressAt: 0 } });
  assert.equal(CLAIMS.get('11161:3230:3145:0')?.player, first, 'the first miner claims the rock');
  assert.equal(peek(first), null, 'the leftover search walk is dropped, so it cannot drag the miner away');
  assert.equal(a.update({ player: second, state: {}, nowMs: 1000, frame: { lastProgressAt: 0 } }), 'wait');
  assert.equal(asked.length, 0, 'a short crowd is waited out: the rock respawns in seconds');
  assert.equal(peek(second), null);
  CLAIMS.get('11161:3230:3145:0').until = 90000; // the first miner is still on it a minute later
  a.update({ player: second, state: {}, nowMs: 62000, frame: { lastProgressAt: 0 } });
  assert.deepEqual(asked.at(-1), [3300, 3290], 'a lasting crowd: the second looks past the crowded spot');
  assert.deepEqual([peek(second)?.x >= 3290, peek(second)?.y >= 3280], [true, true], 'and heads for the next mine');
  clear(first); clear(second); CLAIMS.clear();
});

test('a far walk that stalls makes only that bot try another spot', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const { clearMovementRequest: clear } = require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const spots = [{ x: 3285, y: 3361, z: 0 }, { x: 3300, y: 3290, z: 0 }];
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [],
      findNearestIndexedLocation: (_player, _ids, { accept }) => spots.find((spot) => accept(11161, spot.x, spot.y, 0)) ?? null,
    },
    routes: { canReachSpot: () => true },
  };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const bot = (name, x, y) => ({
    ...fakePlayer(name), getLocation: () => new Loc(x, y, 0), getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }),
  });
  const stuck = bot('stuck', 3230, 3146);
  const far = (player) => a.describe({ player, nowMs: 0 }).match(/far=(\S+)/)[1];
  const tick = (player, nowMs) => { a.update({ player, state: {}, nowMs, frame: { lastProgressAt: nowMs - 1000 } }); clear(player); };
  tick(stuck, 1000);
  assert.equal(far(stuck), '3285,3361');
  tick(stuck, 40000);
  assert.equal(far(stuck), '3285,3361', 'not yet: 60 s without getting closer');
  tick(stuck, 62000);
  assert.equal(far(stuck), '3300,3290', 'no closer for a minute: this bot tries another spot');
  const other = bot('other', 3240, 3300);
  tick(other, 63000);
  assert.equal(far(other), '3285,3361', 'other bots still go there: ores never run out');
});

test('choose re-rolls a weighted option each time and runs its actions in order', () => {
  const { createChooseAction } = require('../plugins/bots/brain/actions/Choose.PlayerBots');
  const ran = [];
  const step = (name) => ({ id: name, update: () => { ran.push(name); return 'success'; } });
  const a = createChooseAction({
    options: [
      { weight: 3, actions: ['drop'] },
      { weight: 1, actions: ['smelt', 'sell'] },
    ],
  }, step);
  const realRandom = Math.random;
  const ctx = { player: fakePlayer('bot') };
  try {
    Math.random = () => 0.1; // 0.4 of 4 -> first option
    assert.equal(a.update(ctx), 'success');
    Math.random = () => 0.9; // 3.6 of 4 -> second option, two steps
    assert.equal(a.update(ctx), 'running');
    assert.equal(a.update(ctx), 'success');
  } finally {
    Math.random = realRandom;
  }
  assert.deepEqual(ran, ['drop', 'smelt', 'sell']);
});

test('sellItems walks to the nearest general store keeper and sells through the shop', () => {
  const { createSellItemsAction } = require('../plugins/bots/brain/actions/SellItems.PlayerBots');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const keeper = {
    ...fakeNpc('Shop keeper', 3212, 3246),
    getDefinition: () => ({ getId: () => 2813, getName: () => 'Shop keeper' }),
  };
  const sold = [];
  let opened = null;
  let stand = new Loc(3230, 3146, 0);
  const inventory = new Map([[436, 3], [438, 2], [333, 16]]);
  const world = {
    core: {
      World: { getNpcs: () => [keeper], getNpcsNear: () => [keeper] },
      ShopManager: {
        INVENTORY_INTERFACE_ID: 3823,
        open: (_p, shopId) => { opened = shopId; return true; },
        close: () => {},
        handleItemContainerAction: (_p, act) => { sold.push([act.itemId, act.amount]); inventory.delete(act.itemId); },
      },
    },
  };
  const player = {
    ...fakePlayer('miner'), getLocation: () => stand, getPrivateArea: () => null,
    getMovementQueue: () => ({ size: () => 0 }),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      getItems: () => [...inventory.keys()].map((id) => ({ getId: () => id })),
    }),
  };
  const a = createSellItemsAction({ itemIds: [436, 438] }, world, new Map([[2813, 1222]]));
  assert.equal(a.update({ player, nowMs: 1000 }), 'running');
  assert.deepEqual([peek(player).x, peek(player).y], [3212, 3246], 'walks to the store found in the NPC index');
  clear(player);
  stand = new Loc(3213, 3247, 0);
  assert.equal(a.update({ player, nowMs: 60000 }), 'success');
  assert.equal(opened, 1222, 'opens the keeper\'s general store');
  assert.deepEqual(sold, [[436, 3], [438, 2]], 'sells only the listed resources');
  assert.equal(inventory.get(333), 16, 'the rest of the inventory is kept');
});

test('a bank one bot cannot walk to is skipped by that bot only', () => {
  const { createBankAction } = require('../plugins/bots/brain/actions/Bank.PlayerBots');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const boothId = 6083; // a bank booth id; no cache in tests, so give it its Bank option
  const realForId = ObjectDefinition.forId;
  ObjectDefinition.forId = (id) => (id === boothId ? { getInteractions: () => ['Bank'] } : realForId.call(ObjectDefinition, id));
  const booth = (x, y) => ({ getId: () => boothId, getLocation: () => new Loc(x, y, 0) });
  const alKharid = booth(3269, 3167);
  const draynor = booth(3092, 3243);
  const world = { objectSearch: { findCandidatesByIds: () => [alKharid, draynor] } };
  const a = createBankAction({}, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => new Loc(3240, 3180, 0), getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => true }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }), getCombat: () => ({ getTarget: () => null }),
  };
  a.update({ player, state: {}, nowMs: 1000 });
  assert.equal(peek(player)?.x, 3269, 'heads for the nearest bank first');
  clear(player);
  a.update({ player, state: {}, nowMs: 22000 }); // stood at the toll gate the whole time
  a.update({ player, state: {}, nowMs: 23000 });
  assert.equal(peek(player)?.x, 3092, 'this bot uses the next-nearest bank');
  clear(player);
  const other = { ...player, getUsername: () => 'other' };
  a.update({ player: other, state: {}, nowMs: 24000 });
  assert.equal(peek(other)?.x, 3269, 'other bots still use the nearest one');
  clear(other);
  ObjectDefinition.forId = realForId;
});

test('a nearby bank booth across a wall is approached by brain movement, not a failed direct walk', () => {
  const { createBankAction } = require('../plugins/bots/brain/actions/Bank.PlayerBots');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const boothId = 6083;
  const realForId = ObjectDefinition.forId;
  ObjectDefinition.forId = (id) => (id === boothId ? { getInteractions: () => ['Bank'] } : realForId.call(ObjectDefinition, id));
  const booth = {
    getId: () => boothId,
    getLocation: () => new Loc(2946, 3369, 0),
    getDefinition: () => ({ getSizeX: () => 1, getSizeY: () => 1 }),
  };
  const world = {
    objectSearch: { findCandidatesByIds: () => [booth] },
    // Every strict route fails: the Falador wall between the bot and the booth.
    core: { RsmodRouteFinding: class { findRoute() { return { success: false }; } } },
  };
  const a = createBankAction({}, world);
  const player = {
    ...fakePlayer('chopper'), getLocation: () => new Loc(2935, 3367, 0), getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => true }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({
      size: () => 0,
      walkToObject: () => { throw new Error('core walk used across a wall'); },
    }),
    getCombat: () => ({ getTarget: () => null }),
  };
  a.update({ player, state: {}, nowMs: 2000 });
  assert.equal(peek(player)?.x, 2946, 'walks at the booth with brain movement');
  assert.equal(peek(player)?.y, 3369);
  clear(player);
  ObjectDefinition.forId = realForId;
});

test('a bank upstairs: the bot walks back down to its floor before the step ends', () => {
  const { createBankAction } = require('../plugins/bots/brain/actions/Bank.PlayerBots');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const boothId = 18491;
  const realForId = ObjectDefinition.forId;
  ObjectDefinition.forId = (id) => (id === boothId ? { getInteractions: () => [null, 'Bank'] } : realForId.call(ObjectDefinition, id));
  const castleBooth = { getId: () => boothId, getLocation: () => new Loc(3208, 3221, 2) };
  const world = { objectSearch: { findCandidatesByIds: (_, __, { z }) => (z === 2 ? [castleBooth] : []) } };
  const a = createBankAction({}, world);
  let at = new Loc(3215, 3218, 0);
  let full = true;
  const player = {
    ...fakePlayer('banker'), getLocation: () => at, getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => full }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }), getCombat: () => ({ getTarget: () => null }),
  };
  a.update({ player, state: {}, nowMs: 1000 });
  assert.equal(peek(player)?.z, 2, 'walks to the booth on the top floor');
  clear(player);
  at = new Loc(3208, 3220, 2);
  full = false; // deposited
  assert.equal(a.update({ player, state: {}, nowMs: 2000 }), 'running', 'not done while upstairs');
  assert.deepEqual([peek(player)?.x, peek(player)?.y, peek(player)?.z], [3215, 3218, 0], 'heads back down to where it came from');
  clear(player);
  at = new Loc(3206, 3229, 0);
  assert.equal(a.update({ player, state: {}, nowMs: 3000 }), 'success', 'done once back on its floor');
  ObjectDefinition.forId = realForId;
});

test('a firemaker on a tile that refuses fires (a bank floor) moves off it, and gives up if nowhere works', () => {
  const Firemaking = require('../plugins/skills/Firemaking.plugin');
  const { createLightFireAction } = require('../plugins/bots/brain/actions/LightFire.PlayerBots');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const real = { ...Firemaking };
  // The bank tile the bot stands on refuses fires; the street outside does not.
  let blockedTiles = (loc) => loc.getX() === 3208 && loc.getY() === 3220;
  let started = 0;
  Object.assign(Firemaking, {
    isFiremakingActive: () => false,
    isWoodcuttingLog: () => true,
    canPlayerBurnLog: () => true,
    isFireTileBlocked: (loc) => blockedTiles(loc),
    startBotInventoryFiremaking: () => { started += 1; return true; },
  });
  try {
    const a = createLightFireAction({}, {});
    const player = {
      ...fakePlayer('firemaker', 3208, 3220), getPrivateArea: () => null,
      getInventory: () => ({ getItems: () => [{ getId: () => 1511 }] }),
      getMovementQueue: () => ({ size: () => 0 }),
    };
    assert.equal(a.update({ player }), 'running');
    assert.ok(peek(player), 'walks to a clear tile instead of retrying the refused one');
    assert.equal(started, 0, 'never lights on a refused tile');
    clear(player);
    blockedTiles = () => true; // nowhere clear around
    a.update({ player }); clear(player);
    a.update({ player }); clear(player);
    assert.equal(a.update({ player }), 'failed', 'nowhere clear: the step gives up so the activity moves on');
    blockedTiles = () => false;
    assert.equal(a.update({ player }), 'running');
    assert.equal(started, 1, 'lights on a clear tile');
  } finally {
    Object.assign(Firemaking, real);
  }
});

test('a gatherer commits to its far spot: no turning back halfway, and it waits on arrival', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  let at = new Loc(3230, 3150, 0);
  const asked = [];
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [],
      // Nearest spot from wherever the bot stands: the swamp mine behind it, or Varrock ahead.
      findNearestIndexedLocation: (player) => {
        const here = player.getLocation();
        const spot = here.getY() < 3260 ? { x: 3230, y: 3146, z: 0 } : { x: 3285, y: 3361, z: 0 };
        asked.push(spot);
        return spot;
      },
    },
    routes: { canReachSpot: () => true },
  };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => at, getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }),
  };
  const far = () => a.describe({ player, nowMs: 0 }).match(/far=(\S+)/)[1];
  const frame = { lastProgressAt: 0 };
  at = new Loc(3260, 3300, 0); // heading for Varrock
  a.update({ player, state: {}, nowMs: 1000, frame });
  assert.equal(far(), '3285,3361');
  clear(player);
  at = new Loc(3270, 3330, 0); // halfway, the swamp mine no longer in reach either way
  a.update({ player, state: {}, nowMs: 5000, frame });
  assert.equal(far(), '3285,3361', 'keeps its spot instead of re-picking from here');
  clear(player);
  at = new Loc(3283, 3358, 0); // arrived, rocks all depleted
  a.update({ player, state: {}, nowMs: 9000, frame });
  a.update({ player, state: {}, nowMs: 60000, frame });
  assert.equal(far(), '3285,3361', 'waits on arrival rather than turning back');
  clear(player);
});

test('a long walk toward a far spot counts as progress for the brain', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject.PlayerBots');
  const { clearMovementRequest: clear } = require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  let at = new Loc(3150, 3307, 0);
  const world = { objectSearch: { findCandidatesByIds: () => [], findNearestIndexedLocation: () => ({ x: 3285, y: 3361, z: 0 }) } };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => at, getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }),
  };
  const ctx = (nowMs) => ({ player, state: {}, nowMs, frame: { lastProgressAt: nowMs - 1000 } });
  a.update(ctx(1000));
  assert.equal(a.madeProgress(ctx(1000)), false, 'just picked the spot');
  at = new Loc(3200, 3320, 0);
  clear(player);
  a.update(ctx(30000));
  assert.equal(a.madeProgress(ctx(30000)), true, 'closer: progress');
  assert.equal(a.madeProgress(ctx(30000)), false, 'reported once');
  clear(player);
});

test('a tier list gathers from every listed rock kind', () => {
  const { resolveCatalogObjectIds } = require('../plugins/bots/brain/ObjectCatalog.PlayerBots');
  const copper = resolveCatalogObjectIds({ catalog: 'rock', tier: 'copper' });
  const tin = resolveCatalogObjectIds({ catalog: 'rock', tier: 'tin' });
  const both = resolveCatalogObjectIds({ catalog: 'rock', tier: ['copper', 'tin'] });
  assert.ok(copper.length > 0 && tin.length > 0);
  assert.deepEqual([...both].sort(), [...new Set([...copper, ...tin])].sort());
});

const { createPvpCombatAction } = require('../plugins/bots/brain/actions/PvpCombat.PlayerBots');
const { PvpController } = require('../plugins/bots/brain/pvp/PvpController.PlayerBots');
const { Location } = require('../dist/game/model/Location');
const { peekMovementRequest, clearMovementRequest } = require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
const { __testing: loadoutTesting } = require('../plugins/bots/behaviours/policies/PvpLoadoutPolicy.PlayerBots');
const { getWildernessHotspot, listWildernessHotspots } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry.PlayerBots');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');

test('a requested PvP profile and archetype reach the first kit before the bot joins the world', () => {
  const { createBotRegistry } = require('../plugins/bots/runtime/Registry.PlayerBots');
  const { assignPvpMetadata } = require('../plugins/bots/behaviours/pvp/PvpAssignment.PlayerBots');
  let equipped, joined = false;
  const metadata = { profileId: 'elite', loadoutId: 'deep_wild_nh', generatedArchetypeId: 'elite_nh_ags',
    combatLevelRange: { min: 121, max: 126 } };
  const registry = createBotRegistry({
    botApi: { getRegionManager: () => ({}) }, botCount: 0, spawn: new Location(3423, 4120),
    behaviorMode: { PVP: 'pvp' }, worldGetPlayerByName: () => null,
    createBotPlayer: (name, location) => ({ ...fakePlayer(name), getLocation: () => location }),
    createInitialState: () => ({ pvp: {} }), assignPvpMetadata,
    buildRoamingPvpMetadata: () => { throw new Error('an explicit kit must not be replaced by a random one'); },
    applyInitialPvpLoadout: (_, state) => { assert.equal(joined, false); equipped = state.pvp; return true; },
    emitPlayerLogin: () => { joined = true; }, ensureBehaviorTaskStarted() {},
  });
  assert.ok(registry.spawnPvpBot(new Location(3423, 4120), { username: 'BhProfile', pvpMetadata: metadata }));
  for (const key of ['profileId', 'loadoutId', 'generatedArchetypeId', 'combatLevelRange']) {
    assert.deepEqual(equipped[key], metadata[key], key);
  }
  assert.equal(joined, true);
  assignPvpMetadata({ pvp: equipped }, { metadata: { profileId: 'elite', loadoutId: 'deep_wild_nh' } });
  assert.equal(equipped.generatedArchetypeId, 'elite_nh_ags', 'ordinary reassignment preserves its chosen archetype');
});

test('regional PvP bots use varied catalogue gear and favour towns over the levelled Wilderness', (t) => {
  const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
  const { createBotRegistry } = require('../plugins/bots/runtime/Registry.PlayerBots');
  const { buildRoamingPvpMetadata, assignPvpMetadata } = require('../plugins/bots/behaviours/pvp/PvpAssignment.PlayerBots');
  const { PVP_BOT_SETTINGS } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry.PlayerBots');
  let seed = 652;
  t.mock.method(Math, 'random', () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // A PvP world makes the town attackable too; keep the real Wilderness level calculation.
  t.mock.method(Wilderness, 'intersectsArea', () => true);
  t.mock.method(Wilderness, 'isInLocation', () => true);
  let regionsUpdated;
  const generated = [];
  const registry = createBotRegistry({
    botApi: { getRegionManager: () => ({ blocked: () => false, isWater: () => false }) },
    botCount: 0,
    wildernessRoamerBotCount: 128,
    wildernessActiveRegionBotsPerRegion: PVP_BOT_SETTINGS.activeRegionBotsPerRegion,
    spawn: new Location(3222, 3218),
    behaviorMode: { PVP: 'pvp' },
    createBotPlayer: (name, location) => ({ ...fakePlayer(name), getLocation: () => location, isPlayerBot: () => true }),
    createInitialState: () => ({ pvp: {} }),
    buildRoamingPvpMetadata: () => buildRoamingPvpMetadata({ config: { pvp: { profileWeights: [{ value: 'elite', weight: 1 }] } } }),
    assignPvpMetadata,
    applyInitialPvpLoadout: (player, state) => {
      generated.push(loadoutTesting.buildGeneratedPreset(player, state));
      return true;
    },
    emitPlayerLogin() {}, ensureBehaviorTaskStarted() {},
    randomInRange: (min) => min,
    onActiveRegionsUpdated: (handler) => { regionsUpdated = handler; },
  });
  registry.scheduleInitialSpawn();
  const snapshot = { regions: [
    { key: '0:50:50', regionX: 50, regionY: 50, z: 0 },
    { key: '0:50:57', regionX: 50, regionY: 57, z: 0 },
  ] };
  for (let batch = 0; batch < 20; batch++) regionsUpdated(snapshot);
  const counts = new Map();
  for (const { player } of registry.entries) {
    const regionY = player.getLocation().getY() >> 6;
    counts.set(regionY, (counts.get(regionY) ?? 0) + 1);
  }
  assert.equal(counts.get(50), 48, 'town PvP regions have more bots than the former 32');
  assert.equal(counts.get(57), 16, 'levelled Wilderness regions have fewer bots than the former 32');
  assert.ok(generated.every((entry) => entry && !entry.archetypeId.startsWith('preset:')),
    'roamers use the varied catalogue instead of the eighteen player presets');
  assert.ok(new Set(generated.map((entry) => entry.archetypeId)).size > 18);
  const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
  assert.ok(generated.some((entry) => entry.preset.getInventory().some((item) => item.getId() === ItemIdentifiers.DRAGON_CLAWS)),
    'valuable gear can appear in the loot');
});

test('unmatched pvp bots walk between seek retries; overlays return to their activity', () => {
  const calls = [];
  const controller = {
    tick: () => calls.push('fight'), ensureLoadout() {},
    seek: () => calls.push('seek'), wanderWhileSeeking: () => calls.push('walk'),
  };
  const ctx = { nowMs: 10, player: { getHitpoints: () => 99 }, state: { pvp: { nextActionAt: 100 } } };
  createPvpCombatAction({}, controller).update(ctx);
  assert.deepEqual(calls, ['walk']);
  calls.length = 0;
  assert.equal(createPvpCombatAction({ exitWhenIdle: true }, controller).update(ctx), 'success');
  assert.deepEqual(calls, []);
  ctx.player.getCombat = () => ({ getTarget: () => ({ getHitpoints: () => 99 }) });
  createPvpCombatAction({}, controller).update(ctx);
  assert.deepEqual(calls, ['fight']);
});

test('the PvP action and controller retaliate against bot attacks without a player-click event', () => {
  const { PvpValidateEngagementNode } = require('../plugins/bots/behaviours/nodes/pvp/PvpValidateEngagementNode.PlayerBots');
  const { CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const actor = (name) => ({ ...fakePlayer(name), isPlayer: () => true,
    isRegistered: () => true, getHitpoints: () => 99, busy: () => false });
  const player = actor('defender'), quarry = actor('assigned-target'), attacker = actor('rogue');
  let combatTarget = null, incoming = attacker, permitted = true;
  const attacks = [];
  player.getCombat = () => ({ getTarget: () => combatTarget, getAttacker: () => incoming,
    attack: (target) => { attacks.push(target); combatTarget = target; } });
  const state = { mode: 'pvp', pvp: {} };
  const controller = Object.create(PvpController.prototype);
  const pass = { tick: () => ({ handled: false }) };
  Object.assign(controller, {
    botStatesByName: new Map([[player.getUsername(), state]]), behaviorMode: { PVP: 'pvp' },
    ServerPerf: { measurePhase: (_, fn) => fn() }, ensureLoadout() {},
    replenishAfterKillNode: pass, jumpKilledTargetNode: pass,
    freezeAndKiteNode: { ...pass, maybeMoveBetweenHits() {} }, vengeanceNode: pass,
    combatExecutionNode: { tick: () => 'running' }, getProfile: () => ({}),
    CombatFactory: { getMethod: () => null, canAttackPermission: (_, target) =>
      permitted || target !== attacker ? CanAttackResponse.CAN_ATTACK : CanAttackResponse.CANT_ATTACK_IN_AREA },
  });
  controller.validateEngagementNode = new PvpValidateEngagementNode({
    api: { getAreaManager: () => ({ inMulti: () => false }), getCombatFactory: () => controller.CombatFactory },
    resolveTargetPlayer: (state) => state.pvp.targetPlayer,
    isValidTarget: controller.isValidTarget.bind(controller),
  });
  const action = createPvpCombatAction({}, controller);
  const tick = () => action.update({ player, state, nowMs: 1000 });
  const pursue = () => { combatTarget = quarry; state.pvp = {
    targetPlayer: quarry, targetUsername: quarry.getUsername(), endsAt: 10_000,
  }; attacks.length = 0; };

  tick();
  assert.equal(attacks.at(-1), attacker, 'an unmatched bot also fights back');
  pursue();
  tick();
  assert.equal(attacks.at(-1), attacker, 'an assigned quarry cannot lock out retaliation');
  assert.equal(state.pvp.targetUsername, attacker.getUsername());
  assert.ok(state.pvp.endsAt > 1000);

  for (const invalid of [
    null, { ...attacker, getHitpoints: () => 0 }, { ...attacker, isRegistered: () => false },
    { ...attacker, isPlayer: () => false }, { ...attacker, getPrivateArea: () => ({}) },
  ]) {
    pursue(); incoming = invalid; tick();
    assert.equal(state.pvp.targetPlayer, quarry, 'invalid or absent attackers cannot replace the quarry');
    assert.equal(attacks.length, 0);
  }
  pursue(); incoming = attacker; permitted = false; tick();
  assert.equal(state.pvp.targetPlayer, quarry, 'retaliation respects combat permissions');
  assert.equal(attacks.length, 0);
});

test('PvP brains retaliate before eating consumes the turn, including an assigned attacker', () => {
  const { PvpValidateEngagementNode } = require('../plugins/bots/behaviours/nodes/pvp/PvpValidateEngagementNode.PlayerBots');
  const { CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const actor = (name) => ({ ...fakePlayer(name), isPlayer: () => true,
    isRegistered: () => true, getHitpoints: () => 99, busy: () => false });
  const player = actor('defender'), quarry = actor('assigned-target'), attacker = actor('incoming');
  let combatTarget = null, permitted = true, fleeing = false, actions = 0;
  const attacks = [];
  player.getCombat = () => ({ getTarget: () => combatTarget, getAttacker: () => attacker,
    attack: (target) => { attacks.push(target); combatTarget = target; } });
  const state = { mode: 'pvp', pvp: { targetPlayer: quarry, targetUsername: quarry.getUsername() } };
  const controller = Object.create(PvpController.prototype);
  Object.assign(controller, {
    botStatesByName: new Map([[player.getUsername(), state]]), behaviorMode: { PVP: 'pvp' },
    maintainCombatBoostsActionNode: { tick: () => 'failure' },
    defensiveActionNode: { tick: () => ({ handled: fleeing }) },
    eatFoodActionNode: { tick: () => 'success' },
    resolveTargetPlayer: (state) => state.pvp.targetPlayer,
    CombatFactory: { getMethod: () => null, canAttackPermission: () => permitted
      ? CanAttackResponse.CAN_ATTACK : CanAttackResponse.CANT_ATTACK_IN_AREA },
  });
  controller.validateEngagementNode = new PvpValidateEngagementNode({
    api: { getAreaManager: () => ({ inMulti: () => false }), getCombatFactory: () => controller.CombatFactory },
    isValidTarget: controller.isValidTarget.bind(controller),
  });
  const brain = new BotBrain({ player, state, registry: fakeRegistry(),
    activity: { id: 'pvp', mode: 'pvp', actions: [{ id: 'fight', update: () => { actions++; return 'running'; } }] },
    world: { supportTick: (context) => controller.tickSupport(context) },
  });
  brain.tick(1000);
  assert.equal(actions, 0, 'eating holds the normal action');
  assert.deepEqual(attacks, [attacker], 'support still establishes a legal return attack');
  assert.equal(state.pvp.targetPlayer, attacker, 'an unrelated assignment cannot hide the actual attacker');
  assert.equal(state.pvp.targetUsername, attacker.getUsername());
  assert.equal(state.pvp.endsAt, 31000);
  brain.tick(1600);
  assert.equal(attacks.length, 1, 'established combat is not reissued each turn');
  combatTarget = null;
  brain.tick(2200);
  assert.equal(attacks.length, 2, 'the assigned target is re-engaged if combat was interrupted');
  combatTarget = null;
  permitted = false;
  brain.tick(2800);
  assert.equal(attacks.length, 2, 'area and single-combat permissions still apply');
  permitted = true;
  fleeing = true;
  state.pvp.retreat = {};
  brain.tick(3400);
  assert.equal(attacks.length, 2, 'a committed retreat remains in control');
});

test('idle pvp walking stays inside its hotspot and pauses for movement or combat', () => {
  const hotspot = getWildernessHotspot('edge_mains');
  const { x: spotX, y: spotY } = hotspot.anchor;
  const player = { ...fakePlayer('wander', spotX, spotY), getLocation: () => new Location(spotX, spotY, 0) };
  const state = { autonomy: { allowedAutonomousModes: ['pvp'] }, pvp: { hotspotId: 'edge_mains' },
    roaming: { nextWalkAt: 0, roamBounds: hotspot.area } };
  const controller = Object.create(PvpController.prototype);
  controller.api = { getRegionManager: () => ({ blocked: () => false, isWater: () => false }) };
  controller.getEntries = () => [];
  controller.wanderWhileSeeking({ player, state, nowMs: 100 });
  const request = peekMovementRequest(player);
  assert.ok(request);
  assert.ok(request.x >= hotspot.area.minX && request.x <= hotspot.area.maxX &&
    request.y >= hotspot.area.minY && request.y <= hotspot.area.maxY);
  assert.notDeepEqual([request.x, request.y], [spotX, spotY]);
  assert.ok(state.roaming.nextWalkAt >= 3600);
  clearMovementRequest(player);
  assert.equal(controller.wanderWhileSeeking({ player, state, nowMs: 101 }), false);
  player.getCombat = () => ({ getAttacker: () => ({}) });
  assert.equal(controller.wanderWhileSeeking({ player, state, nowMs: 20000 }), false);
  assert.equal(peekMovementRequest(player), null);
});

test('hotspot clusters fill their band from their loadout catalogue; the ditch stays f2p', () => {
  for (const hotspot of listWildernessHotspots()) {
    if (hotspot.id === 'varrock_ditch') {
      assert.equal(hotspot.presetGroup ?? null, null, 'the ditch is not a preset cluster');
      for (const loadoutId of hotspot.allowedLoadouts) {
        assert.ok(loadoutId.startsWith('f2p_'), `${hotspot.id} is free-to-play only`);
      }
      continue;
    }
    assert.equal(hotspot.presetGroup ?? null, null, `${hotspot.id} does not use player presets`);
    const band = hotspot.combatLevelRange;
    for (const loadoutId of hotspot.allowedLoadouts) {
      assert.equal(loadoutId.startsWith('f2p_'), false, `${hotspot.id} is members-only`);
      const generated = loadoutTesting.buildGeneratedPreset(null, {
        pvp: { hotspotId: hotspot.id, loadoutId, profileId: hotspot.allowedProfiles[0] },
      });
      assert.ok(generated, `${hotspot.id}/${loadoutId} generates a loadout`);
      const stats = generated.preset.getStats();
      const level = SkillManager.prototype.getCombatLevel.call({ skills: { maxLevel: stats } });
      assert.ok(level >= band.min && level <= band.max,
        `${hotspot.id}/${loadoutId}: level ${level} outside ${band.min}-${band.max}`);
    }
  }
});

test('every catalogue archetype builds a full loadout, including optional empty inventory slots', () => {
  const { PVP_LOADOUTS, PVP_LOADOUT_DEFINITIONS } = require('../plugins/bots/behaviours/pvp/PvpLoadoutRegistry.PlayerBots');
  for (const loadout of Object.values(PVP_LOADOUTS)) {
    for (const archetypeId of loadout.archetypes) {
      const generated = loadoutTesting.buildGeneratedPreset(null, {
        pvp: { loadoutId: loadout.id, profileId: 'elite', generatedArchetypeId: archetypeId },
      });
      assert.equal(generated?.archetypeId, archetypeId, `${loadout.id}/${archetypeId}`);
      assert.equal(generated.preset.getInventory().length, 28);
      assert.ok(generated.preset.getEquipment().length > 0);
      const slots = generated.preset.getEquipment().map((item) => item.getDefinition().getEquipmentType().getSlot());
      assert.ok(slots.includes(Equipment.WEAPON_SLOT), `${archetypeId} has a usable weapon`);
      const definition = PVP_LOADOUT_DEFINITIONS.archetypes.find((entry) => entry.id === archetypeId);
      for (const [key, slot] of [['body', Equipment.BODY_SLOT], ['legs', Equipment.LEG_SLOT]]) {
        if (!Array.isArray(definition.equipment[key]) || !definition.equipment[key].includes(null)) {
          assert.ok(slots.includes(slot), `${archetypeId} has wearable ${key} armour`);
        }
      }
    }
  }
});

const fs = require('node:fs');
const { createTrainCombatAction } = require('../plugins/bots/brain/actions/TrainCombat.PlayerBots');
const { Skill } = require('../dist/game/model/Skill');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { FightStyle } = require('../dist/game/content/combat/FightStyle');
const { Flag } = require('../dist/game/model/Flag');
const trainingDefinition = JSON.parse(fs.readFileSync('data/definitions/bot-activities.json', 'utf8'))
  .activities.find((a) => a.id === 'combat_training').actions[0];
const combatGear = JSON.parse(fs.readFileSync('data/definitions/bot-combat-gear.json', 'utf8'))[trainingDefinition.gearRef];
const trainingSpec = { ...trainingDefinition, ...combatGear };

const chickenSpec = trainingSpec;
const NPC_LEVELS = { Chicken: 1, Duck: 1, Goblin: 2, Cow: 2, Frog: 5, Barbarian: 10, 'Big frog': 10, Guard: 21 };

/** A fake NPC spawned at x,y; indexed by World.getNpcs and found by the live search. */
function fakeNpc(name, x, y, extra = {}) {
  const definition = { isAttackable: () => true, getName: () => name, getCombatLevel: () => NPC_LEVELS[name] ?? 1 };
  return {
    isNpc: () => true, isRegistered: () => true, isDyingFunction: () => false,
    getHitpoints: () => 3, getPrivateArea: () => null,
    getLocation: () => new Location(x, y, 0), getSpawnPosition: () => new Location(x, y, 0),
    getDefinition: () => definition,
    getCurrentDefinition: () => definition,
    getCombat: () => ({ getTarget: () => null, getAttacker: () => null }),
    ...extra,
  };
}

/** A walk that never moves the bot: three brain ticks over 9 s. Returns the last result. */
function freeze(s, a) {
  let result;
  for (let i = 0; i < 3; i += 1) { s.ctx.nowMs += 3000; result = a.update(s.ctx); }
  return result;
}

function trainingScene(level = 1) {
  let target = null, owner = null, hp = 10, npcHp = 3, registered = true;
  let location = new Location(3230, 3298, 0), permission = true;
  const levels = Array(24).fill(level), items = [], inventory = new Map();
  const attacks = [], changes = [], logs = [], xp = [];
  const styles = [FightStyle.ACCURATE, FightStyle.AGGRESSIVE, FightStyle.DEFENSIVE]
    .map((style, index) => ({ getStyle: () => style, getChildId: () => index }));
  class TrainingItem {
    constructor(id, amount = 1) { this.id = id; this.amount = amount; }
    getId() { return this.id; }
    getAmount() { return this.amount; }
    getDefinition() { return { getRequirements: () => [], isDoubleHanded: () => true }; }
  }
  const npc = {
    isNpc: () => true, isRegistered: () => registered, isDyingFunction: () => false,
    getHitpoints: () => npcHp, getPrivateArea: () => null,
    getLocation: () => new Location(3230, 3298, 0), getSpawnPosition: () => new Location(3230, 3298, 0),
    getDefinition: () => ({ isAttackable: () => true, getName: () => 'Chicken', getCombatLevel: () => 1 }),
    getCurrentDefinition: () => ({ isAttackable: () => true, getName: () => 'Chicken', getCombatLevel: () => 1 }),
    getCombat: () => ({ getTarget: () => owner, getAttacker: () => owner }),
  };
  const player = {
    ...fakePlayer('trainee'), getLocation: () => location, getPrivateArea: () => null,
    isRegistered: () => true, getHitpoints: () => hp, isDyingReturn: () => false,
    getCombat: () => ({ getTarget: () => target, getAttacker: () => null,
      attack: (n) => { target = n; attacks.push(n); }, reset: () => { target = null; } }),
    getSkillManager: () => ({ getMaxLevel: (s) => levels[s.getIndex()],
      getCurrentLevel: (s) => levels[s.getIndex()], addExperience: (...args) => xp.push(args) }),
    getEquipment: () => ({ getItems: () => items, set: (slot, item) => { items[slot] = item; }, refreshItems() {} }),
    getInventory: () => ({ getAmount: (id) => inventory.get(id) ?? 0,
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount)) }),
    getWeapon: () => ({ getFightType: () => styles }), getUpdateFlag: () => ({ flag() {} }),
    setCombatFollowing() {},
  };
  const world = {
    core: { Skill, Equipment, Item: TrainingItem, ItemIdentifiers, Flag, FightStyle,
      World: { getNpcsNear: () => [npc], getNpcs: () => [npc] },
      WorldDefinition: { isMembersArea: () => false },
      RsmodRouteFinding: class { findRoute({ destX, destY }) { return { success: true, endX: destX, endY: destY }; } },
      CombatSpells: new Proxy({}, { get: () => ({ levelRequired: () => 1, itemsRequired: () => [] }) }),
      Autocasting: { setAutocast() {} },
      CombatFactory: { getMethod: () => ({}), canAttackPermission: () => permission ? 'yes' : 'no' },
      CanAttackResponse: { CAN_ATTACK: 'yes' },
      WeaponInterfaceManager: { assign() {}, changeCombatStyle: (_, slot) => changes.push(slot) },
    },
    refreshEquipment() {}, regionManager: { loadMapFiles() {} }, log: (_, d) => logs.push(d),
  };
  const ctx = { player, state: { combatStyle: 'melee' }, nowMs: 1000 };
  return { player, npc, world, ctx, attacks, changes, items, levels, logs, inventory, xp, TrainingItem,
    kill: () => { npcHp = 0; }, die: () => { hp = 0; }, revive: () => { hp = 10; },
    occupy: () => { owner = {}; }, deny: () => { permission = false; },
    unregister: () => { registered = false; },
    move: (x, y) => { location = new Location(x, y, 0); },
  };
}

test('combat trainers start on chickens, provision tier-one gear and use normal NPC attacks', () => {
  const s = trainingScene(), a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  const tierOne = trainingSpec.gearTiers.find((tier) => tier.minLevel === 1);
  assert.equal(s.logs[0].stage, 'beginner');
  assert.deepEqual(s.attacks, [s.npc]);
  assert.ok(tierOne.weapons.map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.WEAPON_SLOT].getId()), 'weapon comes from the tier pool');
  assert.ok(tierOne.armour.BODY_SLOT.filter(Boolean).map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.BODY_SLOT].getId()), 'body comes from the tier pool');
  assert.equal(s.inventory.get(ItemIdentifiers.TROUT), 16);
  assert.equal(s.changes[0], 0);
  s.ctx.nowMs += 600; a.update(s.ctx);
  assert.equal(s.attacks.length, 1, 'do not restart a fight every tick');
  assert.deepEqual(s.xp, [], 'no artificial XP');
  a.stop(s.ctx);
});

test('training balances melee skills and upgrades weapons and armour independently', () => {
  const s = trainingScene(5);
  s.levels[Skill.ATTACK.getIndex()] = 20;
  s.levels[Skill.DEFENCE.getIndex()] = 10;
  const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
  const weaponTier = trainingSpec.gearTiers.find((tier) => tier.minLevel === 20);
  const armourTier = trainingSpec.gearTiers.find((tier) => tier.minLevel === 10);
  assert.ok(weaponTier.weapons.map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.WEAPON_SLOT].getId()), 'weapon tier follows Attack');
  assert.ok(armourTier.armour.BODY_SLOT.filter(Boolean).map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.BODY_SLOT].getId()), 'armour tier follows Defence');
  assert.equal(s.changes[0], 1, 'train lowest skill: Strength');
  assert.equal(s.logs[0].stage, 'beginner', 'high Attack alone does not promote fragile bots');
  a.stop(s.ctx);
});

test('trainers finish fights before level promotion or ending a timed session', () => {
  const s = trainingScene();
  s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Goblin', 3250, 3246)];
  const a = createTrainCombatAction({ ...chickenSpec, durationSeconds: { min: 1, max: 1 } }, s.world);
  a.update(s.ctx); s.levels.fill(10); s.ctx.nowMs = 5000;
  assert.equal(a.update(s.ctx), 'running');
  s.kill(); assert.equal(a.update(s.ctx), 'success'); a.stop(s.ctx);
  s.ctx.nowMs = 6000; a.update(s.ctx);
  assert.equal(s.logs.at(-1).stage, 'novice');
  a.stop(s.ctx);
});

test('higher training tiers select monks/barbarians and guards and walk from home', () => {
  for (const [level, stage] of [[20, 'intermediate'], [40, 'advanced']]) {
    const s = trainingScene(level); s.move(3089, 3524);
    s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Barbarian', 3080, 3420), fakeNpc('Guard', 3211, 3430)];
    const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
    assert.equal(s.logs[0].stage, stage);
    assert.equal(s.attacks.length, 0);
    assert.equal(peekMovementRequest(s.player).reason, 'brain_combat_training');
    a.stop(s.ctx);
  }
});

test('NPC training skips occupied, forbidden, dead and unregistered targets', () => {
  for (const setup of ['occupy', 'deny', 'kill', 'unregister']) {
    const s = trainingScene(); s[setup]();
    const a = createTrainCombatAction(chickenSpec, s.world); a.update(s.ctx);
    assert.equal(s.attacks.length, 0, setup); a.stop(s.ctx);
  }
});

test('NPC reservations prevent simultaneous claims, and stop releases them', () => {
  const first = trainingScene(), second = trainingScene();
  second.world.core.World.getNpcsNear = () => [first.npc];
  const a = createTrainCombatAction(chickenSpec, first.world);
  const b = createTrainCombatAction(chickenSpec, second.world);
  a.update(first.ctx); b.update(second.ctx);
  assert.equal(second.attacks.length, 0);
  a.stop(first.ctx); second.ctx.nowMs += 2000; b.update(second.ctx);
  assert.deepEqual(second.attacks, [first.npc]); b.stop(second.ctx);
});

test('stalled targets are abandoned and death resets the training destination', () => {
  const s = trainingScene(), a = createTrainCombatAction(chickenSpec, s.world); a.update(s.ctx);
  s.ctx.nowMs += 46000; a.update(s.ctx);
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.equal(s.attacks.length, 1);
  s.die(); a.update(s.ctx); s.revive(); s.ctx.nowMs += 2000; a.update(s.ctx);
  assert.equal(s.logs.length, 2); a.stop(s.ctx);
});

test('trainers skip a cluster the route planner cannot reach (jail, desert pass)', () => {
  const s = trainingScene();
  s.world.core.World.getNpcs = () => [fakeNpc('Chicken', 3330, 3298), fakeNpc('Chicken', 3130, 3298)];
  s.world.core.World.getNpcsNear = () => [];
  s.world.routes = { canReachSpot: (_player, cluster) => cluster.x < 3300 };
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.logs[0].site, `${3130 >> 5},${3298 >> 5},0`, 'the unreachable one is passed over');
  a.stop(s.ctx);
});

test('beginners train on any NPC in their combat-level band, not on named ones', () => {
  const s = trainingScene();
  const frog = fakeNpc('Frog', 3218, 3185);
  const bigFrog = fakeNpc('Big frog', 3219, 3185);
  const duck = fakeNpc('Duck', 3217, 3185);
  s.move(3218, 3190);
  s.world.core.World.getNpcs = () => [duck, bigFrog, frog];
  s.world.core.World.getNpcsNear = () => [duck, bigFrog, frog];
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.logs[0].site, `${3218 >> 5},${3185 >> 5},0`, 'the swamp frogs are found by level');
  assert.deepEqual(s.attacks, [frog], 'level 5 frog: in band; level 10 big frog: not yet; duck: excluded');
  a.stop(s.ctx);
});

test('a frozen movement request is dropped and the site rotates', () => {
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    const s = trainingScene();
    s.move(3170, 3240);
    s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Chicken', 3330, 3298)];
    s.world.core.World.getNpcsNear = () => []; // nothing in view: walk to the cluster
    const a = createTrainCombatAction(trainingSpec, s.world);
    a.update(s.ctx);
    const firstSite = s.logs[0].site;
    assert.equal(firstSite, `${3230 >> 5},${3298 >> 5},0`, 'the nearest chicken cluster');
    assert.ok(peekMovementRequest(s.player), 'walking to the cluster');
    freeze(s, a);
    const visits = s.logs.filter((entry) => entry.stage);
    assert.equal(visits.length, 2, 'site is re-selected after the frozen walk');
    assert.notEqual(visits.at(-1).site, firstSite);
    assert.ok(peekMovementRequest(s.player), 'movement is re-requested');
    a.stop(s.ctx);
  } finally {
    Math.random = realRandom;
  }
});

test('a slow-ticking far bot does not call its fresh walk frozen after one late tick', () => {
  const s = trainingScene();
  s.move(3170, 3240);
  s.world.core.World.getNpcsNear = () => [];
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  s.ctx.nowMs += 15000; // LOD + task budget: the next brain tick comes 15 s later
  a.update(s.ctx);
  assert.equal(s.logs.filter((entry) => entry.stage).length, 1, 'keeps its cluster');
  assert.ok(peekMovementRequest(s.player), 'still walking');
  a.stop(s.ctx);
});

test('a trainer at its cluster with nothing to fight waits there instead of blacklisting it', () => {
  const s = trainingScene();
  s.move(3229, 3297);
  s.world.core.World.getNpcsNear = () => []; // every chicken busy with someone else
  const a = createTrainCombatAction(trainingSpec, s.world);
  for (let i = 0; i < 6; i += 1) { a.update(s.ctx); s.ctx.nowMs += 3000; }
  assert.equal(peekMovementRequest(s.player), null, 'no walk onto the tile it already stands on');
  assert.equal(s.logs.filter((entry) => entry.stage).length, 1, 'stays on its cluster');
  a.stop(s.ctx);
});

test('a centre on water: a stalled walk within the cluster radius trains from where it stopped', () => {
  const s = trainingScene();
  s.move(3218, 3298); // 12 tiles from the centre, can get no closer
  s.world.core.World.getNpcsNear = () => [];
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  assert.ok(peekMovementRequest(s.player), 'walks toward the centre');
  freeze(s, a);
  assert.equal(s.logs.filter((entry) => entry.stage).length, 1, 'keeps its cluster');
  s.ctx.nowMs += 2000; a.update(s.ctx);
  assert.equal(peekMovementRequest(s.player), null, 'settled: no more centre walks');
  a.stop(s.ctx);
});

test('a walk frozen on the way to one fenced NPC skips that NPC, not the cluster', () => {
  const s = trainingScene();
  s.move(3230, 3290);
  s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Chicken', 3226, 3310)];
  s.world.core.RsmodRouteFinding = class {
    findRoute({ destX, destY, moveNear }) { return { success: moveNear === true, endX: destX, endY: destY - 1 }; }
  };
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  assert.ok(peekMovementRequest(s.player), 'walking at the fenced chicken');
  freeze(s, a);
  assert.equal(s.logs.filter((entry) => entry.stage).length, 1, 'and for this bot');
  a.stop(s.ctx);
});

test('maxFailedTargets targets in a row that never take damage fail the training site', () => {
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    const s = trainingScene();
    const second = { ...s.npc, getLocation: () => new Location(3232, 3298, 0) };
    const third = { ...s.npc, getLocation: () => new Location(3234, 3298, 0) };
    s.world.core.World.getNpcsNear = () => [s.npc, second, third];
    const a = createTrainCombatAction({ ...chickenSpec, maxFailedTargets: 3 }, s.world);
    a.update(s.ctx);
    assert.equal(s.attacks.length, 1);
    s.move(3231, 3298); s.ctx.nowMs = 47000;
    assert.equal(a.update(s.ctx), 'running');
    s.move(3232, 3298); s.ctx.nowMs = 93000;
    assert.equal(a.update(s.ctx), 'running');
    s.move(3233, 3298); s.ctx.nowMs = 139000;
    assert.equal(a.update(s.ctx), 'failed', 'the site is abandoned after three stalled targets');
    assert.equal(s.attacks.length, 3, 'every stalled target was replaced');
    a.stop(s.ctx);
  } finally {
    Math.random = realRandom;
  }
});

test('repeated frozen movement requests fail the site instead of hopping forever', () => {
  const s = trainingScene();
  s.move(3170, 3240);
  s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Chicken', 3330, 3298), fakeNpc('Chicken', 3400, 3298)];
  const a = createTrainCombatAction({ ...chickenSpec, maxFailedTargets: 3 }, s.world);
  a.update(s.ctx);
  for (let i = 0; i < 2; i += 1) assert.equal(freeze(s, a), 'running');
  assert.equal(freeze(s, a), 'failed', 'three stalls fail the activity');
  assert.ok(s.logs.some((entry) => entry.failures === 3), 'the stall is logged');
  a.stop(s.ctx);
});

test('a held fight that lands no hit walks the target so gates can open', () => {
  const s = trainingScene();
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.player.getCombat().getTarget(), s.npc);
  s.ctx.nowMs += 7000;
  a.update(s.ctx);
  const request = peekMovementRequest(s.player);
  assert.equal(request?.reason, 'brain_combat_training');
  assert.equal(request?.x, 3230);
  assert.equal(request?.y, 3298);
  a.stop(s.ctx);
});

test('a two-handed weapon clears the shield slot', () => {
  const s = trainingScene();
  s.ctx.state.combatStyle = 'ranged';
  s.items[Equipment.SHIELD_SLOT] = new s.TrainingItem(ItemIdentifiers.WOODEN_SHIELD, 1);
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.items[Equipment.SHIELD_SLOT].getId(), -1, 'shield removed for a two-handed bow');
  a.stop(s.ctx);
});

test('a long walk counts as progress for an action that reports none (a far bank)', () => {
  let x = 3200;
  const walking = { id: 'bank', update: () => 'running' };
  const player = { ...fakePlayer('walker'), getLocation: () => ({ getX: () => x, getY: () => 3200, getZ: () => 0 }) };
  const brain = new BotBrain({ player, state: {}, world: { log() {} }, registry: fakeRegistry(),
    activity: { id: 'walk_activity', actions: [walking], repeat: true } });
  for (let t = 1000; t <= 400000; t += 60000) { x += 10; brain.tick(t); }
  assert.equal(brain.frames.length, 1, 'still walking after more than three minutes');
});

test('pvp combat reports seeking progress so the wait is not a stall', () => {
  const { createPvpCombatAction } = require('../plugins/bots/brain/actions/PvpCombat.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  const controller = { tick() {}, seek() {}, wanderWhileSeeking() {}, ensureLoadout() {} };
  const a = createPvpCombatAction({ id: 'pvpCombat' }, controller);
  let x = 3200;
  const player = {
    ...fakePlayer('wildy'), getLocation: () => new Loc(x, 3500, 0),
    getCombat: () => ({ getTarget: () => null, getAttacker: () => null }),
  };
  const state = { pvp: { nextActionAt: Number.MAX_SAFE_INTEGER, targetUsername: null } };
  const ctx = { player, state, nowMs: 1000 };
  assert.equal(a.madeProgress(ctx), true, 'the first position counts as movement');
  assert.equal(a.madeProgress(ctx), false, 'standing still with no fight is not progress');
  x = 3201;
  assert.equal(a.madeProgress(ctx), true, 'seeking movement is progress without a target');
  const target = {};
  player.getCombat = () => ({ getTarget: () => target, getAttacker: () => null });
  a.madeProgress(ctx);
  assert.equal(a.madeProgress(ctx), true, 'a live fight is progress while standing still');
});

test('a frame with no progress for three minutes fails and logs a stall', () => {
  const logs = [];
  const stalled = { id: 'stalled', update: () => 'running' };
  const activity = { id: 'stall_activity', actions: [stalled], repeat: true };
  const brain = new BotBrain({
    player: fakePlayer(), state: {},
    world: { log: (message, details) => logs.push({ message, details }) },
    registry: fakeRegistry(), activity,
  });
  brain.tick(1000);
  brain.tick(181000);
  brain.tick(181001);
  assert.equal(brain.frames.length, 0, 'the stalled frame was dropped');
  assert.ok(logs.some((entry) => entry.message === 'bot_brain_frame_stalled'));
  assert.ok(brain.registry.blocked.includes('stall_activity'), 'the activity is cooled down');
});

test('a door is opened when it unblocks the current segment of a longer route', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening.PlayerBots');
  const gate = {
    getId: () => 7,
    getLocation: () => ({ getX: () => 104, getY: () => 102, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => ['Open'] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(104, 102, 0), [gate]);
  let open = false;
  const world = {
    core: {
      RegionManager: {
        getClipping: () => 0,
        removeObjectClipping: () => { open = true; },
        addObjectClipping: () => { open = false; },
      },
      RsmodRouteFinding: class {
        findRoute({ destX, destY, locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: open };
          if (destX === 200 && destY === 200) {
            return { success: false, endX: 100, endY: 100 };
          }
          return open
            ? { success: true, endX: 110, endY: 110 }
            : { success: true, endX: 100, endY: 100 };
        }
      },
      PathFinder: { calculateWalkRoute: () => 1 },
    },
    emitObjectInteraction: () => true,
  };
  const player = { ...fakePlayer('bot', 100, 100), getMovementQueue: () => ({ size: () => 0 }) };
  const request = { x: 200, y: 200, z: 0, lastSegmentX: 110, lastSegmentY: 110 };
  assert.equal(maybeOpenDoor({ player, state: {}, world, request, select: true }), true,
    'final target is unroutable, but the segment behind the gate is reachable');
  MapObjects.mapObjects.delete(MapObjects.getHash(104, 102, 0));
});

test('training stages pick opponents by overlapping NPC combat-level bands', () => {
  const stages = [...trainingSpec.stages].sort((a, b) => a.minLevel - b.minLevel);
  assert.equal(stages[0].minLevel, 1);
  for (const [index, stage] of stages.entries()) {
    assert.ok(stage.npcLevels.min >= 1 && stage.npcLevels.max >= stage.npcLevels.min, stage.id);
    const next = stages[index + 1];
    if (next) assert.ok(next.npcLevels.min <= stage.npcLevels.max, `${stage.id} -> ${next.id} leaves no gap`);
  }
  assert.ok(stages.every((stage) => !stage.names && !stage.sites), 'no hard-coded NPC names or areas');
});

test('the NPC cluster index never places a cluster in the Wilderness', () => {
  const { buildNpcClusters, nearestClusters } = require('../plugins/bots/brain/NpcClusterIndex.PlayerBots');
  const spawns = JSON.parse(fs.readFileSync('data/definitions/npc-spawns.json', 'utf8'));
  const index = buildNpcClusters(spawns.map((n) => ({ key: n.name, x: n.x, y: n.y, z: n.level })));
  assert.ok(nearestClusters(index, ['Goblin'], { x: 3222, y: 3218, z: 0 })[0].distance < 100);
  assert.equal(nearestClusters(index, ['Goblin'], { x: 3100, y: 3700, z: 0 })
    .some((cluster) => cluster.y >= 3520 && cluster.y <= 3967 && cluster.x >= 2944 && cluster.x <= 3392), false);
});

test('bots discover unvisited NPC spawns and count activated spawns only once', () => {
  const { npcClustersFor, nearestClusters } = require('../plugins/bots/brain/NpcClusterIndex.PlayerBots');
  const at = { getX: () => 3222, getY: () => 3218, getZ: () => 0 };
  const npc = (owner) => ({
    getSpawnPosition: () => at,
    getDefinition: () => ({ name: 'Chicken' }),
    getSpawnLineage: () => ({ owner }),
  });
  const world = { core: {
    NpcSpawnDefinition: { all: () => [{ getId: () => 1, getPosition: () => at }] },
    NpcDefinition: { forId: () => ({ name: 'Chicken' }) },
    World: { getNpcs: () => [npc('npc-spawns'), npc('a plugin')] },
  } };
  const index = npcClustersFor(world, 'name', (definition) => definition.name);
  const [cluster] = nearestClusters(index, ['Chicken'], { x: 3222, y: 3218, z: 0 });
  assert.equal(cluster.count, 2, 'one recorded spawn plus one plugin spawn');
  const unvisited = { core: { ...world.core, World: { getNpcs: () => [] } } };
  const [pending] = nearestClusters(npcClustersFor(unvisited, 'name', (definition) => definition.name), ['Chicken'], { x: 3000, y: 3000, z: 0 });
  assert.equal(pending.count, 1, 'a bot can choose a destination before its NPCs exist');
});

test('replacing a training brain stops its NPC fight and releases its claim', () => {
  const s = trainingScene();
  const a = createTrainCombatAction(chickenSpec, s.world);
  const activity = { id: 'train', actions: [a], repeat: true };
  const brain = new BotBrain({ player: s.player, state: s.ctx.state, world: s.world,
    registry: fakeRegistry(), activity });
  brain.tick(1000); brain.tick(1600);
  assert.equal(s.player.getCombat().getTarget(), s.npc);
  brain.reset();
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.equal(peekMovementRequest(s.player), null);
});

test('far bots visited round-robin under the task budget still think every stride', () => {
  const { BotBehaviorTask } = require('../plugins/bots/behaviours/task/BehaviorTask.PlayerBots');
  const task = { _cycleCounter: 0 };
  const state = {};
  const ran = [];
  // The budget lets the round-robin reach this bot only every 8th cycle; LOD stride 12.
  // `(cycle + shard) % 12 === 0` never holds on cycles 3, 11, 19, ... (shard 3): starved.
  for (let cycle = 3; cycle < 400; cycle += 8) {
    task._cycleCounter = cycle;
    if (BotBehaviorTask.prototype.isDue.call(task, state, 12, 3)) ran.push(cycle);
  }
  const gaps = ran.slice(1).map((cycle, index) => cycle - ran[index]);
  assert.ok(ran.length > 20, `ran ${ran.length} times`);
  assert.ok(Math.max(...gaps) <= 16, 'never more than one visit past its stride');
});

test('the long route planner finds detours past walls and through gates, and gives up on islands', () => {
  const { planRoute } = require('../plugins/bots/behaviours/navigation/LongRoutePlanner.PlayerBots');
  const WALL_EAST = 0x8, WALL_WEST = 0x80, BLOCK_WALK = 0x200000;
  // A north-south wall at x=100|101 from y=0..399; its only gap is 150 tiles north of the bot.
  const wall = (x, y) => (y < 400 && y !== 350 ? (x === 100 ? WALL_EAST : x === 101 ? WALL_WEST : 0) : 0);
  const detour = planRoute({ from: { x: 90, y: 200, z: 0 }, to: { x: 110, y: 200 }, getFlag: wall });
  assert.ok(detour, 'a way round exists');
  assert.ok(detour.waypoints.some((point) => point.y >= 340), 'the route goes up to the gap, past the 128-tile window');
  // The same wall with a gate at y=200: through the gate, the far side marked as a door.
  const gated = planRoute({ from: { x: 90, y: 200, z: 0 }, to: { x: 110, y: 200 }, getFlag: wall,
    isDoor: (x, y) => (x === 100 || x === 101) && y === 200 });
  assert.ok(gated.tiles < 40, 'straight through the gate');
  assert.deepEqual(gated.waypoints.find((point) => point.door), { x: 101, y: 200, z: 0, door: true });
  // An island ringed by water: no route.
  const island = (x, y) => (Math.max(Math.abs(x - 300), Math.abs(y - 300)) <= 3 ? 0 : Math.max(Math.abs(x - 300), Math.abs(y - 300)) <= 12 ? BLOCK_WALK : 0);
  assert.equal(planRoute({ from: { x: 250, y: 300, z: 0 }, to: { x: 300, y: 300 }, getFlag: island }), null);
});

test('a planned walk never skips the far side of a gate it has not crossed', () => {
  const { nextWaypoint } = require('../plugins/bots/behaviours/navigation/LongRoutes.PlayerBots');
  const { Location: Loc } = require('../dist/game/model/Location');
  let at = new Loc(3254, 3268, 0);
  const player = { getLocation: () => at, getPrivateArea: () => null };
  const request = {
    x: 3285, y: 3361, z: 0,
    route: { index: 0, waypoints: [
      { x: 3254, y: 3267, z: 0 }, { x: 3253, y: 3267, z: 0, door: true }, { x: 3247, y: 3274, z: 0 },
    ] },
  };
  assert.deepEqual(nextWaypoint(player, request), { x: 3253, y: 3267, z: 0, door: true },
    'a tile away but inside the fence: still walk (and open the gate) to the far side');
  at = new Loc(3253, 3267, 0);
  assert.deepEqual(nextWaypoint(player, request), { x: 3247, y: 3274, z: 0 }, 'crossed: on to the next');
});

test('bots are given tools, never resources: inputs come from gathering or the bank', () => {
  const raw = JSON.parse(fs.readFileSync('data/definitions/bot-activities.json', 'utf8'));
  const TOOLS = new Set(['tinderbox', 'small_fishing_net', 'fly_fishing_rod', 'lobster_pot', 'harpoon']);
  // A template's "$tool" is whatever each activity fills it with.
  for (const activity of raw.activities) {
    if (activity.fields?.tool !== undefined) {
      assert.ok(TOOLS.has(activity.fields.tool), `${activity.id}: ${activity.fields.tool} is a tool`);
    }
  }
  TOOLS.add('$tool');
  const conjured = [];
  const walk = (node, where) => {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, where));
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ensureItem') conjured.push(`${where}: ${node.item}`);
    for (const [key, child] of Object.entries(node)) walk(child, `${where}.${key}`);
  };
  walk(raw.templates, 'templates');
  walk(raw.activities, 'activities');
  assert.deepEqual(conjured.filter((entry) => !TOOLS.has(entry.split(': ')[1])), [], 'ensureItem only for tools');
  // Fresh bots have empty banks, so nothing withdraws inputs: smelting and burning only
  // follow on from mining and woodcutting, using what the bot just gathered.
  assert.ok(!JSON.stringify(raw).includes('"withdraw"'), 'no activity relies on a stocked bank');
  const followOns = (template) => template.actions.find((action) => action.type === 'choose').options
    .flatMap((option) => option.actions.map((action) => action.type));
  assert.ok(followOns(raw.templates.chop_trees).includes('lightFire'), 'woodcutters can burn their logs');
  assert.ok(followOns(raw.templates.mine_rocks).includes('smelt'), 'miners can smelt their ore');
});

test('combat-training activity compiles against the real plugin core API', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { createBotActivityRegistry } = require('../plugins/bots/brain/ActivityRegistry.PlayerBots');
  const registry = createBotActivityRegistry({ world: { core: PluginManager.getCoreApi() } });
  assert.equal(registry.byId.get('combat_training').actions[0].id, 'trainCombat');
});

test('a rotation switches activity after its time, never mid-fight or under an overlay', () => {
  const chop = { id: 'chop', repeat: true, actions: [action('c', [])] };
  const mine = { id: 'mine', repeat: true, actions: [action('m', [])] };
  const picks = [];
  const registry = {
    ...fakeRegistry(),
    pickActivity: (_, __, options) => { picks.push(options); return options.avoid === 'chop' ? mine : chop; },
  };
  let target = null;
  const player = { ...fakePlayer(), getCombat: () => ({ getTarget: () => target, getAttacker: () => null }) };
  const logs = [];
  const brain = new BotBrain({
    player, state: {}, registry, world: { log: (message) => logs.push(message) }, activity: chop, nowMs: 0,
    rotation: { activityIds: ['chop', 'mine'], weights: { chop: 2, mine: 1 }, switchAfterMs: { min: 1000, max: 1000 } },
  });
  brain.tick(500);
  assert.equal(brain.frames[0].behaviour.id, 'chop', 'not due yet');
  target = {};
  brain.tick(1500);
  assert.equal(brain.frames[0].behaviour.id, 'chop', 'waits for the fight to end');
  target = null;
  brain.pushActivity({ id: 'bank_trip', actions: [action('bank', ['success'])] }, 1500);
  brain.tick(1600);
  brain.tick(1650);
  assert.equal(brain.frames[0].behaviour.id, 'chop', 'waits for the overlay to finish');
  brain.tick(1700);
  assert.equal(brain.frames.length, 1);
  assert.equal(brain.frames[0].behaviour.id, 'mine');
  assert.deepEqual(picks.at(-1), { allowed: ['chop', 'mine'], weights: { chop: 2, mine: 1 }, avoid: 'chop' });
  assert.equal(registry.slots.get('chop'), 0, 'the old activity gave its slot back');
  assert.ok(logs.includes('bot_brain_activity_switch'));
});

test('sites split each mode\'s count over the tiers and the registry only assigns their activities', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { createBotActivityRegistry } = require('../plugins/bots/brain/ActivityRegistry.PlayerBots');
  const registry = createBotActivityRegistry({ world: { core: PluginManager.getCoreApi() } });
  const bySite = new Map(registry.sites.map((site) => [site.id, site]));
  const towns = ['lumbridge'];
  const configured = JSON.parse(fs.readFileSync('data/definitions/bot-sites.json', 'utf8')).sites;
  const total = (counts) => typeof counts === 'number' ? counts : Object.values(counts).reduce((sum, count) => sum + count, 0);
  for (const town of towns) {
    const bots = configured.find((site) => site.id === town).bots;
    assert.equal(registry.sites.filter((site) => site.id.startsWith(`${town}_`)).reduce((sum, site) => sum + site.count, 0),
      Object.values(bots).reduce((sum, counts) => sum + total(counts), 0), `${town} spawns exactly its configured bots`);
  }
  const raw = JSON.parse(fs.readFileSync('data/definitions/bot-activities.json', 'utf8'));
  for (const site of registry.sites) {
    assert.equal(site.activities.length, 1, site.id);
    const level = raw.activities.find((activity) => activity.id === site.activities[0].id)?.fields?.level ?? 1;
    assert.ok(level <= site.levels.all[0], `${site.id} can do ${site.activities[0].id} (needs ${level})`);
  }
  assert.deepEqual(bySite.get('lumbridge_woodcutting_experts').levels, { all: [60, 99], combat: [90, 126] });
  assert.equal(bySite.get('lumbridge_woodcutting_experts').activities[0].id, 'yew_trees', 'each tier takes the best activity it can do');
  assert.equal(bySite.get('lumbridge_woodcutting_novices').activities[0].id, 'normal_trees');
  assert.equal(bySite.get('lumbridge_mining_experts').activities[0].id, 'mithril_rocks');
  const expertsRotation = bySite.get('lumbridge_woodcutting_experts').rotation;
  assert.equal(bySite.get('lumbridge_mining_experts').rotation, expertsRotation, 'a site tier shares one rotation');
  assert.deepEqual(expertsRotation.switchAfterMs, { min: 15 * 60000, max: 25 * 60000 });
  assert.equal(expertsRotation.weights.yew_trees, bySite.get('lumbridge_woodcutting_experts').count, 'switches are weighted by the mode counts');
  const os = require('node:os');
  const path = require('node:path');
  const sitesPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-sites-')), 'bot-sites.json');
  fs.writeFileSync(sitesPath, JSON.stringify({ sites: [{ id: 'camp', x: 3222, y: 3218, bots: { woodcutting: 30, mining: { experts: 7 } } }] }));
  const split = new Map(createBotActivityRegistry({ world: { core: PluginManager.getCoreApi() }, sitesPath }).sites
    .map((site) => [site.id, site.count]));
  assert.deepEqual(['novices', 'intermediates', 'advanced', 'experts'].map((tier) => split.get(`camp_woodcutting_${tier}`)),
    [8, 8, 7, 7], '30 woodcutters split evenly, lowest tiers take the remainder');
  assert.deepEqual(['novices', 'intermediates', 'advanced', 'experts'].map((tier) => split.get(`camp_mining_${tier}`)),
    [undefined, undefined, undefined, 7], 'per-tier counts: only the listed tiers spawn');
  fs.writeFileSync(sitesPath, JSON.stringify({ sites: [{ id: 'camp', x: 3222, y: 3218, bots: { basket_weaving: 4 } }] }));
  assert.throws(() => createBotActivityRegistry({ world: { core: PluginManager.getCoreApi() }, sitesPath }), /unknown mode 'basket_weaving'/);
  fs.writeFileSync(sitesPath, JSON.stringify({ sites: [{ id: 'camp', x: 3222, y: 3218, bots: { woodcutting: { gods: 4 } } }] }));
  assert.throws(() => createBotActivityRegistry({ world: { core: PluginManager.getCoreApi() }, sitesPath }), /unknown tier 'gods'/);
  fs.writeFileSync(sitesPath, JSON.stringify({ sites: [{ id: 'camp', x: 3222, y: 3218, bots: { woodcutting: 4, mining: 4 } }] }));
  const fixed = createBotActivityRegistry({ world: { core: PluginManager.getCoreApi() }, sitesPath });
  assert.ok(fixed.sites.every((site) => site.rotation === null), 'no switchMinutes, no switching');
  const weighted = new Map();
  for (let i = 0; i < 2000; i++) {
    const skilled = { ...fakePlayer(), getSkillManager: () => ({ getCurrentLevel: () => 99 }) };
    const id = registry.pickActivity(skilled, 0, { allowed: ['yew_trees', 'mithril_rocks'], weights: { yew_trees: 3, mithril_rocks: 1 } })?.id;
    weighted.set(id, (weighted.get(id) ?? 0) + 1);
  }
  const yewShare = weighted.get('yew_trees') / 2000;
  assert.ok(yewShare > 0.68 && yewShare < 0.82, `weights bias the pick (yews ${yewShare})`);
  const sitesFile = JSON.parse(fs.readFileSync('data/definitions/bot-sites.json', 'utf8'));
  const loadouts = JSON.parse(fs.readFileSync('data/definitions/pvp-bot-loadouts.json', 'utf8')).loadouts;
  for (const site of sitesFile.sites.filter((entry) => entry.pvp)) {
    const tagged = loadouts.filter((loadout) => loadout.tags.includes(site.pvp.style) &&
      (site.pvp.style === 'f2p' || !loadout.tags.includes('f2p'))).map((loadout) => loadout.id);
    assert.deepEqual([...getWildernessHotspot(site.id).allowedLoadouts], tagged, `${site.id} gears from its '${site.pvp.style}' loadouts`);
    assert.equal(getWildernessHotspot(site.id).targetBots, site.bots, site.id);
  }
  const player = fakePlayer();
  assert.equal(registry.pickActivity(player, 0, { allowed: ['combat_training'] })?.id, 'combat_training');
  assert.equal(registry.pickActivity(player, 0, { allowed: ['combat_training'], avoid: 'combat_training' }), null);
});

test('a site\'s levels are applied to every skill of a spawned bot (hitpoints at least 10)', () => {
  const { applyLevels } = require('../plugins/bots/brain/SiteSpawner.PlayerBots');
  const set = new Map();
  const manager = {
    setCurrentLevel(skill, level) { set.set(skill.getName(), level); return this; },
    setMaxLevels() { return this; },
    setExperience() { return this; },
  };
  const bot = { getSkillManager: () => manager, getUpdateFlag: () => ({ flag() {} }) };
  applyLevels(bot, 1);
  assert.equal(set.get(Skill.ATTACK.getName()), 1);
  assert.equal(set.get(Skill.HITPOINTS.getName()), 10, 'hitpoints never below 10');
  assert.equal(set.get(Skill.AGILITY.getName()), 99, 'agility is always 99 so shortcuts are usable');
  applyLevels(bot, { all: 40, mining: 60 });
  assert.equal(set.get(Skill.ATTACK.getName()), 40);
  assert.equal(set.get(Skill.MINING.getName()), 60, 'per-skill override');
  applyLevels(bot, { all: [30, 35] });
  const rolled = set.get(Skill.ATTACK.getName());
  assert.ok(rolled >= 30 && rolled <= 35, `a band rolls inside it (got ${rolled})`);
  const { combatLevelOf } = require('../plugins/bots/brain/SiteSpawner.PlayerBots');
  assert.equal(combatLevelOf([1, 1, 1, 10, 1, 1, 1]), 3);
  assert.equal(combatLevelOf([99, 99, 99, 99, 99, 99, 99]), 126);
  const combatSkills = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.HITPOINTS, Skill.RANGED, Skill.MAGIC, Skill.PRAYER];
  for (const band of [[3, 30], [30, 60], [60, 90], [90, 126]]) {
    for (let i = 0; i < 50; i++) {
      applyLevels(bot, { all: [1, 19], combat: band });
      const combat = combatLevelOf(combatSkills.map((skill) => set.get(skill.getName())));
      assert.ok(combat >= band[0] && combat <= band[1], `combat ${combat} inside ${band}`);
      assert.ok(set.get(Skill.MINING.getName()) <= 19, 'non-combat skills keep the skill band');
    }
  }
});

test('a spawned bot is dressed for its tier with real items and keeps the weapon slot free', () => {
  const { applyOutfit, outfitTier } = require('../plugins/bots/brain/SiteSpawner.PlayerBots');
  const { Equipment } = require('../src/main/typescript/elvarg/game/model/container/impl/Equipment');
  assert.equal(outfitTier(1), 'novice');
  assert.equal(outfitTier({ all: [1, 19] }), 'novice');
  assert.equal(outfitTier({ all: [20, 39] }), 'mid');
  assert.equal(outfitTier({ all: [40, 59] }), 'advanced');
  assert.equal(outfitTier({ all: [60, 99] }), 'elite');
  const slots = [Equipment.HEAD_SLOT, Equipment.CAPE_SLOT, Equipment.AMULET_SLOT, Equipment.BODY_SLOT,
    Equipment.LEG_SLOT, Equipment.HANDS_SLOT, Equipment.FEET_SLOT];
  const worn = new Map();
  const bot = {
    getEquipment: () => ({ set: (slot, item) => worn.set(slot, item.getId()), refreshItems() {} }),
    getUpdateFlag: () => ({ flag() {} }),
  };
  applyOutfit(bot, 'elite');
  for (const slot of slots) {
    assert.ok(worn.get(slot) > 0, `slot ${slot} has a real item`);
  }
  assert.equal(worn.has(Equipment.WEAPON_SLOT), false, 'the skill tool owns the weapon slot');
});

test('timed visits rotate between sites without requiring a level-up', () => {
  const s = trainingScene(10);
  s.world.core.World.getNpcs = () => [fakeNpc('Cow', 3253, 3284), fakeNpc('Goblin', 3250, 3246)];
  const a = createTrainCombatAction({ ...trainingSpec, durationSeconds: { min: 1, max: 1 } }, s.world);
  a.update(s.ctx);
  const firstSite = s.logs[0].site;
  s.ctx.nowMs += 1500;
  assert.equal(a.update(s.ctx), 'success');
  a.stop(s.ctx); a.update(s.ctx);
  assert.notEqual(s.logs.at(-1).site, firstSite);
  a.stop(s.ctx);
});

test('trainers spread over NPC clusters by size and distance', () => {
  // Bots stand at 3230,3298. West and east clusters are equally far; the big near one is closest.
  const npcs = [
    fakeNpc('Chicken', 3130, 3298), fakeNpc('Chicken', 3130, 3299),
    fakeNpc('Chicken', 3330, 3298), fakeNpc('Chicken', 3330, 3299),
    ...Array.from({ length: 4 }, (_, i) => fakeNpc('Chicken', 3232 + i, 3298)),
  ];
  const trainers = Array.from({ length: 16 }, () => {
    const s = trainingScene();
    s.world.core.World.getNpcs = () => npcs;
    const a = createTrainCombatAction(chickenSpec, s.world);
    a.update(s.ctx);
    return { s, a };
  });
  const counts = new Map();
  for (const { s } of trainers) counts.set(s.logs[0].site, (counts.get(s.logs[0].site) ?? 0) + 1);
  const at = (x, y) => counts.get(`${x >> 5},${y >> 5},0`) ?? 0;
  assert.equal(counts.size, 3, `every cluster is used: ${JSON.stringify([...counts])}`);
  assert.ok(Math.abs(at(3130, 3298) - at(3330, 3298)) <= 1, 'equal clusters share equally');
  assert.ok(at(3232, 3298) > at(3130, 3298) * 2, 'the bigger, nearer cluster takes the most');
  for (const { s, a } of trainers) a.stop(s.ctx);
});

test('NPC trainers do not cross private areas or attack a non-attackable NPC', () => {
  for (const kind of ['instance', 'noncombat']) {
    const s = trainingScene();
    if (kind === 'instance') s.npc.getPrivateArea = () => ({});
    else s.npc.getCurrentDefinition = () => ({ isAttackable: () => false, getName: () => 'Chicken' });
    const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
    assert.equal(s.attacks.length, 0);
    a.stop(s.ctx);
  }
});

test('a path-blocked movement request walks to and opens the door that unblocks the route', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening.PlayerBots');
  const gate = (id, x, y, action = 'Open') => ({
    getId: () => id,
    getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => [action] }),
  });
  const wrongDoor = gate(1, 104, 102);
  const rightDoor = gate(2, 109, 108);
  const behind = gate(3, 95, 95);
  const openGate = gate(4, 106, 104, 'Close');
  const objects = [wrongDoor, rightDoor, behind, openGate];
  for (const object of objects) {
    const loc = object.getLocation();
    MapObjects.mapObjects.set(MapObjects.getHash(loc.getX(), loc.getY(), 0), [object]);
  }
  const openClips = new Set();
  let routeImproves = false;
  const world = {
    core: {
      RegionManager: {
        getClipping: () => 0,
        removeObjectClipping: (object) => { openClips.add(object.getId()); routeImproves = openClips.has(2); },
        addObjectClipping: (object) => { openClips.delete(object.getId()); routeImproves = openClips.has(2); },
      },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: routeImproves };
          if (!moveNear) return { success: true, endX: 0, endY: 0 };
          return routeImproves
            ? { success: true, endX: 110, endY: 110 }
            : { success: true, endX: 100, endY: 100 };
        }
      },
      PathFinder: { calculateWalkRoute: (_player, x, y) => { world.walked.push(`${x},${y}`); return 1; } },
    },
    emitObjectInteraction: (payload) => { world.emitted.push(payload); return true; },
    emitted: [],
    walked: [],
  };
  let location = { getX: () => 100, getY: () => 100, getZ: () => 0 };
  const player = {
    ...fakePlayer('bot', 100, 100),
    getLocation: () => location,
    getMovementQueue: () => ({ size: () => 0 }),
  };
  const state = {};
  assert.equal(maybeOpenDoor({ player, state, world, request: { x: 110, y: 110, z: 0 }, select: true }), true);
  assert.equal(world.walked[0], '108,107', 'routes to the nearest stand tile of the door that helps');
  assert.equal(world.emitted.length, 0, 'does not click before arriving');
  assert.equal(openClips.size, 0, 'simulated clipping is restored');
  location = { getX: () => 108, getY: () => 107, getZ: () => 0 };
  assert.equal(maybeOpenDoor({ player, state, world, request: { x: 110, y: 110, z: 0 } }), true);
  assert.equal(world.emitted[0].objectId, 2, 'clicks Open through the normal interaction hook');
  assert.equal(state.doorAttempt, null);
  for (const object of objects) {
    const loc = object.getLocation();
    MapObjects.mapObjects.delete(MapObjects.getHash(loc.getX(), loc.getY(), 0));
  }
});

test('a degenerate segment on the bot does not hide the gate that traps it', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening.PlayerBots');
  const gate = {
    getId: () => 2,
    getLocation: () => ({ getX: () => 109, getY: () => 108, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => ['Open'] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(109, 108, 0), [gate]);
  const openClips = new Set();
  const walked = [];
  const world = {
    core: {
      RegionManager: {
        getClipping: () => 0,
        removeObjectClipping: (object) => { openClips.add(object.getId()); },
        addObjectClipping: (object) => { openClips.delete(object.getId()); },
      },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear, destX, destY, srcX, srcY }) {
          if (locShape === -2 && !moveNear) {
            // Exact route: to the bot's own tile, or through the opened gate.
            if (destX === srcX && destY === srcY) return { success: true };
            return { success: openClips.has(2) };
          }
          if (!moveNear) return { success: true, endX: 0, endY: 0, waypoints: [] };
          return { success: true, endX: 100, endY: 100 };
        }
      },
      PathFinder: { calculateWalkRoute: (_player, x, y) => { walked.push(`${x},${y}`); return 1; } },
    },
    emitObjectInteraction: () => true,
  };
  const player = { ...fakePlayer('bot', 100, 100), getMovementQueue: () => ({ size: () => 0 }) };
  const state = {};
  // The failed dispatch left the segment on the bot's own tile (plan exhausted in
  // the pen): without falling back to the real goal the gate is never tested.
  assert.equal(
    maybeOpenDoor({
      player, state, world, select: true,
      request: { x: 110, y: 110, z: 0, lastSegmentX: 100, lastSegmentY: 100 },
    }),
    true
  );
  assert.equal(state.doorAttempt?.object, gate, 'the trapping gate is found and approached');
  assert.ok(walked.length > 0, 'walks to the gate stand tile');
  MapObjects.mapObjects.delete(MapObjects.getHash(109, 108, 0));
});

test('a gate behind the bot is opened when it unblocks the route', () => {
  // A moveNear walk parks the bot on the fence tile nearest the target, past the
  // pen's gate (Lumbridge cow fields); a "toward the target" filter hid that gate.
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening.PlayerBots');
  const gate = {
    getId: () => 6,
    getLocation: () => ({ getX: () => 96, getY: () => 97, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => ['Open'] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(96, 97, 0), [gate]);
  let open = false;
  const walked = [];
  const world = {
    core: {
      RegionManager: {
        getClipping: () => 0,
        removeObjectClipping: () => { open = true; },
        addObjectClipping: () => { open = false; },
      },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: open };
          if (!moveNear) return { success: true, endX: 0, endY: 0, waypoints: [] };
          return open ? { success: true, endX: 110, endY: 110 } : { success: true, endX: 100, endY: 100 };
        }
      },
      PathFinder: { calculateWalkRoute: (_player, x, y) => { walked.push(`${x},${y}`); return 1; } },
    },
    emitObjectInteraction: () => true,
  };
  const player = { ...fakePlayer('bot', 100, 100), getMovementQueue: () => ({ size: () => 0 }) };
  const state = {};
  assert.equal(maybeOpenDoor({ player, state, world, request: { x: 110, y: 110, z: 0 }, select: true }), true);
  assert.equal(state.doorAttempt?.object, gate);
  assert.equal(walked.length, 1, 'walks back to the gate');
  MapObjects.mapObjects.delete(MapObjects.getHash(96, 97, 0));
});

test('a gate is opened even when the walk already ends touching the target across the fence', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening.PlayerBots');
  const gate = {
    getId: () => 7,
    getLocation: () => ({ getX: () => 103, getY: () => 101, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => ['Open'] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(103, 101, 0), [gate]);
  let open = false;
  const world = {
    core: {
      RegionManager: { getClipping: () => 0, removeObjectClipping: () => { open = true; }, addObjectClipping: () => { open = false; } },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: open };
          // moveNear parks the bot on the tile touching the cow: 1 tile, wrong side.
          return moveNear ? { success: true, endX: 100, endY: 101 } : { success: true, endX: 0, endY: 0, waypoints: [] };
        }
      },
      PathFinder: { calculateWalkRoute: () => 1 },
    },
    emitObjectInteraction: () => true,
  };
  const player = { ...fakePlayer('bot', 100, 101), getMovementQueue: () => ({ size: () => 0 }) };
  const state = {};
  assert.equal(maybeOpenDoor({ player, state, world, request: { x: 100, y: 102, z: 0 }, select: true }), true);
  assert.equal(state.doorAttempt?.object, gate, 'the fence gate is opened, not treated as already reached');
  MapObjects.mapObjects.delete(MapObjects.getHash(103, 101, 0));
});

test('a toll gate is passed with its Pay-toll option, the toll provisioned so bots need no money', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening.PlayerBots');
  const tollGate = {
    getId: () => 44598,
    getLocation: () => ({ getX: () => 101, getY: () => 100, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getName: () => 'Gate', getInteractions: () => ['Open', null, null, 'Pay-toll(10gp)', null] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(101, 100, 0), [tollGate]);
  let open = false;
  const clicks = [];
  const world = {
    core: {
      RegionManager: { getClipping: () => 0, removeObjectClipping: () => { open = true; }, addObjectClipping: () => { open = false; } },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: open };
          return moveNear ? { success: true, endX: 100, endY: 100 } : { success: true, endX: 0, endY: 0, waypoints: [] };
        }
      },
      PathFinder: { calculateWalkRoute: () => 1 },
    },
    emitObjectInteraction: (event) => { clicks.push(event.clickType); return true; },
  };
  let coins = 0;
  const player = {
    ...fakePlayer('bot', 100, 100), getMovementQueue: () => ({ size: () => 0 }),
    getInventory: () => ({ getAmount: (id) => (id === 995 ? coins : 0), adds: (id, n) => { if (id === 995) coins += n; } }),
  };
  assert.equal(maybeOpenDoor({ player, state: {}, world, request: { x: 110, y: 100, z: 0 }, select: true }), true,
    'a broke bot still treats the toll gate as a way through');
  assert.deepEqual(clicks, [4], 'adjacent: clicks Pay-toll(10gp), not Open (the guard dialogue)');
  assert.equal(coins, 10, 'the toll is provisioned just before paying');
  MapObjects.mapObjects.delete(MapObjects.getHash(101, 100, 0));
});

test('a door that does not improve the route is left closed', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening.PlayerBots');
  const useless = {
    getId: () => 5,
    getLocation: () => ({ getX: () => 104, getY: () => 102, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => ['Open'] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(104, 102, 0), [useless]);
  const walked = [];
  const world = {
    core: {
      RegionManager: { getClipping: () => 0, removeObjectClipping() {}, addObjectClipping() {} },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          return locShape === -2 && !moveNear ? { success: false } : { success: true, endX: 100, endY: 100 };
        }
      },
      PathFinder: { calculateWalkRoute: () => { walked.push(1); return 1; } },
    },
    emitObjectInteraction: () => true,
  };
  const player = { ...fakePlayer('bot', 100, 100), getMovementQueue: () => ({ size: () => 0 }) };
  assert.equal(maybeOpenDoor({ player, state: {}, world, request: { x: 110, y: 110, z: 0 }, select: true }), false);
  assert.equal(walked.length, 0);
  MapObjects.mapObjects.delete(MapObjects.getHash(104, 102, 0));
});

test('a path-blocked movement request climbs the wall that unblocks the route', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeUseShortcut } = require('../plugins/bots/brain/ShortcutCrossing.PlayerBots');
  const CRUMBLING_WALL_3 = 24222;
  const wall = {
    getId: () => CRUMBLING_WALL_3,
    getLocation: () => ({ getX: () => 2935, getY: () => 3355, getZ: () => 0 }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(2935, 3355, 0), [wall]);
  let passable = false;
  const world = {
    core: {
      RegionManager: {
        removeObjectClipping: () => { passable = true; },
        addObjectClipping: () => { passable = false; },
      },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: passable };
          if (!moveNear) return { success: true, endX: 0, endY: 0, waypoints: [] };
          return passable
            ? { success: true, endX: 2920, endY: 3355 }
            : { success: true, endX: 2936, endY: 3355 };
        }
      },
      PathFinder: { calculateWalkRoute: () => 1 },
    },
    emitObjectInteraction: (event) => { world.emitted.push(event); return true; },
    emitted: [],
  };
  const player = { ...fakePlayer('bot', 2936, 3355), getMovementQueue: () => ({ size: () => 0 }) };
  const state = {};
  assert.equal(maybeUseShortcut({ player, state, world, request: { x: 2920, y: 3355, z: 0 }, select: true }), true);
  assert.equal(world.emitted[0]?.objectId, CRUMBLING_WALL_3, 'clicks the wall once at its near end');
  assert.equal(world.emitted[0]?.clickType, 1, 'first click (Climb-over)');
  assert.equal(state.shortcutAttempt, null);
  assert.equal(passable, false, 'simulated clipping is restored');
  assert.equal(
    maybeUseShortcut({ player, state, world, request: { x: 2920, y: 3355, z: 0 }, select: true }),
    false,
    'not retried while the attempt cooldown runs'
  );
  MapObjects.mapObjects.delete(MapObjects.getHash(2935, 3355, 0));
});

test('trainers do not attack a target their combat route cannot reach', () => {
  const s = trainingScene();
  s.move(3230, 3290);
  // A second chicken moves the cluster centre off the fenced one's tile.
  s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Chicken', 3226, 3310)];
  // Fenced off: the route ends on a tile touching the chicken, but strict reach fails.
  s.world.core.RsmodRouteFinding = class {
    findRoute({ destX, destY, moveNear }) { return { success: moveNear === true, endX: destX, endY: destY - 1 }; }
  };
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.attacks.length, 0, 'blocked target is not pursued');
  const request = peekMovementRequest(s.player);
  assert.equal(request.reason, 'brain_combat_training');
  assert.deepEqual([request.x, request.y], [3230, 3298], 'walks at the fenced NPC so the gate gets opened');
  a.stop(s.ctx);
});

test('stopping training (switching to skilling) takes back the food and runes it provisioned', () => {
  const s = trainingScene();
  s.ctx.state.combatStyle = 'magic';
  s.inventory.set(ItemIdentifiers.COPPER_ORE, 4); // the bot's own items stay
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.inventory.get(ItemIdentifiers.TROUT), 16, 'provisioned for the fight');
  a.stop(s.ctx);
  assert.equal(s.inventory.get(ItemIdentifiers.TROUT), 0, 'food taken back');
  assert.equal(s.inventory.get(ItemIdentifiers.COPPER_ORE), 4, 'its own items are kept');
});

test('ranged trainers equip a tier bow and a stack of arrows', () => {
  const s = trainingScene();
  s.ctx.state.combatStyle = 'ranged';
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  const tier = trainingSpec.rangedTiers.find((entry) => entry.minLevel === 1);
  assert.ok(tier.weapons.map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.WEAPON_SLOT].getId()), 'bow comes from the ranged tier');
  const ammo = s.items[Equipment.AMMUNITION_SLOT];
  assert.ok(ammo && tier.ammo.map((key) => ItemIdentifiers[key]).includes(ammo.getId()), 'arrows from the tier pool');
  assert.ok(ammo.getAmount() >= 1000, 'arrows are stocked');
  assert.deepEqual(s.attacks, [s.npc], 'ranged bots use the normal attack handoff');
  a.stop(s.ctx);
});

test('magic trainers equip a staff, set autocast and carry runes', () => {
  const s = trainingScene();
  const cast = [];
  s.world.core.Autocasting = { setAutocast: (_player, spell) => cast.push(spell) };
  s.world.core.CombatSpells = new Proxy({}, {
    get: () => ({
      levelRequired: () => 1,
      itemsRequired: () => [{ getId: () => ItemIdentifiers.AIR_RUNE }],
    }),
  });
  s.ctx.state.combatStyle = 'magic';
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  const tier = trainingSpec.magicTiers.find((entry) => entry.minLevel === 1);
  assert.ok(tier.weapons.map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.WEAPON_SLOT].getId()), 'staff comes from the magic tier');
  assert.equal(cast.length, 1, 'autocast set for the picked spell');
  assert.ok(s.inventory.get(ItemIdentifiers.AIR_RUNE) >= 3000, 'runes stocked for the spell');
  assert.deepEqual(s.attacks, [s.npc], 'magic bots attack through the normal engine');
  a.stop(s.ctx);
});

test('bot spawns are paced a few per game tick', (t) => {
  const { runPaced, SPAWNS_PER_BATCH, SPAWN_BATCH_DELAY_MS } = require('../plugins/bots/runtime/SpawnPacing.PlayerBots');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ran = 0;
  let done = false;
  runPaced(Array.from({ length: SPAWNS_PER_BATCH * 2 + 3 }, () => () => ran++), () => { done = true; });
  assert.equal(ran, SPAWNS_PER_BATCH, 'first batch runs at once');
  t.mock.timers.tick(SPAWN_BATCH_DELAY_MS);
  assert.equal(ran, SPAWNS_PER_BATCH * 2);
  assert.equal(done, false);
  t.mock.timers.tick(SPAWN_BATCH_DELAY_MS);
  assert.equal(ran, SPAWNS_PER_BATCH * 2 + 3);
  assert.equal(done, true);
});

test('a failed step falls back down its orElse chain: bank, else sell, else drop', () => {
  const { createOrElseAction } = require('../plugins/bots/brain/actions/OrElse.PlayerBots');
  const ran = [];
  const step = (id, result) => ({ id, update: () => { ran.push(id); return result; }, stop() {} });
  const player = fakePlayer();
  const ctx = { player };
  const chain = createOrElseAction(step('bank', 'failed'), createOrElseAction(step('sell', 'failed'), step('drop', 'success')));
  assert.equal(chain.update(ctx), 'success');
  assert.deepEqual(ran, ['bank', 'sell', 'drop']);
  ran.length = 0;
  assert.equal(createOrElseAction(step('bank', 'success'), step('sell', 'success')).update(ctx), 'success');
  assert.deepEqual(ran, ['bank'], 'a working bank never sells');

  const raw = JSON.parse(fs.readFileSync('data/definitions/bot-activities.json', 'utf8'));
  for (const name of ['chop_trees', 'mine_rocks', 'catch_fish']) {
    const options = raw.templates[name].actions.find((action) => action.type === 'choose').options;
    for (const option of options) {
      assert.notEqual(option.actions[0].type, 'bank', `${name}: raw resources are never banked`);
      for (const action of option.actions.filter((entry) => entry.type === 'bank' || entry.type === 'sellItems')) {
        assert.ok(action.orElse, `${name}: ${action.type} has a fallback`);
      }
    }
  }
});

test('a bot stows a KO weapon it has held for 15-20s without finishing the fight', () => {
  const { trackSpecWeaponHold } = require('../plugins/bots/behaviours/policies/PvpSpecialAttackPolicy.PlayerBots');
  const { SUPPORTED_SPEC_WEAPONS } = require('../plugins/bots/behaviours/policies/PvpCombatRuntimeCache.PlayerBots');
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');

  const specWeaponId = SUPPORTED_SPEC_WEAPONS[0];
  const primaryWeaponId = SUPPORTED_SPEC_WEAPONS[SUPPORTED_SPEC_WEAPONS.length - 1];
  assert.notEqual(specWeaponId, primaryWeaponId, 'need distinct spec and primary weapons');
  const player = {
    getEquipment: () => ({
      get: (slot) => (slot === Equipment.WEAPON_SLOT ? { getId: () => specWeaponId } : null),
    }),
  };
  const pvp = { generatedPrimaryWeaponId: primaryWeaponId };

  assert.equal(trackSpecWeaponHold(pvp, player, 1000), false, 'hold starts');
  assert.ok(pvp.specWeaponStowAt >= 16000 && pvp.specWeaponStowAt <= 21000, 'stow deadline is 15-20s out');
  assert.equal(trackSpecWeaponHold(pvp, player, pvp.specWeaponStowAt - 1), false, 'still holding before the deadline');
  assert.equal(trackSpecWeaponHold(pvp, player, pvp.specWeaponStowAt), true, 'stows once the hold expires');

  player.getEquipment = () => ({
    get: (slot) => (slot === Equipment.WEAPON_SLOT ? { getId: () => primaryWeaponId } : null),
  });
  assert.equal(trackSpecWeaponHold(pvp, player, pvp.specWeaponStowAt + 1), false, 'back on primary');
  assert.equal(pvp.heldSpecWeaponId, 0, 'hold state cleared');
});

test('a bot only tells the opponent to stop praying while they have an overhead up', () => {
  const { selectChatterLine } = require('../plugins/bots/behaviours/pvp/PvpChatter.PlayerBots');
  const { PrayerHandler } = require('../dist/game/content/PrayerHandler');

  const noPrayer = { getPrayerActive: () => ({}) };
  for (let i = 0; i < 400; i++) {
    assert.notEqual(selectChatterLine(noPrayer), 'stop praying');
  }

  const praying = { getPrayerActive: () => ({ [PrayerHandler.PROTECT_FROM_MELEE]: true }) };
  let seen = false;
  for (let i = 0; i < 400 && !seen; i++) seen = selectChatterLine(praying) === 'stop praying';
  assert.ok(seen, 'the prayer taunt is in the pool when the opponent prays');
});

test('a stale bot index rebuilds without loading live maps and preserves bridge planes', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createTraversalAssist } = require('../plugins/bots/lib/TraversalAssist.PlayerBots');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-index-test-'));
  const cachePath = path.join(directory, 'object-index.json');
  const settings = new Uint8Array(4 * 64 * 64);
  settings[(1 << 12) | (10 << 6) | 11] = 2;
  const chunks = [[
    { id: 2, localX: 3, localY: 4, plane: 0 },
    { id: 2, localX: 10, localY: 11, plane: 1 },
    { id: 2, localX: 10, localY: 11, plane: 0 }, // Ground beneath a bridge is not spawned.
    { id: 2, localX: 10, localY: 11, plane: 2 },
    { id: 99, localX: 1, localY: 1, plane: 0 },
  ]];
  let reads = 0;
  const region = { isLoaded: () => false };
  const regions = new Map([[0, region], [1, region]]);
  const manager = {
    regions, getRegionid: id => regions.get(id), regionIdForTile: (x, y) => ((x >> 6) << 8) | (y >> 6),
    loadMapFiles: () => assert.fail('indexing must not load live objects or collision'),
  };
  const api = {
    getRegionManager: () => manager,
    core: { readTemplateRegion: id => { reads++; return id === 0 ? { settings, chunks } : null; } },
  };
  try {
    fs.writeFileSync(cachePath, JSON.stringify({ v: 2, cache: fs.readFileSync('target.txt', 'utf8').trim(), ids: '1', r: {} }));
    const index = createTraversalAssist(api, { objectIds: [2], cachePath });
    assert.equal(index.initializePersistentIndex(), true);
    assert.equal(reads, 2);
    const saved = JSON.parse(fs.readFileSync(cachePath));
    assert.deepEqual(saved.r, { 0: { 2: [[3, 4, 0], [10, 11, 0], [10, 11, 1]] } });
    assert.deepEqual(index.findNearestIndexedLocation(fakePlayer('bot', 10, 10), [2]), { x: 10, y: 11, z: 0 });
    const cached = createTraversalAssist(api, { objectIds: [2], cachePath });
    assert.equal(cached.initializePersistentIndex(), true);
    assert.equal(reads, 2, 'a valid index needs no rescan');
    assert.ok([...regions.values()].every(region => !region.isLoaded()));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('the packaged bot object index matches the current cache and tracked resource IDs', () => {
  // Earlier brain tests resolve catalogs without a cache; use a fresh process for the real cache.
  require('node:child_process').execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    require('./dist/Server').Server.installProductionPathResolver();
    (async () => {
      await require('./dist/game/cache/CachePipeline').CachePipeline.initialize();
      const { ObjectIds } = require('./dist/util/IdEnums');
      const { listCatalogObjectIds } = require('./plugins/bots/brain/ObjectCatalog.PlayerBots');
      const { BANK_BOOTH_IDS } = require('./plugins/bots/lib/BankBooths.PlayerBots');
      const ids = [...new Set([ObjectIds.WILDERNESS_DITCH, ...listCatalogObjectIds(), ...BANK_BOOTH_IDS])].sort((a, b) => a - b).join(',');
      const index = require('./plugins/bots/data/object-index.json');
      assert.equal(index.cache, fs.readFileSync('target.txt', 'utf8').trim());
      assert.equal(index.ids, ids, 'regenerate the bot object index when resource IDs change');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: require('node:path').resolve(__dirname, '..'), stdio: 'pipe' });
});


test('the shared PvP world population has more one-defence pures without protection prayers', t => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const path = require('node:path');
  const filename = path.resolve(__dirname, '../plugins/bots/PlayerBots.plugin.js');
  const context = { require: createRequire(filename), module: { exports: {} }, process, console,
    __dirname: path.dirname(filename) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.config = BOT_CONFIG;', context, { filename });
  const { buildRoamingPvpMetadata } = require('../plugins/bots/behaviours/pvp/PvpAssignment.PlayerBots');
  let seed = 1385;
  t.mock.method(Math, 'random', () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32));
  let noProtectionPures = 0;
  const types = new Set();
  for (let index = 0; index < 1000; index++) {
    const metadata = buildRoamingPvpMetadata({ config: context.module.exports.config });
    const generated = loadoutTesting.buildGeneratedPreset(null, { pvp: metadata });
    assert.ok(generated);
    const stats = generated.preset.getStats();
    if (stats[1] === 1 && stats[5] < 37) noProtectionPures++;
    types.add(generated.archetypeId);
  }
  t.diagnostic(`${noProtectionPures}/1000 one-defence pures without protection prayers`);
  assert.ok(noProtectionPures >= 250 && noProtectionPures <= 400, `${noProtectionPures}/1000 no-protection pures`);
  assert.ok(types.size > 25, 'the rest of the catalogue remains represented');
});
