// Elemental Workshop I (q030) source-contract checks: the login replay and the EW2 workbench handoff.
// The quest's own route is tests/elemental-workshop-i.test.cjs (real player, map and ticks).
// From server/: node --test tests/qh728-q030.test.cjs (after yarn build).
// Fixtures set the starting stage/attributes where a leg would otherwise need the
// whole earlier route; every assertion dispatches a handler the plugins register.
// EW1 and EW2 are loaded in the production order from Quests.plugin.js.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { NPCDeathTask } = require('../dist/game/task/impl/NPCDeathTask');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, O = core.ObjectIdentifiers, N = core.NpcIdentifiers;

const EW2_FLAGS = 'quest.elemental_workshop_ii.flags';
const EW2_JIG = 'quest.elemental_workshop_ii.jig';
const EW2_SCHEMATICS_TAKEN = (1 << 5) | (1 << 6);
const VARP_MACHINE_BITS = 299;
const VARBIT_QUEST_STATUS = 13718;
const BIT_READ_BOOK = 1 << 1;
const BIT_ENTERED_WORKSHOP = 1 << 13;
const BIT_COMPLETE = 1 << 20;
const noop = () => {};
/** EW I makes the shield four ticks after the use. */
const shieldTicks = () => { for (let i = 0; i < 4; i++) core.TaskManager.process(); };
let h;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  h = harness();
});

/** Stands in for Mining's mining:best-pickaxe / mining:pickaxe answers with the plain bronze-to-dragon tools. */
function answerPickaxes(api) {
  const I = core.ItemIdentifiers;
  const ids = [I.BRONZE_PICKAXE, I.IRON_PICKAXE, I.STEEL_PICKAXE, I.BLACK_PICKAXE, I.MITHRIL_PICKAXE, I.ADAMANT_PICKAXE, I.RUNE_PICKAXE, I.DRAGON_PICKAXE];
  const holds = (player, id) => player.getInventory?.().getAmount?.(id) > 0 || player.getInventory?.().contains?.(id)
    || player.getEquipment?.().getItems?.()?.some?.((item) => item?.getId?.() === id);
  api.onCustomEvent('mining:best-pickaxe', (request) => { request.pickaxe ??= ids.find((id) => holds(request.player, id)) != null ? { id: 0 } : null; });
  api.onCustomEvent('mining:pickaxe', (request) => { request.pickaxe ??= ids.includes(request.itemId) ? { id: request.itemId } : null; });
}

function harness() {
  const hooks = {}, events = {}, transcripts = [];
  let lastSpawned = null;
  // EW2 destructures startTranscript when its plugin function runs; record the
  // variant instead of replaying generated dialogue JSON.
  runtime.startTranscript = (api, player, npcId, page, variant) => {
    transcripts.push({ npcId, page, variant });
    return true;
  };
  const api = new Proxy({
    core,
    persistAttribute: noop,
    getItemOnGroundManager: () => ItemOnGroundManager,
    spawnNpc: definition => {
      const npc=new NPC(definition.id,new core.Location(definition.x,definition.y,definition.z??0));
      npc.setOwner(definition.owner);npc.isRegistered=()=>true;lastSpawned=npc;return npc;
    },
    removeNpc: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
  }, {
    get: (target, key) => target[key] ?? ((...args) => {
      const fn = args.find(value => typeof value === 'function');
      if (fn) (hooks[key] ??= []).push(fn);
    }),
  });
  // The quests ask Mining for the player's pickaxe; Mining isn't loaded here, so this stands in for it with the plain
  // tools these routes carry (held or wielded).
  answerPickaxes(api);
  // Production order: ElementalWorkshopI before ElementalWorkshopII.
  require('../plugins/quests/quests/ElementalWorkshopI.Quest')(api);
  require('../plugins/quests/quests/ElementalWorkshopII.Quest')(api);
  require('../plugins/npcs/NpcDrops.plugin').register(api);
  const ew1 = runtime.getRegisteredQuests().findLast(entry => entry.key === 'elemental_workshop_i');
  const ew2 = runtime.getRegisteredQuests().findLast(entry => entry.key === 'elemental_workshop_ii');
  return {
    events, transcripts, ew1, ew2, hooks,
    get lastSpawned() { return lastSpawned; },
    login(player) { (hooks.onPlayerLogin ?? []).forEach(fn => fn({ player })); },
    object(player, objectId, option, tile) {
      const event = { player, objectId, clickType: 1, handled: false,
        location: tile === undefined ? undefined : new core.Location(tile[0], tile[1], tile[2] ?? 0),
        definition: { getInteractions: () => [option] } };
      (hooks.onObjectInteraction ?? []).forEach(fn => fn(event));
      return event;
    },
    itemOnObject(player, itemId, objectId) {
      const event = { player, itemId, objectId, handled: false };
      (hooks.onItemOnObject ?? []).forEach(fn => fn(event));
      return event;
    },
    itemOnItem(player, usedItemId, usedWithItemId) {
      const event = { player, usedItemId, usedWithItemId, handled: false };
      (hooks.onItemOnItem ?? []).forEach(fn => fn(event));
      return event;
    },
    npc(player, npcId, option, tile) {
      const event = { player, npcId, clickType: 1, handled: false,
        location: tile === undefined ? undefined : { x: tile[0], y: tile[1], z: tile[2] ?? 0 },
        definition: { getActions: () => [option] } };
      (hooks.onNpcInteraction ?? []).forEach(fn => fn(event));
      return event;
    },
    npcDeath(player, npc, npcId) {
      const event = { player, npc, npcId, killer: player, handled: false };
      (hooks.onNpcDeath ?? []).forEach(fn => fn(event));
      return event;
    },
    itemAction(player, itemId, option) {
      const event = { player, itemId, option, handled: false };
      (hooks.onItemAction ?? []).forEach(fn => fn(event));
      return event;
    },
    choice(player, option) {
      const event = { player, npcId: N.JIG_CART, option, text: option };
      (events['npc-dialogue:choice'] ?? []).forEach(fn => fn(event));
      return event;
    },
  };
}

