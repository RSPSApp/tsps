/**
 * Curse of the Empty Lord (miniquest, members).
 *
 * Wiki: https://oldschool.runescape.wiki/w/Curse_of_the_Empty_Lord
 *       https://oldschool.runescape.wiki/w/Transcript:Curse_of_the_Empty_Lord
 *       https://oldschool.runescape.wiki/w/Ghostly_robes
 *
 * Six mysterious ghosts, visible only through a ring of visibility (RingOfVisibility.plugin.js
 * sets `shadow_realm_visibility`) and heard only with a ghostspeak amulet or Morytania legs 2+,
 * tell their story in turn: Valdez at Glarial's Tomb, then Rennard, Kharrim, Lennissa, Dhalak and
 * Viggora. Each gives a ghostly robe piece. Valdez sends the player along one of three sequences of
 * spots; every ghost stands at all three spots, but only its spot in the player's sequence
 * progresses the miniquest.
 *
 * Cache (quest row `miniquest_curseoftheemptylord`, id 89): progress is varbit 13713
 * `curseofzaros` (varp 520 bits 15-17), complete at 6. The sequence is varbit 815
 * `secret_ghost_randomiser` (1-3); the cache's own clue-helper script (script6657) maps 1, 2, 3 to
 * Viggora's Rogues' Castle, Slayer Tower and Edgeville Dungeon targets, which are the Wiki's
 * sequences 1, 2 and 3. Varbits 816-821 `secret_ghost<N>_backstory` mark each story heard (the
 * museum's kudos script reads the sixth). Live captures of finished accounts carry randomiser 2,
 * all six backstory bits and curseofzaros 6. The sixteen spawned ghosts are `secret_ghost1..16`:
 * 1 is Valdez, then three spots each for Rennard (2-4), Dhalak (5-7), Kharrim (8-10), Lennissa
 * (11-13) and Viggora (14-16), in sequence order.
 *
 * Speech is the imported miniquest transcript (first and repeat talks, with each ghost's three
 * location branches) and the ghosts' own NPC pages (no ghostspeak, wrong spot, after the miniquest
 * with robe reclaiming). Historian Minas's report and lamp are in Museum.plugin.js. Viggora's
 * master clue part asks this plugin through `curse-of-the-empty-lord:viggora`.
 *
 * Gaps:
 * - Talking to a ghost before the previous one has sent the player to it plays the transcript's
 *   "in the wrong location" chatter; no source says what live does there.
 * - The transcript names the reclaim chooser only as the "Ghostly robes reclaim interface"; it is
 *   the native item chooser here, with the six pieces.
 * - The cache lists Desert Treasure and The Restless Ghost as requirements. They are what give the
 *   ring and the amulet, so no separate start check is made. The cache's 31 Prayer is, per the
 *   Wiki, "not required to start": it is only for the upstairs of Edgeville Monastery, where
 *   Dhalak stands in the second sequence, so it is left to that floor's own check.
 */
