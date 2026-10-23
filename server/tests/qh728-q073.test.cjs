// Merlin's Crystal (q073) route contract.
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

test('fresh stage 0 reaches completion through the mandatory Quest Helper legs', () => {
  const h = harness();
  const p = h.player;
  assert.equal(h.quest.getStage(p), 0, 'fresh stage 0');

  // Start.
  assert.equal(h.variant(N.KING_ARTHUR).variant, 'starting-off');
  h.hook(N.KING_ARTHUR, 'quest:merlin-s-crystal:start');
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.configs.get(14), 1, 'varp 14 reflects start');

  // Gawain.
  assert.equal(h.variant(N.SIR_GAWAIN).variant, 'investigating-merlin-s-entrapment-sir-gawain');
  h.choice(N.SIR_GAWAIN, 'Do you know how Merlin got trapped?');
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.configs.get(14), 2);

  // Lancelot.
  assert.equal(h.variant(N.SIR_LANCELOT).variant, 'investigating-keep-le-faye-sir-lancelot');
  h.choice(N.SIR_LANCELOT, 'Any ideas on how to get into Morgan Le Faye\'s stronghold?');
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(p.configs.get(14), 3);

  // Catherby crate into Keep Le Faye.
  p.setLocation(2801, 3442, 0);
  const crate = h.object('Crate', 'Hide-in', O.CRATE_2, 2801, 3442);
  assert.equal(crate.result, true);
  assert.equal(h.transcript().variant, 'infiltrating-the-keep-hiding-in-arhein-s-crate');
  h.action(N.ARHEIN, 'X6UH6e');
  assert.deepEqual(p.moves.at(-1), [2779, 3400, 0], 'the crate delivers the player to the keep');

  // Mordred dies -> Morgan appears, then her offer sets the ritual stage.
  h.setLocation(2770, 3403, 2);
  h.die(N.SIR_MORDRED);
  assert.equal(h.tasks.length, 1, 'Morgan appearance is scheduled');
  h.tasks[0].execute();
  assert.equal(h.transcript().variant, 'inside-keep-le-faye-defeating-sir-mordred');
  assert.ok(h.spawned.some((npc) => npc.getId() === N.MORGAN_LE_FAYE), 'Morgan is spawned for the killer');
  assert.equal(h.variant(N.MORGAN_LE_FAYE).variant, 'inside-keep-le-faye-defeating-sir-mordred');
  h.choice(N.MORGAN_LE_FAYE, 'Tell me how to untrap Merlin and I might.');
  assert.equal(h.quest.getStage(p), 3, 'the information choice alone keeps stage 3');
  assert.equal(p.configs.get(14), 3);
  h.choice(N.MORGAN_LE_FAYE, 'OK I will do all that.');
  assert.equal(h.quest.getStage(p), 4, 'the final acceptance persists stage 4');
  assert.equal(p.configs.get(14), 4);
  assert.ok(!h.spawned.some((npc) => npc.getId() === N.MORGAN_LE_FAYE), 'Morgan vanishes on the closing choice');

  // Prerequisites obtained during the quest.
  h.add(I.BUCKET);
  h.add(I.INSECT_REPELLENT);
  h.add(I.BREAD);
  h.add(I.TINDERBOX);
  h.add(I.BAT_BONES);

  // Beehive: repellent is reusable, bucket becomes wax.
  const repel = h.useOnObject(I.INSECT_REPELLENT, O.BEEHIVE, 'Insect repellent', 'Beehive');
  assert.equal(repel.result, true);
  assert.equal(p.items.get(I.INSECT_REPELLENT), 1, 'insect repellent is not consumed');
  assert.equal(p.getAttribute('quest.merlin-s-crystal:hive-repelled'), true);
  const wax = h.object('Beehive', 'Take-from', O.BEEHIVE, 2762, 3443);
  assert.equal(wax.result, true);
  assert.equal(p.items.get(I.BUCKET) ?? 0, 0, 'the empty bucket is consumed');
  assert.equal(p.items.get(I.BUCKET_OF_WAX), 1);

  // Candle maker trades the wax for the black candle.
  assert.equal(h.variant(N.CANDLE_MAKER).variant, 'obtaining-the-black-candle-returning-to-the-candle-maker');
  h.action(N.CANDLE_MAKER, 'nlk77H');
  assert.equal(p.items.get(I.BUCKET_OF_WAX) ?? 0, 0, 'the bucket of wax is consumed');
  assert.equal(p.items.get(I.BLACK_CANDLE), 1);

  // Lady of the Lake sets the test; the Port Sarim door starts the beggar scene.
  assert.equal(h.variant(N.THE_LADY_OF_THE_LAKE).variant, 'searching-for-excalibur-the-lady-of-the-lake');
  h.choice(N.THE_LADY_OF_THE_LAKE, 'I seek the sword Excalibur.');
  assert.equal(p.getAttribute('quest.merlin-s-crystal:lady-s-test'), true);
  assert.ok(h.spawned.some((npc) => npc.getId() === N.BEGGAR), 'the beggar exists while the test is pending');
  const door = h.emit('door:toggle', {
    objectId: O.DOOR_5,
    option: 'Open',
    clickType: 1,
    location: { x: 3016, y: 3246, z: 0 },
    definition: { getInteractions: () => ['Open'] },
  });
  assert.equal(door.handled, true, 'the quest claims the jeweller door Open');
  assert.equal(h.transcript().variant, 'searching-for-excalibur-attempting-to-enter-the-jewellery-shop');
  assert.equal(h.condition(N.BEGGAR, 'If the player has bread in their inventory:'), true);
  h.action(N.BEGGAR, 'emEYqa');
  assert.equal(p.items.get(I.BREAD) ?? 0, 0, 'the bread is given to the beggar');
  h.action(N.BEGGAR, '4DJqdx');
  assert.equal(p.items.get(I.EXCALIBUR), 1, 'the Lady gifts Excalibur');
  assert.equal(p.getAttribute('quest.merlin-s-crystal:beggar-rewarded'), true);
  assert.ok(!h.spawned.some((npc) => npc.getId() === N.BEGGAR), 'the beggar is removed after the gift');

  // Chaos altar inscription.
  const altar = h.object('Chaos altar', 'Check', O.CHAOS_ALTAR, 3259, 3381);
  assert.equal(altar.result, true);
  assert.equal(p.getAttribute('quest.merlin-s-crystal:read-incantation'), true);
  assert.equal(h.transcript().variant, 'searching-the-altar-for-the-spell');

  // Light the candle and perform the ritual at 2780,3515.
  h.useItem(I.TINDERBOX, I.BLACK_CANDLE);
  assert.equal(p.items.get(I.BLACK_CANDLE) ?? 0, 0);
  assert.equal(p.items.get(I.LIT_BLACK_CANDLE), 1);
  p.setLocation(2780, 3515, 0);
  const drop = h.drop(I.BAT_BONES);
  assert.equal(drop.handled, true, 'the ritual circle claims the bat bones drop');
  assert.equal(p.items.get(I.BAT_BONES) ?? 0, 0, 'the dropped bones are consumed');
  assert.ok(h.spawned.some((npc) => npc.getId() === N.THRANTAX_THE_MIGHTY), 'Thrantax is summoned');
  assert.equal(h.transcript().variant, 'performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-with-a-lit-black-candle-after-reading-the-incantation');
  h.choice(N.THRANTAX_THE_MIGHTY, 'Snarthon Candtrick Termanto');
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(p.configs.get(14), 5);

  // The trapped Merlin is not a Talk-to shortcut; the crystal is smashed with
  // Excalibur, which Quest Helper requires to be wielded.
  const transcriptsBeforeTalk = transcripts.length;
  assert.equal(h.variant(N.MERLIN), null, 'talking to the trapped Merlin does not select the smash transcript');
  assert.equal(transcripts.length, transcriptsBeforeTalk, 'no smash transcript is started by Talk-to');
  assert.equal(h.quest.getStage(p), 5, 'Talk-to without the real action does not advance');
  p.items.delete(I.EXCALIBUR);
  h.wield(I.EXCALIBUR);
  const smash = h.object('Giant crystal', 'Smash', O.GIANT_CRYSTAL, 2767, 3493, 2);
  assert.equal(smash.result, true);
  assert.equal(h.transcript().variant, 'smashing');
  assert.equal(h.condition(N.MERLIN, "If the player doesn't have Excalibur:"), false, 'a wielded Excalibur counts as having it');
  assert.equal(h.condition(N.MERLIN, "If the player has Excalibur and Thrantax's boon:"), true, 'the shatter branch is selected');
  h.action(N.MERLIN, 'q6WlmM');
  assert.equal(h.quest.getStage(p), 6);
  assert.equal(p.configs.get(14), 6);
  assert.equal(h.variant(N.MERLIN).variant, 'smashing-talking-to-merlin-again', 'the freed Merlin keeps his dialogue');

  // Final hand-in.
  assert.equal(h.variant(N.KING_ARTHUR).variant, 'finishing-up');
  h.action(N.KING_ARTHUR, 'pVUc-a');
  assert.equal(h.quest.getStage(p), 7);
  assert.equal(p.configs.get(14), 7, 'completion writes the canonical varp 14 value 7');
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.getAttribute('quest.points'), 6, 'six quest points');
  assert.equal(h.variant(N.KING_ARTHUR).page, 'King Arthur');
  assert.equal(h.variant(N.KING_ARTHUR).variant, 'standard-dialogue-after-completing-merlin-s-crystal');

  // Repeat hand-in grants nothing.
  h.action(N.KING_ARTHUR, 'pVUc-a');
  assert.equal(p.getAttribute('quest.points'), 6, 'repeat completion does not add points');

  // Relog replays the saved completion on the canonical wire.
  p.configs.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.configs.get(14), 7, 'login replay sends varp 14 = 7');
  p.configs.clear();
  h.emit('player:bootstrap-complete', {});
  assert.equal(p.configs.get(14), 7, 'bootstrap replay keeps completion');
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

