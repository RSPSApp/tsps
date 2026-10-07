/**
 * Crystal halberd charges (https://oldschool.runescape.wiki/w/Crystal_halberd).
 *
 * Created with 2,500 charges, one spent per successful hit, and reverts to its
 * inactive form at zero. Crystal shards add 100 charges each up to a 20,000
 * cap, even while the halberd is inactive. The Sweep special attack counts as
 * one hit for degradation however many targets it strikes (Wiki: Crystal
 * halberd (historical), Degrading).
 */
const START_CHARGES = 2500;
const MAX_CHARGES = 20000;
const SHARD_CHARGES = 100;
const CHARGES_META_KEY = "crystal-halberd";
const LAST_CHARGE_CYCLE_ATTRIBUTE = "crystal-halberd:last-charge-cycle";

let core = null;
let inactiveByActive = new Map();
let activeByInactive = new Map();
let chargedIds = new Set();

/**
 * Active -> inactive id pairs. The Gauntlet halberds (23895-23897) never
 * degrade, and the pre-2019 staged halberds (13080-13101) encoded their
 * charges in the item id and were removed in 2019, so neither has a pair here.
 */
function buildIdMaps(I) {
  return new Map([
    [I.CRYSTAL_HALBERD, I.CRYSTAL_HALBERD_INACTIVE_],
    [I.CRYSTAL_HALBERD_3, I.CRYSTAL_HALBERD_INACTIVE_],
  ]);
}

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY)?.charges);
  if (Number.isFinite(saved)) {
    return Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved)));
  }
  return chargedIds.has(item?.getId?.()) ? START_CHARGES : 0;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function useCharge(player, item) {
  const current = charges(item);
  if (current <= 0) {
    return;
  }
  const left = current - 1;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, { charges: left });
    return;
  }
  item.setId(inactiveByActive.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("Your crystal halberd has run out of charges.");
}

function wieldedCharged(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  return weapon && chargedIds.has(weapon.getId()) ? weapon : null;
}

function onHitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !target || !hit?.isAccurate?.() || !(hit?.getTotalDamage?.() > 0)) {
    return;
  }
  const player = attacker.getAsPlayer();
  const halberd = wieldedCharged(player);
  if (!halberd) {
    return;
  }
  // Sweep can resolve one hit per target; the wiki counts the whole special as
  // one hit, so charge at most once per game tick.
  // ponytail: tick throttle assumes every Sweep hit resolves in one cycle; if
  // targeting ever spreads them, track the swing id instead.
  const cycle = core.World?.getProcessCycle?.();
  if (cycle !== undefined) {
    if (player.getAttribute?.(LAST_CHARGE_CYCLE_ATTRIBUTE) === cycle) {
      return;
    }
    player.setAttribute?.(LAST_CHARGE_CYCLE_ATTRIBUTE, cycle);
  }
  useCharge(player, halberd);
}

function checkCharges({ player, item }) {
  const left = charges(item);
  player.sendMessage(`Your crystal halberd has ${left.toLocaleString("en-US")} charge${left === 1 ? "" : "s"} left.`);
}

function addShardCharges(event) {
  const { player } = event;
  const halberd = [event.usedItem, event.usedWithItem].find((candidate) => {
    const id = candidate?.getId?.();
    return chargedIds.has(id) || activeByInactive.has(id);
  });
  if (!halberd) {
    return;
  }
  const shardCount = player.getInventory().getAmount(core.ItemIdentifiers.CRYSTAL_SHARD);
  if (shardCount <= 0) {
    return;
  }
  const left = charges(halberd);
  if (left >= MAX_CHARGES) {
    player.sendMessage("Your crystal halberd cannot hold any more charges.");
    event.handled = true;
    return;
  }
  const shards = Math.min(shardCount, Math.ceil((MAX_CHARGES - left) / SHARD_CHARGES));
  player.getInventory().deleteNumber(core.ItemIdentifiers.CRYSTAL_SHARD, shards);
  if (activeByInactive.has(halberd.getId())) {
    halberd.setId(activeByInactive.get(halberd.getId()));
  }
  halberd.setMetaValue(CHARGES_META_KEY, { charges: Math.min(MAX_CHARGES, left + shards * SHARD_CHARGES) });
  refresh(player);
  player.sendMessage(`You add ${shards} crystal shard${shards === 1 ? "" : "s"} to the halberd.`);
  event.handled = true;
}

function attach(pluginApi) {
  core = pluginApi.core;
  inactiveByActive = buildIdMaps(core.ItemIdentifiers);
  activeByInactive = new Map();
  for (const [active, inactive] of inactiveByActive) {
    if (!activeByInactive.has(inactive)) {
      activeByInactive.set(inactive, active);
    }
  }
  chargedIds = new Set(inactiveByActive.keys());

  pluginApi.onItemAction("Crystal halberd", { Check: checkCharges });
  pluginApi.onItemAction("Crystal halberd (inactive)", { Check: checkCharges });
  pluginApi.onItemOnItem(addShardCharges, { noted: false });
  pluginApi.onCombatHitResolved(onHitResolved);
}

module.exports = {
  name: "CrystalHalberd",
  members: true,
  attach,
  register(api) {
    attach(api);
  },
  charges,
  useCharge,
  START_CHARGES,
  MAX_CHARGES,
  SHARD_CHARGES,
  _test: { buildIdMaps, charges, useCharge, addShardCharges, checkCharges, onHitResolved },
};
