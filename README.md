# Sala de Entrenamiento

Web de entrenamiento de ajedrez para Johan y Mari. No necesita servidor propio ni base de datos: todo corre en el navegador.

| Página | Qué hace |
|---|---|
| Dashboard | Ratings, Puzzle Storm, acierto por tema, resultados, aperturas y rivales frecuentes, leídos directamente de Lichess (totoelpollo y genio3015). |
| Análisis | Tablero con Stockfish 18 (3 líneas, barra de evaluación, flecha de la mejor jugada). Carga PGN o FEN y analiza la partida entera marcando imprecisiones (?!), errores (?) y errores graves (??). |
| Aperturas | Árbol de jugadas de tus partidas de Lichess, de un rival, de tu base local o del explorador de Lichess, con tus puntos en cada jugada. Repertorio guardado en el navegador. |
| Rivales | Escribe un usuario de Lichess (o un nombre de tu base local): rating, puntos con cada color, aperturas por color, primeras jugadas y todas sus partidas para abrirlas en Análisis. |
| Base de datos | Importa archivos PGN (partidas oficiales FIDE, TWIC, torneos) y busca por jugador, torneo o apertura. |
| Ajustes | Usuarios de Lichess, tokens de puzzles, fecha desde la que se descargan partidas, token de Lichess y profundidad de Stockfish. |

## Antes de empezar

No hace falta ninguna hoja de cálculo: ratings, Puzzle Storm y partidas se leen de la API pública de Lichess. La primera vez se descargan las partidas desde el 1 de enero de 2026 (se cambia en Ajustes) y después solo las nuevas; quedan guardadas en el navegador.

1. Opcional, para el acierto por tema de los puzzles: cada jugador crea un token en lichess.org/account/oauth/token marcando solo **"Leer la actividad de puzzles"** y lo pega en **Ajustes**. Los puzzles uno a uno son privados en Lichess y sin ese token no se pueden leer.
2. Opcional: un token de Lichess sin permisos para usar el explorador de maestros.

## Abrirla en tu ordenador

La web usa módulos de JavaScript y un Web Worker para Stockfish, así que hay que abrirla con un servidor local (no con doble clic en `index.html`):

```
cd ajedrez-web
python3 -m http.server 8000
```

y abre http://localhost:8000 en el navegador.

## Publicarla en internet (gratis)

Sube la carpeta a un repositorio de GitHub y activa **GitHub Pages** (Settings ▸ Pages ▸ rama `main`, carpeta raíz). También sirven Netlify o Cloudflare Pages arrastrando la carpeta.

## Estructura

```
index.html        páginas y navegación
css/app.css       estilos (tema claro y oscuro)
js/               código de cada página
vendor/           librerías incluidas: Stockfish 18 lite (GPLv3), chess.js, cm-chessboard, d3
```

Los datos que guardas (ajustes, repertorio, partidas importadas y datos descargados de Lichess) viven en este navegador. Si cambias de navegador o borras sus datos, tendrás que volver a importarlos.
