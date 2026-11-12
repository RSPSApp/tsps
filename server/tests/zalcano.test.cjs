// From server/: node --test tests/zalcano.test.cjs (after yarn build).
//
// Zalcano against the OSRS Wiki (Zalcano, /Strategies, Tephra, Imbued_tephra, Golem_(Zalcano),
// Demonic_Symbol, Zalcano_shard): the quest gate, who can hurt her and how, her fall and rise,
// the hazards, the throw and mining max hits, and the contribution rewards.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const core = PluginManager.getCoreApi();

let Common, Fight, Tephra, Rewards, Prison, tasks, events, questDone;
let activeMiningEnhancers = [];
let rewardEntries = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/bosses/zalcano/Common.Zalcano');
  ({ Fight } = require('../plugins/bosses/zalcano/Fight.Zalcano'));
  Tephra = require('../plugins/bosses/zalcano/Tephra.Zalcano');
  Rewards = require('../plugins/bosses/zalcano/Rewards.Zalcano');
  Prison = require('../plugins/bosses/zalcano/Prison.Zalcano');
  tasks = [];
  events = [];
  questDone = true;
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: (task) => tasks.push(task) } },
    persistAttribute: () => {},
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      player.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pick: (text) => pairs[pairs.indexOf(text) + 1]() };
    },
    emitCustomEvent(name, event) {
      events.push([name, event]);
      if (name === 'mining:extra-ore') for (const handler of activeMiningEnhancers) handler(event);
      if (name === 'quest:is-complete') event.complete = questDone;
      if (name === 'mining:best-pickaxe') event.pickaxe = { id: 1275, requiredLevel: 41, attemptIntervalTicks: 3 };
      // As Mining answers it (Wiki, Pickaxe: dragon "3 ticks by default, 1/6 chance to be 2 ticks").
      if (name === 'mining:roll-interval') event.ticks ??= event.pickaxe.attemptIntervalTicks - (event.pickaxe.fastRollChance && Math.random() < event.pickaxe.fastRollChance ? 1 : 0);
      if (name === 'skills:action-interval' && zalcanoPace) event.ticks = zalcanoPace;
      if (name === 'npc-drops:roll-table') {
        const entries = rewardEntries ?? [
          { item_id: 2353, quantity: [16, 699], weight: 3 },
          { item_id: 23962, quantity: [1, 3] },
        ];
        const tertiary = [
          { item_id: 23953, quantity: [1, 1], weight: 39 },
          { item_id: 23760, quantity: [1, 1], weight: 1 },
        ];
        const keep = (e) => (event.entryFilter ? event.entryFilter(e) : true);
        const kept = [...entries.filter(keep), ...tertiary.filter(keep)];
        event.drops.push(...kept.map((e) => ({ itemId: e.item_id, amount: e.quantity[0] })));
      }
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
});

const loc = (x, y) => new core.Location(x, y, 0);

function fakeNpc(id, x, y, hp, size = 5) {
  let transform = -1;
  const npc = {
    hp, anims: [], removed: false,
    getId: () => (transform !== -1 ? transform : id),
    setNpcTransformationId: (to) => { transform = to; },
    getLocation: () => loc(x, y),
    moveTo(to) { x = to.getX(); y = to.getY(); },
    getSize: () => size,
    getHitpoints: () => npc.hp,
    setHitpoints: (v) => { npc.hp = v; },
    getMaxHitpoints: () => (id === 9051 ? 14 : 1000),
    performAnimation: (a) => npc.anims.push(a.getId?.() ?? a),
    setScriptedMovement() {},
    isRegistered: () => !npc.removed,
    getMovementQueue: () => ({ walkStep: (dx, dy) => { x += dx; y += dy; } }),
  };
  return npc;
}

function fakeWorld() {
  const world = {
    npcs: [], objects: [],
    spawnNpc(id, tile) {
      const npc = fakeNpc(id, tile[0], tile[1], id === Common.ids.npcs.golem ? 14 : 1000, id === Common.ids.npcs.golem ? 1 : 5);
      world.npcs.push(npc);
      return npc;
    },
    removeNpc(npc) { if (npc) npc.removed = true; },
    placeObject(id, tile) { const o = { id, tile }; world.objects.push(o); return o; },
    removeObject(o) { world.objects = world.objects.filter((x) => x !== o); },
  };
  return world;
}

function fakePlayer(x = 3028, y = 6050) {
  let tile = loc(x, y);
  const items = new Map();
  const player = {
    damage: [], messages: [], chat: [], attributes: {}, varps: {}, run: 100, blocked: false,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => true,
    isPlayer: () => true,
    getAsPlayer: () => player,
    sendMessage: (m) => player.messages.push(m),
    forceChat: (m) => player.chat.push(m),
    getRunEnergy: () => player.run,
    setRunEnergy: (v) => { player.run = v; },
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    getPacketSender: () => ({ sendGraphic() {}, sendConfig: (id, v) => { player.varps[id] = v; }, sendTypedMessage: (type, m) => player.messages.push(m) }),
    getDialogueManager: () => ({ startDialogues: (chain) => { player.boxes = [...(player.boxes ?? []), chain]; player.messages.push(chain.getDialogues().get(0)?.getText?.()); } }),
    performAnimation: (a) => { player.anim = a?.getId?.(); },
    performGraphic: (g) => { player.graphic = g?.getId?.(); },
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      contains: (id) => (items.get(id) ?? 0) > 0,
      deleteNumber: (id, n) => items.set(id, (items.get(id) ?? 0) - n),
      adds: (id, n) => items.set(id, (items.get(id) ?? 0) + n),
      getFreeSlots: () => 20,
    }),
    getEquipment: () => ({ get: () => null }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => player.damage.push(...hits.map((h) => h.getDamage())) }), getTarget: () => player.target ?? null }),
    getMovementQueue: () => ({ reset() {}, setBlockMovement: (v) => { player.blocked = v; } }),
    items,
  };
  return player;
}

function newFight(players = [fakePlayer()]) {
  const world = fakeWorld();
  const fight = new Fight(world, () => players, () => 0);
  fight.start();
  return { fight, world, players };
}

function flush() {
  const due = tasks;
  tasks = [];
  for (const task of due) task.execute();
}

let zalcanoPace = null;

