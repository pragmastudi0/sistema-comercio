// Sheet básico — versión simple sin radix por ahora. Se reemplazará por shadcn cuando
// agreguemos las dependencias de @radix-ui/* en el día 2-3.
import { useEffect, type ReactNode } from 'react';
import { cn } from '../lib/utils';

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'right' | 'left';
  children: ReactNode;
  className?: string;
};

export function Sheet({ open, onOpenChange, side = 'right', children, className }: SheetProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'absolute top-0 h-full w-full max-w-md overflow-y-auto bg-background p-4 shadow-lg sm:p-6',
          side === 'right' ? 'right-0' : 'left-0',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4 space-y-1">{children}</div>;
}

export function SheetTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold">{children}</h2>;
}

export function SheetDescription({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
