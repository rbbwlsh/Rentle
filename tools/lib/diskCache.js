// A JSON dict cache on disk: load once, mutate in memory, save atomically.
// Only writes when something actually changed (the `dirty` flag), and writes
// via tmp+rename so a crash mid-save can't corrupt the cache.
import fs from 'node:fs';
import path from 'node:path';

export class DiskCache {
  constructor(cachePath) {
    this.cachePath = cachePath;
    this.dirty = false;
    this.data = {};
    if (cachePath && fs.existsSync(cachePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      } catch {
        this.data = {};
      }
    }
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.dirty = true;
  }

  save() {
    if (!this.cachePath || !this.dirty) return;
    fs.mkdirSync(path.dirname(path.resolve(this.cachePath)), { recursive: true });
    const tmp = `${this.cachePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.cachePath);
    this.dirty = false;
  }
}
