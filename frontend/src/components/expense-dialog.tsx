import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { createExpense, updateExpense } from '@/lib/api'
import { todayIso } from '@/lib/format'
import type { Category, Expense } from '@/lib/types'
import { GhostButton, PrimaryButton } from '@/components/tally'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const UNCATEGORIZED = '__none__'

const schema = z.object({
  description: z.string().trim().min(1, 'Give it a description').max(200),
  // Kept as a string: a number input yields '' when empty, and coercing that
  // to 0 would silently accept a blank amount.
  amount: z
    .string()
    .min(1, 'Enter an amount')
    .refine((value) => Number(value) > 0, 'Amount must be greater than zero')
    .refine((value) => Number(value) < 100_000_000, 'That amount is implausibly large'),
  category_id: z.string(),
  expense_date: z.string().min(1, 'Pick a date'),
  notes: z.string().max(500).optional(),
})

type FormValues = z.infer<typeof schema>

export function ExpenseDialog({
  open,
  onOpenChange,
  categories,
  expense,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Category[]
  /** Present when editing; absent when adding. */
  expense?: Expense | null
  onSaved: () => void
}) {
  const editing = Boolean(expense)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      description: '',
      amount: '',
      category_id: UNCATEGORIZED,
      expense_date: todayIso(),
      notes: '',
    },
  })

  // Reset on open so the form never shows the previous expense's values.
  React.useEffect(() => {
    if (!open) return
    form.reset({
      description: expense?.description ?? '',
      amount: expense ? String(expense.amount) : '',
      category_id: expense?.category_id ?? UNCATEGORIZED,
      expense_date: expense?.expense_date ?? todayIso(),
      notes: expense?.notes ?? '',
    })
  }, [open, expense, form])

  async function onSubmit(values: FormValues) {
    const payload = {
      description: values.description.trim(),
      amount: Number(values.amount),
      category_id: values.category_id === UNCATEGORIZED ? null : values.category_id,
      expense_date: values.expense_date,
      notes: values.notes?.trim() || null,
    }

    try {
      if (expense) {
        await updateExpense(expense.id, payload)
        toast.success('Expense updated')
      } else {
        await createExpense(payload)
        toast.success('Expense added')
      }
      onOpenChange(false)
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not save the expense')
    }
  }

  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit expense' : 'Add expense'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Change what was recorded for this expense.'
              : 'Record something you spent. You can also just tell your assistant.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              placeholder="Blue Bottle Coffee"
              autoComplete="off"
              {...form.register('description')}
            />
            {errors.description && (
              <p className="text-[12px] text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="12.00"
                className="tabular"
                {...form.register('amount')}
              />
              {errors.amount && (
                <p className="text-[12px] text-destructive">{errors.amount.message}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="expense_date">Date</Label>
              <Input id="expense_date" type="date" {...form.register('expense_date')} />
              {errors.expense_date && (
                <p className="text-[12px] text-destructive">{errors.expense_date.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="category">Category</Label>
            <Select
              value={form.watch('category_id')}
              onValueChange={(value) => form.setValue('category_id', value)}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: category.color }}
                      />
                      {category.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="notes">
              Notes <span className="font-medium text-subtle-foreground">(optional)</span>
            </Label>
            <Input id="notes" placeholder="Trip to SFO" {...form.register('notes')} />
          </div>

          <DialogFooter>
            <GhostButton onClick={() => onOpenChange(false)}>Cancel</GhostButton>
            <PrimaryButton type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}
            </PrimaryButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
