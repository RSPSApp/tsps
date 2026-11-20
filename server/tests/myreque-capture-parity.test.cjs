// Run after `yarn build`: node --test tests/myreque-capture-parity.test.cjs
// In Search of the Myreque against an rsprox capture of a whole live playthrough (revision 242;
// docs/in-search-of-the-myreque.md lists the facts by tick). Real PluginManager, Players, cache, map and tasks.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');

const STAGE = 'quest.in_search_of_the_myreque.stage';
const BRIDGE = 'quest.in_search_of_the_myreque.bridge';
let core, next = 5600;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => runtime.getRegisteredQuests().find((q) => q.key === 'in_search_of_the_myreque');

/** A real player whose packets, messages and animations are recorded. */
function actor(t, stage, x, y, z = 0) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('myrequecap' + next);
  p.setRegistered(true); p.setLocation(new core.Location(x, y, z)); p.needsPlacement = false;
  p.setAttribute('bot-skip-persistence', true);
  p.setAttribute(STAGE, stage);
  p.messages = []; p.anims = []; p.varbits = []; p.sounds = []; p.objects = []; p.removed = []; p.interfaces = []; p.graphics = [];
  p.sendMessage = (text) => { p.messages.push(text); };
  const perform = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { p.anims.push(animation.getId?.() ?? animation.id); return perform(animation); };
  const graphic = p.performGraphic.bind(p);
  p.performGraphic = (g) => { p.graphics.push([g.id, g.height]); return graphic(g); };
  const sender = p.getPacketSender();
  const wrap = (name, record) => { const original = sender[name].bind(sender); sender[name] = (...args) => { record(...args); return original(...args); }; };
  wrap('sendVarbit', (id, value) => p.varbits.push([id, value]));
  wrap('sendSound', (id, loops, delay) => p.sounds.push([id, delay]));
  wrap('sendObject', (object) => p.objects.push([object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]));
  wrap('sendObjectRemoval', (object) => p.removed.push([object.getId(), object.getLocation().getX(), object.getLocation().getY()]));
  wrap('sendInterface', (id) => p.interfaces.push(id));
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const login = (p) => PM.emitPlayerLogin({ player: p, username: p.getUsername() });
const at = (p) => { const l = p.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
const varbit = (p, id) => p.varbits.filter(([v]) => v === id).map(([, value]) => value);

/** One game tick: tasks, then movement, as the engine orders them. */
function tick(p, n = 1) {
  for (let i = 0; i < n; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    for (const player of [p].flat()) {
      const q = player.getMovementQueue(); q.beginCycle?.(); if (q.hasPendingWork?.()) q.process();
      core.TaskManager.processWalkTo(player.getIndex());
      core.AreaManager?.process?.(player);
      player.setNeedsPlacement(false); player.setResetMovementQueue(false);
    }
  }
}

function placed(x, y, ids) {
  return MapObjects.getObjectsAt(new core.Location(x, y, 0), null).find((o) => ids.includes(o.getId()));
}

/** Clicks a real placed loc's option the way the packet does, from where the player stands. */
function click(p, object, option) {
  const actions = ObjectDefinition.forPlayer(object.getId(), p).getActions();
  const clickType = actions.indexOf(option) + 1;
  assert.ok(clickType > 0, `${object.getId()} offers ${option}: ${JSON.stringify(actions)}`);
  const event = { player: p, object, objectId: object.getId(), location: object.getLocation(), clickType,
    definition: ObjectDefinition.forPlayer(object.getId(), p), handled: false };
  PM.emitObjectInteraction(event);
  return event;
}

function bridgeMaterials(p, rungs = 3) {
  const I = core.ItemIdentifiers;
  p.getInventory().adds(I.PLANK, rungs); p.getInventory().adds(I.STEEL_NAILS, 75 * rungs); p.getInventory().adds(I.HAMMER, 1);
}

const SOUTH_TREE = () => placed(3502, 3426, [5003]);
const NORTH_TREE = () => placed(3502, 3431, [5003]);
const rung = (y) => placed(3502, y, [26245, 26246, 26247]);

test('the south tree: human_reachforladder, then "You climb up the tree." and (3502,3427) the next tick', (t) => {
  const p = actor(t, 25, 3502, 3425);
  click(p, SOUTH_TREE(), 'Climb');
  assert.deepEqual(p.anims, [828]);
  assert.deepEqual(at(p), [3502, 3425, 0], 'not moved on the click tick');
  assert.deepEqual(p.messages, []);
  tick(p);
  assert.deepEqual(p.messages, ['You climb up the tree.']);
  assert.deepEqual(at(p), [3502, 3427, 0]);
});

test('a rung repair: the hammering on the click, then three ticks on the message, the varbits, the materials and a walk onto the rung', (t) => {
  const p = actor(t, 25, 3502, 3427);
  bridgeMaterials(p, 1);
  click(p, rung(3428), 'Repair');
  assert.deepEqual(p.anims, [15168]);
  assert.deepEqual(p.sounds.filter(([id]) => id === 2101).map(([, delay]) => delay), [0, 20, 40]);
  tick(p, 2);
  assert.deepEqual(p.messages, [], 'nothing before the third tick');
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.PLANK), 1);
  tick(p);
  assert.deepEqual(p.messages, ['You repair a section of the bridge.']);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.PLANK), 0);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STEEL_NAILS), 0);
  assert.deepEqual(varbit(p, 176), [1]);
  assert.deepEqual(varbit(p, 3928), [1], 'route_bridgecomplete gets the rung bit');
  tick(p);
  assert.deepEqual(at(p), [3502, 3428, 0], 'walked onto the repaired rung');
});

