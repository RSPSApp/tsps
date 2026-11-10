/** Tapoyauik's route, icon puzzle and quest Amoxliatl; RSProx 1695 / OSRS Wiki. */
const CameraShake = require("../../interface/CameraShake.plugin");

module.exports = function ruins(shared) {
  const { api, S, NPC, Scenes, play, after, advance, held, stage, stopFollowing } = shared;
  const { Animation, Graphic, HitDamage, HitMask, Location, Skill, TimerKey } = api.core;
  const ObstacleRunner = require('../../skills/agility/ObstacleRunner.Agility');
  const STATE_ATTRIBUTE = 'the-heart-of-darkness:ruins';
  const PICKAXE = 1265, BARREL = 54517, ROCKS = 54501, DOOR = 55355, CHAIN = 55375, CHAIN_TOP = 54527;
  const LEVERS = [55365, 55366, 55367, 55368], MURALS = [55361, 55362, 55363, 55364];
  const URNS = [55356, 55357, 55358, 55359], ICONS = [29885, 29888, 29887, 29886];
  const STATUES = [54459, 54465, 54471, 54477], ELEMENTS = ['fire', 'water', 'air', 'earth'];
  const STATUE_VARBITS = [11124, 11127, 11125, 11126];
  const STATUE_TILES = [[1605,9627,2],[1608,9624,3],[1608,9638,2],[1605,9635,3]];
  const PLATFORM = 54539, PLATFORM_LEDGE = 54538, HIGH_LEDGE = 54531, LOW_LEDGE = 54541, ICY_LEDGES = [54533,54534];
  const PLATFORM_TILES = [[1698,9655],[1696,9655],[1694,9655],[1694,9657],[1694,9659],[1692,9659]];
  const NUMBER_WORDS = ['Zema', 'Oma', 'Yeya', 'Naui'];
  const FROST_NAGUA_ACTOR = api.core.NpcIdentifiers.FROST_NAGUA;
  const FROST_NAGUA = api.core.NpcIdentifiers.FROST_NAGUA_3;
  const FROST_CRAB = api.core.NpcIdentifiers.FROST_CRAB_2;
  const NAGUAS = [api.core.NpcIdentifiers.FROST_NAGUA_2, FROST_NAGUA];
  const CRAB_TILES = [[1718,9607],[1708,9610],[1709,9604],[1722,9611],[1707,9604],[1716,9616]];
  const V = {
    ENTER: 'initiation-entering-tapoyauik', VULCAN: 'initiation-talking-to-forebearer-vulcan',
    ROCKS: 'initiation-after-clearing-the-rocks', ITZLA: 'initiation-talking-to-prince-itzla-by-the-frozen-door',
    AGAIN: 'initiation-talking-to-prince-itzla-again', OPEN: 'initiation-after-opening-the-door',
    BOSS: 'heart-of-the-ruins', BANISH: 'heart-of-the-ruins-after-defeating-amoxliatl',
  };
  const hostiles = new Map(), mining = new WeakSet();
  const SPEARS = [1682, 1684, 1686, 1688, 1690].flatMap(x => [9602, 9604].map(y => [54503, x, y, 2, 1]));
  const TRAPS = [
    ...SPEARS,
    ...[[1714, 9615, 1, 0], [1712, 9615, 1, 1], [1713, 9615, 1, 0], [1714, 9614, 1, 2], [1712, 9614, 1, 1], [1713, 9614, 1, 0], [1714, 9616, 1, 3], [1712, 9616, 1, 3], [1713, 9616, 1, 0], [1720, 9615, 1, 0], [1721, 9615, 1, 1], [1720, 9616, 1, 0], [1721, 9616, 1, 1], [1711, 9656, 1, 1], [1711, 9657, 1, 3], [1712, 9656, 1, 3], [1712, 9657, 1, 0], [1669, 9654, 0, 0], [1670, 9654, 0, 0], [1669, 9655, 0, 3], [1670, 9655, 0, 1]].map(([x, y, z, face]) => [54504, x, y, z, face]),
  ];
  function state(player) {
    let value = player.getAttribute(STATE_ATTRIBUTE);
    if (!value || typeof value !== 'object') {
      const order = [0, 1, 2, 3];
      for (let i = 3; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      value = { order, intact: Math.floor(Math.random() * 4), repaired: 0, levers: 0, touches: [] };
      player.setAttribute(STATE_ATTRIBUTE, value);
    }
    return value;
  }
  function change(player, values) {
    player.setAttribute(STATE_ATTRIBUTE, { ...state(player), ...values });
    syncVarbits(player);
  }
  function syncVarbits(player) {
    if (stage(player) < S.RUINS) return;
    const data = state(player), sender = player.getPacketSender();
    LEVERS.forEach((_, i) => sender.sendVarbit(11136 + i, (data.levers >> i) & 1));
    STATUES.forEach((_, i) => sender.sendVarbit(STATUE_VARBITS[i], stage(player) >= S.DOOR_OPEN ? 3 : allRepaired(player) ? 2 : (data.repaired & (1 << i)) || data.intact === i ? 1 : 0));
    sender.sendVarbit(11174, data.shortcut ? 1 : 0);
    sender.sendVarbit(11181, data.stepping ? 1 : 0);
  }
  const allRepaired = player => (state(player).repaired | (1 << state(player).intact)) === 15;
  function box(player, text, items = []) { play(player, NPC.ITZLA, V.AGAIN, () => [{ type: 'message', id: 'hod-ruins-box', text, items }]); }

  function enter(player) {
    if (stage(player) < S.BELOW || stage(player) >= S.BANISHED) return;
    player.moveTo(new Location(1693, 9633, 2));
    openRuins(player);
    if (stage(player) === S.BELOW) {
      advance(player, S.RUINS);
      play(player, NPC.ITZLA, V.ENTER);
    }
  }

  function openRuins(player) {
    const scene = Scenes.open(player, 'ruins', [0, 1, 2].map(z => [1595, 1730, 9595, 9670, z]), {
      multi: true, canTeleport: () => true,
      npcAggression: (target, npc) => [...NAGUAS, FROST_CRAB].includes(npc.getId()),
      process: mobile => processTraps(player, scene, mobile),
    });
    scene.trapTick = 0;
    if (stage(player) < S.MINED) {
      Scenes.loc(scene, { id: ROCKS, x: 1689, y: 9633, z: 2 });
      Scenes.actor(scene, 13726, [1690, 9633, 2]);
      Scenes.actor(scene, NPC.ITZLA_ROBED, [1694, 9633, 2]);
    } else {
      STATUE_TILES.forEach(([x, y, face], i) => Scenes.loc(scene, { id: STATUES[i], x, y, face, type: 11 }));
      scene.traps = TRAPS.map(([id, x, y, z, face]) => Scenes.loc(scene, { id, x, y, z, face }));
      Scenes.actor(scene, NPC.ITZLA_ROBED, [1606, 9631]);
      for (const y of [9614, 9619]) Scenes.actor(scene, FROST_NAGUA, [1671, y, 2]);
      for (const [x, y] of CRAB_TILES) Scenes.actor(scene, FROST_CRAB, [x, y, 1]);
      for (const z of [0, 1, 2]) for (const npc of api.core.World.getNpcsNear(new Location(1660, 9633, z), 80)) {
        if (npc.getOwner?.() || !NAGUAS.includes(npc.getId())) continue;
        const at = npc.getLocation();
        Scenes.actor(scene, FROST_NAGUA, [at.getX(), at.getY(), at.getZ()]);
      }
    }
    return scene;
  }

  function processTraps(player, scene, mobile) {
    if (mobile !== player || stage(player) < S.CHASM || !scene.traps) return;
    const phase = scene.trapTick++ % 5;
    // shortcut: a five-tick cycle follows the capture; synchronise its initial phase with a newer capture.
    if (phase === 0) for (const trap of scene.traps) {
      if (trap.getLocation().isViewableFrom(player.getLocation())) player.getPacketSender().sendObjectAnimation(trap, new Animation(11562));
    }
    if (phase !== 2) return;
    const at = player.getLocation();
    if (!scene.traps.some(trap => trap.getLocation().equals(at))) return;
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(6 + Math.floor(Math.random() * 7), HitMask.RED)]);
    player.getTimers().register(TimerKey.STUN, 2);
  }

  function resume(player) {
    const at = player.getLocation();
    if (stage(player) < S.RUINS || stage(player) >= S.BANISHED || at.getX() < 1595 || at.getX() > 1730 || at.getY() < 9595 || at.getY() > 9670 || Scenes.get(player)) return;
    if (stage(player) === S.MINED) { naguaScene(player); return; }
    openRuins(player);
  }

  function selectVariant({ player, npcId }) {
    if (npcId === 13726 && stage(player) === S.RUINS) return V.VULCAN;
    if (npcId === NPC.ITZLA && stage(player) >= S.CHASM && stage(player) < S.AMOXLIATL) return state(player).metItzla ? V.AGAIN : V.ITZLA;
    return null;
  }
  function answerCondition() { return null; }

  function barrel({ player, objectId, definition }) {
    if ((objectId ?? definition?.id) !== BARREL || stage(player) < S.RUINS) return false;
    if (held(player, PICKAXE)) { box(player, 'You search the barrel, but find nothing of interest.'); return true; }
    if (player.getInventory().getFreeSlots() < 1) { player.sendMessage('You need some free inventory space.'); return true; }
    player.getInventory().adds(PICKAXE, 1); box(player, 'You take a pickaxe from the barrel.', [PICKAXE]); return true;
  }

  function rocks({ player, objectId, definition }) {
    if ((objectId ?? definition?.id) !== ROCKS || stage(player) !== S.RUINS) return false;
    if (mining.has(player)) return true;
    const request = { player, pickaxe: null };
    api.emitCustomEvent('mining:best-pickaxe', request);
    if (!request.pickaxe) { player.sendMessage('You need a pickaxe to mine these rocks.'); return true; }
    if (player.getSkillManager().getMaxLevel(Skill.MINING) < 55) return true;
    mining.add(player); player.performAnimation(new Animation(625));
    Scenes.later(player, 3, () => {
      mining.delete(player);
      if (stage(player) !== S.RUINS || !player.isRegistered()) return;
      advance(player, S.MINED); stopFollowing(player);
      naguaScene(player);
    });
    return true;
  }

  function naguaScene(player) {
    Scenes.fade(player, true); Scenes.hold(player); Scenes.controls(player, true, true);
    Scenes.later(player, 2, () => {
        const scene = Scenes.open(player, 'nagua', [[1660, 1710, 9600, 9660, 2]]);
        Scenes.controls(player, true, true);
        player.moveTo(new Location(1686, 9634, 2));
        scene.itzla = Scenes.actor(scene, NPC.ITZLA_CULTIST_ACTOR, [1686, 9635, 2]);
        scene.vulcan = Scenes.actor(scene, 13727, [1682, 9634, 2]);
        scene.acolytes = [Scenes.actor(scene, 13724, [1680, 9633, 2]), Scenes.actor(scene, 13725, [1680, 9635, 2])];
        Scenes.camera(player, [1687, 9630, 800], [1681, 9635, 500]);
        Scenes.fade(player, false);
        Scenes.later(scene, 4, () => play(player, 13726, V.ROCKS));
    });
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (stepId === 'hod-ruins-box') { event.handled = true; event.box = event.step.items.length ? { items: event.step.items } : { statement: true }; return; }
    const scene = Scenes.get(player);
    if (scene?.name === 'nagua') {
      if (stepId === 'viWDPg') { event.handled = true; CameraShake.send(player.getPacketSender(), "atmospheric", 0, 2, 0, 0); }
      if (stepId === 'ncfvjP') {
        event.handled = true; player.getPacketSender().sendCameraReset();
        scene.naguas = [Scenes.actor(scene, FROST_NAGUA_ACTOR, [1676, 9634, 2]), Scenes.actor(scene, FROST_NAGUA_ACTOR, [1680, 9636, 2])];
      }
      if (stepId === 'NekRFe') {
        event.handled = true; event.end = true;
        Scenes.hold(player);
        scene.vulcan?.performAnimation(new Animation(836));
        scene.itzla?.moveTo(new Location(1672, 9635, 2));
        for (const npc of scene.acolytes) npc?.getMovementQueue().addSteps(new Location(1692, 9633, 2));
        player.getPacketSender().sendCameraMoveArc(1680, 9636, 1685, 9640, 1000, 270, 'ease_in_out_sine', true);
        Scenes.later(scene, 9, () => { advance(player, S.CHASM); play(player, NPC.ITZLA, V.ROCKS, after('NekRFe')); });
      }
    }
    if (scene?.name === 'amoxliatl-intro') {
      if (stepId === '3CMDwz') event.handled = true;
      if (stepId === 'rWqmdD') {
        event.handled = true; event.end = true;
        scene.itzla?.performGraphic(new Graphic(111));
        Scenes.removeActor(scene, scene.itzla);
        scene.cultists = [Scenes.actor(scene, NPC.METZLI_ACTOR, [1368, 4510]), Scenes.actor(scene, NPC.ENNIUS_ACTOR, [1368, 4512]), Scenes.actor(scene, NPC.FURIA_ACTOR, [1368, 4508])];
        player.getPacketSender().sendCameraLookAt(1368, 4510, 820, { cycles: 120, easing: 'ease_out_sine' });
        Scenes.later(scene, 9, () => play(player, 13686, V.BOSS, after(stepId)));
      }
      if (stepId === '66Qnu2') {
        event.handled = true; event.end = true;
        for (const npc of scene.cultists ?? []) { npc?.performGraphic(new Graphic(111)); Scenes.removeActor(scene, npc); }
        Scenes.later(scene, 6, () => play(player, 13686, V.BOSS, after(stepId)));
      }
    }
  }

  function handleLine(event) {
    const { player, text } = event;
    if (text === 'Than I shall meet you up ahead. Good luck!' || text === 'Then I shall meet you up ahead. Good luck!') {
      event.after = () => { if (Scenes.get(player)?.name === 'nagua') { Scenes.end(player, false); player.moveTo(new Location(1686, 9634, 2)); openRuins(player); } };
    }
    if (text === 'There you are! I was starting to worry you\'d got lost.') event.before = () => change(player, { metItzla: 1 });
    if (text === 'After them? No. You will not be going anywhere...') event.after = () => beginFight(player);
  }

  function lever({ player, objectId, definition }) {
    const index = LEVERS.indexOf(objectId ?? definition?.id);
    if (index < 0 || stage(player) < S.CHASM || stage(player) >= S.BANISHED) return false;
    player.performAnimation(new Animation(798));
    const bits = state(player).levers | (1 << index);
    change(player, { levers: bits });
    if (bits === 15) advance(player, S.LEVERS);
    box(player, bits === 15 ? 'You pull the lever and a rumbling sound echoes through the cavern...' : 'You pull the lever.'); return true;
  }

  function mural({ player, definition, objectId }) {
    const index = MURALS.indexOf(objectId ?? definition?.id);
    if (index < 0 || stage(player) < S.CHASM) return false;
    box(player, `The mural depicts ${ELEMENTS[index]}. The word '${NUMBER_WORDS[state(player).order.indexOf(index)]}' is carved into it.`); return true;
  }

  function urn({ player, definition, objectId, object }) {
    const id = objectId ?? definition?.id, index = URNS.indexOf(id);
    if ((index < 0 && id !== 55360) || stage(player) < S.LEVERS || stage(player) >= S.AMOXLIATL) return false;
    if (index < 0 || index === state(player).intact) {
      const at = player.getLocation();
      const npc = Scenes.get(player) ? Scenes.actor(Scenes.get(player), FROST_NAGUA, [at.getX() + 1, at.getY(), at.getZ()]) : null;
      if (npc) { npc.__skipDefaultRespawn = true; (hostiles.get(player) ?? hostiles.set(player, new Set()).get(player)).add(npc); npc.getCombat().attack(player); }
      return true;
    }
    if (held(player, ICONS[index]) || (state(player).repaired & (1 << index))) { box(player, 'You search the urn, but find nothing of interest.'); return true; }
    if (player.getInventory().getFreeSlots() < 1) { player.sendMessage('You need some free inventory space.'); return true; }
    player.getInventory().adds(ICONS[index], 1); box(player, 'You search the urn and find an icon.', [ICONS[index]]); return true;
  }

  function statueIndex(event) {
    const id = event.objectId ?? event.definition?.id ?? event.object?.getId();
    for (let i = 0; i < STATUES.length; i++) if (id >= STATUES[i] && id <= STATUES[i] + 5) return i;
    return -1;
  }
  function placeIcon(event) {
    const { player, itemId } = event, index = statueIndex(event);
    if (index < 0 || ICONS[index] !== itemId || stage(player) !== S.LEVERS || !held(player, itemId)) return false;
    if (state(player).intact === index || (state(player).repaired & (1 << index))) return false;
    player.getInventory().deleteNumber(itemId, 1); change(player, { repaired: state(player).repaired | (1 << index) });
    box(player, 'You place the icon on the statue.', [itemId]); event.handled = true; return true;
  }
  function statue(event) {
    const { player } = event, index = statueIndex(event);
    if (index < 0 || stage(player) < S.LEVERS || stage(player) >= S.AMOXLIATL) return false;
    const data = state(player);
    if (!allRepaired(player)) {
      if (!(data.repaired & (1 << index)) && data.intact !== index && held(player, ICONS[index])) {
        api.sendMultiChatboxPrompt(player, 'Place an icon on the statue?', 'Yes.', () => placeIcon({ ...event, itemId: ICONS[index] }), 'No.', () => player.getPacketSender().sendInterfaceRemoval());
      } else box(player, `The statue has ${index === 1 ? 'a water' : 'a ' + ELEMENTS[index]} symbol at the base. ${data.intact === index || (data.repaired & (1 << index)) ? "It's holding some sort of icon." : "It looks like it's meant to be holding something."}`);
      return true;
    }
    if (stage(player) >= S.DOOR_OPEN) return true;
    const touches = [...data.touches, index];
    change(player, { touches });
    if (touches.length < 4) return true;
    change(player, { touches: [] });
    if (!touches.every((value, i) => value === data.order[i])) {
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(10, HitMask.RED)]); return true;
    }
    advance(player, 66); advance(player, S.DOOR_OPEN);
    cleanupHostiles(player);
    play(player, NPC.ITZLA, V.OPEN); return true;
  }

  function platformRoute(event) {
    if (![PLATFORM_LEDGE, PLATFORM].includes(event.objectId) || stage(event.player) < S.CHASM || Scenes.get(event.player)?.name !== 'ruins') return;
    const at = event.object.getLocation(), from = event.sourceLocation;
    const index = PLATFORM_TILES.findIndex(([x, y]) => x === at.getX() && y === at.getY());
    if (index < 0 || at.getZ() !== 1) return;
    const neighbours = [PLATFORM_TILES[index - 1], PLATFORM_TILES[index + 1]].filter(Boolean);
    neighbours.sort((a, b) => Math.abs(a[0] - from.x) + Math.abs(a[1] - from.y) - Math.abs(b[0] - from.x) - Math.abs(b[1] - from.y));
    event.destination = { x: neighbours[0][0], y: neighbours[0][1], z: 1 };
  }

  function obstacle(event) {
    const { player, object } = event, id = event.objectId ?? event.definition?.id, at = object?.getLocation();
    if (stage(player) < S.CHASM || !at) return false;
    let steps;
    if (id === HIGH_LEDGE) steps = [{ anim: 827 }, { wait: 1 }, { tele: [1704, 9607, 1] }];
    else if (id === LOW_LEDGE) steps = [{ anim: 827 }, { wait: 1 }, { tele: [1683, 9659, 0] }];
    else if (ICY_LEDGES.includes(id)) {
      const north = player.getLocation().getY() < 9636;
      steps = [{ anim: 753 }, { move: [1714, north ? 9642 : 9632, 1], anim: 759, ticks: 10 }];
    } else if (id === PLATFORM_LEDGE || id === PLATFORM) {
      if (id === PLATFORM) change(player, { stepping: 1 });
      steps = [{ move: [at.getX(), at.getY(), 1], anim: 741, ticks: 2 }];
      if (id === PLATFORM_LEDGE) steps.push({ run: () => change(player, { stepping: 0 }) });
    } else if (id === CHAIN || id === CHAIN_TOP) {
      const pull = id === CHAIN && !state(player).shortcut;
      change(player, { shortcut: 1 });
      steps = pull ? [{ anim: 828 }] : [{ anim: 828 }, { wait: 2 }, { tele: [1670, 9632, player.getLocation().getZ() === 0 ? 2 : 0] }];
    } else return false;
    ObstacleRunner.run({ player, object }, steps); return true;
  }

  function frozenDoor({ player, objectId, definition }) {
    if ((objectId ?? definition?.id) !== DOOR || stage(player) < S.LEVERS || stage(player) >= S.BANISHED) return false;
    if (stage(player) < S.DOOR_OPEN) { box(player, 'The door seems to be frozen shut. There must be some way to open it.'); return true; }
    if (stage(player) >= S.FIGHT) { beginFight(player); return true; }
    Scenes.fade(player, true); Scenes.controls(player, true, true); Scenes.hold(player);
    Scenes.later(player, 2, () => {
      advance(player, S.AMOXLIATL);
      const scene = Scenes.open(player, 'amoxliatl-intro', [[1344, 1407, 4480, 4543, 0]]);
      Scenes.controls(player, true, true);
      player.moveTo(new Location(1375, 4510, 0));
      Scenes.actor(scene, 13686, [1362, 4510]);
      scene.itzla = Scenes.actor(scene, NPC.ITZLA_CULTIST_ACTOR, [1374, 4511]);
      Scenes.camera(player, [1363, 4499, 1105], [1366, 4513, 820]); Scenes.fade(player, false);
      Scenes.later(scene, 10, () => play(player, 13686, V.BOSS));
    }); return true;
  }
  function beginFight(player) {
    if (stage(player) !== S.AMOXLIATL && stage(player) !== S.FIGHT) return;
    const request = { player, handled: false };
    Scenes.end(player, false);
    advance(player, S.FIGHT);
    api.emitCustomEvent('amoxliatl:quest-fight', request);
    if (!request.handled) { player.moveTo(new Location(1602, 9631, 0)); player.sendMessage('The guardian is unavailable. Please try again.'); }
  }
  function defeated({ player }) {
    if (stage(player) !== S.FIGHT) return;
    advance(player, S.BANISHED);
    player.moveTo(new Location(1615, 3211, 0));
    play(player, 13686, V.BANISH, steps => steps.filter(step => step.type !== 'action'));
  }
  function cleanupHostiles(player) {
    for (const npc of hostiles.get(player) ?? []) if (npc.isRegistered()) api.removeNpc(npc);
    hostiles.delete(player);
  }
  function logout(player) {
    mining.delete(player); cleanupHostiles(player);
    const at = player.getLocation();
    if (stage(player) < S.BANISHED && at.getX() >= 1344 && at.getX() <= 1407 && at.getY() >= 4480 && at.getY() <= 4543) player.moveTo(new Location(1602, 9631, 0));
  }
  function register() {
    api.persistAttribute(STATE_ATTRIBUTE);
    api.onObjectInteraction('Barrel', { 'Take-pickaxe': barrel });
    api.onObjectInteraction('Rocks', { Mine: rocks });
    api.onObjectInteraction('Lever', { Pull: lever });
    api.onObjectInteraction('Markings', { Inspect: mural });
    api.onObjectInteraction('Urn', { Search: urn });
    api.onObjectInteraction('Statue', { Inspect: statue, Touch: statue });
    api.onObjectInteraction('Broken statue', { Inspect: statue });
    api.onItemOnObject(placeIcon);
    api.onObjectInteraction('Ledge', { 'Climb-down': obstacle, 'Jump-to': obstacle });
    api.onObjectInteraction('Icy ledge', { 'Slide-along': obstacle });
    api.onObjectRoute(platformRoute);
    api.onObjectInteraction('Frozen platform', { 'Jump-to': obstacle });
    api.onObjectInteraction('Chain', { Pull: obstacle, 'Climb-up': obstacle, 'Climb-down': obstacle });
    api.onObjectInteraction('Frozen door', { Inspect: frozenDoor });
    api.onObjectInteraction('Door', { 'Pass-through': frozenDoor });
    api.onCustomEvent('amoxliatl:quest-defeated', defeated);
  }
  return { register, enter, resume, syncVarbits, selectVariant, answerCondition, handleLine, handleAction, logout, reset: player => player.setAttribute(STATE_ATTRIBUTE, null) };
};
