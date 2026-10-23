const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});
let nextIndex = 100;
function setup() {
  const hooks = { custom: new Map(), variants: [], namedNpcs: new Map(), objects: [], items: [], logout: [] };
  const tasks = [], spawned = [], removed = [], objects = [], projectiles = [], graphics = [], cameras = [];
  let tick = 0; const executed = new Set();
  const core = { ...PluginManager.getCoreApi(),
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    ForceMovementTask: class { constructor(player, ticks, movement) { Object.assign(this, { ticks, run() { player.moveTo(new core.Location(movement.start.x + movement.end.x, movement.start.y + movement.end.y, 0)); } }); } },
    TaskManager: { submit(task) { task.due = tick + task.ticks; tasks.push(task); } },
    ObjectManager: { register(object) { objects.push(object); }, deregister(object) { objects.splice(objects.indexOf(object), 1); object.getPrivateArea()?.detach(object); } },
  };
  const api = new Proxy({ core,
    persistAttribute() {}, onNpcDialogueVariant(fn) { hooks.variants.push(fn); }, onNpcDialogueCondition() {},
    onNpcInteraction(target, actions) { if (typeof target === 'string') hooks.namedNpcs.set(target, actions); },
    onObjectInteraction(target) { if (typeof target === 'function') hooks.objects.push(target); },
    onItemOnItem(first, second, fn) { hooks.items.push({ first, second, fn }); }, onPlayerLogout(fn) { hooks.logout.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    spawnNpc(def) {
      let hp = 40, area, tile = new core.Location(def.x, def.y, def.z);
      const npc = { def, getId: () => def.id, getOwner: () => def.owner, getHitpoints: () => hp, setHitpoints(value) { hp = value; },
        getCombat: () => ({ attack(target) { npc.target = target; } }), isRegistered: () => true,
        isNpc: () => true, isPlayer: () => false, setArea(value) { area = value; }, getArea: () => area,
        getIndex: () => nextIndex++, getAsNpc() { return npc; }, getLocation: () => tile, moveTo(value) { tile = value; },
        getMovementQueue: () => ({ addFirstStep(value) { tile = value; } }),
        performAnimation(value) { npc.animation = value.id; }, performGraphic(value) { npc.graphic = value.id; }, forceChat(value) { npc.chat = value; } };
      spawned.push(npc); return npc;
    }, removeNpc(npc) { removed.push(npc); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  require('../plugins/quests/quests/BelowIceMountain.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);
  const attrs = new Map(), inventory = new Map(), varbits = new Map(), messages = [], animations = [], xp = [];
  const index = nextIndex++;
  let location = new core.Location(3086, 3415, 0), area = null, current = null, menu = null, miningLevel = 10;
  const movement = { reset() { return this; }, setBlockMovement(value) { this.blocked = value; return this; } };
  const sender = new Proxy({ sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendCreationMenu(value) { menu = value; return sender; }, sendInterfaceRemoval() { current = null; return sender; },
    sendProjectile(...args) { projectiles.push(args); return sender; }, sendGraphic(...args) { graphics.push(args); return sender; },
  }, { get(target, key) { return target[key] ?? ((...args) => { if (String(key).startsWith("sendCamera")) {
      if ((key === 'sendCameraMoveTo' || key === 'sendCameraLookAt') && area?.sourceTile) {
        const origin = area.sourceTile(0, 0); args = [args[0] - origin.getX(), args[1] - origin.getY(), ...args.slice(2)];
      }
      cameras.push([tick, key, ...args]);
    } return sender; }); } });
  const player = {
    getAttribute: key => attrs.get(key), setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender, getFrameUpdater: () => null, sendMessage(message) { messages.push(message); },
    getInventory: () => ({ getAmount: id => inventory.get(id) ?? 0, isFull: () => false,
      forceAdd(owner, item) { inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()); },
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); } }),
    getSkillManager: () => ({ getCurrentLevel: skill => skill === core.Skill.MINING ? miningLevel : 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); } }),
    getLocation: () => location, moveTo(value) { location = value; }, getArea: () => area, getPrivateArea: () => area, setArea(value) { area = value; },
    getIndex: () => index, isPlayer: () => true, getAsPlayer() { return player; }, isNpc: () => false, isRegistered: () => true,
    getMovementQueue: () => movement, getCombat: () => ({ reset() {} }), setUntargetable() {}, setForceMovement() {},
    performAnimation(animation) { animations.push(animation); },
    getDialogueManager: () => ({ startDialogues(chain) { current = chain; }, getCurrent: () => current, reset() { current = null; }, isActive: () => Boolean(current), advance() {} }),
  };
  const emit = (name, event) => api.emitCustomEvent(name, { player, ...event });
  const action = (npcId, stepId) => { const event = { player, npcId, stepId }; api.emitCustomEvent('npc-dialogue:action', event); return event; };
  const line = (npcId, text) => { const event = { player, npcId, text }; api.emitCustomEvent('npc-dialogue:line', event); return event; };
  return { api, hooks, core, quest, attrs, inventory, varbits, messages, animations, xp, player, tasks, spawned, removed, objects, projectiles, graphics,
    emit, action, line, cameras, tick(count) { while (count-- > 0) { tick++; for (const task of [...tasks]) if (!executed.has(task) && task.due <= tick) { executed.add(task); task.run(); } } }, menu: () => menu, setMiningLevel(value) { miningLevel = value; } };
}
const CHECKAL = 'quest.below_ice_mountain.checkal', MARLEY = 'quest.below_ice_mountain.marley';
test('capture start/recruitment milestones preserve cache morphs and old saves', () => {
  const h = setup(), N = h.core.NpcIdentifiers;
  h.attrs.set('quest.points', 15);
  assert.equal(h.hooks.namedNpcs.get('Willow')['Talk-to']({ player: h.player }), true);
  h.emit('npc-dialogue:choice', { npcId: N.WILLOW, option: 'Yes.' });
  assert.equal(h.quest.getStage(h.player), 0);
  h.attrs.set('quest.points', 16); h.emit('npc-dialogue:choice', { npcId: N.WILLOW, option: 'Yes.' });
  assert.equal(h.varbits.get(12063), 5);
  h.line(N.WILLOW, 'What happened?').after(); assert.equal(h.varbits.get(12063), 7);
  h.line(N.WILLOW, 'I have no idea where he is these days.').after(); assert.equal(h.varbits.get(12063), 10);
  h.hooks.variants[0]({ player: h.player, npcId: N.CHECKAL });
  assert.equal(h.attrs.get(CHECKAL), 0, 'opening a conversation cannot advance the errand');
  h.line(N.CHECKAL, 'If you can survive his rigorous training program, I shall offer you my help.').after();
  assert.equal(h.varbits.get(12065), 5);
  h.line(N.ATLAS, "That's a lot of money!").after(); assert.equal(h.varbits.get(12065), 10);
  h.attrs.set(CHECKAL, 2); assert.equal(h.quest.varbitValue(1, h.player), 15);
  h.quest.setStage(h.player, 5); assert.equal(h.varbits.get(12063), 120); assert.equal(h.varbits.get(12067), 1);
});
test('Checkal waits for a nearby real Flex after the workout and prompt', () => {
  const h = setup(), N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 1); h.attrs.set(CHECKAL, 15); h.attrs.set('quest.below_ice_mountain.atlas-sessions', 1);
  h.action(N.CHECKAL, 'pPaqOe'); assert.equal(h.attrs.get(CHECKAL), 20); assert.equal(h.animations.length, 0);
  h.player.moveTo(new h.core.Location(3200, 3200, 0)); h.emit('player:emote', { sequence: 8917 }); assert.equal(h.tasks.length, 0);
  h.player.moveTo(new h.core.Location(3086, 3415, 0)); h.emit('player:emote', { sequence: 8917 });
  assert.equal(h.tasks.at(-1).ticks, 3); h.tasks.at(-1).run();
  h.line(N.CHECKAL, 'Thank you my friend, I will meet you there.').after();
  assert.equal(h.attrs.get(CHECKAL), 40); assert.equal(h.varbits.get(12063), 15);
});
test('sandwich recipe requires learning, uses make menu and stays usable after completion', () => {
  const h = setup(), I = h.core.ItemIdentifiers, recipe = h.hooks.items.find(x => x.second === 'Bread').fn;
  h.quest.setStage(h.player, 1); h.attrs.set(MARLEY, 5);
  for (const id of [I.KNIFE, I.BREAD, I.COOKED_MEAT]) h.inventory.set(id, 2);
  const event = { player: h.player, usedItemId: I.KNIFE, usedWithItemId: I.BREAD };
  assert.equal(recipe(event), false);
  h.line(h.core.NpcIdentifiers.COOK_2, 'Then, you take some bread. I recommend making it fresh.').after();
  assert.equal(h.varbits.get(12064), 10); assert.equal(recipe(event), true);
  assert.deepEqual(h.menu().getItems(), [I.BREADCRUMBS, I.STEAK_SANDWICH]); assert.equal(h.inventory.get(I.BREAD), 2);
  h.menu().execute(I.STEAK_SANDWICH, 1); assert.equal(h.inventory.get(I.STEAK_SANDWICH), 1); assert.equal(h.inventory.get(I.COOKED_MEAT), 1);
  assert.ok(h.messages.includes('You combine the cooked meat and bread to make a Steak sandwich!'));
  h.quest.setStage(h.player, 5); recipe(event); h.menu().execute(I.STEAK_SANDWICH, 1); assert.equal(h.inventory.get(I.STEAK_SANDWICH), 2);
});
test('RPS third-round cheat beats the actual shown sign for every player pick', () => {
  const h = setup(), N = h.core.NpcIdentifiers; h.quest.setStage(h.player, 1);
  for (const [pick, shown, cheat] of [['Rock.', 'Paper', 'Scissors'], ['Paper.', 'Scissors', 'Rock'], ['Scissors.', 'Rock', 'Paper']]) {
    h.emit('npc-dialogue:choice', { npcId: N.BURNTOF, option: pick });
    assert.equal(h.line(N.BURNTOF, 'Burntof chose [winning sign].').text, `Burntof chose ${shown.toLowerCase()}.`);
    assert.equal(h.line(N.BURNTOF, "You quickly change your sign to [sign that beats Burntof's].").text, `You quickly change your sign to ${cheat.toLowerCase()}.`);
  }
});
test('workout lasts 206 ticks, unlocks Flex at its end and cleans up logout', () => {
  const h = setup(), N = h.core.NpcIdentifiers; h.quest.setStage(h.player, 1); h.attrs.set(CHECKAL, 10);
  h.action(N.ATLAS, '_RwWTk'); assert.equal(h.player.getPrivateArea().getName(), 'Barbarian Workout');
  const workoutEntry = h.player.getPrivateArea().sourceTile(3253, 3393);
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY()], [workoutEntry.getX(), workoutEntry.getY()], 'Atlas enters the workout scene before its first scheduled action');
  assert.equal(h.attrs.get('below-ice-mountain:training'), 1); assert.equal(h.varbits.get(12062), 0);
  const cancelledScene = h.player.getPrivateArea();
  const cancelledTasks = [...h.tasks];
  h.hooks.logout[0]({ player: h.player });
  assert.equal(h.attrs.get('below-ice-mountain:training'), 0);
  assert.equal(cancelledScene.isDestroyed(), true);
  assert.equal(h.attrs.get(CHECKAL), 10, 'cancel leaves Checkal training progress untouched');
  assert.equal(h.attrs.get('quest.below_ice_mountain.atlas-sessions'), undefined);
  assert.equal(h.varbits.get(12062), 0, 'cancel does not unlock Flex');
  for (const task of cancelledTasks) task.run();
  assert.equal(h.attrs.get(CHECKAL), 10, 'cancelled workout tasks cannot complete after cleanup');

  h.action(N.ATLAS, '_RwWTk');
  assert.equal(h.player.getPrivateArea().getName(), 'Barbarian Workout', 'Atlas can start a fresh workout after cancellation');
  assert.equal(h.attrs.get('below-ice-mountain:training'), 1);
  const completeWorkout = h.tasks.at(-1);
  for (const task of h.tasks.filter(task => task.ticks < 206)) task.run();
  const woman = h.spawned.find(npc => npc.getId() === 10674);
  assert.equal(woman.chat, 'Catch!'); assert.equal(woman.animation, 385); assert.equal(woman.graphic, 30);
  assert.equal(h.projectiles[0][4], 29); assert.equal(h.graphics[0][0].id, 31); assert.equal(h.graphics[0][0].delay, 81);
  assert.ok(h.spawned.some(npc => npc.getId() === 10675), 'the recorded dog appears in the final run');
  assert.ok(h.spawned.some(npc => npc.getId() === 10678), 'the barbarian crowd appears for the last pushups');
  assert.equal(completeWorkout.ticks, 206); completeWorkout.run(); assert.equal(h.attrs.get(CHECKAL), 15); assert.equal(h.varbits.get(12062), 1);
  assert.equal(h.attrs.get('quest.below_ice_mountain.atlas-sessions'), 1);
  assert.equal(h.attrs.get('below-ice-mountain:training'), 1, 'the scene stays active through the final dialogue');
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.CHECKAL }), 'checkal-the-strongman-talking-to-checkal-after-completing-atlas-training');
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.ATLAS }), 'checkal-the-strongman-talking-to-atlas-again-after-first-training-session');
  h.action(N.ATLAS, 'Ajwwje'); assert.equal(h.attrs.get('quest.below_ice_mountain.atlas-sessions'), 1);
  h.line(N.ATLAS, 'My work is done. Return to Checkal and show him your new-found muscles.').after();
  assert.equal(h.attrs.get('below-ice-mountain:training'), 0, 'the canonical closing line returns the player from the workout');
  assert.equal(h.player.getPrivateArea().isDestroyed(), true);
  h.hooks.logout[0]({ player: h.player }); assert.equal(h.attrs.get('below-ice-mountain:training'), 0); assert.equal(h.player.getMovementQueue().blocked, false);
});
test('mining needs level/pickaxe, damages each distinct pillar once and gives 10 XP', () => {
  const h = setup(), N = h.core.NpcIdentifiers, O = h.core.ObjectIdentifiers;
  h.quest.setStage(h.player, 3); h.action(N.WILLOW, 'wWX1Ws');
  const guardian = h.spawned.at(-1), mine = h.hooks.objects[0];
  const click = () => { const object = h.objects.find(object => object.getId() === O.STRUCTURAL_PILLAR);
    h.player.moveTo(object.getLocation().transform(1, 0)); mine({ player: h.player, objectId: O.STRUCTURAL_PILLAR, object, clickType: 1 }); return object; };
  h.setMiningLevel(9); click(); assert.match(h.messages.at(-1), /Mining level of at least 10/);
  h.setMiningLevel(10); click(); assert.match(h.messages.at(-1), /pickaxe/);
  h.api.onCustomEvent('mining:best-pickaxe', event => { event.pickaxe = { animation: new h.core.Animation(625) }; });
  const first = click(); assert.equal(guardian.getHitpoints(), 40); assert.equal(h.tasks.at(-1).ticks, 8); h.tasks.at(-1).run(); assert.equal(guardian.getHitpoints(), 30);
  mine({ player: h.player, objectId: O.STRUCTURAL_PILLAR, object: first, clickType: 1 }); assert.equal(guardian.getHitpoints(), 30);
  for (let i = 0; i < 3; i++) { click(); h.tasks.at(-1).run(); }
  assert.equal(h.quest.getStage(h.player), 4); assert.equal(h.varbits.get(12063), 40); assert.equal(h.xp.reduce((sum, x) => sum + x.amount, 0), 40); assert.ok(h.removed.includes(guardian));
  h.player.getPrivateArea().destroy();
});

