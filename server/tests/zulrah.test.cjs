// Run after `yarn build`: node --test tests/zulrah.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { CombatRange } = require('../dist/game/content/combat/CombatRange');
const { MeleeCombatMethod } = require('../dist/game/content/combat/method/impl/MeleeCombatMethod');
const Shared = require('../plugins/bosses/zulrah/Shared.Zulrah');
const Rotations = require('../plugins/bosses/zulrah/Rotations.Zulrah');
const Fight = require('../plugins/bosses/zulrah/Fight.Zulrah');
const Hazards = require('../plugins/bosses/zulrah/Hazards.Zulrah');
const Shrine = require('../plugins/bosses/zulrah/Shrine.Zulrah');
const Access = require('../plugins/bosses/zulrah/Access.Zulrah');
const NpcDrops = require('../plugins/npcs/NpcDrops.plugin');

const hooks = { objects: {}, npcs: {}, prompts: [], custom: {}, attack: [], drops: [], death: [], npcDeath: [], emitted: [], questStages: new Map() };
let nextIndex = 1;

function fakeNpc(id, x, y) {
  const npc = {
    id, index: nextIndex++, location: new Location(x, y, 0), hp: 500, registered: true, anims: [], transform: -1,
    flags: new Set(), target: null, facing: null,
    getId: () => (npc.transform !== -1 ? npc.transform : id),
    getIndex: () => npc.index,
    getLocation: () => npc.location,
    getAsPlayer: () => null,
    moveTo(location) { npc.location = location; },
    getSize: () => (Shared.FORM_IDS.has(id) ? 5 : 1),
    getHitpoints: () => npc.hp,
    setHitpoints(value) { npc.hp = value; },
    isRegistered: () => npc.registered,
    isPlayer: () => false,
    isNpc: () => true,
    getAsNpc: () => npc,
    setArea() {},
    getPrivateArea: () => null,
    setFlag(flag) { npc.flags.add(flag); },
    setNpcTransformationId(value) { npc.transform = value; },
    setMobileInteraction(mobile) { npc.facing = mobile; },
    getInteractingMobile: () => npc.facing,
    performAnimation(animation) { npc.anims.push(animation.getId()); },
    getMovementQueue: () => ({ setBlockMovement() {} }),
    getCombat: () => ({
      attack(target) { npc.target = target; },
      getTarget: () => npc.target,
      setAttackDelay() {},
      getLastAttack: () => ({ reset() {} }),
      getHitQueue: () => ({ addPendingDamage: (hits) => { npc.hp -= hits.reduce((sum, hit) => sum + hit.getDamage(), 0); } }),
    }),
  };
  return npc;
}

function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    registerNpcCombatMethodProvider() {},
    onPlayerLogin() {},
    onObjectInteraction: (name, actions) => {
      if (typeof name === 'function') (hooks.objects.any ??= []).push(name);
      else hooks.objects[name] = actions;
    },
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onItemAction: () => {},
    onNpcDeath: (handler) => hooks.npcDeath.push(handler),
    onCustomEvent: (name, handler) => (hooks.custom[name] ??= []).push(handler),
    emitCustomEvent: (name, payload) => {
      if (name === 'quest:get-stage' && hooks.questStages.has(payload.key)) payload.stage = hooks.questStages.get(payload.key);
      hooks.emitted.push([name, payload]);
      for (const fn of hooks.custom[name] ?? []) fn(payload);
    },
    onNpcDialogueCondition: (fn) => { hooks.condition = fn; },
    onNpcHitModify() {},
    onCanAttack: (handler) => hooks.attack.push(handler),
    onPlayerDeathItemDrop: (handler) => hooks.drops.push(handler),
    onPlayerDeath: (handler) => hooks.death.push(handler),
    registerCommand() {},
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    spawnNpc: ({ id, x, y }) => fakeNpc(id, x, y),
    removeNpc: (npc) => { npc.registered = false; },
  };
}

function fakeInventory() {
  const items = new Map();
  let slots = 28;
  return {
    items,
    setFreeSlots(value) { slots = value; },
    getFreeSlots: () => slots,
    contains: (id) => items.has(id),
    getAmount: (id) => items.get(id) ?? 0,
    getAddableAmount: (item) => Math.min(item.getAmount(), 2147483647 - (items.get(item.getId()) ?? 0)),
    add(item) {
      if (!items.has(item.getId())) slots--;
      items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount());
    },
    delete(id, amount) { items.set(id, (items.get(id) ?? 0) - amount); },
    refreshItems() {},
  };
}

function fakePlayer() {
  const attributes = new Map();
  const varbits = new Map();
  const inventory = fakeInventory();
  const p = {
    location: new Location(2213, 3056, 0), area: null, messages: [], statements: [], damage: [], target: null,
    dialogueActive: true, hp: 99, inventory,
    isPlayer: () => true,
    isNpc: () => false,
    getIndex: () => 7,
    getAsPlayer: () => p,
    isRegistered: () => true,
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    getArea: () => p.area,
    setArea(area) { p.area = area; },
    getPrivateArea: () => p.area,
    getHitpoints: () => p.hp,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    sendMessage: (message) => p.messages.push(message),
    getDialogueManager: () => ({ isActive: () => p.dialogueActive, startDialogues: (chain) => p.statements.push(chain) }),
    getCombat: () => ({
      getTarget: () => p.target,
      reset() { p.target = null; },
      getHitQueue: () => ({ addPendingDamage: (hits) => p.damage.push(...hits.map((hit) => hit.getDamage())) }),
    }),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        getVarbit: (id) => varbits.get(id) ?? 0,
        getVarp: () => 0,
        sendSubInterface: () => sender,
      };
      return sender;
    },
  };
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

