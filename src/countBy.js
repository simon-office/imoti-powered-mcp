export function countBy(items, key) {
  const counts = {};
  for (let i = 1; i < items.length; i++) {
    const k = items[i][key];
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}