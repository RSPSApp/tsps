// From server/: node --test tests/qh728-q047.test.cjs (after yarn build).
// Garden of Tranquillity: dispatches the plugin's registered handlers through
// a fresh stage 0 route, the Quest Helper garden legs and the King Roald
// completion. Starting stages/items are fixture state where the world would
// otherwise have to grow crops or provide prerequisites; the handlers and
// state transitions are the production plugin.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
let nextIndex = 1;
const noop = () => {};
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function harness() {
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [];
  const taskManager = { submit(task) { task.setRunning(true); tasks.push(task); }, cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); } };
  const api = new Proxy({
    core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt },
      ObjectManager: { register: noop, deregister: noop } },
    getTaskManager: () => taskManager,
    registerArea: noop,
    registerCombatMethodResolver: noop,
    getObjectManager: () => ({ register: noop, deregister: noop }),
    getItemOnGroundManager: () => ({ registerLocation: noop, registers: noop }),
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    persistAttribute: noop,
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z);
      const npc = { ...definition, getId: () => definition.id, index: nextIndex++, getLocation: () => location,
        moveTo: to => { location = to; }, getMovementQueue: () => ({ reset() { return this; }, addSteps(to) { location = to; return this; } }),
        getArea: () => null, setArea: noop, isRegistered: () => true,
        getOwner: () => definition.owner };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require('../plugins/quests/quests/GardenOfTranquillity.Quest')(api);
  const h = {
    api, hooks, events, tasks, npcs, removed,
    quest: runtime.getRegisteredQuests().at(-1),
    variant(p, npcId) {
      for (const fn of hooks.onNpcDialogueVariant ?? []) {
        const result = fn({ player: p, npcId, npc: null, definition: { getName: () => '' } });
        if (result) return result;
      }
      return null;
    },
    answer(p, stepId) {
      for (const fn of hooks.onNpcDialogueCondition ?? []) {
        const answer = fn({ player: p, stepId, npcId: 0, text: '' });
        if (answer !== null && answer !== undefined) return answer;
      }
      return null;
    },
    condition(p, stepId, npcId = 0) {
      const event = { player: p, npcId, stepId, text: '', pages: [{ page: h.quest.name }] };
      (events['npc-dialogue:condition'] ?? []).forEach(fn => fn(event));
      return event;
    },
    action(p, npcId, stepId, extra = {}) {
      const event = { player: p, npcId, stepId, text: '', kind: 'action', pages: [{ page: h.quest.name }], ...extra };
      (events['npc-dialogue:action'] ?? []).forEach(fn => fn(event));
      return event;
    },
    choice(p, npcId, option) {
      const event = { player: p, npcId, option, text: option, pages: [{ page: h.quest.name }] };
      (events['npc-dialogue:choice'] ?? []).forEach(fn => fn(event));
      return event;
    },
    itemOnObject(p, itemId, objectId, x, y) {
      const event = { player: p, itemId, objectId, location: new core.Location(x, y, 0) };
      (hooks.onItemOnObject ?? []).forEach(fn => fn(event));
      return event;
    },
    itemOnItem(p, usedItemId, usedWithItemId) {
      const event = { player: p, usedItemId, usedWithItemId };
      (hooks.onItemOnItem ?? []).forEach(fn => fn(event));
      return event;
    },
    itemOnNpc(p, npcId, itemId) {
      const event = { player: p, npcId, itemId };
      (hooks.onItemOnNpc ?? []).forEach(fn => fn(event));
      return event;
    },
    npc(p, npcId, option = 'Talk-to', npc = null) {
      const event = { player: p, npcId, npc, clickType: 1, definition: { getActions: () => [option] } };
      (hooks.onNpcInteraction ?? []).forEach(fn => fn(event));
      return event;
    },
    object(p, objectId, option = 'Inspect') {
      const event = { player: p, objectId, clickType: 1, definition: { getInteractions: () => [option] } };
      (hooks.onObjectInteraction ?? []).forEach(fn => fn(event));
      return event;
    },
    advance(p, ms) {
      const event = { player: p, ms };
      (events['agent:advance-time'] ?? []).forEach(fn => fn(event));
      return event;
    },
    logout(p) { (hooks.onPlayerLogout ?? []).forEach(fn => fn({ player: p })); },
    login(p) { (hooks.onPlayerLogin ?? []).forEach(fn => fn({ player: p })); },
  };
  return h;
}

