/**
 * The brass key door of the shed west of the Cooks' Guild, as captured:
 * - without a brass key: "The door is locked.";
 * - with one (it is kept): "You unlock the door." and sound 2402; a tick later an invisible wall
 *   takes the door's place, the open door (1539) stands beside it, sound 62 plays and the player
 *   steps through; two ticks after that the door is shut again.
 * The capture went in; the way out is assumed to be the same.
 * The wall and the open door replace the closed door (it is taken off its tile, or the client keeps
 * drawing it beside the open leaf), and shutting takes both away again before the door comes back.
 */
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
const Common = require("./Common.EdgevilleDungeon");
const { hasKey } = require("../../items/KeyAvailability");

let core = null;
let DOOR = null;

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(ticks, null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

const same = (location, tile) => location.x === tile.x && location.y === tile.y && (location.z ?? 0) === (tile.z ?? 0);

function loc(id, tile, face) {
  const { GameObject, Location } = core;
  return new GameObject(id, new Location(tile.x, tile.y, tile.z ?? 0), 0, face, null);
}

function place(id, tile, face) {
  const object = loc(id, tile, face);
  core.ObjectManager.register(object, true);
  return object;
}

function open(event) {
  if (event.objectId !== DOOR.door || !same(event.location, DOOR.tile)) return false;
  const { player } = event;
  if (ObstacleRunner.isBusy(player)) return true;
  if (!hasKey(Common.api, player, DOOR.key)) {
    player.sendMessage(DOOR.messages.locked);
    return true;
  }
  const at = player.getLocation();
  const inside = at.getX() === DOOR.inside.x && at.getY() === DOOR.inside.y;
  const to = inside ? DOOR.outside : DOOR.inside;
  player.sendMessage(!player.getInventory().contains(DOOR.key) ? "You use your keyring to unlock the door." : DOOR.messages.unlock);
  player.getPacketSender().sendSound(DOOR.unlockSound, 1, 0);
  ObstacleRunner.run({ player }, [
    { wait: 1 },
    {
      run: () => {
        core.ObjectManager.deregister(loc(DOOR.door, DOOR.tile, DOOR.face), true);
        const wall = place(DOOR.invisibleWall, DOOR.tile, DOOR.face);
        const opened = place(DOOR.openDoor, DOOR.openDoorTile, DOOR.openDoorFace);
        player.getPacketSender().sendSound(DOOR.openSound, 1, 0);
        later(DOOR.shutTicks, () => {
          core.ObjectManager.deregister(opened, true);
          core.ObjectManager.deregister(wall, true);
          place(DOOR.door, DOOR.tile, DOOR.face);
        });
      },
    },
    { walk: [[to.x, to.y]] },
  ]);
  return true;
}

function attach(api) {
  core = api.core;
  DOOR = Common.data.brassKeyDoor;
  api.onObjectInteraction("Door", { Open: open });
}

module.exports = attach;
Object.assign(module.exports, { open });
