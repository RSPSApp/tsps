// Lost City (q067) registered-dispatch contracts.
// From server/: node --test tests/qh728-q067.test.cjs
//
// Fixture starts: stage values, prerequisite items (axe/knife) and skill levels are
// set directly where a test begins mid-route; the registered handlers then carry the
// state forward. This proves handler contracts, not a natural MCP playthrough.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const VARP_LOST_CITY = 147;
let nativeRegistration;
function nativeQuest() {
  if (!nativeRegistration) {
    require('../plugins/quests/quests/LostCity.Quest')(PluginManager.createApi('LostCityNativeRegression'));
    nativeRegistration = runtime.getRegisteredQuests().findLast(q => q.key === 'lost_city');
  }
  return nativeRegistration;
}

function setup() {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const objectHandlers = [];
  const itemOnItem = [];
  const npcDeaths = [];
  const logoutHandlers = [];
  const emitted = [];
  const spawned = [];
  const removed = [];
  const configs = [];
  const messages = [];
  const animations = [];
  const chops = [];
  const moves = [];
  const dialogueStarts = [];
  const attributes = new Map();
  const items = new Map();
  const levels = new Map();
  custom.set('woodcutting:chop', [event => { chops.push(event); event.handled = true; }]);
  let full = false;
  let combat = 60;
  let weapon = null;
  let location = new core.Location(3138, 3212, 0);

  const sender = new Proxy({
    sendConfig(id, value) { configs.push([id, value]); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds(id, amount = 1) {
      if (full && !(items.get(id) > 0)) return false;
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd(_player, item) {
      items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount());
      return true;
    },
    deleteNumber(id, amount = 1) {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28),
    isFull: () => full,
  };

  const questCore = { ...core, CountdownTask: undefined, TaskManager: core.TaskManager };
  const api = new Proxy({
    core: questCore,
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      emitted.push({ name, event });
      for (const handler of custom.get(name) ?? []) handler(event);
    },
    onNpcDialogueVariant(handler) { variants.push(handler); },
    onNpcDialogueCondition(handler) { conditions.push(handler); },
    onObjectInteraction(handler) { objectHandlers.push(handler); },
    onItemOnItem(handler) { itemOnItem.push(handler); },
    onNpcDeath(handler) { npcDeaths.push(handler); },
    onPlayerLogout(handler) { logoutHandlers.push(handler); },
    spawnNpc(definition) {
      const npc = { ...definition, registered: true, isRegistered() { return this.registered; } };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      if (npc) npc.registered = false;
      removed.push(npc);
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });

  require('../plugins/quests/quests/LostCity.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'lost_city');

  let teleporting = false;
  const movement = { reset() { return this; }, setBlockMovement() { return this; }, handleRegionChange() {} };
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => (weapon ? { getId: () => weapon } : null) }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues(chain) { dialogueStarts.push(chain); }, reset() {} }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels.get(skill) ?? 99,
      getMaxLevel: (skill) => levels.get(skill) ?? 99,
      getCombatLevel: () => combat,
      stopSkillable() {},
    }),
    getMovementQueue: () => movement,
    isPlayerBot: () => false,
    setLocation: next => { location = next; },
    setWalkingDirection() {},
    isTeleportingReturn: () => teleporting,
    setTeleporting: value => { teleporting = value; },
    setUntargetable() {},
    getClickDelay: () => ({ reset() {} }),
    getCombat: () => ({ reset() {} }),
    performGraphic() {},
    getLocation: () => location,
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    getUsername: () => 'qh728-q067',
    sendMessage: (text) => messages.push(text),
    performAnimation: (animation) => animations.push(animation.getId()),
    isRegistered: () => true,
  };

  const hook = (name, npcId, extra = {}) => {
    for (const handler of custom.get('npc-dialogue:hook') ?? []) handler({ player, npcId, hook: name, ...extra });
  };
  const condition = (text) => {
    for (const handler of conditions) {
      const result = handler({ player, text });
      if (result !== null && result !== undefined) return result;
    }
    return null;
  };
  const variant = (npcId) => {
    for (const handler of variants) {
      const result = handler({ npcId, player });
      if (result) return result;
    }
    return null;
  };
  const object = (objectId, extra = {}) => {
    const event = { player, objectId, handled: false, ...extra };
    for (const handler of objectHandlers) handler(event);
    return event;
  };
  const craft = () => {
    const event = { player, usedItemId: I.KNIFE, usedWithItemId: I.DRAMEN_BRANCH, handled: false };
    for (const handler of itemOnItem) handler(event);
    return event;
  };
  const death = (npcId, npc) => {
    for (const handler of npcDeaths) handler({ player, killer: player, npcId, npc });
  };
  const action = (stepId, extra = {}) => {
    const event = { player, stepId, handled: false, ...extra };
    for (const handler of custom.get('npc-dialogue:action') ?? []) handler(event);
    return event;
  };
  const emit = (name, event) => {
    for (const handler of custom.get(name) ?? []) handler(event);
    return event;
  };
  const logout = () => {
    for (const handler of logoutHandlers) handler({ player });
  };

  return {
    quest, player, attributes, items, levels, configs, messages, animations, chops, moves, spawned, removed, variants, emitted, dialogueStarts,
    hook, variant, condition, object, craft, death, action, emit, logout,
    setFull(value) { full = value; },
    setCombat(value) { combat = value; },
    setWeapon(id) { weapon = id; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    stage(value) { quest.setStage(player, value); },
    finishChop() {
      assert.ok(chops.length, 'chopping must be requested before a success');
      inventory.adds(I.DRAMEN_BRANCH, 1);
      emit('woodcutting:success', { player, logId: I.DRAMEN_BRANCH });
    },
  };
}

