/**
 * The coffins and the floor 5 Grand Hallowed Coffin. The opening is recorded (rsprox 1862, three
 * coffins): +2 the picklock, +5 the trap disarmed with the push and the Thieving XP, +6 the lid
 * pushed aside, +8 the loot with one "received a drop" line per item and the floor's looted varbit.
 * The loot (Hallowed marks by floor, a low/mid/high tier, the strange old lockpick), the Thieving
 * requirements and the success chart are the Wiki's; the recorded loot is a Leagues world's.
 */
const Common = require("./Common.HallowedSepulchre");
const Obstacles = require("./Obstacles.HallowedSepulchre");

const TIERS = ["low", "mid", "high"];

function successChance(player) {
  const { base, max, lockpick, strangeLockpick } = Common.data.thieving;
  const level = Math.min(max[0], Common.level(player, "THIEVING"));
  let chance = base[1] + ((level - base[0]) * (max[1] - base[1])) / (max[0] - base[0]);
  const inventory = player.getInventory();
  if (inventory.contains(Common.data.items.strangeLockpick)) chance += strangeLockpick;
  else if (inventory.contains(Common.data.items.lockpick)) chance += lockpick;
  return chance / 100;
}

function rollEntry(table) {
  const [id, min, max] = Common.randomOf(Common.data.loot[table]);
  return [id, Common.randomInt(min, max)];
}

/** The Wiki's coffin loot for `floor`: marks, one tier roll, and the lockpick by chance. */
function coffinLoot(floor) {
  const { loot } = Common.data;
  const [min, max] = loot.marks[String(floor)];
  const drops = [[Common.data.items.mark, Common.randomInt(min, max)]];
  const tier = Common.weighted(loot.tiers[String(floor)].map((weight, index) => [TIERS[index], weight]));
  drops.push(rollEntry(tier));
  if (Math.random() < 1 / loot.lockpick[String(floor)]) drops.push([Common.data.items.strangeLockpick, 1]);
  return drops;
}

/** The loot's Hallowed marks after "minigame:points" (a league's tier passive multiplies them). */
function boostMarks(player, loot) {
  return loot.map(([id, amount]) => {
    if (id !== Common.data.items.mark) return [id, amount];
    const award = { player, minigame: "hallowed-sepulchre", points: amount };
    Common.api.emitCustomEvent("minigame:points", award);
    return [id, award.points];
  });
}

/** The Grand Hallowed Coffin (Wiki): 8-10 marks, the high table, the ring at 1/200. */
function grandLoot() {
  const { grand } = Common.data.loot;
  const drops = [[Common.data.items.mark, Common.randomInt(...grand.marks)], rollEntry("high")];
  if (Math.random() < 1 / grand.ringChance) drops.push([grand.ring, 1]);
  return drops;
}

function give(player, drops) {
  const { CacheDefinitions, Item, ItemOnGroundManager } = Common.core;
  for (const [id, amount] of drops) {
    const item = new Item(id, amount);
    if (player.getInventory().getAddableAmount(item) < amount) {
      ItemOnGroundManager.registers(player, item);
    } else {
      player.getInventory().adds(id, amount);
    }
    Common.api.emitCustomEvent("collection-log:obtain", { player, itemId: id, amount });
    const name = CacheDefinitions.getItem(id)?.name ?? "item";
    const text = amount > 1 ? `${amount} x ${name}` : name;
    player.sendMessage(Common.message("drop", { name: player.getDisplayName(), item: text }));
  }
}

function open(event) {
  const found = Obstacles.runAt(event);
  if (!found) return false;
  const { run } = found;
  const { player } = run;
  const which = Common.data.coffins[String(event.objectId)];
  const grand = event.objectId === Common.data.finalChest;
  if (!which && !grand) return false;
  if (run.expired) {
    player.sendMessage(Common.message(grand ? "cantReach" : "coffinSealed"));
    return true;
  }
  const slot = grand ? "grand" : which;
  if (run.looted.has(slot)) {
    player.sendMessage(Common.message("coffinLooted"));
    return true;
  }
  const required = grand ? Common.data.requirements.grandThieving : Common.data.requirements.thieving;
  if (Common.level(player, "THIEVING") < required) {
    player.sendMessage(Common.message("skillLevel", { skill: "Thieving", level: required }));
    return true;
  }
  if (!run.act(8)) return true;
  player.getMovementQueue().reset();
  run.schedule(2, () => Common.animate(player, "picklock"));
  run.schedule(5, () => {
    if (Math.random() >= successChance(player)) {
      player.performAnimation(new Common.core.Animation(-1));
      player.sendMessage(Common.message("coffinFail"));
      Common.core.CombatFactory.poisonEntity(player, Common.data.thieving.poison);
      return;
    }
    Common.spam(player, Common.message("coffinDisarm"));
    Common.animate(player, "pushLid");
    Common.xp(player, "THIEVING", Common.data.xp.coffinThieving);
    run.schedule(1, () => {
      Common.spam(player, Common.message("coffinLid"));
      Common.animate(player, "coffinOpen");
    });
    run.schedule(3, () => {
      if (run.looted.has(slot)) return;
      run.looted.add(slot);
      give(player, boostMarks(player, grand ? grandLoot() : coffinLoot(run.floorNumber)));
      if (which === "a") Common.varbit(player, "hallowed_current_floor_looted", 1);
      if (which === "b") Common.varbit(player, "hallowed_current_floor_looted_b", 1);
      if (grand) Common.varbit(player, "hallowed_final_chest_looted", 1);
      const count = (player.getAttribute(Common.data.attributes.chests) ?? 0) + 1;
      player.setAttribute(Common.data.attributes.chests, count);
      Common.varbit(player, "hallowed_normal_chest_count", count);
    });
  });
  return true;
}

function attachCoffins(api) {
  api.onObjectClick([...Object.keys(Common.data.coffins).map(Number), Common.data.finalChest], 1, open);
}

module.exports = { attachCoffins, coffinLoot, grandLoot, successChance };
