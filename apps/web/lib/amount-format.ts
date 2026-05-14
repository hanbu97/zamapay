const DEFAULT_DECIMALS = 6
const DEFAULT_MAX_FRACTION_DIGITS = 6
const DEFAULT_MIN_FRACTION_DIGITS = 2
const MAX_DECIMALS = 18

type AmountUnitValue = bigint | number

type FormatUnitsOptions = {
  locale?: string
  maximumFractionDigits?: number
  minimumFractionDigits?: number
}

type FormatTokenAmountOptions = FormatUnitsOptions & {
  symbol?: string
}

export function formatMinorTokenUnits(value: AmountUnitValue, options: FormatTokenAmountOptions = {}) {
  return formatTokenUnits(value, DEFAULT_DECIMALS, {
    ...options,
    symbol: options.symbol ?? 'cUSDT',
  })
}

export function formatTokenUnits(value: AmountUnitValue, decimals: number, options: FormatTokenAmountOptions = {}) {
  const amount = formatUnits(value, decimals, options)
  return options.symbol ? `${amount} ${options.symbol}` : amount
}

export function formatUnits(value: AmountUnitValue, decimals: number, options: FormatUnitsOptions = {}) {
  const normalizedDecimals = normalizeDecimals(decimals)
  const minimumFractionDigits = clampFractionDigits(options.minimumFractionDigits ?? DEFAULT_MIN_FRACTION_DIGITS)
  const maximumFractionDigits = Math.max(
    minimumFractionDigits,
    clampFractionDigits(options.maximumFractionDigits ?? DEFAULT_MAX_FRACTION_DIGITS),
  )
  const units = toIntegerUnits(value)
  const sign = units < 0n ? '-' : ''
  const absoluteUnits = units < 0n ? -units : units
  const scale = 10n ** BigInt(normalizedDecimals)
  const whole = absoluteUnits / scale

  if (normalizedDecimals === 0 || maximumFractionDigits === 0) {
    return `${sign}${whole.toLocaleString(options.locale)}`
  }

  const fractionUnits = absoluteUnits % scale
  const fraction = fractionalDigits({
    decimals: normalizedDecimals,
    fraction: fractionUnits,
    maximumFractionDigits,
    minimumFractionDigits,
  })

  if (whole === 0n && fraction.lessThanVisibleUnit) {
    return `${sign}<0.${minimumVisibleFraction(maximumFractionDigits)}`
  }

  return `${sign}${whole.toLocaleString(options.locale)}.${fraction.text}`
}

function fractionalDigits({
  decimals,
  fraction,
  maximumFractionDigits,
  minimumFractionDigits,
}: {
  decimals: number
  fraction: bigint
  maximumFractionDigits: number
  minimumFractionDigits: number
}) {
  const raw = fraction.toString().padStart(decimals, '0')
  const visible = raw.slice(0, maximumFractionDigits)
  const hidden = raw.slice(maximumFractionDigits)
  const hasHiddenDust = hidden.split('').some((digit) => digit !== '0')

  let trimmed = visible
  while (trimmed.length > minimumFractionDigits && trimmed.endsWith('0')) {
    trimmed = trimmed.slice(0, -1)
  }

  return {
    lessThanVisibleUnit: hasHiddenDust && /^0*$/.test(visible),
    text: trimmed.padEnd(minimumFractionDigits, '0'),
  }
}

function minimumVisibleFraction(maximumFractionDigits: number) {
  return `${'0'.repeat(Math.max(maximumFractionDigits - 1, 0))}1`
}

function normalizeDecimals(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_DECIMALS) {
    return DEFAULT_DECIMALS
  }

  return value
}

function clampFractionDigits(value: number) {
  if (!Number.isInteger(value)) {
    return DEFAULT_MIN_FRACTION_DIGITS
  }

  return Math.min(Math.max(value, 0), DEFAULT_MAX_FRACTION_DIGITS)
}

function toIntegerUnits(value: AmountUnitValue) {
  if (typeof value === 'bigint') {
    return value
  }

  if (!Number.isFinite(value)) {
    return 0n
  }

  return BigInt(Math.trunc(value))
}
