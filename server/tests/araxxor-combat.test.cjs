// Run with: node --test server/tests/araxxor-combat.test.cjs
// Pure Araxxor combat math: no server boot needed.
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
