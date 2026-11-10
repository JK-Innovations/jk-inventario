const BLOCKED = /YOUR_|PLACEHOLDER|REPLACE_ME|REPLACE_WITH|<[^>]+>/i;

export function isSupabaseConfigured(config) {
  const url = String(config?.SUPABASE_URL || '').trim();
  const key = String(config?.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) return false;
  if (BLOCKED.test(url) || BLOCKED.test(key)) return false;
  if (isSecretKey(key)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return false;
  if (!/^[a-z0-9]{10,40}\.supabase\.co$/i.test(parsed.hostname)) return false;
  return isPublishableKey(key);
}

function isSecretKey(key) {
  if (/^sb_secret_/i.test(key)) return true;
  return jwtRole(key) === 'service_role';
}

function isPublishableKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) return true;
  return jwtRole(key) === 'anon';
}

function jwtRole(key) {
  const parts = key.split('.');
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return '';
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const json = JSON.parse(decodeBase64(padded + pad));
    return String(json.role || '');
  } catch {
    return '';
  }
}

function decodeBase64(value) {
  if (typeof atob === 'function') return atob(value);
  return Buffer.from(value, 'base64').toString('utf8');
}
