const assert = require('node:assert/strict'), path = require('node:path');
const {before, after, test} = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');

// Emote tab locks (cache script 702) and the emotes:unlock store the random events use.
let core, PlayerSave, next = 1700;
const EMOTE_CONTENTS = (216 << 16) | 2;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi(); ({PlayerSave} = require('../dist/game/entity/impl/player/persistence/PlayerSave')); PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}};
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('emote' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0));
  t.after(() => { PM.emitPlayerLogout({player: p, username: p.getUsername()}); p.setRegistered(false); });
  return p;
}
const varbit = (p, name) => p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(name));
function click(t, p, slot) {
  const said = [], played = [];
  t.mock.method(core.StatementDialogue, 'send', (_player, text) => said.push(text));
  t.mock.method(p, 'performAnimation', (animation) => played.push(animation.getId?.() ?? animation.id));
  PM.emitInterfaceActionClick({player: p, buttonId: EMOTE_CONTENTS, slot, action: 1, handled: false});
  t.mock.restoreAll();
  return {said, played};
}

test('an unlocked base emote plays; a locked one shows its message and plays nothing', (t) => {
  const p = actor(t);
  assert.equal(click(t, p, 0).played.length, 1, 'Yes has no lock');
  const glassBox = click(t, p, 24);
  assert.deepEqual(glassBox.played, []);
  assert.deepEqual(glassBox.said, ['This emote can be unlocked during the mime random event.']);
  assert.deepEqual(click(t, p, 22).said, ['This emote can be unlocked during the Lost Tribe quest.']);
});

for (const [name, slot, varbit, sequence, spotanim] of [
  ['Zombie Hand', 41, 'emote_zombie_hand', 'hw07_arm_from_the_ground_emote', 'hw07_arm_from_the_ground_spotanim'],
  ['Trick', 52, 'emote_trick', 'emote_trick', 'hw23_emote_bat_spotanim'],
]) test(`${name} sends its cache graphic with the player animation only after unlocking`, (t) => {
  const p = actor(t);
  const played = [], graphics = [];
  t.mock.method(p, 'performAnimation', animation => played.push(animation.getId()));
  t.mock.method(p, 'performGraphic', graphic => graphics.push(graphic.getId()));
  t.mock.method(core.StatementDialogue, 'send', () => {});
  PM.emitInterfaceActionClick({player: p, buttonId: EMOTE_CONTENTS, slot, action: 1, handled: false});
  assert.deepEqual(played, [], 'locked emotes do not animate');
  assert.deepEqual(graphics, [], 'locked emotes do not spawn graphics');
  PM.emitCustomEvent('emotes:unlock', {player: p, varbit});
  for (const action of [1, 2]) {
    played.length = graphics.length = 0;
    PM.emitInterfaceActionClick({player: p, buttonId: EMOTE_CONTENTS, slot, action, handled: false});
    assert.deepEqual(played, [core.CacheDefinitions.getSeqId(sequence)]);
    assert.deepEqual(graphics, [core.CacheDefinitions.getSpotanimId(spotanim)]);
  }
  played.length = graphics.length = 0;
  p.getCombat().setAnimationStall(5);
  PM.emitInterfaceActionClick({player: p, buttonId: EMOTE_CONTENTS, slot, action: 1, handled: false});
  assert.deepEqual(played, [], 'busy guard also blocks the player animation');
  assert.deepEqual(graphics, [], 'busy guard also blocks the graphic');
});

test('emotes:unlock saves the varbit, sends it, and survives a save and login', (t) => {
  const p = actor(t);
  const request = {player: p, varbit: 'emote_glassbox', unlocked: false};
  PM.emitCustomEvent('emotes:unlock', request);
  assert.equal(request.unlocked, true);
  assert.equal(varbit(p, 'emote_glassbox'), 1);
  assert.deepEqual(click(t, p, 24).played, [1131]);

  const again = {player: p, varbit: 'emote_glassbox', unlocked: false};
  PM.emitCustomEvent('emotes:unlock', again);
  assert.equal(again.unlocked, false, 'already unlocked');
  const stranger = {player: p, varbit: 'slayer_points', unlocked: false};
  PM.emitCustomEvent('emotes:unlock', stranger);
  assert.equal(stranger.unlocked, false, 'only emote lock varbits are stored');
  assert.deepEqual(p.getAttribute('emotes:unlocked'), ['emote_glassbox']);

  const save = PlayerSave.fromPlayer(p);
  const q = actor(t);
  save.applyToPlayer(q);
  PM.emitPlayerLogin({player: q, username: q.getUsername(), isNewAccount: false});
  assert.equal(varbit(q, 'emote_glassbox'), 1);
  assert.deepEqual(click(t, q, 24).played, [1131]);
});

