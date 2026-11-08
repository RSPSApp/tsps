/**
 * Cape of skulls (https://oldschool.runescape.wiki/w/Cape_of_skulls): putting it on skulls the
 * player for the next 20 minutes, after a warning that it will. Even while the cape is worn the
 * skull wears off after that; putting it on again, or hopping worlds with it on, skulls the player
 * again. Facts: docs/skulling.md.
 */
let core;

/** Whether each player wore the cape at their last equipment change. */
const wornCape = new WeakMap();

/** Players whose "Yes" is equipping the cape right now, so the warning lets it through. */
const confirmed = new WeakSet();

function wearsCape(player) {
  const { Equipment, ItemIdentifiers } = core;
  return Number(player.getEquipment().get(Equipment.CAPE_SLOT)?.getId?.()) === ItemIdentifiers.CAPE_OF_SKULLS;
}

function skull(player) {
  const { CombatFactory, SkullType } = core;
  if (player.isSkulled()) CombatFactory.extendSkull(player, CombatFactory.ITEM_SKULL_SECONDS);
  else CombatFactory.skull(player, SkullType.WHITE_SKULL, CombatFactory.ITEM_SKULL_SECONDS);
}

/** "Yes": puts the cape on if the player is still alive and still holds it; it skulls on wear. */
function wearConfirmed(player) {
  const { EquipPacketListener, Inventory, ItemIdentifiers } = core;
  player.getPacketSender().sendInterfaceRemoval();
  const slot = player.getInventory().getSlotForItemId(ItemIdentifiers.CAPE_OF_SKULLS);
  if (slot < 0 || player.getHitpoints() <= 0) return;
  confirmed.add(player);
  try {
    EquipPacketListener.equip(player, ItemIdentifiers.CAPE_OF_SKULLS, slot, Inventory.INTERFACE_ID);
  } finally {
    confirmed.delete(player);
  }
}

/**
 * Putting the cape on (not swapping one worn cape of skulls for another) asks first: equipping
 * waits for "Yes", and "No" leaves equipment and skull as they were. Message wording unverified.
 */
function warnBeforeWear(event) {
  const { player, slot, item } = event;
  const { DialogueChainBuilder, Equipment, ItemIdentifiers, OptionDialogue, StatementDialogue } = core;
  if (slot !== Equipment.CAPE_SLOT || Number(item?.getId?.()) !== ItemIdentifiers.CAPE_OF_SKULLS) return;
  if (confirmed.has(player) || wearsCape(player)) return;
  event.allow = false;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, "Wearing the cape of skulls will skull you for 20 minutes."),
    new OptionDialogue(1, {
      executeOption(option) {
        if (Number(option) === 1) wearConfirmed(player);
        else player.getPacketSender().sendInterfaceRemoval();
      },
    }, "Yes.", "No.").setTitle("Wear the cape of skulls?"),
  ));
}

/** The cape just put on skulls its wearer. */
function skullOnWear({ player }) {
  const worn = wearsCape(player);
  const previous = wornCape.get(player);
  wornCape.set(player, worn);
  if (previous === false && worn) skull(player);
}

/** Logging in (or hopping) with the cape on skulls the player again. */
function skullOnLogin({ player }) {
  const worn = wearsCape(player);
  wornCape.set(player, worn);
  if (worn) skull(player);
}

module.exports = {
  name: "CapeOfSkulls",
  description: "Cape of skulls: warns before you wear it, then skulls the player for 20 minutes, again on re-equip or login.",
  members: true,
  _test: { skullOnWear, skullOnLogin, warnBeforeWear },
  register(api) {
    core = api.core;
    api.onCanEquip(warnBeforeWear);
    api.onCustomEvent("equipment:changed", skullOnWear);
    api.onPlayerLogin(skullOnLogin);
  },
};
