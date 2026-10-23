// Run after `yarn build`: node --test tests/warped-sceptre.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { FightType } = require("../dist/game/content/combat/FightType");
const WarpedSceptre = require("../plugins/items/WarpedSceptre.plugin");
const WildernessPlugin = require("../plugins/areas/Wilderness.plugin");

const itemActions = new Map();
let itemOnItemHandler;
let combatResolver;
const customEvents = new Map();
let loginHandler;
WarpedSceptre.register({
  core: PluginManager.getCoreApi(),
  onItemAction: (name, actions) => itemActions.set(name, actions),
  onItemOnItem: (handler) => { itemOnItemHandler = handler; },
  onCustomEvent: (name, handler) => customEvents.set(name, handler),
  onPlayerLogin: (handler) => { loginHandler = handler; },
  registerCombatMethodResolver: (resolver) => { combatResolver = resolver; },
});

function item(id) {
  return {
    id,
    meta: {},
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, value) {
      if (value === undefined) delete this.meta[key];
      else this.meta[key] = value;
    },
  };
}

function playerWithRunes({ chaos = 2, earth = 5 } = {}) {
  const runes = new Map([
    [ItemIdentifiers.CHAOS_RUNE, chaos],
    [ItemIdentifiers.EARTH_RUNE, earth],
  ]);
  const equipmentItems = new Array(14).fill(null);
  const varbits = new Map();
  const messages = [];
  return {
    messages,
    getInventory: () => ({
      getAmount: (id) => runes.get(id) ?? 0,
      deleteNumber: (id, amount) => runes.set(id, Math.max(0, (runes.get(id) ?? 0) - amount)),
      contains: (id) => (runes.get(id) ?? 0) > 0,
      getFreeSlots: () => 28,
      addItem: (rune) => runes.set(rune.getId(), (runes.get(rune.getId()) ?? 0) + rune.getAmount()),
      refreshItems() {},
    }),
    getEquipment: () => ({ getItems: () => equipmentItems, refreshItems() {} }),
    getPacketSender: () => ({ sendVarbit: (id, value) => varbits.set(id, value) }),
    sendMessage: (message) => messages.push(message),
    runeCount: (id) => runes.get(id) ?? 0,
    varbits,
  };
}

function playerWithSceptre({ id = ItemIdentifiers.WARPED_SCEPTRE, charges = 2, magic = 99 } = {}) {
  const sceptre = item(id);
  if (charges > 0) sceptre.setMetaValue("warped-sceptre", charges);
  const equipmentItems = new Array(14).fill(null);
  equipmentItems[PluginManager.getCoreApi().Equipment.WEAPON_SLOT] = sceptre;
  const state = { castSpell: null, previousCast: null, reset: false, appearanceUpdates: 0 };
  const varbits = new Map();
  const player = {
    getEquipment: () => ({ getItems: () => equipmentItems, refreshItems() {} }),
    getSkillManager: () => ({ getCurrentLevel: () => magic }),
    getCombat: () => ({
      setCastSpell: (spell) => { state.castSpell = spell; },
      setPreviousCast: (spell) => { state.previousCast = spell; },
      getSelectedSpell: () => state.castSpell,
      reset: () => { state.reset = true; },
    }),
    getUpdateFlag: () => ({ flag: () => { state.appearanceUpdates++; } }),
    getPacketSender: () => ({ sendVarbit: (id, value) => varbits.set(id, value) }),
    isPlayer: () => true,
    getAsPlayer() { return this; },
    sendMessage: (message) => state.messages.push(message),
    getInventory: () => ({ refreshItems() {} }),
  };
  state.messages = [];
  return { player, sceptre, state, varbits };
}

test("the sceptre uses its powered-staff spell, max-hit formula, speed and range", () => {
  assert.equal(WarpedSceptre._test.MAX_CHARGES, 20000);
  assert.equal(WarpedSceptre._test.baseMaxHit(playerWithSceptre({ magic: 62 }).player), 16);
  assert.equal(WarpedSceptre._test.baseMaxHit(playerWithSceptre({ magic: 99 }).player), 24);

  const built = playerWithSceptre();
  const method = combatResolver.resolve(built.player);
  assert.ok(method, "a wielded sceptre resolves to its own magic attack");
  assert.equal(method.attackSpeed(built.player), 4);
  assert.equal(method.attackDistance(built.player), 7);
  built.player.getFightType = () => FightType.POWERED_STAFF_LONGRANGE;
  assert.equal(method.attackDistance(built.player), 9);

  assert.equal(method.canAttack(built.player, { isPlayer: () => false }), true);
  assert.equal(built.state.castSpell.maximumHit(), 24);
  assert.equal(built.state.castSpell.castAnimation().getId(), 10500);
  assert.equal(built.state.castSpell.startGraphic().getId(), 2567);
  assert.equal(built.state.castSpell.endGraphic().getId(), 2568);
  built.state.castSpell.startCast = () => {};
  method.start(built.player, { isPlayer: () => false });
  assert.equal(
    built.varbits.get(WarpedSceptre._test.CHARGES_WARPED_SCEPTRE_QUANTITY_VARBIT),
    1
  );
  assert.equal(WarpedSceptre._test.charges(built.sceptre), 1);
});

