'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogIn, Sparkles } from 'lucide-react';
import { BRAND } from '@comercio/business';
import { PRESET_IDS, createSupabaseRaw } from '@comercio/db';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Input } from '@comercio/ui/input';
import { PasswordInput } from '@comercio/ui/password-input';
import { Label } from '@comercio/ui/label';
import { Button } from '@comercio/ui/button';

// Si la app no tiene env vars de Supabase configuradas, el dbClient cae al
// mock con seed en memoria. Lo usamos para detectar "modo demo" y mostrar
// las credenciales en pantalla, así el visitante entra de un click.
const ES_DEMO = !process.env.NEXT_PUBLIC_SUPABASE_URL;

const CREDENCIALES_DEMO = [
  { rol: 'Admin (acceso total)', email: 'admin@demo.com', password: 'admin123' },
  { rol: 'Encargado', email: 'encargado@demo.com', password: 'encargado123' },
  { rol: 'Cajero', email: 'cajero@demo.com', password: 'cajero123' },
];

export default function LoginPage() {
  const db = getDb();
  const router = useRouter();
  const setEmpleado = useSesion((s) => s.setEmpleado);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginMut = useMutation({
    mutationFn: async () => {
      const emp = await db.empleados.autenticar(email.trim(), password);
      if (!emp) throw new Error('Email o contraseña incorrectos');
      // Detectar cajero ANTES de aceptar el login. Si pasamos al shell,
      // el guard del admin-shell lo deslogueaba pero ya se había mostrado
      // el toast "Bienvenido". Acá lo cortamos limpio: signOut + tirar
      // error claro. Solo aparece UN toast.
      if (emp.rol_id === PRESET_IDS.roles.cajero) {
        // SignOut en background (sin await) para no bloquear el throw.
        // Si esperamos al signOut y la red está lenta, el botón queda
        // "Verificando..." indefinido. El error se muestra al toque.
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (url && key) {
          createSupabaseRaw(url, key).auth.signOut().catch(() => {});
        }
        throw new Error(
          'Como cajero tenés que usar el sistema de caja (PoS), no el panel admin.',
        );
      }
      return emp;
    },
    onSuccess: (emp) => {
      setEmpleado(emp);
      toast.success(`Bienvenido ${emp.nombre}`);
      router.push('/');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">{BRAND.nombreCorto}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Panel de administración</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5" />
            Iniciar sesión
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loginMut.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="email" className="mb-1 block">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@turisteando.local"
                required
              />
            </div>
            <div>
              <Label htmlFor="password" className="mb-1 block">
                Contraseña
              </Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loginMut.isPending}>
              {loginMut.isPending ? 'Verificando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Solo personal autorizado. Si olvidaste tu contraseña, hablalo con el dueño.
      </p>

      {ES_DEMO && (
        <Card className="mt-6 border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              Modo demo · entrá con un click
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="text-muted-foreground">
              Esta instancia tiene datos de prueba. No hay nada real adentro,
              podés tocar todo.
            </p>
            {CREDENCIALES_DEMO.map((c) => (
              <button
                key={c.email}
                type="button"
                onClick={() => {
                  setEmail(c.email);
                  setPassword(c.password);
                }}
                className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left transition hover:border-foreground/30"
              >
                <span>
                  <span className="font-medium">{c.rol}</span>
                  <br />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {c.email} · {c.password}
                  </span>
                </span>
                <span className="text-xs text-primary">Usar →</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
