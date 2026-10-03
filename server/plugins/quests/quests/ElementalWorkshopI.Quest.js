/**
 * Elemental Workshop I (members).
 *
 * The "Elemental Workshop I" transcript page has no NPC index entry, so this quest
 * is entirely object/item driven: this plugin supplies the bit-field stage (varp
 * 244, ported from xrsps), the journal, the book/key/bookcase, the water and
 * bellows levers, the crates, the lava/furnace smelting and the workbench shield.
 *
 * Object ids were verified against ObjectIdentifiers and match the xrsps constants,
 * so the interactions follow xrsps. The elemental rock is mined straight to
 * elemental ore (xrsps spawns an earth elemental and drops it on death) and the
 * earth-elemental combat is not ported.
 *
 * Gaps: earth elemental combat/chatter, the odd-wall shape change and the level
 * requirement gates on the levers are simplified; the book interface
 * (action=open_interface) is not implemented.
 */
module.exports = function registerElementalWorkshopIQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP_ELEMENTAL_WORKSHOP = 244;

  const BIT = {
    readBook: 1 << 1,
    slashedBook: 1 << 2,
    waterLeft: 1 << 3,
    waterRight: 1 << 4,
    waterFlowing: 1 << 5,
    bellowsRepaired: 1 << 6,
    furnaceLit: 1 << 7,
    airBlowing: 1 << 9,
    enteredWorkshop: 1 << 13,
    leatherFound: 1 << 14,
    needleFound: 1 << 15,
    complete: 1 << 20,
  };

  const STAGE_STARTED = BIT.readBook;
  const STAGE_COMPLETE = BIT.complete;

  const BOOKCASE = ObjectIdentifiers.BOOKCASE_99;
  const ODD_WALLS = [ObjectIdentifiers.ODD_LOOKING_WALL_7, ObjectIdentifiers.ODD_LOOKING_WALL_8];
  const OPEN_ODD_WALL = ObjectIdentifiers.ODD_LOOKING_WALL_6;
  const BOWL_CRATE = ObjectIdentifiers.CRATE_27;
  const NEEDLE_CRATE = ObjectIdentifiers.CRATE_28;
  const LEATHER_CRATE = ObjectIdentifiers.BOXES_5;
  const WORKBENCH = ObjectIdentifiers.WORKBENCH_5;
  const WATER_CONTROLS = [ObjectIdentifiers.WATER_CONTROLS, ObjectIdentifiers.WATER_CONTROLS_2];
  const WATER_LEVER = ObjectIdentifiers.LEVER_22;
  const BELLOWS = [ObjectIdentifiers.BELLOWS_3, ObjectIdentifiers.BELLOWS_4];
  const AIR_LEVER = ObjectIdentifiers.LEVER_23;
  const FURNACES = [ObjectIdentifiers.FURNACE_14, ObjectIdentifiers.FURNACE_15];
  const LAVA_TROUGHS = [
    ObjectIdentifiers.LAVA_TROUGH,
    ObjectIdentifiers.LAVA_TROUGH_2,
    ObjectIdentifiers.LAVA_TROUGH_3,
    ObjectIdentifiers.LAVA_TROUGH_4,
    ObjectIdentifiers.LAVA_TROUGH_5,
  ];
  const SURFACE_STAIRS = ObjectIdentifiers.STAIRCASE_10;
  const WORKSHOP_STAIRS = ObjectIdentifiers.STAIRCASE_11;

  const PICKAXES = new Set([
    ItemIdentifiers.BRONZE_PICKAXE, ItemIdentifiers.IRON_PICKAXE, ItemIdentifiers.STEEL_PICKAXE,
    ItemIdentifiers.BLACK_PICKAXE, ItemIdentifiers.MITHRIL_PICKAXE, ItemIdentifiers.ADAMANT_PICKAXE,
    ItemIdentifiers.RUNE_PICKAXE,
  ]);

  let quest;

  const raw = (player) => quest.getStage(player);
  const hasBit = (player, bit) => (raw(player) & bit) !== 0;
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;

  function write(player, value) {
    quest.setStage(player, value | 0);
  }

  function setBit(player, bit, enabled = true) {
    write(player, enabled ? raw(player) | bit : raw(player) & ~bit);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= BIT.complete) {
      return ["<str>I restored the workshop and made an elemental shield.", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (!(stage & BIT.readBook)) {
      return [
        "I can start this quest by reading a battered book",
        "found in a house in Seers' Village.",
        "",
        "Minimum requirements: 20 Mining, Smithing and Crafting.",
      ];
    }
    const lines = ["I found a battered book describing elemental metal."];
    if (!(stage & BIT.slashedBook)) {
      lines.push("There may be something hidden inside its binding.");
      return lines;
    }
    lines.push("I cut open the book and found a battered key.");
    if (!(stage & BIT.enteredWorkshop)) {
      lines.push("I should use it on the odd wall in the Seers' Village smithy.");
      return lines;
    }
    lines.push("I discovered the Elemental Workshop beneath the village.");
    if (!(stage & BIT.waterFlowing)) lines.push("The eastern then western water controls should power the wheel.");
    if (!(stage & BIT.bellowsRepaired)) lines.push("The bellows need leather, thread and a needle.");
    if (!(stage & BIT.furnaceLit)) lines.push("A stone bowl of lava will light the furnace.");
    if (has(player, ItemIdentifiers.ELEMENTAL_METAL)) {
      lines.push("I should use the elemental metal on a workbench with a hammer.");
    } else if (stage & BIT.airBlowing) {
      lines.push("The furnace is ready for elemental ore and four coal.");
    } else {
      lines.push("Once the wheel and bellows work, I can heat the furnace properly.");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 5000);
    player.getSkillManager().addExperiences(Skill.SMITHING, 5000);
  }

  function crossOddWall(player, hasKey) {
    if (!hasKey && !has(player, ItemIdentifiers.BATTERED_KEY)) {
      player.sendMessage("You see a keyhole, but have no key that fits.");
      return;
    }
    player.sendMessage("You unlock the odd wall and step through.");
  }

  function fixBellows(player) {
    if (hasBit(player, BIT.bellowsRepaired)) {
      player.sendMessage("The bellows are already repaired.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 20) {
      player.sendMessage("You need level 20 Crafting to repair the bellows.");
      return;
    }
    if (!has(player, ItemIdentifiers.LEATHER) || !has(player, ItemIdentifiers.THREAD) || !has(player, ItemIdentifiers.NEEDLE)) {
      player.sendMessage("You need leather, thread and a needle to fix this.");
      return;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.LEATHER, 1);
    player.getInventory().deleteNumber(ItemIdentifiers.THREAD, 1);
    setBit(player, BIT.bellowsRepaired);
    player.sendMessage("You stitch the leather over the hole in the bellows.");
  }

  function handleObjectInteraction(event) {
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    const { player, objectId } = event;

    if (objectId === BOOKCASE && option.includes("search")) {
      if (!has(player, ItemIdentifiers.BATTERED_BOOK)) {
        player.getInventory().adds(ItemIdentifiers.BATTERED_BOOK, 1);
        player.sendMessage("You find a battered book titled 'The Elemental Shield'.");
      } else if (hasBit(player, BIT.slashedBook) && !has(player, ItemIdentifiers.BATTERED_KEY)) {
        player.getInventory().adds(ItemIdentifiers.BATTERED_KEY, 1);
        player.sendMessage("You recover the hidden key.");
      }
      event.handled = true;
      return;
    }
    if (ODD_WALLS.includes(objectId) && option.includes("open")) {
      crossOddWall(player, false);
      event.handled = true;
      return;
    }
    if (objectId === SURFACE_STAIRS && option.includes("climb")) {
      setBit(player, BIT.enteredWorkshop);
      player.sendMessage("You climb down into the Elemental Workshop.");
      event.handled = true;
      return;
    }
    if (objectId === WORKSHOP_STAIRS && option.includes("climb")) {
      player.sendMessage("You climb back up to the smithy.");
      event.handled = true;
      return;
    }
    if (objectId === BOWL_CRATE && option.includes("search")) {
      if (!has(player, ItemIdentifiers.A_STONE_BOWL) && !has(player, ItemIdentifiers.A_STONE_BOWL_2)) {
        player.getInventory().adds(ItemIdentifiers.A_STONE_BOWL, 1);
      }
      player.sendMessage("You search the crate.");
      event.handled = true;
      return;
    }
    if (objectId === NEEDLE_CRATE && option.includes("search")) {
      if (!hasBit(player, BIT.needleFound) && !has(player, ItemIdentifiers.NEEDLE)) {
        if (player.getInventory().adds(ItemIdentifiers.NEEDLE, 1)) setBit(player, BIT.needleFound);
      } else {
        player.sendMessage("The crate is empty.");
      }
      event.handled = true;
      return;
    }
    if (objectId === LEATHER_CRATE && option.includes("search")) {
      if (!hasBit(player, BIT.leatherFound) && !has(player, ItemIdentifiers.LEATHER)) {
        if (player.getInventory().adds(ItemIdentifiers.LEATHER, 1)) setBit(player, BIT.leatherFound);
      } else {
        player.sendMessage("The boxes are empty.");
      }
      event.handled = true;
      return;
    }
    if (WATER_CONTROLS.includes(objectId) && option.includes("turn")) {
      if (hasBit(player, BIT.waterFlowing)) {
        player.sendMessage("The controls are locked while the water wheel is running.");
      } else {
        const east = objectId === ObjectIdentifiers.WATER_CONTROLS_2;
        if (east && !hasBit(player, BIT.waterLeft)) setBit(player, BIT.waterRight, !hasBit(player, BIT.waterRight));
        else if (!east) setBit(player, BIT.waterLeft, !hasBit(player, BIT.waterLeft));
        player.sendMessage("You turn the water control.");
      }
      event.handled = true;
      return;
    }
    if (objectId === WATER_LEVER && option.includes("pull")) {
      if (hasBit(player, BIT.waterFlowing)) {
        setBit(player, BIT.waterFlowing, false);
        setBit(player, BIT.airBlowing, false);
        player.sendMessage("The water wheel comes to a standstill.");
      } else if (hasBit(player, BIT.waterLeft) && hasBit(player, BIT.waterRight)) {
        setBit(player, BIT.waterFlowing);
        player.sendMessage("The water wheel starts turning.");
      } else {
        setBit(player, BIT.waterLeft, false);
        setBit(player, BIT.waterRight, false);
        player.sendMessage("The flow gates reset; the wheel remains still.");
      }
      event.handled = true;
      return;
    }
    if (BELLOWS.includes(objectId) && option.includes("fix")) {
      fixBellows(player);
      event.handled = true;
      return;
    }
    if (objectId === AIR_LEVER && option.includes("pull")) {
      if (hasBit(player, BIT.airBlowing)) {
        setBit(player, BIT.airBlowing, false);
        player.sendMessage("The bellows stop pumping.");
      } else if (hasBit(player, BIT.waterFlowing) && hasBit(player, BIT.bellowsRepaired)) {
        setBit(player, BIT.airBlowing);
        player.sendMessage("The bellows pump air down the pipe.");
      } else {
        player.sendMessage("Nothing happens; the lever resets itself.");
      }
      event.handled = true;
    }
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (ODD_WALLS.includes(objectId) && itemId === ItemIdentifiers.BATTERED_KEY) {
      crossOddWall(player, true);
      event.handled = true;
      return;
    }
    if (LAVA_TROUGHS.includes(objectId) && itemId === ItemIdentifiers.A_STONE_BOWL) {
      player.getInventory().deleteNumber(ItemIdentifiers.A_STONE_BOWL, 1);
      player.getInventory().adds(ItemIdentifiers.A_STONE_BOWL_2, 1);
      player.sendMessage("You fill the bowl with hot lava.");
      event.handled = true;
      return;
    }
    if (FURNACES.includes(objectId)) {
      if (itemId === ItemIdentifiers.A_STONE_BOWL_2) {
        player.getInventory().deleteNumber(ItemIdentifiers.A_STONE_BOWL_2, 1);
        player.getInventory().adds(ItemIdentifiers.A_STONE_BOWL, 1);
        if (!hasBit(player, BIT.furnaceLit)) {
          setBit(player, BIT.furnaceLit);
          player.sendMessage("The furnace bursts to life.");
        } else {
          player.sendMessage("The extra lava makes little difference.");
        }
        event.handled = true;
        return;
      }
      if (itemId === ItemIdentifiers.ELEMENTAL_ORE) {
        if (!hasBit(player, BIT.furnaceLit) || !hasBit(player, BIT.airBlowing)) {
          player.sendMessage("The furnace is not hot enough to refine the ore.");
          event.handled = true;
          return;
        }
        if (!has(player, ItemIdentifiers.COAL, 4)) {
          player.sendMessage("You need four heaps of coal to smelt elemental ore.");
          event.handled = true;
          return;
        }
        player.getInventory().deleteNumber(ItemIdentifiers.ELEMENTAL_ORE, 1);
        player.getInventory().deleteNumber(ItemIdentifiers.COAL, 4);
        player.getInventory().adds(ItemIdentifiers.ELEMENTAL_METAL, 1);
        player.sendMessage("You retrieve a bar of elemental metal.");
        event.handled = true;
      }
      return;
    }
    if (objectId === WORKBENCH && itemId === ItemIdentifiers.ELEMENTAL_METAL) {
      if (player.getSkillManager().getCurrentLevel(Skill.SMITHING) < 20) {
        player.sendMessage("You need level 20 Smithing to work elemental metal.");
      } else if (!has(player, ItemIdentifiers.HAMMER)) {
        player.sendMessage("You need a hammer to work the metal.");
      } else if (!has(player, ItemIdentifiers.BATTERED_BOOK)) {
        player.sendMessage("You need the battered book's instructions.");
      } else {
        player.getInventory().deleteNumber(ItemIdentifiers.ELEMENTAL_METAL, 1);
        player.getInventory().adds(ItemIdentifiers.ELEMENTAL_SHIELD, 1);
        player.sendMessage("Following the instructions in the book, you make an elemental shield.");
        if (!hasBit(player, BIT.complete)) {
          const machine = raw(player);
          if (quest.complete(player)) write(player, machine | BIT.complete);
        }
      }
      event.handled = true;
    }
  }

  function handleItemOnItem(event) {
    const { player } = event;
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(ItemIdentifiers.BATTERED_BOOK)) return;
    const other = ids.find((id) => id !== ItemIdentifiers.BATTERED_BOOK);
    if (!hasBit(player, BIT.readBook)) {
      player.sendMessage("You should read the book before cutting it.");
      event.handled = true;
      return;
    }
    if (other === ItemIdentifiers.KNIFE && !has(player, ItemIdentifiers.BATTERED_KEY)) {
      player.getInventory().adds(ItemIdentifiers.BATTERED_KEY, 1);
      setBit(player, BIT.slashedBook);
      player.sendMessage("You cut the spine and find a battered key hidden inside.");
      event.handled = true;
    }
  }

  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (event.itemId !== ItemIdentifiers.BATTERED_BOOK || !option.includes("read")) return;
    event.player.sendMessage("The book describes a hidden workshop and the manufacture of elemental shields.");
    if (!hasBit(event.player, BIT.readBook)) setBit(event.player, BIT.readBook);
    event.handled = true;
  }

  function handleNpcInteraction(event) {
    const action = (event.definition?.getActions?.() ?? [])[event.clickType - 1];
    if (String(action).toLowerCase() !== "mine") return;
    const { player } = event;
    if (player.getSkillManager().getCurrentLevel(Skill.MINING) < 20) {
      player.sendMessage("You need level 20 Mining to mine elemental ore.");
      event.handled = true;
      return;
    }
    if (![...PICKAXES].some((id) => has(player, id))) {
      player.sendMessage("You need a pickaxe to mine this rock.");
      event.handled = true;
      return;
    }
    player.getInventory().adds(ItemIdentifiers.ELEMENTAL_ORE, 1);
    player.sendMessage("You mine a chunk of elemental ore.");
    event.handled = true;
  }

  function handleStartHook({ player, hook }) {
    if (hook !== "quest:elemental-workshop-i:start") return;
    if (!hasBit(player, BIT.readBook)) setBit(player, BIT.readBook);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "elemental_workshop_i",
    name: "Elemental Workshop I",
    varpId: VARP_ELEMENTAL_WORKSHOP,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 5000, label: "Crafting" },
      { skillId: Skill.SMITHING.getIndex(), amount: 5000, label: "Smithing" },
    ],
    rewardItemId: ItemIdentifiers.ELEMENTAL_SHIELD,
    rewardItemLabel: "An elemental shield",
    otherRewards: ["The ability to make elemental shields"],
    buildJournal,
    onReward: grantReward,
  });

  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onPlayerLogin(handleLogin);
};
