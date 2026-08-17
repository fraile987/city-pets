#!/usr/bin/env bash
# =========================================================
# CITY PETS — Prueba integral (Fase 8)
#
# Ejecuta una suite E2E completa contra la API en :3000.
# Uso:
#   bash scripts/test-integral.sh            # usa un server ya levantado
#   bash scripts/test-integral.sh --reset    # resetea BD, levanta server, prueba y limpia
# =========================================================
set -u
cd "$(dirname "$0")/.."

B="http://localhost:3000/api"
PORT=3000
PASS=0
FAIL=0
SERVER_PID=""
RESET_MODE="0"

reset_db() {
  npx prisma migrate reset --force >/dev/null 2>&1
  npm run seed >/dev/null 2>&1
}

cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; fi
  if [ "$RESET_MODE" = "1" ]; then reset_db; fi
  echo ""
  echo "RESULTADO INTEGRAL: PASS=$PASS FAIL=$FAIL"
  [ "$FAIL" -eq 0 ]
}

if [ "${1:-}" = "--reset" ]; then
  RESET_MODE="1"
  if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
    echo "[FATAL] El puerto $PORT ya está en uso. Libera el puerto o ejecuta sin --reset."
    exit 1
  fi
  echo "== reset BD + arranque server =="
  reset_db
  node server.js > /tmp/citypets-integral-server.log 2>&1 &
  SERVER_PID=$!
  sleep 2
fi
trap cleanup EXIT

curl -s -o /dev/null "$B/health" || { echo "[FATAL] API no disponible en $B"; exit 1; }

# ---- helpers ----
ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
ko()   { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 (esperado='$3' obtenido='$2')"; fi }
# json <expresionJS> [valores...]  -> extrae de stdin; en la expresión, v = primer valor
json(){
  local path="$1"; shift
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const a=process.argv.slice(1);const v=a[0];console.log((()=>{return (${path})})())}catch(e){console.log('JSONERR')}})" "$@"
}
req(){ # req <path> [token] [data] -> imprime "CODE|body" (GET o POST con data)
  local path="$1" tok="${2:-}" data="${3:-}"
  local args=(-s -w '|%{http_code}')
  if [ -n "$data" ]; then args+=(-X POST -H 'Content-Type: application/json' -d "$data"); fi
  if [ -n "$tok" ]; then args+=(-H "Authorization: Bearer $tok"); fi
  curl "${args[@]}" "$B$path"
}
code_of(){ if [ $# -gt 0 ]; then echo "$1" | cut -d'|' -f2; else cut -d'|' -f2; fi; }
body_of(){ if [ $# -gt 0 ]; then echo "$1" | cut -d'|' -f1; else cut -d'|' -f1; fi; }
hdr(){ curl -s -D - -o /dev/null "$1" | tr -d '\r' | grep -i "$2" | sed 's/^[^:]*:[[:space:]]*//'; }

#================================================================
echo ""
echo "===== G1. Salud y catálogo público ====="
R=$(req /health); check "health 200" "$(code_of "$R")" "200"
N=$(req /products | body_of | json 'j.length'); check "14 productos" "$N" "14"
IMG=$(req /products | body_of | json 'Array.isArray(j[0].images)'); check "images como array" "$IMG" "true"
TAG=$(req /products | body_of | json 'Array.isArray(j[0].tags)'); check "tags como array" "$TAG" "true"
FIRST=$(req /products | body_of | json 'j[0].id'); check "orden catalog p1" "$FIRST" "p1"
R=$(req /api_inexistente); check "404 ruta inexistente" "$(code_of "$R")" "404"
CT=$(curl -s -o /dev/null -w '%{content_type}' "$B/api_inexistente"); check "404 en JSON" "${CT%%;*}" "application/json"
XP=$(curl -s -o /dev/null -w '%{header_json}' "$B/health" | grep -o 'x-powered-by' || echo ""); check "sin header x-powered-by" "${XP:-ausente}" "ausente"
R=$(curl -s -w '|%{http_code}' -X POST "$B/auth/login" -H 'Content-Type: application/json' -d '{bad json}')
check "json malformado 400" "$(code_of "$R")" "400"
JM=$(echo "$R" | body_of | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{JSON.parse(d);console.log('json')}catch(e){console.log('no')}})")
check "json malformado responde JSON" "$JM" "json"

echo ""
echo "===== G2. Autenticación ====="
R=$(req /auth/register "" '{"name":"Ana Prueba","phone":"3001112233","email":"ana@test.co","password":"clave123","channel":"Instagram"}')
check "register 201" "$(code_of "$R")" "201"
TANA=$(echo "$R" | body_of | json 'j.token')
check "register devuelve token" "${TANA:0:4}" "eyJh"
HASH=$(echo "$R" | body_of | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('passwordHash'in j.user)})")
check "no expone passwordHash" "$HASH" "false"
check "role por defecto user" "$(echo "$R" | body_of | json 'j.user.role')" "user"
check "channel validado" "$(echo "$R" | body_of | json 'j.user.channel')" "Instagram"
R=$(req /auth/register "" '{"name":"Bob","phone":"3001112233","email":"bob@test.co","password":"123"}')
check "password corto 400" "$(code_of "$R")" "400"
R=$(req /auth/register "" '{"name":"Bob","phone":"3001112233","email":"correo-invalido","password":"clave123"}')
check "email invalido 400" "$(code_of "$R")" "400"
R=$(req /auth/register "" '{"name":"Ana Dupe","phone":"3001112233","email":"ANA@test.co","password":"clave123"}')
check "registro duplicado (case-insensitive) 409" "$(code_of "$R")" "409"
R=$(req /auth/register "" '{"name":"Carlos","phone":"3001112233","email":"carlos@test.co","password":"clave123","role":"admin"}')
check "no escalar role en register" "$(echo "$R" | body_of | json 'j.user.role')" "user"
R=$(req /auth/register "" '{"name":"Dan","phone":"3001112233","email":"dan@test.co","password":"clave123","channel":"<script>alert(1)</script>"}')
check "channel no validado 400" "$(code_of "$R")" "400"
R=$(req /auth/login "" '{"email":"ana@test.co","password":"clave123"}')
check "login ok 200" "$(code_of "$R")" "200"
R=$(req /auth/login "" '{"email":"ana@test.co","password":"incorrecta"}')
check "login pw incorrecta 401" "$(code_of "$R")" "401"
R=$(req /auth/login "" '{"email":"noexiste@test.co","password":"clave123"}')
check "login email inexistente 401" "$(code_of "$R")" "401"
R=$(req /auth/login "" '{"email":"ANA@test.co","password":"clave123"}')
check "login case-insensitive 200" "$(code_of "$R")" "200"
TBOB=$(req /auth/register "" '{"name":"Bob","phone":"3001112233","email":"bob@test.co","password":"clave123"}' | body_of | json 'j.token')

echo ""
echo "===== G3. Perfil ====="
R=$(req /auth/me "$TANA"); check "me 200" "$(code_of "$R")" "200"
R=$(curl -s -w '|%{http_code}' -X PUT "$B/auth/me" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"Ana Renombrada","phone":"3009998877","address":"Calle 1 # 2-3"}')
check "updateMe 200" "$(code_of "$R")" "200"
check "nombre actualizado" "$(echo "$R" | body_of | json 'j.user.name')" "Ana Renombrada"
check "direccion actualizada" "$(echo "$R" | body_of | json 'j.user.address')" "Calle 1 # 2-3"
R=$(curl -s -w '|%{http_code}' -X PUT "$B/auth/me" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"email":"bob@test.co"}')
check "email en uso 409" "$(code_of "$R")" "409"
R=$(curl -s -w '|%{http_code}' -X PUT "$B/auth/me" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"email":"malo"}')
check "email invalido 400" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X PUT "$B/auth/me" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"A"}')
check "nombre corto 400" "$(code_of "$R")" "400"
LONG=$(printf 'x%.0s' $(seq 1 500))
R=$(curl -s -w '|%{http_code}' -X PUT "$B/auth/me" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d "{\"address\":\"$LONG\"}")
check "address truncada <=300" "$(echo "$R" | body_of | json 'j.user.address.length <= 300')" "true"
R=$(curl -s -w '|%{http_code}' -X PUT "$B/auth/me" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"role":"admin"}')
check "no escalar role en updateMe" "$(echo "$R" | body_of | json 'j.user.role')" "user"

echo ""
echo "===== G4. Mascotas y aislamiento ====="
R=$(curl -s -w '|%{http_code}' -X POST "$B/pets" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"Rex","species":"Perros","breed":"Golden","age":3,"ration":200,"weight":28}')
check "create pet 201" "$(code_of "$R")" "201"
PIDPET=$(echo "$R" | body_of | json 'j.id')
check "list pets propios" "$(req /pets "$TANA" | body_of | json 'j.length')" "1"
check "get pet 200" "$(code_of "$(req "/pets/$PIDPET" "$TANA")")" "200"
R=$(curl -s -w '|%{http_code}' -X PUT "$B/pets/$PIDPET" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"Rex Jr"}')
check "update pet 200" "$(code_of "$R")" "200"
check "aislamiento: get pet ajeno 404" "$(code_of "$(req "/pets/$PIDPET" "$TBOB")")" "404"
check "aislamiento: delete pet ajeno 404" "$(code_of "$(curl -s -w '|%{http_code}' -X DELETE "$B/pets/$PIDPET" -H "Authorization: Bearer $TBOB")")" "404"
check "delete pet propio 200" "$(code_of "$(curl -s -w '|%{http_code}' -X DELETE "$B/pets/$PIDPET" -H "Authorization: Bearer $TANA")")" "200"
R=$(curl -s -w '|%{http_code}' -X POST "$B/pets" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"Negativo","species":"Perros","age":-2}')
check "edad negativa 400" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X POST "$B/pets" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"species":"Perros","age":2}')
check "pet sin nombre 400" "$(code_of "$R")" "400"
LONG=$(printf 'n%.0s' $(seq 1 200))
R=$(curl -s -w '|%{http_code}' -X POST "$B/pets" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d "{\"name\":\"$LONG\",\"species\":\"Perros\",\"age\":2}")
check "pet nombre largo 400" "$(code_of "$R")" "400"
check "pet sin auth 401" "$(code_of "$(curl -s -w '|%{http_code}' -X POST "$B/pets" -H 'Content-Type: application/json' -d '{"name":"Anon","species":"Perros","age":2}')")" "401"

