/**
 * The Nomad's demonstration, as recorded (rsprox 234/03277 [24]-[398]; soul-wars.json `tutorial`):
 * - in the lobby the Nomad introduces Soul Wars and offers the demonstration (met_nomad on the
 *   offer); "Let's do it." checks for restricted items, then he teleports the player in
 *   (started_tutorial);
 * - one instance of the tutorial battleground, shared by everyone in it; each player sees the
 *   Nomad of their own step (varbit soul_wars_tutorial picks one of six multinpcs) and gets a
 *   Zimberfizz of their own to kill, twice;
 * - sixteen steps: the avatars, the supplies, the souls (kill Zimberfizz, take his fragment), the
 *   obelisk (kill him again, take control), charging it (red avatar "98%"), the red base (the
 *   Nomad kills the player), the ghost and death, then the blue portal back to the lobby
 *   (finished_tutorial) and the offer of a Soul Wars guide;
 * - the steps' instructions on soul_wars_tutorial_instructions (261) and a hint arrow to the next
 *   thing to do.
 * Wiki (the Nomad's transcript): his lines for talking out of turn, a lost fragment, turning the
 * offer down, the poison refusal and the guide. Leaving early (Leave-tutorial, the portal,
 * logging out) starts the demonstration over; only finishing it lets a player wait for a game.
 */
const Common = require("./Common.SoulWars");

/** The step is not saved: logging out mid-way starts the demonstration over. */
const ATTRIBUTES = {
  step: "soul-wars:tutorial",
  met: "soul-wars:met-nomad",
  started: "soul-wars:started-tutorial",
  finished: "soul-wars:finished-tutorial",
};
const VARBITS = {
  step: "soul_wars_tutorial",
  met: "soul_wars_met_nomad",
  started: "soul_wars_started_tutorial",
  finished: "soul_wars_finished_tutorial",
};
const NOMAD_CHILD = 10516;
/** The Wiki's talk for those who have seen the demonstration (npc-dialogues.json, Nomad). */
const AFTER_DEMONSTRATION = "standard-dialogue-post-demonstration-dialogue";
const EXIT_PORTAL = "soul_wars_tut_blue_exit_portal";
const TUTORIAL_OBELISK = "soul_wars_tut_central_obelisk_parent";
/** The recorded fades: 948 out [0,255,0,0,50], in [0,0,0,255,50], on fade_overlay (174). */
const FADE = { overlay: 174, script: 948, out: [0, 255, 0, 0, 50], in: [0, 0, 0, 255, 50] };
/** soul_wars_game_stop_timer: the HUD without a game clock. */
const STOP_TIMER = 369;
const RATE = (rate, rate2 = rate) => ({ rate, rate2 });
const HINT_CENTRE = 2;
const HINT_NORTH = 6;

/** What reaches the engine's world (a test records it instead). */
const engine = {
  walk: (player, to) => Common.core.PathFinder.calculateWalkRoute(player, to.getX(), to.getY()),
  projectile: (from, to, target, id, area) => new Common.core.Projectile(from, to, target, id, 0, 25, 100, 50, area).sendProjectile(),
  drop: (player, id, tile) => Common.api.getItemOnGroundManager().registerLocation(player, new Common.core.Item(id, 1), tile),
};

/** Each player in the demonstration: their imp, their fragment's drop, the cutscene's guard. */
const states = new Map();
let shared = null;
let AreaClass = null;

const tut = () => Common.data.tutorial;
const lines = (name) => tut().lines[name];
const parents = () => Object.keys(tut().nomads).map(Number);

function stepOf(player) {
  return Number(player.getAttribute(ATTRIBUTES.step)) || 0;
}

function setStep(player, step) {
  player.setAttribute(ATTRIBUTES.step, step);
  Common.varbit(player, VARBITS.step, step);
}

function mark(player, name) {
  player.setAttribute(ATTRIBUTES[name], 1);
  Common.varbit(player, VARBITS[name], 1);
}

function has(player, name) {
  return Number(player.getAttribute(ATTRIBUTES[name])) === 1;
}

/** Only a player who has watched the demonstration may wait for a game (Wiki). */
function finished(player) {
  return has(player, "finished");
}

function stateOf(player) {
  return states.get(player) ?? null;
}

function inTutorial(player) {
  return states.has(player);
}

