# CloudHouse

**Aplicación:** https://pep-vnd.github.io/CloudHouse/

React + Vite + Tailwind CSS + Supabase Realtime. Inventario, lista de compra,
menú por semanas y tareas para Papá e Hijo, con instalación PWA.

## Ejecutar

Node.js 22.12 o posterior.

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
   Elige el perfil e instala desde el menú de Chrome o desde
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
temporales identificados y los elimina al terminar. Verifica RLS con el rol
anónimo, actualizaciones concurrentes, reposición, duplicados y Realtime.

## Comportamiento

- Los cambios de stock usan funciones PostgreSQL atómicas; dos escaneos no
  sobrescriben cantidades. EAN-8 y EAN-13 se validan con su dígito de control.
- Al llegar a cero se activa la compra. «Comprado» repone al menos el stock
  mínimo y elimina el producto de la lista. Los botones + añaden una unidad.
- El filtro de ubicación, categoría, nombre y sin gluten se combina.
- Los menús tienen `week_start` para conservar semanas diferentes.
- El progreso diario incluye tareas sin fecha, de hoy y vencidas; excluye futuras.
  El reinicio diario/semanal es explícito y afecta a ambos perfiles.
- La PWA almacena su interfaz y la última copia de datos. Sin conexión puedes
  consultar; las escrituras a Supabase requieren conexión y muestran un error
  si no se pueden guardar. No se confirman escrituras que no han llegado al servidor.
- El modo local utiliza Web Locks cuando están disponibles para coordinar pestañas.
  El modo nube usa PostgreSQL; no depende de Web Locks.
- La cámara necesita HTTPS o localhost y permiso del navegador. También hay
  entrada manual del EAN y creación manual cuando OFF no conoce el producto.
- «Sin gluten» solo se infiere con una etiqueta explícita y sin alérgenos o
  trazas contradictorias. Confirma siempre el etiquetado del envase.

## Acceso y datos

El SQL implementa las **políticas RLS abiertas solicitadas** para estas tres
tablas. Cualquiera que obtenga la URL y la clave pública puede leer y modificar
el hogar. GitHub Pages es público. El selector Papá/Hijo no autentica y un PIN
solo en el frontend tampoco protegería la base de datos. Usa este despliegue
para los datos domésticos no sensibles previstos; para acceso privado real,
añade Supabase Auth y políticas vinculadas a un hogar antes de ampliar el uso.

No se incluye la contraseña de PostgreSQL ni ninguna clave administrativa
en el repositorio. `.env.local` está excluido de Git.

## Referencias

- [Tailwind CSS con Vite](https://tailwindcss.com/docs/installation/using-vite).
- [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
- [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Open Food Facts API](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorial-off-api/).
- [html5-qrcode](https://scanapp.org/html5-qrcode-docs/docs/apis/classes/Html5Qrcode).
- [Vite en GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages).

Datos de productos © colaboradores de Open Food Facts, ODbL. Imágenes de
productos CC BY-SA. Los iconos de la app se generan a partir de `public/icon.svg`.
