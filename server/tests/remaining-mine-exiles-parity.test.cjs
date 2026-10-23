const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  require('../dist/game/collision/RegionManager').RegionManager.init();
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
});

function setup(pluginPath, questKey, options = {}) {
  const waterbirth = options.waterbirth === true;
  const realDoors = options.realDoors === true;
  const hooks = { custom: new Map(), variants: [], conditions: [], namedNpcs: new Map(), objects: [], itemOnObject: [], itemOnItem: [], itemActions: new Map(), deaths: [], hits: [], logins: [], logouts: [], teleports: [], interfaceButtons: new Map(), npcRoutes: [] };
  const tasks = [], spawned = [], removed = [], messages = [], xp = [], menus = [];
  const objects = [], registrations = [], groundItems = new Map();
  let npcsNear = [], players = [], weaponId = -1, special = 100;
  let tick = 0;
  const core = {
    ...PluginManager.getCoreApi(),
    CountdownTask: class { constructor(player, ticks, run) { Object.assign(this, { player, ticks, run }); } stop() {} },
    TaskManager: { submit(task) { task.due = tick + task.ticks; tasks.push(task); }, cancelTasks() {} },
    ObjectManager: waterbirth ? {
      deregister(object) { const at = objects.indexOf(object); if (at >= 0) objects.splice(at, 1); },
      register(object) { objects.push(object); registrations.push(object); },
      objectsAt(location) {
        if (!location) return objects.slice();
        return objects.filter((object) => {
          const at = object.getLocation?.();
          return at && at.getX() === location.getX() && at.getY() === location.getY() && at.getZ() === location.getZ();
        });
      },
    } : { deregister() {} },
  };
  if (waterbirth) {
    if (realDoors) {
      const realObjectManager = require('../dist/game/entity/impl/object/ObjectManager').ObjectManager;
      const realMapObjects = require('../dist/game/entity/impl/object/MapObjects').MapObjects;
      core.ObjectManager = realObjectManager;
      core.MapObjects = realMapObjects;
    } else {
      core.MapObjects = {
        get(id, location) {
          return objects.find((object) => object.getId?.() === id && object.getLocation?.().equals(location)) ?? null;
        },
      };
    }
    core.ItemOnGroundManager = {
      registerLocation(player, item, location) {
        groundItems.set(`${location.getX()},${location.getY()},${location.getZ()},${item.getId()}`, { player, item, location });
      },
      getGroundItem(playerName, itemId, location) {
        return groundItems.get(`${location.getX()},${location.getY()},${location.getZ()},${itemId}`) ?? null;
      },
    };
    core.World = PluginManager.getCoreApi().World;
    core.World.getNpcsNear = () => npcsNear.slice();
    core.World.getPlayers = () => players.slice();
    core.Task = class {
      constructor(ticks, key) { this.ticks = ticks; this.key = key; }
      stop() {}
      run() { this.execute?.(); }
    };
  }
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(target, actions) { if (typeof target === 'string') hooks.namedNpcs.set(target, actions); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onItemOnItem(fn) { hooks.itemOnItem.push(fn); },
    onItemAction(name, actions) { hooks.itemActions.set(name, actions); },
    onNpcDeath(fn) { hooks.deaths.push(fn); },
    onNpcHitModify(fn) { hooks.hits.push(fn); },
    onInterfaceActionButton(ids, fn) { for (const id of Array.isArray(ids) ? ids : [ids]) hooks.interfaceButtons.set(id, fn); },
    onCanTeleport(fn) { hooks.teleports.push(fn); },
    onNpcRoute(fn) { hooks.npcRoutes.push(fn); },
    onPlayerLogin(fn) { hooks.logins.push(fn); },
    onPlayerLogout(fn) { hooks.logouts.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') { event.complete = true; return; }
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    spawnNpc(def) {
      let tile = new core.Location(def.x, def.y, def.z ?? 0);
      const npc = { def, getId: () => def.id, getContentId: () => def.id, getOwner: () => def.owner,
        getHitpoints: () => 40, isRegistered: () => true, isNpc: () => true, isPlayer: () => false,
        getLocation: () => tile, moveTo(value) { tile = value; }, setArea() {}, getArea: () => null,
        getMovementQueue: () => ({ addFirstStep() {} }), performAnimation(animation) { npc.animation = animation?.id; },
        forceChat(text) { npc.chat = text; }, setPositionToFace() {} };
      spawned.push(npc); return npc;
    },
    removeNpc(npc) { removed.push(npc); },
    getItemOnGroundManager() { return { registerLocation() {} }; },
    sendMultiChatboxPrompt(player, title, ...pairs) { menus.push({ player, title, pairs }); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  require(pluginPath)(api);
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === questKey).at(-1);
  const attrs = new Map(), inventory = new Map(), varbits = new Map(), configs = new Map(), subInterfaces = new Map();
  const cameras = { moves: [], looks: [], resets: 0, shakes: [] };
  let location = new core.Location(2659, 3669, 0), current = null;
  const skillLevels = new Map();
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendInterfaceRemoval() { current = null; return sender; },
    sendSubInterface(target, group, type) { subInterfaces.set(group, { target, type }); return sender; },
    sendCameraMoveTo(...args) { cameras.moves.push(args); return sender; },
    sendCameraLookAt(...args) { cameras.looks.push(args); return sender; },
    sendCameraReset() { cameras.resets += 1; return sender; },
    sendCameraShake(...args) { cameras.shakes.push(args); return sender; },
    closeInterface(group) { subInterfaces.delete(group); return sender; },
    sendJingle() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getAttribute: (key) => attrs.get(key), setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    sendMessage(message) { messages.push(message); },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      add(id, count = 1) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
      adds(id, count = 1) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      getFreeSlots: () => 28 - [...inventory.values()].filter((count) => count > 0).length,
      forceAdd(_player, item) { inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()); },
    }),
    getEquipment: waterbirth
      ? () => ({ get: (slot) => ({ getId: () => slot === 3 ? weaponId : -1 }), contains: () => false })
      : () => ({ get: () => ({ getId: () => -1 }) }),
    getBank: () => ({ contains: () => false }),
    ...(waterbirth ? {
      getPrivateArea: () => null,
      getSpecialPercentage: () => special,
      decrementSpecialPercentage(amount) { special = Math.max(0, special - amount); },
    } : {}),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => skillLevels.get(skill) ?? 99,
      getMaxLevel: (skill) => skillLevels.get(skill) ?? 99,
      setCurrentLevelCombat(skill, value) { skillLevels.set(skill, value); },
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getLocation: () => location, moveTo(value) { location = value; },
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }), setUntargetable() {},
    getUsername: () => 'tester', getAppearance: () => ({ isMale: () => true }), getPositionToFace: () => null,
    getDialogueManager: () => ({ startDialogues(chain) { current = chain; }, getCurrent: () => current, reset() { current = null; }, isActive: () => Boolean(current), advance() {} }),
    isPlayer: () => true, isNpc: () => false, isRegistered: () => true, isPlayerBot: () => false,
  };
  const event = (name, payload) => ({ player, handled: false, ...payload });
  return {
    api, core, hooks, quest, attrs, inventory, varbits, configs, subInterfaces, cameras, messages, xp, tasks, spawned, removed, menus,
    objects, registrations, groundItems,
    player, setLocation: (value) => { location = value; }, setSkill(skill, level) { skillLevels.set(skill, level); },
    setWeapon(id) { weaponId = id; }, setSpecial(value) { special = value; }, setNpcsNear(value) { npcsNear = value; },
    setPlayers(value) { players = value; },
    object(objectId, extra = {}) { const e = event('object', { objectId, location, ...extra }); for (const fn of hooks.objects) fn(e); return e; },
    itemOnObject(itemId, objectId, extra = {}) {
      const e = event('item-on-object', { itemId, objectId, ...extra });
      for (const fn of hooks.itemOnObject) fn(e);
      return e;
    },
    action(npcId, stepId, text, kind = 'action') {
      const e = event('action', { npcId, stepId, text, kind });
      api.emitCustomEvent('npc-dialogue:action', e);
      return e;
    },
    line(npcId, text) {
      const e = event('line', { npcId, text });
      api.emitCustomEvent('npc-dialogue:line', e);
      return e;
    },
    choice(npcId, option) { api.emitCustomEvent('npc-dialogue:choice', event('choice', { npcId, option })); },
    death(npcId, npc) { for (const fn of hooks.deaths) fn(event('death', { npcId, npc, killer: player })); },
    npcRoute(event) { for (const fn of hooks.npcRoutes) fn(event); return event; },
    hit(npcId, npc) { for (const fn of hooks.hits) fn({ npc: npc ?? { getId: () => npcId, getContentId: () => npcId }, hit: { getAttacker: () => player } }); },
    tick(count) { while (count-- > 0) { tick++; for (const task of [...tasks]) { if (!task.__done && task.due <= tick) { task.__done = true; task.run(); } } } },
    interfaceButton(buttonId, action = 1) { const fn = hooks.interfaceButtons.get(buttonId); assert.ok(fn, `missing interface hook ${buttonId}`); fn(event('button', { buttonId, action })); },
    menu(label) {
      const menu = menus.at(-1);
      assert.ok(menu, 'expected an open chatbox prompt');
      const at = menu.pairs.indexOf(label);
      assert.ok(at >= 0, `expected menu option ${label}`);
      const fn = menu.pairs[at + 1];
      menus.pop();
      fn();
    },
  };
}