test('route_bridgecomplete counts each rung: 1, 3, 7, and the north tree then crosses down to (3502,3432)', (t) => {
  const p = actor(t, 25, 3502, 3427);
  bridgeMaterials(p, 3);
  for (const y of [3428, 3429, 3430]) {
    click(p, rung(y), 'Repair');
    tick(p, 4);
    assert.deepEqual(at(p), [3502, y, 0], `on the rung at ${y}`);
  }
  assert.deepEqual(varbit(p, 3928), [1, 3, 7]);
  p.messages.length = 0; p.anims.length = 0;
  click(p, NORTH_TREE(), 'Cross-bridge');
  assert.deepEqual(p.anims, [827]);
  assert.deepEqual(p.messages, ['You climb down the tree.'], 'the message comes with the animation (capture 684, 841)');
  assert.deepEqual(at(p), [3502, 3430, 0], 'the move comes a tick later');
  click(p, NORTH_TREE(), 'Cross-bridge');
  assert.deepEqual(p.anims, [827], 'a second click mid-climb waits');
  tick(p);
  assert.deepEqual(p.messages, ['You climb down the tree.']);
  assert.deepEqual(at(p), [3502, 3432, 0]);
});

test('#6264: a repaired bridge is walked both ways; a broken rung still blocks', (t) => {
  const p = actor(t, 52, 3502, 3425);
  p.setAttribute(BRIDGE, 0b111);
  login(p);
  click(p, SOUTH_TREE(), 'Cross-bridge');
  tick(p);
  assert.deepEqual(at(p), [3502, 3427, 0]);
  p.getMovementQueue().walkStep(0, 1); tick(p);
  p.getMovementQueue().walkStep(0, 1); tick(p);
  p.getMovementQueue().walkStep(0, 1); tick(p);
  assert.deepEqual(at(p), [3502, 3430, 0], 'north along the bridge');
  p.getMovementQueue().walkStep(0, -1); tick(p);
  p.getMovementQueue().walkStep(0, -1); tick(p);
  p.getMovementQueue().walkStep(0, -1); tick(p);
  assert.deepEqual(at(p), [3502, 3427, 0], 'and back south');
  p.getMovementQueue().walkStep(1, 0); tick(p);
  assert.deepEqual(at(p), [3502, 3427, 0], 'not off the side');

  // Logged in on the landing (a save from the bridge): put back in the bridge area.
  const q = actor(t, 25, 3502, 3427);
  q.setAttribute(BRIDGE, 0b001);
  login(q);
  q.getMovementQueue().walkStep(0, 1); tick(q);
  assert.deepEqual(at(q), [3502, 3428, 0], 'the repaired rung');
  q.getMovementQueue().walkStep(0, 1); tick(q);
  assert.deepEqual(at(q), [3502, 3428, 0], 'the broken rung blocks');
  assert.equal((RegionManager.getClipping(3502, 3428, 0, null) & RegionManager.BLOCKED_MASK) !== 0, true,
    'the map itself still blocks the rung for everyone else');
});

