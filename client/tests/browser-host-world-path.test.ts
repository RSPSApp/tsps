import assert from "node:assert/strict";

import { parseWorldIdFromPath } from "../config/clientEnv";

// Production: the client is mounted at /play, so PUBLIC_URL is "/play".
assert.equal(parseWorldIdFromPath("/play/browser-zqnoxb", "/play"), "browser-zqnoxb");
assert.equal(parseWorldIdFromPath("/play/world-1", "/play/"), "world-1");
assert.equal(parseWorldIdFromPath("/play/browser-x/extra", "/play"), "browser-x");
assert.equal(parseWorldIdFromPath("/play", "/play"), undefined);
assert.equal(parseWorldIdFromPath("/", "/play"), undefined);

// Development: craco forces PUBLIC_URL to "/" but host links still carry /play.
assert.equal(parseWorldIdFromPath("/play/browser-zqnoxb", "/"), "browser-zqnoxb");
assert.equal(parseWorldIdFromPath("/play", "/"), undefined);
assert.equal(parseWorldIdFromPath("/browser-zqnoxb", "/"), "browser-zqnoxb");
assert.equal(parseWorldIdFromPath("/", "/"), undefined);

// The logout/refresh path must not be mistaken for a world id.
assert.equal(parseWorldIdFromPath("/play/bad world", "/play"), undefined);
assert.equal(parseWorldIdFromPath("", "/play"), undefined);

console.log("browser-host-world-path ok");
