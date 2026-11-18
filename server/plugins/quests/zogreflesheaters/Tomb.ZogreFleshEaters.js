/**
 * Zogre Flesh Eaters under Jiggig, as the revision 242 capture plays it (rsprox ZogreFleshEaters.bin;
 * docs/quests/zogre-flesh-eaters/README.md "Capture facts"):
 *
 * - Brentle Vahn's skeleton (loc 6893): on arrival a smoke puff (spotanim 188) on the tile south of
 *   it, then a tick later the zombie (880) rises there with "Something screams into life right in
 *   front of you.", a hint arrow and `thzfe_brentle_skele` (503) = 1; it attacks at once. Its death
 *   sets 503 = 2 (its drop table leaves the backpack); the corpse then has nothing (ticks 442-495).
 * - The north-west coffin (loc 6843, a multiloc on 488): the knife's box, then lifting the lid:
 *   the box, "Urrrgggg." and "Aarrrgghhh!" each held three ticks as a chathead line with no
 *   continue and overhead, then the failure box (Strength drained 1-3, ticks 599-647) or
 *   "Raarrrggggg! Yes!" (488 = 3, coffin_open 54) and the success box two ticks later (591-664).
 * - The other Ogre coffins' Open: the "lid ... won't budge" message box (ticks 349-374, 566).
 * - The ogre stone doors: the key line on entering or "You push the gates open." leaving, the
 *   player stepping through as the two leaves swing open (inviswall + the open leaves one tile
 *   south) and shut two ticks later (ticks 2390-2399, 2721-2727).
 * - The stand: "You search the plinth..." and, a tick after its Continue, Slash Bash (882) with a
 *   smoke puff, "Something stirs behind you!" and a hint arrow (ticks 2437-2439). His drop table
 *   leaves the bones and the artefact; the stage moves to 12 as he dies (tick 2650). The Wiki's
 *   five-minute despawn ends a fight left alone with the transcript's "grows weary" line.
 */
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
const { STAGES } = require("./State.ZogreFleshEaters");

const SMOKE_PUFF_SPOTANIM = 188;
const SMOKE_PUFF_SOUND = 1930;
const UNLOCK_SOUND = 2419;
const COFFIN_OPEN_SOUND = 54;
const DOOR_SCRAPE_SOUND = 2410;
const CHATANG1 = 614;
const CHATHAP1 = 567;

const BRENTLE_ZOMBIE_ID = 880;
const BRENTLE_ZOMBIE_TILE = [2442, 9458, 2];
const SLASH_BASH_ID = 882;
const SLASH_BASH_TILE = [2478, 9445, 0];
const SLASH_BASH_PUFF_TILE = [2477, 9444, 0];
/** The Wiki: "He will despawn after five minutes". */
const SLASH_BASH_DESPAWN_TICKS = 500;

const SKELETON_ID = 6893;
const NORTH_WEST_COFFIN_ID = 6843; // zogre_coffin_special_entity, a multiloc on 488
const LOCKED_COFFIN_IDS = new Set([6848, 6850, 6883]); // ogre_coffin, ogre_wall_coffin, ogre_dark_coffin
const LOCKED_COFFIN_TEXT = "The lid to the coffin feels very solid, it won't budge. However, you can see a very crude lock mechanism, maybe a key will open it?";
const STAND_ID = 6897;
/** ogre_cavedoorl/r, and the open leaves (ogre_cavedoorl_inactive 6874, ogre_cavedoorr_inactive 6873) and inviswall 38848 they swap with. */
const STONE_DOOR_LEFT = 6872;
const STONE_DOOR_RIGHT = 6871;
const STONE_DOOR_LEFT_OPEN = 6874;
const STONE_DOOR_RIGHT_OPEN = 6873;
const INVISWALL = 38848;
const STONE_DOORS = [
  { y: 9433, left: [2442, 9433], right: [2441, 9433] },
  { y: 9426, left: [2441, 9426], right: [2440, 9426] },
];
const DOOR_OPEN_TICKS = 2;

