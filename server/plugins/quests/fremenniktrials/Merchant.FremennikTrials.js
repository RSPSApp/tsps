/**
 * The Fremennik Trials: Merchant unit, Sigmund the Merchant's trading chain (see
 * State.FremennikTrials.js for the shared context).
 *
 * Live (rsprox 1002236 rev 242 t5891-t7941; 1001646 rev 241 and 1002250 rev 242 the same):
 * - Sigmund asks for a rare flower. Each Fremennik along the chain asks for the next thing, from
 *   the Sailor (ballad) to Askeladden (5,000 gp for a promissory note), then the items are traded
 *   back down the chain to Sigmund. No varp/varbit belongs to the chain: the state lives on the
 *   server, and only `viking` (347) moves when the flower goes to Sigmund (t7941).
 * - Every chain NPC opens with "Ask about the Merchant's trial|Ask about becoming a Fremennik".
 * - A trade happens inside the dialogue, on the tick the NPC's hand-over line opens (Thora t7255,
 *   Manni t7293, Thorvald t7382, Peer t7432, Swensen t7504, Fisherman t7550, Skulgrimen t7592,
 *   Sigli t7650, Brundt t7685, Yrsa t7755, Olaf t7834, Sailor t7905): the input item leaves and
 *   the output goes to the first free slot (1001646 t1255: forecast to slot 0, contract left
 *   slot 1). No message, no sound, no animation.
 * - Sigmund takes the flower on the player's "Here's that flower you wanted." (t7941); no
 *   "Congratulations" message follows.
 *
 * State: one ordered link table. `quest.fremennik_trials.merchant_chain` holds 0 (not started) or
 * 1 + the number of links whose request the player has heard (0..13). Which item the player holds
 * decides the hand-over leg, so nothing about it is stored. A link's request is recorded when the
 * player picks "Ask about the Merchant's trial" on that link's request, not when its variant is
 * picked (issue 4886 point 4: the old step moved only from exactly the previous step and the
 * full request played at any step, so the chain stuck at Skulgrimen while Swensen and Peer
 * still talked).
 *
 * Wiki: a lost chain item means starting again from Askeladden for another 5,000 gp. With every
 * request heard and no chain item held, Askeladden sells the note again.
 *
 * Ours: an NPC asked before its turn plays the chain's flower question while Sigmund's flower is
 * all the player knows of (requests 0-4) and the bowstring question while Sigli's bowstring is
 * wanted (5-6), as the Wiki's "finding the ... whereabouts" sections; later than that the NPC
 * gives its own talk. Item-on-NPC (no capture) plays that link's hand-over branch.
 */
