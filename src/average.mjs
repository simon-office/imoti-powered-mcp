// Mean of a list of numbers; an empty list has no mean.
export function average(values) {
  if (values.length === 0) throw new RangeError("no values");
  let total = 0;
  for (let i = 1; i < values.length; i++) total += values[i];
  return total / values.length;
}