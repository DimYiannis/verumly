import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Button } from './Button.vue'

export const buttonVariants = cva(
  'rounded-md border border-transparent bg-clip-padding text-sm font-medium focus-visible:border-primary focus-visible:ring-ring focus-visible:ring-[3px] aria-invalid:border-danger aria-invalid:ring-danger-border [&_svg:not([class*=size-])]:size-4 inline-flex shrink-0 items-center justify-center whitespace-nowrap outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 duration-150 ease-[var(--ease-brand)]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-brand-900',
        outline: 'border-border bg-card text-foreground hover:bg-muted',
        secondary: 'border-border bg-card text-foreground hover:bg-muted',
        ghost: 'hover:bg-muted hover:text-foreground',
        destructive: 'bg-danger-soft text-danger border-danger-border hover:bg-danger-soft',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        'default': 'h-9 gap-1.5 px-[14px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        'xs': 'h-9 gap-1 px-[14px] text-sm',
        'sm': 'h-9 gap-1.5 px-[14px] text-sm',
        'lg': 'h-11 gap-1.5 px-5 text-base',
        'icon': 'size-9',
        'icon-xs': 'size-9',
        'icon-sm': 'size-9',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>
