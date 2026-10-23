# App Control de Acceso Biométrico — GEMCA

Aplicación que recibe por internet los eventos de entrada/salida de los dos
lectores biométricos Hikvision ya instalados en GEMCA (Zona Industrial y
Tienda / Sede Principal), los consolida en una sola base de datos y entrega
a la Unidad de Talento Humano lo que necesita para la Gestión del Talento
Humano: asistencia, horas trabajadas y soporte al proceso de nómina.

No reemplaza los lectores ni el software que traen de fábrica: recibe la
información que ya generan.

## Arquitectura: los equipos envían, la App no sale a buscarlos

Zona Industrial y Tienda están en **redes distintas**. En vez de que la App
tenga que entrar a cada red a buscar los datos (lo que obligaría a abrir
puertos o montar una VPN en cada sede), se invierte el sentido de la
conexión: **cada equipo es el que envía sus eventos a la App**, por
internet, apenas ocurren.

```
Zona Industrial                         Tienda (Sede Principal)
┌───────────────────┐                   ┌───────────────────┐
│ DS-K1T321MFWX      │                   │ DS-K1A802MF201     │
│ (su propia red)     │                   │ (su propia red)     │
└─────────┬───────────┘                   └─────────┬───────────┘
          │  empuja cada evento (HTTPS, saliente)     │  empuja cada evento (HTTPS, saliente)
          ▼                                            ▼
        POST /api/ingest/zona-industrial?token=...   POST /api/ingest/tienda?token=...
                              │
                              ▼
                 App Control de Acceso Biométrico
                 (un solo punto, con dirección pública)
                              │
                              ▼
                 Base de datos consolidada + panel
                 para Talento Humano + reporte Excel
```

Con esto, cada sede solo necesita su salida normal a internet (la que ya
tiene). No hace falta IP pública en los equipos, redirección de puertos ni
VPN entre sedes — eso era necesario en el enfoque anterior (que la App
consultara a cada equipo) y se descarta a favor de este, más simple y más
acorde a que son dos redes separadas.

Cada sede tiene su propio token secreto, para que la App sepa de qué equipo
viene cada envío y nadie más pueda enviar eventos falsos.

> La App también conserva, como respaldo opcional, el modo de consulta
> directa (pull) por si en algún momento se habilita una VPN o acceso
> directo a un equipo — pero no es necesario para que todo funcione.

## ¿Qué hace?

- Expone un endpoint propio por sede (`/api/ingest/zona-industrial` y
  `/api/ingest/tienda`) donde cada equipo empuja sus eventos de acceso,
  protegido con un token.
- Interpreta el envío venga como venga: JSON anidado (formato recomendado),
  JSON plano, o XML — y si un envío llega en un formato que no logra
  reconocer, no lo descarta: lo guarda completo para revisión (ver sección
  "Si un envío no se reconoce").
- Pide usuario y clave para entrar al panel y a la API de consulta (no a los
  endpoints de ingesta, que usan su propio token por equipo) — pensado para
  que quede expuesta en internet y se pueda abrir desde cualquier
  ubicación con ese usuario y clave.
- Aplica el control granular por empleado: si un empleado se marca en una
  sede donde no tiene permiso, el evento se guarda igual (para no perder
  información) pero queda marcado como "no autorizado" y aparece como alerta.
- Calcula horas trabajadas por día y por semana, usando la semana laboral de
  GEMCA (viernes a jueves).
- Muestra un panel web sencillo para Talento Humano, con el estado de cada
  equipo (si está recibiendo eventos) y el resumen semanal.
- Genera un reporte Excel descargable por semana (resumen, detalle diario y
  accesos no autorizados).

## Requisitos

- Node.js 22.5 o superior (ideal: la versión LTS más reciente). La App usa el
  módulo de base de datos que viene incluido en Node mismo, así que no hace
  falta instalar ni compilar nada adicional para la base de datos — ni en
  Windows ni al desplegar — y por lo tanto tampoco se necesitan Visual
  Studio Build Tools ni ninguna otra herramienta de compilación.
