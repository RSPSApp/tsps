/**
 * Alfred Grimhand's Barcrawl (members miniquest).
 *
 * Words: OSRS Wiki "Transcript:Alfred Grimhand's Barcrawl" and the bar
 * transcripts. Bars, drinks and prices: the wiki's Barcrawl walkthrough table
 * (208 coins in total). Cache: varp 77 barcrawl (0/1 pre-crawl guard, 2
 * post-crawl guard), varbit 13714 barcrawl_progress (quest status), varbit 5668
 * auto_smash_vials, NPC transforms 5227 -> 7285/7724 and item 455.
 *
 * The guard, the ten drinks and the card are played here because the imported
 * transcripts have no executable hand-out for the card and several bar pages
 * omit the Barcrawl option. Normal bar conversations are untouched: a bar is
 * intercepted only while the player carries the card, is mid-crawl and has not
 * yet been signed there. Per-bar signatures are a persisted attribute; varp 77
 * and varbit 13714 are the native client/quest surfaces and are re-sent on login.
 *
 * Stages: 0 unstarted, 1 card held, 2 handed in (cache DB row 4 endstate 2).
 */
module.exports = function registerAlfredGrimhandsBarcrawlQuest(api) {
  const {
    ItemIdentifiers,
    StatementDialogue,
  } = api.core;
  const { registerQuest } = require("../QuestRuntime");
  const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");

  const CARD = ItemIdentifiers.BARCRAWL_CARD;
  const COINS = ItemIdentifiers.COINS;
  const VARP_BARCRAWL = 77; // 0/1 -> barbguard1_precrawl 7285, 2 -> postcrawl 7724
  const VARBIT_PROGRESS = 13714; // barcrawl_progress, 0 unstarted / 1 during / 2 complete
  const VARBIT_AUTO_SMASH = 5668; // auto_smash_vials
  const BARS_ATTRIBUTE = "alfred-grimhands-barcrawl:bars";
  const AUTO_SMASH_ATTRIBUTE = "alfred-grimhands-barcrawl:auto-smash";
  const BARBARIAN_GATE_IDS = new Set([2115, 2116]); // barbariangatel/r, 2545,3569-3570

  const ACTION_START = "barcrawl:start";
  const ACTION_RESTART = "barcrawl:restart";
  const ACTION_DRINK = "barcrawl:drink";
  const ACTION_COMPLETE = "barcrawl:complete";
  const ACTION_AUTO_SMASH_ON = "barcrawl:auto-smash-on";
  const ACTION_AUTO_SMASH_OFF = "barcrawl:auto-smash-off";
  const DRINK_PREFIX = `${ACTION_DRINK}:`;

  const BARS = [
    {
      key: "blue-moon", bit: 1 << 0, name: "Blue Moon Inn", npcs: [1312],
      drink: "Uncle Humphrey's Gutrot", cost: 50,
      offer: [
        { npc: "Oh no not another of you guys. These barbarian barcrawls cause too much damage to my bar." },
        { npc: "You're going to have to pay 50 gold for the Uncle Humphrey's Gutrot." },
      ],
      decline: "I don't have 50 coins.",
      messages: [
        "You buy some Uncle Humphrey's Gutrot.",
        "You drink the Uncle Humphrey's Gutrot.",
        "Your insides feel terrible.",
        "The bartender signs your card.",
      ],
      overhead: "Blearrgh!",
    },
    {
      key: "blurberry", bit: 1 << 1, name: "Blurberry Bar", npcs: [6531],
      drink: "Fire Toad Blast", cost: 10,
      offer: [
        { npc: "Ah, you've come to the best stop on your list! I'll give you my famous Fire Toad Blast! It'll cost you 10 coins." },
      ],
      decline: "I don't have 10 coins right now.",
      messages: [
        "You buy a Fire Toad Blast.",
        "Your mouth and throat burn as you gulp it down.",
        "Blurberry signs your card.",
      ],
    },
    {
      key: "dead-mans-chest", bit: 1 << 2, name: "Dead Man's Chest", npcs: [1314],
      drink: "Supergrog", cost: 15,
      offer: [
        { npc: "Haha time to be breaking out the old Supergrog. That'll be 15 coins please." },
      ],
      decline: "Sorry I don't have 15 coins.",
      messages: [
        "The bartender serves you a glass of strange thick dark liquid.",
        "You wince and drink it.",
        "You stagger backwards.",
        "You think you see 2 bartenders signing 2 barcrawl cards.",
      ],
    },
    {
      key: "dragon-inn", bit: 1 << 3, name: "Dragon Inn", npcs: [1320],
      drink: "Fire Brandy", cost: 12,
      offer: [
        { npc: "I suppose you'll be wanting some Fire Brandy. That'll cost you 12 coins." },
      ],
      decline: "Sorry, I don't have 12 coins.",
      messages: [
        "The bartender hands you a small glass and sets light to the contents.",
        "You blow out the flame and drink it.",
        "Your vision blurs and you stagger slightly.",
        "You can just about make out the bartender signing your barcrawl card.",
      ],
    },
    {
      key: "flying-horse", bit: 1 << 4, name: "Flying Horse Inn", npcs: [1319],
      drink: "Heart Stopper", cost: 8,
      offer: [
        { npc: "Fancy a bit of Heart Stopper then do you? It'll only be 8 coins." },
      ],
      decline: "Sorry, I don't have 8 coins.",
      messages: [
        "The bartender hands you a shot of Heart Stopper.",
        "You grimace and drink it.",
        "You clutch your chest.",
        "Through your tears you see the bartender...",
        "signing your barcrawl card",
      ],
    },
    {
      key: "foresters-arms", bit: 1 << 5, name: "Forester's Arms", npcs: [1318],
      drink: "Liverbane Ale", cost: 18,
      offer: [
        { npc: "Oh you're a barbarian then. Now which of these barrels contained the Liverbane Ale? That'll be 18 coins please." },
      ],
      decline: "Sorry, I don't have 18 coins.",
      messages: [
        "The bartender gives you a glass of Liverbane Ale.",
        "You gulp it down.",
        "The room seems to be swaying.",
        "The bartender scrawls his signature on your card.",
      ],
    },
    {
      key: "jolly-boar", bit: 1 << 6, name: "Jolly Boar Inn", npcs: [1310],
      drink: "Olde Suspiciouse", cost: 10,
      offer: [
        { npc: "Ah, there seems to be a fair few doing that one these days. My supply of Olde Suspiciouse is starting to run low, it'll cost you 10 coins." },
      ],
      decline: "I don't have 10 coins right now.",
      messages: [
        "You buy a pint of Olde Suspiciouse.",
        "You gulp it down.",
        "Your head is spinning.",
        "The bartender signs your card.",
      ],
      finalPlayer: "Thanksh very mush...",
    },
    {
      key: "karamja", bit: 1 << 7, name: "Karamja Spirits Bar", npcs: [13655],
      drink: "Ape Bite Liqueur", cost: 7,
      offer: [
        { npc: "Ah, you'll be wanting some Ape Bite Liqueur then. It's got a lovely banana taste, and it'll only cost you 7 coins." },
      ],
      decline: "I don't have 7 coins right now.",
      messages: [
        "You buy some Ape Bite Liqueur.",
        "You swirl it around and swallow it.",
        "Zembo signs your card.",
      ],
      finalPlayer: "Mmmmm, dat was luverly...",
    },
    {
      key: "rising-sun", bit: 1 << 8, name: "Rising Sun", npcs: [1317, 10668, 1315, 1316],
      drink: "Hand of Death Cocktail", cost: 70,
      offer: [
        { npc: "Heehee, this'll be fun!" },
        { npc: "You'll be after our Hand of Death cocktail, then. Lots of expensive parts to the cocktail, though, so it will cost you 70 coins." },
      ],
      decline: "I don't have that much money on me.",
      messages: [
        "You buy a Hand of Death cocktail.",
        "You drink the cocktail.",
        "You stumble around the room.",
      ],
      signedByNpc: (name) => `${name} giggles and signs your card.`,
    },
    {
      key: "rusty-anchor", bit: 1 << 9, name: "Rusty Anchor", npcs: [1313],
      drink: "Black Skull Ale", cost: 8,
      offer: [
        { npc: "Are you sure? You look a bit skinny for that." },
        { player: "Just give me whatever I need to drink here." },
        { npc: "Ok one Black Skull Ale coming up, 8 coins please." },
      ],
      decline: "I don't have 8 coins with me.",
      messages: [
        "You buy a Black Skull Ale.",
        "You drink your Black Skull Ale...",
        "Your vision blurs.",
        "The bartender signs your card.",
      ],
      overhead: "Hiccup!",
    },
  ];
  const ALL_BARS_MASK = BARS.reduce((mask, bar) => mask | bar.bit, 0);
  const BAR_BY_KEY = new Map(BARS.map((bar) => [bar.key, bar]));
  const BAR_BY_NPC_ID = new Map(BARS.flatMap((bar) => bar.npcs.map((id) => [id, bar])));

  let quest;

  const inventory = (player) => player.getInventory();
  const has = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const freeSlot = (player) => !inventory(player).isFull();
  const bankHasCard = (player) => (player.getBanks?.() ?? [])
    .some((bank) => Number(bank?.getAmount?.(CARD) ?? 0) > 0);

  function barMask(player) {
    return Number(player.getAttribute(BARS_ATTRIBUTE)) | 0;
  }

  function isSigned(player, bar) {
    return (barMask(player) & bar.bit) !== 0;
  }

  function signedCount(player) {
    return BARS.filter((bar) => isSigned(player, bar)).length;
  }

  function sendVar(player, stage) {
    const sender = player.getPacketSender();
    sender.sendConfig(VARP_BARCRAWL, stage >= 2 ? 2 : stage >= 1 ? 1 : 0);
    sender.sendVarbit(VARBIT_PROGRESS, stage >= 2 ? 2 : stage >= 1 ? 1 : 0);
  }

  function syncVars({ player }) {
    if (!player || !quest) return;
    sendVar(player, quest.getStage(player));
    player.getPacketSender().sendVarbit(VARBIT_AUTO_SMASH, player.getAttribute(AUTO_SMASH_ATTRIBUTE) === true ? 1 : 0);
  }

  function giveCard(player) {
    if (!has(player, CARD)) inventory(player).adds(CARD, 1);
  }

  function startCrawl(player) {
    if (quest.getStage(player) >= 1 || !freeSlot(player)) return false;
    player.setAttribute(BARS_ATTRIBUTE, 0);
    quest.setStage(player, 1);
    sendVar(player, 1);
    giveCard(player);
    return true;
  }

  function restartCrawl(player) {
    if (quest.getStage(player) !== 1 || !freeSlot(player)) return false;
    player.setAttribute(BARS_ATTRIBUTE, 0);
    giveCard(player);
    return true;
  }

  function drinkAt(player, bar) {
    if (!bar || quest.getStage(player) !== 1 || !has(player, CARD) || isSigned(player, bar)) return false;
    if (inventory(player).getAmount(COINS) < bar.cost) return false;
    inventory(player).deleteNumber(COINS, bar.cost);
    player.setAttribute(BARS_ATTRIBUTE, barMask(player) | bar.bit);
    return true;
  }

  function setAutoSmash(player, on) {
    player.setAttribute(AUTO_SMASH_ATTRIBUTE, on === true);
    player.getPacketSender().sendVarbit(VARBIT_AUTO_SMASH, on === true ? 1 : 0);
  }

  function completeCrawl(player) {
    if (quest.getStage(player) >= 2) return false;
    if (signedCount(player) !== BARS.length || !has(player, CARD)) return false;
    inventory(player).deleteNumber(CARD, 1);
    sendVar(player, 2);
    quest.complete(player, { scroll: false, announce: false });
    return true;
  }

  function completionSteps() {
    return [
      { npc: "So, how's the Barcrawl coming along?" },
      { player: "I tink I jusht 'bout done dem all... but I losht count..." },
      { type: "message", text: "You give the card to the barbarian.", id: "barcrawl:give-card" },
      { type: "action", action: ACTION_COMPLETE, id: "barcrawl:complete" },
      { npc: "Yep that seems fine, you can come in now. I never learned to read, but you look like you've drunk plenty. Also, one more thing..." },
      { npc: "Since you drink like a barbarian, I can show you how to smash your vials when you finish them. Do you want to do that?" },
      {
        type: "choice",
        options: [
          {
            text: "Yes please, I want to smash my vials.",
            steps: [
              { player: "Yes please, I want to smash my vials." },
              { npc: "It's all part of drinking like a barbarian! Okay, you will now smash your vials as you drink your potions." },
              { type: "action", action: ACTION_AUTO_SMASH_ON, id: "barcrawl:auto-smash-on" },
              { type: "message", text: "Vial smashing is now turned on." },
            ],
          },
          {
            text: "No thank you, I'd rather keep my vials.",
            steps: [{ player: "No thank you, I'd rather keep my vials." }],
          },
        ],
      },
    ];
  }

  function duringSteps(player) {
    const opening = [{ npc: "So, how's the Barcrawl coming along?" }];
    if (has(player, CARD)) {
      if (signedCount(player) === BARS.length) return completionSteps();
      return [
        ...opening,
        { player: "I haven't finished it yet." },
        { npc: "Well come back when you have, you lightweight." },
      ];
    }
    if (bankHasCard(player)) {
      return [
        ...opening,
        { player: "Not too bad. I've got my barcrawl card stored somewhere for safe-keeping." },
        { npc: "You need to take it with you when you're going on a barcrawl." },
      ];
    }
    if (!freeSlot(player)) {
      return [
        ...opening,
        { player: "I've lost my barcrawl card..." },
        { type: "message", text: "You need more inventory space." },
      ];
    }
    return [
      ...opening,
      { player: "I've lost my barcrawl card..." },
      { npc: "What are you like? You're gonna have to start all over now." },
      { type: "action", action: ACTION_RESTART, id: "barcrawl:restart" },
      { type: "message", text: "The guard hands you a Barcrawl card.", id: "barcrawl:card-given" },
    ];
  }

  function preCrawlSteps(player) {
    const barbarian = freeSlot(player)
      ? [
        { player: "Looks can be deceiving, I am in fact a barbarian." },
        { npc: "If you're a barbarian you need to be able to drink like one. We barbarians like a good drink." },
        { npc: "I have the perfect challenge for you... The Alfred Grimhand Barcrawl! First completed by Alfred Grimhand." },
        { type: "action", action: ACTION_START, id: "barcrawl:start" },
        { type: "message", text: "The guard hands you a Barcrawl card.", id: "barcrawl:card-given" },
        { npc: "Take that card to each of the bars named on it. The bartenders will know what it means. We're kinda well known." },
        { npc: "They'll give you their strongest drink and sign your card. When you've done all that, we'll be happy to let you in." },
      ]
      : [
        { player: "Looks can be deceiving, I am in fact a barbarian." },
        { npc: "Are you, now? Free up some space so you can carry something, and we'll see how barbarian you really are." },
      ];
    return [
      { npc: "Oi, whaddya want?" },
      {
        type: "choice",
        options: [
          {
            text: "I want to come through this gate.",
            steps: [
              { player: "I want to come through this gate." },
              { npc: "Barbarians only. Are you a barbarian? You don't look like one." },
              {
                type: "choice",
                options: [
                  { text: "Hmm, yep you've got me there.", steps: [{ player: "Hmm, yep you've got me there." }] },
                  { text: "Looks can be deceiving, I am in fact a barbarian.", steps: barbarian },
                ],
              },
            ],
          },
          {
            text: "I want some money.",
            steps: [
              { player: "I want some money." },
              { npc: "Do I look like a bank to you?" },
            ],
          },
        ],
      },
    ];
  }

  function postCrawlSteps(player) {
    if (player.getAttribute(AUTO_SMASH_ATTRIBUTE) === true) {
      return [
        { npc: "'Ello friend. I see you're drinking like a barbarian - do you want to stop smashing your vials when you finish them?" },
        {
          type: "choice",
          options: [
            {
              text: "Yes please, I want to stop smashing my vials.",
              steps: [
                { player: "Yes please, I want to stop smashing my vials." },
                { npc: "You're a funny sort of barbarian! But okay, you will no longer smash your vials as you drink your potions." },
                { type: "action", action: ACTION_AUTO_SMASH_OFF, id: "barcrawl:auto-smash-off" },
                { type: "message", text: "Vial smashing is now turned off." },
              ],
            },
            {
              text: "No thank you, I like smashing them.",
              steps: [
                { player: "No thank you, I like smashing them." },
                { npc: "That's a proper barbarian spirit, that is." },
              ],
            },
          ],
        },
      ];
    }
    return [
      { npc: "'Ello friend. Do you want me to show you how to smash your vials when you finish drinking them?" },
      {
        type: "choice",
        options: [
          {
            text: "Yes please, I want to smash my vials.",
            steps: [
              { player: "Yes please, I want to smash my vials." },
              { npc: "It's all part of drinking like a barbarian! Okay, you will now smash your vials as you drink your potions." },
              { type: "action", action: ACTION_AUTO_SMASH_ON, id: "barcrawl:auto-smash-on" },
              { type: "message", text: "Vial smashing is now turned on." },
            ],
          },
          {
            text: "No thank you, I'd rather keep my vials.",
            steps: [{ player: "No thank you, I'd rather keep my vials." }],
          },
        ],
      },
    ];
  }

  function talkGuard(event) {
    if (!event?.player) return;
    event.handled = true;
    const stage = quest.getStage(event.player);
    const steps = stage >= 2 ? postCrawlSteps(event.player)
      : stage === 1 ? duringSteps(event.player)
        : preCrawlSteps(event.player);
    startDialogue(api, event, steps);
  }

  function talkBar(event, bar) {
    if (!bar || !event.player) return;
    if (quest.getStage(event.player) !== 1 || !has(event.player, CARD) || isSigned(event.player, bar)) return;
    event.handled = true;
    const player = event.player;
    const steps = [
      { player: "I'm doing Alfred Grimhand's Barcrawl." },
      ...bar.offer,
    ];
    if (inventory(player).getAmount(COINS) >= bar.cost) {
      steps.push({ type: "action", action: ACTION_DRINK, id: `${DRINK_PREFIX}${bar.key}` });
      for (const text of bar.messages) steps.push({ type: "message", text });
      if (bar.finalPlayer) steps.push({ player: bar.finalPlayer });
      if (bar.signedByNpc) steps.push({ type: "message", text: bar.signedByNpc(event.definition.getName()) });
      if (bar.overhead) steps.push({ player: bar.overhead, presentation: "overhead" });
    } else {
      steps.push({ player: bar.decline });
    }
    startDialogue(api, event, steps);
  }

  function npcOption(event) {
    const index = Number(event.clickType) - 1;
    return index >= 0 ? event.definition?.getActions?.()[index] ?? null : null;
  }

  function handleNpcInteraction(event) {
    if (!event?.player) return;
    const option = npcOption(event);
    if (event.npcId === 7285 || event.npcId === 7724 || event.definition?.getName?.() === "Barbarian guard") {
      if (option === "Toggle-vials") {
        event.handled = true;
        const on = event.player.getAttribute(AUTO_SMASH_ATTRIBUTE) !== true;
        setAutoSmash(event.player, on);
        event.player.sendMessage(on ? "Vial smashing is now turned on." : "Vial smashing is now turned off.");
        return;
      }
      if (option === "Talk-to") talkGuard(event);
      return;
    }
    const bar = BAR_BY_NPC_ID.get(event.npcId);
    if (bar && option === "Talk-to") talkBar(event, bar);
  }

  function handleAction(event) {
    if (!event?.player) return;
    if (event.kind === "message") {
      if (event.stepId === "barcrawl:card-given") event.box = { items: [CARD] };
      return;
    }
    const player = event.player;
    if (event.action === ACTION_START) {
      event.handled = true;
      startCrawl(player);
    } else if (event.action === ACTION_RESTART) {
      event.handled = true;
      restartCrawl(player);
    } else if (event.action === ACTION_DRINK) {
      event.handled = true;
      drinkAt(player, BAR_BY_KEY.get(String(event.stepId ?? "").slice(DRINK_PREFIX.length)));
    } else if (event.action === ACTION_COMPLETE) {
      event.handled = true;
      completeCrawl(player);
    } else if (event.action === ACTION_AUTO_SMASH_ON) {
      event.handled = true;
      setAutoSmash(player, true);
    } else if (event.action === ACTION_AUTO_SMASH_OFF) {
      event.handled = true;
      setAutoSmash(player, false);
    }
  }

  function readCard(event) {
    const player = event?.player;
    if (!player) return;
    if (quest.getStage(player) >= 2) {
      StatementDialogue.send(player, "You are too drunk to be able to read the barcrawl card.");
      return;
    }
    const lines = BARS.map((bar) => `${bar.name}: ${isSigned(player, bar) ? "signed" : "not signed"}`);
    StatementDialogue.send(player, `Alfred Grimhand's Barcrawl<br><br>${lines.join("<br>")}`);
  }

  function handleGateToggle(request) {
    if (!request?.player || !BARBARIAN_GATE_IDS.has(Number(request.objectId))) return;
    if (quest.getStage(request.player) >= 2) return;
    const gate = request.location ?? request.object?.getLocation?.();
    if (!gate) return;
    const gateX = Number(gate.getX?.() ?? gate.x);
    const playerX = Number(request.player.getLocation?.().getX?.() ?? 0);
    // The course is east of the gate: block a player on or west of it (opening a
    // gate walks the player onto its west tile first, so `==` is still outside).
    if (playerX > gateX) return;
    request.handled = true;
    request.player.sendMessage("You need to complete Alfred Grimhand's Barcrawl to enter.");
  }

  quest = registerQuest(api, {
    key: "alfred-grimhands-barcrawl",
    name: "Alfred Grimhand's Barcrawl",
    varbitId: VARBIT_PROGRESS,
    startedValue: 1,
    completionValue: 2,
    questPoints: 0,
  });
  api.persistAttribute(BARS_ATTRIBUTE, 0);
  api.persistAttribute(AUTO_SMASH_ATTRIBUTE, false);

  api.onNpcInteraction(handleNpcInteraction);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemAction("Barcrawl card", { Read: readCard });
  api.onCustomEvent("door:toggle", handleGateToggle);
  api.onPlayerLogin(syncVars);
  api.onCustomEvent("player:bootstrap-complete", syncVars);

  const internals = {
    BARS,
    ALL_BARS_MASK,
    barMask,
    isSigned,
    signedCount,
    startCrawl,
    restartCrawl,
    drinkAt,
    completeCrawl,
    setAutoSmash,
    handleAction,
    handleGateToggle,
    syncVars,
  };
  return internals;
};

