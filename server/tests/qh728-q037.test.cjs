// Source-contract checks for Fairytale II - Cure a Queen (Quest Helper q037).
// Run from server/: node --test tests/qh728-q037.test.cjs (after yarn build).
//
// Quest Helper source: pinned /tmp/tsps-600-parallel/quest-helper
// src/main/java/com/questhelper/helpers/quests/fairytaleii/FairytaleII.java
// at 06da90f982518a093f2fe1c9cfac5547fa7053d3.
//
// The route test starts at durable stage 0 and dispatches the plugin's
// registered handlers. It fixture-sets only ordinary supplies/loot (vial of
// water, pestle, a gorak claw after the registered kill, skills) and clears
// engine preconditions such as the fairy-ring travel owned by another plugin.
// It is not a live playthrough and does not prove the visual Quest Helper
// overlay or shared fairy-ring access during the quest.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

before(async () => {
  const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
  const { NpcDefinitionLoader } = require(root + '/dist/game/definition/loader/impl/NpcDefinitionLoader');
  const { RegionManager } = require(root + '/dist/game/collision/RegionManager');
  await CachePipeline.initialize(root);
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function canonicalNode(variant, id) {
  const record = JSON.parse(require('node:fs').readFileSync(
    path.join(root, 'data/definitions/npc-dialogues.json'), 'utf8'))['Fairytale II - Cure a Queen'];
  let found = null;
  const walk = (node) => {
    if (found || node == null) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    if (node.id === id) { found = node; return; }
    Object.values(node).forEach(walk);
  };
  walk(record.variants[variant]);
  assert.ok(found, `missing canonical node ${id} in ${variant}`);
  return found;
}


const transcripts = [];
const realStartTranscript = runtime.startTranscript;
runtime.startTranscript = (api, player, npcId, page, variant, select) => {
  transcripts.push({ player, npcId, page, variant, select });
  return true;
};

function setup() {
  transcripts.length = 0;
  const realCore = PluginManager.getCoreApi();
  const hooks = {
    variants: [], conditions: [], custom: new Map(), login: [], logout: [], death: [],
    npcInteractions: [], npcActions: new Map(), objectActions: new Map(), itemActions: [],
    itemOnItem: [], itemOnObject: [], itemOnNpc: [], npcDeaths: [], zones: [],
  };
  const spawned = [], removed = [], messages = [], xp = [], varbits = new Map(), drops = [];
  const core = {
    ...realCore,
    Misc: { ...realCore.Misc, randomInclusive: () => 1 },
    Item: realCore.Item,
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(handler, actions) {
      if (typeof handler === 'function') hooks.npcInteractions.push(handler);
      else if (typeof handler === 'string' && actions) hooks.npcActions.set(handler, actions);
    },
    onObjectInteraction(handler, actions) {
      if (typeof handler === 'function') hooks.npcInteractions.push(handler);
      else if (typeof handler === 'string' && actions) hooks.objectActions.set(handler, actions);
    },
    onItemAction(handler, actions) {
      hooks.itemActions.push(typeof handler === 'function' ? { handler } : { name: handler, actions });
    },
    onItemOnItem(fn) { hooks.itemOnItem.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onNpcDeath(fn) { hooks.npcDeaths.push(fn); },
    onZoneEnter(zone, fn) { hooks.zones.push({ zone, fn }); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    onPlayerDeath(fn) { hooks.death.push(fn); },
    onCustomEvent(name, fn) {
      const list = hooks.custom.get(name) ?? [];
      list.push(fn);
      hooks.custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      // The fixture account has finished Fairytale I; Fairytale II itself is answered by QuestRuntime.
      if (name === 'quest:is-complete' && event?.key === 'fairytale_i_growing_pains' && event.complete == null) {
        event.complete = true;
      }
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    getItemOnGroundManager() {
      return { registerLocation: (player, item, location) => drops.push({ player, id: item.getId?.(), amount: item.getAmount?.(), location }) };
    },
    spawnNpc(definition) {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getContentId: () => definition.id,
        getLocation: () => new realCore.Location(definition.x, definition.y, definition.z),
        isRegistered: () => true,
        remove() {},
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { if (npc) removed.push(npc); },
  }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
  });

  require('../plugins/quests/quests/FairytaleIICureAQueen.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'fairytale_ii_cure_a_queen');

  const attrs = new Map(), inventory = new Map(), slots = new Map(), equipment = new Map();
  let location = new realCore.Location(3078, 3256, 0), full = false;
  let farming = 50, herblore = 60, thieving = 60;
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    sendConfig() { return sender; },
    sendJingle() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const inventoryApi = {
    getAmount: (id) => inventory.get(id) ?? 0,
    contains: (id) => (inventory.get(id) ?? 0) > 0,
    isFull: () => full,
    getFreeSlots: () => full ? 0 : 28,
    get: (slot) => slots.get(slot),
    adds(id, amount) {
      inventory.set(id, (inventory.get(id) ?? 0) + amount);
      if (amount > 0 && !slots.has(id)) slots.set(id, { getId: () => id, getName: () => '' });
    },
    deleteNumber(id, amount) {
      assert.ok((inventory.get(id) ?? 0) >= amount, `missing item ${id}`);
      inventory.set(id, (inventory.get(id) ?? 0) - amount);
    },
    deleteAtSlot(slot) { slots.delete(slot); },
    getItems: () => [...inventory].filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getInventory: () => inventoryApi,
    getEquipment: () => ({ get: (slot) => equipment.get(slot), getItems: () => [] }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => skill === realCore.Skill.FARMING ? farming
        : skill === realCore.Skill.HERBLORE ? herblore
        : skill === realCore.Skill.THIEVING ? thieving : 99,
      getCurrentLevel: (skill) => skill === realCore.Skill.FARMING ? farming
        : skill === realCore.Skill.HERBLORE ? herblore
        : skill === realCore.Skill.THIEVING ? thieving : 99,
      getExperience: () => 0,
      addExperience: (skill, amount) => xp.push([skill.getIndex(), amount]),
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
    }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues() {}, getCurrent: () => null, reset() {}, isActive: () => false, advance() {} }),
    getLocation: () => location,
    moveTo: (value) => { location = value; },
    sendMessage: (text) => messages.push(text),
    getUsername: () => 'qh728-q037',
    getIndex: () => 1,
    getPrivateArea: () => null,
    isRegistered: () => true,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getUpdateFlag: () => ({ flag() {} }),
    performAnimation() {},
    setPositionToFace() {},
  };
  const fire = (name, event = {}) => api.emitCustomEvent(name, { player, ...event });
  const variant = (npcId) => hooks.variants.map((fn) => fn({ player, npcId })).find(Boolean) ?? null;
  const condition = (stepId, npcId) => hooks.conditions
    .map((fn) => fn({ player, npcId, stepId }))
    .find((value) => value !== null && value !== undefined);
  const choice = (npcId, option, stepId) => fire('npc-dialogue:choice', { npcId, option, stepId });
  const action = (stepId, npcId, kind = 'action') => {
    const event = { npcId, stepId, kind, handled: false, end: false };
    fire('npc-dialogue:action', event);
    return event;
  };
  const conditionEvent = (stepId, npcId) => fire('npc-dialogue:condition', { npcId, stepId });
  const hook = (npcId, id) => fire('npc-dialogue:hook', { npcId, hook: id });
  const npcEvent = (npcId, actionName, npc) => {
    const event = { player, npcId, npc, clickType: 1, definition: { getActions: () => [actionName], getInteractions: () => [actionName] } };
    for (const fn of hooks.npcInteractions) fn(event);
    const named = hooks.npcActions.get(npc ? npc.getName?.() : undefined);
    if (named?.[actionName]) named[actionName](event);
    return event;
  };
  const npcAction = (npcName, actionName, npcId) => {
    const event = { player, npcId, clickType: 1, definition: { getActions: () => ['', actionName], getInteractions: () => ['', actionName] } };
    const named = hooks.npcActions.get(npcName);
    if (!named?.[actionName]) throw new Error(`no registered ${npcName} ${actionName}`);
    if (named[actionName](event) !== false) event.handled = true;
    return event;
  };
  const objectAction = (objectName, actionName, x, y, z = 0, clickType = 1) => {
    const event = {
      player, objectId: -1, location: new realCore.Location(x, y, z), clickType,
      definition: { getActions: () => [actionName], getInteractions: () => [actionName] },
      handled: false,
    };
    const named = hooks.objectActions.get(objectName);
    if (!named?.[actionName]) throw new Error(`no registered ${objectName} ${actionName}`);
    if (named[actionName](event) !== false) event.handled = true;
    return event;
  };
  const itemAction = (itemId, option, slot = 0, itemName = '') => {
    const item = { getId: () => itemId, getName: () => itemName };
    const event = { player, itemId, option, slot, item, clickType: 1, handled: false };
    for (const entry of hooks.itemActions) {
      if (entry.handler) entry.handler(event);
      else if (entry.name === itemName && entry.actions?.[option]) entry.actions[option](event);
    }
    return event;
  };
  const itemOnItem = (a, b) => {
    for (const fn of hooks.itemOnItem) fn({ player, usedItemId: a, usedWithItemId: b, handled: false });
  };
  const itemOnObject = (itemId, objectId, at = location) => {
    for (const fn of hooks.itemOnObject) fn({ player, itemId, objectId, location: at, handled: false });
  };
  const npcDeath = (npcId, at = location) => {
    const npc = { getId: () => npcId, getLocation: () => at };
    for (const fn of hooks.npcDeaths) fn({ killer: player, npc, npcId, location: at });
  };
  const zoneEnter = () => {
    for (const { zone, fn } of hooks.zones) {
      const inside = location.getX() >= zone.minX && location.getX() <= zone.maxX
        && location.getY() >= zone.minY && location.getY() <= zone.maxY
        && zone.levels.includes(location.getZ());
      if (inside) fn({ player });
    }
  };
  const login = () => { for (const fn of hooks.login) fn({ player }); };
  return {
    core: realCore, player, quest, attrs, inventory, slots, equipment, messages, xp, varbits,
    api, spawned, removed, drops, hooks, variant, condition, choice, action, conditionEvent, hook,
    npcEvent, npcAction, objectAction, itemAction, itemOnItem, itemOnObject, npcDeath, zoneEnter, login,
    fire,
    setLocation(x, y, z = 0) { location = new realCore.Location(x, y, z); },
    setFull(value) { full = value; },
    setSkills({ farming: f, herblore: h, thieving: t }) {
      if (f !== undefined) farming = f;
      if (h !== undefined) herblore = h;
      if (t !== undefined) thieving = t;
    },
  };
}

test('fresh stage 0 follows the mandatory route and completes on the native varbit', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  const N = h.core.NpcIdentifiers;
  const MARTIN = N.MARTIN_THE_MASTER_GARDENER;
  const NUFF = N.FAIRY_NUFF_2;
  const GODFATHER = N.FAIRY_GODFATHER_2;

  assert.equal(h.quest.getStage(h.player), 0);
  assert.equal(h.variant(MARTIN), 'starting-off-talking-to-martin');

  // Start and the five-minute wait; the agent time advance is the registered hook.
  h.choice(MARTIN, 'Ask about the quest.');
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.quest.isStarted(h.player), false, 'cache start threshold is 10');
  assert.equal(h.variant(MARTIN), 'starting-off-talking-to-martin-before-5-minutes-have-passed');
  h.fire('agent:advance-time', { ms: 6 * 60 * 1000, handledBy: [] });
  assert.equal(h.variant(MARTIN), 'starting-off-talking-to-martin-after-5-minutes-have-passed');
  h.choice(MARTIN, 'Ask about the quest.');
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.quest.isStarted(h.player), true);

  // Refusing the offer keeps the ready-to-accept copy so the start hook is reachable again.
  assert.equal(h.variant(MARTIN), 'starting-off-talking-to-martin-after-5-minutes-have-passed');
  h.hook(MARTIN, 'quest:fairytale-ii-cure-a-queen:start');
  assert.equal(h.quest.getStage(h.player), 20);
  assert.equal(h.varbits.get(2326), 20);

  // Search the right potion shelf: the certificate is added and the condition is one-shot.
  assert.equal(h.objectAction('Potion shelves', 'Search', 2389, 4470).handled, true);
  assert.equal(transcripts.at(-1).variant, 'locating-the-hideout-searching-for-nuff-s-certificate'.replace('-nuff-s-', '-fairy-nuff-s-'));
  assert.equal(h.condition('RnasHV', NUFF), true);
  h.conditionEvent('RnasHV', NUFF);
  assert.equal(h.inventory.get(I.NUFFS_CERTIFICATE), 1);
  assert.equal(h.attrs.get('quest.fairytale-ii-cure-a-queen:certificate-taken'), 1);
  h.conditionEvent('RnasHV', NUFF);
  assert.equal(h.inventory.get(I.NUFFS_CERTIFICATE), 1, 'replayed condition does not duplicate the certificate');

  // Study, read the sign, then get the Godfather's permission.
  assert.equal(h.itemAction(I.NUFFS_CERTIFICATE, 'Study').handled, true);
  assert.equal(h.quest.getStage(h.player), 30);
  assert.equal(h.varbits.get(2336), 1);
  h.objectAction('Rune temple sign', 'Read', 2409, 4369);
  assert.equal(h.varbits.get(2338), 4);
  assert.equal(h.variant(GODFATHER), 'starting-off-talking-to-the-fairy-godfather');
  h.choice(GODFATHER, 'Yes, okay.');
  assert.equal(h.quest.getStage(h.player), 40);
  assert.equal(h.varbits.get(2328), 1);
  assert.equal(h.varbits.get(2329), 2);

  // Enter the hideout, talk Nuff; the imported YO3q33 message (not the old unavailable id) advances.
  h.setLocation(2355, 4455, 0);
  h.zoneEnter();
  assert.equal(h.quest.getStage(h.player), 45);
  const intro = h.npcEvent(NUFF, 'Talk-to');
  assert.equal(intro.handled, true);
  assert.equal(transcripts.at(-1).variant, 'in-the-hideout-talking-to-fairy-nuff');
  const approaching = h.action('YO3q33', NUFF, 'message');
  assert.equal(approaching.handled, false, 'the real message is left for the dialogue runtime to display');
  assert.equal(h.quest.getStage(h.player), 50);
  assert.equal(h.varbits.get(1808), 2);

  // Full inventory pickpocket uses the real imported message branch, not a plugin copy.
  h.setFull(true);
  h.npcAction('Fairy Godfather', 'Pick-pocket', GODFATHER);
  assert.equal(transcripts.at(-1).variant, 'in-the-hideout-pickpocketing-the-secateurs');
  h.conditionEvent('5dBfKL', GODFATHER);
  assert.equal(h.messages.includes("You don't have enough inventory space."), false);
  assert.equal(h.inventory.get(I.QUEENS_SECATEURS_2) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 50);

  // Retry successfully; the registered condition hands over the secateurs.
  h.setFull(false);
  h.npcAction('Fairy Godfather', 'Pick-pocket', GODFATHER);
  h.conditionEvent('bx036-', GODFATHER);
  assert.equal(h.inventory.get(I.QUEENS_SECATEURS_2), 1);
  assert.equal(h.quest.getStage(h.player), 60);

  // Lost secateurs are recoverable while the hand-in is still pending.
  h.inventory.delete(I.QUEENS_SECATEURS_2);
  h.npcEvent(NUFF, 'Talk-to');
  assert.equal(transcripts.at(-1).variant, 'curing-the-queen-returning-to-fairy-nuff-after-losing-the-secateurs');
  h.npcAction('Fairy Godfather', 'Pick-pocket', GODFATHER);
  h.conditionEvent('bx036-', GODFATHER);
  assert.equal(h.inventory.get(I.QUEENS_SECATEURS_2), 1);

  // Hand them to Nuff; the message consumes the item and opens the potion stage.
  h.npcEvent(NUFF, 'Talk-to');
  assert.equal(transcripts.at(-1).variant, 'curing-the-queen-bringing-fairy-nuff-the-secateurs');
  h.action('j-qUAH', NUFF, 'message');
  assert.equal(h.inventory.get(I.QUEENS_SECATEURS_2) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 65);

  // Star plane, flower, gorak plane, claw and brewing all through registered handlers.
  h.setLocation(2070, 4841, 0);
  h.zoneEnter();
  assert.equal(h.varbits.get(2330), 1);
  const flower = h.spawned.find((npc) => npc.getId() === N.STARFLOWER_2 && npc.isRegistered());
  assert.ok(flower);
  assert.equal(h.npcEvent(N.STARFLOWER_2, 'Pick', flower).handled, true);
  assert.equal(h.inventory.get(I.STAR_FLOWER), 1);
  h.setLocation(3040, 5340, 0);
  h.zoneEnter();
  assert.equal(h.varbits.get(2331), 1);
  h.npcDeath(N.GORAK);
  assert.equal(h.varbits.get(2382), 1);
  assert.equal(h.drops.at(-1).id, I.GORAK_CLAWS);
  h.inventory.set(I.GORAK_CLAWS, 1);
  h.inventory.set(I.VIAL_OF_WATER, 1);
  h.inventory.set(I.PESTLE_AND_MORTAR, 1);
  h.itemOnItem(I.STAR_FLOWER, I.VIAL_OF_WATER);
  assert.equal(h.inventory.get(I.MAGIC_ESSENCE_UNF_), 1);
  assert.equal(h.quest.getStage(h.player), 72);
  h.itemOnItem(I.PESTLE_AND_MORTAR, I.GORAK_CLAWS);
  assert.equal(h.inventory.get(I.GORAK_CLAW_POWDER), 1);
  h.itemOnItem(I.GORAK_CLAW_POWDER, I.MAGIC_ESSENCE_UNF_);
  assert.equal(h.inventory.get(I.MAGIC_ESSENCE_4_), 1);
  assert.equal(h.quest.getStage(h.player), 73);

  // Use the potion on the sleeping queen multi loc, then the imported reward/complete nodes.
  h.setLocation(2354, 4455, 0);
  h.itemOnObject(I.MAGIC_ESSENCE_4_, 16316);
  assert.equal(h.inventory.get(I.MAGIC_ESSENCE_4_) ?? 0, 0);
  assert.equal(h.inventory.get(I.MAGIC_ESSENCE_3_), 1);
  assert.equal(h.quest.getStage(h.player), 75);
  assert.equal(h.varbits.get(2326), 75);
  assert.ok(h.spawned.some((npc) => npc.getId() === N.FAIRY_QUEEN_2));
  h.action('SuXalx', N.FAIRY_QUEEN_2, 'message');
  assert.equal(h.inventory.get(I.ANTIQUE_LAMP), 1);
  h.action('Vca-Ck', N.FAIRY_QUEEN_2);
  assert.equal(h.quest.getStage(h.player), 90);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.varbits.get(2326), 90, 'cache DB row 47 requires varbit 2326 >= 90');
  assert.deepEqual(h.xp, [
    [h.core.Skill.HERBLORE.getIndex(), 3500],
    [h.core.Skill.THIEVING.getIndex(), 2500],
  ]);
  h.action('Vca-Ck', N.FAIRY_QUEEN_2);
  assert.equal(h.xp.length, 2, 'repeat completion does not award again');
  assert.equal(h.inventory.get(I.ANTIQUE_LAMP), 1);

  // Login replay keeps the completion wire and does not duplicate the reward.
  h.varbits.set(2326, 0);
  h.login();
  assert.equal(h.varbits.get(2326), 90);
  assert.equal(h.xp.length, 2);
});

