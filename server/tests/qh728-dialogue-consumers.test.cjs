// QH-728: fixed dialogue consumers for six quest plugins.
// From server/: node --test tests/qh728-dialogue-consumers.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { Player } = require('../dist/game/entity/impl/player/Player');
const runtime = require('../plugins/quests/QuestRuntime');
const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
const core = PluginManager.getCoreApi();
const data = require('../data/definitions/npc-dialogues.json');
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function at(page, path) {
  let value = data[page];
  for (const key of path) value = value?.[key];
  return value;
}

function pick(node) {
  return { id: node?.id, type: node?.type, text: node?.text };
}

function makePlayer() {
  const attributes = new Map();
  const items = new Map();
  const messages = [];
  const varbits = new Map();
  const xp = [];
  const prompts = [];
  let location = new core.Location(0, 0, 0);
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    deleteNumber: (id, amount = 1) => { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
    getFreeSlots: () => 28 - items.size,
    isFull: () => inventory.getFreeSlots() <= 0,
    forceAdd: (_player, item) => inventory.adds(item.getId(), item.getAmount()),
  };
  const sender = new Proxy({}, {
    get: (_target, method) => {
      if (method === 'getVarbit') return (id) => varbits.get(id) ?? 0;
      return (...args) => {
        if (method === 'sendVarbit') varbits.set(args[0], args[1]);
        return sender;
      };
    },
  });
  const player = {
    attributes, items, messages, varbits, xp, prompts,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({
      getCombatLevel: () => 99,
      getMaxLevel: () => 99,
      getCurrentLevel: () => 99,
      getExperience: () => 0,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ reset: noop, startDialogues: noop, getCurrent: () => null, isActive: () => false, advance: noop }),
    getLocation: () => location,
    setLocation: (next) => { location = next; },
    moveTo: (next) => { location = next; },
    getMovementQueue: () => ({ setBlockMovement: noop, addSteps: noop, addFirstStep: noop }),
    getPrivateArea: () => null,
    getArea: () => null,
    setArea: noop,
    getSailing: () => ({ boats: [] }),
    isRegistered: () => true,
    sendMessage: (message) => messages.push(message),
    performAnimation: noop,
    performGraphic: noop,
  };
  return player;
}

function register(name, key, overrides = {}) {
  const events = {};
  const hooks = {};
  const spawned = [];
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: (task) => { task.setRunning?.(true); task.callback?.(); }, cancelTasks: noop },
      ...overrides,
    },
    persistAttribute: noop,
    onCustomEvent: (event, handler) => (events[event] ??= []).push(handler),
    emitCustomEvent: (event, payload) => (events[event] ?? []).forEach((handler) => handler(payload)),
    spawnNpc: (definition) => {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getOwner: () => definition.owner,
        getLocation: () => new core.Location(definition.x ?? 0, definition.y ?? 0, definition.z ?? 0),
        isRegistered: () => true,
        getArea: () => npc.area ?? null,
        setArea: (area) => { npc.area = area; },
        moveTo: noop,
        getCombat: () => ({ attack: noop, reset: noop }),
        getHitpoints: () => 10,
        setHitpoints: noop,
        performAnimation: noop,
        performGraphic: noop,
        forceChat: noop,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { npc.removed = true; },
    getWorld: () => ({ getNpcs: () => spawned }),
    getItemOnGroundManager: () => ({ registerLocation: noop, getGroundItem: () => null }),
  }, {
    get: (target, property) => target[property] ?? ((...args) => {
      (hooks[property] ??= []).push(args[0]);
      return undefined;
    }),
  });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return {
    api, events, hooks, spawned,
    quest: runtime.getRegisteredQuests().findLast((entry) => entry.key === key),
    action(player, npcId, stepId, extra = {}) {
      const event = { player, npcId, stepId, handled: false, ...extra };
      for (const handler of events['npc-dialogue:action'] ?? []) handler(event);
      return event;
    },
  };
}