test('shared NPCs fall back to their own pages outside the quest window', () => {
  const h = harness();
  const p = h.player;
  assert.equal(h.variant(N.CANDLE_MAKER), null, 'candle maker standard dialogue before the quest');
  assert.equal(h.variant(N.THE_LADY_OF_THE_LAKE), null, 'Lady of the Lake standard dialogue before the quest');
  assert.equal(h.variant(N.SIR_LANCELOT), null, 'Sir Lancelot standard dialogue before the start hook');
  assert.equal(h.variant(N.SIR_GAWAIN), null, 'Sir Gawain standard dialogue before the start hook');
  assert.equal(h.variant(N.KING_ARTHUR).variant, 'starting-off');

  h.quest.setStage(p, 3);
  assert.equal(h.variant(N.ARHEIN).variant, 'infiltrating-the-keep-talking-to-arhein');
  h.quest.setStage(p, 4);
  assert.equal(h.variant(N.ARHEIN), null, 'Arhein returns to his own dialogue after the crate ride');
  assert.equal(h.variant(N.CANDLE_MAKER).variant, 'obtaining-the-black-candle-talking-to-the-candle-maker');
  assert.equal(h.variant(N.THE_LADY_OF_THE_LAKE).variant, 'searching-for-excalibur-the-lady-of-the-lake');
  h.quest.setStage(p, 5);
  assert.equal(h.variant(N.CANDLE_MAKER), null, 'candle maker standard dialogue after the candle is made');
  p.items.set(I.EXCALIBUR, 1);
  assert.equal(h.variant(N.THE_LADY_OF_THE_LAKE), null, 'Lady standard dialogue once Excalibur is bound');
  p.items.delete(I.EXCALIBUR);
  assert.equal(h.variant(N.THE_LADY_OF_THE_LAKE).variant, 'searching-for-excalibur-the-lady-of-the-lake', 'a lost sword reopens her test at stage 5');

  h.quest.setStage(p, 7);
  const lady = h.variant(N.THE_LADY_OF_THE_LAKE);
  assert.equal(lady.page, 'The Lady of the Lake');
  assert.equal(lady.variant, 'after-completing-merlin-s-crystal');
  assert.equal(h.variant(N.MERLIN).variant, 'smashing-talking-to-merlin-again');
  assert.equal(h.variant(N.MERLIN_2), null, 'the Holy Grail / King\'s Ransom Merlin keeps his own pages');
});

