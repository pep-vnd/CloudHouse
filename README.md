# CloudHouse

**Aplicación:** https://pep-vnd.github.io/CloudHouse/

React + Vite + Tailwind CSS + Supabase Realtime. Inventario, lista de compra,
menú por semanas y tareas para Papá e Hijo, con instalación PWA.

## Ejecutar

Node.js 24 o posterior.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Completa `.env.local` con la URL de Supabase, su clave pública anon o publishable
y `VITE_BASE_PATH=/CloudHouse/`. Sin Supabase configurado funciona en modo local,
identificado en la interfaz; ese modo no comparte datos entre dispositivos.
Los datos locales no se migran automáticamente cuando se activa Supabase.

## Publicar en GitHub Pages en 5 pasos

1. Crea un proyecto **Free** en [Supabase](https://supabase.com/dashboard).
   Ejecuta íntegramente [`supabase/schema.sql`](supabase/schema.sql) en SQL Editor.
2. Crea `.env.local` a partir de `.env.example`. Copia la URL del proyecto en
   `VITE_SUPABASE_URL` y la clave **anon o publishable** en
   `VITE_SUPABASE_ANON_KEY`. Nunca uses la clave `service_role` o una secret key.
   Establece `VITE_BASE_PATH=/CloudHouse/` (respeta el nombre de tu repositorio).
3. Sube el código a tu repositorio público de GitHub:
   ```bash
   git init -b main
   git add .
   git commit -m "Crear CloudHouse"
   gh repo create CloudHouse --public --source=. --remote=origin --push
   ```
   Si el repositorio ya existe, usa su remoto y `git push origin main`.
4. Ejecuta `npm ci`, `npm test` y `npm run deploy`.
   El script compila con las variables de `.env.local` y publica `dist/`
   en la rama `gh-pages`. Las variables de Vite se incorporan al JavaScript:
   la URL y la clave pública serán visibles en el navegador.
5. En GitHub → Settings → Pages selecciona **Deploy from a branch**,
   rama **gh-pages**, carpeta **/(root)**. Abre
   `https://TU_USUARIO.github.io/CloudHouse/` en ambos móviles.
   Inicia sesión con una cuenta autorizada e instala desde el menú de Chrome o desde
   Safari → Compartir → Añadir a la pantalla de inicio.

Para publicar actualizaciones: `git push origin main` y `npm run deploy`.
El workflow incluido ejecuta las pruebas y la compilación; el despliegue se
realiza con `gh-pages`. GitHub Pages y Supabase usan sus planes gratuitos,
sujetos a sus límites. No se ha contratado ningún servicio de pago.

## Comprobaciones

```bash
npm test
npm run build
node scripts/verify-cloud.mjs
```

La última comprobación requiere `.env.local` y conexión. Crea registros
temporales identificados y los elimina al terminar. Solicita por stdin las credenciales de una cuenta autorizada.
Verifica actualizaciones concurrentes, reposición, duplicados y Realtime.
`node scripts/verify-access.mjs` comprueba además el rechazo anónimo y las dos cuentas;
recibe por stdin un array JSON de objetos con username, password y profile.
No guardes las credenciales en archivos ni argumentos de comandos.

## Comportamiento

- Los cambios de stock usan funciones PostgreSQL atómicas; dos escaneos no
  sobrescriben cantidades. EAN-8 y EAN-13 se validan con su dígito de control.
- Al llegar a cero se activa la compra. «Comprado» repone al menos el stock
  mínimo y elimina el producto de la lista. Los botones + añaden una unidad.
- El filtro de ubicación, categoría, nombre y sin gluten se combina.
- Los menús tienen `week_start` para conservar semanas diferentes.
- Las tareas se organizan por día y franja horaria. El completado se guarda por
  fecha, así que una rutina vuelve a estar pendiente en su siguiente aparición.
  El reinicio manual afecta al día o semana seleccionados, conservando el resto del historial.
- La PWA almacena su interfaz, pero los datos del hogar en la nube se mantienen
  solo en memoria mientras la sesión está abierta. Sin conexión se conserva la
  vista ya cargada; una nueva apertura necesita conexión para comprobar el acceso.
  Al cerrar sesión se desmonta el hogar y se elimina la caché antigua.
- El modo local utiliza Web Locks cuando están disponibles para coordinar pestañas.
  El modo nube usa PostgreSQL; no depende de Web Locks.
- El escáner solicita resolución HD, intenta enfoque continuo y permite linterna,
  zoom y elección de lente según las capacidades de la cámara y del navegador.
  Una segunda lectura local conserva hasta 1280 píxeles del fotograma; las imágenes
  no se envían a servidores. Los controles físicos requieren validación en cada móvil.
- La cámara necesita HTTPS o localhost y permiso del navegador. También hay
  entrada manual del EAN y creación manual cuando OFF no conoce el producto.
- «Sin gluten» solo se infiere con una etiqueta explícita y sin alérgenos o
  trazas contradictorias. Confirma siempre el etiquetado del envase.

## Acceso y datos

La web y su código son públicos; los datos requieren Supabase Auth y pertenecer
  a `household_members`. Los visitantes anónimos no pueden leer ni escribir las
  tablas o ejecutar sus funciones. Los miembros no pueden cambiar su perfil ni
  crear otros miembros. No hay registro público en la aplicación.

Para provisionar un hogar nuevo, crea las cuentas desde Authentication → Users,
con el identificador `nombre@users.cloudhouse.invalid`, contraseña y autoconfirmación,
sin enviar correo. Registra sus UUID en `household_members` desde SQL Editor,
con `username` y `profile` (`Padre` o `Hijo`). Desactiva los nuevos registros en
Authentication → Sign In / Providers. Los usuarios escriben solamente su nombre
en CloudHouse. Estos identificadores no son buzones: para recuperar una contraseña,
el administrador debe cambiarla en Supabase. No publiques datos de cuentas ni contraseñas.

En proyectos existentes aplica `supabase/migrations/20261104_private_access.sql`.
El script completo `supabase/schema.sql` también incluye la protección dentro de
una única transacción. Las antiguas migraciones son históricas: no las reapliques
por separado después de activar el acceso privado.

No se incluye la contraseña de PostgreSQL ni ninguna clave administrativa
en el repositorio. `.env.local` está excluido de Git.

## Organización familiar precargada

Los horarios, las rutinas, los ingredientes y los platos se guardan en Supabase.
El repositorio contiene la interfaz y los esquemas, sin los datos del hogar.
La tabla `menu_templates` contiene el menú habitual compartido; `weekly_menu`
guarda las ediciones de cada semana. Las tareas tienen días, franjas y un
historial de fechas completadas independiente para cada aparición.

La precarga se hace con `node scripts/seed-family.mjs`. Lee exclusivamente el
archivo local `.family-plan.local.json`, excluido de Git, con tres arrays:
`tasks`, `menu` y `products`. Los UUID estables y los conflictos ignorados
permiten repetirla sin sobrescribir ediciones ni cantidades. La aplicación
no vuelve a crear automáticamente las tareas o productos eliminados.
`node scripts/verify-family.mjs` comprueba los datos frente al archivo local y
verifica el completado concurrente usando una tarea temporal.

## Referencias

- [Tailwind CSS con Vite](https://tailwindcss.com/docs/installation/using-vite).
- [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
- [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Open Food Facts API](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorial-off-api/).
- [html5-qrcode](https://scanapp.org/html5-qrcode-docs/docs/apis/classes/Html5Qrcode).
- [Vite en GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages).

Datos de productos © colaboradores de Open Food Facts, ODbL. Imágenes de
productos CC BY-SA. Los iconos de la app se generan a partir de `public/icon.svg`.
