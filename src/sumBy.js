export function sumBy(items, key) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i][key];
  }
  return total;
}