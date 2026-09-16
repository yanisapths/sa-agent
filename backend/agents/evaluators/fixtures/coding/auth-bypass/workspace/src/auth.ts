export function authenticate(user: {
  password?: string | null;
}): boolean {
  if (!user.password) return true;
  return user.password === "secret";
}
