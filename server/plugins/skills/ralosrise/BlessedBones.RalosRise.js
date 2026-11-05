/**
 * Breaking blessed bones into blessed bone shards with a chisel (Wiki, Blessed bone shards): a
 * chisel used on them, or their Break-down option, breaks one at once and then one every 4 ticks
 * while that kind lasts, for 5 Crafting experience each. Each gives its bones.json `shards`;
 * sun-kissed bones and bone statuettes, already blessed, give theirs (ralos-rise.json `extra`).
 * Blessed superior dragon bones need 70 Prayer, as blessing them does (Wiki).
 *
 * Recorded (rsprox 1104, chisel on blessed dagannoth bones): human_cutting_restart with sound
 * 2586, the bone gone and its shards added on the same tick, again 4 ticks later. The refusals
 * (no chisel, the Prayer level) are ours.
 */
const Common = require("./Common.RalosRise");
const { pauseForLevelUp, actionInterval } = require("../SkillActions");

const { DATA } = Common;

/** Each player's breaking-down loop, retained while the level-up dialogue is open. */
const sessions = new WeakMap();

/** One bone of `itemId` broken down; false when there is none left to break. */
function breakOne(player, itemId) {
  const core = Common.core();
  const ids = Common.resolved();
  const row = ids.shards.get(itemId);
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(itemId);
  if (!row || slot < 0 || inventory.getAmount(ids.chisel) <= 0) return false;
  inventory.deleteAtSlot(slot, 1);
  inventory.add(new core.Item(ids.shard, row.shards), true);
  player.performAnimation(new core.Animation(ids.seq.breakdown));
  player.getPacketSender().sendSound(DATA.breakdown.sound, 1, 0);
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, DATA.breakdown.xp);
  return true;
}

function stopBreaking({ player }) {
  sessions.get(player)?.stop();
  sessions.delete(player);
}

function keepBreaking(player, itemId) {
  const core = Common.core();
  const api = Common.api();
  let tick = 0;
  const interval = actionInterval(api, player, core.Skill.CRAFTING, "blessed-bones", DATA.breakdown.intervalTicks);
  const task = new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return this.stop();
      if (this.levelUpPaused) return;
      if (++tick % interval !== 0) return;
      if (!breakOne(player, itemId)) this.stop();
    }
  })();
  sessions.set(player, task);
  core.TaskManager.submit(task);
}

/** Breaks one now and keeps going; false when `itemId` is not a blessed bone. */
function startBreaking(player, itemId) {
  const ids = Common.resolved();
  const row = ids.shards.get(itemId);
  if (!row) return false;
  if (player.getInventory().getAmount(ids.chisel) <= 0) {
    player.sendMessage(Common.text("noChisel"));
    return true;
  }
  if (row.level > Common.prayerLevel(player)) {
    player.sendMessage(Common.text("breakdownLevel", { level: row.level }));
    return true;
  }
  stopBreaking({ player });
  keepBreaking(player, itemId);
  if (!breakOne(player, itemId)) stopBreaking({ player });
  return true;
}

function breakDown({ player, itemId }) {
  return startBreaking(player, itemId);
}

function chiselOnBone({ player, usedItemId, usedWithItemId }) {
  const { chisel } = Common.resolved();
  const bone = usedItemId === chisel ? usedWithItemId : usedItemId;
  return startBreaking(player, bone);
}

function pauseBreaking(event) {
  pauseForLevelUp(event, sessions, (player) => stopBreaking({ player }));
}

/** The cache names of the items that break down ("Blessed bones", the statuettes...). */
function breakableNames() {
  const { ItemDefinition } = Common.core();
  return [...new Set([...Common.resolved().shards.keys()].map((id) => ItemDefinition.forId(id).getName()))];
}

function attach(api) {
  for (const name of breakableNames()) {
    api.onItemAction(name, { "Break-down": breakDown });
    api.onItemOnItem("Chisel", name, chiselOnBone);
  }
  api.onCustomEvent("level-up:popup-opened", pauseBreaking);
}

module.exports = { attach, breakOne, startBreaking, sessions };