test('fresh-stage route completes through the registered handlers and grants no extra staff', () => {
  const h = setup();
  assert.equal(h.quest.getStage(h.player), 0);

  h.hook('quest:lost-city:start', N.WARRIOR);
  assert.equal(h.quest.getStage(h.player), 1, 'the warrior start hook begins the quest');

  h.items.set(I.BRONZE_AXE, 1);
  assert.equal(h.object(O.TREE_12).handled, true, 'the leprechaun tree chop is owned');
  assert.equal(h.spawned.at(-1).id, N.SHAMUS);
  assert.equal(h.quest.getStage(h.player), 1);

  assert.equal(h.variant(N.SHAMUS), 'talking-to-a-tool-leprechaun-leprechaun-in-a-tree-first-talk');
  assert.equal(h.quest.getStage(h.player), 1, 'opening Shamus dialogue does not skip his directions');
  h.action('OyPO7t', { npcId: N.SHAMUS, kind: 'message' });
  assert.equal(h.quest.getStage(h.player), 2, 'finishing Shamus directions advances to Entrana');

  h.object(O.DRAMEN_TREE);
  assert.equal(h.spawned.at(-1).id, N.TREE_SPIRIT, 'the first Dramen chop spawns the Tree spirit');
  h.death(N.TREE_SPIRIT, h.spawned.at(-1));
  assert.equal(h.quest.getStage(h.player), 3);

  h.object(O.DRAMEN_TREE);
  assert.equal(h.items.get(I.DRAMEN_BRANCH) ?? 0, 0, 'starting a chop cannot instantly grant a branch');
  assert.equal(h.quest.getStage(h.player), 3, 'the stage waits for an actual chopping success');
  h.finishChop();
  assert.equal(h.items.get(I.DRAMEN_BRANCH), 1, 'the defeated tree yields one branch');
  assert.equal(h.quest.getStage(h.player), 4);

  h.items.set(I.KNIFE, 1);
  h.craft();
  assert.deepEqual(h.animations, [core.CacheDefinitions.getSeqId('human_fletching')]);
  assert.equal(h.items.get(I.DRAMEN_BRANCH) ?? 0, 0, 'the branch is consumed');
  assert.equal(h.items.get(I.DRAMEN_STAFF), 1, 'exactly one staff is crafted');
  assert.equal(h.quest.getStage(h.player), 5);

  h.setWeapon(I.DRAMEN_STAFF);
  h.setLocation(3201, 3169);
  assert.equal(h.object(O.DOOR_72).handled, true);
  for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
  assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.attributes.get('quest.points'), 3);
  assert.equal(h.items.get(I.DRAMEN_STAFF), 1, 'completion must not grant a second Dramen staff');
  assert.deepEqual(h.configs.filter(([id]) => id === VARP_LOST_CITY).at(-1), [VARP_LOST_CITY, 6]);
  assert.ok(h.messages.some((text) => text.includes('Lost City')));
  assert.deepEqual(h.moves.at(-1), [2452, 4473, 0]);
});

