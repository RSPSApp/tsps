// Run after `yarn build`: node --test tests/gravestones.test.cjs
// Gravestones (docs/gravestones.md): fee bands, how a grave stacks, and which deaths fill one.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core;
let Fees;
let Common;
const hooks = {};
const custom = {};
const spawned = [];
const config = {};

const COINS = 995;
const SHARK = 385;
const RUNE_SCIMITAR = 1333;
const RANGER_BOOTS = 2577;
const ABYSSAL_WHIP = 4151; // cache value 120,001: the 1,000-coin band
const ARMADYL_GODSWORD = 11802; // 1,250,000: the 10,000-coin band
const IRON_ORE = 440;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const on = (name) => (handler) => (hooks[name] = handler);
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key in config ? config[key] : fallback),
    spawnNpc: (definition) => {
      const npc = { definition };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => spawned.splice(spawned.indexOf(npc), 1),
    onCustomEvent: (name, handler) => (custom[name] = handler),
    emitCustomEvent: (name, payload) => custom[name]?.(payload),
    onInterfaceActionButton() {},
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/world/Gravestones.plugin").register(api);
  Fees = require("../plugins/world/gravestones/Fees.Gravestones");
  Common = require("../plugins/world/gravestones/Common.Gravestones");
});

/** A real player whose messages and varbits are recorded; `mode` is its ironman mode. */
function account(name, mode = null) {
  const player = new Player(null);
  player.setUsername(name);
  const messages = [];
  const varbits = new Map();
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "sendVarbit") return (id, value) => (varbits.set(id, value), sender);
      if (key === "getVarbit") return (id) => varbits.get(id) ?? 0;
      if (key === "isSubInterfaceOpen") return () => false;
      return () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  custom["ironman:mode"] = (query) => (query.mode = query.player === player ? mode : query.mode);
  return Object.assign(player, { messages, varbits });
}

function death(player, items, { killer = null, x = 3222, y = 3218 } = {}) {
  const event = {
    player,
    killer,
    location: new core.Location(x, y, 0),
    items: items.filter(([id]) => core.ItemDefinition.forId(id).isTradeable()).map(([id, amount, meta]) => new core.Item(id, amount, meta)),
    untradeables: items.filter(([id]) => !core.ItemDefinition.forId(id).isTradeable()).map(([id, amount, meta]) => new core.Item(id, amount, meta)),
    layout: { inventory: items.map(([id]) => id), equipment: [] },
  };
  hooks.onPlayerDeathDrops(event);
  return event;
}

const graveOf = (player) => player.getAttribute("gravestones:grave");

test("a charged Webweaver lost in PvM keeps its ether metadata through the normal grave and Office", (t) => {
  const Bow = require("../plugins/items/WebweaverBow.plugin");
  Bow.register({
    core, emitCustomEvent() {}, onItemOnItem() {}, onItemAction() {},
    registerRangedAmmoHandler() {}, registerRangedCombatModifier() {}, onPlayerDeathItemDrop() {},
  });
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  t.mock.method(PluginManager, "emitPlayerDeathItemDrop", (event) => { Bow._test.deathItemDrop(event); return false; });
  t.mock.method(PluginManager, "emitPlayerDeathDrops", (event) => hooks.onPlayerDeathDrops(event));
  t.mock.method(core.ItemOnGroundManager, "registerLocation", () => assert.fail("ether must not also drop on the floor"));
  const player = account("webweaver-grave");
  player.setLocation(new core.Location(3090, 3600, 0));
  player.setSkullTimer(100);
  const bow = new core.Item(core.ItemIdentifiers.WEBWEAVER_BOW, 1, { [Bow._test.CHARGES_META]: 50 });
  player.getInventory().addItem(bow);
  assert.deepEqual(PlayerDeathTask.dropItems(player, null, player.getLocation()), []);
  const held = graveOf(player);
  assert.equal(held.items.length, 1);
  assert.equal(held.items[0].id, bow.getId());
  assert.equal(held.items[0].meta[Bow._test.CHARGES_META], 50);
  player.setAttribute("gravestones:grave", JSON.parse(JSON.stringify(held)));
  custom["gravestones:expire"]({ player });
  const query = { player };
  custom["gravestones:state"](query);
  assert.equal(query.office.length, 1);
  assert.equal(query.office[0].id, bow.getId());
  assert.equal(query.office[0].meta[Bow._test.CHARGES_META], 50);
  assert.equal(query.grave, null);
});

