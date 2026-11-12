/**
 * A gem on a silver sickle (b): the emerald, ruby and diamond sickles of the Myreque quests.
 *
 * rsprox captures (ruby: recordings 102 and 1637 ticks 4380 and 6134; diamond: recording 4288
 * tick 22094): the use opens a Yes/No chat menu, "Craft a ruby sickle?". On Yes, the same tick
 * sends "You embed the ruby into the sickle." as a mesbox line and an item box (objectbox 193)
 * with the new sickle, the gem's cutting animation, sound 2586 and the Crafting XP; the gem and
 * the sickle go and the sickle (b) takes the freed slot.
 *
 * Wiki (Emerald/Ruby/Diamond sickle (b)): 20/26/32 Crafting XP, a chisel needed. The quest that
 * asks for the sickle decides when it can be made: this unit asks ("crafting:gem-sickle-allowed",
 * { player, product, allowed }) and leaves the use alone unless one says yes.
 */
const Shared = require("./Shared.Crafting");

const GEM_SICKLE_ALLOWED_EVENT = "crafting:gem-sickle-allowed";
const SILVER_SICKLE_B = "Silver sickle (b)";
const GEM_CUTTING_SOUND = 2586;

let sickles = null;

/** The gem sickles from crafting.json, by the gem's name, built on first use. */
function data() {
  if (sickles) return sickles;
  const { Animation, Sound } = Shared.getCore();
  const sound = new Sound(GEM_CUTTING_SOUND, 1, 0, 0);
  return sickles = new Map(Shared.DATA.gemSickles.recipes.map((recipe) => [recipe.gemName, {
    ...recipe,
    product: Shared.itemId(recipe.product),
    animation: new Animation(recipe.seq),
    sound,
  }]));
}

/** Whether the quest that wants this sickle lets the player make it now. */
function allowed(player, product) {
  const request = { player, product, allowed: false };
  Shared.getApi().emitCustomEvent(GEM_SICKLE_ALLOWED_EVENT, request);
  return request.allowed === true;
}

function hasChisel(player) {
  const { ItemIds: I } = Shared.getCore();
  const inventory = player.getInventory();
  return inventory.contains(I.CHISEL) || inventory.contains(I.JEWELLERS_CHISEL);
}

/** The gem and the sickle of this use, as inventory items. */
function pairOf(event) {
  const used = event.usedItem, other = event.usedWithItem;
  return used.getDefinition().getName() === SILVER_SICKLE_B ? { sickle: used, gem: other } : { sickle: other, gem: used };
}

function useGemOnSickle(event) {
  const { player } = event;
  if (!Shared.isMembersWorld()) return false;
  const { sickle, gem } = pairOf(event);
  const recipe = data().get(gem.getDefinition().getName());
  if (!recipe || !allowed(player, recipe.product)) return false;
  if (!hasChisel(player)) {
    // Ours: no capture has the use without a chisel.
    player.sendMessage(`You need a chisel to embed the ${recipe.name} into the sickle.`);
    return;
  }
  // The ids now: the inventory empties a deleted slot's Item in place.
  const gemId = gem.getId(), sickleId = sickle.getId();
  Shared.getApi().sendMultiChatboxPrompt(player, `Craft ${recipe.article} ${recipe.name} sickle?`,
    "Yes.", () => craft(player, recipe, gemId, sickleId),
    "No.", () => {});
}

/** Yes: checked again, as the gem, the sickle or the chisel may have gone while the menu was open. */
function craft(player, recipe, gemId, sickleId) {
  const inventory = player.getInventory();
  if (!inventory.contains(gemId) || !inventory.contains(sickleId) || !hasChisel(player)) return;
  if (!allowed(player, recipe.product)) return;
  inventory.deleteNumber(gemId, 1);
  inventory.deleteNumber(sickleId, 1);
  inventory.adds(recipe.product, 1);
  Shared.animate(player, recipe.animation, recipe.sound);
  Shared.addCraftingXp(player, recipe.xp);
  Shared.produced(player, recipe.product, 1, recipe.xp, "gem-sickle", [[gemId, 1], [sickleId, 1]]);
  const text = `You embed the ${recipe.name} into the sickle.`;
  const { ChatType, DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = Shared.getCore();
  player.getPacketSender().sendTypedMessage(ChatType.MESBOX, text);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new ItemStatementDialogue(0, recipe.product, text), new EndDialogue(1)));
}

function attach(api) {
  for (const recipe of Shared.DATA.gemSickles.recipes) {
    api.onItemOnItem(recipe.gemName, SILVER_SICKLE_B, useGemOnSickle, { noted: false });
  }
}

module.exports = attach;
module.exports.GEM_SICKLE_ALLOWED_EVENT = GEM_SICKLE_ALLOWED_EVENT;
module.exports._test = { useGemOnSickle, craft, data };
