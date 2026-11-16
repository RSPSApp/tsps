/**
 * Shilo Village: the hidden doors, Rashiliyia's tomb, the bones, Nazastarool and her remains, as the
 * capture plays them (RSProx capture ShiloVillage, rev 242.1; ticks are that recording's):
 * - the palm trees (2237 at 2915/2916,3092): the two lines with seq 810 and varbit 8180 to 1, the doors
 *   revealed (t3972); searched again, "The trees are already pulled apart revealing some doors." (t3984);
 * - the carved doors (multilocs 34657/34673 on varbit 8180: plants 0, carved doors 1, hillside entrance 2):
 *   Open and Search boxes (t3992, t4000); the bone key's first line, then a tick later stage 10, varbit 2,
 *   the second line and sound 2410, no teleport (t4021-4022); the entrance's Enter: "You walk into the
 *   darkness of the cavern.", the player inside with sound 68, then the "doors close" box (t4025, t4523);
 * - the tomb exit (2242/2243): Open is always locked, the line then three overhead lines two ticks apart
 *   (t4037-4054, t4905-4911); the bone key on it lets the player out (the transcript, not captured);
 * - the ancient metal gate (2255/2256, a north-edge wall at y 9516): with the beads, "The Beads of the Dead
 *   start to glow...", stage 11, the gate open (inviswall, 1573/1574 north of it) for two ticks with sound
 *   69 while the player moves through (t4062-4069, t4530-4534, t4899-4902); Search is only its look;
 * - the rocks (2257): two moves each way with their lines (down t4086-4093 and t4535-4542, up t4891-4897);
 * - the tomb doors (2246/2247, a north-edge wall at y 9480): each bone, seq 832 then a tick later the line,
 *   the bones box and the door's look for this player (2248, 2249, then 2250); after the third, the box of the
 *   door coming alive, and the doors open by themselves and the player walks in (inviswall, 2251/2252, sound
 *   46, two ticks: t4574-4599); opened again later, the same walk through (t4860-4866);
 * - the dolmen (2258) and Nazastarool: the box with a camera shake and sound 1678; six ticks after it the
 *   zombie beside the dolmen with his two shouts, sound 920 (t4605-4616); each form's death box seven ticks
 *   after it falls, the next form a tick after its continue (t4671-4682, t4736-4746); after the ghost, the
 *   curse in chat and its boxes, and Rashiliyia's remains on the ground by the dolmen for this player
 *   (t4833-4842; no form drops them); taken, stage 14 and the remains box (t4845-4850), and the dolmen then
 *   has "You find nothing new on the dolmen." (t4854).
 */
const { storedKey } = require("../../items/KeyAvailability");

