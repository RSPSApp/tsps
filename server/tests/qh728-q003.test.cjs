// The Ascent of Arceuus (q003) contract tests.
// Run after `yarn build`: node --test tests/qh728-q003.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const runtime = require('../plugins/quests/QuestRuntime');
const LocTeleports = require('../plugins/world/LocTeleports.plugin');
const teleports = require('../plugins/world/data/loc-teleports.json');

const GRAVE_MULTILOC = 34602;
const TRAIL_VARBITS = [7859, 7860, 7861, 7862, 7863, 7864];
const TRAIL_ROUTE = [
  { id: 34622, x: 1335, y: 3743 },
  { id: 34623, x: 1317, y: 3750 },
  { id: 34623, x: 1305, y: 3750 },
  { id: 34621, x: 1287, y: 3750 },
  { id: 34624, x: 1285, y: 3737 },
  { id: 34625, x: 1281, y: 3725 },
];
const KARUULM_ELEVATOR = 34359;
const KARUULM_EXIT = 34514;
const MEMOIRS = 21760;
const PAGE = 21770;
const AKD_MEETING = 122;
const AKD_ACCORD = 138;

const transcripts = [];
runtime.startTranscript = (api, player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function setup(options = {}) {
  const core = PluginManager.getCoreApi();
  const hooks = {
    variants: [], conditions: [], objects: [], itemOnItem: [], customs: new Map(), login: [], deaths: [], anyNpc: null,
  };
  const spawned = [], removed = [];
  const persisted = new Set();

  const api = new Proxy({
    core,
    persistAttribute(name) { persisted.add(name); },
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onAnyNpcInteraction(actions) { hooks.anyNpc = actions; },
    onCustomEvent(name, fn) {
      const list = hooks.customs.get(name) ?? [];
      list.push(fn);
      hooks.customs.set(name, list);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && event?.key === 'client_of_kourend') {
        event.complete = options.clientOfKourend !== false;
      }
      if (name === 'quest:get-stage' && event?.key === 'a_kingdom_divided') {
        event.stage = Number(player.getAttribute('quest.a_kingdom_divided.stage')) || 0;
      }
      if (name === 'quest:is-complete' && event?.key === 'a_kingdom_divided') {
        event.complete = (Number(player.getAttribute('quest.a_kingdom_divided.stage')) || 0) >= 150;
      }
      for (const fn of hooks.customs.get(name) ?? []) fn(event);
    },
    spawnNpc(def) {
      const npc = {
        def,
        getId: () => def.id,
        getLocation: () => new core.Location(def.x, def.y, def.z),
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { removed.push(npc); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemOnItem(fn) { hooks.itemOnItem.push(fn); },
    onNpcDeath(fn) { hooks.deaths.push(fn); },
    onZoneEnter() {},
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout() {},
    sendMultiChatboxPrompt(player, title, ...pairs) {
      const options = [];
      for (let index = 0; index < pairs.length; index += 2) options.push({ text: pairs[index], pick: pairs[index + 1] });
      prompts.push({ title, options });
      return true;
    },
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  require('../plugins/quests/quests/AscentOfArceuus.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'the_ascent_of_arceuus');
  require('../plugins/npcs/NpcDialogues.plugin').register(api);

  const attrs = new Map();
  const varbits = new Map();
  const messages = [];
  const inventory = new Map();
  const bank = new Map();
  const dropped = [];
  const prompts = [];
  const xp = [];
  let location = new core.Location(0, 0, 0);
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    getVarp(id) { return varbits.get(id) ?? 0; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    sendMessage(message) { messages.push(message); },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      isFull: () => options.fullBag === true,
      getFreeSlots: () => (options.fullBag ? 0 : 28),
      adds(id, amount = 1) {
        if (options.fullBag) return;
        inventory.set(id, (inventory.get(id) ?? 0) + amount);
      },
      deleteNumber(id, amount = 1) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount)); },
      forceAdd(player, item) { dropped.push(item.getId()); },
    }),
    getBank: () => ({ getAmount: (id) => bank.get(id) ?? 0 }),
    getBanks: () => [player.getBank()],
    getSkillManager: () => ({
      getMaxLevel: () => options.hunter ?? 99,
      addExperiences(skill, amount) { xp.push([skill, amount]); },
    }),
    getLocation: () => location,
    moveTo(value) { location = value; },
    isPlayerBot: () => false,
    isPlayer: () => true,
    isRegistered: () => false,
    getHitpoints: () => 99,
    getPrivateArea: () => null,
    performAnimation() {},
    setPositionToFace() {},
    getMovementQueue: () => ({ isMovementBlocked: () => false, setBlockMovement() { return this; }, reset() { return this; } }),
    getFrameUpdater: () => ({ clear() {} }),
    getAppearance: () => ({ isMale: () => true }),
    getUsername: () => 'Tester',
  };
  player.getDialogueManager = () => player.manager;
  player.manager = new DialogueManager(player);

  const emit = (name, event) => api.emitCustomEvent(name, { player, ...event });
  const withVariantDispatch = (fn) => {
    const realVariant = PluginManager.emitNpcDialogueVariant;
    const realCondition = PluginManager.emitNpcDialogueCondition;
    PluginManager.emitNpcDialogueVariant = (event) => {
      for (const handler of hooks.variants) {
        const result = handler(event);
        if (result) return result;
      }
      return null;
    };
    PluginManager.emitNpcDialogueCondition = (event) => {
      for (const handler of hooks.conditions) {
        const result = handler(event);
        if (typeof result === 'boolean') return result;
      }
      return null;
    };
    try { return fn(); } finally {
      PluginManager.emitNpcDialogueVariant = realVariant;
      PluginManager.emitNpcDialogueCondition = realCondition;
    }
  };
  const text = () => player.manager.getCurrent()?.getText?.() ?? null;
  const talk = (npcId) => withVariantDispatch(() => {
    hooks.anyNpc['Talk-to']({
      player, npc: { getId: () => npcId }, npcId,
      definition: core.NpcDefinition.forId(npcId), handled: false,
    });
    return text();
  });
  return {
    api, core, quest, hooks, attrs, varbits, messages, inventory, bank, dropped, prompts, xp, player, spawned, removed, persisted,
    ascentVariant: hooks.variants[0],
    emit, talk, text,
    advance() { player.manager.advance(); return text(); },
    resetDialogue() { player.manager.reset(); },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    setFullBag(value) { options.fullBag = value; },
  };
}

function exposeOwnedPageDrops(h) {
  const world = h.core.World;
  const original = world.getItems;
  world.getItems = () => h.dropped.map(id => ({
    getOwner: () => h.player.getUsername(),
    getItem: () => new h.core.Item(id, 1),
    isPendingRemoval: () => false,
  }));
  return () => { world.getItems = original; };
}

function registerAkd(h) {
  require('../plugins/quests/quests/AKingdomDivided.Quest')(h.api);
  return runtime.getRegisteredQuests().findLast((entry) => entry.key === 'a_kingdom_divided');
}

function runTicks(count) {
  for (let tick = 0; tick < count; tick++) PluginManager.getCoreApi().TaskManager.process();
}

function locAt(id, x, y, z) {
  RegionManager.loadMapFiles(x, y);
  const core = PluginManager.getCoreApi();
  const object = MapObjects.get(id, new core.Location(x, y, z), null);
  assert.ok(object, `loc ${id} at ${x},${y},${z}`);
  return object;
}

test('Ascent of Arceuus: fresh stage 0 start gate requires Client of Kourend and 12 Hunter', () => {
  const blocked = setup({ clientOfKourend: false });
  blocked.emit('npc-dialogue:hook', {
    npcId: blocked.core.NpcIdentifiers.MORI,
    hook: 'quest:the-ascent-of-arceuus:start',
  });
  assert.equal(blocked.quest.getStage(blocked.player), 0);

  const lowHunter = setup({ hunter: 11 });
  lowHunter.emit('npc-dialogue:hook', {
    npcId: lowHunter.core.NpcIdentifiers.MORI,
    hook: 'quest:the-ascent-of-arceuus:start',
  });
  assert.equal(lowHunter.quest.getStage(lowHunter.player), 0);

  const started = setup({ hunter: 12 });
  started.emit('npc-dialogue:hook', {
    npcId: started.core.NpcIdentifiers.MORI,
    hook: 'quest:the-ascent-of-arceuus:start',
  });
  assert.equal(started.quest.getStage(started.player), 1);
});

test('Ascent of Arceuus: interrupting the first Tasakaal talk at stage 7 can be resumed', () => {
  const h = setup();
  const tasakaal = h.core.NpcIdentifiers.KAAL_KET_JOR;
  h.quest.setStage(h.player, 6);

  h.emit('npc-dialogue:line', { npcId: tasakaal, text: 'Human.' });
  assert.equal(h.quest.getStage(h.player), 7);
  const variant = h.hooks.variants.at(-1)({ npcId: tasakaal, player: h.player });
  assert.equal(variant, 'the-tasakaal-first-encounter');
  h.emit('npc-dialogue:line', {
    npcId: tasakaal,
    text: 'Free this soul. In return, we will provide our help.',
  });
  assert.equal(h.quest.getStage(h.player), 8);
});

test('Ascent of Arceuus: the ordered trail needs the exact cache objects, survives relog, and only the final plant spawns the soul', () => {
  const h = setup();
  const inspect = h.hooks.objects.at(-1);
  const click = (stop) => inspect({
    player: h.player, objectId: stop.id, clickType: 1,
    location: { x: stop.x, y: stop.y, z: 0 },
  });

  h.quest.setStage(h.player, 7);
  click({ id: GRAVE_MULTILOC, x: 1347, y: 3736 });
  assert.equal(h.quest.getStage(h.player), 7, 'the grave is inert before stage 8');
  assert.equal(h.varbits.get(TRAIL_VARBITS[0]) ?? 0, 0);

  h.quest.setStage(h.player, 8);
  click({ id: GRAVE_MULTILOC, x: 1347, y: 3736 });
  assert.equal(h.quest.getStage(h.player), 9);
  assert.equal(h.varbits.get(TRAIL_VARBITS[0]), 1, 'the grave reveals trail 1');

  click(TRAIL_ROUTE[1]);
  assert.equal(Number(h.attrs.get('quest.the_ascent_of_arceuus.trail')) || 0, 0, 'out-of-order stop does not advance');
  assert.equal(h.varbits.get(TRAIL_VARBITS[1]) ?? 0, 0);

  click(TRAIL_ROUTE[0]);
  assert.equal(h.attrs.get('quest.the_ascent_of_arceuus.trail'), 1);
  assert.equal(h.varbits.get(TRAIL_VARBITS[1]), 1, 'first correct find reveals trail 2');
  assert.equal(h.varbits.get(TRAIL_VARBITS[2]) ?? 0, 0);

  click(TRAIL_ROUTE[0]);
  assert.equal(h.attrs.get('quest.the_ascent_of_arceuus.trail'), 1, 'repeating a stop does not advance');
  assert.equal(h.varbits.get(TRAIL_VARBITS[2]) ?? 0, 0);

  click(TRAIL_ROUTE[2]);
  assert.equal(h.attrs.get('quest.the_ascent_of_arceuus.trail'), 1, 'skipping ahead does not advance');
  click(TRAIL_ROUTE[3]);
  assert.equal(h.attrs.get('quest.the_ascent_of_arceuus.trail'), 1, 'wrong object does not advance');

  click(TRAIL_ROUTE[1]);
  assert.equal(h.attrs.get('quest.the_ascent_of_arceuus.trail'), 2);
  assert.equal(h.varbits.get(TRAIL_VARBITS[2]), 1);
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.varbits.get(TRAIL_VARBITS[0]), 1);
  assert.equal(h.varbits.get(TRAIL_VARBITS[2]), 1);
  assert.equal(h.varbits.get(TRAIL_VARBITS[3]) ?? 0, 0, 'relog replays only the reached milestones');

  click(TRAIL_ROUTE[2]);
  click(TRAIL_ROUTE[3]);
  click(TRAIL_ROUTE[4]);
  assert.equal(h.attrs.get('quest.the_ascent_of_arceuus.trail'), 5);
  assert.equal(h.varbits.get(TRAIL_VARBITS[5]), 1, 'five finds reveal trails 2-6');
  assert.equal(h.quest.getStage(h.player), 9, 'the fifth find does not release the soul');
  assert.equal(h.spawned.some((npc) => npc.def.id === h.core.NpcIdentifiers.TRAPPED_SOUL), false);

  click(TRAIL_ROUTE[4]);
  assert.equal(h.quest.getStage(h.player), 9, 'repeating the fifth find does not finish the leg');
  assert.equal(h.attrs.get('quest.the_ascent_of_arceuus.trail'), 5);

  click(TRAIL_ROUTE[5]);
  assert.equal(h.quest.getStage(h.player), 10, 'only the final plant advances stage 10');
  assert.ok(h.spawned.some((npc) => npc.def.id === h.core.NpcIdentifiers.TRAPPED_SOUL), 'the trapped soul spawns');
  assert.ok(h.messages.some((text) => /trapped soul/.test(text)));
});

