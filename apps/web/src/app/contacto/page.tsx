'use client';

import { useQuery } from '@tanstack/react-query';
import { MapPin, Phone, Mail, Clock, MessageCircle } from 'lucide-react';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { SITE } from '@/lib/config';
import { Card, CardContent } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';

export default function ContactoPage() {
  const db = getDb();
  const configQ = useQuery({
    queryKey: ['config-contacto'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
  });
  const c = configQ.data?.comercio;

  return (
    <article className="container mx-auto max-w-3xl px-4 py-12">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Hablemos
      </div>
      <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">Contacto</h1>
      <p className="mt-2 text-muted-foreground">
        La forma más rápida de contactarnos es por WhatsApp. También podés escribirnos por
        email o pasar por el local.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {(c?.direccion || SITE.direccion) && (
          <Card>
            <CardContent className="flex items-start gap-3 pt-5">
              <MapPin className="mt-1 h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Dirección
                </div>
                <div className="font-medium">{c?.direccion || SITE.direccion}</div>
              </div>
            </CardContent>
          </Card>
        )}
        {c?.telefono && (
          <Card>
            <CardContent className="flex items-start gap-3 pt-5">
              <Phone className="mt-1 h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Teléfono
                </div>
                <div className="font-medium">{c.telefono}</div>
              </div>
            </CardContent>
          </Card>
        )}
        {(c?.email || SITE.email) && (
          <Card>
            <CardContent className="flex items-start gap-3 pt-5">
              <Mail className="mt-1 h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Email
                </div>
                <div className="font-medium">{c?.email || SITE.email}</div>
              </div>
            </CardContent>
          </Card>
        )}
        {c?.horario && (
          <Card>
            <CardContent className="flex items-start gap-3 pt-5">
              <Clock className="mt-1 h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Horario
                </div>
                <div className="font-medium">{c.horario}</div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mt-8 rounded-lg border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">¿Una consulta rápida? Escribinos al toque.</p>
        <Button asChild size="lg" className="mt-3">
          <a
            href={`https://wa.me/${SITE.whatsappNumero}?text=${encodeURIComponent(
              `Hola ${SITE.nombre}, quería hacer una consulta.`,
            )}`}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            Hablar por WhatsApp
          </a>
        </Button>
      </div>
    </article>
  );
}
