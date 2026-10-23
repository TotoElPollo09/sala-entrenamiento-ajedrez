# Sala de Entrenamiento

Web de entrenamiento de ajedrez para Johan y Mari. No necesita servidor propio ni base de datos: todo corre en el navegador.

| Página | Qué hace |
|---|---|
| Dashboard | Ratings, Puzzle Storm, acierto por tema, resultados, aperturas y rivales frecuentes, leídos de tu hoja de Google. |
| Análisis | Tablero con Stockfish 18 (3 líneas, barra de evaluación, flecha de la mejor jugada). Carga PGN o FEN y analiza la partida entera marcando imprecisiones (?!), errores (?) y errores graves (??). |
| Studio | Mesa de análisis al estilo ChessMonitor Studio. Cada panel es una pestaña que se arrastra: suéltala sobre otra pestaña para agruparlas o en el borde de un panel para dividirlo; los divisores cambian el tamaño y el diseño se recuerda. Varios tableros en pestañas, notación con variantes, comentarios y signos (!, ?, !?…), partidas de tu base que llegan a la posición, árbol de tu base filtrable por jugador y color, explorador de Lichess y Stockfish con 1 a 5 líneas (pulsa una jugada de la línea para añadirla como variante). Pega PGN con variantes o descárgalo. Las pestañas se guardan en el navegador. |
| Aperturas | Árbol de jugadas de tus partidas de Lichess, de un rival, de tu base local o del explorador de Lichess, con tus puntos en cada jugada. Repertorio guardado en el navegador. |
| Rivales | Escribe un usuario de Lichess (o un nombre de tu base local): rating, puntos con cada color, aperturas por color, primeras jugadas y todas sus partidas para abrirlas en Análisis. |
| Base de datos | Importa archivos PGN (partidas oficiales FIDE, TWIC, torneos o una base de ChessBase exportada a PGN) y busca por jugador, torneo o apertura. Con bases de millones de partidas, el filtro de importación (jugadores, ECO, Elo mínimo, años) guarda solo lo que vas a estudiar. |
| Ajustes | Usuarios de Lichess, ID de la hoja, token de Lichess y profundidad de Stockfish. |

## Antes de empezar

1. **Comparte la hoja de Google** como "Cualquier persona con el enlace: lector". Sin eso el dashboard no puede leerla.
2. En **Ajustes**, pega el enlace de tu hoja y escribe los usuarios de Lichess de Johan y Mari (para el árbol de tus aperturas).
3. Opcional: un token de Lichess (lichess.org/account/oauth/token, sin marcar permisos) para usar el explorador de maestros.

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

Los datos que guardas (ajustes, repertorio, partidas importadas) viven en este navegador. Si cambias de navegador o borras sus datos, tendrás que volver a importarlos.