test('Ascent of Arceuus: stage handler contract reaches completion once', () => {
  const h = setup({ hunter: 12 });
  const N = h.core.NpcIdentifiers;
  const TASAKAAL = N.KAAL_KET_JOR, TROBIN = 8505;
  const SOULS = [N.TORMENTED_SOUL, N.TORMENTED_SOUL_2];

  h.emit('npc-dialogue:hook', { npcId: N.MORI, hook: 'quest:the-ascent-of-arceuus:start' });
  assert.equal(h.quest.getStage(h.player), 1);
  h.emit('npc-dialogue:choice', { npcId: 11152, option: "There's been a death in Arceuus." });
  assert.equal(h.quest.getStage(h.player), 2);
  h.emit('npc-dialogue:line', { npcId: N.MORI, text: "He'll be in the Tower of Magic, north west of here." });
  assert.equal(h.quest.getStage(h.player), 3);
  h.emit('npc-dialogue:action', { npcId: N.TOWER_MAGE, stepId: 'l8anSu' });
  assert.equal(h.quest.getStage(h.player), 4);
  for (let killed = 0; killed < 5; killed++) {
    for (const death of h.hooks.deaths) death({ player: h.player, npcId: SOULS[killed % 2], killer: h.player });
  }
  assert.equal(h.quest.getStage(h.player), 5);
  h.emit('npc-dialogue:line', {
    npcId: N.ASTEROS_ARCEUUS,
    text: "Thank you friend. You'll find Mount Karuulm on the other side of Lovakengj. Please hurry.",
  });
  assert.equal(h.quest.getStage(h.player), 6);
  h.emit('npc-dialogue:line', { npcId: TASAKAAL, text: 'Human.' });
  h.emit('npc-dialogue:line', { npcId: TASAKAAL, text: 'Free this soul. In return, we will provide our help.' });
  assert.equal(h.quest.getStage(h.player), 8);

  const inspect = h.hooks.objects.at(-1);
  inspect({ player: h.player, objectId: GRAVE_MULTILOC, clickType: 1, location: { x: 1347, y: 3736, z: 0 } });
  for (const stop of TRAIL_ROUTE) {
    inspect({ player: h.player, objectId: stop.id, clickType: 1, location: { x: stop.x, y: stop.y, z: 0 } });
  }
  assert.equal(h.quest.getStage(h.player), 10);
  for (const death of h.hooks.deaths) death({ player: h.player, npcId: N.TRAPPED_SOUL, killer: h.player });
  assert.equal(h.quest.getStage(h.player), 11);
  h.emit('npc-dialogue:line', { npcId: TASAKAAL, text: 'Find it. Destroy it.' });
  assert.equal(h.quest.getStage(h.player), 12);

  transcripts.length = 0;
  for (const rock of [
    { id: 34626, x: 1706, y: 3888 }, { id: 34626, x: 1713, y: 3892 },
    { id: 34627, x: 1713, y: 3875 }, { id: 34627, x: 1722, y: 3881 },
  ]) inspect({ player: h.player, objectId: rock.id, clickType: 1, location: { x: rock.x, y: rock.y, z: 0 } });
  assert.equal(transcripts.length, 1);
  h.emit('npc-dialogue:action', { npcId: TASAKAAL, stepId: 'mMumh3' });
  assert.equal(h.quest.getStage(h.player), 13);
  h.emit('npc-dialogue:action', { npcId: TROBIN, stepId: 'vkpouM' });
  assert.equal(h.quest.getStage(h.player), 14);
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.COINS), 2000);
  assert.equal(h.inventory.get(PAGE), 1);
  assert.deepEqual(h.xp.map(([, amount]) => amount), [1500, 500]);
  h.emit('npc-dialogue:action', { npcId: TROBIN, stepId: 'vkpouM' });
  assert.equal(h.inventory.get(PAGE), 1);
  assert.equal(h.xp.length, 2);
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.varbits.get(7856), 14);
  assert.ok(TRAIL_VARBITS.every((id) => (h.varbits.get(id) ?? 0) === 0));
});