before(async () => {
  await CachePipeline.initialize();
  RegionManager.init();
  ObjectDefinition.init();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  // The Wiki's Regicide requirement: boarding fixtures have reached Port Tyras unless a test says otherwise.
  hooks.questStages.set('regicide', 15);
  const api = fakeApi();
  Access.attach(api);
  Shrine(api);
});

function meleePlayer(id, x, y) {
  const items = [];
  items[Equipment.WEAPON_SLOT] = { getId: () => id };
  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getLocation: () => new Location(x, y, 0),
    getSize: () => 1,
    getPrivateArea: () => null,
    getCombat: () => null,
    getEquipment: () => ({ getItems: () => items }),
    getWeapon: () => ItemDefinition.forId(id).getWeaponInterface(),
  };
  return player;
}

test('dragon, crystal and noxious halberds reach Zulrah across the actual swamp collision', () => {
  const method = new MeleeCombatMethod();
  for (const id of [ItemIdentifiers.DRAGON_HALBERD, ItemIdentifiers.CRYSTAL_HALBERD, ItemIdentifiers.NOXIOUS_HALBERD]) {
    for (const [name, { spawn }] of Object.entries(Shared.POSITION)) {
      const zulrah = fakeNpc(Shared.NPC.GREEN, spawn.x, spawn.y);
      let checked = 0;
      for (let x = spawn.x - 2; x <= spawn.x + 6; x++) {
        for (let y = spawn.y - 2; y <= spawn.y + 6; y++) {
          const distance = Math.max(0, spawn.x - x, x - (spawn.x + 4), spawn.y - y, y - (spawn.y + 4));
          if (distance < 1 || distance > 2 || (RegionManager.getClipping(x, y, 0, null) & RegionManager.BLOCKED_MASK) !== 0) continue;
          const player = meleePlayer(id, x, y);
          assert.equal(method.attackDistance(player), 2, `${id} has halberd reach`);
          assert.equal(CombatRange.canReach(player, method, zulrah), true, `${id}, ${name}, tile ${x},${y}`);
          checked++;
        }
      }
      assert.ok(checked > 0, `${name} has walkable attack tiles`);
    }
  }
});

test('extended melee crosses low obstacles but respects projectile walls, range and unknown tiles', (t) => {
  const method = new MeleeCombatMethod();
  const player = meleePlayer(ItemIdentifiers.DRAGON_HALBERD, 100, 100);
  const target = fakeNpc(Shared.NPC.SNAKELING_MELEE, 102, 100);
  let clip = 0;
  t.mock.method(RegionManager, 'getClipping', (x, y) => x === 101 && y === 100 ? clip : 0);
  assert.equal(CombatRange.canReach(player, method, target), true, 'open ground');
  clip = RegionManager.BLOCKED_TILE | 0x100;
  assert.equal(CombatRange.canReach(player, method, target), true, 'water and low solid objects');
  for (const blocked of [RegionManager.PROJECTILE_TILE_BLOCKED, RegionManager.PROJECTILE_WEST_BLOCKED,
    RegionManager.UNKNOWN, RegionManager.UNLOADED_TILE]) {
    clip = blocked;
    assert.equal(CombatRange.canReach(player, method, target), false, `blocked by ${blocked.toString(16)}`);
  }
  clip = 0;
  target.moveTo(new Location(103, 100, 0));
  assert.equal(CombatRange.canReach(player, method, target), false, 'three tiles away');
  target.moveTo(new Location(102, 100, 1));
  assert.equal(CombatRange.canReach(player, method, target), false, 'another plane');
  target.moveTo(new Location(100, 100, 0));
  assert.equal(CombatRange.canReach(player, method, target), false, 'overlapping');
});

test('ordinary melee still needs an open cardinal edge', (t) => {
  const method = new MeleeCombatMethod();
  const player = meleePlayer(ItemIdentifiers.DRAGON_SCIMITAR, 100, 100);
  const target = fakeNpc(Shared.NPC.SNAKELING_MELEE, 101, 100);
  let clip = 0;
  t.mock.method(RegionManager, 'getClipping', (x) => x === 101 ? clip : 0);
  assert.equal(method.attackDistance(player), 1);
  assert.equal(CombatRange.canReach(player, method, target), true);
  clip = 0x80;
  assert.equal(CombatRange.canReach(player, method, target), false, 'west wall blocks the shared edge');
  clip = 0;
  target.moveTo(new Location(101, 101, 0));
  assert.equal(CombatRange.canReach(player, method, target), false, 'diagonal contact');
  target.moveTo(new Location(102, 100, 0));
  assert.equal(CombatRange.canReach(player, method, target), false, 'outside ordinary melee reach');
});

// ------------------------------------------------------------------ rotations

