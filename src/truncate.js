export function truncate(text, max) {
  const str = String(text);
  if (str.length <= max) {
    return str;
  }
  if (max <= 1) {
    return "…";
  }
  return str.slice(0, max - 1) + "…";
}