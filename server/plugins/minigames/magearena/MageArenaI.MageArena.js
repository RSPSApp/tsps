"use strict";

const QuestRuntime = require("../../quests/QuestRuntime");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

const PROGRESS_VARP = 267;
const STARTED = 1;
const DUEL_WON = 6;
const CAPE_CHOSEN = 7;
const COMPLETE = 8;
const REQUIRED_MAGIC = 60;
const LEGACY_STAFF_RECEIVED_ATTRIBUTE = "mage-arena-i:staff-received";
const ARENA = { minX: 3089, maxX: 3117, minY: 3921, maxY: 3946, levels: [0] };
const ARENA_ARRIVAL = [3105, 3934, 0];
const KOLODION_SPAWN = [3106, 3934, 0];
const BANK_RETURN = [2541, 4717, 0];

// RSProx 3344 rev 235 t3822–3877. The arena remains public Wilderness.
const FORMS = [
  { id: "KOLODION_3", overhead: "You must prove yourself... now!" },
  { id: "KOLODION_4", overhead: "This is only the beginning; you can't beat me!", animation: 134, graphic: 188, height: 124 },
  { id: "KOLODION_5", overhead: "Foolish mortal; I am unstoppable.", animation: 5324, graphic: 190, height: 16 },
  { id: "KOLODION_6", overhead: "Now you feel it... The dark energy.", animation: 715 },
  { id: "KOLODION_7", overhead: "Aaaaaaaarrgghhhh! The power!", animation: 4681, graphic: 191, height: 16 },
];

let api;
let core;
let quest;
const duels = new WeakMap();
const owners = new WeakMap();
const lastMagicReminder = new WeakMap();

function stageOf(player) {
  return quest?.getStage(player) ?? 0;
}

function hasUnfinishedDuel(player) {
  const stage = stageOf(player);
  return stage >= STARTED && stage < DUEL_WON;
}

function canUseArena(player) {
  return stageOf(player) >= STARTED;
}

function canUseRewardChamber(player) {
  return stageOf(player) >= DUEL_WON;
}

function recordCapeChoice(player) {
  if (stageOf(player) < CAPE_CHOSEN) quest.setStage(player, CAPE_CHOSEN);
}

function restoreStaffCompletion({ player }) {
  if (player.getAttribute(LEGACY_STAFF_RECEIVED_ATTRIBUTE) !== true) return;
  if (!quest.isComplete(player)) quest.setStage(player, COMPLETE);
  player.setAttribute(LEGACY_STAFF_RECEIVED_ATTRIBUTE, false);
}

function buildJournal(player) {
  const stage = stageOf(player);
  if (stage === 0) return ["I can start by talking to Kolodion in the Mage Arena bank. I need level 60 Magic."];
  if (stage < DUEL_WON) return ["Kolodion has challenged me to a duel in the Mage Arena."];
  if (stage < CAPE_CHOSEN) return ["I defeated Kolodion. I should enter the sparkling pool and choose a god to represent."];
  if (stage < COMPLETE) return ["I chose a god to represent. I should speak to the Chamber guardian for my staff."];
  return ["<str>I defeated Kolodion, chose a god to represent, and received my staff.</str>", "", "<col=ff0000>MINIQUEST COMPLETE!</col>"];
}

/** RSProx 3344 t3801–3818 and t3877–3882; alternate responses are in Transcript:Mage Arena I. */
function show(player, lines, next, npcId = core.NpcIdentifiers.KOLODION) {
  const chain = new core.DialogueChainBuilder();
  for (const [index, line] of lines.entries()) {
    chain.add(typeof line === "string"
      ? new core.NpcDialogue(index, npcId, line)
      : new core.PlayerDialogue(index, line.player));
  }
  if (typeof next === "function") {
    chain.add(new core.ActionDialogue(lines.length, { execute: next }));
  } else if (next) {
    chain.add(new core.OptionDialogue(lines.length, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        const selected = next[Number(option) - 1];
        if (selected) selected[1]();
      },
    }, ...next.map(([text]) => text)));
  }
  player.getDialogueManager().startDialogues(chain);
}

function introduction(player, repeat = false) {
  show(player, repeat ? [] : [
    { player: "Hello there. What is this place?" },
    "I am the great Kolodion, master of battle magic, and this is my battle arena. Top wizards travel from all over Gielinor to fight here.",
  ], [
    ["Can I fight here?", () => show(player, [
      { player: "Can I fight here?" },
      "My arena is open to any high level wizard, but this is no game. Many wizards fall in this arena, never to rise again. The strongest mages have been destroyed.",
      "If you're sure you want in?",
    ], joinOptions(player))],
    ["What's the point of that?", () => show(player, [
      { player: "What's the point of that?" },
      "We learn how to use our magic to its fullest and how to channel the forces of the cosmos into our world...",
      "But mainly, I just like blasting people into dust.",
    ], () => introduction(player, true))],
    ["That's barbaric!", () => show(player, [
      { player: "That's barbaric!" },
      "Nope, it's magic. But I know what you mean. So do you want to join us?",
    ], joinOptions(player))],
  ]);
}

