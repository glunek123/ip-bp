// Keep creation and login feedback aligned with the server's username boundary.
export function isValidUsername(value: string): boolean {
  const forbidden = /[\p{Cc}\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
  if (forbidden.test(value)) return false;
  const normalized = value.trim().normalize('NFKC').toLowerCase();
  const length = Array.from(normalized).length;
  return length >= 3 && length <= 64 && !forbidden.test(normalized);
}
