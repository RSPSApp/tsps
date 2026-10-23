// Olaf's Quest (q085) source-contract regression.
// From server/: node --test tests/qh728-q085.test.cjs
//
// Handler-contract test. It dispatches the plugin's registered handlers,
// transcript action ids and cache-interface buttons directly; prerequisite state
// (The Fremennik Trials, skills, axe/tinderbox/spade, and keys) is fixture-set.
// It proves handler/interface edges, the cache 252/253 state contracts and the
// final stage/wire transition, not a live playthrough or QH overlay.
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
const transcripts = [];
runtime.startTranscript = (api, player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};
const register = require('../plugins/quests/quests/OlafsQuest.Quest');

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const PAGE = "Olaf's Quest";
const OLAF = N.OLAF_HRADSON;
const VOLF = N.VOLF_OLAFSON;
const INGRID = N.INGRID_HRADSON;
const ULFRIC_RISE = N.ULFRIC_2;
const STAGE_VARBIT = 3534;
const FIRE_VARBIT = 3537;
const KILLED_VARBIT = 3539;
const TREASURE_VARBIT = 3540;
const GATE_VARBIT = 3545;
const WALK1_VARBIT = 3547;
const WALK2_VARBIT = 3548;
const INGRID_VARBIT = 3536;
const VOLF_VARBIT = 3535;
const RIGHT_DISK_VARBIT = 3541;
const BOTTOM_DISK_VARBIT = 3542;
const LEFT_DISK_VARBIT = 3543;
const TOP_DISK_VARBIT = 3544;
const GATE_INTERFACE = 252;
const WALL_INTERFACE = 253;
const GATE_KEY_COMPONENT = 8;
const GATE_KEY_DUMMY_COMPONENT = 14;
const WALL_DISK_COMPONENTS = { right: 4, top: 5, left: 6, bottom: 7 };
const WALL_BUTTONS = { right: 8, top: 9, left: 10, bottom: 11, confirm: 12 };
const KEYHOLES = [
  { component: 9, itemId: I.KEY_13, shape: 'square' },
  { component: 10, itemId: I.KEY_12, shape: 'cross' },
  { component: 11, itemId: I.KEY_14, shape: 'triangle' },
  { component: 12, itemId: I.KEY_15, shape: 'circle' },
  { component: 13, itemId: I.KEY_16, shape: 'star' },
];
const keyholeComponent = (keyId) => KEYHOLES.find((entry) => entry.itemId === keyId)?.component;

