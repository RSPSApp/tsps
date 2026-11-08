// Witch's House (q127) source contract and recovery tests.
// From server/: node --test tests/qh728-q127.test.cjs
//
// Fixture start: durable stage 0. The cheese, gloves, diary and starting combat
// level are granted by the test and declared where used; every quest transition
// goes through the plugin's registered handlers. Diary/ball ground spawns are
// cache data (ground-items.json 2408 at 2903,3471 and 2407 at 2935,3460), not
// fixture postconditions: the test grants the item only after the handler allows
// the pickup. Live playthrough and the Quest Helper overlay are not covered.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

const transcripts = [];
const books = [];
const originalStartTranscript = runtime.startTranscript;
const originalOpenBook = runtime.openBook;
after(() => { runtime.startTranscript = originalStartTranscript; runtime.openBook = originalOpenBook; });
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};
runtime.openBook = (_player, title, pages) => { books.push({ title, pages }); };

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const BOY = N.BOY;
const MOUSE = N.MOUSE;
const EXPERIMENT_FORMS = [
  N.WITCHS_EXPERIMENT,
  N.WITCHS_EXPERIMENT_SECOND_FORM_,
  N.WITCHS_EXPERIMENT_THIRD_FORM_,
  N.WITCHS_EXPERIMENT_FOURTH_FORM_,
];
const VARP_WITCHS_HOUSE = 226;
const CACHE_COMPLETION_THRESHOLD = 7;
const DOOR_TILE = { x: 2900, y: 3473, z: 0 };
const BACK_DOOR_TILE = { x: 2901, y: 3465, z: 0 };
const SHED_DOOR_TILE = { x: 2934, y: 3463, z: 0 };
const BALL_SPAWN_TILE = { x: 2935, y: 3460, z: 0 };
const EXPERIMENT_TILE = { x: 2935, y: 3462, z: 0 };
const NORA = N.NORA_T_HAGG;