module.exports = function registerCurseOfTheEmptyLordQuest(api) {
  const { ItemIdentifiers: I, Equipment, Skill } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const QUEST_KEY = "curse_of_the_empty_lord";
  const VARP = 520;
  const VARBIT_PROGRESS = 13713;
  const VARBIT_SEQUENCE = 815;
  const VARBIT_FIRST_BACKSTORY = 816;
  const STAGE_COMPLETE = 6;
  const SEQUENCE_ATTRIBUTE = "curse-of-the-empty-lord:sequence";
  const VIGGORA_EVENT = "curse-of-the-empty-lord:viggora";
  const PAGE = "Curse of the Empty Lord";
  const RECLAIM_INTERFACE = "Ghostly robes reclaim interface";

  const GHOSTSPEAK_AMULETS = new Set([I.GHOSTSPEAK_AMULET, I.GHOSTSPEAK_AMULET_2]);
  const MORYTANIA_LEGS_2_UP = new Set([I.MORYTANIA_LEGS_2, I.MORYTANIA_LEGS_3, I.MORYTANIA_LEGS_4]);
  const ROBES = [I.GHOSTLY_ROBE, I.GHOSTLY_GLOVES, I.GHOSTLY_BOOTS, I.GHOSTLY_ROBE_2, I.GHOSTLY_HOOD, I.GHOSTLY_CLOAK];

  /**
   * The ghosts in story order. `spawns` are the secret_ghost ids at sequence 1, 2 and 3; `here`
   * is how the ghost before it names each spot in its location branches.
   */
  const GHOSTS = [
    { name: "Valdez", npcId: 3452, spawns: [6104] },
    { name: "Rennard", npcId: 3450, spawns: [6105, 6106, 6107],
      here: ["near the Pirates' Hideout", "in the Wilderness Bandit Camp", "in The Big Heist Lodge"] },
    { name: "Kharrim", npcId: 3453, spawns: [6111, 6112, 6113],
      here: ["in the Chaos Temple (church)", "in the Graveyard of Shadows", "in the Lava Maze"] },
    // Wiki: Morytania legs can't be used for Lennissa at Entrana church.
    { name: "Lennissa", npcId: 3454, spawns: [6114, 6115, 6116], amuletOnly: [6114],
      here: ["in the Entrana church", "in Port Sarim", "in the Tree Gnome Stronghold"] },
    { name: "Dhalak", npcId: 3451, spawns: [6108, 6109, 6110],
      here: ["in the Wizards' Tower", "in the Edgeville Monastery", "in the Falador Party Room"] },
    { name: "Viggora", npcId: 3455, spawns: [6117, 6122, 6123],
      here: ["in the Rogues' Castle", "in the Slayer Tower", "in the Edgeville Dungeon"] },
  ];
  const VIGGORA = GHOSTS.length - 1;
  const VIGGORA_LAST_LINE = "He was Zaros.";
  const GHOST_BY_SPAWN = new Map(GHOSTS.flatMap((ghost, index) =>
    ghost.spawns.map((spawn, spot) => [spawn, { ghost, index, sequence: index === 0 ? null : spot + 1 }])));
  const GHOST_BY_NPC = new Map(GHOSTS.map((ghost, index) => [ghost.npcId, index]));

  let quest;
  /** The story being told: the ghost whose turn it is, until its robe is handed over. */
  const telling = new WeakMap();

  const slug = (ghost) => ghost.name.toLowerCase();
  const stageOf = (player) => quest.getStage(player);
  const sequenceOf = (player) => Number(player.getAttribute(SEQUENCE_ATTRIBUTE)) || 0;

  function worn(player, slot) {
    return Number(player.getEquipment().get(slot)?.getId?.());
  }

  /** A ghostspeak amulet, or Morytania legs 2+ except where the Wiki says they don't work. */
  function hears(player, spawnId) {
    if (GHOSTSPEAK_AMULETS.has(worn(player, Equipment.AMULET_SLOT))) return true;
    const ghost = GHOST_BY_SPAWN.get(spawnId)?.ghost;
    return !ghost?.amuletOnly?.includes(spawnId) && MORYTANIA_LEGS_2_UP.has(worn(player, Equipment.LEG_SLOT));
  }

  function sendNativeState(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_SEQUENCE, sequenceOf(player));
    const stage = stageOf(player);
    for (let index = 0; index < GHOSTS.length; index++) sender.sendVarbit(VARBIT_FIRST_BACKSTORY + index, stage > index ? 1 : 0);
  }

  function give(player, itemId, amount = 1) {
    const inventory = player.getInventory();
    for (let i = 0; i < amount; i++) {
      if (inventory.getFreeSlots() > 0) inventory.adds(itemId, 1);
      else inventory.forceAdd(player, new api.core.Item(itemId, 1));
    }
  }

  /** The ghost's story is told: its robe piece, its backstory bit, and the next stage. */
  function storyTold(player, index) {
    if (stageOf(player) !== index) return;
    telling.delete(player);
    give(player, ROBES[index]);
    if (index === VIGGORA) quest.complete(player);
    else quest.setStage(player, index + 1);
    sendNativeState(player);
  }

  /** Valdez's first talk draws the player's sequence (Wiki: one of three). */
  function drawSequence(player) {
    if (sequenceOf(player)) return;
    player.setAttribute(SEQUENCE_ATTRIBUTE, 1 + Math.floor(Math.random() * 3));
    sendNativeState(player);
  }

  function variantFor(player, spawnId) {
    const found = GHOST_BY_SPAWN.get(spawnId);
    if (!found) return null;
    const { ghost, index, sequence } = found;
    const stage = stageOf(player);
    const own = sequence === null || sequence === sequenceOf(player);
    if (!hears(player, spawnId)) return { page: ghost.name, variant: "without-a-ghostspeak-amulet" };
    if (quest.isComplete(player)) {
      return own ? { page: ghost.name, variant: "after-curse-of-the-empty-lord" } : { page: ghost.name, variant: `speaking-to-the-wrong-${slug(ghost)}` };
    }
    // Until Valdez draws it, nobody but Valdez has a spot of the player's.
    if (index > stage) return { page: PAGE, variant: "talking-to-any-mysterious-ghost-in-the-wrong-location" };
    if (!own) return { page: ghost.name, variant: `speaking-to-the-wrong-${slug(ghost)}` };
    if (index === stage) return { page: PAGE, variant: `talking-to-${slug(ghost)}`, telling: index };
    return { page: PAGE, variant: `talking-to-${slug(ghost)}-talking-to-${slug(ghost)}-again` };
  }

  function talkToGhost(event) {
    const { player, npc } = event;
    const spawnId = npc?.getId?.();
    const route = variantFor(player, spawnId);
    if (!route) return false;
    const { ghost, index } = GHOST_BY_SPAWN.get(spawnId);
    // A stage set without Valdez (a quest command) still needs a sequence to follow.
    if ((index === 0 && route.telling === 0) || stageOf(player) > 0) drawSequence(player);
    if (route.telling !== undefined) telling.set(player, route.telling);
    else telling.delete(player);
    return startTranscript(api, player, ghost.npcId, route.page, route.variant, undefined, npc);
  }

  /** Location branches ("If Rennard is in ...:") follow the player's sequence; Dhalak's 99 Magic line. */
  function answerCondition({ player, npcId, text }) {
    if (!GHOST_BY_NPC.has(npcId)) return null;
    const value = String(text ?? "");
    if (value === "If the player has level 99 Magic:") return player.getSkillManager().getMaxLevel(Skill.MAGIC) >= 99;
    if (value === "If the player does not have level 99 Magic:") return player.getSkillManager().getMaxLevel(Skill.MAGIC) < 99;
    for (const ghost of GHOSTS.slice(1)) {
      const spot = ghost.here.findIndex((place) => value === `If ${ghost.name} is ${place}:`);
      if (spot >= 0) return spot + 1 === sequenceOf(player);
    }
    return null;
  }

  /** Reaching the next ghost's location in a first talk means the story was told. */
  function locationGiven({ player, npcId, text }) {
    const index = telling.get(player);
    if (index === undefined || GHOST_BY_NPC.get(npcId) !== index || index === VIGGORA) return;
    if (String(text ?? "").startsWith(`If ${GHOSTS[index + 1].name} is `)) storyTold(player, index);
  }

  /** Viggora has no one to send the player on to; his story ends on its last line. */
  function viggoraFinished(request) {
    const { player, npcId, text } = request;
    if (telling.get(player) !== VIGGORA || npcId !== GHOSTS[VIGGORA].npcId || String(text ?? "").trim() !== VIGGORA_LAST_LINE) return;
    const previous = request.after;
    request.after = () => {
      previous?.();
      storyTold(player, VIGGORA);
    };
  }

  /** Runs once the conversation has closed the chatbox (as Sawmill.plugin.js opens its menu). */
  function nextTick(player, action) {
    const { Task, TaskManager } = api.core;
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(1, null, false);
      }
      execute() {
        this.stop();
        if (player.isRegistered()) action();
      }
    })());
  }

  /** As many as fit; the cursed clothing is free, so a full inventory just gets none. */
  function giveFitting(player, itemId, amount) {
    const wanted = Math.max(0, Number(amount) || 0);
    if (wanted === 0) return;
    const count = Math.min(wanted, player.getInventory().getFreeSlots());
    if (count === 0) player.getInventory().full();
    else give(player, itemId, count);
  }

  function openReclaimMenu(player) {
    const free = player.getInventory().getFreeSlots();
    const menu = new api.core.CreationMenu("Which piece do you want?", ROBES, {
      execute(itemId, amount) { giveFitting(player, itemId, amount); },
    }, { maxAmount: Math.max(1, free), lastAmount: 1 });
    player.getPacketSender().sendCreationMenu(menu);
  }

  function askRobeTops(player) {
    player.setEnteredAmountAction({ execute: (amount) => giveFitting(player, I.GHOSTLY_ROBE, amount) });
    player.getPacketSender().sendEnterAmountPrompt("How many robe tops do you want?");
  }

  /** Robes again (after the miniquest): Valdez asks how many tops; the others open the reclaim chooser. */
  function reclaimRobes(event) {
    const { player, npcId, action, target } = event;
    if (!GHOST_BY_NPC.has(npcId) || !quest.isComplete(player)) return;
    if (action === "open_interface" && target === RECLAIM_INTERFACE) {
      event.handled = true;
      event.end = true;
      nextTick(player, () => openReclaimMenu(player));
      return;
    }
    if (action === "receive" && npcId === GHOSTS[0].npcId && /robe \(top\)/i.test(String(event.text ?? ""))) {
      event.handled = true;
      event.end = true;
      nextTick(player, () => askRobeTops(player));
    }
  }

  function syncOnLogin({ player }) {
    sendNativeState(player);
  }

  /**
   * VIGGORA_EVENT { player, npc?, ready, here }: Viggora's master clue part needs the miniquest up
   * to Viggora (Wiki), and his part is handed over only at the player's own spot.
   */
  function answerViggora(request) {
    const { player, npc } = request;
    if (!player) return;
    request.ready = stageOf(player) >= VIGGORA;
    const sequence = sequenceOf(player);
    request.here = !npc || (sequence > 0 && npc.getId?.() === GHOSTS[VIGGORA].spawns[sequence - 1]);
  }

  const JOURNAL_STEPS = [
    "Valdez told me how the thief Rennard stole the Staff of Armadyl from him.",
    "Rennard told me how he sold the staff to Kharrim the messenger.",
    "Kharrim told me how the spy Lennissa learned of the staff.",
    "Lennissa told me how she reported to her superior, Dhalak.",
    "Dhalak sent me to find the swordsman Viggora.",
    "Viggora told me how Zamorak betrayed the Empty Lord, Zaros.",
  ];
  const NEXT_HINTS = [
    "I should find the thief <col=800000>Rennard</col>; Valdez told me where he went.",
    "I should find <col=800000>Kharrim</col>; Rennard told me where he went.",
    "I should find <col=800000>Lennissa</col>; Kharrim told me where she went.",
    "I should find <col=800000>Dhalak</col>; Lennissa told me where he went.",
    "I should find <col=800000>Viggora</col>; Dhalak told me where he went.",
  ];

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === 0) {
      return [
        "I can start this miniquest by talking to the <col=800000>mysterious ghost</col>",
        "at the entrance of <col=800000>Glarial's Tomb</col>, wearing a ring of",
        "visibility and a ghostspeak amulet.",
      ];
    }
    const lines = JOURNAL_STEPS.slice(0, stage).map((line) => `<str>${line}</str>`);
    if (stage >= STAGE_COMPLETE) return [...lines, "", "<col=ff0000>MINIQUEST COMPLETE!</col>"];
    return [...lines, "", NEXT_HINTS[stage - 1]];
  }

  quest = registerQuest(api, {
    key: QUEST_KEY,
    name: "Curse of the Empty Lord",
    varpId: VARP,
    varbitId: VARBIT_PROGRESS,
    startedValue: 1,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    otherRewards: ["A set of ghostly robes"],
    buildJournal,
  });

  api.persistAttribute(SEQUENCE_ATTRIBUTE, 0);
  api.onNpcInteraction("Mysterious ghost", { "Talk-To": talkToGhost, "Talk-to": talkToGhost });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", locationGiven);
  api.onCustomEvent("npc-dialogue:line", viggoraFinished);
  api.onCustomEvent("npc-dialogue:action", reclaimRobes);
  api.onCustomEvent("player:bootstrap-complete", syncOnLogin);
  api.onCustomEvent(VIGGORA_EVENT, answerViggora);
};