test('an encounter grave discount survives persistence and does not discount the Office', t => {
  const Grave = require('../plugins/world/gravestones/Grave.Gravestones');
  const player = account('discounted');
  custom['gravestones:grave-location'] = request => {
    request.tile = { x: 3220, y: 3218, z: 0 };
    request.feeMultiplier = 0.25;
  };
  t.after(() => { delete custom['gravestones:grave-location']; });
  death(player, [[ABYSSAL_WHIP, 1]]);
  assert.equal(graveOf(player).feeMultiplier, 0.25);
  player.setAttribute('gravestones:grave', JSON.parse(JSON.stringify(graveOf(player))));
  assert.equal(Grave.fee(player), 250);
  assert.equal(Fees.officeFee(ABYSSAL_WHIP, false), 6000, 'Office valuation is unchanged');
});

test('invalid encounter discounts retain normal fees and merged graves cannot launder fees', t => {
  const Grave = require('../plugins/world/gravestones/Grave.Gravestones');
  t.after(() => { delete custom['gravestones:grave-location']; });
  for (const multiplier of [-1, 2, NaN, '0.25']) {
    const player = account(`invalid-${String(multiplier)}`);
    custom['gravestones:grave-location'] = request => { request.feeMultiplier = multiplier; };
    death(player, [[ABYSSAL_WHIP, 1]]);
    assert.equal(Grave.fee(player), 1000);
  }
  const player = account('merged-discounts');
  custom['gravestones:grave-location'] = request => { request.feeMultiplier = 0.25; };
  death(player, [[ABYSSAL_WHIP, 1]]);
  delete custom['gravestones:grave-location'];
  death(player, [[ARMADYL_GODSWORD, 1]]);
  assert.equal(Grave.fee(player), 11000, 'normal-fee items cannot enter a discounted grave');
  custom['gravestones:grave-location'] = request => { request.feeMultiplier = 0.25; };
  death(player, [[ABYSSAL_WHIP, 1]]);
  assert.equal(Grave.fee(player), 12000, 'a later discounted death cannot discount the existing contents');
});

test("grave fees: free under 100k, then 1k, 10k or 100k each, 500k at most; ironmen pay half", () => {
  const records = [{ id: ABYSSAL_WHIP, amount: 1 }, { id: ARMADYL_GODSWORD, amount: 1 }, { id: RUNE_SCIMITAR, amount: 1 }];
  assert.equal(Fees.graveFee(records, false), 11000);
  assert.equal(Fees.graveFee(records, true), 5500);
  assert.equal(Fees.graveFee([{ id: ARMADYL_GODSWORD, amount: 80 }], false), 500000);
  assert.equal(Fees.graveFee([{ id: RUNE_SCIMITAR, amount: 5 }], false), 0);
});

test("the fee threshold varbits point one past the first slot below each band", () => {
  const sorted = Common.stack([], [{ id: RUNE_SCIMITAR, amount: 1 }, { id: ABYSSAL_WHIP, amount: 1 }, { id: ARMADYL_GODSWORD, amount: 1 }], 120).held;
  assert.deepEqual(sorted.map(({ id }) => id), [ARMADYL_GODSWORD, ABYSSAL_WHIP, RUNE_SCIMITAR], "most valuable first");
  assert.equal(Fees.threshold(sorted, 100000), 3);
  assert.equal(Fees.threshold(sorted, 1000000), 2);
  assert.equal(Fees.threshold(sorted, 10000000), 1);
  assert.equal(Fees.threshold([{ id: ARMADYL_GODSWORD, amount: 1 }], 100000), 0, "0 when no slot is below");
});

test("Death's Office charges 5% of items worth 100k or more", () => {
  assert.equal(Fees.officeFee(ARMADYL_GODSWORD, false), 62500);
  assert.equal(Fees.officeFee(ARMADYL_GODSWORD, true), 31250);
  assert.equal(Fees.officeFee(RUNE_SCIMITAR, false), 0);
});

