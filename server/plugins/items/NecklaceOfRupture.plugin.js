/**
 * The Necklace of rupture (Wiki: Necklace of rupture, Etched elder venator fang, Elder venator fang).
 *
 * Etch: the Elder venator fang's own option, with a chisel and 84 Crafting (boostable), makes the
 * tradeable Etched elder venator fang for no experience. The Wiki's transcript: without a chisel,
 * "Etching an elder venator fang requires a chisel."; with one, "You etch the elder venator fang.".
 *
 * Combining: the etched fang used on a Necklace of anguish (either way round), near a bank and with
 * 84 Crafting (boostable), makes the Necklace of rupture for 500 Crafting experience. The transcript:
 * away from a bank, "Creating a necklace of rupture requires you to be near a bank."; otherwise
 * "Do you wish to create a necklace of rupture using a etched elder venator fang and a necklace of
 * anguish?", "This process is non-reversible and will consume both items.", then "Do you wish to
 * create a necklace of rupture?" Yes. / No., and Yes gives "You carefully craft a necklace of
 * rupture.". Being non-reversible, the necklace has no Dismantle (nor does the cache give it one).
 *
 * Ours: the level messages (the transcript has none) and the dialogue boxes' items. The bank check is
 * LeagueMode's shared `league:near-bank`, as the chugging barrel and the giant egg sac use. The
 * necklace takes the anguish's slot. Only the plain Necklace of anguish (19547) is accepted, not the
 * cache's other copy (27172), and preset (or other untradeable or unbankable) copies are refused.
 */
const LEVEL = 84;
const COMBINE_XP = 500;

const TEXT = {
  noChisel: "Etching an elder venator fang requires a chisel.",
  etched: "You etch the elder venator fang.",
  etchLevel: `You need a Crafting level of ${LEVEL} to etch the elder venator fang.`,
  noBank: "Creating a necklace of rupture requires you to be near a bank.",
  combineLevel: `You need a Crafting level of ${LEVEL} to create a necklace of rupture.`,
  confirm: "Do you wish to create a necklace of rupture using a etched elder venator fang and a necklace of anguish?",
  warning: "This process is non-reversible and will consume both items.",
  title: "Do you wish to create a necklace of rupture?",
  crafted: "You carefully craft a necklace of rupture.",
  preset: "Preset items cannot be used for this.",
};

let api;
let core;

function restricted(item) {
  const { Item } = core;
  return !!item && (item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true);
}

function crafting(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.CRAFTING);
}

function nearBank(player) {
  const query = { player, near: false };
  api.emitCustomEvent("league:near-bank", query);
  return query.near === true;
}

function statement(player, dialogue) {
  const chain = new core.DialogueChainBuilder();
  chain.add(dialogue);
  player.getDialogueManager().startDialogues(chain);
}

/** The slot of an unrestricted copy of the item: the instance that is actually used up. */
function plainSlot(player, id) {
  return player.getInventory().getItems().findIndex((item) => item && item.getId() === id && !restricted(item));
}

/** Etch on the Elder venator fang: the fang becomes the etched one in its own slot. */
function etch({ player, item }) {
  const I = core.ItemIdentifiers;
  const inventory = player.getInventory();
  const slot = inventory.getItems().indexOf(item);
  if (slot < 0 || item.getId() !== I.ELDER_VENATOR_FANG) return false;
  if (!inventory.contains(I.CHISEL)) {
    statement(player, new core.StatementDialogue(0, TEXT.noChisel));
    return true;
  }
  if (crafting(player) < LEVEL) {
    player.sendMessage(TEXT.etchLevel);
    return true;
  }
  inventory.setItem(slot, new core.Item(I.ETCHED_ELDER_VENATOR_FANG, 1));
  inventory.refreshItems();
  statement(player, new core.ItemStatementDialogue(0, I.ETCHED_ELDER_VENATOR_FANG, TEXT.etched));
  return true;
}

/** Everything the combine needs, checked again when Yes is chosen. Sends the refusal and returns false. */
function canCombine(player) {
  if (!nearBank(player)) {
    statement(player, new core.StatementDialogue(0, TEXT.noBank));
    return false;
  }
  if (crafting(player) < LEVEL) {
    player.sendMessage(TEXT.combineLevel);
    return false;
  }
  return true;
}

function craft(player) {
  const I = core.ItemIdentifiers;
  const inventory = player.getInventory();
  const necklace = plainSlot(player, I.NECKLACE_OF_ANGUISH);
  const fang = plainSlot(player, I.ETCHED_ELDER_VENATOR_FANG);
  if (necklace < 0 || fang < 0 || !canCombine(player)) return;
  inventory.deleteAtSlot(fang, 1, false);
  inventory.setItem(necklace, new core.Item(I.NECKLACE_OF_RUPTURE, 1));
  inventory.refreshItems();
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, COMBINE_XP);
  statement(player, new core.ItemStatementDialogue(0, I.NECKLACE_OF_RUPTURE, TEXT.crafted));
}

/** The etched fang used on the Necklace of anguish, or the necklace on the fang. */
function combine({ player, usedItem, usedWithItem }) {
  const I = core.ItemIdentifiers;
  const ids = [usedItem.getId(), usedWithItem.getId()];
  if (!ids.includes(I.NECKLACE_OF_ANGUISH) || !ids.includes(I.ETCHED_ELDER_VENATOR_FANG)) return false;
  if (restricted(usedItem) || restricted(usedWithItem)) {
    player.sendMessage(TEXT.preset);
    return true;
  }
  if (!canCombine(player)) return true;
  const chain = new core.DialogueChainBuilder();
  chain.add(new core.DoubleItemStatementDialogue(0, I.ETCHED_ELDER_VENATOR_FANG, I.NECKLACE_OF_ANGUISH, TEXT.confirm));
  chain.add(new core.DoubleItemStatementDialogue(1, I.ETCHED_ELDER_VENATOR_FANG, I.NECKLACE_OF_ANGUISH, TEXT.warning));
  chain.add(new core.OptionDialogue(2, {
    executeOption(option) {
      player.getDialogueManager().reset();
      if (Number(option) === 1) craft(player);
    },
  }, "Yes.", "No.").setTitle(TEXT.title));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

module.exports = {
  name: "NecklaceOfRupture",
  description: "Etches the Elder venator fang with a chisel, and crafts the etched fang and a Necklace of anguish into the Necklace of rupture near a bank (84 Crafting, 500 XP).",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    api.onItemAction("Elder venator fang", { Etch: etch });
    api.onItemOnItem("Etched elder venator fang", "Necklace of anguish", combine, { noted: false });
  },
  _test: { etch, combine, craft, TEXT, LEVEL, COMBINE_XP },
};
