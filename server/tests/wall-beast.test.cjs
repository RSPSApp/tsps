// Run after `yarn build`: node --test tests/wall-beast.test.cjs
// Wall beasts (docs/slayer.md, "Wall beasts"; rsprox captures 1000134, 1000140, 1001671, 1001932; Wiki
// Wall beast): a player who stops in front of a hole is held, then grabbed (no spiny helmet or Slayer
// helmet: held 9 ticks, hit up to 18) or repels it (the hole turns into the attackable beast, which
// goes back into the wall after 18 ticks out of a fight). Real Player, real NPCs, the cache's ids.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, beforeEach, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const Equipment = require("../plugins/skills/slayer/Equipment.Slayer");
const WallBeast = require("../plugins/skills/slayer/WallBeast.Slayer");

const { start, track, tick, fronts, watched, beasts, held, GRAB_HOLD_TICKS, RETREAT_IDLE_TICKS, GRAB_REST_TICKS, RETREAT_REST_TICKS } = WallBeast._test;
const HOLE = { x: 3164, y: 9556, z: 0 };
const FRONT = { x: 3164, y: 9555, z: 0 };

let core;
let next = 9100;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  new NpcDefinitionLoader().load();
  const api = { core, emitCustomEvent() {} };
  Equipment.init(api);
  WallBeast.init(api);
  // The task start() submits is not run here: the tests call tick() themselves.
  const submit = core.TaskManager.submit;
  core.TaskManager.submit = () => {};
  try { start(); } finally { core.TaskManager.submit = submit; }
});

beforeEach(() => {
  watched.clear();
  beasts.clear();
  held.clear();
});

/** One server tick: the tasks due (the in-place move's clearing), then the wall beasts' own. */
function turn() {
  core.TaskManager.process();
  tick();
}

function seq(name) {
  return core.CacheDefinitions.getSeqId(name);
}

function createPlayer(t, at = FRONT, helmet = null) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("wallbeast" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at.x, at.y, at.z));
  p.needsPlacement = false;
  t.after(() => p.setRegistered(false));
  p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99, false).setCurrentLevels(core.Skill.HITPOINTS, 99, false);
  if (helmet) p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(helmet, 1));
  p.log = [];
  p.sendMessage = (text) => p.log.push(`game ${text}`);
  const sender = p.getPacketSender();
  sender.sendTypedMessage = (type, text) => p.log.push(`${type === core.ChatType.SPAM ? "spam" : type} ${text}`);
  sender.sendSound = (id) => p.log.push(`sound ${id}`);
  const animate = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { p.log.push(`anim ${animation.getId()}`); return animate(animation); };
  return p;
}

function createHole(t, player) {
  const npc = new NPC(core.NpcIdentifiers.HOLE_IN_THE_WALL, new core.Location(HOLE.x, HOLE.y, HOLE.z));
  npc.setRegistered(true);
  t.after(() => npc.setRegistered(false));
  npc.log = [];
  const animate = npc.performAnimation.bind(npc);
  npc.performAnimation = (animation) => { npc.log.push(`anim ${animation.getId()}`); return animate(animation); };
  npc.attacked = [];
  const combat = npc.getCombat();
  combat.attack = (target) => npc.attacked.push(target);
  player.getLocalNpcs = () => [npc];
  return npc;
}

function pendingDamage(player) {
  return player.getCombat().getHitQueue().pendingDamage.map((hit) => hit.getDamage());
}

test("every hole's front is the tile south of it, from the spawns", () => {
  assert.equal(fronts.size, 7);
  assert.deepEqual(fronts.get("3164,9555,0"), HOLE);
  assert.deepEqual(fronts.get("3162,9573,0"), { x: 3162, y: 9574, z: 0 });
});

test("unprotected: held and turned the next tick, grabbed the one after, hit up to 18 when let go", (t) => {
  const player = createPlayer(t);
  const hole = createHole(t, player);
  track({ player });
  assert.ok(watched.has(player));

  turn();
  assert.ok(player.getMovementQueue().isMovementBlocked(), "held where they stopped");
  assert.deepEqual(player.log, [], "nothing shown before the grab");

  turn();
  assert.deepEqual(player.log, [
    "game A giant hand appears and grabs your head!",
    `anim ${seq("human_wall_beast_specialattack_start")}`,
    "sound 893",
  ]);
  assert.deepEqual(hole.log, [`anim ${seq("wall_beast_specialattack_start")}`]);
  assert.ok(player.getForceMovement(), "the in-place exact move");
  assert.equal(player.getForceMovement().getEnd().getX(), 0);
  assert.equal(player.getForceMovement().getReverseSpeed(), 5);

  player.log.length = 0;
  hole.log.length = 0;
  turn();
  assert.deepEqual(player.log, [`anim ${seq("human_wall_beast_specialattack_ready")}`]);
  assert.deepEqual(hole.log, [`anim ${seq("wall_beast_specialattack_ready")}`]);

  for (let i = 1; i < GRAB_HOLD_TICKS - 1; i++) turn();
  assert.ok(player.getMovementQueue().isMovementBlocked(), "still held on the eighth tick");
  assert.deepEqual(pendingDamage(player), []);
  turn();
  assert.ok(!player.getMovementQueue().isMovementBlocked(), "let go on the ninth");
  assert.ok(player.log.includes(`anim ${seq("human_wall_beast_specialattack_end")}`));
  assert.ok(hole.log.includes(`anim ${seq("wall_beast_specialattack_end")}`));
  const [damage, ...rest] = pendingDamage(player);
  assert.deepEqual(rest, []);
  assert.ok(damage >= 0 && damage <= 18, `grab hit ${damage}`);
  assert.equal(hole.getId(), core.NpcIdentifiers.HOLE_IN_THE_WALL, "never attackable");
});

