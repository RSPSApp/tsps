const assert = require("node:assert/strict");
const { before, beforeEach, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Skullball = require("../plugins/areas/WerewolfSkullball.plugin");

const core = PluginManager.getCoreApi();
const C = core.CacheDefinitions;
const I = core.ItemIdentifiers;
const { DATA, games, roll, removeBall, experienceFor, pronounText, GOAL_EVENT } = Skullball._test;
const goals = [];
let api;
let playerIndex = 28600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3560, 9885);
  api = PluginManager.createApi("WerewolfSkullballTest");
  Skullball.register(api);
  require("../plugins/treasuretrails/TreasureTrails.plugin").register(api);
  api.onCustomEvent(GOAL_EVENT, event => goals.push(event));
});

beforeEach(() => {
  for (const player of [...games.keys()]) removeBall(player);
  goals.length = 0;
  Skullball._test.setRandom(() => 0);
});

function playerAt(t, x, y, { ring = true, agility = 25 } = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null, new core.Location(x, y, 0));
  player.setIndex(playerIndex++);
  player.setUsername(`skullball-${playerIndex}`);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  const session = new Proxy({}, { get: () => () => {} });
  player.getSession = () => session;
  const sent = [];
  const sender = player.getPacketSender();
  for (const name of ["sendInterface", "sendString", "sendPositionalHint", "sendEntityHint"]) {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { sent.push([name, ...args]); return original(...args); };
  }
  const messages = [];
  player.sendMessage = message => { messages.push(message); };
  player.getSkillManager().setCurrentLevel(core.Skill.AGILITY, agility, false);
  if (ring) player.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_CHAROS, 1));
  t.after(() => { removeBall(player); player.setRegistered(false); });
  return { player, sent, messages };
}

const BOSS = () => C.getNpcId("werewolf_skullballboss");
function bossAction(player, stepId) {
  const action = { player, npcId: BOSS(), stepId, handled: false };
  api.emitCustomEvent("npc-dialogue:action", action);
  return action;
}
const startGame = player => bossAction(player, "9-jEF4");
const ball = player => games.get(player)?.npc;

function placeBall(player, x, y) {
  ball(player).setLocation(new core.Location(x, y, 0));
}

/** waa_skullball's ops in the cache: op1 Tap, op3 Kick, op4 Shoot, op5 Show-Goal. */
const OPS = { Tap: 1, Kick: 3, Shoot: 4, "Show-Goal": 5 };

/** The player stands beside the ball and uses an option, then the ball rolls until it stops. */
function play(player, option, from) {
  const npc = ball(player);
  player.setLocation(new core.Location(from[0], from[1], 0));
  PluginManager.emitNpcInteraction({ player, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), clickType: OPS[option],
    definition: npc.getCurrentDefinition?.(player) ?? npc.getDefinition?.(), option, location: { x: 0, y: 0, z: 0 }, handled: false });
  for (let i = 0; i < 12 && games.get(player)?.motion?.left > 0; i++) {
    roll();
    npc.getMovementQueue().process();
  }
}

const at = player => [ball(player).getLocation().getX(), ball(player).getLocation().getY()];

test("the goals and spawnholes are the cache map's, facing the way the Wiki's route crosses them", () => {
  const facing = { north: 0, east: 1, south: 2, west: 3 };
  const names = C.getLocNames();
  for (const [x, y, direction] of DATA.goals) {
    const mids = MapObjects.getObjectsAt(new core.Location(x, y, 0), null).filter(o => names.get(o.getId()) === "werewolf_goal_mid");
    assert.equal(mids.length, 1, `${x},${y}`);
    assert.equal(mids[0].getFace(), facing[direction], `${x},${y} faces ${direction}`);
  }
  for (const [x, y] of DATA.holes) {
    assert.ok(MapObjects.getObjectsAt(new core.Location(x, y, 0), null).some(o => names.get(o.getId()) === "waa_cavewall_skullhole"), `${x},${y}`);
    assert.equal(core.RegionManager.blocked(new core.Location(x, y + 1, 0), null), false, `the ball comes out north of ${x},${y}`);
  }
  assert.equal(DATA.goals.length, 10);
});

test("the Boss gives a ball from a spawnhole only with the ring and 25 Agility", t => {
  const low = playerAt(t, 3550, 9866, { agility: 24 });
  startGame(low.player);
  assert.equal(games.has(low.player), false);
  assert.equal(low.messages.at(-1), "You need an Agility level of 25 to play skullball.");

  const { player, sent } = playerAt(t, 3550, 9866);
  assert.equal(startGame(player).handled, true);
  assert.equal(ball(player).getId(), C.getNpcId("waa_skullball"));
  assert.deepEqual(at(player), [DATA.holes[0][0], DATA.holes[0][1] + 1]);
  assert.ok(sent.some(([name, npc]) => name === "sendEntityHint" && npc === ball(player)), "an arrow points to the ball");
  assert.equal(Skullball._test.games.get(player).scored, 0);
});