test('legacy durable 80 saves migrate to the native completion value', () => {
  const h = setup();
  const stageKey = 'quest.fairytale_ii_cure_a_queen.stage';
  h.player.setAttribute(stageKey, 80);
  h.login();
  assert.equal(h.quest.getStage(h.player), 90);
  assert.equal(h.varbits.get(2326), 90);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.xp.length, 0, 'migration does not re-award');
});

test('full-bag reward branch stays pending until a slot is free', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  const QUEEN = h.core.NpcIdentifiers.FAIRY_QUEEN_2;
  h.quest.setStage(h.player, 75);
  h.setFull(true);
  assert.equal(h.condition('-LSx7-', QUEEN), true);
  assert.equal(h.condition('e2I60y', QUEEN), false);
  h.action('SuXalx', QUEEN, 'message');
  assert.equal(h.inventory.get(I.ANTIQUE_LAMP) ?? 0, 0, 'a stale receipt cannot grant into a full bag');
  h.setFull(false);
  assert.equal(h.condition('-LSx7-', QUEEN), false);
  assert.equal(h.condition('e2I60y', QUEEN), true);
  h.action('SuXalx', QUEEN, 'message');
  assert.equal(h.inventory.get(I.ANTIQUE_LAMP), 1);
  h.action('Vca-Ck', QUEEN);
  assert.equal(h.quest.getStage(h.player), 90);
  assert.equal(h.quest.isComplete(h.player), true);
});

