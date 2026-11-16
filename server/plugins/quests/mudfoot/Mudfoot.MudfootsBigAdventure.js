/**
 * Mudfoot and the outlaws outside the scenes: who stands where for the stage, Mudfoot following the player,
 * his talks, and the townsfolk's lines while he follows.
 *
 * Live (rsprox MudfootsBigAdventure, rev 242.1) spawns the cache's base NPCs and shows them by varbit: Mudfoot's
 * waiting spots on mba_mudfoot_vis (the house 16823 at (3246,3250) [181], the windmill 16824 at (3172,3286)
 * facing south [711], the ruined building 16825 at (3172,3241) facing west [1084], the graveyard 16826 at
 * (3245,3199) facing east [1225]) and the outlaws on mba (the store 16833 at (3220,3246) [365], the windmill
 * 16834 at (3165,3289) [715], the ruined building 16838 at (3170,3242) [873], the graveyard 16841 at
 * (3245,3197) facing south [1141]). Here they are the player's own spawns of those base ids, so the same
 * varbits show them. The follower (16827 with his warhammer until the store talk, 16828 with the spear after)
 * appears where the Mudfoot he replaces stood [290, 312, 1098] and goes back to his spot on "I need to do
 * something else." [305, 1053, 1225].
 *
 * At his house he walks up to a player who stops within six tiles and swings at them [189-195]; "Look, that him
 * there!" and the others come when the player nears each outlaw [376, 877, 1149] (Ours: the distance live first
 * said each at: 2, 12 and 7 tiles).
 */
