/**
 * Neitiznot faceguard (Wiki: Neitiznot faceguard, Basilisk jaw; issue #2228).
 *
 * Captured (rsprox 1862, rev 227.1): the jaw used on Olaf plays "You show the Basilisk Jaw to Olaf."
 * (an item box) and his story, which sets varbit 9472. The jaw on the helm before that shows
 * "You're not quite sure how to do that..."; afterwards the jaw on the helm asks
 * "Attach the jaw to the helmet?" (Yes. / No.) and Yes swaps both for the faceguard with the
 * "You attach the Basilisk Jaw to the Helm of Neitiznot." box. Dismantle (rsprox 3215, rev 232.1):
 * "Remove the jaw from the helmet?" (Yes. / No.), then the helm and jaw return with the
 * "You remove the Basilisk Jaw from the Neitiznot Faceguard." box.
 * The story is played from Olaf's own transcript (his after-the-Trials variant, from the "You show"
 * step on), so Music's Talk-to menu is untouched. This plugin owns varbit 9472.
 * Not done: the Wiki's revert on PvP death, the full-inventory wording (the Accursed sceptre's
 * line is reused, not captured), and the inventory slots the items land in (captured: the
 * faceguard takes the helm's slot, the helm the faceguard's, the jaw slot 0; here the first free
 * slot is used).
 */
const STORY_ATTRIBUTE = "neitiznot:faceguard-story";
const STORY_VARBIT = 9472;
const STORY_CONDITION = "If the player has a basilisk jaw in their inventory and has not learned about the story yet:";
const STORY_ACTION = "(The player can now create Neitiznot faceguards.)";
const UNKNOWN_TEXT = "You're not quite sure how to do that. Perhaps Olaf the Bard can help. He's likely to know a good story about Basilisk Jaws.";
const ATTACH_TEXT = "You attach the Basilisk Jaw to the Helm of Neitiznot.";
const REMOVE_TEXT = "You remove the Basilisk Jaw from the Neitiznot Faceguard.";
const SHOW_TEXT = "You show the Basilisk Jaw to Olaf.";
const EXILES_QUEST = "The Fremennik Exiles";
const STORY_VARIANT = "after-the-fremennik-trials";
const STORY_OPTION = "Do you know any great stories about Basilisk Jaws?";
const PRESET_TEXT = "Preset items cannot be used for this.";
const NO_SPACE = "You don't have enough inventory space to do that.";

let api = null;
let core = null;

function learned(player) {
  return player.getAttribute(STORY_ATTRIBUTE) === true;
}

function syncStory(player) {
  player.getPacketSender().sendVarbit(STORY_VARBIT, learned(player) ? 1 : 0);
}

function hasJaw(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.BASILISK_JAW) >= 1;
}

/** The transcript's "If the player has a basilisk jaw ... has not learned about the story yet:". */
function storyCondition({ player, npcId, text }) {
  if (npcId !== core.NpcIdentifiers.OLAF_THE_BARD || text !== STORY_CONDITION) return null;
  return hasJaw(player) && !learned(player);
}

/** The steps of Olaf's story from the captured "You show the Basilisk Jaw to Olaf." box on. */
function storySteps(steps) {
  for (const step of steps ?? []) {
    if (step?.text === STORY_OPTION && Array.isArray(step.steps)) {
      const from = step.steps.findIndex((entry) => entry?.type === "message" && entry.text === SHOW_TEXT);
      if (from >= 0) return step.steps.slice(from);
    }
    const found = storySteps([...(step?.steps ?? []), ...(step?.options ?? [])]);
    if (found) return found;
  }
  return null;
}

