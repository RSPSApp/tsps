/** H.A.M. entrance: its own Wiki success chart, cache multiloc and live capture 3199. */
let core;
const HAM_TRAPDOOR_ID = 5492; // ham_multi_trapdoor is nameless in the cache
const OPEN_VARBIT = 235;
const PICK_ANIMATION = 537;
const OPEN_ANIMATION = 536;
const PICK_SOUND = 2402;
const FAILURE_SOUND = 2581;
const SUCCESS_SOUND = 52;
const ATTEMPT_MESSAGE = "You attempt to pick the lock on the trap door.";
// shortcut: Wiki gives a nine-tick normal unlock; calibrate retry cadence with an uninterrupted normal-world capture.
const ATTEMPT_TICKS = 9;
const attempts = new WeakMap();

function isEntrance(objectId, location) {
  return objectId === HAM_TRAPDOOR_ID && location.x === 3166 && location.y === 3252 && location.z === 0;
}

/** Entrance chart 10/250 bare-handed, 60/254 with a pick; no repeated-failure scaling. */
function successChance(level, lockpick) {
  const [low, high] = lockpick ? [60, 254] : [10, 250];
  const value = Math.floor(low * (99 - level) / 98 + high * (level - 1) / 98 + 0.5);
  return Math.max(0, Math.min(1, (value + 1) / 256));
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function pickLock(player) {
  if (attempts.has(player) || player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < 1) return;
  const origin = player.getLocation().clone();
  const area = player.getPrivateArea();
  const task = new (class extends core.Task {
    constructor() { super(1, player.getIndex()); this.elapsed = 0; }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || !player.getLocation().equals(origin) ||
          player.getPrivateArea() !== area || player.getMovementQueue().isMovementBlocked() ||
          player.getPacketSender().getVarbit(OPEN_VARBIT) === 1 ||
          player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < 1) {
        this.stop();
        return;
      }
      if (++this.elapsed === 1) {
        player.performAnimation(new core.Animation(PICK_ANIMATION));
        player.getPacketSender().sendSound(PICK_SOUND, 1, 0);
      }
      if (this.elapsed < ATTEMPT_TICKS) return;
      const inventory = player.getInventory();
      const lockpick = inventory.contains(core.ItemIdentifiers.LOCKPICK) || inventory.contains(core.ItemIdentifiers.HAIR_CLIP);
      const chance = successChance(player.getSkillManager().getCurrentLevel(core.Skill.THIEVING), lockpick);
      if (Math.random() < chance) {
        spam(player, "You pick the lock on the trapdoor.");
        player.getPacketSender().sendVarbit(OPEN_VARBIT, 1);
        player.performAnimation(new core.Animation(OPEN_ANIMATION));
        player.getPacketSender().sendSound(SUCCESS_SOUND, 1, 0);
        player.getSkillManager().addExperiences(core.Skill.THIEVING, 3.8);
        this.stop();
      } else {
        player.getPacketSender().sendSound(FAILURE_SOUND, 1, 0);
        player.getSkillManager().addExperiences(core.Skill.THIEVING, 0.5);
        // shortcut: occasional numb-finger drain is omitted until its secondary trigger is verified.
        this.elapsed = 0;
        spam(player, ATTEMPT_MESSAGE);
      }
    }
    stop() {
      if (attempts.get(player) === this) attempts.delete(player);
      super.stop();
    }
  })();
  attempts.set(player, task);
  spam(player, ATTEMPT_MESSAGE);
  player.getPacketSender().sendSound(PICK_SOUND, 1, 0);
  core.TaskManager.submit(task);
}

function useTrapdoor(event) {
  const { player, objectId, location, clickType } = event;
  if (!isEntrance(objectId, location) || player.getPrivateArea() !== null || ![1, 2, 5].includes(clickType)) return;
  const opened = player.getPacketSender().getVarbit(OPEN_VARBIT) === 1;
  // The open variant's option 1 is Climb-down; the existing captured transport owns it.
  if (opened && clickType === 1 && !player.getMovementQueue().isMovementBlocked()) return;
  event.handled = true;
  if (player.getMovementQueue().isMovementBlocked()) return;
  if (clickType === 1) player.sendMessage("This trapdoor is locked.");
  else if (clickType === 2 && opened) player.getPacketSender().sendVarbit(OPEN_VARBIT, 0);
  else if (clickType === 5 && !opened) pickLock(player);
}

function arrived({ player, objectId, location }) {
  if (isEntrance(objectId, location)) player.getPacketSender().sendVarbit(OPEN_VARBIT, 0);
}

function cancel({ player }) {
  attempts.get(player)?.stop();
}

module.exports = function attach(api) {
  core = api.core;
  api.onBeforeObjectInteraction(useTrapdoor);
  api.onCustomEvent("loc-teleports:arrived", arrived);
  api.onCustomEvent("player:world-input", cancel);
};
module.exports._test = { successChance };