echo ""
echo "===== G5. Pedidos ====="
PRE=$(req /products | body_of | json 'j.find(x=>x.id==="p2").stock')
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"items":[{"productId":"p2","qty":2}],"address":"Calle 2 # 3-4","payment":{"method":"digital"}}')
check "create order 201" "$(code_of "$R")" "201"
OID=$(echo "$R" | body_of | json 'j.id')
check "subtotal servidor (62000*2)" "$(echo "$R" | body_of | json 'j.subtotal')" "124000"
check "domicilio 8000" "$(echo "$R" | body_of | json 'j.delivery')" "8000"
check "total 132000" "$(echo "$R" | body_of | json 'j.total')" "132000"
check "status pendiente" "$(echo "$R" | body_of | json 'j.status')" "pendiente"
check "payment como objeto" "$(echo "$R" | body_of | json 'j.payment.method')" "digital"
check "nombre item de BD" "$(echo "$R" | body_of | json 'j.items[0].name')" "Alimento Cachorro Perro 3 kg"
POST=$(req /products | body_of | json 'j.find(x=>x.id==="p2").stock')
check "stock decrementado 60->58" "$POST" "$((PRE-2))"
H=$(date +%H); if [ "$H" -lt 13 ]; then EXP_SLOT="tarde"; else EXP_SLOT="manana"; fi
check "franja entrega regla logistica" "$(echo "$R" | body_of | json 'j.deliverySlot')" "$EXP_SLOT"
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"items":[],"address":"x","payment":{"method":"digital"}}')
check "items vacios 400" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"items":[{"productId":"p2","qty":1},{"productId":"p2","qty":1}],"address":"x","payment":{"method":"digital"}}')
check "item repetido 400" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"items":[{"productId":"noexiste","qty":1}],"address":"x","payment":{"method":"digital"}}')
check "producto inexistente 400" "$(code_of "$R")" "400"
P9PRE=$(req /products | body_of | json 'j.find(x=>x.id==="p9").stock')
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"items":[{"productId":"p9","qty":50}],"address":"x","payment":{"method":"digital"}}')
check "stock insuficiente 400" "$(code_of "$R")" "400"
P9POST=$(req /products | body_of | json 'j.find(x=>x.id==="p9").stock')
check "sin descuento parcial (p9 intacto)" "$P9POST" "$P9PRE"
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"items":[{"productId":"p2","qty":1}],"address":"","payment":{"method":"digital"}}')
check "sin direccion 400" "$(code_of "$R")" "400"
LONG=$(printf 'a%.0s' $(seq 1 400))
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d "{\"items\":[{\"productId\":\"p2\",\"qty\":1}],\"address\":\"$LONG\",\"payment\":{\"method\":\"digital\"}}")
check "direccion larga 400" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"items":[{"productId":"p2","qty":0}],"address":"x","payment":{"method":"digital"}}')
check "cantidad 0 400" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"items":[{"productId":"p2","qty":500}],"address":"x","payment":{"method":"digital"}}')
check "cantidad >100 400" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"items":[{"productId":"p4","qty":1,"price":1,"total":1}],"address":"Calle p","payment":{"method":"efectivo","denomination":50000}}')
check "precios no confiables: subtotal real" "$(echo "$R" | body_of | json 'j.subtotal')" "142000"
check "efectivo con billete" "$(echo "$R" | body_of | json 'j.payment.denomination')" "50000"
check "historial solo propio" "$(req /orders "$TANA" | body_of | json 'j.length')" "2"
check "otro usuario no ve pedidos" "$(req /orders "$TBOB" | body_of | json 'j.length')" "0"
check "orders sin auth 401" "$(code_of "$(req /orders)")" "401"

