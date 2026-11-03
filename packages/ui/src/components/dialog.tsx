// Dialog básico — se reemplazará por shadcn/radix cuando integremos sus deps.
import { useEffect, type ReactNode } from 'react';
import { cn } from '../lib/utils';

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
};

export function Dialog({ open, onOpenChange, children, className }: DialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-4 shadow-lg sm:p-6',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4 space-y-1">{children}</div>;
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-base font-semibold sm:text-lg">{children}</h2>;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>
  );
}
