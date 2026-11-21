/**
 * Murder Mystery's poison trail: the poison salesman in Seers' Village, the Sinclairs' stories of why
 * they bought his poison, and the six places they say they used it. The words are the Wiki's
 * (Transcript:Murder Mystery, with the salesman's straight-to-the-menu variants the capture adds);
 * docs/quests/murder-mystery/README.md has the capture facts:
 *
 * - Once he has named the buyers ("Who did you sell Poison to at the house?"), the salesman goes straight
 *   to his menu (MurderMystery.bin t1895, t1904). With The Fremennik Trials under way he first asks
 *   which quest; "Talk about the Fremennik Trials" is that quest's own talk (t1842-1857).
 * - A Sinclair's story is told once their answer to "Why'd you buy poison the other day?" ends; a place
 *   then reads as the Wiki's "after questioning the Sinclairs" (the murderer's spot shows no poison).
 *   Looking at the murderer's spot then is the poison proof (t2209: the crest; 1001930 t2233: the drain;
 *   1001958 t2041: the spiders' nest).
 *
 * Ours: a place counts as "after questioning" once that suspect has told their own story (the Wiki's
 * heading names no one); before the quest the places read as at its start, and the drain asks for the
 * guards' permission as the Wiki's gate, sacks, drain and barrels do; after it every place asks for it, as
 * the Wiki says of the crest.
 */
module.exports = function attachMurderMysteryPoison(api, ctx) {
  const QuestRuntime = require("../QuestRuntime");
  const { STAGES, PAGE, ATTRIBUTES, POISON, NPCS, SUSPECTS, PLACE_VARIANTS } = require("./State.MurderMystery");

  const FREMENNIK_TRIALS = "fremennik_trials";
  const BUYERS_NAMED = "all bought a bottle! In fact they bought the last of my supplies!";
  const FREMENNIK_OPTION = "Talk about the Fremennik Trials";
  const SALESMAN = {
    plain: "visiting-the-poison-salesman-talking-to-the-poison-salesman",
    fremennik: "visiting-the-poison-salesman-talking-to-the-poison-salesman-if-the-player-also-has-progress-in-fremennik-trials",
    named: "visiting-the-poison-salesman-talking-to-the-poison-salesman-after-learning-who-bought-the-poison",
    namedFremennik: "visiting-the-poison-salesman-talking-to-the-poison-salesman-after-learning-who-bought-the-poison-if-the-player-also-has-progress-in-fremennik-trials",
    after: "post-quest-talking-to-the-poison-salesman-after-the-quest",
    afterFremennik: "post-quest-talking-to-the-poison-salesman-after-the-quest-if-the-player-has-progress-in-fremennik-trials",
  };
  const SALESMAN_VARIANTS = new Set(Object.values(SALESMAN));

  /** The Fremennik Trials started and not finished: the salesman then asks which quest the player means. */
  function fremennikUnderWay(player) {
    const trials = QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === FREMENNIK_TRIALS);
    if (!trials) return false;
    const stage = trials.getStage(player);
    return stage >= trials.startedValue && !trials.isComplete(player);
  }

  function salesmanVariant(player) {
    const stage = ctx.stage(player);
    const trials = fremennikUnderWay(player);
    if (stage >= STAGES.COMPLETE) return trials ? SALESMAN.afterFremennik : SALESMAN.after;
    if (stage < STAGES.STARTED) return null;
    if (ctx.attr(player, ATTRIBUTES.POISON) >= POISON.SALESMAN) return trials ? SALESMAN.namedFremennik : SALESMAN.named;
    return trials ? SALESMAN.fremennik : SALESMAN.plain;
  }

  function talkToSalesman(event) {
    const variant = salesmanVariant(event.player);
    if (!variant) return false;
    return QuestRuntime.startTranscript(api, event.player, NPCS.POISON_SALESMAN, PAGE, variant, null, event.npc) !== false;
  }

  /**
   * "Talk about the Fremennik Trials": this conversation ends and that quest's own talk with him plays. Its
   * first page opens with the same two-quest menu; that menu was just answered, so it goes on from its option.
   */
  function fromTrialsOption(steps) {
    const option = steps[0]?.type === "choice" ? steps[0].options?.find((entry) => entry.text === FREMENNIK_OPTION) : null;
    return option ? [...(option.steps ?? []), ...steps.slice(1)] : steps;
  }

  function handleChoice(event) {
    const { player, npcId, npc } = event;
    if (npcId !== NPCS.POISON_SALESMAN || event.option !== FREMENNIK_OPTION || !SALESMAN_VARIANTS.has(ctx.variantOf(event))) return;
    // At once, in the answered menu's own turn: a close sent after it closes that talk, nothing reopens later.
    event.end = true;
    api.emitCustomEvent("npc-dialogue:start", { player, npcId, npc, select: fromTrialsOption });
  }

  // ---- Stories ---------------------------------------------------------------------------------

  const told = (player, suspect) => (ctx.attr(player, ATTRIBUTES.STORIES) & (1 << suspect.id)) !== 0
    || (ctx.attr(player, ATTRIBUTES.POISON) === POISON.OLD_STORY && ctx.murderer(player).id === suspect.id);

  function handleLine({ player, npcId, text }) {
    if (!player || ctx.stage(player) !== STAGES.STARTED || typeof text !== "string") return;
    const poison = ctx.attr(player, ATTRIBUTES.POISON);
    if (npcId === NPCS.POISON_SALESMAN && text.includes(BUYERS_NAMED)) {
      if (poison < POISON.SALESMAN) ctx.setAttr(player, ATTRIBUTES.POISON, POISON.SALESMAN);
      return;
    }
    const suspect = SUSPECTS.find((entry) => entry.npcs.includes(npcId));
    if (!suspect || poison < POISON.SALESMAN || !text.endsWith(suspect.story)) return;
    ctx.setAttr(player, ATTRIBUTES.STORIES, ctx.attr(player, ATTRIBUTES.STORIES) | (1 << suspect.id));
  }

  // ---- The places ------------------------------------------------------------------------------

  function investigatePlace(event) {
    const suspect = SUSPECTS.find((entry) => entry.place === event.objectId);
    if (!suspect) return false;
    const { player } = event;
    const [plain, after] = PLACE_VARIANTS[suspect.id];
    const stage = ctx.stage(player);
    // After the quest the crest asks for the guards' permission (the Wiki's Sinclair family crest; Ours for the
    // other places), as the drain does before it (the Wiki's gate, sacks, drain and barrels).
    if (stage >= STAGES.COMPLETE || (stage < STAGES.STARTED && suspect.name === "Carol")) {
      ctx.play(player, "before-starting-investigating-the-gate-sacks-drain-or-barrels");
    } else if (stage === STAGES.STARTED && told(player, suspect)) {
      if (ctx.murderer(player).id === suspect.id) ctx.setAttr(player, ATTRIBUTES.POISON, POISON.PROOF);
      ctx.play(player, after);
    } else {
      ctx.play(player, plain);
    }
    return true;
  }

  api.onNpcInteraction("Poison Salesman", { "Talk-to": talkToSalesman });
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onObjectInteraction("Sinclair family compost heap", { Investigate: investigatePlace });
  api.onObjectInteraction("Sinclair family beehive", { Investigate: investigatePlace });
  api.onObjectInteraction("Sinclair mansion drain", { Investigate: investigatePlace });
  api.onObjectInteraction("Spiders' nest", { Investigate: investigatePlace });
  api.onObjectInteraction("Sinclair family fountain", { Investigate: investigatePlace });
  api.onObjectInteraction("Sinclair family crest", { Investigate: investigatePlace });

};
