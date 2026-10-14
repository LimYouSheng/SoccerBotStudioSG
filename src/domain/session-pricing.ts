import { isDate } from "./dates";

// MOM gazetted calendars, including the announced substitute public holidays.
// https://www.mom.gov.sg/newsroom/press-releases/2025/0616-public-holidays-for-2026
// https://www.mom.gov.sg/newsroom/press-releases/2026/0618-public-holidays-for-2027
const holidays: Readonly<Record<string, readonly string[]>> = {
  "2026": [
    "01-01",
    "02-17",
    "02-18",
    "03-21",
    "04-03",
    "05-01",
    "05-27",
    "05-31",
    "06-01",
    "08-09",
    "08-10",
    "11-08",
    "11-09",
    "12-25",
  ],
  "2027": [
    "01-01",
    "02-06",
    "02-07",
    "02-08",
    "03-10",
    "03-26",
    "05-01",
    "05-17",
    "05-20",
    "08-09",
    "10-28",
    "12-25",
  ],
};
export function sessionRate(date: string) {
  if (!isDate(date) || !holidays[date.slice(0, 4)]) return null;
  const holiday = holidays[date.slice(0, 4)].includes(date.slice(5));
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const premium = holiday || weekday === 0 || weekday === 6;
  return { priceMinor: premium ? 10800 : 8800, premium, holiday };
}