test('Ascent of Arceuus: an active A Kingdom Divided owns the Tasakaal only in its 122-137 window', () => {
  const h = setup();
  const akd = registerAkd(h);
  h.quest.setStage(h.player, 14);

  akd.setStage(h.player, AKD_MEETING);
  assert.equal(h.talk(h.core.NpcIdentifiers.KAAL_XIL_DAR), 'The human returns.');
  assert.equal(h.advance(), 'And needs our help again.');

  h.resetDialogue();
  akd.setStage(h.player, AKD_MEETING - 1);
  assert.equal(h.talk(h.core.NpcIdentifiers.KAAL_XIL_DAR), 'The human returns.');
  assert.equal(h.advance(), null, 'outside the window NpcDialogues resolves Ascent post-quest text/menu');

  h.resetDialogue();
  akd.setStage(h.player, AKD_ACCORD);
  assert.equal(h.talk(h.core.NpcIdentifiers.KAAL_XIL_DAR), 'The human returns.');
  assert.equal(h.advance(), null, 'after the window Ascent post-quest owns the Tasakaal again');
});

test('Ascent of Arceuus: page 21770 used on memoirs 21760/21761 records varbit 7917 and replays on login', () => {
  const h = setup();
  h.quest.setStage(h.player, 14);
  h.inventory.set(MEMOIRS, 1);
  h.inventory.set(PAGE, 1);
  const event = {
    player: h.player, usedItemId: PAGE, usedItemIdSlot: 0,
    usedWithItemId: MEMOIRS, usedWithItemSlot: 1, handled: false,
  };
  h.hooks.itemOnItem[0](event);
  assert.equal(event.handled, true);
  assert.equal(h.inventory.get(PAGE) ?? 0, 0, 'the page is consumed');
  assert.equal(h.inventory.get(MEMOIRS), 1, 'the memoir remains');
  assert.equal(h.varbits.get(7917), 1, 'native Arceuus memoir completion varbit is set');
  assert.ok(h.messages.includes("You add an entry to Kharedst's Memoirs."));

  h.varbits.delete(7917);
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.varbits.get(7917), 1, 'login replays the recorded memoir completion varbit');

  const noted = setup();
  noted.quest.setStage(noted.player, 14);
  noted.inventory.set(21761, 1);
  noted.inventory.set(PAGE, 1);
  const notedEvent = {
    player: noted.player, usedItemId: PAGE, usedItemIdSlot: 0,
    usedWithItemId: 21761, usedWithItemSlot: 1, handled: false,
  };
  noted.hooks.itemOnItem[0](notedEvent);
  assert.equal(notedEvent.handled, true);
  assert.equal(noted.inventory.get(PAGE) ?? 0, 0);
  assert.equal(noted.varbits.get(7917), 1);
});