test('early, wrong and repeat interactions do not grant items or skip stages', () => {
  const h = harness();
  const p = h.player;

  // Crate before Lancelot does not start the keep ride.
  h.quest.setStage(p, 1);
  assert.equal(h.object('Crate', 'Hide-in', O.CRATE_2, 2801, 3442).result, false);
  assert.equal(transcripts.length, 0);

  // Chaos altar before Morgan does not teach the words.
  assert.equal(h.object('Chaos altar', 'Check', O.CHAOS_ALTAR, 3259, 3381).result, false);
  assert.notEqual(p.getAttribute('quest.merlin-s-crystal:read-incantation'), true);

  // Wrong incantation destroys the candle and does not advance.
  h.quest.setStage(p, 4);
  p.items.set(I.LIT_BLACK_CANDLE, 1);
  h.choice(N.THRANTAX_THE_MIGHTY, 'Snarthtrick Candanto Termon');
  assert.equal(p.items.get(I.LIT_BLACK_CANDLE) ?? 0, 0, 'the wrong words destroy the lit candle');
  assert.equal(h.quest.getStage(p), 4, 'the wrong words do not advance the stage');

  // Hammer branch is preferred over the plain no-Excalibur branch.
  p.items.set(I.HAMMER, 1);
  assert.equal(h.condition(N.MERLIN, "If the player doesn't have Excalibur:"), false);
  assert.equal(h.condition(N.MERLIN, "If the player doesn't have Excalibur but has a hammer:"), true);
  p.items.delete(I.HAMMER);
  assert.equal(h.condition(N.MERLIN, "If the player doesn't have Excalibur:"), true);

  // Smashing after the crystal is already gone is idempotent.
  h.quest.setStage(p, 6);
  p.configs.clear();
  assert.equal(h.object('Giant crystal', 'Smash', O.GIANT_CRYSTAL, 2767, 3493).result, true);
  assert.equal(h.quest.getStage(p), 6, 'a repeat smash does not move the stage');
  assert.ok(p.messages.includes('The giant crystal lies shattered.'));
});

