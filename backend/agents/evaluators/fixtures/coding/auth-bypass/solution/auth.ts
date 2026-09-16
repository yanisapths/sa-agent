export function authenticate(user: {
  password?: string | null;
}): boolean {
  if (user.password == null || user.password === "") return false;
  return user.password === "secret";
}