test('Shamus repeat conversations use the canonical subsequent-talks variant', () => {
  const h = setup();
  h.stage(2);
  assert.equal(h.variant(N.SHAMUS), 'talking-to-a-tool-leprechaun-leprechaun-in-a-tree-subsequent-talks');
});

test('adventurers use the after-Shamus variant once Shamus has spoken', () => {
  const h = setup();
  h.stage(2);
  assert.equal(h.variant(N.WARRIOR), 'talking-to-a-tool-leprechaun-leprechaun-in-a-tree-talking-to-warrior-after-talking-to-shamus');
});

test('the start warning answers only for low combat and a missing skill requirement', () => {
  const h = setup();
  h.setCombat(40);
  const text = 'If the player has lower than 45 combat and either 31 Crafting or 36 Woodcutting:';
  h.levels.set(core.Skill.CRAFTING, 30);
  h.levels.set(core.Skill.WOODCUTTING, 36);
  assert.equal(h.condition(text), true, 'combat below 45 with Crafting below 31 warns');
  h.levels.set(core.Skill.CRAFTING, 31);
  h.levels.set(core.Skill.WOODCUTTING, 35);
  assert.equal(h.condition(text), true, 'combat below 45 with Woodcutting below 36 warns');
  h.levels.set(core.Skill.WOODCUTTING, 36);
  assert.equal(h.condition(text), false, 'meeting both skills clears the warning');
});

test('the warrior has his canonical post-quest transcript after completion', () => {
  const h = setup();
  h.stage(6);
  assert.deepEqual(h.variant(N.WARRIOR), { page: 'Warrior (Lost City)', variant: 'standard-dialogue-after-lost-city' });
});

test('a full bag refuses the Dramen branch without advancing the stage', () => {
  const h = setup();
  h.stage(3);
  h.items.set(I.BRONZE_AXE, 1);
  h.setFull(true);
  h.object(O.DRAMEN_TREE);
  assert.equal(h.items.get(I.DRAMEN_BRANCH) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.chops.length, 0, 'a full bag cannot start chopping');
  assert.ok(h.messages.includes('You need a free inventory space.'));
});

test('low Crafting refuses to carve the staff and keeps the branch', () => {
  const h = setup();
  h.stage(4);
  h.items.set(I.DRAMEN_BRANCH, 1);
  h.items.set(I.KNIFE, 1);
  h.levels.set(core.Skill.CRAFTING, 30);
  h.craft();
  assert.equal(h.items.get(I.DRAMEN_BRANCH), 1);
  assert.equal(h.items.get(I.DRAMEN_STAFF) ?? 0, 0);
  assert.equal(h.animations.length, 0, 'failed crafting cannot play its success animation');
  assert.equal(h.quest.getStage(h.player), 4);
});

test('the shed door does nothing without a wielded Dramen staff and ignores other objects', () => {
  const h = setup();
  h.stage(5);
  h.object(O.DOOR_72);
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.moves.length, 0);
  h.setWeapon(I.DRAMEN_STAFF);
  h.object(O.TREE_12);
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.moves.length, 0);
});