function container(size, ground = []) {
  let items = Array.from({ length: size }, () => new core.Item(-1, 0));
  return {
    getItems: () => items,
    setItems: next => { items = next; },
    refreshItems: noop,
    get: index => items[index],
    setItem: (index, item) => { items[index] = item; },
    getAmount: id => items.filter(item => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
    contains: id => items.some(item => item.getId() === id),
    getFreeSlots: () => items.filter(item => item.getId() < 0).length,
    isFull() { return this.getFreeSlots() === 0; },
    adds(id, amount) { const i = items.findIndex(item => item.getId() < 0); assert.ok(i >= 0, 'inventory full'); items[i] = new core.Item(id, amount); },
    forceAdd(_player, item) {
      if (this.contains(item.getId()) || this.getFreeSlots() > 0) this.adds(item.getId(), item.getAmount());
      else ground.push(item.clone());
    },
    deleteNumber(id, amount) {
      const i = items.findIndex(item => item.getId() === id);
      assert.ok(i >= 0, `missing item ${id}`);
      const left = items[i].getAmount() - amount;
      items[i] = left > 0 ? new core.Item(id, left) : new core.Item(-1, 0);
    },
    clear() { items = Array.from({ length: size }, () => new core.Item(-1, 0)); },
  };
}

function player() {
  const attrs = new Map(), configs = new Map(), varbits = new Map(), xp = [], messages = [];
  let location = new core.Location(3221, 3473, 0), text = '', prompt = null;
  const ground = [];
  const inventory = container(28, ground), equipment = container(14);
  const banks = Array.from({ length: core.Bank.TOTAL_BANK_TABS }, () => container(100));
  let manager;
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    getVarbit: id => varbits.get(id) ?? 0,
    getVarp: id => configs.get(id) ?? 0,
    sendString(value) { text = value; return packet; },
    sendInterfaceRemoval() { manager.reset(); prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => packet) });
  const p = {
    attrs, configs, varbits, xp, messages, inventory, equipment, ground, index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory, getEquipment: () => equipment, getBank: tab => banks[tab],
    getPacketSender: () => packet, getDialogueManager: () => manager,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getMaxLevel: () => 99 }),
    getMovementQueue: () => ({ reset() { return this; }, addSteps(to) { location = to; return this; }, setBlockMovement() { return this; } }),
    getLocation: () => location, moveTo: to => { location = to; }, getArea: () => null, getPrivateArea: () => null, setArea: noop,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getUsername: () => 'q047', getIndex: () => p.index, setUntargetable: noop, setPositionToFace: noop,
    performAnimation: noop, sendMessage: value => messages.push(value), getCombat: () => ({ reset: noop }),
    getHitpoints: () => 99,
  };
  manager = new DialogueManager(p);
  Object.defineProperty(p, 'text', { get: () => text, set: value => { text = value; } });
  Object.defineProperty(p, 'prompt', { get: () => prompt, set: value => { prompt = value; } });
  Object.defineProperty(p, 'manager', { get: () => manager });
  return p;
}

function garden() {
  const h = harness(), p = player();
  (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === 'creature_of_fenkenstrain') event.complete = true; });
  return { h, p };
}

const START_HOOK = 'quest:garden-of-tranquillity:start';
const STATE_KEY = 'quest.garden_of_tranquillity.state';

