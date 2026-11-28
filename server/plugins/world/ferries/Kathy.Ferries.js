/**
 * Kathy Corkat's rowing boat between the Tree Gnome Stronghold (west of it, just east of Eagles' Peak) and
 * the Piscatoris Fishing Colony (Wiki: Kathy Corkat, Piscatoris Hunter area; docs/kathy-corkat-boat.md).
 *
 * - Two NPCs. At the Stronghold, swan_boat_boatwoman (6207) shows swan_boatwoman_1 (Talk-to) until
 *   Swan Song's varbit reaches 5, the quest's start, then swan_boatwoman_2 (Talk-to, Travel); at
 *   Piscatoris she is swan_boatwoman_2 itself (cache).
 * - Northbound costs 50 coins until Swan Song is started (Wiki, Swan Song: "After you have started the
 *   quest, you will not need to pay her again"; other Wiki pages say after the quest), taken on "Alright,
 *   I'll pay.". From the start, Talk-to plays her after-quest variants (ours: her transcript switches at
 *   completion), and Travel rows at once.
 * - The way back is free: her Piscatoris variants ask for nothing (the Wiki's Eagles' Peak page says the
 *   trip from the colony costs 50 coins).
 * - The trip is ferries.json's "piscatoris" / "piscatoris-back" fade routes.
 *
 * Not from OSRS (server/AGENTS.md rule 10): words from the RuneScape Wiki's transcript
 * (https://runescape.wiki/w/Transcript:Kathy_Corkat?oldid=36847174), which OSRS's lacks: without 50 coins,
 * "I haven't got that much with me." and "Ooh, and you almost had me persuaded!" in place of the fare's
 * menu; with a Ring of Charos(a) worn, the menu's "[Charm] A lady this beautiful shouldn't be so afraid!",
 * which rows for free (OSRS Wiki, Ring of Charos: "Free trips to the Piscatoris Fishing Colony"). The
 * RuneScape Wiki offers it only with 50 coins carried; the OSRS Wiki's Swan Song page ("either pay Kathy
 * Corkat 50 coins, or charm her") is followed, so with the ring the menu shows without the coins too.
 */
const Common = require("./Common.Ferries");
const Voyages = require("./Voyages.Ferries");

const PAGE = "Kathy Corkat";
const STRONGHOLD_NPCS = ["swan_boat_boatwoman", "swan_boatwoman_1"];
const PISCATORIS_NPC = "swan_boatwoman_2";
const NORTH = "piscatoris";
const SOUTH = "piscatoris-back";
const FARE = 50;
/** How near the conversation's Kathy must be for her to row (talking needs her beside the player). */
const NEAR = 15;

const VARIANTS = {
  stronghold: { before: "before-completion-of-swan-song-standard-dialogue-near-eagles-peak",
    after: "after-completion-of-swan-song-standard-dialogue-near-eagles-peak" },
  piscatoris: { before: "before-completion-of-swan-song-standard-dialogue-near-piscatoris-fishing-colony",
    after: "after-completion-of-swan-song-standard-dialogue-near-piscatoris-fishing-colony" },
};

/** The transcript's rowing steps: "Kathy Corkat rows you down the river to the sea..." or "...up the river...". */
const STEPS = { paid: "YY-T9g", north: ["sTpDxd"], south: ["AZhbme", "WllFjA"] };
const PAY_OPTION = "Alright, I'll pay.";
const REFUSE_OPTION = "Not a chance!";
const CHARM_STEP = "kathy-corkat-charm";
const CHARM_CONDITION = "If the Ring of Charos(a) is equipped:";
/** RuneScape Wiki transcript: without 50 coins. */
const POOR_LINES = Object.freeze({ player: "I haven't got that much with me.", npc: "Ooh, and you almost had me persuaded!" });
/** RuneScape Wiki transcript: the Ring of Charos(a)'s option, which rows for free. */
const CHARM_OPTION = Object.freeze({
  text: "[Charm] A lady this beautiful shouldn't be so afraid!",
  condition: CHARM_CONDITION,
  steps: [
    { player: "A lady this beautiful shouldn't be so afraid!" },
    { npc: "Oooh, you shouldn't tease a poor girl so! But I'll take you downstream if you like!" },
    { type: "message", text: "Kathy Corkat rows you down the river to the sea...", id: CHARM_STEP },
  ],
});
const POOR_OPTION = Object.freeze({ text: POOR_LINES.player, steps: [{ player: POOR_LINES.player }, { npc: POOR_LINES.npc }] });

