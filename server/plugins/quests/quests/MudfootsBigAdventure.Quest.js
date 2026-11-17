/**
 * Mudfoot's Big Adventure (free-to-play, 3 November 2026, 1 Quest Point).
 *
 * Built from the rsprox capture MudfootsBigAdventure (rev 242.1: the whole quest, then the post-quest kits and
 * the lamps, in one session) and the OSRS Wiki; where they disagree the Wiki's text and flow are followed and
 * the recording's noted. The units are in ../mudfoot/: Common (ids, stages, state, the dialogue player),
 * Harlan, Mudfoot, Scenes (the store cutscene and the three fights) and Journal. Facts and differences:
 * docs/quests/mudfoots-big-adventure/README.md.
 *
 * Cache: quest row 218 (dbrow 17230 quest_mudfootsbigadventure), stage varbit mba (16779) with live's values
 * 2-32 (Common.STAGE), completion 32.
 */
module.exports = function registerMudfootsBigAdventureQuest(api) {
  const { Item, ItemIdentifiers, Skill } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");
  const { createCommon } = require("../mudfoot/Common.MudfootsBigAdventure");
  const { buildLines } = require("../mudfoot/Journal.MudfootsBigAdventure");
  const createHarlan = require("../mudfoot/Harlan.MudfootsBigAdventure");
  const createMudfoot = require("../mudfoot/Mudfoot.MudfootsBigAdventure");
  const createScenes = require("../mudfoot/Scenes.MudfootsBigAdventure");

  const common = createCommon(api);
  const { STAGE, VIS, NPC, CHAT, ATTRIBUTE, VARBIT, play, npcLine, playerLine, stageOf, setStage, setVis } = common;
  const P = playerLine;
  const MS = (text, anim, extra) => npcLine(NPC.MUDFOOT_FOLLOWER_SPEAR, text, anim, extra);

  const LAMP_ITEM_ID = ItemIdentifiers.ANTIQUE_LAMP_44; // mba_lamp
  const LAMPS = 4;
  const LAMP_XP = 500;
  const LAMP_SOUND = 2655; // found_gem [1490]
  const BOUNTY_SHARE = 500;
  const COMPLETE_JINGLE = 154; // "quest complete 3" [1332]

  /**
   * The mage casts Wind Strike (the capture's windstrike_casting/windstrike_travel and splash, ticks 900-910; the
   * Wiki's max hit 2) with its staff cast, human_caststrike_staff_walkmerge.
   */
  const MAGE_CAST_SEQ = 11423;
  const OUTLAW_WIND_STRIKE = Object.create(api.core.CombatSpells.WIND_STRIKE);
  OUTLAW_WIND_STRIKE.castAnimation = () => new api.core.Animation(MAGE_CAST_SEQ);
  class OutlawMageCombat extends api.core.MagicCombatMethod {
    start(npc, target) {
      npc.getCombat().setCastSpell(OUTLAW_WIND_STRIKE);
      super.start(npc, target);
    }
    finished(npc, target) {
      super.finished(npc, target);
      npc.getCombat().setCastSpell(null);
    }
  }

  const hasPet = (player) => player.getAttribute?.("pets:current")?.isRegistered?.() === true;

  // Late-bound: the units call each other through these.
  let harlan = null;
  let mudfoot = null;
  let scenes = null;

  scenes = createScenes(api, common, {
    clearNpcs: (player) => mudfoot.clear(player),
    sync: (player, options) => mudfoot.sync(player, options),
    faceHarlan: (player) => mudfoot.faceHarlan(player),
    afterSceneMenu: (player) => harlan.afterSceneMenu(player),
    afterFight: (player, stage) => afterFight(player, stage),
  });
  mudfoot = createMudfoot(api, common, {
    inScene: (player) => scenes.inScene(player),
    hasPet,
    afterFight: (player, stage) => afterFight(player, stage),
    startFight: (player, kind) => scenes.startFight(player, kind),
  });
  harlan = createHarlan(api, common, {
    begin,
    sendToMudfoot,
    following: (player) => mudfoot.following(player),
    resumeHarlanTalk: (player) => scenes.harlanTalk(player),
    mudfootDeparts: (player, stage, vis, next) => scenes.departs(player, stage, vis, next),
    reward: (player) => reward(player),
  });

  // --- stages ----------------------------------------------------------------------------------

  function begin(player) {
    player.setAttribute(ATTRIBUTE.SCHEME, common.STAGE_SCHEME);
    setStage(player, STAGE.STARTED);
  }

  /** Harlan's "Good luck, adventurer.": 4, and Mudfoot at his house [138]. */
  function sendToMudfoot(player) {
    if (stageOf(player) !== STAGE.STARTED) return;
    setStage(player, STAGE.SENT);
    setVis(player, VIS.HOUSE);
    mudfoot.sync(player);
  }

  // --- after each fight (head 16828, the spear follower) ----------------------------------------

  /** The talk the kill leads into [759-795, 933-973, 1199-1205]; each moves the stage on at its second-last line. */
  function afterFight(player, stage) {
    const to = (next) => () => { if (stageOf(player) === stage) setStage(player, next); mudfoot.sync(player); };
    if (stage === STAGE.RANGER_DEAD) {
      play(player, [
        P("Right, that's the first one of those outlaws dealt with.", CHAT.QUIZ1),
        MS("Yes, we do good work making them dead. Me do good work especially, but human not bad either.", CHAT.NEUTRAL2),
        P("Thanks... So, what's next?", CHAT.CONFUSED1),
        MS("Other goblins tell me about next thief. They say she carry big stick that make air go magic.", CHAT.NEUTRAL2),
        P("So she's a mage. That means we'll want to use ranged against her.", CHAT.NEUTRAL2),
        MS("Yes, that why me bring best ranged weapon of all: rocks.", CHAT.NEUTRAL2),
        P("Rocks?", CHAT.CONFUSED1),
        MS("Me throw them hard. Harder me throw, more death happen.", CHAT.NEUTRAL2),
        P("I see... I think I'll stick to a bow.", CHAT.CONFUSED1),
        MS("Yes, bow okay as well, but not as good as rocks. Maybe you use bow that first thief had, or maybe guard man tell you how to get one.", CHAT.NEUTRAL3),
        P("And once we're ready, where do we find this mage?", CHAT.QUIZ1),
        MS("Other goblins say they see her by ruined building, west of shop.", CHAT.NEUTRAL2),
        P("So directly south of here. In that case, shall we get going?", CHAT.QUIZ2, { on: to(STAGE.TO_MAGE) }),
        MS("Okay. Me behind you.", CHAT.NEUTRAL1),
      ]);
    } else if (stage === STAGE.MAGE_DEAD) {
      play(player, [
        MS("Another nasty thief go dead!", CHAT.HAPPY1),
        P("She mentioned H.A.M.", CHAT.CONFUSED1),
        MS("Nasty human must be member of nasty group. Always calling goblins monsters. We no monsters... apart from maybe Dungface. He once kill chicken just because it lay egg on his foot.", CHAT.ANGRY4),
        P("I suppose this explains why they were trying to frame you.", CHAT.NEUTRAL2),
        MS("Me impossible to frame. Rattrap try it once, but he fail. Me too wriggly.", CHAT.ANGRY2),
        P("What?", CHAT.CONFUSED1),
        MS("Humans silly anyway. They no consider powerful hero like Mudfoot! Me on quest to stop all the nasty humans.", CHAT.ANGRY3),
        P("Well, on that note, just one left to go. What do you know about the last thief?", CHAT.QUIZ2),
        MS("Other goblins say this one great warrior, but not as great as me.", CHAT.NEUTRAL2),
        P("Meaning they're using melee, so we need to use magic.", CHAT.NEUTRAL1),
        MS("Magic? Me try that once. They say to cast spell you wave hands, but me just wave big hammer instead. Work just as good.", CHAT.CONFUSED3),
        P("Are you sure?", CHAT.QUIZ1),
        MS("Yes. That why me stick with spear. This good for us though. Goblins say human do big religion.", CHAT.CONFUSED2),
        P("Big religion?", CHAT.QUIZ1),
        MS("He pray to his stupid god to help him. Means he protected. You do close up poke, he pray to stop close up poke. You do far away throw, he pray to stop far away throw.", CHAT.NEUTRAL4),
        MS("But he stupid. He no have good god like goblins have Big High War God. His god have short attention span and only listen to one prayer at time. If me use spear and you use fancy magic, he can't stop both.", CHAT.NEUTRAL4),
        P("I see. Sounds like we have a plan then.", CHAT.NEUTRAL1),
        MS("Yes, best plan. You get yourself magic stick. Take one from dead magic woman, or maybe guard man help. Then we kill last thief. Other goblins see him down in graveyard.", CHAT.NEUTRAL4),
        P("So south east of here. Shall we get going?", CHAT.QUIZ1, { on: to(STAGE.TO_WARRIOR) }),
        MS("Okay. Me behind you.", CHAT.NEUTRAL1),
      ]);
    } else if (stage === STAGE.WARRIOR_DEAD) {
      play(player, [
        P("That's the last of those thieves dealt with!", CHAT.HAPPY1),
        MS("Stupid humans should never have crossed Mudfoot the good at quests. Guard man will want to know about good job. He probably clap for us. Humans like clapping.", CHAT.NEUTRAL3),
        P("Shall we go tell him then?", CHAT.QUIZ1, { on: to(STAGE.REPORT) }),
        MS("Okay. Me behind you.", CHAT.NEUTRAL1),
      ]);
    }
  }

  // --- the reward ------------------------------------------------------------------------------

  function reward(player) {
    if (stageOf(player) !== STAGE.REWARD) return;
    harlan.rewardLines(player, () => { if (stageOf(player) === STAGE.REWARD) quest.complete(player); });
  }

  /** Four lamps, then the coins [1332]. */
  function grantReward(player) {
    const inventory = player.getInventory();
    for (let lamp = 0; lamp < LAMPS; lamp++) inventory.forceAdd(player, new Item(LAMP_ITEM_ID, 1));
    inventory.forceAdd(player, new Item(ItemIdentifiers.COINS, BOUNTY_SHARE));
    mudfoot.sync(player);
  }

  // --- the lamps -------------------------------------------------------------------------------

  /** The rub's chat menu [1484]; Ours: the second page (not captured) holds Magic, Hitpoints and Prayer. */
  const LAMP_PAGES = [
    [["Attack", Skill.ATTACK], ["Strength", Skill.STRENGTH], ["Defence", Skill.DEFENCE], ["Ranged", Skill.RANGED]],
    [["Magic", Skill.MAGIC], ["Hitpoints", Skill.HITPOINTS], ["Prayer", Skill.PRAYER]],
  ];

  function lampPage(player, lamp, page) {
    const options = LAMP_PAGES[page].map(([name, skill]) => [`${name}.`, () => rubbed(player, lamp, skill, name)]);
    options.push([page === 0 ? "More options..." : "Previous options...", () => lampPage(player, lamp, 1 - page)]);
    play(player, [{ menu: "Choose the skill you wish to gain XP in.", options }]);
  }

  function rubLamp(event) {
    if (event.itemId !== LAMP_ITEM_ID) return false;
    lampPage(event.player, { item: event.item, slot: event.slot }, 0);
    return true;
  }

  /** [1490]: the lamp goes, mba_lamps counts it, found_gem plays and the message box shows. */
  function rubbed(player, lamp, skill, name) {
    const inventory = player.getInventory();
    if (inventory.get(lamp.slot) !== lamp.item) return;
    const manager = player.getSkillManager();
    const before = manager.getExperience(skill);
    manager.addExperience(skill, LAMP_XP, true);
    if (manager.getExperience(skill) === before) {
      // Ours: as the other lamps say it when experience cannot be gained.
      player.sendMessage("You cannot gain experience in that skill right now.");
      return;
    }
    inventory.deleteAtSlot(lamp.slot, 1);
    const rubbedCount = (Number(player.getAttribute(ATTRIBUTE.LAMPS)) || 0) + 1;
    player.setAttribute(ATTRIBUTE.LAMPS, rubbedCount);
    player.getPacketSender().sendVarbit(VARBIT.LAMPS, rubbedCount);
    player.getPacketSender().sendSound(LAMP_SOUND, 1, 0);
    play(player, [{ box: `<col=0000ff>Your wish has been granted!</col><br>You have been awarded ${LAMP_XP} ${name} experience!` }]);
  }

  // --- the outlaws' Confront -------------------------------------------------------------------

  function confront(event) {
    const { player, npc } = event;
    if (!common.inProgress(player) || !npc || npc !== mudfoot.outlawOf(player)) return false;
    const stage = stageOf(player);
    const id = event.npcId;
    const withMudfoot = mudfoot.following(player);
    if (id === NPC.RANGER_VIS && stage === STAGE.RECRUITED) {
      if (!withMudfoot) play(player, [P("Hmm... I should go and get Mudfoot first.")]);
      else scenes.confrontStore(player);
      return true;
    }
    if (id === NPC.MAGE_VIS && stage >= STAGE.RANGER_DEAD && stage <= STAGE.MAGE_FIGHT) {
      if (!withMudfoot) play(player, [P("Hmm... I should talk to Mudfoot first.")]);
      else scenes.startFight(player, "mage");
      return true;
    }
    if (id === NPC.WARRIOR_VIS && stage >= STAGE.MAGE_DEAD && stage <= STAGE.WARRIOR_FIGHT) {
      if (!withMudfoot) play(player, [P("Hmm... I should go and get Mudfoot first.")]);
      else scenes.startFight(player, "warrior");
      return true;
    }
    return false;
  }

  // --- saves -----------------------------------------------------------------------------------

  /** The first version's stages (1, 6, 10, 11, 14, 16, 20, 22, 26, 32) as live's. */
  const LEGACY_STAGES = new Map([[1, 4], [6, 6], [10, 10], [11, 12], [14, 16], [16, 18], [20, 22], [22, 24], [26, 28], [32, 32]]);

  function migrate(player) {
    if (Number(player.getAttribute(ATTRIBUTE.SCHEME)) === common.STAGE_SCHEME) return;
    player.setAttribute(ATTRIBUTE.SCHEME, common.STAGE_SCHEME);
    const old = stageOf(player);
    const stage = LEGACY_STAGES.get(old);
    if (stage === undefined || old === 0) return;
    if (stage !== old) setStage(player, stage);
    const waiting = player.getAttribute(ATTRIBUTE.LEGACY_WAITING) === true;
    const spot = stage >= STAGE.REPORT ? VIS.GRAVEYARD : stage >= STAGE.TO_WARRIOR ? VIS.WOODS : stage >= STAGE.WINDMILL ? VIS.WINDMILL : VIS.HOUSE;
    let vis = VIS.NONE;
    if (stage === STAGE.SENT) vis = VIS.HOUSE;
    else if (stage > STAGE.SENT && stage < STAGE.COMPLETE) {
      const fight = stage === STAGE.RANGER_FIGHT || stage === STAGE.MAGE_FIGHT || stage === STAGE.WARRIOR_FIGHT || stage === STAGE.WINDMILL;
      vis = waiting || fight ? (stage === STAGE.MAGE_FIGHT ? VIS.WINDMILL : stage === STAGE.WARRIOR_FIGHT ? VIS.WOODS : spot) : VIS.FOLLOWING;
    }
    player.setAttribute(ATTRIBUTE.MUDFOOT_VIS, vis);
    player.setAttribute(ATTRIBUTE.LEGACY_WAITING, false);
    player.setAttribute(ATTRIBUTE.LEGACY_GIVEAWAYS, 0);
  }

  function handleLogin({ player }) {
    migrate(player);
    common.sendState(player);
    refreshQuestList(player);
    mudfoot.sync(player);
  }

  function handleLogout({ player }) {
    if (player) mudfoot.logout(player);
  }

  const quest = registerQuest(api, {
    key: "mudfoots_big_adventure",
    name: "Mudfoot's Big Adventure",
    varbitId: VARBIT.STAGE,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    completionJingleId: COMPLETE_JINGLE,
    questPoints: 1,
    otherRewards: [
      "Four antique lamps, each 500 experience in a combat skill or Prayer",
      "500 coins",
      "Basic equipment for each combat style from Captain Harlan every 30 minutes",
    ],
    buildJournal: (player, handle) => buildLines(handle.getStage(player)),
    onReward: grantReward,
  });
  common.setQuest(quest);

  api.persistAttribute(ATTRIBUTE.MUDFOOT_VIS, 0);
  api.persistAttribute(ATTRIBUTE.HARLAN_MET, false);
  api.persistAttribute(ATTRIBUTE.MET_EARLY, false);
  api.persistAttribute(ATTRIBUTE.FIRST_THIEF_TOLD, false);
  api.persistAttribute(ATTRIBUTE.BONUSES, 0);
  api.persistAttribute(ATTRIBUTE.LAST_CLAIM, 0);
  api.persistAttribute(ATTRIBUTE.LAMPS, 0);
  api.persistAttribute(ATTRIBUTE.SCHEME, 0);
  api.persistAttribute(ATTRIBUTE.LEGACY_WAITING, false);
  api.persistAttribute(ATTRIBUTE.LEGACY_GIVEAWAYS, 0);

  api.onNpcInteraction("Captain Harlan", { "Talk-to": harlan.talk, "Claim-weapons": harlan.claimWeapons });
  api.onNpcInteraction("Mudfoot", { "Talk-to": mudfoot.talk });
  api.onNpcInteraction("Outlaw", { Confront: confront });
  api.onNpcsInteraction([...mudfoot.REACTIONS.keys()], { "Talk-to": mudfoot.react });
  api.onPlayerDealtDamage(scenes.playerHit);
  api.onNpcHitModify(scenes.outlawHit);
  api.onNpcBeforeDeath(scenes.outlawDying);
  api.onCustomEvent("npc-drops:claim", scenes.claimLoot);
  api.registerNpcCombatMethodProvider([NPC.MUDFOOT_ROCKS_COMBAT], api.core.RangedCombatMethod);
  api.registerNpcCombatMethodProvider([NPC.MAGE_COMBAT], OutlawMageCombat);
  api.onItemAction("Antique lamp", { Rub: rubLamp });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
