export function formatMerchantTimestamp(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'unknown'
  }

  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
  }).format(date)

  return `${day}, ${formatClock(date)}`
}

function formatClock(date: Date) {
  const hour = date.getHours()
  const minute = date.getMinutes()
  const suffix = hour < 12 ? 'am' : 'pm'

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`
}
