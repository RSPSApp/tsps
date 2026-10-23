const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const mining = require('../plugins/skills/Mining.plugin');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const npcDialogues = require('../plugins/npcs/NpcDialogues.plugin');
npcDialogues.startDialogue = () => {};

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});

const PICKAXE_ID = mining.PICKAXES_DESC[0].id;

function item(id, amount = 1) {
  return { id, amount, getId: () => id, getAmount: () => amount,
    getDefinition: () => ItemDefinition.forId(id) };
}

function setup(pluginPath) {
  const hooks = {
    custom: new Map(), variants: [], conditions: [], namedNpcs: [], npcs: [], objects: [],
    itemActions: [], itemOnItem: [], itemOnNpc: [], itemOnObject: [], npcDeaths: [], npcHits: [], login: [], logout: [], npcRoutes: [],
  };
  const ground = new Map();
  const groundManager = {
    getGroundItem(username, id, tile) {
      return ground.get(`${username}:${id}:${tile.getX()}:${tile.getY()}`) ?? null;
    },
    registerLocation(player, groundItem, tile) {
      ground.set(`${player.getUsername()}:${groundItem.getId()}:${tile.getX()}:${tile.getY()}`, groundItem);
    },
  };
  const tasks = [];
  const cameras = [], songs = [], subInterfaces = [], spawned = [], interfaces = [], strings = new Map();
  const core = {
    ...PluginManager.getCoreApi(),
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    TaskManager: { submit(task) { tasks.push(task); },
      cancelTasks(key) { for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].key === key) tasks.splice(i, 1); } },
    MapObjects: { get: () => null },
    ObjectManager: { register() {}, deregister() {} },
  };
  const originalRangedStart = core.RangedCombatMethod.prototype.start;
  core.RangedCombatMethod.prototype.start = function(player) { player.__rangedShots = (player.__rangedShots ?? 0) + 1; };
  const api = new Proxy({
    core,
    persistAttribute() {},
    registerArea() {},
    getItemOnGroundManager: () => groundManager,
    getWorld: () => ({ getNpcs: () => [] }),
    spawnNpc(def) {
      const npc = { def, getId: () => def.id, getIndex: () => 9000 + spawned.length, getHitpoints: () => 10,
        getLocation: () => new core.Location(def.x, def.y, def.z), isRegistered: () => true,
        setPositionToFace(tile) { npc.facing = tile; }, setArea(area) { npc.area = area; },
        getArea: () => npc.area, performAnimation(animation) { npc.animation = animation?.id; } };
      spawned.push(npc);
      return npc;
    },
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(target, actions) {
      if (typeof target === 'function') hooks.npcs.push(target);
      else hooks.namedNpcs.push({ name: target, actions });
    },
    onObjectInteraction(target, actions) {
      if (typeof target === 'function') hooks.objects.push(target);
      else hooks.namedNpcs.push({ name: target, actions });
    },
    onItemAction(fn) { hooks.itemActions.push(fn); },
    onItemOnItem(fn) { hooks.itemOnItem.push(fn); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onNpcDeath(fn) { hooks.npcDeaths.push(fn); },
    onNpcHitModify(fn) { hooks.npcHits.push(fn); },
    onNpcRoute(fn) { hooks.npcRoutes.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    onCustomEvent(name, fn) {
      const list = hooks.custom.get(name) ?? [];
      list.push(fn);
      hooks.custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  require(pluginPath)(api);
  const quest = runtime.getRegisteredQuests().at(-1);
  const attrs = new Map();
  const inventory = new Map();
  const varbits = new Map();
  const configs = new Map();
  const messages = [];
  const xp = [];
  const equipment = { body: null, leg: null, weapon: null, hands: null, ammo: null };
  const levels = new Map(Object.values(core.Skill).map((skill) => [skill, 99]));
  let location = new core.Location(3432, 2929, 0);
  let area = null;
  const movement = { reset() { return this; }, setBlockMovement(value) { this.blocked = value; return this; } };
  const combat = { rangedWeapon: null, ammunition: null,
    setRangedWeapon(value) { combat.rangedWeapon = value; },
    setAmmunition(value) { combat.ammunition = value; },
    getRangedWeapon: () => combat.rangedWeapon,
    getAmmunition: () => combat.ammunition,
    getCastSpell: () => null,
    getAutocastSpell: () => null,
    reset() {} };
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    closeSubInterface() { return sender; },
    sendInterfaceRemoval() { return sender; },
    sendInterface() { return sender; },
    sendString() { return sender; },
    sendJingle() { return sender; },
    sendQuestList() { return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendSubInterface() { return sender; },
    sendInterfaceScript() { return sender; },
    sendCameraMoveTo(x, y, height, options) { cameras.push(['move', x, y, height, options]); return sender; },
    sendCameraLookAt(x, y, height, options) { cameras.push(['look', x, y, height, options]); return sender; },
    sendCameraReset() { cameras.push(['reset']); return sender; },
    sendSong(id) { songs.push(id); return sender; },
    sendJingle(id) { songs.push(id); return sender; },
    sendSubInterface(uid, id, type, options) { subInterfaces.push(['open', uid, id, options]); return sender; },
    closeSubInterface(uid) { subInterfaces.push(['close', uid]); return sender; },
    sendInterface(id) { interfaces.push(id); return sender; },
    sendString(text, uid) { strings.set(uid, text); return sender; },
    sendInterfaceDisplayState() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getUsername: () => 'rituals-test',
    getIndex: () => 266,
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    getFrameUpdater: () => null,
    sendMessage(message) { messages.push(message); },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
      addItem(entry) { inventory.set(entry.getId(), (inventory.get(entry.getId()) ?? 0) + entry.getAmount()); },
      forceAdd(_player, entry) { inventory.set(entry.getId(), (inventory.get(entry.getId()) ?? 0) + entry.getAmount()); },
      getFreeSlots: () => 28,
      isFull: () => false,
    }),
    getEquipment: () => ({
      get: (slot) => {
        const id = slot === core.Equipment.BODY_SLOT ? equipment.body
          : slot === core.Equipment.LEG_SLOT ? equipment.leg
            : slot === core.Equipment.HANDS_SLOT ? equipment.hands : equipment.weapon;
        return id === null ? null : { getId: () => id };
      },
      getItems: () => ({
        [core.Equipment.WEAPON_SLOT]: item(equipment.weapon ?? -1),
        [core.Equipment.AMMUNITION_SLOT]: item(equipment.ammo ?? -1),
      }),
    }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels.get(skill) ?? 99,
      getMaxLevel: (skill) => levels.get(skill) ?? 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
      setCurrentLevel() {}, setCurrentLevels() {}, updateSkill() {},
    }),
    getLocation: () => location,
    moveTo(value) { location = new core.Location(value.getX(), value.getY(), value.getZ()); },
    getPrivateArea: () => area,
    setArea(value) { area = value; },
    getArea: () => area,
    getMovementQueue: () => movement,
    setUntargetable() {},
    getDialogueManager: () => ({ startDialogues() {}, reset() {}, isActive: () => false }),
    getFightType: () => ({ getBonusType: () => 0 }),
    getWeapon: () => null,
    getCombat: () => combat,
    getSize: () => 1,
    getAttackAnim: () => 426,
    isPlayer: () => true,
    getAsPlayer() { return player; },
    isNpc: () => false,
    isRegistered: () => true,
    performAnimation() {},
  };
  const emit = (name, event = {}) => api.emitCustomEvent(name, { player, ...event });
  const action = (npcId, stepId) => emit('npc-dialogue:action', { npcId, stepId });
  const line = (npcId, text) => emit('npc-dialogue:line', { npcId, text });
  const object = (objectId, clickType = 1) => {
    const event = { player, objectId, clickType, location, definition: { getActions: () => ['Clear'] } };
    for (const fn of hooks.objects) fn(event);
    return event;
  };
  const npcInteraction = (npcId, extra = {}) => {
    const event = { player, npcId, handled: false, ...extra };
    for (const fn of hooks.npcs) fn(event);
    return event;
  };
  const itemOnObject = (itemId, objectId, extra = {}) => {
    const event = { player, itemId, objectId, ...extra };
    for (const fn of hooks.itemOnObject) fn(event);
    return event;
  };
  const itemOnNpc = (itemId, npcId) => {
    const event = { player, itemId, npcId, handled: false };
    for (const fn of hooks.itemOnNpc) fn(event);
    return event;
  };
  const makeTarget = () => {
    const def = NpcDefinition.forId(4763);
    return { getId: () => 4763, getCurrentDefinition: () => def,
      getLocation: () => new core.Location(3379, 9556, 0), getSize: () => 1,
      isNpc: () => true, isPlayer: () => false, getPrivateArea: () => null, getOwner: () => null };
  };
  const login = () => {
    for (const fn of hooks.login) fn({ player });
  };
  const logout = () => {
    for (const fn of hooks.logout) fn({ player });
  };
  return {
    core, api, hooks, quest, attrs, inventory, varbits, configs, messages, xp, equipment, player,
    emit, action, line, object, npcInteraction, itemOnObject, itemOnNpc, login, logout, tasks, makeTarget, originalRangedStart, cameras, songs, subInterfaces, spawned, movement, interfaces, strings,
    runTasks(maxTicks = Infinity) {
      for (;;) {
        let index = -1, best = Infinity;
        for (let i = 0; i < tasks.length; i++) {
          if (tasks[i].ticks <= maxTicks && tasks[i].ticks < best) {
            best = tasks[i].ticks;
            index = i;
          }
        }
        if (index < 0) return;
        const [task] = tasks.splice(index, 1);
        task.run();
      }
    },
    give(id, amount = 1) { inventory.set(id, (inventory.get(id) ?? 0) + amount); },
    ground,
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
  };
}

test('Spirits of the Elid follows native varbit stages, spawns/telegrabs its key and clears real channels', () => {
  const h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  const N = h.core.NpcIdentifiers, O = h.core.ObjectIdentifiers, I = h.core.ItemIdentifiers;
  h.emit('npc-dialogue:hook', { npcId: N.AWUSAH_THE_MAYOR, hook: 'quest:spirits-of-the-elid:start' });
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.varbits.get(1444), 10);

  h.action(N.GHASLOR_THE_ELDER, '4JXIDh');
  assert.equal(h.quest.getStage(h.player), 20);
  assert.equal(h.inventory.get(I.BALLAD), 1);
  assert.ok(h.ground.has('rituals-test:6792:3432:2928'), 'ancestral key must be on the shrine table');
  const cupboard = h.hooks.namedNpcs.find((entry) => entry.name === 'Cupboard').actions;
  const cupboardObject = {
    getLocation: () => new h.core.Location(3420, 2930, 0), getType: () => 10, getFace: () => 0,
    getPrivateArea: () => null,
  };
  cupboard.Open({ player: h.player, objectId: 10384, object: cupboardObject, handled: false });
  cupboard.Search({ player: h.player, objectId: 10385, object: cupboardObject, location: new h.core.Location(3420, 2930, 0), handled: false });
  assert.equal(h.inventory.get(I.TORN_ROBE), 1);
  assert.equal(h.inventory.get(I.TORN_ROBE_2), 1);
  for (const fn of h.hooks.custom.get('magic:telekinetic-grab') ?? []) fn({ player: h.player, itemId: 6792 });
  assert.equal(h.quest.getStage(h.player), 25);

  h.equipment.body = I.ROBE_OF_ELIDINIS;
  h.equipment.leg = I.ROBE_OF_ELIDINIS_2;
  h.give(I.ANCESTRAL_KEY, 1);
  h.give(I.BALLAD, 1);
  h.emit('door:toggle', { objectId: O.DOOR_250 });
  assert.equal(h.quest.getStage(h.player), 27);

  for (const golem of [N.WHITE_GOLEM, N.GREY_GOLEM, N.BLACK_GOLEM]) {
    for (const fn of h.hooks.npcDeaths) fn({ killer: h.player, npcId: golem });
  }
  h.give(PICKAXE_ID, 1);
  h.setLocation(3365, 9538);
  h.object(10399);
  h.setLocation(3378, 9547);
  h.object(10396);
  h.equipment.weapon = I.MAGIC_SHORTBOW;
  h.equipment.ammo = I.RUNE_ARROW;
  h.setLocation(3375, 9556);
  h.npcInteraction(4763, { npc: h.makeTarget(), clickType: 2 });
  assert.equal(h.varbits.get(1450), 1);
  assert.equal(h.varbits.get(1449), 1);
  assert.equal(h.varbits.get(1451), 1);
  assert.equal(h.quest.getStage(h.player), 27, 'stage 30 is the lake door, not the channel');

  h.emit('door:toggle', { objectId: O.DOOR_248 });
  assert.equal(h.quest.getStage(h.player), 30);
  h.line(N.NIRRIE, 'throw away a statuette of Elidinis');
  assert.equal(h.quest.getStage(h.player), 35);
  h.line(N.AWUSAH_THE_MAYOR, 'deep crevice in the desert to the west');
  assert.equal(h.quest.getStage(h.player), 40);
  assert.ok(h.ground.has('rituals-test:6790:3442:2917'), 'Awusah places his shoes');

  h.emit('npc-dialogue:choice', { npcId: N.GENIE_3, option: 'Ok I agree to the deal.' });
  assert.equal(h.quest.getStage(h.player), 50);
  h.give(I.SOLE, 1);
  h.action(N.GENIE_3, 'CqbO1I');
  assert.equal(h.quest.getStage(h.player), 55);
  assert.equal(h.inventory.get(I.STATUETTE_2), 1);
  h.action(N.AWUSAH_THE_MAYOR, 'G39MGw');
  assert.equal(h.quest.getStage(h.player), 60);
  assert.equal(h.quest.isComplete(h.player), true);
});

