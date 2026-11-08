/**
 * The amulet of avarice and Forinthry surge (Wiki: Revenant Caves, Revenant maledictus):
 *
 * - Worn in the caves, the amulet adds 20% accuracy and damage against revenants. Worn anywhere,
 *   it keeps its wearer skulled, and the skull lasts 20 minutes after it comes off (Wiki: Amulet
 *   of avarice, Skull (status)).
 * - Forinthry surge, from killing the maledictus with the amulet on, adds another 15% for 30
 *   minutes while the amulet is worn. Applied one after the other here (the Wiki doesn't say
 *   how they combine), and without the surge's own skull icon, which isn't identified yet.
 */
const { REVENANT_IDS, MALEDICTUS_ID: MALEDICTUS, ITEMS, inCaves } = require("./Data.Revenants");

const AMULET_SLOT = 2;
const SURGE_ATTRIBUTE = "revenants:forinthry-surge-until";
const SURGE_MS = 30 * 60_000;

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

/** Whether the amulet's bonus applies: worn, in the caves, against a revenant. */
function applies(player) {
  const target = player?.getCombat?.()?.getTarget?.();
  const id = target?.isNpc?.() ? target.getAsNpc().getId() : -1;
  return Boolean(player) && wearsAvarice(player) && inCaves(player.getLocation()) && (REVENANT_IDS.includes(id) || id === MALEDICTUS);
}

/** Accuracy and damage x1.2 with the amulet against a revenant in the caves, x1.15 more with surge. */
function boost(entity, value) {
  const player = asPlayer(entity);
  if (!applies(player)) {
    return value;
  }
  let boosted = Math.floor((value * 6) / 5);
  if (surgeActive(player)) boosted = Math.floor((boosted * 23) / 20);
  return boosted;
}

/** Skulled while the amulet is worn, for 20 minutes after it comes off. */
function keepSkulled({ player }) {
  if (!wearsAvarice(player)) return;
  const { CombatFactory, SkullType } = core;
  if (player.isSkulled()) CombatFactory.extendSkull(player, CombatFactory.ITEM_SKULL_SECONDS);
  else CombatFactory.skull(player, SkullType.WHITE_SKULL, CombatFactory.ITEM_SKULL_SECONDS);
}

module.exports = function attachAvarice(api) {
  core = api.core;
  api.persistAttribute(SURGE_ATTRIBUTE);
  for (const style of ["Melee", "Ranged", "Magic"]) {
    api[`register${style}AttackAccuracyModifier`](boost);
    api[`register${style}HitModifier`](boost);
  }
  api.onPlayerProcess(keepSkulled);
  // Wiki (Amulet of avarice): "The effects of the amulet do not stack with the Slayer helmet (i)": like a salve, it
  // stands in for the helmet's on-task bonus against revenants.
  api.onCustomEvent("slayer-helmet:superseded", (query) => { if (applies(query.player)) query.superseded = true; });
};

Object.assign(module.exports, { applies, grant, boost, keepSkulled, wearsAvarice, surgeActive, SURGE_ATTRIBUTE });
