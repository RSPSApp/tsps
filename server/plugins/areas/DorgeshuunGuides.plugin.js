// Kazgar and Mistag's quick travel through the Dorgeshuun tunnels. Each guide's options come from
// its multinpc form (The Lost Tribe gives Follow; Death to the Dorgeshuun turns it into Mines or
// Cellar, plus Watermill), so the option clicked is already one the player has.
//
// rsprox (Kazgar op3: 13 recordings, 224/01441 to 239/04263; Mistag op3: 232/03182, 232/03187):
// "<Guide> shows you the way through the tunnels." and the screen fades out the tick it starts; three
// ticks later the player is moved, the next tick it fades back in, and two ticks after that the
// overlay closes. The quests keep the guides' Talk-to (quests/quests/LostTribe and DeathToTheDorgeshuun).
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const MOVE_TICKS = 3;
const FADE_IN_TICKS = 4;
const CLOSE_OVERLAY_TICKS = 6;

/** Recorded landings: Kazgar's by Mistag in the mine, Mistag's by Kazgar near the castle cellar. */
const MINE = { x: 3309, y: 9613 };
const CELLAR = { x: 3235, y: 9610 };
/** Not recorded: beside Dartog, who the Wiki says the Watermill option leads to. */
const WATERMILL = { x: 3245, y: 9646 };

const ROUTES = {
  Kazgar: { Follow: MINE, Mines: MINE, Watermill: WATERMILL },
  Mistag: { Follow: CELLAR, Cellar: CELLAR, Watermill: WATERMILL },
};

let api;

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function guide(name, tile) {
  return ({ player }) => {
    const { Task, TaskManager, Location } = api.core;
    const movement = player.getMovementQueue();
    // Spam in every recording (Kazgar 17, Mistag 5, Dartog 4; e.g. 224/01441.txt:20778).
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, `${name} shows you the way through the tunnels.`);
    fade(player, true);
    movement.setBlockMovement(true).reset();
    let ticks = 0;
    TaskManager.submit(new (class extends Task {
      constructor() { super(1, player, false); }
      execute() {
        ticks++;
        if (!player.isRegistered()) return void this.stop();
        if (ticks === MOVE_TICKS) player.moveTo(new Location(tile.x, tile.y, 0));
        if (ticks === FADE_IN_TICKS) {
          movement.setBlockMovement(false);
          fade(player, false);
        }
        if (ticks >= CLOSE_OVERLAY_TICKS) {
          player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
          this.stop();
        }
      }
      stop() {
        movement.setBlockMovement(false);
        super.stop();
      }
    })());
    return true;
  };
}

/** Each guide's options, built once from ROUTES: { Follow: handler, Mines: handler, ... }. */
const GUIDE_OPTIONS = Object.freeze(Object.fromEntries(Object.entries(ROUTES).map(([name, options]) =>
  [name, Object.fromEntries(Object.entries(options).map(([option, tile]) => [option, guide(name, tile)]))])));

module.exports = {
  name: "DorgeshuunGuides",
  description: "Kazgar and Mistag's quick travel through the Dorgeshuun tunnels, with the screen fade.",
  members: true,
  ROUTES,
  register(pluginApi) {
    api = pluginApi;
    api.onNpcInteraction("Kazgar", GUIDE_OPTIONS.Kazgar);
    api.onNpcInteraction("Mistag", GUIDE_OPTIONS.Mistag);
  },
};