test('Spirits of the Elid rejects wrong attack styles and premature statuette use', () => {
  const h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  const hitFor = (style) => {
    h.player.getFightType = () => ({ getBonusType: () => style });
    const damages = [{ damage: 12, setDamage(value) { this.damage = value; } }];
    const total = () => damages.reduce((sum, damage) => sum + damage.damage, 0);
    return { damages, hit: { getCombatType: () => h.core.CombatType.MELEE, getAttacker: () => h.player,
      getHits: () => damages, getTotalDamage: total } };
  };
  for (const [npc, wrong, right] of [
    [N.WHITE_GOLEM, 1, 0],
    [N.GREY_GOLEM, 2, 1],
    [N.BLACK_GOLEM, 0, 2],
  ]) {
    let probe = hitFor(wrong);
    for (const fn of h.hooks.npcHits) fn({ npc: { getId: () => npc }, hit: probe.hit });
    assert.equal(probe.damages[0].damage, 0, `${npc} rejects the wrong style`);
    assert.ok(h.messages.some((message) => message.includes('only damage this golem with the')), `${npc} explains the required style`);
    probe = hitFor(right);
    for (const fn of h.hooks.npcHits) fn({ npc: { getId: () => npc }, hit: probe.hit });
    assert.equal(probe.damages[0].damage, 12, `${npc} accepts its required style`);
  }

  const before = h.quest.getStage(h.player);
  h.give(I.STATUETTE_2, 1);
  h.itemOnObject(I.STATUETTE_2, 10438);
  assert.equal(h.quest.getStage(h.player), before);
  assert.equal(h.quest.isComplete(h.player), false);
});

