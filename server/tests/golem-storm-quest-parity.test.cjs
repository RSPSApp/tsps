const assert = require('node:assert/strict');
process.env.DISABLE_PLAYER_BOTS = '1';
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

// The two quests only need the transcript hooks to be observed, not animated.
const transcripts = [];
let nativeShadowContext = null;
const realStartTranscript = runtime.startTranscript;
runtime.startTranscript = (api, player, npcId, page, variant, select) => {
  transcripts.push({ player, npcId, page, variant, select });
  return true;
};

function setup(register, options = {}) {
  const hooks = { custom: new Map(), variants: [], conditions: [], login: [], logout: [], zoneEnter: [], objects: [], itemActions: [], itemOnNpc: [], itemOnObject: [], itemOnItem: [], npcs: [], combatProviders: [] };
  const tasks = [];
  const spawned = [], removed = [], ground = [], cameras = [], shakes = [], statements = [], sceneObjects = [], overheads = [], projectiles = [];
  let tick = 0;
  const executed = new Set();
  const core = {
    ...PluginManager.getCoreApi(),
    CombatRange: { canReach(npc, method, target) { return npc.calculateDistance(target) <= 1; } },
    PathFinder: { calculateWalkRoute(npc, x, y) { npc.route = [x, y]; } },
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    TaskManager: { submit(task) { task.due = tick + task.ticks; tasks.push(task); }, cancelTasks() {} },
    Boundary: class { constructor(...bounds) { this.bounds = bounds; } },
    PrivateArea: class {
      constructor(bounds) { this.bounds = bounds; this.members = []; }
      enter(player) { player.__area = this; this.members.push(player); }
      leave(player) { this.members = this.members.filter((member) => member !== player); if (player.__area === this) player.__area = null; }
      add(member) { this.members.push(member); member.setArea?.(this); }
      detach(member) { this.members = this.members.filter(candidate => candidate !== member); }
      remove(member) { this.detach(member); member.setArea?.(null); }
    },
    GameObject: class { constructor(id, location, type, rotation, area) { Object.assign(this, { id, location, type, rotation, area }); } },
    ObjectManager: { register(object) { sceneObjects.push(object); }, deregister(object) { sceneObjects.splice(sceneObjects.indexOf(object), 1); } },
    MultiChatboxPrompt: { getPending: () => null },
    ActionDialogue: class { constructor(index, options) { Object.assign(this, { index, ...options }); } },
    DialogueChainBuilder: class { add(part) { this.part = part; return this; } },
    StatementDialogue: class { static send(player, text) { statements.push(text); } },
    Projectile: {
      createProjectile(cast, target, id, start, end, startHeight, endHeight) {
        const projectile = { cast, target, id, start, end, startHeight, endHeight,
          withAngle(angle) { this.angle = angle; return this; },
          withProgress(progress) { this.progress = progress; return this; },
          sendProjectile() { projectiles.push(this); return this; } };
        return projectile;
      },
      ticksToLand(end) { return Math.ceil(end / 30); },
      arrivalTicks() { return 3; },
      centreOf(mobile) { return mobile.getLocation(); },
    },
  };
  if (options.realDialogue) {
    const realCore = PluginManager.getCoreApi();
    for (const key of ['ActionDialogue', 'DialogueChainBuilder', 'StatementDialogue']) core[key] = realCore[key];
  }
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(fn) { hooks.npcs.push(fn); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemAction(fn) { hooks.itemActions.push(fn); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onItemOnItem(fn) { hooks.itemOnItem.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    onZoneEnter(zone, fn) { hooks.zoneEnter.push(fn); },
    onZoneExit() {},
    onNpcBeforeDeath() {},
    onNpcDeath() {},
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    registerNpcCombatMethodProvider(npcIds, ctor, options) { hooks.combatProviders.push({ npcIds: new Set(Array.isArray(npcIds) ? npcIds : [npcIds]), ctor, options }); },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && options.prereqs !== false && ['the_golem', 'demon_slayer'].includes(event?.key)) event.complete = true;
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    spawnNpc(def) {
      let location = new core.Location(def.x, def.y, def.z), area = null;
      const npc = { def, getId: () => def.id, getOwner: () => def.owner, getLocation: () => location,
        moveTo: to => { location = to; }, getPrivateArea: () => area, getArea: () => area, setArea: value => { area = value; },
        getCurrentDefinition: () => core.NpcDefinition.forId(def.id), isVisible: () => true,
        isOwnerOnly: () => def.ownerOnly === true, forceChat: text => overheads.push({ actor: npc, text, tick }),
        setPositionToFace: at => { npc.face = at; },
        performAnimation(animation) { npc.lastAnimation = animation; (npc.animations ??= []).push(animation); },
        performGraphic(graphic) { npc.lastGraphic = graphic; (npc.graphics ??= []).push(graphic); },
        getMovementQueue: () => ({ setBlockMovement() { return this; }, reset() { return this; } }),
        getSize: () => def.size ?? 1,
        calculateDistance(target) {
          const other = target.getLocation();
          return Math.max(Math.abs(location.getX() - other.getX()), Math.abs(location.getY() - other.getY()));
        },
        setFlag(key, value) { (npc.flags ??= new Map()).set(key, value); },
        removeFlag(key) { npc.flags?.delete(key); },
        isRegistered: () => !npc.removed };
      spawned.push(npc); return npc;
    },
    removeNpc(npc) { npc.removed = true; removed.push(npc); },
    getItemOnGroundManager: () => ({
      getGroundItem: (owner, id, location) => ground.find((item) => item.id === id && item.location.x === location.x && item.location.y === location.y),
      registerLocation: (player, item, location, privateArea = player.getPrivateArea()) => ground.push({ id: item.getId(), location, privateArea }),
      onRegionChange() {},
    }),
    getWorld: () => ({ getNpcs: () => [] }),
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  register(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const attrs = new Map(), inventory = new Map(), varbits = new Map(), messages = [], prayers = [];
  let location = new core.Location(0, 0, 0), dialogue = null, npcViewDistance = 15;
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    sendCameraMoveTo(x, y, height, motion) { cameras.push({ kind: 'move', x, y, height, motion }); return sender; },
    sendCameraLookAt(x, y, height, motion) { cameras.push({ kind: 'look', x, y, height, motion }); return sender; },
    sendCameraReset() { cameras.push({ kind: 'reset' }); return sender; },
    sendCameraShake(slot, random) { shakes.push({ slot, random }); return sender; },
    sendInterfaceRemoval() { if (options.realDialogue) player.getDialogueManager().reset(); return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getUsername: () => 'parity-test', getDisplayName: () => 'parity-test',
    getAppearance: () => ({ isMale: () => true }),
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    sendMessage(message) { messages.push(message); },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      isFull: () => false,
      getFreeSlots: () => 28,
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
    }),
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 99, addExperiences() {} }),
    getPrayerActive: () => prayers,
    getHitpoints: () => 99,
    getLocation: () => location,
    moveTo(value) { location = value; },
    getPrivateArea: () => player?.__area ?? null,
    getArea: () => player.__area,
    getNpcViewDistance: () => npcViewDistance,
    setNpcViewDistance(distance) { npcViewDistance = distance == null ? 15 : Math.max(1, Math.min(127, Math.trunc(distance))); },
    getLocalNpcs: () => spawned.filter(npc => !npc.removed
      && location.isViewableFromWithin(npc.getLocation(), npcViewDistance)
      && npc.getPrivateArea() === player.getPrivateArea()),
    forceChat: text => overheads.push({ actor: player, text, tick }),
    setUntargetable() {},
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    getDialogueManager: () => ({
      startDialogues(chain) { dialogue = chain; },
      isActive: () => dialogue !== null,
      getCurrent: () => dialogue,
      reset() { dialogue = null; },
    }),
    isRegistered: () => true,
    isPlayer: () => true,
    setPositionToFace(at) { player.face = at; },
    performAnimation(animation) { (player.animations ??= []).push(animation); },
  };
  if (options.realDialogue) {
    const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
    const manager = new DialogueManager(player);
    player.getDialogueManager = () => manager;
  }
  const emit = (name, event) => api.emitCustomEvent(name, { player, ...event });
  const advance = () => {
    tick++;
    for (const task of [...tasks]) {
      if (!executed.has(task) && task.due <= tick) { executed.add(task); task.run(); }
    }
  };
  return { api, core, quest, attrs, inventory, varbits, messages, player, tasks, spawned, removed, ground, transcripts, hooks, emit, advance,
    cameras, shakes, statements, sceneObjects, overheads, projectiles, prayers,
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); } };
}

