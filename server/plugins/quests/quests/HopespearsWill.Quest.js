/**
 * Hopespear's Will (miniquest, after Land of the Goblins).
 *
 * Hopespear's ghost in the Goblin Temple crypt asks the player to beat the five old high
 * priests without weapons, armour or spells and bury their bones in Yu'biusk.
 *
 * Evidence: rsprox capture 1702 (rev 226) ticks 4790-5673 plays the whole miniquest:
 *  - Hopespear (lotg_hopespear 11391, multinpc lotg_hopespear_there 11301) stands at
 *    3744,4391; varbit 13619 `hopespear` goes 0->1 on his "You must defeat high priests..." line.
 *  - Each grave (43122-43126) opens "Select an option" with the five names; the chosen name
 *    is the player's line (seq lotg_player_invokes_high_priest 9289), then on continue
 *    "An undead goblin high priest rises from the grave..." and the priest is added beside
 *    the grave (seq 9311, spotanim 2056, sound 5333).
 *  - A priest beaten unarmed dies (no ghost) and drops its bone four ticks later.
 *  - Bury in Yu'biusk: "You dig a hole in the ground..." (seq 827, sound 2738), next tick
 *    "You bury the bones and feel a wave of gratitude from the spirit of <name>.", the bone
 *    goes, varbit hopespear_priest_<n> (13620-13624) 0->1 and Prayer XP. The fifth bone sets
 *    `hopespear` 1->2 (miniquest complete); no scroll, jingle or chat line is sent.
 * Prayer XP per bone (1,250 / 2,500 / 5,000 / 10,000 / 20,000) matches the capture and the
 * OSRS Wiki "Hopespear's Will" reward table. Dialogue: Transcript:Ghost (Hopespear).
 */
