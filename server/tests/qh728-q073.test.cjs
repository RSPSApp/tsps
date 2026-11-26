// Merlin's Crystal (q073) route contract. The quest's flow itself is tested against the live capture in
// merlins-crystal-capture.test.cjs; this file keeps the transcript-variant, durable-stage and Arhein ownership checks.
// From server/: node --test tests/qh728-q073.test.cjs
//
// The route test starts at fresh stage 0 and drives every mandatory Quest Helper
// leg through the plugin's registered handlers. Dialogue playback is simulated by
// dispatching the choice/action ids exported in npc-dialogues.json ("Merlin's
// Crystal"), not by running the dialogue UI. The recovery/shared-NPC tests
// fixture-set a labelled durable stage and inventory, then dispatch real handlers;
// they prove those handler contracts only, not a natural route.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
// Allow both `node server/tests/qh728-q073.test.cjs` from the repo root and
// `node --test tests/qh728-q073.test.cjs` from server/: the dist path resolver
// keys off the server directory.
process.chdir(path.join(__dirname, '..'));
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;

const transcripts = [];
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const bank = new Map();
  const equipment = new Map();
  const messages = [];
  const configs = new Map();
  const jingles = [];
  const moves = [];
  let location = new core.Location(2763, 3513, 0);
  let full = false;

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => inventory.getAmount(id) > 0,
    adds(id, amount = 1) {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) return inventory;
      items.set(id, inventory.getAmount(id) + amount);
      return inventory;
    },
    forceAdd(_player, item) {
      const id = item.getId();
      if (!items.has(id) && inventory.getFreeSlots() <= 0) return false;
      items.set(id, inventory.getAmount(id) + item.getAmount());
      return true;
    },
    deleteNumber(id, amount = 1) {
      const left = inventory.getAmount(id) - amount;
      if (left > 0) items.set(id, left);
      else items.delete(id);
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter((amount) => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    getItems: () => [...items].filter(([, amount]) => amount > 0).map(([id]) => ({ getId: () => id })),
  };

  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendVarbit(id, value) { configs.set(id, value); return sender; },
    sendJingle(id) { jingles.push(id); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });

  const player = {
    attrs, items, bank, equipment, messages, configs, jingles, moves, inventory,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getBanks: () => [{ getAmount: (id) => bank.get(id) ?? 0, contains: (id) => (bank.get(id) ?? 0) > 0 }],
    getEquipment: () => ({
      get: (slot) => equipment.get(slot),
      getItems: () => [...equipment.values()],
      contains: () => false,
    }),
    getSkillManager: () => ({ addExperiences: noop }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, startDialogues: noop, getCurrent: () => null }),
    getLocation: () => location,
    moveTo: (next) => { moves.push([next.getX(), next.getY(), next.getZ()]); location = next; },
    sendMessage: (message) => messages.push(message),
    setLocation: (x, y, z = 0) => { location = new core.Location(x, y, z); },
    setFull: (value) => { full = value; },
    isPlayer: () => true,
    isRegistered: () => true,
    isPlayerBot: () => false,
    getUsername: () => 'qh728-q073',
    getPrivateArea: () => null,
  };
  return player;
}