echo ""
echo "===== G6. Panel admin y autorización ====="
check "usuario en admin 403" "$(code_of "$(req /admin/orders "$TANA")")" "403"
R=$(curl -s -w '|%{http_code}' -X PATCH "$B/admin/orders/$OID/status" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"status":"entregado"}')
check "usuario cambia estado 403" "$(code_of "$R")" "403"
check "usuario ve atribucion 403" "$(code_of "$(req /admin/attribution "$TANA")")" "403"
check "usuario crea producto 403" "$(code_of "$(req /products "$TANA" '{"name":"Hack","species":"Perros"}')")" "403"
check "sin auth crea producto 401" "$(code_of "$(req /products "" '{"name":"Anon","species":"Perros"}')")" "401"
npm run promote -- ana@test.co >/dev/null 2>&1
check "promote aplica role admin" "$(req /auth/me "$TANA" | body_of | json 'j.user.role')" "admin"
R=$(req /admin/orders "$TANA")
check "admin lista pedidos 200" "$(code_of "$R")" "200"
check "admin ve 2 pedidos" "$(echo "$R" | body_of | json 'j.length')" "2"
R=$(curl -s -w '|%{http_code}' -X PATCH "$B/admin/orders/$OID/status" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"status":"entregado"}')
check "admin marca entregado 200" "$(code_of "$R")" "200"
check "cliente ve entregado" "$(req /orders "$TANA" | body_of | json 'j.find(x=>x.id===v).status' "$OID")" "entregado"
R=$(curl -s -w '|%{http_code}' -X PATCH "$B/admin/orders/$OID/status" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"status":"cualquiera"}')
check "estado invalido 400" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X PATCH "$B/admin/orders/zzz/status" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"status":"entregado"}')
check "pedido inexistente 404" "$(code_of "$R")" "404"
R=$(req /admin/attribution "$TANA")
check "admin atribucion 200" "$(code_of "$R")" "200"
check "canal Instagram en atribucion" "$(echo "$R" | body_of | json 'j.channels.map(c=>c.channel).includes("Instagram")')" "true"
check "detalle atribucion con usuario" "$(echo "$R" | body_of | json 'j.detail.some(d=>d.userName==="Ana Renombrada")')" "true"
R=$(curl -s -w '|%{http_code}' -X POST "$B/products" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"Admin crea X","species":"Perros","category":"Snacks","price":9900,"stock":25,"tags":["nuevo"],"images":["https://picsum.photos/seed/admx/600/450"]}')
check "admin crea producto 201" "$(code_of "$R")" "201"
PIDNEW=$(echo "$R" | body_of | json 'j.id')
check "producto en catalogo (15)" "$(req /products | body_of | json 'j.length')" "15"
check "visible en storefront" "$(req /products | body_of | json 'j.some(p=>p.id===v)' "$PIDNEW")" "true"
LONG=$(printf 'n%.0s' $(seq 1 200))
R=$(curl -s -w '|%{http_code}' -X PUT "$B/products/$PIDNEW" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d "{\"name\":\"$LONG\"}")
check "nombre >120 400" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X PUT "$B/products/$PIDNEW" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"stock":7}')
check "update stock 200" "$(code_of "$R")" "200"
check "stock reflejado" "$(req /products | body_of | json 'j.find(x=>x.id===v).stock' "$PIDNEW")" "7"
R=$(curl -s -w '|%{http_code}' -X POST "$B/products" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"species":"Perros"}')
check "crear sin nombre 400" "$(code_of "$R")" "400"
# Orden que incluye el producto nuevo -> debe sobrevivir al borrado (histórico)
R=$(curl -s -w '|%{http_code}' -X POST "$B/orders" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d "{\"items\":[{\"productId\":\"$PIDNEW\",\"qty\":1}],\"address\":\"Para historico\",\"payment\":{\"method\":\"digital\"}}")
check "orden con producto nuevo 201" "$(code_of "$R")" "201"
R=$(curl -s -w '|%{http_code}' -X DELETE "$B/products/$PIDNEW" -H "Authorization: Bearer $TANA")
check "delete producto 200" "$(code_of "$R")" "200"
check "eliminado del catalogo" "$(req /products | body_of | json 'j.some(p=>p.id===v)' "$PIDNEW")" "false"
check "historico preserva item" "$(req /admin/orders "$TANA" | body_of | json 'j.some(o=>o.items.some(i=>i.name===v && i.productId===null))' "Admin crea X")" "true"
XSS='<img src=x onerror=alert(1)>'
R=$(curl -s -w '|%{http_code}' -X POST "$B/products" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d "{\"name\":\"$XSS\",\"species\":\"Perros\",\"price\":1000,\"stock\":5}")
check "admin guarda nombre con HTML 201" "$(code_of "$R")" "201"
if grep -q 'esc(p.name)' ../js/app.js && grep -q 'esc(p.desc)' ../js/app.js; then
  ok "frontend escapa nombre/desc de producto (anti XSS)"
