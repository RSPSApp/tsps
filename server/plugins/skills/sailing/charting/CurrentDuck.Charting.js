// Current ducks (rsprox 938-948, 3467): the current duck's Track-current near a duck's hint marker
// releases it to follow that current; the player follows it, and Collect, once it stops, charts the
// current (125 XP, and again on every later run: the tasks' give_repeat_xp).
//   Release: +0 the helm let go of; +1 the placing animation; +2 "You release your current duck...",
//   sailing_charting_current_duck_reset set, current_hint_arrow 5, the duck (15152) at the release
//   spot with a hint arrow, the item gone; +3 "Quack!" with area sound 413. Then a tile a tick
//   along the current's route (data/charting.json `route`, as captured).
//   Stop: the duck turns into its stopped form (15153), "Your current duck comes to a stop.",
//   "Quack! Quack! Quack!" and area sound 413 twice.
//   Collect: +1 the helm let go of and the pick-up animation; +2 the charting, the duck back in
//   the inventory with its object box, the variables back to 0.
// No duck marker within reach: "You don't spot any currents worth tracking."
const common = require("./Common.Charting");

const ITEM_DUCK = 31805;
const NPC_MOVING = 15152; // sailing_charting_current_duck_moving
const NPC_STOPPED = 15153; // sailing_charting_current_duck_stopped
const SEQ_PLACE = 13305; // human_sailing_charting_duck_place01
const SEQ_PICKUP = 13304; // human_sailing_charting_duck_pickup01
const SOUND_QUACK = 413;
const SOUND_RANGE = 10;
const VARP_DUCK_RESET = 5038; // sailing_charting_current_duck_reset
const VARBIT_HINT_ARROW = 14192; // current_hint_arrow
const HINT_ARROW_DUCK = 5;
/** sailing_current_duck_hintarrow_disabled: All Settings "Current duck hint arrow" off. */
const VARBIT_DUCK_ARROW_DISABLED = 18133;
/** How far from a duck marker the duck can be released (the captures: up to 8 from the boat's centre). */
const RELEASE_RANGE = 8;
/** From the deck to the stopped duck: the boat's reach across the water (ours, as the quest had it). */
const COLLECT_RANGE = 12;
const LEVEL = 22;
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
const QUEUED_STEPS = 8;
const DUCK_TOOL_SLOT = 2;
const STOPPED_LIFETIME_MS = 120000; // OSRS Wiki Current duck: two minutes after stopping.
const RESET_ATTRIBUTE = "charting:duck-reset-at";

const RELEASED = "<col=3366ff>You release your current duck and he begins tracking the currents...</col>";
const STOPPED = "<col=3366ff>Your current duck comes to a stop.</col>";
const NOTHING = "You don't spot any currents worth tracking.";
const COLLECTED = "The duck recognises your boat and climbs aboard. He shares the secrets of the currents he travelled on with you.";
const NOT_ABOARD = "You need to be on your boat to release the duck.";

/** Ducks out at sea: player -> { spot, npc, steps, stopped }. */
const ducks = new Map();

function questComplete(player, key) {
  const request = { player, key, complete: null };
  common.api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** Current Affairs unlocks the duck; its own Catherby current is charted during the quest. */
function canTrack(player, spot) {
  if (spot.key === "current_duck_catherby_bay") return true;
  return questComplete(player, "current_affairs")
    && player.getSkillManager().getCurrentLevel(common.core().Skill.SAILING) >= LEVEL;
}

function spotNear(player) {
  const here = common.core().BoatManager.rootLocation(player);
  let best;
  let bestDistance = Infinity;
  for (const spot of common.spotsOfType("current_duck")) {
    if (!spot.route || !spot.location) continue;
    const distance = Math.max(Math.abs(spot.location[0] - here.getX()), Math.abs(spot.location[1] - here.getY()));
    if (distance <= RELEASE_RANGE && distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

/** Every tile of the route after its first, a tile a step (diagonals included). */
function routeSteps(route) {
  const steps = [];
  let [x, y] = route[0];
  for (const [nextX, nextY] of route.slice(1)) {
    while (x !== nextX || y !== nextY) {
      x += Math.sign(nextX - x);
      y += Math.sign(nextY - y);
      steps.push([x, y]);
    }
  }
  return steps;
}

function quack(duck, text, times) {
  duck.npc.forceChat(text);
  const at = duck.npc.getLocation();
  for (const player of [duck.player]) {
    for (let i = 0; i < times; i++) player.getPacketSender().sendAreaSound(SOUND_QUACK, at.getX(), at.getY(), at.getZ(), 1, 0, SOUND_RANGE);
  }
}

function later(ticks, action) {
  const { Task, TaskManager } = common.core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks); }
    execute() {
      this.stop();
      action();
    }
  })());
}

