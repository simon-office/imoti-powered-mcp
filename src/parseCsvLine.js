export function parseCsvLine(line) {
  if (typeof line !== "string") {
    throw new TypeError("Argument must be a string");
  }

  const fields = [];
  let currentField = "";
  let inQuotes = false;
  let fieldStartColumn = 1;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const column = i + 1;

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          // Closing quote found
          inQuotes = false;
          // Check what comes after the closing quote
          const nextIdx = i + 1;
          if (nextIdx < line.length && line[nextIdx] !== ',') {
            throw new SyntaxError(`Unexpected character after quoted field at column ${nextIdx + 1}`);
          }
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === ',') {
        fields.push(currentField);
        currentField = "";
        fieldStartColumn = column + 1;
      } else if (char === '"') {
        if (currentField.length > 0) {
          throw new SyntaxError(`Unexpected quote at column ${column}`);
        }
        inQuotes = true;
        fieldStartColumn = column;
      } else {
        currentField += char;
      }
    }
  }

  if (inQuotes) {
    throw new SyntaxError(`Unclosed quoted field starting at column ${fieldStartColumn}`);
  }

  fields.push(currentField);

  return fields;
}