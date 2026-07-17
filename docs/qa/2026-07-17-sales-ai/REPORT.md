# Reporte QA — Mensaje de Marketplace sin respuesta

**Fecha:** 17 de julio de 2026
**Resultado:** Corrección preparada y validada técnicamente. Falta la prueba visual final después de actualizar la extensión.

## Qué ocurrió

La cuenta de prueba **Ls Peter** envió desde Facebook Marketplace la pregunta:

> Hola, ¿sigue disponible la Chevrolet Equinox EV 2024?

Facebook confirmó el mensaje como enviado, pero DealerPilot no mostró esa conversación y la IA no respondió.

## Explicación sencilla

La extensión estaba conectada, pero en el navegador del vendedor no había una bandeja de Facebook Marketplace o Messenger abierta para observar los mensajes nuevos.

Es similar a tener el vigilante trabajando, pero sin una cámara apuntando a la entrada: el mensaje existía en Facebook, pero DealerPilot nunca pudo verlo. Como el mensaje no entró al sistema, la IA no tuvo nada que contestar.

Los registros comprobaron lo siguiente:

- La extensión reportaba que estaba en línea.
- DealerPilot no recibió una conversación nueva de Ls Peter.
- DealerPilot tampoco creó un comprador nuevo por esa prueba.
- No hubo un error de OpenAI: la solicitud nunca alcanzó la etapa de IA.

## Qué se corrigió

La extensión **v1.3.67** ahora mantiene una sola bandeja del Facebook vendedor abierta en segundo plano mientras la sesión está conectada.

- La pestaña se abre inactiva y fijada, sin interrumpir el trabajo del operador.
- Si ya existe una bandeja de Marketplace o Messenger, la reutiliza.
- No abre pestañas duplicadas.
- Registra cuándo abrió la bandeja y si hubo un error al hacerlo.

## Validación técnica

- Flujo de bandeja y cola de la extensión: **8 de 8 pruebas aprobadas**.
- Regresión de Marketplace: **28 de 28 pruebas aprobadas**.
- Regresión del flujo de publicación: **76 de 76 pruebas aprobadas**.
- Suite QA final: **80 de 80 pruebas aprobadas**.
- Revisión de sintaxis de la extensión: sin errores; permanecen cuatro advertencias anteriores que no corresponden a este cambio.

## Estado de los carros de prueba

- Nissan Ariya: publicación de prueba eliminada y vehículo devuelto a no publicado.
- Mazda: trabajo de publicación reiniciado en DealerPilot y vehículo devuelto a no publicado.
- Chevrolet Equinox EV: trabajo de publicación reiniciado en DealerPilot y vehículo devuelto a no publicado.

Facebook todavía debe confirmar visualmente que Mazda y Equinox ya no estén publicados. Esa comprobación forma parte del próximo QA visual.

## Evidencias

1. [Ariya publicado con una sola foto](./01-ariya-published-with-one-photo.png)
2. [Confirmación de publicación del Mazda](./02-mazda-published-confirmation.png)
3. [Mazda publicado con diez fotos](./03-mazda-facebook-ten-photos.png)
4. [Mazda no disponible para el comprador](./04-mazda-unavailable-to-buyer.png)
5. [Equinox visible para el comprador](./05-equinox-public-for-buyer.png)
6. [Mensaje enviado sin respuesta de la IA](./06-buyer-message-no-ai-reply.png)

## Prueba visual pendiente

Después de instalar la extensión v1.3.67 se debe:

1. Confirmar que la bandeja del Facebook vendedor se abre automáticamente en segundo plano.
2. Enviar otro mensaje desde Ls Peter.
3. Verificar que la conversación completa aparezca en DealerPilot.
4. Verificar que la IA responda y entregue el número **+1 703-763-4675**.
5. Eliminar las publicaciones de prueba restantes y dejar los vehículos como no publicados.
