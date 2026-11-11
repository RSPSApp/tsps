/**
 * Brutus beyond the quest fight (https://oldschool.runescape.wiki/w/Brutus, /Strategies, and
 * https://oldschool.runescape.wiki/w/Demonic_Brutus, /Strategies): the cow-field encounter itself, its
 * respawn, loot and Demonic upgrade live in plugins/quests/quests/IdesOfMilk.Quest.js (docs/ides-of-milk.md).
 * This plugin holds what the Wiki adds that is not part of that quest:
 *  - Slayer experience of 116 (twice his Hitpoints) on a Cows task, once The Ides of Milk is complete;
 *  - "Brutus doesn't want that." for an item used on him ("You do not want to do that." for an empty bucket);
 *  - the message for killing him in Cow31337Killer's outfit;
 *  - Demonic Brutus's second phase: at 0 Hitpoints he shouts "moo moo!" and heals 487 instead of dying.
 * No capture of the post-quest or the Demonic fight was found (rsprox 4153 is the quest route only), so the
 * numbers are the Wiki's own, and its ghosts, orbs and faster specials are not modelled.
 */
const QUEST_KEY = "the_ides_of_milk";
const SLAYER_XP = 116;
const PHASE_TWO_HEAL = 487;
const PHASE_TWO_LINE = "moo moo!";
const NOT_WANTED = "Brutus doesn't want that.";
const NOT_WANTED_BUCKET = "You do not want to do that.";
const IMITATION = "You are but an imitation of a true legend.";
/** Cow31337Killer's outfit, as the cache names the worn items (Dharok's pieces come in degraded forms). */
const LEGEND_OUTFIT = [
  (name) => name === "Rune boots",
  (name) => name === "Rune platebody",
  (name) => name === "Rune plateskirt",
  (name) => name === "Klank's gauntlets",
  (name) => name.startsWith("Dharok's helm"),
  (name) => name.startsWith("Dharok's greataxe"),
];

let api;
let core;
let BRUTUS_IDS;
let DEMONIC_IDS;
const phaseTwo = new WeakSet();

function questComplete(player) {
  const request = { player, key: QUEST_KEY, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** "slayer:task-kill": Brutus' Slayer experience is double his Hitpoints (Wiki infobox: 116). */
function slayerXp(kill) {
  if (BRUTUS_IDS.has(kill?.npc?.getId?.()) && questComplete(kill.player)) kill.xp = SLAYER_XP;
}

/** An item used on Brutus; the abyssal potato is the quest plugin's, and a handled use is not ours. */
function itemOnBrutus(event) {
  if (event.handled || !BRUTUS_IDS.has(event.npcId ?? event.target?.getId?.())) return;
  if (event.itemId === core.ItemIdentifiers.ABYSSAL_POTATO) return;
  event.handled = true;
  event.player.sendMessage(event.itemId === core.ItemIdentifiers.BUCKET ? NOT_WANTED_BUCKET : NOT_WANTED);
}

function wearsLegendOutfit(player) {
  const worn = (player.getEquipment?.()?.getItems?.() ?? [])
    .map((item) => (item && item.getId() >= 0 ? core.CacheDefinitions.getItem(item.getId())?.name ?? "" : ""));
  return LEGEND_OUTFIT.every((matches) => worn.some(matches));
}

/** A kill of Brutus or his Demonic form in that outfit. */
function brutusDeath({ killer, npc }) {
  const id = npc?.getId?.();
  if (!killer?.isPlayer?.() || !(BRUTUS_IDS.has(id) || DEMONIC_IDS.has(id))) return;
  if (wearsLegendOutfit(killer)) killer.sendMessage(IMITATION);
}

/** Demonic Brutus is not beaten at 0 Hitpoints the first time: he heals and the fight goes on (Wiki). */
function demonicBeforeDeath(event) {
  const { npc } = event;
  if (npc?.getId?.() !== core.NpcIdentifiers.DEMONIC_BRUTUS || phaseTwo.has(npc)) return;
  event.preventDeath = true;
  phaseTwo.add(npc);
  npc.setHitpoints(PHASE_TWO_HEAL);
  npc.forceChat(PHASE_TWO_LINE);
}

module.exports = {
  name: "Brutus",
  description: "Brutus beyond the quest fight: Slayer experience, item messages, the Cow31337Killer message and Demonic Brutus's second phase.",
  slayerXp,
  itemOnBrutus,
  wearsLegendOutfit,
  brutusDeath,
  demonicBeforeDeath,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    BRUTUS_IDS = new Set([core.NpcIdentifiers.BRUTUS, core.NpcIdentifiers.BRUTUS_2]);
    DEMONIC_IDS = new Set([core.NpcIdentifiers.DEMONIC_BRUTUS, core.NpcIdentifiers.DEMONIC_BRUTUS_2]);
    api.onCustomEvent("slayer:task-kill", slayerXp);
    api.onItemOnNpc(itemOnBrutus);
    api.onNpcDeath(brutusDeath);
    api.onNpcBeforeDeath(demonicBeforeDeath);
  },
};