function setup() {
  transcripts.length = 0;
  let trialsComplete = true;
  const attributes = new Map();
  const items = new Map();
  const varbits = new Map();
  const messages = [];
  const spawned = [];
  const ground = [];
  const dropped = [];
  const xp = [];
  const calls = [];
  let location = new core.Location(2748, 3732, 0);
  let freeSlots = 28;
  const STACKABLE = new Set([I.COINS]);

  const slots = (id, amount) => (STACKABLE.has(id) ? 1 : amount);
  function addItem(id, amount) {
    const held = items.get(id) ?? 0;
    const required = held > 0 && STACKABLE.has(id) ? 0 : slots(id, amount);
    if (required > freeSlots) {
      messages.push('Not enough space in your inventory.');
      return false;
    }
    freeSlots -= required;
    items.set(id, held + amount);
    return true;
  }
  function deleteItem(id, amount) {
    const held = items.get(id) ?? 0;
    const removed = Math.min(held, amount);
    if (removed <= 0) return true;
    const next = held - removed;
    if (next <= 0) {
      items.delete(id);
      freeSlots += slots(id, removed);
    } else {
      items.set(id, next);
      if (!STACKABLE.has(id)) freeSlots += removed;
    }
    return true;
  }

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => addItem(id, amount),
    deleteNumber: deleteItem,
    isFull: () => freeSlots <= 0,
    getFreeSlots: () => freeSlots,
    getItems: () => [],
    forceAdd(player, item) {
      const id = item.getId?.() ?? item.id;
      const amount = item.getAmount?.() ?? item.amount;
      const held = items.get(id) ?? 0;
      const required = held > 0 && STACKABLE.has(id) ? 0 : slots(id, amount);
      if (freeSlots <= 0 && !(held > 0 && STACKABLE.has(id))) {
        dropped.push({ id, amount });
        return;
      }
      if (required > freeSlots && !STACKABLE.has(id)) {
        const carried = Math.max(0, freeSlots);
        if (carried > 0) {
          freeSlots = 0;
          items.set(id, held + carried);
        }
        return;
      }
      freeSlots -= required;
      items.set(id, held + amount);
    },
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); calls.push(['sendVarbit', id, value]); return sender; },
    sendConfig(id, value) { varbits.set(id, value); calls.push(['sendConfig', id, value]); return sender; },
    sendInterface(id) { calls.push(['sendInterface', id]); return sender; },
    sendChatboxInterface(id) { calls.push(['sendChatboxInterface', id]); return sender; },
    closeInterface(id) { calls.push(['closeInterface', id]); return sender; },
    sendInterfaceRemoval() { calls.push(['sendInterfaceRemoval']); return sender; },
    sendInterfaceModel(uid, itemId, zoom) { calls.push(['sendInterfaceModel', uid, itemId, zoom]); return sender; },
    sendInterfaceRawModel(uid, modelId) { calls.push(['sendInterfaceRawModel', uid, modelId]); return sender; },
    sendInterfaceFlagsRange(uid, from, to, flags) { calls.push(['sendInterfaceFlagsRange', uid, from, to, flags]); return sender; },
    sendInterfaceAnimation(uid, animationId) { calls.push(['sendInterfaceAnimation', uid, animationId]); return sender; },
    sendClientScript(scriptId, ...args) { calls.push(['sendClientScript', scriptId, ...args]); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    getVarp(id) { return varbits.get(id) ?? 0; },
  }, { get(target, prop) { return prop in target ? target[prop] : () => sender; } });

  const player = {
    getUsername: () => 'qh728-q085',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({ getItems: () => [] }),
    getPacketSender: () => sender,
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      getCombatLevel: () => 99,
      addExperiences(skill, amount) { xp.push([skill, amount]); },
    }),
    getDialogueManager: () => ({ isActive: () => false }),
    getLocation: () => location,
    moveTo(value) { location = new core.Location(value.getX(), value.getY(), value.getZ()); },
    performAnimation() {},
    getPrivateArea: () => null,
    isPlayerBot: () => false,
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage(message) { messages.push(message); },
  };

  const custom = new Map();
  const variantHooks = [];
  const conditionHooks = [];
  const actionHooks = [];
  const choiceHooks = [];
  const lineHooks = [];
  const objectHooks = new Map();
  const itemOnObjectHooks = [];
  const itemActionHooks = new Map();
  const deathHooks = [];
  const loginHooks = [];
  const logoutHooks = [];
  const interfaceButtonHooks = [];

  const api = new Proxy({
    core: { ...core, ObjectDefinition: { forPlayer: (id) => ({ id }) } },
    persistAttribute() {},
    onCustomEvent(name, fn) {
      if (!custom.has(name)) custom.set(name, []);
      custom.get(name).push(fn);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && event?.key === 'fremennik_trials') event.complete = trialsComplete;
      for (const fn of custom.get(name) ?? []) fn(event);
    },
    onNpcDialogueVariant(fn) { variantHooks.push(fn); },
    onNpcDialogueCondition(fn) { conditionHooks.push(fn); },
    onItemOnObject(fn) { itemOnObjectHooks.push(fn); },
    onItemAction(name, actions) { itemActionHooks.set(name, { ...(itemActionHooks.get(name) ?? {}), ...actions }); },
    onObjectInteraction(first, second) {
      if (typeof first === 'string') objectHooks.set(first, second);
    },
    onNpcDeath(fn) { deathHooks.push(fn); },
    onPlayerLogin(fn) { loginHooks.push(fn); },
    onPlayerLogout(fn) { logoutHooks.push(fn); },
    onInterfaceActionButton(buttonIds, handler) {
      interfaceButtonHooks.push({ ids: new Set(Array.isArray(buttonIds) ? buttonIds : [buttonIds]), handler });
    },
    spawnNpc(def) {
      const npc = {
        def,
        getId: () => def.id,
        getContentId: () => def.id,
        getOwner: () => def.owner,
        getLocation: () => new core.Location(def.x, def.y, def.z),
        isRegistered: () => true,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      const index = spawned.indexOf(npc);
      if (index >= 0) spawned.splice(index, 1);
    },
    getWorld: () => ({ getNpcs: () => [] }),
    getItemOnGroundManager: () => ({
      registerLocation(_player, item, tile) { ground.push({ id: item.getId(), tile }); },
      getGroundItem() { return null; },
    }),
  }, {
    get(target, prop) { return prop in target ? target[prop] : () => undefined; },
  });

  register(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'olafs_quest');

  const variant = (npcId) => {
    for (const fn of variantHooks) {
      const result = fn({ player, npcId, definition: { getId: () => npcId }, pages: [{ page: PAGE }] });
      if (result) return typeof result === 'string' ? result : result.variant;
    }
    return null;
  };
  const action = (stepId, npcId = OLAF) => {
    const event = { player, npcId, stepId, definition: { getId: () => npcId }, text: '', handled: false, end: false };
    api.emitCustomEvent('npc-dialogue:action', event);
    return event;
  };
  const hook = (name, npcId = OLAF) => {
    const event = { player, npcId, hook: name, definition: { getId: () => npcId } };
    api.emitCustomEvent('npc-dialogue:hook', event);
    return event;
  };
  const object = (name, option, objectId, loc = location, definitionId = objectId) => {
    const actions = objectHooks.get(name);
    const event = {
      player, objectId, location: loc, clickType: 1, handled: false,
      definition: { getId: () => definitionId, getName: () => name, getInteractions: () => [option], getActions: () => [option] },
    };
    if (actions?.[option] && actions[option](event) !== false) event.handled = true;
    return event;
  };
  const itemOnObject = (itemId, objectId, name = 'Object', loc = location) => {
    const event = {
      player, itemId, objectId, location: loc, handled: false,
      definition: { getId: () => objectId, getName: () => name, getInteractions: () => [], getActions: () => [] },
    };
    for (const fn of itemOnObjectHooks) fn(event);
    return event;
  };
  const itemAction = (name, option, itemId) => {
    const event = { player, itemId, handled: false };
    if (itemActionHooks.get(name)?.[option]?.(event) !== false) event.handled = true;
    return event;
  };
  const interfaceClick = (uid, action = 1) => {
    const event = {
      player, buttonId: uid, action, groupId: uid >>> 16, childId: uid & 0xffff, handled: false,
    };
    for (const hook of interfaceButtonHooks) {
      if (!hook.ids.has(uid)) continue;
      if (hook.handler(event) !== false) event.handled = true;
      if (event.handled) break;
    }
    return event;
  };
  const click = (group, component, action = 1) => interfaceClick((group << 16) | component, action);
  const death = (npcId, npc = { getOwner: () => player, getId: () => npcId, getLocation: () => location }) => {
    const event = { killer: player, npc, npcId, location: { x: location.getX(), y: location.getY(), z: location.getZ() } };
    for (const fn of deathHooks) fn(event);
    return event;
  };
  const login = () => {
    for (const fn of loginHooks) fn({ player });
    for (const fn of custom.get('player:bootstrap-complete') ?? []) fn({ player });
  };
  const logout = () => {
    for (const fn of logoutHooks) fn({ player });
  };
  const give = (id, amount = 1) => {
    assert.equal(addItem(id, amount), true, `fixture item ${id} did not fit`);
  };
  return {
    api, player, quest, items, varbits, messages, spawned, ground, dropped, xp, calls, transcripts,
    variant, action, hook, object, itemOnObject, itemAction, death, login, logout, give, click, interfaceClick,
    setTrials(value) { trialsComplete = value; },
    stage: () => quest.getStage(player),
    setStage: (value) => quest.setStage(player, value),
    setFreeSlots(value) { freeSlots = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    location: () => location,
    journal: () => quest.buildJournal(player, quest),
  };
}

