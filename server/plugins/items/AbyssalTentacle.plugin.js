/**
 * Abyssal tentacle (https://oldschool.runescape.wiki/w/Abyssal_tentacle).
 *
 * A successful normal hit has a 25% chance to poison the target for 4 damage
 * (regular poison, not venom). CombatPoisonData deliberately omits the
 * tentacle, so the roll lives here rather than in core.
 */
const POISON_CHANCE = 0.25;
const POISON_SEVERITY = 4;
const POISON_ORB_TYPE = 1;

let core = null;
let api = null;
let tentacleIds = new Set();

function combine({ player, usedItem, usedWithItem, usedItemSlot, usedWithItemSlot }) {
  const I = core.ItemIdentifiers;
  const whipFirst = usedItem.getId() === I.ABYSSAL_WHIP;
  const whip = whipFirst ? usedItem : usedWithItem;
  const tentacle = whipFirst ? usedWithItem : usedItem;
  const whipSlot = whipFirst ? usedItemSlot : usedWithItemSlot;
  const tentacleSlot = whipFirst ? usedWithItemSlot : usedItemSlot;
  // The cache also names quest and placeholder variants "Abyssal whip".
  if (whip.getId() !== I.ABYSSAL_WHIP || tentacle.getId() !== I.KRAKEN_TENTACLE) return false;

  api.sendMultiChatboxPrompt(player, "This is irreversible and makes the whip untradeable. Combine?",
    "Yes, create an abyssal tentacle.", () => {
      const inventory = player.getInventory();
      if (inventory.getItems()[whipSlot] !== whip || inventory.getItems()[tentacleSlot] !== tentacle ||
        whip.getId() !== I.ABYSSAL_WHIP || tentacle.getId() !== I.KRAKEN_TENTACLE ||
        whip.getAmount() !== 1 || tentacle.getAmount() !== 1) return;
      inventory.deleteAtSlot(tentacleSlot, 1, false);
      whip.setId(I.ABYSSAL_TENTACLE);
      inventory.refreshItems();
      player.sendMessage("You attach the kraken tentacle to your abyssal whip.");
    },
    "No, keep them separate.", () => {});
}

function wieldedTentacle(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  return weapon && tentacleIds.has(weapon.getId()) ? weapon : null;
}

function onHitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !target || !hit?.isAccurate?.() || !(hit?.getTotalDamage?.() > 0)) {
    return;
  }
  const player = attacker.getAsPlayer();
  if (!wieldedTentacle(player)) {
    return;
  }
  if (Math.random() >= POISON_CHANCE) {
    return;
  }
  core.CombatFactory.poisonEntity(target, POISON_SEVERITY, POISON_ORB_TYPE);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  tentacleIds = new Set([
    core.ItemIdentifiers.ABYSSAL_TENTACLE,
    core.ItemIdentifiers.ABYSSAL_TENTACLE_OR_,
  ]);
}

module.exports = {
  name: "AbyssalTentacle",
  members: true,
  register(api) {
    api.onServerStartup(attach.bind(null, api));
    api.onItemOnItem("Kraken tentacle", "Abyssal whip", combine, { noted: false });
    api.onCombatHitResolved(onHitResolved);
  },
  _test: { onHitResolved, POISON_CHANCE, POISON_SEVERITY },
};
