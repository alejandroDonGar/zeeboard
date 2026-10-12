# Hoja de ruta de ZeeBoard

Objetivo: una app **bonita, elegante y sencilla, pero completamente funcional** para gestionar comisiones de arte.

Cada fase termina con una **revisión**: ejecutar la app (`npm run tauri dev`), probarla y decidir qué cambiar antes de seguir.

---

## Fase 0 · Estabilizar y ordenar el repositorio
- [x] Registrar cada plugin de Tauri una sola vez
- [x] Que `npm run build` compile sin errores
- [x] Guardar la refactorización de `App.tsx` en commits
- [x] README y hoja de ruta
- [x] Fusionar las ramas en `main` y usar `main` como rama principal

## Fase 1 · Imágenes ligeras
Los lienzos originales pesan 40–70 MB; la app solo necesita copias ligeras (los originales se guardan aparte).
- [x] Procesado en Rust, en segundo plano: copia para ver (~2560 px, WebP) y miniatura (~480 px)
- [x] Nombres de archivo por contenido (sin duplicados)
- [x] Añadir imágenes con el selector, arrastrando y soltando, o pegando con Ctrl+V
- [x] Un único sistema para imágenes de etapas, referencias de comisión y de personaje
- [x] Migración automática de las imágenes antiguas y compactar la base de datos
- [x] Miniaturas en tarjetas y listas, carga diferida (`loading="lazy"`)
- [x] En Ajustes: espacio usado y limpieza de huérfanas

## Fase 2 · Sistema de diseño
- [x] Colores y radios como variables de Tailwind (`@theme`); esquinas rectas, sin barras de scroll
- [ ] Tipografía y sombras
- [x] Modo claro y oscuro
- [ ] Componentes base: botón, tarjeta, modal, campos de formulario, etiqueta, estado vacío
- [ ] Iconos (lucide-react) y barra lateral rediseñada
- [ ] Animaciones discretas

## Fase 3 · Pantalla por pantalla
Dividir cada pantalla en componentes y aplicar el nuevo diseño.
- [x] Comisiones (tablero)
- [x] Detalle de comisión y galería
- [x] Clientes y personajes (incluye poder borrar personajes)
- [x] Plantillas
- [x] Etiquetas
- [x] Terminadas
- [x] Dashboard
- [x] Ajustes
- [ ] Dividir `database.ts` por entidades

## Fase 4 · Pulido y calidad
- [x] Restaurar copias de seguridad
- [x] Atajos de teclado y buscador global
- [ ] Rendimiento con muchas comisiones
- [x] Icono, nombre e instalador
- [x] README con capturas

## Fase 5 · ZeeBoard en el iPad (por Tailscale o wifi, sin nube)
- [x] Servidor local en la app + código QR para abrirla desde el iPad (interruptor en Ajustes, enlace con clave; con Tailscale funciona también con datos del móvil)
- [x] Enviar imágenes de progreso desde el iPad a una comisión (como alternativa nueva o como nueva versión de una alternativa)
- [ ] Vista del tablero adaptada al iPad

## Fase 6 · Rediseño de cristal
- [x] Material de cristal casi opaco, esquinas rectas y paneles flotantes en todas las pantallas
- [x] Fondo que toma los colores de la imagen en pantalla (etapas, modo foco) y se desplaza distinto en cada pantalla
- [x] Chips de estado y etiquetas con punto de color, y colores de estado como tokens (claro y oscuro)
- [x] Accesibilidad básica: foco visible, diálogos con Esc, movimiento y transparencia reducidos, contraste
- [x] Capturas, README y página del proyecto rehechos con el nuevo aspecto (datos de ejemplo)
- [ ] Vídeo de presentación con el nuevo aspecto
- [x] Página del iPad con el mismo aspecto que la app
- [x] Esc en los formularios y diálogos, foco atrapado dentro de ellos y devuelto al cerrar

---

## Ideas para ir incorporando

**Prioritarias**
- [x] Papelera con deshacer (Ctrl+Z): comisiones, clientes, personajes, plantillas, etiquetas, solicitudes, pagos y correcciones; pantalla en Ajustes y purga a los 30 días
- [x] Horas por comisión (se apuntan al marcarla como terminada) y precio real por hora
- [x] Modo privado para directos (ocultar clientes y precios)
- [x] Anotaciones de correcciones sobre las imágenes: chinchetas en cada versión, subir versión retocada, marcar como hechas, fantasmas de versiones anteriores y copiar las pendientes

**Negocio**
- [x] Precios por plantilla con extras (precio base + 50 % por personaje extra)
- [x] Pagos parciales e ingreso neto (comisiones de PayPal, Ko-fi…)
- [x] Email del cliente e importación del CSV de PayPal (cruza cobros por email, sin duplicar)
- [x] Botón "Copy description": texto corto para la factura de PayPal (plantilla, personajes y tu usuario)
- [x] Recordatorio de pago: comisión fuera de la primera etapa y sin ningún pago (Dashboard + notificación)
- [x] Etiquetas automáticas al aceptar una solicitud (tipo y número de personajes)
- [x] Etiquetas automáticas también en el formulario de nueva comisión
- [x] Aviso en Ajustes del último cobro de PayPal importado y desde qué fecha descargar
- [x] Idioma ES/EN en todas las pantallas (diccionario en src/lib/es.ts, comprobación con scripts/check-i18n.ts)
- [x] Comentarios del código en inglés y concisos
- [x] Iconos en el menú lateral y tipografía (Fraunces en títulos, Manrope en el resto)
- [x] Logo propio (Z de rayas): menú lateral, pantalla de carga, iconos de la app y pestaña
- [x] Buscador global (Ctrl+K) con acciones, atajos de teclado (Ctrl+1…8, Ctrl+N, ?) y leyenda en el menú
- [x] Icono de Windows: solo la Z, sin fondo y a todo el tamaño
- [x] Instalador de Windows (NSIS): nombre ZeeBoard, versión 0.2.0, README renovado y política de seguridad con el canal IPC
- [x] Contador de revisiones incluidas (correcciones por etapa)
- [ ] Origen del cliente (X, Instagram, Discord…)
- [ ] Gastos y beneficio real
- [ ] Varias monedas
- [x] Resumen de ingresos por trimestre (CSV)
- [x] Estadísticas: ingresos por mes y por tipo, clientes, tarifas, días hasta la entrega y embudo de solicitudes

**Flujo de trabajo**
- [x] Recordatorios de fechas de entrega (también aviso de comisiones paradas)
- [x] Lista de espera y plazas abiertas (con importación del formulario de Google)
- [x] Foto de perfil de los clientes: Bluesky → Telegram → a mano (arrastrar, pegar o clic), guardada en disco
- [ ] Mensajes predefinidos para clientes
- [ ] Marca de agua al exportar WIPs
- [ ] Lista de entregables por comisión
- [ ] Brief o cuestionario de pedido y derechos de uso
- [ ] Planificador de carga semanal
- [ ] Moodboard de referencias (estilo PureRef)
- [ ] Paleta de colores automática desde las referencias
- [ ] Comparador antes/después entre etapas

**Comodidad**
- [x] Paleta de comandos (Ctrl+K)
- [x] Copias de seguridad automáticas
- [x] Exportar los datos a CSV
- [x] App en español e inglés
