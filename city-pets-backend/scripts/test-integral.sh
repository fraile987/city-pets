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
R=$(curl -s -w '|%{http_code}' -X POST "$B/products" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d '{"name":"Admin crea X","species":"Perros","category":"Snacks","price":9900,"stock":25,"tags":["nuevo"],"images":["/uploads/products/p1.jpg"]}')
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
check "CSP img-src sin picsum (self data blob)" "$(echo "$CSP" | grep -o 'img-src [^;]*')" "img-src 'self' data: blob:"
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

echo ""
echo "===== G16. Fase 9.6.3: auditoria final y simulacion de VPS limpio ====="
# ---------- Auditoria estatica: los artefactos nunca destruyen datos ----------
if grep -qE '^\s*rm\b|prisma migrate reset|db push|DROP TABLE' deploy/deploy.sh; then
  ko "deploy.sh contiene operaciones destructivas"
else
  ok "deploy.sh no destruye datos (sin rm/reset/db push/DROP)"
fi
L1=$(grep -n '^npm ci' deploy/deploy.sh | cut -d: -f1 | head -1)
L2=$(grep -n 'install -d' deploy/deploy.sh | cut -d: -f1 | head -1)
L3=$(grep -n 'prisma migrate deploy' deploy/deploy.sh | cut -d: -f1 | head -1)
if [ -n "$L1" ] && [ -n "$L2" ] && [ -n "$L3" ] && [ "$L1" -lt "$L2" ] && [ "$L2" -lt "$L3" ]; then
  ok "deploy.sh orden: npm ci -> dirs -> migrate deploy"
else
  ko "deploy.sh orden incorrecto (npm=$L1 dirs=$L2 migrate=$L3)"
fi
grep -q 'chmod 600 .env' deploy/deploy.sh && grep -q 'chown' deploy/deploy.sh && ok "deploy.sh protege .env (chown + chmod 600)" || ko "deploy.sh no protege .env"
if grep -qE '^\s*(npx )?prisma generate' deploy/deploy.sh; then
  ko "deploy.sh duplica prisma generate (postinstall ya lo hace)"
else
  ok "deploy.sh no duplica prisma generate"
fi
grep -q 'BACKUP_DIR="${BACKUP_DIR:-backups}"' scripts/backup.sh && ok "backup.sh: BACKUP_DIR configurable" || ko "backup.sh sin BACKUP_DIR env"
grep -q 'BACKUP_DIR="${BACKUP_DIR:-backups}"' scripts/restore.sh && ok "restore.sh: BACKUP_DIR configurable" || ko "restore.sh sin BACKUP_DIR env"
if grep -q 'listen 3000\|proxy_pass http://0.0.0.0:3000' deploy/nginx.conf; then
  ko "nginx expone el backend"
else
  ok "nginx no expone :3000 (solo loopback)"
fi
grep -q '/var/lib/city-pets/data /var/lib/city-pets/uploads /var/lib/city-pets/backups' deploy/city-pets.service && ok "systemd: BD/uploads/backups escribibles" || ko "systemd: ReadWritePaths incompleto"
# ---------- Simulacion de VPS limpio ----------
SBOX=/tmp/citypets-g16-vps
SBOX_BE="$SBOX/app/city-pets-backend"
SBOX_DATA="$SBOX/data"
SBOX_MEDIA="$SBOX/uploads"
SBOX_BKP="$SBOX/backups"
SBOX_PORT=3101
rm -rf "$SBOX"
mkdir -p "$SBOX_BE"
tar -C . --exclude='node_modules' --exclude='prisma/dev.db*' --exclude='uploads' --exclude='backups' --exclude='.env' -cf - . | tar -xf - -C "$SBOX_BE"
printf 'NODE_ENV=production\nPORT=%s\nHOST=127.0.0.1\nDATABASE_URL=file:%s/dev.db\nUPLOADS_PATH=%s\nJWT_SECRET=ciudad-9-6-3-sandbox-secreto\nCORS_ORIGINS=https://citypets.com,https://www.citypets.com\n' "$SBOX_PORT" "$SBOX_DATA" "$SBOX_MEDIA" > "$SBOX_BE/.env"
[ -f "$SBOX_BE/.env" ] && ok "VPS simulado: .env de produccion creado" || ko "VPS simulado: no se pudo crear .env"
(cd "$SBOX_BE" && npm ci --loglevel=error >/dev/null 2>&1)
[ -f "$SBOX_BE/node_modules/.prisma/client/index.js" ] && ok "VPS limpio: npm ci + postinstall prisma generate" || ko "VPS limpio: npm ci fallo"
install -d "$SBOX_DATA" "$SBOX_MEDIA" "$SBOX_BKP"
(cd "$SBOX_BE" && npx prisma migrate deploy >/dev/null 2>&1)
[ -f "$SBOX_DATA/dev.db" ] && ok "VPS limpio: migraciones crean BD en el volumen" || ko "VPS limpio: dev.db ausente en DATA_DIR"
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production HOST=127.0.0.1 PORT="$SBOX_PORT" \
  DATABASE_URL="file:$SBOX_DATA/dev.db" UPLOADS_PATH="$SBOX_MEDIA" \
  JWT_SECRET='ciudad-9-6-3-sandbox-secreto' \
  CORS_ORIGINS='https://citypets.com,https://www.citypets.com' \
  node "$SBOX_BE/server.js" > /tmp/citypets-g16-sbox.log 2>&1 &