test('Garden stage 0 -> 40: start hook, list, Ring of Charos and diplomacy test', () => {
  const { h, p } = garden();
  assert.equal(h.quest.getStage(p), 0);
  assert.equal(h.variant(p, N.QUEEN_ELLAMARIA), 'starting-off-talking-to-ellamaria');
  (h.events['npc-dialogue:hook'] ?? []).forEach(fn => fn({ player: p, npcId: N.QUEEN_ELLAMARIA, hook: START_HOOK }));
  assert.equal(h.quest.getStage(p), 10, 'accepting starts the quest');
  assert.equal(h.variant(p, N.QUEEN_ELLAMARIA), 'starting-off-talking-to-queen-ellamaria-again');
  h.action(p, N.QUEEN_ELLAMARIA, 'm-VVpe');
  assert.equal(p.inventory.getAmount(I.LIST), 1, 'list 6479');

  p.inventory.adds(I.RING_OF_CHAROS, 1);
  h.condition(p, 'IvLJx8', N.WISE_OLD_MAN);
  assert.equal(h.quest.getStage(p), 20, 'WOM asks for the ring');
  h.condition(p, 'uBaVsz', N.WISE_OLD_MAN);
  assert.equal(h.quest.getStage(p), 30, 'first test fails');
  h.itemOnObject(p, I.DELPHINIUM_SEED, 9165, 3225, 3475);
  assert.equal(p.varbits.get(982) ?? 0, 0, 'garden patches gated before stage 40');
  h.itemOnObject(p, I.SECATEURS, 9263, 3007, 3497);
  assert.equal(p.varbits.get(976) ?? 0, 0, 'white tree gated before the garden phase');
  h.condition(p, 'p6_fVN', N.WISE_OLD_MAN);
  assert.equal(h.quest.getStage(p), 40, 'retake passes');
  assert.equal(p.inventory.getAmount(I.RING_OF_CHAROS), 0);
  assert.equal(p.inventory.getAmount(I.RING_OF_CHAROS_A_), 1, 'same ring activated, 6465');

});