function setup({ combatLevel = 35 } = {}) {
  const locs = [];
  const stubs = {
    ObjectManager: { register(object) { locs.push(object.getId()); }, deregister() {} },
    GameObject: class {
      constructor(id, location, type, rotation) {
        this.id = id;
        this.location = location;
        this.type = type;
        this.rotation = rotation;
      }
      getId() { return this.id; }
      getLocation() { return this.location; }
      getType() { return this.type; }
      getFace() { return this.rotation; }
    },
    ItemDefinition: { forId: () => ({ getName: () => '', isNoted: () => false }) },
  };
  // Delayed work runs on h.tick(); the stubs record what live sends.
  const tasks = [];
  const boxes = [];
  const animations = [];
  const sounds = [];
  const hits = [];
  const levels = new Map();
  stubs.TaskManager = { submit(task) { tasks.push(task); } };
  stubs.CountdownTask = class { constructor(_key, ticks, fn) { this.ticks = ticks; this.fn = fn; } };
  stubs.Sounds = { sendSound(_player, sound) { sounds.push(sound); }, playAreaSound(options) { sounds.push(options); } };
  stubs.DialogueChainBuilder = class { add(entry) { this.entry = entry; return this; } };
  stubs.ItemStatementDialogue = class { constructor(_index, itemId, text) { this.itemId = itemId; this.text = text; } };
  stubs.Projectile = { createProjectile: () => ({ withAngle() { return this; }, withProgress() { return this; }, sendProjectile() {} }) };
  let ballSpawn = true;
  const worldItems = [{
    getItem: () => ({ getId: () => I.BALL }),
    getPosition: () => new core.Location(BALL_SPAWN_TILE.x, BALL_SPAWN_TILE.y, BALL_SPAWN_TILE.z),
  }];
  const questCore = { ...core, ...stubs, World: { getItems: () => ballSpawn ? worldItems : [] } };

  const custom = new Map();
  const variants = [];
  const conditions = [];
  const objectHandlers = [];
  const npcBeforeDeath = [];
  const loginHandlers = [];
  const logoutHandlers = [];
  const itemOnObject = [];
  const itemOnNpc = [];
  const itemActions = [];
  const groundPickup = [];
  const spawned = [];
  const groundItems = [];
  const areas = [];
  const configs = new Map();
  const varbits = new Map();
  const messages = [];
  const itemAmounts = new Map();
  const xp = new Map();
  let combat = combatLevel;
  let location = new core.Location(0, 0, 0);
  let gloves = null;
  let freeSlots = 28;
  let localNpcs = [];
  let nextSpawn = 0;

  const api = new Proxy({
    core: questCore,
    persistAttribute() {},
    onNpcDialogueVariant(handler) { variants.push(handler); },
    onNpcDialogueCondition(handler) { conditions.push(handler); },
    onItemOnNpc(handler) { itemOnNpc.push(handler); },
    onItemOnObject(handler) { itemOnObject.push(handler); },
    onItemAction(handler) { itemActions.push(handler); },
    onObjectInteraction(handler) { objectHandlers.push(handler); },
    onNpcBeforeDeath(handler) { npcBeforeDeath.push(handler); },
    onGroundItemPickup(handler) { groundPickup.push(handler); },
    onPlayerLogin(handler) { loginHandlers.push(handler); },
    onPlayerLogout(handler) { logoutHandlers.push(handler); },
    registerArea(area) { areas.push(area); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      for (const handler of custom.get(name) ?? []) handler(event);
    },
    spawnNpc(spec) {
      const npc = {
        id: spec.id,
        index: nextSpawn++,
        owner: spec.owner,
        ownerOnly: spec.ownerOnly,
        getOwner() { return this.owner; },
        getId() { return this.id; },
        getLocation() { return new core.Location(spec.x, spec.y, spec.z); },
        getSpawnLocation() { return new core.Location(spec.x, spec.y, spec.z); },
        isRegistered() { return true; },
        setMaxHitpoints() { return this; },
        setHitpoints() { return this; },
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      const index = spawned.indexOf(npc);
      if (index !== -1) spawned.splice(index, 1);
    },
    getItemOnGroundManager() {
      return { registerLocation(player, item, location) { groundItems.push({ player, item, location }); } };
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });

  require('../plugins/quests/quests/WitchsHouse.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'witchs_house');

  const inventory = {
    getAmount: (id) => itemAmounts.get(id) ?? 0,
    adds(id, amount = 1) {
      if (freeSlots <= 0) return inventory;
      itemAmounts.set(id, (itemAmounts.get(id) ?? 0) + amount);
      freeSlots -= amount;
      return inventory;
    },
    deleteNumber(id, amount = 1) {
      const taken = Math.min(itemAmounts.get(id) ?? 0, amount);
      itemAmounts.set(id, (itemAmounts.get(id) ?? 0) - taken);
      freeSlots += taken;
      return inventory;
    },
    forceAdd(_player, item) {
      itemAmounts.set(item.getId(), (itemAmounts.get(item.getId()) ?? 0) + item.getAmount());
      return true;
    },
    isFull: () => freeSlots <= 0,
    getFreeSlots: () => freeSlots,
    get: () => null,
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendString(text, uid) { messages.push({ text, uid }); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const attributes = new Map();
  const movement = { blocked: false, setBlockMovement(value) { this.blocked = value; return this; }, reset() { return this; } };
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: (chain) => boxes.push(chain.entry) }),
    performAnimation: (animation) => animations.push(animation.getId?.() ?? animation.id),
    performGraphic() {},
    getMovementQueue: () => movement,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (list) => hits.push(...list.map((hit) => hit.getDamage?.() ?? hit.damage)) }) }),
    getSkillManager: () => ({
      getCombatLevel: () => combat,
      getCurrentLevel: (skill) => levels.get(skill.getIndex()) ?? 99,
      getMaxLevel: () => 99,
      addExperiences(skill, amount) {
        xp.set(skill.getIndex(), (xp.get(skill.getIndex()) ?? 0) + amount);
        return true;
      },
      setCurrentLevel(skill, level) { levels.set(skill.getIndex(), level); },
    }),
    getEquipment: () => ({ get: () => gloves }),
    getLocalNpcs: () => localNpcs,
    getLocation: () => location,
    moveTo(next) { location = next; },
    getUsername: () => 'qh728-q127',
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    isPlayerBot: () => false,
  };

  const variant = (npcId = BOY) => {
    const result = variants.map((handler) => handler({ player, npcId })).find(Boolean);
    return typeof result === 'string' ? { variant: result } : result ?? null;
  };
  const condition = (text) => {
    for (const handler of conditions) {
      const answer = handler({ player, text, stepId: 'ESp3PE' });
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const hook = (name) => {
    for (const handler of custom.get('npc-dialogue:hook') ?? []) {
      handler({ player, npcId: BOY, hook: name });
    }
  };
  const action = (stepId, npcId = BOY) => {
    const event = { player, npcId, stepId, handled: false };
    for (const handler of custom.get('npc-dialogue:action') ?? []) handler(event);
    return event;
  };
  const toggle = (objectId, tile) => {
    const event = { player, objectId, location: { x: tile.x, y: tile.y, z: tile.z ?? 0 }, handled: false };
    for (const handler of custom.get('door:toggle') ?? []) handler(event);
    return event;
  };
  const emitted = [];
  const listen = (name) => {
    const handlers = custom.get(name) ?? [];
    handlers.push((event) => emitted.push({ name, event }));
    custom.set(name, handlers);
  };
  for (const name of ['door:open', 'ladders:climbUp', 'ladders:climbDown']) listen(name);
  const tick = (count = 1) => {
    for (let n = 0; n < count; n++) {
      for (const task of [...tasks]) {
        if (--task.ticks > 0) continue;
        tasks.splice(tasks.indexOf(task), 1);
        task.fn();
      }
    }
  };
  const object = (objectId, { location: tile = location, face = 0, type = 0, option } = {}) => {
    const at = new core.Location(
      tile.getX?.() ?? tile.x,
      tile.getY?.() ?? tile.y,
      tile.getZ?.() ?? tile.z,
    );
    const event = {
      player,
      objectId,
      object: { getType: () => type, getFace: () => face, getLocation: () => at },
      location: { x: at.getX(), y: at.getY(), z: at.getZ() },
      clickType: 1,
      option,
      handled: false,
    };
    for (const handler of objectHandlers) {
      handler(event);
      if (event.handled) break;
    }
    return event;
  };
  const onObject = (itemId, objectId, extra = {}) => {
    const event = { player, itemId, objectId, handled: false, ...extra };
    for (const handler of itemOnObject) handler(event);
    return event;
  };
  const onNpc = (itemId, npcId, target = spawned.find(npc => npc.id === npcId)) => {
    const event = { player, itemId, npcId, target, handled: false };
    for (const handler of itemOnNpc) handler(event);
    return event;
  };
  const itemAction = (itemId, option = 'Read') => {
    const event = { player, itemId, slot: 0, clickType: 1, option, handled: false };
    for (const handler of itemActions) handler(event);
    return event;
  };
  const pickup = (groundItemId, tile = location) => {
    const event = {
      player,
      groundItemId,
      groundItem: { getId: () => groundItemId },
      location: { x: tile.getX?.() ?? tile.x, y: tile.getY?.() ?? tile.y, z: tile.getZ?.() ?? tile.z },
      handled: false,
    };
    for (const handler of groundPickup) handler(event);
    return event;
  };
  const beforeDeath = (npc) => {
    const event = { npc, preventDeath: false };
    for (const handler of npcBeforeDeath) handler(event);
    return event;
  };
  const processAreas = () => {
    const mobile = { isPlayer: () => true, getAsPlayer: () => player };
    for (const area of areas) area.process(mobile);
  };

  return {
    quest, player, attributes, itemAmounts, configs, varbits, messages, spawned, groundItems, xp, areas,
    boxes, animations, sounds, hits, levels, emitted, movement, custom, locs,
    variant, condition, hook, action, object, onObject, onNpc, itemAction, pickup, beforeDeath, processAreas,
    toggle, tick,
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getLocation: () => location,
    setGloves(item) { gloves = item; },
    setFreeSlots(value) { freeSlots = value; },
    setLocalNpcs(list) { localNpcs = list; },
    setBallSpawnPresent(value) { ballSpawn = value; },
    give(id, amount = 1) { itemAmounts.set(id, (itemAmounts.get(id) ?? 0) + amount); },
    setCombatLevel(value) { combat = value; },
    setStage(value) { attributes.set('quest.witchs_house.stage', value); },
    login() { for (const handler of loginHandlers) handler({ player }); },
    logout() { for (const handler of logoutHandlers) handler({ player }); },
  };
}

function assertTranscript(variant) {
  assert.equal(transcripts.at(-1)?.variant, variant);
}

test('fresh stage 0 follows the mandatory route and completes on varp 226 = 7', () => {
  const h = setup();
  const { quest, player } = h;
  const stage = () => quest.getStage(player);
  const lastBox = () => h.boxes.at(-1);

  assert.equal(stage(), 0);
  assert.equal(h.variant()?.variant, 'getting-started');
  assert.equal(h.condition('If the player is below level 10 combat:'), false);

  // The front door refuses before the quest starts and, going in, before the key is found.
  h.setLocation(DOOR_TILE.x, DOOR_TILE.y);
  assert.equal(h.toggle(O.DOOR_102, DOOR_TILE).handled, true);
  assert.ok(h.messages.some((line) => String(line).includes('rude to break into this house')));

  h.hook('quest:witch-s-house:start');
  assert.equal(stage(), 1);
  assert.equal(h.configs.get(VARP_WITCHS_HOUSE), 1);
  assert.equal(h.variant()?.variant, 'getting-started-talking-to-him-again');

  // Live tick 129: a game message only, no player line.
  assert.equal(h.toggle(O.DOOR_102, DOOR_TILE).handled, true);
  assert.equal(h.messages.at(-1), 'This door is locked.');

  // Potted plant: the floor reach and an item box with the key; the repeat search keeps one key.
  h.object(O.POTTED_PLANT_3);
  assert.equal(h.itemAmounts.get(I.DOOR_KEY), 1);
  assert.equal(h.animations.at(-1), 827);
  assert.deepEqual([lastBox().itemId, lastBox().text], [I.DOOR_KEY, 'You find a key hidden under the flower pot.']);
  h.object(O.POTTED_PLANT_3);
  assert.equal(h.itemAmounts.get(I.DOOR_KEY), 1);
  assertTranscript('the-witch-s-house-searching-the-plant-pot-for-the-key-searching-the-plant-pot-with-a-key-already');

  // With the key the door is left to Doors' pass-through gate (no teleport here).
  assert.equal(h.toggle(O.DOOR_102, DOOR_TILE).handled, false);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY()], [DOOR_TILE.x, DOOR_TILE.y]);
  // Leaving is always allowed.
  h.setLocation(2901, 3473);
  assert.equal(h.toggle(O.DOOR_102, DOOR_TILE).handled, false);

  // Back door from the house: locked until the mouse mechanism is used (tick 295).
  h.setLocation(BACK_DOOR_TILE.x, BACK_DOOR_TILE.y + 1);
  assert.equal(h.toggle(O.DOOR_103, BACK_DOOR_TILE).handled, true);
  assert.equal(h.messages.at(-1), 'The door is locked.');
  assertTranscript('the-witch-s-house-attempting-to-open-the-garden-door-without-unlocking-it');

  // Basement ladders hand the climb to Ladders with the live landings (ticks 189, 263).
  const climb = (objectId) => {
    const request = { player, objectId, handled: false };
    for (const handler of h.custom.get('ladders:climb') ?? []) handler(request);
    assert.equal(request.handled, true);
  };
  h.setLocation(2907, 3475);
  climb(O.LADDER_322);
  const down = h.emitted.at(-1);
  assert.equal(down.name, 'ladders:climbDown');
  assert.deepEqual([down.event.destination.getX(), down.event.destination.getY()], [2906, 9876]);
  climb(O.LADDER_321);
  const up = h.emitted.at(-1);
  assert.equal(up.name, 'ladders:climbUp');
  assert.deepEqual([up.event.destination.getX(), up.event.destination.getY()], [2906, 3476]);

  // The electrified gate shocks bare hands a tick after the message; gloves let Doors open it.
  h.setLocation(2903, 9874);
  const gate = { x: 2902, y: 9874, z: 0 };
  assert.equal(h.toggle(O.GATE_66, gate).handled, true);
  assert.equal(h.messages.at(-1), 'As your hands touch the gate you feel a shock.');
  assert.equal(h.hits.length, 0);
  h.tick();
  assert.deepEqual(h.hits, [19], 'a fifth of 99 Hitpoints');
  h.setGloves({ getId: () => I.LEATHER_GLOVES });
  assert.equal(h.toggle(O.GATE_66, gate).handled, false);

  // Opening the cupboard gives the magnet (stage 1 -> 2); a search of the open one keeps one magnet.
  h.setLocation(2899, 9873);
  h.object(O.CUPBOARD_24, { location: { x: 2898, y: 9873, z: 0 }, type: 10 });
  assert.equal(h.itemAmounts.get(I.MAGNET) ?? 0, 0, 'the cupboard opens a tick after the reach');
  h.tick();
  assert.equal(h.itemAmounts.get(I.MAGNET), 1);
  assert.equal(stage(), 2);
  assert.equal(h.animations.at(-1), 542);
  assert.deepEqual([lastBox().itemId, lastBox().text], [I.MAGNET, 'You find a magnet in the cupboard.']);
  h.object(O.CUPBOARD_25, { location: { x: 2898, y: 9873, z: 0 }, type: 10, option: 'Search' });
  assert.equal(h.itemAmounts.get(I.MAGNET), 1);
  assertTranscript('the-witch-s-house-searching-the-cupboard-for-the-magnet-searching-the-cupboard-again-with-a-magnet-already');

  // Cheese on the mouse hole: the reach, then the mouse a tick later; the magnet unlocks the back door.
  h.give(I.CHEESE, 1);
  h.setLocation(2903, 3467);
  h.onObject(I.CHEESE, 2870);
  assert.equal(h.itemAmounts.get(I.CHEESE) ?? 0, 0);
  assert.equal(h.animations.at(-1), 827);
  assert.ok(!h.spawned.some((npc) => npc.id === MOUSE), 'the mouse is not out yet');
  h.tick();
  const mouse = h.spawned.find((npc) => npc.id === MOUSE);
  assert.ok(mouse, 'the mouse hole spawns the quest mouse');
  assertTranscript('the-witch-s-house-after-dropping-cheese-in-front-of-the-mouse-hole');
  h.onNpc(I.MAGNET, MOUSE);
  assert.equal(h.itemAmounts.get(I.MAGNET) ?? 0, 0);
  assert.equal(stage(), 3);
  assert.ok(!h.spawned.includes(mouse), 'the mouse leaves after the magnet is used');
  assertTranscript('the-witch-s-house-using-a-magnet-on-the-mouse');
  h.setLocation(BACK_DOOR_TILE.x, BACK_DOOR_TILE.y + 1);
  assert.equal(h.toggle(O.DOOR_103, BACK_DOOR_TILE).handled, false);

  // Reading the diary opens the captured book and counts as read at once (tick 357).
  h.give(I.DIARY, 1);
  const read = books.length;
  h.itemAction(I.DIARY, 'Read');
  assert.equal(stage(), 5);
  assert.equal(books.length, read + 1);
  assert.equal(books.at(-1).title, "Witches' Diary");
  assert.equal(books.at(-1).pages.length, 4);
  assert.equal(books.at(-1).pages[2][66], 'hidden the key to the shed in');
  assert.equal(h.animations.at(-1), 1350);

  // Fountain shed key, repeat search keeps a single key; both are item boxes (ticks 603, 608).
  h.object(O.FOUNTAIN_4);
  assert.equal(h.itemAmounts.get(I.KEY_9), 1);
  assert.equal(lastBox().itemId, I.KEY_9);
  assert.ok(lastBox().text.startsWith('You search for the secret compartment'));
  h.object(O.FOUNTAIN_4);
  assert.equal(h.itemAmounts.get(I.KEY_9), 1);
  assert.equal(lastBox().text, 'You already have the key that was in the secret compartment in this fountain.');

  // Shed door: locked without the key, then the way in spawns the first experiment form.
  h.setLocation(2933, 3463);
  const key = h.itemAmounts.get(I.KEY_9);
  h.itemAmounts.set(I.KEY_9, 0);
  assert.equal(h.toggle(O.DOOR_104, SHED_DOOR_TILE).handled, true);
  assert.equal(h.messages.at(-1), 'The shed door is locked.');
  h.itemAmounts.set(I.KEY_9, key);
  assert.equal(h.toggle(O.DOOR_104, SHED_DOOR_TILE).handled, false);
  assert.ok(h.spawned.some((npc) => npc.id === EXPERIMENT_FORMS[0]), 'entering the shed spawns the experiment');
  h.setLocation(SHED_DOOR_TILE.x + 1, SHED_DOOR_TILE.y);

  // All four forms; the first three hand over to the next form without dying.
  const forms = ['The shapeshifter turns into a spider!', 'The shapeshifter turns into a bear!',
    'The shapeshifter turns into a wolf!', 'You finally kill the shapeshifter once and for all.'];
  for (let index = 0; index < EXPERIMENT_FORMS.length; index++) {
    const npc = h.spawned.find((entry) => entry.id === EXPERIMENT_FORMS[index]);
    assert.ok(npc, `form ${index + 1} is present`);
    const event = h.beforeDeath(npc);
    assert.equal(h.messages.at(-1), forms[index]);
    if (index < EXPERIMENT_FORMS.length - 1) {
      assert.equal(event.preventDeath, true);
      assert.equal(stage(), 5);
      assert.ok(!h.spawned.includes(npc));
    } else {
      assert.equal(event.preventDeath, false);
      assert.equal(stage(), 6);
      assert.equal(h.configs.get(VARP_WITCHS_HOUSE), 6);
    }
  }

  // Ball pickup is allowed once the experiment is dead; the core pickup grants it.
  const pickup = h.pickup(I.BALL, BALL_SPAWN_TILE);
  assert.notEqual(pickup.handled, true);
  h.give(I.BALL, 1);

  // The hand-in takes only the ball; the keys and the diary stay (tick 1253).
  assert.equal(h.variant()?.variant, 'finishing-up');
  h.action('uyv8q6');
  assert.equal(stage(), 7);
  assert.equal(h.configs.get(VARP_WITCHS_HOUSE), CACHE_COMPLETION_THRESHOLD);
  assert.equal(h.xp.get(core.Skill.HITPOINTS.getIndex()), 6325);
  assert.equal(h.player.getAttribute('quest.points'), 4);
  assert.equal(h.itemAmounts.get(I.BALL) ?? 0, 0);
  assert.equal(h.itemAmounts.get(I.DIARY), 1);
  assert.equal(h.itemAmounts.get(I.DOOR_KEY), 1);
  assert.equal(h.itemAmounts.get(I.KEY_9), 1);
  assert.ok(h.messages.some((line) => String(line).includes("Congratulations, you've completed a quest")));

  // Repeating the hand-in never duplicates the reward.
  h.give(I.BALL, 1);
  h.action('uyv8q6');
  assert.equal(h.xp.get(core.Skill.HITPOINTS.getIndex()), 6325);
  assert.equal(h.player.getAttribute('quest.points'), 4);

  // Canonical post-quest Boy dialogue, and login resends the durable completion wire.
  assert.equal(h.variant()?.page, 'Boy');
  assert.equal(h.variant()?.variant, 'after-witch-s-house');
  h.configs.clear();
  h.login();
  assert.equal(h.configs.get(VARP_WITCHS_HOUSE), CACHE_COMPLETION_THRESHOLD);
  assert.equal(stage(), 7);
  assert.ok(stage() >= CACHE_COMPLETION_THRESHOLD, 'the transmitted value meets cache DB table 0 column 19');
});

