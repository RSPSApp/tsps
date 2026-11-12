"use strict";

const S = require("./Shared.Camdozaal");
const DEPOSIT = "camdozaal_barronite_deposit";
const HAMMERS = ["imcando_hammer", "imcando_hammer_offhand"];
const CRUSHER = "camdozaal_anvil";

/** An ordinary interruptible action: the engine cancels the index-keyed task on movement/click. */
function run(player, step) {
  const { Task, TaskManager } = S.core();
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || !S.inRuins(player) || step(++tick) === false) this.stop();
    }
  })());
}
function hasHammer(player) {
  return player.getInventory().contains(S.core().ItemIdentifiers.HAMMER)
    || HAMMERS.some(name => {
      const id = S.core().CacheDefinitions.getObjId(name);
      return Number.isInteger(id) && (player.getInventory().contains(id) || player.getEquipment().contains(id));
    });
}
function canCrush(player) {
  if (!S.questComplete(player)) return false;
  if (player.getSkillManager().getCurrentLevel(S.core().Skill.SMITHING) < 14) {
    player.sendMessage("You need a Smithing level of 14 to crush barronite deposits.");
    return false;
  }
  if (!hasHammer(player)) {
    player.sendMessage("You need a hammer to crush barronite deposits.");
    return false;
  }
  return player.getInventory().contains(S.obj(DEPOSIT));
}

function crushOne(player) {
  if (!canCrush(player)) return false;
  const inventory = player.getInventory();
  const request = { player, reward: null };
  S.pluginApi().emitCustomEvent("camdozaal:deposit-reward", request);
  if (!request.reward) throw new Error("Camdozaal deposit reward table is unavailable");
  const { itemId, amount } = request.reward;
  const output = new (S.core().Item)(itemId, amount);
  // A nonstackable deposit frees a slot. A full existing shard stack still cannot overflow.
  if (S.core().ItemDefinition.forId(itemId).isStackable()
      && inventory.contains(itemId) && inventory.getAddableAmount(output) < amount) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  inventory.deleteNumber(S.obj(DEPOSIT), 1);
  inventory.addItem(output);
  player.getSkillManager().addExperiences(S.core().Skill.SMITHING, 30);
  player.sendMessage("You crush a barronite deposit with your hammer.");
  player.sendMessage(itemId === S.obj("camdozaal_barronite_shard")
    ? `You find ${amount} barronite shards inside!` : "There's an ancient item inside!");
  return true;
}
function crush(event) {
  const { player } = event;
  if (!S.inRuins(player) || event.objectId !== S.core().CacheDefinitions.getLocId(CRUSHER)) return false;
  if (!canCrush(player)) return;
  const object = event.object;
  run(player, tick => {
    if (!player.getLocation().isWithinDistance(object.getLocation(), 3)) return false;
    if (tick % 4 !== 0) return true;
    return crushOne(player);
  });
  return true;
}
function useDeposit(event) {
  if (event.handled || event.itemId !== S.obj(DEPOSIT) || event.objectId !== S.core().CacheDefinitions.getLocId(CRUSHER)) return;
  event.handled = true;
  crush(event);
}

module.exports = function attach(api) {
  api.onObjectInteraction("Barronite Crusher", { Smith: crush });
  api.onItemOnObject(useDeposit);
};
module.exports.run = run;