test("a grave stacks like a bank, caps a stack at 2^31-1 and returns what doesn't fit", () => {
  const { held, overflow } = Common.stack([{ id: COINS, amount: 2147483000, meta: null }], [{ id: COINS, amount: 1000, meta: null }], 120);
  assert.deepEqual(held, [{ id: COINS, amount: 2147483647, meta: null }]);
  assert.deepEqual(overflow, [{ id: COINS, amount: 353, meta: null }]);
  const full = Common.stack([], [{ id: ABYSSAL_WHIP, amount: 1 }, { id: RUNE_SCIMITAR, amount: 1 }], 1);
  assert.deepEqual([full.held.map(({ id }) => id), full.overflow.map(({ id }) => id)], [[ABYSSAL_WHIP], [RUNE_SCIMITAR]]);
});

test("a PvM death fills a grave, food and potions form a supply pile", () => {
  const player = account("grave1");
  const event = death(player, [[ABYSSAL_WHIP, 1], [SHARK, 2], [COINS, 500]]);
  assert.deepEqual(event.items.map((item) => item.getId()), [SHARK], "the sharks still fall to the floor");
  assert.deepEqual(graveOf(player).items.map(({ id }) => id), [ABYSSAL_WHIP, COINS]);
  assert.equal(graveOf(player).duration, 1500);
  assert.deepEqual(player.messages, ["Some supplies have been dropped where you died."]);
  assert.equal(spawned.at(-1).definition.ownerOnly, true);
});

test("with supply piles off, food goes in the grave too", () => {
  const player = account("grave2");
  player.varbits.set(Common.VARBIT.supplyPilesDisabled, 1);
  const event = death(player, [[SHARK, 2]]);
  assert.equal(event.items.length, 0);
  assert.deepEqual(graveOf(player).items, [{ id: SHARK, amount: 2, meta: null }]);
});

test("PvP deaths, Ultimate Ironmen and a world without graves leave the items to drop", () => {
  const killed = account("grave3");
  const pvp = death(killed, [[ABYSSAL_WHIP, 1]], { killer: account("killer") });
  assert.equal(pvp.items.length, 1);
  assert.equal(graveOf(killed), undefined);
  const uim = account("grave4", "ultimate");
  assert.equal(death(uim, [[ABYSSAL_WHIP, 1]]).items.length, 1);
  config["Gravestones:enabled"] = false;
  const off = account("grave5");
  assert.equal(death(off, [[ABYSSAL_WHIP, 1]]).items.length, 1);
  delete config["Gravestones:enabled"];
});

test("a second death adds to the grave and sends its resources to Death's Office", () => {
  const player = account("grave6");
  death(player, [[ABYSSAL_WHIP, 1], [IRON_ORE, 5]]);
  death(player, [[RUNE_SCIMITAR, 1]]);
  assert.deepEqual(graveOf(player).items.map(({ id }) => id), [ABYSSAL_WHIP, RUNE_SCIMITAR]);
  assert.equal(graveOf(player).merged, true);
  assert.deepEqual(player.getAttribute("gravestones:office"), [{ id: IRON_ORE, amount: 5, meta: null }]);
  assert.ok(player.messages.includes("Some items have been moved to Death's Office from your gravestone."));
});