test('the helper grabBall fallback spawns the experiment after a relog inside the shed', () => {
  const h = setup();
  const { quest, player } = h;
  h.setStage(3);
  h.setLocation(EXPERIMENT_TILE.x, EXPERIMENT_TILE.y);
  assert.equal(h.spawned.filter((npc) => EXPERIMENT_FORMS.includes(npc.id)).length, 0);

  const first = h.pickup(I.BALL, BALL_SPAWN_TILE);
  assert.equal(first.handled, true, 'the early ball pickup is still blocked');
  assert.equal(quest.getStage(player), 3, 'the attempt does not advance the durable stage');
  const spawned = h.spawned.filter((npc) => EXPERIMENT_FORMS.includes(npc.id));
  assert.equal(spawned.length, 1, "the helper's grabBall fallback spawns one experiment");
  assert.equal(spawned[0].id, EXPERIMENT_FORMS[0]);
  assert.ok(h.messages.some((line) => String(line).includes('shapeshifter')));
  // 1 + 6% of 99 off Attack, Strength and Defence.
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE]) {
    assert.equal(h.levels.get(skill.getIndex()), 93);
  }

  const second = h.pickup(I.BALL, BALL_SPAWN_TILE);
  assert.equal(second.handled, true);
  assert.equal(h.spawned.filter((npc) => EXPERIMENT_FORMS.includes(npc.id)).length, 1, 'no duplicate experiment');
});

