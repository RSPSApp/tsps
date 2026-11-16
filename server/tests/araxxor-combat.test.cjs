// Run with: node --test server/tests/araxxor-combat.test.cjs
// Araxxor combat math; the enrage test loads the cache and the real NPC (after yarn build).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const Shared = require("../plugins/bosses/araxxor/Shared.Araxxor");
const Area = require("../plugins/bosses/araxxor/Area.Araxxor");
const Minions = require("../plugins/bosses/araxxor/Minions.Araxxor");

test("lair bounds cover the arena but not the tunnel approach", () => {
  const at = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
  assert.equal(Area.insideLair(at(3631, 9812)), true, "boss tile");
  assert.equal(Area.insideLair(at(3643, 9806)), true, "egg tile");
  assert.equal(Area.insideLair(at(3633, 9821)), true, "teleport tile");
  assert.equal(Area.insideLair(at(3615, 9797)), true, "corner");
  assert.equal(Area.insideLair(at(3614, 9812)), false, "west of the lair");
  assert.equal(Area.insideLair(at(3680, 9830)), false, "the webbed-tunnel approach");
  assert.equal(Area.insideLair(at(3633, 9821, 1)), false, "wrong plane");
  assert.equal(Area.insideLair(null), false);
});

test("Araxxor access requires boosted Slayer 92, Priest in Peril and an araxyte or spider task", () => {
  class CoreArea {}
  class PrivateArea {}
  class Boundary {}
  const events = [];
  const core = { Area: CoreArea, PrivateArea, Boundary, Skill: { SLAYER: 18 } };
  Area.attach({
    core,
    registerArea() {},
    emitCustomEvent(name, request) {
      events.push(name);
      if (name === "quest:is-complete") request.complete = request.player.priestInPeril;
      if (name === "slayer:current-task") request.task = request.player.task;
    },
  });
  const player = (level, priestInPeril, task) => ({
    priestInPeril,
    task,
    getSkillManager: () => ({ getCurrentLevel: skill => skill === core.Skill.SLAYER ? level : 1 }),
  });
  assert.match(Area._test.entryReason(player(91, true, { name: "Araxytes" })), /92/);
  assert.match(Area._test.entryReason(player(92, false, { name: "Araxytes" })), /Priest in Peril/);
  assert.match(Area._test.entryReason(player(92, true, { name: "Vampyres" })), /araxyte|spider/i);
  assert.equal(Area._test.entryReason(player(92, true, { name: "Spiders" })), null);
  assert.equal(Area._test.entryReason(player(92, true, { name: "Araxytes" })), null);
  assert.equal(events.filter(name => name === "slayer:current-task").length, 3,
    "the Slayer task is queried only after level and quest checks pass");
});

test("edge distance measures to the 7x7 body, not its corner", () => {
  assert.equal(Shared.edgeDistance(3631, 9812, 3638, 9812), 1);
  assert.equal(Shared.edgeDistance(3631, 9812, 3637, 9818), 0, "under the body");
  assert.equal(Shared.edgeDistance(3631, 9812, 3631 - 4, 9812), 4);
  assert.equal(Shared.edgeDistance(3631, 9812, 3633, 9812 + 7), 1);
  assert.equal(Shared.underBoss(3631, 9812, 3633, 9815), true);
  assert.equal(Shared.underBoss(3631, 9812, 3638, 9815), false);
});

test("egg patterns are three full sets of three colours", () => {
  assert.equal(Shared.PATTERNS.length, 3);
  for (const pattern of Shared.PATTERNS) {
    assert.equal(pattern.length, Shared.EGG_TILES.length, "one egg per tile");
    for (const type of ["acidic", "mirrorback", "ruptura"]) {
      assert.equal(pattern.filter((entry) => entry === type).length, 3, `${type} x3`);
    }
    assert.ok(Shared.SPECIAL_FOR_PRIMARY[pattern[0]], "the first egg picks the special");
  }
  assert.equal(Shared.SPECIAL_FOR_PRIMARY.acidic, "ball");
  assert.equal(Shared.SPECIAL_FOR_PRIMARY.mirrorback, "splatter");
  assert.equal(Shared.SPECIAL_FOR_PRIMARY.ruptura, "drip");
});

test("the splatter scatters nine blobs around a tile within three", () => {
  for (let run = 0; run < 50; run++) {
    const tiles = Shared.splatterTiles(3633, 9816);
    assert.equal(tiles.length, 9);
    for (const [x, y] of tiles) {
      assert.ok(Math.abs(x - 3633) <= 3 && Math.abs(y - 9816) <= 3, "within the capture spread");
      assert.ok(x !== 3633 || y !== 9816, "never the caster's own tile untouched");
    }
  }
});

test("the spray fans outward along the boss-to-player direction", () => {
  for (let run = 0; run < 50; run++) {
    const tiles = Shared.splatterTiles(3633, 9816, null, { x: 10, y: 0 });
    assert.equal(tiles.length, 9);
    for (const [x, y] of tiles) {
      assert.ok(x - 3633 >= -1 && x - 3633 <= 3, "along the direction, mostly outward");
      assert.ok(Math.abs(y - 9816) <= 3, "lateral spread");
      assert.ok(x !== 3633 || y !== 9816, "never the caster's own tile untouched");
    }
  }
});

