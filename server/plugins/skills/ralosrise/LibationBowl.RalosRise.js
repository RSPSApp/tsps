/**
 * The libation bowl at the Teomat (Wiki, Libation bowl; Pay-to-play Prayer training).
 *
 * - Fill (the empty bowl): a jug of blessed wine, or blessed sunfire wine, gives the bowl 400
 *   charges (varbit varlamore_prayer_winequant) and its kind (varlamore_prayer_winetype 0 or 1),
 *   leaving an empty jug; the bowl then sacrifices on its own.
 * - Sacrifice (the filled bowl): up to 100 shards an action, one charge each, for 5 Prayer
 *   experience a shard (6 with sunfire wine) and 2 Prayer points an action. It repeats every 4
 *   ticks; each click sacrifices at once, at most once a tick. The Zealot's robes save each shard
 *   on their own roll, not the charges (Wiki). When the bowl runs dry a blessed jug carried
 *   refills it.
 * - Check: the charges left, in our own words (no recording or Wiki text).
 * - Soul shards (Wiki: Soul shard; a Demonic Pacts League item): 550 Prayer experience a 100,
 *   at 30 Prayer, with no wine. Ours (no recording): Sacrifice takes them when there are no
 *   blessed bone shards to burn the wine on, and Fill does when there is no blessed jug, as does
 *   using them on the bowl. Up to 100 an action at 5.5 experience each, at the blessed shards'
 *   pace, animation and sound, with no Prayer points, charges or Zealot's robes. One kind of
 *   shard an action loop: when its stack runs out the loop stops, and the next Sacrifice takes
 *   the other.
 *
 * The bowl is a multiloc on the charge: empty (Fill) at 0, full (Sacrifice, Check) above. The
 * charge and kind are saved and sent again at login.
 *
 * Recorded (rsprox 1104, 1141, 1157, 4054): Fill plays human_pickuptable with sound 2401 and an
 * objectbox showing the jug; the first sacrifice follows 4 ticks later and closes it. A sacrifice
 * plays human_pray_blessed_bone_shards_01 with sound 958. A refill is the spam line "You pour some
 * more blessed wine into the libation bowl." with sound 2401, on the tick the bowl ran dry. The
 * refusals are message boxes; after a sacrifice, the Prayer check comes before the wine one
 * (1141 tick 6704). Ours: the Prayer level line, which jug fills first (the first carried), and
 * the shards check after a sacrifice, which repeats the start's line.
 */
const Common = require("./Common.RalosRise");
const { pauseForLevelUp, actionInterval } = require("../SkillActions");

const { DATA } = Common;
const CHARGE_ATTRIBUTE = "libation-bowl:charge";
const WINE_TYPE_ATTRIBUTE = "libation-bowl:wine-type";

/** Each player's sacrificing loop, retained while the level-up dialogue is open. */
const sessions = new WeakMap();
/** The world cycle of each player's last sacrifice: one a tick however often they click. */
const lastSacrifice = new WeakMap();
/** The objectbox Fill opens, which the next sacrifice closes. */
const FILL_BOX = {};

const charge = (player) => Number(player.getAttribute(CHARGE_ATTRIBUTE)) || 0;
const wineType = (player) => Number(player.getAttribute(WINE_TYPE_ATTRIBUTE)) || 0;

function setBowl(player, amount, type = wineType(player)) {
  const { charge: chargeVarbit, wineType: typeVarbit } = Common.resolved();
  player.setAttribute(CHARGE_ATTRIBUTE, amount);
  player.setAttribute(WINE_TYPE_ATTRIBUTE, type);
  player.getPacketSender().sendVarbit(chargeVarbit, amount).sendVarbit(typeVarbit, type);
}

/** The first blessed jug carried: { slot, wine }, or null. */
function blessedJug(player) {
  const wines = Common.resolved().bowlWines;
  const items = player.getInventory().getItems();
  for (let slot = 0; slot < items.length; slot++) {
    const wine = wines.find((entry) => entry.id === items[slot]?.getId?.());
    if (wine) return { slot, wine };
  }
  return null;
}

/** Pours the jug in `slot` into the bowl, leaving the empty jug there. */
function pour(player, { slot, wine }) {
  const core = Common.core();
  const inventory = player.getInventory();
  inventory.setItem(slot, new core.Item(Common.resolved().emptyJug, 1));
  inventory.refreshItems();
  setBowl(player, DATA.bowl.chargePerJug, wine.type);
}

