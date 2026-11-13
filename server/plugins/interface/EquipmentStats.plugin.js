
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { EquipPacketListener } = require("../../src/main/typescript/elvarg/net/packet/impl/EquipPacketListener");
const { examineItem } = require("../../src/main/typescript/elvarg/game/content/ExaminePrice");
const { WeaponProfiles } = require("../../src/main/typescript/elvarg/game/content/combat/WeaponProfile");

// OpenRune cache names: component.wornitems:equipment and interface.equipment.
const OPEN_EQUIPMENT_STATS_BUTTON = (387 << 16) | 1;
const EQUIPMENT_STATS_INTERFACE_ID = 84;
/** toplevel_sidebutton_switch: OSRS shows the inventory beside the stats, to equip from it. */
const SIDE_BUTTON_SWITCH_SCRIPT = 915;
const INVENTORY_TAB = 3;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const EQUIPMENT_SLOT_COMPONENTS = [
  Equipment.HEAD_SLOT,
  Equipment.CAPE_SLOT,
  Equipment.AMULET_SLOT,
  Equipment.WEAPON_SLOT,
  Equipment.BODY_SLOT,
  Equipment.SHIELD_SLOT,
  Equipment.LEG_SLOT,
  Equipment.HANDS_SLOT,
  Equipment.FEET_SLOT,
  Equipment.RING_SLOT,
  Equipment.AMMUNITION_SLOT,
].map((slot, index) => ({ component: (EQUIPMENT_STATS_INTERFACE_ID << 16) | (10 + index), slot }));
const EQUIPMENT_SLOT_BY_COMPONENT = new Map(
  EQUIPMENT_SLOT_COMPONENTS.map(({ component: buttonId, slot }) => [buttonId, slot]),
);

/** Equip Your Character's stat lines. */
const STATS_LAYOUT = {
  interfaceId: EQUIPMENT_STATS_INTERFACE_ID,
  attack: [24, 25, 26, 27, 28],
  defence: [30, 31, 32, 33, 34],
  other: [36, 37, 38, 39],
  undead: 41,
  slayer: 42,
  baseSpeed: 52,
  actualSpeed: 53,
  weight: 50,
};
/** bankmain. */
const BANK_INTERFACE_ID = 12;
/** The same lines in the bank's worn-items view, which draws its weight itself. */
const BANK_STATS_LAYOUT = {
  interfaceId: BANK_INTERFACE_ID,
  attack: [82, 83, 84, 85, 86],
  defence: [88, 89, 90, 91, 92],
  other: [94, 95, 96, 97],
  undead: 99,
  slayer: 100,
  baseSpeed: 116,
  actualSpeed: 117,
};
const ATTACK_LABELS = ["Stab", "Slash", "Crush", "Magic", "Range"];
const DEFENCE_LABELS = ["Stab", "Slash", "Crush", "Magic", "Range"];
const OTHER_LABELS = ["Melee STR", "Ranged STR", "Magic DMG", "Prayer"];
/**
 * The "Equipment effects" panel shows the text of enum 3047 for this varbit's value, a full
 * set's id (Guthan's 3, Void melee 10, ...), and its default line at 0.
 */
const SET_TEXT_VARBIT = "worn_items_set_text";
/** Full sets the panel names although no plugin applies their effect yet (see the file's notes). */
const DATA_SETS = require("./data/equipment-set-texts.json").sets.map((set) => ({
  text: set.text,
  pieces: set.pieces.map((names) => names.map((name) => name.toLowerCase())),
}));

const SALVE_AMULETS = new Map([
  [4081, { percent: 100 / 6, meleeOnly: true }],
  [10588, { percent: 20, meleeOnly: true }],
  [12017, { percent: 100 / 6, meleeOnly: false }],
  [12018, { percent: 20, meleeOnly: false }],
]);

let BonusManager;
let pluginApi;

function component(layout, childId) {
  return (layout.interfaceId << 16) | childId;
}

function formatSigned(value) {
  const number = Math.trunc(Number(value) || 0);
  return number < 0 ? `${number}` : `+${number}`;
}

function formatMagicDamage(value) {
  const number = Number(value) || 0;
  return `${number < 0 ? "" : "+"}${number.toFixed(1)}%`;
}

function formatPercent(value) {
  const percent = Math.round((Number(value) || 0) * 10) / 10;
  return Number.isInteger(percent) ? `${percent}` : percent.toFixed(1);
}

