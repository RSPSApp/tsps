// The Crab Quest plugin under a recording stand-in for the plugin API, a player and the
// packet sender (shared by the Crab Quest test files). Needs the cache initialised first.
const path = require('node:path');
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

const SIT_SLOT = 54;
const SIT_LOOP = 10061; // emote_sit_loop, interface 216 child 54 (cache enum 1001 -> 5248)

function setup() {
  const hooks = { custom: new Map(), objects: [], login: [], logout: [], npcs: [], ground: [], conditions: [] };
  const attrs = new Map();
  const inventory = new Map();
  const messages = [];
  const persistentKeys = new Map();
  const placed = [];
  const spawned = [];
  const removed = [];
  const tasks = [];
  const xp = [];
  const varbits = [];
  const cameras = [];
  const mounts = [];
  const varValues = new Map();
  const groundItems = [];
  let area = null;
  let currentDialogue = null;
  let location = { x: 3041, y: 2638, z: 0 };
  const blocked = new Set(); // "x,y" tiles the player cannot step onto
  const sounds = [];
  const graphics = [];
  const projectiles = [];
  const core = {
    ...PluginManager.getCoreApi(),
    ObjectManager: {
      register(object) { placed.push({ id: object.getId(), x: object.getLocation().getX(), y: object.getLocation().getY() }); },
      deregister() {},
    },
    TaskManager: {
      submit(task) { task.setRunning?.(true); tasks.push(task); },
      cancelTasks(key) { for (const task of tasks) if (task.key === key) task.stop?.(); },
    },
  };
  const api = new Proxy({
    core,
    persistAttribute(key, defaultValue) { persistentKeys.set(key, defaultValue); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { event.player ??= player; for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(fn) { hooks.npcs.push(fn); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemOnItem() {},
    onGroundItemPickup(fn) { hooks.ground.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    onNpcDialogueVariant() {},
    spawnNpc(definition) {
      const npc = {
        definition,
        registered: true,
        getIndex: () => 100 + spawned.length,
        getId: () => definition.id,
        getRealId: () => definition.id,
        getLocation: () => new core.Location(definition.x ?? 0, definition.y ?? 0, definition.z ?? 0),
        getArea: () => npc.__area,
        setArea: (value) => { npc.__area = value; },
        getPrivateArea: () => npc.__area,
        isRegistered: () => npc.registered,
        isOwnerOnly: () => definition.ownerOnly,
        getOwner: () => definition.owner,
        setPositionToFace() {},
        performAnimation() {},
        moveTo() {},
        forceChat() {},
        performGraphic() {},
        setMovementSteps() {},
        getMovementQueue: () => ({ reset() { return this; }, addFirstStep() { return true; } }),
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { npc.registered = false; removed.push(npc); },
    getItemOnGroundManager() { return { getGroundItem: () => undefined, registerLocation(_player, item, position) { groundItems.push({ id: item.getId(), x: position.getX(), y: position.getY() }); } }; },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.push({ id, value }); varValues.set(id, value); return sender; },
    sendCameraMoveTo(x, y, height) { cameras.push(['move', x, y, height]); return sender; },
    sendCameraLookAt(x, y, height) { cameras.push(['look', x, y, height]); return sender; },
    sendCameraSkybox(model) { cameras.push(['skybox', model]); return sender; },
    sendCameraReset() { cameras.push(['reset']); return sender; },
    mountSubInterface(uid, id, type, options) { const mount = { uid, id, args: options?.postScripts?.[0]?.args, closed: false }; mounts.push(mount); return mount; },
    closeSubInterfaceMount(mount) { if (mount) mount.closed = true; return sender; },
    sendConfig(id, value) { varValues.set(id, value); return sender; },
    getVarbit(id) { return varValues.get(id) ?? 0; },
    getVarp(id) { return varValues.get(id) ?? 0; },
    sendInterface() { return sender; },
    sendInterfaceScript() { return sender; },
    sendInterfaceRemoval() { return sender; },
    sendSound(id, volume, delay) { sounds.push([id, delay]); return sender; },
    sendGraphic(graphic, at) { graphics.push([graphic.id, graphic.delay, at.getX(), at.getY()]); return sender; },
    sendProjectile(from, to, offset, speed, id) { projectiles.push([id, from.getX(), from.getY(), to.getX(), to.getY(), speed]); return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    sendMessage(message) { messages.push(message); },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      getFreeSlots: () => 28,
      isFull: () => false,
    }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences(skill, amount) { xp.push([skill, amount]); } }),
    getLocation: () => location.getX ? location : new core.Location(location.x, location.y, location.z),
    moveTo(value) { location = value; },
    getDialogueManager: () => ({
      isActive: () => currentDialogue !== null,
      startDialogues(chain) { currentDialogue = chain; },
      getCurrent: () => currentDialogue,
      reset() { currentDialogue = null; },
    }),
    getArea: () => area,
    setArea: (value) => { area = value; },
    getPrivateArea: () => area instanceof core.PrivateArea ? area : null,
    getMovementQueue: () => ({
      reset() { return this; },
      setBlockMovement() { return this; },
      addFirstStep() { return true; },
      canWalk(dx, dy) { const at = player.getLocation(); return !blocked.has(`${at.getX() + dx},${at.getY() + dy}`); },
      walkStep(dx, dy) { const at = player.getLocation(); location = { x: at.getX() + dx, y: at.getY() + dy, z: at.getZ() }; },
    }),
    setUntargetable() {},
    performGraphic(graphic) { player.graphics = [...(player.graphics ?? []), graphic.getId?.() ?? graphic.id]; },
    performAnimation(animation) { player.animations = [...(player.animations ?? []), animation.getId?.() ?? animation.id]; },
    setPositionToFace() {},
    forceChat() {},
    isRegistered: () => player.online !== false,
    getEquipment: () => ({ getItems: () => [] }),
    getUsername: () => 'crab-coax-test',
    getIndex: () => 1,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return player; },
    isPlayerBot: () => false,
  };
  const loadQuest = () => {
    const file = path.join(__dirname, '..', 'plugins', 'quests', 'quests', 'CrabQuest.Quest.js');
    delete require.cache[require.resolve(file)];
    require(file)(api);
    return runtime.getRegisteredQuests().filter((quest) => quest.key === 'crab_quest').at(-1);
  };
  const emit = (name, event) => api.emitCustomEvent(name, event);
  const investigate = (objectId, x, y) => {
    const definition = core.ObjectDefinition.forId(objectId);
    const location = { x, y, z: 0 };
    for (const fn of hooks.objects) fn({ player, objectId, clickType: 1, location, definition });
  };
  const pickup = (groundItemId, x, y) => {
    for (const fn of hooks.ground) fn({ player, groundItemId, location: { x, y, z: 0 } });
  };
  const tick = (count = 1) => { while (count-- > 0) for (const task of [...tasks]) task.tick?.(); };
  const sit = (x, y, slot = SIT_SLOT) => {
    player.moveTo({ x, y, z: 0 });
    emit('player:emote', { slot, sequence: SIT_LOOP });
  };
  return { blocked, sounds, graphics, projectiles, cameras, mounts, core, hooks, attrs, inventory, messages, persistentKeys, placed, spawned, removed, tasks, xp, varbits, varValues, groundItems, player, loadQuest, emit, investigate, pickup, sit, tick, setLocation(x, y) { location = { x, y, z: 0 }; }, get area() { return area; }, get currentDialogue() { return currentDialogue; } };
}

/**
 * Sets the stage and blacks out into the dream (the first sip's black-out step), then returns
 * the quest and `at(x, y)`, which turns a source tile into the dream's instance tile.
 */
function enterDream(h, stage) {
  const quest = h.loadQuest();
  quest.setStage(h.player, stage);
  h.emit('npc-dialogue:action', { npcId: 16471, stepId: 'Cc5OQV', kind: 'message' });
  h.tick(20);
  const crab = h.spawned.find((npc) => npc.definition.id === 16469 || npc.definition.id === 16470);
  const [sourceX, sourceY] = crab.definition.id === 16469 ? [3054, 2637] : [3056, 2637];
  const dx = crab.definition.x - sourceX;
  const dy = crab.definition.y - sourceY;
  return { quest, dx, dy, at: (x, y) => [x + dx, y + dy] };
}

module.exports = { setup, enterDream, SIT_SLOT, SIT_LOOP };