const ITEMS = (h) => h.core.ItemIdentifiers;
const NPCS = (h) => h.core.NpcIdentifiers;
const OBJECTS = (h) => h.core.ObjectIdentifiers;
const HM_BITS = 'quest.haunted_mine.bits';

test('Haunted Mine captured stage route reaches the shard once through real interactions', () => {
  const h = setup('../plugins/quests/quests/HauntedMine.Quest', 'haunted_mine');
  const I = ITEMS(h), N = NPCS(h), O = OBJECTS(h);
  h.setSkill(h.core.Skill.CRAFTING, 35);
  h.player.setAttribute('quest.points', 0);

  h.api.emitCustomEvent('npc-dialogue:hook', { player: h.player, npcId: N.ZEALOT, hook: 'quest:haunted-mine:start' });
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(h.player.getAttribute('haunted-mine:schema'), 1, 'new native saves are marked');
  assert.equal(h.hooks.namedNpcs.get('Zealot').Pickpocket({ player: h.player, npcId: N.ZEALOT }), undefined);
  assert.equal(h.inventory.get(I.ZEALOTS_KEY), 1);
  assert.equal(h.varbits.get(2397), 1, 'heard-about-key varbit follows the start');

  h.object(O.CART_TUNNEL);
  assert.equal(h.quest.getStage(h.player), 3, 'first mine entrance is the captured second entrance');

  h.inventory.set(I.GLOWING_FUNGUS, 1);
  h.itemOnObject(I.GLOWING_FUNGUS, O.MINE_CART_6, { object: { getLocation: () => new h.core.Location(2778, 4506, 0) } });
  assert.equal(h.inventory.get(I.GLOWING_FUNGUS), 0);
  h.object(O.LEVER_28);
  assert.equal(h.player.getAttribute(HM_BITS) & 2, 0, 'an unsolved junction leaves the cart put');
  h.object(O.POINTS_SETTINGS);
  assert.ok(h.subInterfaces.has(144), 'the captured points-settings interface opens');
  h.interfaceButton((144 << 16) | 155);
  h.tick(9);
  assert.ok(h.cameras.moves.length >= 2 && h.cameras.looks.length >= 2, 'captured cart camera tracks play');
  assert.equal(h.spawned.filter((npc) => npc.getId() === 3610).length, 2, 'both captured cart actors appear');
  assert.equal(h.cameras.resets, 1, 'camera resets after the cart tutorial');
  assert.equal(h.quest.getStage(h.player), 3, 'cart puzzle must not invent a stage');
  h.object(O.LEVER_28);
  h.object(O.LEVER_26);
  assert.equal(h.varbits.get(2385), 1, 'physical lever A drives cache varbit HAUNTEDMINE_LEVER_B');
  assert.equal(h.varbits.get(2386), 0, 'physical lever A never touches cache varbit HAUNTEDMINE_LEVER_A');
  assert.equal(h.player.getAttribute('haunted-mine:levers') & 3, 1, 'pulling A alone only sets the varbit-B rail bit');
  h.object(O.LEVER_27);
  assert.equal(h.varbits.get(2386), 1, 'physical lever B drives cache varbit HAUNTEDMINE_LEVER_A');
  assert.equal(h.player.getAttribute('haunted-mine:levers') & 3, 3, 'A and B keep their own internal rail bits');
  h.object(O.LEVER_30);
  h.object(O.LEVER_31);
  assert.equal(h.player.getAttribute(HM_BITS) & 2, 2, 'the solved junction sends the fungus cart across');
  h.object(O.MINE_CART_6, { object: { getLocation: () => new h.core.Location(2774, 4537, 0) } });
  h.action(N.ZEALOT, 'Rx786B');
  assert.equal(h.inventory.get(I.GLOWING_FUNGUS), 1);

  h.itemOnObject(I.ZEALOTS_KEY, O.WATER_VALVE);
  assert.equal(h.inventory.get(I.ZEALOTS_KEY), 0);
  h.action(N.ZEALOT, 'TbCdkn', 'You open the valve.', 'message');
  h.tick(20);
  const ghost = h.spawned.find((npc) => npc.getId() === 3627);
  assert.ok(ghost, 'the captured ghost actor appears');
  assert.deepEqual([ghost.getLocation().getX(), ghost.getLocation().getY()], [2802, 4516]);
  assert.equal(ghost.chat, 'Ooooo Wooooo Woo');
  assert.equal(ghost.animation, 5478);
  h.tick(2);
  assert.ok(ghost.getLocation().getY() < 4516, 'ghost walks the captured route toward the valve');
  h.object(O.LIFT_2);
  assert.equal(h.quest.getStage(h.player), 5, 'lift ride is captured stage 5');

  const beforeStairs = h.player.getLocation();
  h.object(O.STAIRS_29);
  assert.equal(h.quest.getStage(h.player), 7);
  assert.equal(h.player.getLocation(), beforeStairs, 'quest code leaves transport to LocTeleports');
  h.object(O.STAIRS_29);
  assert.equal(h.quest.getStage(h.player), 7, 're-entering the stairs is stable');

  h.player.getDialogueManager().reset();
  h.hooks.namedNpcs.get('Innocent-looking key').Take({ player: h.player, npcId: N.INNOCENT_LOOKING_KEY });
  h.action(N.INNOCENT_LOOKING_KEY, 'jQG-HE', 'Treus Dayth appears.');
  assert.equal(h.quest.getStage(h.player), 8);
  const treus = h.spawned.find((npc) => npc.getId() === N.TREUS_DAYTH);
  assert.ok(treus, 'first key attempt wakes Treus Dayth');
  assert.deepEqual([treus.getLocation().getX(), treus.getLocation().getY()], [2788, 4458]);
  assert.equal(treus.animation, 1437, 'Treus plays the captured spawn sequence');
  assert.ok(h.cameras.moves.length >= 3, 'Treus spawn sends captured camera moves');
  h.death(N.TREUS_DAYTH, treus);
  assert.equal(h.quest.getStage(h.player), 9, 'Quest Helper killed-Dayth predicate is >=9');

  h.hooks.namedNpcs.get('Innocent-looking key').Take({ player: h.player, npcId: N.INNOCENT_LOOKING_KEY });
  assert.equal(h.inventory.get(I.CRYSTAL_MINE_KEY), 1);
  assert.equal(h.quest.getStage(h.player), 10);

  h.inventory.set(I.CHISEL, 1);
  h.object(O.CRYSTAL_OUTCROP);
  h.action(N.ZEALOT, 'mFurEC');
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.inventory.get(I.SALVE_SHARD), 1);
  const points = h.player.getAttribute('quest.points');
  h.object(O.CRYSTAL_OUTCROP);
  h.action(N.ZEALOT, 'mFurEC');
  assert.equal(h.inventory.get(I.SALVE_SHARD), 2, 'the outcrop remains cuttable after the quest');
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.player.getAttribute('quest.points'), points, 'repeat shards never pay points again');
  assert.equal(h.xp.filter((entry) => entry.skill === h.core.Skill.STRENGTH).length, 1, 'repeat shards never pay XP again');
});

test('Haunted Mine physical A/B levers bind to the crossed cache varbits Quest Helper uses', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const varbitB = CacheDefinitions.getVarbit(2385);
  const varbitA = CacheDefinitions.getVarbit(2386);
  assert.equal(varbitB.baseVar, 383, 'HAUNTEDMINE_LEVER_B lives on varp 383');
  assert.equal(varbitB.startBit, 1, 'HAUNTEDMINE_LEVER_B is bit 1');
  assert.equal(varbitA.baseVar, 383, 'HAUNTEDMINE_LEVER_A lives on varp 383');
  assert.equal(varbitA.startBit, 2, 'HAUNTEDMINE_LEVER_A is bit 2');
  RegionManager.loadMapFiles(2785, 4517);
  const objectsAt = (x, y) => (MapObjects.mapObjects.get(MapObjects.getHash(x, y, 0)) ?? []).map((object) => object.getId());
  assert.ok(objectsAt(2785, 4517).includes(4950), 'physical lever A object 4950 stands at Quest Helper pull A');
  assert.ok(objectsAt(2784, 4517).includes(4951), 'physical lever B object 4951 stands at Quest Helper pull B');
  assert.equal(CacheDefinitions.getObject(4950).name, 'Lever');
  assert.equal(CacheDefinitions.getObject(4951).name, 'Lever');

  const h = setup('../plugins/quests/quests/HauntedMine.Quest', 'haunted_mine');
  h.quest.setStage(h.player, 1);
  h.object(4950);
  assert.equal(h.varbits.get(2385), 1, 'A drives varbit B');
  assert.equal(h.varbits.get(2386), undefined, 'A never drives varbit A');
  h.object(4950);
  assert.equal(h.varbits.get(2385), 0, 'A toggles back off');
  h.object(4951);
  assert.equal(h.varbits.get(2386), 1, 'B drives varbit A');
  assert.equal(h.varbits.get(2385), 0, 'B never drives varbit B');
  h.object(4950);
  h.hooks.logins[0]({ player: h.player });
  assert.equal(h.varbits.get(2385), 1, 'login restores lever A through varbit B');
  assert.equal(h.varbits.get(2386), 1, 'login restores lever B through varbit A');
});

