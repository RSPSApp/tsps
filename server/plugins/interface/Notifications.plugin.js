/**
 * The popup at the top of the game screen (notification_display, 660) that the collection log and
 * Combat Achievements show, one at a time. As captured: the server opens 660 in the toplevel's
 * notifications layer, runs notification_display_init (3343) with the title, text and colour, and
 * closes it 13 ticks later; a popup waiting behind it opens 2 ticks after that.
 *
 *   api.emitCustomEvent("notification:show", { player, title, text, colour?, jingle? })
 *
 * `colour` is the title's RGB (-1 for the default); `jingle` is { id, length } (length in ms, as
 * the jingle packet carries it) to play as the popup opens.
 */
const NOTIFICATIONS_UID = (161 << 16) | 13;
const NOTIFICATION_DISPLAY = 660;
const OVERLAY = 1;
const SCRIPT_NOTIFICATION_INIT = 3343;
const SHOWN_TICKS = 13;
const GAP_TICKS = 2;

/** Per player: the popups still to show and whether one is up. */
const queues = new WeakMap();
let taskManager;
/** A one-off task, defined once api.core.Task is reachable. */
let LaterTask;

function later(ticks, action) {
  taskManager.submit(new LaterTask(ticks, action));
}

function showNext(player) {
  const queue = queues.get(player);
  if (!queue || queue.showing) return;
  const next = queue.waiting.shift();
  if (!next) return;
  queue.showing = true;
  const sender = player.getPacketSender();
  sender.sendSubInterface(NOTIFICATIONS_UID, NOTIFICATION_DISPLAY, OVERLAY);
  sender.sendInterfaceScript(SCRIPT_NOTIFICATION_INIT, [next.title, next.text, next.colour]);
  if (next.jingle) sender.sendJingle(next.jingle.id, next.jingle.length ?? 0);
  later(SHOWN_TICKS, () => {
    if (player.isRegistered?.() === false) return;
    sender.closeSubInterface(NOTIFICATIONS_UID);
    later(GAP_TICKS, () => {
      queue.showing = false;
      if (player.isRegistered?.() !== false) showNext(player);
    });
  });
}

function show(request) {
  const { player } = request ?? {};
  if (!player || typeof request.title !== "string") return;
  if (!queues.has(player)) queues.set(player, { waiting: [], showing: false });
  queues.get(player).waiting.push({
    title: request.title,
    text: String(request.text ?? ""),
    colour: Number.isInteger(request.colour) ? request.colour : -1,
    jingle: request.jingle ?? null,
  });
  showNext(player);
}

function bind(api) {
  taskManager = api.getTaskManager();
  LaterTask = class extends api.core.Task {
    constructor(ticks, action) {
      // Not keyed to the player: a click must not cancel it.
      super(ticks);
      this.action = action;
    }

    execute() {
      this.stop();
      this.action();
    }
  };
}

module.exports = {
  name: "Notifications",
  NOTIFICATIONS_UID,
  register(api) {
    bind(api);
    api.onCustomEvent("notification:show", show);
  },
  _test: { show, queues },
};