function plantRoute(h, p) {
  p.inventory.clear();
  p.inventory.adds(I.MARIGOLD_SEED, 1);
  h.choice(p, N.ELSTAN, 'Okay, I\'ll grow you some marigolds.');
  assert.equal(p.varbits.get(967), 1, 'Elstan requested marigolds');
  h.itemOnObject(p, I.MARIGOLD_SEED, 7847, 3055, 3308);
  h.advance(p, 21 * 60 * 1000);
  p.inventory.adds(I.MARIGOLDS, 1);
  assert.equal(h.answer(p, 'SMBSOR'), true, 'marigolds grown in Elstan\'s patch');
  h.action(p, N.ELSTAN, 'jkEsoU');
  assert.equal(p.varbits.get(967), 4);
  assert.equal(p.inventory.getAmount(I.DELPHINIUM_SEED), 4, 'delphinium 6457');

  p.inventory.clear();
  p.inventory.adds(I.ONION_SEED, 1);
  h.choice(p, N.LYRA, 'That\'s a deal - I\'ll grow a patch of onions for you.');
  h.itemOnObject(p, I.ONION_SEED, 8556, 3601, 3529);
  h.advance(p, 41 * 60 * 1000);
  assert.equal(h.answer(p, 'gwlRoy'), true, 'onions grown');
  h.action(p, N.LYRA, '_FjB0S');
  assert.equal(p.varbits.get(968), 3);
  assert.equal(p.inventory.getAmount(I.ORCHID_SEED), 3);
  assert.equal(p.inventory.getAmount(I.ORCHID_SEED_2), 3);

  p.inventory.clear();
  p.inventory.adds(I.CABBAGE_SEED, 1);
  h.choice(p, N.KRAGEN, 'That\'s a deal - I\'ll let you know when your cabbages are ready.');
  h.itemOnObject(p, I.CABBAGE_SEED, 8554, 2669, 3378);
  h.advance(p, 41 * 60 * 1000);
  assert.equal(h.answer(p, 'jGaiJa'), true, 'cabbages grown');
  h.action(p, N.KRAGEN, 'b3RCCp');
  assert.equal(p.varbits.get(971), 3);
  assert.equal(p.inventory.getAmount(I.SNOWDROP_SEED), 4);

  p.inventory.clear();
  h.choice(p, N.DANTAERA, 'Unless you allow me to do this she will die anyway.');
  h.itemOnObject(p, I.SECATEURS, 9263, 3007, 3497);
  h.condition(p, 'cjBRaq', N.DANTAERA);
  h.action(p, N.DANTAERA, 'qr_hUI');
  assert.equal(p.varbits.get(976), 2);
  assert.equal(p.inventory.getAmount(I.WHITE_TREE_SHOOT), 1);

  p.inventory.adds(I.FILLED_PLANT_POT, 1);
  h.itemOnItem(p, I.WHITE_TREE_SHOOT, I.FILLED_PLANT_POT);
  assert.equal(p.inventory.getAmount(I.WHITE_TREE_SHOOT_2), 1, 'potted shoot 6462');
  p.inventory.adds(I.WATERING_CAN, 1);
  h.itemOnItem(p, I.WHITE_TREE_SHOOT_2, I.WATERING_CAN);
  assert.equal(p.inventory.getAmount(I.WHITE_TREE_SHOOT_W_), 1, 'watered shoot 6463');

  // A real clock tick has passed without a login/talk/advance-time refresh:
  // drop the cached state, age the persisted sapling timer, then click the patch.
  h.logout(p);
  const state = JSON.parse(p.attrs.get(STATE_KEY));
  state.t.sapling = Date.now() - 6 * 60 * 1000;
  p.attrs.set(STATE_KEY, JSON.stringify(state));
  h.itemOnObject(p, I.WHITE_TREE_SHOOT_W_, 9209, 3229, 3474);
  assert.equal(p.inventory.getAmount(I.WHITE_TREE_SHOOT_W_), 0, 'watered shoot consumed');
  assert.equal(p.inventory.getAmount(I.WHITE_TREE_SAPLING), 0, 'sapling planted');
  assert.equal(p.varbits.get(985), 4, 'white tree patch planted');

  p.inventory.clear();
  h.choice(p, N.BROTHER_ALTHRIC, 'These are the most beautiful rosebushes I\'ve ever seen.');
  p.inventory.adds(I.RING_OF_CHAROS_A_, 1);
  h.itemOnObject(p, I.RING_OF_CHAROS_A_, 884, 3085, 3503);
  h.condition(p, 'N0eqXG', N.BROTHER_ALTHRIC);
  assert.equal(p.inventory.getAmount(I.RING_OF_CHAROS_A_), 0, 'ring dropped in the well');
  assert.equal(p.varbits.get(966), 1);
  h.object(p, 9260, 'Take-seed');
  h.condition(p, 'HAhsGB', N.BROTHER_ALTHRIC);
  h.action(p, N.BROTHER_ALTHRIC, 'eMqaFw');
  h.object(p, 9262, 'Take-seed');
  h.condition(p, 'Nj1EU9', N.BROTHER_ALTHRIC);
  h.action(p, N.BROTHER_ALTHRIC, '3mb09S');
  h.object(p, 9261, 'Take-seed');
  h.condition(p, 'RoQujd', N.BROTHER_ALTHRIC);
  h.action(p, N.BROTHER_ALTHRIC, 'eYOoGS');
  assert.equal(p.inventory.getAmount(I.RED_ROSE_SEED), 4, 'red bush 6454');
  assert.equal(p.inventory.getAmount(I.WHITE_ROSE_SEED), 4, 'white bush 6453');
  assert.equal(p.inventory.getAmount(I.PINK_ROSE_SEED), 4, 'pink bush 6455');
  assert.equal(h.variant(p, N.BROTHER_ALTHRIC), 'talking-to-brother-althric-talking-to-brother-althric-again', 'Althric quest dialogue during the garden phase');

  p.inventory.adds(I.FISHING_ROD, 1);
  h.itemOnObject(p, I.FISHING_ROD, 884, 3085, 3503);
  h.condition(p, '82BstK', N.BROTHER_ALTHRIC);
  assert.equal(p.inventory.getAmount(I.RING_OF_CHAROS_A_), 1, 'ring fished back');
  assert.equal(p.varbits.get(966), 0);

  p.inventory.clear();
  p.inventory.adds(I.PLANT_CURE, 2);
  h.choice(p, N.BERNALD, 'I accept the deal.');
  h.itemOnObject(p, I.PLANT_CURE, 9254, 2914, 3534);
  h.condition(p, '7O53gr', N.BERNALD);
  assert.equal(p.varbits.get(988), 2);
  h.choice(p, N.ALAIN, 'Are you sure there\'s nothing you can suggest?');
  assert.equal(p.varbits.get(988), 3);
  p.inventory.adds(I.HAMMER, 1);
  p.inventory.adds(I.PESTLE_AND_MORTAR, 1);
  p.inventory.adds(I.RUNE_ESSENCE, 1);
  h.itemOnItem(p, I.HAMMER, I.RUNE_ESSENCE);
  h.action(p, N.ALAIN, 'TJjHns');
  assert.equal(p.inventory.getAmount(I.RUNE_SHARDS), 1);
  h.itemOnItem(p, I.PESTLE_AND_MORTAR, I.RUNE_SHARDS);
  h.action(p, N.ALAIN, '1bplqz');
  assert.equal(p.inventory.getAmount(I.RUNE_DUST), 1);
  h.itemOnItem(p, I.RUNE_DUST, I.PLANT_CURE);
  h.action(p, N.ALAIN, 'yUlUJi');
  assert.equal(p.inventory.getAmount(I.PLANT_CURE_3), 1, 'strong plant cure 6468');
  h.itemOnObject(p, I.PLANT_CURE_3, 9254, 2914, 3534);
  h.condition(p, 'UvOYOt', N.BERNALD);
  assert.equal(p.varbits.get(988), 4);
  h.action(p, N.BERNALD, 'i06M8V');
  assert.equal(p.varbits.get(988), 5);
  assert.equal(p.inventory.getAmount(I.VINE_SEED), 4);
}

