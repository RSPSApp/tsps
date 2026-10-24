// Run after `yarn build`: node --test tests/thermonuclear-smoke-devil.test.cjs
// Thermonuclear smoke devil: the ids against the cache's gamevals, the lair and
// entrance, the fight's typeless style, projectile and speed, the facemask rule and the
// ::teleports entry, each against the captures and Wiki facts in
// docs/thermonuclear-smoke-devil.md.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const ThermonuclearSmokeDevil = require("../plugins/bosses/ThermonuclearSmokeDevil.plugin");
const Common = require("../plugins/bosses/thermonuclear/Common.ThermonuclearSmokeDevil");
const Fight = require("../plugins/bosses/thermonuclear/Fight.ThermonuclearSmokeDevil");
const Typeless = require("../plugins/bosses/thermonuclear/Typeless.ThermonuclearSmokeDevil");
const Area = require("../plugins/bosses/thermonuclear/Area.ThermonuclearSmokeDevil");
const Entrance = require("../plugins/bosses/thermonuclear/Entrance.ThermonuclearSmokeDevil");
const Teleports = require("../plugins/interface/TeleportInterface.plugin");

const core = PluginManager.getCoreApi();
const areas = [];
const combatProviders = [];
const hitRollHandlers = [];
const objectHooks = {};
const api = new Proxy(
  {
    core,
    persistAttribute: () => {},
    registerArea: (area) => areas.push(area),
    registerNpcCombatMethodProvider: (ids, method) => combatProviders.push({ ids, method }),
    onCombatHitRoll: (handler) => hitRollHandlers.push(handler),
    onObjectInteraction: (name, actions) => {
      objectHooks[name] = { ...(objectHooks[name] ?? {}), ...actions };
    },
  },
  { get: (target, key) => target[key] ?? (() => {}) }
);

let gamevals = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  new NpcDefinitionLoader().load();
  gamevals = new Gamevals();
  ThermonuclearSmokeDevil.register(api);
});

// ------------------------------------------------------------------ the cache

test("the ids are the cache's smoke devil gamevals", () => {
  const npc = gamevals.namesOf(GamevalKind.NPC);
  assert.equal(npc.get(Common.BOSS_ID), "smoke_devil_boss");
  assert.equal(npc.get(Common.SMOKE_DEVIL_ID), "smoke_devil");
  const seq = gamevals.namesOf(GamevalKind.SEQ);
  assert.equal(seq.get(Common.ANIM_ATTACK), "lore_dust_devil_attack");
  assert.equal(seq.get(Common.DATA.anims.block), "lore_dust_devil_defend");
  assert.equal(seq.get(Common.DATA.anims.death), "lore_dust_devil_death");
  const spotanim = gamevals.namesOf(GamevalKind.SPOTANIM);
  assert.equal(spotanim.get(Common.PROJECTILE_ID), "smoke_devil_smoke_proj");
  assert.equal(spotanim.get(Common.IMPACT_ID), "smoke_devil_smoke_player_spotanim");
  assert.equal(core.ObjectIdentifiers.CREVICE_2, Common.CREVICE_OUTSIDE_ID);
  assert.equal(core.ObjectIdentifiers.CREVICE_3, Common.CREVICE_INSIDE_ID);
  assert.equal(core.NpcIdentifiers.THERMONUCLEAR_SMOKE_DEVIL, Common.BOSS_ID);
  assert.equal(ThermonuclearSmokeDevil.members, true);
});

test("its stats and combat definitions match the captures", () => {
  assert.equal(CacheDefinitions.getNpc(Common.BOSS_ID).hitpoints, 240);
  assert.equal(CacheDefinitions.getNpc(Common.BOSS_ID).size, 4);
  const defs = require("../data/definitions/npc-combat-defs.json").npcs;
  assert.deepEqual(defs[String(Common.BOSS_ID)].anims, { attack: 3847, block: 3848, death: 3849 });
  // Captured: removal 5 ticks after the death anim (ticks 399 to 404 in submission 1158).
  assert.equal(defs[String(Common.BOSS_ID)].deathTicks, 5);
  // Wiki: 9-second respawn.
  assert.equal(defs[String(Common.BOSS_ID)].respawn, 15);
  // Regulars fire the same smoke shot (submission 4099: 644 with distance-scaled ends,
  // 643 on the player); the engine default draws it from this projectile id.
  assert.equal(defs[String(Common.SMOKE_DEVIL_ID)].projectile, 644);
  // Wiki: 7-tick (4.2s) respawn for regulars.
  assert.equal(defs[String(Common.SMOKE_DEVIL_ID)].respawn, 7);
  assert.equal(defs[String(Common.BOSS_ID)].projectile, 644);
});

