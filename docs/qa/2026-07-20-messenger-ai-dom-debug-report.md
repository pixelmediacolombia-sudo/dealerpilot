# Informe QA - DealerPilot Messenger AI DOM Debug

Fecha: 2026-07-20
Extension evaluada: DealerPilot Messenger AI v0.1.5
Ambiente observado: Facebook Marketplace Inbox con chat flotante activo

## Resumen Ejecutivo

La extension Messenger AI si esta detectando conversaciones validas en algunos momentos y tambien llega a recibir sugerencias de IA desde el backend. El problema principal no parece estar en la generacion de IA ni en la conexion inicial con el backend, sino en la captura del DOM de Facebook Marketplace.

La anomalia concreta es que la extension detecta varios candidatos de conversacion al mismo tiempo y procesa elementos que no son chats reales, por ejemplo `Choose an emoji`, `Compose`, `Chats`, `Aa` o burbujas de respuesta generadas por la IA. Eso contamina el debugger, cambia el `buyerName`, bloquea el envio y hace que el flujo parezca roto aunque el comprador correcto tambien haya sido detectado.

## Planteamiento Del Problema

DealerPilot Messenger AI debe:

1. Detectar el chat activo de Facebook Marketplace.
2. Identificar el comprador real.
3. Extraer los mensajes visibles de esa conversacion.
4. Enviar el ultimo mensaje del comprador al backend.
5. Recibir una respuesta sugerida de IA.
6. Si `Auto reply` esta encendido, insertar la respuesta en el composer y enviarla.

El fallo actual ocurre entre los pasos 1 y 4. La extension esta encontrando demasiados `thread roots` en la pagina. Facebook renderiza el chat, la lista de conversaciones, botones, composer, emoji picker y previews como elementos DOM mezclados. Algunos de esos elementos tienen textos accesibles o `aria-label` que parecen datos utiles, pero no son el buyer ni el mensaje.

## Evidencia Observada En Los JSON

### Caso 1 - Dry Run

Estado:

- `dryRun: true`
- `autoReplyEnabled: false`
- `activeConversationCount: 22`
- `stage: dry_run_capture`
- `buyerName: "Choose an emoji"`
- `payloadPreview.currentMessage: "Aa"`

Anomalia:

El arreglo `buyersDetected` contiene varias entradas correctas con:

- `buyerName: "Juan"`
- `selectedHeaderText: "Juan · 2021 Toyota RAV4"`
- `latestMessageDirection: "buyer"`
- `messageCount: 3`

Pero el debugger final quedo apuntando a `Choose an emoji`. Eso demuestra que la extension si detecto a Juan, pero despues proceso un candidato incorrecto y lo dejo como ultimo estado visible.

### Caso 2 - Suggest Only

Estado:

- `dryRun: false`
- `autoReplyEnabled: false`
- `buyerName: "Juan"`
- `selectedHeaderText: "Juan · 2021 Toyota RAV4"`
- `stage: intake_sending`
- `lastConversationIntake.suggestedReplyReceived: true`

Anomalia:

El backend recibio una captura, pero `currentMessage` quedo como:

```text
12 PM by Juan
```

Ese no es el mensaje real del comprador. Es metadata del DOM o del `aria-label`. La extension debe limpiar ese texto y quedarse con el contenido real del mensaje, por ejemplo:

```text
Hola. ¿Sigue estando disponible?
```

### Caso 3 - Auto Reply

Estado:

- `dryRun: false`
- `autoReplyEnabled: true`
- `buyersDetected` contiene entradas correctas para `Juan`
- El debugger final queda en:
  - `buyerName: "Choose an emoji"`
  - `messageCount: 0`
  - `reason: "buyer_message_missing"`
  - `stage: blocked`

Anomalia:

Despues de generar o intentar usar una respuesta IA, el selector del DOM termina mirando un elemento incorrecto: el composer, el boton de emoji o una burbuja de respuesta, no la conversacion activa completa.

## Causa Raiz Tecnica

La causa raiz probable esta en dos puntos:

1. `captureAll` devuelve multiples candidatos de conversacion.
2. `captureConversationOnce` procesa todos esos candidatos, no solo el mejor.

Cuando hay 22 candidatos, uno puede ser correcto (`Juan · 2021 Toyota RAV4`) y otro puede ser basura (`Choose an emoji`). Si el candidato basura se procesa despues, pisa el estado del debugger y bloquea el flujo.

Ademas, el parser semantico esta aceptando metadata de accesibilidad como mensaje real. Por eso aparece `12 PM by Juan` como `currentMessage`.

## Por Que Manipular El DOM Es Dificil

