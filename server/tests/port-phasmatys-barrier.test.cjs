// Run after `yarn build`: node --test tests/port-phasmatys-barrier.test.cjs
//
// The Port Phasmatys energy barriers against the Wiki (2 ecto-tokens and a ghostspeak amulet
// before Ghosts Ahoy, free after), Transcript:Ghost guard, and rsprox 231/00378 (a tick facing
// the barrier, then a walk through it a tile a tick), on a real Player.
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');

let Barrier, core;
const hooks = { objects: {}, custom: {}, variant: null, condition: null };
const state = { complete: false, stage: 0, dialogues: [] };

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  core = PluginManager.getCoreApi();
  const api = {
    core,
    getTaskManager: () => TaskManager,
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onNpcDialogueVariant: (handler) => { hooks.variant = handler; },
    onNpcDialogueCondition: (handler) => { hooks.condition = handler; },
    onCustomEvent: (name, handler) => { (hooks.custom[name] ??= []).push(handler); },
    emitCustomEvent: (name, payload) => {
      if (name === 'quest:is-complete' && payload.name === 'Ghosts Ahoy') payload.complete = state.complete;
      if (name === 'quest:get-stage' && payload.name === 'Ghosts Ahoy') payload.stage = state.stage;
      if (name === 'npc-dialogue:start') { state.dialogues.push([payload.npcId, payload.variant]); payload.handled = true; }
    },
  };
  Barrier = require('../plugins/areas/PortPhasmatysBarrier.plugin');
  Barrier.register(api);
});

beforeEach(() => {
  state.complete = false;
  state.stage = 0;
  state.dialogues.length = 0;
});

const I = () => core.ItemIdentifiers;

function realPlayer(t, x, y) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setLocation(new Location(x, y, 0));
  p.messages = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, 'sendMessage', (text) => { p.messages.push(text); });
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendTypedMessage', (type, text) => { p.messages.push(text); return sender; });
  t.mock.method(p, 'isRegistered', () => true);
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.mock.method(p.getEquipment(), 'refreshItems', () => p.getEquipment());
  return p;
}

function wear(p, id, slot) {
  p.getEquipment().setItem(slot, new core.Item(id, 1));
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

/** The north barrier the recording walked through (rotation 3: an east-west line at y=3508). */
const north = () => MapObjects.get(core.CacheDefinitions.getLocId('ahoy_town_barrier_multi'), new Location(3659, 3508, 0), null);
const click = (p, option, object = north()) => {
  const at = object.getLocation();
  return hooks.objects['Energy Barrier'][option]({ player: p, object, objectId: object.getId(), location: { x: at.getX(), y: at.getY(), z: 0 }, handled: false });
};
const tokens = (p) => p.getInventory().getAmount(I().ECTO_TOKEN);

test('after Ghosts Ahoy, Pass walks through free: 3508 then 3507 on the next two ticks (rsprox 231/00378)', (t) => {
  state.complete = true;
  const p = realPlayer(t, 3660, 3509);
  // The handler runs the tick after arriving, the tick the recording faces the barrier.
  assert.equal(click(p, 'Pass'), true);
  const ys = [];
  for (let i = 0; i < 3; i++) { ticks(1); ys.push(p.getLocation().getY()); }
  assert.deepEqual(ys, [3508, 3507, 3507]);
  assert.equal(p.getLocation().getX(), 3660);
  assert.deepEqual(p.messages, [], 'no message, as recorded');
});

test('Pay-toll with a ghostspeak amulet and exactly 2 ecto-tokens: both taken, then through', (t) => {
  const p = realPlayer(t, 3660, 3509);
  wear(p, I().GHOSTSPEAK_AMULET, core.Equipment.AMULET_SLOT);
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 2));
  click(p, 'Pay-toll(2-Ecto)');
  assert.equal(tokens(p), 0);
  ticks(4);
  assert.equal(p.getLocation().getY(), 3507);
});

test('a double click pays once: the second waits for the first walk', (t) => {
  const p = realPlayer(t, 3660, 3509);
  wear(p, I().GHOSTSPEAK_AMULET_2, core.Equipment.AMULET_SLOT);
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 4));
  click(p, 'Pay-toll(2-Ecto)');
  ticks(1);
  click(p, 'Pay-toll(2-Ecto)'); // standing on the same tile, mid-crossing
  ticks(4);
  assert.equal(tokens(p), 2);
  assert.equal(p.getLocation().getY(), 3507);
});

