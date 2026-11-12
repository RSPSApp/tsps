// Miss Cheevers' room (room 6): the stone door with no handle and the locked door behind it.
//
// rsprox capture RecruitmentDrive.bin (revision 242.1), ticks 1101-1781 (quit), 2030-2280,
// 2553-2718, 3354-3512:
//   - Arriving, she says her five lines. A first talk plays "Can you give me any help?" and sets
//     rd_room6_hint1 (690); later talks play the "REALLY stuck" conversation.
//   - Bookshelves and crates hold one item each, found once: "You search the bookshelves..." /
//     "You search the crate..." on the click, the find two ticks later, else "You don't find
//     anything interesting." The closed chest opens (human_openchest 536, chest_open 52, the open
//     chest a tick later) and its Search finds the shears; it closes again 300 ticks after it was
//     opened (ticks 1233, 1532).
//   - The chemical shelves: a message box, then a menu; each vial taken sets its rd_got_ varbit
//     (671-678), the three-vial shelf counts into rd_spare_water (679). An empty shelf: "There is
//     nothing of interest on these shelves."
//   - The Bunsen burner burns the spade's handle off (firewave_impact 157 on the player's tile,
//     bunsen_burner 2595, ashes) and heats the filled mould; a vial on it is "Erm... It's now
//     slightly warmer. ..."; anything else is "Nothing interesting happens."
//   - The stone door (7342, multiloc on rd_room6_stone_door 686): the bare spade in its hole (1,
//     recruit_spade 1742), cupric sulphate on the spade (rd_react_on_spade 687), then a vial of
//     water expands it (2); Pull-spade swings it open (3, stone_door 86); Walk-through walks the
//     two tiles across it.
//   - The tin: water (rd_water_in_tin 689), then gypsum makes the plaster (rd_gypsum_in_tin 688,
//     both back to 0, 5593); on the chained key it takes the impression (5594); copper ore powder
//     (5596) and tin ore powder (5597) go into it, the burner makes the bronze key (5598), and a
//     knife or the chisel prises it out (5585 and the empty mould 5594), passing the room
//     (rd_room6_complete 664).
//   - The exit door with the key: "You use the duplicate key you made to unlock the door."
//   - Nitrous oxide's Open: "You uncork the vial..." (an empty vial), then "You smell a strange gas
//     as it escapes from inside the vial." with emote_laugh 861 and "hahahahahahaha!" overhead.
//   - The alchemical notes' Read opens the two-page book (392), human_readbook 1350; its eleven
//     spreads are in data/cheevers-notes.json, from the capture's if_settext lines (ticks 1590-1638).
module.exports = function createCheeversRoom(api, course, ids) {
  const ROOM = 6;
  const NPC = ids.MISS_CHEEVERS;
  const V_ENTER = "the-tests-miss-cheevers-entering-the-room";
  const V_ONCE = "the-tests-miss-cheevers-talking-to-miss-cheevers-once";
  const V_SECOND = "the-tests-miss-cheevers-talking-to-miss-cheevers-a-second-time";
  const NOTES = require("./data/cheevers-notes.json");

  const ITEM = {
    CUPRIC_SULPHATE: 5577, ACETIC_ACID: 5578, GYPSUM: 5579, SODIUM_CHLORIDE: 5580, NITROUS_OXIDE: 5581,
    WATER: 5582, TIN_ORE_POWDER: 5583, COPPER_ORE_POWDER: 5584, KEY: 5585, SPADE: 5586, SPADE_NO_HANDLE: 5587,
    NOTES: 5588, TIN: 5592, TIN_FULL: 5593, KEY_MOULD: 5594, MOULD_TIN: 5595, MOULD_COPPER: 5596,
    MOULD_UNHEATED: 5597, MOULD_COMPLETE: 5598, CHISEL: 5601, WIRE: 5602, SHEARS: 5603, MAGNET: 5604, KNIFE: 5605,
    VIAL: 229, ASHES: 592,
  };
  const CHEMICALS = new Set([ITEM.CUPRIC_SULPHATE, ITEM.ACETIC_ACID, ITEM.GYPSUM, ITEM.SODIUM_CHLORIDE,
    ITEM.NITROUS_OXIDE, ITEM.WATER, ITEM.TIN_ORE_POWDER, ITEM.COPPER_ORE_POWDER]);
  const VARBIT = { HINT: 690, STONE_DOOR: 686, REACT_ON_SPADE: 687, GYPSUM_IN_TIN: 688, WATER_IN_TIN: 689, SPARE_WATER: 679 };

  const LOC = {
    BOOKSHELVES: [7327, 7328, 7329, 7330], CRATES: [7347, 7348, 7349], CHEST_CLOSED: 7350, CHEST_OPEN: 7351,
    SHELVES: [7333, 7334, 7335, 7336, 7337, 7338, 7339, 7340], BURNER: 7332, STONE_DOOR: 7342, KEY: 7346,
  };
  const CHEST_TILE = [2477, 4942];
  const SPADE_TILE = [2473, 4941];
  const SPADE_RESPAWN_TICKS = 7;
  const CHEST_FACE = 3;
  const CHEST_CLOSE_TICKS = 300;
  // What each searchable loc holds, by loc id (any of the room's same-id locs).
  const FINDS = new Map([
    [7327, { item: ITEM.MAGNET, text: "Hidden amongst the books you find a magnet." }],
    [7328, { item: ITEM.NOTES, text: "You find a book that looks like it might be helpful." }],
    [7329, { item: ITEM.KNIFE, text: "Hidden amongst the books you find a knife." }],
    [7347, { item: ITEM.TIN, text: "Inside the crate you find a tin." }],
    [7348, { item: ITEM.CHISEL, text: "Inside the crate you find a chisel." }],
    [7349, { item: ITEM.WIRE, text: "Inside the crate you find some wire." }],
  ]);
  // The shelves left to right. `vials`: the shelf's vials with their rd_got_ varbits.
  const SHELVES = new Map([
    [7333, { vials: [{ item: ITEM.ACETIC_ACID, varbit: 671 }, { item: ITEM.WATER, varbit: 672 }] }],
    [7334, { vials: [{ item: ITEM.CUPRIC_SULPHATE, varbit: 673 }] }],
    [7335, { vials: [{ item: ITEM.GYPSUM, varbit: 674 }] }],
    [7336, { vials: [{ item: ITEM.SODIUM_CHLORIDE, varbit: 675 }] }],
    [7337, { vials: [{ item: ITEM.NITROUS_OXIDE, varbit: 676 }] }],
    [7338, { vials: [{ item: ITEM.TIN_ORE_POWDER, varbit: 677 }] }],
    [7339, { vials: [{ item: ITEM.COPPER_ORE_POWDER, varbit: 678 }] }],
    [7340, { spare: 3 }],
  ]);
  const TEXT = {
    searchBooks: "You search the bookshelves...", searchCrate: "You search the crate...", searchChest: "You search the chest...",
    nothing: "You don't find anything interesting.", shears: "Inside the chest you find some shears.",
    oneVial: "There is a vial on this shelf.", twoVials: "There are two vials on this shelf.",
    threeVials: "There are three vials on this shelf.", emptyShelf: "There is nothing of interest on these shelves.",
    study: "There is a stone slab here obstructing the door.<br>There is a small hole in the slab that looks like it might be for a<br>handle.",
    smash: "I don't think I'll be able to smash my way through the stone with a spade...",
    pour: "I don't see what the point in pouring that on the slab would be...",
    warmer: "Erm... It's now slightly warmer. I don't think that helped much.",
    nothingHappens: "Nothing interesting happens.",
  };
  const SOUND = { CHEST: 52, BURNER: 2595, SPADE: 1742, POUR: 2613, STONE_DOOR: 86, VIAL_EMPTY: 2610 };
  const ANIM = { OPEN_CHEST: 536, VIAL: 363, LAUGH: 861, READ: 1350 };
  const FIREWAVE = 157;

  /** Player -> { found: Set(loc ids), chestOpen, chest, talks } for the room. */
  const rooms = new WeakMap();

  function state(player) {
    return course.inRoom(player, ROOM) ? rooms.get(player) ?? null : null;
  }

  function varbit(player, id) {
    return player.getPacketSender().getVarbit(id);
  }

  function setVarbit(player, id, value) {
    player.getPacketSender().sendVarbit(id, value);
  }

  function enter(player) {
    const room = { found: new Set(), chest: null, talks: 0, spade: null };
    rooms.set(player, room);
    laySpade(player, room);
    course.say(player, course.lines(course.variant(V_ENTER)).map((line) => ({ npc: NPC, text: line.text })));
  }

  /**
   * The metal spade on the table (2473,4941): there on every entry and back 7 ticks after it is
   * picked up (ticks 1308-1315). Ours: one per player, as Sir Leye's weapons are.
   */
  function laySpade(player, room) {
    const { Item, Location } = api.core;
    room.spade = api.getItemOnGroundManager()?.registerLocation?.(player, new Item(ITEM.SPADE, 1),
      new Location(SPADE_TILE[0], SPADE_TILE[1], 0), player.getPrivateArea(), { goesGlobal: false, despawnDelay: 6000 }) ?? null;
  }

  function retakeSpade(event) {
    const room = rooms.get(event.player);
    if (!room || !room.spade || event.groundItem !== room.spade) return;
    room.spade = null;
    course.later(event.player, SPADE_RESPAWN_TICKS, () => {
      if (rooms.get(event.player) === room && !room.spade) laySpade(event.player, room);
    });
  }

  function clear(player) {
    const room = rooms.get(player);
    rooms.delete(player);
    if (room?.spade) api.getItemOnGroundManager()?.deregister?.(room.spade);
    if (room?.chest) closeChest(player, room);
    if (player.getInterfaceId?.() === 392) player.getPacketSender().sendInterfaceRemoval();
  }

  function entriesOf(variant) {
    return course.lines(course.variant(variant)).map((line) => (line.player ? { player: line.player } : { npc: NPC, text: line.text }));
  }

  function talk(event) {
    const room = state(event.player);
    if (!room) return false;
    const first = varbit(event.player, VARBIT.HINT) === 0;
    course.say(event.player, entriesOf(first ? V_ONCE : V_SECOND));
    if (first) setVarbit(event.player, VARBIT.HINT, 1);
    return true;
  }

  // ---- searching -------------------------------------------------------------------------------

  function give(player, item, amount = 1) {
    player.getInventory().add(new api.core.Item(item, amount), true);
  }

  function search(player, objectId, opening) {
    const room = state(player);
    if (!room) return false;
    const find = FINDS.get(objectId);
    player.sendMessage(opening);
    course.later(player, 2, () => {
      if (state(player) !== room) return;
      if (find && !room.found.has(objectId)) {
        room.found.add(objectId);
        give(player, find.item);
        player.sendMessage(find.text);
      } else {
        player.sendMessage(TEXT.nothing);
      }
    });
    return true;
  }

  function searchBooks(event) {
    if (!LOC.BOOKSHELVES.includes(event.objectId)) return false;
    return search(event.player, event.objectId, TEXT.searchBooks);
  }

  function searchCrate(event) {
    if (!LOC.CRATES.includes(event.objectId)) return false;
    return search(event.player, event.objectId, TEXT.searchCrate);
  }

  function chestObject(id, player) {
    const { GameObject, Location } = api.core;
    return new GameObject(id, new Location(CHEST_TILE[0], CHEST_TILE[1], 0), 10, CHEST_FACE, null).setOwner(player);
  }

  function openChest(event) {
    const { player } = event;
    const room = state(player);
    if (!room || event.objectId !== LOC.CHEST_CLOSED) return false;
    if (room.chest) return true;
    player.performAnimation(new api.core.Animation(ANIM.OPEN_CHEST));
    player.getPacketSender().sendSound(SOUND.CHEST, 255, 0);
    course.later(player, 1, () => {
      if (state(player) !== room || room.chest) return;
      room.chest = chestObject(LOC.CHEST_OPEN, player);
      api.core.ObjectManager.register(room.chest, true);
      const chest = room.chest;
      course.later(player, CHEST_CLOSE_TICKS, () => {
        if (rooms.get(player) === room && room.chest === chest) closeChest(player, room);
      });
    });
    return true;
  }

  function closeChest(player, room) {
    const chest = room.chest;
    room.chest = null;
    if (!chest) return;
    api.core.ObjectManager.deregister(chest, true);
    const { GameObject, Location } = api.core;
    player.getPacketSender().sendObject(new GameObject(LOC.CHEST_CLOSED, new Location(CHEST_TILE[0], CHEST_TILE[1], 0), 10, CHEST_FACE, null));
  }

  function searchChest(event) {
    const room = state(event.player);
    if (!room || event.objectId !== LOC.CHEST_OPEN) return false;
    room.found.add(LOC.CHEST_OPEN);
    event.player.sendMessage(TEXT.searchChest);
    const first = !room.foundShears;
    room.foundShears = true;
    course.later(event.player, 2, () => {
      if (state(event.player) !== room) return;
      if (first) give(event.player, ITEM.SHEARS);
      event.player.sendMessage(first ? TEXT.shears : TEXT.nothing);
    });
    return true;
  }

  function shutChest(event) {
    const room = state(event.player);
    if (!room || event.objectId !== LOC.CHEST_OPEN) return false;
    closeChest(event.player, room);
    return true;
  }

  // ---- shelves ---------------------------------------------------------------------------------

  function shelf(event) {
    const { player, objectId } = event;
    const definition = SHELVES.get(objectId);
    if (!state(player) || !definition) return false;
    if (definition.spare) {
      spareShelf(player);
      return true;
    }
    const left = definition.vials.filter((vial) => varbit(player, vial.varbit) === 0);
    if (left.length === 0) {
      course.say(player, [{ statement: TEXT.emptyShelf }]);
      return true;
    }
    const take = (vials) => () => {
      for (const vial of vials) {
        if (varbit(player, vial.varbit) !== 0) continue;
        setVarbit(player, vial.varbit, 1);
        give(player, vial.item);
      }
    };
    if (left.length === 1) {
      course.say(player, [{ statement: TEXT.oneVial }], () =>
        api.sendMultiChatboxPrompt(player, "Take the vial?", "YES", take(left), "NO", () => {}));
      return true;
    }
    course.say(player, [{ statement: TEXT.twoVials }], () =>
      api.sendMultiChatboxPrompt(player, "Take the vials?",
        "Take the first vial.", take([left[0]]),
        "Take the second vial.", take([left[1]]),
        "Take both vials.", take(left)));
    return true;
  }

  function spareShelf(player) {
    const taken = varbit(player, VARBIT.SPARE_WATER);
    const left = 3 - taken;
    const take = (count) => () => {
      setVarbit(player, VARBIT.SPARE_WATER, taken + count);
      give(player, ITEM.WATER, count);
    };
    if (left <= 0) {
      course.say(player, [{ statement: TEXT.emptyShelf }]);
    } else if (left === 3) {
      course.say(player, [{ statement: TEXT.threeVials }], () => api.sendMultiChatboxPrompt(player, "Take the vials?",
        "Take one vial", take(1), "Take two vials", take(2), "Take all three vials", take(3), "Don't take a vial.", () => {}));
    } else if (left === 2) {
      course.say(player, [{ statement: TEXT.twoVials }], () => api.sendMultiChatboxPrompt(player, "Take the vials?",
        "Take one vial", take(1), "Take both vials", take(2), "Don't take a vial.", () => {}));
    } else {
      // Ours: the last vial asks as the single-vial shelves do.
      course.say(player, [{ statement: TEXT.oneVial }], () =>
        api.sendMultiChatboxPrompt(player, "Take the vial?", "YES", take(1), "NO", () => {}));
    }
  }

  // ---- items -----------------------------------------------------------------------------------

  function replace(player, slot, id) {
    const inventory = player.getInventory();
    inventory.setItem(slot, new api.core.Item(id, 1));
    inventory.refreshItems();
  }

  function slotOf(player, id) {
    return player.getInventory().getSlotForItemId(id);
  }

  function useVial(player, vialId, then) {
    const slot = slotOf(player, vialId);
    if (slot < 0) return false;
    replace(player, slot, ITEM.VIAL);
    then?.();
    return true;
  }

  function burner(event) {
    const { player, itemId, itemSlot } = event;
    if (!state(player) || event.objectId !== LOC.BURNER) return;
    event.handled = true;
    if (itemId === ITEM.SPADE) {
      player.sendMessage("You burn the wooden handle away from the spade...");
      course.later(player, 1, () => {
        if (!state(player) || player.getInventory().getItems()[itemSlot]?.getId?.() !== ITEM.SPADE) return;
        replace(player, itemSlot, ITEM.SPADE_NO_HANDLE);
        give(player, ITEM.ASHES);
        player.sendMessage("...and are left with a metal spade with no handle.");
        const at = player.getLocation();
        player.getPacketSender().sendGraphic(new api.core.Graphic(FIREWAVE, 0, 128), at);
        player.getPacketSender().sendSound(SOUND.BURNER, 255, 0);
      });
      return;
    }
    if (itemId === ITEM.MOULD_UNHEATED) {
      replace(player, itemSlot, ITEM.MOULD_COMPLETE);
      player.sendMessage("You heat the two powdered ores together in the tin.");
      player.sendMessage("You make a duplicate of the key in bronze.");
      return;
    }
    if (CHEMICALS.has(itemId)) {
      course.say(player, [{ player: TEXT.warmer }]);
      return;
    }
    player.sendMessage(TEXT.nothingHappens);
  }

  function stoneDoorUse(event) {
    const { player, itemId, itemSlot } = event;
    if (!state(player) || event.objectId !== LOC.STONE_DOOR) return;
    event.handled = true;
    const door = varbit(player, VARBIT.STONE_DOOR);
    if (door === 0 && itemId === ITEM.SPADE_NO_HANDLE) {
      player.getInventory().deleteAtSlot(itemSlot, 1, true);
      player.sendMessage("You slide the spade into the hole in the stone...");
      setVarbit(player, VARBIT.STONE_DOOR, 1);
      player.sendMessage("It's nearly a perfect fit!");
      player.getPacketSender().sendSound(SOUND.SPADE, 255, 0);
      return;
    }
    if (door === 0 && itemId === ITEM.SPADE) {
      course.say(player, [{ player: TEXT.smash }]);
      return;
    }
    if (door === 0 && CHEMICALS.has(itemId)) {
      course.say(player, [{ player: TEXT.pour }]);
      return;
    }
    if (door === 1 && itemId === ITEM.CUPRIC_SULPHATE && varbit(player, VARBIT.REACT_ON_SPADE) === 0) {
      useVial(player, itemId, () => {
        player.sendMessage("You pour the vial onto the flat part of the spade.");
        setVarbit(player, VARBIT.REACT_ON_SPADE, 1);
        player.getPacketSender().sendSound(SOUND.POUR, 255, 0);
      });
      return;
    }
    if (door === 1 && itemId === ITEM.WATER && varbit(player, VARBIT.REACT_ON_SPADE) === 1) {
      useVial(player, itemId, () => {
        player.sendMessage("You pour the vial onto the flat part of the spade.");
        player.sendMessage("Something caused a reaction when mixed!");
        player.sendMessage("The spade gets hotter, and expands slightly.");
        setVarbit(player, VARBIT.STONE_DOOR, 2);
        player.getPacketSender().sendSound(SOUND.POUR, 255, 0);
      });
      return;
    }
    // Ours: no capture uses anything else on the door; the default answer.
    player.sendMessage(TEXT.nothingHappens);
  }

  function studyDoor(event) {
    if (!state(event.player) || event.objectId !== LOC.STONE_DOOR) return false;
    course.say(event.player, [{ statement: TEXT.study }]);
    return true;
  }

  function pullSpade(event) {
    const { player } = event;
    if (!state(player) || event.objectId !== LOC.STONE_DOOR) return false;
    player.sendMessage("You pull on the spade...");
    if (varbit(player, VARBIT.STONE_DOOR) !== 2) {
      // Ours: no capture pulls the spade before it expands; the default answer.
      player.sendMessage(TEXT.nothingHappens);
      return true;
    }
    course.later(player, 1, () => {
      if (!state(player)) return;
      setVarbit(player, VARBIT.STONE_DOOR, 3);
      player.sendMessage("It works as a handle, and you swing the stone door open.");
      player.getPacketSender().sendSound(SOUND.STONE_DOOR, 255, 0);
    });
    return true;
  }

  /** The opened stone door's Walk-through: two tiles across it (ticks 2256-2257, 2273-2274, 3504-3505). */
  function walkThrough(event) {
    const { player } = event;
    if (!state(player) || event.objectId !== LOC.STONE_DOOR || varbit(player, VARBIT.STONE_DOOR) !== 3) return false;
    // From the west or the tile below the door (2477,4939, tick 2273) to 2478; from 2478 back west.
    const x = player.getLocation().getX();
    const path = x <= 2477 ? [[2477, 4940], [2478, 4940]] : [[2477, 4940], [2476, 4940]];
    ids.ObstacleRunner.run({ player }, [{ walk: path }]);
    return true;
  }

  function itemOnItem(event) {
    const { player } = event;
    if (!state(player)) return;
    const pair = (a, b) => (event.usedItemId === a && event.usedWithItemId === b) || (event.usedItemId === b && event.usedWithItemId === a);
    const sender = player.getPacketSender();
    if (pair(ITEM.WATER, ITEM.TIN) && varbit(player, VARBIT.WATER_IN_TIN) === 0) {
      event.handled = useVial(player, ITEM.WATER, () => {
        setVarbit(player, VARBIT.WATER_IN_TIN, 1);
        player.sendMessage("You empty the vial into the tin.");
        player.performAnimation(new api.core.Animation(ANIM.VIAL));
        sender.sendSound(SOUND.POUR, 255, 0);
      });
      return;
    }
    if (pair(ITEM.GYPSUM, ITEM.TIN) && varbit(player, VARBIT.WATER_IN_TIN) === 1) {
      event.handled = useVial(player, ITEM.GYPSUM, () => {
        setVarbit(player, VARBIT.GYPSUM_IN_TIN, 1);
        player.sendMessage("You empty the vial into the tin.");
        player.sendMessage("You notice the tin gets quite warm as you do this.");
        player.sendMessage("A lumpy white mixture is made, that seems to be hardening.");
        setVarbit(player, VARBIT.WATER_IN_TIN, 0);
        setVarbit(player, VARBIT.GYPSUM_IN_TIN, 0);
        player.performAnimation(new api.core.Animation(ANIM.VIAL));
        replace(player, slotOf(player, ITEM.TIN), ITEM.TIN_FULL);
        sender.sendSound(SOUND.POUR, 255, 0);
      });
      return;
    }
    if (pair(ITEM.COPPER_ORE_POWDER, ITEM.KEY_MOULD) || pair(ITEM.COPPER_ORE_POWDER, ITEM.MOULD_TIN)) {
      const mould = slotOf(player, ITEM.KEY_MOULD) >= 0 ? ITEM.KEY_MOULD : ITEM.MOULD_TIN;
      event.handled = pourInto(player, ITEM.COPPER_ORE_POWDER, mould, mould === ITEM.KEY_MOULD ? ITEM.MOULD_COPPER : ITEM.MOULD_UNHEATED);
      return;
    }
    if (pair(ITEM.TIN_ORE_POWDER, ITEM.MOULD_COPPER) || pair(ITEM.TIN_ORE_POWDER, ITEM.KEY_MOULD)) {
      const mould = slotOf(player, ITEM.MOULD_COPPER) >= 0 ? ITEM.MOULD_COPPER : ITEM.KEY_MOULD;
      event.handled = pourInto(player, ITEM.TIN_ORE_POWDER, mould, mould === ITEM.MOULD_COPPER ? ITEM.MOULD_UNHEATED : ITEM.MOULD_TIN);
      return;
    }
    // The capture prises it with the chisel (2251) and the knife (2708); the wire is the Wiki's.
    if ([ITEM.KNIFE, ITEM.CHISEL, ITEM.WIRE].some((tool) => pair(tool, ITEM.MOULD_COMPLETE))) {
      replace(player, slotOf(player, ITEM.MOULD_COMPLETE), ITEM.KEY);
      give(player, ITEM.KEY_MOULD);
      course.passRoom(player, ROOM);
      player.sendMessage("You prise the duplicate key out of the tin.");
      event.handled = true;
      return;
    }
    if (pair(ITEM.MAGNET, ITEM.WIRE)) {
      player.sendMessage("The magnet sticks slightly to the wire.");
      event.handled = true;
    }
  }

  /**
   * A powder into the key's impression. Copper into the empty impression: "You pour the vial
   * into the impression of the key." (ticks 2235, 2697); tin into the copper mould: no message
   * (ticks 2241, 2702). Ours: tin first (the Wiki's order) says the copper line too.
   */
  function pourInto(player, powder, mould, product) {
    const mouldSlot = slotOf(player, mould);
    if (mouldSlot < 0) return false;
    const first = mould === ITEM.KEY_MOULD;
    return useVial(player, powder, () => {
      replace(player, mouldSlot, product);
      if (first) {
        player.sendMessage("You pour the vial into the impression of the key.");
        player.performAnimation(new api.core.Animation(ANIM.VIAL));
        player.getPacketSender().sendSound(SOUND.VIAL_EMPTY, 255, 0);
      }
    });
  }

  function keyImpression(event) {
    const { player, itemId, itemSlot } = event;
    if (!state(player) || event.objectId !== LOC.KEY) return;
    event.handled = true;
    if (itemId !== ITEM.TIN_FULL) {
      player.sendMessage(TEXT.nothingHappens);
      return;
    }
    replace(player, itemSlot, ITEM.KEY_MOULD);
    player.sendMessage("You make an impression of the key as the white mixture hardens.");
  }

  function openVial(event) {
    const { player, slot } = event;
    if (!state(player)) return false;
    replace(player, slot, ITEM.VIAL);
    player.sendMessage("You uncork the vial...");
    course.later(player, 1, () => {
      player.sendMessage("You smell a strange gas as it escapes from inside the vial.");
      player.performAnimation(new api.core.Animation(ANIM.LAUGH));
      player.forceChat("hahahahahahaha!");
    });
    return true;
  }

  function readNotes(event) {
    const { player } = event;
    course.closeChat(player);
    player.performAnimation(new api.core.Animation(ANIM.READ));
    ids.openBook(player, NOTES.title, NOTES.pages);
    return true;
  }

  /** The exit door: the key opens it. */
  function lockedDoor(player) {
    return false;
  }

  function openingDoor(player) {
    player.sendMessage("You use the duplicate key you made to unlock the door.");
  }

  course.defineRoom(ROOM, { enter, clear, lockedDoor, openingDoor });
  api.onNpcInteraction("Miss Cheevers", { "Talk-to": talk });
  api.onObjectInteraction("Old Bookshelf", { Search: searchBooks });
  api.onObjectInteraction("Crate", { Search: searchCrate });
  api.onObjectInteraction("Closed chest", { Open: openChest });
  api.onObjectInteraction("Open chest", { Search: searchChest, Close: shutChest });
  api.onObjectInteraction("Shelves", { Search: shelf });
  api.onObjectInteraction("Stone Door", { Study: studyDoor, "Pull-spade": pullSpade });
  api.onObjectInteraction("Open Door", { "Walk-through": walkThrough });
  api.onItemOnObject(burner);
  api.onItemOnObject(stoneDoorUse);
  api.onItemOnObject(keyImpression);
  api.onItemOnItem(itemOnItem);
  api.onItemAction("Nitrous oxide", { Open: openVial });
  api.onItemAction("Alchemical notes", { Read: readNotes });
  api.onGroundItemPickup(retakeSpade);

  return { ITEM, rooms };
};
