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
const Echo = require("../plugins/bosses/thermonuclear/Echo.ThermonuclearSmokeDevil");
const Teleports = require("../plugins/interface/TeleportInterface.plugin");

const core = PluginManager.getCoreApi();
const areas = [];
const combatProviders = [];
const hitRollHandlers = [];
const objectHooks = {};
let onTaskAnswer = () => false;
let diaryStarted = () => false;
let diaryDone = () => false;
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
    emitCustomEvent: (name, event) => {
      if (name === "slayer:on-task") event.onTask = onTaskAnswer(event);
      if (name === "diary:is-started") event.started = diaryStarted(event);
      if (name === "diary:has-task") event.done = diaryDone(event);
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
  // Max hit 8 comes from the engine (monsters-complete via NpcDefinition), not the
  // plugin: the PendingHit it creates rolls 0-8. The data record must agree with it.
  assert.equal(NpcDefinition.forId(Common.BOSS_ID).getMaxHit(), 8);
  assert.equal(Common.DATA.combat.maxHit, NpcDefinition.forId(Common.BOSS_ID).getMaxHit());
});

test("the hit lands with the legacy-shape projectile at any range (#1862)", (t) => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const sent = [];
  t.mock.method(core.Projectile.prototype, "sendProjectile", function () { sent.push(this); });
  const boss = core.NPC.create(Common.BOSS_ID, new Location(2364, 9448, 0));
  for (const tiles of [1, 8]) {
    const at = core.Projectile.centreOf(boss);
    const player = new Player(null, new Location(at.getX() + tiles, at.getY(), 0));
    const method = new (Fight.methodClass())();
    method.start(boss, player);
    const shot = sent.at(-1);
    // sendProjectile turns the legacy shape (0/20, 43/31) into 51 -> 46 + 10 a tile.
    assert.deepEqual([shot.delay, shot.speed, shot.startHeight, shot.endHeight], [0, 20, 43, 31]);
    const end = 46 + 10 * shot.start.getDistance(shot.end);
    assert.equal(method.hits(boss, player)[0].getDelay(), Math.ceil(end / 30), `${tiles} tiles`);
  }
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
  assert.equal(areas.length, 2, "the boss room, then the dungeon outside it");
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

test("the room refuses an attack off a smoke devil task", () => {
  const area = areas[0];
  const player = { isPlayer: () => true, getAsPlayer: () => player };
  const npcs = [Common.BOSS_ID, Common.SMOKE_DEVIL_ID].map((id) => ({ isNpc: () => true, getId: () => id }));
  onTaskAnswer = () => false;
  for (const npc of npcs) {
    assert.equal(area.canAttack(player, npc), false);
    assert.equal(area.canAttack({ isPlayer: () => false }, npc), null);
  }
  onTaskAnswer = (request) => npcs.includes(request.npc);
  for (const npc of npcs) assert.equal(area.canAttack(player, npc), null);
  assert.equal(area.canAttack(player, { isNpc: () => false }), null);
});

function fightingPlayer({ target = null, retaliating = false } = {}) {
  const player = {
    target,
    messages: [],
    chains: [],
    isPlayer: () => true,
    getAsPlayer: () => player,
    sendMessage: (text) => player.messages.push(text),
    getCombat: () => ({ getTarget: () => player.target, isAutoRetaliating: () => retaliating }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.chains.push(chain) }),
    getSkillManager: () => ({ getMaxLevel: () => 99 }),
  };
  return player;
}

test("the dungeon area covers every smoke devil outside the room, and the room none of its tiles", () => {
  const dungeon = areas[1];
  const inside = (a, x, y) => a.getBoundaries().some((b) => b.inside(new Location(x, y, 0)));
  const spawns = require("../data/definitions/npc-spawns.json")
    .filter((spawn) => spawn.id === Common.SMOKE_DEVIL_ID || spawn.id === Common.BOSS_ID);
  assert.ok(spawns.length >= 30, "the cache's smoke devil spawns");
  for (const spawn of spawns) {
    const inRoom = Common.inLair(new Location(spawn.x, spawn.y, 0));
    assert.equal(inside(dungeon, spawn.x, spawn.y), !inRoom, `${spawn.id} at ${spawn.x},${spawn.y}`);
    assert.equal(inside(areas[0], spawn.x, spawn.y), inRoom, `${spawn.id} at ${spawn.x},${spawn.y}`);
  }
  assert.ok(inside(dungeon, 2404, 9415), "the entrance landing tile");
  assert.ok(inside(dungeon, 2379, 9452), "the crevice's outside tile");
  assert.ok(!inside(dungeon, 2376, 9452), "the crevice's inside tile is the room's");
  assert.ok(!inside(dungeon, 2410, 9474), "the Castle Wars tunnels to the north are not the dungeon");
  // Wiki (Smoke devil): a multicombat area; rsprox 1510 turns multiway_indicator on at the entrance landing.
  assert.equal(dungeon.isMulti(), true, "the dungeon is multicombat");
});