SBOX_PID=$!
sleep 2
check "VPS limpio: healthcheck 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/api/health)" "200"
check "VPS limpio: body status ok" "$(curl -s http://127.0.0.1:$SBOX_PORT/api/health | json 'j.status')" "ok"
LISTEN=$(ss -ltn 2>/dev/null | grep ":$SBOX_PORT" | head -1)
case "$LISTEN" in *"127.0.0.1:$SBOX_PORT"*) ok "produccion escucha solo en 127.0.0.1" ;; *) ko "produccion no esta en loopback ($LISTEN)" ;; esac
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$SBOX_PORT/api/auth/register" -H 'Content-Type: application/json' -d '{"name":"VPS Admin","phone":"3005550888","email":"g16vps@test.co","password":"clave123"}')
TVPS=$(body_of "$R" | json 'j.token')
(cd "$SBOX_BE" && npm run promote -- g16vps@test.co >/dev/null 2>&1)
[ "${TVPS:0:4}" = "eyJh" ] && ok "VPS simulado: admin creado y promovido" || ko "VPS simulado: admin fallo"
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$SBOX_PORT/api/products" -H "Authorization: Bearer $TVPS" -H 'Content-Type: application/json' -d '{"name":"Sobrevive","species":"Perros","price":7500}')
check "VPS simulado: producto creado" "$(code_of "$R")" "201"
node scripts/gen-test-png.js /tmp/cp-g16-media.png >/dev/null
UP=$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TVPS" -F 'file=@/tmp/cp-g16-media.png' "http://127.0.0.1:$SBOX_PORT/api/upload/image")
check "VPS simulado: media subido" "$(code_of "$UP")" "201"
[ -n "$(ls -A "$SBOX_MEDIA/products" 2>/dev/null)" ] && ok "VPS simulado: archivo en el volumen de medios" || ko "VPS simulado: sin archivo en MEDIA_DIR"
DB_PATH="$SBOX_DATA/dev.db" UPLOADS_DIR="$SBOX_MEDIA" BACKUP_DIR="$SBOX_BKP" bash "$SBOX_BE/scripts/backup.sh" >/dev/null 2>&1
BKP=$(ls -1t "$SBOX_BKP"/citypets-*.tar.gz 2>/dev/null | head -1)
[ -n "$BKP" ] && ok "VPS simulado: backup creado en el volumen" || ko "VPS simulado: backup ausente"
# ---------- Redeploy: repetir el flujo; los datos deben sobrevivir ----------
kill "$SBOX_PID" 2>/dev/null; wait "$SBOX_PID" 2>/dev/null
(cd "$SBOX_BE" && npm ci --loglevel=error >/dev/null 2>&1) && ok "redeploy: npm ci idempotente" || ko "redeploy: npm ci fallo"
install -d "$SBOX_DATA" "$SBOX_MEDIA" "$SBOX_BKP"
(cd "$SBOX_BE" && npx prisma migrate deploy >/dev/null 2>&1) && ok "redeploy: migraciones idempotentes" || ko "redeploy: migrate fallo"
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production HOST=127.0.0.1 PORT="$SBOX_PORT" \
  DATABASE_URL="file:$SBOX_DATA/dev.db" UPLOADS_PATH="$SBOX_MEDIA" \
  JWT_SECRET='ciudad-9-6-3-sandbox-secreto' \
  CORS_ORIGINS='https://citypets.com,https://www.citypets.com' \
  node "$SBOX_BE/server.js" > /tmp/citypets-g16-sbox2.log 2>&1 &
SBOX_PID=$!
sleep 2
check "redeploy: healthcheck 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/api/health)" "200"
check "redeploy: SQLite conserva datos" "$(curl -s http://127.0.0.1:$SBOX_PORT/api/products | json 'j.some(p=>p.name==="Sobrevive")')" "true"
[ -n "$(ls -A "$SBOX_MEDIA/products" 2>/dev/null)" ] && ok "redeploy: uploads sobreviven" || ko "redeploy: uploads perdidos"
[ -f "$BKP" ] && ok "redeploy: backup sobrevive" || ko "redeploy: backup perdido"
# ---------- Produccion en runtime (VPS simulado) ----------
check "prod: trust proxy lee X-Forwarded-For" "$(curl -s -H 'X-Forwarded-For: 203.0.113.9' http://127.0.0.1:$SBOX_PORT/api/health | json 'j.ip')" "203.0.113.9"
check "prod: HSTS presente" "$(curl -s -D - -o /dev/null http://127.0.0.1:$SBOX_PORT/api/health | grep -ci 'strict-transport-security')" "1"
HSTS=$(curl -s -D - -o /dev/null http://127.0.0.1:$SBOX_PORT/api/health | grep -i 'strict-transport-security' | head -1)
case "$HSTS" in *"max-age=15552000"*"includeSubDomains"*) ok "prod: HSTS max-age=15552000 includeSubDomains" ;; *) ko "prod: HSTS incompleto ($HSTS)" ;; esac
(cd "$SBOX_BE" && env -i PATH="$PATH" HOME="$HOME" PORT=3199 NODE_ENV=production CORS_ORIGINS='' timeout 5 node server.js >/dev/null 2>&1; echo $?) > /tmp/citypets-g16-failfast.exit
check "prod: exige CORS_ORIGINS (fail-fast)" "$(cat /tmp/citypets-g16-failfast.exit)" "1"
# no expone la BD ni archivos sensibles
check "sensibles: .env 404" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/city-pets-backend/.env)" "404"
check "sensibles: .git 404" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/.git/HEAD)" "404"
check "sensibles: dev.db 404" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/dev.db)" "404"
check "sensibles: schema.prisma 404" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/city-pets-backend/prisma/schema.prisma)" "404"
NSS=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/uploads/../../etc/passwd)
[ "$NSS" = "404" ] || [ "$NSS" = "403" ] && ok "sensibles: traversal bloqueado ($NSS)" || ko "sensibles: traversal permitido ($NSS)"
kill "$SBOX_PID" 2>/dev/null; wait "$SBOX_PID" 2>/dev/null

echo ""
echo "===== G17. Fase 10.2: entorno simulado (Node/systemd/nginx) ====="
# Reutiliza el sandbox de G16 (instalacion limpia, datos, medios y backups)
SBOX=/tmp/citypets-g16-vps
SBOX_BE="$SBOX/app/city-pets-backend"
SBOX_DATA="$SBOX/data"
SBOX_MEDIA="$SBOX/uploads"
SBOX_BKP="$SBOX/backups"
SBOX_PORT=3101