// The Golem's own route (clay, letter, notes, museum, alcoves, door, program) is played through
// real packets against its revision 242 capture in the-golem-capture.test.cjs.

test('Shadow of the Storm: the plane-2 exit portal still works once the quest is complete (#2158)', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api), { prereqs: false });
  const tile = () => [h.player.getLocation().x, h.player.getLocation().y, h.player.getLocation().z];

  // Control: a player who has not reached the ritual group is not moved by it.
  h.quest.setStage(h.player, 0);
  h.setLocation(2720, 4884, 2);
  h.hooks.objects[0]({ player: h.player, objectId: 6282 });
  assert.deepEqual(tile(), [2720, 4884, 2], 'a pre-quest player is not moved');

  // Completion leaves the player in the plane-2 dimension; the portal must let them out.
  h.quest.setStage(h.player, 130);
  h.setLocation(2720, 4900, 2);
  h.hooks.objects[0]({ player: h.player, objectId: 6282 });
  assert.deepEqual(tile(), [2721, 4911, 0], 'a finished player leaves through the exit portal');
});

test('Shadow of the Storm: Recipe for Disaster does not swallow the exit portal for a finished player (#2158)', () => {
  // Real hook ordering: RFD registers its named "Portal" hook before Shadow's generic one.
  for (const [name, modulePath] of [
    ['RecipeForDisaster', '../plugins/quests/quests/RecipeForDisaster.Quest'],
    ['ShadowOfTheStorm', '../plugins/quests/quests/ShadowOfTheStorm.Quest'],
  ]) require(modulePath)(PluginManager.createApi(name));
  const quests = runtime.getRegisteredQuests();
  const rfd = quests.findLast((quest) => quest.key === 'recipe_for_disaster');
  const shadow = quests.findLast((quest) => quest.key === 'shadow_of_the_storm');
  // Reuse this real registration in later World cases; duplicate quest hooks
  // would create a second private scene and cast for every native Chant.
  nativeShadowContext = { api: PluginManager.createApi('ShadowOfTheStorm'), quest: shadow };
  const { Location } = PluginManager.getCoreApi();

  const attrs = new Map(), messages = [];
  let at = new Location(2720, 4900, 2);
  const sender = new Proxy({}, { get: (target, key) => target[key] ?? (() => sender) });
  const player = {
    isPlayer: () => true, getAsPlayer: () => player,
    getAttribute: (key) => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender, sendMessage: (text) => messages.push(text),
    getLocation: () => at, moveTo: (to) => { at = to; },
    getArea: () => null, getPrivateArea: () => null,
    getInventory: () => ({ getAmount: () => 0, getFreeSlots: () => 28 }),
  };
  attrs.set('recipe-for-disaster:rescues', 255);
  attrs.set('quest.points', 200);
  rfd.setStage(player, 5);
  shadow.setStage(player, 130);

  const click = (location) => {
    const event = {
      player, object: {}, objectId: 6282, clickType: 1, location,
      definition: { getName: () => 'Portal', getInteractions: () => ['Enter'] },
    };
    PluginManager.emitObjectInteraction(event);
    return event.handled === true;
  };

  assert.equal(click(new Location(2720, 4884, 2)), true);
  assert.deepEqual([at.x, at.y, at.z], [2721, 4911, 0], 'Shadow handles the exit after RFD declines');
  assert.equal(messages.some((text) => /175 quest points/.test(text)), false, 'no RFD message at the Uzer portal');

  // Control: the real RFD entry portal still shows the requirement message.
  at = new Location(3209, 3218, 0);
  assert.equal(click(new Location(3209, 3218, 0)), true);
  assert.ok(messages.some((text) => /175 quest points/.test(text)), 'entry portal keeps its message');
  assert.deepEqual([at.x, at.y, at.z], [3209, 3218, 0]);
});