test('Spirits of the Elid migrates old stages and recovers lost key, robes and shoes', () => {
  const legacy = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  legacy.attrs.set('quest.spirits_of_the_elid.stage', 8);
  legacy.login();
  assert.equal(legacy.quest.getStage(legacy.player), 60);
  assert.equal(legacy.quest.isComplete(legacy.player), true);
  assert.equal(legacy.xp.length, 0, 'migration must not replay rewards');

  const h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  const I = h.core.ItemIdentifiers;
  h.login();
  assert.equal(h.ground.size, 0, 'nothing quest-specific is placed before the quest');
  h.quest.setStage(h.player, 25);
  h.login();
  assert.ok(h.ground.has('rituals-test:6792:3432:2928'), 'lost key is restored on relog');
  h.quest.setStage(h.player, 40);
  h.login();
  assert.ok(h.ground.has('rituals-test:6790:3442:2917'), 'lost shoes are restored on relog');
  h.give(I.TORN_ROBE, 1);
  h.inventory.delete(I.TORN_ROBE);
  const cupboard = h.hooks.namedNpcs.find((entry) => entry.name === 'Cupboard').actions;
  cupboard.Search({ player: h.player, objectId: 10385,
    object: { getLocation: () => new h.core.Location(3420, 2930, 0), getType: () => 10, getFace: () => 0, getPrivateArea: () => null },
    location: new h.core.Location(3420, 2930, 0), handled: false });
  assert.equal(h.inventory.get(I.TORN_ROBE), 1, 'lost torn robes can be recovered');
});