function plantNinePatches(h, p) {
  p.inventory.clear();
  p.inventory.adds(I.DELPHINIUM_SEED, 1);
  h.itemOnObject(p, I.DELPHINIUM_SEED, 9165, 3225, 3475);
  assert.equal(p.varbits.get(982), 4);

  p.inventory.adds(I.SNOWDROP_SEED, 1);
  h.itemOnObject(p, I.SNOWDROP_SEED, 9223, 3232, 3479);
  assert.equal(p.varbits.get(983), 4);

  p.inventory.adds(I.VINE_SEED, 1);
  h.itemOnObject(p, I.VINE_SEED, 9232, 3227, 3480);
  assert.equal(p.varbits.get(987), 4);

  p.inventory.adds(I.COMPOST, 1);
  h.itemOnObject(p, I.COMPOST, 9197, 3229, 3486);
  assert.equal(p.varbits.get(984), 1);
  assert.equal(p.inventory.getAmount(I.BUCKET), 1, 'compost bucket returned');
  p.inventory.adds(I.ORCHID_SEED, 1);
  h.itemOnObject(p, I.ORCHID_SEED, 9197, 3229, 3486);
  assert.equal(p.varbits.get(984), 4);

  p.inventory.adds(I.COMPOST, 1);
  h.itemOnObject(p, I.COMPOST, 9198, 3231, 3486);
  assert.equal(p.varbits.get(986), 1);
  p.inventory.adds(I.ORCHID_SEED_2, 1);
  h.itemOnObject(p, I.ORCHID_SEED_2, 9198, 3231, 3486);
  assert.equal(p.varbits.get(986), 4);

  p.inventory.adds(I.RED_ROSE_SEED, 1);
  h.itemOnObject(p, I.RED_ROSE_SEED, 9175, 3229, 3471);
  assert.equal(p.varbits.get(979), 5);
  p.inventory.adds(I.WHITE_ROSE_SEED, 1);
  h.itemOnObject(p, I.WHITE_ROSE_SEED, 9174, 3232, 3471);
  assert.equal(p.varbits.get(980), 5);
  p.inventory.adds(I.PINK_ROSE_SEED, 1);
  h.itemOnObject(p, I.PINK_ROSE_SEED, 9176, 3226, 3471);
  assert.equal(p.varbits.get(981), 5);

  h.advance(p, 20 * 60 * 1000);
  assert.equal(p.varbits.get(982), 7);
  assert.equal(p.varbits.get(983), 7);
  assert.equal(p.varbits.get(987), 7);
  assert.equal(p.varbits.get(984), 7);
  assert.equal(p.varbits.get(986), 7);
  assert.equal(p.varbits.get(979), 7);
  assert.equal(p.varbits.get(980), 7);
  assert.equal(p.varbits.get(981), 7);
  assert.equal(p.varbits.get(985), 8);
}

