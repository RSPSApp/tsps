// Sir Kuam Ferentse's room (room 3): Sir Leye, whom no blade may defeat.
//
// rsprox capture RecruitmentDrive.bin (revision 242.1), ticks 851-905, 964-1101, 1977-2030,
// 2510-2553, 3311-3354:
//   - Arriving, Sir Kuam says his two lines (each with a continue); as the second is closed Sir
//     Leye (4682) appears beside him with smokepuff (86), says "No blade may defeat me!" over his
//     head, and a hint arrow points at him (ticks 864-866).
//   - The four steel weapons lie on the table's tiles 2458-2461,4967 (shortsword, claws, battleaxe,
//     warhammer), each back a tick or so after it is picked up (ticks 853, 872-876, 987-988).
//   - Sir Leye has 20 hitpoints. Dealing the last of them with the shortsword fails the room: "You
//     have failed to complete this room's puzzle..." and his "AH-HA HA HA! ..." with a continue,
//     then the fade (ticks 898-905). Unarmed he dies (human_death) and the room is passed with the
//     observer's line (ticks 1068, 2013, 2545, 3341). The Wiki: the warhammer is the only
//     non-bladed weapon; dying while wielding a bladed one fails the test.
//   - A talk to Sir Kuam before then repeats his two lines (tick 994).
module.exports = function createKuamRoom(api, course, ids) {
  const ROOM = 3;
  const NPC = ids.SIR_KUAM_FERENTSE;
  const LEYE = ids.SIR_LEYE;
  const SMOKEPUFF = 86;
  const LEYE_SAYS = "No blade may defeat me!";
  const FAILED = "You have failed to complete this room's puzzle...";
  const V_ENTER = "the-tests-sir-kuam-ferentse-entering-the-room";
  const V_LEYE = "the-tests-sir-kuam-ferentse-talking-to-sir-leye";
  const WEAPONS = [ids.STEEL_SHORTSWORD, ids.STEEL_CLAWS, ids.STEEL_BATTLEAXE, ids.STEEL_WARHAMMER];
  const WEAPON_Y = 4967;
  const WEAPON_X = [2458, 2459, 2460, 2461];
  const WEAPON_DESPAWN = 6000; // obj_add_specific despawn=5999
  // Ours: Sir Leye appeared at 2457,4964 / 2458,4962 / 2456,4962 in the captures; one of them.
  const LEYE_TILES = [[2457, 4964], [2458, 4962], [2456, 4962]];

  /** Player -> { leye, weapons: Map(groundItem -> index) } for the room. */
  const fights = new WeakMap();

  function introLines() {
    return course.lines(course.variant(V_ENTER)).filter((line) => line.speaker !== "Sir Leye")
      .map((line) => ({ npc: NPC, text: line.text }));
  }

  function enter(player) {
    const fight = { leye: null, weapons: new Map() };
    fights.set(player, fight);
    WEAPONS.forEach((_, index) => layWeapon(player, fight, index));
    course.say(player, introLines(), () => spawnLeye(player));
  }

  function layWeapon(player, fight, index) {
    const { Item, Location } = api.core;
    const ground = api.getItemOnGroundManager()?.registerLocation?.(player, new Item(WEAPONS[index], 1),
      new Location(WEAPON_X[index], WEAPON_Y, 0), player.getPrivateArea(), { goesGlobal: false, despawnDelay: WEAPON_DESPAWN });
    if (ground) fight.weapons.set(ground, index);
  }

  function spawnLeye(player) {
    const fight = fights.get(player);
    if (!fight || fight.leye || !course.inRoom(player, ROOM) || course.isPassed(player, ROOM)) return;
    const [x, y] = LEYE_TILES[Math.floor((ids.random ?? Math.random)() * LEYE_TILES.length)];
    const npc = api.spawnNpc({ id: LEYE, x, y, z: 0, wanderRadius: 2, owner: player, ownerOnly: true });
    if (!npc) return;
    fight.leye = npc;
    npc.performGraphic?.(new api.core.Graphic(SMOKEPUFF));
    npc.forceChat?.(LEYE_SAYS);
    player.getPacketSender().sendEntityHint(npc);
  }

  function clear(player) {
    const fight = fights.get(player);
    if (!fight) return;
    fights.delete(player);
    if (fight.leye) {
      api.removeNpc(fight.leye);
      player.getPacketSender().sendEntityHintRemoval(false);
    }
    const manager = api.getItemOnGroundManager();
    for (const ground of fight.weapons.keys()) manager?.deregister?.(ground);
  }

  function retakeWeapon(event) {
    const fight = fights.get(event.player);
    const index = fight?.weapons.get(event.groundItem);
    if (index === undefined) return;
    fight.weapons.delete(event.groundItem);
    course.later(event.player, 1, () => {
      if (fights.get(event.player) === fight) layWeapon(event.player, fight, index);
    });
  }

  function ownerOf(npc) {
    if (npc?.getId?.() !== LEYE) return null;
    const owner = npc.getOwner?.();
    return owner && fights.get(owner)?.leye === npc ? owner : null;
  }

  function bladed(player) {
    const weapon = player.getEquipment().get(api.core.Equipment.WEAPON_SLOT);
    const id = weapon?.getId?.() ?? -1;
    return id > 0 && id !== ids.STEEL_WARHAMMER;
  }

  function beforeDeath(event) {
    const player = ownerOf(event.npc);
    if (!player || !bladed(player)) return;
    event.preventDeath = true;
    event.npc.setHitpoints(event.npc.getDefinition().getHitpoints());
    event.npc.getCombat?.()?.reset?.();
    player.getCombat?.()?.reset?.();
    player.sendMessage(FAILED);
    const lines = course.lines(course.variant(V_LEYE)).map((line) => ({ npc: LEYE, text: line.text }));
    course.fail(player, lines);
  }

  function death(event) {
    const player = ownerOf(event.npc);
    if (!player) return;
    const fight = fights.get(player);
    fight.leye = null;
    player.getPacketSender().sendEntityHintRemoval(false);
    if (!course.inRoom(player, ROOM)) return;
    course.sayPassed(player, NPC, course.passRoom(player, ROOM));
  }

  function talk(event) {
    const { player } = event;
    if (!course.inRoom(player, ROOM) || !fights.has(player)) return false;
    if (course.isPassed(player, ROOM)) {
      // Ours: no capture talks to him after the fight; the passed line again.
      course.say(player, course.passLines(Math.min(course.passedCount(player), 3)).map((text) => ({ npc: NPC, text })));
      return true;
    }
    course.say(player, introLines(), () => spawnLeye(player));
    return true;
  }

  function playerDied({ player }) {
    if (course.inRoom(player, ROOM)) course.abandon(player);
  }

  course.defineRoom(ROOM, { enter, clear });
  api.onNpcInteraction("Sir Kuam Ferentse", { "Talk-to": talk });
  api.onGroundItemPickup(retakeWeapon);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(death);
  api.onPlayerDeath(playerDied);

  return { fights, bladed };
};
