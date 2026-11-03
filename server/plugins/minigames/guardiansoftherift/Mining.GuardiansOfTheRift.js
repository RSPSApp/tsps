"use strict";

/**
 * Mining the temple's guardian remains for fragments, and the huge remains for essence.
 *
 * rsprox captures (rev 241):
 * - "You swing your pick at the rock." (spam) and the pickaxe's animation; the first success two
 *   ticks later, then one every pickaxe interval (3 ticks with a dragon pickaxe, 2 on about one
 *   in six: 42 of 252 gaps in captures 566 and 1840, the Mining plugin's "mining:roll-interval").
 * - Each success: "You manage to mine some guardian fragments." / "...guardian essence." (spam),
 *   sound 3600, 5 Mining XP, and `gotr_mining_count` up by what was mined.
 * - Large remains gave 2-4 fragments, parts and remains 1-3, huge remains 4-6 essence (Wiki agrees).
 * - Before the rift opens: "There's no need to do that right now."
 * - No usable pickaxe: mesbox "You need a pickaxe to mine this rock. You do not have a pickaxe
 *   which you have the Mining level to use."
 * - A full inventory at the huge remains: mesbox "Your inventory is too full to hold any more
 *   guardian essence." with sound 2277.
 * - At 250: "You have reached the limit of 250 resources mined for this game and will not be
 *   receiving further XP." Mining goes on without XP.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");

const ROCKS = [
  { loc: "gotr_essence_tier_1", item: Shared.ITEM.FRAGMENTS, amount: [1, 3] },
  { loc: "gotr_essence_tier_1b", item: Shared.ITEM.FRAGMENTS, amount: [1, 3] },
  { loc: "gotr_essence_tier_1_large", item: Shared.ITEM.FRAGMENTS, amount: [1, 3] },
  { loc: "gotr_essence_tier_1_large_b", item: Shared.ITEM.FRAGMENTS, amount: [1, 3] },
  { loc: "gotr_essence_tier_2", item: Shared.ITEM.FRAGMENTS, amount: [2, 4] },
  { loc: "gotr_essence_tier_3", item: Shared.ITEM.ESSENCE, amount: [4, 6] },
];

const XP = 5;
const SUCCESS_SOUND = 3600;
const FULL_SOUND = 2277;
const FIRST_SUCCESS_TICKS = 2;

function rockFor(objectId) {
  return ROCKS.find((rock) => Shared.loc(rock.loc) === objectId) ?? null;
}

function bestPickaxe(player) {
  const request = { player, pickaxe: null };
  Shared.api().emitCustomEvent("mining:best-pickaxe", request);
  return request.pickaxe;
}

/** Ticks to the next success: the pickaxe's interval, sometimes one less (dragon, infernal, crystal). */
function rollInterval(pickaxe) {
  const request = { pickaxe, ticks: null };
  Shared.api().emitCustomEvent("mining:roll-interval", request);
  return request.ticks ?? pickaxe.attemptIntervalTicks;
}

function inventoryFull(player, rock) {
  const inventory = player.getInventory();
  if (rock.item === Shared.ITEM.FRAGMENTS) return inventory.getFreeSlots() <= 0 && Shared.count(player, rock.item) <= 0;
  return inventory.getFreeSlots() <= 0;
}

function tooFull(player) {
  Shared.statement(player, "Your inventory is too full to hold any more guardian essence.");
  Shared.sound(player, FULL_SOUND);
}

function mine(event) {
  const { player, objectId } = event;
  const rock = rockFor(objectId);
  if (!rock || !Shared.inTemple(player.getLocation()) || !Shared.questComplete(player)) return false;
  if (!Game.isRunning() || !Game.isPlaying(player)) {
    player.sendMessage("There's no need to do that right now.");
    return true;
  }
  const pickaxe = bestPickaxe(player);
  if (!pickaxe) {
    Shared.statement(player, "You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.");
    return true;
  }
  if (inventoryFull(player, rock)) {
    tooFull(player);
    return true;
  }
  Shared.spam(player, "You swing your pick at the rock.");
  player.performAnimation(pickaxe.animation);
  let next = FIRST_SUCCESS_TICKS;
  Shared.startAction(player, "mining", (ticks) => {
    if (!Game.isRunning() || !Game.isPlaying(player)) return false;
    if (ticks < next) return true;
    next = ticks + rollInterval(pickaxe);
    return success(player, rock, pickaxe);
  });
  return true;
}

function success(player, rock, pickaxe) {
  const inventory = player.getInventory();
  const essence = rock.item === Shared.ITEM.ESSENCE;
  let amount = Shared.random(...rock.amount);
  if (essence) amount = Math.min(amount, inventory.getFreeSlots());
  if (amount <= 0) {
    tooFull(player);
    return false;
  }
  inventory.adds(Shared.obj(rock.item), amount);
  player.performAnimation(pickaxe.animation);
  Shared.spam(player, essence ? "You manage to mine some guardian essence." : "You manage to mine some guardian fragments.");
  Shared.sound(player, SUCCESS_SOUND);
  count(player, amount);
  if (essence && inventory.getFreeSlots() <= 0) {
    tooFull(player);
    return false;
  }
  return true;
}

/** gotr_mining_count: what this game has mined, up to the 250 that still gives XP. */
function count(player, amount) {
  const state = Game.stateOf(player);
  if (!state || state.mined >= Shared.MINING_XP_CAP) return;
  Shared.addXp(player, "MINING", XP);
  state.mined = Math.min(Shared.MINING_XP_CAP, state.mined + amount);
  Shared.setVarbit(player, Shared.VARBIT.MINING_COUNT, state.mined);
  if (state.mined >= Shared.MINING_XP_CAP) {
    player.sendMessage(`You have reached the limit of ${Shared.MINING_XP_CAP} resources mined for this game and will not be receiving further XP.`);
  }
}

module.exports = {
  attach(api) {
    api.onObjectInteraction("Guardian parts", { Mine: mine });
    api.onObjectInteraction("Guardian remains", { Mine: mine });
    api.onObjectInteraction("Large guardian remains", { Mine: mine });
    api.onObjectInteraction("Huge guardian remains", { Mine: mine });
  },
};
