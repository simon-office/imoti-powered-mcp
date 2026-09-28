export function keyBy(items, key) {
  const out = {};
  for (let i = 1; i < items.length; i++) {
    const k = items[i][key];
    if (!(k in out)) {
      out[k] = items[i];
    }
  }
  return out;
}