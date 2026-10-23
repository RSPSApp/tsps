// From server/: node --test tests/remaining-custodia-dawn-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { ActionDialogue } = require('../dist/game/model/dialogues/entries/impl/ActionDialogue');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function harness(name) {
  const hooks = {}, events = [], tasks = [], npcs = [], objects = [], namedNpcs = new Map(), npcHandlers = [], namedObjects = new Map();
  const ground = new Map(), zones = [];
  const groundManager = {
    getGroundItem(username, id, tile) { return ground.get(`${username}:${id}:${tile.getX()}:${tile.getY()}:${tile.getZ()}`) ?? null; },
    registerLocation(player, item, tile) { ground.set(`${player.getUsername()}:${item.getId()}:${tile.getX()}:${tile.getY()}:${tile.getZ()}`, item); },
  };
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit(task) { task.setRunning(true); tasks.push(task); }, cancelTasks() {} },
      World: { ...core.World, getNpcs: () => npcs },
      ObjectManager: { register: object => { objects.push(object); const area = object.getPrivateArea?.(); const owner = area?.getPlayers?.()[0]; if (owner) owner.getPacketSender().sendObject(object); }, deregister: noop },
    },
    getTaskManager: () => api.core.TaskManager,
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    onZoneEnter: (zone, fn) => { zones.push({ zone, fn }); (hooks.onZoneEnter ??= []).push(fn); },
    onObjectClick: noop,
    onObjectFirstClick: noop,
    getObjectManager: () => ({ register: object => objects.push(object), deregister: noop }),
    getItemOnGroundManager: () => groundManager,
    getWorld: () => ({ getNpcs: () => npcs }),
    onObjectInteraction: (target, actions) => {
      if (typeof target === 'function') (hooks.onObjectInteraction ??= []).push(target);
      else namedObjects.set(target, actions);
    },
    onNpcInteraction: (name, actions) => {
      namedNpcs.set(name, actions);
      for (const [action, fn] of Object.entries(actions)) npcHandlers.push({ name, action, fn });
    },
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    onItemAction: (name, actions) => (hooks.onItemAction ??= []).push(...Object.values(actions ?? {})),
    spawnNpc(definition) {
      let tile = new core.Location(definition.x, definition.y, definition.z);
      const npc = {
        ...definition, index: nextIndex++, getId: () => definition.id, isRegistered: () => !npc.removed,
        getOwner: () => definition.owner, isDyingFunction: () => false, getHitpoints: () => 1, setArea: value => { npc.area = value; }, getArea: () => npc.area ?? null,
        getPrivateArea: () => npc.area ?? null, getCurrentDefinition: player => {
          const vars = {
            getVarbit: id => player?.varbits?.get(id) ?? 0,
            getVarp: id => player?.configs?.get(id) ?? 0,
          };
          const resolved = CacheDefinitions.resolveNpc(definition.id, vars);
          return NpcDefinition.forId(resolved?.id ?? definition.id);
        },
        isVisible: () => true, isOwnerOnly: () => definition.ownerOnly === true,
        isPlayer: () => false, isNpc: () => true,
        getIndex: () => npc.index, getAsNpc: () => npc, setPositionToFace: noop,
        getLocation: () => tile, moveTo: value => { tile = value; }, forceChat: text => { npc.chat = text; },
        remove() { npc.removed = true; },
      };
      npcs.push(npc);
      return npc;
    },
    removeNpc: npc => { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  const names = [].concat(name);
  for (const questName of names) require(`../plugins/quests/quests/${questName}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  return {
    api, hooks, events, objects, npcs, namedNpcs, npcHandlers, namedObjects, ground, zones, quests: runtime.getRegisteredQuests().slice(-[].concat(name).length), quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    object(player, objectId, clickType = 1, location = null) {
      const tile = location?.getX ? { x: location.getX(), y: location.getY(), z: location.getZ() } : location ?? {
        x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ(),
      };
      const event = {
        player, objectId, clickType, option: 'Inspect',
        object: { getId: () => objectId, getLocation: () => new core.Location(tile.x, tile.y, tile.z) },
        definition: { getName: () => '', getInteractions: () => ['', 'Inspect'] },
        location: { x: tile.x, y: tile.y, z: tile.z },
        sourceLocation: { x: tile.x, y: tile.y, z: tile.z },
        handled: false,
      };
      for (const fn of hooks.onObjectInteraction ?? []) fn(event);
      return event;
    },
    action(player, npcId, stepId) {
      const event = { player, npcId, stepId };
      this.emit('npc-dialogue:action', event);
      return event;
    },
    line(player, npcId, text) {
      const event = { player, npcId, text };
      this.emit('npc-dialogue:line', event);
      return event;
    },
    talk(player, npcId) {
      const variant = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player, npcId })).find(Boolean);
      assert.ok(variant, `no variant for ${npcId}`);
      runtime.startTranscript(api, player, npcId, typeof variant === 'string' ? this.quest.name : variant.page, typeof variant === 'string' ? variant : variant.variant);
    },
    tick(count = 1) {
      while (count-- > 0) {
        for (const task of [...tasks]) task.tick();
      }
    },
    login(player) { for (const fn of hooks.onPlayerLogin ?? []) fn({ player }); },
    advanceToPrompt(player, limit = 80) {
      while (!player.prompt) {
        assert.ok(limit-- > 0, 'dialogue stalled');
        assert.ok(player.manager.getCurrent(), 'dialogue ended');
        player.manager.advance();
      }
    },
    choose(player, label) {
      const prompt = player.prompt;
      assert.ok(prompt, `no prompt for ${label}`);
      const index = prompt.options.indexOf(label);
      assert.ok(index >= 0, `missing ${label}`);
      player.prompt = null;
      prompt.pairs[index * 2 + 1]();
    },
    interfaceClick(player, groupId, childId) {
      for (const fn of hooks.onInterfaceActionClick ?? []) fn({ player, groupId, childId, handled: false });
    },
  };
}

function player(level = 99, current = 99) {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], clientRemovals = [], clientSpawns = [];
  let location = new core.Location(3210, 3220, 0), area = null;
  const packet = new Proxy({
    sendVarbit: (id, value) => varbits.set(id, value),
    sendConfig: (id, value) => configs.set(id, value),
    sendMessage: text => p.messages.push(text),
    sendInterfaceRemoval: () => p.manager?.reset?.(),
    sendCameraMoveTo: (...args) => { p.camera.push(['move', ...args]); return packet; },
    sendCameraLookAt: (...args) => { p.camera.push(['look', ...args]); return packet; },
    sendCameraReset: () => { p.camera.push(['reset']); return packet; },
    sendCameraShake: (...args) => { p.camera.push(['shake', ...args]); return packet; },
    sendSubInterface: (...args) => { p.camera.push(['sub', ...args]); return packet; },
    closeSubInterface: (...args) => { p.camera.push(['close', ...args]); return packet; },
    sendObjectRemoval: object => { clientRemovals.push(object); return packet; },
    sendObject: object => { clientSpawns.push(object); return packet; },
    sendInterface: id => { p.interface = id; return packet; },
    sendInterfaceScript: (id, args) => { p.interfaceScript = { id, args }; return packet; },
    sendEnterAmountPrompt: title => { p.amountPrompt = title; return packet; },
  }, { get: (t, key) => t[key] ?? (() => packet) });
  const p = {
    attrs, items, configs, varbits, log, clientRemovals, clientSpawns, messages: [], camera: [], full: false,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => ({
      getAmount: id => items.get(id) ?? 0,
      getFreeSlots: () => (p.full ? 0 : 28),
      isFull: () => p.full === true,
      adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => items.set(id, (items.get(id) ?? 0) - amount),
    }),
    getSkillManager: () => ({
      getMaxLevel: () => level,
      getCurrentLevel: () => current,
      addExperiences: noop,
    }),
    getPacketSender: () => packet,
    getDialogueManager: () => p.manager,
    getEquipment: () => ({ get: slot => (slot === core.Equipment.BODY_SLOT ? { getId: () => I.EMISSARY_ROBE_TOP } : { getId: () => I.EMISSARY_ROBE_BOTTOM }) }),
    getLocation: () => location,
    moveTo: to => { location = to; },
    getArea: () => area,
    setArea: value => { area = value; },
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; },
      isMovementBlocked: () => p.blocked === true, didMovePreviousCycle: () => false }),
    getPrivateArea: () => area, getHitpoints: () => 99, performAnimation: noop,
    setUntargetable: value => { p.untargetable = value; },

    getUsername: () => 'Parity',
    sendMessage: text => p.messages.push(text),
    setEnteredAmountAction(action) { p.amountAction = action; },
    getEnteredAmountAction() { return p.amountAction; },
    getIndex: () => 1,
    getAsPlayer: () => p,
    isPlayer: () => true,
    isRegistered: () => true,
    isPlayerBot: () => false,
    getWorld: () => null,
  };
  p.manager = new DialogueManager(p);
  return p;
}

function advanceTranscript(h, p, keepGoing, limit = 200) {
  while (limit-- > 0 && keepGoing() && p.manager.getCurrent()) {
    const current = p.manager.getCurrent();
    if (current instanceof ActionDialogue) {
      h.tick(2);
      if (p.manager.getCurrent() === current) p.manager.advance();
    } else {
      p.manager.advance();
      h.tick(2);
    }
  }
  assert.ok(limit > 0, 'transcript should finish without skipping overhead continuations');
}

function completeQuests(h, keys) {
  (h.events['quest:is-complete'] ??= []).push(event => {
    if (keys.includes(event.key)) event.complete = true;
  });
}

const SUN_ORDER_STEPS = [[1, 5], [7, 3], [6, 4]]; // [Itzla, player], QH order 1
function sunPair(step) {
  const [itzla, player] = SUN_ORDER_STEPS[step];
  return [player, itzla];
}
const SUN_TILES = [[1337,9453],[1339,9446],[1337,9439],[1330,9436],[1323,9439],[1320,9446],[1323,9453],[1330,9456]];


test('Final Dawn start survives Heart of Darkness completion through the shipped cache transform', () => {
  const h = harness(['TheHeartOfDarkness', 'TheFinalDawn']), p = player();
  const hod = h.quests.find(quest => quest.key === 'the_heart_of_darkness');
  const fd = h.quests.find(quest => quest.key === 'the_final_dawn');
  assert.ok(hod && fd);

  hod.complete(p);
  h.emit('player:bootstrap-complete', { player: p });
  assert.equal(p.varbits.get(16668), 1);

  const base = CacheDefinitions.getNpc(14054);
  const resolved = base.transform(
    { getVarbit: id => p.varbits.get(id) ?? 0, getVarp: () => 0 },
    { load: id => CacheDefinitions.getNpc(id) }
  );
  assert.equal(resolved?.id, 13694);
  assert.equal(resolved?.name, 'Servius, Teokan of Ralos');

  completeQuests(h, ['the_heart_of_darkness', 'perilous_moons', 'twilights_promise', 'children_of_the_sun']);
  const talk = h.npcHandlers.filter(handler => handler.name === 'Servius, Teokan of Ralos' && handler.action === 'Talk-to');
  let handled = false;
  for (const handler of talk) handled = handler.fn({ player: p, npcId: resolved.id }) || handled;
  assert.equal(handled, true);
  assert.equal(fd.getStage(p), 0);
  assert.ok(p.manager.getCurrent());

  h.advanceToPrompt(p);
  h.choose(p, 'Yes.');
  assert.equal(fd.getStage(p), 1);
  const countBefore = h.npcs.filter(npc => [14054, 13694, 14377].includes(npc.id)).length;
  for (const handler of talk) handler.fn({ player: p, npcId: 13694 });
  assert.equal(fd.getStage(p), 1);
  assert.equal(h.npcs.filter(npc => [14054, 13694, 14377].includes(npc.id)).length, countBefore);

  fd.complete(p);
  handled = false;
  for (const handler of talk) handled = handler.fn({ player: p, npcId: 13694 }) || handled;
  assert.equal(handled, true);
  assert.equal(h.npcs.filter(npc => [14054, 13694, 14377].includes(npc.id)).length, countBefore);
});

test('Shadows of Custodia matches captured stage 4 on Ictus and advances once inside the den', () => {
  const h = harness('ShadowsOfCustodia'), p = player();
  h.quest.setStage(p, 2);
  h.line(p, 14212, 'Oh, yes!');
  assert.equal(h.quest.getStage(p), 4);
  h.line(p, 14208, 'Hello.');
  h.line(p, 14660, 'Welcome.');
  h.line(p, 14656, 'Nilsal.');
  assert.equal(h.quest.getStage(p), 4);
  h.quest.setStage(p, 10);
  const enter = { player: p, objectId: 56439, clickType: 2, definition: { getInteractions: () => ['', 'Enter'] } };
  for (const fn of h.hooks.onObjectInteraction) fn(enter);
  h.tick(2);
  assert.equal(h.quest.getStage(p), 12);
  for (const fn of h.hooks.onZoneEnter ?? []) fn({ player: p });
});

test('Shadows of Custodia refuses to reinforce before stage 15 and keeps the logs', () => {
  const h = harness('ShadowsOfCustodia'), p = player();
  h.quest.setStage(p, 6);
  p.items.set(I.MAPLE_LOGS, 4); p.items.set(I.HAMMER, 1);
  const event = { player: p, objectId: 56432, clickType: 2, definition: { getInteractions: () => ['', 'Reinforce'] } };
  for (const fn of h.hooks.onObjectInteraction) fn(event);
  assert.equal(p.items.get(I.MAPLE_LOGS), 4);
  assert.equal(h.quest.getStage(p), 6);
});

test('The Final Dawn applies all four quest prerequisites and base levels', () => {
  const h = harness('TheFinalDawn'), p = player(99, 1);
  h.quest.setStage(p, 0);
  h.emit('npc-dialogue:hook', { player: p, hook: 'quest:the-final-dawn:start' });
  assert.equal(h.quest.getStage(p), 0);
  completeQuests(h, ['the_heart_of_darkness', 'perilous_moons', 'twilights_promise']);
  h.emit('npc-dialogue:hook', { player: p, hook: 'quest:the-final-dawn:start' });
  assert.equal(h.quest.getStage(p), 0);
  completeQuests(h, ['children_of_the_sun']);
  h.emit('npc-dialogue:hook', { player: p, hook: 'quest:the-final-dawn:start' });
  assert.equal(h.quest.getStage(p), 1);
});

test('The Final Dawn sun altar consumes essence and the barrel puzzle needs the glass before the lever', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 55);
  const [playerAltar, itzlaAltar] = sunPair(0);
  p.attrs.set('the-final-dawn:sun-itzla', (itzlaAltar + 1) % 8);
  p.items.set(I.KUHU_ESSENCE, 1);
  h.object(p, 56687, 1, { x: SUN_TILES[playerAltar][0], y: SUN_TILES[playerAltar][1], z: 1 });
  assert.equal(p.attrs.get('quest.the_final_dawn.sun'), undefined);
  assert.equal(p.items.get(I.KUHU_ESSENCE), 1);
  p.attrs.set('the-final-dawn:sun-itzla', itzlaAltar);
  h.object(p, 56687, 1, { x: SUN_TILES[playerAltar][0], y: SUN_TILES[playerAltar][1], z: 1 });
  assert.equal(p.attrs.get('quest.the_final_dawn.sun'), 1);
  assert.equal(p.items.get(I.KUHU_ESSENCE), 0);

  h.quest.setStage(p, 31);
  for (const [objectId, itemId] of [[56491, I.BEER], [56492, I.STEAMFORGE_BREW], [56493, I.DWARVEN_STOUT], [56494, I.WIZARDS_MIND_BOMB], [56490, I.BEER_GLASS]]) {
    p.items.set(itemId, 1);
    for (const fn of h.hooks.onItemOnObject) fn({ player: p, objectId, itemId, handled: false });
  }
  assert.equal(p.attrs.get('quest.the_final_dawn.barrels'), 5);
  h.object(p, 56496);
  h.action(p, N.ATTALA, 'pRXkuK');
  assert.equal(h.quest.getStage(p), 34);
});

test('The Final Dawn mirrors Quest Helper progress varbits from actual progress only', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 30);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(16670) ?? 0, 0, 'beer not given before the action');
  h.action(p, N.GALNA, 'FvNbYY');
  assert.equal(h.quest.getStage(p), 31);
  assert.equal(p.varbits.get(16670), 1, 'beer action mirrors 16670');

  const legacy = player();
  h.quest.setStage(legacy, 45);
  h.hooks.onPlayerLogin[0]({ player: legacy });
  assert.equal(legacy.varbits.get(16670), 1, 'older stage truthfully implies beer given');

  p.varbits.delete(16670);
  h.emit('player:bootstrap-complete', { player: p });
  assert.equal(p.varbits.get(16670), 1, 'bootstrap resends 16670');

  h.quest.setStage(p, 55);
  h.hooks.onPlayerLogin[0]({ player: p });
  p.moveTo(new core.Location(1330, 9446, 1));
  h.namedNpcs.get('Prince Itzla Arkan')['Talk-to']({ player: p, npcId: 14282 });
  for (let step = 0; step < 200 && p.manager.getCurrent() && !p.prompt; step++) p.manager.advance();
  h.choose(p, 'Can you go to an altar for me?');
  for (let step = 0; step < 200 && p.manager.getCurrent() && !p.prompt; step++) p.manager.advance();
  h.choose(p, 'East.');
  assert.equal(p.varbits.get(16712), 1, 'Itzla moved mirrors 16712');
  for (let step = 0; step < 3; step++) {
    const [playerAltar, itzlaAltar] = sunPair(step);
    p.attrs.set('the-final-dawn:sun-itzla', itzlaAltar);
    p.items.set(I.KUHU_ESSENCE, 1);
    h.object(p, 56687, 1, { x: SUN_TILES[playerAltar][0], y: SUN_TILES[playerAltar][1], z: 1 });
    assert.equal(p.varbits.get(16675), step + 1, `sun progress step ${step + 1}`);
    assert.equal(p.varbits.get(16712), 0, 'successful imbue resets Itzla state');
  }

  p.items.set(I.ROOT_KINDLING, 20);
  for (const [need, expected] of [[2, 1], [6, 2], [6, 3]]) {
    h.object(p, 56690, 1, { x: 1282, y: 9445, z: 1 });
    if (p.manager.getCurrent()) p.manager.advance();
    assert.ok(p.amountAction, `moon countdialog step ${expected}`);
    p.amountAction.execute(need);
    assert.equal(p.varbits.get(16677), expected, `moon progress step ${expected}`);
  }

  h.quest.setStage(p, 65);
  h.hooks.onPlayerLogin[0]({ player: p });
  h.object(p, 56600, 1, { x: 1304, y: 9527, z: 1 });
  assert.equal(p.varbits.get(16695), 1, 'Ralos inspect mirrored');
  h.object(p, 56603, 1, { x: 1317, y: 9527, z: 1 });
  assert.equal(p.varbits.get(16696), 1, 'Ranul inspect mirrored');
  h.object(p, 56613, 1, { x: 1310, y: 9533, z: 1 });
  assert.equal(p.varbits.get(16717), 1, 'door inspect mirrored');
  h.object(p, 56595, 1, { x: 1307, y: 9532, z: 1 });
  assert.equal(p.varbits.get(16697), 1, 'tablet inspect mirrored');
  assert.equal(h.quest.getStage(p), 66);

  h.quest.setStage(p, 6);
  p.items.set(I.KEY_37, 1);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(16667) ?? 0, 0, 'drawers locked until the key is used');
  h.object(p, 56530, 1, { x: 1713, y: 9714, z: 0 });
  assert.ok(p.items.get(I.CANVAS_PIECE), 'drawer action took the canvas');
  assert.equal(p.varbits.get(16667), 1, 'drawer unlock mirrored from the real search');
  h.quest.setStage(p, 4);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(16667) ?? 0, 0, 'drawers closed before the key');
  assert.equal(p.varbits.get(16666), undefined, 'unmodeled drawer choice is not faked');
  assert.equal(p.varbits.get(16694), undefined, 'unmodeled lift is not faked');
});


test('The Final Dawn safe-house follows captured stages 15 to 22', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 14);
  h.object(p, 56498); assert.equal(h.quest.getStage(p), 15);
  h.object(p, 56498); assert.equal(h.quest.getStage(p), 16);
  p.items.set(I.BONES, 1);
  for (const fn of h.hooks.onItemOnNpc) fn({ player: p, npcId: 14236, itemId: I.BONES, handled: false });
  assert.equal(h.quest.getStage(p), 17);
  h.object(p, 56513); assert.equal(h.quest.getStage(p), 18);
  assert.ok(h.objects.some(object => object.id === 56514), 'door becomes the captured open loc');
  h.object(p, 52630); assert.equal(h.quest.getStage(p), 19);
  p.items.set(I.COIN_PURSE, 1);
  for (const fn of h.hooks.onItemAction) fn({ player: p, itemId: I.COIN_PURSE, option: 'Open', handled: false });
  assert.equal(h.quest.getStage(p), 20);
  p.items.set(I.EMPTY_COIN_PURSE, 1);
  for (const fn of h.hooks.onItemOnObject) fn({ player: p, objectId: 56472, itemId: I.EMPTY_COIN_PURSE, handled: false });
  assert.equal(h.quest.getStage(p), 21);
  p.items.set(I.KNIFE, 1);
  for (const fn of h.hooks.onItemOnObject) fn({ player: p, objectId: 56470, itemId: I.KNIFE, handled: false });
  assert.equal(h.quest.getStage(p), 22);
});


test('Shadows of Custodia den entry plays the captured fade and rockslide locs', () => {
  const h = harness('ShadowsOfCustodia'), p = player();
  h.quest.setStage(p, 10);
  const event = { player: p, objectId: 56439, clickType: 2, definition: { getInteractions: () => ['', 'Enter'] } };
  for (const fn of h.hooks.onObjectInteraction) fn(event);
  h.tick(4);
  assert.ok(p.camera.some(packet => packet[0] === 'sub'));
  assert.ok(h.objects.some(object => [57642, 57643, 57645, 11426].includes(object.getId?.() ?? object.id)));
  assert.equal(h.quest.getStage(p), 12);
});

test('The Final Dawn safehouse dog accepts the real alert content id 14237', () => {
  const base = NpcDefinition.forId(14236), alert = NpcDefinition.forId(14237);
  assert.equal(base.getId(), 14236);
  assert.equal(alert.getId(), 14237);
  assert.ok([null, 'null'].includes(CacheDefinitions.getNpc(14236).name), 'base cache entry is the unnamed parent');
  assert.equal(CacheDefinitions.getNpc(14237).name, 'Dog', 'alert is the real cache-backed child');

  for (const npcId of [14236, 14237]) {
    const h = harness('TheFinalDawn'), p = player();
    h.quest.setStage(p, 16);
    p.items.set(I.BONES, 1);
    const event = { player: p, npcId, itemId: I.BONES, handled: false };
    for (const fn of h.hooks.onItemOnNpc) fn(event);
    if (npcId === 14236) {
      assert.equal(h.quest.getStage(p), 17, 'base id still calms the dog');
      assert.equal(p.items.get(I.BONES) ?? 0, 0);
    } else {
      assert.equal(h.quest.getStage(p), 17, 'alert content id calms the dog');
      assert.equal(p.items.get(I.BONES) ?? 0, 0);
    }
  }
});

test('The Final Dawn top stair claims through real Ladders/LocTeleports', () => {
  RegionManager.init();
  RegionManager.loadMapFiles(1647, 3091, true);
  const middle = MapObjects.get(52631, new core.Location(1647, 3091, 1), null);
  assert.ok(middle, 'real middle staircase exists');
  const h = harness('TheFinalDawn'), p = player();
  require('../plugins/world/LocTeleports.plugin').register(h.api);
  require('../plugins/objects/Ladders.plugin').register(h.api);
  p.moveTo(new core.Location(1646, 3091, 1));
  const event = clickType => ({ player: p, objectId: 52631, clickType, object: middle,
    definition: { getName: () => 'Staircase' }, handled: false });
  h.namedObjects.get('Staircase')['Climb-up'](event(2));
  h.tick(4);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1649, 3091, 2]);
  p.moveTo(new core.Location(1646, 3091, 1));
  h.namedObjects.get('Staircase')['Climb-down'](event(3));
  h.tick(4);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1646, 3091, 0]);
});

test('The Final Dawn Teumo house squeeze door enters and exits through captured sides', () => {
  RegionManager.init();
  RegionManager.loadMapFiles(1464, 9569, true);
  const door = MapObjects.get(56475, new core.Location(1464, 9569, 1), null);
  assert.ok(door, 'real vmq4_teumo_house_door exists on the map');
  const h = harness('TheFinalDawn'), p = player();
  const LocTeleports = require('../plugins/world/LocTeleports.plugin');
  LocTeleports.register(h.api);
  h.quest.setStage(p, 29);

  p.moveTo(new core.Location(1463, 9569, 1));
  assert.equal(LocTeleports._test.play(p, door, 1), true, 'outside Squeeze-through is handled');
  h.tick(6);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1465, 9569, 1],
    'captured inward landing inside Teumo house');
  assert.equal(h.quest.getStage(p), 29, 'entering the house does not advance the quest');

  p.moveTo(new core.Location(1465, 9570, 1));
  assert.equal(LocTeleports._test.play(p, door, 1), true, 'inside Squeeze-through is handled');
  h.tick(6);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1463, 9570, 1],
    'captured outward landing outside Teumo house');
  assert.equal(h.quest.getStage(p), 29, 'exiting the house does not advance the quest');
});

test('The Final Dawn safehouse door is owner-scoped and clears both stair routes', () => {
  RegionManager.init();
  RegionManager.loadMapFiles(1649, 3093, true);
  const globalClosed = RegionManager.getClipping(1649, 3093, 0, null);
  const globalOpenTile = RegionManager.getClipping(1648, 3093, 0, null);
  assert.ok(MapObjects.get(56513, new core.Location(1649, 3093, 0), null),
    'global safehouse door stays closed');
  assert.notEqual(globalClosed, 0, 'other players still have the closed-door clip');

  const h = harness('TheFinalDawn'), p = player();
  h.api.core.ObjectManager.deregister = core.ObjectManager.deregister.bind(core.ObjectManager);
  p.moveTo(new core.Location(1650, 3094, 0));
  h.quest.setStage(p, 16);
  h.hooks.onPlayerLogin[0]({ player: p });
  p.items.set(I.BONES, 1);
  for (const fn of h.hooks.onItemOnNpc) fn({ player: p, npcId: 14237, itemId: I.BONES, handled: false });
  assert.equal(h.quest.getStage(p), 17);
  h.object(p, 56513);
  assert.equal(h.quest.getStage(p), 18);
  assert.ok(p.clientRemovals.some(object => object.getId() === 56513), 'owner receives closed-door removal');
  assert.ok(h.objects.some(object => object.id === 56514), 'owner open loc registered');
  assert.ok(p.clientSpawns.some(object => object.getId() === 56514), 'owner receives open-door addition');
  const area = p.getArea();
  assert.ok(area, 'owner private door area entered');
  assert.ok(core.World.getRemovedObjects().some(object => object.getId() === 56513 && object.getPrivateArea() === area),
    'private closed-door removal persists across client scene rebuilds');
  assert.ok(area.hasClip(new core.Location(1649, 3093, 0)), 'only the door clip is copied');
  assert.ok(area.getNpcs().some(npc => npc.id === 14236 || npc.id === 14238), 'tracked dog attached');
  assert.ok(area.getNpcs().some(npc => npc.id === 14301 || npc.id === 14302 || npc.id === 14303), 'tracked Vibia attached');
  assert.equal(RegionManager.getClipping(1649, 3093, 0, null), globalClosed, 'global 1649 clip unchanged');
  assert.equal(RegionManager.getClipping(1648, 3093, 0, null), globalOpenTile, 'global 1648 clip unchanged');

  const route = new RsmodRouteFinding((x, y, z, privateArea) => RegionManager.getClipping(x, y, z, privateArea));
  const path = (srcX, srcY, destX, destY) => route.findRoute({
    level: 0, srcX, srcY, srcSize: 1, destX, destY, destWidth: 1, destLength: 1,
    locShape: -1, privateArea: area, moveNear: false,
  }).success;
  assert.equal(path(1650, 3094, 1646, 3091), true, 'owner east room to stairs');
  assert.equal(path(1646, 3091, 1650, 3094), true, 'owner stairs back to east room');
  assert.ok(MapObjects.get(56507, new core.Location(1647, 3096, 0), null),
    'unrelated closed safehouse door stays unchanged');
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
  assert.equal(p.getArea(), null, 'logout clears the owner door area');
  p.moveTo(new core.Location(3210, 3220, 0));
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.getArea(), null, 'far-away login does not open the house area');
  p.moveTo(new core.Location(1651, 3094, 0));
  for (const fn of h.hooks.onZoneEnter ?? []) fn({ player: p });
  assert.ok(p.getArea()?.getNpcs().length > 0, 'zone re-entry restores owner door state + tracked NPCs');
  h.quest.setStage(p, 22);
  h.namedNpcs.get('Captain Vibia')['Talk-to']({ player: p, npcId: 14303 });
  h.tick(3);
  assert.ok(h.npcs.some(npc => npc.id === 14241 && !npc.removed), 'trap actor starts');
  assert.ok(p.getArea()?.entities.some(npc => npc.id === 14241 && npc.getPrivateArea() === p.getArea()), 'trap bounds include Janus actor');
  assert.ok(p.getArea()?.entities.some(npc => npc.id === 14303 && npc.getPrivateArea() === p.getArea()),
    'trap bounds re-attach Vibia after the door scene detached her');
  assert.ok(p.getArea()?.entities.some(npc => npc.id === 14236 || npc.id === 14238), 'trap bounds include the dog');
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
});

test('The Final Dawn stage-22 Vibia plays the sack and blackjack branches in one conversation', () => {
  const h = harness('TheFinalDawn'), p = player();
  p.getLocalNpcs = () => [...h.npcs, ...(p.getArea()?.entities ?? [])];
  h.quest.setStage(p, 22);
  p.items.set(I.EMPTY_SACK, 1);
  p.items.set(I.MAKESHIFT_BLACKJACK, 1);
  h.login(p);
  assert.ok(h.npcs.some(npc => npc.id === 14303 && !npc.removed), 'login restores Vibia');

  h.namedNpcs.get('Captain Vibia')['Talk-to']({ player: p, npcId: 14303 });
  h.tick(3);
  const area = p.getArea();
  assert.ok(area?.entities.some(npc => npc.id === 14303), 'Vibia is present for the trap conversation');
  assert.ok(area?.entities.some(npc => npc.id === 14241), 'Janus is present for the trap conversation');

  advanceTranscript(h, p, () => h.quest.getStage(p) === 22);
  assert.equal(h.quest.getStage(p), 23, 'the real XR0VTA action captures Janus');
  assert.ok(p.messages.includes('You give the sack to Captain Vibia.'), 'sack condition played');
  assert.ok(p.messages.includes('You show the makeshift blackjack to Captain Vibia.'),
    'blackjack condition continues after the sack condition');
  assert.equal(p.items.get(I.EMPTY_SACK) ?? 0, 0, 'the given sack leaves the inventory');
  assert.equal(p.getArea(), null, 'the trap scene ends after capture');
  assert.ok(!area.entities.some(npc => npc.id === 14241 && !npc.removed), 'Janus scene actor is cleaned up');
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
});

test('The Final Dawn stage-22 Vibia accepts a blackjack once the sack was already given', () => {
  const h = harness('TheFinalDawn'), p = player();
  p.getLocalNpcs = () => [...h.npcs, ...(p.getArea()?.entities ?? [])];
  h.quest.setStage(p, 22);
  p.attrs.set('quest.the_final_dawn.bits', 1 << 1); // BIT_SACK_GIVEN
  p.items.set(I.MAKESHIFT_BLACKJACK, 1);
  h.login(p);
  h.namedNpcs.get('Captain Vibia')['Talk-to']({ player: p, npcId: 14303 });
  h.tick(3);

  advanceTranscript(h, p, () => h.quest.getStage(p) === 22);
  assert.equal(h.quest.getStage(p), 23, 'already-given sack plus blackjack reaches XR0VTA');
  assert.ok(!p.messages.includes('You give the sack to Captain Vibia.'), 'the sack is not given twice');
  assert.ok(p.messages.includes('You show the makeshift blackjack to Captain Vibia.'));
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
});

test('The Final Dawn stage-22 blackjack without a sack or a given sack stays at 22', () => {
  const h = harness('TheFinalDawn'), p = player();
  const lines = [];
  (h.events['npc-dialogue:line'] ??= []).push(event => lines.push(String(event.text)));
  h.quest.setStage(p, 22);
  p.items.set(I.MAKESHIFT_BLACKJACK, 1);
  h.namedNpcs.get('Captain Vibia')['Talk-to']({ player: p, npcId: 14303 });
  h.tick(3);

  advanceTranscript(h, p, () => true);
  assert.equal(h.quest.getStage(p), 22, 'Janus is not captured without a sack');
  assert.ok(!p.messages.includes('You show the makeshift blackjack to Captain Vibia.'),
    'the blackjack branch waits for the sack');
  assert.ok(lines.some(line => line.startsWith(
    "We need to prepare for the return of this Forebearer Janus. We'll need a way to restrain him")),
    'Vibia gives the canonical request/recovery line');
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
});

test('The Final Dawn stage23 reopens the owner door, reaches Janus and starts interrogation', () => {
  RegionManager.init();
  RegionManager.loadMapFiles(1649, 3093, true);
  const h = harness('TheFinalDawn'), p = player();
  p.getLocalNpcs = () => [...h.npcs, ...(p.getArea()?.entities ?? [])];
  h.quest.setStage(p, 22);
  p.attrs.set('quest.the_final_dawn.bits', 1 << 1); // BIT_SACK_GIVEN
  p.items.set(I.MAKESHIFT_BLACKJACK, 1);
  p.moveTo(new core.Location(1650, 3093, 0));
  h.login(p);
  h.namedNpcs.get('Captain Vibia')['Talk-to']({ player: p, npcId: 14303 });
  h.tick(3);
  advanceTranscript(h, p, () => h.quest.getStage(p) === 22);
  assert.equal(h.quest.getStage(p), 23);

  const area = p.getArea();
  assert.ok(area, 'stage23 restores the owner private house area');
  assert.ok(h.objects.some(object => object.id === 56514 && object.getLocation?.().getX() === 1648 && object.getLocation?.().getY() === 3093),
    'captured open door 56514 is registered at 1648,3093');
  assert.ok(p.clientRemovals.some(object => object.getId() === 56513), 'closed door 56513 is hidden for the owner');
  const janus = h.npcs.find(npc => npc.id === 14243 && !npc.removed);
  assert.ok(janus, 'unconscious Janus is spawned');
  assert.deepEqual([janus.getLocation().getX(), janus.getLocation().getY(), janus.getLocation().getZ()], [1647, 3093, 0],
    'Janus uses the captured tile, not the old closed-door tile');
  assert.ok(area.entities.some(npc => npc.id === 14243 && npc.getPrivateArea() === area), 'Janus is attached to the owner area');
  assert.ok(area.entities.some(npc => npc.id === 14303), 'Vibia is attached to the owner area');
  assert.ok(area.entities.some(npc => npc.id === 14236 || npc.id === 14238), 'dog is attached to the owner area');

  const route = new RsmodRouteFinding((x, y, z, privateArea) => RegionManager.getClipping(x, y, z, privateArea));
  assert.equal(route.findRoute({
    level: 0, srcX: 1650, srcY: 3093, srcSize: 1, destX: 1647, destY: 3093,
    destWidth: 1, destLength: 1, locShape: -1, privateArea: area, moveNear: false,
  }).success, true, 'normal walking route reaches Janus through the open door');

  h.namedNpcs.get('Forebearer Janus').Search({ player: p, npcId: 14243 });
  assert.equal(h.quest.getStage(p), 24, 'Search starts the basement-key stage');
  h.advanceToPrompt(p, 400);
  h.tick(3);
  assert.equal(h.quest.getStage(p), 25, 'the real ZWqy3O action advances to the Queen reveal');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1650, 9493, 0],
    'player lands on the captured basement tile');
  const basement = p.getArea();
  for (const id of [14307, 14245, 14290, 14368, 14367, 14371, 14299]) {
    assert.ok(basement?.entities.some(npc => npc.id === id), `interrogation actor ${id} attached`);
  }
  assert.ok(p.prompt?.options.includes("Yes, let's go."), 'the travel choice is reachable from the real transcript');
  h.choose(p, "Yes, let's go.");
  for (let step = 0; step < 20 && h.quest.getStage(p) === 25; step++) {
    if (p.manager.getCurrent()) p.manager.advance();
    h.tick(1);
  }
  assert.equal(h.quest.getStage(p), 27, 'real Yes/U0zok7 reaches the Cam Torum travel stage');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1440, 9560, 1],
    'real U0zok7 lands at the captured Cam Torum tile');
  assert.equal(p.getArea(), null, 'interrogation scene is cleaned on U0zok7');
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
});

test('The Final Dawn interrogation decline restores movement and stage25 login resumes the choice', () => {
  RegionManager.init();
  RegionManager.loadMapFiles(1649, 3093, true);
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 23);
  p.attrs.set('quest.the_final_dawn.bits', (1 << 1) | (1 << 2)); // sack given + Janus captured
  p.moveTo(new core.Location(1650, 3093, 0));
  h.hooks.onPlayerLogin[0]({ player: p });
  h.namedNpcs.get('Forebearer Janus').Search({ player: p, npcId: 14243 });
  h.advanceToPrompt(p, 400);
  h.choose(p, "I'll make my own way there.");
  for (let step = 0; step < 200 && p.manager.getCurrent(); step++) p.manager.advance();
  h.tick(4);

  assert.equal(h.quest.getStage(p), 25, 'declining does not advance the stage');
  assert.equal(p.blocked, false, 'declining restores normal movement');
  assert.ok(p.getArea()?.entities.some(npc => npc.id === 14290), 'usable Queen remains in the scene');
  const keyCount = [...p.items.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(CacheDefinitions.getNpc(14290).actions.includes('Talk-to'), 'Queen retry actor has a real Talk-to action');
  h.namedNpcs.get('Queen Zyanyi Arkan')['Talk-to']({ player: p, npcId: 14290 });
  assert.equal(h.quest.getStage(p), 25, 'Queen retry keeps stage25 until a real Yes');
  h.advanceToPrompt(p, 200);
  assert.ok(p.prompt?.options.includes("Yes, let's go."), 'Queen retry reaches the canonical travel choice');
  h.choose(p, "I'll make my own way there.");
  for (let step = 0; step < 200 && p.manager.getCurrent(); step++) p.manager.advance();

  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
  assert.equal(p.getArea(), null, 'logout cleans the interrogation scene');
  h.hooks.onPlayerLogin[0]({ player: p });
  h.tick(3);
  assert.equal(h.quest.getStage(p), 25, 'stage25 login does not auto-progress');
  assert.equal(p.getArea()?.entities.some(npc => npc.id === 14290), true, 'stage25 login restores the Queen scene');
  assert.equal([...p.items.values()].reduce((sum, value) => sum + value, 0), keyCount, 'login grants no items');
  h.advanceToPrompt(p, 400);
  assert.ok(p.prompt?.options.includes("Yes, let's go."), 'resumed continuation still reaches the real choice');
  h.choose(p, "Yes, let's go.");
  for (let step = 0; step < 20 && h.quest.getStage(p) === 25; step++) {
    if (p.manager.getCurrent()) p.manager.advance();
    h.tick(1);
  }
  assert.equal(h.quest.getStage(p), 27, 'real Yes after login reaches Cam Torum');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1440, 9560, 1]);
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
});

test('The Final Dawn stage23 login restores the open owner door and captured NPCs without grants', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 23);
  p.attrs.set('quest.the_final_dawn.bits', (1 << 1) | (1 << 2)); // sack given + Janus captured
  p.moveTo(new core.Location(1650, 3093, 0));
  p.items.set(I.MAKESHIFT_BLACKJACK, 1);
  h.hooks.onPlayerLogin[0]({ player: p });
  h.hooks.onPlayerLogin[0]({ player: p });

  assert.equal(h.quest.getStage(p), 23, 'login does not duplicate or advance the stage');
  assert.equal(p.items.get(I.MAKESHIFT_BLACKJACK), 1, 'login grants no quest items');
  const area = p.getArea();
  assert.ok(area, 'login restores the owner private house area');
  assert.ok(h.objects.some(object => object.id === 56514), 'login restores open door 56514');
  assert.ok(area.entities.some(npc => npc.id === 14243 && npc.getLocation?.().getX() === 1647 && npc.getLocation?.().getY() === 3093),
    'login restores unconscious Janus on the captured tile');
  assert.ok(area.entities.some(npc => npc.id === 14303), 'login restores Vibia in the house');
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
});

test('The Final Dawn Teumo basement registers captured barrels, rejects wrong drinks and restores on login', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.api.core.ObjectManager.deregister = object => { object.removed = true; };
  p.moveTo(new core.Location(1466, 9572, 0));
  h.quest.setStage(p, 31);
  h.hooks.onPlayerLogin[0]({ player: p });
  const expected = [
    [56490, 1469, 9571, 3], [56491, 1466, 9573, 1], [56492, 1464, 9568, 2],
    [56493, 1466, 9568, 3], [56494, 1471, 9567, 2],
  ];
  for (const [id, x, y, face] of expected) {
    const object = h.objects.find(entry => entry.id === id);
    assert.ok(object, `captured barrel ${id} registered`);
    assert.equal(object.getOwner(), p, `barrel ${id} is owner-scoped`);
    assert.deepEqual([object.getLocation().getX(), object.getLocation().getY(), object.getLocation().getZ()], [x, y, 0]);
    assert.equal(object.getFace(), face);
  }

  const litFire = h.objects.find(object => object.id === 56497 && object.getOwner() === p);
  assert.ok(litFire, 'captured lit fireplace 56497 is registered at stage31');
  assert.deepEqual([litFire.getLocation().getX(), litFire.getLocation().getY(), litFire.getLocation().getZ()], [1463, 9571, 0]);
  assert.ok(!h.objects.some(object => object.id === 56496 && object.getOwner() === p && !object.removed),
    'out fireplace is not shown before the drinks are placed');

  p.items.set(I.BEER, 1);
  for (const fn of h.hooks.onItemOnObject) fn({ player: p, objectId: 56490, itemId: I.BEER, handled: false });
  assert.equal(p.items.get(I.BEER), 1, 'wrong drink is not consumed');
  assert.equal(p.attrs.get('quest.the_final_dawn.barrels') ?? 0, 0, 'wrong drink does not count');

  for (const [objectId, itemId] of [[56491, I.BEER], [56492, I.STEAMFORGE_BREW], [56493, I.DWARVEN_STOUT], [56494, I.WIZARDS_MIND_BOMB], [56490, I.BEER_GLASS]]) {
    p.items.set(itemId, 1);
    for (const fn of h.hooks.onItemOnObject) fn({ player: p, objectId, itemId, handled: false });
  }
  assert.equal(p.attrs.get('quest.the_final_dawn.barrels'), 5);
  assert.equal(h.quest.getStage(p), 32);
  assert.ok(h.objects.some(object => object.id === 56496 && object.getOwner() === p && !object.removed),
    'solved puzzle swaps in the captured out fireplace 56496');
  assert.equal(litFire.removed, true, 'lit fireplace is removed after the puzzle');

  const p2 = player();
  p2.moveTo(new core.Location(1466, 9572, 0));
  h.quest.setStage(p2, 31);
  h.hooks.onPlayerLogin[0]({ player: p2 });
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p2 });
  h.hooks.onPlayerLogin[0]({ player: p2 });
  for (const [id] of expected) {
    const live = h.objects.filter(object => object.id === id && object.getOwner() === p2 && !object.removed);
    assert.equal(live.length, 1, `login restores exactly one barrel ${id}`);
    assert.equal(live[0].getOwner(), p2);
  }
  assert.ok(h.objects.some(object => object.id === 56497 && object.getOwner() === p2 && !object.removed),
    'login restores the stage31 lit fireplace');
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p2 });
});

test('The Final Dawn Teumo barrels restore on normal basement re-entry after an outside login', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.api.core.ObjectManager.deregister = object => { object.removed = true; };
  p.moveTo(new core.Location(1466, 9572, 0));
  h.quest.setStage(p, 31);
  h.hooks.onPlayerLogin[0]({ player: p });
  for (const id of [56490, 56491, 56492, 56493, 56494, 56497]) {
    assert.equal(h.objects.filter(object => object.id === id && object.getOwner() === p && !object.removed).length, 1);
  }

  for (const fn of h.hooks.onZoneExit ?? []) fn({ player: p });
  for (const id of [56490, 56491, 56492, 56493, 56494, 56497]) {
    assert.equal(h.objects.filter(object => object.id === id && object.getOwner() === p && !object.removed).length, 0,
      `leaving the basement clears ${id}`);
  }

  p.moveTo(new core.Location(1466, 9571, 1));
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
  p.moveTo(new core.Location(1466, 9571, 1));
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(h.quest.getStage(p), 31, 'outside login does not advance the stage');
  for (const id of [56490, 56491, 56492, 56493, 56494, 56497]) {
    assert.equal(h.objects.filter(object => object.id === id && object.getOwner() === p && !object.removed).length, 0,
      `outside login does not restore ${id}`);
  }

  p.moveTo(new core.Location(1466, 9572, 0));
  for (const fn of h.hooks.onZoneEnter ?? []) fn({ player: p });
  assert.equal(h.quest.getStage(p), 31, 're-entry does not advance the stage');
  for (const id of [56490, 56491, 56492, 56493, 56494, 56497]) {
    assert.equal(h.objects.filter(object => object.id === id && object.getOwner() === p && !object.removed).length, 1,
      `normal re-entry restores exactly one ${id}`);
  }
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
});

test('The Final Dawn registers the captured z2 plant/pot owner-scoped', () => {
  const plantDef = CacheDefinitions.getObject(56470), potDef = CacheDefinitions.getObject(56472);
  assert.ok(plantDef && potDef, 'real cache definitions load');
  RegionManager.init();
  RegionManager.loadMapFiles(1650, 3095, true);
  assert.equal(MapObjects.get(56470, new core.Location(1650, 3095, 2), null), null,
    'plant is not a global z2 map object');
  assert.equal(MapObjects.get(56472, new core.Location(1645, 3098, 2), null), null,
    'pot is not a global z2 map object');
  assert.equal(MapObjects.get(56470, new core.Location(1650, 3095, 1), null), null,
    'other plane remains unchanged');

  const h = harness('TheFinalDawn'), p = player();
  p.moveTo(new core.Location(1646, 3092, 2));
  h.quest.setStage(p, 20);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.ok(h.objects.some(object => object.id === 56470), 'owner plant registered');
  assert.ok(h.objects.some(object => object.id === 56472), 'owner pot registered');

  p.items.set(I.EMPTY_COIN_PURSE, 1);
  for (const fn of h.hooks.onItemOnObject) fn({ player: p, objectId: 56472, itemId: I.EMPTY_COIN_PURSE, handled: false });
  assert.equal(h.quest.getStage(p), 21);
  p.items.set(I.KNIFE, 1);
  for (const fn of h.hooks.onItemOnObject) fn({ player: p, objectId: 56470, itemId: I.KNIFE, handled: false });
  assert.equal(h.quest.getStage(p), 22);
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
});

test('The Final Dawn safehouse stairs advance 18 to 19 on the normal Ladders click', () => {
  RegionManager.init();
  RegionManager.loadMapFiles(1647, 3091, true);
  const bottom = MapObjects.get(52630, new core.Location(1647, 3091, 0), null);
  assert.ok(bottom, 'real bottom staircase exists');
  const locs = require('../plugins/world/data/loc-teleports.json').locs;
  const top = locs.find(entry => entry.id === 52631 && entry.z === 1 && entry.op === 2);
  const down = locs.find(entry => entry.id === 52631 && entry.z === 1 && entry.op === 3);
  assert.deepEqual(top?.to, [1649, 3091, 2], 'captured top landing');
  assert.deepEqual(down?.to, [1646, 3091, 0], 'captured middle descent');
  const h = harness('TheFinalDawn'), p = player();
  require('../plugins/objects/Ladders.plugin').register(h.api);
  p.moveTo(new core.Location(1646, 3091, 0));
  h.quest.setStage(p, 18);
  const click = { player: p, objectId: 52630, clickType: 1, object: bottom,
    definition: { getName: () => 'Staircase' }, location: bottom.getLocation(), sourceLocation: p.getLocation(), handled: false };
  h.namedObjects.get('Staircase')['Climb-up'](click);
  h.tick(3);
  assert.equal(h.quest.getStage(p), 19);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1646, 3091, 1]);
  h.namedObjects.get('Staircase')['Climb-up']({ ...click, handled: false });
  h.tick(2);
  assert.equal(h.quest.getStage(p), 19, 'repeat click does not advance past 19');

  const h2 = harness('TheFinalDawn'), p2 = player();
  require('../plugins/objects/Ladders.plugin').register(h2.api);
  h2.quest.setStage(p2, 20);
  h2.namedObjects.get('Staircase')['Climb-up']({ player: p2, objectId: 52630, clickType: 1,
    object: bottom, definition: { getName: () => 'Staircase' }, handled: false });
  h2.tick(2);
  assert.equal(h2.quest.getStage(p2), 20, 'other stages do not regress');
  h2.quest.setStage(p2, 18);
  h2.api.emitCustomEvent('ladders:climb', { player: p2, objectId: 52630, handled: false,
    object: { getLocation: () => new core.Location(1647, 3100, 0) } });
  assert.equal(h2.quest.getStage(p2), 18, 'the same staircase model elsewhere does not advance the quest');
});

test('The Final Dawn basement, archive and safe-house hooks emit captured camera/fade beats and clean actors', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 5);
  h.action(p, 13706, '1cZjnd');
  assert.ok(p.camera.some(packet => packet[0] === 'move' && packet[1] === 1705));

  h.quest.setStage(p, 22);
  p.attrs.set('quest.the_final_dawn.last', 0);
  p.manager.reset();
  h.namedNpcs.get('Captain Vibia')['Talk-to']({ player: p, npcId: 14303 });
  h.tick(3);
  assert.ok(p.camera.some(packet => packet[0] === 'move' && packet[1] === 1648));
  assert.ok(h.npcs.some(npc => npc.id === 14241 && !npc.removed));
  h.action(p, 14303, 'XR0VTA');
  assert.ok(p.camera.some(packet => packet[0] === 'reset'));
  assert.equal(h.quest.getStage(p), 23);
});

test('The Final Dawn crypt uses six captured waves before Ennius', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 46);
  const event = { player: p, objectId: 56636, clickType: 1, definition: { getInteractions: () => ['Enter'] } };
  for (const fn of h.hooks.onObjectInteraction) fn(event);
  assert.equal(h.quest.getStage(p), 47);
  const sceneArea = p.getArea();
  assert.ok(sceneArea && h.npcs.some(npc => [14401, 14407].includes(npc.id) && sceneArea.entities.includes(npc)),
    'cultists attach to the crypt private area');
  for (let wave = 1; wave <= 5; wave++) {
    const alive = h.npcs.filter(npc => !npc.removed && [14401, 14407].includes(npc.id));
    assert.ok(alive.length > 1);
    for (const npc of alive) { npc.removed = true; h.hooks.onNpcDeath[0]({ npc, npcId: npc.id, player: p }); }
    assert.equal(p.attrs.get('the-final-dawn:wave'), wave + 1);
  }
  const alive = h.npcs.filter(npc => !npc.removed && [14401, 14407].includes(npc.id));
  for (const npc of alive) { npc.removed = true; h.hooks.onNpcDeath[0]({ npc, npcId: npc.id, player: p }); }
  assert.equal(h.quest.getStage(p), 50);
  h.action(p, 14293, 'QwN4C2');
  assert.equal(h.quest.getStage(p), 51);
  const ennius = h.npcs.find(npc => npc.id === 14331 && !npc.removed);
  assert.ok(ennius && p.getArea().entities.includes(ennius), 'Ennius attaches to the crypt private area');
});

test('The Final Dawn fragment Touch uses the captured inventory action', () => {
  assert.equal(CacheDefinitions.getItem(30961).inventoryActions[0], 'Touch');
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 40);
  p.items.set(I.KEYSTONE_FRAGMENT, 1);
  p.moveTo(new core.Location(1511, 9702, 0));
  for (const fn of h.hooks.onItemAction) fn({ player: p, itemId: I.KEYSTONE_FRAGMENT, option: 'Touch', handled: false });
  assert.equal(p.varbits.get(16671), 1);
  assert.equal(h.quest.getStage(p), 40);
});

test('The Final Dawn Teumo basement spawns captured Attala/Servius and the real report reaches Neypotzli', () => {
  const h = harness('TheFinalDawn'), p = player();
  p.moveTo(new core.Location(1466, 9572, 0));
  h.quest.setStage(p, 35);
  h.hooks.onPlayerLogin[0]({ player: p });

  const attala = h.npcs.find(npc => npc.id === 14338 && !npc.removed);
  const servius = h.npcs.find(npc => npc.id === 14311 && !npc.removed);
  assert.ok(attala && servius, 'captured basement Attala and Servius spawn');
  assert.equal(attala.getOwner(), p);
  assert.equal(servius.getOwner(), p);
  assert.deepEqual([attala.getLocation().getX(), attala.getLocation().getY(), attala.getLocation().getZ()], [1466, 9571, 0]);
  assert.deepEqual([servius.getLocation().getX(), servius.getLocation().getY(), servius.getLocation().getZ()], [1467, 9570, 0]);

  const vars = { getVarbit: id => (id === 16663 ? 35 : 0), getVarp: () => 0 };
  const attalaDef = CacheDefinitions.resolveNpc(14338, vars);
  const serviusDef = CacheDefinitions.resolveNpc(14311, vars);
  assert.equal(attalaDef?.name, 'Attala');
  assert.ok(attalaDef?.actions?.includes('Talk-to'), '14338 resolves to Talk-to Attala at stage35');
  assert.equal(serviusDef?.name, 'Servius, Teokan of Ralos');
  assert.ok(serviusDef?.actions?.includes('Talk-to'), '14311 resolves to Talk-to Servius at stage35');

  h.namedNpcs.get('Attala')['Talk-to']({ player: p, npcId: 14338 });
  for (let step = 0; step < 300 && p.manager.getCurrent() && h.quest.getStage(p) < 37; step++) p.manager.advance();
  assert.equal(h.quest.getStage(p), 37, 'real report dialogue advances 35 -> 36 -> 37');
});

test('The Final Dawn Eyatlalli spawns at Neypotzli and real Talk-to gives the fragment', () => {
  const h = harness('TheFinalDawn'), p = player();
  p.moveTo(new core.Location(1440, 9616, 1));
  h.quest.setStage(p, 37);
  h.hooks.onPlayerLogin[0]({ player: p });

  const eyatlalli = h.npcs.find(npc => npc.id === 14354 && !npc.removed);
  assert.ok(eyatlalli, 'raw Eyatlalli 14354 spawns');
  assert.equal(eyatlalli.getOwner(), p);
  assert.deepEqual([eyatlalli.getLocation().getX(), eyatlalli.getLocation().getY(), eyatlalli.getLocation().getZ()], [1439, 9627, 1]);
  const vars = { getVarbit: id => (id === 16663 ? 37 : 0), getVarp: () => 0 };
  const definition = CacheDefinitions.resolveNpc(14354, vars);
  assert.equal(definition?.id, 14355);
  assert.equal(definition?.name, 'Eyatlalli');
  assert.ok(definition?.actions?.includes('Talk-to'), '14354 resolves to Talk-to Eyatlalli at stage37');

  h.namedNpcs.get('Eyatlalli')['Talk-to']({ player: p, npcId: 14354 });
  assert.equal(h.quest.getStage(p), 38, 'first Eyatlalli talk sets stage38');
  for (let step = 0; step < 400 && p.manager.getCurrent() && h.quest.getStage(p) < 39; step++) p.manager.advance();
  assert.equal(h.quest.getStage(p), 39, 'the real transcript gives the fragment and reaches stage39');
  assert.equal(p.items.get(I.KEYSTONE_FRAGMENT), 1);
});

test('Final Dawn full inventory leaves the fragment handoff retryable, then gives on retry', () => {
  const h = harness('TheFinalDawn'), p = player();
  const inv = new Inventory(p);
  p.getInventory = () => inv;
  for (let i = 0; i < 28; i++) inv.adds(1000 + i, 1);
  assert.equal(inv.getFreeSlots(), 0);
  h.quest.setStage(p, 38);

  h.namedNpcs.get('Eyatlalli')['Talk-to']({ player: p, npcId: 14354 });
  for (let step = 0; step < 400 && p.manager.getCurrent(); step++) p.manager.advance();
  assert.equal(h.quest.getStage(p), 38);
  assert.equal(inv.getAmount(I.KEYSTONE_FRAGMENT), 0);

  inv.deleteNumber(1000, 1);
  h.namedNpcs.get('Eyatlalli')['Talk-to']({ player: p, npcId: 14354 });
  for (let step = 0; step < 400 && p.manager.getCurrent() && h.quest.getStage(p) < 39; step++) p.manager.advance();
  assert.equal(h.quest.getStage(p), 39);
  assert.equal(inv.getAmount(I.KEYSTONE_FRAGMENT), 1);
});

test('Final Dawn destroyed fragment at first Locate is reissued without losing stage 40', () => {
  assert.ok(CacheDefinitions.getItem(30961).inventoryActions.includes('Destroy'));
  const h = harness('TheFinalDawn'), p = player();
  const inv = new Inventory(p);
  p.getInventory = () => inv;
  h.quest.setStage(p, 40);

  h.namedNpcs.get('Eyatlalli')['Talk-to']({ player: p, npcId: 14354 });
  for (let step = 0; step < 400 && p.manager.getCurrent() && inv.getAmount(I.KEYSTONE_FRAGMENT) === 0; step++) p.manager.advance();
  assert.equal(h.quest.getStage(p), 40);
  assert.equal(inv.getAmount(I.KEYSTONE_FRAGMENT), 1);
});

test('The Final Dawn Servius Teumo basement report accepts content id 14311', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 35);
  h.action(p, 14311, 'AxIldc');
  assert.equal(h.quest.getStage(p), 37);
});

test('The Final Dawn claims only its Neypotzli realm transports through Perilous Moons', () => {
  const h = harness(['PerilousMoons', 'TheFinalDawn']);
  const moons = h.quests.find(quest => quest.key === 'perilous_moons');
  assert.ok(moons, 'Perilous Moons registered');
  const perilous = h.hooks.onObjectInteraction[0];
  const dawn = h.hooks.onObjectInteraction[1];
  const click = (player, objectId, x, y, z) => ({
    player, objectId, clickType: 1,
    object: { getId: () => objectId, getLocation: () => new core.Location(x, y, z) },
    definition: { getInteractions: () => ['Pass-through'] },
    location: { x, y, z }, handled: false,
  });

  const p = player();
  moons.setStage(p, 20);
  h.quest.setStage(p, 39);
  const streambound = click(p, 51376, 1458, 9650, 1);
  perilous(streambound);
  assert.equal(streambound.handled, true);
  assert.equal(h.quest.getStage(p), 40, 'actual Moons transport advances Dawn 39 -> 40');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1481, 9669, 0]);

  const p2 = player();
  moons.setStage(p2, 20);
  h.quest.setStage(p2, 31);
  const inactive = click(p2, 51376, 1458, 9650, 1);
  perilous(inactive);
  assert.equal(h.quest.getStage(p2), 31, 'inactive Dawn is unchanged by the same entrance');

  const p3 = player();
  moons.setStage(p3, 20);
  h.quest.setStage(p3, 40);
  p3.attrs.set('the-final-dawn:neypotzli-checkpoint', 1);
  const earthbound = click(p3, 51378, 1521, 9720, 0);
  perilous(earthbound);
  assert.deepEqual([p3.getLocation().getX(), p3.getLocation().getY(), p3.getLocation().getZ()], [1390, 9676, 0],
    'checkpoint1 transport lands on the captured Earthbound tile');
  assert.equal(h.quest.getStage(p3), 40, 'Earthbound keeps stage40');

  const p4 = player();
  h.quest.setStage(p4, 40);
  p4.attrs.set('the-final-dawn:neypotzli-checkpoint', 2);
  const ancient = click(p4, 51377, 1373, 9664, 0);
  dawn(ancient);
  assert.deepEqual([p4.getLocation().getX(), p4.getLocation().getY(), p4.getLocation().getZ()], [1347, 9590, 0],
    'checkpoint2 Dawn handler lands on the captured Ancient Prison tile');
  assert.equal(h.quest.getStage(p4), 40, 'Ancient Prison keeps stage40');
});

test('The Final Dawn twins cutscene lands in the arena, and stage43 symbol re-entry does not duplicate actors', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 41);
  p.moveTo(new core.Location(1375, 9538, 0));
  h.object(p, 56620, 1, { x: 1375, y: 9537, z: 0 });
  for (let step = 0; step < 400 && h.quest.getStage(p) === 41 && p.manager.getCurrent(); step++) {
    p.manager.advance();
  }
  assert.equal(h.quest.getStage(p), 43, 'real twins dialogue action reaches stage43');
  h.tick(8);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1363, 9518, 0],
    'captured twins arena landing');
  assert.equal(p.blocked, false, 'cutscene releases movement after landing');
  assert.ok(CacheDefinitions.getNpc(14362).actions.includes('Attack'), 'Chimalli is cache-attackable');
  assert.ok(CacheDefinitions.getNpc(14363).actions.includes('Attack'), 'Lucius is cache-attackable');
  const twins = () => [14362, 14363].map(id => h.npcs.filter(npc => npc.id === id && npc.getOwner() === p && !npc.removed));
  for (const live of twins()) assert.equal(live.length, 1, 'exactly one owner twin spawned');

  p.moveTo(new core.Location(1375, 9538, 0));
  h.object(p, 56620, 1, { x: 1375, y: 9537, z: 0 });
  h.tick(8);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1363, 9518, 0],
    'stage43 symbol Touch re-enters the arena');
  for (const live of twins()) assert.equal(live.length, 1, 're-entry does not duplicate twins');
  assert.equal(h.quest.getStage(p), 43, 're-entry does not change the stage');

  const h2 = harness('TheFinalDawn'), p2 = player();
  h2.quest.setStage(p2, 43);
  p2.moveTo(new core.Location(1375, 9538, 0));
  h2.hooks.onPlayerLogin[0]({ player: p2 });
  assert.deepEqual([p2.getLocation().getX(), p2.getLocation().getY(), p2.getLocation().getZ()], [1375, 9538, 0],
    'stage43 login outside the arena is not teleported');
  for (const id of [14362, 14363]) {
    assert.equal(h2.npcs.filter(npc => npc.id === id && npc.getOwner() === p2 && !npc.removed).length, 1,
      'login restores one owner twin in the arena');
  }
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
  for (const fn of h2.hooks.onPlayerLogout) fn({ player: p2 });
});

test('The Final Dawn sun room spawns the puzzle-specific Itzla and moves him to recorded altars', () => {
  const h = harness('TheFinalDawn'), p = player();
  p.moveTo(new core.Location(1332, 9453, 1));
  h.quest.setStage(p, 55);
  h.hooks.onPlayerLogin[0]({ player: p });

  const sun = h.npcs.find(npc => npc.id === 14282 && npc.getOwner() === p && !npc.removed);
  const moon = h.npcs.find(npc => npc.id === 14281 && npc.getOwner() === p && !npc.removed);
  assert.ok(sun, 'vmq4_itzla_crypt_puzzle_sun 14282 spawns at stage55');
  assert.ok(moon, 'vmq4_itzla_crypt_puzzle_moon 14281 spawns at stage55');
  assert.deepEqual([sun.getLocation().getX(), sun.getLocation().getY(), sun.getLocation().getZ()], [1327, 9446, 1]);
  assert.deepEqual([moon.getLocation().getX(), moon.getLocation().getY(), moon.getLocation().getZ()], [1298, 9446, 1]);
  assert.ok(!h.npcs.some(npc => npc.id === 14279 && npc.getOwner() === p && !npc.removed),
    'generic crypt Itzla 14279 is not used at stage55');
  const vars = { getVarbit: id => (id === 16663 ? 55 : 0), getVarp: () => 0 };
  assert.ok(CacheDefinitions.resolveNpc(14282, vars)?.actions?.includes('Talk-to'),
    '14282 resolves to a Talk-to sun-puzzle Itzla');

  const advanceToPrompt = () => {
    for (let step = 0; step < 200 && p.manager.getCurrent() && !p.prompt; step++) p.manager.advance();
    assert.ok(p.prompt, 'dialogue reached a prompt');
  };
  const talkAndChooseAltar = direction => {
    h.namedNpcs.get('Prince Itzla Arkan')['Talk-to']({ player: p, npcId: 14282 });
    advanceToPrompt();
    assert.ok(p.prompt.options.includes('Can you go to an altar for me?'), 'normal altar ask option is present');
    h.choose(p, 'Can you go to an altar for me?');
    advanceToPrompt();
    for (let page = 0; page < 4 && !p.prompt.options.includes(direction); page++) {
      assert.ok(p.prompt.options.includes('More...'), 'direction menu has a More page');
      h.choose(p, 'More...');
      advanceToPrompt();
    }
    h.choose(p, direction);
    for (let step = 0; step < 200 && p.manager.getCurrent() && !p.prompt; step++) p.manager.advance();
  };
  talkAndChooseAltar('North.');
  assert.deepEqual([sun.getLocation().getX(), sun.getLocation().getY(), sun.getLocation().getZ()], [1330, 9454, 1],
    'North dialogue choice physically moves the sun-puzzle actor to the QH north stand tile');
  talkAndChooseAltar('East.');
  assert.deepEqual([sun.getLocation().getX(), sun.getLocation().getY(), sun.getLocation().getZ()], [1338, 9446, 1],
    'East dialogue choice moves to the captured east altar tile');
  talkAndChooseAltar('North west.');
  assert.deepEqual([sun.getLocation().getX(), sun.getLocation().getY(), sun.getLocation().getZ()], [1324, 9452, 1],
    'North-west dialogue choice moves to the captured north-west altar tile');
  assert.equal(h.quest.getStage(p), 55, 'movement dialogue does not change stage');

  const pSaved = player();
  pSaved.moveTo(new core.Location(1332, 9453, 1));
  pSaved.attrs.set('the-final-dawn:sun-itzla', 7);
  h.quest.setStage(pSaved, 55);
  h.hooks.onPlayerLogin[0]({ player: pSaved });
  const savedSun = h.npcs.find(npc => npc.id === 14282 && npc.getOwner() === pSaved && !npc.removed);
  assert.deepEqual([savedSun.getLocation().getX(), savedSun.getLocation().getY(), savedSun.getLocation().getZ()], [1330, 9454, 1],
    'login spawns the sun actor on the saved chosen stand tile');

  const h2 = harness('TheFinalDawn'), p2 = player();
  p2.moveTo(new core.Location(1312, 9493, 1));
  h2.quest.setStage(p2, 53);
  h2.hooks.onPlayerLogin[0]({ player: p2 });
  assert.ok(h2.npcs.some(npc => npc.id === 14279 && npc.getOwner() === p2 && !npc.removed),
    'Ennius-stage actor is the generic crypt Itzla 14279');
  h2.quest.setStage(p2, 55);
  h2.hooks.onPlayerLogin[0]({ player: p2 });
  assert.ok(!h2.npcs.some(npc => npc.id === 14279 && npc.getOwner() === p2 && !npc.removed),
    '52->55 replacement removes generic Itzla');
  assert.equal(h2.npcs.filter(npc => npc.id === 14282 && npc.getOwner() === p2 && !npc.removed).length, 1);
  assert.equal(h2.npcs.filter(npc => npc.id === 14281 && npc.getOwner() === p2 && !npc.removed).length, 1);

  h2.quest.setStage(p2, 60);
  h2.hooks.onPlayerLogin[0]({ player: p2 });
  assert.ok(!h2.npcs.some(npc => npc.id === 14282 && npc.getOwner() === p2 && !npc.removed), 'sun actor cleaned at stage60');
  assert.ok(!h2.npcs.some(npc => npc.id === 14281 && npc.getOwner() === p2 && !npc.removed), 'moon actor cleaned at stage60');
  assert.equal(h2.npcs.filter(npc => npc.id === 14279 && npc.getOwner() === p2 && !npc.removed).length, 1,
    'stage60 restores one generic puzzle Itzla 14279');
  const generic = () => h2.npcs.find(npc => npc.id === 14279 && npc.getOwner() === p2 && !npc.removed);
  assert.deepEqual([generic().getLocation().getX(), generic().getLocation().getY(), generic().getLocation().getZ()], [1311, 9464, 1]);
  h2.quest.setStage(p2, 62);
  h2.hooks.onPlayerLogin[0]({ player: p2 });
  assert.deepEqual([generic().getLocation().getX(), generic().getLocation().getY(), generic().getLocation().getZ()], [1311, 9497, 1],
    'stage62 moves the existing generic Itzla to the Metzli chamber');
  h2.quest.setStage(p2, 65);
  h2.hooks.onPlayerLogin[0]({ player: p2 });
  assert.deepEqual([generic().getLocation().getX(), generic().getLocation().getY(), generic().getLocation().getZ()], [1311, 9533, 1],
    'stage65 moves the same Itzla to the explore chamber');
  assert.equal(h2.npcs.filter(npc => npc.id === 14279 && npc.getOwner() === p2 && !npc.removed).length, 1,
    'stage transitions do not duplicate Itzla');
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
  for (const fn of h2.hooks.onPlayerLogout) fn({ player: p2 });
});

test('The Final Dawn dispatches both resolved sun-puzzle Itzla content ids through real Talk-to', () => {
  for (const [sunState, expectedId] of [[0, 14283], [1, 14284]]) {
    const vars = { getVarbit: id => (id === 16663 ? 55 : id === 16712 ? sunState : 0), getVarp: () => 0 };
    const definition = CacheDefinitions.resolveNpc(14282, vars);
    assert.equal(definition?.id, expectedId, `stage55 sun state ${sunState} resolves ${expectedId}`);
    assert.ok(definition.actions.includes('Talk-to'), `${expectedId} is Talk-to`);

    const h = harness('TheFinalDawn'), p = player();
    p.moveTo(new core.Location(1332, 9453, 1));
    h.quest.setStage(p, 55);
    h.hooks.onPlayerLogin[0]({ player: p });
    const sun = h.npcs.find(npc => npc.id === 14282 && npc.getOwner() === p && !npc.removed);
    assert.ok(sun, 'raw 14282 tracked actor exists');

    // Real NPCOptionPacketListener passes npc.getContentId(player), i.e. 14283/14284.
    h.namedNpcs.get('Prince Itzla Arkan')['Talk-to']({ player: p, npcId: definition.id });
    for (let step = 0; step < 200 && p.manager.getCurrent() && !p.prompt; step++) p.manager.advance();
    assert.ok(p.prompt?.options.includes('Can you go to an altar for me?'),
      `resolved ${expectedId} dispatches the real altar dialogue`);
    h.choose(p, 'Can you go to an altar for me?');
    for (let step = 0; step < 200 && p.manager.getCurrent() && !p.prompt; step++) p.manager.advance();
    h.choose(p, 'North.');
    for (let step = 0; step < 200 && p.manager.getCurrent() && !p.prompt; step++) p.manager.advance();
    assert.deepEqual([sun.getLocation().getX(), sun.getLocation().getY(), sun.getLocation().getZ()], [1330, 9454, 1],
      `resolved ${expectedId} direction physically moves the tracked actor`);
    assert.equal(h.quest.getStage(p), 55);
    for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
  }
});

test('The Final Dawn Strange Tiles step between the moon chamber and final floor', () => {
  RegionManager.init();
  RegionManager.loadMapFiles(1299, 9455, true);
  assert.ok(MapObjects.get(56670, new core.Location(1299, 9455, 1), null), 'real tile 56670 exists');
  assert.ok(MapObjects.get(56669, new core.Location(1323, 9443, 1), null), 'real tile 56669 exists');
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 60);
  const enterCurrentZone = () => {
    const at = p.getLocation();
    for (const { zone, fn } of h.zones) {
      if (zone.levels.includes(at.getZ()) && at.getX() >= zone.minX && at.getX() <= zone.maxX
        && at.getY() >= zone.minY && at.getY() <= zone.maxY) fn({ player: p });
    }
  };
  const step = (x, y, z) => {
    p.moveTo(new core.Location(x, y, z));
    enterCurrentZone();
  };
  step(1299, 9455, 1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1304, 9446, 2]);
  enterCurrentZone();
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1304, 9446, 2],
    'landing does not ping-pong');
  step(1323, 9443, 1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1316, 9446, 2]);
});

test('The Final Dawn Strange Tiles work at stage55 before the sun/moon puzzles are complete', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 55);
  p.attrs.set('quest.the_final_dawn.sun', 3);
  p.attrs.set('quest.the_final_dawn.moon', 0);
  const enterCurrentZone = () => {
    const at = p.getLocation();
    for (const { zone, fn } of h.zones) {
      if (zone.levels.includes(at.getZ()) && at.getX() >= zone.minX && at.getX() <= zone.maxX
        && at.getY() >= zone.minY && at.getY() <= zone.maxY) fn({ player: p });
    }
  };
  const step = (x, y, z) => {
    p.moveTo(new core.Location(x, y, z));
    enterCurrentZone();
  };
  const at = () => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];

  step(1323, 9443, 1);
  assert.deepEqual(at(), [1316, 9446, 2], 'sun room -> central floor2 at stage55');
  step(1304, 9446, 2);
  assert.deepEqual(at(), [1299, 9455, 1], 'central floor2 -> moon room at stage55');
  enterCurrentZone(); // landing tick clears the one-shot cooldown
  step(1299, 9455, 1);
  assert.deepEqual(at(), [1304, 9446, 2], 'moon room -> central floor2 return');
  enterCurrentZone();
  step(1316, 9446, 2);
  assert.deepEqual(at(), [1323, 9443, 1], 'central floor2 -> sun room return');
  assert.equal(h.quest.getStage(p), 55, 'strange tiles do not advance the stage');
  assert.equal(p.attrs.get('quest.the_final_dawn.sun'), 3, 'sun progress untouched');
  assert.equal(p.attrs.get('quest.the_final_dawn.moon'), 0, 'moon progress untouched');
});

test('The Final Dawn Ancient roots Fletch uses the captured action and knife blade', () => {
  assert.equal(CacheDefinitions.getItem(30963).inventoryActions[0], 'Fletch');
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 55);
  p.items.set(I.ANCIENT_ROOTS, 1);
  for (const fn of h.hooks.onItemAction) fn({ player: p, itemId: I.ANCIENT_ROOTS, option: 'Fletch', handled: false });
  assert.equal(p.items.get(I.ANCIENT_ROOTS), 1, 'no knife blade leaves roots');
  p.items.set(I.KNIFE_BLADE, 1);
  for (const fn of h.hooks.onItemAction) fn({ player: p, itemId: I.ANCIENT_ROOTS, option: 'Fletch', handled: false });
  assert.equal(p.items.get(I.ANCIENT_ROOTS), 0);
  assert.equal(p.items.get(I.ROOT_KINDLING), 4);
});

test('The Final Dawn moon statue uses the captured countdialog for 2/6/6 kindling', () => {
  const h = harness('TheFinalDawn'), p = player();
  const moon = 'quest.the_final_dawn.moon';
  h.quest.setStage(p, 55);
  p.attrs.set('quest.the_final_dawn.sun', 3);
  p.items.set(I.ROOT_KINDLING, 14);

  // Progress 0 opens the captured burnt-kindling messagebox, then the native amount prompt.
  h.object(p, 56690);
  assert.equal(p.prompt, undefined, 'no invented 8-option chatbox prompt');
  assert.ok(p.manager.getCurrent(), 'messagebox is shown first');
  p.manager.advance();
  assert.equal(p.amountPrompt, 'How much kindling do you want to place on the statue? (1 - 14)');
  assert.ok(p.amountAction, 'countdialog is armed');

  // Wrong amount burns what was offered and does not advance.
  p.amountAction.execute(1);
  assert.equal(p.attrs.get(moon) ?? 0, 0);
  assert.equal(p.items.get(I.ROOT_KINDLING), 13);
  assert.ok(p.messages.includes('<col=ff3045>The statue rejects the kindling and incinerates it.'));
  assert.equal(p.amountAction, null, 'wrong amount clears the stale prompt');

  // More than held is refused without consuming anything.
  h.object(p, 56690);
  p.manager.advance();
  assert.equal(p.amountPrompt, 'How much kindling do you want to place on the statue? (1 - 13)');
  p.amountAction.execute(99);
  assert.equal(p.attrs.get(moon) ?? 0, 0);
  assert.equal(p.items.get(I.ROOT_KINDLING), 13);
  assert.ok(p.messages.includes('You do not have that much kindling.'));

  // Captured order-2 offerings: 2, 6, 6.
  h.object(p, 56690);
  p.manager.advance();
  p.amountAction.execute(2);
  assert.equal(p.attrs.get(moon), 1);
  assert.equal(p.items.get(I.ROOT_KINDLING), 11);

  h.object(p, 56690);
  assert.equal(p.amountPrompt, 'How much kindling do you want to place on the statue? (1 - 11)');
  p.amountAction.execute(6);
  assert.equal(p.attrs.get(moon), 2);
  assert.equal(p.items.get(I.ROOT_KINDLING), 5);

  // The third offer still needs 6; 5 held is refused, then 6 completes the statue.
  h.object(p, 56690);
  p.amountAction.execute(6);
  assert.equal(p.attrs.get(moon), 2);
  assert.equal(p.items.get(I.ROOT_KINDLING), 5);
  p.items.set(I.ROOT_KINDLING, 7);
  h.object(p, 56690);
  p.amountAction.execute(6);
  assert.equal(p.attrs.get(moon), 3);
  assert.equal(p.items.get(I.ROOT_KINDLING), 1);
  assert.equal(h.quest.getStage(p), 60);
  assert.ok(p.messages.includes('<col=229628>The ruins shake as you activate the final statue.'));
});

test('The Final Dawn moon statue ignores clicks outside the cavern stages', () => {
  const h = harness('TheFinalDawn'), p = player();
  p.items.set(I.ROOT_KINDLING, 6);
  for (const stage of [54, 62]) {
    h.quest.setStage(p, stage);
    h.object(p, 56690);
    assert.equal(p.amountAction, undefined, `no prompt at stage ${stage}`);
    assert.equal(p.amountPrompt, undefined, `no prompt title at stage ${stage}`);
    assert.equal(p.attrs.get('quest.the_final_dawn.moon') ?? 0, 0);
  }
});

test('The Final Dawn temple chest validates the captured four-pin code, first attempt allowed', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 7);
  h.object(p, 56537, 1, new core.Location(1723, 9709, 0));
  assert.equal(p.interface, 811);
  assert.deepEqual(p.interfaceScript.args.slice(-4), [4, 0, 0, 0]);
  assert.ok(p.amountAction, 'confirm countdialog is armed');

  // Recorded guesses and ternary feedback are sent back to the client.
  for (const [guess, feedback] of [[0, 702], [43, 708], [80, 708], [117, 710]]) {
    p.amountAction.execute(guess);
    assert.equal(p.varbits.get(16693) ?? 0, 0);
    h.tick(1);
    assert.equal(p.interface, 811);
    assert.deepEqual(p.interfaceScript.args.slice(-4).slice(-2), [guess, feedback]);
    assert.ok(p.amountAction);
  }
  // Correct code works immediately, with no invented five-attempt gate.
  p.amountAction.execute(153);
  assert.equal(p.varbits.get(16693), 1);
  assert.ok(p.messages.includes('You picklock the chest and find a scroll inside.'));
  assert.equal(p.amountAction, null, 'success clears the countdialog action');
});

test('The Final Dawn stale lockpick success after leaving STAGE_SCROLL is inert', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 7);
  h.object(p, 56537, 1, new core.Location(1723, 9709, 0));
  const action = p.amountAction;
  h.quest.setStage(p, 8);
  action.execute(153);
  assert.equal(p.varbits.get(16693) ?? 0, 0);
  assert.equal(p.attrs.get('the-final-dawn:chest-lockpick-solved') ?? 0, 0);
  assert.ok(!p.messages.includes('You picklock the chest and find a scroll inside.'));
});

test('The Final Dawn patrol kick cancels an active lockpick before teleporting', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 7);
  h.object(p, 56537, 1, new core.Location(1723, 9709, 0));
  assert.ok(p.amountAction);
  h.quest.setStage(p, 4);
  h.hooks.onPlayerLogin[0]({ player: p });
  p.moveTo(new core.Location(1684, 9705, 0));
  h.tick(1);
  assert.equal(p.amountAction, null, 'patrol kick closes the lockpick prompt');
  assert.ok(p.messages.includes('A guard spots you in a restricted area and kicks you out.'));
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1679, 9698]);
});

test('The Final Dawn temple talk accepts the visible Ascended family only at the temple stage', () => {
  const h = harness('TheFinalDawn'), p = player();
  const def = CacheDefinitions.getNpc(13744);
  assert.equal(def?.name, 'Emissary Ascended');
  h.quest.setStage(p, 3);
  const talk = h.namedNpcs.get('Emissary Ascended')['Talk-to'];
  assert.equal(talk({ player: p, npcId: 13744 }), true);
  h.action(p, 13744, 'QNa_aF');
  assert.equal(h.quest.getStage(p), 4);
  h.quest.complete(p);
  assert.equal(talk({ player: p, npcId: 13744 }), false, 'post-quest Talk-to yields');
  const stage = h.quest.getStage(p);
  h.action(p, 13744, 'QNa_aF');
  assert.equal(h.quest.getStage(p), stage, 'post-quest sermon action is inert');
});

test('The Final Dawn Enforcer patrol spots the player and cleans up at the fight', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 4);
  h.hooks.onPlayerLogin[0]({ player: p });
  const patrol = h.npcs.find(npc => npc.id === 14266);
  assert.ok(patrol, 'captured patrol spawned');
  assert.equal(patrol.owner, p);
  assert.equal(patrol.ownerOnly, true);
  p.moveTo(new core.Location(1684, 9705, 0));
  h.tick(1);
  assert.equal(p.messages.includes('A guard spots you in a restricted area and kicks you out.'), true);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1679, 9698]);
  h.quest.setStage(p, 8);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.ok(!h.npcs.some(npc => npc.id === 14266 && !npc.removed), 'patrol removed for the fight');
});

test('The Final Dawn safehouse loot is a ground pickup and the sack empties naturally', () => {
  const h = harness('TheFinalDawn'), p = player();
  p.moveTo(new core.Location(1651, 3094, 0));
  h.quest.setStage(p, 16);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.ok(h.ground.has('Parity:5424:1645:3091:0'), 'potato sack ground spawn');
  assert.ok(h.ground.has('Parity:946:1646:3095:0'), 'knife ground spawn');
  p.items.set(5424, 1);
  for (const fn of h.hooks.onItemAction) fn({ player: p, itemId: 5424, option: 'Empty', handled: false });
  assert.equal(p.items.get(5424) ?? 0, 0);
  assert.equal(p.items.get(I.EMPTY_SACK), 1);
  assert.equal(p.items.get(I.POTATO), 3);
});


test('The Final Dawn scene cleanup restores controls and camera on logout', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 22);
  h.namedNpcs.get('Captain Vibia')['Talk-to']({ player: p, npcId: 14303 });
  h.tick(3);
  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
  assert.equal(p.blocked, false);
  assert.ok(p.camera.some(packet => packet[0] === 'reset'));
  assert.equal(p.getArea(), null);
});

test('The Final Dawn keystone Locate uses the three captured tiles, varbit 16671 and ordered checkpoints', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 40);
  p.items.set(I.KEYSTONE_FRAGMENT, 1);
  const locate = () => {
    for (const fn of h.hooks.onItemAction) fn({ player: p, itemId: I.KEYSTONE_FRAGMENT, option: 'Touch', handled: false });
  };
  p.moveTo(new core.Location(1500, 9700, 0));
  locate();
  assert.equal(p.varbits.get(16671) ?? 0, 0, 'wrong tile does not advance');
  p.moveTo(new core.Location(1511, 9702, 0));
  locate();
  assert.equal(p.varbits.get(16671), 1);
  assert.equal(h.quest.getStage(p), 40);
  p.moveTo(new core.Location(1375, 9684, 0));
  locate();
  assert.equal(p.varbits.get(16671), 2);
  assert.equal(h.quest.getStage(p), 40);
  p.moveTo(new core.Location(1373, 9539, 0));
  locate();
  assert.equal(h.quest.getStage(p), 41);
  assert.equal(p.items.get(I.KEYSTONE_FRAGMENT) ?? 0, 0);
  assert.equal(p.varbits.get(16671), 2);
  p.attrs.set('the-final-dawn:neypotzli-checkpoint', 2);
  p.varbits.delete(16671);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(16671), 2, 'login resyncs the saved checkpoint');
});

test('The Final Dawn glowing symbol only starts the fight at stage 41', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 40);
  h.object(p, 56620, 1, { x: 1375, y: 9537, z: 0 });
  assert.equal(h.quest.getStage(p), 40, 'symbol is inert before the third locate');
  h.quest.setStage(p, 41);
  h.object(p, 56620, 1, { x: 1375, y: 9537, z: 0 });
  h.action(p, 14331, 'maos4n');
  assert.equal(h.quest.getStage(p), 43);
  assert.ok(h.npcs.some(npc => npc.id === 14362));
});

test('The Final Dawn resumes a saved stage62 fight with one captured Metzli actor', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 62);
  h.hooks.onPlayerLogin[0]({ player: p });
  const bosses = () => h.npcs.filter(npc => npc.id === 14313 && !npc.removed);
  assert.equal(bosses().length, 1, 'one real Metzli actor for a saved stage62 fight');
  assert.deepEqual(
    [bosses()[0].getLocation().getX(), bosses()[0].getLocation().getY(), bosses()[0].getLocation().getZ()],
    [1312, 9500, 1], 'captured Metzli chamber tile'
  );
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(bosses().length, 1, 'repeat login does not duplicate Metzli');

  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
  const relogged = player();
  h.quest.setStage(relogged, 62);
  h.hooks.onPlayerLogin[0]({ player: relogged });
  assert.equal(bosses().length, 1, 'relog resumes one Metzli actor');

  const dead = player();
  h.quest.setStage(dead, 63);
  h.hooks.onPlayerLogin[0]({ player: dead });
  assert.equal(h.npcs.filter(npc => npc.id === 14313 && npc.getOwner() === dead && !npc.removed).length, 0,
    'a saved stage63 fight does not respawn Metzli');
});

test('The Final Dawn logout removes every tracked owner NPC before a fresh login', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 23);
  h.hooks.onPlayerLogin[0]({ player: p });
  const spawned = h.npcs.filter(npc => !npc.removed);
  assert.ok(spawned.some(npc => npc.id === 14303), 'Vibia is spawned for the owner');
  assert.ok(spawned.some(npc => npc.id === 14236), 'the guard dog is spawned for the owner');

  for (const fn of h.hooks.onPlayerLogout) fn({ player: p });
  assert.ok(spawned.every(npc => npc.removed), 'logout removes every tracked owner NPC');

  const relogged = player();
  h.quest.setStage(relogged, 23);
  h.hooks.onPlayerLogin[0]({ player: relogged });
  assert.equal(h.npcs.filter(npc => !npc.removed && npc.id === 14303).length, 1, 'relog spawns one Vibia');
  assert.equal(h.npcs.filter(npc => !npc.removed && npc.id === 14236).length, 1, 'relog spawns one dog');
});

test('The Final Dawn Neypotzli gates lead through Streambound, Earthbound and Ancient Prison in order', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 37);
  h.object(p, 51375);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1440, 9616, 1]);
  h.quest.setStage(p, 39);
  h.object(p, 51376);
  assert.equal(h.quest.getStage(p), 40);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1481, 9669]);
  p.attrs.set('the-final-dawn:neypotzli-checkpoint', 1);
  h.object(p, 51378);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1390, 9676]);
  p.attrs.set('the-final-dawn:neypotzli-checkpoint', 2);
  h.object(p, 51377);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1347, 9590]);
});

test('The Final Dawn temple stairs dispatch through real Ladders and require Final then Dawn', () => {
  const h = harness('TheFinalDawn'), p = player();
  require('../plugins/objects/Ladders.plugin').register(h.api);
  h.quest.setStage(p, 4);
  const stairs = h.namedObjects.get('Stairs')['Climb-down'];
  const event = (player = p) => ({ player, objectId: 54518, clickType: 1, object: { getLocation: () => new core.Location(1677, 3247, 0) }, definition: { getName: () => 'Stairs' }, handled: false });

  const wrong = event();
  assert.equal(stairs(wrong), true);
  h.advanceToPrompt(p);
  h.choose(p, 'Final.');
  h.advanceToPrompt(p);
  h.choose(p, 'Rise.');
  assert.equal(h.quest.getStage(p), 4, 'wrong phrase does not enter the basement');
  assert.notDeepEqual([p.getLocation().getX(), p.getLocation().getY()], [1672, 9687]);

  const correct = event();
  assert.equal(stairs(correct), true);
  h.advanceToPrompt(p);
  h.choose(p, 'Final.');
  h.advanceToPrompt(p);
  h.choose(p, 'Dawn.');
  assert.equal(h.quest.getStage(p), 5);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1672, 9687, 0]);
  assert.equal(event().handled, false, 'stairs are not claimed after stage 4');
});

test('The Final Dawn final chamber follows captured stages 65 to 66', () => {
  const h = harness('TheFinalDawn'), p = player();
  h.quest.setStage(p, 65);
  h.object(p, 56600);
  h.object(p, 56603);
  h.object(p, 56615);
  h.object(p, 56595);
  assert.equal(h.quest.getStage(p), 66);
  assert.equal(p.items.get(I.STONE_TABLET_12), 1);
});
