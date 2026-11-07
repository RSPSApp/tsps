// Elemental Workshop I (q030) source-contract checks.
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
    moveTo: to => { location = to; },
    isRegistered: () => true,
    isPlayer: () => true, isNpc: () => false, isPlayerBot: () => false,
    getPrivateArea: () => null, getLastItemPickup: () => ({reset:noop}),
    getAsPlayer: () => p,
    getUsername: () => 'qh728-q030',
    getIndex: () => 1,
    sendMessage: message => messages.push(message),
  };
  manager = new DialogueManager(p);
  return p;
}

test('fresh stage 0: reading the book starts; cutting before reading is rejected', () => {
  const p = player();
  assert.equal(h.ew1.getStage(p), 0);

  h.object(p, O.BOOKCASE_99, 'Search', [2716, 3482, 0]);
  assert.equal(p.inventory.getAmount(I.BATTERED_BOOK), 1);
  assert.equal(h.ew1.getStage(p), 0, 'holding the book does not start the quest');

  h.itemOnItem(p, I.KNIFE, I.BATTERED_BOOK);
  assert.equal(p.inventory.getAmount(I.BATTERED_KEY), 0);
  assert.ok(p.messages.includes('You should read the book before cutting it.'));

  h.itemAction(p, I.BATTERED_BOOK, 'Read');
  assert.equal(h.ew1.getStage(p), BIT_READ_BOOK);
  assert.equal(p.varbits.get(VARBIT_QUEST_STATUS), 1, 'started is wire value 1');

  h.itemOnItem(p, I.KNIFE, I.BATTERED_BOOK);
  assert.equal(p.inventory.getAmount(I.BATTERED_KEY), 1);
});