test('Haunted Mine recovery: relog resends captured varps and spares a second key', () => {
  const h = setup('../plugins/quests/quests/HauntedMine.Quest', 'haunted_mine');
  const I = ITEMS(h), N = NPCS(h);
  h.quest.setStage(h.player, 9);
  h.player.setAttribute(HM_BITS, 0);
  h.inventory.set(I.CRYSTAL_MINE_KEY, 1);
  h.hooks.namedNpcs.get('Innocent-looking key').Take({ player: h.player, npcId: N.INNOCENT_LOOKING_KEY });
  assert.equal(h.inventory.get(I.CRYSTAL_MINE_KEY), 1);
  for (const login of h.hooks.logins) login({ player: h.player });
  assert.equal(h.configs.get(382), 9);
  h.hooks.logouts[0]({ player: h.player });
});

test('Haunted Mine legacy saves migrate once without replaying completion rewards', () => {
  for (const [legacy, expected] of [[5, 8], [7, 10], [8, 11]]) {
    const h = setup('../plugins/quests/quests/HauntedMine.Quest', 'haunted_mine');
    h.quest.setStage(h.player, legacy);
    h.player.setAttribute('quest.points', 0);
    h.hooks.logins[0]({ player: h.player });
    assert.equal(h.quest.getStage(h.player), expected, `legacy ${legacy} maps to ${expected}`);
    assert.equal(h.player.getAttribute('quest.points'), 0, 'migration must not pay quest points');
    assert.equal(h.xp.length, 0, 'migration must not pay XP');
    assert.equal(h.player.getAttribute('haunted-mine:schema'), 1);
    h.hooks.logins[0]({ player: h.player });
    assert.equal(h.quest.getStage(h.player), expected, 'relog repeats no migration');
  }
  const native = setup('../plugins/quests/quests/HauntedMine.Quest', 'haunted_mine');
  native.player.setAttribute('haunted-mine:schema', 1);
  native.quest.setStage(native.player, 8);
  native.hooks.logins[0]({ player: native.player });
  assert.equal(native.quest.getStage(native.player), 8, 'new native stage 8 is Treus, not legacy complete');
});

test('Haunted Mine stairs cannot start or skip an ineligible quest', () => {
  const h = setup('../plugins/quests/quests/HauntedMine.Quest', 'haunted_mine');
  const O = OBJECTS(h);
  h.object(O.STAIRS_29);
  assert.equal(h.quest.getStage(h.player), 0, 'before start stairs never start the quest');
  h.quest.setStage(h.player, 1);
  h.object(O.STAIRS_29);
  assert.equal(h.quest.getStage(h.player), 1, 'started but not on the flooded level stays put');
  h.quest.setStage(h.player, 5);
  h.player.setAttribute(HM_BITS, 0);
  h.object(O.STAIRS_29);
  assert.equal(h.quest.getStage(h.player), 5, 'stage 5 without the lift bit is locked');
  h.player.setAttribute(HM_BITS, 1 << 5);
  h.object(O.STAIRS_29);
  assert.equal(h.quest.getStage(h.player), 7);
  h.quest.setStage(h.player, 11);
  h.object(O.STAIRS_29);
  assert.equal(h.quest.getStage(h.player), 11, 'completed players never re-enter the encounter stage');
});

test('Haunted crystal shortcut cannot complete before the crystal-key stage', () => {
  const h = setup('../plugins/quests/quests/HauntedMine.Quest', 'haunted_mine');
  const I = ITEMS(h), N = NPCS(h), O = OBJECTS(h);
  const cut = require('../data/definitions/npc-dialogues.json')['Haunted Mine']
    .variants['inside-the-mine-chiseling-a-crystal-outcrop'];
  assert.ok(JSON.stringify(cut).includes('mFurEC'), 'the real crystal transcript contains the completion action');
  const shortcut = require('../plugins/world/data/loc-teleports.json');
  const shortcutRows = Array.isArray(shortcut) ? shortcut : Object.values(shortcut).flat();
  assert.ok(shortcutRows.some((row) => row.id === 29332 && row.to?.[0] === 2800 && row.to?.[1] === 4429),
    'canonical 29332 shortcut reaches the crystal room');
  h.setSkill(h.core.Skill.CRAFTING, 35);
  h.inventory.set(I.CHISEL, 1);
  h.player.setAttribute('quest.points', 0);

  h.object(O.CRYSTAL_OUTCROP);
  h.action(N.ZEALOT, 'mFurEC');
  assert.equal(h.quest.getStage(h.player), 0, 'stage 0 shortcut cut cannot complete');
  assert.equal(h.inventory.get(I.SALVE_SHARD), undefined);
  assert.equal(h.xp.length, 0);

  h.quest.setStage(h.player, 1);
  h.object(O.CRYSTAL_OUTCROP);
  h.action(N.ZEALOT, 'mFurEC');
  assert.equal(h.quest.getStage(h.player), 1, 'early quest without crystal key cannot complete');

  h.quest.setStage(h.player, 10);
  h.object(O.CRYSTAL_OUTCROP);
  h.action(N.ZEALOT, 'mFurEC');
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.inventory.get(I.SALVE_SHARD), 1);
});

test('Fremennik Exiles requirements follow Quest Helper (no Trials, Mining 60)', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  const N = NPCS(h), S = h.core.Skill;
  h.inventory.set(ITEMS(h).SEAL_OF_PASSAGE, 1);
  h.setSkill(S.CRAFTING, 65); h.setSkill(S.SLAYER, 60); h.setSkill(S.SMITHING, 60);
  h.setSkill(S.FISHING, 60); h.setSkill(S.RUNECRAFTING, 55); h.setSkill(S.MINING, 59);
  h.api.emitCustomEvent('quest:is-complete', { player: h.player, key: 'fremennik_trials', complete: true });
  assert.equal(h.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({ player: h.player, npcId: N.BRUNDT_THE_CHIEFTAIN_6 }), false);
  h.setSkill(S.MINING, 60);
  assert.equal(h.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({ player: h.player, npcId: N.BRUNDT_THE_CHIEFTAIN_6 }), true);
  h.choice(N.BRUNDT_THE_CHIEFTAIN_6, 'Yes.');
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.player.getAttribute('the-fremennik-exiles:schema'), 1, 'new native saves are marked');
  h.line(N.BRUNDT_THE_CHIEFTAIN_6, 'Freygerd and Reeso run the sandpit a little north of here.');
  assert.equal(h.quest.getStage(h.player), 10);
});