test('one ecto-token: nothing taken, nobody moves, and the guard asks for his toll (Ghosts Ahoy capture ticks 105-106)', (t) => {
  const p = realPlayer(t, 3660, 3509);
  wear(p, I().MORYTANIA_LEGS_2, core.Equipment.LEG_SLOT);
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 1));
  click(p, 'Pay-toll(2-Ecto)');
  ticks(3);
  assert.equal(tokens(p), 1);
  assert.equal(p.getLocation().getY(), 3509);
  assert.deepEqual(p.messages, ["You don't have enough tokens to pay the toll."]);
  assert.deepEqual(state.dialogues, [[core.NpcIdentifiers.GHOST_GUARD, 'standard-dialogue-before-or-during-ghosts-ahoy']]);
  // His menu then offers only the captured two (ticks 108, 119): the toll options are for 2 tokens.
  assert.equal(hooks.condition({ player: p, npcId: core.NpcIdentifiers.GHOST_GUARD, text: 'If the player has at least 2 Ectotokens:' }), false);
  assert.equal(hooks.condition({ player: p, npcId: core.NpcIdentifiers.GHOST_GUARD, text: 'If the player has fewer than 2 Ectotokens:' }), true);
});

test('paying in says so; walking out of the town is free (capture ticks 141, 215, 1628)', (t) => {
  const p = realPlayer(t, 3659, 3509);
  wear(p, I().GHOSTSPEAK_AMULET, core.Equipment.AMULET_SLOT);
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 45));
  click(p, 'Pay-toll(2-Ecto)');
  assert.equal(tokens(p), 43);
  assert.deepEqual(p.messages, [Barrier.PAID_TOLL]);
  ticks(4);
  assert.equal(p.getLocation().getY(), 3507);
  click(p, 'Pay-toll(2-Ecto)');
  ticks(4);
  assert.equal(p.getLocation().getY(), 3509, 'out of the town');
  assert.equal(tokens(p), 43, 'for nothing');
});

test('the bedsheet stops the crossing with its message box (capture tick 1621)', (t) => {
  const p = realPlayer(t, 3660, 3507);
  wear(p, I().GHOSTSPEAK_AMULET, core.Equipment.AMULET_SLOT);
  wear(p, I().BEDSHEET_2, core.Equipment.HEAD_SLOT);
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 2));
  const started = [];
  t.mock.method(p.getDialogueManager(), 'startDialogues', (builder) => { started.push([...builder.getDialogues().values()]); });
  click(p, 'Pay-toll(2-Ecto)');
  ticks(4);
  assert.equal(p.getLocation().getY(), 3507);
  assert.equal(tokens(p), 2);
  assert.equal(started[0][0].getText(), Barrier.BEDSHEET_REFUSAL);
});

test('from Necrovarus commanded (questvar 7) the toll is gone (capture tick 1952)', (t) => {
  state.stage = 7;
  const p = realPlayer(t, 3660, 3509);
  wear(p, I().GHOSTSPEAK_AMULET, core.Equipment.AMULET_SLOT);
  click(p, 'Pay-toll(2-Ecto)');
  ticks(4);
  assert.equal(p.getLocation().getY(), 3507);
  assert.deepEqual(p.messages, []);
});

test('without a ghostspeak amulet the guards wail and nothing is taken (Transcript:Ghost guard)', (t) => {
  const p = realPlayer(t, 3660, 3509);
  wear(p, I().MORYTANIA_LEGS_1, core.Equipment.LEG_SLOT); // legs 1 isn't enough
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 2));
  click(p, 'Pay-toll(2-Ecto)');
  assert.equal(tokens(p), 2);
  assert.deepEqual(p.messages, [Barrier.MAY_NOT_PASS]);
});

test('the west barrier (rotation 2) is crossed east-west, keeping the row', (t) => {
  state.complete = true;
  const west = MapObjects.get(core.CacheDefinitions.getLocId('ahoy_town_barrier_multi'), new Location(3652, 3485, 0), null);
  assert.ok(west);
  const p = realPlayer(t, 3651, 3486);
  click(p, 'Pass', west);
  ticks(4);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3653, 3486]);
});

