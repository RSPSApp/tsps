// Run after `yarn build`: node --test tests/trident.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const Trident = require("../plugins/items/Trident.plugin");
const actions = new Map();
Trident.register({
  core: PluginManager.getCoreApi(),
  onItemAction: (name, itemActions) => actions.set(name, itemActions),
  onItemOnItem() {},
  registerCombatMethodResolver() {},
  onCustomEvent() {},
  emitCustomEvent() {},
});

function makePlayer(trident, resources = {}) {
  const items = [trident];
  const amounts = new Map(Object.entries(resources).map(([id, amount]) => [Number(id), amount]));
  const messages = [];
  const inventory = {
    getItems: () => [...items, ...[...amounts].filter(([, amount]) => amount > 0).map(([id, amount]) => new Item(id, amount))],
    deleteAtSlot(slot, amount) { this.deleteNumber(this.getItems()[slot].getId(), amount); },
    getAmount: (id) => amounts.get(id) ?? 0,
    deleteNumber(id, amount) {
      amounts.set(id, Math.max(0, this.getAmount(id) - amount));
      return true;
    },
    contains: (id) => (amounts.get(id) ?? 0) > 0,
    getFreeSlots: () => 28,
    getAddableAmount: (item) => item.getAmount(),
    addItem(item) {
      amounts.set(item.getId(), this.getAmount(item.getId()) + item.getAmount());
    },
    refreshItems() {},
  };
  const equipment = { getItems: () => [], refreshItems() {} };
  const player = {
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getUpdateFlag: () => ({ flag() {} }),
    sendMessage: (message) => messages.push(message),
  };
  return { player, inventory, amounts, messages };
}

function resourceAmount(player, id) {
  return player.amounts.get(id) ?? 0;
}

test("both tridents charge from any required rune or their variant resource", () => {
  const cases = [
    {
      recipe: Trident._test.RECIPES[0],
      resourceId: ItemIdentifiers.DEATH_RUNE,
      primaryAmount: 30,
      expectedCharges: 3,
    },
    {
      recipe: Trident._test.RECIPES[1],
      resourceId: ItemIdentifiers.FIRE_RUNE,
      primaryAmount: 4,
      expectedCharges: 4,
    },
  ];

  for (const { recipe, resourceId, primaryAmount, expectedCharges } of cases) {
    const trident = new Item(recipe.unchargedId);
    const { player, inventory, amounts } = makePlayer(trident, {
      [ItemIdentifiers.DEATH_RUNE]: 4,
      [ItemIdentifiers.CHAOS_RUNE]: 4,
      [ItemIdentifiers.FIRE_RUNE]: 20,
      [recipe.primaryResourceId]: primaryAmount,
    });
    const event = {
      player,
      usedItemId: resourceId,
      usedWithItemId: recipe.unchargedId,
      usedItem: new Item(resourceId),
      usedWithItem: trident,
      usedItemSlot: 1,
      usedWithItemSlot: 0,
    };

    Trident._test.chargeWithResources(event);

    assert.equal(event.handled, true);
    assert.equal(trident.getId(), recipe.chargedId);
    assert.equal(Trident._test.getCharges(trident), expectedCharges);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.DEATH_RUNE), 4 - expectedCharges);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.CHAOS_RUNE), 4 - expectedCharges);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.FIRE_RUNE), 20 - expectedCharges * 5);
    assert.equal(resourceAmount({ amounts }, recipe.primaryResourceId), primaryAmount - expectedCharges * recipe.primaryPerCharge);
    assert.equal(inventory.getItems()[0], trident);
  }
});

test("uncharging restores runes and swamp scales but not sea-trident coins", () => {
  for (const recipe of Trident._test.RECIPES) {
    const trident = new Item(recipe.chargedId, 1, {
      [Trident._test.TRIDENT_CHARGE_META_KEY]: 12,
    });
    const { player, amounts, messages } = makePlayer(trident);

    assert.equal(Trident._test.unchargeTrident({ player, item: trident }), true);
    assert.equal(trident.getId(), recipe.unchargedId);
    assert.equal(Trident._test.getCharges(trident), 0);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.DEATH_RUNE), 12);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.CHAOS_RUNE), 12);
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.FIRE_RUNE), 60);
    assert.equal(
      resourceAmount({ amounts }, ItemIdentifiers.ZULRAHS_SCALES),
      recipe.primaryResourceId === ItemIdentifiers.ZULRAHS_SCALES ? 12 : 0
    );
    assert.equal(resourceAmount({ amounts }, ItemIdentifiers.COINS), 0);
    assert.match(messages.at(-1), /uncharge/i);
  }
});

test("named inventory actions expose Charge, Check, and Uncharge", () => {
  assert.equal(typeof actions.get("Uncharged trident").Charge, "function");
  assert.equal(typeof actions.get("Trident of the Seas").Check, "function");
  assert.equal(typeof actions.get("Trident of the Seas").Uncharge, "function");
  assert.equal(typeof actions.get("Uncharged toxic trident").Charge, "function");
  for (const name of ["Uncharged trident", "Uncharged toxic trident", "Uncharged trident (e)", "Uncharged toxic trident (e)"]) {
    assert.equal(typeof actions.get(name).Check, "function", `${name} has Check, so a worn one isn't unequipped`);
  }
  assert.equal(typeof actions.get("Trident of the Swamp").Check, "function");
  assert.equal(typeof actions.get("Trident of the Swamp").Uncharge, "function");
});