module.exports = function createMudfoot(api, common, deps) {
  const { Animation, HitDamage, HitMask, Location, TaskManager, Task } = api.core;
  const { STAGE, VIS, NPC, CHAT, play, npcLine, playerLine, stageOf, setVis, setStage } = common;
  const P = playerLine;
  const { FACE } = require("./Scenes.MudfootsBigAdventure");

  const SPOTS = {
    [VIS.HOUSE]: { id: NPC.MUDFOOT_HOUSE, x: 3246, y: 3250, face: FACE.W, wander: 3 },
    [VIS.WINDMILL]: { id: NPC.MUDFOOT_WINDMILL, x: 3172, y: 3286, face: FACE.S },
    [VIS.WOODS]: { id: NPC.MUDFOOT_WOODS, x: 3172, y: 3241, face: FACE.W },
    [VIS.GRAVEYARD]: { id: NPC.MUDFOOT_GRAVEYARD, x: 3245, y: 3199, face: FACE.E },
  };
  /** The outlaw the stage shows: [first stage, last stage, spawn, Mudfoot's overhead, its range]. */
  const OUTLAWS = [
    { from: STAGE.RECRUITED, to: STAGE.RECRUITED, id: NPC.RANGER_STORE, x: 3220, y: 3246, face: FACE.N, wander: 1,
      look: "Look, that him there!", near: "Look, that him right there. We kill now.", nearAnim: CHAT.ANGRY1, range: 2 },
    { from: STAGE.WINDMILL, to: STAGE.RANGER_FIGHT, id: NPC.RANGER_WINDMILL, x: 3165, y: 3289, face: FACE.N },
    { from: STAGE.RANGER_DEAD, to: STAGE.MAGE_FIGHT, id: NPC.MAGE_WOODS, x: 3170, y: 3242, face: FACE.N,
      look: "Look! There she is!", near: "Look! There she is! Time for kill!", range: 12 },
    { from: STAGE.MAGE_DEAD, to: STAGE.WARRIOR_FIGHT, id: NPC.WARRIOR_GRAVEYARD, x: 3245, y: 3197, face: FACE.S,
      look: "Look! That him!", near: "Look! He right there! We kill now!", range: 7 },
  ];
  /** Where he goes back to, as he says it ("Okay. Me meet you back ... when you done."). */
  const BACK = [
    [STAGE.REPORT, VIS.GRAVEYARD, "in graveyard"],
    [STAGE.MAGE_DEAD, VIS.WOODS, "outside ruined building behind castle"],
    [STAGE.RANGER_DEAD, VIS.WINDMILL, "outside windmill"],
    [STAGE.RECRUITED, VIS.HOUSE, "outside goblin house"],
  ];
  /** Ours: where Mudfoot will follow; past it he says the Wiki's "Me no want go this way." and goes back. */
  const AREA = { minX: 3140, maxX: 3290, minY: 3150, maxY: 3330 };
  const INTRO_RANGE = 6;
  const LEASH = 15;
  const SEQ_GOBLIN_ATTACK = 6185;
  const SOUND_WARHAMMER = 3514;

  const tracked = new WeakMap();
  const state = (player) => {
    let entry = tracked.get(player);
    if (!entry) tracked.set(player, (entry = { mudfoot: null, outlaw: null, spotted: false, approaching: false, task: null }));
    return entry;
  };

  const M = (head, text, anim, extra) => npcLine(head, text, anim, extra);
  const backFor = (stage) => BACK.find(([from]) => stage >= from) ?? BACK[BACK.length - 1];
  const followerId = (stage) => (stage < STAGE.WINDMILL ? NPC.MUDFOOT_FOLLOWER : NPC.MUDFOOT_FOLLOWER_SPEAR);

  function remove(npc) {
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  }

  function spawn(player, { id, x, y, face, wander = 0 }) {
    const npc = api.spawnNpc({ id, x, y, z: 0, owner: player, ownerOnly: true, wanderRadius: wander, face });
    if (npc) npc.__skipDefaultRespawn = true;
    return npc;
  }

  function clear(player) {
    const entry = tracked.get(player);
    if (!entry) return;
    remove(entry.mudfoot);
    remove(entry.outlaw);
    entry.mudfoot = null;
    entry.outlaw = null;
    entry.approaching = false;
  }

  function besidePlayer(player) {
    const at = player.getLocation();
    return { x: at.getX() + 1, y: at.getY() };
  }

  /** Mudfoot and the outlaw for the stage; `followerAt` places a new follower (the store scene's return). */
  function sync(player, { followerAt } = {}) {
    if (!player || player.isPlayerBot?.() === true) return;
    const entry = state(player);
    const stage = stageOf(player);
    if (deps.inScene(player) || stage < STAGE.SENT || stage >= STAGE.COMPLETE) {
      clear(player);
      stopWatching(player);
      return;
    }
    const vis = common.visOf(player);
    if (vis === VIS.FOLLOWING) {
      const id = followerId(stage);
      if (entry.mudfoot?.getId?.() !== id || !entry.mudfoot.isRegistered?.()) {
        const from = entry.mudfoot?.isRegistered?.() ? entry.mudfoot.getLocation() : null;
        remove(entry.mudfoot);
        const at = followerAt ? { x: followerAt[0], y: followerAt[1] } : from ? { x: from.getX(), y: from.getY() } : besidePlayer(player);
        entry.mudfoot = spawn(player, { id, ...at });
        entry.spotted = false;
      }
      entry.mudfoot?.setFollowing?.(player);
    } else {
      const spot = SPOTS[vis];
      if (!spot) {
        remove(entry.mudfoot);
        entry.mudfoot = null;
      } else if (entry.mudfoot?.getId?.() !== spot.id || !entry.mudfoot.isRegistered?.()) {
        remove(entry.mudfoot);
        entry.mudfoot = spawn(player, spot);
        entry.approaching = false;
      }
    }
    const outlaw = OUTLAWS.find((row) => stage >= row.from && stage <= row.to);
    if (!outlaw) {
      remove(entry.outlaw);
      entry.outlaw = null;
    } else if (entry.outlaw?.getId?.() !== outlaw.id || !entry.outlaw.isRegistered?.()) {
      remove(entry.outlaw);
      entry.outlaw = spawn(player, outlaw);
      entry.spotted = false;
    }
    watch(player);
  }

  const following = (player) => common.visOf(player) === VIS.FOLLOWING && state(player).mudfoot?.isRegistered?.() === true;
  const follower = (player) => (following(player) ? state(player).mudfoot : null);
  const outlawRow = (player) => OUTLAWS.find((row) => row.id === state(player).outlaw?.getId?.());

  /** Whether the player is in reach of the stage's outlaw for Mudfoot's "Look!" lines. */
  function nearOutlaw(player) {
    const entry = state(player);
    const row = outlawRow(player);
    if (!row?.range || !entry.outlaw?.isRegistered?.()) return false;
    return player.getLocation().getDistance(entry.outlaw.getLocation()) <= row.range;
  }

  // --- the watch: a task per player while the quest has someone out ------------------------

  function watch(player) {
    const entry = state(player);
    if (entry.task || (!entry.mudfoot && !entry.outlaw)) return;
    const task = new (class extends Task {
      constructor() { super(1, player, false); }
      execute() {
        if (!player.isRegistered?.() || tracked.get(player) !== entry || (!entry.mudfoot && !entry.outlaw)) {
          entry.task = null;
          this.stop();
          return;
        }
        tick(player, entry);
      }
    })();
    entry.task = task;
    TaskManager.submit(task);
  }

  function stopWatching(player) {
    const entry = tracked.get(player);
    if (!entry?.task) return;
    entry.task.stop();
    entry.task = null;
  }

  const idle = (player) => player.getMovementQueue().isMovings() !== true && player.getMovementQueue().size() === 0;
  const chatting = (player) => player.getDialogueManager?.().isActive?.() === true;

  function tick(player, entry) {
    if (deps.inScene(player)) return;
    const stage = stageOf(player);
    const vis = common.visOf(player);
    if (stage === STAGE.SENT && vis === VIS.HOUSE) approach(player, entry);
    if (vis !== VIS.FOLLOWING || !entry.mudfoot?.isRegistered?.()) return;
    const here = player.getLocation();
    const at = entry.mudfoot.getLocation();
    if (here.getX() < AREA.minX || here.getX() > AREA.maxX || here.getY() < AREA.minY || here.getY() > AREA.maxY) {
      stray(player);
      return;
    }
    if (at.getZ() !== here.getZ() || at.getDistance(here) > LEASH) {
      entry.mudfoot.moveTo(new Location(here.getX() + 1, here.getY(), here.getZ()));
    }
    if (!entry.spotted && nearOutlaw(player)) {
      entry.spotted = true;
      entry.mudfoot.forceChat(outlawRow(player).look);
    }
  }

  /** "Me no want go this way. Me meet you back outside goblin house." (Wiki, one for each spot). */
  function stray(player) {
    const [, vis, where] = backFor(stageOf(player));
    const head = state(player).mudfoot?.getId?.() ?? followerId(stageOf(player));
    setVis(player, vis);
    sync(player);
    play(player, [M(head, `Me no want go this way. Me meet you back ${where}.`)]);
  }

  // --- the house -----------------------------------------------------------------------------

  function approach(player, entry) {
    const mudfoot = entry.mudfoot;
    if (!mudfoot?.isRegistered?.() || chatting(player)) return;
    const distance = mudfoot.getLocation().getDistance(player.getLocation());
    if (!entry.approaching) {
      if (distance > INTRO_RANGE || !idle(player)) return;
      entry.approaching = true;
      mudfoot.setFollowing(player);
      return;
    }
    if (distance > INTRO_RANGE * 2) {
      // Ours: a player who walks off leaves him to go home.
      entry.approaching = false;
      mudfoot.setFollowing(null);
      return;
    }
    if (distance <= 1) {
      entry.approaching = false;
      mudfoot.setFollowing(null);
      recruit(player, mudfoot);
    }
  }

  function swing(player, mudfoot) {
    mudfoot.setPositionToFace(player.getLocation());
    mudfoot.performAnimation(new Animation(SEQ_GOBLIN_ATTACK));
    player.getPacketSender().sendSound(SOUND_WARHAMMER, 1, 0);
    player.performAnimation(new Animation(player.getBlockAnim()));
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(0, HitMask.BLUE).setSource(mudfoot)]);
  }

  /** The house talk [195-290]: he swings as his first and second lines show; stage 6 as the player says "wonderful". */
  function recruit(player, mudfoot) {
    const head = NPC.MUDFOOT_HOUSE;
    play(player, [
      M(head, "Die, human, die!", CHAT.ANGRY1, { on: () => swing(player, mudfoot) }),
      P("Er... What are you doing?", CHAT.CONFUSED1),
      M(head, "Me killing you.", CHAT.ANGRY1, { on: () => swing(player, mudfoot) }),
      P("You're not doing a very good job...", CHAT.CONFUSED1),
      M(head, "Wrong. You dead now.", CHAT.ANGRY1),
      P("Okay... And why are you killing me?", CHAT.CONFUSED1),
      M(head, "Me on quest.", CHAT.ANGRY1),
      P("A quest?", CHAT.CONFUSED1),
      M(head, "Yes. Me going to be great goblin adventurer. Other goblins will call me Mudfoot the... good at quests.", CHAT.ANGRY2),
      P("And what is this quest you're on?", CHAT.CONFUSED1),
      M(head, "Me kill the nasty humans. Nasty humans rob other humans, but then they dump the stuff they rob here. Now we get blamed.", CHAT.ANGRY3),
      P("Wait, so it wasn't you goblins who robbed the General Store?", CHAT.CONFUSED2),
      M(head, "No. We goblins innocent. We never rob, apart from all the other times when we did, but this not those times. This time we no do it.", CHAT.NEUTRAL3),
      M(head, "Look, me have proof.", CHAT.NEUTRAL1),
      { items: [api.core.ItemIdentifiers.TINDERBOX, api.core.ItemIdentifiers.SHEARS], text: "Mudfoot shows you a collection of items from the General Store." },
      M(head, "See. We keep things safe. No touch them at all, apart from when Damptoes try to eat chisel, but he no do that again now. Eating chisel make him throw up and die.", CHAT.NEUTRAL4),
      P("I see... Well, perhaps I can help you with your quest. I'm actually on a quest myself to find whoever robbed the General Store. Maybe we can work together?", CHAT.CONFUSED3),
      M(head, "Hmm... me not really need help. Me very good at quest...", CHAT.CONFUSED2),
      M(head, "But me generous also. Maybe me let human join as sidekick. Human can learn thing or two from Mudfoot.", CHAT.CONFUSED2),
      P("That sounds... wonderful. Where do we begin?", CHAT.CONFUSED1, { on: () => { if (stageOf(player) === STAGE.SENT) setStage(player, STAGE.RECRUITED); } }),
      ...firstThief(player, head),
    ]);
  }

  /** His first-thief line and the follower check, also after he was sent home [309-312]. */
  function firstThief(player, head) {
    const told = () => common.setFlag(player, common.ATTRIBUTE.FIRST_THIEF_TOLD, common.VARBIT.FIRST_THIEF_TOLD);
    const line = M(head, "Other goblins see three humans who dump robbed stuff. We find all humans and make them dead. First one was man with bow. Other goblins see him go back across river. We find him there.", CHAT.NEUTRAL4, { on: told });
    if (deps.hasPet(player)) return [line, M(head, "You pick up follower first. Me no follow you otherwise.")];
    return [
      line,
      P("Alright, let's get going then.", CHAT.CONFUSED1),
      M(NPC.MUDFOOT_FOLLOWER, "Okay. Me behind you.", CHAT.NEUTRAL1, { on: () => follow(player) }),
    ];
  }

  function follow(player) {
    setVis(player, VIS.FOLLOWING);
    sync(player);
  }

  // --- talking to him --------------------------------------------------------------------------

  function talk(event) {
    const { player, npc } = event;
    const entry = state(player);
    if (!common.inProgress(player) || !npc || npc !== entry.mudfoot) return false;
    const stage = stageOf(player);
    const vis = common.visOf(player);
    if (vis === VIS.FOLLOWING) {
      if (stage === STAGE.RANGER_DEAD || stage === STAGE.MAGE_DEAD || stage === STAGE.WARRIOR_DEAD) {
        // Ours: his talk after a fight, left before its end, starts again.
        deps.afterFight(player, stage);
        return true;
      }
      followerMenu(player, npc);
      return true;
    }
    if (vis === VIS.HOUSE && stage === STAGE.SENT) {
      entry.approaching = false;
      npc.setFollowing(null);
      recruit(player, npc);
      return true;
    }
    if (vis === VIS.HOUSE) {
      play(player, [P("Okay, Mudfoot... We need to find whoever robbed the General Store. Where do we begin?", CHAT.CONFUSED2), ...firstThief(player, NPC.MUDFOOT_HOUSE)]);
      return true;
    }
    if (vis === VIS.WINDMILL && (stage === STAGE.WINDMILL || stage === STAGE.RANGER_FIGHT)) {
      play(player, [M(NPC.MUDFOOT_WINDMILL, "Look. Nasty human over there. Kill time now.", CHAT.NEUTRAL1)], () => deps.startFight(player, "ranger"));
      return true;
    }
    const ready = readyLines(stage, npc.getId());
    if (ready) {
      play(player, [P("Ready to continue, Mudfoot?", CHAT.QUIZ1), ...ready, M(NPC.MUDFOOT_FOLLOWER_SPEAR, "Okay. Me behind you.", CHAT.NEUTRAL1, { on: () => follow(player) })]);
      return true;
    }
    return false;
  }

  /** "Ready to continue, Mudfoot?" at each spot (Wiki; the ruined building's captured [1093-1098], the graveyard's [1227-1231]). */
  function readyLines(stage, head) {
    if (stage >= STAGE.RANGER_DEAD && stage <= STAGE.MAGE_FIGHT) {
      return [M(head, "Yes. Other goblins say they see next thief by ruined building, west of shop. They say she use big stick that make air go magic."),
        P("So directly south of here. In that case, shall we get going?")];
    }
    if (stage >= STAGE.MAGE_DEAD && stage <= STAGE.WARRIOR_FIGHT) {
      return [M(head, "Yes. Other goblins see last thief in graveyard. He big warrior, but he also like to pray to stupid god.", CHAT.NEUTRAL2),
        P("So south east of here. Shall we get going?", CHAT.QUIZ1)];
    }
    if (stage >= STAGE.WARRIOR_DEAD && stage < STAGE.REWARD) {
      return [M(head, "Yes. Guard man will want to know about good job.", CHAT.NEUTRAL1), P("Agreed. Shall we go tell him?", CHAT.QUIZ1)];
    }
    return null;
  }

  /** "Where to, Mudfoot?" / "What now, Mudfoot?" and "I need to do something else." [297-318, 804-807, 985-988, 1214-1223]. */
  function followerMenu(player, npc) {
    const stage = stageOf(player);
    const head = npc.getId();
    const report = stage >= STAGE.WARRIOR_DEAD;
    const ask = report ? "What now, Mudfoot?" : "Where to, Mudfoot?";
    const row = nearOutlaw(player) && state(player).spotted ? outlawRow(player) : null;
    const near = row?.near ?? null;
    const answer = report
      ? M(head, "We should go tell guard man that nasty thieves have gone dead.", CHAT.NEUTRAL2)
      : near
        // chatang1 for the store outlaw (rsprox_transcripts/242/900167.txt tick 1241); Ours: chatneu1 for the others.
        ? M(head, near, row.nearAnim)
        : stage >= STAGE.MAGE_DEAD
          ? M(head, "Other goblins say they see last thief in graveyard. He big warrior, but he also like to pray to stupid god.", CHAT.NEUTRAL2)
          : stage >= STAGE.RANGER_DEAD
            ? M(head, "Other goblins say they see next thief by ruined building, west of shop. They say she use big stick that make air go magic.", CHAT.NEUTRAL3)
            : M(head, "Other goblins see man with bow go back across river from goblin house. We find him there.", CHAT.NEUTRAL2);
    const [, vis, where] = backFor(stage);
    play(player, [{ menu: "Select an option", options: [
      [ask, () => play(player, [P(ask, CHAT.QUIZ1), answer])],
      ["I need to do something else.", () => play(player, [
        P("I need to do something else.", CHAT.NEUTRAL1),
        M(head, `Okay. Me meet you back ${where} when you done.`, report ? CHAT.NEUTRAL1 : CHAT.NEUTRAL2),
      ], () => { setVis(player, vis); sync(player); })],
    ] }]);
  }

  // --- the townsfolk ---------------------------------------------------------------------------

  /** Transcript:Mudfoot's Big Adventure, "Talking to NPCs while Mudfoot is following": [speaker, text]; N is the NPC, M Mudfoot. */
  const REACTIONS = new Map([
    ["Bartender", [["N", "No goblins in the pub please!"], ["M", "Okay, me go. Goblins have better super secret pub anyway."]]],
    ["Bob", [["N", "A goblin? Get out! Get out! Get out!"], ["M", "Stupid human have no manners. You need learn to say please."]]],
    ["Border Guard", [["N", "No goblins allowed! Be gone with you!"], ["M", "Rude. Me no want go through stupid gate anyway."]]],
    ["Cook", [["N", "A goblin? I don't think you should be in here..."], ["M", "Okay, but cook man just scared that me cook better than him."]]],
    ["Duke Horacio", [["N", "What's this goblin doing in the castle? Remove it at once!"], ["M", "Fine. Castle rubbish anyway."]]],
    ["Father Aereck", [["N", "No goblins in the church please!"], ["M", "Church? Sorry, me thought this poo pile. That what it look like. Rubbish church for rubbish god."]]],
    ["Father Urhney", [["N", "Go away! I'm meditating!"], ["M", "Meditating? Stupid humans with stupid word for thinking hard. Be more like goblin. We never think hard."]]],
    ["Fred the Farmer", [["N", "Hey! Get out of here!"], ["M", "Fine. Your farm rubbish anyway. You so rubbish you not even got rid of weird not-sheep outside."]]],
    ["Hans", [["N", "Oh, a goblin... Hello there, goblin."], ["M", "Hello. You walk a lot."], ["N", "Yes, I suppose I do."], ["M", "That good. Walking a lot stop you being fat."], ["N", "Yes... I guess you're right."]]],
    ["Millie Miller", [["N", "Oh, sorry, but we don't really want goblins in here..."], ["M", "Loss for you. Goblins way better than humans."]]],
    ["Shop keeper", [["N", "Hey, it's one of the goblins that robbed us. Get out!"], ["M", "We no even rob you! You be nice, or you never get back things that we no rob."]]],
    ["Shop assistant", [["N", "Hey, it's one of the goblins that robbed us. Get out!"], ["M", "We no even rob you! You be nice, or you never get back things that we no rob."]]],
    ["Sigmund", [["N", "Get this monster away from me!"], ["M", "Ha! You scared of goblin? Stupid human is stupid wimp."]]],
  ]);

  function react(event) {
    const { player, npcId } = event;
    const name = event.definition?.getName?.() ?? event.npc?.getCurrentDefinition?.(player)?.getName?.();
    const lines = REACTIONS.get(name);
    const mudfoot = follower(player);
    if (!lines || !mudfoot || !common.inProgress(player)) return false;
    play(player, lines.map(([who, text]) => (who === "N" ? npcLine(npcId, text) : npcLine(mudfoot.getId(), text))));
    event.handled = true;
    return true;
  }

  function logout(player) {
    stopWatching(player);
    clear(player);
    tracked.delete(player);
  }

  /** Turns the real Captain Harlan near the player to face them (the store scene's return, [440]). */
  function faceHarlan(player) {
    const here = player.getLocation();
    for (const npc of api.core.World.getNpcs()) {
      if (npc?.getId?.() !== NPC.HARLAN || npc.getLocation().getZ() !== here.getZ() || npc.getLocation().getDistance(here) > 3) continue;
      npc.setPositionToFace(here);
      return;
    }
  }

  return {
    sync, clear, following, follower, talk, react, logout, faceHarlan, REACTIONS,
    mudfootOf: (player) => tracked.get(player)?.mudfoot ?? null,
    outlawOf: (player) => tracked.get(player)?.outlaw ?? null,
  };
};