test("the spawn, teleport and crevice tiles agree with the logs", () => {
  assert.deepEqual([...Common.DATA.spawnTile], [2360, 9452, 0]);
  assert.deepEqual([...Common.DATA.teleportTile], [2379, 9452, 0]);
  assert.deepEqual([...Common.OUTSIDE_TILE], [2379, 9452, 0]);
  assert.deepEqual([...Common.INSIDE_TILE], [2376, 9452, 0]);
  assert.ok(Common.inLair(new Location(...Common.DATA.spawnTile)));
  assert.ok(Common.inLair(new Location(...Common.INSIDE_TILE)));
  assert.ok(!Common.inLair(new Location(...Common.OUTSIDE_TILE)));
  const free = ([x, y]) => !RegionManager.blocked(new Location(x, y, 0), null);
  assert.ok(free(Common.DATA.spawnTile), "spawn blocked");
  assert.ok(free(Common.DATA.teleportTile), "teleport landing blocked");
  assert.ok(free(Common.OUTSIDE_TILE), "outside crevice blocked");
  assert.ok(free(Common.INSIDE_TILE), "inside crevice blocked");
  const entry = Teleports._test.Destinations.byKey("thermonuclear-smoke-devil");
  assert.ok(entry?.tabs.includes(Teleports._test.TAB.BOSSES), "missing ::teleports entry");
  assert.deepEqual(entry.tile, [2379, 9452, 0]);
});

// ------------------------------------------------------------------ the fight

test("the combat method is the captured typeless magic style", () => {
  assert.equal(combatProviders.length, 1);
  assert.deepEqual([...combatProviders[0].ids], [Common.BOSS_ID]);
  const method = new (Fight.methodClass())();
  assert.equal(method.type(), core.CombatType.MAGIC);
  assert.equal(method.attackDistance(), 8);
  assert.equal(method.attackSpeed(), 2);
  assert.equal(Common.HIT_DELAY_TICKS, 2);
  // Max hit 8 comes from the engine (monsters-complete via NpcDefinition), not the
  // plugin: the PendingHit it creates rolls 0-8. The data record must agree with it.
  assert.equal(NpcDefinition.forId(Common.BOSS_ID).getMaxHit(), 8);
  assert.equal(Common.DATA.combat.maxHit, NpcDefinition.forId(Common.BOSS_ID).getMaxHit());
});

test("protection prayers do not reduce the boss hit", () => {
  assert.ok(hitRollHandlers.length >= 1);
  const bossEvent = { attacker: { isNpc: () => true, getId: () => Common.BOSS_ID }, bypassProtectionPrayer: false };
  for (const handler of hitRollHandlers) handler(bossEvent);
  assert.equal(bossEvent.bypassProtectionPrayer, true);
  const minionEvent = { attacker: { isNpc: () => true, getId: () => Common.SMOKE_DEVIL_ID }, bypassProtectionPrayer: false };
  for (const handler of hitRollHandlers) handler(minionEvent);
  assert.equal(minionEvent.bypassProtectionPrayer, false);
});

test("the room is multicombat and the boss walks through the room", () => {
  assert.equal(areas.length, 1);
  assert.equal(typeof areas[0].isMulti === "function" ? areas[0].isMulti() : areas[0].isMulti, true);
  assert.ok(typeof core.NPC.WALK_THROUGH_ENTITIES_FLAG === "string" && core.NPC.WALK_THROUGH_ENTITIES_FLAG.length > 0, "walk-through flag missing from api.core.NPC");
  const flags = [];
  const boss = { isNpc: () => true, getId: () => Common.BOSS_ID, setFlag: (flag) => flags.push(flag) };
  // The flag is ensured on every tick for room bosses, so a fresh or respawned boss
  // never sticks on the room's smoke devils - not just once it first attacks.
  areas[0].process(boss);
  assert.ok(flags.includes(core.NPC.WALK_THROUGH_ENTITIES_FLAG));
  const minionFlags = [];
  areas[0].process({ isNpc: () => true, getId: () => Common.SMOKE_DEVIL_ID, setFlag: (flag) => minionFlags.push(flag) });
  assert.deepEqual(minionFlags, []);
  areas[0].process({ isPlayer: () => true });
});

