import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Badge } from './Badge.vue'

export const badgeVariants = cva(
  'h-5 gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground border-transparent',
        secondary: 'bg-muted border-border text-text-secondary',
        destructive: 'bg-danger-soft border-danger-border text-danger',
        outline: 'border-border text-foreground',
        ghost: 'border-transparent hover:bg-muted',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
        success: 'bg-success-soft border-success-border text-success',
        warning: 'bg-warning-soft border-warning-border text-warning',
        danger: 'bg-danger-soft border-danger-border text-danger',
        accent: 'bg-accent border-[#A9CFC0] text-accent-foreground',
        neutral: 'bg-muted border-border text-text-secondary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