const core = () => Common.core;
const coins = (player) => player.getInventory().getAmount(core().ItemIdentifiers.COINS);
const questStarted = (player) => Common.passes(player, "swanSongStarted");

/** Which dock's Kathy: the spawned NPC's base gameval (the Stronghold one is a multi-NPC). */
function dockOf(npc, npcId) {
  const gameval = Common.npcGameval(npc, npcId);
  if (STRONGHOLD_NPCS.includes(gameval)) return "stronghold";
  return gameval === PISCATORIS_NPC ? "piscatoris" : null;
}

function wearsCharos(player) {
  return player.getEquipment().get(core().Equipment.RING_SLOT)?.getId?.() === core().ItemIdentifiers.RING_OF_CHAROS_A_;
}

function isKathy(event) {
  return event?.definition?.getName?.() === PAGE;
}

function selectVariant(event) {
  if (!event.player || !isKathy(event)) return null;
  const dock = dockOf(event.npc, event.npcId);
  if (!dock) return null;
  return { page: PAGE, variant: VARIANTS[dock][questStarted(event.player) ? "after" : "before"] };
}

function answerCondition(event) {
  if (!isKathy(event) || event.text !== CHARM_CONDITION) return null;
  return wearsCharos(event.player);
}

/** Takes the fare if the player still carries it. */
function take(player) {
  if (coins(player) < FARE) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(core().ItemIdentifiers.COINS, FARE);
  inventory.refreshItems?.();
  return true;
}

/** The fare's menu: without 50 coins or the ring, her two lines instead; otherwise the charm option too. */
function fareMenu(notice) {
  if (!isKathy(notice)) return;
  const texts = (notice.options ?? []).map((option) => option.text);
  if (!texts.includes(PAY_OPTION) || !texts.includes(REFUSE_OPTION)) return;
  if (coins(notice.player) < FARE && !wearsCharos(notice.player)) {
    notice.options = [POOR_OPTION];
    notice.select = POOR_OPTION;
    return;
  }
  notice.options = [...notice.options, CHARM_OPTION];
}

/** The transcript's rowing steps: the fare on "Alright, I'll pay.", then the trip. */
function dialogueAction(event) {
  if (event.handled || !isKathy(event)) return;
  const { player, stepId } = event;
  const route = stepId === STEPS.paid || stepId === CHARM_STEP || STEPS.north.includes(stepId) ? NORTH
    : STEPS.south.includes(stepId) ? SOUTH : null;
  if (!route) return;
  event.handled = true;
  // The trip's box replaces the conversation; anything that stops the trip ends it instead.
  event.end = true;
  if (Common.travelling(player) || !Voyages.canGo(player, route)) return;
  // A conversation started during an earlier trip's fade (NPC clicks still work then) can outlast it.
  const kathy = event.npc?.getLocation?.();
  if (kathy && !kathy.isWithinDistance(player.getLocation(), NEAR)) return;
  if (stepId === STEPS.paid && !take(player)) {
    // Ours: her lines for having no coins.
    refuse(player, event);
    return;
  }
  Voyages.travel(player, route);
}

/** Her two lines when "Alright, I'll pay." finds fewer than 50 coins. */
function refuse(player, event) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue } = core();
  const npcId = event.definition?.getId?.() ?? event.npcId;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new PlayerDialogue(0, POOR_LINES.player))
    .add(new NpcDialogue(1, npcId, POOR_LINES.npc)));
}

/** Travel is free: the Stronghold Kathy shows it only from Swan Song's start. */
function travelOption(event) {
  const dock = dockOf(event.npc, event.npcId);
  if (dock) Voyages.travel(event.player, dock === "piscatoris" ? SOUTH : NORTH);
}

function attach(api) {
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:menu", fareMenu);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
  api.onNpcInteraction(PAGE, { Travel: travelOption });
}

module.exports = {
  attach, selectVariant, answerCondition, fareMenu, dialogueAction, travelOption, dockOf,
  FARE, VARIANTS, STEPS, CHARM_OPTION, POOR_LINES,
};
