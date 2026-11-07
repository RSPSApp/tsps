/**
 * Saturating an imbued heart (https://oldschool.runescape.wiki/w/Saturated_heart): ancient essence
 * used on it, 150,000 of it, after a confirmation. Captured in rsprox 1767 (too few: an item box
 * with the heart), 1774 (a message box with the warning, then "Yes." / "No."; on Yes the essence is
 * spent, the heart changes in place, a ground graphic and synth 6654 play, and an item box confirms
 * it). The Wiki recipe needs Magic 1 and gives 500 Magic experience; the capture is from Leagues,
 * whose experience rates differ, so it is not used for the amount.
 */
const ESSENCE_NEEDED = 150_000;
const MAGIC_EXPERIENCE = 500;
const SATURATE_SOUND = 6654;
const SATURATE_GRAPHIC = "imbued_heart_impact03";
// Captured as a ground graphic with this delay at the player's tile.
const SATURATE_GRAPHIC_DELAY = 70;

const MISSING_TEXT = `You'll need 150,000 ancient essence to saturate your<br>imbued heart.`;
const WARNING_TEXT = `Do you wish to use 150,000 ancient essence to saturate your imbued heart? This process is non-reversible.`;
const CONFIRM_TITLE = "Do you wish to saturate your imbued heart?";
const DONE_TEXT = `You use 150,000 ancient essence to saturate your<br>imbued heart, turning it into a saturated heart.`;

let core = null;

function heartSlot(player) {
  const inventory = player.getInventory();
  const { IMBUED_HEART: imbued } = core.ItemIdentifiers;
  return inventory.getItems().findIndex((item) => item && item.getId() === imbued && item.getAmount() > 0);
}

function saturate(player) {
  const { ItemIdentifiers, Skill, Item } = core;
  const inventory = player.getInventory();
  const slot = heartSlot(player);
  if (slot < 0 || inventory.getAmount(ItemIdentifiers.ANCIENT_ESSENCE) < ESSENCE_NEEDED) return;
  inventory.deleteNumber(ItemIdentifiers.ANCIENT_ESSENCE, ESSENCE_NEEDED);
  inventory.setItem(slot, new Item(ItemIdentifiers.SATURATED_HEART, 1));
  inventory.refreshItems();
  const graphicId = core.CacheDefinitions.getSpotanimId(SATURATE_GRAPHIC);
  player.getPacketSender().sendGraphic(new core.Graphic(graphicId, SATURATE_GRAPHIC_DELAY), player.getLocation());
  player.getPacketSender().sendSoundEffect(SATURATE_SOUND, 1, 0);
  player.getSkillManager().addExperience(Skill.MAGIC, MAGIC_EXPERIENCE, true);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.ItemStatementDialogue(0, ItemIdentifiers.SATURATED_HEART, DONE_TEXT),
  ));
}

/** Ancient essence on an imbued heart. */
function useEssence(event) {
  const { player } = event;
  const { DialogueChainBuilder, ItemStatementDialogue, StatementDialogue, OptionDialogue, ItemIdentifiers } = core;
  event.handled = true;
  if (player.getInventory().getAmount(ItemIdentifiers.ANCIENT_ESSENCE) < ESSENCE_NEEDED) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ItemStatementDialogue(0, ItemIdentifiers.IMBUED_HEART, MISSING_TEXT),
    ));
    return;
  }
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, WARNING_TEXT),
    new OptionDialogue(1, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) saturate(player);
      },
    }, "Yes.", "No.").setTitle(CONFIRM_TITLE),
  ));
}

function attach(api) {
  core = api.core;
  api.onItemOnItem("Ancient essence", "Imbued heart", useEssence, { noted: false });
}

module.exports = { ESSENCE_NEEDED, MAGIC_EXPERIENCE, saturate, useEssence, attach };
