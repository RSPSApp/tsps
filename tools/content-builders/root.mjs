import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function findRoot(from = import.meta.url) {
    if (process.env.TSPS_ROOT)
        return path.resolve(process.env.TSPS_ROOT);
    let at = path.dirname(from.startsWith('file:') ? fileURLToPath(from) : from);
    while (true) {
        if (fs.existsSync(path.join(at, 'client/package.json')) && fs.existsSync(path.join(at, 'server/package.json')))
            return at;
        const parent = path.dirname(at);
        if (parent === at)
            throw new Error('Place Creator inside a TSPS checkout, or set TSPS_ROOT.');
        at = parent;
    }
}