test('mandatory Quest Helper route reaches the shield and completes on varbit 13718=2', () => {
  const p = player();
  for (const id of [I.KNIFE, I.NEEDLE, I.THREAD, I.HAMMER, I.BRONZE_PICKAXE, I.BATTERED_BOOK]) {
    p.inventory.adds(id, 1);
  }
  p.inventory.adds(I.COAL, 4);

  // Book, key and wall.
  h.itemAction(p, I.BATTERED_BOOK, 'Read');
  h.itemOnItem(p, I.KNIFE, I.BATTERED_BOOK);
  const wall = h.object(p, O.ODD_LOOKING_WALL_8, 'Open', [2709, 3495, 0]);
  assert.equal(wall.handled, true);
  assert.ok(p.getLocation().equals(new core.Location(2710, 3496, 0)), 'steps through the odd wall');
  h.object(p, O.STAIRCASE_10, 'Climb-down', [2711, 3498, 0]);
  assert.ok(p.getLocation().equals(new core.Location(2716, 9888, 0)));
  assert.ok((h.ew1.getStage(p) & BIT_ENTERED_WORKSHOP) !== 0);

  // Water wheel: east valve, west valve, lever.
  h.object(p, 3403, 'Turn', [2726, 9908, 0]);
  h.object(p, 3404, 'Turn', [2713, 9908, 0]);
  h.object(p, O.LEVER_22, 'Pull', [2722, 9906, 0]);

  // Bellows: needle, leather, thread, repair, air lever.
  h.object(p, O.CRATE_28, 'Search', [2700, 9887, 0]);
  h.object(p, O.CRATE_27, 'Search', [2717, 9894, 0]);
  h.object(p, O.BELLOWS_3, 'Fix', [2735, 9884, 0]);
  assert.equal(p.inventory.getAmount(I.LEATHER), 0, 'leather is consumed');
  assert.equal(p.inventory.getAmount(I.THREAD), 0, 'thread is consumed');
  assert.equal(p.inventory.getAmount(I.NEEDLE), 1, 'needle is reused');
  h.object(p, O.LEVER_23, 'Pull', [2734, 9887, 0]);

  // Bowl, lava, furnace.
  h.object(p, O.BOXES_5, 'Search', [2724, 9894, 0]);
  h.itemOnObject(p, I.A_STONE_BOWL, O.LAVA_TROUGH_2);
  h.itemOnObject(p, I.A_STONE_BOWL_2, O.FURNACE_14);
  assert.equal(p.inventory.getAmount(I.A_STONE_BOWL), 1, 'the empty bowl comes back');

  // Elemental ore: mine the rock, kill the elemental it releases.
  h.npc(p, N.ELEMENTAL_ROCK, 'Mine', [2703, 9894, 0]);
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_ORE), 0, 'ore drops from the elemental, not the rock');
  assert.equal(h.lastSpawned.getId(), N.EARTH_ELEMENTAL_2);
  h.npcDeath(p, h.lastSpawned, N.EARTH_ELEMENTAL_2);
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_ORE), 0,'ore must be picked up from the actual death tile');
  p.moveTo(h.lastSpawned.getLocation().clone());
  ItemOnGroundManager.pickup(p,ItemOnGroundManager.getGroundItem(p.getUsername(),I.ELEMENTAL_ORE,p.getLocation(),null));
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_ORE),1);
  h.itemOnObject(p, I.ELEMENTAL_ORE, O.FURNACE_14);
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_ORE), 0);
  assert.equal(p.inventory.getAmount(I.COAL), 0, 'four coal are consumed');
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_METAL), 1);

  // Workbench hand-in.
  h.itemOnObject(p, I.ELEMENTAL_METAL, O.WORKBENCH_5);
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_METAL), 0);
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_SHIELD), 1, 'exactly one shield');
  assert.ok((h.ew1.getStage(p) & BIT_COMPLETE) !== 0);
  assert.equal(p.varbits.get(VARBIT_QUEST_STATUS), 2, 'cache completion threshold');
  for (const [name,bit] of [['elemental_workshop_key',2],['elemental_workshop_gate1',3],
    ['elemental_workshop_gate2',4],['elemental_workshop_switch',5],['elemental_workshop_bellows',6],
    ['elemental_workshop_fire',7],['elemental_workshop_bellows_switch',9],['elemental_workshop_leather',14]]) {
    const id=CacheDefinitions.getVarbitId(name),d=CacheDefinitions.getVarbit(id);
    assert.equal(d.baseVar,299);assert.equal(d.startBit,bit);assert.equal(d.endBit,bit);
    assert.equal((p.configs.get(d.baseVar)>>>d.startBit)&1,1,`${name} already supplied by the machine bitfield`);
  }
  assert.equal(p.configs.get(VARP_MACHINE_BITS) & BIT_COMPLETE, BIT_COMPLETE);
  assert.deepEqual(p.xp, [[core.Skill.CRAFTING.getIndex(), 5000], [core.Skill.SMITHING.getIndex(), 5000]]);
  assert.equal(p.attrs.get('quest.points'), 1);

  // Repeat hand-in: another shield, no duplicate quest rewards.
  p.inventory.adds(I.ELEMENTAL_METAL, 1);
  h.itemOnObject(p, I.ELEMENTAL_METAL, O.WORKBENCH_5);
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_SHIELD), 2);
  assert.equal(p.xp.length, 2, 'XP is awarded once');
  assert.equal(p.attrs.get('quest.points'), 1);
});

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