test("Pass before the quest is the guard's toll talk; its pay step takes the toll and walks through", (t) => {
  const p = realPlayer(t, 3660, 3509);
  wear(p, I().GHOSTSPEAK_AMULET, core.Equipment.AMULET_SLOT);
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 3));
  click(p, 'Pass');
  assert.deepEqual(state.dialogues, [[core.NpcIdentifiers.GHOST_GUARD, 'standard-dialogue-before-or-during-ghosts-ahoy']]);
  const guard = core.NpcIdentifiers.GHOST_GUARD;
  assert.equal(hooks.condition({ player: p, npcId: guard, text: 'If the player wears either a ghostspeak amulet or the Morytania legs 2 or above:' }), true);
  const step = { player: p, npcId: guard, stepId: Barrier.PAY_STEP, handled: false };
  for (const handler of hooks.custom['npc-dialogue:action']) handler(step);
  assert.equal(step.handled, true);
  assert.equal(tokens(p), 1);
  ticks(4);
  assert.equal(p.getLocation().getY(), 3507);
});

test("the amulet taken off after the guard's question: the pay step takes nothing and nobody crosses", (t) => {
  const p = realPlayer(t, 3660, 3509);
  wear(p, I().GHOSTSPEAK_AMULET, core.Equipment.AMULET_SLOT);
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 3));
  click(p, 'Pass');
  const guard = core.NpcIdentifiers.GHOST_GUARD;
  assert.equal(hooks.condition({ player: p, npcId: guard, text: 'If the player wears either a ghostspeak amulet or the Morytania legs 2 or above:' }), true);
  p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(-1, 0)); // the equipment tab leaves the dialogue open
  const step = { player: p, npcId: guard, stepId: Barrier.PAY_STEP, handled: false };
  for (const handler of hooks.custom['npc-dialogue:action']) handler(step);
  assert.equal(tokens(p), 3, "no toll taken");
  ticks(4);
  assert.equal(p.getLocation().getY(), 3509, "still outside");
});

test('the guard picks his after-quest talk once Ghosts Ahoy is done; other NPCs are left alone', (t) => {
  const p = realPlayer(t, 3660, 3509);
  assert.equal(hooks.variant({ player: p, npcId: core.NpcIdentifiers.GHOST_GUARD }), 'standard-dialogue-before-or-during-ghosts-ahoy');
  state.complete = true;
  assert.equal(hooks.variant({ player: p, npcId: core.NpcIdentifiers.GHOST_GUARD }), 'standard-dialogue-after-ghosts-ahoy');
  assert.equal(hooks.variant({ player: p, npcId: 3014 }), null);
});

test("Castle Wars' Energy Barriers aren't taken", (t) => {
  const p = realPlayer(t, 2426, 3079);
  const other = { getId: () => core.ObjectIdentifiers.ENERGY_BARRIER, getLocation: () => new Location(2426, 3080, 1), getFace: () => 0 };
  assert.equal(click(p, 'Pass', other), false);
});

const guard = () => core.NpcIdentifiers.GHOST_GUARD;
const fire = (step) => { for (const handler of hooks.custom['npc-dialogue:action']) handler(step); return step; };

test("Talk-to the guard from beside him (off the crossing): his pay step steps over, pays and walks through", (t) => {
  const p = realPlayer(t, 3658, 3509); // west of the guard at 3658,3508's line end, north side
  wear(p, I().GHOSTSPEAK_AMULET, core.Equipment.AMULET_SLOT);
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 2));
  const step = fire({ player: p, npcId: guard(), stepId: Barrier.PAY_STEP, handled: false });
  assert.equal(step.handled, true);
  assert.equal(tokens(p), 0);
  ticks(5);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3659, 3507]);
});

test('the pay step far from any barrier takes nothing', (t) => {
  const p = realPlayer(t, 3670, 3490);
  wear(p, I().GHOSTSPEAK_AMULET, core.Equipment.AMULET_SLOT);
  p.getInventory().add(new core.Item(I().ECTO_TOKEN, 2));
  fire({ player: p, npcId: guard(), stepId: Barrier.PAY_STEP, handled: false });
  assert.equal(tokens(p), 2);
});

test("after the quest the guard's line waves you through once read; the wail does too", (t) => {
  state.complete = true;
  const p = realPlayer(t, 3658, 3509);
  const line = { player: p, npcId: guard(), text: `${Barrier.FREE_LINE} you have done the ghosts of our town a service`, after: null };
  for (const handler of hooks.custom['npc-dialogue:line']) handler(line);
  ticks(3);
  assert.equal(p.getLocation().getY(), 3509, 'not before the line is read');
  line.after();
  ticks(5);
  assert.equal(p.getLocation().getY(), 3507);
  const q = realPlayer(t, 3661, 3507); // south side, beside the east line end
  fire({ player: q, npcId: guard(), stepId: Barrier.FREE_MESSAGE_STEP, kind: 'message', handled: false });
  ticks(5);
  assert.equal(q.getLocation().getY(), 3509, 'and out the other way');
});
