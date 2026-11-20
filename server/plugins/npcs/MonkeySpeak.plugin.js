/**
 * Monkeys whose Talk-to transcript has a "without" and a "with" M'speak amulet section: the Mos
 * Le'Harmless monkeys (Transcript:Monkey (monster)), the Karamja blue monkey and the magic carpet
 * monkey. The Wiki's section titles give the condition: the amulet worn, or Monkey Madness II
 * completed, plays the understood section; otherwise the monkey's "Eeekeek ookeek!" one.
 * Without this the runtime always took the first standard section (the untranslated one).
 * rsprox recording 3030 (rev 231): a Mos Le'Harmless monkey answers "Are ye here for...the stuff?".
 */
const MONKEY_MADNESS_II = "monkey_madness_ii";
/** "without-an-m-speak-amulet", "without-wearing-a-m-speak-amulet" */
const WITHOUT = /without-(?:wearing-)?an?-m-speak-amulet/;
/** "with-an-m-speak-amulet", "whilst-wearing-a-m-speak-amulet" */
const WITH = /(?:with|whilst-wearing)-an?-m-speak-amulet/;

function questComplete(api, player) {
  const request = { player, key: MONKEY_MADNESS_II, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function understands(api, player) {
  const { Equipment } = api.core;
  const amulet = player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.();
  return amulet === api.core.ItemIdentifiers.MSPEAK_AMULET || questComplete(api, player);
}

function selectVariant(api, event) {
  for (const { page, variants } of event.pages ?? []) {
    const without = variants.find(name => name.startsWith("standard") && WITHOUT.test(name));
    const understood = variants.find(name => name.startsWith("standard") && WITH.test(name));
    if (!without || !understood) continue;
    return { page, variant: understands(api, event.player) ? understood : without };
  }
  return null;
}

/** Blue monkey (Transcript:Blue monkey): its taunted/cautioned state, answered by the lines that set it. */
const BLUE_MONKEY_PAGE = "Blue monkey";
const TAUNTED = "monkey-speak:blue-monkey-taunted";
const CAUTIONED = "monkey-speak:blue-monkey-cautioned";
/** Line text -> [attribute, value]. Ours: the Wiki doesn't say what clears either state; Calm and Reassure do here. */
const STATE_LINES = new Map([
  ["Hey monkey, your mother was an inedible seaweed sandwich!", [TAUNTED, true]],
  ["I'm sorry for insulting you. Is there anything I can do to make it up to you?", [TAUNTED, false]],
  ["Hey monkey, take your time getting the nut ok?", [CAUTIONED, true]],
  ["Look, never mind about taking your time, I'm sure things will be ok.", [CAUTIONED, false]],
]);
/** Magic carpet monkey (Transcript:Monkey (magic carpet)): the banana conditions and the hand-over. */
const MAGIC_CARPET_PAGE = "Monkey (magic carpet)";
const GIVE_BANANA_STEP = "xABltn";

const onPage = (event, page) => (event.pages ?? []).some(entry => entry.page === page);

function answerCondition(api, event) {
  const text = String(event.text ?? "");
  if (onPage(event, MAGIC_CARPET_PAGE)) {
    const hasBanana = event.player.getInventory().contains(api.core.ItemIdentifiers.BANANA);
    if (/doesn't have a banana in their inventory/i.test(text)) return !hasBanana;
    if (/has a banana in their inventory/i.test(text)) return hasBanana;
  }
  if (onPage(event, BLUE_MONKEY_PAGE)) {
    const taunted = event.player.getAttribute(TAUNTED) === true;
    const cautioned = event.player.getAttribute(CAUTIONED) === true;
    if (/has not taunted or cautioned/i.test(text)) return !taunted && !cautioned;
    if (/has not taunted/i.test(text)) return !taunted;
    if (/has taunted/i.test(text)) return taunted;
    if (/has not cautioned/i.test(text)) return !cautioned;
    if (/has cautioned/i.test(text)) return cautioned;
  }
  return null;
}

function trackBlueMonkey(event) {
  if (!onPage(event, BLUE_MONKEY_PAGE)) return;
  const change = STATE_LINES.get(event.text);
  if (change) event.player.setAttribute(change[0], change[1]);
}

function giveBanana(api, event) {
  if (event.stepId !== GIVE_BANANA_STEP || !onPage(event, MAGIC_CARPET_PAGE)) return;
  const inventory = event.player.getInventory();
  const banana = api.core.ItemIdentifiers.BANANA;
  if (inventory.contains(banana)) {
    inventory.delete(banana, 1);
    inventory.refreshItems();
  }
  event.handled = true;
}

module.exports = {
  name: "MonkeySpeak",
  description: "Lets monkeys with an M'speak amulet section talk in words to a player wearing the amulet or past Monkey Madness II.",
  register(api) {
    api.onNpcDialogueVariant(selectVariant.bind(null, api));
    api.onNpcDialogueCondition(answerCondition.bind(null, api));
    api.onCustomEvent("npc-dialogue:line", trackBlueMonkey);
    api.onCustomEvent("npc-dialogue:action", giveBanana.bind(null, api));
  },
};
