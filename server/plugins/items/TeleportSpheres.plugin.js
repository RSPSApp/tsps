/**
 * Oldak's moving-over-distance spheres: Break on a Dorgesh-kaan, Goblin village or Plain of Mud sphere.
 *
 * Sources:
 * - rsprox captures (recordings 3189, 3191, 3196 rev 232; 3931 rev 236): on the click the sphere is used up,
 *   "You break the sphere." (spam), dorgesh_artifact_spell_human with dorgesh_artifact_spell_spot and synth sound
 *   3496, each with client delay 22. The player lands 11 ticks later with the animation reset, and the reset is
 *   sent again the tick after. No busy varbit. Walking clicked meanwhile doesn't stop it (3191 t3019).
 * - Wiki (Dorgesh-kaan sphere, Goblin village sphere, Plain of Mud sphere): each "teleports the player to a random
 *   location within" its area, is consumed on use and "does not work beyond level 20 Wilderness".
 * - The landing tiles are the captured ones (data/teleport-spheres.json); one is picked at random.
 * - Another Slice of H.A.M. answers its own Goblin village sphere Break while the quest's route is open; this is the
 *   fallback for every other time.
 * - Ours: no quest-completion check (the Wiki gives no refusal line; the spheres come only from Oldak after the quests).
 */
const { spheres: SPHERES } = require("./data/teleport-spheres.json");

const WILDERNESS_LEVEL = 20;
const BREAK_MESSAGE = "You break the sphere.";
const SEQUENCE = "dorgesh_artifact_spell_human";
const SPOTANIM = "dorgesh_artifact_spell_spot";
const SOUND_ID = 3496;
/** Client delay on the sequence, spotanim and sound (captured 22). */
const CLIENT_DELAY = 22;
/** The player lands on the 11th tick after the click. */
const LAND_TICK = 11;

let core = null;
let sphereTeleport = null;

function teleportType() {
  if (sphereTeleport) return sphereTeleport;
  const { Animation, Graphic, Priority, Sound, TeleportType, CacheDefinitions } = core;
  const animation = new Animation(CacheDefinitions.getSeqId(SEQUENCE), CLIENT_DELAY);
  animation.priority = Priority.HIGH;
  sphereTeleport = new TeleportType(LAND_TICK, animation, null, Animation.DEFAULT_RESET_ANIMATION,
    new Graphic(CacheDefinitions.getSpotanimId(SPOTANIM)).withDelay(CLIENT_DELAY), null, null,
    { sound: new Sound(SOUND_ID, 1, CLIENT_DELAY, 0), repeatEndAnimation: true });
  return sphereTeleport;
}

/** One of the sphere's captured landing tiles, at random. */
function landing(name) {
  const tiles = SPHERES[name];
  const { tile } = tiles[Math.floor(Math.random() * tiles.length)];
  return new core.Location(...tile);
}

function breakSphere(event) {
  const { player, itemId } = event;
  const name = core.CacheDefinitions.getItem(itemId)?.name;
  if (!SPHERES[name] || !player.getInventory().contains(itemId)) return false;
  const destination = landing(name);
  if (!core.TeleportHandler.checkReqs(player, destination, WILDERNESS_LEVEL)) return true;
  core.TeleportHandler.confirm(player, destination, () => {
    if (!player.getInventory().contains(itemId)) return;
    player.getInventory().deleteNumber(itemId, 1);
    player.getPacketSender().sendMessage(BREAK_MESSAGE);
    core.TeleportHandler.teleport(player, destination, teleportType(), false);
  }, WILDERNESS_LEVEL, { item: itemId });
  return true;
}

module.exports = {
  name: "TeleportSpheres",
  description: "Breaking a Dorgesh-kaan, Goblin village or Plain of Mud sphere teleports to a random spot in its area.",
  members: true,
  register(api) {
    core = api.core;
    api.onItemAction("Dorgesh-kaan sphere", { Break: breakSphere }, { fallback: true });
    api.onItemAction("Goblin village sphere", { Break: breakSphere }, { fallback: true });
    api.onItemAction("Plain of Mud sphere", { Break: breakSphere }, { fallback: true });
  },
  breakSphere,
  SPHERES,
};
