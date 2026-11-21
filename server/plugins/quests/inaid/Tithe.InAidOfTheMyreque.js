/**
 * In Aid of the Myreque: Tithe (see ../quests/InAidOfTheMyreque.Quest.js for the unit map).
 *
 * Stages 210-280 as the live capture plays them (revision 242, the user's recording; capture ticks
 * in the comments, facts in docs/quests/in-aid-of-the-myreque):
 *
 * - The tinderbox on the fuelled furnace (12805 at varbit 1980=2) holds an item box, plays the
 *   fire-lighting animation and five ticks later lights it (1980=3, 220) and fades into the Castle
 *   Drakan scene: an instance with Vanstrom and Gadderanks, the scene's camera and music. Vanstrom's
 *   last line sets 230 and blood_tithe_visible (1981=1), which shows the tithe cast in the store
 *   (multinpcs 6216-6218 and 4479); back on the map Gabriela's line, then vampyre_aggression.
 * - The three chats (Gadderanks, a juvinate, Wiskit) set 1995/1997/1996; the third one chains into
 *   Gadderanks' challenge and the fight in a copy of the store (240).
 * - Every fallen foe counts in juvinate_deaths (1999): Gadderanks at 0 hitpoints is wounded (4485),
 *   not killed, and a juvinate turns to mist whoever landed the blow. Veliaf comes in five ticks after
 *   the first (250); the third sets 260 and opens the wounded Gadderanks' first lines.
 * - The wounded talk ends in "Gadderanks passes away." (280, 1981=2, out of the copy); Aurel hands
 *   over the warhammer (2004). Store Veliaf (4479 -> 9633) then heads back to the Hollows (1981=3).
 */
const { createQuestScenes } = require("../QuestScenes");
const { loadTranscripts } = require("../QuestRuntime");

const SCENE_EXIT_ATTRIBUTE = "in-aid-of-the-myreque:tithe-scene-exit";

// Transcript variants ("In Aid of the Myreque" page; "Aurel" page for his post-tithe talk).
const V = Object.freeze({
  LIGHTING: "entering-burgh-de-rott-fixing-the-furnace-lighting-the-furnace",
  CASTLE: "at-castle-drakan",
  CITIZENS: "gadderanks-arrives-at-burgh-de-rott-speaking-to-citizens-after-fixing-the-furnace",
  GADDERANKS: "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-gadderanks",
  JUVINATE: "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-vampyre-juvinate",
  WISKIT: "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-wiskit",
  ALL_THREE: "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-after-speaking-to-all-three",
  VELIAF: "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-veliaf",
});
const AUREL_PAGE = "Aurel";
const AUREL_V = Object.freeze({
  STANDARD: "standard-dialogue",
  LOST_HAMMER: "if-the-player-has-lost-the-gadderhammer",
  AFTER_BMR: "after-the-blood-moon-rises",
});
const STEP = Object.freeze({
  LIGHT_INTRO: "VKsO2x", NO_TINDERBOX: "iGHWLk", HAS_TINDERBOX: "hnlXcN", NEED_TINDERBOX: "QZ6zfD", LIT: "Z6tgH8",
  CASTLE_FADE_OUT: "KfBHp3",
  GADDERANKS_FIRST: "c4DZLI", GADDERANKS_AGAIN: "4mjtys", JUVINATE_FIRST: "a-RBs3", JUVINATE_AGAIN: "dV-Otl",
  ATTACK: "p2YbVD", ONE_DOWN: "3SyWCq", AFTERMATH: "s-bYSS", PASSES_AWAY: "GHoygq", HAMMER_GIVEN: "G9lEti",
  VELIAF_LEAVES: "OCv2XT",
  NOT_ENOUGH_COINS: "HxmbYb", ENOUGH_COINS: "Z1JkRV", HAMMER_BOUGHT: "6qLnJV",
});

// Animations, sounds, music (capture ticks).
const ANIM_CREATE_FIRE = 733; // human_createfire, t2202
const ANIM_DEATH_BACKWARDS = 837; // human_death_backwards, Gadderanks wounded t2415
const ANIM_MIST_DISAPPEAR = 1262; // mist_disappear, t2509
const SOUND_FIRE_LIT = 2596; // t2207
const SOUND_HUMAN_DEATH = 512; // t2415
const SOUND_DOOR_OPEN = 62; // t2421
const SOUND_DOOR_CLOSE = 60; // t2424
const MUSIC_STAGNANT = 241; // Castle Drakan scene, t2209
const MUSIC_VAMPYRE_ASSAULT = 678; // "vanstrom" = Vampyre Assault, the store fight, t2351
const CAMERA_RATES = Object.freeze({ rate: 100, rate2: 100 }); // t2211

const HAMMER_PRICE = 3000; // the Aurel page's recovery price

// The Castle Drakan scene (t2210): an instance of the castle, source chunk from the rebuild's zone.
const CASTLE = Object.freeze({
  sourceChunk: [440, 410],
  bounds: [[3540, 3590, 3320, 3360, 0]],
  at: [3572, 3331, 0],
  exit: [3526, 3209, 0], // t2276
  vanstrom: [3553, 3337], vanstromFace: [3553, 3336], // spawned facing south
  gadderanks: [3559, 3337], gadderanksFace: [3558, 3337], // facing west
  camera: [[3553, 3328, 1900], [3553, 3358, 450]],
});