test('Fremennik Exiles captured stages: exile, shield, kegs, invasion, island, prison, finish', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  const I = ITEMS(h), N = NPCS(h), O = OBJECTS(h);
  h.quest.setStage(h.player, 10);

  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.FREYGERD_2 }), 'investigating-the-disturbance-freygerd');
  assert.equal(h.quest.getStage(h.player), 15);
  for (const id of [I.UNSEALED_LETTER, I.VENOM_GLAND, I.FANG]) h.inventory.set(id, 1);
  h.hooks.variants[0]({ player: h.player, npcId: N.FREYGERD_2 });
  assert.equal(h.quest.getStage(h.player), 20);
  assert.equal(h.inventory.get(I.UNSEALED_LETTER), 0);

  assert.equal(h.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({ player: h.player, npcId: N.BRUNDT_THE_CHIEFTAIN_6 }), true);
  h.action(N.BRUNDT_THE_CHIEFTAIN_6, '3GZ_6N');
  assert.equal(h.quest.getStage(h.player), 35);

  assert.equal(h.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({ player: h.player, npcId: N.BRUNDT_THE_CHIEFTAIN_8 }), true);
  assert.equal(h.quest.getStage(h.player), 40, 'first exiled talk is captured stage 40');
  for (const option of ['Where can I find a Fremennik Shield?', 'Where can I get Lunar Glass?', 'How do I make the Polishing Rock?', "How do I make V's Sigil?"]) {
    h.choice(N.BRUNDT_THE_CHIEFTAIN_8, option);
  }
  assert.equal(h.quest.getStage(h.player), 50, 'all four component questions reach stage 50');
  assert.ok(h.spawned.some((npc) => npc.getId() === N.FOSSEGRIMEN), 'Fossegrimen is spawned for the sigil hand-in');
  assert.equal(h.hooks.namedNpcs.get('Fossegrimen')['Talk-to']({ player: h.player, npcId: N.FOSSEGRIMEN }), true);
  for (const id of [I.FREMENNIK_SHIELD, I.LUNAR_GLASS, I.POLISHING_ROCK, I.V_SIGIL_E_, I.GLASSBLOWING_PIPE]) h.inventory.set(id, 1);
  h.action(N.BRUNDT_THE_CHIEFTAIN_8, 'mOTzCI');
  assert.equal(h.inventory.get(I.VS_SHIELD_2), 1);
  assert.equal(h.quest.getStage(h.player), 50, 'shield assembly is still stage 50');
  h.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({ player: h.player, npcId: N.BRUNDT_THE_CHIEFTAIN_8 });
  h.action(N.BRUNDT_THE_CHIEFTAIN_8, 'jcMyFM');
  assert.equal(h.quest.getStage(h.player), 55);
  h.line(N.BRUNDT_THE_CHIEFTAIN_8, 'Return to me with two beers. No... Two kegs of beer!');
  assert.equal(h.quest.getStage(h.player), 60);
  h.inventory.set(I.KEG_OF_BEER_2, 2);
  h.action(N.BRUNDT_THE_CHIEFTAIN_8, 'CyJ-jx');
  assert.equal(h.quest.getStage(h.player), 65);
  h.action(N.BRUNDT_THE_CHIEFTAIN_8, 'F4atZx', 'The chieftain quickly drinks the second keg and stumbles off.', 'message');
  assert.equal(h.quest.getStage(h.player), 70);
  assert.equal(h.inventory.get(I.KEG_OF_BEER_2), 0);

  h.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({ player: h.player, npcId: N.BRUNDT_THE_CHIEFTAIN_6 });
  h.line(N.BRUNDT_THE_CHIEFTAIN_6, 'Good to see you Dalkar.');
  assert.equal(h.quest.getStage(h.player), 75);
  h.action(N.BRUNDT_THE_CHIEFTAIN_6, 'mSB9hO');
  assert.equal(h.quest.getStage(h.player), 76);
  const invasionMoves = h.cameras.moves.length;
  h.action(N.BRUNDT_THE_CHIEFTAIN_6, 'M7J2_U');
  h.tick(12);
  assert.equal(h.quest.getStage(h.player), 80, 'the captured invasion stage starts the basilisk counter');
  assert.ok(h.cameras.moves.length >= invasionMoves + 3, 'invasion camera track plays');
  assert.ok(h.subInterfaces.has(174), 'invasion fade uses the captured fade overlay');
  for (let i = 0; i < 31; i++) h.death(N.BASILISK, null);
  assert.equal(h.quest.getStage(h.player), 85, 'the 0-31 counter completes at 100%');
  h.line(N.BRUNDT_THE_CHIEFTAIN_6, "Dalkar! Get to the boat. It's time for us to go!");
  assert.equal(h.quest.getStage(h.player), 85);

  h.object(O.FREMENNIK_BOAT_6);
  assert.equal(h.quest.getStage(h.player), 85);
  assert.ok(h.cameras.shakes.some(([axis, amplitude, , rate]) => axis === 1 && amplitude === 10 && rate === 25), 'Island of Stone arrival shake');
  h.setLocation(new h.core.Location(2470, 4010, 0));
  h.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({ player: h.player, npcId: N.BRUNDT_THE_CHIEFTAIN_9 });
  assert.equal(h.quest.getStage(h.player), 90);

  h.player.setAttribute('quest.the_fremennik_exiles.puzzle-solution', '1,2,3,4');
  h.player.setAttribute('quest.the_fremennik_exiles.puzzle-attempts', 0);
  h.player.setAttribute('quest.the_fremennik_exiles.puzzle-guess', '0,0,0,0');
  h.object(O.CAVE_74);
  assert.ok(h.subInterfaces.has(622), 'the captured combination-lock interface opens');
  h.interfaceButton((622 << 16) | 33);
  assert.equal(h.quest.getStage(h.player), 90, 'a wrong guess keeps the door shut');
  assert.equal(h.player.getAttribute('quest.the_fremennik_exiles.puzzle-attempts'), 1);
  h.interfaceButton((622 << 16) | 2);
  assert.ok(!h.subInterfaces.has(622), 'close button closes the lock');
  h.object(O.CAVE_74);
  h.hooks.logins[0]({ player: h.player });
  h.object(O.CAVE_74);
  for (let i = 0; i < 1; i++) h.interfaceButton((622 << 16) | 8);
  for (let i = 0; i < 2; i++) h.interfaceButton((622 << 16) | 15);
  for (let i = 0; i < 3; i++) h.interfaceButton((622 << 16) | 21);
  for (let i = 0; i < 4; i++) h.interfaceButton((622 << 16) | 27);
  h.interfaceButton((622 << 16) | 33);
  assert.equal(h.quest.getStage(h.player), 95);
  assert.equal(h.player.getAttribute('quest.the_fremennik_exiles.puzzle-open'), true);

  h.object(O.CAVE_74);
  assert.equal(h.quest.getStage(h.player), 100);
  h.death(N.TYPHOR_2, h.spawned.find((npc) => npc.getId() === N.TYPHOR_2));
  assert.equal(h.quest.getStage(h.player), 105);
  h.setSkill(h.core.Skill.MAGIC, 99);
  h.setSkill(h.core.Skill.DEFENCE, 99);
  h.hit(N.THE_JORMUNGAND_3);
  assert.equal(h.quest.getStage(h.player), 110, 'first Jormungand hit enters the captured phase');
  h.tick(15);
  assert.ok(h.messages.some((message) => message.includes('gazes upon you')), 'captured gaze warning fires');
  assert.ok(h.messages.some((message) => message.includes('drains you')), 'facing the gaze drains combat stats');
  assert.ok(h.player.getSkillManager().getCurrentLevel(h.core.Skill.MAGIC) < 99);
  h.death(N.THE_JORMUNGAND_3, h.spawned.find((npc) => npc.getId() === N.THE_JORMUNGAND_3));
  assert.ok(h.quest.getStage(h.player) >= 115, 'Jormungand death reaches the 115 finish stage');

  h.line(N.BRUNDT_THE_CHIEFTAIN_10, 'You worry too much Dalkar. If the end had begun, we would have noticed by now.');
  assert.equal(h.quest.getStage(h.player), 120);
  assert.ok(h.spawned.some((npc) => npc.getId() === N.OLAF_THE_BARD_2 && npc.getLocation().getY() === 3683), 'captured ballad singer stands in the longhall');
  const celebrationMoves = h.cameras.moves.length;
  h.line(N.BRUNDT_THE_CHIEFTAIN_6, "T'was on a haughty winter,");
  assert.ok(h.cameras.moves.length > celebrationMoves, 'celebration camera frames the longhall');
  assert.equal(h.spawned.find((npc) => npc.getId() === N.OLAF_THE_BARD_2)?.chat, "T'was on a haughty winter,");
  h.line(N.BRUNDT_THE_CHIEFTAIN_6, 'Uh oh...');
  assert.equal(h.quest.getStage(h.player), 125);
  h.action(N.BRUNDT_THE_CHIEFTAIN_6, '2pgrdA');
  assert.equal(h.quest.getStage(h.player), 130);
  assert.equal(h.xp.filter((entry) => entry.skill === h.core.Skill.SLAYER).length, 1);
  h.action(N.BRUNDT_THE_CHIEFTAIN_6, '2pgrdA');
  assert.equal(h.xp.filter((entry) => entry.skill === h.core.Skill.SLAYER).length, 1, 'rewards are once only');
  h.hooks.logouts[0]({ player: h.player });
});

test('Fremennik Exiles legacy save stages migrate once and keep completion rewards', () => {
  const cases = [[1, 5], [15, 15], [30, 20], [60, 50], [62, 55], [66, 70], [80, 85], [81, 85], [96, 95], [116, 115], [130, 130]];
  for (const [legacy, expected] of cases) {
    const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
    h.quest.setStage(h.player, legacy);
    h.player.setAttribute('quest.points', 0);
    h.hooks.logins[0]({ player: h.player });
    assert.equal(h.quest.getStage(h.player), expected, `legacy ${legacy} maps to ${expected}`);
    assert.equal(h.player.getAttribute('quest.points'), 0);
    assert.equal(h.xp.length, 0, 'migration never replays XP');
    h.hooks.logins[0]({ player: h.player });
    assert.equal(h.quest.getStage(h.player), expected, 'migration is one-time');
  }
  const native = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  native.player.setAttribute('the-fremennik-exiles:schema', 1);
  native.quest.setStage(native.player, 110);
  native.hooks.logins[0]({ player: native.player });
  assert.equal(native.quest.getStage(native.player), 110, 'new native Jormungand phase is preserved');
});

test('Brundt world spawn ids resolve to the real cache NPCs and the quest dispatch', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  for (const id of [9263, 9266, 9267]) {
    const definition = h.core.NpcDefinition.forId(id);
    assert.equal(definition?.getName?.(), 'Brundt the Chieftain');
    assert.ok(definition?.getActions?.().includes('Talk-to'));
  }
  h.quest.setStage(h.player, 10);
  assert.equal(h.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({ player: h.player, npcId: 9263 }), true);
});

