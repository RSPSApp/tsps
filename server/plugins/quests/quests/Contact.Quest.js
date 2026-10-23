/**
 * Contact! (members).
 *
 * The words come from the "Contact!" transcript page (plus the "Jex", "Osman"
 * and "Sophanem Guard" pages for their post-quest follow-ups); this plugin
 * supplies the variant selectors for the High Priest, Jex, the Sophanem guards,
 * Maisa and Osman, the prose-condition answers (requirements, tinderbox/torch
 * purchases, Maisa's Prince Ali quiz, the Keris hand-out), the three cut scenes,
 * the temple cellar/dungeon route, Kaleef's body, the Giant Scarab fight and the
 * completion reward.
 *
 * Varps/varbits (evidence: `yarn --cwd server dump:cs2 4024` and
 * `lookup-gameval varbit contact*` -> cache names): the stage is varbit 3274
 * ("contact", bits 0-7) on base varp 964 ("contact_master"); sibling bits used
 * here are 3275 ("contact_people_vis", cache locs 20333/20334/20345 and NPCs
 * 6167-6170 transform on it) and 3279 ("contact_been_downstairs").
 *
 * Stages (recording 101, varbit 3274): 0 not started, 10 agreed to help, 20 cut
 * scene 1 done, 30 asked about a way in from below, 40 Jex told about the
 * cellar trapdoor, 50 Kaleef's parchment taken, 60 Maisa convinced, 70 Osman
 * agreed to meet, 90 cut scene 2 done, 100 Giant Scarab active, 110 scarab
 * dead, 120 Osman's account heard, 130 complete. The capture has no stage 80;
 * the second Al Kharid conversation is a confirmation, not a stage.
 *
 * Requirements (OSRS Wiki): Prince Ali Rescue and Icthlarin's Little Helper;
 * gated with quest:is-complete and answered on the "lacks the requirements"
 * condition (eHzg2g). Rewards: 1 Quest point, 7,000 Thieving XP, a bankable
 * Combat lamp, the Keris dagger (from the scarab or reclaimed from Osman), and
 * access to Sophanem's dungeon, bank and shops (contact_people_vis is set on
 * completion, which turns the cache's ruined market stalls back into the shops).
 * The lamp's Rub menu grants two 7,000 XP wishes among Attack, Strength,
 * Defence, Hitpoints, Ranged and Magic (capture 101 ticks 8619/8629 and the
 * Combat lamp transcript); varbit 3287 records 0/1/2 wishes and the lamp is
 * deleted only after the second successful wish.
 *
 * Route (recording 101): temple ladder 20275 lands at 2765,5131; trapdoor
 * 20340 lands at 2166,4409,2; the maze traps 20271/20272 are interactive; the
 * boss ladder 20287 lands at 2297,4298 only after Jex and starts cut scene 3 at
 * stage 90. The capture does not show every wall-collision or trap-damage roll,
 * so those remain approximations.
 * - The Giant Scarab is an owner-only spawn at 2269,4316; its summoned riders
 *   and the cave-in are not modelled, and the fight starts from the cut
 *   scene-3 stage direction.
 * - Kaleef's body is the cache "Body" (Search) multi 44597; the handler refuses
 *   repeated searches but the object's cache form cannot leave the searchable
 *   range because the stage map never enters 71-110.
 * - A retry after a wrong Prince Ali answer replays the full two-question
 *   conversation instead of the shorter retry variant.
 * - The Sophanem bank booths are shared content and are not closed pre-quest;
 *   only the market stalls and city guards react to contact_people_vis.
 * - There is no post-quest Jex variant on his page, so a completed player
 *   replays "beetle-battle-talking-to-jex".
 *
 * Source: https://oldschool.runescape.wiki/w/Contact! and
 * https://oldschool.runescape.wiki/w/Transcript:Contact!
 */