// ---------------------------------------------------------------- the instance

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class SoulWarsDemonstration extends TemplatedInstanceArea {
    constructor() {
      const { chunk, size } = tut();
      super(size[0], size[1]);
      this.origin = [chunk[0] * 8, chunk[1] * 8];
      // Every plane, as the arena: the bridges onto the obelisk's island are on the plane above.
      for (let z = 0; z < 4; z++) {
        for (let x = 0; x < size[0]; x++) {
          for (let y = 0; y < size[1]; y++) {
            this.setChunk(z, x, y, { sourceChunkX: chunk[0] + x, sourceChunkY: chunk[1] + y, sourcePlane: z, rotation: 0 });
          }
        }
      }
      this.npcs = new Set();
    }

    getName() {
      return "Soul Wars demonstration";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    /** No follower comes in either (Wiki: Soul Wars): a following pet waits outside. */
    barsFollowers() {
      return true;
    }

    canTeleport() {
      return false;
    }

    at([x, y, z]) {
      return this.tile(x - this.origin[0], y - this.origin[1], z ?? 0);
    }

    templateOf(location) {
      return [location.getX() - this.getBaseX() + this.origin[0], location.getY() - this.getBaseY() + this.origin[1], location.getZ()];
    }

    canAttack(attacker, target) {
      return attackRule(attacker, target);
    }

    /** Logging out mid-demonstration saves the player in the lobby, to start over. */
    postLeave(mobile, logout) {
      const player = mobile.isPlayer?.() ? mobile.getAsPlayer?.() ?? mobile : null;
      if (player && inTutorial(player)) {
        cleanUp(player);
        if (logout) player.setLocation?.(Common.toLocation(tut().lobbyExit));
      }
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

function spawn(area, id, tile) {
  const npc = Common.core.NPC.create(id, area.at(tile));
  npc.__skipDefaultRespawn = true;
  npc.getMovementCoordinator?.().setRadius?.(0);
  area.add(npc);
  Common.core.World.getAddNPCQueue().push(npc);
  area.npcs.add(npc);
  return npc;
}

function despawn(npc) {
  if (!npc) return;
  npc.__soulWarsTutorialGone = true;
  Common.core.World.getRemoveNPCQueue().push(npc);
}

/** The demonstration's one instance: the six Nomads, the avatars and the scenery, made once. */
function instance() {
  if (shared && !shared.isDestroyed?.()) return shared;
  shared = new (areaClass())();
  for (const [id, tile] of Object.entries(tut().nomads)) spawn(shared, Number(id), tile);
  for (const [id, tile] of tut().scenery) spawn(shared, id, tile);
  return shared;
}

function nomadNpc(area, step) {
  const at = Object.entries(tut().nomads).find(([id]) => visibleAt(Number(id), step));
  if (!at) return null;
  return [...area.npcs].find((npc) => npc.getId() === Number(at[0])) ?? null;
}

/** The step range in which each Nomad is shown (the cache's multinpc table on 3798). */
function visibleAt(parentId, step) {
  const forms = Common.core.CacheDefinitions.getNpc(parentId)?.transforms ?? [];
  return (forms[Math.min(step, forms.length - 1)] ?? -1) === NOMAD_CHILD;
}

// ---------------------------------------------------------------- client effects

function sender(player) {
  return player.getPacketSender();
}

function fade(player, out) {
  sender(player).sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_atmosphere"), FADE.overlay, 1, {
    postScripts: [{ scriptId: FADE.script, args: out ? FADE.out : FADE.in }],
  });
}

function closeFade(player) {
  sender(player).closeSubInterface?.(Common.component("toplevel_osrs_stretch:overlay_atmosphere"));
}

function openHud(player) {
  sender(player).sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_hud"), Common.core.CacheDefinitions.getInterfaceId("soul_wars_game"), 1);
  sender(player).sendInterfaceScript(STOP_TIMER, []);
}

function closeHud(player) {
  sender(player).closeSubInterface?.(Common.component("toplevel_osrs_stretch:overlay_hud"));
}

/** The instructions box over the chat: the step's title and text (empty on arrival). */
function instruct(player, step) {
  const [title, text] = step == null ? ["", ""] : tut().instructions[String(step)] ?? [];
  if (title == null) return;
  sender(player).sendSubInterface(Common.component("chatbox:chatoverlay"), Common.core.CacheDefinitions.getInterfaceId("soul_wars_tutorial_instructions"), 1);
  Common.text(player, "soul_wars_tutorial_instructions:title", title);
  Common.text(player, "soul_wars_tutorial_instructions:textbox", text);
}

function hintAt(player, tile, height = tut().arrowHeight, edge = HINT_CENTRE) {
  const area = stateOf(player)?.area;
  if (!area) return;
  sender(player).clearHintArrow();
  sender(player).sendPositionalHint(area.at(tile), edge, height);
}

function hintNpc(player, npc) {
  sender(player).clearHintArrow();
  if (npc) sender(player).sendEntityHint(npc);
}

function sound(player, id, delay = 0) {
  sender(player).sendSound?.(id, 100, delay);
}

function camera(player, kind, tile, height, motion) {
  const at = stateOf(player).area.at(tile);
  if (kind === "move") sender(player).sendCameraMoveTo(at.getX(), at.getY(), height, motion);
  else sender(player).sendCameraLookAt(at.getX(), at.getY(), height, motion);
}

function animate(mobile, id, delay = 0) {
  mobile.performAnimation(new Common.core.Animation(id, delay));
}

function graphic(mobile, id, delay = 0, height = 0) {
  mobile.performGraphic(new Common.core.Graphic(id, delay, height));
}

/** Runs `action` after `ticks` if the player is still in the same demonstration. */
function later(player, ticks, action) {
  const state = stateOf(player);
  Common.later(ticks, () => {
    if (stateOf(player) === state && player.isRegistered?.() !== false) action();
  });
}

// ---------------------------------------------------------------- dialogue

/**
 * A run of recorded pages, then `done`. `at[i]` runs as page i is shown (a step that changes on
 * that page, as recorded). Pages are [speaker, text, chathead animation]; 'box' is a messagebox.
 */
function talk(player, pages, { at = {}, done, head = NOMAD_CHILD, menu } = {}) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, StatementDialogue, ActionDialogue, OptionDialogue } = Common.core;
  const manager = player.getDialogueManager();
  const chain = new DialogueChainBuilder();
  let index = 0;
  pages.forEach(([speaker, text, anim], page) => {
    if (at[page]) {
      const next = index + 1;
      const hook = at[page];
      chain.add(new ActionDialogue(index++, { execute: () => { hook(); manager.startDialogue(next); } }));
    }
    if (speaker === "player") chain.add(new PlayerDialogue(index++, text, anim));
    else if (speaker === "box") chain.add(new StatementDialogue(index++, text));
    else chain.add(new NpcDialogue(index++, head, text, "Nomad", anim));
  });
  if (menu) {
    chain.add(new OptionDialogue(index++, {
      executeOption(option) {
        sender(player).sendInterfaceRemoval();
        menu[Number(option) - 1]?.[1](); // options are one-based
      },
    }, ...menu.map(([text]) => text)));
  } else {
    chain.add(new ActionDialogue(index++, {
      execute: () => {
        manager.reset();
        sender(player).sendInterfaceRemoval();
        done?.();
      },
    }));
  }
  manager.startDialogues(chain);
}

