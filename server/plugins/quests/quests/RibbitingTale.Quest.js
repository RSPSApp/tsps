/**
 * The Ribbiting Tale of a Lily Pad Labour Dispute (members).
 *
 * The words come from the "The Ribbiting Tale of a Lily Pad Labour Dispute"
 * transcript page in data/definitions/npc-dialogues.json; this plugin supplies
 * the NPC variant selector for Marcellus, the blue frogs (Gary/Sue), the yellow
 * frogs (Dave/Jane) and Cuthbert, the prose-condition answers for the bed/chest
 * searches, the object interactions (orange tree, lily pad, bed, chest, dung,
 * the axe on the logs), the Cuthbert fight and the completion.
 *
 * Stage varbit 9844 "frog_quest" (varp 4152 "frog_quest_primary", bits 0-6):
 * cache CS2 script 4024 (the quest-progress lookup the quest list reads) maps
 * quest id 3515 (DB row 3515, RuneLite Quest.THE_RIBBITING_TALE...) to
 * get_varbit 9844. The step values follow RuneLite quest-helper's stage map and
 * the cache's own multilocs on 9844 (dump:loc):
 *   50891 (Lily pad, 1692,2983):   8-12 -> 50892 "Sabotage"
 *   52977 (Orange tree, 1695,2980): 10 -> 50888 "Chop down", else 50889 stump
 *   52978 (Bed, 1680,2973):        22-24 -> 50893 "Search"
 *   52979 (Capybara Dung, 1694,2976): 22-23 -> 50898 "Plant-evidence"
 * Stage map: 0 not started, 2 sent to the frogs, 4 frogs met, 6 Marcellus
 * wants a leader, 8 election planned, 10 chop the orange tree, 12 tree chopped
 * (pad sabotagable), 14 sabotaged, 15 hop-off cutscene, 16 Sue's terms,
 * 18 Marcellus wants proof, 20 steal something, 22 bed/chest/dung phase,
 * 24 chest unlocked, 26 plushy planted (fight Cuthbert), 28 Cuthbert
 * defeated, 30 Marcellus accepts, 32 complete.
 *
 * Rewards per the OSRS Wiki: 1 Quest point, 2,000 Woodcutting XP and access to
 * the new hardwood Farming patch (varbit 9845 "frog_quest_patch_unlocked").
 *
 * Packet evidence: RSProx database capture 1695, ticks 8893-9360. The
 * hop-off uses its camera, actor positions, forced hops, fades and pauses;
 * the chest uses the cache's native five-letter combination interface.
 * Unrecorded alternate branches remain based on the Wiki transcript.
 */