/** True when The Fremennik Exiles is done, or this server has no such quest to do (it never gates then). */
function exilesComplete(player) {
  const request = { player, name: EXILES_QUEST, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete !== false;
}

/**
 * The captured route: the jaw used on Olaf. Anything else used on him is left to the others. The Wiki
 * has the jaw combine "after the completion of The Fremennik Exiles" (which itself needs the Trials and
 * The Fremennik Isles); what Olaf says to a player who has not finished it is not captured, so the use
 * is simply left unhandled for them.
 */
function showJaw(event) {
  const { player, itemId, npcId, target } = event;
  if (itemId !== core.ItemIdentifiers.BASILISK_JAW || npcId !== core.NpcIdentifiers.OLAF_THE_BARD) return;
  if (!exilesComplete(player)) return;
  const request = {
    player, npc: target, npcId, variant: STORY_VARIANT, exact: true, handled: false,
    select: (steps) => storySteps(steps) ?? [],
  };
  api.emitCustomEvent("npc-dialogue:start", request);
  if (request.handled) event.handled = true;
}

/** "You show the Basilisk Jaw to Olaf." is an item box showing the jaw. */
function showBox(action) {
  if (action.kind !== "message" || action.text !== SHOW_TEXT || action.npcId !== core.NpcIdentifiers.OLAF_THE_BARD) return;
  action.box = { items: [core.ItemIdentifiers.BASILISK_JAW] };
}

/** The transcript's "(The player can now create Neitiznot faceguards.)" step. */
function learnStory({ player, npcId, text, kind }) {
  if (kind === "message") return;
  if (npcId !== core.NpcIdentifiers.OLAF_THE_BARD || text !== STORY_ACTION) return;
  player.setAttribute(STORY_ATTRIBUTE, true);
  syncStory(player);
}

function login({ player }) {
  syncStory(player);
}

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so they never convert. */
function restricted(item) {
  const Item = core.Item;
  return !!item && (item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true);
}

/** The slot of an unrestricted copy of the item: the instance that is actually consumed. */
function plainSlot(player, id) {
  return player.getInventory().getItems().findIndex((item) => item && item.getId() === id && !restricted(item));
}

function say(player, dialogue) {
  const chain = new core.DialogueChainBuilder();
  chain.add(dialogue);
  chain.add(new core.EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

function attach(player) {
  const I = core.ItemIdentifiers;
  const inventory = player.getInventory();
  const helm = plainSlot(player, I.HELM_OF_NEITIZNOT);
  const jaw = plainSlot(player, I.BASILISK_JAW);
  if (helm < 0 || jaw < 0) return;
  inventory.deleteAtSlot(helm, 1);
  inventory.deleteAtSlot(jaw, 1);
  inventory.addItem(new core.Item(I.NEITIZNOT_FACEGUARD, 1));
  player.getPacketSender().sendInterfaceRemoval();
  say(player, new core.ItemStatementDialogue(0, I.NEITIZNOT_FACEGUARD, ATTACH_TEXT));
}

function combine({ player, usedItem, usedWithItem }) {
  if (restricted(usedItem) || restricted(usedWithItem)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  if (!learned(player)) {
    say(player, new core.StatementDialogue(0, UNKNOWN_TEXT));
    return;
  }
  api.sendMultiChatboxPrompt(player, "Attach the jaw to the helmet?",
    "Yes.", () => attach(player),
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
}

function detach(player) {
  const I = core.ItemIdentifiers;
  const inventory = player.getInventory();
  const faceguard = plainSlot(player, I.NEITIZNOT_FACEGUARD);
  if (faceguard < 0) return;
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(NO_SPACE);
    return;
  }
  inventory.deleteAtSlot(faceguard, 1);
  inventory.addItem(new core.Item(I.HELM_OF_NEITIZNOT, 1));
  inventory.addItem(new core.Item(I.BASILISK_JAW, 1));
  player.getPacketSender().sendInterfaceRemoval();
  say(player, new core.DoubleItemStatementDialogue(0, I.HELM_OF_NEITIZNOT, I.BASILISK_JAW, REMOVE_TEXT));
}

function dismantle({ player, item }) {
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  api.sendMultiChatboxPrompt(player, "Remove the jaw from the helmet?",
    "Yes.", () => detach(player),
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

module.exports = {
  name: "NeitiznotFaceguard",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    api.persistAttribute(STORY_ATTRIBUTE, false);
    api.onItemOnItem("Helm of Neitiznot", "Basilisk jaw", combine, { noted: false });
    api.onItemAction("Neitiznot faceguard", { Dismantle: dismantle });
    api.onNpcDialogueCondition(storyCondition);
    api.onCustomEvent("npc-dialogue:action", showBox);
    api.onCustomEvent("npc-dialogue:action", learnStory);
    api.onItemOnNpc(showJaw, { noted: false });
    api.onPlayerLogin(login);
  },
};