test('entrance uses a private crew and Marley scene, then replaces the awakening with a combat guardian', () => {
  const h = setup(), N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 2);
  h.action(N.WILLOW, 'fOQUgc');
  const exterior = h.player.getPrivateArea();
  assert.equal(exterior.getName(), 'Opening Camdozaal');
  assert.deepEqual(h.spawned.map(npc => npc.getId()), [N.CHECKAL_2, N.BURNTOF_3, N.WILLOW_2, N.MARLEY_2]);
  h.action(N.WILLOW, 'JSFicf');
  assert.deepEqual([exterior.originX, exterior.originY], [2944, 5760]);
  h.action(N.WILLOW, '1Pscfp');
  const arena = h.player.getPrivateArea();
  assert.notEqual(arena, exterior);
  assert.equal(h.varbits.get(12063), 30);
  assert.equal(h.varbits.get(12065), 45);
  h.action(N.WILLOW, 'wWX1Ws');
  assert.equal(h.spawned.at(-1).getId(), N.ANCIENT_GUARDIAN_2);
  assert.equal(h.varbits.get(12063), 35);
  h.action(N.WILLOW, '6g-zlD');
  assert.equal(h.tasks.at(-1).ticks, 2);
  h.tasks.at(-1).run();
  assert.equal(h.spawned.at(-1).getId(), N.ANCIENT_GUARDIAN_2);
  h.line(N.WILLOW, "I can't believe they ran so quickly. I suppose I should take care of this thing.").after();
  assert.equal(h.tasks.at(-1).ticks, 5); h.tasks.at(-1).run();
  assert.equal(h.spawned.at(-1).getId(), N.ANCIENT_GUARDIAN);
  assert.equal(h.spawned.at(-1).target, h.player);
  assert.equal(h.player.getMovementQueue().blocked, false);
  h.hooks.logout[0]({ player: h.player });
});
test('the bag shows coins before completion; Ramarno finishes and rewards exactly once', () => {
  const h = setup(), N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 4);
  h.hooks.objects[0]({ player: h.player, objectId: h.core.ObjectIdentifiers.RUINS_ENTRANCE, clickType: 1 });
  const rummage = h.action(N.RAMARNO_2, 'zy3NHn');
  assert.equal(h.quest.getStage(h.player), 4);
  assert.ok(rummage.steps.some(step => step.text === 'You find a pile of coins!'));
  h.line(N.RAMARNO_2, 'Bless my beard...').after();
  assert.equal(h.quest.getStage(h.player), 4, 'completion waits for the recorded fade');
  assert.equal(h.tasks.at(-1).ticks, 8); h.tasks.at(-1).run();
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.varbits.get(12063), 120);
  assert.equal(h.inventory.get(I.COINS), 2000);
  assert.equal(h.attrs.get('quest.points'), 1);
  assert.equal(h.quest.scrollItemId, I.STEAK_SANDWICH);
  assert.equal(h.quest.completionJingleId, 152);
  h.emit('interface:closed', { interfaceId: 153 });
  assert.equal(h.attrs.get('below-ice-mountain:reward-pending'), 0);
  assert.equal(h.quest.complete(h.player), false);
  assert.equal(h.inventory.get(I.COINS), 2000);
  const depart = h.action(N.RAMARNO_2, 'i5wpmS');
  assert.equal(depart.steps[0].text, 'Ramarno departs for his workshop.');
  assert.equal(h.tasks.at(-1).ticks, 3); h.tasks.at(-1).run();
  assert.equal(h.varbits.get(12068), 1);
});