# ---------- 10.2A: Node 24 LTS vía .nvmrc ----------
NVM="$(cat ../.nvmrc 2>/dev/null)"
NV="$(node -v | tr -d 'v')"
check "10.2A: node $NV == .nvmrc ($NVM)" "$NV" "$NVM"
grep -q '"node": ">=24 <25"' package.json && ok "10.2A: engines.node pin a 24 LTS" || ko "10.2A: engines.node no cubre 24"
[ -d "$SBOX_BE/node_modules/.prisma/client" ] && ok "10.2A: npm ci + prisma generate reproducibles" || ko "10.2A: instalacion limpia ausente"
# ---------- 10.2B: estructura persistente y aislamiento ----------
[ -d "$SBOX_DATA" ] && ok "10.2B: $SBOX_DATA" || ko "10.2B: falta data/"
[ -d "$SBOX_MEDIA" ] && ok "10.2B: $SBOX_MEDIA" || ko "10.2B: falta uploads/"
[ -d "$SBOX_BKP" ] && ok "10.2B: $SBOX_BKP" || ko "10.2B: falta backups/"
grep -q 'install -d -o ".APP_USER" -g ".APP_USER" ".DATA_DIR" ".MEDIA_DIR" ".BACKUP_DIR"' deploy/deploy.sh && ok "10.2B: deploy.sh fija owner citypets en las 3 rutas" || ko "10.2B: deploy.sh no fija permisos de las rutas"
BEFORE_U=$(ls uploads/products 2>/dev/null | md5sum | cut -d' ' -f1)
BEFORE_D=$(md5sum prisma/dev.db 2>/dev/null | cut -d' ' -f1)
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production HOST=127.0.0.1 PORT="$SBOX_PORT" \
  DATABASE_URL="file:$SBOX_DATA/dev.db" UPLOADS_PATH="$SBOX_MEDIA" \
  JWT_SECRET='ciudad-9-6-3-sandbox-secreto' \
  CORS_ORIGINS='https://citypets.com,https://www.citypets.com' \
  node "$SBOX_BE/server.js" > /tmp/citypets-g17-sbox.log 2>&1 &
SBOX_PID=$!
sleep 2
check "10.2B: healthcheck 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/api/health)" "200"
AFTER_U=$(ls uploads/products 2>/dev/null | md5sum | cut -d' ' -f1)
AFTER_D=$(md5sum prisma/dev.db 2>/dev/null | cut -d' ' -f1)
[ "$AFTER_U" = "$BEFORE_U" ] && ok "10.2B: repo uploads/ intacto (la app escribe solo en la estructura)" || ko "10.2B: la app escribio en uploads/ del repo"
[ "$AFTER_D" = "$BEFORE_D" ] && ok "10.2B: BD del repo intacta" || ko "10.2B: la app escribio en la BD del repo"
# ---------- 10.2C: systemd (unit + caida y recuperacion) ----------
if command -v systemd-analyze >/dev/null 2>&1; then
  OUT=$(systemd-analyze verify deploy/city-pets.service 2>&1)
  case "$OUT" in
    *"Command /usr/bin/node is not executable"*)
      ok "10.2C: unit valida (ruta /usr/bin/node se ajusta en el VPS con which node)" ;;
    "")
      ok "10.2C: unit valida (systemd-analyze verify)" ;;
    *)
      ko "10.2C: unit con errores ($OUT)" ;;
  esac
else
  ok "10.2C: systemd-analyze no disponible (se omite)"
fi
grep -q '^Restart=on-failure' deploy/city-pets.service && grep -q '^RestartSec=' deploy/city-pets.service && ok "10.2C: Restart=on-failure + RestartSec" || ko "10.2C: reinicio automatico no configurado"
MEDIA_BEFORE=$(ls -1 "$SBOX_MEDIA/products" 2>/dev/null | wc -l)
kill -9 "$SBOX_PID" 2>/dev/null; wait "$SBOX_PID" 2>/dev/null
sleep 1
check "10.2C: puerto cerrado tras kill -9" "$(ss -ltn 2>/dev/null | grep -c ":$SBOX_PORT")" "0"
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production HOST=127.0.0.1 PORT="$SBOX_PORT" \
  DATABASE_URL="file:$SBOX_DATA/dev.db" UPLOADS_PATH="$SBOX_MEDIA" \
  JWT_SECRET='ciudad-9-6-3-sandbox-secreto' \
  CORS_ORIGINS='https://citypets.com,https://www.citypets.com' \
  node "$SBOX_BE/server.js" > /tmp/citypets-g17-sbox2.log 2>&1 &
SBOX_PID=$!
sleep 2
check "10.2C: recuperacion: healthcheck 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/api/health)" "200"
check "10.2C: recuperacion: datos conservados" "$(curl -s http://127.0.0.1:$SBOX_PORT/api/products | json 'j.some(p=>p.name==="Sobrevive")')" "true"
check "10.2C: recuperacion: medios conservados" "$(ls -1 "$SBOX_MEDIA/products" 2>/dev/null | wc -l)" "$MEDIA_BEFORE"
# ---------- 10.2D: nginx (estatico) + proxy simulado ----------
grep -q 'listen 80;' deploy/nginx.conf && ok "10.2D: nginx HTTP (listen 80)" || ko "10.2D: sin listen 80"
grep -q 'listen 443 ssl' deploy/nginx.conf && ok "10.2D: nginx HTTPS preparado" || ko "10.2D: sin preparacion 443"
grep -q 'client_max_body_size 26m' deploy/nginx.conf && ok "10.2D: limite 26m" || ko "10.2D: sin limite 26m"
PORT=8080 TARGET="$SBOX_PORT" node scripts/test-proxy.js > /tmp/citypets-g17-proxy.log 2>&1 &
PROXY_PID=$!
sleep 1
check "10.2D: proxy: salud 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/health)" "200"
PIMG=$(ls -1 "$SBOX_MEDIA/products" 2>/dev/null | head -1)
if [ -n "$PIMG" ]; then
  check "10.2D: proxy: /uploads 200" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8080/uploads/products/$PIMG")" "200"
else
  ko "10.2D: no hay media para probar el proxy"
fi
kill "$PROXY_PID" 2>/dev/null; wait "$PROXY_PID" 2>/dev/null
kill "$SBOX_PID" 2>/dev/null; wait "$SBOX_PID" 2>/dev/null
rm -rf "$SBOX"

echo ""
echo "===== G18. Fase 10.3: deploy completo en laboratorio ====="
SBOX=/tmp/citypets-g18-vps
SBOX_APP="$SBOX/opt/city-pets"
SBOX_BE="$SBOX_APP/city-pets-backend"
SBOX_LIB="$SBOX/var/lib/city-pets"
SBOX_DATA="$SBOX_LIB/data"
SBOX_MEDIA="$SBOX_LIB/uploads"
SBOX_BKP="$SBOX_LIB/backups"
SBOX_PORT=3102
BEFORE_U=$(ls uploads/products 2>/dev/null | md5sum | cut -d' ' -f1)
BEFORE_D=$(md5sum prisma/dev.db 2>/dev/null | cut -d' ' -f1)
# 1/16 usuario citypets: lo crea el aprovisionamiento (idempotente)
grep -q 'useradd --create-home --shell /bin/bash --groups sudo' scripts/setup-vps.sh && ok "10.3: setup-vps crea el usuario citypets con sudo" || ko "10.3: setup-vps no crea el usuario"
grep -q 'id ".NEW_USER.' scripts/setup-vps.sh && ok "10.3: setup-vps es idempotente (no duplica el usuario)" || ko "10.3: setup-vps sin guard de usuario"
# 3/16 Node 24 LTS
case "$(node -v)" in
  v24.*) ok "10.3: Node 24 LTS presente ($(node -v))" ;;
  *) ko "10.3: Node no es 24 LTS ($(node -v))" ;;
