import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** Input de contraseña con botón ojito para mostrar/ocultar el valor. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [show, setShow] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={show ? 'text' : 'password'}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-10 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        <button
          type="button"
          aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          tabIndex={-1}
          onClick={() => setShow((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