else
  ko "frontend NO escapa nombre/desc de producto"
fi

echo ""
echo "===== G7. Limpieza e integridad ====="
check "atribucion = usuarios creados (3)" "$(req /admin/attribution "$TANA" | body_of | json 'j.detail.length')" "3"
check "no quedan claves locales antiguas en data.js" "$(grep -c 'cp_products\|cp_users\|cp_orders\|cp_pets\|cp_attributions\|STORE.products\|STORE.users\|STORE.orders\|STORE.attributions\|App.users\|App.orders\|App.session' ../js/data.js)" "0"

echo ""
echo "===== G8. Sesión, carrito y concurrencia ====="
# --- 8.2 sesión expirada / JWT inválido / reautenticación ---
UIDANA=$(req /auth/me "$TANA" | body_of | json 'j.user.id')
SECRET=$(grep -oP '^JWT_SECRET="\K[^"]+' .env)
EXP=$(SECRET="$SECRET" node -e "console.log(require('jsonwebtoken').sign({userId:process.argv[1]}, process.env.SECRET, {expiresIn:'-60s'}))" "$UIDANA")
R=$(req /auth/me "$EXP")
check "sesion expirada 401" "$(code_of "$R")" "401"
check "mensaje expirado" "$(echo "$R" | body_of | json 'j.error.includes("expirado")')" "true"
R=$(req /auth/me "token.malo.invalido")
check "JWT invalido 401" "$(code_of "$R")" "401"
R=$(req /auth/me "")
check "sin token 401" "$(code_of "$R")" "401"
if awk '/async function initSession/,/^  }/' ../js/app.js | grep -q 'setToken(null);' && awk '/async function initSession/,/^  }/' ../js/app.js | grep -q "api('/auth/me')"; then
  ok "frontend reautentica al cargar (initSession valida /auth/me y limpia token si 401)"
else
  ko "frontend NO reautentica al cargar"
fi
if grep -q 'id="btnLogout"' ../index.html && grep -A4 'btnLogout' ../js/app.js | grep -q 'setToken(null);'; then
  ok "logout limpia la sesion (cp_session)"
else
  ko "logout no limpia la sesion"
fi
# --- 8.3 carrito: solo productId + qty; el resto desde la API ---
if grep -q 'push({ id, qty: 1 })' ../js/app.js && grep -q 'App.products.find(x => x.id === c.id)' ../js/app.js; then
  ok "carrito guarda solo id+qty y deriva precio/nombre/imagen/stock de la API"
else
  ko "carrito no cumple la regla id+qty"