/** The Wiki's rotation overview, phase by phase: place, form and the steps' kinds and counts. */
const WIKI = [
  ['middle red melee', 'middle blue magic4', 'south green ranged5 S S C C S S', 'middle red melee', 'west blue magic5',
    'south green C C C S S S S', 'south blue magic5 S C S C S', 'west green jad-ranged10 C C C C', 'middle red melee'],
  ['middle red melee', 'middle blue magic4', 'west green C C C S S S S', 'south blue magic5 S S C C S S', 'middle red melee',
    'east green ranged5', 'south blue magic5 S C S C S', 'west green jad-ranged10 C C C C', 'middle red melee'],
  ['east green ranged5 S S S', 'middle red C S C S C S melee', 'west blue magic5', 'south green ranged5', 'east blue magic5',
    'middle green C C C S S S', 'west green ranged5', 'middle blue magic5 C C S S S', 'east green jad-magic10', 'middle blue S S S S'],
  ['east blue S S S S magic6', 'south green ranged4 C C', 'west blue S S S S magic4', 'middle red melee C C', 'east green ranged4',
    'south green S S S S S S C C C', 'west blue magic5 S S S S', 'middle green ranged4', 'middle blue magic4 C C C',
    'east green jad-magic8', 'middle blue S S S S'],
];

function describe(phase) {
  const steps = phase.steps.map(([kind, ...args]) => {
    if (kind === 'clouds') return 'C';
    if (kind === 'snakeling') return 'S';
    if (kind === 'jad') return `jad-${args[0]}${args[1]}`;
    if (kind === 'melee') return 'melee';
    return `${kind}${args[0]}`;
  });
  return [phase.at, phase.form, ...steps].join(' ');
}

test('the four rotations follow the Wiki phase by phase', () => {
  Rotations.ROTATIONS.forEach((phases, index) => {
    assert.deepEqual(phases.map(describe), WIKI[index], `rotation ${index + 1}`);
  });
  assert.equal(describe(Rotations.OPENING), 'middle green C C C C', 'the fight opens with four barrages');
  assert.equal(describe(Rotations.CLOSING), 'middle green ranged5 C C C C', 'every rotation ends with ranged and barrages');
});

test('the fight opens, runs a rotation, closes it and picks the next', () => {
  const picks = [2, 0];
  const cursor = new Rotations.PhaseCursor(() => picks.shift());
  assert.equal(cursor.next(), Rotations.OPENING);
  const rotation3 = Rotations.ROTATIONS[2];
  for (const phase of rotation3) assert.equal(cursor.next(), phase);
  assert.equal(cursor.next(), Rotations.CLOSING);
  assert.equal(cursor.next(), Rotations.ROTATIONS[0][0], 'then the next rotation from its second phase');
});

test('every cloud and snakeling reaches the shrine island', () => {
  const walkable = (x, y) => (RegionManager.getClipping(x, y, 0, null) & RegionManager.BLOCKED_MASK) === 0;
  const touches = (x, y) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => walkable(x + dx, y + dy)));
  const phases = [Rotations.OPENING, Rotations.CLOSING, ...Rotations.ROTATIONS.flat()];
  for (const phase of phases) {
    for (const [kind, tiles] of phase.steps) {
      // Some of Near-Reality's tiles sit on the shore by the island's tips; a cloud there still
      // covers the tip, and a snakeling there is one of the stuck ones the Wiki mentions.
      if (kind === 'snakeling') assert.ok(touches(...tiles), `snakeling at ${tiles}`);
      if (kind === 'clouds') {
        assert.ok(touches(tiles[0], tiles[1]), `cloud at ${tiles.slice(0, 2)}`);
        assert.ok(touches(tiles[2], tiles[3]), `cloud at ${tiles.slice(2)}`);
      }
    }
  }
  assert.ok(walkable(Shared.PLAYER_START.x, Shared.PLAYER_START.y), 'the boat leaves the player on the island');
});

test('Zulrah can see the island from each of its four places', () => {
  const zulrah = { getSize: () => 5, isPlayer: () => false, getLocation: null, getPrivateArea: () => null };
  for (const [name, position] of Object.entries(Shared.POSITION)) {
    zulrah.getLocation = () => new Location(position.spawn.x, position.spawn.y, 0);
    let seen = 0;
    let total = 0;
    for (let x = 2262; x <= 2274; x++) {
      for (let y = 3068; y <= 3078; y++) {
        if ((RegionManager.getClipping(x, y, 0, null) & RegionManager.BLOCKED_MASK) !== 0) continue;
        total++;
        const player = { getLocation: () => new Location(x, y, 0), isPlayer: () => true, getSize: () => 1, getPrivateArea: () => null };
        if (RegionManager.canProjectileAttackTarget(zulrah, player)) seen++;
      }
    }
    assert.ok(seen / total > 0.6, `${name}: sees ${seen} of ${total} tiles`);
  }
});

// ------------------------------------------------------------------ the fight

function startedFight(options = {}) {
  const player = fakePlayer();
  const fight = Fight.start(player, { random: () => 0.99, ...options });
  return { player, fight };
}