function container(size) {
  let items = Array.from({ length: size }, () => new core.Item(-1, 0));
  return {
    getItems: () => items,
    getAmount: id => items.filter(item => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
    full: noop,
    getFreeSlots: () => items.filter(item => item.getId() < 0).length,
    isFull() { return this.getFreeSlots() === 0; },
    adds(id, amount) {
      const index = items.findIndex(item => item.getId() < 0);
      if (index < 0) return this;
      items[index] = new core.Item(id, amount);
      return this;
    },
    deleteNumber(id, amount) {
      const index = items.findIndex(item => item.getId() === id);
      assert.ok(index >= 0, `missing item ${id}`);
      const left = items[index].getAmount() - amount;
      assert.ok(left >= 0, `not enough of item ${id}`);
      items[index] = left > 0 ? new core.Item(id, left) : new core.Item(-1, 0);
    },
    addItem(item) { this.adds(item.getId(),item.getAmount());return this; },
    forceAdd(player, item) {
      const before=this.getAmount(item.getId());
      this.adds(item.getId(), item.getAmount());
      if (this.getAmount(item.getId()) === before) {
        // Full bag: the real inventory drops the overflow on the player's tile.
      }
    },
    clear() { items = Array.from({ length: size }, () => new core.Item(-1, 0)); },
    contains(id) { return this.getAmount(id) > 0; },
    getSlotForItemId(id) { return items.findIndex(item => item.getId() === id); },
    setItem(slot, item) { items[slot] = item; return this; },
    refreshItems() { return this; },
  };
}

function player() {
  const attrs = new Map(), varbits = new Map(), configs = new Map(), xp = [], messages = [];
  let location = new core.Location(2716, 3482, 0);
  const inventory = container(28);
  let manager;
  const packet = new Proxy({
    getVarp: id => configs.get(id) ?? 0, getVarbit: id => varbits.get(id) ?? 0,
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendString() { return packet; },
    sendInterfaceRemoval() { manager.reset(); return packet; },
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const p = {
    attrs, varbits, configs, xp, messages, inventory,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => packet,
    getDialogueManager: () => manager,
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      setCurrentLevel: noop,
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
    }),
    getLocation: () => location,
    getTeleportSerial: () => 0,
    moveTo: to => { location = to; },
    isRegistered: () => true,
    isPlayer: () => true, isNpc: () => false, isPlayerBot: () => false,
    getPrivateArea: () => null, getLastItemPickup: () => ({reset:noop}),
    getAsPlayer: () => p,
    getUsername: () => 'qh728-q030',
    getIndex: () => 1,
    sendMessage: message => messages.push(message),
    performAnimation: noop,
  };
  manager = new DialogueManager(p);
  return p;
}

test('login replay sends durable stage 0/started/complete as varbit 13718 0/1/2', () => {
  const p = player();
  p.varbits.clear();
  p.configs.clear();
  h.login(p);
  assert.equal(p.varbits.get(VARBIT_QUEST_STATUS), 0);
  assert.equal(p.configs.get(VARP_MACHINE_BITS), 0);

  h.ew1.setStage(p, BIT_READ_BOOK);
  p.varbits.clear();
  p.configs.clear();
  h.login(p);
  assert.equal(p.varbits.get(VARBIT_QUEST_STATUS), 1, 'started save stays below the threshold');
  assert.equal(p.configs.get(VARP_MACHINE_BITS), BIT_READ_BOOK);

  h.ew1.setStage(p, BIT_READ_BOOK | BIT_COMPLETE);
  p.varbits.clear();
  p.configs.clear();
  h.login(p);
  assert.equal(p.varbits.get(VARBIT_QUEST_STATUS), 2, 'complete save is at the threshold');
  assert.equal(p.configs.get(VARP_MACHINE_BITS) & BIT_COMPLETE, BIT_COMPLETE);
});

test('EW1 yields the workbench metal handoff to EW2 only for its active claw stage', () => {
  // EW2 stage 6, schematics taken, crane not repaired, no claw: EW2 owns the bar.
  const p = player();
  h.ew1.setStage(p, BIT_READ_BOOK | BIT_COMPLETE);
  h.ew2.setStage(p, 6);
  p.setAttribute(EW2_FLAGS, EW2_SCHEMATICS_TAKEN);
  p.setAttribute(EW2_JIG, 0);
  p.inventory.adds(I.ELEMENTAL_METAL, 1);
  p.inventory.adds(I.HAMMER, 1);
  h.transcripts.length = 0;
  const yielded = h.itemOnObject(p, I.ELEMENTAL_METAL, O.WORKBENCH_5);
  assert.equal(yielded.handled, true, 'EW2 handles the event');
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_SHIELD), 0, 'EW1 did not smith a shield');
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_METAL), 1, 'EW1 did not consume the bar');
  assert.ok(h.transcripts.some(entry =>
    entry.page === 'Elemental Workshop II' && entry.variant === 'into-the-workshop-making-an-elemental-claw'));

  h.choice(p, 'An elemental claw.');
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_METAL), 0);
  assert.equal(p.inventory.getAmount(I.CRANE_CLAW), 1, 'the transcript choice creates the claw');

  // Same active stage but a claw is already held: EW1 keeps its shield smithing.
  const withClaw = player();
  h.ew1.setStage(withClaw, BIT_READ_BOOK | BIT_COMPLETE);
  h.ew2.setStage(withClaw, 6);
  withClaw.setAttribute(EW2_FLAGS, EW2_SCHEMATICS_TAKEN);
  withClaw.setAttribute(EW2_JIG, 0);
  withClaw.inventory.adds(I.ELEMENTAL_METAL, 1);
  withClaw.inventory.adds(I.HAMMER, 1);
  withClaw.inventory.adds(I.SLASHED_BOOK, 1);
  withClaw.inventory.adds(I.CRANE_CLAW, 1);
  h.itemOnObject(withClaw, I.ELEMENTAL_METAL, O.WORKBENCH_5);
  shieldTicks();
  assert.equal(withClaw.inventory.getAmount(I.ELEMENTAL_SHIELD), 1);

  // After the claw is made / crane repaired (fire_state 1), EW1 smiths normally.
  const afterClaw = player();
  h.ew1.setStage(afterClaw, BIT_READ_BOOK | BIT_COMPLETE);
  h.ew2.setStage(afterClaw, 7);
  afterClaw.setAttribute(EW2_FLAGS, EW2_SCHEMATICS_TAKEN);
  afterClaw.setAttribute(EW2_JIG, 1 << 7);
  afterClaw.inventory.adds(I.ELEMENTAL_METAL, 1);
  afterClaw.inventory.adds(I.HAMMER, 1);
  afterClaw.inventory.adds(I.SLASHED_BOOK, 1);
  h.transcripts.length = 0;
  h.itemOnObject(afterClaw, I.ELEMENTAL_METAL, O.WORKBENCH_5);
  shieldTicks();
  assert.equal(afterClaw.inventory.getAmount(I.ELEMENTAL_SHIELD), 1);
  assert.equal(h.transcripts.length, 0, 'EW2 does not offer the claw after repair');

  // Ordinary EW1 player (EW2 untouched) still smiths a shield.
  const ordinary = player();
  h.ew1.setStage(ordinary, BIT_READ_BOOK);
  ordinary.inventory.adds(I.ELEMENTAL_METAL, 1);
  ordinary.inventory.adds(I.HAMMER, 1);
  ordinary.inventory.adds(I.SLASHED_BOOK, 1);
  h.itemOnObject(ordinary, I.ELEMENTAL_METAL, O.WORKBENCH_5);
  shieldTicks();
  assert.equal(ordinary.inventory.getAmount(I.ELEMENTAL_SHIELD), 1);
  assert.equal(ordinary.varbits.get(VARBIT_QUEST_STATUS), 2);
});


test('the wall bit replays on login from a real crossing or a legacy workshop entry; box bits survive', () => {
  const legacy=player();h.ew1.setStage(legacy,BIT_READ_BOOK|BIT_ENTERED_WORKSHOP);h.login(legacy);
  assert.equal((legacy.configs.get(299)>>>15)&1,1,'real historical workshop entry proves wall was crossed');
  const crossed=player();h.ew1.setStage(crossed,BIT_READ_BOOK|(1<<16));h.login(crossed);
  assert.equal((crossed.configs.get(299)>>>15)&1,1,'private wall bit 16 goes out as the client bit 15');
  const needle=player();h.ew1.setStage(needle,BIT_READ_BOOK|(1<<15));h.login(needle);
  assert.equal((needle.configs.get(299)>>>15)&1,0,'an old save\'s needle bit is never sent as the wall');
  const boxes=CacheDefinitions.getVarbit(2064);assert.equal(boxes.baseVar,299);
  legacy.configs.set(299,legacy.configs.get(299)|(5<<boxes.startBit));
  h.login(legacy);
  assert.equal((legacy.configs.get(299)>>>boxes.startBit)&7,5,'unmodelled box state survives machine replay');
});
