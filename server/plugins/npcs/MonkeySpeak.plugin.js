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

module.exports = {
  name: "MonkeySpeak",
  description: "Lets monkeys with an M'speak amulet section talk in words to a player wearing the amulet or past Monkey Madness II.",
  register(api) {
    api.onNpcDialogueVariant(selectVariant.bind(null, api));
  },
};
