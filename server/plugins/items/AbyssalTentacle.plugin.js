/**
 * Abyssal tentacle (https://oldschool.runescape.wiki/w/Abyssal_tentacle).
 *
 * A successful normal hit has a 25% chance to poison the target for 4 damage
 * (regular poison, not venom). CombatPoisonData deliberately omits the
 * tentacle, so the roll lives here rather than in core.
 *
 * Every attack, hit or miss, uses one of its 10,000 charges; at none it becomes the kraken
 * tentacle in the same slot, and an (or) tentacle gives its kit back (Wiki). Check message
 * from rsprox captures (docs/dragonfire-shield.md).
 */
const POISON_CHANCE = 0.25;
const POISON_SEVERITY = 4;
const POISON_ORB_TYPE = 1;
const CHARGES_META_KEY = "abyssal-tentacle";
const MAX_CHARGES = 10000;

let core = null;
let api = null;
let tentacleIds = new Set();
/** Player -> the tentacle whose last charge their current swing spent. */
const spent = new WeakMap();
/** Hits rolled while a tentacle was wielded: the poison follows the hit, not the weapon at impact. */
const tentacleHits = new WeakSet();

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

function dissolve({ player, item, itemId, slot, interfaceId }) {
  // shortcut: ornamented Dissolve needs verified kit-refund rules before sharing this route.
  if (itemId !== core.ItemIdentifiers.ABYSSAL_TENTACLE || interfaceId === core.Equipment.INVENTORY_INTERFACE_ID) return false;
  const inventory = player.getInventory();
  if (inventory.getItems()[slot] !== item || item.getId() !== itemId || item.getAmount() !== 1) return false;

  api.sendMultiChatboxPrompt(player, "This will dissolve your whip immediately. The whip will be permanently lost.",
    "Yes, dissolve the whip.", () => {
      if (inventory.getItems()[slot] !== item || item.getId() !== itemId || item.getAmount() !== 1) return;
      item.setId(core.ItemIdentifiers.KRAKEN_TENTACLE);
      inventory.refreshItems();
    },
    "No, keep it.", () => {});
}

/** A tentacle with no saved count (spawned, or from before charges were tracked) is full. */
function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : MAX_CHARGES;
}

function check({ player, item }) {
  player.sendMessage(`Your abyssal tentacle can perform ${charges(item).toLocaleString("en-US")} more attacks.`);
  return true;
}

function degrade(player, tentacle) {
  const { Item, ItemIdentifiers } = core;
  const ornamented = tentacle.getId() === ItemIdentifiers.ABYSSAL_TENTACLE_OR_;
  tentacle.setId(ItemIdentifiers.KRAKEN_TENTACLE);
  tentacle.setMetaValue(CHARGES_META_KEY, undefined);
  if (ornamented) {
    player.getInventory().forceAdd(player, new Item(ItemIdentifiers.SHATTERED_RELICS_VARIETY_ORNAMENT_KIT, 1));
  }
  player.getEquipment().refreshItems();
  core.BonusManager.update(player);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  core.WeaponInterfaceManager.assign(player);
}

function useCharge(player, tentacle) {
  // Content may spare the charge (a league relic): the question every charged weapon asks.
  const consume = { player, itemId: tentacle.getId(), skip: false };
  api.emitCustomEvent("combat:melee-charge", consume);
  api.emitCustomEvent("combat:consume-charge", consume);
  if (consume.skip) return;
  const left = Math.max(0, charges(tentacle) - 1);
  tentacle.setMetaValue(CHARGES_META_KEY, left);
  if (left === 0) {
    // The swing still uses the tentacle's style, animation and special; it degrades after.
    spent.set(player, tentacle);
  }
}

function wieldedTentacle(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  return weapon && tentacleIds.has(weapon.getId()) ? weapon : null;
}

/** The last charge's swing is over: the tentacle it spent becomes the kraken tentacle. */
function onAttackFinished({ attacker }) {
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  const tentacle = player ? spent.get(player) : null;
  if (!tentacle) {
    return;
  }
  spent.delete(player);
  if (tentacleIds.has(tentacle.getId()) && charges(tentacle) === 0) {
    degrade(player, tentacle);
  }
}

/**
 * The charge goes when the swing is made, from the tentacle that made it: a hit later dropped
 * (the target died first) or a weapon swapped before impact still used it.
 */
function onAttackStarted({ attacker, method }) {
  if (!attacker?.isPlayer?.() || method?.type?.() !== core.CombatType.MELEE) {
    return;
  }
  const player = attacker.getAsPlayer();
  const tentacle = wieldedTentacle(player);
  if (tentacle) {
    useCharge(player, tentacle);
  }
}

function onHitDamage({ attacker, combatType, hit }) {
  if (attacker?.isPlayer?.() && combatType === core.CombatType.MELEE && hit && wieldedTentacle(attacker.getAsPlayer())) {
    tentacleHits.add(hit);
  }
}

function onHitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !target || hit?.getCombatType?.() !== core.CombatType.MELEE) {
    return;
  }
  if (!hit.isAccurate() || !(hit.getTotalDamage() > 0)) {
    return;
  }
  if (!tentacleHits.has(hit)) {
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
    api.onItemAction("Abyssal tentacle", { Check: check, Dissolve: dissolve });
    api.onCustomEvent("combat:attack-started", onAttackStarted);
    api.onCustomEvent("combat:attack-finished", onAttackFinished);
    api.onCombatHitDamage(onHitDamage);
    api.onCombatHitResolved(onHitResolved);
    api.onItemAction("Abyssal tentacle (or)", { Check: check });
  },
  _test: { onAttackStarted, onAttackFinished, onHitDamage, onHitResolved, charges, check, POISON_CHANCE, POISON_SEVERITY, MAX_CHARGES },
};