test('Haunted ladder links use real cache objects, reachable landings and both directions', () => {
  const far = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  far.quest.setStage(far.player, 50);
  const farMiddle = { getId: () => 2253, getContentId: () => 2253, isRegistered: () => true, getOwner: () => null,
    getLocation: () => new far.core.Location(2543, 10143, 0), setHitpoints(value) { this.hp = value; } };
  far.setNpcsNear([farMiddle]);
  far.setWeapon(ITEMS(far).RUNE_THROWNAXE);
  far.setSpecial(100);
  far.setLocation(new far.core.Location(2545, 10160, 0));
  far.npcRoute({ player: far.player, npc: farMiddle, npcId: 2253, clickType: 2,
    definition: { getActions: () => [null, 'Destroy'] }, range: 1, handled: false });
  assert.equal(farMiddle.hp, undefined, 'a support beyond the scoped reach cannot be destroyed');
  assert.equal(far.player.getSpecialPercentage(), 100, 'out-of-range clicks spend no energy');

  const foreign = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  foreign.quest.setStage(foreign.player, 50);
  const foreignMiddle = { getId: () => 2253, getContentId: () => 2253, isRegistered: () => true,
    getOwner: () => ({}), getLocation: () => new foreign.core.Location(2543, 10143, 0),
    setHitpoints(value) { this.hp = value; } };
  foreign.setNpcsNear([foreignMiddle]);
  foreign.setWeapon(ITEMS(foreign).RUNE_THROWNAXE);
  foreign.setSpecial(100);
  foreign.setLocation(new foreign.core.Location(2545, 10146, 0));
  const foreignClick = { player: foreign.player, npc: foreignMiddle, npcId: 2253, clickType: 2,
    definition: { getActions: () => [null, 'Destroy'] }, range: 1, handled: false };
  foreign.npcRoute(foreignClick);
  assert.equal(foreignClick.range, 1, 'a foreign-owned support gets no route widening');
  assert.equal(foreignClick.ignoreProjectileClip, undefined, 'a foreign-owned support gets no clip exception');

  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const ClimbLinks = require('../plugins/objects/ClimbLinks');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const h = setup('../plugins/quests/quests/HauntedMine.Quest', 'haunted_mine');
  const core = h.core;
  const climbs = [
    [3422, 9625, 'down', 2783, 4569], [2782, 4569, 'up', 3421, 9625],
    [2798, 4567, 'down', 2734, 4504], [2734, 4503, 'up', 2798, 4568],
    [2725, 4486, 'down', 2789, 4487], [2789, 4486, 'up', 2725, 4487],
    [3413, 9633, 'down', 2772, 4577],
    [2797, 4599, 'down', 2733, 4534], [2733, 4535, 'up', 2798, 4599],
    [2710, 4540, 'down', 2774, 4539], [2774, 4540, 'up', 2710, 4539],
    [2732, 4529, 'down', 2796, 4528],
  ];
  const emitted = [];
  h.api.onCustomEvent('ladders:climbUp', (event) => emitted.push({ dir: 'up', dest: event.destination }));
  h.api.onCustomEvent('ladders:climbDown', (event) => emitted.push({ dir: 'down', dest: event.destination }));
  for (const [x, y, dir, dx, dy] of climbs) {
    RegionManager.loadMapFiles(x, y);
    const objects = MapObjects.mapObjects.get(MapObjects.getHash(x, y, 0)) ?? [];
    const object = [...objects].reverse().find((candidate) => {
      const actions = ObjectDefinition.forId(candidate.getId())?.getInteractions?.() ?? [];
      return actions.some((action) => String(action).toLowerCase() === (dir === 'down' ? 'climb-down' : 'climb-up'));
    });
    assert.ok(object, `real cache ladder at ${x},${y} ${dir}`);
    assert.equal(ClimbLinks.climbs(object.getId(), dir === 'up' ? ClimbLinks.UP : ClimbLinks.DOWN), true);
    const event = { player: h.player, object, objectId: object.getId(), handled: false };
    h.api.emitCustomEvent('ladders:climb', event);
    assert.equal(event.handled, true, `owned ladder ${x},${y}`);
    const landing = emitted.at(-1);
    assert.equal(landing.dir, dir);
    assert.deepEqual([landing.dest.getX(), landing.dest.getY()], [dx, dy]);
    RegionManager.loadMapFiles(dx, dy);
    assert.equal(RegionManager.blocked(new core.Location(dx, dy, 0), null), false, `landing ${dx},${dy} walkable`);
    const landingObjects = [];
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      landingObjects.push(...(MapObjects.mapObjects.get(MapObjects.getHash(dx + ox, dy + oy, 0)) ?? []));
    }
    const ladder = landingObjects.find((candidate) => /ladder/i.test(ObjectDefinition.forId(candidate.getId())?.getName?.() ?? ''));
    assert.ok(ladder, `ladder object near landing ${dx},${dy}`);
    const standIn = { getLocation: () => new core.Location(dx, dy, 0), getSize: () => 1, getPrivateArea: () => null };
    const def = ObjectDefinition.forId(ladder.getId());
    assert.equal(PathFinder.reachedObject(standIn, ladder.getLocation().getX(), ladder.getLocation().getY(),
      def.getSizeX(), def.getSizeY(), ladder.getFace(), ladder.getType(), def.getBlockingMask()), true,
      `PathFinder reaches landing ladder ${dx},${dy}`);
  }
});

test('Fremennik Exiles uses shipped Anvil/Furnace names and defers ordinary smithing', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const I = ITEMS(h);
  assert.equal(ObjectDefinition.forId(2097)?.getName?.(), 'Anvil');
  assert.ok(ObjectDefinition.forId(2097)?.getInteractions?.().includes('Smith'));
  assert.equal(ObjectDefinition.forId(24009)?.getName?.(), 'Furnace');
  h.quest.setStage(h.player, 50);
  h.inventory.set(I.LUNAR_BAR, 3);
  h.inventory.set(I.HAMMER, 1);
  h.inventory.set(I.LUNAR_ORE, 1);
  const anvil = h.itemOnObject(I.LUNAR_BAR, 2097);
  assert.equal(anvil.handled, true, 'canonical Anvil 2097 owns Lunar bars');
  h.action(0, 'E44eQ-');
  assert.equal(h.inventory.get(I.LUNAR_BAR), 0);
  assert.equal(h.inventory.get(I.V_SIGIL), 1);
  const furnace = h.itemOnObject(I.LUNAR_ORE, 24009);
  assert.equal(furnace.handled, true, 'canonical Furnace 24009 owns lunar ore');
  assert.equal(h.inventory.get(I.LUNAR_ORE), 0);
  assert.equal(h.inventory.get(I.LUNAR_BAR), 1);
  const ordinary = h.itemOnObject(I.IRON_BAR, 2097);
  assert.equal(ordinary.handled, false, 'ordinary bars defer to Smithing');
  h.quest.setStage(h.player, 35);
  const wrongStage = h.itemOnObject(I.LUNAR_BAR, 2097);
  assert.equal(wrongStage.handled, false, 'outside the shield hunt defers');
});

test('Fremennik Exiles negative: basilisk kills before the invasion do nothing', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  const N = NPCS(h);
  h.quest.setStage(h.player, 50);
  h.death(N.BASILISK, null);
  assert.equal(h.quest.getStage(h.player), 50);
  assert.equal(h.player.getAttribute('quest.the_fremennik_exiles.basilisk-kills'), undefined);
});

test('Fremennik Exiles celebration final line completes once with rewards', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  const N = NPCS(h);
  h.quest.setStage(h.player, 125);
  h.player.setAttribute('quest.points', 0);
  const beforeXp = h.xp.length;
  const line = h.line(N.BRUNDT_THE_CHIEFTAIN, 'Uh oh...');
  assert.equal(h.quest.getStage(h.player), 125);
  assert.equal(typeof line.after, 'function', 'the final line owns the completion continuation');
  line.after();
  assert.equal(h.quest.getStage(h.player), 130);
  assert.ok(h.xp.length > beforeXp, 'completion grants XP rewards');
  const points = h.player.getAttribute('quest.points');
  const xpCount = h.xp.length;
  line.after();
  assert.equal(h.quest.getStage(h.player), 130, 'completion is idempotent');
  assert.equal(h.xp.length, xpCount, 'replaying the continuation does not duplicate XP');
  assert.equal(h.player.getAttribute('quest.points'), points, 'replaying does not duplicate quest points');
  h.hooks.logins[0]({ player: h.player });
  assert.equal(h.quest.getStage(h.player), 130, 'completion persists across relog');
});

test('Fremennik Exiles market death callback advances killPercent and stage', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  const N = NPCS(h);
  h.quest.setStage(h.player, 80);
  h.death(N.MONSTROUS_BASILISK_2, null);
  assert.equal(h.player.getAttribute('quest.the_fremennik_exiles.basilisk-kills'), 3);
  assert.equal(h.varbits.get(9466), 3);
  assert.equal(h.quest.getStage(h.player), 80);
  for (let i = 0; i < 28; i++) h.death(N.BASILISK, null);
  assert.equal(h.player.getAttribute('quest.the_fremennik_exiles.basilisk-kills'), 31);
  assert.equal(h.varbits.get(9466), 31);
  assert.equal(h.quest.getStage(h.player), 85);
});

