"use strict";

const {
  Animation, CountdownTask, DialogueChainBuilder, Graphic, Location, NpcDialogue, OptionDialogue,
  PluginManager, RegionManager, Task, TaskManager,
} = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Prizes = require("./Prizes.Construction");

// Mimic the jester (rsprox captures, Wiki): Activate ("You cannot summon the jester while in
// building mode.") says "You summon a jester.", plays sound 952 and poh_jester_elevate on the box,
// which shows poh_mime_jester2 three ticks later; Jacky Jester (poh_mimic) pops out with
// poh_jester_box_opens. He says "Let's play a game!" and "Everyone copy me!" and does default
// emotes; players in the 7x7 around him copy them, and the first to copy ten wins, after which he
// goes back in his box. Banish asks "Have you had enough fun for now?". How long players have to
// copy each emote, the count messages and the Banish answers are this server's.
const NPC_ID = Ids.npc("poh_mimic");
const SUMMON_SOUND = 952;
const ELEVATE = Ids.seq("poh_jester_elevate");
const BOX_OPENS = Ids.spotanim("poh_jester_box_opens");
const OPEN_BOX = Ids.loc("poh_mime_jester2");
const EMOTE_TICKS = 8;
const RADIUS = 3;
const WIN = 10;
// The default emotes: yes, no, bow, angry, think, wave, shrug, cheer, beckon, laugh, jump for
// joy, yawn, dance, jig, spin, headbang, cry, blow kiss, panic, raspberry, clap, salute.
const EMOTES = [
  "yes", "no", "bow", "angry", "think", "wave", "shrug", "cheer", "beckon", "laugh", "jump_with_joy", "yawn", "dance",
  "dance_scottish", "dance_spin", "dance_headbang", "cry", "blow_kiss", "panic", "ya_boo_sucks", "clap", "fremmenik_salute",
].map((emote) => Ids.seq(`emote_${emote}`));

/** house -> { npc, furniture, emote, copied: Set, scores: Map(player -> n) } */
const shows = new WeakMap();

function activate(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (furniture?.buildableKey !== "JESTER") return false;
  if (house.buildingMode) return player.sendMessage("You cannot summon the jester while in building mode."), true;
  if (shows.has(house) || event.objectId === OPEN_BOX) return player.sendMessage("Nothing interesting happens."), true;
  Prizes.offer(player, house, "mime", () => summon(player, house, furniture, event));
  return true;
}

function summon(player, house, furniture, event) {
  if (shows.has(house) || House.houseFor(player) !== house || house.buildingMode) return;
  const { x, y, z } = event.location;
  const show = { furniture, npc: null, emote: -1, copied: new Set(), scores: new Map() };
  shows.set(house, show);
  player.sendMessage("You summon a jester.");
  for (const occupant of house.getPlayers()) occupant.getPacketSender().sendAreaSound(SUMMON_SOUND, x, y, z, 1, 0, 5);
  const box = house.furnitureObjects.find(object => house.getFurnitureAt(
    { x: object.getLocation().getX(), y: object.getLocation().getY(), z: object.getLocation().getZ() }, object.getId(), object.getType()) === furniture);
  if (box) for (const occupant of house.getPlayers()) occupant.getPacketSender().sendObjectAnimation(box, new Animation(ELEVATE));
  TaskManager.submit(new CountdownTask(player, 3, () => {
    if (shows.get(house) !== show) return;
    furniture.displayObjectId = OPEN_BOX;
    house.redrawFurniture();
  }));
  TaskManager.submit(new CountdownTask(player, 5, () => {
    if (shows.get(house) !== show) return;
    const at = standingTile(house, x, y, z);
    for (const occupant of house.getPlayers()) occupant.getPacketSender().sendGraphic(new Graphic(BOX_OPENS), at);
    const npc = PluginManager.spawnNpc({ id: NPC_ID, x: at.getX(), y: at.getY(), z, wanderRadius: 0 });
    if (!npc) return end(house, show);
    npc.__skipDefaultRespawn = true;
    house.enter(npc);
    show.npc = npc;
    TaskManager.submit(new JesterTask(house, show));
  }));
}

/** A free tile beside the box, which is two tiles square. */
function standingTile(house, x, y, z) {
  const around = [[0, 2], [1, 2], [2, 0], [2, 1], [0, -1], [1, -1], [-1, 0], [-1, 1]];
  for (const [dx, dy] of around) {
    const tile = new Location(x + dx, y + dy, z);
    if (!RegionManager.blocked(tile, house)) return tile;
  }
  return new Location(x, y + 2, z);
}

class JesterTask extends Task {
  constructor(house, show) {
    super(1, show.npc.getIndex(), false);
    this.house = house;
    this.show = show;
    this.step = 0;
  }

  execute() {
    const { house, show } = this;
    if (shows.get(house) !== show || !show.npc.isRegistered() || house.isDestroyed()) return this.stop();
    this.step++;
    if (this.step === 1) show.npc.forceChat("Let's play a game!");
    if (this.step === 3) show.npc.forceChat("Everyone copy me!");
    if (this.step < 5 || (this.step - 5) % EMOTE_TICKS) return;
    show.emote = EMOTES[Math.floor(Math.random() * EMOTES.length)];
    show.copied.clear();
    show.npc.performAnimation(new Animation(show.emote));
  }
}

/** player:emote: a copy of the jester's last emote, from close by, scores once. */
function copied({ player, sequence }) {
  const house = House.houseFor(player);
  const show = house && shows.get(house);
  if (!show?.npc || show.emote !== sequence || show.copied.has(player)) return;
  if (!player.getLocation().isWithinDistance(show.npc.getLocation(), RADIUS)) return;
  show.copied.add(player);
  const score = (show.scores.get(player) ?? 0) + 1;
  show.scores.set(player, score);
  if (score < WIN) return player.sendMessage(`You copy the jester. (${score}/${WIN})`);
  for (const occupant of house.getPlayers()) occupant.sendMessage(`${player.getDisplayName()} has copied the jester ten times and wins!`);
  Prizes.award(house, "mime", player);
  end(house, show);
}

function banish(event) {
  const house = House.houseFor(event.player);
  const show = house && shows.get(house);
  if (!show || show.npc !== event.npc) return false;
  event.player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, NPC_ID, "Have you had enough fun for now?"),
    new OptionDialogue(1, {
      executeOption(option) {
        event.player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) end(house, show);
      },
    }, "Yes, go back in your box.", "No, let's keep playing."),
  ));
  return true;
}

function end(house, show) {
  if (shows.get(house) !== show) return;
  shows.delete(house);
  Prizes.withdraw(house, "mime");
  if (show.npc?.isRegistered()) {
    house.leave(show.npc, false);
    PluginManager.removeNpc(show.npc);
  }
  delete show.furniture.displayObjectId;
  house.redrawFurniture();
}

/** Instance.rebuild in building mode: the jester goes back in his box. */
function resetJester(house) {
  const show = shows.get(house);
  if (show && house.buildingMode) end(house, show);
}

function attachJester(api) {
  api.onObjectInteraction("Jacky Jester", { Activate: activate });
  api.onNpcInteraction("Jacky Jester", { Banish: banish });
  api.onCustomEvent("player:emote", copied);
}

Object.assign(module.exports, { attachJester, resetJester });
