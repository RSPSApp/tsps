"use strict";

/**
 * The Fractured Archive's reward items that do something when used (docs/fractured-archive.md).
 *
 * Horn of Bran (https://oldschool.runescape.wiki/w/Horn_of_Bran; options Inspect and Drop): entering
 * Camelot Castle with it unlocks the Zeal prayer for good (varbit prayer_zeal_unlocked), without the
 * Wiki's cutscene. Zeal itself is core's PrayerData.ZEAL: Prayer 84,
 * Attack 75, Strength 75 and, from the cache's unlock table (dbrow 17168), Defence 70.
 *
 * Archivist's folio (https://oldschool.runescape.wiki/w/Archivist%27s_folio): Read teleports to
 * the lobby, Charge/ascension shards add 5 charges each, Check says how many. Out of charges it
 * is the inert folio. The Wiki gives no cap or wilderness limit: *estimates* of no cap and 20.
 */

const ZEAL_UNLOCKED_ATTRIBUTE = "prayer:zeal-unlocked";
/** Item meta: the folio counts its own charges. */
const FOLIO_CHARGES_META = "fractured-archive:folio-charges";
const ZEAL_UNLOCKED_VARBIT = 16578;
const ZEAL_ATTACK = 75;
const ZEAL_STRENGTH = 75;
const ZEAL_DEFENCE = 70;
const CHARGES_PER_SHARD = 5;
const WILDERNESS_LIMIT = 20;
// Estimate: the castle's walls around King Arthur (2764,3515).
const CAMELOT = { minX: 2745, maxX: 2776, minY: 3489, maxY: 3524 };
const LOBBY = { x: 4127, y: 5508, z: 0 };

let core = null;
const folioReplacements = new WeakMap();