Facebook Marketplace no ofrece una estructura publica estable para leer y enviar mensajes desde el inbox personal. La extension trabaja sobre una interfaz web React altamente dinamica.

Eso implica:

- Los nombres, mensajes y acciones viven mezclados en nodos visuales.
- Los `aria-label` pueden contener hora, autor, texto, botones y estado del mensaje.
- El chat flotante y la lista de chats existen al mismo tiempo.
- Los botones de UI tambien tienen texto accesible.
- Facebook puede cambiar clases, jerarquia y atributos sin aviso.
- El envio automatico necesita escribir en un `contenteditable`, no en un input HTML simple.

Por eso es dificil: no se esta consumiendo una API de mensajes; se esta interpretando y operando una pantalla humana.

## Documentacion Consultada

### Chrome Extensions - Content Scripts

Fuente: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

Punto relevante:

Los content scripts corren en el contexto de paginas web y pueden usar el DOM estandar para leer detalles de la pagina, modificarla y comunicarse con la extension.

Aplicacion a DealerPilot:

La parte que lee el chat y escribe en Facebook tiene que vivir como content script. El service worker/background no puede leer directamente el DOM del inbox.

### Chrome Extensions - chrome.scripting API

Fuente: https://developer.chrome.com/docs/extensions/reference/api/scripting

Punto relevante:

Chrome permite inyectar JavaScript/CSS en paginas cuando la extension tiene permisos como `scripting`, `activeTab` o `host_permissions`. Tambien distingue entre mundos de ejecucion `ISOLATED` y `MAIN`.

Aplicacion a DealerPilot:

La arquitectura actual, con content scripts cargados por manifest sobre dominios de Facebook/Messenger, es consistente con el modelo recomendado para automatizar una pagina visible.

### MDN - WebExtensions Content Scripts

Fuente: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts

Punto relevante:

Los content scripts pueden acceder y modificar el DOM de la pagina, pero se comunican con background scripts mediante mensajeria. Los background scripts no acceden directamente al contenido de la pagina.

Aplicacion a DealerPilot:

La separacion actual es correcta: `messengerCapture.js` y `messengerAi.js` leen/manipulan DOM; `messengerClient.js` maneja storage, backend y debugger.

### MDN - Document.execCommand()

Fuente: https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand

Punto relevante:

`document.execCommand()` esta deprecado y no estandarizado, aunque todavia puede funcionar para editar `contenteditable`. MDN advierte que puede dejar de funcionar y que se debe probar compatibilidad.

Aplicacion a DealerPilot:

Si la extension usa `execCommand("insertText")` para insertar la respuesta en el composer de Facebook, eso es practico pero fragil. Se debe mantener fallback y verificacion: confirmar que el composer contiene el texto antes de enviar.

## Respuesta A La Pregunta Clave

Para que la IA genere una respuesta:

No es obligatorio manipular el DOM. El backend puede generar sugerencias si recibe `buyerName`, `currentMessage`, `visibleMessages` y contexto.

Para que la IA responda automaticamente dentro del chat personal de Facebook Marketplace:

Si es obligatorio manipular el DOM en esta arquitectura. La extension debe:

1. Leer el DOM del chat.
2. Identificar el composer correcto.
3. Insertar la respuesta.
4. Clickear el boton de enviar o simular Enter.
5. Verificar que el mensaje salio o que el composer quedo limpio.

Alternativas sin DOM:

- Usar modo `Suggest only` y que el humano envie manualmente.
- Migrar a APIs oficiales de Meta para Pages/Messenger, si el flujo comercial se mueve a una pagina compatible.
- Crear una bandeja interna en DealerPilot donde la IA sugiera, pero el envio final lo haga un humano.

## Solucion Propuesta

### Aclaracion Importante: Un Chat Ganador No Significa Un Solo Buyer

La regla de "procesar un solo chat ganador" no significa que DealerPilot Messenger AI solo pueda trabajar con un comprador a la vez.

Significa que, para cada ciclo de captura, la extension no debe dejar que elementos falsos del DOM compitan contra el chat real. Si Facebook muestra un panel activo de `Juan · 2021 Toyota RAV4`, ese panel debe ser el candidato ganador para esa captura, y elementos como `Choose an emoji`, `Compose`, `Chats` o `Aa` deben quedar descartados.

El sistema si puede manejar multiples compradores escribiendo casi al mismo tiempo, siempre que cada conversacion tenga una identidad estable propia:

- `buyerName`
- `selectedHeaderText`
- `marketplaceUrl` o referencia estable del thread
- array de mensajes visibles
- ultimo mensaje real del comprador

