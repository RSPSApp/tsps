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
// Single dialogue arrivals recorded for Kazgar (3182) and Mistag (3184).
const WATERMILL_FROM_KAZGAR = { x: 3242, y: 9648 };
const WATERMILL_FROM_MISTAG = { x: 3245, y: 9645 };
const WATERMILL = { x: 3245, y: 9646 };

const ROUTES = {
  Kazgar: { Follow: MINE, Mines: MINE, Watermill: WATERMILL },
  Mistag: { Follow: CELLAR, Cellar: CELLAR, Watermill: WATERMILL },
  Dartog: { Mines: MINE, Cellar: CELLAR },
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

// The transcript's message steps run the same journey as the quick options.
const DIALOGUE_ROUTES = {
  m471ps: ["Kazgar", MINE], ccERZh: ["Kazgar", WATERMILL_FROM_KAZGAR],
  yWjjdW: ["Mistag", CELLAR], uzpbCL: ["Mistag", CELLAR], _mrum5: ["Mistag", WATERMILL_FROM_MISTAG],
  SCTNDo: ["Dartog", MINE], S9W4wW: ["Dartog", CELLAR],
};
/** The water mill route opens with Death to the Dorgeshuun (Wiki, Kazgar and Mistag), though the
 * transcript offers Kazgar's and Mistag's top-level water mill options at every stage. */
const WATERMILL_STEPS = new Set(["ccERZh", "_mrum5"]);

function questComplete(player, key) {
  const request = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function travelFromDialogue(event) {
  if (event.kind !== "message") return;
  const route = DIALOGUE_ROUTES[event.stepId];
  if (!route || event.text !== `${route[0]} shows you the way through the tunnels.`) return;
  event.handled = true;
  if (WATERMILL_STEPS.has(event.stepId) && !questComplete(event.player, "death_to_the_dorgeshuun")) return;
  guide(route[0], route[1])(event);
}

module.exports = {
  name: "DorgeshuunGuides",
  description: "Kazgar, Mistag and Dartog's guided travel through the Dorgeshuun tunnels.",
  members: true,
  ROUTES,
  register(pluginApi) {
    api = pluginApi;
    api.onNpcInteraction("Kazgar", GUIDE_OPTIONS.Kazgar);
    api.onNpcInteraction("Mistag", GUIDE_OPTIONS.Mistag);
    api.onNpcInteraction("Dartog", GUIDE_OPTIONS.Dartog);
    api.onCustomEvent("npc-dialogue:action", travelFromDialogue);
  },
};
