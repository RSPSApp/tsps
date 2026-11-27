/**
 * The eyrie inside Eagles' Peak, as the capture plays it (RSProx, rev 243; ticks in docs/quests/eagles-peak/README.md):
 * - Meeting Nickolaus: at 15, stepping on to the chasm's north ledge (2006,4973, t308) sets
 *   eaglepeak_nickolaus_chat to 1, moves the camera over the chasm, walks the player to 2004,4967 and
 *   Nickolaus (the map's 2023) to 2006,4961; his first "Hello? Er... excuse me?" cannot be continued and
 *   is replaced 8 ticks on, as he waves (emote_wave) and the camera comes back (t308-317).
 * - Shout-to across the chasm: by eaglepeak_nickolaus_chat (Transcript variants); its reach is the ledge's.
 * - Giant feathers: one eagle feather a click (human_pickupfloor).
 * - The eagle (1490, 2007,4954): Walk-past with the disguise is a four-tile walk through it with the
 *   sidestep animations, its line on arrival (t2002-2006); without, the swipe (t1993, t2804).
 * - The stone door (19843 2003,4947 by 3099; 19991 2003,4948 by 3106): locked, its box and the locked sound;
 *   feathers go into its engraving; once the gold and bronze (3106 = 3) and silver (3099 = 6) are in, the
 *   last one sets 20. Open then swaps the leaf for its open one over an invisible wall for two ticks while the
 *   player steps across (t1947, t2061).
 * - The way out (19891, 1993,4983,3): "You enter the tunnel." and the cliff (2328,3496); 25 becomes 30 the
 *   tick after (t2094).
 * - The feathered journal (10179): Read, the capture's pages (t1350-1363).
 */