test('Shadow: server completion 130 mirrors the native 7-bit varbit as 125 on login', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const quest = h.quest;
  assert.equal(quest.completionValue, 130, 'legacy server completion stage is preserved');
  assert.equal(quest.varbitValue(124, h.player), 124);
  assert.equal(quest.varbitValue(130, h.player), 125, 'capture 3333 finished agrith_quest value');
  for (const stage of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 124, 130]) {
    assert.ok(quest.varbitValue(stage, h.player) <= 127, `stage ${stage} fits the 7-bit varbit`);
  }

  h.quest.setStage(h.player, 130);
  assert.equal(h.quest.getStage(h.player), 130, 'server stage remains 130');
  assert.equal(h.varbits.get(1372), 125, 'setStage mirrors the native finished value');

  h.varbits.clear();
  // Same production function the login hook runs (registerQuestWidgets is
  // registered once per process, so later test setups do not own that hook).
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(1372), 125, 'login replays 125, not wrapped 0');
  assert.equal(h.quest.getStage(h.player), 130);
});

test('The Golem: the curator is released after quest completion', () => {
  const h = setup((api) => require('../plugins/quests/quests/TheGolem.Quest')(api));
  const curator = h.core.NpcIdentifiers.CURATOR_HAIG_HALEN;
  h.quest.setStage(h.player, 3);
  h.attrs.set('quest.the_golem.letter', 3); // the notes read: the statuette conversation
  assert.ok(h.hooks.variants[0]({ player: h.player, npcId: curator, npc: { getId: () => curator } }));
  h.quest.setStage(h.player, 10);
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: curator, npc: { getId: () => curator } }), null);
});