test('mandatory handler route reaches stage 80 on canonical varbit 3534 and survives login replay', () => {
  const h = setup();
  h.hook('quest:olaf-s-quest:start');
  assert.equal(h.stage(), 10);

  // Items required by the route (the QH requirements: axe, tinderbox, spade).
  h.give(I.BRONZE_AXE, 1);
  h.give(I.TINDERBOX, 1);
  h.give(I.SPADE, 1);

  const tree = h.object('Windswept tree', 'Chop down', O.WINDSWEPT_TREE_2, new core.Location(2748, 3734, 0));
  assert.equal(tree.handled, true);
  assert.equal(h.items.get(I.WINDSWEPT_LOGS), 1, 'chopping grants windswept logs');
  assert.equal(h.stage(), 10, 'logs alone do not advance the stage');

  assert.equal(h.variant(OLAF), 'talking-to-olaf-talking-to-olaf-with-the-windswept-logs');
  h.action('b5Mnae');
  assert.equal(h.stage(), 20, 'carving the logs advances to stage 20');
  assert.equal(h.items.get(I.WINDSWEPT_LOGS) ?? 0, 0, 'logs are consumed');
  assert.equal(h.items.get(I.CRUDE_CARVING), 1);
  assert.equal(h.items.get(I.CRUDER_CARVING), 1);

  assert.equal(h.variant(INGRID), 'delivering-the-presents-ingrid-s-present');
  h.action('cWJG2g', INGRID);
  assert.equal(h.items.get(I.CRUDE_CARVING) ?? 0, 0, "Ingrid's carving is consumed");
  assert.equal(h.items.get(I.BREAD), 1);
  assert.equal(h.varbits.get(INGRID_VARBIT), 1);
  assert.equal(h.stage(), 20, 'one delivery does not skip stage 20');

  assert.equal(h.variant(VOLF), 'delivering-the-presents-volf-s-present');
  h.action('sQYWRb', VOLF);
  assert.equal(h.items.get(I.CRUDER_CARVING) ?? 0, 0, "Volf's carving is consumed");
  assert.equal(h.items.get(I.SHARK), 1);
  assert.equal(h.varbits.get(VOLF_VARBIT), 1);
  assert.equal(h.stage(), 30, 'both deliveries advance to stage 30');

  assert.equal(h.variant(OLAF), 'talking-to-olaf-after-the-presents-have-been-delivered');
  h.action('X7TD0c');
  assert.equal(h.items.get(I.DAMP_PLANKS), 1, 'Olaf hands over damp planks');
  assert.equal(h.varbits.get(FIRE_VARBIT), 1, 'the campfire is embers');
  assert.equal(h.stage(), 40);

  assert.equal(h.variant(OLAF), 'talking-to-olaf-after-the-presents-have-been-delivered-talking-to-olaf-again-if-the-fire-has-not-lighten-up');
  const fire = h.itemOnObject(I.DAMP_PLANKS, O.EMBERS);
  assert.equal(fire.handled, true);
  assert.equal(h.items.get(I.DAMP_PLANKS) ?? 0, 0, 'damp planks are consumed lighting the fire');
  assert.equal(h.varbits.get(FIRE_VARBIT), 0, 'the fire is lit');
  assert.equal(h.stage(), 50);
  assert.equal(transcripts.at(-1).variant, 'talking-to-olaf-after-the-presents-have-been-delivered-lighting-up-the-fire');

  assert.equal(h.variant(OLAF), 'talking-to-olaf-after-the-presents-have-been-delivered-talking-to-olaf-afterwards');
  h.action('C8kt_f');
  assert.equal(h.items.get(I.SVENS_LAST_MAP), 1, 'Olaf hands over Sven\'s last map');
  assert.equal(h.stage(), 60);

  const dig = h.itemAction('Spade', 'Dig', I.SPADE);
  assert.equal(dig.handled, true);
  assert.equal(h.stage(), 70, 'digging beside the tree enters the cavern');
  assert.deepEqual([h.location().getX(), h.location().getY()], [2694, 10124]);
  assert.equal(transcripts.at(-1).variant, 'entering-the-brine-rat-cavern-when-digging-beside-the-windswept-tree');

  // Kill a skeleton fremennik: the plugin's death handler drops one of the five gate keys.
  h.death(N.SKELETON_FREMENNIK);
  assert.equal(h.ground.length, 1, 'a skeleton drops a gate key');
  const keyId = h.ground[0].id;
  assert.ok([I.KEY_12, I.KEY_13, I.KEY_14, I.KEY_15, I.KEY_16].includes(keyId));
  h.give(keyId, 1);

  // The picture wall: first search explains it, later searches open cache interface 253.
  const wallLoc = new core.Location(2707, 10147, 0);
  h.setLocation(2707, 10146, 0);
  h.object('Picture wall', 'Search', O.PICTURE_WALL, wallLoc);
  assert.equal(transcripts.at(-1).variant, 'entering-the-brine-rat-cavern-attempting-to-open-the-picture-wall');
  h.object('Picture wall', 'Search', O.PICTURE_WALL, wallLoc);
  assert.ok(h.calls.some(([name, id]) => name === 'sendInterface' && id === WALL_INTERFACE), 'opens cache interface 253');
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 3, 'right disk starts at 3');
  assert.equal(h.varbits.get(BOTTOM_DISK_VARBIT), 2, 'bottom disk starts at 2');
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 1, 'left disk starts at 1');
  assert.equal(h.varbits.get(TOP_DISK_VARBIT), 2, 'top disk starts at 2');
  const wallScriptCalls = () => h.calls.filter(([name, script]) => name === 'sendClientScript' && script === 233);
  assert.equal(wallScriptCalls().length, 4, 'all four disk models are sent through cache script 233');

  // A non-Op1 action does not turn a lever.
  h.click(WALL_INTERFACE, WALL_BUTTONS.right, 2);
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 3);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 1);

  // Four right-lever pulls wrap 4 -> 1 and return the two affected disks to their start.
  for (let i = 0; i < 4; i++) h.click(WALL_INTERFACE, WALL_BUTTONS.right);
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 3, 'right disk wraps through 4 back to 3 after four turns');
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 1, 'left disk wraps through 4 back to 1 after four turns');

  // Confirming the scrambled image is refused and does not advance the quest.
  h.click(WALL_INTERFACE, WALL_BUTTONS.confirm);
  assert.equal(transcripts.at(-1).variant, 'entering-the-brine-rat-cavern-attempting-to-open-the-picture-wall');
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 3, 'a wrong confirm does not change the disks');

  // Wiki order: right, up, left, down, then the bottom horizontal lever.
  h.click(WALL_INTERFACE, WALL_BUTTONS.right);
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 2);
  h.click(WALL_INTERFACE, WALL_BUTTONS.top);
  assert.equal(h.varbits.get(TOP_DISK_VARBIT), 3);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 3);
  h.click(WALL_INTERFACE, WALL_BUTTONS.left);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(BOTTOM_DISK_VARBIT), 3);
  h.click(WALL_INTERFACE, WALL_BUTTONS.bottom);
  assert.equal(h.varbits.get(TOP_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(BOTTOM_DISK_VARBIT), 4);
  h.click(WALL_INTERFACE, WALL_BUTTONS.confirm);
  assert.equal(transcripts.at(-1).variant, 'entering-the-brine-rat-cavern-opening-the-picture-wall');
  assert.ok(h.calls.some(([name, id]) => name === 'closeInterface' && id === WALL_INTERFACE));
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(BOTTOM_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(TOP_DISK_VARBIT), 4);

  h.object('Picture wall', 'Search', O.PICTURE_WALL, wallLoc);
  assert.deepEqual([h.location().getX(), h.location().getY()], [2707, 10148], 'an opened wall lets the player step through');

  // Walkway repairs: one barrel + three ropes per broken section.
  h.give(I.ROTTEN_BARREL, 1);
  h.give(I.ROPE, 3);
  h.itemOnObject(I.ROTTEN_BARREL, O.WALKWAY, 'Walkway');
  assert.equal(h.varbits.get(WALK1_VARBIT), 1);
  assert.equal(h.items.get(I.ROTTEN_BARREL) ?? 0, 0);
  assert.equal(h.items.get(I.ROPE) ?? 0, 0);
  h.give(I.ROTTEN_BARREL_2, 1);
  h.give(I.ROPE, 3);
  h.itemOnObject(I.ROTTEN_BARREL_2, O.WALKWAY_2, 'Walkway');
  assert.equal(h.varbits.get(WALK2_VARBIT), 1);

  // The Rusty gate is claimed through the Doors plugin's door:toggle event, then
  // opens cache interface 252 for the key-shape selection.
  h.setLocation(2724, 10168, 0);
  const gate = { player: h.player, objectId: O.GATE_163, definition: { id: O.GATE_163 }, handled: false };
  h.api.emitCustomEvent('door:toggle', gate);
  assert.equal(gate.handled, true, 'the quest claims the rusty gate');
  assert.ok(h.calls.some(([name, id]) => name === 'sendInterface' && id === GATE_INTERFACE), 'opens cache interface 252');
  assert.ok(h.calls.some(([name, uid, itemId]) => name === 'sendInterfaceModel' && uid === ((GATE_INTERFACE << 16) | GATE_KEY_COMPONENT) && itemId === keyId), 'shows the held key');
  assert.ok(h.calls.some(([name, uid, itemId]) => name === 'sendInterfaceModel' && uid === ((GATE_INTERFACE << 16) | GATE_KEY_DUMMY_COMPONENT) && itemId === keyId), 'shows the held key in the alternate dummy slot');
  for (const keyhole of KEYHOLES) {
    assert.ok(h.calls.some(([name, uid, itemId]) => name === 'sendInterfaceModel' && uid === ((GATE_INTERFACE << 16) | keyhole.component) && itemId === keyhole.itemId), `shows the ${keyhole.shape} keyhole`);
  }
  assert.equal(h.varbits.get(GATE_VARBIT) ?? 0, 0, 'the gate stays shut until the right shape is chosen');

  const correctComponent = keyholeComponent(keyId);
  const wrongKeyhole = KEYHOLES.find((entry) => entry.component !== correctComponent);
  h.click(GATE_INTERFACE, wrongKeyhole.component);
  assert.equal(h.items.get(keyId), 1, 'a wrong keyhole does not consume the key');
  assert.equal(h.varbits.get(GATE_VARBIT) ?? 0, 0, 'a wrong keyhole does not open the gate');
  assert.ok(!h.calls.some(([name, id]) => name === 'closeInterface' && id === GATE_INTERFACE), 'a wrong keyhole keeps the interface open');

  h.click(GATE_INTERFACE, correctComponent);
  assert.equal(h.items.get(keyId) ?? 0, 0, 'the correct key is consumed');
  assert.equal(h.varbits.get(GATE_VARBIT), 1);
  assert.ok(h.calls.some(([name, id]) => name === 'closeInterface' && id === GATE_INTERFACE));
  assert.equal(h.location().getX(), 2726, 'opening the gate crosses to the far side');

  h.setLocation(2740, 10164, 0);
  const firstChest = h.object('Chest', 'Open', O.CHEST_54, new core.Location(2740, 10164, 0));
  assert.equal(firstChest.handled, true);
  assert.equal(h.spawned.length, 1, 'Ulfric spawns on the first chest search');
  assert.equal(h.spawned[0].getId(), N.ULFRIC);
  assert.equal(h.spawned[0].getOwner(), h.player);
  assert.equal(transcripts.at(-1).variant, 'entering-the-brine-rat-cavern-opening-the-chest-inside-the-shipwreck');

  h.death(N.ULFRIC, h.spawned[0]);
  assert.equal(h.varbits.get(KILLED_VARBIT), 1, 'Ulfric death sets varbit 3539');

  const secondChest = h.object('Chest', 'Open', O.CHEST_54, new core.Location(2740, 10164, 0));
  assert.equal(secondChest.handled, true);
  assert.equal(transcripts.at(-1).variant, 'entering-the-brine-rat-cavern-opening-the-chest-inside-the-shipwreck-after-ulfric-has-been-defeated');

  const completion = h.action('QKeIBs', ULFRIC_RISE);
  assert.equal(completion.handled, true);
  assert.equal(completion.end, true);
  assert.equal(h.stage(), 80);
  assert.equal(h.varbits.get(STAGE_VARBIT), 80, 'completion writes varbit 3534 = 80, the cache threshold');
  assert.equal(h.varbits.get(TREASURE_VARBIT), 1);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.items.get(I.RUBY), 4, 'four cut rubies');
  assert.equal(h.items.get(I.COINS), 20000);
  assert.equal(h.items.get(I.PARCHMENT_2), 1);
  assert.deepEqual(h.xp.at(-1), [core.Skill.DEFENCE, 12000]);

  const rewardsBefore = new Map(h.items);
  h.action('QKeIBs', ULFRIC_RISE);
  assert.deepEqual(new Map(h.items), rewardsBefore, 'replaying completion does not duplicate rewards');
  assert.equal(h.stage(), 80);

  h.varbits.clear();
  h.login();
  assert.equal(h.varbits.get(STAGE_VARBIT), 80, 'login replays canonical completion varbit 3534 = 80');
  assert.equal(h.varbits.get(TREASURE_VARBIT), 1);
  assert.equal(h.varbits.get(KILLED_VARBIT), 1);
  assert.equal(h.varbits.get(GATE_VARBIT), 1);
  assert.equal(h.varbits.get(WALK1_VARBIT), 1);
  assert.equal(h.varbits.get(WALK2_VARBIT), 1);
  assert.equal(h.varbits.get(INGRID_VARBIT), 1);
  assert.equal(h.varbits.get(VOLF_VARBIT), 1);
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(BOTTOM_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(TOP_DISK_VARBIT), 4);
});

