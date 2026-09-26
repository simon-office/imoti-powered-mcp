// Split a list into consecutive chunks of `size` items; the last chunk may be shorter.
export function chunk(items, size) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  const out = [];
  for (let i = 0; i + size <= items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}