test('Exiles completion drops V shield once when the real inventory is full', () => {
  const { Item } = require('../dist/game/model/Item');
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
  assert.equal(ItemDefinition.forId(ITEMS(setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles')).VS_SHIELD_2).isStackable(), false);
  const dropped = [];
  const original = ItemOnGroundManager.registers;
  ItemOnGroundManager.registers = (_player, item) => { dropped.push(item); return null; };
  try {
    for (const fill of [28, 27]) {
      const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
      const inventory = new Inventory(h.player);
      inventory.resetItems();
      for (let i = 0; i < fill; i++) inventory.adds(ITEMS(h).SHARK, 1);
      h.player.getInventory = () => inventory;
      h.quest.setStage(h.player, 125);
      dropped.length = 0;
      h.action(0, '2pgrdA');
      assert.equal(h.quest.getStage(h.player), 130);
      if (fill === 28) {
        assert.equal(inventory.getAmount(ITEMS(h).VS_SHIELD_2), 0, 'full bag keeps the old add path red');
        assert.equal(dropped.length, 1, 'full bag rewards drop once at the completion location');
        assert.equal(dropped[0].getId(), ITEMS(h).VS_SHIELD_2);
      } else {
        assert.equal(inventory.getAmount(ITEMS(h).VS_SHIELD_2), 1, 'one free slot receives the shield');
        assert.equal(dropped.length, 0);
      }
      const slayerXp = h.xp.filter((entry) => entry.skill === h.core.Skill.SLAYER).length;
      h.action(0, '2pgrdA');
      for (const login of h.hooks.logins) login({ player: h.player });
      assert.equal(h.xp.filter((entry) => entry.skill === h.core.Skill.SLAYER).length, slayerXp, 'no duplicate completion XP');
      if (fill === 28) assert.equal(dropped.length, 1, 'relog/repeat pays the dropped shield once');
    }
  } finally {
    ItemOnGroundManager.registers = original;
  }
});

test('combined real dispatch: Brundt 9263 offers Exiles before Lunar/FremennikTrials and keeps seal reclaim', () => {
  const plugin = (name) => {
    const api = PluginManager.createApi(name);
    require(`../plugins/quests/quests/${name}.Quest`)(api);
  };
  // Proposed Quests.plugin order: the later quest registers before the earlier Brundt owners.
  plugin('TheFremennikExiles');
  plugin('FremennikTrials');
  plugin('LunarDiplomacy');
  const prereq = PluginManager.createApi('MineExilesCombinedPrereqs');
  prereq.onCustomEvent('quest:is-complete', (event) => { event.complete = true; });

  const core = PluginManager.getCoreApi();
  const exiles = runtime.getRegisteredQuests().filter((entry) => entry.key === 'the_fremennik_exiles').at(-1);
  const lunar = runtime.getRegisteredQuests().filter((entry) => entry.key === 'lunar_diplomacy').at(-1);
  const trials = runtime.getRegisteredQuests().filter((entry) => entry.key === 'fremennik_trials').at(-1);

  const attrs = new Map(), inventory = new Map(), varbits = new Map();
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig() { return sender; },
    sendInterfaceRemoval() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getAttribute: (key) => attrs.get(key), setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender, sendMessage() {},
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      adds(id, amount = 1) { inventory.set(id, (inventory.get(id) ?? 0) + amount); },
      add(id, amount = 1) { inventory.set(id, (inventory.get(id) ?? 0) + amount); },
      deleteNumber(id, amount = 1) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount)); },
      getFreeSlots: () => 28,
    }),
    getBank: () => ({ contains: () => false }),
    getEquipment: () => ({ get: () => ({ getId: () => -1 }) }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 99, addExperiences() {}, setCurrentLevelCombat() {} }),
    getUsername: () => 'tester', getAppearance: () => ({ isMale: () => true }),
    getLocation: () => new core.Location(2659, 3669, 0), moveTo() {},
    getDialogueManager: () => ({ reset() {}, isActive: () => false, startDialogues() {} }),
    isPlayer: () => true, isPlayerBot: () => false,
  };
  const definition = core.NpcDefinition.forId(9263);
  const npc = {
    getId: () => 9263, getContentId: () => 9263,
    getCurrentDefinition: () => definition, getLocation: () => new core.Location(2659, 3669, 0),
  };
  const talk = () => {
    const event = {
      player, npc, npcId: 9263, definition, clickType: 1, option: 'Talk-to', handled: false,
    };
    return { event, handled: PluginManager.emitNpcInteraction(event) };
  };

  const index = require('../data/definitions/npc-dialogue-index.json');
  assert.equal(definition?.getName?.(), 'Brundt the Chieftain');
  assert.ok(index[9263].some((entry) => entry.page === 'Transcript:The Fremennik Exiles'));
  assert.ok(index[9263].some((entry) => entry.variants.includes('starting-out-brundt-the-chieftain')));

  player.setAttribute('quest.fremennik_trials.stage', trials.completionValue);
  player.setAttribute('quest.lunar_diplomacy.stage', lunar.completionValue);
  assert.equal(exiles.getStage(player), 0);
  // Missing Seal of Passage: Exiles yields so Lunar's reclaim offer handles Brundt.
  assert.equal(talk().handled, true);
  assert.equal(exiles.getStage(player), 0);

  // With the Seal, the same real NPC/index dispatch reaches the Exiles start page.
  inventory.set(core.ItemIdentifiers.SEAL_OF_PASSAGE, 1);
  assert.equal(talk().handled, true);
  PluginManager.emitCustomEvent('npc-dialogue:choice', { player, npc, npcId: 9263, option: 'Yes.' });
  assert.equal(exiles.getStage(player), 5, 'real combined dispatch starts the quest');

  // Completed Exiles with the seal held must keep its own postquest page.
  const starts = [];
  PluginManager.createApi('MineExilesPostQuestStarts').onCustomEvent('npc-dialogue:start', (event) => starts.push(event.variant));
  exiles.setStage(player, exiles.completionValue);
  starts.length = 0;
  assert.equal(talk().handled, true);
  assert.ok(starts.includes('standard-dialogue-after-the-fremennik-exiles'), 'Exiles owns complete Brundt when the seal is held');

  // Missing Seal: completed Exiles yields again, preserving Lunar's lost-seal reclaim.
  inventory.delete(core.ItemIdentifiers.SEAL_OF_PASSAGE);
  assert.equal(talk().handled, true);
  assert.equal(exiles.getStage(player), exiles.completionValue);
});

test('Waterbirth entrances keep the captured dungeon landing and gates need the pet-rock buttons', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  const I = ITEMS(h);
  h.quest.setStage(h.player, 50);

  h.setLocation(new h.core.Location(2519, 3738, 0));
  const entrance = h.object(8929);
  assert.equal(entrance.handled, false, 'the quest must not intercept the cave entrance');
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], [2519, 3738, 0],
    'the entrance is left to the captured LocTeleports row');

  const gate = {
    getId: () => 8958,
    getLocation: () => new h.core.Location(2491, 10162, 0),
    getType: () => 10,
    getFace: () => 1,
    getPrivateArea: () => null,
  };
  h.setLocation(new h.core.Location(2490, 10162, 0));
  h.object(8958, { object: gate });
  assert.equal(h.registrations.length, 0, 'a gate stays shut without both floor buttons held');
  assert.match(h.messages.at(-1), /pet rock/);

  h.core.ItemOnGroundManager.registerLocation(h.player, new h.core.Item(I.PET_ROCK, 1), new h.core.Location(2490, 10164, 0));
  h.object(8958, { object: gate });
  assert.equal(h.registrations.at(-1)?.getId?.(), 8963, 'the cache open leaf replaces the closed gate');
  assert.equal(h.attrs.has('quest.the_fremennik_exiles.waterbirth-open-gates'), false, 'gate state is not persisted per player');
});

test('Waterbirth pet rock can be placed on a floor button and used as the second weight', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  const I = ITEMS(h);
  h.quest.setStage(h.player, 50);
  h.inventory.set(I.PET_ROCK, 1);
  const button = { getLocation: () => new h.core.Location(2490, 10162, 0), getId: () => 8965 };
  h.itemOnObject(I.PET_ROCK, 8965, { object: button });
  assert.equal(h.inventory.get(I.PET_ROCK), 0, 'placing the rock consumes it');
  assert.ok(h.groundItems.has('2490,10162,0,3695'), 'the rock lands on the button tile');
});