test('fresh stage 0 start requires The Fremennik Trials and the Yes hook advances to stage 10', () => {
  const h = setup();
  assert.equal(h.stage(), 0);
  h.setTrials(false);
  assert.equal(h.variant(OLAF), 'talking-to-olaf-if-the-fremennik-trials-has-not-been-completed');
  h.setTrials(true);
  assert.equal(h.variant(OLAF), 'talking-to-olaf-if-the-fremennik-trials-has-been-completed');
  assert.equal(h.stage(), 0, 'selecting the start variant does not itself start the quest');
  h.hook('quest:olaf-s-quest:start');
  assert.equal(h.stage(), 10);
  assert.equal(h.varbits.get(STAGE_VARBIT), 10, 'the start hook writes canonical varbit 3534 = 10');
});

test('out-of-order and pre-quest interactions are rejected', () => {
  const h = setup();
  // Not started: cave objects and skeleton deaths do nothing.
  h.death(N.SKELETON_FREMENNIK);
  assert.equal(h.ground.length, 0);
  assert.equal(h.object('Picture wall', 'Search', O.PICTURE_WALL, new core.Location(2707, 10147, 0)).handled, false);
  assert.equal(h.object('Chest', 'Open', O.CHEST_54, new core.Location(2740, 10164, 0)).handled, false);
  const gate = { player: h.player, objectId: O.GATE_163, definition: { id: O.GATE_163 }, handled: false };
  h.api.emitCustomEvent('door:toggle', gate);
  assert.equal(gate.handled, false);

  // Started but not yet delivering: no carving means the "again" dialogue, not a delivery.
  h.hook('quest:olaf-s-quest:start');
  h.setStage(20);
  assert.equal(h.variant(INGRID), 'delivering-the-presents-ingrid-s-present-talking-to-ingrid-again');
  assert.equal(h.variant(VOLF), 'delivering-the-presents-volf-s-present-talking-to-volf-again');

  // A stale sibling bit does not re-open the delivery hand-out.
  h.action('sQYWRb', VOLF);
  assert.equal(h.items.get(I.SHARK) ?? 0, 0);
});