test("smoke devils punish players without a mask", () => {
  const gear = require("../plugins/skills/data/slayer-gear.json");
  const bossEntry = gear.monsters.find((monster) => monster.names.includes("Thermonuclear smoke devil"));
  assert.ok(bossEntry, "missing slayer-gear entry");
  assert.ok(bossEntry.names.includes("Nuclear smoke devil"));
  assert.ok(!bossEntry.names.includes("Smoke devil"), "regulars must not share the boss max");
  // Wiki: unmasked the boss deals above its max 8; the 15 is Near-Reality's number.
  assert.equal(bossEntry.hit, 15);
  assert.ok(bossEntry.protection.includes("Facemask"));
  assert.ok(bossEntry.protection.includes("Gas mask"));
  assert.ok(bossEntry.protection.includes("Slayer helmet"));
  // Regulars: no unprotected max is documented (protected max is 20), so hits stay
  // accurate with the drain and prayers keep working (Wiki: Missiles negates them).
  const regularEntry = gear.monsters.find((monster) => monster.names.includes("Smoke devil"));
  assert.ok(regularEntry, "missing regular smoke devil entry");
  assert.equal(regularEntry.hit, undefined);
  assert.ok(!regularEntry.bypassPrayer);
});

test("every kill drops ashes plus a main-table roll, with working unique pre-rolls", () => {
  const dump = require("../data/definitions/npc-drops.json");
  const table = dump.tables["thermonuclear_smoke_devil"];
  assert.ok(table, "missing drop table");
  const guaranteed = table.entries.filter((entry) => entry.always);
  assert.deepEqual(guaranteed.map((entry) => entry.item_id), [592]);
  for (const [itemId, outOf] of [[12002, 350], [11998, 512], [3140, 2000]]) {
    const entry = table.entries.find((row) => row.item_id === itemId);
    assert.ok(entry?.pre_roll, `item ${itemId} should be a pre-roll`);
    assert.equal(entry.out_of, outOf, `item ${itemId} needs out_of or it never drops`);
  }
  const main = table.entries.filter((entry) => Number.isInteger(entry.weight) && !entry.pre_roll && !entry.separate_roll);
  const weight = main.reduce((sum, entry) => sum + entry.weight, 0);
  assert.ok(weight <= table.main_max_roll, `main weights ${weight} exceed max roll ${table.main_max_roll}: tail entries would never drop`);
  const tertiary = Object.fromEntries((table.tertiary || []).map((entry) => [entry.item_id, entry.out_of]));
  assert.deepEqual(tertiary, { 25524: 2000, 12648: 3000, 2722: 96, 12113: 500 });
});

test("the crevice only moves players by the boss room", () => {
  assert.equal(Entrance.isBossCrevice({ location: { x: 2379, y: 9452 }, objectId: Common.CREVICE_OUTSIDE_ID }), true);
  assert.equal(Entrance.isBossCrevice({ location: { x: 2376, y: 9452 }, objectId: Common.CREVICE_INSIDE_ID }), true);
  assert.equal(Entrance.isBossCrevice({ location: { x: 3000, y: 3000 }, objectId: Common.CREVICE_OUTSIDE_ID }), false);
  assert.equal(Entrance.isBossCrevice({ location: { x: 2379, y: 9452 }, objectId: 12345 }), false);
  const moved = [];
  const outsidePlayer = {
    getLocation: () => new Location(2379, 9452, 0),
    moveTo: (tile) => moved.push(tile),
  };
  assert.equal(Entrance.through({ player: outsidePlayer, location: new Location(2379, 9452, 0), objectId: Common.CREVICE_OUTSIDE_ID }), true);
  assert.deepEqual([moved[0].getX(), moved[0].getY()], [2376, 9452]);
  assert.equal(Entrance.through({ player: outsidePlayer, location: new Location(3000, 3000, 0), objectId: Common.CREVICE_OUTSIDE_ID }), false);
  // Cache: 535 offers Use/Peek, 536 offers Use - nothing else may be registered.
  assert.deepEqual(Object.keys(objectHooks["Crevice"]).sort(), ["Peek", "Use"]);
  assert.equal(objectHooks["Crevice"].Use({ player: outsidePlayer, location: new Location(2379, 9452, 0), objectId: Common.CREVICE_OUTSIDE_ID }), true);
  const said = [];
  const peeker = { sendMessage: (line) => said.push(line) };
  assert.equal(Entrance.peek({ player: peeker, location: new Location(2379, 9452, 0), objectId: Common.CREVICE_OUTSIDE_ID }), true);
  assert.deepEqual(said, ["You peek through the crevice and see no adventurers inside."]);
  assert.equal(Entrance.peek({ player: peeker, location: new Location(3000, 3000, 0), objectId: Common.CREVICE_OUTSIDE_ID }), false);
});
