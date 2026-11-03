#!/usr/bin/env bash
# Deploya los 3 proyectos demo en Vercel (admin, pos, web) sin tocar
# el repo ni los proyectos turisteando-* existentes.
#
# Estrategia segura:
#   1. Crea un vercel.json LOCAL temporal en cada app con los install/build
#      commands para monorepo pnpm.
#   2. Linkea + deploya (Vercel respeta ese vercel.json).
#   3. Borra el vercel.json antes de terminar (trap garantiza cleanup).
#
# Los proyectos turisteando-* NO se ven afectados porque sus deploys
# se disparan vía git push, no leen archivos locales sin commitear.
#
# Uso:  bash scripts/deploy-demo.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v vercel >/dev/null 2>&1; then
  echo "❌ Vercel CLI no instalado. pnpm i -g vercel"
  exit 1
fi

echo "→ Chequeando sesión de Vercel…"
if ! vercel whoami >/dev/null 2>&1; then
  echo "❌ No estás logueado. Corré: vercel login"
  exit 1
fi
echo "   Logueado como: $(vercel whoami)"

# Cleanup global: borra vercel.json temporales y restaura el original del PoS.
declare -a TMP_FILES=()
declare -A BACKUPS=()
cleanup() {
  set +e
  # Restaurar backups primero.
  for original in "${!BACKUPS[@]}"; do
    local bak="${BACKUPS[$original]}"
    [ -f "$bak" ] && mv "$bak" "$original"
  done
  # Borrar archivos temporales que no tenían original.
  for f in "${TMP_FILES[@]}"; do
    [ -f "$f" ] && rm -f "$f"
  done
}
trap cleanup EXIT INT TERM

# Genera un vercel.json valido como JSON, sin claves "vacías" colgando.
# Args:  archivo_destino  pkg_nombre  framework  output_dir  rewrite_spa(0|1)
write_vercel_json() {
  local dest="$1"
  local pkg="$2"
  local framework="$3"
  local output_dir="$4"
  local spa_rewrite="$5"

  # Construyo el JSON línea a línea juntando array de strings.
  local lines=()
  lines+=('{')
  lines+=('  "$schema": "https://openapi.vercel.sh/vercel.json",')
  lines+=("  \"framework\": \"${framework}\",")
  lines+=("  \"installCommand\": \"cd ../.. && pnpm install --no-frozen-lockfile\",")
  lines+=("  \"buildCommand\": \"cd ../.. && pnpm --filter ${pkg} build\"")

  if [ -n "$output_dir" ]; then
    # Mover la última línea para agregar coma y agregar outputDirectory.
    local last_idx=$(( ${#lines[@]} - 1 ))
    lines[$last_idx]="${lines[$last_idx]},"
    lines+=("  \"outputDirectory\": \"${output_dir}\"")
  fi

  if [ "$spa_rewrite" = "1" ]; then
    local last_idx=$(( ${#lines[@]} - 1 ))
    lines[$last_idx]="${lines[$last_idx]},"
    lines+=('  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]')
  fi

  lines+=('}')

  printf '%s\n' "${lines[@]}" > "$dest"

  # Validar JSON con python (viene en macOS).
  if ! python3 -c "import json,sys; json.load(open('$dest'))" 2>/dev/null; then
    echo "❌ JSON inválido en $dest"
    cat "$dest"
    return 1
  fi
}

deploy_app() {
  local nombre="$1"        # nombre del proyecto Vercel
  local app="$2"           # apps/X
  local pkg="$3"           # @comercio/X
  local env_var="$4"       # NEXT_PUBLIC_BRAND_NAME o VITE_BRAND_NAME
  local framework="$5"     # nextjs | vite
  local output_dir="$6"    # "" o "dist"
  local spa_rewrite="$7"   # "0" o "1"

  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Deploy: $nombre"
  echo "  Carpeta: $app · Framework: $framework"
  echo "═══════════════════════════════════════════════════════════"

  local app_dir="$REPO_ROOT/$app"
  local vjson="$app_dir/vercel.json"

  # Backup del vercel.json original si existe (PoS lo tiene committed).
  if [ -f "$vjson" ]; then
    local bak="${vjson}.bak.$$"
    cp "$vjson" "$bak"
    BACKUPS["$vjson"]="$bak"
    echo "   ↳ Backup del vercel.json existente"
  else
    TMP_FILES+=("$vjson")
  fi

  # Generar vercel.json válido y verificado.
  write_vercel_json "$vjson" "$pkg" "$framework" "$output_dir" "$spa_rewrite"
  echo "   ↳ vercel.json temporal generado:"
  sed 's/^/      /' "$vjson"

  cd "$app_dir"

  # Linkear al proyecto (lo crea si no existe).
  vercel link --project "$nombre" --yes

  # Setear env var de branding.
  echo "Comercio Demo" | vercel env add "$env_var" production 2>/dev/null || \
    echo "   (env $env_var production ya existía)"
  echo "Comercio Demo" | vercel env add "$env_var" preview 2>/dev/null || \
    echo "   (env $env_var preview ya existía)"

  # Deploy a producción.
  vercel --prod --yes

  cd "$REPO_ROOT"
}

deploy_app "comercio-demo-admin" "apps/admin" "@comercio/admin" "NEXT_PUBLIC_BRAND_NAME" "nextjs" ""     "0"
deploy_app "comercio-demo-pos"   "apps/pos"   "@comercio/pos"   "VITE_BRAND_NAME"        "vite"   "dist" "1"
deploy_app "comercio-demo-web"   "apps/web"   "@comercio/web"   "NEXT_PUBLIC_BRAND_NAME" "nextjs" ""     "0"

echo ""
echo "✅ Listo. Buscá los URLs de producción que imprimió cada deploy más arriba"
echo "   (o entrá a https://vercel.com/dashboard)."
echo ""
echo "Convención esperada:"
echo "   Admin: https://comercio-demo-admin.vercel.app"
echo "   PoS:   https://comercio-demo-pos.vercel.app"
echo "   Web:   https://comercio-demo-web.vercel.app"