test("each attack spends one stored charge and stops when empty", () => {
  const built = playerWithSceptre({ charges: 1 });
  const method = combatResolver.resolve(built.player);

  assert.equal(method.canAttack(built.player, { isPlayer: () => false }), true);
  assert.equal(WarpedSceptre._test.charges(built.sceptre), 1, "eligibility checks must not spend a charge");
  built.state.castSpell.startCast = () => {};
  method.start(built.player, { isPlayer: () => false });
  assert.equal(WarpedSceptre._test.charges(built.sceptre), 0);
  assert.equal(built.sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  assert.equal(built.state.appearanceUpdates, 1);
  assert.equal(method.canAttack(built.player, { isPlayer: () => false }), false);
  assert.match(built.state.messages.at(-1), /no charges left/i);
  assert.equal(built.state.reset, true);
});

test("the built-in spell cannot target players in the Wilderness", () => {
  const built = playerWithSceptre();
  const method = combatResolver.resolve(built.player);
  assert.equal(method.canAttack(built.player, { isPlayer: () => true }), true);
  const targetInWilderness = {
    isPlayer: () => true,
    getWildernessLevel: () => 1,
  };
  assert.equal(WildernessPlugin._test.canAttack(built.player, targetInWilderness, method), false);
  assert.equal(WarpedSceptre._test.charges(built.sceptre), 2, "area-denied attacks consume no charge");
  assert.equal(
    WildernessPlugin._test.canAttack(built.player, { isPlayer: () => true }, method),
    null,
    "the Wilderness area leaves non-Wilderness PvP to its normal rules"
  );
});

test("the equipment style and charge display use the powered-staff client interface", () => {
  const { readFileSync } = require("node:fs");
  const path = require("node:path");
  const gameplay = readFileSync(path.join(__dirname, "../data/definitions/item-gameplay.json"), "utf8");
  const styles = JSON.parse(readFileSync(path.join(__dirname, "../data/definitions/item-combat-styles.json"), "utf8"));
  for (const id of [ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_, ItemIdentifiers.WARPED_SCEPTRE]) {
    const definitionLine = gameplay.split("\n").find((line) => line.includes(`"id":${id},`));
    const definition = JSON.parse(
      definitionLine.slice(definitionLine.indexOf("{"), definitionLine.lastIndexOf("}") + 1)
    );
    assert.equal(definition.weaponInterface, "POWERED_STAFF");
  }
  assert.equal(styles.weaponInterfaces.POWERED_STAFF.interfaceId, 328);
  assert.equal(styles.weaponInterfaces.POWERED_STAFF.speed, 4);
  assert.deepEqual(styles.weaponInterfaces.POWERED_STAFF.fightTypes, [
    "POWERED_STAFF_ACCURATE",
    "POWERED_STAFF_ACCURATE_2",
    "POWERED_STAFF_LONGRANGE",
  ]);

  const built = playerWithSceptre({ charges: 17 });
  const sync = customEvents.get("equipment:changed");
  sync({ player: built.player });
  assert.equal(
    built.varbits.get(WarpedSceptre._test.CHARGES_WARPED_SCEPTRE_QUANTITY_VARBIT),
    17
  );
  built.player.getEquipment().getItems()[PluginManager.getCoreApi().Equipment.WEAPON_SLOT] =
    item(ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  loginHandler({ player: built.player });
  assert.equal(
    built.varbits.get(WarpedSceptre._test.CHARGES_WARPED_SCEPTRE_QUANTITY_VARBIT),
    0
  );
});

test("right-click Charge uses all affordable chaos and earth runes", () => {
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  const player = playerWithRunes({ chaos: 6, earth: 15 });
  const charge = itemActions.get("Warped sceptre (uncharged)").Charge;

  assert.equal(charge({ player, item: sceptre }), true);
  assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE);
  assert.equal(WarpedSceptre._test.charges(sceptre), 3);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 0);
  assert.equal(player.runeCount(ItemIdentifiers.EARTH_RUNE), 0);
  assert.match(player.messages[0], /add 3 charges/i);
});

test("right-click Charge reports the required runes when materials are insufficient", () => {
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  const player = playerWithRunes({ chaos: 1, earth: 4 });

  assert.equal(itemActions.get("Warped sceptre (uncharged)").Charge({ player, item: sceptre }), true);
  assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  assert.equal(WarpedSceptre._test.charges(sceptre), 0);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 1);
  assert.equal(player.runeCount(ItemIdentifiers.EARTH_RUNE), 4);
  assert.match(player.messages[0], /two chaos runes and five earth runes/i);
});

test("using either required rune on the sceptre triggers charging", () => {
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  const rune = item(ItemIdentifiers.EARTH_RUNE);
  const player = playerWithRunes({ chaos: 4, earth: 10 });
  const event = {
    player,
    usedItem: rune,
    usedWithItem: sceptre,
    usedItemId: rune.getId(),
    usedWithItemId: sceptre.getId(),
    handled: false,
  };

  itemOnItemHandler(event);
  assert.equal(event.handled, true);
  assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE);
  assert.equal(WarpedSceptre._test.charges(sceptre), 2);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 0);
  assert.equal(player.runeCount(ItemIdentifiers.EARTH_RUNE), 0);
});

test("Uncharge refunds the runes and restores the uncharged sceptre", () => {
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE);
  sceptre.setMetaValue("warped-sceptre", 3);
  const player = playerWithRunes({ chaos: 0, earth: 0 });

  assert.equal(itemActions.get("Warped sceptre").Uncharge({ player, item: sceptre }), true);
  assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  assert.equal(WarpedSceptre._test.charges(sceptre), 0);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 6);
  assert.equal(player.runeCount(ItemIdentifiers.EARTH_RUNE), 15);
});
