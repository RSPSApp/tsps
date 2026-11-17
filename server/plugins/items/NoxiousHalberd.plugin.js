/** Noxious halberd assembly (Wiki: Noxious halberd, Creation). */
const PIECES = [
  ["NOXIOUS_POINT", "point"],
  ["NOXIOUS_BLADE", "blade"],
  ["NOXIOUS_POMMEL", "pommel"],
];
const LEVEL = 72;
const XP = 100;

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

function assemble(player) {
  if (!canAssemble(player)) return;
  const { ItemIdentifiers: I, Skill } = api.core;
  const inventory = player.getInventory();
  const all = resolve();
  for (const { id } of all) inventory.deleteNumber(id, 1);
  inventory.adds(I.NOXIOUS_HALBERD, 1);
  player.getSkillManager().addExperiences(Skill.CRAFTING, XP);
  player.getSkillManager().addExperiences(Skill.SMITHING, XP);
  player.sendMessage("You successfully create a noxious halberd.");
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
  _test: { combine, assemble, resolve },
};