test('the level 10 start warning condition follows the player combat level', () => {
  const h = setup({ combatLevel: 5 });
  assert.equal(h.condition('If the player is below level 10 combat:'), true);
  h.setCombatLevel(10);
  assert.equal(h.condition('If the player is below level 10 combat:'), false);
});

test('logout removes the owner-only fight NPCs so a relog cannot leave a hidden duplicate', () => {
  const h = setup();
  h.setStage(3);
  h.setLocation(2933, 3463);
  h.give(I.KEY_9, 1);
  h.toggle(O.DOOR_104, SHED_DOOR_TILE);
  assert.equal(h.spawned.filter((npc) => EXPERIMENT_FORMS.includes(npc.id)).length, 1);
  h.logout();
  assert.equal(h.spawned.filter((npc) => EXPERIMENT_FORMS.includes(npc.id)).length, 0);
});

test('the basement boxes supply leather gloves only in-quest, once, and with inventory space', () => {
  const h = setup();
  const BOXES = 24692;
  const boxes = { x: 2899, y: 9871, z: 0 };
  h.setLocation(2901, 9873);

  // Stage 0 is not in-quest; the boxes are left to default handling.
  const before = h.object(BOXES, { location: boxes });
  assert.equal(before.handled, false);
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES) ?? 0, 0);

  // The player must be in the basement, not just clicking the object id.
  h.setStage(1);
  h.setLocation(2905, 3460);
  h.object(BOXES, { location: boxes });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES) ?? 0, 0);

  // The west room boxes hand out one pair.
  h.setLocation(2901, 9873);
  h.object(BOXES, { location: boxes });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES), 1);
  h.object(BOXES, { location: boxes });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES), 1);
  h.itemAmounts.set(I.LEATHER_GLOVES, 0);
  h.object(BOXES, { location: { x: 2899, y: 9872, z: 0 } });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES), 1);

  // Worn gloves count as already having them; a full inventory blocks the pair.
  h.itemAmounts.set(I.LEATHER_GLOVES, 0);
  h.setGloves({ getId: () => I.LEATHER_GLOVES });
  h.object(BOXES, { location: boxes });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES) ?? 0, 0);
  h.setGloves(null);
  h.setFreeSlots(0);
  h.object(BOXES, { location: boxes });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES) ?? 0, 0);
  assert.ok(h.messages.some((line) => String(line).includes("couldn't hold all those items")));

  // A completed quest no longer hands out the quest gloves.
  h.setFreeSlots(28);
  h.setStage(7);
  h.object(BOXES, { location: boxes });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES) ?? 0, 0);
});