test('fixed transcript nodes are exact messages/actions at the old paths', () => {
  assert.deepEqual(pick(at('Below Ice Mountain', ['variants', 'finishing-up', 4])), {
    id: 'KNloP7', type: 'action', text: 'You find a pile of coins!',
  });

  assert.deepEqual(pick(at('Ned', ['variants', 'standard-dialogue-after-completion-of-dragon-slayer-i', 1, 'options', 1, 'steps', 6, 'options', 0, 'steps', 1, 'steps', 2])), {
    id: 'iAbPH4', type: 'message', text: 'You hand Ned 15 coins. Ned gives you a coil of rope.',
  });
  assert.deepEqual(pick(at('Prince Ali Rescue', ['variants', 'preparations-for-rescue-talking-to-ned', 1, 'options', 1, 'steps', 6, 'options', 0, 'steps', 1, 'steps', 2])), {
    id: 'T0Ll6J', type: 'message', text: 'You hand Ned 15 coins. Ned gives you a coil of rope.',
  });

  assert.deepEqual(pick(at('The Path of Glouphrie', ['variants', 'post-quest-talking-to-hazelmere-to-receive-unused-lamps-if-the-player-has-sufficient-inventory-space', 2, 'steps', 1])), {
    id: 'HCknfU', type: 'message', text: 'Hazelmere has given you some lamps.',
  });
  assert.deepEqual(pick(at('The Path of Glouphrie', ['variants', 'post-quest-talking-to-hazelmere-to-receive-unused-lamps-if-the-player-has-sufficient-inventory-space', 3, 'steps', 1])), {
    id: 'dydZII', type: 'message', text: 'Hazelmere has given you a lamp.',
  });

  const grog = ['variants', 'the-grog-drinking-the-bottle-of-fish-bladder-stout', 1, 'steps', 1, 'options', 0, 'steps'];
  assert.deepEqual(pick(at('Prying Times', [...grog, 0])), { id: 'jR3WLF', type: 'message', text: 'You drink a bottle of fish bladder stout.' });
  assert.deepEqual(pick(at('Prying Times', [...grog, 2])), { id: '0OeEX0', type: 'message', text: '...but as you drink it, something appears to defend it!' });
  assert.deepEqual(pick(at('Prying Times', [...grog, 4])), { id: 'IygfmJ', type: 'message', text: 'Charting complete: Find a sealed crate near the Pandemonium and sample the contents.' });

  assert.deepEqual(pick(at('Secrets of the North', ['variants', 'on-the-trail-talking-to-the-khazard-barman', 2, 'options', 2, 'steps', 8, 'steps', 1])), {
    id: 'WN9Bk8', type: 'message', text: 'You give 100 coins to the barman.',
  });

  assert.deepEqual(pick(at('Beneath Cursed Sands', ['variants', 'cure-me-pox-talking-to-the-high-priest-of-sophanem', 7])), {
    id: 'e-KOmi', type: 'message', text: 'You give the crate to the High Priest.',
  });
  assert.deepEqual(pick(at('Beneath Cursed Sands', ['variants', 'cure-me-pox-returning-to-zahur', 3])), {
    id: 'WBMQxe', type: 'message', text: 'You give the Lily of the Elid to Zahur.',
  });
});

test('BelowIceMountain continues on the new KNloP7 action', () => {
  const h = register('BelowIceMountain', 'below_ice_mountain');
  const event = h.action(makePlayer(), core.NpcIdentifiers.RAMARNO, 'KNloP7');
  assert.equal(event.handled, true);
  assert.equal(event.end, undefined);
});

test('PrinceAliRescue exchanges Ned rope for the new iAbPH4 message', () => {
  const h = register('PrinceAliRescue', 'prince_ali_rescue');
  const player = makePlayer();
  player.items.set(core.ItemIdentifiers.COINS, 15);
  h.action(player, core.NpcIdentifiers.NED, 'iAbPH4');
  assert.equal(player.items.get(core.ItemIdentifiers.COINS), 0);
  assert.equal(player.items.get(core.ItemIdentifiers.ROPE), 1);
});

