/**
 * Elemental Workshop I (members).
 *
 * The "Elemental Workshop I" transcript page has no NPC index entry, so this quest
 * is entirely object/item driven: this plugin supplies the bit-field stage, the
 * journal, the book/key/bookcase, the water and bellows levers, the crates, the
 * lava/furnace smelting and the workbench shield.
 *
 * Stage is a durable bitfield (so existing saves keep their meaning across relogs)
 * laid out like the cache's elemental_workshop_* varbits on varp 299 (book bit 1,
 * key bit 2, gate1 bit 3, gate2 bit 4, switch bit 5, bellows bit 6, fire bit 7,
 * bellows switch bit 9, stairs bit 13, leather bit 14, finished bit 20). Private
 * needle bit 15 and entered-wall bit 16 map to the client's entered-wall bit 15;
 * needle history is never sent as wall progress. Legacy workshop entry proves
 * an earlier wall crossing. Unmodelled machine fields are preserved. The cache
 * reads quest completion from a separate status varbit, 13718
 * ("elementalworkshop" on varp 3403 bits 10-14; DB table 0 column 19 threshold 2),
 * so setStage maps the durable bitfield to that wire: started 1, complete 2.
 * Object ids were verified against ObjectIdentifiers and the cache loc dump.
 *
 * The elemental rock releases a private earth elemental for the mining player; killing
 * it drops the elemental ore on the death tile for normal pickup. Gaps: the odd-wall shape change and the level requirement
 * gates on the levers are simplified; the book interface (action=open_interface) is not
 * implemented.
 */
