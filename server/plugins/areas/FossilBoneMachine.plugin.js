/** Fossil Island's eastern strange machine: enriched bones become Prayer XP. */
const MACHINE = "fossil_lab_bone_grinder";
const BONES = new Map([
  ["fossil_enriched_bone_small", 500],
  ["fossil_enriched_bone_medium", 1000],
  ["fossil_enriched_bone_large", 1500],
  ["fossil_enriched_bone_rare", 2500],
]);
let core;

function useBone(event) {
  const { player, object, objectId, itemId, itemSlot } = event;
  if (objectId !== core.CacheDefinitions.getLocId(MACHINE)) return false;
  const values = new Map([...BONES].map(([name, xp]) => [core.CacheDefinitions.getObjId(name), xp]));
  if (!values.has(itemId)) return false;
  event.handled = true;
  const inventory = player.getInventory();
  if (inventory.get(itemSlot)?.getId() !== itemId) return true;

  player.getSkillManager().stopSkillable();
  const start = player.getLocation().clone();
  const area = player.getPrivateArea();
  let slot = itemSlot;
  let phase = 0;
  let machineActive = false;
  let pendingId = itemId;
  const animateMachine = (name) => {
    const animation = new core.Animation(core.CacheDefinitions.getSeqId(name));
    for (const viewer of new Set([player, ...(player.getLocalPlayers?.() ?? [])])) {
      viewer.getPacketSender().sendObjectAnimation(object, animation);
    }
  };
  const action = { cancel: () => task.stop() };
  const valid = () => player.isRegistered() && player.getHitpoints() > 0 &&
    player.getSkill() === action && player.getLocation().equals(start) &&
    player.getPrivateArea() === area && player.getMovementQueue().size() === 0;
  const task = new (class extends core.Task {
    constructor() { super(1, player, false); }
    execute() {
      if (!valid() || inventory.get(slot)?.getId() !== pendingId) return this.stop();
      if (phase === 0) {
        player.setPositionToFace(object.getLocation());
        player.sendMessage("You feed the bone into the machine.");
        player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_pickuptable")));
        player.getPacketSender().sendSoundEffect(127, 1, 0, 1);
        animateMachine("fi_dkl_bone_machine_active");
        machineActive = true;
        phase = 1;
        return;
      }
      inventory.deleteAtSlot(slot, 1);
      player.getSkillManager().addExperiences(core.Skill.PRAYER, values.get(pendingId));
      // Ours: after the selected bone, process other enriched sizes in inventory order.
      slot = inventory.getItems().findIndex((item) => item && values.has(item.getId()));
      if (slot < 0) {
        return this.stop();
      }
      pendingId = inventory.get(slot).getId();
      phase = 0;
    }
    stop() {
      if (!this.isRunning()) return;
      if (machineActive) animateMachine("fi_dkl_bone_machine_inactive");
      super.stop();
      if (player.getSkill() === action) player.setSkill(null);
    }
  })();
  player.setSkill(action);
  core.TaskManager.submit(task);
  return true;
}

module.exports = {
  name: "FossilBoneMachine",
  description: "Feed enriched bones into Fossil Island's strange machine for Prayer experience.",
  members: true,
  register(api) {
    core = api.core;
    api.onItemOnObject("Small enriched bone", "Strange Machine", useBone, { noted: false });
    api.onItemOnObject("Medium enriched bone", "Strange Machine", useBone, { noted: false });
    api.onItemOnObject("Large enriched bone", "Strange Machine", useBone, { noted: false });
    api.onItemOnObject("Rare enriched bone", "Strange Machine", useBone, { noted: false });
  },
};
