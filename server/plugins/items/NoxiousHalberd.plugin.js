/** Noxious halberd assembly (Wiki: Noxious halberd, Creation). */
const PIECES = [
  ["NOXIOUS_POINT", "point"],
  ["NOXIOUS_BLADE", "blade"],
  ["NOXIOUS_POMMEL", "pommel"],
];
const LEVEL = 72;
const XP = 100;
/** Review of #6084 citing rsprox_transcripts/227/01768.txt: Yes at 22081, the animation at 22082, the halberd with sound 6647 and its item box at 22085. */
const SEQUENCE = "human_fletching_noxious_halberd";
const SOUND = 6647;
const ANIMATION_TICK = 1;
const ASSEMBLED_TICK = 4;
const ASSEMBLED = "You successfully create a noxious halberd.";

let api;
let pieces;

function resolve() {
  if (pieces) return pieces;
  const { ItemIdentifiers: I } = api.core;
  pieces = PIECES.map(([id, name]) => ({ id: I[id], name }));
  return pieces;
}

function canAssemble(player) {
  const inventory = player.getInventory();
  const all = resolve();
  const missing = all.find(({ id }) => !inventory.contains(id));
  if (missing) {
    player.sendMessage(`Creating a noxious halberd requires at least one noxious ${missing.name}.`);
    return false;
  }
  const { Skill } = api.core;
  const skills = player.getSkillManager();
  if (skills.getCurrentLevel(Skill.CRAFTING) < LEVEL || skills.getCurrentLevel(Skill.SMITHING) < LEVEL) {
    player.sendMessage("Creating a Noxious Halberd requires level 72 crafting & smithing.");
    return false;
  }
  return true;
}

/** Yes: the animation a tick later, the halberd three ticks after that, if everything is still there. */
function assemble(player) {
  if (!canAssemble(player)) return;
  const { Animation, CacheDefinitions, Task, TaskManager } = api.core;
  let elapsed = 0;
  TaskManager.submit(new (class NoxiousHalberdTask extends Task {
    constructor() { super(1, player, false); }
    execute() {
      elapsed++;
      if (elapsed === ANIMATION_TICK) {
        const sequence = CacheDefinitions.getSeqId(SEQUENCE);
        if (sequence != null) player.performAnimation(new Animation(sequence));
      }
      if (elapsed < ASSEMBLED_TICK) return;
      this.stop();
      finish(player);
    }
  })());
}

/** Rechecked: a piece may have been dropped or banked, or a boost run out, meanwhile. */
function finish(player) {
  if (!canAssemble(player)) return;
  const { ItemIdentifiers: I, Skill, DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = api.core;
  const inventory = player.getInventory();
  for (const { id } of resolve()) inventory.deleteNumber(id, 1);
  inventory.adds(I.NOXIOUS_HALBERD, 1);
  player.getSkillManager().addExperiences(Skill.CRAFTING, XP);
  player.getSkillManager().addExperiences(Skill.SMITHING, XP);
  player.getPacketSender().sendSoundEffect(SOUND, 1, 0, 255);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, I.NOXIOUS_HALBERD, ASSEMBLED),
    new EndDialogue(1),
  ));
}

function combine({ player, usedItemId, usedWithItemId }) {
  const all = resolve();
  if (!all.some(({ id }) => id === usedItemId) || !all.some(({ id }) => id === usedWithItemId)) return false;
  if (!canAssemble(player)) return true;
  const { DialogueChainBuilder, DoubleItemStatementDialogue, ActionDialogue } = api.core;
  const chain = new DialogueChainBuilder();
  chain.add(new DoubleItemStatementDialogue(0, usedItemId, usedWithItemId,
    "Do you wish to combine all three pieces to create a noxious halberd? This process is non-reversible."));
  chain.add(new ActionDialogue(1, {
    execute: () => api.sendMultiChatboxPrompt(player, "Do you wish to create a noxious halberd?",
      "Yes.", () => assemble(player), "No.", () => {}),
  }));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

module.exports = {
  name: "NoxiousHalberd",
  description: "Combine the noxious point, blade, and pommel into the noxious halberd.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onItemOnItem("Noxious point", "Noxious blade", combine, { noted: false });
    api.onItemOnItem("Noxious point", "Noxious pommel", combine, { noted: false });
    api.onItemOnItem("Noxious blade", "Noxious pommel", combine, { noted: false });
  },
  _test: { combine, assemble, resolve, SEQUENCE, SOUND, ASSEMBLED_TICK },
};