module.exports = function registerHopespearsWill(api) {
  const { Animation, Graphic, ItemIdentifiers: I, Skill } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const VARBIT_HOPESPEAR = 13619;
  const PRIEST_VARBITS = [13620, 13621, 13622, 13623, 13624];
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;
  const BURIED_ATTRIBUTE = "quest.hopespears_will.buried";

  const HOPESPEAR_NPC_ID = 11391; // lotg_hopespear
  const HOPESPEAR_VISIBLE_NPC_ID = 11301; // lotg_hopespear_there
  const HOPESPEAR_TILE = { x: 3744, y: 4391, z: 0 };
  const PAGE = "Ghost (Hopespear)";
  const START_LINE = "You must defeat high priests without using any weapons, armour or spells.";
  const GHOSTSPEAK_CONDITION = "Ck-Tdl";
  const NO_GHOSTSPEAK_CONDITION = "SX39ir";

  // Index 0-4: Snothead, Snailfeet, Mosschin, Redeyes, Strongbones (cache names and ids).
  const NAMES = ["Snothead", "Snailfeet", "Mosschin", "Redeyes", "Strongbones"];
  const GRAVE_OBJECT_IDS = [43122, 43123, 43124, 43125, 43126];
  const PRIEST_NPC_IDS = [11269, 11270, 11271, 11272, 11273];
  const BONE_ITEM_IDS = [26589, 26590, 26591, 26592, 26593];
  const BONE_XP = [1250, 2500, 5000, 10000, 20000];
  // rsprox 1702: where each priest was added.
  const PRIEST_TILES = [
    { x: 3739, y: 4385 },
    { x: 3745, y: 4385 },
    { x: 3739, y: 4389 },
    { x: 3745, y: 4389 },
    { x: 3742, y: 4392 },
  ];
  const INVOKE_ANIMATION = 9289; // lotg_player_invokes_high_priest
  const RISE_ANIMATION = 9311; // lotg_clawing_out_of_the_ground
  const RISE_GRAPHIC = 2056; // lotg_claw_out_of_ground_dust_spotanim
  const RISE_SOUND = 5333;
  const BURY_ANIMATION = 827; // human_pickupfloor
  const BURY_SOUND = 2738;
  // Yu'biusk: Land of the Goblins' arrival (3540,4386) and the capture's burial tile (3571,4374) are in it.
  // Land of the Goblins' own YUBIUSK_ZONE reaches x 3900, which takes in the crypt (3738-3746), so it is
  // cut off short of it here. Ours: the exact edge.
  const YUBIUSK = { minX: 3500, maxX: 3650, minY: 4340, maxY: 4420, z: 0 };

  let quest = null;
  /** player -> the priest it summoned (one at a time, owned by that player). */
  const summoned = new WeakMap();

  function landOfTheGoblinsComplete(player) {
    const request = { player, key: "land_of_the_goblins", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function buried(player) {
    const value = Number(player.getAttribute(BURIED_ATTRIBUTE));
    return Number.isFinite(value) ? value | 0 : 0;
  }

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    const mask = buried(player);
    PRIEST_VARBITS.forEach((varbit, index) => sender.sendVarbit(varbit, (mask >> index) & 1));
  }

  function wearsGhostspeak(player) {
    const { Equipment } = api.core;
    const equipment = player.getEquipment();
    const amulet = equipment.get(Equipment.AMULET_SLOT)?.getId?.();
    const legs = equipment.get(Equipment.LEG_SLOT)?.getId?.();
    return [I.GHOSTSPEAK_AMULET, I.GHOSTSPEAK_AMULET_2].includes(amulet)
      || [I.MORYTANIA_LEGS_2, I.MORYTANIA_LEGS_3, I.MORYTANIA_LEGS_4].includes(legs);
  }

  /** The ritual: nothing worn that carries a stat bonus (Wiki; the ghostspeak amulet and ring of visibility have none). */
  function unarmed(player) {
    for (const item of player.getEquipment().getItems?.() ?? []) {
      if (!item || item.getId?.() <= 0) continue;
      const bonuses = item.getDefinition?.()?.getBonuses?.() ?? [];
      if (bonuses.some((value) => Number(value) !== 0)) return false;
    }
    // A real autocast needs a staff, which the loop above already refuses; a default spell kept
    // without one is only remembered (Autocasting.isActive). The Wiki names recoil damage too, and a
    // ring of recoil has no stat bonus, so it is refused by id.
    const ring = player.getEquipment().get(api.core.Equipment.RING_SLOT)?.getId?.();
    return ![I.RING_OF_RECOIL, I.RING_OF_RECOIL_2, I.RING_OF_RECOIL_3].includes(ring);
  }

  // ---------------------------------------------------------------- Hopespear

  function selectVariant({ npcId, player }) {
    if (npcId !== HOPESPEAR_NPC_ID && npcId !== HOPESPEAR_VISIBLE_NPC_ID) return undefined;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "hopespear-s-will-returning-to-hopespear";
    if (stage >= STAGE_STARTED) return "hopespear-s-will-talking-to-hopespear-talking-to-hopespear-again";
    return "hopespear-s-will-talking-to-hopespear";
  }

  function answerCondition({ npcId, player, stepId }) {
    if (npcId !== HOPESPEAR_NPC_ID && npcId !== HOPESPEAR_VISIBLE_NPC_ID) return null;
    if (stepId === GHOSTSPEAK_CONDITION) return wearsGhostspeak(player);
    if (stepId === NO_GHOSTSPEAK_CONDITION) return !wearsGhostspeak(player);
    return null;
  }

  function handleLine({ player, npcId, text }) {
    if (npcId !== HOPESPEAR_NPC_ID && npcId !== HOPESPEAR_VISIBLE_NPC_ID) return;
    if (String(text ?? "").includes(START_LINE) && quest.getStage(player) < STAGE_STARTED) {
      quest.setStage(player, STAGE_STARTED);
    }
  }

  // ------------------------------------------------------------------ Graves

  function sayName(player, graveIndex) {
    const { DialogueChainBuilder, OptionDialogue, PlayerDialogue, ActionDialogue } = api.core;
    const manager = player.getDialogueManager();
    const menu = new OptionDialogue(0, {
      executeOption: (option) => {
        if (manager.getCurrent() !== menu) return;
        const chosen = option - 1;
        if (chosen < 0 || chosen >= NAMES.length) return;
        player.performAnimation(new Animation(INVOKE_ANIMATION));
        const chain = new DialogueChainBuilder().add(new PlayerDialogue(0, `${NAMES[chosen]}.`));
        chain.add(new ActionDialogue(1, {
          execute: () => {
            player.getPacketSender().sendInterfaceRemoval();
            // Ours: a name that isn't this grave's raises nothing (no capture says otherwise).
            if (chosen === graveIndex) raisePriest(player, graveIndex);
          },
        }));
        manager.startDialogues(chain);
      },
    }, ...NAMES.map((name) => `${name}.`));
    manager.startDialogues(new DialogueChainBuilder().add(menu));
  }

  function raisePriest(player, index) {
    const current = summoned.get(player);
    if (current?.isRegistered?.() && !current.isDying?.()) return;
    player.sendMessage("An undead goblin high priest rises from the grave...");
    const tile = PRIEST_TILES[index];
    const npc = api.spawnNpc({
      id: PRIEST_NPC_IDS[index],
      x: tile.x,
      y: tile.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (!npc) return;
    summoned.set(player, npc);
    npc.performAnimation?.(new Animation(RISE_ANIMATION));
    npc.performGraphic?.(new Graphic(RISE_GRAPHIC));
    player.getPacketSender().sendSound(RISE_SOUND, 1, 0);
  }

  function handleObject(event) {
    const index = GRAVE_OBJECT_IDS.indexOf(event.objectId);
    if (index === -1 || !landOfTheGoblinsComplete(event.player)) return;
    event.handled = true;
    sayName(event.player, index);
  }

  /** The bone is always on the priest's table; it stays off the floor unless the ritual was kept. */
  function withholdBone({ player, npcId, context }) {
    const index = PRIEST_NPC_IDS.indexOf(npcId);
    if (index === -1 || !context?.handledItemIds) return;
    // rsprox 1702: each priest dropped its own bone and nothing else (the table also lists plain bones).
    context.handledItemIds.add(I.BONES);
    if (!player || !owesBone(player, index)) context.handledItemIds.add(BONE_ITEM_IDS[index]);
  }

  function owesBone(player, index) {
    if (quest.getStage(player) !== STAGE_STARTED) return false;
    if ((buried(player) >> index) & 1) return false;
    if (player.getInventory().contains?.(BONE_ITEM_IDS[index])) return false;
    return unarmed(player);
  }

  function handleNpcDeath({ killer, npc }) {
    if (!killer || summoned.get(killer) !== npc) return;
    summoned.delete(killer);
  }

  // ------------------------------------------------------------------- Bones

  function inYubiusk(player) {
    const location = player.getLocation();
    return location.getZ() === YUBIUSK.z
      && location.getX() >= YUBIUSK.minX && location.getX() <= YUBIUSK.maxX
      && location.getY() >= YUBIUSK.minY && location.getY() <= YUBIUSK.maxY;
  }

  function bury(event) {
    const { player, itemId } = event;
    const index = BONE_ITEM_IDS.indexOf(itemId);
    if (index === -1) return;
    event.handled = true;
    if (!inYubiusk(player) || quest.getStage(player) !== STAGE_STARTED || ((buried(player) >> index) & 1)) {
      // Ours: no capture buries a bone outside Yu'biusk; the line restates Hopespear's request.
      player.sendMessage("Hopespear asked you to bury these bones in Yu'biusk.");
      return;
    }
    if (player.getAttribute("quest.hopespears_will.burying")) return;
    player.setAttribute("quest.hopespears_will.burying", true);
    player.sendMessage("You dig a hole in the ground...");
    player.performAnimation(new Animation(BURY_ANIMATION));
    player.getPacketSender().sendSound(BURY_SOUND, 1, 0);
    api.getTaskManager().submit(new api.core.CountdownTask(player, 1, () => finishBurial(player, index)));
  }

  function finishBurial(player, index) {
    player.setAttribute("quest.hopespears_will.burying", false);
    if (!player.getInventory().contains?.(BONE_ITEM_IDS[index])) return;
    player.getInventory().delete(BONE_ITEM_IDS[index], 1);
    player.sendMessage(`You bury the bones and feel a wave of gratitude from the spirit of ${NAMES[index]}.`);
    player.setAttribute(BURIED_ATTRIBUTE, buried(player) | (1 << index));
    player.getPacketSender().sendVarbit(PRIEST_VARBITS[index], 1);
    player.getSkillManager().addExperiences(Skill.PRAYER, BONE_XP[index]);
    if (buried(player) === 0b11111) quest.complete(player, { scroll: false, announce: false });
  }

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I buried the bones of the five goblin high priests in Yu'biusk,</str>",
        "<str>as Hopespear asked.</str>",
        "",
        "<col=ff0000>MINIQUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const left = NAMES.filter((_, index) => !((buried(player) >> index) & 1));
      return [
        "Hopespear asked me to defeat the high priests in the crypt",
        "without weapons, armour or spells, and bury their bones in",
        "Yu'biusk.",
        "",
        `Still to bury: ${left.join(", ")}.`,
      ];
    }
    return [];
  }

  api.persistAttribute(BURIED_ATTRIBUTE, 0);
  quest = registerQuest(api, {
    key: "hopespears_will",
    name: "Hopespear's Will",
    varbitId: VARBIT_HOPESPEAR,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    otherRewards: ["38,750 Prayer experience (from burying the bones)"],
    buildJournal,
  });

  api.onServerStartup(() => api.spawnNpc({ id: HOPESPEAR_NPC_ID, ...HOPESPEAR_TILE, wanderRadius: 0 }));
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-drops:context", withholdBone);
  api.onObjectInteraction(handleObject);
  api.onNpcDeath(handleNpcDeath);
  // Cache names: "Snothead's bone" ... "Redeyes' bone", "Strongbones' bone".
  for (const name of NAMES) api.onItemAction(name.endsWith("s") ? `${name}' bone` : `${name}'s bone`, { Bury: bury });
  api.onPlayerLogin(({ player }) => syncVarbits(player));
  // The summoned priest is owner-only; it goes with its owner (LotG removes its tracked fights the same way).
  api.onPlayerLogout(({ player }) => {
    const npc = summoned.get(player);
    summoned.delete(player);
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  });
};