// ---------------------------------------------------------------- the lobby Nomad

function restricted(player) {
  if ((player.getPoisonDamage?.() ?? 0) > 0) return "poisoned";
  return require("./Lobby.SoulWars").restrictedItems(player) ? "restricted" : null;
}

function offer(player, first) {
  const pages = first ? lines("intro") : lines("again");
  const at = first ? { [pages.length - 1]: () => mark(player, "met") } : {};
  const no = first ? "Actually, I'm good." : "I'll pass.";
  talk(player, pages, {
    head: player.__soulWarsNomadHead,
    at,
    menu: [
      ["Let's do it.", () => letsDoIt(player)],
      [no, () => talk(player, [["player", no, 588], ...lines("notNow")], { head: player.__soulWarsNomadHead })],
    ],
  });
}

function letsDoIt(player) {
  const refused = restricted(player);
  if (refused) {
    talk(player, [...lines("letsDoIt"), ...lines(refused)], { head: player.__soulWarsNomadHead });
    return;
  }
  talk(player, [...lines("letsDoIt"), ...lines("started")], { head: player.__soulWarsNomadHead, done: () => teleportIn(player) });
}

/** The lobby Nomad's Talk-to: the offer until the demonstration is done, then his usual talk. */
function lobbyTalk({ player, npc }) {
  if (!npc || !Common.inBox(npc.getLocation(), Common.data.lobby.bounds)) return false;
  if (finished(player)) return false;
  player.__soulWarsNomadHead = npc.getId();
  offer(player, !has(player, "met"));
  return true;
}

/** Recorded: the Nomad's tele-other, then the fade 2 ticks on and the instance 3 after that. */
function teleportIn(player) {
  mark(player, "started");
  animate(player, tut().anims.teleOtherImpact, 77);
  graphic(player, tut().spotanims.teleOtherImpact, 77, 92);
  sound(player, tut().sounds.teleOtherCast);
  sound(player, tut().sounds.teleOtherLand, 77);
  player.getMovementQueue?.().setBlockMovement?.(true);
  Common.later(2, () => fade(player, true));
  Common.later(5, () => enter(player));
}

