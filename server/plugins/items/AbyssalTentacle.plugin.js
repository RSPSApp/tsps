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
let pluginApi = null;
let tentacleIds = new Set();

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
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  core.WeaponInterfaceManager.assign(player);
}

function useCharge(player, tentacle) {
  // Content may spare the charge (a league relic): the question every charged weapon asks.
  const consume = { player, itemId: tentacle.getId(), skip: false };
  pluginApi.emitCustomEvent("combat:melee-charge", consume);
  pluginApi.emitCustomEvent("combat:consume-charge", consume);
  if (consume.skip) return;
  const left = charges(tentacle) - 1;
  if (left > 0) {
    tentacle.setMetaValue(CHARGES_META_KEY, left);
    return;
  }
  degrade(player, tentacle);
}

function wieldedTentacle(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  return weapon && tentacleIds.has(weapon.getId()) ? weapon : null;
}

function onHitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !target || hit?.getCombatType?.() !== core.CombatType.MELEE) {
    return;
  }
  const player = attacker.getAsPlayer();
  const tentacle = wieldedTentacle(player);
  if (!tentacle) {
    return;
  }
  useCharge(player, tentacle);
  if (!hit.isAccurate() || !(hit.getTotalDamage() > 0)) {
    return;
  }
  if (Math.random() >= POISON_CHANCE) {
    return;
  }
  core.CombatFactory.poisonEntity(target, POISON_SEVERITY, POISON_ORB_TYPE);
}

function attach(api) {
  pluginApi = api;
  core = api.core;
  tentacleIds = new Set([
    core.ItemIdentifiers.ABYSSAL_TENTACLE,
    core.ItemIdentifiers.ABYSSAL_TENTACLE_OR_,
  ]);
}

module.exports = {
  name: "AbyssalTentacle",
  members: true,
  register(api) {
    attach(api);
    api.onCombatHitResolved(onHitResolved);
    api.onItemAction("Abyssal tentacle", { Check: check });
    api.onItemAction("Abyssal tentacle (or)", { Check: check });
  },
  _test: { onHitResolved, charges, check, POISON_CHANCE, POISON_SEVERITY, MAX_CHARGES },
};