test('PathOfGlouphrie renders lamp messages and grants once through real NpcDialogues', () => {
  const api = PluginManager.createApi('qh728-path-real-dialogues');
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  require('../plugins/quests/quests/PathOfGlouphrie.Quest')(api);

  const lamps = [
    core.ItemIdentifiers.MAGIC_LAMP_STRENGTH_,
    core.ItemIdentifiers.MAGIC_LAMP_SLAYER_,
    core.ItemIdentifiers.MAGIC_LAMP_THIEVING_,
    core.ItemIdentifiers.MAGIC_LAMP_MAGIC_,
  ];
  const variant = 'post-quest-talking-to-hazelmere-to-receive-unused-lamps-if-the-player-has-sufficient-inventory-space';
  const steps = data['The Path of Glouphrie'].variants[variant].slice(1);
  const branches = data['The Path of Glouphrie'].branches;

  function realPlayer() {
    const p = new Player(null);
    const messages = [];
    const sender = new Proxy({}, {
      get: (target, key) => key === 'getVarbit' ? () => 0 : () => sender,
    });
    p.getPacketSender = () => sender;
    p.sendMessage = text => messages.push(String(text));
    return { p, messages };
  }

  function play(p) {
    const event = { player: p, npcId: core.NpcIdentifiers.HAZELMERE, definition: NpcDefinition.forId(core.NpcIdentifiers.HAZELMERE) };
    startDialogue(api, event, steps, branches, { ...event, pages: [{ page: 'The Path of Glouphrie' }] });
    for (let i = 0; i < 100 && p.getDialogueManager().getCurrent(); i++) {
      if (!p.getDialogueManager().handleResume(231 << 16 | 5, 1)) break;
    }
  }

  const multiple = realPlayer();
  play(multiple.p);
  for (const lamp of lamps) assert.equal(multiple.p.getInventory().getAmount(lamp), 1);
  assert.equal(multiple.messages.filter(text => text === 'Hazelmere has given you some lamps.').length, 1,
    'canonical multiple-lamp message rendered exactly once');

  const single = realPlayer();
  single.p.setAttribute('quest.the_path_of_glouphrie.lamps', 3);
  for (const lamp of lamps.slice(0, 3)) single.p.getInventory().adds(lamp, 1);
  play(single.p);
  for (const lamp of lamps) assert.equal(single.p.getInventory().getAmount(lamp), 1);
  assert.equal(single.messages.filter(text => text === 'Hazelmere has given you a lamp.').length, 1,
    'canonical single-lamp message rendered exactly once');
});

test('PryingTimes applies drink, troll and charting effects on the new message ids', () => {
  const deck = { entered: [], enter(npc) { this.entered.push(npc); } };
  const h = register('PryingTimes', 'prying_times', {
    BoatManager: { getBoatAboard: () => ({ id: 1 }), getDeck: () => deck },
  });
  const drinker = makePlayer();
  drinker.items.set(core.ItemIdentifiers.BOTTLE_OF_FISH_BLADDER_STOUT, 1);
  h.action(drinker, null, 'jR3WLF');
  assert.equal(drinker.items.get(core.ItemIdentifiers.BOTTLE_OF_FISH_BLADDER_STOUT), 0);
  assert.equal(drinker.getAttribute('prying-times:drank-stout'), true);

  const charted = makePlayer();
  h.action(charted, null, 'IygfmJ');
  assert.equal(charted.varbits.get(18585), 1);

  const trolled = makePlayer();
  h.action(trolled, null, '0OeEX0');
  assert.equal(h.spawned.length, 1);
  assert.equal(h.spawned[0].getId(), core.NpcIdentifiers.DRINK_TROLL);
  assert.deepEqual(deck.entered, [h.spawned[0]]);
});

test('BeneathCursedSands consumes the cure crate and advances on e-KOmi', () => {
  const h = register('BeneathCursedSands', 'beneath_cursed_sands');
  const player = makePlayer();
  player.items.set(core.ItemIdentifiers.CURE_CRATE, 1);
  h.quest.setStage(player, 88);
  h.action(player, null, 'e-KOmi');
  assert.equal(player.items.get(core.ItemIdentifiers.CURE_CRATE), 0);
  assert.equal(h.quest.getStage(player), 90);
});
