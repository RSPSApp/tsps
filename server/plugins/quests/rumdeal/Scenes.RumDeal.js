/**
 * Rum Deal's scenes as the revision 242 capture plays them (RumDeal.bin; docs/quests/rum-deal/README.md
 * "Scenes"). Ticks below count from the moment that starts each scene.
 *
 * - The knock-out (from "What diversion?", tick 268): the player's "Ow!" with spotanim 245 (delay 20,
 *   height 124), seq 401 and sound 1842 (delay 15) as the chat closes; the fade out at +2; at +6 a copy of
 *   the brewery's top floor with the player at (2142,5105,1), Braindeath (2142,5111) facing north and the
 *   side tabs closed; the camera at +9 and the fade in at +13. Braindeath's and Pete's lines are held
 *   chatheads (no continue) with their words overhead in the capture's pieces, three ticks a piece; Pete
 *   walks in from (2148,5108) to (2144,5111) as he arrives. Fade out at +88, the player at (2144,5108,1) at
 *   +91 and, at +95, the tabs back, the fade in, spotanim 245 and sound 2727; the meeting talk at +98.
 * - The window (Braindeath's "Them!", tick 402): the message box held as the screen fades (15 cycles); the
 *   player on (2152,5098,0) at +1, the camera on the protesters at +2, panning at +3; the box gone and the
 *   rum_deal_title overlay (295) up at +7; down with the fade out at +24, back at +26, the talk on at +27.
 * - Davey's blessing (tick 2141): Davey cheers (862) and the wrench is blessed as the chat closes, the
 *   camera at +4 and +6, the player's flourish (seq 2811, spotanim 465) at +9, the talk on at +12 and the
 *   camera back at +15.
 * - The brew (tick 2548): the camera on the controls as the chat closes, deal_multi_hopper (1355) = 2 at +3,
 *   the camera back and the talk on at +6.
 * - Pete's lifts (ticks 3085 and 3116): the same blow, the fade out at +2, the player moved at +6 and
 *   the fade in with the talk on at +8.
 */
const { createQuestScenes } = require("../QuestScenes");
const { NPCS, TILES, VARBITS, ATTRIBUTES } = require("./State.RumDeal");

const KNOCK_SPOTANIM = 245;
const KNOCK_ANIMATION = 401;
const KNOCK_SOUND = 1842;
const STUNNED_SOUND = 2727;
const CHEER_ANIMATION = 862;
const FLOURISH_ANIMATION = 2811;
const FLOURISH_SPOTANIM = 465;
const TITLE_OVERLAY = 295; // rum_deal_title
const OVERLAY_HUD_UID = (161 << 16) | 8; // toplevel overlay_hud (164:8 in the capture's layout)
const MESSAGEBOX_TEXT_UID = (229 << 16) | 3; // messagebox:text
const SCENE_EXIT_ATTRIBUTE = "rum-deal:scene-exit";

/** The brewery's top floor copied for the knock-out (the capture's rebuild: chunks 267-271, 637-639, plane 1). */
const BREWERY = Object.freeze({ sourceChunk: [267, 637], size: 5 });
const BREWERY_BOUNDS = [[2136, 2175, 5096, 5135, 1]];

/** Cutscene 1's lines: [tick, speaker npc, the overhead pieces]; the transcript gives the words. */
const KNOCK_OUT_LINES = [
  [16, NPCS.BRAINDEATH, ["Arrr... 'Tis lookin' bleak..."]],
  [19, NPCS.PETE, ["Cap'n!"]],
  [24, NPCS.PETE, ["Good news Cap'n!"]],
  [29, NPCS.PETE, ["I found us a hero down", "by the docks!"]],
  [35, NPCS.BRAINDEATH, ["Be they heroic, brave and", "true?"]],
  [41, NPCS.PETE, ["Aye! They also be gullible,", "tied up and unconscious!"]],
  [47, NPCS.PETE, ["They were willing to help", "out some random stranger", "with a good enough sob", "story, so I smacked them", "with a bottle and rowed", "them over."]],
  [65, NPCS.BRAINDEATH, ["Brilliant! The island's", "location will remain a", "secret!"]],
  [74, NPCS.BRAINDEATH, ["Bring 'em here and wake", "'em up."]],
  [80, NPCS.BRAINDEATH, ["We may make it through", "this yet..."]],
];