test('Zulrah rises once the boat dialogue is gone, and opens with its barrages', () => {
  const { player, fight } = startedFight({ rotation: 0 });
  assert.deepEqual([player.location.getX(), player.location.getY()], [2268, 3068]);
  ticks(3);
  assert.equal(fight.zulrah, null, 'still waiting while the dialogue is open');
  const log = [];
  fight.spitClouds = (tiles) => { log.push([fight.ticks, 'clouds', tiles.join(',')]); return 3; };
  fight.attack = (style) => { log.push([fight.ticks, style]); return 3; };
  fight.aimTail = () => log.push([fight.ticks, 'aim']);
  fight.strikeTail = () => log.push([fight.ticks, 'strike']);
  player.dialogueActive = false;
  ticks(1);
  const rose = fight.ticks;
  assert.equal(fight.zulrah.getId(), Shared.NPC.GREEN);
  assert.ok(fight.zulrah.anims.includes(Fight.ANIM.SPAWN));
  assert.equal(fight.zulrah.facing, player, 'it faces the player from the start');
  assert.equal(fight.attackable, false, 'not while rising');
  fight.zulrah.facing = null;
  ticks(9);
  assert.equal(fight.attackable, true);
  assert.equal(fight.zulrah.facing, player, 'and keeps facing them through the barrages');
  assert.deepEqual(log[0], [rose + 9, 'clouds', '2269,3069,2272,3070'], 'first barrage 9 ticks after rising');
  ticks(9);
  assert.deepEqual(log.map((entry) => entry[0] - rose), [9, 12, 15, 18], 'a barrage every 3 ticks');
  // Dives 3 ticks after the last barrage, resurfaces red in the middle 3 ticks later.
  ticks(3);
  assert.ok(fight.zulrah.anims.includes(Fight.ANIM.DIVE));
  assert.equal(fight.attackable, false, 'not under the swamp');
  ticks(3);
  assert.equal(fight.zulrah.getId(), Shared.NPC.RED, 'moved and changed under the swamp');
  assert.ok(!fight.zulrah.anims.includes(Fight.ANIM.RISE), 'a teleported NPC is out of view that tick');
  ticks(1);
  assert.ok(fight.zulrah.anims.includes(Fight.ANIM.RISE), 'it rises the tick after, back in view');
  assert.equal(fight.zulrah.facing, player, 'facing the player');
  ticks(3);
  assert.deepEqual(log.slice(4).map((entry) => [entry[0] - rose, entry[1]]), [[28, 'aim']], 'the tail is aimed 4 ticks after rising');
  ticks(15);
  assert.deepEqual(log.slice(4).map((entry) => [entry[0] - rose, entry[1]]), [[28, 'aim'], [33, 'strike'], [37, 'aim'], [43, 'strike']]);
  fight.end();
});

test('the tail hits the aimed tile and its neighbours, but not two tiles away or beside a pillar', () => {
  const { player, fight } = startedFight();
  fight.zulrah = fakeNpc(Shared.NPC.RED, 2266, 3073);
  let whipped = 0;
  fight.whip = () => whipped++;
  const strikeAt = (aim, stand) => {
    player.location = new Location(...aim, 0);
    fight.aimTail();
    player.location = new Location(...stand, 0);
    fight.strikeTail();
  };
  strikeAt([2268, 3069], [2268, 3069]);
  assert.equal(whipped, 1, 'standing still');
  strikeAt([2268, 3069], [2269, 3070]);
  assert.equal(whipped, 2, 'one tile away');
  strikeAt([2268, 3069], [2270, 3069]);
  assert.equal(whipped, 2, 'two tiles away is safe (Wiki)');
  strikeAt([2264, 3072], [2264, 3072]);
  assert.equal(whipped, 2, 'the pillar safespot');
  fight.cursor.rotation = 0;
  player.location = new Location(2274, 3077, 0);
  fight.aimTail();
  fight.strikeTail(true);
  assert.equal(whipped, 2, 'rotations 1 and 2: the first swing misses the north-east tip');
  fight.strikeTail(false);
  assert.equal(whipped, 3, 'the second does not');
  fight.end();
});

test('the tail throws the player back, away from Zulrah and onto the island', () => {
  const { player, fight } = startedFight();
  fight.zulrah = fakeNpc(Shared.NPC.RED, 2266, 3073);
  player.location = new Location(2268, 3069, 0);
  const destination = fight.knockbackTile(player);
  assert.ok(destination.getY() < 3069, 'pushed south, away from Zulrah');
  assert.ok((RegionManager.getClipping(destination.getX(), destination.getY(), 0, null) & RegionManager.BLOCKED_MASK) === 0, 'onto the island');
  fight.end();
});

test('Zulrah cannot be attacked under the swamp, by anyone else, or with melee but a halberd', () => {
  const { player, fight } = startedFight();
  player.dialogueActive = false;
  ticks(1);
  const zulrah = fight.zulrah;
  ticks(5);
  const event = { attacker: player, target: zulrah, allow: null };
  hooks.attack.forEach((handler) => handler(event));
  assert.equal(event.allow, null, 'up and attackable');
  player.target = zulrah;
  fight.dive();
  assert.equal(player.target, null, 'combat stops');
  const diving = { attacker: player, target: zulrah, allow: null };
  hooks.attack.forEach((handler) => handler(diving));
  assert.equal(diving.allow, false);
  fight.interactAt = 0;
  const { CombatType } = PluginManager.getCoreApi();
  const melee = (reach) => ({ type: () => CombatType.MELEE, attackDistance: () => reach });
  const sword = { attacker: player, target: zulrah, method: melee(1), allow: null };
  hooks.attack.forEach((handler) => handler(sword));
  assert.equal(sword.allow, false, 'melee does not reach it');
  assert.equal(player.messages.at(-1), "I can't reach that!");
  const halberd = { attacker: player, target: zulrah, method: melee(2), allow: null };
  hooks.attack.forEach((handler) => handler(halberd));
  assert.equal(halberd.allow, null, 'a halberd does (Wiki)');
  const intruder = { attacker: { ...fakePlayer() }, target: zulrah, allow: null };
  hooks.attack.forEach((handler) => handler(intruder));
  assert.equal(intruder.allow, false, 'nobody else');
  fight.end();
});

