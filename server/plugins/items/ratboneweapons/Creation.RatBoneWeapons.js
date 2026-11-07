/**
 * Making the rat bone weapons (Wiki: Bone mace, Bone shortbow, Bone staff; captured, docs/scurrius.md):
 * - Scurrius' spine on an anvil with a rune mace and a hammer: the bone mace (35 Smithing);
 *   the spine on the mace itself says to use an anvil;
 * - a yew shortbow with the spine and a knife: the bone shortbow (35 Fletching);
 * - a battlestaff with the spine, 1,000 chaos runes and a chisel: the bone staff, holding the runes
 *   as its first 1,000 charges (35 Crafting);
 * each for 300 experience, with "You attach the Scurrius' spine to the ... to create the ...".
 * - Historian Aldo makes any of them for 50,000 coins, no level or tool needed: his transcript's
 *   materials conditions and "Aldo handed the ... to you." steps are answered here.
 */
const Common = require("./Common.RatBoneWeapons");
const Staff = require("./Staff.RatBoneWeapons");
const { plainAmount, takePlain } = require("../PoweredStaff");

const LEVEL = 35;
const EXPERIENCE = 300;
const ALDO_FEE = 50000;
const ALDO = "Historian Aldo";
/** Cache rat_boss_biologist, the Aldo outside the lair. */
const ALDO_NPC = 12606;
const NO_MATERIALS = /^If the player does not have the materials in their inventory:$/i;
const HAS_MATERIALS = /^If the player does have the materials in their inventory:$/i;
const HANDED = /^Aldo handed the (Bone mace|Bone shortbow|Bone staff) to you\.$/;

let core = null;

const weaponBy = (field, value) => Common.weapons.find((weapon) => weapon[field] === value) ?? null;

function hasMaterials(player, weapon) {
  const inventory = player.getInventory();
  const I = core.ItemIdentifiers;
  return inventory.contains(I.SCURRIUS_SPINE) && inventory.contains(weapon.base)
    && plainAmount(inventory, I.CHAOS_RUNE) >= (weapon.chaosRunes ?? 0);
}

function itemBox(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

/** Takes the materials and hands over the weapon (a new bone staff holds its chaos runes as charges). */
function make(player, weapon) {
  const inventory = player.getInventory();
  const I = core.ItemIdentifiers;
  // The base becomes the weapon in place (setId keeps its meta: a preset mace makes a preset bone mace), and
  // only plain chaos runes become a bone staff's charges, since Uncharge refunds plain runes.
  inventory.delete(I.SCURRIUS_SPINE, 1);
  if (weapon.chaosRunes) takePlain(inventory, I.CHAOS_RUNE, weapon.chaosRunes);
  let item = inventory.getItems?.().find((held) => held?.getId() === weapon.base);
  if (item) {
    item.setId(weapon.id);
  } else {
    // A container without slots (a test stand-in): the old delete and add.
    inventory.delete(weapon.base, 1);
    item = new core.Item(weapon.id, 1);
  }
  if (weapon.chaosRunes) Staff.setCharges(item, weapon.chaosRunes);
  if (!inventory.getItems) inventory.addItem(item);
  inventory.refreshItems?.();
}

/** The player's own creation: the tool, the level, the materials, then the weapon. */
function craft(player, weapon) {
  const inventory = player.getInventory();
  if (!inventory.contains(weapon.tool)) {
    player.sendMessage(`You'll need a ${weapon.toolName} to do that.`);
    return;
  }
  if (player.getSkillManager().getCurrentLevel(weapon.skill) < LEVEL) {
    player.sendMessage(`You need a ${weapon.skillName} level of ${LEVEL} to do that.`);
    return;
  }
  if (!hasMaterials(player, weapon)) {
    player.sendMessage(`You need ${weapon.chaosRunes.toLocaleString("en-GB")} chaos runes and a Scurrius' spine to create the ${weapon.name}.`);
    return;
  }
  make(player, weapon);
  player.performAnimation(new core.Animation(weapon.anim));
  if (weapon.gfx) player.performGraphic(new core.Graphic(weapon.gfx));
  if (weapon.sound) player.getPacketSender().sendSound(weapon.sound, 1, 0);
  player.getSkillManager().addExperience(weapon.skill, EXPERIENCE);
  itemBox(player, weapon.id, `You attach the Scurrius' spine to the ${weapon.baseName} to create the ${weapon.name}.`);
}

/** The spine with a yew shortbow (fletched), a battlestaff (crafted) or a rune mace (needs an anvil). */
function spineOnItem(event) {
  const I = core.ItemIdentifiers;
  const ids = [Number(event.usedItemId), Number(event.usedWithItemId)];
  if (!ids.includes(I.SCURRIUS_SPINE)) return;
  const other = ids[0] === I.SCURRIUS_SPINE ? ids[1] : ids[0];
  const weapon = weaponBy("base", other);
  if (!weapon) return;
  event.handled = true;
  if (weapon.key === "mace") {
    event.player.sendMessage("I should probably smith this at an anvil...");
    return;
  }
  craft(event.player, weapon);
}

function spineOnAnvil({ player }) {
  craft(player, weaponBy("key", "mace"));
  return true;
}

function isAldo(definition) {
  return definition?.getName?.() === ALDO;
}

function canPay(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS) >= ALDO_FEE;
}

/** Aldo's "materials in their inventory" conditions: any one weapon's, and his fee. */
function dialogueCondition({ player, definition, text }) {
  if (!isAldo(definition)) return null;
  const any = canPay(player) && Common.weapons.some((weapon) => hasMaterials(player, weapon));
  if (NO_MATERIALS.test(String(text).trim())) return !any;
  if (HAS_MATERIALS.test(String(text).trim())) return any;
  return null;
}

/** "Aldo handed the Bone mace to you.": he takes the fee and materials, shown in an item box. */
function dialogueAction(message) {
  if (message.kind !== "message" || !isAldo(message.definition)) return;
  const match = HANDED.exec(String(message.text ?? ""));
  if (!match) return;
  const weapon = weaponBy("name", match[1]);
  const { player } = message;
  message.handled = true;
  if (!weapon || !canPay(player) || !hasMaterials(player, weapon)) {
    const { DialogueChainBuilder, NpcDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new NpcDialogue(0, message.npc?.getId?.() ?? ALDO_NPC, "Come back when you have all the necessary materials.")));
    return;
  }
  player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, ALDO_FEE);
  make(player, weapon);
  message.box = { items: [weapon.id] };
}

function attach(api) {
  core = api.core;
  api.onItemOnItem(spineOnItem, { noted: false });
  api.onItemOnObject("Scurrius' spine", "Anvil", spineOnAnvil, { noted: false });
  api.onNpcDialogueCondition(dialogueCondition);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
}

module.exports = { attach, _test: { LEVEL, EXPERIENCE, ALDO_FEE, hasMaterials, craft, spineOnItem, spineOnAnvil, dialogueCondition, dialogueAction } };
