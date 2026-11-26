const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
const { World } = require('../dist/game/World');

const core = PluginManager.getCoreApi();
/** Enough plugin API for the units to attach without a running world. */
const api = new Proxy({ core, emitCustomEvent: () => {}, getPrayerHandler: () => ({}), getPluginConfig: (key, fallback) => fallback }, {
  get: (target, name) => (name in target ? target[name] : () => {}),
});

const Common = require('../plugins/bosses/wildernessbosses/Common.WildernessBosses');
const Caves = require('../plugins/bosses/wildernessbosses/Caves.WildernessBosses');
const Loot = require('../plugins/bosses/wildernessbosses/Loot.WildernessBosses');
const Vetion = require('../plugins/bosses/wildernessbosses/Vetion.WildernessBosses');
const Spiders = require('../plugins/bosses/wildernessbosses/Spiders.WildernessBosses');
Common.attach(api);
Caves.attach(api);
Loot.attach(api, { addDiscount: () => {}, playersIn: () => [] });
Vetion.attach(api);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3361, 10296);
});

test('the boss caves have the Wilderness levels cache script 384 gives them', () => {
  assert.equal(Wilderness.levelAt(3358, 10335), 40); // Callisto's Den
  assert.equal(Wilderness.levelAt(3295, 10203), 35); // Vet'ion's Rest
  assert.equal(Wilderness.levelAt(3423, 10212), 35); // Silk Chasm
  assert.equal(Wilderness.levelAt(1759, 11551), 21); // Hunter's End
  assert.equal(Wilderness.levelAt(1887, 11546), 21); // Skeletal Tomb
  assert.equal(Wilderness.levelAt(1631, 11556), 29); // Web Chasm
  assert.equal(Wilderness.levelAt(3359, 10246), 33); // Escape Caves, south
  assert.equal(Wilderness.levelAt(3361, 10300), 40); // Escape Caves, north
  assert.equal(Wilderness.levelAt(3292, 3848), 42); // the surface strip is unchanged
});

test('every lair has its entrance, its exit and a box its arrival lies in', () => {
  for (const lair of Common.LAIRS) {
    const [minX, minY, maxX, maxY, plane] = lair.entrance.arrive;
    assert.ok(Common.inBox(lair.box, lair.plane, { x: minX, y: minY, z: plane }), lair.key);
    assert.ok(Common.inBox(lair.box, lair.plane, { x: maxX, y: maxY, z: plane }), lair.key);
    assert.ok(Common.inBox(lair.box, lair.plane, { x: lair.exit.at[0], y: lair.exit.at[1], z: lair.exit.at[2] }), lair.key);
    assert.equal(lair.exit.to === 'escape', lair.multi, lair.key);
  }
  assert.equal(Caves._test.ENTRANCES.size, 6);
  assert.equal(Caves._test.ESCAPE_ENTRANCES.size, 4);
});

test('a player leaving a multi lair within 10 seconds of another comes out where they did', (t) => {
  let cycle = 1000;
  let arrivalRoll = 0;
  t.mock.method(World, 'getProcessCycle', () => cycle);
  t.mock.method(Math, 'random', () => {
    const roll = arrivalRoll;
    arrivalRoll = (arrivalRoll + 1 / 3) % 1;
    return roll;
  });
  const callisto = Common.LAIR_BY_KEY.get('callisto');
  Caves._test.lastExits.clear();
  const first = Caves._test.escapeArrival(callisto);
  cycle += Common.ESCAPE.followTicks;
  assert.equal(Caves._test.escapeArrival(callisto), first);
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    cycle += Common.ESCAPE.followTicks + 1;
    seen.add(Caves._test.escapeArrival(callisto));
  }
  assert.equal(seen.size, 3);
  assert.ok(Common.ESCAPE.arrivals.some((arrival) => arrival[0] === 3360 && arrival[1] === 10296));
});