test("cleave pools run across the blow, as captured", () => {
  // A player south of her gets an east-west line, west of her a north-south one.
  assert.deepEqual(Shared.cleavePoolTiles(10, 10, 0, -1), [[10, 10], [9, 10], [11, 10]]);
  assert.deepEqual(Shared.cleavePoolTiles(10, 10, 1, 0), [[10, 10], [10, 9], [10, 11]]);
  assert.deepEqual(Shared.cleavePoolTiles(10, 10, -4, 3), [[10, 10], [10, 9], [10, 11]]);
  assert.deepEqual(Shared.cleavePoolTiles(10, 10, 0, 0), [[10, 10], [9, 10], [11, 10]]);
});

test("pool damage is a flat 4-5 a tick, as captured", () => {
  const seen = new Set();
  for (let run = 0; run < 200; run++) seen.add(Shared.poolDamage());
  assert.deepEqual([...seen].sort(), [4, 5]);
});

test("blob spreads: six within two for the ball's burst, thirteen within four for an acidic death", () => {
  for (let run = 0; run < 50; run++) {
    const burst = Shared.splatterTiles(100, 100, null, null, Shared.BALL_BURST_COUNT, Shared.BALL_BURST_SPREAD);
    assert.equal(burst.length, 6);
    for (const [x, y] of burst) assert.ok(Math.abs(x - 100) <= 3 && Math.abs(y - 100) <= 2);
    const death = Shared.splatterTiles(100, 100, null, null, Shared.ACIDIC_DEATH_SPLATTER_COUNT, Shared.ACIDIC_DEATH_SPREAD);
    assert.equal(death.length, 13);
    for (const [x, y] of death) assert.ok(Math.abs(x - 100) <= 5 && Math.abs(y - 100) <= 4);
  }
});

test("captured projectile flights land on the captured ticks", () => {
  const { spray, acidicDeath, ballBurst, drip, ranged, magic } = Shared.PROJECTILE;
  // Spray blobs ended at 130-160 and pooled 5-6 ticks after the cast.
  assert.equal(Shared.projectileEnd(spray, 3), 130);
  assert.equal(Shared.landingTicks(Shared.projectileEnd(spray, 3)), 5);
  assert.equal(Shared.landingTicks(Shared.projectileEnd(spray, 6)), 6);
  // The acidic death (110-130) pooled 4-5 ticks after, the ball's burst (100-110) after 4.
  assert.equal(Shared.landingTicks(Shared.projectileEnd(acidicDeath, 2)), 4);
  assert.equal(Shared.landingTicks(Shared.projectileEnd(ballBurst, 1)), 4);
  // Ranged, magic and the drip have a fixed 120-cycle flight: four ticks.
  for (const shape of [ranged, magic, drip]) assert.equal(Shared.landingTicks(Shared.projectileEnd(shape, 9)), 4);
});

test("her ranged and magic hits splat with the 120-cycle shot, not a tick before (#1862)", () => {
  const { Projectile } = require("../dist/game/model/Projectile");
  const Combat = require("../plugins/bosses/araxxor/Combat.Araxxor");
  Combat.attach({
    core: { Projectile, CombatMethod: class {}, CombatType: {}, NpcIdentifiers: { ARAXXOR: 13668 } },
    getPrayerHandler: () => ({}),
    onNpcHitModify: () => {},
    registerNpcCombatMethodProvider: () => {},
  });
  for (const shape of [Shared.PROJECTILE.ranged, Shared.PROJECTILE.magic]) {
    const ticks = Combat._test.shotTicks(shape);
    assert.equal(ticks, Shared.DISTANT_HIT_TICKS);
    assert.ok(ticks * 30 >= shape.end && (ticks - 1) * 30 < shape.end);
  }
});

test("captured attack schedule: special on every seventh attack", () => {
  const specials = [];
  for (let attack = 1; attack <= 21; attack++) {
    if (attack % Shared.SPECIAL_EVERY_ATTACKS === 0) specials.push(attack);
  }
  assert.deepEqual(specials, [7, 14, 21], "first special at attack 7, then every 7");
});

test("wiki hatch schedule: first after 3 standards, then every 6", () => {
  let standards = 0;
  let next = Shared.FIRST_HATCH_STANDARDS;
  const hatches = [];
  for (let attack = 1; attack <= 30; attack++) {
    if (attack % Shared.SPECIAL_EVERY_ATTACKS === 0) continue; // specials are not standards
    standards += 1;
    if (standards >= next) {
      hatches.push(standards);
      next += Shared.HATCH_INTERVAL_STANDARDS;
    }
  }
  assert.deepEqual(hatches, [3, 9, 15, 21], "alternating with the specials at 6, 12, 18");
});

test("eggs sit SE-first, hatching clockwise around the centre", () => {
  assert.deepEqual(Shared.EGG_TILES[0], [3643, 9805], "first egg is the south-easternmost");
  const [cx, cy] = Shared.CENTRE_TILE;
  // Eggs are 2x2: measure from the middle of each.
  const bearings = Shared.EGG_TILES.map(([x, y]) => (Math.atan2(x + 0.5 - cx, y + 0.5 - cy) * 180 / Math.PI + 360) % 360);
  let prev = bearings[0];
  for (let i = 1; i < bearings.length; i++) {
    let cur = bearings[i];
    if (cur <= prev) cur += 360; // unwrap past north
    assert.ok(cur > prev, `tile ${i} continues clockwise`);
    prev = cur;
  }
});

