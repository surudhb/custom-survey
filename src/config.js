// Normalises + validates a config object. `source` is either an already-parsed
// object (the bundled config.json) or a JSON string (an injected CONFIG value).
export function loadConfig(source) {
  let cfg;
  try {
    cfg = typeof source === 'string' ? JSON.parse(source) : source;
  } catch (e) {
    throw new Error(`config is not valid JSON: ${e.message}`);
  }
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('config must be an object');
  }
  if (!Array.isArray(cfg.activities) || cfg.activities.length < 2) {
    throw new Error('config.activities must be an array of at least 2 items');
  }
  return cfg;
}