test('lost map is reclaimable from Olaf at stage 60 and the gate key is required', () => {
  const h = setup();
  h.hook('quest:olaf-s-quest:start');
  h.setStage(60);
  assert.equal(h.variant(OLAF), 'talking-to-olaf-after-the-presents-have-been-delivered-talking-to-olaf-again-after-getting-sven-s-last-map-reclaiming-back-the-map-if-lost');
  h.action('ScOeTx');
  assert.equal(h.items.get(I.SVENS_LAST_MAP), 1);

  // At stage 70 with no key the gate stays shut and no varbit is written.
  h.setStage(70);
  h.setLocation(2724, 10168, 0);
  const gate = { player: h.player, objectId: O.GATE_163, definition: { id: O.GATE_163 }, handled: false };
  h.api.emitCustomEvent('door:toggle', gate);
  assert.equal(gate.handled, true, 'the quest owns the locked-gate message');
  assert.equal(h.varbits.get(GATE_VARBIT) ?? 0, 0);
  assert.ok(h.messages.some((m) => /gate is locked/i.test(m)));
  assert.equal(h.location().getX(), 2724, 'the player does not cross a locked gate');
});

test('banked carvings, planks and map are owned rather than replaced as lost', () => {
  const h = setup();
  const banked = new Map();
  h.player.getBanks = () => [{ getAmount: (id) => banked.get(id) ?? 0 }];

  h.setStage(20);
  banked.set(I.CRUDE_CARVING, 1);
  banked.set(I.CRUDER_CARVING, 1);
  h.variant(OLAF);
  assert.equal(h.items.get(I.CRUDE_CARVING) ?? 0, 0);
  assert.equal(h.items.get(I.CRUDER_CARVING) ?? 0, 0);

  h.setStage(40);
  banked.set(I.DAMP_PLANKS, 1);
  h.variant(OLAF);
  assert.equal(h.items.get(I.DAMP_PLANKS) ?? 0, 0);

  h.setStage(60);
  banked.set(I.SVENS_LAST_MAP, 1);
  assert.ok(!h.variant(OLAF).includes('reclaiming-back-the-map-if-lost'));
  h.action('ScOeTx'); // A stale reclaim action must also respect the banked copy.
  assert.equal(h.items.get(I.SVENS_LAST_MAP) ?? 0, 0);
});

