const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export function businessDate(value = new Date()) {
  const parts = formatter.formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function businessDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return businessDate(date);
}
