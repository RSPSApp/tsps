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
function setup({ nativeSpawns = false } = {}) {
  const hooks = { custom: new Map(), variants: [], namedNpcs: new Map(), namedObjects: new Map(), objects: [], items: [], logout: [], npcDeath: [] };
  const tasks = [], spawned = [], removed = [], objects = [], projectiles = [], graphics = [], cameras = [], areaSounds = [], closedSubs = [], tabs = [];
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
    onObjectInteraction(target, actions) { if (typeof target === 'function') hooks.objects.push(target); else if (typeof target === 'string') hooks.namedObjects.set(target, actions); },
    onItemOnItem(first, second, fn) { hooks.items.push({ first, second, fn }); }, onPlayerLogout(fn) { hooks.logout.push(fn); }, onNpcDeath(fn) { hooks.npcDeath.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    spawnNpc(def) {
      if (nativeSpawns) {
        const npc = PluginManager.spawnNpc(def, 'BelowIceMountainPillarTest');
        spawned.push(npc);
        return npc;
      }
      let hp = 40, area, tile = new core.Location(def.x, def.y, def.z);
      const flags = new Set();
      const npc = { def, getId: () => def.id, getOwner: () => def.owner, getHitpoints: () => hp, setHitpoints(value) { hp = value; },
        setFlag(flag) { flags.add(flag); }, hasFlag: flag => flags.has(flag),
        getCombat: () => ({ attack(target) { npc.target = target; }, addDamage(source, amount) { npc.credited.push([source, amount]); } }), isRegistered: () => true,
        credited: [], hits: [], addTickHit(hit) { npc.hits.push([tick, hit.getDamage()]); }, isDyingFunction: () => false,
        isNpc: () => true, isPlayer: () => false, setArea(value) { area = value; }, getArea: () => area,
        getIndex: () => nextIndex++, getAsNpc() { return npc; }, getLocation: () => tile, moveTo(value) { tile = value; },
        faceTile(value) { npc.facing = value; },
        getMovementQueue: () => ({ addFirstStep(value) { tile = value; }, addSteps(value) { tile = value; } }),
        performAnimation(value) { npc.animation = value.id; }, performGraphic(value) { npc.graphic = value.id; npc.graphicObject = value; npc.graphicTick = tick; }, forceChat(value) { npc.chat = value; npc.chatTick = tick; } };
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
    sendAreaSound(...args) { areaSounds.push([tick, ...args]); return sender; },
    closeSubInterface(uid) { closedSubs.push([tick, uid]); return sender; }, sendTabInterface(slot, group) { tabs.push([tick, slot, group]); return sender; },
  }, { get(target, key) { return target[key] ?? ((...args) => { if (String(key).startsWith("sendCamera")) {
      if ((key === 'sendCameraMoveTo' || key === 'sendCameraLookAt') && area?.sourceTile) {
        if (area.getName() === 'Barbarian Workout') {
          args = [args[0] - area.getBaseX() + area.template.base[0] * 8,
            args[1] - area.getBaseY() + area.template.base[1] * 8, ...args.slice(2)];
        } else {
        const chunk = area.getChunk(location.getZ(), (args[0] >> 3) - area.baseChunkX, (args[1] >> 3) - area.baseChunkY);
        const [x, y] = core.rotateChunkTile(args[0] & 7, args[1] & 7, (4 - chunk.rotation) & 3);
        args = [chunk.sourceChunkX * 8 + x, chunk.sourceChunkY * 8 + y, ...args.slice(2)];
        }
      }
      cameras.push([tick, key, ...args]);
    } return sender; }); } });
  const player = {
    getAttribute: key => attrs.get(key), setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender, getFrameUpdater: () => null, sendMessage(message) { messages.push(message); },
    getInventory: () => ({ getAmount: id => inventory.get(id) ?? 0, isFull: () => false,
      forceAdd(owner, item) { inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()); },
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); }, refreshItems() {} }),
    getEquipment: () => ({ refreshItems() {} }), getSpellbook: () => ({ getInterfaceId: () => 218 }),
    getSkillManager: () => ({ getCurrentLevel: skill => skill === core.Skill.MINING ? miningLevel : 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); } }),
    setPositionToFace(value) { player.facing = value; },
    getLocation: () => location, moveTo(value) { location = value; }, getArea: () => area, getPrivateArea: () => area, setArea(value) { area = value; },
    getIndex: () => index, isPlayer: () => true, getAsPlayer() { return player; }, isNpc: () => false, isRegistered: () => true,
    getMovementQueue: () => movement, getCombat: () => ({ reset() {} }), setUntargetable() {}, setForceMovement() {},
    performAnimation(animation) { animations.push(animation); },
    getDialogueManager: () => ({ startDialogues(chain) { current = chain; }, getCurrent: () => current, reset() { current = null; }, isActive: () => Boolean(current), advance() {} }),
  };
  const emit = (name, event) => api.emitCustomEvent(name, { player, ...event });
  const action = (npcId, stepId) => { const event = { player, npcId, stepId }; api.emitCustomEvent('npc-dialogue:action', event); return event; };
  const line = (npcId, text) => { const event = { player, npcId, text }; api.emitCustomEvent('npc-dialogue:line', event); return event; };
  return { api, hooks, core, quest, attrs, inventory, varbits, messages, animations, xp, player, tasks, spawned, removed, objects, projectiles, graphics, areaSounds, closedSubs, tabs, now: () => tick,
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
  const workoutEntry = h.player.getPrivateArea().sourceTile(3250, 3398);
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
test('a pillar comes down onto the Guardian as local 1001343 recorded it, and walking off stops the swing', t => {
  const h = setup(), N = h.core.NpcIdentifiers, O = h.core.ObjectIdentifiers;
  const rolls = [];
  t.mock.method(Math, 'random', () => rolls.length ? rolls.shift() : 0);
  h.quest.setStage(h.player, 3); h.action(N.WILLOW, 'wWX1Ws');
  const guardian = h.spawned.at(-1), mine = h.hooks.objects[0];
  const pillars = () => h.objects.filter(object => object.getId() === O.STRUCTURAL_PILLAR);
  const click = (object = pillars()[0]) => {
    h.player.moveTo(object.getLocation().transform(1, 0));
    mine({ player: h.player, objectId: O.STRUCTURAL_PILLAR, object, clickType: 1 });
    return object;
  };
  h.setMiningLevel(9); click(); assert.match(h.messages.at(-1), /Mining level of at least 10/);
  h.setMiningLevel(10); click(); assert.match(h.messages.at(-1), /pickaxe/);
  h.api.onCustomEvent('mining:best-pickaxe', event => { event.pickaxe = { animation: new h.core.Animation(625) }; });

  // A swing that is walked away from never brings the pillar down (2793-2804: three ticks, then a walk).
  rolls.push(0.9, 0.9);
  const first = click();
  assert.equal(h.messages.at(-1), 'You swing your pick at the pillar.');
  assert.equal(h.animations.at(-1).id, 625);
  h.tick(2);
  h.player.moveTo(first.getLocation().transform(1, 1));
  h.tick(3);
  assert.equal(pillars().length, 4, 'the pillar stands after the player walks off');
  assert.equal(h.xp.length, 0);

  // Clicked again, it comes down after two failed rolls (2805: a swing, then the fall 1-3 ticks later).
  rolls.push(0.9, 0.9, 0, 0.3, 0.3, 0.3, 0.99);
  const start = h.now();
  click(first);
  h.tick(2); assert.equal(pillars().length, 4);
  h.tick(1);
  const fell = h.now();
  assert.equal(fell - start, 3);
  assert.equal(pillars().length, 3);
  const mined = h.objects.find(object => object.getId() === O.BROKEN_PILLAR_3);
  assert.ok(mined.getLocation().equals(first.getLocation()));
  assert.equal(mined.getFace(), first.getFace());
  assert.equal(h.animations.at(-1).id, -1, 'the swing stops as the pillar falls');
  assert.deepEqual(h.xp.map(x => x.amount), [10]);
  assert.equal(guardian.graphic, 60); assert.equal(guardian.graphicObject.getDelay(), 20); assert.equal(guardian.graphicObject.getHeight(), 10);
  assert.equal(guardian.graphicTick, fell);
  const shakes = h.cameras.filter(([at, key]) => at === fell && key === 'sendCameraShake');
  assert.deepEqual(shakes.map(shake => shake.slice(2, 4)), [[0, 6], [1, 6], [2, 6]], 'three axes, each 5-8');
  const at = guardian.getLocation();
  assert.deepEqual(h.areaSounds.filter(([tick]) => tick === fell), [[fell, 1384, at.getX(), at.getY(), 0, 1, 35, 10]]);
  h.tick(1);
  assert.equal(guardian.chat, 'Grrr!'); assert.equal(guardian.chatTick, fell + 1);
  assert.equal(guardian.hits.length, 0);
  h.tick(1);
  assert.deepEqual(guardian.hits, [[fell + 2, 12]], 'the rocks hit it two ticks after the fall (2805 -> 2807: 12)');
  assert.equal(guardian.getHitpoints(), 28);
  assert.deepEqual(guardian.credited.map(([source, amount]) => [source === h.player, amount]), [[true, 12]]);
  assert.deepEqual(h.areaSounds.filter(([tick]) => tick === fell + 2), [[fell + 2, 4971, at.getX(), at.getY(), 0, 1, 0, 10]]);
  h.tick(3); assert.equal(h.cameras.filter(([, key]) => key === 'sendCameraReset').length, 0);
  h.tick(1); assert.deepEqual(h.cameras.filter(([, key]) => key === 'sendCameraReset').map(([tick]) => tick), [fell + 6]);

  // A mined pillar can't be mined again.
  const before = h.messages.length;
  mine({ player: h.player, objectId: O.STRUCTURAL_PILLAR, object: first, clickType: 1 });
  assert.equal(h.messages.length, before);

  // The fourth pillar takes whatever the Guardian has left.
  for (const roll of [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]) { rolls.push(...roll); click(); h.tick(3); }
  assert.deepEqual(guardian.hits.map(([, damage]) => damage), [12, 10, 10, 8]);
  assert.equal(guardian.getHitpoints(), 0);
  assert.deepEqual(h.xp.map(x => x.amount), [10, 10, 10, 10]);
  assert.equal(h.quest.getStage(h.player), 3, 'the stage waits for the Guardian to die');
  assert.equal(h.removed.includes(guardian), false, 'its own death removes it');
  h.hooks.npcDeath[0]({ npc: guardian, npcId: guardian.getId(), killer: h.player });
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.varbits.get(12063), 40);
  h.player.getPrivateArea().destroy();
});