module.exports = function rumDealScenes(api, ctx) {
  const {
    ActionDialogue, Animation, DialogueChainBuilder, Graphic, Location, NpcDialogue, StatementDialogue,
  } = api.core;
  const Scenes = createQuestScenes(api, { recoveryAttribute: SCENE_EXIT_ATTRIBUTE, onEnd: sceneEnded });
  const playing = new Map();

  function sceneEnded(player, scene, logout) {
    const state = playing.get(player);
    if (!state || state.scene !== scene) return;
    playing.delete(player);
    if (logout) restoreControls(player, false);
  }

  const knock = (player) => {
    player.forceChat("Ow!");
    player.performGraphic(new Graphic(KNOCK_SPOTANIM, 20, 124));
    player.performAnimation(new Animation(KNOCK_ANIMATION));
    player.getPacketSender().sendSound(KNOCK_SOUND, 1, 15);
  };

  /** The chat closed, the player held still (a scene's own hold, not a cutscene). */
  function closeChat(player) {
    const sender = player.getPacketSender();
    const open = sender.getChatboxGroupId?.() ?? -1;
    if (open >= 0) sender.closeInterface(open);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0, { execute: () => {} }, true)));
  }

  function heldLine(player, npcId, text) {
    const name = api.core.NpcDefinition?.forId?.(npcId)?.getName?.() ?? "";
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => new NpcDialogue(0, npcId, text, name).sendHeld(player) }, true)));
  }

  function restoreControls(player, tabs = true) {
    Scenes.controls(player, false);
    if (tabs) Scenes.restoreTabs(player);
    player.getPacketSender().sendCameraReset();
  }

  // ------------------------------------------------------------------ the knock-out and cutscene 1

  /**
   * Pete's blow, cutscene 1 and the meeting: `lines` are the transcript's cutscene lines, in order, which
   * the capture's pieces must spell out (else the whole line goes overhead).
   */
  function knockOut(player, lines, startMeeting) {
    if (playing.has(player)) return;
    const state = { scene: null };
    playing.set(player, state);
    closeChat(player);
    Scenes.controls(player, true);
    knock(player);
    Scenes.later(player, 2, () => Scenes.fade(player, true));
    Scenes.later(player, 6, () => {
      if (playing.get(player) !== state) return;
      // Knocked out once the copy opens: a logout before it leaves Pete's "Hello again!" talk to replay.
      player.setAttribute(ATTRIBUTES.KNOCKED_OUT, 1);
      state.scene = Scenes.open(player, "cutscene 1", BREWERY_BOUNDS, {}, { instance: BREWERY, at: [2142, 5105, 1], exit: [...TILES.WAKE] });
      Scenes.controls(player, true, true);
      Scenes.hideTabs(player);
      state.braindeath = Scenes.actor(state.scene, NPCS.BRAINDEATH, [2142, 5111, 1], [2142, 5112]);
      Scenes.later(state.scene, 3, () => Scenes.camera(player, [2143, 5107, 305], [2143, 5111, 100], { rate: 232, rate2: 232 }));
      Scenes.later(state.scene, 7, () => Scenes.fade(player, false));
      KNOCK_OUT_LINES.forEach(([tick, npcId, pieces], index) => {
        Scenes.later(state.scene, tick - 6, () => {
          const text = lines[index] ?? pieces.join(" ");
          if (npcId === NPCS.PETE && !state.pete) {
            state.pete = Scenes.actor(state.scene, NPCS.PETE, [2148, 5108, 1]);
            Scenes.walk(state.pete, [2144, 5111, 1]);
          }
          const speaker = npcId === NPCS.PETE ? state.pete : state.braindeath;
          heldLine(player, npcId, text);
          const said = pieces.join(" ") === text ? pieces : [text];
          said.forEach((piece, i) => Scenes.later(state.scene, i * 3, () => speaker?.forceChat?.(piece)));
        });
      });
      Scenes.later(state.scene, 82, () => Scenes.fade(player, true));
      Scenes.later(state.scene, 85, () => {
        Scenes.end(player, false);
        Scenes.place(player, [...TILES.WAKE]);
        Scenes.controls(player, true);
        Scenes.later(player, 4, () => {
          playing.delete(player);
          restoreControls(player);
          Scenes.fade(player, false);
          player.performGraphic(new Graphic(KNOCK_SPOTANIM, 0, 124));
          player.getPacketSender().sendSound(STUNNED_SOUND, 1, 0);
          Scenes.later(player, 3, () => startMeeting(player));
        });
      });
    });
  }

  // ------------------------------------------------------------------ the window

  /**
   * Played inside the transcript's own hold (`wait`), so it only sends packets: the box goes up with no
   * continue and is blanked at +7, as live blanks it, without starting a chat of its own.
   */
  function windowScene(player, box, resume) {
    const state = { scene: null };
    playing.set(player, state);
    StatementDialogue.send(player, box, false);
    Scenes.fade(player, true, 15);
    Scenes.later(player, 1, () => {
      Scenes.controls(player, true, true);
      Scenes.hideTabs(player);
      player.moveTo(new Location(2152, 5098, 0));
    });
    Scenes.later(player, 2, () => Scenes.camera(player, [2145, 5088, 310], [2145, 5066, 300]));
    Scenes.later(player, 3, () => {
      Scenes.fade(player, false);
      player.getPacketSender().sendCameraMoveTo(2156, 5088, 310, { rate: 2, rate2: 0 });
    });
    Scenes.later(player, 7, () => {
      player.getPacketSender().sendString("", MESSAGEBOX_TEXT_UID);
      player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, TITLE_OVERLAY, 1);
    });
    Scenes.later(player, 24, () => {
      player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
      Scenes.fade(player, true);
    });
    Scenes.later(player, 26, () => player.moveTo(new Location(...TILES.WAKE)));
    Scenes.later(player, 27, () => {
      playing.delete(player);
      restoreControls(player);
      Scenes.fade(player, false);
      resume();
    });
  }

  // ------------------------------------------------------------------ Davey's blessing and the brew

  /** Davey's blessing and the brew play inside the transcript's own hold (`wait`). */
  function blessing(player, davey, bless, resume) {
    Scenes.controls(player, true);
    davey?.performAnimation?.(new Animation(CHEER_ANIMATION));
    bless();
    const sender = player.getPacketSender();
    Scenes.later(player, 4, () => sender.sendCameraMoveTo(2134, 5099, 180, { rate: 10, rate2: 70 }).sendCameraLookAt(2130, 5099, 100, { rate: 10, rate2: 70 }));
    Scenes.later(player, 6, () => sender.sendCameraMoveTo(2135, 5099, 275, { rate: 1, rate2: 70 }).sendCameraLookAt(2132, 5099, 200, { rate: 10, rate2: 70 }));
    Scenes.later(player, 9, () => {
      player.performAnimation(new Animation(FLOURISH_ANIMATION));
      player.performGraphic(new Graphic(FLOURISH_SPOTANIM));
    });
    Scenes.later(player, 12, () => {
      Scenes.controls(player, false);
      resume();
    });
    Scenes.later(player, 15, () => sender.sendCameraReset());
  }

  function brew(player, resume) {
    Scenes.controls(player, true);
    Scenes.camera(player, [2144, 5106, 250], [2144, 5099, 100], { rate: 232, rate2: 232 });
    Scenes.later(player, 3, () => player.getPacketSender().sendVarbit(VARBITS.MULTI_HOPPER, 2));
    Scenes.later(player, 6, () => {
      restoreControls(player, false);
      resume();
    });
  }

  // ------------------------------------------------------------------ Pete's lifts

  /** "Pirate Pete hits the player on the head." */
  function hit(player) {
    Scenes.controls(player, true);
    const graphic = new Graphic(KNOCK_SPOTANIM, 20, 124);
    player.performGraphic(graphic);
    player.performAnimation(new Animation(KNOCK_ANIMATION));
    player.getPacketSender().sendSound(KNOCK_SOUND, 1, 15);
  }

  /** "Fades to black, player appears on ...": to the other end of the lift, then the talk on. */
  function lift(player, to, resume) {
    Scenes.controls(player, true);
    Scenes.later(player, 2, () => Scenes.fade(player, true));
    Scenes.later(player, 6, () => player.moveTo(new Location(...to)));
    Scenes.later(player, 8, () => {
      Scenes.controls(player, false);
      Scenes.fade(player, false);
      resume();
    });
  }

  function stop(player) {
    playing.delete(player);
    Scenes.cancel(player);
    if (Scenes.get(player)) Scenes.end(player, true);
  }

  const inScene = (player) => playing.has(player);

  return { knockOut, windowScene, blessing, brew, hit, lift, stop, inScene, KNOCK_OUT_LINES };
};
