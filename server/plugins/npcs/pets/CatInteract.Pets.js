/**
 * A cat follower's "Interact" menu: Stroke, Chase Vermin, Guess age (kittens) and Shoo away.
 *
 * rsprox captures: the user's revision 242 Gertrude's Cat run (GertrudesCat.bin, ticks 918-964:
 * a kitten's Stroke, Chase Vermin, Guess age and a refused Shoo away), rsprox.net 3219 (revision
 * 232: a kitten's accepted Shoo away, tick 23992-24012) and 3216 (an adult cat's menu and Stroke,
 * tick 5486). Words follow Transcript:Kitten and Transcript:Cat, without a catspeak amulet.
 *
 * - **Menu:** "Interact with kitten" (Stroke|Chase Vermin|Guess age|Shoo away); an adult cat's
 *   "Interact with cat" has no Guess age (3216).
 * - **Stroke:** "You softly stroke your cat.", the player's `human_pickupfloor` and the cat's
 *   `cat_rollingover` as it is chosen; 3 ticks later the cat's "Purr...purr..." overhead with the
 *   `purr` sound and the player's line (chathap1). BUSY until that is continued.
 * - **Guess age:** the player's "I wonder how old you are..." (chatneu1), then the age in a
 *   message box; BUSY until it is continued.
 * - **Shoo away:** "Are you sure you want to shoo away the cat?" (Yes I am.|No I'm not.). No:
 *   "You choose not to shoo away the cat." (spam). Yes: the player's "Shoo cat!" overhead, and a
 *   tick later "The cat has run away.", the cat's "Meeeooow!" with the `kittens_mew` sound, and
 *   the follower is gone.
 */
let api, services;

const BUSY_VARBIT = 12393; // busy
const PICKUP_SEQ = "human_pickupfloor";
const ROLL_SEQ = "cat_rollingover";
const PURR_SOUND = 340; // purr
const MEW_SOUND = 339; // kittens_mew
const HAPPY_HEAD = 567; // chathap1
const NEUTRAL_HEAD = 588; // chatneu1
/** The purr and the player's line come 3 ticks after the stroke (capture ticks 920-923). */
const STROKE_LINE_TICKS = 3;
/** "The cat has run away." and its mew come a tick after "Shoo cat!" (3219 ticks 24007-24008). */
const SHOO_RUN_TICKS = 1;

const STROKED = "You softly stroke your cat.";
const PURR = "Purr...purr...";
const KITTEN_STROKE_LINE = "That cat sure loves to be stroked.";
/** Transcript:Cat, Interacting; rec 3216 tick 5492-5494. */
const CAT_STROKE_LINES = { player: "Who's a good cat then?", cat: "Me! Me! Scratch me behind the ears." };
const WONDER = "I wonder how old you are...";
const SHOO_PROMPT = "Are you sure you want to shoo away the cat?";
const SHOO_REFUSED = "You choose not to shoo away the cat.";
const SHOO = "Shoo cat!";
const RUN_MEW = "Meeeooow!";
const RAN_AWAY = "The cat has run away.";

const KITTEN_STAGES = new Set(["kitten", "hellkitten"]);
const isKitten = (info) => KITTEN_STAGES.has(info?.stage);

function attach(pluginApi, petServices) {
  api = pluginApi;
  services = petServices;
}

const seq = (name) => api.core.CacheDefinitions.getSeqId(name);
const later = (player, ticks, fn) => api.core.TaskManager.submit(new api.core.CountdownTask(player, ticks, () => {
  if (player.isRegistered?.() !== false) fn();
}));

/** BUSY while the player watches a stroke or an age guess, cleared when it ends however it ends. */
function busyChain(player, entries) {
  const { DialogueChainBuilder, ActionDialogue } = api.core;
  const packets = player.getPacketSender();
  packets.sendVarbit(BUSY_VARBIT, 1);
  const created = entries.map((make, index) => make(index));
  created.push(new ActionDialogue(created.length, { execute: () => {
    packets.sendInterfaceRemoval();
    packets.sendVarbit(BUSY_VARBIT, 0);
  } }));
  const chain = new DialogueChainBuilder();
  created.forEach((entry) => chain.add(entry));
  const manager = player.getDialogueManager();
  manager.startDialogues(chain);
  const mine = new Set(created);
  // Closed some other way (a walk, a teleport, another conversation): BUSY still clears.
  api.core.TaskManager.submit(new (class extends api.core.Task {
    constructor() { super(1, player, false); }
    execute() {
      if (player.isRegistered?.() === false) return this.stop();
      if (mine.has(manager.getCurrent?.())) return;
      this.stop();
      packets.sendVarbit(BUSY_VARBIT, 0);
    }
  })());
}

