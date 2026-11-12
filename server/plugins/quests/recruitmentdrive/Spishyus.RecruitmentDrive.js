// Sir Spishyus' room (room 1): the fox, the chicken and the grain across the precarious bridge.
//
// rsprox capture RecruitmentDrive.bin (revision 242.1), ticks 2280-2441, 2781-2820, 3011-3112,
// 3174-3311:
//   - Arriving, the whole introduction plays; rd_room1_intro_chat (691) is set as the player's
//     "Okay, I'll see what I can do." shows.
//   - Pick-up on a pile wears the item: the grain (5607) in the cape slot, the fox (5608) as the
//     weapon, the chicken (5609) as the shield, with put_down 2739 / wolf_attack 909 /
//     chicken_attack 355. rd_room1_initiated (670) is set with the first. Each item has a left
//     varbit (680 fox, 682 chicken, 684 grain: 0 on the left pile, 1 not) and a right one (681,
//     683, 685: 1 on the right pile); the multilocs 7275-7283 read them.
//   - Taking a worn item off puts it on the pile of the side the player stands on (wolf_attack2
//     910, chicken_hit 357, put_down 2739). With all three on the right the room is passed:
//     rd_room1_complete (659) and "Congratulations! You have solved this room's puzzle!".
//   - Cross (7286 on the left, 7287 on the right) carrying more than 5 kg: "I really don't think I
//     should be carrying more than 5 Kg ..." Otherwise "You carefully walk across the rickety
//     bridge..." and the eight tiles across, one a tick.
//   - Nine ticks after the crossing starts the side left behind is checked: the chicken left with
//     the grain eats it (left: 682 and 684 to 2; right: 683 and 685 to 3), the fox left with the
//     chicken eats it (right: 683 to 2, 681 to 3); the failure line follows the tick after.
module.exports = function createSpishyusRoom(api, course, ids) {
  const ROOM = 1;
  const NPC = ids.SIR_SPISHYUS;
  const V_ENTER = "the-tests-sir-spishyus-entering-the-room";
  const V_ONCE = "the-tests-sir-spishyus-talking-to-sir-spishyus-once";
  const V_SECOND = "the-tests-sir-spishyus-talking-to-sir-spishyus-a-second-time";
  const V_HEAVY = "the-tests-sir-spishyus-attempting-to-cross-the-precarious-bridge-with-too-much-weight";
  const INTRO_VARBIT = 691;
  const INITIATED_VARBIT = 670;
  const SOLVED = "Congratulations! You have solved this room's puzzle!";
  const CROSSING = "You carefully walk across the rickety bridge...";
  const MAX_GRAMS = 5000;
  const CHECK_AFTER = 9;
  const LEFT_END_X = 2484;
  const RIGHT_END_X = 2476;
  const BRIDGE_Y = 4972;

  const CARGO = [
    { key: "fox", item: 5608, slot: 3, left: 680, right: 681, leftLoc: 7275, rightLoc: 7276, take: 909, drop: 910 },
    { key: "chicken", item: 5609, slot: 5, left: 682, right: 683, leftLoc: 7279, rightLoc: 7280, take: 355, drop: 357 },
    { key: "grain", item: 5607, slot: 1, left: 684, right: 685, leftLoc: 7282, rightLoc: 7283, take: 2739, drop: 2739 },
  ];
  const byItem = new Map(CARGO.map((cargo) => [cargo.item, cargo]));
  const byLoc = new Map(CARGO.flatMap((cargo) => [[cargo.leftLoc, [cargo, "left"]], [cargo.rightLoc, [cargo, "right"]]]));

  /** Player -> { where: { fox, chicken, grain }: "left" | "worn" | "right", crossing } for the room. */
  const rooms = new WeakMap();

  function state(player) {
    return course.inRoom(player, ROOM) ? rooms.get(player) ?? null : null;
  }

  function enter(player) {
    rooms.set(player, { where: { fox: "left", chicken: "left", grain: "left" }, crossing: false });
    const lines = course.lines(course.variant(V_ENTER));
    course.say(player, lines.map((line, index) => {
      const entry = line.player ? { player: line.player } : { npc: NPC, text: line.text };
      if (index === lines.length - 1) entry.onShow = () => player.getPacketSender().sendVarbit(INTRO_VARBIT, 1);
      return entry;
    }));
  }

  function clear(player) {
    rooms.delete(player);
  }

  function talk(event) {
    if (!state(event.player)) return false;
    const entries = [...course.lines(course.variant(V_ONCE)), ...course.lines(course.variant(V_SECOND))]
      .map((line) => (line.player ? { player: line.player } : { npc: NPC, text: line.text }));
    course.say(event.player, entries);
    return true;
  }

  function side(player) {
    const x = player.getLocation().getX();
    if (x >= LEFT_END_X) return "left";
    if (x <= RIGHT_END_X) return "right";
    return null;
  }

  function wear(player, cargo) {
    const { Item } = api.core;
    player.getEquipment().setItem(cargo.slot, new Item(cargo.item, 1));
    player.getEquipment().refreshItems();
    if (cargo.slot === api.core.Equipment.WEAPON_SLOT) api.core.EquipPacketListener.resetWeapon(player, true);
    player.getUpdateFlag().flag(api.core.Flag.APPEARANCE);
  }

  function takeOff(player, cargo) {
    const { Item } = api.core;
    player.getEquipment().setItem(cargo.slot, new Item(-1, 0));
    player.getEquipment().refreshItems();
    if (cargo.slot === api.core.Equipment.WEAPON_SLOT) api.core.EquipPacketListener.resetWeapon(player, true);
    player.getUpdateFlag().flag(api.core.Flag.APPEARANCE);
  }

  function pickUp(event) {
    const { player, objectId } = event;
    const room = state(player);
    const entry = byLoc.get(objectId);
    if (!room || !entry || room.crossing) return false;
    const [cargo, pile] = entry;
    if (room.where[cargo.key] !== pile) return true;
    const sender = player.getPacketSender();
    if (sender.getVarbit(INITIATED_VARBIT) === 0) sender.sendVarbit(INITIATED_VARBIT, 1);
    room.where[cargo.key] = "worn";
    sender.sendVarbit(pile === "left" ? cargo.left : cargo.right, pile === "left" ? 1 : 0);
    wear(player, cargo);
    sender.sendSound(cargo.take, 255, 0);
    return true;
  }

  function putDown(event) {
    const { player } = event;
    const room = state(player);
    const cargo = byItem.get(event.item?.getId?.());
    if (!room || !cargo || room.where[cargo.key] !== "worn") return;
    event.allow = false;
    const where = side(player);
    if (!where || room.crossing) return;
    takeOff(player, cargo);
    room.where[cargo.key] = where;
    const sender = player.getPacketSender();
    if (where === "left") sender.sendVarbit(cargo.left, 0);
    else sender.sendVarbit(cargo.right, 1);
    sender.sendSound(cargo.drop, 255, 0);
    if (CARGO.every((entry) => room.where[entry.key] === "right")) {
      course.passRoom(player, ROOM);
      player.sendMessage(SOLVED);
    }
  }

  function carriedGrams(player) {
    let grams = 0;
    for (const item of [...player.getEquipment().getValidItems(), ...player.getInventory().getValidItems()]) {
      grams += (api.core.ItemDefinition.forId(item.getId())?.getWeight?.() ?? 0) * Math.max(1, item.getAmount?.() ?? 1);
    }
    return grams;
  }

  function cross(event) {
    const { player } = event;
    const room = state(player);
    if (!room) return false;
    if (room.crossing || course.isPassed(player, ROOM)) return true;
    if (carriedGrams(player) > MAX_GRAMS) {
      course.say(player, course.lines(course.variant(V_HEAVY)).map((line) => ({ player: line.player ?? line.text })));
      return true;
    }
    const from = side(player);
    if (!from) return true;
    room.crossing = true;
    player.sendMessage(CROSSING);
    const path = [];
    if (from === "left") for (let x = LEFT_END_X - 1; x >= RIGHT_END_X; x--) path.push([x, BRIDGE_Y]);
    else for (let x = RIGHT_END_X + 1; x <= LEFT_END_X; x++) path.push([x, BRIDGE_Y]);
    ids.ObstacleRunner.run({ player }, [{ walk: path }], { onFinish: () => { room.crossing = false; } });
    course.later(player, CHECK_AFTER, () => check(player, room, from));
    return true;
  }

  /** Something left unattended on the side the player crossed from is eaten. */
  function check(player, room, behind) {
    if (state(player) !== room) return;
    const there = (key) => room.where[key] === behind;
    const sender = player.getPacketSender();
    const set = (cargo, leftValue, rightValue) => sender.sendVarbit(behind === "left" ? cargo.left : cargo.right,
      behind === "left" ? leftValue : rightValue);
    const [fox, chicken, grain] = CARGO;
    if (there("fox") && there("chicken")) {
      // The capture has the fox eat on the right (681 3, 683 2). Ours: on the left the fat fox
      // (680 2) and the chicken gone (682 3), by the multilocs' forms.
      set(fox, 2, 3);
      set(chicken, 3, 2);
    } else if (there("chicken") && there("grain")) {
      set(chicken, 2, 3);
      set(grain, 2, 3);
    } else {
      return;
    }
    course.later(player, 1, () => {
      if (state(player) === room) course.fail(player, [{ npc: NPC, text: course.failLine() }]);
    });
  }

  course.defineRoom(ROOM, { enter, clear });
  api.onNpcInteraction("Sir Spishyus", { "Talk-to": talk });
  for (const name of ["Fox", "Chicken", "Grain"]) api.onObjectInteraction(name, { "Pick-up": pickUp });
  api.onObjectInteraction("Precarious bridge", { Cross: cross });
  api.onCanUnequip(putDown);

  return { CARGO, rooms };
};