// ---------------------------------------------------------------- the demonstration

const ARRIVAL_VARBITS = [
  ["soul_wars_obelisk_alignment", Common.ALIGNMENT.neutral],
  ["soul_wars_east_gy_alignment", Common.ALIGNMENT.neutral],
  ["soul_wars_west_gy_alignment", Common.ALIGNMENT.neutral],
  ["soul_wars_obelisk_holder", 0],
  ["soul_wars_blue_avatar_check", 1],
  ["soul_wars_red_avatar_check", 1],
  ["soul_wars_activity_value", 800],
];

function wear(player, slot, id) {
  const equipment = player.getEquipment();
  equipment.setItem?.(slot, id > 0 ? new Common.core.Item(id, 1) : new Common.core.Item(-1, 0));
  equipment.refreshItems?.();
  player.getUpdateFlag?.().flag?.(Common.core.Flag?.APPEARANCE);
}

/**
 * The fade gives the player 5 ticks to equip something (a cape) or pick it back up: the
 * admission rules are checked again before anything of theirs is touched, and entry stops.
 */
function admissionChanged(player) {
  if (player.isRegistered?.() === false) return true;
  if (!restricted(player)) return false;
  player.getMovementQueue?.().setBlockMovement?.(false);
  closeFade(player);
  player.sendMessage(Common.message("restricted"));
  return true;
}

function enter(player) {
  if (admissionChanged(player)) return;
  const area = instance();
  states.set(player, { area, imp: null, cutscene: true });
  setStep(player, 0);
  for (const [name, value] of ARRIVAL_VARBITS) Common.varbit(player, name, value);
  area.enter(player);
  player.moveTo(area.at(tut().land));
  wear(player, Common.core.Equipment?.CAPE_SLOT ?? 1, tut().items.cape);
  wear(player, tut().iconSlot, tut().items.icon);
  player.setRunEnergy?.(100);
  instruct(player, null);
  introCutscene(player);
}

/** Recorded [100]-[131]: the look at the blue avatar, "Huh?", "Yikes!", "Oh boy.", the run north. */
function introCutscene(player) {
  const [x, y] = tut().land;
  later(player, 1, () => {
    camera(player, "move", [x, y + 4], 375, RATE(100));
    camera(player, "look", [x, y + 2], 250, RATE(100));
  });
  later(player, 3, () => fade(player, false));
  later(player, 4, () => {
    closeFade(player);
    openHud(player);
  });
  later(player, 7, () => player.forceChat("Huh?"));
  later(player, 9, () => {
    animate(player, tut().anims.terrified);
    player.forceChat("Yikes!");
    camera(player, "move", [x - 4, y], 350, RATE(1, 30));
    camera(player, "look", [x + 7, y], 250, RATE(1, 30));
  });
  later(player, 11, () => camera(player, "look", [x + 7, y + 10], 350, RATE(1, 40)));
  later(player, 13, () => camera(player, "move", [x - 4, y], 875, RATE(1, 40)));
  later(player, 15, () => {
    camera(player, "move", [x, y - 1], 875, RATE(1, 40));
    camera(player, "look", [x, y + 10], 350, RATE(1, 40));
  });
  later(player, 17, () => camera(player, "move", [x, y - 4], 375, RATE(1, 40)));
  later(player, 19, () => player.forceChat("Oh boy."));
  later(player, 22, () => {
    sender(player).sendCameraReset();
    player.getMovementQueue?.().setBlockMovement?.(false);
    player.setRunning?.(true);
    const to = stateOf(player).area.at(tut().walkTo);
    engine.walk(player, to);
    hintNpc(player, nomadNpc(stateOf(player).area, 0));
    instruct(player, 0);
    stateOf(player).cutscene = false;
  });
  later(player, 30, () => sender(player).sendMultiIcon(1));
}

/** Recorded after a talk: the HUD and the chat close, the fade, and the Nomad gone on ahead. */
function moveOn(player, step, hint) {
  closeHud(player);
  fade(player, true);
  later(player, 2, () => sound(player, tut().sounds.teleOtherLand));
  later(player, 3, () => {
    setStep(player, step);
    hint();
  });
  later(player, 4, () => fade(player, false));
  later(player, 5, () => {
    closeFade(player);
    openHud(player);
    instruct(player, step);
  });
}

function hintNomad(player, step) {
  const parent = Object.entries(tut().nomads).find(([id]) => visibleAt(Number(id), step));
  if (parent) hintAt(player, parent[1]);
}

