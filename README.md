# Veloce Taller

Sistema de gestión de taller de bicicletas. HTML/CSS/JS vanilla + Supabase (Postgres + Auth + Storage).

## Características

- Gestión de clientes, bicicletas y órdenes de trabajo
- Agenda con cálculo automático de tiempo de entrega según horario del taller
- Checklist de estado (frenos, cadena, llantas) y torques
- Fotos de bicicleta (comprimidas y guardadas en Supabase Storage)
- Mensaje WhatsApp automático (ingreso y terminada)
- Recibo imprimible con código QR
- Dashboard de Caja (hoy/semana/mes, pendientes de cobro, por mecánico)
- Export CSV de facturación mensual
- Búsqueda global por # orden, cliente, bici
- Login email/password (Supabase Auth)
- PWA instalable

## Estructura

```
taller/
├── index.html        Layout + login screen
├── styles.css        Todos los estilos
├── app.js            Lógica principal
├── db.js             Capa de acceso a Supabase
├── auth.js           Login / logout
├── config.js         URL + anon key de Supabase
├── manifest.json     PWA manifest
└── sw.js             Service worker (cache offline)
```

## Horario del taller

- Lun/Mar/Jue/Vie: 10:00-19:00 con almuerzo 12:00-13:00
- Miércoles: 11:00-19:00 con almuerzo 13:00-14:00
- Sábado: 11:00-17:00 sin descanso
- Domingo: cerrado
