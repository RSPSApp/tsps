"use strict";

/**
 * The two kinds of wall safe:
 *
 * - The eight at the end of the maze (7237) use the Wiki's 0-199 roll against visible Thieving,
 *   then 3/8 Rogue kit or 5/8 Rogue's equipment crate; a failure ejects with no loot, a drain
 *   still gets a roll. Cracking one ends the run and pays 12 XP per drained level.
 * - The four in the lobby (7236) need 50 Thieving, pay 70 XP, and give coins or uncut gems. A
 *   stethoscope in the inventory improves the odds; a failure can set off a floor trap for 2-6.
 */
const Common = require("./Common.RoguesDen");
const Run = require("./Run.RoguesDen");

function freeFor(player, itemId, amount) {
  const definition = Common.core().ItemDefinition.forId(itemId);
  const stackable = definition?.isStackable?.() ?? false;
  if (stackable) return Common.hasItem(player, itemId) || Common.freeSlots(player) > 0;
  return Common.freeSlots(player) >= amount;
}

function crackMaze(event) {
  const { player } = event;
  const run = Run.runOf(player);
  event.handled = true;
  if (!run) {
    player.sendMessage(Common.message("notInMaze"));
    return true;
  }
  const roll = Common.randomInt(0, Common.DATA.mazeSafe.rollMax);
  const thieving = Common.level(player, "THIEVING");
  let loot = roll <= thieving;
  if (!loot) {
    if (Math.random() < 0.5) {
      player.sendMessage(Common.message("safeFail"));
      Run.caught(player);
      return true;
    }
    if (!run.drain("THIEVING", Common.DATA.drains.mazeSafe)) {
      player.sendMessage(Common.message("noThieving"));
      Run.caught(player);
      return true;
    }
    loot = true;
  }
  if (!loot) return true;

  player.sendMessage(Common.message("safeSearch"));
  const kit = Common.randomInt(1, Common.DATA.mazeSafe.kitWeight + Common.DATA.mazeSafe.crateWeight) <= Common.DATA.mazeSafe.kitWeight;
  const itemId = kit ? Common.itemIds.rogueKit : Common.itemIds.rogueCrate;
  if (!freeFor(player, itemId, 1)) {
    player.sendMessage(Common.message("safeFull"));
    return true;
  }
  Common.give(player, itemId, 1);
  const name = Common.core().ItemDefinition.forId(itemId)?.getName?.() ?? "reward";
  player.sendMessage(Common.message("safeSuccess"));
  player.sendMessage(`You find a ${name}.`);
  Run.safe(player);
  return true;
}

function spawnLobbyTrap(player) {
  const core = Common.core();
  const at = player.getLocation().clone();
  const key = Common.keyOf(at);
  if (Common.floorTraps.has(key)) return;
  const object = new core.GameObject(Common.ids.floorSpikes, at, 10, 0, null);
  core.ObjectManager.register(object, true);
  Common.floorTraps.set(key, {
    object, id: Common.ids.floorSpikes, tile: [at.getX(), at.getY(), at.getZ()],
    armed: true, disarmedBy: null, temporary: true,
  });
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(30); }
    execute() {
      this.stop();
      const trap = Common.floorTraps.get(key);
      if (trap?.temporary && core.ObjectManager) {
        core.ObjectManager.deregister(object, true);
        Common.floorTraps.delete(key);
      }
    }
  })());
}

function damage(player, amount) {
  const core = Common.core();
  player.addTickHit(player.decrementHealth(new core.HitDamage(amount, core.HitMask.RED)));
}

function lootLobbySafe(player) {
  const entry = Common.weighted(Common.DATA.lobbySafe.drops);
  const amount = Common.randomInt(entry.min, entry.max);
  if (!freeFor(player, entry.id, amount)) {
    player.sendMessage(Common.message("full"));
    return false;
  }
  Common.give(player, entry.id, amount);
  const name = Common.core().ItemDefinition.forId(entry.id)?.getName?.() ?? "coins";
  player.sendMessage(`You find ${amount} ${name}.`);
  return true;
}

function lobbyChance(player) {
  const level = Math.min(99, Math.max(50, Common.level(player, "THIEVING")));
  const stethoscope = Common.hasItem(player, Common.itemIds.stethoscope);
  const low = stethoscope ? Common.DATA.lobbySafe.success.stethoscopeLow : Common.DATA.lobbySafe.success.low;
  const high = stethoscope ? Common.DATA.lobbySafe.success.stethoscopeHigh : Common.DATA.lobbySafe.success.high;
  return low + (level - 50) * (high - low) / 49;
}

function lobbyAttempt(player, tries) {
  if (!player.isRegistered?.()) return;
  if (Math.random() < lobbyChance(player)) {
    if (!lootLobbySafe(player)) return;
    player.getSkillManager().addExperience(Common.core().Skill.THIEVING, Common.DATA.lobbySafe.xp);
    player.sendMessage(Common.message("lobbySafeSuccess"));
    return;
  }
  if (Math.random() < Common.DATA.lobbySafe.trapChance || tries <= 1) {
    player.sendMessage(Common.message("lobbySafeFail"));
    spawnLobbyTrap(player);
    damage(player, Common.randomInt(...Common.DATA.lobbySafe.damage));
    return;
  }
  const core = Common.core();
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(Common.DATA.lobbySafe.retryTicks, player, false); }
    execute() {
      this.stop();
      lobbyAttempt(player, tries - 1);
    }
  })());
}

function crackLobby(event) {
  const { player } = event;
  event.handled = true;
  if (Common.maxLevel(player, "THIEVING") < Common.DATA.lobbySafe.level) {
    player.sendMessage(Common.message("lobbySafeLevel"));
    return true;
  }
  player.sendMessage(Common.message("safeSearch"));
  lobbyAttempt(player, 3);
  return true;
}

module.exports = { crackMaze, crackLobby, spawnLobbyTrap };
