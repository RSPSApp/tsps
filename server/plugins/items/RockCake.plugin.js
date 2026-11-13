/**
 * Dwarven rock cake (Recipe for Disaster, Freeing the Mountain Dwarf). It heals nothing and is
 * never used up: Eat costs 1 Hitpoint, Guzzle 10% of the current ones, rounded down, plus 1.
 * Neither costs an eat delay, so it can be clicked every tick. Facts: docs/food.md (Dwarven
 * rock cake); the Wiki (Dwarven rock cake) and rsprox recordings.
 */
const EAT_OPTION = "Eat";
const GUZZLE_OPTION = "Guzzle";
const EAT_ANIMATION = 829; // human_eat
/** The sound live plays for a cooled cake (recorded; not Food's FOOD_EAT). */
const BITE_SOUND = 1018;
/** Eating hurts only above this many Hitpoints (Wiki). */
const EAT_HURTS_ABOVE = 2;
const EAT_DAMAGE = 1;
const GUZZLE_PERCENT = 10;

const COOL_EAT_MESSAGES = ["Ow! You nearly broke a tooth!", "The rock cake resists all attempts to eat it."];
const COOL_GUZZLE_MESSAGES = [
  "You bite hard into the rock cake to guzzle it down.",
  "OW! A terrible shock jars through your skull.",
];
const HOT_EAT_MESSAGES = ["Ow! Ow! That's hot!", "You burn your mouth on the hot rock cake."];

let core;

function init(api) {
  core = api.core;
}

/** The hot cake Rohak bakes; the one cooled in the quest is DWARVEN_ROCK_CAKE_2. */
function isHot(itemId) {
  return itemId === core.ItemIdentifiers.DWARVEN_ROCK_CAKE;
}

function say(player, messages) {
  for (const text of messages) player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

/** The cake's bite: the eating animation and a hit, which can only bring a player down to 1. */
function hurt(player, damage) {
  player.performAnimation(new core.Animation(EAT_ANIMATION));
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
}

/** Eat: 1 Hitpoint above 2; at 2 or less nothing moves, the player only hears and reads it. */
function eatRockCake({ player, itemId }) {
  if (!isHot(itemId)) player.getPacketSender().sendSound(BITE_SOUND, 1, 0);
  if (player.getHitpointsAfterPendingDamage() > EAT_HURTS_ABOVE) hurt(player, EAT_DAMAGE);
  say(player, isHot(itemId) ? HOT_EAT_MESSAGES : COOL_EAT_MESSAGES);
}

/** Guzzle: 10% of the current Hitpoints plus 1, never the last one (0 damage at 1 Hitpoint). */
function guzzleRockCake({ player, itemId }) {
  // Nothing was recorded guzzling a hot cake, so its messages are unknown: leave it unhandled.
  if (isHot(itemId)) return false;
  const hitpoints = player.getHitpointsAfterPendingDamage();
  player.getPacketSender().sendSound(BITE_SOUND, 1, 0);
  hurt(player, Math.min(Math.floor((hitpoints * GUZZLE_PERCENT) / 100) + 1, Math.max(0, hitpoints - 1)));
  say(player, COOL_GUZZLE_MESSAGES);
  return true;
}

module.exports = {
  name: "RockCake",
  description: "Adds the Dwarven rock cake, which is never used up: Eat costs 1 Hitpoint and Guzzle costs 10% of current Hitpoints plus 1.",
  members: true,
  register(api) {
    init(api);
    api.onItemAction("Dwarven rock cake", { [EAT_OPTION]: eatRockCake, [GUZZLE_OPTION]: guzzleRockCake });
  },
};