test('every id resolves from the cache', () => {
  const { npcs, locs, items, varps } = Common.ids;
  assert.deepEqual([npcs.armoured, npcs.weakened, npcs.golem], [9049, 9050, 9051]);
  assert.deepEqual([locs.rockGlowing, locs.rock, locs.rockDepleted, locs.furnace, locs.altar], [36192, 36193, 36194, 36195, 36196]);
  assert.deepEqual([locs.entrance, locs.exit, locs.barrier], [36198, 36197, 36201]);
  assert.deepEqual([items.tephra, items.refined, items.imbued, items.pet, items.shard], [23905, 23906, 23907, 23760, 23908]);
  assert.equal(varps.kills, 2352);
});

test('the platform down needs Song of the Elves; the one inside takes players back up', () => {
  const player = fakePlayer(3281, 6057);
  questDone = false;
  Prison.platform({ player, objectId: Common.ids.locs.entrance });
  assert.equal(player.messages.at(-1), Common.message('needQuest'));
  assert.equal(player.getLocation().getX(), 3281);
  questDone = true;
  Prison.platform({ player, objectId: Common.ids.locs.entrance });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], Common.data.prison.platform);
  Prison.platform({ player, objectId: Common.ids.locs.exit });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], Common.data.prison.outside);
});

test('she comes with 300 armour; one rock glows, the others are ordinary', () => {
  const { fight, world } = newFight();
  assert.equal(fight.npc.getHitpoints(), 300);
  const ids = world.objects.map((o) => o.id);
  assert.equal(ids.filter((id) => id === Common.ids.locs.rockGlowing).length, 1);
  assert.equal(ids.filter((id) => id === Common.ids.locs.rock).length, 3);
});

test('blasting the glowing rock hurts whoever is beside it and lights another corner', () => {
  const [nx, ny] = Common.data.prison.rocks[0];
  const player = fakePlayer(nx + 1, ny - 1);
  const { fight } = newFight([player]);
  fight.glowing = 0;
  fight.setRocks();
  fight.blastRock();
  assert.notEqual(fight.glowing, 0);
  for (let i = 0; i < 3; i++) fight.tick();
  assert.equal(player.damage.length, 1);
  assert.ok(player.damage[0] >= 21 && player.damage[0] <= Common.data.attacks.rockBlast.max);
});

test('only imbued tephra hurts her armour; at 0 she falls, and only mining hurts her then', () => {
  const { fight } = newFight();
  const player = fakePlayer();
  fight.npc.__zalFight = fight;
  const hit = (method, damage) => {
    let value = damage;
    const part = { getDamage: () => value, setDamage: (v) => { value = v; } };
    return { part, getAttacker: () => player, getCombatMethod: () => method, getHits: () => [part], updateTotalDamage() {} };
  };
  const melee = hit({}, 20);
  Prison.hitModify({ npc: fight.npc, hit: melee });
  assert.equal(melee.part.getDamage(), 0);
  const thrown = hit(Tephra.resolveMethod({ isPlayer: () => true, getAsPlayer: () => ({ ...player, getInventory: () => ({ getAmount: () => 5 }) }), getCombat: () => ({ getTarget: () => ({ isNpc: () => true, getAsNpc: () => fight.npc }) }) }), 20);
  Prison.hitModify({ npc: fight.npc, hit: thrown });
  assert.equal(thrown.part.getDamage(), 20);
  assert.equal(fight.contribution(player).shield, 20);
  assert.equal(fight.hp, 280);

  fight.setHp(0);
  const event = { npc: fight.npc, preventDeath: false };
  Prison.beforeDeath(event);
  assert.equal(event.preventDeath, true);
  assert.equal(fight.phase, 'down');
  assert.equal(fight.npc.getId(), Common.ids.npcs.weakened);
  assert.equal(fight.npc.getHitpoints(), 1000);
  const thrownDown = hit(thrown.getCombatMethod(), 20);
  Prison.hitModify({ npc: fight.npc, hit: thrownDown });
  assert.equal(thrownDown.part.getDamage(), 0, 'tephra does nothing once she is down');
  const mined = hit(Tephra.miningMethod(), 31);
  Prison.hitModify({ npc: fight.npc, hit: mined });
  assert.equal(mined.part.getDamage(), 31);
  assert.equal(fight.contribution(player).health, 31);
});

test('when she rises her armour is whole, all tephra crumbles and those beside her are pushed back', () => {
  const beside = fakePlayer(3030, 6050);
  const away = fakePlayer(3040, 6040);
  for (const p of [beside, away]) for (const id of [Common.ids.items.tephra, Common.ids.items.refined, Common.ids.items.imbued]) p.items.set(id, 4);
  const { fight } = newFight([beside, away]);
  fight.fall();
  fight.setHp(700);
  while (fight.phase === 'down') fight.tick();
  assert.equal(fight.health, 700);
  assert.equal(fight.npc.getHitpoints(), 300);
  assert.equal(fight.npc.getId(), Common.ids.npcs.armoured);
  // Recorded: the shockwave 6 ticks after she stands.
  assert.equal(beside.items.get(Common.ids.items.tephra), 4, 'not yet');
  for (let i = 0; i < Common.data.zalcano.shockwave.delay; i++) { fight.nextAttack = Infinity; fight.tick(); }
  for (const p of [beside, away]) for (const id of [Common.ids.items.tephra, Common.ids.items.refined, Common.ids.items.imbued]) assert.equal(p.items.get(id), 0);
  assert.ok(beside.damage.includes(Common.data.zalcano.shockwave.damage));
  assert.ok(beside.getLocation().getX() < 3030, 'pushed west, away from her');
  assert.equal(beside.blocked, true);
  flush();
  assert.equal(beside.blocked, false);
  assert.equal(away.damage.length, 0);
});

test('a golem that reaches her gives back armour for the health it has left', () => {
  const { fight } = newFight();
  fight.setHp(200);
  fight.sendGolem();
  const golem = fight.golems[0].npc;
  golem.moveTo(loc(3030, 6050));
  golem.hp = 7;
  fight.tickGolems();
  assert.equal(fight.npc.getHitpoints(), 225);
  assert.equal(fight.golems.length, 0);
  assert.equal(golem.removed, true);
});