Cada buyer debe mantenerse separado por `externalThreadRef` / `threadKey`. Asi, si escriben Juan, Peter y Fon al mismo tiempo, la extension puede procesar cada conversacion en ciclos separados o por snapshots independientes, sin mezclar mensajes entre compradores.

La correccion necesaria no es limitar el sistema a un solo chat global. La correccion es evitar que, dentro de una misma captura, un control de UI o una burbuja incorrecta sea tratado como si fuera el buyer activo.

### 1. Procesar Un Solo Chat Ganador

Cambiar `captureConversationOnce` para que no procese todos los snapshots. Debe escoger un unico snapshot ganador.

Criterios para ganar:

- `validation.ok === true`
- `buyerNameDetected === true`
- `buyerMessageDetected === true`
- `selectedHeaderText` presente
- header compatible con `Buyer · Vehicle`
- root grande y parecido a un panel real
- `messageCount > 0`
- `latestMessageDirection === "buyer"`
- preferir `marketplaceUrl` cuando exista

Penalizaciones:

- `buyerName` igual a `Choose an emoji`
- `buyerName` igual a `Compose`
- `buyerName` igual a `Chats`
- `buyerName` igual a `Aa`
- header vacio
- root pequeno del composer
- preview que parece respuesta de IA

### 2. Endurecer Validacion De Buyer Name

Actualizar `isReliableBuyerName` y `isLikelyBuyerNameCandidate` para rechazar textos de UI:

```text
Choose an emoji
Choose a sticker
Choose a GIF
Compose
Chats
Aa
Unread message
Write a message
Marketplace
See details
More options
```

### 3. Limpiar Mensajes Semanticos

Actualizar `parseDescriptor` y `cleanMessageText` para remover metadata:

```text
12 PM by Juan:
Message sent 12 PM by Juan:
Juan started this chat.
```

Resultado esperado:

```text
Hola. ¿Sigue estando disponible?
```

No:

```text
12 PM by Juan
```

### 4. Guardar Mensajes En Array Cronologico

El array debe quedar de antiguo a reciente:

```json
[
  { "speaker": "Juan", "text": "Hola. ¿Sigue estando disponible?" },
  { "speaker": "Juan", "text": "Me interesa, ¿cuál es el mejor número?" },
  { "speaker": "Juan", "text": "¿Todavía está disponible para verlo hoy?" }
]
```

El ultimo mensaje debe ser:

```js
messages[messages.length - 1]
```

Esto evita mezclar mensajes y deja claro cual es el disparador real de la IA.

### 5. No Reutilizar Respuestas IA Como Buyer

Si un texto parece respuesta de IA, no puede convertirse en:

- `buyerName`
- `currentMessage`
- mensaje del comprador
- header de conversacion

Ejemplo a bloquear:

```text
Yes - the car is still available. Are you interested in our easy financing options?
```

## Criterios De Exito Para La Proxima Prueba

### Caso 1 - Dry Run

Configuracion:

- `Dry run`: ON
- `Auto reply`: OFF

Esperado:

- `stage: dry_run_capture`
- `buyerName: "Juan"`
- `selectedHeaderText: "Juan · 2021 Toyota RAV4"`
- `currentMessage`: mensaje real del comprador
- `Backend: Not sent`
- No debe aparecer `Choose an emoji`.

### Caso 2 - Suggest Only

Configuracion:

- `Dry run`: OFF
- `Auto reply`: OFF

Esperado:

- `stage: auto_send_blocked`
- `reason: auto_reply_disabled`
- `Backend: Intake OK`
- `aiReplyReceived: true`
- `lastConversationIntake.currentMessage`: mensaje real del comprador
- No debe enviar mensaje a Facebook.

### Caso 3 - Auto Reply

Configuracion:

- `Dry run`: OFF
- `Auto reply`: ON

Esperado:

- `buyerName`: comprador real
- `currentMessage`: ultimo mensaje real del comprador
- `Backend: Intake OK`
- `aiReplyReceived: true`
- `autoSent: true` o, si falla, error especifico:
  - `composer_missing`
  - `composer_insert_unconfirmed`
  - `send_dispatch_failed`
  - `delivery_unconfirmed`

No esperado:

- `buyerName: "Choose an emoji"`
- `currentMessage: "Aa"`
- `currentMessage: "12 PM by Juan"`
- `buyer_message_missing` cuando el chat visible tiene mensajes del comprador.

## Mega Prompt Para Continuar

