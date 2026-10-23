/** The Restless Ghost: captured quest state, coffin/skull encounter and river scene. See docs/f2p-varrock-parity.md. */
module.exports = function registerRestlessGhostQuest(api) {
  const { Skill, Equipment, Location, GameObject, ObjectManager, Animation, TemplatedInstanceArea, TaskManager, CountdownTask, DialogueChainBuilder, ItemStatementDialogue, ActionDialogue, StatementDialogue, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const VARP_RESTLESS_GHOST = 107;
  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_URHNEY = 2;
  const STAGE_SPOKEN_GHOST = 3;
  const STAGE_OBTAINED_SKULL = 4;
  const STAGE_COMPLETE = 5;

  const GHOSTSPEAK_AMULET_ID = ItemIdentifiers.GHOSTSPEAK_AMULET;
  const GHOSTS_SKULL_ID = ItemIdentifiers.GHOSTS_SKULL;

  /** Object id 2146 has no generated ObjectIdentifiers member; value kept from the original plugin. */
  const SKULL_ALTAR_OBJECT_ID = 2146;
  /** Skull altar in the Wizards' Tower: a varbit loc that resolves to one of these. */
  const SKULL_ALTAR_IDS = [SKULL_ALTAR_OBJECT_ID, ObjectIdentifiers.ALTAR_41, ObjectIdentifiers.ALTAR_42];

  const QUEST_START_HOOK = "quest:the-restless-ghost:start";
  /** "Father Urhney hands you an amulet." on page "The Restless Ghost". */
  const URHNEY_GIVE_AMULET_MESSAGE_ID = "Nn953X";
  /** Lost-amulet "ghostspeak amulet" action, on both Urhney pages. */
  const URHNEY_GIVE_AMULET_ACTION_IDS = new Set(["TkNeQZ", "z2bQM2"]);
  /** Where the ghost rises: the tile just south of the graveyard coffin (3249, 3192). */
  const GHOST_SPAWN_X = 3250;
  const GHOST_SPAWN_Y = 3195;
  const GHOST_WANDER_RADIUS = 2;
  const OPEN_COFFIN_ID = 15061; // cache restless_coffin_open, transforms on varbit2129
  const SKULL_TAKEN_VARBIT = 2130;
  const COFFIN_SKULL_VARBIT = 2129;
  const SKELETON_HIDDEN_VARBIT = 2128;
  const FINISH_ATTRIBUTE = "restless-ghost:release-pending";
  const ghostByPlayer = new Map(), scenes = new Map(), opening = new WeakMap();
  let skeleton = null;
  let quest;

  function later(key, ticks, fn) { TaskManager.submit(new CountdownTask(key, ticks, fn)); }
  function statement(player, text, item) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(item === undefined ? new StatementDialogue(0, text) : new ItemStatementDialogue(0, item, text)));
  }
  const bankedAmulet = player => (player.getBanks?.() ?? []).some(bank => bank?.getAmount(GHOSTSPEAK_AMULET_ID) > 0);
  const ownsGhostspeakAmulet = (player) => {
    if (player.getInventory().getAmount(GHOSTSPEAK_AMULET_ID) > 0) return true;
    return player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET_ID;
  };

  const wearingGhostspeakAmulet = (player) =>
    player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET_ID;

  function giveGhostspeakAmulet(player) {
    if (ownsGhostspeakAmulet(player) || bankedAmulet(player)) return false;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need some free inventory space before Father Urhney can give you the amulet.");
      return false;
    }
    player.getInventory().adds(GHOSTSPEAK_AMULET_ID, 1);
    return true;
  }

  /** Rise the ghost from the coffin for this player, once, until the quest ends. */
  function ensureGhost(player) {
    if (quest.getStage(player) >= STAGE_COMPLETE) return;
    if (ghostByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: NpcIdentifiers.RESTLESS_GHOST,
      x: GHOST_SPAWN_X,
      y: GHOST_SPAWN_Y,
      z: 0,
      wanderRadius: GHOST_WANDER_RADIUS,
      owner: player,
      ownerOnly: true,
    });
    if (npc) {
      ghostByPlayer.set(player, npc);
      npc.performAnimation(new Animation(4019));
      player.getPacketSender().sendSoundEffect(1595, 1, 0);
      later(npc, 100, () => { if (ghostByPlayer.get(player) === npc) removeGhost(player); });
    }
  }

  function removeGhost(player) {
    const npc = ghostByPlayer.get(player);
    if (!npc) return;
    ghostByPlayer.delete(player);
    TaskManager.cancelTasks(npc);
    api.removeNpc(npc);
  }

  /** The private ghost follows its owner; drop it on logout like the other quest NPCs. */
  function handleLogout({ player }) {
    if (!player) return;
    removeGhost(player);
    const scene = scenes.get(player);
    if (scene) { scenes.delete(player); scene.leave(player, true); }
    const pending = opening.get(player); if (pending) TaskManager.cancelTasks(pending);
    opening.delete(player);
  }

  /** Swap a coffin object for another id in place (the reference's loc change). */
  function replaceObject(object, newId) {
    const location = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(
        newId,
        new Location(location.getX(), location.getY(), location.getZ()),
        object.getType(),
        object.getFace(),
        object.getPrivateArea() ?? null
      ),
      true
    );
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to",
        "<col=800000>Father Aereck</col> in the <col=800000>church</col>",
        "next to <col=800000>Lumbridge Castle</col>.",
        "",
        "I must be unafraid of a <col=800000>level 13 Skeleton</col>.",
      ];
    }

    const lines = [
      "<str>Father Aereck asked me to help him deal with</str>",
      "<str>the ghost in the graveyard next to the church.</str>",
      "",
    ];
    if (stage < STAGE_SPOKEN_URHNEY) {
      return [
        ...lines,
        "I should find <col=800000>Father Urhney</col>, an expert on ghosts.",
        "He lives in a <col=800000>shack</col> in <col=800000>Lumbridge Swamp</col>.",
      ];
    }
    lines.push(
      "<str>Father Urhney gave me an Amulet of Ghostspeak</str>",
      "<str>so I can talk to the ghost.</str>",
      ""
    );
    if (stage < STAGE_SPOKEN_GHOST) {
      return [...lines, "I should wear the amulet and talk to the <col=800000>Ghost</col>."];
    }
    lines.push(
      "<str>The Ghost told me an evil warlock stole his skull.</str>",
      ""
    );
    if (stage < STAGE_OBTAINED_SKULL) {
      return [
        ...lines,
        "I should search the <col=800000>Wizards' Tower</col> south-west of",
        "Lumbridge for the <col=800000>Ghost's Skull</col>.",
      ];
    }
    lines.push(
      "<str>I found the Ghost's Skull in the Wizards' Tower.</str>",
      ""
    );
    if (stage < STAGE_COMPLETE) {
      return [...lines, "I should put the <col=800000>Skull</col> in the Ghost's coffin."];
    }
    return [
      ...lines,
      "<str>I placed the Skull in the coffin and allowed the</str>",
      "<str>Ghost to rest in peace.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 1125);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === NpcIdentifiers.FATHER_AERECK) {
      if (stage >= STAGE_COMPLETE) {
        return { page: "Father Aereck", variant: "after-completion-of-the-restless-ghost" };
      }
      if (stage === STAGE_STARTED) {
        return { page: "The Restless Ghost", variant: "starting-out-talking-to-father-aereck-again" };
      }
      if (stage === STAGE_SPOKEN_URHNEY) {
        return { page: "The Restless Ghost", variant: "talking-to-father-urhney-talking-to-father-aereck" };
      }
      if (stage === STAGE_SPOKEN_GHOST) {
        return { page: "The Restless Ghost", variant: "talking-to-the-restless-ghost-talking-to-father-aereck" };
      }
      if (stage >= STAGE_OBTAINED_SKULL) {
        // No dump variant for "skull found but not carried"; use the found branch.
        return { page: "The Restless Ghost", variant: "after-retrieving-the-skull-talking-to-father-aereck-with-the-skull" };
      }
      return { page: "The Restless Ghost", variant: "starting-out" };
    }

    if (npcId === NpcIdentifiers.FATHER_URHNEY) {
      if (stage === STAGE_STARTED) {
        return { page: "The Restless Ghost", variant: "talking-to-father-urhney" };
      }
      if (stage >= STAGE_COMPLETE) {
        return { page: "Father Urhney", variant: "after-the-restless-ghost" };
      }
      if (stage >= STAGE_SPOKEN_URHNEY) {
        return { page: "The Restless Ghost", variant: "talking-to-father-urhney-if-the-ghostspeak-amulet-is-ever-lost" };
      }
      return { page: "Father Urhney", variant: "before-the-restless-ghost" };
    }

    if (npcId === NpcIdentifiers.RESTLESS_GHOST) {
      if (stage === 0 || stage >= STAGE_COMPLETE) {
        // Stage 0 = the dump's only ghost page; completion has no variant.
        return { page: "Restless ghost", variant: "before-the-restless-ghost" };
      }
      if (!wearingGhostspeakAmulet(player)) {
        return {
          page: "The Restless Ghost",
          variant: stage > STAGE_SPOKEN_URHNEY
            ? "talking-to-the-restless-ghost-talking-to-the-restless-ghost-again-without-the-amulet-of-ghostspeak"
            : "talking-to-the-restless-ghost-without-wearing-the-amulet-of-ghostspeak",
        };
      }
      if (stage === STAGE_SPOKEN_URHNEY) {
        return { page: "The Restless Ghost", variant: "talking-to-the-restless-ghost-while-wearing-the-amulet-of-ghostspeak" };
      }
      if (stage === STAGE_SPOKEN_GHOST) {
        return { page: "The Restless Ghost", variant: "talking-to-the-restless-ghost-talking-to-the-restless-ghost-again-with-the-amulet-of-ghostspeak" };
      }
      return { page: "The Restless Ghost", variant: "after-retrieving-the-skull-talking-to-the-restless-ghost" };
    }

    return null;
  }

  function answerCondition({ npcId, player, text }) {
    if (npcId !== NpcIdentifiers.FATHER_URHNEY) return null;
    const value = String(text).toLowerCase();
    if (value.includes("currently has it in their inventory")) return ownsGhostspeakAmulet(player);
    // shortcut: Death's Office/retrieval storage has no common lookup; add it here when exposed.
    if (value.includes("stored in a bank")) return bankedAmulet(player);
    if (value.includes("does not have inventory space")) return player.getInventory().isFull();
    if (value.includes("has inventory space")) return !player.getInventory().isFull();
    return null;
  }

  function warnBeforeStart(event) {
    if (event.npcId === NpcIdentifiers.FATHER_AERECK && event.prompt === "Start The Restless Ghost quest?" && event.player.getSkillManager().getCombatLevel() < 10) {
      event.warning = "Before starting this quest, be aware that your combat level is lower than the recommended level of 10.";
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== NpcIdentifiers.FATHER_AERECK || hook !== QUEST_START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId !== NpcIdentifiers.FATHER_URHNEY) return;
    if (stepId === "d7Bg2n") { event.text = "Father Urhney sighs."; event.box = { statement: true }; return; }
    if (stepId === URHNEY_GIVE_AMULET_MESSAGE_ID || stepId === "xk28r_" || URHNEY_GIVE_AMULET_ACTION_IDS.has(stepId)) {
      event.handled = true;
      if (stepId === "xk28r_") event.text = "Father Urhney hands you an amulet of ghostspeak.";
      if (giveGhostspeakAmulet(player)) {
        if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_SPOKEN_URHNEY);
        event.box = { items: [GHOSTSPEAK_AMULET_ID] };
      }
    }
  }

  function handleDialogueLine(event) {
    if (event.npcId !== NpcIdentifiers.RESTLESS_GHOST || event.text !== "Ooh, thank you. That would be such a great relief!") return;
    event.after = () => { if (quest.getStage(event.player) === STAGE_SPOKEN_URHNEY) quest.setStage(event.player, STAGE_SPOKEN_GHOST); };
  }

  function atCoffin(event) {
    const at = event.object.getLocation();
    return at.getX() === 3249 && at.getY() === 3192 && at.getZ() === 0;
  }
  function openCoffin(event) {
    if (!atCoffin(event) || opening.has(event.player)) return;
    const { player } = event;
    const pending = {}; opening.set(player, pending);
    player.sendMessage("You open the coffin.");
    player.getMovementQueue().setBlockMovement(true);
    later(pending, 1, () => { player.performAnimation(new Animation(536)); player.getPacketSender().sendSoundEffect(54, 1, 0); });
    later(pending, 2, () => { replaceObject(event.object, OPEN_COFFIN_ID); player.getPacketSender().sendSoundEffect(1743, 1, 0); });
    later(pending, 4, () => { opening.delete(player); player.getMovementQueue().setBlockMovement(false); if (player.isRegistered()) ensureGhost(player); });
  }
  function searchOpenCoffin(event) {
    if (!atCoffin(event)) return;
    ensureGhost(event.player);
    statement(event.player, quest.isComplete(event.player) ? "There's a nice and complete skeleton in here!" : "There's a skeleton without a skull in here.");
  }
  function closeCoffin(event) {
    if (!atCoffin(event)) return;
    event.player.sendMessage("You close the coffin.");
    replaceObject(event.object, ObjectIdentifiers.COFFIN_4);
  }
  function takeSkullFromAltar({ player }) {
    const stage = quest.getStage(player);
    if (player.getInventory().getAmount(GHOSTS_SKULL_ID) > 0) { statement(player, "You already have the Ghost's skull."); return; }
    if (stage >= STAGE_COMPLETE) { statement(player, "Surprisingly, this altar is empty. Probably because you took the skull off it earlier."); return; }
    if (stage < STAGE_SPOKEN_GHOST) { statement(player, "That skull looks scary. You have no reason to take it."); return; }
    if (player.getInventory().isFull()) { player.sendMessage("You don't have enough inventory space for the skull."); return; }
    player.getInventory().adds(GHOSTS_SKULL_ID, 1);
    quest.setStage(player, STAGE_OBTAINED_SKULL);
    player.getPacketSender().sendVarbit(SKULL_TAKEN_VARBIT, 1).sendVarbit(SKELETON_HIDDEN_VARBIT, 1).sendSoundEffect(1746, 1, 0);
    player.sendMessage("The skeleton in the corner suddenly comes to life!");
    if (skeleton) api.removeNpc(skeleton);
    skeleton = api.spawnNpc({ id: NpcIdentifiers.SKELETON_16, x: 3120, y: 9569, z: 0, wanderRadius: 0 });
    if (!skeleton) return;
    const npc = skeleton;
    npc.__skipDefaultRespawn = true;
    npc.setCombatXpMultiplier(0.025);
    npc.performAnimation(new Animation(4017));
    later(npc, 2, () => { if (npc.isRegistered()) npc.getCombat().attack(player); });
    later(npc, 100, () => { if (skeleton === npc) { api.removeNpc(npc); skeleton = null; } });
  }

  class ReleaseScene extends TemplatedInstanceArea {
    constructor(player) {
      super(4, 4); this.owner = player;
      for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) this.setChunk(0, x, y, { sourceChunkX: 404 + x, sourceChunkY: 397 + y, sourcePlane: 0, rotation: 0 });
    }
    sourceTile(x, y) { return this.tile(x - 3232, y - 3176, 0); }
    canTeleport() { return false; }
    canAttack() { return false; }
    destroy() { if (this.ghost) api.removeNpc(this.ghost); super.destroy(); }
    postLeave(actor, logout) {
      if (actor === this.owner) {
        scenes.delete(actor); TaskManager.cancelTasks(this);
        actor.getMovementQueue().setBlockMovement(false); actor.setUntargetable(false);
        actor.getPacketSender().sendVarbit(6719, 0).sendVarbit(12393, 0).sendCameraUnlock(false).sendCameraReset().closeSubInterface((161 << 16) | 1);
      }
      super.postLeave(actor, logout);
    }
  }
  function sceneCamera(player, scene, camera, look, rate = 100) {
    const c = scene.sourceTile(camera[0], camera[1]), l = scene.sourceTile(look[0], look[1]);
    const options={rate,rate2:rate,heightRelative:false};
    player.getPacketSender().sendCameraMoveTo(c.getX(), c.getY(), camera[2], options).sendCameraLookAt(l.getX(), l.getY(), look[2], options);
  }
  function fade(player, out) { player.getPacketSender().sendSubInterface((161 << 16) | 1, 174, 1, { postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }] }); }
  function releaseSpirit(player) {
    const scene = new ReleaseScene(player); scenes.set(player, scene);
    player.getMovementQueue().reset().setBlockMovement(true); player.setUntargetable(true);
    player.getPacketSender().sendVarbit(6719, 2).sendVarbit(12393, 1);
    for(let axis=0;axis<5;axis++)player.getPacketSender().sendCameraShake(axis,0,0,0);
    fade(player, true);
    player.moveTo(scene.sourceTile(3248, 3192)); scene.enter(player);
    later(scene, 2, () => {
      const tile = scene.sourceTile(3248, 3193);
      const ghost = api.spawnNpc({ id: NpcIdentifiers.RESTLESS_GHOST, x: tile.getX(), y: tile.getY(), z: 0, owner: player, ownerOnly: true, wanderRadius: 0 });
      scene.ghost = ghost; if (ghost) { scene.enter(ghost); ghost.forceChat("Release! Thank you"); }
      fade(player, false); sceneCamera(player, scene, [3252, 3193, 350], [3246, 3193, 200]);
      player.getPacketSender().sendChatboxInterface(231).sendNpcHeadOnInterface(NpcIdentifiers.RESTLESS_GHOST, (231 << 16) | 2)
        .sendString("Restless ghost", (231 << 16) | 4).sendString("Release! Thank you stranger..", (231 << 16) | 6)
        .sendString("", (231 << 16) | 5).sendInterfaceFlagsRange((231 << 16) | 5, -1, -1, 0);
    });
    later(scene, 6, () => scene.ghost?.forceChat("stranger.."));
    for (const [tick, from, to, cycles] of [[10, [3248,3193], [3244,3193],60], [12,[3244,3193],[3244,3190],60], [14,[3244,3190],[3253,3181],95]]) later(scene, tick, () => {
      if (tick === 10) { scene.ghost?.performAnimation(new Animation(4018)); player.getPacketSender().sendSoundEffect(748, 1, 0); }
      player.getPacketSender().sendProjectile(scene.sourceTile(...from), scene.sourceTile(...to), 0, cycles, 668, 50, 50, null, 0, 30, 0);
      if (tick === 12) sceneCamera(player, scene, [3240,3193,900], [3243,3191,25]);
      if (tick === 14) { const l=scene.sourceTile(3253,3181); player.getPacketSender().sendCameraLookAt(l.getX(),l.getY(),25,{rate:5,rate2:5,heightRelative:false}); }
    });
    later(scene, 19, () => {
      if (scene.ghost) api.removeNpc(scene.ghost);
      scene.leave(player, false); player.moveTo(new Location(3247,3193,0)); player.getPacketSender().sendInterfaceRemoval();
      later(player, 3, () => finishRelease(player));
    });
  }
  function finishRelease(player) {
    if (!player.getAttribute(FINISH_ATTRIBUTE)) return;
    player.setAttribute(FINISH_ATTRIBUTE, 0); quest.complete(player);
  }
  function putSkullInCoffin(event) {
    if (event.itemId !== GHOSTS_SKULL_ID || !atCoffin(event)) return;
    if (event.objectId === ObjectIdentifiers.COFFIN_4) { statement(event.player, "Maybe I should open it first."); event.handled = true; return; }
    if (![OPEN_COFFIN_ID, ObjectIdentifiers.COFFIN_12, ObjectIdentifiers.COFFIN_13].includes(event.objectId)) return;
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_OBTAINED_SKULL || player.getAttribute(FINISH_ATTRIBUTE) || player.getInventory().getAmount(GHOSTS_SKULL_ID) <= 0) return;
    player.sendMessage("You put the skull in the coffin."); player.performAnimation(new Animation(832));
    player.getPacketSender().sendSoundEffect(1744, 1, 0);
    player.getInventory().deleteNumber(GHOSTS_SKULL_ID, 1);
    player.setAttribute(FINISH_ATTRIBUTE, 1);
    player.getPacketSender().sendConfig(VARP_RESTLESS_GHOST, STAGE_COMPLETE).sendVarbit(COFFIN_SKULL_VARBIT, 1);
    removeGhost(player); later(player, 1, () => { if (player.isRegistered()) releaseSpirit(player); });
  }
  function inspectSkull({ player }) { statement(player, "It's the skull of the ghost that is haunting Lumbridge graveyard. Maybe I should return this back to the ghost's coffin.", GHOSTS_SKULL_ID); return true; }
  function dropSkull(event) {
    if (event.itemId !== GHOSTS_SKULL_ID) return;
    event.handled = true;
    const player=event.player;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, GHOSTS_SKULL_ID, "Dropping this skull here will destroy it!"))
      .add(new ActionDialogue(1, { execute: () => {
        player.getDialogueManager().reset();
        api.sendMultiChatboxPrompt(player, "Are you sure you want to drop the skull?", "Yes.", () => {
          if (player.getInventory().getAmount(GHOSTS_SKULL_ID) > 0) player.getInventory().deleteNumber(GHOSTS_SKULL_ID, 1);
          player.getPacketSender().sendVarbit(SKULL_TAKEN_VARBIT, 0).sendInterfaceRemoval();
        }, "No.", () => player.getPacketSender().sendInterfaceRemoval());
      } })));
  }
  function restoreState({ player }) {
    player.getPacketSender().sendVarbit(SKULL_TAKEN_VARBIT, Number(quest.isComplete(player) || player.getInventory().getAmount(GHOSTS_SKULL_ID) > 0))
      .sendVarbit(COFFIN_SKULL_VARBIT, Number(quest.isComplete(player) || Boolean(player.getAttribute(FINISH_ATTRIBUTE)))).sendVarbit(SKELETON_HIDDEN_VARBIT, 0);
    finishRelease(player);
  }

  function giveSkullToGhost(event) {
    if (event.itemId !== GHOSTS_SKULL_ID) return;
    if ((event.npcId ?? event.target.getId?.()) !== NpcIdentifiers.RESTLESS_GHOST) return;
    event.player.sendMessage("I can't give it to him. It goes right through him.");
    event.handled = true;
  }

  quest = registerQuest(api, {
    key: "the_restless_ghost",
    name: "The Restless Ghost",
    varpId: VARP_RESTLESS_GHOST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    completionJingleId: 152,
    varpValue: (stage, player) => player.getAttribute(FINISH_ATTRIBUTE) ? STAGE_COMPLETE : stage,
    xpRewards: [{ skillId: Skill.PRAYER.getIndex(), amount: 1125, label: "Prayer" }],
    scrollItemId: GHOSTS_SKULL_ID,
    otherRewards: ["Amulet of ghostspeak"],
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:menu", warnBeforeStart);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.persistAttribute(FINISH_ATTRIBUTE, 0);
  api.onPlayerLogin(restoreState);
  api.onPlayerLogout(handleLogout);
  api.onObjectFirstClick(ObjectIdentifiers.COFFIN_4, openCoffin);
  api.onObjectFirstClick([OPEN_COFFIN_ID, ObjectIdentifiers.COFFIN_12, ObjectIdentifiers.COFFIN_13], searchOpenCoffin);
  api.onObjectSecondClick([OPEN_COFFIN_ID, ObjectIdentifiers.COFFIN_12, ObjectIdentifiers.COFFIN_13], closeCoffin);
  api.onObjectFirstClick(SKULL_ALTAR_IDS, takeSkullFromAltar);
  api.onItemOnObject(putSkullInCoffin);
  api.onItemOnNpc(giveSkullToGhost);
  api.onItemAction("Ghost's skull", { Inspect: inspectSkull });
  api.onItemDropPolicy(dropSkull);
};