test('a lost carving is reissued by Olaf until that present is delivered', () => {
  const h = setup();
  h.hook('quest:olaf-s-quest:start');
  h.setStage(20);

  // Both carvings were lost/destroyed before delivery: talking to Olaf restores them.
  assert.equal(h.variant(OLAF), 'delivering-the-presents-talking-to-olaf-again');
  assert.equal(h.items.get(I.CRUDE_CARVING), 1, 'crude carving is reissued by Olaf');
  assert.equal(h.items.get(I.CRUDER_CARVING), 1, 'cruder carving is reissued by Olaf');

  // Once a carving is delivered, Olaf must not reissue that one.
  h.action('cWJG2g', INGRID);
  assert.equal(h.items.get(I.CRUDE_CARVING) ?? 0, 0);
  h.variant(OLAF);
  assert.equal(h.items.get(I.CRUDE_CARVING) ?? 0, 0, 'a delivered carving is not reissued');
  assert.equal(h.items.get(I.CRUDER_CARVING), 1, 'the undelivered carving is still held');
});


test('completion rewards drop at the player instead of vanishing when the bag is full', () => {
  const h = setup();
  h.hook('quest:olaf-s-quest:start');
  h.setStage(70);
  // Fill every slot before the final hand-in.
  while (h.player.getInventory().getFreeSlots() > 0) h.give(I.BONES, 1);
  assert.equal(h.player.getInventory().isFull(), true);

  h.action('QKeIBs', ULFRIC_RISE);
  assert.equal(h.stage(), 80);
  assert.equal(h.dropped.filter((entry) => entry.id === I.RUBY).reduce((sum, entry) => sum + entry.amount, 0), 4,
    'the three onReward rubies and the runtime reward ruby all drop');
  assert.ok(h.dropped.some((entry) => entry.id === I.COINS && entry.amount === 20000), 'coins drop');
  assert.ok(h.dropped.some((entry) => entry.id === I.PARCHMENT_2 && entry.amount === 1), 'parchment drops');
});