test("Tap, Kick and Shoot roll the ball 1, 4 and 9 tiles away from the player", t => {
  const { player } = playerAt(t, 3550, 9866);
  startGame(player);
  placeBall(player, 3560, 9863);
  play(player, "Tap", [3559, 9863]);
  assert.deepEqual(at(player), [3561, 9863]);
  play(player, "Kick", [3560, 9863]);
  assert.deepEqual(at(player), [3565, 9863]);
  placeBall(player, 3550, 9864);
  play(player, "Shoot", [3549, 9864]);
  assert.deepEqual(at(player), [3559, 9864]);
});

test("a ball rolled into a wall comes back the way it went for the rest of its distance", t => {
  const { player } = playerAt(t, 3550, 9866);
  startGame(player);
  // The wall at 3568,9865 (the cache map); a kick east from 3565 rolls 3566, 3567, then back to 3565.
  assert.equal(core.RegionManager.blocked(new core.Location(3568, 9865, 0), null), true);
  placeBall(player, 3565, 9865);
  play(player, "Kick", [3564, 9865]);
  assert.deepEqual(at(player), [3565, 9865]);
});

test("a goal counts only crossed the right way and in order; the first starts the timer", t => {
  const { player } = playerAt(t, 3550, 9866);
  startGame(player);
  const game = games.get(player);
  // The second goal first: through it, but not scored.
  placeBall(player, 3556, 9879);
  play(player, "Kick", [3556, 9878]);
  assert.equal(game.scored, 0);
  // The first goal, shot north through the skeleton's feet.
  placeBall(player, 3555, 9866);
  play(player, "Shoot", [3555, 9865]);
  assert.equal(game.scored, 1);
  assert.notEqual(game.startedTick, null);
  assert.deepEqual(goals.map(goal => [goal.player, goal.course, goal.goal]), [[player, "werewolf-skullball", 1]]);
  // Back south through the same goal is not a goal.
  play(player, "Shoot", [at(player)[0], at(player)[1] + 1]);
  assert.equal(game.scored, 1);
});

test("Show-Goal points the arrow at the next goal", t => {
  const { player, sent } = playerAt(t, 3550, 9866);
  startGame(player);
  games.get(player).scored = 6;
  play(player, "Show-Goal", [at(player)[0], at(player)[1] - 1]);
  const hint = sent.filter(([name]) => name === "sendPositionalHint").at(-1)[1];
  assert.deepEqual([hint.getX(), hint.getY()], [DATA.goals[6][0], DATA.goals[6][1]]);
  // The next kick puts the arrow back on the ball.
  const arrows = () => sent.filter(([name]) => name === "sendEntityHint").length;
  const before = arrows();
  play(player, "Tap", [at(player)[0], at(player)[1] - 1]);
  assert.equal(arrows(), before + 1);
  assert.equal(sent.filter(([name]) => name === "sendEntityHint").at(-1)[1], ball(player));
});

test("the final goal is the first goal again: XP by time, the scoreboard, and the ball goes", t => {
  const { player, sent } = playerAt(t, 3550, 9866);
  startGame(player);
  const game = games.get(player);
  game.scored = 10;
  game.startedTick = Skullball._test.now() - 400;
  const before = player.getSkillManager().getExperience(core.Skill.AGILITY);
  placeBall(player, 3555, 9866);
  play(player, "Shoot", [3555, 9865]);
  assert.equal(games.has(player), false, "the ball is taken away");
  assert.ok(player.getSkillManager().getExperience(core.Skill.AGILITY) > before);
  const text = component => sent.filter(([name, , id]) => name === "sendString" && id === C.getComponentId(`werewolf_goal:${component}`)).at(-1)?.[1];
  assert.ok(sent.some(([name, id]) => name === "sendInterface" && id === C.getInterfaceId("werewolf_goal")));
  // The ball crosses the goal on its fourth roll: 404 ticks, 4:02, inside the first 3 seconds over par.
  assert.equal(text("waa_time"), "4:02");
  assert.equal(text("waa_xp"), "750");
  assert.equal(goals.at(-1).goal, 11);
});

test("a slower round gives less XP on the scoreboard", t => {
  const { player, sent } = playerAt(t, 3550, 9866);
  startGame(player);
  const game = games.get(player);
  game.scored = 10;
  game.startedTick = Skullball._test.now() - 500;
  placeBall(player, 3555, 9866);
  play(player, "Shoot", [3555, 9865]);
  const text = component => sent.filter(([name, , id]) => name === "sendString" && id === C.getComponentId(`werewolf_goal:${component}`)).at(-1)?.[1];
  // 504 ticks: 5:02, 20 whole steps of 3 seconds over par.
  assert.equal(text("waa_time"), "5:02");
  assert.equal(text("waa_xp"), String(750 - 8 * 20));
});

test("750 XP under four minutes, 8 less for every 3 seconds over", () => {
  assert.equal(experienceFor(140), 750);
  assert.equal(experienceFor(240), 750);
  assert.equal(experienceFor(242), 750);
  assert.equal(experienceFor(243), 742);
  assert.equal(experienceFor(300), 750 - 8 * 20);
  assert.equal(experienceFor(10_000), 0);
});