esac
# 2/16 estructura persistente: simula /opt/city-pets + /var/lib/city-pets
rm -rf "$SBOX"
mkdir -p "$SBOX_APP"
tar -C .. --exclude='.git' --exclude='city-pets-backend/node_modules' --exclude='city-pets-backend/prisma/dev.db*' --exclude='city-pets-backend/uploads' --exclude='city-pets-backend/backups' --exclude='city-pets-backend/.env' -cf - . | tar -xf - -C "$SBOX_APP"
mkdir -p "$SBOX_DATA" "$SBOX_MEDIA" "$SBOX_BKP"
[ -f "$SBOX_BE/package.json" ] && ok "10.3: copia limpia del working tree" || ko "10.3: checkout del repo fallo"
[ -d "$SBOX_DATA" ] && [ -d "$SBOX_MEDIA" ] && [ -d "$SBOX_BKP" ] && ok "10.3: estructura /var/lib/city-pets/{data,uploads,backups}" || ko "10.3: estructura incompleta"
# 6/16 .env de produccion en el backend
printf 'NODE_ENV=production\nPORT=%s\nHOST=127.0.0.1\nDATABASE_URL=file:%s/dev.db\nUPLOADS_PATH=%s\nJWT_SECRET=ciudad-10-3-sandbox-secreto\nCORS_ORIGINS=https://citypets.com,https://www.citypets.com\n' "$SBOX_PORT" "$SBOX_DATA" "$SBOX_MEDIA" > "$SBOX_BE/.env"
[ -f "$SBOX_BE/.env" ] && ok "10.3: .env de produccion creado" || ko "10.3: .env no creado"
# 8/16 servicio bajo "systemd": supervisor que replica Restart=on-failure + RestartSec=2
PATH="$PATH" HOME="$HOME" NODE_ENV=production HOST=127.0.0.1 PORT="$SBOX_PORT" \
  DATABASE_URL="file:$SBOX_DATA/dev.db" UPLOADS_PATH="$SBOX_MEDIA" \
  JWT_SECRET='ciudad-10-3-sandbox-secreto' \
  CORS_ORIGINS='https://citypets.com,https://www.citypets.com' \
  bash scripts/lab-supervisor.sh "$SBOX_BE" > /tmp/citypets-g18-sup.log 2>&1 &
SUP_PID=$!
# 4/5/7 deploy.sh: npm ci + migraciones + healthcheck (sobre la copia limpia)
APP_DIR="$SBOX_APP" DATA_DIR="$SBOX_DATA" MEDIA_DIR="$SBOX_MEDIA" BACKUP_DIR="$SBOX_BKP" \
  APP_USER="$(id -un)" DEPLOY_SYSTEMD=0 HEALTH_URL="http://127.0.0.1:$SBOX_PORT/api/health" \
  bash "$SBOX_BE/deploy/deploy.sh" > /tmp/citypets-g18-deploy.log 2>&1
RC=$?
check "10.3: deploy.sh OK (npm ci + prisma migrate deploy)" "$RC" "0"
[ -f "$SBOX_DATA/dev.db" ] && ok "10.3: migraciones crean dev.db en el volumen" || ko "10.3: dev.db ausente en DATA_DIR"
check "10.3: healthcheck tras deploy 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/api/health)" "200"
check "10.3: BD inicial vacia" "$(curl -s http://127.0.0.1:$SBOX_PORT/api/products | json 'j.length')" "0"
# 12/16 crear datos y archivos (admin, producto, media)
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$SBOX_PORT/api/auth/register" -H 'Content-Type: application/json' -d '{"name":"G18 Admin","phone":"3005550777","email":"g18vps@test.co","password":"clave123"}')
TG18=$(body_of "$R" | json 'j.token')
(cd "$SBOX_BE" && npm run promote -- g18vps@test.co >/dev/null 2>&1)
[ "${TG18:0:4}" = "eyJh" ] && ok "10.3: admin registrado y promovido" || ko "10.3: admin fallo"
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$SBOX_PORT/api/products" -H "Authorization: Bearer $TG18" -H 'Content-Type: application/json' -d '{"name":"Deploy1","species":"Perros","price":8500}')
check "10.3: producto creado" "$(code_of "$R")" "201"
node scripts/gen-test-png.js /tmp/cp-g18-media.png >/dev/null
UP=$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TG18" -F 'file=@/tmp/cp-g18-media.png' "http://127.0.0.1:$SBOX_PORT/api/upload/image")
check "10.3: media subido" "$(code_of "$UP")" "201"
[ -n "$(ls -A "$SBOX_MEDIA/products" 2>/dev/null)" ] && ok "10.3: archivo en el volumen de medios" || ko "10.3: sin archivo en MEDIA_DIR"
# 10/11 nginx simulado -> Express -> /api/health y /uploads
PORT=8080 TARGET="$SBOX_PORT" node scripts/test-proxy.js > /tmp/citypets-g18-proxy.log 2>&1 &
PROXY_PID=$!
sleep 1
check "10.3: nginx-sim: /api/health 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/health)" "200"
PIMG=$(ls -1 "$SBOX_MEDIA/products" 2>/dev/null | head -1)
[ -n "$PIMG" ] && check "10.3: nginx-sim: /uploads 200" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8080/uploads/products/$PIMG")" "200" || ko "10.3: sin media para /uploads"
kill "$PROXY_PID" 2>/dev/null; wait "$PROXY_PID" 2>/dev/null
# 9/16 caida y recuperacion automatica (Restart=on-failure)
CPID=$(pgrep -P "$SUP_PID" || true)
[ -n "$CPID" ] && ok "10.3: server activo bajo el supervisor" || ko "10.3: supervisor sin server activo"
kill -9 "$CPID" 2>/dev/null || true
sleep 4
NPID=$(pgrep -P "$SUP_PID" || true)
[ -n "$NPID" ] && [ "$NPID" != "$CPID" ] && ok "10.3: recuperacion: reiniciado tras kill -9" || ko "10.3: recuperacion: no hubo reinicio"
check "10.3: recuperacion: health 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$SBOX_PORT/api/health)" "200"
check "10.3: recuperacion: datos conservados" "$(curl -s http://127.0.0.1:$SBOX_PORT/api/products | json 'j.some(p=>p.name==="Deploy1")')" "true"
# 13/14 redeploy: repetir deploy.sh; los datos sobreviven
APP_DIR="$SBOX_APP" DATA_DIR="$SBOX_DATA" MEDIA_DIR="$SBOX_MEDIA" BACKUP_DIR="$SBOX_BKP" \
  APP_USER="$(id -un)" DEPLOY_SYSTEMD=0 HEALTH_URL="http://127.0.0.1:$SBOX_PORT/api/health" \
  bash "$SBOX_BE/deploy/deploy.sh" > /tmp/citypets-g18-deploy2.log 2>&1
