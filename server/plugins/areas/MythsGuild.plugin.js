/**
 * The Myths' Guild's own interactions; the two barriers into the guild are
 * MythsGuildBarrier.plugin.js.
 *
 * - **The Mythic Statue** on the ground floor: its one action, Enter, takes the player down into
 *   the guild's basement (Wiki: Myths' Guild, "Beneath the Mythic Statue on the ground floor lies
 *   the basement of the Myths' Guild", the western part of the Corsair Cove Dungeon). The way
 *   back up is the basement's own ladder (ds2_guild_dungeon_ladder, 1937,9009), whose Climb-up
 *   lands beside the statue at 2457,2849, so the two are one doorway in both directions. Ours: no
 *   capture of the statue's Enter was available, so the move is immediate, as the ladder's is,
 *   and it lands at the foot of that ladder.
 * - **The guild dog** (8041): Pet, added by Jagex on 28 April 2021 — the player kneels
 *   (`human_pickupfloor`), says "Who's a good doggy!" over their head and a message answers
 *   "She gives you a look of appreciation." (Wiki: Dog (Myths' Guild)). No capture of this dog's
 *   own Pet exists; the animation and the line are what every recorded dog Pet shows
 *   (226/01663, 227/01723, 231/00365) and what StrayDogs.plugin.js plays for the same dogs.
 */

const BASEMENT = { x: 1937, y: 9008, z: 1 };
const DOG_LINE = "Who's a good doggy!";
const DOG_ANSWER = "She gives you a look of appreciation.";
const PET_ANIMATION = "human_pickupfloor";

let api = null;
let core = null;

/** The Mythic Statue's Enter: down into the basement, at the foot of the ladder back up. */
function enterBasement({ player }) {
  player.moveTo(new core.Location(BASEMENT.x, BASEMENT.y, BASEMENT.z));
}

/**
 * The guild's dog. `Pet` is registered for the name, and another Dog (TheFinalDawn's guard dogs)
 * has its own handler, so anything that is not this one declines and leaves the answer to them.
 */
function petDog({ player, npc }) {
  if (npc?.getId?.() !== core.NpcIdentifiers.DOG_3) return false;
  const sequence = core.CacheDefinitions.getSeqId(PET_ANIMATION);
  if (sequence != null) player.performAnimation(new core.Animation(sequence));
  player.forceChat(DOG_LINE);
  player.sendMessage(DOG_ANSWER);
  return true;
}

module.exports = {
  name: "MythsGuild",
  description: "The Myths' Guild's statue down to its basement, and the guild dog's Pet.",
  members: true,
  _test: { enterBasement, petDog, BASEMENT, DOG_LINE, DOG_ANSWER, PET_ANIMATION },
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    api.onObjectInteraction("Mythic Statue", { Enter: enterBasement });
    api.onNpcInteraction("Dog", { Pet: petDog });
  },
};