test('every cache box placement in the basement hands out the gloves, the east room before the gate', () => {
  // Cache Boxes (24692) placements, with the room the player has to stand in.
  const placements = [
    { x: 2899, y: 9871, room: 'west' },
    { x: 2899, y: 9872, room: 'west' },
    { x: 2900, y: 9872, room: 'west' },
    { x: 2905, y: 9872, room: 'east' },
    { x: 2906, y: 9872, room: 'east' },
    { x: 2908, y: 9873, room: 'east' },
  ];
  const stand = { west: [2898, 9872], east: [2907, 9873] };

  for (const box of placements) {
    const h = setup();
    h.setStage(1);
    h.setLocation(...stand[box.room]);
    const event = h.object(24692, { location: { x: box.x, y: box.y, z: 0 } });
    assert.equal(event.handled, true, `the box at ${box.x},${box.y} is handled`);
    assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES), 1, `the box at ${box.x},${box.y} hands out a pair`);
    assert.ok(h.messages.some((line) => String(line).includes('leather gloves')));
  }
});

test('the east room boxes are reachable before the electric gate and the west room cannot search them', () => {
  const h = setup();
  h.setStage(1);

  // The player came down the ladder into the east room: the boxes there serve the
  // gloves, which is what the helper's gate step needs before the gate is opened.
  h.setLocation(2907, 9876);
  const east = h.object(24692, { location: { x: 2905, y: 9872, z: 0 } });
  assert.equal(east.handled, true);
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES), 1);

  // Behind the gate the west room is a different room: its boxes are not the
  // source, the east room is.
  const other = setup();
  other.setStage(1);
  other.setLocation(2898, 9872);
  const cross = other.object(24692, { location: { x: 2905, y: 9872, z: 0 } });
  assert.equal(cross.handled, false, 'the west room cannot search the east room box');
  assert.equal(other.itemAmounts.get(I.LEATHER_GLOVES) ?? 0, 0);
});

