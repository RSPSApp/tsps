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
 * - **The three portals** on the top floor: Enter on the Portals of Heroes, Champions and Legends
 *   takes the player to that guild. A live capture (revision 242, 2026-11-21) of each: two ticks
 *   after the player reaches the portal, "You step through the portal..." (a spam-filtered game
 *   message), the move and synth sound 200 all land on the same tick, with no animation.
 */

const BASEMENT = { x: 1937, y: 9008, z: 1 };
const DOG_LINE = "Who's a good doggy!";
const DOG_ANSWER = "She gives you a look of appreciation.";
const PET_ANIMATION = "human_pickupfloor";

// Each portal's landing tile, from the capture.
const PORTALS = {
  "Portal of Heroes": { x: 2904, y: 3511, z: 0 },
  "Portal of Champions": { x: 3191, y: 3365, z: 0 },
  "Portal of Legends": { x: 2728, y: 3367, z: 0 },
};
const PORTAL_DELAY_TICKS = 2;
const PORTAL_MESSAGE = "You step through the portal...";
const PORTAL_SOUND = 200;

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

/** A portal's Enter: two ticks on, the message, the move and the sound together. */
function enterPortal(player, destination) {
  player.getMovementQueue().reset();
  core.TaskManager.submit(new core.CountdownTask(player, PORTAL_DELAY_TICKS, () => {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, PORTAL_MESSAGE);
    player.moveTo(new core.Location(destination.x, destination.y, destination.z));
    player.getPacketSender().sendSound(PORTAL_SOUND, 1, 0);
  }));
}

module.exports = {
  name: "MythsGuild",
  description: "The Myths' Guild's statue down to its basement, the guild dog's Pet, and the top floor's three guild portals.",
  members: true,
  _test: { enterBasement, petDog, BASEMENT, DOG_LINE, DOG_ANSWER, PET_ANIMATION, PORTALS, PORTAL_DELAY_TICKS, PORTAL_MESSAGE, PORTAL_SOUND, enterPortal },
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    api.onObjectInteraction("Mythic Statue", { Enter: enterBasement });
    api.onNpcInteraction("Dog", { Pet: petDog });
    for (const [name, destination] of Object.entries(PORTALS)) {
      api.onObjectInteraction(name, { Enter: ({ player }) => enterPortal(player, destination) });
    }
  },
};
