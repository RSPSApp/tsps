/**
 * Dwarf Cannon (members).
 *
 * The words come from the "Dwarf Cannon" transcript page. Captain Lawgof and
 * Nulodion are indexed, so this plugin supplies the by-stage variant selector, the
 * prose-condition answers, the item hand-outs and the object legs Quest Helper
 * routes (six railings, watchtower remains, goblin-cave crate, multicannon).
 *
 * Stage machine (varp 0, ported from xrsps): 1 railings, 2 railings reported,
 * 3 tower/remains, 4 find Lollk, 5 return to Lawgof, 6 repair cannon,
 * 7 inspected, 8 cannon repaired, 9 speak to Nulodion, 10 return notes,
 * 11 complete. The six repaired railings are kept in a plugin attribute; the
 * cache's repair interface requires each of its three tool/part combinations.
 */
module.exports = function registerDwarfCannonQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, Location } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Dwarf Cannon";
  const LAWGOF_PAGE = "Captain Lawgof";

  const VARP_DWARF_CANNON = 0;

  const STAGE_REPAIR_RAILINGS = 1;
  const STAGE_CHECK_WATCHTOWER = 2;
  const STAGE_FIND_CAVE = 3;
  const STAGE_FIND_LOLLK = 4;
  const STAGE_RETURN_TO_LAWGOF = 5;
  const STAGE_REPAIR_CANNON = 6;
  const STAGE_INSPECTED_CANNON = 7;
  const STAGE_CANNON_REPAIRED = 8;
  const STAGE_SPEAK_TO_NULODION = 9;
  const STAGE_RETURN_NOTES = 10;
  const STAGE_COMPLETE = 11;

  const START_HOOK = "quest:dwarf-cannon:start";
  /** "Congratulations! Quest complete!" in talking-to-lawgof-after-getting-the-ammo-mould. */
  const COMPLETE_ACTION_ID = "c8LrCL";

  // Object placements from cache osrs-241_2026-10-20 (multilocs resolve to the
  // visible broken/fixed railing and broken/fixed multicannon ids).
  const RAILING_OBJECT_IDS = new Set([15590, 15591, 15592, 15593, 15594, 15595]);
  const REMAINS_OBJECT_ID = 0; // transform to 15596 "Dwarf remains"
  const REMAINS_TILE = { x: 2567, y: 3444, z: 2 };
  const CRATE_OBJECT_ID = 1; // "Crate"
  const CRATE_TILE = { x: 2571, y: 9850, z: 0 };
  const CANNON_OBJECT_ID = 15597; // transform to 5 broken / 6 fixed
  // Cache IF1 group 409: tool buttons 1-3, safety/spring/gear targets 7-9.
  const CANNON_INTERFACE_GROUP = 409;
  const CANNON_INTERFACE_PARTS = new Map([[7, "safety"], [8, "spring"], [9, "gear"]]);
  const CANNON_TOOL_VARBITS = new Map([[1, 2235], [2, 2236], [3, 2237]]);
  const CANNON_SAFETY_VARBIT = 2238;
  const CANNON_SPRING_VARBIT = 2239;
  const MUDPILE_OBJECT_ID = 13; // "Mud pile", Climb-over
  const MUDPILE_TILE = { x: 2621, y: 9796, z: 0 };
  const OUTSIDE_CAVE_TILE = { x: 2622, y: 3395, z: 0 };

  const RAILS_ATTRIBUTE = "dwarf-cannon:rails-fixed";
  const RAILS_MASK_ATTRIBUTE = "dwarf-cannon:rails-fixed-mask";
  // Cache gamevals mcannon_railing1_fixed through mcannon_railing6_fixed.
  const RAILING_FIXED_VARBITS = [2240, 2241, 2242, 2243, 2244, 2245];
  const RAILS_REQUIRED = RAILING_FIXED_VARBITS.length;

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;
  const at = (location, tile) => location?.x === tile.x && location?.y === tile.y && location?.z === tile.z;

  function addItem(player, itemId, quantity = 1) {
    if (!has(player, itemId)) player.getInventory().adds(itemId, quantity);
  }

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Captain Lawgof defend his outpost.</str>",
        "<str>I can use dwarf multicannons and make cannonballs.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURN_NOTES) return ["I have Nulodion's notes and ammo mould.", "I should return to <col=800000>Captain Lawgof</col>."];
    if (stage >= STAGE_SPEAK_TO_NULODION) return ["I should speak to <col=800000>Nulodion</col> at the", "dwarven mine entrance south of Ice Mountain."];
    if (stage >= STAGE_CANNON_REPAIRED) return ["The multicannon is repaired.", "I should report to <col=800000>Captain Lawgof</col>."];
    if (stage >= STAGE_INSPECTED_CANNON || stage >= STAGE_REPAIR_CANNON) return ["I should use the <col=800000>toolkit</col> on the broken cannon."];
    if (stage >= STAGE_RETURN_TO_LAWGOF) return ["I found Lollk alive in the goblin cave.", "I should return to <col=800000>Captain Lawgof</col>."];
    if (stage >= STAGE_FIND_LOLLK) return ["The goblins took Lollk.", "I should search the <col=800000>crates</col> inside their cave."];
    if (stage >= STAGE_FIND_CAVE) return ["The remains belonged to Gilob, but Lollk may live.", "I should find the <col=800000>goblin cave</col> to the south-east."];
    if (stage >= STAGE_CHECK_WATCHTOWER) return ["I should climb the southern watchtower", "and investigate why it has gone quiet."];
    if (stage >= STAGE_REPAIR_RAILINGS) return ["Captain Lawgof gave me replacement rails and a hammer.", "I should repair the broken railings."];
    return ["Speak to <col=800000>Captain Lawgof</col> at the Coal Trucks,", "north-west of the Fishing Guild."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 750);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === NpcIdentifiers.CAPTAIN_LAWGOF) {
      if (stage >= STAGE_COMPLETE) return page(LAWGOF_PAGE, "after-completing-dwarf-cannon");
      if (stage >= STAGE_RETURN_NOTES) return page(PAGE, "talking-to-lawgof-after-getting-the-ammo-mould");
      if (stage >= STAGE_SPEAK_TO_NULODION) return page(PAGE, "fixing-the-cannon-talking-to-captain-lawgof-after-fixing-the-cannon-talking-to-captain-lawgof-again-after-agreeing-to-see-nulodion");
      if (stage >= STAGE_CANNON_REPAIRED) return page(PAGE, "fixing-the-cannon-talking-to-captain-lawgof-after-fixing-the-cannon");
      if (stage >= STAGE_REPAIR_CANNON) return page(PAGE, "fixing-the-cannon-talking-to-captain-lawgof-before-fixing-the-cannon");
      if (stage >= STAGE_RETURN_TO_LAWGOF) return page(PAGE, "the-dwarf-child-talking-to-captain-lawgof-after-finding-lollk");
      if (stage >= STAGE_FIND_CAVE) {
        return has(player, ItemIdentifiers.DWARF_REMAINS)
          ? page(PAGE, "finding-the-remains-talking-to-captain-lawgof-after-getting-the-remains")
          : page(PAGE, "fixing-the-railings-talking-to-captain-lawgof-after-fixing-the-railings-talking-to-captain-lawgof-again-without-visiting-the-watchtower");
      }
      if (stage >= STAGE_CHECK_WATCHTOWER) {
        // The railings report completes when this conversation opens; the next
        // talk is the "any news from the watchman?" variant.
        quest.setStage(player, STAGE_FIND_CAVE);
        return page(PAGE, "fixing-the-railings-talking-to-captain-lawgof-after-fixing-the-railings");
      }
      if (stage >= STAGE_REPAIR_RAILINGS) return page(PAGE, "fixing-the-railings-talking-to-captain-lawgof-before-fixing-the-railings");
      return page(PAGE, "captain-lawgof");
    }

    if (npcId === NpcIdentifiers.NULODION) {
      if (stage >= STAGE_RETURN_NOTES) return page(PAGE, "fixing-the-cannon-talking-to-nulodion-again");
      if (stage === STAGE_SPEAK_TO_NULODION) return page(PAGE, "fixing-the-cannon-talking-to-nulodion");
      return null;
    }

    if (npcId === NpcIdentifiers.LOLLK && stage === STAGE_FIND_LOLLK) {
      return page(PAGE, "the-dwarf-child-searching-the-crate-containing-lollk");
    }

    return null;
  }

  function answerCondition({ player, npcId, text }) {
    if (![NpcIdentifiers.CAPTAIN_LAWGOF, NpcIdentifiers.NULODION, NpcIdentifiers.LOLLK].includes(npcId)) return null;
    const value = String(text).toLowerCase();
    if (value.includes("does not have a hammer")) return !has(player, ItemIdentifiers.HAMMER);
    if (value.includes("does not have a railing")) return !has(player, ItemIdentifiers.RAILING);
    if (value.includes("player has no railings")) return !has(player, ItemIdentifiers.RAILING);
    if (value.includes("player has at least 1 railing")) return has(player, ItemIdentifiers.RAILING);
    if (value.includes("player has no inventory space")) {
      const inventory = player.getInventory();
      if (npcId === NpcIdentifiers.NULODION && quest.getStage(player) === STAGE_SPEAK_TO_NULODION) {
        const missing = [ItemIdentifiers.NULODIONS_NOTES, ItemIdentifiers.AMMO_MOULD]
          .filter((itemId) => !has(player, itemId)).length;
        return inventory.getFreeSlots() < missing;
      }
      return inventory.isFull();
    }
    if (value.includes("player already has the remains")) return has(player, ItemIdentifiers.DWARF_REMAINS);
    if (value.includes("player lost the toolkit")) return !has(player, ItemIdentifiers.TOOLKIT);
    if (value.includes("player lost the notes")) return !has(player, ItemIdentifiers.NULODIONS_NOTES);
    if (value.includes("player lost the ammo mould")) return !has(player, ItemIdentifiers.AMMO_MOULD);
    if (value.includes("player does not have the notes and ammo mould")) {
      return !has(player, ItemIdentifiers.NULODIONS_NOTES) || !has(player, ItemIdentifiers.AMMO_MOULD);
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== NpcIdentifiers.CAPTAIN_LAWGOF || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_REPAIR_RAILINGS) return;
    const inventory = player.getInventory();
    if (inventory.getAmount(ItemIdentifiers.RAILING) < RAILS_REQUIRED) {
      inventory.adds(ItemIdentifiers.RAILING, RAILS_REQUIRED);
    }
    if (inventory.getAmount(ItemIdentifiers.HAMMER) < 1) inventory.adds(ItemIdentifiers.HAMMER, 1);
    quest.setStage(player, STAGE_REPAIR_RAILINGS);
  }

  function repairRailing(event) {
    const { player, objectId } = event;
    const stage = quest.getStage(player);
    if (stage !== STAGE_REPAIR_RAILINGS) {
      player.sendMessage(
        stage >= STAGE_CHECK_WATCHTOWER
          ? "That's better, the goblins won't get past this piece of fencing now."
          : "This railing is broken and needs to be replaced."
      );
      return true;
    }
    if (!has(player, ItemIdentifiers.RAILING)) {
      player.sendMessage("I'm not going to be able to fix this without a new railing. Lawgof should have some spare ones.");
      return true;
    }
    if (!has(player, ItemIdentifiers.HAMMER)) {
      player.sendMessage("You will need a hammer to fix the railings.");
      return true;
    }
    const railingIndex = objectId - 15590;
    const railingMask = Number(player.getAttribute(RAILS_MASK_ATTRIBUTE)) || 0;
    const railingBit = 1 << railingIndex;
    if (railingIndex < 0 || railingIndex >= RAILS_REQUIRED) return false;
    if ((railingMask & railingBit) !== 0) {
      player.sendMessage("This railing is already fixed.");
      return true;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.RAILING, 1);
    player.setAttribute(RAILS_MASK_ATTRIBUTE, railingMask | railingBit);
    player.getPacketSender().sendVarbit(RAILING_FIXED_VARBITS[railingIndex], 1);
    const fixed = (Number(player.getAttribute(RAILS_ATTRIBUTE)) || 0) + 1;
    player.setAttribute(RAILS_ATTRIBUTE, fixed);
    if (fixed >= RAILS_REQUIRED) {
      player.sendMessage("This railing is now fixed. I've fixed all these railings now.");
      quest.setStage(player, STAGE_CHECK_WATCHTOWER);
    } else {
      player.sendMessage("This railing is now fixed.");
    }
    return true;
  }

  function takeRemains({ player }) {
    const stage = quest.getStage(player);
    if (stage < STAGE_FIND_CAVE || stage >= STAGE_FIND_LOLLK) return true;
    if (has(player, ItemIdentifiers.DWARF_REMAINS)) {
      player.sendMessage("What? Carrying one set of Dwarf remains is enough...");
      return true;
    }
    player.getInventory().adds(ItemIdentifiers.DWARF_REMAINS, 1);
    player.sendMessage("You take the dwarf remains.");
    return true;
  }

  function searchCrate({ player }) {
    if (quest.getStage(player) === STAGE_FIND_LOLLK) {
      startTranscript(api, player, NpcIdentifiers.LOLLK, PAGE, "the-dwarf-child-searching-the-crate-containing-lollk");
    } else {
      player.sendMessage("You search the crate but find nothing.");
    }
    return true;
  }

  function inspectCannon({ player }) {
    if (quest.getStage(player) < STAGE_REPAIR_CANNON) return true;
    if (quest.getStage(player) >= STAGE_CANNON_REPAIRED) {
      player.sendMessage("This should work nicely now that I've fixed it.");
    } else if (has(player, ItemIdentifiers.TOOLKIT)) {
      player.sendMessage("I guess I'd better fix it with the toolkit I was given.");
    } else {
      player.sendMessage("The Black Guard sent Lawgof this cannon to help defend the mines against the goblins.");
    }
    return true;
  }

  function useToolkitOnCannon(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== CANNON_OBJECT_ID || itemId !== ItemIdentifiers.TOOLKIT) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_REPAIR_CANNON || stage >= STAGE_CANNON_REPAIRED) return;
    const sender = player.getPacketSender();
    for (const varbit of [...CANNON_TOOL_VARBITS.values(), CANNON_SAFETY_VARBIT, CANNON_SPRING_VARBIT]) {
      sender.sendVarbit(varbit, 0);
    }
    sender.sendInterface(CANNON_INTERFACE_GROUP);
    event.handled = true;
  }

  function handleCannonRepairClick(event) {
    const { player, buttonId } = event;
    if ((event.groupId ?? (buttonId >>> 16)) !== CANNON_INTERFACE_GROUP
      || quest.getStage(player) !== STAGE_REPAIR_CANNON) return;
    const childId = event.childId ?? (buttonId & 0xffff);
    const sender = player.getPacketSender();
    const toolVarbit = CANNON_TOOL_VARBITS.get(childId);
    if (toolVarbit !== undefined) {
      for (const varbit of CANNON_TOOL_VARBITS.values()) sender.sendVarbit(varbit, 0);
      sender.sendVarbit(toolVarbit, 1);
      event.handled = true;
      return;
    }

    const part = CANNON_INTERFACE_PARTS.get(childId);
    const requiredToolVarbit = { safety: 2236, spring: 2237, gear: 2235 }[part];
    if (!part || sender.getVarbit(requiredToolVarbit) !== 1) return;
    if (part === "safety") {
      sender.sendVarbit(CANNON_SAFETY_VARBIT, 1);
    } else if (part === "spring") {
      sender.sendVarbit(CANNON_SPRING_VARBIT, 1);
    } else if (sender.getVarbit(CANNON_SAFETY_VARBIT) === 1
      && sender.getVarbit(CANNON_SPRING_VARBIT) === 1) {
      sender.sendInterfaceRemoval();
      quest.setStage(player, STAGE_CANNON_REPAIRED);
      player.sendMessage("Well done! You've fixed the cannon! Better go and tell Captain Lawgof.");
    } else {
      return;
    }
    for (const varbit of CANNON_TOOL_VARBITS.values()) sender.sendVarbit(varbit, 0);
    event.handled = true;
  }

  function handleObjectInteraction(event) {
    const { player, objectId, option } = event;
    const action = String(option ?? "").toLowerCase();
    if (RAILING_OBJECT_IDS.has(objectId) && action === "inspect") {
      event.handled = repairRailing(event);
      return;
    }
    if (objectId === REMAINS_OBJECT_ID && at(event.location, REMAINS_TILE) && action === "take") {
      event.handled = takeRemains(event);
      return;
    }
    if (objectId === CRATE_OBJECT_ID && at(event.location, CRATE_TILE) && action === "search") {
      event.handled = searchCrate(event);
      return;
    }
    if (objectId === CANNON_OBJECT_ID && action === "inspect") {
      event.handled = inspectCannon(event);
      return;
    }
    if (objectId === MUDPILE_OBJECT_ID && at(event.location, MUDPILE_TILE) && action === "climb-over") {
      player.moveTo(new Location(OUTSIDE_CAVE_TILE.x, OUTSIDE_CAVE_TILE.y, OUTSIDE_CAVE_TILE.z));
      event.handled = true;
    }
  }

  function handleAction({ player, npcId, stepId }) {
    switch (stepId) {
      // Start: the transcript's hammer hand-out and six-railing message.
      case "dTVH6M":
        if (npcId === NpcIdentifiers.CAPTAIN_LAWGOF) addItem(player, ItemIdentifiers.HAMMER);
        return;
      // "The dwarf child runs off into the caverns." completes the crate rescue.
      case "VYQQX5":
        if (quest.getStage(player) === STAGE_FIND_LOLLK) quest.setStage(player, STAGE_RETURN_TO_LAWGOF);
        return;
      // "The Dwarf Captain gives you another railing."
      case "09BKsq":
        if (npcId === NpcIdentifiers.CAPTAIN_LAWGOF) addItem(player, ItemIdentifiers.RAILING);
        return;
      // "You give the Dwarf Captain his subordinate's remains..."
      case "KcffSR":
        if (npcId !== NpcIdentifiers.CAPTAIN_LAWGOF) return;
        if (quest.getStage(player) === STAGE_FIND_CAVE && has(player, ItemIdentifiers.DWARF_REMAINS)) {
          player.getInventory().deleteNumber(ItemIdentifiers.DWARF_REMAINS, 1);
          quest.setStage(player, STAGE_FIND_LOLLK);
        }
        return;
      // "The Dwarf Captain gives you a tool kit."
      case "dqO_5X":
        if (npcId !== NpcIdentifiers.CAPTAIN_LAWGOF || quest.getStage(player) !== STAGE_RETURN_TO_LAWGOF) return;
        if (!player.getInventory().isFull()) {
          addItem(player, ItemIdentifiers.TOOLKIT);
          if (has(player, ItemIdentifiers.TOOLKIT)) quest.setStage(player, STAGE_REPAIR_CANNON);
        }
        return;
      // The Dwarf Captain gives you another toolkit (lost-toolkit recovery).
      case "R6x03x":
        if (npcId === NpcIdentifiers.CAPTAIN_LAWGOF
          && quest.getStage(player) >= STAGE_REPAIR_CANNON
          && quest.getStage(player) < STAGE_CANNON_REPAIRED) {
          addItem(player, ItemIdentifiers.TOOLKIT);
        }
        return;
      // "You give the toolkit back to Captain Lawgof."
      case "A9qG_N":
        if (npcId !== NpcIdentifiers.CAPTAIN_LAWGOF) return;
        if (has(player, ItemIdentifiers.TOOLKIT)) player.getInventory().deleteNumber(ItemIdentifiers.TOOLKIT, 1);
        if (quest.getStage(player) === STAGE_CANNON_REPAIRED) quest.setStage(player, STAGE_SPEAK_TO_NULODION);
        return;
      // "The Cannon Engineer gives you some notes and a mould."
      case "udZI3D":
        if (npcId !== NpcIdentifiers.NULODION || quest.getStage(player) !== STAGE_SPEAK_TO_NULODION) return;
        const missingSlots = [ItemIdentifiers.NULODIONS_NOTES, ItemIdentifiers.AMMO_MOULD]
          .filter((itemId) => !has(player, itemId)).length;
        if (player.getInventory().getFreeSlots() < missingSlots) return;
        addItem(player, ItemIdentifiers.NULODIONS_NOTES);
        addItem(player, ItemIdentifiers.AMMO_MOULD);
        if (has(player, ItemIdentifiers.NULODIONS_NOTES) && has(player, ItemIdentifiers.AMMO_MOULD)) {
          quest.setStage(player, STAGE_RETURN_NOTES);
        }
        return;
      // Lost notes / lost ammo mould from Nulodion after the hand-out.
      case "vxwzuL":
        if (npcId === NpcIdentifiers.NULODION && quest.getStage(player) >= STAGE_RETURN_NOTES) {
          addItem(player, ItemIdentifiers.NULODIONS_NOTES);
        }
        return;
      case "3LMqqz":
        if (npcId === NpcIdentifiers.NULODION && quest.getStage(player) >= STAGE_RETURN_NOTES) {
          addItem(player, ItemIdentifiers.AMMO_MOULD);
        }
        return;
      // "Congratulations! Quest complete!"
      case COMPLETE_ACTION_ID:
        if (npcId !== NpcIdentifiers.CAPTAIN_LAWGOF) return;
        if (quest.getStage(player) < STAGE_RETURN_NOTES || quest.isComplete(player)) return;
        if (!has(player, ItemIdentifiers.NULODIONS_NOTES) || !has(player, ItemIdentifiers.AMMO_MOULD)) return;
        player.getInventory().deleteNumber(ItemIdentifiers.NULODIONS_NOTES, 1);
        quest.complete(player);
        return;
      default:
    }
  }

  function handleLogin({ player }) {
    const mask = Number(player.getAttribute(RAILS_MASK_ATTRIBUTE)) || 0;
    for (let index = 0; index < RAILS_REQUIRED; index++) {
      if ((mask & (1 << index)) !== 0) player.getPacketSender().sendVarbit(RAILING_FIXED_VARBITS[index], 1);
    }
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "dwarf_cannon",
    name: "Dwarf Cannon",
    varpId: VARP_DWARF_CANNON,
    startedValue: STAGE_REPAIR_RAILINGS,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 750, label: "Crafting" }],
    // Nulodion already supplies the mould; completion retains it.
    scrollItemId: ItemIdentifiers.AMMO_MOULD,
    rewardItemLabel: "An ammo mould",
    otherRewards: ["Ability to use dwarf multicannons", "Ability to make cannonballs", "Black Guard membership"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(RAILS_ATTRIBUTE, 0);
  api.persistAttribute(RAILS_MASK_ATTRIBUTE, 0);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(useToolkitOnCannon, { noted: false });
  api.onInterfaceActionClick(handleCannonRepairClick);
  api.onPlayerLogin(handleLogin);
};
