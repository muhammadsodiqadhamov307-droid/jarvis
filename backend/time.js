const DEFAULT_TIMEZONE = 'Asia/Tashkent';

export function getUserTimeZone() {
  return process.env.USER_TIMEZONE || process.env.TZ || DEFAULT_TIMEZONE;
}

export function formatUserDateTime(date = new Date()) {
  const timeZone = getUserTimeZone();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });

  return formatter.format(date);
}

export function getUserTimeContext(date = new Date()) {
  const timeZone = getUserTimeZone();
  return {
    timeZone,
    dateTime: formatUserDateTime(date)
  };
}