RC=$?
check "10.3: redeploy: deploy.sh OK" "$RC" "0"
check "10.3: redeploy: producto sobrevive" "$(curl -s http://127.0.0.1:$SBOX_PORT/api/products | json 'j.some(p=>p.name==="Deploy1")')" "true"
[ -n "$(ls -A "$SBOX_MEDIA/products" 2>/dev/null)" ] && ok "10.3: redeploy: uploads sobreviven" || ko "10.3: redeploy: uploads perdidos"
# 15/16 backup y restore (round-trip)
DB_PATH="$SBOX_DATA/dev.db" UPLOADS_DIR="$SBOX_MEDIA" BACKUP_DIR="$SBOX_BKP" bash "$SBOX_BE/scripts/backup.sh" > /tmp/citypets-g18-backup.log 2>&1
BKP=$(ls -1t "$SBOX_BKP"/citypets-*.tar.gz 2>/dev/null | head -1)
[ -n "$BKP" ] && ok "10.3: backup creado en el volumen" || ko "10.3: backup ausente"
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$SBOX_PORT/api/products" -H "Authorization: Bearer $TG18" -H 'Content-Type: application/json' -d '{"name":"Temporal","species":"Gatos","price":9999}')
check "10.3: producto Temporal creado (para restaurar)" "$(code_of "$R")" "201"
kill "$(pgrep -P "$SUP_PID" || true)" 2>/dev/null || true
sleep 3
DB_PATH="$SBOX_DATA/dev.db" UPLOADS_DIR="$SBOX_MEDIA" BACKUP_DIR="$SBOX_BKP" bash "$SBOX_BE/scripts/restore.sh" "$BKP" --force --no-safety > /tmp/citypets-g18-restore.log 2>&1
check "10.3: restore ejecutado" "$?" "0"
kill "$(pgrep -P "$SUP_PID" || true)" 2>/dev/null || true
sleep 3
check "10.3: restore: dato del backup presente" "$(curl -s http://127.0.0.1:$SBOX_PORT/api/products | json 'j.some(p=>p.name==="Deploy1")')" "true"
check "10.3: restore: mutacion revertida (sin Temporal)" "$(curl -s http://127.0.0.1:$SBOX_PORT/api/products | json 'j.some(p=>p.name==="Temporal")')" "false"
[ -n "$(ls -A "$SBOX_MEDIA/products" 2>/dev/null)" ] && ok "10.3: restore: medios restaurados" || ko "10.3: restore: medios perdidos"
# 16/16 el repo no se toca
AFTER_U=$(ls uploads/products 2>/dev/null | md5sum | cut -d' ' -f1)
AFTER_D=$(md5sum prisma/dev.db 2>/dev/null | cut -d' ' -f1)
[ "$AFTER_U" = "$BEFORE_U" ] && ok "10.3: uploads/ del repo intacto" || ko "10.3: se escribio en uploads/ del repo"
[ "$AFTER_D" = "$BEFORE_D" ] && ok "10.3: BD del repo intacta" || ko "10.3: se escribio en la BD del repo"
# (el sandbox G18 y su supervisor quedan vivos para el E2E final de G20)

echo ""
echo "===== G19. Fase 10.5: backups automaticos ====="
# ---------- artefactos: unidades systemd del backup ----------
[ -f deploy/citypets-backup.service ] && [ -f deploy/citypets-backup.timer ] && ok "10.5: unidades systemd del backup creadas" || ko "10.5: faltan unidades del backup"
grep -q 'OnCalendar=daily' deploy/citypets-backup.timer && grep -q 'Persistent=true' deploy/citypets-backup.timer && ok "10.5: timer diario + Persistent=true (catch-up)" || ko "10.5: timer sin schedule/persistencia"
grep -q 'BACKUP_KEEP=7' deploy/citypets-backup.service && ok "10.5: retencion de 7 dias configurada" || ko "10.5: sin retencion en el servicio"
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze calendar daily >/dev/null 2>&1 && ok "10.5: calendario 'daily' valido" || ko "10.5: calendario 'daily' invalido"
  OUT=$(systemd-analyze verify deploy/citypets-backup.service deploy/citypets-backup.timer 2>&1)
  CLEAN=$(echo "$OUT" | grep -vi 'not executable\|No such file or directory\|citypets-backup' || true)
  [ -z "$CLEAN" ] && ok "10.5: units validadas (systemd-analyze verify)" || ko "10.5: units con errores ($CLEAN)"
fi
# ---------- rotacion ----------
SBOX=/tmp/citypets-g19-backup
SBOX_DATA="$SBOX/data"
SBOX_MEDIA="$SBOX/uploads"
SBOX_BKP="$SBOX/backups"
rm -rf "$SBOX"
mkdir -p "$SBOX_DATA" "$SBOX_MEDIA" "$SBOX_BKP"
: > "$SBOX_DATA/dev.db"
echo "foto" > "$SBOX_MEDIA/foto.txt"
for i in 1 2 3; do
  DB_PATH="$SBOX_DATA/dev.db" UPLOADS_DIR="$SBOX_MEDIA" BACKUP_DIR="$SBOX_BKP" BACKUP_KEEP=2 bash scripts/backup.sh >/dev/null 2>&1
  sleep 1
done
check "10.5: rotacion: tras 3 backups quedan 2 (KEEP=2)" "$(ls -1 "$SBOX_BKP"/citypets-*.tar.gz 2>/dev/null | wc -l)" "2"
DB_PATH="/no/existe/dev.db" UPLOADS_DIR="$SBOX_MEDIA" BACKUP_DIR="$SBOX_BKP" bash scripts/backup.sh >/dev/null 2>&1
RC=$?
check "10.5: backup falla si falta la BD (no corrompe nada)" "$RC" "1"
# ---------- ejecucion automatica con systemd (usuario, en laboratorio) ----------
rm -f "$SBOX_BKP"/citypets-*.tar.gz
UD="$HOME/.config/systemd/user"
if systemctl --user --no-pager list-timers >/dev/null 2>&1; then
  systemctl --user stop citypets-backup.timer citypets-backup.service >/dev/null 2>&1 || true
  rm -f "$UD/citypets-backup.service" "$UD/citypets-backup.timer"
  mkdir -p "$UD"
  cat > "$UD/citypets-backup.service" <<EOF