test('the gloves are handed out once, and a lost pair can be searched for again', () => {
  const h = setup();
  h.setStage(1);
  h.setLocation(2907, 9873);

  h.object(24692, { location: { x: 2905, y: 9872, z: 0 } });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES), 1);

  // A second box does not hand out a second pair.
  h.object(24692, { location: { x: 2906, y: 9872, z: 0 } });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES), 1);
  assert.equal(h.messages.at(-1), 'You search the boxes but find nothing.');

  // Losing the pair leaves the boxes able to give it back.
  h.itemAmounts.set(I.LEATHER_GLOVES, 0);
  h.object(24692, { location: { x: 2908, y: 9873, z: 0 } });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES), 1);
});

test('a full inventory blocks the boxes and the cupboard without persisting progress', () => {
  const h = setup();
  h.setStage(1);

  // The boxes yield nothing while the bag is full.
  h.setLocation(2907, 9873);
  h.setFreeSlots(0);
  h.object(24692, { location: { x: 2905, y: 9872, z: 0 } });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES) ?? 0, 0);
  assert.ok(h.messages.some((line) => String(line).includes("couldn't hold all those items")));

  // The cupboard neither gives the magnet nor advances the stage while it is full.
  h.setLocation(2899, 9873);
  const before = h.boxes.length;
  h.object(O.CUPBOARD_24);
  h.tick();
  assert.equal(h.itemAmounts.get(I.MAGNET) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 1, 'the stage stays at the started value');
  assert.equal(h.boxes.length, before, 'the magnet box does not show');

  // Making room lets the open cupboard's search succeed.
  h.setFreeSlots(28);
  h.object(O.CUPBOARD_25, { option: 'Search' });
  assert.equal(h.itemAmounts.get(I.MAGNET), 1);
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.boxes.at(-1).text, 'You find a magnet in the cupboard.');

  h.itemAmounts.set(I.LEATHER_GLOVES, 0);
  h.setLocation(2907, 9873);
  h.object(24692, { location: { x: 2905, y: 9872, z: 0 } });
  assert.equal(h.itemAmounts.get(I.LEATHER_GLOVES), 1);
});

test('a full bag drops the plant pot key on the floor and the fountain can retry', () => {
  const h = setup(); h.setStage(5); h.setFreeSlots(0);
  const count = h.boxes.length;
  h.setLocation(2900, 3473);
  h.object(O.POTTED_PLANT_3);
  // Live tick 144: the key lands on the player's tile and the item box still shows.
  assert.equal(h.itemAmounts.get(I.DOOR_KEY) ?? 0, 0);
  assert.equal(h.groundItems.length, 1);
  assert.equal(h.groundItems[0].item.getId(), I.DOOR_KEY);
  assert.deepEqual([h.groundItems[0].location.getX(), h.groundItems[0].location.getY()], [2900, 3473]);
  assert.equal(h.boxes.length, count + 1);
  h.object(O.FOUNTAIN_4);
  assert.equal(h.itemAmounts.get(I.KEY_9) ?? 0, 0);
  assert.equal(h.boxes.length, count + 1, 'no key-found box before an actual grant');
  h.setFreeSlots(2); h.object(O.FOUNTAIN_4);
  assert.equal(h.itemAmounts.get(I.KEY_9), 1);
});