test('a quest-owned Guardian does not regenerate between pillars; ordinary NPCs still regenerate', t => {
  const h = setup({ nativeSpawns: true }), { NPC, Location, World } = h.core;
  const cycle = World.getProcessCycle();
  h.api.removeNpc = npc => { h.removed.push(npc); PluginManager.removeNpc(npc); };
  h.quest.setStage(h.player, 3);
  h.action(h.core.NpcIdentifiers.WILLOW, 'wWX1Ws');
  const guardian = h.spawned.at(-1);
  t.after(() => { PluginManager.removeNpc(guardian); h.player.getPrivateArea().destroy(); World.processCycle = cycle; });
  assert.ok(guardian instanceof NPC);
  assert.equal(guardian.getMaxHitpoints(), 40);
  const ordinary = new NPC(guardian.getId(), new Location(2952, 5778));
  ordinary.setHitpoints(30);
  for (let tick = 0; tick < 100; tick++) ordinary.process();
  assert.equal(ordinary.getHitpoints(), 31, 'a normal unflagged NPC regenerates 1 hitpoint per 100 ticks');
  t.mock.method(Math, 'random', () => 0);
  h.api.onCustomEvent('mining:best-pickaxe', event => { event.pickaxe = { animation: new h.core.Animation(625) }; });
  for (let mined = 1; mined <= 3; mined++) {
    const object = h.objects.find(object => object.getId() === h.core.ObjectIdentifiers.STRUCTURAL_PILLAR);
    h.player.moveTo(object.getLocation().transform(1, 0));
    h.hooks.objects[0]({ player: h.player, objectId: object.getId(), object, clickType: 1 });
    h.tick(3);
    assert.equal(guardian.getHitpoints(), 40 - 10 * mined);
    for (let tick = 0; tick < 100; tick++) { World.processCycle++; guardian.process(); }
    assert.equal(guardian.getHitpoints(), 40 - 10 * mined, 'mining-only damage survives ordinary NPC processing');
  }
});