test('Waterbirth door-support route only recommends the real rune-thrownaxe reach', () => {
  const side = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  const I = ITEMS(side);
  side.quest.setStage(side.player, 50);
  const tiles = [[2545, 10141], [2543, 10143], [2545, 10145]];
  const supports = [2250, 2253, 2256].map((id, index) => ({
    getId: () => id, getContentId: () => id, isRegistered: () => true, getOwner: () => null,
    getLocation: () => new side.core.Location(tiles[index][0], tiles[index][1], 0),
    setHitpoints(value) { this.hp = value; },
  }));
  const doors = tiles.map(([x, y]) => ({
    getId: () => 8967, getLocation: () => new side.core.Location(x, y, 0),
    getType: () => 10, getFace: () => 0, getPrivateArea: () => null,
  }));
  side.objects.push(...doors);
  side.setNpcsNear(supports);
  side.setWeapon(I.RUNE_THROWNAXE);
  side.setSpecial(100);
  side.setLocation(new side.core.Location(2545, 10146, 0));
  const middle = supports[1];
  const click = {
    player: side.player, npc: middle, npcId: 2253, clickType: 2,
    definition: { getActions: () => [null, 'Destroy'] }, range: 1, handled: false,
  };
  side.npcRoute(click);
  assert.equal(click.range, 4, 'the route recommends the rune thrownaxe attack reach');
  assert.equal(click.ignoreProjectileClip, true, 'the route asks core to honour the support clip exception');
  assert.equal(side.player.getSpecialPercentage(), 100, 'routing must not spend special energy');
  assert.deepEqual(supports.map((npc) => npc.hp), [undefined, undefined, undefined], 'routing must not kill supports');
  assert.equal(side.objects.filter((object) => object.getId?.() === 8967).length, 3, 'routing must not open doorways');
  assert.equal(side.attrs.has('quest.the_fremennik_exiles.waterbirth-supports-down'), false, 'routing persists nothing');

  side.hooks.namedNpcs.get('Door-support').Destroy(click);
  assert.equal(side.player.getSpecialPercentage(), 90, 'the real NPC callback spends exactly 10% once');
  assert.deepEqual(supports.map((npc) => npc.hp), [0, 0, 0], 'the callback kills all three through the NPC death path');
  assert.equal(side.removed.length, 0, 'supports are not permanently removed from the world');
  assert.equal(side.objects.some((object) => object.getId?.() === 8967), false, 'the callback removes the central doors');
  side.tick(25);
  assert.equal(side.registrations.filter((object) => object.getId?.() === 8967).length, 3, 'doors restore with the support respawn');
  const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
  NpcDefinition.init?.();
  assert.equal(NpcDefinition.forId(2253).getRespawn(), 25, 'canonical door-support respawn is unchanged');

  const front = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  front.quest.setStage(front.player, 50);
  const frontMiddle = { getId: () => 2253, getContentId: () => 2253, isRegistered: () => true, getOwner: () => null,
    getLocation: () => new front.core.Location(2543, 10143, 0), setHitpoints(value) { this.hp = value; } };
  front.setNpcsNear([frontMiddle]);
  front.setWeapon(ITEMS(front).RUNE_THROWNAXE);
  front.setSpecial(100);
  front.setLocation(new front.core.Location(2545, 10143, 0));
  const frontClick = { player: front.player, npc: frontMiddle, npcId: 2253, clickType: 2,
    definition: { getActions: () => [null, 'Destroy'] }, range: 1, handled: false };
  front.npcRoute(frontClick);
  assert.equal(frontClick.range, 1, 'the support directly in front gets no route widening');
  assert.equal(frontClick.ignoreProjectileClip, undefined, 'the support directly in front gets no clip exception');

  const noAxe = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  noAxe.quest.setStage(noAxe.player, 50);
  const noAxeMiddle = { getId: () => 2253, getContentId: () => 2253, isRegistered: () => true, getOwner: () => null,
    getLocation: () => new noAxe.core.Location(2543, 10143, 0), setHitpoints(value) { this.hp = value; } };
  noAxe.setNpcsNear([noAxeMiddle]);
  noAxe.setLocation(new noAxe.core.Location(2545, 10146, 0));
  const noAxeClick = { player: noAxe.player, npc: noAxeMiddle, npcId: 2253, clickType: 2,
    definition: { getActions: () => [null, 'Destroy'] }, range: 1, handled: false };
  noAxe.npcRoute(noAxeClick);
  assert.equal(noAxeClick.range, 1, 'wrong weapon gets no route widening');
  assert.equal(noAxeClick.ignoreProjectileClip, undefined, 'wrong weapon gets no clip exception');

  const far = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  far.quest.setStage(far.player, 50);
  const farMiddle = { getId: () => 2253, getContentId: () => 2253, isRegistered: () => true, getOwner: () => null,
    getLocation: () => new far.core.Location(2543, 10143, 0), setHitpoints(value) { this.hp = value; } };
  far.setNpcsNear([farMiddle]);
  far.setWeapon(ITEMS(far).RUNE_THROWNAXE);
  far.setSpecial(100);
  far.setLocation(new far.core.Location(2545, 10150, 0));
  const farClick = { player: far.player, npc: farMiddle, npcId: 2253, clickType: 2,
    definition: { getActions: () => [null, 'Destroy'] }, range: 1, handled: false };
  far.npcRoute(farClick);
  assert.equal(farClick.range, 1, 'out-of-range clicks get no route widening');
  assert.equal(farClick.ignoreProjectileClip, undefined, 'out-of-range clicks get no clip exception');

  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { Location } = require('../dist/game/model/Location');
  RegionManager.loadMapFiles(2432, 10112, false);
  assert.equal(RegionManager.canProjectileAttack(
    { getSize: () => 1, getPrivateArea: () => null },
    new Location(2545, 10146, 0),
    new Location(2543, 10143, 0),
  ), false, 'normal projectile LOS is blocked; the support primary source grants a 5-tile clip exception');
});

test('Waterbirth gate is shared: two players can cooperate, and release closes it', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  h.quest.setStage(h.player, 50);
  const friend = {
    getLocation: () => new h.core.Location(2490, 10164, 0),
    isRegistered: () => true,
    getUsername: () => 'friend',
  };
  h.setPlayers([h.player, friend]);
  h.setLocation(new h.core.Location(2490, 10162, 0));
  const gate = {
    getId: () => 8958,
    getLocation: () => new h.core.Location(2491, 10162, 0),
    getType: () => 10,
    getFace: () => 1,
    getPrivateArea: () => null,
  };
  h.object(8958, { object: gate });
  assert.equal(h.registrations.at(-1)?.getId?.(), 8963, 'the shared gate opens for both players');

  h.tick(4);
  assert.equal(h.registrations.filter((object) => object.getId?.() === 8958).length, 0, 'the gate stays open while held');

  h.setLocation(new h.core.Location(2489, 10162, 0));
  h.tick(4);
  assert.equal(h.registrations.filter((object) => object.getId?.() === 8958).length, 0, 'release has a short walk-through grace');
  h.tick(1);
  assert.equal(h.registrations.at(-1)?.getId?.(), 8958, 'releasing a button closes the shared gate');
});

test('Waterbirth gate times out with Doors auto-close even while held', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  h.quest.setStage(h.player, 50);
  const friend = { getLocation: () => new h.core.Location(2490, 10164, 0), isRegistered: () => true, getUsername: () => 'friend' };
  h.setPlayers([h.player, friend]);
  h.setLocation(new h.core.Location(2490, 10162, 0));
  const gate = {
    getId: () => 8958,
    getLocation: () => new h.core.Location(2491, 10162, 0),
    getType: () => 10,
    getFace: () => 1,
    getPrivateArea: () => null,
  };
  h.object(8958, { object: gate });
  h.tick(500);
  assert.equal(h.registrations.at(-1)?.getId?.(), 8958, 'the normal 500-tick door timeout restores the closed gate');
});

test('Waterbirth relog does not reapply a saved global gate or support despawn', () => {
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true });
  h.quest.setStage(h.player, 50);
  const friend = { getLocation: () => new h.core.Location(2490, 10164, 0), isRegistered: () => true, getUsername: () => 'friend' };
  h.setPlayers([h.player, friend]);
  h.setLocation(new h.core.Location(2490, 10162, 0));
  const gate = {
    getId: () => 8958,
    getLocation: () => new h.core.Location(2491, 10162, 0),
    getType: () => 10,
    getFace: () => 1,
    getPrivateArea: () => null,
  };
  h.object(8958, { object: gate });
  const supports = [2250, 2253, 2256].map((id) => ({ getId: () => id, getContentId: () => id, isRegistered: () => true, setHitpoints(value) { this.hp = value; } }));
  h.setNpcsNear(supports);
  h.registrations.length = 0;
  h.hooks.logins[0]({ player: h.player });
  assert.equal(h.registrations.length, 0, 'login does not replay a global gate mutation');
  assert.equal(supports.some((npc) => npc.hp !== undefined), false, 'login does not replay a global support despawn');
});

test('Waterbirth captured landings, cache gate ids and the lower pathfinder reach Bardur', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { Location } = require('../dist/game/model/Location');
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const teleports = require('../plugins/world/data/loc-teleports.json').locs;
  const landing = (predicate) => teleports.find(predicate);

  assert.deepEqual(landing((e) => e.id === 8929).to, [2442, 10146, 0], 'rock entrance uses the captured dungeon landing');
  assert.deepEqual(landing((e) => e.id === 8930).to, [2545, 10143, 0], 'ice entrance uses the captured dungeon landing');
  assert.deepEqual(landing((e) => e.id === 10177 && e.option === 'Climb-down').to, [1799, 4406, 3]);
  assert.deepEqual(landing((e) => e.id === 10223).to, [1850, 4387, 1], 'southern sublevel ladder lands beside Bardur');

  assert.equal(ObjectDefinition.forId(8958).clipType, 1, 'closed gate is solid');
  assert.equal(ObjectDefinition.forId(8963).clipType, 0, 'cache open leaf is passable');
  assert.equal(ObjectDefinition.forId(8965).clipType, 2, 'floor button is walked on');

  RegionManager.loadMapFiles(1792, 4352, false);
  const queue = () => {
    const q = {};
    for (const method of ['reset', 'setRoute', 'syncDestinationFlagToRoute', 'setPathX', 'setPathY', 'setLastDestX', 'setLastDestY']) {
      q[method] = () => q;
    }
    return new Proxy(q, { get: (target, key) => target[key] ?? (() => q) });
  };
  const player = {
    getLocation: () => new Location(1850, 4387, 1),
    getSize: () => 1,
    getPrivateArea: () => null,
    isPlayer: () => true,
    getAsPlayer: () => ({ isPlayerBot: () => false, getUsername: () => 'tester' }),
    getMovementQueue: queue,
  };
  assert.equal(PathFinder.calculateWalkRoute(player, 1850, 4392), 1, 'the captured landing walks to Bardur');
});


test('NPC route clip permission calls the real walkToEntity callback once', () => {
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  const { Location } = require('../dist/game/model/Location');
  const player = {
    getIndex: () => 1, isPlayer: () => true, getAsPlayer: () => player,
    getLocation: () => new Location(2545, 10146, 0), getPrivateArea: () => null,
    getSize: () => 1, getHitpoints: () => 99, isRegistered: () => true,
    setMobileInteraction() {}, getMovementQueue: () => queue,
  };
  const npc = {
    isNpc: () => true, isRegistered: () => true, getHitpoints: () => 1,
    getPrivateArea: () => null, getLocation: () => new Location(2543, 10143, 0),
    getSize: () => 1, getId: () => 2253,
  };
  const queue = Object.create(MovementQueue.prototype);
  queue.character = player;
  queue.player = player;
  queue.getMobility = () => ({ canMove: () => true, sendMessage() {} });
  queue.checkDestination = () => true;
  queue.reset = () => {};
  queue.walkToReset = () => {};
  queue.isProjectedMainWorldNpc = () => false;
  let calls = 0;
  queue.walkToEntity(npc, () => { calls += 1; }, 4, true);
  assert.equal(calls, 1, 'the scoped clip exception reaches the normal NPC callback once');
});