test("the trainer's last-goal line follows the player's pronouns", t => {
  const { player } = playerAt(t, 3550, 9866);
  const line = "[He shoots/She shoots/They shoot] - [He scores/She scores/They score]!!!!!";
  player.getAppearance().getPronouns = () => 1;
  assert.equal(pronounText(line, player), "She shoots - She scores!!!!!");
  player.getAppearance().getPronouns = () => 2;
  assert.equal(pronounText(line, player), "They shoot - They score!!!!!");
});

test("giving up, or leaving the arena, takes the ball away; others can't kick it", t => {
  const owner = playerAt(t, 3550, 9866);
  startGame(owner.player);
  const other = playerAt(t, 3550, 9866);
  const npc = ball(owner.player);
  const start = at(owner.player);
  other.player.setLocation(new core.Location(start[0], start[1] - 1, 0));
  PluginManager.emitNpcInteraction({ player: other.player, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), clickType: OPS.Shoot,
    definition: npc.getDefinition?.(), option: "Shoot", location: { x: 0, y: 0, z: 0 }, handled: false });
  assert.equal(games.get(owner.player).motion, null, "only the owner's kicks move the ball");

  assert.equal(bossAction(owner.player, "VGXgYE").handled, true);
  assert.equal(games.has(owner.player), false);

  const { AreaManager } = require("../dist/game/model/areas/AreaManager");
  owner.player.setLocation(new core.Location(3552, 9866, 0));
  AreaManager.process(owner.player);
  startGame(owner.player);
  owner.player.setLocation(new core.Location(3540, 9870, 0));
  AreaManager.process(owner.player);
  assert.equal(games.has(owner.player), false, "leaving the Skullball side takes the ball");
});

test("scoring a goal with an elite Sherlock scroll for this task completes the challenge", t => {
  const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
  const elite = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails").byName.get("elite");
  const data = Runtime.data(elite);
  const sherlock = data.steps.find(step => step.skill);
  const task = [...data.tasks.values()].find(entry => entry.text === "Score a goal in skullball.");
  assert.ok(data.supportedTasks.includes(task));
  const { player, messages } = playerAt(t, 3550, 9866);
  const key = Runtime.metaKey(elite);
  const state = { version: 1, token: "skullball", revision: 0, completed: 1, length: 5, row: sherlock.row };
  player.getInventory().setItem(0, new core.Item(sherlock.itemId, 1).setMetaValue(key, state));
  player.getInventory().setItem(1, new core.Item(sherlock.skill.itemId, 1).setMetaValue(key, { ...state, task: task.row, taskDone: false }));
  startGame(player);
  placeBall(player, 3555, 9866);
  play(player, "Shoot", [3555, 9865]);
  assert.equal(player.getInventory().getItems()[1].getMetaValue(key).taskDone, true);
  assert.ok(messages.includes("You have completed your elite/master level challenge!"));
});

test("the Boss's transcript: without the ring he refuses, with a ball he offers another or takes it", t => {
  const human = playerAt(t, 3550, 9866, { ring: false });
  assert.equal(PluginManager.emitNpcDialogueVariant({ player: human.player, npcId: BOSS() }), "when-not-wearing-the-ring-of-charos");
  const { player } = playerAt(t, 3550, 9866);
  assert.equal(PluginManager.emitNpcDialogueVariant({ player, npcId: BOSS() }), "standard-dialogue");
  startGame(player);
  assert.equal(PluginManager.emitNpcDialogueVariant({ player, npcId: BOSS() }), "after-starting-the-skullball-course");
  const first = ball(player);
  games.get(player).scored = 4;
  assert.equal(bossAction(player, "AZK3fS").handled, true);
  assert.notEqual(ball(player), first, "a new ball replaces the old");
  assert.equal(first.isRegistered(), false);
  assert.equal(games.get(player).scored, 0, "and the course starts again");
});

test("Talk-To on the Boss starts his transcript in the right variant (the shared player only answers Talk-to)", t => {
  const started = [];
  api.onCustomEvent("npc-dialogue:start", request => { started.push(request); request.handled = true; });
  const { player } = playerAt(t, 3550, 9866);
  const boss = { getId: () => BOSS(), getIndex: () => 0, getLocation: () => new core.Location(3549, 9867, 0) };
  const event = { player, npc: boss, npcId: BOSS(), npcIndex: 0, clickType: 1, definition: core.NpcDefinition.forId(BOSS()),
    location: { x: 3549, y: 9867, z: 0 }, handled: false };
  assert.deepEqual(core.NpcDefinition.forId(BOSS()).getActions()[0], "Talk-To");
  PluginManager.emitNpcInteraction(event);
  assert.equal(event.handled, true);
  assert.deepEqual(started.map(request => [request.npcId, request.variant]), [[BOSS(), "standard-dialogue"]]);
});
