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
let canEquipHandler;
WarpedSceptre.register({
    emitCustomEvent: () => {},
  core: PluginManager.getCoreApi(),
  onServerStartup: (handler) => handler(),
  onPlayerLogout() {},
  onCanEquip: (handler) => { canEquipHandler = handler; },
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

function playerWithRunes({ chaos = 2, earth = 5, freeSlots = 28 } = {}) {
  const runes = new Map([
    [ItemIdentifiers.CHAOS_RUNE, chaos],
    [ItemIdentifiers.EARTH_RUNE, earth],
  ]);
  const equipmentItems = new Array(14).fill(null);
  const varbits = new Map();
  const messages = [];
  const items = [];
  const state = { amountAction: null, prompt: null, dialogue: null, aborts: 0 };
  return {
    items, state,
    getEnteredAmountAction: () => state.amountAction,
    setEnteredAmountAction: (action) => { state.amountAction = action; },
    getDialogueManager: () => ({ startDialogues: (builder) => { state.dialogue = builder.getDialogues().get(0); } }),
    messages,
    getInventory: () => ({
      getItems: () => [...items, ...[...runes].filter(([, amount]) => amount > 0).map(([id, amount]) => item(id, amount))],
      getAddableAmount: (rune) => ((runes.get(rune.getId()) ?? 0) > 0 || freeSlots > 0 ? rune.getAmount() : 0),
      getAmount: (id) => runes.get(id) ?? 0,
      deleteNumber: (id, amount) => runes.set(id, Math.max(0, (runes.get(id) ?? 0) - amount)),
      contains: (id) => (runes.get(id) ?? 0) > 0,
      getFreeSlots: () => freeSlots,
      addItem: (rune) => runes.set(rune.getId(), (runes.get(rune.getId()) ?? 0) + rune.getAmount()),
      refreshItems() {},
    }),
    getEquipment: () => ({ getItems: () => equipmentItems, refreshItems() {} }),
    getPacketSender: () => ({
      sendVarbit: (id, value) => varbits.set(id, value),
      sendEnterAmountPrompt: (title) => { state.prompt = title; },
      abortInputPrompt: () => { state.aborts++; state.amountAction = null; },
      sendInterfaceRemoval() {},
    }),
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
  // Its impact: `sound_area id=1460 range=10` at the target in 51 casts (capture 1885).
  assert.equal(built.state.castSpell.impactSound()?.getId(), 1460);
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
  assert.equal(built.state.messages.at(-1), "<col=ff3045>Your warped sceptre has run out of charges!</col>");
  assert.equal(method.canAttack(built.player, { isPlayer: () => false }), false);
  assert.equal(built.state.messages.at(-1), "Your warped sceptre has no charges! You need to charge it with chaos runes and earth runes.");
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

test("right-click Charge waits for a quantity before spending runes (capture 3899)", () => {
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  const player = playerWithRunes({ chaos: 6, earth: 15 });
  player.items.push(sceptre);
  const charge = itemActions.get("Warped sceptre (uncharged)").Charge;

  assert.equal(charge({ player, item: sceptre }), true);
  assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 6);
  assert.equal(player.state.prompt, "How many charges do you want to add? (0 - 3)");
  player.state.amountAction.execute(3);
  assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE);
  assert.equal(WarpedSceptre._test.charges(sceptre), 3);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 0);
  assert.equal(player.runeCount(ItemIdentifiers.EARTH_RUNE), 0);
  assert.equal(player.state.dialogue.getText(), "You add 3 charges to your warped sceptre.");
  assert.equal(player.state.dialogue.getItemId(), ItemIdentifiers.WARPED_SCEPTRE);
});

test("right-click Charge reports the required runes when materials are insufficient", () => {
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  const player = playerWithRunes({ chaos: 1, earth: 4 });

  assert.equal(itemActions.get("Warped sceptre (uncharged)").Charge({ player, item: sceptre }), true);
  assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  assert.equal(WarpedSceptre._test.charges(sceptre), 0);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 1);
  assert.equal(player.runeCount(ItemIdentifiers.EARTH_RUNE), 4);
  assert.equal(player.messages[0], "You don't have enough runes to charge your warped sceptre. You need 2 chaos runes and 5 earth runes per charge.");
});