function trackCurrent(event) {
  const { player } = event;
  const { BoatManager, Sailing } = common.core();
  if (!BoatManager.getBoatAboard(player) || !Sailing.instanceAboard(player)) {
    player.sendMessage(NOT_ABOARD);
    return true;
  }
  const spot = spotNear(player);
  if (!spot || !canTrack(player, spot)) {
    player.sendMessage(NOTHING);
    return true;
  }
  if (ducks.has(player) || resetAt(player) > Date.now()) return true;
  common.afterHelm(player, () => {
    player.performAnimation(new (common.core().Animation)(SEQ_PLACE));
    later(1, () => release(player, spot));
  });
  return true;
}

function release(player, spot) {
  if (player.isRegistered?.() === false || ducks.has(player)) return;
  if (!player.getInventory().contains(ITEM_DUCK)) return;
  const [x, y] = spot.route[0];
  const npc = common.api().spawnNpc({ id: NPC_MOVING, x, y, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
  if (!npc) return;
  npc.setFlag?.(common.core().NPC.WALK_THROUGH_ENTITIES_FLAG, true);
  // The duck swims over the sea, which is blocked to anything on foot.
  npc.setFlag?.(IGNORE_CLIPPING_FLAG, true);
  player.getInventory().delete(ITEM_DUCK, 1);
  const sender = player.getPacketSender();
  player.sendMessage(RELEASED);
  if (sender.getVarbit(VARBIT_DUCK_ARROW_DISABLED) !== 1) {
    sender.sendVarbit(VARBIT_HINT_ARROW, HINT_ARROW_DUCK);
    sender.sendEntityHint(npc);
  }
  const duck = { player, spot, npc, steps: routeSteps(spot.route), stopped: false };
  // Remember the remaining journey as well as its stopped lifetime across a relog/restart.
  player.setAttribute(RESET_ATTRIBUTE, Date.now() + (duck.steps.length + 1) * 600 + STOPPED_LIFETIME_MS);
  if (!player.getSailing().tools.includes(DUCK_TOOL_SLOT)) player.getSailing().tools.push(DUCK_TOOL_SLOT);
  sendReset(player);
  ducks.set(player, duck);
  common.api().emitCustomEvent("charting:duck-released", { player, spot: spot.key });
  later(1, () => {
    if (ducks.get(player) !== duck) return;
    quack(duck, "Quack!", 1);
    swim(duck);
  });
}

/** A tile a tick along the route, then the stop. The steps go to the duck's queue a few at a time (it holds fewer than a long route). */
function swim(duck) {
  const { Location, Task, TaskManager } = common.core();
  const queue = duck.npc.getMovementQueue();
  let next = 0;
  const feed = () => {
    while (next < duck.steps.length && queue.size() < QUEUED_STEPS) {
      const [x, y] = duck.steps[next++];
      queue.addSteps(new Location(x, y, 0));
    }
  };
  feed();
  const [endX, endY] = duck.steps.at(-1) ?? duck.spot.route[0];
  TaskManager.submit(new (class extends Task {
    constructor() { super(1); }
    execute() {
      if (ducks.get(duck.player) !== duck || duck.npc.isRegistered?.() === false) return this.stop();
      feed();
      const at = duck.npc.getLocation();
      if (at.getX() !== endX || at.getY() !== endY) return;
      this.stop();
      stop(duck);
    }
  })());
}

function stop(duck) {
  duck.stopped = true;
  duck.npc.setNpcTransformationId(NPC_STOPPED);
  duck.player.sendMessage(STOPPED);
  quack(duck, "Quack! Quack! Quack!", 2);
  duck.player.setAttribute(RESET_ATTRIBUTE, Date.now() + STOPPED_LIFETIME_MS);
  sendReset(duck.player);
  const { Task, TaskManager } = common.core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, duck, false); }
    execute() {
      if (ducks.get(duck.player) !== duck) return this.stop();
      if (Date.now() < resetAt(duck.player)) return;
      finish(duck.player, duck);
      this.stop();
    }
  })());
}

