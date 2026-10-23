// OSRS Wiki: Goblin_mail. Wear is a real cache action (BODY slot), but only
// the Land of the Goblins transformation makes this armour fit the player.
// Cache gameval: lotg_player_is_a_goblin, varbit 13612.
const GOBLIN_FORM_VARBIT = 13612;
const GOBLIN_MAIL_NAME = /^(?:(?:orange|blue|red|black|yellow|green|purple|pink|white) )?goblin mail$/i;

function canWearGoblinMail(event) {
  if (!GOBLIN_MAIL_NAME.test(event.item.getDefinition().getName())) return;
  if (event.player.getPacketSender().getVarbit(GOBLIN_FORM_VARBIT) === 1) return;
  event.allow = false;
  event.player.sendMessage("This armour is too small for you. It was made for a goblin.");
}

function repairHumanGoblinMail(core, { player }) {
  if (player.getPacketSender().getVarbit(GOBLIN_FORM_VARBIT) === 1) return;
  const item = player.getEquipment().get(core.Equipment.BODY_SLOT);
  if (!GOBLIN_MAIL_NAME.test(item.getDefinition().getName())) return;
  // Keep an existing invalid item safe: the ordinary unequip path only runs
  // when it can put the item in the bag. Never destroy it or drop it on login.
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("Make an inventory space to remove the goblin mail; it is too small for you.");
    return;
  }
  core.EquipPacketListener.unequip(player, core.Equipment.BODY_SLOT);
}

module.exports = {
  name: "GoblinMail",
  register(api) {
    api.onCanEquip(canWearGoblinMail);
    api.onCustomEvent("player:bootstrap-complete", repairHumanGoblinMail.bind(null, api.core));
    api.onCustomEvent("equipment:changed", repairHumanGoblinMail.bind(null, api.core));
  },
};