test("either required rune in either item-use order opens the shared quantity prompt", () => {
  for (const runeId of [ItemIdentifiers.EARTH_RUNE, ItemIdentifiers.CHAOS_RUNE]) {
    for (const runeFirst of [true, false]) {
      const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
      const rune = item(runeId);
      const player = playerWithRunes({ chaos: 4, earth: 10 });
      player.items.push(sceptre);
      const usedItem = runeFirst ? rune : sceptre;
      const usedWithItem = runeFirst ? sceptre : rune;
      const event = {
        player, usedItem, usedWithItem,
        usedItemId: usedItem.getId(), usedWithItemId: usedWithItem.getId(),
        handled: false,
      };
      itemOnItemHandler(event);
      assert.equal(event.handled, true);
      assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
      assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 4);
      player.state.amountAction.execute(2);
      assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE);
      assert.equal(WarpedSceptre._test.charges(sceptre), 2);
      assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 0);
      assert.equal(player.runeCount(ItemIdentifiers.EARTH_RUNE), 0);
    }
  }
});

test("Uncharge requires Yes before refunding runes (capture 3899)", () => {
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE);
  sceptre.setMetaValue("warped-sceptre", 3);
  const player = playerWithRunes({ chaos: 0, earth: 0 });

  player.items.push(sceptre);
  assert.equal(itemActions.get("Warped sceptre").Uncharge({ player, item: sceptre }), true);
  assert.equal(WarpedSceptre._test.charges(sceptre), 3);
  assert.equal(player.state.dialogue.getTitle(), "Fully uncharge your warped sceptre?");
  assert.deepEqual(player.state.dialogue.getOptions(), ["Yes.", "No."]);
  player.state.dialogue.execute(1);
  assert.equal(sceptre.getId(), ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  assert.equal(WarpedSceptre._test.charges(sceptre), 0);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 6);
  assert.equal(player.runeCount(ItemIdentifiers.EARTH_RUNE), 15);
});

function openCharge({ current = 0, chaos = 20, earth = 50 } = {}) {
  const sceptre = item(current ? ItemIdentifiers.WARPED_SCEPTRE : ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  if (current) sceptre.setMetaValue("warped-sceptre", current);
  const player = playerWithRunes({ chaos, earth });
  player.items.push(sceptre);
  itemActions.get(current ? "Warped sceptre" : "Warped sceptre (uncharged)").Charge({ player, item: sceptre });
  return { sceptre, player };
}

test("partial charge, top-up feedback, zero and excessive quantities (capture 3899)", () => {
  const { sceptre, player } = openCharge();
  player.state.amountAction.execute(1);
  assert.equal(WarpedSceptre._test.charges(sceptre), 1);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 18);
  assert.equal(player.state.dialogue.getText(), "You add 1 charge to your warped sceptre.");
  itemActions.get("Warped sceptre").Charge({ player, item: sceptre });
  player.state.amountAction.execute(0);
  assert.equal(WarpedSceptre._test.charges(sceptre), 1);
  itemActions.get("Warped sceptre").Charge({ player, item: sceptre });
  player.state.amountAction.execute(2);
  assert.equal(WarpedSceptre._test.charges(sceptre), 3);
  assert.equal(player.state.dialogue.getText(), "You add an additional 2 charges to your warped sceptre. It now has 3 charges in total.");
  itemActions.get("Warped sceptre").Charge({ player, item: sceptre });
  player.state.amountAction.execute(100);
  assert.equal(WarpedSceptre._test.charges(sceptre), 10);
});

test("charging clamps to remaining capacity and rechecks runes and item ownership", () => {
  let { sceptre, player } = openCharge({ current: 19999 });
  assert.equal(player.state.prompt, "How many charges do you want to add? (0 - 1)");
  player.state.amountAction.execute(10);
  assert.equal(WarpedSceptre._test.charges(sceptre), 20000);
  ({ sceptre, player } = openCharge());
  player.getInventory().deleteNumber(ItemIdentifiers.EARTH_RUNE, 45);
  player.state.amountAction.execute(10);
  assert.equal(WarpedSceptre._test.charges(sceptre), 1);
  ({ sceptre, player } = openCharge());
  player.items.length = 0;
  player.state.amountAction.execute(10);
  assert.equal(WarpedSceptre._test.charges(sceptre), 0);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 20);
});

test("uncharging No preserves charges and Yes shows the captured item message", () => {
  const { sceptre, player } = openCharge();
  player.state.amountAction.execute(3);
  itemActions.get("Warped sceptre").Uncharge({ player, item: sceptre });
  player.state.dialogue.execute(2);
  assert.equal(WarpedSceptre._test.charges(sceptre), 3);
  itemActions.get("Warped sceptre").Uncharge({ player, item: sceptre });
  player.state.dialogue.execute(1);
  assert.equal(player.state.dialogue.getText(), "You uncharge your warped sceptre, regaining 6 chaos runes and 15 earth runes in the process.");
  assert.equal(player.state.dialogue.getItemId(), ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 20);
});

