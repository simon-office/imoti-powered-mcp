/** Removes recognizable contact details while leaving numeric listing facts intact. */
export function redactContactText(value: string): string {
  return value
    .replace(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    .replace(/(?<!\w)@[\w-]+(?:\.[\w-]+)*/g, '[redacted]')
    .replace(/((?:контакт(?:но лице)?|лице за контакт|contact)\s*[:—-]\s*)[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,2}/giu, '$1[redacted]')
    .replace(/(?<!\w)\+?\d[\d\s()./-]{5,}\d(?!\w)/g, (candidate, offset: number, source: string) => {
      const after = source.slice(offset + candidate.length);
      const before = source.slice(Math.max(0, offset - 24), offset);
      const digits = candidate.replace(/\D/g, '');
      if (/^\s*(?:€|лв\.?|eur\b|bgn\b|кв\.?\s*м|m²|г\.)/i.test(after) || /\d\s*[-–]\s*$/.test(before)) return candidate;
      if (digits.length >= 7 && (/^0/.test(digits) || candidate.includes('/') || candidate.includes('(') || candidate.includes('-') || /(?:тел|phone)\s*[:.]?\s*$/i.test(before))) return '[redacted]';
      return candidate;
    });
}