test('one-slot recovery keeps the candle and bread trades from dropping rewards', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 4);

  // Full bag with the wax: deleting the wax frees the slot for the candle.
  p.items.set(I.BUCKET_OF_WAX, 1);
  for (let id = 900000; id < 900027; id++) p.items.set(id, 1);
  assert.equal(p.inventory.isFull(), true);
  h.action(N.CANDLE_MAKER, 'nlk77H');
  assert.equal(p.items.get(I.BUCKET_OF_WAX) ?? 0, 0);
  assert.equal(p.items.get(I.BLACK_CANDLE), 1, 'the candle fits into the freed wax slot');

  // Full bag with the bread: the gift fits after the bread is consumed.
  const gift = harness();
  const g = gift.player;
  gift.quest.setStage(g, 4);
  g.setAttribute('quest.merlin-s-crystal:lady-s-test', true);
  g.items.set(I.BREAD, 1);
  for (let id = 910000; id < 910027; id++) g.items.set(id, 1);
  assert.equal(g.inventory.isFull(), true);
  gift.action(N.BEGGAR, 'emEYqa');
  assert.equal(g.items.get(I.BREAD) ?? 0, 0);
  gift.action(N.BEGGAR, '4DJqdx');
  assert.equal(g.items.get(I.EXCALIBUR), 1, 'Excalibur fits into the freed bread slot');
});