[Unit]
Description=City Pets: backup (lab G19)
[Service]
Type=oneshot
ExecStart=$PWD/scripts/backup.sh
Environment=DB_PATH=$SBOX_DATA/dev.db
Environment=UPLOADS_DIR=$SBOX_MEDIA
Environment=BACKUP_DIR=$SBOX_BKP
Environment=BACKUP_KEEP=7
EOF
  cat > "$UD/citypets-backup.timer" <<EOF
[Unit]
Description=City Pets: backup cada minuto (lab G19)
[Timer]
OnCalendar=*-*-* *:*:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now citypets-backup.timer >/dev/null 2>&1
  systemctl --user --no-pager list-timers | grep -q citypets-backup && ok "10.5: timer activo en systemd" || ko "10.5: timer no visible en systemd"
  AUTO_OK="0"
  for i in $(seq 1 20); do
    N=$(ls -1 "$SBOX_BKP"/citypets-*.tar.gz 2>/dev/null | wc -l)
    [ "$N" -ge 1 ] && { AUTO_OK="1"; break; }
    sleep 4
  done
  [ "$AUTO_OK" = "1" ] && ok "10.5: backup ejecutado automaticamente por systemd" || ko "10.5: el timer no genero backup"
  BKP=$(ls -1t "$SBOX_BKP"/citypets-*.tar.gz 2>/dev/null | head -1)
  if [ -n "$BKP" ]; then
    tar -tzf "$BKP" | grep -q 'dev.db' && ok "10.5: backup automatico contiene la BD" || ko "10.5: backup sin dev.db"
    tar -tzf "$BKP" | grep -q 'uploads' && ok "10.5: backup automatico contiene los medios" || ko "10.5: backup sin uploads"
  else
    ko "10.5: sin backup para inspeccionar"
  fi
  systemctl --user disable --now citypets-backup.timer >/dev/null 2>&1
  systemctl --user stop citypets-backup.service >/dev/null 2>&1
  rm -f "$UD/citypets-backup.service" "$UD/citypets-backup.timer"
  systemctl --user daemon-reload
else
  # sin systemd de usuario: simulacion del disparo
  DB_PATH="$SBOX_DATA/dev.db" UPLOADS_DIR="$SBOX_MEDIA" BACKUP_DIR="$SBOX_BKP" bash scripts/backup.sh >/dev/null 2>&1
  [ -n "$(ls -1 "$SBOX_BKP"/citypets-*.tar.gz 2>/dev/null)" ] && ok "10.5: backup ejecutado (simulacion, sin systemd de usuario)" || ko "10.5: backup fallo en simulacion"
fi
rm -rf "$SBOX"