function formatTargetBonus(bonus) {
  if (!bonus) return "+0%";
  const status = bonus.active === undefined ? "" : bonus.active ? ", on task" : ", off task";
  if (bonus.imbued) {
    return `+${formatPercent(100 / 6)}% melee, +15% ranged/magic${status}`;
  }
  return `+${formatPercent(bonus.percent)}% (${bonus.meleeOnly ? "melee" : "all styles"}${status})`;
}

/** Asks Slayer whether the worn headwear's target is on the assignment. */
function slayerOnTask(player) {
  const target = player.getCombat?.()?.getTarget?.();
  if (!target?.isNpc?.() || typeof target.getAsNpc !== "function") return false;
  const request = { player, npc: target.getAsNpc(), onTask: false };
  pluginApi?.emitCustomEvent?.("slayer:on-task", request);
  return request.onTask === true;
}

function getTargetBonuses(player) {
  const equipment = player.getEquipment().getItems();
  const amuletId = equipment[Equipment.AMULET_SLOT]?.getId?.() ?? -1;
  const head = equipment[Equipment.HEAD_SLOT];
  const headName = head?.getId?.() > 0
    ? head.getDefinition().getName().toLowerCase()
    : "";
  const slayerItem = headName.includes("slayer helmet") || headName.includes("black mask");
  const imbued = headName.includes("(i)");

  return {
    undead: SALVE_AMULETS.get(amuletId),
    slayer: slayerItem
      ? { percent: 100 / 6, meleeOnly: !imbued, imbued, active: slayerOnTask(player) }
      : undefined,
  };
}

/**
 * Player owns the carried-weight rule (weightless stackables, plugin slot overrides such as
 * graceful), so the panel shows the same total the run-energy drain uses. Grams to kilograms.
 */
/** Whole kilograms, the fraction dropped toward zero (Wiki Weight: 9.979 kg shows 9 kg, -4.535 kg shows -4 kg). */
function getWeight(player) {
  return Math.trunc(player.getCarriedWeightGrams() / 1000) || 0;
}

/**
 * Set effects other plugins expose for the stats panel: text lines, and in `setTexts` the
 * enum 3047 id of each full set worn.
 */
function describeEffects(player) {
  const request = { player, lines: [], slotWeights: {}, setTexts: [] };
  pluginApi?.emitCustomEvent?.("equipment:effects", request);
  request.lines = request.lines.filter(
    (line) => typeof line === "string" && line.trim().length > 0,
  );
  return request;
}

/** Reports each full set from the data file, every piece matched by its exact cache name. */
function addDataSetTexts(request) {
  const items = request?.player?.getEquipment?.()?.getItems?.();
  if (!items || !Array.isArray(request.setTexts)) return;
  const worn = new Set(items
    .filter((item) => item?.getId?.() > 0)
    .map((item) => String(item.getDefinition?.()?.getName?.() ?? "").toLowerCase()));
  for (const set of DATA_SETS) {
    if (set.pieces.every((names) => names.some((name) => worn.has(name)))) request.setTexts.push(set.text);
  }
}

/** The worn set whose text the panel shows. Ours: with several full sets, the lowest id. */
function setText(player) {
  const ids = describeEffects(player).setTexts.filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? Math.min(...ids) : 0;
}

function sendSetText(player) {
  const varbit = pluginApi?.core?.CacheDefinitions?.getVarbitId?.(SET_TEXT_VARBIT);
  const sender = player?.getPacketSender?.();
  if (varbit == null || !sender) return;
  const value = setText(player);
  if (sender.getVarbit(varbit) !== value) sender.sendVarbit(varbit, value);
}