test('blue form mixes in Ranged; the Jad phase alternates from its first style', () => {
  const { fight } = startedFight({ random: () => 0.1 });
  const styles = [];
  fight.attack = (style) => { styles.push(style); return 3; };
  fight.expand(['magic', 3]).forEach((action) => action());
  assert.deepEqual(styles, ['ranged', 'ranged', 'ranged'], 'random below 0.3 is Ranged');
  styles.length = 0;
  fight.expand(['jad', 'magic', 4]).forEach((action) => action());
  assert.deepEqual(styles, ['magic', 'ranged', 'magic', 'ranged']);
  fight.end();
});

test('leaving the shrine ends the fight and takes everything with it', () => {
  const { player, fight } = startedFight();
  player.dialogueActive = false;
  ticks(1);
  const zulrah = fight.zulrah;
  const snakeling = fight.hazards.addSnakeling({ x: 2263, y: 3076 });
  fight.hazards.addCloud({ x: 2269, y: 3069 });
  fight.area.leave(player, false);
  assert.equal(fight.stage, 'ended');
  assert.equal(Fight.fightOf(player), null);
  assert.equal(zulrah.registered, false);
  assert.equal(snakeling.registered, false);
  assert.equal(fight.hazards.clouds.length, 0);
});

// ------------------------------------------------------------------ hazards

test('a cloud hurts 1-4 on its 3x3 tiles for 30 ticks', () => {
  const { player, fight } = startedFight();
  fight.hazards.addCloud({ x: 2269, y: 3069 });
  player.location = new Location(2270, 3070, 0);
  fight.hazards.tickClouds(player);
  assert.equal(player.damage.length, 1);
  assert.ok(player.damage[0] >= 1 && player.damage[0] <= 4);
  player.location = new Location(2271, 3070, 0);
  fight.hazards.tickClouds(player);
  assert.equal(player.damage.length, 1, 'two tiles from the centre is clear');
  for (let i = 0; i < 30; i++) fight.hazards.tickClouds(player);
  assert.equal(fight.hazards.clouds.length, 0, 'gone after 30 ticks');
  fight.end();
});

test('snakelings are melee or magic, attack the player, and die after 67 ticks or with Zulrah', () => {
  const { player, fight } = startedFight({ random: () => 0.1 });
  const magic = fight.hazards.addSnakeling({ x: 2263, y: 3076 });
  assert.equal(magic.getId(), Shared.NPC.SNAKELING_MAGIC);
  assert.equal(magic.target, player);
  fight.random = () => 0.9;
  const melee = fight.hazards.addSnakeling({ x: 2263, y: 3073 });
  assert.equal(melee.getId(), Shared.NPC.SNAKELING_MELEE);
  for (let i = 0; i < 66; i++) fight.hazards.tickSnakelings(player);
  assert.ok(magic.hp > 0);
  fight.hazards.tickSnakelings(player);
  assert.ok(magic.hp <= 0, 'gone after 40 seconds');
  const late = fight.hazards.addSnakeling({ x: 2273, y: 3075 });
  fight.hazards.clearOnDeath();
  assert.ok(late.hp <= 0, 'dies with Zulrah');
  fight.end();
});

// ------------------------------------------------------------------ the shrine

test('hits on Zulrah above 50 become 45-50', () => {
  const { fight } = startedFight();
  const npc = fakeNpc(Shared.NPC.GREEN, 2266, 3073);
  npc.__zulrahFight = fight;
  const parts = [70, 50, 12].map((damage) => ({ damage, getDamage() { return this.damage; }, setDamage(value) { this.damage = value; } }));
  let updated = false;
  Shrine.capDamage({ npc, hit: { getHits: () => parts, updateTotalDamage: () => { updated = true; } } });
  assert.ok(parts[0].damage >= 45 && parts[0].damage <= 50);
  assert.deepEqual(parts.slice(1).map((part) => part.damage), [50, 12]);
  assert.ok(updated);
  fight.end();
});

test('a kill counts, times the fight, drops the loot under the player and leaves the scroll', () => {
  const { player, fight } = startedFight();
  player.dialogueActive = false;
  ticks(1);
  ticks(20);
  const zulrah = fight.zulrah;
  const loot = { npc: zulrah, location: zulrah.getLocation() };
  hooks.custom['npc-drops:location'].forEach((handler) => handler(loot));
  assert.ok(loot.location.equals(player.getLocation()), 'loot under the player');
  hooks.npcDeath.forEach((handler) => handler({ npc: zulrah, killer: player }));
  assert.equal(player.getAttribute(Shared.ATTR.KILLS), 1);
  assert.match(player.messages.at(-2), /Your Zulrah kill count is: <col=ff0000>1<\/col>/);
  assert.match(player.messages.at(-1), /Fight duration: <col=ff0000>0:12\.00<\/col> \(new personal best\)/);
  assert.equal(fight.teleport.getId(), Shared.OBJECT.TELEPORT);
  assert.ok(!fight.teleport.getLocation().equals(player.getLocation()), 'beside the player');
  fight.end();
});