test('the shed key item-use route opens the shed and a foreign mouse cannot unlock the back door', () => {
  const h = setup(); h.setStage(5); h.give(I.KEY_9); h.setLocation(2933, 3463);
  const at = new core.Location(2934, 3463, 0);
  const used = h.onObject(I.KEY_9, O.DOOR_104, {
    object: { getType: () => 0, getFace: () => 0, getLocation: () => at },
    location: { x: 2934, y: 3463, z: 0 },
  });
  assert.equal(used.handled, true);
  assert.equal(h.emitted.at(-1).name, 'door:open', 'Doors opens the shed door');
  assert.ok(h.spawned.some(npc => npc.id === EXPERIMENT_FORMS[0]));

  const m = setup(); m.setStage(2); m.give(I.MAGNET); m.give(I.CHEESE);
  m.onObject(I.CHEESE, 2870);
  m.tick();
  m.onNpc(I.MAGNET, MOUSE, { getId: () => MOUSE });
  assert.equal(m.quest.getStage(m.player), 2);
  assert.equal(m.itemAmounts.get(I.MAGNET), 1);
  m.onNpc(I.MAGNET, MOUSE);
  assert.equal(m.quest.getStage(m.player), 3);
});

/** A scripted Nora for the garden Area: her tile, the step she takes, and what she says. */
function nora(x) {
  const said = [];
  const npc = {
    x,
    said,
    isNpc: () => true,
    getId: () => NORA,
    getAsNpc: () => npc,
    y: 3463,
    scripted: false,
    queued: 0,
    blocked: false,
    setScriptedMovement(value) { npc.scripted = value; },
    getLocation: () => new core.Location(npc.x, npc.y, 0),
    getMovementQueue: () => ({
      size: () => npc.queued,
      isStepBlocked: () => npc.blocked,
      walkStep(dx, dy) { npc.x += dx; npc.y += dy; },
      reset() { npc.queued = 0; npc.blocked = false; },
    }),
    setPositionToFace() {},
    forceChat: (text) => said.push(text),
    performGraphic() {},
  };
  return npc;
}

function garden(h) {
  const area = h.areas[0];
  area.getPlayers = () => [h.player];
  return area;
}

test('Nora walks 2904-2930 a tile a tick and turns at both ends without waiting', () => {
  const h = setup();
  const area = garden(h);
  area.getPlayers = () => [];
  const witch = nora(2904);
  const path = [];
  for (let tick = 0; tick < 60; tick++) { area.process(witch); path.push(witch.x); }
  assert.equal(Math.max(...path), 2930);
  assert.equal(Math.min(...path), 2904);
  // Capture turnarounds (ticks 461, 487): ...2929, 2930, 2929... and ...2905, 2904, 2905...
  const east = path.indexOf(2930);
  assert.deepEqual(path.slice(east - 1, east + 2), [2929, 2930, 2929]);
  const west = path.indexOf(2904, east);
  assert.deepEqual(path.slice(west - 1, west + 2), [2905, 2904, 2905]);
});

test("Nora's sight follows the capture: 3 tiles, low hedges only, whichever way she walks", () => {
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2915, 3463);
  // [Nora x after her step, player tile the tick before, caught?] from capture 20261108T030409.
  const cases = [
    [2924, [2921, 3460], true], // tick 409
    [2929, [2926, 3460], true], // tick 513
    [2915, [2912, 3460], true], // tick 952
    [2916, [2919, 3460], true], // tick 1010: behind her as she walks west
    [2925, [2921, 3460], false], // tick 407: 4 tiles away
    [2924, [2924, 3460], false], // tall hedge straight in front of the player
    [2920, [2917, 3460], false], // tall hedge in the player's column, low one on the line
    [2918, [2922, 3466], false], // tick 636: north path, 4 tiles
    [2919, [2921, 3466], false], // tick 635: north path, tall hedge in front
    [2930, [2933, 3464], false], // tick 1106: the shed corner hedge on the line
  ];
  for (const [x, [px, py], caught] of cases) {
    const h = setup();
    h.setStage(5);
    h.setLocation(px, py);
    // A fresh patrol starts eastward: she steps onto x, then looks.
    const witch = nora(x - 1);
    const area = garden(h);
    area.process(witch);
    assert.equal(witch.x, x);
    assert.equal(witch.said[0] === 'Stop! Thief!', caught, `Nora ${x} -> player ${px},${py}`);
  }
});