function joinOptions(player) {
  return [
    ["Yes indeedy.", () => show(player, [
      { player: "Yes indeedy." },
      "Good, good. You have a healthy sense of competition.",
      "Remember, traveller - in my arena, hand-to-hand combat is useless. Your strength will diminish as you enter the arena, but the spells you can learn are amongst the most powerful in all of Gielinor.",
      "Before I can accept you in, we must duel.",
    ], [
      ["Okay, let's fight.", () => show(player, [
        { player: "Okay, let's fight." },
        "I must first check that you are up to scratch.",
        { player: "You don't need to worry about that." },
        "Not just any magician can enter - only the most powerful and most feared. Before you can use the power of this arena, you must prove yourself against me.",
      ], () => enterDuel(player))],
      ["No thanks.", () => show(player, [{ player: "No thanks." }])],
    ])],
    ["No I don't.", () => show(player, [{ player: "No I don't." }, "Your loss."])],
  ];
}

function afterDuel(player, returning) {
  show(player, [
    ...(returning ? ["Well done, young adventurer; you truly are a worthy battle mage."]
      : [{ player: "Hello, Kolodion." }, "Hello, young mage. You're a tough one."]),
    { player: "What now?" },
    "Step into the magic pool. It will take you to a chamber. There, you must decide which god you will represent in the arena.",
    { player: "Thanks, Kolodion." },
    "That's what I'm here for.",
  ]);
}

function talkToKolodion({ player, npcId }) {
  if (npcId !== core.NpcIdentifiers.KOLODION) return false;
  const stage = stageOf(player);
  if (stage >= CAPE_CHOSEN) return false;
  if (stage === DUEL_WON) {
    afterDuel(player, false);
    return true;
  }
  if (player.getSkillManager().getMaxLevel(core.Skill.MAGIC) < REQUIRED_MAGIC) return false;
  introduction(player);
  return true;
}

function refuseArena(player) {
  show(player, ["You're not allowed in there. Come downstairs if you want to enter my arena."]);
}

function chosenStaff(player) {
  const items = core.ItemIdentifiers;
  for (const god of ["SARADOMIN", "GUTHIX", "ZAMORAK"]) {
    const cape = items[`${god}_CAPE`];
    if (player.getInventory().contains(cape) || player.getEquipment().contains(cape)) {
      return items[`${god}_STAFF`];
    }
  }
  return null;
}

function grantStaff(player) {
  const staff = chosenStaff(player);
  if (!staff || quest.isComplete(player)) return;
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space for the staff.");
    return;
  }
  player.getInventory().adds(staff, 1);
  quest.complete(player, { scroll: false, announce: false });
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.ItemStatementDialogue(0, staff, "The guardian hands you an ornate magic staff.")
  ));
}

/** First staff from the guardian, RSProx 3344 t3904–3908 and t3961–3965. */
function talkToGuardian({ player, npcId }) {
  if (!canUseRewardChamber(player) || quest.isComplete(player)) return false;
  if (stageOf(player) === DUEL_WON) {
    show(player, [
      { player: "Hello my friend, Kolodion sent me down." },
      "Sssshhh... the gods are talking. I can hear their whispers.",
      "Can you hear them adventurer, they're calling you.",
      { player: "Erm... ok!" },
      "Go chant at the statue of the god you most wish to represent in this world, you will be rewarded.",
      "Once you are done, come back to me. I shall supply you with a mage staff ready for battle.",
    ], null, npcId);
    return true;
  }
  const opening = [
    { player: "Hi." },
    "Hello adventurer, have you made your choice?",
    { player: "I have." },
  ];
  if (chosenStaff(player)) {
    show(player, [...opening,
      "Good, good, I hope you have chosen well. I will now present you with a magic staff. This, along with the cape awarded to you by your chosen god, are all the weapons and armour you will need here.",
    ], () => grantStaff(player), npcId);
  } else {
    show(player, [...opening,
      "Good, good, I hope you have chosen well. Have you been rewarded with a cape from your chosen god?",
      { player: "I'm afraid I don't have it with me." },
      "Once you have your cape come back to me, and I shall supply you with a mage staff ready for battle.",
    ], null, npcId);
  }
  return true;
}