test('Zul-Gwenwynig holds what a shrine death would drop, and the boat waits until it is collected', () => {
  const { Item } = PluginManager.getCoreApi();
  const { player, fight } = startedFight();
  player.location = new Location(2268, 3070, 0);
  const drop = (item, eligible = true) => {
    const event = { player, item, dropEligible: eligible, shouldDropItems: true, handled: false };
    hooks.drops.forEach((handler) => handler(event));
    return event.handled;
  };
  assert.equal(drop(new Item(4151, 1)), true);
  assert.equal(drop(new Item(560, 250)), true);
  assert.equal(drop(new Item(1, 1), false), false, 'what is lost anyway stays lost');
  hooks.death.forEach((handler) => handler({ player }));
  assert.match(player.messages.at(-1), /Priestess Zul-Gwenwynig has retrieved some of your items/);
  fight.end();
  player.location = new Location(2213, 3056, 0);
  hooks.prompts.length = 0;
  Shrine.quickBoard({ player });
  assert.equal(Fight.fightOf(player), null, 'the boat refuses');
  Shrine.collect({ player });
  assert.equal(player.inventory.getAmount(4151), 1);
  assert.equal(player.inventory.getAmount(560), 250);
  assert.equal(player.getAttribute(Shared.ATTR.RETRIEVAL), null);
});

test('after 50 kills reclaiming costs 100,000 coins; dying elsewhere first loses the items', () => {
  const { Item } = PluginManager.getCoreApi();
  const player = fakePlayer();
  player.setAttribute(Shared.ATTR.KILLS, 50);
  player.setAttribute(Shared.ATTR.RETRIEVAL, { items: [[4151, 1]], paid: false });
  Shrine.collect({ player });
  assert.equal(player.inventory.getAmount(4151), 0, 'no coins, no items');
  player.inventory.add(new Item(995, 150000));
  Shrine.collect({ player });
  assert.equal(player.inventory.getAmount(4151), 1);
  assert.equal(player.inventory.getAmount(995), 50000);
  player.setAttribute(Shared.ATTR.RETRIEVAL, { items: [[4151, 1]], paid: false });
  hooks.drops.forEach((handler) => handler({ player, item: new Item(995, 1), dropEligible: true, shouldDropItems: true, handled: false }));
  assert.equal(player.getAttribute(Shared.ATTR.RETRIEVAL), null, 'an unsafe death elsewhere loses them');
});

test('the boat asks first; Quick-Board goes straight to the shrine', () => {
  const player = fakePlayer();
  player.setAttribute('zulrah:access', 3);
  hooks.prompts.length = 0;
  Shrine.board({ player });
  assert.equal(hooks.prompts.at(-1).title, "Return to Zulrah's shrine?");
  Shrine.quickBoard({ player });
  ticks(2);
  const fight = Fight.fightOf(player);
  assert.ok(fight, 'on the shrine');
  assert.ok(Shared.inShrine(player.getLocation()));
  fight.end();
});

test('the pier boat and priestess show their full options with the access varbit', () => {
  const player = fakePlayer();
  const sender = player.getPacketSender();
  assert.equal(ObjectDefinition.forPlayer(10068, player).getName(), 'Sacrificial boat');
  sender.sendVarbit(Shared.ACCESS_VARBIT, 3);
  assert.deepEqual(ObjectDefinition.forPlayer(10068, player).getInteractions().filter(Boolean), ['Board', 'Quick-Board']);
});

test('a Zul-andra teleport scroll is used up taking the player to Zul-Andra', () => {
  const { Item, TeleportHandler } = PluginManager.getCoreApi();
  const player = fakePlayer();
  player.inventory.add(new Item(12938, 4));
  const teleports = [];
  const { checkReqs, teleport } = TeleportHandler;
  TeleportHandler.checkReqs = () => true;
  TeleportHandler.teleport = (who, location, type) => teleports.push([location.getX(), location.getY(), type.getStartAnimation().getId()]);
  try {
    Shrine.readScroll({ player, itemId: 12938 });
  } finally {
    Object.assign(TeleportHandler, { checkReqs, teleport });
  }
  assert.deepEqual(teleports, [[2196, 3056, 3864]]);
  assert.equal(player.inventory.getAmount(12938), 3);
});

test('logging in on the shrine with no fight left puts the player back at the pier', () => {
  const player = fakePlayer();
  player.location = new Location(2268, 3070, 0);
  Shrine.returnFromShrine({ player });
  assert.deepEqual([player.location.getX(), player.location.getY()], [Shared.PIER.x, Shared.PIER.y]);
});

test('Zul-Gwenwynig hands held items back on Talk-to; otherwise her transcript plays', () => {
  const player = fakePlayer();
  assert.equal(Shrine.talkTo({ player }), false, 'nothing held: handed to her transcript (no dialogue plugin here to play it)');
  player.setAttribute(Shared.ATTR.RETRIEVAL, { items: [[4151, 1]], paid: false });
  assert.equal(Shrine.talkTo({ player }), true);
  assert.equal(player.statements.length, 1);
});

// ------------------------------------------------------------------ drops

test('Zulrah rolls its table twice a kill, and its scales always', () => {
  NpcDrops.__internals.loadDrops();
  const table = NpcDrops.__internals.tablesByNpc.get(Shared.NPC.GREEN)[0];
  assert.equal(table.rolls, 2);
  let twoRolls = 0;
  for (let i = 0; i < 200; i++) {
    const drops = NpcDrops.__internals.rollTable(table, fakePlayer(), null);
    assert.ok(drops.some((drop) => drop.itemId === 12934), 'scales every kill');
    if (drops.length >= 3) twoRolls++;
  }
  assert.ok(twoRolls > 180, `two main-table drops on most kills (${twoRolls}/200)`);
});

