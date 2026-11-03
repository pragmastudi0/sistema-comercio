'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, staleTime: 60_000 },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster richColors position="bottom-right" />
    </QueryClientProvider>
  );
}
