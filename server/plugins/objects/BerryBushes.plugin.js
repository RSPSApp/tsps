/**
 * Wild redberry and cadava bushes (south-east of Varrock, Land's End):
 * https://oldschool.runescape.wiki/w/Redberry_bush_(wild),
 * https://oldschool.runescape.wiki/w/Cadava_bush_(wild)
 *
 * Each bush holds 2 berries. "Pick-from" takes one and steps the bush down a stage
 * (2 berries -> 1 berry -> empty); 200 ticks after a pick another berry grows back, one
 * stage at a time, until the bush is full again. An empty bush says "There are no berries
 * on this bush at the moment."
 *
 * As captured (rsprox recording 75, fai_varrock_redberrybush_2): the player faces the bush
 * and plays picking_low on the tick they arrive; a tick later come the berry and synth
 * sound 2581, with no chat message. A full inventory gets "Your inventory is too full to
 * pick the berries from the bush." instead.
 *
 * The farming-patch bushes share these names but not these ids, so their picks fall through.
 */
const PICK_ANIMATION_NAME = "picking_low";
const REGROW_TICKS = 200;
const EMPTY_MESSAGE = "There are no berries on this bush at the moment.";
const FULL_INVENTORY_MESSAGE = "Your inventory is too full to pick the berries from the bush.";

let core;
let TaskManager;
let bushes;
let pickAnimation;
let LaterTask;
/** Tile key -> { original, current, generation }, for bushes that are not full. */
const bushStates = new Map();
/** Tiles with a pick under way this tick, so one berry is not picked twice. */
const picking = new Set();

function tileKey(location) {
  return `${location.getX()},${location.getY()},${location.getZ()}`;
}

/** Bush name -> { stages: [2 berries, 1 berry, empty] loc ids, item }. */
function bushesByName() {
  const { ObjectIdentifiers, ItemIdentifiers } = core;
  bushes ??= new Map([
    ["Redberry bush", {
      stages: [ObjectIdentifiers.REDBERRY_BUSH_12, ObjectIdentifiers.REDBERRY_BUSH_13, ObjectIdentifiers.REDBERRY_BUSH_14],
      item: ItemIdentifiers.REDBERRIES,
    }],
    ["Cadava bush", {
      stages: [ObjectIdentifiers.CADAVA_BUSH, ObjectIdentifiers.CADAVA_BUSH_2, ObjectIdentifiers.CADAVA_BUSH_3],
      item: ItemIdentifiers.CADAVA_BERRIES,
    }],
  ]);
  return bushes;
}

/** Runs `action` after `ticks`; not keyed to anyone, so a new click does not cancel it. */
function later(ticks, action) {
  LaterTask ??= class extends core.Task {
    constructor(delay, run) {
      super(delay);
      this.run = run;
    }

    execute() {
      this.stop();
      this.run();
    }
  };
  TaskManager.submit(new LaterTask(ticks, action));
}

function bushFor(event) {
  const name = event.definition?.getName?.() ?? event.object?.getDefinition?.()?.getName?.();
  const bush = bushesByName().get(name);
  const stage = bush ? bush.stages.indexOf(event.object?.getId?.()) : -1;
  return stage < 0 ? null : { bush, stage };
}

/** Swaps the bush on the map for the given stage; the full stage restores the map's own loc. */
function setStage(state, bush, stage) {
  const { GameObject, ObjectManager } = core;
  const current = state.current;
  const next = stage === 0 ? state.original
    : new GameObject(bush.stages[stage], current.getLocation().clone(), current.getType(), current.getFace(), current.getPrivateArea());
  ObjectManager.deregister(current, true);
  ObjectManager.register(next, true);
  state.current = next;
}

/** One berry grows back REGROW_TICKS after the latest pick, then one more every REGROW_TICKS. */
function scheduleRegrow(key, state, bush) {
  const generation = ++state.generation;
  later(REGROW_TICKS, () => regrow(key, generation, bush));
}

function regrow(key, generation, bush) {
  const state = bushStates.get(key);
  // A newer pick restarted the timer.
  if (!state || state.generation !== generation) return;
  const stage = Math.max(0, bush.stages.indexOf(state.current.getId()) - 1);
  setStage(state, bush, stage);
  if (stage === 0) bushStates.delete(key);
  else scheduleRegrow(key, state, bush);
}

/** The pick's second tick: the berry, the sound, and the bush one stage emptier. */
function finishPick(player, object, bush) {
  const key = tileKey(object.getLocation());
  picking.delete(key);
  if (!player.isRegistered()) return;
  const state = bushStates.get(key) ?? { original: object, current: object, generation: 0 };
  const stage = bush.stages.indexOf(state.current.getId());
  if (stage < 0 || stage >= bush.stages.length - 1) return;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage(FULL_INVENTORY_MESSAGE);
    return;
  }
  player.getInventory().adds(bush.item, 1);
  core.Sounds.sendSound(player, core.Sound.PICK);
  bushStates.set(key, state);
  setStage(state, bush, stage + 1);
  scheduleRegrow(key, state, bush);
}

function pickFromBush(event) {
  const found = bushFor(event);
  if (!found) return false;
  const { player, object } = event;
  const { bush, stage } = found;
  if (stage === bush.stages.length - 1) {
    player.sendMessage(EMPTY_MESSAGE);
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage(FULL_INVENTORY_MESSAGE);
    return true;
  }
  const key = tileKey(object.getLocation());
  if (picking.has(key)) return true;
  picking.add(key);
  pickAnimation ??= new core.Animation(core.CacheDefinitions.getSeqId(PICK_ANIMATION_NAME) ?? -1);
  player.setPositionToFace(object.getLocation());
  player.performAnimation(pickAnimation);
  later(1, () => finishPick(player, object, bush));
  return true;
}

module.exports = {
  name: "BerryBushes",
  register(api) {
    core = api.core;
    TaskManager = api.getTaskManager();
    api.onObjectInteraction("Redberry bush", { "Pick-from": pickFromBush });
    api.onObjectInteraction("Cadava bush", { "Pick-from": pickFromBush });
  },
};

module.exports._test = { pickFromBush, finishPick, bushStates, picking, REGROW_TICKS };
