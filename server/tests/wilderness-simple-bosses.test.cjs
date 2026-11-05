// From server/: node --test tests/wilderness-simple-bosses.test.cjs
//
// The Chaos Fanatic's and the Crazy archaeologist's attack rules against the OSRS Wiki
// (Chaos_Fanatic, Crazy_archaeologist + /Strategies) and the NPC's own transcript
// (data/definitions/npc-dialogues.json). Only the pure rules are covered here - the live
// projectiles, graphics and hits need the running engine, so they are checked in-game.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const Fanatic = require('../plugins/bosses/ChaosFanatic.plugin.js');
const Crazy = require('../plugins/bosses/CrazyArchaeologist.plugin.js');

const dialogues = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'definitions', 'npc-dialogues.json'), 'utf8'),
);

/** The transcript's lines for one variant, in order. */
function lines(npc, variant) {
  const steps = dialogues[npc].variants[variant];
  return steps.flatMap((step) => (step.type === 'random'
    ? step.options.flatMap((option) => option.steps.map((s) => s.npc))
    : [step.npc]));
}

const tileKey = (tile) => `${tile.x},${tile.y}`;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** A deterministic Misc.getRandom: returns 0..n. */
function seeded(seed) {
  let state = seed;
  return (n) => (state = (state * 1103515245 + 12345) & 0x7fffffff) % (n + 1);
}

// --- Chaos Fanatic

/** Enough of api.core for combatClass() to build its method class. */
function stubApi(core = {}) {
  class Graphic { constructor(id, height) { this.id = id; this.height = height; } }
  class Animation { constructor(id) { this.id = id; } }
  const base = {
    Animation, Graphic, CombatMethod: class {}, CombatType: {}, GraphicHeight: {},
    HitDamage: class {}, HitMask: {}, Item: class {}, Location: class {}, Misc: {},
    PendingHit: class {}, Projectile: class {}, Task: class {}, Flag: {},
    WeaponInterfaceManager: {}, TaskManager: {}, ...core,
  };
  return {
    core: base,
    getTaskManager: () => ({}),
    getBonusManager: () => ({}),
  };
}

test('Chaos Fanatic: ids, membership and wiring match the cache and the plugin contract', () => {
  assert.equal(Fanatic.name, 'ChaosFanatic');
  assert.equal(Fanatic.members, true);
  const calls = [];
  Fanatic.register({
    ...stubApi({ NpcIdentifiers: { CHAOS_FANATIC: 6619 } }),
    registerNpcCombatMethodProvider: (ids, ctor, options) => calls.push({ ids, ctor, options }),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ids, [6619]);
  assert.deepEqual(calls[0].options, { singleton: false });
  assert.equal(typeof calls[0].ctor, 'function');
});

test('Chaos Fanatic: 10/15 standard, 4/15 explosion, 1/15 disarm (Wiki)', () => {
  const { Attack, chooseAttack } = Fanatic._test;
  const outcomes = new Map();
  for (let roll = 0; roll < 15; roll++) {
    const { attack } = chooseAttack(0, roll);
    outcomes.set(attack, (outcomes.get(attack) ?? 0) + 1);
  }
  assert.equal(outcomes.get(Attack.DEFAULT_MAGIC_ATTACK), 10);
  assert.equal(outcomes.get(Attack.EXPLOSION), 4);
  assert.equal(outcomes.get(Attack.DISARM), 1);
});

test('Chaos Fanatic: an explosion is followed by 12 attacks of only standard red attacks', () => {
  const { Attack, chooseAttack } = Fanatic._test;
  const explosion = chooseAttack(0, 10);
  assert.equal(explosion.attack, Attack.EXPLOSION);
  assert.equal(explosion.cooldown, 12);
  let cooldown = explosion.cooldown;
  for (let attack = 0; attack < 12; attack++) {
    // Even a roll that would otherwise be a special is a standard attack in the cooldown.
    const next = chooseAttack(cooldown, 14);
    assert.equal(next.attack, Attack.DEFAULT_MAGIC_ATTACK);
    cooldown = next.cooldown;
  }
  assert.equal(cooldown, 0);
  assert.equal(chooseAttack(cooldown, 14).attack, Attack.DISARM, 'the roll is free again');
});

test('Chaos Fanatic: the explosion is three books, one on the player, all distinct', () => {
  const { explosionTiles } = Fanatic._test;
  const centre = { getX: () => 2979, getY: () => 3846 };
  for (let seed = 0; seed < 50; seed++) {
    const tiles = explosionTiles(centre, seeded(seed));
    assert.equal(tiles.length, 3);
    assert.deepEqual(tiles[0], [2979, 3846]);
    assert.equal(new Set(tiles.map(([x, y]) => `${x},${y}`)).size, 3);
    for (const [x, y] of tiles) {
      assert.ok(Math.abs(x - 2979) <= 1 && Math.abs(y - 3846) <= 1, `${x},${y} is beside the player`);
    }
  }
});

test('Chaos Fanatic: the explosion hits for up to 31 (Wiki infobox), not the standard 21', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'bosses', 'ChaosFanatic.plugin.js'), 'utf8');
  assert.match(source, /const EXPLOSION_MAX_HIT = 31;/);
});

