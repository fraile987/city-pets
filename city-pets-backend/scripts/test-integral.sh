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