// Uploads a built directory over FTPS: node ftp-upload.mjs <local dir> <remote dir>
// Runs in the deploy job, which holds the FTP secrets and runs no other repo code.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Client } from "basic-ftp";

const [local, remote, mode] = process.argv.slice(2);
const client = new Client(180_000);

async function buildFiles(directory, prefix = "") {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = path.posix.join(prefix, entry.name);
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await buildFiles(file, relative));
        else if (entry.isFile() && !entry.name.endsWith(".map")) files.push({ relative, local: file, size: (await stat(file)).size });
        else if (entry.isFile()) continue;
        else throw new Error(`Unsupported build entry: ${relative}`);
    }
    return files;
}

async function publishFiles(client, files, remote) {
    for (const file of files) {
        if (!file.size) throw new Error(`Refusing empty file: ${file.relative}`);
        await client.ensureDir(path.posix.join(remote, path.posix.dirname(file.relative)));
        const temporary = `${path.posix.basename(file.relative)}.uploading`;
        await client.uploadFrom(file.local, temporary);
        if (await client.size(temporary) !== file.size) throw new Error(`Incomplete upload: ${file.relative}`);
    }
    for (const file of files) {
        await client.cd(path.posix.join(remote, path.posix.dirname(file.relative)));
        const name = path.posix.basename(file.relative);
        await client.rename(`${name}.uploading`, name);
    }
}

try {
    for (const key of ["FTP_HOST", "FTP_USER", "FTP_PASSWORD"]) {
        if (!process.env[key]?.trim()) throw new Error(`Missing ${key}`);
    }
    if (!local || !remote?.startsWith("/") || remote === "/" || remote.split("/").includes("..") || (mode && mode !== "--release-marker")) {
        throw new Error("Usage: ftp-upload.mjs <local dir> <absolute, non-root remote dir>");
    }
    const port = Number(process.env.FTP_PORT || 21);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid FTP_PORT");

    let files;
    if (mode === "--release-marker") {
        const candidate = path.join(local, "browser-host/release-candidate.json");
        const contents = await readFile(candidate, "utf8");
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(JSON.parse(contents).id)) throw new Error("Invalid release candidate");
        files = [{ relative: "browser-host/release.json", local: candidate, size: Buffer.byteLength(contents) }];
    } else {
        files = await buildFiles(local);
        if (!files.some(file => file.relative === "index.html")) throw new Error("Build is missing index.html");
        files = files.filter(file => file.relative !== "browser-host/release.json");
    }
    // Publish the entry point only after every asset it references has arrived.
    files.sort((a, b) => Number(a.relative === "index.html") - Number(b.relative === "index.html"));
    const total = files.reduce((sum, file) => sum + file.size, 0);
    console.log(`${files.length} files (${(total / 1024 / 1024).toFixed(1)} MiB) → ${remote}`);

    await client.access({
        host: process.env.FTP_HOST,
        port,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASSWORD,
        secure: true, // Explicit FTPS, with certificate validation.
        secureOptions: { servername: process.env.FTP_TLS_SERVERNAME || process.env.FTP_HOST },
    });
    await publishFiles(client, files, remote);
    console.log("Deployment complete.");
} catch (error) {
    // Never echo credentials if a remote server includes them in an error response.
    const message = String(error.message).split(process.env.FTP_PASSWORD || "\0").join("[redacted]");
    console.error(`Deployment failed: ${message}`);
    process.exitCode = 1;
} finally {
    client.close();
}