function moveStatue(h, p, objectId, x, y, contentId) {
  p.inventory.adds(I.TROLLEY, 1);
  h.itemOnObject(p, I.TROLLEY, objectId, x, y);
  const trolley = h.npcs.at(-1);
  assert.ok(trolley, 'trolley spawned');
  const stop = objectId === 9250 ? { x: 3229, y: 3480 } : { x: 3233, y: 3488 };
  for (const axis of ['x', 'y']) {
    while (trolley.getLocation()[axis === 'x' ? 'getX' : 'getY']() !== stop[axis]) {
      const at = trolley.getLocation();
      const delta = Math.sign(stop[axis] - at[axis === 'x' ? 'getX' : 'getY']());
      const current = axis === 'x' ? at.getX() : at.getY();
      const remaining = Math.abs(stop[axis] - current);
      const distance = remaining > 4 ? 4 : 1;
      const behind = new core.Location(
        at.getX() - (axis === 'x' ? delta : 0),
        at.getY() - (axis === 'y' ? delta : 0),
        0
      );
      p.moveTo(behind);
      h.npc(p, contentId, distance === 4 ? 'Big-push' : 'Push', trolley);
    }
  }
  h.npc(p, contentId, 'Place', trolley);
  assert.equal(p.inventory.getAmount(I.TROLLEY), 1, 'trolley returned');
}

test('Garden trolley Push, Pull and Big-push move by their documented distances', () => {
  const { h, p } = garden();
  h.quest.setStage(p, 40);
  p.inventory.adds(I.TROLLEY, 1);
  h.itemOnObject(p, I.TROLLEY, 9250, 2965, 3381);
  const trolley = h.npcs.at(-1);
  const position = () => [trolley.getLocation().getX(), trolley.getLocation().getY()];

  p.moveTo(new core.Location(2964, 3382, 0));
  h.npc(p, N.TROLLEY, 'Push', trolley);
  assert.deepEqual(position(), [2966, 3382], 'Push advances one tile on the dominant cardinal axis');
  h.npc(p, N.TROLLEY, 'Pull', trolley);
  assert.deepEqual(position(), [2965, 3382], 'Pull moves one tile toward player');
  h.npc(p, N.TROLLEY, 'Big-push', trolley);
  assert.deepEqual(position(), [2969, 3382], 'Big-push advances four tiles away from player');

  h.npc(p, N.TROLLEY, 'Place', trolley);
  assert.equal(p.varbits.get(963), 1, 'a distant Place does not complete the haul');
  assert.equal(p.inventory.getAmount(I.TROLLEY), 0, 'the trolley is returned only at a plinth');
});