test("let go, a player still in front is grabbed again only once the hole has rested 17 ticks", (t) => {
  const player = createPlayer(t);
  const hole = createHole(t, player);
  track({ player });
  for (let i = 0; i < GRAB_HOLD_TICKS + 2; i++) turn();
  assert.ok(!player.getMovementQueue().isMovementBlocked(), "let go");
  hole.log.length = 0;
  for (let i = 1; i < GRAB_REST_TICKS; i++) turn();
  assert.ok(!player.getMovementQueue().isMovementBlocked(), "not held while it rests (rec 1000134: 829-834)");
  turn();
  assert.ok(player.getMovementQueue().isMovementBlocked(), "held 17 ticks after being let go (822 -> 839)");
  turn();
  assert.deepEqual(hole.log, [`anim ${seq("wall_beast_specialattack_start")}`], "and grabbed the tick after");
});

test("the grab's hit rolls across 0-18", (t) => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const player = createPlayer(t);
    createHole(t, player);
    track({ player });
    for (let j = 0; j < GRAB_HOLD_TICKS + 2; j++) turn();
    seen.add(pendingDamage(player)[0]);
    beasts.clear();
    watched.clear();
  }
  assert.equal(Math.max(...seen), 18);
  assert.ok(Math.min(...seen) >= 0);
  assert.ok(seen.size > 10);
});

for (const [label, helmet] of [["a spiny helmet", "SPINY_HELMET"], ["a black slayer helmet", "BLACK_SLAYER_HELMET"]]) {
  test(`${label} repels it: the attackable beast, which attacks; the player walks on`, (t) => {
    const player = createPlayer(t, FRONT, core.ItemIdentifiers[helmet]);
    const hole = createHole(t, player);
    track({ player });
    turn();
    turn();
    assert.deepEqual(player.log, ["spam Your helmet repels the wall beast!", "sound 895"]);
    assert.deepEqual(hole.log, [`anim ${seq("wall_beast_specialattack_fail")}`]);
    assert.equal(hole.getId(), core.NpcIdentifiers.WALL_BEAST);
    assert.equal(hole.getHitpoints(), core.NpcDefinition.forId(core.NpcIdentifiers.WALL_BEAST).getHitpoints());
    assert.deepEqual(hole.attacked, [player]);
    assert.ok(!player.getMovementQueue().isMovementBlocked(), "free to run on");
    assert.ok(hole.getMovementQueue().isMovementBlocked(), "the beast stays in its wall");
  });
}

test("a repelled beast nobody attacks goes back into the wall after 18 ticks, healed, and rests 6", (t) => {
  const player = createPlayer(t, FRONT, core.ItemIdentifiers.SPINY_HELMET);
  const hole = createHole(t, player);
  track({ player });
  turn();
  turn();
  player.setLocation(new core.Location(FRONT.x + 3, FRONT.y, FRONT.z));
  hole.setHitpoints(40);
  hole.log.length = 0;
  for (let i = 1; i < RETREAT_IDLE_TICKS; i++) turn();
  assert.equal(hole.getId(), core.NpcIdentifiers.WALL_BEAST, "still out on the seventeenth tick");
  turn();
  assert.deepEqual(hole.log, [`anim ${seq("wall_beast_specialattack_disappear")}`]);
  assert.equal(hole.getId(), core.NpcIdentifiers.HOLE_IN_THE_WALL);
  assert.equal(hole.getHitpoints(), hole.getMaxHitpoints());
  assert.ok(!hole.getMovementQueue().isMovementBlocked());

  // Back in front, without moving again: held 6 ticks after it pulled back (rec 1000134: 858 -> 864).
  player.setLocation(new core.Location(FRONT.x, FRONT.y, FRONT.z));
  for (let i = 1; i < RETREAT_REST_TICKS; i++) turn();
  assert.ok(!player.getMovementQueue().isMovementBlocked());
  turn();
  assert.ok(player.getMovementQueue().isMovementBlocked());
});

