/**
 * Mudfoot's Big Adventure's scenes, as the rsprox capture MudfootsBigAdventure (rev 242.1) plays them (ticks in
 * brackets):
 *
 * - The store "Confront" [381-446]: a cutscene in a copy of the map around the store (source chunk 396,399, 13 x 13
 *   chunks), side tabs closed, the camera fixed, Mudfoot's harmless swing, the outlaw walking off, Captain Harlan
 *   walking up; then back at Harlan's post for the talk about the combat triangle, and "Mudfoot departs." [580-586].
 * - The three fights, each in its own copy: the windmill field (390,404) [720-759], the ruined building (390,399)
 *   [894-933], the graveyard (399,394) [1157-1199]. The screen fades for two ticks either side; the copy's gates
 *   and doors are closed with no options. Mudfoot fights the outlaw beside the player and shouts when the player
 *   uses the wrong style (Wiki: Transcript:Mudfoot's Big Adventure). The warrior prays Protect from Melee after the
 *   first hit he takes [1163-1167] and his "My faith protects me!".
 * - A kill fades out at once; two ticks later the copy goes, the player stands on the matching real tile with
 *   Mudfoot beside them, the loot lies on the outlaw's real tile, and the talk starts eight ticks after that.
 *
 * Leaving a fight (a teleport or logout) leaves the stage at its fight value; Mudfoot waits at the spot
 * mba_mudfoot_vis holds (the Wiki: "If you leave the fight area, you will need to retrieve Mudfoot ...").
 */
const { createQuestScenes } = require("../QuestScenes");

const FACE = { NW: 0, N: 1, NE: 2, W: 3, E: 4, SW: 5, S: 6, SE: 7 };