test('Chaos Fanatic: his overhead lines are the NPC transcript exactly', () => {
  const { QUOTES } = Fanatic._test;
  assert.deepEqual([...QUOTES].sort(), [...lines('Chaos Fanatic', 'when-attacking-the-player')].sort());
  assert.ok(QUOTES.includes('Devilish Oxen Roll!!'), 'the transcript spells it Devilish');
});

// --- Crazy archaeologist

test('Crazy archaeologist: ids, membership and the death line wiring', () => {
  assert.equal(Crazy.name, 'CrazyArchaeologist');
  assert.equal(Crazy.members, true);
  const providers = [];
  let death;
  Crazy.register({
    ...stubApi({ NpcIdentifiers: { CRAZY_ARCHAEOLOGIST: 6618 } }),
    registerNpcCombatMethodProvider: (ids, ctor, options) => providers.push({ ids, ctor, options }),
    onNpcBeforeDeath: (handler) => { death = handler; },
  });
  assert.deepEqual(providers[0].ids, [6618]);
  assert.deepEqual(providers[0].options, { singleton: false });
  assert.equal(typeof death, 'function');

  const said = [];
  death({ npc: { getId: () => 6618, forceChat: (line) => said.push(line) } });
  death({ npc: { getId: () => 6619, forceChat: (line) => said.push(line) } });
  death({ npc: null });
  assert.deepEqual(said, ['Ow!']);
});

test('Crazy archaeologist: "Rain of knowledge!" and "Ow!" are the transcript lines', () => {
  assert.equal(Crazy._test.SPECIAL_SHOUT, lines('Crazy archaeologist', 'when-firing-his-special-attack')[0]);
  assert.equal(Crazy._test.DEATH_LINE, lines('Crazy archaeologist', 'when-dying')[0]);
});

test('Crazy archaeologist: three books, one on the player, all distinct and beside it', () => {
  const { initialSpecialTiles } = Crazy._test;
  const centre = { x: 2977, y: 3702 };
  for (let seed = 0; seed < 50; seed++) {
    const tiles = initialSpecialTiles(centre, seeded(seed));
    assert.equal(tiles.length, 3);
    assert.deepEqual(tiles[0], centre);
    assert.equal(new Set(tiles.map(tileKey)).size, 3);
    for (const tile of tiles) assert.ok(chebyshev(tile, centre) <= 1);
  }
});

test('Crazy archaeologist: one book splits into two more, never on an opening tile', () => {
  const { initialSpecialTiles, burstSpecialTiles } = Crazy._test;
  const centre = { x: 2977, y: 3702 };
  let state = 11;
  const random = (n) => (state = (state * 1103515245 + 12345) & 0x7fffffff) % (n + 1);
  const opened = initialSpecialTiles(centre, random);
  const burst = burstSpecialTiles(centre, opened, random);
  assert.equal(burst.length, 2);
  const taken = new Set(opened.map(tileKey));
  for (const tile of burst) {
    assert.ok(!taken.has(tileKey(tile)));
    assert.ok(chebyshev(tile, centre) <= 1);
  }
});