// The store fight (t2351): a copy of the store.
const FIGHT = Object.freeze({
  sourceChunk: [433, 398],
  bounds: [[3509, 3519, 3239, 3246, 0]],
  at: [3514, 3239, 0],
  exit: [3514, 3237, 0], // Ours: outside the store door, where an escape or a logout comes back
  leave: [3512, 3241, 0], // t2599, after Gadderanks passes away
  gadderanks: [3513, 3241], gadderanksFace: [3514, 3240], // south-east
  juvinate1: [3513, 3240], juvinate1Face: [3514, 3239], // south-east
  juvinate2: [3515, 3242], juvinate2Face: [3515, 3241], // south
  wiskit: [3517, 3241], wiskitFace: [3517, 3240], // south
  door: { x: 3514, y: 3238, type: 0, face: 1 },
  blocker: { x: 3514, y: 3239, type: 0, face: 0 },
  veliafSpawn: [3514, 3237], veliafFace: [3514, 3238], // north, t2420
  veliafWalk: [3514, 3238], // t2421: one step north as the door opens
  veliafSteps: [[3514, 3239], [3514, 3240]], // t2422, t2424
});

/** Veliaf's overhead shouts in the fight (t2445-t2509); the first is the transcript's (3SyWCq). */
const VELIAF_SHOUTS = Object.freeze([
  "Let us slay these dogs!", "Fight on!", "Let's kill these fiends!", "You made a big mistake coming here!", "Take that!",
]);
const SHOUT_INTERVAL = 4; // every captured shout fell on Veliaf's 4-tick cycle from t2421
const SHOUT_CHANCE = 0.25; // Ours: 6 shouts in ~24 cycles of the capture

/** Burgh de Rott's citizens (cache names) who take the post-furnace citizen lines. */
const CITIZENS = Object.freeze([
  "Elisabeta", "Sorin", "Luscion", "Sergiu", "Radu", "Grigore", "Ileana", "Valeria", "Emilia", "Florin",
  "Catalina", "Victor", "Helena", "Teodor", "Gabriela", "Calin", "Mihail", "Nicoleta", "Simona", "Vasile",
  "Razvan", "Luminata",
]);