test('a catch takes the ball and shed key, keeps the stage, and lands by the boy six ticks later', () => {
  const h = setup();
  h.setStage(6);
  h.give(I.BALL); h.give(I.KEY_9); h.give(I.DIARY); h.give(I.DOOR_KEY);
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2915, 3463);
  h.setLocation(2921, 3460);
  const witch = nora(2923);
  const area = garden(h);
  area.process(witch);
  assert.deepEqual(witch.said, ['Stop! Thief!']);
  assert.equal(h.movement.blocked, true);
  h.tick(2);
  assert.deepEqual(witch.said, ['Stop! Thief!', 'Klarata... Sepptento... Valkan!']);
  assert.ok(h.sounds.some((sound) => sound.soundId === 127));
  assert.ok(h.sounds.some((sound) => sound.soundId === 126 && sound.delay === 100));
  // She stands still through the catch.
  for (let n = 0; n < 3; n++) area.process(witch);
  assert.equal(witch.x, 2924);
  h.tick(3);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY()], [2921, 3460], 'not yet moved');
  h.tick();
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY()], [2929, 3456]);
  assert.equal(h.movement.blocked, false);
  assert.equal(h.quest.getStage(h.player), 6, 'the stage is never reset (ticks 958, 1016)');
  assert.equal(h.itemAmounts.get(I.BALL), 0);
  assert.equal(h.itemAmounts.get(I.KEY_9), 0);
  assert.equal(h.itemAmounts.get(I.DIARY), 1);
  assert.equal(h.itemAmounts.get(I.DOOR_KEY), 1);
});

test('every way into the shed brings a fresh experiment, and the key is still needed after the fight', () => {
  const h = setup();
  h.setStage(5);
  h.give(I.KEY_9);
  h.setLocation(2933, 3463);
  h.toggle(O.DOOR_104, SHED_DOOR_TILE);
  const first = h.spawned.find((npc) => npc.id === EXPERIMENT_FORMS[0]);
  h.toggle(O.DOOR_104, SHED_DOOR_TILE);
  const forms = h.spawned.filter((npc) => EXPERIMENT_FORMS.includes(npc.id));
  assert.equal(forms.length, 1);
  assert.notEqual(forms[0], first, 'the old one is replaced');

  // Beaten: the shapeshifter still comes back on entry (tick 1150), and the door wants the key (tick 1092).
  h.setStage(6);
  h.itemAmounts.set(I.KEY_9, 0);
  assert.equal(h.toggle(O.DOOR_104, SHED_DOOR_TILE).handled, true);
  assert.equal(h.messages.at(-1), 'The shed door is locked.');
  h.give(I.KEY_9);
  assert.equal(h.toggle(O.DOOR_104, SHED_DOOR_TILE).handled, false);
  assert.equal(h.spawned.filter((npc) => EXPERIMENT_FORMS.includes(npc.id)).length, 1);
  // Leaving needs no key.
  h.itemAmounts.set(I.KEY_9, 0);
  h.setLocation(2934, 3463);
  assert.equal(h.toggle(O.DOOR_104, SHED_DOOR_TILE).handled, false);
});

test('the drawers open, hold nothing, close, and shut by themselves after 100 ticks', () => {
  const h = setup();
  const at = { x: 2901, y: 3471, z: 0 };
  h.setLocation(2901, 3472);
  h.object(O.DRAWERS_33, { location: at, type: 10, face: 3 });
  assert.deepEqual(h.locs, [O.DRAWERS_34]);
  h.object(O.DRAWERS_34, { location: at, type: 10, face: 3, option: 'Search' });
  assert.equal(h.messages.at(-1), 'The drawers are empty.');
  h.tick(99);
  assert.deepEqual(h.locs, [O.DRAWERS_34]);
  h.tick();
  assert.deepEqual(h.locs, [O.DRAWERS_34, O.DRAWERS_33], 'shut 100 ticks later (ticks 271 -> 371)');

  // Closed by hand: the timer does not shut it a second time.
  h.locs.length = 0;
  h.object(O.DRAWERS_33, { location: at, type: 10, face: 3 });
  h.object(O.DRAWERS_34, { location: at, type: 10, face: 3, option: 'Close' });
  h.tick(100);
  assert.deepEqual(h.locs, [O.DRAWERS_34, O.DRAWERS_33]);
});

test('an opened cupboard shuts by itself, so the next player finds it shut', () => {
  const h = setup();
  h.setStage(1);
  h.setLocation(2899, 9873);
  h.object(O.CUPBOARD_24, { location: { x: 2898, y: 9873, z: 0 }, type: 10 });
  h.tick();
  assert.deepEqual(h.locs, [O.CUPBOARD_25]);
  h.tick(100);
  assert.deepEqual(h.locs, [O.CUPBOARD_25, O.CUPBOARD_24]);
});

test('with the shed ball gone, the last form leaves one on the crate, not under itself', () => {
  const h = setup();
  h.setStage(5);
  h.give(I.KEY_9);
  h.setBallSpawnPresent(false);
  h.setLocation(2933, 3463);
  h.toggle(O.DOOR_104, SHED_DOOR_TILE);
  for (let index = 0; index < EXPERIMENT_FORMS.length; index++) {
    h.beforeDeath(h.spawned.find((entry) => entry.id === EXPERIMENT_FORMS[index]));
  }
  assert.equal(h.groundItems.length, 1);
  const { location } = h.groundItems[0];
  assert.deepEqual([location.getX(), location.getY()], [BALL_SPAWN_TILE.x, BALL_SPAWN_TILE.y]);
});

test('Nora takes over her own movement and recovers from a stuck step or a tile off her row', () => {
  const h = setup();
  const area = garden(h);
  area.getPlayers = () => [];
  // Live state after a restart: spawned inside the area (no enter), wandered to 2903,3462 and stuck.
  const witch = nora(2903);
  witch.y = 3462;
  witch.queued = 1;
  witch.blocked = true;
  area.process(witch);
  assert.equal(witch.scripted, true, 'the wander and walk-home logic is off');
  assert.deepEqual([witch.x, witch.y], [2903, 3463], 'back onto her row');
  area.process(witch);
  area.process(witch);
  assert.deepEqual([witch.x, witch.y], [2905, 3463], 'patrolling east again');
});
