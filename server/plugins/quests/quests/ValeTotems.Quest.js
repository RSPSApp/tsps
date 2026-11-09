/**
 * Vale Totems (miniquest).
 *
 * As live plays it: RSProx capture 20261109T224258-5ab63b4 (rev 242) records the whole
 * miniquest, its three cutscenes (../valetotems/Scenes.ValeTotems.js) and every line with its
 * speaker and chathead animation. The stages and fletching gates are the Quest Helper route
 * (helpers/miniquests/valetotems/ValeTotems.java). Progress lives in varbit 17227
 * ("ent_totems_intro"), which the cache's multi-NPCs and the minigame read, in tens:
 *
 *   0  not started; site 1 shows the old, intact totem (oak; buffalo, jaguar, eagle)
 *   10 accepted Ranulph's offer (tick 467)
 *   20 the ent has worshipped the totem (scene 1, tick 480)
 *   30 Ranulph broke it (scene 2, tick 527); rebuild, carve and decorate site 1
 *   40 decorated, and the next conversation starts (tick 693)
 *   50 the ents left 100 offerings (scene 3, tick 710); claim them
 *   60 offering claimed (tick 743); speak to Ranulph or Isadora to finish
 *   70 complete (the client's ent_totems_intro reads 100, tick 758)
 *
 * The client shows Isadora (ent_totems_intro_child) from 30 and gives Ranulph
 * (ent_totems_intro_ranulph) Trade at 100. The three chat varbits are set on the continues
 * the capture shows: 17228 ent_totems_broken_chat (tick 559), 17229 ent_totems_carve_chat
 * (tick 602) and 17230 ent_totems_decorate_chat (tick 660). The minigame reads 17229/17230 to
 * withhold carving and decorating until each lesson, and asks this plugin (custom event
 * "vale-totems:access") which sites are open: site 1 during the miniquest, every site after it.
 *
 * Live sends no "started" or "completed" chat line, jingle or scroll for it; completing it
 * gives the Sacraments of Ent Folk in an objectbox ("Ranulph gives you a notebook.").
 *
 * Ours (not captured): the requirement refusals, the conversations at a stage a logout
 * interrupted (10, 20, 30 before the broken-totem talk ends, 40) replay that part of the
 * intro; the "still working on it" reminders, the knife hand-out and the wrong-animal warning
 * use the Wiki transcript's words.
 */