fi
# --- 8.4 concurrencia: las últimas unidades ---
R=$(curl -s -w '|%{http_code}' -X POST "$B/products" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"Unica unidad","species":"Perros","price":5000,"stock":1}')
check "admin crea producto stock=1" "$(code_of "$R")" "201"
PIDCONC=$(echo "$R" | body_of | json 'j.id')
# Dos pedidos simultáneos por la única unidad (ana y bob). La transacción atómica
# del backend debe permitir exactamente uno.
CONC=$(node -e "
const B = 'http://localhost:3000/api';
const payload = { items: [{ productId: process.argv[3], qty: 1 }], address: 'Concurso', payment: { method: 'digital' } };
const mk = (tok) => fetch(B + '/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(payload) });
Promise.all([mk(process.argv[1]), mk(process.argv[2])]).then(async (rs) => {
  const codes = rs.map((r) => r.status).sort((a, b) => a - b).join(' ');
  const bodies = await Promise.all(rs.map((r) => r.text()));
  console.log(codes + '|' + bodies.filter((b) => b.includes('Stock insuficiente')).length);
}).catch(() => console.log('ERR|0'));
" "$TANA" "$TBOB" "$PIDCONC")
check "concurrencia: una sola compra gana (201 y 400)" "$(echo "$CONC" | cut -d'|' -f1)" "201 400"
check "mensaje de stock insuficiente" "$(echo "$CONC" | cut -d'|' -f2)" "1"
check "stock final 0 (no se vendio de mas)" "$(req /products | body_of | json 'j.find(x=>x.id===v).stock' "$PIDCONC")" "0"
check "solo 1 pedido con el producto" "$(req /admin/orders "$TANA" | body_of | json 'j.filter(o=>o.items.some(i=>i.productId===v)).length' "$PIDCONC")" "1"

echo ""
echo "===== G9. Fase 9.2: rate-limit, CORS y API relativa ====="
ROOT="http://localhost:3000"
# --- API_BASE relativa ---
if grep -q "const API_BASE = '/api'" ../js/data.js && ! grep -q 'localhost:3000/api' ../js/data.js; then
  ok "API_BASE relativa en data.js"
else
  ko "API_BASE no es relativa"
fi
# --- rate-limit conectado ---
if [ -f src/middleware/rate-limit.js ] && grep -q 'rateLimit(' src/routes/auth.js; then
  ok "rate-limit conectado en login/register"
else
  ko "rate-limit no conectado en auth"
fi
# --- CORS con whitelist (no desnudo) ---
if grep -q 'DEV_ORIGIN_RE' server.js && ! grep -q '^app.use(cors());' server.js; then
  ok "CORS restringido por origen en server.js"
else
  ko "CORS sigue abierto"
fi
# --- frontend servido por la API con bloqueo del backend ---
if grep -q 'express.static(FRONTEND_ROOT)' server.js && grep -q 'city-pets-backend' server.js; then
  ok "server.js sirve el frontend y bloquea city-pets-backend"
else
  ko "servido estático no configurado"
fi
check "frontend servido por la API (index)" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/")" "200"
check "backend bloqueado (404)" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/city-pets-backend/server.js")" "404"
check "CORS: origen externo sin cabecera ACAO" "$(curl -s -D - -o /dev/null -H 'Origin: https://evil.example.com' "$B/health" | grep -ci 'access-control-allow-origin')" "0"
check "CORS: localhost de desarrollo permitido" "$(curl -s -D - -o /dev/null -H 'Origin: http://localhost:5500' "$B/health" | grep -ci 'access-control-allow-origin')" "1"

echo ""
echo "===== G10. Fase 9.3: login robusto, doble checkout, esc() y dbWrite ====="
# --- login robusto: nunca 500 con tipos raros ---
R=$(req /auth/login "" '{"email":12345,"password":"x"}')
check "login email numerico 400 (no 500)" "$(code_of "$R")" "400"
R=$(curl -s -w '|%{http_code}' -X POST "$B/auth/login" -H 'Content-Type: application/json' -d '{}')
check "login sin cuerpo 400 (no 500)" "$(code_of "$R")" "400"
R=$(req /auth/login "" '{"email":[],"password":[]}')
check "login arrays 400 (no 500)" "$(code_of "$R")" "400"
# --- guard de doble checkout ---
if grep -q 'checkoutBusy' ../js/app.js && grep -q 'btn.disabled' ../js/app.js && grep -q 'finally' ../js/app.js; then
  ok "confirmOrder bloquea doble envío y permite reintentar"
else
  ko "guard de doble checkout no implementado"
fi
# --- esc() en qty del carrito ---
if grep -q 'esc(i.qty)' ../js/app.js; then
  ok "i.qty escapado en el carrito"
else
  ko "i.qty sin escapar"
fi
# --- dbWrite robusto ---
if awk '/function dbWrite/,/^}/' ../js/data.js | grep -q 'try {' && awk '/function dbWrite/,/^}/' ../js/data.js | grep -q 'catch'; then
  ok "dbWrite maneja excepciones de localStorage"
else
  ko "dbWrite no maneja excepciones"
fi
# --- gramaje como número, no como dinero ---
if grep -q "Number(grams).toLocaleString" ../js/app.js && ! grep -q 'fmtMoney(grams)' ../js/app.js; then
  ok "gramaje mostrado como numero, no dinero"
else
  ko "gramaje sigue con fmtMoney"
fi

echo ""
echo "===== G11. Fase 9.3.1: Helmet, CSP y cabeceras de seguridad ====="
# --- cabeceras presentes en API y frontend ---
check "CSP presente en health" "$(curl -s -D - -o /dev/null "$B/health" | grep -ci '^content-security-policy:')" "1"
check "CSP presente en index" "$(curl -s -D - -o /dev/null "$ROOT/" | grep -ci '^content-security-policy:')" "1"
check "CSP presente en admin.html" "$(curl -s -D - -o /dev/null "$ROOT/admin.html" | grep -ci '^content-security-policy:')" "1"
check "X-Content-Type-Options nosniff" "$(hdr "$B/health" x-content-type-options)" "nosniff"
check "Referrer-Policy strict-origin-when-cross-origin" "$(hdr "$B/health" referrer-policy)" "strict-origin-when-cross-origin"
check "X-Frame-Options SAMEORIGIN" "$(hdr "$B/health" x-frame-options)" "SAMEORIGIN"
check "Permissions-Policy presente" "$(hdr "$B/health" permissions-policy)" "camera=(), microphone=(), geolocation=(), payment=()"
check "Cross-Origin-Resource-Policy same-origin" "$(hdr "$B/health" cross-origin-resource-policy)" "same-origin"
check "sin HSTS (se activa solo bajo HTTPS)" "$(curl -s -D - -o /dev/null "$B/health" | grep -ci 'strict-transport-security')" "0"
check "sin COEP (recursos externos ok)" "$(curl -s -D - -o /dev/null "$B/health" | grep -ci 'cross-origin-embedder-policy')" "0"
# --- directivas de la política CSP ---
CSP=$(hdr "$ROOT/" content-security-policy)
check "CSP default-src 'self'" "$(echo "$CSP" | grep -o "default-src '[^']*'")" "default-src 'self'"
check "CSP script-src 'self'" "$(echo "$CSP" | grep -o "script-src '[^']*'")" "script-src 'self'"
check "CSP style-src con unsafe-inline" "$(echo "$CSP" | grep -o 'style-src [^;]*')" "style-src 'self' 'unsafe-inline'"
check "CSP img-src con picsum" "$(echo "$CSP" | grep -o 'img-src [^;]*')" "img-src 'self' data: blob: https://*.picsum.photos"
check "CSP media-src data/blob" "$(echo "$CSP" | grep -o 'media-src [^;]*')" "media-src 'self' data: blob:"
check "CSP connect-src 'self'" "$(echo "$CSP" | grep -o "connect-src '[^']*'")" "connect-src 'self'"
check "CSP object-src 'none'" "$(echo "$CSP" | grep -o "object-src '[^']*'")" "object-src 'none'"
check "CSP frame-ancestors 'self'" "$(echo "$CSP" | grep -o "frame-ancestors '[^']*'")" "frame-ancestors 'self'"
check "CSP sin upgrade-insecure-requests (dev)" "$(echo "$CSP" | grep -ci 'upgrade-insecure-requests')" "0"
# --- recursos del frontend siguen servidos (misma origen, 'self') ---
check "index.html servido" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/")" "200"
check "admin.html servido" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/admin.html")" "200"
check "css/styles.css servido" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/css/styles.css")" "200"
check "js/app.js servido" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/js/app.js")" "200"
check "js/admin.js servido" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/js/admin.js")" "200"
check "assets/logo.svg servido" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/assets/logo.svg")" "200"
check "assets/hero-dog.svg servido" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT/assets/hero-dog.svg")" "200"

echo ""
echo "===== G12. Fase 9.5A: separación desarrollo / producción ====="
# --- config estática ---
if grep -q "process.env.NODE_ENV || 'development'" server.js; then
  ok "NODE_ENV por defecto development"
else
  ko "NODE_ENV default no configurado"
fi
if grep -q "'development', 'production'" server.js; then
  ok "solo development/production aceptados"
else
  ko "validacion de NODE_ENV ausente"
fi
if grep -q "includes('\*')" server.js; then
  ok "CORS_ORIGINS rechaza comodin *"
else
  ko "comodin no rechazado"
fi
if grep -q "IS_PROD) return cb(null, configuredOrigins.includes(origin))" server.js; then
  ok "produccion: solo CORS_ORIGINS"
else
  ko "produccion no restringe CORS a CORS_ORIGINS"
fi
if grep -q '^NODE_ENV' .env.example && grep -q '^PORT' .env.example; then
  ok ".env.example documenta NODE_ENV y PORT"
else
  ko ".env.example incompleto"
fi
# --- Fase 9.6: HOST, trust proxy, UPLOADS_PATH, postinstall ---
if grep -q "IS_PROD ? '127.0.0.1'" server.js; then
  ok "prod escucha en 127.0.0.1 por defecto"
