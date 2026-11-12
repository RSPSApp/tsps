/**
 * Ghosts Ahoy (members), aligned to the user's revision 242 capture of a full run
 * (20261112T092603-5ab63b4). The facts each step relies on, with ticks, are in
 * docs/quests/ghosts-ahoy/README.md.
 *
 * The words are the "Ghosts Ahoy" transcript's (npc-dialogues.json, osrsreboxed-db); this
 * plugin picks the variant, answers its conditions, shows its boxes as live does (item boxes
 * and message boxes, not chat lines) and moves the quest on the page live does.
 *
 * Stages are varbit 217 (ahoy_questvar), sent as they are:
 *   1 asked Velorina, 2 Necrovarus refused, 3 sent to the Old crone, 4 the crone drank her tea,
 *   5 the crone has the three materials, 6 amulet enchanted, 7 Necrovarus commanded,
 *   8 complete.
 * The subquests are the other varbits of varp 408 (ghostsahoy/State.GhostsAhoy.js).
 *
 * Units: ghostsahoy/Runedraw (Robin's game), Shipwreck (toy boat, chests, mast, rocky island,
 * map), Voyage (the Ghost captain), Tomb (Necrovarus's tomb). The Ectophial and Ectofuntus are
 * plugins/skills/Ectofuntus.plugin.js, the barriers plugins/areas/PortPhasmatysBarrier.plugin.js.
 */