test("Shades of Mort'ton repairs to native 100/20, sanctifies serum and completes once at 85", () => {
  const h = setup('../plugins/quests/quests/ShadesOfMortton.Quest');
  const I = h.core.ItemIdentifiers, O = h.core.ObjectIdentifiers, N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 50);
  h.give(I.HAMMER, 1);
  h.object(O.BROKEN_WALL);
  assert.match(h.messages.at(-1), /material resource pool/);

  h.give(I.LIMESTONE_BRICK, 100);
  h.give(I.PLANK, 100);
  h.give(I.SWAMP_PASTE, 500);
  h.equipment.hands = I.FLAMTAER_BRACELET;
  for (let i = 0; i < 19; i++) h.object(O.BROKEN_WALL);
  assert.equal(h.quest.getStage(h.player), 55, '19 bracelet clicks are not enough');
  h.object(O.BROKEN_WALL);
  assert.equal(h.configs.get(343), 100);
  assert.ok(h.configs.get(345) >= 20);
  assert.equal(h.quest.getStage(h.player), 60);

  h.give(I.TINDERBOX, 1);
  h.itemOnObject(I.TINDERBOX, O.FIRE_ALTAR);
  h.give(I.OLIVE_OIL_4_, 1);
  h.itemOnObject(I.OLIVE_OIL_4_, O.FLAMING_FIRE_ALTAR);
  assert.equal(h.quest.getStage(h.player), 65);
  assert.equal(h.inventory.get(I.SACRED_OIL_4_), 1);

  h.give(I.SERUM_207_4_, 1);
  h.itemOnObject(I.SERUM_207_4_, O.FLAMING_FIRE_ALTAR);
  assert.equal(h.inventory.get(I.SERUM_208_4_), 1);
  assert.ok((h.configs.get(340) & 128) !== 0, 'sanctifying 207 sets made_perm_serum bit 7');

  h.give(I.SACRED_OIL_4_, 5);
  h.hooks.itemOnItem[0]({ player: h.player, usedItemId: I.SACRED_OIL_4_, usedWithItemId: I.MAGIC_LOGS });
  assert.equal(h.quest.getStage(h.player), 70);
  h.itemOnObject(I.MAGIC_PYRE_LOGS, O.FUNERAL_PYRE);
  assert.equal(h.quest.getStage(h.player), 75);
  h.give(I.LOAR_REMAINS, 1);
  h.itemOnObject(I.LOAR_REMAINS, O.FUNERAL_PYRE);
  h.itemOnObject(I.TINDERBOX, O.FUNERAL_PYRE);
  assert.equal(h.quest.getStage(h.player), 80);

  h.action(N.ULSQUIRE_SHAUNCY, 'LyXCwi');
  assert.equal(h.quest.getStage(h.player), 85);
  assert.equal(h.quest.isComplete(h.player), true);
  const xpCount = h.xp.length;
  h.action(N.ULSQUIRE_SHAUNCY, 'LyXCwi');
  assert.equal(h.xp.length, xpCount, 'completion rewards are granted once');
  assert.equal(h.configs.get(339), 85);
});

test('Tai Bwo Wannai Trio gates start, consumes vessels, cooks paste bones and completes at stage 6', () => {
  const h = setup('../plugins/quests/quests/TaiBwoWannaiTrio.Quest');
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers, O = h.core.ObjectIdentifiers;
  h.emit('npc-dialogue:hook', { npcId: N.TIMFRAKU, hook: 'quest:tai-bwo-wannai-trio:start' });
  h.line(N.TIMFRAKU, 'Well then adventurer, you would do better to rove elsewhere.');
  assert.equal(h.quest.getStage(h.player), 0, 'Jungle Potion is required');
  h.attrs.set('quest.jungle_potion.stage', 12);
  h.emit('npc-dialogue:hook', { npcId: N.TIMFRAKU, hook: 'quest:tai-bwo-wannai-trio:start' });
  assert.equal(h.quest.getStage(h.player), 3, 'direct hook still finalises for old saves');
  h.quest.setStage(h.player, 0);
  h.line(N.TIMFRAKU, 'Well then adventurer, you would do better to rove elsewhere.');
  assert.equal(h.quest.getStage(h.player), 1);
  h.line(N.TIMFRAKU, 'I now ask you to do one last thing for our village.');
  assert.equal(h.quest.getStage(h.player), 2);
  h.emit('npc-dialogue:hook', { npcId: N.TIMFRAKU, hook: 'quest:tai-bwo-wannai-trio:start' });
  assert.equal(h.quest.getStage(h.player), 3);

  h.attrs.set('quest.tai_bwo_wannai_trio.tamayu', 3);
  const black = h.itemOnNpc(I.BLACK_SPEAR, N.TAMAYU);
  assert.equal(black.handled, false, 'black spears are rejected for the hunt');
  const iron = h.itemOnNpc(I.IRON_SPEAR, N.TAMAYU);
  assert.equal(iron.handled, true, 'iron spear starts the hunt item branch');

  h.action(N.LUBUFU, 'SwVHKY');
  assert.equal(h.inventory.get(I.KARAMBWAN_VESSEL), 1);
  h.give(I.RAW_KARAMBWANJI, 1);
  h.hooks.itemOnItem[0]({ player: h.player, usedItemId: I.RAW_KARAMBWANJI, usedWithItemId: I.KARAMBWAN_VESSEL });
  assert.equal(h.inventory.get(I.KARAMBWAN_VESSEL_3), 1);
  h.action(N.TIADECHE, 'Tbc1Ao');
  assert.equal(h.attrs.get('quest.tai_bwo_wannai_trio.tiadeche'), 4);
  h.action(N.TIADECHE, '1kqTlj');
  assert.equal(h.inventory.get(I.RAW_KARAMBWAN), 1);

  h.give(I.PASTY_JOGRE_BONES_3, 1);
  h.itemOnObject(I.PASTY_JOGRE_BONES_3, O.FIRE, { object: { getDefinition: () => ({ getName: () => 'Fire' }) } });
  assert.equal(h.inventory.get(I.PASTY_JOGRE_BONES), 1);

  h.attrs.set('quest.tai_bwo_wannai_trio.tiadeche', 6);
  h.attrs.set('quest.tai_bwo_wannai_trio.tamayu', 4);
  h.attrs.set('quest.tai_bwo_wannai_trio.tinsay', 6);
  h.give(I.MARINATED_J_BONES, 1);
  h.action(N.TINSAY, 'oYUlzJ');
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.configs.get(320), 4);

  h.action(N.TIMFRAKU, 'SUa3hN');
  assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.configs.get(320), 6);
  assert.equal(h.inventory.get(I.COINS), 2000);
  const coins = h.inventory.get(I.COINS);
  h.action(N.TIMFRAKU, 'SUa3hN');
  assert.equal(h.inventory.get(I.COINS), coins, 'reward is handed out once');
});

test('Tai Bwo Wannai Trio refuses completion before all three sons return', () => {
  const h = setup('../plugins/quests/quests/TaiBwoWannaiTrio.Quest');
  const N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 3);
  h.action(N.TIMFRAKU, 'SUa3hN');
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.quest.isComplete(h.player), false);
});

