/**
 * Zahur's "Make unfinished potion(s)" in Nardah (https://oldschool.runescape.wiki/w/Zahur):
 * after the hard Desert Diary, or while wearing a Herblore cape (or max cape), she makes every
 * clean herb and vial of water the player carries - noted or not - into unfinished potions for
 * 200 coins each, as many as they can pay for. Noted pairs come back noted. The option is only
 * on her right-click menu; its messages have no capture.
 *
 * "Clean" (rsprox captures, recordings 333, 1834, 3159; Wiki): "Clean all your herbs at 200 coins
 * each?", then every grimy herb she can be paid for, with no XP; noted ones only after the hard
 * Desert Diary.
 */
const COST = 200;
/** Ours: no capture shows her with a full inventory. */
const NO_SPACE = "You don't have enough inventory space.";

let api;
let core;

function hardDiary(player) {
  const diary = { player, diary: "desert", tier: "hard", complete: false };
  api.emitCustomEvent("diary:is-complete", diary);
  return diary.complete === true;
}

function unlocked(player) {
  const cape = { player, skill: "HERBLORE", result: false };
  api.emitCustomEvent("skillcape:has-perk", cape);
  return cape.result === true || hardDiary(player);
}

function cleanFor(grimyId) {
  const request = { grimyId, clean: null };
  api.emitCustomEvent("herblore:clean", request);
  return request.clean;
}

function say(player, npcId, text) {
  const { DialogueChainBuilder, NpcDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text)));
}

/**
 * How many of `count` outputs fit once the payment has gone, worked out on a copy of the inventory: a
 * stack used up in full frees its slot, and a stack near the cap holds only what it has room for.
 */
function fitting(player, payment, output, count) {
  const { Inventory, Item } = core;
  const plan = new Inventory(player).setItems(player.getInventory().getCopiedItems());
  for (const [id, amount] of payment) plan.deleted(id, amount, false);
  return plan.getAddableAmount(new Item(output, count));
}

/** Cleans every grimy herb she is paid for, unnoted first, then noted after the hard Desert Diary. */
function cleanAll(player, npcId) {
  const inventory = player.getInventory();
  const { ItemIdentifiers } = core;
  const notes = hardDiary(player);
  let affordable = Math.floor(inventory.getAmount(ItemIdentifiers.COINS) / COST);
  let cleaned = 0;
  let refused = false;
  for (const item of [...inventory.getItems()]) {
    const id = item?.getId?.() ?? -1;
    if (id <= 0 || affordable <= 0) continue;
    const definition = core.ItemDefinition.forId(id);
    if (definition.isNoted() && !notes) continue;
    const clean = cleanFor(definition.isNoted() ? definition.unNote() : id);
    const wanted = Math.min(inventory.getAmount(id), affordable);
    if (!clean || wanted <= 0) continue;
    const output = definition.isNoted() ? notedOf(clean) : clean;
    const count = fitting(player, [[id, wanted], [ItemIdentifiers.COINS, wanted * COST]], output, wanted);
    if (count < wanted) refused = true;
    if (count <= 0) continue;
    inventory.deleteNumber(id, count);
    inventory.deleteNumber(ItemIdentifiers.COINS, count * COST);
    inventory.adds(output, count);
    affordable -= count;
    cleaned += count;
  }
  if (refused) player.sendMessage(NO_SPACE);
  if (cleaned > 0) say(player, npcId, "There, all done.");
  else if (!refused) say(player, npcId, "I didn't find anything that I could clean.");
  // The easy Desert Diary's "Have the Nardah Herbalist clean a Herb for you" (talking to her).
  if (cleaned > 0) api.emitCustomEvent("diary:task", { player, diary: "desert", task: "have-the-nardah-herbalist-clean-a-herb-for-you" });
}

function cleanHerbs(event) {
  const { player, npcId } = event;
  if (player.getInventory().getAmount(core.ItemIdentifiers.COINS) < COST) {
    say(player, npcId, `I'll want ${COST} coins to clean each herb.`);
    return true;
  }
  api.sendMultiChatboxPrompt(player, `Clean all your herbs at ${COST} coins each?`,
    "Yes", () => cleanAll(player, npcId), "No", () => {});
  return true;
}

function unfinishedFor(herbId) {
  const request = { herbId, potion: null };
  api.emitCustomEvent("herblore:unfinished", request);
  return request.potion;
}

function notedOf(id) {
  return core.ItemDefinition.forId(id)?.getNoteId?.() ?? -1;
}

/** Each kind of carried clean herb with its unfinished potion, unnoted and noted counts. */
function herbsCarried(player) {
  const inventory = player.getInventory();
  const herbs = new Map();
  for (const item of inventory.getItems()) {
    const id = item?.getId?.() ?? -1;
    if (id <= 0) continue;
    const definition = core.ItemDefinition.forId(id);
    const herbId = definition.isNoted() ? definition.unNote() : id;
    if (herbs.has(herbId)) continue;
    const potion = unfinishedFor(herbId);
    if (potion) herbs.set(herbId, { potion, unnoted: inventory.getAmount(herbId), noted: inventory.getAmount(notedOf(herbId)) });
  }
  return herbs;
}

function makeUnfinished(event) {
  const { player } = event;
  if (!unlocked(player)) {
    player.sendMessage("Zahur will only do that for those who have completed the hard Desert Diary.");
    return true;
  }
  const inventory = player.getInventory();
  const { ItemIdentifiers } = core;
  const vial = ItemIdentifiers.VIAL_OF_WATER;
  let vials = { unnoted: inventory.getAmount(vial), noted: inventory.getAmount(notedOf(vial)) };
  let affordable = Math.floor(inventory.getAmount(ItemIdentifiers.COINS) / COST);
  let made = 0;
  let refused = false;
  for (const [herbId, herb] of herbsCarried(player)) {
    for (const kind of ["unnoted", "noted"]) {
      const wanted = Math.min(herb[kind], vials[kind], affordable);
      if (wanted <= 0) continue;
      const noted = kind === "noted";
      const herbItem = noted ? notedOf(herbId) : herbId;
      const vialItem = noted ? notedOf(vial) : vial;
      const output = noted ? notedOf(herb.potion) : herb.potion;
      const count = fitting(player, [[herbItem, wanted], [vialItem, wanted], [ItemIdentifiers.COINS, wanted * COST]], output, wanted);
      if (count < wanted) refused = true;
      if (count <= 0) continue;
      inventory.deleteNumber(herbItem, count);
      inventory.deleteNumber(vialItem, count);
      inventory.deleteNumber(ItemIdentifiers.COINS, count * COST);
      inventory.adds(output, count);
      vials = { ...vials, [kind]: vials[kind] - count };
      affordable -= count;
      made += count;
    }
  }
  if (refused) player.sendMessage(NO_SPACE);
  if (made > 0) player.sendMessage(`Zahur makes ${made} unfinished potion${made === 1 ? "" : "s"} for you.`);
  else if (!refused) player.sendMessage("Zahur needs clean herbs, vials of water and 200 coins for each potion.");
  return true;
}

module.exports = {
  name: "Zahur",
  members: true,
  _test: { makeUnfinished, unlocked, herbsCarried, cleanHerbs, cleanAll },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onNpcInteraction("Zahur", { "Make unfinished potion(s)": makeUnfinished, Clean: cleanHerbs });
  },
};
