// Run after `yarn build`: node --test tests/hoop-snake.test.cjs
//
// Fossil Island's Hoop Snakes (docs/hoop-snake.md; rsprox 708, 709, 710, 3038 rev 231, 3215 rev 232; Wiki Hoop Snake):
// Stun needs a crush style ("You need to use a blunt attack to stun the snake."), can miss ("The movement of the snake
// causes you to miss."), and turns the snake into Stunned Hoop Snake (7803) with spotanim 80 for 10 ticks, then back
// at its spawn. Pick-up: anim 827, sound 2582, +1 hoop snake (21624), the snake gone for 17 ticks. Roll asks "Roll
// the hoop snake forward?"; Yes plays 827 and sends projectile 1408 to the tile 7 squares ahead (start 0, end 105,
// angle 127, progress 0, heights 0). Release: "You let the snake go."
//
// Real packets: npc_option, inventory_action and the chat menu answer go through the connection to the real plugin.
// Fixture seams: Math.random is held for the stun roll only; snakes are made here at a spawn tile, not the world's.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const SNAKE = 7802;
const STUNNED = 7803;
const ITEM = 21624;
const SPAWN = [3680, 3756];
const BLUNT = "You need to use a blunt attack to stun the snake.";
const MISS = "The movement of the snake causes you to miss.";
const RELEASE = "You let the snake go.";
const QUESTION = "Roll the hoop snake forward?";

let core;
let next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(SPAWN[0], SPAWN[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at = [SPAWN[0] - 1, SPAWN[1]]) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("hoopqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [], animations = [], sounds = [], projectiles = [], titles = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  const performAnimation = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => { animations.push(animation.getId()); return performAnimation(animation); });
  const sender = p.getPacketSender();
  const sendSoundEffect = sender.sendSoundEffect.bind(sender);
  t.mock.method(sender, "sendSoundEffect", (id, loops, delay, ...rest) => { sounds.push([id, delay]); return sendSoundEffect(id, loops, delay, ...rest); });
  // Projectile.sendProjectile broadcasts to network players, which this fixture is not; the projectile itself is read.
  t.mock.method(core.Projectile.prototype, "sendProjectile", function capture() { projectiles.push(this); });
  const dialogues = p.getDialogueManager();
  const startDialogues = dialogues.startDialogues.bind(dialogues);
  t.mock.method(dialogues, "startDialogues", (builder) => {
    titles.push(builder.getDialogues().get(0)?.getTitle?.() ?? builder.getDialogues().get(0)?.title);
    return startDialogues(builder);
  });
  core.World.getPlayers().add(p);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    if (core.World.getPlayers().contains?.(p)) core.World.getPlayers().remove(p);
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), messages, animations, sounds, projectiles, titles };
}

function tick(f, count) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    f.c.processTurnPackets();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.resetUpdating();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function snake(t) {
  const npc = core.NPC.create(SNAKE, new core.Location(SPAWN[0], SPAWN[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => {
    core.TaskManager.cancelTasks(npc);
    if (npc.isRegistered()) core.World.getNpcs().remove(npc);
  });
  return npc;
}

/** Holds Math.random for the stun's roll, so a stun lands (low) or misses (high). */
function holdRandom(t, value) {
  t.mock.method(Math, "random", () => value);
}

async function stun(t, f, npc, random = 0) {
  holdRandom(t, random);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: 3 });
  tick(f, 1);
  Math.random.mock?.restore?.();
}

async function pickUp(f, npc) {
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: 3 });
  tick(f, 1);
}

const slotOf = (f) => f.inv.getSlotForItemId(ITEM);
const action = (f, option) => send(f, { type: "inventory_action", slot: slotOf(f), itemId: ITEM, widgetId: 3214, option });
const answer = (f, option) => send(f, { type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: option });

test("a non-crush style is refused, and the snake is not stunned", async (t) => {
  const f = actor(t);
  const npc = snake(t);
  f.p.setFightType(core.FightType.DAGGER_STAB);
  await stun(t, f, npc, 0);
  assert.deepEqual(f.messages, [BLUNT]);
  assert.equal(npc.getNpcTransformationId(), -1);
});

test("a blunt stun can miss", async (t) => {
  const f = actor(t);
  const npc = snake(t);
  f.p.setFightType(core.FightType.UNARMED_PUNCH);
  await stun(t, f, npc, 0.99);
  assert.deepEqual(f.messages, [MISS]);
  assert.equal(npc.getNpcTransformationId(), -1);
  assert.deepEqual(f.animations, [], "no animation for a stun attempt");
});

