/** The Ghorrock prison route between Sucellus' cell and the asylum. */
module.exports = function registerSucellusPrison(api) {
  const { ItemIdentifiers: I, NpcIdentifiers: N } = api.core;
  const { startTranscript } = require("../QuestRuntime");
  const PAGE = "Desert Treasure II - The Fallen Empire";
  const AREA = "desert-treasure-ii:sucellus-area";
  const PROGRESS = "desert-treasure-ii:sucellus-prison-progress";
  const ENTERED = "desert-treasure-ii:sucellus-cell-entered";
  const ESCAPED = "desert-treasure-ii:sucellus-cell-escaped";
  const COMPLETE = "desert-treasure-ii:sucellus-prison-complete";
  const CREVICE_CLEARED = "desert-treasure-ii:sucellus-prison-crevice-cleared";
  const BLOCKED_CREVICE_ID = 49110;
  const CLEARED_CREVICE_ID = 49109;
  const BLOCKAGE_VARBIT = 15178;
  const SLIDER_INSPECTED = "desert-treasure-ii:sucellus-prison-slider-inspected";
  const RATION_CRATE_ID = 49141; // dt2_ghorrock_ration_crate_op
  const RATION_LIMIT = 12;
  const GEAR_RETURNED = "desert-treasure-ii:sucellus-prison-gear-returned";
  const FIREWORKS = "desert-treasure-ii:sucellus-prison-fireworks";
  const DEFENCE_START = "desert-treasure-ii:sucellus-prison-defence-start";
  const PURSUER = "desert-treasure-ii:sucellus-prison-jhallan-pursuer";
  const PURSUER_DISMISSED = "desert-treasure-ii:sucellus-prison-jhallan-pursuer-dismissed";
  const LOCKPICK = I.LOCKPICK_4;
  const KEYS = { sapphire: I.SAPPHIRE_KEY_3, emerald: I.EMERALD_KEY_3, ruby: I.RUBY_KEY_3, diamond: I.DIAMOND_KEY };
  const ANSWERS = { sapphire: "214013", emerald: "LIES", ruby: "URLDRU", diamond: "WRATH" };
  const SHADOWS_AT = 150;
  const SHADOW_CUE_TICKS = [35, 80, 125, 170, 215, 260];
  const SHADOW_STRIKE_DELAY = 4;
  const SHADOW_WARNING_GRAPHIC = 1447;
  const SHADOW_IMPACT_GRAPHIC = 1103;
  const RUBY_CLUE_CHESTS = [[2959, 6414], [2959, 6419], [2962, 6414], [2962, 6419], [2965, 6414], [2965, 6419], [2968, 6419]];
  const RUBY_NAMES = ["Vedius", "Grazon", "Phalina", "Marcus", "Nithrak", "Baelys", "Atreus"];
  const SAFE_ROOMS = [
    [2900, 2912, 6439, 6450], // enclosed north-west room containing the Emerald chests
    [2957, 2971, 6413, 6421], // the seven-bed room, west of its eastern gate
    [2887, 2898, 6372, 6382], // the western cells around the Diamond chest
    [2962, 2985, 6366, 6383], // enclosed refugee camp between its north and south gates
    [2956, 2964, 6424, 6432], // small room containing the blocked crevice
    [2965, 2970, 6423, 6436], // chamber west of its gate at 2971,6428
    [2927, 2936, 6427, 6438], // library
    [2914, 2919, 6425, 6434], // enclosed records office containing a ration crate
  ];
  const LIBRARY_SHELVES = [[2931, 6430], [2931, 6432], [2932, 6430]];
  const LIBRARY_BOOKS = ["Innocence", "Longing", "Harmonious"];
  const CODE_CHEST = {
    "2980,6346,2": ["sapphire", 24],
    "2902,6445,2": ["emerald", 28],
    "2968,6414,2": ["ruby", 34],
    "2890,6375,2": ["diamond", 38],
  };
  const TILES = {
    padlock: [2945, 6389, 2], altar: [2974, 6347, 2], sapphire: [2980, 6346, 2],
    emerald: [2902, 6445, 2], ruby: [2968, 6414, 2], diamond: [2890, 6375, 2],
    diamondGate: [2903, 6375, 2], crevice: [2965, 6427, 2], blockage: [2960, 6427, 2], gear: [2899, 6376, 2], fireworks: [2972, 6367, 2],
    asylum: [2973, 6440, 2],
  };
  const KEY_GATES = {
    49122: { key: "sapphire", from: 26, until: 30, to: 28, tiles: [[2912, 6418], [2954, 6406], [2975, 6373]] },
    49124: { key: "emerald", from: 30, until: 36, to: 30, tiles: [[2903, 6361], [2940, 6367], [2972, 6418]] },
    49126: { key: "ruby", from: 36, until: 40, to: 38, tiles: [[2900, 6354], [2897, 6395], [2926, 6433], [2968, 6384]] },
    49128: { key: "diamond", from: 46, until: 50, to: 48, tiles: [[2903, 6375]] },
  };
  const activePrompts = new WeakMap();
  const defences = new WeakMap();
  const rationCrates = new WeakMap();
  const CLUES_READ = "desert-treasure-ii:sucellus-prison-clues-read";

  api.persistAttribute?.(PROGRESS);
  api.persistAttribute?.(COMPLETE);
  api.persistAttribute?.(GEAR_RETURNED);
  api.persistAttribute?.(FIREWORKS);
  api.persistAttribute?.(DEFENCE_START);
  api.persistAttribute?.(CLUES_READ);
  api.persistAttribute?.("desert-treasure-ii:sucellus-prison-ruby-chests");
  api.persistAttribute?.("desert-treasure-ii:sucellus-prison-library-books");
  api.persistAttribute?.(CREVICE_CLEARED);
  api.persistAttribute?.(SLIDER_INSPECTED);

  const state = (player) => Number(player?.getAttribute(PROGRESS)) || 0;
  const setState = (player, value) => {
    player.setAttribute(PROGRESS, value);
    api.emitCustomEvent("dt2:sucellus-prison-journal", { player, lines: journal(value) });
  };
  const has = (player, id) => player.getInventory().getAmount(id) > 0;
  const atArea = (player, area) => Boolean(area && player.getAttribute(AREA) === area && player.getPrivateArea?.() === area);
  const areaLocation = (area, x, y, z) => area.tile(x - 2872, y - 6336, z);
  const worldTile = (player, area) => {
    const p = player.getLocation();
    return [p.getX() - area.getBaseX() + 2872, p.getY() - area.getBaseY() + 6336, p.getZ?.() ?? p.z ?? 0];
  };
  const eventTile = (event, area) => {
    const p = event.location ?? event.object?.getLocation?.();
    if (!p) return null;
    const x = Number(p.getX?.() ?? p.x);
    const y = Number(p.getY?.() ?? p.y);
    const z = Number(p.getZ?.() ?? p.z ?? 0);
    return [x - area.getBaseX() + 2872, y - area.getBaseY() + 6336, z];
  };
  const isTile = (tile, expected) => tile && tile[0] === expected[0] && tile[1] === expected[1] && tile[2] === expected[2];
  const journal = (value) => {
    if (value < 24) return ["Open the padlocked prison gate with the lockpick."];
    if (value < 26) return ["Search the altar room and solve the sapphire chest lock."];
    if (value < 30) return ["Use the sapphire key to reach the north-west chest and solve its lock."];
    if (value < 34) return ["Clear the crevice, enter the beds room and solve the ruby chest lock."];
    if (value < 40) return ["Use the ruby key on the western gate and solve the diamond chest lock."];
    if (value < 46) return ["Talk to the Assassin about the diamond key."];
    if (value < 50) return ["Open the nearby equipment chest to recover your belongings."];
    if (value < 52) return ["Talk to the Assassin again after reclaiming your equipment."];
    if (value < 54) return ["Search the firecracker pack in the refugee camp and prepare for Jhallan."];
    if (value < 56) return ["Survive Jhallan's attack until the Assassin arrives."];
    if (value < 58) return ["Speak to the Assassin after Jhallan is frozen."];
    return ["Enter the asylum through the northern gate."];
  };

  function objectId(event) {
    return event.definition?.id ?? api.core.ObjectDefinition?.forPlayer?.(event.objectId, event.player)?.id ?? event.objectId;
  }

  function openPrivateGate(event) {
    const object = event.object;
    const player = event.player;
    const area = player?.getAttribute(AREA);
    const objectArea = object?.getPrivateArea?.();
    // A copied cache loc in a TemplatedInstanceArea can have no owner field;
    // the interaction itself is already scoped to the player's private area.
    if (!object || !atArea(player, area) || (objectArea && objectArea !== area)) return false;
    api.core.ObjectManager?.deregister?.(object, true);
    return true;
  }

  function clearCrevice(player, area, event) {
    if (state(player) !== 30 || !atArea(player, area) || player.getAttribute(CREVICE_CLEARED)) return;
    player.setAttribute(CREVICE_CLEARED, true);
    player.getPacketSender().sendVarbit(BLOCKAGE_VARBIT, 1);
    setState(player, 32);
    player.sendMessage("You shift the loose stone and clear a way through the crevice.");
  }

  function promptPadlock(player, index = 0, values = [0, 0, 0, 0, 0, 0], fixed = 0, page = 0) {
    if (index >= 6) {
      const correct = values.reduce((mask, value, i) => value === [2, 0, 5, 1, 4, 3][i] ? mask | (1 << i) : mask, 0);
      if (correct === 63) {
        const area = player.getAttribute(AREA);
        const gateLocation = areaLocation(area, ...TILES.padlock);
        const gate = [...(area.getObjects?.() ?? []), ...(area.getTemplateObjects?.(gateLocation) ?? [])]
          .find((object) => object.getId() === 49120 && object.getLocation().equals(gateLocation));
        if (gate) api.core.ObjectManager?.deregister?.(gate, true);
        setState(player, Math.max(24, state(player)));
        player.sendMessage("The six tumblers align and the padlock clicks open.");
        return;
      }
      player.sendMessage(`${correct.toString(2).replaceAll("0", "").length} tumbler${correct === 1 ? " is" : "s are"} correctly set; keep those in place.`);
      return promptPadlock(player, 0, values.map((value, i) => correct & (1 << i) ? value : 0), correct);
    }
    const pairs = [];
    const heights = Array.from({ length: 6 }, (_, height) => height).slice(page * 4, page * 4 + 4);
    for (const height of heights) pairs.push(`Set to ${height + 1}`, () => {
      if (fixed & (1 << index)) return promptPadlock(player, index + 1, values, fixed);
      const next = [...values];
      next[index] = height;
      promptPadlock(player, index + 1, next, fixed);
    });
    if (page === 0) pairs.push("More options", () => promptPadlock(player, index, values, fixed, 1));
    else pairs.push("Back", () => promptPadlock(player, index, values, fixed, 0));
    api.sendMultiChatboxPrompt(player, `Pick the prison lock: tumbler ${index + 1} of 6`, ...pairs);
  }

  function handlePrisonItemOnObject(event) {
    const { player, itemId, objectId: rawObjectId, location } = event;
    const area = player?.getAttribute(AREA);
    if (!player?.getAttribute(ESCAPED) || !atArea(player, area)) return false;
    const id = api.core.ObjectDefinition?.forPlayer?.(rawObjectId, player)?.id ?? rawObjectId;
    const tile = location ? [Number(location.x) - area.getBaseX() + 2872, Number(location.y) - area.getBaseY() + 6336, Number(location.z)] : eventTile(event, area);
    if (id === 49120 && isTile(tile, TILES.padlock) && itemId === LOCKPICK) {
      event.handled = true;
      if (state(player) < 22) return;
      promptPadlock(player);
      return true;
    }
    const gateProgress = KEY_GATES[id];
    // Reopened prison instances restore native gates after login. A key already
    // earned at its minimum stage remains valid for that same gate thereafter.
    const validGateProgress = gateProgress && state(player) >= gateProgress.from;
    if (gateProgress && gateProgress.tiles.some(([x, y]) => x === tile?.[0] && y === tile?.[1] && tile?.[2] === 2)
      && itemId === KEYS[gateProgress.key] && validGateProgress) {
      event.handled = true;
      openPrivateGate(event);
      setState(player, Math.max(state(player), gateProgress.to));
      player.sendMessage("The key turns and the prison gate opens.");
      return true;
    }
    return false;
  }

  function promptCode(player, key, index = 0, prefix = "", offset = 0) {
    const answer = ANSWERS[key];
    const letters = key === "ruby" ? ["U", "R", "D", "L"] : key === "emerald" || key === "diamond" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") : "0123456789".split("");
    const current = answer[index];
    const groupSize = 4;
    const start = offset % Math.max(1, Math.ceil(letters.length / groupSize)) * groupSize;
    const choices = letters.slice(start, start + groupSize);
    if (!choices.includes(current)) choices.push(current);
    const distinct = [...new Set(choices)].slice(0, 4);
    const pairs = [];
    for (const choice of distinct) pairs.push(choice, () => {
      if (choice !== current) {
        player.sendMessage("The tumbler clicks into the wrong position. The lock resets.");
        activePrompts.delete(player);
        return;
      }
      if (index + 1 === answer.length) {
        activePrompts.delete(player);
        unlockChest(player, key);
      } else promptCode(player, key, index + 1, prefix + choice, 0);
    });
    pairs.push("More options", () => promptCode(player, key, index, prefix, (offset + 1) % Math.ceil(letters.length / groupSize)));
    activePrompts.set(player, { key, index, prefix });
    api.sendMultiChatboxPrompt(player, `Choose tumbler ${index + 1} (${prefix || "start"})`, ...pairs);
  }

  function unlockChest(player, key) {
    const current = state(player);
    const needed = key === "sapphire" ? 24 : key === "emerald" ? 28 : key === "ruby" ? 34 : 38;
    if (current !== needed) return;
    const clueBit = { sapphire: 1, emerald: 2, ruby: 4, diamond: 8 }[key];
    const clueRead = Number(player.getAttribute(CLUES_READ)) || 0;
    const rubyChests = Number(player.getAttribute("desert-treasure-ii:sucellus-prison-ruby-chests")) || 0;
    const libraryBooks = Number(player.getAttribute("desert-treasure-ii:sucellus-prison-library-books")) || 0;
    if (!(clueRead & clueBit)
      || (key === "emerald" && (clueRead & 18) !== 18)
      || (key === "ruby" && ((!has(player, I.MAGIC_LANTERN)
        && !(player.getEquipment?.()?.getAmount?.(I.MAGIC_LANTERN) > 0)) || rubyChests !== 127))
      || (key === "diamond" && (!has(player, I.STRANGE_SLIDER) || !player.getAttribute(SLIDER_INSPECTED) || libraryBooks !== 7))) {
      player.sendMessage("You need to find and read the clue for this lock first.");
      return;
    }
    if (!player.getInventory().adds(KEYS[key], 1)) {
      player.sendMessage("You need an empty inventory slot to take the key.");
      return;
    }
    const next = key === "sapphire" ? 26 : key === "emerald" ? 30 : key === "ruby" ? 36 : 40;
    setState(player, next);
    if (key === "diamond") spawnAssassin(player, player.getAttribute(AREA));
    player.sendMessage(`The lock opens. You take the ${key} key.`);
  }

  function spawnAssassin(player, area, x, y) {
    const progress = state(player);
    const destination = progress === 56 ? [2978, 6371] : progress >= 50 ? [2903, 6383] : [2920, 6375];
    x ??= destination[0];
    y ??= destination[1];
    const current = player.getAttribute("desert-treasure-ii:sucellus-prison-assassin");
    if (current && area.entities.includes(current)) {
      current.moveTo(areaLocation(area, x, y, 2));
      return current;
    }
    // The parent quest places the Assassin as the cell escape cutscene ends.
    // Reuse that owner-visible NPC rather than layering a second identical one
    // when the prison module receives its start/resume event.
    const target = areaLocation(area, x, y, 2);
    const existing = area.entities.find(npc => npc.getId?.() === N.ASSASSIN_7);
    if (existing) {
      existing.moveTo(target);
      player.setAttribute("desert-treasure-ii:sucellus-prison-assassin", existing);
      return existing;
    }
    const npc = api.core.NPC.create(N.ASSASSIN_7, areaLocation(area, x, y, 2));
    npc.setOwner?.(player);
    npc.setOwnerOnly?.(true);
    npc.__skipDefaultRespawn = true;
    area.add(npc);
    api.core.World.getAddNPCQueue().push(npc);
    player.setAttribute("desert-treasure-ii:sucellus-prison-assassin", npc);
    return npc;
  }

  function removeOwnedNpc(area, npc) {
    if (!npc) return;
    const add = api.core.World.getAddNPCQueue();
    for (let i = add.indexOf(npc); i >= 0; i = add.indexOf(npc)) add.splice(i, 1);
    if (npc.isRegistered?.() && !api.core.World.getRemoveNPCQueue().includes(npc)) api.core.World.getRemoveNPCQueue().push(npc);
    area.remove?.(npc);
  }

  function spawnJhallan(area, player, id, x, y, hitpoints) {
    const npc = api.core.NPC.create(id, areaLocation(area, x, y, 2));
    if (hitpoints) {
      npc.setMaxHitpoints?.(hitpoints);
      npc.setHitpoints?.(hitpoints);
    }
    npc.setOwner?.(player);
    npc.setOwnerOnly?.(true);
    npc.setScriptedMovement?.(false);
    npc.__skipDefaultRespawn = true;
    area.add(npc);
    api.core.World.getAddNPCQueue().push(npc);
    return npc;
  }

  function isPrisonSafeRoom(x, y, z) {
    return z === 2 && SAFE_ROOMS.some(([minX, maxX, minY, maxY]) =>
      x >= minX && x <= maxX && y >= minY && y <= maxY);
  }

  function clearPursuer(player, area) {
    removeOwnedNpc(area, player.getAttribute(PURSUER));
    player.setAttribute(PURSUER, null);
  }

  function processJhallanPursuit(player, area, progress, x, y, z) {
    const current = player.getAttribute(PURSUER);
    if (progress < 30 || progress >= 52) {
      if (current) clearPursuer(player, area);
      player.setAttribute(PURSUER_DISMISSED, false);
      return;
    }
    if (isPrisonSafeRoom(x, y, z)) {
      if (current) clearPursuer(player, area);
      player.setAttribute(PURSUER_DISMISSED, false);
      return;
    }
    if (current && area.entities.includes(current) && (current.getHitpoints?.() ?? 1) > 0) return;
    if (current) {
      clearPursuer(player, area);
      player.setAttribute(PURSUER_DISMISSED, true);
    }
    if (player.getAttribute(PURSUER_DISMISSED)) return;

    // Wiki's 1,500-HP Jhallan uses the cache-backed four-tick magic attack.
    // Keep it in the owner's copied prison; entering a room breaks pursuit.
    const npc = spawnJhallan(area, player, N.JHALLAN_3, x, y, 1500);
    player.setAttribute(PURSUER, npc);
    npc.getCombat?.().attack?.(player);
  }

  function handlePrisonBeforeDeath(event) {
    const player = event?.player;
    const area = player?.getAttribute(AREA);
    const progress = player && state(player);
    if (!player?.getAttribute(ESCAPED) || !atArea(player, area) || progress < 30 || progress >= 58) return;
    // Wiki: Jhallan's victim wakes in the emerald-key room, retaining prison progress.
    event.preventDeath = true;
    clearPursuer(player, area);
    const defence = defences.get(player);
    removeOwnedNpc(area, player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan"));
    for (const clone of defence?.clones ?? []) removeOwnedNpc(area, clone);
    defences.delete(player);
    player.setAttribute("desert-treasure-ii:sucellus-prison-jhallan", null);
    player.setAttribute(PURSUER_DISMISSED, false);
    if (progress === 54) {
      player.setAttribute(DEFENCE_START, null);
      player.setAttribute(FIREWORKS, false);
      setState(player, 52);
    }
    player.getCombat()?.getHitQueue?.().clear?.();
    player.getCombat()?.reset?.();
    player.getMovementQueue?.().reset?.();
    player.setHitpoints(player.getSkillManager().getMaxLevel(api.core.Skill.HITPOINTS));
    player.moveTo(areaLocation(area, 2907, 6444, 2));
    player.sendMessage("Jhallan overpowers you. You wake in the room where you found the emerald key, with your belongings intact.");
  }

  function handlePrisonAssassinInteraction(event) {
    const { player, npcId } = event;
    const progress = state(player);
    if (!player?.getAttribute(ESCAPED) || ![N.ASSASSIN_7, N.ASSASSIN_8].includes(npcId)) return false;
    const area = player.getAttribute(AREA);
    if (!atArea(player, area)) return false;
    event.handled = true;
    if (progress >= 40 && progress < 46 && has(player, KEYS.diamond)) {
      startTranscript(api, player, npcId, PAGE, "duke-sucellus-of-the-sixth-legion-talking-to-the-assassin-after-getting-the-diamond-key");
    } else if (progress >= 50 && progress < 52) {
      startTranscript(api, player, npcId, PAGE, "duke-sucellus-of-the-sixth-legion-talking-to-the-assassin-after-getting-your-items-back");
    } else if (progress >= 56 && progress < 58) {
      startTranscript(api, player, npcId, PAGE, "duke-sucellus-of-the-sixth-legion-talking-to-the-assassin-after-jhallan-is-frozen");
    } else if (progress >= 22 && progress < 24) {
      startTranscript(api, player, npcId, PAGE, "duke-sucellus-of-the-sixth-legion-talking-to-the-assassin-again-before-getting-your-items-back");
    } else player.sendMessage("The Assassin is busy studying the prison's way to the asylum.");
    return true;
  }

  function handlePrisonDialogueAction(event) {
    const { player, stepId, npcId } = event;
    const area = player?.getAttribute(AREA);
    if (!player?.getAttribute(ESCAPED) || !atArea(player, area) || ![N.ASSASSIN_7, N.ASSASSIN_8].includes(npcId)) return false;
    if (stepId === "FyTltG" && state(player) === 50) {
      setState(player, 52);
      removeOwnedNpc(player.getAttribute(AREA), player.getAttribute("desert-treasure-ii:sucellus-prison-assassin"));
      player.setAttribute("desert-treasure-ii:sucellus-prison-assassin", null);
      return true;
    }
    if (stepId === "IME-83" && state(player) === 56) {
      setState(player, 58);
      player.setAttribute(COMPLETE, true);
      api.emitCustomEvent("dt2:sucellus-prison-complete", { player });
      removeOwnedNpc(player.getAttribute(AREA), player.getAttribute("desert-treasure-ii:sucellus-prison-assassin"));
      player.setAttribute("desert-treasure-ii:sucellus-prison-assassin", null);
      return true;
    }
    return false;
  }

  function handlePrisonObject(event) {
    const { player } = event;
    const area = player?.getAttribute(AREA);
    if (!player?.getAttribute(ESCAPED) || !atArea(player, area)) return false;
    const progress = state(player);
    const tile = eventTile(event, area);
    const id = objectId(event);
    const option = String(event.option ?? "").toLowerCase();
    const onTile = (key) => isTile(tile, TILES[key]);

    if (id === RATION_CRATE_ID && option === "search" && progress >= 22 && progress < 50 && tile?.[2] === 2) {
      event.handled = true;
      const inventory = player.getInventory();
      if (inventory.getAmount(I.RATIONS) >= RATION_LIMIT) return player.sendMessage("You cannot carry more than twelve rations.");
      const key = tile.join(",");
      const crates = rationCrates.get(player) ?? new Map();
      const now = api.core.World.getProcessCycle();
      if ((crates.get(key) ?? -1) > now) return player.sendMessage("The crate is empty for now.");
      if (inventory.getFreeSlots?.() === 0 || !inventory.adds(I.RATIONS, 1)) return player.sendMessage("You need space for the rations.");
      // shortcut: Wiki confirms replenishing crates but not their cadence; calibrate against a capture.
      crates.set(key, now + 100);
      rationCrates.set(player, crates);
      player.sendMessage("You take some rations from the crate.");
      return true;
    }

    // Most prison gates are ordinary doors. The base server does not provide a
    // generic Open handler for this cache object, so remove only this exact
    // private-instance door and let the cache handle its collision elsewhere.
    const asylumGate = id === 49130 && isTile(tile, [2974, 6435, 2]);
    if ((id === 49118 || asylumGate || (id === 49120 && !onTile("padlock"))) && option === "open") {
      event.handled = true;
      openPrivateGate(event);
      return true;
    }

    if (id === 49120 && onTile("padlock") && (option === "unlock" || option === "open" || option === "pick")) {
      if (progress >= 24) {
        event.handled = true;
        openPrivateGate(event);
        return true;
      }
      event.handled = true;
      if (progress < 22 || !has(player, LOCKPICK)) return player.sendMessage("The Assassin's lockpick should open this gate.");
      promptPadlock(player);
      return;
    }

    const gate = KEY_GATES[id];
    if (gate && (option === "open" || option === "unlock" || option === "pass")) {
      if (!gate.tiles.some(([x, y]) => x === tile?.[0] && y === tile?.[1] && tile?.[2] === 2)) return false;
      const validProgress = progress >= gate.from;
      if (!validProgress || !has(player, KEYS[gate.key])) {
        event.handled = true;
        player.sendMessage(`This gate requires the ${gate.key} key.`);
        return;
      }
      event.handled = true;
      openPrivateGate(event);
      setState(player, Math.max(progress, gate.to));
      player.sendMessage("The key turns and the prison gate opens.");
      return;
    }

    const chest = CODE_CHEST[tile?.join(",")];
    if (chest && (option === "open" || option === "unlock" || option === "search" || option === "attempt to open")) {
      const [key, required] = chest;
      if (progress < required || has(player, KEYS[key])) return;
      event.handled = true;
      promptCode(player, key);
      return;
    }

    if (onTile("altar") && option === "search" && progress === 24) {
      event.handled = true;
      player.sendMessage("You search the altar and find a warning note about the prison's locks.");
      if (!has(player, I.WARNING_LETTER)) player.getInventory().adds(I.WARNING_LETTER, 1);
      return;
    }

    const objectName = String(event.definition?.name ?? "").toLowerCase();
    if (objectName.includes("crate") && progress === 28 && tile?.[0] === 2912 && tile?.[1] === 6450) {
      if (!has(player, I.REQUISITION_NOTE)) {
        event.handled = true;
        player.getInventory().adds(I.REQUISITION_NOTE, 1);
        player.getInventory().adds(I.GRID_NOTE, 1);
        player.sendMessage("You find a requisition note among the prison records.");
        return;
      }
    }

    if (progress === 34 && objectName.includes("chest")) {
      const chestIndex = RUBY_CLUE_CHESTS.findIndex(([x, y]) => x === tile?.[0] && y === tile?.[1]);
      if (chestIndex >= 0) {
        event.handled = true;
        const bit = 1 << chestIndex;
        const opened = Number(player.getAttribute("desert-treasure-ii:sucellus-prison-ruby-chests")) || 0;
        player.setAttribute("desert-treasure-ii:sucellus-prison-ruby-chests", opened | bit);
        player.sendMessage(`This chest is marked with the name ${RUBY_NAMES[chestIndex]}.`);
        return;
      }
    }

    if (progress === 34 && objectName.includes("crate") && tile?.[0] >= 2967 && tile?.[0] <= 2971 && tile?.[1] >= 6414 && tile?.[1] <= 6418) {
      event.handled = true;
      if (!has(player, I.CODE_CONVERTER)) player.getInventory().adds(I.CODE_CONVERTER, 1);
      if (!has(player, I.MAGIC_LANTERN)) player.getInventory().adds(I.MAGIC_LANTERN, 1);
      player.sendMessage("You take the code converter and magic lantern from the crate.");
      return;
    }

    if (progress >= 36 && progress < 40 && objectName.includes("bed") && tile?.[0] === 2889 && tile?.[1] === 6373) {
      event.handled = true;
      if (!has(player, I.LIBRARY_NOTE)) player.getInventory().adds(I.LIBRARY_NOTE, 1);
      if (!has(player, I.STRANGE_SLIDER)) player.getInventory().adds(I.STRANGE_SLIDER, 1);
      player.sendMessage("You find a library note and a strange slider beneath the bed.");
      return;
    }

    if ((objectName.includes("bookcase") || objectName === "books") && progress >= 36 && progress < 40) {
      const shelfIndex = LIBRARY_SHELVES.findIndex(([x, y]) => x === tile?.[0] && y === tile?.[1]);
      if (shelfIndex >= 0) {
        event.handled = true;
        const mask = Number(player.getAttribute("desert-treasure-ii:sucellus-prison-library-books")) || 0;
        player.setAttribute("desert-treasure-ii:sucellus-prison-library-books", mask | (1 << shelfIndex));
        player.sendMessage(`You find Duke Quirinius's book ${LIBRARY_BOOKS[shelfIndex]}.`);
        return;
      }
    }

    if (id === BLOCKED_CREVICE_ID && onTile("blockage") && option === "unblock" && progress === 30 && !player.getAttribute(CREVICE_CLEARED)) {
      event.handled = true;
      api.sendMultiChatboxPrompt(player, "The blockage is loose enough to shift. Clear the crevice?", "Yes", () => clearCrevice(player, area, event), "No", () => {});
      return true;
    }

    if (((id === CLEARED_CREVICE_ID && onTile("blockage")) || (id === 49106 && onTile("crevice")))
      && option === "enter" && progress >= 32 && progress < 40 && player.getAttribute(CREVICE_CLEARED)) {
      event.handled = true;
      // Adjacent landing floors are cache-checked; the exact crossing cutscene is inferred.
      player.moveTo(areaLocation(area, ...(id === CLEARED_CREVICE_ID ? [2966, 6428, 2] : [2959, 6428, 2])));
      player.sendMessage("You squeeze through the cleared crevice.");
      return true;
    }

    if (onTile("gear") && (option === "search" || option === "open") && progress >= 46 && progress < 50) {
      event.handled = true;
      if (!has(player, KEYS.diamond)) return player.sendMessage("The equipment chest is still locked.");
      if (!player.getAttribute(GEAR_RETURNED)) {
        const request = { player, restored: false };
        api.emitCustomEvent("dt2:sucellus-prison-return-stash", request);
        if (request.restored !== true) return;
        player.setAttribute(GEAR_RETURNED, true);
      }
      setState(player, 50);
      player.sendMessage("You search the chest and recover your belongings.");
      spawnAssassin(player, area, 2903, 6383);
      return;
    }

    if (onTile("fireworks") && (option === "search" || option === "light") && progress === 52) {
      event.handled = true;
      if (option === "search") {
        api.sendMultiChatboxPrompt(player, "Light the firecrackers?", "Yes", () => startDefence(player, area), "No", () => {});
      } else startDefence(player, area);
      return;
    }

    // These two cache crevices are opposite ends of the beds-wing shortcut.
    // Land beside each 1x3 loc, not on its blocked footprint.
    if (((id === 49108 && isTile(tile, [2983, 6399, 2]))
        || (id === 49107 && isTile(tile, [2898, 6360, 2])))
      && option === "enter" && progress >= 30 && progress < 40) {
      event.handled = true;
      const destination = id === 49108 ? [2899, 6361, 2] : [2984, 6400, 2];
      player.moveTo(areaLocation(area, ...destination));
      player.sendMessage("You squeeze through the crevice to the other side of the prison.");
      return true;
    }

    if (id === 49100 && isTile(tile, TILES.asylum) && option === "climb") {
      if (progress < 58 || !player.getAttribute(COMPLETE)) {
        event.handled = true;
        player.sendMessage("Jhallan still blocks the way to the asylum.");
        return true;
      }
      event.handled = true;
      advanceToAsylum(player);
      // The Duke's chamber is part of this same copied map. Land on its clear
      // south approach so the cache gate can be entered without leaving the
      // owner's prison instance.
      player.moveTo(areaLocation(area, 3039, 6431, 0));
      player.sendMessage("You leave the prison and enter the Duke's asylum.");
      return true;
    }
  }

  // rsprox 1703: dt2_ghorrock 58 -> 60 on the asylum entry (49100).
  function advanceToAsylum(player) {
    if (state(player) === 58) setState(player, 60);
  }

  function handlePrisonStairs(request) {
    const { player, object } = request ?? {};
    const area = player?.getAttribute(AREA);
    if (!player?.getAttribute(ESCAPED) || !atArea(player, area)
      || state(player) < 58 || !player.getAttribute(COMPLETE)) return false;
    const id = request.objectId ?? objectId({ objectId: object?.getId?.(), player });
    const tile = eventTile({ object }, area);
    if (id !== 49100 || !isTile(tile, TILES.asylum)) return false;
    request.handled = true;
    advanceToAsylum(player);
    api.emitCustomEvent("ladders:climbDown", {
      player,
      destination: areaLocation(area, 3039, 6431, 0),
    });
    return true;
  }

  function startDefence(player, area) {
    if (state(player) !== 52 || player.getAttribute(FIREWORKS)) return;
    clearPursuer(player, area);
    player.setAttribute(PURSUER_DISMISSED, false);
    player.setAttribute(FIREWORKS, true);
    player.setAttribute(DEFENCE_START, null);
    setState(player, 54);
    api.emitCustomEvent("dt2:sucellus-prison-journal", { player, lines: ["Survive Jhallan's assault until the Assassin freezes him.", "Protect from Magic and keep moving around the pillar."] });
    // Cache 12353 is the live, 1,500 HP, 30-max-hit, four-tick magic attacker.
    // Its ordinary combat path applies Protect from Magic; 12355 is dialogue-only.
    const jhallan = spawnJhallan(area, player, N.JHALLAN_3, 2975, 6362, 1500);
    jhallan.setHitpointsLocked?.(true);
    defences.set(player, { clones: [], shadowsSpawned: false, cueIndex: 0, pendingShadow: null });
    player.setAttribute("desert-treasure-ii:sucellus-prison-jhallan", jhallan);
    startTranscript(api, player, N.JHALLAN_5, PAGE, "duke-sucellus-of-the-sixth-legion-getting-ambushed-by-jhallan-after-setting-off-the-fireworks");
  }

  function handleProcess(event) {
    const { player, area, cycle } = event ?? {};
    if (!player || !atArea(player, area)) return false;
    const progress = state(player);
    const [x, y, z] = worldTile(player, area);
    processJhallanPursuit(player, area, progress, x, y, z);
    if (state(player) === 32) {
      if (player.getAttribute(CREVICE_CLEARED) && x >= 2957 && x <= 2970 && y >= 6413 && y <= 6420) setState(player, 34);
      return true;
    }
    if (state(player) !== 54) return false;
    const storedStart = player.getAttribute(DEFENCE_START);
    let started = Number(storedStart);
    if (storedStart == null || !Number.isFinite(started)) {
      if (player.getDialogueManager?.().isActive?.()) return false;
      started = cycle;
      player.setAttribute(DEFENCE_START, started);
      player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan")?.getCombat?.().attack?.(player);
    }
    const jhallan = player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan");
    const defence = defences.get(player) ?? { clones: [], shadowsSpawned: false, cueIndex: 0, pendingShadow: null };
    const elapsed = cycle - started;
    processShadowAttack(player, area, defence, elapsed, cycle, jhallan);
    // The Wiki describes Jhallan's shadow copies as one-hit enemies appearing
    // part-way through the three-minute defence. Cache 12354 is the matching
    // attackable Jhallan copy; its normal attack remains a magic attack.
    if (elapsed >= SHADOWS_AT && !defence.shadowsSpawned) {
      defence.shadowsSpawned = true;
      const clones = [
        spawnJhallan(area, player, N.JHALLAN_4, 2973, 6363, 1),
        spawnJhallan(area, player, N.JHALLAN_4, 2977, 6363, 1),
      ];
      for (const clone of clones) clone.getCombat?.().attack?.(player);
      defence.clones.push(...clones);
      defences.set(player, defence);
      player.sendMessage("Shadow copies of Jhallan converge on the camp.");
    }
    if (elapsed < 300) return true;
    removeOwnedNpc(area, jhallan);
    for (const clone of defence.clones) removeOwnedNpc(area, clone);
    defences.delete(player);
    player.setAttribute("desert-treasure-ii:sucellus-prison-jhallan", null);
    player.setAttribute("desert-treasure-ii:sucellus-prison-assassin", null);
    spawnAssassin(player, area, 2978, 6371);
    setState(player, 56);
    player.sendMessage("The Assassin strikes and freezes Jhallan in place.");
    startTranscript(api, player, N.ASSASSIN_7, PAGE, "duke-sucellus-of-the-sixth-legion-talking-to-the-assassin-after-jhallan-is-frozen");
    return true;
  }

  function processShadowAttack(player, area, defence, elapsed, cycle, jhallan) {
    if (defence.pendingShadow && cycle >= defence.pendingShadow.impactAt) {
      const marked = defence.pendingShadow.tile;
      defence.pendingShadow = null;
      const location = player.getLocation();
      if (location.getX() === marked.x && location.getY() === marked.y && (location.getZ?.() ?? location.z ?? 0) === marked.z) {
        player.getPacketSender().sendGraphic(new api.core.Graphic(SHADOW_IMPACT_GRAPHIC), new api.core.Location(marked.x, marked.y, marked.z));
        // The marked tile is a dodge. The ordinary Jhallan and copy attacks
        // still use the cache combat path and Protect from Magic.
        // The Wiki gives no exact shadow damage value; keep the unavoidable
        // hit modest and telegraphed while preserving the move-away response.
        player.getCombat().getHitQueue().addPendingDamage([
          new api.core.HitDamage(12 + Math.floor(Math.random() * 13), api.core.HitMask.RED),
        ]);
      }
    }
    if (defence.pendingShadow || elapsed < SHADOW_CUE_TICKS[defence.cueIndex] || elapsed >= 300) return;

    // The Wiki describes these as occasional attacks but gives no exact tick
    // cadence. The six spaced cues are a readable, bounded approximation.
    const destination = jhallanShadowTile(area, jhallan);
    if (destination) {
      player.moveTo(destination);
      api.core.CombatFactory.freeze(player, 1.2, "Jhallan's magic freezes you as the shadows gather!");
    }
    const location = player.getLocation();
    const tile = { x: location.getX(), y: location.getY(), z: location.getZ?.() ?? location.z ?? 0 };
    player.getPacketSender().sendGraphic(new api.core.Graphic(SHADOW_WARNING_GRAPHIC), new api.core.Location(tile.x, tile.y, tile.z));
    player.sendMessage("Shadows converge on your position. Move away!");
    defence.pendingShadow = { tile, impactAt: cycle + SHADOW_STRIKE_DELAY };
    defence.cueIndex++;
  }

  function jhallanShadowTile(area, jhallan) {
    const location = jhallan?.getLocation?.();
    if (!location) return null;
    const x = location.getX(), y = location.getY(), z = location.getZ?.() ?? 2;
    const candidates = [
      [x + 2, y], [x - 1, y], [x, y + 2], [x, y - 1],
      [x + 2, y + 1], [x - 1, y + 1], [x, y + 2], [x + 1, y - 1],
    ];
    for (const [tileX, tileY] of candidates) {
      const tile = new api.core.Location(tileX, tileY, z);
      if (!area.contains?.(tile) || api.core.RegionManager.blocked(tile, area)) continue;
      return tile;
    }
    return null;
  }

  function handleStart({ player, area }) {
    if (!player || !area || !player.getAttribute(ESCAPED) || !atArea(player, area)) return false;
    if (!Number.isFinite(Number(player.getAttribute(PROGRESS)))) setState(player, 22);
    const cutsceneAssassin = area.entities.find((npc) => npc.getId?.() === N.ASSASSIN_7);
    if (cutsceneAssassin) removeOwnedNpc(area, cutsceneAssassin);
    return true;
  }
  function handleResume({ player, area }) {
    if (!player || !area || !player.getAttribute(ESCAPED) || !atArea(player, area)) return false;
    clearPursuer(player, area);
    player.setAttribute(PURSUER_DISMISSED, false);
    if (player.getAttribute(CREVICE_CLEARED)) {
      player.getPacketSender().sendVarbit(BLOCKAGE_VARBIT, 1);
    }
    if (state(player) === 54) {
      removeOwnedNpc(area, player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan"));
      for (const clone of defences.get(player)?.clones ?? []) removeOwnedNpc(area, clone);
      defences.delete(player);
      player.setAttribute("desert-treasure-ii:sucellus-prison-jhallan", null);
      player.setAttribute(DEFENCE_START, null);
      player.setAttribute(FIREWORKS, false);
      setState(player, 52);
    }
    const progress = state(player);
    if ((progress >= 40 && progress <= 50) || progress === 56) spawnAssassin(player, area);
    else if (progress < 40) {
      const cutsceneAssassin = area.entities.find((npc) => npc.getId?.() === N.ASSASSIN_7);
      if (cutsceneAssassin) removeOwnedNpc(area, cutsceneAssassin);
      player.setAttribute("desert-treasure-ii:sucellus-prison-assassin", null);
    }
    return true;
  }
  api.onCustomEvent("dt2:sucellus-prison-start", handleStart);
  api.onCustomEvent("dt2:sucellus-prison-resume", handleResume);
  api.onCustomEvent("dt2:sucellus-prison-process", handleProcess);
  function allowPrisonFood(request) {
    if (request?.area !== "ghorrock-prison") return;
    const player = request.player;
    request.inside = Boolean(player && atArea(player, player.getAttribute(AREA)) && state(player) >= 22 && state(player) < 50);
  }
  api.onCustomEvent("food:area", allowPrisonFood);
  api.onPlayerBeforeDeath(handlePrisonBeforeDeath);
  api.onNpcInteraction("Assassin", { "Talk-to": handlePrisonAssassinInteraction });
  function talkJhallan(event) {
    if (!event.player?.getAttribute(ESCAPED) || state(event.player) !== 54 || !atArea(event.player, event.player.getAttribute(AREA))) return false;
    event.handled = true;
    startTranscript(api, event.player, event.npcId, PAGE, "duke-sucellus-of-the-sixth-legion-getting-ambushed-by-jhallan");
    return true;
  }
  api.onNpcInteraction("Jhallan", { "Talk-to": talkJhallan });
  api.onObjectInteraction(handlePrisonObject);
  api.onCustomEvent("ladders:climb", handlePrisonStairs);
  api.onItemOnObject(handlePrisonItemOnObject, { noted: false });
  api.onCustomEvent("npc-dialogue:action", handlePrisonDialogueAction);
  function readClue(event, itemId, bit, message) {
    if (!event.player?.getAttribute(ESCAPED) || !has(event.player, itemId)) return false;
    event.handled = true;
    event.player.setAttribute(CLUES_READ, (Number(event.player.getAttribute(CLUES_READ)) || 0) | bit);
    event.player.sendMessage(message);
    return true;
  }
  function readWarningLetter(event) { return readClue(event, I.WARNING_LETTER, 1, "The warning letter compares the candle holders with the strokes on the banners above them. Use those counts to work out the chest code."); }
  function readRequisitionNote(event) { return readClue(event, I.REQUISITION_NOTE, 2, "The request names point to the word VIAL. The identifier column and grid note locate its chest and reveal the letters to enter."); }
  function readGridNote(event) { return readClue(event, I.GRID_NOTE, 16, "The grid note locates the vial chest in the administration room."); }
  function readCodeConverter(event) { return readClue(event, I.CODE_CONVERTER, 4, "The converter deciphers the coded letters along the purple arrow route. Follow the arrows between the beds and use the seven chest names to work out the final sequence."); }
  function readLibraryNote(event) { return readClue(event, I.LIBRARY_NOTE, 8, "The note asks you to find books written by Duke Quirinius and quotes: 'Various people emerged near us.' The first letter of each word may be useful."); }
  function inspectStrangeSlider(event) {
    if (!event.player?.getAttribute(ESCAPED) || !has(event.player, I.STRANGE_SLIDER)) return false;
    event.handled = true;
    event.player.setAttribute(SLIDER_INSPECTED, true);
    event.player.sendMessage("You align the slider: place I below, evenly between H and L.");
    return true;
  }
  function handleJournal(event) {
    const area = event?.player?.getAttribute(AREA);
    if (!event?.player?.getAttribute(ESCAPED) || !atArea(event.player, area)) return false;
    event.lines = journal(state(event.player));
    return true;
  }
  function handlePrisonDialogueLine(event) {
    const area = event.player?.getAttribute(AREA);
    if (event.npcId !== N.ASSASSIN_7 || event.text !== "Now, once again, let's get this cell open."
      || !event.player?.getAttribute(ESCAPED) || !atArea(event.player, area) || state(event.player) !== 40) return false;
    event.after = () => setState(event.player, 46);
    return true;
  }
  api.onItemAction("Warning letter", { Read: readWarningLetter });
  api.onItemAction("Requisition note", { Read: readRequisitionNote });
  api.onItemAction("Grid note", { Read: readGridNote });
  api.onItemAction("Code converter", { Read: readCodeConverter });
  api.onItemAction("Library note", { Read: readLibraryNote });
  api.onItemAction("Strange slider", { Inspect: inspectStrangeSlider });
  api.onCustomEvent("dt2:sucellus-prison-journal", handleJournal);
  api.onCustomEvent("npc-dialogue:line", handlePrisonDialogueLine);
};