test('Tai Bwo Wannai Trio migrates old completion without replaying the reward', () => {
  const h = setup('../plugins/quests/quests/TaiBwoWannaiTrio.Quest');
  h.attrs.set('quest.tai_bwo_wannai_trio.stage', 5);
  h.login();
  assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.quest.isComplete(h.player), true);
  h.action(h.core.NpcIdentifiers.TIMFRAKU, 'SUa3hN');
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.COINS) ?? 0, 0);
});

test('Tai Bwo Wannai Trio journal exposes QH group 119 predicates only at earned progress', () => {
  const h = setup('../plugins/quests/quests/TaiBwoWannaiTrio.Quest');
  const A = h.attrs;
  h.quest.setStage(h.player, 3);
  const journal = () => h.quest.buildJournal(h.player, h.quest).join('\n');
  const has = (text) => journal().includes(text);

  assert.equal(has('I must take a'), false);
  assert.equal(has('He will only return'), false);
  assert.equal(has('He has successfully caught'), false);

  A.set('quest.tai_bwo_wannai_trio.tiadeche', 2);
  assert.equal(has('<col=000080>I must take a <col=800000>Karambwan vessel<col=000080> to <col=800000>Tinsay<col=000080> and retrieve the crafting manual.</col>'), true);
  assert.equal(has('<col=000080>He will only return to the village once he has caught a Karambwan.</col>'), true);
  assert.equal(has('<str>He has successfully caught a Karambwan.</str>'), false);

  A.set('quest.tai_bwo_wannai_trio.karambwan', 1);
  assert.equal(has('<col=000080>He will only return'), false, 'the catch clears the pending line');
  assert.equal(has('<str>He has successfully caught a Karambwan.</str>'), true);
  A.set('quest.tai_bwo_wannai_trio.tiadeche', 5);
  assert.equal(has('<str>retrieved crafting instructions for Tiadeche.</str>'), true);

  A.set('quest.tai_bwo_wannai_trio.tinsay', 2);
  assert.equal(has('<col=000080>He requires <col=800000>banana in Karamja rum<col=000080> to repair the tribal statue.</col>'), true);
  assert.equal(has('<str>I have given him sliced banana in Karamja rum.</str>'), false);
  A.set('quest.tai_bwo_wannai_trio.tinsay', 4);
  assert.equal(has('<str>I have given him sliced banana in Karamja rum.</str>'), true);
  A.set('quest.tai_bwo_wannai_trio.tinsay', 6);
  assert.equal(has('<str>I have given him a seaweed in monkey skin sandwich.</str>'), true);
  A.set('quest.tai_bwo_wannai_trio.tinsay', 7);
  assert.equal(has('<str>I have given him a burnt Jogre bones marinated in raw Karambwanji paste.</str>'), true);

  A.set('quest.tai_bwo_wannai_trio.tamayu', 3);
  assert.equal(has('He appears to be having difficulty in the hunt.'), true);
  assert.equal(has('<str>Tamayu has slain the Shaikahan!</str>'), false);
  A.set('quest.tai_bwo_wannai_trio.agility', 4);
  assert.equal(has("<str>I have increased his agility to match the Shaikahan's.</str>"), true);
  A.set('quest.tai_bwo_wannai_trio.spear', 2);
  assert.equal(has('<str>I have give him a stronger and Karambwan poisoned spear.</str>'), true);
  A.set('quest.tai_bwo_wannai_trio.tamayu', 4);
  assert.equal(has('He appears to be having difficulty'), false, 'the hunt line clears after the kill');
  assert.equal(has('<str>Tamayu has slain the Shaikahan!</str>'), true);

  A.set('quest.tai_bwo_wannai_trio.lubufu', 5);
  assert.equal(has('Lubufu will teach me to catch Karambwan once I bring him 20 Karambwanji.'), true);
  assert.equal(has('<str>I have given Lubufu 20 Karambwanji.</str>'), false);
  A.set('quest.tai_bwo_wannai_trio.lubufu', 25);
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.KARAMBWAN_VESSEL) ?? 0, 0, 'Lubufu hand-in is truthful without a held vessel');
  assert.equal(has('Lubufu will teach me'), false, 'the pending line clears once the Karambwanji are handed in');
  assert.equal(has('<str>I have given Lubufu 20 Karambwanji.</str>'), true);
  assert.equal(has('<str>Lubufu trained me to catch Karambwan.</str>'), false);

  assert.equal(h.quest.getStage(h.player), 3, 'journal reads never advance the quest');
  assert.equal(h.quest.isComplete(h.player), false);
  runtime.openJournal(h.player, h.quest);
  assert.match(h.strings.get((119 << 16) | 5), /Tai Bwo Wannai Trio/);
  const rendered = [...h.strings.entries()]
    .filter(([uid]) => uid >= ((119 << 16) | 11) && uid <= ((119 << 16) | 60))
    .map(([, text]) => text)
    .join('\n');
  assert.match(rendered, /<str>I have given Lubufu 20 Karambwanji\.<\/str>/);
  assert.match(rendered, /<str>Tamayu has slain the Shaikahan!<\/str>/);
  assert.doesNotMatch(rendered, /QUEST COMPLETE!/);
  assert.equal(h.quest.getStage(h.player), 3);

  A.set('quest.tai_bwo_wannai_trio.lubufu', 31);
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.KARAMBWAN_VESSEL) ?? 0, 0, 'completed hand-in stays truthful with no held vessel');
  assert.equal(has('<str>I have given Lubufu 20 Karambwanji.</str>'), true, 'completed hand-in line survives apprenticeship');
  assert.equal(has('<str>Lubufu trained me to catch Karambwan.</str>'), true);
  assert.equal(has('Lubufu will teach me'), false, 'only the pending fetch line clears');
  assert.equal(h.quest.getStage(h.player), 3, 'apprenticeship journal does not advance the quest');
});

