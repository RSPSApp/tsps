const JUMP_ANIMATION = 6132; // wild_ditch_jump, cache rev 241
// rsprox recording 345: synth 2462 accompanies the jump with delay 25.
const JUMP_SOUND_DELAY = 25;

/**
 * The jump across a ditch piece: the ditch is 1x2, so a piece facing 0/2 runs east-west
 * (the long stretch at y 3521, crossed north/south) and one facing 1/3 runs north-south
 * (where it turns north at 2996,3530-3533, crossed east/west). The player lands 3 tiles
 * on, away from the side they stand on.
 */
function resolveJump(player, ditch, source, face) {
  const here = player.getLocation();
  if ((face & 1) === 1) {
    const fromX = Number.isInteger(source?.x) ? source.x : here.getX();
    const threshold = Number.isInteger(ditch?.x) ? ditch.x + 1 : fromX;
    return fromX < threshold ? { dx: 3, dy: 0, direction: 1 } : { dx: -3, dy: 0, direction: 3 };
  }
  const fromY = Number.isInteger(source?.y) ? source.y : here.getY();
  const threshold = Number.isInteger(ditch?.y) ? ditch.y + 1 : 3522;
  return fromY < threshold ? { dx: 0, dy: 3, direction: 0 } : { dx: 0, dy: -3, direction: 2 };
}

function tryCrossWildernessDitch(api, player, ditch, source, face = 0) {
  if (!player || player.getForceMovement() != null) {
    return { crossed: false, reason: "force_movement_active" };
  }

  const clickDelay = player.getClickDelay();
  const elapsed = clickDelay ? clickDelay.elapsed() : -1;
  if (!clickDelay || !clickDelay.elapsedTime(250)) {
    return { crossed: false, reason: "click_delay", elapsed };
  }

  const { ForceMovement, ForceMovementTask, Location, Sound, Sounds } = api.core;
  const jump = resolveJump(player, ditch, source, face);
  const forceMovement = new ForceMovement(
    player.getLocation().clone(),
    new Location(jump.dx, jump.dy),
    0,
    70,
    jump.direction,
    JUMP_ANIMATION
  );

  api.getTaskManager().submit(new ForceMovementTask(player, 3, forceMovement));
  Sounds.sendSound(player, new Sound(Sound.WILDERNESS_DITCH_JUMP.getId(), 1, JUMP_SOUND_DELAY, 0));
  clickDelay.reset();
  return { crossed: true, reason: "ok", elapsed };
}

function crossDitch(api, { player, object, location, sourceLocation }) {
  tryCrossWildernessDitch(api, player, location, sourceLocation, object?.getFace?.() ?? 0);
}

module.exports = {
  name: "WildernessDitch",
  description: "Crossing the Wilderness Ditch with the jump animation and sound, landing three tiles on, in and out of the Wilderness.",
  resolveJump,
  register: (api) => {
    api.onObjectInteraction("Wilderness Ditch", { Cross: crossDitch.bind(null, api) });
  },
};