- Que la App quede alcanzable en internet con una dirección fija (dominio o
  IP), para que ambos equipos — cada uno desde su propia red — puedan
  enviarle sus eventos. Ver "Dónde correr la aplicación" más abajo.

## 1. Instalación

```bash
npm install
cp .env.example .env
```

## 2. Generar el token de cada equipo

```bash
node src/generateToken.js   # ejecutar dos veces, uno para cada sede
```

Pega cada token generado en `.env` (`DEVICE_ZI_TOKEN` y
`DEVICE_TIENDA_TOKEN`). El archivo `.env` nunca debe compartirse ni subirse
a un repositorio.

Aprovecha y define también `PANEL_USER` y `PANEL_PASS` en `.env` — es el
usuario y clave con el que vas a entrar al panel desde donde sea (oficina,
casa, el celular). Sin esto, el panel queda abierto a cualquiera con el
enlace.

## 3. Configurar el envío de eventos en cada equipo

Esto se hace una sola vez por equipo, desde dentro de su propia red (por
ejemplo conectándose a la Wi-Fi/red de esa sede con una laptop), entrando a
la página de configuración web del lector:

1. En el menú de **Red → Avanzado → Notificación de eventos** (en equipos
   Hikvision suele aparecer como *Notify Surveillance Center* / *HTTP
   Listening* / *Event-triggered Notification*, el nombre exacto varía
   según el firmware), se agrega un host de destino con:
   - **Protocolo**: HTTP o HTTPS.
   - **Dirección/host**: el dominio o IP pública donde corre esta App.
   - **Puerto**: el que tenga expuesto la App (443 si es HTTPS, o el que se
     configure).
   - **Ruta (URL/Path)**:
     - Zona Industrial: `/api/ingest/zona-industrial?token=EL_TOKEN_DE_ZI`
     - Tienda: `/api/ingest/tienda?token=EL_TOKEN_DE_TIENDA`
   - **Formato (parameterFormatType)**: `JSON` si el equipo lo permite (es
     el formato que mejor interpreta la App); si solo ofrece XML, también
     funciona.
2. Se activa la notificación para los eventos de control de acceso
   (entrada/salida con huella).
3. Se guarda y, si el equipo lo permite, se hace una prueba de envío desde
   su propia interfaz para confirmar que llega.

Si el equipo no ofrece esta opción por su cuenta propia (depende del
modelo/firmware), puede hacerse por API directamente contra el equipo
(`PUT /ISAPI/Event/notification/httpHosts`, estando en su misma red) —
dime cuando tengas acceso al equipo y preparo esa llamada exacta.

## 4. Cargar empleados y permisos por sede

```bash
curl -X POST http://localhost:3000/api/employees \
  -u "usuario_del_panel:clave_del_panel" \
  -H "Content-Type: application/json" \
  -d '{"employeeNo":"1001","name":"Ana Torres","allowedZonaIndustrial":true,"allowedTienda":false}'
```

(El `-u` es el mismo usuario/clave que definiste en `PANEL_USER`/`PANEL_PASS` — toda la API de consulta lo pide, menos los endpoints de ingesta.)

Si un empleado se marca en un equipo antes de estar registrado, la app lo da
de alta automáticamente con permiso solo en la sede donde se marcó, para no
perder el evento — pero conviene que Talento Humano cargue de una vez la
lista completa (los ~40 empleados) con sus permisos correctos.

## 5. Ejecutar

```bash
npm start
```

Esto levanta el panel web en `http://localhost:3000` (o el puerto que se
configure en `PORT`) y los dos endpoints de ingesta.

## 6. Dónde correr la aplicación

Como ahora son los equipos los que inician la conexión hacia la App (y el
panel va a abrirse desde donde sea, con usuario y clave), lo único que
importa es que la App tenga una dirección fija y alcanzable desde internet.
Al estar en la nube, el panel es simplemente una página web: se puede abrir
desde cualquier ubicación con el enlace y la clave, no queda "instalada" en
un solo sitio.