// ------------------------------------------------------------------ access (rsprox 234/03276)

const named = (name) => ({ getName: () => name });
/** A line as NpcDialogues emits it while building the chain; `before` runs when its page is reached. */
const line = (player, speaker, text) => {
  const request = { player, definition: named(speaker), text };
  for (const fn of hooks.custom['npc-dialogue:line'] ?? []) fn(request);
  request.before?.();
  return request;
};
const choose = (player, speaker, option) => { for (const fn of hooks.custom['npc-dialogue:choice'] ?? []) fn({ player, definition: named(speaker), option }); };

test("access starts at 0: the boat is refused with the priestess's own transcript, and the varbit is 0", () => {
  const player = fakePlayer();
  hooks.emitted.length = 0;
  assert.equal(Shrine.board({ player }), true);
  const start = hooks.emitted.find(([name]) => name === 'npc-dialogue:start');
  assert.ok(start, 'her transcript plays');
  assert.equal(start[1].variant, Access.VARIANT.priestess.board);
  assert.equal(Fight.fightOf(player) ?? null, null, 'not rowed out');
  assert.equal(Access.stageOf(player), 0);
});

test('the Port Tyras gate is checked too: before Regicide stage 10 the boat is refused past the High Priestess, never with the sailing transcript', () => {
  const player = fakePlayer();
  hooks.questStages.set('regicide', 9);
  try {
    player.setAttribute('zulrah:access', 2);
    hooks.emitted.length = 0;
    assert.equal(Shrine.quickBoard({ player }), true);
    let start = hooks.emitted.find(([name]) => name === 'npc-dialogue:start');
    assert.ok(start, 'the priestess refuses');
    assert.equal(start[1].variant, Access.VARIANT.priestess.board, 'not accepted: that transcript ends in the ritual');
    assert.equal(Fight.fightOf(player) ?? null, null, 'not rowed out');

    player.setAttribute('zulrah:access', 3);
    hooks.emitted.length = 0;
    Shrine.quickBoard({ player });
    start = hooks.emitted.find(([name]) => name === 'npc-dialogue:start');
    assert.equal(start[1].variant, Access.VARIANT.priestess.board, 'still refused past the High Priestess');
    assert.equal(Fight.fightOf(player) ?? null, null);

    // Her "Yes." menu emits the sail event directly; that must not get around the gate either.
    player.dialogueActive = false;
    for (const fn of hooks.custom[Access.SAIL_EVENT] ?? []) fn({ player });
    ticks(2);
    assert.equal(Fight.fightOf(player) ?? null, null, 'no sailing past the gate');
  } finally {
    hooks.questStages.set('regicide', 15);
  }
  Shrine.quickBoard({ player });
  ticks(2);
  const fight = Fight.fightOf(player);
  assert.ok(fight, 'with Regicide played to Port Tyras the stage-3 boat sails');
  fight.end();
});

test('the real Regicide quest allows boarding at the Port Tyras milestone (stage 10), not only on completion', () => {
  const { ObjectIdentifiers } = PluginManager.getCoreApi();
  const events = new Map();
  let interact = null;
  const base = {
    core: PluginManager.getCoreApi(),
    onCustomEvent: (name, handler) => (events.get(name) ?? events.set(name, []).get(name)).push(handler),
    emitCustomEvent: (name, payload) => { for (const handler of events.get(name) ?? []) handler(payload); },
    onObjectInteraction: (handler) => { interact = handler; },
    persistAttribute() {},
  };
  const api = new Proxy(base, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require('../plugins/quests/quests/Regicide.Quest')(api);
  const regicide = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((quest) => quest.key === 'regicide');
  assert.ok(regicide, 'the real Regicide quest is registered');

  const attributes = new Map();
  let sender;
  sender = new Proxy({}, { get: (_target, key) => (key === 'getVarbit' ? () => 0 : () => sender) });
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getLocation: () => new Location(2303, 3214, 0),
    moveTo() {},
    sendMessage() {},
  };

  // Reach the camp the way Regicide does: stage 9, then the dense forest crossing sets stage 10.
  regicide.setStage(player, 9);
  interact({ player, objectId: ObjectIdentifiers.DENSE_FOREST_4, location: { x: 2303, y: 3214, z: 0 }, handled: false });
  assert.equal(regicide.getStage(player), 10, 'the crossing is the Port Tyras milestone');
  assert.equal(regicide.isComplete(player), false, 'Regicide is still unfinished');

  const previous = Shared.api();
  Shared.bind(api);
  try {
    player.setAttribute('zulrah:access', 3);
    for (const stage of [10, 12, 14, 15]) {
      regicide.setStage(player, stage);
      const query = { player, key: 'regicide', stage: 0 };
      api.emitCustomEvent('quest:get-stage', query);
      assert.equal(query.stage, stage, `the runtime answers stage ${stage}`);
      assert.equal(Access.refuseBoarding(player), false, `stage ${stage} boards`);
    }
    regicide.setStage(player, 9);
    assert.equal(Access.refuseBoarding(player), true, 'pre-milestone boarding is refused');
  } finally {
    Shared.bind(previous);
  }
});