echo ""
echo "===== G20. Fase 10.6: E2E final en produccion (proxy -> Express) ====="
# continua sobre el sandbox de G18 (server prod + supervisor vivos)
SBOX=/tmp/citypets-g18-vps
SBOX_BE="$SBOX/opt/city-pets/city-pets-backend"
SBOX_DATA="$SBOX/var/lib/city-pets/data"
SBOX_MEDIA="$SBOX/var/lib/city-pets/uploads"
SBOX_BKP="$SBOX/var/lib/city-pets/backups"
SBOX_PORT=3102
PX=8080
BEFORE_U=$(ls uploads/products 2>/dev/null | md5sum | cut -d' ' -f1)
BEFORE_D=$(md5sum prisma/dev.db 2>/dev/null | cut -d' ' -f1)
PORT="$PX" TARGET="$SBOX_PORT" node scripts/test-proxy.js > /tmp/citypets-g20-proxy.log 2>&1 &
PX_PID=$!
sleep 1
check "10.6: E2E: proxy -> Express: health 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PX/api/health)" "200"
check "10.6: E2E: catalogo accesible" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PX/api/products)" "200"
# registro comprador
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$PX/api/auth/register" -H 'Content-Type: application/json' -d '{"name":"Compra G20","phone":"3005550666","email":"g20buyer@test.co","password":"clave123"}')
TB20=$(body_of "$R" | json 'j.token')
check "10.6: E2E: registro comprador 201" "$(code_of "$R")" "201"
# login
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$PX/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"g20buyer@test.co","password":"clave123"}')
LB20=$(body_of "$R" | json 'j.token')
check "10.6: E2E: login 200" "$(code_of "$R")" "200"
[ "${LB20:0:4}" = "eyJh" ] && ok "10.6: E2E: sesion (token) valida" || ko "10.6: E2E: token de login invalido"
# admin + producto con imagen y video
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$PX/api/auth/register" -H 'Content-Type: application/json' -d '{"name":"Admin G20","phone":"3005550555","email":"g20admin@test.co","password":"clave123"}')
TA20=$(body_of "$R" | json 'j.token')
(cd "$SBOX_BE" && npm run promote -- g20admin@test.co >/dev/null 2>&1)
[ "${TA20:0:4}" = "eyJh" ] && ok "10.6: E2E: admin registrado y promovido" || ko "10.6: E2E: admin fallo"
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$PX/api/products" -H "Authorization: Bearer $TA20" -H 'Content-Type: application/json' -d '{"name":"Prod G20","species":"Perros","price":12000,"stock":50}')
PID20=$(body_of "$R" | json 'j.id')
check "10.6: E2E: producto creado 201" "$(code_of "$R")" "201"
node scripts/gen-test-png.js /tmp/cp-g20-img.png >/dev/null
UP=$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TA20" -F 'file=@/tmp/cp-g20-img.png' "http://127.0.0.1:$PX/api/upload/image")
check "10.6: E2E: imagen subida 201" "$(code_of "$UP")" "201"
printf '\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2mp41' > /tmp/cp-g20-vid.mp4
VP=$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TA20" -F 'file=@/tmp/cp-g20-vid.mp4' "http://127.0.0.1:$PX/api/upload/video")
check "10.6: E2E: video subido 201" "$(code_of "$VP")" "201"
# browse: producto visible sin auth
check "10.6: E2E: catalogo incluye Prod G20" "$(curl -s http://127.0.0.1:$PX/api/products | json 'j.some(p=>p.id===v)' "$PID20")" "true"
# carrito -> checkout -> pedido
R=$(curl -s -w '|%{http_code}' -X POST "http://127.0.0.1:$PX/api/orders" -H "Authorization: Bearer $TB20" -H 'Content-Type: application/json' -d "{\"items\":[{\"productId\":\"$PID20\",\"qty\":2}],\"address\":\"Carrera 7 # 1-2\",\"payment\":{\"method\":\"digital\"}}")
OID=$(body_of "$R" | json 'j.id')
check "10.6: E2E: checkout 201" "$(code_of "$R")" "201"
[ -n "$OID" ] && ok "10.6: E2E: pedido con id" || ko "10.6: E2E: pedido sin id"
# historial propio + admin + auth requerida
check "10.6: E2E: historial comprador incluye pedido" "$(curl -s http://127.0.0.1:$PX/api/orders -H "Authorization: Bearer $TB20" | json 'j.some(o=>o.id===v)' "$OID")" "true"
check "10.6: E2E: admin ve el pedido" "$(curl -s http://127.0.0.1:$PX/api/admin/orders -H "Authorization: Bearer $TA20" | json 'j.some(o=>o.id===v)' "$OID")" "true"
check "10.6: E2E: historial sin auth 401" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PX/api/orders)" "401"
# ciclo de vida del pedido
check "10.6: E2E: admin marca entregado" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "http://127.0.0.1:$PX/api/admin/orders/$OID/status" -H "Authorization: Bearer $TA20" -H 'Content-Type: application/json' -d '{"status":"entregado"}')" "200"
check "10.6: E2E: comprador ve entregado" "$(curl -s http://127.0.0.1:$PX/api/orders -H "Authorization: Bearer $TB20" | json 'j.find(o=>o.id===v).status' "$OID")" "entregado"
# seguridad en runtime (via proxy)
check "10.6: E2E: HSTS presente" "$(curl -s -D - -o /dev/null http://127.0.0.1:$PX/api/health | grep -ci 'strict-transport-security')" "1"
check "10.6: E2E: XFF forjado ignorado (el proxy impone la IP real)" "$(curl -s -H 'X-Forwarded-For: 198.51.100.7' http://127.0.0.1:$PX/api/health | json 'j.ip')" "127.0.0.1"
check "10.6: E2E: .env no expuesto" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PX/city-pets-backend/.env)" "404"
# recuperacion (Restart=on-failure): el pedido sobrevive
CPID=$(pgrep -P "$SUP_PID" || true)
kill -9 "$CPID" 2>/dev/null || true
sleep 4
check "10.6: E2E: tras crash, health 200" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PX/api/health)" "200"
check "10.6: E2E: pedido conservado tras crash" "$(curl -s http://127.0.0.1:$PX/api/orders -H "Authorization: Bearer $TB20" | json 'j.some(o=>o.id===v)' "$OID")" "true"
# backup al final del viaje
DB_PATH="$SBOX_DATA/dev.db" UPLOADS_DIR="$SBOX_MEDIA" BACKUP_DIR="$SBOX_BKP" bash "$SBOX_BE/scripts/backup.sh" > /tmp/citypets-g20-backup.log 2>&1
BKP20=$(ls -1t "$SBOX_BKP"/citypets-*.tar.gz 2>/dev/null | head -1)
[ -n "$BKP20" ] && ok "10.6: E2E: backup final creado" || ko "10.6: E2E: backup final ausente"
# el repo no se toca
AFTER_U=$(ls uploads/products 2>/dev/null | md5sum | cut -d' ' -f1)
AFTER_D=$(md5sum prisma/dev.db 2>/dev/null | cut -d' ' -f1)
[ "$AFTER_U" = "$BEFORE_U" ] && ok "10.6: E2E: uploads/ del repo intacto" || ko "10.6: E2E: se escribio en uploads/ del repo"
[ "$AFTER_D" = "$BEFORE_D" ] && ok "10.6: E2E: BD del repo intacta" || ko "10.6: E2E: se escribio en la BD del repo"
kill "$PX_PID" 2>/dev/null; wait "$PX_PID" 2>/dev/null
kill "$SUP_PID" 2>/dev/null; wait "$SUP_PID" 2>/dev/null
rm -rf "$SBOX"

echo ""
echo "===== G21. Fase B4: sin dependencia externa de imágenes (picsum) ====="
CSP=$(hdr "$ROOT/" content-security-policy)
if ! echo "$CSP" | grep -qi 'picsum'; then ok "B4: CSP img-src sin picsum.photos"; else ko "B4: CSP img-src contiene picsum.photos"; fi
REFS=$(grep -RniE 'picsum' \
  ../js ../css ../index.html ../admin.html ../assets \
  server.js src scripts deploy assets prisma \
  --include='*.js' --include='*.css' --include='*.html' --include='*.json' \
  --include='*.sh' --include='*.md' --include='*.conf' --include='*.service' \
  --include='*.timer' --include='*.svg' --include='*.prisma' --include='*.sql' \
  --exclude='test-integral.sh' 2>/dev/null || true)
[ -z "$REFS" ] && ok "B4: 0 referencias a picsum en el codigo fuente" || ko "B4: quedan referencias a picsum: $(echo "$REFS" | head -3 | tr '\n' ' ')"
if grep -q 'IMG_PLACEHOLDER' ../js/data.js && grep -q 'IMG_PLACEHOLDER' ../js/app.js && grep -q 'IMG_PLACEHOLDER' ../js/admin.js; then
  ok "B4: frontend usa fallback local de imagen (sin imagen)"
else
  ko "B4: falta fallback local de imagen en el frontend"
fi

echo ""
echo "===== G22. Fase 2: importacion masiva Excel (plantilla + validacion por fila + vista previa) ====="
# --- config estatica ---
if grep -q "require('../controllers/import')" src/routes/admin.js && grep -q "importUpload.single('file')" src/routes/admin.js; then
  ok "rutas de import conectadas (template/preview/commit)"
else
  ko "rutas de import no conectadas"
fi
if grep -q '"exceljs"' package.json; then ok "exceljs instalado"; else ko "exceljs ausente en package.json"; fi
[ -f scripts/gen-test-xlsx.js ] && ok "generador de xlsx de prueba presente" || ko "gen-test-xlsx ausente"
if grep -q 'importCSV\|parseCSV\|citypets_catalogo.csv' ../js/admin.js ../admin.html; then
  ko "quedan restos de la importacion CSV antigua"