module.exports = function createMudfootScenes(api, common, deps) {
  const { Animation, CombatType, HitDamage, HitMask, Location, StatementDialogue, ActionDialogue, DialogueChainBuilder } = api.core;
  const { STAGE, VIS, NPC, CHAT, play, npcLine, playerLine, stageOf, setStage, setVis } = common;
  const P = playerLine;
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: common.ATTRIBUTE.SCENE_EXIT });

  const SOUND = { WARHAMMER: 3514, LEATHER_HIT: 2813 };
  const SEQ = { GOBLIN_ATTACK: 6185, BLOCK: 425 };
  /** The store copy's invisible anchor loc (invisible_type8_nonblocking), as captured at 384. */
  const STORE_ANCHOR = { id: 29733, x: 3222, y: 3243, type: 10, face: 0 };

  const STORE = {
    sourceChunk: [396, 399],
    at: [3222, 3246, 0],
    exit: [3220, 3246, 0],
    outlaw: [3217, 3245, 0],
    mudfoot: [3222, 3244, 0],
    playerTo: [3219, 3246, 0],
    mudfootTo: [3219, 3244, 0],
    swingFrom: [3218, 3245, 0],
    outlawAway: [3217, 3257, 0],
    harlanFrom: [3220, 3240, 0],
    harlanTo: [3220, 3244, 0],
    harlanBack: [3220, 3239, 0],
    playerBack: [3220, 3243, 0],
    mudfootBack: [3220, 3242, 0],
    camera: [[3221, 3239, 480], [3215, 3253, 230]],
    post: { player: [3218, 3238, 0], mudfoot: [3219, 3238, 0] },
  };

  /** opflags 0: the copy's gates and doors cannot be opened. */
  const NO_OPS = 0;
  const FIGHTS = {
    ranger: {
      name: "windmill", stage: STAGE.RANGER_FIGHT, waitVis: VIS.WINDMILL, nextVis: [VIS.FOLLOWING], next: STAGE.RANGER_DEAD,
      sourceChunk: [390, 404], at: [3170, 3285, 0], outlawId: NPC.RANGER_COMBAT, outlaw: [3166, 3288, 0], outlawFace: [3167, 3287],
      mudfootId: NPC.MUDFOOT_SPEAR_COMBAT, mudfoot: [3171, 3287, 0], mudfootFace: [3170, 3287], outlawAttack: 4, mudfootAttack: 5,
      locs: [
        { id: 1560, x: 3180, y: 3289, type: 0, face: 3 }, { id: 1558, x: 3181, y: 3289, type: 0, face: 3 },
        { id: 1560, x: 3162, y: 3290, type: 0, face: 3 }, { id: 1558, x: 3163, y: 3290, type: 0, face: 3 },
      ],
    },
    mage: {
      name: "woods", stage: STAGE.MAGE_FIGHT, waitVis: VIS.WINDMILL, nextVis: [VIS.WOODS, VIS.FOLLOWING], next: STAGE.MAGE_DEAD,
      sourceChunk: [390, 399], at: [3173, 3240, 0], outlawId: NPC.MAGE_COMBAT, outlaw: [3171, 3241, 0], outlawFace: [3172, 3240],
      mudfootId: NPC.MUDFOOT_ROCKS_COMBAT, mudfoot: [3172, 3238, 0], mudfootFace: [3172, 3239], outlawAttack: 4, mudfootAttack: 3,
      shout: [3, "A human helping a goblin? You're a disgrace!"], hitShout: "H.A.M. will get rid of people like you!",
      locs: [{ id: 5492, x: 3166, y: 3252, type: 22, face: 1 }],
    },
    warrior: {
      name: "graveyard", stage: STAGE.WARRIOR_FIGHT, waitVis: VIS.WOODS, nextVis: [VIS.GRAVEYARD, VIS.FOLLOWING], next: STAGE.WARRIOR_DEAD,
      sourceChunk: [399, 394], at: [3244, 3200, 0], outlawId: NPC.WARRIOR_COMBAT, outlaw: [3244, 3197, 0], outlawFace: [3244, 3198],
      mudfootId: NPC.MUDFOOT_SPEAR_COMBAT, mudfoot: [3242, 3199, 0], mudfootFace: [3243, 3198], outlawAttack: 4, mudfootAttack: 3,
      prays: true,
      locs: [
        { id: 1535, x: 3234, y: 3207, type: 0, face: 0 }, { id: 1536, x: 3233, y: 3203, type: 0, face: 1 },
        { id: 1535, x: 3235, y: 3198, type: 0, face: 1 }, { id: 38426, x: 3238, y: 3192, type: 10, face: 2 },
        { id: 1535, x: 3247, y: 3193, type: 0, face: 0 },
      ],
    },
  };

  /**
   * Mudfoot's shouts at the wrong style (Wiki overheads; the slash line [732] and the melee line at the mage [906]
   * captured, each once though the player kept using it). Ours: each line once a fight.
   */
  const HINTS = {
    ranger: (style) => {
      if (style.type === CombatType.RANGED || style.type === CombatType.MAGIC) return "Human being stupid. You meant to be doing close up stabby hits.";
      if (!style.canStab) return "Stupid human no listen. You need to have weapon that do stab.";
      if (style.bonus === 1) return "Stupid human no listen. You need to do stab, not slash.";
      if (style.bonus === 2) return "Stupid human no listen. You need to do stab, not crush.";
      return null;
    },
    mage: (style) => {
      if (style.type === CombatType.MAGIC) return "Stupid human. You no meant to use flashy magic. Do other far away hits.";
      if (style.type === CombatType.MELEE) return "Stupid human. You meant to do far away hits.";
      return null;
    },
    warrior: (style) => {
      if (style.type === CombatType.RANGED) return "Stupid human. You meant to use fancy magic.";
      if (style.type === CombatType.MELEE) return "Stupid human. You meant to use fancy magic. Let me do close up hits.";
      return null;
    },
  };
  const PRAYED_LINE = "Ha! Stupid thief pray to stop stabs, but he can't stop magic as well!";
  const PRAYER_LINE = "My faith protects me!";
  const PROTECT = { MELEE: "PROTECT_FROM_MELEE", MISSILES: "PROTECT_FROM_MISSILES" };

  const plays = new WeakMap();
  const online = (player) => player.isRegistered?.() !== false;

  function sound(player, id) {
    player.getPacketSender().sendSound(id, 1, 0);
  }

  /** The capture's held moments: an empty chatbox, or a line, the player cannot continue. */
  function hold(player, text = "") {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, text, false) }, true)
    ));
  }

  function zeroHit(target, source) {
    target.getCombat().getHitQueue().addPendingDamage([new HitDamage(0, HitMask.BLUE).setSource(source)]);
  }

  // ==========================================================================
  // The store
  // ==========================================================================

  function confrontStore(player) {
    if (Scenes.get(player) || plays.has(player)) return;
    plays.set(player, { kind: "store", pending: true });
    Scenes.fade(player, true);
    hold(player);
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.later(player, 2, () => { if (online(player)) openStore(player); });
  }

  function openStore(player) {
    deps.clearNpcs(player);
    setVis(player, VIS.HOUSE);
    const scene = Scenes.open(player, "store", [[3168, 3271, 3192, 3295, 0]], { npcAggression: () => false }, {
      instance: { sourceChunk: STORE.sourceChunk }, at: STORE.at, exit: STORE.exit,
    });
    const state = plays.get(player) ?? {};
    state.pending = false;
    plays.set(player, state);
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    Scenes.loc(scene, STORE_ANCHOR);
    state.outlaw = Scenes.actor(scene, NPC.RANGER_VIS, STORE.outlaw, [3218, 3245]);
    state.mudfoot = Scenes.actor(scene, NPC.MUDFOOT, STORE.mudfoot, [3221, 3244]);
    Scenes.later(scene, 1, () => Scenes.camera(player, ...STORE.camera));
    Scenes.later(scene, 2, () => {
      Scenes.fade(player, false);
      Scenes.walk(player, STORE.playerTo);
      Scenes.walk(state.mudfoot, STORE.mudfootTo);
    });
    Scenes.later(scene, 5, () => {
      Scenes.face(player, [3218, 3245]);
      if (state.outlaw) state.mudfoot?.setPositionToFace(state.outlaw.getLocation());
    });
    Scenes.later(scene, 6, () => storeTalk(player, scene, state));
  }

  const O = (text, anim) => npcLine(NPC.RANGER_VIS, text, anim);
  const MV = (text, anim, extra) => npcLine(NPC.MUDFOOT, text, anim, extra);
  const HC = (text, anim, extra) => npcLine(NPC.HARLAN_CUTSCENE, text, anim, extra);

  function storeTalk(player, scene, state) {
    const alive = () => Scenes.get(player) === scene;
    play(player, [
      O("Er... What is this?", CHAT.CONFUSED1),
      MV("Evil human! Mudfoot kill you now!", CHAT.ANGRY1, { on: () => state.outlaw?.setPositionToFace(state.mudfoot.getLocation()) }),
    ], () => {
      hold(player);
      Scenes.walk(state.mudfoot, STORE.swingFrom);
      Scenes.later(scene, 1, () => {
        state.mudfoot?.performAnimation(new Animation(SEQ.GOBLIN_ATTACK));
        state.outlaw?.performAnimation(new Animation(SEQ.BLOCK));
        sound(player, SOUND.WARHAMMER);
      });
      Scenes.later(scene, 2, () => {
        if (state.outlaw) zeroHit(state.outlaw, state.mudfoot);
        sound(player, SOUND.LEATHER_HIT);
      });
      Scenes.later(scene, 5, () => { if (alive()) storeTalkOutlaw(player, scene, state); });
    });
  }

  function storeTalkOutlaw(player, scene, state) {
    const alive = () => Scenes.get(player) === scene;
    play(player, [O("...", CHAT.CONFUSED_IDLE), O("Okay... Good luck with that...", CHAT.CONFUSED1)], () => {
      hold(player);
      Scenes.walk(state.outlaw, STORE.outlawAway);
      Scenes.later(scene, 3, () => {
        if (!alive()) return;
        state.harlan = Scenes.actor(scene, NPC.HARLAN_CUTSCENE, STORE.harlanFrom, [3220, 3241]);
        state.mudfoot?.setPositionToFace(player.getLocation());
        play(player, [MV("Me no understand. Why no work?", CHAT.CONFUSED1)], () => {
          hold(player);
          Scenes.walk(state.harlan, STORE.harlanTo);
          Scenes.later(scene, 2, () => {
            if (!alive()) return;
            Scenes.face(player, [3220, 3244]);
            Scenes.face(state.mudfoot, [3220, 3244]);
            storeTalkHarlan(player, scene, state);
          });
        });
      });
    });
  }

  function storeTalkHarlan(player, scene, state) {
    const metEarly = player.getAttribute(common.ATTRIBUTE.MET_EARLY) === true;
    play(player, [
      HC("What's happening here? What's all the commotion?", CHAT.CONFUSED1),
      ...(metEarly ? [
        HC("Adventurer? You still have that goblin with you. What's going on?", CHAT.CONFUSED2, { on: () => Scenes.face(state.harlan, [3218, 3246]) }),
        P("Well, as it turns out, Mudfoot here is actually trying to deal with the thieves as well.", CHAT.NEUTRAL2),
      ] : [
        HC("A goblin? Is this the one responsible for the robbery, adventurer?", CHAT.CONFUSED2, { on: () => Scenes.face(state.harlan, [3218, 3246]) }),
        P("As it turns out, no. Mudfoot here is actually trying to deal with the thieves as well.", CHAT.NEUTRAL2),
      ]),
      HC("He is?", CHAT.CONFUSED1),
      MV("Yes. Nasty humans try to frame innocent goblins. Me here to stop them. Me make them go dead.", CHAT.DISGRUNTLED),
      HC("You killed them?", CHAT.CONFUSED1),
      P("Not yet. Mudfoot seems to be having some... difficulties with that.", CHAT.CONFUSED2),
      HC("I see... In that case, come. Let us discuss this further.", CHAT.CONFUSED1),
    ], () => {
      hold(player);
      if (state.outlaw) { Scenes.removeActor(scene, state.outlaw); state.outlaw = null; }
      Scenes.walk(state.harlan, STORE.harlanBack);
      Scenes.later(scene, 2, () => {
        Scenes.walk(player, STORE.playerBack);
        Scenes.walk(state.mudfoot, STORE.mudfootBack);
      });
      Scenes.later(scene, 3, () => {
        setStage(player, STAGE.HARLAN_TALK);
        Scenes.fade(player, true);
        hold(player);
      });
      Scenes.later(scene, 5, () => backToHarlan(player));
    });
  }

  /** Out of the copy at Harlan's post [439]; the screen comes back [444] and he talks [446]. */
  function backToHarlan(player) {
    const state = plays.get(player) ?? {};
    state.returning = true;
    Scenes.end(player, false);
    player.moveTo(new Location(...STORE.post.player));
    Scenes.restoreTabs(player);
    Scenes.controls(player, true);
    setVis(player, VIS.FOLLOWING);
    deps.sync(player, { followerAt: STORE.post.mudfoot });
    player.setPositionToFace(new Location(...STORE.post.mudfoot));
    deps.faceHarlan(player);
    Scenes.later(player, 5, () => Scenes.fade(player, false));
    Scenes.later(player, 7, () => {
      plays.delete(player);
      Scenes.controls(player, false);
      Scenes.closeFade(player);
      harlanTalk(player);
    });
  }

  const H = (text, anim) => npcLine(NPC.HARLAN, text, anim);

  /** The talk at Harlan's post [446-586]; the quest's stage 8. */
  function harlanTalk(player) {
    play(player, [
      H("Right, regarding these thieves... You said that your goblin friend wasn't able to kill them?", CHAT.NEUTRAL2),
      MV("Me try hit them with big hammer, but it no work.", CHAT.CONFUSED1),
      H("I see. Did they have armour?", CHAT.QUIZ1),
      P("Yes, the armour of a ranger.", CHAT.NEUTRAL1),
      MV("Yes, ranger. Other goblins tell me rangers die best when you hit them up close. That what me do. Go close and big smack.", CHAT.CONFUSED3),
      H("Ah... Tell me... Mudfoot... have you heard of something called the combat triangle?", CHAT.QUIZ2),
      MV("Triangle? Like roof?", CHAT.QUIZ1),
      H("Yes, sometimes...", CHAT.CONFUSED1),
      H("Anyway, when those goblin friends of yours told you that melee works best against a ranger, that's what they were referring to.", CHAT.CONFUSED3),
      MV("But why triangle?", CHAT.QUIZ1),
      H("Well, melee often works best against an opponent using ranged, ranged typically works best when fighting an opponent using magic, and magic is normally the best option when fighting someone using melee.", CHAT.NEUTRAL4),
      MV("But that what me do. Me do the close up hit. Why no work?", CHAT.CONFUSED2),
      H("The combat triangle isn't the only thing to consider when taking on a foe. The way that you're attacking is also important. Take melee for example. You have crushing attacks, slashing attacks and stabbing attacks.", CHAT.NEUTRAL4),
      MV("Oh, me like to do big crush best. That why me have big hammer.", CHAT.HAPPY2),
      H("Indeed, but the armour typically worn by a ranger is quite resilient to crushing attacks. You'll likely find you have better luck with a stabbing attack instead.", CHAT.NEUTRAL3),
      H("Of course, for that, you'll need the right weapon. As you've already noted, something like a warhammer works well for crushing, but if your aim is to stab, a weapon like a dagger or shortsword will work best.", CHAT.NEUTRAL4),
      MV("So me go get big poker, then nasty bow man die?", CHAT.QUIZ1),
      H("Well, there are no guarantees of course, but it will definitely improve your odds.", CHAT.NEUTRAL2),
      MV("Yes... Me know all this already of course. Me just pretended not to so trusty human sidekick can do learning. Me know human afraid to ask for help.", CHAT.HAPPY3),
      P("That's not-", CHAT.DISGRUNTLED),
      MV("It okay though. This why human sidekick and me in charge.", CHAT.HAPPY2),
      P("Hmm... Shall we go and find that outlaw and try again?", CHAT.DISGRUNTLED),
      MV("Yes! They go north towards that windmill. Me go grab poker and meet sidekick there. You make sure you grab poker as well.", CHAT.HAPPY3),
      H("I can sort you out with a suitable weapon if needed, adventurer. Alternatively, the local blacksmith should be able to sell you one, or give you some advice on making your own.", CHAT.NEUTRAL4),
      MV("Weapon good. No steal one though. Stealing bad, as Mudfoot always say, apart from when it okay, which isn't now.", CHAT.HAPPY3),
      P("Words to live by... Anything else we should grab before we do this?", CHAT.CONFUSED2),
      H("Given you're going into a fight, some food would be wise.", CHAT.NEUTRAL2),
      MV("This true. Food make you feel better if you get hit, but me never get hit, so me never need food.", CHAT.HAPPY2),
      P("If you say so.", CHAT.CONFUSED1),
      MV("Okay, time to go now.", CHAT.HAPPY1),
    ], () => departs(player, STAGE.WINDMILL, VIS.WINDMILL, () => {
      play(player, [H("It seems you know what you need to do next. Good luck, adventurer.", CHAT.NEUTRAL2)], () => deps.afterSceneMenu(player));
    }));
  }

  /**
   * "Mudfoot departs.": the box shows as the screen fades [580, 1319]; three ticks on the stage moves and he goes
   * [583, 1322], a tick later the screen comes back with the box again [584, 1323], and the talk goes on from it.
   */
  function departs(player, stage, vis, next) {
    hold(player, "Mudfoot departs.");
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, 3, () => {
      setStage(player, stage);
      setVis(player, vis);
      deps.sync(player);
    });
    Scenes.later(player, 4, () => {
      Scenes.fade(player, false);
      Scenes.controls(player, false);
      play(player, [{ box: "Mudfoot departs." }], next);
    });
  }

  // ==========================================================================
  // The fights
  // ==========================================================================

  function fightFor(stage) {
    if (stage === STAGE.WINDMILL || stage === STAGE.RANGER_FIGHT) return "ranger";
    if (stage === STAGE.TO_MAGE || stage === STAGE.MAGE_FIGHT) return "mage";
    if (stage === STAGE.TO_WARRIOR || stage === STAGE.WARRIOR_FIGHT) return "warrior";
    return null;
  }

  /** The fade starts as the line or Confront is answered; the copy opens two ticks later [720/722, 894/896, 1157/1159]. */
  function startFight(player, kind) {
    if (Scenes.get(player) || plays.has(player)) return;
    plays.set(player, { kind, hinted: new Set(), pending: true });
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, 2, () => { if (online(player)) openFight(player, kind); });
  }

  function fightRules(player) {
    return {
      multi: true,
      npcAggression: () => false,
      // Ours: a teleport leaves the fight (the copy goes; Mudfoot waits where mba_mudfoot_vis says).
      canTeleport: () => true,
      allowSummonPet: false,
      canAttack: (attacker, target) => {
        const state = plays.get(player);
        if (!state?.outlaw) return null;
        if (attacker === player && target === state.outlaw) return true;
        if (attacker === state.outlaw && target === player) return true;
        if (attacker === state.mudfoot && target === state.outlaw) return true;
        return false;
      },
      process: (mobile) => keepMudfootFighting(player, mobile),
    };
  }

  function openFight(player, kind) {
    const fight = FIGHTS[kind];
    const [chunkX, chunkY] = fight.sourceChunk;
    deps.clearNpcs(player);
    setStage(player, fight.stage);
    setVis(player, fight.waitVis);
    const scene = Scenes.open(player, fight.name, [[chunkX * 8, chunkX * 8 + 103, chunkY * 8, chunkY * 8 + 103, 0]], fightRules(player), {
      instance: { sourceChunk: fight.sourceChunk }, at: fight.at, exit: fight.at,
    });
    const state = plays.get(player) ?? { kind, hinted: new Set() };
    state.pending = false;
    plays.set(player, state);
    for (const loc of fight.locs) Scenes.loc(scene, loc, NO_OPS);
    state.outlaw = Scenes.actor(scene, fight.outlawId, fight.outlaw, fight.outlawFace);
    state.mudfoot = Scenes.actor(scene, fight.mudfootId, fight.mudfoot, fight.mudfootFace);
    // The copy is their arena: neither gives up on a target for being far from where it was placed.
    for (const npc of [state.outlaw, state.mudfoot]) npc?.setFlag?.("combat:no-retreat", true);
    Scenes.later(scene, 2, () => {
      Scenes.fade(player, false);
      Scenes.controls(player, false);
    });
    if (fight.shout) Scenes.later(scene, fight.shout[0], () => state.outlaw?.forceChat(fight.shout[1]));
    Scenes.later(scene, fight.outlawAttack, () => state.outlaw?.getCombat?.().attack(player));
    Scenes.later(scene, fight.mudfootAttack, () => {
      state.attacking = true;
      if (state.outlaw) state.mudfoot?.getCombat?.().attack(state.outlaw);
    });
  }

  /**
   * Run on the owner's tick (the area's process sees the player): Mudfoot keeps at the outlaw once his first swing
   * is due. NPC pursuit steps straight at its target, so with the player between them he would wait behind the
   * player; stuck out of reach for two ticks, he walks round to a free tile beside the outlaw (the capture has him
   * come in from the side, ticks 1162-1170).
   */
  function keepMudfootFighting(player, mobile) {
    const state = plays.get(player);
    if (mobile !== player || !state?.mudfoot?.isRegistered?.() || !state.outlaw?.isRegistered?.() || state.dying || !state.attacking) return;
    const mudfoot = state.mudfoot;
    const combat = mudfoot.getCombat?.();
    if (combat?.getTarget?.() !== state.outlaw) combat?.attack(state.outlaw);
    if (state.kind === "mage") return; // he throws rocks from where he stands
    const at = mudfoot.getLocation();
    const outlaw = state.outlaw.getLocation();
    const beside = Math.abs(at.getX() - outlaw.getX()) + Math.abs(at.getY() - outlaw.getY()) === 1;
    const moved = state.lastMudfootTile && !state.lastMudfootTile.equals(at);
    state.lastMudfootTile = at.clone ? at.clone() : at;
    state.stuck = beside || moved ? 0 : (state.stuck ?? 0) + 1;
    if (state.stuck < 2) return;
    state.stuck = 0;
    const here = player.getLocation();
    const free = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => new Location(outlaw.getX() + dx, outlaw.getY() + dy, outlaw.getZ()))
      .filter((tile) => !tile.equals(here))
      .sort((a, b) => a.getDistance(at) - b.getDistance(at));
    if (!free.length) return;
    // Square corners: a diagonal step past the player's tile counts as blocked.
    const to = free[0];
    const corners = [new Location(to.getX(), at.getY(), at.getZ()), new Location(at.getX(), to.getY(), at.getZ())]
      .filter((corner) => !corner.equals(here));
    combat.preserveMovementForTicks(4);
    const queue = mudfoot.getMovementQueue().reset();
    if (corners.length) queue.addSteps(corners[0]);
    queue.addSteps(to);
  }

  function sceneStateOf(npc) {
    const player = npc?.__questSceneOwner;
    const state = player ? plays.get(player) : null;
    return state && Scenes.get(player) ? { player, state } : null;
  }

  /** What the player hits the outlaw with: combat type, melee bonus (0 stab, 1 slash, 2 crush), and whether the weapon can stab. */
  function styleOf(player, hit) {
    const type = hit?.getCombatType?.();
    const bonus = player.getFightType?.()?.getBonusType?.();
    const canStab = (player.getWeapon?.()?.getFightType?.() ?? []).some((fightType) => fightType.getBonusType() === 0);
    return { type, bonus, canStab };
  }

  /** The player's hits: Mudfoot's hint at a wrong style, the mage's second shout at the first hit. */
  function playerHit({ player, target, hit }) {
    const state = plays.get(player);
    if (!state?.outlaw || target !== state.outlaw || !Scenes.get(player)) return;
    const fight = FIGHTS[state.kind];
    if (fight?.hitShout && !state.hitShouted) {
      state.hitShouted = true;
      state.outlaw.forceChat(fight.hitShout);
    }
    const line = HINTS[state.kind]?.(styleOf(player, hit));
    if (line && !state.hinted.has(line)) {
      state.hinted.add(line);
      state.mudfoot?.forceChat(line);
    }
  }

  /** Mudfoot starts the fight's re-attacks once his first swing is out; the warrior's prayers block what they cover. */
  function outlawHit({ npc, hit }) {
    const found = sceneStateOf(npc);
    if (!found) return;
    const { player, state } = found;
    if (npc === state.mudfoot) return;
    if (npc !== state.outlaw) return;
    const attacker = hit?.getAttacker?.();
    if (!FIGHTS[state.kind]?.prays) return;
    const type = hit?.getCombatType?.();
    const protects = state.protecting === PROTECT.MELEE ? CombatType.MELEE : state.protecting === PROTECT.MISSILES ? CombatType.RANGED : null;
    if (protects !== null && type === protects && !hit.bypassesProtectionPrayer?.()) {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
      if (attacker === state.mudfoot && !state.prayedShouted) {
        state.prayedShouted = true;
        state.mudfoot.forceChat(PRAYED_LINE);
      }
    }
    if (!state.prayerQueued) {
      // The first hit he takes [1163]; he prays four ticks on [1167].
      state.prayerQueued = true;
      const scene = Scenes.get(player);
      if (scene) Scenes.later(scene, 4, () => pray(state, PROTECT.MELEE, true));
    } else if (state.protecting && attacker === player) {
      // Ours: the Wiki says he uses Protect from Melee and Protect from Missiles; he turns to the player's style.
      if (type === CombatType.RANGED && state.protecting !== PROTECT.MISSILES) pray(state, PROTECT.MISSILES, false);
      else if (type === CombatType.MELEE && state.protecting !== PROTECT.MELEE) pray(state, PROTECT.MELEE, false);
    }
  }

  function pray(state, prayer, shout) {
    if (!state.outlaw?.isRegistered?.() || state.dying) return;
    const { PrayerHandler } = api.core;
    if (state.protecting) PrayerHandler.deactivatePrayer(state.outlaw, PrayerHandler[state.protecting]);
    PrayerHandler.activatePrayerPrayerId?.(state.outlaw, PrayerHandler[prayer]);
    state.protecting = prayer;
    if (shout) state.outlaw.forceChat(PRAYER_LINE);
  }

  /** The kill: the fade at once [749, 924, 1191], out of the copy two ticks later with the loot on the real tile. */
  function outlawDying(event) {
    const found = sceneStateOf(event.npc);
    if (!found || event.npc !== found.state.outlaw || found.state.dying) return;
    const { player, state } = found;
    state.dying = true;
    state.dropTile = Scenes.toSource(player, event.npc.getLocation());
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, 2, () => { if (online(player)) leaveFight(player, state); });
  }

  function leaveFight(player, state) {
    const fight = FIGHTS[state.kind];
    state.won = true;
    Scenes.end(player, false);
    setStage(player, fight.next);
    for (const vis of fight.nextVis) setVis(player, vis);
    dropLoot(player, fight.outlawId, state.dropTile);
    deps.sync(player);
    Scenes.later(player, 6, () => {
      Scenes.fade(player, false);
      Scenes.controls(player, false);
    });
    Scenes.later(player, 8, () => {
      plays.delete(player);
      Scenes.closeFade(player);
      deps.afterFight(player, fight.next);
    });
  }

  /** The kill's own table (npc-drops.json), rolled and laid on the real tile, as the capture's ground items there [751, 926, 1193]. */
  function dropLoot(player, npcId, tile) {
    if (!tile) return;
    const drops = [];
    api.emitCustomEvent("npc-drops:roll-table", { player, npcId, drops });
    api.emitCustomEvent("npc-drops:place", { player, drops, location: tile, npcId });
  }

  /** NpcDrops would roll the kill inside the copy as it goes; the quest lays it on the real tile itself. */
  function claimLoot(event) {
    const npcId = event.npcId;
    if (npcId === NPC.RANGER_COMBAT || npcId === NPC.MAGE_COMBAT || npcId === NPC.WARRIOR_COMBAT) event.handled = true;
  }

  function sceneEnded(player, scene, logout) {
    const state = plays.get(player);
    if (state?.returning || state?.won) return;
    plays.delete(player);
    // A scene left before its end: the store goes back to the outlaw outside (stage 6, or 8 past the walk back),
    // a fight keeps its stage with Mudfoot at his waiting spot.
    // Ours: Mudfoot is with the player again after a store scene left early (live sets 1 during it).
    if (scene?.name === "store") setVis(player, VIS.FOLLOWING);
    if (!logout) {
      Scenes.restoreTabs(player);
      Scenes.closeFade(player);
      deps.sync(player);
    }
  }

  return {
    confrontStore, startFight, fightFor, harlanTalk, departs, playerHit, outlawHit, outlawDying, claimLoot,
    /** A scene is open, or fading in to open. */
    inScene: (player) => Scenes.get(player) !== null || plays.get(player)?.pending === true,
    /** A scene, its fades or its talk still owns the player (no new scene may start). */
    busy: (player) => Scenes.get(player) !== null || plays.has(player),
    FACE,
  };
};

module.exports.FACE = FACE;