test('lost certificate is recoverable from the right shelf without a second copy', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  const NUFF = h.core.NpcIdentifiers.FAIRY_NUFF_2;
  h.quest.setStage(h.player, 30);
  h.inventory.delete(I.NUFFS_CERTIFICATE);
  h.objectAction('Potion shelves', 'Search', 2389, 4470);
  assert.equal(h.condition('RnasHV', NUFF), true);
  h.conditionEvent('RnasHV', NUFF);
  assert.equal(h.inventory.get(I.NUFFS_CERTIFICATE), 1);
  h.conditionEvent('RnasHV', NUFF);
  assert.equal(h.inventory.get(I.NUFFS_CERTIFICATE), 1);
});


test('canonical runner: Nuff intro message and pickpocket guard branches', () => {
  const { DialogueManager } = require(root + '/dist/game/model/dialogues/DialogueManager');
  const PAGE = 'Fairytale II - Cure a Queen';
  const N = setup().core.NpcIdentifiers;
  // The NpcDialogues runner resolves prose conditions through PluginManager,
  // while this file registers the plugin on a local API. Add the same handler
  // for the duration of the runner assertion, then restore the shared hooks.
  const conditionHooks = PluginManager.npcDialogueConditionHooks;
  const conditionCount = conditionHooks.length;
  let activeCondition = null;
  conditionHooks.push({ pluginName: 'qh728-q037-runner', handler: (event) => activeCondition?.(event) ?? null });
  const rememberConditions = (h) => { activeCondition = h.hooks.conditions[0]; };
  try {

  // Positive: YO3q33 is a real message, displays, and advances 40 -> 50.
  const positive = setup();
  rememberConditions(positive);
  const positiveManager = new DialogueManager(positive.player);
  positive.player.getDialogueManager = () => positiveManager;
  positive.quest.setStage(positive.player, 40);
  const introNode = canonicalNode('in-the-hideout-talking-to-fairy-nuff', 'YO3q33');
  assert.equal(realStartTranscript(positive.api, positive.player, N.FAIRY_NUFF_2, PAGE,
    'in-the-hideout-talking-to-fairy-nuff', () => [introNode]), true);
  assert.equal(positive.quest.getStage(positive.player), 50);
  assert.ok(positive.messages.some((line) => line.includes('You see a fairy approaching')),
    'the imported message is displayed rather than suppressed');

  // Neighbouring negative: the same message cannot advance before permission.
  const early = setup();
  rememberConditions(early);
  const earlyManager = new DialogueManager(early.player);
  early.player.getDialogueManager = () => earlyManager;
  early.quest.setStage(early.player, 20);
  realStartTranscript(early.api, early.player, N.FAIRY_NUFF_2, PAGE,
    'in-the-hideout-talking-to-fairy-nuff', () => [introNode]);
  assert.equal(early.quest.getStage(early.player), 20);
  assert.ok(early.messages.some((line) => line.includes('You see a fairy approaching')));

  // Full bag: the runner chooses 5dBfKL, plays i3cuXT, and grants nothing.
  const full = setup();
  rememberConditions(full);
  const fullManager = new DialogueManager(full.player);
  full.player.getDialogueManager = () => fullManager;
  full.quest.setStage(full.player, 50);
  full.setFull(true);
  full.npcAction('Fairy Godfather', 'Pick-pocket', N.FAIRY_GODFATHER_2);
  assert.equal(transcripts.at(-1).variant, 'in-the-hideout-pickpocketing-the-secateurs');
  const branches = [
    canonicalNode('in-the-hideout-pickpocketing-the-secateurs', '5dBfKL'),
    canonicalNode('in-the-hideout-pickpocketing-the-secateurs', 'bx036-'),
  ];
  realStartTranscript(full.api, full.player, N.FAIRY_GODFATHER_2, PAGE,
    'in-the-hideout-pickpocketing-the-secateurs', () => branches);
  assert.ok(full.messages.some((line) => line.includes("don't have space to carry the secateurs")));
  assert.equal(full.inventory.get(full.core.ItemIdentifiers.QUEENS_SECATEURS_2) ?? 0, 0);
  assert.equal(full.quest.getStage(full.player), 50);

  // Neighbouring success branch: the runner chooses bx036- and the guard hands over.
  const success = setup();
  rememberConditions(success);
  const successManager = new DialogueManager(success.player);
  success.player.getDialogueManager = () => successManager;
  success.quest.setStage(success.player, 50);
  success.npcAction('Fairy Godfather', 'Pick-pocket', N.FAIRY_GODFATHER_2);
  realStartTranscript(success.api, success.player, N.FAIRY_GODFATHER_2, PAGE,
    'in-the-hideout-pickpocketing-the-secateurs', () => branches);
  assert.equal(success.inventory.get(success.core.ItemIdentifiers.QUEENS_SECATEURS_2), 1);
  assert.equal(success.quest.getStage(success.player), 60);
  assert.equal(success.messages.some((line) => line.includes("don't have space")), false);
  } finally {
    conditionHooks.length = conditionCount;
  }
});