test('Ascent of Arceuus: Lord Trobin replaces a lost page while the player does not own it', () => {
  const h = setup();
  h.quest.setStage(h.player, 14);
  h.inventory.set(MEMOIRS, 1);
  h.varbits.set(7917, 0);

  assert.equal(h.talk(8505), 'Good day friend.');
  assert.match(h.advance() ?? '', /Thank you for helping our people/);
  assert.equal(h.inventory.get(PAGE), 1, 'the canonical lost-page branch grants one page');
  h.resetDialogue();
  assert.equal(h.talk(8505), 'Good day friend.');
  h.advance();
  assert.equal(h.inventory.get(PAGE), 1, 'a second conversation does not grant another page');

  const banked = setup();
  banked.quest.setStage(banked.player, 14);
  banked.inventory.set(MEMOIRS, 1);
  banked.bank.set(PAGE, 1);
  banked.varbits.set(7917, 0);
  assert.equal(banked.talk(8505), 'Good day friend.');
  assert.equal(banked.advance(), null, 'a banked page is still owned, so the lost-page branch is not used');
  assert.equal(banked.inventory.get(PAGE) ?? 0, 0);

  const entered = setup();
  entered.quest.setStage(entered.player, 14);
  entered.inventory.set(MEMOIRS, 1);
  entered.varbits.set(7917, 1);
  assert.equal(entered.talk(8505), 'Good day friend.');
  assert.equal(entered.advance(), null, 'a page already entered in the memoir is not replaced');
  assert.equal(entered.inventory.get(PAGE) ?? 0, 0);
});

