import fs from 'node:fs';
import path from 'node:path';
import { sniffImageType } from './assets.js';

// Flat-file store used by `npm start` (local dev / self-hosting).
// Same data.json shape as before: { responses: { "<token>": { ranking, updatedAt } } }.
// A promise chain serializes writes so concurrent submits don't clobber each other.
// `assetsDir` (optional) is where invite photos live locally — files named
// left.<ext> / right.<ext> map to the `asset:left` / `asset:right` keys.
export class FileStore {
  constructor(file, { assetsDir } = {}) {
    this.file = file;
    this.assetsDir = assetsDir || null;
    this._queue = Promise.resolve();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { responses: {} };
    }
  }

  _save(data) {
    this._queue = this._queue.then(() =>
      fs.promises.writeFile(this.file, JSON.stringify(data, null, 2)),
    );
    return this._queue;
  }

  async get(token) {
    return this._load().responses[token] || null;
  }

  async set(token, entry) {
    const data = this._load();
    data.responses[token] = entry;
    await this._save(data);
  }

  async delete(token) {
    const data = this._load();
    if (data.responses[token]) {
      delete data.responses[token];
      await this._save(data);
    }
  }

  async list() {
    return Object.values(this._load().responses);
  }

  async count() {
    return Object.keys(this._load().responses).length;
  }

  async getAsset(key) {
    if (!this.assetsDir) return null;
    const name = key.replace(/^asset:/, '');
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
      try {
        const body = fs.readFileSync(path.join(this.assetsDir, `${name}.${ext}`));
        return { body, contentType: sniffImageType(body) };
      } catch {
        /* try next extension */
      }
    }
    return null;
  }
}
