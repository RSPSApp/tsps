/**
 * Fairytale I's scenes, as the rsprox captures play them (FairyTale1, rev 242.1; 1001455, rev 241.1;
 * rsprox.net 424, rev 232). Tick numbers below are FairyTale1's unless a recording is named.
 *
 * - Malignius's mushroom (1949-1966): on the continue past his threat he casts (human_casting, synth
 *   zamorak_flame); two ticks later a flame (spotanim 78) bursts on the player's tile, a
 *   mushroom_inactive loc grows there, the player turns into desert_treasure_invisible_npc (synth
 *   human_into_mushroom) and "MMMmmph!" is held without a continue. Twelve ticks later the flame bursts
 *   again, the mushroom goes (synth mushroom_into_human) and the chat closes.
 * - Zandar's "the hard way" (1770-1780): on that continue the player is moved to 3217,3176 with synth
 *   tele_other_cast and no animation; the next line comes a tick later.
 * - The Nature Spirit's blessing (3263-3271): on the continue past "Then let us begin..." the player
 *   kneels (human_fairy_kneel_and_offer), the spirit takes the secateurs (human_fairy_take_and_hold_up,
 *   spotanim fairy_flower_enchant at height 100), the camera moves (from 6 east and 4 south of the
 *   spirit, height 375, rates 100/100) to look at the spirit, synth ft_enchant_flower plays and the chat
 *   closes. Six ticks later the secateurs are enchanted, the camera resets and "It is done!" shows.
 * - The shady grove: at stage 70 the Gate Keeper's line, then the box "You squeeze past the thorny vines
 *   into a small tunnel.", then on its continue human_into_sidestep with synth ft_squeeze_past, and a tick
 *   later a private copy of the grove (rebuild_region of zones 2368-2407 x 4352-4407) with the player at
 *   2396,4379 (3710-3716). After the Tanglefoot (424 ticks 18514-18518) the line moves the player there
 *   in the real grove. Leaving through the gap always shows the box, and its continue plays the sidestep
 *   and sound and moves the player to 2400,4379 (4039-4042; 424 ticks 18589-18591).
 */
const GROVE_INSTANCE_CHUNK = [296, 544];
/** Live copies 5 x 7 zones; QuestScenes copies squares, so 7 x 7 from the same corner. */
const GROVE_INSTANCE_SIZE = 7;
/**
 * Inside the thorny wall: west of the gap (x 2397), and the walkable south-east strip that runs
 * east to x 2400 below y 4367 (the tunnel the capture walks, ticks 3728-3730). The outside at
 * 2400,4379 is only reached through the gap, which ends the scene itself.
 */
const GROVE_BOUNDS = [[2368, 2396, 4352, 4407, 0], [2397, 2400, 4352, 4366, 0]];
const GROVE_INSIDE = [2396, 4379, 0];
const GROVE_OUTSIDE = [2400, 4379, 0];
const SQUEEZE_TEXT = "You squeeze past the thorny vines into a small tunnel.";
/** The Tanglefoot's copy and the baby tanglefootii, where each first shows in the copy (3716-3748). */
const GROVE_ACTORS = [
  { id: "TANGLEFOOT", at: [2375, 4384], wander: 3 },
  { id: "BABY_TANGLEFOOT_2", at: [2394, 4378], wander: 3 },
  { id: "BABY_TANGLEFOOT", at: [2392, 4379], wander: 3 },
  { id: "BABY_TANGLEFOOT", at: [2377, 4376], wander: 3 },
  { id: "BABY_TANGLEFOOT", at: [2376, 4389], wander: 3 },
  { id: "BABY_TANGLEFOOT_2", at: [2375, 4381], wander: 3 },
  { id: "BABY_TANGLEFOOT", at: [2393, 4358], wander: 3 },
  { id: "BABY_TANGLEFOOT", at: [2374, 4392], wander: 3 },
];

