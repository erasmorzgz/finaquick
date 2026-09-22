# Finaquick

Portal de servicios profesionales para instituciones multi-campus (clínica
dental, consultoría, asesoría fiscal, y los servicios que se agreguen):
folios, créditos, cortes de caja, perfiles de usuario y un panel financiero
con el desempeño de cada servicio y cada procedimiento.

## Funciones principales

- **Multi-organización**: cada campus o sede opera de forma aislada, con
  sus propios servicios, usuarios y datos, sin mezclarse entre sí.
- **Roles y permisos**: administrador, finanzas, personal, y acceso de
  solo consulta por servicio.
- **Folios y cobros**: registro de procedimientos, pagos y créditos
  pendientes, con búsqueda global entre servicios.
- **Cortes de caja**: por día (agrupado por forma de pago) y por mes
  (desglose por procedimiento), imprimibles o exportables.
- **Panel financiero**: ingresos por mes, por servicio y por
  procedimiento, comparativo contra el mes anterior, reportes imprimibles.
- **Registro solo por invitación**: un administrador invita por correo;
  no existe alta pública de cuentas.
- **Bitácora de auditoría** de las acciones administrativas.
- **Inicio de sesión institucional** con la cuenta de Microsoft de la
  organización (opcional).
- **Autenticación de dos factores**, opcional y por cuenta, con
  cualquier app autenticadora estándar.
- **Quick, el asistente de datos**: pregunta en español normal
  ("cuánto cobré ayer", "qué procedimiento se vendió más este mes",
  "cómo voy comparado con el mes pasado") — funciona con patrones fijos
  sin nada que configurar, y entiende preguntas más variadas si se
  conecta una IA (Google Gemini, opcional).
- **Accesible con teclado y con lectores de pantalla**: cada campo de
  formulario está correctamente asociado a su etiqueta, y los
  elementos interactivos son alcanzables sin usar el mouse.

## Instalación local

Ver [`LOCAL_SETUP.md`](LOCAL_SETUP.md) para la guía completa de
instalación y despliegue, dirigida al equipo de sistemas de la
institución. El sistema corre por completo sobre infraestructura propia
— servidor Node.js y base de datos PostgreSQL — sin depender de ningún
servicio de terceros para su operación normal; el único opcional es
Google Gemini, para Quick (ver [`SECURITY.md`](SECURITY.md)).

## Arquitectura

- **Frontend**: React, TypeScript, Vite, Tailwind CSS.
- **Servidor**: Node.js y Express, con PostgreSQL como base de datos.
- **Capa de datos**: toda la aplicación accede a la información a través
  de un único módulo (`src/lib/db/`) — ninguna pantalla toca la base de
  datos directamente, lo que mantiene la lógica de seguridad y acceso
  centralizada en un solo lugar.

## Seguridad

Detalle completo de los controles implementados —autenticación,
autorización, protección de datos, auditoría— en
[`SECURITY.md`](SECURITY.md).

## Prueba de carga

Resultados de simular varias decenas de usuarios simultáneos, y cómo
correrla de nuevo con tu propio hardware, en
[`PRUEBA_DE_CARGA.md`](PRUEBA_DE_CARGA.md).

## Despliegue en producción

```bash
npm run build
```

Genera los archivos estáticos del frontend (`dist/`) para servirse desde
cualquier servidor web. El servidor (`servidor/api`) es una aplicación de
Node.js estándar. Ver `LOCAL_SETUP.md`, sección "Despliegue en un
servidor de la institución", para el detalle completo.
