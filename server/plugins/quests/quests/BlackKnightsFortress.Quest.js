/**
 * Black Knights' Fortress.
 *
 * Words come from npc-dialogues.json. Sir Amik Varze (4771) is indexed to the
 * "Black Knights' Fortress" page, so his Talk-to is driven by the scripted
 * transcript and this plugin only picks the variant by stage:
 *   stage 0 -> "starting-out-starting-the-quest"      (hook starts the quest)
 *   stage 1 -> "starting-out-speaking-to-sir-amik-varze-again"
 *   stage 2 -> "reporting-back-to-sir-amik-varze"
 *   stage 3 -> "returning-to-sir-amik-varze"          (hands in, completes)
 *   stage 4 -> no BKF post-quest transcript exists in the dump (see GAPS).
 *
 * The Fortress Guards appear as four cache ids but only 4773 is in
 * npc-dialogue-index.json, so the dynamic Talk-to handler never fires for
 * 4774-4776. A specific npc hook intercepts all four and plays the disguise-
 * aware variant from the "Black Knights' Fortress" page.
 *
 * The fortress is entered through object interactions: the main door, the
 * banquet-hall door, the sturdy door, the secret wall and the listening grill.
 * When those need a spoken line we replay the dump's own variant through the
 * existing NpcDialogues player (multi-speaker wiki lines are flattened to a
 * single speaker portrait). The cabbage hole turns a normal cabbage into the
 * sabotage; the dossier is read from the inventory to begin the investigation.
 *
 * GAPS (no dump support, see summary):
 *   - Sir Amik Varze has no post-quest variant on the BKF page; the reference's
 *     "Hello, friend!" is not in the dump. At complete the selector returns null
 *     and the id index falls back to his "Sir Amik Varze"/"after-completing-wanted"
 *     page (a Wanted! line), so a human may want to add a BKF variant.
 *   - The reference gates the start on 12 Quest Points; the dump's start branch
 *     has no such condition, so the requirement is only in the journal.
 *   - The grill's "listen-at-grill-after-ruining-the-potion" variant is in the
 *     dump but the reference only plays while investigating; listening later
 *     says "You can't hear much right now." as in the reference.
 *   - The reference's post-completion flavour for the guards' meeting room and
 *     the witch/black-knight disguise lines are not used by this quest.
 */