test('Ascent of Arceuus: real Karuulm elevator dispatch reaches the Tasakaal and returns', () => {
  const h = setup();
  h.quest.setStage(h.player, 6);
  h.player.isRegistered = () => true;
  h.setLocation(1311, 3807, 0);
  const locHooks = {};
  LocTeleports.register({
    core: h.core,
    persistAttribute() {},
    onObjectInteraction(fn) { locHooks.object = fn; },
    onItemOnObject() {},
    onCustomEvent() {},
    sendMultiChatboxPrompt() {},
  });

  const down = teleports.locs.find((entry) => entry.name === 'karuulm_elevator_down');
  const up = teleports.locs.find((entry) => entry.name === 'karuulm_cave_exit_up');
  assert.deepEqual([down.id, down.x, down.y, down.option, down.to], [KARUULM_ELEVATOR, 1311, 3807, 'Activate', [1311, 10188, 0]]);
  assert.deepEqual([up.id, up.x, up.y, up.option, up.to], [KARUULM_EXIT, 1311, 10185, 'Exit', [1311, 3808, 0]]);
  assert.equal(h.core.RegionManager.canMove(1311, 10188, 1311, 10188, 0, 1, 1, null), true);
  assert.equal(h.core.RegionManager.canMove(1311, 3808, 1311, 3808, 0, 1, 1, null), true);

  const descend = { player: h.player, object: locAt(KARUULM_ELEVATOR, 1311, 3807, 0), objectId: KARUULM_ELEVATOR, clickType: 1, handled: false };
  locHooks.object(descend);
  assert.equal(descend.handled, true);
  runTicks(down.tick);
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], down.to);

  assert.equal(h.talk(h.core.NpcIdentifiers.KAAL_XIL_DAR), 'Human.');
  assert.equal(h.quest.getStage(h.player), 8, 'the real Talk-to path plays the first meeting through the task hand-off');

  h.resetDialogue();
  const ascend = { player: h.player, object: locAt(KARUULM_EXIT, 1311, 10185, 0), objectId: KARUULM_EXIT, clickType: 1, handled: false };
  locHooks.object(ascend);
  assert.equal(ascend.handled, true);
  runTicks(up.tick);
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], up.to);

  const reenter = { player: h.player, object: locAt(KARUULM_ELEVATOR, 1311, 3807, 0), objectId: KARUULM_ELEVATOR, clickType: 1, handled: false };
  locHooks.object(reenter);
  assert.equal(reenter.handled, true);
  runTicks(down.tick);
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], down.to);
});

