/**
 * What the Ralos' Rise units share: their data (plugins/skills/data/ralos-rise.json, and the bones'
 * blessed forms and shard counts in bones.json) resolved to ids, the message box the recordings
 * show for every refusal, and the Zealot's robes count the bowl's shard saving reads.
 */
const DATA = require("../data/ralos-rise.json");
const BONES = require("../data/bones.json");
const ALTARS = require("../data/bone-altars.json");

let api = null;
let core = null;
let ids = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function gameval(kind, name) {
  const { CacheDefinitions } = core;
  const id = kind === "obj" ? CacheDefinitions.getObjId(name)
    : kind === "seq" ? CacheDefinitions.getSeqId(name)
      : CacheDefinitions.getVarbitId(name);
  if (!Number.isInteger(id)) throw new Error(`[RalosRise] unknown ${kind} gameval ${name}`);
  return id;
}

/** Every gameval in the data, resolved on first use. */
function resolved() {
  if (ids) return ids;
  const obj = (name) => gameval("obj", name);
  const blessable = new Map();
  const shards = new Map();
  for (const row of BONES.bones) {
    if (!row.blessed) continue;
    const level = row.level ?? 0;
    blessable.set(obj(row.obj), { blessed: obj(row.blessed), level, wine: false });
    shards.set(obj(row.blessed), { shards: row.shards, level });
  }
  for (const wine of DATA.altar.wines) blessable.set(obj(wine.obj), { blessed: obj(wine.blessed), level: 0, wine: true });
  for (const row of DATA.breakdown.extra) shards.set(obj(row.obj), { shards: row.shards, level: row.level ?? 0 });
  ids = {
    blessable,
    shards,
    shard: obj(DATA.breakdown.shard),
    chisel: obj(DATA.breakdown.tool),
    emptyJug: obj(DATA.bowl.emptyJug),
    bowlWines: DATA.bowl.wines.map((wine) => ({ ...wine, id: obj(wine.obj) })),
    zealot: ALTARS.zealot.pieces.map(obj),
    seq: {
      bless: gameval("seq", DATA.altar.seq),
      breakdown: gameval("seq", DATA.breakdown.seq),
      fill: gameval("seq", DATA.bowl.fill.seq),
      sacrifice: gameval("seq", DATA.bowl.sacrifice.seq),
    },
    charge: gameval("varbit", DATA.bowl.chargeVarbit),
    wineType: gameval("varbit", DATA.bowl.wineVarbit),
  };
  return ids;
}

/** A data message with its {placeholders} filled. */
const text = (key, values = {}) => DATA.messages[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));

/** A message box over the chatbox, its line in the chat log too (<br> is only for the box). */
function messageBox(player, message, owner = undefined) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getPacketSender().sendTypedMessage(DATA.mesboxChatType, message.replace(/<br>/g, " "));
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, message)), owner);
}

/** An item box (objectbox) showing `itemId`, its line logged as a message box's is. */
function itemBox(player, itemId, message, owner = undefined) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getPacketSender().sendTypedMessage(DATA.mesboxChatType, message.replace(/<br>/g, " "));
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, message)), owner);
}

function spam(player, message) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, message);
}

const prayerLevel = (player) => player.getSkillManager().getMaxLevel(core.Skill.PRAYER);

function zealotPieces(player) {
  const worn = new Set(player.getEquipment().getItems().map((item) => item?.getId?.() ?? -1));
  return resolved().zealot.filter((id) => worn.has(id)).length;
}

module.exports = {
  DATA,
  ZEALOT_CHANCE_PER_PIECE: ALTARS.zealot.chancePerPiece,
  init,
  api: () => api,
  core: () => core,
  resolved,
  text,
  messageBox,
  itemBox,
  spam,
  prayerLevel,
  zealotPieces,
};