test("an off-task attack in the room or the dungeon gets Breive's message and line (rsprox 1510)", () => {
  onTaskAnswer = () => false;
  diaryStarted = () => false;
  const cases = [[areas[0], Common.BOSS_ID], [areas[0], Common.SMOKE_DEVIL_ID], [areas[1], Common.SMOKE_DEVIL_ID]];
  for (const [area, id] of cases) {
    const npc = { isNpc: () => true, getId: () => id };
    const player = fightingPlayer({ target: npc });
    assert.equal(area.canAttack(player, npc), false);
    assert.deepEqual(player.messages, ["Breive wants you to stick to your Slayer assignments."]);
    assert.equal(player.chains.length, 1, "one dialogue chain");
    const line = player.chains[0].getDialogues().get(0);
    assert.equal(line.getNpcId(), 7654);
    assert.equal(gamevals.namesOf(GamevalKind.NPC).get(7654), "smoke_devil_guardian");
    assert.equal(line.getText(), "<col=0000ff>*cough*</col> that isn't your assignment <col=0000ff>*wheeze*</col>");
  }
});

test("auto-retaliation and permission probes are refused without Breive's lines", () => {
  onTaskAnswer = () => false;
  const npc = { isNpc: () => true, getId: () => Common.SMOKE_DEVIL_ID };
  for (const area of areas) {
    for (const player of [fightingPlayer({ target: npc, retaliating: true }), fightingPlayer(), fightingPlayer({ target: {} })]) {
      assert.equal(area.canAttack(player, npc), false);
      assert.deepEqual(player.messages, []);
      assert.equal(player.chains.length, 0);
    }
  }
});

test("the dungeon lets a smoke devil task through and gives no Western diary exception", () => {
  const npc = { isNpc: () => true, getId: () => Common.SMOKE_DEVIL_ID };
  const boss = { isNpc: () => true, getId: () => Common.BOSS_ID };
  onTaskAnswer = (request) => request.npc === npc;
  assert.equal(areas[1].canAttack(fightingPlayer({ target: npc }), npc), null);
  onTaskAnswer = () => false;
  diaryStarted = () => true;
  diaryDone = () => false;
  assert.equal(areas[0].canAttack(fightingPlayer({ target: boss }), boss), null, "the room keeps the diary kill");
  assert.equal(areas[1].canAttack(fightingPlayer({ target: boss }), boss), false, "the diary kill is the room's only");
  diaryStarted = () => false;
});