test('lock varbits that unlock several emotes, and the Lost Tribe stage threshold', (t) => {
  const p = actor(t);
  PM.emitCustomEvent('emotes:unlock', {player: p, varbit: 'emote_drilldemon'});
  for (const slot of [36, 37, 38, 39]) assert.equal(click(t, p, slot).played.length, 1, `Drill Demon slot ${slot}`);
  const stage = core.CacheDefinitions.getVarbitId('lost_tribe_quest');
  p.getPacketSender().sendVarbit(stage, 6);
  assert.equal(click(t, p, 22).played.length, 0);
  p.getPacketSender().sendVarbit(stage, 7);
  assert.equal(click(t, p, 22).played.length, 1);
});

test('Fortis Salute follows the best Glory the Colosseum sends on login', (t) => {
  const p = actor(t);
  p.setAttribute('colosseum:glory', 19999);
  PM.emitPlayerLogin({player: p, username: p.getUsername(), isNewAccount: false});
  assert.equal(click(t, p, 53).played.length, 0);
  const q = actor(t);
  q.setAttribute('colosseum:glory', 20000);
  PM.emitPlayerLogin({player: q, username: q.getUsername(), isNewAccount: false});
  assert.equal(q.getPacketSender().getVarp(core.CacheDefinitions.getVarpId('colosseum_glory')), 20000);
  assert.equal(click(t, q, 53).played.length, 1);
});

test('random events unlock their emotes one at a time, in the tab order', (t) => {
  const p = actor(t);
  const Rewards = require('../plugins/npcs/random-events/Rewards.RandomEvents');
  const zombie = ['emote_zombie_walk', 'emote_zombie_dance'];
  const api = {emitCustomEvent: (name, payload) => PM.emitCustomEvent(name, payload)};
  assert.equal(Rewards.unlockEmote(api, p, zombie), 'emote_zombie_walk');
  assert.equal(Rewards.unlockEmote(api, p, zombie), 'emote_zombie_dance');
  assert.equal(Rewards.unlockEmote(api, p, zombie), undefined, 'both unlocked: the lamp is next');
});


test('skillcape spam cannot restart its animation and a walk waits for the cape stall to end', async (t) => {
  const { World } = require('../dist/game/World');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const previousCycle = World.processCycle;
  t.after(() => { World.processCycle = previousCycle; });
  World.processCycle = 1000;
  const p = actor(t);
  p.getEquipment().set(core.Equipment.CAPE_SLOT, new core.Item(core.CacheDefinitions.getObjId('skillcape_attack')));
  const played = [], graphics = [], walks = [];
  t.mock.method(p, 'performAnimation', animation => played.push(animation.getId()));
  t.mock.method(p, 'performGraphic', graphic => graphics.push(graphic.getId()));
  t.mock.method(p.getMovementQueue(), 'requestWalk', destination => walks.push([destination.getX(), destination.getY()]));
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const connection = new ClientConnection(channel);
  connection.player = p;
  async function send(packets) {
    connection.inject(packets);
    await connection.idle();
    connection.processTurnPackets();
  }
  const emote = slot => ({ type: 'widget_action', widgetId: EMOTE_CONTENTS, groupId: 216, childId: 2, slot, buttonNum: 1, opId: 1, itemId: -1 });
  await send([emote(43)]);
  assert.deepEqual(played, [4959]);
  assert.deepEqual(graphics, [823]);
  const initialStall = p.getCombat().getAnimationStallTicks();

  World.processCycle = 1001;
  await send([emote(43), emote(43), emote(0)]);
  assert.deepEqual(played, [4959], 'neither the cape nor an ordinary emote replaces the active emote');
  assert.equal(initialStall, 6, 'Attack cape stalls for six ticks (Wiki)');
  assert.equal(p.getMovementQueue().getMobility().canMove(), false);
  assert.equal(p.getCombat().getIncomingHitCycle(), -1, 'content stall does not defer incoming damage');
  assert.deepEqual(graphics, [823]);
  assert.equal(p.getCombat().getAnimationStallTicks(), 5, 'spam does not extend the deadline');
  await send([{ type: 'move', worldX: 3223, worldY: 3218, modifierFlags: 0, run: false }]);
  await send([{ type: 'move', worldX: 3224, worldY: 3218, modifierFlags: 0, run: false }]);
  assert.deepEqual(walks, []);
  World.processCycle = 1005;
  connection.processTurnPackets();
  assert.deepEqual(walks, [], 'the last locked tick still holds movement');
  World.processCycle = 1006;
  connection.processTurnPackets();
  assert.deepEqual(walks, [[3224, 3218]], 'last queued walk runs exactly when the stall ends');
  assert.equal(p.getMovementQueue().getMobility().canMove(), true);
  await send([emote(43)]);
  assert.deepEqual(played, [4959, 4959], 'the cape can play again after finishing');
});

