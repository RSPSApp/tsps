/**
 * The amulet of avarice and Forinthry surge (Wiki: Revenant Caves, Revenant maledictus):
 *
 * - Worn in the caves, the amulet adds 20% accuracy and damage against revenants, and keeps its
 *   wearer skulled.
 * - Forinthry surge, from killing the maledictus with the amulet on, adds another 15% for 30
 *   minutes while the amulet is worn. Applied one after the other here (the Wiki doesn't say
 *   how they combine), and without the surge's own skull icon, which isn't identified yet.
 */
const { REVENANT_IDS, MALEDICTUS_ID: MALEDICTUS, ITEMS, inCaves } = require("./Data.Revenants");

const AMULET_SLOT = 2;
const SURGE_ATTRIBUTE = "revenants:forinthry-surge-until";
const SURGE_MS = 30 * 60_000;
const SKULL_REFRESH_TICKS = 100;

let core = null;

function asPlayer(entity) {
  return entity?.isPlayer?.() ? entity.getAsPlayer() : null;
}

function wearsAvarice(player) {
  return player?.getEquipment?.()?.getItems?.()[AMULET_SLOT]?.getId?.() === ITEMS.AMULET_OF_AVARICE;
}

function surgeActive(player) {
  return Date.now() < Number(player?.getAttribute?.(SURGE_ATTRIBUTE) ?? 0);
}

function grant(player) {
  if (!wearsAvarice(player)) return;
  player.setAttribute(SURGE_ATTRIBUTE, Date.now() + SURGE_MS);
  player.sendMessage("<col=ef1020>You are empowered by the Forinthry surge.");
}

/** Accuracy and damage x1.2 with the amulet against a revenant in the caves, x1.15 more with surge. */
function boost(entity, value) {
  const player = asPlayer(entity);
  const target = player?.getCombat?.()?.getTarget?.();
  const id = target?.isNpc?.() ? target.getAsNpc().getId() : -1;
  if (!wearsAvarice(player) || !inCaves(player.getLocation()) || (!REVENANT_IDS.includes(id) && id !== MALEDICTUS)) {
    return value;
  }
  let boosted = Math.floor((value * 6) / 5);
  if (surgeActive(player)) boosted = Math.floor((boosted * 23) / 20);
  return boosted;
}

/** Permanently skulled while the amulet is worn (Wiki). */
function keepSkulled({ player }) {
  if (!wearsAvarice(player) || player.getSkullTimer() > SKULL_REFRESH_TICKS) return;
  core.CombatFactory.skull(player, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
}

module.exports = function attachAvarice(api) {
  core = api.core;
  api.persistAttribute(SURGE_ATTRIBUTE);
  for (const style of ["Melee", "Ranged", "Magic"]) {
    api[`register${style}AttackAccuracyModifier`](boost);
    api[`register${style}HitModifier`](boost);
  }
  api.onPlayerProcess(keepSkulled);
};

Object.assign(module.exports, { grant, boost, wearsAvarice, surgeActive, SURGE_ATTRIBUTE });