const prayerPoints = (player) => player.getSkillManager().getCurrentLevel(Common.core().Skill.PRAYER);

/** Shards a sacrifice of `count` keeps: each rolls the Zealot's robes on its own (Wiki). */
function savedShards(player, count) {
  const chance = Common.zealotPieces(player) * Common.ZEALOT_CHANCE_PER_PIECE;
  if (chance <= 0) return 0;
  let saved = 0;
  for (let i = 0; i < count; i++) if (Math.random() < chance) saved++;
  return saved;
}

/** Why the bowl can't take an offering now: a message key, or null. */
function refusal(player, continuing) {
  if (player.getInventory().getAmount(Common.resolved().shard) <= 0) return "noShards";
  if (prayerPoints(player) < DATA.bowl.prayerPerAction) return continuing ? "noPrayerToContinue" : "noPrayer";
  return null;
}

/**
 * One offering. Returns whether the bowl can go on: false once the shards, the Prayer points or
 * the wine have run out (with their message box), or the bowl is empty.
 */
function sacrifice(player) {
  const core = Common.core();
  const ids = Common.resolved();
  const left = charge(player);
  if (left <= 0) return false;
  const refused = refusal(player, false);
  if (refused) {
    Common.messageBox(player, Common.text(refused));
    return false;
  }
  lastSacrifice.set(player, core.World.getProcessCycle());
  const inventory = player.getInventory();
  const count = Math.min(DATA.bowl.shardsPerAction, inventory.getAmount(ids.shard), left);
  const used = count - savedShards(player, count);
  if (used > 0) inventory.deleteNumber(ids.shard, used);
  setBowl(player, left - count);
  const wine = ids.bowlWines.find((entry) => entry.type === wineType(player)) ?? ids.bowlWines[0];
  player.getSkillManager().decreaseCurrentLevel(core.Skill.PRAYER, DATA.bowl.prayerPerAction, 0);
  offered(player, count * wine.xpPerShard);
  return afterSacrifice(player);
}

/** What follows an offering: the Prayer and shards checks, then a refill when the bowl ran dry. */
function afterSacrifice(player) {
  const refused = refusal(player, true);
  if (refused) {
    Common.messageBox(player, Common.text(refused));
    return false;
  }
  if (charge(player) > 0) return true;
  const jug = blessedJug(player);
  if (!jug) {
    Common.messageBox(player, Common.text("outOfWine"));
    return false;
  }
  pour(player, jug);
  Common.spam(player, Common.text("refill"));
  player.getPacketSender().sendSound(DATA.bowl.refillSound, 1, 0);
  return true;
}

function stopSacrificing({ player }) {
  sessions.get(player)?.stop();
  sessions.delete(player);
}

/** What every offering shows: the fill's box closes, the experience, the animation and sound. */
function offered(player, experience) {
  const core = Common.core();
  player.getPacketSender().closeChatboxFor(FILL_BOX);
  // Experience first: a level-up pop-up resets the animation, and this one still plays over it.
  player.getSkillManager().addExperiences(core.Skill.PRAYER, experience);
  player.performAnimation(new core.Animation(Common.resolved().seq.sacrifice));
  player.getPacketSender().sendSound(DATA.bowl.sacrifice.sound, 1, 0);
}

/** One soul shard offering; false once they have run out (with its message box). */
function sacrificeSoulShards(player) {
  const core = Common.core();
  const { soulShard } = Common.resolved();
  const inventory = player.getInventory();
  const held = inventory.getAmount(soulShard);
  if (held <= 0) {
    Common.messageBox(player, Common.text("noSoulShards"));
    return false;
  }
  lastSacrifice.set(player, core.World.getProcessCycle());
  const count = Math.min(DATA.bowl.shardsPerAction, held);
  inventory.deleteNumber(soulShard, count);
  offered(player, count * DATA.bowl.soulShards.xpPerShard);
  if (inventory.getAmount(soulShard) > 0) return true;
  Common.messageBox(player, Common.text("noSoulShards"));
  return false;
}

