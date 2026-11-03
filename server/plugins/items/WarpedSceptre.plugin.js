// OSRS Wiki: https://oldschool.runescape.wiki/w/Warped_sceptre
const { definePoweredStaff } = require("./PoweredStaff");

const MAX_CHARGES = 20000;
const CHAOS_RUNES_PER_CHARGE = 2;
const EARTH_RUNES_PER_CHARGE = 5;
const CHARGES_META_KEY = "warped-sceptre";
const ATTACK_SPEED = 4; // Wiki combat stats: 25 casts per minute.
const ATTACK_RANGE = 7; // Wiki combat stats; Powered Staff Longrange adds two tiles.
const CAST_ANIMATION = 10500; // client gameval AnimationID.VFX_WARPED_SCEPTRE_CAST
const CAST_START_GRAPHIC = 2567; // client gameval SpotanimID.VFX_WARPED_SCEPTRE_CAST
const CAST_PROJECTILE_GRAPHIC = 2569; // client gameval SpotanimID.VFX_WARPED_SCEPTRE_PROJECTILE_PROJECTILE
const CAST_IMPACT_GRAPHIC = 2568; // client gameval SpotanimID.VFX_WARPED_SCEPTRE_PROJECTILE_IMPACT
const CHARGES_WARPED_SCEPTRE_QUANTITY_VARBIT = 16155; // client gameval VarbitID.CHARGES_WARPED_SCEPTRE_QUANTITY
const BUSY_VARBIT = 12393; // cache gameval busy
const MAGIC_LEVEL_REQUIRED = 62; // OSRS Wiki item page

let core = null;
let pluginApi;
let ItemIdentifiers = null;
let chargedIds = new Set();
let unchargedByCharged = new Map();
let chargedByUncharged = new Map();
let staff = null;
const chargingInterfaces = new WeakSet();
const chargeInputs = new WeakMap();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function weaponOf(player) {
  return player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] ?? null;
}

function syncWornCharges(player) {
  const weapon = weaponOf(player);
  const wornCharges = chargedIds.has(Number(weapon?.getId?.() ?? -1)) ? charges(weapon) : 0;
  player.getPacketSender().sendVarbit(CHARGES_WARPED_SCEPTRE_QUANTITY_VARBIT, wornCharges);
}

function wieldsSceptre(player, chargedOnly = false) {
  const id = Number(weaponOf(player)?.getId?.() ?? -1);
  return chargedIds.has(id) || (!chargedOnly && chargedByUncharged.has(id));
}

function baseMaxHit(player) {
  // Wiki formula: floor((8 * current Magic level + 96) / 37).
  const magic = player.getSkillManager().getCurrentLevel(core.Skill.MAGIC);
  return Math.floor((8 * magic + 96) / 37);
}

function look({ Animation, Graphic, GraphicHeight, Projectile }) {
  return {
    castAnimation: () => new Animation(CAST_ANIMATION),
    startGraphic: () => new Graphic(CAST_START_GRAPHIC, GraphicHeight.HIGH),
    castProjectile: (cast, castOn) =>
      Projectile.createProjectile(cast, castOn, CAST_PROJECTILE_GRAPHIC, 0, 20, 43, 31),
    endGraphic: () => new Graphic(CAST_IMPACT_GRAPHIC),
  };
}

function defineSceptre() {
  return definePoweredStaff(pluginApi, {
    name: "Warped sceptre",
    chargesKey: CHARGES_META_KEY,
    maxCharges: MAX_CHARGES,
    pairs: [...unchargedByCharged],
    maxHit: baseMaxHit,
    attackSpeed: ATTACK_SPEED,
    range: ATTACK_RANGE,
    levelRequired: MAGIC_LEVEL_REQUIRED,
    spell: look,
    // Its charge goes with the cast itself, not the attack check.
    useChargeAt: "start",
    chargeUsed: (player) => syncWornCharges(player),
    emptied: (player) => {
      refresh(player);
      syncWornCharges(player);
    },
    noChargesMessage: "Your warped sceptre has no charges! You need to charge it with chaos runes and earth runes.",
    ranOutMessage: "<col=ff3045>Your warped sceptre has run out of charges!</col>",
    methodFlags: { warpedSceptreBuiltInSpell: true },
  });
}