module.exports = function createFairytaleIScenes(api, { onGroveEnd } = {}) {
  const {
    Animation, CacheDefinitions, CountdownTask, GameObject, Graphic, Location, NpcIdentifiers,
    ObjectManager, PlayerDialogue, DialogueChainBuilder, Sound, Sounds, TaskManager,
  } = api.core;
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api, {
    recoveryAttribute: "quest.fairytale-i-growing-pains:grove-exit",
    onEnd: (player, scene, logout) => onGroveEnd?.(player, scene, logout),
  });

  const seq = (name, fallback) => CacheDefinitions.getSeqId(name) ?? fallback;
  const spot = (name, fallback) => CacheDefinitions.getSpotanimId(name) ?? fallback;
  const synth = (player, id, delay = 0) => Sounds.sendSound(player, new Sound(id, 1, delay, 1));

  const HUMAN_CASTING = () => seq("human_casting", 811);
  const ZAMORAK_FLAME = () => spot("zamorak_flame", 78);
  const SYNTH_ZAMORAK_FLAME = 229;
  const SYNTH_INTO_MUSHROOM = 907;
  const SYNTH_OUT_OF_MUSHROOM = 908;
  const SYNTH_TELE_OTHER = 199;
  const SYNTH_ENCHANT_FLOWER = 1097;
  const SYNTH_SQUEEZE_PAST = 1107;
  const INVISIBLE_NPC = () => CacheDefinitions.getNpcId("desert_treasure_invisible_npc") ?? 716;
  const MUSHROOM_LOC = () => CacheDefinitions.getLocId("mushroom_inactive") ?? 9572;
  const CHAT_RIGHT_CONTINUE = (217 << 16) | 5;
  const MUSHROOM_TICKS = 12;
  const MUSHROOM_CAST_TICKS = 2;
  const ZANDAR_DROP = [3217, 3176, 0];
  const BLESSING_CAMERA_OFFSET = [6, -4];
  const BLESSING_CAMERA_HEIGHT = 375;
  const BLESSING_CAMERA_RATES = { rate: 100, rate2: 100 };
  const BLESSING_TICKS = 6;

  const mushrooms = new Map();

  // ==========================================================================
  // Malignius's mushroom
  // ==========================================================================

  /**
   * The continue past his threat: he casts, and the flame lands two ticks later (1951-1954). The
   * scene runs on its own timer, so nothing the player clicks meanwhile can leave it half done.
   */
  function castMushroom(player, malignius) {
    endMushroom(player);
    malignius?.performAnimation?.(new Animation(HUMAN_CASTING()));
    synth(player, SYNTH_ZAMORAK_FLAME);
    player.getMovementQueue().reset().setBlockMovement(true);
    const state = { casting: true };
    mushrooms.set(player, state);
    TaskManager.submit(new CountdownTask(state, MUSHROOM_CAST_TICKS, () => {
      if (mushrooms.get(player) === state) becomeMushroom(player);
    }));
  }

  /** The player is a mushroom for twelve ticks, saying a held "MMMmmph!" (1954-1966). */
  function becomeMushroom(player) {
    endMushroom(player, false, true);
    const tile = player.getLocation().clone();
    const flame = new Graphic(ZAMORAK_FLAME());
    player.getPacketSender().sendGraphic(flame, tile);
    const object = new GameObject(MUSHROOM_LOC(), tile, 10, 1, player.getPrivateArea?.() ?? null);
    ObjectManager.register(object, true);
    synth(player, SYNTH_INTO_MUSHROOM);
    player.setNpcTransformationId(INVISIBLE_NPC());
    // Held: the line shows with its continue blanked and not clickable (1954).
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new api.core.ActionDialogue(0, { execute: () => {
        new PlayerDialogue(0, "MMMmmph!").send(player);
        player.getPacketSender().sendString("", CHAT_RIGHT_CONTINUE).sendInterfaceFlagsRange(CHAT_RIGHT_CONTINUE, -1, -1, 0);
      } }, true)));
    const state = { object, tile };
    mushrooms.set(player, state);
    TaskManager.submit(new CountdownTask(state, MUSHROOM_TICKS, () => endMushroom(player, true)));
  }

  function endMushroom(player, natural = false, keepBlocked = false) {
    const state = mushrooms.get(player);
    if (!state) return;
    mushrooms.delete(player);
    TaskManager.cancelTasks(state);
    if (state.casting) {
      if (!keepBlocked) player.getMovementQueue().setBlockMovement(false);
      return;
    }
    if (natural) player.getPacketSender().sendGraphic(new Graphic(ZAMORAK_FLAME()), state.tile);
    ObjectManager.deregister(state.object, true);
    player.setNpcTransformationId(-1);
    player.getMovementQueue().setBlockMovement(false);
    if (natural) {
      synth(player, SYNTH_OUT_OF_MUSHROOM);
      player.getDialogueManager().reset?.();
      const sender = player.getPacketSender();
      const open = sender.getChatboxGroupId?.() ?? -1;
      if (open >= 0) sender.closeInterface(open);
    }
  }

  // ==========================================================================
  // Zandar Horfyre's teleport
  // ==========================================================================

  function zandarTeleport(player) {
    player.moveTo(new Location(...ZANDAR_DROP));
    synth(player, SYNTH_TELE_OTHER);
  }

  // ==========================================================================
  // The Nature Spirit's blessing
  // ==========================================================================

  const blessings = new Map();

  /**
   * `onDone` runs six ticks on (the secateurs, then "It is done!"); the scene keeps its own time, so
   * a click during it cannot strand the player blocked or the camera moved.
   */
  function startBlessing(player, spirit, onDone) {
    endBlessing(player);
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new Animation(seq("human_fairy_kneel_and_offer", 3256)));
    if (spirit) {
      spirit.performAnimation(new Animation(seq("human_fairy_take_and_hold_up", 3257)));
      spirit.performGraphic(Graphic.atHeight(spot("fairy_flower_enchant", 568), 100));
      player.setPositionToFace?.(spirit.getLocation());
    }
    const at = (spirit ?? player).getLocation();
    const sender = player.getPacketSender();
    sender.sendCameraMoveTo(at.getX() + BLESSING_CAMERA_OFFSET[0], at.getY() + BLESSING_CAMERA_OFFSET[1],
      BLESSING_CAMERA_HEIGHT, BLESSING_CAMERA_RATES);
    sender.sendCameraLookAt(at.getX(), at.getY(), BLESSING_CAMERA_HEIGHT, BLESSING_CAMERA_RATES);
    synth(player, SYNTH_ENCHANT_FLOWER);
    const state = { start: player.getLocation().clone() };
    blessings.set(player, state);
    TaskManager.submit(new CountdownTask(state, BLESSING_TICKS, () => {
      if (blessings.get(player) !== state) return;
      endBlessing(player);
      onDone?.();
    }));
  }

  function endBlessing(player) {
    const state = blessings.get(player);
    if (!state) return false;
    blessings.delete(player);
    TaskManager.cancelTasks(state);
    player.getMovementQueue().setBlockMovement(false);
    player.getPacketSender().sendCameraReset();
    return true;
  }

  const blessing = (player) => blessings.get(player) ?? null;

  // ==========================================================================
  // The shady grove
  // ==========================================================================

  /** The box (the dialogue layer echoes it to chat as live's mesbox line). */
  function squeezeBox(player, then) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new api.core.StatementDialogue(0, SQUEEZE_TEXT))
      .add(new api.core.ActionDialogue(1, { execute: () => {
        player.getDialogueManager().reset?.();
        then();
      } })));
  }

  function sidestep(player) {
    player.performAnimation(new Animation(seq("human_into_sidestep", 752)));
    synth(player, SYNTH_SQUEEZE_PAST);
  }

  /** The Tanglefoot's copy of the grove, a tick after the sidestep (3715-3716). */
  function openGrove(player) {
    const scene = Scenes.open(player, "tanglefoot", GROVE_BOUNDS, {
      canTeleport: () => null,
      npcAggression: () => null,
    }, { instance: { sourceChunk: GROVE_INSTANCE_CHUNK, size: GROVE_INSTANCE_SIZE }, at: GROVE_INSIDE, exit: GROVE_OUTSIDE });
    for (const { id, at: [x, y], wander } of GROVE_ACTORS) {
      const tile = Scenes.tileFor(scene, [x, y, 0]);
      const npc = api.spawnNpc({ id: NpcIdentifiers[id], x: tile.getX(), y: tile.getY(), z: 0, owner: player, ownerOnly: true, wanderRadius: wander });
      if (!npc) continue;
      npc.__skipDefaultRespawn = true;
      npc.__questSceneOwner = player;
      scene.area?.add(npc);
      scene.actors.push(npc);
    }
    return scene;
  }

  /** Squeezing in at stage 70: the box, the sidestep, then the copy. */
  function enterGroveCopy(player) {
    squeezeBox(player, () => {
      sidestep(player);
      player.getMovementQueue().reset().setBlockMovement(true);
      TaskManager.submit(new CountdownTask(player, 1, () => {
        player.getMovementQueue().setBlockMovement(false);
        if (player.isRegistered?.() === false) return;
        openGrove(player);
      }));
    });
  }

  /** After the Tanglefoot the line moves the player straight into the real grove (424 tick 18518). */
  function enterGrove(player) {
    player.moveTo(new Location(...GROVE_INSIDE));
  }

  /** The gap from the inside: the box, then the sidestep out to 2400,4379. */
  function leaveGrove(player) {
    squeezeBox(player, () => {
      if (Scenes.get(player)) Scenes.end(player, false);
      player.moveTo(new Location(...GROVE_OUTSIDE));
      sidestep(player);
    });
  }

  const groveScene = (player) => Scenes.get(player);
  const toSource = (player, location) => Scenes.toSource(player, location);

  function cleanup(player) {
    endMushroom(player);
    endBlessing(player);
  }

  return {
    castMushroom, becomeMushroom, endMushroom, zandarTeleport,
    startBlessing, endBlessing, blessing, BLESSING_TICKS,
    enterGroveCopy, enterGrove, leaveGrove, groveScene, toSource, cleanup,
    GROVE_INSIDE, GROVE_OUTSIDE, SQUEEZE_TEXT,
  };
};