test('Shadow: real PrivateArea destruction removes scene items but keeps the world-owned sigil', async () => {
  const path = require('node:path');
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.join(__dirname, '..'));
  const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const { ItemOnGround, State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
  const { Item } = require('../dist/game/model/Item');
  const { Location } = require('../dist/game/model/Location');
  class SceneArea extends PrivateArea { constructor() { super([]); } }
  const area = new SceneArea();
  const sceneSigil = new ItemOnGround(State.SEEN_BY_EVERYONE, 'shadow-audit', new Location(3100, 3100, 0), new Item(6748, 1), false, -1, area);
  const worldSigil = new ItemOnGround(State.SEEN_BY_EVERYONE, 'shadow-audit', new Location(3100, 3101, 0), new Item(6748, 1), false, -1, null);
  ItemOnGroundManager.register(sceneSigil);
  ItemOnGroundManager.register(worldSigil);
  assert.ok(ItemOnGroundManager.getGroundItem('shadow-audit', 6748, new Location(3100, 3100, 0), area));
  area.destroy();
  assert.equal(ItemOnGroundManager.getGroundItem('shadow-audit', 6748, new Location(3100, 3100, 0), null), null, 'scene-owned item is cleaned up');
  assert.ok(ItemOnGroundManager.getGroundItem('shadow-audit', 6748, new Location(3100, 3101, 0), null), 'world-owned item survives');
  ItemOnGroundManager.deregister(worldSigil);
});

