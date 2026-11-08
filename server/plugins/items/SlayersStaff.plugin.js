/**
 * Magic Dart and the Slayer's staff (e) (docs/magic-dart.md).
 * https://oldschool.runescape.wiki/w/Magic_Dart, https://oldschool.runescape.wiki/w/Slayer%27s_staff_(e),
 * https://oldschool.runescape.wiki/w/Slayer%27s_enchantment
 *
 * Magic Dart needs 55 Slayer and a Slayer's staff, Slayer's staff (e), Staff of the dead, Toxic staff
 * of the dead, Staff of light or Staff of balance wielded. Its maximum hit is floor(Magic / 10) + 10,
 * or floor(Magic / 6) + 13 from a Slayer's staff (e) against the player's assigned monster, where each
 * hit spends one of the staff's 2,500 charges. A used-up staff reverts to a Slayer's staff, and a
 * Slayer's enchantment used on a Slayer's staff makes a fresh one.
 */
const CHARGES_META_KEY = "slayers-staff:charges";
const ENCHANTED_CAPACITY = 2500;
const DART_SLAYER_LEVEL = 55;
const DART_BASE_MAX_HIT = 10;
const DART_MAGIC_DIVISOR = 10;
const ENCHANTED_BASE_MAX_HIT = 13;
const ENCHANTED_MAGIC_DIVISOR = 6;
const CHARGE_PER_HIT = 1;
/** Weapon names (lowercase) that cast Magic Dart, matched as the whole name or before " (". */
const DART_STAFF_NAMES = [
  "slayer's staff", "staff of the dead", "toxic staff of the dead", "staff of light", "staff of balance",
];

let core;
let api;

function weaponOf(player) {
  return player.getEquipment().get(core.Equipment.WEAPON_SLOT);
}

function isDart(spell) {
  return spell === core.CombatSpells.MAGIC_DART;
}

function isEnchanted(item) {
  return item?.getId?.() === core.ItemIdentifiers.SLAYERS_STAFF_E_;
}

function castsDart(weapon) {
  const name = String(weapon?.getDefinition?.()?.getName?.() ?? "").toLowerCase();
  return DART_STAFF_NAMES.some((staff) => name === staff || name.startsWith(`${staff} (`));
}

/** An enchanted staff with no saved count is full: a fresh enchantment gives it all 2,500. */
function chargesOf(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(ENCHANTED_CAPACITY, Math.floor(saved))) : ENCHANTED_CAPACITY;
}

function setCharges(item, charges) {
  item.setMetaValue(CHARGES_META_KEY, charges >= ENCHANTED_CAPACITY ? undefined : charges);
}

function onTask(player, npc) {
  if (!npc?.isNpc?.()) return false;
  const request = { player, npc: npc.getAsNpc ? npc.getAsNpc() : npc, onTask: false };
  api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

function refuseDart(event) {
  const { player, spell } = event;
  if (event.disabled !== null || !isDart(spell)) return;
  if (!castsDart(weaponOf(player))) {
    player.sendMessage("You do not have the required equipment to cast this spell.");
    event.disabled = true;
  } else if (player.getSkillManager().getCurrentLevel(core.Skill.SLAYER) < DART_SLAYER_LEVEL) {
    player.sendMessage(`You need a Slayer level of ${DART_SLAYER_LEVEL} to cast this spell.`);
    event.disabled = true;
  }
}

function dartMaximum(request) {
  const { attacker, spell, target } = request;
  if (!isDart(spell) || !attacker?.isPlayer?.()) return;
  const player = attacker.getAsPlayer();
  const magic = player.getSkillManager().getCurrentLevel(core.Skill.MAGIC);
  const staff = weaponOf(player);
  request.maxHit = isEnchanted(staff) && onTask(player, target)
    ? ENCHANTED_BASE_MAX_HIT + Math.floor(magic / ENCHANTED_MAGIC_DIVISOR)
    : DART_BASE_MAX_HIT + Math.floor(magic / DART_MAGIC_DIVISOR);
}

/** Each hit on the assigned monster spends a charge; a spent staff reverts to a Slayer's staff. */
function spendCharge({ attacker, target, spell }) {
  if (!isDart(spell) || !attacker?.isPlayer?.()) return;
  const player = attacker.getAsPlayer();
  const staff = weaponOf(player);
  if (!isEnchanted(staff) || !onTask(player, target)) return;
  const left = Math.max(0, chargesOf(staff) - CHARGE_PER_HIT);
  if (left > 0) {
    setCharges(staff, left);
  } else {
    player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.SLAYERS_STAFF));
    core.BonusManager.update(player);
  }
  player.getEquipment().refreshItems();
}

function enchant(event) {
  const { player } = event;
  const I = core.ItemIdentifiers;
  const staffSlot = event.usedItemId === I.SLAYERS_STAFF ? event.usedItemSlot : event.usedWithItemSlot;
  const inventory = player.getInventory();
  if (inventory.get(staffSlot)?.getId?.() !== I.SLAYERS_STAFF) return;
  event.handled = true;
  const enchantmentSlot = staffSlot === event.usedItemSlot ? event.usedWithItemSlot : event.usedItemSlot;
  inventory.deleteAtSlot(enchantmentSlot, 1);
  inventory.setItem(staffSlot, new core.Item(I.SLAYERS_STAFF_E_, 1));
  inventory.refreshItems();
}

module.exports = {
  name: "SlayersStaff",
  members: true,
  _test: { refuseDart, dartMaximum, spendCharge, enchant, chargesOf, setCharges, castsDart, CHARGES_META_KEY },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onSpellDisabled(refuseDart);
    api.onCustomEvent("combat:magic-base-max-hit", dartMaximum);
    api.onCustomEvent("magic:hit-effects-applied", spendCharge);
    api.onItemOnItem("Slayer's enchantment", "Slayer's staff", enchant, { noted: false });
  },
};