test("grave and Office fees use loaded GE quotes while preserving grave contents and slots", t => {
  const definitions = core.ItemDefinition.definitions;
  const previous = new Map([...definitions.values()].map(def => [def, [def.grandExchangeValue, def.grandExchangeSellValue]]));
  t.after(() => {
    for (const def of definitions.values()) {
      const prices = previous.get(def) ?? [undefined, undefined];
      [def.grandExchangeValue, def.grandExchangeSellValue] = prices;
    }
  });
  const loaded = require("../plugins/items/ItemDefinitionLoader.plugin")._test.loadItemPrices();
  assert.ok(loaded.loaded > 0, "the canonical snapshot loader loaded prices");
  const boots = core.ItemDefinition.forId(RANGER_BOOTS);
  const whip = core.ItemDefinition.forId(ABYSSAL_WHIP);
  const scimitar = core.ItemDefinition.forId(RUNE_SCIMITAR);
  const coins = core.ItemDefinition.forId(COINS);
  const defender = core.ItemDefinition.forId(core.ItemIdentifiers.DRAGON_DEFENDER);
  const sceptre = core.ItemDefinition.forId(core.ItemIdentifiers.PHARAOHS_SCEPTRE_3_);
  assert.equal(boots.getName(), "Ranger boots");
  assert.equal(whip.getName(), "Abyssal whip");
  assert.equal(scimitar.getName(), "Rune scimitar");
  assert.equal(scimitar.getValue(), 25600);
  assert.ok([boots, whip, scimitar].every(def => def.isTradeable()), "snapshot items are tradeable in the active cache");
  assert.equal(defender.hasGrandExchangeValue(), false);
  assert.equal(defender.getValue(), 68007);
  assert.equal(sceptre.getName(), "Pharaoh's sceptre");
  assert.equal(sceptre.isTradeable(), false, "active cache marks the quoted sceptre untradeable");
  assert.equal(sceptre.getValue(), 100);
  assert.equal(sceptre.hasGrandExchangeValue(), true);
  assert.equal(sceptre.getGrandExchangeValue(), 4999999, "historical quote exists for this untradeable variant");
  assert.equal(boots.getValue(), 200, "active-cache ranger boots store value");
  assert.equal(boots.hasGrandExchangeValue(), true);
  assert.equal(boots.getGrandExchangeValue(), 36201000, "loader uses the greater inverted snapshot quote");
  assert.equal(whip.getValue(), 120001);
  assert.equal(whip.getGrandExchangeValue(), 751282);
  assert.equal(scimitar.getGrandExchangeValue(), 15179);
  assert.equal(coins.hasGrandExchangeValue(), false);
  assert.equal(coins.getGrandExchangeValue(), coins.getValue(), "the existing getter falls back to cache value");
  assert.equal(Fees.officeFee(COINS, false), 0, "unquoted cache-value free control");
  const capacity = Common.stack([], [{ id: RANGER_BOOTS, amount: 1 }, { id: ABYSSAL_WHIP, amount: 1 }], 1);
  assert.deepEqual([capacity.held[0].id, capacity.overflow[0].id], [ABYSSAL_WHIP, RANGER_BOOTS], "quote does not change cache-based capacity selection");

  const Grave = require("../plugins/world/gravestones/Grave.Gravestones");
  const player = account("quoted-grave");
  t.after(() => { hooks.onPlayerLogout({ player }); core.TaskManager.cancelTasks(player); });
  const oldSender = player.getPacketSender();
  const sent = [];
  let opened = false;
  const sender = new Proxy(oldSender, { get(target, key) {
    if (key === "sendInventory") return (id, capacity, items) => { sent.push({ id, capacity, items }); return sender; };
    if (key === "sendSubInterface") return () => { opened = true; return sender; };
    if (key === "isSubInterfaceOpen") return () => opened;
    if (key === "closeInterface") return () => { opened = false; return sender; };
    return target[key];
  } });
  player.getPacketSender = () => sender;
  const bootMeta = { variant: "saved-boots" };
  death(player, [[RANGER_BOOTS, 1, bootMeta], [ABYSSAL_WHIP, 1], [RUNE_SCIMITAR, 1]]);
  const saved = graveOf(player);
  assert.deepEqual(saved.items.map(item => item.id).sort((a, b) => a - b), [RUNE_SCIMITAR, RANGER_BOOTS, ABYSSAL_WHIP], "the grave retains all three items");
  assert.equal(Grave.fee(player), 101000, "grave charges the loaded quote bands");
  assert.equal(Fees.feeValue(core.ItemIdentifiers.DRAGON_DEFENDER), 68007, "unquoted items retain cache value");
  assert.equal(Fees.feeValue(core.ItemIdentifiers.PHARAOHS_SCEPTRE_3_), 100, "quoted untradeable items retain cache value");
  assert.equal(Fees.graveFee([{ id: core.ItemIdentifiers.PHARAOHS_SCEPTRE_3_, amount: 1 }], false), 0);
  assert.equal(Fees.officeFee(ABYSSAL_WHIP, false), 37564);
  assert.equal(Fees.officeFee(ABYSSAL_WHIP, true), 18782);
  assert.equal(Fees.officeFee(RUNE_SCIMITAR, false), 0);
  assert.equal(Fees.graveFee(saved.items, true), 50500);
  const state = { player };
  custom["gravestones:state"](state);
  assert.equal(state.grave.officeFee, 1847614, "Office quote for the actual grave contents");

  // A persisted grave can still be ordered by cache value when opened after this change.
  const legacyOrder = [ABYSSAL_WHIP, RUNE_SCIMITAR, RANGER_BOOTS].map(id => saved.items.find(item => item.id === id));
  player.setAttribute("gravestones:grave", JSON.parse(JSON.stringify({ ...saved, items: legacyOrder })));
  Grave.open(player);
  assert.deepEqual(graveOf(player).items.map(item => item.id), [RANGER_BOOTS, ABYSSAL_WHIP, RUNE_SCIMITAR]);
  assert.deepEqual(sent.at(-1).items.map(item => item.id), [RANGER_BOOTS, ABYSSAL_WHIP, RUNE_SCIMITAR]);
  assert.equal(player.varbits.get(Common.VARBIT.under100k), 3);
  assert.equal(player.varbits.get(Common.VARBIT.under1m), 2);
  assert.equal(player.varbits.get(Common.VARBIT.under10m), 2);
  Grave.takeSlot(player, 0);
  assert.equal(player.getInventory().getAmount(RANGER_BOOTS), 0, "the paid displayed slot cannot be taken for free");
  Grave.takeSlot(player, 2);
  assert.equal(player.getInventory().getAmount(RUNE_SCIMITAR), 1, "the displayed free slot selects the same record");
  assert.deepEqual(graveOf(player).items.map(item => item.id), [RANGER_BOOTS, ABYSSAL_WHIP]);
  player.setAttribute("gravestones:coffer", 101000);
  Grave.payOrTake(player);
  assert.equal(player.getAttribute("gravestones:coffer"), null, "the actual grave fee was paid");
  Grave.takeSlot(player, 0);
  const recovered = player.getInventory().getItems().find(item => item && item.getId() === RANGER_BOOTS);
  assert.deepEqual(recovered?.getMeta(), bootMeta, "the clicked paid slot retains its metadata");
  assert.deepEqual(graveOf(player).items.map(item => item.id), [ABYSSAL_WHIP]);
});