test('Shadow of the Storm: Reen only replaces Silverlight the player owns in no form', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const I = h.core.ItemIdentifiers;
  const banked = new Map();
  h.player.getBanks = () => [{ getAmount: (id) => banked.get(id) ?? 0 }];
  h.quest.setStage(h.player, 30);
  for (const form of [I.SILVERLIGHT, I.SILVERLIGHT_2, I.DARKLIGHT]) {
    banked.clear();
    banked.set(form, 1);
    h.emit('npc-dialogue:action', { npcId: h.core.NpcIdentifiers.FATHER_REEN, stepId: 'Kh2EP0' });
    assert.equal(h.inventory.get(I.SILVERLIGHT) ?? 0, 0, `a banked ${form} is not replaced`);
    assert.equal(h.hooks.conditions[0]({ player: h.player, stepId: 'fllvV0' }), false, 'a banked sword is not lost');
  }
  banked.clear();
  assert.equal(h.hooks.conditions[0]({ player: h.player, stepId: 'fllvV0' }), true);
  h.emit('npc-dialogue:action', { npcId: h.core.NpcIdentifiers.FATHER_REEN, stepId: 'Kh2EP0' });
  assert.equal(h.inventory.get(I.SILVERLIGHT), 1, 'a lost sword is handed back');
});

test('Shadow: the first-ritual handoff requires the sigil, dyed Silverlight and throne-room position', () => {
  for (const missing of ['sigil', 'sword', 'room']) {
    const h = setup(api => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
    const I = h.core.ItemIdentifiers;
    h.quest.setStage(h.player, 70);
    h.setLocation(2722, 4901, missing === 'room' ? 0 : 2);
    if (missing !== 'sigil') h.inventory.set(I.DEMONIC_SIGIL, 1);
    if (missing !== 'sword') h.inventory.set(I.SILVERLIGHT_2, 1);
    assert.equal(h.hooks.variants[0]({ player: h.player, npcId: h.core.NpcIdentifiers.MATTHEW }),
      'infiltrating-the-wizards-talking-to-matthew-again-after-showing-him-the-book', missing);
    assert.equal(h.quest.getStage(h.player), 70);
  }
});

test('Shadow: the completed quest still leaves the demon portal usable', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  h.quest.setStage(h.player, 130);
  h.setLocation(2720, 4900, 2);
  h.hooks.objects[0]({ player: h.player, objectId: 6282 });
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], [2721, 4911, 0]);
});

test('Shadow: Agrith switches to Fire Blast and telekinetic grab, as the Wiki describes', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const N = h.core.NpcIdentifiers, core = h.core;
  const provider = h.hooks.combatProviders.find((entry) => entry.npcIds.has(N.AGRITH_NAAR));
  assert.ok(provider, 'Agrith-Naar has a combat-method provider');
  const npc = h.api.spawnNpc({ id: N.AGRITH_NAAR, x: 2719, y: 4899, z: 2, owner: h.player, ownerOnly: true });
  npc.def.size = 3;

  const castAtDistance = () => {
    const method = new provider.ctor();
    method.start(npc, h.player);
    return method;
  };

  h.setLocation(2720, 4912, 2);
  let method = castAtDistance();
  assert.equal(method.type(), core.CombatType.MAGIC, 'out of melee reach he casts');
  assert.ok(h.projectiles.some((projectile) => projectile.id === 130 && projectile.cast === npc), 'Fire Blast projectile');

  h.projectiles.length = 0;
  h.prayers[core.PrayerHandler.PROTECT_FROM_MAGIC] = true;
  method = castAtDistance();
  // Rsprox 572 t1385-t1388: the grab is projectile 143, and moves the player when it lands.
  assert.deepEqual(h.projectiles.map((projectile) => projectile.id), [143], 'Protect from Magic prevents the Fire Blast');
  assert.equal(h.player.getLocation().getY(), 4912, 'not moved on the cast');
  for (let i = 0; i < 12; i++) h.advance();
  assert.ok(Math.max(Math.abs(h.player.getLocation().getX() - 2719), Math.abs(h.player.getLocation().getY() - 4899)) <= 3,
    'Telekinetic Grab pulls the player next to the demon');

  h.prayers.length = 0;
  h.projectiles.length = 0;
  h.setLocation(2720, 4900, 2);
  method = castAtDistance();
  assert.equal(method.type(), core.CombatType.MELEE, 'in reach and unprotected he melees');
  assert.equal(h.projectiles.length, 0);

  h.prayers[core.PrayerHandler.PROTECT_FROM_MELEE] = true;
  method = castAtDistance();
  assert.equal(method.type(), core.CombatType.MAGIC, 'Protect from Melee makes him cast in reach');
  assert.ok(h.projectiles.length > 0);
});