test('cape stall durations follow the Wiki per cape and refusals do not start a stall', (t) => {
  const p = actor(t);
  const { resolveSkillcapeEmote } = require('../plugins/interface/Emotes.plugin')._test;
  const durations = { ATTACK: 6, STRENGTH: 15, DEFENCE: 8, RANGED: 9, PRAYER: 10, MAGIC: 5,
    RUNECRAFTING: 10, HITPOINTS: 6, AGILITY: 7, HERBLORE: 14, THIEVING: 5, CRAFTING: 13,
    FLETCHING: 13, SLAYER: 5, CONSTRUCTION: 12, MINING: 8, SMITHING: 20, FISHING: 12,
    COOKING: 25, FIREMAKING: 7, WOODCUTTING: 20, FARMING: 10, HUNTER: 12 };
  for (const cape of require('../plugins/items/data/skillcapes.json').capes) {
    if (cape.skill === 'SAILING') continue; // Its emote is not implemented by the current resolver.
    for (const name of [cape.cape, cape.trimmed]) {
      const id = core.CacheDefinitions.getObjId(name);
      assert.ok(id != null, `cache names ${name}`);
      p.getEquipment().set(core.Equipment.CAPE_SLOT, new core.Item(id));
      assert.equal(resolveSkillcapeEmote(p, { core }).stallTicks, durations[cape.skill], name);
    }
  }
  for (const [id, ticks] of [[core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, 32], [core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE_T_, 32], [core.ItemIdentifiers.MAX_CAPE, 8]]) {
    p.getEquipment().set(core.Equipment.CAPE_SLOT, new core.Item(id));
    assert.equal(resolveSkillcapeEmote(p, { core }).stallTicks, ticks);
  }
  p.getEquipment().set(core.Equipment.CAPE_SLOT, new core.Item(-1, 0));
  assert.deepEqual(click(t, p, 43).played, []);
  assert.equal(p.getCombat().getAnimationStallTicks(), 0, 'missing cape');
  p.getEquipment().set(core.Equipment.CAPE_SLOT, new core.Item(core.CacheDefinitions.getObjId('skillcape_attack')));
  const oldEmit = PM.emitCustomEvent;
  t.mock.method(PM, 'emitCustomEvent', (name, request) => {
    if (name === 'player:can-emote') request.allow = false;
    else oldEmit.call(PM, name, request);
  });
  assert.deepEqual(click(t, p, 43).played, []);
  assert.equal(p.getCombat().getAnimationStallTicks(), 0, 'plugin veto');
});

test('content stalls preserve longer full stalls, expire by game tick and clear on animation reset', (t) => {
  const { World } = require('../dist/game/World');
  const previousCycle = World.processCycle;
  t.after(() => { World.processCycle = previousCycle; });
  World.processCycle = 2000;
  const p = actor(t), combat = p.getCombat();
  combat.setAnimationStall(25);
  World.processCycle = 2001;
  combat.setAnimationStall(6);
  assert.equal(combat.getAnimationStallTicks(), 24, 'shorter content cannot release a previous lock early');
  for (const bad of [NaN, Infinity, -1, 0]) combat.setAnimationStall(bad);
  assert.equal(combat.getAnimationStallTicks(), 24, 'invalid durations cannot replace the lock');
  World.processCycle = 2025;
  assert.equal(combat.isAnimationStalled(), false);
  combat.setAnimationStall(1000);
  assert.equal(combat.getAnimationStallTicks(), 100, 'content cannot set an unbounded lock');
  combat.onAnimationStarted(core.Animation.DEFAULT_RESET_ANIMATION.getId());
  assert.equal(combat.isAnimationStalled(), false);
});