test('a golem walks towards her, and its tephra goes to whoever hurt it most', () => {
  const { fight } = newFight();
  fight.sendGolem();
  const golem = fight.golems[0].npc;
  const start = golem.getLocation();
  for (let i = 0; i < 4; i++) { fight.tickCount += 1; fight.tickGolems(); }
  assert.ok(Common.distanceToNpc(golem.getLocation(), fight.npc) < Common.distanceToNpc(start, fight.npc));
  const a = fakePlayer();
  const b = fakePlayer();
  fight.recordGolem(golem, a, 4);
  fight.recordGolem(golem, b, 9);
  assert.equal(fight.golemKiller(golem), b);
});

test('an orange symbol is safe for 3 ticks, then hurts more each tick; blue empowers tephra', () => {
  const player = fakePlayer(3024, 6039);
  const { fight, world } = newFight([player]);
  const object = world.placeObject(Common.ids.locs.symbolDamage, [3023, 6038]);
  fight.symbols = [{ tile: loc(3023, 6038), empower: false, spawnedAt: fight.tickCount, until: fight.tickCount + 20, object, standing: new Map() }];
  for (let i = 0; i < 5; i++) { fight.tickCount = i; fight.tickSymbols([player]); }
  const { step } = Common.data.attacks.symbols;
  assert.deepEqual(player.damage, [step, step * 2]);
  assert.deepEqual(player.messages, Array(2).fill(Common.message('burning')), 'recorded: the line with each burn');
  assert.ok(player.run < 100);
  fight.symbols = [{ tile: loc(3023, 6038), empower: true, until: fight.tickCount + 20, object, standing: new Map() }];
  assert.equal(fight.empowered(player), true);
});

test('symbols never cover her and fade after their time', () => {
  const { fight } = newFight();
  fight.drawSymbols();
  assert.ok(fight.symbols.length >= 1);
  for (const symbol of fight.symbols) {
    assert.equal(symbol.spawnedAt, fight.tickCount);
    for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2]]) assert.ok(Common.distanceToNpc(symbol.tile.transform(dx, dy), fight.npc) > 0);
  }
  fight.tickCount = fight.symbols[0].until;
  fight.tickSymbols([]);
  assert.equal(fight.symbols.length, 0);
});

test('a boulder lands where the player stood when it fell', () => {
  const player = fakePlayer(3040, 6045);
  const { fight } = newFight([player]);
  fight.dropBoulders([player]);
  for (let i = 0; i < Common.data.attacks.boulders.warnTicks; i++) fight.tick();
  assert.equal(player.damage.length, 1);
  assert.ok(player.damage[0] >= 30 && player.damage[0] <= 40);
});

test('throw max hit: 5 + (Smithing + Runecraft) / 14, half again on blue; mining by level and pickaxe', () => {
  assert.equal(Tephra.throwMaxHit(99, 99, false), 19);
  assert.equal(Tephra.throwMaxHit(70, 70, false), 15);
  assert.equal(Tephra.throwMaxHit(99, 99, true), 28);
  assert.equal(Tephra.miningMaxHit(99, { requiredLevel: 41 }), 33);
  assert.equal(Tephra.miningMaxHit(80, { requiredLevel: 61 }), 32);
  assert.equal(Tephra.miningMaxHit(70, { requiredLevel: 71 }), 32);
  assert.equal(Tephra.miningMaxHit(50, { requiredLevel: 1 }), 30);
});

test('attacking without imbued tephra does nothing', () => {
  const player = fakePlayer();
  const zalcano = fakeNpc(Common.ids.npcs.armoured, 3031, 6048, 300);
  let reset = false;
  const combat = { reset: () => { reset = true; }, getTarget: () => ({ isNpc: () => true, getAsNpc: () => zalcano }) };
  const attacker = { isPlayer: () => true, getAsPlayer: () => player, getCombat: () => combat };
  const method = Tephra.resolveMethod(attacker);
  assert.equal(method.canPursue(attacker, zalcano), true, 'the engine reaches canAttack');
  assert.equal(method.canAttack(attacker), false);
  assert.equal(player.messages.at(-1), Common.message('noImbued'));
  assert.equal(reset, true, 'the attack ends instead of hanging on her');
  assert.equal(Tephra.isThrow(method), false);
  zalcano.setNpcTransformationId(Common.ids.npcs.weakened);
  const fallen = Tephra.resolveMethod(attacker);
  fallen.canAttack(attacker);
  assert.equal(player.messages.at(-1), Common.message('mineHer'));
});

test('refining and imbuing turn one tephra a tick, with their experience', () => {
  const player = fakePlayer();
  const xp = [];
  player.getSkillManager = () => ({ addExperiences: (skill, amount) => xp.push(amount), getCurrentLevel: () => 99 });
  player.performAnimation = () => {};
  player.items.set(Common.ids.items.tephra, 2);
  const prisonState = { tickCount: 0, fight: null };
  Tephra.refine(prisonState, { player, objectId: Common.ids.locs.furnace });
  for (let i = 0; i < 3; i++) { prisonState.tickCount += 1; Tephra.tickActions(prisonState, [player]); }
  assert.equal(player.items.get(Common.ids.items.refined), 2);
  Tephra.imbue(prisonState, { player, objectId: Common.ids.locs.altar });
  for (let i = 0; i < 3; i++) { prisonState.tickCount += 1; Tephra.tickActions(prisonState, [player]); }
  assert.equal(player.items.get(Common.ids.items.imbued), 2);
  assert.deepEqual(xp, [10, 10, 5, 5]);
  assert.equal(Tephra.refine(prisonState, { player, objectId: 1 }), false, 'another furnace is not hers');
});

test('the glowing rock gives tephra far faster than an ordinary one', () => {
  const run = (glowing) => {
    const [x, y] = Common.data.prison.rocks[0];
    const player = fakePlayer(x - 1, y);
    player.getSkillManager = () => ({ addExperiences() {}, getCurrentLevel: () => 99 });
    player.performAnimation = () => {};
    const prisonState = { tickCount: 0, fight: { glowing: glowing ? 0 : 1, phase: 'armoured' } };
    Tephra.mineRock(prisonState, { player, objectId: glowing ? Common.ids.locs.rockGlowing : Common.ids.locs.rock });
    let seed = 1;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 300; i++) { prisonState.tickCount += 1; Tephra.tickActions(prisonState, [player], random); }
    Tephra.actions.delete(player);
    return player.items.get(Common.ids.items.tephra) ?? 0;
  };
  assert.ok(run(true) > run(false) * 3);
});

