import crypto from 'node:crypto';
import { EngineError } from './file-engine.mjs';

export const identity = Object.freeze({ product: 'YGPT Local', provider: 'ygpt-local', service: 'ygpt-native-engine-phase1' });

export class YRegistry {
  constructor({ file, terminal, search }) {
    this.table = new Map([
      ['file.list', a => file.list(a.path)],
      ['file.stat', a => file.stat(a.path)],
      ['file.read', a => file.read(a.path, a.options)],
      ['file.writeAtomic', a => file.atomicWrite(a.path, a.value, a.options)],
      ['file.replaceExact', a => file.replaceExact(a.path, a.oldText, a.newText, a.options)],
      ['terminal.run', a => terminal.run(a)],
      ['search.text', a => search.findText(a.directory, a.pattern, a.options)],
    ]);
  }
  tools() { return [...this.table.keys()].map(name => ({ name, title: 'YGPT Local · ' + name })); }
  async invoke(name, args = {}) {
    const callId = crypto.randomUUID();
    const handler = this.table.get(name);
    if (!handler) return { callId, ok: false, error: { code: 'NO_TOOL', message: 'Unknown YGPT capability' } };
    try {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new EngineError('BAD_ARGS','Arguments must be an object');
      return { callId, ok: true, result: await handler(args) };
    } catch (err) {
      return { callId, ok: false, error: { code: err.code || 'EXECUTION_FAILED', message: String(err.message).slice(0,500) } };
    }
  }
}
// Retain the original registry for existing consumers; new MCP uses engine.mjs.
export {YBrowserEngine as YBrowserAdapter} from './browser-engine.mjs';
export {YDesktopEngine as YDesktopAdapter} from './desktop-engine.mjs';
