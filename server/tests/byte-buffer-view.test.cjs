const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ByteBuffer } = require("../dist/game/cache/codec/rs/io/ByteBuffer");

test("unsigned read works with a zero-offset input", () => {
    const backing = new Int8Array([10, -30, 40]);
    assert.equal(backing.byteOffset, 0);
    assert.equal(backing.byteLength, 3);
    const buffer = new ByteBuffer(backing);
    buffer.offset = 1;
    const bytes = buffer.readUnsignedBytes(2);
    assert.deepEqual(Array.from(bytes), [226, 40]);
    assert.equal(buffer.offset, 3);
    assert.equal(buffer.remaining, 0);
    assert.equal(bytes.buffer, backing.buffer);
    bytes[0] = 31;
    assert.equal(backing[1], 31);
});

for (const kind of ["signed", "unsigned"]) {
    test(`unsigned read respects a ${kind} subview`, () => {
        const backing = new Uint8Array([10, 20, 226, 40, 50]);
        const input = kind === "signed"
            ? new Int8Array(backing.buffer, 1, 3)
            : backing.subarray(1, 4);
        assert.equal(input.byteOffset, backing.byteOffset + 1);
        assert.equal(input.byteLength, 3);
        const buffer = new ByteBuffer(input);
        assert.equal(buffer.data.byteOffset, input.byteOffset);
        assert.equal(buffer.data.byteLength, input.byteLength);
        assert.equal(buffer.data.buffer, backing.buffer);
        buffer.offset = 1;
        const bytes = buffer.readUnsignedBytes(2);
        assert.deepEqual(Array.from(bytes), [226, 40]);
        assert.equal(buffer.offset, 3);
        assert.equal(buffer.remaining, 0);
        assert.equal(bytes.buffer, backing.buffer);
        bytes[0] = 31;
        assert.equal(backing[2], 31);
    });
}
