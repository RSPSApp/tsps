/**
 * Skippy and the Mogres (miniquest, members).
 *
 * Wiki: https://oldschool.runescape.wiki/w/Skippy_and_the_Mogres
 *       https://oldschool.runescape.wiki/w/Transcript:Skippy_and_the_Mogres
 *       https://oldschool.runescape.wiki/w/Skippy (the before/after variants)
 *
 * The cache's quest row for the miniquest is 135 ("Skippy and the Mogres", type 1,
 * 0 quest points) and completes at 3. Its progress is varbit 1344 `skippy_state`
 * (varp 597, bits 0-2); the spawned `multi_skippy` (npc 3230) transforms on that
 * varbit to drunk 2587, damp 2588, hungover 2589 and sober 2590, so the stage is
 * also what the client draws:
 *
 *   stage 0  drunk, shouting at the sea
 *   stage 1  a bucket of water has been thrown over him (quest starts)
 *   stage 2  he has drunk the nettle tea and has a hangover
 *   stage 3  he has drunk the hangover cure; miniquest complete
 *
 * Talk-to uses the generated "Skippy" transcript for the drunk and post-quest
 * conversations; the damp and hungover conversations live only on the miniquest
 * transcript page, so they are spelled out here with the wiki's wording. The
 * right-click Sober-Up option, the bucket of water, nettle tea and hangover cure
 * hand-ins are the transcript's own sections.
 *
 * The reward (Wiki: "The ability to slay mogres at 32 Slayer") is the Slayer task:
 * `slayer-masters.json` gated the Mogres task on this key once it existed.
 *
 * Nettle tea and the hangover cure are made by GhostsAhoy.Quest.js and
 * PlagueCity.Quest.js, which own those recipes.
 *
 * Gaps:
 * - The transcript only documents Sober-Up before the quest (without a bucket)
 *   and after it; the damp and hungover forms' Sober-Up has no wiki line, so the
 *   option is swallowed there rather than guessed.
 * - The transcript's "if the player has learned the hangover cure recipe during
 *   Plague City" branch is keyed on Plague City's hangover-cure stage; a player
 *   who learned it in another way is told the recipe again.
 */
