export function groupBy(items, key) {
  if (!Array.isArray(items)) {
    throw new TypeError("Expected array");
  }
  const result = {};
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const groupKey = item[key];
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
  }
  return result;
}