/** The stopped duck is collected from the deck, across the water. */
function widenCollectRange(event) {
  if (event.npcId !== NPC_STOPPED && event.npc?.getNpcTransformationId?.() !== NPC_STOPPED) return;
  const duck = ducks.get(event.player);
  if (!duck || duck.npc !== event.npc || !duck.stopped) return;
  event.range = COLLECT_RANGE;
}

function collect(event) {
  const { player } = event;
  const duck = ducks.get(player);
  if (!duck || event.npc !== duck.npc) return false;
  if (!duck.stopped) return true;
  common.afterHelm(player, () => {
    player.performAnimation(new (common.core().Animation)(SEQ_PICKUP));
    later(1, () => climbAboard(player, duck));
  });
  return true;
}

function climbAboard(player, duck) {
  if (ducks.get(player) !== duck) return;
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  finish(player, duck);
  const { Item, DialogueChainBuilder, ItemStatementDialogue } = common.core();
  common.complete(player, duck.spot, { lines: [] });
  player.getInventory().add(new Item(ITEM_DUCK, 1), true);
  const tools = player.getSailing().tools;
  const toolIndex = tools.indexOf(DUCK_TOOL_SLOT);
  if (toolIndex >= 0) tools.splice(toolIndex, 1);
  // A quest charting its current (Current Affairs) answers with its own lines instead.
  const event = { player, spot: duck.spot.key, handled: false };
  common.api().emitCustomEvent("charting:duck-collected", event);
  if (!event.handled) player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, ITEM_DUCK, COLLECTED)));
}

/** The duck taken out of the sea, and its variables back to 0. */
function finish(player, duck) {
  ducks.delete(player);
  common.api().removeNpc(duck.npc);
  common.core().TaskManager.cancelTasks(duck);
  player.setAttribute(RESET_ATTRIBUTE, 0);
  const sender = player.getPacketSender();
  sender.sendConfig(VARP_DUCK_RESET, 0);
  sender.sendVarbit(VARBIT_HINT_ARROW, 0);
  sender.clearHintArrow();
}

function resetAt(player) {
  const value = player.getAttribute(RESET_ATTRIBUTE);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sendReset(player) {
  // RSProx 235/938 publishes epoch minutes (29408822), never a server process cycle.
  player.getPacketSender().sendConfig(VARP_DUCK_RESET, resetAt(player) ? Math.ceil(resetAt(player) / 60000) : 0);
}

function canTakeTool(event) {
  if (event.slot !== DUCK_TOOL_SLOT) return;
  const remaining = resetAt(event.player) - Date.now();
  if (remaining > 0) {
    event.allowed = false;
    event.player.sendMessage(`You have a current duck out at sea. Either find it or wait ${Math.ceil(remaining / 1000)} seconds to collect another.`);
    return;
  }
  const duck = ducks.get(event.player);
  if (duck) finish(event.player, duck);
  else {
    event.player.setAttribute(RESET_ATTRIBUTE, 0);
    sendReset(event.player);
  }
}

function onLogin({ player }) {
  if (resetAt(player) <= Date.now()) player.setAttribute(RESET_ATTRIBUTE, 0);
  sendReset(player);
}

/** Session NPCs disappear on logout; the tools compartment and deadline survive in the save. */
function onLogout({ player }) {
  const duck = ducks.get(player);
  if (!duck) return;
  ducks.delete(player);
  common.core().TaskManager.cancelTasks(duck);
  common.api().removeNpc(duck.npc);
}

function attach(api) {
  common.init(api);
  api.persistAttribute(RESET_ATTRIBUTE, 0);
  api.onItemAction("Current duck", { "Track-current": trackCurrent });
  api.onNpcRoute(widenCollectRange);
  api.onNpcInteraction("Current duck", { Collect: collect });
  api.onPlayerLogout(onLogout);
  api.onPlayerLogin(onLogin);
  api.onCustomEvent("sailing:can-take-tool", canTakeTool);
}

module.exports = attach;
module.exports.ducks = ducks;
module.exports.trackCurrent = trackCurrent;
module.exports.collect = collect;
module.exports.routeSteps = routeSteps;
module.exports.NOTHING = NOTHING;
module.exports.RESET_ATTRIBUTE = RESET_ATTRIBUTE;
