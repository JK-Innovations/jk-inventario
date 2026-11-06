export function activeClients(clients) {
  return (clients || []).filter((client) => client.active !== false);
}

export function filterClients(clients, query) {
  const q = String(query || '').trim().toLowerCase();
  const list = activeClients(clients).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  if (!q) return list;
  return list.filter((client) => [client.name, client.phone, client.email].join(' ').toLowerCase().includes(q));
}

export function exactClient(clients, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  return activeClients(clients).find((client) => String(client.name).trim().toLowerCase() === q) || null;
}
