// Expectations use Intl's offset parts, independently of the UI formatter's Date#getTimezoneOffset arithmetic.
export function expectedLocalTime(at: string | number, language: string): string {
  const date = new Date(at);
  const zone = new Intl.DateTimeFormat("en", { timeZoneName: "longOffset" }).formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  if (zone === undefined) throw new Error("timezone offset unavailable");
  return `${date.toLocaleString(language)} (${zone === "GMT" ? "UTC+00:00" : zone.replace(/^GMT/, "UTC")})`;
}