function enterDuel(player) {
  if (canUseRewardChamber(player) || ObstacleRunner.isBusy(player)) return;
  if (stageOf(player) === 0) quest.setStage(player, STARTED);
  player.getPacketSender().sendInterfaceRemoval();
  ObstacleRunner.run({ player }, [
    { anim: 714 }, { gfx: 111, height: 92 }, { sound: 200 },
    { wait: 4 }, { tele: ARENA_ARRIVAL },
  ]);
}

function clearDuel({ player }) {
  const npc = duels.get(player);
  if (!npc) return;
  duels.delete(player);
  owners.delete(npc);
  npc.getCombat().reset();
  npc.getCombat().getHitQueue().clear();
  api.removeNpc(npc);
}

function showForm(npc, form) {
  if (form.animation) npc.performAnimation(new core.Animation(form.animation));
  if (form.graphic) npc.performGraphic(new core.Graphic(form.graphic, 0, form.height));
  npc.forceChat(form.overhead);
}

function startFight({ player }) {
  const form = FORMS[stageOf(player) - STARTED];
  if (!form || duels.has(player)) return;
  const [x, y, z] = KOLODION_SPAWN;
  const npc = api.spawnNpc({ id: core.NpcIdentifiers[form.id], x, y, z, owner: player, ownerOnly: true, wanderRadius: 0 });
  if (!npc) return;
  duels.set(player, npc);
  owners.set(npc, player);
  api.getTaskManager().submit(new core.CountdownTask(player, 2, () => {
    if (duels.get(player) !== npc || !npc.isRegistered()) return;
    showForm(npc, form);
    npc.getCombat().attack(player);
  }));
}

function restrictAttacks(event) {
  const player = owners.get(event.target);
  if (!player) return;
  if (event.attacker === player && event.method?.type() === core.CombatType.MAGIC) return;
  event.allow = false;
  if (event.attacker === player) {
    const tick = core.World.getProcessCycle();
    if (tick - (lastMagicReminder.get(player) ?? -10) >= 10) {
      lastMagicReminder.set(player, tick);
      player.sendMessage("You can only use Magic against Kolodion.");
    }
  }
}

function protectDuel({ npc, hit }) {
  const player = owners.get(npc);
  if (!player || (hit.getAttacker() === player && hit.getCombatType() === core.CombatType.MAGIC)) return;
  hit.setTotalDamage(0);
}

function returnToBank(player) {
  if (!player.isRegistered()) return;
  player.moveTo(new core.Location(...BANK_RETURN));
  afterDuel(player, true);
}

function advanceForm(event) {
  const { npc } = event;
  const player = owners.get(npc);
  if (!player) return;
  event.preventDeath = true;
  const next = stageOf(player) + 1;
  quest.setStage(player, next);
  const form = FORMS[next - STARTED];
  if (!form) {
    clearDuel({ player });
    returnToBank(player);
    return;
  }
  npc.getCombat().reset();
  npc.getCombat().getHitQueue().clear();
  npc.setNpcTransformationId(core.NpcIdentifiers[form.id]);
  npc.setHitpoints(npc.getMaxHitpoints());
  showForm(npc, form);
  npc.getCombat().attack(player);
}

module.exports = function registerMageArenaI(pluginApi) {
  api = pluginApi;
  core = api.core;
  quest = QuestRuntime.registerQuest(api, {
    key: "mage_arena_i",
    name: "Mage Arena I",
    varpId: PROGRESS_VARP,
    startedValue: STARTED,
    completionValue: COMPLETE,
    questPoints: 0,
    buildJournal,
    otherRewards: ["God capes, a matching god staff, and access to the Mage Arena"],
  });
  ObstacleRunner.init(api);
  // Keep reading saves from the first version, which recorded the staff separately at stage 7.
  api.persistAttribute(LEGACY_STAFF_RECEIVED_ATTRIBUTE, false);
  api.onPlayerLogin(restoreStaffCompletion);
  api.onNpcInteraction("Kolodion", { "Talk-to": talkToKolodion });
  api.onNpcInteraction("Chamber guardian", { "Talk-to": talkToGuardian });
  api.onZoneEnter(ARENA, startFight);
  api.onZoneExit(ARENA, clearDuel);
  api.onPlayerLogout(clearDuel);
  api.onCanAttack(restrictAttacks);
  api.onNpcHitModify(protectDuel);
  api.onNpcBeforeDeath(advanceForm);
};

Object.assign(module.exports, { hasUnfinishedDuel, canUseArena, canUseRewardChamber, recordCapeChoice, refuseArena });
