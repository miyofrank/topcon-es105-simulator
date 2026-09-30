# Simulador de Estación Total Topcon ES-105

Emulador web de alta precisión física, matemática e interactiva de la **Estación Total Topcon ES-105**, desarrollado en **React 19**, **TypeScript** y **Tailwind CSS v4** con **Vite**.

Diseñado para docencia universitaria y entrenamiento técnico en topografía e ingeniería civil, reproduciendo con exactitud la experiencia de operación a bordo del instrumento real.

---

## 🛠️ Características Principales

### 1. Hardware y Pantalla Fiel a la Realidad
- **Chasis Topcon centrado**: Silueta visual en color amarillo institucional con tornillos de fijación, botón de encendido y diseño ergonómico.
- **Pantalla LCD Monocromática**: Tonalidad clásica `#9CA3AF` retroiluminada, tipografía segmentada/monoespaciada, indicadores de estado de batería y compensador digital activo.
- **Botonera Física Interactiva**:
  - Teclas de función suave `[F1]`, `[F2]`, `[F3]`, `[F4]`.
  - Teclado alfanumérico completo con soporte de dígitos, punto decimal, signos y códigos de punto.
  - Teclas de navegación en cruz (Arriba, Abajo, Izquierda, Derecha) con botón central **[ENTER]** en color azul Topcon.
  - Teclas de sistema: `[ESC]`, `[BS]` (Backspace), `[SFT]` (Shift / Alfanumérico), `[FUNC]` (Páginas de funciones).

### 2. Rutina de Compensador Electrónico Bi-Axial (TILT)
- Proceso de encendido y nivelación con burbuja electrónica digital bi-axial (X/Y).
- Lectura en tiempo real de inclinaciones angulares en segundos de arco (`"`) con umbral de tolerancia para habilitar el uso seguro del instrumento.

### 3. Motor de Cálculo Geodésico Riguroso
- **Cálculo de Azimut de Referencia**:
  $$\text{Az} = \text{atan2}(\Delta E, \Delta N)$$
  Mapeado al rango geodésico topográfico estándar $[0^\circ, 360^\circ)$.
- **Reducción de Distancias Topográficas**:
  $$DH = SD \cdot \sin(V)$$
  $$DV = SD \cdot \cos(V)$$
- **Coordenadas Tridimensionales Absolutas**:
  $$N_P = N_0 + DH \cdot \cos(\text{Az})$$
  $$E_P = E_0 + DH \cdot \sin(\text{Az})$$
  $$Z_P = Z_0 + h_i + DV - h_r$$
  Donde $h_i$ es la altura del instrumento y $h_r$ es la altura del prisma (reflector).

### 4. Sistema Operativo a Bordo
- **Menú DATO (Gestión de Trabajos)**:
  - Creación y selección de Trabajos (`JOB`) activos.
  - Soporte de nombres alfanuméricos de proyecto (ej. `PROYECTO_01`).
  - Exportación directa de la libreta electrónica a formato **CSV estándar de topografía** simulando descarga vía USB.
- **Menú COORD (Coordenadas Topográficas)**:
  - **1. OCUP. ORIEN.**: Configuración de Estación Ocupada (Punto base $N, E, Z$, $h_i$) y Orientación hacia Punto Visado de Referencia ($N, E, Z$ o Azimut directo).
  - **2. OBS. COORD**: Modo de medición y registro de puntos topográficos con cálculo automático de coordenadas y guardado en memoria.
- **Identificadores de Punto Alfanuméricos (PTO)**:
  - Soporte para códigos de vértice y punto de control (ej. `BM-1`, `E-A`, `P-10`).
  - Auto-incremento inteligente del sufijo numérico para agilizar levantamientos continuos en campo.

### 5. Panel de Simulación del Entorno Físico
- Panel lateral minimalista y colapsable con potenciómetros para simular la realidad física del instrumento en campo:
  - **HD**: Ángulo Horizontal (Lectura azimutal).
  - **V**: Ángulo Cenital / Vertical (0° cenit, 90° horizonte).
  - **SD**: Distancia Inclinada al prisma milimétrica.

---

## 🚀 Instalación y Puesta en Marcha

### Prerrequisitos
- [Node.js](https://nodejs.org/) (versión 18 o superior recomendada)
- `npm`, `pnpm` o `yarn`

### Pasos
```bash
# 1. Clonar el repositorio
git clone https://github.com/miyofrank/topcon-es105-simulator.git
cd topcon-es105-simulator

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor de desarrollo
npm run dev
```

La aplicación estará disponible de inmediato en `http://localhost:5173/`.

### Compilación para Producción
```bash
npm run build
```
Genera los archivos estáticos listos para producción en la carpeta `dist/`.

---

## 📁 Estructura del Proyecto

```text
topcon-es105-simulator/
├── public/                 # Archivos estáticos y favicons
├── src/
│   ├── App.tsx             # Componente principal: emulador físico, LCD y lógica de cálculo
│   ├── main.tsx            # Punto de entrada de React
│   └── index.css           # Estilos base con Tailwind CSS v4 y fuentes LCD
├── index.html              # Plantilla HTML base
├── package.json            # Dependencias y scripts
├── tsconfig.json           # Configuración de TypeScript
└── vite.config.ts          # Configuración de Vite + Tailwind
```

---

## 📜 Licencia

Distribuido bajo la licencia MIT. Uso libre para fines académicos, educativos y profesionales.