function harness(options = {}) {
  transcripts.length = 0;
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const objects = new Map();
  const itemOnItem = [];
  const itemOnObject = [];
  const drops = [];
  const deaths = [];
  const logins = [];
  const logouts = [];
  const zoneEnters = [];
  const spawned = [];
  const removed = [];
  const tasks = [];

  class CountdownTask {
    constructor(player, ticks, run) { Object.assign(this, { player, ticks, run, stopped: false }); }
    stop() { this.stopped = true; }
    execute() { if (!this.stopped) this.run(); }
  }

  const api = new Proxy({
    core: { ...core, CountdownTask, TaskManager: { submit: (task) => tasks.push(task) } },
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onCustomEvent(name, handler) {
      const list = custom.get(name) ?? [];
      list.push(handler);
      custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      for (const handler of custom.get(name) ?? []) handler(event);
    },
    onObjectInteraction(name, actions) { objects.set(name, actions); },
    onItemOnItem(_a, _b, handler) { itemOnItem.push(handler); },
    onItemOnObject(item, target, handler) { itemOnObject.push({ item, target, handler }); },
    onItemDropPolicy(handler) { drops.push(handler); },
    onNpcDeath(handler) { deaths.push(handler); },
    onPlayerLogin(handler) { logins.push(handler); },
    onPlayerLogout(handler) { logouts.push(handler); },
    onPlayerDisconnect(handler) { logouts.push(handler); },
    onZoneEnter(_zone, handler) { zoneEnters.push(handler); },
    spawnNpc(definition) {
      const npc = {
        definition,
        getId: () => definition.id,
        getOwner: () => definition.owner,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        isRegistered: () => true,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      const index = spawned.indexOf(npc);
      if (index >= 0) spawned.splice(index, 1);
      removed.push(npc);
    },
  }, { get: (target, key) => (key in target ? target[key] : noop) });

  require('../plugins/quests/quests/MerlinsCrystal.Quest')(api);
  if (options.currentAffairs) require('../plugins/quests/quests/CurrentAffairs.Quest')(api);
  if (options.oneSmallFavour) {
    runtime.registerQuest(api, {
      key: 'one_small_favour', name: 'One Small Favour', varpId: 9901,
      startedValue: 1, completionValue: 99, questPoints: 0, xpRewards: [],
      rewardItemId: undefined, buildJournal: () => [],
    });
  }
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'merlins_crystal');
  const player = makePlayer();
  const registered = (key) => runtime.getRegisteredQuests().findLast((entry) => entry.key === key);

  const variant = (npcId) => {
    for (const handler of variants) {
      const value = handler({ player, npcId });
      if (value) return value;
    }
    return null;
  };
  const condition = (npcId, text) => {
    for (const handler of conditions) {
      const value = handler({ player, npcId, text });
      if (value !== null && value !== undefined) return value;
    }
    return null;
  };
  const emit = (name, event) => {
    const request = { player, handled: false, ...event };
    for (const handler of custom.get(name) ?? []) handler(request);
    return request;
  };
  const action = (npcId, stepId, extra = {}) => emit('npc-dialogue:action', { npcId, stepId, ...extra });
  const choice = (npcId, option) => emit('npc-dialogue:choice', { npcId, option });
  const hook = (npcId, name) => emit('npc-dialogue:hook', { npcId, hook: name });
  const object = (name, option, objectId, x, y, z = 0) => {
    const handler = objects.get(name)?.[option];
    assert.equal(typeof handler, 'function', `${name} ${option} handler is registered`);
    const event = { player, objectId, location: { x, y, z }, handled: false };
    return { event, result: handler(event) };
  };
  const useOnObject = (itemId, objectId, itemName, targetName) => {
    const event = { player, itemId, objectId, handled: false };
    let result;
    for (const entry of itemOnObject) {
      if (entry.item !== itemName || entry.target !== targetName) continue;
      const value = entry.handler(event);
      if (value === true) result = true;
    }
    return { event, result };
  };
  const useItem = (a, b) => {
    const event = { player, itemId: a, itemId2: b, handled: false };
    for (const handler of itemOnItem) handler(event);
    return event;
  };
  const drop = (itemId) => {
    const event = { player, itemId, handled: false };
    for (const handler of drops) handler(event);
    return event;
  };
  const die = (npcId) => {
    for (const handler of deaths) handler({ player, npc: { getId: () => npcId }, npcId, killer: player });
  };
  const add = (id, amount = 1) => player.items.set(id, (player.items.get(id) ?? 0) + amount);
  const wield = (id) => player.equipment.set(core.Equipment.WEAPON_SLOT, { getId: () => id });
  const unwield = () => player.equipment.delete(core.Equipment.WEAPON_SLOT);
  const transcript = () => transcripts.at(-1);

  return {
    player, quest, registered, bank: player.getBanks()[0],
    variants, conditions, objects, spawned, removed, tasks, add, wield, unwield,
    variant, condition, action, choice,
    hook, object, useOnObject, useItem, drop, die, transcript, emit,
    setFull: (value) => player.setFull(value),
    setLocation: player.setLocation,
  };
}

