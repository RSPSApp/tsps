/**
 * Vale Totems (miniquest).
 *
 * The words are the "Vale Totems (miniquest)" transcript (OSRS Wiki); the stages and the
 * fletching gates are the Quest Helper route
 * (helpers/miniquests/valetotems/ValeTotems.java). Progress lives in varbit 17227
 * ("ent_totems_intro"), which the minigame's own cache script reads, in tens:
 *
 *   0  not started
 *   10 accepted Ranulph's offer; the totem is broken
 *   20 watched the ent (a login checkpoint; talking continues the intro)
 *   30 rebuild, carve and decorate the totem (the minigame's site 1)
 *   40 decorated; speak to Ranulph or Isadora
 *   50 the ents left 100 offerings; claim them
 *   60 offering claimed; speak to Ranulph or Isadora to finish
 *   70 complete
 *
 * The three chat varbits the helper uses are set here too: 17228 ent_totems_broken_chat,
 * 17229 ent_totems_carve_chat (Isadora taught carving) and 17230 ent_totems_decorate_chat
 * (Ranulph taught decorating). The minigame reads 17229/17230 to withhold the carve menu and
 * the decoration action until each lesson, and asks this plugin (custom event
 * "vale-totems:access") which sites are open: site 1 during the miniquest, every site after it.
 *
 * Requirements per the Wiki: Children of the Sun and level 20 Fletching. Rewards: the
 * Sacraments of Ent Folk (item 31016) and access to the Vale Totems minigame. The scripted
 * visit leaves 100 offerings, as the transcript's "You collect 100 offerings.".
 *
 * Gaps: the ent's cutscene is played as dialogue (no scene camera or ent walk); the
 * "wrong animal" warning is not a separate branch; the knife hand-out and the requirement
 * refusal use the Wiki's wording where the transcript gives none.
 */