test('a blocked tile refuses the whole trolley push instead of routing around it', () => {
  const { h, p } = garden();
  h.quest.setStage(p, 40);
  p.inventory.adds(I.TROLLEY, 1);
  h.itemOnObject(p, I.TROLLEY, 9250, 2965, 3381);
  const trolley = h.npcs.at(-1);
  const original = RegionManager.canMovestart;
  RegionManager.canMovestart = (from, to) => to.getY() !== 3384;
  try {
    p.moveTo(new core.Location(2965, 3381, 0));
    h.npc(p, N.TROLLEY, 'Big-push', trolley);
  } finally {
    RegionManager.canMovestart = original;
  }
  assert.deepEqual([trolley.getLocation().getX(), trolley.getLocation().getY()], [2965, 3382]);
  assert.ok(p.messages.some(message => /trolley is blocked/.test(message)));
});

test('relogging during a statue haul resets the statue and allows Ellamaria to reissue the trolley', () => {
  const { h, p } = garden();
  h.quest.setStage(p, 40);
  p.inventory.adds(I.TROLLEY, 1);
  h.itemOnObject(p, I.TROLLEY, 9250, 2965, 3381);
  assert.equal(p.varbits.get(963), 1, 'Saradomin is attached to the trolley');
  assert.equal(p.varbits.get(965), 1, 'the Saradomin cargo is active');
  const trolley = h.npcs.at(-1);

  h.logout(p);
  assert.ok(h.removed.includes(trolley), 'logout removes the owner-only trolley NPC');
  h.login(p);

  assert.equal(p.varbits.get(963), 0, 'the statue returns to its original form');
  assert.equal(p.varbits.get(965), 0, 'the incomplete haul is cleared');
  assert.equal(p.inventory.getAmount(I.TROLLEY), 0, 'the captured trolley is not duplicated');
  assert.equal(h.npcs.length, 1, 'login does not respawn the cargo beside its destination');
  assert.equal(h.variant(p, N.QUEEN_ELLAMARIA), 'starting-off-talking-to-queen-ellamaria-again');
  h.action(p, N.QUEEN_ELLAMARIA, '16ihMw');
  assert.equal(p.inventory.getAmount(I.TROLLEY), 1, 'Ellamaria can replace the lost trolley');
});

test('Garden stage 40 -> 60: all nine patches, both statues, Roald and rewards once', () => {
  const { h, p } = garden();
  h.quest.setStage(p, 40);
  plantRoute(h, p);
  plantNinePatches(h, p);

  moveStatue(h, p, 9250, 2965, 3381, N.TROLLEY); // Saradomin cargo
  moveStatue(h, p, 9251, 3231, 3217, N.TROLLEY_2); // king cargo
  assert.equal(p.varbits.get(963), 2);
  assert.equal(p.varbits.get(964), 2);
  assert.equal(h.variant(p, N.QUEEN_ELLAMARIA), 'planting-the-seeds-talking-to-ellamaria-after-planting-the-seeds');

  h.condition(p, 'yb-ee9', N.QUEEN_ELLAMARIA);
  assert.equal(h.quest.getStage(p), 50, 'fetch King Roald');
  assert.equal(h.variant(p, N.KING_ROALD_3), 'talking-to-king-roald');
  h.choice(p, N.KING_ROALD_3, 'The Queen asked me to bring you.');
  assert.equal(h.variant(p, N.KING_ROALD_3), 'the-garden-of-tranquillity');

  p.inventory.clear();
  p.equipment.clear();
  p.equipment.setItem(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_CHAROS_A_, 1));
  h.action(p, N.KING_ROALD_3, 'SqRZd7');
  assert.equal(h.quest.getStage(p), 60, 'complete');
  assert.equal(Number(p.attrs.get(runtime.QUEST_POINTS_ATTRIBUTE)), 2);
  assert.deepEqual(p.xp.map(([, amount]) => amount), [5000]);
  assert.equal(p.equipment.get(core.Equipment.RING_SLOT).getId(), I.RING_OF_CHAROS_A_, 'ring stays activated');
  assert.equal(p.inventory.getAmount(I.RING_OF_CHAROS_A_), 0, 'no second activated ring minted');
  assert.equal(p.inventory.getAmount(I.RING_OF_CHAROS), 0);
  assert.equal(p.inventory.getAmount(I.ACORN), 1);
  assert.equal(p.inventory.getAmount(I.APPLE_TREE_SEED), 1);
  assert.equal(p.inventory.getAmount(I.GUAM_SEED), 5);
  assert.equal(p.inventory.getAmount(I.COMPOST_POTION_4_), 1, 'compost potion(4) 6470');

  const before = [I.ACORN, I.APPLE_TREE_SEED, I.GUAM_SEED, I.COMPOST_POTION_4_].map(id => p.inventory.getAmount(id));
  h.action(p, N.KING_ROALD_3, 'SqRZd7');
  assert.deepEqual([I.ACORN, I.APPLE_TREE_SEED, I.GUAM_SEED, I.COMPOST_POTION_4_].map(id => p.inventory.getAmount(id)), before, 'repeating the hand-in grants nothing again');
  assert.equal(Number(p.attrs.get(runtime.QUEST_POINTS_ATTRIBUTE)), 2);
  assert.equal(h.variant(p, N.WISE_OLD_MAN), null, 'post-quest WOM yields to other quests');
  assert.equal(h.variant(p, N.KING_ROALD_3), null, 'post-quest King Roald yields');
  assert.equal(h.variant(p, N.BROTHER_ALTHRIC), null, 'post-quest Althric plays his standard page');
  assert.equal(h.variant(p, N.QUEEN_ELLAMARIA), 'post-quest-dialogue-talking-to-queen-ellamaria');
});

