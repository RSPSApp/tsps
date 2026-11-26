/**
 * Making jugs of sunfire wine (Wiki, Jug of sunfire wine): two sunfire splinters used on a jug of
 * wine, either way round, with a pestle and mortar carried, make a jug of sunfire wine. One is
 * made at once and then one every 4 ticks while the splinters, wine and pestle last, for no
 * experience (Wiki recipe: "1, then 4 ticks").
 *
 * Recorded (rsprox 4054, local 1001303, local 1001310; rev 237, Leagues VI): human_herbing_grind_restart
 * with sound 2608 (delay 25), 2 splinters and the jug gone and the sunfire wine added on the same
 * tick, again 4 ticks later (4054 tick 3954). A click makes one at once, at most once a tick. Without
 * the pestle or two splinters, a message box (4054 tick 3939). Splinters on a jug of sunfire wine
 * or blessed wine are not a recipe ("Nothing interesting happens."). Ours: the loop stops silently
 * once a part runs out. The recordings' two jugs a click are a Leagues relic, not followed.
 */
const Common = require("./Common.RalosRise");

const { DATA } = Common;
const WINE = DATA.sunfireWine;

/** Each player's making loop. */
const sessions = new WeakMap();

/** The game cycle of each player's last jug: one a tick, however many clicks arrive. */
const lastMade = new WeakMap();

let ids = null;
function resolvedIds() {
  if (ids) return ids;
  const { CacheDefinitions } = Common.core();
  const obj = (name) => {
    const id = CacheDefinitions.getObjId(name);
    if (!Number.isInteger(id)) throw new Error(`[RalosRise] unknown obj gameval ${name}`);
    return id;
  };
  ids = {
    splinter: obj(WINE.splinter),
    wine: obj(WINE.wine),
    product: obj(WINE.product),
    tool: obj(WINE.tool),
    seq: CacheDefinitions.getSeqId(WINE.seq),
  };
  return ids;
}

function canMake(player) {
  const { splinter, wine, tool } = resolvedIds();
  const inventory = player.getInventory();
  return inventory.getAmount(tool) > 0 && inventory.getAmount(splinter) >= WINE.splinters && inventory.getAmount(wine) > 0;
}

/** One jug made in the wine's own slot; false when a part is missing. */
function makeOne(player) {
  const core = Common.core();
  const { splinter, wine, product, seq } = resolvedIds();
  if (!canMake(player)) return false;
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(wine);
  lastMade.set(player, core.World.getProcessCycle());
  inventory.deleteNumber(splinter, WINE.splinters);
  inventory.setItem(slot, new core.Item(product, 1));
  inventory.refreshItems();
  player.performAnimation(new core.Animation(seq));
  player.getPacketSender().sendSound(WINE.sound, 1, WINE.soundDelay);
  return true;
}

function stopMaking(player) {
  sessions.get(player)?.stop();
  sessions.delete(player);
}

function keepMaking(player) {
  const core = Common.core();
  let tick = 0;
  const task = new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return this.stop();
      if (++tick % WINE.intervalTicks !== 0) return;
      if (!makeOne(player)) this.stop();
    }
  })();
  sessions.set(player, task);
  core.TaskManager.submit(task);
}

/** Splinters on a jug of wine (or the jug on the splinters). Other pairs pass through. */
function splintersOnWine({ player, usedItemId, usedWithItemId }) {
  const { splinter, wine } = resolvedIds();
  const pair = new Set([usedItemId, usedWithItemId]);
  if (!pair.has(splinter) || !pair.has(wine)) return false;
  if (!canMake(player)) {
    Common.messageBox(player, Common.text("sunfireWineMissing"));
    return true;
  }
  stopMaking(player);
  keepMaking(player);
  if (lastMade.get(player) === Common.core().World.getProcessCycle()) return true;
  if (!makeOne(player)) stopMaking(player);
  return true;
}

function attach(api) {
  const { ItemDefinition } = Common.core();
  const { splinter, wine } = resolvedIds();
  api.onItemOnItem(ItemDefinition.forId(splinter).getName(), ItemDefinition.forId(wine).getName(), splintersOnWine);
}

module.exports = { attach, makeOne, splintersOnWine, sessions };
