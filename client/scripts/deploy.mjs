import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "basic-ftp";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const client = new Client();

async function buildFiles(directory, prefix = "") {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = path.posix.join(prefix, entry.name);
        const local = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await buildFiles(local, relative));
        else if (entry.isFile() && !entry.name.endsWith(".map")) files.push({ relative, local, size: (await stat(local)).size });
        else if (entry.isFile()) continue;
        else throw new Error(`Unsupported build entry: ${relative}`);
    }
    return files;
}

try {
    // Leave app settings to CRA so .env.production takes precedence over .env.
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path.join(root, ".env"), "utf8")))) {
        if (key.startsWith("FTP_")) process.env[key] ??= value;
    }
    for (const key of ["FTP_HOST", "FTP_USER", "FTP_PASSWORD", "FTP_REMOTE_DIR"]) {
        if (!process.env[key]?.trim()) throw new Error(`Missing ${key} in .env`);
    }
    const port = Number(process.env.FTP_PORT || 21);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid FTP_PORT");
    const remote = process.env.FTP_REMOTE_DIR;
    if (!remote.startsWith("/") || remote === "/" || remote.split("/").includes("..")) {
        throw new Error("FTP_REMOTE_DIR must be an absolute, non-root directory");
    }
    if (process.argv.slice(2).some(arg => arg !== "--dry-run")) throw new Error("Usage: yarn deploy [--dry-run]");

    console.log("Building production client…");
    // Use the client package’s pinned Yarn version and existing production build.
    const build = spawnSync("corepack", ["yarn", "run", "build"], { stdio: "inherit" });
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`Build failed (${build.status ?? build.signal})`);

    const files = await buildFiles(path.join(root, "build"));
    if (!files.some(file => file.relative === "index.html")) throw new Error("Build is missing index.html");
    // Publish the entry point only after every asset it references has arrived.
    files.sort((a, b) => Number(a.relative === "index.html") - Number(b.relative === "index.html"));
    const total = files.reduce((sum, file) => sum + file.size, 0);
    console.log(`${files.length} files (${(total / 1024 / 1024).toFixed(1)} MiB) → ${process.env.FTP_HOST}${remote}`);
    if (!process.argv.includes("--dry-run")) {
        await client.access({
            host: process.env.FTP_HOST,
            port,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: true, // Explicit FTPS on port 21, with certificate validation.
            secureOptions: { servername: process.env.FTP_TLS_SERVERNAME || process.env.FTP_HOST },
        });
        let lastPercent = -1;
        client.trackProgress(({ bytesOverall }) => {
            const percent = Math.min(100, Math.floor(bytesOverall / total * 100));
            if (percent === lastPercent) return;
            lastPercent = percent;
            const filled = Math.floor(percent / 4);
            const bar = `[${"=".repeat(filled)}${" ".repeat(25 - filled)}] ${percent}%`;
            process.stdout.write(process.stdout.isTTY ? `\r${bar}` : `${bar}\n`);
        });
        for (const file of files) {
            await client.ensureDir(path.posix.join(remote, path.posix.dirname(file.relative)));
            const name = path.posix.basename(file.relative);
            if (file.relative === "index.html") {
                await client.uploadFrom(file.local, "index.html.uploading");
                await client.rename("index.html.uploading", name);
            } else {
                await client.uploadFrom(file.local, name);
            }
        }
        console.log("\nDeployment complete.");
    } else {
        console.log("Dry run complete; no files uploaded.");
    }
} catch (error) {
    // Never echo credentials if a remote server includes them in an error response.
    const message = String(error.message).split(process.env.FTP_PASSWORD || "\0").join("[redacted]");
    console.error(`\nDeployment failed: ${message}`);
    process.exitCode = 1;
} finally {
    client.close();
}
