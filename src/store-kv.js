import { sniffImageType } from './assets.js';

const PREFIX = 'resp:';

// Cloudflare Workers KV store. One key per response ("resp:<token>") so
// independent submits never contend. Aggregates (summary/results) do a
// prefixed list + parallel reads — fine for a poll with dozens of entries.
//
// Note: KV list is eventually consistent (changes can take up to ~60s to
// propagate globally), so a fresh vote may briefly not appear in the tally.
export class KvStore {
  constructor(kv) {
    this.kv = kv;
  }

  async get(token) {
    return this.kv.get(PREFIX + token, 'json');
  }

  async set(token, entry) {
    await this.kv.put(PREFIX + token, JSON.stringify(entry));
  }

  async delete(token) {
    await this.kv.delete(PREFIX + token);
  }

  async list() {
    const out = [];
    let cursor;
    do {
      const page = await this.kv.list({ prefix: PREFIX, cursor });
      const values = await Promise.all(
        page.keys.map((k) => this.kv.get(k.name, 'json')),
      );
      for (const v of values) if (v) out.push(v);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
  }

  // Cheap-ish count (lists keys only, no value reads).
  async count() {
    let n = 0;
    let cursor;
    do {
      const page = await this.kv.list({ prefix: PREFIX, cursor });
      n += page.keys.length;
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return n;
  }

  // Binary asset (e.g. `asset:left`). Uploaded with `wrangler kv key put`.
  async getAsset(key) {
    const { value, metadata } = await this.kv.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!value) return null;
    const contentType =
      (metadata && metadata.contentType) || sniffImageType(value);
    return { body: value, contentType };
  }
}
