/**
 * The Charge spell's expiry (Wiki: Charge): the effect lasts 700 ticks and "Your magical charge fades
 * away" appears when it ends. CombatSpells.ts casts the spell and sets the expiry; it announces each
 * cast with "magic:charge-cast" ({ player, until }). The message text is the Wiki's; no capture of the
 * fade exists (the Wiki also says it is red, which is not applied here).
 *
 * The task has its own key per player: other systems call TaskManager.cancelTasks(player) (ordinary
 * travel among them) and would otherwise end it. A recast replaces the earlier task, and logout cancels it.
 */
const FADE_MESSAGE = "Your magical charge fades away";

let core;
const KEYS = new WeakMap();

function keyOf(player) {
  if (!KEYS.has(player)) KEYS.set(player, {});
  return KEYS.get(player);
}

function cancel({ player }) {
  core.TaskManager.cancelTasks(keyOf(player));
  KEYS.delete(player);
}

function charged({ player, until }) {
  const { Task, TaskManager, World } = core;
  const key = keyOf(player);
  TaskManager.cancelTasks(key);
  TaskManager.submit(new (class extends Task {
    constructor() { super(Math.max(1, until - World.getProcessCycle()), key, false); }
    execute() {
      this.stop();
      KEYS.delete(player);
      player.sendMessage(FADE_MESSAGE);
    }
  })());
}

module.exports = {
  name: "ChargeFade",
  members: true,
  register(api) {
    core = api.core;
    api.onCustomEvent("magic:charge-cast", charged);
    api.onPlayerLogout(cancel);
  },
};
