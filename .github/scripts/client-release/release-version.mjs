import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function compare(a, b) {
    const left = a.split(".").map(BigInt), right = b.split(".").map(BigInt);
    for (let i = 0; i < 3; i++) {
        if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    }
    return 0;
}

export function nextClientVersion(tags, requested = "") {
    const versions = tags.filter(tag => tag.startsWith("client-v"))
        .map(tag => tag.slice("client-v".length)).filter(version => stableVersion.test(version));
    const latest = versions.sort(compare).at(-1);
    if (requested) {
        if (!stableVersion.test(requested)) throw new Error("Use a stable version such as 1.2.3");
        if (latest && compare(requested, latest) <= 0) throw new Error(`Version must be newer than ${latest}`);
        return requested;
    }
    const [major, minor, patch] = (latest ?? "0.1.0").split(".");
    return `${major}.${minor}.${BigInt(patch) + 1n}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(nextClientVersion(readFileSync(0, "utf8").split(/\r?\n/), process.env.REQUESTED_VERSION));
}
