/**
 * Iban's staff charges (docs/ibans-staff.md): Iban Blast spends one charge on an NPC and two on a
 * player; the staff holds 120 charges, the upgraded staff 2,500. Other spells cost nothing.
 * https://oldschool.runescape.wiki/w/Iban%27s_staff, https://oldschool.runescape.wiki/w/Iban_Blast
 */
const CHARGES_META_KEY = "ibans-staff:charges";
const STAFF_CAPACITY = 120;
const UPGRADED_CAPACITY = 2500;
const NPC_CAST_COST = 1;
const PLAYER_CAST_COST = 2;
const STAFF_RECHARGE_COST = 100000;
const UPGRADED_RECHARGE_COST = 250000;
/** Dark Mage transcript steps (npc-dialogues.json, "Can you recharge my Staff of Iban?"). */
const FULLY_CHARGED_CONDITION_ID = "tD91in";
const CANNOT_AFFORD_CONDITION_ID = "hReddn";
const RECHARGE_PAYMENT_ACTION_ID = "LfIGD_";
const IBAN_BLAST_SPELL = "IBAN_BLAST";

let core;

/** Wiki (Iban's staff (o), Iban's staff (u) (o)): the ornament kit only changes the look. */
function isUpgraded(itemId) {
  return itemId === core.ItemIdentifiers.IBANS_STAFF_U_ || itemId === core.ItemIdentifiers.IBANS_STAFF_U_O_;
}

function capacityOf(itemId) {
  return isUpgraded(itemId) ? UPGRADED_CAPACITY : STAFF_CAPACITY;
}

function isStaffId(itemId) {
  return isUpgraded(itemId) || itemId === core.ItemIdentifiers.IBANS_STAFF || itemId === core.ItemIdentifiers.IBANS_STAFF_O_;
}

/** A staff with no saved count is full: quest rewards, shop stock and upgrades all hand it out that way. */
function chargesOf(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  const capacity = capacityOf(item.getId());
  return Number.isFinite(saved) ? Math.max(0, Math.min(capacity, Math.floor(saved))) : capacity;
}

function setCharges(item, charges) {
  item.setMetaValue(CHARGES_META_KEY, charges >= capacityOf(item.getId()) ? undefined : charges);
}

function wieldedStaff(player) {
  const weapon = player.getEquipment().get(core.Equipment.WEAPON_SLOT);
  return weapon && isStaffId(weapon.getId()) ? weapon : null;
}

function isIbanBlast(spell) {
  return spell === core.CombatSpells[IBAN_BLAST_SPELL];
}

function refuseEmptyStaff(event) {
  const { player, spell } = event;
  if (event.disabled !== null || !isIbanBlast(spell)) return;
  const staff = wieldedStaff(player);
  if (staff && chargesOf(staff) <= 0) {
    player.sendMessage("Your staff has no charges left.");
    event.disabled = true;
  }
}

function spendCharges({ player, spell }) {
  if (!isIbanBlast(spell)) return;
  const staff = wieldedStaff(player);
  if (!staff) return;
  const target = player.getCombat().getTarget();
  const cost = target?.isPlayer?.() ? PLAYER_CAST_COST : NPC_CAST_COST;
  setCharges(staff, Math.max(0, chargesOf(staff) - cost));
  player.getEquipment().refreshItems();
}

function checkCharges({ player, item }) {
  const charges = chargesOf(item);
  player.sendMessage(`Your staff has ${charges.toLocaleString("en-US")} charge${charges === 1 ? "" : "s"} left.`);
}

/** The staff the Dark Mage would recharge: one that is not full, the ordinary staff first. */
function rechargeableStaff(player) {
  const items = player.getInventory().getValidItems().filter((item) => isStaffId(item.getId()));
  items.sort((a, b) => Number(isUpgraded(a.getId())) - Number(isUpgraded(b.getId())));
  return items.find((item) => chargesOf(item) < capacityOf(item.getId())) ?? items[0] ?? null;
}

function rechargeCost(staff) {
  return isUpgraded(staff.getId()) ? UPGRADED_RECHARGE_COST : STAFF_RECHARGE_COST;
}

function coinsHeld(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS);
}

function isDarkMage(npcId) {
  return npcId === core.NpcIdentifiers.DARK_MAGE_2 || npcId === core.NpcIdentifiers.DARK_MAGE_3;
}

function rechargeCondition({ player, npcId, stepId }) {
  if (!isDarkMage(npcId)) return null;
  const staff = rechargeableStaff(player);
  if (!staff) return null;
  if (stepId === FULLY_CHARGED_CONDITION_ID) return chargesOf(staff) >= capacityOf(staff.getId());
  if (stepId === CANNOT_AFFORD_CONDITION_ID) return coinsHeld(player) < rechargeCost(staff);
  return null;
}

function rechargePayment(event) {
  const { player, npcId, stepId } = event;
  if (!isDarkMage(npcId) || stepId !== RECHARGE_PAYMENT_ACTION_ID || event.handled) return;
  event.handled = true;
  const staff = rechargeableStaff(player);
  const cost = staff ? rechargeCost(staff) : 0;
  if (!staff || chargesOf(staff) >= capacityOf(staff.getId()) || coinsHeld(player) < cost) return;
  player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, cost);
  setCharges(staff, capacityOf(staff.getId()));
  player.getInventory().refreshItems();
}

/** "item:fill-charges" { player, item, handled }: loadouts hand the staff out full. */
function fillCharges(event) {
  const { item } = event;
  if (!item || !isStaffId(item.getId())) return;
  setCharges(item, capacityOf(item.getId()));
  event.handled = true;
}

function initialize(coreApi) {
  core = coreApi;
}

module.exports = {
  name: "IbansStaff",
  description: "Charges Iban's staff (120, or 2,500 for the upgraded staff), spends charges on Iban Blast, and lets the Dark Mage recharge it for coins.",
  members: true,
  _test: { chargesOf, setCharges, rechargeCondition, rechargePayment, CHARGES_META_KEY },
  register(api) {
    api.onServerStartup(initialize.bind(null, api.core));
    api.onSpellDisabled(refuseEmptyStaff);
    api.onCustomEvent("magic:cast-committed", spendCharges);
    api.onItemAction("Iban's staff", { Check: checkCharges });
    api.onItemAction("Iban's staff (u)", { Check: checkCharges });
    api.onItemAction("Iban's staff (o)", { Check: checkCharges });
    api.onItemAction("Iban's staff (u) (o)", { Check: checkCharges });
    api.onNpcDialogueCondition(rechargeCondition);
    api.onCustomEvent("npc-dialogue:action", rechargePayment);
    api.onCustomEvent("item:fill-charges", fillCharges);
  },
};