test("idle minions are pointed back at the fighter, engaged ones untouched", () => {
  const area = {};
  const fighter = { isRegistered: () => true, getHitpoints: () => 99, getPrivateArea: () => area };
  const calls = [];
  const idle = {
    isRegistered: () => true, getHitpoints: () => 58,
    getCombat: () => ({ getTarget: () => null, attack: (t) => calls.push(["idle-attack", t]) }),
    setTarget: (t) => calls.push(["idle-target", t]),
  };
  const busy = {
    isRegistered: () => true, getHitpoints: () => 58,
    getCombat: () => ({ getTarget: () => fighter, attack: () => calls.push(["busy-attack"]) }),
    setTarget: () => calls.push(["busy-target"]),
  };
  const dead = { isRegistered: () => false, getHitpoints: () => 0 };
  Minions.ensureTargets({ fighter, area, minions: [idle, busy, dead] });
  assert.ok(calls.some(([k, t]) => k === "idle-target" && t === fighter), "idle minion retargeted");
  assert.ok(calls.some(([k, t]) => k === "idle-attack" && t === fighter), "idle minion ordered to attack");
  assert.ok(!calls.some(([k]) => k === "busy-target" || k === "busy-attack"), "engaged minion untouched");
});

test("minions stay idle when the fighter is gone or out of the instance", () => {
  const area = {};
  const elsewhere = {};
  const fighter = { isRegistered: () => true, getHitpoints: () => 99, getPrivateArea: () => elsewhere };
  let engaged = false;
  const minion = {
    isRegistered: () => true, getHitpoints: () => 58,
    getCombat: () => ({ getTarget: () => null, attack: () => { engaged = true; } }),
    setTarget: () => { engaged = true; },
  };
  Minions.ensureTargets({ fighter, area, minions: [minion] });
  assert.equal(engaged, false, "no cross-instance aggression");
  Minions.ensureTargets({ fighter: null, area, minions: [minion] });
  assert.equal(engaged, false, "no target, no engage");
});

test("step-under cleave self-hit rolls 8-12 on his own footprint", () => {
  assert.equal(Shared.CLEAVE_SELF_MIN, 8);
  assert.equal(Shared.CLEAVE_SELF_MAX, 12);
  assert.equal(Shared.underBoss(3631, 9812, 3633, 9815), true, "recorded tile under him");
  assert.equal(Shared.underBoss(3631, 9812, 3638, 9815), false, "recorded tile outside him");
});

test("mirrorback-bypass weapons are the halberd, crossbows and ballistas", () => {
  const player = (name) => ({
    getEquipment: () => ({
      getWeapon: () => ({
        getId: () => 1,
        getDefinition: () => ({ getName: () => name }),
      }),
    }),
  });
  assert.equal(Minions.instantKillWeapon(player("Noxious halberd")), true);
  assert.equal(Minions.instantKillWeapon(player("Rune crossbow")), true);
  assert.equal(Minions.instantKillWeapon(player("Dragon ballista")), true);
  assert.equal(Minions.instantKillWeapon(player("Abyssal whip")), false);
  assert.equal(Minions.instantKillWeapon(null), false);
  assert.equal(Minions.crushStyle(null), false, "null-safe without attach");
  assert.equal(Minions.crushStyle({}), false, "missing bonuses never qualify");
});

test("captured line-of-sight stepping is diagonal-first", () => {
  const open = () => true;
  assert.equal(Shared.hasClearPath(0, 0, 3, 3, open), true);
  assert.equal(Shared.hasClearPath(0, 0, 0, 0, open), true);
  const blocked = (x, y) => !(x === 1 && y === 1);
  assert.equal(Shared.hasClearPath(0, 0, 3, 3, blocked), false);
  assert.equal(Shared.hasClearPath(0, 0, 0, 3, blocked), true, "straight line misses the block");
});

test("spawned eggs are pinned: scripted movement and zero wander radius", () => {  const eggs = [];
  const fakeCore = {
    NPC: {
      create: () => {
        const egg = {
          scripted: undefined,
          radius: undefined,
          setHitpoints: () => {},
          performAnimation: () => {},
          setAttribute: () => {},
          setScriptedMovement: (value) => { egg.scripted = value; },
          getMovementCoordinator: () => ({ setRadius: (value) => { egg.radius = value; } }),
        };
        eggs.push(egg);
        return egg;
      },
    },
    Location: class {},
    Animation: class {},
    World: { getAddNPCQueue: () => [] },
    Task: class { constructor() {} stop() {} },
    TaskManager: { submit: () => {} },
    NpcIdentifiers: { EGG_10: 1, EGG_11: 2, EGG_12: 3, MIRRORBACK_ARAXYTE: 4, RUPTURA_ARAXYTE: 5, ACIDIC_ARAXYTE: 6 },
    CombatMethod: class {},
    CombatType: { MELEE: 0, RANGED: 1, MAGIC: 2 },
  };
  Minions.attach({
    core: fakeCore,
    onNpcHitModify: () => {},
    registerNpcCombatMethodProvider: () => {},
    getBonusManager: () => null,
  });
  const session = { npc: { getPrivateArea: () => null }, pattern: Shared.PATTERNS[0], eggs: [] };
  Minions.spawnEggs(session);
  assert.equal(eggs.length, 9, "one egg per pattern tile");
  for (const egg of eggs) {
    assert.equal(egg.radius, 0, "no wander radius");
    assert.equal(egg.scripted, true, "pinned: no retaliation chase when attacked");
  }
});