test("the boss allows its one off-task Western diary kill at base 93 Slayer, only before the task is done", () => {
  const area = areas[0];
  let slayer = 93;
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    getSkillManager: () => ({ getMaxLevel: () => slayer }),
  };
  const boss = { isNpc: () => true, getId: () => Common.BOSS_ID };
  const minion = { isNpc: () => true, getId: () => Common.SMOKE_DEVIL_ID };
  onTaskAnswer = () => false;
  diaryStarted = () => false;
  diaryDone = () => false;
  assert.equal(area.canAttack(player, boss), false, "diary not started");
  assert.equal(area.canAttack(player, minion), false, "the minions never get the exception");
  diaryStarted = () => true;
  assert.equal(area.canAttack(player, boss), null);
  diaryDone = () => true;
  assert.equal(area.canAttack(player, boss), false, "the diary task is already done");
  diaryDone = () => false;
  slayer = 92;
  assert.equal(area.canAttack(player, boss), false, "boosted or under-level Slayer fails");
  slayer = 93;
  onTaskAnswer = (request) => request.npc === boss;
  assert.equal(area.canAttack(player, boss), null, "a real smoke devil task still works");
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

test('Echo entry keeps 93 Slayer but does not require a task, isolates players and completes once', () => {
  const events=[], spawned=[];
  const makeCombat=()=>({reset(){},attack(){},getHitQueue(){return {clear:()=>{this.cleared=true;}};}});
  class PrivateArea {
    constructor(){this.entities=[];}
    add(npc){this.entities.push(npc);}
    enter(player){player.area=this;}
    destroy(){this.destroyed=true;}
    postLeave(){}
  }
  // The entry and the respawn run on tasks: stepped here a tick at a time.
  const tasks=[];
  const tick=(n=1)=>{for(let i=0;i<n;i++)for(const task of tasks.splice(0)){if(task.isRunning()&&task.tick()!==false&&task.isRunning())tasks.push(task);}};
  const echoApi={
    core:{...core,PrivateArea,Projectile:{centreOf:npc=>npc},TaskManager:{submit(task){task.setRunning(true);tasks.push(task);}}},
    registerNpcCombatMethodProvider(){assert.fail('Echo uses the normal devil\'s controller');},
    // Its fight is tested in echo-thermonuclear-smoke-devil.test.cjs: at 0 HP here it stops at once.
    spawnNpc(options){const combat=makeCombat();const npc={id:options.id,at:[options.x,options.y,options.z],setFlag(){},getCombat:()=>combat,getHitpoints:()=>0,isRegistered:()=>true,
      performGraphic(graphic){npc.graphic=graphic.getId?.()??graphic.id;},performAnimation(animation){npc.animation=animation.getId?.()??animation.id;}};
      spawned.push(npc);return npc;},
    emitCustomEvent(name,event){events.push(name);if(name==='echo-boss:configure')event.configured=true;if(name==='echo-boss:claim')event.token='thermy-'+spawned.length;},
  };
  const makePlayer=level=>{const combat=makeCombat();const p={getSkillManager:()=>({getMaxLevel:()=>level}),setAttribute(){},getCombat:()=>combat,moveTo(to){p.to=[to.getX(),to.getY()];},sendMessage(){},
    getPrivateArea:()=>p.area,getHitpoints:()=>99,isRegistered:()=>true,getLocation:()=>core.Location?new core.Location(2376,9452,0):null,
    getPacketSender:()=>({sendSoundEffect(){},sendTypedMessage(type,text){p.said=text;}})};return p;};
  Common.init(echoApi);
  try {
    Echo.start({player:makePlayer(92),boss:'thermonuclear-smoke-devil'});
    assert.equal(events.length,0,'level gate precedes claiming a session');
    const a=makePlayer(93),b=makePlayer(99);
    Echo.start({player:a,boss:'thermonuclear-smoke-devil'});
    Echo.start({player:a,boss:'thermonuclear-smoke-devil'});
    Echo.start({player:b,boss:'thermonuclear-smoke-devil'});
    // Recorded (rsprox.net 1161, 29 entries): the fade and "You enter the Smokey Cave." at once, the
    // move in 2 ticks later (29 of 29), the Echo 2 ticks after that (16 of 29; a tick later in 13).
    assert.equal(a.said,'You enter the Smokey Cave.');
    assert.equal(spawned.length,0,'no Echo before the player is in');
    tick(2);
    assert.deepEqual(a.to,[2376,9452],'moved in at 2');
    assert.equal(spawned.length,0);
    tick(2);
    assert.equal(spawned.length,2,'the Echoes appear at 4');
    assert.deepEqual(spawned.map(npc=>npc.id),[Common.BOSS_ID,Common.BOSS_ID],'the normal Thermonuclear smoke devil');
    assert.equal(spawned[0].graphic,core.CacheDefinitions.getSpotanimId('leagues_6_lore_dust_devil_spawn_spotanim'),'live\'s Echo spawn spotanim');
    assert.equal(spawned[0].animation,core.CacheDefinitions.getSeqId('lore_lust_devil_spawn'),'live\'s Echo spawn sequence');
    assert.deepEqual(spawned[0].at,[2362,9448,0],'live\'s Echo tile, in the middle of its pools (rsprox.net 1161)');
    assert.notEqual(a.area,b.area);
    assert.equal(events.includes('slayer:on-task'),false);
    assert.ok(spawned[0].__thermonuclearEchoSession.fight,'each Echo runs its own fight');
    const method=new (Fight.methodClass())();
    assert.deepEqual(method.hits(spawned[0],a),[],'the Echo has no attack-turn attack: its fight shoots');
    assert.equal(method.attackDistance(spawned[0]),64,'and never walks to reach the player');
    Echo.death({npc:spawned[0]});Echo.death({npc:spawned[0]});
    assert.equal(events.filter(n=>n==='echo-boss:completed').length,1);
    assert.equal(spawned[0].__thermonuclearEchoSession.fight.stopped,true,'its shots go with it');
    // Recorded: with the player still in the room, the next Echo appears 25 ticks after the death,
    // as its own encounter (released and claimed again).
    tick(24);
    assert.equal(spawned.length,2,'not before 25 ticks');
    tick(1);
    assert.equal(spawned.length,3,'the next Echo');
    assert.equal(spawned[2].__thermonuclearEchoSession,spawned[0].__thermonuclearEchoSession,'in the same room');
    assert.equal(events.filter(n=>n==='echo-boss:release').length,1,'the last encounter released');
    assert.equal(spawned[0].__thermonuclearEchoSession.token,'thermy-2','a new claim for it');
    Echo.end(spawned[0].__thermonuclearEchoSession);
    Echo.end(spawned[1].__thermonuclearEchoSession);
    assert.equal(a.getCombat().cleared,true);
    assert.equal(a.area.destroyed,true);
  } finally {Common.init(api);}
});