test("a stun holds the snake for 10 ticks, then it is a Hoop Snake at its spawn again", async (t) => {
  const f = actor(t);
  const npc = snake(t);
  f.p.setFightType(core.FightType.UNARMED_KICK);
  const graphics = [];
  const performGraphic = npc.performGraphic.bind(npc);
  t.mock.method(npc, "performGraphic", (graphic) => { graphics.push(graphic.getId()); return performGraphic(graphic); });
  await stun(t, f, npc, 0);
  assert.deepEqual(f.messages, []);
  assert.equal(npc.getNpcTransformationId(), STUNNED);
  assert.deepEqual(graphics, [80]);
  assert.equal(npc.getMovementQueue().isMovementBlocked(), true);
  npc.setLocation(new core.Location(SPAWN[0] + 2, SPAWN[1] + 1, 0));
  tick(f, 8);
  assert.equal(npc.getNpcTransformationId(), STUNNED, "still stunned on the ninth tick");
  tick(f, 1);
  assert.equal(npc.getNpcTransformationId(), -1);
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], SPAWN);
  assert.equal(npc.getMovementQueue().isMovementBlocked(), false);
});

test("pick-up gives the hoop snake; the snake comes back at its spawn 17 ticks later", async (t) => {
  const f = actor(t);
  const npc = snake(t);
  npc.setHitpoints(5);
  await stun(t, f, npc, 0);
  await pickUp(f, npc);
  assert.equal(f.inv.getAmount(ITEM), 1);
  assert.deepEqual(f.animations, [827]);
  assert.deepEqual(f.sounds, [[2582, 10]]);
  assert.equal(npc.isVisible(), false);
  tick(f, 11);
  assert.equal(npc.isVisible(), false, "the stun's end does not bring a picked-up snake back");
  await pickUp(f, npc);
  assert.equal(f.inv.getAmount(ITEM), 1, "a hidden snake can't be picked up twice");
  tick(f, 3);
  assert.equal(npc.isVisible(), false, "still gone on the sixteenth tick");
  tick(f, 1);
  assert.equal(npc.isVisible(), true, "back on the seventeenth");
  assert.equal(npc.getHitpoints(), npc.getMaxHitpoints(), "a new snake, at full health");
  assert.equal(npc.getNpcTransformationId(), -1);
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], SPAWN);
});

test("with a full inventory the hoop snake is dropped where the snake lay", async (t) => {
  const f = actor(t);
  const npc = snake(t);
  f.inv.add(new core.Item(core.ItemIdentifiers.BRONZE_DAGGER, 28), true);
  await stun(t, f, npc, 0);
  const registered = [];
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (player, item, at) => {
    registered.push([item.getId(), at.getX(), at.getY()]);
  });
  await pickUp(f, npc);
  assert.equal(f.inv.getAmount(ITEM), 0);
  assert.deepEqual(registered, [[ITEM, SPAWN[0], SPAWN[1]]]);
});

test("Roll asks first; Yes rolls it 7 squares the way the player faces", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(ITEM, 1), true);
  t.mock.method(f.p, "getFacingDirection", () => core.Direction.EAST);
  const at = f.p.getLocation();
  await action(f, "Roll");
  assert.equal(f.titles.at(-1), QUESTION);
  await answer(f, 2);
  assert.equal(f.inv.getAmount(ITEM), 1, "No keeps the snake");
  assert.equal(f.projectiles.length, 0);
  await action(f, "Roll");
  await answer(f, 1);
  assert.equal(f.inv.getAmount(ITEM), 0);
  assert.deepEqual(f.animations, [827]);
  assert.equal(f.projectiles.length, 1);
  const shot = f.projectiles[0];
  assert.equal(shot.projectileId, 1408);
  assert.equal(shot.lockon, null);
  assert.deepEqual([shot.start.getX(), shot.start.getY()], [at.getX(), at.getY()]);
  assert.deepEqual([shot.end.getX(), shot.end.getY()], [at.getX() + 7, at.getY()]);
  const timing = shot.getTiming();
  assert.deepEqual([timing.startCycleOffset, timing.endCycleOffset], [0, 105]);
  assert.deepEqual([shot.startHeight, shot.endHeight, shot.angle, shot.progress], [0, 0, 127, 0]);
});

test("the roll goes the way the player faces, south when they face nowhere yet", (t) => {
  const f = actor(t);
  const { rollTarget } = require("../plugins/npcs/HoopSnake.plugin")._test;
  const at = f.p.getLocation();
  t.mock.method(f.p, "getFacingDirection", () => core.Direction.NORTH_EAST);
  const ne = rollTarget(f.p);
  assert.deepEqual([ne.getX(), ne.getY()], [at.getX() + 7, at.getY() + 7]);
  f.p.getFacingDirection.mock.mockImplementation(() => core.Direction.NONE);
  const south = rollTarget(f.p);
  assert.deepEqual([south.getX(), south.getY()], [at.getX(), at.getY() - 7]);
});

test("Release lets the snake go", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(ITEM, 1), true);
  await action(f, "Release");
  assert.deepEqual(f.messages, [RELEASE]);
  assert.equal(f.inv.getAmount(ITEM), 0);
  assert.deepEqual(f.animations, []);
});
