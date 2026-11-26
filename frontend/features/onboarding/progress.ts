const FIRST_MESSAGE_KEY = "sa-first-message";

export function hasSentFirstMessage(): boolean {
  try {
    return window.localStorage.getItem(FIRST_MESSAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Set on the first successful turn; read by the Get started checklist. */
export function markFirstMessage(): void {
  try {
    window.localStorage.setItem(FIRST_MESSAGE_KEY, "1");
  } catch {
    // Storage disabled: the checklist step stays open.
  }
}
