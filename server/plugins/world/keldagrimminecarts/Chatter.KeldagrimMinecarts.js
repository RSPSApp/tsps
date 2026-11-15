/**
 * Keldagrim Carts' station: the ticket vendors' overhead calls (the Cart conductor transcript's
 * "overhead-dialogue-keldagrim-ticket-vendor": "Tickets! Tickets!", "Buy your tickets here!",
 * "Selling tickets!").
 *
 * Recorded (rsprox_transcripts/232/00423.txt, 233/03250.txt, 241/900116.txt, 241/911637.txt,
 * 242/911712.txt and others): both vendors (dwarf_city_train_conductor4) call on the same ticks,
 * every 43 ticks of the world clock (map_clock mod 43 is 0 on every call in the rev 241-242
 * recordings), each picking one of the three at random.
 *
 * Not built: the announcer (dwarf_city_train_conductor2) and his "... carts departing from Track
 * N!" / "Mind the cart!" calls. The recordings show them at irregular times (232/00423.txt ticks
 * 412, 482 and 587) with no clock or cart event they follow, so there is no source for when he
 * speaks.
 */
const Common = require("./Common.KeldagrimMinecarts");
const TRANSCRIPTS = require("../../../data/definitions/npc-dialogues.json");

const VENDOR_EVERY = 43;
const VENDOR_VARIANT = "overhead-dialogue-keldagrim-ticket-vendor";

let lines = [];
let vendors = [];

/** The transcript's random overhead lines for `variant`. */
function transcriptLines(variant) {
  const steps = TRANSCRIPTS["Cart conductor"]?.variants?.[variant] ?? [];
  const random = steps.find((step) => step.type === "random");
  const all = random ? random.options.flatMap((option) => option.steps) : steps;
  return all.filter((step) => typeof step.npc === "string").map((step) => step.npc);
}

/** The registered vendors, looked up again once one of them is gone. */
function currentVendors() {
  if (vendors.length && vendors.every((npc) => npc.isRegistered?.())) return vendors;
  const id = Common.ids.npcs.vendor;
  vendors = [];
  Common.core.World.getNpcs().forEach((npc) => {
    if (npc?.getId?.() === id && npc.isRegistered?.()) vendors.push(npc);
  });
  return vendors;
}

/** One call from every vendor, on the world clock's 43-tick beat. */
function call(cycle = Common.core.World.getProcessCycle()) {
  if (cycle % VENDOR_EVERY !== 0 || !lines.length) return false;
  for (const npc of currentVendors()) npc.forceChat(lines[Math.floor(Math.random() * lines.length)]);
  return true;
}

function start() {
  lines = transcriptLines(VENDOR_VARIANT);
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, null, false); }
    execute() { call(); }
  })());
}

function attach(api) {
  api.onServerStartup(start);
}

module.exports = { attach, call, transcriptLines, VENDOR_EVERY, get lines() { return lines; }, start };
