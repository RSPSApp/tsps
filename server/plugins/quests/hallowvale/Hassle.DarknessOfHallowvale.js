/**
 * Darkness of Hallowvale: the vyrewatch who stop the player in Meiyerditch, and the mine punishment.
 *
 * Live (rsprox capture, revision 242; ticks from docs/quests/darkness-of-hallowvale):
 * - Noticed (t5636-5676, stage 180): a flying vyrewatch walks up to the player. Once it is next to
 *   them: "A vyrewatch takes an interest in you." and 2580 myq3_vamp_hassle = 1 (t5648); a tick on it
 *   lands (4695 myq3_vampire_flying_landing, area sound 2991 vampire_arrives, range 5); three ticks
 *   on it becomes its walking form (flying id 3717 -> 3709). Its two lines are timed, with no
 *   continue: an opener for 4 ticks (chatang1), the offer for 5 (chatang3). Then 2581 = 1 and the
 *   menu "The vyrewatch wants an answer!" (t5662). The choice is 2582 (its 1-based index) on the
 *   tick after the click, with the player's line (chatsad1) and the vyre's reply (chathap1), 3 ticks
 *   each. "Send me to the mines!": the teleport spell (player 4731 and spotanim 342 at delay 70, the
 *   vyre's 4729, projectile 787, sound 201) and, 5 ticks on, 2580 = 2 and the mine (2391,4620,2).
 * - Talk-to (t6829-6846, stage 250): "Hello?", an insult, "Select an option" Send me to the
 *   mines.|Sorry.; the two lines after the choice are timed (3 ticks each), then the spell without a
 *   projectile (4731, 342, 201) and the mine 3 ticks later. 2580 was already 2.
 * - The mine: Daeyalt rocks are the Mining plugin's (3 ticks an ore with a rune pickaxe, 3 ores a
 *   rock, the messages). Daeyalt ore on the cart 18119 (or its Inspect): 2588 += n (cap 15), every
 *   ore taken, sound 2999 m3_place_ore and a messagebox (t5753, t5800, t5823). A guard 3690/3691
 *   lets the player go once 2588 is 15: on the continue of "Okay, I guess you can go then, food
 *   sack!" the screen fades and the minimap goes (+1); +3 2574 = 1 and (3621,3322,0); +5 2588 = 0,
 *   the fade in and the minimap back (t5835-5842, again t6992-6999).
 * - 2580 went 2 -> 1 at t7497, about 500 ticks after the second mine exit, and to 0 at logout.
 *
 * Words: the post-Vertida encounter and Talk-to are on the "Vyrewatch" page (the quest page's own
 * variants 0lYCTf / 6sUdhp are "unavailable"); the pre-hideout encounter, the "click away" lines
 * and the messages are on the quest page; the guard is "Vampyre Juvinate (Meiyerditch mine)", the
 * miners "Meiyerditch miner". The lines are rendered here (live times them), their words read from
 * those variants by step id.
 *
 * Stage windows (Wiki: Darkness of Hallowvale, Vyrewatch, Transcript:Vyrewatch): vyrewatch stop the
 * player in Meiyerditch from the arrival (50) on, during and after the quest; before the hideout
 * (80) the offer is tithe/fight/distract, after it tithe/mines/distract. A full set of vyre noble
 * clothing, or The Blood Moon Rises, makes them tolerant. Never for bots.
 */
