export const PASSWORD_MIN_LENGTH = 8

export function validatePasswordChange(password: string, confirmation: string) {
  if (password.length < PASSWORD_MIN_LENGTH) return `Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków.`
  if (password !== confirmation) return 'Hasła nie są takie same.'
  return null
}