test('Ascent of Arceuus: the cache Mori transforms own pre- and post-quest dialogue', () => {
  const h = setup();
  const vars = stage => ({ getVarbit: id => id === 7856 ? stage : 0, getVarp: () => 0 });
  const preQuest = CacheDefinitions.resolveNpc(7208, vars(5));
  const postQuest = CacheDefinitions.resolveNpc(7375, vars(14));
  assert.equal(preQuest?.id, 8501, 'pond spawn 7208 transforms to pre-quest Mori through stage 5');
  assert.equal(CacheDefinitions.resolveNpc(7208, vars(14)), undefined, 'the pre-quest parent disappears at completion');
  assert.equal(postQuest?.id, 8502, 'placed parent 7375 transforms to post-quest Mori at stage 14');
  const placedPostQuest = require('../data/definitions/npc-spawns.json').find(spawn => spawn.id === 7375);
  assert.deepEqual([placedPostQuest.x, placedPostQuest.y], [1706, 3799]);

  h.quest.setStage(h.player, 5);
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.spawned.filter((npc) => [8501, 8502].includes(npc.def.id)).length, 0,
    'the quest does not create a duplicate Mori');

  h.quest.setStage(h.player, 14);
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.spawned.filter((npc) => [8501, 8502].includes(npc.def.id)).length, 0,
    'post-quest dialogue uses the canonical transformed spawn');
  assert.equal(h.ascentVariant({ npcId: postQuest.id, player: h.player }), 'standard-dialogue-after-the-ascent-of-arceuus');

  const akd = registerAkd(h);
  akd.setStage(h.player, 150);
  assert.equal(h.ascentVariant({ npcId: postQuest.id, player: h.player }), 'standard-dialogue-after-a-kingdom-divided');
});

