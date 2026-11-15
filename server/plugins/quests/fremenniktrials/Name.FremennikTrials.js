/**
 * The Fremennik name Brundt gives the player at the end of The Fremennik Trials.
 *
 * - The name is random: one of 16 prefixes and one of 16 suffixes (Wiki, "Fremennik name").
 *   The captures show Thorvald (1002236) and Raktin (1001646 t3517).
 * - Brundt says it after the player closes the quest scroll (1002236 t10313 -> t10314):
 *   "... You will now be called <name>.", the transcript's `post-quest-dialogue`. The journal
 *   then shows it (1001646 t3517).
 * - Every dialogue line that says "[Fremennik name]" (Rellekka, Miscellania, the Fremennik
 *   Isles, Lunar Isle ...) speaks it. Other plugins ask for it with the custom event
 *   "fremennik-trials:name" ({ player, name }); before the quest it stays unset.
 *
 * Ours: in 1001646 Brundt said "Raktin" while the journal read "Raklak" on the same tick, so
 * live seems to roll the spoken suffix again. We say the saved name both times.
 * Ours: the quest_rating interface (983) that live opens after Brundt's line is not shown.
 */
module.exports = function attachFremennikTrialsName(api, ctx) {
  const NAME_ATTRIBUTE = "quest.fremennik_trials.name";
  const PLACEHOLDER = "[Fremennik name]";
  const PREFIXES = ["Bal", "Bar", "Dal", "Dar", "Den", "Dok", "Jar", "Jik", "Lar", "Rak", "Ral", "Ril", "Sig", "Tal", "Thor", "Ton"];
  const SUFFIXES = ["dar", "dor", "dur", "kal", "kar", "kir", "kur", "lah", "lak", "lim", "lor", "rak", "tin", "ton", "tor", "vald"];
  const NAMES = PREFIXES.length * SUFFIXES.length;
  const NAMING_VARIANT = "post-quest-dialogue";
  /** Rellekka's Brundt as the longhall shows him (viking_brundt 3926 resolves to viking_brundt_child). */
  const BRUNDT = api.core.NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_6;
  const SCROLL_GROUP = 153;
  /** Ticks to wait for the scroll to close before Brundt names the player anyway. */
  const SCROLL_WAIT = 200;

  /** The saved name (1-based index into prefix x suffix; 0 none yet). */
  function nameIndex(player) {
    const value = ctx.readAttribute(player, NAME_ATTRIBUTE);
    return value >= 1 && value <= NAMES ? value : 0;
  }

  function roll(player) {
    const index = 1 + Math.floor(Math.random() * NAMES);
    player.setAttribute(NAME_ATTRIBUTE, index);
    return index;
  }

  /** The player's Fremennik name, rolled once for a player who finished the quest without one. */
  function fremennikName(player) {
    if (!ctx.quest?.isComplete(player)) return null;
    const index = nameIndex(player) || roll(player);
    return PREFIXES[Math.floor((index - 1) / SUFFIXES.length)] + SUFFIXES[(index - 1) % SUFFIXES.length];
  }

  function answerName(request) {
    if (!request?.player || request.name) return;
    request.name = fremennikName(request.player);
  }

  /** "[Fremennik name]" on its own; "[dear/[Fremennik name]]" is Royal Trouble's (it asks the name itself). */
  const PLACEHOLDER_ALONE = /(?<!\[dear\/)\[Fremennik name\]/g;

  function fillName(event) {
    const text = String(event.text ?? "");
    if (!text.includes(PLACEHOLDER) || !event.player) return;
    const name = fremennikName(event.player) ?? event.player.getDisplayName?.() ?? "";
    event.text = text.replace(PLACEHOLDER_ALONE, () => name);
  }

  /**
   * Brundt names the player once the quest scroll is closed. A completion without the scroll (a
   * quest pack, ::quest) only rolls the name: no longhall, no Brundt dialogue wherever they stand.
   */
  function nameAfterScroll(event) {
    if (event?.key !== "fremennik_trials" || !event.player) return;
    const { player } = event;
    fremennikName(player);
    if (event.options?.scroll === false) return;
    let waited = 0;
    const wait = () => {
      if (player.isRegistered?.() === false) return;
      if (player.getInterfaceId?.() === SCROLL_GROUP && waited++ < SCROLL_WAIT) {
        ctx.later(player, 1, wait);
        return;
      }
      ctx.play(player, BRUNDT, NAMING_VARIANT);
    };
    ctx.later(player, 1, wait);
  }

  ctx.fremennikName = fremennikName;
  api.persistAttribute(NAME_ATTRIBUTE, 0);
  api.onCustomEvent("fremennik-trials:name", answerName);
  api.onCustomEvent("npc-dialogue:line", fillName);
  api.onCustomEvent("quest:completed", nameAfterScroll);
};