test('the jeweller door is not claimed outside the Lady of the Lake test', () => {
  const h = harness();
  const p = h.player;
  const door = () => h.emit('door:toggle', {
    objectId: O.DOOR_5,
    option: 'Open',
    clickType: 1,
    location: { x: 3016, y: 3246, z: 0 },
    definition: { getInteractions: () => ['Open'] },
  });

  h.quest.setStage(p, 4);
  assert.equal(door().handled, false, 'no test pending');
  p.setAttribute('quest.merlin-s-crystal:lady-s-test', true);
  assert.equal(door().handled, true, 'test pending claims the door');
  assert.equal(h.transcript().variant, 'searching-for-excalibur-attempting-to-enter-the-jewellery-shop');
  p.setAttribute('quest.merlin-s-crystal:beggar-rewarded', true);
  p.items.set(I.EXCALIBUR, 1);
  assert.equal(door().handled, false, 'a completed test releases the door');
  p.items.delete(I.EXCALIBUR);
  assert.equal(door().handled, true, 'a lost sword reopens the test');
  h.quest.setStage(p, 7);
  p.setAttribute('quest.merlin-s-crystal:beggar-rewarded', false);
  p.items.set(I.EXCALIBUR, 1);
  assert.equal(door().handled, false, 'a completed quest releases the door');
});


test('Morgan persists stage 4 only after the final acceptance choice', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 3);
  h.die(N.SIR_MORDRED);
  assert.equal(h.tasks.length, 1);
  h.tasks[0].execute();
  h.choice(N.MORGAN_LE_FAYE, 'Tell me how to untrap Merlin and I might.');
  assert.equal(h.quest.getStage(p), 3, 'closing after the first choice remains recoverable at stage 3');
  assert.equal(p.configs.get(14), 3);
  h.choice(N.MORGAN_LE_FAYE, 'Ok then.');
  assert.equal(h.quest.getStage(p), 4, 'the final acceptance advances');
  assert.equal(p.configs.get(14), 4);
});

test('the candle maker never consumes wax without granting a candle', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 4);
  p.items.set(I.BUCKET_OF_WAX, 1);
  p.items.set(I.BLACK_CANDLE, 1);
  h.action(N.CANDLE_MAKER, 'nlk77H');
  assert.equal(p.items.get(I.BUCKET_OF_WAX), 1, 'wax is left untouched with a candle already held');
  assert.equal(p.items.get(I.BLACK_CANDLE), 1, 'no duplicate candle is granted');

  p.items.set(I.LIT_BLACK_CANDLE, 1);
  h.action(N.CANDLE_MAKER, 'nlk77H');
  assert.equal(p.items.get(I.BUCKET_OF_WAX), 1, 'a lit candle also refuses the trade');
  assert.equal(p.items.get(I.BLACK_CANDLE), 1);

  p.items.delete(I.BLACK_CANDLE);
  p.items.delete(I.LIT_BLACK_CANDLE);
  h.action(N.CANDLE_MAKER, 'nlk77H');
  assert.equal(p.items.get(I.BUCKET_OF_WAX) ?? 0, 0, 'a genuine trade still consumes the wax');
  assert.equal(p.items.get(I.BLACK_CANDLE), 1, 'and grants the candle');
});