**Recomendación: Railway** (railway.app). Es la opción más simple para este
tipo de app (Node.js + un solo archivo de base de datos):
- Se despliega subiendo el código (o conectando un repositorio de GitHub),
  sin tener que administrar un servidor Linux a mano.
- Da un dominio con HTTPS automático desde el primer momento (necesario
  para que los equipos puedan enviar sus eventos de forma segura).
- Permite agregar un "volumen" (disco persistente) donde vive el archivo de
  la base de datos, para que no se pierda con cada despliegue.
- Tiene un plan pagado económico (consulta precios vigentes en su sitio);
  para esta carga (dos equipos, ~40 empleados) sobra con el nivel más
  básico.

**Alternativa con más control: un VPS** (DigitalOcean, Hetzner, Vultr). Da
un servidor Linux propio donde se instala Node.js y se corre la App con
`pm2`, con un dominio apuntando a su IP y un certificado HTTPS gratuito
(Let's Encrypt, vía Nginx). Requiere más trabajo de configuración y de
mantenimiento (actualizaciones del sistema, por ejemplo), pero da más
control si GEMCA prefiere eso.

Cualquiera de las dos funciona igual de bien con la arquitectura actual.
Si quieres, te ayudo a dejarla desplegada en la que prefieras — dime cuál
escoges (o si ya tienes cuenta en alguno de estos proveedores) y seguimos
desde ahí.

Se recomienda, en cualquier caso, dejarla corriendo de forma permanente
(Railway lo hace solo; en un VPS, con `pm2` o como servicio del sistema).

## 7. Si un envío no se reconoce

El formato exacto que manda cada equipo puede variar un poco según el
firmware. Si un envío llega y la App no logra identificar el empleado o la
hora, no se pierde: queda guardado completo en una tabla de revisión,
consultable en:

```
GET /api/unparsed
```

Apenas tengas el primer equipo configurado y enviando datos reales, revisa
ahí el formato exacto — si difiere del esperado, ajusto `src/ingest.js` para
que lo reconozca.

## 8. Probar sin los equipos reales

El proyecto incluye una prueba de extremo a extremo que simula a los dos
equipos empujando eventos (en JSON anidado, JSON plano y XML), valida los
rechazos de seguridad (token incorrecto, sede desconocida, panel sin
clave), el cálculo de horas, el marcaje incompleto, la detección de
accesos no autorizados, el Excel y el panel web:

```bash
npm run test:e2e
```

## Estructura del proyecto

```
src/
  ingest.js        Interpreta lo que empujan los equipos (JSON/XML) — el corazón de la integración
  eventsStore.js    Punto único donde los eventos quedan guardados (aplica permisos por sede)
  auth.js           Usuario/clave del panel (PANEL_USER/PANEL_PASS)
  config.js         Configuración de las dos sedes/equipos (lee .env) y tokens
  db.js             Base de datos SQLite y su esquema
  employees.js      Empleados y permisos por sede
  timeZone.js       Cálculo de semana laboral GEMCA (viernes a jueves)
  attendance.js     Cálculo de asistencia, horas y alertas
  reports.js        Generación del reporte Excel
  server.js         Servidor web: endpoints de ingesta + API + panel
  digestHttp.js, isapiClient.js, sync.js, syncOnce.js
                    Modo pull de respaldo (opcional, no se usa por defecto)
public/
  index.html          Panel para la Unidad de Talento Humano
test/
  e2e.js               Prueba de extremo a extremo (simula los envíos de los equipos)
```

## Próxima integración: nómina / ERP

La base de datos de asistencia queda lista para conectarse más adelante con
el módulo de nóminas del ERP que GEMCA está desarrollando: las horas
semanales ya se calculan agrupadas según la misma estructura de semana
(viernes a jueves) que usa GEMCA para sus relaciones de pago.