test('Escape Caves exits choose only open tiles from each real arrival area', (t) => {
  let roll = 0;
  t.mock.method(Math, 'random', () => roll);
  const blockedNorthTile = [3361, 10297, 0];
  assert.equal(Common.open(...blockedNorthTile), false, 'the captured north arrival contains the wall tile');

  for (const box of Common.ESCAPE.arrivals) {
    const openTiles = [];
    for (let x = box[0]; x <= box[2]; x++) {
      for (let y = box[1]; y <= box[3]; y++) {
        if (Common.open(x, y, box[4])) openTiles.push([x, y, box[4]]);
      }
    }
    assert.ok(openTiles.length > 0, `arrival area ${box.join(',')} has a walkable tile`);
    for (let index = 0; index < openTiles.length; index++) {
      roll = (index + 0.5) / openTiles.length;
      const destination = Caves._test.randomOpenTile(box);
      const actual = [destination.getX(), destination.getY(), destination.getZ()];
      assert.deepEqual(actual, openTiles[index]);
      assert.ok(Common.open(...actual), `destination ${actual.join(',')} is open`);
      assert.notDeepEqual(actual, blockedNorthTile);
    }
  }
});

test('a multi lair exit never picks a blocked tile in its Escape Caves arrival area', (t) => {
  const vetion = Common.LAIR_BY_KEY.get('vetion');
  Caves._test.lastExits.clear();
  t.mock.method(Math, 'random', () => 0.75); // the south-east arrival
  t.mock.method(Common, 'open', (x, y) => x === 3377 && y === 10257);
  const destination = Caves._test.exitDestination(vetion);
  assert.deepEqual([destination.getX(), destination.getY(), destination.getZ()], [3377, 10257, 0]);
});

test('a multi lair exit falls back to the nearest open tile if its captured landing area is blocked', (t) => {
  const vetion = Common.LAIR_BY_KEY.get('vetion');
  Caves._test.lastExits.clear();
  t.mock.method(Math, 'random', () => 0.75); // the south-east arrival
  t.mock.method(Common, 'open', (x, y) => x === 3342 && y === 10255);
  const destination = Caves._test.exitDestination(vetion);
  assert.deepEqual([destination.getX(), destination.getY(), destination.getZ()], [3342, 10255, 0]);
});

test('the loot goes to the top ten by damage, each with at least a quarter of the solo amount', () => {
  const players = Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, damage: 100 - i }));
  const list = Loot._test.recipients(players.map((entry) => ({ player: entry, damage: entry.damage })));
  assert.equal(list.length, 10);
  assert.equal(list[0].player.name, 'p0');
  assert.ok(Math.abs(list.reduce((sum, entry) => sum + entry.share, 0) - 1) < 1e-9);
  assert.ok(list.every((entry) => entry.scale === 0.25));
  const solo = Loot._test.recipients([{ player: { name: 'solo' }, damage: 50 }]);
  assert.equal(solo[0].scale, 1);
  assert.deepEqual(Loot._test.scaled([{ itemId: 995, amount: 50000 }, { itemId: 532, amount: 1 }], 0.25),
    [{ itemId: 995, amount: 12500 }, { itemId: 532, amount: 1 }]);
});

test('the shield bash covers the captured shapes', (t) => {
  const npc = { getLocation: () => new core.Location(1884, 11544, 1), getSize: () => 3 };
  const at = (x, y) => ({ getLocation: () => new core.Location(x, y, 1) });
  t.mock.method(Math, 'random', () => 0.9);
  // The corner as captured: 12 tiles south-west of him, 2 deep.
  const corner = Vetion._test.bashTiles(npc, at(1883, 11543));
  assert.equal(corner.length, 12);
  assert.ok(corner.some(({ location }) => location.getX() === 1882 && location.getY() === 11542));
  // A side: 5 tiles, then 7, on the player's side.
  const side = Vetion._test.bashTiles(npc, at(1883, 11545));
  assert.equal(side.length, 12);
  assert.ok(side.every(({ location }) => location.getX() < 1884));
  t.mock.method(Math, 'random', () => 0);
  assert.equal(Vetion._test.bashTiles(npc, at(1883, 11545)).length, 16);
});