module.exports = function registerRibbitingTaleQuest(api) {
  const {
    Animation, Boundary, CountdownTask, DialogueChainBuilder, ActionDialogue,
    GameObject, Graphic, Location, ObjectManager, PrivateArea,
    StatementDialogue, TaskManager,
    Equipment,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Ribbiting Tale of a Lily Pad Labour Dispute";
  const START_HOOK = "quest:the-ribbiting-tale-of-a-lily-pad-labour-dispute:start";

  // Varbit 9844 frog_quest (CS2 4024 case 3515), 9845 frog_quest_patch_unlocked.
  const VARBIT_PATCH_UNLOCKED = 9845;

  const STAGE_STARTED = 2;
  const STAGE_FROGS = 4;
  const STAGE_LEADER = 6;
  const STAGE_ELECTION = 8;
  const STAGE_TREE = 10;
  const STAGE_SABOTAGED = 12;
  const STAGE_DEMOCRACY_DONE = 14;
  const STAGE_HOP_OFF = 15;
  const STAGE_TERMS = 16;
  const STAGE_PROOF = 18;
  const STAGE_BLAME = 20;
  const STAGE_STEAL = 22;
  const STAGE_CHEST = 24;
  const STAGE_PLANTED = 26;
  const STAGE_CUTHBERT_DEAD = 28;
  const STAGE_ACCEPTED = 30;
  const STAGE_COMPLETE = 32;

  const WOODCUTTING_REQUIREMENT = 15;
  const CHILDREN_OF_THE_SUN_KEY = "children_of_the_sun";

  const MARCELLUS_NPC_IDS = new Set([NpcIdentifiers.MARCELLUS, NpcIdentifiers.MARCELLUS_2]);
  const BLUE_FROG_NPC_IDS = new Set([
    NpcIdentifiers.FROG_12, NpcIdentifiers.FROG_16, // unnamed-at-first Gary/Sue
    13402, 13404, // cache per-player Gary/Sue parents, both present in1695

    NpcIdentifiers.GARY,
    NpcIdentifiers.GARY_2,
    NpcIdentifiers.SUE,
    NpcIdentifiers.SUE_2,
  ]);
  const YELLOW_FROG_NPC_IDS = new Set([
    13403, 13405, // cache Dave/Jane parents

    NpcIdentifiers.DAVE_2,
    NpcIdentifiers.DAVE_3,
    NpcIdentifiers.JANE,
    NpcIdentifiers.JANE_2,
  ]);
  const CUTHBERT_NPC_IDS = new Set([NpcIdentifiers.CUTHBERT, NpcIdentifiers.CUTHBERT_2, 13406]);
  // Transform-parent Marcellus is also indexed to the quest page.
  const CUTSCENE_MARCELLUS_NPC_ID = 13401;
  const OWNED_NPC_IDS = new Set([
    ...MARCELLUS_NPC_IDS,
    ...BLUE_FROG_NPC_IDS,
    ...YELLOW_FROG_NPC_IDS,
    ...CUTHBERT_NPC_IDS,
    CUTSCENE_MARCELLUS_NPC_ID,
    NpcIdentifiers.CUTHBERT_LORD_OF_DREAD,
  ]);

  const JANE_NPC_ID = NpcIdentifiers.JANE;
  // Talk-to resolves the cache transform parent (13405), not the named child (12951).
  const JANE_NPC_IDS = new Set([NpcIdentifiers.JANE, NpcIdentifiers.JANE_2, 13405]);
  const MARCELLUS_NPC_ID = NpcIdentifiers.MARCELLUS;
  const CUTHBERT_COMBAT_NPC_ID = NpcIdentifiers.CUTHBERT_LORD_OF_DREAD;

  const LOVE_LETTER_ITEM_ID = ItemIdentifiers.LOVE_LETTER; // 28986
  const PLUSHY_ITEM_ID = ItemIdentifiers.PLUSHY; // 28987
  const BRONZE_AXE_ITEM_ID = ItemIdentifiers.BRONZE_AXE; // 1351
  const AXE_ITEM_IDS = [
    ItemIdentifiers.BRONZE_AXE,
    ItemIdentifiers.IRON_AXE,
    ItemIdentifiers.STEEL_AXE,
    ItemIdentifiers.BLACK_AXE,
    ItemIdentifiers.MITHRIL_AXE,
    ItemIdentifiers.ADAMANT_AXE,
    ItemIdentifiers.RUNE_AXE,
    ItemIdentifiers.DRAGON_AXE,
    ItemIdentifiers.INFERNAL_AXE,
    ItemIdentifiers._3RD_AGE_AXE,
    ItemIdentifiers.CRYSTAL_AXE,
    ItemIdentifiers.DRAGON_FELLING_AXE,
  ];

  // Null-named multilocs on varbit 9844; the resolved ids are the identifiers.
  const LILY_PAD_MULTILOC_ID = 50891; // -> 50890 / 50892 (LILY_PAD_2)
  const ORANGE_TREE_MULTILOC_ID = 52977; // -> 50887 / 50889 / 50888 (ORANGE_TREE_16)
  const BED_MULTILOC_ID = 52978; // -> 50894 / 50893 (BED_219)
  const DUNG_MULTILOC_ID = 52979; // -> 50897 / 50898 (CAPYBARA_DUNG_2) / 50899
  const CHEST_OBJECT_ID = ObjectIdentifiers.CHEST_246; // 50895
  const LOGS_OBJECT_ID = ObjectIdentifiers.LOGS; // 5581

  const CUTHBERT_SPAWN_TILE = { x: 1688, y: 2977, z: 0 };
  const LOCUS_LOGS_TILE = { x: 1683, y: 2975, z: 0 };

  const PATCH_UNLOCKED_ATTRIBUTE = "ribbiting-tale:patch-unlocked";
  const HARDWOOD_PATCH_ID = 50692;
  const LEGACY_CHEST_ATTRIBUTE = "quest.ribbiting-tale.chest-unlocked";
  const STAGE_VERSION_ATTRIBUTE = "ribbiting-tale:stage-version";
  const QUEST_KEY = "the_ribbiting_tale_of_a_lily_pad_labour_dispute";

  const LOVE_LETTER_LINES = [
    "My dearest Nalia,",
    "As I gaze into the night sky, the stars shine like diamonds, reminding me of your " +
      "radiant beauty. Over the years, my love for you has only grown. It matures like a " +
      "fine cheese, developing a scent that is truly unforgettable. I pray to Ralos that we " +
      "will soon be united, and I also pray that this letter is not mysteriously lost like " +
      "the last 28 I sent.",
    "Forever yours, Marcellus",
  ];

  const CHEST_INTERFACE = 809;
  const CHEST_CODE_ROW = 3511;
  const NALIA_CODE = 334490; // Captured resume_p_countdialog value for the NALIA combination.
  const FADE_UID = (161 << 16) | 1;
  const HOP_VARIANT = "democracy-at-work-watching-the-frog-hop-off";
  const TERMS_VARIANT = "peace-talks-talking-to-gary-or-sue";
  const scenes = new WeakMap();
  const pendingChests = new WeakMap();
  const playerTasks = new WeakMap();
  const actions = new WeakSet();
  const acceptedStarts = new WeakSet();
  const HEADS = { Marcellus: 13401, Gary: 13402, Dave: 13403, Sue: 13404, Jane: 13405, Cuthbert: 13406 };
  const HOP_ACTORS = [
    ["sue", 12948, 1694, 2982, 1692, 2982],
    ["cuthbert", 12956, 1694, 2983, 1692, 2983],
    ["gary", 12940, 1696, 2982, 1694, 2982],
    ["jane", 12952, 1692, 2988, 1690, 2986],
    ["dave", 12944, 1693, 2986, 1691, 2984],
    ["frog", 12960, 1694, 2988, 1692, 2986],
    ["capybara-a", 12958, 1700, 2981, 1691, 2983],
    ["capybara-b", 12959, 1699, 2979, 1691, 2983],
    ["capybara-c", 12958, 1696, 2986, 1694, 2984],
  ];
  let quest;

  function later(key, ticks, callback) {
    if (key?.isPlayer?.()) {
      const player = key;
      key = playerTasks.get(player);
      if (!key) { key = {}; playerTasks.set(player, key); }
    }
    TaskManager.submit(new CountdownTask(key, ticks, callback));
  }
  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, 174, 1, {
      postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }
  function controls(player, active) {
    player.getMovementQueue().reset().setBlockMovement(active);
    player.setUntargetable(active);
    player.getPacketSender().sendVarbit(12393, active ? 1 : 0).sendVarbit(6719, active ? 2 : 0);
  }
  function freeze(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, "", false) })
    ));
  }
  class HopOff extends PrivateArea {
    constructor(player) { super([new Boundary(1664, 1727, 2944, 3007, 0)]); this.owner = player; }
    canAttack() { return false; }
    canTeleport() { return false; }
    postLeave(actor, logout) {
      if (actor === this.owner && scenes.get(actor)?.area === this) cleanScene(actor, false);
      super.postLeave(actor, logout);
    }
  }
  function cleanScene(player, returnPlayer = true) {
    const scene = scenes.get(player);
    if (!scene) return;
    scenes.delete(player);
    TaskManager.cancelTasks(scene);
    for (const actor of scene.actors.values()) api.removeNpc(actor);
    controls(player, false);
    player.getPacketSender().sendCameraUnlock(false).sendCameraReset().closeSubInterface(FADE_UID);
    if (scene.area && player.getArea() === scene.area && returnPlayer) {
      scene.area.leave(player, false);
      player.moveTo(scene.returnTo);
    }
  }
  function playHop(player, anchor) {
    startTranscript(api, player, MARCELLUS_NPC_ID, PAGE, HOP_VARIANT, steps => {
      if (!anchor) return steps;
      return steps.slice(steps.findIndex(step => step.id === anchor) + 1);
    });
  }
  function beginHop(player) {
    if (scenes.has(player)) return;
    const scene = { returnTo: player.getLocation().clone(), actors: new Map(), area: null };
    scenes.set(player, scene);
    controls(player, true); freeze(player); fade(player, true);
    later(scene, 2, () => {
      scene.area = new HopOff(player); scene.area.enter(player);
      player.moveTo(new Location(1696, 2983, 0));
      for (const [key, id, x, y, faceX, faceY] of HOP_ACTORS) {
        const npc = api.spawnNpc({ id, x, y, z: 0, owner: player, ownerOnly: true, wanderRadius: 0 });
        if (npc) { scene.actors.set(key, npc); scene.area.enter(npc); npc.setPositionToFace(new Location(faceX, faceY, 0)); }
      }
    });
    later(scene, 3, () => {
      const rates = { rate: 232, rate2: 100, heightRelative: false };
      player.getPacketSender().sendCameraMoveTo(1685, 2989, 550, rates).sendCameraLookAt(1697, 2981, 350, rates);
    });
    later(scene, 4, () => fade(player, false));
    later(scene, 6, () => playHop(player));
  }
  function frogHop(player, stepId, cuthbert) {
    const scene = scenes.get(player);
    if (!scene) return;
    freeze(player);
    later(scene, 1, () => {
      const npc = scene.actors.get(cuthbert ? "cuthbert" : "sue");
      const y = cuthbert ? 2983 : 2982;
      const delay = cuthbert ? 13 : 7, animation = cuthbert ? 1797 : 10957;
      if (npc) {
        npc.performAnimation(new Animation(animation, cuthbert ? 6 : 0));
        npc.exactMove(new Location(1692, y, 0), { startCycles: delay, endCycles: cuthbert ? 30 : 24, angle: 512 });
      }
      player.getPacketSender().sendSoundEffect(2461, 1, delay).sendSoundEffect(842, 1, delay);
      if (cuthbert) player.getPacketSender().sendGraphic(new Graphic(68, 20), new Location(1692, 2983, 0)).sendSoundEffect(2496, 1, 20);
    });
    if (cuthbert) later(scene, 2, () => {
      const npc = scene.actors.get("cuthbert"); if (npc) api.removeNpc(npc);
      scene.actors.delete("cuthbert");
      ObjectManager.register(new GameObject(29733, new Location(1692, 2983, 0), 10, 0, scene.area), true);
      player.getPacketSender().sendSoundEffect(843, 1, 0);
    });
    later(scene, cuthbert ? 7 : 3, () => playHop(player, stepId));
  }
  function finishHop(player) {
    const scene = scenes.get(player);
    if (!scene) return;
    advance(player, STAGE_TERMS); freeze(player); fade(player, true);
    later(scene, 2, () => {
      const area = scene.area; scene.area = null;
      if (area) { area.leave(player, false); player.moveTo(scene.returnTo); }
      player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
    });
    later(scene, 4, () => fade(player, false));
    later(scene, 6, () => {
      cleanScene(player);
      startTranscript(api, player, NpcIdentifiers.SUE, PAGE, TERMS_VARIANT);
    });
  }


  /** Cuthbert, Lord of Dread spawn per player (owner-only). */
  const cuthbertByPlayer = new Map();

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function wearingAxe(player) {
    const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
    return Boolean(weapon && AXE_ITEM_IDS.includes(weapon.getId?.()));
  }

  function hasAxe(player) {
    return AXE_ITEM_IDS.some((id) => held(player, id)) || wearingAxe(player);
  }


  function meetsRequirements(player) {
    if (player.getSkillManager().getMaxLevel(Skill.WOODCUTTING) < WOODCUTTING_REQUIREMENT) {
      return false;
    }
    const request = { player, key: CHILDREN_OF_THE_SUN_KEY, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** Advances the stage without ever regressing. */
  function advance(player, stage) {
    if (quest.getStage(player) >= stage) return;
    quest.setStage(player, stage);
  }

  // ==========================================================================
  // Cuthbert, Lord of Dread
  // ==========================================================================

  function spawnCuthbert(player) {
    if (cuthbertByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: CUTHBERT_COMBAT_NPC_ID,
      x: CUTHBERT_SPAWN_TILE.x,
      y: CUTHBERT_SPAWN_TILE.y,
      z: CUTHBERT_SPAWN_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) {
      cuthbertByPlayer.set(player, npc);
      npc.forceChat("You! Prepare to face the Lord of Dread!");
      npc.getCombat().attack(player);
    }
  }

  function removeCuthbert(player) {
    const npc = cuthbertByPlayer.get(player);
    cuthbertByPlayer.delete(player);
    if (npc) api.removeNpc(npc);
  }

  /** Respawning on login covers a logout (or death) mid-fight while the fight is pending. */
  function ensureCuthbert(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_PLANTED || stage >= STAGE_CUTHBERT_DEAD) {
      removeCuthbert(player);
      return;
    }
    removeCuthbert(player);
    spawnCuthbert(player);
  }

  function handleNpcDeath(event) {
    const { npc, killer } = event;
    if (event.npcId !== CUTHBERT_COMBAT_NPC_ID) return;
    const owner = killer?.isPlayer?.() && cuthbertByPlayer.get(killer) === npc
      ? killer
      : npc?.getOwner?.();
    if (!owner || !owner.isPlayer?.()) return;
    cuthbertByPlayer.delete(owner);
    const stage = quest.getStage(owner);
    if (stage >= STAGE_PLANTED && stage < STAGE_CUTHBERT_DEAD) {
      quest.setStage(owner, STAGE_CUTHBERT_DEAD);
    }
  }

  function resetRunState(player) {
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, 1);
    removeCuthbert(player);
  }

  // ==========================================================================
  // Transcript variant selection
  // ==========================================================================

  function selectVariant(event) {
    const { player, npcId } = event;
    if (!player || !npcId) return null;
    if (MARCELLUS_NPC_IDS.has(npcId) || npcId === CUTSCENE_MARCELLUS_NPC_ID) {
      return marcellusVariant(player);
    }
    if (BLUE_FROG_NPC_IDS.has(npcId)) return blueFrogVariant(player);
    if (YELLOW_FROG_NPC_IDS.has(npcId)) return yellowFrogVariant(player, npcId);
    if (CUTHBERT_NPC_IDS.has(npcId)) return cuthbertVariant(player);
    return null;
  }

  function marcellusVariant(player) {
    const stage = quest.getStage(player);
    if (stage <= 0) {
      return meetsRequirements(player)
        ? "crazy-frogs-talking-to-marcellus"
        : "crazy-frogs-talking-to-marcellus-without-the-requirements-to-start";
    }
    if (stage <= STAGE_STARTED) return "crazy-frogs-talking-to-marcellus-talking-to-marcellus-again";
    if (stage <= STAGE_FROGS) return "crazy-frogs-talking-to-marcellus-after-talking-to-gary-and-sue";
    if (stage <= STAGE_HOP_OFF) {
      return "crazy-frogs-talking-to-marcellus-after-talking-to-gary-and-sue-talking-to-marcellus-again";
    }
    if (stage <= STAGE_TERMS) return "peace-talks-talking-to-marcellus-after-talking-to-gary-and-sue";
    if (stage <= STAGE_STEAL) {
      return "peace-talks-talking-to-marcellus-after-talking-to-gary-and-sue-talking-to-marcellus-again";
    }
    if (stage < STAGE_CUTHBERT_DEAD) {
      return "peace-talks-talking-to-dave-jane-or-marcellus-before-defeating-cuthbert";
    }
    if (stage <= STAGE_CUTHBERT_DEAD) return "peace-talks-telling-marcellus-of-the-evidence";
    if (stage <= STAGE_ACCEPTED) {
      return "peace-talks-telling-marcellus-of-the-evidence-talking-to-marcellus-again";
    }
    return "post-quest-dialogue-talking-to-marcellus";
  }

  function blueFrogVariant(player) {
    const stage = quest.getStage(player);
    if (stage <= STAGE_STARTED) return "crazy-frogs-talking-to-the-blue-frogs";
    if (stage <= STAGE_FROGS) return "crazy-frogs-talking-to-the-blue-frogs-talking-to-gary-or-sue-again";
    if (stage <= STAGE_LEADER) return "democracy-at-work-talking-to-gary-or-sue";
    if (stage <= STAGE_SABOTAGED) {
      return "democracy-at-work-talking-to-gary-or-sue-talking-to-gary-or-sue-again";
    }
    if (stage <= STAGE_DEMOCRACY_DONE) {
      return "democracy-at-work-talking-to-gary-or-sue-after-sabotaging-the-lily-pad";
    }
    if (stage <= STAGE_HOP_OFF) return "democracy-at-work-watching-the-frog-hop-off";
    if (stage <= STAGE_TERMS) return "peace-talks-talking-to-gary-or-sue";
    if (stage <= STAGE_PROOF) return "peace-talks-talking-to-gary-or-sue-talking-to-gary-or-sue-again";
    if (stage <= STAGE_BLAME) return "peace-talks-talking-to-gary-or-sue-2";
    if (stage < STAGE_PLANTED) {
      return held(player, PLUSHY_ITEM_ID)
        ? "peace-talks-talking-to-gary-or-sue-with-the-plushy"
        : "peace-talks-talking-to-gary-or-sue-talking-to-gary-or-sue-again-2";
    }
    if (stage < STAGE_CUTHBERT_DEAD) {
      return "peace-talks-talking-to-gary-or-sue-before-defeating-cuthbert";
    }
    if (stage <= STAGE_CUTHBERT_DEAD) return "peace-talks-talking-to-gary-or-sue-after-defeating-cuthbert";
    if (stage <= STAGE_ACCEPTED) {
      return "peace-talks-talking-to-gary-or-sue-after-marcellus-accepts-the-terms";
    }
    return "post-quest-dialogue-talking-to-gary-or-sue";
  }

  function yellowFrogVariant(player, npcId) {
    const stage = quest.getStage(player);
    if (stage <= STAGE_FROGS) return "crazy-frogs-talking-to-the-blue-frogs-talking-to-dave-or-jane";
    if (stage <= STAGE_ELECTION) return "democracy-at-work-talking-to-dave-or-jane";
    if (stage < STAGE_SABOTAGED) return "democracy-at-work-talking-to-dave-or-jane-again";
    if (stage <= STAGE_DEMOCRACY_DONE) {
      return JANE_NPC_IDS.has(npcId)
        ? "democracy-at-work-after-chopping-down-the-orange-tree"
        : "democracy-at-work-after-chopping-down-the-orange-tree-talking-to-dave-or-jane-after-chopping-down-the-orange-tree";
    }
    if (stage <= STAGE_BLAME) {
      return "peace-talks-talking-to-gary-or-sue-talking-to-dave-or-jane-after-the-hop-off";
    }
    if (stage < STAGE_PLANTED) return "peace-talks-talking-to-dave-or-jane";
    if (stage < STAGE_CUTHBERT_DEAD) {
      return "peace-talks-talking-to-dave-jane-or-marcellus-before-defeating-cuthbert";
    }
    if (stage < STAGE_COMPLETE) return "peace-talks-talking-to-dave-or-jane";
    return "post-quest-dialogue-talking-to-dave-or-jane";
  }

  function cuthbertVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_LEADER) return "crazy-frogs-talking-to-the-blue-frogs-talking-to-cuthbert";
    return "democracy-at-work-talking-to-cuthbert";
  }

  // ==========================================================================
  // Conditions and dialogue side effects
  // ==========================================================================

  /** The bed/chest prose conditions. */
  function answerCondition(event) {
    const { player, npcId, stepId } = event;
    if (!player || !stepId || !OWNED_NPC_IDS.has(npcId)) return null;
    switch (stepId) {
      case "GN3nQt": // already holding the love letter
        return held(player, LOVE_LETTER_ITEM_ID);
      case "WUQXah": // no inventory space (bed)
      case "_ZWnSn": // no inventory space (unlock)
      case "H_pAp7": // no inventory space (open chest)
        return player.getInventory().isFull();
      case "17ktkp": // already has the plushy
        return held(player, PLUSHY_ITEM_ID);
      default:
        return null;
    }
  }

  function handleMessage(player, stepId) {
    switch (stepId) {
      case "vEJVh9": // searched the bed and found a love letter
        if (!held(player, LOVE_LETTER_ITEM_ID)) {
          player.getInventory().adds(LOVE_LETTER_ITEM_ID, 1);
        }
        return;
      case "5F55jc": // unlocked the chest and found a plushy
      case "yJRrAJ": // opened the chest and found a plushy
        if (!held(player, PLUSHY_ITEM_ID)) {
          player.getInventory().adds(PLUSHY_ITEM_ID, 1);
        }
        return;
      case "dYtaJi": // sabotaged the lily pad
        return;
      case "6_EtxY": // placed the plushy in the dung
        if (held(player, PLUSHY_ITEM_ID)) {
          player.getInventory().deleteNumber(PLUSHY_ITEM_ID, 1);
        }
        advance(player, STAGE_PLANTED);
        spawnCuthbert(player);
        return;
      default:
        return;
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId, kind } = event;
    if (!player || !stepId || !OWNED_NPC_IDS.has(npcId)) return;
    if (kind === "message") {
      handleMessage(player, stepId);
      return;
    }
    switch (stepId) {
      case "En6MC0":
        event.handled = true;
        return;
      case "l-aVfO":
      case "cmWjC-":
        event.handled = true;
        frogHop(player, stepId, stepId === "cmWjC-");
        return;
      case "OnL648":
        event.handled = true;
        finishHop(player);
        return;
      case "vUhq-Q": // Marcellus checks the dung behind the recorded fade.
        event.handled = true;
        freeze(player); fade(player, true);
        later(player, 4, () => fade(player, false));
        later(player, 6, () => startTranscript(api, player, MARCELLUS_NPC_ID, PAGE,
          "peace-talks-telling-marcellus-of-the-evidence", steps => steps.slice(steps.findIndex(step => step.id === stepId) + 1)));
        later(player, 8, () => player.getPacketSender().closeSubInterface(FADE_UID));
        return;
      default:
        return;
    }
  }

  /** Stage changes carried by the final line of the wiki conversations. */
  function handleDialogueLine(event) {
    const { player, npcId } = event;
    if (!player || !OWNED_NPC_IDS.has(npcId)) return;
    const text = String(event.text ?? "");
    const scene = scenes.get(player);
    const speaker = scene?.actors.get(String(event.step?.speaker ?? "").toLowerCase());
    if (speaker) event.speakerId = speaker.getId();
    else if (HEADS[event.step?.speaker]) event.speakerId = HEADS[event.step.speaker];
    const stage = quest.getStage(player);
    if (text.includes("Please feel free to use my farming patch")) {
      event.before = () => {
        player.setAttribute(PATCH_UNLOCKED_ATTRIBUTE, true);
        player.getPacketSender().sendVarbit(VARBIT_PATCH_UNLOCKED, 1);
      };
    }
    if (BLUE_FROG_NPC_IDS.has(npcId)) {
      if (stage === STAGE_STARTED && text.includes("Okay, I'll be back shortly")) {
        event.before = () => advance(player, STAGE_FROGS);
      } else if (stage === STAGE_LEADER && text.includes("I'm off to sabotage a lily pad")) {
        event.before = () => advance(player, STAGE_ELECTION);
      } else if (stage === STAGE_DEMOCRACY_DONE && text.includes("Let's!")) {
        event.after = () => beginHop(player);
      } else if (stage === STAGE_TERMS && text.includes("I'll take these terms to him")) {
        event.before = () => advance(player, STAGE_PROOF);
      } else if (stage === STAGE_BLAME && text === "Fine.") {
        event.before = () => advance(player, STAGE_STEAL);
      } else if (stage === STAGE_ACCEPTED && text.includes("true hero")) {
        event.after = () => { if (!quest.isComplete(player)) quest.complete(player); };
      }
      return;
    }
    if (MARCELLUS_NPC_IDS.has(npcId) || npcId === CUTSCENE_MARCELLUS_NPC_ID) {
      if (stage === 0 && text.startsWith("Okay then... Well provided")) {
        event.before = () => {
          if (!acceptedStarts.has(player) || !meetsRequirements(player)) return;
          acceptedStarts.delete(player);
          quest.setStage(player, STAGE_STARTED);
          player.sendMessage(`You've started a new quest: <col=081190>${PAGE}</col>`);
        };
      } else if (stage === STAGE_FROGS && text.includes("I'll go and ask them about their leader")) {
        event.before = () => advance(player, STAGE_LEADER);
      } else if (stage === STAGE_PROOF && text.includes("Fine, I'll find this proof")) {
        event.before = () => advance(player, STAGE_BLAME);
      } else if (stage === STAGE_CUTHBERT_DEAD && text.includes("Tell them we have a deal")) {
        event.before = () => advance(player, STAGE_ACCEPTED);
      }
      return;
    }
    if (YELLOW_FROG_NPC_IDS.has(npcId)) {
      if (stage === STAGE_ELECTION && text === "Hmm...") event.before = () => advance(player, STAGE_TREE);
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK) return;
    if (!MARCELLUS_NPC_IDS.has(npcId) && npcId !== CUTSCENE_MARCELLUS_NPC_ID) return;
    if (quest.getStage(player) !== 0) return;
    if (!meetsRequirements(player)) return;
    resetRunState(player);
    acceptedStarts.add(player);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemAction(event) {
    if (!event || event.handled || event.itemId !== LOVE_LETTER_ITEM_ID) return;
    if (event.option !== undefined ? event.option !== "Read" : event.clickType !== 1) return;
    event.handled = true;
    // shortcut: the capture skips reading this letter; verify its native layout when captured.
    for (const line of LOVE_LETTER_LINES) event.player.sendMessage(line);
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function handleLilyPad(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_ELECTION || stage > STAGE_SABOTAGED) return;
    event.handled = true;
    if (stage < STAGE_SABOTAGED) {
      startTranscript(api, player, JANE_NPC_ID, PAGE, "democracy-at-work-attempting-to-sabotage-the-lily-pad");
      return;
    }
    if (scenes.has(player) || actions.has(player)) return;
    actions.add(player);
    player.performAnimation(new Animation(827));
    controls(player, true);
    StatementDialogue.send(player, "You pick up a small stone from the shore and throw it at the lily pad. It leaves a barely noticeable hole in it.", false);
    later(player, 1, () => player.getPacketSender().sendSoundEffect(2708, 1, 20));
    later(player, 2, () => player.performAnimation(new Animation(385)));
    later(player, 4, () => {
      actions.delete(player);
      advance(player, STAGE_DEMOCRACY_DONE); controls(player, false);
      startTranscript(api, player, MARCELLUS_NPC_ID, PAGE, "democracy-at-work-sabotaging-the-lily-pad");
    });
  }

  function handleOrangeTree(event) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_TREE) return;
    event.handled = true;
    if (!hasAxe(player)) {
      player.sendMessage("You need an axe to chop this tree.");
      return;
    }
    if (actions.has(player)) return;
    actions.add(player);
    controls(player, true);
    player.performAnimation(new Animation(879));
    later(player, 4, () => {
      actions.delete(player);
      player.performAnimation(new Animation(-1));
      player.getPacketSender().sendSoundEffect(2734, 1, 0);
      advance(player, STAGE_SABOTAGED); controls(player, false);
      startTranscript(api, player, JANE_NPC_ID, PAGE, "democracy-at-work-after-chopping-down-the-orange-tree");
    });
  }

  function handleBed(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_STEAL || stage > STAGE_PLANTED) return;
    event.handled = true;
    startTranscript(api, player, MARCELLUS_NPC_ID, PAGE, "peace-talks-searching-marcellus-bed");
  }

  function handleChest(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_STEAL) return;
    event.handled = true;
    if (stage >= STAGE_PLANTED) {
      startTranscript(api, player, MARCELLUS_NPC_ID, PAGE, "peace-talks-opening-the-chest-after-planting-the-evidence");
      return;
    }
    if (stage >= STAGE_CHEST) {
      startTranscript(api, player, MARCELLUS_NPC_ID, PAGE, "peace-talks-opening-the-chest-after-unlocking-it");
      return;
    }
    const sender = player.getPacketSender();
    sender.sendInterface(CHEST_INTERFACE).sendInterfaceScript(6963, [
      (CHEST_INTERFACE << 16) | 1, (CHEST_INTERFACE << 16) | 4, 5, CHEST_CODE_ROW, 1, -1,
    ]);
    pendingChests.set(player, player.getLocation().clone());
    player.setEnteredAmountAction({ execute: code => unlockChest(player, code) });
  }
  function unlockChest(player, code) {
    const origin = pendingChests.get(player);
    pendingChests.delete(player);
    if (!origin || quest.getStage(player) !== STAGE_STEAL || player.getLocation().getDistance(origin) > 1) return;
    player.getPacketSender().sendInterfaceRemoval();
    if (code !== NALIA_CODE) { player.sendMessage("The combination doesn't seem to work."); return; }
    if (player.getInventory().isFull()) { player.sendMessage("You don't have enough inventory space."); return; }
    advance(player, STAGE_CHEST);
    player.performAnimation(new Animation(536, 10));
    player.getPacketSender().sendSoundEffect(2419, 1, 0).sendSoundEffect(52, 1, 10);
    later(player, 1, () => {
      startTranscript(api, player, MARCELLUS_NPC_ID, PAGE, "peace-talks-unlocking-marcellus-chest");
      player.getPacketSender().sendObject(new GameObject(50896, new Location(1676, 2974, 0), 10, 1, player.getPrivateArea()));
      player.getPacketSender().sendSoundEffect(51, 1, 45);
    });
    later(player, 3, () => player.getPacketSender().sendObject(new GameObject(CHEST_OBJECT_ID, new Location(1676, 2974, 0), 10, 1, player.getPrivateArea())));
  }

  function handleDung(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_STEAL || stage > STAGE_CHEST) return;
    event.handled = true;
    if (held(player, PLUSHY_ITEM_ID)) {
      player.performAnimation(new Animation(827));
      controls(player, true);
      later(player, 1, () => {
        controls(player, false);
        player.getPacketSender().sendSoundEffect(2285, 1, 0);
        startTranscript(api, player, CUTHBERT_COMBAT_NPC_ID, PAGE, "peace-talks-planting-the-plushy");
      });
      return;
    }
    if (held(player, LOVE_LETTER_ITEM_ID)) {
      startTranscript(api, player, CUTHBERT_COMBAT_NPC_ID, PAGE, "peace-talks-attempting-to-plant-the-letter");
      return;
    }
    startTranscript(api, player, CUTHBERT_COMBAT_NPC_ID, PAGE, "peace-talks-planting-without-evidence");
  }

  /** The quest's own "Logs" at the Locus Oasis; the id is also scenery elsewhere. */
  function handleLogs(event) {
    const { player, location } = event;
    if (!location || location.x !== LOCUS_LOGS_TILE.x || location.y !== LOCUS_LOGS_TILE.y
      || (location.z ?? 0) !== LOCUS_LOGS_TILE.z) {
      return;
    }
    event.handled = true;
    if (held(player, BRONZE_AXE_ITEM_ID) || wearingAxe(player)) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need some free inventory space to take the axe.");
      return;
    }
    player.getInventory().adds(BRONZE_AXE_ITEM_ID, 1);
    player.getPacketSender().sendSoundEffect(2733, 1, 0);
    StatementDialogue.send(player, "You take a bronze axe from the logs.");
  }

  // ==========================================================================
  // Login
  // ==========================================================================

  function markStageVersion({ player, key }) {
    if (key === QUEST_KEY) player.setAttribute(STAGE_VERSION_ATTRIBUTE, 1);
  }
  function handleLogin({ player }) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) !== 1) {
      const stage = quest.getStage(player);
      const migrated = stage >= 24 ? Math.min(STAGE_COMPLETE, stage + 2)
        : stage === STAGE_STEAL && player.getAttribute(LEGACY_CHEST_ATTRIBUTE) === true ? STAGE_CHEST
        : stage === STAGE_HOP_OFF ? STAGE_DEMOCRACY_DONE : stage;
      if (migrated !== stage) quest.setStage(player, migrated);
      player.setAttribute(STAGE_VERSION_ATTRIBUTE, 1);
      player.setAttribute(LEGACY_CHEST_ATTRIBUTE, false);
    }
    // Saves completed before the reward wrote the patch flag still own the patch.
    if (quest.isComplete(player) && player.getAttribute(PATCH_UNLOCKED_ATTRIBUTE) !== true) {
      player.setAttribute(PATCH_UNLOCKED_ATTRIBUTE, true);
    }
    player.getPacketSender().sendVarbit(VARBIT_PATCH_UNLOCKED, player.getAttribute(PATCH_UNLOCKED_ATTRIBUTE) === true ? 1 : 0);
    refreshQuestList(player);
    ensureCuthbert(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    cleanScene(player, false);
    pendingChests.delete(player);
    actions.delete(player);
    acceptedStarts.delete(player);
    const key = playerTasks.get(player); if (key) TaskManager.cancelTasks(key);
    controls(player, false);
    removeCuthbert(player);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Marcellus and the frogs of the Locus Oasis make peace,</str>",
        "<str>and earned access to a new hardwood Farming patch.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ACCEPTED) {
      return [
        "Marcellus accepted the frogs' peace terms.",
        "I should let <col=800000>Sue and Gary</col> know.",
      ];
    }
    if (stage >= STAGE_CUTHBERT_DEAD) {
      return [
        "I defeated Cuthbert, Lord of Dread.",
        "I should tell <col=800000>Marcellus</col> about the plushy in the dung.",
      ];
    }
    if (stage >= STAGE_PLANTED) {
      return [
        "I planted the plushy in the capybara dung, and Cuthbert attacked me.",
        "I must defeat <col=800000>Cuthbert, Lord of Dread</col>.",
      ];
    }
    if (stage >= STAGE_STEAL) {
      return [
        "Sue and Gary suggested planting something of Marcellus' on the flies.",
        "I should search <col=800000>Marcellus' bed and chest</col> in his house for",
        "something to steal, then plant it in the <col=800000>capybara dung</col>.",
      ];
    }
    if (stage >= STAGE_BLAME) {
      return [
        "Marcellus wants proof that the flies are a threat.",
        "I should ask <col=800000>Sue and Gary</col> for suggestions.",
      ];
    }
    if (stage >= STAGE_PROOF) {
      return [
        "Sue gave me her peace terms: the frogs deal with the flies in return",
        "for oranges. <col=800000>Marcellus</col> wants proof first.",
      ];
    }
    if (stage >= STAGE_TERMS) {
      return [
        "Cuthbert sank during the hop-off and Sue won the election.",
        "Sue gave me peace terms to take to <col=800000>Marcellus</col>.",
      ];
    }
    if (stage >= STAGE_DEMOCRACY_DONE) {
      return [
        "The lily pad is sabotaged.",
        "I should let <col=800000>Sue and Gary</col> know so the election can begin.",
      ];
    }
    if (stage >= STAGE_SABOTAGED) {
      return [
        "The orange tree is down.",
        "Now I can sabotage the <col=800000>lily pad</col> unnoticed.",
      ];
    }
    if (stage >= STAGE_TREE) {
      return [
        "The frogs will hold an election, but Cuthbert will start a war if he wins.",
        "I need to sabotage his lily pad; I should chop the",
        "<col=800000>orange tree</col> by Dave and Jane to distract them.",
      ];
    }
    if (stage >= STAGE_ELECTION) {
      return [
        "Sue and Gary want me to sabotage Cuthbert's lily pad before the",
        "election, without Dave and Jane seeing me.",
      ];
    }
    if (stage >= STAGE_LEADER) {
      return [
        "Marcellus will only negotiate with the frogs' leader.",
        "I should ask the frogs if they have one.",
      ];
    }
    if (stage >= STAGE_FROGS) {
      return [
        "The frogs can talk, and they are on strike rather than plotting",
        "against humanity. They agreed to peace talks; I should return",
        "to <col=800000>Marcellus</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Marcellus at the Locus Oasis believes the frogs are planning to",
        "overthrow humanity. I agreed to investigate them.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Marcellus</col> at the",
      "<col=800000>Locus Oasis</col> south of Civitas illa Fortis.",
      "",
      "I need level 15 Woodcutting and to have completed Children of the Sun.",
    ];
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.WOODCUTTING, 2000);
    // The hardwood patch is a completion reward, not a post-quest conversation unlock.
    player.setAttribute(PATCH_UNLOCKED_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_PATCH_UNLOCKED, 1);
  }
  function canUsePatch(event) {
    const { player, patch } = event;
    if (patch.id !== HARDWOOD_PATCH_ID || player.getAttribute(PATCH_UNLOCKED_ATTRIBUTE) === true) return;
    event.allowed = false;
    startTranscript(api, player, MARCELLUS_NPC_ID, PAGE, quest.isComplete(player)
      ? "post-quest-dialogue-talking-to-marcellus"
      : "crazy-frogs-talking-to-marcellus-without-the-requirements-to-start-interacting-with-the-hardwood-patch");
  }

  api.persistAttribute(LEGACY_CHEST_ATTRIBUTE, false); // Read once when migrating existing saves.
  api.persistAttribute(PATCH_UNLOCKED_ATTRIBUTE, false);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: QUEST_KEY,
    name: "The Ribbiting Tale of a Lily Pad Labour Dispute",
    varpId: 4152,
    varbitId: 9844,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.WOODCUTTING.getIndex(), amount: 2000, label: "Woodcutting" }],
    otherRewards: ["Access to a new Hardwood Farming patch"],
    buildJournal,
    onReward: grantReward,
  });

  api.onCustomEvent("farming:can-use-patch", canUsePatch);
  api.onCustomEvent("quest:stage-changed", markStageVersion);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onItemAction(handleItemAction);
  api.onObjectClick([LILY_PAD_MULTILOC_ID, ObjectIdentifiers.LILY_PAD_2], 1, handleLilyPad);
  api.onObjectClick([ORANGE_TREE_MULTILOC_ID, ObjectIdentifiers.ORANGE_TREE_16], 1, handleOrangeTree);
  api.onObjectClick([BED_MULTILOC_ID, ObjectIdentifiers.BED_219], 1, handleBed);
  api.onObjectClick([DUNG_MULTILOC_ID, ObjectIdentifiers.CAPYBARA_DUNG_2], 1, handleDung);
  api.onObjectClick(CHEST_OBJECT_ID, 1, handleChest);
  api.onObjectClick(LOGS_OBJECT_ID, 1, handleLogs);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
