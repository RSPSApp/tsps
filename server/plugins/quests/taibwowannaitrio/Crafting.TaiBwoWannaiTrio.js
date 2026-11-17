/**
 * Tai Bwo Wannai Trio's item work: the vessel, the banana rum, the sandwich, the burnt and marinated jogre
 * bones and the poisoned spears. The pastes are ground by Herblore's grinding (skills/data/herblore.json).
 *
 * As RSProx captures local 1001562 (revision 241) and 75 (revision 227) show them:
 * - Raw Karambwanji on vessels loads them, one every 2 ticks, with no message (local 1001562 ticks 6004-6007).
 * - A tinderbox on jogre bones lights them as logs are lit (Firemaking.js): the bones go on the ground,
 *   "You attempt to light the Jogre bones.", human_createfire; 3 ticks later the light roll (the Wiki's
 *   chance by Firemaking level, retried every 4 ticks), the player steps aside and the tick after, "The fire
 *   catches and the bones begin to burn." with the Burning bones loc (3862), sound 2596 and 90 Firemaking
 *   XP; 35 ticks on the fire is gone and the burnt bones lie there (ticks 6820-6868). Firemaking 30 (Wiki).
 * - Raw-paste burnt bones on a fire: "You marinate the burnt bones perfectly.", human_firecooking, sound
 *   2577, 100 Cooking XP (tick 6980; 75 tick 4297).
 * - Poisonous Karambwan paste on a spear: "You smear the poisonous Karambwan paste over the spear." (tick
 *   7004); the raw and cooked pastes don't poison weapons (Wiki: Karambwan paste).
 * - Seaweed on the monkey skin: "You sandwich the seaweed in the monkey skin." (tick 7331).
 * Wiki (Burnt jogre bones, Pasty jogre bones): bones on a fire only heat; a furnace burns them for 25 Cooking
 * XP; cooked-paste bones explode for 2 damage.
 */