module.exports = function registerValeTotemsQuest(api) {
  const {
    ActionDialogue,
    DialogueChainBuilder,
    ItemIdentifiers,
    NpcDialogue,
    NpcIdentifiers,
    PlayerDialogue,
    Skill,
    StatementDialogue,
  } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const STAGE_VARP = 4758; // the parent varp of ent_totems_intro and its three chat bits
  const STAGE_VARBIT = 17227; // ent_totems_intro
  const BROKEN_CHAT_VARBIT = 17228;
  const CARVE_CHAT_VARBIT = 17229;
  const DECORATE_CHAT_VARBIT = 17230;

  const STAGE_STARTED = 10;
  const STAGE_SEEN_ENT = 20;
  const STAGE_REPAIR = 30;
  const STAGE_DECORATED = 40;
  const STAGE_OFFERING = 50;
  const STAGE_CLAIMED = 60;
  const STAGE_COMPLETE = 70;

  const VALE_SITE = 1;
  const SCRIPTED_OFFERINGS = 100;
  const FLETCHING_LEVEL = 20;
  const CHILDREN_OF_THE_SUN = "children_of_the_sun";

  const RANULPH = NpcIdentifiers.RANULPH; // 14577
  const ISADORA = NpcIdentifiers.ISADORA; // 14580
  // Quest Helper's start NPC list: 14576, 14577, 14578 and 14582. 14576 has no Talk-to
  // action (and no gameval name in this cache), but keep the set identical to the helper.
  const RANULPH_INTRO_NPC_ID = 14576;
  const RANULPH_NPC_IDS = new Set([
    RANULPH_INTRO_NPC_ID,
    NpcIdentifiers.RANULPH,
    NpcIdentifiers.RANULPH_2,
    NpcIdentifiers.RANULPH_3,
  ]);
  const ISADORA_NPC_IDS = new Set([NpcIdentifiers.ISADORA, NpcIdentifiers.ISADORA_2]);

  const SACRAMENTS_OF_ENT_FOLK = ItemIdentifiers.SACRAMENTS_OF_ENT_FOLK; // 31016
  const KNIFE = ItemIdentifiers.KNIFE; // 946

  const BROKEN_CHAT_ATTRIBUTE = "quest.vale_totems.broken-chat";
  const CARVE_CHAT_ATTRIBUTE = "quest.vale_totems.carve-chat";
  const DECORATE_CHAT_ATTRIBUTE = "quest.vale_totems.decorate-chat";

  let quest;

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function state() {
    return require("../../minigames/valetotems/State.ValeTotems");
  }

  function siteTotem(player) {
    try {
      return state().totem(player, VALE_SITE);
    } catch {
      return { wood: 0, carvings: [0, 0, 0], carved: false, decorations: 0, decay: 0, points: 0 };
    }
  }

  /** The intro broke the old totem; clear any site 1 totem from earlier minigame play. */
  function clearQuestSite(player) {
    try {
      state().set(player, VALE_SITE, {
        base: 0, base_carved: 0, base_multiloc: 0, low: 0, mid: 0, top: 0,
        decorations: 0, decay: 0, points: 0,
      });
    } catch {
      // The minigame owns this state; a missing plugin must not block the quest.
    }
  }

  function hasKnife(player) {
    return player.getInventory().contains(KNIFE) || player.getEquipment?.().contains?.(KNIFE) === true;
  }

  function giveKnife(player) {
    if (hasKnife(player)) return true;
    if (player.getInventory().getFreeSlots() < 1) {
      player.getInventory().full();
      return false;
    }
    player.getInventory().adds(KNIFE, 1);
    player.getInventory().refreshItems();
    player.sendMessage("Isadora gives you a knife.");
    return true;
  }

  function chatFlag(player, attribute) {
    return Number(player.getAttribute(attribute)) === 1;
  }

  function setChatFlag(player, attribute, varbit) {
    player.setAttribute(attribute, 1);
    player.getPacketSender().sendVarbit(varbit, 1);
  }

  function sendChatFlags({ player }) {
    if (!player) return;
    const sender = player.getPacketSender();
    sender.sendVarbit(BROKEN_CHAT_VARBIT, chatFlag(player, BROKEN_CHAT_ATTRIBUTE)
      || quest.getStage(player) >= STAGE_REPAIR ? 1 : 0);
    sender.sendVarbit(CARVE_CHAT_VARBIT, chatFlag(player, CARVE_CHAT_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(DECORATE_CHAT_VARBIT, chatFlag(player, DECORATE_CHAT_ATTRIBUTE) ? 1 : 0);
  }

  function speakers(npcId) {
    return {
      ranulph: RANULPH_NPC_IDS.has(npcId) ? npcId : RANULPH,
      isadora: ISADORA_NPC_IDS.has(npcId) ? npcId : ISADORA,
    };
  }

  /**
   * Plays a script of [speaker, text] pairs. Speakers are "ranulph", "isadora", "player",
   * "statement", or "action" (whose second item is a callback); `after` runs on a final
   * action entry.
   */
  function play(player, npcId, script, after) {
    const { ranulph, isadora } = speakers(npcId);
    const builder = new DialogueChainBuilder();
    let index = 0;
    for (const [speaker, value] of script) {
      builder.add(speaker === "action"
        ? new ActionDialogue(index, { execute: value })
        : speaker === "player"
          ? new PlayerDialogue(index, value)
          : speaker === "statement"
            ? new StatementDialogue(index, value)
            : new NpcDialogue(index, speaker === "isadora" ? isadora : ranulph, value));
      index++;
    }
    if (after) builder.add(new ActionDialogue(index, { execute: after }));
    player.getDialogueManager().startDialogues(builder);
    return true;
  }

  function talk(event) {
    const { player, npcId } = event;
    if (!RANULPH_NPC_IDS.has(npcId) && !ISADORA_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    // The generated Ranulph/Isadora transcripts own the post-quest and clue variants.
    if (stage >= STAGE_COMPLETE) return false;
    if (stage === 0) return RANULPH_NPC_IDS.has(npcId) ? intro(player, npcId) : false;
    if (stage === STAGE_STARTED || stage === STAGE_SEEN_ENT) return continueIntro(player, npcId);
    if (stage === STAGE_REPAIR) return repair(player, npcId);
    if (stage === STAGE_DECORATED) return offering(player, npcId);
    if (stage === STAGE_OFFERING) return claimReminder(player, npcId);
    if (stage === STAGE_CLAIMED) return finish(player, npcId);
    return false;
  }

  function intro(player, npcId) {
    if (!questComplete(player, CHILDREN_OF_THE_SUN)) {
      return play(player, npcId, [
        ["ranulph", "I'm sorry, but I'm waiting for someone who knows about the valley. Perhaps come back once you've helped Alina in Civitas illa Fortis."],
      ]);
    }
    if (player.getSkillManager().getMaxLevel(Skill.FLETCHING) < FLETCHING_LEVEL) {
      return play(player, npcId, [
        ["ranulph", `I could use a hand, but you'll need a Fletching level of ${FLETCHING_LEVEL} first.`],
      ]);
    }
    return play(player, npcId, [
      ["player", "Hello."],
      ["ranulph", "Oh, sorry! I was lost in thought. You gave me quite the start!"],
    ], () => {
      api.sendMultiChatboxPrompt(player, "Start the Vale Totems miniquest?",
        "Yes.", () => acceptIntro(player, npcId),
        "No.", () => play(player, npcId, [
          ["player", "Ah, sorry to have disturbed you then."],
          ["ranulph", "Not a problem."],
        ]));
    });
  }

  function acceptIntro(player, npcId) {
    if (quest.getStage(player) !== 0) return;
    clearQuestSite(player);
    quest.setStage(player, STAGE_STARTED);
    setChatFlag(player, BROKEN_CHAT_ATTRIBUTE, BROKEN_CHAT_VARBIT);
    player.sendMessage("You've started a new miniquest: <col=081190>Vale Totems</col>");
    // ActionDialogue only runs its callback, so the break checkpoint ends the first chain and
    // starts the rest of the intro from there.
    play(player, npcId, [
      ["player", "Does something have you preoccupied?"],
      ["ranulph", "Yes! It's these ents you see! I'd never seen anything like them until I came here. Look, here comes one now..."],
      ["player", "Interesting... It's like some sort of ritual."],
      ["ranulph", "Exactly! These totems are dotted all around here. They seem to be very important to the ents, but I don't know why."],
      ["player", "Have you asked around?"],
      ["ranulph", "Yes, but the locals didn't really give me much to go on. All they told me is that the ents, totems and spirits are all part of the natural cycle here in the valley."],
      ["player", "Hmm... Well, why don't we take a closer look at this totem?"],
      ["ranulph", "Good idea. If nothing else, it will be useful to document the carvings on it. Come, let's have a look..."],
      ["player", "It's a beautiful totem."],
      ["ranulph", "Indeed! Look at this bit!"],
      ["isadora", "Uh oh! The funny man broke the totem!"],
    ], () => {
      // Quest Helper maps 0, 10 and 20 to the same start step: 10 is accepting, 20 is the
      // moment the totem breaks, and 30 is the build instruction at the end.
      if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_SEEN_ENT);
      introAfterBreak(player, npcId);
    });
  }

  function introAfterBreak(player, npcId) {
    play(player, npcId, [
      ["ranulph", "Oh... There's a child."],
      ["isadora", "Excuse me? I have a name! I'm Isadora, and you're the funny man who gets confused by ents! I've been watching you."],
      ["ranulph", "Well, actually my name is Ranulph, not funny man..."],
      ["isadora", "Funny man Ranulph broke the totem! Ents won't be happy with you!"],
      ["ranulph", "Hmm... I think the child's assessment is correct. The ents probably won't be happy about what we've done."],
      ["player", "I'm not sure 'we' is the right word..."],
      ["isadora", "It's okay, funny man. The totems always end up breaking. The ents get sad for a while, but if you fix them, they end up all happy again!"],
      ["player", "So we need to fix the totem. How?"],
      ["ranulph", "Let's see... First, we'll need some lumber to rebuild the pole. I reckon one set of logs will do it."],
      ["player", "Any specific type?"],
      ["ranulph", "It looked like it was made from oak, so presumably oak logs should be enough. However, I do wonder if using better wood would help it survive the elements better."],
      ["player", "Or survive interference from... you know... us."],
      ["ranulph", "Hmm... The pole is only going to be the beginning though. We're going to need to carve it... I really should have made more notes on the carvings..."],
      ["isadora", "Notes? Notes are boring! I know how to carve them! Daddy showed me!"],
      ["player", "Well, I guess you can consult with Isadora on how to carve the totem. While you do that, I'll get to work on rebuilding the pole."],
    ], () => {
      if (quest.getStage(player) < STAGE_REPAIR) quest.setStage(player, STAGE_REPAIR);
    });
  }

  function continueIntro(player, npcId) {
    return play(player, npcId, [
      ["ranulph", "Did you see what that ent did?"],
      ["player", "I did. What now?"],
      ["ranulph", "The totem is broken. We'll need some logs to rebuild the pole. Oak should do, though better wood may last longer."],
      ["isadora", "And I can show you how to carve it! But first, build the base at the totem site to the north."],
    ], () => {
      if (!chatFlag(player, BROKEN_CHAT_ATTRIBUTE)) setChatFlag(player, BROKEN_CHAT_ATTRIBUTE, BROKEN_CHAT_VARBIT);
      if (quest.getStage(player) < STAGE_REPAIR) quest.setStage(player, STAGE_REPAIR);
    });
  }

  function repair(player, npcId) {
    const totem = siteTotem(player);
    if (totem.wood === 0) {
      return play(player, npcId, [
        ["ranulph", "Any luck getting that totem rebuilt?"],
        ["player", "I'm still working on it."],
        ["isadora", "Hurry up! You don't want the ents to stay sad, do you?"],
        ["ranulph", "I reckon you'll just need one set of logs. Oak logs should be enough, but I do wonder if using better wood would help it survive the elements better..."],
      ]);
    }
    if (!totem.carved) {
      if (chatFlag(player, CARVE_CHAT_ATTRIBUTE)) {
        return play(player, npcId, [
          ["ranulph", "Have you carved the animals yet?"],
          ["player", "I'm still working on it."],
          ["ranulph", "Don't forget, you'll need to make carvings of the animal spirits that are currently in this area."],
        ]);
      }
      const script = [
        ["ranulph", "That's a good start."],
        ["player", "What's next?"],
        ["isadora", "Now you need to carve the animals!"],
        ["ranulph", "Yes, according to Isadora, the carvings that were on the totem represented the animal spirits around it. However, the animals were disturbed when the totem fell. Some left, but new ones arrived."],
        ["player", "Meaning?"],
        ["isadora", "Meaning you need to carve the right ones, silly."],
        ["ranulph", "The right ones being the animals that are currently in this area."],
        ["player", "I suppose that makes sense. I'll give it a go."],
      ];
      if (!hasKnife(player)) {
        script.push(["isadora", player.getInventory().getFreeSlots() < 1
          ? "But you won't be able to do it without a knife! Make some space and I'll give you one!"
          : "But you won't be able to do it without a knife! Here!"]);
      }
      return play(player, npcId, script, () => {
        if (!giveKnife(player)) return;
        setChatFlag(player, CARVE_CHAT_ATTRIBUTE, CARVE_CHAT_VARBIT);
      });
    }
    if ((totem.decorations ?? 0) < 4) {
      if (chatFlag(player, DECORATE_CHAT_ATTRIBUTE)) {
        return play(player, npcId, [
          ["ranulph", "How's the decorating of that totem going?"],
          ["player", "I'm still working on it."],
          ["isadora", "You need to use the wooden things. Bows! Shields!"],
          ["ranulph", "What Isadora said basically. I reckon four should do. Oh, and be sure to use the same wood that you used for the totem itself."],
        ]);
      }
      return play(player, npcId, [
        ["ranulph", "You've quite the hand at carving, my friend."],
        ["player", "Thank you."],
        ["ranulph", "Now, the finishing touches. Apparently, the ents appreciate it when wooden items are returned to the forest."],
        ["isadora", "Yes! You need to help them finish the cycle!"],
        ["player", "Cycle?"],
        ["ranulph", "The cycle of life, death and decay, I suppose."],
        ["isadora", "Funny man Ranulph is learning!"],
        ["player", "Okay then. So, wooden items? You mean things like bows and shields?"],
        ["ranulph", "Exactly! Try decorating the totem with those kinds of items. I reckon four should do. Oh, and be sure to use the same wood that you used for the totem itself."],
        ["player", "Okay, I'll be back once I've done that."],
      ], () => setChatFlag(player, DECORATE_CHAT_ATTRIBUTE, DECORATE_CHAT_VARBIT));
    }
    if (quest.getStage(player) === STAGE_REPAIR) quest.setStage(player, STAGE_DECORATED);
    return offering(player, npcId);
  }

  function offering(player, npcId) {
    // Always play the scene and set the scripted pile: an ent visit may already have dropped
    // its own offerings on site 1 between the fourth decoration and this conversation.
    return play(player, npcId, [
      ["ranulph", "Look at that! I think it looks even better than it did before!"],
      ["isadora", "You did a good job! Now we have to see if you've made the ents happy again!"],
      ["ranulph", "I couldn't have imagined a better outcome! Not only have the ents accepted our new totem, but they've also left something behind!"],
      ["isadora", "It's a gift! The ents are happy again! They're saying thank you for helping! Go on, take it!"],
    ], () => {
      state().set(player, VALE_SITE, { points: SCRIPTED_OFFERINGS });
      if (quest.getStage(player) < STAGE_OFFERING) quest.setStage(player, STAGE_OFFERING);
    });
  }

  function claimReminder(player, npcId) {
    if (siteTotem(player).points <= 0) {
      quest.setStage(player, STAGE_CLAIMED);
      return finish(player, npcId);
    }
    return play(player, npcId, [
      ["isadora", "It's a gift! The ents are happy again! They're saying thank you for helping! Go on, take it!"],
      ["ranulph", "The offering is next to the totem. Claim it when you're ready."],
    ]);
  }

  function finish(player, npcId) {
    if (player.getInventory().getFreeSlots() < 1) {
      player.getInventory().full();
      return true;
    }
    return play(player, npcId, [
      ["ranulph", "Well, this is definitely the most 'dialogue' I've had with the ents. Isadora here has been a great help as well!"],
      ["isadora", "Thanks, funny man Ranulph. You're not so bad yourself!"],
      ["player", "So what now?"],
      ["ranulph", "It seems the ents are very appreciative of those who maintain their totems. Given you seem to have a knack for it, you might want to keep helping them. They have plenty of other totem sites in the valley."],
      ["isadora", "Yes! The ents like it when you help! They'll give you more gifts!"],
      ["ranulph", "As for me, I'm going to keep studying them. I've learnt so much today, both from Isadora and from the ents themselves. I've already documented it all, but I'm sure there's more to discover!"],
      ["ranulph", "Speaking of which, here, take a notebook for yourself. I've left a copy of my notes in it, but you can also use it to document your own findings."],
      ["statement", "Ranulph gives you a notebook."],
      ["ranulph", "Be sure to check in once in a while to compare findings. I'll happily trade items I find around the valley in exchange for your research assistance!"],
      ["player", "Sounds great, thanks!"],
      ["isadora", "Goodbye, other funny person. You did great!"],
      ["player", "Thanks, Isadora."],
      ["ranulph", "Until next time, friend."],
    ], () => {
      if (quest.getStage(player) < STAGE_CLAIMED || quest.isComplete(player)) return;
      if (player.getInventory().getFreeSlots() < 1) {
        player.getInventory().full();
        return;
      }
      player.getInventory().adds(SACRAMENTS_OF_ENT_FOLK, 1);
      player.getInventory().refreshItems();
      quest.complete(player);
    });
  }

  /** The minigame asks which sites the player may use (site 1 during the quest, all after it). */
  function handleAccess(request) {
    const { player, site } = request;
    if (!player) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return;
    if (site === VALE_SITE && stage >= STAGE_STARTED) return;
    request.allowed = false;
  }

  function handleWrongCarve({ player, site }) {
    if (!player || site !== VALE_SITE || quest.getStage(player) !== STAGE_REPAIR) return;
    play(player, RANULPH, [
      ["isadora", "That's not right!"],
      ["ranulph", "Remember, you need to make carvings of the animal spirits that are currently in this area."],
    ]);
  }

  function handleOfferingsClaimed({ player, site }) {
    if (!player || site !== VALE_SITE) return;
    if (quest.getStage(player) === STAGE_OFFERING) quest.setStage(player, STAGE_CLAIMED);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Ranulph and Isadora rebuild the broken totem.</str>",
        "<str>The ents accepted it and left an offering.</str>",
        "<str>Ranulph gave me the Sacraments of Ent Folk.</str>",
        "",
        "<col=ff0000>MINIQUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_CLAIMED) {
      return ["I should speak to <col=800000>Ranulph</col> or <col=800000>Isadora</col> to finish the miniquest."];
    }
    if (stage >= STAGE_OFFERING) {
      return ["I should claim the <col=800000>offerings</col> the ents left next to my totem."];
    }
    if (stage >= STAGE_DECORATED) {
      return ["I should speak to <col=800000>Ranulph</col> or <col=800000>Isadora</col>."];
    }
    if (stage >= STAGE_REPAIR) {
      const totem = siteTotem(player);
      if (totem.wood === 0) {
        return ["I need to build a new totem at the <col=800000>totem site</col> north of Ranulph."];
      }
      if (!totem.carved) {
        return ["I need to carve the <col=800000>animal spirits</col> into the totem."];
      }
      if ((totem.decorations ?? 0) < 4) {
        return ["I need to decorate the totem with four fletched items of the same wood."];
      }
    }
    if (stage >= STAGE_STARTED) {
      return ["I should speak to <col=800000>Ranulph</col> about the broken totem."];
    }
    return [
      "I can start this miniquest by talking to <col=800000>Ranulph</col> near the",
      "<col=800000>Totem</col> in north western <col=800000>Auburnvale</col>.",
      "",
      "I must have completed <col=800000>Children of the Sun</col> and have",
      "level 20 <col=800000>Fletching</col>.",
    ];
  }

  api.persistAttribute(BROKEN_CHAT_ATTRIBUTE, 0);
  api.persistAttribute(CARVE_CHAT_ATTRIBUTE, 0);
  api.persistAttribute(DECORATE_CHAT_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "vale_totems",
    name: "Vale Totems",
    varpId: STAGE_VARP,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    // Keep persisted gameplay stages; publish the cache quest state, including its final reward phase.
    varpValue: stage => stage >= STAGE_COMPLETE ? 100 : stage,
    questPoints: 0,
    scrollItemId: SACRAMENTS_OF_ENT_FOLK,
    otherRewards: ["Access to the Vale Totems minigame"],
    buildJournal,
  });

  api.onNpcInteraction("Ranulph", { "Talk-to": talk });
  api.onNpcInteraction("Isadora", { "Talk-to": talk });

  api.onPlayerLogin(sendChatFlags);
  api.onCustomEvent("player:bootstrap-complete", sendChatFlags);
  api.onCustomEvent("vale-totems:access", handleAccess);
  api.onCustomEvent("vale-totems:wrong-carve", handleWrongCarve);
  api.onCustomEvent("vale-totems:offerings-claimed", handleOfferingsClaimed);
};
