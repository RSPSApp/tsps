/**
 * Silver dust for Guthix balance potions (https://oldschool.runescape.wiki/w/Silver_dust):
 * a silver bar used on the Ectofuntus bone grinder is ground into silver dust. The Wiki gives
 * no experience for it. The grinder's own bone round (Grinder.Ectofuntus.js) ignores anything
 * that is not a bone, so this only takes silver bars. The chat line is not captured.
 */
const Common = require("./Common.Herblore");

let data = null;

function ids() {
  if (data) return data;
  const I = Common.core.ItemIdentifiers;
  const O = Common.core.ObjectIdentifiers;
  return (data = {
    silverBar: I.SILVER_BAR,
    silverDust: I.SILVER_DUST,
    grinders: new Set([O.BONE_GRINDER, O.LOADER]),
    animation: "ahoy_bone_dump",
    sound: 1133,
  });
}

function grindSilver({ player, objectId, itemId }) {
  const table = ids();
  if (itemId !== table.silverBar || !table.grinders.has(objectId)) return false;
  const inventory = player.getInventory();
  if (!inventory.contains(table.silverBar)) return true;
  inventory.deleteNumber(table.silverBar, 1);
  inventory.addItem(new Common.core.Item(table.silverDust, 1));
  Common.animate(player, table.animation);
  Common.sound(player, table.sound);
  Common.spam(player, "You grind the silver bar into dust.");
  return true;
}

module.exports = function attach(api) {
  api.onItemOnObject(grindSilver, { noted: false });
};

module.exports._test = { ids, grindSilver };