test("Shades of Mort'ton migrates old saves and publishes the native 207/208 cure bits", () => {
  const legacy = setup('../plugins/quests/quests/ShadesOfMortton.Quest');
  legacy.attrs.set('quest.shades_of_mortton.stage', 100);
  legacy.login();
  assert.equal(legacy.quest.getStage(legacy.player), 85);
  assert.equal(legacy.quest.isComplete(legacy.player), true);
  legacy.action(legacy.core.NpcIdentifiers.ULSQUIRE_SHAUNCY, 'LyXCwi');
  assert.equal(legacy.xp.length, 0, 'already-complete saves are not rewarded again');

  const temple = setup('../plugins/quests/quests/ShadesOfMortton.Quest');
  temple.quest.setStage(temple.player, 60);
  temple.attrs.set('quest.shades_of_mortton.met_razmire', 'cured');
  temple.login();
  assert.equal(temple.configs.get(343), 100);
  assert.equal(temple.configs.get(345), 20);
  assert.ok((temple.configs.get(340) & 12) !== 0, 'old cured-NPC saves rebuild varp 340');

  const cured = setup('../plugins/quests/quests/ShadesOfMortton.Quest');
  const I = cured.core.ItemIdentifiers, N = cured.core.NpcIdentifiers;
  cured.quest.setStage(cured.player, 80);
  cured.give(I.SERUM_207_4_, 1);
  for (const fn of cured.hooks.itemOnNpc) fn({ player: cured.player, npcId: N.ULSQUIRE_SHAUNCY, itemId: I.SERUM_207_4_, handled: false });
  assert.equal(cured.configs.get(340) & 0b1111, 0b0011, '207 on Ulsquire sets partial bits 0+1, not permanent bits');
  assert.equal(cured.configs.get(340) & 0b11100000, 0, '207 does not set permanent or made bits');

  cured.give(I.SERUM_208_4_, 1);
  for (const fn of cured.hooks.itemOnNpc) fn({ player: cured.player, npcId: N.RAZMIRE_KEELGAN, itemId: I.SERUM_208_4_, handled: false });
  const multi = cured.configs.get(340);
  assert.equal(multi & 64, 64, '208 on Razmire sets native permanent bit 6');
  assert.equal(multi & 32, 0, '208 on Razmire does not set Ulsquire bit 5');
  assert.equal(multi & 0b1100, 0, '208 is not published as the 207 Razmire partial mask');
  assert.equal(multi & 128, 0, 'using 208 does not pretend the player sanctified it');

  cured.give(I.SERUM_208_4_, 1);
  for (const fn of cured.hooks.itemOnNpc) fn({ player: cured.player, npcId: N.ULSQUIRE_SHAUNCY, itemId: I.SERUM_208_4_, handled: false });
  assert.equal(cured.configs.get(340) & 32, 32, '208 on Ulsquire sets native permanent bit 5');
  assert.equal(cured.configs.get(340) & 64, 64, 'Razmire permanent bit survives the second use');

  const permanent = setup('../plugins/quests/quests/ShadesOfMortton.Quest');
  permanent.attrs.set('shades-of-mortton:perm-ulsquire', true);
  permanent.attrs.set('shades-of-mortton:perm-razmire', true);
  permanent.attrs.set('shades-of-mortton:made-perm-serum', true);
  permanent.login();
  const restored = permanent.configs.get(340);
  assert.equal(restored & 32, 32, 'login restores Ulsquire permanent bit 5');
  assert.equal(restored & 64, 64, 'login restores Razmire permanent bit 6');
  assert.equal(restored & 128, 128, 'login restores made_perm_serum bit 7');
  assert.equal(restored & 0b1111, 0, 'login does not invent a partial 207 mask');
});

test("Shades of Mort'ton first repair gives the captured 1% repair / 2% sanctity, then a sanctity tick", () => {
  const h = setup('../plugins/quests/quests/ShadesOfMortton.Quest');
  const I = h.core.ItemIdentifiers, O = h.core.ObjectIdentifiers;
  h.quest.setStage(h.player, 55);
  h.give(I.HAMMER, 1);
  h.give(I.LIMESTONE_BRICK, 1);
  h.give(I.PLANK, 1);
  h.give(I.SWAMP_PASTE, 5);
  h.object(O.BROKEN_WALL);
  assert.equal(h.configs.get(343), 1);
  assert.equal(h.configs.get(345), 2);
  h.runTasks();
  assert.equal(h.configs.get(345), 3);
});

test('Shades of Mort\'ton reading the diary opens the captured book spread', () => {
  const h = setup('../plugins/quests/quests/ShadesOfMortton.Quest');
  const I = h.core.ItemIdentifiers;
  h.give(I.DIARY_2, 1);
  const event = { player: h.player, itemId: I.DIARY_2, option: 'Read', handled: false };
  for (const fn of h.hooks.itemActions) fn(event);
  assert.equal(event.handled, true);
  assert.equal(h.quest.getStage(h.player), 0, 'reading first asks to start the quest');
  const started = { player: h.player, stepId: 'eINek0', handled: false };
  h.emit('npc-dialogue:action', started);
  assert.equal(h.quest.getStage(h.player), 5);
  assert.ok(h.interfaces.includes(392), 'book 392 opens');
  assert.equal(h.strings.get((392 << 16) | 6), 'Diary of Herbi Flax');
  assert.equal(h.strings.get((392 << 16) | 44), '<col=000080> ~ Page 11 ~ ');
  assert.match(h.strings.get((392 << 16) | 45), /Some local townsfolk/);
  assert.equal(h.strings.get((392 << 16) | 62), 'The remains of a primitive');
  assert.match(h.strings.get((392 << 16) | 63), /temple to the north/);
});

test('Spirits of the Elid rope descent plays the captured camera, fade, tile and theme', () => {
  const h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  const I = h.core.ItemIdentifiers, O = h.core.ObjectIdentifiers;
  h.give(I.ROPE, 1);
  h.setLocation(3371, 3132);
  h.itemOnObject(I.ROPE, O.ROOT_3);
  assert.deepEqual(h.cameras[0], ['move', 3368, 3134, 1175, { rate: 1, rate2: 200 }]);
  assert.deepEqual(h.cameras[1], ['look', 3372, 3130, 25, { rate: 1, rate2: 200 }]);
  assert.ok(h.subInterfaces.some(([kind, uid, id]) => kind === 'open' && uid === (161 << 16) | 1 && id === 174));
  h.runTasks(2);
  assert.equal(h.player.getLocation().getX(), 3349);
  assert.equal(h.player.getLocation().getY(), 9536);
  assert.ok(h.songs.includes(462), 'Spirits of the Elid theme plays');
  assert.ok(h.cameras.some(([kind]) => kind === 'reset'));
  assert.ok(h.subInterfaces.some(([kind, uid]) => kind === 'close' && uid === (161 << 16) | 1));
});

