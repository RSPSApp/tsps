import assert from "node:assert/strict";

import { Archive } from "../rs/cache/Archive";
import { ByteBuffer } from "../rs/io/ByteBuffer";

function packedArchive(chunks: number[][][], ids = [2, 10, 500]): { archive: Archive; data: Int8Array } {
    const bytes = chunks.flat(2);
    const buffer = new ByteBuffer(bytes.length + chunks.length * ids.length * 4 + 1);
    buffer.writeBytes(new Int8Array(bytes));
    for (const chunk of chunks) {
        let previousSize = 0;
        for (const file of chunk) {
            buffer.writeInt(file.length - previousSize);
            previousSize = file.length;
        }
    }
    buffer.data[buffer.offset++] = chunks.length;
    buffer.offset = 0;
    return {
        archive: Archive.decode(7, ids.at(-1)!, ids.length, new Int32Array(ids), undefined!, buffer),
        data: buffer.data,
    };
}

const { archive, data } = packedArchive([[[1, 2], [], [3]]]);
assert.equal((archive as any)._files.size, 0, "Decoding must not create every file eagerly");
assert.equal(archive.getFile(9), undefined, "Sparse IDs must not resolve to another file");
const last = archive.getFile(500)!;
assert.deepEqual(Array.from(last.data), [3]);
assert.equal(last.data.buffer, data.buffer, "A contiguous file must share its archive buffer");
assert.equal(archive.getFile(500), last, "Repeated reads must reuse the file object");
assert.equal((archive as any)._files.size, 1, "Only requested files should be materialized");
assert.deepEqual(archive.files.map((file) => [file.id, Array.from(file.data)]), [
    [2, [1, 2]], [10, []], [500, [3]],
], "Enumeration must include every file in ID order, regardless of previous reads");
assert.equal(archive.getFile(-1), undefined);
assert.equal(archive.getFile(501), undefined);

const split = packedArchive([[[1, 2], [3], []], [[4], [5, 6], [7]]]);
assert.deepEqual(split.archive.files.map((file) => Array.from(file.data)), [
    [1, 2, 4], [3, 5, 6], [7],
], "Multi-chunk files must still concatenate their fragments");

const malformed = new ByteBuffer(9);
malformed.writeInt(1);
malformed.writeInt(0);
malformed.data[malformed.offset++] = 1;
malformed.offset = 0;
assert.throws(() => Archive.decode(1, 1, 2, new Int32Array([0, 1]), undefined!, malformed), /Invalid file size/);

console.log("Archive memory regression passed");