test("pinEggs clears the fighting egg's interaction and combat target", () => {
  const calls = [];
  const egg = {
    isRegistered: () => true,
    getInteractingMobile: () => ({ fake: "player" }),
    setMobileInteraction: (value) => calls.push(["mob", value]),
    getCombat: () => ({ reset: () => calls.push(["reset"]) }),
  };
  Minions.pinEggs({ eggs: [{ npc: egg }] });
  assert.ok(calls.some(([kind, value]) => kind === "mob" && value === null), "interaction cleared");
  assert.ok(calls.some(([kind]) => kind === "reset"), "combat target cleared");
});

test("combat achievements: the fight decides Araxxor's tasks", () => {
  const CA = require("../plugins/bosses/araxxor/CombatAchievements.Araxxor");
  let cycle = 0;
  const completed = [];
  let caTotal = 0;
  const handlers = new Map();
  CA.attach({
    core: { World: { getProcessCycle: () => cycle } },
    getPrayerHandler: () => ({ PROTECT_FROM_MELEE: 18, isActivated: (player) => player.praying === true }),
    onCombatHitResolved: (handler) => handlers.set("hit", handler),
    onNpcDeath: (handler) => handlers.set("death", handler),
    onCustomEvent: () => {},
    emitCustomEvent: (name, request) => {
      if (name === "combat-achievements:complete") completed.push(request.task);
      if (name === "combat-achievements:kill") {
        request.total = caTotal = Math.max(caTotal + 1, request.count);
        request.announce?.(caTotal);
      }
    },
  });
  const player = {
    immune: false,
    praying: false,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return this; },
    getCombat: () => ({ getPoisonImmunityTimer: () => ({ finished: () => !player.immune }) }),
  };
  const at = (x, y) => ({ getX: () => x, getY: () => y });
  const boss = {
    tile: at(3631, 9814),
    enraged: false,
    getId: () => Shared.BOSS_ID,
    isNpc: () => true,
    isPlayer: () => false,
    isRegistered: () => true,
    getLocation() { return this.tile; },
    getAttribute(key) { return key === Shared.ATTR_ENRAGED ? this.enraged : null; },
  };
  const hit = (damage, kind) => ({ getTotalDamage: () => damage, araxxorKind: kind });

  // A clean first kill: perfect, both perfects, no immunity, she never moved.
  CA.spawned(player, boss);
  for (let egg = 0; egg < 6; egg++) {
    handlers.get("death")({ npc: { getId: () => Shared.EGG_ID.acidic, getAttribute: () => ({ player }) } });
  }
  cycle = 200;
  CA.tick(player, boss);
  const order = [];
  completed.push = function push(task) { order.push(`task ${task}`); return Array.prototype.push.call(this, task); };
  assert.equal(CA.killed(player, 1, (kills) => order.push(`kc ${kills}`)), 1, "Combat Achievements' total comes back");
  assert.equal(order[0], "kc 1", "the kill count is told before any task, as live orders them");
  delete completed.push;
  for (const task of ["Perfect Araxxor", "Perfect Araxxor 2", "Let it seep in", "Swimming in Venom", "Relaxxor"]) {
    assert.ok(completed.includes(task), task);
  }

  // Second kill: melee off prayer, hit while enraged, antivenom up, she walked.
  completed.length = 0;
  CA.spawned(player, boss);
  handlers.get("hit")({ attacker: boss, target: player, hit: hit(12) });
  boss.enraged = true;
  handlers.get("hit")({ attacker: player, target: boss, hit: hit(0) });
  player.immune = true;
  boss.tile = at(3632, 9814);
  cycle = 400;
  CA.tick(player, boss);
  CA.killed(player, 2);
  assert.deepEqual(completed, [], "nothing this time");

  // Prayed melee is allowed; her magic never is.
  player.immune = false;
  player.praying = true;
  boss.enraged = false;
  CA.spawned(player, boss);
  handlers.get("hit")({ attacker: boss, target: player, hit: hit(5) });
  cycle = 600;
  CA.killed(player, 3);
  assert.ok(completed.includes("Perfect Araxxor"), "melee through Protect from Melee");
  completed.length = 0;
  CA.spawned(player, boss);
  handlers.get("hit")({ attacker: boss, target: player, hit: hit(3, Shared.Attack.MAGIC) });
  cycle = 800;
  CA.killed(player, 4);
  assert.ok(!completed.includes("Perfect Araxxor"), "her magic spoils it");
  assert.ok(completed.includes("Araxxor Speed-Trialist"), "four kills within 10:00 of the first spawn");
  assert.ok(!completed.includes("Araxxor Speed-Chaser"));

  // Kills five to ten, too slow for the speed tasks; ten in one stay is Arachnid Lover.
  for (let kill = 5; kill <= 10; kill++) {
    completed.length = 0;
    CA.spawned(player, boss);
    cycle += 400;
    CA.killed(player, kill);
  }
  assert.ok(completed.includes("Arachnid Lover"));
  assert.ok(!completed.includes("Araxxor Speed-Chaser"), "400 ticks a kill is too slow");

  // Leaving ends the run.
  CA.left(player);
  completed.length = 0;
  CA.spawned(player, boss);
  cycle += 100;
  CA.killed(player, 11);
  assert.ok(!completed.includes("Arachnid Lover"), "the count restarts after leaving");

  CA.betrayal(player, 2);
  assert.ok(!completed.includes("Araxyte Betrayal"));
  CA.betrayal(player, 3);
  assert.ok(completed.includes("Araxyte Betrayal"));
});