test('out-of-order levers and unrelated Mine NPCs do not advance the quest', () => {
  const p = player();
  const lever = h.object(p, O.LEVER_22, 'Pull', [2722, 9906, 0]);
  assert.equal(lever.handled, true);
  assert.equal(p.varbits.get(VARBIT_QUEST_STATUS), 0, 'pulling the water lever alone does not start');
  assert.ok(p.messages.includes('The flow gates reset; the wheel remains still.'));

  const other = h.npc(p, N.EARTH_ELEMENTAL, 'Mine');
  assert.equal(other.handled, false, 'the mine handler is scoped to the Elemental rock');
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_ORE), 0);
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
  assert.equal(afterClaw.inventory.getAmount(I.ELEMENTAL_SHIELD), 1);
  assert.equal(h.transcripts.length, 0, 'EW2 does not offer the claw after repair');

  // Ordinary EW1 player (EW2 untouched) still smiths a shield.
  const ordinary = player();
  h.ew1.setStage(ordinary, BIT_READ_BOOK);
  ordinary.inventory.adds(I.ELEMENTAL_METAL, 1);
  ordinary.inventory.adds(I.HAMMER, 1);
  ordinary.inventory.adds(I.SLASHED_BOOK, 1);
  h.itemOnObject(ordinary, I.ELEMENTAL_METAL, O.WORKBENCH_5);
  assert.equal(ordinary.inventory.getAmount(I.ELEMENTAL_SHIELD), 1);
  assert.equal(ordinary.varbits.get(VARBIT_QUEST_STATUS), 2);
});


test('full bag cannot earn key or exhaust leather/needle crates through truthy adds failure', () => {
  const p=player();p.inventory.adds(I.BATTERED_BOOK,1);p.inventory.adds(I.KNIFE,1);
  h.itemAction(p,I.BATTERED_BOOK,'Read');
  while(p.inventory.getFreeSlots()>0)p.inventory.adds(I.COINS,1);
  const before=h.ew1.getStage(p);
  h.itemOnItem(p,I.KNIFE,I.BATTERED_BOOK);
  h.object(p,O.CRATE_28,'Search',[2711,9899,0]);
  h.object(p,O.CRATE_27,'Search',[2717,9894,0]);
  assert.equal(h.ew1.getStage(p),before,'no item actually accepted, no earned progress');
  assert.equal(p.inventory.getAmount(I.BATTERED_KEY),0);
  p.inventory.deleteNumber(I.COINS,1);
  h.itemOnItem(p,I.KNIFE,I.BATTERED_BOOK);
  assert.equal(p.inventory.getAmount(I.BATTERED_KEY),1);
  assert.ok(h.ew1.getStage(p)&(1<<2));
  for(const [object,id,bit]of [[O.CRATE_28,I.NEEDLE,1<<15],[O.CRATE_27,I.LEATHER,1<<14]]) {
    p.inventory.deleteNumber(I.COINS,1);
    h.object(p,object,'Search');
    assert.equal(p.inventory.getAmount(id),1);assert.ok(h.ew1.getStage(p)&bit);
  }
});

test('quest elemental death cleanup never injects ore into either player inventory', () => {
  const owner=player(),foreign=player();owner.inventory.adds(I.BRONZE_PICKAXE,1);
  h.npc(owner,N.ELEMENTAL_ROCK,'Mine',[2703,9894,0]);
  const first=h.lastSpawned;
  h.npcDeath(foreign,first,N.EARTH_ELEMENTAL_2);
  assert.equal(foreign.inventory.getAmount(I.ELEMENTAL_ORE),0);
  assert.equal(owner.inventory.getAmount(I.ELEMENTAL_ORE),0);
  h.npc(owner,N.ELEMENTAL_ROCK,'Mine',[2703,9894,0]);
  const second=h.lastSpawned;assert.notEqual(second,first);
  h.npcDeath(owner,second,N.EARTH_ELEMENTAL_2);
  assert.equal(owner.inventory.getAmount(I.ELEMENTAL_ORE),0);
  assert.ok(ItemOnGroundManager.getGroundItem(owner.getUsername(),I.ELEMENTAL_ORE,second.getLocation(),null));
});