```text
Estamos en C:\dev\dealerpilot, branch main. Trabajamos en DealerPilot Messenger AI, carpeta chrome-extension-messenger. La version actual probada es v0.1.5. No generar informe; implementar la correccion.

Contexto:
- La extension Marketplace Publisher ya fue separada y no debe tocarse.
- La extension Messenger AI debe capturar conversaciones de Facebook Marketplace, enviar /api/conversations/intake y, si Auto Reply esta activo, insertar/enviar la respuesta de IA en el chat.
- Backend y frontend no deben tocarse salvo autorizacion explicita.
- Si se cambia algo fuera de chrome-extension-messenger, avisar y subirlo a GitHub.

Evidencia del fallo:
1. Caso Dry Run:
   - activeConversationCount: 22
   - buyersDetected incluye varias entradas correctas de Juan con selectedHeaderText "Juan · 2021 Toyota RAV4"
   - lastMessengerCaptureDebug termina con buyerName "Choose an emoji" y currentMessage "Aa"
   - Esto indica que se procesa un candidato incorrecto despues del correcto.

2. Caso Suggest Only:
   - buyerName "Juan" y selectedHeaderText correcto
   - lastConversationIntake.currentMessage queda "12 PM by Juan"
   - Esto indica que parseDescriptor/cleanMessageText esta tomando metadata del aria-label como mensaje real.

3. Caso Auto Reply:
   - buyersDetected vuelve a tener Juan correctamente
   - lastMessengerCaptureDebug vuelve a buyerName "Choose an emoji" o a una burbuja de respuesta IA
   - stage blocked, reason buyer_message_missing
   - Esto confirma mezcla de roots del DOM.

Implementar:
1. En chrome-extension-messenger/src/content/facebook/messengerAi.js:
   - Crear una funcion para puntuar snapshots.
   - captureConversationOnce debe procesar un solo snapshot ganador, no todos.
   - Preferir snapshot con validation.ok, buyerName real, buyer message real, selectedHeaderText real, root grande y latestMessageDirection buyer.
   - Penalizar/rechazar buyerName y preview con UI: Choose an emoji, Compose, Chats, Aa, Unread message, Write a message.
   - Penalizar roots pequenos sin header.
   - Mantener buyersDetected como diagnostico completo, pero el procesamiento debe usar solo el ganador.

2. En chrome-extension-messenger/src/content/facebook/messengerCapture.js:
   - Endurecer isLikelyBuyerNameCandidate para rechazar textos UI.
   - Mejorar cleanMessageText/parseDescriptor para limpiar metadata:
     12 PM by Juan:
     Message sent 12 PM by Juan:
     Juan started this chat.
   - El currentMessage debe ser el ultimo mensaje real del comprador, no metadata.
   - Mantener array de mensajes en orden cronologico, con ultimo mensaje en messages[messages.length - 1].
   - Rechazar respuestas generadas por IA como buyerName o buyer message.

3. Agregar pruebas en chrome-extension-messenger/tests:
   - captureAll con Juan correcto + Choose an emoji debe seleccionar/procesar Juan.
   - parseDescriptor no debe devolver "12 PM by Juan"; debe devolver el mensaje real.
   - Auto reply no debe usar una respuesta IA como buyerName.

4. Subir version a 0.1.6:
   - chrome-extension-messenger/manifest.json
   - fallback de version en messengerClient.js si aplica.

5. Empaquetar:
   - crear dealerpilot-messenger-ai-v0.1.6/
   - crear dealerpilot-messenger-ai-v0.1.6.zip

6. Validar:
   npm.cmd run test:extension:messenger
   npm.cmd run lint:extension:messenger
   npm.cmd run test:extensions:isolation
   git diff --check

7. Commit y push a main:
   - git add solo cambios relevantes, evitando staged deletions locales de paquetes viejos si existen.
   - git commit -m "Harden Messenger AI DOM target selection"
   - git push origin main

Resultado esperado:
- Caso 1: Dry run captura Juan y muestra payloadPreview con el mensaje real.
- Caso 2: Suggest only manda intake, recibe IA, no envia a Facebook.
- Caso 3: Auto reply escribe y envia la respuesta IA o muestra error especifico real de composer/send/delivery.
```

## Conclusion

El problema no es que la IA no exista ni que el backend este necesariamente roto. La falla principal esta en la seleccion y limpieza del DOM. La extension ve demasiados elementos al mismo tiempo y necesita una regla mas rigida para decidir cual es el chat real antes de enviar datos al backend o intentar responder.

La solucion correcta es hacer la captura mas estricta, procesar un unico candidato ganador, limpiar metadata de accesibilidad y bloquear textos de UI como buyer. Con eso, el debugger deberia dejar de mostrar `Choose an emoji`, el backend deberia recibir el mensaje correcto, y Auto Reply tendria una base mucho mas estable para escribir/enviar.