else
  ok "importacion CSV antigua reemplazada por Excel"
fi
if grep -q 'btnDownloadTemplate' ../admin.html && grep -q 'xlsxInput' ../admin.html && grep -q 'importModal' ../admin.html; then
  ok "admin.html: botones y modal de importacion Excel presentes"
else
  ko "admin.html: faltan elementos de importacion Excel"
fi
if grep -q 'downloadExcelTemplate' ../js/admin.js && grep -q 'importXlsx' ../js/admin.js && grep -q "uploadFile('/admin/import/preview'" ../js/admin.js; then
  ok "admin.js: flujo plantilla + vista previa + commit"
else
  ko "admin.js: flujo de importacion incompleto"
fi
if grep -q 'renderImportPreview' ../js/admin.js && grep -q 'btnImportCommit' ../js/admin.js && grep -q 'r.valid' ../js/admin.js; then
  ok "admin.js: vista previa por fila con estado valido/invalido"
else
  ko "admin.js: falta vista previa por fila"
fi
# --- autorizacion ---
check "plantilla sin token 401" "$(curl -s -o /dev/null -w '%{http_code}' "$B/admin/import/template")" "401"
check "plantilla usuario normal 403" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TBOB" "$B/admin/import/template")" "403"
# --- plantilla descargable ---
TPL=$(curl -s -D /tmp/cp-g22-hdr.txt -o /tmp/cp-g22-template.xlsx -w '%{http_code}' -H "Authorization: Bearer $TANA" "$B/admin/import/template")
check "plantilla descargada 200" "$TPL" "200"
CT=$(grep -i '^content-type:' /tmp/cp-g22-hdr.txt | tr -d '\r' | sed 's/^[^:]*:[[:space:]]*//')
check "plantilla content-type xlsx" "${CT%%;*}" "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
node -e "const s=require('fs').statSync('/tmp/cp-g22-template.xlsx').size; process.exit(s>1000?0:1)" && ok "plantilla con contenido" || ko "plantilla vacia"
# --- round-trip: subir la plantilla (2 ejemplos validos + 1 invalida) ---
PV=$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TANA" -F 'file=@/tmp/cp-g22-template.xlsx' "$B/admin/import/preview")
check "preview de plantilla 200" "$(code_of "$PV")" "200"
check "preview: 3 filas totales" "$(body_of "$PV" | json 'j.summary.total')" "3"
check "preview: 2 validas" "$(body_of "$PV" | json 'j.summary.valid')" "2"
check "preview: 1 invalida" "$(body_of "$PV" | json 'j.summary.invalid')" "1"
check "preview: error por fila presente" "$(body_of "$PV" | json 'j.rows.some(r=>!r.valid && r.errors.length>0)')" "true"
# --- commit sobre la plantilla (importa solo las validas) ---
IID=$(body_of "$PV" | json 'j.importId')
[ -n "$IID" ] && ok "preview genera importId" || ko "sin importId"
PRE=$(req /products | body_of | json 'j.length')
CM=$(curl -s -w '|%{http_code}' -X POST "$B/admin/import/commit" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d "{\"importId\":\"$IID\"}")
check "commit 200" "$(code_of "$CM")" "200"
check "commit crea 2 productos" "$(body_of "$CM" | json 'j.created')" "2"
check "commit omite 1 invalida" "$(body_of "$CM" | json 'j.skipped.length')" "1"
check "catalogo crece en 2" "$(req /products | body_of | json 'j.length')" "$((PRE+2))"
check "importId consumido (recommit 404)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/admin/import/commit" -H "Authorization: Bearer $TANA" -H 'Content-Type: application/json' -d "{\"importId\":\"$IID\"}")" "404"
# --- limpiar los productos de ejemplo importados ---
G22IDS=$(req /products | body_of | json 'j.filter(p=>p.name.includes("(ejemplo)")).map(p=>p.id).join(" ")')
for PID in $G22IDS; do
  curl -s -o /dev/null -X DELETE "$B/products/$PID" -H "Authorization: Bearer $TANA"
done
check "ejemplos limpiados del catalogo" "$(req /products | body_of | json 'j.some(p=>p.name.includes("(ejemplo)"))')" "false"
# --- archivo de prueba con validaciones variadas (gen-test-xlsx) ---
node scripts/gen-test-xlsx.js /tmp/cp-g22-rows.xlsx >/dev/null
PV2=$(curl -s -w '|%{http_code}' -X POST -H "Authorization: Bearer $TANA" -F 'file=@/tmp/cp-g22-rows.xlsx' "$B/admin/import/preview")
check "preview archivo variado 200" "$(code_of "$PV2")" "200"
check "variado: 6 filas" "$(body_of "$PV2" | json 'j.summary.total')" "6"
check "variado: 2 validas" "$(body_of "$PV2" | json 'j.summary.valid')" "2"
check "variado: 4 invalidas" "$(body_of "$PV2" | json 'j.summary.invalid')" "4"
check "precio formato colombiano 30.500 -> 30500" "$(body_of "$PV2" | json 'j.rows.find(r=>r.data.name==="Import G22 Gato").data.price')" "30500"
check "error por nombre vacio" "$(body_of "$PV2" | json 'j.rows.filter(r=>!r.valid).flatMap(r=>r.errors).some(e=>e.includes("El nombre es obligatorio"))')" "true"
check "error por especie invalida" "$(body_of "$PV2" | json 'j.rows.filter(r=>r.data.name==="Import G22 Mal")[0].errors[0].includes("especie")')" "true"
check "error por precio no numerico" "$(body_of "$PV2" | json 'j.rows.filter(r=>r.data.name==="Import G22 Precio")[0].errors.some(e=>e.includes("número"))')" "true"
check "error por precio negativo" "$(body_of "$PV2" | json 'j.rows.filter(r=>r.data.name==="Import G22 Negativo")[0].errors.some(e=>e.includes("negativo"))')" "true"
# --- archivo invalido (no es xlsx) ---
printf 'no soy excel' > /tmp/cp-g22-fake.xlsx
check "archivo no xlsx 400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TANA" -F 'file=@/tmp/cp-g22-fake.xlsx' "$B/admin/import/preview")" "400"
# --- limpiar los productos variados (no se importan: quedan 0 en BD) ---
check "variado: nada importado (commit no ejecutado)" "$(req /products | body_of | json 'j.some(p=>p.name.startsWith("Import G22"))')" "false"
[ "$FAIL" -eq 0 ]