/**
 * The Heart of Darkness (members).
 *
 * Behaviour follows the complete quest in RSProx recording 1695 (revision 226, ticks 2423-4992);
 * the words come from "The Heart of Darkness" transcript page (OSRS Wiki), the puzzle rules from
 * its walkthrough. Evidence and remaining gaps: docs/p2p-varlamore-group-2-parity.md.
 *
 * Stages live in varbit 11117 "vmq3" (varp 4386, bits 0-6), as captured:
 *
 *   0 not started (Prince Itzla at the Teomat, after Twilight's Promise)
 *   2 started          4 told of the plan       6 the Queen's visit ended
 *   8 sent to the Windbreaker   10 asked for the basement room   12 paid for the room
 *  14 woke to Itzla   16 heard his reasons   18 sent to the shopkeeper
 *  20 the shopkeeper sends word   22 Itzla left for the Twilight Temple
 *  24 met Itzla at the Tower of Ascension   26 spoke to all four recruits
 *  28 Janus calls them in   30 Janus explains the trials   32 the first trial
 *  34 the passphrase   36 the second trial   38 survived   40 the third trial
 *  42 the traitor found   44 the fourth trial   46 Itzla yields   48 sent for the robes
 *  50 robed   52 initiated   54 Itzla's thoughts   56 sent below by Fides
 *  58 in Tapoyauik   60 the blockage mined   62 Itzla knocked across the chasm
 *  64 the four levers pulled   66/68 the frozen door opened   70 Amoxliatl
 *  72 the fight   74 banished   76 complete (Servius at the Sunrise Palace)
 *
 * Side varbits follow the capture: vmq3_itzla_vis (which Itzla is out: 1 the Teomat, 3 the
 * Windbreaker, 4 the tower lobby, 5/6 the tower's inner room, 7 the temple, 8 the ruins),
 * vmq3_recruit_1..4, and the trial and ruins varbits the units set. Itzla's lobby/temple/ruins
 * places, Janus, Fides, the recruits and Servius are the cache's multi-NPCs in npc-spawns.json.
 *
 * Rewards per the capture: 2 Quest points, access to Tapoyauik and 8,000 Mining, Thieving, Slayer
 * and Agility XP.
 */
