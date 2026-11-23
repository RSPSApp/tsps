/**
 * Darkness of Hallowvale: Errands unit (stages 80-180), as the live capture plays it (rsprox,
 * revision 242; ticks are the capture's).
 *
 * - Vertida (world NPC 3773, multinpc 8220) for IN_HIDEOUT..<SENT_BACK: her message 9633 in
 *   objectbox 193 and 90 on the same tick (t2939); re-issues of a lost message.
 * - The papyrus crates 17987 in the hideout (t2980-2995): human_pickuptable, one papyrus a search.
 * - Veliaf (world NPC 8277, multinpc 9489) for VERTIDA_MESSAGE..<SENT_BACK: the hand-in box and 100
 *   (t3181), 110 after "What do you want me to do?" (t3190), and 180 on the line before "We must
 *   inform the Sanguinesti order..." (t4611).
 * - Drezel (world NPC 9805, multinpc 9636): 120 and the bush varbit 2591 before "Ivan mentioned..."
 *   whatever the player picks after it (t3460), the runes in objectbox_double 11 and 140 (t3717),
 *   and his later talks.
 * - The Paterdomus bush 18121 (-> 17989 at 2591 = 1) and the werewolf scene in its 4x4 copy
 *   (t3574-3625): camera, fades, werewolves 3825/3826 (3825 -> 3827), the knockout, Morytanian
 *   Mystery, 2591 = 0 on the last line, 130 at the teardown.
 * - King Roald (5215) and Aeonisig (3774): 150 on the mercenary-protocol line (t4020), 160 on the
 *   teleport offer (t4167), Aeonisig's teleother and 170 on landing at 3421,9888,0 (t4175-4181).
 *
 * The NPCs are the world spawns live used (npc-spawns.json: 3773, 8277, 9805, 5215, 3774); this unit
 * spawns no copies of its own.
 */
const { createQuestScenes } = require("../QuestScenes");