function spawnImp(player, kind) {
  const state = stateOf(player);
  const [id, tile] = tut().imps[kind];
  despawn(state.imp);
  const imp = spawn(state.area, id, tile);
  imp.__soulWarsOwner = player;
  state.imp = imp;
  graphic(imp, tut().spotanims.smokepuff);
  sound(player, tut().sounds.impAppears);
  return imp;
}

function hasFragment(player) {
  return player.getInventory().getAmount(tut().items.fragment) > 0;
}

/** Wiki: a lost fragment is replaced, if there's room for it. */
function replaceFragment(player, lost, then) {
  if (player.getInventory().getFreeSlots() <= 0) {
    talk(player, [...lines(lost), ...lines("makeSpace")]);
    return;
  }
  talk(player, [...lines(lost), ...lines("newFragment")], {
    at: { [lines(lost).length]: () => player.getInventory().add(new Common.core.Item(tut().items.fragment, 1)) },
    done: then,
  });
}

/** The Nomads' Talk-to inside, by the player's step. */
function nomadTalk({ player, npc }) {
  if (!npc || !parents().includes(npc.getId()) || !inTutorial(player)) return false;
  const state = stateOf(player);
  if (state.cutscene) return true;
  const step = stepOf(player);
  if (step === 0) talk(player, lines("avatars"), { head: npc.getId(), done: () => moveOn(player, 1, () => hintNomad(player, 1)) });
  else if (step === 1) talk(player, lines("supplies"), { head: npc.getId(), done: () => moveOn(player, 2, () => hintNomad(player, 2)) });
  else if (step === 2) soulsTalk(player, npc);
  else if (step === 3 || step === 4) talk(player, lines("killHim"), { head: npc.getId() });
  else if (step === 5) fragmentTalk(player, npc);
  else if (step === 6) obeliskTalk(player, npc);
  else if (step === 7) {
    if (state.imp && !state.imp.__soulWarsTutorialGone) talk(player, lines("kick"), { head: npc.getId() });
    else areaControlTalk(player, npc);
  } else if (step >= 8 && step <= 10) areaControlTalk(player, npc);
  else if (step === 11) {
    if (hasFragment(player)) talk(player, lines("goCharge"), { head: npc.getId() });
    else replaceFragment(player, "lostAtObelisk");
  } else if (step === 12) angryTalk(player, npc);
  else if (step === 13) redBaseTalk(player, npc);
  else if (step === 14) ghostTalk(player, npc);
  else if (step === 15) deathTalk(player, npc);
  else talk(player, lines("seeYou"), { head: npc.getId() });
  return true;
}

/** Recorded: 2->3 as "Zimberfizz! Heel!" shows (his imp appears), 3->4 after "Yes!". */
function soulsTalk(player, npc) {
  const souls = lines("souls");
  const pages = [...souls, ...lines("heel"), ...lines("zimberfizz")];
  talk(player, pages, {
    head: npc.getId(),
    at: { [souls.length]: () => {
      setStep(player, 3);
      spawnImp(player, "ruins");
      instruct(player, 2);
    } },
    done: () => {
      setStep(player, 4);
      instruct(player, 4);
      hintNpc(player, stateOf(player).imp);
    },
  });
}

function fragmentTalk(player, npc) {
  const onward = () => moveOn(player, 6, () => hintNomad(player, 6));
  if (hasFragment(player)) talk(player, lines("onward"), { head: npc.getId(), done: onward });
  else if (player.getInventory().getFreeSlots() <= 0) talk(player, [...lines("lostFragment"), ...lines("makeSpace")], { head: npc.getId() });
  else {
    const lost = lines("lostFragment");
    talk(player, [...lost, ...lines("newFragment"), ["npc", lines("onward")[0][1].replace("Good job! ", "Now! "), 569]], {
      head: npc.getId(),
      at: { [lost.length]: () => player.getInventory().add(new Common.core.Item(tut().items.fragment, 1)) },
      done: onward,
    });
  }
}

/** Recorded: 6->7 as "Minion! Heel!" shows, the obelisk's Zimberfizz with him. */
function obeliskTalk(player, npc) {
  if (!hasFragment(player)) {
    replaceFragment(player, "lostAtObelisk", () => obeliskTalk(player, npc));
    return;
  }
  const obelisk = lines("obelisk");
  talk(player, [...obelisk, ...lines("minionHeel"), ...lines("returns")], {
    head: npc.getId(),
    at: { [obelisk.length]: () => {
      setStep(player, 7);
      instruct(player, 7);
      hintNpc(player, spawnImp(player, "obelisk"));
    } },
  });
}

