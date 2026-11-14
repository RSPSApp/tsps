import assert from "node:assert/strict";

import { isValidChatChar, parseOutgoingPublicChat, sanitizeChatText } from "../common/chat/chatFormatting";
import { ClientBinaryEncoder } from "../network/packet/ClientBinaryEncoder";
import { decodeClientPacket } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/** Public chat's colour and effect ("red:wave:") reach the server with the text. */
const encoder = new ClientBinaryEncoder();
const send = (typed: string) => {
    const formatting = parseOutgoingPublicChat(typed);
    return decodeClientPacket(Buffer.from(encoder.encodeChat(formatting.text, "public", false, formatting)));
};

const plain = send("hello") as any;
assert.equal(plain.text, "hello");
assert.equal(plain.style, undefined, "no style without a prefix");

const styled = send("red:wave:hello") as any;
assert.equal(styled.text, "hello");
assert.deepEqual(styled.style, { colour: 1, effect: 1, pattern: undefined });

// Chat accepts CP-1252's printable upper half (160-255), and it reaches the server unchanged.
const latin1 = Array.from({ length: 96 }, (_, i) => String.fromCharCode(160 + i)).join("");
for (const char of latin1) assert.equal(isValidChatChar(char), true, `U+${char.charCodeAt(0).toString(16)}`);
const accented = "¿Qué tal, señor Müller? ¡Ça coûte £5 à Århus!";
assert.equal(sanitizeChatText(accented), accented);
const typed = "a" + latin1 + "z";
assert.equal(sanitizeChatText(typed), typed);
const received = send("red:wave:" + sanitizeChatText(typed)) as any;
assert.equal(received.text, typed);
assert.deepEqual(received.style, { colour: 1, effect: 1, pattern: undefined });
assert.equal(send(accented).text, accented);
// Control characters (C0, DEL, C1) and characters outside one byte stay out.
assert.equal(sanitizeChatText("A\u0000\n\u007f\u0080\u009fB"), "AB");
for (const char of ["\u20ac", "\u0152", "\u0100", "\u4e2d", "\ud83d\ude00", ""])
    assert.equal(isValidChatChar(char), false, JSON.stringify(char));
console.log("Chat style tests passed");
