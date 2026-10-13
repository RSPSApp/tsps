import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { GamevalKind, Gamevals } from "../src/main/typescript/elvarg/game/cache/Gamevals";

const [kindArg, queryArg] = process.argv.slice(2);
const kinds: Record<string, GamevalKind> = {
  varp: GamevalKind.VARP,
  varbit: GamevalKind.VARBIT,
  npc: GamevalKind.NPC,
  obj: GamevalKind.OBJ,
  loc: GamevalKind.LOC,
  seq: GamevalKind.SEQ,
  spotanim: GamevalKind.SPOTANIM,
};
const kind = kinds[(kindArg ?? "varp").toLowerCase()] ?? GamevalKind.VARP;
const query = (queryArg ?? "").toLowerCase();

async function main() {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const gamevals = new Gamevals();
  for (const [id, name] of gamevals.namesOf(kind)) {
    if (query && !name.toLowerCase().includes(query)) continue;
    if (kind === GamevalKind.VARBIT) {
      const bit = CacheDefinitions.getVarbit(id);
      console.log(id, name, bit ? `varp=${bit.baseVar} bits=${bit.startBit}-${bit.endBit}` : "?");
    } else {
      console.log(id, name);
    }
  }
}

main();