module.exports = function attachRashiliyia(api, sv) {
  const { ObstacleRunner, STAGE, MECH, NPC, ITEM, LOC } = sv;
  const { Animation, Location, GameObject, ObjectManager, ItemOnGroundManager, Item, Sounds } = api.core;

  const STARTED_ON_LOGIN = "player:bootstrap-complete";

  // --- Hidden doors -----------------------------------------------------------------------------
  const PALM_AREA = { minX: 2913, maxX: 2919, minY: 3091, maxY: 3094 };
  const PUSH_SEQ = 810; // human_push
  const UNLOCK_SOUND = 2410; // scrape
  const ENTER_SOUND = 68; // grate_close
  const TOMB_INSIDE = [2929, 9525, 0];
  const TOMB_OUTSIDE = [2916, 3093, 0];
  const LINES = Object.freeze({
    keyTried: "You try the bone key with the lock.", // lP_qes
    doorsOpen: "A shimmering light dances over the doors, before you can blink, the doors creak open.", // Gq5u9w
    enter: "You walk into the darkness of the cavern.",
    doorsClose: "The doors close behind you with the sound of crunching bone. Before you stretches a winding tunnel blocked by an ancient gate.", // Rz885J
    keyring: "You use your keyring to unlock the door.",
    locked: "The door seems to be locked!", // VKFDeo
    stuck: ["Oh no, I'm going to be stuck in here forever!", "How will I ever get out!", "I'm too young to die!"],
    rocksDown: ["You carefully try to pick your way down the rocks.", "You manage to carefully clamber down."], // ZTWGUS, Yq_UYp
    rocksUp: ["You carefully pick your way through the rocks.", "You manage to carefully clamber up."], // Ht3xLJ, ksPeKy
    noBeads: "You can't bring yourself to climb down there without some protection.", // Ours: no source has a refusal
  });

  // --- The ancient gate -------------------------------------------------------------------------
  const GATE_Y = 9516;
  const GATE_CLOSED = [[2255, 2928, 9516, 0, 1], [2256, 2929, 9516, 0, 1]];
  const GATE_OPENED = [
    [LOC.INVISWALL, 2928, 9516, 0, 1], [LOC.INVISWALL, 2929, 9516, 0, 1],
    [LOC.METAL_GATE_OPEN_L, 2928, 9517, 0, 0], [LOC.METAL_GATE_OPEN_R, 2929, 9517, 0, 2],
  ];
  const GATE_SOUND = 69; // grate_open
  /** The gate's crossing column: both captured passes went through x 2929 (t4067, t4900). */
  const GATE_X = 2929;

  // --- The rocks --------------------------------------------------------------------------------
  const TOMB_ROCKS_AREA = { minX: 2925, maxX: 2932, minY: 9509, maxY: 9517 };
  const ROCKS_MIDDLE_Y = 9512;
  const ROCKS_TOP = [2929, 9515];
  const ROCKS_BOTTOM = [2928, 9511];

  // --- The tomb doors ---------------------------------------------------------------------------
  const DOOR_XS = [2892, 2893];
  /** Bones placed -> this player's [left (2892), right (2893)] leaves (t4574, t4583, t4591). */
  const DOOR_LEAVES = [[2246, 2247], [2248, 2247], [2249, 2247], [2249, 2250]];
  const DOOR_OPEN_LEAVES = [2251, 2252];
  const DOOR_SOUND = 46; // bigdoor_open
  const DOOR_CROSS_X = 2892;
  const PLACE_SEQ = 832; // human_pickuptable
  const LAST_BONE_BOX = "MhsAsF";
  const PENDING_BONE_ATTRIBUTE = "shilo-village:pending-bone";

  // --- Nazastarool ------------------------------------------------------------------------------
  const FORMS = NPC.NAZASTAROOL;
  /** Where each form rises, from the dolmen's south-west tile 2892,9487 (t4612, t4682, t4746). */
  const FORM_OFFSETS = [[-2, -1], [3, -2], [1, -3]];
  const FORM_SAYS = [
    ["Who dares disturb Rashiliyia's rest?", "I am Nazastarool! Prepare to die!"],
    ["Quake in fear, for I am reborn!", "Your death will be swift."],
    ["Nazastarool returns with vengeance!", "Soon you will serve Rashiliyia."],
  ];
  const FORM_DEATH_BOXES = [
    "You defeat Nazastarool and the corpse falls to the ground. The bones start to move again and soon they reform into a grisly giant skeleton.", // 7tIfZW
    "You defeat Nazastarool and the skeleton falls to the ground. An ethereal form starts taking shape above the bones and you soon face the vengeful ghost of Nazastarool.", // LrgBDG
  ];
  const CURSE = Object.freeze({
    appears: "You see something appear on the dolmen.", // dBR0dC (chat), WVfIey (box)
    chat: ["Nazastarool: May you perish in the fires of Zamorak's furnace! Rashiliyia's", "Nazastarool: curse is upon you!"], // J26ciO, olIIJD
    voice: "You hear a disembodied voice fading away into the distance, 'May you perish in the fires of Zamorak's furnace! Rashiliyia's curse is upon you!'", // 1uC0er
  });
  const RUMBLE_SOUND = 1678;
  const ZOMBIE_SOUND = 920; // zombie_atmospheric1, a tile south-east of where he rises
  /** The form rises six ticks after the box's continue (t4606 -> t4612); his second shout two ticks on. */
  const RISE_TICKS = 6;
  const SECOND_SHOUT_TICKS = 2;
  const CAMERA_RESET_TICKS = 4;
  /** A form's death box seven ticks after its death animation (t4671 -> t4678, t4736 -> t4743). */
  const DEATH_BOX_TICKS = 7;
  /** The curse four ticks after the ghost's (t4833 -> t4837). */
  const CURSE_TICKS = 4;
  /** The remains on the ground (obj_add 609 at 2893,9487, despawn 200, owned). */
  const REMAINS_OFFSET = [1, 0];
  const REMAINS_DESPAWN = 200;
  /** Remains taken from the ground: stage 14 and the box two ticks later (t4848 -> t4850). */
  const TAKEN_TICKS = 2;
  /** Wiki (Nazastarool): "Each form has a 5 minute despawn timer." */
  const FORM_LIFETIME = 500;

  // --- Transcript ids ---------------------------------------------------------------------------
  const ACTION_SPAWN_UNDEAD = "vNDeU9";
  const ACTION_GATE_UNDEAD = "UTuQLV";
  const ACTION_NAZASTAROOL_RISES = "KPnwZH";
  const MESSAGE_DOLMEN_BOX = "VqZw9g";
  const MESSAGE_LOCKED = "VKFDeo";
  const MESSAGE_GLOW = "j85hPR";

  /** player -> { npc, index, dolmen: [x, y] } while a form stands. */
  const forms = new Map();
  /** player -> owned door leaves shown for the bones placed. */
  const shownLeaves = new Map();
  /** player -> the gate they opened, until the glow line lets them through. */
  const pendingGate = new Map();
  /** player -> the bone use: the door row and the slot the bone came from. */
  const pendingBone = new Map();

  const inArea = (area, x, y) => x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY;
  const xy = (location) => [location?.getX?.() ?? location?.x, location?.getY?.() ?? location?.y];

  /**
   * `fn` in `ticks` ticks, for this player only while they are still in the world. Not keyed to the player:
   * the walk-to that ends an item-on-loc click cancels the player's own tasks.
   */
  function soon(player, ticks, fn) {
    const task = new api.core.Task(Math.max(1, ticks), false);
    task.execute = () => {
      task.stop();
      if (player.isRegistered?.() !== false) fn();
    };
    api.core.TaskManager.submit(task);
  }

  function animate(player, id) {
    player.performAnimation(new Animation(id));
  }

  function sound(player, id) {
    player.getPacketSender().sendSoundEffect(id, 1, 0);
  }

  // --- Hidden doors -----------------------------------------------------------------------------
  function tombDoorState(player) {
    if (sv.stage(player) >= STAGE.UNLOCKED_TOMB) return sv.TOMB_DOORS_OPEN;
    // A save from before the doors could be seen, which got as far as their lock, has searched.
    return sv.mechTest(player, MECH.SEARCHED_PALM) || sv.mechTest(player, MECH.FOUND_BONE_DOOR)
      ? sv.TOMB_DOORS_CLOSED
      : sv.TOMB_DOORS_HIDDEN;
  }

  function syncTombDoors(player) {
    player.getPacketSender().sendVarbit(sv.VARBIT_TOMB_DOORS, tombDoorState(player));
  }

  function searchPalm(player) {
    animate(player, PUSH_SEQ);
    if (tombDoorState(player) !== sv.TOMB_DOORS_HIDDEN) {
      sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-search-palm-tree-after-revealing-the-doors");
      return;
    }
    sv.mechSet(player, MECH.SEARCHED_PALM, true);
    syncTombDoors(player);
    sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-search-palm-tree");
  }

  /**
   * The bone key turns: the first line, then a tick later the doors open (t4021-4022). The lines are the
   * transcript's "Use bone key on Carved doors" (lP_qes, Gq5u9w); its third ("The doors close behind you")
   * is the entrance's box, on Enter.
   */
  function unlockCarvedDoors(player, viaKeyring = false) {
    sv.mechSet(player, MECH.FOUND_BONE_DOOR, true);
    player.sendMessage(viaKeyring ? LINES.keyring : LINES.keyTried);
    soon(player, 1, () => {
      sv.advance(player, STAGE.UNLOCKED_TOMB);
      syncTombDoors(player);
      player.sendMessage(LINES.doorsOpen);
      sound(player, UNLOCK_SOUND);
    });
  }

  /** The hillside entrance's Enter (t4025, t4523): the line, inside with the sound, then the box. */
  function enterTomb(player) {
    player.sendMessage(LINES.enter);
    sv.teleport(player, TOMB_INSIDE);
    sound(player, ENTER_SOUND);
    sv.statement(player, LINES.doorsClose);
  }

  function handleCarvedDoors(player, clickType) {
    if (clickType !== 1) {
      sv.mechSet(player, MECH.FOUND_BONE_DOOR, true);
      sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-search-carved-doors");
      return;
    }
    if (storedKey(api, player, ITEM.BONE_KEY)) {
      unlockCarvedDoors(player, true);
      return;
    }
    sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-open-carved-doors");
  }

  function handleHiddenDoors(player, clickType) {
    const state = tombDoorState(player);
    if (state === sv.TOMB_DOORS_OPEN) {
      if (clickType === 1) enterTomb(player);
    } else if (state === sv.TOMB_DOORS_CLOSED) {
      handleCarvedDoors(player, clickType);
    }
  }

  // --- Tomb exit --------------------------------------------------------------------------------
  /** Open is always locked: the line, then three overhead lines two ticks apart (t4905-4911). */
  function lockedIn(player) {
    soon(player, 1, () => player.sendMessage(LINES.locked));
    LINES.stuck.forEach((line, index) => soon(player, 2 + index * 2, () => player.forceChat(line)));
  }

  function handleTombExit(player, clickType) {
    if (clickType === 2) {
      sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-search-tomb-exit");
      return;
    }
    if (sv.wearingBeads(player)) {
      lockedIn(player);
      return;
    }
    // Without the beads Rashiliyia appears first (the transcript's "Same as above"), then it is locked.
    sv.scene(player, NPC.RASHILIYIA, "visiting-the-tomb-of-rashiliyia-open-tomb-exit");
  }

  function useKeyOnExit(player) {
    sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-use-bone-key-on-tomb-exit");
    sv.teleport(player, TOMB_OUTSIDE);
  }

  // --- The ancient gate -------------------------------------------------------------------------
  /**
   * Through the gate with it open for two ticks: from the north the two-tile move to 2929,9515 (t4067); from
   * the south a step onto 9516 first and the two tiles out to 9518 (t4899-4900).
   */
  function passGate(player) {
    if (ObstacleRunner.isBusy(player)) return;
    const [, y] = xy(player.getLocation());
    const fromNorth = y > GATE_Y;
    const swing = { run: () => sv.swingOpen({ closed: GATE_CLOSED, opened: GATE_OPENED }) };
    ObstacleRunner.run({ player }, fromNorth
      ? [swing, { sound: GATE_SOUND }, { walk: [[GATE_X, GATE_Y - 1]], tilesPerTick: 2, arrive: true }]
      : [
        ...(y === GATE_Y ? [] : [{ walk: [[GATE_X, GATE_Y]], arrive: true }]),
        swing, { sound: GATE_SOUND },
        { walk: [[GATE_X, GATE_Y + 2]], tilesPerTick: 2, arrive: true },
      ]);
  }

  function handleAncientGate(event) {
    const { player, clickType } = event;
    if (clickType === 2) {
      sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-search-ancient-metal-gate");
      return;
    }
    if (sv.complete(player) && !sv.wearingBeads(player)) {
      // Ours: after the quest the gate lets the player through without the beads (no source).
      passGate(player);
      return;
    }
    pendingGate.set(player, true);
    sv.scene(player, NPC.RASHILIYIA, "visiting-the-tomb-of-rashiliyia-open-ancient-metal-gate");
  }

  // --- The rocks --------------------------------------------------------------------------------
  function walkTo(player, [x, y]) {
    return sv.at(player, x, y) ? [] : [{ walk: [[x, y]], arrive: true }];
  }

  /**
   * Down: the first line and a two-tile move to y 9513, the second move to 2928,9511 three ticks on, the
   * second line three after that (t4535-4542). Up: the same the other way with its lines (t4891-4897).
   */
  function climbRocks(player) {
    if (ObstacleRunner.isBusy(player)) return;
    const [, y] = xy(player.getLocation());
    if (y > ROCKS_MIDDLE_Y) {
      if (!sv.complete(player) && !sv.wearingBeads(player)) {
        player.sendMessage(LINES.noBeads);
        return;
      }
      ObstacleRunner.run({ player }, [
        ...walkTo(player, ROCKS_TOP),
        { walk: [[2928, 9513]], tilesPerTick: 2, arrive: true },
        { msg: LINES.rocksDown[0] },
        { wait: 2 },
        { walk: [ROCKS_BOTTOM], tilesPerTick: 2, arrive: true },
        { wait: 3 },
        { msg: LINES.rocksDown[1] },
      ]);
      return;
    }
    ObstacleRunner.run({ player }, [
      ...walkTo(player, ROCKS_BOTTOM),
      { msg: LINES.rocksUp[0] },
      { walk: [[2928, 9513]], tilesPerTick: 2, arrive: true },
      { wait: 2 },
      { walk: [ROCKS_TOP], tilesPerTick: 2, arrive: true },
      { wait: 2 },
      { msg: LINES.rocksUp[1] },
    ]);
  }

  // --- The tomb doors ---------------------------------------------------------------------------
  function doorLeaf(id, x, y, owner) {
    const leaf = new GameObject(id, new Location(x, y, 0), 0, 1, null);
    if (owner) leaf.setOwner(owner);
    return leaf;
  }

  function hideLeaves(player) {
    for (const leaf of shownLeaves.get(player) ?? []) ObjectManager.deregister(leaf, true);
    shownLeaves.delete(player);
  }

  /**
   * This player's door with the bones placed so far (t4574, t4583, t4591); none placed is the map's own, and
   * once the doors have swung open the map's own leaves are back for good (t4599, t4860).
   */
  function showLeaves(player, placed, row) {
    hideLeaves(player);
    if (placed <= 0 || placed > 3) return;
    const leaves = DOOR_LEAVES[placed].map((id, index) => doorLeaf(id, DOOR_XS[index], row, player));
    for (const leaf of leaves) ObjectManager.register(leaf, true);
    shownLeaves.set(player, leaves);
  }

  /** Through the tomb doors, open two ticks (t4596-4599 in, t4860-4866 out). */
  function walkThroughDoors(player, row) {
    if (ObstacleRunner.isBusy(player)) return;
    hideLeaves(player);
    const [x, y] = xy(player.getLocation());
    const inside = y > row;
    const column = inside && DOOR_XS.includes(x) ? x : DOOR_CROSS_X;
    const swing = {
      run: () => sv.swingOpen({
        closed: [[2246, 2892, row, 0, 1], [2247, 2893, row, 0, 1]],
        opened: [
          [LOC.INVISWALL, 2892, row, 0, 1], [LOC.INVISWALL, 2893, row, 0, 1],
          [DOOR_OPEN_LEAVES[0], 2892, row + 1, 0, 0], [DOOR_OPEN_LEAVES[1], 2893, row + 1, 0, 2],
        ],
      }),
    };
    ObstacleRunner.run({ player }, [
      ...walkTo(player, [column, inside ? row + 1 : row]),
      swing,
      { sound: DOOR_SOUND },
      { walk: [[column, inside ? row : row + 1]], arrive: true },
    ]);
  }

  function handleTombDoors(event) {
    const { player, clickType, location } = event;
    const [, row] = xy(location);
    const placed = sv.bonesPlaced(player);
    if (clickType === 2) {
      const variant = ["no-bones-put-in", "one-bone-put-in", "two-bones-put-in", "three-bones-put-in"][Math.min(placed, 3)];
      sv.scene(player, NPC.TRUFITUS, `visiting-the-tomb-of-rashiliyia-search-tomb-doors-${variant}`);
      return;
    }
    if (sv.stage(player) < STAGE.UNLOCKED_TOMB_DOOR) {
      sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-open-tomb-doors-before-placing-bones");
      return;
    }
    walkThroughDoors(player, row);
  }

  /** A bone into the door: seq 832, and a tick later the line and the box (t4574-4592). */
  function placeBone(event) {
    const { player, itemSlot, location } = event;
    const placed = sv.bonesPlaced(player);
    if (placed >= 3) {
      sv.scene(player, NPC.TRUFITUS, "post-quest-rashiliyia-s-tomb-using-bones-on-the-tomb-door");
      return;
    }
    const [, row] = xy(location);
    animate(player, PLACE_SEQ);
    soon(player, 1, () => {
      const inventory = player.getInventory();
      const slot = inventory.getItems()[itemSlot]?.getId?.() === ITEM.BONES ? itemSlot : inventory.getSlotForItemId?.(ITEM.BONES);
      if (slot == null || slot < 0) return;
      inventory.deleteAtSlot(slot, 1, true);
      player.setAttribute(PENDING_BONE_ATTRIBUTE, placed);
      sv.setBonesPlaced(player, placed + 1);
      if (placed + 1 === 3) sv.advance(player, STAGE.UNLOCKED_TOMB_DOOR);
      showLeaves(player, placed + 1, row);
      pendingBone.set(player, row);
      sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-using-bones-on-tomb-doors");
    });
  }

  // --- Nazastarool ------------------------------------------------------------------------------
  function defeated(player) {
    if (sv.mechTest(player, MECH.DEFEATED_3)) return 3;
    if (sv.mechTest(player, MECH.DEFEATED_2)) return 2;
    return sv.mechTest(player, MECH.DEFEATED_1) ? 1 : 0;
  }

  function areaSound(player, soundId, x, y) {
    Sounds.playAreaSound({ soundId, x, y, level: player.getLocation().getZ(), radius: 10 });
  }

  /** A form rises by the dolmen with its two shouts (t4612-4614, t4682-4684, t4746-4748). */
  function riseForm(player, index, dolmen) {
    const previous = forms.get(player)?.npc;
    if (previous) api.removeNpc(previous);
    const [dx, dy] = FORM_OFFSETS[index];
    const x = dolmen[0] + dx;
    const y = dolmen[1] + dy;
    const npc = api.spawnNpc({ id: FORMS[index], x, y, z: player.getLocation().getZ(), wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return null;
    forms.set(player, { npc, index, dolmen });
    npc.forceChat?.(FORM_SAYS[index][0]);
    areaSound(player, ZOMBIE_SOUND, x + 1, y - 1);
    soon(player, SECOND_SHOUT_TICKS, () => npc.forceChat?.(FORM_SAYS[index][1]));
    npc.getCombat?.().attack?.(player);
    soon(player, FORM_LIFETIME, () => {
      if (forms.get(player)?.npc !== npc) return;
      forms.delete(player);
      api.removeNpc(npc);
    });
    return npc;
  }

  function searchDolmen(event) {
    const { player, location } = event;
    const dolmen = xy(location);
    if (sv.complete(player)) {
      sv.scene(player, NPC.TRUFITUS, "post-quest-rashiliyia-s-tomb-look-at-or-search-tomb-dolmen");
      return;
    }
    if (sv.stage(player) >= STAGE.RETRIEVED_CORPSE) {
      sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-look-at-or-search-tomb-dolmen-after-taking-rashiliyia-s-remains");
      return;
    }
    if (sv.stage(player) < STAGE.UNLOCKED_TOMB_DOOR) return;
    if (forms.has(player)) {
      player.sendMessage("The dolmen remains silent."); // Ours: no capture searches it mid-fight
      return;
    }
    if (defeated(player) >= 3) {
      // Ours: the remains are gone from the ground (despawned) and not carried, so they appear again.
      if (!sv.held(player, ITEM.RASHILIYIA_CORPSE) && !remainsOnGround(player, dolmen)) {
        placeRemains(player, dolmen);
        sv.statement(player, CURSE.appears);
      }
      return;
    }
    pendingDolmen.set(player, dolmen);
    sv.scene(player, FORMS[0], "visiting-the-tomb-of-rashiliyia-look-at-or-search-tomb-dolmen");
  }
  const pendingDolmen = new Map();

  /** The form fell: its death box seven ticks on, the next a tick after its continue (t4671-4682). */
  function formDied(player, index, deathTicks) {
    const state = forms.get(player);
    forms.delete(player);
    const dolmen = state?.dolmen ?? [2892, 9487];
    const wait = Math.max(1, (index === 2 ? CURSE_TICKS : DEATH_BOX_TICKS) - deathTicks);
    if (index === 2) {
      soon(player, wait, () => curse(player, dolmen));
      return;
    }
    soon(player, wait, () => sv.statement(player, FORM_DEATH_BOXES[index], () => {
      soon(player, 1, () => riseForm(player, index + 1, dolmen));
    }));
  }

  function placeRemains(player, dolmen) {
    const at = new Location(dolmen[0] + REMAINS_OFFSET[0], dolmen[1] + REMAINS_OFFSET[1], player.getLocation().getZ());
    ItemOnGroundManager.registerLocation(player, new Item(ITEM.RASHILIYIA_CORPSE, 1), at, player.getPrivateArea?.() ?? null,
      { goesGlobal: false, despawnDelay: REMAINS_DESPAWN });
  }

  function remainsOnGround(player, dolmen) {
    const at = new Location(dolmen[0] + REMAINS_OFFSET[0], dolmen[1] + REMAINS_OFFSET[1], player.getLocation().getZ());
    return ItemOnGroundManager.getGroundItem(player.getUsername(), ITEM.RASHILIYIA_CORPSE, at, player.getPrivateArea?.() ?? null) != null;
  }

  /** After the ghost: the chat lines, the remains on the ground, then the two boxes (t4837-4842). */
  function curse(player, dolmen) {
    player.sendMessage(CURSE.appears);
    placeRemains(player, dolmen);
    for (const line of CURSE.chat) player.sendMessage(line);
    sv.statement(player, CURSE.voice, () => sv.statement(player, CURSE.appears));
  }

  function handleNpcDeath(event) {
    const player = event.killer;
    if (!player?.isPlayer?.()) return;
    const index = FORMS.indexOf(event.npcId ?? event.npc?.getId?.());
    if (index === -1 || forms.get(player)?.npc !== event.npc) return;
    if (sv.stage(player) < STAGE.UNLOCKED_TOMB_DOOR || sv.complete(player)) return;
    sv.mechSet(player, [MECH.DEFEATED_1, MECH.DEFEATED_2, MECH.DEFEATED_3][index], true);
    const deathTicks = event.npc?.getCurrentDefinition?.()?.getDeathTicks?.() ?? 0;
    formDied(player, index, deathTicks);
  }

  /** No form drops the remains: they appear on the ground by the dolmen after the ghost (t4837). */
  function handleDrops(event) {
    if (!FORMS.includes(event.npcId) || !Array.isArray(event.drops)) return;
    for (let i = event.drops.length - 1; i >= 0; i--) {
      if (event.drops[i]?.itemId === ITEM.RASHILIYIA_CORPSE) event.drops.splice(i, 1);
    }
  }

  /** The remains taken from the ground: stage 14 and the box two ticks later (t4848-4850). */
  function handleTaken(event) {
    const { player, itemId } = event;
    if (!player || itemId !== ITEM.RASHILIYIA_CORPSE || sv.complete(player)) return;
    if (sv.stage(player) !== STAGE.UNLOCKED_TOMB_DOOR || defeated(player) < 3) return;
    soon(player, TAKEN_TICKS, () => {
      sv.advance(player, STAGE.RETRIEVED_CORPSE);
      sv.scene(player, NPC.TRUFITUS, "visiting-the-tomb-of-rashiliyia-take-rashiliyia-corpse");
    });
  }

  // --- Transcript hooks -------------------------------------------------------------------------
  function spawnUndead(player, count) {
    const [x, y] = xy(player.getLocation());
    for (let i = 0; i < count; i++) {
      api.spawnNpc({
        id: NPC.UNDEAD_ONE,
        x: x + (i % 2 === 0 ? 1 : -1),
        y: y + (i < 2 ? 1 : 0),
        z: player.getLocation().getZ(),
        wanderRadius: 3,
        owner: player,
        ownerOnly: true,
      });
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    switch (stepId) {
      case ACTION_SPAWN_UNDEAD:
      case ACTION_GATE_UNDEAD:
        // Ours, as before: Rashiliyia's 1-3 undead ones beside the player.
        event.handled = true;
        spawnUndead(player, 1 + Math.floor(Math.random() * 3));
        return;
      case MESSAGE_DOLMEN_BOX:
        player.getPacketSender().sendCameraShake(0, 10, 0, 0);
        sound(player, RUMBLE_SOUND);
        return;
      case ACTION_NAZASTAROOL_RISES: {
        event.handled = true;
        event.end = true;
        const dolmen = pendingDolmen.get(player) ?? [2892, 9487];
        pendingDolmen.delete(player);
        const index = defeated(player);
        soon(player, RISE_TICKS, () => {
          if (forms.has(player) || sv.complete(player)) return;
          riseForm(player, index, dolmen);
          soon(player, CAMERA_RESET_TICKS, () => player.getPacketSender().sendCameraReset());
        });
        return;
      }
      case MESSAGE_LOCKED:
        event.handled = true;
        event.end = true;
        lockedIn(player);
        return;
      case MESSAGE_GLOW:
        if (!pendingGate.has(player)) return;
        pendingGate.delete(player);
        sv.advance(player, STAGE.ENTERED_WITH_BEADS);
        passGate(player);
        return;
      case LAST_BONE_BOX: {
        const row = pendingBone.get(player);
        pendingBone.delete(player);
        if (row == null) return;
        const previous = event.after;
        event.after = () => {
          previous?.();
          soon(player, 1, () => walkThroughDoors(player, row));
        };
        return;
      }
      default:
    }
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("not wearing the beads")) return !sv.wearingBeads(player);
    if (value.includes("wearing the beads")) return sv.wearingBeads(player);
    const pending = Number(player.getAttribute(PENDING_BONE_ATTRIBUTE)) || 0;
    if (value.includes("first bone")) return pending === 0;
    if (value.includes("second bone")) return pending === 1;
    if (value.includes("third bone")) return pending === 2;
    return null;
  }

  // --- Dispatch ---------------------------------------------------------------------------------
  function handleObject(event) {
    const { objectId, player, clickType, location } = event;
    const [x, y] = xy(location);
    if (objectId === LOC.PALM_TREE && inArea(PALM_AREA, x, y)) {
      event.handled = true;
      searchPalm(player);
    } else if (LOC.HIDDEN_TOMB_DOORS.includes(objectId)) {
      event.handled = true;
      handleHiddenDoors(player, clickType);
    } else if (LOC.CARVED_DOORS.includes(objectId)) {
      event.handled = true;
      handleCarvedDoors(player, clickType);
    } else if (LOC.TOMB_EXITS.includes(objectId)) {
      event.handled = true;
      handleTombExit(player, clickType);
    } else if (LOC.ANCIENT_GATES.includes(objectId)) {
      event.handled = true;
      handleAncientGate(event);
    } else if (objectId === LOC.TOMB_ROCKS && inArea(TOMB_ROCKS_AREA, x, y)) {
      event.handled = true;
      climbRocks(player);
    } else if (LOC.TOMB_DOORS.includes(objectId)) {
      event.handled = true;
      handleTombDoors(event);
    } else if (objectId === LOC.RASHILIYIA_DOLMEN) {
      event.handled = true;
      searchDolmen(event);
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === ITEM.BONE_KEY && (LOC.CARVED_DOORS.includes(objectId) || LOC.HIDDEN_TOMB_DOORS.includes(objectId))) {
      const state = tombDoorState(player);
      if (LOC.HIDDEN_TOMB_DOORS.includes(objectId) && state === sv.TOMB_DOORS_HIDDEN) return;
      event.handled = true;
      if (state === sv.TOMB_DOORS_OPEN) enterTomb(player); // Ours: the key on the open entrance goes in
      else unlockCarvedDoors(player);
      return;
    }
    if (itemId === ITEM.BONE_KEY && LOC.TOMB_EXITS.includes(objectId)) {
      event.handled = true;
      useKeyOnExit(player);
      return;
    }
    if (itemId === ITEM.BONES && LOC.TOMB_DOORS.includes(objectId)) {
      event.handled = true;
      placeBone(event);
    }
  }

  function clearForms(player) {
    const state = forms.get(player);
    if (state?.npc) api.removeNpc(state.npc);
    forms.delete(player);
    pendingDolmen.delete(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    clearForms(player);
    hideLeaves(player);
    pendingGate.delete(player);
    pendingBone.delete(player);
  }

  function handleLogin({ player }) {
    if (!player) return;
    clearForms(player);
    const placed = sv.bonesPlaced(player);
    if (placed > 0 && placed < 3 && !sv.complete(player)) showLeaves(player, placed, 9480);
  }

  function handleBootstrap({ player }) {
    if (player) syncTombDoors(player);
  }

  api.onObjectInteraction(handleObject);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-drops:roll", handleDrops);
  api.onCustomEvent("ground-items:taken", handleTaken);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
  // After the login bootstrap, which clobbers shared varps; 8180 shares 1785 with My Arm's quest.
  api.onCustomEvent(STARTED_ON_LOGIN, handleBootstrap);

  return {
    tombDoorState, syncTombDoors, riseForm, formDied, curse, placeRemains, climbRocks, passGate, walkThroughDoors,
    forms, FORM_OFFSETS, DOOR_LEAVES,
  };
};
