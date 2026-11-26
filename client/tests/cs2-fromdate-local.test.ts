// The time zone must be set before the first Date is made.
process.env.TZ = "America/New_York";

import assert from "node:assert/strict";

// OSRS's fromdate reads the day in the player's time zone: day 0 is 27 Feb 2002 at 00:00 UTC,
// which is still the 26th in New York.
async function main() {
    const { Opcodes } = await import("../rs/cs2/Opcodes");
    const { createHandlerMap } = await import("../rs/cs2/handlers");
    const out: string[] = [];
    createHandlerMap().get(Opcodes.FROMDATE)!({ intStack: [0], intStackSize: 1, pushString: (v: string) => out.push(v) } as any, 0, null as any);
    assert.deepEqual(out, ["26-Feb-2002"]);
}
main().then(() => console.log("ok"), (error) => { console.error(error); process.exit(1); });
