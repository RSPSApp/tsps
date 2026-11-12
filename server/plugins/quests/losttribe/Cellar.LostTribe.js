// The Lumbridge cellar wall's hole into the Dorgeshuun tunnel (docs/quests/the-lost-tribe/README.md).
//
// rsprox 20261112T152024-5ab63b4 (revision 242), ticks 191-245: Squeeze-through on either side
// (lost_tribe_cellar_wall 6898 at 3219,9618, lost_tribe_cellar_wall_back 6899 at 3221,9618) says
// "You squeeze through the hole." and faces the wall on the click's tick, plays human_pipesqueeze
// (746) the next tick and moves the player to the far side, two tiles across, with
// human_pipeunsqueeze (748) the tick after. Going in without a light source first opens the dark
// warning, cws_warning_16 (569), counting each showing in its varbit (3866: 0 -> 1 -> 2): "Yes I
// am sure." crosses from that tick (219-221), "No" closes it (237-238).
const OUTER_X = 3219;
const INNER_X = 3221;
const WALL_Y = 9618;
const FACE_X = 3220;
const SQUEEZE = 746; // human_pipesqueeze
const UNSQUEEZE = 748; // human_pipeunsqueeze
const MESSAGE = "You squeeze through the hole.";
const WARNING = 569; // cws_warning_16: "It's very dark in there."
const WARNING_YES = 17; // warn1
const WARNING_NO = 18; // warn2
const WARNING_CLOSE = 12; // cws_close
const WARNING_VARBIT = 3866; // cws_warning_16
// As ObservatoryQuest's cws_warning_9 box: the count stops at six showings.
const WARNING_COUNT_MAX = 6;
const WARNING_COUNT_ATTRIBUTE = "lost-tribe:dark-warnings";
const SCRIPT_MAINMODAL_OPEN = 2524;

module.exports = function createCellarHole(api) {
  const { Animation, CountdownTask, Location, TaskManager } = api.core;
  const Darkness = require("../../world/Darkness.plugin");
  /** Players whose dark warning is open, and the wall they clicked. */
  const pending = new WeakMap();

  api.persistAttribute(WARNING_COUNT_ATTRIBUTE, 0);

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
    const shown = Math.min(WARNING_COUNT_MAX, (Number(player.getAttribute(WARNING_COUNT_ATTRIBUTE)) || 0) + 1);
    player.setAttribute(WARNING_COUNT_ATTRIBUTE, shown);
    pending.set(player, fromX);
    const sender = player.getPacketSender();
    sender.sendVarbit(WARNING_VARBIT, shown);
    sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
    sender.sendInterface(WARNING);
  }

  /** Squeeze-through on the wall's hole; true when the click was the hole's. */
  function squeeze(player, location) {
    if (!isWall(location)) return false;
    if (location.x === OUTER_X && !Darkness.hasLightSource(player)) warn(player, location.x);
    else cross(player, location.x);
    return true;
  }

  function warningClick(event) {
    const buttonId = Number(event.buttonId ?? 0);
    if ((event.groupId ?? (buttonId >>> 16)) !== WARNING) return;
    const child = event.childId ?? (buttonId & 0xffff);
    if (child !== WARNING_YES && child !== WARNING_NO && child !== WARNING_CLOSE) return;
    const { player } = event;
    if (!pending.has(player)) return;
    event.handled = true;
    const fromX = pending.get(player);
    pending.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    if (child === WARNING_YES) cross(player, fromX);
  }

  function restoreWarningCount({ player }) {
    const shown = Number(player.getAttribute(WARNING_COUNT_ATTRIBUTE)) || 0;
    if (shown > 0) player.getPacketSender().sendVarbit(WARNING_VARBIT, shown);
  }

  function warningClosed({ player, interfaceId }) {
    if (interfaceId === WARNING) pending.delete(player);
  }

  return { isWall, squeeze, warningClick, restoreWarningCount, warningClosed };
};