else
  ko "prod no limita HOST a loopback"
fi
if grep -q "HOST === '0.0.0.0'" server.js; then
  ok "fail-fast ante HOST wildcard en prod"
else
  ko "sin guard de HOST"
fi
if grep -q "app.set('trust proxy', IS_PROD ? 1 : false)" server.js; then
  ok "trust proxy explícito por entorno"
else
  ko "trust proxy no configurado"
fi
if grep -q '^HOST' .env.example && grep -q '^UPLOADS_PATH' .env.example; then
  ok ".env.example documenta HOST y UPLOADS_PATH"
else
  ko ".env.example sin HOST/UPLOADS_PATH"
fi
if grep -q '"postinstall".*"prisma generate"' package.json; then
  ok "postinstall regenera client Prisma"
else
  ko "sin postinstall de prisma generate"
fi
if grep -q 'UPLOADS_PATH' src/storage/index.js; then
  ok "UPLOADS_PATH configurable en storage"
else
  ko "UPLOADS_PATH no usado en storage"
fi
if grep -q 'DB_PATH' scripts/backup.sh && grep -q 'UPLOADS_DIR' scripts/backup.sh \
   && grep -q 'DB_PATH' scripts/restore.sh && grep -q 'UPLOADS_DIR' scripts/restore.sh; then
  ok "backup/restore leen rutas de env"
else
  ko "backup/restore sin rutas de env"
fi
# --- fail-fast: arranques inválidos deben abortar (exit != 0) ---
NODE_ENV=invalid timeout 5 node server.js >/dev/null 2>&1; EC=$?
check "fail-fast: NODE_ENV invalido aborta" "$EC" "1"
NODE_ENV=production CORS_ORIGINS='' timeout 5 node server.js >/dev/null 2>&1; EC=$?
check "fail-fast: produccion sin CORS_ORIGINS aborta" "$EC" "1"
NODE_ENV=production CORS_ORIGINS='*' timeout 5 node server.js >/dev/null 2>&1; EC=$?
check "fail-fast: produccion con comodin aborta" "$EC" "1"
NODE_ENV=production CORS_ORIGINS='https://citypets.com' HOST=0.0.0.0 timeout 5 node server.js >/dev/null 2>&1; EC=$?
check "fail-fast: produccion con HOST=0.0.0.0 aborta" "$EC" "1"
# --- server real en producción (puerto 3100) ---
NODE_ENV=production PORT=3100 CORS_ORIGINS='https://citypets.com,https://www.citypets.com' \
  node server.js > /tmp/citypets-prod.log 2>&1 &
PROD_PID=$!
sleep 2
check "prod: health 200" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/api/health)" "200"
LISTEN=$(ss -ltn 2>/dev/null | grep ':3100' | head -1)
case "$LISTEN" in *"127.0.0.1:3100"*) ok "prod escucha solo en 127.0.0.1" ;; *) ko "prod no está en loopback ($LISTEN)" ;; esac
check "prod: trust proxy lee X-Forwarded-For" "$(curl -s -H 'X-Forwarded-For: 203.0.113.9' http://127.0.0.1:3100/api/health | json 'j.ip')" "203.0.113.9"
check "prod: HSTS presente" "$(curl -s -D - -o /dev/null http://localhost:3100/api/health | grep -ci 'strict-transport-security')" "1"
check "prod: localhost sin ACAO" "$(curl -s -D - -o /dev/null -H 'Origin: http://localhost:5500' http://localhost:3100/api/health | grep -ci 'access-control-allow-origin')" "0"
check "prod: dominio permitido con ACAO" "$(curl -s -D - -o /dev/null -H 'Origin: https://citypets.com' http://localhost:3100/api/health | grep -ci 'access-control-allow-origin')" "1"
check "prod: origen externo sin ACAO" "$(curl -s -D - -o /dev/null -H 'Origin: https://evil.example.com' http://localhost:3100/api/health | grep -ci 'access-control-allow-origin')" "0"
check "prod: log muestra [production]" "$(grep -c '\[production\]' /tmp/citypets-prod.log)" "1"
kill "$PROD_PID" 2>/dev/null; wait "$PROD_PID" 2>/dev/null
# --- dev (server principal en :3000) ---
check "dev: localhost con ACAO" "$(curl -s -D - -o /dev/null -H 'Origin: http://localhost:5500' "$B/health" | grep -ci 'access-control-allow-origin')" "1"
check "dev: sin HSTS" "$(curl -s -D - -o /dev/null "$B/health" | grep -ci 'strict-transport-security')" "0"
check "dev: log muestra [development]" "$(grep -c '\[development\]' /tmp/citypets-integral-server.log)" "1"
check "dev: ignora X-Forwarded-For forjado" "$(curl -s -H 'X-Forwarded-For: 203.0.113.9' http://127.0.0.1:3000/api/health | json 'j.ip')" "127.0.0.1"

