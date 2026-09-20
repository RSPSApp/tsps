import {
    RUST_RENDERER_ABI_VERSION,
    flattenDrawRanges,
    packedVertexWords,
    unsignedIndices,
} from "../render/rust/RendererPacket";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

assert(RUST_RENDERER_ABI_VERSION === 1, "unexpected Rust renderer ABI version");

const bytes = new Uint8Array(24);
const view = new DataView(bytes.buffer);
view.setUint32(0, 0x81010370, true);
view.setUint32(4, 0x091a4020, true);
view.setUint32(8, 0x8201ffee, true);
view.setUint32(12, 0x81010370, true);
view.setUint32(16, 0xaf1a4020, true);
view.setUint32(20, 0x8201ffee, true);

const words = packedVertexWords(bytes);
assert(words.length === 6, "packed vertex view should expose three u32 words per vertex");
assert(words[0] === 0x81010370, "v0 bit layout drifted");
assert(words[1] === 0x091a4020, "untextured v1 bit layout drifted");
assert(words[4] === 0xaf1a4020, "textured v1 bit layout drifted");

const ranges = flattenDrawRanges([
    [0, 6, 1],
    [24, 12, 2],
]);
assert(
    Array.from(ranges).join(",") === "0,6,1,24,12,2",
    "draw-range packet layout drifted",
);

const signed = new Int32Array([0, 1, 0x7fffffff]);
const unsigned = unsignedIndices(signed);
assert(unsigned[0] === 0 && unsigned[1] === 1 && unsigned[2] === 0x7fffffff, "index bits changed");

let invalidVertexRejected = false;
try {
    packedVertexWords(new Uint8Array(13));
} catch {
    invalidVertexRejected = true;
}
assert(invalidVertexRejected, "invalid packed vertex length must be rejected");

let invalidRangeRejected = false;
try {
    flattenDrawRanges([[0, -1, 1]]);
} catch {
    invalidRangeRejected = true;
}
assert(invalidRangeRejected, "negative draw-range values must be rejected");

console.log("Rust renderer packet contract: OK");