module.exports = function attachHassle(context) {
  const { api, state, common, STAGE, VARBIT, PAGE } = context;
  const core = api.core;
  const { Location, Boundary, Animation, Graphic, Projectile, HitDamage, HitMask, NpcDialogue, PlayerDialogue, ActionDialogue,
    DialogueChainBuilder, StatementDialogue, World, Sounds, CacheDefinitions, Skill, RegionManager, ItemIdentifiers } = core;
  const { loadTranscripts, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);

  // ---------------------------------------------------------------------------
  // Ids (cache gamevals)
  // ---------------------------------------------------------------------------

  /**
   * Meiyerditch's flying vyrewatch and the forms each takes: sang_myq3_{female,male}_flying[_ns]_vyrewatch_1-4,
   * sang_myq3_*_walk[_ns]_vyrewatch_1-4 (live 3717 -> 3709 on landing, t5652) and myreque_pt3_takeoff[_ns]_vyrewatch_*.
   */
  const FORM_FAMILIES = [
    { flying: 3717, walk: 3709, takeoff: 3713 }, // female
    { flying: 3729, walk: 3721, takeoff: 3725 }, // male
    { flying: 3748, walk: 3756, takeoff: 3764 }, // female, north-south patrol
    { flying: 3752, walk: 3760, takeoff: 3768 }, // male, north-south patrol
  ];
  const FORMS = new Map();
  const FLYING = new Set();
  const LANDED = new Set();
  for (const family of FORM_FAMILIES) {
    for (let i = 0; i < 4; i++) {
      const form = { flying: family.flying + i, walk: family.walk + i, takeoff: family.takeoff + i };
      FORMS.set(form.flying, form);
      FLYING.add(form.flying);
      LANDED.add(form.walk).add(form.takeoff);
    }
  }
  const MINE_GUARDS = new Set([core.NpcIdentifiers.VAMPYRE_JUVINATE_8, core.NpcIdentifiers.VAMPYRE_JUVINATE_17]); // 3690, 3691
  const MINERS = new Set([3819, 3820, 3821, 3822, 3823, 3824]); // myreque_pt3_miner1-6
  const MINE_CART = 18119; // area_sanguine_minecart_multiloc (2588: 17966 empty, 17967-17969 loading)
  const MINE_CART_FORMS = new Set([MINE_CART, 17966, 17967, 17968, 17969]);
  const ORE = ItemIdentifiers.DAEYALT_ORE; // 9632 sang_jas_ore
  const CART_CAPACITY = 15;
  const CHATMENU = 219; // chatmenu, the menu's chatbox group

  const SEQ = Object.freeze({
    LANDING: 4695, // myq3_vampire_flying_landing
    TAKEOFF: 4706, // myq3_vampire_grounded_takeoff
    CASTING: 4729, // myq3_vampire_teleport_spell_casting
    PLAYER_TELEPORTED: 4731, // myq3_player_teleport_spell
    MINER_SWING: 4709, // myq3_mining_wall
  });
  const TELEPORT_IMPACT = 342; // spotanim teleport_other_impact
  const TELEPORT_PROJECTILE = 787; // spotanim myq3_vyrewatch_teleport_spell_proj
  const SOUND = Object.freeze({ ARRIVES: 2991, TELEPORT: 201, PLACE_ORE: 2999 }); // vampire_arrives, teleport_reverse, m3_place_ore
  const CHAT = Object.freeze({ ANG1: 614, ANG2: 615, ANG3: 616, SAD1: 610, HAP1: 567, NEU1: 588, SCARED1: 596 });

  const MINE_ARRIVAL = [2391, 4620, 2]; // t5676, t6846
  const MINE_EXIT = [3621, 3322, 0]; // t5838, t6995

  // ---------------------------------------------------------------------------
  // Timing (live ticks; "Ours" where neither the capture nor the Wiki gives one)
  // ---------------------------------------------------------------------------

  const T = Object.freeze({
    LAND: 1, // message/2580 -> landing anim (t5648 -> t5649)
    TRANSFORM: 4, // -> walking form (t5652)
    LINES: 5, // -> first line (t5653)
    OPENER: 4, // first line shown (t5653 -> t5657)
    OFFER: 5, // second line (t5657 -> t5662)
    REPLY: 3, // each line after the choice (t5665, t5668, t5671; t6837, t6840, t6843)
    HASSLE_TELEPORT: 5, // spell -> mine (t5671 -> t5676)
    TALK_TELEPORT: 3, // spell -> mine (t6843 -> t6846)
    CHOICE_TO_LINE: 1, // click -> 2582 and the line (t5664 -> t5665)
    EXIT_MINIMAP: 1, // fade out -> minimap off (t5835 -> t5836)
    EXIT_TELEPORT: 3, // -> 2574 and the exit tile (t5838)
    EXIT_FADE_IN: 5, // -> 2588 = 0, fade in, minimap (t5840)
    CART_RESET: 2, // the teleport -> 2588 = 0 (t5838 -> t5840)
    RELEASE: 500, // 2580 2 -> 1 (t6995 -> t7497, 502 ticks outside the mine)
    // Ours:
    NOTICE_ROLL: 150, // one chance in this many per tick that a nearby vyrewatch takes an interest (the Wiki gives no rate)
    NOTICE_RANGE: 8, // tiles from the player a vyrewatch notices them from
    APPROACH: 20, // ticks a vyrewatch tries to reach the player before giving up
    COOLDOWN: 100, // ticks before another vyrewatch can stop the same player
    MENU_TIMEOUT: 30, // ticks before an unanswered menu is taken as the tithe (dump jy1YF-: "after some time")
    LINGER: 6, // a tithed or dodged vyre stays down this long ("This vyrewatch looks busy.")
    TAKEOFF_FORM: 3, // the takeoff form's ticks before it flies again
    FIGHT: 30, // a fight's longest run
    FIGHT_RANGE: 10, // tiles the player runs to end a fight
    LINE: 3, // a timed line live did not show
    LONG_LINE: 5, // a timed line of more than one chatbox line
    MINER_GAP: 54, // a miner's overhead gap (live 54-58 ticks: t5697, t5751, t5809)
  });
  const IGNORE_LIMIT = 4; // dump ypTUjF / mk1xiH: "once, twice, or thrice" repeats, "four times" is the tithe
  const TITHE_DAMAGE = 6; // Wiki (Darkness of Hallowvale): "The Vyrewatch will damage you for 6 Hitpoints."
  const DISTRACT_CHANCE = [0, 252]; // Wiki Vyrewatch "Success chance": low 0, high 252 (Thieving 1 0%, 99 99%)
  const ESCAPE_DISTANCE = 4; // Wiki Vyrewatch: "a valid game square must be found about four squares away"
  const OUTFIT_AVOID = 0.2; // Wiki Vyrewatch: each vyrewatch outfit piece "adding a 20% chance to avoid detection"

  // ---------------------------------------------------------------------------
  // Words
  // ---------------------------------------------------------------------------

  const VYREWATCH_PAGE = "Vyrewatch";
  const GUARD_PAGE = "Vampyre Juvinate (Meiyerditch mine)";
  const MINER_PAGE = "Meiyerditch miner";
  const VARIANT = Object.freeze({
    noticedBefore: "contact-with-the-sanguinesti-region-being-noticed-by-a-vyrewatch", // the quest page, before the hideout
    noticedAfter: "standard-dialogue-after-darkness-of-hallowvale-in-meiyerditch-when-the-player-gets-noticed",
    spokenTo: "standard-dialogue-after-darkness-of-hallowvale-in-meiyerditch-when-spoken-to",
    busy: "contact-with-the-sanguinesti-region-talking-to-a-vyrewatch-immediately-after-paying-a-blood-tithe-to-them",
    fighting: "contact-with-the-sanguinesti-region-talking-to-a-vyrewatch-that-was-challenged-in-combat",
    guard: "standard-dialogue",
    guardAfterBloodMoon: "after-the-blood-moon-rises",
    cart: "sanguinesti-diplomacy-being-sent-to-the-mines-inspecting-the-mine-cart",
    minerOverheads: "overhead-dialogue",
  });
  /** The quest page's and the Vyrewatch page's step ids this unit answers. */
  const STEP = Object.freeze({
    NOTICED: "957XY7", // "A vyrewatch takes an interest in you."
    // before the hideout (quest page)
    TITHE_BEFORE: "2J_8qM", FIGHT: "9R6EAA", DODGED: "31eYvP", DODGE_FAILED: "0T6MNv", RUNS_BEFORE: "f1kRJS",
    CLICKED_AWAY: "ypTUjF", // "Hey, food sack, what's the rush?..."
    // after it (Vyrewatch page)
    TITHE_AFTER: "3Cyzux", MINES_AFTER: "Ya3STt", BITTEN_AFTER: "PYNX6n", DODGED_AFTER: "ZOanjT", DODGE_FAILED_AFTER: "s60GrN",
    RUNS_AFTER: "Mi3xNv", OPTION_TITHE: "alkZUD", OPTION_MINES: "Dr5U5z", OPTION_DISTRACT: "sUgQwM",
    MINES_TALK: "QOGfxG",
    BUSY: "dfepMT", FIGHTING: "P9wefO",
    // the guard
    GUARD_PLAIN: "bYyur2", GUARD_DISGUISE: "qo5y3t", CART_SHORT: "uwT4k-", CART_FULL: "epWpcK", RELEASED: "J8VNXc", LED_OUT: "ellX6c",
    // the cart (quest page)
    DEPOSIT_FULL: "hRKanq", DEPOSIT: "8pASBk", CART_ROOM: "SwDX36", CART_NO_ROOM: "7_a5ut",
    // the miners
    NO_PICKAXE: "X_PW35", HAS_PICKAXE: "0pVV7s", GIVE_PICKAXE: "cAHAUP", PICKAXE_BOX: "OEskmT",
  });

  function variantSteps(page, variant) {
    return loadTranscripts(api)?.[page]?.variants?.[variant] ?? [];
  }

  function findStep(steps, test) {
    if (!steps || typeof steps !== "object") return null;
    if (!Array.isArray(steps) && test(steps)) return steps;
    for (const value of Array.isArray(steps) ? steps : Object.values(steps)) {
      if (!value || typeof value !== "object") continue;
      const found = findStep(value, test);
      if (found) return found;
    }
    return null;
  }

  const byId = (page, variant, id) => findStep(variantSteps(page, variant), (step) => step.id === id);
  const lineText = (step) => (typeof step?.player === "string" ? step.player : typeof step?.npc === "string" ? step.npc
    : step?.type === "line" && typeof step.text === "string" ? step.text : null);
  const isPlayerLine = (step) => typeof step?.player === "string";
  const randomLines = (random) => (random?.options ?? []).map((option) => lineText((option.steps ?? []).find(lineText))).filter(Boolean);

  /** The noticed encounter's words for the player's window: openers, offers, the prompt and the three options. */
  function encounterScript(player) {
    if (state.stage(player) < STAGE.IN_HIDEOUT) {
      const steps = variantSteps(PAGE, VARIANT.noticedBefore);
      const randoms = steps.filter((step) => step?.type === "random");
      const choice = steps.find((step) => step?.type === "choice");
      return {
        page: PAGE, openers: randomLines(randoms[0]), offers: randomLines(randoms[1]), prompt: choice?.prompt ?? "Select an option",
        options: (choice?.options ?? []).map((option) => ({ label: option.text, steps: option.steps ?? [] })),
      };
    }
    const steps = variantSteps(VYREWATCH_PAGE, VARIANT.noticedAfter);
    const randoms = steps.filter((step) => step?.type === "random");
    const choice = steps.find((step) => step?.type === "choice");
    // The export put the three options after the empty choice as conditions headed by their labels.
    const options = [STEP.OPTION_TITHE, STEP.OPTION_MINES, STEP.OPTION_DISTRACT]
      .map((id) => steps.find((step) => step?.id === id)).filter(Boolean)
      .map((condition) => ({ label: condition.text, steps: condition.steps ?? [] }));
    return { page: VYREWATCH_PAGE, openers: randomLines(randoms[0]), offers: randomLines(randoms[1]), prompt: choice?.prompt ?? "Select an option", options };
  }

  const message = (page, variant, id) => String(byId(page, variant, id)?.text ?? "");
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // ---------------------------------------------------------------------------
  // Chat: live times the vyrewatch's lines (blank continue); clicked lines where live clicked
  // ---------------------------------------------------------------------------

  function lineDialogue(index, entry) {
    return entry.player
      ? new PlayerDialogue(index, entry.text, entry.expression ?? CHAT.NEU1)
      : new NpcDialogue(index, entry.npc, entry.text, "Vyrewatch", entry.expression ?? CHAT.ANG1);
  }

  /**
   * Plays `entries` ({ npc | player: true, text, expression, ticks | click }) in order, then `then`. A
   * timed entry shows without "Click here to continue" and moves on by itself after its ticks.
   */
  function speak(player, entries, then) {
    const manager = player.getDialogueManager();
    const builder = new DialogueChainBuilder();
    let index = 0;
    for (const entry of entries) {
      if (entry.message !== undefined) {
        // A game message in its place in the conversation (the distraction's outcome).
        builder.add(new ActionDialogue(index++, { execute: () => {
          common.message(player, entry.message);
          manager.advance();
        } }, true));
        continue;
      }
      if (entry.click) {
        builder.add(lineDialogue(index++, entry));
        continue;
      }
      const ticks = entry.ticks ?? (String(entry.text).length > 70 ? T.LONG_LINE : T.LINE);
      const held = new ActionDialogue(index++, { execute: () => {
        lineDialogue(0, entry).sendHeld(player);
        common.later(player, ticks, (p) => { if (p.getDialogueManager().getCurrent() === held) p.getDialogueManager().advance(); });
      } }, true);
      builder.add(held);
    }
    if (then) builder.add(new ActionDialogue(index++, { execute: () => then(player) }));
    manager.startDialogues(builder);
  }

  function closeChat(player) {
    player.getDialogueManager().reset?.();
    player.getPacketSender().sendInterfaceRemoval();
  }

  // ---------------------------------------------------------------------------
  // Who the vyrewatch leave alone
  // ---------------------------------------------------------------------------

  const isBot = (player) => player?.isPlayerBot?.() === true;

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  const wornNames = (player) => (player.getEquipment?.()?.getItems?.() ?? [])
    .filter((item) => item && item.getId() > 0).map((item) => String(CacheDefinitions.getItem(item.getId())?.name ?? ""));

  /** Wiki Vyrewatch: a full set of vyre noble clothing (top, legs, shoes) makes every vyrewatch tolerant. Ours: any three pieces. */
  const wearsNobleClothing = (player) => wornNames(player).filter((name) => name.startsWith("Vyre noble")).length >= 3;
  const outfitPieces = (player) => wornNames(player).filter((name) => /^Vyrewatch (top|legs|shoes)$/.test(name)).length;

  /** Wiki: tolerant after The Blood Moon Rises (its third Drakan fight; ours: its completion). */
  const tolerated = (player) => wearsNobleClothing(player) || questComplete(player, "the_blood_moon_rises");

  function canBeStopped(player) {
    if (isBot(player) || !player.isRegistered?.()) return false;
    if (state.stage(player) < STAGE.ARRIVED) return false;
    if (tolerated(player)) return false;
    // Ours: a player just sent to the mines (2580 = 2) is left alone until live's flag drops back to 1.
    if (state.get(player, VARBIT.VAMP_HASSLE) === 2) return false;
    if ((cooldowns.get(player) ?? 0) > 0) return false;
    if (player.getDialogueManager().getCurrent?.() || core.MultiChatboxPrompt?.getPending?.(player)) return false;
    if (player.getMovementQueue().isMovementBlocked?.() || player.getPrivateArea?.()) return false;
    if (player.getCombat?.()?.isBeingAttacked?.()) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Encounters
  // ---------------------------------------------------------------------------

  /** player -> { npc, form, phase, ticks, ignores, menuOpen, menuToken } */
  const encounters = new Map();
  /** npc -> player it is busy with */
  const engaged = new WeakMap();
  const cooldowns = new WeakMap();
  /** player -> ticks spent in Meiyerditch since the last mine trip (2580 2 -> 1) */
  const releases = new WeakMap();

  const chebyshev = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
  const npcSize = (npc) => npc.getCurrentDefinition?.()?.getSize?.() ?? npc.getDefinition?.()?.getSize?.() ?? 1;

  /** Tiles between the NPC's footprint and the player (0 overlapping, 1 next to). */
  function gap(npc, player) {
    const at = npc.getLocation(), to = player.getLocation();
    const size = npcSize(npc);
    const dx = Math.max(0, at.getX() - to.getX(), to.getX() - (at.getX() + size - 1));
    const dy = Math.max(0, at.getY() - to.getY(), to.getY() - (at.getY() + size - 1));
    return at.getZ() === to.getZ() ? Math.max(dx, dy) : Infinity;
  }

  function freeVyrewatch(player) {
    const here = player.getLocation();
    let best = null;
    for (const npc of World.getNpcsNear(here, T.NOTICE_RANGE)) {
      if (!FLYING.has(npc.getId()) || npc.getNpcTransformationId?.() !== -1 || engaged.has(npc)) continue;
      if (npc.getCombat?.()?.getTarget?.()) continue;
      if (!best || chebyshev(npc.getLocation(), here) < chebyshev(best.getLocation(), here)) best = npc;
    }
    return best;
  }

  /** The per-tick chance (Ours: 1 in NOTICE_ROLL), less 20% per vyrewatch outfit piece (Wiki). */
  function noticeRoll(player) {
    if (Math.random() * T.NOTICE_ROLL >= 1) return false;
    return Math.random() >= outfitPieces(player) * OUTFIT_AVOID;
  }

  /** A vyrewatch takes an interest and flies at the player. */
  function takeInterest(player, npc) {
    engaged.set(npc, player);
    encounters.set(player, { npc, form: FORMS.get(npc.getId()), phase: "approach", ticks: 0, ignores: 0, menuOpen: false, menuToken: 0 });
    npc.setScriptedMovement?.(true);
  }

  function approach(player, encounter) {
    const { npc } = encounter;
    if (!npc.isRegistered?.() || ++encounter.ticks > T.APPROACH) return release(player, encounter, false);
    if (gap(npc, player) <= 1) return land(player, encounter);
    npc.getMovementQueue().requestWalk(player.getLocation().clone());
  }

  /** The tile of the vyre's footprint next to the player, where its walking form stands. */
  function landingTile(npc, player) {
    const at = npc.getLocation(), to = player.getLocation();
    const size = npcSize(npc);
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const x = clamp(to.getX(), at.getX(), at.getX() + size - 1);
    const y = clamp(to.getY(), at.getY(), at.getY() + size - 1);
    return new Location(x, y, at.getZ());
  }

  /** t5648-5662: the message and 2580, the landing, the walking form, two timed lines and the menu. */
  function land(player, encounter) {
    const { npc } = encounter;
    encounter.phase = "landing";
    npc.getMovementQueue().reset();
    const script = encounterScript(player);
    encounter.script = script;
    common.message(player, message(PAGE, VARIANT.noticedBefore, STEP.NOTICED));
    state.set(player, VARBIT.VAMP_HASSLE, 1);
    state.set(player, VARBIT.IGNORE_COUNT, 0);
    player.getMovementQueue().reset().setBlockMovement(true);
    common.anim(player, -1);
    player.setPositionToFace(npc.getLocation().clone());
    common.later(player, T.LAND, (p) => {
      npc.setPositionToFace(p.getLocation().clone());
      common.anim(npc, SEQ.LANDING);
      const at = npc.getLocation();
      Sounds.playAreaSound({ soundId: SOUND.ARRIVES, x: at.getX(), y: at.getY(), level: at.getZ(), radius: 5, source: npc });
    });
    common.later(player, T.TRANSFORM, (p) => {
      if (encounters.get(p) !== encounter) return;
      common.anim(npc, -1);
      npc.moveTo(landingTile(npc, p));
      npc.setNpcTransformationId(encounter.form.walk);
      npc.setPositionToFace(p.getLocation().clone());
    });
    common.later(player, T.LINES, (p) => {
      if (encounters.get(p) !== encounter) return;
      speak(p, [
        { npc: encounter.form.walk, text: pick(script.openers), expression: CHAT.ANG1, ticks: T.OPENER },
        { npc: encounter.form.walk, text: pick(script.offers), expression: CHAT.ANG3, ticks: T.OFFER },
      ], (q) => ask(q, encounter));
    });
  }

  /** "The vyrewatch wants an answer!" (t5662: 2581 = 1). */
  function ask(player, encounter) {
    if (encounters.get(player) !== encounter) return;
    encounter.phase = "menu";
    state.set(player, VARBIT.VAMP_CONV_STEP, 1);
    player.getMovementQueue().setBlockMovement(false);
    const token = ++encounter.menuToken;
    encounter.menuOpen = true;
    common.menu(player, encounter.script.prompt, encounter.script.options.map((option, index) => [option.label, (p) => choose(p, encounter, index, token)]));
    common.later(player, T.MENU_TIMEOUT, (p) => {
      if (encounters.get(p) === encounter && encounter.menuOpen && encounter.menuToken === token) unanswered(p, encounter);
    });
  }

  function choose(player, encounter, index, token) {
    if (encounters.get(player) !== encounter || encounter.menuToken !== token) return;
    encounter.menuOpen = false;
    encounter.phase = "answer";
    player.getMovementQueue().reset().setBlockMovement(true);
    common.later(player, T.CHOICE_TO_LINE, (p) => {
      state.set(p, VARBIT.CHAT_VALUE, index + 1);
      perform(p, encounter, encounter.script.options[index].steps);
    });
  }

  /** The chatbox closed with the menu unanswered (walking off): dump ypTUjF, then the menu again; the fourth is the tithe (mk1xiH). */
  function menuClosed({ player, interfaceId }) {
    const encounter = player && encounters.get(player);
    if (!encounter || !encounter.menuOpen || interfaceId !== CHATMENU) return;
    const token = encounter.menuToken;
    common.later(player, 1, (p) => {
      if (encounters.get(p) !== encounter || !encounter.menuOpen || encounter.menuToken !== token) return;
      if (core.MultiChatboxPrompt?.getPending?.(p)) return;
      ignored(p, encounter);
    });
  }

  function ignored(player, encounter) {
    encounter.menuOpen = false;
    encounter.ignores += 1;
    state.set(player, VARBIT.IGNORE_COUNT, encounter.ignores);
    player.getMovementQueue().reset().setBlockMovement(true);
    if (encounter.ignores >= IGNORE_LIMIT) return unanswered(player, encounter);
    const repeat = byId(PAGE, VARIANT.noticedBefore, STEP.CLICKED_AWAY)?.steps ?? [];
    speak(player, repeat.filter(lineText).map((step) => lineEntry(encounter, step)), (p) => ask(p, encounter));
  }

  /** No answer (dump jy1YF- / mk1xiH): the player says "Okay, have a bite." and is tithed. */
  function unanswered(player, encounter) {
    encounter.menuOpen = false;
    encounter.phase = "answer";
    closeChat(player);
    const bite = encounter.script.options[0]?.steps.find(isPlayerLine);
    speak(player, bite ? [lineEntry(encounter, bite)] : [], (p) => tithe(p, encounter));
  }

  function lineEntry(encounter, step) {
    return isPlayerLine(step)
      ? { player: true, text: lineText(step), expression: CHAT.SAD1, ticks: T.REPLY }
      : { npc: encounter.form.walk, text: lineText(step), expression: CHAT.HAP1, ticks: T.REPLY };
  }

  /**
   * Plays an option's steps: lines (timed), messages, the distraction's two outcomes and the actions,
   * each by its step id.
   */
  function perform(player, encounter, steps) {
    const queue = [];
    let outcome = null;
    const run = (list) => {
      for (const step of list) {
        if (outcome) return;
        if (lineText(step)) queue.push(lineEntry(encounter, step));
        else if (step.type === "message") queue.push({ message: step.text });
        else if (step.type === "condition") {
          const dodged = encounter.dodged ??= distracted(player, encounter);
          if ((step.id === STEP.DODGED || step.id === STEP.DODGED_AFTER) === dodged) {
            run(step.steps ?? []);
            // The quest page's failure ends on "Okay, have a bite." with no action of its own.
            if (!outcome && (step.id === STEP.DODGE_FAILED)) outcome = "tithe";
          }
        } else if (step.type === "action") outcome = ACTIONS[step.id] ?? null;
        else if (step.type === "end") return;
      }
    };
    run(steps);
    speak(player, queue, (p) => conclude(p, encounter, outcome));
  }

  const ACTIONS = {
    [STEP.TITHE_BEFORE]: "tithe", [STEP.TITHE_AFTER]: "tithe", [STEP.BITTEN_AFTER]: "tithe",
    [STEP.FIGHT]: "fight", [STEP.RUNS_BEFORE]: "run", [STEP.RUNS_AFTER]: "run", [STEP.MINES_AFTER]: "mines",
  };

  function conclude(player, encounter, outcome) {
    if (encounters.get(player) !== encounter) return;
    if (outcome === "mines") return castToMines(player, encounter.npc, { encounter });
    if (outcome === "fight") return fight(player, encounter);
    if (outcome === "run") return runAway(player, encounter);
    return tithe(player, encounter);
  }

  /** Wiki: "The Vyrewatch will damage you for 6 Hitpoints." Ours: no animation (none captured). */
  function tithe(player, encounter) {
    closeChat(player);
    player.getMovementQueue().setBlockMovement(false);
    const hit = new HitDamage(TITHE_DAMAGE, HitMask.RED);
    hit.setSource?.(encounter.npc);
    player.getCombat().getHitQueue().addPendingDamage([hit]);
    encounter.phase = "busy";
    common.later(player, T.LINGER, (p) => release(p, encounter, true));
  }

  /** Wiki Vyrewatch "Success chance": Thieving 1 0%, 99 99% (low 0, high 252 out of 256). */
  function distracted(player, encounter) {
    const level = player.getSkillManager().getCurrentLevel(Skill.THIEVING);
    const [low, high] = DISTRACT_CHANCE;
    const chance = (Math.floor(low * (99 - level) / 98 + high * (level - 1) / 98) + 1) / 256;
    if (Math.random() >= chance) return false;
    encounter.escape = escapeTile(player, encounter.npc);
    return !!encounter.escape;
  }

  /** "about four squares away" from the vyre, on a tile the player can stand on. */
  function escapeTile(player, npc) {
    const here = player.getLocation(), from = npc.getLocation();
    const away = [Math.sign(here.getX() - from.getX()), Math.sign(here.getY() - from.getY())];
    const directions = [away, [away[0], 0], [0, away[1]], [-away[1], away[0]], [away[1], -away[0]]]
      .filter(([dx, dy]) => dx || dy);
    for (const [dx, dy] of directions) {
      const tile = new Location(here.getX() + dx * ESCAPE_DISTANCE, here.getY() + dy * ESCAPE_DISTANCE, here.getZ());
      if (!RegionManager.blocked(tile, player.getPrivateArea?.() ?? null)) return tile;
    }
    return null;
  }

  function runAway(player, encounter) {
    closeChat(player);
    player.getMovementQueue().setBlockMovement(false);
    if (encounter.escape) player.getMovementQueue().requestWalk(encounter.escape, true);
    encounter.phase = "busy";
    common.later(player, T.LINGER, (p) => release(p, encounter, true));
  }

  /** Before the hideout: "(The vyrewatch attacks the player)"; Wiki: "allowing you to run away". */
  function fight(player, encounter) {
    closeChat(player);
    player.getMovementQueue().setBlockMovement(false);
    const { npc } = encounter;
    encounter.phase = "fight";
    npc.setScriptedMovement?.(false);
    npc.getCombat?.()?.attack?.(player);
    let ticks = 0;
    const watch = (p) => {
      if (encounters.get(p) !== encounter) return;
      if (++ticks >= T.FIGHT || !npc.isRegistered?.() || chebyshev(npc.getLocation(), p.getLocation()) > T.FIGHT_RANGE
        || npc.getLocation().getZ() !== p.getLocation().getZ()) {
        npc.getCombat?.()?.reset?.();
        return release(p, encounter, true);
      }
      common.later(p, 1, watch);
    };
    common.later(player, 1, watch);
  }

  /** The encounter ends; a landed vyre takes off (Ours: its takeoff form and sequence) and flies again. */
  function release(player, encounter, cooled) {
    if (encounters.get(player) === encounter) encounters.delete(player);
    if (cooled) cooldowns.set(player, T.COOLDOWN);
    state.set(player, VARBIT.IGNORE_COUNT, 0);
    player.getMovementQueue?.()?.setBlockMovement?.(false);
    const { npc } = encounter;
    if (engaged.get(npc) === player) engaged.delete(npc);
    npc.getMovementQueue?.()?.reset?.();
    if (npc.getNpcTransformationId?.() === -1) {
      npc.setScriptedMovement?.(false);
      return;
    }
    npc.setNpcTransformationId(encounter.form.takeoff);
    common.anim(npc, SEQ.TAKEOFF);
    // Keyed on the NPC, not the player: a logout during the takeoff must not leave the world vyre
    // transformed and scripted (loggedOut has no encounter left to reset it).
    core.TaskManager.submit(new core.CountdownTask({ npc, unit: "darkness-of-hallowvale:takeoff" }, T.TAKEOFF_FORM, () => {
      if (engaged.has(npc)) return;
      npc.setNpcTransformationId(-1);
      npc.setScriptedMovement?.(false);
    }));
  }

  // ---------------------------------------------------------------------------
  // The teleport into the mine
  // ---------------------------------------------------------------------------

  /**
   * The vyre's spell. Noticed (t5671): 4731 and 342 at delay 70, the vyre's 4729, projectile 787 and
   * sound 201 (delay 70), then 2580 = 2 and the mine 5 ticks on. Talk-to (t6843): 4731, 342 and 201
   * at once, the mine 3 ticks on.
   */
  function castToMines(player, npc, { encounter = null } = {}) {
    const delay = encounter ? 70 : 0;
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new Animation(SEQ.PLAYER_TELEPORTED, delay));
    player.performGraphic(new Graphic(TELEPORT_IMPACT, delay, 92));
    common.sound(player, SOUND.TELEPORT, delay);
    if (encounter) {
      encounter.phase = "teleport";
      common.anim(npc, SEQ.CASTING);
      // map_projanim_v2 heights are four times the packet's: 32 -> 64 is 8 -> 16.
      new Projectile(npc.getLocation().clone(), player.getLocation().clone(), player, TELEPORT_PROJECTILE, 10, 60, 8, 16, null)
        .withAngle(15).withProgress(64).withSource(npc).sendProjectile();
    }
    common.later(player, encounter ? T.HASSLE_TELEPORT : T.TALK_TELEPORT, (p) => {
      state.set(p, VARBIT.VAMP_HASSLE, 2);
      releases.delete(p);
      p.getMovementQueue().setBlockMovement(false);
      p.moveTo(new Location(...MINE_ARRIVAL));
      common.anim(p, -1);
      closeChat(p);
      if (encounter) {
        if (encounters.get(p) === encounter) encounters.delete(p);
        if (engaged.get(npc) === p) engaged.delete(npc);
        npc.setNpcTransformationId(-1);
        npc.setScriptedMovement?.(false);
      }
      api.emitCustomEvent("darkness-of-hallowvale:sent-to-mines", { player: p });
    });
  }

  /** Other content (a vyrewatch elsewhere) can send a player to the mine: { player, npc, handled }. */
  function sendToMinesRequest(request) {
    if (!request?.player || request.handled) return;
    request.handled = true;
    castToMines(request.player, request.npc ?? null);
  }

  // ---------------------------------------------------------------------------
  // Talk-to on a vyrewatch this unit owns: one busy with the player, or the mines offer
  // ---------------------------------------------------------------------------

  const optionOf = (event) => event.definition?.getActions?.()?.[event.clickType - 1] ?? event.action ?? null;
  const inMeiyerditch = (player) => meiyerditch.getBoundaries().some((boundary) => boundary.inside(player.getLocation()));
  const inMine = (player) => mine.getBoundaries().some((boundary) => boundary.inside(player.getLocation()));

  function talkVyrewatch(event) {
    const { player, npc } = event;
    if (!player || !npc || isBot(player) || optionOf(event) !== "Talk-to") return;
    const id = npc.getId();
    if (!FLYING.has(id) && !LANDED.has(id)) return;
    const holder = engaged.get(npc);
    if (holder === player) {
      const encounter = encounters.get(player);
      event.handled = true;
      if (encounter?.phase === "busy") common.message(player, message(PAGE, VARIANT.busy, STEP.BUSY));
      else if (encounter?.phase === "fight") common.message(player, message(PAGE, VARIANT.fighting, STEP.FIGHTING));
      // Approaching or landing: the encounter itself answers (live t5646 -> t5648).
      return;
    }
    if (holder) {
      event.handled = true; // someone else's vyre
      return;
    }
    if (state.stage(player) < STAGE.IN_HIDEOUT || !inMeiyerditch(player) || encounters.has(player)) return;
    event.handled = true;
    offerMines(player, npc);
  }

  /** t6829-6846: "Hello?", an insult, Send me to the mines.|Sorry. */
  function offerMines(player, npc) {
    const steps = variantSteps(VYREWATCH_PAGE, VARIANT.spokenTo);
    const hello = steps.find(isPlayerLine);
    const insults = randomLines(steps.find((step) => step?.type === "random"));
    const choice = steps.find((step) => step?.type === "choice");
    const options = choice?.options ?? [];
    const head = npc.getNpcTransformationId?.() > 0 ? npc.getNpcTransformationId() : npc.getId();
    npc.setPositionToFace?.(player.getLocation().clone());
    speak(player, [
      { player: true, text: lineText(hello), expression: CHAT.SCARED1, click: true },
      { npc: head, text: pick(insults), expression: CHAT.ANG2, click: true },
    ], (p) => common.menu(p, choice?.prompt ?? "Select an option", options.map((option) => [option.text, (q) => {
      const lines = (option.steps ?? []).filter(lineText);
      const toMines = !!findStep(option.steps ?? [], (step) => step.id === STEP.MINES_TALK);
      if (!toMines) return speak(q, lines.map((step) => ({ player: isPlayerLine(step), npc: head, text: lineText(step), expression: CHAT.NEU1, click: true })));
      speak(q, lines.map((step) => isPlayerLine(step)
        ? { player: true, text: lineText(step), expression: CHAT.NEU1, ticks: T.REPLY }
        : { npc: head, text: lineText(step), expression: CHAT.HAP1, ticks: T.REPLY }), (r) => castToMines(r, npc));
    }])));
  }

  // ---------------------------------------------------------------------------
  // The mine: the cart, the guards, the miners
  // ---------------------------------------------------------------------------

  const cartCount = (player) => state.get(player, VARBIT.MINE_CART);

  /** "You deposit [1-14] ore(s) into the cart. The cart can hold [1-14] more ore(s)." with live's counts and break. */
  function fill(template, ...counts) {
    let index = 0;
    return template.replace(/\[\d+-\d+\]( more)? ore\(s\)/g, (_, more) => {
      const count = counts[index++] ?? 0;
      return `${count}${more ?? ""} ore${count === 1 ? "" : "s"}`;
    }).replace(/\. The cart/, ".<br>The cart");
  }

  /** Ore on the cart, or its Inspect (Wiki: left-click deposits since 7 June 2018). t5750-5753. */
  function useCart(event) {
    const { player } = event;
    if (!MINE_CART_FORMS.has(event.objectId) || !inMine(player)) return false;
    const inventory = player.getInventory();
    const have = inventory.getAmount(ORE);
    const room = CART_CAPACITY - cartCount(player);
    if (room <= 0) {
      common.mesbox(player, message(PAGE, VARIANT.cart, STEP.CART_NO_ROOM));
      return true;
    }
    if (have <= 0) {
      common.mesbox(player, fill(message(PAGE, VARIANT.cart, STEP.CART_ROOM), room));
      return true;
    }
    const deposit = Math.min(have, room);
    inventory.delete(ORE, deposit);
    inventory.refreshItems?.();
    state.set(player, VARBIT.MINE_CART, cartCount(player) + deposit);
    common.sound(player, SOUND.PLACE_ORE);
    const left = room - deposit;
    common.mesbox(player, left > 0
      ? fill(message(PAGE, VARIANT.cart, STEP.DEPOSIT), deposit, left)
      : fill(message(PAGE, VARIANT.cart, STEP.DEPOSIT_FULL), deposit));
    return true;
  }

  function talkGuard(event) {
    const { player, npc } = event;
    if (!MINE_GUARDS.has(npc?.getId?.()) || !inMine(player)) return false;
    if (questComplete(player, "the_blood_moon_rises")) {
      // Wiki (Meiyerditch mine): after The Blood Moon Rises the guard escorts the player out.
      startTranscript(api, player, npc.getId(), GUARD_PAGE, VARIANT.guardAfterBloodMoon, (steps) => [...steps,
        { type: "action", id: STEP.LED_OUT, text: "(led out)" }], npc);
      return true;
    }
    startTranscript(api, player, npc.getId(), GUARD_PAGE, VARIANT.guard, null, npc);
    return true;
  }

  function answerCondition({ player, stepId }) {
    if (!player) return null;
    switch (stepId) {
      case STEP.GUARD_PLAIN: return !wearsNobleClothing(player);
      case STEP.GUARD_DISGUISE: return wearsNobleClothing(player);
      case STEP.CART_SHORT: return cartCount(player) < CART_CAPACITY;
      case STEP.CART_FULL: return cartCount(player) >= CART_CAPACITY;
      case STEP.NO_PICKAXE: return !holdsPickaxe(player);
      case STEP.HAS_PICKAXE: return holdsPickaxe(player);
      default: return null;
    }
  }

  /** Wiki (Meiyerditch miner): the spare pick is offered "If the player doesn't have a pickaxe in their inventory". */
  const holdsPickaxe = (player) => (player.getInventory().getItems() ?? [])
    .some((item) => item && item.getId() > 0 && /pickaxe/i.test(String(CacheDefinitions.getItem(item.getId())?.name ?? "")));

  function dialogueAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (stepId === STEP.RELEASED || stepId === STEP.LED_OUT) {
      if (!inMine(player)) return;
      event.handled = true;
      event.end = true;
      leaveMine(player);
      return;
    }
    if (stepId === STEP.GIVE_PICKAXE) {
      event.handled = true;
      player.getInventory().add(new core.Item(ItemIdentifiers.BRONZE_PICKAXE, 1));
      return;
    }
    if (stepId === STEP.PICKAXE_BOX && event.kind === "message") event.box = { items: [ItemIdentifiers.BRONZE_PICKAXE] };
  }

  /** t5835-5842: fade out; +1 minimap off; +3 2574 = 1 and the north-east of Meiyerditch; +5 2588 = 0, fade in, minimap. */
  function leaveMine(player) {
    closeChat(player);
    Scenes.fade(player, true);
    player.getMovementQueue().reset().setBlockMovement(true);
    common.later(player, T.EXIT_MINIMAP, (p) => Scenes.controls(p, true));
    common.later(player, T.EXIT_TELEPORT, (p) => {
      state.set(p, VARBIT.MINE_PUNISHED, 1);
      p.moveTo(new Location(...MINE_EXIT));
    });
    common.later(player, T.EXIT_FADE_IN, (p) => {
      if (cartCount(p) > 0) state.set(p, VARBIT.MINE_CART, 0);
      Scenes.fade(p, false);
      Scenes.controls(p, false);
    });
  }

  // ---------------------------------------------------------------------------
  // Areas
  // ---------------------------------------------------------------------------

  const planes = (minX, maxX, minY, maxY) => [0, 1, 2, 3].map((z) => new Boundary(minX, maxX, minY, maxY, z));

  /** Meiyerditch above ground: the ghetto, its rooftops and walls (the hideout and laboratory below are not in it). */
  const MEIYERDITCH_BOUNDS = planes(3584, 3660, 3136, 3327);
  /** The Meiyerditch mine (live 2378-2397 x 4616-4636, plane 2). */
  const MINE_BOUNDS = [new Boundary(2368, 2407, 4600, 4655, 2)];

  class MeiyerditchHassleArea extends core.Area {
    getName() { return "Darkness of Hallowvale: Meiyerditch"; }
    process(mobile) {
      if (mobile?.isPlayer?.()) meiyerditchTick(mobile.getAsPlayer?.() ?? mobile);
    }
    postLeave(mobile) {
      if (mobile?.isPlayer?.()) leftMeiyerditch(mobile.getAsPlayer?.() ?? mobile);
    }
  }

  class MeiyerditchMineArea extends core.Area {
    getName() { return "Darkness of Hallowvale: Meiyerditch mine"; }
    process(mobile) {
      if (mobile?.isNpc?.() && MINERS.has(mobile.getId())) minerTick(mobile, this);
    }
    postLeave(mobile, logout) {
      if (mobile?.isPlayer?.() && !logout) leftMine(mobile.getAsPlayer?.() ?? mobile);
    }
  }

  const meiyerditch = new MeiyerditchHassleArea(MEIYERDITCH_BOUNDS);
  const mine = new MeiyerditchMineArea(MINE_BOUNDS);

  function meiyerditchTick(player) {
    if (isBot(player)) return;
    const cooldown = cooldowns.get(player) ?? 0;
    if (cooldown > 0) cooldowns.set(player, cooldown - 1);
    if (state.get(player, VARBIT.VAMP_HASSLE) === 2 && !encounters.has(player)) {
      const spent = (releases.get(player) ?? 0) + 1;
      if (spent >= T.RELEASE) {
        releases.delete(player);
        state.set(player, VARBIT.VAMP_HASSLE, 1);
      } else releases.set(player, spent);
    }
    const encounter = encounters.get(player);
    if (encounter) {
      if (encounter.phase === "approach") approach(player, encounter);
      return;
    }
    if (!canBeStopped(player) || !noticeRoll(player)) return;
    const npc = freeVyrewatch(player);
    if (npc) takeInterest(player, npc);
  }

  /**
   * Ours (not captured): leaving Meiyerditch ends an encounter that has not reached its spell, so a
   * vyre that landed or asked can't tithe the player elsewhere when its menu times out.
   */
  function leftMeiyerditch(player) {
    const encounter = encounters.get(player);
    if (!encounter || encounter.phase === "teleport") return;
    if (encounter.phase !== "approach") closeChat(player);
    release(player, encounter, false);
  }

  /** Ours: leaving the mine any other way (a teleport) empties the cart too, as the guard's exit does 2 ticks on. */
  function leftMine(player) {
    common.later(player, T.CART_RESET, (p) => { if (!inMine(p) && cartCount(p) > 0) state.set(p, VARBIT.MINE_CART, 0); });
  }

  /** Each miner swings and says one of its lines about every 54-58 ticks (live t5697, t5751, t5809). */
  const minerClocks = new WeakMap();
  function minerTick(npc, area) {
    if (!area.getPlayers?.().length) return;
    const left = minerClocks.get(npc) ?? Math.floor(Math.random() * T.MINER_GAP);
    if (left > 0) {
      minerClocks.set(npc, left - 1);
      return;
    }
    minerClocks.set(npc, T.MINER_GAP + Math.floor(Math.random() * 5));
    const lines = randomLines(variantSteps(MINER_PAGE, VARIANT.minerOverheads).find((step) => step?.type === "random"));
    if (!lines.length) return;
    common.anim(npc, SEQ.MINER_SWING);
    npc.forceChat?.(pick(lines));
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  /** A logout ends the encounter (Wiki: logging out avoids the vyrewatch); the vyre flies again. */
  function loggedOut({ player }) {
    // The cart's delayed visual reset may not run after logout. Settle it before saving,
    // but retain ore when an interrupted exit has not yet moved the player out of the mine.
    if (!inMine(player) && cartCount(player) > 0) state.set(player, VARBIT.MINE_CART, 0);
    const encounter = encounters.get(player);
    if (encounter) {
      encounters.delete(player);
      if (engaged.get(encounter.npc) === player) engaged.delete(encounter.npc);
      encounter.npc.setNpcTransformationId?.(-1);
      encounter.npc.setScriptedMovement?.(false);
    }
    releases.delete(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.registerArea(meiyerditch);
  api.registerArea(mine);
  api.onBeforeNpcInteraction(talkVyrewatch);
  api.onNpcInteraction("Vampyre Juvinate", { "Talk-to": talkGuard });
  api.onItemOnObject("Daeyalt ore", "Mine cart", useCart);
  api.onObjectInteraction("Mine cart", { Inspect: useCart });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
  api.onCustomEvent("interface:closed", menuClosed);
  api.onCustomEvent("darkness-of-hallowvale:send-to-mines", sendToMinesRequest);
  api.onPlayerLogout(loggedOut);
};