// ============================================================================
// Native section: real Player/PlayerSession/PacketSender, NPC, PrivateArea,
// TaskManager and CombatFactory against the loaded cache. No server/listener.
// ============================================================================

let nativePlayerSerial = 910000;
function nativeShadow() {
  if (nativeShadowContext) return nativeShadowContext;
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const api = PluginManager.createApi('ShadowNativeParity');
  require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);
  nativeShadowContext = { api, quest };
  return nativeShadowContext;
}

function nativeShadowPlayer(t) {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2720, 4900);
  const frames = [];
  const channel = { kind: 'test', binaryTransport: true, isOpen: () => true,
    send: (frame) => { frames.push(Buffer.from(frame)); return true; },
    close() {}, onData() {}, onClose() {}, onError() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername(`shadownative${nativePlayerSerial++}`);
  player.setLocation(new core.Location(2720, 4903, 2));
  player.setNeedsPlacement(false);
  player.setRunning(false);
  for (const skill of [core.Skill.HITPOINTS, core.Skill.ATTACK, core.Skill.STRENGTH,
    core.Skill.DEFENCE, core.Skill.MAGIC, core.Skill.RANGED, core.Skill.PRAYER]) {
    player.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevel(skill, 99, false);
  }
  t.mock.method(player, 'onAdd', () => {});
  t.mock.method(player, 'onRemove', () => {});
  assert.equal(core.World.getPlayers().add(player), true);
  core.World.refreshActiveRegions();
  const tick = () => { core.World.process(); session.flushPackets(); };
  t.after(() => {
    try { PluginManager.emitPlayerLogout({ player, username: player.getUsername() }); } catch {}
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
    for (const npc of core.World.getNpcs()) if (npc.getOwner?.() === player && npc.isRegistered?.()) nativeShadowContext.api.removeNpc(npc);
    core.World.getPlayers().remove(player);
    core.World.refreshActiveRegions();
  });
  return { core, player, session, frames, tick };
}

function chant(core, player, itemId) {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  return PluginManager.emitItemAction({
    player, itemId, item: new core.Item(itemId, 1), slot: 0, clickType: 2,
    option: 'Chant', handled: false,
  });
}

function ownedActors(core, player) {
  return [...core.World.getNpcs()].filter((npc) => npc.getOwner?.() === player);
}

test('Shadow: every selected animation shares the actor rig in the active cache', async () => {
  const { findNpcRigAnimations } = require('../dist/game/cache/NpcAnimationScanner');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const checks = [
    [897, [2879, 2880, 2888]], [899, [2879, 2880]], [907, [2879, 2880, 425, 836]],
    [903, [2879, 2880]], [905, [2879, 2880]], [909, [2879, 2880]], [902, [2879, 2880]],
    [893, [2879, 2880]], [895, [2879, 2880]], [1989, [5532]], [917, [2884, 2885]],
    [911, [4623, 69, 4679, 4676, 4677]],
  ];
  for (const [npcId, sequences] of checks) {
    const definition = CacheDefinitions.getNpc(npcId);
    const base = definition?.idleSeqId >= 0 ? definition.idleSeqId : definition?.walkSeqId;
    assert.ok(base >= 0, `${npcId} has a cache rig sequence`);
    for (const sequence of sequences) {
      const matches = await findNpcRigAnimations([base], sequence, sequence);
      assert.ok(matches.includes(sequence), `${npcId} base ${base} rig supports seq ${sequence}`);
    }
  }
});

