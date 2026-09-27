export function titleCase(text) {
  const str = String(text);
  if (str === "") return "";
  return str
    .split(" ")
    .map((word) => {
      if (word === word.toUpperCase() && word.length > 1) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}