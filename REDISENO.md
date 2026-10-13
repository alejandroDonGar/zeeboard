# Rediseño de ZeeBoard — registro completo

Documento vivo con todo lo decidido en el rediseño: revisión inicial, seguridad, diseño, decisiones de lógica, maquetas, fallos encontrados y lo que falta. Se actualiza en cada paso.

- Rama de trabajo: `feature/glass-ui`. **Sin `git push`** hasta que el rediseño esté terminado y aprobado; `main` y la etiqueta `v0.2.0-antes-del-rediseno` guardan la versión anterior en GitHub.
- Commits con el usuario como único autor (sin líneas de coautor).
- Las maquetas viven en `maquetas-ui/` (fuera de git; se borra o se ignora al terminar).

---

## 1. Punto de partida

Estado al empezar esta fase: el rediseño «Vidrio cálido» (maqueta D) ya estaba aplicado en la app: paneles de cristal casi opacos, fondo con colores de la imagen, Fraunces + Manrope, paleta crema / carbón, esquinas rectas (3–6 px), accesibilidad (foco visible, Esc en diálogos, movimiento reducido, contraste).

Petición: revisarla con criterio de diseño (frontend-design, apple-design) y de seguridad, y hacerla **más segura, más bonita y más propia**, pudiendo mover cosas de sitio **sin cambiar cómo funciona**.

---

## 2. Revisión de seguridad

### Lo que ya está bien
- **CSP estricta** en `src-tauri/tauri.conf.json`: `default-src 'self'`, imágenes solo de `self`, `asset:` y `data:`; `assetProtocol` limitado a `$APPDATA/images/**`.
- **«Buscar foto»** (`src-tauri/src/avatars.rs`): solo https, lista cerrada de servidores (Bluesky, Telegram), también en las redirecciones, con límites de tiempo y tamaño, y pruebas de los casos peligrosos (`evil.com/t.me`, `t.me.evil.com`, `localhost`, IPs privadas).
- **Rutas de imágenes** (`images.rs::safe_image_path`): solo dentro de `images/` y solo componentes normales (sin `..`).
- **Enlaces** (`Linkified.tsx` + `lib/links.ts`): solo se abren http(s); lo demás se convierte a `https://`.
- **Servidor del iPad** (`ipad.rs`): clave obligatoria en cada petición, clave de ≥ 16 caracteres generada con `crypto.getRandomValues`, `/thumb` limitado a `images/thumbs/`, subidas de hasta 200 MB y validadas decodificando la imagen.
- **Copias de seguridad**: restaurar guarda antes una copia de lo actual (`before-restore/`) y nunca borra imágenes.

### Aplicado en la app (`src-tauri/src/ipad.rs`, `backup.rs`, con pruebas en Rust)
- **Solo desde la red local, Tailscale o el propio PC:** el servidor sigue escuchando en todas las interfaces (si no, Tailscale fallaría al cambiar de red), pero rechaza con 403 **antes de leer nada** cualquier petición que no venga de una dirección privada (10/8, 172.16/12, 192.168/16), de Tailscale (100.64.0.0/10 y `fd7a:…`, IPv6 local), enlace-local o el propio PC. Si el puerto quedara abierto a internet, nadie de fuera llega a la clave.
- **Clave comparada en tiempo constante.**
- **Una sola subida a la vez** (respuesta 429 «Ya se está recibiendo otra imagen»); se libera aunque procesar la imagen falle. La página del iPad ya enviaba las fotos una detrás de otra, así que no cambia nada para el usuario.
- **`restore_backup` solo acepta un sello de dígitos y guiones**: no puede crear la copia de seguridad fuera de `before-restore/`.
- **Descartado a propósito:** el apagado automático tras 15 min y la clave nueva en cada encendido. Obligarían a volver a activar el servidor o escanear el QR en cada sesión de trabajo, y con la clave + el filtro de red aportan poco. La clave se puede cambiar cuando se quiera con «Nueva clave».

### Cambios recomendados (revisión inicial)
| Prioridad | Problema | Cambio | Efecto en el uso |
|---|---|---|---|
| Alta | El servidor del iPad escucha en **todas las redes** (`0.0.0.0`) y por **HTTP sin cifrar**: alguien en la misma Wi-Fi que vea la clave puede leer la lista de comisiones y subir imágenes. | Escuchar solo en las direcciones que enseña la app: la de la red local **y la de Tailscale** (100.x; la app la usa para que el iPad llegue con datos móviles, así que no se puede quitar); **apagado automático** tras ~15 min sin uso; **clave nueva** cada vez que se enciende. Por Tailscale el tráfico ya va cifrado. | Igual, salvo volver a escanear el QR al encenderlo. |
| Media | Cada petición abre un hilo sin límite y acepta hasta 200 MB: varias subidas a la vez pueden agotar la memoria. | Una sola subida a la vez. | Ninguno. |
| Baja | La clave se compara con `!=` normal. | Comparación en tiempo constante. | Ninguno. |
| Baja | `restore_backup` usa `stamp` (viene de la interfaz) en una ruta sin validarlo. | Aceptar solo dígitos y guiones. | Ninguno. |
| Nota | `sql:allow-execute` da a la interfaz acceso completo a la base de datos. | Inevitable con el plugin SQL; la protección es la CSP: **nunca** añadir `unsafe-inline` ni `unsafe-eval` a scripts. | — |

---

## 3. Revisión visual y estructural

### Problemas encontrados en la app
- Cada página repite título grande + frase («Organize your drawings…») → ~90 px perdidos y aspecto de plantilla.
- Detalle de comisión: dos filas de chips casi iguales mezclando datos (fecha, revisiones) con etiquetas.
- Franja de pagos leída como una frase seguida.
- Barra inferior del detalle (Back / Mark as finished) cortada por el borde del panel.
- Filtros de Comisiones: seis controles en fila y dos «All» indistinguibles.
- Colores que mienten: «Waiting for payment» en rojo (no es error), «Unpaid 0» en rojo.
- Gráfico de ingresos: lo más pesado del Resumen siendo lo menos importante.
- Comisiones sin imagen: cuadros negros vacíos.
- Acciones inconsistentes: en Clientes «Delete» en rojo a la vista; en Comisiones va en el menú «…».
- «Not paid yet» sin decir de quién es cada comisión.
- Botones «+Alt», «+v», «×» sobre la imagen sin explicación.

### Estructura del código
- Archivos demasiado grandes: `CommissionsPage.tsx` (2468 líneas), `database.ts` (2190), `ClientsPage.tsx` (1260).
- Propuesta: partir Comisiones en lista, detalle, tarjeta de etapa, franja de pagos y barra de acciones; `database.ts` por entidad (comisiones, clientes, pagos, etiquetas). Mismo comportamiento.

---

## 4. Dirección de diseño

**Objetivo:** que no parezca hecho con IA («vibe coded»), profesional pero bonito y llamativo, basado en apps reales.

Se mantiene la maqueta **D «Vidrio cálido»** (descartadas A, B, C, E y F en la ronda anterior): paneles de cristal casi opacos, Fraunces para títulos, Manrope para el resto, crema / carbón, esquinas rectas.

### Referencias por pantalla
| Pantalla | App de referencia | Qué se toma |
|---|---|---|
| Comisiones (lista) | Linear | Filas compactas, punto de estado, fecha a la derecha, filtros como chips quitables, panel de propiedades. |
| Detalle de comisión | Apple Music | Cabecera teñida con los colores de la obra: el único momento de color fuerte. |
| Etapas | Lightroom / Apple Photos | Imagen grande y tira de etapas debajo. |
| Pagos | Stripe | Cifra grande con céntimos pequeños, barra pagado / pendiente, desglose al desplegar. |
| Resumen | Things 3 + Stripe | «Hoy» arriba y tranquilo; cifras en lista sin cajas; gráfico de línea. |
| Clientes | Contactos de macOS | Avatar y nombre grandes, datos de contacto en el lateral. |
| Solicitudes | Mail / Linear | Bandeja de entrada: lista + solicitud abierta. |
| Terminadas | Apple Photos | Galería por grupos con cabecera fija y visor. |
| Catálogo (tipos + etiquetas) | Linear (ajustes) | Lista agrupada + editor; nombre editable en el propio título; datos de uso al lado. |
| Barra lateral | Arc / Finder | Iconos finos, selección suave, contadores en gris. |

### Lo que delataba «vibe code» y cómo se resuelve
1. Todo en cajas iguales → espacio y líneas finas; solo 2–3 paneles grandes por pantalla.
2. Chips con fondo de color por todas partes → texto gris; color solo para estado (un punto) y una acción principal.
3. Título + frase en cada página → título pequeño en la barra superior.
4. «+» escrito en los botones → icono `+` y atajo en gris (`Ctrl N`).
5. Números sin jerarquía → cifra grande, céntimos y moneda pequeños, números de ancho fijo.
6. Movimiento por todas partes → solo donde responde a una acción.

---

## 5. Sistema de diseño (decisiones)

### Color
- **Colores de la imagen:** el fondo (3 manchas) y el tinte de la cabecera del detalle salen **automáticamente de la imagen que se está viendo** (mismo algoritmo que `src/lib/ambient.ts`: 12 tonos, se descartan grises / blancos / negros, se eligen 3 tonos separados ≥ 40°). Cambian con fundido al cambiar de comisión, etapa o alternativa. Un boceto en blanco y negro o sin imagen → tonos neutros.
- **Colores de etiqueta:** solo en la **barra vertical** a la izquierda de cada comisión. La fila seleccionada usa el resaltado neutro.
- **Intensidad del tinte:** se calcula por color para que el texto principal y el secundario sigan en **≥ 4,5:1** (tope 0,34 en claro y 0,30 en oscuro).
- **Colores de estado** solo dicen algo: verde = bien, ámbar = ojo, rojo = mal, azul = info. Nada en rojo si no es un error; nada coloreado si el valor es cero.

### Contraste (medido con la fórmula WCAG)
Ajustes del tema claro para que todo pase de 4,5:1 (también sobre las filas teñidas):

| Token | Antes | Ahora |
|---|---|---|
| `--muted` | `#5f5649` | `#4f473c` |
| `--faint` | `#6f6558` | `#5e564a` |
| `--warn` | `#9a5b00` | `#7a4800` |
| `--bad` | `#b83228` | `#a52a21` |
| `--ok` | `#1d7a4a` | `#1a6f43` |

- El atajo dentro del botón principal pasó de opacidad 0,55 (3,3:1) a 0,8 (6,7:1).
- Botones secundarios (Editar, ⋯) con **fondo sólido**, borde marcado y texto principal: antes se perdían sobre el tinte.
- Menús, desplegables y diálogos con **fondo sólido** (no cristal): sobre contenido se transparentaban y no se leían.
- La fecha en la cabecera va como texto normal + punto de color (el texto rojo / ámbar no pasaba sobre el tinte).

### Movimiento
- **La imagen no viaja** de la miniatura de la lista al detalle (probado y descartado por el usuario). Aparece **en su sitio**, con un fundido corto y un leve asentamiento, solo al cambiar de comisión, etapa o alternativa.
- **Cambio de tema instantáneo:** durante el cambio se desactivan todas las transiciones (clase `theme-switching` durante dos fotogramas). Antes, botones y secciones se quedaban atrás medio segundo.
- Respuesta al pulsar (`scale(.97)`); menús y desplegables salen desde su botón (`transform-origin`).
- `prefers-reduced-motion`: sin animaciones. `prefers-reduced-transparency`: paneles sólidos.

### Tipografía
- Fraunces solo en títulos de detalle / grupo; Manrope en todo lo demás. Sin etiquetas en mayúsculas.
- Cifras con `tabular-nums`.

### Espacio y ajuste (nada se tapa)
- Columnas con `minmax(0, 1fr)` y `min-width: 0` para que el contenido se ajuste.
- Imagen grande con `container-type: size`: nunca se sale de su hueco.
- Etapas en rejilla que pasa a otra línea en vez de cortarse.
- **< 1180 px:** el panel de propiedades pasa debajo. **< 960 px:** barra lateral solo con iconos.
- Solo se recorta (con «…» y texto completo al pasar el ratón) el título largo en las listas.
- Comprobación en cada maqueta: script que busca elementos con `scrollWidth > clientWidth`, a 1440, 1100 y 900–1000 px, en claro y oscuro.

---

## 6. Decisiones por pantalla

### Comisiones — aprobada
- Barra superior: título pequeño, búsqueda (`Ctrl K`), botón **Filtro** con chips quitables («Pago: Parcial ×»), Lista / Cuadrícula, «Nueva comisión» `Ctrl N`.
- Lista: filas con barra de color de la etiqueta principal, punto de estado, cliente · etapa, fecha («Hoy» rojo, ≤ 3 días ámbar).
- Detalle: cabecera teñida con la imagen; imagen grande con alternativas; **tira de etapas numerada** (las etapas sí son una secuencia); panel de propiedades (etapa, entrega, revisiones, etiquetas); pago estilo Stripe con «Ver cobros»; pie fijo (etapa anterior, marcar como terminada, aviso de `Ctrl+V`).
- Comisiones sin imagen: iniciales del cliente sobre su color.
- Con el Catálogo: la barra de color de la fila y el campo **Tipo** del panel salen de la plantilla; «Etiquetas» solo muestra extras y se oculta si no hay.

### Clientes — aprobada
- Lista con avatar, nombre, usuario y «1 en curso» o el total.
- Cabecera con avatar grande y nombre (teñida con los colores del avatar). **Sin datos de contacto bajo el nombre**: solo en el lateral.
- Lateral: **Red social** (`tag_platform` + `tag_handle`), **Telegram** (contacto), **Correo** (del formulario), **Cliente desde** (fecha de alta, al aceptar la solicitud). Etiqueta encima del valor para que no se corte.
- Acciones: «Editar» a la vista; «Buscar foto», «Nueva comisión para…» y «Borrar cliente…» en el menú ⋯.
- Cifras sin cajas: gastado (+ media), comisiones (en curso · terminadas), pendiente de cobro (ámbar solo si > 0).
- Comisiones del cliente con las mismas filas que en Comisiones; personajes como galería con sus referencias; notas que se guardan solas.
- Sin separadores por letra (con pocos clientes solo ocupan sitio).

### Resumen — aprobada
- «Hoy» con lo urgente (vence hoy, sin avances) y su motivo como punto + texto.
- «En curso» con las filas de Comisiones y barra de progreso fina.
- **Recibido por mes: gráfico de línea** (al usuario le encantó; se reutilizará en Estadísticas): área suave, punto por mes, cantidad al pasar el ratón, mes en curso relleno y **último tramo discontinuo** porque el mes no ha terminado; total y media encima. Descartados: barras verticales y lista con barras horizontales.
- Lateral: «Este mes» en lista (recibido, pendiente, en curso, vencen en 7 días), «Sin cobrar» con el cliente y el total, tarifa por hora, etiquetas más usadas.

### Solicitudes — aprobada
- Barra superior: Cerradas / Abiertas, huecos como cuadritos («6 de 8 · 2 libres», rojo si te pasas) con el total editable, «Importar CSV», «Nueva solicitud».
- Lista: Nuevas, En espera (con aviso de huecos libres), Archivo plegable; punto por estado; aviso ámbar si falta el tipo. Al pie, el formulario conectado con ⋯ (Revisar ahora, Cambiar archivo…).
- Detalle: lo que pide (con enlaces), y al lado tipo (selector ámbar si falta), personajes, estimado, contacto, red social, correo.
- Pie con acciones según el estado (mismas reglas que hoy): Aceptar se desactiva sin tipo y dice por qué; con huecos llenos pide confirmación y ofrece «Poner en espera»; Rechazar, Restaurar, Abrir comisión; «Quitar de la lista» con «Deshacer».
- Diálogos con `<dialog>` nativo (foco atrapado y Esc gratis).

### Terminadas — aprobada
- Galería por mes o por cliente, cabecera de grupo fija con número e importe; total y €/h por plantilla arriba.
- Búsqueda, rango de fechas y «Borrar filtros» (solo si hay filtros).
- Pulsar la imagen abre un visor; el fondo toma sus colores mientras está abierto. El texto lleva a la comisión.

### Catálogo (une Plantillas y Etiquetas) — aprobada · lógica migrada a la app
Las dos pantallas por separado quedaban vacías. Además, revisando la lógica se vio que **se duplican**: cada plantilla tenía una etiqueta con el mismo nombre en la categoría «Commission Type», y al aceptar una solicitud `autoTagIds` (`src/lib/formImport.ts`) buscaba esa etiqueta por nombre para añadirla. Decisión del usuario: **el tipo da el color**.

**Lógica nueva**
- **Tipo de comisión = plantilla + color.** Nueva columna `templates.color`. La barra de color de cada comisión, su chip de tipo y el filtro por tipo salen de `commission.template_id`, no de una etiqueta.
- **Etiquetas solo para extras** (Rush, uso comercial, número de personajes…), con sus categorías como hasta ahora.
- **Migración — hecha en la app, sin borrar nada** (petición del usuario: «asegúrate de que no se borre nada»):
  - Nueva columna `templates.color`. Al arrancar, cada plantilla **sin color** recibe el de su etiqueta de «Commission Type» (la más específica cuyas palabras están en el nombre de la plantilla, la misma regla que usaba `autoTagIds`), o uno de `PALETTE` si no tiene. Solo rellena huecos (`WHERE color IS NULL`): volver a arrancar no cambia nada.
  - **Las etiquetas de tipo y sus enlaces con las comisiones se conservan tal cual.** Simplemente no se muestran en las comisiones, en el selector de etiquetas del formulario ni en el filtro; en su lugar se muestra el tipo (plantilla) con su color. En Catálogo › Etiquetas, la categoría «Commission Type» lleva un aviso explicándolo; el usuario puede borrarlas a mano (con «Deshacer») cuando quiera.
  - Código: `src/lib/catalog.ts` (`PALETTE`, `TYPE_CATEGORY`, `typeTagsFor`, `templateColors`; puro, comprobado en `scripts/check-catalog.ts`), migración en `getDatabase` (`src/lib/database.ts`), `updateTemplateColor`; plantillas nuevas y duplicadas ya nacen con color.
- **`autoTagIds`** ya solo añade la etiqueta de «Characters» (firma nueva: `autoTagIds(personajes, etiquetas)`); `scripts/check-form-import.ts` actualizado.
- **Pantalla Catálogo (hecha):** `src/pages/CatalogPage.tsx` sustituye a Plantillas y Etiquetas en la barra lateral: lista única (tipos y etiquetas por categoría) y editor a la derecha (`catalog/TypeEditor.tsx`, `catalog/TagEditor.tsx`, `catalog/Swatches.tsx`). `TemplatesPage.tsx` y `TagsPage.tsx` desaparecen; su lógica pasó a esos componentes sin cambiar (guardar con «Guardar cambios», color del tipo al momento, borrar con deshacer, un tipo en uso no se puede borrar).
- **Dónde se ve el tipo:** chip del tipo con su color en el detalle y en la cuadrícula de Comisiones; grupo «Tipo de comisión» en el filtro (las plantillas como opciones); el Resumen cuenta «Tipos y etiquetas más usados» a partir de la plantilla.
- Pendiente de valorar (no decidido): hacer lo mismo con las etiquetas de «Characters», que también se pueden deducir del número de personajes de la comisión.

**Pantalla**
- Barra lateral: **Catálogo** sustituye a Plantillas y Etiquetas.
- Lista: «Tipos de comisión» (color, etapas · precio, «n en curso») y debajo cada categoría de etiquetas (color, «en n» / «Sin usar»), cada grupo con «Añadir».
- **Editor de tipo:** nombre editable en el título (cabecera con un tinte suave de su color), precio base, revisiones incluidas, color (12 colores + personalizado); etapas numeradas con arrastrar y soltar, quitar y añadir con Enter (antes de la final) y el aviso de la última etapa. Lateral con datos reales que llenan la pantalla: **comisiones en curso** de ese tipo y **rendimiento** de las terminadas (entregadas, precio medio, horas de media, €/h; los mismos cálculos que ya hace Terminadas). Pie: Duplicar; Borrar bloqueado si está en uso con el motivo; «Guardado» automático.
- **Editor de etiqueta:** nombre en el título, categoría (con sugerencias de las existentes, o una nueva), color; lista de comisiones que la tienen; Borrar con «Deshacer».

### Estadísticas — aprobada
Mismos datos que hoy (`computeStats` en `src/lib/stats.ts`), recolocados al estilo de los informes de Stripe:
- Barra superior: periodo **Este año / Últimos 12 meses / Todo** y, a la derecha, el aviso de comisiones en otra moneda que no se suman.
- **Cifras clave** en una fila separada por líneas finas (sin cajas): recibido, piezas entregadas, media por pieza, por hora; cada una con su cambio respecto al periodo anterior (▲ verde, ▼ rojo; «Sin periodo anterior» en «Todo»).
- **Recibido por mes**: el mismo gráfico de línea del Resumen, más alto, con los meses del periodo.
- **Por tipo de comisión**: tabla con números alineados a la derecha (piezas, media, horas, €/h, días de media); cada tipo con su color del Catálogo.
- **Mejores clientes**: los 5 con barra proporcional y la frase de cuánto viene de clientes que repiten.
- **Solicitudes**: un embudo en una sola barra (aceptadas, rechazadas, en espera, sin responder) con leyenda y el % de aceptación de las decididas.
- **Comisiones de las plataformas**: total, % de lo pagado y aviso de cobros sin la cantidad recibida.
- Pendiente de decidir: la app tiene también solicitudes por mes (`requests.months`); en la maqueta solo está el embudo.

### Ajustes — aprobada
Mismas opciones que `SettingsPage.tsx` + `IpadSettings.tsx`, ordenadas como los Ajustes del sistema de macOS: **secciones a la izquierda, filas agrupadas a la derecha** (título + explicación a la izquierda, control a la derecha). Todo se guarda solo.
- **General:** tema (Claro / Oscuro / Sistema; cambia al momento, sin desfase) e idioma.
- **Precios y pagos:** moneda por defecto, % por personaje extra, plataformas de pago (nombre, % + fijo, vista previa «200 € → …», quitar, añadir).
- **Plazos y avisos:** plazo de entrega prometido, recordatorios de entrega (interruptor + días antes), comisiones paradas (días).
- **iPad:** interruptor, código QR, enlace (oculto en modo privado) con «Copiar enlace», estado de Tailscale, aviso del cortafuegos, otras direcciones y «Nueva clave».
- **Copias de seguridad:** automáticas (interruptor, carpeta, cuántas guardar, última copia), copia ahora, restaurar.
- **Datos y almacenamiento:** exportar CSV (comisiones, pagos, resumen trimestral), importar pagos de PayPal, uso de disco en una barra (imágenes, miniaturas, base de datos) e imágenes sin usar.
- **Papelera:** elementos con restaurar y borrar para siempre (con confirmación), vaciar papelera; el número aparece en la sección.
- Interruptores: `<input type="checkbox">` nativo con aspecto de interruptor (accesible por teclado sin código extra).

### Ventanas sueltas — en revisión
Maqueta `ventanas.html`: una página con un botón por ventana. Todas son `<dialog>` nativos (Esc, foco atrapado, clic fuera para cerrar), fondo sólido, título en Fraunces y acciones abajo a la derecha.
- **Nueva comisión** (formulario de `CommissionsPage.tsx`): a la izquierda título, cliente (con sugerencias), tipo (con el aviso de que no se puede cambiar después), personajes, fecha límite opcional, precio (calculado, editable), etiquetas extra y notas; a la derecha un **resumen en vivo**: tipo, sus etapas, desglose del precio (base + personajes extra al 50 % = total) y entrega.
- **Pagos** (`CommissionPayments.tsx`): cifra pagada, «de» precio y lo que falta; barra; tabla de pagos (fecha y nota, lo que pagó el cliente, lo recibido o «Sin apuntar» en ámbar, comisión, quitar); fila para añadir un pago que calcula **lo que recibirás** según la plataforma.
- **Importar de PayPal** (`PaypalImport.tsx`): «n de m pagos listos»; cada pago con casilla, cliente, correo, fecha → comisión y lo que recibes; los que no se pueden importar, desactivados con el motivo («Ya importado», «Ningún cliente con este correo» en ámbar, «No le queda nada por pagar»).
- **Marcar como terminada** (`FinishCommissionModal.tsx`): zona para la imagen final (elegir, arrastrar o `Ctrl+V`), fecha de entrega, horas (acepta coma decimal, «7,5») y notas finales.
- **Atajos de teclado** (`ShortcutsHelp`): la lista de siempre; se añade `Ctrl V` (pegar imagen en la etapa abierta), que la app ya hace pero no aparecía en la lista.
- **Paleta de comandos** (`CommandPalette.tsx`, estilo Linear / Raycast): arriba, resultados agrupados (Pantallas, Comisiones, Clientes, Acciones) con su atajo o estado a la derecha; ↑ ↓ para moverse, Enter para abrir, Esc para cerrar.

Nota del usuario: algunas pantallas quedan algo vacías; él irá añadiendo ajustes y contenido más adelante.

### Pendientes
Ninguna maqueta pendiente: falta aprobar las ventanas sueltas y empezar la migración (sección 10).

---

## 7. Maquetas y código compartido

Servidor local: `Desktop/.claude/launch.json` → «maquetas» (`python -m http.server 8765`), `http://localhost:8765/<pantalla>.html`.

| Archivo | Para qué |
|---|---|
| `base.css` | Tokens de color, cristal, barra lateral y superior, botones, filas, menús ⋯, diálogos, campos, avisos, responsive. Colores animables con `@property`. |
| `shell.js` | Barra lateral común (según `<body data-page>`) y `setTheme()` (cambio de tema instantáneo), usado por el botón de la barra y por Ajustes. |
| `chart.js` | Gráfico de línea compartido (`lineChart(meses, alto)`), usado en Resumen y Estadísticas. |
| `ambient.js` | Saca los colores de la imagen y los aplica con fundido; calcula el tinte seguro por color. |
| `art.js` | Personaje de ejemplo para miniaturas y avatares. |
| `comisiones.html`, `clientes.html`, `resumen.html`, `solicitudes.html`, `terminadas.html`, `catalogo.html`, `estadisticas.html`, `ajustes.html`, `ventanas.html` | Una pantalla cada una, con datos de ejemplo y su lógica mínima. |

Regla: **reutilizar antes de escribir**. Si un estilo o función lo usan dos pantallas, pasa a `base.css` / un `.js` compartido.

---