/** Spends a charge from the worn sceptre. */
function useCharge(player) {
  staff.useCharge(player);
}

function format(amount) {
  return amount.toLocaleString("en-US");
}

function markInterfaceBusy(player) {
  chargingInterfaces.add(player);
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
}

function closeChargingInterface({ player }) {
  if (!chargingInterfaces.delete(player)) return;
  const input = chargeInputs.get(player);
  if (input && player.getEnteredAmountAction() === input) player.getPacketSender().abortInputPrompt();
  chargeInputs.delete(player);
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

function itemStatement(player, item, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, item.getId(), text),
  ));
  markInterfaceBusy(player);
}

function checkCharges({ player, item }) {
  const amount = charges(item);
  player.sendMessage(`Your warped sceptre has ${format(amount)} charge${amount === 1 ? "" : "s"} remaining.`);
  return true;
}

function affordableCharges(player, sceptre) {
  const inventory = player.getInventory();
  return Math.min(
    Math.floor(inventory.getAmount(ItemIdentifiers.CHAOS_RUNE) / CHAOS_RUNES_PER_CHARGE),
    Math.floor(inventory.getAmount(ItemIdentifiers.EARTH_RUNE) / EARTH_RUNES_PER_CHARGE),
    MAX_CHARGES - charges(sceptre),
  );
}

function chargeSceptre(player, sceptre) {
  const inventory = player.getInventory();
  if (charges(sceptre) >= MAX_CHARGES) {
    player.sendMessage("Your warped sceptre is already fully charged.");
    return true;
  }
  const most = affordableCharges(player, sceptre);
  if (most <= 0) {
    player.sendMessage("You don't have enough runes to charge your warped sceptre. You need 2 chaos runes and 5 earth runes per charge.");
    return true;
  }
  const input = {
    acceptsZero: true,
    execute(amount) {
      // Answered, so there is no prompt left for closing to abort.
      player.setEnteredAmountAction(null);
      closeChargingInterface({ player });
      if (!inventory.getItems().includes(sceptre)) return;
      const current = charges(sceptre);
      const added = Math.min(Math.floor(Number(amount)), affordableCharges(player, sceptre));
      if (!(added > 0)) return;
      inventory.deleteNumber(ItemIdentifiers.CHAOS_RUNE, added * CHAOS_RUNES_PER_CHARGE);
      inventory.deleteNumber(ItemIdentifiers.EARTH_RUNE, added * EARTH_RUNES_PER_CHARGE);
      if (chargedByUncharged.has(sceptre.getId())) {
        sceptre.setId(chargedByUncharged.get(sceptre.getId()));
      }
      sceptre.setMetaValue(CHARGES_META_KEY, current + added);
      refresh(player);
      syncWornCharges(player);
      itemStatement(player, sceptre, current > 0
        ? `You add an additional ${format(added)} charge${added === 1 ? "" : "s"} to your warped sceptre. It now has ${format(current + added)} charges in total.`
        : `You add ${format(added)} charge${added === 1 ? "" : "s"} to your warped sceptre.`);
    },
  };
  player.setEnteredAmountAction(input);
  chargeInputs.set(player, input);
  player.getPacketSender().sendEnterAmountPrompt(`How many charges do you want to add? (0 - ${format(most)})`);
  markInterfaceBusy(player);
  return true;
}

function chargeOption(event) {
  const { player, item } = event;
  if (!item || !(chargedIds.has(item.getId()) || chargedByUncharged.has(item.getId()))) {
    return false;
  }
  return chargeSceptre(player, item);
}

function chargeWithRunes(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const sceptre = chargedIds.has(usedItemId) || chargedByUncharged.has(usedItemId)
    ? usedItem
    : chargedIds.has(usedWithItemId) || chargedByUncharged.has(usedWithItemId)
      ? usedWithItem
      : null;
  const otherItemId = sceptre === usedItem ? usedWithItemId : usedItemId;
  if (!sceptre || ![ItemIdentifiers.CHAOS_RUNE, ItemIdentifiers.EARTH_RUNE].includes(otherItemId)) {
    return;
  }
  event.handled = chargeSceptre(player, sceptre);
}