test("the recorded lines move the stage: told 1, accepted 2, and the ritual's last line rows the player out (3)", () => {
  const player = fakePlayer();
  assert.equal(Access.chooseVariant({ player, definition: named('High Priestess Zul-Harcinqa') }), Access.VARIANT.highPriestess.first, 'first meeting: the recorded opening');
  line(player, 'High Priestess Zul-Harcinqa', 'All he asks in return is a periodic sacrifice at his sacred shrine.');
  assert.equal(Access.stageOf(player), 1);
  assert.equal(Access.chooseVariant({ player, definition: named('High Priestess Zul-Harcinqa') }), Access.VARIANT.highPriestess.before);
  line(player, 'High Priestess Zul-Harcinqa', '... and I accept. You shall be our next sacrifice. Board the boat when you are ready.');
  assert.equal(Access.stageOf(player), 2);
  assert.equal(Access.chooseVariant({ player, definition: named('High Priestess Zul-Harcinqa') }), Access.VARIANT.highPriestess.accepted);
  assert.equal(Access.chooseVariant({ player, definition: named('Priestess Zul-Gwenwynig') }), Access.VARIANT.priestess.accepted);
  line(player, 'Priestess Zul-Gwenwynig', "I shall now transport you to Zulrah's shrine and offer your life on behalf of our tribe.");
  assert.equal(Access.stageOf(player), 3);
  player.dialogueActive = true;
  ticks(6);
  assert.equal(Fight.fightOf(player) ?? null, null, 'not while her last line is still showing');
  player.dialogueActive = false;
  ticks(6);
  const fight = Fight.fightOf(player);
  assert.ok(fight, 'rowed out to the shrine once it is read');
  fight.end();
  assert.equal(Access.chooseVariant({ player, definition: named('High Priestess Zul-Harcinqa') }), Access.VARIANT.highPriestess.after);
});

test("a player who has killed Zulrah is past it; the High Priestess's kill and shrine branches answer from the save", () => {
  const player = fakePlayer();
  player.setAttribute(Shared.ATTR.KILLS, 4);
  assert.equal(Access.stageOf(player), 3);
  assert.equal(hooks.condition({ player, definition: named('High Priestess Zul-Harcinqa'), text: 'If the player has killed Zulrah:' }), true);
  const visited = fakePlayer();
  visited.setAttribute('zulrah:access', 3);
  assert.equal(hooks.condition({ player: visited, definition: named('High Priestess Zul-Harcinqa'), text: 'If the player has visited the shrine but not killed Zulrah:' }), true);
  assert.equal(hooks.condition({ player: visited, definition: named('High Priestess Zul-Harcinqa'), text: 'If the player has killed Zulrah:' }), false);
});

test('choosing "Tell me about Zulrah." is told (varbit 1) even where the transcript skips the story', () => {
  const player = fakePlayer();
  for (const fn of hooks.custom['npc-dialogue:choice'] ?? []) fn({ player, definition: named('High Priestess Zul-Harcinqa'), option: 'Tell me about Zulrah.' });
  assert.equal(Access.stageOf(player), 1);
  assert.equal(Access.chooseVariant({ player, definition: named('High Priestess Zul-Harcinqa') }), Access.VARIANT.highPriestess.before);
});

test("a stage line moves the player on only once its page is reached, not when the dialogue is built", () => {
  const player = fakePlayer();
  player.setAttribute('zulrah:access', 2);
  const request = { player, definition: named('Priestess Zul-Gwenwynig'), text: "I shall now transport you to Zulrah's shrine and offer your life on behalf of our tribe." };
  for (const fn of hooks.custom['npc-dialogue:line'] ?? []) fn(request);
  assert.equal(Access.stageOf(player), 2, 'not yet: the page is only built');
  assert.equal(typeof request.before, 'function');
  request.before();
  assert.equal(Access.stageOf(player), 3);
  ticks(6);
  Fight.fightOf(player)?.end();
});

test("stage 3: \"I've been there, but I left.\" then \"Yes.\" rows the player out; Yes elsewhere doesn't", () => {
  const player = fakePlayer();
  player.setAttribute('zulrah:access', 3);
  choose(player, 'Priestess Zul-Gwenwynig', 'Yes.');
  ticks(6);
  assert.equal(Fight.fightOf(player) ?? null, null, 'a Yes on its own is not this menu');
  choose(player, 'Priestess Zul-Gwenwynig', "I've been there, but I left.");
  choose(player, 'Priestess Zul-Gwenwynig', 'Yes.');
  player.dialogueActive = false;
  ticks(6);
  const fight = Fight.fightOf(player);
  assert.ok(fight, 'rowed back out');
  fight.end();
});

test('past the High Priestess: held retrieval items or a login on the shrine; with a kill the priestess plays her default', () => {
  const holding = fakePlayer();
  holding.setAttribute(Shared.ATTR.RETRIEVAL, { items: [[4151, 1]] });
  assert.equal(Access.stageOf(holding), 3);
  const killer = fakePlayer();
  killer.setAttribute(Shared.ATTR.KILLS, 1);
  assert.equal(Access.chooseVariant({ player: killer, definition: named('Priestess Zul-Gwenwynig') }), Access.VARIANT.priestess.killed);
  const visited = fakePlayer();
  visited.setAttribute('zulrah:access', 3);
  assert.equal(Access.chooseVariant({ player: visited, definition: named('Priestess Zul-Gwenwynig') }), Access.VARIANT.priestess.after);
});