test('points: health + 2 x armour for the table, capped at 1,000 for the rest', () => {
  assert.deepEqual(Rewards.points({ shield: 100, health: 300 }), { main: 500, tertiary: 500 });
  assert.deepEqual(Rewards.points({ shield: 400, health: 900 }), { main: 1700, tertiary: 1000 });
  assert.equal(Rewards.eligible({ shield: 4, health: 900 }), false);
  assert.equal(Rewards.eligible({ shield: 5, health: 0 }), true);
  assert.equal(Rewards.uniqueEligible({ shield: 5, health: 25 }), false);
  assert.equal(Rewards.uniqueEligible({ shield: 5, health: 26 }), true);
});

test('quantities grow with points; the shard chance runs from 1/1500 to 1/750', () => {
  const full = Common.data.rewards.fullPoints;
  assert.equal(Rewards.scaledAmount([16, 699], 0), 16);
  assert.equal(Rewards.scaledAmount([16, 699], full), 699);
  assert.equal(Rewards.scaledAmount([16, 699], full * 4), 699);
  assert.ok(Math.abs(Rewards.shardChance(0) - 1 / 1500) < 1e-12);
  assert.ok(Math.abs(Rewards.shardChance(1000) - 1 / 750) < 1e-12);
});

test('the kill: shards by contribution, the MVP\'s ashes and 10%, nothing under 5 armour damage', () => {
  const mvp = fakePlayer();
  const helper = fakePlayer();
  const tiny = fakePlayer();
  const contributions = new Map([
    [mvp, { shield: 150, health: 600 }],
    [helper, { shield: 20, health: 5 }],
    [tiny, { shield: 3, health: 200 }],
  ]);
  events = [];
  const loot = Rewards.share(contributions, () => 0.99);
  const item = (player, id) => loot.get(player)?.find((d) => d.itemId === id)?.amount;
  const { items } = Common.ids;
  assert.equal(item(mvp, items.crystalShard), 3);
  assert.equal(item(mvp, items.infernalAshes), 1);
  assert.equal(item(helper, items.crystalShard), 1, 'under 31 damage: one shard');
  assert.equal(item(helper, items.infernalAshes), undefined);
  assert.equal(loot.has(tiny), false);
  assert.equal(tiny.messages.at(-1), Common.message('tooLittle'));
  const helperBars = item(helper, 2353);
  const mvpBars = item(mvp, 2353);
  assert.equal(helperBars, Rewards.scaledAmount([16, 699], 45));
  assert.equal(mvpBars, Math.ceil(Rewards.scaledAmount([16, 699], 900) * 1.1));
  assert.equal(item(mvp, 23962), 3, 'the always-shards are not rolled again from the table');
  for (const p of [mvp, helper]) {
    assert.equal(item(p, Common.ids.items.toolSeed), undefined, 'the table\'s own unique rows are not rolled again');
    assert.equal(item(p, Common.ids.items.pet), undefined);
  }
  assert.ok(events.some(([name, e]) => name === 'npc-drops:roll' && e.player === mvp && e.drops.some((d) => d.itemId === 2353)), 'the kill goes through npc-drops:roll');
  assert.equal(mvp.attributes[Common.KILLS_ATTRIBUTE], 1);
  assert.equal(mvp.varps[Common.ids.varps.kills], 1);
  assert.equal(mvp.messages.at(-1), Common.message('killCount', { kills: 1 }));
  assert.equal(tiny.attributes[Common.KILLS_ATTRIBUTE], undefined);
  assert.ok(events.some(([name, e]) => name === 'npc-drops:place' && e.player === mvp));
});

test('the unique goes to one unique-eligible player; the pet goes through Pets', () => {
  const a = fakePlayer();
  const b = fakePlayer();
  const contributions = new Map([[a, { shield: 50, health: 100 }], [b, { shield: 100, health: 400 }]]);
  events = [];
  const loot = Rewards.share(contributions, () => 0);
  const uniques = [a, b].flatMap((p) => loot.get(p).filter((d) => [Common.ids.items.toolSeed, Common.ids.items.uncutOnyx].includes(d.itemId)));
  assert.equal(uniques.length, 1);
  assert.equal(uniques[0].itemId, Common.ids.items.toolSeed);
  const pets = events.filter(([name, e]) => name === 'npc-drops:roll' && e.drops.some((d) => d.itemId === Common.ids.items.pet));
  assert.equal(pets.length, 2, 'each eligible player rolls the pet, handed to Pets on npc-drops:roll');
  assert.ok(loot.get(a).some((d) => d.itemId === Common.ids.items.shard));
});

test("her world spawn is kept out of the prison; elsewhere spawns are untouched", () => {
  const inside = { npcId: Common.ids.npcs.armoured, location: loc(3031, 6048), allow: true };
  Prison.blockWorldSpawn(inside);
  assert.equal(inside.allow, false);
  const outside = { npcId: Common.ids.npcs.armoured, location: loc(3200, 3200), allow: true };
  Prison.blockWorldSpawn(outside);
  assert.equal(outside.allow, true);
});

const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const continueBox = (player) => player.boxes.at(-1).getDialogues().get(1).action.execute();

// Recorded (rsprox 4056/4057): going in, the warning box, then "Are you sure you wish to enter?".
test("the barrier crosses either way, warning on the way in; 'don't ask again' is kept; another barrier is not hers", () => {
  // The prison is south of the barrier.
  const player = fakePlayer(3034, 6061);
  Prison.pass({ player, objectId: Common.ids.locs.barrier });
  assert.deepEqual(at(player), Common.data.prison.barrierNorth, 'out: straight through');
  Prison.pass({ player, objectId: Common.ids.locs.barrier });
  assert.equal(player.messages.at(-1), Common.message('entryWarning'));
  assert.deepEqual(at(player), Common.data.prison.barrierNorth, 'not yet');
  continueBox(player);
  assert.deepEqual(player.prompt.options, ['Yes.', "Yes, and don't ask again.", 'No.']);
  player.prompt.pick('No.');
  assert.deepEqual(at(player), Common.data.prison.barrierNorth);
  Prison.pass({ player, objectId: Common.ids.locs.barrier });
  continueBox(player);
  player.prompt.pick("Yes, and don't ask again.");
  assert.deepEqual(at(player), Common.data.prison.barrierSouth, 'in');
  Prison.pass({ player, objectId: Common.ids.locs.barrier });
  const boxes = player.boxes.length;
  Prison.pass({ player, objectId: Common.ids.locs.barrier });
  assert.equal(player.boxes.length, boxes, 'not asked again');
  assert.deepEqual(at(player), Common.data.prison.barrierSouth);
  assert.equal(Prison.pass({ player, objectId: 1 }), false);
});