test('login replay persists an existing stage and the completed wire value', () => {
  const h = setup();
  h.stage(5);
  runtime.sendQuestVarps({ player: h.player });
  assert.deepEqual(h.configs.filter(([id]) => id === VARP_LOST_CITY).at(-1), [VARP_LOST_CITY, 5]);
  h.stage(6);
  runtime.sendQuestVarps({ player: h.player });
  assert.deepEqual(h.configs.filter(([id]) => id === VARP_LOST_CITY).at(-1), [VARP_LOST_CITY, 6]);
});

test('Lost City yields shared ferry dialogue/actions to Entrana', () => {
  const h = setup();
  assert.equal(h.variant(N.MONK_OF_ENTRANA), null);
  assert.equal(h.action('b8yDey', { npcId: N.MONK_OF_ENTRANA }).handled, false);
  assert.equal(h.moves.length, 0);
});

test('the Cave monk descent variant and its action reach the dungeon, and ladder 2408 is claimed', () => {
  const h = setup();
  h.stage(2);

  assert.deepEqual(h.variant(N.CAVE_MONK), {
    page: 'Cave monk',
    variant: 'standard-dialogue',
  }, 'ordinary talk warns without descending');

  const descent = h.action('u31XRz', { npcId: N.CAVE_MONK });
  assert.equal(descent.handled, true);
  assert.deepEqual(h.moves.at(-1), [2822, 9774, 0], 'the Cave monk choice lands in the dungeon');

  const ladder = {
    player: h.player,
    objectId: 2408,
    object: { getLocation: () => new core.Location(2820, 3374, 0) },
    clickType: 1,
    handled: false,
  };
  h.emit('ladders:climb', ladder);
  assert.equal(ladder.handled, true, 'the one-way ladder is claimed before ClimbLinks guesses');
  assert.equal(h.dialogueStarts.length, 1, 'clicking the ladder starts the canonical warning transcript');
  assert.equal(h.emitted.some(entry => entry.name === 'ladders:climbDown'), false,
    'the ladder cannot descend before the player accepts the warning');
});

test('repeated chops reuse owner-only NPCs and logout reaps them', () => {
  const h = setup();
  h.stage(1);
  h.items.set(I.BRONZE_AXE, 1);

  h.object(O.TREE_12);
  h.object(O.TREE_12);
  assert.equal(h.spawned.filter((npc) => npc.id === N.SHAMUS).length, 1, 'only one Shamus is spawned');
  h.logout();
  assert.ok(h.removed.some((npc) => npc.id === N.SHAMUS), 'logout removes Shamus');

  h.object(O.TREE_12);
  assert.equal(h.spawned.filter((npc) => npc.id === N.SHAMUS).length, 2, 'a relog can spawn him again');

  const spirit = setup();
  spirit.stage(2);
  spirit.items.set(I.BRONZE_AXE, 1);
  spirit.object(O.DRAMEN_TREE);
  spirit.object(O.DRAMEN_TREE);
  assert.equal(spirit.spawned.filter((npc) => npc.id === N.TREE_SPIRIT).length, 1,
    'only one Tree spirit is spawned before the first is killed');
  spirit.logout();
  assert.ok(spirit.removed.some((npc) => npc.id === N.TREE_SPIRIT), 'logout removes the Tree spirit');
});

test('quest completion reaps the owner-only quest NPCs', () => {
  const h = setup();
  h.stage(1);
  h.items.set(I.BRONZE_AXE, 1);
  h.object(O.TREE_12);
  assert.equal(h.spawned.filter((npc) => npc.id === N.SHAMUS).length, 1);

  h.stage(5);
  h.setWeapon(I.DRAMEN_STAFF);
  h.setLocation(3201, 3169);
  h.object(O.DOOR_72);
  for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
  assert.equal(h.quest.isComplete(h.player), true);
  assert.ok(h.removed.some((npc) => npc.id === N.SHAMUS), 'completion removes the tracked Shamus');
});