test('the complete workout camera track matches all captured targets, ticks and rates', () => {
  const h = setup(); h.quest.setStage(h.player, 1); h.attrs.set(CHECKAL, 10);
  h.action(h.core.NpcIdentifiers.ATLAS, '_RwWTk'); h.tick(205);
  // Capture 1636, cycles 346–549, normalized out of the private instance.
  assert.deepEqual(h.cameras, [
    [1, "sendCameraMoveTo", 3253, 3399, 500, {"rate": 232, "rate2": 232}],
    [1, "sendCameraLookAt", 3253, 3393, 350, {"rate": 232, "rate2": 232}],
    [18, "sendCameraLookAt", 3255, 3407, 280, {"rate": 1, "rate2": 1}],
    [20, "sendCameraMoveTo", 3244, 3410, 670, {"rate": 232, "rate2": 232}],
    [20, "sendCameraLookAt", 3244, 3405, 250, {"rate": 232, "rate2": 232}],
    [35, "sendCameraMoveTo", 3244, 3436, 430, {"rate": 3, "rate2": 3}],
    [44, "sendCameraLookAt", 3244, 3426, 400, {"rate": 232, "rate2": 232}],
    [44, "sendCameraMoveTo", 3253, 3426, 430, {"rate": 232, "rate2": 232}],
    [45, "sendCameraLookAt", 3217, 3426, 400, {"rate": 3, "rate2": 3}],
    [45, "sendCameraMoveTo", 3226, 3426, 430, {"rate": 3, "rate2": 3}],
    [57, "sendCameraMoveTo", 3079, 3425, 300, {"rate": 232, "rate2": 232}],
    [57, "sendCameraLookAt", 3075, 3423, 280, {"rate": 232, "rate2": 232}],
    [77, "sendCameraMoveTo", 3078, 3431, 290, {"rate": 232, "rate2": 232}],
    [77, "sendCameraLookAt", 3078, 3438, 280, {"rate": 232, "rate2": 232}],
    [98, "sendCameraReset"],
    [98, "sendCameraLookAt", 3069, 3422, 280, {"rate": 232, "rate2": 232}],
    [98, "sendCameraMoveTo", 3069, 3411, 600, {"rate": 232, "rate2": 232}],
    [103, "sendCameraLookAt", 3066, 3417, 280, {"rate": 2, "rate2": 2}],
    [103, "sendCameraMoveTo", 3043, 3411, 400, {"rate": 3, "rate2": 3}],
    [103, "sendCameraLookAt", 3066, 3417, 0, {"rate": 1, "rate2": 1}],
    [104, "sendCameraLookAt", 3064, 3417, 0, {"rate": 1, "rate2": 1}],
    [105, "sendCameraLookAt", 3062, 3417, 0, {"rate": 1, "rate2": 1}],
    [106, "sendCameraLookAt", 3060, 3417, 0, {"rate": 1, "rate2": 1}],
    [107, "sendCameraLookAt", 3058, 3417, 0, {"rate": 1, "rate2": 1}],
    [108, "sendCameraLookAt", 3056, 3417, 0, {"rate": 1, "rate2": 1}],
    [109, "sendCameraLookAt", 3054, 3417, 0, {"rate": 1, "rate2": 1}],
    [110, "sendCameraLookAt", 3052, 3417, 0, {"rate": 1, "rate2": 1}],
    [111, "sendCameraLookAt", 3050, 3417, 0, {"rate": 1, "rate2": 1}],
    [112, "sendCameraLookAt", 3048, 3417, 0, {"rate": 1, "rate2": 1}],
    [113, "sendCameraLookAt", 3046, 3417, 0, {"rate": 1, "rate2": 1}],
    [114, "sendCameraLookAt", 3044, 3417, 0, {"rate": 1, "rate2": 1}],
    [115, "sendCameraLookAt", 3039, 3417, 0, {"rate": 1, "rate2": 0}],
    [117, "sendCameraMoveTo", 2993, 3427, 400, {"rate": 1, "rate2": 1}],
    [120, "sendCameraMoveTo", 3033, 3432, 600, {"rate": 3, "rate2": 3}],
    [120, "sendCameraLookAt", 3013, 3428, 0, {"rate": 1, "rate2": 0}],
    [123, "sendCameraLookAt", 3000, 3432, 0, {"rate": 1, "rate2": 0}],
    [131, "sendCameraMoveTo", 3079, 3425, 300, {"rate": 232, "rate2": 232}],
    [131, "sendCameraLookAt", 3075, 3423, 280, {"rate": 232, "rate2": 232}],
    [160, "sendCameraMoveTo", 3212, 3397, 300, {"rate": 232, "rate2": 232}],
    [160, "sendCameraLookAt", 3212, 3392, 280, {"rate": 232, "rate2": 232}],
    [160, "sendCameraMoveTo", 3212, 3417, 300, {"rate": 3, "rate2": 3}],
    [160, "sendCameraLookAt", 3212, 3439, 280, {"rate": 3, "rate2": 0}],
    [171, "sendCameraLookAt", 3211, 3440, 280, {"rate": 1, "rate2": 0}],
    [171, "sendCameraMoveTo", 3212, 3417, 600, {"rate": 3, "rate2": 3}],
    [176, "sendCameraLookAt", 3211, 3480, 280, {"rate": 1, "rate2": 0}],
    [176, "sendCameraMoveTo", 3212, 3457, 600, {"rate": 3, "rate2": 3}],
    [178, "sendCameraMoveTo", 3211, 3445, 500, {"rate": 232, "rate2": 232}],
    [178, "sendCameraLookAt", 3211, 3439, 280, {"rate": 232, "rate2": 232}],
    [183, "sendCameraMoveTo", 3211, 3440, 500, {"rate": 2, "rate2": 2}],
    [183, "sendCameraLookAt", 3211, 3457, 400, {"rate": 232, "rate2": 232}],
    [188, "sendCameraMoveTo", 3222, 3458, 700, {"rate": 3, "rate2": 3}],
    [188, "sendCameraLookAt", 3211, 3471, 650, {"rate": 3, "rate2": 3}],
    [204, "sendCameraMoveTo", 3079, 3425, 300, {"rate": 232, "rate2": 232}],
    [204, "sendCameraLookAt", 3075, 3423, 280, {"rate": 232, "rate2": 232}],
  ]);
  h.hooks.logout[0]({ player: h.player });
});