test('throws landing on one tick share what armour she has left; the rest does nothing', () => {
  const { fight } = newFight();
  fight.npc.__zalFight = fight;
  fight.setHp(10);
  const a = fakePlayer();
  const b = fakePlayer();
  const method = Tephra.resolveMethod({ isPlayer: () => true, getAsPlayer: () => ({ ...a, getInventory: () => ({ getAmount: () => 5 }) }), getCombat: () => ({ getTarget: () => ({ isNpc: () => true, getAsNpc: () => fight.npc }) }) });
  const hit = (player, damage) => {
    let value = damage;
    const part = { getDamage: () => value, setDamage: (v) => { value = v; } };
    return { part, getAttacker: () => player, getCombatMethod: () => method, getHits: () => [part], updateTotalDamage() {} };
  };
  const first = hit(a, 7);
  const second = hit(b, 15);
  Prison.hitModify({ npc: fight.npc, hit: first });
  Prison.hitModify({ npc: fight.npc, hit: second });
  assert.equal(first.part.getDamage(), 7);
  assert.equal(second.part.getDamage(), 3);
  assert.equal(fight.contribution(a).shield + fight.contribution(b).shield, 10);
});

test('damage from anything but tephra and mining is put back, and never makes her fall or die', () => {
  const { fight } = newFight();
  fight.npc.__zalFight = fight;
  fight.npc.setHitpoints(250);
  fight.npc.getPoisonDamage = () => 6;
  let poison = 6;
  fight.npc.setPoisonDamage = (v) => { poison = v; };
  fight.tick();
  assert.equal(fight.npc.getHitpoints(), 300);
  assert.equal(poison, 0);
  fight.npc.setHitpoints(0);
  const event = { npc: fight.npc, preventDeath: false };
  Prison.beforeDeath(event);
  assert.equal(event.preventDeath, true);
  assert.equal(fight.phase, 'armoured');
  assert.equal(fight.npc.getHitpoints(), 300);
  fight.fall();
  fight.setHp(0);
  const death = { npc: fight.npc, preventDeath: false };
  Prison.beforeDeath(death);
  assert.equal(death.preventDeath, false, 'mined to 0 she dies');
});

test('dying she does nothing more: no rise, no attacks', () => {
  const player = fakePlayer(3030, 6050);
  const { fight } = newFight([player]);
  fight.fall();
  fight.setHp(0);
  fight.downUntil = fight.tickCount + 1;
  for (let i = 0; i < 5; i++) fight.tick();
  assert.equal(fight.phase, 'down');
  assert.equal(player.damage.length, 0);
});

test('tephra never leaves the prison, carried or wielded', () => {
  const player = fakePlayer();
  for (const id of [Common.ids.items.tephra, Common.ids.items.refined, Common.ids.items.imbued]) player.items.set(id, 3);
  let weapon = new core.Item(Common.ids.items.imbued, 12);
  player.getEquipment = () => ({ get: () => weapon, set: (_slot, item) => { weapon = item; }, refreshItems() {} });
  assert.equal(Tephra.removeTephra(player), 21);
  assert.equal(weapon.getId(), -1);
  for (const id of [Common.ids.items.tephra, Common.ids.items.refined, Common.ids.items.imbued]) assert.equal(player.items.get(id), 0);
});

test('symbols are never drawn over a rock', () => {
  for (let i = 0; i < 20; i++) {
    const { fight } = newFight();
    let seed = i + 1;
    fight.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    fight.drawSymbols();
    for (const symbol of fight.symbols) {
      for (const [rx, ry] of Common.data.prison.rocks) {
        assert.ok(Math.abs(symbol.tile.getX() - rx) >= 3 || Math.abs(symbol.tile.getY() - ry) >= 3);
      }
    }
  }
});


function realPlayer(t, name, mode = 'none') {
  const player = new Player(null, loc(3024, 6039));
  player.setUsername(name);
  player.setRegistered(true);
  player.setAttribute('ironman:mode', mode);
  player.messages = [];
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(player, 'sendMessage', message => player.messages.push(message));
  t.after(() => { player.getCombat().getHitQueue().clear(); player.setRegistered(false); });
  return player;
}

test('orange symbol grace expires from spawn; late entry and re-entry damage immediately and still escalate', t => {
  const player = realPlayer(t, 'symbols');
  const { fight, world } = newFight([player]);
  const object = world.placeObject(Common.ids.locs.symbolDamage, [3023, 6038]);
  fight.symbols = [{ tile: loc(3023, 6038), empower: false, spawnedAt: 0, until: 30, object, standing: new Map() }];
  const queue = player.getCombat().getHitQueue();
  for (let tick = 0; tick < 3; tick++) { fight.tickCount = tick; fight.tickSymbols([player]); }
  assert.equal(queue.getQueuedDamage(), 0, 'the first three spawn ticks remain safe');
  player.moveTo(loc(3028, 6039)); fight.tickCount = 3; fight.tickSymbols([player]);
  player.moveTo(loc(3024, 6039)); fight.tickCount = 8; fight.tickSymbols([player]);
  const { step, max } = Common.data.attacks.symbols;
  assert.equal(queue.getQueuedDamage(), step, 'late entry has no new grace');
  fight.tickCount = 9; fight.tickSymbols([player]);
  assert.equal(queue.getQueuedDamage(), step * 3, 'continued exposure escalates');
  player.moveTo(loc(3028, 6039)); fight.tickCount = 10; fight.tickSymbols([player]);
  player.moveTo(loc(3024, 6039)); fight.tickCount = 11; fight.tickSymbols([player]);
  assert.equal(queue.getQueuedDamage(), step * 4, 're-entry immediately starts damage again');
  for (let tick = 12; tick < 20; tick++) {
    const previous = queue.getQueuedDamage(); fight.tickCount = tick; fight.tickSymbols([player]);
    assert.equal(queue.getQueuedDamage() - previous, Math.min(max, (tick - 10) * step));
  }
});

