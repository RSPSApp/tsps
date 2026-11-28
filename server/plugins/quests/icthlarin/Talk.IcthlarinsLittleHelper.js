/**
 * Icthlarin's Little Helper: who says what. The words come from the "Icthlarin's Little Helper" transcript page
 * (npc-dialogues.json); this unit picks its variants, answers its prose conditions, does the transcript's
 * actions, and makes each line look and land as the capture shows (local 1002310; docs/quests/...):
 *
 * - Every captured line gets live's chathead and chat animation (data/lines.json: the Wanderer's normal eyes
 *   4193 or her red-eyed 6187, the Sphinx's chatquiz, the High Priest's chatcon ...).
 * - The quest's varbits change on the line live changes them on (the Sphinx's "Here, I have a token..." is
 *   stage 6, the High Priest's "Cats act as guardians..." stage 7, his "That's right. We need the carpenter..."
 *   stage 15, the ceremony High Priest's "We have a few things to finish here..." stage 24).
 * - Hand-overs are item boxes (objectbox 193) with the item live shows: the token, the salt, the sap, the
 *   linen, the logs, the holy symbol.
 */
const LINES = require("./data/lines.json").lines;

function createTalk(api, state, common, { STAGE, VARBIT, JARS, start, pyramid, ceremony, getQuest }) {
  const { NpcIdentifiers: N } = api.core;
  const { PAGE, ITEM } = common;
  const START_HOOK = "quest:icthlarin-s-little-helper:start";

  const ids = (...list) => new Set(list.filter(Number.isInteger));
  const WANDERER = ids(N.WANDERER, N.WANDERER_2, N.WANDERER_3, 6187);
  const SPHINX = ids(N.SPHINX, N.SPHINX_2);
  const KLENTER = ids(N.KLENTER, 1994);
  const TOWN_HIGH_PRIEST = ids(N.HIGH_PRIEST_2, N.HIGH_PRIEST_4, 6192);
  const CEREMONY_HIGH_PRIEST = ids(N.HIGH_PRIEST_5, N.HIGH_PRIEST_6, N.HIGH_PRIEST_7, N.HIGH_PRIEST_8, 11649);
  const PRIESTS = ids(N.PRIEST_3, N.PRIEST_17, N.PRIEST_18, N.PRIEST_19, N.PRIEST_20, N.PRIEST_21);
  const GATE_PRIEST = N.PRIEST_4; // 4208
  const EMBALMER = ids(N.EMBALMER, N.EMBALMER_2);
  const CARPENTER = ids(N.CARPENTER, N.CARPENTER_2);
  const RAETUL = ids(N.RAETUL, N.RAETUL_2, N.RAETUL_3, 4204);
  const SIAMUN = ids(N.SIAMUN, N.SIAMUN_2, 4205);
  const JEX = ids(N.JEX, N.JEX_2, N.JEX_3);
  const OWNED = new Set([...WANDERER, ...SPHINX, ...KLENTER, ...TOWN_HIGH_PRIEST, ...CEREMONY_HIGH_PRIEST, ...PRIESTS, GATE_PRIEST,
    ...EMBALMER, ...CARPENTER, ...RAETUL, ...SIAMUN, ...JEX]);

  const stage = (player) => state.stage(player);
  let stepIds = null;
  /** Every step id of the quest's page (a message played through startTranscript carries no page). */
  function pageStepIds() {
    if (stepIds) return stepIds;
    stepIds = new Set();
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      if (typeof node.id === "string") stepIds.add(node.id);
      Object.values(node).forEach(walk);
    };
    walk(require("../QuestRuntime").loadTranscripts(api)?.[PAGE]);
    return stepIds;
  }
  const get = (player, varbit) => state.get(player, varbit);
  const complete = (player) => getQuest().isComplete(player);
  const embalmerItems = (player) => get(player, VARBIT.EMBALMER_ITEMS);
  const embalmerDone = (player) => embalmerItems(player) === 7;
  const hasJar = (player) => JARS.some((jar) => jar && common.held(player, jar.item));
  const hasSalt = (player) => common.held(player, ITEM.PILE_OF_SALT) || common.held(player, ITEM.BAG_OF_SALT);

  // ---------------------------------------------------------------------------
  // Variants
  // ---------------------------------------------------------------------------

  function selectVariant({ npcId, player, page }) {
    if (page && page !== PAGE) return null;
    const s = stage(player);
    if (complete(player)) return null;
    if (WANDERER.has(npcId)) {
      if (s === STAGE.NOT_STARTED) return "starting-out-meeting-the-wanderer";
      if (s === STAGE.STARTED) {
        return common.hasSupplies(player) && !common.catFollower(player)
          ? "starting-out-when-the-player-has-all-the-supplies"
          : "starting-out-talking-to-the-wanderer-or-using-a-full-waterskin-or-tinderbox-on-her";
      }
      return null;
    }
    if (SPHINX.has(npcId)) return sphinxVariant(player, s);
    if (KLENTER.has(npcId)) return s >= STAGE.IN_SOPHANEM && s < STAGE.JAR_RETURNED ? "city-of-the-dead-talking-to-klenter" : null;
    if (TOWN_HIGH_PRIEST.has(npcId)) return townHighPriestVariant(player, s);
    if (CEREMONY_HIGH_PRIEST.has(npcId)) return s >= STAGE.PRIEST_DEAD && s <= STAGE.ICTHLARIN_NEXT
      ? "the-devourer-revealed-talking-to-the-high-priest-after-saving-the-ceremony" : null;
    if (npcId === GATE_PRIEST || PRIESTS.has(npcId)) return priestVariant(npcId, player, s);
    if (EMBALMER.has(npcId)) return embalmerVariant(player, s);
    if (CARPENTER.has(npcId)) return carpenterVariant(player, s);
    if (RAETUL.has(npcId)) {
      if (s === STAGE.PREPARATIONS && get(player, VARBIT.MET_EMBALMER) && !get(player, VARBIT.GOT_LINEN)) {
        return common.held(player, ITEM.LINEN) ? "ceremony-preparations-talking-to-raetul-after-buying-his-linen"
          : "ceremony-preparations-aiding-the-embalmer-buying-linen-from-raetul";
      }
      return s >= STAGE.IN_SOPHANEM && s < STAGE.COMPLETE ? "city-of-the-dead-talking-to-raetul" : null;
    }
    if (SIAMUN.has(npcId)) return s >= STAGE.IN_SOPHANEM && s < STAGE.JAR_RETURNED ? "city-of-the-dead-talking-to-siamun" : null;
    return null;
  }

  function sphinxVariant(player, s) {
    if (s < STAGE.SEE_SPHINX) {
      return get(player, VARBIT.MET_SPHINX)
        ? "city-of-the-dead-talking-to-the-sphinx-talking-to-the-sphinx-again"
        : "city-of-the-dead-talking-to-the-sphinx";
    }
    if (s === STAGE.SEE_SPHINX) {
      return get(player, VARBIT.CAT_SAFE)
        ? "figuring-out-what-on-gielinor-is-going-on-being-accused-of-robbing-a-grave-after-answering-the-sphinx-s-riddle"
        : "figuring-out-what-on-gielinor-is-going-on-asking-the-sphinx-for-help";
    }
    if (s === STAGE.SEE_HIGH_PRIEST) return "figuring-out-what-on-gielinor-is-going-on-talking-to-the-sphinx-after-receiving-the-sphinx-s-token";
    // The capture's "great guardian of cats" talk plays from stage 7 to the end (t1358, t2405, t2900).
    return "putting-things-right-talking-to-the-sphinx-after-being-told-to-return-the-jar";
  }

  function townHighPriestVariant(player, s) {
    if (s <= STAGE.SEE_SPHINX) return "city-of-the-dead-talking-to-the-high-priest";
    if (s === STAGE.SEE_HIGH_PRIEST) return "figuring-out-what-on-gielinor-is-going-on-talking-to-the-high-priest-after-receiving-the-sphinx-s-token";
    if (s < STAGE.JAR_RETURNED) return "putting-things-right-talking-to-the-high-priest-after-being-told-to-return-the-jar";
    if (s === STAGE.JAR_RETURNED) return "putting-things-right-informing-the-high-priest-of-the-jar-s-return";
    if (s === STAGE.PREPARATIONS) return "ceremony-preparations-talking-to-the-high-priest-after-being-asked-to-help-with-the-ceremony";
    if (s === STAGE.FINISH) return "finishing-up-speaking-with-the-high-priest-at-the-temple";
    return null;
  }

  function priestVariant(npcId, player, s) {
    if (s >= STAGE.FINISH) return "the-devourer-revealed-talking-to-a-priest-in-the-temple-after-saving-the-ceremony";
    if (s >= STAGE.JAR_RETURNED && s <= STAGE.CEREMONY_BEGUN) {
      return npcId === GATE_PRIEST ? "ceremony-preparations-talking-to-a-priest-by-a-gate" : "putting-things-right-talking-to-a-priest-after-returning-the-jar";
    }
    if (s === STAGE.SEE_HIGH_PRIEST) return "figuring-out-what-on-gielinor-is-going-on-talking-to-a-priest-after-receiving-the-sphinx-s-token";
    if (s >= STAGE.RETURN_JAR && s < STAGE.JAR_RETURNED && npcId !== GATE_PRIEST) {
      return "putting-things-right-talking-to-a-priest-in-the-temple-after-being-told-to-return-the-jar";
    }
    if (s >= STAGE.IN_SOPHANEM && s < STAGE.JAR_RETURNED) {
      return npcId === GATE_PRIEST
        ? "city-of-the-dead-talking-to-a-priest-talking-to-a-priest-by-a-gate"
        : "city-of-the-dead-talking-to-a-priest-talking-to-a-priest-in-the-temple";
    }
    return null;
  }

  function embalmerVariant(player, s) {
    if (s >= STAGE.IN_SOPHANEM && s < STAGE.JAR_RETURNED) return "city-of-the-dead-talking-to-the-embalmer";
    if (s === STAGE.CEREMONY_BEGUN) return "ceremony-preparations-talking-to-the-embalmer-after-aiding-both-him-and-the-carpenter";
    if (s !== STAGE.PREPARATIONS) return null;
    if (!get(player, VARBIT.MET_EMBALMER)) return "ceremony-preparations-aiding-the-embalmer";
    if (embalmerDone(player)) {
      return "ceremony-preparations-aiding-the-embalmer-talking-to-the-embalmer-after-handing-in-all-the-items-and-before-aiding-the-carpenter";
    }
    return "ceremony-preparations-aiding-the-embalmer-talking-to-the-embalmer-again";
  }

  function carpenterVariant(player, s) {
    if (s >= STAGE.IN_SOPHANEM && s < STAGE.JAR_RETURNED) return "city-of-the-dead-talking-to-the-carpenter";
    if (s === STAGE.CEREMONY_BEGUN) return "ceremony-preparations-talking-to-the-carpenter-after-aiding-both-him-and-the-embalmer";
    if (s !== STAGE.PREPARATIONS) return null;
    if (get(player, VARBIT.CARPENTER_LOGS)) {
      return embalmerDone(player)
        ? "ceremony-preparations-aiding-the-carpenter-talking-to-the-carpenter-after-handing-in-the-logs-and-after-aiding-the-embalmer"
        : "ceremony-preparations-aiding-the-carpenter-talking-to-the-carpenter-after-handing-in-the-logs-and-before-aiding-the-embalmer";
    }
    if (!get(player, VARBIT.MET_CARPENTER)) return "ceremony-preparations-aiding-the-carpenter";
    return "ceremony-preparations-aiding-the-carpenter-talking-to-the-carpenter-again";
  }

  // ---------------------------------------------------------------------------
  // Conditions (the transcript's prose, by step id)
  // ---------------------------------------------------------------------------

  function answerCondition({ npcId, player, stepId }) {
    if (!OWNED.has(npcId)) return null;
    switch (stepId) {
      case "pnKe_x": case "ptRhnS": return common.hasSupplies(player);
      case "aP6wOy": case "3ZYnCf": return !common.hasSupplies(player);
      case "SB19GE": return !!common.catFollower(player);
      case "lrOe_5": return !common.catFollower(player);
      case "X5AziL": case "CHEt9f": return common.wearingGhostspeak(player);
      case "A-PiH0": return !common.wearingGhostspeak(player); // Klenter's page, after the quest
      case "CBPOsk": case "HFDnfW": return !common.wearingGhostspeak(player);
      case "49Xo0U": case "D-HbGr": case "CFMl8w": case "4fMYHu": case "pr4swa": case "ibGGn2": case "jDxKab": return common.hasCat(player);
      case "DNzgqI": case "WbhXk3": case "yO0q7C": case "Ivtofg": case "RH5k1y": case "WlWWGQ": return !common.hasCat(player);
      case "UfkEmo": return get(player, VARBIT.CAT_ROBBED) === 1;
      case "wJoAYB": return !get(player, VARBIT.MET_SPHINX);
      case "cOkgIB": return get(player, VARBIT.MET_SPHINX) === 1;
      case "i6RE2X": return !common.held(player, ITEM.TOKEN);
      case "Obm1lw": return common.held(player, ITEM.TOKEN);
      case "Q7PciU": case "GpRiuU": case "uh4uT6": return !hasJar(player);
      case "e97WE_": return hasJar(player);
      case "FipZzG": return common.held(player, ITEM.BUCKET_OF_SAP);
      case "vtJH1G": return hasSalt(player);
      case "3itQb0": return common.held(player, ITEM.LINEN);
      case "f4YnBg": return embalmerItems(player) > 0;
      case "1DWXC3": return !common.held(player, ITEM.BUCKET_OF_SALTWATER);
      case "vWEPUP": return common.held(player, ITEM.BUCKET_OF_SALTWATER);
      case "YcBgrw": return !common.held(player, ITEM.COINS, 30);
      case "vATPuD": return common.held(player, ITEM.COINS, 30);
      case "St2Jxp": return !get(player, VARBIT.GOT_SAP) && common.held(player, ITEM.BUCKET_OF_SAP);
      case "qwUTPR": return !get(player, VARBIT.GOT_SALT) && hasSalt(player);
      case "WV7N7z": return !get(player, VARBIT.GOT_LINEN) && common.held(player, ITEM.LINEN);
      case "OX3qHy": return embalmerDone(player);
      case "A5ETbK": return embalmerItems(player) > 0 && !embalmerDone(player);
      case "8yiKsL": return embalmerItems(player) === 0;
      case "3WZub2": case "Hha-Jz": return !common.held(player, ITEM.WILLOW_LOGS);
      case "kR3DQi": case "Tl8pfv": return common.held(player, ITEM.WILLOW_LOGS);
      case "l89Bzp": return common.held(player, ITEM.HOLY_SYMBOL);
      case "--itYY": return !common.held(player, ITEM.HOLY_SYMBOL);
      case "hYZphZ": return !get(player, VARBIT.GOT_SAP);
      case "HDW4Ru": return !get(player, VARBIT.GOT_SALT);
      case "VaetBI": return !get(player, VARBIT.GOT_LINEN);
      default: return null;
    }
  }

  // ---------------------------------------------------------------------------
  // The transcript's actions and message boxes
  // ---------------------------------------------------------------------------

  /** Item boxes live shows for a hand-over, with what each does (`run` before it shows, `after` past it). */
  const BOXES = {
    SqSxtA: { item: () => ITEM.TOKEN, run: giveToken }, // "The Sphinx gives you a token." (t1051)
    "-btvsf": { item: () => ITEM.TOKEN, run: giveToken },
    Z1e3FH: { item: () => ITEM.TOKEN, run: handInToken }, // "You hand the token to the High Priest." (t1178)
    rQcSO2: { item: (p) => state.jar(p)?.item, run: (p) => giveJar(p) },
    qpmBy3: { item: saltItem, run: (p) => handIn(p, "salt") }, // "You hand some salt to the embalmer." (t2166)
    vOXcKj: { item: saltItem, run: (p) => handIn(p, "salt") },
    wicewv: { item: () => ITEM.BUCKET_OF_SAP, run: (p) => handIn(p, "sap") }, // t2168
    "0cuTDj": { item: () => ITEM.BUCKET_OF_SAP, run: (p) => handIn(p, "sap") },
    YmyQBe: { item: () => ITEM.LINEN, run: (p) => handIn(p, "linen") }, // t2323
    M83RRg: { item: () => ITEM.LINEN, run: (p) => handIn(p, "linen") },
    uBXp8K: { item: () => ITEM.LINEN, run: buyLinen }, // Raetul (t2222)
    "-BYp-2": { item: () => ITEM.WILLOW_LOGS, run: giveLogs }, // t2386
    T25MCO: { item: () => ITEM.WILLOW_LOGS, run: giveLogs },
    dCaTsh: { item: () => ITEM.HOLY_SYMBOL, run: giveHolySymbol }, // "The carpenter gives you a holy symbol." (t2391)
    XO50xP: { item: () => ITEM.HOLY_SYMBOL, run: giveHolySymbol },
    agi1bx: { item: () => ITEM.HOLY_SYMBOL, run: giveHolySymbol },
    FnTufS: { item: () => ITEM.HOLY_SYMBOL, run: giveHolySymbol },
    Ochbk1: { item: () => ITEM.HOLY_SYMBOL, run: handInHolySymbol }, // "You give the holy symbol to the High Priest." (t2832)
    "2cyI1G": { run: (p) => giveJar(p) }, // "You notice an oddly familiar decorative jar lying nearby and pick it up."
    "4TL_gG": { run: (p) => giveJar(p) },
    Pu6Za8: { run: (p) => common.pickUpCat(p) }, // "You pick up your cat." (t466)
    // Klenter's own page after the quest: "Klenter disappears before you can ask him anything." (t3656)
    o5xGHT: { run: (p) => { if (complete(p)) state.set(p, VARBIT.KLENTER, 0); } },
  };

  function saltItem(player) {
    return common.held(player, ITEM.BAG_OF_SALT) ? ITEM.BAG_OF_SALT : ITEM.PILE_OF_SALT;
  }

  function giveToken(player) {
    if (stage(player) > STAGE.SEE_HIGH_PRIEST || get(player, VARBIT.TOKEN_GIVEN)) return;
    if (stage(player) < STAGE.SEE_HIGH_PRIEST) state.setStage(player, STAGE.SEE_HIGH_PRIEST);
    state.set(player, VARBIT.TOKEN_RECEIVED, 1);
    if (!common.held(player, ITEM.TOKEN)) player.getInventory().adds(ITEM.TOKEN, 1);
  }

  function handInToken(player) {
    if (stage(player) !== STAGE.SEE_HIGH_PRIEST || !common.take(player, ITEM.TOKEN)) return;
    state.set(player, VARBIT.TOKEN_GIVEN, 1);
  }

  function giveJar(player) {
    const jar = state.jar(player);
    if (!jar || stage(player) >= STAGE.JAR_RETURNED || hasJar(player)) return;
    player.getInventory().adds(jar.item, 1);
  }

  function handIn(player, what) {
    if (stage(player) !== STAGE.PREPARATIONS) return;
    const varbit = { salt: VARBIT.GOT_SALT, sap: VARBIT.GOT_SAP, linen: VARBIT.GOT_LINEN }[what];
    if (get(player, varbit)) return;
    const taken = what === "salt" ? (common.take(player, ITEM.BAG_OF_SALT) || common.take(player, ITEM.PILE_OF_SALT))
      : common.take(player, what === "sap" ? ITEM.BUCKET_OF_SAP : ITEM.LINEN);
    if (!taken) return;
    state.set(player, VARBIT.MET_EMBALMER, 1);
    state.set(player, varbit, 1);
  }

  function buyLinen(player) {
    if (stage(player) !== STAGE.PREPARATIONS || !common.held(player, ITEM.COINS, 30)) return;
    common.take(player, ITEM.COINS, 30);
    player.getInventory().adds(ITEM.LINEN, 1);
  }

  function giveLogs(player) {
    if (stage(player) !== STAGE.PREPARATIONS || get(player, VARBIT.CARPENTER_LOGS)) return;
    if (!common.take(player, ITEM.WILLOW_LOGS)) return;
    state.set(player, VARBIT.MET_CARPENTER, 1);
    state.set(player, VARBIT.CARPENTER_LOGS, 1);
  }

  /** The holy symbol (t2391): the ceremony begins (stage 16, the town's priests gone to it). */
  function giveHolySymbol(player) {
    const s = stage(player);
    if (s !== STAGE.PREPARATIONS && s !== STAGE.CEREMONY_BEGUN) return;
    if (s === STAGE.PREPARATIONS && !(embalmerDone(player) && get(player, VARBIT.CARPENTER_LOGS))) return;
    if (!common.held(player, ITEM.HOLY_SYMBOL)) player.getInventory().adds(ITEM.HOLY_SYMBOL, 1);
    if (s === STAGE.PREPARATIONS) {
      state.set(player, VARBIT.PRIESTS, 1);
      state.setStage(player, STAGE.CEREMONY_BEGUN);
    }
  }

  function handInHolySymbol(player) {
    if (stage(player) !== STAGE.PRIEST_DEAD) return;
    common.take(player, ITEM.HOLY_SYMBOL);
  }

  /** A transcript message step: shown as live's item box, with its effect as it appears. */
  function messageAction(event) {
    if (event.kind !== "message" && event.step?.type !== "message") return false;
    const box = BOXES[event.stepId];
    if (!box) {
      // Every message of the page is a messagebox live (229), not a chat line (t466, t493, t589 ...).
      if (event.playing?.page === PAGE || pageStepIds().has(event.stepId)) event.box = { statement: true };
      return false;
    }
    box.run?.(event.player);
    const item = box.item?.(event.player);
    if (Number.isInteger(item)) event.box = { items: [item] };
    return true;
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (event.playing?.page && event.playing.page !== PAGE && !BOXES[stepId]) return;
    if (messageAction(event)) return;
    switch (stepId) {
      // The hypnosis: the transcript narrates it; Start plays it on "Don't blink..." continued.
      case "dahKGC": case "bLiUSH": case "V52ykg": case "exQl3V": case "0pXftE":
        event.handled = true;
        if (stepId === "dahKGC") start.hypnotise(player);
        return;
      // The flashbacks' narration: Pyramid plays them.
      case "QhMDGz": case "ZtIxUV": case "mnHg8H": case "FjmOZy": case "NzcsOL": case "U696Aj": case "w37dWs": case "TdWOLv":
      case "BmxcHB": case "UAAgOr": case "XVMTfp": case "GO06qT": case "qe-TgO": case "juxFZi": case "KGKUnx": case "zMjQK_":
        event.handled = true;
        return;
      case "ZzAs_W": // "Yes." to "Do you want to leave?"
        event.handled = true;
        pyramid.leaveFlashbackEarly(player);
        return;
      case "zeRYgo": case "ZDfXBL": case "WIfuzl": // the cat opens the door
        event.handled = true;
        pyramid.catOpensDoor(player);
        return;
      case "M40-5y": case "Y0am3X": // the cat runs off to the Sphinx
        if (stage(player) !== STAGE.SEE_SPHINX) return;
        event.handled = true;
        common.loseCat(player);
        state.set(player, VARBIT.CAT_ROBBED, 1);
        return;
      case "Us0gTE": // the amulet of catspeak: the quest's own reward
        event.handled = true;
        return;
      case "6y5c1d":
        event.handled = true;
        if (stage(player) === STAGE.FINISH && !complete(player)) ceremony.finish(player);
        return;
      default:
    }
  }

  function handleHook({ player, npcId, hook }) {
    if (hook === START_HOOK && WANDERER.has(npcId)) start.startHook(player);
  }

  function handleChoice({ player, npcId, option }) {
    if (!SPHINX.has(npcId) || stage(player) !== STAGE.SEE_SPHINX) return;
    const value = String(option ?? "").trim().toLowerCase();
    if (value === "9.") pendingAnswer.set(player, true);
    else if (["7.", "12.", "14."].includes(value)) pendingAnswer.set(player, false);
  }
  const pendingAnswer = new WeakMap();


  // ---------------------------------------------------------------------------
  // The Sphinx's riddle (the dump's two seams)
  // ---------------------------------------------------------------------------

  const ACCUSED_VARIANT =
    "figuring-out-what-on-gielinor-is-going-on-being-accused-of-robbing-a-grave-after-answering-the-sphinx-s-riddle";
  const clone = (step) => JSON.parse(JSON.stringify(step));

  /**
   * The Wiki gives answers 12 and 14 the "Are you sure?" flow of 7; the dump gives them only a "Same as answering 7"
   * action, so each plays 7's steps after its own line.
   */
  function replaySameAsAnswer(choice) {
    const options = choice.options ?? [];
    const byNumber = new Map(options.map((option) => [String(option.text ?? "").replace(/\.$/, "").trim(), option]));
    return {
      ...choice,
      options: options.map((option) => {
        const only = option.steps?.length === 1 ? option.steps[0] : null;
        const same = only?.type === "action" && /^Same as answering (\S+?)\b/i.exec(String(only.text ?? ""));
        const target = same ? byNumber.get(same[1]) : null;
        if (!target || target === option) return option;
        const tail = (target.steps ?? []).filter((step, i) => !(i === 0 && typeof step.player === "string"));
        return { ...option, steps: [{ player: option.text }, ...tail.map(clone)] };
      }),
    };
  }

  /** The riddle's two endings carry on (the Wiki's {{tact|continue}}) into the grave-robbing accusation. */
  function continuesIntoAccusation(step, previous) {
    if (step?.type !== "jump" || !/^continue/i.test(String(step.reference ?? "")) || Array.isArray(step.steps)) return false;
    const text = previous?.type === "line" ? String(previous.text ?? "") : "";
    return text === "With your grave robbing problem?" || /You're a grave robber\.$/.test(text);
  }

  function riddle(steps) {
    if (!Array.isArray(steps)) return steps;
    return steps.map((step, index) => {
      if (continuesIntoAccusation(step, steps[index - 1])) {
        const accused = require("../QuestRuntime").loadTranscripts(api)?.[PAGE]?.variants?.[ACCUSED_VARIANT];
        return Array.isArray(accused) && accused.length ? { ...step, steps: accused.map(clone) } : step;
      }
      if (step.type === "choice") {
        return replaySameAsAnswer({ ...step, options: (step.options ?? []).map((option) => ({ ...option, steps: riddle(option.steps ?? []) })) });
      }
      if (Array.isArray(step.steps)) return { ...step, steps: riddle(step.steps) };
      return step;
    });
  }

  /** Talk-to on the Sphinx while the riddle is asked: the variant with its seams joined. */
  function sphinxTalkTo(event) {
    const { player } = event;
    if (!SPHINX.has(event.npcId) || stage(player) !== STAGE.SEE_SPHINX || get(player, VARBIT.CAT_SAFE)) return false;
    event.handled = true;
    common.play(player, event.npcId, "figuring-out-what-on-gielinor-is-going-on-asking-the-sphinx-for-help", riddle, event.npc);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Lines: live's heads and animations, and the varbits that move with them
  // ---------------------------------------------------------------------------

  /** Varbits and stages set as a line shows, by its text (capture ticks). */
  const ON_LINE = {
    // The Sphinx's first talk (t625): met.
    "Then I suggest you find something to remind you. I find that important objects and locations can trigger memories, no matter how repressed they are.":
      (p) => state.set(p, VARBIT.MET_SPHINX, 1),
    // The riddle answered (t1426).
    "I didn't rob anybody's grave!": (p) => { if (stage(p) === STAGE.SEE_SPHINX) state.set(p, VARBIT.CAT_SAFE, 1); },
    "Here, I have a token that he will know is from me. Take that to him, and I'm sure he will speak with you.":
      (p) => { if (stage(p) === STAGE.SEE_SPHINX) state.setStage(p, STAGE.SEE_HIGH_PRIEST); },
    "The Devourer wishes to destroy every soul in existence, living or dead. As you can imagine, this has brought her into conflict with Icthlarin.":
      (p) => state.set(p, VARBIT.SPHINX_AMASCUT, 1),
    "Cats act as guardians against the Devourer. I'm surprised the Sphinx didn't tell you this. As such, only a cat can open the pyramid door.":
      (p) => { if (stage(p) === STAGE.SEE_HIGH_PRIEST && get(p, VARBIT.TOKEN_GIVEN)) state.setStage(p, STAGE.RETURN_JAR); },
    "That's right. We need the carpenter to create a new holy symbol for the ceremony. He lives over to the east. The embalmer also needs help gathering some supplies. He lives just south of here.":
      (p) => { if (stage(p) === STAGE.JAR_RETURNED) state.setStage(p, STAGE.PREPARATIONS); },
    "Well there's actually no need for me to go anywhere. I already have some willow logs here.":
      (p) => state.set(p, VARBIT.MET_CARPENTER, 1),
    "We have a few things to finish here, but then we'll head back up into the city. Please join us there.":
      (p) => { if (stage(p) === STAGE.PRIEST_DEAD) state.setStage(p, STAGE.ICTHLARIN_NEXT); },
  };

  function lineKey(request) {
    const step = request.step ?? {};
    const isPlayer = typeof step.player === "string";
    return `${isPlayer ? "player" : step.speaker ?? request.definition?.getName?.() ?? ""}|${String(request.text ?? "")}`;
  }

  function handleLine(request) {
    const { player } = request;
    const ours = request.playing?.page === PAGE || OWNED.has(request.npcId);
    if (!ours) return;
    const presented = LINES[lineKey(request)];
    if (presented) {
      const [head, anim] = presented;
      if (head > 0 && typeof request.step?.player !== "string") request.speakerId = head;
      if (Number.isInteger(anim)) request.expression = anim;
    }
    const effect = ON_LINE[String(request.text ?? "")];
    if (effect) {
      const before = request.before;
      request.before = () => { before?.(); effect(player); };
    }
    // "Don't blink..." continued is the hypnosis (t485).
    if (request.text === "Don't blink..." && stage(player) === STAGE.STARTED) {
      const after = request.after;
      request.after = () => { after?.(); start.hypnotise(player); };
    }
  }

  return {
    selectVariant, answerCondition, handleAction, handleHook, handleChoice, handleLine, sphinxTalkTo, OWNED, KLENTER,
    _test: { BOXES, ON_LINE, lineKey },
  };
}

module.exports = { createTalk };