/**
 * Recorded: 7->8 on the click, 8->9 after "...right Zimberfizz?" (the chat imp shows), 9->10 on
 * the control boxes (the obelisk turns blue at once), 10->11 after "go and charge".
 */
function areaControlTalk(player, npc) {
  const step = stepOf(player);
  if (step === 7) {
    setStep(player, 8);
    instruct(player, 8);
  }
  const poorGuy = stepOf(player) === 8 ? lines("poorGuy") : [];
  const outnumber = lines("outnumber");
  const controlled = lines("controlled");
  const pages = stepOf(player) <= 9 ? [...poorGuy, ...outnumber, ...controlled] : [controlled[controlled.length - 1]];
  const at = {};
  if (stepOf(player) === 8) at[poorGuy.length] = () => setStep(player, 9);
  if (stepOf(player) <= 9) {
    at[poorGuy.length + outnumber.length] = () => {
      setStep(player, 10);
      Common.varbit(player, "soul_wars_obelisk_holder", Common.TEAM_VALUE.blue);
      Common.varbit(player, "soul_wars_obelisk_alignment", Common.ALIGNMENT.blue);
    };
  }
  talk(player, pages, {
    head: npc.getId(),
    at,
    done: () => {
      setStep(player, 11);
      instruct(player, 11);
      hintAt(player, tut().obelisk, tut().obeliskArrow, HINT_NORTH);
    },
  });
}

/** Recorded: Sacrifice-fragments on the tutorial obelisk takes the fragment, red avatar "98%". */
function charge({ player, object }) {
  if (!inTutorial(player)) return false;
  if (object?.getId?.() !== Common.core.CacheDefinitions.getLocId(TUTORIAL_OBELISK) && !String(object?.getDefinition?.()?.getName?.() ?? "").includes("Obelisk")) return false;
  if (stepOf(player) !== 11 || !hasFragment(player)) return true;
  player.getInventory().delete(tut().items.fragment, player.getInventory().getAmount(tut().items.fragment));
  setStep(player, 12);
  sound(player, tut().sounds.charge);
  Common.text(player, "soul_wars_game:red_strength", tut().redStrength);
  instruct(player, 12);
  hintNomad(player, 12);
  talk(player, lines("charged"));
  return true;
}

/** Recorded: "why don't we go find out?", then the teleport and the look at the red avatar. */
function angryTalk(player, npc) {
  talk(player, lines("angry"), {
    head: npc.getId(),
    done: () => {
      const state = stateOf(player);
      sender(player).clearHintArrow();
      animate(player, tut().anims.castTeleport);
      graphic(player, tut().spotanims.teleport, 0, 92);
      sound(player, tut().sounds.teleOtherLand);
      closeHud(player);
      fade(player, true);
      state.cutscene = true;
      later(player, 3, () => {
        setStep(player, 13);
        player.moveTo(state.area.at(tut().redBase));
        camera(player, "move", [2095, 6005], 425, RATE(100));
        camera(player, "look", [2095, 5998], 425, RATE(100));
      });
      later(player, 6, () => fade(player, false));
      later(player, 7, () => {
        closeFade(player);
        openHud(player);
      });
      later(player, 10, () => {
        camera(player, "move", [2095, 6009], 925, RATE(1, 25));
        camera(player, "look", [2095, 5998], 25, RATE(1, 25));
      });
      later(player, 15, () => {
        camera(player, "move", [2095, 5975], 475, RATE(1, 20));
        camera(player, "look", [2095, 5982], 225, RATE(1, 20));
      });
      later(player, 19, () => player.moveTo(state.area.at(tut().redBaseWalk)));
      later(player, 20, () => hintNomad(player, 13));
      later(player, 25, () => {
        sender(player).sendCameraReset();
        openHud(player);
        state.cutscene = false;
      });
    },
  });
}

/** Recorded: the Nomad's Iban blast, "Argh!", and the player wakes a ghost in the blue graveyard. */
function redBaseTalk(player, npc) {
  talk(player, lines("redBase"), {
    head: npc.getId(),
    done: () => {
      const state = stateOf(player);
      state.cutscene = true;
      sender(player).clearHintArrow();
      animate(npc, tut().anims.nomadBlast);
      sound(player, tut().sounds.blast);
      engine.projectile(npc.getLocation(), player.getLocation(), player, tut().projectile, state.area);
      graphic(player, tut().spotanims.blastImpact, 25, 50);
      later(player, 3, () => {
        animate(player, tut().anims.death, 25);
        player.forceChat("Argh!");
      });
      later(player, 6, () => {
        closeHud(player);
        fade(player, true);
      });
      later(player, 9, () => {
        setStep(player, 14);
        animate(player, -1);
        player.setNpcTransformationId?.(tut().ghost);
        player.moveTo(state.area.at(tut().graveyard));
      });
      later(player, 10, () => fade(player, false));
      later(player, 11, () => {
        closeFade(player);
        openHud(player);
        instruct(player, 14);
        hintNomad(player, 14);
        state.cutscene = false;
      });
    },
  });
}