test('Smolcano requires five armour damage and at least31 combined damage', t => {
  for (const [shield, health, pet] of [[5, 0, false], [5, 25, false], [5, 26, true], [4, 100, false]]) {
    const player = realPlayer(t, `pet${shield}${health}`);
    const loot = Rewards.share(new Map([[player, { shield, health }]]), () => 0);
    assert.equal(loot.get(player)?.some(drop => drop.itemId === Common.ids.items.pet) ?? false, pet, `${shield}+${health}`);
  }
});

test('real Zalcano death order preserves Ironman shares and pet delivery, then clears fight ownership', t => {
  const handlers = new Map(), placed = new Map();
  let sharesWhileDead = 0;
  const originalApi = Common.api;
  const api = new Proxy({
    core,
    onCustomEvent(name, handler) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); },
    emitCustomEvent(name, event) {
      if (name === 'npc-drops:roll-table') event.drops.push({ itemId: 2353, amount: 100, noted: true });
      if (name === 'ironman:shared-kill-keeps' && event.npc?.__zalFight) {
        sharesWhileDead++;
        assert.equal(event.npc.__zalFight.phase, 'dead');
        assert.equal(event.npc.__zalFight.stopped, false, 'rewards precede fight.stop');
      }
      for (const handler of handlers.get(name) ?? []) handler(event);
      if (name === 'npc-drops:place') placed.set(event.player, event.drops.map(drop => ({ ...drop })));
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const Iron = require('../plugins/modes/ironman/Common.Ironman');
  Iron.init(api);
  require('../plugins/modes/ironman/Loot.Ironman')(api);
  require('../plugins/bosses/Zalcano.plugin').register(api);
  require('../plugins/npcs/Pets.plugin').register(api);
  const savedPrison = { ...Prison.prison };
  try {
    const accounts = ['ironman', 'ultimate', 'hardcore', 'none'].map(mode => realPlayer(t, mode, mode));
    const contributions = new Map(accounts.map(player => [player, { shield: 100, health: 400 }]));
    const world = fakeWorld();
    world.spawnNpc = (id, tile) => new NPC(id, loc(tile[0], tile[1]));
    const fight = new Fight(world, () => accounts, () => 0);
    fight.start(); fight.contributions = contributions;
    const npc = fight.npc;
    npc.setNpcTransformationId(Common.ids.npcs.weakened);
    for (const player of accounts) {
      const follower = new NPC(1, player.getLocation()); follower.setRegistered(true);
      player.setAttribute('pets:current', follower);
    }
    t.mock.method(Prison.prison.area, 'getPlayers', () => accounts);
    t.mock.method(Math, 'random', () => 0);
    Prison.prison.fight = fight;
    Prison.zalcanoDied(fight);
    const loot = placed;
    assert.equal(loot.size, accounts.length);
    assert.equal(sharesWhileDead, 3, 'all Ironman modes receive shares between died and stop');
    assert.equal(npc.__zalFight, null, 'fight.stop clears ownership only after rewards');
    assert.equal(fight.stopped, true);
    assert.equal(Prison.prison.fight, null);
    for (const player of accounts) {
      assert.ok(loot.get(player).some(drop => drop.itemId === 2353), player.getUsername() + ' main roll');
      assert.ok(loot.get(player).some(drop => drop.itemId === Common.ids.items.crystalShard), 'shards');
      assert.equal(loot.get(player).some(drop => drop.itemId === Common.ids.items.pet), false, 'Pets consumes the ground entry');
      assert.equal(player.getInventory().getAmount(Common.ids.items.pet), 1, 'actual Pets hook delivers Smolcano');
      assert.ok(player.getAttribute('pets.owned').includes(Common.ids.items.pet), 'pet ownership recorded');
      assert.equal(player.getAttribute(Common.KILLS_ATTRIBUTE), 1);
      assert.ok(!player.messages.includes(Iron.message('sharedKill')), 'no false loot-loss warning');
    }
    assert.ok(loot.get(accounts[0]).some(drop => drop.itemId === Common.ids.items.toolSeed), 'MVP unique survives');
    const tiny = realPlayer(t, 'tinyiron', 'ironman');
    const empty = Rewards.share(new Map([[tiny, { shield: 4, health: 400 }], [accounts[3], { shield: 100, health: 400 }]]), () => 0.99, npc);
    assert.equal(empty.has(tiny), false, 'contribution gate remains authoritative');
    for (const [target, npcId] of [[npc, Common.ids.npcs.weakened], [null, 1]]) {
      const player = target ? tiny : accounts[0];
      const request = { player, npc: target, npcId, drops: [{ itemId: 995, amount: 1 }], damagers: [player, accounts[3]] };
      api.emitCustomEvent('npc-drops:roll', request);
      assert.deepEqual(request.drops, [], 'unearned or unrelated group loot remains filtered');
    }
  } finally { Object.assign(Prison.prison, savedPrison); Common.init(originalApi); }
});

// Recorded (rsprox 4057, 1073-1075): the tephra loop's lines and the Zalcano mining animation.
test('the recorded lines: the swing and each tephra mined, the full pack, refining and imbuing', () => {
  const [x, y] = Common.data.prison.rocks[0];
  const player = fakePlayer(x - 1, y);
  player.getSkillManager = () => ({ addExperiences() {}, getCurrentLevel: () => 99 });
  const prisonState = { tickCount: 0, fight: { glowing: 0, phase: 'armoured' } };
  Tephra.mineRock(prisonState, { player, objectId: Common.ids.locs.rockGlowing });
  assert.equal(player.messages.at(-1), 'You swing your pick at the rock.');
  prisonState.tickCount += 1;
  Tephra.tickActions(prisonState, [player], () => 0);
  assert.equal(player.anim, core.CacheDefinitions.getSeqId('human_mining_zalcano_rune_pickaxe'), "the rune pickaxe's Zalcano swing");
  assert.ok(player.messages.includes('You manage to mine some tephra.'));
  player.getInventory = ((original) => () => ({ ...original(), getFreeSlots: () => 0 }))(player.getInventory);
  prisonState.tickCount += 5;
  Tephra.tickActions(prisonState, [player], () => 0);
  assert.equal(player.messages.at(-1), 'Your inventory is too full to hold any more tephra.');

  const smith = fakePlayer();
  smith.getSkillManager = () => ({ addExperiences() {}, getCurrentLevel: () => 99 });
  smith.items.set(Common.ids.items.tephra, 1);
  const state = { tickCount: 0, fight: null };
  Tephra.refine(state, { player: smith, objectId: Common.ids.locs.furnace });
  state.tickCount += 1;
  Tephra.tickActions(state, [smith]);
  assert.equal(smith.messages.at(-1), 'You heat the tephra in the furnace and smelt it down into a refined lump.');
  Tephra.imbue(state, { player: smith, objectId: Common.ids.locs.altar });
  state.tickCount += 1;
  Tephra.tickActions(state, [smith]);
  assert.equal(smith.messages.at(-1), "You bind the altar's power into some refined tephra.");
  Tephra.imbue(state, { player: smith, objectId: Common.ids.locs.altar });
  assert.equal(smith.messages.at(-1), 'You do not have anything suitable for imbuing.');
});

test('she falls and stands with the recorded red lines', () => {
  const player = fakePlayer();
  const { fight } = newFight([player]);
  fight.fall();
  assert.equal(player.messages.at(-1), '<col=ff0000>Zalcano falls to the ground, hurt and vulnerable.</col>');
  player.items.set(Common.ids.items.tephra, 1);
  fight.rise();
  assert.equal(player.messages.at(-1), '<col=ff0000>Zalcano stands from the floor, ready to fight back.</col>');
  assert.equal(fight.shockwaveAt, fight.tickCount + 6, 'recorded: 6 ticks later');
  fight.shockwave();
  assert.equal(player.messages.at(-1), '<col=ff0000>A shockwave from Zalcano destroys your tephra.</col>');
});

test("a blue symbol's power pulses every 5 ticks while stood on; a burn says Agh! with its line", () => {
  const player = fakePlayer(3024, 6039);
  const { fight, world } = newFight([player]);
  const object = world.placeObject(Common.ids.locs.symbolEmpower, [3023, 6038]);
  fight.symbols = [{ tile: loc(3023, 6038), empower: true, spawnedAt: 0, until: 100, object, standing: new Map() }];
  for (let i = 0; i < 11; i++) { fight.tickCount = i; fight.tickSymbols([player]); }
  assert.equal(player.messages.filter((m) => m === Common.message('empowered')).length, 3, 'on stepping on, then at 5 and 10');
  assert.equal(player.graphic, Common.ids.spotanims.empower);
  const burnt = fakePlayer(3024, 6039);
  const red = world.placeObject(Common.ids.locs.symbolDamage, [3023, 6038]);
  fight.symbols = [{ tile: loc(3023, 6038), empower: false, spawnedAt: 0, until: 100, object: red, standing: new Map() }];
  fight.tickCount = 10;
  fight.tickSymbols([burnt]);
  assert.deepEqual([burnt.messages, burnt.chat, burnt.graphic], [[Common.message('burning')], ['Agh!'], Common.ids.spotanims.burning]);
});

test("a rock's next swing follows Mining's roll interval and content's pace, not the raw pickaxe figure", (t) => {
  const [x, y] = Common.data.prison.rocks[0];
  const player = fakePlayer(x - 1, y);
  player.getSkillManager = () => ({ addExperiences() {}, getCurrentLevel: () => 99 });
  player.performAnimation = () => {};
  const prisonState = { tickCount: 0, fight: { glowing: 1, phase: 'armoured' } };
  Tephra.mineRock(prisonState, { player, objectId: Common.ids.locs.rock });
  const fast = { id: 11920, requiredLevel: 61, attemptIntervalTicks: 3, fastRollChance: 1 / 6 };
  const emit = Common.api.emitCustomEvent.bind(Common.api);
  t.mock.method(Common.api, 'emitCustomEvent', (name, event) => {
    emit(name, event);
    if (name === 'mining:best-pickaxe') event.pickaxe = fast;
  });
  t.mock.method(Math, 'random', () => 0);
  prisonState.tickCount = 10;
  Tephra.tickActions(prisonState, [player], () => 0.99);
  assert.equal(Tephra.actions.get(player)?.next, 12, 'the quick roll: 2 ticks');
  zalcanoPace = 1;
  t.after(() => { zalcanoPace = null; Tephra.actions.delete(player); });
  prisonState.tickCount = 12;
  Tephra.tickActions(prisonState, [player], () => 0.99);
  assert.equal(Tephra.actions.get(player)?.next, 13, "content's pace (a league relic) answers after Mining");
});


function enhancedTephraMiner(t, { signet = false, charges = 3, slots = 28, armour = false, glowing = false, proc = true } = {}) {
  const [x, y] = Common.data.prison.rocks[0];
  const player = new Player(null, loc(x - 1, y));
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.isRegistered = () => true;
  player.performAnimation = () => {};
  const xp = [];
  player.getSkillManager().addExperiences = (skill, amount) => xp.push([skill, amount]);
  player.getSkillManager().getCurrentLevel = () => 99;
  const I = core.ItemIdentifiers;
  const Ring = require('../plugins/skills/shootingstars/CelestialRing.ShootingStars');
  const ring = new core.Item(signet ? I.CELESTIAL_SIGNET : I.CELESTIAL_RING, 1);
  ring.setMetaValue(Ring.CHARGES_META_KEY, charges);
  player.getEquipment().setItem(core.Equipment.RING_SLOT, ring);
  if (armour) player.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(I.VARROCK_ARMOUR_1, 1));
  for (let i = 0; i < 28 - slots; i++) player.getInventory().adds(I.SHARK, 1);
  const handlers = [];
  const api = new Proxy({
    core,
    onCustomEvent: (name, handler) => { if (name === 'mining:extra-ore') handlers.push(handler); },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/skills/shootingstars/Common.ShootingStars').bind(api);
  Ring(api);
  require('../plugins/skills/mining/VarrockArmour.Mining').attach(api);
  activeMiningEnhancers = handlers;
  t.after(() => { activeMiningEnhancers = []; Tephra.actions.delete(player); });
  t.mock.method(Math, 'random', () => proc ? 0 : 0.99);
  const prison = { tickCount: 0, fight: { glowing: glowing ? 0 : 1, phase: 'armoured' } };
  Tephra.mineRock(prison, { player, objectId: glowing ? Common.ids.locs.rockGlowing : Common.ids.locs.rock });
  const attempt = (success = true) => {
    const rolls = glowing ? [success ? 0 : 0.99, 0, 0.99] : [success ? 0 : 0.99, 0.99];
    Tephra.tickActions(prison, [player], () => rolls.shift() ?? 0.99);
  };
  return { player, ring, Ring, xp, prison, attempt };
}

for (const signet of [false, true]) {
  test('tephra calls the registered celestial ' + (signet ? 'signet' : 'ring') + ' hook once per successful action', (t) => {
    const f = enhancedTephraMiner(t, { signet, glowing: true });
    f.attempt();
    assert.equal(f.player.getInventory().getAmount(Common.ids.items.tephra), 3, 'two glowing base tephra plus one ring bonus');
    assert.equal(f.Ring.charges(f.ring), 2, 'one charge, not one per glowing base ore');
    assert.deepEqual(f.xp.map(([, amount]) => amount), [35.2, 35.2, 35.2]);
    const request = events.findLast(([name]) => name === 'mining:extra-ore')[1];
    assert.equal(request.rockLevel, 1);
    assert.equal(request.oreId, Common.ids.items.tephra);
  });
}

test('tephra spends a charge on missed bonus or no bonus room, but gives no excess item or XP', (t) => {
  const f = enhancedTephraMiner(t, { slots: 1, proc: false });
  f.attempt();
  assert.equal(f.Ring.charges(f.ring), 2);
  assert.equal(f.player.getInventory().getAmount(Common.ids.items.tephra), 1);
  assert.deepEqual(f.xp.map(([, amount]) => amount), [35.2]);
});

test('a successful enhancer roll without room spends its last charge without extra tephra or XP', (t) => {
  const f = enhancedTephraMiner(t, { slots: 1, charges: 1 });
  f.attempt();
  assert.equal(f.ring.getId(), core.ItemIdentifiers.CELESTIAL_RING_UNCHARGED_);
  assert.equal(f.player.getInventory().getAmount(Common.ids.items.tephra), 1);
  assert.deepEqual(f.xp.map(([, amount]) => amount), [35.2]);
});

test('failed tephra rolls and initially full inventories spend no charges', (t) => {
  const f = enhancedTephraMiner(t);
  f.attempt(false);
  assert.equal(f.Ring.charges(f.ring), 3);
  assert.equal(f.player.getInventory().getAmount(Common.ids.items.tephra), 0);
  assert.equal(f.xp.length, 0);
  for (let i = 0; i < 28; i++) f.player.getInventory().adds(core.ItemIdentifiers.SHARK, 1);
  f.prison.tickCount = 4;
  f.attempt();
  assert.equal(f.Ring.charges(f.ring), 3);
  assert.equal(f.xp.length, 0);
});

test('Varrock armour 1 and a charged ring stack through the same tephra hook', (t) => {
  const f = enhancedTephraMiner(t, { armour: true });
  f.attempt();
  assert.equal(f.player.getInventory().getAmount(Common.ids.items.tephra), 3);
  assert.equal(f.Ring.charges(f.ring), 2);
  assert.deepEqual(f.xp.map(([, amount]) => amount), [35.2, 35.2, 35.2]);
});


test('Zalcano imported death-rune range preserves contribution cap and existing MVP scaling', () => {
  const dump = require('../data/definitions/npc-drops.json');
  const row = dump.tables.zalcano.entries.find(entry => entry.item_id === core.ItemIdentifiers.DEATH_RUNE);
  assert.deepEqual(row.quantity, [201, 1046]);
  assert.equal(row.weight, 1);
  assert.equal(row.out_of, 36);
  assert.equal(dump.tables.zalcano.main_max_roll, 36);
  rewardEntries = [row];
  try {
    assert.equal(Rewards.mainRoll(fakePlayer(), 0, false).find(drop => drop.itemId === row.item_id).amount, 201);
    assert.equal(Rewards.mainRoll(fakePlayer(), Number.MAX_SAFE_INTEGER, false).find(drop => drop.itemId === row.item_id).amount, 1046);
    assert.equal(Rewards.mainRoll(fakePlayer(), Number.MAX_SAFE_INTEGER, true).find(drop => drop.itemId === row.item_id).amount, 1151);
  } finally { rewardEntries = null; }
});


test('uncharged celestial jewellery does not add tephra or spend a charge', (t) => {
  const f = enhancedTephraMiner(t);
  f.ring.setId(core.ItemIdentifiers.CELESTIAL_RING_UNCHARGED_);
  f.attempt();
  assert.equal(f.player.getInventory().getAmount(Common.ids.items.tephra), 1);
  assert.deepEqual(f.xp.map(([, amount]) => amount), [35.2]);
});

test('Varrock armour 1 gives tephra without a celestial ring', (t) => {
  const f = enhancedTephraMiner(t, { armour: true });
  f.player.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(-1, 0));
  f.attempt();
  assert.equal(f.player.getInventory().getAmount(Common.ids.items.tephra), 2);
  assert.deepEqual(f.xp.map(([, amount]) => amount), [35.2, 35.2]);
});

test('refused bonus inventory credit gives no bonus XP even after the enhancer consumes a charge', (t) => {
  const f = enhancedTephraMiner(t);
  const inventory = f.player.getInventory();
  const adds = inventory.adds.bind(inventory);
  let credits = 0;
  inventory.adds = (id, amount) => ++credits === 1 ? adds(id, amount) : inventory;
  f.attempt();
  assert.equal(f.Ring.charges(f.ring), 2);
  assert.equal(inventory.getAmount(Common.ids.items.tephra), 1);
  assert.deepEqual(f.xp.map(([, amount]) => amount), [35.2]);
});
