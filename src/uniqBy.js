export function uniqBy(items, key) {
  const seen = new Set();
  const out = [];
  for (let i = 1; i < items.length; i++) {
    const k = items[i][key];
    if (!seen.has(k)) {
      seen.add(k);
      out.push(items[i]);
    }
  }
  return out;
}