test("full inventory uncharge refusal matches capture 3899 and rechecks at confirmation", () => {
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE);
  sceptre.setMetaValue("warped-sceptre", 3);
  const player = playerWithRunes({ chaos: 0, earth: 0, freeSlots: 1 });
  player.items.push(sceptre);
  itemActions.get("Warped sceptre").Uncharge({ player, item: sceptre });
  assert.equal(player.state.dialogue, null);
  assert.equal(player.messages.at(-1), "You don't have enough inventory space for the runes gained from uncharging your warped sceptre.");
  assert.equal(WarpedSceptre._test.charges(sceptre), 3);
  const other = openCharge({ current: 3 });
  itemActions.get("Warped sceptre").Uncharge({ player: other.player, item: other.sceptre });
  other.player.items.length = 0;
  other.player.state.dialogue.execute(1);
  assert.equal(WarpedSceptre._test.charges(other.sceptre), 3);
  const late = playerWithRunes({ chaos: 0, earth: 0, freeSlots: 2 });
  late.items.push(sceptre);
  itemActions.get("Warped sceptre").Uncharge({ player: late, item: sceptre });
  late.getInventory = () => ({ getItems: () => late.items, contains: () => false, getFreeSlots: () => 0 });
  late.state.dialogue.execute(1);
  assert.equal(WarpedSceptre._test.charges(sceptre), 3);
  assert.match(late.messages.at(-1), /enough inventory space/);
});

test("uncharged sceptres cannot be wielded and Check uses remaining singular/plural (captures 13/3899)", () => {
  const player = playerWithRunes();
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_);
  const event = { player, item: sceptre, allow: null };
  canEquipHandler(event);
  assert.equal(event.allow, false);
  assert.equal(player.messages.at(-1), "Your warped sceptre must be charged with runes before it can be used. You need 2 chaos runes and 5 earth runes per charge.");
  sceptre.setId(ItemIdentifiers.WARPED_SCEPTRE);
  sceptre.setMetaValue("warped-sceptre", 1);
  itemActions.get("Warped sceptre").Check({ player, item: sceptre });
  assert.equal(player.messages.at(-1), "Your warped sceptre has 1 charge remaining.");
  sceptre.setMetaValue("warped-sceptre", 1234);
  itemActions.get("Warped sceptre").Check({ player, item: sceptre });
  assert.equal(player.messages.at(-1), "Your warped sceptre has 1,234 charges remaining.");
  const charged = { player, item: sceptre, allow: null };
  canEquipHandler(charged);
  assert.equal(charged.allow, null);
});

test("busy varbit follows prompts and results and clears on cancellation (capture 3899)", () => {
  const { sceptre, player } = openCharge();
  assert.equal(player.varbits.get(12393), 1);
  player.state.amountAction.execute(0);
  assert.equal(player.varbits.get(12393), 0);
  itemActions.get("Warped sceptre (uncharged)").Charge({ player, item: sceptre });
  player.state.amountAction.execute(2);
  assert.equal(player.varbits.get(12393), 1);
  customEvents.get("interface:closed")({ player });
  assert.equal(player.varbits.get(12393), 0);
  itemActions.get("Warped sceptre").Charge({ player, item: sceptre });
  customEvents.get("player:world-input")({ player });
  assert.equal(player.varbits.get(12393), 0);
  assert.equal(player.state.amountAction, null);
  itemActions.get("Warped sceptre").Uncharge({ player, item: sceptre });
  assert.equal(player.varbits.get(12393), 1);
  customEvents.get("interface:close")({ player });
  assert.equal(player.varbits.get(12393), 0);
});

test("walking away aborts the charge prompt; answering it does not", () => {
  const { sceptre, player } = openCharge();
  player.state.amountAction.execute(0);
  assert.equal(player.state.aborts, 0);
  itemActions.get("Warped sceptre (uncharged)").Charge({ player, item: sceptre });
  customEvents.get("player:world-input")({ player });
  assert.equal(player.state.aborts, 1);
  assert.equal(player.state.amountAction, null);
  assert.equal(player.varbits.get(12393), 0);
});

test("uncharging into existing rune stacks needs no free slots", () => {
  const sceptre = item(ItemIdentifiers.WARPED_SCEPTRE);
  sceptre.setMetaValue("warped-sceptre", 3);
  const player = playerWithRunes({ chaos: 1, earth: 1, freeSlots: 0 });
  player.items.push(sceptre);
  itemActions.get("Warped sceptre").Uncharge({ player, item: sceptre });
  player.state.dialogue.execute(1);
  assert.equal(WarpedSceptre._test.charges(sceptre), 0);
  assert.equal(player.runeCount(ItemIdentifiers.CHAOS_RUNE), 7);
  assert.equal(player.runeCount(ItemIdentifiers.EARTH_RUNE), 16);
});