test('a wielded axe works and foreign Tree spirit deaths cannot bypass the encounter', () => {
  const h = setup();
  h.stage(2); h.setWeapon(I.BRONZE_AXE);
  h.object(O.DRAMEN_TREE);
  const spirit = h.spawned.at(-1);
  assert.equal(spirit.id, N.TREE_SPIRIT);
  h.death(N.TREE_SPIRIT, {});
  assert.equal(h.quest.getStage(h.player), 2);
  h.death(N.TREE_SPIRIT, spirit);
  assert.equal(h.quest.getStage(h.player), 3);
  h.object(O.DRAMEN_TREE);
  h.finishChop();
  assert.equal(h.items.get(I.DRAMEN_BRANCH), 1);
});

test('interrupted Shamus directions remain available until the disappearance message', () => {
  const h = setup(); h.stage(1);
  assert.equal(h.variant(N.SHAMUS), 'talking-to-a-tool-leprechaun-leprechaun-in-a-tree-first-talk');
  assert.equal(h.variant(N.SHAMUS), 'talking-to-a-tool-leprechaun-leprechaun-in-a-tree-first-talk');
  assert.equal(h.quest.getStage(h.player), 1);
  h.action('qdoJ9W', { npcId: N.SHAMUS, kind: 'message' });
  assert.equal(h.quest.getStage(h.player), 2);
});

