/** 任务界面的 Multica 控件；通过现有 DSH 字典接收产品文字。 */
import { useState, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Calendar, MoreHorizontal, X } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import { zhCN, enUS } from 'react-day-picker/locale'
import { Button as OriginalButton } from './button.tsx'
import { Popover, PopoverTrigger, PopoverContent } from './popover.tsx'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from './select.tsx'
import { usePortalContainer } from './portal.tsx'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './dropdown-menu.tsx'
import type { T } from '../text.ts'

export function Button({ variant = 'ghost', size = 'md', icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost'; size?: 'md' | 'sm'; icon?: ReactNode
}) {
  return <OriginalButton type="button" variant={variant === 'primary' ? 'default' : variant} size={size === 'sm' ? 'xs' : 'sm'} {...props}>{icon}{children}</OriginalButton>
}
export function Choice<V extends string>({ label, value, options, onChange, disabled, className }: {
  label: string; value: V; options: { value: V; label: string; icon?: ReactNode }[]; onChange: (value: V) => void; disabled?: boolean; className?: string
}) {
  return <Select items={options} value={value} onValueChange={next => { if (next !== null) onChange(next) }} disabled={disabled}>
    <SelectTrigger aria-label={label} size="sm" className={className}><SelectValue/></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem value={option.value} key={option.value}>{option.icon}{option.label}</SelectItem>)}</SelectContent>
  </Select>
}
export function Menu({ label, icon, children, compact = false }: { label: string; icon: ReactNode; children: ReactNode; compact?: boolean }) {
  return <Popover><PopoverTrigger render={<OriginalButton variant={compact ? 'ghost' : 'outline'} size={compact ? 'icon-xs' : 'sm'} aria-label={label}/>}>{icon}{!compact && label}</PopoverTrigger>
    <PopoverContent align="end" className="st-menu-content max-h-[min(480px,var(--available-height))] w-72 overflow-y-auto">{children}</PopoverContent>
  </Popover>
}
export function ColumnMenu({ label, onHide, disabled, t }: { label: string; onHide: () => void; disabled: boolean; t: T }) {
  return <DropdownMenu><DropdownMenuTrigger render={<OriginalButton variant="ghost" size="icon-xs" aria-label={label} className="rounded-full text-muted-foreground"/>}><MoreHorizontal className="size-3.5"/></DropdownMenuTrigger>
    <DropdownMenuContent align="end"><DropdownMenuItem disabled={disabled} onClick={onHide}>{t('task.hideColumn')}</DropdownMenuItem></DropdownMenuContent>
  </DropdownMenu>
}
export function Modal({ title, children, onClose, closeLabel, className = '', disabled = false }: {
  title: string; children: ReactNode; onClose: () => void; closeLabel: string; className?: string; disabled?: boolean
}) {
  const container = usePortalContainer()
  return <Dialog.Root open onOpenChange={open => { if (!open && !disabled) onClose() }}>
    <Dialog.Portal container={container}>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 backdrop-blur-xs duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"/>
      <Dialog.Popup className={`st-modal duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-surface-raised text-body text-popover-foreground shadow-[var(--floating-shadow)] ring-1 ring-surface-border outline-none ${className}`}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4"><Dialog.Title className="min-w-0 flex-1 text-body font-medium">{title}</Dialog.Title>
          <OriginalButton variant="ghost" size="icon-sm" aria-label={closeLabel} disabled={disabled} onClick={onClose}><X className="size-4"/></OriginalButton></div>
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}
export function DatePicker({ value, onChange, t, disabled = false }: { value: string | null; onChange: (value: string | null) => void; t: T; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const selected = value ? new Date(`${value}T12:00:00`) : undefined
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger disabled={disabled} render={<OriginalButton variant="ghost" size="sm" aria-label={t('task.dueDate')}/>}><Calendar className="size-3.5"/>{selected ? selected.toLocaleDateString(t('lang') === 'en' ? 'en' : 'zh-CN', { month: 'short', day: 'numeric' }) : t('task.noDueDate')}</PopoverTrigger>
    <PopoverContent className="w-auto p-2" align="start"><DayPicker mode="single" selected={selected} defaultMonth={selected} locale={t('lang') === 'en' ? enUS : zhCN}
      onSelect={day => { onChange(day ? `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}` : null); setOpen(false) }}
      classNames={{root:'st-calendar', months:'relative', month_caption:'flex h-9 items-center justify-center text-body font-medium',nav:'absolute inset-x-0 top-0 flex justify-between',button_previous:'st-calendar-nav',button_next:'st-calendar-nav',month_grid:'w-full border-collapse',weekdays:'text-caption text-muted-foreground',weekday:'h-8 w-8 text-center font-normal',day:'size-8 text-center',day_button:'st-calendar-day',selected:'st-calendar-selected',today:'font-semibold',outside:'text-faint-foreground',chevron:'size-4 fill-current'}}/>
      <Button onClick={() => { onChange(null); setOpen(false) }}>{t('task.clearDate')}</Button>
    </PopoverContent>
  </Popover>
}