## 8. Fallos encontrados durante las maquetas (y corregidos)
- Imagen grande que pisaba el panel de propiedades en ventanas estrechas (filas de rejilla que colapsaban a 32 px) → flujo en bloque por debajo de 1180 px.
- Menú ⋯ de Clientes detrás del contenido y transparente → la cabecera crea su propia capa y los menús son sólidos.
- Fichas de personaje con huecos vacíos con < 3 referencias → rejilla según el número de referencias.
- **Colores de imagen que no funcionaban en Clientes**: el SVG del avatar no tenía `xmlns` y el navegador no lo decodificaba; el error se tragaba en silencio y se volvía a neutro → `xmlns` añadido en `art.js`.
- «Borrar filtros» visible sin filtros (`display` del botón pisaba `hidden`) → `.btn[hidden] { display: none }`.
- Botones Cancelar / Crear aplastados en Etiquetas (la regla de las muestras de color los alcanzaba) → selector limitado a `[data-color]`.
- Catálogo a 1000 px: los colores no pasaban de línea y el «+» de color personalizado se estiraba → la regla solo para el hijo directo.
- Plural «1 libres» → «1 libre».
- Gráfico de línea: al pasarlo a función compartida, los puntos quedaban a la izquierda de la línea (perdían el centrado) → `left: 50%`; la etiqueta del mes en curso se salía por la derecha en ventanas estrechas → anclada a la derecha.
- Las maquetas abiertas como archivo no cargaban CSS / JS compartidos → servidor local.

---

## 9. Guía para pasar las maquetas a la app (para otra sesión)

Esta sección está pensada para dársela a otra conversación (p. ej. con Sonnet) que haga la migración. **El código completo de las maquetas está en el anexo (sección 11)** y también en `maquetas-ui/`.

### Reglas que no se pueden romper
- **El funcionamiento no cambia**: mismos datos, mismas acciones, mismas reglas (p. ej. Aceptar desactivado sin tipo, Borrar plantilla desactivado si está en uso, deshacer con `Ctrl+Z` / avisos con «Deshacer»). Solo cambia dónde está cada cosa y cómo se ve.
- Rama `feature/glass-ui`; commits locales con el usuario como único autor, **sin líneas `Co-Authored-By`**; **nunca `git push`** hasta que el usuario diga que el rediseño está terminado.
- Textos con `t("…")` y su traducción en `src/lib/es.ts` (la app está en inglés con español; las maquetas están solo en español). `scripts/check-i18n.ts` comprueba que no falte ninguna.
- Datos privados con `hide(...)` y `data-private` como ya hace la app (modo privado).
- Imágenes siempre por `thumbUrl` / `imageUrl` de `src/lib/images.ts` (miniaturas optimizadas; los lienzos originales pesan 40–70 MB).
- Iconos: la app ya usa `@tabler/icons-react`; usar esos, no SVG a mano.
- Al terminar cada pantalla: actualizar README, `docs/index.html` y la captura de `docs/images/`.

### Dónde va cada cosa
| Maqueta | Archivo(s) de la app | Notas |
|---|---|---|
| `base.css` (tokens, contraste) | `src/App.css` (`:root`, tema oscuro, `@theme inline`) | Copiar los tokens nuevos del tema claro (sección 5). Añadir `@property` para `--a1..--a3`, `--tint`, `--tint-strength`. |
| `ambient.js` | `src/lib/ambient.ts`, `src/components/AmbientBackground.tsx` | `dominantColors` ya existe en la app; añadir el tinte de cabecera (`--tint`) y `safeStrength`. El fundido pasa a `@property` + `transition` en `:root`. |
| `shell.js` (barra lateral, tema) | `src/App.tsx` (barra lateral) y donde se cambie el tema (Ajustes) | Añadir la clase `theme-switching` durante dos `requestAnimationFrame` al cambiar el tema. |
| Barra superior | `src/components/PageHeader.tsx` | Título pequeño sin frase; acciones a la derecha. |
| `comisiones.html` | `src/pages/CommissionsPage.tsx` (partirlo), `BoardFilters.tsx`, `CommissionPayments.tsx`, `TagChip.tsx` | Filtro con chips; tira de etapas; panel de propiedades; pago estilo Stripe; pie fijo. |
| `clientes.html` | `src/pages/ClientsPage.tsx` | Contacto solo en el lateral; acciones en ⋯. |
| `resumen.html` | `src/pages/DashboardPage.tsx` | Gráfico de línea: hacer un componente `LineChart` compartido con Estadísticas (como `chart.js`). |
| `ajustes.html` | `src/pages/SettingsPage.tsx`, `src/components/IpadSettings.tsx` | Navegación por secciones dentro de la página; mismo comportamiento de cada opción. |
| `estadisticas.html` | `src/pages/StatisticsPage.tsx` | Mismos cálculos de `stats.ts`; `changePercent` para los ▲▼. |
| `solicitudes.html` | `src/pages/RequestsPage.tsx`, `ConfirmModal.tsx` | Bandeja lista + detalle. |
| `terminadas.html` | `src/pages/FinishedPage.tsx` | Galería + visor; el visor llama a `useAmbientImage`. |
| `catalogo.html` | `src/pages/CatalogPage.tsx` (**lógica ya migrada**, ver «Catálogo» en la sección 6) | Falta solo el aspecto de la maqueta: lista única de tipos + categorías de etiquetas y editor con «En curso» y «Terminadas». |
| `ventanas.html` / diálogos y menús | `CommissionsPage.tsx` (formulario), `CommissionPayments.tsx`, `PaypalImport.tsx`, `FinishCommissionModal.tsx`, `CommandPalette.tsx` (`ShortcutsHelp`), `DialogBehavior.tsx`, `ConfirmModal.tsx` | Fondo sólido `--surface`; mantener Esc y foco atrapado (ya los da `useDialog`); mismos cálculos (`calculateCommissionPrice`, `receivedAfterFees`). |

### Cómo comprobar cada paso
```bash
npm run build
```
```bash
npx tsx scripts/check-i18n.ts
```
(y el resto de `scripts/check-*.ts` si se toca su lógica), y abrir la app con `npm run tauri dev`: claro y oscuro, ventana a 1440, 1100 y 900 px, nada tapado ni cortado, cambio de tema instantáneo.

---

### `CommissionsPage.tsx` partido (hecho)
De 2481 a 1466 líneas, **sin cambiar nada de su comportamiento**. Las piezas que no dependen del detalle salen a `src/pages/commissions/`:
- `CommissionForm.tsx` — formulario de nueva / editar comisión. **Guarda su propio estado** (antes eran 16 `useState` en la página); la página solo sabe si está abierto y, al guardar, recarga la lista y abre la comisión.
- `FocusViewer.tsx` — modo foco (imagen a pantalla completa, versiones, chinchetas de corrección, ← →). Las chinchetas (`pinMode`, `pinDraft`, `openPinId`) y su teclado viven ahí; al estar montado solo mientras está abierto, se cierran solas al salir.
- `CommissionGrid.tsx` — vista en cuadrícula.
- `CommissionList.tsx` — columna de la lista (en curso y cola).
- `DeadlineCalendar.tsx` — calendario lateral de la vista en cuadrícula.
- Queda en la página el detalle de la comisión (etapas, imágenes, correcciones, pagos), que comparte casi todo su estado; se puede seguir partiendo en la pasada visual.

### Pasada visual en la app — registro
**Cimientos (hechos con el Resumen, valen para todas las pantallas):**
- `src/App.css`: grises y colores de estado del tema claro más oscuros (`--muted #4f473c`, `--faint #5e564a`, `--tone-ok #1a6f43`, `--tone-warn #7a4800`, `--tone-bad #a52a21`) para llegar a 4,5:1; clase `.theme-switching` (sin transiciones durante el cambio de tema).
- `src/lib/theme.ts`: `applyTheme` pone `.theme-switching` y la quita dos fotogramas después, así todo cambia a la vez.
- `src/components/TopBar.tsx`: barra superior de cristal (título pequeño, controles opcionales, acción principal con icono `+` y atajo en gris). **Sustituye a `PageHeader`**, que se borra cuando la use la última pantalla. Las pantallas portadas usan `<div className="flex h-full min-h-0 flex-col gap-3 text-sm">` + `TopBar` + una sección `glass` que ocupa el resto.
- `src/components/Money.tsx` (céntimos y moneda pequeños, números de ancho fijo) y `src/components/LineChart.tsx` (gráfico de línea; **se reutiliza en Estadísticas**).
- Barra lateral (`App.tsx`): selección suave (`bg-highlight`) en vez de bloque oscuro, contador de Solicitudes en gris, iconos más finos (trazo 1,5), «Modo privado» sin borde.
- Traducción de «Dashboard» → **«Resumen»** (antes «Panel»), igual que en las maquetas.

**Resumen (hecho):** `DashboardPage.tsx` reescrito con el diseño aprobado; **la lógica de datos no se ha tocado** (mismos cálculos de antes).
- «Hoy»: lo que necesita atención, con su miniatura, cliente y estado (se reutilizan los chips `ATTENTION_STYLE`).
- «En curso»: filas con la **barra del color del tipo** (plantilla), miniatura, etapa n/m, progreso y plazo; columnas de ancho fijo para que todo quede alineado.
- Gráfico de línea «Recibido por mes» con total y media de 6 meses; el mes en curso con el último tramo discontinuo.
- Columna derecha: «Este mes» en lista (pendiente de cobro en ámbar solo si hay), «Sin cobrar» con cliente y total, tarifa por hora, tipos y etiquetas más usados.
- Botón «Nueva comisión · Ctrl N» en la barra superior: hace lo mismo que el atajo (`requestAction("new-commission")` + ir a Comisiones).
- **Ajuste a la ventana:** como la app tiene barra lateral, el diseño de dos columnas depende del **ancho del contenedor** (`@container` + `@min-[880px]`), no del de la ventana. Por debajo, la columna derecha pasa debajo en una rejilla de 2 columnas.
- Tamaño de texto base de la pantalla: 14 px (`text-sm`), como en las maquetas.

**Cómo se comprobó (útil para las demás pantallas):** `npm run tauri dev`, ventana a 1216×799 (tamaño por defecto) y a 1066×700 (mínimo), en claro y oscuro, y a 3456 px de ancho. Nada se corta, solapa ni desborda. Las capturas se hicieron con `PrintWindow` desde PowerShell (el capturador de pantalla de la herramienta deslava los colores de WebView2). Cuidado: `open_application "ZeeBoard"` abre la app **instalada** (versión antigua), no la de desarrollo.

**Comisiones (hecho):** `CommissionsPage.tsx` pasa de 1466 a 1142 líneas; el comportamiento no cambia (mismos datos, filtros, atajos, arrastrar y pegar imágenes, correcciones, pagos, modo foco).
- Barra superior con búsqueda, un solo botón **Filtro** (pago, estado, tipo y etiquetas dentro; lo elegido sale como chips que se quitan con ✕ y «Borrar filtros»), cambio Lista / Cuadrícula con iconos y «Nueva comisión · Ctrl N». `BoardFilters.tsx` reescrito (mismo estado que antes: `filterTagIds`, `filterStatus`, `filterPayment`); `Segmented` admite iconos.
- Lista (`CommissionList.tsx`): barra con el color del tipo, miniatura (o iniciales), punto de estado, cliente · etapa y plazo.
- Detalle: **cabecera teñida con los colores de la imagen que se está viendo** (`tintStrengths()` en `lib/ambient.ts` calcula cuánto tinte aguanta el texto, una intensidad por tema; el CSS `.hero-tint` elige y anima el color), título en Fraunces, cliente · plataforma, Editar y menú ⋯ con fondo sólido.
- `StageViewer.tsx`: la imagen de la etapa elegida **en grande** (alternativas, versiones, + Alt / + v / ×, clic = modo foco) y debajo **la tira de etapas** numeradas (miniatura, ✓ o número, correcciones). Cada etapa y la imagen grande siguen siendo zonas para soltar imágenes (`data-image-drop`). La etapa grande es la actual hasta que se elige otra; al avanzar o añadir imágenes a una etapa, pasa a verse esa. El fondo de la app y el tinte siguen a esa imagen.
- `CorrectionsPanel.tsx`: lista de correcciones de una etapa (con chinchetas), campo para añadir y botones de versión retocada; guarda su propio texto.
- `CommissionInfo.tsx`: columna de propiedades (tipo, etapa, entrega, revisiones, cuenta para etiquetar), etiquetas, **pagos** (importe pagado en grande, barra, lo que falta y lo recibido; los cobros se despliegan en la misma columna en vez de un menú flotante), notas y personajes.
- Pie fijo: Atrás, avanzar / Marcar como terminada / Terminada, y «Ctrl+V añade a …».
- Ajuste: el detalle usa `@container`; con ≥ 760 px de ancho van dos columnas (imagen y tira a la izquierda, propiedades a la derecha); por debajo (lo normal en la ventana por defecto, por la lista de 320 px) se apilan y **solo hay un scroll**, con las propiedades en rejilla de columnas bajo la tira.
- **Trampa de CSS encontrada:** un hijo de rejilla con `min-h-0` dentro de una rejilla con scroll puede encogerse por debajo de su contenido y solaparse con el siguiente (`minmax(0,1fr)` + `min-height` tampoco lo evitan). Se arregla con `minmax(14rem,1fr)` en la fila y quitando `min-h-0` cuando el contenido apila.
- Cuadrícula: tarjetas con el contenido arriba y sin elevarse al pasar el ratón.
- Traducciones nuevas: Filtro, Estado, Tipo, Etapa, Etapas, Correcciones, «Alternativa n de m», «de {importe}», «Sin tarifa».

**Clientes (hecho):** mismos datos y flujos (alta, edición, borrado con deshacer, foto por clic / arrastrar / Ctrl+V, personajes y referencias); solo cambia la presentación.
- `TopBar` + lista de clientes (avatar, usuario y «N en curso» o el total) + detalle en panel de cristal con `@container`.
- Cabecera con avatar grande y nombre, **teñida con los colores de la foto** (no en modo privado). Sin datos de contacto bajo el nombre; «Editar» a la vista y menú ⋯ con «Buscar foto» (si hay cuenta Bluesky/Telegram) y «Borrar cliente…».
- Cifras sin cajas: gastado (+ media), comisiones (activas · terminadas), **pendiente de cobro** (suma de lo que falta por comisión; ámbar si > 0). Sustituye a los contadores «pagadas / sin pagar».
- Comisiones del cliente con barra del color del tipo (`getTemplates()`), miniatura, progreso · plazo, estado de pago e importe. Personajes como galería con mosaico de referencias (1, 2 o 3+ con «+N»); el panel del personaje abierto conserva su lógica.
- Lateral: Red social (cuenta para etiquetar), contacto (con el nombre de su plataforma), Correo, Cliente desde, y **Notas que se guardan solas** al salir del campo (antes solo se editaban en el formulario).
- No portado: «Nueva comisión para…» del menú (la ventana de nueva comisión no admite cliente previo todavía).

**Solicitudes (hecho):** misma lógica (aceptar con confirmación si los huecos están llenos, en espera, rechazar, restaurar, abrir comisión, quitar con deshacer, importar CSV, formulario sincronizado, alta manual); solo cambia la presentación.
- Barra superior: Cerradas / Abiertas, huecos como cuadritos con «N libres / lleno / N de más» (el texto largo «6 de 8 huecos» solo desde 1500 px) y el total editable, «Importar respuestas…» y «Nueva solicitud».
- Bandeja en dos columnas: lista (Nuevas, En espera con aviso de huecos libres, Archivo plegable; punto por estado; «Elige el tipo…» en ámbar si falta) y detalle de la solicitud elegida (si desaparece de la lista pasa a la siguiente pendiente).
- Detalle: nombre grande, estado y fecha; «Lo que pide» con enlaces; lateral con Tipo (selector ámbar si falta), Personajes, Estimado, Contacto, Red social y Correo; pie con acciones según estado (Aceptar se desactiva sin tipo y lo dice).
- Al pie de la lista, el estado del formulario conectado con ⋯ (Revisar ahora, Cambiar archivo…).
- Sigue igual: el diálogo de nueva solicitud y la confirmación de huecos llenos (se pasarán a `<dialog>` con las ventanas).

**Terminadas (hecho):** mismos filtros, agrupación y cifras; solo cambia la presentación.
- Barra superior: Por mes / Por cliente, búsqueda, rango de fechas y «Quitar filtros» (solo si hay filtros).
- Galería tipo Fotos: totales y €/h por plantilla arriba, grupos con cabecera fija (mes en Fraunces, número e importe) y cuadrícula de imágenes cuadradas con título, importe y «cliente · horas · €/h» (en «Por cliente», la fecha en vez del cliente). Pulsar la imagen abre el visor; pulsar el texto abre la comisión.
- Visor: la imagen sola con pie «título · cliente · fecha» y «Abrir comisión»; **el fondo toma sus colores mientras está abierto** (`useAmbientImage`). Sigue siendo la capa a pantalla completa de antes (pasará a `<dialog>` con las ventanas).

**Catálogo (hecho):**
- Barra superior con «Nueva etiqueta» y «Nuevo tipo». Lista única: «Tipos de comisión» (cuadrado del color, «N etapas · precio», «N en curso») y una sección por categoría de etiquetas (punto del color, «N comisiones» o «Sin usar»).
- Editor de tipo: cabecera teñida con el color del tipo, nombre editable, precio base, revisiones incluidas y selector de color (se guarda al momento); etapas numeradas que se reordenan arrastrando (la última, discontinua y verde, se oculta hasta «Marcar como terminada»); lateral con «En curso» (abre la comisión) y cifras de lo entregado (número, precio medio, horas medias, €/h). Pie: Duplicar, Borrar, Guardar cambios.
- Editor de etiqueta: nombre, categoría (solo al crear; cambiarla en una existente no estaba antes y sigue sin estarlo), color, vista previa y número de comisiones. Las de «Commission Type» siguen con su aviso.
- Cambio: ya no se pueden crear categorías vacías (no tenían sentido); la categoría se escribe al crear la primera etiqueta.

**Estadísticas (hecho):** mismos datos (`computeStats`); solo cambia la presentación.
- Barra superior: periodo (Este año / Últimos 12 meses / Todo) y el aviso de comisiones en otra moneda.
- Cifras clave sin cajas con su cambio (▲ / ▼; «Sin periodo anterior» si no hay con qué comparar), `LineChart` del Resumen más alto (con «Este año» la línea acaba en el mes en curso, no en diciembre), tabla por tipo con el color del Catálogo, mejores clientes con barra proporcional, embudo de solicitudes en una barra y comisiones de plataformas.
- Cambio: el mini gráfico de solicitudes por mes se sustituye por el embudo (los datos mensuales se siguen calculando, solo no se dibujan).

### Limpieza de código (hecha)
Revisión de todo lo que solo ocupaba sitio, sin tocar datos del usuario:
- 20 traducciones de `es.ts` que ya no usaba ningún código (textos antiguos de cabeceras, avisos y la pantalla de Plantillas/Etiquetas).
- La propiedad `label` de `PageHeader`, que ya no se mostraba y todas las pantallas seguían pasando.
- Imágenes de la plantilla inicial sin usar: `public/tauri.svg`, `public/vite.svg`, `src/assets/react.svg`.
- Dependencia Rust `serde_json` (no la usaba el código; `cargo check` correcto sin ella).
- Clase CSS `.chip-info` sin uso.
- `export` innecesarios en funciones que solo se usan en su propio archivo (`setAmbientImage`, `createBackup`, `importImageFromPath`).
- Se **conservan** a propósito las migraciones antiguas de datos (`migrateLegacyImages`, `migratePaymentTags`): hacen falta si algún día se restaura una copia de seguridad antigua.

## 10. Plan para pasar a la app

Estado: **hechos** — lógica del Catálogo, seguridad del iPad y copias, limpieza de código y `CommissionsPage.tsx` partido (commits en `feature/glass-ui`). **Pasada visual en marcha (Sonnet):** Resumen, Comisiones, Clientes, Solicitudes, Terminadas, Catálogo y Estadísticas hechos; siguen Ajustes y ventanas, siguiendo las secciones 5, 6 y 9 y el anexo.

1. Terminar y aprobar las maquetas que faltan.
2. Seguridad del iPad y de copias (sección 2).
3. Tokens de color nuevos en `App.css` y `@property` para los colores animables; tinte seguro por color en `ambient.ts`.
4. Pantalla por pantalla, en el orden de las maquetas, partiendo los archivos grandes al tocarlos.
5. Actualizar README, `docs/index.html` y capturas al terminar cada pantalla.
6. Commits en `feature/glass-ui`; push solo cuando el usuario dé el rediseño por terminado.

---

## 11. Anexo: código completo de las maquetas

Generado con `python maquetas-ui/anexo.py`; no editar a mano.

### `maquetas-ui/base.css`

````css
/* Colores que se animan: los del fondo y el tinte de la cabecera salen de la imagen y cambian con fundido */
@property --a1 { syntax: "<color>"; inherits: true; initial-value: #e6d6bd; }
@property --a2 { syntax: "<color>"; inherits: true; initial-value: #d4dbe0; }
@property --a3 { syntax: "<color>"; inherits: true; initial-value: #eadfc6; }
@property --tint { syntax: "<color>"; inherits: true; initial-value: transparent; }
@property --tint-strength { syntax: "<number>"; inherits: true; initial-value: 0; }
:root { transition: --a1 900ms ease, --a2 900ms ease, --a3 900ms ease, --tint 700ms ease, --tint-strength 700ms ease; }

/* Al cambiar de tema todo cambia en el mismo fotograma: ninguna transición se queda atrás */
.theme-switching, .theme-switching *, .theme-switching *::before, .theme-switching *::after { transition: none !important; }

/* Mismos tokens que src/App.css (Vidrio cálido) */
:root {
  color-scheme: light;
  --canvas:#f6f3ee; --surface:#fff; --paper:#fffaf2; --highlight:#f1e8da;
  --ink:#1f2933; --muted:#4f473c; --faint:#5e564a; --line:#e6ded2; --line-strong:#d8cec0;
  --primary:#1f2933; --on-primary:#fff;
  --ok:#1a6f43; --warn:#7a4800; --bad:#a52a21; --info:#1f6f8b;
  --glass:rgba(255,252,246,.8); --glass-heavy:rgba(255,250,242,.9); --glass-top:rgba(255,255,255,.9);
  --shadow-s:rgba(60,40,10,.08); --shadow-l:rgba(60,40,10,.22);
  --row-tint:.14;
  --a1:#e6d6bd; --a2:#d4dbe0; --a3:#eadfc6;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  color-scheme: dark;
  --canvas:#16181c; --surface:#1f2227; --paper:#262a30; --highlight:#30353c;
  --ink:#ece6dc; --muted:#b8b0a3; --faint:#a79f93; --line:#33373e; --line-strong:#464b53;
  --primary:#ece6dc; --on-primary:#1f2933;
  --ok:#5ec48d; --warn:#e6a04a; --bad:#ef7b73; --info:#6fc3df;
  --glass:rgba(31,34,39,.82); --glass-heavy:rgba(31,34,39,.9); --glass-top:rgba(255,255,255,.07);
  --shadow-s:rgba(0,0,0,.25); --shadow-l:rgba(0,0,0,.5);
  --row-tint:.12;
}}
:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas:#16181c; --surface:#1f2227; --paper:#262a30; --highlight:#30353c;
  --ink:#ece6dc; --muted:#b8b0a3; --faint:#a79f93; --line:#33373e; --line-strong:#464b53;
  --primary:#ece6dc; --on-primary:#1f2933;
  --ok:#5ec48d; --warn:#e6a04a; --bad:#ef7b73; --info:#6fc3df;
  --glass:rgba(31,34,39,.82); --glass-heavy:rgba(31,34,39,.9); --glass-top:rgba(255,255,255,.07);
  --shadow-s:rgba(0,0,0,.25); --shadow-l:rgba(0,0,0,.5);
  --row-tint:.12;
}

* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  font: 14px/1.45 "Manrope", system-ui, sans-serif;
  color: var(--ink); background: var(--canvas);
  -webkit-font-smoothing: antialiased; overflow: hidden;
  font-feature-settings: "tnum" 0;
}
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 3px; }
.num { font-variant-numeric: tabular-nums; }
svg.i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

/* Fondo de ambiente: colores de la obra seleccionada */
.ambient { position: fixed; inset: 0; z-index: 0; opacity: .55;
  background:
    radial-gradient(60% 55% at 78% 8%, var(--a1), transparent 70%),
    radial-gradient(50% 50% at 12% 92%, var(--a2), transparent 70%),
    radial-gradient(45% 40% at 55% 60%, var(--a3), transparent 70%); }
:root[data-theme="dark"] .ambient { opacity: .22; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .ambient { opacity: .22; } }

.app { position: relative; z-index: 1; display: grid; grid-template-columns: 216px 1fr; height: 100%; gap: 12px; padding: 12px; }
.glass { background: var(--glass); border: 1px solid var(--line); border-top-color: var(--glass-top);
  border-radius: 6px; box-shadow: 0 1px 2px var(--shadow-s), 0 18px 40px -24px var(--shadow-l);
  backdrop-filter: blur(18px) saturate(140%); }

/* Barra lateral — Arc / Finder: iconos finos, selección suave */
.side { display: flex; flex-direction: column; padding: 14px 10px; }
.brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px 18px; font-weight: 700; letter-spacing: -.01em; }
.brand-mark { width: 26px; height: 26px; border-radius: 5px; background: var(--ink); color: var(--canvas); display: grid; place-items: center; font: 600 15px "Fraunces", serif; }
.nav a { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 4px; color: var(--muted); text-decoration: none; font-weight: 500; }
.nav a:hover { background: color-mix(in srgb, var(--highlight) 60%, transparent); color: var(--ink); }
.nav a[aria-current] { background: var(--highlight); color: var(--ink); font-weight: 600; }
.nav .count { margin-left: auto; color: var(--faint); font-size: 12px; }
.side-foot { margin-top: auto; display: grid; gap: 2px; }
.side-foot button { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 4px; color: var(--muted); text-align: left; }
.side-foot button:hover { background: var(--highlight); color: var(--ink); }
kbd { white-space: nowrap; font: 500 11px "Manrope", sans-serif; color: var(--faint); border: 1px solid var(--line-strong); border-radius: 3px; padding: 0 5px; margin-left: auto; }

/* Zona principal */
.main { display: grid; grid-template-rows: auto 1fr; gap: 12px; min-width: 0; min-height: 0; }

/* Barra superior — Linear: título pequeño, filtros como chips quitables */
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 8px 10px 8px 16px; min-height: 52px; }
.top h1 { margin: 0 6px 0 0; font: 600 15px "Manrope", sans-serif; letter-spacing: -.01em; }
.search { display: flex; align-items: center; gap: 8px; flex: 0 1 280px; min-width: 180px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 4px; color: var(--faint); background: color-mix(in srgb, var(--surface) 55%, transparent); }
.search input { border: 0; outline: 0; background: none; font: inherit; color: var(--ink); width: 100%; }
.btn { white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); font-weight: 500; box-shadow: 0 1px 2px var(--shadow-s); transition: transform 100ms ease-out, background 120ms; }
.btn:hover { background: var(--highlight); color: var(--ink); }
.btn:active, .primary:active, .frame:active { transform: scale(.97); }
.primary { white-space: nowrap; display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 4px; background: var(--primary); color: var(--on-primary); font-weight: 600; transition: transform 100ms ease-out; }
.primary kbd { color: inherit; opacity: .8; border-color: currentColor; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 9px; border: 1px solid var(--line-strong); border-radius: 3px; font-size: 12px; color: var(--muted); }
.chip b { color: var(--ink); font-weight: 600; }
.chip button { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 2px; color: var(--faint); }
.chip button:hover { background: var(--highlight); color: var(--ink); }
.spacer { flex: 1; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 4px; padding: 2px; }
.seg button { padding: 3px 8px; border-radius: 3px; color: var(--faint); display: grid; place-items: center; }
.seg button[aria-pressed="true"] { background: var(--highlight); color: var(--ink); }