test("standing in front without attacking it does not keep it out (rec 1000134: 855-858)", (t) => {
  const player = createPlayer(t, FRONT, core.ItemIdentifiers.SPINY_HELMET);
  const hole = createHole(t, player);
  track({ player });
  turn();
  turn();
  for (let i = 0; i < RETREAT_IDLE_TICKS; i++) turn();
  assert.equal(hole.getId(), core.NpcIdentifiers.HOLE_IN_THE_WALL);
});

/** The player is fighting the beast: it is their target and they keep hitting it. */
function fightFrom(player, hole) {
  player.getCombat().target = hole;
  hole.getCombat().setUnderAttack(player);
}

for (const [label, at] of [["from its front tile", FRONT], ["from range, off its front tile (rec 1000140: a crossbow fight)", { x: FRONT.x, y: FRONT.y - 3, z: 0 }]]) {
  test(`attacked ${label} it stays out`, (t) => {
    const player = createPlayer(t, FRONT, core.ItemIdentifiers.SPINY_HELMET);
    const hole = createHole(t, player);
    track({ player });
    turn();
    turn();
    player.setLocation(new core.Location(at.x, at.y, at.z));
    for (let i = 0; i < RETREAT_IDLE_TICKS * 2; i++) {
      fightFrom(player, hole);
      turn();
    }
    assert.equal(hole.getId(), core.NpcIdentifiers.WALL_BEAST);
  });
}

test("going back into the wall, it stops anyone still targeting it: nobody attacks a hole", (t) => {
  const player = createPlayer(t, { x: FRONT.x, y: FRONT.y - 3, z: 0 });
  const hole = createHole(t, player);
  // Repelled by someone else, then targeted (not hit) from range until the beast goes back.
  const other = createPlayer(t, FRONT, core.ItemIdentifiers.SPINY_HELMET);
  const getPlayers = core.World.getPlayers;
  core.World.getPlayers = () => ({ forEach: (action) => [player, other].forEach(action) });
  t.after(() => { core.World.getPlayers = getPlayers; });
  other.getLocalNpcs = () => [hole];
  track({ player: other });
  turn();
  turn();
  other.setLocation(new core.Location(FRONT.x + 5, FRONT.y, FRONT.z));
  player.getCombat().target = hole;
  for (let i = 0; i < RETREAT_IDLE_TICKS; i++) turn();
  assert.equal(hole.getId(), core.NpcIdentifiers.HOLE_IN_THE_WALL);
  assert.equal(player.getCombat().getTarget(), null);
});

test("passing over the tile mid-run, or stopping beside it, does nothing", (t) => {
  const player = createPlayer(t, { x: FRONT.x + 1, y: FRONT.y, z: 0 });
  const hole = createHole(t, player);
  track({ player });
  turn();
  turn();
  assert.deepEqual(player.log, []);
  assert.equal(hole.getId(), core.NpcIdentifiers.HOLE_IN_THE_WALL);
  assert.ok(!player.getMovementQueue().isMovementBlocked());
});

test("a player who logs out while held is let go; a killed beast forgets its player", (t) => {
  const player = createPlayer(t);
  const hole = createHole(t, player);
  track({ player });
  turn();
  turn();
  player.setRegistered(false);
  turn();
  assert.ok(!player.getMovementQueue().isMovementBlocked());
  assert.equal(beasts.get(hole)?.stage, "rest");
  beasts.clear();

  const other = createPlayer(t, FRONT, core.ItemIdentifiers.SPINY_HELMET);
  const beast = createHole(t, other);
  track({ player: other });
  turn();
  turn();
  beast.setHitpoints(0);
  turn();
  assert.equal(beasts.size, 0);
});

test("a held player who dies or is moved off the tile gets no grab hit later, wherever they are", (t) => {
  const player = createPlayer(t);
  const hole = createHole(t, player);
  track({ player });
  for (let i = 0; i < 5; i++) turn();
  assert.ok(player.getMovementQueue().isMovementBlocked(), "held");
  player.setLocation(new core.Location(3222, 3218, 0)); // a respawn in Lumbridge
  for (let i = 0; i < GRAB_HOLD_TICKS; i++) turn();
  assert.deepEqual(pendingDamage(player), []);
  assert.ok(!player.getMovementQueue().isMovementBlocked());
  assert.ok(!player.log.includes(`anim ${seq("human_wall_beast_specialattack_end")}`));
  assert.equal(beasts.get(hole)?.stage, "rest");
});

test("the beast's normal attacks are not punished like the grab: a black mask is fine (Wiki)", (t) => {
  const player = createPlayer(t, FRONT);
  const beast = new NPC(core.NpcIdentifiers.WALL_BEAST, new core.Location(HOLE.x, HOLE.y, HOLE.z));
  const event = { attacker: beast, target: player };
  Equipment.hitRoll(event);
  assert.equal(event.forceAccurate, undefined);
  assert.equal(event.forceMaxHit, undefined);
});