test('Garden: a full bag fishing success drops the ring and clears the well only after delivery', () => {
  const { h, p } = garden();
  h.quest.setStage(p, 40);
  p.inventory.clear();
  p.inventory.setItem(0, new core.Item(I.FISHING_ROD, 1));
  p.inventory.setItem(1, new core.Item(I.RING_OF_CHAROS_A_, 1));
  for (let slot = 2; slot < 28; slot++) p.inventory.setItem(slot, new core.Item(995, 1));

  h.itemOnObject(p, I.RING_OF_CHAROS_A_, 884, 3085, 3503);
  h.condition(p, 'N0eqXG', N.BROTHER_ALTHRIC);
  assert.equal(p.varbits.get(966), 1, 'ring is in the well');
  p.inventory.setItem(1, new core.Item(995, 1));
  assert.equal(p.inventory.getFreeSlots(), 0, 'bag is full before the success branch');

  h.itemOnObject(p, I.FISHING_ROD, 884, 3085, 3503);
  h.condition(p, '82BstK', N.BROTHER_ALTHRIC);
  assert.equal(p.inventory.getAmount(I.RING_OF_CHAROS_A_), 0, 'full bag cannot hold the ring');
  assert.equal(p.varbits.get(966), 0, 'well state clears after the ring is delivered');
  assert.ok(p.ground.some(item => item.getId() === I.RING_OF_CHAROS_A_), 'ring dropped at the player tile');
});

test('Garden: completion with a full bag delivers rewards to the ground, not into limbo', () => {
  const { h, p } = garden();
  h.quest.setStage(p, 50);
  p.inventory.clear();
  for (let slot = 0; slot < 28; slot++) p.inventory.setItem(slot, new core.Item(995, 100));
  p.equipment.clear();
  p.equipment.setItem(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_CHAROS_A_, 1));

  h.action(p, N.KING_ROALD_3, 'SqRZd7');
  assert.equal(h.quest.getStage(p), 60);
  const dropped = p.ground.map(item => item.getId());
  for (const id of [I.ACORN, I.APPLE_TREE_SEED, I.GUAM_SEED, I.COMPOST_POTION_4_]) {
    assert.ok(dropped.includes(id), `reward ${id} delivered on the ground`);
  }
  assert.equal(p.equipment.get(core.Equipment.RING_SLOT).getId(), I.RING_OF_CHAROS_A_);
});