module.exports = function registerContactQuest(api) {
  const {
    CountdownTask,
    DialogueChainBuilder,
    EndDialogue,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    OptionDialogue,
    Skill,
    StatementDialogue,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  // ==========================================================================
  // Transcript pages
  // ==========================================================================

  const PAGE = "Contact!";
  const JEX_PAGE = "Jex";

  // ==========================================================================
  // Varps / varbits
  // ==========================================================================

  const VARP_CONTACT_MASTER = 964; // "contact_master"
  const VARBIT_CONTACT = 3274; // "contact" bits 0-7
  const VARBIT_CONTACT_PEOPLE_VIS = 3275; // "contact_people_vis" bit 8
  const VARBIT_CONTACT_BEEN_DOWNSTAIRS = 3279; // "contact_been_downstairs" bit 13
  const VARBIT_CONTACT_MAISA_INVIS = 3284; // "contact_maisa_invis"
  const VARBIT_CONTACT_LAMP = 3287; // contact lamp wishes used (0..2)

  // ==========================================================================
  // Stages
  // ==========================================================================

  // Captured varbit 3274 values (recording 101): 10,20,30,40,50,60,70,90,100,110,120,130.
  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 10;
  const STAGE_CUTSCENE_1_DONE = 20;
  const STAGE_ASKED_ABOUT_TUNNELS = 30;
  const STAGE_JEX_TOLD = 40;
  const STAGE_BODY_SEARCHED = 50;
  const STAGE_MAISA_CONVINCED = 60;
  const STAGE_OSMAN_AGREED = 70;
  const STAGE_CAVES = 90;
  const STAGE_BOSS_FIGHT = 100;
  const STAGE_BOSS_DEAD = 110;
  const STAGE_OSMAN_TALKED = 120;
  const STAGE_COMPLETE = 130;

  // ==========================================================================
  // NPCs
  // ==========================================================================

  const HIGH_PRIEST_NPC_IDS = new Set([
    NpcIdentifiers.HIGH_PRIEST_2, // 4206, the town High Priest (cache transform)
    NpcIdentifiers.HIGH_PRIEST_4, // 11502, second Contact-indexed id
  ]);
  const JEX_NPC_ID = NpcIdentifiers.JEX; // 3875
  const MAISA_NPC_ID = NpcIdentifiers.MAISA; // 3876
  const MAISA_NPC_IDS = new Set([MAISA_NPC_ID, 6164]); // 6164 is the base multi that transforms to 3876
  // Capture 101 ticks 8078-8083: Maisa (2258,4317) is talked to across the four-block
  // chasm from the east landing (dialogue opens at 2263,4320); QH also names the
  // west side. Keep this reach on her quiz stages only; range 1 stays the default.
  const MAISA_TALK_RANGE = 10;
  const OSMAN_NPC_ID = NpcIdentifiers.OSMAN_9; // 4286, resolved content id for handlers/chatheads
  // The dungeon actor spawns as the cache parent; at stage 110 varbit 3274
  // resolves 11568 contact_osman_cave_instance to 4286. The world rows use the
  // matching Al Kharid (6165) and Sophanem (6166) cache parents.
  const OSMAN_DUNGEON_NPC_ID = 11568;
  const COENUS_NPC_ID = NpcIdentifiers.COENUS; // 11499, cut scene 1 speaker
  const GIANT_SCARAB_NPC_ID = NpcIdentifiers.GIANT_SCARAB; // 797, level 191
  const SOPHANEM_GUARD_NPC_IDS = new Set([
    NpcIdentifiers.SOPHANEM_GUARD, // 3881
    NpcIdentifiers.SOPHANEM_GUARD_2, // 3882
    NpcIdentifiers.SOPHANEM_GUARD_3, // 3883
    NpcIdentifiers.SOPHANEM_GUARD_4, // 3884
  ]);
  const SOPHANEM_GUARD_CHATHEAD_ID = NpcIdentifiers.SOPHANEM_GUARD; // 3881
  /** Owner-only NPCs this plugin spawns (dedupe + cleanup). */
  const OWNED_NPC_IDS = new Set([
    MAISA_NPC_ID,
    OSMAN_NPC_ID,
    OSMAN_DUNGEON_NPC_ID,
    GIANT_SCARAB_NPC_ID,
  ]);

  // ==========================================================================
  // Objects (no generated identifier exists; names from the gameval loc dump)
  // ==========================================================================

  const TEMPLE_LADDER_ID = 20275; // Temple of the Lesser Gods -> bank cellar
  const CELLAR_TRAPDOOR_ID = 20340; // bank cellar -> Sophanem dungeon
  const BOSS_LADDER_ID = 20287; // chasm climb-down beside the Giant Scarab
  const KALEEF_BODY_MULTI_ID = 44597; // cache multi -> 44046 "Body" (Search)
  const CHASM_TRAP_IDS = new Set([20271, 20272]); // recorded floor-spike and spear traps

  // ==========================================================================
  // Items
  // ==========================================================================

  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX; // 590
  const LIT_TORCH_ITEM_ID = ItemIdentifiers.LIT_TORCH; // 594
  const TORCH_ITEM_ID = ItemIdentifiers.TORCH; // 595
  const UNLIT_TORCH_ITEM_ID = ItemIdentifiers.UNLIT_TORCH; // 596
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const KERIS_ITEM_ID = ItemIdentifiers.KERIS; // 10581
  const PARCHMENT_ITEM_ID = ItemIdentifiers.PARCHMENT; // 10585
  const COMBAT_LAMP_ITEM_ID = ItemIdentifiers.COMBAT_LAMP; // 10586

  const LAMP_WISHES = 2;
  const LAMP_XP = 7000;
  const LAMP_MENU_TITLE = "<col=000080>Which stat do you wish for?";
  const LAMP_MESSAGES = new Map([
    [Skill.ATTACK, "You wish for strengthened Attack - your wish comes true as you gain 7000 XP."],
    [Skill.STRENGTH, "You wish for strengthened Strength - your muscles bulge as you gain 7000 XP."],
    [Skill.DEFENCE, "You wish for strengthened Defence - your wish comes true as you gain 7000 XP."],
    [Skill.HITPOINTS, "You wish for strengthened Hitpoints - you feel tougher as you gain 7000 XP."],
    [Skill.RANGED, "You wish for strengthened Ranged skill - your eye becomes keener as you gain 7000 XP."],
    [Skill.MAGIC, "You wish for strengthened Magic skill - your mind feels expansive as you gain 7000 XP."],
  ]);

  const TINDERBOX_PRICE = 50;
  const TORCH_PRICE = 200;
  const KERIS_REPLACEMENT_PRICE = 20000;

  // ==========================================================================
  // Locations
  // ==========================================================================

  const CELLAR_LANDING = new Location(2765, 5131, 0);
  const MAZE_ENTRY = new Location(2166, 4409, 2); // captured trapdoor landing
  const BOSS_LANDING = new Location(2297, 4298, 0); // captured boss-ladder landing
  const BOSS_SPAWN = new Location(2269, 4316, 0);
  const MAISA_SPAWN = new Location(2258, 4317, 0); // Quest Helper west side of the chasm
  const OSMAN_SPAWN = new Location(2274, 4315, 0); // captured post-battle Osman
  const DUNGEON = { minX: 2100, maxX: 2500, minY: 4200, maxY: 4500 };
  const AL_KHARID_OSMAN = { x: 3286, y: 3180 };
  const SOPHANEM_OSMAN = { x: 3289, y: 2818 };

  const PARCHMENT_PARAGRAPHS = [
    "Kaleef,",
    "Your mission is to relieve our agent inside Menaphos. We know of a tunnel beneath the " +
      "Temple of the Lesser Gods you can use to bypass the lockdown. Be vigilant of traps and " +
      "the hostile natives. They're about as welcoming as the Menaphites, only slightly better " +
      "looking.",
    "Os",
  ];

  // ==========================================================================
  // State
  // ==========================================================================

  const BITS_ATTRIBUTE = "quest.contact.bits";
  const LAMP_WISHES_ATTRIBUTE = "contact:lamp-wishes";
  const BIT_HP_MENU_SEEN = 1 << 0;
  const BIT_OSMAN_MET = 1 << 1;
  const BIT_KERIS_TAKEN = 1 << 2;
  const BIT_BODY_SEARCHED = 1 << 3;

  const ILH_KEY = "ictlharins_little_helper";
  const PAR_KEY = "prince_ali_rescue";

  let quest;
  const Scenes = createQuestScenes(api);
  const cameraWatch = new WeakMap();

  const CUTSCENE_CAMERAS = {
    "starting-out-cut-scene-1-sophanem-and-menaphos-meet": { move: [3278, 2786, 480], look: [3261, 2783, 320] },
    "i-spy-with-my-little-eye-cut-scene-2-osman-sneaks-into-sophanem": { move: [3297, 2799, 500], look: [3314, 2799, 340] },
    "beetle-battle-cut-scene-3-osman-and-maisa-speak-below-sophanem": { move: [2263, 4327, 610], look: [2260, 4313, 410], shake: true },
  };
  let groundItems;
  /** Correct Prince Ali quiz answers so far, transient per conversation. */
  const answersRight = new WeakMap();
  /** Bank guard: has one of the questions been asked in this conversation? */
  const guardAsked = new WeakMap();
  /** Osman: has a wrong persuasion option been picked in this conversation? */
  const osmanWrong = new WeakMap();
  /** Owner-only quest NPCs, per player: { maisa, osman, boss }. */
  const trackedNpcs = new Map();
  /** Open Rub menu: { player, item, slot, wishes } so a moved/lost lamp cannot pay XP. */
  const lampSessions = new WeakMap();

  // ==========================================================================
  // Helpers
  // ==========================================================================

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    return isQuestComplete(player, PAR_KEY) && isQuestComplete(player, ILH_KEY);
  }

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function hasTorch(player) {
    return (
      held(player, LIT_TORCH_ITEM_ID) ||
      held(player, TORCH_ITEM_ID) ||
      held(player, UNLIT_TORCH_ITEM_ID)
    );
  }

  function hasKeris(player) {
    return hasBit(player, BIT_KERIS_TAKEN) || held(player, KERIS_ITEM_ID);
  }

  function norm(value) {
    return String(value ?? "").trim().toLowerCase().replace(/[.!?]+$/, "");
  }

  function npcLocation(npc) {
    return npc?.getLocation?.() ?? npc?.getSpawnLocation?.() ?? null;
  }

  function near(npc, x, y, radius = 10) {
    const location = npcLocation(npc);
    if (!location) return false;
    return (
      Math.max(Math.abs(location.getX() - x), Math.abs(location.getY() - y)) <= radius
    );
  }

  function inDungeon(npc) {
    const location = npcLocation(npc);
    if (!location) return false;
    const x = location.getX();
    const y = location.getY();
    return x >= DUNGEON.minX && x <= DUNGEON.maxX && y >= DUNGEON.minY && y <= DUNGEON.maxY;
  }

  function teleport(player, location) {
    player.moveTo(new Location(location.x, location.y, location.z));
  }

  function playCutscene(player, npcId, variant) {
    const shot = CUTSCENE_CAMERAS[variant];
    if (shot) {
      stopCamera(player);
      Scenes.controls(player, true, true);
      Scenes.camera(player, shot.move, shot.look);
      watchCamera(player, shot);
    }
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function watchCamera(player, shot) {
    const token = {};
    cameraWatch.set(player, token);
    if (shot.shake) {
      for (let i = 0; i < 5; i++) {
        Scenes.later(player, 38 + i * 4, () => {
          if (cameraWatch.get(player) === token) player.getPacketSender().sendCameraShake(0, 5, 0, 0);
        });
      }
    }
    const poll = () => {
      if (cameraWatch.get(player) !== token) return;
      if (Scenes.chatOpen(player)) {
        Scenes.later(player, 1, poll);
        return;
      }
      stopCamera(player);
    };
    Scenes.later(player, 1, poll);
  }

  function stopCamera(player) {
    if (!cameraWatch.delete(player)) return;
    Scenes.cancel(player);
    Scenes.controls(player, false);
    player.getPacketSender().sendCameraReset();
  }

  function scheduleCutscene(player, npcId, variant) {
    const play = () => playCutscene(player, npcId, variant);
    if (!TaskManager || !CountdownTask) {
      play();
      return;
    }
    TaskManager.submit(new CountdownTask(player, 1, play));
  }

  function trackNpc(player, key, spawn) {
    let tracked = trackedNpcs.get(player);
    if (!tracked) {
      tracked = {};
      trackedNpcs.set(player, tracked);
    }
    const existing = tracked[key];
    if (existing?.isRegistered?.()) return existing;
    delete tracked[key];
    const npc = api.spawnNpc({
      id: spawn.id,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) tracked[key] = npc;
    return npc;
  }

  function removeOwnedNpcs(player) {
    const tracked = trackedNpcs.get(player);
    if (tracked) {
      for (const key of Object.keys(tracked)) {
        if (tracked[key]) api.removeNpc(tracked[key]);
        delete tracked[key];
      }
    }
    trackedNpcs.delete(player);
    const world = api.getWorld();
    if (!world?.getNpcs) return;
    for (const npc of world.getNpcs()) {
      if (npc?.getOwner?.() === player && OWNED_NPC_IDS.has(npc.getId?.())) api.removeNpc(npc);
    }
  }

  function ensureMaisa() {
    // Maisa 6164 is the canonical world spawn (corrected to 2258,4317); her
    // cache transform hides her during the scarab encounter via varbit 3284.
  }

  function syncMaisaVisibility(player) {
    const stage = quest.getStage(player);
    const hidden = stage >= STAGE_BOSS_FIGHT && stage < STAGE_OSMAN_TALKED;
    player.getPacketSender().sendVarbit(VARBIT_CONTACT_MAISA_INVIS, hidden ? 1 : 0);
  }

  function ensureDungeonOsman(player) {
    if (quest.getStage(player) !== STAGE_BOSS_DEAD) return;
    trackNpc(player, "osman", {
      id: OSMAN_DUNGEON_NPC_ID,
      x: OSMAN_SPAWN.x,
      y: OSMAN_SPAWN.y,
      z: OSMAN_SPAWN.z,
    });
  }

  function buy(player, itemId, price) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough room in your inventory.");
      return false;
    }
    if (!held(player, COINS_ITEM_ID, price)) {
      player.sendMessage("You don't have enough coins.");
      return false;
    }
    player.getInventory().deleteNumber(COINS_ITEM_ID, price);
    player.getInventory().adds(itemId, 1);
    return true;
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectVariant(context) {
    const { npcId, player, npc } = context;
    if (HIGH_PRIEST_NPC_IDS.has(npcId)) return selectHighPriestVariant(player);
    if (npcId === JEX_NPC_ID) return selectJexVariant(player);
    if (SOPHANEM_GUARD_NPC_IDS.has(npcId)) return selectGuardVariant(player);
    if (MAISA_NPC_IDS.has(npcId)) return selectMaisaVariant(player, npc);
    if (npcId === OSMAN_NPC_ID) return selectOsmanVariant(player, npc);
    return null;
  }

  function selectHighPriestVariant(player) {
    if (!isQuestComplete(player, ILH_KEY)) return null;
    const stage = quest.getStage(player);
    if (stage === STAGE_NOT_STARTED) return "starting-out-talking-to-the-high-priest";
    if (stage <= STAGE_CUTSCENE_1_DONE) {
      return hasBit(player, BIT_HP_MENU_SEEN)
        ? "starting-out-talking-to-high-priest-after-the-cutscene-talking-to-the-high-priest-again-before-asking-if-there-is-a-way-in-from-below"
        : "starting-out-talking-to-high-priest-after-the-cutscene";
    }
    if (stage === STAGE_ASKED_ABOUT_TUNNELS) {
      return "starting-out-talking-to-high-priest-again-before-visiting-jex";
    }
    if (stage < STAGE_OSMAN_TALKED) {
      return "the-route-into-menaphos-talking-to-high-priest-before-entering-the-cellar";
    }
    if (stage < STAGE_COMPLETE) return "contact-established";
    return "standard-dialogue-after-finishing-contact";
  }

  function selectJexVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ASKED_ABOUT_TUNNELS) return "standard-dialogue";
    if (stage === STAGE_ASKED_ABOUT_TUNNELS) return "the-route-into-menaphos-talking-to-jex";
    if (stage === STAGE_JEX_TOLD) {
      return "the-route-into-menaphos-talking-to-jex-again-before-entering-the-cellar";
    }
    if (stage < STAGE_CAVES) {
      return "the-sect-of-scabaras-talking-to-jex-after-entering-the-tunnels";
    }
    if (quest.isComplete(player)) return "standard-dialogue";
    return "beetle-battle-talking-to-jex";
  }

  function selectGuardVariant(player) {
    if (quest.isComplete(player)) return "sophanem-bank";
    guardAsked.set(player, false);
    return "the-sect-of-scabaras-talking-to-sophanem-guard-before-entering-the-tunnels";
  }

  function selectMaisaVariant(player, npc) {
    if (!inDungeon(npc)) return null;
    const stage = quest.getStage(player);
    if (stage < STAGE_JEX_TOLD) return null;
    if (stage <= STAGE_BODY_SEARCHED) {
      answersRight.set(player, 0);
      return "kaleef-s-corpse-talking-to-maisa";
    }
    return stage === STAGE_MAISA_CONVINCED
      ? "kaleef-s-corpse-talking-to-maisa-again-after-correctly-answering-but-before-speaking-to-osman"
      : null;
  }

  /** Talk across the chasm on Maisa's quiz stages; her real NPC alone gets this reach. */
  function widenMaisaTalkRange(event) {
    if (event.clickType === 0) return;
    if (!MAISA_NPC_IDS.has(event.npcId) || event.npc?.getOwner?.()) return;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_JEX_TOLD || stage > STAGE_MAISA_CONVINCED) return;
    event.range = MAISA_TALK_RANGE;
  }

  function selectOsmanVariant(player, npc) {
    const stage = quest.getStage(player);
    if (inDungeon(npc)) {
      return stage === STAGE_BOSS_DEAD
        ? "beetle-battle-talking-to-osman-after-the-battle"
        : null;
    }
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-contact";
    if (near(npc, SOPHANEM_OSMAN.x, SOPHANEM_OSMAN.y)) {
      if (stage === STAGE_OSMAN_AGREED) {
        return "i-spy-with-my-little-eye-talking-to-osman-outside-sophanem";
      }
      return null;
    }
    if (near(npc, AL_KHARID_OSMAN.x, AL_KHARID_OSMAN.y)) {
      if (stage === STAGE_MAISA_CONVINCED) {
        osmanWrong.set(player, false);
        return hasBit(player, BIT_OSMAN_MET)
          ? "i-spy-with-my-little-eye-talking-to-osman-at-al-kharid-again-after-failing-to-persuade-him"
          : "i-spy-with-my-little-eye-talking-to-osman-at-al-kharid";
      }
      if (stage === STAGE_OSMAN_AGREED) {
        return "i-spy-with-my-little-eye-talking-to-osman-at-al-kharid-again-after-succeeding-to-persuade-him";
      }
      if (stage > STAGE_OSMAN_AGREED && stage < STAGE_COMPLETE) {
        return "i-spy-with-my-little-eye-speaking-to-not-osman-in-al-kharid";
      }
    }
    return null;
  }

  // ==========================================================================
  // Conditions
  // ==========================================================================

  function answerCondition({ player, stepId }) {
    switch (stepId) {
      case "qOPORa": // continuing from Icthlarin's Little Helper
        return isQuestComplete(player, ILH_KEY);
      case "al2pYK": // coming back to the High Priest
        return quest.getStage(player) >= STAGE_STARTED;
      case "eHzg2g": // lacks the requirements
        return !meetsRequirements(player);
      case "LIHxRe": // has a tinderbox
        return held(player, TINDERBOX_ITEM_ID);
      case "RN1-ss": // doesn't have a tinderbox
        return !held(player, TINDERBOX_ITEM_ID);
      case "doqSMl": // has a lit or unlit torch
        return hasTorch(player);
      case "953AIu": // doesn't have a lit or unlit torch
        return !hasTorch(player);
      case "IjxRNT": // zero answers right
        return (answersRight.get(player) ?? 0) === 0;
      case "PeJYOi": // one answer right
        return (answersRight.get(player) ?? 0) === 1;
      case "qEP0VV": // both answers right
        return (answersRight.get(player) ?? 0) >= 2;
      case "2GWmuO": // Keris dagger not picked up yet
        return !hasKeris(player);
      case "3M8FWU": // Osman: never took Kaleef's dagger
        return !hasKeris(player);
      case "fvwmsv": // enough coins for a replacement Keris
        return !player.getInventory().isFull() && held(player, COINS_ITEM_ID, KERIS_REPLACEMENT_PRICE);
      case "J1tNbh": // not enough coins for a replacement Keris
        return !held(player, COINS_ITEM_ID, KERIS_REPLACEMENT_PRICE);
      case "uFe5fC": // no room for a replacement Keris
        return player.getInventory().isFull();
      case "tREXKm": // bank guard: no tinderbox
        return !held(player, TINDERBOX_ITEM_ID);
      case "aPBeLE": // bank guard: has a tinderbox
        return held(player, TINDERBOX_ITEM_ID);
      case "vfn6Zm": // bank guard: not enough coins for a tinderbox
        return !held(player, COINS_ITEM_ID, TINDERBOX_PRICE);
      case "e8_z0u": // bank guard: enough coins for a tinderbox
        return held(player, COINS_ITEM_ID, TINDERBOX_PRICE);
      case "uVRbPq": // bank guard: not enough coins for a torch
        return !held(player, COINS_ITEM_ID, TORCH_PRICE);
      case "pnDEHH": // bank guard: enough coins for a torch
        return held(player, COINS_ITEM_ID, TORCH_PRICE);
      case "xZ1Dh7": // guard: "You can't. I'd better go." before asking anything
        return guardAsked.get(player) !== true;
      case "97VNU2": // guard: "I'd better go." after asking something
        return guardAsked.get(player) === true;
      case "seRhY5": // Osman: "I don't know." before a wrong persuasion option
        return osmanWrong.get(player) !== true;
      case "S-upHg": // Osman: "Fine. I give up." after a wrong persuasion option
        return osmanWrong.get(player) === true;
      default:
        return null;
    }
  }

  /** Fired once a condition branch has been chosen (the wiki guard passed). */
  function handleConditionChosen(event) {
    const { player, npcId, stepId } = event;
    if (MAISA_NPC_IDS.has(npcId) && stepId === "qEP0VV") {
      quest.setStage(player, STAGE_MAISA_CONVINCED);
    }
  }

  // ==========================================================================
  // Choices
  // ==========================================================================

  function handleChoice(event) {
    const { player, npcId, option } = event;
    const value = norm(option);
    if (HIGH_PRIEST_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) <= STAGE_CUTSCENE_1_DONE) {
        setBit(player, BIT_HP_MENU_SEEN);
        if (value === "is there any way into menaphos from below") {
          quest.setStage(player, STAGE_ASKED_ABOUT_TUNNELS);
        }
      }
      return;
    }
    if (npcId === JEX_NPC_ID) {
      if (quest.getStage(player) === STAGE_ASKED_ABOUT_TUNNELS && value === "i'd better get down there") {
        quest.setStage(player, STAGE_JEX_TOLD);
      }
      return;
    }
    if (SOPHANEM_GUARD_NPC_IDS.has(npcId)) {
      if (
        value === "what are you doing down here" ||
        value === "do you have a tinderbox" ||
        value === "do you have a torch" ||
        value === "how come you're not spotty"
      ) {
        guardAsked.set(player, true);
      }
      return;
    }
    if (MAISA_NPC_IDS.has(npcId)) {
      if (value === "draynor village" || value === "leela") {
        answersRight.set(player, Math.min(2, (answersRight.get(player) ?? 0) + 1));
      }
      return;
    }
    if (npcId === OSMAN_NPC_ID) {
      const stage = quest.getStage(player);
      if (value === "it could drive a wedge between the menaphite cities") {
        if (stage === STAGE_MAISA_CONVINCED) {
          quest.setStage(player, STAGE_OSMAN_AGREED);
        }
        return;
      }
      if (
        value === "it must be boring here" ||
        value === "there might be treasures underneath sophanem" ||
        value === "it would give you the chance to spy first hand" ||
        value === "i don't know"
      ) {
        osmanWrong.set(player, true);
        return;
      }
      if (value === "i want to talk to you about sophanem") {
        if (stage === STAGE_MAISA_CONVINCED) setBit(player, BIT_OSMAN_MET);
      }
    }
  }

  // ==========================================================================
  // Stage directions / messages
  // ==========================================================================

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
      // Starting out.
      case "DFAYNr": // cut scene 1 begins
        event.handled = true;
        if (quest.getStage(player) === STAGE_NOT_STARTED) quest.setStage(player, STAGE_STARTED);
        scheduleCutscene(player, COENUS_NPC_ID, "starting-out-cut-scene-1-sophanem-and-menaphos-meet");
        return;
      case "tEWAER": // end of cut scene 1
        event.handled = true;
        event.end = true;
        if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_CUTSCENE_1_DONE);
        return;

      // Guard purchases.
      case "vATumM": // Contact guard tinderbox, 50 coins
      case "5mF9rl": // bank guard tinderbox, 50 coins
        if (!buy(player, TINDERBOX_ITEM_ID, TINDERBOX_PRICE)) {
          event.handled = true;
          event.end = true;
        }
        return;
      case "uBuEbx": // Contact guard unlit torch, 200 coins
      case "cnHVxj": // bank guard unlit torch, 200 coins
        if (!buy(player, UNLIT_TORCH_ITEM_ID, TORCH_PRICE)) {
          event.handled = true;
          event.end = true;
        }
        return;

      // I spy with my little eye.
      case "CtRXdK": // cut scene 2 begins
        event.handled = true;
        if (quest.getStage(player) === STAGE_OSMAN_AGREED) {
          scheduleCutscene(player, OSMAN_NPC_ID, "i-spy-with-my-little-eye-cut-scene-2-osman-sneaks-into-sophanem");
        }
        return;
      case "1qe3Gi": // after cut scene 2 ends
        event.handled = true;
        if (quest.getStage(player) === STAGE_OSMAN_AGREED) quest.setStage(player, STAGE_CAVES);
        return;

      // Beetle battle.
      case "_dkntA": // the Giant Scarab attacks
        event.handled = true;
        event.end = true;
        if (quest.getStage(player) === STAGE_CAVES) {
          quest.setStage(player, STAGE_BOSS_FIGHT);
          player.getPacketSender().sendVarbit(VARBIT_CONTACT_MAISA_INVIS, 1);
          spawnGiantScarab(player);
        }
        return;
      case "1Ipn6a": // Osman leaves the cavern
        removeTracked(player, "osman");
        if (quest.getStage(player) === STAGE_BOSS_DEAD) {
          quest.setStage(player, STAGE_OSMAN_TALKED);
          player.getPacketSender().sendVarbit(VARBIT_CONTACT_MAISA_INVIS, 0);
        }
        return;
      case "Rc_Gnh": // Osman hands over the unclaimed Keris
        if (player.getInventory().isFull()) {
          event.handled = true;
          player.sendMessage("You don't have enough room to carry the dagger.");
          return;
        }
        player.getInventory().adds(KERIS_ITEM_ID, 1);
        setBit(player, BIT_KERIS_TAKEN);
        return;
      case "wxq343": // replacement Keris, 20,000 coins
        if (buy(player, KERIS_ITEM_ID, KERIS_REPLACEMENT_PRICE)) {
          setBit(player, BIT_KERIS_TAKEN);
        } else {
          event.handled = true;
          event.end = true;
        }
        return;

      // Contact established.
      case "5AdqF8": // Congratulations! Quest complete!
        event.handled = true;
        event.end = true;
        if (quest.getStage(player) >= STAGE_OSMAN_TALKED && !quest.isComplete(player)) {
          quest.complete(player);
        }
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Dungeon
  // ==========================================================================

  function spawnGiantScarab(player) {
    const tracked = trackedNpcs.get(player) ?? {};
    if (tracked.boss?.isRegistered?.()) return;
    trackedNpcs.set(player, tracked);
    const npc = api.spawnNpc({
      id: GIANT_SCARAB_NPC_ID,
      x: BOSS_SPAWN.x,
      y: BOSS_SPAWN.y,
      z: BOSS_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) tracked.boss = npc;
    removeTracked(player, "maisa");
  }

  function removeTracked(player, key) {
    const tracked = trackedNpcs.get(player);
    if (!tracked?.[key]) return;
    api.removeNpc(tracked[key]);
    delete tracked[key];
  }

  function handleNpcDeath({ killer, npc, npcId }) {
    if (npcId !== GIANT_SCARAB_NPC_ID || !killer || !npc) return;
    const owner = npc.getOwner?.();
    if (owner && owner !== killer) return;
    const tracked = trackedNpcs.get(killer);
    if (tracked?.boss !== npc) return;
    delete tracked.boss;
    if (quest.getStage(killer) !== STAGE_BOSS_FIGHT) return;
    quest.setStage(killer, STAGE_BOSS_DEAD);
    const location = npc.getLocation?.() ?? npc.getSpawnLocation?.();
    if (location && groundItems) {
      groundItems.registerLocation(killer, new Item(KERIS_ITEM_ID, 1), location);
    }
    ensureDungeonOsman(killer);
  }

  /** Temple ladder down and the cellar trapdoor: the quest owns both routes. */
  function handleLadderClaim(request) {
    if (request.handled || !request.player) return;
    if (request.objectId === TEMPLE_LADDER_ID) {
      request.handled = true;
      useTempleLadder(request.player);
      return;
    }
    if (request.objectId === CELLAR_TRAPDOOR_ID) {
      request.handled = true;
      useCellarTrapdoor(request.player);
      return;
    }
    if (request.objectId === BOSS_LADDER_ID) {
      request.handled = true;
      useBossLadder(request.player);
    }
  }

  function useTempleLadder(player) {
    if (quest.getStage(player) >= STAGE_JEX_TOLD || quest.isComplete(player)) {
      teleport(player, CELLAR_LANDING);
      return;
    }
    startTranscript(
      api,
      player,
      JEX_NPC_ID,
      JEX_PAGE,
      "standard-dialogue-attempting-to-climb-down-the-nearby-ladder"
    );
  }

  function useBossLadder(player) {
    if (quest.getStage(player) < STAGE_JEX_TOLD && !quest.isComplete(player)) {
      player.sendMessage("You should speak to Jex about these tunnels first.");
      return;
    }
    teleport(player, BOSS_LANDING);
    if (quest.getStage(player) !== STAGE_CAVES) return;
    const tracked = trackedNpcs.get(player);
    if (!tracked?.boss?.isRegistered?.()) {
      scheduleCutscene(player, OSMAN_NPC_ID, "beetle-battle-cut-scene-3-osman-and-maisa-speak-below-sophanem");
    }
  }

  function useCellarTrapdoor(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_JEX_TOLD && !quest.isComplete(player)) {
      player.sendMessage("You should speak to Jex about these tunnels first.");
      return;
    }
    teleport(player, MAZE_ENTRY);
    if (stage === STAGE_BOSS_DEAD) {
      ensureDungeonOsman(player);
      return;
    }
    if (stage === STAGE_JEX_TOLD) {
      player.getPacketSender().sendVarbit(VARBIT_CONTACT_BEEN_DOWNSTAIRS, 1);
      startTranscript(
        api,
        player,
        SOPHANEM_GUARD_CHATHEAD_ID,
        PAGE,
        "the-sect-of-scabaras-talking-to-sophanem-guard-when-entering-the-tunnels"
      );
    }
    ensureMaisa(player);
  }

  function handleObjectInteraction(event) {
    if (CHASM_TRAP_IDS.has(event.objectId)) {
      event.handled = true;
      const success = Math.random() < 0.5;
      event.player.sendMessage(
        success ? "You successfully disable the trap." : "You accidentally set off a trap!"
      );
      return;
    }
    if (event.objectId !== KALEEF_BODY_MULTI_ID) return;
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_JEX_TOLD) return;
    if (hasBit(player, BIT_BODY_SEARCHED) || held(player, PARCHMENT_ITEM_ID)) {
      player.sendMessage("There is nothing else of interest on the body.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough room to take anything.");
      return;
    }
    player.getInventory().adds(PARCHMENT_ITEM_ID, 1);
    setBit(player, BIT_BODY_SEARCHED);
    if (quest.getStage(player) === STAGE_JEX_TOLD) quest.setStage(player, STAGE_BODY_SEARCHED);
    player.sendMessage("You search the body and find a bloody parchment.");
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function lampWishes(player) {
    return Math.max(0, Math.min(LAMP_WISHES, Number(player.getAttribute(LAMP_WISHES_ATTRIBUTE)) || 0));
  }

  function sendLampWishes(player) {
    player.getPacketSender().sendVarbit(VARBIT_CONTACT_LAMP, lampWishes(player));
  }

  function setLampWishes(player, wishes) {
    player.setAttribute(LAMP_WISHES_ATTRIBUTE, wishes);
    sendLampWishes(player);
  }

  function lampInSlot(player, session) {
    const item = player.getInventory().get(session.slot);
    return item === session.item && item?.getId?.() === COMBAT_LAMP_ITEM_ID;
  }

  function openLampMenu(player, moreOptions) {
    const options = moreOptions
      ? ["Ranged.", "Magic.", "Nothing at the moment.", "Previous wishes."]
      : ["Attack.", "Strength.", "Defence.", "Hitpoints.", "Another wish."];
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new OptionDialogue(0, {
        executeOption(option) {
          chooseLampOption(player, Number(option), moreOptions);
        },
      }, ...options).setTitle(LAMP_MENU_TITLE),
    ));
  }

  function chooseLampOption(player, option, moreOptions) {
    const session = lampSessions.get(player);
    if (!session || session.wishes !== lampWishes(player) || !lampInSlot(player, session)) {
      lampSessions.delete(player);
      player.getPacketSender().sendInterfaceRemoval();
      return;
    }
    if (moreOptions) {
      if (option === 3) {
        lampSessions.delete(player);
        player.getPacketSender().sendInterfaceRemoval();
        return;
      }
      if (option === 4) {
        openLampMenu(player, false);
        return;
      }
    } else if (option === 5) {
      openLampMenu(player, true);
      return;
    }
    const skill = moreOptions
      ? (option === 1 ? Skill.RANGED : option === 2 ? Skill.MAGIC : null)
      : [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.HITPOINTS][option - 1] ?? null;
    if (!skill) return;
    grantLampWish(player, session, skill);
  }

  function grantLampWish(player, session, skill) {
    if (session.wishes >= LAMP_WISHES || lampWishes(player) !== session.wishes || !lampInSlot(player, session)) {
      lampSessions.delete(player);
      player.getPacketSender().sendInterfaceRemoval();
      return;
    }
    const manager = player.getSkillManager();
    const before = manager.getExperience(skill);
    manager.addExperience(skill, LAMP_XP, false);
    if (manager.getExperience(skill) === before) {
      lampSessions.delete(player);
      player.getPacketSender().sendInterfaceRemoval();
      player.sendMessage("You cannot gain experience in that skill right now.");
      return;
    }
    const wishes = session.wishes + 1;
    player.sendMessage(LAMP_MESSAGES.get(skill));
    setLampWishes(player, wishes);
    lampSessions.delete(player);
    if (wishes >= LAMP_WISHES) {
      player.sendMessage("The lamp dissipates into smoke that drifts away.");
      player.getInventory().deleteAtSlot(session.slot, 1);
    }
    player.getPacketSender().sendInterfaceRemoval();
  }

  function rubCombatLamp(event) {
    const { player } = event;
    const wishes = lampWishes(player);
    if (wishes >= LAMP_WISHES) {
      player.sendMessage("The lamp has already granted both of its wishes.");
      return;
    }
    const item = player.getInventory().get(event.slot);
    if (!item || item.getId?.() !== COMBAT_LAMP_ITEM_ID) return;
    lampSessions.set(player, { item, slot: event.slot, wishes });
    openLampMenu(player, false);
  }

  function handleItemAction(event) {
    if (event.itemId === COMBAT_LAMP_ITEM_ID) {
      if (!String(event.option ?? "").toLowerCase().includes("rub")) return;
      event.handled = true;
      rubCombatLamp(event);
      return;
    }
    if (event.itemId !== PARCHMENT_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("read")) return;
    event.handled = true;
    readParchment(event.player);
  }

  function readParchment(player) {
    const builder = new DialogueChainBuilder();
    PARCHMENT_PARAGRAPHS.forEach((paragraph, index) =>
      builder.add(new StatementDialogue(index, paragraph))
    );
    builder.add(new EndDialogue(PARCHMENT_PARAGRAPHS.length));
    player.getDialogueManager().startDialogues(builder);
  }

  function handleGroundItemPickup(event) {
    if (event.groundItemId !== KERIS_ITEM_ID) return;
    if (event.player.getInventory().isFull()) return;
    setBit(event.player, BIT_KERIS_TAKEN);
  }

  // ==========================================================================
  // Login / logout
  // ==========================================================================

  function sendPeopleVisible(player) {
    if (!quest.isComplete(player)) return;
    player.getPacketSender().sendVarbit(VARBIT_CONTACT_PEOPLE_VIS, 1);
  }

  function syncContactVarps({ player }) {
    sendPeopleVisible(player);
    sendLampWishes(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendPeopleVisible(player);
    syncMaisaVisibility(player);
    sendLampWishes(player);
    if (!inDungeonArea(player)) return;
    ensureMaisa(player);
    ensureDungeonOsman(player);
  }

  function inDungeonArea(player) {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    return x >= DUNGEON.minX && x <= DUNGEON.maxX && y >= DUNGEON.minY && y <= DUNGEON.maxY;
  }

  function handleLogout({ player }) {
    lampSessions.delete(player);
    stopCamera(player);
    removeOwnedNpcs(player);
  }

  // ==========================================================================
  // Journal / reward
  // ==========================================================================

  function buildJournal(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I spoke to the High Priest of Icthlarin about the citizens of</str>",
        "<str>Sophanem trapped in Menaphos.</str>",
        "<str>With Maisa's help they were smuggled home disguised among the</str>",
        "<str>Menaphite dead, and the Giant Scarab in the tunnels was slain.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_OSMAN_TALKED) {
      return [
        "I defeated the <col=800000>Giant Scarab</col> and Osman told me Maisa has",
        "agreed to help the citizens of Sophanem return home.",
        "",
        "I should let the <col=800000>High Priest</col> know the good news.",
      ];
    }
    if (stage >= STAGE_BOSS_DEAD) {
      return [
        "I defeated the <col=800000>Giant Scarab</col> in the tunnels.",
        "",
        "I should speak to <col=800000>Osman</col>.",
      ];
    }
    if (stage === STAGE_CAVES) {
      return [
        "Osman has gone into the tunnels beneath Sophanem. He told me to",
        "give him two hours, so I should look for him in the caves.",
      ];
    }
    if (stage >= STAGE_OSMAN_AGREED) {
      return [
        "Osman has agreed to meet Maisa. He told me to meet him outside",
        "the gates to <col=800000>Sophanem</col>.",
      ];
    }
    if (stage === STAGE_MAISA_CONVINCED) {
      return [
        "I found Maisa in the cavern below Sophanem. She will help the",
        "citizens escape if I can convince <col=800000>Osman</col> to meet her.",
        "",
        "He is in <col=800000>Al Kharid</col>, outside the palace.",
      ];
    }
    if (stage === STAGE_BODY_SEARCHED) {
      return [
        "I found Kaleef's body in the tunnels and took a bloody parchment.",
        "It orders him to relieve an agent in Menaphos through tunnels",
        "beneath the Temple of the Lesser Gods.",
        "",
        "There was a woman, <col=800000>Maisa</col>, just to the west.",
      ];
    }
    if (stage === STAGE_JEX_TOLD) {
      return [
        "I climbed down the trapdoor into the tunnels beneath Sophanem.",
        "I should look for a way through to Menaphos.",
      ];
    }
    if (stage === STAGE_JEX_TOLD) {
      return [
        "Jex told me the tunnels were opened when something burst up from",
        "the cellar. He covered the tunnel with a trapdoor, which I can",
        "reach by climbing down the ladder in the temple.",
        "",
        "He warned me to take a light source and a tinderbox.",
      ];
    }
    if (stage === STAGE_ASKED_ABOUT_TUNNELS) {
      return [
        "The High Priest suggested I ask <col=800000>Jex</col> about the Sect of",
        "Scabaras. He is at the <col=800000>Temple of the Lesser Gods</col> in the",
        "north east corner of Sophanem.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "The High Priest wants to free the citizens of Sophanem trapped in",
        "Menaphos. I agreed to help, and saw the Menaphites fire on his",
        "delegation when he tried to cross the bridge.",
        "",
        "I should ask him about ways into the city.",
      ];
    }
    return [
      "I can start this quest by talking to the <col=800000>High Priest</col> of",
      "Icthlarin in the <col=800000>Great Temple</col> in Sophanem.",
      "",
      "I must have completed <col=800000>Icthlarin's Little Helper</col> and",
      "<col=800000>Prince Ali Rescue</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 7000);
    player.getPacketSender().sendVarbit(VARBIT_CONTACT_PEOPLE_VIS, 1);
    removeOwnedNpcs(player);
  }


  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(LAMP_WISHES_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "contact",
    name: "Contact!",
    varpId: VARP_CONTACT_MASTER,
    varbitId: VARBIT_CONTACT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 7000, label: "Thieving" }],
    rewardItemId: COMBAT_LAMP_ITEM_ID,
    rewardItemLabel: "Combat lamp",
    otherRewards: [
      "Access to the Sophanem dungeon",
      "Access to Sophanem's bank and shops",
      "Keris dagger",
    ],
    buildJournal,
    onReward: grantReward,
  });

  groundItems = api.getItemOnGroundManager();

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("ladders:climb", handleLadderClaim);
  api.onCustomEvent("player:bootstrap-complete", syncContactVarps);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcRoute(widenMaisaTalkRange);
  api.onItemAction(handleItemAction);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
