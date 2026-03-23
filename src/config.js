import fs from 'fs';
import path from 'path';
import TOML from '@iarna/toml';

const CONFIG_PATH = path.resolve(process.cwd(), 'config.toml');
const EXAMPLE_PATH = path.resolve(process.cwd(), 'config.example.toml');

function flatten(obj, prefix = '') {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flatten(v, key));
    } else {
      result[key] = v;
    }
  }
  return result;
}

export function loadConfig() {
  let raw;
  if (fs.existsSync(CONFIG_PATH)) {
    raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  } else if (fs.existsSync(EXAMPLE_PATH)) {
    raw = fs.readFileSync(EXAMPLE_PATH, 'utf-8');
  } else {
    throw new Error('No config.toml or config.example.toml found');
  }
  const parsed = TOML.parse(raw);
  const flat = flatten(parsed);
  return { nested: parsed, flat };
}
