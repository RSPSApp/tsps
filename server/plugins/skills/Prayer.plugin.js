const { BONE_XP: BONES } = require("../../src/main/typescript/elvarg/game/content/combat/magic/ArceuusOfferings");
const BURY_DELAY_MS = 1200; // Two OSRS game ticks.

function buryBone(api, { player, itemId, slot }) {
  const core = api.core;
  const xp = BONES.get(itemId);
  if (!xp) return false;
  if (!player.getClickDelay().elapsedTime(BURY_DELAY_MS)) return true;
  const inventory = player.getInventory();
  if (inventory.get(slot)?.getId() !== itemId) return true;

  player.getSkillManager().stopSkillable();
  player.getPacketSender().sendInterfaceRemoval();
  player.performAnimation(new core.Animation(827));
  core.Sounds.sendSound(player, core.Sound.BURY_BONES);
  const location = player.getLocation().clone();
  // Consume and award XP together on the resolving tick. An interrupted burial
  // keeps its bone, including on logout before the account is saved.
  const task = new core.CountdownTask(player, 2, () => {
    if (!canComplete() || inventory.get(slot)?.getId() !== itemId) return;
    inventory.deleteAtSlot(slot, 1);
    player.sendMessage("You dig a hole in the ground..");
    player.sendMessage(`..and bury the ${core.ItemDefinition.forId(itemId).getName()}.`);
    player.getSkillManager().addExperiences(core.Skill.PRAYER, xp);
  });
  function canComplete() {
    return player.isRegistered() && player.getHitpoints() > 0 &&
      player.getLocation().equals(location) && player.getMovementQueue().size() === 0 &&
      player.getForceMovement() == null;
  }
  task.onTick = () => { if (!canComplete()) task.stop(); };
  const stop = task.stop.bind(task);
  task.stop = () => {
    stop();
    if (player.isRegistered()) player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  };
  api.getTaskManager().submit(task);
  player.getClickDelay().reset();
  return true;
}

module.exports = {
  name: "Prayer",
  register(api) {
    api.onItemFirstAction(buryBone.bind(null, api));
  },
};