test('Shadow: the source plane-2 room supplies the temple mesh and the dynamic dressing is explicit', () => {
  const { readTemplateRegion } = require('../dist/game/collision/TemplateRegionData');
  const region = readTemplateRegion(10828); // source zones 338-341 x 609-614, plane 2
  assert.ok(region, 'region 10828 is present in the cache');
  const plane2 = new Set();
  for (const locs of region.chunks) for (const loc of locs) if (loc.plane === 2) plane2.add(loc.id);
  for (const id of [6287, 6288, 6289, 6291, 6282, 6296, 6300]) {
    assert.equal(plane2.has(id), true, `static plane-2 temple loc ${id}`);
  }
  for (const id of [724, 714, 2379, 10251, 10253, 3550]) {
    assert.equal(plane2.has(id), false, `loc ${id} is a dynamic scene change, not source mesh`);
  }
  // The instance walls (3550 inviswall_serverside) seal the copied instance; the
  // source-coordinate QuestScene uses the real cave-wall mesh above plus its
  // PrivateArea bounds instead, so adding them would be duplicate clipping.
  // The three REBUILD_REGION palettes (decoded separately from capture 3333) all
  // copy these same plane-2 zones; see docs/the-golem-shadow-of-the-storm-parity.md.
  const plane2Locs = region.chunks.flat().filter((loc) => loc.plane === 2);
  assert.ok(plane2Locs.length > 200, 'the source plane-2 temple mesh is populated');
});

test('Shadow native: relog during the fight restores demon and cast in one private area', (t) => {
  const { core, player, tick } = nativeShadowPlayer(t);
  const { quest } = nativeShadow();
  const { PluginManager } = require('../dist/plugins/PluginManager');
  quest.setStage(player, 110);
  player.setAttribute('quest.shadow_of_the_storm.incantation', 4371);
  player.setAttribute('shadow-of-the-storm:summon-assembled', true);
  player.getInventory().adds(core.ItemIdentifiers.DEMONIC_SIGIL, 1);
  player.getInventory().adds(core.ItemIdentifiers.SILVERLIGHT_2, 1);
  assert.equal(chant(core, player, core.ItemIdentifiers.DEMONIC_SIGIL), true);
  for (const word of ['Camerinthum', 'Agrith-Naar', 'Tarren', 'Caldar', 'Nahudu']) {
    PluginManager.emitCustomEvent('npc-dialogue:choice', { player, npcId: core.NpcIdentifiers.MATTHEW, option: word });
  }
  player.getDialogueManager().reset();
  for (let i = 0; i < 4; i++) tick();
  assert.equal(quest.getStage(player), 120);
  const firstDemon = ownedActors(core, player).find((npc) => npc.getId() === core.NpcIdentifiers.AGRITH_NAAR);
  assert.ok(firstDemon);

  PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
  for (let i = 0; i < 3; i++) tick();
  assert.equal(ownedActors(core, player).length, 0, 'logout removes the scene actors');

  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  for (let i = 0; i < 8; i++) tick();
  assert.equal(quest.getStage(player), 120, 'stage survives relog');
  const restored = ownedActors(core, player);
  assert.ok(player.getPrivateArea(), `relog opened a scene (actors=${restored.length})`);
  const demon = restored.find((npc) => npc.getId() === core.NpcIdentifiers.AGRITH_NAAR);
  assert.ok(demon, 'relog respawns the demon');
  assert.ok(player.getPrivateArea(), 'relog reopens the fight scene');
  for (const npc of restored) assert.equal(npc.getPrivateArea(), player.getPrivateArea(),
    `${npc.getId()} shares the recovered scene`);
  assert.equal(demon.getLocation().getX(), 2719);
  assert.equal(demon.getLocation().getY(), 4899);
});