module.exports = function registerValeTotemsQuest(api) {
  const {
    ActionDialogue,
    DialogueChainBuilder,
    ItemIdentifiers,
    ItemStatementDialogue,
    NpcDialogue,
    PlayerDialogue,
    Skill,
    StatementDialogue,
  } = api.core;
  const { registerQuest } = require("../QuestRuntime");
  const Scenes = require("../valetotems/Scenes.ValeTotems")(api);

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
  const COMPLETE_VARBIT_VALUE = 100;

  const VALE_SITE = 1;
  const SCRIPTED_OFFERINGS = 100;
  const FLETCHING_LEVEL = 20;
  const CHILDREN_OF_THE_SUN = "children_of_the_sun";

  // The chatheads live uses: the multi-NPC parents (ent_totems_intro_ranulph 14576,
  // ent_totems_intro_child 14579), whatever form the player talked to.
  const RANULPH_HEAD = 14576;
  const ISADORA_HEAD = 14579;
  const RANULPH_NAME = "Ranulph";
  const ISADORA_NAME = "Isadora";

  /** The capture's chathead animations (seq ids). */
  const HAP1 = 567;
  const HAP2 = 568;
  const HAP3 = 569;
  const HAP4 = 570;
  const SHOCK2 = 572;
  const CON1 = 575;
  const CON2 = 576;
  const QUIZ1 = 554;
  const QUIZ2 = 555;
  const QUIZ3 = 556;
  const NEU1 = 588;
  const NEU2 = 589;
  const NEU3 = 590;
  const NEU4 = 591;

  /** The old totem live shows at site 1 until the intro breaks it (capture login, lines 736-749). */
  const INTACT_TOTEM = {
    base: 1, base_carved: 1, base_multiloc: 9, low: 10, mid: 11, top: 12, decorations: 0, decay: 2, points: 0,
    animal_1: 1, animal_2: 2, animal_3: 3, multianimal_a_1: 1, multianimal_b_1: 1, multianimal_c_1: 1,
    multianimal_d_1: 0, multianimal_e_1: 0,
  };
  const BROKEN_TOTEM = { base: 0, base_carved: 0, base_multiloc: 0, low: 0, mid: 0, top: 0, decorations: 0, decay: 0, points: 0 };

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

  function setSite(player, fields) {
    try {
      state().set(player, VALE_SITE, fields);
    } catch {
      // The minigame owns this state; a missing plugin must not block the quest.
    }
  }

  function refreshIcons(player) {
    try {
      require("../../minigames/valetotems/Icons.ValeTotems").refresh(player);
    } catch {
      // As above.
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
      || quest.getStage(player) >= STAGE_DECORATED ? 1 : 0);
    sender.sendVarbit(CARVE_CHAT_VARBIT, chatFlag(player, CARVE_CHAT_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(DECORATE_CHAT_VARBIT, chatFlag(player, DECORATE_CHAT_ATTRIBUTE) ? 1 : 0);
  }

  /** Before the miniquest, site 1 shows the old totem the intro breaks. */
  function showIntactTotem({ player }) {
    if (!player || player.isPlayerBot?.() === true || quest.getStage(player) !== 0) return;
    setSite(player, INTACT_TOTEM);
  }

  function onLogin(event) {
    sendChatFlags(event);
    showIntactTotem(event);
  }

  /**
   * Plays a script of [speaker, text, animation] entries. Speakers are "ranulph", "isadora",
   * "player", "statement", "item" (text is [itemId, text]) or "action" (whose second item is a
   * callback). An action runs as the next line opens, on the continue live sets its var on, so it
   * costs no extra click; `after` and trailing actions run at the end.
   */
  function play(player, script, after) {
    const builder = new DialogueChainBuilder();
    let index = 0;
    let pending = [];
    for (const [speaker, value, animation] of script) {
      if (speaker === "action") {
        pending.push(value);
        continue;
      }
      const line = speaker === "player"
        ? new PlayerDialogue(index, value, animation)
        : speaker === "statement"
          ? new StatementDialogue(index, value)
          : speaker === "item"
            ? new ItemStatementDialogue(index, value[0], value[1])
            : speaker === "isadora"
              ? new NpcDialogue(index, ISADORA_HEAD, value, ISADORA_NAME, animation)
              : new NpcDialogue(index, RANULPH_HEAD, value, RANULPH_NAME, animation);
      if (pending.length) {
        const actions = pending;
        const send = line.send.bind(line);
        line.send = (target) => {
          for (const action of actions) action();
          send(target);
        };
        pending = [];
      }
      builder.add(line);
      index++;
    }
    const tail = [...pending, ...(after ? [after] : [])];
    if (tail.length) builder.add(new ActionDialogue(index, { execute: () => tail.forEach((action) => action()) }));
    player.getDialogueManager().startDialogues(builder);
    return true;
  }

  /** Isadora is only shown from stage 30 (her multi-NPC), so she never starts the miniquest. */
  function talkToIsadora(event) {
    return quest.getStage(event.player) === 0 ? false : talk(event);
  }

  function talk(event) {
    const { player } = event;
    if (Scenes.active(player)) return true;
    const stage = quest.getStage(player);
    // The generated Ranulph/Isadora transcripts own the post-quest and clue variants.
    if (stage >= STAGE_COMPLETE) return false;
    if (stage === 0) return intro(player);
    if (stage === STAGE_STARTED) return worship(player);
    if (stage === STAGE_SEEN_ENT) return afterWorship(player);
    if (stage === STAGE_REPAIR && !chatFlag(player, BROKEN_CHAT_ATTRIBUTE)) return afterBreak(player);
    if (stage === STAGE_REPAIR) return repair(player);
    if (stage === STAGE_DECORATED) return offering(player);
    if (stage === STAGE_OFFERING) return claimReminder(player);
    if (stage === STAGE_CLAIMED) return finish(player);
    return false;
  }

  function intro(player) {
    if (!questComplete(player, CHILDREN_OF_THE_SUN)) {
      return play(player, [
        ["ranulph", "I'm sorry, but I'm waiting for someone who knows about the valley. Perhaps come back once you've helped Alina in Civitas illa Fortis."],
      ]);
    }
    if (player.getSkillManager().getMaxLevel(Skill.FLETCHING) < FLETCHING_LEVEL) {
      return play(player, [
        ["ranulph", `I could use a hand, but you'll need a Fletching level of ${FLETCHING_LEVEL} first.`],
      ]);
    }
    return play(player, [
      ["player", "Hello.", HAP1],
      ["ranulph", "Oh, sorry! I was lost in thought. You gave me quite the start!", SHOCK2],
    ], () => {
      api.sendMultiChatboxPrompt(player, "Start the Vale Totems miniquest?",
        "Yes.", () => acceptIntro(player),
        "No.", () => play(player, [
          ["player", "Ah, sorry to have disturbed you then.", NEU1],
          ["ranulph", "Not a problem.", NEU1],
        ]));
    });
  }

  function acceptIntro(player) {
    if (quest.getStage(player) !== 0) return;
    quest.setStage(player, STAGE_STARTED);
    worship(player);
  }

  /** Stage 10: the ent comes to the totem (scene 1). */
  function worship(player) {
    return play(player, [
      ["player", "Does something have you preoccupied?", HAP1],
      ["ranulph", "Yes! It's these ents you see! I'd never seen anything like them until I came here. Look, here comes one now...", HAP3],
    ], () => Scenes.play(player, "worship", {
      actions: { "ent-worshipped": seenEnt },
      done: afterWorship,
    }));
  }

  function seenEnt(player) {
    if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_SEEN_ENT);
  }

  /** Stage 20: a closer look at the totem, which Ranulph breaks (scene 2). */
  function afterWorship(player) {
    return play(player, [
      ["player", "Interesting... It's like some sort of ritual.", CON1],
      ["ranulph", "Exactly! These totems are dotted all around here. They seem to be very important to the ents, but I don't know why.", HAP3],
      ["player", "Have you asked around?", QUIZ1],
      ["ranulph", "Yes, but the locals didn't really give me much to go on. All they told me is that the ents, totems and spirits are all part of the natural cycle here in the valley.", HAP3],
      ["player", "Hmm... Well, why don't we take a closer look at this totem?", QUIZ2],
      ["ranulph", "Good idea. If nothing else, it will be useful to document the carvings on it. Come, let's have a look...", HAP2],
    ], () => Scenes.play(player, "break", {
      actions: { "totem-broken": breakTotem },
      done: afterBreak,
    }));
  }

  function breakTotem(player) {
    setSite(player, BROKEN_TOTEM);
    refreshIcons(player);
    if (quest.getStage(player) < STAGE_REPAIR) quest.setStage(player, STAGE_REPAIR);
  }

  /** Isadora appears; the broken-totem conversation sets ent_totems_broken_chat. */
  function afterBreak(player) {
    return play(player, [
      ["isadora", "Uh oh! The funny man broke the totem!", HAP1],
      ["ranulph", "Oh... There's a child.", CON1],
      ["isadora", "Excuse me? I have a name! I'm Isadora, and you're the funny man who gets confused by ents! I've been watching you.", HAP3],
      ["ranulph", "Well, actually my name is Ranulph, not funny man...", CON1],
      ["isadora", "Funny man Ranulph broke the totem! Ents won't be happy with you!", HAP2],
      ["ranulph", "Hmm... I think the child's assessment is correct. The ents probably won't be happy about what we've done.", CON2],
      ["player", "I'm not sure 'we' is the right word...", CON1],
      ["isadora", "It's okay, funny man. The totems always end up breaking. The ents get sad for a while, but if you fix them, they end up all happy again!", HAP3],
      ["player", "So we need to fix the totem. How?", QUIZ1],
      ["ranulph", "Let's see... First, we'll need some lumber to rebuild the pole. I reckon one set of logs will do it.", NEU2],
      ["player", "Any specific type?", QUIZ1],
      ["ranulph", "It looked like it was made from oak, so presumably oak logs should be enough. However, I do wonder if using better wood would help it survive the elements better...", NEU3],
      ["player", "Or survive interference from... you know... us.", QUIZ1],
      ["ranulph", "Hmm... The pole is only going to be the beginning though. We're going to need to carve it... I really should have made more notes on the carvings...", NEU3],
      ["isadora", "Notes? Notes are boring! I know how to carve them! Daddy showed me!", HAP2],
      ["action", () => setChatFlag(player, BROKEN_CHAT_ATTRIBUTE, BROKEN_CHAT_VARBIT)],
      // Live gives this line to the player (chat_right, chatquiz3).
      ["player", "Well, I guess you can consult with Isadora on how to carve the totem. While you do that, I'll get to work on rebuilding the pole.", QUIZ3],
    ]);
  }

  function repair(player) {
    const totem = siteTotem(player);
    if (totem.wood === 0) {
      return play(player, [
        ["ranulph", "Any luck getting that totem rebuilt?"],
        ["player", "I'm still working on it."],
        ["isadora", "Hurry up! You don't want the ents to stay sad, do you?"],
        ["ranulph", "I reckon you'll just need one set of logs. Oak logs should be enough, but I do wonder if using better wood would help it survive the elements better..."],
      ]);
    }
    if (!totem.carved) {
      if (chatFlag(player, CARVE_CHAT_ATTRIBUTE)) {
        return play(player, [
          ["ranulph", "Have you carved the animals yet?"],
          ["player", "I'm still working on it."],
          ["ranulph", "Don't forget, you'll need to make carvings of the animal spirits that are currently in this area."],
        ]);
      }
      const script = [
        ["ranulph", "That's a good start.", HAP1],
        ["player", "What's next?", NEU1],
        ["isadora", "Now you need to carve the animals!", HAP1],
        ["ranulph", "Yes, according to Isadora, the carvings that were on the totem represented the animal spirits around it. However, the animals were disturbed when the totem fell. Some left, but new ones arrived.", NEU4],
        ["player", "Meaning?", QUIZ1],
        ["isadora", "Meaning you need to carve the right ones, silly.", HAP1],
        ["ranulph", "The right ones being the animals that are currently in this area.", NEU2],
        ["action", () => setChatFlag(player, CARVE_CHAT_ATTRIBUTE, CARVE_CHAT_VARBIT)],
        ["player", "I suppose that makes sense. I'll give it a go.", NEU1],
      ];
      if (!hasKnife(player)) {
        script.push(["isadora", player.getInventory().getFreeSlots() < 1
          ? "But you won't be able to do it without a knife! Make some space and I'll give you one!"
          : "But you won't be able to do it without a knife! Here!"]);
      }
      return play(player, script, () => giveKnife(player));
    }
    if ((totem.decorations ?? 0) < 4) {
      if (chatFlag(player, DECORATE_CHAT_ATTRIBUTE)) {
        return play(player, [
          ["ranulph", "How's the decorating of that totem going?"],
          ["player", "I'm still working on it."],
          ["isadora", "You need to use the wooden things. Bows! Shields!"],
          ["ranulph", "What Isadora said basically. I reckon four should do. Oh, and be sure to use the same wood that you used for the totem itself."],
        ]);
      }
      return play(player, [
        ["ranulph", "You've quite the hand at carving, my friend.", HAP1],
        ["player", "Thank you.", HAP1],
        ["ranulph", "Now, the finishing touches. Apparently, the ents appreciate it when wooden items are returned to the forest.", NEU3],
        ["isadora", "Yes! You need to help them finish the cycle!", HAP1],
        ["player", "Cycle?", CON1],
        ["ranulph", "The cycle of life, death and decay, I suppose.", NEU1],
        ["isadora", "Funny man Ranulph is learning!", HAP1],
        ["player", "Okay then. So, wooden items? You mean things like bows and shields?", QUIZ2],
        ["ranulph", "Exactly! Try decorating the totem with those kinds of items. I reckon four should do. Oh, and be sure to use the same wood that you used for the totem itself.", HAP3],
        ["action", () => setChatFlag(player, DECORATE_CHAT_ATTRIBUTE, DECORATE_CHAT_VARBIT)],
        ["player", "Okay, I'll be back once I've done that.", NEU1],
      ]);
    }
    // Live sets stage 40 as this conversation opens (tick 693).
    quest.setStage(player, STAGE_DECORATED);
    return offering(player);
  }

  /** Stage 40: the ent accepts the totem and leaves 100 offerings (scene 3). */
  function offering(player) {
    return play(player, [
      ["ranulph", "Look at that! I think it looks even better than it did before!", HAP2],
      ["isadora", "You did a good job! Now we have to see if you've made the ents happy again!", HAP2],
    ], () => Scenes.play(player, "offering", {
      actions: { "offerings-left": leaveOfferings },
      done: afterOffering,
    }));
  }

  /**
   * The scene's visit (tick 710): the pile is set to 100 offerings, whatever an ent visit left
   * since the fourth decoration, and the totem loses a point of durability like any visit.
   */
  function leaveOfferings(player) {
    const { decay } = siteTotem(player);
    setSite(player, { points: SCRIPTED_OFFERINGS, decay: Math.max(1, decay - 1) });
    refreshIcons(player);
    if (quest.getStage(player) < STAGE_OFFERING) quest.setStage(player, STAGE_OFFERING);
  }

  function afterOffering(player) {
    return play(player, [
      ["ranulph", "I couldn't have imagined a better outcome! Not only have the ents accepted our new totem, but they've also left something behind!", HAP3],
      ["isadora", "It's a gift! The ents are happy again! They're saying thank you for helping! Go on, take it!", HAP2],
    ]);
  }

  function claimReminder(player) {
    if (siteTotem(player).points <= 0) {
      quest.setStage(player, STAGE_CLAIMED);
      return finish(player);
    }
    return play(player, [
      ["isadora", "It's a gift! The ents are happy again! They're saying thank you for helping! Go on, take it!", HAP2],
      ["ranulph", "The offering is next to the totem. Claim it when you're ready."],
    ]);
  }

  function finish(player) {
    if (player.getInventory().getFreeSlots() < 1) {
      player.getInventory().full();
      return true;
    }
    return play(player, [
      ["ranulph", "Well, this is definitely the most 'dialogue' I've had with the ents. Isadora here has been a great help as well!", HAP2],
      ["isadora", "Thanks, funny man Ranulph. You're not so bad yourself!", HAP2],
      ["player", "So what now?", QUIZ1],
      ["ranulph", "It seems the ents are very appreciative of those who maintain their totems. Given you seem to have a knack for it, you might want to keep helping them. They have plenty of other totem sites in the valley.", HAP4],
      ["isadora", "Yes! The ents like it when you help! They'll give you more gifts!", HAP2],
      ["ranulph", "As for me, I'm going to keep studying them. I've learnt so much today, both from Isadora and from the ents themselves. I've already documented it all, but I'm sure there's more to discover!", HAP4],
      // Tick 758: the quest completes and the notebook's objectbox replaces Ranulph's
      // "Speaking of which, here, take a notebook for yourself. ..." in the same tick.
      ["action", () => complete(player)],
      ["item", [SACRAMENTS_OF_ENT_FOLK, "Ranulph gives you a notebook."]],
      ["ranulph", "Be sure to check in once in a while to compare findings. I'll happily trade items I find around the valley in exchange for your research assistance!", HAP3],
      ["player", "Sounds great, thanks!", HAP1],
      ["isadora", "Goodbye, other funny person. You did great!", HAP1],
      ["player", "Thanks, Isadora.", HAP1],
      ["ranulph", "Until next time, friend.", HAP1],
    ]);
  }

  function complete(player) {
    if (quest.getStage(player) < STAGE_CLAIMED || quest.isComplete(player)) return;
    if (player.getInventory().getFreeSlots() < 1) {
      player.getInventory().full();
      return;
    }
    player.getInventory().adds(SACRAMENTS_OF_ENT_FOLK, 1);
    player.getInventory().refreshItems();
    quest.complete(player, { scroll: false, announce: false });
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
    play(player, [
      ["isadora", "That's not right!"],
      ["ranulph", "Remember, you need to make carvings of the animal spirits that are currently in this area."],
    ]);
  }

  function handleOfferingsClaimed({ player, site }) {
    if (!player || site !== VALE_SITE) return;
    if (quest.getStage(player) === STAGE_OFFERING) quest.setStage(player, STAGE_CLAIMED);
  }

  function logout({ player }) {
    Scenes.end(player, true);
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
      return ["I should speak to <col=800000>Ranulph</col> about the totem."];
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
    varpValue: stage => stage >= STAGE_COMPLETE ? COMPLETE_VARBIT_VALUE : stage,
    questPoints: 0,
    scrollItemId: SACRAMENTS_OF_ENT_FOLK,
    otherRewards: ["Access to the Vale Totems minigame"],
    buildJournal,
  });

  api.onNpcInteraction("Ranulph", { "Talk-to": talk });
  api.onNpcInteraction("Isadora", { "Talk-to": talkToIsadora });

  api.onPlayerLogin(onLogin);
  api.onPlayerLogout?.(logout);
  api.onCustomEvent("player:bootstrap-complete", onLogin);
  api.onCustomEvent("vale-totems:access", handleAccess);
  api.onCustomEvent("vale-totems:wrong-carve", handleWrongCarve);
  api.onCustomEvent("vale-totems:offerings-claimed", handleOfferingsClaimed);
};