test('Ascent of Arceuus: clicking the tower door runs the Tower Mage entry prompt', () => {
  const h = setup();
  const click = h.hooks.objects.at(-1);
  const clickDoor = () => click({
    player: h.player, objectId: 33570, clickType: 1, location: { x: 1596, y: 3820, z: 0 },
  });

  h.quest.setStage(h.player, 2);
  clickDoor();
  assert.ok(h.messages.includes('The Tower of Magic is off limits.'), 'the tower is closed before Mori sends the player');
  assert.equal(h.text(), null, 'no dialogue starts before stage 3');

  h.resetDialogue();
  h.quest.setStage(h.player, 3);
  clickDoor();
  assert.equal(h.text(), 'I need to speak to Lord Arceuus.', 'the door opens the Tower Mage prompt');
  for (let step = 0; step < 8 && h.prompts.length === 0; step++) h.advance();
  const prompt = h.prompts.at(-1);
  assert.ok(prompt, 'the Tower Mage asks for confirmation');
  const yes = prompt.options.find((option) => option.text === 'Yes.');
  assert.ok(yes, 'the prompt offers Yes.');
  yes.pick();
  assert.equal(h.quest.getStage(h.player), 4, '"Yes." enters the tower');

  h.resetDialogue();
  h.quest.setStage(h.player, 4);
  h.setLocation(1596, 3821, 0);
  clickDoor();
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY()], [1596, 3819], 'inside the quest the door is passed');
});