module.exports = function registerTheHeartOfDarknessQuest(api) {
  const {
    Animation, DialogueChainBuilder, ActionDialogue, ItemIdentifiers, Location, NpcIdentifiers, Skill, StatementDialogue,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "The Heart of Darkness";
  const QUEST_KEY = "the_heart_of_darkness";
  const START_HOOK = "quest:the-heart-of-darkness:start";
  const TWILIGHTS_PROMISE_KEY = "twilights_promise";
  const PERILOUS_MOONS_KEY = "perilous_moons";

  const VARP_HEART_OF_DARKNESS = 4386;
  const STAGE_VARBIT = 11117;
  const RECRUIT_VARBITS = [11118, 11119, 11120, 11121];
  const ITZLA_VIS_VARBIT = 11123;
  const SERVIUS_PALACE_VARBIT = 16668; // vmq4_servius_palace_vis: the Sunrise Palace Servius (multi-NPC 14054)

  const S = {
    STARTED: 2, PLAN: 4, QUEEN_LEFT: 6, TO_GORGE: 8, BASEMENT: 10, PAID: 12, WOKE: 14, REASONS: 16, TO_SHOP: 18,
    SHOP_AGREED: 20, ITZLA_LEFT: 22, TOWER: 24, MINGLED: 26, CALLED: 28, TRIALS_EXPLAINED: 30, TRIAL_1: 32,
    PASSPHRASE: 34, TRIAL_2: 36, SURVIVED: 38, TRIAL_3: 40, TRAITOR: 42, TRIAL_4: 44, YIELDED: 46, ROBES: 48,
    ROBED: 50, INITIATED: 52, THOUGHTS: 54, BELOW: 56, RUINS: 58, MINED: 60, CHASM: 62, LEVERS: 64,
    DOOR_OPEN: 68, AMOXLIATL: 70, FIGHT: 72, BANISHED: 74, COMPLETE: 76,
  };

  const NPC = {
    ITZLA_TEOMAT: NpcIdentifiers.PRINCE_ITZLA_ARKAN_3, // 12896, the Teomat (Twilight's Promise's multi-NPC 13379)
    ITZLA: 13690, // vmq3_itzla_vis_citizen: disguised (the Windbreaker, the tower lobby, following)
    ITZLA_ROBED: 13691, // vmq3_itzla_vis_cultist: in the Emissaries' robes
    ITZLA_FOLLOWER: 14053, // vmq3_itzla_follower: 13690, robed from stage 49
    ITZLA_QUEEN: 13692, // vmq3_itzla_cutscene
    ITZLA_CULTIST_ACTOR: 13693, // vmq3_itzla_cultist_cutscene
    QUEEN: 13695,
    KUALTI: [13696, 13697, 13698, 13699],
    BARTENDER: 14020,
    SHOPKEEPER: 14021,
    FELIUS: 13700, CARITTA: 13701, SERGIUS: 13702, NOVA: 13704,
    SERGIUS_JOINED: 13703, NOVA_JOINED: 13705,
    JANUS: 13714,
    FIDES: 13715, FIDES_ACTOR: 13716,
    METZLI_ACTOR: 13717, FURIA_ACTOR: 13718, ENNIUS_ACTOR: 13719,
    TEMPLE_GUARDS: [13708, 13709],
    TEMPLE_ACTOR_GUARDS: [13710, 13711, 13712, 13713],
    RUINS_GUARDS: [13720, 13721],
    SERVIUS: 13694,
  };
  const RECRUITS = [NPC.FELIUS, NPC.CARITTA, NPC.SERGIUS, NPC.NOVA];

  const ITEM = {
    COINS: ItemIdentifiers.COINS,
    COINS_BOX: 1000, // the coin pile the capture's item box shows
    ROBES: [29868, 29870, 29872, 29874], // Emissary hood, robe top, robe bottom, sandals
  };
  const ROBE_FEE = 30;
  const ROBES_CHEST_ID = 54515;
  const BED_ID = 54513; // the Windbreaker bed while the room is rented (multi-loc 55374)
  const BED_MULTI_ID = 55374;
  const TOWER_STAIRS_ID = 54369;
  const RUINS_STAIRS_ID = 54525;

  const V = {
    START: "starting-the-quest-talking-to-prince-itzla-arkan",
    QUEEN: "meeting-with-queen-zyani-arkan-to-begin-planning-the-infiltration",
    AFTER_QUEEN: "meeting-with-queen-zyani-arkan-to-begin-planning-the-infiltration-talking-to-prince-itzla-arkan-after-meeting-with-queen-zyani-arkan",
    AFTER_QUEEN_AGAIN: "meeting-with-queen-zyani-arkan-to-begin-planning-the-infiltration-talking-to-prince-itzla-arkan-after-meeting-with-queen-zyani-arkan-talking-to-itzla-again",
    BARTENDER: "visiting-the-windbreaker-bar-talking-to-the-bartender-at-quetzacalli-gorge",
    BED: "visiting-the-windbreaker-bar-resting-in-the-bed",
    BED_AGAIN: "visiting-the-windbreaker-bar-resting-in-the-bed-talking-to-itzla-again-before-fully-going-through-the-initial-dialogue",
    PUB_ITZLA: "visiting-the-windbreaker-bar-resting-in-the-bed-talking-to-itzla-again",
    SHOP: "talking-to-the-quetzacalli-gorge-shopkeeper",
    SHOP_AGAIN: "talking-to-the-quetzacalli-gorge-shopkeeper-talking-to-him-again-after-getting-directions-to-the-twilight-temple",
    REPORT: "talking-to-the-quetzacalli-gorge-shopkeeper-reporting-back-to-prince-itzla-arkan",
    TOWER: "talking-to-prince-itzla-arkan",
    TOWER_AGAIN: "talking-to-prince-itzla-arkan-talking-to-itzla-again",
    NOVA: "talking-to-prince-itzla-arkan-talking-to-nova",
    CARITTA: "talking-to-prince-itzla-arkan-talking-to-caritta",
    FELIUS: "talking-to-prince-itzla-arkan-talking-to-felius",
    SERGIUS: "talking-to-prince-itzla-arkan-talking-to-sergius",
    REPORT_AUGUR: "talking-to-prince-itzla-arkan-reporting-back-to-prince-itzla-arkan",
    JANUS: "descending-into-the-tower-of-ascension",
    JANUS_STAIRS_EARLY: "descending-into-the-tower-of-ascension-attempting-to-climb-up-before-speaking-to-janus",
    JANUS_AGAIN: "descending-into-the-tower-of-ascension-speaking-to-forebearer-janus-again",
    JANUS_RESTART: "descending-into-the-tower-of-ascension-speaking-to-forebearer-janus-in-the-lobby-after-restarting-or-failing-some-trials",
    JANUS_CHEST: "descending-into-the-tower-of-ascension-attempting-to-open-the-chest-in-the-lobby-without-permission",
    STAIRS_DONE: "descending-into-the-tower-of-ascension-attempting-to-head-back-up-the-stairs",
    ITZLA_LOBBY: "descending-into-the-tower-of-ascension-speaking-to-prince-itzla-in-the-lobby",
    JANUS_LOBBY: "descending-into-the-tower-of-ascension-speaking-to-forebearer-janus-in-the-lobby",
    JANUS_LOBBY_AGAIN: "descending-into-the-tower-of-ascension-speaking-to-forebearer-janus-in-the-lobby-speaking-to-forebearer-janus-again",
    ITZLA_ROBES_FIRST: "descending-into-the-tower-of-ascension-talking-to-prince-itzla-after-talking-to-forebearer-janus",
    ITZLA_ROBED: "descending-into-the-tower-of-ascension-talking-to-prince-itzla-after-getting-the-robes",
    JANUS_ROBED: "descending-into-the-tower-of-ascension-talking-to-forebearer-janus-after-getting-the-robes",
    CHEST: "descending-into-the-tower-of-ascension-searching-the-chest",
    CHEST_FULL: "descending-into-the-tower-of-ascension-searching-the-chest-without-enough-inventory-space",
    CHEST_RECLAIM: "descending-into-the-tower-of-ascension-reclaiming-the-robes-if-they-re-lost",
    CHEST_EMPTY: "descending-into-the-tower-of-ascension-searching-the-chest-with-the-robes",
    NO_ROBES: "descending-into-the-tower-of-ascension-attempting-to-enter-the-twilight-temple-without-the-robes-on",
    INITIATION: "initiation",
    FIDES_EARLY: "initiation-talking-to-fides-before-itzla-after-the-initiaion",
    ITZLA_TEMPLE: "initiation-talking-to-prince-itzla-after-the-initiation",
    ITZLA_TEMPLE_AGAIN: "initiation-talking-to-prince-itzla-after-the-initiation-talking-to-itzla-again-before-fides",
    FIDES: "initiation-talking-to-forebearer-fides",
    FIDES_AGAIN: "initiation-talking-to-forebearer-fides-talking-to-fides-again",
    ITZLA_BELOW: "initiation-talking-to-forebearer-fides-talking-to-prince-itzla-after-fides",
    RUINS_GUARD: "initiation-talking-to-forebearer-fides-talking-to-the-emissary-ascended-by-the-entrance-to-tapoyauik",
    RUINS_GUARD_ALONE: "initiation-talking-to-forebearer-fides-talking-to-the-emissary-ascended-by-the-entrance-to-tapoyauik-trying-to-descend-without-itzla",
    SERVIUS: "heart-of-the-ruins-talking-to-servius-teokan-of-ralos",
    RUINS_AGAIN: "heart-of-the-ruins-attempting-to-re-enter-the-ruins",
    TOWER_AGAIN_DONE: "heart-of-the-ruins-attempting-to-climb-the-tower-again",
  };

  const LINE = {
    PLAN: "Right...",
    QUEEN_ARRIVES: "Ah... This should be fun.",
    TO_GORGE: "One of the only people left that I can trust. They'll fill you in on the details of how you'll infiltrate the Emissaries. Good luck, [player name]. May the sun light your way.",
    BASEMENT: "We don't have a basement room... but I do have a nice big one here on the ground floor that's available. It's 30 coins for the night.",
    BASEMENT_AGAIN: "Like I said, we don't have a basement room. However, I do have a nice big one here on the ground floor that's available. It's 30 coins for the night.",
    REASONS: "Okay, I'm still not sure if I like this plan, but I see your point. What's our next move?",
    TO_SHOP: "Exactly! Return to me here once you've hopefully been successful and we can discuss the next steps.",
    SHOP_AGREED: "Well... if you're sure, fetch your friend and then head east to the Twilight Temple. I will send word for them to expect you both.",
    TOWER: "Unlikely, but it would be interesting to know why they woke up one day and decided their calling in life was to join a cult.",
    RECRUITS: ["Fair enough.", "And you!", "I hope so.", "I see. Thanks for the information."],
    CALLED: "Itzlan. [player name]. It is time for you to prove your worth. Enter the tower when you're ready.",
    TRIALS_EXPLAINED: "When you are ready to begin, climb the stairs. Your first trial awaits.",
    ROBES: "Now the Augur herself will oversee your initiation. You may collect your new robes from that chest over there. Put them on and proceed into the temple.",
    THOUGHTS: "Let's have a chat to this Forebearer Fides about our new duties. Whatever they are, hopefully they give us a chance to learn more.",
    BELOW: "We'll get right to it!",
    COMPLETE: "Timoiva, my child, and may the sun light your way.",
  };

  const STEP = {
    QUEEN_BEGINS: "I1YBht",
    QUEEN_ENDS: "TRlXF8",
    PAY: "j4EUkz",
    SLEEP: "UAiNxn",
    DEPARTS: "k39z5U",
    ROBES: "ZDjr4J",
    ROBES_RECLAIM: "eXuLCT",
    METZLI_WALKS: "r78zhY",
    TWINS_WALK: "Edntey",
  };

  const STAGE_VERSION_ATTRIBUTE = "the-heart-of-darkness:stage-version";
  const STAGE_VERSION = 1;
  const RECRUITS_ATTRIBUTE = "the-heart-of-darkness:recruits";
  const FLAGS_ATTRIBUTE = "quest.the_heart_of_darkness.flags";
  const FLAG_RENT_ASKED = 1 << 0;

  // Scenes at the captured tiles.
  const TEOMAT_BOUNDS = [[1425, 1465, 3160, 3200, 0]];
  const BAR_BOUNDS = [[1495, 1512, 3218, 3232, 0]];
  const TEMPLE_BOUNDS = [[1672, 1700, 3238, 3258, 0]];
  const LOBBY_TILE = [1637, 3221, 0];
  const PALACE_TILE = [1681, 3135, 0];

  let quest;
  const followers = new Map();
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded });
  const units = {};

  // ==========================================================================
  // State
  // ==========================================================================

  const stage = (player) => quest.getStage(player);
  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const flags = (player) => Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;

  function advance(player, value) {
    if (stage(player) < value) quest.setStage(player, value);
    syncSideVarbits(player);
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return skills.getMaxLevel(Skill.MINING) >= 55 && skills.getMaxLevel(Skill.THIEVING) >= 48
      && skills.getMaxLevel(Skill.SLAYER) >= 48 && skills.getMaxLevel(Skill.AGILITY) >= 46
      && isQuestComplete(player, TWILIGHTS_PROMISE_KEY);
  }

  function recruitBits(player) {
    return Number(player.getAttribute(RECRUITS_ATTRIBUTE)) || 0;
  }

  /** Which Itzla is out (vmq3_itzla_vis), as the capture sets it by stage. */
  function itzlaVis(player) {
    const current = stage(player);
    if (current < S.BASEMENT) return 1;
    if (current < S.WOKE) return 0;
    if (current < S.ITZLA_LEFT) return 3;
    if (current < S.CALLED) return 4;
    if (current >= S.INITIATED && current < S.THOUGHTS) return 7;
    if (current >= S.MINED && current < S.AMOXLIATL) return 8;
    return 0;
  }

  function syncSideVarbits(player, override = null) {
    const sender = player.getPacketSender();
    if (stage(player) > 0 || isQuestComplete(player, TWILIGHTS_PROMISE_KEY)) sender.sendVarbit(ITZLA_VIS_VARBIT, override ?? itzlaVis(player));
    const bits = recruitBits(player);
    RECRUIT_VARBITS.forEach((varbit, index) => sender.sendVarbit(varbit, (bits >> index) & 1));
    // Servius stays visible at the palace after this quest so The Final Dawn can
    // offer its start from the cache-transformed 13694/14377 npc. The old
    // completion value 0 hid the only Talk-to variant (start-probe-4).
    if (stage(player) >= S.BANISHED) sender.sendVarbit(SERVIUS_PALACE_VARBIT, 1);
    units.tower?.syncVarbits(player);
    units.ruins?.syncVarbits(player);
  }

  function variantSteps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  function locate(steps, id) {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step?.id === id) return { list: steps, index };
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = Array.isArray(nested) ? locate(nested, id) : null;
        if (found) return found;
      }
    }
    return null;
  }

  function after(id) {
    return (steps) => {
      const found = locate(steps, id);
      return found ? found.list.slice(found.index + 1) : [];
    };
  }

  function play(player, npcId, variant, transform = null, npc = null) {
    startTranscript(api, player, npcId, PAGE, variant, transform, npc);
  }

  /** A statement the player can't continue (a held moment under a fade). */
  function heldStatement(player, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, text, false) })
    ));
  }

  const shared = {
    api, PAGE, S, NPC, Scenes, play, after, locate, variantSteps, advance, held, stage,
    get quest() { return quest; },
    syncSideVarbits, heldStatement, startFollowing, stopFollowing, follower,
  };
  units.tower = require("../hod/Tower.TheHeartOfDarkness")(shared);
  units.ruins = require("../hod/Ruins.TheHeartOfDarkness")(shared);

  // ==========================================================================
  // Itzla, following
  // ==========================================================================

  function follower(player) {
    const npc = followers.get(player);
    return npc?.isRegistered?.() ? npc : null;
  }

  /** Itzla follows (14053, robed from stage 49) where the capture shows him behind the player. */
  function startFollowing(player, at = null) {
    if (follower(player)) return follower(player);
    const tile = at ?? player.getLocation();
    const npc = api.spawnNpc({ id: NPC.ITZLA_FOLLOWER, x: tile.getX?.() ?? tile[0], y: tile.getY?.() ?? tile[1], z: tile.getZ?.() ?? tile[2] ?? 0,
      owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.setFollowing(player);
    npc.setMobileInteraction(player);
    followers.set(player, npc);
    return npc;
  }

  function stopFollowing(player) {
    const npc = followers.get(player);
    followers.delete(player);
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  }

  /** Itzla follows from Janus's call until the trials, after them until the initiation, and below. */
  function shouldFollow(player) {
    const current = stage(player);
    const where = player.getLocation();
    const inTower = Scenes.get(player) || units.tower.inTrial(player);
    if (inTower) return false;
    if (current >= S.CALLED && current < S.TRIAL_1) return true;
    if (current >= S.YIELDED && current < S.INITIATED) return where.getZ() === 0;
    if (current >= S.THOUGHTS && current < S.MINED) return true;
    return false;
  }

  function tickFollower(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const want = shouldFollow(player);
    const npc = follower(player);
    if (want && !npc) startFollowing(player);
    else if (!want && npc) stopFollowing(player);
    else if (npc) {
      const here = player.getLocation(), there = npc.getLocation();
      if (here.getZ() !== there.getZ() || Math.max(Math.abs(here.getX() - there.getX()), Math.abs(here.getY() - there.getY())) > 12) {
        npc.moveTo(new Location(here.getX(), here.getY(), here.getZ()));
      }
    }
  }

  // ==========================================================================
  // Variants
  // ==========================================================================

  function selectVariant({ npcId, player, npc }) {
    if (!player) return null;
    const current = stage(player);
    if (npcId === NPC.ITZLA_TEOMAT) {
      if (!isQuestComplete(player, TWILIGHTS_PROMISE_KEY)) return null;
      if (current === 0) return V.START;
      if (current < S.QUEEN_LEFT) return V.QUEEN;
      if (current < S.TO_GORGE) return V.AFTER_QUEEN;
      if (current < S.BASEMENT) return V.AFTER_QUEEN_AGAIN;
      return null;
    }
    if (npcId === NPC.ITZLA || npcId === NPC.ITZLA_ROBED) return selectItzlaVariant(player, npc);
    if (npcId === NPC.BARTENDER) return current >= S.TO_GORGE && current < S.WOKE ? V.BARTENDER : null;
    if (npcId === NPC.SHOPKEEPER) {
      if (current === S.TO_SHOP) return V.SHOP;
      return current >= S.SHOP_AGREED && current < S.ITZLA_LEFT ? V.SHOP_AGAIN : null;
    }
    const recruit = RECRUITS.indexOf(npcId);
    if (recruit >= 0) return [V.FELIUS, V.CARITTA, V.SERGIUS, V.NOVA][recruit];
    if (npcId === NPC.JANUS) return selectJanusVariant(player);
    if (npcId === NPC.FIDES) {
      if (current < S.INITIATED) return null;
      if (current === S.INITIATED) return V.FIDES_EARLY;
      return current === S.THOUGHTS ? V.FIDES : V.FIDES_AGAIN;
    }
    if (NPC.RUINS_GUARDS.includes(npcId) && current >= S.BELOW && current < S.RUINS) return V.RUINS_GUARD;
    if (npcId === NPC.SERVIUS && current === S.BANISHED) return V.SERVIUS;
    return units.tower.selectVariant({ npcId, player, npc }) ?? units.ruins.selectVariant({ npcId, player, npc });
  }

  /** The Teomat/lobby/temple Itzla ids are absent from npc-dialogue-index, so name routing
   * would play the generic "Prince Itzla Arkan" page and miss this quest's line hooks. */
  function talkToItzla(event) {
    const npcId = event.npcId ?? event.npc?.getId?.();
    if (npcId !== NPC.ITZLA_TEOMAT && npcId !== NPC.ITZLA && npcId !== NPC.ITZLA_ROBED) return false;
    if (npcId !== NPC.ITZLA_TEOMAT && stage(event.player) === 0) return false;
    const variant = selectVariant({ player: event.player, npcId, npc: event.npc });
    if (!variant) return false;
    event.handled = true;
    play(event.player, npcId, variant, null, event.npc);
    return true;
  }

  function selectItzlaVariant(player, npc) {
    const current = stage(player);
    const tower = units.tower.selectVariant({ npcId: NPC.ITZLA, player, npc });
    if (tower) return tower;
    if (current < S.REASONS) return V.BED_AGAIN;
    if (current < S.ITZLA_LEFT) return current === S.SHOP_AGREED ? V.REPORT : V.PUB_ITZLA;
    if (current === S.ITZLA_LEFT) return V.TOWER;
    if (current === S.TOWER) return V.TOWER_AGAIN;
    if (current === S.MINGLED) return V.REPORT_AUGUR;
    if (current < S.YIELDED) return null;
    if (current === S.YIELDED) return V.ITZLA_LOBBY;
    if (current === S.ROBES) return V.ITZLA_ROBES_FIRST;
    if (current === S.ROBED) return V.ITZLA_ROBED;
    if (current === S.INITIATED) return V.ITZLA_TEMPLE;
    if (current === S.THOUGHTS) return V.ITZLA_TEMPLE_AGAIN;
    if (current === S.BELOW) return V.ITZLA_BELOW;
    return units.ruins.selectVariant({ npcId: NPC.ITZLA, player, npc });
  }

  function selectJanusVariant(player) {
    const current = stage(player);
    if (current < S.CALLED) return null;
    if (current === S.CALLED) return V.JANUS;
    if (current < S.YIELDED) return current === S.TRIALS_EXPLAINED ? V.JANUS_AGAIN : V.JANUS_RESTART;
    if (current === S.YIELDED) return V.JANUS_LOBBY;
    if (current === S.ROBES) return V.JANUS_LOBBY_AGAIN;
    return V.JANUS_ROBED;
  }

  function answerCondition(event) {
    if (!Array.isArray(event.pages) || !event.pages.some((page) => page?.page === PAGE)) return null;
    const { player } = event;
    switch (event.stepId) {
      case "PeHbKF": return !meetsRequirements(player);
      case "Ulgxje": return meetsRequirements(player);
      case "MYC58N": return (flags(player) & FLAG_RENT_ASKED) === 0;
      case "mIUNoa": return (flags(player) & FLAG_RENT_ASKED) !== 0;
      case "pJ0LFe": return !held(player, ITEM.COINS, ROBE_FEE);
      case "J075SG": case "B4AnfO": case "IouwJx": case "JSXbIW": return !!follower(player) || stage(player) >= S.CALLED;
      case "pIohia": case "suZuGU": case "Cwnadj": case "AObNnk": return !follower(player) && stage(player) < S.CALLED;
      case "KHOHrE": return !isQuestComplete(player, PERILOUS_MOONS_KEY);
      case "MlylVV": return isQuestComplete(player, PERILOUS_MOONS_KEY);
      default: return units.tower.answerCondition(event) ?? units.ruins.answerCondition(event);
    }
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK || stage(player) !== 0 || !meetsRequirements(player)) return;
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    player.setAttribute(RECRUITS_ATTRIBUTE, 0);
    units.tower.reset(player);
    units.ruins.reset(player);
    quest.setStage(player, S.STARTED);
    syncSideVarbits(player);
    player.sendMessage("You've started a new quest: <col=081190>The Heart of Darkness</col>");
  }

  function handleLine(event) {
    if (!isQuestEvent(event)) return;
    const { player, npcId } = event;
    const text = event.step?.text ?? event.step?.player ?? event.step?.npc ?? event.text;
    const at = (line, minStage, maxStage, action, when = "before") => {
      if (text !== line) return;
      const previous = event[when];
      event[when] = () => {
        previous?.();
        const now = stage(player);
        if (now >= minStage && now <= maxStage) action();
      };
    };
    at(LINE.PLAN, S.STARTED, S.STARTED, () => advance(player, S.PLAN));
    at(LINE.QUEEN_ARRIVES, S.PLAN, S.PLAN, () => beginQueen(player), "after");
    at(LINE.TO_GORGE, S.QUEEN_LEFT, S.QUEEN_LEFT, () => advance(player, S.TO_GORGE));
    at(LINE.BASEMENT, S.TO_GORGE, S.TO_GORGE, () => basementAsked(player));
    at(LINE.BASEMENT_AGAIN, S.TO_GORGE, S.TO_GORGE, () => basementAsked(player));
    at(LINE.REASONS, S.WOKE, S.WOKE, () => advance(player, S.REASONS));
    at(LINE.TO_SHOP, S.REASONS, S.REASONS, () => advance(player, S.TO_SHOP), "after");
    at(LINE.SHOP_AGREED, S.TO_SHOP, S.TO_SHOP, () => advance(player, S.SHOP_AGREED));
    at(LINE.TOWER, S.ITZLA_LEFT, S.ITZLA_LEFT, () => advance(player, S.TOWER), "after");
    LINE.RECRUITS.forEach((line, index) => {
      if (text === line && RECRUITS[index] === npcId) at(line, S.TOWER, S.MINGLED, () => recruitTalked(player, index));
    });
    at(LINE.CALLED, S.MINGLED, S.MINGLED, () => {
      advance(player, S.CALLED);
      startFollowing(player, event.npc?.getLocation?.());
    });
    if (npcId === NPC.JANUS) at(LINE.TRIALS_EXPLAINED, S.CALLED, S.CALLED, () => advance(player, S.TRIALS_EXPLAINED));
    at(LINE.ROBES, S.YIELDED, S.YIELDED, () => advance(player, S.ROBES));
    at(LINE.THOUGHTS, S.INITIATED, S.INITIATED, () => advance(player, S.THOUGHTS));
    if (npcId === NPC.FIDES) at(LINE.BELOW, S.THOUGHTS, S.THOUGHTS, () => advance(player, S.BELOW));
    at(LINE.COMPLETE, S.BANISHED, S.BANISHED, () => quest.complete(player), 'after');
    units.tower.handleLine(event);
    units.ruins.handleLine(event);
  }

  function basementAsked(player) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | FLAG_RENT_ASKED);
    advance(player, S.BASEMENT);
  }

  function recruitTalked(player, index) {
    const bits = recruitBits(player) | (1 << index);
    player.setAttribute(RECRUITS_ATTRIBUTE, bits);
    if (bits === 0b1111) advance(player, S.MINGLED);
    syncSideVarbits(player);
  }

  function isQuestEvent(event) {
    return Array.isArray(event.pages) && event.pages.some((page) => page?.page === PAGE);
  }

  function handleAction(event) {
    if (!isQuestEvent(event)) return;
    const { player, stepId } = event;
    switch (stepId) {
      case STEP.QUEEN_BEGINS:
        event.handled = true;
        return;
      case STEP.QUEEN_ENDS:
        event.handled = true;
        event.end = true;
        endQueen(player);
        return;
      case STEP.PAY:
        event.handled = true;
        if (!held(player, ITEM.COINS, ROBE_FEE) || stage(player) !== S.BASEMENT) { event.end = true; return; }
        player.getInventory().deleteNumber(ITEM.COINS, ROBE_FEE);
        advance(player, S.PAID);
        event.handled = true;
        event.box = { items: [ITEM.COINS_BOX] };
        return;
      case STEP.SLEEP:
        event.handled = true;
        event.end = true;
        sleep(player);
        return;
      case STEP.DEPARTS:
        event.handled = true;
        event.end = true;
        itzlaDeparts(player);
        return;
      case STEP.ROBES:
      case STEP.ROBES_RECLAIM:
        event.handled = true;
        event.end = true;
        takeRobes(player, stepId === STEP.ROBES);
        return;
      case STEP.METZLI_WALKS:
      case STEP.TWINS_WALK:
        event.handled = true;
        event.end = true;
        initiationCue(player, stepId);
        return;
      default:
        units.tower.handleAction(event);
        units.ruins.handleAction(event);
    }
  }

  // ==========================================================================
  // The Queen's visit
  // ==========================================================================

  function beginQueen(player) {
    if (Scenes.get(player)) return;
    Scenes.hold(player);
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    Scenes.later(player, 2, () => {
      const scene = Scenes.open(player, "queen", TEOMAT_BOUNDS);
      Scenes.controls(player, true, true);
      player.moveTo(new Location(1440, 3184, 0));
      Scenes.face(player, [1440, 3183]);
      Scenes.actor(scene, NPC.KUALTI[0], [1439, 3178], [1441, 3178]);
      Scenes.actor(scene, NPC.KUALTI[1], [1440, 3173], [1440, 3175]);
      Scenes.actor(scene, NPC.KUALTI[2], [1442, 3173], [1442, 3175]);
      Scenes.actor(scene, NPC.QUEEN, [1441, 3174], [1441, 3176]);
      Scenes.actor(scene, NPC.KUALTI[3], [1442, 3178], [1440, 3178]);
      scene.itzla = Scenes.actor(scene, NPC.ITZLA_QUEEN, [1441, 3183], [1441, 3181]);
      Scenes.later(scene, 1, () => Scenes.camera(player, [1434, 3171, 740], [1437, 3173, 739]));
      Scenes.later(scene, 2, () => {
        Scenes.fade(player, false);
        scene.itzla?.getMovementQueue().addSteps(new Location(1441, 3176, 0));
      });
      Scenes.later(scene, 10, () => play(player, NPC.ITZLA_TEOMAT, V.QUEEN, after(STEP.QUEEN_BEGINS)));
    });
  }

  function endQueen(player) {
    const scene = Scenes.get(player);
    advance(player, S.QUEEN_LEFT);
    Scenes.hold(player);
    Scenes.fade(player, true);
    scene?.itzla?.getMovementQueue().addSteps(new Location(1441, 3177, 0));
    Scenes.later(scene ?? player, 3, () => {
      Scenes.end(player, false);
      player.moveTo(new Location(1453, 3173, 0));
      Scenes.face(player, [1454, 3173]);
      Scenes.controls(player, true, true);
      Scenes.later(player, 2, () => Scenes.fade(player, false));
      Scenes.later(player, 4, () => {
        Scenes.controls(player, false);
        Scenes.closeFade(player);
        play(player, NPC.ITZLA_TEOMAT, V.AFTER_QUEEN);
      });
    });
  }

  // ==========================================================================
  // The Windbreaker and the shopkeeper
  // ==========================================================================

  function restInBed(event) {
    const id = event.objectId ?? event.definition?.id;
    if (id !== BED_ID && id !== BED_MULTI_ID) return false;
    const { player } = event;
    event.handled = true;
    if (stage(player) !== S.PAID) return true;
    play(player, NPC.ITZLA, V.BED);
    return true;
  }

  /** As captured: the statement and fade out, Itzla in the room four ticks on, then the fade back. */
  function sleep(player) {
    const text = "You lie down on the bed and quickly fall asleep.";
    heldStatement(player, text);
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, 4, () => advance(player, S.WOKE));
    Scenes.later(player, 6, () => {
      Scenes.fade(player, false);
      Scenes.controls(player, false);
      play(player, NPC.ITZLA, V.BED, (steps) => [{ type: "message", text, id: "hod-slept" }, ...after(STEP.SLEEP)(steps)]);
    });
    Scenes.later(player, 8, () => Scenes.closeFade(player));
  }

  /** "Itzla departs.": fade out, he's at the tower three ticks on, and the fade back. */
  function itzlaDeparts(player) {
    const text = "Itzla departs.";
    heldStatement(player, text);
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, 3, () => advance(player, S.ITZLA_LEFT));
    Scenes.later(player, 4, () => {
      Scenes.fade(player, false);
      Scenes.controls(player, false);
      play(player, NPC.ITZLA, V.REPORT, () => [{ type: "message", text, id: "hod-departed" }]);
    });
    Scenes.later(player, 7, () => Scenes.closeFade(player));
  }

  function handleStatementBoxes(event) {
    if (event.stepId === "hod-slept" || event.stepId === "hod-departed") {
      event.handled = true;
      event.box = { statement: true };
    }
  }

  // ==========================================================================
  // The tower lobby and the robes
  // ==========================================================================

  function climbTower(event) {
    const id = event.objectId ?? event.definition?.id;
    if (id !== TOWER_STAIRS_ID) return false;
    const { player } = event;
    const current = stage(player);
    if (current < S.CALLED || current >= S.COMPLETE) return false;
    event.handled = true;
    if (current < S.TRIALS_EXPLAINED) {
      play(player, NPC.JANUS, V.JANUS_STAIRS_EARLY);
      return true;
    }
    if (current >= S.YIELDED) {
      if (current >= S.BANISHED) play(player, NPC.JANUS, V.TOWER_AGAIN_DONE);
      else play(player, NPC.JANUS, V.STAIRS_DONE);
      return true;
    }
    stopFollowing(player);
    units.tower.climb(player);
    return true;
  }

  function claimClimb(event) {
    if (climbTower(event) || descendRuins(event)) event.handled = true;
  }

  function wearsRobes(player) {
    const equipment = player.getEquipment?.();
    const worn = new Set();
    for (const item of equipment?.getItems?.() ?? []) if (item) worn.add(item.getId());
    return ITEM.ROBES.every((id) => worn.has(id));
  }

  function missingRobes(player) {
    const worn = new Set((player.getEquipment?.()?.getItems?.() ?? []).filter(Boolean).map(item => item.getId()));
    return ITEM.ROBES.filter(id => !worn.has(id) && !held(player, id));
  }

  function openRobesChest(event) {
    const id = event.objectId ?? event.definition?.id;
    if (id !== ROBES_CHEST_ID) return false;
    const { player } = event;
    const current = stage(player);
    event.handled = true;
    if (current < S.ROBES) {
      play(player, NPC.JANUS, V.JANUS_CHEST);
      return true;
    }
    if (!missingRobes(player).length) {
      play(player, NPC.JANUS, V.CHEST_EMPTY);
      return true;
    }
    const missing = missingRobes(player).length;
    if (player.getInventory().getFreeSlots() < missing) {
      play(player, NPC.JANUS, V.CHEST_FULL);
      return true;
    }
    player.performAnimation(new Animation(536));
    Scenes.later(player, 1, () => play(player, NPC.JANUS, current === S.ROBES ? V.CHEST : V.CHEST_RECLAIM));
    return true;
  }

  /** The robes: the box, a fade while Itzla changes, the robes and the box again. */
  function takeRobes(player, first) {
    const text = first
      ? "You search the chest and find some cultist robes for yourself and Itzla. Itzla puts his on."
      : "You search the chest and find some cultist robes.";
    const give = () => { for (const itemId of missingRobes(player)) player.getInventory().adds(itemId, 1); };
    if (!first || stage(player) !== S.ROBES) {
      give();
      play(player, NPC.JANUS, V.CHEST_RECLAIM, () => [{ type: "message", text, id: "hod-robes" }]);
      return;
    }
    play(player, NPC.JANUS, V.CHEST, () => [{ type: "message", text, id: "hod-robes-held" }]);
    Scenes.fade(player, true);
    Scenes.later(player, 3, () => {
      give();
      advance(player, S.ROBED);
      stopFollowing(player);
      Scenes.fade(player, false);
      play(player, NPC.JANUS, V.CHEST, () => [{ type: "message", text, id: "hod-robes" }]);
    });
    Scenes.later(player, 5, () => Scenes.closeFade(player));
  }

  function handleRobeBoxes(event) {
    if (event.stepId === "hod-robes" || event.stepId === "hod-robes-held") {
      event.handled = true;
      event.box = { items: [ITEM.ROBES[0], ITEM.ROBES[1]] };
      if (event.stepId === "hod-robes-held") event.end = true;
    }
  }

  // ==========================================================================
  // The initiation
  // ==========================================================================

  function talkToFides(event) {
    if (event.npcId !== NPC.FIDES) return false;
    const { player } = event;
    if (stage(player) !== S.ROBED) return false;
    event.handled = true;
    if (!wearsRobes(player)) {
      play(player, NPC.TEMPLE_GUARDS[0], V.NO_ROBES);
      return true;
    }
    beginInitiation(player);
    return true;
  }

  function beginInitiation(player) {
    if (Scenes.get(player)) return;
    stopFollowing(player);
    Scenes.hold(player);
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    Scenes.later(player, 2, () => {
      const scene = Scenes.open(player, "initiation", TEMPLE_BOUNDS);
      Scenes.controls(player, true, true);
      syncSideVarbits(player, 6);
      player.moveTo(new Location(1691, 3248, 0));
      Scenes.face(player, [1690, 3248]);
      const guards = [
        [NPC.TEMPLE_ACTOR_GUARDS[0], [1681, 3244], [1683, 3244], [1686, 3244]],
        [NPC.TEMPLE_ACTOR_GUARDS[1], [1681, 3251], [1683, 3251], [1686, 3251]],
        [NPC.TEMPLE_ACTOR_GUARDS[3], [1691, 3245], [1689, 3245], [1686, 3245]],
        [NPC.TEMPLE_ACTOR_GUARDS[2], [1691, 3250], [1689, 3250], [1686, 3250]],
      ].map(([id, tile, face, turn]) => ({ npc: Scenes.actor(scene, id, tile, face), turn }));
      scene.kneelers = guards.map((guard) => guard.npc);
      scene.sergius = Scenes.actor(scene, NPC.SERGIUS_JOINED, [1687, 3246], [1685, 3246]);
      scene.nova = Scenes.actor(scene, NPC.NOVA_JOINED, [1687, 3249], [1685, 3249]);
      scene.fides = Scenes.actor(scene, NPC.FIDES_ACTOR, [1684, 3247], [1686, 3247]);
      scene.itzla = Scenes.actor(scene, NPC.ITZLA_CULTIST_ACTOR, [1691, 3247], [1689, 3247]);
      Scenes.later(scene, 1, () => {
        for (const guard of guards) if (guard.npc) Scenes.face(guard.npc, guard.turn);
        Scenes.camera(player, [1693, 3245, 520], [1686, 3247, 519]);
      });
      Scenes.later(scene, 2, () => {
        Scenes.fade(player, false);
        scene.itzla?.getMovementQueue().addSteps(new Location(1687, 3247, 0));
      });
      Scenes.later(scene, 7, () => play(player, NPC.FIDES, V.INITIATION));
    });
  }

  /** Metzli walks on; then Ennius and Furia, and everyone kneels (11554), the player too. */
  function initiationCue(player, stepId) {
    const scene = Scenes.get(player);
    if (!scene) return;
    Scenes.hold(player);
    const walk = (npc, path) => { for (const [x, y] of path) npc?.getMovementQueue().addSteps(new Location(x, y, 0)); };
    if (stepId === STEP.METZLI_WALKS) {
      scene.metzli = Scenes.actor(scene, NPC.METZLI_ACTOR, [1678, 3246], [1678, 3244]);
      walk(scene.fides, [[1681, 3247], [1681, 3249]]);
      Scenes.later(scene, 2, () => walk(scene.metzli, [[1678, 3245], [1681, 3245], [1681, 3247], [1684, 3247]]));
      Scenes.later(scene, 6, () => scene.fides && Scenes.face(scene.fides, [1684, 3247]));
      Scenes.later(scene, 14, () => play(player, NPC.FIDES, V.INITIATION, after(STEP.METZLI_WALKS)));
      return;
    }
    const kneel = (npc, delay) => npc?.performAnimation(new Animation(11554, delay));
    for (const npc of scene.kneelers) kneel(npc, 230);
    kneel(scene.fides, 210);
    scene.furia = Scenes.actor(scene, NPC.FURIA_ACTOR, [1678, 3246], [1678, 3244]);
    Scenes.later(scene, 2, () => {
      scene.ennius = Scenes.actor(scene, NPC.ENNIUS_ACTOR, [1678, 3246], [1678, 3244]);
      walk(scene.furia, [[1678, 3245], [1681, 3245], [1681, 3247], [1683, 3247], [1683, 3246], [1684, 3246]]);
    });
    Scenes.later(scene, 4, () => walk(scene.ennius, [[1678, 3245], [1681, 3245], [1681, 3247], [1683, 3247], [1683, 3248], [1684, 3249]]));
    Scenes.later(scene, 14, () => { kneel(scene.sergius, 0); kneel(scene.nova, 5); });
    Scenes.later(scene, 16, () => player.performAnimation(new Animation(11554, 20)));
    Scenes.later(scene, 17, () => kneel(scene.itzla, 15));
    Scenes.later(scene, 18, () => play(player, NPC.FIDES, V.INITIATION, after(STEP.TWINS_WALK)));
  }

  /** After Metzli's last line: back in the temple with Itzla at his place there. */
  function endInitiation(player) {
    advance(player, S.INITIATED);
    Scenes.hold(player);
    Scenes.fade(player, true);
    Scenes.later(Scenes.get(player) ?? player, 3, () => {
      Scenes.end(player, false);
      player.moveTo(new Location(1688, 3247, 0));
      Scenes.face(player, [1687, 3248]);
      Scenes.controls(player, true, true);
      Scenes.later(player, 2, () => Scenes.fade(player, false));
      Scenes.later(player, 4, () => {
        Scenes.controls(player, false);
        Scenes.closeFade(player);
        play(player, NPC.ITZLA_ROBED, V.ITZLA_TEMPLE);
      });
    });
  }

  const INITIATION_LAST_LINE = "You all have a part to play in what is to come. Forebearer Fides will assign you your duties. Speak with her and then go forth. Go forth and serve our gods!";

  function handleInitiationEnd(event) {
    if (event.text !== INITIATION_LAST_LINE || stage(event.player) !== S.ROBED || Scenes.get(event.player)?.name !== "initiation") return;
    event.after = () => endInitiation(event.player);
  }

  // ==========================================================================
  // Into Tapoyauik, and back to Fortis
  // ==========================================================================

  function descendRuins(event) {
    const id = event.objectId ?? event.definition?.id;
    if (id !== RUINS_STAIRS_ID) return false;
    const { player } = event;
    const current = stage(player);
    if (current < S.BELOW) return false;
    event.handled = true;
    if (current >= S.BANISHED) {
      play(player, NPC.SERVIUS, V.RUINS_AGAIN);
      return true;
    }
    if (current === S.BELOW && !follower(player)) {
      play(player, NPC.RUINS_GUARDS[0], V.RUINS_GUARD_ALONE);
      return true;
    }
    stopFollowing(player);
    units.ruins.enter(player);
    return true;
  }

  function talkToServius(event) {
    if (event.npcId !== NPC.SERVIUS || stage(event.player) !== S.BANISHED) return false;
    event.handled = true;
    play(event.player, NPC.SERVIUS, V.SERVIUS, (steps) => {
      const captured = [];
      for (const step of steps) {
        if (step.player === 'What about me?') break;
        captured.push(step.type === 'condition' ? { ...step, steps: step.steps.filter(part => part.type !== 'end') } : step);
      }
      return [...captured,
        { type: 'line', speaker: 'Servius, Teokan of Ralos', text: 'I would suggest you make yourself scarce. The Queen will not take kindly to this development. I would hate for you to face her fire, my child.' },
        { player: 'But I want to help.' },
        { type: 'line', speaker: 'Servius, Teokan of Ralos', text: 'And help you will. I will ensure you are involved in whatever plans are made for dealing with this cult, but for now, you should leave this to me.' },
        { player: 'Okay, thank you, Servius.' },
        { type: 'line', speaker: 'Servius, Teokan of Ralos', text: LINE.COMPLETE },
      ];
    }, event.npc);
    return true;
  }

  function sceneEnded(player, scene, logout) {
    if (!logout) return;
    const back = { queen: [1453, 3173, 0], initiation: [1688, 3247, 0] }[scene.name];
    if (back) player.moveTo(new Location(...back));
  }

  // ==========================================================================
  // Journal, reward and saves
  // ==========================================================================

  const JOURNAL = [
    [S.BANISHED, ["Amoxliatl banished me from Tapoyauik after the cult took Itzla.", "", "I should tell <col=800000>Servius</col> at the Sunrise Palace."]],
    [S.FIGHT, ["Metzli, Ennius and Furia took Itzla and left me to Amoxliatl.", "", "I must defeat <col=800000>Amoxliatl</col>."]],
    [S.DOOR_OPEN, ["The statues melted the ice on the door.", "", "I should go through it with <col=800000>Itzla</col>."]],
    [S.CHASM, ["The nagua knocked Itzla across a chasm.", "", "I should find a way through the ruins to him."]],
    [S.RUINS, ["Fides sent us into Tapoyauik to clear the blockage.", "", "I should mine the <col=800000>rocks</col> with a pickaxe from the barrel."]],
    [S.THOUGHTS, ["I should speak to <col=800000>Forebearer Fides</col> about our duties."]],
    [S.INITIATED, ["The Augur is Metzli, and she names Ennius and Furia gods reborn.", "", "I should speak to <col=800000>Itzla</col>."]],
    [S.ROBED, ["I should wear the robes and speak to <col=800000>Forebearer Fides</col>", "in the Twilight Temple."]],
    [S.ROBES, ["I should take the robes from the <col=800000>chest</col> in the tower lobby."]],
    [S.YIELDED, ["We passed the trials.", "", "I should speak to <col=800000>Forebearer Janus</col> in the lobby."]],
    [S.TRIAL_4, ["The fourth trial: I must defeat <col=800000>Itzla</col>."]],
    [S.TRAITOR, ["I found the traitor.", "", "I should speak to <col=800000>Forebearer Janus</col> about the final trial."]],
    [S.TRIAL_3, ["The third trial: I must find the traitor among the four acolytes."]],
    [S.SURVIVED, ["We survived the second trial.", "", "I should speak to <col=800000>Forebearer Janus</col>."]],
    [S.TRIAL_2, ["The second trial: we must survive the Emissaries' fighters."]],
    [S.PASSPHRASE, ["I spoke the passphrase.", "", "I should speak to <col=800000>Forebearer Janus</col> about the next trial."]],
    [S.TRIAL_1, ["The first trial: I must find the passphrase and tell Janus."]],
    [S.CALLED, ["Forebearer Janus is ready for us.", "", "I should climb the tower's stairs."]],
    [S.MINGLED, ["One of the recruits spoke of a new leader, the Augur.", "", "I should tell <col=800000>Itzla</col>."]],
    [S.TOWER, ["I should speak to the other <col=800000>recruits</col> at the Tower of Ascension."]],
    [S.ITZLA_LEFT, ["Itzla went ahead to the Twilight Temple.", "", "I should meet him at the <col=800000>Tower of Ascension</col>."]],
    [S.SHOP_AGREED, ["The shopkeeper will send word to the Emissaries.", "", "I should tell <col=800000>Itzla</col> at the Windbreaker."]],
    [S.TO_SHOP, ["I should pose as a recruit to the <col=800000>shopkeeper</col> in Quetzacalli Gorge."]],
    [S.WOKE, ["Itzla himself was the contact.", "", "I should speak to <col=800000>Itzla</col>."]],
    [S.PAID, ["I rented the room at the Windbreaker.", "", "I should rest in the <col=800000>bed</col>."]],
    [S.TO_GORGE, ["I should ask to rent the basement room at the <col=800000>Windbreaker</col>", "in Quetzacalli Gorge."]],
    [S.STARTED, ["Itzla wants to infiltrate the Twilight Emissaries.", "", "I should speak to <col=800000>Prince Itzla</col> at the Teomat."]],
  ];

  function buildJournal(player, questHandle) {
    const current = questHandle.getStage(player);
    if (current >= S.COMPLETE) {
      return [
        "<str>Itzla and I joined the Twilight Emissaries, found Metzli leading</str>",
        "<str>them and lost Itzla to them in Tapoyauik.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    const entry = JOURNAL.find(([minimum]) => current >= minimum);
    if (entry) return entry[1];
    return [
      "I can start this quest by talking to <col=800000>Prince Itzla</col> at the Teomat.",
      "",
      "I need 55 Mining, 48 Thieving, 48 Slayer and 46 Agility, and to have",
      "completed Twilight's Promise.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    for (const skill of [Skill.MINING, Skill.THIEVING, Skill.SLAYER, Skill.AGILITY]) skills.addExperiences(skill, 8000);
  }

  /** Saves from the old plugin used other stage numbers; map them once. */
  function migrate(player) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === STAGE_VERSION) return;
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    const old = stage(player);
    if (old <= 0) return;
    const mapped = {
      2: S.STARTED, 4: S.QUEEN_LEFT, 6: S.WOKE, 8: S.SHOP_AGREED, 10: S.ITZLA_LEFT, 12: S.TOWER, 14: S.MINGLED,
      16: S.TRIALS_EXPLAINED, 18: S.TRIALS_EXPLAINED, 20: S.TRIALS_EXPLAINED, 22: S.TRIALS_EXPLAINED, 24: S.TRIALS_EXPLAINED,
      26: S.PASSPHRASE, 28: S.PASSPHRASE, 30: S.PASSPHRASE, 32: S.SURVIVED, 34: S.SURVIVED, 36: S.SURVIVED,
      38: S.TRAITOR, 40: S.TRAITOR, 42: S.YIELDED, 44: S.YIELDED, 46: S.ROBES, 48: S.ROBED, 50: S.INITIATED,
      52: S.BELOW, 54: S.RUINS, 56: S.CHASM, 58: S.CHASM, 60: S.LEVERS, 62: S.DOOR_OPEN, 64: S.BANISHED, 66: S.BANISHED,
    }[old] ?? old;
    if (mapped !== old) quest.setStage(player, mapped);
    if (mapped >= S.MINGLED) player.setAttribute(RECRUITS_ATTRIBUTE, 0b1111);
  }

  function syncOnBootstrap({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    migrate(player);
    syncSideVarbits(player);
    units.ruins.resume(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    stopFollowing(player);
    Scenes.end(player, true);
    Scenes.cancel(player);
    units.tower.logout(player);
    units.ruins.logout(player);
  }

  function handleProcess({ player }) {
    if (stage(player) >= S.CALLED && stage(player) < S.MINED) tickFollower(player);
  }

  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, 0);
  api.persistAttribute(RECRUITS_ATTRIBUTE, 0);
  api.persistAttribute(FLAGS_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: QUEST_KEY,
    name: "The Heart of Darkness",
    varpId: VARP_HEART_OF_DARKNESS,
    varbitId: STAGE_VARBIT,
    startedValue: S.STARTED,
    completionValue: S.COMPLETE,
    questPoints: 2,
    scrollItemId: ITEM.ROBES[1],
    otherRewards: ["Access to Tapoyauik", "8,000 Mining XP", "8,000 Thieving XP", "8,000 Slayer XP", "8,000 Agility XP"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:line", handleInitiationEnd);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:action", handleStatementBoxes);
  api.onCustomEvent("npc-dialogue:action", handleRobeBoxes);
  api.onCustomEvent("player:bootstrap-complete", syncOnBootstrap);
  api.onObjectInteraction("Bed", { Rest: restInBed });
  api.onCustomEvent("ladders:climb", claimClimb);
  api.onObjectInteraction("Staircase", { "Climb-up": climbTower });
  api.onObjectInteraction("Stairs", { "Climb-down": descendRuins });
  api.onObjectInteraction("Chest", { Open: openRobesChest });
  api.onNpcInteraction("Forebearer Fides", { "Talk-to": talkToFides });
  api.onNpcInteraction("Servius, Teokan of Ralos", { "Talk-to": talkToServius });
  api.onPlayerProcess(handleProcess);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  units.tower.register();
  units.ruins.register();
  api.onNpcInteraction("Prince Itzla Arkan", { "Talk-to": talkToItzla });
};