const LIFT_VARIANT = "entering-jiggig-search-ogre-coffin-after-unlocking-it";
const LIFT_STEPS = { prepare: "WielTW", noRoom: "Z2e7iB", fail: "IXYxwm", success: "D53WoV" };
const LIFT_GRUNTS = ["Urrrgggg.", "Aarrrgghhh!"];
const LIFT_CHEER = "Raarrrggggg! Yes!";
const LIFT_LINE_TICKS = 3;

module.exports = function attachTomb(api, ctx) {
  const {
    ActionDialogue, CountdownTask, DialogueChainBuilder, GameObject, Graphic, Location,
    MapObjects, ObjectManager, PlayerDialogue, Skill, StatementDialogue, TaskManager,
  } = api.core;
  ObstacleRunner.init(api);

  const zombieByPlayer = new Map();
  const slashBashByPlayer = new Map();
  const stage = (player) => ctx.quest().getStage(player);
  const tile = ([x, y, z]) => new Location(x, y, z);
  const later = (player, ticks, callback) => TaskManager.submit(new CountdownTask(player, ticks, callback));
  const alive = (npc) => npc && npc.isRegistered?.() !== false && !npc.isDying?.() && npc.getHitpoints?.() > 0;

  function puff(player, at) {
    player.getPacketSender().sendGraphic(new Graphic(SMOKE_PUFF_SPOTANIM), tile(at));
  }

  function spawnFor(player, id, at, map) {
    const npc = api.spawnNpc({ id, x: at[0], y: at[1], z: at[2], owner: player, ownerOnly: true });
    if (!npc) return null;
    map.set(player, npc);
    player.getPacketSender().sendEntityHint(npc);
    npc.getCombat?.().attack?.(player);
    return npc;
  }

  // --------------------------------------------------------------------------
  // Brentle Vahn's skeleton
  // --------------------------------------------------------------------------

  function searchSkeleton(event) {
    const { player } = event;
    event.handled = true;
    const state = Number(player.getAttribute(ctx.SKELETON_ATTRIBUTE)) || 0;
    if (state >= 2) {
      ctx.skeletonSearched(player);
      return;
    }
    if (alive(zombieByPlayer.get(player))) {
      player.sendMessage("You're in mortal danger, you don't have time to search!");
      return;
    }
    puff(player, BRENTLE_ZOMBIE_TILE);
    later(player, 1, () => {
      if (alive(zombieByPlayer.get(player))) return;
      player.setAttribute(ctx.SKELETON_ATTRIBUTE, 1);
      ctx.sync(player);
      const rises = ctx.messageText("entering-jiggig-search-skeleton", "-YDgwF");
      if (rises) player.sendMessage(rises);
      spawnFor(player, BRENTLE_ZOMBIE_ID, BRENTLE_ZOMBIE_TILE, zombieByPlayer);
    });
  }

  // --------------------------------------------------------------------------
  // The north-west coffin's lid
  // --------------------------------------------------------------------------

  function liftLid(player) {
    const sender = player.getPacketSender();
    const manager = player.getDialogueManager();
    const statement = (stepId) => ctx.messageText(LIFT_VARIANT, stepId);
    if (ctx.freeSlots(player) < 1) {
      manager.startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, statement(LIFT_STEPS.noRoom))));
      return;
    }
    const chain = new DialogueChainBuilder();
    let index = 0;
    chain.add(new StatementDialogue(index++, statement(LIFT_STEPS.prepare)));
    const held = (text, expression) => new ActionDialogue(index++, { execute: () => {
      const line = new PlayerDialogue(0, text, expression);
      line.sendHeld(player);
      player.forceChat(text);
      const current = manager.getCurrent?.();
      later(player, LIFT_LINE_TICKS, () => { if (manager.getCurrent?.() === current) manager.advance(); });
    } }, true);
    for (const grunt of LIFT_GRUNTS) chain.add(held(grunt, CHATANG1));
    chain.add(new ActionDialogue(index++, { execute: () => {
      if (Math.random() < ctx.LIFT_CHANCE) {
        ctx.setProgress(player, 3);
        sender.sendSound(COFFIN_OPEN_SOUND, 1, 0);
        const line = new PlayerDialogue(0, LIFT_CHEER, CHATHAP1);
        line.sendHeld(player);
        player.forceChat(LIFT_CHEER);
        later(player, 2, () => manager.startDialogues(new DialogueChainBuilder()
          .add(new StatementDialogue(0, statement(LIFT_STEPS.success)))));
        return;
      }
      const strength = player.getSkillManager();
      const drain = 1 + Math.floor(Math.random() * 3);
      strength.setCurrentLevel(Skill.STRENGTH, Math.max(0, strength.getCurrentLevel(Skill.STRENGTH) - drain));
      manager.startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, statement(LIFT_STEPS.fail))));
    } }, true));
    manager.startDialogues(chain);
  }

  function searchNorthWestCoffin(event) {
    const { player } = event;
    event.handled = true;
    const state = ctx.progress(player);
    if (state >= 3) {
      if (ctx.has(player, ctx.items.BLACK_PRISM)) {
        player.sendMessage("You find nothing inside this time.");
        return;
      }
      ctx.startTranscript(player, ctx.GRISH_NPC_ID, "entering-jiggig-search-the-ogre-coffin-after-it-is-opened");
      return;
    }
    if (state === 2) {
      liftLid(player);
      return;
    }
    ctx.startTranscript(player, ctx.GRISH_NPC_ID, "entering-jiggig-search-ogre-coffin");
  }

  function knifeOnCoffin(player) {
    if (ctx.progress(player) !== 1) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    ctx.setProgress(player, 2);
    player.getPacketSender().sendSound(UNLOCK_SOUND, 1, 0);
    ctx.startTranscript(player, ctx.GRISH_NPC_ID, "entering-jiggig-use-knife-on-ogre-coffin");
  }

  function lockedCoffin(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, LOCKED_COFFIN_TEXT)));
  }

  // --------------------------------------------------------------------------
  // The ogre stone doors
  // --------------------------------------------------------------------------

  const swinging = new Set();

  function swingDoors(door, z) {
    if (swinging.has(door)) return;
    const leaves = [[STONE_DOOR_LEFT, door.left, STONE_DOOR_LEFT_OPEN, 2], [STONE_DOOR_RIGHT, door.right, STONE_DOOR_RIGHT_OPEN, 0]];
    const swaps = [];
    for (const [id, [x, y], openId, openFace] of leaves) {
      const closed = MapObjects.get(id, new Location(x, y, z), null);
      if (!closed) continue;
      const wall = new GameObject(INVISWALL, new Location(x, y, z), closed.getType(), closed.getFace(), null);
      const open = new GameObject(openId, new Location(x, y - 1, z), 0, openFace, null);
      ObjectManager.replaceInPlace(closed, wall);
      ObjectManager.register(open, true);
      swaps.push([closed, wall, open]);
    }
    if (!swaps.length) return;
    swinging.add(door);
    TaskManager.submit(new CountdownTask(null, DOOR_OPEN_TICKS, () => {
      swinging.delete(door);
      for (const [closed, wall, open] of swaps) {
        ObjectManager.deregister(open, true);
        ObjectManager.replaceInPlace(wall, closed);
      }
    }));
  }

  function openStoneDoor(event) {
    const { player, location } = event;
    event.handled = true;
    if (!location) return;
    const door = STONE_DOORS.find((entry) => entry.y === location.y);
    if (!door || ObstacleRunner.isBusy(player)) return;
    const here = player.getLocation();
    const leaving = here.getY() < location.y;
    const text = (stepId) => ctx.messageText("defeating-the-zogres-open-ogre-stone-door", stepId);
    if (!leaving && (!ctx.has(player, ctx.items.OGRE_GATE_KEY) || stage(player) < STAGES.GIVEN_KEY)) {
      player.sendMessage(text("PZQk-p"));
      return;
    }
    player.sendMessage(text(leaving ? "4CI7TE" : "2yYb5q"));
    player.getPacketSender().sendSound(DOOR_SCRAPE_SOUND, 1, 0);
    swingDoors(door, location.z);
    ObstacleRunner.run({ player }, [{ walk: [[here.getX(), leaving ? location.y : location.y - 1]] }]);
  }

  // --------------------------------------------------------------------------
  // The stand and Slash Bash
  // --------------------------------------------------------------------------

  function searchStand(event) {
    const { player } = event;
    event.handled = true;
    if (alive(slashBashByPlayer.get(player))) {
      player.sendMessage("You're in mortal danger, you don't have time to search!");
      return;
    }
    const current = stage(player);
    if (current >= STAGES.KILLED_SLASH_BASH) {
      ctx.startTranscript(player, ctx.GRISH_NPC_ID, "defeating-the-zogres-search-stand-search-the-stand-again");
      return;
    }
    if (current >= STAGES.GIVEN_KEY) {
      ctx.startTranscript(player, ctx.GRISH_NPC_ID, "defeating-the-zogres-search-stand");
      return;
    }
    player.sendMessage("You find nothing in particular.");
  }

  /** The stand transcript's "Slash Bash spawns and attacks." action (1NqRbI). */
  function spawnSlashBash(player) {
    if (alive(slashBashByPlayer.get(player))) return;
    puff(player, SLASH_BASH_PUFF_TILE);
    player.getPacketSender().sendAreaSound(SMOKE_PUFF_SOUND, SLASH_BASH_PUFF_TILE[0], SLASH_BASH_PUFF_TILE[1], 0, 1, 0, 10);
    const npc = spawnFor(player, SLASH_BASH_ID, SLASH_BASH_TILE, slashBashByPlayer);
    if (!npc) return;
    later(player, SLASH_BASH_DESPAWN_TICKS, () => {
      if (slashBashByPlayer.get(player) !== npc || !alive(npc)) return;
      slashBashByPlayer.delete(player);
      api.removeNpc?.(npc);
      player.getPacketSender().clearHintArrow();
      const weary = ctx.messageText("defeating-the-zogres-if-you-flee-from-slash-bash-or-if-he-despawns", "1YE-gO");
      if (weary) player.sendMessage(weary);
    });
  }

  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    if (!player) return;
    if (event.npcId === SLASH_BASH_ID && event.npc && event.npc === slashBashByPlayer.get(player)) {
      slashBashByPlayer.delete(player);
      player.getPacketSender().clearHintArrow();
      if (stage(player) >= STAGES.GIVEN_KEY && stage(player) < STAGES.KILLED_SLASH_BASH) {
        ctx.quest().setStage(player, STAGES.KILLED_SLASH_BASH);
      }
      return;
    }
    if (event.npcId === BRENTLE_ZOMBIE_ID && event.npc && event.npc === zombieByPlayer.get(player)) {
      zombieByPlayer.delete(player);
      player.getPacketSender().clearHintArrow();
      player.setAttribute(ctx.SKELETON_ATTRIBUTE, 2);
      ctx.sync(player);
    }
  }

  function forget(player) {
    for (const map of [zombieByPlayer, slashBashByPlayer]) {
      const npc = map.get(player);
      map.delete(player);
      if (npc && alive(npc)) api.removeNpc?.(npc);
    }
  }

  /** Tomb locs this unit answers; true when it took the click. */
  function objectInteraction(event, op) {
    const { objectId } = event;
    if (objectId === SKELETON_ID && op === "search") return searchSkeleton(event), true;
    if (objectId === NORTH_WEST_COFFIN_ID && op === "search") return searchNorthWestCoffin(event), true;
    if (LOCKED_COFFIN_IDS.has(objectId) && op === "open") {
      event.handled = true;
      lockedCoffin(event.player);
      return true;
    }
    if ((objectId === STONE_DOOR_LEFT || objectId === STONE_DOOR_RIGHT) && op === "open") return openStoneDoor(event), true;
    if (objectId === STAND_ID && op === "search") return searchStand(event), true;
    return false;
  }

  return {
    objectInteraction, knifeOnCoffin, spawnSlashBash, handleNpcDeath, forget,
    NORTH_WEST_COFFIN_ID,
  };
};