echo ""
echo "===== G13. Fase 9.5B: almacenamiento de medios (/uploads) ====="
# --- config estática ---
if grep -q '"multer"' package.json; then ok "multer instalado"; else ko "multer ausente"; fi
if [ -f src/storage/index.js ]; then ok "adaptador de almacenamiento presente"; else ko "adaptador ausente"; fi
if ! grep -q 'slice(0, 1000)' src/controllers/products.js; then ok "video ya no se trunca a 1000"; else ko "bug de truncado sigue"; fi
if grep -q "app.use('/uploads'" server.js; then ok "/uploads servido estaticamente"; else ko "/uploads no servido"; fi
if grep -q 'uploads/' .gitignore; then ok ".gitignore ignora uploads/"; else ko ".gitignore sin uploads"; fi
if grep -q 'sanitizeVideo\|isMediaUrl' src/controllers/products.js; then ok "productos validan URLs de medios"; else ko "sin validacion de medios"; fi
if [ -f scripts/migrate-media.js ]; then ok "script de migracion de data: presente"; else ko "migracion ausente"; fi
# --- archivos de prueba ---
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > /tmp/cp-upload.png
printf 'not an image' > /tmp/cp-upload.txt
printf '\x00\x00\x00\x20ftypisom\x00\x00\x00\x00isomiso2avc1mp41' > /tmp/cp-upload.mp4
head -c 6291456 /dev/zero > /tmp/cp-big.png
head -c 26214401 /dev/zero > /tmp/cp-big.mp4
# --- autorización ---
check "upload sin token 401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -F 'file=@/tmp/cp-upload.png' "$B/upload/image")" "401"
check "upload usuario normal 403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TBOB" -F 'file=@/tmp/cp-upload.png' "$B/upload/image")" "403"
# --- subida de imagen ---
UPL=$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TANA" -F 'file=@/tmp/cp-upload.png' "$B/upload/image")
check "upload imagen admin 201" "$(code_of "$UPL")" "201"
IMGURL=$(body_of "$UPL" | json 'j.url')
check "url relativa /uploads" "${IMGURL:0:9}" "/uploads/"
check "archivo servido 200" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT$IMGURL")" "200"
check "content-type image/png" "$(hdr "$ROOT$IMGURL" '^content-type:')" "image/png"
check "upload texto rechazado 400" "$(code_of "$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TANA" -F 'file=@/tmp/cp-upload.txt' "$B/upload/image")")" "400"
check "upload imagen >5MB 413" "$(code_of "$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TANA" -F 'file=@/tmp/cp-big.png' "$B/upload/image")")" "413"
# --- subida de video ---
VUPL=$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TANA" -F 'file=@/tmp/cp-upload.mp4' "$B/upload/video")
check "upload video mp4 201" "$(code_of "$VUPL")" "201"
VIDURL=$(body_of "$VUPL" | json 'j.url')
check "video como url no base64" "${VIDURL:0:9}" "/uploads/"
check "video servido 200" "$(curl -s -o /dev/null -w '%{http_code}' "$ROOT$VIDURL")" "200"
check "upload texto como video 400" "$(code_of "$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TANA" -F 'file=@/tmp/cp-upload.txt' "$B/upload/video")")" "400"
check "upload video >25MB 413" "$(code_of "$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TANA" -F 'file=@/tmp/cp-big.mp4' "$B/upload/video")")" "413"
# --- integración con productos ---
R=$(curl -s -w '|%{http_code}' -X POST "$B/products" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d "{\"name\":\"Producto Medio\",\"species\":\"Perros\",\"category\":\"Accesorios\",\"price\":12000,\"unit\":\"1 und\",\"grams\":0,\"stock\":6,\"images\":[\"$IMGURL\"],\"video\":\"$VIDURL\"}")
check "crear producto con urls 201" "$(code_of "$R")" "201"
check "images[0] es la url subida" "$(body_of "$R" | json 'j.images[0]')" "$IMGURL"
check "video guardado sin truncar" "$(body_of "$R" | json 'j.video')" "$VIDURL"
R=$(curl -s -w '|%{http_code}' -X POST "$B/products" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"Sin Base64","species":"Gatos","price":1,"images":["data:image/png;base64,AAAA"],"video":"data:video/mp4;base64,AAAA"}')
check "base64 en images se descarta" "$(body_of "$R" | json 'JSON.stringify(j.images)')" "[]"
check "base64 en video se descarta" "$(body_of "$R" | json 'JSON.stringify(j.video)')" '""'

echo ""
echo "===== G14. Fase 9.5C: backups y restauración ====="
# --- estática ---
[ -f scripts/backup.sh ] && ok "backup.sh presente" || ko "backup.sh ausente"
[ -x scripts/backup.sh ] && ok "backup.sh ejecutable" || ko "backup.sh no es ejecutable"
[ -f scripts/restore.sh ] && ok "restore.sh presente" || ko "restore.sh ausente"
[ -x scripts/restore.sh ] && ok "restore.sh ejecutable" || ko "restore.sh no es ejecutable"
grep -q '^backups/' .gitignore && ok ".gitignore ignora backups/" || ko ".gitignore sin backups/"

# --- backup crea tar.gz con dev.db y uploads ---
rm -rf backups
mkdir -p uploads/products
printf 'backup test' > uploads/products/g14.txt
bash scripts/backup.sh >/dev/null
B1="$(ls -1t backups/ | head -1)"
[ -n "$B1" ] && ok "backup genera tar.gz" || ko "no se generó backup"
tar -tzf "backups/$B1" | grep -q 'dev.db' && ok "backup contiene dev.db" || ko "backup sin dev.db"
tar -tzf "backups/$B1" | grep -q 'uploads/products/g14.txt' && ok "backup contiene uploads" || ko "backup sin uploads"

# --- rotación con BACKUP_KEEP ---
BACKUP_KEEP=2 bash scripts/backup.sh >/dev/null
BACKUP_KEEP=2 bash scripts/backup.sh >/dev/null
check "rotación conserva 2 copias" "$(ls -1 backups/citypets-*.tar.gz | wc -l)" "2"

# --- restauración: producto y archivo recuperados ---
R=$(curl -s -w '|%{http_code}' -X POST "$B/products" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"Restaurame","species":"Perros","price":5000}')
check "producto Restaurame creado" "$(code_of "$R")" "201"
RPID=$(body_of "$R" | json 'j.id')
bash scripts/backup.sh >/dev/null
curl -s -o /dev/null -X DELETE "$B/products/$RPID" -H "Authorization: Bearer $TANA"
check "producto borrado" "$(req /products "$TANA" | body_of | json 'j.some(p=>p.id==="'"$RPID"'")')" "false"
rm -f uploads/products/g14.txt
kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
B2="$(ls -1t backups/ | head -1)"
bash scripts/restore.sh "backups/$B2" --force --no-safety >/dev/null
node server.js > /tmp/citypets-integral-server.log 2>&1 &
SERVER_PID=$!
sleep 2
check "producto restaurado" "$(req /products "$TANA" | body_of | json 'j.some(p=>p.name==="Restaurame")')" "true"
[ -f uploads/products/g14.txt ] && ok "archivo uploads restaurado" || ko "archivo uploads no restaurado"