function stroke(player, npc, entry) {
  const info = services.catInfoOf(entry);
  if (!services.strokeCat(player, npc)) return;
  player.sendMessage(STROKED);
  player.performAnimation(new api.core.Animation(seq(PICKUP_SEQ)));
  npc.performAnimation(new api.core.Animation(seq(ROLL_SEQ)));
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  later(player, STROKE_LINE_TICKS, () => {
    if (npc.isRegistered?.() !== false) npc.forceChat(PURR);
    player.getPacketSender().sendSoundEffect(PURR_SOUND, 1, 0);
    const { PlayerDialogue, NpcDialogue } = api.core;
    const lines = isKitten(info)
      ? [(index) => new PlayerDialogue(index, KITTEN_STROKE_LINE, HAPPY_HEAD)]
      : [(index) => new PlayerDialogue(index, CAT_STROKE_LINES.player, HAPPY_HEAD),
        (index) => new NpcDialogue(index, npc.getId(), CAT_STROKE_LINES.cat, undefined, HAPPY_HEAD)];
    busyChain(player, lines);
  });
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * "2 hours 58 minutes", "1 hour 13 minutes", "28 minutes", "0 minutes" (captures); a whole number of
 * hours reads "3 hours  00 minutes" (GertrudesCat.bin tick 944, 3219 tick 22698).
 */
function duration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return plural(minutes, "minute");
  return `${plural(hours, "hour")} ${minutes ? plural(minutes, "minute") : " 00 minutes"}`;
}

/** The kitten's age and time to adulthood from its growth count (one per 90 seconds; 120 to adult). */
function ageText(state) {
  const growth = Math.max(0, Number(state?.growth) || 0);
  const age = Math.floor(growth * 1.5);
  const left = Math.floor(Math.max(0, services.kittenGrowth - growth) * 1.5);
  return `After taking a good look at your kitten you guess that its age is: ${duration(age)}. And approximate time until fully adult: ${duration(left)}, assuming you look after it.`;
}

function guessAge(player) {
  const state = services.getCatState(player);
  if (!state || !KITTEN_STAGES.has(state.stage)) return;
  const { PlayerDialogue, StatementDialogue } = api.core;
  busyChain(player, [
    (index) => new PlayerDialogue(index, WONDER, NEUTRAL_HEAD),
    (index) => new StatementDialogue(index, ageText(state)),
  ]);
}

function shooAway(player, withCurrentCat) {
  api.sendMultiChatboxPrompt(
    player,
    SHOO_PROMPT,
    "Yes I am.", withCurrentCat(() => {
      player.getPacketSender().sendInterfaceRemoval();
      player.forceChat(SHOO);
      // The follower then (a recall or growth in between replaces the NPC), as the menu's own choices do.
      later(player, SHOO_RUN_TICKS, withCurrentCat((current) => {
        player.sendMessage(RAN_AWAY);
        current.forceChat(RUN_MEW);
        player.getPacketSender().sendSoundEffect(MEW_SOUND, 1, 0);
        services.shooCat(player, current);
      }));
    }),
    "No I'm not.", () => player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, SHOO_REFUSED),
  );
}

function open(player, npc, pet) {
  if (!services.catInfoOf(pet)) return false;
  if (typeof api?.sendMultiChatboxPrompt !== "function") return true;
  // Recall and growth replace the NPC while this non-interrupting prompt stays
  // open. Keep the logical cat session, then resolve its live follower per choice.
  const state = services.getCatState(player);
  const withCurrentCat = (action) => () => {
    const current = player.getAttribute?.(services.currentAttribute);
    const entry = services.getPetByNpcId(current?.getId?.());
    if (!current?.isRegistered?.() || !current.isPet?.() || current.getOwner?.() !== player
        || services.removing(current) || !services.catInfoOf(entry)
        || services.getCatState(player) !== state || (!state && current !== npc)) return;
    action(current, entry);
  };
  const kitten = isKitten(services.catInfoOf(pet));
  const options = [
    "Stroke", withCurrentCat((current, entry) => stroke(player, current, entry)),
    "Chase Vermin", withCurrentCat((current, entry) => services.chaseVermin(player, current, entry)),
    ...(kitten ? ["Guess age", withCurrentCat(() => guessAge(player))] : []),
    "Shoo away", withCurrentCat(() => shooAway(player, withCurrentCat)),
  ];
  const opened = api.sendMultiChatboxPrompt(player, `Interact with ${kitten ? "kitten" : "cat"}`, ...options);
  return opened !== false;
}

module.exports = {
  attach,
  open,
  _test: { ageText, duration, STROKED, PURR, KITTEN_STROKE_LINE, CAT_STROKE_LINES, WONDER, SHOO_PROMPT, SHOO_REFUSED, SHOO, RAN_AWAY, RUN_MEW },
};