test('Spirits of the Elid logout during the rope fade cancels the pending descent', () => {
  const h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  const I = h.core.ItemIdentifiers, O = h.core.ObjectIdentifiers;
  h.give(I.ROPE, 1);
  h.setLocation(3371, 3132);
  h.itemOnObject(I.ROPE, O.ROOT_3);
  h.logout();
  h.runTasks(10);
  assert.equal(h.player.getLocation().getX(), 3371, 'logout does not teleport to the dungeon');
  assert.equal(h.player.getLocation().getY(), 3132);
  assert.equal(h.movement.blocked, false, 'logout restores movement');
  assert.ok(h.subInterfaces.some(([kind, uid]) => kind === 'close' && uid === (161 << 16) | 1), 'fade closes on logout');
  assert.ok(h.cameras.some(([kind]) => kind === 'reset'), 'camera resets on logout');
});

test('Tai Bwo Wannai Trio plays the captured Shaikahan hunt and delays progress until it ends', () => {
  const h = setup('../plugins/quests/quests/TaiBwoWannaiTrio.Quest');
  const N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 3);
  h.attrs.set('quest.tai_bwo_wannai_trio.tamayu', 2);
  h.setLocation(2845, 3046);
  h.action(N.TAMAYU, 'cMkbX1');
  assert.equal(h.attrs.get('quest.tai_bwo_wannai_trio.tamayu'), 2, 'progress waits for the scene');
  assert.equal(h.player.getLocation().getX(), 2520);
  assert.equal(h.player.getLocation().getY(), 4568);
  assert.equal(h.movement.blocked, true);
  assert.ok(h.spawned.some((npc) => npc.getId() === 4705));
  assert.ok(h.spawned.some((npc) => npc.getId() === 4709));
  assert.ok(h.spawned.some((npc) => npc.getId() === 2848));
  h.runTasks(0);
  assert.deepEqual(h.cameras[0], ['move', 2518, 4571, 350, { rate: 232, rate2: 100 }]);
  h.runTasks(24);
  assert.equal(h.attrs.get('quest.tai_bwo_wannai_trio.tamayu'), 2);
  h.runTasks(25);
  assert.equal(h.attrs.get('quest.tai_bwo_wannai_trio.tamayu'), 3);
  assert.equal(h.player.getLocation().getX(), 2845);
  assert.equal(h.player.getLocation().getY(), 3046);
  assert.ok(h.cameras.some(([kind]) => kind === 'reset'));

  h.action(N.TAMAYU, 'qnTEqZ');
  assert.equal(h.player.getLocation().getX(), 2520);
  h.runTasks(14);
  assert.equal(h.player.getLocation().getX(), 2537);
  assert.ok(h.spawned.some((npc) => npc.getId() === 4706));
  h.runTasks(31);
  assert.ok(h.songs.includes(147));
  assert.equal(h.attrs.get('quest.tai_bwo_wannai_trio.tamayu'), 4);
  assert.equal(h.player.getLocation().getX(), 2845);
  assert.equal(h.player.getLocation().getY(), 3046);
});

test('Tai Bwo Wannai Trio hunt interruption cancels the scene without granting progress', () => {
  const h = setup('../plugins/quests/quests/TaiBwoWannaiTrio.Quest');
  const N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 3);
  h.attrs.set('quest.tai_bwo_wannai_trio.tamayu', 2);
  h.setLocation(2845, 3046);
  h.action(N.TAMAYU, 'cMkbX1');
  h.runTasks(10);
  assert.equal(h.attrs.get('quest.tai_bwo_wannai_trio.tamayu'), 2);
  h.logout();
  assert.equal(h.movement.blocked, false);
  assert.equal(h.player.getLocation().getX(), 2845);
  assert.equal(h.player.getLocation().getY(), 3046);
  h.runTasks(100);
  assert.equal(h.attrs.get('quest.tai_bwo_wannai_trio.tamayu'), 2, 'no progress after interruption');
});

test('Spirits ranging target routes the Shoot click across the channel', () => {
  const h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  const route = { player: h.player, npcId: 4763, range: 1 };
  for (const fn of h.hooks.npcRoutes) fn(route);
  assert.equal(route.range, 10);
  const other = { player: h.player, npcId: 1, range: 1 };
  for (const fn of h.hooks.npcRoutes) fn(other);
  assert.equal(other.range, 1);
});