/** Recorded: the ghost's "Wooooo!", then 14->15 and back to life on "There we go! Much better." */
function ghostTalk(player, npc) {
  const ghost = lines("ghost");
  talk(player, [...ghost, ...lines("alive")], {
    head: npc.getId(),
    at: { [ghost.length]: () => {
      setStep(player, 15);
      player.setNpcTransformationId?.(-1);
      instruct(player, 15);
    } },
    done: () => deathTalk(player, npc),
  });
}

/** Recorded: finished_tutorial and 15->16 as the last line (the blue portal) shows. */
function deathTalk(player, npc) {
  const death = lines("death");
  talk(player, [...death, ...lines("portal")], {
    head: npc.getId(),
    at: { [death.length]: () => {
      mark(player, "finished");
      setStep(player, 16);
      instruct(player, 16);
      hintAt(player, tut().portal);
    } },
  });
}

// ---------------------------------------------------------------- leaving

function cleanUp(player) {
  const state = stateOf(player);
  if (!state) return;
  states.delete(player);
  despawn(state.imp);
  if (!finished(player)) setStep(player, 0);
  player.setNpcTransformationId?.(-1);
  player.getInventory().delete(tut().items.fragment, player.getInventory().getAmount(tut().items.fragment));
  const capeSlot = Common.core.Equipment?.CAPE_SLOT ?? 1;
  if (player.getEquipment().getItems?.()[capeSlot]?.getId?.() === tut().items.cape) wear(player, capeSlot, -1);
  if (player.getEquipment().getItems?.()[tut().iconSlot]?.getId?.() === tut().items.icon) wear(player, tut().iconSlot, -1);
  sender(player).clearHintArrow();
  closeHud(player);
  closeFade(player);
  sender(player).closeSubInterface?.(Common.component("chatbox:chatoverlay"));
  sender(player).sendMultiIcon(0);
  sender(player).sendCameraReset();
  player.getMovementQueue?.().setBlockMovement?.(false);
  if (state.area.getPlayers?.().filter((other) => other !== player && inTutorial(other)).length === 0) {
    Common.later(1, () => {
      if (shared !== state.area || [...states.values()].some((other) => other.area === state.area)) return;
      for (const npc of state.area.npcs) despawn(npc);
      if (!state.area.isDestroyed?.()) state.area.destroy?.();
      shared = null;
    });
  }
}

/** Recorded [381]-[398]: the fade, the lobby, and the Nomad's word about the guide. */
function leave(player) {
  if (!inTutorial(player)) return false;
  const done = finished(player) && stepOf(player) >= 16;
  closeHud(player);
  sender(player).closeSubInterface?.(Common.component("chatbox:chatoverlay"));
  fade(player, true);
  stateOf(player).cutscene = true;
  later(player, 3, () => {
    cleanUp(player);
    player.moveTo(Common.toLocation(tut().lobbyExit));
    Common.later(2, () => fade(player, false));
    Common.later(4, () => closeFade(player));
    if (done) Common.later(4, () => guideTalk(player));
  });
  return true;
}

function guideTalk(player) {
  const nomad = Common.core.World?.getNpcs?.()?.find?.((npc) => npc?.getId?.() === 10528 && Common.inBox(npc.getLocation(), Common.data.lobby.bounds));
  const head = nomad?.getId?.() ?? 10529;
  if (player.getInventory().getFreeSlots() <= 0) {
    talk(player, [...lines("back"), ...lines("noGuideRoom")], { head });
    return;
  }
  talk(player, [...lines("back"), ...lines("guideOffer")], {
    head,
    menu: [
      ["Yes please.", () => {
        if (player.getInventory().getAmount(tut().items.guide) > 0) {
          talk(player, [...lines("guideYes"), ...lines("guideHave")], { head });
          return;
        }
        talk(player, [...lines("guideYes"), ...lines("guideGiven")], {
          head,
          at: { [lines("guideYes").length]: () => player.getInventory().add(new Common.core.Item(tut().items.guide, 1)) },
        });
      }],
      ["No thanks.", () => talk(player, lines("guideNo"), { head })],
    ],
  });
}

/** A demonstrated player's talk is the Wiki's, on a Soul Wars world. */
const LOBBY_NOMAD_FORMS = ["soul_wars_nomad", "soul_wars_nomad_1op", "soul_wars_nomad_2op"];

