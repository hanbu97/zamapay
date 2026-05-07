import { AlertTriangleIcon, CheckCircle2Icon, Clock3Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

const positiveStatuses = new Set([
  'paid',
  'finality_safe',
  'fulfilled',
  'ready',
  'released',
  'delivered',
  'completed',
])
const dangerStatuses = new Set([
  'failed',
  'expired',
  'failed_timeout',
  'failed_replay_guard',
  'reorg_exception',
  'release_failed',
  'frozen_for_manual_intervention',
  'dead_letter',
])

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase()
  const Icon = dangerStatuses.has(normalized)
    ? AlertTriangleIcon
    : positiveStatuses.has(normalized)
      ? CheckCircle2Icon
      : Clock3Icon

  if (dangerStatuses.has(normalized)) {
    return (
      <Badge variant="destructive">
        <Icon data-icon="inline-start" />
        {formatStatus(value)}
      </Badge>
    )
  }

  if (positiveStatuses.has(normalized)) {
    return (
      <Badge variant="default">
        <Icon data-icon="inline-start" />
        {formatStatus(value)}
      </Badge>
    )
  }

  return (
    <Badge variant="secondary">
      <Icon data-icon="inline-start" />
      {formatStatus(value)}
    </Badge>
  )
}

function formatStatus(value: string): string {
  return value.replaceAll('_', ' ')
}
