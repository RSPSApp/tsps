// Run after `yarn build`: node --test tests/shadow-of-the-storm-after-the-fight.test.cjs
//
// #2577, after Agrith-Naar dies, as rsprox 572 (rev 227) shows it, tick 1419 on, lines 28089-28300:
// two object boxes with Darklight (6746), a statement, then the skill menu; the wizards stay in the
// room and keep moving after completion (line 28277), with no npc removed before the player leaves.
// The player leaves by teleport at tick 1452, and the wizards are deleted then.
// Entering the room again after the quest has no capture: it rests only on the reporter.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const THRONE = [2720, 4895, 2];
const OUTSIDE = [2720, 4911, 0];
const STAGE_SUMMONED = 120;
const STAGE_COMPLETE = 130;
const CONTINUE_CHILD = { 231: 5, 217: 5, 193: 0, 229: 2 };

let core;
let I;
let next = 8100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(THRONE[0], THRONE[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.name === "Shadow of the Storm");

function actor(t, stage, at = THRONE) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("afterqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], at[2]));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  quest().setStage(p, stage);
  return { p, c, inv: p.getInventory() };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

/** emitObjectInteraction ignores an event with no object, so each click carries the real kind. */
function clickLoc(f, id, [x, y, z]) {
  const at = new core.Location(x, y, z);
  return PM.emitObjectInteraction({
    player: f.p, object: new core.GameObject(id, at, 10, 0), objectId: id, clickType: 1,
    location: { x, y, z }, sourceLocation: { x: f.p.getLocation().getX(), y: f.p.getLocation().getY(), z }, handled: false,
  });
}

const owned = (f) => [...core.World.getNpcs()].filter((npc) => npc.getOwner?.() === f.p);
// By id: other plugins' owner-only npcs also answer to this player, so owner alone isn't the cast.
const wizardsOf = (f) => {
  const N = core.NpcIdentifiers;
  const ids = new Set([N.FATHER_REEN, N.FATHER_BADDEN, N.EVIL_DAVE_2, N.MATTHEW, N.JENNIFER_2, N.PATRICK, N.CLAY_GOLEM_2]);
  return owned(f).filter((npc) => ids.has(npc.getId()));
};

async function resume(f) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  assert.ok(group in CONTINUE_CHILD, `a known chat group is open: ${group}`);
  await send(f, { type: "dialogue_continue", widgetId: (group << 16) | CONTINUE_CHILD[group], childIndex: -1 });
  ticks(f, 1);
}

const text = (f) => String(f.p.getDialogueManager().getCurrent()?.getText?.() ?? "").replace(/<br>/g, " ");

async function killDemon(t, f) {
  f.inv.add(new core.Item(I.SILVERLIGHT_2), false);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername(), isNewAccount: false });
  ticks(f, 2);
  const demon = owned(f).find((npc) => npc.getId() === core.NpcIdentifiers.AGRITH_NAAR);
  assert.ok(demon, "control: the fight restores the demon");
  PM.emitNpcDeath({ npc: demon, killer: f.p });
  ticks(f, 1);
}

test("the kill plays its flavour text in boxes, in the captured order, before the skill menu", async (t) => {
  const f = actor(t, STAGE_SUMMONED);
  await killDemon(t, f);
  assert.equal(core.MultiChatboxPrompt.getPending(f.p), null, "no skill menu yet");
  assert.equal(f.p.getPacketSender().getChatboxGroupId(), 193, "an object box");
  assert.equal(text(f), "As you strike the final blow, Silverlight is drenched with Agrith-Naar's foul-smelling ichor!");
  assert.equal(f.p.getDialogueManager().getCurrent().getItemId(), I.DARKLIGHT, "beside Darklight");
  await resume(f);
  assert.equal(f.p.getPacketSender().getChatboxGroupId(), 193, "a second object box");
  assert.match(text(f), /^You try to wipe Silverlight clean/);
  await resume(f);
  assert.equal(f.p.getPacketSender().getChatboxGroupId(), 229, "a statement");
  assert.match(text(f), /^You feel the power flowing up into your arm/);
  await resume(f);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p), "and then the skill menu");
});

test("the wizards stay in the room after completion, and go when the player leaves by the portal", async (t) => {
  const f = actor(t, STAGE_SUMMONED);
  await killDemon(t, f);
  const wizards = () => wizardsOf(f);
  t.diagnostic(`owned at the kill ${owned(f).map((npc) => npc.getId())}`);
  assert.ok(wizards().length > 0, "control: the cast is there at the kill");
  const count = wizards().length;
  PM.emitCustomEvent("npc-dialogue:choice", { player: f.p, npcId: core.NpcIdentifiers.MATTHEW, option: "* Strength *" });
  PM.emitCustomEvent("npc-dialogue:action", { player: f.p, npcId: core.NpcIdentifiers.MATTHEW, stepId: "EDRKBv", handled: false });
  ticks(f, 5);
  assert.equal(quest().getStage(f.p), STAGE_COMPLETE, "control: complete");
  assert.equal(wizards().length, count, "nobody leaves");
  assert.equal(owned(f).some((npc) => npc.getId() === core.NpcIdentifiers.AGRITH_NAAR), false, "only the demon has gone");
  assert.equal(clickLoc(f, 6282, [f.p.getLocation().getX(), f.p.getLocation().getY() - 1, 2]), true, "control: the portal took the click");
  ticks(f, 2);
  assert.equal(f.p.getLocation().getZ(), 0, "control: the portal takes the player out");
  assert.equal(wizards().length, 0, "and the cast is gone");
});

test("the wizards go when the player teleports out, but not before the quest is complete", async (t) => {
  const teleport = (f) => {
    PM.updatePlayerZones(f.p);
    f.p.moveTo(new core.Location(3222, 3218, 0));
    ticks(f, 1);
    PM.updatePlayerZones(f.p);
    assert.equal(f.p.getLocation().getX(), 3222, "control: the player left");
  };
  const wizards = wizardsOf;

  const fighting = actor(t, STAGE_SUMMONED);
  await killDemon(t, fighting);
  const count = wizards(fighting).length;
  assert.ok(count > 0, "control: the cast is there at the kill");
  teleport(fighting);
  assert.equal(wizards(fighting).length, count, "control: leaving before completion changes nothing");

  const f = actor(t, STAGE_SUMMONED);
  await killDemon(t, f);
  PM.emitCustomEvent("npc-dialogue:choice", { player: f.p, npcId: core.NpcIdentifiers.MATTHEW, option: "* Strength *" });
  PM.emitCustomEvent("npc-dialogue:action", { player: f.p, npcId: core.NpcIdentifiers.MATTHEW, stepId: "EDRKBv", handled: false });
  ticks(f, 5);
  assert.equal(quest().getStage(f.p), STAGE_COMPLETE, "control: complete");
  assert.ok(wizards(f).length > 0, "control: the cast stayed");
  teleport(f);
  assert.equal(wizards(f).length, 0, "and goes with the teleport");
});

test("the throne room can be entered again after the quest", async (t) => {
  const f = actor(t, STAGE_COMPLETE, OUTSIDE);
  assert.equal(clickLoc(f, 6310, [2720, 4912, 0]), true, "control: the portal took the click");
  ticks(f, 2);
  const at = f.p.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [2720, 4884, 2], "through the portal");
});
