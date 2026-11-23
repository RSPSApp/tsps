/**
 * The three Voidwaker pieces the Wilderness bosses drop (the hilt from Callisto and Artio, the
 * blade from Vet'ion and Calvar'ion, the gem from Venenatis and Spindel).
 *
 * Wiki (Voidwaker hilt, Voidwaker blade, Voidwaker gem): "When inspected, a message in the
 * chatbox states" each piece's line below. Wiki (Voidwaker): "Attempting to combine the pieces
 * on your own displays the message" COMBINE_MESSAGE; Madam Sikaro in the Ferox Enclave Dungeon
 * assembles them for 500,000 coins (docs/wilderness-bosses.md).
 */
const PIECES = Object.freeze({
  "Voidwaker hilt": "A sturdy hilt. It's part of what looks to be a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?",
  "Voidwaker blade": "A sharp blade. It looks to be the deadliest part of a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?",
  "Voidwaker gem": "A magical gem. It looks like it could be fitted into a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?",
});
const COMBINE_MESSAGE = "You don't think you have the skills to reassemble this weapon yourself.";
const ASSEMBLY_FEE = 500000;
const ASSEMBLY_STEP_ID = "SANVF-";
const SHUFFLE_STEP_ID = "mcTZwC";
const ASSEMBLED_ATTRIBUTE = "wilderness-bosses:madam-sikaro-assembled";
// Recorded by rsprox at (3175, 10040, 0), facing west. The blocked tile is the counter position;
// the player can reach her from the open tile immediately west at (3174, 10040).
const MADAM_SIKARO_SPAWN = Object.freeze({ x: 3175, y: 10040, z: 0 });
const ASSEMBLY_PARTS = Object.freeze(["VOIDWAKER_HILT", "VOIDWAKER_BLADE", "VOIDWAKER_GEM"]);
const VOIDWAKER_USE_VARIANT = "standard-dialogue-using-the-voidwaker-on-her";
const OTHER_ITEM_USE_VARIANT = "standard-dialogue-using-any-other-item-on-her";
const REFUSAL_TEXT = "You need the three unassembled Voidwaker parts and 500,000 coins to make the weapon.";

let core;

function npcId() {
  return core.NpcIdentifiers.MADAM_SIKARO;
}

function hasAllParts(player) {
  const inventory = player.getInventory();
  return ASSEMBLY_PARTS.every((name) => inventory.getAmount(core.ItemIdentifiers[name]) > 0);
}

function hasAnyPart(player) {
  const inventory = player.getInventory();
  return ASSEMBLY_PARTS.some((name) => inventory.getAmount(core.ItemIdentifiers[name]) > 0);
}

function answerCondition({ player, npcId: targetId, text }) {
  if (targetId !== npcId() || !player) return null;
  switch (text) {
    case "If the player has a part of the Voidwaker:":
      return hasAnyPart(player);
    case "If the player has all three parts of the Voidwaker:":
      return hasAllParts(player);
    case "If the player has less than three parts of the Voidwaker:":
      return !hasAllParts(player);
    case "If the player has less than 500,000 coins:":
      return player.getInventory().getAmount(core.ItemIdentifiers.COINS) < ASSEMBLY_FEE;
    case "If the player has at least 500,000 coins:":
      return player.getInventory().getAmount(core.ItemIdentifiers.COINS) >= ASSEMBLY_FEE;
    case "If the player has had Madam Sikaro assemble the Voidwaker:":
      return player.getAttribute(ASSEMBLED_ATTRIBUTE) === true;
    default:
      return null;
  }
}

/** Recheck the offer at its confirmation step, then exchange three parts and the fee atomically. */
function assembleVoidwaker(event) {
  if (event.npcId !== npcId() || event.kind !== "message" || event.stepId !== ASSEMBLY_STEP_ID) return;
  const { player } = event;
  const inventory = player.getInventory();
  if (!hasAllParts(player) || inventory.getAmount(core.ItemIdentifiers.COINS) < ASSEMBLY_FEE) {
    // Ours: the Wiki transcript has no refusal line for an offer invalidated after confirmation.
    event.text = REFUSAL_TEXT;
    event.box = { statement: true };
    return;
  }

  for (const name of ASSEMBLY_PARTS) inventory.deleteNumber(core.ItemIdentifiers[name], 1);
  inventory.deleteNumber(core.ItemIdentifiers.COINS, ASSEMBLY_FEE);
  inventory.add(new core.Item(core.ItemIdentifiers.VOIDWAKER, 1));
  player.setAttribute(ASSEMBLED_ATTRIBUTE, true);
}

/** The transcript's No response says the contents of the inventory shift slightly. */
function shuffleInventory(event) {
  if (event.npcId !== npcId() || event.kind !== "message" || event.stepId !== SHUFFLE_STEP_ID) return;
  const inventory = event.player.getInventory();
  const items = inventory.getItems();
  const before = items.slice();
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  // Even an unlucky random permutation must visibly shift the inventory when it has contents.
  if (items.filter((item) => item && item.getId() >= 0).length > 1
    && items.every((item, slot) => item === before[slot])) {
    [items[0], items[1]] = [items[1], items[0]];
  }
  inventory.refreshItems();
}

function itemOnMadamSikaro(api, event) {
  if (event.npcId !== npcId() || !event.player) return;
  const variant = event.itemId === core.ItemIdentifiers.VOIDWAKER
    ? VOIDWAKER_USE_VARIANT
    : OTHER_ITEM_USE_VARIANT;
  const request = {
    player: event.player, npc: event.target, npcId: event.npcId,
    variant: { page: "Madam Sikaro", variant }, exact: true, handled: false,
  };
  api.emitCustomEvent("npc-dialogue:start", request);
  event.handled = request.handled === true;
}

/** Inspect: the piece's line in the chat. */
function inspectPiece({ player, itemId }) {
  const line = PIECES[core.ItemDefinition.forId(itemId).getName()];
  if (!line) return false;
  player.sendMessage(line);
  return true;
}

/** One piece used on another: the player can't put the weapon together. */
function combinePieces({ player }) {
  player.sendMessage(COMBINE_MESSAGE);
  return true;
}

function attach(api) {
  core = api.core;
  api.persistAttribute(ASSEMBLED_ATTRIBUTE, false);
  api.spawnNpc({
    id: npcId(),
    ...MADAM_SIKARO_SPAWN,
    face: core.Direction.WEST.getId(),
    wanderRadius: 0,
    unique: "wilderness-bosses:madam-sikaro",
  });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", assembleVoidwaker);
  api.onCustomEvent("npc-dialogue:action", shuffleInventory);
  api.onItemOnNpc(itemOnMadamSikaro.bind(null, api));
  for (const name of Object.keys(PIECES)) api.onItemAction(name, { Inspect: inspectPiece });
  const names = Object.keys(PIECES);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) api.onItemOnItem(names[i], names[j], combinePieces, { noted: false });
  }
}

module.exports = { attach, _test: {
  PIECES, COMBINE_MESSAGE, ASSEMBLY_FEE, ASSEMBLY_STEP_ID, SHUFFLE_STEP_ID, ASSEMBLY_PARTS,
  ASSEMBLED_ATTRIBUTE, MADAM_SIKARO_SPAWN, answerCondition, assembleVoidwaker, shuffleInventory,
  itemOnMadamSikaro, inspectPiece, combinePieces,
} };