module.exports = function registerBlackKnightsFortressQuest(api) {
  const { GameConstants, Location, Equipment, NpcDefinition, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const fs = require("fs");
  const path = require("path");

  const { registerQuest } = require("../QuestRuntime");
  const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");

  const BKF_PAGE = "Black Knights' Fortress";

  const SIR_AMIK_VARZE_NPC_ID = NpcIdentifiers.SIR_AMIK_VARZE_4;
  const FORTRESS_GUARD_NPC_IDS = new Set([
    NpcIdentifiers.FORTRESS_GUARD_2,
    NpcIdentifiers.FORTRESS_GUARD_3,
    NpcIdentifiers.FORTRESS_GUARD_4,
    NpcIdentifiers.FORTRESS_GUARD_5,
  ]);
  const FORTRESS_GUARD_DIALOGUE_NPC_ID = NpcIdentifiers.FORTRESS_GUARD_2;
  const FORTRESS_WITCH_NPC_ID = NpcIdentifiers.WITCH_5;

  const VARP_BLACK_KNIGHTS_FORTRESS = 130;
  const STAGE_INVESTIGATE = 1;
  const STAGE_SABOTAGE = 2;
  const STAGE_RETURN_TO_AMIK = 3;
  const STAGE_COMPLETE = 4;

  const DOSSIER_ITEM_ID = ItemIdentifiers.DOSSIER;
  const BRONZE_MED_HELM_ITEM_ID = ItemIdentifiers.BRONZE_MED_HELM;
  const IRON_CHAINBODY_ITEM_ID = ItemIdentifiers.IRON_CHAINBODY;
  const CABBAGE_ITEM_ID = ItemIdentifiers.CABBAGE;
  const DRAYNOR_MANOR_CABBAGE_ITEM_ID = ItemIdentifiers.CABBAGE_3;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;

  const FORTRESS_ENTRANCE_DOOR_LOC_ID = ObjectIdentifiers.STURDY_DOOR;
  const BANQUET_HALL_DOOR_LOC_ID = ObjectIdentifiers.DOOR_68;
  const GUARDED_STURDY_DOOR_LOC_ID = ObjectIdentifiers.STURDY_DOOR_2;
  const SECRET_WALL_LOC_ID = ObjectIdentifiers.WALL_8;
  const LISTENING_GRILL_LOC_ID = ObjectIdentifiers.GRILL;
  const CABBAGE_HOLE_LOC_ID = ObjectIdentifiers.HOLE_2;

  const START_HOOK = "quest:black-knights-fortress:start";
  const DOSSIER_ACTION_IDS = new Set(["RQQGDa", "kI0dT0"]);
  const QUEST_COMPLETE_ACTION_ID = "uMmzNj";

  const V_START = "starting-out-starting-the-quest";
  const V_AMIK_AGAIN = "starting-out-speaking-to-sir-amik-varze-again";
  const V_REPORT = "reporting-back-to-sir-amik-varze";
  const V_RETURN = "returning-to-sir-amik-varze";
  const V_GUARD_DISGUISED = "infiltrating-the-fortress-talking-to-the-guards-while-wearing-a-disguise";
  const V_GUARD_NOT_DISGUISED = "infiltrating-the-fortress-talking-to-the-guards-while-not-wearing-a-disguise";
  const V_DOOR_MAIN = "infiltrating-the-fortress-trying-to-open-the-sturdy-door-while-not-wearing-a-disguise";
  const V_DOOR_MEETING = "sabotaging-the-potion-interrupting-the-black-knights-meeting";
  const V_GRILL = "listen-at-grill";
  const V_CABBAGE_BEFORE = "sabotaging-the-potion-using-any-item-on-the-hole-or-a-cabbage-before-overhearing-the-witch";
  const V_CABBAGE_NORMAL = "sabotaging-the-potion-using-a-normal-cabbage-on-the-hole";
  const V_CABBAGE_DRAYNOR = "sabotaging-the-potion-using-a-draynor-cabbage-on-the-hole";

  let quest;
  let pluginApi;

  /** Which side of the banquet door the player is standing on, for the warning. */
  const pendingCross = { player: null, location: null };

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const isDisguised = (player) =>
    player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() === BRONZE_MED_HELM_ITEM_ID &&
    player.getEquipment().get(Equipment.BODY_SLOT)?.getId?.() === IRON_CHAINBODY_ITEM_ID;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Sir Amik asked me to investigate the Black Knights.</str>",
        "<str>I discovered and sabotaged their invincibility potion.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURN_TO_AMIK) {
      return [
        "<str>I infiltrated the Black Knights' Fortress.</str>",
        "<str>I ruined the witch's invincibility potion with a cabbage.</str>",
        "",
        "I should claim my reward from <col=800000>Sir Amik Varze</col>",
        "in <col=800000>Falador Castle</col>.",
      ];
    }
    if (stage >= STAGE_SABOTAGE) {
      return [
        "<str>I infiltrated the Black Knights' Fortress.</str>",
        "<str>I learned that their secret weapon is an invincibility potion.</str>",
        "",
        "An ordinary <col=800000>cabbage</col> will ruin the potion.",
        "A cabbage from Draynor Manor would help the witch instead.",
      ];
    }
    if (stage >= STAGE_INVESTIGATE) {
      return [
        "Sir Amik asked me to infiltrate the <col=800000>Black Knights' Fortress</col>",
        "near Ice Mountain and sabotage their secret weapon.",
        "",
        "An <col=800000>iron chainbody</col> and <col=800000>bronze med helm</col>",
        "will let me pass as a fortress guard.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Sir Amik Varze</col>",
      "on the upper floor of <col=800000>Falador Castle</col>.",
      "",
      "I need at least <col=800000>12 Quest Points</col>.",
    ];
  }

  function reward(player) {
    player.getInventory().adds(COINS_ITEM_ID, 2500);
  }

  // ---------------------------------------------------------------------------
  // Replaying a dump variant from a non-NPC interaction.
  //
  // startDialogue() speaks generic `{ npc }` lines with the passed definition's
  // id it cannot switch portrait per line. Wiki multi-speaker variants tag each
  // line with `speaker`, so flatten those to generic NPC lines and use the
  // variant's main speaker id.
  // ---------------------------------------------------------------------------
  let dialogueData = null;

  function loadDialogueData() {
    if (!dialogueData) {
      dialogueData = JSON.parse(
        fs.readFileSync(path.join(GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogues.json"), "utf8")
      );
    }
    return dialogueData;
  }

  function flattenSpeakers(steps) {
    if (!Array.isArray(steps)) return [];
    return steps.map((step) => {
      const copy = { ...step };
      if (copy.type === "line" && typeof copy.speaker === "string") {
        copy.npc = copy.text;
        delete copy.speaker;
      }
      if (Array.isArray(copy.steps)) copy.steps = flattenSpeakers(copy.steps);
      if (Array.isArray(copy.options)) {
        copy.options = copy.options.map((option) => ({ ...option, steps: flattenSpeakers(option.steps) }));
      }
      return copy;
    });
  }

  function playVariant(api, player, npcId, page, variant) {
    const data = loadDialogueData();
    const raw = data?.[page]?.variants?.[variant];
    if (!Array.isArray(raw)) return false;
    const definition = NpcDefinition.forId(npcId);
    const event = { player, npcId, npc: null, definition };
    const context = { player, npc: null, npcId, definition, pages: [{ page, variants: [variant] }] };
    startDialogue(api, event, flattenSpeakers(raw), data[page]?.branches, context);
    return true;
  }

  /** Steps the player one tile through a door, landing on the opposite side. */
  function crossDoor(player, location) {
    const pos = player.getLocation();
    const dx = pos.getX() - location.x;
    const dy = pos.getY() - location.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      player.moveTo(new Location(location.x - Math.sign(dx), pos.getY(), location.z ?? pos.getZ()));
    } else {
      player.moveTo(new Location(pos.getX(), location.y - Math.sign(dy), location.z ?? pos.getZ()));
    }
  }

  // Sir Amik Varze's transcript variant by stage.
  function selectVariant({ npcId, player }) {
    if (npcId === SIR_AMIK_VARZE_NPC_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_COMPLETE) return null; // no BKF post-quest transcript (GAP)
      if (stage >= STAGE_RETURN_TO_AMIK) return { page: BKF_PAGE, variant: V_RETURN };
      if (stage >= STAGE_SABOTAGE) return { page: BKF_PAGE, variant: V_REPORT };
      if (stage >= STAGE_INVESTIGATE) return { page: BKF_PAGE, variant: V_AMIK_AGAIN };
      return { page: BKF_PAGE, variant: V_START };
    }
    if (FORTRESS_GUARD_NPC_IDS.has(npcId)) {
      return {
        page: BKF_PAGE,
        variant: isDisguised(player) ? V_GUARD_DISGUISED : V_GUARD_NOT_DISGUISED,
      };
    }
    return null;
  }

  // Answer the transcript's prose conditions.
  function answerCondition({ npcId, player, text }) {
    if (npcId !== SIR_AMIK_VARZE_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("lost their dossier")) return !hasItem(player, DOSSIER_ITEM_ID);
    if (value.includes("no inventory space")) return player.getInventory().isFull();
    return null;
  }

  // Guards: 4774-4776 have no index entry so the dynamic Talk-to hook never
  // runs for them; intercept all four and pick the disguise-aware variant.
  function handleGuardInteraction(event) {
    if (!FORTRESS_GUARD_NPC_IDS.has(event.npcId)) return;
    const action = String(event.definition?.getActions?.()[event.clickType - 1] ?? "").toLowerCase();
    if (action !== "talk-to") return;
    const variant = isDisguised(event.player) ? V_GUARD_DISGUISED : V_GUARD_NOT_DISGUISED;
    if (playVariant(pluginApi, event.player, event.npcId, BKF_PAGE, variant)) event.handled = true;
  }

  // "Yes." on "Start the Black Knights' Fortress quest?" carries this slug.
  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== SIR_AMIK_VARZE_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_INVESTIGATE) return;
    quest.setStage(player, STAGE_INVESTIGATE);
  }

  // The transcript's "dossier" actions hand the item over; the reward page's
  // "Quest complete!" action finishes the quest.
  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId !== SIR_AMIK_VARZE_NPC_ID) return;
    if (DOSSIER_ACTION_IDS.has(stepId)) {
      if (!hasItem(player, DOSSIER_ITEM_ID) && !player.getInventory().isFull()) {
        player.getInventory().adds(DOSSIER_ITEM_ID, 1);
      }
      event.handled = true;
      return;
    }
    if (stepId === QUEST_COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_RETURN_TO_AMIK) {
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
    }
  }

  // Reading Sir Amik's dossier starts the investigation and destroys the note.
  function handleDossierRead(event) {
    if (event.itemId !== DOSSIER_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("read")) return;
    const { player } = event;
    if (quest.getStage(player) > STAGE_INVESTIGATE) {
      player.sendMessage("The dossier has already served its purpose.");
      event.handled = true;
      return;
    }
    if (!hasItem(player, DOSSIER_ITEM_ID)) return;
    player.getInventory().deleteNumber(DOSSIER_ITEM_ID, 1);
    if (quest.getStage(player) < STAGE_INVESTIGATE) quest.setStage(player, STAGE_INVESTIGATE);
    player.sendMessage("The Black Knights threaten Falador with a secret weapon.");
    player.sendMessage("Infiltrate their fortress, discover the weapon, and sabotage it.");
    player.sendMessage("The dossier crumbles to dust.");
    event.handled = true;
  }

  function handleFortressObjectInteraction(event) {
    const { objectId, player } = event;
    if (
      objectId !== FORTRESS_ENTRANCE_DOOR_LOC_ID &&
      objectId !== BANQUET_HALL_DOOR_LOC_ID &&
      objectId !== GUARDED_STURDY_DOOR_LOC_ID &&
      objectId !== SECRET_WALL_LOC_ID &&
      objectId !== LISTENING_GRILL_LOC_ID
    ) {
      return;
    }
    const action = String(event.definition?.getInteractions?.()[event.clickType - 1] ?? "").toLowerCase();
    const pos = player.getLocation();
    const loc = event.location;

    if (objectId === FORTRESS_ENTRANCE_DOOR_LOC_ID) {
      if (!action.includes("open")) return;
      if (pos.getY() >= loc.y || isDisguised(player)) {
        crossDoor(player, loc);
      } else {
        playVariant(pluginApi, player, FORTRESS_GUARD_DIALOGUE_NPC_ID, BKF_PAGE, V_DOOR_MAIN);
      }
      event.handled = true;
      return;
    }

    if (objectId === BANQUET_HALL_DOOR_LOC_ID) {
      if (!action.includes("open")) return;
      if (pos.getX() >= loc.x) {
        crossDoor(player, loc);
      } else {
        pendingCross.player = player;
        pendingCross.location = loc;
        playVariant(pluginApi, player, FORTRESS_GUARD_DIALOGUE_NPC_ID, BKF_PAGE, V_DOOR_MEETING);
      }
      event.handled = true;
      return;
    }

    if (objectId === GUARDED_STURDY_DOOR_LOC_ID) {
      if (!action.includes("open")) return;
      crossDoor(player, loc);
      event.handled = true;
      return;
    }

    if (objectId === SECRET_WALL_LOC_ID) {
      if (!action.includes("push")) return;
      player.sendMessage("You push against the wall. You find a secret passage.");
      crossDoor(player, loc);
      event.handled = true;
      return;
    }

    // Listening grill: only while investigating the weapon.
    if (!action.includes("listen")) return;
    if (quest.getStage(player) !== STAGE_INVESTIGATE) {
      player.sendMessage("You can't hear much right now.");
      event.handled = true;
      return;
    }
    quest.setStage(player, STAGE_SABOTAGE);
    playVariant(pluginApi, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_GRILL);
    event.handled = true;
  }

  // "I don't care. I'm going in anyway." walks through the banquet door.
  function handleBanquetChoice({ player, option }) {
    if (!pendingCross.player || pendingCross.player !== player) return;
    if (String(option ?? "").toLowerCase().includes("going in anyway")) {
      crossDoor(player, pendingCross.location);
    }
    pendingCross.player = null;
    pendingCross.location = null;
  }

  function handleItemOnHole(event) {
    if (event.objectId !== CABBAGE_HOLE_LOC_ID) return;
    const { player, itemId } = event;
    const stage = quest.getStage(player);
    if (itemId === CABBAGE_ITEM_ID) {
      if (stage !== STAGE_SABOTAGE) {
        playVariant(pluginApi, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_BEFORE);
      } else if (player.getInventory().getAmount(CABBAGE_ITEM_ID) > 0) {
        player.getInventory().deleteNumber(CABBAGE_ITEM_ID, 1);
        quest.setStage(player, STAGE_RETURN_TO_AMIK);
        playVariant(pluginApi, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_NORMAL);
      }
      event.handled = true;
      return;
    }
    if (itemId === DRAYNOR_MANOR_CABBAGE_ITEM_ID) {
      if (stage !== STAGE_SABOTAGE) {
        player.sendMessage("Why would I want to do that?");
      } else {
        playVariant(pluginApi, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_DRAYNOR);
      }
      event.handled = true;
    }
  }

  pluginApi = api;
  quest = registerQuest(api, {
    key: "black_knights_fortress",
    name: "Black Knights' Fortress",
    varpId: VARP_BLACK_KNIGHTS_FORTRESS,
    startedValue: STAGE_INVESTIGATE,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    scrollItemId: COINS_ITEM_ID,
    rewardItemLabel: "2,500 Coins",
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction(handleGuardInteraction);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemAction(handleDossierRead);
  api.onObjectInteraction(handleFortressObjectInteraction);
  api.onCustomEvent("npc-dialogue:choice", handleBanquetChoice);
  api.onItemOnObject(handleItemOnHole);
};
