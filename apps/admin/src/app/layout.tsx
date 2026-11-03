import type { Metadata } from 'next';
import { BRAND } from '@comercio/business';
import { Providers } from './providers';
import { AdminShell } from '@/components/admin-shell';
import '@comercio/ui/styles';
import './office-style.css';

export const metadata: Metadata = {
  title: `${BRAND.nombreCorto} · Admin`,
  description: 'Panel de administración',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <Providers>
          <AdminShell>{children}</AdminShell>
        </Providers>
      </body>
    </html>
  );
}
