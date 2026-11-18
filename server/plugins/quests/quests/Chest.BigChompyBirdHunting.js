/**
 * Rantz's rock-weighted chest (Locked Ogre chest 3377 -> Unlocked Ogre chest 3378, Rantz's cave).
 *
 * Wiki (Locked Ogre chest): Unlock is a Strength roll, low 30 / high 254 on the skilling success chart,
 * and a failed attempt lowers Strength by 1. Wiki (Transcript:Locked Ogre chest, Unlocked Ogre chest):
 * "Humph!", "You manage to lift the huge rock off the chest.", "I guess this is what an ogre would call a
 * locked chest."; the open chest's Search asks how many bellows to take, up to a full inventory, and says
 * "You take [number] pairs of bellows.".
 *
 * The user's rev 242 capture (docs/quests/big-chompy-bird-hunting/README.md) for the timing:
 * - a tick after arriving, human_pickuptable (832) and "Humph!" (ticks 645, 1739, 1747);
 * - success a tick later: the message, the second overhead line and the loc swap to 3378 (646, 1748);
 *   the quest moves from 15 to 20 on that tick (646);
 * - failure: "You strain to lift the huge rock off the chest..." a tick later, two ticks after that
 *   "... but it's just too heavy for you.<br>The experience has left you feeling temporarily weakened.",
 *   "Arrgghhhhh!" and Strength one lower (1740, 1742);
 * - Search: human_openchest (536) and skillmulti mode 23 "How many would you like to take?", the free
 *   slots as its maximum (649, 1750), then an item box "You take a pair of bellows." /
 *   "You take 8 pairs of bellows." (651, 1753).
 *
 * Ours: the chest locks again 100 ticks after it is opened (the Wiki only says "it may lock again");
 * Unlock before Rantz has explained the toads (stage 15) does nothing, with "Nothing interesting happens."
 * (the Wiki says the chest can't be opened then, without the wording).
 */
module.exports = function createChompyChest(api, { stageOf, onLifted }) {
  const { Animation, Skill, Location, GameObject, ObjectManager, CreationMenu, ItemStatementDialogue, ItemIdentifiers,
    TaskManager, CountdownTask } = api.core;

  const LOCKED = api.core.ObjectIdentifiers.LOCKED_OGRE_CHEST;
  const OPEN = api.core.ObjectIdentifiers.UNLOCKED_OGRE_CHEST;
  const BELLOWS = ItemIdentifiers.OGRE_BELLOWS;
  const STAGE_KIDS_EXPLAINED_TOADS = 15;
  const LIFT_ANIMATION = 832;
  const SEARCH_ANIMATION = 536;
  const LIFT_LOW = 30;
  const LIFT_HIGH = 254;
  const RELOCK_TICKS = 100;
  /** Players mid-lift: the capture holds the player until the lift's last line. */
  const lifting = new WeakSet();
  const TAKE_MENU_MODE = 23;
  const TAKE_PROMPT = "How many would you like to take?";
  const NO_SPACE = "Rantz stores ogre bellows in here, but you don't have space to hold any.";
  const STRAIN = "You strain to lift the huge rock off the chest...";
  const TOO_HEAVY = "... but it's just too heavy for you.<br>The experience has left you feeling temporarily weakened.";
  const LIFTED = "You manage to lift the huge rock off the chest.";

  /** Wiki skilling success chart: (1 + floor(low * (99 - L) / 98 + high * (L - 1) / 98 + 0.5)) / 256. */
  function liftChance(level) {
    const clamped = Math.max(1, Math.min(99, level));
    return Math.min(1, (1 + Math.floor((LIFT_LOW * (99 - clamped)) / 98 + (LIFT_HIGH * (clamped - 1)) / 98 + 0.5)) / 256);
  }

  function later(player, ticks, run) {
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() !== false) run();
    }));
  }

  function swap(object, id) {
    const at = object.getLocation();
    ObjectManager.deregister(object, true);
    const next = new GameObject(id, new Location(at.getX(), at.getY(), at.getZ()), object.getType(), object.getFace(),
      object.getPrivateArea?.() ?? null);
    ObjectManager.register(next, true);
    return next;
  }

  function unlock(event) {
    const { player, object } = event;
    if (stageOf(player) < STAGE_KIDS_EXPLAINED_TOADS) {
      player.sendMessage("Nothing interesting happens.");
      return true;
    }
    // One lift at a time (the capture holds the player through it, ticks 645-646 and 1739-1742).
    if (lifting.has(player)) return true;
    lifting.add(player);
    later(player, 1, () => {
      player.performAnimation(new Animation(LIFT_ANIMATION));
      player.forceChat("Humph!");
      const skills = player.getSkillManager();
      if (Math.random() < liftChance(skills.getCurrentLevel(Skill.STRENGTH))) {
        later(player, 1, () => {
          lifting.delete(player);
          lifted(player, object);
        });
        return;
      }
      later(player, 1, () => player.sendMessage(STRAIN));
      later(player, 3, () => {
        player.sendMessage(TOO_HEAVY);
        player.forceChat("Arrgghhhhh!");
        lifting.delete(player);
        skills.setCurrentLevel(Skill.STRENGTH, Math.max(0, skills.getCurrentLevel(Skill.STRENGTH) - 1));
      });
    });
    return true;
  }

  function lifted(player, object) {
    player.sendMessage(LIFTED);
    player.forceChat("I guess this is what an ogre would call a locked chest.");
    onLifted(player);
    if (object?.getId?.() !== LOCKED) return;
    const open = swap(object, OPEN);
    TaskManager.submit(new CountdownTask(open, RELOCK_TICKS, () => swap(open, LOCKED)));
  }

  function search({ player }) {
    player.performAnimation(new Animation(SEARCH_ANIMATION));
    const free = player.getInventory().getFreeSlots();
    if (free <= 0) {
      player.sendMessage(NO_SPACE);
      return true;
    }
    player.getPacketSender().sendCreationMenu(new CreationMenu(TAKE_PROMPT, [BELLOWS],
      { execute: (_itemId, amount) => take(player, amount) },
      { mode: TAKE_MENU_MODE, maxAmount: free, lastAmount: 1 }));
    return true;
  }

  function take(player, amount) {
    const count = Math.min(Math.max(1, Math.trunc(amount) || 1), player.getInventory().getFreeSlots());
    if (count <= 0) {
      player.sendMessage(NO_SPACE);
      return;
    }
    for (let i = 0; i < count; i++) player.getInventory().adds(BELLOWS, 1);
    player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(new ItemStatementDialogue(0, BELLOWS, count === 1 ? "You take a pair of bellows." : `You take ${count} pairs of bellows.`)));
  }

  return { unlock, search, liftChance, LOCKED, OPEN };
};