/* Popover de filtros — sale desde el botón */
.pop-anchor { position: relative; }
.pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 20; width: 260px; padding: 6px; background: var(--surface); backdrop-filter: none;
  transform-origin: top left; transition: opacity 140ms ease, transform 180ms cubic-bezier(.2,.8,.2,1); }
.pop[hidden] { display: block; opacity: 0; transform: scale(.96) translateY(-4px); pointer-events: none; }
.pop h4 { margin: 8px 8px 4px; font-size: 12px; font-weight: 600; color: var(--faint); }
.opt { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 3px; text-align: left; }
.opt:hover { background: var(--highlight); }
.opt .tick { width: 14px; height: 14px; border: 1px solid var(--line-strong); border-radius: 3px; display: grid; place-items: center; }
.opt[aria-checked="true"] .tick { background: var(--ink); border-color: var(--ink); color: var(--canvas); }

.work { display: grid; grid-template-columns: minmax(250px, 320px) minmax(0, 1fr); gap: 12px; min-height: 0; }

/* Lista — Linear: filas compactas, punto de estado, fecha a la derecha */
.list { overflow: auto; padding: 8px; }
.group { display: flex; align-items: baseline; gap: 8px; padding: 10px 10px 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
.group span { color: var(--faint); font-weight: 500; }
.row { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; padding: 6px 8px 6px 14px; border-radius: 4px; text-align: left; }
.row::before { content: ""; position: absolute; left: 4px; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--tag); }
.row:hover { background: color-mix(in srgb, var(--highlight) 60%, transparent); }
.row[aria-selected="true"] { background: var(--highlight); }
.thumb { width: 36px; height: 36px; border-radius: 4px; overflow: hidden; display: grid; place-items: center; }
.thumb svg { width: 100%; height: 100%; display: block; }
.ph { font-weight: 600; font-size: 13px; color: var(--on-primary); }
.row .t { min-width: 0; }
.row .t strong { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .t small { display: flex; align-items: center; gap: 6px; color: var(--faint); font-size: 12px; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--faint); }
.due { font-size: 12px; color: var(--faint); white-space: nowrap; }
.due.bad { color: var(--bad); font-weight: 600; }
.due.warn { color: var(--warn); font-weight: 600; }

/* Detalle */
.detail { position: relative; display: grid; grid-template-rows: auto 1fr auto; min-height: 0; overflow: hidden; }
/* Apple Music: la cabecera toma el color de la obra */
.hero { position: relative; z-index: 0; padding: 22px 24px 18px; display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
.hero > div:first-child { min-width: 0; }
.hero::before { content: ""; position: absolute; inset: 0; z-index: -1; transition: background 700ms ease;
  background: linear-gradient(180deg, color-mix(in srgb, var(--tint) calc(var(--tint-strength) * 100%), transparent), transparent); }
.hero h2 { overflow-wrap: anywhere; margin: 0; font: 600 30px/1.08 "Fraunces", serif; letter-spacing: -.02em; font-optical-sizing: auto; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: 8px; color: var(--muted); }
.avatar { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #1f2933; }
.hero-actions { margin-left: auto; display: flex; gap: 6px; flex: none; }
.icon-btn { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 4px; border: 1px solid var(--line-strong); color: var(--ink); background: var(--surface); box-shadow: 0 1px 2px var(--shadow-s); }
.icon-btn:hover { color: var(--ink); background: var(--highlight); }

.body { display: grid; grid-template-columns: minmax(0, 1fr) clamp(260px, 30%, 320px); min-height: 0; border-top: 1px solid var(--line); }
/* Lightroom: imagen grande + tira de etapas */
.stage-view { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; min-width: 0; padding: 16px 20px; gap: 14px; }
.canvas { position: relative; min-height: 220px; display: grid; place-items: center; container-type: size; }
.canvas .art { position: relative; width: min(100cqw, 100cqh); aspect-ratio: 1; border-radius: 4px; overflow: hidden; box-shadow: 0 24px 50px -28px var(--shadow-l), 0 0 0 1px var(--line); }
.canvas .art svg { width: 100%; height: 100%; display: block; }
.alt-nav { position: absolute; bottom: 10px; white-space: nowrap; left: 50%; translate: -50% 0; display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 5px; background: rgba(20,22,26,.72); color: #f3eee6; font-size: 12px; backdrop-filter: blur(10px); }
.alt-nav button { width: 26px; height: 24px; display: grid; place-items: center; border-radius: 3px; }
.alt-nav button:hover { background: rgba(255,255,255,.14); }
.alt-nav span { padding: 0 6px; }
.empty-art { display: grid; place-items: center; gap: 10px; text-align: center; color: var(--faint); border: 1px dashed var(--line-strong); border-radius: 4px; width: min(100cqw, 100cqh, 420px); aspect-ratio: 1; padding: 16px; }

.strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 12px 8px; padding: 4px; }
.frame { min-width: 0; display: flex; flex-direction: column; justify-content: flex-start; align-self: start; text-align: left; transition: transform 100ms ease-out; }
.frame .fimg { position: relative; width: 100%; aspect-ratio: 4 / 3; border-radius: 4px; overflow: hidden; border: 1px solid var(--line); background: var(--paper); }
.frame .fimg svg { width: 100%; height: 100%; display: block; object-fit: cover; }
.frame[aria-current="true"] .fimg { outline: 2px solid var(--ink); outline-offset: 2px; }
.frame.todo .fimg { border-style: dashed; display: grid; place-items: center; color: var(--faint); }
.frame.todo .fimg svg { width: 16px; height: 16px; }
.frame .lbl { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; font-weight: 600; }
.frame .lbl em { font-style: normal; color: var(--faint); font-weight: 500; }
.frame .sub { font-size: 12px; color: var(--faint); }
.check { flex: none; width: 14px; height: 14px; border-radius: 50%; background: var(--ok); color: var(--surface); display: grid; place-items: center; }
.check svg { width: 10px; height: 10px; stroke-width: 2.4; }

/* Linear: panel de propiedades */
.props { border-left: 1px solid var(--line); padding: 16px; overflow: auto; display: grid; align-content: start; gap: 18px; }
.prop { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 6px 10px; align-items: center; font-size: 13px; }
.prop dt { color: var(--faint); }
.prop dd { margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { max-width: 100%; display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px; border: 1px solid var(--line-strong); border-radius: 3px; font-size: 12px; color: var(--muted); }
.tag i { flex: none; width: 6px; height: 6px; border-radius: 50%; }
.section-title { font-size: 12px; font-weight: 600; color: var(--muted); margin: 0 0 8px; display: flex; justify-content: space-between; }
.section-title button { color: var(--faint); font-weight: 500; }
.section-title button:hover { color: var(--ink); }

/* Stripe: cifras grandes, moneda pequeña, barra de progreso */
.money { font-variant-numeric: tabular-nums; }
.big { font-size: 22px; font-weight: 600; letter-spacing: -.02em; }
.big small { font-size: 13px; color: var(--faint); font-weight: 500; margin-left: 2px; letter-spacing: 0; }
.bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; margin: 10px 0 8px; display: flex; }
.bar i { display: block; background: var(--ok); transition: width 500ms cubic-bezier(.2,.8,.2,1); }
.bar i + i { background: var(--warn); opacity: .55; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: space-between; white-space: nowrap; font-size: 12px; color: var(--faint); }
.legend b { color: var(--ink); font-weight: 600; }
.ledger { margin-top: 10px; display: grid; grid-template-rows: 0fr; transition: grid-template-rows 220ms ease; }
.ledger.open { grid-template-rows: 1fr; }
.ledger > div { overflow: hidden; }
.ledger table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ledger td { padding: 6px 0; border-top: 1px solid var(--line); color: var(--muted); }
.ledger td:last-child { text-align: right; color: var(--ink); }

/* Pie fijo del detalle */
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 16px; border-top: 1px solid var(--line); background: var(--glass-heavy); }
.foot .hint { color: var(--faint); font-size: 12.5px; }
.foot .hint b { color: var(--muted); font-weight: 600; }

/* La imagen aparece en su sitio: fundido y un leve asentamiento, sin venir de otro lado */
.enter { animation: art-in 260ms cubic-bezier(.2,.8,.2,1); }
@keyframes art-in { from { opacity: 0; transform: scale(.985); } }

/* Ventanas estrechas: nada se tapa, las columnas se reorganizan */
@media (max-width: 1180px) {
  .body { display: block; overflow-y: auto; }
  .stage-view { height: auto; grid-template-rows: max(300px, 46vh) auto; }
  .props { display: grid; border-left: 0; border-top: 1px solid var(--line); grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px 24px; overflow: visible; }
}
@media (max-width: 960px) {
  .app { grid-template-columns: 60px minmax(0, 1fr); }
  .side .brand { font-size: 0; gap: 0; justify-content: center; padding-inline: 0; }
  .nav a, .side-foot button { justify-content: center; font-size: 0; gap: 0; padding: 9px 0; }
  .nav .count, .side-foot kbd, .note { display: none; }
  .work { grid-template-columns: minmax(220px, 260px) minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
@media (prefers-reduced-transparency: reduce) {
  .glass, .pop { backdrop-filter: none; background: var(--surface); }
}

.note { margin: 0 2px 10px; padding: 10px 12px; border-radius: 4px; background: var(--highlight); font-size: 12px; color: var(--muted); }
.note strong { color: var(--ink); }
.note button { float: right; color: var(--faint); margin-left: 8px; }

/* Compartido: filas con avatar y menús ⋯ */
.crow { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; border-radius: 4px; text-align: left; }
.crow:hover { background: color-mix(in srgb, var(--highlight) 60%, transparent); }
.crow[aria-selected="true"] { background: var(--highlight); }
.crow .t { min-width: 0; }
.crow strong { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.crow small { display: block; color: var(--faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.crow .n { display: inline-flex; align-items: center; gap: 6px; color: var(--faint); font-size: 12px; white-space: nowrap; }
.face { border-radius: 50%; overflow: hidden; display: grid; place-items: center; flex: none; }
.face svg { width: 100%; height: 100%; display: block; }
.crows { display: grid; }
.menu-anchor { position: relative; }
.menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: 230px; padding: 6px; background: var(--surface); backdrop-filter: none; transform-origin: top right; transition: opacity 140ms ease, transform 180ms cubic-bezier(.2,.8,.2,1); }
.menu[hidden] { display: block; opacity: 0; transform: scale(.96) translateY(-4px); pointer-events: none; }
.menu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border-radius: 3px; text-align: left; }
.menu button:hover { background: var(--highlight); }
.menu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; }
.menu .danger { color: var(--bad); }

/* Diálogos nativos (<dialog>): foco atrapado y Esc los da el navegador; fondo sólido para leer bien */
dialog { width: min(520px, 94vw); padding: 22px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface); color: var(--ink); box-shadow: 0 30px 80px -30px var(--shadow-l); }
dialog::backdrop { background: rgba(10, 12, 16, .35); backdrop-filter: blur(3px); }
dialog h3 { margin: 0 0 6px; font: 600 22px/1.15 "Fraunces", serif; letter-spacing: -.01em; }
dialog p { margin: 0; color: var(--muted); }
dialog .fields { display: grid; gap: 10px; margin-top: 16px; }
dialog .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.field { width: 100%; padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--paper); color: var(--ink); font: inherit; }
.field:focus { outline: 2px solid var(--ink); outline-offset: 0; }
.toast { position: fixed; left: 50%; bottom: 20px; translate: -50% 0; z-index: 50; display: flex; align-items: center; gap: 14px; padding: 9px 12px 9px 16px; border-radius: 6px; background: var(--primary); color: var(--on-primary); box-shadow: 0 12px 30px -12px var(--shadow-l); }
.toast button { font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
.btn[hidden] { display: none; }

/* Línea al estilo Stripe: el mes en curso va discontinuo porque aún no ha terminado */
.line { position: relative; height: 150px; }
.line svg { position: absolute; inset: 0 0 22px 0; width: 100%; height: calc(100% - 22px); overflow: visible; }
.line .area { fill: color-mix(in srgb, var(--ok) 14%, transparent); }
.line .stroke { fill: none; stroke: var(--ok); stroke-width: 2; vector-effect: non-scaling-stroke; }
.line .stroke.open { stroke-dasharray: 4 4; }
.line .grid { stroke: var(--line); vector-effect: non-scaling-stroke; }
.cols { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); }
.cols > div { display: grid; grid-template-rows: 1fr 22px; justify-items: center; cursor: default; }
.cols .plot { position: relative; width: 100%; }
.cols > div:hover { background: linear-gradient(transparent, color-mix(in srgb, var(--highlight) 70%, transparent)); border-radius: 4px; }
.cols .pt { position: absolute; left: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%; background: var(--surface); border: 2px solid var(--ok); }
.cols .now .pt { background: var(--ok); }
.cols .m { font-size: 12px; color: var(--faint); line-height: 22px; }
.cols .now .m { color: var(--ink); font-weight: 600; }
.cols .tip { position: absolute; transform: translate(-50%, -130%); left: 50%; padding: 3px 7px; border-radius: 4px; background: var(--primary); color: var(--on-primary); font-size: 12px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 100ms; }
.cols > div:hover .tip, .cols .now .tip { opacity: 1; }
.cols .now .tip { left: auto; right: 0; transform: translateY(-130%); } /* el último no se sale por la derecha */
.cols > div:hover ~ .now .tip { opacity: 0; }
````

### `maquetas-ui/shell.js`

````js
/* Marco común de las maquetas: barra lateral (según <body data-page>) y cambio de tema instantáneo */
const ICONS = {
  resumen: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  comisiones: '<path d="M9.06 11.9 17 4l3 3-7.9 7.94"/><path d="M7 14.5c-1.66 0-3 1.34-3 3 0 1.31-.84 2-2 2 1.5 2 3.5 2.5 5 2.5a4.5 4.5 0 0 0 4.5-4.5l-4.5-3z"/>',
  solicitudes: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  clientes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  catalogo: '<path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.59-8.59a1 1 0 0 0 0-1.41z"/><circle cx="7" cy="7" r="1.2"/>',
  terminadas: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  estadisticas: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>',
};
const NAV = [["resumen", "Resumen"], ["comisiones", "Comisiones", 6], ["solicitudes", "Solicitudes", 3], ["clientes", "Clientes", 9],
  ["terminadas", "Terminadas"], ["catalogo", "Catálogo"], ["estadisticas", "Estadísticas"], ["ajustes", "Ajustes"]];
const READY = ["resumen", "comisiones", "solicitudes", "clientes", "terminadas", "catalogo", "estadisticas", "ajustes"];
const svg = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;

const side = document.getElementById("side");
side.setAttribute("aria-label", "Navegación");
side.innerHTML = `<div class="brand"><span class="brand-mark">Z</span>ZeeBoard</div>
  <nav class="nav">${NAV.map(([id, label, n]) =>
    `<a href="${READY.includes(id) ? id + ".html" : "#"}"${id === document.body.dataset.page ? ' aria-current="page"' : ""}>${svg(ICONS[id])}${label}${n ? `<span class="count num">${n}</span>` : ""}</a>`).join("")}</nav>
  ${side.dataset.note ? `<p class="note"><button aria-label="Cerrar nota" onclick="this.parentNode.remove()">✕</button><strong>Maqueta.</strong> ${side.dataset.note}</p>` : ""}
  <div class="side-foot">
    <button>${svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}Modo privado</button>
    <button id="theme">${svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>')}Cambiar tema</button>
    <button>${svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>')}Atajos<kbd>?</kbd></button>
  </div>`;

// Todo cambia en el mismo fotograma: las transiciones se apagan durante el cambio. theme: "light" | "dark" | null (= el del sistema)
function setTheme(theme) {
  const r = document.documentElement;
  r.classList.add("theme-switching");
  if (theme) r.dataset.theme = theme; else delete r.dataset.theme;
  requestAnimationFrame(() => requestAnimationFrame(() => r.classList.remove("theme-switching")));
}
document.getElementById("theme").addEventListener("click", () => {
  const r = document.documentElement;
  setTheme((r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches) ? "light" : "dark");
});
````

### `maquetas-ui/ambient.js`

````js
/*
 * Colores sacados de la imagen que se está viendo (mismo algoritmo que src/lib/ambient.ts).
 * Se aplican al fondo (--a1..--a3) y al tinte de la cabecera (--tint), con fundido gracias a @property.
 * El tinte se limita para que el texto encima siga teniendo contraste 4.5:1 en los dos temas.
 */

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const ch = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, "0");
  };
  return `#${ch(0)}${ch(8)}${ch(4)}`;
}

function dominantColors(px) {
  const BINS = 12, bins = Array.from({ length: BINS }, () => ({ weight: 0, s: 0, l: 0 }));
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (s < 0.2 || l < 0.12 || l > 0.93) continue;
    const bin = bins[Math.floor(h / (360 / BINS)) % BINS], w = s * (1 - Math.abs(2 * l - 1));
    bin.weight += w; bin.s += s * w; bin.l += l * w;
  }
  const ranked = bins.map((b, i) => ({ ...b, hue: i * 30 + 15 })).filter((b) => b.weight > 0).sort((a, b) => b.weight - a.weight);
  const total = ranked.reduce((sum, b) => sum + b.weight, 0);
  if (!ranked.length || total < px.length / 4 / 40) return null;
  const picked = [];
  for (const b of ranked) {
    if (picked.every((o) => Math.min(Math.abs(o.hue - b.hue), 360 - Math.abs(o.hue - b.hue)) >= 40)) picked.push(b);
    if (picked.length === 3) break;
  }
  while (picked.length < 3) { const base = picked[picked.length - 1]; picked.push({ ...base, hue: (base.hue + 30) % 360 }); }
  return picked.map((b) => hslToHex(b.hue, Math.min(Math.max(b.s / b.weight, 0.45), 0.85), Math.min(Math.max(b.l / b.weight, 0.5), 0.68)));
}

const cache = new Map();
async function colorsOf(svg) {
  if (cache.has(svg)) return cache.get(svg);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement("canvas"); c.width = c.height = 48;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 48, 48);
  const found = dominantColors(ctx.getImageData(0, 0, 48, 48).data);
  cache.set(svg, found);
  return found;
}

/* Contraste WCAG */
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mixRgb = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));
const isDark = () => { const r = document.documentElement; return r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };

/** El tinte más fuerte (hasta un tope por tema) con el que el texto principal y el secundario siguen en ≥ 4.5:1. */
function safeStrength(tint) {
  const dark = isDark();
  const glass = hexRgb(dark ? "#1f2227" : "#fcf9f3");
  const texts = (dark ? ["#ece6dc", "#b8b0a3"] : ["#1f2933", "#4f473c"]).map(hexRgb);
  let s = dark ? 0.3 : 0.34;
  while (s > 0 && !texts.every((t) => ratio(t, mixRgb(hexRgb(tint), glass, s)) >= 4.8)) s -= 0.01;
  return Math.max(s, 0);
}

let wanted = 0, current = null;
function apply(colors) {
  current = colors;
  const root = document.documentElement.style;
  if (!colors) {
    ["--a1", "--a2", "--a3"].forEach((v) => root.removeProperty(v));
    root.setProperty("--tint-strength", "0");
    return;
  }
  colors.forEach((c, i) => root.setProperty(`--a${i + 1}`, c));
  root.setProperty("--tint", colors[0]);
  root.setProperty("--tint-strength", safeStrength(colors[0]).toFixed(2));
}

/** Pasa el fondo y la cabecera a los colores de esa imagen (o a neutro si es un boceto o no hay imagen). */
async function setAmbientFromSvg(svg) {
  const mine = ++wanted;
  const colors = svg ? await colorsOf(svg).catch(() => null) : null;
  if (mine === wanted) apply(colors);
}

/* Al cambiar de tema se recalcula el tope del tinte */
new MutationObserver(() => apply(current)).observe(document.documentElement, { attributeFilter: ["data-theme"] });
````

### `maquetas-ui/art.js`