test('rebirth restores the combat stats the first form drained', () => {
  const restored = new Map();
  Vetion._test.restoreStats({
    getMaxLevel: () => 99,
    setCurrentLevels: (skill, level) => restored.set(skill, level),
  });
  assert.deepEqual([...restored.keys()],
    [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.MAGIC, core.Skill.RANGED]);
  assert.ok([...restored.values()].every((level) => level === 99));
});

test('the sticky web is the captured 37-tile shape', () => {
  const tiles = new Set(Spiders._test.WEB_PATTERN.map(([dx, dy]) => `${dx},${dy}`));
  assert.equal(tiles.size, 37);
  assert.ok(Spiders._test.WEB_PATTERN.every(([dx, dy]) => Math.abs(dx) <= 3 && Math.abs(dy) <= 3));
});

/** A player as these rules see one: attributes, varbits, messages. */
function fakePlayer(attributes = {}) {
  const sent = [];
  const sender = new Proxy({}, { get: (target, name) => (...args) => { sent.push([name, ...args]); return sender; } });
  return {
    sent,
    attributes,
    getAttribute: (key) => attributes[key],
    setAttribute: (key, value) => { attributes[key] = value; },
    getPacketSender: () => sender,
    sendMessage: (text) => sent.push(['message', text]),
    getLocation: () => new core.Location(3358, 10330, 0),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

test('a lair holds teleports for 3 ticks after entering', (t) => {
  let cycle = 500;
  t.mock.method(World, 'getProcessCycle', () => cycle);
  const player = fakePlayer({ [Caves._test.ENTERED_AT_ATTRIBUTE]: 500 });
  assert.equal(Caves._test.teleportLocked(player), true);
  cycle = 502;
  assert.equal(Caves._test.teleportLocked(player), true);
  cycle = 503;
  assert.equal(Caves._test.teleportLocked(player), false);
});

test('dying to a player since the last visit loses the fee to them', (t) => {
  const drops = [];
  t.mock.method(core.ItemOnGroundManager, 'registerLocation', (owner, item) => drops.push([owner, item.getId(), item.getAmount()]));
  const killer = fakePlayer();
  const player = fakePlayer({
    [Common.FEE_PAID_ATTRIBUTE]: true, [Common.FEE_AMOUNT_ATTRIBUTE]: 40000, [Common.VISITED_ATTRIBUTE]: true,
  });
  Caves._test.playerDied({ player, killer: { isPlayer: () => false } });
  assert.equal(player.attributes[Common.FEE_PAID_ATTRIBUTE], true);
  Caves._test.playerDied({ player, killer });
  assert.equal(player.attributes[Common.FEE_PAID_ATTRIBUTE], false);
  assert.deepEqual(drops, [[killer, Common.COINS, 40000]]);
  const away = fakePlayer({ [Common.FEE_PAID_ATTRIBUTE]: true, [Common.FEE_AMOUNT_ATTRIBUTE]: 50000, [Common.VISITED_ATTRIBUTE]: false });
  Caves._test.playerDied({ player: away, killer });
  assert.equal(away.attributes[Common.FEE_PAID_ATTRIBUTE], true);
});

/** A player with coins in the inventory and bank, the dialogue it is shown, and the prompt it answers. */
function payingPlayer({ coins = 0, banked = 0, attributes = {} } = {}) {
  const player = fakePlayer(attributes);
  const purse = { coins, banked };
  player.getInventory = () => ({ getAmount: () => purse.coins, delete: (id, amount) => { purse.coins -= amount; } });
  player.getBank = () => ({ getAmount: () => purse.banked, delete: (id, amount) => { purse.banked -= amount; } });
  player.boxes = [];
  player.getDialogueManager = () => ({
    startDialogues: (chain) => {
      for (const entry of chain.getDialogues().values()) {
        if (entry instanceof core.ActionDialogue) entry.send(player);
        else player.boxes.push(entry.getText());
      }
    },
  });
  return { player, purse };
}

function configureFee(t, fee) {
  const prompts = [];
  t.mock.method(api, 'getPluginConfig', (key, fallback) => (key === 'WildernessBosses:entryFee' && fee !== undefined ? fee : fallback));
  api.sendMultiChatboxPrompt = (player, title, ...pairs) => {
    prompts.push(title);
    pairs[1](player); // "Yes."
    return true;
  };
  t.after(() => { delete api.sendMultiChatboxPrompt; });
  t.mock.method(core.Bank, 'getTabForItem', () => 0);
  return prompts;
}

test('the default fee is wilderness-bosses.json\'s 50,000', (t) => {
  const prompts = configureFee(t, undefined);
  const { player, purse } = payingPlayer({ coins: 60_000 });
  let entered = false;
  Caves._test.feeThen(player, () => { entered = true; });
  assert.deepEqual(player.boxes, ['You need to pay a 50,000 coin fee to enter.<br>This can be taken from your inventory, bank, or both.']);
  assert.deepEqual(prompts, ['Pay 50,000 coins to enter?']);
  assert.equal(entered, true);
  assert.equal(purse.coins, 10_000);
  assert.equal(player.attributes[Common.FEE_AMOUNT_ATTRIBUTE], 50_000);
});

test('WildernessBosses:entryFee sets the fee asked and paid, and caps the discount below 50,000', (t) => {
  const prompts = configureFee(t, 20_000);
  const { player, purse } = payingPlayer({ coins: 5_000, banked: 30_000 });
  let entered = false;
  Caves._test.feeThen(player, () => { entered = true; });
  assert.deepEqual(player.boxes, ['You need to pay a 20,000 coin fee to enter.<br>This can be taken from your inventory, bank, or both.']);
  assert.deepEqual(prompts, ['Pay 20,000 coins to enter?']);
  assert.equal(entered, true);
  assert.deepEqual(purse, { coins: 0, banked: 15_000 });
  assert.equal(player.attributes[Common.FEE_AMOUNT_ATTRIBUTE], 20_000);

  Caves.addDiscount(player);
  Caves.addDiscount(player);
  Caves.addDiscount(player);
  assert.equal(player.attributes[Common.DISCOUNT_ATTRIBUTE], 20_000);
  assert.deepEqual(player.sent.filter(([kind]) => kind === 'message').map(([, text]) => text).slice(-2), [
    'Your entry fee discount has increased. It is now 10,000 / 20,000 coins.',
    'Your entry fee discount has increased. It is now 20,000 / 20,000 coins. You now have the maximum discount.',
  ]);
  assert.equal(Caves.feeCost(player), 0);
});

test('WildernessBosses:entryFee above the coin stack cap asks and takes at most 2,147,483,647', (t) => {
  assert.equal(require('../plugins/bosses/WildernessBosses.plugin').config['WildernessBosses:entryFee'].max, 2_147_483_647);
  const prompts = configureFee(t, 3_000_000_000);
  const { player, purse } = payingPlayer({ coins: 0, banked: 2_147_483_647 });
  let entered = false;
  Caves._test.feeThen(player, () => { entered = true; });
  assert.deepEqual(prompts, ['Pay 2,147,483,647 coins to enter?']);
  assert.equal(entered, true);
  assert.deepEqual(purse, { coins: 0, banked: 0 });
  assert.equal(player.attributes[Common.FEE_AMOUNT_ATTRIBUTE], 2_147_483_647);
});

test('WildernessBosses:entryFee 0: in without a box or coins, no discount, nothing for a player killer', (t) => {
  const prompts = configureFee(t, 0);
  const { player, purse } = payingPlayer({ coins: 17, banked: 23 });
  assert.equal(Caves.feeCost(player), 0);
  let entries = 0;
  Caves._test.feeThen(player, () => { entries++; });
  player.attributes[Common.FEE_PAID_ATTRIBUTE] = false;
  Caves._test.feeThen(player, () => { entries++; });
  assert.equal(entries, 2);
  assert.deepEqual(player.boxes, []);
  assert.deepEqual(prompts, []);
  assert.deepEqual(purse, { coins: 17, banked: 23 });
  assert.ok(!player.sent.some(([kind]) => kind === 'message'), 'enters silently');

  Caves.addDiscount(player);
  assert.equal(player.attributes[Common.DISCOUNT_ATTRIBUTE] ?? 0, 0);
  assert.ok(!player.sent.some(([kind]) => kind === 'message'), 'no discount message');

  Caves._test.checkFee({ player });
  assert.deepEqual(player.boxes, ['There is no entry fee for these caves.']);

  const drops = [];
  t.mock.method(core.ItemOnGroundManager, 'registerLocation', (...args) => drops.push(args));
  player.attributes[Common.VISITED_ATTRIBUTE] = true;
  Caves._test.playerDied({ player, killer: fakePlayer() });
  assert.deepEqual(drops, []);
});

test('the bears\' crescent and the spiders\' shots splat when they land, not before (#1862)', () => {
  const Bears = require('../plugins/bosses/wildernessbosses/Bears.WildernessBosses');
  Bears.attach(api);
  Spiders.attach(api);
  const lands = (ticks, end) => ticks * 30 >= end && (ticks - 1) * 30 < end;
  // Crescent: 30 + 6 per tile from the bear's middle, plus one.
  for (const tiles of [1, 3, 8]) {
    const end = Bears._test.RANGED.start + 6 * (tiles + 1);
    assert.ok(lands(Bears._test.rangedHitTicks(end), end), `crescent at ${tiles} tiles`);
  }
  assert.equal(Bears._test.rangedHitTicks(42), 2);
  // Spits and webs: 25 + 2 per tile; never a 0-tick hit.
  for (const tiles of [3, 10]) {
    const end = Spiders._test.SHOT_SHAPE.start + Spiders._test.SHOT_SHAPE.perTile * tiles;
    assert.ok(lands(Spiders._test.shotHitTicks(end), end), `spider shot at ${tiles} tiles`);
  }
  assert.equal(Spiders._test.shotHitTicks(31), 2);
});

// rsprox_transcripts/235/03403.txt (line 5110 on; also 03404, 03405): the bash's inner dust ring is
// zebak_roar_wave_dust (2184) at delay=2. A 2 passed to the two-argument Graphic read as Priority.HIGH (delay 0).
test("Vet'ion's bash dust keeps a delay of 2, not a priority", (t) => {
  const sent = [];
  const player = { getPacketSender: () => ({ sendGlobalGraphic: (graphic, location) => sent.push({ graphic, location }) }) };
  t.mock.method(Caves, 'playersIn', () => [player]);
  const tile = new core.Location(1883, 11545, 0);
  for (const delay of [2, 4]) Vetion._test.tileGraphic({ key: 'vetion' }, 2184, tile, delay);
  assert.deepEqual(sent.map(({ graphic }) => [graphic.id, graphic.getDelay(), graphic.getHeight()]), [[2184, 2, 0], [2184, 4, 0]]);
});

test("Callisto's ranged impact is delayed by its flight, never read as a height", () => {
  const Bears = require('../plugins/bosses/wildernessbosses/Bears.WildernessBosses');
  // 30 + 6 * (10 + 1) = 96 at ten tiles: GraphicHeight's 96, which the two-argument Graphic read as a height.
  for (const tiles of [1, 10]) {
    const end = Bears._test.RANGED.start + 6 * (tiles + 1);
    const graphic = Bears._test.impactGraphic(end);
    assert.deepEqual([graphic.getDelay(), graphic.getHeight()], [end, 0], `${tiles} tiles`);
  }
});

const SPIDER_CYCLE = 'wilderness-bosses:spider-cycle';

function spiderFight(t, bossId = 6610) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(9740);
  player.setUsername('wildboss');
  player.setRegistered(true);
  player.getSkillManager().setMaxLevels(core.Skill.PRAYER, 99, false).setCurrentLevels(core.Skill.PRAYER, 99, false);
  t.after(() => player.setRegistered(false));

  const npc = new core.NPC(bossId, new core.Location(3421, 10202, 2));
  const { key, spiderling } = Spiders._test.SPIDERS[bossId];
  const add = [];
  const remove = [];
  const projectiles = [];
  const tasks = [];
  const registered = [];
  let deferRegistration = false;
  let Combat;
  let beforeDeath;
  let combatHitResolved;
  let cycle = 0;

  t.mock.method(World, 'getAddNPCQueue', () => add);
  t.mock.method(World, 'getRemoveNPCQueue', () => remove);
  t.mock.method(World, 'getProcessCycle', () => cycle);
  t.mock.method(World.getNpcs(), 'add', (added) => {
    if (deferRegistration) return false;
    registerSpiderling(added);
    return true;
  });
  t.mock.method(core.CombatFactory, 'addPendingHit', () => {});
  t.mock.method(Caves, 'playersIn', () => []);
  t.mock.method(core.Projectile.prototype, 'sendProjectile', function () {
    projectiles.push({ id: this.projectileId, end: this.end });
  });
  t.mock.method(core.TaskManager, 'submit', (task) => {
    task.setRunning(true);
    tasks.push(task);
  });
  // Keep unrelated spiderling attack setup and shuffling independent of the fixture.
  t.mock.method(Common, 'engage', () => {});
  t.mock.method(Common, 'open', () => true);
  let roll = 0;
  t.mock.method(Math, 'random', () => (roll++ % 19) / 19);

  Spiders.attach({
    core,
    getPrayerHandler: () => PrayerHandler,
    getObjectManager: () => ({ register() {}, deregister() {} }),
    spawnNpc: (definition) => PluginManager.spawnNpc(definition),
    registerNpcCombatMethodProvider(ids, method) {
      assert.ok(ids.includes(bossId), 'the boss uses the registered method');
      Combat = method;
    },
    onNpcBeforeDeath: (handler) => { beforeDeath = handler; },
    onCombatHitResolved: (handler) => { combatHitResolved = handler; },
  });
  const fight = Common.FIGHTS.get(key);
  const combat = new Combat();
  fight.spawned(npc);

  function place(adjacent) {
    const x = npc.getLocation().getX() + npc.getSize() + (adjacent ? 0 : 5);
    player.setLocation(new core.Location(x, npc.getLocation().getY() + 2, npc.getLocation().getZ()));
  }

  function attack() {
    cycle += npc.getCombat().getAttackDelay();
    npc.resetUpdating();
    combat.start(npc, player);
    return npc.getAnimation().id;
  }

  function registerSpiderling(added) {
    assert.equal(added.getRealId(), spiderling);
    added.setRegistered(true);
    registered.push(added);
  }

  function registerBrood() {
    for (const added of add.splice(0)) registerSpiderling(added);
  }
  t.after(() => {
    try {
      fight.reset(npc);
    } finally {
      for (const added of registered) added.setRegistered(false);
      Spiders.attach(api);
    }
  });

  function tickTasks(ticks) {
    for (let i = 0; i < ticks; i++) {
      cycle++;
      for (const task of [...tasks]) {
        if (task.isRunning()) task.tick();
      }
    }
  }

  place(true);
  return {
    npc, player, key, fight, add, remove, registered, projectiles, beforeDeath, combatHitResolved,
    place, attack, registerBrood, tickTasks,
    deferAdds: () => { deferRegistration = true; },
  };
}

for (const [name, bossId] of [['Venenatis', 6610], ['Spindel', 11998]]) {
  test(`${name} calls two spiderlings on her opening bite`, (t) => {
    const { npc, add, attack, registered } = spiderFight(t, bossId);
    assert.equal(npc.getAnimation().id, 9993);
    assert.equal(npc.getCombat().getAttackDelay(), 7);
    assert.equal(attack(), 9991);
    assert.equal(registered.length, 2, 'both spiderlings are in the world on the attack tick');
    assert.equal(add.length, 0);
    assert.notDeepEqual(registered[0].getLocation(), registered[1].getLocation(), 'the two use separate spawn tiles');
    assert.equal(npc.getAttribute(SPIDER_CYCLE), 1);
  });

  test(`${name} throws the sticky web on attack 11 even when she bites`, (t) => {
    const { npc, player, attack, place, registerBrood, projectiles } = spiderFight(t, bossId);
    place(false);
    assert.equal(attack(), 9989);
    registerBrood();
    for (let slot = 1; slot < 10; slot++) attack();
    assert.ok(projectiles.every(({ id }) => id !== 2360));
    place(true);
    assert.equal(attack(), 9991);
    assert.deepEqual(projectiles.filter(({ id }) => id === 2360).map(({ id }) => id), [2360]);
    assert.deepEqual(projectiles.at(-1).end, player.getLocation());
    assert.equal(npc.getAttribute(SPIDER_CYCLE), 11);
  });
}

test('Venenatis counts both ways of crossing the melee boundary in the same cycle', (t) => {
  const { npc, attack, place, projectiles, registerBrood } = spiderFight(t);
  for (let slot = 0; slot < 4; slot++) assert.equal(attack(), 9991);
  assert.deepEqual(projectiles, [], 'a bite replaces the ordinary shot');
  registerBrood();
  place(false);
  for (let slot = 4; slot < 8; slot++) assert.equal(attack(), 9989);
  assert.equal(attack(), 9990);
  assert.deepEqual(projectiles.map(({ id }) => id), [2356, 2356, 2356, 2356, 2358]);
  assert.equal(npc.getAttribute(SPIDER_CYCLE), 9);
  place(true);
  assert.equal(attack(), 9991);
  assert.equal(npc.getAttribute(SPIDER_CYCLE), 10);
  place(false);
  assert.equal(attack(), 9990);
  assert.deepEqual(projectiles.slice(-2).map(({ id }) => id), [2358, 2360]);
  assert.equal(npc.getAttribute(SPIDER_CYCLE), 11);
});

for (const [name, adjacent, sequence] of [['bites', true, 9991], ['shots', false, 9989]]) {
  test(`Venenatis adds two more spiderlings after 16 ${name} with the first two alive`, (t) => {
    const { npc, add, registered, attack, registerBrood, place } = spiderFight(t);
    place(adjacent);
    assert.equal(attack(), sequence);
    registerBrood();
    assert.equal(registered.length, 2);
    for (let slot = 1; slot < 16; slot++) attack();
    assert.equal(add.length, 0, 'no extra calls before the cycle wraps');
    assert.equal(attack(), sequence);
    assert.equal(registered.length, 4, 'the second pair registers on the same attack');
    assert.equal(add.length, 0);
    assert.equal(registered.filter((spider) => spider.getHitpoints() > 0).length, 4);
    assert.equal(npc.getAttribute(SPIDER_CYCLE), 1);
  });
}

test('Venenatis keeps both new spiderlings when one from an older call dies that tick', (t) => {
  const { add, registered, attack, registerBrood, place } = spiderFight(t);
  place(false);
  attack();
  registerBrood();
  assert.equal(registered.length, 2);
  for (let slot = 1; slot < 16; slot++) attack();
  registered[0].setHitpoints(0);
  attack();
  assert.equal(registered.length, 4, 'the death does not turn the call into a top-up');
  assert.equal(add.length, 0);
  assert.equal(registered.filter((spider) => spider.getHitpoints() > 0).length, 3);
});

for (const reason of ['reset', 'death (estimated five-tick delay)']) {
  test(`Venenatis dismisses all eight spiderlings, including a pending call, on ${reason}`, (t) => {
    const { npc, fight, add, remove, registered, beforeDeath, attack, place, registerBrood, tickTasks, deferAdds } = spiderFight(t);
    place(false);
    for (let slot = 0; slot < 48; slot++) {
      attack();
      registerBrood();
    }
    deferAdds();
    attack();
    assert.equal(registered.length, 6);
    assert.equal(add.length, 2);
    const spiders = [...registered, ...add];
    assert.ok(spiders.every((spider) => spider.getHitpoints() > 0));
    if (reason === 'reset') {
      fight.reset(npc);
      assert.deepEqual(remove, registered);
      assert.deepEqual(add, [], 'the pending pair cannot appear after the reset');
      assert.equal(npc.getAttribute(SPIDER_CYCLE), 0);
    } else {
      beforeDeath({ npc, preventDeath: true });
      tickTasks(5);
      assert.ok(spiders.every((spider) => spider.getHitpoints() > 0));
      beforeDeath({ npc, preventDeath: false });
      registerBrood();
      tickTasks(4);
      assert.ok(spiders.every((spider) => spider.getHitpoints() > 0));
      tickTasks(1);
      assert.ok(spiders.every((spider) => spider.getHitpoints() === 0));
    }
  });
}

test('Venenatis spiderling deaths follow her death by an estimated five ticks', (t) => {
  const { npc, registered, beforeDeath, attack, place, registerBrood, tickTasks } = spiderFight(t);
  place(false);
  assert.equal(attack(), 9989);
  registerBrood();
  assert.equal(registered.length, 2);
  beforeDeath({ npc, preventDeath: false });
  assert.ok(registered.every((spider) => spider.getHitpoints() > 0));
  tickTasks(4);
  assert.ok(registered.every((spider) => spider.getHitpoints() > 0));
  tickTasks(1);
  assert.ok(registered.every((spider) => spider.getHitpoints() === 0));
});

test('Venenatis spiderling drain uses the filterable channel with its original bytes', (t) => {
  const { player, attack, place, registered, registerBrood, combatHitResolved } = spiderFight(t);
  const sender = player.getPacketSender();
  const messages = t.mock.method(sender, 'sendTypedMessage', () => {});
  const plain = t.mock.method(sender, 'sendMessage', () => {});
  place(false);
  attack();
  registerBrood();
  assert.equal(registered.length, 2);
  const before = player.getSkillManager().getCurrentLevel(core.Skill.PRAYER);
  combatHitResolved({ attacker: registered[0], target: player });
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.PRAYER), before - 1);
  assert.equal(plain.mock.callCount(), 0);
  assert.deepEqual(messages.mock.calls.map(({ arguments: [type, text] }) => [type, Buffer.from(text)]), [
    [core.ChatType.SPAM, Buffer.from('You feel yourself drained by the spiderling.')],
  ]);
});