module.exports = function attachTithe(context) {
  const { api, state, common, STAGE, VARBIT, PAGE } = context;
  const { NpcIdentifiers, ItemIdentifiers, ObjectIdentifiers, Location, ItemStatementDialogue, StatementDialogue,
    DialogueChainBuilder, ActionDialogue } = api.core;

  const NPC = Object.freeze({
    VANSTROM: NpcIdentifiers.VANSTROM_KLAUSE_18, // 9632, route_vanstrom_vampire
    GADDERANKS_SCENE: NpcIdentifiers.GADDERANKS_4, // 9635, burgh_gadderanks_cutscene
    GABRIELA: NpcIdentifiers.GABRIELA, // 4461
    GADDERANKS: NpcIdentifiers.GADDERANKS, // 4483, the tithe multinpc 6218 at 1981=1
    GADDERANKS_FIGHT: NpcIdentifiers.GADDERANKS_2, // 4484, burgh_gadderanks_attackable
    GADDERANKS_WOUNDED: NpcIdentifiers.GADDERANKS_3, // 4485
    JUVINATE_TITHE_1: NpcIdentifiers.VAMPYRE_JUVINATE_13, // 4481, multinpc 6216
    JUVINATE_TITHE_2: NpcIdentifiers.VAMPYRE_JUVINATE_14, // 4482, multinpc 6217
    JUVINATE_FIGHT_1: NpcIdentifiers.VAMPYRE_JUVINATE_15, // 4486
    JUVINATE_FIGHT_2: NpcIdentifiers.VAMPYRE_JUVINATE_16, // 4487
    WISKIT: NpcIdentifiers.WISKIT, // 4480, multinpc 4479 at 1981=1
    WISKIT_FIGHT: NpcIdentifiers.WISKIT_2, // 9634, burgh_villager_blood_tithe_noop
    VELIAF_RESCUE: NpcIdentifiers.VELIAF_HURTZ, // 989, burgh_rescue_veliaf_hurtz
    VELIAF_STORE: NpcIdentifiers.VELIAF_HURTZ_14, // 9633, multinpc 4479 at 1981=2
    MIST: NpcIdentifiers.MIST_2, // 4435, burgh_juvinate_vampyre_misty
    AUREL: NpcIdentifiers.AUREL, // 4445
  });
  const ITEM = Object.freeze({
    TINDERBOX: ItemIdentifiers.TINDERBOX,
    GADDERHAMMER: ItemIdentifiers.GADDERHAMMER, // 7668
    COINS: ItemIdentifiers.COINS,
  });
  const LOC = Object.freeze({
    DOOR: ObjectIdentifiers.DOOR_307, // 12761 burgh_village_door (Escape, Quick-escape)
    DOOR_INACTIVE: ObjectIdentifiers.DOOR_27, // 12856 burgh_village_door_inactive
    INVISWALL: 38848, // inviswall (no identifier)
    BLOCKER: 32545, // invisible_type0_nonblocking (no identifier)
  });
  const FURNACE_TILE = new Location(3527, 3209, 0); // burgh_furnace_multiloc 12805

  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: SCENE_EXIT_ATTRIBUTE });
  /** player -> the store fight's state while its copy is open. */
  const fights = new WeakMap();
  /** fight actor -> its fight. */
  const actorFight = new WeakMap();
  /** player -> "challenge" | "reprise" while Gadderanks' challenge line plays. */
  const challengePhase = new WeakMap();

  const stage = (player) => state.stage(player);
  const varbit = (player, id) => state.get(player, id);
  const tile = (x, y, z = 0) => new Location(x, y, z);

  function transcriptSteps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }
  function aftermathSteps() {
    return transcriptSteps(V.ALL_THREE).find((step) => step.id === STEP.AFTERMATH)?.steps ?? [];
  }
  const passesAwayIndex = (steps) => steps.findIndex((step) => step.id === STEP.PASSES_AWAY);
  /** The transcript's overhead line for Veliaf's arrival (3SyWCq). */
  function veliafArrivalLine() {
    const step = transcriptSteps(V.ALL_THREE).find((entry) => entry.id === STEP.ONE_DOWN);
    return step?.steps?.[0]?.text ?? "";
  }

  function hasHammer(player) {
    const id = ITEM.GADDERHAMMER;
    if (player.getInventory().getAmount(id) > 0) return true;
    if (player.getEquipment?.()?.getAmount?.(id) > 0) return true;
    return (player.getBanks?.() ?? []).some((bank) => bank?.getAmount?.(id) > 0);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /**
   * The variant a dialogue line or action belongs to, when it is this page's. `pages` lists every page that reaches
   * the NPC, so the transcript being played (`playing`) decides first: Vanstrom's In Search of the Myreque talk is not
   * this page's castle scene (#6412).
   */
  function variantOf(event, page = PAGE) {
    if (event?.playing?.page) {
      if (event.playing.page !== page) return null;
      if (event.playing.variant) return event.playing.variant;
    }
    const entry = Array.isArray(event?.pages) ? event.pages.find((candidate) => candidate?.page === page) : null;
    return entry?.variants?.[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Lighting the furnace (t2202-t2207)
  // ---------------------------------------------------------------------------

  /** Players whose furnace is catching (the 5 ticks before 1980 = 3), so a second light is refused. */
  const lighting = new WeakSet();

  function canLight(player) {
    return stage(player) === STAGE.FURNACE_FIXED && varbit(player, VARBIT.FURNACE) === 2 && !Scenes.get(player)
      && !lighting.has(player);
  }

  /** The objectbox live holds while the fire catches: the tinderbox, no continue button (t2202). */
  function holdItemBox(player, itemId, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0, { execute: () => {
      ItemStatementDialogue.send(player, itemId, text);
      player.getPacketSender().sendClientScript(2868, "").sendInterfaceFlagsRange((193 << 16), 0, 1, 0);
    } }, true)));
  }

  function lightFurnace(player, text = "You light the furnace...") {
    if (!canLight(player)) return false;
    player.getMovementQueue().reset();
    player.setPositionToFace?.(FURNACE_TILE);
    holdItemBox(player, ITEM.TINDERBOX, text);
    common.anim(player, ANIM_CREATE_FIRE);
    lighting.add(player);
    Scenes.later(player, 5, () => {
      lighting.delete(player);
      // t2207: lit, 220, the fire sound and the fade out (the box is cleared as the screen goes).
      state.set(player, VARBIT.FURNACE, 3);
      state.advance(player, STAGE.FURNACE_LIT);
      common.sound(player, SOUND_FIRE_LIT);
      Scenes.hold(player);
      Scenes.fade(player, true);
      Scenes.later(player, 2, () => {
        Scenes.controls(player, true, true); // t2209: cutscene_status, minimap off
        Scenes.hideTabs(player);
        Scenes.later(player, 1, () => openCastleScene(player));
      });
    });
    return true;
  }

  function useTinderboxOnFurnace(event) {
    const { player } = event;
    if (varbit(player, VARBIT.FURNACE) !== 2 || stage(player) !== STAGE.FURNACE_FIXED) return false;
    if (!canLight(player)) return true;
    lightFurnace(player);
    return true;
  }

  /** Inspect on the fuelled furnace: the transcript's "It just needs lighting now." and its Yes/No. */
  function inspectFuelledFurnace(event) {
    const { player } = event;
    if (varbit(player, VARBIT.FURNACE) !== 2 || stage(player) !== STAGE.FURNACE_FIXED) return false;
    common.play(player, NPC.AUREL, V.LIGHTING);
    return true;
  }

  // ---------------------------------------------------------------------------
  // The Castle Drakan scene (t2210-t2282)
  // ---------------------------------------------------------------------------

  function openCastleScene(player) {
    const scene = Scenes.open(player, "castle-drakan", CASTLE.bounds, { musicTrack: MUSIC_STAGNANT }, {
      instance: { sourceChunk: CASTLE.sourceChunk }, at: CASTLE.at, exit: CASTLE.exit,
    });
    Scenes.actor(scene, NPC.VANSTROM, CASTLE.vanstrom, CASTLE.vanstromFace);
    Scenes.actor(scene, NPC.GADDERANKS_SCENE, CASTLE.gadderanks, CASTLE.gadderanksFace);
    Scenes.later(scene, 1, () => Scenes.camera(player, ...CASTLE.camera, CAMERA_RATES)); // t2211
    Scenes.later(scene, 2, () => Scenes.fade(player, false)); // t2212
    Scenes.later(scene, 6, () => common.play(player, NPC.VANSTROM, V.CASTLE)); // t2216
  }

  /** The scene's fade to black (KfBHp3): out of the copy, back by the furnace, then Gabriela's line. */
  function leaveCastle(event) {
    const { player } = event;
    event.handled = true;
    event.wait = (resume) => {
      Scenes.fade(player, true); // t2274
      Scenes.later(player, 2, () => { // t2276
        endScene(player, "castle-drakan");
        player.moveTo(tile(...CASTLE.exit));
        Scenes.later(player, 3, () => { // t2279
          Scenes.fade(player, false);
          resume();
        });
      });
    };
  }

  function endScene(player, name) {
    if (Scenes.get(player)?.name === name) Scenes.end(player, false);
  }

  /** The tithe set up in the store: Vanstrom's last line (t2270). */
  function startTithe(player) {
    state.advance(player, STAGE.GADDERANKS);
    if (varbit(player, VARBIT.BLOOD_TITHE) < 1) state.set(player, VARBIT.BLOOD_TITHE, 1);
  }

  // ---------------------------------------------------------------------------
  // The blood tithe in the store (230)
  // ---------------------------------------------------------------------------

  const TITHE_CHATS = [VARBIT.GADDERANKS_CHAT, VARBIT.JUVINATE_CHAT, VARBIT.VILLAGER_CHAT];

  /** A first chat's flag (on the continue of its last line); the third chains into the challenge (t2347). */
  function markChat(player, flag) {
    if (stage(player) !== STAGE.GADDERANKS) return;
    if (!varbit(player, flag)) state.set(player, flag, 1);
    if (TITHE_CHATS.every((id) => varbit(player, id) === 1)) challenge(player);
  }

  function challenge(player, npc = null) {
    challengePhase.set(player, "challenge");
    common.play(player, NPC.GADDERANKS, V.ALL_THREE, (steps) => steps.slice(0, 2), PAGE, npc);
  }

  /** The challenge line opens with the fade (t2347); the copy loads four ticks on and the line comes again (t2352). */
  function challengeShown(player) {
    Scenes.fade(player, true);
    Scenes.later(player, 1, () => Scenes.controls(player, true)); // t2348 minimap off
    Scenes.later(player, 4, () => openFight(player, false)); // t2351
    Scenes.later(player, 5, () => { // t2352
      if (!fights.has(player)) return;
      state.advance(player, STAGE.FIGHT);
      Scenes.fade(player, false);
      Scenes.controls(player, false);
      challengePhase.set(player, "reprise");
      common.play(player, NPC.GADDERANKS, V.ALL_THREE, (steps) => steps.slice(0, 2));
    });
  }

  /** p2YbVD: the challenge's first showing waits for the copy; its second starts the fight on the close. */
  function challengeAction(event) {
    const { player } = event;
    event.handled = true;
    event.end = true;
    const phase = challengePhase.get(player);
    challengePhase.delete(player);
    if (phase !== "reprise") return;
    // t2357: the juvinates attack a tick after the line closes.
    Scenes.later(player, 1, () => {
      const fight = fights.get(player);
      if (!fight) return;
      for (const juvinate of fight.juvinates) if (juvinate.isRegistered?.()) juvinate.getCombat().attack(player);
    });
  }

  // ---------------------------------------------------------------------------
  // The store fight (240-260)
  // ---------------------------------------------------------------------------

  function addActor(fight, id, at, face) {
    const npc = Scenes.actor(fight.scene, id, at, face);
    if (!npc) return null;
    npc.setMultiCombat?.(true);
    actorFight.set(npc, fight);
    return npc;
  }

  /** `aftermath`: Ours, a copy re-entered after leaving at 260 holds the wounded Gadderanks and Veliaf only. */
  function openFight(player, aftermath) {
    if (!aftermath) {
      // A new fight starts from nothing, even after a save taken mid-fight (an autosave or a
      // shutdown, which don't run the logout that resets it).
      if (varbit(player, VARBIT.JUVINATE_DEATHS)) state.set(player, VARBIT.JUVINATE_DEATHS, 0);
      if (stage(player) === STAGE.VELIAF_ARRIVED) state.setStage(player, STAGE.FIGHT);
    }
    const scene = Scenes.open(player, "store-fight", FIGHT.bounds, {
      multi: true, musicTrack: MUSIC_VAMPYRE_ASSAULT, canTeleport: () => null, npcAggression: () => null,
    }, { instance: { sourceChunk: FIGHT.sourceChunk }, at: FIGHT.at, exit: FIGHT.exit });
    const fight = { player, scene, juvinates: [], gadderanks: null, veliaf: null, door: null, blocker: null,
      wounded: aftermath, finished: false };
    fights.set(player, fight);
    fight.gadderanks = addActor(fight, aftermath ? NPC.GADDERANKS_WOUNDED : NPC.GADDERANKS_FIGHT, FIGHT.gadderanks, FIGHT.gadderanksFace);
    if (aftermath) {
      fight.gadderanks?.setUntargetable?.(true);
      fight.veliaf = addActor(fight, NPC.VELIAF_RESCUE, FIGHT.veliafSteps[1], FIGHT.gadderanks);
    } else {
      for (const [at, face] of [[FIGHT.juvinate1, FIGHT.juvinate1Face], [FIGHT.juvinate2, FIGHT.juvinate2Face]]) {
        const juvinate = addActor(fight, at === FIGHT.juvinate1 ? NPC.JUVINATE_FIGHT_1 : NPC.JUVINATE_FIGHT_2, at, face);
        if (juvinate) fight.juvinates.push(juvinate);
      }
    }
    addActor(fight, NPC.WISKIT_FIGHT, FIGHT.wiskit, FIGHT.wiskitFace);
    fight.door = Scenes.loc(scene, { id: LOC.DOOR, ...FIGHT.door });
    if (!aftermath) fight.blocker = Scenes.loc(scene, { id: LOC.BLOCKER, ...FIGHT.blocker });
    return fight;
  }

  function removeLoc(fight, object) {
    if (!object) return;
    const index = fight.scene.locs.indexOf(object);
    if (index >= 0) fight.scene.locs.splice(index, 1);
    api.core.ObjectManager.deregister(object, true);
  }

  /** One more foe down (juvinate_deaths); the first brings Veliaf five ticks on, the third ends the fight. */
  function countDown(fight) {
    const { player } = fight;
    const deaths = varbit(player, VARBIT.JUVINATE_DEATHS) + 1;
    state.set(player, VARBIT.JUVINATE_DEATHS, deaths);
    if (deaths === 1) Scenes.later(fight.scene, 5, () => veliafArrives(fight)); // t2415 -> t2420
    if (deaths >= 3) fightWon(fight);
  }

  function woundGadderanks(fight, npc) {
    if (fight.wounded) return;
    fight.wounded = true;
    // t2415: he falls back where he stands and turns into the wounded Gadderanks.
    npc.getCombat?.()?.reset?.();
    npc.setUntargetable?.(true);
    fight.player.getCombat?.()?.reset?.();
    npc.setNpcTransformationId(NPC.GADDERANKS_WOUNDED);
    common.anim(npc, ANIM_DEATH_BACKWARDS);
    common.sound(fight.player, SOUND_HUMAN_DEATH);
    countDown(fight);
  }

  /** A juvinate goes a tick after its last hit and leaves a mist that fades nine ticks later (t2499-t2510). */
  function juvinateFalls(fight, npc) {
    if (npc.__inAidFallen) return;
    npc.__inAidFallen = true;
    npc.getCombat?.()?.reset?.();
    npc.setUntargetable?.(true);
    Scenes.later(fight.scene, 1, () => {
      if (fights.get(fight.player) !== fight) return;
      const where = Scenes.toSource(npc);
      Scenes.removeActor(fight.scene, npc);
      fight.juvinates = fight.juvinates.filter((other) => other !== npc);
      const mist = Scenes.actor(fight.scene, NPC.MIST, [where.getX() - 1, where.getY() - 1, where.getZ()]);
      if (mist) {
        Scenes.later(fight.scene, 9, () => common.anim(mist, ANIM_MIST_DISAPPEAR));
        Scenes.later(fight.scene, 10, () => Scenes.removeActor(fight.scene, mist));
      }
      countDown(fight);
      veliafRetarget(fight);
    });
  }

  function handleBeforeDeath(event) {
    const npc = event?.npc;
    const fight = npc ? actorFight.get(npc) : null;
    if (!fight || fights.get(fight.player) !== fight) return;
    if (npc === fight.veliaf) {
      event.preventDeath = true;
      npc.setHitpoints(npc.getMaxHitpoints());
      return;
    }
    if (npc === fight.gadderanks) {
      event.preventDeath = true;
      woundGadderanks(fight, npc);
      return;
    }
    if (fight.juvinates.includes(npc)) {
      event.preventDeath = true;
      juvinateFalls(fight, npc);
    }
  }

  /** t2420-t2424: Veliaf at the door, his shout, the door opening, two steps in, the door shut behind him. */
  function veliafArrives(fight) {
    const { player, scene } = fight;
    if (fights.get(player) !== fight || fight.veliaf || stage(player) >= STAGE.JUVINATES_DEAD) return;
    state.advance(player, STAGE.VELIAF_ARRIVED);
    const veliaf = addActor(fight, NPC.VELIAF_RESCUE, FIGHT.veliafSpawn, FIGHT.veliafFace);
    if (!veliaf) return;
    fight.veliaf = veliaf;
    veliaf.setScriptedMovement?.(true);
    veliaf.setHitpointsLocked?.(true); // Ours: he takes hits but never falls
    Scenes.later(scene, 1, () => { // t2421
      Scenes.walk(veliaf, [...FIGHT.veliafWalk, 0]);
      veliaf.forceChat(veliafArrivalLine());
      removeLoc(fight, fight.door);
      removeLoc(fight, fight.blocker);
      fight.door = Scenes.loc(scene, { id: LOC.INVISWALL, ...FIGHT.door });
      fight.blocker = Scenes.loc(scene, { id: LOC.DOOR_INACTIVE, ...FIGHT.blocker });
      common.sound(player, SOUND_DOOR_OPEN);
    });
    Scenes.later(scene, 2, () => veliaf.moveTo(Scenes.tileFor(scene, [...FIGHT.veliafSteps[0], 0]))); // t2422
    Scenes.later(scene, 4, () => { // t2424
      veliaf.moveTo(Scenes.tileFor(scene, [...FIGHT.veliafSteps[1], 0]));
      removeLoc(fight, fight.door);
      removeLoc(fight, fight.blocker);
      fight.blocker = null;
      fight.door = Scenes.loc(scene, { id: LOC.DOOR, ...FIGHT.door });
      common.sound(player, SOUND_DOOR_CLOSE);
      veliaf.setScriptedMovement?.(false);
      shoutLater(fight);
    });
    // t2425, once the last step's placement is sent: an attack issued in the moveTo's own tick
    // is dropped by the combat tick (CombatFactory.validTarget), and he never fought. He
    // closes in from t2426.
    Scenes.later(scene, 5, () => {
      if (fights.get(player) === fight) veliafRetarget(fight);
    });
  }

  function veliafRetarget(fight) {
    const veliaf = fight.veliaf;
    if (!veliaf?.isRegistered?.()) return;
    // Wiki: Veliaf helps kill "the other vampyre, and then finally Gadderanks himself".
    const standing = (npc) => npc?.isRegistered?.() && !npc.__inAidFallen;
    const target = fight.juvinates.find(standing) ?? (!fight.wounded && standing(fight.gadderanks) ? fight.gadderanks : null);
    if (target) veliaf.getCombat().attack(target);
    else veliaf.getCombat().reset?.();
  }

  function shoutLater(fight) {
    Scenes.later(fight.scene, SHOUT_INTERVAL, () => {
      if (fights.get(fight.player) !== fight || !fight.juvinates.some((juvinate) => !juvinate.__inAidFallen)) return;
      if (Math.random() < SHOUT_CHANCE) {
        fight.veliaf?.forceChat(VELIAF_SHOUTS[Math.floor(Math.random() * VELIAF_SHOUTS.length)]);
      }
      shoutLater(fight);
    });
  }

  /** t2517: the third foe down: 260 and the wounded Gadderanks' first two lines open by themselves. */
  function fightWon(fight) {
    const { player } = fight;
    if (!state.advance(player, STAGE.JUVINATES_DEAD)) return;
    fight.veliaf?.getCombat?.()?.reset?.();
    const steps = aftermathSteps();
    common.play(player, NPC.GADDERANKS_WOUNDED, V.ALL_THREE, () => steps.slice(0, 2), PAGE, fight.gadderanks);
  }

  /** Escape / Quick-escape on the store door: the Wiki's "leave the room at any time" resets the fight. */
  function escapeDoor(event) {
    const { player } = event;
    if (Scenes.get(player)?.name !== "store-fight") return false;
    Scenes.end(player, false);
    player.moveTo(tile(...FIGHT.exit));
    return true;
  }

  // ---------------------------------------------------------------------------
  // The wounded Gadderanks, his death and the Gadderhammer (260-280)
  // ---------------------------------------------------------------------------

  function talkWounded(player, npc) {
    const steps = aftermathSteps();
    const end = passesAwayIndex(steps);
    common.play(player, NPC.GADDERANKS_WOUNDED, V.ALL_THREE, () => steps.slice(2, end + 1), PAGE, npc);
  }

  /** "Gadderanks passes away." (t2595): a mesbox and the fade; 280 and out of the copy (t2599); the box again (t2600). */
  function passesAway(event) {
    const { player } = event;
    event.handled = true;
    event.end = true;
    const text = String(event.text ?? "");
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, text, false) }, true)));
    Scenes.fade(player, true);
    Scenes.later(player, 1, () => Scenes.controls(player, true)); // t2596 minimap off
    Scenes.later(player, 4, () => { // t2599
      const fight = fights.get(player);
      if (fight) fight.finished = true;
      state.advance(player, STAGE.GADDERANKS_DEAD);
      state.set(player, VARBIT.BLOOD_TITHE, 2);
      endScene(player, "store-fight");
      player.moveTo(tile(...FIGHT.leave));
      Scenes.later(player, 1, () => { // t2600
        Scenes.fade(player, false);
        common.mesbox(player, text, handOverHammer);
      });
    });
  }

  /** t2605: the warhammer goes in (2004) before Aurel's line, then his item box. */
  function handOverHammer(player) {
    giveHammer(player);
    const steps = aftermathSteps();
    common.play(player, NPC.AUREL, V.ALL_THREE, () => steps.slice(passesAwayIndex(steps) + 1));
  }

  /** The Wiki: with no free slot the hammer waits with Aurel (2004 stays 0) and is claimed from him later. */
  function giveHammer(player) {
    if (varbit(player, VARBIT.WARHAMMER_GIVEN)) return true;
    if (common.freeSlots(player) < 1) return false;
    state.set(player, VARBIT.WARHAMMER_GIVEN, 1);
    player.getInventory().adds(ITEM.GADDERHAMMER, 1);
    return true;
  }

  function hammerBox(event) {
    const { player } = event;
    if (!varbit(player, VARBIT.WARHAMMER_GIVEN)) {
      event.handled = true; // Ours: no box for a hammer still waiting with Aurel
      return;
    }
    event.box = { items: [ITEM.GADDERHAMMER] }; // t2610
  }

  /** The lost-hammer page's purchase (6qLnJV). */
  function buyHammer(event) {
    const { player } = event;
    event.handled = true;
    const inventory = player.getInventory();
    if (inventory.getAmount(ITEM.COINS) < HAMMER_PRICE) return;
    // Ours: a full bag with more coins than the price keeps them (the old plugin's check).
    if (common.freeSlots(player) < 1 && inventory.getAmount(ITEM.COINS) > HAMMER_PRICE) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    inventory.deleteNumber(ITEM.COINS, HAMMER_PRICE);
    inventory.adds(ITEM.GADDERHAMMER, 1);
  }

  // ---------------------------------------------------------------------------
  // Store Veliaf (280, 1981=2) and his leaving (1981=3)
  // ---------------------------------------------------------------------------

  /** "Veliaf heads back to the Hollows." (t2632): mesbox and fade; he goes (t2634); fade in, the box again (t2635). */
  function veliafLeaves(event) {
    const { player } = event;
    event.handled = true;
    event.end = true;
    const text = String(event.text ?? "");
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, text, false) }, true)));
    Scenes.fade(player, true);
    Scenes.later(player, 2, () => state.set(player, VARBIT.BLOOD_TITHE, 3));
    Scenes.later(player, 3, () => {
      Scenes.fade(player, false);
      common.mesbox(player, text);
    });
  }

  // ---------------------------------------------------------------------------
  // Talk-to
  // ---------------------------------------------------------------------------

  function talkGadderanks(event) {
    const { player, npcId, npc } = event;
    const now = stage(player);
    const fight = fights.get(player);
    if (npcId === NPC.GADDERANKS_WOUNDED) {
      if (!fight || now !== STAGE.JUVINATES_DEAD) return false;
      talkWounded(player, npc);
      return true;
    }
    if (npcId !== NPC.GADDERANKS || now < STAGE.GADDERANKS || now >= STAGE.GADDERANKS_DEAD) return false;
    if (now === STAGE.GADDERANKS) {
      common.play(player, npcId, V.GADDERANKS, undefined, PAGE, npc);
      return true;
    }
    if (Scenes.get(player)) return true;
    // Ours: back at the store after leaving the copy. The fight starts again; at 260 the wounded
    // Gadderanks is waiting where he fell.
    if (now >= STAGE.JUVINATES_DEAD) openFight(player, true);
    else challenge(player, npc);
    return true;
  }

  function talkJuvinate(event) {
    const { player, npcId, npc } = event;
    if (npcId !== NPC.JUVINATE_TITHE_1 && npcId !== NPC.JUVINATE_TITHE_2) return false;
    const now = stage(player);
    if (now < STAGE.GADDERANKS || now >= STAGE.GADDERANKS_DEAD) return false;
    common.play(player, npcId, V.JUVINATE, undefined, PAGE, npc);
    return true;
  }

  function talkWiskit(event) {
    const { player, npcId, npc } = event;
    if (npcId !== NPC.WISKIT) return false;
    const now = stage(player);
    if (now < STAGE.GADDERANKS || now >= STAGE.GADDERANKS_DEAD) return false;
    common.play(player, npcId, V.WISKIT, undefined, PAGE, npc);
    return true;
  }

  function talkStoreVeliaf(event) {
    const { player, npcId, npc } = event;
    if (npcId !== NPC.VELIAF_STORE || varbit(player, VARBIT.BLOOD_TITHE) !== 2) return false;
    common.play(player, npcId, V.VELIAF, undefined, PAGE, npc);
    return true;
  }

  function talkAurel(event) {
    const { player, npcId, npc } = event;
    if (npcId !== NPC.AUREL) return false;
    const now = stage(player);
    if (now < STAGE.GADDERANKS) return false;
    if (now < STAGE.GADDERANKS_DEAD) {
      common.play(player, npcId, V.CITIZENS, undefined, PAGE, npc);
      return true;
    }
    if (!varbit(player, VARBIT.WARHAMMER_GIVEN) && giveHammer(player)) {
      // Ours: the hammer that waited for a free slot, handed over with the capture's lines (t2605-t2610).
      const steps = aftermathSteps();
      common.play(player, npcId, V.ALL_THREE, () => steps.slice(passesAwayIndex(steps) + 1), PAGE, npc);
      return true;
    }
    const variant = questComplete(player, "the_blood_moon_rises") ? AUREL_V.AFTER_BMR
      : hasHammer(player) ? AUREL_V.STANDARD : AUREL_V.LOST_HAMMER;
    common.play(player, npcId, variant, undefined, AUREL_PAGE, npc);
    return true;
  }

  function talkCitizen(event) {
    const { player, npcId, npc } = event;
    const now = stage(player);
    if (now < STAGE.FURNACE_LIT || now >= STAGE.GADDERANKS_DEAD) return false;
    common.play(player, npcId, V.CITIZENS, undefined, PAGE, npc);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Dialogue events
  // ---------------------------------------------------------------------------

  const startsWith = (event, prefix) => String(event.step?.text ?? event.step?.player ?? event.text ?? "").startsWith(prefix);

  function handleLine(event) {
    const { player, step } = event;
    if (!player || !step) return;
    const variant = variantOf(event);
    if (!variant) return;
    const speaker = step.speaker;
    switch (variant) {
      case V.CASTLE:
        if (speaker === "Vanstrom Klause") event.speakerId = NPC.VANSTROM;
        else if (speaker === "Gadderanks") event.speakerId = NPC.GADDERANKS_SCENE;
        else if (speaker === "Gabriela") {
          event.speakerId = NPC.GABRIELA;
          // t2282: vampyre_aggression on the line's continue.
          event.after = () => state.set(player, VARBIT.VAMPYRE_AGGRESSION, 1);
        }
        if (startsWith(event, "It seems you have a fresh appointment")) event.before = () => startTithe(player);
        return;
      case V.GADDERANKS:
        if (startsWith(event, "Ha! We'll see about that!")) event.after = () => markChat(player, VARBIT.GADDERANKS_CHAT);
        return;
      case V.JUVINATE:
        if (startsWith(event, "We're getting some delicious")) event.after = () => markChat(player, VARBIT.JUVINATE_CHAT);
        return;
      case V.WISKIT:
        if (speaker === "Wiskit") event.after = () => markChat(player, VARBIT.VILLAGER_CHAT);
        return;
      case V.ALL_THREE:
        if (startsWith(event, "I've had enough of you poking")) {
          event.speakerId = NPC.GADDERANKS;
          if (challengePhase.get(player) === "challenge") event.before = () => challengeShown(player);
          return;
        }
        if (speaker === "Gadderanks") event.speakerId = NPC.GADDERANKS_WOUNDED;
        else if (speaker === "Veliaf" || speaker === "Veliaf Hurtz") event.speakerId = NPC.VELIAF_RESCUE;
        else if (speaker === "Aurel") event.speakerId = NPC.AUREL;
        return;
      case V.VELIAF:
        if (speaker === "Veliaf") event.speakerId = NPC.VELIAF_RESCUE; // live's head 989 (t2623)
        return;
      default:
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    switch (stepId) {
      case STEP.LIGHT_INTRO:
      case STEP.NEED_TINDERBOX:
        if (event.kind === "message") event.box = { statement: true };
        return;
      case STEP.LIT:
        event.handled = true;
        event.end = true;
        lightFurnace(player, String(event.text ?? "You light the furnace..."));
        return;
      case STEP.CASTLE_FADE_OUT:
        if (Scenes.get(player)?.name === "castle-drakan") leaveCastle(event);
        return;
      case STEP.ATTACK:
        challengeAction(event);
        return;
      case STEP.PASSES_AWAY:
        if (stage(player) === STAGE.JUVINATES_DEAD) passesAway(event);
        return;
      case STEP.HAMMER_GIVEN:
        hammerBox(event);
        return;
      case STEP.HAMMER_BOUGHT:
        buyHammer(event);
        return;
      case STEP.VELIAF_LEAVES:
        if (varbit(player, VARBIT.BLOOD_TITHE) === 2) veliafLeaves(event);
        return;
      default:
    }
  }

  function answerCondition({ player, stepId }) {
    switch (stepId) {
      case STEP.GADDERANKS_FIRST: return varbit(player, VARBIT.GADDERANKS_CHAT) === 0;
      case STEP.GADDERANKS_AGAIN: return varbit(player, VARBIT.GADDERANKS_CHAT) === 1;
      case STEP.JUVINATE_FIRST: return varbit(player, VARBIT.JUVINATE_CHAT) === 0;
      case STEP.JUVINATE_AGAIN: return varbit(player, VARBIT.JUVINATE_CHAT) === 1;
      case STEP.NO_TINDERBOX: return !common.held(player, ITEM.TINDERBOX);
      case STEP.HAS_TINDERBOX: return common.held(player, ITEM.TINDERBOX);
      case STEP.NOT_ENOUGH_COINS: return !common.held(player, ITEM.COINS, HAMMER_PRICE);
      case STEP.ENOUGH_COINS: return common.held(player, ITEM.COINS, HAMMER_PRICE);
      default: return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Scene ends
  // ---------------------------------------------------------------------------

  function sceneEnded(player, scene, logout) {
    if (scene.name === "castle-drakan") {
      if (!logout) Scenes.restoreTabs(player);
      // Ours: a scene cut short (logout) still leaves the tithe set up, as its last line would have.
      if (stage(player) < STAGE.GADDERANKS) {
        startTithe(player);
        state.set(player, VARBIT.VAMPYRE_AGGRESSION, 1);
      }
      return;
    }
    if (scene.name !== "store-fight") return;
    const fight = fights.get(player);
    fights.delete(player);
    challengePhase.delete(player);
    if (fight?.finished || stage(player) >= STAGE.JUVINATES_DEAD) return;
    // The Wiki: leaving the room resets the fight. Ours: the count and Veliaf's arrival go with it.
    if (varbit(player, VARBIT.JUVINATE_DEATHS)) state.set(player, VARBIT.JUVINATE_DEATHS, 0);
    if (stage(player) === STAGE.VELIAF_ARRIVED) state.setStage(player, STAGE.FIGHT);
  }

  /**
   * A logout drops the scene steps still to come (QuestScenes ends an open scene itself). One between
   * the fire catching (220) and the castle scene opening resolves as a scene cut short does.
   */
  function handleLogout({ player }) {
    if (!player) return;
    Scenes.cancel(player);
    lighting.delete(player);
    resolveUnplayedCastle(player);
  }

  /** 220 with no castle scene playing (a save taken mid-scene, a logout before it opened): as a scene cut short. */
  function resolveUnplayedCastle(player) {
    if (stage(player) !== STAGE.FURNACE_LIT || Scenes.get(player)) return;
    startTithe(player);
    state.set(player, VARBIT.VAMPYRE_AGGRESSION, 1);
  }

  function handleLogin({ player }) {
    if (player) resolveUnplayedCastle(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.onItemOnObject("Tinderbox", "Repaired furnace", useTinderboxOnFurnace);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
  api.onObjectInteraction("Repaired furnace", { Inspect: inspectFuelledFurnace });
  api.onObjectInteraction("Door", { Escape: escapeDoor, "Quick-escape": escapeDoor });
  api.onNpcInteraction("Gadderanks", { "Talk-to": talkGadderanks });
  api.onNpcInteraction("Vampyre Juvinate", { "Talk-to": talkJuvinate });
  api.onNpcInteraction("Wiskit", { "Talk-to": talkWiskit });
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkStoreVeliaf });
  api.onNpcInteraction("Aurel", { "Talk-to": talkAurel });
  api.onNpcsInteraction(CITIZENS, { "Talk-to": talkCitizen });
  api.onNpcBeforeDeath(handleBeforeDeath);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
};
