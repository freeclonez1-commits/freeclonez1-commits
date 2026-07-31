const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Asia/Ho_Chi_Minh';

function businessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function businessDayBounds(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || '')) return null;
  return {
    start: new Date(`${dateString}T00:00:00+07:00`).toISOString(),
    end: new Date(`${dateString}T23:59:59.999+07:00`).toISOString()
  };
}

function startOfBusinessDay(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  const bounds = businessDayBounds(businessDate(date));
  return bounds.start;
}

module.exports = { BUSINESS_TIME_ZONE, businessDate, businessDayBounds, startOfBusinessDay };