module.exports = function attachErrands(context) {
  const { api, state, common, requirements, STAGE, VARBIT, PAGE } = context;
  const { ItemIdentifiers: I, NpcIdentifiers: N, Location, World, Item } = api.core;

  // ---------------------------------------------------------------------------
  // Ids (cache gamevals)
  // ---------------------------------------------------------------------------

  const ITEM = Object.freeze({
    MESSAGE: I.MESSAGE_2, // 9633 sang_veliaf_message
    PAPYRUS: I.PAPYRUS, // 970
    LAW: I.LAW_RUNE, // 563
    AIR: I.AIR_RUNE, // 556
    FIRE: I.FIRE_RUNE, // 554
  });
  const NPC = Object.freeze({
    VERTIDA: N.VERTIDA_SEFALATIS, // 8220 (world 3773 sanguinesti_vertida_sefalatis resolves to it)
    WEREWOLF_1: N.SHADOWY_FIGURE, // 3825 myq_pt3_cutscene_werewolf_1
    WEREWOLF_2: N.SHADOWY_FIGURE_2, // 3826 myq_pt3_cutscene_werewolf_2
    WEREWOLF_3: N.SHADOWY_FIGURE_3, // 3827 myq_pt3_cutscene_werewolf_3
    AEONISIG: N.AEONISIG_RAISPHER, // 3774 myq3_aeonisig_roalds_advisor
  });
  const LOC = Object.freeze({
    PAPYRUS_CRATES: 17987, // myq3_hideout_papyrus_crates
    BUSH: 18121, // myq_pt3_cutscene_werewolf_bush (multiloc on 2591: 17988, 17989, -1)
    BUSH_SEARCH: 17989, // the searchable bush at 2591 = 1
    BUSH_WITHOUT_LEG: 17988, // myreque_bush_without_leg (t3591, in the copy)
  });
  const ANIM = Object.freeze({
    PICKUP_TABLE: 832, // human_pickuptable (t2983)
    WEREWOLF_ATTACK: 6536, // werewolf_update_attack (t3595)
    DEATH: 836, // human_death (t3598)
    TELEOTHER_CAST: 1818, // human_teleport_other_casting (t4176)
    TELEOTHER_IMPACT: 1816, // human_teleport_other_impact (t4177)
    RESET: -1,
  });
  const GFX = Object.freeze({
    STUNNED: 245, // stunned_thieving, height 124 (t3597)
    TELEOTHER_CAST: 343, // teleport_other_casting (t4176)
    TELEOTHER_IMPACT: 342, // teleport_other_impact, height 92 (t4177)
  });
  const SOUND = Object.freeze({
    WOLF_ATTACK: 909, WOLF_ATTACK_2: 910, STUNNED: 2727, HUMAN_DEATH: 512, // t3595-3599
    TELEPORT_ALL: 200, // sound_area, loops 1, range 10 (t4177)
  });
  const EXPRESSION = Object.freeze({
    WEREWOLF_ANGRY: 6550, // werewolf_update_angry_chathead (3827's lines)
    WOLF_QUIZZICAL: 6553, // lore_wolf_chathead_quizzical (3826's lines)
    SAD: 610, // chatsad1, "Ouch! My poor head!" (t3622)
  });
  const BUSY_VARBIT = 12393; // busy (t3583 -> t3625)
  const FOV_CLAMP_VARBIT = 4606; // fov_clamp (t3591)
  const DRAW_DISTANCE_OVERRIDE_VARBIT = 18141; // draw_distance_max_override (t3591)
  const AREASOUNDS_OVERRIDE_VARP = 5588; // areasounds_override = 1 (t3591)
  const AREASOUNDS_OPTION_VARP = 5589; // option_areasounds_override = 56 (t3591)
  const WEREWOLVES_MUSIC = 676; // midi "werewolves", track Morytanian Mystery (t3590)
  const BLACKOUT_INTERFACE = 453; // myq3_blackout, in overlay_atmosphere (t3601)
  const OVERLAY_ATMOSPHERE = (161 << 16) | 1; // the slot the fade overlay uses (QuestScenes)
  const TELEPORT_LANDING = Object.freeze([3421, 9888, 0]); // Paterdomus basement (t4180)
  const RUNES = Object.freeze([[ITEM.LAW, 1], [ITEM.AIR, 3], [ITEM.FIRE, 1]]); // t3717: one Varrock Teleport

  // ---------------------------------------------------------------------------
  // Transcript variants and steps ("Darkness of Hallowvale")
  // ---------------------------------------------------------------------------

  const V = Object.freeze({
    VERTIDA_FIRST: "sanguinesti-diplomacy-talking-to-vertida-sefalatis",
    VERTIDA_AGAIN: "sanguinesti-diplomacy-talking-to-vertida-sefalatis-again",
    VERTIDA_LOST: "sanguinesti-diplomacy-talking-to-vertida-again-after-losing-the-message",
    VERTIDA_NEW_TASKS: "misthalin-diplomacy-talking-to-vertida-sefalatis-after-receiving-new-tasks-from-veliaf-hurtz",
    VERTIDA_AFTER_ROALD: "misthalin-diplomacy-talking-to-vertida-sefalatis-after-talking-to-king-roald",
    VELIAF_WITH_MESSAGE: "sanguinesti-diplomacy-talking-to-veliaf-hurtz-with-the-message-from-vertida-sefalatis",
    VELIAF_WITHOUT_MESSAGE: "sanguinesti-diplomacy-talking-to-veliaf-hurtz-without-the-message-from-vertida-sefalatis",
    VELIAF_HANDED_IN: "misthalin-diplomacy-talking-to-veliaf-hurtz-after-handing-in-the-message",
    VELIAF_WEREWOLVES: "misthalin-diplomacy-talking-to-veliaf-hurtz-after-encountering-the-werewolves",
    VELIAF_AFTER_ROALD: "misthalin-diplomacy-talking-to-veliaf-hurtz-after-talking-to-king-roald",
    DREZEL_FIRST: "misthalin-diplomacy-talking-to-drezel",
    DREZEL_AGAIN: "misthalin-diplomacy-talking-to-drezel-again",
    DREZEL_WEREWOLVES: "misthalin-diplomacy-talking-to-drezel-after-encountering-the-werewolves",
    DREZEL_WEREWOLVES_AGAIN: "misthalin-diplomacy-talking-to-drezel-after-encountering-the-werewolves-talking-to-drezel-again",
    DREZEL_AFTER_ROALD: "misthalin-diplomacy-talking-to-drezel-after-talking-to-king-roald",
    DREZEL_SENT_BACK: "misthalin-diplomacy-talking-to-drezel-after-being-sent-to-inform-the-sanguinesti-myreque",
    BUSH: "misthalin-diplomacy-searching-the-bush-outside-paterdomus-temple",
    ROALD_BUSY: "misthalin-diplomacy-talking-to-king-roald",
    ROALD_WEREWOLVES: "misthalin-diplomacy-talking-to-king-roald-after-encountering-the-werewolves",
    ROALD_AGAIN: "misthalin-diplomacy-talking-to-king-roald-again",
  });
  const OWN_VARIANTS = new Set(Object.values(V));

  const STEP = Object.freeze({
    // Vertida's message (message steps) and its "receive" actions.
    MESSAGE_GIVEN: new Set(["V3ECPh", "5sp21e", "QVrbhO", "JmwM4H"]),
    MESSAGE_RECEIVE: new Set(["2nbZ9m", "ZsS1Zs"]),
    STILL_HAS_MESSAGE: "4QWhCs",
    LOST_MESSAGE: "SfVPkx",
    MESSAGE_HANDED: "ctOdo7",
    BUSH_SEARCHED: "oTtrXk",
    KNOCKED_OUT: "x6Upep",
    WEREWOLVES_DEPART: "T1AXPq",
    RUNES: "CvqNxO",
    TELEPORT: "K65B9f", // the first talk's offer: the message after "Prepare yourself for teleport!"
    TELEOTHER_CAST: "BuUg-I", // the "again" talk: Aeonisig's cast
    TELEOTHER_ARRIVE: "JESHYF",
    TELEPORTED_MESSAGE: "hc5XiM",
  });

  // Lines the stages hang on (the dump's own words, matched by their start).
  const LINE = Object.freeze({
    WHAT_DO_YOU_WANT: "What do you want me to do?", // 110 on its continue (t3190)
    HEY_WHAT_NOW: "Hey there. What should I do now?", // Ours: 110 for a save left at 100
    IVAN_MENTIONED: "Ivan mentioned that he heard some strange noises", // 120 + 2591 as it shows (t3460)
    MERCENARY: "I am sorry, but Aeonisig is my advisor", // 150 on its continue (t4020)
    TELEPORT_OFFER: "Well then, I must try to do something to satisfy you", // 160 on its continue (t4167)
    SOMEONE_ELSE: "What should we do now? There must be someone else", // 180 on its continue (t4611)
    TAKE_HIM: "Nah, we can't take", // the third werewolf line: camera and facing (t3608)
    OUCH: "Ouch! My poor head!", // control back on its continue (t3625)
  });
  const TELEPORT_OPTION = "Does your offer of a teleport still stand?";
  const SHADOWY_FIGURE = "Shadowy figure";
  /** Vertida's message's Inspect (Wiki: Transcript:Message (Vertida)). */
  const MESSAGE_INSPECT = "It's a short message from Vertida to Veliaf. It confirms that the Sanguinesti order of the"
    + " Myreque is operational, but in need of support.";

  // ---------------------------------------------------------------------------
  // The werewolf scene (t3574-3625)
  // ---------------------------------------------------------------------------

  const BUSH_SCENE = Object.freeze({
    name: "darkness-of-hallowvale-werewolves",
    // rebuild_region_v2 1601/1137: a 4x4 zone copy of x 3376-3407, y 3464-3495, unturned (t3591).
    sourceChunk: [422, 433],
    size: 4,
    bounds: [[3376, 3407, 3464, 3495, 0]],
    stand: [3390, 3479, 0], // the forced walk's end (t3584), the copy's arrival and the exit (t3621)
    playerFaces: [3390, 3484], // t3591, t3598
    searchFaces: [3390, 3481], // t3586
    searchCamera: [[3388, 3478, 250], [3391, 3481, 50], { rate: 25, rate2: 25 }], // t3586
    openCamera: [[3387, 3476, 300], [3390, 3479, 300]], // t3592
    lineCamera: [[3385, 3484, 475], [3390, 3479, 300]], // t3608
    bush: { id: LOC.BUSH_WITHOUT_LEG, x: 3390, y: 3480, type: 10, face: 0 }, // t3591
    wolves: [
      { id: NPC.WEREWOLF_1, at: [3390, 3477, 0], step: [3390, 3478, 0], direction: 1 }, // north (t3593)
      { id: NPC.WEREWOLF_2, at: [3389, 3477, 0], step: [3389, 3478, 0], direction: 2 }, // north-east
    ],
    wolvesFace: [3390, 3479],
    wolfOneLaterFaces: [3389, 3478], // t3601
  });
  // Ticks from arriving at the bush (t3582).
  const SEARCH_TICKS = Object.freeze({ BUSY: 1, BOX: 4, FADE_OUT: 8 });
  const SEARCH_BOX_HOLD = 5; // the box with no continue, t3586 -> the scene at t3591
  // Ticks from the scene's opening (t3591).
  const SCENE_TICKS = Object.freeze({
    CAMERA: 1, WOLVES: 2, ATTACK: 4, SECOND_SOUND: 5, STUNNED: 6, DEATH: 7, TRANSFORM: 8, BLACKOUT: 10,
  });
  // Ticks from the last werewolf line's continue (t3618).
  const TEARDOWN_TICKS = 3; // t3621
  const WAKE_TICKS = 4; // t3622
  const FADE_QUICK = 15; // script 948's cycles at t3590 and t3593 (the later fades take QuestScenes' 50)

  // Ticks from continuing "Prepare yourself for teleport!" (t4175).
  const TELEPORT_TICKS = Object.freeze({ CAST: 1, IMPACT: 2, LAND: 5, BOX: 6 });
  const AEONISIG_RANGE = 15; // Ours: the caster is the advisor in the throne room

  const Scenes = createQuestScenes(api, { onEnd: werewolfSceneEnded, recoveryAttribute: "darkness-of-hallowvale:werewolf-exit" });
  /** player -> the werewolf scene's actors while it plays. */
  const wolfScenes = new WeakMap();
  /** Players between the bush click and the scene (a second click does nothing). */
  const searching = new WeakSet();
  /** Players mid-teleother. */
  const teleporting = new WeakSet();

  const stage = (player) => state.stage(player);
  const within = (player, low, high) => state.within(player, low, high);

  function variantOf(event) {
    const entry = Array.isArray(event?.pages) ? event.pages.find((candidate) => candidate?.page === PAGE) : null;
    const variant = entry?.variants?.[0] ?? null;
    return OWN_VARIANTS.has(variant) ? variant : null;
  }

  const startsWith = (event, prefix) => String(event.step?.text ?? event.step?.player ?? event.text ?? "").startsWith(prefix);

  function give(player, itemId, amount = 1) {
    const inventory = player.getInventory();
    if (typeof inventory.forceAdd === "function") inventory.forceAdd(player, new Item(itemId, amount));
    else inventory.adds(itemId, amount);
  }

  function deleteAll(player, itemId) {
    const inventory = player.getInventory();
    const amount = inventory.getAmount(itemId);
    if (amount > 0) inventory.delete(itemId, amount);
  }

  // ---------------------------------------------------------------------------
  // Vertida (IN_HIDEOUT..<SENT_BACK)
  // ---------------------------------------------------------------------------

  function vertidaVariant(player) {
    const now = stage(player);
    if (now < STAGE.VERTIDA_MESSAGE) return V.VERTIDA_FIRST;
    if (now < STAGE.MESSAGE_DELIVERED) return common.held(player, ITEM.MESSAGE) ? V.VERTIDA_AGAIN : V.VERTIDA_LOST;
    if (now < STAGE.BACK_AT_PATERDOMUS) return V.VERTIDA_NEW_TASKS;
    return V.VERTIDA_AFTER_ROALD;
  }

  function talkVertida(event) {
    const { player, npcId, npc } = event;
    if (!within(player, STAGE.IN_HIDEOUT, STAGE.SENT_BACK - 1)) return false;
    return common.play(player, npcId, vertidaVariant(player), undefined, PAGE, npc);
  }

  /** Vertida's message: objectbox 193 with the item, the item and 90 on the box's own tick (t2939). */
  function messageGiven(event) {
    const { player } = event;
    if (!within(player, STAGE.IN_HIDEOUT, STAGE.VERTIDA_MESSAGE)) return;
    if (!common.held(player, ITEM.MESSAGE)) give(player, ITEM.MESSAGE);
    state.advance(player, STAGE.VERTIDA_MESSAGE);
    event.handled = true;
    event.box = { items: [ITEM.MESSAGE] };
  }

  // ---------------------------------------------------------------------------
  // The papyrus crates (t2980-2995)
  // ---------------------------------------------------------------------------

  function searchCrates(event) {
    if (event.objectId !== LOC.PAPYRUS_CRATES) return false;
    const { player } = event;
    const at = event.object?.getLocation?.() ?? (event.location ? new Location(event.location.x, event.location.y, event.location.z ?? 0) : null);
    if (at) player.setPositionToFace(at);
    // Ours: the capture never searched with a full inventory.
    if (common.freeSlots(player) <= 0) {
      common.message(player, "You don't have enough inventory space.");
      return true;
    }
    common.anim(player, ANIM.PICKUP_TABLE);
    player.getInventory().add(new Item(ITEM.PAPYRUS, 1));
    common.message(player, "You find some papyrus.");
    return true;
  }

  // ---------------------------------------------------------------------------
  // Veliaf (VERTIDA_MESSAGE..<SENT_BACK; the line that sets 180)
  // ---------------------------------------------------------------------------

  function veliafVariant(player) {
    const now = stage(player);
    if (now < STAGE.MESSAGE_DELIVERED) {
      return common.held(player, ITEM.MESSAGE) ? V.VELIAF_WITH_MESSAGE : V.VELIAF_WITHOUT_MESSAGE;
    }
    if (now < STAGE.WEREWOLVES_SEEN) return V.VELIAF_HANDED_IN;
    if (now < STAGE.BACK_AT_PATERDOMUS) return V.VELIAF_WEREWOLVES;
    return V.VELIAF_AFTER_ROALD;
  }

  function talkVeliaf(event) {
    const { player, npcId, npc } = event;
    if (!within(player, STAGE.VERTIDA_MESSAGE, STAGE.SENT_BACK - 1)) return false;
    if (requirements.tasteNeedsVeliafRod(player)) return false;
    return common.play(player, npcId, veliafVariant(player), undefined, PAGE, npc);
  }

  /** "You hand over the message to Veliaf.": objectbox 193, the item gone and 100 on its tick (t3181). */
  function messageHanded(event) {
    const { player } = event;
    if (!within(player, STAGE.VERTIDA_MESSAGE, STAGE.VERTIDA_MESSAGE)) return;
    event.handled = true;
    if (!common.held(player, ITEM.MESSAGE)) {
      // Ours: the message was dropped while Veliaf talked; the next talk asks for it.
      event.end = true;
      return;
    }
    deleteAll(player, ITEM.MESSAGE);
    state.advance(player, STAGE.MESSAGE_DELIVERED);
    event.box = { items: [ITEM.MESSAGE] };
  }

  // ---------------------------------------------------------------------------
  // Drezel
  // ---------------------------------------------------------------------------

  function drezelVariant(player) {
    const now = stage(player);
    if (now < STAGE.DREZEL_TALKED) return V.DREZEL_FIRST;
    if (now < STAGE.WEREWOLVES_SEEN) return V.DREZEL_AGAIN;
    if (now < STAGE.RUNES_GIVEN) return V.DREZEL_WEREWOLVES;
    if (now < STAGE.BACK_AT_PATERDOMUS) return V.DREZEL_WEREWOLVES_AGAIN;
    if (now < STAGE.SENT_BACK) return V.DREZEL_AFTER_ROALD;
    return V.DREZEL_SENT_BACK;
  }

  /** The dump opens some variants with an `unavailable` marker (a Wiki note); the talk itself follows it. */
  const withoutUnavailable = (steps) => steps.filter((step) => step?.type !== "unavailable");

  function talkDrezel(event) {
    const { player, npcId, npc } = event;
    if (!within(player, STAGE.SENT_TO_DREZEL, STAGE.COMPLETE - 1)) return false;
    return common.play(player, npcId, drezelVariant(player), withoutUnavailable, PAGE, npc);
  }

  /** "Drezel gives you some runes.": objectbox_double 11 (law, air), the runes and 140 on its tick (t3717). */
  function runesGiven(event) {
    const { player } = event;
    if (!within(player, STAGE.WEREWOLVES_SEEN, STAGE.WEREWOLVES_SEEN)) return;
    event.handled = true;
    const inventory = player.getInventory();
    const slots = RUNES.filter(([itemId]) => inventory.getAmount(itemId) === 0).length;
    if (common.freeSlots(player) < slots) {
      // Ours (kept from the old plugin): no runes, no stage, until there is room.
      common.message(player, "You don't have enough inventory space.");
      event.end = true;
      return;
    }
    for (const [itemId, amount] of RUNES) inventory.adds(itemId, amount);
    state.advance(player, STAGE.RUNES_GIVEN);
    event.box = { items: [ITEM.LAW, ITEM.AIR] };
  }

  // ---------------------------------------------------------------------------
  // The bush and the werewolf scene
  // ---------------------------------------------------------------------------

  function searchBush(event) {
    if (event.objectId !== LOC.BUSH && event.objectId !== LOC.BUSH_SEARCH) return false;
    const { player } = event;
    if (stage(player) !== STAGE.DREZEL_TALKED || state.get(player, VARBIT.BUSH) !== 1) return false;
    if (searching.has(player) || wolfScenes.has(player)) return true;
    searching.add(player);
    player.getMovementQueue().reset();
    common.later(player, SEARCH_TICKS.BUSY, beginSearch);
    common.later(player, SEARCH_TICKS.BOX, showSearchBox);
    common.later(player, SEARCH_TICKS.FADE_OUT, fadeIntoScene);
    return true;
  }

  /** t3583: busy, and the forced walk to the tile south-west of the bush (t3583-3584). */
  function beginSearch(player) {
    if (!searching.has(player)) return;
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
    Scenes.walk(player, BUSH_SCENE.stand);
  }

  /** t3586: the camera on the bush and the box with no continue, which moves on by itself. */
  function showSearchBox(player) {
    if (!searching.has(player)) return;
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.face(player, BUSH_SCENE.searchFaces);
    const [move, look, rates] = BUSH_SCENE.searchCamera;
    common.camera(player, move, look, rates);
    common.play(player, NPC.WEREWOLF_3, V.BUSH, withoutUnavailable, PAGE);
  }

  /** t3590: the fade out, the werewolves' music and its unlock. */
  function fadeIntoScene(player) {
    if (!searching.has(player)) return;
    Scenes.fade(player, true, FADE_QUICK);
    player.getPacketSender().sendSong?.(WEREWOLVES_MUSIC);
    api.emitCustomEvent("music:unlock-track", { player, trackId: WEREWOLVES_MUSIC });
  }

  function bushSearched(event) {
    if (!searching.has(event.player)) return;
    event.handled = true;
    event.box = { statement: true, holdTicks: SEARCH_BOX_HOLD, advance: true };
  }

  /** t3591: the copy, the cutscene state and the scene's steps; the talk carries on at the blackout. */
  function knockedOut(event) {
    const { player } = event;
    if (!searching.has(player)) return;
    event.handled = true;
    event.wait = (resume) => openWerewolfScene(player, resume);
  }

  function openWerewolfScene(player, resume) {
    searching.delete(player);
    const scene = Scenes.open(player, BUSH_SCENE.name, BUSH_SCENE.bounds, {
      canTeleport: () => false,
      musicTrack: WEREWOLVES_MUSIC,
    }, { instance: { sourceChunk: BUSH_SCENE.sourceChunk, size: BUSH_SCENE.size }, at: BUSH_SCENE.stand, exit: BUSH_SCENE.stand });
    const run = { scene, wolves: [] };
    wolfScenes.set(player, run);
    Scenes.controls(player, true, true);
    cinematicVars(player, true);
    Scenes.face(player, BUSH_SCENE.playerFaces);
    Scenes.loc(scene, BUSH_SCENE.bush);
    common.cameraReset(player);
    Scenes.hideTabs(player);
    Scenes.later(scene, SCENE_TICKS.CAMERA, () => {
      const [move, look] = BUSH_SCENE.openCamera;
      Scenes.camera(player, move, look, { rate: 100, rate2: 100 });
    });
    Scenes.later(scene, SCENE_TICKS.WOLVES, () => {
      Scenes.fade(player, false, FADE_QUICK);
      for (const wolf of BUSH_SCENE.wolves) {
        run.wolves.push(Scenes.actor(scene, wolf.id, wolf.at, BUSH_SCENE.wolvesFace, { direction: wolf.direction }));
      }
    });
    Scenes.later(scene, SCENE_TICKS.ATTACK, () => {
      BUSH_SCENE.wolves.forEach((wolf, index) => Scenes.walk(run.wolves[index], wolf.step));
      if (run.wolves[0]) common.anim(run.wolves[0], ANIM.WEREWOLF_ATTACK);
      common.sound(player, SOUND.WOLF_ATTACK);
      Scenes.fade(player, true);
    });
    Scenes.later(scene, SCENE_TICKS.SECOND_SOUND, () => common.sound(player, SOUND.WOLF_ATTACK_2));
    Scenes.later(scene, SCENE_TICKS.STUNNED, () => common.gfx(player, GFX.STUNNED, 124));
    Scenes.later(scene, SCENE_TICKS.DEATH, () => {
      common.anim(player, ANIM.DEATH);
      Scenes.face(player, BUSH_SCENE.playerFaces);
      common.sound(player, SOUND.STUNNED);
    });
    Scenes.later(scene, SCENE_TICKS.TRANSFORM, () => {
      run.wolves[0]?.setNpcTransformationId(NPC.WEREWOLF_3);
      common.sound(player, SOUND.HUMAN_DEATH);
    });
    Scenes.later(scene, SCENE_TICKS.BLACKOUT, () => {
      player.getPacketSender().mountSubInterface(OVERLAY_ATMOSPHERE, BLACKOUT_INTERFACE, 1);
      if (run.wolves[0]) Scenes.face(run.wolves[0], BUSH_SCENE.wolfOneLaterFaces);
      resume();
    });
  }

  /** fov_clamp, the draw-distance override and the area-sound override, as the scene holds them (t3591-3621). */
  function cinematicVars(player, active) {
    const sender = player.getPacketSender();
    sender.sendVarbit(FOV_CLAMP_VARBIT, active ? 1 : 0);
    sender.sendVarbit(DRAW_DISTANCE_OVERRIDE_VARBIT, active ? 1 : 0);
    sender.sendConfig(AREASOUNDS_OPTION_VARP, active ? 56 : 0);
    sender.sendConfig(AREASOUNDS_OVERRIDE_VARP, active ? 1 : 0);
  }

  /** A "Shadowy figure" line: 3827's or 3826's head, its chathead anim, and the third line's camera. */
  function werewolfLine(event) {
    const { player, step } = event;
    const second = /#2/.test(step.speaker);
    event.speakerId = second ? NPC.WEREWOLF_2 : NPC.WEREWOLF_3;
    event.speakerName = SHADOWY_FIGURE;
    event.expression = second ? EXPRESSION.WOLF_QUIZZICAL : EXPRESSION.WEREWOLF_ANGRY;
    if (startsWith(event, LINE.TAKE_HIM)) {
      event.before = () => werewolvesLookBack(player);
      // The Wiki's transcript says "her"; live said "him" to a male character (t3608).
      if (player.getAppearance?.()?.isMale?.()) event.text = String(event.text ?? step.text).replace(/\bher\b/, "him");
    }
  }

  function werewolvesLookBack(player) {
    const run = wolfScenes.get(player);
    if (!run) return;
    const [move, look] = BUSH_SCENE.lineCamera;
    Scenes.camera(player, move, look, { rate: 100, rate2: 100 });
    for (const wolf of run.wolves) if (wolf) Scenes.face(wolf, BUSH_SCENE.wolvesFace);
  }

  /** t3618: 2591 = 0 and the fade on the last line's continue; the teardown and 130 three ticks on. */
  function werewolvesDepart(event) {
    const { player } = event;
    if (!wolfScenes.has(player)) return;
    event.handled = true;
    state.set(player, VARBIT.BUSH, 0);
    Scenes.fade(player, true);
    event.wait = (resume) => {
      common.later(player, TEARDOWN_TICKS, endWerewolfScene);
      common.later(player, WAKE_TICKS, (p) => wake(p, resume));
    };
  }

  function endWerewolfScene(player) {
    if (wolfScenes.has(player)) Scenes.end(player, false);
    state.advance(player, STAGE.WEREWOLVES_SEEN);
  }

  /** t3622: the player gets up as the screen comes back, then "Ouch! My poor head!". */
  function wake(player, resume) {
    common.anim(player, ANIM.RESET);
    Scenes.fade(player, false);
    resume();
  }

  function ouchLine(event) {
    const { player } = event;
    event.expression = EXPRESSION.SAD;
    event.after = () => player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
  }

  function werewolfSceneEnded(player, scene, logout) {
    if (scene.name !== BUSH_SCENE.name) return;
    wolfScenes.delete(player);
    searching.delete(player);
    if (!logout) {
      cinematicVars(player, false);
      Scenes.restoreTabs(player);
    }
    // Ours: a scene cut short after its last line (2591 already 0) still counts as seen, so the bush
    // (gone at 0) cannot leave the quest stuck at 120.
    if (stage(player) === STAGE.DREZEL_TALKED && state.get(player, VARBIT.BUSH) === 0) {
      state.advance(player, STAGE.WEREWOLVES_SEEN);
    }
  }

  // ---------------------------------------------------------------------------
  // King Roald and Aeonisig
  // ---------------------------------------------------------------------------

  function roaldVariant(player) {
    const now = stage(player);
    if (now < STAGE.RUNES_GIVEN) return V.ROALD_BUSY; // Ours: live talked to him only from 140
    if (now < STAGE.ROALD_REFUSED) return V.ROALD_WEREWOLVES;
    return V.ROALD_AGAIN;
  }

  function talkRoald(event) {
    const { player, npcId, npc } = event;
    if (!within(player, STAGE.SENT_TO_DREZEL, STAGE.BACK_AT_PATERDOMUS - 1)) return false;
    return common.play(player, npcId, roaldVariant(player), undefined, PAGE, npc);
  }

  /** Ours (not captured): Aeonisig answers as the king does once the king has refused. */
  function talkAeonisig(event) {
    const { player, npcId, npc } = event;
    if (!within(player, STAGE.ROALD_REFUSED, STAGE.BACK_AT_PATERDOMUS - 1)) return false;
    return common.play(player, npcId, V.ROALD_AGAIN, undefined, PAGE, npc);
  }

  /** At 150 the teleport has not been offered yet: live's menu had only the questions (t4127). */
  function handleMenu(notice) {
    const { player } = notice;
    if (!player || !Array.isArray(notice.options) || stage(player) >= STAGE.ROALD_TELEPORT) return;
    if (!notice.options.some((option) => option?.text === TELEPORT_OPTION)) return;
    if (!within(player, STAGE.ROALD_REFUSED, STAGE.ROALD_TELEPORT)) return;
    notice.options = notice.options.filter((option) => option?.text !== TELEPORT_OPTION);
  }

  function nearestAeonisig(player) {
    const here = player.getLocation();
    const near = World.getNpcsNear?.(here, AEONISIG_RANGE) ?? [];
    let best = null;
    for (const npc of near) {
      if (!npc?.isRegistered?.() || npc.getId() !== NPC.AEONISIG) continue;
      if (!best || here.getDistance?.(npc.getLocation()) < here.getDistance?.(best.getLocation())) best = npc;
    }
    return best;
  }

  /** t4175-4180: Aeonisig's teleother, then the landing west of Drezel and 170. */
  function teleother(player, onLanded) {
    if (teleporting.has(player)) return;
    teleporting.add(player);
    player.getMovementQueue().reset().setBlockMovement(true);
    const aeonisig = nearestAeonisig(player);
    if (aeonisig) aeonisig.setPositionToFace(player.getLocation());
    common.later(player, TELEPORT_TICKS.CAST, () => {
      if (!aeonisig?.isRegistered?.()) return;
      common.gfx(aeonisig, GFX.TELEOTHER_CAST);
      common.anim(aeonisig, ANIM.TELEOTHER_CAST);
    });
    common.later(player, TELEPORT_TICKS.IMPACT, (p) => {
      common.anim(p, ANIM.TELEOTHER_IMPACT);
      common.gfx(p, GFX.TELEOTHER_IMPACT, 92);
      const at = p.getLocation();
      p.getPacketSender().sendAreaSound(SOUND.TELEPORT_ALL, at.getX(), at.getY(), at.getZ(), 1, 0, 10);
    });
    common.later(player, TELEPORT_TICKS.LAND, (p) => {
      teleporting.delete(p);
      p.getMovementQueue().setBlockMovement(false);
      p.moveTo(new Location(...TELEPORT_LANDING));
      common.anim(p, ANIM.RESET);
      common.cameraReset(p);
      state.advance(p, STAGE.BACK_AT_PATERDOMUS);
    });
    if (onLanded) common.later(player, TELEPORT_TICKS.BOX, onLanded);
  }

  /** The first talk's offer: the chat closes, the teleother plays and the box comes after landing (t4181). */
  function teleportMessage(event) {
    const { player } = event;
    if (!within(player, STAGE.ROALD_TELEPORT, STAGE.ROALD_TELEPORT)) return;
    event.handled = true;
    event.box = { statement: true, delayTicks: TELEPORT_TICKS.BOX };
    teleother(player);
  }

  /** The "again" talk's cast: the talk waits for the landing, then its own message. */
  function teleotherCast(event) {
    const { player } = event;
    if (!within(player, STAGE.ROALD_TELEPORT, STAGE.ROALD_TELEPORT)) return;
    event.handled = true;
    event.wait = (resume) => teleother(player, () => resume());
  }

  // ---------------------------------------------------------------------------
  // Dialogue events
  // ---------------------------------------------------------------------------

  function handleLine(event) {
    const { player, step } = event;
    if (!player || !step) return;
    const variant = variantOf(event);
    if (!variant) return;
    // Live's head is the world NPC's own id (3773, 8277, 9805), which the client resolves itself.
    if (step.speaker && event.npc && step.speaker === event.definition?.getName?.()) event.speakerId = event.npc.getId();
    switch (variant) {
      case V.VELIAF_WITH_MESSAGE:
        if (startsWith(event, LINE.WHAT_DO_YOU_WANT)) event.after = () => state.advance(player, STAGE.SENT_TO_DREZEL);
        return;
      case V.VELIAF_HANDED_IN:
        if (startsWith(event, LINE.HEY_WHAT_NOW)) event.after = () => state.advance(player, STAGE.SENT_TO_DREZEL);
        return;
      case V.VELIAF_AFTER_ROALD:
        if (startsWith(event, LINE.SOMEONE_ELSE)) event.after = () => state.advance(player, STAGE.SENT_BACK);
        return;
      case V.DREZEL_FIRST:
      case V.DREZEL_AGAIN:
        if (startsWith(event, LINE.IVAN_MENTIONED)) event.before = () => drezelBriefs(player);
        return;
      case V.ROALD_WEREWOLVES:
      case V.ROALD_AGAIN:
        if (startsWith(event, LINE.MERCENARY)) event.after = () => roaldRefuses(player);
        else if (startsWith(event, LINE.TELEPORT_OFFER)) event.after = () => roaldOffers(player);
        return;
      case V.BUSH:
        if (String(step.speaker ?? "").startsWith(SHADOWY_FIGURE)) werewolfLine(event);
        else if (startsWith(event, LINE.OUCH)) ouchLine(event);
        return;
      default:
    }
  }

  /** t3460: 120 and the bush, before Drezel's "Ivan mentioned..." whatever is picked after it. */
  function drezelBriefs(player) {
    if (stage(player) !== STAGE.SENT_TO_DREZEL) return;
    state.advance(player, STAGE.DREZEL_TALKED);
    state.set(player, VARBIT.BUSH, 1);
  }

  function roaldRefuses(player) {
    if (stage(player) === STAGE.RUNES_GIVEN) state.advance(player, STAGE.ROALD_REFUSED);
  }

  function roaldOffers(player) {
    if (stage(player) === STAGE.ROALD_REFUSED) state.advance(player, STAGE.ROALD_TELEPORT);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId || !variantOf(event)) return;
    if (STEP.MESSAGE_GIVEN.has(stepId)) return messageGiven(event);
    if (STEP.MESSAGE_RECEIVE.has(stepId)) {
      // The item went with the box just before (the message step); this marker has nothing left to do.
      event.handled = true;
      return;
    }
    switch (stepId) {
      case STEP.MESSAGE_HANDED: return messageHanded(event);
      case STEP.RUNES: return runesGiven(event);
      case STEP.BUSH_SEARCHED: return bushSearched(event);
      case STEP.KNOCKED_OUT: return knockedOut(event);
      case STEP.WEREWOLVES_DEPART: return werewolvesDepart(event);
      case STEP.TELEPORT: return teleportMessage(event);
      case STEP.TELEOTHER_CAST: return teleotherCast(event);
      case STEP.TELEOTHER_ARRIVE:
        // The landing came with the cast's wait.
        event.handled = true;
        return;
      case STEP.TELEPORTED_MESSAGE:
        event.box = { statement: true };
        return;
      default:
    }
  }

  function answerCondition({ player, npcId, stepId }) {
    if (!player || npcId !== NPC.VERTIDA) return null;
    if (stepId === STEP.STILL_HAS_MESSAGE) return common.held(player, ITEM.MESSAGE);
    if (stepId === STEP.LOST_MESSAGE) return !common.held(player, ITEM.MESSAGE);
    return null;
  }

  /**
   * Inspect on Vertida's message (Wiki: Transcript:Message (Vertida), a tbox with the message's
   * picture; "Read" was renamed "Inspect" on 25 June 2020). Not captured; nothing else changes.
   */
  function inspectMessage({ player, itemId }) {
    if (itemId !== ITEM.MESSAGE) return false;
    common.itemBox(player, ITEM.MESSAGE, MESSAGE_INSPECT);
    return true;
  }

  function handleLogout({ player }) {
    if (!player) return;
    searching.delete(player);
    teleporting.delete(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.onNpcInteraction("Vertida Sefalatis", { "Talk-to": talkVertida });
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcInteraction("Drezel", { "Talk-to": talkDrezel });
  api.onNpcInteraction("King Roald", { "Talk-to": talkRoald });
  api.onNpcInteraction("Aeonisig Raispher", { "Talk-to": talkAeonisig });
  api.onObjectInteraction("Crate", { Search: searchCrates });
  api.onObjectInteraction("Bush", { Search: searchBush });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:menu", handleMenu);
  api.onItemAction("Message", { Inspect: inspectMessage });
  api.onPlayerLogout(handleLogout);
};