test('native Dramen chopping animates, can be interrupted and advances only on a timed success', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(1963); player.setUsername('lostcityanim'); player.setRegistered(true);
  player.setLocation(new core.Location(2859, 9734, 0));
  player.getSkillManager().setMaxLevels(core.Skill.WOODCUTTING, 36).setCurrentLevels(core.Skill.WOODCUTTING, 36);
  player.getInventory().add(new core.Item(I.BRONZE_AXE), true);
  const quest = nativeQuest();
  quest.setStage(player, 3);
  const woodcutting = require('../plugins/skills/Woodcutting.plugin');
  woodcutting.register(PluginManager.createApi('Woodcutting'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2860, 9734);
  const tree = core.MapObjects.get(O.DRAMEN_TREE, new core.Location(2860, 9734, 0), null);
  assert.ok(tree, 'the real cache Dramen tree must be present');
  t.mock.method(Math, 'random', () => new Error().stack.includes('maybeDropBirdNest') ? 0.99 : 0);
  t.after(() => {
    woodcutting.stopWoodcutting(player);
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  const chop = () => PluginManager.emitObjectInteraction({ player, object: tree,
    objectId: tree.getId(), clickType: 1, handled: false });
  assert.equal(chop(), true);
  assert.equal(player.getAnimation().getId(), core.CacheDefinitions.getSeqId('human_woodcutting_bronze_axe'));
  assert.equal(player.getInventory().getAmount(I.DRAMEN_BRANCH), 0);
  player.getMovementQueue().addFirstStep(new core.Location(2858, 9734, 0));
  core.TaskManager.process(); core.TaskManager.process();
  assert.equal(player.getInventory().getAmount(I.DRAMEN_BRANCH), 0, 'walking interrupts before the resource roll');
  assert.equal(quest.getStage(player), 3);
  player.getMovementQueue().reset();
  chop(); chop();
  core.TaskManager.process();
  assert.equal(player.getInventory().getAmount(I.DRAMEN_BRANCH), 0, 'repeated input cannot grant instant branches');
  core.TaskManager.process();
  assert.equal(player.getInventory().getAmount(I.DRAMEN_BRANCH), 1);
  assert.equal(quest.getStage(player), 4, 'real Woodcutting success advances the quest');
});

test('Zanaris shed entry presents on the entry tile and lands three real task ticks later', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const player = new Player(null, new core.Location(3201, 3169, 0));
  player.setIndex(2087); player.setUsername('zanarisentry'); player.setRegistered(true);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.DRAMEN_STAFF, 1));
  const packets = [];
  t.mock.method(player.getPacketSender(), 'sendSoundEffect', (id, loops, delay) => { packets.push({ id, delay, loops }); return player.getPacketSender(); });
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
  t.mock.method(player, 'sendMessage', () => {});
  const quest = nativeQuest();
  quest.setStage(player, 5);
  const door = new core.GameObject(O.DOOR_72, new core.Location(3202, 3169, 0), 0, 0, null);
  const use = () => PluginManager.emitObjectInteraction({ player, object: door, objectId: O.DOOR_72, clickType: 1, handled: false });
  const coord = () => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
  t.after(() => { core.TaskManager.cancelTasks(player); player.setRegistered(false); });
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  assert.equal(use(), false, 'without a wielded Dramen staff the existing door guard remains unclaimed');
  assert.deepEqual(coord(), [3201, 3169, 0]);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.DRAMEN_STAFF, 1));
  quest.setStage(player, 4);
  assert.equal(use(), true, 'insufficient quest stage retains its existing refusal');
  assert.deepEqual(coord(), [3201, 3169, 0]);
  assert.equal(packets.length, 0);
  quest.setStage(player, 5);
  assert.equal(use(), true);
  assert.deepEqual(coord(), [3202, 3169, 0], 'object interaction steps onto shed before presentation');
  assert.equal(quest.getStage(player), 5, 'no completion on the approach');
  use();
  core.TaskManager.process();
  assert.deepEqual(coord(), [3202, 3169, 0]);
  assert.equal(player.getAnimation().getId(), 3265);
  assert.equal(player.getAnimation().getDelay(), 30, 'encoded client animation delay, not 30 task ticks');
  assert.equal(player.getGraphic().getId(), 569);
  assert.deepEqual(packets, [{ id: 1098, delay: 0, loops: 1 }]);
  use();
  for (let tick = 1; tick <= 2; tick++) {
    core.TaskManager.process();
    assert.deepEqual(coord(), [3202, 3169, 0], `no arrival after presentation+${tick}`);
    assert.equal(quest.getStage(player), 5);
  }
  core.TaskManager.process();
  assert.deepEqual(coord(), [2452, 4473, 0], 'entry destination differs from the exit shed tile');
  assert.equal(player.getAnimation().getId(), 3266);
  assert.equal(quest.isComplete(player), true);
  assert.equal(packets.length, 1, 'duplicate input cannot restart or double the sequence');
  assert.equal(player.isTeleportingReturn(), false);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  player.setLocation(new core.Location(3205, 3169, 0));
  use();
  assert.deepEqual(coord(), [3205, 3169, 0], 'a distant handler call cannot stand in for normal object approach');
  assert.equal(packets.length, 1);
});

test('Zanaris entry cancellation releases the native player without completing the quest', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  for (const ticks of [0, 1, 2]) {
    const player = new Player(null, new core.Location(3201, 3169, 0));
    player.setIndex(2088 + ticks); player.setUsername('zanariscancel' + ticks); player.setRegistered(true);
    t.after(() => { core.TaskManager.cancelTasks(player); player.setRegistered(false); });
    player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.DRAMEN_STAFF, 1));
    t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
    t.mock.method(player, 'sendMessage', () => {});
    const quest = nativeQuest();
    quest.setStage(player, 5);
    const door = new core.GameObject(O.DOOR_72, new core.Location(3202, 3169, 0), 0, 0, null);
    PluginManager.emitObjectInteraction({ player, object: door, objectId: O.DOOR_72, clickType: 1, handled: false });
    for (let n = 0; n < ticks; n++) core.TaskManager.process();
    // Real logout cancels tasks by this same player key; no live logout/save/DB in this fixture.
    core.TaskManager.cancelTasks(player); player.setRegistered(false);
    for (let n = 0; n < 5; n++) core.TaskManager.process();
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3202, 3169]);
    assert.equal(quest.getStage(player), 5);
    assert.equal(player.isTeleportingReturn(), false);
    assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  }
});