test('needle history cannot set QH entered-wall bit; real crossing and legacy workshop entry can', () => {
  const p=player();h.ew1.setStage(p,BIT_READ_BOOK);
  h.object(p,O.CRATE_28,'Search');
  assert.equal((p.configs.get(299)>>>15)&1,0);
  p.inventory.deleteNumber(I.NEEDLE,1);h.object(p,O.CRATE_28,'Search');
  assert.equal(p.inventory.getAmount(I.NEEDLE),1,'lost needle is naturally recoverable');
  p.inventory.adds(I.BATTERED_KEY,1);h.object(p,O.ODD_LOOKING_WALL_8,'Open');
  assert.equal((p.configs.get(299)>>>15)&1,1);
  p.configs.clear();h.login(p);assert.equal((p.configs.get(299)>>>15)&1,1);
  const legacy=player();h.ew1.setStage(legacy,BIT_READ_BOOK|BIT_ENTERED_WORKSHOP);h.login(legacy);
  assert.equal((legacy.configs.get(299)>>>15)&1,1,'real historical workshop entry proves wall was crossed');
  const boxes=CacheDefinitions.getVarbit(2064);assert.equal(boxes.baseVar,299);
  legacy.configs.set(299,legacy.configs.get(299)|(5<<boxes.startBit));
  h.login(legacy);
  assert.equal((legacy.configs.get(299)>>>boxes.startBit)&7,5,'unmodelled box state survives machine replay');
});

test('slashed book is created by cutting and recovered from bookcase; west-first valves both turn', () => {
  const p=player();p.inventory.adds(I.BATTERED_BOOK,1);p.inventory.adds(I.KNIFE,1);
  h.itemAction(p,I.BATTERED_BOOK,'Read');h.itemOnItem(p,I.KNIFE,I.BATTERED_BOOK);
  assert.equal(p.inventory.getAmount(I.BATTERED_BOOK),0);assert.equal(p.inventory.getAmount(I.SLASHED_BOOK),1);
  assert.equal(p.inventory.getAmount(I.BATTERED_KEY),1);
  p.inventory.deleteNumber(I.SLASHED_BOOK,1);h.object(p,O.BOOKCASE_99,'Search');
  assert.equal(p.inventory.getAmount(I.SLASHED_BOOK),1);
  h.object(p,3404,'Turn',[2713,9908,0]);h.object(p,3403,'Turn',[2726,9908,0]);
  h.object(p,O.LEVER_22,'Pull');assert.equal((p.configs.get(299)>>>5)&1,1);
});

test('real elemental death drops one owned ore on its actual tile, generic loot owns ore plus Rock, normal pickup required', () => {
  const p=player();p.getUsername=()=> 'q030-real-death';p.inventory.adds(I.BRONZE_PICKAXE,1);
  h.npc(p,N.ELEMENTAL_ROCK,'Mine',[2703,9894,0]);const npc=h.lastSpawned;
  assert.equal(npc.getContentId(p),1367);assert.equal(npc.getCurrentDefinition(p).isAttackable(),true);
  const deathTile=new core.Location(2705,9893,0);npc.moveTo(deathTile);
  npc.getCombat().addDamage(p,1);
  const hooks=PluginManager.npcDeathHooks, depth=hooks.length;
  for(const handler of h.hooks.onNpcDeath)hooks.push({pluginName:'q030-death',handler});
  try {const task=new NPCDeathTask(npc);task.execute();task.execute();}finally{hooks.length=depth;}
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_ORE),0);
  const ground=ItemOnGroundManager.getGroundItem(p.getUsername(),I.ELEMENTAL_ORE,deathTile,null);
  assert.ok(ground);assert.equal(ground.getItem().getAmount(),1);
  const rock=ItemOnGroundManager.getGroundItem(p.getUsername(),1480,deathTile,null);
  assert.ok(rock);assert.equal(rock.getItem().getAmount(),1,'canonical generic Rock also remains');
  p.moveTo(deathTile.clone());while(p.inventory.getFreeSlots()>0)p.inventory.adds(I.COINS,1);
  ItemOnGroundManager.pickup(p,ground);assert.equal(p.inventory.getAmount(I.ELEMENTAL_ORE),0);
  assert.equal(ground.isPendingRemoval(),false,'full bag leaves ore on floor');
  p.inventory.clear();ItemOnGroundManager.pickup(p,ground);
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_ORE),1);assert.equal(ground.isPendingRemoval(),true);
});
