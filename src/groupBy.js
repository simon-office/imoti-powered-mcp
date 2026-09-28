export function groupBy(items, key) {
  const groups = {};
  for (let i = 0; i < items.length; i++) {
    const k = items[i][key];
    (groups[k] = groups[k] || []).push(items[i]);
  }
  return groups;
}