test('Ascent of Arceuus: Kaal-Xil-Dar plays the A Kingdom Divided line once that quest is done', () => {
  const h = setup();
  const akd = registerAkd(h);
  h.quest.setStage(h.player, 14);
  const kaal = h.core.NpcIdentifiers.KAAL_XIL_DAR;

  assert.equal(h.ascentVariant({ npcId: kaal, player: h.player }), 'after-the-ascent-of-arceuus');
  akd.setStage(h.player, 150);
  assert.equal(h.ascentVariant({ npcId: kaal, player: h.player }), 'after-a-kingdom-divided');
});

test('Ascent of Arceuus: a full bag still yields the replacement page', () => {
  const h = setup({ fullBag: true });
  h.quest.setStage(h.player, 14);
  h.inventory.set(MEMOIRS, 1);
  h.varbits.set(7917, 0);

  assert.equal(h.talk(8505), 'Good day friend.');
  assert.match(h.advance() ?? '', /Thank you for helping our people/);
  assert.deepEqual(h.dropped, [PAGE], 'the page is dropped at the player instead of being lost');
  assert.equal(h.inventory.get(PAGE) ?? 0, 0, 'no false success in the bag');
});

test('Ascent of Arceuus: full-bag page drops suppress duplicates until expiry, then recovery is repeatable', () => {
  const h = setup({ fullBag: true });
  const restoreGroundItems = exposeOwnedPageDrops(h);
  try {
  h.quest.setStage(h.player, 14);
  h.inventory.set(MEMOIRS, 1);
  h.varbits.set(7917, 0);

  assert.equal(h.talk(8505), 'Good day friend.');
  assert.match(h.advance() ?? '', /Thank you for helping our people/);
  assert.deepEqual(h.dropped, [PAGE], 'the page is dropped at the player instead of being lost');
  assert.equal(h.inventory.get(PAGE) ?? 0, 0, 'no false success in the bag');

  for (const login of h.hooks.login) login({ player: h.player });
  h.resetDialogue();
  assert.equal(h.talk(8505), 'Good day friend.');
  h.advance();
  assert.deepEqual(h.dropped, [PAGE], 'a still-owned ground page blocks a duplicate after relog');
  assert.equal(h.inventory.get(PAGE) ?? 0, 0);

  h.dropped.length = 0; // the real ground item has expired or was otherwise lost
  h.setFullBag(false);
  h.resetDialogue();
  assert.equal(h.talk(8505), 'Good day friend.');
  h.advance();
  assert.equal(h.inventory.get(PAGE), 1, 'the canonical recovery is available again after genuine loss');
  } finally {
    restoreGroundItems();
  }
});

test('Ascent of Arceuus: a lost page can be reclaimed after relog, but not after memoir insertion', () => {
  const h = setup();
  h.quest.setStage(h.player, 14);
  h.inventory.set(MEMOIRS, 1);
  h.varbits.set(7917, 0);

  assert.equal(h.talk(8505), 'Good day friend.');
  assert.match(h.advance() ?? '', /Thank you for helping our people/);
  assert.equal(h.inventory.get(PAGE), 1, 'the ordinary recovery puts the page in the bag');

  h.inventory.delete(PAGE);
  for (const login of h.hooks.login) login({ player: h.player });
  h.resetDialogue();
  assert.equal(h.talk(8505), 'Good day friend.');
  h.advance();
  assert.equal(h.inventory.get(PAGE), 1, 'the canonical recovery becomes available after losing the page');
});