test('entrance uses a private crew and Marley scene, then replaces the awakening with a combat guardian', () => {
  const h = setup(), N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 2);
  h.action(N.WILLOW, 'fOQUgc');
  const exterior = h.player.getPrivateArea();
  assert.equal(exterior.getName(), 'Opening Camdozaal');
  assert.deepEqual(h.spawned.map(npc => npc.getId()), [N.CHECKAL_2, N.BURNTOF_3, N.WILLOW_2, N.MARLEY_2]);
  h.action(N.WILLOW, 'JSFicf');
  assert.equal(exterior.template.tick, 2031);
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
  // Raw capture 1636 cycles 346–549: original instance coordinates, not RSProx text normalization.
  assert.deepEqual(h.cameras, [
    [1, "sendCameraMoveTo", 13568, 717, 500, {"rate": 232, "rate2": 232}],
    [1, "sendCameraLookAt", 13574, 717, 350, {"rate": 232, "rate2": 232}],
    [18, "sendCameraLookAt", 13576, 719, 280, {"rate": 1, "rate2": 1}],
    [20, "sendCameraMoveTo", 13589, 724, 670, {"rate": 232, "rate2": 232}],
    [20, "sendCameraLookAt", 13578, 724, 250, {"rate": 232, "rate2": 232}],
    [35, "sendCameraMoveTo", 13611, 724, 430, {"rate": 3, "rate2": 3}],
    [44, "sendCameraLookAt", 13605, 724, 400, {"rate": 232, "rate2": 232}],
    [44, "sendCameraMoveTo", 13605, 717, 430, {"rate": 232, "rate2": 232}],
    [45, "sendCameraLookAt", 13605, 745, 400, {"rate": 3, "rate2": 3}],
    [45, "sendCameraMoveTo", 13605, 738, 430, {"rate": 3, "rate2": 3}],
    [57, "sendCameraMoveTo", 13671, 657, 300, {"rate": 232, "rate2": 232}],
    [57, "sendCameraLookAt", 13667, 655, 280, {"rate": 232, "rate2": 232}],
    [77, "sendCameraMoveTo", 13670, 663, 290, {"rate": 232, "rate2": 232}],
    [77, "sendCameraLookAt", 13670, 670, 280, {"rate": 232, "rate2": 232}],
    [98, "sendCameraReset"],
    [98, "sendCameraLookAt", 13661, 654, 280, {"rate": 232, "rate2": 232}],
    [98, "sendCameraMoveTo", 13661, 643, 600, {"rate": 232, "rate2": 232}],
    [103, "sendCameraLookAt", 13658, 649, 280, {"rate": 2, "rate2": 2}],
    [103, "sendCameraMoveTo", 13635, 643, 400, {"rate": 3, "rate2": 3}],
    [103, "sendCameraLookAt", 13658, 649, 0, {"rate": 1, "rate2": 1}],
    [104, "sendCameraLookAt", 13656, 649, 0, {"rate": 1, "rate2": 1}],
    [105, "sendCameraLookAt", 13654, 649, 0, {"rate": 1, "rate2": 1}],
    [106, "sendCameraLookAt", 13652, 649, 0, {"rate": 1, "rate2": 1}],
    [107, "sendCameraLookAt", 13650, 649, 0, {"rate": 1, "rate2": 1}],
    [108, "sendCameraLookAt", 13648, 649, 0, {"rate": 1, "rate2": 1}],
    [109, "sendCameraLookAt", 13646, 649, 0, {"rate": 1, "rate2": 1}],
    [110, "sendCameraLookAt", 13644, 649, 0, {"rate": 1, "rate2": 1}],
    [111, "sendCameraLookAt", 13642, 649, 0, {"rate": 1, "rate2": 1}],
    [112, "sendCameraLookAt", 13640, 649, 0, {"rate": 1, "rate2": 1}],
    [113, "sendCameraLookAt", 13638, 649, 0, {"rate": 1, "rate2": 1}],
    [114, "sendCameraLookAt", 13636, 649, 0, {"rate": 1, "rate2": 1}],
    [115, "sendCameraLookAt", 13631, 649, 0, {"rate": 1, "rate2": 0}],
    [117, "sendCameraMoveTo", 13585, 659, 400, {"rate": 1, "rate2": 1}],
    [120, "sendCameraMoveTo", 13625, 664, 600, {"rate": 3, "rate2": 3}],
    [120, "sendCameraLookAt", 13605, 660, 0, {"rate": 1, "rate2": 0}],
    [123, "sendCameraLookAt", 13592, 664, 0, {"rate": 1, "rate2": 0}],
    [131, "sendCameraMoveTo", 13671, 657, 300, {"rate": 232, "rate2": 232}],
    [131, "sendCameraLookAt", 13667, 655, 280, {"rate": 232, "rate2": 232}],
    [160, "sendCameraMoveTo", 13570, 756, 300, {"rate": 232, "rate2": 232}],
    [160, "sendCameraLookAt", 13575, 756, 280, {"rate": 232, "rate2": 232}],
    [160, "sendCameraMoveTo", 13598, 756, 300, {"rate": 3, "rate2": 3}],
    [160, "sendCameraLookAt", 13608, 756, 280, {"rate": 3, "rate2": 0}],
    [171, "sendCameraLookAt", 13623, 755, 280, {"rate": 1, "rate2": 0}],
    [171, "sendCameraMoveTo", 13598, 756, 600, {"rate": 3, "rate2": 3}],
    [176, "sendCameraLookAt", 13663, 755, 280, {"rate": 1, "rate2": 0}],
    [176, "sendCameraMoveTo", 13638, 756, 600, {"rate": 3, "rate2": 3}],
    [178, "sendCameraMoveTo", 13618, 755, 500, {"rate": 232, "rate2": 232}],
    [178, "sendCameraLookAt", 13608, 755, 280, {"rate": 232, "rate2": 232}],
    [183, "sendCameraMoveTo", 13623, 755, 500, {"rate": 2, "rate2": 2}],
    [183, "sendCameraLookAt", 13638, 755, 400, {"rate": 232, "rate2": 232}],
    [188, "sendCameraMoveTo", 13637, 750, 700, {"rate": 3, "rate2": 3}],
    [188, "sendCameraLookAt", 13640, 755, 650, {"rate": 3, "rate2": 3}],
    [204, "sendCameraMoveTo", 13671, 657, 300, {"rate": 232, "rate2": 232}],
    [204, "sendCameraLookAt", 13667, 655, 280, {"rate": 232, "rate2": 232}]
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

test('unknown creature blocks do not send a human rig through the native guardian fight', async t => {
  const core = PluginManager.getCoreApi();
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
  const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { RangedCombatMethod } = require('../dist/game/content/combat/method/impl/RangedCombatMethod');
  new NpcDefinitionLoader().load(); core.RegionManager.init(); core.RegionManager.loadMapFiles(2999, 3493);
  const api = PluginManager.createApi('NativeGuardianHitRegression');
  require('../plugins/quests/quests/BelowIceMountain.Quest')(api);
  const quest = runtime.getRegisteredQuests().find(q => q.key === 'below_ice_mountain');
  let serial = 0;
  function fighter(test) {
    let p;
    const frames = [], views = [], animations = [], playerAnimations = [];
    const channel = { kind: 'test', binaryTransport: true, isOpen: () => true,
      send: frame => { frames.push(Buffer.from(frame)); return true; }, close() {}, onData() {}, onClose() {}, onError() {} };
    const session = new PlayerSession(channel); p = new Player(session); session.setPlayer(p);
    p.setUsername('guardian-hit-' + serial++); p.setLocation(new core.Location(2998, 3493, 0));
    p.setNeedsPlacement(false); p.setRunning(false);
    for (const skill of [core.Skill.HITPOINTS, core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE]) {
      p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevel(skill, 99, false);
    }
    // Keep native registration, mechanics and sync; account-file I/O is outside the fixture.
    test.mock.method(p, 'onAdd', () => {}); test.mock.method(p, 'onRemove', () => {});
    const performPlayer = p.performAnimation.bind(p);
    test.mock.method(p, 'performAnimation', animation => { playerAnimations.push(animation.getId()); return performPlayer(animation); });
    assert.equal(core.World.getPlayers().add(p), true); core.World.refreshActiveRegions();
    api.onCustomEvent('network:sync-views', event => { if (event.player === p) views.push(...event.npcs.map(view => ({ tick: event.tick, ...view }))); });
    const turn = () => { core.World.process(); session.flushPackets(); };
    quest.setStage(p, 3);
    new ObjectActionPacketListener().executeAction(p, 41357, 2999, 3493, 1, 'Enter');
    let guardian;
    for (let tick = 0; tick < 12 && !guardian; tick++) {
      turn(); guardian = core.World.getNpcs().search(npc => npc.getId() === 10654 && npc.getOwner() === p);
    }
    assert.ok(guardian, 'the registered cache entrance action creates the quest-owned actor');
    assert.ok(guardian.hasFlag('combat:no-regen'));
    turn(); turn();
    const area = p.getPrivateArea(), at = area.sourceTile(2952, 5778);
    guardian.getCombat().reset(); guardian.getCombat().setAttackDelay(40);
    guardian.moveTo(at); guardian.setNeedsPlacement(false); p.moveTo(at.transform(-1, 0)); p.setNeedsPlacement(false);
    const ordinaryAt = area.sourceTile(2956, 5778);
    const ordinary = api.spawnNpc({ id: 10654, x: ordinaryAt.getX(), y: ordinaryAt.getY(), z: 0, owner: p, ownerOnly: true, wanderRadius: 0 });
    assert.ok(ordinary); area.add(ordinary); ordinary.getCombat().setAttackDelay(40); turn(); turn();
    for (const npc of [guardian, ordinary]) {
      const perform = npc.performAnimation.bind(npc);
      test.mock.method(npc, 'performAnimation', animation => { animations.push({ index: npc.getIndex(), id: animation.getId() }); return perform(animation); });
      npc.getCombat().setAttackDelay(40);
    }
    test.after(() => {
      PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
      core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
      for (const npc of [guardian, ordinary]) if (npc.isRegistered()) api.removeNpc(npc);
      core.World.getPlayers().remove(p); core.World.refreshActiveRegions();
    });
    return { p, guardian, ordinary, turn, frames, views, animations, playerAnimations };
  }

  await t.test('fallbacks preserve humans and every resolved role across repeated hydration', () => {
    const expected = new Map([
      [10654, -1], [113, -1], // Ancient Guardian and an unrelated unknown creature.
      [397, 424], [514, 424], [11945, 424], // Guard, Witch and a feature-prefixed human idle.
      [3014, 424], [3106, 425], [5779, 3311], // Authored Man variants and Giant Mole.
      [2, 1509], [26, 5567], // Captured spectre parry and cache-family zombie defend.
      [12811, -1], // Explicit no-block on a human-family Serpent shaman.
      [5037, 424], [10665, -1], // Nonattackable human and guardian scene actors.
    ]);
    for (let load = 0; load < 2; load++) {
      if (load) new NpcDefinitionLoader().load();
      for (const [id, block] of expected) {
        const definition = NpcDefinition.forId(id);
        assert.equal(definition.getDefenceAnim(), block, `${id} keeps its resolved role after load ${load}`);
        assert.equal(NpcDefinition.forId(id), definition);
        assert.equal(NpcDefinition.forId(id).getDefenceAnim(), block, `${id} hydration cannot replace a resolved block`);
      }
    }
  });

  await t.test('queued ranged impacts damage both real guardians without replacing an existing attack pose', test => {
    const f = fighter(test);
    for (const npc of [f.guardian, f.ordinary]) npc.performAnimation(new core.Animation(npc.getAttackAnim()));
    f.turn();
    const afterAttack = f.views.length, before = [f.guardian.getHitpoints(), f.ordinary.getHitpoints()];
    for (const npc of [f.guardian, f.ordinary]) {
      CombatFactory.addPendingHit(new PendingHit(f.p, npc, new RangedCombatMethod(),
        { delay: 1, damage: 1, rollAccuracy: false, experience: false, handleAfterHitEffects: false }));
    }
    // The queued delay plus the native NPC processing offset puts impact two ticks later.
    f.turn(); f.turn();
    assert.equal(f.guardian.getHitpoints(), before[0] - 1);
    assert.equal(f.ordinary.getHitpoints(), before[1] - 1);
    for (const npc of [f.guardian, f.ordinary]) {
      const impacts = f.views.slice(afterAttack).filter(view => view.index === npc.getIndex() && view.hits?.length);
      assert.ok(impacts.some(view => view.hits.some(hit => hit.damage === 1)), 'the native session publishes the real damage');
      assert.ok(impacts.every(view => view.animation === undefined), 'an unknown reaction neither selects424 nor resets the active attack');
      assert.deepEqual(f.animations.filter(row => row.index === npc.getIndex()).map(row => row.id), [8942]);
    }
    assert.ok(f.frames.length, 'actual NPC_INFO frames were flushed');
  });

  await t.test('a real melee launch also leaves the creature pose alone', test => {
    const f = fighter(test), expectedAttack = f.p.getAttackAnim(f.guardian);
    f.guardian.performAnimation(new core.Animation(f.guardian.getAttackAnim())); f.turn();
    const afterAttack = f.views.length;
    f.p.getCombat().setAttackDelay(0); f.p.getCombat().attack(f.guardian);
    f.turn(); f.turn();
    assert.ok(f.playerAnimations.includes(expectedAttack), 'the ordinary player melee method actually launched');
    assert.deepEqual(f.animations.filter(row => row.index === f.guardian.getIndex()).map(row => row.id), [8942],
      'the launch-side block consumer cannot send a human block or a reset');
    assert.ok(f.views.slice(afterAttack).filter(view => view.index === f.guardian.getIndex()).every(view => view.animation === undefined));
  });
});

function assertCapturedScene(h) {
  const area = h.player.getPrivateArea(), template = area.template;
  const { palette } = area.buildScenePalette(
    area.baseChunkX + template.center[0] - template.base[0],
    area.baseChunkY + template.center[1] - template.base[1]);
  assert.deepEqual(palette, template.palette, 'exact captured chunks, rotations, planes and intentional holes');
}
test('every workout tick replays its exact captured palette including rotations and holes', () => {
  const h = setup(), N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 1); h.attrs.set(CHECKAL, 10);
  h.action(N.ATLAS, '_RwWTk');
  for (let tick = 0; tick < 206; tick++) { assertCapturedScene(h); h.tick(1); }
  h.hooks.logout[0]({ player: h.player });
});

test('RPS preserves lower-floor scenery and the captured player facing', () => {
  const h = setup(), N = h.core.NpcIdentifiers; h.quest.setStage(h.player, 1);
  h.action(N.BURNTOF, 'Lv8k9i');
  assertCapturedScene(h);
  assert.deepEqual(h.player.facing, h.player.getPrivateArea().sourceTile(2956, 3370));
  h.hooks.logout[0]({ player: h.player });
});
test('entrance and interior crew preserve capture 1636 spawn directions and targets', () => {
  const h = setup(), N = h.core.NpcIdentifiers; h.quest.setStage(h.player, 2);
  h.action(N.WILLOW, 'fOQUgc');
  let area = h.player.getPrivateArea();
  assertCapturedScene(h);
  assert.deepEqual(h.spawned.map(npc => npc.def.face), [4, 2, 3, 7]);
  h.spawned.forEach((npc, i) => assert.deepEqual(npc.facing, area.sourceTile(i === 2 ? 2996 : 2997, 3494)));
  h.action(N.WILLOW, '1Pscfp');
  area = h.player.getPrivateArea();
  assertCapturedScene(h);
  const crew = h.spawned.slice(-4);
  assert.deepEqual(crew.map(npc => npc.def.face), [7, 3, 7, 6]);
  crew.forEach((npc, i) => assert.deepEqual(npc.facing, area.sourceTile(2953, i === 1 ? 5771 : 5770)));
  for (const x of [40, 63]) for (const y of [40, 63]) {
    h.player.moveTo(area.tile(x, y, 0)); assert.equal(area.contains(h.player.getLocation()), true); assertCapturedScene(h);
  }
  for (const [x, y] of [[39, 40], [64, 40], [40, 39], [40, 64]]) {
    const tile = area.tile(x, y, 0);
    assert.equal(area.contains(tile), false);
    assert.notEqual(area.getClip(tile) & 0x200000, 0);
  }
  h.hooks.logout[0]({ player: h.player });
});

test('workout resets interrupted animations and preserves the captured cheer delay', () => {
  const h = setup(), N = h.core.NpcIdentifiers; h.quest.setStage(h.player, 1); h.attrs.set(CHECKAL, 10);
  h.action(N.ATLAS, '_RwWTk');
  h.tick(1); assert.equal(h.animations.at(-1).id, -1);
  h.tick(76); assert.equal(h.animations.at(-1).id, -1);
  h.tick(82); assert.equal(h.animations.at(-1).id, -1);
  h.tick(38); assert.equal(h.animations.at(-1).id, 862); assert.equal(h.animations.at(-1).delay, 2);
  h.hooks.logout[0]({ player: h.player });
});

test('canonical source tiles match raw actor positions across rotated cache joins', () => {
  const h = setup(), N = h.core.NpcIdentifiers; h.quest.setStage(h.player, 1); h.attrs.set(CHECKAL, 10);
  h.action(N.ATLAS, '_RwWTk');
  const area = h.player.getPrivateArea();
  const raw = (x, y, sourceX, sourceY) => {
    const tile = area.sourceTile(sourceX, sourceY);
    assert.deepEqual([tile.getX() - area.getBaseX(), tile.getY() - area.getBaseY()],
      [x - area.template.base[0] * 8, y - area.template.base[1] * 8]);
  };
  raw(13574, 717, 3250, 3398); // Raw player teleport at 345, clockwise chunk.
  raw(13593, 722, 3245, 3417); // Raw Man addition at 374.
  const before = area.sourceTile(3245, 3416), after = area.sourceTile(3245, 3415);
  assert.equal(Math.max(Math.abs(before.getX() - after.getX()), Math.abs(before.getY() - after.getY())), 1);
  h.tick(56); raw(13668, 655, 3076, 3423);
  h.tick(103); raw(13575, 756, 3211, 3399);
  h.hooks.logout[0]({ player: h.player });
});

test('interior crew walks and turns follow the captured dialogue cues', () => {
  const h = setup(), N = h.core.NpcIdentifiers; h.quest.setStage(h.player, 2);
  h.action(N.WILLOW, 'fOQUgc'); h.action(N.WILLOW, '1Pscfp');
  const area = h.player.getPrivateArea(), [burntof, checkal, marley, willow] = h.spawned.slice(-4);
  const before = text => h.line(N.WILLOW, text).before();
  before("Thrilled? What's there to be excited about?");
  assert.deepEqual(burntof.getLocation(), area.sourceTile(2949, 5775));
  before("It's not about the money though, right?");
  assert.deepEqual(burntof.facing, area.sourceTile(2947, 5775));
  before("Of course it's about the money.");
  assert.deepEqual(burntof.getLocation(), area.sourceTile(2951, 5778));
  before("We're not a team");
  assert.deepEqual(burntof.facing, area.sourceTile(2951, 5779));
  before("But your usefulness");
  assert.deepEqual(burntof.getLocation(), area.sourceTile(2951, 5775));
  before("I can't risk you");
  assert.deepEqual(burntof.getLocation(), area.sourceTile(2950, 5775));
  h.tick(3); assert.deepEqual(burntof.getLocation(), area.sourceTile(2953, 5775));
  before('What was that noise?');
  assert.deepEqual(willow.facing, area.sourceTile(2953, 5775));
  before("Uh... it wasn't me!");
  assert.deepEqual(burntof.facing, area.sourceTile(2953, 5771));
  for (const actor of [checkal, marley]) assert.deepEqual(actor.facing, area.sourceTile(2953, 5775));
  before('Holy Zamorak!');
  assert.deepEqual(willow.facing, area.sourceTile(2952, 5778));
  h.hooks.logout[0]({ player: h.player });
});

test('finishing re-entry and bag animation use the recorded position and facing', () => {
  const h = setup(), N = h.core.NpcIdentifiers; h.quest.setStage(h.player, 4);
  h.hooks.objects[0]({ player: h.player, objectId: h.core.ObjectIdentifiers.RUINS_ENTRANCE, clickType: 1 });
  const area = h.player.getPrivateArea();
  h.hooks.namedObjects.get("Willow's bag").Investigate({ player: h.player, objectId: h.core.ObjectIdentifiers.WILLOWS_BAG });
  assert.deepEqual(h.player.getLocation(), area.sourceTile(2952, 5773));
  h.line(N.RAMARNO_2, "Looks like Willow left a bag behind").before();
  assert.deepEqual(h.player.facing, area.sourceTile(2950, 5769));
  assert.equal(h.animations.at(-1).id, 857);
  h.action(N.RAMARNO_2, 'below-ice-mountain:bag-walk'); h.tick(5);
  assert.deepEqual(h.player.getLocation(), area.sourceTile(2951, 5769));
  assert.deepEqual(h.player.facing, area.sourceTile(2950, 5769), 'west-facing 2223 precedes the rummage at 2224');
  h.tick(1); assert.equal(h.animations.at(-1).id, 6840);
  h.hooks.logout[0]({ player: h.player });
});

test('the journal sends the text local 1001343 recorded at each stage it was opened', () => {
  const h = setup();
  const BURNTOF = 'quest.below_ice_mountain.burntof';
  const sent = () => runtime.journalWidgets(h.quest, h.player)[1].staticChildren.map(line => line.text);
  const intro = [
    '<col=000080>I spoke to an archaeologist called <col=800000>Willow<col=000080> near <col=800000>Ice Mountain<col=000080>.',
    '<col=000080>She asked me to help her find a way into some <col=800000>Ancient Ruins<col=000080>',
    '<col=000080>beneath the mountain. To do this, she wants me to gather her',
    '<col=000080>old crew together.',
    '',
  ];
  const burntof = [
    '<col=000080>I need to recruit <col=800000>Burntof<col=000080>. I can find him in the <col=800000>Rising Sun Inn<col=000080> in',
    '<col=000080><col=800000>Falador<col=000080>.',
    '',
  ];
  const struckIntro = [
    '<str>I spoke to an archaeologist called Willow near Ice Mountain.',
    '<str>She asked me to help her find a way into some Ancient Ruins',
    '<str>beneath the mountain. To do this, she wanted me to gather',
    '<str>her old crew together.',
  ];
  h.quest.setStage(h.player, 1);
  assert.deepEqual(sent(), [...intro, ...burntof,
    '<col=000080>I need to recruit <col=800000>Checkal<col=000080>. I can find him in <col=800000>Barbarian Village<col=000080>.',
    '',
    "<col=000080>I need to recruit <col=800000>Marley<col=000080>. <col=800000>Willow<col=000080> doesn't know where he is but",
    '<col=000080>suggested I ask <col=800000>Charlie<col=000080>, who can be found near the <col=800000>Blue Moon',
    '<col=800000>Inn<col=000080> in <col=800000>Varrock<col=000080>.',
  ], 'main varbit 10');
  h.attrs.set(CHECKAL, 40); h.attrs.set(MARLEY, 10);
  assert.deepEqual(sent(), [...intro, ...burntof, '<str>I have recruited Checkal.', '',
    '<col=000080>I need to recruit <col=800000>Marley<col=000080> from the <col=800000>Edgeville Ruins<col=000080>. However, he',
    '<col=000080>wants me to bring him a <col=800000>Steak Sandwich<col=000080> before he agrees to',
    "<col=000080>help <col=800000>Willow<col=000080>. To make a <col=800000>Steak Sandwich<col=000080>, I'll need a <col=800000>Knife<col=000080>, some",
    '<col=000080><col=800000>Bread<col=000080> and some <col=800000>Cooked Meat<col=000080>.',
  ], 'Checkal recruited, Marley waiting for his sandwich');
  h.attrs.set(MARLEY, 40); h.attrs.set(BURNTOF, 5);
  assert.deepEqual(sent(), [...intro,
    '<col=000080>I need to recruit <col=800000>Burntof<col=000080> from the <col=800000>Rising Sun Inn<col=000080> in <col=800000>Falador<col=000080>.',
    '<col=000080>However, he wants me to bring him a <col=800000>Beer<col=000080> before he speaks to',
    '<col=000080>me.',
    '', '<str>I have recruited Checkal.', '', '<str>I have recruited Marley.',
  ], 'Burntof waiting for his drink');
  h.attrs.set(BURNTOF, 40); h.quest.setStage(h.player, 2);
  assert.deepEqual(sent(), [...struckIntro,
    '<col=000080>I spoke with <col=800000>Burntof<col=000080>, <col=800000>Checkal<col=000080> and <col=800000>Marley<col=000080>. It took some',
    "<col=000080>convincing, but they've all agreed to work with <col=800000>Willow<col=000080> again. I",
    '<col=000080>should meet up with them all at the entrance to the <col=800000>Ancient',
    '<col=800000>Ruins<col=000080> on the west side of <col=800000>Ice Mountain<col=000080>.',
  ], 'main varbit 20');
  h.quest.setStage(h.player, 5);
  assert.deepEqual(sent(), [...struckIntro,
    '<str>I spoke with Burntof, Checkal and Marley. It took some',
    '<str>convincing, but they all agreed to work with Willow again.',
    '<str>With the help of her crew, Willow managed to gain entry into',
    '<str>the Ancient Ruins.',
    '<str>Inside the Ancient Ruins, Willow revealed herself to be a',
    '<str>graverobber rather than an archaeologist. She tried to kill me,',
    '<str>but was interrupted by an Ancient Guardian activating. Willow',
    '<str>and her crew fled, leaving me with the Ancient Guardian.',
    '<str>I managed to defeat the Ancient Guardian. With Willow gone, I',
    '<str>claimed my reward from a bag she left behind. Now that no',
    '<str>one else is trying to kill me, I can explore the Ancient Ruins at',
    '<str>my leisure.',
    '',
    '<col=ff0000>QUEST COMPLETE!',
  ], 'completed');
});

test('each scene puts the client in a cutscene and gives the tabs back after it (local 1001343)', () => {
  const h = setup(), N = h.core.NpcIdentifiers;
  const state = () => [h.varbits.get(542), h.varbits.get(6719), h.varbits.get(12139)];
  const inventoryClosed = () => h.closedSubs.some(([, uid]) => uid === ((161 << 16) | 79));
  h.quest.setStage(h.player, 1); h.attrs.set(CHECKAL, 10);
  h.action(N.ATLAS, '_RwWTk');
  assert.deepEqual(state(), [1, 2, 1], 'workout, 837: cutscene_status 1, minimap off, gravestone hidden');
  assert.ok(inventoryClosed(), 'the side tabs close with it');
  h.line(N.ATLAS, 'My work is done. Return to Checkal and show him your new-found muscles.').after();
  assert.deepEqual(state(), [0, 0, 0], 'workout, 1068: all back');
  assert.ok(h.tabs.some(([, , group]) => group === 149), 'the inventory tab is mounted again');

  h.closedSubs.length = 0; h.tabs.length = 0;
  h.action(N.BURNTOF, 'Lv8k9i');
  assert.deepEqual(state(), [1, 2, 1], 'rock-paper-scissors, 2038');
  assert.ok(inventoryClosed());
  h.action(N.BURNTOF, 'CU6FG0'); h.tick(8);
  assert.deepEqual(state(), [0, 0, 0], 'rock-paper-scissors, 2174');
  assert.ok(h.tabs.some(([, , group]) => group === 149));

  // A logout inside a scene leaves nothing for the next login to undo.
  h.closedSubs.length = 0; h.tabs.length = 0;
  h.action(N.BURNTOF, 'Lv8k9i');
  h.hooks.logout[0]({ player: h.player });
  assert.equal(h.tabs.length, 0, 'no tab packets go to a player who is logging out');
  h.action(N.BURNTOF, 'Lv8k9i');
  assert.deepEqual(state(), [1, 2, 1], 'the next scene after a relog starts a cutscene again');
  h.hooks.logout[0]({ player: h.player });
});
