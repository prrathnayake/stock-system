export function normalizePhone(value) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  if (typeof value !== 'string') {
    return normalizePhone(String(value));
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let digits = trimmed.replace(/[^\d+]/g, '');

  if (!digits) {
    return null;
  }

  const lastPlusIndex = digits.lastIndexOf('+');
  if (lastPlusIndex > 0) {
    digits = digits.slice(lastPlusIndex);
  }

  if (digits === '+') {
    return null;
  }

  return digits.length ? digits : null;
}
