const path = require("path");
const crypto = require("crypto");
const { JsonPlayerPersistence } = require("./JsonPlayerPersistence.plugin");
const { MAIN_PROFILE, profileStorageKey } = JsonPlayerPersistence.PROFILES;
const {
  HANDOFF_DIRECTORY,
  isBrowserHost,
} = require("./IndexedDbPersistenceHandoff");

// WebContainer has no native bcrypt and its node:crypto throws on scrypt/pbkdf2,
// but createHash works (ws uses it for the WebSocket handshake). So browser-host
// accounts get PBKDF2-HMAC-SHA256 built from createHash instead of plaintext.
// ponytail: 100k iterations is the tuning knob; raise it if logins stay fast.
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_BYTES = 32;

function hmacSha256(key, data) {
  const blockSize = 64;
  let normalizedKey = key;
  if (normalizedKey.length > blockSize) {
    normalizedKey = crypto.createHash("sha256").update(normalizedKey).digest();
  }
  const innerPad = Buffer.alloc(blockSize, 0x36);
  const outerPad = Buffer.alloc(blockSize, 0x5c);
  for (let i = 0; i < normalizedKey.length; i++) {
    innerPad[i] ^= normalizedKey[i];
    outerPad[i] ^= normalizedKey[i];
  }
  const inner = crypto
    .createHash("sha256")
    .update(innerPad)
    .update(data)
    .digest();
  return crypto.createHash("sha256").update(outerPad).update(inner).digest();
}

function pbkdf2Sha256(password, salt, iterations) {
  let block = hmacSha256(
    password,
    Buffer.concat([Buffer.from(salt, "utf8"), Buffer.from([0, 0, 0, 1])])
  );
  const derived = Buffer.from(block);
  for (let i = 1; i < iterations; i++) {
    block = hmacSha256(password, block);
    for (let j = 0; j < derived.length; j++) {
      derived[j] ^= block[j];
    }
  }
  return derived;
}

function constantTimeEquals(a, b) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }
  return difference === 0;
}

/**
 * WebContainer Node has no IndexedDB. HostPage hydrates and syncs this directory
 * with browser IndexedDB before, during, and after a browser-hosted world runs.
 */
class IndexedDbPlayerPersistence extends JsonPlayerPersistence {
  static HANDOFF_DIRECTORY = HANDOFF_DIRECTORY;
  static SAVE_DIRECTORY = path.join(process.cwd(), HANDOFF_DIRECTORY);

  /** One flat directory (the browser syncs it): another profile's file carries the profile prefix in its name. */
  resolveFilePath(username, profile = MAIN_PROFILE) {
    return path.join(
      IndexedDbPlayerPersistence.SAVE_DIRECTORY,
      `${profileStorageKey(this.normalizeUsername(username), profile).replace(":", "-")}.json`
    );
  }

  encryptPassword(plainPassword) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = pbkdf2Sha256(
      Buffer.from(plainPassword, "utf8"),
      salt,
      PBKDF2_ITERATIONS
    );
    return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hash.toString("hex")}`;
  }

  checkPassword(password, playerSave) {
    const stored = String(playerSave.getPasswordHashWithSalt() ?? "");
    const parts = stored.split(":");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") {
      return false;
    }
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations <= 0) {
      return false;
    }
    const expected = Buffer.from(parts[3], "hex");
    if (expected.length !== PBKDF2_KEY_BYTES) {
      return false;
    }
    const candidate = pbkdf2Sha256(
      Buffer.from(password, "utf8"),
      parts[2],
      iterations
    );
    return candidate.length === expected.length && constantTimeEquals(candidate, expected);
  }
}

module.exports = {
  name: "IndexedDbPlayerPersistence",
  description: "Stores player saves and hashed passwords in the browser's IndexedDB when the server runs inside a browser host. Does nothing elsewhere.",
  dependsOn: ["JsonPlayerPersistence"],
  register(api) {
    if (!isBrowserHost()) {
      return;
    }
    api.setPlayerPersistence(new IndexedDbPlayerPersistence());
    api.log("registered", {
      handoffDirectory: IndexedDbPlayerPersistence.HANDOFF_DIRECTORY,
    });
  },
  IndexedDbPlayerPersistence,
};