module.exports = function registerElementalWorkshopIQuest(api) {
  const { Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  // Machine state uses varp 299; durable needle bit 15 / wall bit 16 are translated below so
  // finding a needle cannot impersonate QH's entered-wall bit 15.
  const VARP_MACHINE_BITS = 299;
  // Canonical completion wire read by cache script 4024/4029; threshold 2.
  const VARBIT_QUEST_STATUS = 13718;
  const EW2_KEY = "elemental_workshop_ii";
  // EW2 stage 6 = both schematics taken, crane claw not made yet.
  const EW2_MACHINERY_STAGE = 6;
  const EW2_JIG_ATTRIBUTE = "quest.elemental_workshop_ii.jig";

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
    enteredWall: 1 << 16,
    complete: 1 << 20,
  };

  const STAGE_STARTED = BIT.readBook;
  const STAGE_COMPLETE = BIT.complete;

  const BOOKCASE = ObjectIdentifiers.BOOKCASE_99;
  const ODD_WALLS = [ObjectIdentifiers.ODD_LOOKING_WALL_7, ObjectIdentifiers.ODD_LOOKING_WALL_8];
  const OPEN_ODD_WALL = ObjectIdentifiers.ODD_LOOKING_WALL_6;
  // The cache places multi-loc bases; the 185xx ids are their varbit children.
  const BOWL_CRATE = ObjectIdentifiers.BOXES_5; // 3397, the wiki's stone-bowl boxes
  const NEEDLE_CRATE = ObjectIdentifiers.CRATE_28;
  const LEATHER_CRATE = ObjectIdentifiers.CRATE_27; // 3394, the wiki's leather crate
  const WORKBENCH = ObjectIdentifiers.WORKBENCH_5;
  const WATER_CONTROL_EAST = 3403; // elemental_workshop_valve_1 at 2726,9908
  const WATER_CONTROL_WEST = 3404; // elemental_workshop_valve_2 at 2713,9908
  const WATER_WHEEL_X = 2720; // wheel spans x2718-2720; east valve 2726, west valve 2713
  const WATER_CONTROLS = [
    ObjectIdentifiers.WATER_CONTROLS,
    ObjectIdentifiers.WATER_CONTROLS_2,
    WATER_CONTROL_EAST,
    WATER_CONTROL_WEST,
  ];
  const WATER_LEVER = ObjectIdentifiers.LEVER_22;
  const BELLOWS_BASE = 3407; // elemental_workshop_bellows_multiloc, children 18515/18516
  const BELLOWS = [ObjectIdentifiers.BELLOWS_3, ObjectIdentifiers.BELLOWS_4, BELLOWS_BASE];
  const AIR_LEVER = ObjectIdentifiers.LEVER_23;
  const FURNACE_BASE = 3410; // elemental_workshop_furnace, children 18525/18526
  const FURNACES = [ObjectIdentifiers.FURNACE_14, ObjectIdentifiers.FURNACE_15, FURNACE_BASE];
  const LAVA_TROUGHS = [
    ObjectIdentifiers.LAVA_TROUGH,
    ObjectIdentifiers.LAVA_TROUGH_2,
    ObjectIdentifiers.LAVA_TROUGH_3,
    ObjectIdentifiers.LAVA_TROUGH_4,
    ObjectIdentifiers.LAVA_TROUGH_5,
  ];
  const SURFACE_STAIRS = ObjectIdentifiers.STAIRCASE_10;
  const WORKSHOP_STAIRS = ObjectIdentifiers.STAIRCASE_11;

  /** Any pickaxe the player can use, as Mining judges them (crystal, infernal, 3rd age... not only bronze to rune). */
  function hasPickaxe(player) {
    const request = { player, pickaxe: null };
    api.emitCustomEvent("mining:best-pickaxe", request);
    return request.pickaxe != null;
  }

  let quest;
  // The rocks are shared scenery; each player's mined earth elemental is a private spawn.
  const elementalByPlayer = new WeakMap();
  const ownerByElemental = new WeakMap();

  const raw = (player) => quest.getStage(player);
  const hasBit = (player, bit) => (raw(player) & bit) !== 0;
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;

  function write(player, value) {
    quest.setStage(player, value | 0);
    // Mirror the machine bits the client renders (bellows/furnace/wheel transforms).
    syncMachine(player);
  }

  function syncMachine(player) {
    const value = raw(player);
    const enteredWall = (value & (BIT.enteredWall | BIT.enteredWorkshop)) !== 0;
    const mask = BIT.readBook | BIT.slashedBook | BIT.waterLeft | BIT.waterRight | BIT.waterFlowing
      | BIT.bellowsRepaired | BIT.furnaceLit | BIT.airBlowing | BIT.enteredWorkshop | BIT.leatherFound
      | BIT.complete | (1 << 15);
    const machine = (value & ~(BIT.needleFound | BIT.enteredWall)) | (enteredWall ? 1 << 15 : 0);
    const sender = player.getPacketSender();
    sender.sendConfig(VARP_MACHINE_BITS, (sender.getVarp(VARP_MACHINE_BITS) & ~mask) | (machine & mask));
  }

  function questStage(player, key) {
    const request = { player, key, stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return Number(request.stage) || 0;
  }

  /** EW2's crane-claw leg: its workbench must win the metal bar handoff. */
  function ew2NeedsCraneClaw(player) {
    if (questStage(player, EW2_KEY) !== EW2_MACHINERY_STAGE) return false;
    if (has(player, ItemIdentifiers.CRANE_CLAW)) return false;
    const jig = Number(player.getAttribute(EW2_JIG_ATTRIBUTE)) || 0;
    return ((jig >> 7) & 3) === 0;
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
    setBit(player, BIT.enteredWall);
    player.sendMessage("You unlock the odd wall and step through.");
    // The stairwell zone north of the wall (Quest Helper: 2709,3496-2711,3498).
    player.moveTo(new Location(2710, 3496, 0));
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
    const { player, objectId, location } = event;

    if (objectId === BOOKCASE && option.includes("search")) {
      const book = hasBit(player, BIT.slashedBook) ? ItemIdentifiers.SLASHED_BOOK : ItemIdentifiers.BATTERED_BOOK;
      if (!has(player, book)) {
        player.getInventory().adds(book, 1);
        if (has(player, book)) player.sendMessage("You find a book titled 'The Elemental Shield'.");
      }
      if (hasBit(player, BIT.slashedBook) && !has(player, ItemIdentifiers.BATTERED_KEY)) {
        player.getInventory().adds(ItemIdentifiers.BATTERED_KEY, 1);
        if (has(player, ItemIdentifiers.BATTERED_KEY)) player.sendMessage("You recover the hidden key.");
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
      player.moveTo(new Location(2716, 9888, 0));
      event.handled = true;
      return;
    }
    if (objectId === WORKSHOP_STAIRS && option.includes("climb")) {
      player.sendMessage("You climb back up to the smithy.");
      player.moveTo(new Location(2709, 3498, 0));
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
      if (!has(player, ItemIdentifiers.NEEDLE)) {
        player.getInventory().adds(ItemIdentifiers.NEEDLE, 1);
        if (has(player, ItemIdentifiers.NEEDLE)) setBit(player, BIT.needleFound);
      } else {
        player.sendMessage("The crate is empty.");
      }
      event.handled = true;
      return;
    }
    if (objectId === LEATHER_CRATE && option.includes("search")) {
      if (!hasBit(player, BIT.leatherFound) && !has(player, ItemIdentifiers.LEATHER)) {
        player.getInventory().adds(ItemIdentifiers.LEATHER, 1);
        if (has(player, ItemIdentifiers.LEATHER)) setBit(player, BIT.leatherFound);
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
        const east = location ? location.x > WATER_WHEEL_X : objectId === ObjectIdentifiers.WATER_CONTROLS_2;
        if (east) setBit(player, BIT.waterRight, !hasBit(player, BIT.waterRight));
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
      // EW2's crane claw is made from the same bar on the same workbench. Yield only
      // while EW2 is on its schematics stage, still needs the claw and the crane is
      // un-repaired, so its registered handler (and choice) runs.
      if (ew2NeedsCraneClaw(player)) return;
      if (player.getSkillManager().getCurrentLevel(Skill.SMITHING) < 20) {
        player.sendMessage("You need level 20 Smithing to work elemental metal.");
      } else if (!has(player, ItemIdentifiers.HAMMER)) {
        player.sendMessage("You need a hammer to work the metal.");
      } else if (!has(player, ItemIdentifiers.SLASHED_BOOK)) {
        player.sendMessage("You need the slashed book's instructions.");
      } else {
        player.getInventory().deleteNumber(ItemIdentifiers.ELEMENTAL_METAL, 1);
        player.sendMessage("Following the instructions in the book, you make an elemental shield.");
        if (!hasBit(player, BIT.complete)) {
          const machine = raw(player);
          // complete() awards the shield and XP exactly once; do not add a second shield.
          if (quest.complete(player)) write(player, machine | BIT.complete);
        } else {
          player.getInventory().adds(ItemIdentifiers.ELEMENTAL_SHIELD, 1);
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
    if (other === ItemIdentifiers.KNIFE && has(player, ItemIdentifiers.BATTERED_BOOK)) {
      event.handled = true;
      const inventory = player.getInventory();
      if (!has(player, ItemIdentifiers.BATTERED_KEY) && inventory.getFreeSlots() < 1) {
        inventory.full();
        return;
      }
      inventory.deleteNumber(ItemIdentifiers.BATTERED_BOOK, 1);
      inventory.adds(ItemIdentifiers.SLASHED_BOOK, 1);
      if (!has(player, ItemIdentifiers.BATTERED_KEY)) inventory.adds(ItemIdentifiers.BATTERED_KEY, 1);
      if (has(player, ItemIdentifiers.SLASHED_BOOK) && has(player, ItemIdentifiers.BATTERED_KEY)) {
        setBit(player, BIT.slashedBook);
        player.sendMessage("You cut the spine and find a battered key hidden inside.");
      }
    }
  }

  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (![ItemIdentifiers.BATTERED_BOOK, ItemIdentifiers.SLASHED_BOOK].includes(event.itemId) || !option.includes("read")) return;
    event.player.sendMessage("The book describes a hidden workshop and the manufacture of elemental shields.");
    if (!hasBit(event.player, BIT.readBook)) setBit(event.player, BIT.readBook);
    event.handled = true;
  }

  function handleNpcInteraction(event) {
    if (event.npcId !== NpcIdentifiers.ELEMENTAL_ROCK) return;
    const action = (event.definition?.getActions?.() ?? [])[event.clickType - 1];
    if (String(action).toLowerCase() !== "mine") return;
    const { player } = event;
    if (player.getSkillManager().getCurrentLevel(Skill.MINING) < 20) {
      player.sendMessage("You need level 20 Mining to mine elemental ore.");
      event.handled = true;
      return;
    }
    if (!hasPickaxe(player)) {
      player.sendMessage("You need a pickaxe to mine this rock.");
      event.handled = true;
      return;
    }
    if (elementalByPlayer.has(player)) {
      player.sendMessage("The rock is already disturbed; deal with the earth elemental first.");
      event.handled = true;
      return;
    }
    const at = event.location ?? event.npc?.getLocation?.();
    if (!at) return;
    const elemental = api.spawnNpc({
      id: NpcIdentifiers.EARTH_ELEMENTAL_2,
      x: at.x, y: at.y, z: at.z ?? 0,
      owner: player, ownerOnly: true, wanderRadius: 0,
    });
    if (!elemental) {
      player.sendMessage("The rock shifts, but nothing answers your pickaxe.");
      event.handled = true;
      return;
    }
    elementalByPlayer.set(player, elemental);
    ownerByElemental.set(elemental, player);
    player.sendMessage("The rock cracks open and an earth elemental rises!");
    event.handled = true;
  }

  function handleNpcDeath(event) {
    const owner = ownerByElemental.get(event.npc);
    if (!owner) return;
    if (elementalByPlayer.get(owner) !== event.npc) return;
    elementalByPlayer.delete(owner);
    ownerByElemental.delete(event.npc);
    // NpcDrops owns NPC 1367's canonical floor loot (elemental ore and Rock).
  }

  function handlePlayerLogout({ player }) {
    const elemental = elementalByPlayer.get(player);
    if (!elemental) return;
    elementalByPlayer.delete(player);
    ownerByElemental.delete(elemental);
    api.removeNpc(elemental);
  }


  function handleStartHook({ player, hook }) {
    if (hook !== "quest:elemental-workshop-i:start") return;
    if (!hasBit(player, BIT.readBook)) setBit(player, BIT.readBook);
  }

  function handleLogin({ player }) {
    // Login replay of the machine bits; the canonical status varbit is re-sent by
    // QuestRuntime.sendQuestVarps on bootstrap-complete.
    syncMachine(player);
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "elemental_workshop_i",
    name: "Elemental Workshop I",
    varbitId: VARBIT_QUEST_STATUS,
    // Existing durable bitfield saves keep their meaning; only the wire is mapped.
    varbitValue(stage) {
      if (stage >= BIT.complete) return 2;
      return stage !== 0 ? 1 : 0;
    },
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
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogout(handlePlayerLogout);
  api.onPlayerLogin(handleLogin);
};
