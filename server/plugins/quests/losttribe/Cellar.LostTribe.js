// The Lumbridge cellar wall's hole into the Dorgeshuun tunnel (docs/quests/the-lost-tribe/README.md).
//
// rsprox 20261112T152024-5ab63b4 (revision 242), ticks 191-245: Squeeze-through on either side
// (lost_tribe_cellar_wall 6898 at 3219,9618, lost_tribe_cellar_wall_back 6899 at 3221,9618) says
// "You squeeze through the hole." and faces the wall on the click's tick, plays human_pipesqueeze
// (746) the next tick and moves the player to the far side, two tiles across, with
// human_pipeunsqueeze (748) the tick after. Going in without a light source first opens the dark
// warning, cws_warning_16 (569), counting each showing in its varbit (3866: 0 -> 1 -> 2): "Yes I
// am sure." crosses from that tick (219-221), "No" closes it (237-238). The WarningScreens
// plugin shows it.
const OUTER_X = 3219;
const INNER_X = 3221;
const WALL_Y = 9618;
const FACE_X = 3220;
const SQUEEZE = 746; // human_pipesqueeze
const UNSQUEEZE = 748; // human_pipeunsqueeze
const MESSAGE = "You squeeze through the hole.";
/** cws_warning_16 (569): "It's very dark in there." */
const DARK_WARNING = 16;

module.exports = function createCellarHole(api) {
  const { Animation, CountdownTask, Location, TaskManager } = api.core;
  const Darkness = require("../../world/Darkness.plugin");
  function isWall(location) {
    return location?.y === WALL_Y && (location.x === OUTER_X || location.x === INNER_X);
  }

  function cross(player, fromX) {
    const movement = player.getMovementQueue();
    movement.reset();
    movement.setBlockMovement(true);
    player.sendMessage(MESSAGE);
    player.setPositionToFace(new Location(FACE_X, WALL_Y, 0));
    TaskManager.submit(new CountdownTask(player, 1, () => player.performAnimation(new Animation(SQUEEZE))));
    TaskManager.submit(new CountdownTask(player, 2, () => {
      movement.setBlockMovement(false);
      if (!player.isRegistered()) return;
      player.moveTo(new Location(fromX === OUTER_X ? INNER_X : OUTER_X, WALL_Y, 0));
      player.performAnimation(new Animation(UNSQUEEZE));
    }));
  }

  function warn(player, fromX) {
    const warning = { player, warning: DARK_WARNING, proceed: () => cross(player, fromX) };
    api.emitCustomEvent("warning-screen:show", warning);
    if (!warning.handled) cross(player, fromX);
  }

  /** Squeeze-through on the wall's hole; true when the click was the hole's. */
  function squeeze(player, location) {
    if (!isWall(location)) return false;
    if (location.x === OUTER_X && !Darkness.hasLightSource(player)) warn(player, location.x);
    else cross(player, location.x);
    return true;
  }

  return { isWall, squeeze };
};