test('Camdozaal camera changes follow each scene transition and dialogue cue', () => {
  const h = setup(), N = h.core.NpcIdentifiers; h.quest.setStage(h.player, 2);
  const camera = (method, x, y, height, rate = 232, rate2 = rate) => [method, x, y, height, { rate, rate2 }];
  const latest = (count) => h.cameras.slice(-count).map(([, ...shot]) => shot);
  h.action(N.WILLOW, 'fOQUgc'); h.tick(3); assert.equal(h.cameras.length, 0);
  h.tick(1); assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2990, 3490, 600), camera('sendCameraLookAt', 2997, 3494, 400)]);
  h.tick(9); h.action(N.WILLOW, 'tVCp4g'); h.tick(7); assert.equal(h.cameras.length, 2);
  h.tick(1); assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2989, 3501, 700), camera('sendCameraLookAt', 2997, 3494, 350)]);
  h.tick(16); h.action(N.WILLOW, 'Gu5UTk'); h.tick(2);
  assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2991, 3500, 800, 1), camera('sendCameraLookAt', 2997, 3494, 400)]);
  h.tick(4); assert.deepEqual(latest(1), [['sendCameraShake', 0, 75]]);
  h.tick(10); assert.deepEqual(latest(3), [['sendCameraReset'], camera('sendCameraMoveTo', 2990, 3490, 600), camera('sendCameraLookAt', 2997, 3494, 400)]);
  h.tick(2); h.action(N.WILLOW, 'JSFicf'); h.tick(3);
  assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2954, 5771, 500), camera('sendCameraLookAt', 2952, 5764, 250)]);
  h.line(N.WILLOW, "Right, let's see what hidden surprises you have in store for me.").after();
  assert.deepEqual(latest(2), [camera('sendCameraLookAt', 2952, 5764, 250, 1), camera('sendCameraMoveTo', 2954, 5772, 500, 1)]);
  h.line(N.WILLOW, 'That would have been nasty.').after(); h.tick(1);
  assert.deepEqual(latest(2), [camera('sendCameraLookAt', 2952, 5766, 250, 1), camera('sendCameraMoveTo', 2954, 5773, 500, 1)]);
  h.action(N.WILLOW, '1Pscfp'); h.tick(3);
  assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2952, 5761, 200), camera('sendCameraLookAt', 2952, 5768, 50)]);
  h.tick(2); assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2952, 5763, 800, 2), camera('sendCameraLookAt', 2952, 5771, 50, 1)]);
  h.line(N.WILLOW, "You're impressed? There's nothing here but dust and fallen rocks.").before(); h.tick(2);
  assert.deepEqual(latest(1), [camera('sendCameraMoveTo', 2959, 5768, 800, 2)]);
  h.line(N.WILLOW, "It's not about the money though, right? We've potentially discovered the long lost ruins of an ancient civilisation!").before();
  assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2952, 5763, 800, 2), camera('sendCameraLookAt', 2952, 5773, 70, 1)]);
  h.line(N.WILLOW, 'What was that noise?').before();
  assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2946, 5768, 700, 5), camera('sendCameraLookAt', 2953, 5774, 100, 5)]);
  h.action(N.WILLOW, 'yEp2qP'); h.tick(4); assert.deepEqual(latest(1), [['sendCameraShake', 0, 20]]);
  h.tick(5); assert.deepEqual(latest(1), [['sendCameraShake', 0, 5]]);
  h.action(N.WILLOW, 'bxSVrN');
  assert.deepEqual(latest(3), [['sendCameraReset'], camera('sendCameraMoveTo', 2946, 5768, 700), camera('sendCameraLookAt', 2953, 5774, 100)]);
  h.action(N.WILLOW, 'wWX1Ws');
  assert.deepEqual(latest(3), [camera('sendCameraMoveTo', 2948, 5771, 700, 1), camera('sendCameraLookAt', 2953, 5778, 100, 1), ['sendCameraShake', 0, 5]]);
  h.tick(2); assert.deepEqual(latest(3), [['sendCameraReset'], camera('sendCameraMoveTo', 2948, 5771, 700), camera('sendCameraLookAt', 2952, 5778, 150, 2)]);
  h.quest.setStage(h.player, 4); h.action(N.RAMARNO_2, 'zy3NHn');
  assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2955, 5772, 450, 2), camera('sendCameraLookAt', 2951, 5769, 300, 2)]);
  h.action(N.RAMARNO_2, 'D1Y7Rh'); assert.deepEqual(latest(1), [['sendCameraShake', 0, 15]]);
  h.tick(3); assert.deepEqual(latest(3), [['sendCameraReset'], camera('sendCameraMoveTo', 2955, 5772, 450), camera('sendCameraLookAt', 2951, 5769, 300)]);
  h.line(N.RAMARNO_2, 'What the!').after(); h.tick(1);
  assert.deepEqual(latest(2), [camera('sendCameraMoveTo', 2955, 5772, 450, 2), camera('sendCameraLookAt', 2952, 5778, 250, 5)]);
  h.hooks.logout[0]({ player: h.player });
});


test('Ramarno ending resets the camera five ticks after resume, before the reward at eight', () => {
  const h = setup(), N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 4);
  h.hooks.objects[0]({ player: h.player, objectId: h.core.ObjectIdentifiers.RUINS_ENTRANCE, clickType: 1 });
  h.line(N.RAMARNO_2, 'Bless my beard...').after();
  h.tick(4); assert.deepEqual(h.cameras, []); assert.equal(h.quest.getStage(h.player), 4);
  h.tick(1); assert.deepEqual(h.cameras, [[5, 'sendCameraReset']]); assert.equal(h.quest.getStage(h.player), 4);
  h.tick(3); assert.equal(h.quest.getStage(h.player), 5); assert.deepEqual(h.cameras, [[5, 'sendCameraReset']]);
});