test('post-quest Lady reclaim respects bank and inventory ownership, coins and capacity', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 7);
  const lady = h.variant(N.THE_LADY_OF_THE_LAKE);
  assert.equal(lady.page, 'The Lady of the Lake');
  assert.equal(lady.variant, 'after-completing-merlin-s-crystal');
  const noSword = 'If the player does not have Excalibur in their bank or inventory:';
  const enough = 'If the player has at least 500 coins in their inventory:';
  const tooPoor = 'If the player does not have at least 500 coins in their inventory:';

  p.items.set(I.EXCALIBUR, 1);
  assert.equal(h.condition(N.THE_LADY_OF_THE_LAKE, noSword), false, 'inventory Excalibur hides the reclaim');
  p.items.delete(I.EXCALIBUR);
  p.bank.set(I.EXCALIBUR, 1);
  assert.equal(h.condition(N.THE_LADY_OF_THE_LAKE, noSword), false, 'bank Excalibur hides the reclaim');
  p.bank.delete(I.EXCALIBUR);

  // A wielded Excalibur is still owned, so the reclaim must not duplicate it.
  h.wield(I.EXCALIBUR);
  assert.equal(h.condition(N.THE_LADY_OF_THE_LAKE, noSword), false, 'a wielded Excalibur hides the reclaim');
  p.items.set(I.COINS, 500);
  h.action(N.THE_LADY_OF_THE_LAKE, 'eytHdp');
  assert.equal(p.items.get(I.COINS), 500, 'no coins are taken while the sword is worn');
  assert.equal(p.items.get(I.EXCALIBUR) ?? 0, 0, 'no duplicate sword is granted while it is worn');
  h.unwield();

  p.items.set(I.COINS, 499);
  assert.equal(h.condition(N.THE_LADY_OF_THE_LAKE, enough), false);
  assert.equal(h.condition(N.THE_LADY_OF_THE_LAKE, tooPoor), true);
  p.configs.clear();
  h.action(N.THE_LADY_OF_THE_LAKE, 'eytHdp');
  assert.equal(p.items.get(I.COINS), 499, 'under 500 coins are not deducted');
  assert.equal(p.items.get(I.EXCALIBUR) ?? 0, 0, 'under 500 coins grant no sword');

  p.items.set(I.COINS, 500);
  assert.equal(h.condition(N.THE_LADY_OF_THE_LAKE, enough), true);
  assert.equal(h.condition(N.THE_LADY_OF_THE_LAKE, tooPoor), false);
  h.action(N.THE_LADY_OF_THE_LAKE, 'eytHdp');
  assert.equal(p.items.get(I.COINS) ?? 0, 0, 'exactly 500 coins are deducted');
  assert.equal(p.items.get(I.EXCALIBUR), 1, 'the sword is granted for 500 coins');

  p.items.delete(I.EXCALIBUR);
  p.items.set(I.COINS, 600);
  p.setFull(true);
  h.action(N.THE_LADY_OF_THE_LAKE, 'eytHdp');
  assert.equal(p.items.get(I.COINS), 600, 'a full bag leaves the coins untouched');
  assert.equal(p.items.get(I.EXCALIBUR) ?? 0, 0, 'a full bag grants no sword');
  assert.ok(p.messages.includes('You need a free inventory space to receive Excalibur.'));
  p.setFull(false);
  h.action(N.THE_LADY_OF_THE_LAKE, 'eytHdp');
  assert.equal(p.items.get(I.COINS), 100, 'the retry deducts 500 after space is freed');
  assert.equal(p.items.get(I.EXCALIBUR), 1, 'the retry grants the sword');

  const exact = harness();
  exact.quest.setStage(exact.player, 7);
  exact.player.items.set(I.COINS, 500);
  for (let id = 920000; id < 920027; id++) exact.player.items.set(id, 1);
  assert.equal(exact.player.inventory.getFreeSlots(), 0);
  exact.action(N.THE_LADY_OF_THE_LAKE, 'eytHdp');
  assert.equal(exact.player.items.get(I.COINS) ?? 0, 0);
  assert.equal(exact.player.items.get(I.EXCALIBUR), 1, 'spending the complete coin stack frees the sword slot');
});

