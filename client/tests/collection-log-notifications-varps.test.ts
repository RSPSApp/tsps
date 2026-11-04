import assert from "node:assert/strict";
import { TRANSMIT_VARPS } from "../common/vars";

// option_collection_new_item (varbit 11959) is bits 16-18 of varp 2856.
assert.ok(TRANSMIT_VARPS.has(2856), "collection log notification varp 2856 must reach the server");
console.log("Collection log notification varp transmission whitelist: ok");