module.exports = function registerGhostsAhoyQuest(api) {
  const { Skill, Equipment, Item, Animation, ItemIdentifiers: I, NpcIdentifiers: N, ObjectIdentifiers: O } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");
  const State = require("../ghostsahoy/State.GhostsAhoy");
  const Runedraw = require("../ghostsahoy/Runedraw.GhostsAhoy");
  const Shipwreck = require("../ghostsahoy/Shipwreck.GhostsAhoy");
  const Voyage = require("../ghostsahoy/Voyage.GhostsAhoy");
  const Tomb = require("../ghostsahoy/Tomb.GhostsAhoy");

  const PAGE = "Ghosts Ahoy";
  const NPC = Object.freeze({
    VELORINA: N.VELORINA,
    NECROVARUS: N.NECROVARUS,
    GRAVINGAS: N.GRAVINGAS,
    AK_HARANU: N.AK_HARANU,
    ROBIN: N.ROBIN,
    OLD_CRONE: N.OLD_CRONE,
    OLD_MAN: N.OLD_MAN,
    GHOST_VILLAGER: N.GHOST_VILLAGER,
    GHOST_INNKEEPER: N.GHOST_INNKEEPER,
    GHOST_CAPTAIN: N.GHOST_CAPTAIN,
  });
  const QUEST_NPCS = new Set(Object.values(NPC));

  const STAGE = Object.freeze({
    STARTED: 1,
    PLEADED: 2,
    OLD_CRONE: 3,
    CRONE_HELP: 4,
    CRONE_RITUAL: 5,
    ENCHANTED: 6,
    COMMANDED: 7,
    COMPLETE: 8,
  });
  const VARP_GHOSTS_AHOY = 408;
  const QUESTVAR = 217; // ahoy_questvar

  const ids = Object.freeze({
    AMULET: I.GHOSTSPEAK_AMULET, // 552
    ENCHANTED_AMULET: I.GHOSTSPEAK_AMULET_2, // 4250
    BOOK_OF_HARICANTO: I.BOOK_OF_HARICANTO,
    TRANSLATION_MANUAL: I.TRANSLATION_MANUAL,
    MYSTICAL_ROBES: I.MYSTICAL_ROBES,
    ECTOPHIAL: I.ECTOPHIAL,
    EMPTY_ECTOPHIAL: I.ECTOPHIAL_2,
    MODEL_SHIP: I.MODEL_SHIP, // 4253 ahoy_toy_boat
    REPAIRED_SHIP: I.MODEL_SHIP_2, // 4254 ahoy_toy_boat_repaired
    BONE_KEY: I.BONE_KEY_2, // 4272
    CHEST_KEY: I.CHEST_KEY_4, // 4273
    MAP_SCRAP: I.MAP_SCRAP, // 4274 (the office chest)
    MAP_SCRAP_2: I.MAP_SCRAP_2, // 4275 (the lobster's chest)
    MAP_SCRAP_3: I.MAP_SCRAP_3, // 4276 (the rocky island)
    TREASURE_MAP: I.TREASURE_MAP, // 4277
    ECTO_TOKEN: I.ECTO_TOKEN,
    PETITION_FORM: I.PETITION_FORM,
    BEDSHEET: I.BEDSHEET,
    GREEN_BEDSHEET: I.BEDSHEET_2,
    ASHES: I.ASHES,
    OAK_LONGBOW: I.OAK_LONGBOW,
    SIGNED_BOW: I.SIGNED_OAK_BOW,
    SILK: I.SILK,
    NEEDLE: I.NEEDLE,
    THREAD: I.THREAD,
    KNIFE: I.KNIFE,
    SPADE: I.SPADE,
    COINS: I.COINS,
    NETTLES: I.NETTLES,
    BOWL: I.BOWL,
    BOWL_OF_WATER: I.BOWL_OF_WATER,
    NETTLE_WATER: I.NETTLE_WATER, // 4237
    BOWL_TEA: I.NETTLE_TEA, // 4239 bowl_nettletea
    BOWL_TEA_MILKY: I.NETTLE_TEA_2, // 4240
    CUP_TEA: I.CUP_OF_TEA_4, // 4242 an ordinary cup of nettle tea
    CUP_TEA_MILKY: I.CUP_OF_TEA_5, // 4243
    SPECIAL_CUP: I.PORCELAIN_CUP, // 4244 chinacup_empty
    SPECIAL_CUP_TEA: I.CUP_OF_TEA_6, // 4245 chinacup_of_nettletea
    SPECIAL_CUP_TEA_MILKY: I.CUP_OF_TEA_7, // 4246 chinacup_of_nettletea_milky
    BUCKET: I.BUCKET,
    BUCKET_OF_MILK: I.BUCKET_OF_MILK,
    GIANT_LOBSTER: N.GIANT_LOBSTER,
    GHOST_DISCIPLE: N.GHOST_DISCIPLE,
    CHEST_CLOSED: O.CLOSED_CHEST_29, // 16118 ahoy_chest_closed
    CHEST_OPEN: O.OPEN_CHEST_25, // 16119 ahoy_chest_open
    LOCKED_CHEST: O.CLOSED_CHEST_28, // 16116 ahoy_chest_locked
    LOCKED_CHEST_ACTIVE: O.OPEN_CHEST_24, // 16117 ahoy_chest_locked_active
    COFFIN: O.COFFIN_14, // 16644 ahoy_coffin
    COFFIN_OPEN: O.COFFIN_15, // 16645 ahoy_coffin_open
    TOMB_DOOR: O.DOOR_144, // 5244 ahoy_harbour_door
    MAST: O.MAST_6, // 16640 ahoy_mast
    ROCK: 16115, // ahoy_rock_invisible: ObjectIdentifiers names it ROCKS_*, one of many
    GANGPLANKS: [O.GANGPLANK_28, O.GANGPLANK_29], // 16651, 16652
  });

  const START_HOOK = "quest:ghosts-ahoy:start";
  /** The last Runedraw game while at Robin's: drives his opening line (not saved). */
  const RUNEDRAW_LAST_ATTRIBUTE = "ghosts-ahoy:runedraw-last";
  /** A paid game waiting for its board (not saved). */
  const RUNEDRAW_PAID_ATTRIBUTE = "ghosts-ahoy:runedraw-paid";
  /** Wins while Robin's debt isn't the bow's (before Ak-Haranu's errand, not saved). */
  const RUNEDRAW_WINS_ATTRIBUTE = "ghosts-ahoy:runedraw-wins";
  const RUNEDRAW_FEE = 25;

  /** Ghost villagers each player has asked, by NPC (live: "You only just asked me the same thing!"). */
  const asked = new WeakMap();

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const wearing = (player, slot, itemId) => player.getEquipment().get(slot)?.getId?.() === itemId;
  const wearingAmulet = (player) =>
    wearing(player, Equipment.AMULET_SLOT, ids.AMULET) || wearing(player, Equipment.AMULET_SLOT, ids.ENCHANTED_AMULET);
  const carryingAmulet = (player) => held(player, ids.AMULET) || held(player, ids.ENCHANTED_AMULET);
  const headSlot = (player) => player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() ?? -1;
  const stage = (player) => quest.getStage(player);

  function questComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function setStage(player, value) {
    if (stage(player) < value) quest.setStage(player, value);
  }

  function variantSteps(variant) {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[variant];
    return Array.isArray(steps) ? steps : [];
  }

  /** The node with `id` anywhere in a variant (options and conditions included). */
  function findNode(steps, id) {
    for (const step of steps ?? []) {
      if (step?.id === id) return step;
      const inner = findNode(step?.steps, id) ?? (step?.options ?? []).map((option) => findNode(option.steps, id)).find(Boolean);
      if (inner) return inner;
    }
    return null;
  }

  // ==========================================================================
  // Boxes outside a conversation
  // ==========================================================================

  /** An item box (objectbox 193) or message box (messagebox 229); `after` runs on its continue. */
  const box = {
    item(player, itemId, text, after) {
      openBox(player, new api.core.ItemStatementDialogue(0, itemId, text), after);
    },
    statement(player, text, after) {
      openBox(player, new api.core.StatementDialogue(0, text), after);
    },
  };

  function openBox(player, dialogue, after) {
    const { DialogueChainBuilder, ActionDialogue } = api.core;
    const chain = new DialogueChainBuilder().add(dialogue);
    if (typeof after === "function") {
      chain.add(new ActionDialogue(1, {
        execute: () => {
          player.getPacketSender().sendInterfaceRemoval();
          after();
        },
      }));
    }
    player.getDialogueManager().startDialogues(chain);
  }

  // ==========================================================================
  // The journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const now = questHandle.getStage(player);
    if (now <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Velorina</col> in",
        "<col=800000>Port Phasmatys</col>, east of Varrock through the Haunted Woods.",
        "",
        "I must have completed <col=800000>Priest in Peril</col> and",
        "<col=800000>The Restless Ghost</col>.",
        "I need at least level 25 Agility and level 20 Cooking.",
        "I must also be able to defeat a level 32 monster.",
      ];
    }
    const lines = [
      "<str>Velorina told me the sad history of the ghosts of Port Phasmatys.</str>",
      "<str>She asked me to plead with Necrovarus to let any ghost who wishes pass over.</str>",
      "",
    ];
    if (now === STAGE.STARTED) lines.push("I should speak to <col=800000>Necrovarus</col> in the Temple of Phasmatys.");
    if (now >= STAGE.PLEADED) lines.push("<str>I pleaded with Necrovarus, to no avail.</str>");
    if (now === STAGE.PLEADED) lines.push("", "I should tell <col=800000>Velorina</col> that Necrovarus will not listen.");
    if (now >= STAGE.OLD_CRONE) lines.push("<str>Velorina spoke of an old woman who fled Port Phasmatys before its fall.</str>");
    if (now === STAGE.OLD_CRONE) {
      lines.push("", "I should find the <col=800000>old crone</col> in her shack.");
      if (State.get(player, State.VARBIT.NETTLE_TEA) >= 1) {
        lines.push("She would like a cup of <col=800000>nettle tea</col>, with milk, in her special cup.");
      }
    }
    if (now >= STAGE.CRONE_HELP) lines.push("<str>The old crone will enchant my ghostspeak amulet.</str>");
    if (now === STAGE.CRONE_HELP) {
      const mark = (varbit, itemId, label) =>
        State.get(player, varbit) === 1 || held(player, itemId) ? `<str>${label}</str>` : label;
      lines.push(
        "",
        "I need to bring the <col=800000>old crone</col>:",
        mark(State.VARBIT.GIVEN_BOOK, ids.BOOK_OF_HARICANTO, "The Book of Haricanto"),
        mark(State.VARBIT.GIVEN_ROBES, ids.MYSTICAL_ROBES, "The Robes of Necrovarus"),
        mark(State.VARBIT.GIVEN_MANUAL, ids.TRANSLATION_MANUAL, "Something to translate the Book of Haricanto"),
      );
      const toy = State.get(player, State.VARBIT.TOY_BOAT);
      if (toy >= 2) lines.push("", "<str>I gave the old crone's toy boat to her son on the shipwreck.</str>");
      else if (toy === 1) {
        lines.push("", "The <col=800000>old crone</col> gave me a <col=800000>toy boat</col> to pass on to her son. It is a model of the ship he sailed away on.");
      }
      const bow = State.get(player, State.VARBIT.BOW);
      if (bow >= 8) lines.push("", "<str>Ak-Haranu traded me a translation manual for a signed oak longbow.</str>");
      else if (bow >= 1) {
        lines.push("", "I agreed to bring <col=800000>Ak-Haranu</col> an oak longbow signed by <col=800000>Robin</col>, the Master Bowman staying at the Port Phasmatys inn.");
      }
      const counter = State.get(player, State.VARBIT.SIGNATURES);
      if (counter === State.SIGNATURES_BURNED) lines.push("", "<str>Necrovarus burned Gravingas's petition to ashes.</str>");
      else if (counter >= State.SIGNATURES_FORM) {
        lines.push("", `<col=800000>Gravingas</col> asked me to collect 10 signatures for his petition. I have ${counter - State.SIGNATURES_FORM} so far.`);
      }
    }
    if (now >= STAGE.CRONE_RITUAL) lines.push("<str>I brought the old crone the book, robes and translation manual.</str>");
    if (now >= STAGE.ENCHANTED) lines.push("<str>The old crone enchanted my ghostspeak amulet.</str>");
    if (now === STAGE.ENCHANTED) {
      lines.push("", "I need to use the <col=800000>enchanted amulet</col> to command <col=800000>Necrovarus</col> in the Temple.");
    }
    if (now >= STAGE.COMMANDED) lines.push("<str>I commanded Necrovarus to let the ghosts pass on.</str>");
    if (now === STAGE.COMMANDED) lines.push("", "I should tell <col=800000>Velorina</col> the news.");
    if (now >= STAGE.COMPLETE) {
      lines.push("", "<str>Velorina gave me the Ectophial as thanks, and the ghosts of Port Phasmatys are free.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>");
    }
    return lines;
  }

  // ==========================================================================
  // Which conversation plays
  // ==========================================================================

  const materialsHeld = (player) => held(player, ids.MYSTICAL_ROBES) || held(player, ids.BOOK_OF_HARICANTO) || held(player, ids.TRANSLATION_MANUAL);
  const allGiven = (player) => [State.VARBIT.GIVEN_ROBES, State.VARBIT.GIVEN_BOOK, State.VARBIT.GIVEN_MANUAL]
    .every((varbit) => State.get(player, varbit) === 1);
  const signatures = (player) => State.get(player, State.VARBIT.SIGNATURES);
  const burned = (player) => signatures(player) === State.SIGNATURES_BURNED;
  const petitionInPlay = (player) => !burned(player) && signatures(player) >= State.SIGNATURES_FORM;

  function selectVariant({ npcId, player }) {
    const now = stage(player);
    if (npcId === NPC.VELORINA) {
      if (now <= 0) return "starting-off-talking-to-velorina";
      if (now === STAGE.STARTED) return "starting-off-talking-to-velorina-again";
      if (now === STAGE.PLEADED) return "returning-to-velorina-after-talking-to-necrovarus";
      if (now === STAGE.OLD_CRONE) return "returning-to-velorina-after-talking-to-necrovarus-talking-to-velorina-again";
      if (now === STAGE.CRONE_HELP) return "talking-to-velorina-after-talking-to-the-old-crone";
      if (now <= STAGE.ENCHANTED) return "talking-to-velorina";
      if (now === STAGE.COMMANDED) return "talking-to-velorina-2";
      return "post-quest-dialogue-velorina";
    }
    if (npcId === NPC.NECROVARUS) {
      if (now <= 0) return null;
      if (now === STAGE.STARTED) return "talking-to-necrovarus";
      if (now <= STAGE.OLD_CRONE) return "talking-to-necrovarus-talking-to-necrovarus-again";
      if (now <= STAGE.CRONE_RITUAL) {
        // Ours: before the form exists the "changed your mind" talk plays, as it does after the burning.
        return held(player, ids.PETITION_FORM) && petitionInPlay(player)
          ? "robes-of-necrovarus-talking-to-necrovarus-whilst-collecting-signatures"
          : "robes-of-necrovarus-talking-to-necrovarus-whilst-collecting-signatures-subsequent-dialogue-with-necrovarus";
      }
      if (now === STAGE.ENCHANTED) return "commanding-necrovarus-to-stand-down";
      return "commanding-necrovarus-to-stand-down-talking-to-necrovarus-after-freeing-port-phasmatys";
    }
    if (npcId === NPC.GRAVINGAS) {
      if (now >= STAGE.COMPLETE) return "post-quest-dialogue-gravingas";
      if (now < STAGE.CRONE_HELP) return "robes-of-necrovarus-talking-to-gravingas";
      return signatures(player) >= State.SIGNATURES_FORM
        ? "robes-of-necrovarus-talking-to-gravingas-talking-to-gravingas-again"
        : "robes-of-necrovarus-talking-to-gravingas";
    }
    if (npcId === NPC.AK_HARANU) {
      const bow = State.get(player, State.VARBIT.BOW);
      if (bow >= 8) return "something-to-translate-the-book-of-haricanto-talking-to-ak-haranu-after-getting-the-bow-signed-subsequent-dialogue-with-ak-haranu";
      if (bow === 7 && held(player, ids.SIGNED_BOW)) return "something-to-translate-the-book-of-haricanto-talking-to-ak-haranu-after-getting-the-bow-signed";
      if (bow >= 1) return "something-to-translate-the-book-of-haricanto-talking-to-ak-haranu-subsequent-dialogue-with-ak-haranu";
      return "something-to-translate-the-book-of-haricanto-talking-to-ak-haranu";
    }
    if (npcId === NPC.ROBIN) {
      const bow = State.get(player, State.VARBIT.BOW);
      if (bow >= 7) return "something-to-translate-the-book-of-haricanto-talking-to-robin-talking-to-robin-after-getting-the-bow-signed";
      if (bow === 0 && held(player, ids.BEDSHEET)) return "robes-of-necrovarus-talking-to-the-ghost-innkeeper-talking-to-robin-with-the-innkeeper-s-task";
      return "something-to-translate-the-book-of-haricanto-talking-to-robin";
    }
    if (npcId === NPC.OLD_MAN) {
      const toy = State.get(player, State.VARBIT.TOY_BOAT);
      if (toy >= 3 || (toy === 2 && held(player, ids.CHEST_KEY))) return "book-of-haricanto-at-the-shipwrecked-boat-talking-to-the-old-man-again";
      if (toy === 2) return "book-of-haricanto-at-the-shipwrecked-boat-talking-to-the-old-man-after-losing-the-key";
      if (toy === 1 && !held(player, ids.MODEL_SHIP) && !held(player, ids.REPAIRED_SHIP)) {
        return "book-of-haricanto-at-the-shipwrecked-boat-talking-to-the-old-man-again";
      }
      return "book-of-haricanto-at-the-shipwrecked-boat-talking-to-the-old-man";
    }
    if (npcId === NPC.OLD_CRONE) {
      // Talk-to plays her composed talk (talkToCrone); this is the section it starts from.
      if (now < STAGE.OLD_CRONE) return null;
      if (now === STAGE.OLD_CRONE) return "talking-to-the-old-crone";
      if (now <= STAGE.CRONE_RITUAL) {
        return materialsHeld(player) || now === STAGE.CRONE_RITUAL
          ? "talking-to-the-old-crone-with-the-materials" : "talking-to-the-old-crone-talking-to-the-old-crone-again";
      }
      if (now <= STAGE.COMMANDED) return "talking-to-the-old-crone-with-the-materials-talking-to-the-old-crone-again";
      return "post-quest-dialogue-old-crone";
    }
    if (npcId === NPC.GHOST_INNKEEPER) return "robes-of-necrovarus-talking-to-the-ghost-innkeeper";
    if (npcId === NPC.GHOST_CAPTAIN) return "book-of-haricanto-travelling-to-dragontooth-island-talking-to-the-ghost-captain";
    if (npcId === NPC.GHOST_VILLAGER) {
      return now >= STAGE.CRONE_HELP && petitionInPlay(player) && held(player, ids.PETITION_FORM)
        ? "robes-of-necrovarus-talking-to-the-ghost-villagers" : null;
    }
    return null;
  }

  // ==========================================================================
  // Conditions
  // ==========================================================================

  function teaKinds(player) {
    return {
      plain: held(player, ids.BOWL_TEA) || held(player, ids.BOWL_TEA_MILKY) || held(player, ids.CUP_TEA) || held(player, ids.CUP_TEA_MILKY),
      special: held(player, ids.SPECIAL_CUP_TEA),
      specialMilky: held(player, ids.SPECIAL_CUP_TEA_MILKY),
    };
  }

  /** Answers by step id where the condition is the quest's own; by its prose otherwise. */
  const CONDITIONS = {
    // The crone's tea (capture ticks 361-409).
    LJQs8Z: (p) => { const t = teaKinds(p); return t.plain && !t.special && !t.specialMilky; },
    m3zVcU: (p) => { const t = teaKinds(p); return !t.plain && !t.special && !t.specialMilky; },
    izojwO: (p) => teaKinds(p).special && !teaKinds(p).specialMilky,
    pnTKEw: (p) => teaKinds(p).specialMilky,
    // Do you have such a thing as a ghostspeak amulet? (448)
    WLPenj: (p) => !wearingAmulet(p) && !carryingAmulet(p),
    Oq41_U: (p) => !wearingAmulet(p) && carryingAmulet(p),
    hspLEg: (p) => wearingAmulet(p),
    // The crone with the materials (1798-1808).
    pz4L0V: (p) => held(p, ids.BOOK_OF_HARICANTO),
    FpgXvG: (p) => held(p, ids.TRANSLATION_MANUAL),
    LvSGlR: (p) => held(p, ids.MYSTICAL_ROBES),
    BUgbCE: (p) => allGiven(p),
    LZkUu_: (p) => !wearingAmulet(p) && !carryingAmulet(p),
    qxt2p9: (p) => wearingAmulet(p) || carryingAmulet(p),
    "1-nLMH": (p) => wearing(p, Equipment.AMULET_SLOT, ids.ENCHANTED_AMULET) || held(p, ids.ENCHANTED_AMULET),
    aOB6qY: (p) => !wearing(p, Equipment.AMULET_SLOT, ids.ENCHANTED_AMULET) && !held(p, ids.ENCHANTED_AMULET),
    // The old man and the toy boat (770-821).
    Ns_r6y: (p) => held(p, ids.MODEL_SHIP) && !held(p, ids.REPAIRED_SHIP),
    ZNVZ1X: (p) => held(p, ids.REPAIRED_SHIP) && !Shipwreck.toyMatchesMast(p),
    fMzkSt: (p) => held(p, ids.REPAIRED_SHIP) && Shipwreck.toyMatchesMast(p),
    // Ak-Haranu (1186-1458).
    wPTjUJ: (p) => !held(p, ids.OAK_LONGBOW),
    fBLsOc: (p) => held(p, ids.OAK_LONGBOW),
    H92qZ0: (p) => !held(p, ids.TRANSLATION_MANUAL) && State.get(p, State.VARBIT.GIVEN_MANUAL) !== 1,
    "1inJJ2": (p) => held(p, ids.TRANSLATION_MANUAL) || State.get(p, State.VARBIT.GIVEN_MANUAL) === 1,
    // Robin (1226-1415).
    lyGghs: (p) => held(p, ids.OAK_LONGBOW),
    AZZDOx: (p) => !held(p, ids.OAK_LONGBOW),
    "4sGI8H": (p) => !held(p, ids.COINS, RUNEDRAW_FEE),
    "4W6TSD": (p) => held(p, ids.COINS, RUNEDRAW_FEE),
    QFKJLK: (p) => held(p, ids.BEDSHEET),
    wBcIe9: (p) => !held(p, ids.BEDSHEET),
    // The innkeeper's job.
    FJVPOs: (p) => !held(p, ids.BEDSHEET) && !held(p, ids.GREEN_BEDSHEET),
    syVS4F: (p) => held(p, ids.BEDSHEET) || held(p, ids.GREEN_BEDSHEET),
    // Gravingas.
    ezNdTY: (p) => freeSlots(p) < 1,
    SjVP8K: (p) => freeSlots(p) >= 1,
    "aQB-v4": (p) => petitionInPlay(p) && !held(p, ids.PETITION_FORM),
    bMP4Y2: (p) => freeSlots(p) < 1,
    "9RQHuZ": (p) => freeSlots(p) >= 1,
    LkehEl: (p) => signatures(p) === State.SIGNATURES_FORM,
    // Ours: the transcript has no line for 2-3 signatures; "one signature" covers 1-3.
    nO4ryS: (p) => signatures(p) >= State.SIGNATURES_FORM + 1 && signatures(p) <= State.SIGNATURES_FORM + 3,
    "W_Hm-B": (p) => signatures(p) >= State.SIGNATURES_FORM + 4 && signatures(p) <= State.SIGNATURES_FORM + 6,
    "kT-hiM": (p) => signatures(p) >= State.SIGNATURES_FORM + 7 && signatures(p) <= State.SIGNATURES_FORM + 8,
    TGmN9X: (p) => signatures(p) === State.SIGNATURES_FORM + 9,
    Kpy_64: (p) => signatures(p) >= State.SIGNATURES_FULL && !burned(p),
    // Necrovarus.
    ciiO1S: (p) => held(p, ids.PETITION_FORM) && signatures(p) < State.SIGNATURES_FULL,
    "6RNM4P": (p) => held(p, ids.PETITION_FORM) && signatures(p) >= State.SIGNATURES_FULL,
    kwHrsW: (p) => !held(p, ids.BONE_KEY),
    RewmFS: (p) => held(p, ids.BONE_KEY),
    "-UccxJ": (p) => !wearing(p, Equipment.AMULET_SLOT, ids.ENCHANTED_AMULET),
    VguG1C: (p) => wearing(p, Equipment.AMULET_SLOT, ids.ENCHANTED_AMULET),
  };

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function" ? inventory.getFreeSlots() : inventory.isFull() ? 0 : 28;
  }

  function answerCondition({ npcId, player, text, stepId }) {
    if (!QUEST_NPCS.has(npcId) && npcId !== ids.GHOST_DISCIPLE) return null;
    if (stepId && Object.hasOwn(CONDITIONS, stepId)) return CONDITIONS[stepId](player) === true;
    const value = String(text ?? "").toLowerCase();
    // Ghosts are understood through a worn ghostspeak amulet.
    if (value.includes("ghostspeak")) {
      if (value.includes("not wearing") || value.includes("does not have") || value.includes("doesn't have") || value.includes("without")) {
        return !wearingAmulet(player);
      }
      if (value.includes("enchanted")) return wearing(player, Equipment.AMULET_SLOT, ids.ENCHANTED_AMULET);
      return wearingAmulet(player);
    }
    if (npcId === NPC.GHOST_VILLAGER) {
      const head = headSlot(player);
      if (value.includes("not wearing a slimy bedsheet")) return head !== ids.GREEN_BEDSHEET && head !== ids.BEDSHEET;
      if (value.includes("wearing a bedsheet but not slime")) return head === ids.BEDSHEET;
      if (value.includes("wearing a slime covered bedsheet")) return head === ids.GREEN_BEDSHEET;
      if (value.includes("not have enough ecto-tokens")) return !held(player, ids.ECTO_TOKEN, VILLAGER_BRIBE);
      if (value.includes("has at least")) return held(player, ids.ECTO_TOKEN, VILLAGER_BRIBE);
    }
    if (npcId === NPC.GHOST_CAPTAIN) {
      if (value.includes("500 ectotokens")) return value.includes("does not have") ? !held(player, ids.ECTO_TOKEN, 500) : held(player, ids.ECTO_TOKEN, 500);
      if (value.includes("at least 25 ectotokens")) return Voyage.canAfford(player);
    }
    return null;
  }

  /** Live asked for 2 Ectotokens all three times (ticks 1528, 1556, 1578) and took 2. */
  const VILLAGER_BRIBE = 2;

  // ==========================================================================
  // Starting
  // ==========================================================================

  const REQUIRED_QUESTS = [
    { key: "priest_in_peril", name: "Priest in Peril" },
    { key: "the_restless_ghost", name: "The Restless Ghost" },
  ];

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (npcId !== NPC.VELORINA || hook !== START_HOOK || stage(player) > 0) return;
    const missing = REQUIRED_QUESTS.filter(({ key }) => !questComplete(player, key));
    if (missing.length) {
      for (const requirement of missing) player.sendMessage(`You must complete ${requirement.name} to start this quest.`);
      event.end = true;
      return;
    }
    quest.setStage(player, STAGE.STARTED);
  }

  // ==========================================================================
  // Lines: the quest moves on the page live does
  // ==========================================================================

  const LINE = Object.freeze({
    NECROVARUS_REFUSES: "Get out of my sight!! Or I promise you that you will regret your insolence for the rest of eternity!!!",
    VELORINA_FLED: "She fled before the Ectofuntus took control over us,",
    CRONE_WANTS_TEA: "Yes, I would love a nice hot cup of nettle tea.",
    MILKY_TEA: "Here's a lovely cup of milky tea for you, in your own special cup.",
    EVERYTHING: "Wonderful; that's everything I need.",
    INNKEEPER_THANKS: "Oh, thank you. Be careful with that Robin, though",
    CAPTAIN_SAYS_YES: "The Captain says yes.",
    YES_GAME: "Yes, I'll give you a game.",
    REMEMBER: "Remember that once the Ectophial has been used you need to refill it from the Ectofuntus.",
    ASK_SIGNATURE: "Would you sign this petition form, please?",
    ONLY_JUST_ASKED: "You only just asked me the same thing!",
  });

  const before = (request, fn) => {
    const previous = request.before;
    request.before = () => {
      previous?.();
      fn();
    };
  };

  function handleLine(request) {
    const { npcId, player } = request;
    if (!QUEST_NPCS.has(npcId)) return;
    const text = String(request.text ?? "");
    if (npcId === NPC.NECROVARUS && text === LINE.NECROVARUS_REFUSES) {
      before(request, () => setStage(player, STAGE.PLEADED));
    } else if (npcId === NPC.VELORINA && text.startsWith(LINE.VELORINA_FLED)) {
      before(request, () => {
        if (stage(player) === STAGE.PLEADED) setStage(player, STAGE.OLD_CRONE);
      });
    } else if (npcId === NPC.VELORINA && text === LINE.REMEMBER && stage(player) === STAGE.COMMANDED) {
      // The quest completes as this page shows (tick 1973): varbit 8, the Ectophial, the scroll.
      before(request, () => quest.complete(player));
    } else if (npcId === NPC.OLD_CRONE && text === LINE.CRONE_WANTS_TEA) {
      before(request, () => {
        if (stage(player) === STAGE.OLD_CRONE && State.get(player, State.VARBIT.NETTLE_TEA) < 1) State.set(player, State.VARBIT.NETTLE_TEA, 1);
      });
    } else if (npcId === NPC.OLD_CRONE && text === LINE.MILKY_TEA) {
      before(request, () => drinkTea(player));
    } else if (npcId === NPC.OLD_CRONE && text === LINE.EVERYTHING) {
      before(request, () => {
        if (stage(player) === STAGE.CRONE_HELP) setStage(player, STAGE.CRONE_RITUAL);
      });
    } else if (npcId === NPC.GHOST_INNKEEPER && text.startsWith(LINE.INNKEEPER_THANKS)) {
      before(request, () => {
        if (!held(player, ids.BEDSHEET) && !held(player, ids.GREEN_BEDSHEET)) player.getInventory().adds(ids.BEDSHEET, 1);
      });
    } else if (npcId === NPC.OLD_MAN && text === LINE.CAPTAIN_SAYS_YES) {
      before(request, () => giveChestKey(player));
    } else if (npcId === NPC.ROBIN && text === LINE.YES_GAME) {
      before(request, () => payForGame(player));
    } else if (npcId === NPC.GHOST_VILLAGER) {
      villagerLine(request, text);
    }
    fillBlanks(request, text);
  }

  /** The tea is drunk as the player offers it (tick 409): the cup goes, the crone helps. */
  function drinkTea(player) {
    if (stage(player) !== STAGE.OLD_CRONE || !held(player, ids.SPECIAL_CUP_TEA_MILKY)) return;
    player.getInventory().deleteNumber(ids.SPECIAL_CUP_TEA_MILKY, 1);
    State.set(player, State.VARBIT.NETTLE_TEA, 3);
    setStage(player, STAGE.CRONE_HELP);
  }

  /** "The Captain says yes." (tick 819): the boat changes hands for the key, in its slot. */
  function giveChestKey(player) {
    if (State.get(player, State.VARBIT.TOY_BOAT) !== 1 || !held(player, ids.REPAIRED_SHIP)) return;
    const inventory = player.getInventory();
    const slot = inventory.getSlot?.(ids.REPAIRED_SHIP) ?? -1;
    if (slot >= 0 && typeof inventory.setItem === "function") {
      inventory.setItem(slot, new Item(ids.CHEST_KEY, 1));
      inventory.refreshItems?.();
    } else {
      inventory.deleteNumber(ids.REPAIRED_SHIP, 1);
      inventory.adds(ids.CHEST_KEY, 1);
    }
    State.set(player, State.VARBIT.TOY_BOAT, 2);
  }

  /** The [#] / [1-3] blanks the transcript leaves. */
  function fillBlanks(request, text) {
    const { npcId, player } = request;
    if (!text.includes("[")) return;
    if (npcId === NPC.ROBIN) request.text = text.replace("[#]", String(robinDebt(player)));
    else if (npcId === NPC.GRAVINGAS) {
      request.text = text.replace("[#]", String(Math.max(0, State.SIGNATURES_FULL - signatures(player))));
    } else if (npcId === NPC.GHOST_VILLAGER) request.text = text.replace("[1-3]", String(VILLAGER_BRIBE));
  }

  function villagerLine(request, text) {
    const { player } = request;
    const npc = request.npc;
    if (!npc || typeof request.step?.speaker !== "string" || text.startsWith(LINE.ONLY_JUST_ASKED)) return;
    // Every answer counts as having asked that ghost (Transcript: "regardless if they support or deny").
    let seen = asked.get(player);
    if (!seen) asked.set(player, (seen = new WeakSet()));
    seen.add(npc);
  }

  // ==========================================================================
  // Message steps: boxes, hand-outs and hand-ins
  // ==========================================================================

  const MESSAGE_BOXES = {
    // The crone (365, 411, 459).
    fb8Gb1: (e) => {
      e.box = { items: [ids.SPECIAL_CUP] };
      if (!held(e.player, ids.SPECIAL_CUP)) e.player.getInventory().adds(ids.SPECIAL_CUP, 1);
      if (State.get(e.player, State.VARBIT.NETTLE_TEA) < 2) State.set(e.player, State.VARBIT.NETTLE_TEA, 2);
    },
    oaDebF: (e) => { e.box = { statement: true }; },
    "8jENtX": (e) => {
      // Live shows the repaired boat's model on the box (tick 459).
      e.box = { items: [ids.REPAIRED_SHIP] };
      if (State.get(e.player, State.VARBIT.TOY_BOAT) < 1) {
        State.set(e.player, State.VARBIT.TOY_BOAT, 1);
        Shipwreck.mastFlag(e.player);
        if (!held(e.player, ids.MODEL_SHIP) && !held(e.player, ids.REPAIRED_SHIP)) e.player.getInventory().adds(ids.MODEL_SHIP, 1);
      }
    },
    // The ritual (1805-1808): the chat closes, the crone dances, the amulet glows three ticks later.
    DseMBm: (e) => {
      e.end = true;
      performRitual(e.player, e.npc);
    },
    // The old man (773, 799, 818, 820, s7MA3K after losing the key).
    T4JoYu: (e) => { e.box = { items: [ids.REPAIRED_SHIP] }; },
    "Ww-z3J": (e) => { e.box = { statement: true }; },
    TsByRG: (e) => { e.box = { statement: true }; },
    bm0gUS: (e) => { e.box = { items: [ids.CHEST_KEY] }; },
    s7MA3K: (e) => {
      e.box = { items: [ids.CHEST_KEY] };
      if (!held(e.player, ids.CHEST_KEY)) e.player.getInventory().adds(ids.CHEST_KEY, 1);
    },
    // Ak-Haranu (1458, a lost manual).
    sbSrbg: (e) => {
      e.box = { items: [ids.TRANSLATION_MANUAL] };
      tradeBow(e.player);
      e.after = () => e.npc?.performAnimation?.(new Animation(858));
    },
    "2e7k7g": (e) => {
      e.box = { items: [ids.TRANSLATION_MANUAL] };
      if (!held(e.player, ids.TRANSLATION_MANUAL)) e.player.getInventory().adds(ids.TRANSLATION_MANUAL, 1);
    },
    // Robin signs (1414-1415): the box shows with the bow already signed; bow 7 on its continue.
    y4p5hS: (e) => {
      e.box = { items: [ids.SIGNED_BOW] };
      if (held(e.player, ids.OAK_LONGBOW)) {
        e.player.getInventory().deleteNumber(ids.OAK_LONGBOW, 1);
        e.player.getInventory().adds(ids.SIGNED_BOW, 1);
      }
      e.after = () => State.set(e.player, State.VARBIT.BOW, 7);
    },
    // Necrovarus burns the petition and drops the key (1642-1643).
    "0aJAGM": (e) => {
      e.box = { statement: true };
      if (held(e.player, ids.PETITION_FORM)) {
        e.player.getInventory().deleteNumber(ids.PETITION_FORM, 1);
        e.player.getInventory().adds(ids.ASHES, 1);
      }
      State.set(e.player, State.VARBIT.SIGNATURES, State.SIGNATURES_BURNED);
    },
    "wxm-9t": (e) => {
      e.box = { statement: true };
      if (!held(e.player, ids.BONE_KEY)) Tomb.dropBoneKey(e.player);
    },
    // The command (1939-1940): the amulet discharges on the box's continue.
    CHrllM: (e) => {
      e.box = { items: [ids.ENCHANTED_AMULET] };
      e.after = () => commandNecrovarus(e.player);
    },
    ZWuPzZ: (e) => { e.box = { items: [ids.ENCHANTED_AMULET] }; },
    trg18B: (e) => { e.box = { items: [ids.ENCHANTED_AMULET] }; },
    TLt7cU: (e) => { e.box = { items: [ids.ENCHANTED_AMULET] }; },
    rJ6tRy: (e) => { e.box = { items: [ids.ENCHANTED_AMULET] }; },
    // Velorina (1971; a second Ectophial after the quest).
    fZkoWx: (e) => { e.box = { items: [ids.ECTOPHIAL] }; },
    "xK-8eQ": (e) => {
      // quest.complete already said it (the "Remember..." page).
      e.handled = true;
      e.end = true;
    },
    "8-6SLN": (e) => {
      e.box = { items: [ids.EMPTY_ECTOPHIAL] };
      const inventory = e.player.getInventory();
      if (typeof inventory.forceAdd === "function") inventory.forceAdd(e.player, new Item(ids.EMPTY_ECTOPHIAL, 1));
      else inventory.adds(ids.EMPTY_ECTOPHIAL, 1);
    },
    // The villagers' signatures (1533-1609).
    "0rh2a0": (e) => sign(e, false),
    "6iEugl": (e) => sign(e, true),
    // "You cannot understand the ghost." is a message box (Transcript {{tbox}}).
    "26f6qH": (e) => { e.box = { statement: true }; },
    iYWe40: (e) => { e.box = { statement: true }; },
    i6BWpA: (e) => { e.box = { statement: true }; },
    "REAuy-": (e) => { e.box = { statement: true }; },
  };

  /** A signature: the counter goes up; the tenth gets its own box (ticks 1533, 1609). */
  function sign(event, bribed) {
    const { player } = event;
    if (!petitionInPlay(player) || !held(player, ids.PETITION_FORM) || signatures(player) >= State.SIGNATURES_FULL) {
      event.handled = true;
      event.end = true;
      return;
    }
    if (bribed) player.getInventory().deleteNumber(ids.ECTO_TOKEN, VILLAGER_BRIBE);
    const count = signatures(player) + 1;
    State.set(player, State.VARBIT.SIGNATURES, count);
    const obtained = count - State.SIGNATURES_FORM;
    event.box = { items: [ids.PETITION_FORM] };
    event.text = count >= State.SIGNATURES_FULL
      ? findNode(variantSteps("robes-of-necrovarus-talking-to-the-ghost-villagers"), "xKEU0g")?.text ?? event.text
      : String(event.text).replace("[#]", String(obtained)).replace("signature[s]", obtained === 1 ? "signature" : "signatures");
  }

  function tradeBow(player) {
    if (State.get(player, State.VARBIT.BOW) !== 7 || !held(player, ids.SIGNED_BOW)) return;
    player.getInventory().deleteNumber(ids.SIGNED_BOW, 1);
    player.getInventory().adds(ids.TRANSLATION_MANUAL, 1);
    State.set(player, State.VARBIT.BOW, 8);
  }

  function performRitual(player, crone) {
    if (stage(player) !== STAGE.CRONE_RITUAL) return;
    crone?.performAnimation?.(new Animation(818));
    api.core.TaskManager.submit(new api.core.CountdownTask(player, 3, () => {
      if (!player.isRegistered?.() || stage(player) !== STAGE.CRONE_RITUAL) return;
      if (!enchantAmulet(player)) return;
      setStage(player, STAGE.ENCHANTED);
      const text = findNode(variantSteps("talking-to-the-old-crone-with-the-materials"), "DseMBm")?.text
        ?? "The ghostspeak amulet emits a green glow from its gem.";
      box.item(player, ids.ENCHANTED_AMULET, text);
    }));
  }

  function swapAmulet(player, from, to) {
    if (wearing(player, Equipment.AMULET_SLOT, from)) {
      player.getEquipment().setItem(Equipment.AMULET_SLOT, new Item(to, 1));
      player.getEquipment().refreshItems?.();
      player.getUpdateFlag?.()?.flag?.(api.core.Flag?.APPEARANCE);
      return true;
    }
    if (held(player, from)) {
      player.getInventory().deleteNumber(from, 1);
      player.getInventory().adds(to, 1);
      return true;
    }
    return false;
  }

  const enchantAmulet = (player) => swapAmulet(player, ids.AMULET, ids.ENCHANTED_AMULET);

  function commandNecrovarus(player) {
    if (stage(player) !== STAGE.ENCHANTED) return;
    swapAmulet(player, ids.ENCHANTED_AMULET, ids.AMULET);
    setStage(player, STAGE.COMMANDED);
  }

  function handleMessage(event) {
    if (event.kind !== "message" || !QUEST_NPCS.has(event.npcId) && event.npcId !== ids.GHOST_DISCIPLE) return;
    const fn = Object.hasOwn(MESSAGE_BOXES, event.stepId) ? MESSAGE_BOXES[event.stepId] : null;
    if (fn) fn(event);
  }

  // ==========================================================================
  // Actions
  // ==========================================================================

  /** Hand-outs the boxes above already made, and wiki directions with no game effect of their own. */
  const NO_OP_ACTIONS = new Set([
    "YENHyy", "rWYHfe", "zy3bCu", "1p3ORv", "oPe4dE", "3jzsI_", "exeGvc", "t-Azeh", "xqZQgr",
  ]);

  function handleAction(event) {
    if (event.kind === "message") return;
    const { player, stepId } = event;
    if (NO_OP_ACTIONS.has(stepId)) {
      event.handled = true;
      return;
    }
    switch (stepId) {
      case "2zNHiy":
      case "0F6hip":
        // Gravingas's form (tick 1523): counter 1, on the continue after his line.
        if (!held(player, ids.PETITION_FORM)) player.getInventory().adds(ids.PETITION_FORM, 1);
        State.set(player, State.VARBIT.SIGNATURES, State.SIGNATURES_FORM);
        asked.delete(player);
        event.handled = true;
        return;
      case "ELEZLT":
        openRunedraw(event);
        return;
      case "Ct4wPs":
      case "d8PAqv":
        // Talk-to's "Let's go": the same voyage as Travel.
        event.handled = true;
        if (event.npcId !== NPC.GHOST_CAPTAIN) return;
        if (stepId === "d8PAqv" && !Voyage.atDragontooth(player)) {
          if (!held(player, ids.ECTO_TOKEN, 500)) return;
        }
        player.getPacketSender().sendInterfaceRemoval();
        player.getDialogueManager().reset?.();
        Voyage.sail(player);
        return;
      default:
        return;
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (npcId === NPC.AK_HARANU && String(option ?? "").startsWith("Okay, wait here - I'll get you your bow.")) {
      if (State.get(player, State.VARBIT.BOW) < 1) State.set(player, State.VARBIT.BOW, 1);
    } else if (npcId === NPC.OLD_CRONE && String(option ?? "") === "Good news! I have found your son!") {
      player.setAttribute(State.TOLD_CRONE_ATTRIBUTE, 1);
    }
  }

  // ==========================================================================
  // Robin and Runedraw
  // ==========================================================================

  function robinWins(player) {
    const bow = State.get(player, State.VARBIT.BOW);
    if (bow >= 2 && bow <= 6) return bow - 2;
    return Number(player.getAttribute(RUNEDRAW_WINS_ATTRIBUTE)) | 0;
  }

  const robinDebt = (player) => RUNEDRAW_FEE * robinWins(player);

  /** "Yes, I'll give you a game." (tick 1232): 25 coins, and the first game moves the bow on. */
  function payForGame(player) {
    player.setAttribute(RUNEDRAW_PAID_ATTRIBUTE, false);
    if (!held(player, ids.COINS, RUNEDRAW_FEE)) return;
    player.getInventory().deleteNumber(ids.COINS, RUNEDRAW_FEE);
    player.setAttribute(RUNEDRAW_PAID_ATTRIBUTE, true);
    if (State.get(player, State.VARBIT.BOW) === 1) State.set(player, State.VARBIT.BOW, 2);
  }

  const ROBIN_VARIANT = "something-to-translate-the-book-of-haricanto-talking-to-robin";

  function openRunedraw(event) {
    const { player } = event;
    event.handled = true;
    if (player.getAttribute(RUNEDRAW_PAID_ATTRIBUTE) !== true) {
      // A replay offered from Robin's own menu, without the coins: his "not enough money" line.
      event.steps = findNode(variantSteps(ROBIN_VARIANT), "4sGI8H")?.steps ?? [];
      return;
    }
    player.setAttribute(RUNEDRAW_PAID_ATTRIBUTE, false);
    const npc = event.npc;
    // The board replaces the chat on the continue (tick 1233).
    player.getPacketSender().sendInterfaceRemoval();
    player.getDialogueManager().reset?.();
    Runedraw.open(player, {
      finished: (result) => gameFinished(player, result),
      closed: (result) => robinReplies(player, npc, result),
    });
  }

  /** A win moves the bow on as it is won (ticks 1318, 1348, 1381, 1407). */
  function gameFinished(player, result) {
    player.setAttribute(RUNEDRAW_LAST_ATTRIBUTE, result);
    if (result !== Runedraw.RESULT.WON) return;
    const bow = State.get(player, State.VARBIT.BOW);
    if (bow >= 2 && bow < 6) State.set(player, State.VARBIT.BOW, bow + 1);
    else if (bow < 2 || bow > 6) player.setAttribute(RUNEDRAW_WINS_ATTRIBUTE, (Number(player.getAttribute(RUNEDRAW_WINS_ATTRIBUTE)) | 0) + 1);
  }

  /** Robin's reply once the board closes; the result's game message was already sent. */
  function resultSteps(player, result) {
    const steps = variantSteps(ROBIN_VARIANT);
    // The result's own game message was sent as the game ended (tick 1318); the rest plays.
    const results = new Set([Runedraw.WON_MESSAGE, Runedraw.LOST_MESSAGE]);
    const withoutMessage = (node) => (node?.steps ?? []).filter((step) => !(step?.type === "message" && results.has(step.text)));
    if (result === Runedraw.RESULT.WON) {
      const owed = State.get(player, State.VARBIT.BOW) >= 6 && held(player, ids.OAK_LONGBOW);
      return owed ? withoutMessage(findNode(steps, "4gRzlH")) : withoutMessage(findNode(steps, "b8dZzm"));
    }
    return withoutMessage(findNode(steps, robinDebt(player) > 0 ? "DXMtvO" : "PxJuD9"));
  }

  function robinReplies(player, npc, result) {
    if (!player.isRegistered?.()) return;
    startTranscript(api, player, NPC.ROBIN, PAGE, ROBIN_VARIANT, () => resultSteps(player, result), npc);
  }

  /** After a loss, talking to Robin starts with the loss lines again (tick 1274). */
  function talkToRobin(event) {
    const { player } = event;
    if (player.getAttribute(RUNEDRAW_LAST_ATTRIBUTE) !== Runedraw.RESULT.LOST) return false;
    if (State.get(player, State.VARBIT.BOW) >= 7) return false;
    startTranscript(api, player, NPC.ROBIN, PAGE, ROBIN_VARIANT, () => resultSteps(player, Runedraw.RESULT.LOST), event.npc);
    return true;
  }

  // ==========================================================================
  // The Old crone: one talk, as live plays it
  // ==========================================================================

  const CRONE_RECORD = "Old crone";
  const CRONE_BOTH_QUESTS = "standard-dialogue-after-animal-magnetism-and-ghosts-ahoy";

  /** What she says about Ghosts Ahoy now, or null when the transcript's own pick plays. */
  function croneSteps(player) {
    const now = stage(player);
    if (now === STAGE.OLD_CRONE) return variantSteps("talking-to-the-old-crone");
    if (now === STAGE.CRONE_HELP) {
      if (materialsHeld(player)) return handInSteps(player);
      const toy = State.get(player, State.VARBIT.TOY_BOAT);
      if (toy >= 2 && Number(player.getAttribute(State.TOLD_CRONE_ATTRIBUTE)) !== 1) {
        return variantSteps("book-of-haricanto-talking-to-the-old-crone-after-finding-the-old-man");
      }
      if (toy >= 1) return variantSteps("talking-to-the-old-crone-talking-to-the-old-crone-again");
      // Her son's story not heard yet: her menu from the first talk.
      const menu = findNode(variantSteps("talking-to-the-old-crone"), "pnTKEw")?.steps?.find((step) => step?.type === "choice");
      return menu ? [menu] : variantSteps("talking-to-the-old-crone-talking-to-the-old-crone-again");
    }
    if (now === STAGE.CRONE_RITUAL) return findNode(variantSteps("talking-to-the-old-crone-with-the-materials"), "BUgbCE")?.steps ?? [];
    if (now <= STAGE.COMMANDED && now >= STAGE.ENCHANTED) return variantSteps("talking-to-the-old-crone-with-the-materials-talking-to-the-old-crone-again");
    if (now >= STAGE.COMPLETE) return variantSteps("post-quest-dialogue-old-crone");
    return null;
  }

  /**
   * Robes, then book, then manual, after one "I have something for you." (ticks 1801-1804),
   * each handed over as its line shows; then, with all three in, her ritual.
   */
  function handInSteps(player) {
    const steps = variantSteps("talking-to-the-old-crone-with-the-materials");
    const body = (id) => (findNode(steps, id)?.steps ?? []).filter((step) => step?.type !== "jump" && step?.type !== "end");
    const out = [];
    for (const [id, itemId, varbit] of [
      ["LvSGlR", ids.MYSTICAL_ROBES, State.VARBIT.GIVEN_ROBES],
      ["pz4L0V", ids.BOOK_OF_HARICANTO, State.VARBIT.GIVEN_BOOK],
      ["FpgXvG", ids.TRANSLATION_MANUAL, State.VARBIT.GIVEN_MANUAL],
    ]) {
      if (!held(player, itemId) || State.get(player, varbit) === 1) continue;
      const [greeting, ...lines] = body(id);
      const handIn = { itemId, varbit };
      // The first item goes with "I have something for you." (tick 1801), the rest with her lines (1803).
      if (!out.length && greeting) out.push({ ...greeting, handIn }, ...lines);
      else out.push(...lines.map((line) => ({ ...line, handIn })));
    }
    out.push({ type: "condition", id: "BUgbCE", text: findNode(steps, "BUgbCE")?.text, steps: findNode(steps, "BUgbCE")?.steps ?? [] });
    return out;
  }

  /** A hand-in line takes its item as it shows. */
  function handInLine(request) {
    const handIn = request.step?.handIn;
    if (request.npcId !== NPC.OLD_CRONE || !handIn) return;
    before(request, () => {
      const { player } = request;
      if (!held(player, handIn.itemId) || State.get(player, handIn.varbit) === 1) return;
      player.getInventory().deleteNumber(handIn.itemId, 1);
      State.set(player, handIn.varbit, 1);
    });
  }

  /** With Animal Magnetism done she asks which matter first (ticks 346, 354, 390, 470, 1798). */
  function wrapCroneMenu(player, steps) {
    if (!questComplete(player, "animal_magnetism")) return steps;
    const both = loadTranscripts(api)?.[CRONE_RECORD]?.variants?.[CRONE_BOTH_QUESTS];
    const menu = Array.isArray(both) ? both.find((step) => step?.type === "choice") : null;
    if (!menu || stage(player) >= STAGE.COMPLETE) return Array.isArray(both) ? both : steps;
    const [necrovarus, farmers] = menu.options;
    return [{
      ...menu,
      options: [{ ...necrovarus, steps: [necrovarus.steps[0], ...steps] }, farmers],
    }];
  }

  /** Animal Magnetism's crone window (its stages 70-76): she is that quest's then. */
  const ANIMAL_MAGNETISM_CRONE = Object.freeze({ from: 70, to: 76 });

  function animalMagnetismNeedsCrone(player) {
    const request = { player, key: "animal_magnetism", stage: undefined };
    api.emitCustomEvent("quest:get-stage", request);
    const amStage = Number(request.stage) | 0;
    return amStage >= ANIMAL_MAGNETISM_CRONE.from && amStage <= ANIMAL_MAGNETISM_CRONE.to;
  }

  function talkToCrone(event) {
    const { player } = event;
    if (stage(player) < STAGE.OLD_CRONE || animalMagnetismNeedsCrone(player)) return false;
    const steps = croneSteps(player);
    if (!steps?.length) return false;
    startTranscript(api, player, NPC.OLD_CRONE, PAGE, "talking-to-the-old-crone", () => wrapCroneMenu(player, steps), event.npc);
    return true;
  }

  // ==========================================================================
  // The ghost villagers
  // ==========================================================================

  const VILLAGER_VARIANT = "robes-of-necrovarus-talking-to-the-ghost-villagers";

  /** A ghost already asked answers "You only just asked me..." (ticks 1541, 1544, 1570). */
  function talkToVillager(event) {
    const { player, npc } = event;
    if (selectVariant({ npcId: NPC.GHOST_VILLAGER, player }) !== VILLAGER_VARIANT || !wearingAmulet(player)) return false;
    if (headSlot(player) !== ids.GREEN_BEDSHEET) return false;
    const steps = variantSteps(VILLAGER_VARIANT);
    if (signatures(player) >= State.SIGNATURES_FULL) {
      startTranscript(api, player, NPC.GHOST_VILLAGER, PAGE, VILLAGER_VARIANT, () => findNode(steps, "r1mXym")?.steps ?? [], npc);
      return true;
    }
    if (!asked.get(player)?.has(npc)) return false;
    startTranscript(api, player, NPC.GHOST_VILLAGER, PAGE, VILLAGER_VARIANT,
      () => [{ player: LINE.ASK_SIGNATURE }, ...(findNode(steps, "HQkg-C")?.steps ?? [])], npc);
    return true;
  }

  // ==========================================================================
  // Talk-to and Travel
  // ==========================================================================

  function interactionOption(event) {
    const actions = event.definition?.getActions?.() ?? event.definition?.actions ?? [];
    return String(actions[Number(event.clickType) - 1] ?? "").toLowerCase();
  }

  function handleNpcInteraction(event) {
    const option = interactionOption(event);
    const { npcId } = event;
    let claimed = false;
    if (npcId === NPC.GHOST_CAPTAIN && option === "travel") claimed = travel(event);
    else if (option !== "talk-to") return;
    else if (npcId === NPC.OLD_CRONE) claimed = talkToCrone(event);
    else if (npcId === NPC.ROBIN) claimed = talkToRobin(event);
    else if (npcId === NPC.GHOST_VILLAGER) claimed = talkToVillager(event);
    if (claimed) event.handled = true;
  }

  /** Travel (tick 1110): no words; without an amulet the captain only wails. */
  function travel(event) {
    const { player } = event;
    const variant = "book-of-haricanto-travelling-to-dragontooth-island-talking-to-the-ghost-captain";
    if (!wearingAmulet(player)) {
      startTranscript(api, player, NPC.GHOST_CAPTAIN, PAGE, variant,
        (steps) => steps.find((step) => step?.id === "kRoo5q")?.steps ?? [], event.npc);
      return true;
    }
    // Ours: short of the fare, his Talk-to offer plays instead.
    if (!Voyage.sail(player)) startTranscript(api, player, NPC.GHOST_CAPTAIN, PAGE, variant, null, event.npc);
    return true;
  }

  // ==========================================================================
  // Items: the nettle tea, the spade, the map
  // ==========================================================================

  /** The brew, as the capture makes it (ticks 373-383): no message, sound 2401. */
  const POURS = [
    [ids.BOWL_TEA, ids.SPECIAL_CUP, ids.BOWL, ids.SPECIAL_CUP_TEA],
    [ids.BOWL_TEA_MILKY, ids.SPECIAL_CUP, ids.BOWL, ids.SPECIAL_CUP_TEA_MILKY],
    [ids.BUCKET_OF_MILK, ids.SPECIAL_CUP_TEA, ids.BUCKET, ids.SPECIAL_CUP_TEA_MILKY],
    [ids.BUCKET_OF_MILK, ids.BOWL_TEA, ids.BUCKET, ids.BOWL_TEA_MILKY],
  ];
  const LIQUID_SOUND = 2401;

  function handleItemOnItem(event) {
    const { player } = event;
    const a = event.usedItemId;
    const b = event.usedWithItemId;
    const pair = new Set([a, b]);
    if (pair.has(ids.NETTLES) && pair.has(ids.BOWL_OF_WATER)) {
      player.getInventory().deleteNumber(ids.NETTLES, 1);
      player.getInventory().deleteNumber(ids.BOWL_OF_WATER, 1);
      player.getInventory().adds(ids.NETTLE_WATER, 1);
      player.sendMessage("You place the nettles into the bowl of water.");
      event.handled = true;
      return;
    }
    const pour = POURS.find(([from, into]) => pair.has(from) && pair.has(into) && from !== into);
    if (pour) {
      const [from, into, emptied, made] = pour;
      const inventory = player.getInventory();
      inventory.deleteNumber(from, 1);
      inventory.deleteNumber(into, 1);
      inventory.adds(emptied, 1);
      inventory.adds(made, 1);
      api.core.Sounds.sendSound(player, new api.core.Sound(LIQUID_SOUND, 1, 0, 0));
      event.handled = true;
      return;
    }
    // The bedsheet in the ectoplasm (tick 1498): spam line, the empty bucket back.
    if (pair.has(ids.BEDSHEET) && pair.has(I.BUCKET_OF_SLIME)) {
      const inventory = player.getInventory();
      inventory.deleteNumber(ids.BEDSHEET, 1);
      inventory.deleteNumber(I.BUCKET_OF_SLIME, 1);
      inventory.adds(ids.GREEN_BEDSHEET, 1);
      inventory.adds(ids.BUCKET, 1);
      player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, "You dip the bedsheet in the bucket of ectoplasm.");
      event.handled = true;
      return;
    }
    if (pair.has(ids.BEDSHEET) && (pair.has(ids.BUCKET_OF_MILK) || pair.has(I.BUCKET_OF_WATER))) {
      player.sendMessage("Nothing interesting happens.");
      event.handled = true;
      return;
    }
    Shipwreck.combineScraps(event);
    if (!event.handled) Shipwreck.useOnToyBoat(event);
  }

  /** Nettle-water on a range or fire (Transcript: "You boil the water and make nettle tea.", 52 XP). */
  function boilNettleWater(event) {
    const { player, itemId } = event;
    if (itemId !== ids.NETTLE_WATER) return;
    const definition = event.object?.getDefinition?.();
    const name = definition?.getName?.() ?? "";
    const cooks = ["Cooking range", "Range", "Stove", "Fire", "Forester's Campfire"].includes(name)
      || (definition?.getInteractions?.() ?? []).includes("Cook");
    if (!cooks) return;
    event.handled = true;
    if (player.getSkillManager().getCurrentLevel(Skill.COOKING) < 20) {
      player.sendMessage("You need a Cooking level of at least 20 to cook this.");
      return;
    }
    player.getInventory().deleteNumber(ids.NETTLE_WATER, 1);
    player.getInventory().adds(ids.BOWL_TEA, 1);
    player.getSkillManager().addExperiences(Skill.COOKING, 52);
    player.sendMessage("You boil the water and make nettle tea.");
  }

  const DIG = Object.freeze({ x: 3803, y: 3530, z: 0 });
  const DIG_TICKS = 3;

  /** The book, three ticks after the dig (ticks 1138-1141); the map is kept. */
  function dig({ player }) {
    const at = player.getLocation();
    if (at.getX() !== DIG.x || at.getY() !== DIG.y || at.getZ() !== DIG.z || !held(player, ids.TREASURE_MAP)) return false;
    if (held(player, ids.BOOK_OF_HARICANTO) || State.get(player, State.VARBIT.GIVEN_BOOK) === 1) return false;
    api.core.TaskManager.submit(new api.core.CountdownTask(player, DIG_TICKS, () => {
      if (!player.isRegistered?.() || held(player, ids.BOOK_OF_HARICANTO)) return;
      player.getInventory().adds(ids.BOOK_OF_HARICANTO, 1);
      const text = findNode(variantSteps("book-of-haricanto-travelling-to-dragontooth-island-searching-with-the-map"), "DRLPdA")?.text
        ?? "You unearth the Book of Haricanto.";
      box.item(player, ids.BOOK_OF_HARICANTO, text);
    }));
    return true;
  }

  /** Follow: "This map is for use elsewhere." off the island; on it, the Wiki's pace menus. */
  function followMap({ player }) {
    if (!Voyage.atDragontooth(player)) {
      box.statement(player, "This map is for use elsewhere.");
      return true;
    }
    const steps = { North: [0, 1], East: [1, 0], South: [0, -1], West: [-1, 0] };
    const walk = (direction, paces) => () => {
      const [dx, dy] = steps[direction];
      const at = player.getLocation();
      player.getMovementQueue().reset();
      api.core.PathFinder.calculateWalkRoute(player, at.getX() + dx * paces, at.getY() + dy * paces);
    };
    const paces = (direction) => () => api.sendMultiChatboxPrompt(player, "How far do you wish to walk?",
      "1 pace", walk(direction, 1), "2 paces", walk(direction, 2), "4 paces", walk(direction, 4), "10 paces", walk(direction, 10));
    api.sendMultiChatboxPrompt(player, "Which direction do you wish to walk?",
      "North", paces("North"), "East", paces("East"), "South", paces("South"), "West", paces("West"));
    return true;
  }

  /** Ours: Read has no captured response; the same box as Follow off the island. */
  function readMap({ player }) {
    box.statement(player, "This map is for use elsewhere.");
    return true;
  }

  function countPetition({ player }) {
    const count = Math.max(0, signatures(player) - State.SIGNATURES_FORM);
    player.sendMessage(count === 0 ? "You haven't got any signatures yet." : `You have obtained ${count} signature${count === 1 ? "" : "s"}.`);
    return true;
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function handleItemOnObject(event) {
    if (event.handled) return;
    boilNettleWater(event);
    if (event.handled) return;
    Shipwreck.keyOnChest(event);
    if (event.handled) return;
    Tomb.keyOnDoor(event);
  }

  // ==========================================================================
  // Rewards and login
  // ==========================================================================

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 2400);
  }

  function handleLogin({ player }) {
    State.migrateLegacy(player, held(player, ids.PETITION_FORM));
    State.replay(player);
    refreshQuestList(player);
    player.getPacketSender().sendVarbit(QUESTVAR, stage(player));
  }

  function handleLogout(event) {
    Shipwreck.leave(event);
    Voyage.leave(event);
  }

  quest = registerQuest(api, {
    key: "ghosts_ahoy",
    name: "Ghosts Ahoy",
    varpId: VARP_GHOSTS_AHOY,
    varbitId: QUESTVAR,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.PRAYER.getIndex(), amount: 2400, label: "Prayer" }],
    rewardItemId: ids.ECTOPHIAL,
    rewardItemLabel: "An Ectophial",
    // The scroll's lines (tick 1973): "2 Quest Points", "2,400 Prayer XP", "An Ectophial", "Free Port Phasmatys Entry".
    otherRewards: ["Free Port Phasmatys Entry"],
    buildJournal,
    onReward: grantReward,
  });

  const shared = { ids, box, quest: { ...quest, STAGE, getStage: quest.getStage, isStarted: quest.isStarted, isComplete: quest.isComplete } };
  Runedraw.attach(api);
  Shipwreck.attach(api, shared);
  Voyage.attach(api, shared);
  Tomb.attach(api, shared);
  State.persist(api);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:line", handInLine);
  api.onCustomEvent("npc-dialogue:action", handleMessage);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("door:toggle", Tomb.toggleDoor);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(Shipwreck.lobsterDied);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction("Spade", { Dig: dig });
  api.onItemAction("Model ship", { Repair: Shipwreck.repairToyBoat, Inspect: Shipwreck.inspectToyBoat });
  api.onItemAction("Treasure map", { Follow: followMap, Read: readMap });
  api.onItemAction("Petition form", { Count: countPetition });
  api.onObjectInteraction("Closed chest", { Open: shipChest(Shipwreck.openChest, Shipwreck.openLockedChest) });
  api.onObjectInteraction("Open chest", { Search: shipChest(Shipwreck.searchChest), Close: shipChest(Shipwreck.closeChest) });
  api.onObjectInteraction("Mast", { Search: onlyId(ids.MAST, Shipwreck.searchMast) });
  api.onObjectInteraction("Gangplank", { Cross: onlyIds(ids.GANGPLANKS, Shipwreck.crossGangplank) });
  api.onObjectInteraction("Rock", { "Jump-To": onlyId(ids.ROCK, Shipwreck.jumpToRock) });
  api.onObjectInteraction("Coffin", { Open: Tomb.openCoffin, Search: Tomb.searchCoffin, Close: Tomb.closeCoffin });
  api.onZoneEnter(Shipwreck.TOP_DECK, Shipwreck.deckEntered);
  api.onZoneExit(Shipwreck.TOP_DECK, Shipwreck.deckLeft);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);

  /** The ship's chests: the quest's ahoy_chest locs only (Chests.plugin.js has the household ones). */
  function shipChest(open, locked) {
    return (event) => {
      if (event.objectId === ids.CHEST_CLOSED || event.objectId === ids.CHEST_OPEN) return open(event);
      if (locked && event.objectId === ids.LOCKED_CHEST) return locked(event);
      return false;
    };
  }

  function onlyId(id, handler) {
    return (event) => (event.objectId === id ? handler(event) : false);
  }

  function onlyIds(list, handler) {
    return (event) => (list.includes(event.objectId) ? handler(event) : false);
  }
};
