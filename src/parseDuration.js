export function parseDuration(text) {
  if (text === "") {
    throw new RangeError("Empty duration string");
  }

  const trimmed = text.trim();
  if (trimmed === "") {
    throw new RangeError("Empty duration string");
  }

  const regex = /(\d+)([hms])/g;
  let totalSeconds = 0;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(trimmed)) !== null) {
    if (match.index !== lastIndex && lastIndex !== 0) {
      const invalidPart = trimmed.slice(lastIndex, match.index).trim();
      if (invalidPart) {
        throw new RangeError(`Invalid duration part: ${invalidPart}`);
      }
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case "h":
        totalSeconds += value * 3600;
        break;
      case "m":
        totalSeconds += value * 60;
        break;
      case "s":
        totalSeconds += value;
        break;
      default:
        throw new RangeError(`Unknown unit: ${unit}`);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex !== trimmed.length) {
    const remaining = trimmed.slice(lastIndex).trim();
    if (remaining) {
      throw new RangeError(`Invalid duration part: ${remaining}`);
    }
  }

  if (totalSeconds === 0 && !/^0+[hms]/.test(trimmed)) {
    throw new RangeError(`Invalid duration string: ${text}`);
  }

  return totalSeconds;
}