test('a completed quest has the whole bridge repaired', (t) => {
  const p = actor(t, 105, 3502, 3425);
  login(p);
  assert.deepEqual([varbit(p, 176).at(-1), varbit(p, 177).at(-1), varbit(p, 178).at(-1), varbit(p, 3928).at(-1)], [1, 1, 1, 7]);
});

// ---- Conversations through the real transcript runner ----
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const PAGE = 'In Search of the Myreque';

/**
 * Plays a conversation one tick per step: a menu takes the next scripted option, a line is continued; every step is a
 * game tick. `start` begins it; it runs until the chat is idle for `idleTicks` ticks in a row or `maxTicks` pass.
 */
async function converse(p, start, script = [], { maxTicks = 200, idleTicks = 4, onTick } = {}) {
  const channel = p.getSession?.().getChannel?.();
  const connection = new ClientConnection(channel ?? { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  connection.player = p;
  const lines = [];
  const sender = p.getPacketSender();
  const original = sender.sendString.bind(sender);
  sender.sendString = (text, ...rest) => { if (typeof text === 'string' && text) lines.push(text); return original(text, ...rest); };
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  start();
  let picks = 0, idle = 0;
  for (let n = 0; n < maxTicks && idle < idleTicks; n++) {
    onTick?.(n, lines);
    const current = p.getDialogueManager().getCurrent();
    const pending = MultiChatboxPrompt.getPending(p) ?? (typeof current?.getOptions === 'function' ? { options: current.getOptions() } : null);
    if (pending) {
      const index = picks < script.length ? pending.options.indexOf(script[picks]) : -1;
      if (index < 0) break;
      picks++;
      idle = 0;
      await send({ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
    } else if (p.getDialogueManager().getCurrent()) {
      idle = 0;
      await send({ type: 'dialogue_continue', widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
    } else {
      idle++;
    }
    tick(p);
  }
  sender.sendString = original;
  return lines;
}

const WEAPONS = [['STEEL_LONGSWORD', 1], ['STEEL_SHORTSWORD', 2], ['STEEL_DAGGER', 1], ['STEEL_MACE', 1], ['STEEL_WARHAMMER', 1]];
const giveWeapons = (p) => { for (const [name, amount] of WEAPONS) p.getInventory().adds(core.ItemIdentifiers[name], amount); };
const metAll = (p) => { for (const flag of ['met_sani', 'met_harold', 'met_radigad', 'met_polmafi', 'met_ivan']) p.setAttribute(`quest.in_search_of_the_myreque.${flag}`, true); };
const sceneNpcs = (p) => [...core.World.getNpcs()].filter((npc) => npc?.__questSceneOwner === p);

test('the hand-in: stage 67 with "You give the weapons to Veliaf.", then the cutscene in a copy of the hideout, the hound, the kill, and Veliaf talks by himself', async (t) => {
  const p = actor(t, 65, 3506, 9837);
  giveWeapons(p); metAll(p);
  login(p);
  const stages = [];
  const seen = { cast: null, vanstrom: false, hound: false, inCopy: false };
  const lines = await converse(p, () => PM.emitCustomEvent('npc-dialogue:start', {
    player: p, npcId: core.NpcIdentifiers.VELIAF_HURTZ_2,
    variant: { page: PAGE, variant: 'myreque-hideout-speaking-to-veliaf-after-introduced-to-other-members' }, exact: true,
  }), ["Let's talk about the weapons."], {
    maxTicks: 120, idleTicks: 16,
    onTick: () => {
      const stage = quest().getStage(p);
      if (stages.at(-1) !== stage) stages.push(stage);
      const ids = sceneNpcs(p).map((npc) => npc.getId());
      if (ids.includes(9621) && !seen.cast) seen.cast = ids.slice().sort();
      if (ids.includes(9632)) seen.vanstrom = true;
      if (ids.includes(5054)) seen.hound = true;
      if (p.getPrivateArea()?.usesTemplateMap?.()) seen.inCopy = true;
    },
  });
  assert.ok(lines.includes('You give the weapons to Veliaf.'), JSON.stringify(lines.slice(0, 6)));
  for (const [name] of WEAPONS) assert.equal(p.getInventory().getAmount(core.ItemIdentifiers[name]), 0, `${name} handed over`);
  assert.deepEqual(stages.filter((s) => s > 65), [67, 70, 80], `stages ${JSON.stringify(stages)}`);
  assert.ok(seen.inCopy, 'the cutscene plays in a copy of the map');
  assert.deepEqual(seen.cast, [9621, 9623, 9625, 9627, 9629, 9631], 'the six members in their cutscene forms');
  assert.ok(seen.vanstrom, 'Vanstrom steps out of the mist');
  assert.ok(seen.hound, 'the hound is summoned');
  assert.deepEqual(varbit(p, 396).at(-1), 1, 'the pub shows the Stranger from the cutscene on');
  const cast = sceneNpcs(p).map((npc) => npc.getId()).sort();
  assert.deepEqual(cast, [5054, 9621, 9627, 9629, 9631], 'Sani and Harold are dead; the hound fights');
  assert.ok(p.getPrivateArea()?.getObjects().some((o) => o.getId() === 38094), 'the copy\'s tunnel is the escape');

  // The kill: stage 85, out of the copy onto (3506,9837), and Veliaf's words start by themselves.
  const hound = sceneNpcs(p).find((npc) => npc.getId() === 5054);
  PM.emitNpcDeath({ npc: hound, npcId: 5054, killer: p, player: p });
  assert.equal(quest().getStage(p), 85);
  const after = await converse(p, () => {}, [], { maxTicks: 12, idleTicks: 12 });
  assert.deepEqual(at(p), [3506, 9837, 0]);
  assert.equal(p.getPrivateArea(), null, 'back in the real hideout');
  assert.ok(after.includes('Sani... Harold... That murderer killed them!'), `Veliaf starts talking: ${JSON.stringify(after.slice(0, 3))}`);
  assert.ok(!p.messages.includes('You have defeated the Skeleton Hellhound.'), 'no kill message');
});

test('back through the tunnel while the fight is unfinished, the hound is there again, by the entrance', (t) => {
  const p = actor(t, 80, 3505, 9832);
  PM.emitCustomEvent('loc-teleports:arrived', { player: p, objectId: core.ObjectIdentifiers.CAVE_ENTRANCE_27, location: { x: 3492, y: 9823, z: 0 } });
  tick(p);
  const hound = [...core.World.getNpcs()].find((npc) => npc?.getId?.() === 5054 && npc.getLocation().getX() === 3505 && npc.getLocation().getY() === 9834);
  assert.ok(hound, 'the hound waits by the entrance');
  core.World.getNpcs().remove?.(hound);
  PM.emitPlayerLogout?.({ player: p, username: p.getUsername() });
});

test('the doors in the earth: stage 60 on the click, the open doors and the fade the next tick, the cave two ticks on; no message', (t) => {
  const p = actor(t, 55, 3509, 3449);
  const doors = placed(3509, 3447, [5061, 5060]);
  assert.ok(doors, 'the doors are placed');
  click(p, doors, 'Open');
  assert.equal(quest().getStage(p), 60);
  assert.deepEqual(p.anims, [832]);
  tick(p);
  assert.deepEqual(p.objects.map(([id]) => id).sort(), [5062, 5063]);
  assert.ok(p.sounds.some(([id]) => id === 71));
  tick(p, 2);
  assert.deepEqual(at(p), [3500, 9811, 0]);
  assert.deepEqual(p.messages, []);
});

test('crawling into the hideout at stage 60: Harold asks who you are two ticks after the arrival', async (t) => {
  const p = actor(t, 60, 3505, 9832);
  let lines = [];
  lines = await converse(p, () => PM.emitCustomEvent('loc-teleports:arrived', {
    player: p, objectId: core.ObjectIdentifiers.CAVE_ENTRANCE_27, location: { x: 3492, y: 9823, z: 0 },
  }), [], { maxTicks: 20, idleTicks: 6 });
  assert.deepEqual(lines.slice(0, 2), ['Harold Evans', 'Hey! Who are you and why are you here?'], JSON.stringify(lines.slice(0, 3)));
});

test('the hidden wall: stage 95, the open wall for two ticks and one walk step north; no messages', (t) => {
  const p = actor(t, 90, 3480, 9836);
  const wall = placed(3480, 9837, [5052]);
  assert.ok(wall);
  click(p, wall, 'Search');
  assert.equal(quest().getStage(p), 95);
  assert.deepEqual(p.objects.map(([id, x, y, face]) => [id, x, y, face]), [[38848, 3480, 9837, 3], [5053, 3480, 9836, 0]]);
  assert.ok(p.sounds.some(([id]) => id === 62));
  tick(p);
  assert.deepEqual(at(p), [3480, 9837, 0]);
  tick(p, 2);
  assert.deepEqual(p.objects.at(-1).slice(0, 3), [5052, 3480, 9837], 'the wall is back');
  assert.deepEqual(p.removed, [[5053, 3480, 9836]]);
  assert.deepEqual(p.messages, []);
  p.getMovementQueue().walkStep(0, -1); tick(p);
  assert.deepEqual(at(p), [3480, 9837, 0], 'the wall blocks again');
});

test('the basement ladder: human_reachforladder, then (3495,3465) and stage 97 the next tick', (t) => {
  const p = actor(t, 95, 3477, 9845);
  const ladder = placed(3477, 9846, [5054]);
  assert.ok(ladder);
  click(p, ladder, 'Climb-up');
  assert.deepEqual(p.anims, [828]);
  assert.equal(quest().getStage(p), 95);
  tick(p);
  assert.deepEqual(at(p), [3495, 3465, 0]);
  assert.equal(quest().getStage(p), 97);
  assert.deepEqual(p.messages, []);
});

test("Cyreg's Travel: the fare on the click, the journey interface the next tick, the Hollows fifteen ticks on (stage 25)", (t) => {
  const p = actor(t, 20, 3521, 3285);
  p.getInventory().adds(core.ItemIdentifiers.COINS, 10);
  const cyreg = core.NPC.create(core.NpcIdentifiers.CYREG_PADDLEHORN, new core.Location(3522, 3285, 0));
  PM.emitNpcInteraction({ player: p, npc: cyreg, npcId: cyreg.getId(), action: 'Travel', clickType: 3, handled: false });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  tick(p);
  assert.deepEqual(p.interfaces, [321]);
  tick(p, 13);
  assert.deepEqual(at(p), [3521, 3285, 0], 'still at Mort\'ton on tick 14');
  tick(p);
  assert.deepEqual(at(p), [3498, 3380, 0]);
  assert.equal(quest().getStage(p), 25);
});

test('the Mort\'ton boat asks for the fare in Cyreg\'s words first', async (t) => {
  const p = actor(t, 52, 3521, 3285);
  p.getInventory().adds(core.ItemIdentifiers.COINS, 10);
  const boat = placed(3523, 3284, [6969]) ?? MapObjects.getObjectsAt(new core.Location(3522, 3283, 0), null).find((o) => o.getId() === 6969);
  assert.ok(boat, 'the boat is placed');
  const lines = await converse(p, () => click(p, boat, 'Board'), ["Yes, I'll pay the ten gold."], { maxTicks: 30, idleTicks: 20 });
  assert.deepEqual(lines.slice(0, 2), ['Cyreg Paddlehorn', "I'll have to charge you ten gold to cover the loan of the boat. Is that okay?"]);
  assert.ok(lines.includes("Yes, I'll pay the ten gold."), JSON.stringify(lines));
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.deepEqual(at(p), [3498, 3380, 0]);
});

const COME = "I've come to help the Myreque. I've brought weapons.";
const KNOCKOUT = "Curpile knocks you out and takes you back to Mort'ton.";
function curpile(p, variant) {
  return () => PM.emitCustomEvent('npc-dialogue:start', {
    player: p, npc: core.NPC.create(core.NpcIdentifiers.CURPILE_FYOD, new core.Location(3508, 3440, 0)), npcId: core.NpcIdentifiers.CURPILE_FYOD,
    variant: { page: PAGE, variant }, exact: true,
  });
}

test('a failed quiz: the counts on varbits 173/174, then the knock-out: block, stun, fall, Mort\'ton seven ticks after the box', async (t) => {
  const realRandom = Math.random;
  Math.random = () => 0; // draws Dialogue 1, 2, 3: female member, youngest, leader
  t.after(() => { Math.random = realRandom; });
  const p = actor(t, 25, 3507, 3439);
  giveWeapons(p);
  let boxTick = -1, movedTick = -1;
  await converse(p, curpile(p, 'convincing-curpile-fyod-talking-to-curpile-fyod'), [COME, 'Sani Piliu.', 'Sani Piliu.', 'Harold Evans.'], {
    maxTicks: 120, idleTicks: 14,
    onTick: (n, lines) => {
      if (boxTick < 0 && lines.includes(KNOCKOUT)) boxTick = n;
      if (movedTick < 0 && p.getLocation().getX() === 3522) movedTick = n;
    },
  });
  assert.deepEqual(varbit(p, 174), [0, 1, 2, 3], 'answered');
  assert.deepEqual(varbit(p, 173), [0, 1, 1, 1], 'correct');
  assert.ok(boxTick >= 0 && movedTick > boxTick, `box ${boxTick}, moved ${movedTick}`);
  assert.ok(movedTick - boxTick >= 6 && movedTick - boxTick <= 8, `the move comes about seven ticks after the box (${movedTick - boxTick})`);
  for (const anim of [415, 837]) assert.ok(p.anims.includes(anim), `animation ${anim}: ${p.anims}`);
  assert.ok(p.graphics.some(([id, height]) => id === 245 && height === 124), JSON.stringify(p.graphics));
  assert.deepEqual(at(p), [3522, 3285, 0]);
  assert.equal(quest().getStage(p), 52);
});

test('"I don\'t have to answer to you!": "Curpile punches you." with the 3 damage', async (t) => {
  const p = actor(t, 25, 3507, 3439);
  await converse(p, curpile(p, 'convincing-curpile-fyod-talking-to-curpile-fyod'), ["I don't have to answer to you!"], { maxTicks: 20 });
  assert.ok(p.messages.includes('Curpile punches you.'), JSON.stringify(p.messages));
  assert.ok(p.anims.includes(422));
});

test('each member met sets their bit of varbit 2496, resent at login', (t) => {
  const p = actor(t, 65, 3506, 9837);
  for (const id of ['k_vzYt', '_g5SY-', 'C5YuIy', '25JBP_', 'KI2Pb0']) PM.emitCustomEvent('npc-dialogue:condition', { player: p, stepId: id, npcId: 0 });
  assert.deepEqual(varbit(p, 2496), [2, 6, 7, 15, 31], 'Harold, Radigad, Sani, Polmafi, Ivan');
  p.varbits.length = 0;
  login(p);
  assert.deepEqual(varbit(p, 2496), [31]);
  assert.equal(quest().getStage(p), 65, 'meeting everyone no longer moves the stage; the hand-in does');
});

test('on the bridge the player walks by their own clip overlay, not a private area, and a clicked rung paths like any click', async (t) => {
  const p = actor(t, 25, 3502, 3427);
  bridgeMaterials(p, 1);
  login(p); // a save on the landing gets the overlay back
  assert.equal(p.getClipOverlay()?.bridge, true);
  assert.equal(p.getPrivateArea(), null, 'no private area: the swamp\'s area, visibility and drops are as anywhere');
  const connection = new ClientConnection(p.getSession().getChannel());
  connection.player = p;
  await connection.dispatch([{ type: 'object_option', id: 26245, x: 3502, y: 3428, action: 'Repair' }]);
  connection.processTurnPackets();
  tick(p, 6);
  assert.ok(!p.messages.includes("I can't do that from here!"), JSON.stringify(p.messages));
  assert.ok(p.messages.includes('You repair a section of the bridge.'), JSON.stringify(p.messages));
  assert.deepEqual(at(p), [3502, 3428, 0]);
});

test('Veliaf after the hound: stage 90 on "That\'s very useful. Thanks.", and the first talk does not fall into "Need something?"', async (t) => {
  const p = actor(t, 85, 3506, 9837);
  const stagesBeforeThanks = new Set();
  const lines = await converse(p, () => PM.emitCustomEvent('npc-dialogue:start', {
    player: p, npcId: core.NpcIdentifiers.VELIAF_HURTZ_2,
    variant: { page: PAGE, variant: 'myreque-hideout-after-defeating-the-skeleton-hellhound-veliaf-hurtz' }, exact: true,
  }), ['Okay, thanks.'], {
    maxTicks: 40,
    onTick: (n, seen) => { if (seen.length && !seen.includes("That's very useful. Thanks.")) stagesBeforeThanks.add(quest().getStage(p)); },
  });
  assert.ok(lines.includes("That's very useful. Thanks."), JSON.stringify(lines));
  assert.deepEqual([...stagesBeforeThanks], [85], 'still 85 until the thanks line');
  assert.equal(quest().getStage(p), 90);
  assert.ok(!lines.includes('Need something?'), 'the speaking-again branch is not played in the first talk');
});

test('the Stranger: the quest completes once the player continues past the last line, not as the talk starts', async (t) => {
  const p = actor(t, 97, 3502, 3477);
  const stages = [];
  await converse(p, () => PM.emitCustomEvent('npc-dialogue:start', {
    player: p, npcId: core.NpcIdentifiers.STRANGER_2,
    variant: { page: PAGE, variant: 'myreque-hideout-finishing-up' }, exact: true,
  }), [], { maxTicks: 30, onTick: () => stages.push(quest().getStage(p)) });
  assert.ok(stages.filter((s) => s === 97).length >= 5, `stage 97 while the lines play: ${stages}`);
  assert.equal(quest().getStage(p), 105);
  assert.deepEqual([varbit(p, 176).at(-1), varbit(p, 3928).at(-1)], [1, 7], 'the bridge is repaired for good');
  assert.deepEqual([varbit(p, 2496).at(-1), varbit(p, 173).at(-1), varbit(p, 174).at(-1)], [0, 0, 0], 'routequestmulti cleared (tick 1617)');
  assert.equal(varbit(p, 396).at(-1), 1, 'the Stranger stays (Wiki)');
});

test('an item dropped on the bridge stays in the world after the player climbs down', (t) => {
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const p = actor(t, 52, 3502, 3425);
  p.setAttribute(BRIDGE, 0b111);
  login(p);
  click(p, SOUTH_TREE(), 'Cross-bridge');
  tick(p);
  assert.deepEqual(at(p), [3502, 3427, 0]);
  const dropped = ItemOnGroundManager.registerLocation(p, new core.Item(core.ItemIdentifiers.COINS, 1000), p.getLocation().clone());
  click(p, SOUTH_TREE(), 'Cross-bridge');
  tick(p, 2);
  assert.deepEqual(at(p), [3502, 3425, 0]);
  assert.ok(core.World.getItems().includes(dropped), 'the drop is still on the landing');
  assert.equal(p.getClipOverlay(), null, 'the overlay goes with the climb down');
  t.after(() => ItemOnGroundManager.deregister?.(dropped));
});

test('arriving in the hideout at stage 55 (a save from before the doors set 60) moves to 60 and Harold speaks', async (t) => {
  const p = actor(t, 55, 3505, 9832);
  const lines = await converse(p, () => PM.emitCustomEvent('loc-teleports:arrived', {
    player: p, objectId: core.ObjectIdentifiers.CAVE_ENTRANCE_27, location: { x: 3492, y: 9823, z: 0 },
  }), [], { maxTicks: 20, idleTicks: 6 });
  assert.equal(quest().getStage(p), 60);
  assert.equal(lines[1], 'Hey! Who are you and why are you here?');
});
