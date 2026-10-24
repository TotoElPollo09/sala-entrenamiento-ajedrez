# Sala de Entrenamiento

Web de entrenamiento de ajedrez para Johan y Mari. No necesita servidor propio ni base de datos: todo corre en el navegador.

| Página | Qué hace |
|---|---|
| Dashboard | Ratings, Puzzle Storm, acierto por tema, resultados, aperturas y rivales frecuentes, leídos de tu hoja de Google. |
| Análisis | Tablero con Stockfish 18 (3 líneas, barra de evaluación, flecha de la mejor jugada). Carga PGN o FEN y analiza la partida entera marcando imprecisiones (?!), errores (?) y errores graves (??). |
| Studio | Mesa de análisis al estilo ChessMonitor Studio. Cada panel es una pestaña que se arrastra: suéltala sobre otra pestaña para agruparlas o en el borde de un panel para dividirlo; los divisores cambian el tamaño y el diseño se recuerda. Varios tableros en pestañas, notación con variantes, comentarios y signos (!, ?, !?…), partidas de tu base que llegan a la posición, árbol de tu base filtrable por jugador y color, explorador de Lichess y Stockfish con 1 a 5 líneas (pulsa una jugada de la línea para añadirla como variante). Pega PGN con variantes o descárgalo. Las pestañas se guardan en el navegador. |
| Aperturas | Árbol de jugadas de tus partidas de Lichess, de un rival, de tu base local o del explorador de Lichess, con tus puntos en cada jugada. Repertorio guardado en el navegador. |
| Rivales | Escribe un usuario de Lichess (o un nombre de tu base local): rating, puntos con cada color, aperturas por color, primeras jugadas y todas sus partidas para abrirlas en Análisis. |
| Base de datos | Base grande (millones de partidas, ver abajo): busca partidas por jugador sin descargar la base. Además importa archivos PGN (partidas oficiales FIDE, TWIC, torneos o una base de ChessBase exportada a PGN) y busca por jugador, torneo o apertura. Con bases de millones de partidas, el filtro de importación (jugadores, ECO, Elo mínimo, años) guarda solo lo que vas a estudiar. |
| Ajustes | Usuarios de Lichess, ID de la hoja, token de Lichess, dirección de la base grande y profundidad de Stockfish. |

**Flechas y casillas** (en todos los tableros, como en chess.com): arrastra con el botón derecho para dibujar una flecha y haz clic derecho en una casilla para marcarla. Color normal naranja, con **Ctrl** rojo, con **Alt** azul y con **Mayús** verde. Repetirla con el mismo color la borra; un clic izquierdo en el tablero o cambiar de jugada lo borra todo.

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

## Base grande (millones de partidas)

Para una base enorme (por ejemplo 14 millones de partidas exportadas de ChessBase a PGN) la web no la importa en el navegador: se convierte una sola vez en miles de archivos pequeños y la página descarga solo el trozo que necesita (la posición del tablero, la partida que abres o el jugador que buscas), como el explorador de Lichess.

1. Instala Node.js (versión 20 o más nueva) desde nodejs.org.
2. En la carpeta de esta web ejecuta:

   ```
   node tools/construir-base.mjs "C:\ruta\a\tu-base.pgn" --salida base --nombre "Mi base"
   ```

   Opciones útiles: `--max-jugadas 30` (medias jugadas del árbol, por defecto 30), `--min-partidas 2` (posiciones con menos partidas se omiten), `--destacadas 300` (partidas de mayor Elo que se guardan por posición), `--elo 2000`, `--desde 1990`, `--hasta 2026`. Con 14 millones de partidas tarda del orden de una a tres horas y necesita unos 20 GB libres de disco mientras trabaja (se borran al terminar).
3. Publica la carpeta `base` resultante (si pesa menos de ~900 MB cabe en GitHub Pages; si no, en un alojamiento de archivos estáticos con CORS) y pon su dirección en **Ajustes ▸ Base grande**. Si la dejas en la carpeta `base/` de esta misma web no hace falta poner nada.

### Base privada en Cloudflare R2

1. Crea un bucket en Cloudflare R2 (gratis hasta 10 GB) y, en su pestaña *Settings ▸ CORS Policy*, permite `GET` desde `https://totoelpollo09.github.io`.
2. Crea un *API token* de R2 con permiso **Object Read only** para ese bucket. Guarda el *Access Key ID* y el *Secret Access Key*.
3. Sube la carpeta `base` (por ejemplo con `rclone copy base r2:NOMBRE-DEL-BUCKET/base --transfers 32`).
4. En **Ajustes ▸ Base grande** pega la dirección `https://ID-DE-CUENTA.r2.cloudflarestorage.com/NOMBRE-DEL-BUCKET/base/` y las dos claves. La web firma cada petición, así que la base no queda abierta a cualquiera.

En **Análisis** y **Studio** aparece la pestaña **Mi base** del explorador (jugadas, resultados, Elo medio y partidas destacadas de cada posición, con transposiciones) y en **Base de datos** el buscador de jugadores.

## Estructura

```
index.html        páginas y navegación
css/app.css       estilos (tema claro y oscuro)
js/               código de cada página
tools/            construir-base.mjs: convierte un PGN enorme en la base grande troceada
vendor/           librerías incluidas: Stockfish 18 lite (GPLv3), chess.js, cm-chessboard, d3
```

Los datos que guardas (ajustes, repertorio, partidas importadas) viven en este navegador. Si cambias de navegador o borras sus datos, tendrás que volver a importarlos.