function render(player, layout = STATS_LAYOUT) {
  const sender = player.getPacketSender();
  const bonuses = player.getBonusManager();
  const attack = bonuses.getAttackBonus();
  const defence = bonuses.getDefenceBonus();
  const other = bonuses.getOtherBonus();
  const send = (text, childId) => sender.sendString(text, component(layout, childId));

  for (let i = 0; i < layout.attack.length; i++) {
    send(`${ATTACK_LABELS[i]}: ${formatSigned(attack[i])}`, layout.attack[i]);
    send(`${DEFENCE_LABELS[i]}: ${formatSigned(defence[i])}`, layout.defence[i]);
  }
  for (let i = 0; i < layout.other.length; i++) {
    const value = i === 2 ? formatMagicDamage(other[i]) : formatSigned(other[i]);
    send(`${OTHER_LABELS[i]}: ${value}`, layout.other[i]);
  }

  const target = getTargetBonuses(player);
  send(`Undead: ${formatTargetBonus(target.undead)}`, layout.undead);
  send(`Slayer: ${formatTargetBonus(target.slayer)}`, layout.slayer);

  const weapon = player.getWeapon?.();
  const fallbackSpeed = typeof weapon?.getSpeed === "function" ? weapon.getSpeed() : 4;
  const baseSpeed = WeaponProfiles.attackSpeed(player, fallbackSpeed);
  const actualSpeed = player.getBaseAttackSpeed();
  send(`Base: ${(baseSpeed * 0.6).toFixed(1)}s`, layout.baseSpeed);
  send(`Actual: ${(actualSpeed * 0.6).toFixed(1)}s`, layout.actualSpeed);

  if (layout.weight !== undefined) send(`${getWeight(player)} kg`, layout.weight);
}

/** Login sends the worn set too: the restored equipment does not go through a change. */
function onLogin({ player }) {
  sendSetText(player);
}

function onEquipmentChanged({ player }) {
  sendSetText(player);
  if (player?.getInterfaceId?.() === EQUIPMENT_STATS_INTERFACE_ID) {
    update(player);
  } else if (player?.getInterfaceId?.() === BANK_INTERFACE_ID) {
    updateBank(player);
  }
}

/**
 * The bank fills its worn-items view's stat lines whenever it is (re)drawn, and again as worn
 * items change. Text that hasn't changed since the last draw is not resent.
 */
function onBankRefreshed({ player }) {
  if (player?.getInterfaceId?.() === BANK_INTERFACE_ID) updateBank(player);
}

function updateBank(player) {
  BonusManager.update(player);
  render(player, BANK_STATS_LAYOUT);
}

function update(player) {
  BonusManager.update(player);
  render(player);
}

function open(player) {
  if (player.busy?.()) {
    player.getPacketSender().sendInterfaceRemoval();
  }

  player.setInterfaceId(EQUIPMENT_STATS_INTERFACE_ID);
  player.setAttribute(EquipPacketListener.PRESERVE_INTERFACE_ON_EQUIP_ATTRIBUTE, EQUIPMENT_STATS_INTERFACE_ID);
  player
    .getPacketSender()
    .sendVarbit(12393, 1)
    .sendSubInterface(MAIN_MODAL_TARGET_UID, EQUIPMENT_STATS_INTERFACE_ID, 0);
  player.getPacketSender().sendClientScript(SIDE_BUTTON_SWITCH_SCRIPT, INVENTORY_TAB);
  update(player);
  return true;
}

function handleItemAction({ player, buttonId, action }) {
  if (player.getInterfaceId?.() !== EQUIPMENT_STATS_INTERFACE_ID) return false;

  const equipmentSlot = EQUIPMENT_SLOT_BY_COMPONENT.get(buttonId);
  if (equipmentSlot === undefined) return false;
  const item = player.getEquipment().getItems()[equipmentSlot];
  if (!item || item.getId() <= 0) return true;
  if (action === 1) {
    EquipPacketListener.unequip(player, equipmentSlot);
  } else if (action === 10) {
    examineItem(player, item.getId(), item.getAmount());
  }
  return true;
}

module.exports = {
  name: "EquipmentStats",
  description: "Equipment stats screen opened from the worn-items tab, with the inventory beside it, so gear can be compared and swapped.",
  _test: { formatTargetBonus, getTargetBonuses, getWeight, describeEffects, setText, sendSetText, addDataSetTexts },
  register(api) {
    pluginApi = api;
    BonusManager = api.getBonusManager();
    api.onInterfaceActionButton(OPEN_EQUIPMENT_STATS_BUTTON, ({ player }) => open(player));
    api.onInterfaceActionButton([...EQUIPMENT_SLOT_BY_COMPONENT.keys()], handleItemAction);
    api.onPlayerProcess(({ player }) => {
      if (player.getInterfaceId?.() === EQUIPMENT_STATS_INTERFACE_ID) {
        update(player);
      }
    });
    api.onCustomEvent?.("equipment:changed", onEquipmentChanged);
    api.onCustomEvent?.("bank:refreshed", onBankRefreshed);
    api.onPlayerLogin?.(onLogin);
    api.onCustomEvent?.("equipment:effects", addDataSetTexts);
  },
};