test("Araxxor cleanup leaves incoming hits alone for players without a lair", () => {
  let cleared = 0;
  Area.attach({
    core: { Area: class {}, Boundary: class {}, PrivateArea: class {} },
    registerArea() {},
  });
  const attrs = new Map();
  const player = {
    getLocation: () => ({ getX: () => 3183, getY: () => 4446, getZ: () => 0 }),
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getCombat: () => ({ getHitQueue: () => ({ clear: () => { cleared++; } }) }),
  };
  Area.destroyArea(player);
  assert.equal(cleared, 0, "other quest and raid damage must reach the player");
  attrs.set("araxxor:instance-area", {});
  Area.destroyArea(player);
  assert.equal(cleared, 1, "the departing Araxxor player's pending shots are cleared");
  Area.destroyArea(player);
  assert.equal(cleared, 1, "cleanup ends with the actual instance");
});

test("the harvest pet roll and the destroyed corpse's Nid roll are loot, not extra kills", () => {
  const Corpse = require("../plugins/bosses/araxxor/Corpse.Araxxor");
  const events = [];
  const core = {
    Animation: class {},
    Item: class {},
    ItemDefinition: { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => false }) },
    World: { getRemoveNPCQueue: () => ({ push() {} }), getProcessCycle: () => 0 },
    Task: class { stop() {} },
    TaskManager: { submit: (task) => task.execute() },
  };
  const api = {
    core,
    persistAttribute() {},
    onNpcDeath() {},
    onCustomEvent() {},
    onNpcInteraction() {},
    emitCustomEvent(name, payload) { events.push([name, payload]); },
    getItemOnGroundManager: () => ({ registerLocation() {} }),
  };
  Corpse.attach(api);
  const corpse = (session) => ({
    getId: () => Shared.CORPSE_ID,
    getAttribute: () => session,
    isRegistered: () => true,
    getLocation: () => ({}),
    performAnimation() {},
  });
  const player = { performAnimation() {} };
  const originalRandom = Math.random;
  Math.random = () => 0; // roll Nid (1/1500) on destroy
  try {
    const harvested = corpse({ pendingPet: [{ itemId: Shared.NID_ITEM_ID, amount: 1 }], stash: [] });
    harvested.__session = { corpse: harvested, pendingPet: [{ itemId: Shared.NID_ITEM_ID, amount: 1 }], stash: [] };
    harvested.getAttribute = () => harvested.__session;
    Corpse.harvest({ player, npc: harvested });
    const destroyed = corpse(null);
    destroyed.__session = { corpse: destroyed, stash: [] };
    destroyed.getAttribute = () => destroyed.__session;
    Corpse.destroyConfirmed({ player, npc: destroyed });
    const rolls = events.filter(([name]) => name === "npc-drops:roll").map(([, payload]) => payload);
    assert.equal(rolls.length, 2, "the pet and the destroy Nid roll each emit once");
    for (const roll of rolls) assert.equal(roll.countKill, false, "neither re-roll tallies another kill");
    assert.deepEqual(rolls.map((roll) => roll.drops[0].itemId), [Shared.NID_ITEM_ID, Shared.NID_ITEM_ID]);
  } finally {
    Math.random = originalRandom;
  }
});

test("the harvested loot is told to the loot tracker as Araxxor's, at the harvest (rsprox 237/01088)", () => {
  const Corpse = require("../plugins/bosses/araxxor/Corpse.Araxxor");
  const events = [];
  const core = {
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } },
    ItemDefinition: { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => true }) },
  };
  Corpse.attach({
    core, persistAttribute() {}, onNpcDeath() {}, onCustomEvent() {}, onNpcInteraction() {},
    emitCustomEvent(name, payload) { events.push([name, payload]); },
    getItemOnGroundManager: () => ({ registerLocation() {} }),
  });
  const added = [];
  const player = { getInventory: () => ({ contains: () => true, getFreeSlots: () => 28, adds: (id, n) => added.push([id, n]) }) };
  const drops = [{ itemId: 1434, amount: 2 }];
  Corpse.spawnDrops(player, { corpse: { getLocation: () => ({}), getPrivateArea: () => null } }, drops);
  assert.deepEqual(added, [[1434, 2]]);
  const reports = events.filter(([name]) => name === "npc-drops:report").map(([, payload]) => payload);
  assert.deepEqual(reports.map((report) => [report.npcId, report.drops]), [[Shared.BOSS_ID, drops]]);
});