/** What Sacrifice offers: the blessed bone shards while the bowl has wine for them, else the soul shards. */
function offering(player) {
  const { shard, soulShard } = Common.resolved();
  const inventory = player.getInventory();
  const blessed = charge(player) > 0 && inventory.getAmount(shard) > 0;
  return !blessed && inventory.getAmount(soulShard) > 0 ? sacrificeSoulShards : sacrifice;
}

/** Sacrifices every few ticks from the next one, keyed to the player so a walk or click stops it. */
function keepSacrificing(player, offer = sacrifice) {
  const core = Common.core();
  let tick = 0;
  const interval = actionInterval(Common.api(), player, core.Skill.PRAYER, "libation", DATA.bowl.intervalTicks);
  const task = new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return this.stop();
      if (this.levelUpPaused) return;
      if (++tick % interval !== 0) return;
      if (!offer(player)) stopSacrificing({ player });
    }
  })();
  sessions.set(player, task);
  core.TaskManager.submit(task);
}

function pauseSacrificing(event) {
  pauseForLevelUp(event, sessions, (player) => stopSacrificing({ player }));
}

function levelTooLow(player) {
  if (Common.prayerLevel(player) >= DATA.bowl.level) return false;
  player.sendMessage(Common.text("bowlLevel", { level: DATA.bowl.level }));
  return true;
}

/** Sacrifice: one offering now (unless one was made this tick), then the loop from here. */
/** Starts `offer` now (at most once a tick) and every few ticks after. */
function startSacrificing(player, offer) {
  const core = Common.core();
  stopSacrificing({ player });
  // Register the loop before the offering, so its first level-up can pause it too.
  keepSacrificing(player, offer);
  if (lastSacrifice.get(player) === core.World.getProcessCycle()) return;
  if (!offer(player)) stopSacrificing({ player });
}

function sacrificeOption({ player }) {
  if (levelTooLow(player)) return true;
  startSacrificing(player, offering(player));
  return true;
}

/** Soul shards used on the bowl, full or empty. */
function useOnBowl(event) {
  const { soulShard, bowlLocs } = Common.resolved();
  if (event.handled || event.itemId !== soulShard || !bowlLocs.has(event.objectId)) return;
  event.handled = true;
  if (!levelTooLow(event.player)) startSacrificing(event.player, sacrificeSoulShards);
}

function fill({ player }) {
  if (levelTooLow(player)) return true;
  const jug = blessedJug(player);
  if (!jug && player.getInventory().getAmount(Common.resolved().soulShard) > 0) {
    startSacrificing(player, sacrificeSoulShards);
    return true;
  }
  if (!jug) {
    Common.messageBox(player, Common.text("noWineToFill"));
    return true;
  }
  const core = Common.core();
  pour(player, jug);
  player.performAnimation(new core.Animation(Common.resolved().seq.fill));
  player.getPacketSender().sendSound(DATA.bowl.fill.sound, 1, 0);
  Common.itemBox(player, jug.wine.id, jug.wine.fill, FILL_BOX);
  stopSacrificing({ player });
  // Ours: without shards or Prayer points the bowl just stays filled, no box 4 ticks later.
  if (!refusal(player, false)) keepSacrificing(player);
  return true;
}

function check({ player }) {
  const ids = Common.resolved();
  const wine = ids.bowlWines.find((entry) => entry.type === wineType(player)) ?? ids.bowlWines[0];
  player.sendMessage(Common.text("check", { wine: wine.name, count: charge(player) }));
  return true;
}

/** The varbits are the client's only record of the bowl: resend them. */
function login({ player }) {
  if (charge(player) > 0 || wineType(player) > 0) setBowl(player, charge(player));
}

function attach(api) {
  api.persistAttribute(CHARGE_ATTRIBUTE, 0);
  api.persistAttribute(WINE_TYPE_ATTRIBUTE, 0);
  api.onObjectInteraction("Libation bowl", { Fill: fill, Sacrifice: sacrificeOption, Check: check });
  api.onItemOnObject(useOnBowl, { noted: false });
  api.onPlayerLogin(login);
  api.onCustomEvent("level-up:popup-opened", pauseSacrificing);
}

module.exports = {
  attach,
  CHARGE_ATTRIBUTE,
  WINE_TYPE_ATTRIBUTE,
  _test: { sacrifice, sacrificeSoulShards, savedShards, blessedJug, sessions, FILL_BOX },
};
