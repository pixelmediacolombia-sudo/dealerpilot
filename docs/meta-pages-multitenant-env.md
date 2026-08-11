# Meta Pages: configuración multi-dealer

La aplicación Meta se comparte entre dealers. Cada dealer se diferencia por su
`dealer_id`, `business_id`, `page_id` y su token de página. Los tokens no se
guardan en el frontend ni en variables de entorno permanentes: se cifran con
AES-256-GCM en `dealer_meta_connections.access_token_ciphertext`.

## Variables globales del backend

```text
DATABASE_URL=...
META_APP_ID=...
META_APP_SECRET=...
META_GRAPH_API_VERSION=v23.0
META_TOKEN_ENCRYPTION_KEY=<64 hex chars o base64 de 32 bytes>
META_PAGE_TIME_ZONE=America/Bogota
WORKERS_ENABLED=true
ALPHA_INITIAL_PASSWORD=Alpha2026
```

`ALPHA_INITIAL_PASSWORD` es únicamente el secreto de bootstrap para crear o
migrar el usuario inicial. La contraseña se almacena como `scrypt$...`; después
del primer acceso conviene cambiarla desde la aplicación.

## Variables temporales de importación de Alpha

```text
META_BOOTSTRAP_PAGE_ID=...
META_BOOTSTRAP_PAGE_ACCESS_TOKEN=...
META_BOOTSTRAP_BUSINESS_ID=...
META_BOOTSTRAP_PAGE_NAME=Alpha MotorSports: Easy Credit / Credito Facil
```

El worker importa estos valores una sola vez para `dealer_id=1` y los cifra en
la base de datos. Después de verificar la fila activa en
`dealer_meta_connections`, se pueden retirar las variables bootstrap. Un
dealer nuevo se conecta creando otra fila en esa tabla; no requiere otro `.env`
ni otra aplicación Meta.

## Identidad interna

`dealers.id` y las columnas `dealer_id` usan el mismo tipo `integer`. Alpha es
el registro existente `id=1`; los nuevos dealers reciben el siguiente valor
serial. Si en el futuro se necesita un identificador público, se debe añadir
un `public_id uuid` separado sin cambiar las claves foráneas actuales.