test("a Nid from the death roll or from Destroy reaches the listeners after the corpse's own stash hook", () => {
  const Corpse = require("../plugins/bosses/araxxor/Corpse.Araxxor");
  const handlers = new Map();
  const core = {
    Animation: class {},
    Item: class {},
    ItemDefinition: { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => false }) },
    World: { getRemoveNPCQueue: () => ({ push() {} }), getProcessCycle: () => 0 },
    Task: class { stop() {} },
    TaskManager: { submit: (task) => task.execute() },
  };
  // A synchronous bus: Corpse attaches first (bosses/ loads before npcs/Pets.plugin.js), the pet listener after it.
  const api = {
    core, persistAttribute() {}, onNpcDeath() {}, onNpcInteraction() {},
    onCustomEvent(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    emitCustomEvent(name, payload) { for (const handler of handlers.get(name) ?? []) handler(payload); },
    getItemOnGroundManager: () => ({ registerLocation() {} }),
  };
  Corpse.attach(api);
  const pets = [];
  api.onCustomEvent("npc-drops:roll", (event) => {
    for (const drop of event.drops) if (drop.itemId === Shared.NID_ITEM_ID) pets.push(event.countKill);
  });
  const corpse = () => {
    const npc = { getId: () => Shared.CORPSE_ID, isRegistered: () => true, getLocation: () => ({}), performAnimation() {} };
    const session = { corpse: npc, stash: [], pendingPet: [] };
    npc.getAttribute = () => session;
    return npc;
  };
  const player = { performAnimation() {} };

  const harvested = corpse();
  api.emitCustomEvent("npc-drops:roll", { npc: harvested, npcId: Shared.BOSS_ID, drops: [{ itemId: Shared.NID_ITEM_ID, amount: 1 }] });
  assert.deepEqual(pets, [], "the death roll holds Nid back until the corpse is used");
  Corpse.harvest({ player, npc: harvested });
  assert.deepEqual(pets, [false], "Harvest hands the held Nid over, once");

  pets.length = 0;
  const originalRandom = Math.random;
  Math.random = () => 0; // roll Nid (1/1500) on destroy
  try {
    Corpse.destroyConfirmed({ player, npc: corpse() });
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(pets, [false], "Destroy's own Nid roll is handed over");
});

// The collection log, the clan loot broadcast and the loot notifications all read "npc-drops:roll" a microtask later,
// so the harvested loot is sent as its own roll (the death roll is emptied); a Destroy logs only the clue it keeps.
test("the harvest's loot goes out as one npc-drops:roll (log, clan broadcast), a Destroy logs only its clue", () => {
  const Corpse = require("../plugins/bosses/araxxor/Corpse.Araxxor");
  const events = [];
  const core = {
    Animation: class {},
    Item: class {},
    ItemDefinition: { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => false }) },
    World: { getRemoveNPCQueue: () => ({ push() {} }), getProcessCycle: () => 0 },
    Task: class { stop() {} },
    TaskManager: { submit: (task) => task.execute() },
  };
  Corpse.attach({
    core, persistAttribute() {}, onNpcDeath() {}, onCustomEvent() {}, onNpcInteraction() {},
    emitCustomEvent(name, payload) { events.push([name, payload]); },
    getItemOnGroundManager: () => ({ registerLocation() {} }),
  });
  const WHIP = 4151;
  const corpseWith = () => {
    const npc = { getId: () => Shared.CORPSE_ID, isRegistered: () => true, getLocation: () => ({}), performAnimation() {} };
    const session = { corpse: npc, stash: [] };
    npc.getAttribute = () => session;
    // The death roll, as NpcDrops hands it over: stashed, and emptied so nothing is logged at the death.
    const death = { npc, npcId: Shared.BOSS_ID, drops: [{ itemId: WHIP, amount: 1 }, { itemId: Shared.ELITE_CLUE_ITEM_ID, amount: 1 }] };
    Corpse.stashGenerated(death);
    assert.deepEqual(death.drops, [], "the death roll logs nothing");
    return npc;
  };
  const logged = () => events.filter(([name]) => name === "collection-log:obtain").map(([, request]) => request.itemId);
  const rolls = () => events.filter(([name]) => name === "npc-drops:roll").map(([, request]) => request);
  const player = { performAnimation() {} };
  Corpse.harvest({ player, npc: corpseWith() });
  assert.equal(rolls().length, 1, "harvested: one roll");
  assert.deepEqual(rolls()[0].drops.map((drop) => drop.itemId), [WHIP, Shared.ELITE_CLUE_ITEM_ID], "all of it");
  assert.equal(rolls()[0].countKill, false, "the death roll counted the kill");
  assert.equal(rolls()[0].player, player);
  assert.deepEqual(logged(), [], "logged through the roll, not twice");
  events.length = 0;
  const originalRandom = Math.random;
  Math.random = () => 0.99; // no Nid
  try {
    Corpse.destroyConfirmed({ player, npc: corpseWith() });
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(logged(), [Shared.ELITE_CLUE_ITEM_ID], "destroyed: only the clue it keeps");
});

// Wiki (Araxxor/Strategies): the enrage "will additionally increase his Defence level by 35, Magic by 28 and Ranged by 31".
test("the enrage raises Defence by 35, Magic by 28 and Ranged by 31 on the real NPC, and nowhere else", async () => {
  const path = require("node:path");
  require("../dist/Server").Server.installProductionPathResolver();
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  const core = PluginManager.getCoreApi();
  const Combat = require("../plugins/bosses/araxxor/Combat.Araxxor");
  Combat.attach(new Proxy({ core, getPrayerHandler: () => ({}) }, { get: (t, k) => (k in t ? t[k] : () => {}) }));
  const { DEFENCE, MAGIC, RANGED } = core.Skill;
  const spawn = () => {
    const npc = new NPC(Shared.BOSS_ID, new core.Location(Shared.SPAWN_TILE[0], Shared.SPAWN_TILE[1], Shared.SPAWN_TILE[2]));
    npc.setRegistered(true);
    npc.setHitpoints(Math.floor(Shared.MAX_HITPOINTS * Shared.ENRAGE_THRESHOLD));
    return npc;
  };
  const levels = (npc) => [DEFENCE, MAGIC, RANGED].map((skill) => npc.getCurrentLevel(skill));
  const npc = spawn();
  const other = spawn();
  assert.deepEqual(levels(npc), [135, 190, 210], "the definition's levels");
  npc.setCurrentLevels(MAGIC, 150); // drained before the enrage
  try {
    Combat.checkEnrage(npc, 1);
    assert.equal(npc.getAttribute(Shared.ATTR_ENRAGED), true);
    assert.deepEqual(levels(npc), [170, 178, 241], "raised; the drained Magic comes up by the same 28");
    assert.deepEqual([DEFENCE, MAGIC, RANGED].map((skill) => npc.getMaxLevel(skill)), [170, 218, 241]);
    Combat.checkEnrage(npc, 1);
    assert.equal(npc.getCurrentLevel(DEFENCE), 170, "only once");
    npc.setCurrentLevels(DEFENCE, 200);
    assert.equal(npc.getCurrentLevel(DEFENCE), 170, "nothing goes past the raised level");
    npc.setCurrentLevels(DEFENCE, 120);
    assert.equal(npc.getCurrentLevel(DEFENCE), 120, "drains still work after the enrage");
    assert.deepEqual(levels(other), [135, 190, 210], "another Araxxor keeps the definition's levels");
  } finally {
    core.TaskManager.cancelTasks(npc);
  }
});