function isLobbyNomad(npc, npcId) {
  if (!npc || !Common.inBox(npc.getLocation(), Common.data.lobby.bounds)) return false;
  const forms = LOBBY_NOMAD_FORMS.map((name) => Common.core.CacheDefinitions.getNpcId(name));
  return forms.includes(npcId ?? npc.getId?.()) || forms.includes(npc.getId?.());
}

function dialogueVariant({ player, npc, npcId }) {
  if (!isLobbyNomad(npc, npcId) || !finished(player)) return null;
  return AFTER_DEMONSTRATION;
}

function dialogueCondition({ player, npc, npcId, text }) {
  if (!isLobbyNomad(npc, npcId) || !finished(player)) return null;
  const value = String(text ?? "");
  if (value.includes("not on a Soul Wars world")) return false;
  if (value.includes("on a Soul Wars world")) return true;
  return null;
}

function leaveOption({ player, npc }) {
  if (!npc || npc.getId?.() !== NOMAD_CHILD && !parents().includes(npc.getId?.())) return false;
  return leave(player);
}

function portal({ player, object }) {
  if (object?.getId?.() !== Common.core.CacheDefinitions.getLocId(EXIT_PORTAL)) return false;
  return leave(player);
}

function talkTo(event) {
  return nomadTalk(event) || lobbyTalk(event);
}

// ---------------------------------------------------------------- Zimberfizz

/** Only a player's own Zimberfizz, and only once the Nomad has said so. */
function attackRule(attacker, target) {
  const player = attacker?.isPlayer?.() ? attacker : null;
  if (!player) return true;
  if (target?.isPlayer?.()) return false;
  const owner = target?.__soulWarsOwner;
  if (!owner) return false;
  const step = stepOf(player);
  if (owner !== player || !(step === 4 || step === 7)) {
    player.sendMessage(tut().messages.notYourImp);
    return false;
  }
  return true;
}

/** Recorded: 2 ticks after Zimberfizz dies, his fragment (yours alone at first) and the arrow. */
function impDied({ npc }) {
  const player = npc?.__soulWarsOwner;
  if (!player || !inTutorial(player)) return;
  const state = stateOf(player);
  const tile = npc.getLocation();
  later(player, 2, () => {
    despawn(npc);
    if (state.imp === npc) state.imp = null;
    if (stepOf(player) === 4) {
      setStep(player, 5);
      engine.drop(player, tut().items.fragment, tile);
      instruct(player, 5);
      hintAt(player, state.area.templateOf(tile), 0);
    } else if (stepOf(player) === 7) {
      hintNomad(player, 7);
    }
  });
}

function noDrops(event) {
  const owner = event?.npc?.__soulWarsOwner;
  if (owner && event.drops) event.drops.length = 0;
}

function pickedUp({ player, groundItemId }) {
  if (groundItemId !== tut().items.fragment || !inTutorial(player) || stepOf(player) !== 5) return;
  Common.later(1, () => {
    if (!hasFragment(player)) return;
    sound(player, tut().sounds.pickup);
    hintNomad(player, 5);
  });
}

// ---------------------------------------------------------------- login

function loggedIn({ player }) {
  for (const name of ["met", "started", "finished"]) Common.varbit(player, VARBITS[name], has(player, name) ? 1 : 0);
  Common.varbit(player, VARBITS.step, finished(player) ? 16 : 0);
  if (!finished(player)) player.setAttribute(ATTRIBUTES.step, 0);
}

function attachTutorial(api) {
  for (const name of ["met", "started", "finished"]) api.persistAttribute(ATTRIBUTES[name], 0);
  api.onPlayerLogin(loggedIn);
  api.onNpcInteraction("Nomad", {
    "Talk-to": talkTo,
    "Leave-tutorial": leaveOption,
  });
  api.onObjectInteraction("Portal", { Leave: portal });
  api.onObjectInteraction("Soul Obelisk", { "Sacrifice-fragments": charge });
  api.onNpcDialogueVariant(dialogueVariant);
  api.onNpcDialogueCondition(dialogueCondition);
  api.onNpcDeath(impDied);
  api.onCustomEvent("npc-drops:roll", noDrops);
  api.onGroundItemPickup(pickedUp);
}

module.exports = {
  attachTutorial,
  engine,
  finished,
  inTutorial,
  stepOf,
  states,
  instance,
  enter,
  leave,
  lobbyTalk,
  nomadTalk,
  charge,
  attackRule,
  impDied,
  ATTRIBUTES,
};
