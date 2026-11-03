import type { Metadata } from 'next';
import { Providers } from './providers';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { WhatsAppFloat } from '@/components/whatsapp-float';
import { SITE } from '@/lib/config';
import '@comercio/ui/styles';

export const metadata: Metadata = {
  title: `${SITE.nombre} · Mayorista`,
  description: 'Catálogo mayorista — tecnología, bazar, belleza y artículos de viaje.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
          <WhatsAppFloat />
        </Providers>
      </body>
    </html>
  );
}
