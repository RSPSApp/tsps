/**
 * The exposed altar at the summit of Ralos' Rise (Wiki, Exposed altar): Bless turns every jug of
 * wine or sunfire wine and every bone with a blessed form (bones.json `blessed`) in the inventory
 * into its blessed version at once, for no experience. It needs 30 Prayer, and superior dragon
 * bones their own 70 (their row's `level`). Noted bones are left alone.
 *
 * Recorded (rsprox 1104, 1141, 1157, 4054): human_lockedchest with sound 2674, each item swapped in
 * its own slot, then "You bless # jugs of wine on the altar." or "You bless # bones on the altar.";
 * nothing to bless gives a message box. The recordings never bless wine and bones together: doing
 * both, wine's line first, is ours.
 */
const Common = require("./Common.RalosRise");

const { DATA } = Common;

/** The inventory slots the altar blesses, by kind, and whether a bone was held back by its level. */
function blessings(player) {
  const { blessable } = Common.resolved();
  const level = Common.prayerLevel(player);
  const found = { wine: [], bones: [], held: 0 };
  player.getInventory().getItems().forEach((item, slot) => {
    const row = item && item.getId() >= 0 ? blessable.get(item.getId()) : undefined;
    if (!row) return;
    if (row.level > level) {
      found.held = Math.max(found.held, row.level);
      return;
    }
    (row.wine ? found.wine : found.bones).push({ slot, blessed: row.blessed, amount: item.getAmount() });
  });
  return found;
}

function bless({ player }) {
  const core = Common.core();
  if (Common.prayerLevel(player) < DATA.altar.level) {
    Common.messageBox(player, Common.text("altarLevel", { level: DATA.altar.level }));
    return true;
  }
  const found = blessings(player);
  if (found.wine.length === 0 && found.bones.length === 0) {
    Common.messageBox(player, found.held
      ? Common.text("superiorLevel", { level: found.held })
      : Common.text("nothingToBless"));
    return true;
  }
  const inventory = player.getInventory();
  for (const entry of [...found.wine, ...found.bones]) inventory.setItem(entry.slot, new core.Item(entry.blessed, entry.amount));
  inventory.refreshItems();
  player.performAnimation(new core.Animation(Common.resolved().seq.bless));
  player.getPacketSender().sendSound(DATA.altar.sound, 1, 0);
  const count = (entries) => entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (found.wine.length) player.sendMessage(Common.text("blessWine", { count: count(found.wine) }));
  if (found.bones.length) player.sendMessage(Common.text("blessBones", { count: count(found.bones) }));
  return true;
}

function attach(api) {
  api.onObjectInteraction("Exposed altar", { Bless: bless });
}

module.exports = { attach, bless, blessings };