test('Crazy archaeologist: a book covers its own 3x3 and no further (Wiki)', () => {
  const { coversTile } = Crazy._test;
  const book = { x: 10, y: 10 };
  assert.equal(coversTile(book, { x: 10, y: 10 }), true);
  assert.equal(coversTile(book, { x: 9, y: 9 }), true);
  assert.equal(coversTile(book, { x: 11, y: 10 }), true);
  assert.equal(coversTile(book, { x: 12, y: 10 }), false);
  assert.equal(coversTile(book, { x: 10, y: 8 }), false);
});

test('Crazy archaeologist: the special rolls up to 24 (Wiki infobox), not 25', () => {
  assert.equal(Crazy._test.SPECIAL_MAX_HIT, 24);
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'bosses', 'CrazyArchaeologist.plugin.js'), 'utf8');
  assert.match(source, /Misc\.getRandom\(SPECIAL_MAX_HIT\)/);
});

test('Crazy archaeologist: the six combat lines are the transcript', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'bosses', 'CrazyArchaeologist.plugin.js'), 'utf8');
  for (const line of lines('Crazy archaeologist', 'randomly-said-when-in-combat')) {
    assert.ok(source.includes(JSON.stringify(line)), `missing ${line}`);
  }
});


// --- The specials, driven against fakes

/**
 * Core stubs for a combat method. Rolls come from a cycling counter, or are `fixed` (clamped to
 * the roll's range) when a test needs one particular outcome.
 */
function fakeCore(fixed = null) {
  let roll = 0;
  const sent = { projectiles: [], graphics: [], damage: [], tasks: [], anims: [], chats: [], delays: [] };
  class Location {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z ?? 0; }
    getX() { return this.x; }
    getY() { return this.y; }
    getZ() { return this.z; }
    getDistance(other) { return Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y)); }
    equals(other) { return this.x === other.x && this.y === other.y; }
  }
  const core = {
    Animation: class { constructor(id) { this.id = id; } getId() { return this.id; } },
    Graphic: class { constructor(id, height) { this.id = id; this.height = height; } },
    GraphicHeight: { HIGH: 1, MIDDLE: 2 },
    CombatMethod: class { attackSpeed() { return 2; } },
    CombatType: { MELEE: 'melee', RANGED: 'ranged', MAGIC: 'magic' },
    HitDamage: class { constructor(damage, mask) { this.damage = damage; this.mask = mask; } getDamage() { return this.damage; } },
    HitMask: { RED: 'red' },
    Item: class {},
    Location,
    Misc: {
      getRandom: (n) => {
        if (fixed !== null) return Math.min(fixed, n);
        // The first roll is 0 (so a test can force the special), then a seeded sequence.
        if (roll === 0) { roll += 1; return 0; }
        roll = (roll * 1103515245 + 12345) & 0x7fffffff;
        return roll % (n + 1);
      },
    },
    PendingHit: class { constructor(attacker, target, method, delay) { this.delay = delay; } },
    Projectile: class {
      constructor(...args) { this.args = args; }
      sendProjectile() { sent.projectiles.push(this.args); }
      static arrivalCycles() { return 45; }
      static ticksToLand() { return 2; }
      static createProjectile() { return { sendProjectile() {} }; }
    },
    Task: class { constructor(delay) { this.delay = delay; } stop() {} },
    TaskManager: { submit: (task) => sent.tasks.push(task) },
  };
  return { core, sent };
}

function fakeSides(core, npcTile, playerTile, sent) {
  const npc = {
    attributes: new Map(),
    isNpc: () => true,
    getAsNpc: () => npc,
    getAttribute: (key) => npc.attributes.get(key),
    setAttribute: (key, value) => npc.attributes.set(key, value),
    getId: () => 1,
    getLocation: () => new core.Location(npcTile[0], npcTile[1], 0),
    getPrivateArea: () => null,
    performAnimation: (animation) => sent.anims.push(animation.getId()),
    forceChat: (line) => sent.chats.push(line),
    getCombat: () => ({ setAttackDelay: (ticks) => sent.delays.push(ticks) }),
    getPlayersWithinDistance: () => [player],
  };
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    getLocation: () => new core.Location(playerTile[0], playerTile[1], 0),
    getPacketSender: () => ({
      sendGlobalGraphic: (graphic, location) => sent.graphics.push([graphic.id, location.getX(), location.getY()]),
    }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => sent.damage.push(...hits) }) }),
  };
  return { npc, player };
}