// Wiki (Araxxor, Drops): "The rate to receive any halberd piece is 1/200. Players will not receive
// duplicate pieces until each full set is obtained." The export listed each piece as its own 1/200
// roll, so any piece was 3/200 and one kill could hand out two or three (issue #5927).
test("Araxxor's halberd pieces are one 1/200 roll, so a kill can hand over at most one", () => {
  const path = require("node:path");
  require("../dist/Server").Server.installProductionPathResolver();
  const Drops = require("../plugins/npcs/NpcDrops.plugin");
  Drops._test.loadDrops();
  const table = Drops._test.tablesByNpc.get(Shared.BOSS_ID)[0];
  const pieces = table.entries.filter((entry) => Shared.HALBERD_PIECES.includes(entry.item_id));
  assert.equal(pieces.length, 3, "point, blade and pommel");
  for (const piece of pieces) {
    assert.equal(piece.separate_roll, true);
    assert.equal(piece.roll_group, "araxxor_halberd_piece", "one roll chooses the piece, not three");
    assert.equal(piece.weight, 1);
    assert.equal(piece.out_of, 600);
  }
  const anyPiece = pieces.reduce((sum, piece) => sum + piece.weight, 0) / pieces[0].out_of;
  assert.equal(anyPiece, 1 / 200, "any piece, once per kill");

  const player = { getEquipment: () => ({ get: () => null, getItems: () => [] }), getAttribute: () => undefined };
  const npc = {
    getId: () => Shared.BOSS_ID,
    getLocation: () => new (require("../dist/game/model/Location").Location)(3631, 9814, 0),
    getCurrentDefinition: () => ({ getName: () => "Araxxor", getCombatLevel: () => 890 }),
  };
  const originalRandom = Math.random;
  try {
    Math.random = () => 0; // every separate roll hits
    const hit = Drops.__internals.rollTable(table, player, npc);
    assert.equal(hit.filter((drop) => Shared.HALBERD_PIECES.includes(drop.itemId)).length, 1, "one piece at most");
    Math.random = () => 0.999999; // none does
    const miss = Drops.__internals.rollTable(table, player, npc);
    assert.equal(miss.filter((drop) => Shared.HALBERD_PIECES.includes(drop.itemId)).length, 0, "no piece");
  } finally {
    Math.random = originalRandom;
  }
});

test("each halberd piece drop is the next piece the player lacks; a new set starts after all three", () => {
  const Corpse = require("../plugins/bosses/araxxor/Corpse.Araxxor");
  Corpse.attach({
    core: {
      Bank: { TOTAL_BANK_TABS: 11, BANK_SEARCH_TAB_INDEX: 10 },
      Animation: class {},
      Item: class {},
      ItemDefinition: { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => false }) },
      World: { getRemoveNPCQueue: () => ({ push() {} }), getProcessCycle: () => 0 },
      Task: class { stop() {} },
      TaskManager: { submit: (task) => task.execute() },
    },
    persistAttribute() {}, onNpcDeath() {}, onCustomEvent() {}, onNpcInteraction() {},
    emitCustomEvent() {}, getItemOnGroundManager: () => ({ registerLocation() {} }),
  });
  const attrs = new Map();
  const player = {
    performAnimation() {},
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => ({ getAmount: () => 0 }),
    getBank: () => ({ getAmount: () => 0 }),
  };
  const originalRandom = Math.random;
  Math.random = () => 0; // the first of those still missing
  try {
    const set = [1, 2, 3].map(() => Corpse.nextHalberdPiece(player));
    assert.deepEqual(set, Shared.HALBERD_PIECES, "each of the three once, in order");
    assert.equal(Corpse.nextHalberdPiece(player), Shared.HALBERD_PIECES[0], "the fourth starts a new set");

    const drops = Corpse.resolveHalberdPieces(player, [{ itemId: 29790, amount: 1 }, { itemId: 1434, amount: 2 }]);
    assert.deepEqual(drops.map((drop) => drop.itemId), [Shared.HALBERD_PIECES[1], 1434], "the rolled piece becomes the next one lacked");
    assert.deepEqual(drops.map((drop) => drop.amount), [1, 2], "the rest of the loot is untouched");

    // An account that looted before the counter existed starts from what it holds.
    const holder = {
      getAttribute: () => undefined,
      setAttribute() {},
      getInventory: () => ({ getAmount: (id) => (id === Shared.HALBERD_PIECES[0] ? 2 : 0) }),
      getBank: () => ({ getAmount: () => 0 }),
    };
    assert.equal(Corpse.nextHalberdPiece(holder), Shared.HALBERD_PIECES[1], "already-held point is not handed out again");
  } finally {
    Math.random = originalRandom;
  }
});