test('completion preserves all four ruby rewards with one or two free slots', () => {
  for (const freeSlots of [1, 2]) {
    const h = setup();
    h.setStage(70);
    h.setFreeSlots(freeSlots);

    h.action('QKeIBs', ULFRIC_RISE);

    const carried = h.items.get(I.RUBY) ?? 0;
    const dropped = h.dropped
      .filter((entry) => entry.id === I.RUBY)
      .reduce((sum, entry) => sum + entry.amount, 0);
    assert.equal(carried + dropped, 4, `all rubies are accounted for with ${freeSlots} free slots`);
  }
});

test('lost damp planks are reissued by Olaf until the fire is lit', () => {
  const h = setup();
  h.hook('quest:olaf-s-quest:start');
  h.setStage(40);
  assert.equal(h.items.get(I.DAMP_PLANKS) ?? 0, 0);
  assert.equal(h.variant(OLAF), 'talking-to-olaf-after-the-presents-have-been-delivered-talking-to-olaf-again-if-the-fire-has-not-lighten-up');
  assert.equal(h.items.get(I.DAMP_PLANKS), 1, 'Olaf reissues damp planks');

  // Once the fire is lit the planks are not reissued.
  h.setStage(50);
  h.items.delete(I.DAMP_PLANKS);
  h.variant(OLAF);
  assert.equal(h.items.get(I.DAMP_PLANKS) ?? 0, 0, 'lit fire does not reissue planks');
});

test('picture wall uses cache interface 253, rotates the four disks, and persists across cancel/relog', () => {
  const h = setup();
  h.setStage(70);
  const wallLoc = new core.Location(2707, 10147, 0);
  h.setLocation(2707, 10146, 0);
  h.object('Picture wall', 'Search', O.PICTURE_WALL, wallLoc);
  h.object('Picture wall', 'Search', O.PICTURE_WALL, wallLoc);
  assert.ok(h.calls.some(([name, id]) => name === 'sendInterface' && id === WALL_INTERFACE));

  const wallModelCall = (component) => h.calls
    .filter(([name, script, uid]) => name === 'sendClientScript' && script === 233 && uid === ((WALL_INTERFACE << 16) | component))
    .at(-1);
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.right)[3], 24136);
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.right)[7], 512, 'right starts one quarter turn from solved');
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.top)[3], 24138);
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.top)[7], 1024, 'top starts two quarter turns from solved');
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.left)[3], 24135);
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.left)[7], 1536, 'left starts three quarter turns from solved');
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.bottom)[3], 24134);
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.bottom)[7], 1024, 'bottom starts two quarter turns from solved');

  h.click(WALL_INTERFACE, WALL_BUTTONS.right);
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 2);
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.right)[7], 0, 'solved disk has the cache zero angle');
  assert.equal(wallModelCall(WALL_DISK_COMPONENTS.left)[7], 1024, 'left disk turns with the right lever');

  // Cancelling and reopening the interface keeps the durable disk state.
  h.object('Picture wall', 'Search', O.PICTURE_WALL, wallLoc);
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 2);

  // Relogin replay sends the same disk varbits from the persisted wall state.
  h.varbits.clear();
  h.login();
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 2);
  assert.equal(h.varbits.get(BOTTOM_DISK_VARBIT), 2);
  assert.equal(h.varbits.get(TOP_DISK_VARBIT), 2);

  h.click(WALL_INTERFACE, WALL_BUTTONS.top);
  h.click(WALL_INTERFACE, WALL_BUTTONS.left);
  h.click(WALL_INTERFACE, WALL_BUTTONS.bottom);
  h.click(WALL_INTERFACE, WALL_BUTTONS.confirm);
  assert.equal(h.varbits.get(RIGHT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(BOTTOM_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(LEFT_DISK_VARBIT), 4);
  assert.equal(h.varbits.get(TOP_DISK_VARBIT), 4);
  assert.equal(transcripts.at(-1).variant, 'entering-the-brine-rat-cavern-opening-the-picture-wall');
});

