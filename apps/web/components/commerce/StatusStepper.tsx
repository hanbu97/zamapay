import { CheckIcon, LoaderCircleIcon } from 'lucide-react'
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
} from '@/components/reui/stepper'
import { cn } from '@/lib/utils'

export type StatusStepperState = 'active' | 'complete' | 'loading' | 'pending'

export type StatusStepperItem = {
  description: string
  meta?: string
  state: StatusStepperState
  title: string
}

type StatusStepperProps = {
  ariaLabel: string
  className?: string
  detailMode?: 'active' | 'all'
  orientation?: 'horizontal' | 'vertical'
  steps: StatusStepperItem[]
}

export function StatusStepper({
  ariaLabel,
  className,
  detailMode = 'all',
  orientation = 'vertical',
  steps,
}: StatusStepperProps) {
  const activeStep = getActiveStep(steps)
  const activeItem = steps[activeStep - 1]

  if (orientation === 'horizontal') {
    return (
      <Stepper
        aria-label={ariaLabel}
        className={className}
        indicators={{
          completed: <CheckIcon className="size-3.5" />,
          loading: <LoaderCircleIcon className="size-3.5 animate-spin" />,
        }}
        orientation="horizontal"
        role="group"
        value={activeStep}
      >
        <StepperNav
          className="!grid w-full min-w-0 gap-2"
          role="list"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {steps.map((step, index) => {
            const number = index + 1
            const completed = step.state === 'complete'
            const loading = step.state === 'loading'

            return (
              <StepperItem
                key={`${number}-${step.title}`}
                className="relative min-w-0 !flex-none !flex-col justify-start gap-2"
                completed={completed}
                loading={loading}
                role="listitem"
                step={number}
              >
                {number > 1 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute right-1/2 top-3 h-px w-full bg-border',
                      number <= activeStep && 'bg-primary',
                    )}
                  />
                ) : null}
                <StepperIndicator className="z-10 ring-4 ring-background">{number}</StepperIndicator>
                <StepperTitle className="max-w-full truncate text-center text-[11px] leading-tight text-muted-foreground data-[state=active]:text-foreground data-[state=completed]:text-foreground sm:text-sm">
                  {step.title}
                </StepperTitle>
              </StepperItem>
            )
          })}
        </StepperNav>

        {activeItem && detailMode === 'active' ? (
          <div className="mt-4 rounded-[8px] border bg-background/70 p-4">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h3 className="truncate text-sm font-medium">{activeItem.title}</h3>
              {activeItem.meta ? <span className="text-xs text-muted-foreground">{activeItem.meta}</span> : null}
            </div>
            <p className={cn('mt-1 text-sm text-muted-foreground', activeItem.state === 'active' && 'text-foreground')}>
              {activeItem.description}
            </p>
          </div>
        ) : null}
      </Stepper>
    )
  }

  return (
    <Stepper
      aria-label={ariaLabel}
      className={className}
      indicators={{
        completed: <CheckIcon className="size-3.5" />,
        loading: <LoaderCircleIcon className="size-3.5 animate-spin" />,
      }}
      orientation="vertical"
      role="group"
      value={activeStep}
    >
      <StepperNav className="mermer-step-list w-full" role="list">
        {steps.map((step, index) => {
          const number = index + 1
          const completed = step.state === 'complete'
          const loading = step.state === 'loading'

          return (
            <StepperItem
              key={`${number}-${step.title}`}
              className="items-start justify-start not-last:flex-none"
              completed={completed}
              loading={loading}
              role="listitem"
              step={number}
            >
              <div className="mermer-step-row flex w-full items-start rounded-md">
                <StepperIndicator className="mt-0.5">{number}</StepperIndicator>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <StepperTitle>{step.title}</StepperTitle>
                    {step.meta ? <span className="text-xs text-muted-foreground">{step.meta}</span> : null}
                  </div>
                  {detailMode === 'all' || number === activeStep ? (
                    <StepperDescription className={cn(step.state === 'active' && 'text-foreground')}>
                      {step.description}
                    </StepperDescription>
                  ) : null}
                </div>
              </div>
              {number < steps.length ? <StepperSeparator className="ml-3" /> : null}
            </StepperItem>
          )
        })}
      </StepperNav>
    </Stepper>
  )
}

function getActiveStep(steps: StatusStepperItem[]) {
  const activeIndex = steps.findIndex((step) => step.state === 'active' || step.state === 'loading')

  if (activeIndex >= 0) {
    return activeIndex + 1
  }

  const pendingIndex = steps.findIndex((step) => step.state === 'pending')

  if (pendingIndex >= 0) {
    return pendingIndex + 1
  }

  return Math.max(steps.length, 1)
}