test("the mirrorback recoils melee only from melee distance", () => {
  const recoiled = [];
  const fakeCore = {
    CombatType: { MELEE: 0, RANGED: 1, MAGIC: 2 },
    HitDamage: class { constructor(damage, mask) { this.damage = damage; this.mask = mask; } },
    HitMask: { RED: 1 },
    NpcIdentifiers: { EGG_10: 1, EGG_11: 2, EGG_12: 3, MIRRORBACK_ARAXYTE: 4, RUPTURA_ARAXYTE: 5, ACIDIC_ARAXYTE: 6 },
    CombatMethod: class {},
  };
  Minions.attach({
    core: fakeCore,
    onNpcHitModify: () => {},
    registerNpcCombatMethodProvider: () => {},
    getBonusManager: () => null,
  });

  const at = (x, y) => ({ getX: () => x, getY: () => y, getZ: () => 0 });
  const mirrorback = { getId: () => Shared.MINION_ID.mirrorback, getLocation: () => at(100, 100), getSize: () => 2 };
  const playerAt = (x, y) => {
    const player = {
      isPlayer: () => true,
      getAsPlayer: () => player,
      getLocation: () => at(x, y),
      getEquipment: () => ({ getWeapon: () => ({ getId: () => 1, getDefinition: () => ({ getName: () => "Scythe of vitur" }) }) }),
      getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => recoiled.push(...hits) }) }),
      getBonusManager: () => null,
    };
    return player;
  };
  const strike = (player, type = 0) => Minions.modifyHit({
    npc: mirrorback,
    hit: {
      getAttacker: () => player,
      getCombatType: () => type,
      getHits: () => [{ getDamage: () => 20 }],
      updateTotalDamage: () => {},
    },
  });

  // The 2x2 body covers 100,100-101,101: 102,100 is edge-adjacent, 103,100 has a tile between.
  strike(playerAt(102, 100));
  assert.equal(recoiled.length, 1, "adjacent melee recoils");
  assert.equal(recoiled[0].damage, 10, "half of the damage");
  recoiled.length = 0;

  strike(playerAt(103, 100));
  assert.equal(recoiled.length, 0, "a tile between negates the recoil (Wiki)");
  recoiled.length = 0;

  strike(playerAt(102, 100), 1);
  assert.equal(recoiled.length, 0, "ranged never recoils");
});

// The one-time seed counts what the player keeps anywhere: a looting bag's contents (LootingBag's
// "storage:contents") and their Group Ironman group storage (GroupStorage's "group-storage:amount").
test("the halberd seed counts pieces in a looting bag and in group storage", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  require("../dist/Server").Server.installProductionPathResolver();
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const GroupStorage = require("../plugins/interface/GroupStorage.plugin");
  const { Store } = GroupStorage._test;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "araxxor-seed-"));
  const previousFile = process.env[Store.FILE_ENV];
  process.env[Store.FILE_ENV] = path.join(dir, "group-storage.json");
  Store.reset();
  const handlers = new Map();
  let groupOf = () => null;
  const emit = (name, payload) => {
    if (name === "grouping:get") payload.group = groupOf(payload.player);
    for (const handler of handlers.get(name) ?? []) handler(payload);
    return payload;
  };
  const api = new Proxy({
    core,
    onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    emitCustomEvent: emit,
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/items/LootingBag.plugin").register(api);
  GroupStorage.register(api);
  const Corpse = require("../plugins/bosses/araxxor/Corpse.Araxxor");
  Corpse.attach(api);
  const [POINT, BLADE, POMMEL] = Shared.HALBERD_PIECES;
  const originalRandom = Math.random;
  Math.random = () => 0; // the first of those still missing
  try {
    // The point in a looting bag in the pack, the blade in the bank: the pommel comes next.
    const bagged = new Player(null);
    bagged.setUsername("araxxor-bag");
    const bag = new core.Item(core.ItemIdentifiers.LOOTING_BAG, 1);
    bag.setMetaValue("lootingBag", [{ id: POINT, amount: 1 }]);
    bagged.getInventory().add(bag);
    bagged.getBank(0).add(new core.Item(BLADE, 1));
    assert.equal(Corpse.nextHalberdPiece(bagged), POMMEL, "the bagged point and banked blade count");

    // The point and blade in the group's storage: the pommel again; outside a group, the point.
    const grouped = new Player(null);
    grouped.setUsername("araxxor-group");
    Store.commit(7, [{ id: POINT, amount: 1 }, null, { id: BLADE, amount: 1 }]);
    groupOf = (player) => (player === grouped ? { id: 7, ironman: true } : null);
    assert.equal(Corpse.nextHalberdPiece(grouped), POMMEL, "group storage counts");
    const loner = new Player(null);
    loner.setUsername("araxxor-loner");
    assert.equal(Corpse.nextHalberdPiece(loner), POINT, "nothing held anywhere: the first piece");
  } finally {
    Math.random = originalRandom;
    Store.reset();
    if (previousFile === undefined) delete process.env[Store.FILE_ENV];
    else process.env[Store.FILE_ENV] = previousFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