const path = require("node:path");
const { before } = require("node:test");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { JsonPlayerPersistence } = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const core = PluginManager.getCoreApi();
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Trident.register(PluginManager.createApi("TridentFullIdRegression"));
  require("../plugins/persistence/JsonPlayerPersistence.plugin").register(PluginManager.createApi("TridentPersistenceRegression"));
  PluginManager.createApi("TridentChargePreservation").onCustomEvent("combat:consume-charge", event => {
    if (event.player.getAttribute("test:spare-trident-charge") === true) event.skip = true;
  });
});

function realActor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername("tridentcast"); p.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(p), true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevels(core.Skill.MAGIC, 99, false);
  t.after(() => { core.TaskManager.cancelTasks(p); core.World.getPlayers().removes(p); });
  return p;
}

function saveLoad(t, p) {
  const codec = new JsonPlayerPersistence();
  const record = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const loaded = realActor(t);
  codec.hydratePlayerSave(record).applyToPlayer(loaded);
  loaded.setAttribute("bot-skip-persistence", true);
  return loaded;
}

for (const [fullId, chargedId] of [
  [ItemIdentifiers.TRIDENT_OF_THE_SEAS_FULL_, ItemIdentifiers.TRIDENT_OF_THE_SEAS],
  [ItemIdentifiers.TRIDENT_OF_THE_SEAS_FULL_O_, ItemIdentifiers.TRIDENT_OF_THE_SEAS_O_],
]) {
  test(`full trident ${fullId} becomes ${chargedId} only after a real charge spend and survives equipment/save transitions`, t => {
    const p = realActor(t), inventory = p.getInventory();
    const original = new Item(fullId, 1, { "test:origin": "kept", [Item.PRESET_META]: true });
    const untouched = new Item(fullId, 1);
    inventory.setItem(0, original); inventory.setItem(1, untouched);
    assert.equal(Trident._test.getCharges(original), 2500);
    assert.equal(original.getId(), fullId, "checking the inventory copy does not normalize its ID");
    EquipPacketListener.equip(p, fullId, 0, core.Inventory.INTERFACE_ID);
    const staff = p.getEquipment().get(core.Equipment.WEAPON_SLOT);
    assert.notEqual(staff, original, "real equip transfers a metadata-preserving copy");
    assert.equal(staff.getId(), fullId);
    const npc = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3201, 3200, 0));
    const method = core.CombatFactory.getMethod(p);
    assert.ok(method instanceof core.MagicCombatMethod, "production resolver chooses the built-in magic method");
    assert.equal(staff.getId(), fullId, "resolving/seeding full charges does not normalize before spending");
    assert.equal(Trident._test.getCharges(staff), 2500);
    p.setAttribute("test:spare-trident-charge", true);
    assert.equal(method.canAttack(p, npc), true);
    assert.equal(staff.getId(), fullId, "a genuinely spared cast keeps the full variant");
    assert.equal(Trident._test.getCharges(staff), 2500);
    p.setAttribute("test:spare-trident-charge", false);
    assert.equal(method.canAttack(p, npc), true, "actual powered-staff canAttack spends its charge");
    method.start(p, npc);
    assert.equal(method.hits(p, npc).length, 1, "the native spell produces a real PendingHit");
    assert.equal(staff.getId(), chargedId);
    assert.equal(Trident._test.getCharges(staff), 2499);
    assert.equal(staff.getMetaValue("test:origin"), "kept");
    assert.equal(staff.isPresetItem(), true);
    assert.equal(p.getEquipment().get(core.Equipment.WEAPON_SLOT), staff);
    assert.equal(untouched.getId(), fullId, "the independent inventory copy stays full");
    assert.equal(Trident._test.getCharges(untouched), 2500);
    const loaded = saveLoad(t, p), loadedStaff = loaded.getEquipment().get(core.Equipment.WEAPON_SLOT);
    assert.equal(loadedStaff.getId(), chargedId);
    assert.equal(Trident._test.getCharges(loadedStaff), 2499);
    assert.equal(loadedStaff.getMetaValue("test:origin"), "kept");
    assert.equal(loadedStaff.isPresetItem(), true);
    assert.ok(core.CombatFactory.getMethod(loaded) instanceof core.MagicCombatMethod);
    assert.equal(Trident._test.getCharges(loadedStaff), 2499, "re-resolving after load does not refill it");
    EquipPacketListener.unequip(loaded, core.Equipment.WEAPON_SLOT);
    const returned = loaded.getInventory().getItems().find(item => item.getId() === chargedId);
    assert.ok(returned, "real unequip returns the partially charged ID to inventory");
    assert.equal(Trident._test.getCharges(returned), 2499);
    assert.equal(returned.getMetaValue("test:origin"), "kept");
  });
}