const plural = (count) => `${count} charge${count === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- Zeal

function syncZeal({ player }) {
  player.getPacketSender().sendVarbit(ZEAL_UNLOCKED_VARBIT, player.getAttribute(ZEAL_UNLOCKED_ATTRIBUTE) === true ? 1 : 0);
}

/** Wiki transcript: the horn's Inspect points the player at Camelot. */
function inspectHorn({ player }) {
  player.sendMessage("You inspect the horn-like item...");
  player.sendMessage("You notice a small symbol, similar to the one you've seen the Knights of the Round Table wear.");
}

/** Wiki: "Upon entering Camelot, a cutscene begins" - the cutscene is not built, a message stands in. */
function enterCamelot(mobile) {
  const player = mobile.isPlayer?.() ? mobile.getAsPlayer() : null;
  const inventory = player?.getInventory();
  if (!inventory?.contains(core.ItemIdentifiers.HORN_OF_BRAN) || player.getAttribute(ZEAL_UNLOCKED_ATTRIBUTE) === true) return;
  // Estimate: the Wiki doesn't say whether the (tradeable) horn is used up.
  inventory.deleteNumber(core.ItemIdentifiers.HORN_OF_BRAN, 1);
  player.setAttribute(ZEAL_UNLOCKED_ATTRIBUTE, true);
  syncZeal({ player });
  player.sendMessage("You present the Horn of Bran to King Arthur. You have unlocked the Zeal prayer.");
}

function createCamelotArea(api) {
  const { Area, Boundary } = api.core;
  class CamelotCastle extends Area {
    getName() {
      return "Camelot Castle";
    }

    postEnter(mobile) {
      enterCamelot(mobile);
    }
  }
  return new CamelotCastle([new Boundary(CAMELOT.minX, CAMELOT.maxX, CAMELOT.minY, CAMELOT.maxY, 0)]);
}

function zealRequirements(event) {
  if (event.prayer !== core.PrayerData.ZEAL) return;
  const skills = event.player.getSkillManager();
  const { Skill } = core;
  if (event.player.getAttribute(ZEAL_UNLOCKED_ATTRIBUTE) !== true) {
    event.message = "You have not unlocked that prayer.";
  } else if (skills.getMaxLevel(Skill.ATTACK) < ZEAL_ATTACK || skills.getMaxLevel(Skill.STRENGTH) < ZEAL_STRENGTH
    || skills.getMaxLevel(Skill.DEFENCE) < ZEAL_DEFENCE) {
    event.message = `You need ${ZEAL_ATTACK} Attack, ${ZEAL_STRENGTH} Strength and ${ZEAL_DEFENCE} Defence to use Zeal.`;
  } else {
    return;
  }
  event.disabled = true;
}

// ---------------------------------------------------------------- the folio

const itemCharges = (item) => Number(item?.getMetaValue?.(FOLIO_CHARGES_META)) || 0;

/** The slot now holding this folio, following replacements made when its charges change. */
function slotOf(player, item) {
  const items = player.getInventory().getItems();
  let current = item;
  while (folioReplacements.has(current)) current = folioReplacements.get(current);
  return items.indexOf(current);
}

/** Puts `count` charges on the folio in `slot`: the charged folio carries them, none is the inert one. */
function setCharges(player, slot, count) {
  const { Item, ItemIdentifiers } = core;
  const folio = new Item(count > 0 ? ItemIdentifiers.ARCHIVISTS_FOLIO : ItemIdentifiers.ARCHIVISTS_FOLIO_INERT_, 1);
  if (count > 0) folio.setMetaValue(FOLIO_CHARGES_META, count);
  const previous = player.getInventory().getItems()[slot];
  if (previous) folioReplacements.set(previous, folio);
  player.getInventory().setItem(slot, folio);
  player.getInventory().refreshItems();
}

function checkFolio({ player, item }) {
  const count = itemCharges(item);
  player.sendMessage(count > 0
    ? `Your folio has ${plural(count)} left.`
    : "Your folio has no charges. It can be charged with ascension shards.");
}

function readFolio({ player, item }) {
  if (itemCharges(item) <= 0) {
    checkFolio({ player, item });
    return;
  }
  const target = new core.Location(LOBBY.x, LOBBY.y, LOBBY.z);
  if (!core.TeleportHandler.checkReqs(player, target, WILDERNESS_LIMIT)) return;
  core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false, () => {
    const slot = slotOf(player, item);
    if (slot < 0) return;
    const left = itemCharges(player.getInventory().getItems()[slot]) - 1;
    setCharges(player, slot, left);
    player.sendMessage(`Your folio has ${plural(Math.max(0, left))} left.`);
  });
}

function chargeFolio({ player, item }) {
  const inventory = player.getInventory();
  const shards = inventory.getAmount(core.ItemIdentifiers.ASCENSION_SHARDS);
  if (shards <= 0) {
    player.sendMessage("You need ascension shards to charge the folio.");
    return;
  }
  const slot = slotOf(player, item);
  if (slot < 0) return;
  inventory.deleteNumber(core.ItemIdentifiers.ASCENSION_SHARDS, shards);
  const count = itemCharges(item) + shards * CHARGES_PER_SHARD;
  setCharges(player, slot, count);
  player.sendMessage(`Your folio has ${plural(count)} left.`);
}

function chargeWithShards({ player, usedItemId, usedItem, usedWithItem }) {
  chargeFolio({ player, item: usedItemId === core.ItemIdentifiers.ASCENSION_SHARDS ? usedWithItem : usedItem });
}

module.exports = function registerFracturedArchiveRewards(api) {
  core = api.core;
  api.persistAttribute(ZEAL_UNLOCKED_ATTRIBUTE, false);
  api.onPlayerLogin(syncZeal);
  api.onPrayerDisabled(zealRequirements);
  api.onItemAction("Horn of Bran", { Inspect: inspectHorn });
  api.registerArea(createCamelotArea(api));
  for (const folio of ["Archivist's folio", "Archivist's folio (inert)"]) {
    api.onItemAction(folio, { Read: readFolio, Charge: chargeFolio, Check: checkFolio });
    api.onItemOnItem("Ascension shards", folio, chargeWithShards);
  }
};
module.exports._test = { zealRequirements, readFolio, chargeFolio, enterCamelot, inspectHorn, chargeWithShards };