module.exports = function attachEaglesPeakNest(api, ep) {
  const { state, TEXT } = ep;
  const { STAGE, VARBIT, CHAT, TRACK, ITEM, NPC, DOOR_GOLD, DOOR_BRONZE, DOOR_BOTH } = state;
  const { Location, ChatType, Animation, GameObject, ObjectManager, TaskManager, Task, CountdownTask, ItemDefinition,
    HitDamage, HitMask, ForceMovement, ForceMovementTask } = api.core;
  const { openBook, bookPagesFromSpreads } = require("../QuestRuntime");

  const LOC = Object.freeze({
    FEATHERS: 19922, DOOR_LOWER: 19843, DOOR_UPPER: 19991, DOOR_LOWER_OPEN: 19990, DOOR_UPPER_OPEN: 19992, INVISWALL: 38848,
    EXIT: 19891,
  });
  const DOOR_X = 2003;
  const DOOR_ROWS = Object.freeze({ 4947: { open: LOC.DOOR_LOWER_OPEN, face: 3 }, 4948: { open: LOC.DOOR_UPPER_OPEN, face: 1 } });
  const DOOR_OPEN_TICKS = 2;
  const SURFACE = Object.freeze([2328, 3496, 0]);
  const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";

  const SEQ = Object.freeze({ PICK_UP: 827, WAVE: 863, SIDESTEP_IN: 752, SIDESTEP_OUT: 758, SIDESTEP_IN_LEFT: 753, SIDESTEP_OUT_LEFT: 759 });
  const SOUND = Object.freeze({ LOCKED: 2402, PLACE_FEATHER: 1513, PLACE_RUMBLE: 1512, STONE_DOOR: 86, SIDESTEP: 2485,
    EAGLE_ATTACK: 421, FALL_LAND: 2455, BLOCK: 511, HIT: 520 });

  /** The ledge the meeting starts from (2006,4973 at t308) and where the player and Nickolaus walk to. */
  const MEETING = Object.freeze({
    zone: { minX: 2000, maxX: 2008, minY: 4966, maxY: 4973, levels: [3] },
    playerTo: [2004, 4967, 3], nickolausTo: [2006, 4961, 3],
    camera: { move: [2013, 4966, 825], look: [2006, 4971, 75], lookTo: [2006, 4964, 75] },
    nickolausWalkAt: 5, waveAt: 8, holdTicks: 8,
  });
  const MEETING_LINE = "Hello? Er... excuse me?";
  const MEETING_LINE_AGAIN = "Hello?  Er... excuse me?";

  /** The eagle's tile (size 3) and the walk past it on x 2007 (t2000-2006). */
  const EAGLE_COLUMN = 2007;
  const EAGLE_SOUTH = 4953;
  const EAGLE_NORTH = 4957;
  /**
   * The swipe without the disguise (t1993, and rsprox 2821): stumble back two tiles facing the eagle as it attacks,
   * sounds 421 and 2455; a tick later the hit and the box. Recorded hits were 2 (t1994) and 0 (t2805, rsprox 2821);
   * the Wiki says "a small amount of damage" with no figure, so 0-2 is Ours.
   */
  const SWIPE = { playerSeq: 5206, playerSeqDelay: 24, eagleSeq: 5281, back: 2, endCycle: 46, maxHit: 2 };

  const V = Object.freeze({
    APPROACH: "nickolaus-s-camp-approaching-nickolaus-across-the-chasm",
    SHOUT: "nickolaus-s-camp-shouting-at-nickolaus",
    AFTER_AGREEING: "nickolaus-s-camp-visiting-nickolaus-after-agreeing-to-help-him",
    NOT_WEARING: "bringing-over-the-outfit-to-nickolaus-talking-to-nickolaus-while-not-wearing-the-eagle-outfit",
    WEARING: "bringing-over-the-outfit-to-nickolaus-talking-to-nickolaus-while-wearing-the-eagle-outfit",
  });

  /** The Journal of Arthur Artimus, as live sends it (t1350-1363). */
  const JOURNAL = Object.freeze({
    title: "The Journal of Arthur Artimus.",
    spreads: [
      [["We're all set for the raid on", "the Gnome Stronghold", "tomorrow.  They must have", "something good in a place",
        "that well defended.  We'll", "sneak in over the west river", "while the gnomes are", "watching some big 'gnome",
        "ball' match, whatever that is. ", "This time Armen won't be", "bringing his pet kebbit.  That", "thing caused nothing but",
        "trouble last time.", " ", "The start to the so called"],
      ["'gnome ball' match appears to", "have been delayed; some sort", "of rubbish about bad light.", "Looks like we're stuck waiting",
        "here for now.", " ", "I'm going to kill Armen, he", "assured me his kebbit was", "tied up safely.  We were",
        "lucky to escape with our lives,", "especially Davey who got his", "foot caught in a rabbit hole", "whilst we were running",
        "away.  Those long eared", "pests seem to get"]],
      [["everywhere.  Currently", "hiding in a cave in the", "mountains.  The only 'loot'", "we managed to grab was a",
        "bag of refreshments from the", "gnome ball pitch.  There'd", "better be something good in", "there, I could eat a camel",
        "right now.", " ", "Gnomes are still looking for", "us outside, might be in here", "for a while.  Fortunately this",
        "cave system seems to go a", "lot deeper than we originally"],
      ["thought, although some of the", "noises coming from the", "darker areas concern me", "slightly. Barakur has been",
        "playing with mechanisms as", "per usual. He thinks he can", "rig up something to hide the", "cave entrance.  Is this what",
        "dwarves do when they get", "bored? Armen said he saw", "some kind of giant bird. I'm", "skeptical, although this place",
        "does give me the creeps.", " ", "Gnome food again today."]],
      [["Worms, however they're", "cooked, get boring after a", "while.", " ", "Okay, we all saw the birds", "this time. Typically Armen",
        "insists he can tame them; that", "guy is animal crazy.", " ", "Gnomes seem to have stopped", "looking for us, although with",
        "Barakur's hidden entrance", "this would be a good place to", "stash loot.", " "],
      ["Armen tried roping one of", "the eagles today; got dragged", "halfway to Al Kharid", "apparently. Barakur seems to",
        "have taken the hideout idea to", "heart and is now designing", "an inner door.", " ", "A mysterious old man turned",
        "up today. Not sure how he", "got in. Kept pestering us", "until eventually Davey spoke", "to him, at which point he",
        "offloaded a load of spinach", "rolls onto us then left."]],
      [[" ", "Grief Barakur's door design", "is contrived; not sure I'll be", "able to open it myself.", "However, Armen still insists",
        "that we'll be able to use the", "eagles to get in and out.", " ", "First attempt at using the", "eagles in a raid today. Gave",
        "me the fright of my life. ", "Armen guided the eagle over", "Ardougne market; managed", "to catch some loaves with a",
        "fishing net. We'll be eating"],
      ["well tonight, at least compared", "to recently.", " ", "Barakur has completed two of", "apparently three parts of the",
        "puzzle for his second door.", "I'm sure he'd be making", "quicker progress if Armen's", "kebbit didn't keep getting in",
        "the way.", " ", "That mysterious old man has", "turned up again.  We don't", "have time for this, quite",
        "frankly, so we're just going"]],
      [["to ignore him, after all what", "could he possibl..."], []],
    ],
  });

  const stage = (player) => state.stage(player);
  const chat = (player) => state.get(player, VARBIT.NICKOLAUS_CHAT);
  const tile = ([x, y, z]) => new Location(x, y, z);
  const meetings = new WeakMap();

  // ==========================================================================
  // Meeting Nickolaus across the chasm
  // ==========================================================================

  function nickolausNest() {
    for (const npc of api.core.World.getNpcs()) {
      if (npc?.getId?.() === NPC.NICKOLAUS_NEST) return npc;
    }
    return null;
  }

  function startMeeting({ player }) {
    if (stage(player) !== STAGE.CAVE_OPEN || chat(player) !== 0 || meetings.has(player)) return;
    if (player.getDialogueManager().isActive?.()) return;
    const nickolaus = nickolausNest();
    state.set(player, VARBIT.NICKOLAUS_CHAT, CHAT.SPOTTED);
    const scene = { nickolaus, holding: true };
    meetings.set(player, scene);
    const sender = player.getPacketSender();
    const { move, look, lookTo } = MEETING.camera;
    sender.sendCameraMoveTo(move[0], move[1], move[2], { rate: 0, rate2: 100 }).sendCameraLookAt(look[0], look[1], look[2], { rate: 0, rate2: 100 });
    ep.later(player, 1, () => sender.sendCameraLookAt(lookTo[0], lookTo[1], lookTo[2], { rate: 1, rate2: 10 }));
    const queue = player.getMovementQueue();
    queue.reset();
    queue.addSteps(tile(MEETING.playerTo));
    ep.later(player, MEETING.nickolausWalkAt, () => nickolaus?.getMovementQueue?.().addCheckpoint?.(tile(MEETING.nickolausTo)));
    ep.later(player, MEETING.waveAt, () => {
      ep.animate(nickolaus, SEQ.WAVE);
      nickolaus?.setPositionToFace?.(player.getLocation());
      player.setPositionToFace?.(tile(MEETING.nickolausTo));
    });
    ep.later(player, MEETING.holdTicks + 1, () => {
      sender.sendCameraReset();
      meetings.delete(player);
    });
    ep.play(player, V.APPROACH, NPC.NICKOLAUS_NEST, nickolaus);
  }

  /** The meeting's first line is held (no continue) and stands in for the second (t309-317). */
  function meetingLine(request) {
    const scene = meetings.get(request.player);
    if (!scene) return;
    if (request.text === MEETING_LINE && scene.holding) {
      scene.holding = false;
      request.holdTicks = MEETING.holdTicks;
      request.speakerId = NPC.NICKOLAUS_NEST;
      return;
    }
    if (request.text === MEETING_LINE_AGAIN) {
      request.skip = true;
    }
  }

  // ==========================================================================
  // Shout-to
  // ==========================================================================

  /** Eight tiles across from the walkable entrance ledge (1998,4955); his wandering adds to it. */
  const NEST_TILE = Object.freeze([2006, 4959, 3]);
  const SHOUT_RANGE = 8;
  const NEST_RADIUS = 5;

  /** Shouting crosses the chasm; other options keep ordinary walking reach. */
  function routeShout(request) {
    if (request.npcId !== NPC.NICKOLAUS_SHOUT
      || request.definition?.getActions?.()[request.clickType - 1] !== "Shout-to") return;
    const at = request.npc.getLocation();
    const nestDistance = Math.max(Math.abs(at.getX() - NEST_TILE[0]), Math.abs(at.getY() - NEST_TILE[1]));
    if (stage(request.player) !== STAGE.CAVE_OPEN || nestDistance > NEST_RADIUS
      || at.getZ() !== NEST_TILE[2] || request.player.getLocation().getZ() !== NEST_TILE[2]) return;
    request.range = SHOUT_RANGE + nestDistance;
    request.ignoreProjectileClip = true;
  }

  function shoutVariant(player) {
    const talked = chat(player);
    if (talked < CHAT.TALKED) return V.APPROACH;
    if (talked === CHAT.TALKED) return V.SHOUT;
    if (talked < CHAT.COSTUMES_MADE) return V.AFTER_AGREEING;
    const npcs = ep.npcs;
    if (npcs?.wearingDisguise(player)) return V.WEARING;
    if (npcs?.spareDisguise(player)) return V.NOT_WEARING;
    return V.AFTER_AGREEING;
  }

  function shout(event) {
    const id = event.definition?.getId?.() ?? event.npcId;
    if (id !== NPC.NICKOLAUS_SHOUT && event.npcId !== NPC.NICKOLAUS_NEST) return false;
    const { player } = event;
    if (stage(player) !== STAGE.CAVE_OPEN) return false;
    if (chat(player) === 0) state.set(player, VARBIT.NICKOLAUS_CHAT, CHAT.SPOTTED);
    ep.play(player, shoutVariant(player), NPC.NICKOLAUS_SHOUT, event.npc);
    return true;
  }

  // ==========================================================================
  // Feathers, the eagle
  // ==========================================================================

  function takeFeathers(event) {
    if (event.objectId !== LOC.FEATHERS) return false;
    const { player } = event;
    const stackable = ItemDefinition.forId(ITEM.EAGLE_FEATHER)?.isStackable?.() === true;
    if (player.getInventory().isFull() && !(stackable && state.held(player, ITEM.EAGLE_FEATHER))) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    ep.animate(player, SEQ.PICK_UP);
    player.getInventory().adds(ITEM.EAGLE_FEATHER, 1);
    return true;
  }

  function walkPastEagle(event) {
    if ((event.npc?.getId?.() ?? event.npcId) !== NPC.EAGLE) return false;
    const { player } = event;
    if (ep.npcs?.wearingDisguise(player)) sidestep(player);
    else swipe(player, event.npc);
    return true;
  }

  /**
   * A crossing that walks over collision (the eagle, the door's wall): the flag the player had before is kept here and
   * put back when the walk ends or the player logs out, so a save never holds the crossing's flag (player flags are saved).
   */
  const crossings = new WeakMap();
  const WALK_ONLY_SOURCE = "eagles-peak:sidestep";

  /** busy (12393): live sets it for the crossing (t2001-2007, t2046-2052). */
  const BUSY_VARBIT = 12393;

  function beginCrossing(player) {
    if (!crossings.has(player)) crossings.set(player, player.hasFlag?.(IGNORE_CLIPPING_FLAG) === true);
    player.setFlag?.(IGNORE_CLIPPING_FLAG, true);
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  }

  /** Still on the crossing: same plane, within its four tiles (a teleport or a death ends it). */
  function onCrossing(now, to) {
    return now.getZ() === to.getZ() && Math.max(Math.abs(now.getX() - to.getX()), Math.abs(now.getY() - to.getY())) <= 4;
  }

  /** Clicks in the world are dropped while crossing, as live's busy state holds the player (t2001-2007). */
  function holdInput(input) {
    if (input?.player && crossings.has(input.player)) input.handled = true;
  }

  function endCrossing(player) {
    if (!crossings.has(player)) return;
    if (!crossings.get(player)) player.removeFlag?.(IGNORE_CLIPPING_FLAG);
    crossings.delete(player);
    player.setWalkOnly?.(WALK_ONLY_SOURCE, false);
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
  }

  /** Four tiles through the eagle, one a tick, its line and the step out on arrival (t2002-2006, t2047-2051). */
  function sidestep(player) {
    const here = player.getLocation();
    const north = here.getY() < EAGLE_SOUTH + 2;
    const from = new Location(EAGLE_COLUMN, north ? EAGLE_SOUTH : EAGLE_NORTH, here.getZ());
    const to = new Location(EAGLE_COLUMN, north ? EAGLE_NORTH : EAGLE_SOUTH, here.getZ());
    beginCrossing(player);
    // A tile a tick whatever the run setting (t2002-2005).
    player.setWalkOnly?.(WALK_ONLY_SOURCE, true);
    const queue = player.getMovementQueue();
    queue.reset();
    if (!here.equals(from)) queue.addSteps(from);
    queue.addSteps(to);
    player.getPacketSender().sendSoundEffect(SOUND.SIDESTEP, 4, 0, 255);
    ep.animate(player, north ? SEQ.SIDESTEP_IN : SEQ.SIDESTEP_IN_LEFT);
    let limit = 12;
    const task = new Task(1, false);
    task.execute = () => {
      const now = player.getLocation();
      const arrived = now.getX() === to.getX() && now.getY() === to.getY();
      if (!arrived && !onCrossing(now, to)) {
        task.stop();
        queue.reset();
        endCrossing(player);
        return;
      }
      if (!arrived && --limit > 0 && player.isRegistered?.() !== false) {
        // The crossing holds the player (live's busy varbit, t2001-2007): a click cannot leave them in the eagle.
        queue.reset();
        queue.addSteps(to);
        return;
      }
      task.stop();
      endCrossing(player);
      if (!arrived) return;
      ep.animate(player, north ? SEQ.SIDESTEP_OUT : SEQ.SIDESTEP_OUT_LEFT);
      player.sendMessage(TEXT.EAGLE_PASSED);
    };
    TaskManager.submit(task);
  }

  function swipe(player, eagle) {
    const sender = player.getPacketSender();
    ep.animate(eagle, SWIPE.eagleSeq);
    player.performAnimation(new Animation(SWIPE.playerSeq, SWIPE.playerSeqDelay));
    // Back away from the eagle on the player's own side (both recordings were from the south: t1993, t2804).
    const north = player.getLocation().getY() >= EAGLE_NORTH;
    TaskManager.submit(new ForceMovementTask(player, 2,
      new ForceMovement(player.getLocation().clone(), new Location(0, north ? SWIPE.back : -SWIPE.back), 0, SWIPE.endCycle, north ? 2 : 0, -1)));
    sender.sendSound(SOUND.EAGLE_ATTACK, 1, 0);
    sender.sendSound(SOUND.FALL_LAND, 1, 5);
    TaskManager.submit(new (class extends Task {
      constructor() { super(1, player, false); }
      execute() {
        this.stop();
        const damage = Math.floor(Math.random() * (SWIPE.maxHit + 1));
        player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
        sender.sendSound(damage > 0 ? SOUND.HIT : SOUND.BLOCK, 1, 20);
        ep.mesbox(player, TEXT.EAGLE_SWIPE);
      }
    })());
  }

  // ==========================================================================
  // The stone door
  // ==========================================================================

  const isDoor = (event) => event.objectId === LOC.DOOR_LOWER || event.objectId === LOC.DOOR_UPPER;

  function doorUnlocked(player) {
    return state.get(player, VARBIT.DOOR) === DOOR_BOTH && state.get(player, VARBIT.TRACKING) === TRACK.IN_DOOR;
  }

  function openDoor(event) {
    if (!isDoor(event)) return false;
    const { player } = event;
    if (!doorUnlocked(player)) {
      player.getPacketSender().sendSound(SOUND.LOCKED, 1, 0);
      ep.mesbox(player, TEXT.DOOR_LOCKED);
      return true;
    }
    const at = event.object?.getLocation?.() ?? event.location;
    const y = at?.getY?.() ?? at?.y ?? player.getLocation().getY();
    passDoor(player, DOOR_ROWS[y] ? y : player.getLocation().getY());
    return true;
  }

  const doorLocs = new Map();

  function wallLoc(id, x, y, z, face) {
    return new GameObject(id, new Location(x, y, z), 0, face, null);
  }

  /** The open leaf over an invisible wall for two ticks (t1947-1949), the player's step across with it. */
  function passDoor(player, y) {
    const row = DOOR_ROWS[y] ?? DOOR_ROWS[4948];
    const z = player.getLocation().getZ();
    const key = `${y}`;
    if (!doorLocs.has(key)) {
      const closed = wallLoc(y === 4947 ? LOC.DOOR_LOWER : LOC.DOOR_UPPER, DOOR_X, y, z, 0);
      const open = [wallLoc(LOC.INVISWALL, DOOR_X, y, z, 0), wallLoc(row.open, DOOR_X - 1, y, z, row.face)];
      ObjectManager.deregister(closed, true);
      for (const object of open) ObjectManager.register(object, true);
      doorLocs.set(key, open);
      player.getPacketSender().sendSound(SOUND.STONE_DOOR, 1, 0);
      TaskManager.submit(new CountdownTask(doorLocs, DOOR_OPEN_TICKS, () => {
        for (const object of doorLocs.get(key) ?? []) ObjectManager.deregister(object, true);
        doorLocs.delete(key);
        ObjectManager.register(closed, true);
      }));
    }
    const here = player.getLocation();
    const destination = new Location(here.getX() >= DOOR_X ? DOOR_X - 1 : DOOR_X, y, z);
    beginCrossing(player);
    const queue = player.getMovementQueue();
    queue.reset();
    queue.addSteps(destination);
    let ticks = DOOR_OPEN_TICKS + 1;
    const task = new Task(1, false);
    task.execute = () => {
      const now = player.getLocation();
      if ((now.getX() === destination.getX() && now.getY() === destination.getY()) || --ticks <= 0 || player.isRegistered?.() === false
        || !onCrossing(now, destination)) {
        task.stop();
        endCrossing(player);
        return;
      }
      // Only the step across is walked without collision; a click in between does not take that with it.
      queue.reset();
      queue.addSteps(destination);
    };
    TaskManager.submit(task);
  }

  /** The feathers' places: gold and bronze in 3106 (1, 2), silver as 3099's last value. */
  function placed(player, itemId) {
    if (itemId === ITEM.GOLDEN_FEATHER) return (state.get(player, VARBIT.DOOR) & DOOR_GOLD) !== 0;
    if (itemId === ITEM.BRONZE_FEATHER) return (state.get(player, VARBIT.DOOR) & DOOR_BRONZE) !== 0;
    return state.get(player, VARBIT.TRACKING) === TRACK.IN_DOOR;
  }

  function place(player, itemId) {
    if (itemId === ITEM.GOLDEN_FEATHER) state.set(player, VARBIT.DOOR, state.get(player, VARBIT.DOOR) | DOOR_GOLD);
    else if (itemId === ITEM.BRONZE_FEATHER) state.set(player, VARBIT.DOOR, state.get(player, VARBIT.DOOR) | DOOR_BRONZE);
    else state.set(player, VARBIT.TRACKING, TRACK.IN_DOOR);
  }

  function featherOnDoor(event) {
    if (!isDoor(event)) return false;
    const { player, itemId } = event;
    if (doorUnlocked(player) || placed(player, itemId)) {
      ep.mesbox(player, TEXT.DOOR_COMPLETE);
      return true;
    }
    player.getInventory().deleteNumber(itemId, 1);
    place(player, itemId);
    const sender = player.getPacketSender();
    sender.sendSound(SOUND.PLACE_FEATHER, 1, 0);
    if (doorUnlocked(player)) {
      if (stage(player) === STAGE.CAVE_OPEN) state.setStage(player, STAGE.DOOR_OPEN);
      sender.sendSound(SOUND.PLACE_RUMBLE, 1, 0);
      ep.mesbox(player, TEXT.DOOR_LAST_FEATHER);
      return true;
    }
    ep.mesbox(player, TEXT.DOOR_FEATHER);
    return true;
  }

  function metalFeatherOnDoor(event) {
    if (!isDoor(event)) return false;
    ep.mesbox(event.player, TEXT.DOOR_METAL_FEATHER);
    return true;
  }

  function eagleFeatherOnDoor(event) {
    if (!isDoor(event)) return false;
    ep.mesbox(event.player, TEXT.DOOR_EAGLE_FEATHER);
    return true;
  }

  // ==========================================================================
  // The way out, the journal
  // ==========================================================================

  function exitCave(event) {
    if (event.objectId !== LOC.EXIT) return false;
    const { player } = event;
    player.getPacketSender().sendTypedMessage(ChatType.SPAM, TEXT.TUNNEL);
    player.moveTo(tile(SURFACE));
    if (stage(player) === STAGE.DISGUISE_GIVEN) {
      ep.later(player, 1, () => { if (stage(player) === STAGE.DISGUISE_GIVEN) state.setStage(player, STAGE.LEFT_NEST); });
    }
    return true;
  }

  function readJournal({ player }) {
    openBook(player, JOURNAL.title, bookPagesFromSpreads(JOURNAL.spreads));
    return true;
  }

  api.onZoneEnter(MEETING.zone, startMeeting);
  api.onCustomEvent("npc-dialogue:line", meetingLine);
  api.onNpcRoute(routeShout);
  api.onNpcInteraction("Nickolaus", { "Shout-to": shout });
  api.onNpcInteraction("Eagle", { "Walk-past": walkPastEagle });
  api.onObjectInteraction("Giant feathers", { Take: takeFeathers });
  api.onObjectInteraction("Stone door", { Open: openDoor });
  api.onObjectInteraction("Cave entrance", { Exit: exitCave });
  for (const name of ["Golden feather", "Silver feather", "Bronze feather"]) api.onItemOnObject(name, "Stone door", featherOnDoor);
  api.onItemOnObject("Metal feather", "Stone door", metalFeatherOnDoor);
  api.onItemOnObject("Eagle feather", "Stone door", eagleFeatherOnDoor);
  api.onItemAction("Feathered journal", { Read: readJournal });
  api.onPlayerLogout(({ player }) => endCrossing(player));
  api.onCustomEvent("player:world-input", holdInput);

  return { LOC, JOURNAL, doorUnlocked, walkPastEagle, swipe, sidestep, startMeeting, routeShout };
};