test('a wielded Excalibur answers the smash transcript and shatters the crystal', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 5);
  p.items.set(I.EXCALIBUR, 1);
  p.items.delete(I.EXCALIBUR);
  h.wield(I.EXCALIBUR);

  // The wielded sword answers the smash conditions, so the transcript no longer
  // takes the "your weapon didn't do any damage" branch.
  assert.equal(h.condition(N.MERLIN, "If the player doesn't have Excalibur:"), false);
  assert.equal(h.condition(N.MERLIN, "If the player doesn't have Excalibur but has a hammer:"), false);
  assert.equal(h.condition(N.MERLIN, "If the player has Excalibur but doesn't have Thrantax's boon:"), false);
  assert.equal(h.condition(N.MERLIN, "If the player has Excalibur and Thrantax's boon:"), true);

  const smash = h.object('Giant crystal', 'Smash', O.GIANT_CRYSTAL, 2767, 3493, 2);
  assert.equal(smash.result, true);
  assert.equal(h.transcript().variant, 'smashing');
  h.action(N.MERLIN, 'q6WlmM');
  assert.equal(h.quest.getStage(p), 6, 'the crystal shatters with the wielded sword');
  assert.equal(p.configs.get(14), 6);

  // A hammer in the bag does not steal the branch while the sword is wielded.
  p.items.set(I.HAMMER, 1);
  assert.equal(h.condition(N.MERLIN, "If the player doesn't have Excalibur but has a hammer:"), false);
});

test('a lost Excalibur reopens the Lady of the Lake test and is delivered once', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 5);
  p.setAttribute('quest.merlin-s-crystal:lady-s-test', true);
  p.setAttribute('quest.merlin-s-crystal:beggar-rewarded', true);
  p.items.set(I.EXCALIBUR, 1);

  assert.equal(h.variant(N.THE_LADY_OF_THE_LAKE), null, 'with the sword the Lady has nothing to give');
  assert.equal(h.variant(N.BEGGAR), null, 'the beggar stays gone while the sword is owned');

  // Losing the sword after the ritual reopens the canonical recovery route.
  p.items.delete(I.EXCALIBUR);
  assert.equal(h.variant(N.THE_LADY_OF_THE_LAKE).variant, 'searching-for-excalibur-the-lady-of-the-lake', 'a lost sword reopens her test');
  assert.equal(h.variant(N.BEGGAR).variant, 'searching-for-excalibur-talking-to-the-beggar-again-if-they-were-not-given-bread-initially');
  const door = h.emit('door:toggle', {
    objectId: O.DOOR_5,
    option: 'Open',
    clickType: 1,
    location: { x: 3016, y: 3246, z: 0 },
    definition: { getInteractions: () => ['Open'] },
  });
  assert.equal(door.handled, true, 'the jeweller door reopens the test');
  assert.equal(h.transcript().variant, 'searching-for-excalibur-attempting-to-enter-the-jewellery-shop');

  p.items.set(I.BREAD, 1);
  h.action(N.BEGGAR, 'emEYqa');
  h.action(N.BEGGAR, '4DJqdx');
  assert.equal(p.items.get(I.EXCALIBUR), 1, 'the recovered sword is delivered');
  h.action(N.BEGGAR, '4DJqdx');
  assert.equal(p.items.get(I.EXCALIBUR), 1, 'the delivery is once-only');
  assert.equal(h.variant(N.BEGGAR), null, 'the beggar closes again');
  assert.equal(h.variant(N.THE_LADY_OF_THE_LAKE), null, 'the recovered sword closes the test');

  // The crystal is solvable again.
  const smash = h.object('Giant crystal', 'Smash', O.GIANT_CRYSTAL, 2767, 3493, 2);
  assert.equal(smash.result, true);
  assert.equal(h.condition(N.MERLIN, "If the player has Excalibur and Thrantax's boon:"), true);
  h.action(N.MERLIN, 'q6WlmM');
  assert.equal(h.quest.getStage(p), 6, 'the crystal is solvable again after the loss');
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
