import assert from "node:assert/strict";

import { parseOutgoingPublicChat } from "../common/chat/chatFormatting";

const plain = parseOutgoingPublicChat("Hello Mixed Case");
assert.deepEqual(plain, { text: "Hello Mixed Case", colorId: 0, effectId: 0, pattern: undefined });

const colourAndEffect = parseOutgoingPublicChat("ReD:WaVe:Hello Mixed Case");
assert.deepEqual(colourAndEffect, { text: "Hello Mixed Case", colorId: 1, effectId: 1, pattern: undefined });

const effect = parseOutgoingPublicChat("WaVe:Hello Mixed Case");
assert.deepEqual(effect, { text: "Hello Mixed Case", colorId: 0, effectId: 1, pattern: undefined });

const pattern = parseOutgoingPublicChat("PaTtErN1a:WaVe:Hello Mixed Case");
assert.deepEqual(pattern, { text: "Hello Mixed Case", colorId: 14, effectId: 1, pattern: new Uint8Array([1, 10]) });

// The documented grammar allows one colour OR pattern; the remainder stays text.
const colourThenPattern = parseOutgoingPublicChat("ReD:PaTtErN1:Hello Mixed Case");
assert.deepEqual(colourThenPattern, { text: "PaTtErN1:Hello Mixed Case", colorId: 1, effectId: 0, pattern: undefined });

const yellowThenPattern = parseOutgoingPublicChat("yellow:pattern1:Hello");
assert.deepEqual(yellowThenPattern, { text: "pattern1:Hello", colorId: 0, effectId: 0, pattern: undefined });

const patternThenColour = parseOutgoingPublicChat("PaTtErN1:ReD:Hello Mixed Case");
assert.deepEqual(patternThenColour, { text: "ReD:Hello Mixed Case", colorId: 13, effectId: 0, pattern: new Uint8Array([1]) });
