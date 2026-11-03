// Helpers para mostrar placeholders visuales mientras no haya fotos reales.
// Cada categoría tiene un color y un set de emojis. Cada producto mapea a
// un emoji específico según palabras clave de su nombre.

export type CategoriaVisual = {
  bg: string; // clase Tailwind para el fondo
  emojis: string[]; // emojis representativos para mostrar en la card
  emojiPrincipal: string;
};

export const CATEGORIA_VISUAL: Record<string, CategoriaVisual> = {
  cat_tec: {
    bg: 'bg-slate-100',
    emojiPrincipal: '🎧',
    emojis: ['🎧', '🔌', '📱', '🔋'],
  },
  cat_baz: {
    bg: 'bg-amber-50',
    emojiPrincipal: '☕',
    emojis: ['☕', '🧉', '🫖', '🥤'],
  },
  cat_bel: {
    bg: 'bg-pink-50',
    emojiPrincipal: '💄',
    emojis: ['💄', '🧴', '💅', '🧼'],
  },
  cat_jug: {
    bg: 'bg-purple-50',
    emojiPrincipal: '🎲',
    emojis: ['🎲', '🧩', '🪀', '🎴'],
  },
  cat_pap: {
    bg: 'bg-blue-50',
    emojiPrincipal: '📓',
    emojis: ['📓', '✏️', '📎', '📌'],
  },
  cat_via: {
    bg: 'bg-orange-50',
    emojiPrincipal: '🧳',
    emojis: ['🧳', '✈️', '🗺️', '🧭'],
  },
};

export function visualDeCategoria(
  categoriaId: string | null | undefined,
): CategoriaVisual {
  const fallback: CategoriaVisual = {
    bg: 'bg-muted/40',
    emojiPrincipal: '📦',
    emojis: ['📦'],
  };
  if (!categoriaId) return fallback;
  return CATEGORIA_VISUAL[categoriaId] ?? fallback;
}

/** Mapeo de palabras clave → emoji para productos individuales. */
const KEYWORD_TO_EMOJI: Array<[RegExp, string]> = [
  // Tecnología
  [/auricular|headphone/i, '🎧'],
  [/cable|usb/i, '🔌'],
  [/cargador|powerbank|power bank/i, '🔋'],
  [/soporte celular|porta celular/i, '📱'],
  [/manos libres|microf/i, '🎙️'],
  [/pendrive|memoria/i, '💾'],
  [/adaptador|otg/i, '🔄'],
  // Bazar / cocina / mate
  [/termo/i, '🫖'],
  [/mate(?!ria)/i, '🧉'],
  [/bombilla/i, '🥤'],
  [/yerba/i, '🌿'],
  [/vaso/i, '🥃'],
  [/encendedor/i, '🔥'],
  [/cuchillo/i, '🔪'],
  [/cubierto/i, '🍴'],
  [/loncher/i, '🍱'],
  // Belleza
  [/crema/i, '🧴'],
  [/balsam|labial/i, '💋'],
  [/cepillo/i, '💇'],
  [/manicura|uñ/i, '💅'],
  [/espejo/i, '🪞'],
  [/desodorante/i, '🧴'],
  [/shampoo|champ/i, '🧴'],
  [/acondicionador/i, '🧴'],
  [/toallita|toalla h[uú]meda/i, '🧻'],
  [/repelente/i, '🦟'],
  // Juguetes / juegos
  [/pelota/i, '⚽'],
  [/yo-?yo/i, '🪀'],
  [/cubo|rubik/i, '🧩'],
  [/cartas/i, '🎴'],
  // Papelería
  [/cuaderno/i, '📓'],
  [/bolígraf|biroma|biró/i, '🖊️'],
  [/lápiz|lapiz/i, '✏️'],
  [/goma|borrar/i, '🧽'],
  [/resaltador/i, '🖍️'],
  [/sobre/i, '✉️'],
  [/postal/i, '📮'],
  // Viaje
  [/almohada/i, '🛌'],
  [/antifaz|dormir/i, '😴'],
  [/tap[oó]n.*o[ií]d/i, '🔇'],
  [/manta|frazada/i, '🛏️'],
  [/candado/i, '🔒'],
];

export function emojiProducto(
  nombre: string,
  categoriaId?: string | null,
): string {
  for (const [re, emoji] of KEYWORD_TO_EMOJI) {
    if (re.test(nombre)) return emoji;
  }
  if (categoriaId) return visualDeCategoria(categoriaId).emojiPrincipal;
  return '📦';
}