module.exports = function attachFremennikTrialsMerchant(api, ctx) {
  const { NPC, T, I, SIGMUND, SAILOR_FAVOR: SF, SWENSEN_FAVOR: SW, STAGE_STARTED, STAGE_COMPLETE } = ctx;
  const N = api.core.NpcIdentifiers;

  /** New state: -1 not yet converted from the old key, 0 not started, else 1 + requests heard. */
  const CHAIN_ATTRIBUTE = "quest.fremennik_trials.merchant_chain";
  /** Old saves: the step of the single-closure plugin (old M_* constants), read once to convert. */
  const OLD_MERCHANT_ATTRIBUTE = "quest.fremennik_trials.merchant";
  const UNCONVERTED = -1;
  /** Old M_STARTED = 1 ... M_THORA = 13 mean "talked to"; 14..26 (note ... flower) "holding". */
  const OLD_LAST_TALK_STEP = 13;

  const ASKELADDEN_PRICE = 5000;
  const COINS = I.COINS;

  const flowerAsk = (slug) => `${SIGMUND}-finding-the-unique-flower-s-whereabouts-talking-to-${slug}`;
  const bowAsk = (slug) => `${SF}-finding-sigli-s-bowstring-talking-to-${slug}`;
  /** Asked about Askeladden's note while only Thora wants it (rsprox 1002313 t3069-t3600). */
  const promiseAsk = (slug) => `${SF}-finding-askeladden-s-written-promise-talking-to-${slug}`;

  const SIGMUND_OFFER = SIGMUND;
  const SIGMUND_AGAIN = `${SIGMUND}-talking-to-sigmund-again`;
  const SIGMUND_FLOWERS = `${SF}-giving-the-flowers-to-sigmund`;
  const SIGMUND_DONE = `${SF}-subsequent-dialogue-with-sigmund`;

  /** Only Rellekka's sailor (viking_sailor 3936); Sailor 3680 is another NPC's. */
  const SAILOR_IDS = new Set([N.SAILOR_2]);

  /**
   * The chain from Sigmund outwards. `line` is the hand-over line the trade swaps on (rsprox
   * 1002236 ticks above); `step` the dump's later `receive` action, suppressed so nothing swaps
   * twice. `flower`/`bow`: the generic question asked before this link's turn.
   */
  const LINKS = [
    { name: "sailor", npcs: SAILOR_IDS, ask: `${SF}-talking-to-the-sailor`, give: `${SW}-giving-the-ballad-to-the-sailor`,
      after: `${SW}-talking-to-the-sailor-again`, in: I.FREMENNIK_BALLAD, out: I.EXOTIC_FLOWER, bow: bowAsk("the-sailor"),
      line: "Oh. It's by Olaf?", step: "cJx4A6" },
    { name: "olaf", npcs: NPC.OLAF, ask: `${SF}-talking-to-olaf-the-bard`, give: `${SW}-giving-the-boots-to-olaf`,
      after: `${SW}-talking-to-olaf-again`, in: I.STURDY_BOOTS, out: I.FREMENNIK_BALLAD,
      flower: flowerAsk("olaf"), bow: bowAsk("olaf"), promise: promiseAsk("olaf"), line: "Oh! Superb! Those are great!", step: "e1867B" },
    { name: "yrsa", npcs: NPC.YRSA, ask: `${SF}-talking-to-yrsa`, again: `${SF}-talking-to-yrsa-talking-to-yrsa-again`,
      give: `${SW}-giving-the-fiscal-statement-to-yrsa`, after: `${SW}-talking-to-yrsa-again`, in: I.FISCAL_STATEMENT,
      out: I.STURDY_BOOTS, flower: flowerAsk("yrsa"), bow: bowAsk("yrsa"), promise: promiseAsk("yrsa"), line: "Certainly! Let me have a look", step: "8iL98F" },
    { name: "brundt", npcs: NPC.BRUNDT, ask: `${SF}-talking-to-brundt`, again: `${SF}-talking-to-brundt-talking-to-brundt-again`,
      give: `${SW}-giving-the-map-to-brundt`, after: `${SW}-talking-to-brundt-again`, in: I.TRACKING_MAP, out: I.FISCAL_STATEMENT,
      flower: flowerAsk("brundt"), promise: promiseAsk("brundt"),
      line: "Excellent work outerlander! And so quickly", step: "Q1dOsa" },
    { name: "sigli", npcs: NPC.SIGLI, ask: `${SF}-finding-sigli-s-bowstring`, again: `${SF}-finding-sigli-s-bowstring-talking-to-sigli-again`,
      give: `${SW}-giving-the-bowstring-to-sigli`, after: `${SW}-talking-to-sigli-again`, in: I.CUSTOM_BOW_STRING, out: I.TRACKING_MAP,
      flower: flowerAsk("sigli"), promise: promiseAsk("sigli"),
      line: "Well met, outerlander. I see some hunting potential", step: "aiidGO" },
    { name: "skulgrimen", npcs: NPC.SKULGRIMEN, ask: bowAsk("skulgrimen"), again: bowAsk("skulgrimen-again"),
      give: `${SW}-giving-the-fish-to-skulgrimen`, after: `${SW}-talking-to-skulgrimen-again`, in: I.UNUSUAL_FISH,
      out: I.CUSTOM_BOW_STRING, flower: flowerAsk("skulgrimen"), promise: promiseAsk("skulgrimen"), line: "Ohh... That's a nice fish.", step: "s_MUAW" },
    { name: "fisherman", npcs: NPC.FISHERMAN, ask: `${SF}-talking-to-the-fisherman`,
      again: `${SF}-talking-to-the-fisherman-talking-to-the-fisherman-again`, give: `${SW}-giving-the-fisherman-the-map`,
      after: `${SW}-talking-to-the-fisherman-again`, in: I.SEA_FISHING_MAP, out: I.UNUSUAL_FISH,
      flower: flowerAsk("the-fisherman"), bow: bowAsk("the-fisherman"), promise: promiseAsk("the-fisherman"), line: "Great work outerlander!", step: "uHd7UN" },
    { name: "swensen", npcs: NPC.SWENSEN, ask: SW, again: `${SW}-talking-to-swensen-again`,
      give: `${SW}-giving-swensen-the-forecast`, after: `${SW}-talking-to-swensen-again-2`, in: I.WEATHER_FORECAST,
      out: I.SEA_FISHING_MAP, promise: promiseAsk("swensen"), line: "Here, outerlander; you may take my map", step: "998Hmd" },
    { name: "peer", npcs: NPC.PEER, ask: `${SW}-peer-the-seer-s-favour`, again: `${SW}-talking-to-peer-the-seer-again`,
      give: `${SW}-giving-peer-the-seer-the-bodyguard-contract`, after: `${SW}-talking-to-peer-the-seer-again-2`,
      in: I.WARRIORS_CONTRACT, out: I.WEATHER_FORECAST, flower: flowerAsk("peer-the-seer"), bow: bowAsk("peer-the-seer"),
      promise: promiseAsk("peer-the-seer"),
      // Live swaps on the first line after the player's (t7432), not after "You may take this forecast".
      line: "You have not only persuaded one of the Fremennik", step: "R0GVxE" },
    { name: "thorvald", npcs: NPC.THORVALD, ask: `${SW}-convincing-thorvald-to-be-a-bodyguard`,
      again: `${SW}-talking-to-thorvald-again`, give: `${SW}-giving-thorvald-his-token`,
      after: `${SW}-talking-to-thorvald-again-2`, in: I.CHAMPIONS_TOKEN, out: I.WARRIORS_CONTRACT,
      flower: flowerAsk("thorvald"), bow: bowAsk("thorvald"), promise: promiseAsk("thorvald"),
      line: "Here outerlander, take this contract;", step: "TI-M0g" },
    { name: "manni", npcs: NPC.MANNI, ask: `${SW}-talking-to-manni-the-reveller`, again: `${SW}-talking-to-manni-again`,
      give: `${SW}-giving-manni-his-legendary-cocktail`, after: `${SW}-talking-to-manni-again-2`,
      in: I.LEGENDARY_COCKTAIL, out: I.CHAMPIONS_TOKEN, flower: flowerAsk("manni"), bow: bowAsk("manni"),
      promise: promiseAsk("manni"),
      line: "Here outerlander, you may take my token.", step: "dkEO0D" },
    { name: "thora", npcs: NPC.THORA, ask: `${SW}-talking-to-thora`, again: `${SW}-talking-to-thora-again`,
      give: `${SW}-getting-thora-s-legendary-cocktail`, after: `${SW}-talking-to-thora-again-2`,
      in: I.PROMISSORY_NOTE, out: I.LEGENDARY_COCKTAIL, flower: flowerAsk("thora"), bow: flowerAsk("thora"),
      line: "Here you go, on the house!", step: "QT__OZ" },
    // Sells the note for 5,000 gp on the dump's own action step (atRour), as live (t7220).
    { name: "askeladden", npcs: NPC.ASKELADDEN, ask: `${SW}-talking-to-askeladden`,
      after: `${SW}-talking-to-askeladden-again`, out: I.PROMISSORY_NOTE, flower: flowerAsk("askeladden"),
      bow: bowAsk("askeladden") },
  ];
  const ALL_ASKED = LINKS.length;
  const THORA = LINKS.findIndex((link) => link.name === "thora");
  /** Requests heard while only the flower is known (Sailor .. Brundt) / Sigli's bowstring is wanted. */
  const FLOWER_PHASE_END = 4;
  const BOW_PHASE = [5, 6];
  const SELL_NOTE_STEP = "atRour";
  const MERCHANT_OPTION = "ask about the merchant's trial";
  const FLOWER_HANDOVER = "Here's that flower you wanted.";

  const linkFor = (npcId) => LINKS.findIndex((link) => link.npcs.has(npcId));

  // --- state -------------------------------------------------------------------------------

  /** Converts an old save's step once: 0 none, 1..13 = 1 + requests heard, item steps = all heard. */
  function convert(player) {
    const old = ctx.readAttribute(player, OLD_MERCHANT_ATTRIBUTE);
    const value = old <= 0 ? 0 : Math.min(old, OLD_LAST_TALK_STEP + 1);
    player.setAttribute(CHAIN_ATTRIBUTE, value);
    if (value > 0 && ctx.trialState(player, T.MERCHANT) === 0) ctx.setTrialState(player, T.MERCHANT, 1);
    return value;
  }

  function chainValue(player) {
    const raw = player.getAttribute(CHAIN_ATTRIBUTE);
    if (raw === undefined || raw === null || Number(raw) === UNCONVERTED) return convert(player);
    return ctx.readAttribute(player, CHAIN_ATTRIBUTE);
  }

  const started = (player) => chainValue(player) > 0;
  const asked = (player) => Math.max(0, Math.min(ALL_ASKED, chainValue(player) - 1));
  const setAsked = (player, count) => player.setAttribute(CHAIN_ATTRIBUTE, 1 + Math.min(ALL_ASKED, count));

  /** The chain runs while the quest does, Sigmund's trial is started and not yet passed. */
  function chainActive(player) {
    const quest = ctx.quest;
    if (!quest) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return false;
    return ctx.trialState(player, T.MERCHANT) !== 2 && started(player);
  }

  /** The most advanced chain item held: the index of the link that gives it out, or -1. */
  function heldLink(player) {
    for (let index = 0; index < LINKS.length; index++) if (ctx.held(player, LINKS[index].out)) return index;
    return -1;
  }

  /** What link `index` says now: { kind, variant } (variant undefined = not the chain's). */
  function phase(player, index) {
    const link = LINKS[index];
    if (link.in !== undefined && ctx.held(player, link.in)) return { kind: "give", variant: link.give };
    const holding = heldLink(player);
    if (holding >= 0 && holding <= index) return { kind: "after", variant: link.after };
    const count = asked(player);
    if (index === count) return { kind: "ask", variant: link.ask };
    const bowPhase = count >= BOW_PHASE[0] && count <= BOW_PHASE[1];
    if (index < count) {
      // While Sigli's bowstring is wanted the earlier links answer the bowstring question (Wiki).
      if (bowPhase && link.bow) return { kind: "again", variant: link.bow };
      // Thora's request heard and nothing held: only Thora, who wants the note, reminds; the earlier
      // links are asked where it is (rsprox 1002313 t3069-t3600, every request heard and the items
      // dropped). Askeladden sells it again below.
      if (count > THORA && index < THORA && link.promise) return { kind: "again", variant: link.promise };
      // A link with no reminder repeats its request. With every request heard and no chain item
      // held (one was lost), that is Askeladden selling the note again (Wiki).
      return { kind: link.again ? "again" : "ask-again", variant: link.again ?? link.ask };
    }
    if (count <= FLOWER_PHASE_END) return { kind: "early", variant: link.flower };
    if (bowPhase) return { kind: "early", variant: link.bow };
    return { kind: "early", variant: undefined };
  }

  // --- variants ----------------------------------------------------------------------------

  function chainVariant(player, stage, npcId) {
    const index = linkFor(npcId);
    if (index < 0 || !chainActive(player)) return undefined;
    return phase(player, index).variant;
  }

  function sigmundVariant(player, stage) {
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return undefined;
    if (ctx.trialState(player, T.MERCHANT) === 2) return SIGMUND_DONE;
    if (!started(player)) return SIGMUND_OFFER;
    return ctx.held(player, I.EXOTIC_FLOWER) ? SIGMUND_FLOWERS : SIGMUND_AGAIN;
  }

  // --- dialogue events ---------------------------------------------------------------------

  /** Records a link's request once the player asks it ("Ask about the Merchant's trial"), and Sigmund's Yes. */
  function onChoice(event, text) {
    const { player, npcId } = event;
    if (NPC.SIGMUND.has(npcId)) {
      if ((text === "yes" || text === "yes.") && !started(player) && ctx.trialState(player, T.MERCHANT) !== 2) {
        setAsked(player, 0);
        ctx.setTrialState(player, T.MERCHANT, 1);
      }
      return;
    }
    if (text !== MERCHANT_OPTION || !chainActive(player)) return;
    const index = linkFor(npcId);
    if (index >= 0 && phase(player, index).kind === "ask" && asked(player) === index) setAsked(player, index + 1);
  }

  /** The take-then-add trade of link `index` (the output lands in the first free slot, as live). */
  function trade(player, index) {
    const link = LINKS[index];
    if (!ctx.held(player, link.in) || ctx.held(player, link.out)) return false;
    ctx.take(player, link.in, 1);
    ctx.give(player, link.out, 1);
    return true;
  }

  function onLine(event) {
    const { player, npcId } = event;
    if (!player) return;
    const text = String(event.text ?? "").trim();
    if (NPC.SIGMUND.has(npcId)) {
      if (text !== FLOWER_HANDOVER) return;
      // Live: the flower leaves and viking 5 -> 6 on the player's line, no message (t7941).
      event.before = () => {
        if (ctx.trialState(player, T.MERCHANT) === 2 || !ctx.held(player, I.EXOTIC_FLOWER)) return;
        ctx.take(player, I.EXOTIC_FLOWER, 1);
        ctx.completeTrial(player, T.MERCHANT);
      };
      return;
    }
    const index = linkFor(npcId);
    const link = LINKS[index];
    if (!link?.line || !text.startsWith(link.line)) return;
    event.before = () => {
      if (chainActive(player)) trade(player, index);
    };
  }

  /** The dump's own `receive` steps come a line late; the hand-over line already traded. */
  function suppressLateReceive(event) {
    event.handled = true;
  }

  function sellNote(event) {
    const { player } = event;
    event.handled = true;
    if (!chainActive(player) || !ctx.held(player, COINS, ASKELADDEN_PRICE) || ctx.held(player, I.PROMISSORY_NOTE)) return;
    ctx.take(player, COINS, ASKELADDEN_PRICE);
    ctx.give(player, I.PROMISSORY_NOTE, 1);
  }

  function answerCondition({ player, npcId, value }) {
    if (NPC.ASKELADDEN.has(npcId)) {
      const coins = player.getInventory().getAmount(COINS);
      if (value.includes("does not have 5,000 gp")) return coins < ASKELADDEN_PRICE;
      if (value.includes("has 5,000 gp")) return coins >= ASKELADDEN_PRICE;
      if (value.includes("inventory is full")) return ctx.freeSlots(player) <= 0;
      if (value.includes("has inventory space")) return ctx.freeSlots(player) > 0;
      return null;
    }
    // Item-use prose after the menu: only a real item use plays it, never a talk.
    if (NPC.SIGMUND.has(npcId) && value.includes("give sigmund other types of flowers")) return false;
    if (NPC.OLAF.has(npcId) && value.includes("use the ballad on the ice queen")) return false;
    return null;
  }

  // --- item on NPC (no capture) ------------------------------------------------------------

  /** A link's "Ask about the Merchant's trial" branch alone, for an item used on that NPC. */
  function merchantBranch(steps) {
    for (const step of steps ?? []) {
      if (step.type !== "choice") continue;
      const option = step.options?.find((entry) => String(entry.text ?? "").trim().toLowerCase() === MERCHANT_OPTION);
      if (option) return option.steps ?? [];
    }
    return [];
  }

  /** Ours: no capture uses an item on a chain NPC; it plays that link's hand-over dialogue. */
  function onItemOnNpc(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (NPC.SIGMUND.has(npcId) && itemId === I.EXOTIC_FLOWER) {
      if (!chainActive(player)) return;
      event.handled = ctx.play(player, npcId, SIGMUND_FLOWERS) !== false;
      return;
    }
    const index = linkFor(npcId);
    if (index < 0 || LINKS[index].in !== itemId || !chainActive(player)) return;
    if (phase(player, index).kind !== "give") return;
    event.handled = ctx.play(player, npcId, LINKS[index].give, merchantBranch) !== false;
  }

  function onLogin({ player }) {
    chainValue(player);
  }

  /**
   * "Ask about becoming a Fremennik" from the chain's townsfolk who are not on the council: their own
   * "not a council member" talk (rsprox 1002313 t2178 the Sailor, t2363 Yrsa, t2536 Skulgrimen).
   */
  const NOT_COUNCIL = [
    [SAILOR_IDS, "the-non-council-members-sailor"],
    [NPC.YRSA, "the-non-council-members-yrsa"],
    [NPC.SKULGRIMEN, "the-non-council-members-skulgrimen"],
    [NPC.THORA, "the-non-council-members-thora-the-barkeep"],
    [NPC.FISHERMAN, "the-non-council-members-fisherman"],
  ];

  ctx.merchant = { LINKS, asked, started, phase, chainActive, CHAIN_ATTRIBUTE, OLD_MERCHANT_ATTRIBUTE };

  api.persistAttribute(CHAIN_ATTRIBUTE, UNCONVERTED);
  api.persistAttribute(OLD_MERCHANT_ATTRIBUTE, 0);
  ctx.chainVariant(chainVariant);
  ctx.variant(NPC.SIGMUND, sigmundVariant);
  for (const [ids, variant] of NOT_COUNCIL) ctx.offer(ids, () => variant);
  ctx.choice(onChoice);
  ctx.line(onLine);
  ctx.condition(answerCondition);
  for (const link of LINKS) if (link.step) ctx.action(link.step, suppressLateReceive);
  ctx.action(SELL_NOTE_STEP, sellNote);
  api.onItemOnNpc(onItemOnNpc);
  api.onPlayerLogin(onLogin);
};
