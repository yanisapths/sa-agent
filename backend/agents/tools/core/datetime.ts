function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function offsetFor(date: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = name?.match(/GMT([+-])(\d+)(?::(\d+))?/i);
  if (!match) return "+00:00";
  return `${match[1]}${pad(Number(match[2]))}:${pad(Number(match[3] ?? 0))}`;
}

function localIso(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return (
    `${parts.year}-${parts.month}-${parts.day}` +
    `T${parts.hour}:${parts.minute}:${parts.second}` +
    offsetFor(date, timeZone)
  );
}

/** Wall-clock now. Year is the field models must copy into web_search queries. */
export function presentDatetime(): string {
  const now = new Date();
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
  }).format(now);
  const human = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).format(now);

  return [
    `Present datetime: ${human}`,
    `ISO 8601 UTC: ${now.toISOString()}`,
    `ISO 8601 local (${timeZone}): ${localIso(now, timeZone)}`,
    `Year: ${year}`,
    `Timezone: ${timeZone}`,
    "Use this year in any web_search for latest or current facts. Do not use a year from training data.",
  ].join("\n");
}
