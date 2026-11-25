#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
let root = process.env.TSPS_ROOT || __dirname;
while (!fs.existsSync(path.join(root,'client/package.json')) || !fs.existsSync(path.join(root,'server/package.json'))) {
    const parent=path.dirname(root);if(parent===root)throw new Error('Place Creator inside TSPS, or set TSPS_ROOT.');root=parent;
}
const cli = require.resolve('tsx/cli', { paths: [path.join(root, 'client')] });
const child = spawn(process.execPath, [cli, path.join(__dirname, 'server.ts'), ...process.argv.slice(2)], { stdio: 'inherit', cwd: root, env: {...process.env,TSPS_ROOT:root} });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 0; });