test("a full grave retains the highest fee-valued items when another death adds to it", t => {
  const definitions = core.ItemDefinition.definitions;
  const previous = new Map([...definitions.values()].map(def => [def, [def.grandExchangeValue, def.grandExchangeSellValue]]));
  t.after(() => {
    for (const def of definitions.values()) {
      const prices = previous.get(def) ?? [undefined, undefined];
      [def.grandExchangeValue, def.grandExchangeSellValue] = prices;
    }
  });
  const loaded = require("../plugins/items/ItemDefinitionLoader.plugin")._test.loadItemPrices();
  assert.ok(loaded.loaded > 0, "the canonical quote snapshot was loaded");
  assert.equal(core.CacheDefinitions.getInventoryId("gravestone"), 525, "active cache grave inventory identity");
  assert.equal(Common.GRAVE_INV, 525);
  assert.equal(Common.GRAVE_SLOTS, 120, "server capacity matches the pinned grave inventory");
  const boots = core.ItemDefinition.forId(RANGER_BOOTS);
  const sceptre = core.ItemDefinition.forId(core.ItemIdentifiers.PHARAOHS_SCEPTRE_3_);
  const defender = core.ItemDefinition.forId(core.ItemIdentifiers.DRAGON_DEFENDER);
  assert.equal(boots.getValue(), 200);
  assert.equal(boots.isTradeable(), true);
  assert.equal(boots.getGrandExchangeValue(), 36201000);
  assert.equal(Fees.officeFee(RANGER_BOOTS, false), 1810050);
  assert.equal(sceptre.isTradeable(), false);
  assert.equal(sceptre.getGrandExchangeValue(), 4999999);
  assert.equal(Fees.feeValue(core.ItemIdentifiers.PHARAOHS_SCEPTRE_3_), 100, "quoted untradeable keeps cache value");
  assert.equal(defender.hasGrandExchangeValue(), false);
  assert.equal(Fees.feeValue(core.ItemIdentifiers.DRAGON_DEFENDER), 68007, "unquoted item keeps cache value");

  // Select real, distinct equipment which can occupy inventory slots across ordinary deaths.
  const resourceNames = new Set(require("../plugins/world/data/gravestone-resources.json").names.map(name => name.toLowerCase()));
  const ids = [...new Set(Object.values(core.ItemIdentifiers).filter(Number.isInteger))].sort((a, b) => a - b);
  const candidates = [];
  for (const id of ids) {
    if (id === RANGER_BOOTS || id < 0 || id >= core.CacheDefinitions.getCounts().items) continue;
    const def = core.ItemDefinition.forId(id);
    if (!def.isTradeable() || def.isNoted() || def.isStackable() || def.getValue() <= 200 ||
        (def.getEquipmentType?.()?.getSlot?.() ?? -1) < 0 || Common.isSupply(id) ||
        resourceNames.has(def.getName().toLowerCase())) continue;
    const worth = Fees.feeValue(id);
    if (worth >= 100000) continue;
    candidates.push({ id, worth });
  }
  candidates.sort((a, b) => a.worth - b.worth || a.id - b.id);
  assert.ok(candidates.length >= 120, "the active cache supplies enough eligible equipment");
  const lowest = candidates[0];
  const filler = [lowest, ...candidates.filter(item => item.worth > lowest.worth).slice(0, 119)];
  assert.equal(filler.length, 120, "one unique lowest fee value and 119 higher values");
  assert.equal(new Set(filler.map(item => item.id)).size, 120);
  assert.ok(filler.every(item => item.worth < 100000));

  const player = account("grave-overflow");
  t.after(() => { hooks.onPlayerLogout({ player }); core.TaskManager.cancelTasks(player); player.getInventory().resetItems(); });
  player.setRights(core.PlayerRights.NONE);
  player.setSkullType(core.SkullType.WHITE_SKULL);
  player.setSkullTimer(100);
  player.getPrayerActive().fill(false);
  assert.equal(player.isSkulled(), true);
  const sentIds = [RANGER_BOOTS, ...filler.map(item => item.id)];
  for (let start = 0; start < sentIds.length; start += 28) {
    const batch = sentIds.slice(start, start + 28);
    assert.ok(batch.length <= 28, "each death fits an inventory");
    for (const id of batch) player.getInventory().add(new core.Item(id, 1), false);
    const carried = player.getInventory().getValidItems();
    assert.deepEqual(carried.map(item => item.getId()), batch, "the real inventory holds this batch");
    assert.deepEqual(core.PlayerDeathTask.getItemsToKeep(player), [], "a skulled player without Protect Item keeps none");
    const event = {
      player, killer: null, location: new core.Location(3222, 3218, 0),
      items: carried.map(item => item.clone()), untradeables: [],
      layout: { inventory: player.getInventory().getItems().map(item => item?.getId() ?? -1), equipment: [] },
    };
    hooks.onPlayerDeathDrops(event);
    player.getInventory().resetItems();
    assert.equal(event.items.length, 0, "eligible items were stored, not dropped as supplies");
    assert.equal(event.untradeables.length, 0);
    const seen = start + batch.length;
    if (seen <= 120) {
      assert.equal(graveOf(player).items.length, seen);
      assert.deepEqual(player.getAttribute("gravestones:office") ?? [], [], "no overflow below capacity");
    }
  }
  const grave = graveOf(player).items;
  const office = player.getAttribute("gravestones:office") ?? [];
  assert.equal(grave.length, 120);
  assert.equal(office.length, 1);
  const all = [...grave, ...office];
  assert.ok(all.every(item => item.amount === 1 && item.meta == null));
  assert.deepEqual(all.map(item => item.id).sort((a, b) => a - b), [...sentIds].sort((a, b) => a - b), "grave and Office conserve every item");
  assert.ok(grave.some(item => item.id === RANGER_BOOTS), "the high-quote boots stay in the grave");
  // Equal values retain their prior order. These are real active-cache definitions.
  const byValue = new Map();
  for (const item of candidates) {
    const group = byValue.get(item.worth) ?? [];
    group.push(item.id);
    byValue.set(item.worth, group);
  }
  const tied = [...byValue.values()].find(group => group.length >= 2);
  assert.ok(tied, "the cache has distinct eligible equipment with equal fee values");
  const tieInput = [{ id: tied[1], amount: 1 }, { id: tied[0], amount: 1 }];
  const tieResult = Common.stack([], tieInput, 1, Fees.feeValue);
  assert.deepEqual([tieResult.held[0].id, tieResult.overflow[0].id], [tied[1], tied[0]]);

  assert.equal(office[0].id, lowest.id, "the unique least fee-valued item goes to the Office");
  assert.equal(Fees.graveFee(grave, false), 100000);
  assert.equal(Fees.graveFee(grave, true), 50000);
  const state = { player };
  custom["gravestones:state"](state);
  assert.equal(state.office[0].fee, 0, "the free overflow item has no Office fee");
  assert.equal(player.getAttribute("gravestones:coffer") ?? 0, 0);
  assert.equal(player.getInventory().getValidItems().length, 0);
});
