/**
 * Eagles' Peak's people, as the capture plays them (RSProx, rev 243; ticks in docs/quests/eagles-peak/README.md):
 * - Charlie: the start is live's own prompt, "Start the Eagles' Peak quest?" with Yes./No. in place of the
 *   transcript's two options (t83); the stage is 5 as he answers the Yes (t86). The hand-in is a ferret used
 *   on him, or a talk while one is carried; 40 comes with his last line (t2438).
 * - Asyff: the costume chain moves eaglepeak_nickolaus_chat (3110) to 4 on "I'll see what I can do." (t778)
 *   and to 5 as he makes the costumes (t818).
 * - Nickolaus in the eyrie: 3110 goes to 2 as his first menu opens (t334) and to 3 on "That's a good idea..."
 *   (t491); his Shout-to across the chasm is the Nest unit's. The disguise goes over on the message box's
 *   continue (25, t2025).
 * - Nickolaus at the camp-site: the lesson (Ferret unit) from 25, Transcript:Nickolaus after the lesson.
 */
module.exports = function attachEaglesPeakNpcs(api, ep) {
  const { state, TEXT } = ep;
  const { STAGE, VARBIT, CHAT, ITEM, NPC } = state;
  const { Equipment, Item, Skill } = api.core;

  const HUNTER_REQUIREMENT = 27;
  const COSTUME_FEATHERS = 10;
  const COSTUME_COINS = 50;
  const START_PROMPT = "Start the Eagles' Peak quest?";
  const START_ID = "eagles-peak:start";
  const DECLINE_ID = "eagles-peak:decline";
  const START_OPTION = "Sure.  Any idea where I should start looking?";
  const DECLINE_OPTION = "Sorry, I don't have the time.";
  /** Charlie's answer to the Yes (t86): the stage and the start message come with it. */
  const START_LINE = "Well the northern ferret is mostly found around the mountains";
  const NICKOLAUS_AGREED_LINE = "That's a good idea. There are plenty of feathers around here. I'll see what I can do.";
  const ASYFF_ASKED_LINE = "I'll see what I can do.";

  const V = Object.freeze({
    CHARLIE_START: "starting-out-before-starting-eagle-s-peak",
    CHARLIE_AGAIN: "starting-out-talking-to-charlie-again",
    CHARLIE_FINISH: "finishing-up",
    CHARLIE_AFTER: "standard-dialogue-after-completing-eagles-peak",
    CHARLIE_FERRET_AFTER: "standard-dialogue-using-a-ferret-on-charlie-after-eagles-peak",
    ASYFF_COSTUME: "getting-a-bird-costume",
    ASYFF_WITHOUT: "getting-a-bird-costume-returning-to-asyff-without-the-materials",
    ASYFF_WITH: "getting-a-bird-costume-returning-to-asyff-with-the-materials",
    ASYFF_ANOTHER: "getting-a-bird-costume-asking-for-another-costume",
    NEST_DISGUISE: "saving-nickolaus-with-eagle-outfit",
    NEST_AGAIN: "saving-nickolaus-talking-to-nickolaus-again",
    CAMP_LESSON: "saving-nickolaus-talking-to-nickolaus-by-the-camp",
    CAMP_BEFORE: "before-starting-eagles-peak",
    CAMP_AFTER: "after-eagles-peak",
  });

  const COND = Object.freeze({
    LOW_HUNTER: "EI4KEb", HUNTER: "lf198B",
    NO_COINS: "guIJ1-", COINS: "G6Owrt",
    CHASM_HAS_DISGUISE: "-t7KBZ", CHASM_NO_DISGUISE: "SnpQQ4",
    WEARING: "s8BAWs", HAS_SPARE: "7lpXS1", NO_SPARE: "6htIhv",
  });
  /** The disguise's message box (Hjm29J) and the completion (YUPVwJ). */
  const DISGUISE_BOX = "Hjm29J";
  const COMPLETE_ACTION = "YUPVwJ";

  const stage = (player) => state.stage(player);
  const chat = (player) => state.get(player, VARBIT.NICKOLAUS_CHAT);
  const held = state.held;

  /** The Wiki: 27 Hunter, boostable. */
  const hunterLevel = (player) => Number(player.getSkillManager().getCurrentLevel(Skill.HUNTER)) || 0;

  function hasCostumeMaterials(player) {
    return held(player, ITEM.EAGLE_FEATHER, COSTUME_FEATHERS) && held(player, ITEM.SWAMP_TAR) && held(player, ITEM.YELLOW_DYE);
  }

  function wearingDisguise(player) {
    const equipment = player.getEquipment();
    return equipment.get(Equipment.CAPE_SLOT)?.getId?.() === ITEM.EAGLE_CAPE
      && equipment.get(Equipment.HEAD_SLOT)?.getId?.() === ITEM.FAKE_BEAK;
  }

  const spareDisguise = (player) => held(player, ITEM.EAGLE_CAPE) && held(player, ITEM.FAKE_BEAK);

  /** Which Nickolaus: the eyrie's (2023) or the camp-site's (2024). */
  const inEyrie = (npc, player) => (npc?.getLocation?.() ?? player.getLocation()).getY() > 4000;

  const isNickolaus = (npcId) => npcId === NPC.NICKOLAUS_SHOUT || npcId === NPC.NICKOLAUS_NORMAL || npcId === NPC.NICKOLAUS_DISGUISE
    || npcId === NPC.NICKOLAUS_NEST || npcId === NPC.NICKOLAUS_CAMP;

  /** Biohazard's Asyff waits while the costumes are this quest's business (asked for, not yet handed over). */
  function asyffOwned(player) {
    const current = stage(player);
    return (current === STAGE.CAVE_OPEN || current === STAGE.DOOR_OPEN) && chat(player) >= CHAT.AGREED;
  }

  // ==========================================================================
  // Variants and conditions
  // ==========================================================================

  function selectVariant({ npcId, player, npc }) {
    const current = stage(player);
    if (npcId === NPC.CHARLIE) {
      if (current >= STAGE.COMPLETE) return V.CHARLIE_AFTER;
      if (current >= STAGE.FERRET_CAUGHT && held(player, ITEM.FERRET)) return V.CHARLIE_FINISH;
      if (current >= STAGE.STARTED) return V.CHARLIE_AGAIN;
      return V.CHARLIE_START;
    }
    if (npcId === NPC.ASYFF) {
      if (current !== STAGE.CAVE_OPEN && current !== STAGE.DOOR_OPEN && current < STAGE.DISGUISE_GIVEN) return null;
      if (current >= STAGE.COMPLETE) return null;
      const talked = chat(player);
      if (talked < CHAT.AGREED) return null;
      if (talked === CHAT.AGREED) return V.ASYFF_COSTUME;
      if (talked === CHAT.ASKED_ASYFF) return hasCostumeMaterials(player) ? V.ASYFF_WITH : V.ASYFF_WITHOUT;
      return V.ASYFF_ANOTHER;
    }
    if (!isNickolaus(npcId)) return null;
    if (inEyrie(npc, player)) {
      if (current === STAGE.DOOR_OPEN) return V.NEST_DISGUISE;
      if (current === STAGE.DISGUISE_GIVEN) return V.NEST_AGAIN;
      return null;
    }
    if (current >= STAGE.FERRET_CAUGHT) return V.CAMP_AFTER;
    if (current >= STAGE.DISGUISE_GIVEN) return V.CAMP_LESSON;
    if (current === STAGE.NOT_STARTED) return V.CAMP_BEFORE;
    return null;
  }

  function answerCondition({ npcId, player, stepId }) {
    switch (stepId) {
      case COND.LOW_HUNTER: return npcId === NPC.CHARLIE ? hunterLevel(player) < HUNTER_REQUIREMENT : null;
      case COND.HUNTER: return npcId === NPC.CHARLIE ? hunterLevel(player) >= HUNTER_REQUIREMENT : null;
      case COND.NO_COINS: return npcId === NPC.ASYFF ? !held(player, ITEM.COINS, COSTUME_COINS) || !hasCostumeMaterials(player) : null;
      case COND.COINS: return npcId === NPC.ASYFF ? held(player, ITEM.COINS, COSTUME_COINS) && hasCostumeMaterials(player) : null;
      case COND.CHASM_HAS_DISGUISE: return isNickolaus(npcId) ? spareDisguise(player) || wearingDisguise(player) : null;
      case COND.CHASM_NO_DISGUISE: return isNickolaus(npcId) ? !spareDisguise(player) && !wearingDisguise(player) : null;
      case COND.WEARING: return isNickolaus(npcId) ? wearingDisguise(player) : null;
      case COND.HAS_SPARE: return isNickolaus(npcId) ? spareDisguise(player) : null;
      case COND.NO_SPARE: return isNickolaus(npcId) ? !spareDisguise(player) : null;
      default: return null;
    }
  }

  /** Live asks the start with its own prompt (t83): "Yes." plays the transcript's "Sure..." branch. */
  function handleMenu(notice) {
    if (notice.npcId !== NPC.CHARLIE || stage(notice.player) !== STAGE.NOT_STARTED) return;
    const options = notice.options ?? [];
    const yes = options.find((option) => option.text === START_OPTION);
    const no = options.find((option) => option.text === DECLINE_OPTION);
    if (!yes || !no) return;
    notice.prompt = START_PROMPT;
    notice.options = [{ ...yes, text: "Yes.", id: START_ID }, { ...no, text: "No.", id: DECLINE_ID }];
  }

  function startQuest(player) {
    if (stage(player) !== STAGE.NOT_STARTED) return;
    state.setStage(player, STAGE.STARTED);
    player.sendMessage(ep.questStartMessage(player, ep.PAGE));
  }

  /**
   * Nickolaus's head as live sends it (if_setnpchead): in the eyrie eaglepeak_nickolaus_normal (1485) across the chasm
   * and on the nest side, eaglepeak_nickolaus_disguise (1486) once he has the disguise (t334-491, t2010-2028); at the
   * camp-site eaglepeak_nickolaus_campsite (2024), 1485 in the lesson's copy (t2169-2255). The transcript lists
   * 1484-1486 for every line, so without this the first, the Shout-to one, would show.
   */
  function nickolausHead(request) {
    if (request.speakerId != null || !isNickolaus(request.npcId)) return;
    if (request.step?.player !== undefined || request.step?.speaker !== "Nickolaus") return;
    const { player } = request;
    if (inEyrie(request.npc, player)) {
      request.speakerId = stage(player) >= STAGE.DISGUISE_GIVEN ? NPC.NICKOLAUS_DISGUISE : NPC.NICKOLAUS_NORMAL;
      return;
    }
    request.speakerId = ep.Scenes.get(player) ? NPC.NICKOLAUS_NORMAL : NPC.NICKOLAUS_CAMP;
  }

  function handleLine(request) {
    nickolausHead(request);
    const { npcId, player, text } = request;
    if (npcId === NPC.CHARLIE && typeof text === "string" && text.startsWith(START_LINE)) {
      request.before = () => startQuest(player);
      return;
    }
    if (isNickolaus(npcId) && text === NICKOLAUS_AGREED_LINE && stage(player) === STAGE.CAVE_OPEN) {
      request.before = () => { if (chat(player) < CHAT.AGREED) state.set(player, VARBIT.NICKOLAUS_CHAT, CHAT.AGREED); };
      return;
    }
    if (npcId === NPC.ASYFF && text === ASYFF_ASKED_LINE && chat(player) === CHAT.AGREED
      && request.playing?.variant === V.ASYFF_COSTUME) {
      request.before = () => { if (chat(player) === CHAT.AGREED) state.set(player, VARBIT.NICKOLAUS_CHAT, CHAT.ASKED_ASYFF); };
    }
  }

  /** The first menu across the chasm moves the chat on (t334). */
  function handleNickolausMenu(notice) {
    if (!isNickolaus(notice.npcId) || stage(notice.player) !== STAGE.CAVE_OPEN) return;
    if (chat(notice.player) === CHAT.SPOTTED) state.set(notice.player, VARBIT.NICKOLAUS_CHAT, CHAT.TALKED);
  }

  function handleConditionChosen({ npcId, player, stepId }) {
    if (npcId === NPC.ASYFF && stepId === COND.COINS) makeCostumes(player);
  }

  /** Two costumes (t818): the materials and 50 coins go, two capes and two beaks come, chat 5. */
  function makeCostumes(player) {
    if (chat(player) !== CHAT.ASKED_ASYFF || !hasCostumeMaterials(player) || !held(player, ITEM.COINS, COSTUME_COINS)) return;
    const inventory = player.getInventory();
    inventory.deleteNumber(ITEM.EAGLE_FEATHER, COSTUME_FEATHERS);
    inventory.deleteNumber(ITEM.SWAMP_TAR, 1);
    inventory.deleteNumber(ITEM.YELLOW_DYE, 1);
    inventory.deleteNumber(ITEM.COINS, COSTUME_COINS);
    // The step frees at most three slots and gives four items; what does not fit goes to the ground, one at a time.
    for (const itemId of [ITEM.EAGLE_CAPE, ITEM.EAGLE_CAPE, ITEM.FAKE_BEAK, ITEM.FAKE_BEAK]) {
      inventory.forceAdd(player, new Item(itemId, 1));
    }
    state.set(player, VARBIT.NICKOLAUS_CHAT, CHAT.COSTUMES_MADE);
  }

  /** The cape and beak over to Nickolaus: on the box's continue, the spare goes and the stage is 25 (t2025). */
  function giveDisguise(player) {
    if (stage(player) !== STAGE.DOOR_OPEN || !spareDisguise(player)) return;
    player.getInventory().deleteNumber(ITEM.EAGLE_CAPE, 1);
    player.getInventory().deleteNumber(ITEM.FAKE_BEAK, 1);
    state.setStage(player, STAGE.DISGUISE_GIVEN);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (stepId === DISGUISE_BOX) {
      event.box = { statement: true };
      event.after = () => giveDisguise(player);
      return;
    }
    if (stepId === COMPLETE_ACTION) {
      event.handled = true;
      event.end = true;
      completeQuest(player);
    }
  }

  function completeQuest(player) {
    if (stage(player) !== STAGE.FERRET_CAUGHT || !held(player, ITEM.FERRET)) return;
    player.getInventory().deleteNumber(ITEM.FERRET, 1);
    ep.quest.complete(player);
  }

  /** The ferret used on Charlie (t2427) plays the hand-in; after the quest, his line about another one. */
  function ferretOnCharlie(event) {
    const { player, itemId } = event;
    const npc = event.target ?? event.npc;
    if (itemId !== ITEM.FERRET || npc?.getId?.() !== NPC.CHARLIE) return false;
    const current = stage(player);
    if (current === STAGE.FERRET_CAUGHT) {
      event.handled = true;
      ep.play(player, V.CHARLIE_FINISH, NPC.CHARLIE, npc);
      return true;
    }
    if (current >= STAGE.COMPLETE) {
      event.handled = true;
      ep.play(player, V.CHARLIE_FERRET_AFTER, NPC.CHARLIE, npc, "Charlie");
      return true;
    }
    return false;
  }

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:menu", handleMenu);
  api.onCustomEvent("npc-dialogue:menu", handleNickolausMenu);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnNpc(ferretOnCharlie);

  return { asyffOwned, wearingDisguise, spareDisguise, hunterLevel, V, TEXT };
};
