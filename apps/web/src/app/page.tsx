import { redirect } from 'next/navigation';

/**
 * La home del e-commerce manda directo al catálogo.
 * El cliente entra y ve los productos, sin pasos intermedios.
 */
export default function HomePage() {
  redirect('/catalogo');
}