module.exports = function attachCrafting(api, t) {
  const { ITEM, LOC } = t;
  const { Skill, Location, Item, Animation, GameObject, ObjectManager, ItemOnGroundManager, Sounds, Sound, HitDamage, HitMask } = api.core;
  const { lightingSuccessChance, canLightFireAt } = require("../../skills/firemaking/Logs.Firemaking");

  const NEED_FIREMAKING = "You need a firemaking level of 30 to burn Jogre bones. You could find some other way of burning them.";
  const FIRE_HEATS = "You heat the bones over the fire, but they don't look any different.";
  const RANGE_HEATS = "You heat the bones, but they don't look any different.";
  const FIREMAKING_LEVEL = 30;
  const MARINATE_LEVEL = 30;
  const BONES_FIREMAKING_XP = 90;
  const MARINATE_COOKING_XP = 100;
  const FURNACE_COOKING_XP = 25;
  const EXPLOSION_DAMAGE = 2;
  const LIGHT_ANIMATION = 733; // human_createfire
  const COOK_ANIMATION = 897; // human_firecooking
  const COOK_SOUND = 2577;
  const FIRST_ROLL_TICKS = 3;
  const RETRY_TICKS = 4;
  const BURN_TICKS = 35;
  const LOAD_TICKS = 2;
  const FIRES = new Set(["Fire"]);
  const RANGES = new Set(["Range", "Cooking range", "Stove", "Fireplace", "Clay oven"]);
  const FURNACE = "Furnace";

  const SPEARS = new Map();
  for (const [ids, kp] of [
    [[1237, 1251, 5704, 5718], 3170], [[1239, 1253, 5706, 5720], 3171], [[1241, 1255, 5708, 5722], 3172],
    [[1243, 1257, 5710, 5724], 3173], [[1245, 1259, 5712, 5726], 3174], [[1247, 1261, 5714, 5728], 3175],
    [[1249, 1263, 5716, 5730], 3176], [[4580, 4582, 5734, 5736], 4584],
  ]) for (const id of ids) SPEARS.set(id, kp);
  const KARAMBWANS = new Set([ITEM.RAW_KARAMBWAN, ITEM.COOKED_KARAMBWAN, ITEM.POORLY_COOKED_KARAMBWAN]);
  const lighting = new WeakMap();

  const spam = (player, text) => player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, text);

  function swap(player, from, to, also) {
    t.take(player, from);
    if (also !== undefined) t.take(player, also);
    player.getInventory().adds(to, 1);
  }

  /** Raw Karambwanji into each empty vessel: the first the tick after the click, then one every 2 ticks while the player stays put. */
  function loadVessels(player) {
    const from = player.getLocation().clone();
    const step = () => {
      if (!t.held(player, ITEM.VESSEL) || !t.held(player, ITEM.RAW_KARAMBWANJI) || !player.getLocation().equals(from)) return;
      swap(player, ITEM.VESSEL, ITEM.LOADED_VESSEL, ITEM.RAW_KARAMBWANJI);
      t.later(player, LOAD_TICKS, step);
    };
    t.later(player, 1, step);
  }

  function lightBones(player) {
    if (t.level(player, Skill.FIREMAKING) < FIREMAKING_LEVEL) {
      player.sendMessage(NEED_FIREMAKING);
      return;
    }
    // One set at a time; a second use while it is being lit does nothing. Walked off, the old attempt is over.
    const current = lighting.get(player);
    if (current && player.getLocation().equals(current.tile)) return;
    const tile = player.getLocation().clone();
    const area = player.getPrivateArea();
    // Where logs can't be lit ("You can't light a fire here."), neither can the bones (Firemaking's own check).
    if (!canLightFireAt(player, tile, area)) return;
    t.take(player, ITEM.JOGRE_BONES);
    ItemOnGroundManager.registerLocation(player, new Item(ITEM.JOGRE_BONES, 1), tile, area);
    const attempt = { tile };
    lighting.set(player, attempt);
    const tryLight = () => {
      spam(player, "You attempt to light the Jogre bones.");
      player.performAnimation(new Animation(LIGHT_ANIMATION));
    };
    const roll = () => {
      if (lighting.get(player) !== attempt) return;
      const ground = ItemOnGroundManager.getGroundItem(player.getUsername(), ITEM.JOGRE_BONES, tile, area);
      if (!player.getLocation().equals(tile) || !ground) {
        lighting.delete(player); // walked off, or the bones were picked up: they stay as they are
        return;
      }
      if (Math.random() >= lightingSuccessChance(t.level(player, Skill.FIREMAKING))) {
        tryLight();
        t.later(player, RETRY_TICKS, roll);
        return;
      }
      lighting.delete(player);
      ItemOnGroundManager.deregister(ground);
      step(player);
      t.worldLater(1, () => burn(player, tile, area));
    };
    tryLight();
    t.later(player, FIRST_ROLL_TICKS, roll);
  }

  /** As a lit log: the first free tile west, east, south or north (Firemaking's stepAwayFromFire). */
  function step(player) {
    const queue = player.getMovementQueue();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (queue?.canWalk?.(dx, dy)) {
        queue.walkStep(dx, dy);
        return;
      }
    }
  }

  function burn(player, tile, area) {
    const fire = new GameObject(LOC.BURNING_BONES, tile.clone(), 10, 1, area);
    ObjectManager.register(fire, true);
    player.setPositionToFace?.(tile);
    t.addXp(player, Skill.FIREMAKING, BONES_FIREMAKING_XP);
    Sounds.sendSound(player, Sound.FIRE_SUCCESSFUL);
    spam(player, "The fire catches and the bones begin to burn.");
    // On a world timer, as Firemaking's fires: it burns out and leaves the bones even if the player logs out.
    t.worldLater(BURN_TICKS, () => {
      ObjectManager.deregister(fire, true);
      ItemOnGroundManager.registerLocation(player, new Item(ITEM.BURNT_JOGRE_BONES, 1), tile, area);
    });
  }

  function itemOnItem(event) {
    const { player } = event;
    const ids = [event.usedItemId, event.usedWithItemId];
    const has = (id) => ids.includes(id);
    const other = (id) => (ids[0] === id ? ids[1] : ids[0]);
    let message = null;
    if (has(ITEM.JOGRE_BONES) && has(ITEM.TINDERBOX)) {
      lightBones(player);
    } else if (has(ITEM.RAW_KARAMBWANJI) && has(ITEM.VESSEL)) {
      loadVessels(player);
    } else if (has(ITEM.RAW_KARAMBWANJI_PASTE) && (has(ITEM.JOGRE_BONES) || has(ITEM.BURNT_JOGRE_BONES))) {
      const burnt = has(ITEM.BURNT_JOGRE_BONES);
      swap(player, burnt ? ITEM.BURNT_JOGRE_BONES : ITEM.JOGRE_BONES, burnt ? ITEM.BURNT_RAW_PASTY_BONES : ITEM.RAW_PASTY_BONES, ITEM.RAW_KARAMBWANJI_PASTE);
      message = burnt ? "You smother the raw Karambwanji paste over the burnt Jogre bones." : "You smother the raw Karambwanji paste over the Jogre bones.";
    } else if (has(ITEM.COOKED_KARAMBWANJI_PASTE) && (has(ITEM.JOGRE_BONES) || has(ITEM.BURNT_JOGRE_BONES))) {
      const burnt = has(ITEM.BURNT_JOGRE_BONES);
      swap(player, burnt ? ITEM.BURNT_JOGRE_BONES : ITEM.JOGRE_BONES, burnt ? ITEM.BURNT_COOKED_PASTY_BONES : ITEM.COOKED_PASTY_BONES, ITEM.COOKED_KARAMBWANJI_PASTE);
      message = burnt ? "You smother the cooked Karambwanji paste over the burnt Jogre bones." : "You smother the cooked Karambwanji paste over the Jogre bones.";
    } else if ((has(ITEM.RAW_KARAMBWAN_PASTE) || has(ITEM.POISON_KARAMBWAN_PASTE) || has(ITEM.COOKED_KARAMBWAN_PASTE))
      && (has(ITEM.JOGRE_BONES) || has(ITEM.BURNT_JOGRE_BONES))) {
      // Wiki transcript: "I'm sure Tinsay said to use Karambwanji paste, not Karambwan paste..."
      t.play(player, t.NPC.TIMFRAKU, "making-the-burnt-marinated-jogre-bones", (steps) => steps.slice(0, 1).flatMap((step) => step.steps ?? []));
    } else if (has(ITEM.POISON_KARAMBWAN_PASTE) && SPEARS.has(other(ITEM.POISON_KARAMBWAN_PASTE))) {
      swap(player, other(ITEM.POISON_KARAMBWAN_PASTE), SPEARS.get(other(ITEM.POISON_KARAMBWAN_PASTE)), ITEM.POISON_KARAMBWAN_PASTE);
      spam(player, "You smear the poisonous Karambwan paste over the spear.");
    } else if ([...KARAMBWANS].some(has) && SPEARS.has(ids.find((id) => SPEARS.has(id)))) {
      message = "This blasted Karambwan just falls off the spear! My life is becoming such a grind...";
    } else if (has(ITEM.SEAWEED) && has(ITEM.MONKEY_CORPSE)) {
      swap(player, ITEM.MONKEY_CORPSE, ITEM.STUFFED_MONKEY, ITEM.SEAWEED);
      message = "You stuff the seaweed into the monkey corpse, creating a stuffed monkey.";
    } else if (has(ITEM.SEAWEED) && has(ITEM.MONKEY_SKIN)) {
      swap(player, ITEM.MONKEY_SKIN, ITEM.SEAWEED_SANDWICH, ITEM.SEAWEED);
      message = "You sandwich the seaweed in the monkey skin.";
    } else if (has(ITEM.MONKEY_CORPSE) && has(ITEM.KNIFE)) {
      message = "You don't know how to skin a monkey ... yet.";
    } else if (has(ITEM.BANANA) && has(ITEM.KNIFE)) {
      swap(player, ITEM.BANANA, ITEM.SLICED_BANANA);
      message = "You deftly chop the bananas into slices.";
    } else if (has(ITEM.BANANA) && has(ITEM.KARAMJAN_RUM)) {
      swap(player, ITEM.BANANA, ITEM.BANANA_RUM, ITEM.KARAMJAN_RUM);
      message = "You stuff the banana into the neck of the bottle. You begin to wonder why.";
    } else if (has(ITEM.SLICED_BANANA) && has(ITEM.KARAMJAN_RUM)) {
      swap(player, ITEM.SLICED_BANANA, ITEM.SLICED_BANANA_RUM, ITEM.KARAMJAN_RUM);
      message = "You add the banana slices to the Karamjan rum.";
    } else {
      return;
    }
    if (message) player.sendMessage(message);
    event.handled = true;
  }

  function explode(player, itemId) {
    t.take(player, itemId);
    player.getInventory().adds(ITEM.ASHES, 1);
    player.sendMessage("The cooked karambwanji paste catches fire and explodes.");
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(EXPLOSION_DAMAGE, HitMask.RED)]);
  }

  function marinate(player, from, to) {
    if (t.level(player, Skill.COOKING) < MARINATE_LEVEL) {
      player.sendMessage(RANGE_HEATS);
      return;
    }
    swap(player, from, to);
    player.performAnimation(new Animation(COOK_ANIMATION));
    player.getPacketSender().sendSound(COOK_SOUND, 1, 0);
    t.addXp(player, Skill.COOKING, MARINATE_COOKING_XP);
    spam(player, "You marinate the burnt bones perfectly.");
  }

  function itemOnObject(event) {
    const name = event.object?.getDefinition?.()?.getName?.() ?? "";
    const fire = FIRES.has(name);
    if (!fire && !RANGES.has(name) && name !== FURNACE) return;
    const { player, itemId } = event;
    if (name === FURNACE) {
      if (itemId !== ITEM.JOGRE_BONES) return;
      event.handled = true;
      swap(player, ITEM.JOGRE_BONES, ITEM.BURNT_JOGRE_BONES);
      t.addXp(player, Skill.COOKING, FURNACE_COOKING_XP);
      player.sendMessage("You burn the Jogre bones.");
      return;
    }
    switch (itemId) {
      case ITEM.JOGRE_BONES:
      case ITEM.BURNT_JOGRE_BONES:
      case ITEM.MARINATED_UNBURNT_BONES:
        player.sendMessage(fire ? FIRE_HEATS : RANGE_HEATS);
        break;
      case ITEM.BURNT_RAW_PASTY_BONES:
        marinate(player, ITEM.BURNT_RAW_PASTY_BONES, ITEM.MARINATED_BONES);
        break;
      case ITEM.RAW_PASTY_BONES:
        marinate(player, ITEM.RAW_PASTY_BONES, ITEM.MARINATED_UNBURNT_BONES);
        break;
      case ITEM.BURNT_COOKED_PASTY_BONES:
      case ITEM.COOKED_PASTY_BONES:
        explode(player, itemId);
        break;
      default:
        return;
    }
    event.handled = true;
  }

  api.onItemOnItem(itemOnItem);
  api.onItemOnObject(itemOnObject, { noted: false });
  return { lightBones };
};
