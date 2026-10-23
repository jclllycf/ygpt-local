import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { renameWithRetry } from './rename.js';
import { logger } from './logger.js';
/**
 * Single place for crash-safe file writes. Data goes to a temp file next to
 * the target and a rename swaps it in, so readers only ever see the previous
 * or the new complete file — never a truncated one.
 *
 * - The temp file's data is flushed to disk before the rename: otherwise the
 *   new name can reach the disk before the data, and a crash or power loss
 *   leaves the file empty or zero-filled (#697, #692). On macOS/Linux the
 *   folder is flushed after the rename, so the rename itself survives.
 * - Writes to the same file from this process run one after another. Temporary
 *   files use unique, exclusively created names, preserving existing siblings
 *   and never following a pre-existing temporary-path link.
 * - The swap goes through renameWithRetry, which rides out Windows' brief
 *   locks on files other processes have open.
 */
const pendingWrites = new Map();
async function writeThroughTempFile(filePath, data, options) {
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    let created = false;
    try {
        const handle = await fs.open(tempPath, 'wx', options.mode);
        created = true;
        try {
            await handle.writeFile(data, { encoding: options.encoding ?? 'utf8' });
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await options.beforeCommit?.();
        await renameWithRetry(tempPath, filePath);
    }
    finally {
        // After a successful rename the temp file is gone (ENOENT); after a failed
        // write, removing it is best effort and the write's own error is what's reported
        if (created) await fs.unlink(tempPath).catch(() => { });
    }
    await syncFolder(path.dirname(filePath));
}
/**
 * macOS/Linux: flushes the folder, so a rename in it reaches the disk. Windows
 * can't open a folder for flushing, and NTFS journals the rename itself. The
 * new content is already committed when this runs, so a failure is logged,
 * not reported as a failed write.
 */
async function syncFolder(folder) {
    if (process.platform === 'win32')
        return;
    try {
        const handle = await fs.open(folder, 'r');
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        logger.error(`Could not flush ${folder} after replacing a file in it: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Atomically replaces `filePath` with `data`. Resolves once the new content is
 * committed; rejects (leaving the previous file intact) if it can't be.
 */
export function writeFileAtomic(filePath, data, options = {}) {
    const key = path.resolve(filePath);
    const previous = pendingWrites.get(key) ?? Promise.resolve();
    // The previous write's failure was already reported to its own caller; this one runs regardless
    const write = previous.catch(() => { }).then(() => writeThroughTempFile(key, data, options));
    pendingWrites.set(key, write);
    // Bookkeeping only: the caller gets `write` itself, with its rejection
    write.finally(() => {
        if (pendingWrites.get(key) === write)
            pendingWrites.delete(key);
    }).catch(() => { });
    return write;
}
