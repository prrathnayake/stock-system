const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /\d/;
const SYMBOL_REGEX = /[^A-Za-z0-9]/;

export const passwordRequirementsMessage = 'Password must be at least 10 characters long and include uppercase, lowercase, number and symbol characters.';

export function isStrongPassword(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 10) return false;
  return (
    UPPERCASE_REGEX.test(value) &&
    LOWERCASE_REGEX.test(value) &&
    NUMBER_REGEX.test(value) &&
    SYMBOL_REGEX.test(value)
  );
}

export function assertStrongPassword(value, ctx) {
  if (!isStrongPassword(value)) {
    ctx.addIssue({
      code: 'custom',
      message: passwordRequirementsMessage
    });
  }
}

export function createPasswordSchema(zod) {
  return zod.string()
    .min(10, 'Password must be at least 10 characters long')
    .superRefine((value, ctx) => {
      assertStrongPassword(value, ctx);
    });
}