test('Venenatis sticky web drain uses the filterable channel once per visit with its original bytes', (t) => {
  const { key, player, fight, attack, place, registerBrood, projectiles, tickTasks } = spiderFight(t);
  const sender = player.getPacketSender();
  const messages = t.mock.method(sender, 'sendTypedMessage', () => {});
  const plain = t.mock.method(sender, 'sendMessage', () => {});
  place(false);
  attack();
  registerBrood();
  for (let slot = 1; slot <= 10; slot++) attack();
  assert.equal(projectiles.at(-1).id, 2360, 'the ordinary slot-10 throw reaches the target tile');
  tickTasks(4);
  const landing = player.getLocation().clone();
  const before = player.getSkillManager().getCurrentLevel(core.Skill.PRAYER);
  fight.playerTick(player, { key });
  fight.playerTick(player, { key });
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.PRAYER), before - 6);
  player.setLocation(new core.Location(landing.getX() + 4, landing.getY(), landing.getZ()));
  fight.playerTick(player, { key });
  player.setLocation(landing);
  fight.playerTick(player, { key });
  assert.equal(plain.mock.callCount(), 0);
  const expected = [core.ChatType.SPAM, Buffer.from('You feel yourself drained by the webs!')];
  assert.deepEqual(messages.mock.calls.map(({ arguments: [type, text] }) => [type, Buffer.from(text)]), [expected, expected]);
});
