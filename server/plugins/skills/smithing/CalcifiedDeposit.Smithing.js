/**
 * Calcified deposits (Wiki, Calcified deposit): a deposit used on an anvil while carrying a
 * hammer is crushed for 1 Smithing experience and takes 3 ticks per deposit. Three in four
 * give 5-15 blessed bone shards; the rest give one calcified moth.
 *
 * The repeating loop is the Barronite Crusher's (Actions.Camdozaal.js): one on the use, then one
 * every 3 ticks while deposits and a hammer last. The Wiki gives the per-deposit time and the
 * loot but not the first-crush timing; the animation is the ordinary anvil hammering.
 */
const Core = require("./Core.Smithing");
const Common = require("./Common.Smithing");

const XP = 1;
const TICKS_PER_DEPOSIT = 3;
const SHARD_RARITY = 3 / 4;
const SHARD_MIN = 5;
const SHARD_MAX = 15;

/** The item ids, read after Core.init fills api.core. */
const ids = () => ({
  deposit: Core.ItemIdentifiers.CALCIFIED_DEPOSIT,
  shards: Core.ItemIdentifiers.BLESSED_BONE_SHARDS,
  moth: Core.ItemIdentifiers.CALCIFIED_MOTH,
});

/** Each player's crushing loop. */
const sessions = new WeakMap();

/** One deposit's loot: shards three times in four, otherwise a moth. */
function rollLoot(random = Math.random) {
  if (random() < SHARD_RARITY) {
    return { itemId: ids().shards, amount: SHARD_MIN + Math.floor(random() * (SHARD_MAX - SHARD_MIN + 1)) };
  }
  return { itemId: ids().moth, amount: 1 };
}

/** Crushes one carried deposit; false when there is none or the hammer is gone. */
function crushOne(player, random) {
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(ids().deposit);
  if (slot < 0 || !Common.hasHammer(player)) return false;
  const loot = rollLoot(random);
  inventory.deleteAtSlot(slot, 1);
  inventory.add(new Core.Item(loot.itemId, loot.amount), true);
  player.performAnimation(Common.hammering());
  player.getSkillManager().addExperiences(Core.Skill.SMITHING, XP);
  return true;
}

function stopCrushing(player) {
  sessions.get(player)?.stop();
  sessions.delete(player);
}

function keepCrushing(player, object, random) {
  let tick = 0;
  const task = new (class extends Core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return this.stop();
      if (!player.getLocation().isWithinDistance(object.getLocation(), 3)) return this.stop();
      if (tick++ % TICKS_PER_DEPOSIT !== 0) return;
      if (!crushOne(player, random)) this.stop();
    }
  })();
  sessions.set(player, task);
  Core.TaskManager.submit(task);
}

/** A calcified deposit used on an anvil: handled only when a hammer can crush it. */
function useOnAnvil(event) {
  if (event.handled || event.itemId !== ids().deposit) return false;
  if (event.object?.getDefinition?.().getName?.() !== "Anvil") return false;
  if (!Common.hasHammer(event.player)) return false;
  event.handled = true;
  stopCrushing(event.player);
  keepCrushing(event.player, event.object);
  return true;
}

module.exports = { useOnAnvil, stopCrushing, rollLoot, TICKS_PER_DEPOSIT };
