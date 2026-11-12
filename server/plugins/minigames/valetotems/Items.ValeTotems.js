"use strict";

/**
 * Two Vale offerings loots: Bale of flax (Unpack) and Dirty arrowtips (Clean).
 *
 * RSProx capture 20261109T224258-5ab63b4 (rev 242), ticks 848-914: Unpack takes one bale from
 * the stack and fills 25 empty slots with unnoted flax, with "You unpack a bale of flax." and no
 * sound or animation. With fewer than 25 empty slots: "You need at least 25 empty spaces to
 * unpack the flax.".
 *
 * Dirty arrowtips, RSProx cleaning-arrowtips (rev 242, Fletching 59): Clean turns one dirty
 * arrowtip into one arrowhead at a time, on the click's tick, with no animation or xp. It stops at
 * the first arrowhead with no room, silently (ticks 48 and 64: 27 -> 26 for a steel arrowhead
 * with one free slot; 26 -> 20 for 4 steel, an adamant and a mithril with two). A clean that
 * gets through says "You clean a batch of arrowtips." (spam) with sound 3922 (tick 72, the last
 * 20). With no free slot at all: "You need at least one free inventory space to clean those.".
 * The Wiki gives the per-band weights and the 50 a click (data/vale-totems.json, dirtyArrowtips);
 * ours: a clean stopped by the 50 gets the message too.
 */
const Shared = require("./Shared.ValeTotems");

const FLAX_PER_BALE = 25;
const ARROWTIPS = Shared.DATA.dirtyArrowtips;
/** herblore_clean_herb_3 */
const CLEAN_SOUND = 3922;
const MESSAGE = {
  UNPACKED: "You unpack a bale of flax.",
  NO_SPACE: `You need at least ${FLAX_PER_BALE} empty spaces to unpack the flax.`,
  NO_SPACE_TO_CLEAN: "You need at least one free inventory space to clean those.",
  CLEANED: "You clean a batch of arrowtips.",
};

/** One arrowhead from the player's Fletching band (the boosted level). */
function rollArrowhead(player) {
  const level = Shared.level(player, "FLETCHING");
  const { weights } = ARROWTIPS.bands.find((band) => level >= band.level) ?? ARROWTIPS.bands.at(-1);
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  let roll = Math.floor(Math.random() * total);
  for (const [name, weight] of Object.entries(weights)) {
    if ((roll -= weight) < 0) return Shared.obj(name);
  }
  return Shared.obj(Object.keys(weights)[0]);
}

function clean({ player, itemId }) {
  const inventory = player.getInventory();
  if (!inventory.contains(itemId)) return true;
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(MESSAGE.NO_SPACE_TO_CLEAN);
    return true;
  }
  let full = false;
  for (let i = 0; i < ARROWTIPS.perClick && inventory.contains(itemId); i++) {
    const arrowhead = rollArrowhead(player);
    if (!Shared.hasRoomFor(player, arrowhead)) {
      full = true;
      break;
    }
    inventory.delete(itemId, 1);
    inventory.adds(arrowhead, 1);
  }
  inventory.refreshItems();
  if (!full) {
    Shared.spam(player, MESSAGE.CLEANED);
    Shared.sound(player, CLEAN_SOUND);
  }
  return true;
}

function unpack({ player, itemId }) {
  const inventory = player.getInventory();
  if (!inventory.contains(itemId)) return true;
  if (inventory.getFreeSlots() < FLAX_PER_BALE) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return true;
  }
  inventory.delete(itemId, 1);
  inventory.adds(Shared.obj("flax"), FLAX_PER_BALE);
  inventory.refreshItems();
  player.sendMessage(MESSAGE.UNPACKED);
  return true;
}

function attach(api) {
  api.onItemAction("Bale of flax", { Unpack: unpack });
  api.onItemAction("Dirty arrowtips", { Clean: clean });
}

module.exports = { attach, FLAX_PER_BALE, rollArrowhead };