````js
/* Personaje de ejemplo para miniaturas y avatares de las maquetas */
function head(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="${p.bg}"/>
    <g stroke="#2a2420" stroke-width="2" stroke-linejoin="round">
      <path d="M26 44 L22 12 L46 34Z" fill="${p.fur}"/><path d="M74 44 L78 12 L54 34Z" fill="${p.fur}"/>
      <ellipse cx="50" cy="104" rx="34" ry="26" fill="${p.fur}"/>
      <circle cx="50" cy="56" r="28" fill="${p.fur}"/><ellipse cx="50" cy="67" rx="16" ry="12" fill="${p.muzzle}"/>
      <ellipse cx="40" cy="53" rx="4" ry="5" fill="#2a2420"/><ellipse cx="60" cy="53" rx="4" ry="5" fill="#2a2420"/>
      <path d="M47 62 L53 62 L50 66Z" fill="#2a2420"/></g></svg>`;
}
````

### `maquetas-ui/chart.js`

````js
/* Gráfico de línea al estilo Stripe (Resumen y Estadísticas).
   months: [[etiqueta, valor], …]. El último punto es el mes en curso: relleno y con el tramo discontinuo. */
function lineChart(months, height = 150) {
  const n = months.length, max = Math.max(...months.map((m) => m[1]), 1);
  const fmt = (v) => v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const x = (i) => ((i + 0.5) / n) * 600;
  const y = (v) => 100 - (v / (max * 1.12)) * 100; // 12 % de aire arriba
  const pts = months.map(([, v], i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return `<div class="line" style="height:${height}px">
    <svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">
      <line class="grid" x1="0" x2="600" y1="100" y2="100"/>
      <path class="area" d="M${x(0)},100 L${pts.join(" L")} L${x(n - 1)},100 Z"/>
      <path class="stroke" d="M${pts.slice(0, -1).join(" L")}"/>
      <path class="stroke open" d="M${pts[n - 2]} L${pts[n - 1]}"/>
    </svg>
    <div class="cols" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${months.map(([m, v], i) => `
      <div class="${i === n - 1 ? "now" : ""}" title="${m}: ${fmt(v)}"><div class="plot">
        <span class="pt" style="top:${y(v)}%"></span><span class="tip" style="top:${y(v)}%">${fmt(v)}</span></div>
        <span class="m">${m}</span></div>`).join("")}</div>
  </div>`;
}
````

### `maquetas-ui/ajustes.html`

````html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZeeBoard · Ajustes (maqueta)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
<style>
/* Ajustes del sistema de macOS: secciones a la izquierda, filas agrupadas a la derecha */
.settings { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 0; overflow: hidden; }
.snav { border-right: 1px solid var(--line); padding: 12px 8px; overflow: auto; }
.snav button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; border-radius: 4px; color: var(--muted); text-align: left; }
.snav button:hover { background: color-mix(in srgb, var(--highlight) 60%, transparent); color: var(--ink); }
.snav button[aria-current="true"] { background: var(--highlight); color: var(--ink); font-weight: 600; }
.pane { overflow: auto; padding: 20px 28px 36px; }
.pane h2 { margin: 0 0 4px; font: 600 26px/1.15 "Fraunces", serif; letter-spacing: -.01em; }
.pane > p.lead { margin: 0 0 18px; color: var(--muted); max-width: 64ch; }
.group-title { margin: 22px 0 8px; font-size: 13px; font-weight: 600; color: var(--muted); }
.rows { max-width: 760px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.srow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 24px; padding: 12px 14px; }
.srow + .srow { border-top: 1px solid var(--line); }
.srow .t strong { display: block; font-weight: 600; }
.srow .t small { display: block; margin-top: 2px; color: var(--muted); font-size: 12.5px; line-height: 1.45; max-width: 60ch; }
.srow .ctl { display: flex; align-items: center; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.srow .ctl .field { width: auto; }
.srow .ctl input[type="number"] { width: 76px; text-align: right; }
.srow.wide { grid-template-columns: minmax(0, 1fr); }
.unit { color: var(--muted); font-size: 13px; }

/* Interruptor nativo (checkbox) con aspecto de switch */
.switch { appearance: none; width: 38px; height: 22px; border-radius: 11px; background: var(--line-strong); position: relative; cursor: pointer; transition: background 150ms; flex: none; }
.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform 150ms; }
.switch:checked { background: var(--ok); }
.switch:checked::after { transform: translateX(16px); }

.plat { display: grid; grid-template-columns: minmax(0, 1fr) 80px auto 80px 120px 32px; align-items: center; gap: 8px; margin-top: 8px; }
.plat .field { width: 100%; }
.plat .preview { color: var(--faint); font-size: 12px; white-space: nowrap; }
.ipad { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 18px; align-items: start; }
.ipad > div { min-width: 0; }
.qr { width: 132px; height: 132px; padding: 8px; background: #fff; border-radius: 4px; border: 1px solid var(--line); }
.qr svg { width: 100%; height: 100%; display: block; }
.link { display: flex; gap: 8px; align-items: center; margin: 4px 0 8px; }
.link code { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ok-line { color: var(--ok); font-size: 12.5px; }
.storage { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--line); margin: 6px 0 8px; }
.storage i { display: block; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; color: var(--muted); }
.legend b { color: var(--ink); }
.trash-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 10px 14px; }
.trash-row + .trash-row { border-top: 1px solid var(--line); }
.trash-row small { color: var(--faint); font-size: 12px; display: block; }
.danger { color: var(--bad); }

@media (max-width: 1100px) {
  .settings { grid-template-columns: 170px minmax(0, 1fr); }
  .plat { grid-template-columns: minmax(0, 1fr) 70px auto 70px 32px; }
  .plat .preview { display: none; }
}
@media (max-width: 960px) { .ipad { grid-template-columns: minmax(0, 1fr); } }
</style>
</head>
<body data-page="ajustes">
<div class="ambient" aria-hidden="true"></div>
<div class="app">
  <aside class="side glass" id="side" data-note="Elige una sección a la izquierda. Los cambios se guardan solos, como en Ajustes del sistema."></aside>
  <main class="main">
    <header class="top glass"><h1>Ajustes</h1></header>
    <section class="settings glass"><nav class="snav" id="snav" aria-label="Secciones"></nav><div class="pane" id="pane"></div></section>
  </main>
</div>

<script src="shell.js"></script>
<script>
const S = { sec: "general", theme: "Sistema", reminders: true, autoBackup: true, ipad: true,
  platforms: [["PayPal", 3.4, 0.35], ["Ko-fi", 0, 0], ["Stripe", 1.5, 0.25]],
  trash: [["Comisión", "Icon · Pip", "hace 2 días"], ["Cliente", "Rex", "hace 9 días"], ["Imagen", "Boceto alternativo · Nova", "hace 12 días"]] };
const SECTIONS = [["general", "General"], ["precios", "Precios y pagos"], ["plazos", "Plazos y avisos"], ["ipad", "iPad"], ["copias", "Copias de seguridad"], ["datos", "Datos y almacenamiento"], ["papelera", "Papelera"]];
const $ = (id) => document.getElementById(id);
const THEMES = { Claro: "light", Oscuro: "dark", Sistema: null };
const eur = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const row = (title, desc, ctl) => `<div class="srow"><div class="t"><strong>${title}</strong>${desc ? `<small>${desc}</small>` : ""}</div><div class="ctl">${ctl}</div></div>`;
const seg = (key, opts) => `<div class="seg" role="group">${opts.map((o) => `<button data-set="${key}" data-v="${o}" aria-pressed="${S[key] === o}">${o}</button>`).join("")}</div>`;
const sw = (key, label) => `<input type="checkbox" class="switch" data-toggle="${key}" ${S[key] ? "checked" : ""} aria-label="${label}">`;
// QR de ejemplo, siempre el mismo
const qr = () => { let r = 7, out = ""; for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) { r = (r * 9301 + 49297) % 233280; const corner = (x < 7 || x > 17) && y < 7 || x < 7 && y > 17; if (corner ? (x % 6 === 0 || y % 6 === 0 || (x % 6 > 1 && x % 6 < 5 && y % 6 > 1 && y % 6 < 5)) && !(x > 17 && x < 18) : r / 233280 > .5) out += `<rect x="${x}" y="${y}" width="1" height="1"/>`; } return `<svg viewBox="0 0 25 25" fill="#111" shape-rendering="crispEdges" aria-label="Código QR">${out}</svg>`; };

const PANES = {
  general: () => `<h2>General</h2><p class="lead">Aspecto e idioma de la app.</p>
    <div class="rows">${row("Tema", "Claro, oscuro o el que use Windows.", seg("theme", ["Claro", "Oscuro", "Sistema"]))}
    ${row("Idioma", "La app se recarga al cambiarlo.", `<select class="field"><option>Español</option><option>English</option></select>`)}</div>`,

  precios: () => `<h2>Precios y pagos</h2><p class="lead">Cómo se calcula el precio y lo que te llega de cada pago.</p>
    <div class="rows">${row("Moneda por defecto", "Las comisiones nuevas empiezan con esta.", `<select class="field"><option>EUR</option><option>USD</option><option>GBP</option></select>`)}
    ${row("Personaje extra", "Se suma al precio base por cada personaje después del primero. Las comisiones ya creadas mantienen su precio.", `<input class="field num" type="number" value="50" min="0"><span class="unit">%</span>`)}</div>
    <p class="group-title">Plataformas de pago</p>
    <div class="rows"><div class="srow wide"><div class="t"><small style="margin:0">Sus comisiones, para que «recibido» se rellene solo al apuntar un pago. Usa tus tarifas reales.</small>
      ${S.platforms.map(([n, p, f], i) => `<div class="plat"><input class="field" value="${n}" aria-label="Plataforma"><input class="field num" type="number" step="0.01" value="${p}" aria-label="Porcentaje" data-pl="${i}" data-k="1"><span class="unit">% +</span><input class="field num" type="number" step="0.01" value="${f}" aria-label="Fijo" data-pl="${i}" data-k="2"><span class="preview num">200 € → ${eur(200 - 200 * p / 100 - f)}</span><button class="icon-btn" data-rmpl="${i}" aria-label="Quitar ${n}">✕</button></div>`).join("")}
      <button class="btn" data-addpl style="margin-top:10px">Añadir plataforma</button></div></div></div>`,

  plazos: () => `<h2>Plazos y avisos</h2><p class="lead">Avisos de Windows mientras ZeeBoard está abierto.</p>
    <div class="rows">${row("Plazo de entrega prometido", "Lo máximo que dices a los clientes. Una comisión sin fecha cuenta desde el día que la aceptas.", `<input class="field num" type="number" value="30" min="1"><span class="unit">días</span>`)}
    ${row("Recordatorios de entrega", "Un aviso unos días antes y el mismo día.", `<input class="field num" type="number" value="3" min="1" ${S.reminders ? "" : "disabled"}><span class="unit">días antes</span>${sw("reminders", "Recordatorios de entrega")}`)}
    ${row("Comisiones paradas", "Avisa cuando una comisión lleva tiempo sin imagen, corrección, pago ni cambio de etapa.", `<input class="field num" type="number" value="7" min="1"><span class="unit">días</span>`)}</div>`,

  ipad: () => `<h2>iPad</h2><p class="lead">Una página privada para enviar imágenes desde el iPad directamente a una etapa. Solo funciona con ZeeBoard abierto.</p>
    <div class="rows">${row("Recibir imágenes del iPad", S.ipad ? "Escuchando en el puerto 8787." : "Apagado.", sw("ipad", "Recibir imágenes del iPad"))}
    ${S.ipad ? `<div class="srow wide"><div class="ipad"><div class="qr">${qr()}</div><div>
      <strong>Escanea el código con la cámara del iPad</strong><div class="link"><code data-private>http://100.84.12.7:8787/?k=••••••••••••</code><button class="btn">Copiar enlace</button></div>
      <p class="ok-line">Tailscale encontrado: el enlace funciona desde el iPad incluso con datos móviles.</p>
      <small style="color:var(--muted)">La primera vez, Windows pide permiso en el cortafuegos: permítelo en redes privadas. Otras direcciones de este PC: 192.168.1.34.</small>
      <div style="margin-top:10px"><button class="btn">Nueva clave</button> <span class="unit">Los enlaces anteriores dejan de funcionar.</span></div></div></div></div>` : ""}</div>`,

  copias: () => `<h2>Copias de seguridad</h2><p class="lead">Base de datos e imágenes, a la carpeta que elijas. Al restaurar se guarda antes una copia de lo actual.</p>
    <div class="rows">${row("Copias automáticas", "Una copia la primera vez que abres ZeeBoard cada día. Las más antiguas se borran solas.", sw("autoBackup", "Copias automáticas"))}
    ${S.autoBackup ? row("Carpeta", "D:\\Copias\\ZeeBoard", `<button class="btn">Cambiar…</button><button class="btn">Abrir carpeta</button>`) + row("Guardar las últimas", "Última copia: hoy, 9:12.", `<input class="field num" type="number" value="14" min="1"><span class="unit">copias</span>`) : ""}</div>
    <p class="group-title">A mano</p>
    <div class="rows">${row("Hacer una copia ahora", "", `<button class="primary">Copiar ahora</button>`)}
    ${row("Restaurar una copia", "Elige la carpeta de una copia. Lo actual se guarda antes en «before-restore».", `<button class="btn">Restaurar…</button>`)}</div>`,

  datos: () => `<h2>Datos y almacenamiento</h2><p class="lead">Exportar, importar pagos y liberar espacio.</p>
    <p class="group-title">Exportar (CSV)</p>
    <div class="rows">${[["Comisiones", "Una fila por comisión: cliente, tipo, etapa, precio y lo pagado."], ["Pagos", "Una fila por pago: fecha, lo que pagó el cliente, lo recibido y la comisión de la plataforma."], ["Resumen trimestral", "Pagos agrupados por trimestre y moneda, por el día en que se recibieron. Las monedas nunca se suman."]]
      .map(([t, d]) => row(t, d, `<button class="btn">Exportar</button>`)).join("")}</div>
    <p style="margin:8px 2px 0;color:var(--faint);font-size:12px;max-width:760px">Se abren en Excel y Google Sheets (separado por punto y coma, coma decimal). Las exportaciones llevan siempre los nombres y precios reales, también en modo privado.</p>
    <p class="group-title">Importar pagos</p>
    <div class="rows">${row("Actividad de PayPal (CSV)", "Empareja cada pago con un cliente por su correo y lo añade a su comisión con lo que recibiste. Los ya importados se saltan. Último: 2 oct.", `<button class="btn">Elegir CSV</button>`)}</div>
    <p class="group-title">Almacenamiento</p>
    <div class="rows"><div class="srow wide"><div><strong>412 MB usados</strong>
      <div class="storage" aria-hidden="true"><i style="width:70%;background:var(--info)"></i><i style="width:8%;background:var(--ok)"></i><i style="width:3%;background:var(--warn)"></i></div>
      <div class="legend num"><span>Imágenes <b>288 MB</b> (214 en uso · 231 archivos)</span><span>Miniaturas <b>33 MB</b></span><span>Base de datos <b>12 MB</b></span></div></div></div>
      ${row("Imágenes sin usar", "Archivos que ya no usa ninguna comisión ni personaje: 17 archivos, 21 MB.", `<button class="btn">Limpiar</button>`)}</div>`,

  papelera: () => `<h2>Papelera</h2><p class="lead">Lo borrado se queda aquí 30 días y después se elimina para siempre.</p>
    <div class="rows">${S.trash.length ? S.trash.map(([k, n, w], i) => `<div class="trash-row"><span><strong>${n}</strong><small>${k} · borrado ${w}</small></span>
      <button class="btn" data-restore="${i}">Restaurar</button><button class="btn danger" data-purge="${i}">Borrar para siempre</button></div>`).join("")
      : `<p style="margin:0;padding:14px;color:var(--faint)">La papelera está vacía.</p>`}</div>
    ${S.trash.length ? `<div style="margin-top:12px"><button class="btn danger" data-empty>Vaciar papelera</button></div>` : ""}`,
};

function render() {
  $("snav").innerHTML = SECTIONS.map(([id, l]) => `<button data-sec="${id}" aria-current="${S.sec === id}">${l}${id === "papelera" && S.trash.length ? `<span class="num" style="margin-left:auto;color:var(--faint);font-weight:500">${S.trash.length}</span>` : ""}</button>`).join("");
  $("pane").innerHTML = PANES[S.sec]();
}

document.addEventListener("click", (e) => {
  const q = (s) => e.target.closest(s);
  if (q("[data-sec]")) { S.sec = q("[data-sec]").dataset.sec; render(); return $("pane").scrollTo(0, 0); }
  if (q("[data-set]")) { const v = S[q("[data-set]").dataset.set] = q("[data-set]").dataset.v; if (v in THEMES) setTheme(THEMES[v]); return render(); }
  if (q("[data-rmpl]")) { S.platforms.splice(+q("[data-rmpl]").dataset.rmpl, 1); return render(); }
  if (q("[data-addpl]")) { S.platforms.push(["", 0, 0]); render(); return document.querySelector(".plat:last-of-type input").focus(); }
  if (q("[data-restore]")) { S.trash.splice(+q("[data-restore]").dataset.restore, 1); return render(); }
  if (q("[data-purge]") && confirm("Se borra para siempre. ¿Seguro?")) { S.trash.splice(+q("[data-purge]").dataset.purge, 1); return render(); }
  if (q("[data-empty]") && confirm(`Se borran para siempre ${S.trash.length} elementos. ¿Seguro?`)) { S.trash = []; render(); }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.toggle) { S[e.target.dataset.toggle] = e.target.checked; render(); }
  if (e.target.dataset.pl) { S.platforms[+e.target.dataset.pl][+e.target.dataset.k] = +e.target.value || 0; render(); }
});
render();
</script>
</body>
</html>
````

### `maquetas-ui/catalogo.html`

````html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZeeBoard · Catálogo (maqueta)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
<style>
.work { grid-template-columns: minmax(250px, 310px) minmax(0, 1fr); }
.crow { grid-template-columns: 12px minmax(0, 1fr) auto; }
.crow .sw { width: 12px; height: 12px; border-radius: 3px; }
.crow .sw.round { border-radius: 50%; }
.group .add { margin-left: auto; color: var(--faint); font-weight: 500; }
.group .add:hover { color: var(--ink); }

.ed { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; overflow: hidden; }
.ed-head { position: relative; z-index: 0; padding: 20px 24px 16px; }
.ed-head::before { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, color-mix(in srgb, var(--item) 16%, transparent), transparent); }
.kind { font-size: 12px; color: var(--faint); }
.title-input { width: 100%; padding: 2px 4px; margin: 2px 0 0 -4px; border: 1px solid transparent; border-radius: 4px; background: none; color: var(--ink); font: 600 30px/1.1 "Fraunces", serif; letter-spacing: -.02em; }
.title-input:hover { border-color: var(--line); }
.title-input:focus { outline: none; border-color: var(--line-strong); background: var(--paper); }
.row-fields { display: flex; flex-wrap: wrap; align-items: end; gap: 10px 22px; margin-top: 12px; }
.row-fields label { display: grid; gap: 4px; font-size: 12px; color: var(--faint); }
.row-fields .field { width: 130px; }
.row-fields > label:last-child { flex: 1 1 240px; min-width: 0; }
.swatches { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.swatches button[data-color], .swatches label.custom { width: 22px; height: 22px; border-radius: 3px; }
.swatches button[data-color][aria-pressed="true"] { outline: 2px solid var(--ink); outline-offset: 2px; }
.swatches label.custom { position: relative; display: grid; place-items: center; border: 1px dashed var(--line-strong); color: var(--muted); cursor: pointer; }
.swatches label.custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

.ed-body { display: grid; grid-template-columns: minmax(0, 1fr) clamp(250px, 30%, 300px); min-height: 0; border-top: 1px solid var(--line); }
.main-col { overflow: auto; padding: 18px 24px; min-width: 0; }
.side-col { overflow: auto; padding: 18px 16px; border-left: 1px solid var(--line); display: grid; align-content: start; gap: 20px; }
.h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.h3 span { color: var(--faint); font-weight: 500; }

/* Etapas: secuencia numerada, se reordena arrastrando */
.stages { list-style: none; margin: 0; padding: 0; max-width: 560px; }
.stages li { display: grid; grid-template-columns: 20px 26px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px 6px; border-radius: 4px; background: var(--surface); border: 1px solid var(--line); }
.stages li + li { margin-top: 6px; }
.stages li.last { border-style: dashed; }
.stages li.dragging { opacity: .4; }
.stages .grip { cursor: grab; color: var(--faint); display: grid; place-items: center; }
.stages .n { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--highlight); }
.stages input { border: 0; background: none; font: inherit; color: var(--ink); padding: 2px 4px; border-radius: 3px; min-width: 0; }
.stages input:focus { outline: 2px solid var(--ink); }
.stages .rm { width: 26px; height: 26px; border-radius: 3px; color: var(--faint); }
.stages .rm:hover:not(:disabled) { background: var(--highlight); color: var(--bad); }
.last-note { margin: 6px 0 0 60px; font-size: 12px; color: var(--faint); max-width: 480px; }
.add-stage { margin-top: 10px; max-width: 560px; }

/* Cifras de rendimiento: llenan la pantalla con algo útil */
.figs { display: grid; }
.figs > div { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 8px 0; }
.figs > div + div { border-top: 1px solid var(--line); }
.figs dt { color: var(--muted); }
.figs dd { margin: 0; font-weight: 600; }
.uses { display: grid; }
.uses a { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 6px 4px; border-radius: 4px; color: inherit; text-decoration: none; }
.uses a:hover { background: color-mix(in srgb, var(--highlight) 60%, transparent); }
.uses a + a { box-shadow: 0 -1px 0 var(--line); }
.uses .thumb { width: 32px; height: 32px; border-radius: 4px; overflow: hidden; }
.uses .thumb svg { width: 100%; height: 100%; display: block; }
.uses strong { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.uses small { color: var(--faint); font-size: 12px; }
.muted { color: var(--faint); }
.foot .why, .saved { color: var(--faint); font-size: 12.5px; }
.saved { margin-left: auto; }

@media (max-width: 1180px) {
  .ed-body { display: block; overflow-y: auto; }
  .main-col, .side-col { overflow: visible; }
  .side-col { border-left: 0; border-top: 1px solid var(--line); grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
}
</style>
</head>
<body data-page="catalogo">
<div class="ambient" aria-hidden="true"></div>
<div class="app">
  <aside class="side glass" id="side" data-note="Tipos y etiquetas en una sola pantalla. El color del tipo es la barra de cada comisión; las etiquetas quedan para extras."></aside>
  <main class="main">
    <header class="top glass"><h1>Catálogo</h1><div class="spacer"></div>
      <button class="btn" data-new="tag"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nueva etiqueta</button>
      <button class="primary" data-new="type"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nuevo tipo</button></header>
    <div class="work">
      <section class="list glass" id="list" role="listbox" aria-label="Catálogo"></section>
      <section class="detail glass ed" id="ed"></section>
    </div>
  </main>
</div>

<script src="shell.js"></script>
<script src="art.js"></script>
<script>
const PALETTE = ["#7c3aed", "#4f46e5", "#2563eb", "#0891b2", "#0d9488", "#16a34a", "#d97706", "#ea580c", "#dc2626", "#db2777", "#92400e", "#475569"];
const PAL = [{ fur: "#e07a3c", muzzle: "#fff4e8", bg: "#a7d0e6" }, { fur: "#5b7f8f", muzzle: "#f3efe6", bg: "#f3dca0" }, { fur: "#cfc6e8", muzzle: "#faf6ff", bg: "#2f3a5c" }];
// Tipo = plantilla + color. Las etiquetas «Tipo» que repetían el nombre de una plantilla desaparecen (migración).
const types = [
  { id: 1, name: "Full Colour", color: "#2563eb", price: 160, revisions: 3, stages: ["Boceto", "Lineart", "Color plano", "Sombreado", "Final"], active: [["Tilly", "Boceto", 0], ["Luna", "Boceto", 2], ["Juniper", "Sin empezar", null]], done: { n: 5, avg: 160, hours: 6.0 } },
  { id: 2, name: "Flat Colour", color: "#4f46e5", price: 110, revisions: 2, stages: ["Boceto", "Lineart", "Color plano", "Final"], active: [["Basil", "Sin empezar", null]], done: { n: 2, avg: 110, hours: 4.0 } },
  { id: 3, name: "Reference Sheet", color: "#16a34a", price: 150, revisions: 2, stages: ["Boceto", "Lineart", "Color plano", "Detalles", "Final"], active: [["Kuro", "Color plano", 1]], done: { n: 1, avg: 150, hours: 6.5 } },
  { id: 4, name: "Rendered Full Body", color: "#0d9488", price: 350, revisions: 3, stages: ["Boceto", "Lineart", "Color plano", "Sombreado", "Fondo", "Final"], active: [["Nova", "Fondo", 0]], done: { n: 0 } },
  { id: 5, name: "Sketch", color: "#475569", price: 40, revisions: 1, stages: ["Boceto", "Final"], active: [], done: { n: 2, avg: 40, hours: 1.5 } },
];
const tags = [
  { id: 11, name: "Rush", category: "Extras", color: "#dc2626", uses: [["Nova", "Rendered Full Body"]] },
  { id: 12, name: "Commercial use", category: "Extras", color: "#0891b2", uses: [["Kuro", "Reference Sheet"]] },
  { id: 13, name: "2 personajes", category: "Personajes", color: "#475569", uses: [] },
  { id: 14, name: "3 personajes", category: "Personajes", color: "#92400e", uses: [] },
];
let sel = { kind: "type", id: 1 }, dragFrom = null;
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const eur = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const item = () => (sel.kind === "type" ? types : tags).find((x) => x.id === sel.id);
const cats = () => [...new Set(tags.map((t) => t.category))];
const swatches = (color) => `<div class="swatches">${PALETTE.map((c) => `<button data-color="${c}" style="background:${c}" aria-label="Color ${c}" aria-pressed="${c === color}"></button>`).join("")}
  <label class="custom" title="Color personalizado">+<input type="color" id="custom" value="${color}"></label></div>`;

function renderList() {
  const row = (kind, x, sub, right, round) => `<button class="crow" role="option" aria-selected="${sel.kind === kind && sel.id === x.id}" data-kind="${kind}" data-id="${x.id}">
    <i class="sw ${round ? "round" : ""}" style="background:${x.color}"></i><span class="t"><strong>${esc(x.name || "Sin nombre")}</strong><small>${sub}</small></span><span class="n num">${right}</span></button>`;
  $("list").innerHTML = `<div class="group">Tipos de comisión<span class="num">${types.length}</span><button class="add" data-new="type">Añadir</button></div>
    ${types.map((t) => row("type", t, `${t.stages.length} etapas · ${t.price ? t.price + " €" : "sin precio"}`, t.active.length ? `${t.active.length} en curso` : "")).join("")}
    ${cats().map((c) => `<div class="group">${esc(c)}<span class="num">${tags.filter((t) => t.category === c).length}</span><button class="add" data-new="tag" data-cat="${esc(c)}">Añadir</button></div>
      ${tags.filter((t) => t.category === c).map((t) => row("tag", t, "Etiqueta", t.uses.length ? `en ${t.uses.length}` : "Sin usar", true)).join("")}`).join("")}`;
}

function typeEditor(t) {
  const rate = t.done.n && t.done.hours ? t.done.avg / t.done.hours : null;
  return `<div class="ed-head"><span class="kind">Tipo de comisión</span>
      <input class="title-input" id="name" value="${esc(t.name)}" placeholder="Nombre del tipo" aria-label="Nombre del tipo">
      <div class="row-fields">
        <label>Precio base<input class="field num" type="number" min="0" data-field="price" value="${t.price ?? ""}" placeholder="160"></label>
        <label>Revisiones incluidas<input class="field num" type="number" min="0" data-field="revisions" value="${t.revisions ?? ""}" placeholder="—"></label>
        <label>Color en las comisiones${swatches(t.color)}</label>
      </div></div>
    <div class="ed-body">
      <div class="main-col"><p class="h3">Etapas <span>el orden por el que pasa cada comisión</span></p>
        <ol class="stages">${t.stages.map((s, i) => `<li draggable="true" data-i="${i}" class="${i === t.stages.length - 1 ? "last" : ""}">
          <span class="grip" title="Arrastra para ordenar"><svg class="i" viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></span>
          <span class="n">${i + 1}</span><input value="${esc(s)}" data-stage="${i}" aria-label="Etapa ${i + 1}">
          <button class="rm" data-rm="${i}" aria-label="Quitar etapa ${i + 1}" ${t.stages.length < 2 ? "disabled" : ""}>✕</button></li>`).join("")}</ol>
        <p class="last-note">La última etapa no se ve en la comisión hasta que pulsas «Marcar como terminada».</p>
        <input class="field add-stage" id="addStage" placeholder="Añade una etapa y pulsa Enter"></div>
      <div class="side-col">
        <div><p class="h3">En curso <span class="num">${t.active.length}</span></p>
          ${t.active.length ? `<div class="uses">${t.active.map(([c, st, p]) => `<a href="comisiones.html"><span class="thumb">${p === null ? "" : head(PAL[p])}</span><span style="min-width:0"><strong>${esc(c)}</strong><small>${esc(st)}</small></span></a>`).join("")}</div>` : `<p class="muted">Ninguna ahora mismo.</p>`}</div>
        <div><p class="h3">Terminadas</p>${t.done.n ? `<dl class="figs num">
          <div><dt>Entregadas</dt><dd>${t.done.n}</dd></div><div><dt>Precio medio</dt><dd>${eur(t.done.avg)}</dd></div>
          <div><dt>Horas de media</dt><dd>${String(t.done.hours).replace(".", ",")} h</dd></div><div><dt>Por hora</dt><dd>${eur(rate)}</dd></div></dl>` : `<p class="muted">Aún no has entregado ninguna.</p>`}</div>
      </div></div>
    <div class="foot"><button class="btn" data-act="dup">Duplicar</button>
      <button class="btn" data-act="del" ${t.active.length ? "disabled" : ""} style="color:var(--bad)">Borrar</button>
      ${t.active.length ? `<span class="why">No se puede borrar: lo usan ${t.active.length} ${t.active.length === 1 ? "comisión" : "comisiones"}.</span>` : ""}
      <span class="saved" id="saved">Guardado</span></div>`;
}

function tagEditor(t) {
  return `<div class="ed-head"><span class="kind">Etiqueta</span>
      <input class="title-input" id="name" value="${esc(t.name)}" placeholder="Nombre de la etiqueta" aria-label="Nombre de la etiqueta">
      <div class="row-fields">
        <label>Categoría<input class="field" data-field="category" list="cats" value="${esc(t.category)}" style="width:180px"><datalist id="cats">${cats().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
        <label>Color${swatches(t.color)}</label>
      </div></div>
    <div class="ed-body">
      <div class="main-col"><p class="h3">Comisiones con esta etiqueta <span class="num">${t.uses.length}</span></p>
        ${t.uses.length ? `<div class="uses" style="max-width:560px">${t.uses.map(([c, ty]) => `<a href="comisiones.html"><span class="thumb">${head(PAL[0])}</span><span style="min-width:0"><strong>${esc(ty)}</strong><small>${esc(c)}</small></span></a>`).join("")}</div>` : `<p class="muted">Todavía no la tiene ninguna comisión.</p>`}</div>
      <div class="side-col"><div><p class="h3">Para qué sirven</p><p class="muted" style="margin:0">Las etiquetas marcan extras (urgente, uso comercial, número de personajes…). El tipo de comisión ya da su propio color.</p></div></div></div>
    <div class="foot"><button class="btn" data-act="del" style="color:var(--bad)">Borrar etiqueta</button><span class="saved" id="saved">Guardado</span></div>`;
}

function render() {
  renderList();
  const x = item();
  $("ed").style.setProperty("--item", x.color);
  $("ed").innerHTML = sel.kind === "type" ? typeEditor(x) : tagEditor(x);
}

function toast(text, undo) {
  document.querySelector(".toast")?.remove();
  const el = Object.assign(document.createElement("div"), { className: "toast", role: "status" });
  el.innerHTML = `<span>${text}</span><button>Deshacer</button>`;
  el.querySelector("button").onclick = () => { undo(); el.remove(); };
  document.body.append(el); setTimeout(() => el.remove(), 5000);
}
const nextId = () => Math.max(...types.map((t) => t.id), ...tags.map((t) => t.id)) + 1;
const saving = () => { $("saved").textContent = "Guardando…"; clearTimeout(window.sv); window.sv = setTimeout(() => { $("saved").textContent = "Guardado"; renderList(); }, 500); };

document.addEventListener("click", (e) => {
  const q = (s) => e.target.closest(s);
  if (q(".crow")) { sel = { kind: q(".crow").dataset.kind, id: +q(".crow").dataset.id }; return render(); }
  const nw = q("[data-new]");
  if (nw) {
    const id = nextId();
    if (nw.dataset.new === "type") types.push({ id, name: "", color: PALETTE[types.length % PALETTE.length], price: null, revisions: null, stages: ["Boceto", "Final"], active: [], done: { n: 0 } });
    else tags.push({ id, name: "", category: nw.dataset.cat || "Extras", color: PALETTE[tags.length % PALETTE.length], uses: [] });
    sel = { kind: nw.dataset.new, id }; render(); return $("name").focus();
  }
  if (q("[data-color]")) { item().color = q("[data-color]").dataset.color; return render(); }
  if (q("[data-rm]")) { item().stages.splice(+q("[data-rm]").dataset.rm, 1); return render(); }
  const act = q("[data-act]")?.dataset.act, x = item();
  if (act === "dup") { const id = nextId(); types.push({ ...x, id, name: x.name + " (copia)", active: [], done: { n: 0 }, stages: [...x.stages] }); sel = { kind: "type", id }; render(); }
  if (act === "del") {
    const list = sel.kind === "type" ? types : tags, i = list.indexOf(x); list.splice(i, 1);
    sel = { kind: "type", id: types[0].id }; render();
    toast(x.uses?.length ? `Se ha quitado de ${x.uses.length} ${x.uses.length === 1 ? "comisión" : "comisiones"}.` : "Borrado.", () => { list.splice(i, 0, x); sel = { kind: list === types ? "type" : "tag", id: x.id }; render(); });
  }
});
document.addEventListener("input", (e) => {
  const x = item(), el = e.target;
  if (el.id === "name") x.name = el.value;
  else if (el.id === "custom") { x.color = el.value; $("ed").style.setProperty("--item", x.color); }
  else if (el.dataset.field === "category") x.category = el.value || "Extras";
  else if (el.dataset.field) x[el.dataset.field] = el.value === "" ? null : +el.value;
  else if (el.dataset.stage) x.stages[+el.dataset.stage] = el.value;
  else return;
  saving();
});
document.addEventListener("keydown", (e) => {
  if (e.target.id === "addStage" && e.key === "Enter" && e.target.value.trim()) {
    const st = item().stages; st.splice(st.length - 1, 0, e.target.value.trim()); render(); $("addStage").focus();
  }
});
document.addEventListener("dragstart", (e) => { const li = e.target.closest?.(".stages li"); if (li) { dragFrom = +li.dataset.i; li.classList.add("dragging"); } });
document.addEventListener("dragover", (e) => { if (e.target.closest?.(".stages li")) e.preventDefault(); });
document.addEventListener("drop", (e) => {
  const li = e.target.closest?.(".stages li"); if (!li || dragFrom === null) return;
  const st = item().stages, [m] = st.splice(dragFrom, 1); st.splice(+li.dataset.i, 0, m); dragFrom = null; render();
});
document.addEventListener("dragend", () => { dragFrom = null; document.querySelector(".dragging")?.classList.remove("dragging"); });
render();
</script>
</body>
</html>
````

### `maquetas-ui/clientes.html`

````html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZeeBoard · Clientes (maqueta)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
<style>
.work { grid-template-columns: minmax(250px, 300px) minmax(0, 1fr); }

/* Lista de clientes — Contactos de macOS */
.list-head { padding: 8px 8px 4px; }
.list-head .search { width: 100%; flex: none; }

/* Detalle */
.cdetail { position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; overflow: hidden; }
.chero { position: relative; z-index: 2; display: flex; align-items: center; gap: 18px; padding: 22px 24px 20px; min-width: 0; }
.chero::before { content: ""; position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(180deg, color-mix(in srgb, var(--tint) calc(var(--tint-strength) * 100%), transparent), transparent); }
.chero .who { min-width: 0; }
.chero h2 { margin: 0; font: 600 30px/1.08 "Fraunces", serif; letter-spacing: -.02em; overflow-wrap: anywhere; }

.cbody { display: grid; grid-template-columns: minmax(0, 1fr) clamp(260px, 30%, 320px); min-height: 0; border-top: 1px solid var(--line); }
.cmain { overflow: auto; padding: 18px 22px 24px; display: grid; align-content: start; gap: 26px; min-width: 0; }

/* Stripe: cifras en una línea, sin cajas */
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 14px 0; }
.fig { padding: 0 18px; border-left: 1px solid var(--line); }
.fig:first-child { padding-left: 0; border-left: 0; }
.fig span { display: block; font-size: 12px; color: var(--faint); }
.fig .big { margin-top: 2px; }
.fig small.note2 { display: block; margin-top: 2px; font-size: 12px; color: var(--faint); }

.h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.h3 span { color: var(--faint); font-weight: 500; }
.h3 .spacer { flex: 1; }

/* Comisiones del cliente: mismas filas que en Comisiones */
.mrow { position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 8px 8px 8px 14px; border-radius: 4px; text-align: left; width: 100%; }
.mrow::before { content: ""; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--tag); }
.mrow:hover { background: color-mix(in srgb, var(--tag) calc(var(--row-tint) * 50%), transparent); }
.mrow + .mrow { box-shadow: 0 -1px 0 var(--line); }
.mrow .thumb { width: 40px; height: 40px; }
.mrow .t { min-width: 0; }
.mrow strong { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mrow small { display: flex; align-items: center; gap: 6px; color: var(--faint); font-size: 12px; }
.status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.price { min-width: 76px; text-align: right; font-weight: 600; white-space: nowrap; }

/* Personajes: galería con su referencia */
.chars { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
.char { text-align: left; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--surface); transition: transform 100ms ease-out, border-color 120ms; }
.char:hover { border-color: var(--line-strong); }
.char:active { transform: scale(.98); }
.refs { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: 1fr 1fr; gap: 2px; aspect-ratio: 4 / 3; background: var(--line); }
.refs > div { overflow: hidden; background: var(--paper); }
.refs.r3 > div:first-child { grid-row: 1 / 3; }
.refs.r1 { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.refs.r2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; }
.refs svg { width: 100%; height: 100%; display: block; }
.refs .more { display: grid; place-items: center; font-size: 12px; color: var(--muted); font-weight: 600; }
.char .cap { padding: 8px 10px 10px; }
.char .cap strong { display: block; font-weight: 600; }
.char .cap small { color: var(--faint); font-size: 12px; }
.add-char { display: grid; place-content: center; justify-items: center; gap: 6px; min-height: 160px; border: 1px dashed var(--line-strong); border-radius: 6px; color: var(--muted); font-weight: 500; }
.add-char:hover { background: var(--highlight); color: var(--ink); }

/* Columna derecha: contacto y notas (etiqueta encima del valor, así no se corta) */
.cside .prop { grid-template-columns: minmax(0, 1fr); gap: 2px; }
.cside .prop dd + dt { margin-top: 10px; }
.cside { border-left: 1px solid var(--line); padding: 18px 16px; overflow: auto; display: grid; align-content: start; gap: 22px; }
.notes { margin: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 4px; background: color-mix(in srgb, var(--surface) 60%, transparent); color: var(--ink); line-height: 1.55; white-space: pre-wrap; min-height: 90px; }
.notes:focus { outline: 2px solid var(--ink); outline-offset: 1px; }
.saved { font-size: 12px; color: var(--faint); margin-top: 6px; }

/* Menú ⋯ que sale desde su botón */

.fade { animation: art-in 220ms cubic-bezier(.2,.8,.2,1); }

@media (max-width: 1180px) {
  .cbody { display: block; overflow-y: auto; }
  .cmain { overflow: visible; }
  .cside { border-left: 0; border-top: 1px solid var(--line); grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px 24px; overflow: visible; }
}
@media (max-width: 960px) {
  .work { grid-template-columns: minmax(210px, 240px) minmax(0, 1fr); }
  .mrow { grid-template-columns: 40px minmax(0, 1fr) auto; }
  .mrow .status { display: none; }
}
</style>
</head>
<body data-page="clientes">
<div class="ambient" aria-hidden="true"></div>

<div class="app">
  <aside class="side glass" id="side" data-note="Pulsa otro cliente, el menú ⋯, las notas (se pueden escribir) y la búsqueda."></aside>

  <main class="main">
    <header class="top glass">
      <h1>Clientes</h1>
      <div class="spacer"></div>
      <button class="primary"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nuevo cliente</button>
    </header>

    <div class="work">
      <section class="list glass" aria-label="Clientes">
        <div class="list-head"><label class="search"><svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" placeholder="Buscar clientes" aria-label="Buscar clientes"></label></div>
        <div id="list" role="listbox"></div>
      </section>
      <section class="cdetail glass" id="detail" aria-live="polite"></section>
    </div>
  </main>
</div>

<script src="shell.js"></script>
<script src="ambient.js"></script>
<script src="art.js"></script>
<script>
/* Avatares y referencias de ejemplo (mismo personaje que en la maqueta de Comisiones) */
function ref(p, pose) {
  const flip = pose ? 'transform="translate(400 0) scale(-1 1)"' : "";
  return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="400" height="300" fill="${p.bg}"/>
    <g ${flip} stroke="#2a2420" stroke-width="4" stroke-linejoin="round">
      <ellipse cx="200" cy="300" rx="90" ry="70" fill="${p.fur}"/>
      <path d="M140 120 L128 40 L190 96Z" fill="${p.fur}"/><path d="M260 120 L272 40 L210 96Z" fill="${p.fur}"/>
      <circle cx="200" cy="160" r="78" fill="${p.fur}"/><ellipse cx="200" cy="192" rx="46" ry="34" fill="${p.muzzle}"/>
      <ellipse cx="172" cy="152" rx="11" ry="${pose === 2 ? 3 : 13}" fill="#2a2420"/><ellipse cx="228" cy="152" rx="11" ry="${pose === 2 ? 3 : 13}" fill="#2a2420"/>
      <path d="M192 180 L208 180 L200 190Z" fill="#2a2420"/></g></svg>`;
}

const P = {
  orange: { fur:"#e07a3c", muzzle:"#fff4e8", bg:"#f6d9bf" },
  grey:   { fur:"#8f9aa8", muzzle:"#f3efe6", bg:"#dfe4ea" },
  lilac:  { fur:"#cfc6e8", muzzle:"#faf6ff", bg:"#ebe4f8" },
  teal:   { fur:"#5b7f8f", muzzle:"#f3efe6", bg:"#d3e6ec" },
  tan:    { fur:"#c99b62", muzzle:"#fff4e8", bg:"#f1e2cb" },
  brown:  { fur:"#8a6248", muzzle:"#f3e6d8", bg:"#e8d8c8" },
  white:  { fur:"#f2f0ea", muzzle:"#ffffff", bg:"#f3e9c9" },
  red:    { fur:"#c4573a", muzzle:"#fde9dc", bg:"#f3d2c4" },
};

const clients = [
  { id:1, name:"Basil", tg:"", handle:"@basil_tea", platform:"Instagram", email:"basil@example.com", color:"#e0b07a", pal:P.tan, since:"mar 2026", notes:"Prefiere fondos lisos.", chars:[["Basil", P.tan, 1, 1]], comms:[["Flat Colour", "#5b5bd6", "Sin empezar", 110, "Sin pagar", "En cola"]] },
  { id:2, name:"Ember", tg:"@ember_tg", handle:"@ember_fox", platform:"Bluesky", email:"", color:"#8f9aa8", pal:P.grey, since:"ene 2026", notes:"", chars:[["Ember", P.red, 3, 2]], comms:[["Reference Sheet", "#2f9e64", "Terminada", 150, "Pagado", "Entregada 2 sep"], ["Full Colour", "#3c6bd6", "Terminada", 160, "Pagado", "Entregada 14 jul"]] },
  { id:3, name:"Juniper", tg:"", handle:"@juniper_leaf", platform:"Bluesky", email:"", color:"#c6b3e8", pal:P.lilac, since:"jun 2026", notes:"Quiere que la avise antes de empezar.", chars:[["Juniper", P.lilac, 2, 1]], comms:[["Full Colour", "#3c6bd6", "Sin empezar", 240, "Sin pagar", "En cola"], ["Sketch", "#6b7a8c", "Terminada", 40, "Pagado", "Entregada 3 jun"]] },
  { id:4, name:"Kuro", tg:"@kurocat", handle:"@kuro_cat", platform:"X", email:"kuro@example.com", color:"#7fb2c2", pal:P.teal, since:"nov 2025", notes:"Cliente habitual. Paga siempre por adelantado.", chars:[["Kuro", P.teal, 4, 3], ["Sombra", P.grey, 1, 0]], comms:[["Reference Sheet", "#2f9e64", "Color plano · 3/5", 150, "Sin pagar", "Vence hoy"], ["Full Colour", "#3c6bd6", "Terminada", 160, "Pagado", "Entregada 20 ago"], ["Flat Colour", "#5b5bd6", "Terminada", 110, "Pagado", "Entregada 2 may"]] },
  { id:5, name:"Luna", tg:"@lunamoth", handle:"@luna_moth", platform:"Bluesky", email:"", color:"#c9b8ee", pal:P.lilac, since:"feb 2026", notes:"", chars:[["Luna", P.lilac, 2, 2]], comms:[["Full Colour", "#3c6bd6", "Boceto · 1/5", 160, "Parcial", "Vence en 11 días"], ["Icon", "#6b7a8c", "Terminada", 45, "Pagado", "Entregada 9 abr"], ["Icon", "#6b7a8c", "Terminada", 45, "Pagado", "Entregada 1 mar"], ["Badge", "#6b7a8c", "Terminada", 30, "Pagado", "Entregada 12 feb"]] },
  { id:6, name:"Mochi", tg:"@mochi_tg", handle:"@mochi_draws", platform:"Bluesky", email:"mochi@example.com", color:"#e9a46c", pal:P.orange, since:"sep 2025", notes:"Le encantan las escenas acogedoras.\nPide siempre versión sin firma.", chars:[["Mochi", P.orange, 2, 1], ["Sora", P.red, 2, 0]], comms:[["Flat Colour", "#5b5bd6", "Terminada", 110, "Pagado", "Entregada 30 sep"], ["Full Colour", "#3c6bd6", "Terminada", 160, "Pagado", "Entregada 1 ago"], ["Full Colour", "#3c6bd6", "Terminada", 160, "Pagado", "Entregada 15 jun"]] },
  { id:7, name:"Nova", tg:"@nova_deer", handle:"@nova_deer", platform:"Bluesky", email:"", color:"#d9a066", pal:P.orange, since:"jul 2026", notes:"", chars:[["Nova", P.orange, 3, 1]], comms:[["Rendered Full Body + Complex Background", "#1f8f86", "Fondo · 5/6", 350, "Parcial", "Vence en 21 días"], ["Sketch", "#6b7a8c", "Terminada", 40, "Pagado", "Entregada 20 jul"]] },
  { id:8, name:"Pip", tg:"", handle:"@pip_bear", platform:"Bluesky", email:"", color:"#b08a6a", pal:P.brown, since:"abr 2026", notes:"", chars:[["Pip", P.brown, 1, 1]], comms:[["Full Colour", "#3c6bd6", "Terminada", 160, "Pagado", "Entregada 3 may"], ["Icon", "#6b7a8c", "Terminada", 45, "Pagado", "Entregada 20 abr"]] },
  { id:9, name:"Tilly", tg:"@tilly_s", handle:"@tilly_scribbles", platform:"Bluesky", email:"", color:"#f5b04a", pal:null, since:"oct 2026", notes:"", chars:[], comms:[["Full Colour", "#3c6bd6", "Boceto · 1/5", 240, "Sin pagar", "Vence en 2 días"]] },
];

let selected = 6, menuOpen = false;
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const icon = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
const face = (c, size) => c.pal
  ? `<span class="face" style="width:${size}px;height:${size}px">${head(c.pal)}</span>`
  : `<span class="face" style="width:${size}px;height:${size}px;background:${c.color};color:#1f2933;font-weight:700;font-size:${Math.round(size * .38)}px">${c.name.slice(0, 2)}</span>`;
const active = (c) => c.comms.filter((m) => m[2] !== "Terminada").length;
const payDot = { "Pagado": "var(--ok)", "Parcial": "var(--warn)", "Sin pagar": "var(--faint)" };

function renderList() {
  const q = $("q").value.trim().toLowerCase();
  const rows = clients.filter((c) => (c.name + " " + c.handle).toLowerCase().includes(q));
  $("list").innerHTML = rows.map((c) => {
    const a = active(c);
    return `<button class="crow" role="option" aria-selected="${c.id === selected}" data-id="${c.id}">
      ${face(c, 32)}<span class="t"><strong>${c.name}</strong><small>${c.handle}</small></span>
      <span class="n num">${a ? `<i class="dot" style="background:var(--info)"></i>${a} en curso` : `${c.comms.length}`}</span></button>`;
  }).join("") || `<p style="padding:16px;color:var(--faint)">Ningún cliente se llama así.</p>`;
}

function renderDetail(animate) {
  const c = clients.find((x) => x.id === selected);
  setAmbientFromSvg(c.pal ? head(c.pal) : null);
  const spent = c.comms.reduce((s, m) => s + m[3], 0);
  const unpaid = c.comms.filter((m) => m[4] !== "Pagado").reduce((s, m) => s + (m[4] === "Parcial" ? m[3] / 2 : m[3]), 0);
  const done = c.comms.length - active(c);
  const money = (n) => `${fmt(n).split(",")[0]}<small>,${fmt(n).split(",")[1]} €</small>`;

  $("detail").innerHTML = `
    <div class="chero">
      ${face(c, 72)}
      <div class="who ${animate ? "fade" : ""}">
        <h2>${c.name}</h2>
      </div>
      <div class="hero-actions">
        <button class="btn">${icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>')}Editar</button>
        <div class="menu-anchor">
          <button class="icon-btn" id="menuBtn" aria-label="Más acciones" aria-haspopup="true" aria-expanded="${menuOpen}">${icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>')}</button>
          <div class="menu glass" id="menu" role="menu" ${menuOpen ? "" : "hidden"}>
            <button role="menuitem">${icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>')}Buscar foto en ${c.platform}</button>
            <button role="menuitem">${icon('<path d="M12 5v14M5 12h14"/>')}Nueva comisión para ${c.name}</button>
            <hr>
            <button role="menuitem" class="danger">${icon('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>')}Borrar cliente…</button>
          </div>
        </div>
      </div>
    </div>
    <div class="cbody">
      <div class="cmain ${animate ? "fade" : ""}">
        <div class="figures">
          <div class="fig"><span>Gastado</span><div class="big money">${money(spent)}</div><small class="note2 num">${fmt(spent / c.comms.length)} € de media</small></div>
          <div class="fig"><span>Comisiones</span><div class="big num">${c.comms.length}</div><small class="note2">${active(c)} en curso · ${done} terminadas</small></div>
          <div class="fig"><span>Pendiente de cobro</span><div class="big money" style="color:${unpaid ? "var(--warn)" : "var(--ink)"}">${money(unpaid)}</div><small class="note2">${unpaid ? "Hay cobros pendientes" : "Todo pagado"}</small></div>
        </div>

        <div>
          <p class="h3">Comisiones <span class="num">${c.comms.length}</span></p>
          <div class="crows">${c.comms.map(([t, tag, st, price, pay, when], i) => `
            <button class="mrow" style="--tag:${tag}">
              <span class="thumb">${c.pal && i < 2 ? head(c.pal) : `<span style="width:100%;height:100%;display:grid;place-items:center;background:var(--paper);color:var(--faint)">${icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>')}</span>`}</span>
              <span class="t"><strong title="${t}">${t}</strong><small>${st === "Terminada" ? `<i class="dot" style="background:var(--ok)"></i>Terminada` : `<i class="dot" style="background:var(--info)"></i>${st}`} · ${when}</small></span>
              <span class="status"><i class="dot" style="background:${payDot[pay]}"></i>${pay}</span>
              <span class="price money">${fmt(price)} €</span>
            </button>`).join("")}</div>
        </div>

        <div>
          <p class="h3">Personajes <span class="num">${c.chars.length}</span></p>
          <div class="chars">${c.chars.map(([n, p, refs, uses]) => `
            <button class="char">
              <div class="refs r${Math.min(refs, 3)}"><div>${ref(p, 0)}</div>${refs > 1 ? `<div>${ref(p, 1)}</div>` : ""}${refs > 2 ? `<div class="${refs > 3 ? "more" : ""}">${refs > 3 ? `+${refs - 2}` : ref(p, 2)}</div>` : ""}</div>
              <div class="cap"><strong>${n}</strong><small class="num">${refs} ${refs === 1 ? "referencia" : "referencias"} · ${uses ? `${uses} ${uses === 1 ? "comisión" : "comisiones"}` : "sin comisiones"}</small></div>
            </button>`).join("")}
            <button class="add-char">${icon('<path d="M12 5v14M5 12h14"/>')}Añadir personaje</button>
          </div>
        </div>
      </div>

      <div class="cside ${animate ? "fade" : ""}">
        <dl class="prop">
          <dt>Red social</dt><dd>${c.platform} <a href="#" style="color:var(--ink)">${c.handle}</a></dd>
          <dt>Telegram</dt><dd>${c.tg ? `<a href="#" style="color:var(--ink)">${c.tg}</a>` : `<span style="color:var(--faint)">Sin Telegram</span>`}</dd>
          <dt>Correo</dt><dd>${c.email ? `<a href="#" style="color:var(--ink);overflow-wrap:anywhere">${c.email}</a>` : `<span style="color:var(--faint)">Sin correo</span>`}</dd>
          <dt>Cliente desde</dt><dd>${c.since}</dd>
        </dl>
        <div>
          <p class="section-title">Notas</p>
          <p class="notes" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Notas" data-placeholder="Escribe algo sobre ${c.name}">${c.notes}</p>
          <p class="saved" id="saved">${c.notes ? "Guardado" : "Lo que escribas se guarda solo"}</p>
        </div>
      </div>
    </div>`;
}

$("list").addEventListener("click", (e) => {
  const row = e.target.closest(".crow"); if (!row || +row.dataset.id === selected) return;
  selected = +row.dataset.id; menuOpen = false; renderList(); renderDetail(true);
});
$("q").addEventListener("input", renderList);
$("detail").addEventListener("click", (e) => {
  if (e.target.closest("#menuBtn")) { e.stopPropagation(); menuOpen = !menuOpen; $("menu").hidden = !menuOpen; $("menuBtn").setAttribute("aria-expanded", menuOpen); }
});
$("detail").addEventListener("input", (e) => {
  if (!e.target.classList.contains("notes")) return;
  clients.find((x) => x.id === selected).notes = e.target.innerText;
  $("saved").textContent = "Guardando…"; clearTimeout(window.t); window.t = setTimeout(() => ($("saved").textContent = "Guardado"), 600);
});
document.addEventListener("click", () => { if (menuOpen) { menuOpen = false; $("menu").hidden = true; $("menuBtn").setAttribute("aria-expanded", false); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menuOpen) { menuOpen = false; $("menu").hidden = true; $("menuBtn").focus(); } });

renderList(); renderDetail(false);
</script>
</body>
</html>
````

### `maquetas-ui/comisiones.html`

````html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZeeBoard · Comisiones (maqueta)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
</head>
<body data-page="comisiones">
<div class="ambient" aria-hidden="true"></div>

<div class="app">
  <aside class="side glass" id="side" data-note="Pulsa otra comisión, las etapas, «Filtro» y «Ver cobros»."></aside>

  <main class="main">
    <header class="top glass">
      <h1>Comisiones</h1>
      <label class="search"><svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" placeholder="Buscar por título o cliente" aria-label="Buscar"><kbd>Ctrl K</kbd></label>
      <div class="pop-anchor">
        <button class="btn" id="filterBtn" aria-haspopup="true" aria-expanded="false"><svg class="i" viewBox="0 0 24 24"><path d="M3 6h18M7 12h10M10 18h4"/></svg>Filtro</button>
        <div class="pop glass" id="pop" hidden role="menu"></div>
      </div>
      <div class="chips" id="chips"></div>
      <div class="spacer"></div>
      <div class="seg" role="group" aria-label="Vista">
        <button aria-pressed="true" title="Lista"><svg class="i" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button>
        <button aria-pressed="false" title="Cuadrícula"><svg class="i" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></button>
      </div>
      <button class="primary"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nueva comisión<kbd>Ctrl N</kbd></button>
    </header>

    <div class="work">
      <section class="list glass" id="list" aria-label="Comisiones" role="listbox"></section>
      <section class="detail glass" id="detail" aria-live="polite"></section>
    </div>
  </main>
</div>


<script src="shell.js"></script>
<script src="ambient.js"></script>
<script>
/* ---------- Ilustraciones de ejemplo: el personaje se construye por capas, una por etapa ---------- */
function art(c, stage, alt = 0) {
  const p = c.pal, s = Math.min(stage, 5);
  const sketch = s === 0, line = s >= 1;
  const stroke = sketch ? "#9a9a9a" : "#2a2420";
  const sw = sketch ? 2 : 3.2;
  const dash = sketch ? 'stroke-dasharray="6 3"' : "";
  const fill = (col) => (s >= 2 ? col : "none");
  const shade = s >= 3;
  const bg = s >= 4;
  const tilt = alt ? 'transform="rotate(-6 200 230)"' : "";
  return `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="400" height="400" fill="${bg ? p.bg : "#fbf8f3"}"/>
    ${bg ? `<circle cx="320" cy="90" r="60" fill="${p.bg2}"/><circle cx="70" cy="330" r="90" fill="${p.bg2}" opacity=".7"/>
      <path d="M0 330 Q120 290 220 320 T400 300 V400 H0Z" fill="${p.bg3}"/>` : ""}
    <g ${tilt} stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" ${dash}>
      <ellipse cx="200" cy="350" rx="105" ry="80" fill="${fill(p.fur)}"/>
      <path d="M128 150 L112 52 L188 118Z" fill="${fill(p.fur)}"/>
      <path d="M272 150 L288 52 L212 118Z" fill="${fill(p.fur)}"/>
      <path d="M134 128 L124 74 L168 112Z" fill="${fill(p.inner)}" stroke-width="${sw * .6}"/>
      <path d="M266 128 L276 74 L232 112Z" fill="${fill(p.inner)}" stroke-width="${sw * .6}"/>
      <circle cx="200" cy="200" r="95" fill="${fill(p.fur)}"/>
      ${shade ? `<path d="M200 105 A95 95 0 0 1 200 295 A80 95 0 0 0 200 105Z" fill="${p.shadow}" stroke="none" opacity=".35"/>` : ""}
      <ellipse cx="200" cy="238" rx="56" ry="42" fill="${fill(p.muzzle)}"/>
      <ellipse cx="164" cy="190" rx="13" ry="${alt ? 4 : 16}" fill="${fill("#2a2420")}"/>
      <ellipse cx="236" cy="190" rx="13" ry="${alt ? 4 : 16}" fill="${fill("#2a2420")}"/>
      <path d="M190 222 L210 222 L200 234Z" fill="${fill("#2a2420")}"/>
      <path d="M200 234 Q200 250 186 250 M200 234 Q200 250 214 250" fill="none"/>
      ${s >= 2 ? `<circle cx="150" cy="226" r="11" fill="${p.inner}" stroke="none" opacity=".7"/><circle cx="250" cy="226" r="11" fill="${p.inner}" stroke="none" opacity=".7"/>` : ""}
      ${shade ? `<circle cx="169" cy="184" r="4" fill="#fff" stroke="none"/><circle cx="241" cy="184" r="4" fill="#fff" stroke="none"/>` : ""}
    </g>
  </svg>`;
}

const PAL = {
  kuro:  { fur:"#5b7f8f", inner:"#f2b5a8", muzzle:"#f3efe6", shadow:"#1e3440", bg:"#f3dca0", bg2:"#efc66a", bg3:"#d9a94a", tint:"#e2b55a", amb:["#f0d58f","#9fc0cc","#f2c7a0"] },
  nova:  { fur:"#e07a3c", inner:"#ffd1b8", muzzle:"#fff4e8", shadow:"#7a2e10", bg:"#a7d0e6", bg2:"#7fb6d6", bg3:"#5d93b8", tint:"#5f9fc8", amb:["#8fc0dd","#f0a46e","#bcd8e8"] },
  tilly: { fur:"#f2f0ea", inner:"#f6b8c8", muzzle:"#ffffff", shadow:"#7c6e8f", bg:"#d9cdf0", bg2:"#c3b0e6", bg3:"#a58fd2", tint:"#a58fd2", amb:["#cdbdee","#f2c1d0","#e4dcf6"] },
  luna:  { fur:"#cfc6e8", inner:"#f5c2d6", muzzle:"#faf6ff", shadow:"#5b4f86", bg:"#2f3a5c", bg2:"#46557f", bg3:"#232c47", tint:"#55638f", amb:["#5d6a99","#c8bde6","#3b4670"] },
};

const STAGES = ["Boceto", "Lineart", "Color plano", "Sombreado", "Fondo", "Render"];
const data = [
  { id:1, title:"Reference Sheet", client:"Kuro", color:"#7fb2c2", platform:"Telegram", pal:PAL.kuro, stage:2, total:5, due:0, group:"En curso", price:150, paid:0, received:0, fees:0, tags:[["Reference Sheet","#2f9e64"]], rev:[0,2], payments:[] },
  { id:2, title:"Rendered Full Body + Complex Background", client:"Nova", color:"#e9a46c", platform:"Telegram", pal:PAL.nova, stage:4, total:6, due:21, group:"En curso", price:350, paid:275, received:265.15, fees:9.85,
    tags:[["Render + Complex Background","#1f8f86"],["Rush","#d64545"],["1 personaje","#6b7a8c"]], rev:[0,3],
    payments:[["12 sep","PayPal","150,00"],["2 oct","PayPal","125,00"],["","Comisiones de PayPal","−9,85"]] },
  { id:3, title:"Full Colour", client:"Tilly", color:"#f5b04a", platform:"Bluesky", pal:PAL.tilly, stage:0, total:5, due:2, group:"En curso", price:240, paid:0, received:0, fees:0, tags:[["Full Colour","#3c6bd6"]], rev:[1,3], payments:[] },
  { id:4, title:"Full Colour", client:"Luna", color:"#c9b8ee", platform:"Discord", pal:PAL.luna, stage:0, total:5, due:11, group:"En curso", price:160, paid:80, received:76.9, fees:3.1, tags:[["Full Colour","#3c6bd6"]], rev:[0,3], payments:[["1 oct","PayPal","80,00"]] },
  { id:5, title:"Flat Colour", client:"Basil", color:"#e0b07a", platform:"Email", pal:null, stage:-1, total:4, due:6, group:"En cola", price:110, paid:0, received:0, fees:0, tags:[["Flat Colour","#5b5bd6"]], rev:[0,2], payments:[] },
  { id:6, title:"Full Colour", client:"Juniper", color:"#c6b3e8", platform:"Bluesky", pal:null, stage:-1, total:5, due:7, group:"En cola", price:240, paid:0, received:0, fees:0, tags:[["Full Colour","#3c6bd6"]], rev:[0,3], payments:[] },
];

let selected = 2, viewStage = null, alt = 0, ledgerOpen = false;
const filters = new Set();
const FILTERS = { "Pago": ["Sin pagar", "Parcial", "Pagado"], "Estado": ["Activas", "Vencen esta semana"] };
const fmt = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (id) => document.getElementById(id);
const icon = (d, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24">${d}</svg>`;

function payState(c) { return c.paid === 0 ? "Sin pagar" : c.paid >= c.price ? "Pagado" : "Parcial"; }
function dueText(c) {
  if (c.due === 0) return ["Hoy", "bad"];
  if (c.due <= 3) return [`${c.due} d`, "warn"];
  return [`${c.due} d`, ""];
}
function visible() {
  const q = $("q").value.trim().toLowerCase();
  return data.filter((c) => {
    if (q && !(c.title + " " + c.client).toLowerCase().includes(q)) return false;
    const pay = [...filters].filter((f) => FILTERS.Pago.includes(f));
    if (pay.length && !pay.includes(payState(c))) return false;
    if (filters.has("Activas") && c.stage < 0) return false;
    if (filters.has("Vencen esta semana") && c.due > 7) return false;
    return true;
  });
}

function thumbHTML(c) {
  return c.pal ? art(c, c.stage) : `<span class="ph" style="background:${c.color};width:100%;height:100%;display:grid;place-items:center;color:#1f2933">${c.client.slice(0, 2)}</span>`;
}

function renderList() {
  const rows = visible();
  const groups = [...new Set(rows.map((c) => c.group))];
  $("list").innerHTML = groups.map((g) => {
    const items = rows.filter((c) => c.group === g);
    return `<div class="group">${g}<span class="num">${items.length}</span></div>` + items.map((c) => {
      const [d, cls] = dueText(c);
      const st = c.stage >= 0 ? STAGES[c.stage] : "Sin empezar";
      return `<button class="row" role="option" aria-selected="${c.id === selected}" data-id="${c.id}" style="--tag:${c.tags[0][1]}">
        <span class="thumb" data-thumb="${c.id}">${thumbHTML(c)}</span>
        <span class="t"><strong title="${c.title}">${c.title}</strong><small><i class="dot" style="background:${c.stage >= 0 ? "var(--info)" : "var(--faint)"}"></i>${c.client} · ${st}</small></span>
        <span class="due num ${cls}">${d}</span></button>`;
    }).join("");
  }).join("") || `<p style="padding:16px;color:var(--faint)">Ninguna comisión coincide con el filtro.</p>`;
}

function renderDetail() {
  const c = data.find((x) => x.id === selected);
  const stage = viewStage ?? c.stage;
  const [d, cls] = dueText(c);
  const key = `${c.id}-${stage}-${alt}`;

  const frames = Array.from({ length: c.total }, (_, i) => {
    const done = i < c.stage, cur = i === stage, has = c.pal && i <= c.stage;
    return `<button class="frame ${has ? "" : "todo"}" data-stage="${i}" ${has ? "" : "disabled"} aria-current="${cur}">
      <div class="fimg">${has ? art(c, i) : icon('<path d="M12 5v14M5 12h14"/>')}</div>
      <div class="lbl">${done ? `<span class="check">${icon('<path d="m5 12 5 5 9-10"/>', "")}</span>` : `<em class="num">${i + 1}</em>`}${STAGES[i]}</div>
      <div class="sub">${i === 0 && c.pal ? "2 correcciones" : i === c.stage ? "En curso" : done ? "Hecha" : "Pendiente"}</div></button>`;
  }).join("");

  const pend = c.price - c.paid;
  $("detail").innerHTML = `
    <div class="hero">
      <div>
        <h2>${c.title}</h2>
        <div class="meta"><span class="avatar" style="background:${c.color}">${c.client.slice(0, 2)}</span>
          <span><b style="color:var(--ink);font-weight:600">${c.client}</b> · ${c.platform}</span>
          <span style="display:inline-flex;align-items:center;gap:6px;color:var(--ink)"><i class="dot" style="background:${cls ? `var(--${cls})` : "var(--faint)"}"></i>${c.due === 0 ? "Vence hoy" : `Vence en ${c.due} días`}</span></div>
      </div>
      <div class="hero-actions">
        <button class="btn">${icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>')}Editar</button>
        <button class="icon-btn" aria-label="Más acciones">${icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>')}</button>
      </div>
    </div>
    <div class="body">
      <div class="stage-view">
        <div class="canvas">
          ${c.pal ? `<div class="art ${key !== lastKey ? "enter" : ""}">${art(c, stage, alt)}<div class="alt-nav"><button id="altPrev" aria-label="Alternativa anterior">‹</button><span class="num">Alternativa ${alt + 1} de 2</span><button id="altNext" aria-label="Alternativa siguiente">›</button></div></div>`
            : `<div class="empty-art">${icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>')}<div><b style="color:var(--ink)">Aún no hay imágenes</b><br>Arrastra un archivo o pega con Ctrl+V</div></div>`}
        </div>
        <div class="strip" role="tablist" aria-label="Etapas">${frames}</div>
      </div>
      <div class="props">
        <dl class="prop">
          <dt>Tipo</dt><dd><i class="dot" style="background:${c.tags[0][1]};border-radius:2px"></i>${c.tags[0][0]}</dd>
          <dt>Etapa</dt><dd><i class="dot" style="background:var(--info)"></i>${c.stage >= 0 ? STAGES[c.stage] : "Sin empezar"} <span style="color:var(--faint)" class="num">${Math.max(c.stage, 0) + 1}/${c.total}</span></dd>
          <dt>Entrega</dt><dd class="${cls ? "due " + cls : ""}">${c.due === 0 ? "Hoy" : `En ${c.due} días`}</dd>
          <dt>Revisiones</dt><dd class="num">${c.rev[0]} de ${c.rev[1]}</dd>
        </dl>
        ${c.tags.length > 1 ? "" : "<!--"}<div><p class="section-title">Etiquetas</p><div class="tags">${c.tags.slice(1).map(([t, col]) => `<span class="tag"><i style="background:${col}"></i>${t}</span>`).join("")}</div></div>${c.tags.length > 1 ? "" : "-->"}
        <div>
          <p class="section-title">Pago<button id="ledgerBtn" aria-expanded="${ledgerOpen}">${ledgerOpen ? "Ocultar cobros" : "Ver cobros"}</button></p>
          <div class="money big">${fmt(c.paid).split(",")[0]}<small>,${fmt(c.paid).split(",")[1]} €</small> <small>de ${fmt(c.price)} €</small></div>
          <div class="bar"><i style="width:${(c.paid / c.price) * 100}%"></i><i style="width:${(pend / c.price) * 100}%"></i></div>
          <div class="legend money"><span>Pagado <b>${fmt(c.paid)} €</b></span><span>Pendiente <b style="color:${pend ? "var(--warn)" : "var(--ok)"}">${fmt(pend)} €</b></span></div>
          <div class="ledger ${ledgerOpen ? "open" : ""}"><div><table class="money">
            ${c.payments.length ? c.payments.map(([d, w, a]) => `<tr><td>${d} ${w}</td><td>${a} €</td></tr>`).join("") + `<tr><td><b style="color:var(--ink)">Recibido</b></td><td><b>${fmt(c.received)} €</b></td></tr>` : `<tr><td>Todavía no hay cobros</td><td></td></tr>`}
            <tr><td colspan="2"><button class="btn" style="width:100%;justify-content:center;margin-top:4px">${icon('<path d="M12 5v14M5 12h14"/>')}Añadir cobro</button></td></tr>
          </table></div></div>
        </div>
      </div>
    </div>
    <div class="foot">
      <button class="btn">${icon('<path d="m15 18-6-6 6-6"/>')}Etapa anterior</button>
      <button class="primary">${icon('<path d="m5 12 5 5 9-10"/>')}Marcar como terminada</button>
      <span class="hint">Ctrl+V añade la imagen a <b>${STAGES[Math.max(c.stage, 0)]}</b></span>
    </div>`;
  if (key !== lastKey) setAmbientFromSvg(c.pal ? art(c, stage, alt) : null);
  lastKey = key;
}

let lastKey = "";
function render() { renderList(); renderDetail(); }

/* Selección con la imagen viajando de la lista al detalle */
$("list").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); if (!row) return;
  const id = +row.dataset.id; if (id === selected) return;
  selected = id; viewStage = null; alt = 0; ledgerOpen = false; render();
});

$("detail").addEventListener("click", (e) => {
  const f = e.target.closest(".frame:not([disabled])");
  if (f) { viewStage = +f.dataset.stage; alt = 0; return renderDetail(); }
  if (e.target.closest("#altPrev, #altNext")) { alt = alt ? 0 : 1; return renderDetail(); }
  if (e.target.closest("#ledgerBtn")) { ledgerOpen = !ledgerOpen; renderDetail(); }
});

/* Filtro: un botón, opciones dentro, chips quitables fuera */
function renderFilters() {
  $("pop").innerHTML = Object.entries(FILTERS).map(([g, opts]) => `<h4>${g}</h4>` + opts.map((o) =>
    `<button class="opt" role="menuitemcheckbox" aria-checked="${filters.has(o)}" data-f="${o}"><span class="tick">${filters.has(o) ? icon('<path d="m5 12 5 5 9-10"/>', "") : ""}</span>${o}</button>`).join("")).join("");
  $("chips").innerHTML = [...filters].map((f) => {
    const g = Object.keys(FILTERS).find((k) => FILTERS[k].includes(f));
    return `<span class="chip">${g}: <b>${f}</b><button data-rm="${f}" aria-label="Quitar filtro ${f}">✕</button></span>`;
  }).join("");
}
$("filterBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = $("pop").hidden; $("pop").hidden = !open; $("filterBtn").setAttribute("aria-expanded", open);
});
$("pop").addEventListener("click", (e) => {
  e.stopPropagation();
  const o = e.target.closest("[data-f]"); if (!o) return;
  filters.has(o.dataset.f) ? filters.delete(o.dataset.f) : filters.add(o.dataset.f);
  renderFilters(); renderList();
});
$("chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  filters.delete(b.dataset.rm); renderFilters(); renderList();
});
document.addEventListener("click", () => { $("pop").hidden = true; $("filterBtn").setAttribute("aria-expanded", false); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("pop").hidden = true;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("q").focus(); }
});
$("q").addEventListener("input", renderList);


renderFilters(); render();
</script>
</body>
</html>
````

### `maquetas-ui/estadisticas.html`

````html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZeeBoard · Estadísticas (maqueta)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
<style>
.page { overflow: auto; padding: 4px 24px 32px; min-height: 0; }
.h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.h3 span { color: var(--faint); font-weight: 500; }
section { padding: 22px 0; }
section + section, .split { border-top: 1px solid var(--line); }

/* Stripe: cifras con su cambio respecto al periodo anterior, separadas por líneas finas */
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px 0; }
.kpis > div { padding: 0 20px; border-left: 1px solid var(--line); }
.kpis > div:first-child { padding-left: 0; border-left: 0; }
.kpis dt { color: var(--muted); font-size: 13px; }
.kpis dd { margin: 4px 0 0; }
.kpis .big { font-size: 24px; }
.delta { display: block; margin-top: 2px; font-size: 12px; color: var(--faint); }
.delta.up { color: var(--ok); }
.delta.down { color: var(--bad); }

.split { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); }
.split > section { border-top: 0; padding-right: 24px; min-width: 0; }
.split > section + section { padding: 22px 0 22px 24px; border-left: 1px solid var(--line); }

/* Tabla por tipo: números alineados a la derecha, de ancho fijo */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: right; font-weight: 500; color: var(--faint); padding: 0 0 8px 12px; white-space: nowrap; }
td { text-align: right; padding: 9px 0 9px 12px; border-top: 1px solid var(--line); white-space: nowrap; font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { text-align: left; padding-left: 0; }
td:first-child { white-space: normal; font-weight: 600; }
td:first-child i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 8px; vertical-align: -1px; }
.table-wrap { overflow-x: auto; }

.rank { display: grid; gap: 8px; }
.rank > div { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 10px; }
.rank .bar { grid-column: 2 / -1; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin-top: -4px; }
.rank .bar i { display: block; height: 100%; background: var(--ink); }
.rank strong { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rank small { color: var(--faint); font-weight: 500; }
.remark { margin: 14px 0 0; color: var(--muted); }

/* Solicitudes: un embudo en una barra */
.funnel { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--line); margin: 12px 0 10px; }
.funnel i { display: block; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--muted); }
.legend b { color: var(--ink); }
.fee .big { font-size: 22px; }
.empty { color: var(--faint); margin: 0; }

@media (max-width: 1100px) {
  .split { grid-template-columns: minmax(0, 1fr); }
  .split > section { padding-right: 0; }
  .split > section + section { padding: 22px 0; border-left: 0; border-top: 1px solid var(--line); }
}
</style>
</head>
<body data-page="estadisticas">
<div class="ambient" aria-hidden="true"></div>
<div class="app">
  <aside class="side glass" id="side" data-note="Cambia el periodo arriba: todo se recalcula y compara con el periodo anterior."></aside>
  <main class="main">
    <header class="top glass"><h1>Estadísticas</h1>
      <div class="seg" role="group" aria-label="Periodo"><button data-p="year" aria-pressed="true">Este año</button><button data-p="12m" aria-pressed="false">Últimos 12 meses</button><button data-p="all" aria-pressed="false">Todo</button></div>
      <div class="spacer"></div><span style="color:var(--faint);font-size:12.5px" title="Las cantidades en otras monedas nunca se suman">1 comisión en USD no se cuenta</span></header>
    <section class="page glass" id="page"></section>
  </main>
</div>

<script src="shell.js"></script>
<script src="chart.js"></script>
<script>
// Datos de ejemplo por periodo (en la app salen de computeStats en src/lib/stats.ts)
const MONTHS = ["nov", "dic", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct"];
const VALUES = [120, 260, 180, 210, 330, 290, 155.01, 484.8, 445.96, 376.49, 226.31, 96.75];
const D = {
  year: { months: 10, cur: { received: 2765.32, pieces: 14, avg: 197.52, rate: 26.7 }, prev: { received: 2210, pieces: 12, avg: 184.17, rate: 24.9 } },
  "12m": { months: 12, cur: { received: 3145.32, pieces: 16, avg: 196.58, rate: 26.4 }, prev: { received: 2480, pieces: 13, avg: 190.77, rate: 25.3 } },
  all: { months: 12, cur: { received: 5890.1, pieces: 31, avg: 190.0, rate: 25.8 }, prev: null },
};
const TYPES = [["Full Colour", "#2563eb", 8, 160, 6, 26.67, 18], ["Reference Sheet", "#16a34a", 2, 150, 6.5, 23.08, 21], ["Flat Colour", "#4f46e5", 2, 110, 4, 27.5, 12], ["Sketch", "#475569", 2, 40, 1.5, 26.67, 5], ["Sin tipo", "#a79f93", 0, 0, null, null, null]];
const CLIENTS = [["Mochi", 3, 430], ["Kuro", 3, 420], ["Ember", 2, 310], ["Pip", 2, 205], ["Luna", 2, 125]];
const S = { p: "year" };
const $ = (id) => document.getElementById(id);
const eur = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const money = (n) => { const [a, b] = eur(n).split(","); return `${a}<small>,${b}</small>`; };

function delta(now, before, unit = "%") {
  if (before == null) return `<span class="delta">Sin periodo anterior</span>`;
  const pct = Math.round(((now - before) / before) * 100);
  return `<span class="delta ${pct > 0 ? "up" : pct < 0 ? "down" : ""}">${pct > 0 ? "▲" : pct < 0 ? "▼" : "="} ${Math.abs(pct)} ${unit} respecto al periodo anterior</span>`;
}

function render() {
  const d = D[S.p], c = d.cur, p = d.prev;
  const months = MONTHS.slice(12 - d.months).map((m, i) => [m, VALUES[12 - d.months + i]]);
  const top = Math.max(...CLIENTS.map((x) => x[2]));
  const req = { received: 24, accepted: 14, declined: 5, waitlist: 2, open: 3 };
  const parts = [["accepted", "Aceptadas", "var(--ok)"], ["declined", "Rechazadas", "var(--faint)"], ["waitlist", "En espera", "var(--warn)"], ["open", "Sin responder", "var(--info)"]];
  $("page").innerHTML = `
    <section><dl class="kpis">
      <div><dt>Recibido</dt><dd class="big money">${money(c.received)}</dd>${delta(c.received, p?.received)}</div>
      <div><dt>Piezas entregadas</dt><dd class="big num">${c.pieces}</dd>${delta(c.pieces, p?.pieces)}</div>
      <div><dt>Media por pieza</dt><dd class="big money">${money(c.avg)}</dd>${delta(c.avg, p?.avg)}</div>
      <div><dt>Por hora</dt><dd class="big money">${money(c.rate)}<small> /h</small></dd>${delta(c.rate, p?.rate)}</div>
    </dl></section>

    <section><p class="h3">Recibido por mes <span>tras las comisiones de las plataformas</span></p>${lineChart(months, 190)}</section>

    <div class="split">
      <section><p class="h3">Por tipo de comisión</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Tipo</th><th>Piezas</th><th>Media</th><th>Horas</th><th>Por hora</th><th>Días</th></tr></thead>
          <tbody>${TYPES.filter((t) => t[2]).map(([n, col, pcs, avg, h, r, days]) => `<tr><td><i style="background:${col}"></i>${n}</td><td>${pcs}</td><td>${eur(avg)}</td><td>${h ? String(h).replace(".", ",") + " h" : "—"}</td><td>${r ? eur(r) : "—"}</td><td>${days ?? "—"}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="remark" style="color:var(--faint);font-size:12px">Días: media desde que se crea la comisión hasta que se entrega.</p></section>
      <section><p class="h3">Mejores clientes</p>
        <div class="rank">${CLIENTS.map(([n, pcs, net], i) => `<div><span class="num" style="color:var(--faint)">${i + 1}</span><strong>${n} <small>· ${pcs} ${pcs === 1 ? "pieza" : "piezas"}</small></strong><span class="money" style="font-weight:600">${eur(net)}</span><span class="bar"><i style="width:${(net / top) * 100}%"></i></span></div>`).join("")}</div>
        <p class="remark">El <b>68 %</b> de estos ingresos viene de clientes que repiten.</p></section>
    </div>

    <div class="split">
      <section><p class="h3">Solicitudes <span class="num">${req.received} recibidas · ${req.accepted} aceptadas</span></p>
        <div class="funnel" aria-hidden="true">${parts.map(([k, , col]) => `<i style="width:${(req[k] / req.received) * 100}%;background:${col}"></i>`).join("")}</div>
        <div class="legend num">${parts.map(([k, l, col]) => `<span><i class="dot" style="background:${col};display:inline-block;margin-right:6px"></i>${l} <b>${req[k]}</b></span>`).join("")}</div>
        <p class="remark">Aceptas el <b>74 %</b> de las que ya has decidido.</p></section>
      <section class="fee"><p class="h3">Comisiones de las plataformas</p>
        <div class="big money">${money(86.4)}</div>
        <p class="remark">El <b>3,1 %</b> de lo que pagaron los clientes. <span style="color:var(--faint)">2 cobros sin la cantidad recibida no cuentan.</span></p></section>
    </div>`;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]"); if (!b) return;
  S.p = b.dataset.p; document.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", x === b)); render();
});
render();
</script>
</body>
</html>
````

### `maquetas-ui/resumen.html`

````html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZeeBoard · Resumen (maqueta)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
<style>
.top .date { color: var(--faint); }

/* Una sola superficie con dos columnas: lo de hoy a la izquierda, las cifras a la derecha */
.board { display: grid; grid-template-columns: minmax(0, 1fr) clamp(280px, 30%, 360px); min-height: 0; overflow: hidden; }
.col { overflow: auto; padding: 22px 24px 28px; display: grid; align-content: start; gap: 28px; min-width: 0; }
.col + .col { border-left: 1px solid var(--line); padding-inline: 20px; }

.h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.h3 span { color: var(--faint); font-weight: 500; }
.h3 a { margin-left: auto; color: var(--faint); font-weight: 500; text-decoration: none; }
.h3 a:hover { color: var(--ink); }

/* Things 3: «Hoy» arriba, grande y tranquilo */
.today h2 { margin: 0 0 4px; font: 600 30px/1.1 "Fraunces", serif; letter-spacing: -.02em; }
.today p.lead { margin: 0 0 14px; color: var(--muted); }
.att { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; padding: 8px; border-radius: 4px; text-align: left; text-decoration: none; color: inherit; }
.att:hover { background: color-mix(in srgb, var(--highlight) 60%, transparent); }
.att + .att { box-shadow: 0 -1px 0 var(--line); }
.att .thumb { width: 40px; height: 40px; }
.att strong { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.att small { display: block; color: var(--muted); font-size: 12.5px; }
.kind { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.all-clear { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px dashed var(--line-strong); border-radius: 4px; color: var(--muted); }

/* En curso: mismas filas que Comisiones, con barra de progreso */
.wrow { position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr) minmax(70px, 120px) 74px; align-items: center; gap: 12px; padding: 8px 8px 8px 14px; border-radius: 4px; text-decoration: none; color: inherit; }
.wrow::before { content: ""; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--tag); }
.wrow:hover { background: color-mix(in srgb, var(--highlight) 60%, transparent); }
.wrow + .wrow { box-shadow: 0 -1px 0 var(--line); }
.wrow .thumb { width: 40px; height: 40px; }
.wrow .t { min-width: 0; }
.wrow strong { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wrow small { display: block; color: var(--faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prog { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
.prog i { display: block; height: 100%; background: var(--ink); border-radius: 2px; }
.wrow .due { text-align: right; }

/* Stripe: cifras en lista, sin cajas */
.figs { display: grid; }
.figs > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 2px 12px; padding: 12px 0; }
.figs > div + div { border-top: 1px solid var(--line); }
.figs dt { color: var(--muted); }
.figs dd { margin: 0; text-align: right; }
.figs .big { font-size: 20px; }
.figs small.sub { grid-column: 1 / -1; color: var(--faint); font-size: 12px; }

.unpaid { display: grid; }
.unpaid a { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 7px 4px; border-radius: 4px; color: inherit; text-decoration: none; }
.unpaid a:hover { background: color-mix(in srgb, var(--highlight) 60%, transparent); }
.unpaid a + a { box-shadow: 0 -1px 0 var(--line); }
.unpaid .t { min-width: 0; }
.unpaid strong { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.unpaid small { display: block; color: var(--faint); font-size: 12px; }
.unpaid .amt { font-weight: 600; white-space: nowrap; }
.unpaid .total { display: flex; justify-content: space-between; padding: 8px 4px 0; border-top: 1px solid var(--line-strong); margin-top: 2px; font-weight: 600; }

.rate .big { font-size: 26px; }
.rate small { display: block; color: var(--faint); font-size: 12px; margin-top: 2px; }

/* Recibido por mes */
.chart-head { display: flex; align-items: baseline; gap: 8px; margin: 0 0 10px; }
.chart-head .h3 { margin: 0; }
.kpi { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.kpi .big { font-size: 22px; }
.kpi .delta { font-size: 12px; color: var(--faint); }



.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag b { color: var(--faint); font-weight: 500; margin-left: 2px; }

.thumb { border-radius: 4px; overflow: hidden; display: grid; place-items: center; }
.thumb svg { width: 100%; height: 100%; display: block; }
.ph { width: 100%; height: 100%; display: grid; place-items: center; font-weight: 600; font-size: 13px; color: #1f2933; }

@media (max-width: 1180px) {
  .board { display: block; overflow-y: auto; }
  .col { overflow: visible; }
  .col + .col { border-left: 0; border-top: 1px solid var(--line); padding-inline: 24px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px 32px; }
}
@media (max-width: 760px) {
  .wrow { grid-template-columns: 40px minmax(0, 1fr) 64px; }
  .wrow .prog { display: none; }
}
</style>
</head>
<body data-page="resumen">
<div class="ambient" aria-hidden="true"></div>

<div class="app">
  <aside class="side glass" id="side" data-note="Las filas llevan a Comisiones. Pasa el ratón por los meses de «Recibido por mes»."></aside>

  <main class="main">
    <header class="top glass">
      <h1>Resumen</h1>
      <span class="date" id="date"></span>
      <div class="spacer"></div>
      <a class="primary" href="comisiones.html" style="text-decoration:none"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nueva comisión<kbd>Ctrl N</kbd></a>
    </header>
    <section class="board glass" id="board"></section>
  </main>
</div>

<script src="shell.js"></script>
<script src="ambient.js"></script>
<script src="art.js"></script>
<script src="chart.js"></script>
<script>
const P = {
  teal:  { fur:"#5b7f8f", muzzle:"#f3efe6", bg:"#f3dca0" },
  orange:{ fur:"#e07a3c", muzzle:"#fff4e8", bg:"#a7d0e6" },
  sketch:{ fur:"#fbf8f3", muzzle:"#fbf8f3", bg:"#fbf8f3" },
};

/* Mismos datos que muestra hoy el Resumen de la app, recolocados */
const attention = [
  { kind: "Vence hoy", tone: "bad", title: "Reference Sheet", text: "Kuro · Color plano 3/5. Se entrega hoy.", pal: P.teal },
  { kind: "Sin avances", tone: "warn", title: "Full Colour", text: "Luna · Boceto. Sin cambios desde hace 9 días.", pal: P.sketch },
];
const work = [
  { title: "Reference Sheet", client: "Kuro", stage: "Color plano", n: 3, of: 5, due: "Hoy", tone: "bad", tag: "#2f9e64", pal: P.teal },
  { title: "Rendered Full Body + Complex Background", client: "Nova", stage: "Fondo", n: 5, of: 6, due: "21 días", tone: "", tag: "#1f8f86", pal: P.orange },
  { title: "Full Colour", client: "Tilly", stage: "Boceto", n: 1, of: 5, due: "2 días", tone: "warn", tag: "#3c6bd6", pal: P.sketch },
  { title: "Full Colour", client: "Luna", stage: "Boceto", n: 1, of: 5, due: "11 días", tone: "", tag: "#3c6bd6", pal: P.sketch },
  { title: "Flat Colour", client: "Basil", stage: "Sin empezar", n: 0, of: 4, due: "Sin fecha", tone: "", tag: "#5b5bd6", color: "#e0b07a" },
  { title: "Full Colour", client: "Juniper", stage: "Sin empezar", n: 0, of: 5, due: "Sin fecha", tone: "", tag: "#3c6bd6", color: "#c6b3e8" },
];
const unpaid = [
  ["Full Colour", "Tilly", 240, "#f5b04a"], ["Full Colour", "Juniper", 240, "#c6b3e8"], ["Full Colour", "Luna", 160, "#c9b8ee"],
  ["Reference Sheet", "Kuro", 150, "#7fb2c2"], ["Flat Colour", "Basil", 110, "#e0b07a"], ["Rendered Full Body + Complex Background", "Nova", 75, "#d9a066"],
];
const months = [["may", 155.01], ["jun", 484.80], ["jul", 445.96], ["ago", 376.49], ["sep", 226.31], ["oct", 96.75]];
const topTags = [["Full Colour", "#3c6bd6", 5], ["Reference Sheet", "#2f9e64", 2], ["Render + Complex Background", "#1f8f86", 2], ["Flat Colour", "#5b5bd6", 2], ["Commercial use", "#1f8f86", 1], ["Rush", "#d64545", 1]];

const fmt = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => `${fmt(n).split(",")[0]}<small>,${fmt(n).split(",")[1]} €</small>`;
const thumb = (w) => w.pal ? head(w.pal) : `<span class="ph" style="background:${w.color}">${w.client.slice(0, 2)}</span>`;

const today = new Date(2026, 9, 12);
document.getElementById("date").textContent = today.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

const total6 = months.reduce((s, m) => s + m[1], 0);
const totalUnpaid = unpaid.reduce((s, u) => s + u[2], 0);

document.getElementById("board").innerHTML = `
  <div class="col">
    <section class="today">
      <h2>Hoy</h2>
      <p class="lead">${attention.length ? `${attention.length} cosas necesitan tu atención.` : "Nada urgente."}</p>
      ${attention.length ? attention.map((a) => `
        <a class="att" href="comisiones.html">
          <span class="thumb">${head(a.pal)}</span>
          <span style="min-width:0"><strong>${a.title}</strong><small>${a.text}</small></span>
          <span class="kind"><i class="dot" style="background:var(--${a.tone})"></i>${a.kind}</span>
        </a>`).join("") : `<div class="all-clear">Todo al día. Nada vence hoy ni hay pagos atrasados.</div>`}
    </section>

    <section>
      <p class="h3">En curso <span class="num">${work.length}</span><a href="comisiones.html">Ver todas</a></p>
      ${work.map((w) => `
        <a class="wrow" href="comisiones.html" style="--tag:${w.tag}">
          <span class="thumb">${thumb(w)}</span>
          <span class="t"><strong title="${w.title}">${w.title}</strong><small>${w.client} · ${w.stage}${w.n ? ` ${w.n}/${w.of}` : ""}</small></span>
          <span class="prog" title="${w.n} de ${w.of} etapas"><i style="width:${(w.n / w.of) * 100}%"></i></span>
          <span class="due num ${w.tone}">${w.due}</span>
        </a>`).join("")}
    </section>

    <section>
      <div class="chart-head"><p class="h3">Recibido por mes <span>tras comisiones</span></p></div>
      <div class="kpi money"><span class="big">${money(total6)}</span><span class="delta">en 6 meses · media ${fmt(total6 / 6)} € al mes</span></div>
      ${lineChart(months)}
    </section>
  </div>

  <div class="col">
    <section>
      <p class="h3">Este mes</p>
      <dl class="figs">
        <div><dt>Recibido</dt><dd class="big money">${money(96.75)}</dd><small class="sub">3,25 € en comisiones de la plataforma</small></div>
        <div><dt>Pendiente de cobro</dt><dd class="big money" style="color:var(--warn)">${money(975)}</dd><small class="sub">6 comisiones sin pagar del todo</small></div>
        <div><dt>En curso</dt><dd class="big num">6</dd></div>
        <div><dt>Vencen en 7 días</dt><dd class="big num">1</dd><small class="sub">Incluye las atrasadas</small></div>
      </dl>
    </section>

    <section>
      <p class="h3">Sin cobrar <span class="num">${unpaid.length}</span></p>
      <div class="unpaid">
        ${unpaid.map(([t, c, a, col]) => `<a href="comisiones.html"><span class="face" style="width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:${col};font-size:10px;font-weight:700;color:#1f2933">${c.slice(0, 2)}</span>
          <span class="t"><strong title="${t}">${t}</strong><small>${c}</small></span><span class="amt money">${fmt(a)} €</span></a>`).join("")}
        <div class="total money"><span>Total</span><span>${fmt(totalUnpaid)} €</span></div>
      </div>
    </section>

    <section class="rate">
      <p class="h3">Tu tarifa por hora <span>últimos 90 días</span></p>
      <div class="big money">27<small>,53 €/h</small></div>
      <small>5 piezas · 40,5 h</small>
    </section>

    <section>
      <p class="h3">Etiquetas más usadas</p>
      <div class="tags">${topTags.map(([t, c, n]) => `<span class="tag"><i style="background:${c}"></i>${t}<b class="num">${n}</b></span>`).join("")}</div>
    </section>
  </div>`;

/* Sin una imagen concreta: fondo neutro */
setAmbientFromSvg(null);

</script>
</body>
</html>
````

### `maquetas-ui/solicitudes.html`

````html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZeeBoard · Solicitudes (maqueta)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
<style>
/* Huecos en la barra superior */
.slots { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; white-space: nowrap; }
.pips { display: flex; gap: 3px; }
.pips i { width: 10px; height: 14px; border-radius: 2px; border: 1px solid var(--line-strong); }
.pips i.on { background: var(--ink); border-color: var(--ink); }
.pips i.over { background: var(--bad); border-color: var(--bad); }
.slots input { width: 52px; padding: 4px 6px; text-align: right; }
.slots .over-text { color: var(--bad); font-weight: 600; }

/* Bandeja: lista + solicitud abierta */
.work { grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); }
.inbox { display: grid; grid-template-rows: minmax(0, 1fr) auto; padding: 0; overflow: hidden; }
.inbox .scroll { overflow: auto; padding: 8px; }
.group button { color: inherit; font: inherit; }
.hint { margin: 2px 8px 6px; padding: 8px 10px; border-radius: 4px; background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ink); font-size: 12.5px; }
.crow { grid-template-columns: 10px minmax(0, 1fr) auto; }
.crow .warn { color: var(--warn); font-weight: 600; }
.form-line { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
.form-line .t { min-width: 0; flex: 1; }
.form-line small { display: block; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.form-line .menu { top: auto; bottom: calc(100% + 6px); transform-origin: bottom right; }

.req-hero { padding: 22px 24px 16px; display: flex; align-items: flex-start; gap: 16px; }
.req-hero h2 { margin: 0; font: 600 30px/1.08 "Fraunces", serif; letter-spacing: -.02em; overflow-wrap: anywhere; }
.req-hero .meta { margin-top: 6px; }
.req-body { display: grid; grid-template-columns: minmax(0, 1fr) clamp(260px, 32%, 320px); min-height: 0; border-top: 1px solid var(--line); }
.details { overflow: auto; padding: 18px 24px; min-width: 0; }
.details p { margin: 0 0 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 68ch; }
.details a { color: var(--ink); text-decoration-color: var(--muted); text-underline-offset: 3px; }
.side-props { border-left: 1px solid var(--line); padding: 18px 16px; overflow: auto; }
.side-props .prop { grid-template-columns: minmax(0, 1fr); gap: 2px; }
.side-props .prop dd + dt { margin-top: 10px; }
.need-type { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 10%, var(--paper)); font-weight: 600; }
.foot .why { color: var(--faint); font-size: 12.5px; }
.empty { display: grid; place-content: center; gap: 6px; height: 100%; text-align: center; color: var(--faint); }

@media (max-width: 1100px) {
  .req-body { display: block; overflow-y: auto; }
  .details { overflow: visible; }
  .side-props { border-left: 0; border-top: 1px solid var(--line); }
}
@media (max-width: 1200px) { .slots .label { display: none; } }
</style>
</head>
<body data-page="solicitudes">
<div class="ambient" aria-hidden="true"></div>
<div class="app">
  <aside class="side glass" id="side" data-note="Acepta, pon en espera o rechaza; prueba la solicitud sin tipo, «Importar», «Nueva solicitud» y el ⋯ del formulario."></aside>
  <main class="main">
    <header class="top glass" id="top"></header>
    <div class="work">
      <section class="list glass inbox" aria-label="Solicitudes"><div class="scroll" id="list" role="listbox"></div><div class="form-line" id="form"></div></section>
      <section class="detail glass" id="detail" aria-live="polite"></section>
    </div>
  </main>
</div>

<dialog id="newDlg">
  <form method="dialog">
    <h3>Nueva solicitud</h3>
    <div class="fields">
      <input class="field" name="name" placeholder="Nombre" required autofocus>
      <div style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px">
        <select class="field" name="platform"><option>Telegram</option><option>Bluesky</option><option>Discord</option><option>Email</option><option>Otra</option></select>
        <input class="field" name="contact" placeholder="@usuario o correo">
      </div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:10px">
        <select class="field" name="type" required><option value="">Tipo de comisión</option></select>
        <input class="field" name="chars" type="number" min="1" value="1" title="Número de personajes">
      </div>
      <textarea class="field" name="details" rows="4" placeholder="Qué pide: idea, referencias, enlaces…"></textarea>
    </div>
    <div class="actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="primary" value="ok">Añadir solicitud</button></div>
  </form>
</dialog>

<dialog id="fullDlg">
  <form method="dialog">
    <h3 id="fullTitle"></h3>
    <p id="fullText"></p>
    <div class="actions"><button class="btn" value="wait">Poner en espera</button><button class="btn" value="cancel">Cancelar</button><button class="primary" value="ok">Aceptar igualmente</button></div>
  </form>
</dialog>

<script src="shell.js"></script>
<script>
const TYPES = [[1, "Sketch", 40], [2, "Flat Colour", 110], [3, "Full Colour", 160], [4, "Reference Sheet", 150], [5, "Rendered Full Body", 350]];
const RATE = 0.5; // ajuste «personaje extra» de la app
const reqs = [
  { id: 1, name: "Ana", platform: "Telegram", contact: "@ana_draws", date: "10 oct", type: 3, chars: 1, email: "ana@example.com", tag: ["Bluesky", "@ana.bsky.social"], status: "new", details: "Mi personaje en una cafetería, luz de tarde.\nReferencias: https://toyhou.se/ana/ref" },
  { id: 2, name: "Leo", platform: "Bluesky", contact: "@leo.bsky.social", date: "9 oct", type: null, chars: 2, email: "", tag: ["Bluesky", "@leo.bsky.social"], status: "new", details: "Dos personajes abrazados, estilo chibi. ¿Haces descuento por dos?" },
  { id: 3, name: "Marta", platform: "Discord", contact: "marta#2210", date: "7 oct", type: 4, chars: 1, email: "marta@example.com", tag: null, status: "new", details: "Hoja de referencia completa con vista frontal y trasera." },
  { id: 4, name: "Iker", platform: "Telegram", contact: "@iker", date: "28 sep", type: 2, chars: 1, email: "", tag: ["X", "@iker_art"], status: "waitlist", details: "Cuando tengas hueco, sin prisa." },
  { id: 5, name: "Nova", platform: "Telegram", contact: "@nova_deer", date: "2 sep", type: 5, chars: 1, email: "", tag: ["Bluesky", "@nova_deer"], status: "accepted", commission: true, details: "Render completo con fondo de bosque." },
  { id: 6, name: "Rex", platform: "Email", contact: "rex@example.com", date: "20 ago", type: 1, chars: 3, email: "rex@example.com", tag: null, status: "declined", details: "Tres bocetos para mañana." },
];
const S = { open: true, total: 8, taken: 6, sel: 1, archive: false, menu: false };
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const esc = (t) => t.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
const linkify = (t) => esc(t).replace(/https?:\/\/\S+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
const type = (r) => TYPES.find((t) => t[0] === r.type);
const STATE = { new: ["Nueva", "info"], waitlist: ["En espera", "warn"], accepted: ["Aceptada", "ok"], declined: ["Rechazada", "faint"] };
const icon = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
const MORE = icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>');

function renderTop() {
  const free = S.total - S.taken;
  $("top").innerHTML = `<h1>Solicitudes</h1>
    <div class="seg" role="group" aria-label="Comisiones abiertas"><button data-open="0" aria-pressed="${!S.open}">Cerradas</button><button data-open="1" aria-pressed="${S.open}">Abiertas</button></div>
    <div class="slots"><span class="pips" aria-hidden="true">${Array.from({ length: Math.max(S.total, S.taken) }, (_, i) => `<i class="${i >= S.total ? "over" : i < S.taken ? "on" : ""}"></i>`).join("")}</span>
      <span class="num"><span class="label">${S.taken} de ${S.total} huecos · </span>${free > 0 ? `${free} ${free === 1 ? "libre" : "libres"}` : free === 0 ? "lleno" : `<span class="over-text">${-free} de más</span>`}</span>
      <input class="field num" id="total" type="number" min="1" value="${S.total}" aria-label="Huecos totales" title="Cada comisión sin terminar ocupa un hueco, también las de la cola"></div>
    <div class="spacer"></div>
    <label class="btn" style="cursor:pointer">${icon('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>')}Importar CSV<input type="file" accept=".csv,text/csv" hidden id="import"></label>
    <button class="primary" id="new">${icon('<path d="M12 5v14M5 12h14"/>')}Nueva solicitud</button>`;
}

function renderList() {
  const by = (st) => reqs.filter((r) => st.includes(r.status));
  const row = (r) => `<button class="crow" role="option" aria-selected="${r.id === S.sel}" data-id="${r.id}">
    <i class="dot" style="background:var(--${STATE[r.status][1]})"></i>
    <span class="t"><strong>${esc(r.name)}</strong><small>${r.type ? `${type(r)[1]} · ${r.chars} ${r.chars === 1 ? "personaje" : "personajes"}` : `<span class="warn">Falta elegir el tipo</span>`}</small></span>
    <span class="n num">${r.date}</span></button>`;
  const nw = by(["new"]), wl = by(["waitlist"]), ar = by(["accepted", "declined"]), free = S.total - S.taken;
  $("list").innerHTML = `<div class="group">Nuevas<span class="num">${nw.length}</span></div>${nw.map(row).join("") || `<p class="hint" style="background:none;color:var(--faint)">No hay solicitudes nuevas.</p>`}
    ${wl.length ? `<div class="group">En espera<span class="num">${wl.length}</span></div>${free > 0 ? `<p class="hint">Tienes ${free} ${free === 1 ? "hueco libre" : "huecos libres"}: puedes sacar a alguien de la espera.</p>` : ""}${wl.map(row).join("")}` : ""}
    ${ar.length ? `<div class="group"><button id="arch" aria-expanded="${S.archive}">Archivo <span class="num" style="color:var(--faint)">${ar.length}</span> ${S.archive ? "▴" : "▾"}</button></div>${S.archive ? ar.map(row).join("") : ""}` : ""}`;
  $("form").innerHTML = `<i class="dot" style="background:var(--ok)"></i><span class="t">Formulario conectado<small title="C:\\Users\\Ana\\Drive\\respuestas.csv">Revisado hace 5 min · cada 30 min</small></span>
    <div class="menu-anchor"><button class="icon-btn" id="formBtn" aria-label="Opciones del formulario" aria-expanded="${S.menu}">${MORE}</button>
      <div class="menu glass" ${S.menu ? "" : "hidden"} role="menu"><button role="menuitem">Revisar ahora</button><button role="menuitem">Cambiar archivo…</button></div></div>`;
}

function renderDetail() {
  const r = reqs.find((x) => x.id === S.sel);
  if (!r) return ($("detail").innerHTML = `<div class="empty"><b style="color:var(--ink)">Nada seleccionado</b>Elige una solicitud de la lista.</div>`);
  const t = type(r), [label, tone] = STATE[r.status], live = r.status === "new" || r.status === "waitlist";
  const actions = live
    ? `<button class="primary" data-act="accept" ${t ? "" : "disabled"}>${icon('<path d="m5 12 5 5 9-10"/>')}Aceptar</button>
       ${r.status === "new" ? `<button class="btn" data-act="waitlist">Poner en espera</button>` : ""}
       <button class="btn" data-act="declined">Rechazar</button>${t ? "" : `<span class="why">Elige el tipo antes de aceptar</span>`}`
    : `${r.status === "accepted" && r.commission ? `<a class="btn" href="comisiones.html" style="text-decoration:none">Abrir comisión</a>` : ""}
       ${r.status === "declined" ? `<button class="btn" data-act="new">Restaurar</button>` : ""}
       <button class="btn" data-act="remove">Quitar de la lista</button>`;
  $("detail").innerHTML = `
    <div class="req-hero"><div style="min-width:0"><h2>${esc(r.name)}</h2>
      <div class="meta"><span style="display:inline-flex;align-items:center;gap:6px;color:var(--ink)"><i class="dot" style="background:var(--${tone})"></i>${label}</span><span>Recibida el ${r.date}</span></div></div></div>
    <div class="req-body">
      <div class="details"><p class="section-title">Lo que pide</p><p>${linkify(r.details)}</p></div>
      <div class="side-props"><dl class="prop">
        <dt>Tipo</dt><dd>${t ? t[1] : `<select class="field need-type" id="setType"><option value="">Elige el tipo…</option>${TYPES.map(([id, n]) => `<option value="${id}">${n}</option>`).join("")}</select>`}</dd>
        <dt>Personajes</dt><dd class="num">${r.chars}</dd>
        <dt>Estimado</dt><dd class="num">${t ? `≈ ${fmt(t[2] * (1 + RATE * (r.chars - 1)))}` : `<span style="color:var(--faint)">Al elegir el tipo</span>`}</dd>
        <dt>Contacto</dt><dd>${r.platform} <a href="#" style="color:var(--ink)">${esc(r.contact)}</a></dd>
        <dt>Red social</dt><dd>${r.tag ? `${r.tag[0]} <a href="#" style="color:var(--ink)">${esc(r.tag[1])}</a>` : `<span style="color:var(--faint)">No la indicó</span>`}</dd>
        <dt>Correo</dt><dd>${r.email ? `<a href="#" style="color:var(--ink);overflow-wrap:anywhere">${esc(r.email)}</a>` : `<span style="color:var(--faint)">Sin correo</span>`}</dd>
      </dl></div>
    </div>
    <div class="foot">${actions}</div>`;
}

function render() { renderTop(); renderList(); renderDetail(); }

function setStatus(r, status) {
  if (status === "accepted") { S.taken++; r.commission = true; }
  r.status = status;
  // Al salir de nuevas/espera, la selección pasa a la siguiente pendiente
  if (status === "accepted" || status === "declined") S.sel = (reqs.find((x) => x.status === "new" || x.status === "waitlist") || r).id;
  render();
}

function accept(r) {
  if (S.taken < S.total) return setStatus(r, "accepted");
  $("fullTitle").textContent = `Huecos llenos. ¿Aceptar a ${r.name} igualmente?`;
  $("fullText").textContent = `Tienes ${S.taken} de ${S.total} huecos ocupados. Aceptar añade uno más; también puedes ponerla en espera.`;
  $("fullDlg").onclose = () => { const v = $("fullDlg").returnValue; if (v === "ok") setStatus(r, "accepted"); if (v === "wait") setStatus(r, "waitlist"); };
  $("fullDlg").showModal();
}

function toast(text, undo) {
  document.querySelector(".toast")?.remove();
  const el = Object.assign(document.createElement("div"), { className: "toast", role: "status" });
  el.innerHTML = `<span>${text}</span><button>Deshacer</button>`;
  el.querySelector("button").onclick = () => { undo(); el.remove(); };
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

document.addEventListener("click", (e) => {
  const t = e.target;
  const row = t.closest(".crow");
  if (row) { S.sel = +row.dataset.id; return render(); }
  if (t.closest("#arch")) { S.archive = !S.archive; return renderList(); }
  if (t.closest("#formBtn")) { S.menu = !S.menu; return renderList(); }
  if (S.menu && !t.closest(".menu")) { S.menu = false; renderList(); }
  const seg = t.closest("[data-open]");
  if (seg) { S.open = seg.dataset.open === "1"; return renderTop(); }
  if (t.closest("#new")) {
    const sel = $("newDlg").querySelector("[name=type]");
    sel.length === 1 && TYPES.forEach(([id, n]) => sel.add(new Option(n, id)));
    $("newDlg").querySelector("form").reset();
    return $("newDlg").showModal();
  }
  const act = t.closest("[data-act]")?.dataset.act, r = reqs.find((x) => x.id === S.sel);
  if (!act) return;
  if (act === "accept") return accept(r);
  if (act === "remove") {
    const i = reqs.indexOf(r); reqs.splice(i, 1); S.sel = reqs[0]?.id; render();
    return toast("Quitada de la lista.", () => { reqs.splice(i, 0, r); S.sel = r.id; render(); });
  }
  setStatus(r, act);
});
document.addEventListener("change", (e) => {
  if (e.target.id === "setType" && e.target.value) { reqs.find((x) => x.id === S.sel).type = +e.target.value; render(); }
  if (e.target.id === "total") { S.total = Math.max(1, Math.round(+e.target.value) || 1); render(); }
  if (e.target.id === "import" && e.target.files[0]) { toast("2 respuestas nuevas importadas.", () => {}); e.target.value = ""; }
});
$("newDlg").addEventListener("close", () => {
  if ($("newDlg").returnValue !== "ok") return;
  const f = Object.fromEntries(new FormData($("newDlg").querySelector("form")));
  const id = Math.max(...reqs.map((r) => r.id)) + 1;
  reqs.unshift({ id, name: f.name, platform: f.platform, contact: f.contact, date: "hoy", type: +f.type, chars: Math.max(1, +f.chars || 1), email: "", tag: null, status: "new", details: f.details || "Sin detalles." });
  S.sel = id; render();
});

render();
</script>
</body>
</html>
````

### `maquetas-ui/terminadas.html`

````html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZeeBoard · Terminadas (maqueta)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
<style>
.top input[type="date"] { width: 128px; padding: 5px 6px; }
@media (max-width: 1200px) { .top .search { flex-basis: 170px; min-width: 150px; } .top .to { display: none; } }
.top .to { color: var(--faint); font-size: 12px; }

/* Apple Photos: galería por grupos con cabecera fija */
.gallery { overflow: auto; padding: 0 22px 28px; min-height: 0; }
.rates { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 14px 0 4px; font-size: 12.5px; color: var(--muted); }
.rates b { color: var(--ink); }
.rates .total { color: var(--ink); margin-right: 8px; }
.ghead { position: sticky; top: 0; z-index: 1; display: flex; align-items: baseline; gap: 10px; padding: 18px 0 10px; background: linear-gradient(var(--glass-heavy) 70%, transparent); }
.ghead h2 { margin: 0; font: 600 22px/1.1 "Fraunces", serif; letter-spacing: -.01em; }
.ghead span { color: var(--faint); font-size: 12.5px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 18px 14px; }
.work-tile { min-width: 0; }
.work-tile .img { display: block; width: 100%; aspect-ratio: 1; border-radius: 4px; overflow: hidden; box-shadow: 0 0 0 1px var(--line), 0 14px 30px -22px var(--shadow-l); cursor: zoom-in; transition: transform 100ms ease-out; }
.work-tile .img:active { transform: scale(.98); }
.work-tile .img svg { width: 100%; height: 100%; display: block; }
.work-tile .cap { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 8px; width: 100%; margin-top: 8px; text-align: left; }
.work-tile .cap strong { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.work-tile .cap b { font-weight: 600; white-space: nowrap; }
.work-tile .cap small { grid-column: 1 / -1; color: var(--faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.work-tile .cap:hover strong { text-decoration: underline; text-underline-offset: 3px; }
.empty { display: grid; place-content: center; gap: 6px; height: 100%; text-align: center; color: var(--muted); }
.empty b { font: 600 20px "Fraunces", serif; color: var(--ink); }

/* Visor: la imagen sola; el fondo toma sus colores mientras está abierta */
dialog.viewer { width: auto; max-width: 92vw; padding: 0; border: 0; background: none; box-shadow: none; }
dialog.viewer::backdrop { background: rgba(8, 9, 12, .82); backdrop-filter: blur(6px); }
dialog.viewer .art { width: min(80vh, 88vw); aspect-ratio: 1; border-radius: 6px; overflow: hidden; }
dialog.viewer .art svg { width: 100%; height: 100%; display: block; }
dialog.viewer p { margin: 10px 2px 0; display: flex; justify-content: space-between; gap: 12px; color: #ece6dc; }
dialog.viewer p a { color: #ece6dc; }
</style>
</head>
<body data-page="terminadas">
<div class="ambient" aria-hidden="true"></div>
<div class="app">
  <aside class="side glass" id="side" data-note="Cambia entre «Por mes» y «Por cliente», busca, filtra por fechas y pulsa una imagen para verla en grande."></aside>
  <main class="main">
    <header class="top glass">
      <h1>Terminadas</h1>
      <div class="seg" role="group" aria-label="Agrupar"><button data-g="month" aria-pressed="true">Por mes</button><button data-g="client" aria-pressed="false">Por cliente</button></div>
      <label class="search"><svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" placeholder="Buscar título o cliente" aria-label="Buscar"></label>
      <input class="field" type="date" id="from" aria-label="Desde"><span class="to">a</span><input class="field" type="date" id="to" aria-label="Hasta">
      <button class="btn" id="clear" hidden>Borrar filtros</button>
    </header>
    <section class="gallery glass" id="gallery"></section>
  </main>
</div>
<dialog class="viewer" id="viewer"><div class="art" id="vArt"></div><p><span id="vCap"></span><a href="comisiones.html">Abrir comisión</a></p></dialog>

<script src="shell.js"></script>
<script src="ambient.js"></script>
<script src="art.js"></script>
<script>
const P = [
  { fur: "#e07a3c", muzzle: "#fff4e8", bg: "#a7d0e6" }, { fur: "#5b7f8f", muzzle: "#f3efe6", bg: "#f3dca0" },
  { fur: "#cfc6e8", muzzle: "#faf6ff", bg: "#2f3a5c" }, { fur: "#8a6248", muzzle: "#f3e6d8", bg: "#cfe3c4" },
  { fur: "#c4573a", muzzle: "#fde9dc", bg: "#f6e3b0" }, { fur: "#8f9aa8", muzzle: "#f3efe6", bg: "#f2c7a0" },
];
// [título, cliente, entrega (AAAA-MM-DD), precio, horas, plantilla, paleta]
const done = [
  ["Flat Colour", "Mochi", "2026-09-30", 110, 4, "Flat Colour", 0], ["Reference Sheet", "Ember", "2026-09-02", 150, 6.5, "Reference Sheet", 4],
  ["Full Colour", "Kuro", "2026-08-20", 160, 6, "Full Colour", 1], ["Full Colour", "Mochi", "2026-08-01", 160, 5.5, "Full Colour", 0],
  ["Sketch", "Nova", "2026-07-20", 40, 1.5, "Sketch", 0], ["Full Colour", "Ember", "2026-07-14", 160, 7, "Full Colour", 4],
  ["Full Colour", "Mochi", "2026-06-15", 160, 6, "Full Colour", 0], ["Sketch", "Juniper", "2026-06-03", 40, null, "Sketch", 2],
  ["Full Colour", "Pip", "2026-05-03", 160, 5, "Full Colour", 3], ["Flat Colour", "Kuro", "2026-05-02", 110, 4, "Flat Colour", 1],
  ["Icon", "Luna", "2026-04-09", 45, 1.5, "Icon", 2], ["Icon", "Pip", "2026-04-20", 45, null, "Icon", 3],
].map(([title, client, day, price, hours, tpl, pal], id) => ({ id, title, client, day, price, hours, tpl, pal: P[pal] }));

const S = { group: "month" };
const $ = (id) => document.getElementById(id);
const eur = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const longDate = (d) => new Date(d + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" });
const monthOf = (d) => new Date(d + "T12:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" });
const rate = (list) => { const h = list.filter((c) => c.hours); const hours = h.reduce((s, c) => s + c.hours, 0); return hours ? h.reduce((s, c) => s + c.price, 0) / hours : null; };

function render() {
  const q = $("q").value.trim().toLowerCase(), from = $("from").value, to = $("to").value;
  const list = done.filter((c) => (c.title + " " + c.client).toLowerCase().includes(q) && (!from || c.day >= from) && (!to || c.day <= to))
    .sort((a, b) => b.day.localeCompare(a.day));
  $("clear").hidden = !(q || from || to);
  const total = list.reduce((s, c) => s + c.price, 0), r = rate(list);

  if (!list.length) return ($("gallery").innerHTML = done.length
    ? `<div class="empty"><b>Nada coincide</b>Prueba con otra búsqueda u otras fechas.</div>`
    : `<div class="empty"><b>Aún no hay nada terminado</b>Las comisiones llegan aquí al marcarlas como terminadas.</div>`);

  const groups = Map.groupBy(list, (c) => (S.group === "month" ? monthOf(c.day) : c.client));
  const keys = [...groups.keys()];
  if (S.group === "client") keys.sort((a, b) => a.localeCompare(b));
  const tpls = Map.groupBy(list, (c) => c.tpl);

  $("gallery").innerHTML = `<p class="rates num"><span class="total"><b>${list.length}</b> terminadas · <b>${eur(total)}</b>${r ? ` · ${eur(r)}/h` : ""}</span><span>Por hora:</span>${[...tpls].map(([t, l]) => rate(l) && `<span>${t} <b class="num">${eur(rate(l))}</b></span>`).filter(Boolean).join("")}</p>` +
    keys.map((k) => {
      const g = groups.get(k);
      return `<section><div class="ghead"><h2>${k[0].toUpperCase() + k.slice(1)}</h2><span class="num">${g.length} · ${eur(g.reduce((s, c) => s + c.price, 0))}</span></div>
        <div class="grid">${g.map((c) => `<div class="work-tile">
          <button class="img" data-view="${c.id}" aria-label="Ver ${c.title} en grande">${head(c.pal)}</button>
          <a class="cap" href="comisiones.html" style="color:inherit;text-decoration:none" title="Abrir comisión">
            <strong>${c.title}</strong><b class="num">${eur(c.price)}</b>
            <small class="num">${S.group === "month" ? c.client : longDate(c.day)} · ${c.hours ? `${String(c.hours).replace(".", ",")} h · ${eur(c.price / c.hours)}/h` : "sin horas"}</small></a></div>`).join("")}</div></section>`;
    }).join("");
}

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-g]");
  if (g) { S.group = g.dataset.g; document.querySelectorAll("[data-g]").forEach((b) => b.setAttribute("aria-pressed", b === g)); return render(); }
  if (e.target.closest("#clear")) { $("q").value = $("from").value = $("to").value = ""; return render(); }
  const v = e.target.closest("[data-view]");
  if (v) {
    const c = done[+v.dataset.view], svg = head(c.pal);
    $("vArt").innerHTML = svg;
    $("vCap").textContent = `${c.title} · ${c.client} · ${longDate(c.day)}`;
    setAmbientFromSvg(svg);
    return $("viewer").showModal();
  }
  if (e.target === $("viewer")) $("viewer").close(); // clic fuera de la imagen
});
$("viewer").addEventListener("close", () => setAmbientFromSvg(null));
["q", "from", "to"].forEach((id) => $(id).addEventListener("input", render));
render();
</script>
</body>
</html>
````

### `maquetas-ui/ventanas.html`

````html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZeeBoard · Ventanas (maqueta)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
<style>
.launch { overflow: auto; padding: 24px; }
.launch h2 { margin: 0 0 4px; font: 600 26px "Fraunces", serif; }
.launch > p { margin: 0 0 18px; color: var(--muted); }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; max-width: 980px; }
.tiles button { text-align: left; padding: 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.tiles button:hover { border-color: var(--line-strong); }
.tiles strong { display: block; font-weight: 600; }
.tiles small { color: var(--muted); }

dialog.wide { width: min(920px, 94vw); padding: 0; }
dialog.mid { width: min(640px, 94vw); }
.dlg-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); max-height: min(86vh, 760px); }
.dlg-main { padding: 22px; overflow: auto; }
.dlg-side { padding: 22px; overflow: auto; border-left: 1px solid var(--line); background: var(--paper); }
.dlg-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px; border-top: 1px solid var(--line); }
.f { display: grid; gap: 4px; font-size: 12.5px; color: var(--muted); }
.f .hint { color: var(--faint); font-size: 12px; }
.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; align-items: start; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip-t { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border: 1px solid var(--line-strong); border-radius: 3px; font-size: 12.5px; color: var(--muted); }
.chip-t[aria-pressed="true"] { border-color: var(--ink); color: var(--ink); background: var(--highlight); }
.chip-t i { width: 7px; height: 7px; border-radius: 50%; }
.sum dt { color: var(--faint); font-size: 12px; margin-top: 12px; }
.sum dd { margin: 2px 0 0; }
.steps { margin: 6px 0 0; padding-left: 20px; color: var(--muted); }
.calc { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; font-size: 13px; }
.calc .tot { border-top: 1px solid var(--line-strong); padding-top: 6px; font-weight: 700; }

/* Pagos (Stripe) */
.pay-head { display: flex; align-items: baseline; gap: 10px; }
.pay-head .big { font-size: 26px; }
.bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; margin: 10px 0 6px; display: flex; }
.bar i { display: block; background: var(--ok); }
table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 14px; }
th { text-align: right; color: var(--faint); font-weight: 500; padding: 0 0 6px 10px; white-space: nowrap; }
td { text-align: right; padding: 8px 0 8px 10px; border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; padding-left: 0; }
td:first-child { white-space: normal; }
td .pending { color: var(--warn); font-weight: 600; }
.add-pay { display: grid; grid-template-columns: 130px minmax(0, 1fr) 110px 120px; gap: 8px; align-items: end; margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--line-strong); }
.add-pay .rcv { font-size: 12px; color: var(--faint); grid-column: 1 / -1; }

/* Importar PayPal */
.pp-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid var(--line); }
.pp-row small { display: block; color: var(--faint); font-size: 12px; }
.pp-row .why { font-size: 12px; }

/* Terminar */
.drop { display: grid; place-content: center; justify-items: center; gap: 6px; min-height: 150px; border: 1px dashed var(--line-strong); border-radius: 6px; color: var(--muted); text-align: center; cursor: pointer; }
.drop:hover { background: var(--highlight); }

/* Atajos */
.keys { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px 16px; margin-top: 14px; align-items: center; }
.keys kbd { margin: 0; justify-self: start; font-size: 12px; padding: 2px 7px; color: var(--ink); }

/* Paleta de comandos (Linear / Raycast) */
dialog.palette { width: min(620px, 94vw); padding: 0; margin-top: 12vh; }
.palette input { width: 100%; padding: 16px 18px; border: 0; border-bottom: 1px solid var(--line); background: none; color: var(--ink); font: inherit; font-size: 16px; outline: none; }
.results { max-height: 50vh; overflow: auto; padding: 6px; }
.results h4 { margin: 8px 10px 4px; font-size: 12px; font-weight: 600; color: var(--faint); }
.res { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 4px; text-align: left; }
.res[aria-selected="true"] { background: var(--highlight); }
.res small { margin-left: auto; color: var(--faint); font-size: 12px; }
.pal-foot { display: flex; gap: 16px; padding: 8px 14px; border-top: 1px solid var(--line); font-size: 12px; color: var(--faint); }

@media (max-width: 760px) {
  .dlg-grid { grid-template-columns: minmax(0, 1fr); }
  .dlg-side { border-left: 0; border-top: 1px solid var(--line); }
  .add-pay { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
</style>
</head>
<body data-page="ventanas">
<div class="ambient" aria-hidden="true"></div>
<div class="app">
  <aside class="side glass" id="side" data-note="Cada botón abre una ventana. Esc o Cancelar la cierran. La paleta también se abre con Ctrl K."></aside>
  <main class="main">
    <header class="top glass"><h1>Ventanas</h1></header>
    <section class="launch glass"><h2>Ventanas sueltas</h2><p>Los diálogos que se abren desde las pantallas, con el mismo estilo: fondo sólido, título en Fraunces, acciones abajo a la derecha.</p>
      <div class="tiles">
        <button data-open="dNew"><strong>Nueva comisión</strong><small>Desde Comisiones o Ctrl N</small></button>
        <button data-open="dPay"><strong>Pagos</strong><small>«Ver cobros» en el detalle</small></button>
        <button data-open="dPP"><strong>Importar de PayPal</strong><small>Desde Ajustes › Datos</small></button>
        <button data-open="dFin"><strong>Marcar como terminada</strong><small>Pie del detalle</small></button>
        <button data-open="dKeys"><strong>Atajos de teclado</strong><small>Tecla ?</small></button>
        <button data-open="dPal"><strong>Paleta de comandos</strong><small>Ctrl K</small></button>
      </div></section>
  </main>
</div>

<!-- Nueva comisión: formulario a la izquierda, resumen calculado a la derecha -->
<dialog class="wide" id="dNew"><form method="dialog">
  <div class="dlg-grid">
    <div class="dlg-main"><h3>Nueva comisión</h3>
      <div class="fields">
        <input class="field" id="nTitle" placeholder="Título de la comisión" required>
        <label class="f">Cliente<input class="field" list="clients" id="nClient" placeholder="Busca o escribe un nombre"><datalist id="clients"><option>Mochi</option><option>Kuro</option><option>Nova</option><option>Luna</option></datalist></label>
        <div class="two">
          <label class="f">Tipo<select class="field" id="nType"><option value="160">Full Colour</option><option value="110">Flat Colour</option><option value="150">Reference Sheet</option><option value="350">Rendered Full Body</option><option value="40">Sketch</option></select><span class="hint">No se puede cambiar después de crearla (las etapas e imágenes dependen de él).</span></label>
          <label class="f">Personajes<input class="field num" type="number" min="1" value="1" id="nChars"><span class="hint">El precio depende de este número.</span></label>
        </div>
        <div class="two">
          <label class="f">Fecha límite · opcional<input class="field" type="date" id="nDue"></label>
          <label class="f">Precio<input class="field num" type="number" min="0" id="nPrice"><span class="hint">Calculado con el tipo y los personajes; puedes cambiarlo.</span></label>
        </div>
        <div class="f">Etiquetas<div class="chips"><button type="button" class="chip-t" aria-pressed="false"><i style="background:#dc2626"></i>Rush</button><button type="button" class="chip-t" aria-pressed="false"><i style="background:#0891b2"></i>Commercial use</button></div></div>
        <label class="f">Notas<textarea class="field" rows="3" placeholder="Fondo, pose, detalles que recordar…"></textarea></label>
      </div></div>
    <div class="dlg-side"><p class="section-title" style="margin:0">Resumen</p><dl class="sum" id="nSum"></dl></div>
  </div>
  <div class="dlg-foot"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="primary" value="ok">Crear comisión</button></div>
</form></dialog>

<!-- Pagos -->
<dialog class="mid" id="dPay"><form method="dialog">
  <h3>Pagos</h3><p>Rendered Full Body + Complex Background · Nova</p>
  <div style="margin-top:14px"><div class="pay-head money"><span class="big">275<small>,00 €</small></span><span style="color:var(--faint)">de 350,00 €</span><span style="margin-left:auto;color:var(--warn);font-weight:600">Faltan 75,00 €</span></div>
    <div class="bar"><i style="width:78.6%"></i></div></div>
  <table><thead><tr><th>Fecha y nota</th><th>Pagó el cliente</th><th>Recibiste</th><th>Comisión</th><th></th></tr></thead>
    <tbody><tr><td>12 sep · PayPal, señal</td><td>150,00 €</td><td>144,55 €</td><td>5,45 €</td><td><button class="icon-btn" style="width:26px;height:26px" aria-label="Quitar pago">✕</button></td></tr>
      <tr><td>2 oct · PayPal</td><td>125,00 €</td><td><span class="pending">Sin apuntar</span></td><td>—</td><td><button class="icon-btn" style="width:26px;height:26px" aria-label="Quitar pago">✕</button></td></tr></tbody></table>
  <div class="add-pay">
    <label class="f">Fecha<input class="field" type="date" value="2026-10-12"></label>
    <label class="f">Nota<input class="field" placeholder="PayPal, señal…"></label>
    <label class="f">Pagó el cliente<input class="field num" type="number" step="0.01" id="pAmt" placeholder="0,00"></label>
    <label class="f">Plataforma<select class="field" id="pPlat"><option value="3.4,0.35">PayPal</option><option value="0,0">Ko-fi</option><option value="1.5,0.25">Stripe</option></select></label>
    <span class="rcv num" id="pRcv">Recibirás lo que quede tras la comisión de la plataforma.</span>
  </div>
  <div class="actions"><button class="btn" value="cancel">Cerrar</button><button class="primary" value="ok" type="button" id="pAdd">Añadir pago</button></div>
</form></dialog>

<!-- Importar PayPal -->
<dialog class="mid" id="dPP"><form method="dialog">
  <h3>Importar de PayPal</h3><p class="num">3 de 6 pagos listos para importar.</p>
  <div style="margin-top:12px">
    <label class="pp-row"><input type="checkbox" checked><span><strong>Nova · 75,00 €</strong><small>nova@example.com · 10 oct → Rendered Full Body</small></span><span class="why num">Recibes 72,10 €</span></label>
    <label class="pp-row"><input type="checkbox" checked><span><strong>Tilly · 120,00 €</strong><small>tilly@example.com · 8 oct → Full Colour</small></span><span class="why num">Recibes 115,57 €</span></label>
    <label class="pp-row"><input type="checkbox" checked><span><strong>Luna · 80,00 €</strong><small>luna@example.com · 1 oct → Full Colour</small></span><span class="why num">Recibes 76,93 €</span></label>
    <label class="pp-row"><input type="checkbox" disabled><span><strong>Kuro · 150,00 €</strong><small>kuro@example.com · 28 sep</small></span><span class="why" style="color:var(--faint)">Ya importado</span></label>
    <label class="pp-row"><input type="checkbox" disabled><span><strong>desconocido@mail.com · 40,00 €</strong><small>25 sep</small></span><span class="why" style="color:var(--warn)">Ningún cliente con este correo</span></label>
    <label class="pp-row"><input type="checkbox" disabled><span><strong>Mochi · 110,00 €</strong><small>mochi@example.com · 20 sep</small></span><span class="why" style="color:var(--faint)">No le queda nada por pagar</span></label>
  </div>
  <div class="actions"><button class="btn" value="cancel">Cancelar</button><button class="primary" value="ok">Importar 3</button></div>
</form></dialog>

<!-- Marcar como terminada -->
<dialog class="mid" id="dFin"><form method="dialog">
  <h3>Marcar como terminada</h3><p>Rendered Full Body + Complex Background · Nova</p>
  <div class="fields">
    <label class="drop"><input type="file" accept="image/*" multiple hidden id="fImg"><b style="color:var(--ink)">Añadir imagen final</b><span id="fTxt">Arrastra aquí o pulsa para elegir · también Ctrl+V</span></label>
    <div class="two">
      <label class="f">Fecha de entrega<input class="field" type="date" value="2026-10-12"></label>
      <label class="f">Horas dedicadas<input class="field num" inputmode="decimal" placeholder="7,5" pattern="[0-9]+([,.][0-9]+)?" title="Escribe las horas como número, por ejemplo 7,5"></label>
    </div>
    <label class="f">Notas finales<textarea class="field" rows="3" placeholder="Enlace a la publicación, cómo fue…"></textarea></label>
  </div>
  <div class="actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="primary" value="ok">Marcar como terminada</button></div>
</form></dialog>

<!-- Atajos -->
<dialog id="dKeys" style="width:min(440px,94vw)"><form method="dialog">
  <h3>Atajos de teclado</h3>
  <div class="keys">
    <kbd>Ctrl K</kbd><span>Buscar y acciones</span><kbd>Ctrl 1 … 9</kbd><span>Ir a una pantalla (orden del menú)</span>
    <kbd>Ctrl N</kbd><span>Nueva comisión</span><kbd>Ctrl Z</kbd><span>Recuperar lo que acabas de borrar</span>
    <kbd>Ctrl Mayús P</kbd><span>Activar o quitar el modo privado</span><kbd>Ctrl V</kbd><span>Pegar una imagen en la etapa abierta</span>
    <kbd>?</kbd><span>Ver esta lista</span><kbd>Esc</kbd><span>Cerrar</span>
  </div>
  <div class="actions"><button class="btn" value="cancel">Cerrar</button></div>
</form></dialog>

<!-- Paleta de comandos -->
<dialog class="palette" id="dPal">
  <input id="pq" placeholder="Busca comisiones, clientes, pantallas y acciones…" aria-label="Buscar" autocomplete="off">
  <div class="results" id="pres" role="listbox"></div>
  <div class="pal-foot"><span>↑ ↓ para moverte</span><span>Enter para abrir</span><span>Esc para cerrar</span></div>
</dialog>

<script src="shell.js"></script>
<script>
const $ = (id) => document.getElementById(id);
const eur = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const RATE = 0.5;

/* Nueva comisión: el resumen se calcula igual que en la app (precio base × (1 + 50 % × personajes extra)) */
function sumNew() {
  const sel = $("nType"), base = +sel.value, chars = Math.max(1, +$("nChars").value || 1), calc = base * (1 + RATE * (chars - 1));
  if (!$("nPrice").dataset.touched) $("nPrice").value = calc;
  const stages = { "Full Colour": "Boceto,Lineart,Color plano,Sombreado,Final", "Flat Colour": "Boceto,Lineart,Color plano,Final", "Reference Sheet": "Boceto,Lineart,Color plano,Detalles,Final", "Rendered Full Body": "Boceto,Lineart,Color plano,Sombreado,Fondo,Final", Sketch: "Boceto,Final" }[sel.selectedOptions[0].text].split(",");
  $("nSum").innerHTML = `<dt>Tipo</dt><dd><b>${sel.selectedOptions[0].text}</b></dd>
    <dt>Etapas</dt><dd><ol class="steps">${stages.map((s) => `<li>${s}</li>`).join("")}</ol></dd>
    <dt>Precio</dt><dd><div class="calc num"><span>Precio base</span><span>${eur(base)}</span>${chars > 1 ? `<span>${chars - 1} ${chars === 2 ? "personaje extra" : "personajes extra"} (+${RATE * 100} %)</span><span>${eur(calc - base)}</span>` : ""}<span class="tot">Total</span><span class="tot">${eur(+$("nPrice").value || 0)}</span></div></dd>
    <dt>Entrega</dt><dd>${$("nDue").value ? new Date($("nDue").value + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : "Sin fecha límite"}</dd>`;
}
["nType", "nChars", "nDue"].forEach((id) => $(id).addEventListener("input", sumNew));
$("nPrice").addEventListener("input", (e) => { e.target.dataset.touched = 1; sumNew(); });

/* Pagos: lo recibido se rellena con la comisión de la plataforma */
const rcv = () => { const a = +$("pAmt").value, [p, f] = $("pPlat").value.split(",").map(Number); $("pRcv").textContent = a ? `Recibirás ${eur(Math.max(0, a - a * p / 100 - f))} (comisión ${eur(a * p / 100 + f)}).` : "Recibirás lo que quede tras la comisión de la plataforma."; };
["pAmt", "pPlat"].forEach((id) => $(id).addEventListener("input", rcv));

$("fImg").addEventListener("change", (e) => { $("fTxt").textContent = e.target.files.length ? `${e.target.files.length} ${e.target.files.length === 1 ? "imagen elegida" : "imágenes elegidas"} · añadir más` : "Arrastra aquí o pulsa para elegir · también Ctrl+V"; });

/* Paleta: filtra y se maneja con el teclado */
const ITEMS = [["Pantallas", "Resumen", "resumen.html"], ["Pantallas", "Comisiones", "comisiones.html"], ["Pantallas", "Clientes", "clientes.html"], ["Pantallas", "Catálogo", "catalogo.html"],
  ["Comisiones", "Rendered Full Body · Nova", "comisiones.html", "En curso"], ["Comisiones", "Reference Sheet · Kuro", "comisiones.html", "Vence hoy"], ["Comisiones", "Flat Colour · Basil", "comisiones.html", "En cola"],
  ["Clientes", "Mochi", "clientes.html"], ["Clientes", "Kuro", "clientes.html"],
  ["Acciones", "Nueva comisión", "#dNew", "Ctrl N"], ["Acciones", "Hacer copia de seguridad", "ajustes.html"], ["Acciones", "Atajos de teclado", "#dKeys", "?"]];
let pIdx = 0, pList = [];
function renderPal() {
  const q = $("pq").value.trim().toLowerCase();
  pList = ITEMS.filter((i) => i[1].toLowerCase().includes(q));
  pIdx = Math.min(pIdx, Math.max(pList.length - 1, 0));
  const groups = [...new Set(pList.map((i) => i[0]))];
  $("pres").innerHTML = pList.length ? groups.map((g) => `<h4>${g}</h4>` + pList.map((it, i) => it[0] !== g ? "" : `<button class="res" role="option" data-i="${i}" aria-selected="${i === pIdx}">${it[1]}${it[3] ? `<small>${it[3]}</small>` : ""}</button>`).join("")).join("")
    : `<p style="padding:14px;margin:0;color:var(--faint)">Sin resultados</p>`;
}
function go(it) { if (!it) return; $("dPal").close(); it[2].startsWith("#") ? open(it[2].slice(1)) : (location.href = it[2]); }
$("pq").addEventListener("input", () => { pIdx = 0; renderPal(); });
$("pq").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); pIdx = (pIdx + (e.key === "ArrowDown" ? 1 : -1) + pList.length) % pList.length; renderPal(); document.querySelector(".res[aria-selected=true]")?.scrollIntoView({ block: "nearest" }); }
  if (e.key === "Enter") go(pList[pIdx]);
});
$("pres").addEventListener("click", (e) => { const b = e.target.closest(".res"); if (b) go(pList[+b.dataset.i]); });

function open(id) {
  if (id === "dNew") { $("dNew").querySelector("form").reset(); delete $("nPrice").dataset.touched; sumNew(); }
  if (id === "dPal") { $("pq").value = ""; pIdx = 0; renderPal(); }
  $(id).showModal();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open]"); if (b) return open(b.dataset.open);
  const c = e.target.closest(".chip-t"); if (c) c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true");
  // Clic fuera de la ventana (en el fondo oscuro) la cierra
  if (e.target.tagName === "DIALOG") { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); }
});
document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open("dPal"); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); open("dNew"); }
  if (e.key === "?") open("dKeys");
});
</script>
</body>
</html>
````