test('gate keyhole selection requires the held key, survives cancel, and a lost key drops again', () => {
  const h = setup();
  h.setStage(70);
  h.setLocation(2724, 10168, 0);
  const gate = { player: h.player, objectId: O.GATE_163, definition: { id: O.GATE_163 }, handled: false };
  h.api.emitCustomEvent('door:toggle', gate);
  assert.equal(gate.handled, true);
  assert.ok(!h.calls.some(([name, id]) => name === 'sendInterface' && id === GATE_INTERFACE), 'a keyless gate does not open the keyhole interface');
  assert.ok(h.messages.some((message) => /gate is locked/.test(message)));

  h.death(N.SKELETON_FREMENNIK);
  assert.equal(h.ground.length, 1, 'a skeleton drops a key');
  // Simulate destroying the first key before it is picked up or used.
  h.death(N.SKELETON_FREMENNIK);
  assert.equal(h.ground.length, 2, 'another skeleton drops a replacement key');
  const keyId = h.ground[1].id;
  h.give(keyId, 1);

  // The QH route uses the key on the gate.
  const useKey = h.itemOnObject(keyId, O.GATE_163, 'Gate');
  assert.equal(useKey.handled, true);
  assert.ok(h.calls.some(([name, id]) => name === 'sendInterface' && id === GATE_INTERFACE));
  assert.ok(h.calls.some(([name, uid, itemId]) => name === 'sendInterfaceModel' && uid === ((GATE_INTERFACE << 16) | GATE_KEY_COMPONENT) && itemId === keyId));

  // Cancelling and reopening does not consume or lose the key.
  const cancel = h.interfaceClick((GATE_INTERFACE << 16) | 1);
  assert.equal(cancel.handled, false, 'the close button is left to the cache close script');
  const reopen = { player: h.player, objectId: O.GATE_163, definition: { id: O.GATE_163 }, handled: false };
  h.api.emitCustomEvent('door:toggle', reopen);
  assert.equal(h.items.get(keyId), 1, 'the key survives a cancelled interface');
  assert.ok(h.calls.filter(([name, id]) => name === 'sendInterface' && id === GATE_INTERFACE).length >= 2, 'the keyhole interface can be reopened');

  const correct = keyholeComponent(keyId);
  const wrong = KEYHOLES.find((entry) => entry.component !== correct);

  h.click(GATE_INTERFACE, wrong.component, 2);
  assert.equal(h.items.get(keyId), 1, 'a non-Op1 action does not consume the key');
  assert.equal(h.varbits.get(GATE_VARBIT) ?? 0, 0, 'a non-Op1 action does not open the gate');

  h.click(GATE_INTERFACE, wrong.component);
  assert.equal(h.items.get(keyId), 1, 'the wrong shape does not consume the key');
  assert.equal(h.varbits.get(GATE_VARBIT) ?? 0, 0);
  assert.ok(!h.calls.some(([name, id]) => name === 'closeInterface' && id === GATE_INTERFACE), 'the wrong shape keeps the interface open');

  h.click(GATE_INTERFACE, correct);
  assert.equal(h.items.get(keyId) ?? 0, 0, 'the matching key is consumed');
  assert.equal(h.varbits.get(GATE_VARBIT), 1);
  assert.equal(h.location().getX(), 2726);
});

test('gate Open object path also uses cache interface 252 and locks before stage 70', () => {
  const h = setup();
  const gate = h.object('Gate', 'Open', O.GATE_163, new core.Location(2724, 10168, 0));
  assert.equal(gate.handled, false, 'the gate is not usable before the cavern stage');

  h.setStage(70);
  h.setLocation(2724, 10168, 0);
  h.give(I.KEY_12, 1);
  const open = h.object('Gate', 'Open', O.GATE_163, new core.Location(2724, 10168, 0));
  assert.equal(open.handled, true);
  assert.ok(h.calls.some(([name, id]) => name === 'sendInterface' && id === GATE_INTERFACE));
  assert.equal(h.varbits.get(GATE_VARBIT) ?? 0, 0);
  h.click(GATE_INTERFACE, 10); // cross keyhole (KEY_12)
  assert.equal(h.items.get(I.KEY_12) ?? 0, 0);
  assert.equal(h.varbits.get(GATE_VARBIT), 1);
});

test('the key used on the gate must match the chosen keyhole, even when another key is held', () => {
  const h = setup();
  h.setStage(70);
  h.setLocation(2724, 10168, 0);
  h.give(I.KEY_12, 1); // cross
  h.give(I.KEY_16, 1); // star
  const useKey = h.itemOnObject(I.KEY_16, O.GATE_163, 'Gate');
  assert.equal(useKey.handled, true);
  assert.ok(h.calls.some(([name, uid, itemId]) => name === 'sendInterfaceModel' && uid === ((GATE_INTERFACE << 16) | GATE_KEY_COMPONENT) && itemId === I.KEY_16), 'the interface shows the key that was used');

  h.click(GATE_INTERFACE, 10); // cross is held, but the star key is the one in the lock
  assert.equal(h.items.get(I.KEY_12), 1);
  assert.equal(h.items.get(I.KEY_16), 1);
  assert.equal(h.varbits.get(GATE_VARBIT) ?? 0, 0);

  h.click(GATE_INTERFACE, 13); // star
  assert.equal(h.items.get(I.KEY_16) ?? 0, 0, 'the matching key is consumed');
  assert.equal(h.items.get(I.KEY_12), 1, 'the other held key is untouched');
  assert.equal(h.varbits.get(GATE_VARBIT), 1);
});
