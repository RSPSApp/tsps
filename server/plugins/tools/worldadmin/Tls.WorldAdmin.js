const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const tls = require("tls");

// https for the world config page (spec "Access"): WORLD_ADMIN_TLS_CERT and WORLD_ADMIN_TLS_KEY
// name PEM files, such as a Let's Encrypt fullchain.pem and privkey.pem. A host whose domain sends
// HSTS can't reach the page over http on any port, so a page opened beyond this machine needs it.
// Renewed files are picked up without a restart.

const RELOAD_CHECK_MS = 60 * 1000;

/** The certificate and key files from the environment, or null when neither is set. */
function tlsFiles(env) {
  const certFile = env.WORLD_ADMIN_TLS_CERT ? String(env.WORLD_ADMIN_TLS_CERT) : "";
  const keyFile = env.WORLD_ADMIN_TLS_KEY ? String(env.WORLD_ADMIN_TLS_KEY) : "";
  return certFile || keyFile ? { certFile, keyFile } : null;
}

/** Reads and checks the pair; throws a message naming what is wrong. */
function readPair({ certFile, keyFile }) {
  if (!certFile || !keyFile) throw new Error("WORLD_ADMIN_TLS_CERT and WORLD_ADMIN_TLS_KEY must both be set");
  const read = (file, name) => {
    try {
      return fs.readFileSync(file);
    } catch (err) {
      throw new Error(`could not read ${name} ${file} (${err.message})`);
    }
  };
  const pair = { cert: read(certFile, "WORLD_ADMIN_TLS_CERT"), key: read(keyFile, "WORLD_ADMIN_TLS_KEY") };
  try {
    tls.createSecureContext(pair);
  } catch (err) {
    throw new Error(`the TLS certificate and key can't be used together (${err.message})`);
  }
  return pair;
}

/** The first DNS name the certificate is for, to print the page's link; null when it names none. */
function certificateHost(cert) {
  try {
    const names = new crypto.X509Certificate(cert).subjectAltName ?? "";
    return /DNS:([^,\s]+)/.exec(names)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The page's server: https when `files` is set, else http. With unusable TLS files it returns
 * `{ error }` and the caller doesn't listen, rather than sending the token in the clear.
 */
function createPageServer(files, handler) {
  if (!files) return { server: http.createServer(handler), secure: false, host: "localhost" };
  let pair;
  try {
    pair = readPair(files);
  } catch (err) {
    return { error: `not listening: ${err.message}` };
  }
  const server = https.createServer(pair, handler);
  return { server, secure: true, host: certificateHost(pair.cert) ?? "localhost" };
}

/** Loads the files again into `server`; keeps the current certificate when they can't be used. */
function reloadCertificate(server, files) {
  try {
    server.setSecureContext(readPair(files));
    console.info("[world-admin] TLS certificate reloaded");
    return true;
  } catch (err) {
    console.error(`[world-admin] keeping the current TLS certificate: ${err.message}`);
    return false;
  }
}

/** Reloads when either file changes (certbot renews every 60 to 90 days). Returns the stop function. */
function watchCertificate(server, files, interval = RELOAD_CHECK_MS) {
  const onChange = (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs || current.ino !== previous.ino) reloadCertificate(server, files);
  };
  for (const file of [files.certFile, files.keyFile]) {
    fs.watchFile(file, { interval, persistent: false }, onChange);
  }
  return () => {
    for (const file of [files.certFile, files.keyFile]) fs.unwatchFile(file, onChange);
  };
}

module.exports = { tlsFiles, createPageServer, reloadCertificate, watchCertificate };
