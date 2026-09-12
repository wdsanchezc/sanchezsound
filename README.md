# SanchezSound

**SanchezSound Digital Jukebox** es una rokola digital multiusuario pensada para pantalla táctil, computadora o TV, con catálogo por artistas y géneros, carátulas, Top Honduras, búsqueda musical, cola compartida y solicitudes desde celulares mediante QR.

## Stack

- Frontend estático: HTML, CSS y JavaScript ES Modules
- Backend: Supabase (Postgres + Realtime + Auth anónima)
- Búsqueda musical: YouTube Data API v3 mediante Supabase Edge Function
- Reproducción: YouTube IFrame Player API
- Hosting recomendado: GitHub Pages

## Funciones incluidas

- Interfaz visual tipo jukebox digital
- Inicio con destacados, artistas, géneros y Top Honduras
- Navegación por carátulas
- Búsqueda de canciones
- Cola de reproducción en tiempo real
- Solicitudes desde celular
- Código de sala y QR
- Control de duplicados
- Límite de solicitudes por usuario
- Panel administrativo
- Historial reciente
- Modo demo local si Supabase aún no está conectado

## Configuración

1. Crea o asigna un proyecto de Supabase.
2. Ejecuta `supabase/schema.sql` en SQL Editor.
3. Habilita Anonymous Sign-Ins en Supabase Authentication.
4. Copia la URL y Publishable Key del proyecto en `js/config.js`.
5. Configura `YOUTUBE_API_KEY` como secreto de Supabase.
6. Despliega `supabase/functions/youtube-search/index.ts` como Edge Function.
7. Publica la rama `main` con GitHub Pages.

## Marca

**SanchezSound**  
*Digital Jukebox*