function hasRefundSpace(player) {
  const inventory = player.getInventory();
  const neededSlots =
    (inventory.contains(ItemIdentifiers.CHAOS_RUNE) ? 0 : 1) +
    (inventory.contains(ItemIdentifiers.EARTH_RUNE) ? 0 : 1);
  if (inventory.getFreeSlots() >= neededSlots) return true;
  player.sendMessage("You don't have enough inventory space for the runes gained from uncharging your warped sceptre.");
  return false;
}

function refundCharges(player, item) {
  const inventory = player.getInventory();
  const amount = charges(item);
  if (!inventory.getItems().includes(item) || amount <= 0 || !hasRefundSpace(player)) return;
  inventory.addItem(new core.Item(ItemIdentifiers.CHAOS_RUNE, amount * CHAOS_RUNES_PER_CHARGE));
  inventory.addItem(new core.Item(ItemIdentifiers.EARTH_RUNE, amount * EARTH_RUNES_PER_CHARGE));
  item.setId(unchargedByCharged.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  syncWornCharges(player);
  itemStatement(player, item, `You uncharge your warped sceptre, regaining ${format(amount * CHAOS_RUNES_PER_CHARGE)} chaos runes and ${format(amount * EARTH_RUNES_PER_CHARGE)} earth runes in the process.`);
}

function uncharge({ player, item }) {
  if (charges(item) <= 0 || !hasRefundSpace(player)) return true;
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        closeChargingInterface({ player });
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) refundCharges(player, item);
      },
    }, "Yes.", "No.").setTitle("Fully uncharge your warped sceptre?"),
  ));
  markInterfaceBusy(player);
  return true;
}

function canEquip(event) {
  if (!chargedByUncharged.has(event.item.getId())) return;
  event.allow = false;
  event.player.sendMessage("Your warped sceptre must be charged with runes before it can be used. You need 2 chaos runes and 5 earth runes per charge.");
}

function equipmentChanged({ player }) {
  syncWornCharges(player);
}

function initialize(coreApi) {
  core = coreApi;
  ItemIdentifiers = core.ItemIdentifiers;
  const I = ItemIdentifiers;
  chargedIds = new Set([I.WARPED_SCEPTRE, I.WARPED_SCEPTRE_2]);
  unchargedByCharged = new Map([
    [I.WARPED_SCEPTRE, I.WARPED_SCEPTRE_UNCHARGED_],
    [I.WARPED_SCEPTRE_2, I.WARPED_SCEPTRE_UNCHARGED__2],
  ]);
  chargedByUncharged = new Map([
    [I.WARPED_SCEPTRE_UNCHARGED_, I.WARPED_SCEPTRE],
    [I.WARPED_SCEPTRE_UNCHARGED__2, I.WARPED_SCEPTRE_2],
  ]);
  staff = defineSceptre();
}

function resolveSceptre(attacker) {
  return staff?.resolver.resolve(attacker) ?? null;
}

module.exports = {
  name: "WarpedSceptre",
  members: true,
  _test: {
    charges,
    useCharge,
    checkCharges,
    chargeSceptre,
    chargeWithRunes,
    chargeOption,
    uncharge,
    baseMaxHit,
    resolveSceptre,
    MAX_CHARGES,
    ATTACK_SPEED,
    ATTACK_RANGE,
    CHARGES_META_KEY,
    CHARGES_WARPED_SCEPTRE_QUANTITY_VARBIT,
    syncWornCharges,
  },
  register(api) {
    pluginApi = api;
    api.onServerStartup(initialize.bind(null, api.core));
    api.onCanEquip(canEquip);
    // Named actions resolve the inventory option from the item definition.
    api.onItemAction("Warped sceptre", {
      Check: checkCharges,
      Uncharge: uncharge,
      Charge: chargeOption,
    });
    api.onItemAction("Warped sceptre (uncharged)", {
      Charge: chargeOption,
    });
    api.onItemOnItem(chargeWithRunes, { noted: false });
    api.onCustomEvent("equipment:changed", equipmentChanged);
    api.onPlayerLogin(equipmentChanged);
    api.onCustomEvent("player:world-input", closeChargingInterface);
    api.onCustomEvent("interface:close", closeChargingInterface);
    api.onCustomEvent("interface:closed", closeChargingInterface);
    api.onPlayerLogout(closeChargingInterface);
    api.registerCombatMethodResolver({ resolve: resolveSceptre });
  },
};
