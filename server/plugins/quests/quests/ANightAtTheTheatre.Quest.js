/**
 * A Night at the Theatre. Dialogue: bundled OSRS Wiki transcript; mechanics:
 * https://oldschool.runescape.wiki/w/A_Night_at_the_Theatre/Quick_guide
 * Cache gamevals tobquest (12276 / varp 3055), dump:loc and NPC definitions.
 */
module.exports = function registerANightAtTheTheatre(api) {
  const { Location, Equipment, Skill, NpcIdentifiers: N, ItemIdentifiers: I,
    PrivateArea, Boundary, ObjectManager, GameObject } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");
  const PAGE = "A Night at the Theatre";
  const STRANGER_PAGE = "Mysterious Stranger";
  // The wiki's separate "So about that memory..." conversation, played after the
  // head hand-in; it carries the line that ends the first-memory leg.
  const FIRST_MEMORY_VARIANT = "talking-to-the-mysterious-stranger-after-getting-ranis-head-after-finishing-the-first-memory-cutscene";
  // The Mysterious Stranger's teleport crystal shop (escape crystals).
  const MYSTERIOUS_STRANGER_SHOP = 1240;
  const LAMPS_ATTRIBUTE = "night-at-the-theatre:lamps-used";
  const NOTE_ATTRIBUTE = "night-at-the-theatre:note-read";
  const ACID_ATTRIBUTE = "night-at-the-theatre:acid-given";
  const HEAD_ATTRIBUTE = "night-at-the-theatre:head-removed";
  const GATE_ATTRIBUTE = "night-at-the-theatre:crypt-unlocked";
  const EGGS_OPENED_ATTRIBUTE = "night-at-the-theatre:egg-sac-opened";
  const LAMP = I.ANTIQUE_LAMP_23;
  const CRYPT_ENTRANCE = 42523;
  const CRYPT_EXIT = 42524;
  const CRYPT_GATE = 42529;
  const COFFIN = 30243;
  const EMPTY_COFFIN = 42532;
  const EGG_SAC = 33111;
  const ACID_EGG_SAC = 42601;
  const OPEN_EGG_SAC = 42603;
  const SEARCHABLE_SKELETON = 42605;
  const WILD_HESPORI = 42591;
  const DEAD_HESPORI = 42592;
  const SKELETON = 33112;
  const HESPORI = 31952;
  const STEPPING_STONE = 42588;
  const ESCAPE_STONE = 42589;
  const CRYPT_VYRES = [N.VYREWATCH_76, N.VYREWATCH_77, N.VYREWATCH_78, N.VYREWATCH_79];
  const combatSkills = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS];
  const stage = player => quest.getStage(player);
  const held = (player, id) => player.getInventory().contains(id);
  const equipped = (player, id) => player.getEquipment().getItems().some(item => item?.getId() === id);
  const value = (player, key) => Number(player.getAttribute(key)) || 0;
  function advance(player, next) { if (stage(player) < next) quest.setStage(player, next); }
  function give(player, id) {
    if (held(player, id)) return true;
    if (!player.getInventory().getFreeSlots()) { player.sendMessage("You need a free inventory space."); return false; }
    player.getInventory().adds(id, 1);
    return true;
  }
  function play(player, npcId, variant) { return startTranscript(api, player, npcId, PAGE, variant); }
  function requirement(player) {
    const request = { player, key: "taste_of_hope", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete;
  }
  function hasRaidCompletion(player) {
    const request = { player, complete: false };
    api.emitCustomEvent("tob:has-completion", request);
    return request.complete;
  }
  function claimLamps(player) {
    let claimed = value(player, LAMPS_ATTRIBUTE) + player.getInventory().getAmount(LAMP) + player.getBank().getAmount(LAMP);
    while (claimed < 4 && player.getInventory().getFreeSlots()) {
      player.getInventory().adds(LAMP, 1);
      claimed++;
    }
    if (claimed < 4) player.sendMessage("Make room and speak to the Mysterious Stranger to collect your remaining lamps.");
  }
  const quest = registerQuest(api, {
    key: "a_night_at_the_theatre", name: PAGE, varpId: 3055, varbitId: 12276,
    startedValue: 1, completionValue: 80, questPoints: 2,
    // Cache DB row 104 column 19 completes at varbit 12276 >= 86. The plugin's
    // durable completion stage is 80; send every completed save as the native
    // threshold so existing stage-80 saves stay complete after this mapping.
    // The client stores this quest's progress on the native even grid
    // (0, 2, ..., 86); the durable mid-conversation stages 31, 33, 35 and 41 are
    // values OSRS never sends, so they round up to the next native value.
    varbitValue(stage) { return stage >= 80 ? 86 : (stage % 2 ? stage + 1 : stage); },
    rewardLines: ["Four antique lamps (20,000 combat XP each, level 50+)", "A friend of Sugadinti"],
    onReward: claimLamps,
    buildJournal(player) {
      const s = stage(player);
      if (!s) return ["Speak to the Mysterious Stranger at Ver Sinhaza.", "I must complete A Taste of Hope."];
      if (s < 14) return ["Recover Ranis' head from the crypt north-east of the Theatre.", "Kill a Vyrewatch for a crypt key. Bring a saw and an Ivandis or Blisterwood flail."];
      if (s < 22) return ["Speak to the Mysterious Stranger and finish viewing Ranis' first memory."];
      if (s < 30) return ["Find the egg sac in the nest north of Darkmeyer.", "Read the skeleton's sticky note and ask Daer Krand in the Sisterhood Sanctuary for sulphuric acid."];
      if (s < 35) return ["Bring the strange spider eggs to the Mysterious Stranger and view Ranis' memories."];
      if (s < 44) return ["Ask the Nature Spirit about a wild hespori.", "Cross the stepping stone to the island east of the grotto. Bring an axe and combat gear."];
      if (s < 48) return ["Chop the defeated hespori and bring its bark to the Mysterious Stranger."];
      if (s < 56) return ["Finish viewing Ranis' final memories with the Mysterious Stranger."];
      if (s < 78) return ["Complete the Theatre of Blood with the Mysterious Stranger.", "Enter the Theatre at Ver Sinhaza. Leaving the raid resets its challenges."];
      if (s < 80) return ["Return to the Mysterious Stranger to view Verzik's memory."];
      return ["I have completed A Night at the Theatre.", "The Mysterious Stranger can replace my unused antique lamps."];
    },
  });

  function talkStranger({ player, npcId, npc }) {
    // There are other Mysterious Strangers (e.g. Draynor); only claim Ver Sinhaza.
    const loc = npc?.getLocation();
    if (loc && (loc.getX() < 3650 || loc.getX() > 3690 || loc.getY() < 3190 || loc.getY() > 3240)) return false;
    const s = stage(player);
    if (s >= 80) {
      claimLamps(player);
      // Keep the post-quest Stranger conversation available: it includes the
      // canonical crystal shop option. claimLamps is idempotent after all four
      // lamps have been used or banked.
      if (startTranscript(api, player, npcId, STRANGER_PAGE, "after-a-night-at-the-theatre")) return true;
      player.sendMessage("Sugadinti is grateful for your help.");
      return true;
    }
    if (!s && !requirement(player)) { player.sendMessage("You must complete A Taste of Hope before helping the Mysterious Stranger."); return true; }
    let variant;
    if (!s) variant = hasRaidCompletion(player) ? "starting-off-if-the-player-has-cleared-the-theatre-at-least-once" : "starting-off-if-the-player-hasn-t-cleared-the-theatre-before";
    else if (s < 14) variant = held(player, I.RANIS_HEAD) ? "talking-to-the-mysterious-stranger-after-getting-ranis-head" : "starting-off-talking-to-the-mysterious-stranger-after-being-told-to-get-ranis-head";
    else if (s < 20) variant = "talking-to-the-mysterious-stranger-after-getting-ranis-head-after-giving-the-mysterious-stranger-ranis-head";
    else if (s < 22) variant = "talking-to-the-mysterious-stranger-after-getting-ranis-head-after-finishing-the-first-memory-cutscene";
    else if (s < 31) variant = s === 30 ? "talking-to-the-mysterious-stranger-after-getting-the-eggs" : "talking-to-the-mysterious-stranger-after-getting-ranis-head-after-being-told-to-explore-the-nest";
    else if (s < 32) variant = "talking-to-the-mysterious-stranger-after-getting-the-eggs-after-giving-the-mysterious-stranger-the-eggs";
    else if (s < 33) variant = "talking-to-the-mysterious-stranger-after-getting-the-eggs-after-the-second-memory-cutscene";
    else if (s < 35) variant = "talking-to-the-mysterious-stranger-after-getting-the-eggs-after-the-third-memory-cutscene";
    else if (s < 48) variant = held(player, I.HESPORI_BARK) ? "talking-to-the-mysterious-stranger-after-killing-the-hespori" : "talking-to-the-mysterious-stranger-after-getting-the-eggs-after-being-told-to-retrieve-hespori-bark";
    else if (s < 50) variant = "talking-to-the-mysterious-stranger-after-killing-the-hespori-after-giving-the-mysterious-stranger-the-bark";
    else if (s < 52) variant = "talking-to-the-mysterious-stranger-after-killing-the-hespori-after-the-fourth-memory-cutscene";
    else if (s < 56) variant = "talking-to-the-mysterious-stranger-after-killing-the-hespori-after-the-fifth-memory-cutscene";
    else if (s < 78) variant = "talking-to-the-mysterious-stranger-after-killing-the-hespori-after-being-told-to-complete-the-theatre-of-blood";
    else variant = "the-final-memory-talking-to-the-mysterious-stranger-after-completing-the-theatre-of-blood";
    play(player, npcId, variant);
    return true;
  }
  function talkNature({ player, npcId }) {
    if (stage(player) < 35 || stage(player) >= 48) return false;
    if (!equipped(player, I.GHOSTSPEAK_AMULET) && ![I.MORYTANIA_LEGS_2, I.MORYTANIA_LEGS_3, I.MORYTANIA_LEGS_4].some(id => equipped(player, id))) {
      player.sendMessage("You need to wear a ghostspeak amulet or Morytania legs 2 or better.");
      return true;
    }
    play(player, npcId, stage(player) < 40 ? "the-hespori-bark-talking-to-the-nature-spirit" : "the-hespori-bark-talking-to-the-nature-spirit-again");
    return true;
  }
  function talkDaer({ player, npcId }) {
    if (stage(player) < 22 || stage(player) >= 30) return false;
    if (!value(player, NOTE_ATTRIBUTE)) { player.sendMessage("Daer Krand is busy. Perhaps you should read the sticky note from the nest first."); return true; }
    play(player, npcId, value(player, ACID_ATTRIBUTE) ? "the-strange-spider-eggs-talking-to-daer-krand-talking-to-daer-krand-again-after-getting-the-sulphuric-acid" : "the-strange-spider-eggs-talking-to-daer-krand");
    return true;
  }
  function startQuest({ player, hook }) {
    if (hook === "quest:a-night-at-the-theatre:start" && !stage(player) && requirement(player)) quest.setStage(player, 10);
  }
  function line(event) {
    const { player, text, npcId } = event;
    const name = api.core.NpcDefinition.forId(npcId)?.getName?.();
    if (name !== "Mysterious Stranger" && name !== "Nature Spirit") return;
    const s = stage(player);
    // The hand-in conversation and the "So about that memory..." conversation
    // share this line, so only the stage-20 conversation may open the nest leg.
    if (s >= 20 && s < 22 && text === "My associates would prefer I remain here."
      && questVariant(event) === FIRST_MEMORY_VARIANT) event.after = () => advance(player, 22);
    if (s >= 33 && s < 35 && text === "Perfect. I will await your return.") event.after = () => advance(player, 35);
    if (s >= 35 && s < 40 && text === "For you my friend, it is no problem at all.") event.after = () => advance(player, 40);
    // The fifth-memory bark conversation ends on the notice board line, which is the
    // stage-52 line of "after-killing-the-hespori"; the "Don't forget you can use the
    // notice board..." line belongs to the stage-56+ variant and is never heard here.
    if (s >= 52 && s < 56 && text === "You can still take other people in as well of course. Just use the notice board to set up a party and find suitable allies. Once you're ready, I will join you in the Theatre.") event.after = () => advance(player, 56);
  }
  function questVariant(event) {
    const entry = (event.pages ?? []).find(page => String(page?.page ?? "").replace(/^Transcript:/, "") === PAGE);
    return entry?.variants?.[0];
  }
  function action(event) {
    const { player, stepId, npcId } = event;
    const name = api.core.NpcDefinition.forId(npcId)?.getName?.();
    if (name !== "Mysterious Stranger" && name !== "Daer Krand") return;
    const s = stage(player);
    if (stepId === "T6VA-h" && s < 14 && held(player, I.RANIS_HEAD)) { player.getInventory().deleteNumber(I.RANIS_HEAD, 1); advance(player, 14); }
    if (stepId === "evA_XO" && s === 14) advance(player, 20);
    if (stepId === "7jQW6q") {
      // "Can I get those teleport crystals you mentioned?" opens the Stranger's
      // shop. This conversation closes with the chatbox, and closing the chatbox
      // also closes the shop interface, so the shop opens one tick later.
      event.handled = true;
      event.end = true;
      const { TaskManager, CountdownTask, ShopManager } = api.core;
      TaskManager.submit(new CountdownTask(player, 1, () => ShopManager.open(player, MYSTERIOUS_STRANGER_SHOP)));
    }
    if (stepId === "DqxBs2" && s === 30 && held(player, I.STRANGE_SPIDER_EGGS)) { player.getInventory().deleteNumber(I.STRANGE_SPIDER_EGGS, 1); advance(player, 31); }
    if (stepId === "0vgPPw" && s === 31) advance(player, 32);
    if (stepId === "Jb3C2v" && s === 32) advance(player, 33);
    if (["IU5Rz7", "Qs0rAF", "5e1Ac5"].includes(stepId) && s >= 22 && s < 30 && give(player, I.SULPHURIC_ACID)) {
      player.setAttribute(ACID_ATTRIBUTE, 1); player.getPacketSender().sendVarbit(12974, 1);
    }
    if (stepId === "iMEbae" && s >= 44 && s < 48 && held(player, I.HESPORI_BARK)) { player.getInventory().deleteNumber(I.HESPORI_BARK, 1); advance(player, 48); }
    if (stepId === "MyJYx0" && s === 48) advance(player, 50);
    if (stepId === "BZhXee" && s === 50) advance(player, 52);
    if (stepId === "dUYNsb" && s === 78) quest.complete(player);
  }
  function condition({ player, stepId, pages }) {
    const names = (pages ?? []).map(entry => String(entry.page ?? "").replace(/^Transcript:/, ""));
    // The Stranger's post-quest page offers a Sinhaza shroud this server cannot
    // award (the tier rules are not implemented), so the reward option is not
    // offered; the teleport crystal option opens the shop.
    if (names.includes(STRANGER_PAGE)) {
      if (stepId === "FY0RCF") return true;
      if (stepId === "WhwoJ-" || stepId === "-nVpES") return false;
    }
    if (!names.includes(PAGE)) return;
    const conditions = {
      "YudDDA": !held(player, I.RANIS_HEAD), "tv61D-": !held(player, I.STRANGE_SPIDER_EGGS), "UuYs_j": !held(player, I.HESPORI_BARK),
      "ULZ-yE": !player.getInventory().getFreeSlots(), "GK3KT6": !player.getInventory().getFreeSlots(), "RPwP26": !player.getInventory().getFreeSlots(),
      "11lery": !!player.getInventory().getFreeSlots(), "KZDbMD": !!player.getInventory().getFreeSlots(), "RLqDip": held(player, I.SULPHURIC_ACID),
      "IYw4qN": hasRaidCompletion(player), "2wfGJX": !hasRaidCompletion(player), "68FhqQ": hasRaidCompletion(player), "5RKmz0": false, "RwZBOo": true,
      "4d363P": false, "BwlWuy": true, "tGIC8d": hasRaidCompletion(player), "tmwAkb": !hasRaidCompletion(player), "feGjHi": hasRaidCompletion(player),
    };
    return conditions[stepId];
  }
  function cryptEntry({ player, objectId }) {
    if (objectId !== CRYPT_ENTRANCE) return false;
    if (stage(player) < 10) { player.sendMessage("The crypt is closed to you."); return true; }
    player.moveTo(new Location(3680, 9649, 0));
    return true;
  }
  function cryptExit({ player, objectId }) {
    if (objectId !== CRYPT_EXIT) return false;
    player.moveTo(new Location(3682, 3230, 0)); return true;
  }
  function cryptGate({ player, objectId }) {
    if (objectId !== CRYPT_GATE) return false;
    if (!value(player, GATE_ATTRIBUTE)) {
      if (!held(player, I.CRYPT_KEY)) { player.sendMessage("The gate is locked."); return true; }
      player.getInventory().deleteNumber(I.CRYPT_KEY, 1); player.setAttribute(GATE_ATTRIBUTE, 1);
    }
    player.moveTo(new Location(3680, player.getLocation().getY() > 9635 ? 9634 : 9636, 0));
    return true;
  }
  function coffin({ player, objectId }) {
    if (![COFFIN, EMPTY_COFFIN].includes(objectId)) return false;
    if (stage(player) < 10 || stage(player) >= 14) return true;
    if (!value(player, HEAD_ATTRIBUTE) && !held(player, I.SAW) && !held(player, I.CRYSTAL_SAW)) { player.sendMessage("You need a saw to remove Ranis' head."); return true; }
    if (give(player, I.RANIS_HEAD)) { player.setAttribute(HEAD_ATTRIBUTE, 1); player.sendMessage("You recover the head of Ranis Drakan."); }
    return true;
  }
  function skeleton({ player, objectId }) {
    if (![SKELETON, SEARCHABLE_SKELETON].includes(objectId)) return false;
    if (stage(player) >= 22 && stage(player) < 30 && give(player, I.STICKY_NOTE)) player.sendMessage("You find a sticky note. Read it to learn how to open the egg sac.");
    return true;
  }
  function eggSac({ player, objectId }) {
    if (![EGG_SAC, ACID_EGG_SAC, OPEN_EGG_SAC].includes(objectId)) return false;
    if (stage(player) < 22 || stage(player) > 30) return true;
    if (held(player, I.STRANGE_SPIDER_EGGS)) { player.sendMessage("You already have some strange spider eggs."); return true; }
    if (!held(player, I.SULPHURIC_ACID) && !value(player, EGGS_OPENED_ATTRIBUTE)) { player.sendMessage("You try to rip open the egg sac, but it's too strong."); return true; }
    if (!player.getInventory().getFreeSlots() && !held(player, I.SULPHURIC_ACID)) { player.sendMessage("You need a free inventory space."); return true; }
    if (held(player, I.SULPHURIC_ACID)) player.getInventory().deleteNumber(I.SULPHURIC_ACID, 1);
    if (give(player, I.STRANGE_SPIDER_EGGS)) { player.setAttribute(EGGS_OPENED_ATTRIBUTE, 1); advance(player, 30); player.sendMessage("You take some strange spider eggs from the opened egg sac."); }
    return true;
  }
  function acidOnSac(event) {
    if (event.itemId !== I.SULPHURIC_ACID) return false;
    return eggSac(event);
  }
  class QuestHesporiArea extends PrivateArea {
    constructor() { super([new Boundary(3499, 3520, 3345, 3370, 0)]); }
    isMulti() { return true; }
    process(mobile) { if (mobile.isPlayer?.()) api.emitCustomEvent("hespori:quest-process", { player: mobile.getAsPlayer() }); }
    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) api.emitCustomEvent("hespori:quest-leave", { player: mobile.getAsPlayer() });
      super.postLeave(mobile, logout);
    }
    canAttack(attacker, target) {
      const event = { attacker, target, allow: null };
      api.emitCustomEvent("hespori:quest-can-attack", event);
      return event.allow;
    }
  }
  function routeToStone(event) {
    if (![STEPPING_STONE, ESCAPE_STONE].includes(event.objectId)) return;
    if (event.object.getLocation().getX() !== 3499 || event.object.getLocation().getY() !== 3355) return;
    event.destination = { x: event.player.getLocation().getX() > 3499 ? 3501 : 3497, y: 3355, z: 0 };
  }
  function crossing({ player, objectId }) {
    if (![STEPPING_STONE, ESCAPE_STONE].includes(objectId)) return false;
    if (objectId === ESCAPE_STONE || player.getLocation().getX() > 3499) {
      player.getArea()?.leave(player, false); player.moveTo(new Location(3497, 3355, 0));
    } else {
      const area = new QuestHesporiArea();
      area.enter(player); player.moveTo(new Location(3501, 3355, 0));
      ObjectManager.register(new GameObject(ESCAPE_STONE, new Location(3499, 3355, 0), 22, 0, area), true);
    }
    return true;
  }
  function chop({ player, objectId }) {
    if (![HESPORI, WILD_HESPORI, DEAD_HESPORI].includes(objectId)) return false;
    if (stage(player) < 40 || stage(player) >= 48) return true;
    const request = { player, axe: null }; api.emitCustomEvent("woodcutting:axe", request);
    if (!request.axe) { player.sendMessage("You'll need an axe that you have the Woodcutting level to use."); return true; }
    if (stage(player) >= 44) { if (give(player, I.HESPORI_BARK)) player.sendMessage("You chop some bark from the hespori."); return true; }
    if (!(player.getArea() instanceof QuestHesporiArea)) { player.sendMessage("Cross the stepping stone to reach the hespori."); return true; }
    advance(player, 41);
    api.emitCustomEvent("hespori:quest-challenge", { player, area: player.getArea(), location: { x: 3506, y: 3356 } });
    return true;
  }
  function hesporiDefeated({ player }) { if (stage(player) === 41) advance(player, 44); }
  function npcDeath({ killer: player, npcId, location }) {
    if (!player || stage(player) < 10 || stage(player) >= 14 || location.x < 3660 || location.x > 3700 || location.y < 9600 || location.y > 9660) return;
    if (CRYPT_VYRES.includes(npcId)) give(player, I.CRYPT_KEY);
  }
  function itemAction(event) {
    const { player, itemId, option } = event;
    if (itemId === I.STICKY_NOTE && String(option).toLowerCase() === "read") {
      event.handled = true; player.setAttribute(NOTE_ATTRIBUTE, 1);
      player.sendMessage("The sticky note mentions sulphuric acid. Daer Krand at the Sisterhood Sanctuary may have some.");
    }
    if (itemId !== LAMP || String(option).toLowerCase() !== "rub" || !quest.isComplete(player)) return;
    event.handled = true;
    api.emitCustomEvent("xpreward:open", { player, minLevel: 50, skills: combatSkills, onConfirm(skill, name) {
      if (!held(player, LAMP) || value(player, LAMPS_ATTRIBUTE) >= 4 || !combatSkills.includes(skill)) return null;
      const manager = player.getSkillManager(), before = manager.getExperience(skill);
      manager.addExperience(skill, 20000, false);
      if (manager.getExperience(skill) === before) return null;
      player.getInventory().deleteNumber(LAMP, 1); player.setAttribute(LAMPS_ATTRIBUTE, value(player, LAMPS_ATTRIBUTE) + 1);
      return `You have been awarded 20,000 ${name} XP!`;
    } });
  }
  function reclaimLamps(event) {
    if (!quest.isComplete(event.player)) return;
    claimLamps(event.player); event.handled = true;
  }
  function raidCompleted({ player }) { if (stage(player) >= 52 && stage(player) < 78) advance(player, 78); }
  function raidSkip({ player, option, npcId }) {
    if (api.core.NpcDefinition.forId(npcId)?.getName?.() !== "Mysterious Stranger") return;
    if (stage(player) >= 52 && stage(player) < 56 && option === "Yes." && hasRaidCompletion(player)) advance(player, 78);
  }
  function login({ player }) {
    player.getPacketSender().sendVarbit(12974, value(player, ACID_ATTRIBUTE));
    if (player.getLocation().getX() >= 3500 && player.getLocation().getX() <= 3520 && player.getLocation().getY() >= 3345 && player.getLocation().getY() <= 3370) player.moveTo(new Location(3497, 3355, 0));
  }
  for (const key of [LAMPS_ATTRIBUTE, NOTE_ATTRIBUTE, ACID_ATTRIBUTE, HEAD_ATTRIBUTE, GATE_ATTRIBUTE, EGGS_OPENED_ATTRIBUTE]) api.persistAttribute(key);
  api.onNpcInteraction("Mysterious Stranger", { "Talk-to": talkStranger });
  api.onNpcInteraction("Nature Spirit", { "Talk-to": talkNature });
  api.onNpcInteraction("Daer Krand", { "Talk-to": talkDaer });
  api.onObjectInteraction("Staircase", { "Climb-down": cryptEntry });
  api.onObjectInteraction("Door", { Exit: cryptExit });
  api.onObjectInteraction("Gate", { Open: cryptGate });
  api.onObjectInteraction("Coffin", { Search: coffin });
  api.onObjectInteraction("Skeleton", { Search: skeleton });
  api.onObjectInteraction("Egg Sac", { Open: eggSac, Search: eggSac });
  api.onItemOnObject("Sulphuric acid", "Egg Sac", acidOnSac, { noted: false });
  api.onObjectRoute(routeToStone);
  api.onObjectInteraction("Stepping stone", { Cross: crossing, Escape: crossing });
  api.onObjectInteraction("Hespori", { Chop: chop });
  api.onItemAction(itemAction);
  api.onNpcDeath(npcDeath);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:hook", startQuest);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onCustomEvent("npc-dialogue:choice", raidSkip);
  api.onCustomEvent("hespori:quest-defeated", hesporiDefeated);
  api.onCustomEvent("tob:completed", raidCompleted);
  api.onCustomEvent("night-at-the-theatre:claim-lamps", reclaimLamps);
  api.onPlayerLogin(login);
};