test('Waterbirth handler opens the real base-map door clipping and restores it', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { Location } = require('../dist/game/model/Location');
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  RegionManager.loadMapFiles(2432, 10112, false);
  const tile = new Location(2545, 10145, 0);
  assert.ok(MapObjects.get(8967, tile, null), 'cache base-map door resolves');
  assert.equal(RegionManager.blocked(tile, null), true, 'base door starts blocking');

  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles', { waterbirth: true, realDoors: true });
  h.quest.setStage(h.player, 50);
  const middle = { getId: () => 2253, getContentId: () => 2253, isRegistered: () => true, getOwner: () => null,
    getLocation: () => new h.core.Location(2543, 10143, 0), setHitpoints(value) { this.hp = value; } };
  h.setNpcsNear([middle]);
  h.setWeapon(ITEMS(h).RUNE_THROWNAXE);
  h.setSpecial(100);
  h.setLocation(new h.core.Location(2545, 10146, 0));
  const click = { player: h.player, npc: middle, npcId: 2253, clickType: 2,
    definition: { getActions: () => [null, 'Destroy'] }, range: 1, handled: false };
  h.npcRoute(click);
  assert.ok(MapObjects.get(8967, tile, null), 'routing alone leaves the base door in place');
  h.hooks.namedNpcs.get('Door-support').Destroy(click);
  assert.equal(MapObjects.get(8967, tile, null), null, 'the handler removes the actual base door');
  assert.equal(RegionManager.blocked(tile, null), false, 'base-map clipping is cleared');

  const queue = () => {
    const q = {};
    for (const method of ['reset', 'setRoute', 'syncDestinationFlagToRoute', 'setPathX', 'setPathY', 'setLastDestX', 'setLastDestY']) {
      q[method] = () => q;
    }
    return new Proxy(q, { get: (target, key) => target[key] ?? (() => q) });
  };
  const walker = {
    getLocation: () => new Location(2545, 10146, 0), getSize: () => 1, getPrivateArea: () => null,
    isPlayer: () => true, getAsPlayer: () => ({ isPlayerBot: () => false, getUsername: () => 'tester' }),
    getMovementQueue: queue,
  };
  assert.ok(PathFinder.calculateWalkRoute(walker, 2545, 10144) > 0, 'path into the ladder room opens');

  h.tick(25);
  assert.ok(MapObjects.get(8967, tile, null), 'the base door is restored with the support respawn');
  assert.equal(RegionManager.blocked(tile, null), true, 'base-map clipping closes again');
});

test('Exiles keg hand-in passes through 65 then 70 and shieldback without extra beers', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
  const data = require('../data/definitions/npc-dialogues.json');
  const record = data['The Fremennik Exiles'];
  const I = ITEMS(setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles'));
  const runVariant = (h, variant) => {
    const manager = new DialogueManager(h.player);
    h.player.getDialogueManager = () => manager;
    const definition = { getId: () => 9263, getName: () => 'Brundt the Chieftain' };
    const event = { player: h.player, npc: { getId: () => 9263 }, npcId: 9263, definition };
    const raw = record.variants[variant];
    const steps = raw.filter((step) => step.type !== 'jump');
    startDialogue(h.api, event, steps, record.branches, {
      player: h.player, npc: event.npc, npcId: 9263, definition, pages: [{ page: 'The Fremennik Exiles' }],
    });
    let guard = 0;
    while (manager.getCurrent() && guard++ < 100) manager.advance();
  };

  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  h.quest.setStage(h.player, 60);
  h.inventory.set(I.KEG_OF_BEER_2, 2);
  const secondLines = [];
  h.api.onCustomEvent('npc-dialogue:action', (event) => {
    if (event.stepId === 'F4atZx') secondLines.push(event.text);
  });
  const manager = new DialogueManager(h.player);
  h.player.getDialogueManager = () => manager;
  const definition = { getId: () => 9263, getName: () => 'Brundt the Chieftain' };
  const event = { player: h.player, npc: { getId: () => 9263 }, npcId: 9263, definition };
  // Use the same quest-local selector the plugin exposes via npc-dialogue:start.
  const starts = [];
  h.api.onCustomEvent('npc-dialogue:start', (start) => starts.push(start));
  h.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({
    player: h.player, npcId: NPCS(h).BRUNDT_THE_CHIEFTAIN_8, npc: null, clickType: 1,
  });
  assert.equal(starts.length, 1);
  const chosen = starts[0];
  const withKegs = record.variants[chosen.variant];
  startDialogue(h.api, event, chosen.select ? chosen.select(withKegs) : withKegs, record.branches, {
    player: h.player, npc: event.npc, npcId: 9263, definition, pages: [{ page: 'The Fremennik Exiles' }],
  });
  let guard = 0;
  while (manager.getCurrent() && h.quest.getStage(h.player) !== 65 && guard++ < 100) manager.advance();
  assert.equal(h.quest.getStage(h.player), 65, 'first keg is the captured stage65 boundary');
  assert.equal(h.inventory.get(I.KEG_OF_BEER_2), 0, 'both earned kegs are consumed once');
  while (manager.getCurrent() && guard++ < 200) manager.advance();
  assert.equal(h.quest.getStage(h.player), 70, 'player continues the captured second-keg message to 70');
  assert.deepEqual(secondLines, ['The chieftain quickly drinks the second keg and stumbles off.']);

  runVariant(h, 'basilisks-in-the-market-brundt');
  assert.ok(h.quest.getStage(h.player) >= 76, 'shield handback/cutscene plays from the canonical 70 continuation');
  assert.equal(h.inventory.get(I.VS_SHIELD_2), 1, 'V shield is handed back once');

  const retry = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  retry.quest.setStage(retry.player, 65);
  retry.inventory.set(I.KEG_OF_BEER_2, 2);
  const retryStarts = [];
  retry.api.onCustomEvent('npc-dialogue:start', (start) => retryStarts.push(start));
  assert.equal(retry.hooks.namedNpcs.get('Brundt the Chieftain')['Talk-to']({
    player: retry.player, npcId: NPCS(retry).BRUNDT_THE_CHIEFTAIN_8, npc: null, clickType: 1,
  }), true);
  assert.equal(retry.quest.getStage(retry.player), 65, 'opening the retry does not advance stage');
  assert.equal(retry.inventory.get(I.KEG_OF_BEER_2), 2, 'retry never consumes replacement beers');
  const retryStart = retryStarts[0];
  const retryManager = new DialogueManager(retry.player);
  retry.player.getDialogueManager = () => retryManager;
  const retryEvent = { player: retry.player, npc: { getId: () => 9263 }, npcId: 9263, definition };
  startDialogue(retry.api, retryEvent, retryStart.select(record.variants[retryStart.variant]), record.branches, {
    player: retry.player, npc: retryEvent.npc, npcId: 9263, definition, pages: [{ page: 'The Fremennik Exiles' }],
  });
  guard = 0;
  while (retryManager.getCurrent() && guard++ < 200) retryManager.advance();
  assert.equal(retry.quest.getStage(retry.player), 70, 'interrupted stage65 resumes at 70');
  assert.equal(retry.inventory.get(I.KEG_OF_BEER_2), 2);
});

test('Fremennik Exiles celebration plays through real NpcDialogues/DialogueManager and completes once', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
  const data = require('../data/definitions/npc-dialogues.json');
  const h = setup('../plugins/quests/quests/TheFremennikExiles.Quest', 'the_fremennik_exiles');
  h.quest.setStage(h.player, 125);
  h.player.setAttribute('quest.points', 0);
  const singer = h.spawned.find((npc) => npc.getId() === 9274);
  assert.ok(singer, 'stage 125 restores the owner-local Olaf actor');
  singer.getCurrentDefinition = () => h.core.NpcDefinition.forId(singer.getId());
  singer.isVisible = () => true;
  h.setLocation(singer.getLocation());
  h.player.getLocalNpcs = () => [singer];
  const manager = new DialogueManager(h.player);
  h.player.getDialogueManager = () => manager;
  const definition = { getId: () => 9263, getName: () => 'Brundt the Chieftain' };
  const event = { player: h.player, npc: { getId: () => 9263 }, npcId: 9263, definition };
  const record = data['The Fremennik Exiles'];
  startDialogue(h.api, event, record.variants['longhall-celebration'], record.branches, {
    player: h.player, npc: event.npc, npcId: 9263, definition, pages: [{ page: 'The Fremennik Exiles' }],
  });
  const beforeXp = h.xp.length;
  let guard = 0;
  while (manager.getCurrent() && h.quest.getStage(h.player) < 130 && guard++ < 80) {
    // Overhead transcript lines continue from their real scheduled task, not a
    // chatbox click. Let the test scheduler advance those two ticks before the
    // next player-controlled dialogue entry.
    if (manager.getCurrent()?.constructor?.name === 'ActionDialogue') h.tick(2);
    else manager.advance();
  }
  assert.ok(guard < 80, 'celebration transcript finishes without exhausting the playback guard');
  assert.equal(h.quest.getStage(h.player), 130, 'normal playback reaches completion');
  assert.ok(h.xp.length > beforeXp, 'completion grants rewards');
  const xpCount = h.xp.length;
  const points = h.player.getAttribute('quest.points');
  manager.advance();
  assert.equal(h.xp.length, xpCount, 'completion rewards are not duplicated');
  assert.equal(h.player.getAttribute('quest.points'), points);
  h.hooks.logins[0]({ player: h.player });
  assert.equal(h.quest.getStage(h.player), 130, 'completion persists across relog');
});