module.exports = function registerSkippyAndTheMogresQuest(api) {
  const { ItemIdentifiers: Items, NpcIdentifiers: Npcs, NpcDefinition } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const VARP_SKIPPY_STATE = 597;
  const VARBIT_SKIPPY_STATE = 1344;
  const STAGE_STARTED = 1;
  const STAGE_HANGOVER = 2;
  const STAGE_COMPLETE = 3;

  const SKIPPY_NPC_ID = Npcs.SKIPPY; // 2587 chathead
  const SKIPPY_NPC_IDS = new Set([Npcs.SKIPPY, Npcs.SKIPPY_2, Npcs.SKIPPY_3, Npcs.SKIPPY_4]);
  const SKIPPY_NAME = "Skippy";

  const BUCKET = Items.BUCKET; // 1925
  const BUCKET_OF_WATER = Items.BUCKET_OF_WATER; // 1929
  const NETTLE_TEA = Items.NETTLE_TEA; // 4239
  const HANGOVER_CURE = Items.HANGOVER_CURE; // 1504
  const BOTTOMLESS_MILK_BUCKET = Items.BOTTOMLESS_MILK_BUCKET; // 33089

  const PAGE = "Skippy";
  const VARIANT_BEFORE = "before-skippy-and-the-mogres";
  const VARIANT_WITHOUT_BUCKET =
    "before-skippy-and-the-mogres-trying-to-sober-up-skippy-without-a-bucket-of-water";
  const VARIANT_AFTER = "after-skippy-and-the-mogres";
  const VARIANT_AFTER_SOBER_UP =
    "after-skippy-and-the-mogres-when-using-the-right-click-sober-up-option-after-skippy-and-the-mogres";

  const PLAGUE_CITY_KEY = "plague_city";
  const PLAGUE_CITY_HANGOVER_CURE_STAGE = 26; // PlagueCity.Quest.js STAGE_NEED_HANGOVER_CURE

  // This plugin's own transcript steps (not wiki ids; they only drive its state).
  const ACTION_CHECK_MOVING = "skippy:check-moving";
  const ACTION_THROW_WATER = "skippy:throw-water";
  const MESSAGE_TEA_DRUNK = "skippy:tea-drunk";
  const MESSAGE_CURE_DRUNK = "skippy:cure-drunk";

  const START_MESSAGE =
    "You've started a new miniquest: <col=081190>Skippy and the Mogres</col>";
  const MOVING_MESSAGE =
    "He seems to be moving too fast, try again when he has strumbled to a halt.";

  let quest;

  const inventory = (player) => player.getInventory();
  const has = (player, itemId) => inventory(player).getAmount(itemId) > 0;

  /** Wiki (Bottomless milk bucket): one filled with hangover cure gives Skippy a single use. */
  function bottomlessCure(player) {
    const request = { player, type: HANGOVER_CURE, holds: false };
    api.emitCustomEvent?.("bottomless-milk:holds", request);
    return request.holds;
  }

  /** Plays raw transcript-format steps through the shared NPC dialogue runtime. */
  function play(player, steps, npc = null) {
    const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");
    const definition = NpcDefinition.forId(SKIPPY_NPC_ID);
    const event = { player, npcId: SKIPPY_NPC_ID, npc, definition };
    const context = {
      player,
      npc,
      npcId: SKIPPY_NPC_ID,
      definition,
      pages: [{ page: PAGE, variants: [VARIANT_BEFORE] }],
    };
    startDialogue(api, event, steps, {}, context);
  }

  function playVariant(player, variant, npc = null) {
    return startTranscript(api, player, SKIPPY_NPC_ID, PAGE, variant, undefined, npc);
  }

  /** Plague City teaches the cure when Bravek asks for one. */
  function knowsHangoverCureRecipe(player) {
    const request = { player, key: PLAGUE_CITY_KEY, stage: 0 };
    api.emitCustomEvent("quest:get-stage", request);
    return Number(request.stage) >= PLAGUE_CITY_HANGOVER_CURE_STAGE;
  }

  // ---- Transcript sections -------------------------------------------------

  /** "Using a bucket of water on Skippy to sober him up". */
  const WATER_TALK = [
    { player: "Hey, Skippy!" },
    { npc: "What?" },
    { type: "message", text: "The player tosses a bucket of water over Skippy" },
    { npc: "Ahhhhhhhhhhgh! That's cold! Are you trying to kill me?" },
    { player: "Nope, just sober you up. Memory coming back yet?" },
    {
      npc: "No. But I could do with a bowl of tea to warm myself up a bit. Go grab me one and we'll talk.",
    },
    { player: "Any particular type of tea?" },
    { npc: "Nettle for preference. Just make sure it's hot." },
    { npc: "And don't throw it at me!" },
    { player: "What's your problem? You're all clean now." },
  ];

  /** The toss itself: consumes the water and starts the miniquest. */
  const THROW_WATER = [{ type: "action", id: ACTION_THROW_WATER }, ...WATER_TALK];

  /** "Talking to him before obtaining nettle tea". */
  const AFTER_WATER_TALK = [
    { player: "Hey, Skippy!" },
    { npc: "Gaah! Don't drench me again!" },
    { player: "Hey! I only did that once! Try not to be such a big baby!" },
    { npc: "So what are you here for then?" },
    { player: "No real reason. I just thought I would check up on you is all." },
    { npc: "Well, I'm still wet, still cold and still waiting on that nettle tea." },
  ];

  /** "Giving Skippy nettle tea" and its hangover-cure recipe branch. */
  const TEA_TALK = [
    { player: "Hey, Skippy!" },
    { npc: "Gaah! Don't drench me again!" },
    { player: "Hey! I only did that once! Try not to be such a big baby!" },
    { npc: "So what are you here for then?" },
    { player: "I've come to give you your tea." },
    { npc: "Excellent! I was thinking I was going to freeze out here!" },
    {
      type: "message",
      text: "Skippy drinks the tea and clutches his forehead in pain.",
      id: MESSAGE_TEA_DRUNK,
    },
    { npc: "Ohhhhh..." },
    { player: "What? What's wrong?" },
    { npc: "Not so loud...I think I have a hangover..." },
    {
      player: "Great...Well, I doubt you can remember anything through a hangover. What a waste of nettle tea...",
    },
    { npc: "Hey! A little sympathy here?" },
    { npc: "Owwowwoww... must remember not to shout..." },
    {
      npc: "Look, I do know a hangover cure. If you can get me a bucket of the stuff I think I'll be ok.",
    },
  ];

  /** The recipe asks for Plague City's version once the player has learned it. */
  function teaRecipeSteps(player) {
    if (knowsHangoverCureRecipe(player)) {
      return [
        { player: "Wait... is this cure a bucket of chocolate milk and snape grass?" },
        { npc: "Yes! That's the stuff!" },
        {
          player: "Ahhh. Yes, I've made some of that stuff before. I should be able to get you some, no problem.",
        },
      ];
    }
    return [
      { player: "So what is it you need?" },
      {
        npc: "A bucket of milk with chocolate ground into it, with a handful of snape grass thrown in on top.",
      },
      { player: "What? Run that past me again?" },
      { npc: "Take a bucket of milk, a bar of chocolate and some snape grass." },
      { npc: "Grind the chocolate with a mortar and pestle." },
      { npc: "Add the chocolate powder to the milk, then add the snape grass." },
      { npc: "Then bring it here and I will drink it." },
      { npc: "The end, and we all live happily ever after. Got it?" },
    ];
  }

  /** "Talking to him before obtaining hangover cure". */
  function beforeCureTalk() {
    return [
      { player: "Hey, Skippy!" },
      { npc: "Egad! Don't you know not to shout around a guy with a hangover?" },
      { npc: "Ahhhhhg...No more shouting for me..." },
      { npc: "What is it anyway?" },
      { player: "I just came back to ask you something." },
      { npc: "What?" },
      {
        type: "choice",
        options: [
          {
            text: "How do I make that hangover cure again?",
            steps: [
              { player: "How do I make that hangover cure again?" },
              { npc: "Give me strength...Here's what you do. Pay attention!" },
              { npc: "You take a bucket of milk, a bar of chocolate and some snape grass." },
              { npc: "Grind the chocolate with a pestle and mortar." },
              { npc: "Add the chocolate powder to the milk, then add the snape grass." },
              { npc: "Then bring it here and I will drink it." },
              {
                npc: "Are you likely to remember that or should I go get some crayons and draw you a picture?",
              },
              { player: "Hey! I remember it now, ok! See you in a bit." },
            ],
          },
          {
            text: "Why do they call you 'Skippy'?",
            steps: [
              { player: "Why do they call you Skippy?" },
              {
                npc: "I think it may have something to do with my near- constant raving about mudskippers.",
              },
              {
                npc: "That or it's something to do with that time with the dress and the field full of daisies...",
              },
            ],
          },
        ],
      },
    ];
  }

  /** "Bringing him the hangover cure". */
  const CURE_TALK = [
    { player: "Hey, Skippy!" },
    { npc: "Egad! Don't you know not to shout around a guy with a hangover?" },
    { npc: "Ahhhhhg...No more shouting for me..." },
    { npc: "What is it anyway?" },
    {
      player: "Well Skippy, you will no doubt be glad to hear that I got you your hangover cure!",
    },
    { npc: "Gimme!" },
    {
      type: "message",
      text: "Skippy chugs the hangover cure... very impressive.",
      id: MESSAGE_CURE_DRUNK,
    },
    { npc: "Ahhhhhhhhhhhhhhh..." },
    { npc: "Much better..." },
    { player: "Feeling better?" },
    { npc: "Considerably." },
    { player: "Then tell me where the mudskippers are!" },
    {
      npc: "I wish you wouldn't go looking for them. Those vicious killers will tear you apart.",
    },
    { npc: "It's all becoming clear to me now..." },
    { npc: "I was fishing using a Fishing Explosive..." },
    { player: "A Fishing Explosive?" },
    {
      npc: "Well, Slayer Masters sell these highly volatile potions for killing underwater creatures.",
    },
    {
      npc: "If you don't feel like lobbing a net about all day you can use them to fish with...",
    },
    {
      npc: "But this time I was startled by what I thought was a giant mudskipper.",
    },
    { npc: "What it was, infact, was a..." },
    { npc: "Dramatic Pause..." },
    { npc: "A Mogre!" },
    { player: "What exactly is a Mogre?" },
    { npc: "A Mogre is a type of Ogre that spends most of its time underwater." },
    {
      npc: "They hunt giant mudskippers by wearing their skins and swimming close until they can attack them.",
    },
    {
      npc: "When I used the Fishing Explosive I scared off all the fish, and so the Mogre got out of the water to express its extreme displeasure.",
    },
    { npc: "With an iron mace." },
    {
      player: "I take it the head injury is responsible for the staggering and yelling?",
    },
    { npc: "No, no." },
    { npc: "My addiction to almost-lethal alcohol did that." },
    {
      npc: "But if you are set on finding these Mogres just head south from here until you find Mudskipper Point.",
    },
    {
      player: "The mudskipper-eating monsters are to be found at Mudskipper point?",
    },
    { player: "Shock!" },
    { player: "Thanks. I'll be careful." },
  ];

  // ---- Interactions --------------------------------------------------------

  function talkToSkippy(event) {
    const { player, npc } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      playVariant(player, VARIANT_AFTER, npc);
      return true;
    }
    if (stage === STAGE_HANGOVER) {
      play(player, beforeCureTalk(), npc);
      return true;
    }
    if (stage === STAGE_STARTED) {
      play(player, AFTER_WATER_TALK, npc);
      return true;
    }
    playVariant(player, VARIANT_BEFORE, npc);
    return true;
  }

  function handleSoberUp(event) {
    const { player, npc } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      playVariant(player, VARIANT_AFTER_SOBER_UP, npc);
      return true;
    }
    // The wiki has no Sober-Up wording for the damp or hungover forms.
    if (stage !== 0) return true;
    if (!has(player, BUCKET_OF_WATER)) {
      playVariant(player, VARIANT_WITHOUT_BUCKET, npc);
      return true;
    }
    play(
      player,
      [
        {
          player:
            "Well, I could dump this bucket of water over him. That would sober him up a little...",
        },
        {
          type: "choice",
          options: [
            { text: "Throw the water!", steps: [{ type: "action", id: ACTION_CHECK_MOVING }, ...THROW_WATER] },
            {
              text: "I think I'll leave it for now.",
              steps: [{ player: "I think I'll leave it for now." }],
            },
          ],
        },
      ],
      npc
    );
    return true;
  }

  function handleItemOnSkippy(event) {
    const { player, itemId, npcId, definition, target } = event;
    const name = definition?.getName?.();
    if (!SKIPPY_NPC_IDS.has(npcId) && name !== SKIPPY_NAME) return;
    const stage = quest.getStage(player);
    if (itemId === BUCKET_OF_WATER && stage === 0) {
      event.handled = true;
      play(player, THROW_WATER, target);
      return;
    }
    if (itemId === NETTLE_TEA && stage === STAGE_STARTED) {
      event.handled = true;
      play(player, [...TEA_TALK, ...teaRecipeSteps(player)], target);
      return;
    }
    if ((itemId === HANGOVER_CURE || (itemId === BOTTOMLESS_MILK_BUCKET && bottomlessCure(player))) && stage === STAGE_HANGOVER) {
      event.handled = true;
      play(player, CURE_TALK, target);
    }
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (stepId === ACTION_CHECK_MOVING) {
      if (event.npc?.getMovementQueue?.().isMovings?.()) {
        player.sendMessage(MOVING_MESSAGE);
        event.handled = true;
        event.end = true;
      }
      return;
    }
    if (stepId === ACTION_THROW_WATER) {
      if (quest.getStage(player) !== 0 || !has(player, BUCKET_OF_WATER)) {
        event.handled = true;
        event.end = true;
        return;
      }
      inventory(player).deleteNumber(BUCKET_OF_WATER, 1);
      inventory(player).adds(BUCKET, 1);
      quest.setStage(player, STAGE_STARTED);
      player.sendMessage(START_MESSAGE);
      return;
    }
    if (stepId === MESSAGE_TEA_DRUNK) {
      if (quest.getStage(player) !== STAGE_STARTED || !has(player, NETTLE_TEA)) {
        event.handled = true;
        event.end = true;
        return;
      }
      inventory(player).deleteNumber(NETTLE_TEA, 1);
      quest.setStage(player, STAGE_HANGOVER);
      event.box = { items: [NETTLE_TEA] };
      return;
    }
    if (stepId === MESSAGE_CURE_DRUNK) {
      if (quest.getStage(player) !== STAGE_HANGOVER || (!has(player, HANGOVER_CURE) && !bottomlessCure(player))) {
        event.handled = true;
        event.end = true;
        return;
      }
      if (has(player, HANGOVER_CURE)) inventory(player).deleteNumber(HANGOVER_CURE, 1);
      else api.emitCustomEvent?.("bottomless-milk:spend", { player, type: HANGOVER_CURE, spent: false });
      quest.complete(player);
    }
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I sobered Skippy up with a bucket of water, a bowl of</str>",
        "<str>nettle tea and a hangover cure.</str>",
        "<str>He told me how to chase mogres out of the water with</str>",
        "<str>fishing explosives.</str>",
        "",
        "<col=ff0000>MINIQUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_HANGOVER) {
      return [
        "<str>I gave Skippy the nettle tea, but now he has a hangover.</str>",
        "I should bring him a <col=800000>hangover cure</col>: a bucket of",
        "milk with <col=800000>chocolate dust</col> and <col=800000>snape grass</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I threw a bucket of water over Skippy to sober him up.</str>",
        "He wants a bowl of <col=800000>nettle tea</col>. Nettles grow south",
        "of the <col=800000>Draynor Village</col> jail and near the",
        "<col=800000>Edgeville</col> yew trees; boil nettle-water on a range",
        "or fire.",
      ];
    }
    return [
      "I can start this miniquest by talking to",
      "<col=800000>Skippy</col> south-east of <col=800000>Rimmington</col>, near the",
      "shores.",
      "",
      "There aren't any requirements to start this miniquest.",
    ];
  }

  quest = registerQuest(api, {
    key: "skippy_and_the_mogres",
    name: "Skippy and the Mogres",
    varpId: VARP_SKIPPY_STATE,
    varbitId: VARBIT_SKIPPY_STATE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    otherRewards: ["The ability to slay mogres at 32 Slayer"],
    buildJournal,
  });

  // The cache gives Skippy's variants the option "Talk-To" (capital T), unlike most NPCs.
  api.onNpcInteraction(SKIPPY_NAME, {
    "Talk-to": talkToSkippy,
    "Talk-To": talkToSkippy,
    "Sober-Up": handleSoberUp,
  });
  api.onItemOnNpc(handleItemOnSkippy);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
};