test('Spirits ranged target validates the real Shoot option and generic ranged ammo', () => {
  assert.equal(NpcDefinition.forId(4763).getActions()[1], 'Shoot');
  const prepare = (h) => {
    h.quest.setStage(h.player, 27);
    for (const fn of h.hooks.npcDeaths) fn({ killer: h.player, npcId: h.core.NpcIdentifiers.BLACK_GOLEM });
    h.setLocation(3375, 9556);
  };
  const shoot = (h, clickType = 2) => h.npcInteraction(4763, { npc: h.makeTarget(), clickType });

  let h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  prepare(h);
  let event = shoot(h, 1);
  assert.equal(event.handled, false, 'a non-Shoot option cannot clear the channel');
  assert.notEqual(h.varbits.get(1451), 1);

  h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  prepare(h);
  shoot(h);
  assert.match(h.messages.at(-1), /ranged weapon/);
  assert.notEqual(h.varbits.get(1451), 1);
  assert.equal(h.player.getLocation().getX(), 3375);

  h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  prepare(h);
  h.equipment.weapon = h.core.ItemIdentifiers.MAGIC_SHORTBOW;
  shoot(h);
  assert.match(h.messages.at(-1), /ammunition/);
  assert.notEqual(h.varbits.get(1451), 1);

  h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  prepare(h);
  h.equipment.weapon = h.core.ItemIdentifiers.MAGIC_SHORTBOW;
  h.equipment.ammo = h.core.ItemIdentifiers.DRAGON_ARROW;
  shoot(h);
  assert.match(h.messages.at(-1), /can not use/);
  assert.notEqual(h.varbits.get(1451), 1);

  h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  prepare(h);
  h.equipment.weapon = h.core.ItemIdentifiers.MAGIC_SHORTBOW;
  h.equipment.ammo = h.core.ItemIdentifiers.RUNE_ARROW;
  event = shoot(h);
  assert.equal(event.handled, true);
  assert.equal(h.varbits.get(1451), 1);
  assert.equal(h.player.__rangedShots, 1);
  assert.notEqual(h.player.getLocation().getX(), 3375);

  h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  prepare(h);
  h.equipment.weapon = h.core.ItemIdentifiers.RUNE_KNIFE;
  event = shoot(h);
  assert.equal(event.handled, true, 'self-ammo thrown weapons use the weapon slot');
  assert.equal(h.varbits.get(1451), 1);
  assert.equal(h.player.__rangedShots, 1);

  h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  h.quest.setStage(h.player, 10);
  h.setLocation(3375, 9556);
  h.equipment.weapon = h.core.ItemIdentifiers.MAGIC_SHORTBOW;
  h.equipment.ammo = h.core.ItemIdentifiers.RUNE_ARROW;
  event = shoot(h);
  assert.equal(event.handled, false, 'before the dungeon stage the target is inert');
  assert.notEqual(h.varbits.get(1451), 1);

  h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  prepare(h);
  h.equipment.weapon = h.core.ItemIdentifiers.MAGIC_SHORTBOW;
  h.equipment.ammo = h.core.ItemIdentifiers.RUNE_ARROW;
  const target = h.makeTarget();
  target.getOwner = () => ({});
  event = h.npcInteraction(4763, { npc: target, clickType: 2 });
  assert.equal(event.handled, false, 'another owner target stays inert');
  assert.notEqual(h.varbits.get(1451), 1);
});

test('Spirits lost statuette reaches the recorded Genie recovery and re-trades in a full bag', () => {
  const h = setup('../plugins/quests/quests/SpiritsOfTheElid.Quest');
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  const inventory = new Inventory(h.player);
  h.player.getInventory = () => inventory;
  h.quest.setStage(h.player, 55);
  for (let i = 0; i < 27; i++) inventory.adds(I.SHARK, 1);
  inventory.adds(I.SOLE, 1);
  assert.equal(inventory.getFreeSlots(), 0);
  const variant = h.hooks.variants[0]({ player: h.player, npcId: N.GENIE_3 });
  assert.equal(variant, 'sole-split-talking-to-the-genie-after-losing-the-statuette');
  const raw = require('../data/definitions/npc-dialogues.json')['Spirits of the Elid']
    .variants[variant];
  assert.match(JSON.stringify(raw), /UDr1XL/);
  h.emit('npc-dialogue:action', { npcId: N.GENIE_3, stepId: 'UDr1XL' });
  assert.equal(inventory.getAmount(I.SOLE), 0);
  assert.equal(inventory.getAmount(I.STATUETTE_2), 1);
  assert.equal(h.quest.getStage(h.player), 55);
});

function realInventorySetup() {
  const h = setup('../plugins/quests/quests/TaiBwoWannaiTrio.Quest');
  const inventory = new Inventory(h.player);
  h.player.getInventory = () => inventory;
  h.quest.setStage(h.player, 4);
  return { h, inventory, I: h.core.ItemIdentifiers };
}

test("Tai completion delivers all 2,000 coins with a no-coin full bag and no duplicate", () => {
  const manager = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager').ItemOnGroundManager;
  const original = manager.registers;
  const drops = [];
  manager.registers = (_player, item) => drops.push({ id: item.getId(), amount: item.getAmount() });
  try {
    const { h, inventory, I } = realInventorySetup();
    for (let i = 0; i < 28; i++) inventory.adds(I.SHARK, 1);
    assert.equal(inventory.getFreeSlots(), 0);
    h.action(h.core.NpcIdentifiers.TIMFRAKU, 'SUa3hN');
    assert.equal(h.quest.getStage(h.player), 6);
    assert.equal(inventory.getAmount(I.COINS), 0);
    assert.deepEqual(drops, [
      { id: I.COINS, amount: 1999 },
      { id: I.COINS, amount: 1 },
    ]);
    assert.equal(drops.reduce((total, drop) => total + drop.amount, 0), 2000);
    h.action(h.core.NpcIdentifiers.TIMFRAKU, 'SUa3hN');
    assert.equal(drops.length, 2, 'completion reward is not repeated');
    assert.equal(drops.reduce((total, drop) => total + drop.amount, 0), 2000);
  } finally {
    manager.registers = original;
  }
});

test('Tai completion merges the extra coins into an existing stack and adds on one free slot', () => {
  const manager = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager').ItemOnGroundManager;
  const original = manager.registers;
  const drops = [];
  manager.registers = (_player, item) => drops.push(item);
  try {
    let { h, inventory, I } = realInventorySetup();
    for (let i = 0; i < 27; i++) inventory.adds(I.SHARK, 1);
    inventory.adds(I.COINS, 100);
    assert.equal(inventory.getFreeSlots(), 0);
    h.action(h.core.NpcIdentifiers.TIMFRAKU, 'SUa3hN');
    assert.equal(drops.length, 0);
    assert.equal(inventory.getAmount(I.COINS), 2100);

    ({ h, inventory, I } = realInventorySetup());
    for (let i = 0; i < 27; i++) inventory.adds(I.SHARK, 1);
    assert.equal(inventory.getFreeSlots(), 1);
    h.action(h.core.NpcIdentifiers.TIMFRAKU, 'SUa3hN');
    assert.equal(drops.length, 0);
    assert.equal(inventory.getAmount(I.COINS), 2000);
  } finally {
    manager.registers = original;
  }
});
