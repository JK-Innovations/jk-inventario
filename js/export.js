function cell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows) {
  const list = rows || [];
  const columns = list.length ? Object.keys(list[0]) : [];
  const lines = [
    columns.join(','),
    ...list.map((row) => columns.map((key) => cell(row[key])).join(','))
  ];
  return `\uFEFF${lines.join('\n')}`;
}

export function toJson(rows) {
  return JSON.stringify(rows || [], null, 2);
}

export function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