echo ""
echo "===== G15. Fase 9.6: artefactos de despliegue (VPS) ====="
# --- artefactos presentes ---
[ -f deploy/city-pets.service ] && ok "systemd unit presente" || ko "falta deploy/city-pets.service"
[ -f deploy/nginx.conf ] && ok "nginx.conf presente" || ko "falta deploy/nginx.conf"
[ -f deploy/deploy.sh ] && ok "deploy.sh presente" || ko "falta deploy/deploy.sh"
[ -x deploy/deploy.sh ] && ok "deploy.sh ejecutable" || ko "deploy.sh no es ejecutable"
[ -f ../.nvmrc ] && ok ".nvmrc presente" || ko "falta .nvmrc"
# --- nginx.conf por contenido ---
grep -q 'proxy_pass http://127.0.0.1:3000' deploy/nginx.conf && ok "nginx: proxy_pass 127.0.0.1:3000" || ko "nginx: sin proxy_pass"
grep -q 'client_max_body_size 26m' deploy/nginx.conf && ok "nginx: client_max_body_size 26m" || ko "nginx: falta client_max_body_size"
grep -q 'location /uploads/' deploy/nginx.conf && ok "nginx: /uploads proxied" || ko "nginx: sin location /uploads"
grep -q 'X-Forwarded-For' deploy/nginx.conf && grep -q 'X-Forwarded-Proto' deploy/nginx.conf && ok "nginx: headers X-Forwarded-*" || ko "nginx: headers incompletos"
grep -q 'listen 443 ssl' deploy/nginx.conf && grep -q 'ssl_certificate' deploy/nginx.conf && ok "nginx: preparado para HTTPS" || ko "nginx: sin preparacion HTTPS"
# --- systemd por contenido ---
grep -q '^User=citypets' deploy/city-pets.service && ok "systemd: usuario dedicado" || ko "systemd: sin usuario dedicado"
if grep -q '^User=root' deploy/city-pets.service; then ko "systemd: NO debe usar root"; else ok "systemd: sin root"; fi
grep -q '^Restart=on-failure' deploy/city-pets.service && ok "systemd: reinicio automatico" || ko "systemd: sin Restart"
grep -q '^EnvironmentFile=' deploy/city-pets.service && ok "systemd: EnvironmentFile (.env)" || ko "systemd: sin EnvironmentFile"
grep -q '^WorkingDirectory=' deploy/city-pets.service && ok "systemd: WorkingDirectory" || ko "systemd: sin WorkingDirectory"
grep -q 'network-online.target' deploy/city-pets.service && ok "systemd: dependencia de red" || ko "systemd: sin network-online"
grep -q 'NoNewPrivileges=true' deploy/city-pets.service && grep -q 'ProtectSystem=strict' deploy/city-pets.service && ok "systemd: sandbox minimo" || ko "systemd: sin sandbox"
# --- Node / LTS ---
NVM="$(cat ../.nvmrc 2>/dev/null)"
case "$NVM" in 24.*) ok "nvmrc pin a LTS activa (Node $NVM)" ;; *) ko "nvmrc no apunta a LTS 24 ($NVM)" ;; esac
node -e "const e=require('./package.json').engines; if(!e||!e.node||!e.node.includes('24'))process.exit(1)" && ok "engines.node cubre Node 24" || ko "engines.node no cubre Node 24"
# --- deploy.sh pasos obligatorios ---
grep -q 'npm ci' deploy/deploy.sh && ok "deploy: npm ci" || ko "deploy: sin npm ci"
grep -q 'prisma migrate deploy' deploy/deploy.sh && ok "deploy: migrate deploy" || ko "deploy: sin migrate deploy"
grep -q 'install -d' deploy/deploy.sh && ok "deploy: permisos de datos" || ko "deploy: sin permisos"
grep -q 'systemctl restart' deploy/deploy.sh && ok "deploy: reinicia servicio" || ko "deploy: sin restart"
grep -q 'HEALTH_URL' deploy/deploy.sh && ok "deploy: healthcheck posterior" || ko "deploy: sin healthcheck"
# --- prod sobre 127.0.0.1:3000 + proxy temporal :8080 (sin nginx) ---
kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
NODE_ENV=production CORS_ORIGINS='https://citypets.com,https://www.citypets.com' PORT=3000 \
  node server.js > /tmp/citypets-g15-prod.log 2>&1 &
SERVER_PID=$!
FAKE_CLIENT_IP=198.51.100.7 PORT=8080 TARGET=3000 node scripts/test-proxy.js > /tmp/citypets-g15-proxy.log 2>&1 &
PROXY_PID=$!
sleep 2
# admin propio de G15 (reproducible; no depende de TANA)
R=$(curl -s -w '|%{http_code}' -X POST "$B/auth/register" -H 'Content-Type: application/json' -d '{"name":"G15 Admin","phone":"3005550999","email":"g15proxy@test.co","password":"clave123"}')
TG15=$(body_of "$R" | json 'j.token')
npm run promote -- g15proxy@test.co >/dev/null 2>&1
[ "${TG15:0:4}" = "eyJh" ] && ok "G15 crea su propio admin" || ko "G15 no pudo crear admin"
# backend :3000 solo en loopback
LISTEN=$(ss -ltn 2>/dev/null | grep ':3000' | head -1)
case "$LISTEN" in *"127.0.0.1:3000"*) ok "prod :3000 solo en loopback" ;; *) ko "prod :3000 expuesto ($LISTEN)" ;; esac
# salud a través del proxy
check "proxy: /api/health 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/health)" "200"
check "proxy: body status ok" "$(curl -s http://127.0.0.1:8080/api/health | json 'j.status')" "ok"
# X-Forwarded-For -> req.ip correcto (solo confía en el proxy inmediato)
check "proxy: req.ip desde XFF (cliente)" "$(curl -s http://127.0.0.1:8080/api/health | json 'j.ip')" "198.51.100.7"
check "proxy: XFF forjado NO se acepta" "$(curl -s -H 'X-Forwarded-For: 203.0.113.9' http://127.0.0.1:8080/api/health | json 'j.ip')" "198.51.100.7"
# subida > 1 MB atraviesa el proxy (nginx con 1 MB default la cortaría)
node scripts/gen-test-png.js /tmp/cp-g15-big.png >/dev/null
[ "$(stat -c %s /tmp/cp-g15-big.png 2>/dev/null || echo 0)" -gt 1048576 ] && ok "PNG de prueba >1MB generado" || ko "PNG de prueba no supera 1MB"
UP=$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TG15" -F 'file=@/tmp/cp-g15-big.png' http://127.0.0.1:8080/api/upload/image)
check "proxy: subida >1MB atraviesa el proxy (201)" "$(code_of "$UP")" "201"
PIMG=$(body_of "$UP" | json 'j.url')
check "proxy: /uploads servido (200)" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8080$PIMG")" "200"
kill "$PROXY_PID" 2>/dev/null; wait "$PROXY_PID" 2>/dev/null
[ "$FAIL" -eq 0 ]