test('every selected quest variant exists in the generated transcript data', () => {
  const dialogues = require('../data/definitions/npc-dialogues.json');
  const quest = dialogues["Merlin's Crystal"].variants;
  for (const name of [
    'starting-off',
    'starting-off-subsequent-dialogue',
    'investigating-merlin-s-entrapment-sir-gawain',
    'investigating-keep-le-faye-sir-lancelot',
    'infiltrating-the-keep-hiding-in-arhein-s-crate',
    'inside-keep-le-faye-encountering-sir-mordred',
    'inside-keep-le-faye-defeating-sir-mordred',
    'obtaining-the-black-candle-talking-to-the-candle-maker',
    'obtaining-the-black-candle-returning-to-the-candle-maker',
    'searching-for-excalibur-the-lady-of-the-lake',
    'searching-for-excalibur-attempting-to-enter-the-jewellery-shop',
    'searching-for-excalibur-talking-to-the-beggar-again-if-they-were-not-given-bread-initially',
    'searching-the-altar-for-the-spell',
    'performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-with-a-lit-black-candle-after-reading-the-incantation',
    'smashing',
    'smashing-talking-to-merlin-again',
    'finishing-up',
  ]) {
    assert.ok(quest[name], name);
  }
  assert.ok(dialogues['King Arthur'].variants['standard-dialogue-after-completing-merlin-s-crystal']);
  assert.ok(dialogues['The Lady of the Lake'].variants['after-completing-merlin-s-crystal']);
});

test('existing durable stages replay unchanged and completion clears the cache threshold', () => {
  const h = harness();
  const p = h.player;
  for (const stage of [0, 1, 3, 5, 6, 7]) {
    h.quest.setStage(p, stage);
    p.configs.clear();
    runtime.sendQuestVarps({ player: p });
    assert.equal(p.configs.get(14), stage, `saved stage ${stage} replays on varp 14`);
  }
  assert.equal(h.quest.varpValue(7, p), 7);
  assert.equal(h.quest.completionValue, 7, 'cache quest row 93 completion threshold is 7');
});

test('Current Affairs reaches Arhein outside the Merlin crate ride and yields inside it', () => {
  const h = harness({ currentAffairs: true });
  const p = h.player;
  assert.equal(h.registered('current_affairs') != null, true);

  assert.equal(h.variant(N.ARHEIN), 'starting-off-talking-to-arhein', 'Current Affairs owns Arhein at Merlin stage 0');
  h.quest.setStage(p, 1);
  assert.equal(h.variant(N.ARHEIN), 'starting-off-talking-to-arhein', 'an incomplete Merlin stage 1 does not suppress Current Affairs');
  h.quest.setStage(p, 2);
  assert.equal(h.variant(N.ARHEIN), 'starting-off-talking-to-arhein', 'stage 2 does not suppress Current Affairs');
  h.quest.setStage(p, 3);
  assert.equal(h.variant(N.ARHEIN).variant, 'infiltrating-the-keep-talking-to-arhein', 'Merlin owns the stage-3 crate ride');
  h.quest.setStage(p, 4);
  assert.equal(h.variant(N.ARHEIN), 'starting-off-talking-to-arhein', 'stage 4 releases Arhein back to Current Affairs');
  h.quest.setStage(p, 5);
  assert.equal(h.variant(N.ARHEIN), 'starting-off-talking-to-arhein', 'stage 5 releases Arhein back to Current Affairs');
});

test('One Small Favour still owns Arhein in its existing hand-in windows', () => {
  const h = harness({ currentAffairs: true, oneSmallFavour: true });
  const p = h.player;
  const osf = h.registered('one_small_favour');
  assert.ok(osf);
  for (const stage of [12, 13, 28, 29]) {
    osf.setStage(p, stage);
    assert.equal(h.variant(N.ARHEIN), null, `One Small Favour stage ${stage} suppresses Current Affairs`);
  }
  osf.setStage(p, 11);
  assert.equal(h.variant(N.ARHEIN), 'starting-off-talking-to-arhein', 'outside the hand-in windows Current Affairs is reachable');
});
