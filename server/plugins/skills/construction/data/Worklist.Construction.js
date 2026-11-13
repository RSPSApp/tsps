"use strict";

// Wiki homeowner transcripts use tiered request names, not the loc's generic display
// name ("Shelves", "Drawers"). Jeff's Beginner sequence is also captured in1863.
// Duplicate pieces are requested together (Bob's bookcases/cabinets, Jess's drawers,
// Tau's shelves/tables, Leela's small tables). Singular remaining counts use the
// same vocabulary; the exact partial-completion phrasing is a template inference.
module.exports = {
  woods: ["Wooden", "Oak", "Teak", "Mahogany"],
  furniture: {
    bookcase: ["bookcase", "bookcases"], cabinet: ["cabinet", "cabinets"],
    chair: ["chair", "chairs"], cupboard: ["cupboard", "cupboards"],
    diningtable: ["table", "tables"], doublebed: ["bed", "beds"],
    drawers: ["drawer", "drawers"], dresser: ["dresser", "dressers"],
    longtable: ["table", "tables"], shelves: ["shelf", "shelves"],
    sidetable: ["small table", "small tables"], singlebed: ["bed", "beds"],
    table: ["table", "tables"], wardrobe: ["wardrobe", "wardrobes"],
  },
  repairs: { clock: "clock", hatstand: "hat stand", mirror: "mirror", sink: "sink", range: "range", bath: "bath" },
};