test('Chaos Fanatic: the explosion sends three books and hits the player for up to 31', () => {
  const { core, sent } = fakeCore(10);
  const Method = Fanatic._test.combatClass({ core, getTaskManager: () => core.TaskManager, getBonusManager: () => ({}) });
  const method = new Method();
  const { npc, player } = fakeSides(core, [2975, 3846], [2979, 3846], sent);
  method.start(npc, player);
  assert.equal(method.attack, Fanatic._test.Attack.EXPLOSION);
  assert.equal(sent.projectiles.filter((p) => p[3] === 551).length, 3, 'three green books');
  assert.deepEqual(sent.delays, [5], 'the explosion takes the next attack slot');
  const impact = sent.tasks.find((t) => t.delay === 4);
  assert.ok(impact, 'the impact is queued four ticks out');
  impact.execute();
  assert.equal(sent.graphics.length, 3);
  // Only the book on the player's own tile can hit them.
  assert.equal(sent.damage.length, 1);
  assert.ok(sent.damage[0].getDamage() <= 31);
  assert.equal(method.hits(npc, player), null, 'a special deals no direct hit');
});

test('Chaos Fanatic: the disarm is its own special, and a full inventory has nothing taken', () => {
  const { core, sent } = fakeCore(14);
  const Method = Fanatic._test.combatClass({ core, getTaskManager: () => core.TaskManager, getBonusManager: () => ({}) });
  const method = new Method();
  const { npc, player } = fakeSides(core, [2975, 3846], [2979, 3846], sent);
  let inventoryFull = true;
  player.getInventory = () => ({ isFull: () => inventoryFull });
  method.start(npc, player);
  assert.equal(method.attack, Fanatic._test.Attack.DISARM);
  assert.equal(sent.projectiles.filter((p) => p[3] === 551).length, 1, 'one green projectile');
  const impact = sent.tasks.find((t) => t.delay === 4);
  assert.ok(impact);
  impact.execute();
  assert.deepEqual(sent.damage, [], 'no damage: the disarm deals none');
  // Nothing to take from a full inventory, so it never reaches the equipment.
  assert.equal(sent.delays.length, 0, 'the disarm takes the normal attack slot');
  assert.equal(method.hits(npc, player), null);
});

test('Crazy archaeologist: the special throws three books, then a 3x3 burst from the centre', () => {
  const { core, sent } = fakeCore();
  const Method = Crazy._test.combatClass({ core, getTaskManager: () => core.TaskManager });
  const method = new Method();
  const { npc, player } = fakeSides(core, [2973, 3702], [2977, 3702], sent);
  method.start(npc, player);
  assert.equal(method.attack, Crazy._test.Attack.SPECIAL_ATTACK);
  assert.equal(sent.chats.at(-1), 'Rain of knowledge!');
  const books = sent.projectiles.filter((p) => p[3] === 1260);
  assert.equal(books.length, 3);
  const impact = sent.tasks.find((t) => t.delay === 4);
  assert.ok(impact);
  impact.execute();
  assert.equal(sent.graphics.length, 3, 'each book explodes over its own 3x3');
  // Every book lands beside the player, so every 3x3 covers their tile: the Wiki's burst damage.
  assert.equal(sent.damage.length, 3);
  for (const hit of sent.damage) assert.ok(hit.getDamage() <= 24);
  const burst = sent.projectiles.filter((p) => p[3] === 1260).slice(3);
  assert.equal(burst.length, 2, 'the centre book splits into two more');
  const second = sent.tasks.find((t) => t.delay === 2);
  assert.ok(second);
  second.execute();
  assert.equal(sent.graphics.length, 5);
  assert.deepEqual(method.hits(npc, player), [], 'a special deals no direct hit');
});
