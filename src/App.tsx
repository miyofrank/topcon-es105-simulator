import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Lock,
  Sliders,
  Volume2,
  VolumeX,
  Keyboard,
  Star,
  Sun,
  Power,
  CornerDownLeft
} from 'lucide-react';

// =========================================================================
// 1. ARQUITECTURA DE TIPOS Y MODELO DE DATOS TOPOGRÁFICOS
// =========================================================================
interface Station {
  N: number;
  E: number;
  Z: number;
  PTO?: string;
  HI: number;
}

interface Backsight {
  N: number;
  E: number;
  Z: number;
  PTO?: string;
}

interface StationAtm {
  CD: string;
  operador: string;
  clima: string;
  viento: string;
  temp: string;
  pres: string;
  ppm: string;
}

interface Target {
  HR: number;
  CD: string;
  PTO: string; // Tipado string para permitir "BM-1", "E-A", "P-1", etc.
}

export interface TopoPoint {
  PTO: string;
  N: number;
  E: number;
  Z: number;
  CD: string;
  type?: 'station' | 'backsight' | 'radial';
  date?: string;
}

export interface KnownPoint {
  PTO: string;
  N: number;
  E: number;
  Z: number;
  CD?: string;
}

// Modos de medición EDM Topcon (Ciclados con la tecla física [SFT])
type EdmMode = 'prism' | 'sheet' | 'non_prism';

// ESTADOS ESTRICTOS DE LA MÁQUINA LCD TOPCON ES-105:
// 'TILT'           : Compensador Digital de arranque (Nivel Electrónico X/Y). F1=[OK]
// 'ROOT'           : Pantalla Raíz del equipo (ES-105, S/N, Ver, Tra). F1=[OBS], F2=[USB], F3=[DATO], F4=[CNFG]
// 'MED'            : Pantalla Principal de Medición (HD, AZ Rango exced., HA-D, PPm). Pág 1/2/3 con [FUNC]
// 'COMPEN'         : Pantalla AZ-0 Compensador ComPen interactivo (burbuja arrastrable con ratón)
// 'MAIN'           : Pantalla de compatibilidad
// 'COORD_MENU'     : Menú COORD (1. Occ.Orien., 2. Observación)
// 'OCC_ORIEN'      : Estacionamiento (Y0, X0, Z0, HI, Cd, Operador...). F1=[CARG], F3=[E.RXYZ], F4=[REG]
// 'ERXYZ'          : Orientar por Punto Atrás (Yref, Xref, Zref, PTO). F1=[CARG], F4=[OK] -> Comprobación
// 'CHECK_BS'       : Comprobación de Orientación (AZ, HA-D, Acim). F1=[REG], F2=[MED], F3=[NO], F4=[SI]
// 'CHECK_BS_DIST'  : Ref.DisH ver (dDH = Obs H - Calc DH). F1=[REG], F2=[ALT], F4=[OK]
// 'SELECT_KNOWN_PT': Selector de Base/Datos conocidos para [CARG]. F4=[CARG]
// 'OBS'            : Levantamiento (HR, CD, PTO). F3=[AUTO] dispara distanciómetro y auto-incrementa PTO
// 'DATO_MENU'      : Menú DATO accesible con ESC o Pág 2 (1. TRABAJO, 2. DATOS CONOCIDOS)
type ScreenState =
  | 'TILT'
  | 'ROOT'
  | 'MED'
  | 'COMPEN'
  | 'MAIN'
  | 'COORD_MENU'
  | 'OCC_ORIEN'
  | 'OCC_LOAD_LIST'
  | 'OCC_LOAD_SEARCH'
  | 'OCC_ACLER'
  | 'OCC_TRISEC'
  | 'ERXYZ'
  | 'CHECK_BS'
  | 'CHECK_BS_DIST'
  | 'SELECT_KNOWN_PT'
  | 'OBS'
  | 'DATO_MENU'
  | 'JOB_MENU'
  | 'JOB_SELECT'
  | 'JOB_LIST'
  | 'JOB_DETAILS'
  | 'JOB_DELETE_LIST'
  | 'JOB_DELETE_CONFIRM'
  | 'JOB'
  | 'KNOWN_MENU'
  | 'KNOWN_INPUT'
  | 'KNOWN_DEL'
  | 'KNOWN_DEL_CONFIRM'
  | 'KNOWN_VIEW'
  | 'KNOWN_PTS'
  | 'KNOWN_NEW'
  | 'USB_MENU'
  | 'USB_TTYPE'
  | 'USB_SAVE_JOB'
  | 'USB_FORMAT'
  | 'GRAPHIC_MENU'
  | 'REPLANTEO_MENU'
  | 'REPL_DATA'
  | 'TOPO_MENU'
  | 'TOPO_NOTA'
  | 'TOPO_VER'
  | 'EDM_MENU'
  | 'DESPLZ_MENU'
  // --- Pantallas añadidas según corrección de usuario (12-10-2026) ---
  | 'TRISEC_PT'     // Trisecn. 1ro Pto (GD / AZ / HA-D) tras ComPen
  | 'TRISEC_AJ'     // Ajustes de Trisección (Obs cara 1/2, Z)
  | 'CODE_LIST'     // Lista de códigos Cd (LIST)
  | 'CODE_SEARCH'   // Búsqueda de código Cd (BUSC)
  | 'CODE_ADD'      // Agregar código Cd (AGR -> Sob.escri?)
  | 'VER_DETAIL'    // Detalle de un registro en TOPO > Ver
  | 'TOPO_PTTRN'    // Dist*Coord: Num. SETs / Num. Obs / ObsdesP1/2 / PreenterPt
  | 'TOPO_MODEL'    // Selec. Modelo Obs (PTTRN)
  | 'REPL_OBS'      // Observación de replanteo (GD / AZ / HA-D)
  // --- Corrección de usuario (14-10-2026) ---
  | 'GEN'           // Pantallas genéricas (menús, ajustes, avisos y confirmaciones: USB, DATO, Cod., CNFG, ANG.H, MDR...)
  ;

// Modo de entrada del teclado (cambia con SHIFT): Números, Letras o Signos
type InputMode = 'NUM' | 'ALF' | 'SIM';

// Contexto desde el que se abrió la lista de puntos (CARG / Ver)
type PickContext = 'OCC' | 'BS' | 'REPL' | 'VER' | 'ANGH';

// Contexto desde el que se abrió el compensador ComPen
type CompenContext = 'MED' | 'TRISEC' | 'OBS' | 'REPL';

// Registro de memoria tal como lo lista el equipo (Occ / PTO / Ref. / Crd)
interface PointRecord {
  tag: 'Occ' | 'PTO' | 'Ref.' | 'Crd';
  PTO: string;
  N: number;
  E: number;
  Z: number;
  CD: string;
}

// Opciones de Clima y Viento (◄ ► en Estacionamiento)
const CLIMA_OPTIONS = ['Fino', 'Nublado', 'Lluvia ligera', 'Lluvia', 'Nieve'];
const VIENTO_OPTIONS = ['Calma', 'Suave', 'Ligero', 'Fuerte', 'Muy fuerte'];

// Códigos Cd por defecto (lista provisional hasta confirmar con la clienta)
const DEFAULT_CODES = ['TN', 'LIN', 'DREN', 'TL', 'CA', 'PMT', 'COL', 'CASE', '255', 'TAZA', 'CALLE', 'ACEQ', 'V', 'HITO'];

// Configuración EDM (tabla entregada por la clienta)
const EDM_MODOS = ['Fino R', 'Fino S', 'PROM.fina', 'Rápido R', 'Rápido S', 'Tracking'];
const EDM_REFLECTORES = ['Prisma', 'Diana', 'N-Prism'];
const EDM_MANT_ILUM = ['Láser', 'Guía'];
const EDM_LUZ_GUIA = ['1', '2', '3'];

// Duración simulada de la medición de distancia según el modo EDM (ms)
const EDM_DURATION: Record<string, number> = {
  'Fino R': 2600,
  'Fino S': 2200,
  'PROM.fina': 3600,
  'Rápido R': 1500,
  'Rápido S': 1300,
  Tracking: 1800
};

// Caracteres por tecla según el modo de entrada (ALF = letras, SIM = signos)
const KEY_CHARS: Record<string, { ALF: string; SIM: string }> = {
  '7': { ALF: 'ABC', SIM: '7' },
  '8': { ALF: 'DEF', SIM: '8' },
  '9': { ALF: 'GHI', SIM: '9' },
  '4': { ALF: 'JKL', SIM: '4' },
  '5': { ALF: 'MNO', SIM: '5' },
  '6': { ALF: 'PQR', SIM: '6' },
  '1': { ALF: 'STU', SIM: '1' },
  '2': { ALF: 'VWX', SIM: '2' },
  '3': { ALF: 'YZ', SIM: '!' },
  '0': { ALF: ' ', SIM: '/_&' },
  '.': { ALF: '.', SIM: '*?$' },
  '-': { ALF: '-', SIM: '+-' }
};

// 10 puntos de coordenadas por defecto en memoria (Crd 1 ... Crd 10)
const DEFAULT_CRD_POINTS: TopoPoint[] = [
  { PTO: '1', N: 1000.0, E: 1000.0, Z: 100.0, CD: 'BASE' },
  { PTO: '2', N: 1025.5, E: 1018.2, Z: 101.4, CD: 'REF' },
  { PTO: '3', N: 1040.12, E: 995.37, Z: 100.85, CD: 'TN' },
  { PTO: '4', N: 1058.64, E: 1012.9, Z: 101.12, CD: 'TN' },
  { PTO: '5', N: 1063.2, E: 1041.55, Z: 101.63, CD: 'LIN' },
  { PTO: '6', N: 1047.81, E: 1066.03, Z: 100.97, CD: 'LIN' },
  { PTO: '7', N: 1021.45, E: 1072.4, Z: 100.42, CD: 'DREN' },
  { PTO: '8', N: 996.3, E: 1058.77, Z: 99.88, CD: 'CA' },
  { PTO: '9', N: 984.92, E: 1031.06, Z: 99.71, CD: 'TL' },
  { PTO: '10', N: 990.15, E: 1007.64, Z: 99.95, CD: 'TN' }
];

// Conversión sexagesimal estándar topográfica (DD°MM'SS")
export const formatDMS = (deg: number): string => {
  if (isNaN(deg)) return `00°00'00"`;
  const normalized = ((deg % 360) + 360) % 360;
  const d = Math.floor(normalized);
  const minFloat = (normalized - d) * 60;
  const m = Math.floor(minFloat);
  const s = Math.round((minFloat - m) * 60);
  const finalM = s === 60 ? m + 1 : m;
  const finalS = s === 60 ? 0 : s;
  const finalD = finalM === 60 ? d + 1 : d;
  return `${String(finalD).padStart(3, '0')}°${String(finalM % 60).padStart(2, '0')}'${String(finalS).padStart(2, '0')}"`;
};

// Formato sexagesimal corto para el Compensador Electrónico ComPen (-X' YY")
export const formatTiltDMS = (seconds: number): string => {
  const sign = seconds < 0 ? '-' : ' ';
  const absSec = Math.abs(seconds);
  const m = Math.floor(absSec / 60);
  const s = absSec % 60;
  return `${sign}${m}' ${String(s).padStart(2, '0')}"`;
};

// Formato de inclinación con grados (-0°13'04") para Const Instr
export const formatTiltDMSLong = (seconds: number): string => {
  const sign = seconds < 0 ? '-' : ' ';
  const a = Math.abs(seconds);
  const d = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = Math.round(a % 60);
  return `${sign}${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`;
};

// Función de auto-incremento inteligente del PTO
export const incrementPointId = (pto: string): string => {
  if (!pto) return '1';
  const match = pto.match(/^(.*?)(\d+)$/);
  if (!match) {
    return pto; // Si no termina en número (ej: E-A, EST), se mantiene igual
  }
  const prefix = match[1];
  const numStr = match[2];
  const nextNum = parseInt(numStr, 10) + 1;
  const padded = String(nextNum).padStart(numStr.length, '0');
  return `${prefix}${padded}`;
};

// Entrada de ángulos al estilo Topcon: ddd.mmss (ej. 113.4558 = 113°45'58")
export const parseDmsInput = (v: number): number => {
  const sign = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mmss = Math.round((a - d) * 10000);
  const m = Math.floor(mmss / 100);
  const sec = mmss % 100;
  return sign * (d + Math.min(m, 59) / 60 + Math.min(sec, 59) / 3600);
};

// Manejadores de la capa de correcciones (ver sección 8)
interface OverrideHandlers {
  fkey: (f: 1 | 2 | 3 | 4) => boolean;
  enter: () => boolean;
  esc: () => boolean;
  arrow: (dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT') => boolean;
  key: (key: string) => boolean;
  shift: () => void;
  func: () => boolean;
  center: () => void;
}

// 10 Slots de Trabajos por defecto Topcon ES-105 (* no exportados a USB)
// Trabajos con "*" = aún no enviados (no se pueden borrar: "Enviar 1ro"); sin "*" = ya enviados (se pueden borrar)
const DEFAULT_JOB_SLOTS = [
  '*GRAMA',
  '*PROYECTO01',
  'PRUEBA',
  '*PROYECTO1',
  'TOPOGRAFIA',
  '*CANTERA',
  'OBRA_SUR',
  '*PARQUE',
  'JOB09',
  'JOB10'
];

// Cantidad de puntos por trabajo (inventada, como pidió la clienta). El trabajo activo muestra sus puntos reales.
const DEFAULT_JOB_COUNTS = [0, 98, 14, 4, 37, 22, 9, 15, 0, 0];

// Valores por defecto de todos los ajustes del equipo (CNFG, Config. Comunic., Bluetooth, Estrella...)
const DEFAULT_CFG: Record<string, string> = {
  // Config. Comunic.
  'com.sinCable': 'No',
  'com.vel': '9600bPs',
  'com.bits': '8bit',
  'com.par': 'Ningun',
  'com.paro': '1bit',
  'com.compFin': 'Si',
  'com.ack': 'Yes',
  'com.crlf': 'Si',
  'com.ackMode': 'Estandar',
  // Bluetooth
  'bt.modo': 'Origen',
  'bt.enl': '12345',
  'bt.auth': 'Si',
  'bt.clave': '*****',
  'bt.compFin': 'Si',
  // CNFG > Cond. Obs.
  'obs.modoDist': 'DistG',
  'obs.distH': 'Tierra',
  'obs.compens': 'Si(H,V)',
  'obs.corrCol': 'Si',
  'obs.esfRef': 'K=0.142',
  'obs.nivMar': 'Si',
  'obs.obsV': 'Horiz.',
  'obs.coord': 'X-Y-Z',
  'obs.reso': '1',
  'obs.diana': 'On',
  'obs.despAng': 'Libre',
  'obs.incr': '100',
  'obs.vManual': 'No',
  // CNFG > Config.Instr (Contraste y Niv Retic se comparten con la Estrella)
  'instr.apagar': '30min',
  'retic': '5',
  'contraste': '11',
  'instr.resumir': 'On',
  'instr.edmAlc': 'Mant.',
  'instr.luzGuia': '1',
  // CNFG > Unidades
  'units.temp': '°C',
  'units.pres': 'hPa',
  'units.ang': 'grado',
  'units.dist': 'metro',
  'units.pie': 'Pie EU',
  // Estrella
  'plomLaser': 'Off',
  'nivLaser': '5',
  'punteo': 'Off',
  // ANG.H > Coord (referencia)
  'angRef.X': '1000.000',
  'angRef.Y': '1000.000',
  'angRef.Z': '500.000'
};

// Opciones de cada ajuste
const CFG_OPTIONS: Record<string, string[]> = {
  'com.sinCable': ['No', 'Si'],
  'com.vel': ['38400bPs', '19200bPs', '9600bPs', '4800bPs', '2400bPs', '1200bPs'],
  'com.bits': ['8bit', '7bit'],
  'com.par': ['Ningun', 'Par', 'Impar'],
  'com.paro': ['1bit', '2bit'],
  'com.compFin': ['Si', 'No'],
  'com.ack': ['Yes', 'No'],
  'com.crlf': ['Si', 'No'],
  'com.ackMode': ['Estandar', 'Omitido'],
  'bt.modo': ['Origen', 'Esclavo'],
  'bt.auth': ['Si', 'No'],
  'bt.compFin': ['Si', 'No'],
  'obs.modoDist': ['DistG', 'DistV', 'DistH'],
  'obs.distH': ['Tierra', 'Rejilla'],
  'obs.compens': ['Si(H,V)', 'No', 'Si(V)'],
  'obs.corrCol': ['Si', 'No'],
  'obs.esfRef': ['K=0.142', 'No', 'K=0.20'],
  'obs.nivMar': ['Si', 'No'],
  'obs.obsV': ['Horiz.', 'Zenital', 'Horiz. 90°'],
  'obs.coord': ['X-Y-Z', 'Y-X-Z'],
  'obs.reso': ['1', '5'],
  'obs.diana': ['On', 'Off'],
  'obs.despAng': ['Libre', 'Mant.'],
  'obs.vManual': ['No', 'Si'],
  'instr.apagar': ['30min', '15min', '10min', '5min', 'No'],
  'retic': ['5', '4', '3', '2', '1', '0'],
  'contraste': ['11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
  'instr.resumir': ['On', 'Off'],
  'instr.edmAlc': ['Mant.', 'Libre'],
  'instr.luzGuia': ['1', '2'],
  'units.temp': ['°C', '°F'],
  'units.pres': ['mmHg', 'PulgHg', 'hPa'],
  'units.ang': ['grado', 'gon', 'mil'],
  'units.dist': ['metro', 'pie', 'pul'],
  'units.pie': ['Pie EU', 'Pie INT'],
  'plomLaser': ['Off', 'On'],
  'punteo': ['Off', 'On']
};

const DEFAULT_BT_DEVICES = ['DEVICE1', '*12345', 'DEVICE3', 'DEVICE4'];

// Slider monocromático estilo LCD (nivelación ComPen). Se arrastra con el ratón o el dedo.
const LcdSlider = ({
  orientation,
  value,
  min,
  max,
  onChange,
  title
}: {
  orientation: 'horizontal' | 'vertical';
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  title?: string;
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const isH = orientation === 'horizontal';
  const ratio = (value - min) / (max - min);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let t = isH ? (clientX - r.left) / r.width : 1 - (clientY - r.top) / r.height;
    t = Math.max(0, Math.min(1, t));
    onChange(Math.round(min + t * (max - min)));
  };

  return (
    <div
      ref={trackRef}
      title={title}
      onPointerDown={e => {
        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
        dragging.current = true;
        updateFromPointer(e.clientX, e.clientY);
      }}
      onPointerMove={e => { if (dragging.current) updateFromPointer(e.clientX, e.clientY); }}
      onPointerUp={e => {
        (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
        dragging.current = false;
      }}
      onPointerCancel={() => { dragging.current = false; }}
      className={`relative touch-none cursor-pointer rounded-full border-2 border-neutral-900 bg-transparent ${
        isH ? 'w-[84px] h-[10px]' : 'w-[10px] h-[84px]'
      }`}
    >
      {/* Relleno (desde el inicio hasta la perilla) */}
      <div
        className="absolute bg-neutral-900 rounded-full"
        style={isH
          ? { left: 2, top: 2, bottom: 2, width: `calc(${ratio * 100}% - 4px)` }
          : { left: 2, right: 2, bottom: 2, height: `calc(${ratio * 100}% - 4px)` }}
      />
      {/* Perilla */}
      <div
        className="absolute w-[10px] h-[10px] rounded-full bg-neutral-950 border border-neutral-950"
        style={isH
          ? { left: `calc(${ratio * 100}% - 5px)`, top: -2 }
          : { bottom: `calc(${ratio * 100}% - 5px)`, left: -2 }}
      />
    </div>
  );
};

export default function App() {
  // =========================================================================
  // 2. ARQUITECTURA DE ESTADOS TOPOGRÁFICOS (React State)
  // =========================================================================
  const [station, setStation] = useState<Station>({
    N: 1000.0,
    E: 1000.0,
    Z: 100.0,
    PTO: 'PTO 1',
    HI: 1.471,
  });

  const [stationAtm, setStationAtm] = useState<StationAtm>({
    CD: 'TN',
    operador: (() => {
      try {
        return localStorage.getItem('user_name') || 'TOPOGRAFO';
      } catch {
        return 'TOPOGRAFO';
      }
    })(),
    clima: 'Fino',
    viento: 'Calma',
    temp: '15',     // °C
    pres: '1013',   // hPa
    ppm: '-6'
  });

  const [backsight, setBacksight] = useState<Backsight>({
    N: 1050.0,
    E: 1050.0,
    Z: 100.0,
    PTO: 'BS-1'
  });

  const [azimutInicial, setAzimutInicial] = useState<number>(45.0); // Calculado tras orientar

  const [target, setTarget] = useState<Target>({
    HR: 1.6,
    CD: 'LINDERO',
    PTO: 'BM-1',
  });

  const [jobName, setJobName] = useState<string>('GRAMA');
  const [coordJobName, setCoordJobName] = useState<string>('PROYECTO1');

  // Gestión de Trabajos (Menú TRABJ): Sistema inicializado siempre con 10 slots
  const [jobsList, setJobsList] = useState<string[]>(DEFAULT_JOB_SLOTS);
  const [jobMenuSelection, setJobMenuSelection] = useState<number>(1);
  const [jobSelectField, setJobSelectField] = useState<number>(0);
  const [selectedJobIdx, setSelectedJobIdx] = useState<number>(0);
  const [jobDeleteTarget, setJobDeleteTarget] = useState<string>('');

  // Memoria interna de puntos de la Estación Total (Puntos levantados)
  const [points, setPoints] = useState<TopoPoint[]>([
    { PTO: 'EST-1', N: 1000.0, E: 1000.0, Z: 100.0, CD: 'ESTACION', type: 'station' },
    { PTO: 'BS-1', N: 1050.0, E: 1050.0, Z: 100.0, CD: 'PTO_ATRAS', type: 'backsight' }
  ]);

  // 1. MÓDULO DE DATOS CONOCIDOS: Array independiente según especificación
  const [knownPoints, setKnownPoints] = useState<TopoPoint[]>([]);
  const [knownMenuSelection, setKnownMenuSelection] = useState<number>(1);
  const [selectedKnownIdx, setSelectedKnownIdx] = useState<number>(0);
  const [knownCoordsInput, setKnownCoordsInput] = useState<{
    Y: string;
    X: string;
    Z: string;
    PTO: string;
  }>({
    Y: '',
    X: '',
    Z: '',
    PTO: '1'
  });
  const [viewKnownIdx, setViewKnownIdx] = useState<number>(0);
  const [readTargetContext, setReadTargetContext] = useState<'OCC' | 'BS'>('OCC');
  const [newKnownPoint, setNewKnownPoint] = useState<TopoPoint>({
    PTO: 'BM-3',
    N: 1000.0,
    E: 1000.0,
    Z: 100.0,
    CD: 'BASE'
  });

  // Datos para comprobación de orientación y cálculo de error delta (dDH)
  const [checkBsData, setCheckBsData] = useState<{
    dHD: number;
    dZ: number;
    azTeo: number;
    dhTeo: number;
    dhMed: number;
    calcDH: number;
    obsH: number;
    dDH: number;
    haD: number;
    acim: number;
  }>({
    dHD: 0,
    dZ: 0,
    azTeo: 45,
    dhTeo: 70.71,
    dhMed: 70.71,
    calcDH: 70.71,
    obsH: 70.71,
    dDH: 0,
    haD: 45,
    acim: 45
  });

  // Selección en menús USB (por defecto opción 2. Tipo S con indicador [2/2])
  const [usbMenuSelection, setUsbMenuSelection] = useState<number>(2);
  const [usbSelectedJob, setUsbSelectedJob] = useState<string>('PROYECTO1');
  const [usbFormatSelection, setUsbFormatSelection] = useState<number>(1);
  const [obsShotFlash, setObsShotFlash] = useState<boolean>(false);

  // =========================================================================
  // 3. REGULADORES DE TERRENO (Simulación del Mundo Físico / Láser Exterior)
  // =========================================================================
  const [envHD, setEnvHD] = useState<number>(15.5); // Ángulo Horizontal
  const [envV, setEnvV] = useState<number>(89.25); // Ángulo Cenital (90° = horizontal)
  const [envSD, setEnvSD] = useState<number>(45.85); // Distancia Inclinada Real (m)

  // =========================================================================
  // 4. ESTADOS DE HARDWARE Y MÁQUINA DE ESTADOS TOPCON
  // =========================================================================
  // Arranque: Inicia obligatoriamente en el Compensador Digital (Nivel Electrónico)
  const [screenState, setScreenState] = useState<ScreenState>('TILT');
  const [medPage, setMedPage] = useState<1 | 2 | 3>(1); // Pág 1, 2, 3 en pantalla MED (alternada con [FUNC])
  const [mainPage, setMainPage] = useState<1 | 2>(1); // Pág 1 / Pág 2 alternada con botón FUNC
  const [edmMode, setEdmMode] = useState<EdmMode>('prism'); // Alternado con botón SFT
  const [menuSelection, setMenuSelection] = useState<number>(1);
  const [activeField, setActiveField] = useState<number>(0);
  const [inputBuffer, setInputBuffer] = useState<string>('');
  const [lcdMessage, setLcdMessage] = useState<string | null>(null);
  const [isMeasuring, setIsMeasuring] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isBacklightOn, setIsBacklightOn] = useState<boolean>(true);
  const [, setIsOriented] = useState<boolean>(true);
  const [isAlphaKeyboardOpen, setIsAlphaKeyboardOpen] = useState<boolean>(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState<boolean>(false);

  // Estados para pantalla MED y Compensador ComPen (AZ-0)
  const [showTaraSoftkey, setShowTaraSoftkey] = useState<boolean>(false);
  const [compenX, setCompenX] = useState<number>(-167); // Representa -2' 47"
  const [compenY, setCompenY] = useState<number>(245);  // > 210" -> * * * *

  // Estados para Estacionamiento (Occ.Orien), Carga de Puntos (CARG), ACLE.R y TRISEC
  const [occPage, setOccPage] = useState<1 | 2>(1);
  const [selectedOccLoadIdx, setSelectedOccLoadIdx] = useState<number>(0);
  const [occSearchBuffer, setOccSearchBuffer] = useState<string>('');
  const [trisecSelection, setTrisecSelection] = useState<number>(2); // 1. A, 2. YXZ, 3. Cota, 4. Ajustes

  // Estados para Menú Gráfico Principal, RePlanteo y TOPO
  const [graphicMenuIdx, setGraphicMenuIdx] = useState<number>(0);
  const [replMenuSelection, setReplMenuSelection] = useState<number>(1);
  const [replDisplayMode, setReplDisplayMode] = useState<'COORD' | 'DISP'>('COORD');
  const [topoMenuSelection, setTopoMenuSelection] = useState<number>(1);
  const [topoVerPage, setTopoVerPage] = useState<1 | 2>(1);

  // Estados para Menú EDM, DESPLZ, Ajustes Rápidos (Estrella ★) y USB Tipo T
  const [prevScreenBeforeEdm, setPrevScreenBeforeEdm] = useState<ScreenState>('MED');
  const [, setEdmReflector] = useState<'N-Prism' | 'Prisma' | 'Diana' | 'N-Prisma'>('N-Prism');
  const [desplzMenuSelection, setDesplzMenuSelection] = useState<number>(1);
  const [isStarMenuOpen, setIsStarMenuOpen] = useState<boolean>(false);
  const [usbTTypeSelection, setUsbTTypeSelection] = useState<number>(1);
  const [usbTypeMode, setUsbTypeMode] = useState<'T' | 'S'>('S');

  // =========================================================================
  // ESTADOS AÑADIDOS (Corrección de usuario 12-10-2026)
  // =========================================================================
  // Modo de entrada del teclado (SHIFT): NUM -> ALF -> SIM, con multi-pulsación en ALF/SIM
  const [inputMode, setInputMode] = useState<InputMode>('NUM');
  const lastTapRef = useRef<{ key: string; time: number; idx: number }>({ key: '', time: 0, idx: 0 });

  // Pantalla MED: vista normal (HD / AZ / HA-D) o vista GHV (GD / HD / VD)
  const [medView, setMedView] = useState<'NORMAL' | 'GHV'>('NORMAL');
  const [lastMeas, setLastMeas] = useState<{ SD: number; HD: number; VD: number; HA: number; V: number } | null>(null);
  // Animación de medición de distancia (línea + láser, F4 = PARA)
  const [measureAnim, setMeasureAnim] = useState<{ active: boolean; progress: number }>({ active: false, progress: 0 });
  const measureTimerRef = useRef<{ interval: number | null; done: (() => void) | null }>({ interval: null, done: null });

  // Configuración EDM (2 páginas)
  const [edmCfg, setEdmCfg] = useState<{ modo: string; cp: number; mantIlum: string; luzGuia: string }>({
    modo: 'Rápido S',
    cp: 0,
    mantIlum: 'Láser',
    luzGuia: '1'
  });
  const [edmField, setEdmField] = useState<number>(0);
  const [edmBuffer, setEdmBuffer] = useState<string>('');

  // Estacionamiento: lista de códigos Cd (LIST / BUSC / AGR)
  const [codeList, setCodeList] = useState<string[]>(DEFAULT_CODES);
  const [codeIdx, setCodeIdx] = useState<number>(0);
  const [codeSearchBuffer, setCodeSearchBuffer] = useState<string>('');

  // Lista de puntos genérica (CARG en Estacionamiento, E.RXYZ, Replanteo y Ver)
  const [pickCtx, setPickCtx] = useState<PickContext>('OCC');
  const [searchField, setSearchField] = useState<number>(0); // 0 PTO, 1 Criteria, 2 Direct.
  const [searchCriteria, setSearchCriteria] = useState<'Completo' | 'Parcial'>('Completo');
  const [searchDirection, setSearchDirection] = useState<'↓' | '↑'>('↓');
  const [verDetailIdx, setVerDetailIdx] = useState<number>(0);

  // ComPen: contexto de origen y pantalla de regreso
  const [compenCtx, setCompenCtx] = useState<CompenContext>('MED');
  const [compenReturn, setCompenReturn] = useState<ScreenState>('MED');

  // Trisección: ajustes y medición
  const [trisecAj, setTrisecAj] = useState<{ obsCara: 'No' | 'Si'; z: 'On' | 'Off'; field: number }>({
    obsCara: 'No',
    z: 'On',
    field: 0
  });

  // Replanteo: punto cargado y datos editables DistH / Ang H
  const [replPoint, setReplPoint] = useState<TopoPoint | null>(null);
  const [replDisp, setReplDisp] = useState<{ distH: number; angH: number }>({ distH: 0, angH: 113.766111 });

  // Observación: tras [MED] se habilita [REG]
  const [obsMeasured, setObsMeasured] = useState<boolean>(false);
  const [obsReturn, setObsReturn] = useState<ScreenState>('COORD_MENU');
  const [desplzReturn, setDesplzReturn] = useState<ScreenState>('MED');

  // TOPO Dist*Coord: patrón de observación y modelos
  const [topoPttrn, setTopoPttrn] = useState<{ sets: number; obs: number; obsP12: 'NO' | 'SI'; preenter: 'NO' | 'SI'; field: number }>({
    sets: 1,
    obs: 1,
    obsP12: 'NO',
    preenter: 'NO',
    field: 0
  });
  const [topoModels, setTopoModels] = useState<string[]>(['CLEV', '', 'CLEV', '']);
  const [topoModelIdx, setTopoModelIdx] = useState<number>(0);

  // Botón estrella: ajustes rápidos o menú de accesos (ENT)
  const [starMode, setStarMode] = useState<'SETTINGS' | 'MENU'>('SETTINGS');
  const [starMenuIdx, setStarMenuIdx] = useState<number>(0);

  // Capa de correcciones: se asigna en cada render (sección 8)
  const overrideRef = useRef<OverrideHandlers | null>(null);

  // =========================================================================
  // ESTADOS AÑADIDOS (Corrección de usuario 14-10-2026)
  // =========================================================================
  // Ajustes del equipo (CNFG, Config. Comunic., Bluetooth, Estrella...)
  const [cfg, setCfg] = useState<Record<string, string>>(DEFAULT_CFG);
  const setCfgKey = useCallback((k: string, v: string) => setCfg(c => ({ ...c, [k]: v })), []);
  // Pila de pantallas genéricas (menús / ajustes / avisos / confirmaciones)
  const [genStack, setGenStack] = useState<{ id: string; idx: number; param?: string }[]>([]);
  const [genReturn, setGenReturn] = useState<ScreenState>('ROOT');
  const [genAlpha, setGenAlpha] = useState<boolean>(false);
  const [sendCount, setSendCount] = useState<number>(0);
  // Cantidad de puntos por trabajo (inventada) y trabajos marcados "Fuer" para Salida Comunic.
  const [jobCounts, setJobCounts] = useState<number[]>(DEFAULT_JOB_COUNTS);
  const [salidaSel, setSalidaSel] = useState<number[]>([]);
  const [jobScale, setJobScale] = useState<string>('1.00000000');
  // Dispositivos Bluetooth registrados
  const [btDevices, setBtDevices] = useState<string[]>(DEFAULT_BT_DEVICES);
  // Estrella: campo seleccionado (9 opciones)
  const [starField, setStarField] = useState<number>(0);
  // Pantalla de regreso de Estacionamiento y de los códigos Cd
  const [occReturn, setOccReturn] = useState<ScreenState>('COORD_MENU');
  const [codeTarget, setCodeTarget] = useState<'OCC' | 'OBS'>('OCC');
  // Trisección: lectura de ángulos (ANGUL)
  const [trisecAng, setTrisecAng] = useState<{ V: number; HA: number } | null>(null);
  // MDR: punto inicial y resultado de la medición de distancia remota
  const [mdr, setMdr] = useState<{
    pt: number;
    p1: { x: number; y: number; z: number; SD: number; V: number; HA: number } | null;
    p2?: { x: number; y: number; z: number; SD: number; V: number; HA: number } | null;
    res: { dGD: number; dHD: number; dVD: number } | null;
  }>({ pt: 1, p1: null, res: null });

  const GRAPHIC_MENU_ITEMS = useMemo(() => [
    { id: 'coord', name: 'Coord' },
    { id: 'replanteo', name: 'RePlanteo' },
    { id: 'desplz', name: 'DesPlz.' },
    { id: 'topo', name: 'ToPografia' },
    { id: 'mdr', name: 'MDR' },
    { id: 'mer', name: 'MER' },
    { id: 'calc_area', name: 'Calc.Area' },
    { id: 'repl_linea', name: 'RePl Linea' },
    { id: 'repl_arco', name: 'RePl Arco' },
    { id: 'proyecto_p', name: 'Proyecto-P' },
    { id: 'pt_a_linea', name: 'Pt.a.Linea' },
    { id: 'intersec', name: 'Intersec.' },
    { id: 'poligonal', name: 'Poligonal' },
    { id: 'vial', name: 'Vial' },
    { id: 'per_trans', name: 'Per.Trans.' }
  ], []);

  // Memoria de registros tal como la lista el equipo: Crd (coordenadas), Occ (estación), Ref. (punto atrás), PTO (observados)
  const pointRecords = useMemo<PointRecord[]>(() => {
    const recs: PointRecord[] = [];
    const push = (tag: PointRecord['tag'], p: TopoPoint) => {
      if (!recs.some(r => r.tag === tag && r.PTO.toLowerCase() === p.PTO.toLowerCase())) {
        recs.push({ tag, PTO: p.PTO, N: p.N, E: p.E, Z: p.Z, CD: p.CD || '' });
      }
    };
    DEFAULT_CRD_POINTS.forEach(p => push('Crd', p));
    knownPoints.forEach(p => push('Crd', p));
    points.forEach(p => {
      if (p.type === 'station') push('Occ', p);
      else if (p.type === 'backsight') push('Ref.', p);
      else push('PTO', p);
    });
    return recs;
  }, [points, knownPoints]);

  // Compatibilidad con el flujo de carga existente
  const occLoadPoints = useMemo<TopoPoint[]>(
    () => pointRecords.map(r => ({ PTO: r.PTO, N: r.N, E: r.E, Z: r.Z, CD: r.CD })),
    [pointRecords]
  );

  // Posición de la burbuja calculada para la diana ComPen (centro en 50, 50, radio máx 36px)
  const bubblePos = useMemo(() => {
    const dx = compenX / 8;
    const dy = -compenY / 8;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxR = 36;
    if (dist > maxR && dist > 0) {
      return {
        x: 50 + (dx / dist) * maxR,
        y: 50 + (dy / dist) * maxR
      };
    }
    return {
      x: 50 + dx,
      y: 50 + dy
    };
  }, [compenX, compenY]);

  // ComPen: la burbuja ya no se arrastra. Se nivela con los sliders (X = tornillos A+B, Y = tornillo C).
  const COMPEN_LIMIT = 300; // segundos de arco máximos representables en los sliders

  // Síntesis de Audio Web Audio API (Zumbador y Láser EDM)
  const playBeep = useCallback((freq = 1400, duration = 0.08, type: OscillatorType = 'sine') => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.09, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // Ignorar bloqueos de audio
    }
  }, [soundEnabled]);

  const playLaserBeep = useCallback(() => {
    if (!soundEnabled) return;
    playBeep(2200, 0.06);
    setTimeout(() => playBeep(2800, 0.14), 80);
  }, [soundEnabled, playBeep]);

  // =========================================================================
  // MEDICIÓN DE DISTANCIA SIMULADA: pantalla "Dist" con la línea avanzando hacia
  // la derecha, pitidos repetidos y cierre automático (F4 = PARA la detiene).
  // =========================================================================
  const stopMeasurement = useCallback((runDone: boolean) => {
    const t = measureTimerRef.current;
    if (t.interval !== null) {
      window.clearInterval(t.interval);
      t.interval = null;
    }
    const done = t.done;
    t.done = null;
    setMeasureAnim({ active: false, progress: 0 });
    if (runDone && done) done();
  }, []);

  const startMeasurement = useCallback((onDone: () => void, durationOverride?: number) => {
    if (measureTimerRef.current.interval !== null) return;
    const duration = durationOverride ?? EDM_DURATION[edmCfg.modo] ?? 1500;
    const start = Date.now();
    let lastBeep = 0;
    measureTimerRef.current.done = onDone;
    setMeasureAnim({ active: true, progress: 0 });
    playBeep(2100, 0.05);
    measureTimerRef.current.interval = window.setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed - lastBeep >= 320) {
        lastBeep = elapsed;
        playBeep(2400, 0.04);
      }
      if (elapsed >= duration) {
        playLaserBeep();
        stopMeasurement(true);
      } else {
        setMeasureAnim({ active: true, progress: elapsed / duration });
      }
    }, 50);
  }, [edmCfg.modo, playBeep, playLaserBeep, stopMeasurement]);

  // Limpieza del temporizador de medición al desmontar
  useEffect(() => {
    const t = measureTimerRef.current;
    return () => {
      if (t.interval !== null) window.clearInterval(t.interval);
    };
  }, []);

  // Lectura simulada del distanciómetro con los reguladores de terreno
  const leerDistanciometro = useCallback(() => {
    const radV = envV * (Math.PI / 180);
    const meas = {
      SD: envSD,
      HD: envSD * Math.sin(radV),
      VD: envSD * Math.cos(radV),
      HA: envHD,
      V: envV
    };
    setLastMeas(meas);
    return meas;
  }, [envV, envSD, envHD]);

  // Ciclo interactivo de reflectores EDM Topcon: N-Prism -> Prisma -> Diana -> N-Prisma
  const cycleEdmReflector = useCallback(() => {
    playBeep(1200, 0.05);
    setEdmReflector(prev => {
      if (prev === 'N-Prism' || prev === 'N-Prisma') {
        setEdmMode('prism');
        return 'Prisma';
      }
      if (prev === 'Prisma') {
        setEdmMode('sheet');
        return 'Diana';
      }
      setEdmMode('non_prism');
      return 'N-Prisma';
    });
  }, [playBeep]);

  // Manejador del botón físico de estrella (Ajustes Rápidos): solo abre dentro de OBS / MED
  const handleStarPress = useCallback(() => {
    playBeep(1600, 0.05);
    if (screenState === 'OBS' || screenState === 'MED') {
      setStarMode('SETTINGS');
      setStarMenuIdx(0);
      setIsStarMenuOpen(prev => !prev);
    }
  }, [screenState, playBeep]);

  // Limpiar mensaje temporal en LCD
  useEffect(() => {
    if (lcdMessage) {
      const timer = setTimeout(() => setLcdMessage(null), 2400);
      return () => clearTimeout(timer);
    }
  }, [lcdMessage]);

  // Sincronizar inputBuffer cuando cambia el campo o la pantalla
  useEffect(() => {
    if (screenState === 'OCC_ORIEN') {
      // 14 campos: Y0 X0 Z0 PTO HI | Cd Operador | Fech Tiem Clima Viento | Temp Pres PPm
      const vals = [
        station.N,
        station.E,
        station.Z,
        station.PTO || 'EST-1',
        station.HI,
        stationAtm.CD,
        stationAtm.operador,
        '',
        '',
        stationAtm.clima,
        stationAtm.viento,
        stationAtm.temp,
        stationAtm.pres,
        stationAtm.ppm
      ];
      setInputBuffer(String(vals[activeField] ?? ''));
    } else if (screenState === 'ERXYZ') {
      const vals = [backsight.N, backsight.E, backsight.Z, backsight.PTO ?? 'BS-1'];
      setInputBuffer(String(vals[activeField] ?? ''));
    } else if (screenState === 'OBS') {
      if (activeField === 0) setInputBuffer(target.PTO);
      if (activeField === 1) setInputBuffer(target.CD);
      if (activeField === 2) setInputBuffer(target.HR.toFixed(3));
    } else if (screenState === 'JOB_DETAILS') {
      setInputBuffer(activeField === 0 ? jobName.replace(/^\*/, '') : jobScale);
    } else if (screenState === 'JOB') {
      setInputBuffer(jobName.replace(/^\*/, ''));
    } else if (screenState === 'KNOWN_INPUT') {
      if (activeField === 0) setInputBuffer(knownCoordsInput.Y);
      if (activeField === 1) setInputBuffer(knownCoordsInput.X);
      if (activeField === 2) setInputBuffer(knownCoordsInput.Z);
      if (activeField === 3) setInputBuffer(knownCoordsInput.PTO);
    } else if (screenState === 'KNOWN_NEW') {
      if (activeField === 0) setInputBuffer(newKnownPoint.PTO);
      if (activeField === 1) setInputBuffer(String(newKnownPoint.N));
      if (activeField === 2) setInputBuffer(String(newKnownPoint.E));
      if (activeField === 3) setInputBuffer(String(newKnownPoint.Z));
      if (activeField === 4) setInputBuffer(newKnownPoint.CD ?? '');
    }
  }, [screenState, activeField, station, stationAtm, backsight, target, jobName, jobScale, knownCoordsInput, newKnownPoint]);

  // Verificar si el campo actual admite texto alfanumérico
  const isCurrentFieldAlpha = useMemo(() => {
    if (screenState === 'JOB') return true;
    if (screenState === 'JOB_DETAILS') return activeField === 0; // Nom. TRA alfanumérico; ESCAL numérico
    if (screenState === 'OCC_LOAD_SEARCH') return searchField === 0; // Solo el campo PTO admite texto
    if (screenState === 'OBS') return activeField === 0 || activeField === 1; // PTO y Cd alfanuméricos; HD numérico
    if (screenState === 'CODE_SEARCH') return true;
    if (screenState === 'GEN') return genAlpha;
    if (screenState === 'KNOWN_NEW' && (activeField === 0 || activeField === 4)) return true; // PTO o CD de base
    if (screenState === 'KNOWN_INPUT' && activeField === 3) return true; // PTO de Datos Conocidos
    if (screenState === 'OCC_ORIEN' && (activeField === 3 || activeField === 5 || activeField === 6)) return true; // PTO, Cd, Operador
    return false;
  }, [screenState, activeField, searchField, genAlpha]);

  // Guardar campo editado
  const commitCurrentField = useCallback(() => {
    const val = parseFloat(inputBuffer);
    if (screenState === 'OCC_ORIEN') {
      if (activeField === 0 && !isNaN(val)) setStation(s => ({ ...s, N: val }));
      else if (activeField === 1 && !isNaN(val)) setStation(s => ({ ...s, E: val }));
      else if (activeField === 2 && !isNaN(val)) setStation(s => ({ ...s, Z: val }));
      else if (activeField === 3) setStation(s => ({ ...s, PTO: inputBuffer.trim() || 'EST-1' }));
      else if (activeField === 4 && !isNaN(val)) setStation(s => ({ ...s, HI: val }));
      else if (activeField === 5) setStationAtm(a => ({ ...a, CD: inputBuffer.trim() || 'BASE' }));
      else if (activeField === 6) setStationAtm(a => ({ ...a, operador: inputBuffer.trim() || 'OPERADOR' }));
      // 7 Fech y 8 Tiem son automáticos; 9 Clima y 10 Viento se eligen con ◄ ►
      else if (activeField === 11 && !isNaN(val)) setStationAtm(a => ({ ...a, temp: String(Math.max(-35, Math.min(60, val))) }));
      else if (activeField === 12 && !isNaN(val)) setStationAtm(a => ({ ...a, pres: String(Math.max(500, Math.min(1400, val))) }));
      else if (activeField === 13 && !isNaN(val)) setStationAtm(a => ({ ...a, ppm: String(Math.round(Math.max(-499, Math.min(499, val)))) }));
    } else if (screenState === 'ERXYZ') {
      if (activeField === 0 && !isNaN(val)) setBacksight(b => ({ ...b, N: val }));
      else if (activeField === 1 && !isNaN(val)) setBacksight(b => ({ ...b, E: val }));
      else if (activeField === 2 && !isNaN(val)) setBacksight(b => ({ ...b, Z: val }));
      else if (activeField === 3) setBacksight(b => ({ ...b, PTO: inputBuffer.trim() || 'BS-1' }));
    } else if (screenState === 'OBS') {
      if (activeField === 0) setTarget(t => ({ ...t, PTO: inputBuffer.trim() || '1' }));
      if (activeField === 1) setTarget(t => ({ ...t, CD: inputBuffer.trim() || 'PTO' }));
      if (activeField === 2 && !isNaN(val)) setTarget(t => ({ ...t, HR: val }));
    } else if (screenState === 'JOB' || (screenState === 'JOB_DETAILS' && activeField === 0)) {
      if (inputBuffer.trim()) {
        const clean = inputBuffer.trim();
        const oldClean = jobName.replace(/^\*/, '');
        setJobName(clean);
        setJobsList(prev =>
          prev.map(j => (j.replace(/^\*/, '') === oldClean ? (j.startsWith('*') ? `*${clean}` : clean) : j))
        );
      }
    } else if (screenState === 'KNOWN_INPUT') {
      if (activeField === 0) setKnownCoordsInput(k => ({ ...k, Y: inputBuffer }));
      if (activeField === 1) setKnownCoordsInput(k => ({ ...k, X: inputBuffer }));
      if (activeField === 2) setKnownCoordsInput(k => ({ ...k, Z: inputBuffer }));
      if (activeField === 3) setKnownCoordsInput(k => ({ ...k, PTO: inputBuffer.trim() || '1' }));
    } else if (screenState === 'KNOWN_NEW') {
      if (activeField === 0) setNewKnownPoint(p => ({ ...p, PTO: inputBuffer.trim() || 'BASE' }));
      if (activeField === 1 && !isNaN(val)) setNewKnownPoint(p => ({ ...p, N: val }));
      if (activeField === 2 && !isNaN(val)) setNewKnownPoint(p => ({ ...p, E: val }));
      if (activeField === 3 && !isNaN(val)) setNewKnownPoint(p => ({ ...p, Z: val }));
      if (activeField === 4) setNewKnownPoint(p => ({ ...p, CD: inputBuffer.trim() }));
    }
  }, [screenState, activeField, inputBuffer]);

  // Guardar punto conocido e iniciar bucle continuo (Y, X, Z limpiados, PTO incrementa en 1)
  const guardarPuntoConocidoYBucle = useCallback(() => {
    const finalY = activeField === 0 ? inputBuffer : knownCoordsInput.Y;
    const finalX = activeField === 1 ? inputBuffer : knownCoordsInput.X;
    const finalZ = activeField === 2 ? inputBuffer : knownCoordsInput.Z;
    const finalPTO = activeField === 3 ? (inputBuffer.trim() || '1') : (knownCoordsInput.PTO.trim() || '1');

    const yNum = parseFloat(finalY);
    const xNum = parseFloat(finalX);
    const zNum = parseFloat(finalZ);

    const newPt: TopoPoint = {
      PTO: finalPTO,
      N: isNaN(yNum) ? 0 : yNum, // Y = Norte
      E: isNaN(xNum) ? 0 : xNum, // X = Este
      Z: isNaN(zNum) ? 0 : zNum, // Z = Cota
      CD: 'BASE',
      type: 'station',
      date: new Date().toISOString()
    };

    setKnownPoints(prev => [...prev, newPt]);
    const nextPTO = incrementPointId(finalPTO);

    setKnownCoordsInput({
      Y: '',
      X: '',
      Z: '',
      PTO: nextPTO
    });

    setActiveField(0);
    setInputBuffer('');
    playLaserBeep();
  }, [activeField, inputBuffer, knownCoordsInput, playLaserBeep]);

  // Cargar punto seleccionado en Occ.Orien desde la lista
  const cargarPuntoSeleccionado = useCallback(() => {
    const pt = occLoadPoints[selectedOccLoadIdx] || occLoadPoints[0];
    if (pt) {
      playLaserBeep();
      setStation(s => ({
        ...s,
        N: pt.N,
        E: pt.E,
        Z: pt.Z,
        PTO: pt.PTO
      }));
      if (pt.CD) {
        setStationAtm(a => ({ ...a, CD: pt.CD }));
      }
      setLcdMessage(`PTO ${pt.PTO}\nCARGADO`);
      setTimeout(() => {
        setScreenState('OCC_ORIEN');
        setActiveField(0);
      }, 900);
    }
  }, [occLoadPoints, selectedOccLoadIdx, playLaserBeep]);

  // Confirmar búsqueda de punto (Criteria:Completo Direct.: _)
  const handleOccSearchConfirm = useCallback(() => {
    const q = occSearchBuffer.trim().toLowerCase();
    if (!q) {
      setLcdMessage('no hay datos');
      return;
    }
    const found = occLoadPoints.find(p => {
      const ptoLower = p.PTO.toLowerCase();
      return ptoLower === q || ptoLower === `pto ${q}` || ptoLower.replace(/^pto\s*/, '') === q;
    });

    if (!found) {
      // Si el punto no existe al dar OK, mostrar alert temporal "no hay datos"
      setLcdMessage('no hay datos');
    } else {
      playLaserBeep();
      setStation(s => ({
        ...s,
        N: found.N,
        E: found.E,
        Z: found.Z,
        PTO: found.PTO
      }));
      if (found.CD) {
        setStationAtm(a => ({ ...a, CD: found.CD }));
      }
      setLcdMessage(`PTO ${found.PTO}\nCARGADO`);
      setTimeout(() => {
        setScreenState('OCC_ORIEN');
        setActiveField(0);
      }, 900);
    }
  }, [occSearchBuffer, occLoadPoints, playLaserBeep]);

  // =========================================================================
  // 5. ACCIÓN ESPECIAL: DESCARGA AUTOMÁTICA A USB (DESDE EL FLUJO USB REAL)
  // =========================================================================
  const exportarAUSB = useCallback((customJob?: string) => {
    playLaserBeep();
    setLcdMessage('* LEYENDO MEMORIA... *\n* EXPORTANDO A USB *');

    setTimeout(() => {
      const headers = 'PTO,NORTE,ESTE,COTA,CODIGO\n';
      const rows = points
        .map(p => `${p.PTO},${p.N.toFixed(3)},${p.E.toFixed(3)},${p.Z.toFixed(3)},${p.CD}`)
        .join('\n');

      const jobToUse = customJob || usbSelectedJob || jobName || 'PROYECTO1';
      const cleanJob = jobToUse.trim().replace(/^\*/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `${cleanJob}_${dateStr}.csv`;

      const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // El trabajo exportado pierde el asterisco en la lista
      setJobsList(prev => prev.map(j => (j.replace(/^\*/, '') === cleanJob ? cleanJob : j)));

      setLcdMessage(`¡ÉXITO EN USB!\nARCHIVO: ${fileName}\nPUNTOS: ${points.length}`);
      setTimeout(() => {
        setScreenState('ROOT');
      }, 1600);
    }, 600);
  }, [points, jobName, usbSelectedJob, playLaserBeep]);

  // =========================================================================
  // 6. MÓDULO DE CÁLCULOS TOPOGRÁFICOS Y COMPROBACIÓN
  // =========================================================================

  // 4. CÁLCULO DE ORIENTACIÓN: Prepara pantalla AZ, HA-D, Acim tras presionar [OK] en E.RXYZ
  const prepararComprobacionOrientacion = useCallback(() => {
    commitCurrentField();
    const deltaN = backsight.N - station.N;
    const deltaE = backsight.E - station.E;
    let azimut = Math.atan2(deltaE, deltaN) * (180 / Math.PI);
    if (azimut < 0) azimut += 360;
    const calcDH = Math.sqrt(deltaN * deltaN + deltaE * deltaE);

    setCheckBsData(prev => ({
      ...prev,
      azTeo: azimut,
      haD: azimut,
      acim: azimut,
      calcDH: parseFloat(calcDH.toFixed(3)),
      dhTeo: parseFloat(calcDH.toFixed(3))
    }));

    setScreenState('CHECK_BS');
  }, [backsight, station, commitCurrentField]);

  // Alias de compatibilidad
  const iniciarComprobacionOrientacion = prepararComprobacionOrientacion;

  // 4B. SIMULACIÓN DE DISPARO DE COMPROBACIÓN (dDH): Ref.DisH ver leyendo regulador externo
  const iniciarMedicionDistanciaComprobacion = useCallback(() => {
    setIsMeasuring(true);
    playLaserBeep();

    setTimeout(() => {
      setIsMeasuring(false);

      // Distancia Horizontal teórica entre la estación y el punto atrás
      const deltaN = backsight.N - station.N;
      const deltaE = backsight.E - station.E;
      const calcDH = Math.sqrt(deltaN * deltaN + deltaE * deltaE);

      // Distancia Horizontal Observada con el regulador externo (envSD) y ángulo cenital (envV)
      const radV = envV * (Math.PI / 180);
      const obsH = envSD * Math.sin(radV);

      // Cálculo del error: dDH = Obs H - Calc DH
      const dDH = obsH - calcDH;

      setCheckBsData(prev => ({
        ...prev,
        calcDH: parseFloat(calcDH.toFixed(3)),
        obsH: parseFloat(obsH.toFixed(3)),
        dDH: parseFloat(dDH.toFixed(3)),
        dHD: parseFloat(dDH.toFixed(3)),
        dhTeo: parseFloat(calcDH.toFixed(3)),
        dhMed: parseFloat(obsH.toFixed(3))
      }));

      setScreenState('CHECK_BS_DIST');
    }, 380);
  }, [backsight, station, envV, envSD, playLaserBeep]);

  // Confirmar y Fijar Estación tras Comprobación de Orientación
  const ejecutarOrientacionFinal = useCallback(() => {
    playBeep(1600, 0.09);
    const deltaN = backsight.N - station.N;
    const deltaE = backsight.E - station.E;

    let azimut = Math.atan2(deltaE, deltaN) * (180 / Math.PI);
    if (azimut < 0) azimut += 360;

    const distDH = Math.sqrt(deltaN * deltaN + deltaE * deltaE);
    setAzimutInicial(azimut);
    setIsOriented(true);

    // Actualizar puntos de estación y atrás en la memoria interna
    setPoints(prev => {
      const sinBase = prev.filter(p => p.type !== 'station' && p.type !== 'backsight');
      return [
        { PTO: station.PTO || 'EST-1', N: station.N, E: station.E, Z: station.Z, CD: stationAtm.CD, type: 'station' },
        { PTO: backsight.PTO || 'BS-1', N: backsight.N, E: backsight.E, Z: backsight.Z, CD: 'PTO_ATRAS', type: 'backsight' },
        ...sinBase
      ];
    });

    playLaserBeep();
    const signDDH = checkBsData.dDH >= 0 ? '+' : '';
    setLcdMessage(`¡ESTACIÓN FIJADA!\nAZ: ${formatDMS(azimut)}\ndDH: ${signDDH}${checkBsData.dDH.toFixed(3)}m\nDH: ${distDH.toFixed(3)}m`);

    setTimeout(() => {
      setScreenState('COORD_MENU');
    }, 1800);
  }, [backsight, station, stationAtm.CD, checkBsData.dDH, playBeep, playLaserBeep]);

  // Registro del punto observado (usado por [REG] tras [MED] y por [AUTO])
  const registrarPuntoObservado = useCallback(() => {
    // Asegurar buffer actual si el usuario estaba editando PTO, Cd o HD (altura de prisma)
    const currentPTO = activeField === 0 ? (inputBuffer.trim() || target.PTO) : target.PTO;
    const currentCD = activeField === 1 ? (inputBuffer.trim() || target.CD) : target.CD;
    const bufHR = parseFloat(inputBuffer);
    const currentHR = activeField === 2 && !isNaN(bufHR) ? bufHR : target.HR;

    // 1. Valores del Panel de Reguladores Externos y conversión a radianes
    const V_rad = envV * (Math.PI / 180);

    // 2. Azimut actual
    let Azimut = azimutInicial + envHD;
    Azimut = ((Azimut % 360) + 360) % 360;
    const Azimut_rad = Azimut * (Math.PI / 180);

    // 3. Distancia Horizontal y Desnivel
    const DH = envSD * Math.sin(V_rad);
    const DV = envSD * Math.cos(V_rad);

    // 4. Coordenadas Tridimensionales
    const Norte_Nuevo = station.N + (DH * Math.cos(Azimut_rad));
    const Este_Nuevo = station.E + (DH * Math.sin(Azimut_rad));
    const Cota_Nueva = station.Z + station.HI + DV - currentHR;

    // 5. Guardado en la memoria de la estación con PTO alfanumérico
    const nuevoPunto: TopoPoint = {
      PTO: currentPTO,
      N: parseFloat(Norte_Nuevo.toFixed(3)),
      E: parseFloat(Este_Nuevo.toFixed(3)),
      Z: parseFloat(Cota_Nueva.toFixed(3)),
      CD: currentCD.trim() || 'PTO',
      type: 'radial',
      date: new Date().toLocaleTimeString()
    };
    setPoints(prev => [...prev, nuevoPunto]);
    playLaserBeep();

    // 6. Auto-incremento inteligente del PTO si termina en número
    const proxPTO = incrementPointId(currentPTO);
    setTarget(prev => ({ ...prev, PTO: proxPTO, CD: currentCD, HR: currentHR }));
    if (activeField === 0) setInputBuffer(proxPTO);

    setObsMeasured(false);
    setObsShotFlash(true);
    setTimeout(() => setObsShotFlash(false), 350);
  }, [activeField, inputBuffer, envHD, envV, envSD, azimutInicial, station, target, playLaserBeep]);

  // [AUTO]: mide la distancia (animación Dist) y registra el punto automáticamente
  const ejecutarLevantamientoAuto = useCallback(() => {
    startMeasurement(() => {
      leerDistanciometro();
      registrarPuntoObservado();
    });
  }, [startMeasurement, leerDistanciometro, registrarPuntoObservado]);

  // =========================================================================
  // 7. BOTONERA FÍSICA Y MÁQUINA DE ESTADOS TOPCON
  // =========================================================================

  // Tecla física [SFT]: Cicla entre Prisma, Tarjeta y Lectura Directa
  // Tecla física [SHIFT]: en campos de texto cambia el modo de entrada NUM -> ALF -> SIM
  // (el reflector EDM ahora se cambia en la pantalla EDM, como en el equipo real)
  const handleShiftPress = useCallback(() => {
    playBeep(1200, 0.05);
    overrideRef.current?.shift();
  }, [playBeep]);

  // Tecla física [FUNC]: Alterna páginas de MED (Pág 1/2/3), Estacionamiento (Pág 1 / Pág 2) o Pantalla Principal (Pág 1 / Pág 2)
  const handleFuncPress = useCallback(() => {
    playBeep(1200, 0.05);
    if (overrideRef.current?.func()) return;
    if (screenState === 'MED') {
      setMedPage(p => (p === 1 ? 2 : p === 2 ? 3 : 1));
    } else if (screenState === 'OCC_ORIEN') {
      setOccPage(p => (p === 1 ? 2 : 1));
    } else if (screenState === 'MAIN') {
      setMainPage(p => (p === 1 ? 2 : 1));
    } else {
      setIsBacklightOn(b => !b);
    }
  }, [screenState, playBeep]);

  // Teclado físico numérico y de símbolos
  const handleKeypadPress = useCallback((key: string) => {
    playBeep(1150, 0.04);
    if (overrideRef.current?.key(key)) return;

    // Acceso numérico rápido desde ROOT
    if (screenState === 'ROOT') {
      if (key === '1') { setScreenState('MED'); setMedPage(1); }
      else if (key === '3') { setScreenState('DATO_MENU'); setMenuSelection(1); }
      return;
    }

    // Selección numérica en menú COORD
    if (screenState === 'COORD_MENU') {
      if (key === '1') { setScreenState('OCC_ORIEN'); setActiveField(0); setOccPage(1); }
      else if (key === '2') { setScreenState('OBS'); setActiveField(0); }
      return;
    }

    // Manejo de buffer de búsqueda en OCC_LOAD_SEARCH
    if (screenState === 'OCC_LOAD_SEARCH') {
      if (key === 'BS') {
        setOccSearchBuffer(prev => prev.slice(0, -1));
      } else {
        setOccSearchBuffer(prev => prev + key);
      }
      return;
    }

    // Selección numérica en menú TRISEC
    if (screenState === 'OCC_TRISEC') {
      if (key === '1') setTrisecSelection(1);
      else if (key === '2') {
        // Al seleccionar YXZ con Enter o tecla 2, retorna a la gráfica ComPen
        setScreenState('COMPEN');
      } else if (key === '3') setTrisecSelection(3);
      else if (key === '4') setTrisecSelection(4);
      return;
    }

    // Selección numérica en menú DATO (1. TRABAJO, 2. DATOS CONOCIDOS)
    if (screenState === 'DATO_MENU') {
      if (key === '1') { setScreenState('JOB_MENU'); setJobMenuSelection(1); }
      else if (key === '2') { setScreenState('KNOWN_MENU'); setKnownMenuSelection(1); }
      return;
    }

    // 2. Submenú DATOS CONOCIDOS: 3 opciones numéricas
    if (screenState === 'KNOWN_MENU') {
      if (key === '1') {
        setScreenState('KNOWN_INPUT');
        setActiveField(0);
        setInputBuffer(knownCoordsInput.Y);
      } else if (key === '2') {
        setScreenState('KNOWN_DEL');
        setSelectedKnownIdx(0);
      } else if (key === '3') {
        setScreenState('KNOWN_VIEW');
        setViewKnownIdx(0);
      }
      return;
    }

    // 1. Submenú TRABJ: 5 opciones numéricas
    if (screenState === 'JOB_MENU') {
      if (key === '1') { setScreenState('JOB_SELECT'); }
      else if (key === '2') { setScreenState('JOB_DETAILS'); setInputBuffer(jobName.replace(/^\*/, '')); }
      else if (key === '3') { setScreenState('JOB_DELETE_LIST'); setSelectedJobIdx(0); }
      else if (key === '4') { setLcdMessage('SALIDA COMUNIC:\nENVIANDO DATOS RS-232C'); }
      else if (key === '5') { setLcdMessage('CONFIG. COMUNIC:\nBAUD: 1200\nPARIDAD: NONE'); }
      return;
    }

    // Selección numérica en menú USB (Pantalla 1: 1. Tipo T, 2. Tipo S)
    if (screenState === 'USB_MENU') {
      if (key === '1') {
        setUsbTypeMode('T');
        setUsbMenuSelection(1);
        setScreenState('USB_TTYPE');
        setUsbTTypeSelection(1);
      } else if (key === '2') {
        setUsbTypeMode('S');
        setUsbMenuSelection(2);
        setScreenState('USB_TTYPE');
        setUsbTTypeSelection(1);
      }
      return;
    }

    // Selección numérica en USB Tipo T (Pantalla 2: 5 opciones)
    if (screenState === 'USB_TTYPE') {
      if (key === '1') { setScreenState('USB_SAVE_JOB'); setSelectedJobIdx(0); }
      else if (key === '2') { setUsbTTypeSelection(2); setLcdMessage('CARGAR PTO.CONOC:\nDISPOSITIVO NO CONECTADO'); }
      else if (key === '3') { setUsbTTypeSelection(3); setLcdMessage('GUARDAR CODIGO:\nSIN CODIGOS EXTERNOS'); }
      else if (key === '4') { setUsbTTypeSelection(4); setLcdMessage('CARGAR CODIGO:\nDISPOSITIVO NO CONECTADO'); }
      else if (key === '5') { setUsbTTypeSelection(5); setLcdMessage('ESTADO DE FICH.:\nMEMORIA USB LISTA'); }
      return;
    }

    // Selección numérica en DESPLZ_MENU (5 opciones)
    if (screenState === 'DESPLZ_MENU') {
      if (key === '1') { setScreenState('OCC_ORIEN'); setActiveField(0); setOccPage(1); }
      else if (['2', '3', '4', '5'].includes(key)) {
        setDesplzMenuSelection(parseInt(key));
        setLcdMessage('DESPLZ:\nEN DESARROLLO');
      }
      return;
    }

    // Selección numérica en formato USB (4 formatos)
    if (screenState === 'USB_FORMAT') {
      if (key === '1') setUsbFormatSelection(1);
      else if (key === '2') setUsbFormatSelection(2);
      else if (key === '3') setUsbFormatSelection(3);
      else if (key === '4') setUsbFormatSelection(4);
      return;
    }

    // Selección numérica en REPLANTEO_MENU
    if (screenState === 'REPLANTEO_MENU') {
      if (key === '1') { setScreenState('OCC_ORIEN'); setActiveField(0); setOccPage(1); }
      else if (key === '2') { setScreenState('REPL_DATA'); setReplDisplayMode('COORD'); }
      else if (key === '3') { setScreenState('OBS'); setActiveField(0); }
      else if (key === '4') { setPrevScreenBeforeEdm('REPLANTEO_MENU'); setScreenState('EDM_MENU'); }
      return;
    }

    // Selección numérica en TOPO_MENU
    if (screenState === 'TOPO_MENU') {
      if (key === '1') { setScreenState('OBS'); setActiveField(0); }
      else if (key === '2') { setScreenState('TOPO_NOTA'); }
      else if (key === '3') { setScreenState('TOPO_VER'); setTopoVerPage(1); }
      else if (key === '4') { setLcdMessage('BORRAR TOPO:\nSIN REGISTROS'); }
      return;
    }

    if (
      screenState === 'TILT' ||
      screenState === 'MED' ||
      screenState === 'COMPEN' ||
      screenState === 'MAIN' ||
      screenState === 'GRAPHIC_MENU' ||
      screenState === 'REPL_DATA' ||
      screenState === 'TOPO_NOTA' ||
      screenState === 'TOPO_VER' ||
      screenState === 'OCC_LOAD_LIST' ||
      screenState === 'KNOWN_DEL' ||
      screenState === 'KNOWN_DEL_CONFIRM' ||
      screenState === 'KNOWN_VIEW' ||
      screenState === 'KNOWN_PTS' ||
      screenState === 'SELECT_KNOWN_PT' ||
      screenState === 'CHECK_BS' ||
      screenState === 'CHECK_BS_DIST' ||
      screenState === 'JOB_SELECT' ||
      screenState === 'JOB_LIST' ||
      screenState === 'JOB_DELETE_LIST' ||
      screenState === 'JOB_DELETE_CONFIRM' ||
      screenState === 'USB_SAVE_JOB' ||
      screenState === 'EDM_MENU'
    ) return;

    if (key === 'BS') {
      setInputBuffer(prev => prev.slice(0, -1));
    } else if (key === '-') {
      setInputBuffer(prev => prev + '-');
    } else if (key === '.') {
      if (!inputBuffer.includes('.')) {
        setInputBuffer(prev => prev + '.');
      }
    } else {
      setInputBuffer(prev => prev + key);
    }
  }, [screenState, inputBuffer, jobName, knownCoordsInput, playBeep]);

  // Botón físico central AZUL: ENTER
  const handleEnterPress = useCallback(() => {
    playBeep(1450, 0.07);
    if (overrideRef.current?.enter()) return;
    if (isStarMenuOpen) {
      setIsStarMenuOpen(false);
      return;
    }
    commitCurrentField();

    // Arranque
    if (screenState === 'TILT') {
      setScreenState('ROOT');
      return;
    }

    // Pantalla ROOT
    if (screenState === 'ROOT') {
      setScreenState('MED');
      setMedPage(1);
      return;
    }

    // Pantalla COMPEN (Compensador AZ-0)
    if (screenState === 'COMPEN') {
      setScreenState('MED');
      return;
    }

    // Pantalla MED
    if (screenState === 'MED') {
      if (medPage === 3) {
        setScreenState('COORD_MENU');
        setMenuSelection(1);
      } else {
        setIsMeasuring(true);
        setTimeout(() => { setIsMeasuring(false); playLaserBeep(); }, 350);
      }
      return;
    }

    // Menú Gráfico Principal
    if (screenState === 'GRAPHIC_MENU') {
      const item = GRAPHIC_MENU_ITEMS[graphicMenuIdx];
      if (item.id === 'coord') {
        setScreenState('COORD_MENU');
        setMenuSelection(1);
      } else if (item.id === 'replanteo') {
        setScreenState('REPLANTEO_MENU');
        setReplMenuSelection(1);
      } else if (item.id === 'topo') {
        setScreenState('TOPO_MENU');
        setTopoMenuSelection(1);
      } else if (item.id === 'desplz') {
        setScreenState('DESPLZ_MENU');
        setDesplzMenuSelection(1);
      } else if (item.id === 'mdr') {
        setLcdMessage('MEDICIÓN DIST.\nREMOTA (MDR)');
      } else if (item.id === 'calc_area') {
        setLcdMessage('CÁLCULO DE ÁREA:\nSELECCIONE VÉRTICES');
      } else if (item.id === 'repl_linea') {
        setLcdMessage('REPLANTEO LÍNEA:\nDEFINA LÍNEA BASE');
      } else if (item.id === 'repl_arco') {
        setLcdMessage('REPLANTEO ARCO:\nDEFINA RADIO Y ARCO');
      } else if (item.id === 'proyecto_p') {
        setLcdMessage('PROYECCIÓN PTO:\nPLANO DE REF.');
      } else if (item.id === 'pt_a_linea') {
        setLcdMessage('DIST PTO A LÍNEA:\nSELECCIONE EJE');
      } else if (item.id === 'poligonal') {
        setLcdMessage('POLIGONAL:\nCÁLCULO Y AJUSTE');
      } else if (item.id === 'vial') {
        setLcdMessage('DISEÑO VIAL:\nEJE Y SECCIONES');
      } else if (item.id === 'per_trans') {
        setLcdMessage('PERFIL TRANSVERSAL:\nESTACIÓN Y TALUD');
      }
      return;
    }

    // Menú RePlanteo
    if (screenState === 'REPLANTEO_MENU') {
      if (replMenuSelection === 1) {
        setScreenState('OCC_ORIEN');
        setActiveField(0);
        setOccPage(1);
      } else if (replMenuSelection === 2) {
        setScreenState('REPL_DATA');
        setReplDisplayMode('COORD');
      } else if (replMenuSelection === 3) {
        setScreenState('OBS');
        setActiveField(0);
      } else if (replMenuSelection === 4) {
        setPrevScreenBeforeEdm('REPLANTEO_MENU');
        setScreenState('EDM_MENU');
      }
      return;
    }

    // Datos de RePlant.: Pulsar OK o ENTER lleva a ComPen
    if (screenState === 'REPL_DATA') {
      setScreenState('COMPEN');
      return;
    }

    // Menú TOPO
    if (screenState === 'TOPO_MENU') {
      if (topoMenuSelection === 1) {
        setScreenState('OBS');
        setActiveField(0);
      } else if (topoMenuSelection === 2) {
        setScreenState('TOPO_NOTA');
      } else if (topoMenuSelection === 3) {
        setScreenState('TOPO_VER');
        setTopoVerPage(1);
      } else if (topoMenuSelection === 4) {
        setLcdMessage('BORRAR TOPO:\nSIN REGISTROS');
      }
      return;
    }

    // TOPO Nota
    if (screenState === 'TOPO_NOTA') {
      setScreenState('TOPO_MENU');
      setLcdMessage('NOTA GUARDADA');
      return;
    }

    // TOPO Ver
    if (screenState === 'TOPO_VER') {
      setScreenState('TOPO_MENU');
      return;
    }

    // Menú COORD
    if (screenState === 'COORD_MENU') {
      if (menuSelection === 1) {
        setScreenState('OCC_ORIEN');
        setActiveField(0);
        setOccPage(1);
      } else {
        setScreenState('OBS');
        setActiveField(0);
      }
      return;
    }

    // Carga de puntos en Occ.Orien
    if (screenState === 'OCC_LOAD_LIST') {
      cargarPuntoSeleccionado();
      return;
    }

    // Búsqueda de punto
    if (screenState === 'OCC_LOAD_SEARCH') {
      handleOccSearchConfirm();
      return;
    }

    // Pantalla ACLE.R: retorna a ComPen
    if (screenState === 'OCC_ACLER') {
      setScreenState('COMPEN');
      return;
    }

    // Pantalla TRISEC
    if (screenState === 'OCC_TRISEC') {
      if (trisecSelection === 2) {
        // Al seleccionar YXZ con Enter, retorna a la gráfica ComPen
        setScreenState('COMPEN');
      } else {
        setLcdMessage('TRISEC SELECCIONADA');
      }
      return;
    }

    // Menú DATO
    if (screenState === 'DATO_MENU') {
      if (menuSelection === 1) {
        setScreenState('JOB_MENU');
        setJobMenuSelection(1);
      } else if (menuSelection === 2) {
        setScreenState('KNOWN_MENU');
        setKnownMenuSelection(1);
      }
      return;
    }

    // 2. Submenú DATOS CONOCIDOS
    if (screenState === 'KNOWN_MENU') {
      if (knownMenuSelection === 1) {
        setScreenState('KNOWN_INPUT');
        setActiveField(0);
        setInputBuffer(knownCoordsInput.Y);
      } else if (knownMenuSelection === 2) {
        setScreenState('KNOWN_DEL');
        setSelectedKnownIdx(0);
      } else if (knownMenuSelection === 3) {
        setScreenState('KNOWN_VIEW');
        setViewKnownIdx(0);
      }
      return;
    }

    // 3. Entrada Coords (Y -> X -> Z -> PTO -> Bucle continuo)
    if (screenState === 'KNOWN_INPUT') {
      if (activeField < 3) {
        setActiveField(f => f + 1);
      } else {
        guardarPuntoConocidoYBucle();
      }
      return;
    }

    // Borrar Coords
    if (screenState === 'KNOWN_DEL') {
      if (knownPoints.length > 0) {
        setScreenState('KNOWN_DEL_CONFIRM');
      }
      return;
    }

    // Confirmación de Borrado Coords
    if (screenState === 'KNOWN_DEL_CONFIRM') {
      const targetPto = knownPoints[selectedKnownIdx]?.PTO;
      setKnownPoints(prev => prev.filter((_, idx) => idx !== selectedKnownIdx));
      setSelectedKnownIdx(0);
      playLaserBeep();
      setLcdMessage(`PTO ${targetPto}\nBORRADO`);
      setTimeout(() => {
        setScreenState('KNOWN_DEL');
      }, 1000);
      return;
    }

    // Ver Coords
    if (screenState === 'KNOWN_VIEW') {
      setScreenState('KNOWN_MENU');
      return;
    }

    // 1. Submenú TRABJ: 5 opciones
    if (screenState === 'JOB_MENU') {
      if (jobMenuSelection === 1) {
        setScreenState('JOB_SELECT');
      } else if (jobMenuSelection === 2) {
        setScreenState('JOB_DETAILS');
        setInputBuffer(jobName.replace(/^\*/, ''));
      } else if (jobMenuSelection === 3) {
        setScreenState('JOB_DELETE_LIST');
        setSelectedJobIdx(0);
      } else if (jobMenuSelection === 4) {
        setLcdMessage('SALIDA COMUNIC:\nENVIANDO DATOS RS-232C');
      } else if (jobMenuSelection === 5) {
        setLcdMessage('CONFIG. COMUNIC:\nBAUD: 1200\nPARIDAD: NONE');
      }
      return;
    }

    // 2. Selec TRABJ
    if (screenState === 'JOB_SELECT') {
      setScreenState('JOB_MENU');
      return;
    }

    // 2. Lista de TRABJ
    if (screenState === 'JOB_LIST') {
      const selected = jobsList[selectedJobIdx] || '*PROYECTO01';
      const clean = selected.replace(/^\*/, '');
      if (jobSelectField === 0) {
        setJobName(clean);
        playLaserBeep();
        setLcdMessage(`TRABJ SELECCIONADO:\n${selected}`);
      } else {
        setCoordJobName(clean);
        playLaserBeep();
        setLcdMessage(`BUSCA COORD TRABJ:\n${selected}`);
      }
      setTimeout(() => {
        setLcdMessage(null);
        setScreenState('JOB_SELECT');
      }, 1000);
      return;
    }

    // 3. Detalles de TRABJ
    if (screenState === 'JOB_DETAILS') {
      const clean = inputBuffer.trim() || 'PROYECTO01';
      const oldClean = jobName.replace(/^\*/, '');
      setJobName(clean);
      setJobsList(prev =>
        prev.map(j => (j.replace(/^\*/, '') === oldClean ? (j.startsWith('*') ? `*${clean}` : clean) : j))
      );
      playLaserBeep();
      setLcdMessage(`DETALLES GUARDADOS:\n${clean}`);
      setTimeout(() => {
        setLcdMessage(null);
        setScreenState('JOB_MENU');
      }, 1200);
      return;
    }

    // 4. Borrar TRABJ - Selección de trabajo en lista con [ENT]
    if (screenState === 'JOB_DELETE_LIST') {
      const target = jobsList[selectedJobIdx];
      if (target) {
        setJobDeleteTarget(target);
        setScreenState('JOB_DELETE_CONFIRM');
      }
      return;
    }

    // 4. Borrar TRABJ - Confirmación de borrado con [ENT] o F4=[SI]
    // LÓGICA ESTRICTA: El trabajo NO se elimina de la lista principal.
    // Se borran únicamente los datos de puntos del trabajo y se revierte al nombre original por defecto (JOB01..JOB10).
    if (screenState === 'JOB_DELETE_CONFIRM') {
      const target = jobDeleteTarget || jobsList[selectedJobIdx];
      if (target) {
        const defaultSlotName = `JOB${String(selectedJobIdx + 1).padStart(2, '0')}`;
        setJobsList(prev => {
          const nextList = [...prev];
          nextList[selectedJobIdx] = defaultSlotName;
          return nextList;
        });
        if (jobName.replace(/^\*/, '') === target.replace(/^\*/, '')) {
          setJobName(defaultSlotName);
          setPoints([]);
        }
        if (coordJobName.replace(/^\*/, '') === target.replace(/^\*/, '')) {
          setCoordJobName(defaultSlotName);
        }
        playLaserBeep();
        setLcdMessage(`${target.replace(/^\*/, '')}\nBORRADO`);
        setTimeout(() => {
          setLcdMessage(null);
          setScreenState('JOB_DELETE_LIST');
        }, 1000);
      }
      return;
    }

    // Guardar nombre de Trabajo
    if (screenState === 'JOB') {
      const clean = inputBuffer.trim() || 'PROYECTO1';
      setJobName(clean);
      playLaserBeep();
      setLcdMessage(`TRABAJO FIJADO:\n${clean}`);
      setTimeout(() => {
        setScreenState('DATO_MENU');
      }, 1200);
      return;
    }

    // Visor de Datos Conocidos
    if (screenState === 'KNOWN_PTS') {
      setScreenState('DATO_MENU');
      return;
    }

    // 1. Guardar nueva base en KNOWN_NEW
    if (screenState === 'KNOWN_NEW') {
      if (activeField < 4) {
        setActiveField(f => f + 1);
      } else {
        setKnownPoints(prev => [...prev, newKnownPoint]);
        playLaserBeep();
        setLcdMessage(`BASE ${newKnownPoint.PTO}\nGUARDADA EN MEMORIA`);
        setTimeout(() => {
          setScreenState('KNOWN_PTS');
          setViewKnownIdx(knownPoints.length);
        }, 1200);
      }
      return;
    }

    // 2. Cargar base seleccionada con [CARG] o [ENT]
    if (screenState === 'SELECT_KNOWN_PT') {
      const selected = knownPoints[viewKnownIdx];
      if (selected) {
        playLaserBeep();
        if (readTargetContext === 'OCC') {
          setStation(s => ({
            ...s,
            PTO: selected.PTO,
            N: selected.N,
            E: selected.E,
            Z: selected.Z
          }));
          if (selected.CD) {
            setStationAtm(a => ({ ...a, CD: selected.CD }));
          }
          setLcdMessage(`PTO ${selected.PTO}\nCARGADO EN Y0,X0,Z0`);
          setTimeout(() => {
            setScreenState('OCC_ORIEN');
            setActiveField(4); // Pasa a Altura Instrumento HI
          }, 1000);
        } else {
          setBacksight({
            N: selected.N,
            E: selected.E,
            Z: selected.Z,
            PTO: selected.PTO
          });
          setLcdMessage(`PTO ${selected.PTO}\nCARGADO EN Yref,Xref,Zref`);
          setTimeout(() => {
            setScreenState('ERXYZ');
            setActiveField(3); // Pasa a PTO
          }, 1000);
        }
      }
      return;
    }

    // Formulario de Estacionamiento (Y0, X0, Z0, PTO, HI)
    if (screenState === 'OCC_ORIEN') {
      commitCurrentField();
      if (activeField < 4) {
        setActiveField(f => f + 1);
      } else {
        setActiveField(0);
        setLcdMessage('DATOS ESTACIÓN\nGUARDADOS');
      }
      return;
    }

    // Formulario de Orientación: lanza comprobación (AZ, HA-D, Acim)
    if (screenState === 'ERXYZ') {
      if (activeField < 3) {
        setActiveField(f => f + 1);
      } else {
        prepararComprobacionOrientacion();
      }
      return;
    }

    // 4. Confirmación de Orientación
    if (screenState === 'CHECK_BS') {
      ejecutarOrientacionFinal();
      return;
    }

    // 5. Confirmación desde Ref.DisH ver
    if (screenState === 'CHECK_BS_DIST') {
      ejecutarOrientacionFinal();
      return;
    }

    // Observación: ENTER confirma campo editado
    if (screenState === 'OBS') {
      commitCurrentField();
      if (activeField === 1) {
        setActiveField(0);
      }
      return;
    }

    // Menú EDM
    if (screenState === 'EDM_MENU') {
      cycleEdmReflector();
      return;
    }

    // Menú DESPLZ
    if (screenState === 'DESPLZ_MENU') {
      if (desplzMenuSelection === 1) {
        setScreenState('OCC_ORIEN');
        setActiveField(0);
        setOccPage(1);
      } else {
        setLcdMessage('DESPLZ:\nEN DESARROLLO');
      }
      return;
    }

    // Menú USB: Pantalla 1 (Tipo T / Tipo S)
    if (screenState === 'USB_MENU') {
      if (usbMenuSelection === 1) {
        setUsbTypeMode('T');
        setScreenState('USB_TTYPE');
        setUsbTTypeSelection(1);
      } else {
        setUsbTypeMode('S');
        setScreenState('USB_TTYPE');
        setUsbTTypeSelection(1);
      }
      return;
    }

    // Menú USB: Pantalla 2 (Tipo T - 5 opciones)
    if (screenState === 'USB_TTYPE') {
      if (usbTTypeSelection === 1) {
        setScreenState('USB_SAVE_JOB');
        setSelectedJobIdx(0);
      } else if (usbTTypeSelection === 2) {
        setLcdMessage('CARGAR PTO.CONOC:\nDISPOSITIVO NO CONECTADO');
      } else if (usbTTypeSelection === 3) {
        setLcdMessage('GUARDAR CODIGO:\nSIN CODIGOS EXTERNOS');
      } else if (usbTTypeSelection === 4) {
        setLcdMessage('CARGAR CODIGO:\nDISPOSITIVO NO CONECTADO');
      } else if (usbTTypeSelection === 5) {
        setLcdMessage('ESTADO DE FICH.:\nMEMORIA USB LISTA');
      }
      return;
    }

    // Selección de Trabajo para USB
    if (screenState === 'USB_SAVE_JOB') {
      const selected = jobsList[selectedJobIdx] || jobName || 'PROYECTO1';
      setUsbSelectedJob(selected);
      setScreenState('USB_FORMAT');
      setUsbFormatSelection(1);
      return;
    }

    // Formatos de Exportación USB: GTS(Obs), GTS(Coord), SSS(Obs), SSS(Coord)
    if (screenState === 'USB_FORMAT') {
      if (usbFormatSelection === 4) {
        // Solo cuando el usuario baja hasta SSS(Coord) y presiona [ENT], se ejecuta exportarAUSB
        exportarAUSB(usbSelectedJob);
      } else {
        setLcdMessage('FORMATO NO DISP.\nBAJE A 4. SSS(Coord)');
      }
      return;
    }
  }, [
    screenState,
    medPage,
    menuSelection,
    activeField,
    commitCurrentField,
    iniciarComprobacionOrientacion,
    ejecutarOrientacionFinal,
    exportarAUSB,
    inputBuffer,
    jobName,
    coordJobName,
    jobSelectField,
    jobsList,
    jobMenuSelection,
    selectedJobIdx,
    jobDeleteTarget,
    newKnownPoint,
    knownPoints,
    knownMenuSelection,
    knownCoordsInput,
    selectedKnownIdx,
    guardarPuntoConocidoYBucle,
    viewKnownIdx,
    readTargetContext,
    cargarPuntoSeleccionado,
    handleOccSearchConfirm,
    trisecSelection,
    graphicMenuIdx,
    GRAPHIC_MENU_ITEMS,
    replMenuSelection,
    topoMenuSelection,
    handleShiftPress,
    usbMenuSelection,
    usbTTypeSelection,
    desplzMenuSelection,
    isStarMenuOpen,
    cycleEdmReflector,
    usbSelectedJob,
    usbFormatSelection,
    playBeep,
    playLaserBeep
  ]);

  // Botón físico ESC (Al pulsar repetidamente desde cualquier estado, llega a 'ROOT')
  const handleEscPress = useCallback(() => {
    playBeep(900, 0.07);
    if (overrideRef.current?.esc()) return;
    if (isStarMenuOpen) {
      setIsStarMenuOpen(false);
      return;
    }
    commitCurrentField();
    setLcdMessage(null);

    if (screenState === 'ROOT') {
      // Ya estamos en la raíz (ROOT); se mantiene
      return;
    } else if (screenState === 'MED') {
      setScreenState('ROOT');
    } else if (screenState === 'COMPEN') {
      setScreenState('MED');
    } else if (screenState === 'MAIN') {
      setScreenState('ROOT');
    } else if (screenState === 'DATO_MENU') {
      setScreenState('ROOT');
    } else if (screenState === 'KNOWN_MENU') {
      setScreenState('DATO_MENU');
    } else if (screenState === 'KNOWN_INPUT') {
      setScreenState('KNOWN_MENU');
    } else if (screenState === 'KNOWN_DEL') {
      setScreenState('KNOWN_MENU');
    } else if (screenState === 'KNOWN_DEL_CONFIRM') {
      setScreenState('KNOWN_DEL');
    } else if (screenState === 'KNOWN_VIEW') {
      setScreenState('KNOWN_MENU');
    } else if (screenState === 'JOB_MENU') {
      setScreenState('DATO_MENU');
    } else if (screenState === 'JOB_SELECT') {
      setScreenState('JOB_MENU');
    } else if (screenState === 'JOB_LIST') {
      setScreenState('JOB_SELECT');
    } else if (screenState === 'JOB_DETAILS') {
      setScreenState('JOB_MENU');
    } else if (screenState === 'JOB_DELETE_LIST') {
      setScreenState('JOB_MENU');
    } else if (screenState === 'JOB_DELETE_CONFIRM') {
      setScreenState('JOB_DELETE_LIST');
    } else if (screenState === 'JOB') {
      setScreenState('JOB_MENU');
    } else if (screenState === 'KNOWN_PTS') {
      setScreenState('DATO_MENU');
    } else if (screenState === 'KNOWN_NEW') {
      setScreenState('KNOWN_PTS');
    } else if (screenState === 'SELECT_KNOWN_PT') {
      setScreenState(readTargetContext === 'OCC' ? 'OCC_ORIEN' : 'ERXYZ');
    } else if (screenState === 'GRAPHIC_MENU') {
      setScreenState('MED');
    } else if (screenState === 'REPLANTEO_MENU') {
      setScreenState('GRAPHIC_MENU');
    } else if (screenState === 'REPL_DATA') {
      setScreenState('REPLANTEO_MENU');
    } else if (screenState === 'TOPO_MENU') {
      setScreenState('MED');
    } else if (screenState === 'TOPO_NOTA') {
      setScreenState('TOPO_MENU');
    } else if (screenState === 'TOPO_VER') {
      setScreenState('TOPO_MENU');
    } else if (screenState === 'COORD_MENU') {
      setScreenState('MED');
    } else if (screenState === 'OCC_LOAD_SEARCH') {
      setScreenState('OCC_LOAD_LIST');
    } else if (screenState === 'OCC_LOAD_LIST') {
      setScreenState('OCC_ORIEN');
    } else if (screenState === 'OCC_ACLER') {
      setScreenState('OCC_ORIEN');
    } else if (screenState === 'OCC_TRISEC') {
      setScreenState('OCC_ORIEN');
    } else if (screenState === 'OCC_ORIEN' || screenState === 'OBS') {
      setScreenState('COORD_MENU');
      setActiveField(0);
    } else if (screenState === 'ERXYZ') {
      setScreenState('OCC_ORIEN');
      setActiveField(0);
    } else if (screenState === 'CHECK_BS') {
      setScreenState('ERXYZ');
    } else if (screenState === 'CHECK_BS_DIST') {
      setScreenState('CHECK_BS');
    } else if (screenState === 'EDM_MENU') {
      setScreenState(prevScreenBeforeEdm || 'MED');
    } else if (screenState === 'DESPLZ_MENU') {
      setScreenState('MED');
    } else if (screenState === 'USB_FORMAT') {
      setScreenState('USB_SAVE_JOB');
    } else if (screenState === 'USB_SAVE_JOB') {
      setScreenState('USB_TTYPE');
    } else if (screenState === 'USB_TTYPE') {
      setScreenState('USB_MENU');
      setUsbMenuSelection(usbTypeMode === 'S' ? 2 : 1);
    } else if (screenState === 'USB_MENU') {
      setScreenState('ROOT');
    } else if (screenState === 'TILT') {
      setScreenState('ROOT');
    } else {
      setScreenState('ROOT');
    }
  }, [screenState, readTargetContext, prevScreenBeforeEdm, isStarMenuOpen, commitCurrentField, playBeep]);

  // Flechas direccionales en cruz
  const handleArrow = useCallback((dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT') => {
    playBeep(1050, 0.04);
    if (overrideRef.current?.arrow(dir)) return;
    commitCurrentField();

    if (screenState === 'GRAPHIC_MENU') {
      if (dir === 'UP' || dir === 'LEFT') {
        setGraphicMenuIdx(i => (i > 0 ? i - 1 : GRAPHIC_MENU_ITEMS.length - 1));
      }
      if (dir === 'DOWN' || dir === 'RIGHT') {
        setGraphicMenuIdx(i => (i < GRAPHIC_MENU_ITEMS.length - 1 ? i + 1 : 0));
      }
      return;
    }

    if (screenState === 'REPLANTEO_MENU') {
      if (dir === 'UP') setReplMenuSelection(s => (s > 1 ? s - 1 : 4));
      if (dir === 'DOWN') setReplMenuSelection(s => (s < 4 ? s + 1 : 1));
      return;
    }

    if (screenState === 'TOPO_MENU') {
      if (dir === 'UP') setTopoMenuSelection(s => (s > 1 ? s - 1 : 4));
      if (dir === 'DOWN') setTopoMenuSelection(s => (s < 4 ? s + 1 : 1));
      return;
    }

    if (screenState === 'TOPO_VER') {
      if (dir === 'UP' || dir === 'DOWN') {
        setTopoVerPage(p => (p === 1 ? 2 : 1));
      }
      return;
    }

    if (screenState === 'COORD_MENU') {
      if (dir === 'UP' || dir === 'DOWN') {
        setMenuSelection(prev => (prev === 1 ? 2 : 1));
      }
      return;
    }

    if (screenState === 'DATO_MENU') {
      if (dir === 'UP' || dir === 'DOWN') {
        setMenuSelection(prev => (prev === 1 ? 2 : 1));
      }
      return;
    }

    if (screenState === 'JOB_MENU') {
      if (dir === 'UP') setJobMenuSelection(prev => (prev > 1 ? prev - 1 : 5));
      if (dir === 'DOWN') setJobMenuSelection(prev => (prev < 5 ? prev + 1 : 1));
      return;
    }

    if (screenState === 'JOB_SELECT') {
      if (dir === 'UP' || dir === 'DOWN') setJobSelectField(f => (f === 0 ? 1 : 0));
      return;
    }

    if (screenState === 'JOB_LIST' || screenState === 'JOB_DELETE_LIST') {
      if (dir === 'UP' || dir === 'LEFT') {
        setSelectedJobIdx(i => (i > 0 ? i - 1 : Math.max(0, jobsList.length - 1)));
      }
      if (dir === 'DOWN' || dir === 'RIGHT') {
        setSelectedJobIdx(i => (i < jobsList.length - 1 ? i + 1 : 0));
      }
      return;
    }

    if (screenState === 'EDM_MENU') {
      cycleEdmReflector();
      return;
    }

    if (screenState === 'DESPLZ_MENU') {
      if (dir === 'UP') setDesplzMenuSelection(prev => (prev > 1 ? prev - 1 : 5));
      if (dir === 'DOWN') setDesplzMenuSelection(prev => (prev < 5 ? prev + 1 : 1));
      return;
    }

    if (screenState === 'USB_MENU') {
      if (dir === 'UP' || dir === 'DOWN') {
        setUsbMenuSelection(prev => (prev === 1 ? 2 : 1));
      }
      return;
    }

    if (screenState === 'USB_TTYPE') {
      if (dir === 'UP') setUsbTTypeSelection(prev => (prev > 1 ? prev - 1 : 5));
      if (dir === 'DOWN') setUsbTTypeSelection(prev => (prev < 5 ? prev + 1 : 1));
      return;
    }

    if (screenState === 'USB_SAVE_JOB') {
      if (dir === 'UP' || dir === 'LEFT') {
        setSelectedJobIdx(i => (i > 0 ? i - 1 : Math.max(0, jobsList.length - 1)));
      }
      if (dir === 'DOWN' || dir === 'RIGHT') {
        setSelectedJobIdx(i => (i < jobsList.length - 1 ? i + 1 : 0));
      }
      return;
    }

    if (screenState === 'USB_FORMAT') {
      if (dir === 'UP') setUsbFormatSelection(prev => (prev > 1 ? prev - 1 : 4));
      if (dir === 'DOWN') setUsbFormatSelection(prev => (prev < 4 ? prev + 1 : 1));
      return;
    }

    if (screenState === 'KNOWN_MENU') {
      if (dir === 'UP') setKnownMenuSelection(prev => (prev > 1 ? prev - 1 : 3));
      if (dir === 'DOWN') setKnownMenuSelection(prev => (prev < 3 ? prev + 1 : 1));
      return;
    }

    if (screenState === 'KNOWN_DEL') {
      if (dir === 'UP' || dir === 'LEFT') {
        setSelectedKnownIdx(i => (i > 0 ? i - 1 : Math.max(0, knownPoints.length - 1)));
      }
      if (dir === 'DOWN' || dir === 'RIGHT') {
        setSelectedKnownIdx(i => (i < knownPoints.length - 1 ? i + 1 : 0));
      }
      return;
    }

    if (screenState === 'KNOWN_VIEW' || screenState === 'KNOWN_PTS' || screenState === 'SELECT_KNOWN_PT') {
      if (dir === 'UP' || dir === 'LEFT') {
        setViewKnownIdx(i => (i > 0 ? i - 1 : Math.max(0, knownPoints.length - 1)));
      }
      if (dir === 'DOWN' || dir === 'RIGHT') {
        setViewKnownIdx(i => (i < knownPoints.length - 1 ? i + 1 : 0));
      }
      return;
    }

    if (screenState === 'OCC_LOAD_LIST') {
      if (dir === 'UP' || dir === 'LEFT') {
        setSelectedOccLoadIdx(i => (i > 0 ? i - 1 : Math.max(0, occLoadPoints.length - 1)));
      }
      if (dir === 'DOWN' || dir === 'RIGHT') {
        setSelectedOccLoadIdx(i => (i < occLoadPoints.length - 1 ? i + 1 : 0));
      }
      return;
    }

    if (screenState === 'OCC_TRISEC') {
      if (dir === 'UP') setTrisecSelection(s => (s > 1 ? s - 1 : 4));
      if (dir === 'DOWN') setTrisecSelection(s => (s < 4 ? s + 1 : 1));
      return;
    }

    if (screenState === 'KNOWN_INPUT') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 3));
      if (dir === 'DOWN') setActiveField(f => (f < 3 ? f + 1 : 0));
      return;
    }

    if (screenState === 'OCC_ORIEN') {
      if (dir === 'UP') {
        setActiveField(f => (f > 0 ? f - 1 : 4));
      }
      if (dir === 'DOWN') {
        setActiveField(f => (f < 4 ? f + 1 : 0));
      }
    } else if (screenState === 'ERXYZ') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 3));
      if (dir === 'DOWN') setActiveField(f => (f < 3 ? f + 1 : 0));
    } else if (screenState === 'KNOWN_NEW') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 4));
      if (dir === 'DOWN') setActiveField(f => (f < 4 ? f + 1 : 0));
    } else if (screenState === 'OBS') {
      if (dir === 'DOWN') setActiveField(1); // Flecha abajo muestra campo Cd
      if (dir === 'UP') setActiveField(0);   // Flecha arriba regresa a PTO
    }
  }, [screenState, knownPoints.length, jobsList.length, occLoadPoints.length, GRAPHIC_MENU_ITEMS.length, cycleEdmReflector, commitCurrentField, playBeep]);

  // Botones de función F1-F4 según la máquina de estados
  const handleFKey = useCallback((fNum: 1 | 2 | 3 | 4) => {
    playBeep(1300, 0.06);
    if (overrideRef.current?.fkey(fNum)) return;
    commitCurrentField();

    // Estado TILT (Compensador de arranque): F1=[OK]
    if (screenState === 'TILT') {
      if (fNum === 1) {
        setScreenState('ROOT');
      } else if (fNum === 4) {
        setIsOriented(false);
        setScreenState('ROOT');
      }
      return;
    }

    // Estado COMPEN (Compensador AZ-0 interactivo)
    if (screenState === 'COMPEN') {
      if (fNum === 1) {
        // [OK] -> Regresa a la pantalla MED
        setScreenState('MED');
      } else if (fNum === 2) {
        // [PLGETT]
        setLcdMessage('PLGETT: PLOMADA LÁSER\nNIVEL CALIBRADO');
      }
      return;
    }

    // 1. ESTADO ROOT (Raíz): F1=[OBS], F2=[USB], F3=[DATO], F4=[CNFG]
    if (screenState === 'ROOT') {
      if (fNum === 1) {
        // F1=[OBS] -> Acceso directo a la pantalla de Medición MED (Pág 1)
        setScreenState('MED');
        setMedPage(1);
      } else if (fNum === 2) {
        // F2=[USB] -> Menú USB
        setScreenState('USB_MENU');
        setUsbMenuSelection(2);
      } else if (fNum === 3) {
        // F3=[DATO] -> menú DATO
        setScreenState('DATO_MENU');
        setMenuSelection(1);
      } else if (fNum === 4) {
        // F4=[CNFG] -> Configuración
        setLcdMessage('CONFIGURACIÓN ES-105\nUNIDAD: DEG/METRO\nEDM: PRISMA');
      }
      return;
    }

    // 2. ESTADO MED (Medición): Pág 1, Pág 2, Pág 3
    if (screenState === 'MED') {
      if (showTaraSoftkey) {
        if (fNum === 4) {
          playLaserBeep();
          setShowTaraSoftkey(false);
          setLcdMessage('TARA APLICADA');
        }
        return;
      }

      if (medPage === 1) {
        // Pág 1: [MENU] (F1), [COMP] (F2), [RNG H] (F3), [EDM] (F4)
        if (fNum === 1) {
          setScreenState('GRAPHIC_MENU');
          setGraphicMenuIdx(0);
        } else if (fNum === 2) {
          // [COMP] -> Pantalla del Compensador ComPen
          setScreenState('COMPEN');
        } else if (fNum === 3) {
          setLcdMessage(`RANGO H RETENIDO:\n${formatDMS(envHD)}`);
        } else if (fNum === 4) {
          setPrevScreenBeforeEdm('MED');
          setScreenState('EDM_MENU');
        }
      } else if (medPage === 2) {
        // Pág 2: [MDR] (F1), [DESPLZ] (F2), [TOPO] (F3), [REPL] (F4)
        if (fNum === 1) {
          setIsMeasuring(true);
          playLaserBeep();
          setTimeout(() => { setIsMeasuring(false); }, 350);
        } else if (fNum === 2) {
          setScreenState('DESPLZ_MENU');
          setDesplzMenuSelection(1);
        } else if (fNum === 3) {
          // [TOPO] -> Flujo TOPO
          setScreenState('TOPO_MENU');
          setTopoMenuSelection(1);
        } else if (fNum === 4) {
          // [REPL] -> Flujo RePlanteo
          setScreenState('REPLANTEO_MENU');
          setReplMenuSelection(1);
        }
      } else {
        // Pág 3: [MED] (F1), [G V] (F2), [AZ-0] (F3), [COORD] (F4)
        if (fNum === 1) {
          // [MED]: Bip, parpadeo srapido momentáneo, y softkeys temporales [ , , , TARA]
          playBeep(1800, 0.12);
          setShowTaraSoftkey(true);
          setTimeout(() => {
              setShowTaraSoftkey(false);
          }, 1800);
        } else if (fNum === 2) {
          // [G V]
          const radV = envV * (Math.PI / 180);
          const az = ((azimutInicial + envHD) % 360) * (Math.PI / 180);
          const dh = envSD * Math.sin(radV);
          const n = station.N + dh * Math.cos(az);
          const e = station.E + dh * Math.sin(az);
          const z = station.Z + station.HI + envSD * Math.cos(radV) - target.HR;
          setLcdMessage(`COORD EN VIVO:\nN: ${n.toFixed(3)}\nE: ${e.toFixed(3)}\nZ: ${z.toFixed(3)}`);
        } else if (fNum === 3) {
          // [AZ-0] -> Acceso a Pantalla ComPen interactiva
          setScreenState('COMPEN');
        } else if (fNum === 4) {
          // [COORD] -> Menú de Coordenadas
          setScreenState('COORD_MENU');
          setMenuSelection(1);
        }
      }
      return;
    }

    // Pantalla Principal (Pág 1 y Pág 2 - compatibilidad)
    if (screenState === 'MAIN') {
      if (mainPage === 1) {
        // Pág 1: F1=[DIST], F2=[SHV], F3=[OSET], F4=[COORD]
        if (fNum === 1) {
          setIsMeasuring(true);
          setTimeout(() => { setIsMeasuring(false); playLaserBeep(); }, 350);
        } else if (fNum === 3) {
          setEnvHD(0);
          setLcdMessage('ÁNGULO HORIZONTAL\nSETEADO A 0°');
        } else if (fNum === 4) {
          setScreenState('COORD_MENU');
          setMenuSelection(1);
        }
      } else {
        // Pág 2: F1=[DATO], F2=[USB], F3=[TILT], F4=[COORD]
        if (fNum === 1) {
          setScreenState('DATO_MENU');
          setMenuSelection(1);
        } else if (fNum === 2) {
          // 3. Acceso al Menú USB desde Pág 2
          setScreenState('USB_MENU');
          setUsbMenuSelection(2);
        } else if (fNum === 3) {
          setScreenState('TILT');
        } else if (fNum === 4) {
          setScreenState('COORD_MENU');
          setMenuSelection(1);
        }
      }
      return;
    }

    // Menú COORD
    if (screenState === 'COORD_MENU') {
      if (fNum === 4) handleEnterPress();
      return;
    }

    // Menú DATO
    if (screenState === 'DATO_MENU') {
      if (fNum === 4) handleEnterPress();
      return;
    }

    // Menús USB y DESPLZ: F4=[ENT]
    if (screenState === 'USB_MENU' || screenState === 'USB_TTYPE' || screenState === 'DESPLZ_MENU') {
      if (fNum === 4) handleEnterPress();
      return;
    }

    // Selección de Trabajo en USB: F1=[ANT], F2=[SIG], F3=[ESC], F4=[ENT]
    if (screenState === 'USB_SAVE_JOB') {
      if (fNum === 1) {
        setSelectedJobIdx(i => (i >= 5 ? i - 5 : (i + 5 < jobsList.length ? i + 5 : i)));
      } else if (fNum === 2) {
        setSelectedJobIdx(i => (i < 5 ? (i + 5 < jobsList.length ? i + 5 : i) : i - 5));
      } else if (fNum === 3) {
        setScreenState('USB_TTYPE');
      } else if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // Selección de Formato USB: F3=[ESC], F4=[ENT]
    if (screenState === 'USB_FORMAT') {
      if (fNum === 3) {
        setScreenState('USB_SAVE_JOB');
      } else if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // 1. Submenú TRABJ: F4=[ENT]
    if (screenState === 'JOB_MENU') {
      if (fNum === 4) handleEnterPress();
      return;
    }

    // 2. Selec TRABJ: F1=[LIST], F4=[OK]
    if (screenState === 'JOB_SELECT') {
      if (fNum === 1) {
        setScreenState('JOB_LIST');
        const curTarget = jobSelectField === 0 ? jobName : coordJobName;
        const curIdx = jobsList.findIndex(j => j.replace(/^\*/, '') === curTarget.replace(/^\*/, ''));
        setSelectedJobIdx(curIdx >= 0 ? curIdx : 0);
      } else if (fNum === 4) {
        setScreenState('JOB_MENU');
      }
      return;
    }

    // 2. Lista visual de TRABJ: F1=[ANT], F2=[SIG], F3=[ESC], F4=[ENT]
    if (screenState === 'JOB_LIST') {
      if (fNum === 1) {
        setSelectedJobIdx(i => (i >= 5 ? i - 5 : (i + 5 < jobsList.length ? i + 5 : i)));
      } else if (fNum === 2) {
        setSelectedJobIdx(i => (i < 5 ? (i + 5 < jobsList.length ? i + 5 : i) : i - 5));
      } else if (fNum === 3) {
        setScreenState('JOB_SELECT');
      } else if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // 3. Detalles de TRABJ: F3=[NUM/ALF], F4=[OK]
    if (screenState === 'JOB_DETAILS') {
      if (fNum === 3) setIsAlphaKeyboardOpen(k => !k);
      else if (fNum === 4) handleEnterPress();
      return;
    }

    // 4. Borrar TRABJ - Lista: F1=[ANT], F2=[SIG], F3=[ESC], F4=[ENT]
    if (screenState === 'JOB_DELETE_LIST') {
      if (fNum === 1) {
        setSelectedJobIdx(i => (i >= 5 ? i - 5 : (i + 5 < jobsList.length ? i + 5 : i)));
      } else if (fNum === 2) {
        setSelectedJobIdx(i => (i < 5 ? (i + 5 < jobsList.length ? i + 5 : i) : i - 5));
      } else if (fNum === 3) {
        setScreenState('JOB_MENU');
      } else if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // 4. Borrar TRABJ - Confirmación: F3=[NO], F4=[SI]
    if (screenState === 'JOB_DELETE_CONFIRM') {
      if (fNum === 3) {
        setScreenState('JOB_DELETE_LIST');
      } else if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // Pantalla TRABAJO (compatibilidad)
    if (screenState === 'JOB') {
      if (fNum === 3) setIsAlphaKeyboardOpen(k => !k);
      else if (fNum === 4) handleEnterPress();
      return;
    }

    // Submenú DATOS CONOCIDOS
    if (screenState === 'KNOWN_MENU') {
      if (fNum === 4) handleEnterPress();
      return;
    }

    // 3. Interfaz de Entrada Coords (F4=[OK] dispara bucle y guarda)
    if (screenState === 'KNOWN_INPUT') {
      if (fNum === 3) {
        setIsAlphaKeyboardOpen(k => !k);
      } else if (fNum === 4) {
        guardarPuntoConocidoYBucle();
      }
      return;
    }

    // Borrar Coords
    if (screenState === 'KNOWN_DEL') {
      if (fNum === 1) {
        setSelectedKnownIdx(i => (i > 0 ? i - 1 : Math.max(0, knownPoints.length - 1)));
      } else if (fNum === 2) {
        setSelectedKnownIdx(i => (i < knownPoints.length - 1 ? i + 1 : 0));
      } else if (fNum === 3) {
        setScreenState('KNOWN_MENU');
      } else if (fNum === 4) {
        if (knownPoints.length > 0) setScreenState('KNOWN_DEL_CONFIRM');
      }
      return;
    }

    // Confirmación de Borrado Coords
    if (screenState === 'KNOWN_DEL_CONFIRM') {
      if (fNum === 3) {
        setScreenState('KNOWN_DEL');
      } else if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // Ver Coords
    if (screenState === 'KNOWN_VIEW') {
      if (fNum === 1) {
        setViewKnownIdx(i => (i > 0 ? i - 1 : Math.max(0, knownPoints.length - 1)));
      } else if (fNum === 2) {
        setViewKnownIdx(i => (i < knownPoints.length - 1 ? i + 1 : 0));
      } else if (fNum === 4) {
        setScreenState('KNOWN_MENU');
      }
      return;
    }

    // Visor de Datos Conocidos (KNOWN_PTS)
    if (screenState === 'KNOWN_PTS') {
      if (fNum === 1) {
        // 1. F1=[NUEV] -> Formulario para ingresar coordenadas base
        setNewKnownPoint({
          PTO: `BM-${knownPoints.length + 1}`,
          N: 1000.0,
          E: 1000.0,
          Z: 100.0,
          CD: 'BASE'
        });
        setActiveField(0);
        setInputBuffer(`BM-${knownPoints.length + 1}`);
        setScreenState('KNOWN_NEW');
      } else if (fNum === 2) {
        setViewKnownIdx(i => (i > 0 ? i - 1 : Math.max(0, knownPoints.length - 1)));
      } else if (fNum === 3) {
        setViewKnownIdx(i => (i < knownPoints.length - 1 ? i + 1 : 0));
      } else if (fNum === 4) {
        setScreenState('DATO_MENU');
      }
      return;
    }

    // Formulario de Nueva Base (KNOWN_NEW)
    if (screenState === 'KNOWN_NEW') {
      if (fNum === 3) setIsAlphaKeyboardOpen(k => !k);
      else if (fNum === 4) handleEnterPress();
      return;
    }

    // 2. Selector de Base [LEER]
    if (screenState === 'SELECT_KNOWN_PT') {
      if (fNum === 1) {
        setViewKnownIdx(i => (i > 0 ? i - 1 : Math.max(0, knownPoints.length - 1)));
      } else if (fNum === 2) {
        setViewKnownIdx(i => (i < knownPoints.length - 1 ? i + 1 : 0));
      } else if (fNum === 3) {
        setScreenState(readTargetContext === 'OCC' ? 'OCC_ORIEN' : 'ERXYZ');
      } else if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // Estacionamiento: F1=[CARG], F2=[ACLE.R], F3=[E.RXYZ], F4=[TRISEC]
    if (screenState === 'OCC_ORIEN') {
      if (fNum === 1) {
        // F1=[CARG] -> Flujo de Carga (listando PTO 1, PTO 2)
        setScreenState('OCC_LOAD_LIST');
        setSelectedOccLoadIdx(0);
      } else if (fNum === 2) {
        // F2=[ACLE.R] -> Pantalla de Configuración ACLE.R
        setInputBuffer('');
        setScreenState('OCC_ACLER');
      } else if (fNum === 3) {
        // F3=[E.RXYZ]
        setScreenState('ERXYZ');
        setActiveField(0);
      } else if (fNum === 4) {
        // F4=[TRISEC]
        setScreenState('OCC_TRISEC');
        setTrisecSelection(2);
      }
      return;
    }

    // Flujo de Carga: 1RO (F1), ULTIM (F2), BUSC (F3), (F4)
    if (screenState === 'OCC_LOAD_LIST') {
      if (fNum === 1) {
        setSelectedOccLoadIdx(0);
      } else if (fNum === 2) {
        setSelectedOccLoadIdx(Math.max(0, occLoadPoints.length - 1));
      } else if (fNum === 3) {
        setScreenState('OCC_LOAD_SEARCH');
        setOccSearchBuffer('');
      } else if (fNum === 4) {
        cargarPuntoSeleccionado();
      }
      return;
    }

    // Búsqueda de Punto: Softkeys: , , , OK (F4)
    if (screenState === 'OCC_LOAD_SEARCH') {
      if (fNum === 4) {
        handleOccSearchConfirm();
      }
      return;
    }

    // ACLE.R: Softkeys: REG (F1), , , OK (F4)
    if (screenState === 'OCC_ACLER') {
      if (fNum === 1) {
        playLaserBeep();
        setLcdMessage('PTO REF REGISTRADO');
      } else if (fNum === 4) {
        // Al pulsar OK, debe retornar a la pantalla gráfica ComPen
        setScreenState('COMPEN');
      }
      return;
    }

    // TRISEC: Softkeys: , , , ENT (F4)
    if (screenState === 'OCC_TRISEC') {
      if (fNum === 4) {
        if (trisecSelection === 2) {
          // Al seleccionar YXZ con Enter, retorna a la gráfica ComPen
          setScreenState('COMPEN');
        } else {
          setLcdMessage('TRISEC SELECCIONADA');
        }
      }
      return;
    }

    // Menú Gráfico Principal: Softkeys: , , , ENT
    if (screenState === 'GRAPHIC_MENU') {
      if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // RePlanteo Menú: Softkeys: , , , ENT
    if (screenState === 'REPLANTEO_MENU') {
      if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // Datos de RePlant.: Softkeys: CARG (F1), DISP (F2), (F3), OK (F4)
    if (screenState === 'REPL_DATA') {
      if (fNum === 1) {
        cargarPuntoSeleccionado();
      } else if (fNum === 2) {
        playLaserBeep();
        setReplDisplayMode(m => (m === 'COORD' ? 'DISP' : 'COORD'));
      } else if (fNum === 4) {
        // Pulsar OK lleva a ComPen
        setScreenState('COMPEN');
      }
      return;
    }

    // TOPO Menú: Softkeys: , , , ENT
    if (screenState === 'TOPO_MENU') {
      if (fNum === 4) {
        handleEnterPress();
      }
      return;
    }

    // TOPO Nota: Softkeys: , , , OK
    if (screenState === 'TOPO_NOTA') {
      if (fNum === 4) {
        setScreenState('TOPO_MENU');
        setLcdMessage('NOTA GUARDADA');
      }
      return;
    }

    // TOPO Ver: Softkeys: P-1 (F1), 1RO (F2), ULTIM (F3), BUSC (F4)
    if (screenState === 'TOPO_VER') {
      if (fNum === 1) {
        setTopoVerPage(p => (p === 1 ? 2 : 1));
      } else if (fNum === 2) {
        playBeep(1200, 0.05);
        setLcdMessage('1RO: PTO 165');
      } else if (fNum === 3) {
        playBeep(1200, 0.05);
        setLcdMessage('ULTIM: PTO 165');
      } else if (fNum === 4) {
        setLcdMessage('BUSCAR PTO:\n165');
      }
      return;
    }

    // Orientar Punto Atrás: F1=[CARG], F4=[OK] -> Comprobación
    if (screenState === 'ERXYZ') {
      if (fNum === 1) {
        setReadTargetContext('BS');
        setViewKnownIdx(0);
        setScreenState('SELECT_KNOWN_PT');
      } else if (fNum === 4) {
        prepararComprobacionOrientacion();
      }
      return;
    }

    // 4. Comprobación de Orientación: F1=[REG], F2=[MED], F3=[NO], F4=[SI]
    if (screenState === 'CHECK_BS') {
      if (fNum === 1) {
        ejecutarOrientacionFinal();
      } else if (fNum === 2) {
        iniciarMedicionDistanciaComprobacion();
      } else if (fNum === 3) {
        setScreenState('ERXYZ');
      } else if (fNum === 4) {
        ejecutarOrientacionFinal();
      }
      return;
    }

    // 5. Ref.DisH ver (Comprobación de distancia dDH): F1=[REG], F2=[ALT], F4=[OK]
    if (screenState === 'CHECK_BS_DIST') {
      if (fNum === 1) {
        ejecutarOrientacionFinal();
      } else if (fNum === 2) {
        iniciarMedicionDistanciaComprobacion();
      } else if (fNum === 4) {
        ejecutarOrientacionFinal();
      }
      return;
    }

    // Observación: [REG] [DESPLZ] [AUTO] [MED]
    if (screenState === 'OBS') {
      if (fNum === 1) {
        // [REG]: Registra el punto actual
        ejecutarLevantamientoAuto();
      } else if (fNum === 2) {
        // [DESPLZ]: Modo Desplazamiento
        setLcdMessage('MODO DESPLAZAMIENTO\n(OFFSET) ACTIVO');
      } else if (fNum === 3) {
        // [AUTO]: Disparo automático, guarda en points, bip, auto-incrementa PTO y sigue listo en pantalla
        ejecutarLevantamientoAuto();
      } else if (fNum === 4) {
        // [MED]: Medición de distancia
        setIsMeasuring(true);
        playLaserBeep();
        setTimeout(() => { setIsMeasuring(false); }, 350);
      }
      return;
    }
  }, [
    screenState,
    medPage,
    occPage,
    mainPage,
    showTaraSoftkey,
    occLoadPoints.length,
    cargarPuntoSeleccionado,
    handleOccSearchConfirm,
    trisecSelection,
    commitCurrentField,
    handleEnterPress,
    handleShiftPress,
    iniciarComprobacionOrientacion,
    ejecutarOrientacionFinal,
    ejecutarLevantamientoAuto,
    readTargetContext,
    knownPoints.length,
    envHD,
    envV,
    envSD,
    azimutInicial,
    station,
    target.HR,
    jobsList.length,
    jobDeleteTarget,
    guardarPuntoConocidoYBucle,
    playBeep,
    playLaserBeep
  ]);

  // =========================================================================
  // 8. CORRECCIONES DE USUARIO (12-10-2026): CAPA DE CONTROL DE PANTALLAS
  // -------------------------------------------------------------------------
  // Esta capa se ejecuta ANTES que los manejadores originales. Si una pantalla
  // corregida maneja la tecla, devuelve true y el manejador original no actúa.
  // Se reasigna en cada render (overrideRef) para trabajar siempre con el
  // estado actual, sin depender de las listas de dependencias de useCallback.
  // =========================================================================
  const STAR_MENU_ITEMS: { name: string; go: ScreenState }[] = [
    { name: 'Menu', go: 'GRAPHIC_MENU' },
    { name: 'Datos', go: 'DATO_MENU' },
    { name: 'ToPografia', go: 'TOPO_MENU' },
    { name: 'Coords', go: 'COORD_MENU' },
    { name: 'RePl', go: 'REPLANTEO_MENU' }
  ];

  // Escritura con el modo de entrada actual (NUM / ALF / SIM) y multi-pulsación
  const applyKeyToBuffer = (key: string, buf: string): string => {
    if (key === 'BS') return buf.slice(0, -1);
    if (key.startsWith('RAW:')) return buf + key.slice(4);
    if (inputMode === 'NUM') {
      if (key === '.' && buf.includes('.')) return buf;
      return buf + key;
    }
    const chars = KEY_CHARS[key]?.[inputMode];
    if (!chars) return buf + key;
    const now = Date.now();
    const lt = lastTapRef.current;
    if (lt.key === key && now - lt.time < 900 && chars.length > 1 && buf.length > 0) {
      const idx = (lt.idx + 1) % chars.length;
      lastTapRef.current = { key, time: now, idx };
      return buf.slice(0, -1) + chars[idx];
    }
    lastTapRef.current = { key, time: now, idx: 0 };
    return buf + chars[0];
  };

  const applyNumericKey = (key: string, buf: string): string => {
    if (key === 'BS') return buf.slice(0, -1);
    if (key === '-') return buf.startsWith('-') ? buf.slice(1) : `-${buf}`;
    if (key === '.') return buf.includes('.') ? buf : buf + '.';
    if (/^\d$/.test(key)) return buf + key;
    return buf;
  };

  const goCompen = (ctx: CompenContext, ret: ScreenState) => {
    setCompenCtx(ctx);
    setCompenReturn(ret);
    setScreenState('COMPEN');
  };

  const goObservacion = (ret: ScreenState) => {
    setObsReturn(ret);
    setObsMeasured(false);
    setActiveField(2); // El cursor arranca en HD (altura de prisma), como en el equipo
    setScreenState('OBS');
  };

  const openPicker = (ctx: PickContext) => {
    setPickCtx(ctx);
    setSelectedOccLoadIdx(0);
    setScreenState('OCC_LOAD_LIST');
  };

  const pickerReturnScreen = (ctx: PickContext): ScreenState =>
    ctx === 'OCC' ? 'OCC_ORIEN' : ctx === 'BS' ? 'ERXYZ' : ctx === 'REPL' ? 'REPL_DATA' : ctx === 'ANGH' ? 'GEN' : 'TOPO_MENU';

  const openEdm = (from: ScreenState) => {
    setPrevScreenBeforeEdm(from);
    setEdmField(0);
    setEdmBuffer('');
    setScreenState('EDM_MENU');
  };

  // Azimut y distancia horizontal desde la estación hacia un punto
  const calcAzDist = (p: { N: number; E: number }) => {
    const dN = p.N - station.N;
    const dE = p.E - station.E;
    let az = Math.atan2(dE, dN) * (180 / Math.PI);
    if (az < 0) az += 360;
    return { az, dist: Math.sqrt(dN * dN + dE * dE) };
  };

  const loadRecord = (rec: PointRecord, idx: number) => {
    playLaserBeep();
    if (pickCtx === 'OCC') {
      setStation(s => ({ ...s, N: rec.N, E: rec.E, Z: rec.Z, PTO: rec.PTO }));
      if (rec.CD) setStationAtm(a => ({ ...a, CD: rec.CD }));
      setLcdMessage(`${rec.tag} ${rec.PTO}\nCARGADO`);
      setTimeout(() => { setScreenState('OCC_ORIEN'); setActiveField(0); }, 900);
    } else if (pickCtx === 'BS') {
      setBacksight({ N: rec.N, E: rec.E, Z: rec.Z, PTO: rec.PTO });
      setLcdMessage(`${rec.tag} ${rec.PTO}\nCARGADO EN Estc. Ref.`);
      setTimeout(() => { setScreenState('ERXYZ'); setActiveField(0); }, 900);
    } else if (pickCtx === 'REPL') {
      const { az, dist } = calcAzDist(rec);
      setReplPoint({ PTO: rec.PTO, N: rec.N, E: rec.E, Z: rec.Z, CD: rec.CD });
      setReplDisp({ distH: parseFloat(dist.toFixed(3)), angH: az });
      setLcdMessage(`${rec.tag} ${rec.PTO}\nCARGADO EN REPLANTEO`);
      setTimeout(() => { setScreenState('REPL_DATA'); setReplDisplayMode('COORD'); setActiveField(0); }, 900);
    } else if (pickCtx === 'ANGH') {
      // ANG.H > Coord: el punto cargado pasa a ser la referencia (Xref, Yref, Zref)
      setCfg(c => ({ ...c, 'angRef.X': rec.E.toFixed(3), 'angRef.Y': rec.N.toFixed(3), 'angRef.Z': rec.Z.toFixed(3) }));
      setLcdMessage(`${rec.tag} ${rec.PTO}\nCARGADO`);
      setTimeout(() => setScreenState('GEN'), 900);
    } else {
      setVerDetailIdx(idx);
      setScreenState('VER_DETAIL');
    }
  };

  const buscarRegistro = () => {
    const q = occSearchBuffer.trim().toLowerCase();
    if (!q) {
      setLcdMessage('no hay datos');
      return;
    }
    const n = pointRecords.length;
    const matches = (r: PointRecord) => {
      const name = r.PTO.toLowerCase();
      return searchCriteria === 'Completo' ? name === q || name.replace(/^pto\s*/, '') === q : name.includes(q);
    };
    for (let step = 0; step < n; step++) {
      const i = searchDirection === '↓'
        ? (selectedOccLoadIdx + step) % n
        : (selectedOccLoadIdx - step + n) % n;
      if (matches(pointRecords[i])) {
        setSelectedOccLoadIdx(i);
        loadRecord(pointRecords[i], i);
        return;
      }
    }
    setLcdMessage('no hay datos');
  };

  // Campos de la página de Estacionamiento a la que pertenece cada índice (4 pantallas, 14 campos)
  const OCC_PAGES = [[0, 1, 2, 3, 4], [5, 6], [7, 8, 9, 10], [11, 12, 13]];
  const occPageOf = (f: number) => OCC_PAGES.findIndex(pg => pg.includes(f));

  const commitEdmField = () => {
    if (edmBuffer === '' || edmBuffer === '-') {
      setEdmBuffer('');
      return;
    }
    const v = parseFloat(edmBuffer);
    if (!isNaN(v)) {
      if (edmField === 2) setEdmCfg(c => ({ ...c, cp: Math.round(Math.max(-99, Math.min(99, v))) }));
      if (edmField === 5) setStationAtm(a => ({ ...a, temp: String(Math.max(-35, Math.min(60, v))) }));
      if (edmField === 6) setStationAtm(a => ({ ...a, pres: String(Math.round(Math.max(500, Math.min(1400, v)))) }));
      if (edmField === 7) setStationAtm(a => ({ ...a, ppm: String(Math.round(Math.max(-499, Math.min(499, v)))) }));
    }
    setEdmBuffer('');
  };

  const cycleOption = (list: string[], cur: string, dir: 1 | -1) => {
    const i = Math.max(0, list.indexOf(cur));
    return list[(i + dir + list.length) % list.length];
  };

  const setReflectorByName = (name: string) => {
    if (name === 'Prisma') { setEdmMode('prism'); setEdmReflector('Prisma'); }
    else if (name === 'Diana') { setEdmMode('sheet'); setEdmReflector('Diana'); }
    else { setEdmMode('non_prism'); setEdmReflector('N-Prism'); }
  };
  const currentReflectorName = edmMode === 'prism' ? 'Prisma' : edmMode === 'sheet' ? 'Diana' : 'N-Prism';

  const commitReplDispField = () => {
    if (inputBuffer.trim() === '') return;
    const v = parseFloat(inputBuffer);
    if (isNaN(v)) return;
    if (activeField === 0) setReplDisp(d => ({ ...d, distH: Math.abs(v) }));
    else setReplDisp(d => ({ ...d, angH: parseDmsInput(v) }));
    setInputBuffer('');
  };

  const OBS_FIELD_ORDER = [2, 0, 1]; // HD -> PTO -> Cd

  const filteredCodes = codeList.filter(c => c.toLowerCase().startsWith(codeSearchBuffer.trim().toLowerCase()));

  // Etiquetas F1-F4 de las pantallas corregidas (null = usar las originales)
  const overrideFKeyLabels = (): [string, string, string, string] | null => {
    if (measureAnim.active) return ['', '', '', 'PARA'];
    if (isStarMenuOpen) return starMode === 'SETTINGS' ? starFKeyLabels() : ['', '', '', ''];
    switch (screenState) {
      case 'GEN':
        return genFKeyLabels();
      case 'TILT':
      case 'COMPEN':
        return ['OK', 'PLO-EN.', '', ''];
      case 'USB_MENU':
      case 'DATO_MENU':
      case 'JOB_MENU':
      case 'KNOWN_MENU':
      case 'JOB_LIST':
      case 'JOB_DELETE_LIST':
        return ['', '', '', ''];
      case 'JOB_SELECT':
        return ['LIST', '', '', ''];
      case 'KNOWN_DEL':
        return ['↑↓…P', '1RO', 'ULTIM', 'BORR'];
      case 'REPL_OBS':
        return ['REG', 'DISP', '← →', 'MED'];
      case 'MED':
        if (medPage === 1) return ['MED', 'GHV', 'AZ-0', 'COORD'];
        if (medPage === 2) return ['MENU', 'COMP', 'ANG.H', 'EDM'];
        return ['MDR', 'DESPLZ', 'TOPO', 'REPL'];
      case 'GRAPHIC_MENU':
      case 'REPLANTEO_MENU':
      case 'TOPO_MENU':
      case 'OCC_TRISEC':
      case 'COORD_MENU':
      case 'DESPLZ_MENU':
      case 'EDM_MENU':
      case 'TRISEC_AJ':
      case 'VER_DETAIL':
        return ['', '', '', ''];
      case 'OCC_ORIEN':
        if (activeField <= 4) return ['CARG', 'ACLE.R', 'E.RXYZ', 'TRISEC'];
        if (activeField === 5) return ['AGR', 'LIST', 'BUSC', ''];
        if (activeField <= 10) return ['', 'ACLE.R', 'E.RXYZ', 'TRISEC'];
        return ['0ppm', 'ACLE.R', 'E.RXYZ', 'TRISEC'];
      case 'OCC_LOAD_LIST':
        return ['↑↓…P', '1RO', 'ULTIM', 'BUSC'];
      case 'OCC_LOAD_SEARCH':
        return ['', '', '', 'OK'];
      case 'ERXYZ':
        return ['CARG', '', '', 'OK'];
      case 'CODE_LIST':
        return ['↑↓…P', '1RO', 'ULTIM', ''];
      case 'CODE_SEARCH':
        return ['', '1RO', 'ULTIM', ''];
      case 'CODE_ADD':
        return ['', '', 'NO', 'SI'];
      case 'TRISEC_PT':
        return ['', '', 'ANGUL', 'MED'];
      case 'OBS':
        if (activeField === 1) return ['AGR', 'LIST', 'BUSC', ''];
        return [obsMeasured ? 'REG' : '', 'DESPLZ', 'AUTO', 'MED'];
      case 'REPL_DATA':
        return ['CARG', 'DISP', '', 'OK'];
      case 'TOPO_PTTRN':
        return ['PTTRN', '', '', 'OK'];
      case 'TOPO_MODEL':
        return ['', 'REG', '', 'OK'];
      case 'JOB_DETAILS':
      case 'KNOWN_INPUT':
        return ['', '', '', 'OK'];
      case 'KNOWN_NEW':
        return ['', '', '', 'REG'];
      case 'JOB':
        return ['LIST', '', '', 'ENT'];
      default:
        return null;
    }
  };

  // ---------- Tecla F1-F4 ----------
  const ovFKey = (f: 1 | 2 | 3 | 4): boolean => {
    if (measureAnim.active) {
      if (f === 4) stopMeasurement(false);
      return true;
    }
    if (isStarMenuOpen) {
      if (f === 4 && starMode === 'SETTINGS') { setStarMode('MENU'); setStarMenuIdx(0); }
      return true;
    }
    switch (screenState) {
      case 'MED': {
        if (medPage === 1) {
          if (f === 1) startMeasurement(() => { leerDistanciometro(); });
          else if (f === 2) setMedView(v => (v === 'GHV' ? 'NORMAL' : 'GHV'));
          else if (f === 3) goCompen('MED', 'MED');
          else { setScreenState('COORD_MENU'); setMenuSelection(1); }
        } else if (medPage === 2) {
          if (f === 1) { setScreenState('GRAPHIC_MENU'); setGraphicMenuIdx(0); }
          else if (f === 2) goCompen('MED', 'MED');
          else if (f === 3) setLcdMessage(`ÁNGULO H:\n${formatDMS(envHD)}`);
          else openEdm('MED');
        } else {
          if (f === 1) startMeasurement(() => { leerDistanciometro(); });
          else if (f === 2) { setDesplzReturn('MED'); setScreenState('DESPLZ_MENU'); setDesplzMenuSelection(1); }
          else if (f === 3) { setScreenState('TOPO_MENU'); setTopoMenuSelection(1); }
          else { setScreenState('REPLANTEO_MENU'); setReplMenuSelection(1); }
        }
        return true;
      }
      case 'COMPEN':
        if (f === 1) { ovEnter(); return true; }
        return false; // F2 PLGETT: comportamiento original
      case 'GRAPHIC_MENU':
      case 'REPLANTEO_MENU':
      case 'TOPO_MENU':
      case 'OCC_TRISEC':
      case 'COORD_MENU':
      case 'DESPLZ_MENU':
      case 'EDM_MENU':
      case 'TRISEC_AJ':
      case 'VER_DETAIL':
        return true; // Sin softkeys en el equipo real
      case 'OCC_ORIEN': {
        commitCurrentField();
        if (activeField === 5) {
          const cd = (inputBuffer.trim() || stationAtm.CD).toUpperCase();
          if (f === 1) { setCodeSearchBuffer(cd); setScreenState('CODE_ADD'); }
          else if (f === 2) {
            const i = codeList.indexOf(cd);
            setCodeIdx(i >= 0 ? i : 0);
            setScreenState('CODE_LIST');
          } else if (f === 3) { setCodeSearchBuffer(''); setCodeIdx(0); setScreenState('CODE_SEARCH'); }
          return true;
        }
        if (f === 1) {
          if (activeField <= 4) openPicker('OCC');
          else if (activeField >= 11) {
            setStationAtm(a => ({ ...a, ppm: '0' }));
            if (activeField === 13) setInputBuffer('0');
            setLcdMessage('PPm = 0');
          }
        } else if (f === 2) { setInputBuffer(''); setScreenState('OCC_ACLER'); }
        else if (f === 3) { setScreenState('ERXYZ'); setActiveField(0); }
        else { setScreenState('OCC_TRISEC'); setTrisecSelection(1); }
        return true;
      }
      case 'OCC_LOAD_LIST': {
        const n = pointRecords.length;
        if (f === 1) setSelectedOccLoadIdx(i => (i + 5 < n ? i + 5 : 0));
        else if (f === 2) setSelectedOccLoadIdx(0);
        else if (f === 3) setSelectedOccLoadIdx(Math.max(0, n - 1));
        else { setOccSearchBuffer(''); setSearchField(0); setScreenState('OCC_LOAD_SEARCH'); }
        return true;
      }
      case 'OCC_LOAD_SEARCH':
        if (f === 4) buscarRegistro();
        return true;
      case 'ERXYZ':
        if (f === 1) { commitCurrentField(); openPicker('BS'); }
        else if (f === 4) prepararComprobacionOrientacion();
        return true;
      case 'CODE_LIST': {
        const n = codeList.length;
        if (f === 1) setCodeIdx(i => (i + 5 < n ? i + 5 : 0));
        else if (f === 2) setCodeIdx(0);
        else if (f === 3) setCodeIdx(Math.max(0, n - 1));
        return true;
      }
      case 'CODE_SEARCH':
        if (f === 2) setCodeIdx(0);
        else if (f === 3) setCodeIdx(Math.max(0, filteredCodes.length - 1));
        return true;
      case 'CODE_ADD': {
        if (f === 3) codeReturnScreen();
        else if (f === 4) {
          const cd = codeSearchBuffer.trim().toUpperCase();
          if (cd) {
            const existe = codeList.includes(cd);
            if (!existe) setCodeList(prev => [...prev, cd]);
            playLaserBeep();
            setLcdMessage(existe ? `Cd ${cd}\nSOBRESCRITO` : `Cd ${cd}\nAGREGADO`);
            setTimeout(() => codeApply(cd), 900);
          } else {
            codeReturnScreen();
          }
        }
        return true;
      }
      case 'TRISEC_PT':
        if (f === 4) startMeasurement(() => { leerDistanciometro(); });
        return true;
      case 'OBS':
        commitCurrentField();
        if (f === 1) { if (obsMeasured) registrarPuntoObservado(); }
        else if (f === 2) { setDesplzReturn('OBS'); setScreenState('DESPLZ_MENU'); setDesplzMenuSelection(1); }
        else if (f === 3) ejecutarLevantamientoAuto();
        else startMeasurement(() => { leerDistanciometro(); setObsMeasured(true); });
        return true;
      case 'REPL_DATA':
        if (f === 1) { setInputBuffer(''); openPicker('REPL'); }
        else if (f === 2) {
          commitReplDispField();
          setReplDisplayMode(m => (m === 'COORD' ? 'DISP' : 'COORD'));
          setActiveField(0);
          setInputBuffer('');
        } else if (f === 4) { commitReplDispField(); goCompen('REPL', 'REPL_DATA'); }
        return true;
      case 'REPL_OBS':
        if (f === 1) setMedView(v => (v === 'GHV' ? 'NORMAL' : 'GHV'));
        else if (f === 2) { setScreenState('REPL_DATA'); setReplDisplayMode('DISP'); setActiveField(0); setInputBuffer(''); }
        else if (f === 3) setLcdMessage('◄► DESPLAZAR\nVISTA DE REPLANTEO');
        else startMeasurement(() => { leerDistanciometro(); });
        return true;
      case 'TOPO_PTTRN':
        if (f === 1) { setTopoModelIdx(0); setScreenState('TOPO_MODEL'); }
        else if (f === 4) goObservacion('TOPO_MENU');
        return true;
      case 'TOPO_MODEL':
        if (f === 2 || f === 4) {
          playLaserBeep();
          setLcdMessage('MODELO OBS\nREGISTRADO');
          setTimeout(() => setScreenState('TOPO_PTTRN'), 800);
        }
        return true;
      case 'JOB_DETAILS':
      case 'KNOWN_INPUT':
      case 'KNOWN_NEW':
      case 'JOB':
        return f === 3; // ALF (F3) eliminado: el modo de texto se cambia con SHIFT
      default:
        return false;
    }
  };

  // ---------- Tecla ENT ----------
  const ovEnter = (): boolean => {
    if (measureAnim.active) return true;
    if (isStarMenuOpen) {
      if (starMode === 'SETTINGS') {
        setStarMode('MENU');
        setStarMenuIdx(0);
      } else {
        const item = STAR_MENU_ITEMS[starMenuIdx];
        setIsStarMenuOpen(false);
        setStarMode('SETTINGS');
        if (item.go === 'GRAPHIC_MENU') setGraphicMenuIdx(0);
        if (item.go === 'COORD_MENU' || item.go === 'DATO_MENU') setMenuSelection(1);
        setScreenState(item.go);
      }
      return true;
    }
    switch (screenState) {
      case 'MED':
        return true;
      case 'COMPEN':
        if (compenCtx === 'TRISEC') { setTrisecAng(null); setScreenState('TRISEC_PT'); }
        else if (compenCtx === 'OBS') goObservacion(compenReturn);
        else if (compenCtx === 'REPL') { setLastMeas(null); setScreenState('REPL_OBS'); }
        else setScreenState(compenReturn);
        return true;
      case 'COORD_MENU':
        if (menuSelection === 1) { setScreenState('OCC_ORIEN'); setActiveField(0); }
        else if (menuSelection === 2) goCompen('OBS', 'COORD_MENU');
        else openEdm('COORD_MENU');
        return true;
      case 'REPLANTEO_MENU':
        if (replMenuSelection === 3) { goCompen('OBS', 'REPLANTEO_MENU'); return true; }
        if (replMenuSelection === 4) { openEdm('REPLANTEO_MENU'); return true; }
        return false;
      case 'TOPO_MENU':
        if (topoMenuSelection === 1) { setTopoPttrn(p => ({ ...p, field: 0 })); setScreenState('TOPO_PTTRN'); return true; }
        if (topoMenuSelection === 3) { openPicker('VER'); return true; }
        return false;
      case 'GRAPHIC_MENU': {
        const item = GRAPHIC_MENU_ITEMS[graphicMenuIdx];
        if (item.id === 'mer') { setLcdMessage('MEDICIÓN ELEV.\nREMOTA (MER)'); return true; }
        if (item.id === 'intersec') { setLcdMessage('INTERSECCIÓN:\nDEFINA 2 LÍNEAS'); return true; }
        return false;
      }
      case 'OCC_TRISEC':
        if (trisecSelection === 3) { setTrisecAj(a => ({ ...a, field: 0 })); setScreenState('TRISEC_AJ'); }
        else goCompen('TRISEC', 'OCC_TRISEC');
        return true;
      case 'TRISEC_AJ':
        setScreenState('OCC_TRISEC');
        return true;
      case 'TRISEC_PT':
        return true;
      case 'OCC_ORIEN':
        commitCurrentField();
        if (activeField < 13) setActiveField(f => f + 1);
        else setLcdMessage('DATOS ESTACIÓN\nGUARDADOS');
        return true;
      case 'OCC_LOAD_LIST': {
        const rec = pointRecords[selectedOccLoadIdx];
        if (rec) loadRecord(rec, selectedOccLoadIdx);
        return true;
      }
      case 'OCC_LOAD_SEARCH':
        if (searchField < 2) setSearchField(s => s + 1);
        else buscarRegistro();
        return true;
      case 'VER_DETAIL':
        setScreenState('OCC_LOAD_LIST');
        return true;
      case 'ERXYZ':
        commitCurrentField();
        if (activeField < 2) setActiveField(f => f + 1);
        else prepararComprobacionOrientacion();
        return true;
      case 'CODE_LIST': {
        const cd = codeList[codeIdx];
        if (cd) codeApply(cd);
        else codeReturnScreen();
        return true;
      }
      case 'CODE_SEARCH': {
        const cd = filteredCodes[codeIdx];
        if (!cd) { setLcdMessage('no hay datos'); return true; }
        codeApply(cd);
        return true;
      }
      case 'CODE_ADD':
        return ovFKey(4);
      case 'EDM_MENU':
        commitEdmField();
        setEdmField(f => (f + 1) % 8);
        return true;
      case 'OBS': {
        commitCurrentField();
        const pos = OBS_FIELD_ORDER.indexOf(activeField);
        setActiveField(OBS_FIELD_ORDER[(pos + 1) % OBS_FIELD_ORDER.length]);
        return true;
      }
      case 'REPL_DATA':
        if (replDisplayMode === 'DISP') {
          commitReplDispField();
          setActiveField(f => (f === 0 ? 1 : 0));
        } else {
          goCompen('REPL', 'REPL_DATA');
        }
        return true;
      case 'REPL_OBS':
        return true;
      case 'TOPO_PTTRN':
        goObservacion('TOPO_MENU');
        return true;
      case 'TOPO_MODEL':
        return ovFKey(4);
      default:
        return false;
    }
  };

  // ---------- Tecla ESC ----------
  const ovEsc = (): boolean => {
    if (measureAnim.active) { stopMeasurement(false); return true; }
    if (isStarMenuOpen) {
      setIsStarMenuOpen(false);
      setStarMode('SETTINGS');
      return true;
    }
    setLcdMessage(null);
    switch (screenState) {
      case 'COMPEN':
        // En Trisección y Replanteo, ESC tras nivelar continúa a la pantalla de medición (según el equipo)
        if (compenCtx === 'TRISEC') { setTrisecAng(null); setScreenState('TRISEC_PT'); }
        else if (compenCtx === 'REPL') { setLastMeas(null); setScreenState('REPL_OBS'); }
        else setScreenState(compenReturn);
        return true;
      case 'TRISEC_PT':
      case 'TRISEC_AJ':
        setScreenState('OCC_TRISEC');
        return true;
      case 'OCC_TRISEC':
        setScreenState('OCC_ORIEN');
        setActiveField(0);
        return true;
      case 'OCC_LOAD_LIST':
        setScreenState(pickerReturnScreen(pickCtx));
        return true;
      case 'OCC_LOAD_SEARCH':
      case 'VER_DETAIL':
        setScreenState('OCC_LOAD_LIST');
        return true;
      case 'CODE_LIST':
      case 'CODE_SEARCH':
      case 'CODE_ADD':
        setScreenState('OCC_ORIEN');
        setActiveField(5);
        return true;
      case 'ERXYZ':
        commitCurrentField();
        setScreenState('OCC_ORIEN');
        setActiveField(0);
        return true;
      case 'EDM_MENU':
        setEdmBuffer('');
        setScreenState(prevScreenBeforeEdm || 'MED');
        return true;
      case 'DESPLZ_MENU':
        setScreenState(desplzReturn);
        return true;
      case 'OBS':
        commitCurrentField();
        setScreenState(obsReturn);
        return true;
      case 'REPL_DATA':
        setInputBuffer('');
        setScreenState('REPLANTEO_MENU');
        return true;
      case 'REPL_OBS':
        setScreenState('REPL_DATA');
        return true;
      case 'TOPO_PTTRN':
        setScreenState('TOPO_MENU');
        return true;
      case 'TOPO_MODEL':
        setScreenState('TOPO_PTTRN');
        return true;
      default:
        return false;
    }
  };

  // ---------- Flechas ----------
  const ovArrow = (dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'): boolean => {
    if (measureAnim.active) return true;
    const up = dir === 'UP';
    const down = dir === 'DOWN';
    const lr: 1 | -1 = dir === 'RIGHT' ? 1 : -1;
    if (isStarMenuOpen) {
      if (starMode === 'MENU' && (up || down)) {
        setStarMenuIdx(i => (i + (down ? 1 : -1) + STAR_MENU_ITEMS.length) % STAR_MENU_ITEMS.length);
      }
      return true;
    }
    switch (screenState) {
      case 'COMPEN':
        // Nivelación fina con flechas: ◄ ► eje X (tornillos A+B), ▲ ▼ eje Y (tornillo C)
        if (up || down) setCompenY(y => Math.max(-COMPEN_LIMIT, Math.min(COMPEN_LIMIT, y + (up ? 10 : -10))));
        else setCompenX(x => Math.max(-COMPEN_LIMIT, Math.min(COMPEN_LIMIT, x + lr * 10)));
        return true;
      case 'COORD_MENU':
        if (up || down) setMenuSelection(s => ((s - 1 + (down ? 1 : -1) + 3) % 3) + 1);
        return true;
      case 'OCC_TRISEC':
        if (up || down) setTrisecSelection(s => ((s - 1 + (down ? 1 : -1) + 3) % 3) + 1);
        return true;
      case 'TRISEC_AJ':
        if (up || down) setTrisecAj(a => ({ ...a, field: a.field === 0 ? 1 : 0 }));
        else setTrisecAj(a => (a.field === 0 ? { ...a, obsCara: a.obsCara === 'No' ? 'Si' : 'No' } : { ...a, z: a.z === 'On' ? 'Off' : 'On' }));
        return true;
      case 'TRISEC_PT':
      case 'REPL_OBS':
        return true;
      case 'OCC_ORIEN':
        if (up || down) {
          commitCurrentField();
          setActiveField(f => (f + (down ? 1 : -1) + 14) % 14);
        } else if (activeField === 9) {
          setStationAtm(a => ({ ...a, clima: cycleOption(CLIMA_OPTIONS, a.clima, lr) }));
        } else if (activeField === 10) {
          setStationAtm(a => ({ ...a, viento: cycleOption(VIENTO_OPTIONS, a.viento, lr) }));
        }
        return true;
      case 'OCC_LOAD_LIST': {
        const n = pointRecords.length;
        if (n && (up || down)) setSelectedOccLoadIdx(i => (i + (down ? 1 : -1) + n) % n);
        return true;
      }
      case 'OCC_LOAD_SEARCH':
        if (up || down) setSearchField(s => (s + (down ? 1 : -1) + 3) % 3);
        else if (searchField === 1) setSearchCriteria(c => (c === 'Completo' ? 'Parcial' : 'Completo'));
        else if (searchField === 2) setSearchDirection(d => (d === '↓' ? '↑' : '↓'));
        return true;
      case 'VER_DETAIL': {
        const n = pointRecords.length;
        if (n && (up || down)) {
          const next = (verDetailIdx + (down ? 1 : -1) + n) % n;
          setVerDetailIdx(next);
          setSelectedOccLoadIdx(next);
        }
        return true;
      }
      case 'ERXYZ':
        if (up || down) {
          commitCurrentField();
          setActiveField(f => (f + (down ? 1 : -1) + 3) % 3);
        }
        return true;
      case 'CODE_LIST': {
        const n = codeList.length;
        if (n && (up || down)) setCodeIdx(i => (i + (down ? 1 : -1) + n) % n);
        return true;
      }
      case 'CODE_SEARCH': {
        const n = filteredCodes.length;
        if (n && (up || down)) setCodeIdx(i => (i + (down ? 1 : -1) + n) % n);
        return true;
      }
      case 'CODE_ADD':
        return true;
      case 'EDM_MENU':
        if (up || down) {
          commitEdmField();
          setEdmField(f => (f + (down ? 1 : -1) + 8) % 8);
        } else {
          if (edmField === 0) setEdmCfg(c => ({ ...c, modo: cycleOption(EDM_MODOS, c.modo, lr) }));
          else if (edmField === 1) setReflectorByName(cycleOption(EDM_REFLECTORES, currentReflectorName, lr));
          else if (edmField === 2) setEdmCfg(c => ({ ...c, cp: Math.max(-99, Math.min(99, c.cp + lr)) }));
          else if (edmField === 3) setEdmCfg(c => ({ ...c, mantIlum: cycleOption(EDM_MANT_ILUM, c.mantIlum, lr) }));
          else if (edmField === 4) setEdmCfg(c => ({ ...c, luzGuia: cycleOption(EDM_LUZ_GUIA, c.luzGuia, lr) }));
          else if (edmField === 5) setStationAtm(a => ({ ...a, temp: String(Math.max(-35, Math.min(60, (parseFloat(a.temp) || 0) + lr))) }));
          else if (edmField === 6) setStationAtm(a => ({ ...a, pres: String(Math.max(500, Math.min(1400, (parseFloat(a.pres) || 1013) + lr))) }));
          else setStationAtm(a => ({ ...a, ppm: String(Math.max(-499, Math.min(499, (parseFloat(a.ppm) || 0) + lr))) }));
        }
        return true;
      case 'DESPLZ_MENU':
        return false;
      case 'OBS':
        if (up || down) {
          commitCurrentField();
          const pos = OBS_FIELD_ORDER.indexOf(activeField);
          setActiveField(OBS_FIELD_ORDER[(pos + (down ? 1 : -1) + OBS_FIELD_ORDER.length) % OBS_FIELD_ORDER.length]);
        }
        return true;
      case 'REPL_DATA':
        if (replDisplayMode === 'DISP' && (up || down)) {
          commitReplDispField();
          setActiveField(f => (f === 0 ? 1 : 0));
        }
        return true;
      case 'TOPO_PTTRN':
        if (up || down) setTopoPttrn(p => ({ ...p, field: (p.field + (down ? 1 : -1) + 4) % 4 }));
        else setTopoPttrn(p => {
          if (p.field === 0) return { ...p, sets: Math.max(1, Math.min(9, p.sets + lr)) };
          if (p.field === 1) return { ...p, obs: Math.max(1, Math.min(9, p.obs + lr)) };
          if (p.field === 2) return { ...p, obsP12: p.obsP12 === 'NO' ? 'SI' : 'NO' };
          return { ...p, preenter: p.preenter === 'NO' ? 'SI' : 'NO' };
        });
        return true;
      case 'TOPO_MODEL':
        if (up || down) setTopoModelIdx(i => (i + (down ? 1 : -1) + 4) % 4);
        else setTopoModels(m => m.map((v, i) => (i === topoModelIdx ? (v === 'CLEV' ? '' : 'CLEV') : v)));
        return true;
      default:
        return false;
    }
  };

  // ---------- Teclado numérico / alfanumérico ----------
  const ovKey = (key: string): boolean => {
    if (measureAnim.active || isStarMenuOpen) return true;
    switch (screenState) {
      case 'COORD_MENU':
        if (key === '1' || key === '2' || key === '3') {
          setMenuSelection(Number(key));
          if (key === '1') { setScreenState('OCC_ORIEN'); setActiveField(0); }
          else if (key === '2') goCompen('OBS', 'COORD_MENU');
          else openEdm('COORD_MENU');
        }
        return true;
      case 'OCC_TRISEC':
        if (key === '1' || key === '2' || key === '3') {
          setTrisecSelection(Number(key));
          if (key === '3') { setTrisecAj(a => ({ ...a, field: 0 })); setScreenState('TRISEC_AJ'); }
          else goCompen('TRISEC', 'OCC_TRISEC');
        }
        return true;
      case 'REPLANTEO_MENU':
        if (key === '3') { setReplMenuSelection(3); goCompen('OBS', 'REPLANTEO_MENU'); return true; }
        if (key === '4') { setReplMenuSelection(4); openEdm('REPLANTEO_MENU'); return true; }
        return false;
      case 'TOPO_MENU':
        if (key === '1') { setTopoMenuSelection(1); setScreenState('TOPO_PTTRN'); return true; }
        if (key === '3') { setTopoMenuSelection(3); openPicker('VER'); return true; }
        return false;
      case 'OCC_LOAD_SEARCH':
        if (searchField === 0) setOccSearchBuffer(applyKeyToBuffer(key, occSearchBuffer));
        return true;
      case 'CODE_SEARCH':
        setCodeSearchBuffer(applyKeyToBuffer(key, codeSearchBuffer));
        setCodeIdx(0);
        return true;
      case 'EDM_MENU':
        if (edmField === 2 || edmField >= 5) setEdmBuffer(b => applyNumericKey(key, b));
        return true;
      case 'REPL_DATA':
        if (replDisplayMode === 'DISP') setInputBuffer(b => applyNumericKey(key, b));
        return true;
      case 'OCC_ORIEN':
        if (activeField >= 7 && activeField <= 10) return true; // Fech, Tiem (automáticos) y Clima, Viento (◄ ►)
        break;
      case 'TRISEC_PT':
      case 'TRISEC_AJ':
      case 'VER_DETAIL':
      case 'CODE_LIST':
      case 'CODE_ADD':
      case 'REPL_OBS':
      case 'TOPO_PTTRN':
      case 'TOPO_MODEL':
      case 'OCC_LOAD_LIST':
        return true;
      default:
        break;
    }
    // Campos de texto: escritura según el modo NUM / ALF / SIM (SHIFT)
    if (isCurrentFieldAlpha) {
      // Se calcula fuera del actualizador de estado: la multi-pulsación usa una ref y no debe ejecutarse dos veces
      setInputBuffer(applyKeyToBuffer(key, inputBuffer));
      return true;
    }
    return key.startsWith('RAW:');
  };

  // ---------- SHIFT: cambia el modo de entrada NUM -> ALF -> SIM ----------
  const ovShift = () => {
    if (!isCurrentFieldAlpha) {
      setLcdMessage('SHIFT: CAMPO\nSOLO NUMÉRICO');
      return;
    }
    lastTapRef.current = { key: '', time: 0, idx: 0 };
    setInputMode(m => (m === 'NUM' ? 'ALF' : m === 'ALF' ? 'SIM' : 'NUM'));
  };

  // ---------- FUNC en Estacionamiento: salta a la siguiente pantalla de campos ----------
  const ovFunc = (): boolean => {
    if (screenState === 'OCC_ORIEN') {
      commitCurrentField();
      const pg = occPageOf(activeField);
      setActiveField(OCC_PAGES[(pg + 1) % OCC_PAGES.length][0]);
      return true;
    }
    return false;
  };

  // =========================================================================
  // 9. CORRECCIONES DE USUARIO (14-10-2026): PANTALLAS GENÉRICAS DEL EQUIPO
  // -------------------------------------------------------------------------
  // Menús, ajustes, avisos y confirmaciones con el formato del LCD real.
  // Se apilan en genStack (ESC vuelve a la anterior); al vaciarse se regresa a genReturn.
  // =========================================================================
  type GenField = {
    key: string;
    label: string;
    kind: 'opt' | 'num' | 'text' | 'link' | 'info';
    value?: string;
    options?: string[];
    onSelect?: () => void;
  };
  type GenView =
    | { kind: 'menu'; title?: string; subtitle?: string; items: { label: string; onSelect: () => void }[]; icon?: ReactNode }
    | { kind: 'form'; title?: string; rowsPerPage: number; fields: GenField[]; fkeys?: [string, string, string, string]; onF?: (f: 1 | 2 | 3 | 4) => void }
    | { kind: 'list'; title?: string; rows: { left: string; right?: string }[]; fkeys: [string, string, string, string]; onF: (f: 1 | 2 | 3 | 4, idx: number) => void; onEnter?: (idx: number) => void }
    | { kind: 'msg'; lines: string[]; timed?: boolean; onKey?: () => void }
    | { kind: 'confirm'; lines: string[]; onYes: () => void; onNo?: () => void }
    | { kind: 'input'; lines: string[]; alpha: boolean; fkeys?: [string, string, string, string]; onEnter: (val: string) => void; onF?: (f: 1 | 2 | 3 | 4) => void }
    | { kind: 'custom'; render: () => ReactNode; fkeys: [string, string, string, string]; onF: (f: 1 | 2 | 3 | 4) => void; onEnter?: () => void };

  const genTop = genStack[genStack.length - 1];

  const genOpen = (id: string, param?: string, initialBuffer?: string) => {
    // Campos de texto que en el equipo arrancan en modo letras
    if (id === 'codTeclear' || id === 'btEdit' || id === 'clave') setInputMode('ALF');
    if (screenState !== 'GEN') {
      setGenReturn(screenState);
      setGenStack([{ id, idx: 0, param }]);
      setScreenState('GEN');
    } else {
      setGenStack(st => [...st, { id, idx: 0, param }]);
    }
    setInputBuffer(initialBuffer ?? '');
  };
  const genBack = () => {
    setInputBuffer('');
    if (genStack.length <= 1) {
      setGenStack([]);
      setScreenState(genReturn);
    } else {
      setGenStack(st => st.slice(0, -1));
    }
  };
  const genExit = (to?: ScreenState) => {
    setGenStack([]);
    setInputBuffer('');
    setScreenState(to ?? genReturn);
  };
  const genSetIdx = (idx: number) => setGenStack(st => st.map((f, i) => (i === st.length - 1 ? { ...f, idx } : f)));
  // Aviso temporal (p.ej. "Borrando...") que se cierra solo y ejecuta "then"
  const genTimed = (lines: string, ms: number, then: () => void) => {
    genOpen('timed', lines);
    setTimeout(then, ms);
  };
  // Vuelve N pantallas atrás dentro de la pila genérica
  const genPop = (n: number) => {
    setInputBuffer('');
    setGenStack(st => {
      const next = st.slice(0, Math.max(0, st.length - n));
      if (next.length === 0) setScreenState(genReturn);
      return next;
    });
  };

  const optField = (key: string, label: string, options?: string[]): GenField => ({
    key, label, kind: 'opt', value: cfg[key], options: options ?? CFG_OPTIONS[key]
  });
  const numField = (key: string, label: string): GenField => ({ key, label, kind: 'num', value: cfg[key] });

  const jobClean = (j: string) => j.replace(/^\*/, '');
  const jobCountAt = (i: number) => (jobClean(jobsList[i] || '') === jobClean(jobName) ? points.length : jobCounts[i] ?? 0);

  // Envío simulado con conteo de puntos ("Enviando N")
  const sendTimerRef = useRef<number | null>(null);
  const startSending = (title: string, format: string, total: number, onDone: () => void) => {
    setSendCount(0);
    genOpen('sending', `${title}|${format}`);
    if (sendTimerRef.current !== null) window.clearInterval(sendTimerRef.current);
    let n = 0;
    const step = Math.max(1, Math.ceil(total / 25));
    sendTimerRef.current = window.setInterval(() => {
      n = Math.min(total, n + step);
      setSendCount(n);
      playBeep(1900, 0.02);
      if (n >= total) {
        if (sendTimerRef.current !== null) window.clearInterval(sendTimerRef.current);
        sendTimerRef.current = null;
        playLaserBeep();
        setTimeout(onDone, 700);
      }
    }, 90);
  };

  // Formulario Config. Comunic. (compartido: TRABJ, Datos Conocidos y CNFG)
  const comCfgView = (): GenView => {
    if (cfg['com.sinCable'] === 'Si') {
      return {
        kind: 'form',
        rowsPerPage: 6,
        fields: [
          optField('com.sinCable', 'Sin Cable'),
          { key: 'l1', label: 'Ajust.Bluetooth', kind: 'link', onSelect: () => genOpen('btCfg') },
          { key: 'l2', label: 'ListaDispConect.', kind: 'link', onSelect: () => genOpen('btList') },
          { key: 'l3', label: 'Info.SobreDispos', kind: 'link', onSelect: () => genOpen('btInfo') }
        ]
      };
    }
    return {
      kind: 'form',
      rowsPerPage: 6,
      fields: [
        optField('com.sinCable', 'Sin Cable'),
        optField('com.vel', 'Velocidad'),
        optField('com.bits', 'Bits/Dato'),
        optField('com.par', 'Paridad'),
        optField('com.paro', 'Bit Paro'),
        optField('com.compFin', 'Comp.fin.'),
        optField('com.ack', 'ACK/NAK'),
        optField('com.crlf', 'CR.LF'),
        optField('com.ackMode', 'ACK mode')
      ]
    };
  };

  // Datos Conocidos > Claro / Cod. > Borrar lista, etc. usan confirmaciones genéricas
  const buildGenView = (id: string, param?: string): GenView | null => {
    switch (id) {
      // ---------- Avisos ----------
      case 'timed':
        return { kind: 'msg', lines: (param || '').split('|'), timed: true };
      case 'msg':
        return { kind: 'msg', lines: (param || '').split('|') };
      case 'sending': {
        const [title, format] = (param || '|').split('|');
        return { kind: 'msg', timed: true, lines: [title, '', `Format  ${format}`, `Enviando   ${sendCount}`] };
      }

      // ---------- USB (Tipo T / Tipo S): 6 opciones, cada una pide insertar el USB ----------
      case 'usbType': {
        const tipo = param || 'T';
        const opciones = ['Guardar Datos', 'Cargar Pto.Conoc', 'Guardar codigo', 'Cargar codigo', 'Estado de fich.', 'Formateo rapido'];
        return {
          kind: 'menu',
          title: `Tipo ${tipo}`,
          items: opciones.map((label, i) => ({
            label,
            onSelect: () => genOpen('usbInsert', String(i))
          }))
        };
      }
      case 'usbInsert':
        return {
          kind: 'msg',
          lines: ['', 'Inserte USB', '', 'Pulsar Tecla'],
          onKey: () => {
            // Guardar Datos continúa a la selección de trabajo y descarga el CSV (pendiente de confirmar con la clienta)
            if (param === '0') {
              setUsbTypeMode(genStack[0]?.param === 'S' ? 'S' : 'T');
              setSelectedJobIdx(0);
              genExit('USB_SAVE_JOB');
            } else {
              genBack();
            }
          }
        };

      // ---------- DATO > TRABJ > Borrar ----------
      case 'jobDelConfirm': {
        const i = Number(param);
        const name = jobClean(jobsList[i] || '');
        return {
          kind: 'confirm',
          lines: [name, '  borrado', '    Confir ?'],
          onYes: () => {
            genTimed('|Borrando...', 900, () => {
              setJobCounts(c => c.map((v, k) => (k === i ? 0 : v)));
              if (jobClean(jobName) === name) setPoints([]);
              genExit('JOB_DELETE_LIST');
            });
          }
        };
      }

      // ---------- DATO > TRABJ > Salida Comunic. ----------
      case 'salida':
        return {
          kind: 'menu',
          title: 'Salida Comunic.',
          items: [
            { label: 'tiPo T', onSelect: () => { setSalidaSel([]); genOpen('salidaJobs', 'T'); } },
            { label: 'tiPo S', onSelect: () => { setSalidaSel([]); genOpen('salidaJobs', 'S'); } }
          ]
        };
      case 'salidaJobs': {
        const tipo = param || 'T';
        return {
          kind: 'list',
          rows: jobsList.map((j, i) => ({ left: j, right: salidaSel.includes(i) ? 'Fuer' : String(jobCountAt(i)) })),
          fkeys: ['', '', '', 'OK'],
          onEnter: i => setSalidaSel(sel => (sel.includes(i) ? sel.filter(x => x !== i) : [...sel, i])),
          onF: (f, i) => {
            if (f !== 4) return;
            if (salidaSel.length === 0) setSalidaSel([i]);
            genOpen(tipo === 'T' ? 'salidaFmtT' : 'salidaFmtS');
          }
        };
      }
      case 'salidaFmtT':
      case 'salidaFmtS': {
        const formatos = id === 'salidaFmtT' ? ['GTS(Obs)', 'GTS(Coord)', 'SSS(Obs)', 'SSS(Coord)'] : ['SDR33', 'SDR2x'];
        return {
          kind: 'menu',
          title: 'Salida Comunic.',
          items: formatos.map(fmt => ({
            label: fmt,
            onSelect: () => {
              if (fmt.includes('Coord')) iniciarSalida(fmt);
              else genOpen('salidaObs', fmt);
            }
          }))
        };
      }
      case 'salidaObs':
        return {
          kind: 'menu',
          title: 'Salida Comunic.',
          items: [
            { label: 'Datos obs', onSelect: () => iniciarSalida(param || '') },
            { label: 'Datos Reducid', onSelect: () => iniciarSalida(param || '') }
          ]
        };

      // ---------- Config. Comunic. y Bluetooth ----------
      case 'comCfg':
        return comCfgView();
      case 'btCfg': {
        const fields: GenField[] = [optField('bt.modo', 'Modo')];
        if (cfg['bt.modo'] === 'Origen') fields.push(numField('bt.enl', 'Enl.'));
        fields.push(optField('bt.auth', 'Autenticacion'));
        if (cfg['bt.auth'] === 'Si') fields.push({ key: 'bt.clave', label: 'Clave', kind: 'info', value: cfg['bt.clave'] });
        fields.push(optField('bt.compFin', 'Comp.fin.'));
        fields.push(optField('com.ack', 'ACK/NAK'), optField('com.crlf', 'CR,LF'), optField('com.ackMode', 'ACK mode'));
        return { kind: 'form', rowsPerPage: 5, fields };
      }
      case 'btList':
        return {
          kind: 'list',
          title: 'ListaDisPConect.',
          rows: btDevices.map(d => ({ left: d })),
          fkeys: ['EDIT', 'BORR', '', ''],
          onF: (f, i) => {
            if (f === 1) genOpen('btEdit', String(i), btDevices[i]?.replace(/^\*/, '') || '');
            else if (f === 2 && btDevices[i]) genOpen('btDel', String(i));
          }
        };
      case 'btEdit':
        return {
          kind: 'input',
          lines: ['RegistroDisPositivo', 'Nomb.:'],
          alpha: true,
          fkeys: ['', '', '', 'REG'],
          onEnter: v => guardarDispositivo(Number(param), v),
          onF: f => { if (f === 4) guardarDispositivo(Number(param), inputBuffer); }
        };
      case 'btDel': {
        const i = Number(param);
        return {
          kind: 'confirm',
          lines: [btDevices[i] || '', '  borrado', '    Confir ?'],
          onYes: () => {
            setBtDevices(d => d.filter((_, k) => k !== i));
            genBack();
          }
        };
      }
      case 'btInfo':
        return { kind: 'msg', lines: ['Bluetooth ID:', '  B018459.B016540', 'Firmware: 4.0.0', 'BD_ADDR:', '      00078056E9F6'] };

      // ---------- DATO > Datos Conocidos ----------
      case 'entComms':
        return {
          kind: 'menu',
          title: 'Entrada Comms',
          items: [
            { label: 'tiPo T', onSelect: () => genOpen('entCommsT') },
            { label: 'tiPo S', onSelect: () => conectarEntrada() }
          ]
        };
      case 'entCommsT':
        return {
          kind: 'menu',
          title: 'Entrada Comms',
          items: [
            { label: 'GTS(Coord)', onSelect: () => conectarEntrada() },
            { label: 'SSS(Coord)', onSelect: () => conectarEntrada() }
          ]
        };
      case 'knownClaro':
        return {
          kind: 'confirm',
          lines: ['', 'Claro', '  Confir ?'],
          onYes: () => genTimed('|Borrando...', 900, () => { setKnownPoints([]); genExit('KNOWN_MENU'); })
        };

      // ---------- DATO > Cod. ----------
      case 'cod':
        return {
          kind: 'menu',
          title: 'Cod.',
          items: [
            { label: 'Teclear Codigo', onSelect: () => genOpen('codTeclear') },
            { label: 'Entr. Comms', onSelect: () => genOpen('msg', 'Entr. Comms||Format   Codigo||Recibiendo   0') },
            { label: 'Salida Comunic.', onSelect: () => startSending('Salida Comunic.', 'Codigo', codeList.length, () => genPop(1)) },
            { label: 'Borrar', onSelect: () => genOpen('codBorrar') },
            { label: 'Vista Codigo', onSelect: () => genOpen('codVista') },
            { label: 'Borrar lista', onSelect: () => genOpen('codBorrarLista') }
          ]
        };
      case 'codTeclear':
        return {
          kind: 'input',
          lines: ['Cod.'],
          alpha: true,
          onEnter: v => {
            const cd = v.trim().toUpperCase();
            if (!cd) return;
            if (codeList.includes(cd)) genOpen('codSobre', cd);
            else {
              setCodeList(l => [...l, cd]);
              genTimed(`Cod.|:${cd}||   Registrado`, 1000, () => { genPop(1); setInputBuffer(''); });
            }
          }
        };
      case 'codSobre':
        return {
          kind: 'confirm',
          lines: ['Cod.', `:${param}`, '', '   Sob.escri?'],
          onYes: () => genTimed(`Cod.|:${param}||   Registrado`, 1000, () => genPop(2)),
          onNo: () => genBack()
        };
      case 'codBorrar':
        return {
          kind: 'list',
          rows: codeList.map(c => ({ left: c })),
          fkeys: ['↑↓…P', '1RO', 'ULTIM', 'BORR'],
          onF: (f, i) => {
            if (f === 1) genSetIdx(i + 5 < codeList.length ? i + 5 : 0);
            else if (f === 2) genSetIdx(0);
            else if (f === 3) genSetIdx(Math.max(0, codeList.length - 1));
            else if (codeList[i] !== undefined) {
              setCodeList(l => l.filter((_, k) => k !== i));
              genSetIdx(Math.max(0, Math.min(i, codeList.length - 2)));
            }
          }
        };
      case 'codVista':
        return {
          kind: 'list',
          rows: codeList.map(c => ({ left: c })),
          fkeys: ['↑↓…P', '1RO', 'ULTIM', ''],
          onF: (f, i) => {
            if (f === 1) genSetIdx(i + 5 < codeList.length ? i + 5 : 0);
            else if (f === 2) genSetIdx(0);
            else if (f === 3) genSetIdx(Math.max(0, codeList.length - 1));
          }
        };
      case 'codBorrarLista':
        return {
          kind: 'confirm',
          lines: ['', 'Borrar lista', '   Confir ?'],
          onYes: () => genTimed('|Borrando...', 900, () => { setCodeList([]); genPop(2); })
        };

      // ---------- CNFG: 9 opciones en 2 pantallas ----------
      case 'cnfg':
        return {
          kind: 'menu',
          title: 'Config',
          items: [
            { label: 'Cond. Obs.', onSelect: () => genOpen('condObs') },
            { label: 'Config.Instr', onSelect: () => genOpen('instr') },
            { label: 'Const Instr', onSelect: () => genOpen('constInstr') },
            { label: 'Config.Comunic.', onSelect: () => genOpen('comCfg') },
            { label: 'Unidades', onSelect: () => genOpen('unidades') },
            { label: 'Tecla func', onSelect: () => genOpen('teclaFunc') },
            { label: 'Cambiar Clave', onSelect: () => genOpen('clave', 'antig') },
            { label: 'Fecha y hora', onSelect: () => abrirFechaHora() },
            { label: 'TSshield', onSelect: () => genOpen('tsshield') }
          ]
        };
      case 'condObs':
        return {
          kind: 'form',
          rowsPerPage: 6,
          fields: [
            optField('obs.modoDist', 'Modo Dist'),
            optField('obs.distH', 'Dist H'),
            optField('obs.compens', 'ComPens.'),
            optField('obs.corrCol', 'Corr.Col.'),
            optField('obs.esfRef', 'Esf/Refr'),
            optField('obs.nivMar', 'Corr.NivelMar'),
            optField('obs.obsV', 'Obs.V'),
            optField('obs.coord', 'Coord.'),
            optField('obs.reso', 'Reso.ang'),
            optField('obs.diana', 'ModoDiana'),
            optField('obs.despAng', 'DesPAngV'),
            numField('obs.incr', 'Incr.ID.Stn'),
            optField('obs.vManual', 'V manual')
          ]
        };
      case 'instr':
        return {
          kind: 'form',
          rowsPerPage: 6,
          fields: [
            optField('instr.apagar', 'AutoAPagar'),
            optField('retic', 'Niv Retic'),
            optField('contraste', 'Contraste'),
            optField('instr.resumir', 'Resumir'),
            optField('instr.edmAlc', 'EDM ALC'),
            optField('instr.luzGuia', 'Tipo LuzGuia')
          ]
        };
      case 'constInstr':
        return {
          kind: 'menu',
          title: 'Const Instr',
          items: [
            { label: 'ComP:X  -1   Y -12', onSelect: () => genOpen('constComp') },
            { label: 'Colimacion', onSelect: () => genOpen('constColim') }
          ]
        };
      case 'constComp':
        return {
          kind: 'custom',
          fkeys: ['', '', '', 'OK'],
          onF: f => { if (f === 4) genBack(); },
          onEnter: () => genBack(),
          render: () => (
            <>
              <div>DesPlaz. ComPen.</div>
              <div className="flex justify-between"><span>X</span><span>{formatTiltDMSLong(compenX)}</span></div>
              <div className="flex justify-between"><span>Y</span><span>{formatTiltDMSLong(compenY)}</span></div>
              <div className="flex justify-between"><span>HA-D</span><span>{formatDMS(envHD)}</span></div>
              <div className="pl-4">Obs 1er DesPl</div>
            </>
          )
        };
      case 'constColim':
        return {
          kind: 'custom',
          fkeys: ['', '', '', 'OK'],
          onF: f => { if (f === 4) genBack(); },
          onEnter: () => genBack(),
          render: () => (
            <>
              <div>Colimacion</div>
              <div className="flex justify-between"><span>AV</span><span>{formatDMS(envV)}</span></div>
              <div className="flex justify-between"><span>HA-D</span><span>{formatDMS(envHD)}</span></div>
              <div>&nbsp;</div>
              <div className="pl-4">Obs 1er DesPl</div>
            </>
          )
        };
      case 'unidades': {
        const fields: GenField[] = [
          optField('units.temp', 'TemP.'),
          optField('units.pres', 'Pres.'),
          optField('units.ang', 'Angulo'),
          optField('units.dist', 'Dist')
        ];
        if (cfg['units.dist'] !== 'metro') fields.push(optField('units.pie', 'Pie'));
        return { kind: 'form', rowsPerPage: 5, fields };
      }
      case 'teclaFunc':
        return {
          kind: 'menu',
          title: 'Tecla func',
          items: [
            { label: 'Definir', onSelect: () => genOpen('teclaDefinir') },
            { label: 'Registro', onSelect: () => genOpen('teclaRegistro') },
            { label: 'Reclamar', onSelect: () => genOpen('teclaReclamar') }
          ]
        };
      case 'teclaDefinir':
        return {
          kind: 'custom',
          fkeys: ['', '', '', 'OK'],
          onF: f => { if (f === 4) genBack(); },
          onEnter: () => genBack(),
          render: () => (
            <>
              <div>Tecla func</div>
              {[['MED', 'GHV', 'AZ-0', 'COORD'], ['MENU', 'COMP', 'ANG.H', 'EDM'], ['MDR', 'DESPLZ', 'TOPO', 'REPL']].map(row => (
                <div key={row[0]} className="grid grid-cols-4 gap-1 text-center">
                  {row.map(k => <span key={k} className="lcd-inv px-0.5 truncate">{k}</span>)}
                </div>
              ))}
            </>
          )
        };
      case 'teclaRegistro':
        return {
          kind: 'menu',
          title: 'Tecla func',
          items: ['Usuario1', 'Usuario2'].map(u => ({ label: u, onSelect: () => genTimed(`Tecla func||  ${u}|  Registrado`, 1000, () => genPop(2)) }))
        };
      case 'teclaReclamar':
        return {
          kind: 'menu',
          title: 'Tecla func',
          items: ['Usuario1', 'Usuario2', 'Por defecto'].map(u => ({ label: u, onSelect: () => genTimed(`Tecla func||  ${u}|  Cargado`, 1000, () => genPop(2)) }))
        };
      case 'clave':
        return {
          kind: 'input',
          lines: ['Cambiar Clave', param === 'antig' ? 'Clave antig' : 'Clave nueva'],
          alpha: true,
          onEnter: () => {
            if (param === 'antig') { genPop(1); genOpen('clave', 'nueva'); }
            else genTimed('Cambiar Clave||  Clave cambiada', 1000, () => genPop(1));
          }
        };
      case 'fechaHora':
        return {
          kind: 'form',
          title: 'Fecha y hora',
          rowsPerPage: 4,
          fields: [numField('fh.fech', 'Fech'), numField('fh.tiem', 'Tiem')]
        };
      case 'tsshield':
        return {
          kind: 'menu',
          title: 'TSshield',
          items: [
            { label: 'Ajustes', onSelect: () => genOpen('msg', 'TSshield||  Sin conexion|  Pulsar Tecla') },
            { label: 'Actualizacion', onSelect: () => genOpen('msg', 'TSshield||  Sin conexion|  Pulsar Tecla') }
          ]
        };

      // ---------- MED Pág 2 > ANG.H ----------
      case 'angh':
        return {
          kind: 'menu',
          title: 'Fij. Ang.Hor',
          items: [
            { label: 'Angulo', onSelect: () => genOpen('anghAng') },
            { label: 'Coord', onSelect: () => genOpen('anghCoord') }
          ]
        };
      case 'anghAng':
        return {
          kind: 'input',
          lines: ['Fij. Ang.Hor', 'Lect.Ref', `AV  ${lastMeas ? formatDMS(lastMeas.V) : 'Rango exced.'}`, `HA-D  ${formatDMS(envHD)}`],
          alpha: false,
          fkeys: ['REG', '', '', 'OK'],
          onEnter: v => fijarAnguloH(v),
          onF: f => { if (f === 1 || f === 4) fijarAnguloH(inputBuffer); }
        };
      case 'anghCoord':
        return {
          kind: 'form',
          title: 'Intro Ang H Ref',
          rowsPerPage: 4,
          fields: [numField('angRef.X', 'Xref'), numField('angRef.Y', 'Yref'), numField('angRef.Z', 'Zref')],
          fkeys: ['CARG', '', '', 'OK'],
          onF: f => {
            if (f === 1) openPicker('ANGH');
            else if (f === 4) orientarConRef();
          }
        };

      // ---------- MED Pág 3 > MDR ----------
      case 'mdr':
        return {
          kind: 'menu',
          title: 'MDR',
          items: [
            { label: 'Occ.Orien.', onSelect: () => { setOccReturn('GEN'); setActiveField(0); setScreenState('OCC_ORIEN'); } },
            { label: 'MDR', onSelect: () => { setMdr({ pt: 1, p1: null, res: null }); genOpen('mdrObs'); } }
          ]
        };
      case 'mdrObs':
        return {
          kind: 'custom',
          fkeys: ['MOVR', '', 'MED', 'MDR'],
          onF: f => {
            if (f === 1) {
              // MOVR: el último punto medido (PT02) pasa a ser el nuevo punto de inicio
              setMdr(m => ({ ...m, pt: 2, p1: m.p2 ?? m.p1, p2: null, res: null }));
            } else if (f === 3) medirMdr(false);
            else if (f === 4) medirMdr(true);
          },
          render: () => (
            <>
              <div className="flex gap-6"><span>MDR</span><span>Ponga PT{String(mdr.pt).padStart(2, '0')}</span></div>
              {mdr.res ? (
                <>
                  <div className="flex justify-between"><span>dGD</span><span>{mdr.res.dGD.toFixed(3)}m</span></div>
                  <div className="flex justify-between"><span>dHD</span><span>{mdr.res.dHD.toFixed(3)}m</span></div>
                  <div className="flex justify-between"><span>dVD</span><span>{mdr.res.dVD.toFixed(3)}m</span></div>
                </>
              ) : (
                <>
                  <div className="flex justify-between"><span>GD</span><span>{mdr.p1 ? `${mdr.p1.SD.toFixed(3)}m` : ''}</span></div>
                  <div className={mdr.p1 ? 'flex justify-between' : 'flex gap-3'}><span>AV</span><span>{mdr.p1 ? formatDMS(mdr.p1.V) : 'Rango exced.'}</span></div>
                  <div className="flex justify-between"><span>HA-D</span><span>{mdr.p1 ? formatDMS(mdr.p1.HA) : ''}</span></div>
                </>
              )}
            </>
          )
        };
      default:
        return null;
    }
  };

  // ----- Acciones usadas por las pantallas genéricas -----
  const iniciarSalida = (fmt: string) => {
    const sel = salidaSel.length ? salidaSel : [genStack.find(f => f.id === 'salidaJobs')?.idx ?? 0];
    const total = sel.reduce((acc, i) => acc + jobCountAt(i), 0);
    startSending('Salida Comunic.', fmt, total, () => {
      // Los trabajos enviados quedan sin "*" (ya exportados)
      setJobsList(prev => prev.map((j, i) => (sel.includes(i) ? jobClean(j) : j)));
      setSalidaSel([]);
      genExit('JOB_MENU');
    });
  };

  const guardarDispositivo = (i: number, v: string) => {
    const name = v.trim().toUpperCase();
    if (!name) return;
    setBtDevices(d => d.map((x, k) => (k === i ? (x.startsWith('*') ? `*${name}` : name) : x)));
    genTimed('RegistroDisPositivo||  Registrado', 900, () => genPop(2));
  };

  const conectarEntrada = () => {
    genTimed('Entrada Comms|||Conectando...', 1500, () => {
      genPop(1);
      genOpen('msg', 'Entrada Comms|Conexion fallo||  Pulsar Tecla');
    });
  };

  const abrirFechaHora = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setCfg(c => ({
      ...c,
      'fh.fech': `${pad(now.getMonth() + 1)}${pad(now.getDate())}${now.getFullYear()}`,
      'fh.tiem': `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    }));
    genOpen('fechaHora');
  };

  const fijarAnguloH = (v: string) => {
    const val = parseFloat(v);
    if (!isNaN(val)) setEnvHD(((parseDmsInput(val) % 360) + 360) % 360);
    setCompenCtx('MED');
    setCompenReturn('MED');
    genExit('COMPEN');
  };

  const orientarConRef = () => {
    const x = parseFloat(cfg['angRef.X']);
    const y = parseFloat(cfg['angRef.Y']);
    if (!isNaN(x) && !isNaN(y)) {
      const { az } = calcAzDist({ N: y, E: x });
      setAzimutInicial(((az - envHD) % 360 + 360) % 360);
      setIsOriented(true);
    }
    setCompenCtx('MED');
    setCompenReturn('MED');
    genExit('COMPEN');
  };

  // Burbuja fuera de rango (X o Y "****"): el equipo manda a compensar antes de medir
  const fueraDeNivel = () => Math.abs(compenX) > 210 || Math.abs(compenY) > 210;

  const medirMdr = (esMdr: boolean) => {
    if (fueraDeNivel()) {
      setCompenCtx('MED');
      setCompenReturn('GEN');
      setScreenState('COMPEN');
      return;
    }
    startMeasurement(() => {
      const m = leerDistanciometro();
      const haR = m.HA * (Math.PI / 180);
      const p = { x: m.HD * Math.sin(haR), y: m.HD * Math.cos(haR), z: m.VD, SD: m.SD, V: m.V, HA: m.HA };
      if (!esMdr || !mdr.p1) {
        setMdr({ pt: 2, p1: p, res: null });
      } else {
        const dx = p.x - mdr.p1.x;
        const dy = p.y - mdr.p1.y;
        const dz = p.z - mdr.p1.z;
        const dHD = Math.sqrt(dx * dx + dy * dy);
        setMdr(prev => ({ ...prev, p2: p, res: { dGD: Math.sqrt(dHD * dHD + dz * dz), dHD, dVD: dz } }));
      }
    });
  };

  const genView = screenState === 'GEN' && genTop ? buildGenView(genTop.id, genTop.param) : null;

  // Menú con el formato del LCD real: título arriba, opciones con sangría y la seleccionada invertida
  const renderLcdMenu = (title: string, labels: string[], sel: number, onPick: (i: number) => void, subtitle?: string) => {
    const size = subtitle ? 3 : 4;
    const start = Math.max(0, Math.min(sel - 1, labels.length - size));
    return (
      <div className="relative text-[13px] leading-[1.15]">
        <div>{title}</div>
        {subtitle && <div>{subtitle}</div>}
        {labels.slice(start, start + size).map((l, i) => (
          <div key={l} className="pl-3 cursor-pointer" onClick={() => onPick(start + i)}>
            <span className={start + i === sel ? 'lcd-inv px-0.5' : 'px-0.5'}>{l}</span>
          </div>
        ))}
        <span className="absolute right-0 top-0 text-[14px] leading-none">
          {start > 0 ? '▲' : ''}
          {start + size < labels.length ? '▼' : ''}
        </span>
      </div>
    );
  };

  // Campo actual de un formulario genérico
  const genVisibleFields = genView && genView.kind === 'form' ? genView.fields : [];
  const genCurField = genView && genView.kind === 'form' ? genVisibleFields[Math.min(genTop?.idx ?? 0, genVisibleFields.length - 1)] : undefined;
  const genWantsAlpha = !!genView && ((genView.kind === 'input' && genView.alpha) || (genCurField?.kind === 'text'));
  useEffect(() => {
    if (genAlpha !== genWantsAlpha) setGenAlpha(genWantsAlpha);
  }, [genAlpha, genWantsAlpha]);

  const commitGenField = () => {
    if (!genCurField) return;
    if ((genCurField.kind === 'num' || genCurField.kind === 'text') && inputBuffer !== '') {
      setCfgKey(genCurField.key, inputBuffer);
    }
    setInputBuffer('');
  };

  const genFKeyLabels = (): [string, string, string, string] => {
    if (!genView) return ['', '', '', ''];
    if (genView.kind === 'confirm') return ['', '', 'NO', 'SI'];
    if (genView.kind === 'list') return genView.fkeys;
    if (genView.kind === 'custom') return genView.fkeys;
    if (genView.kind === 'input') return genView.fkeys ?? ['', '', '', ''];
    if (genView.kind === 'form') return genView.fkeys ?? ['', '', '', ''];
    return ['', '', '', ''];
  };

  const genItemCount = (): number => {
    if (!genView) return 0;
    if (genView.kind === 'menu') return genView.items.length;
    if (genView.kind === 'form') return genView.fields.length;
    if (genView.kind === 'list') return genView.rows.length;
    return 0;
  };

  // ---------- Manejadores de las pantallas genéricas ----------
  const genHandle = (ev: { type: 'f'; f: 1 | 2 | 3 | 4 } | { type: 'enter' } | { type: 'esc' } | { type: 'arrow'; dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' } | { type: 'key'; key: string } | { type: 'center' }): boolean => {
    if (screenState !== 'GEN') return false;
    if (!genView || !genTop) { genExit(); return true; }
    const idx = genTop.idx;
    const n = genItemCount();

    if (genView.kind === 'msg') {
      if (genView.timed) return true;
      (genView.onKey ?? genBack)();
      return true;
    }
    if (genView.kind === 'confirm') {
      if ((ev.type === 'f' && ev.f === 4) || ev.type === 'enter') genView.onYes();
      else if ((ev.type === 'f' && ev.f === 3) || ev.type === 'esc') (genView.onNo ?? genBack)();
      return true;
    }
    if (ev.type === 'esc') {
      if (genView.kind === 'form') commitGenField();
      genBack();
      return true;
    }
    if (genView.kind === 'menu') {
      if (ev.type === 'arrow' && (ev.dir === 'UP' || ev.dir === 'DOWN')) genSetIdx((idx + (ev.dir === 'DOWN' ? 1 : -1) + n) % n);
      else if (ev.type === 'enter') genView.items[idx]?.onSelect();
      else if (ev.type === 'key') {
        const kk = ev.key.replace('RAW:', '');
        if (/^[1-9]$/.test(kk) && Number(kk) <= n) {
          genSetIdx(Number(kk) - 1);
          genView.items[Number(kk) - 1].onSelect();
        }
      }
      return true;
    }
    if (genView.kind === 'list') {
      if (ev.type === 'arrow' && n && (ev.dir === 'UP' || ev.dir === 'DOWN')) genSetIdx((idx + (ev.dir === 'DOWN' ? 1 : -1) + n) % n);
      else if (ev.type === 'enter') genView.onEnter?.(idx);
      else if (ev.type === 'f') genView.onF(ev.f, idx);
      return true;
    }
    if (genView.kind === 'input') {
      if (ev.type === 'enter') genView.onEnter(inputBuffer);
      else if (ev.type === 'f') genView.onF?.(ev.f);
      else if (ev.type === 'key') setInputBuffer(genView.alpha ? applyKeyToBuffer(ev.key, inputBuffer) : applyNumericKey(ev.key, inputBuffer));
      return true;
    }
    if (genView.kind === 'custom') {
      if (ev.type === 'f') genView.onF(ev.f);
      else if (ev.type === 'enter') genView.onEnter?.();
      return true;
    }
    // Formulario de ajustes
    const field = genCurField;
    if (ev.type === 'arrow') {
      if (ev.dir === 'UP' || ev.dir === 'DOWN') {
        commitGenField();
        genSetIdx((idx + (ev.dir === 'DOWN' ? 1 : -1) + n) % n);
      } else if (field?.kind === 'opt' && field.options) {
        setCfgKey(field.key, cycleOption(field.options, cfg[field.key], ev.dir === 'RIGHT' ? 1 : -1));
      }
      return true;
    }
    if (ev.type === 'center') {
      if (field?.kind === 'opt' && field.options) setCfgKey(field.key, cycleOption(field.options, cfg[field.key], 1));
      return true;
    }
    if (ev.type === 'enter') {
      if (field?.kind === 'link') field.onSelect?.();
      else {
        commitGenField();
        genSetIdx((idx + 1) % n);
      }
      return true;
    }
    if (ev.type === 'f') {
      commitGenField();
      genView.onF?.(ev.f);
      return true;
    }
    if (ev.type === 'key') {
      if (field?.kind === 'num') {
        // Fecha y hora: solo dígitos (MMDDAAAA / HHMMSS); el resto, número con signo y decimal
        if (field.key.startsWith('fh.')) setInputBuffer(ev.key === 'BS' ? inputBuffer.slice(0, -1) : /^\d$/.test(ev.key) ? inputBuffer + ev.key : inputBuffer);
        else setInputBuffer(applyNumericKey(ev.key, inputBuffer));
      }
      if (field?.kind === 'text') setInputBuffer(applyKeyToBuffer(ev.key, inputBuffer));
      return true;
    }
    return true;
  };

  // ---------- Estrella: 9 opciones (Ent. Menu, ComPens., Contraste, Niv Retic, Reflector, Plom Laser, Niv. Laser, Mant.Illum, Punteo-L) ----------
  type StarField = { key: string; label: string; opts?: string[]; level?: [number, number] };
  const STAR_FIELDS: StarField[] = [
    { key: 'entMenu', label: 'Ent. Menu' },
    { key: 'obs.compens', label: 'ComPens.', opts: ['Si(H,V)', 'Si(V)', 'No'] },
    { key: 'contraste', label: 'Contraste', level: [0, 15] },
    { key: 'retic', label: 'Niv Retic', level: [0, 5] },
    { key: 'reflector', label: 'Reflector', opts: ['Prism', 'Diana', 'N-Prism'] },
    { key: 'plomLaser', label: 'Plom Laser', opts: ['Off', 'On'] },
    { key: 'nivLaser', label: 'Niv. Laser', level: [0, 5] },
    { key: 'mantIlum', label: 'Mant.Illum', opts: ['Laser', 'Guia'] },
    { key: 'punteo', label: 'Punteo-L', opts: ['Off', 'On'] }
  ];
  const starGet = (key: string): string => {
    if (key === 'reflector') return currentReflectorName === 'Prisma' ? 'Prism' : currentReflectorName;
    if (key === 'mantIlum') return edmCfg.mantIlum === 'Guía' ? 'Guia' : 'Laser';
    return cfg[key] ?? '';
  };
  const starSet = (key: string, v: string) => {
    if (key === 'reflector') setReflectorByName(v === 'Prism' ? 'Prisma' : v);
    else if (key === 'mantIlum') setEdmCfg(c => ({ ...c, mantIlum: v === 'Guia' ? 'Guía' : 'Láser' }));
    else setCfgKey(key, v);
  };
  const starFKeyLabels = (): [string, string, string, string] => {
    const fld = STAR_FIELDS[starField];
    if (!fld.opts && !fld.level) return ['', '', '', 'ENT'];
    if (fld.level) return ['', '', '', ''];
    if (fld.opts && fld.opts.length === 3) return [fld.opts[0], fld.opts[1], fld.opts[2], ''];
    return ['', fld.opts?.[0] || '', fld.opts?.[1] || '', ''];
  };

  // Lógica común de los códigos Cd (Estacionamiento u Observación)
  const codeApply = (cd: string) => {
    if (codeTarget === 'OBS') {
      setTarget(t => ({ ...t, CD: cd }));
      setInputBuffer(cd);
      setScreenState('OBS');
      setActiveField(1);
    } else {
      setStationAtm(a => ({ ...a, CD: cd }));
      setInputBuffer(cd);
      setScreenState('OCC_ORIEN');
      setActiveField(5);
    }
  };
  const codeReturnScreen = () => {
    if (codeTarget === 'OBS') { setScreenState('OBS'); setActiveField(1); }
    else { setScreenState('OCC_ORIEN'); setActiveField(5); }
  };

  const OBS2_ORDER = [2, 1, 0]; // HD -> Cd -> PTO (PTO en su propia pantalla, como el equipo)

  const togglePlomada = () => {
    const on = cfg['plomLaser'] !== 'On';
    setCfgKey('plomLaser', on ? 'On' : 'Off');
    setLcdMessage(on ? 'PLOMADA LÁSER\nENCENDIDA' : 'PLOMADA LÁSER\nAPAGADA');
  };

  const commitJobDetails = () => {
    if (activeField === 0 && inputBuffer.trim()) {
      const clean = inputBuffer.trim();
      const oldClean = jobClean(jobName);
      setJobName(clean);
      setJobsList(prev => prev.map(j => (jobClean(j) === oldClean ? (j.startsWith('*') ? `*${clean}` : clean) : j)));
    }
    if (activeField === 1 && inputBuffer.trim() && !isNaN(parseFloat(inputBuffer))) {
      setJobScale(parseFloat(inputBuffer).toFixed(8));
    }
  };

  const commitReplCoord = () => {
    if (inputBuffer.trim() === '') return;
    const v = parseFloat(inputBuffer);
    if (isNaN(v)) return;
    if (activeField === 3) setTarget(t => ({ ...t, HR: v }));
    else {
      setReplPoint(p => {
        const base = p ?? { PTO: '1', N: 0, E: 0, Z: 0, CD: '' };
        if (activeField === 0) return { ...base, E: v };
        if (activeField === 1) return { ...base, N: v };
        return { ...base, Z: v };
      });
    }
    setInputBuffer('');
  };

  const KNOWN_ITEMS = ['Entra. Coord', 'Entrada Comms', 'Borrar', 'Ver', 'Claro', 'Config.Comunic.'];
  const abrirKnownItem = (i: number) => {
    setKnownMenuSelection(i);
    if (i === 1) { setScreenState('KNOWN_INPUT'); setActiveField(0); setInputBuffer(knownCoordsInput.Y); }
    else if (i === 2) genOpen('entComms');
    else if (i === 3) { setScreenState('KNOWN_DEL'); setSelectedKnownIdx(0); }
    else if (i === 4) { setScreenState('KNOWN_VIEW'); setViewKnownIdx(0); }
    else if (i === 5) genOpen('knownClaro');
    else genOpen('comCfg');
  };

  const abrirDatoItem = (i: number) => {
    setMenuSelection(i);
    if (i === 1) { setScreenState('JOB_MENU'); setJobMenuSelection(1); }
    else if (i === 2) { setScreenState('KNOWN_MENU'); setKnownMenuSelection(1); }
    else genOpen('cod');
  };

  const ov2FKey = (f: 1 | 2 | 3 | 4): boolean => {
    if (measureAnim.active) return false;
    if (isStarMenuOpen && starMode === 'SETTINGS') {
      const fld = STAR_FIELDS[starField];
      if (!fld.opts && !fld.level) {
        if (f === 4) { setStarMode('MENU'); setStarMenuIdx(0); }
      } else if (fld.opts) {
        const start = fld.opts.length === 3 ? 1 : 2;
        const opt = fld.opts[f - start];
        if (opt) starSet(fld.key, opt);
      }
      return true;
    }
    if (isStarMenuOpen) return false;
    switch (screenState) {
      case 'TILT':
        if (f === 1) setScreenState('ROOT');
        else if (f === 2) togglePlomada();
        return true;
      case 'COMPEN':
        if (f === 2) { togglePlomada(); return true; }
        return false;
      case 'ROOT':
        if (f === 4) { genOpen('cnfg'); return true; }
        return false;
      case 'MED':
        if (medPage === 1 && f === 1 && fueraDeNivel()) { goCompen('MED', 'MED'); return true; }
        if (medPage === 2 && f === 3) { genOpen('angh'); return true; }
        if (medPage === 3 && f === 1) { genOpen('mdr'); return true; }
        return false;
      case 'USB_MENU':
      case 'DATO_MENU':
      case 'JOB_MENU':
      case 'KNOWN_MENU':
      case 'JOB_LIST':
      case 'JOB_DELETE_LIST':
        return true;
      case 'JOB_SELECT':
        return f !== 1;
      case 'JOB_DETAILS':
        if (f === 4) { commitJobDetails(); setInputBuffer(''); setActiveField(0); setScreenState('JOB_MENU'); }
        return true;
      case 'KNOWN_DEL': {
        const n = knownPoints.length;
        if (f === 1) setSelectedKnownIdx(i => (i + 5 < n ? i + 5 : 0));
        else if (f === 2) setSelectedKnownIdx(0);
        else if (f === 3) setSelectedKnownIdx(Math.max(0, n - 1));
        else if (n > 0) setScreenState('KNOWN_DEL_CONFIRM');
        return true;
      }
      case 'TRISEC_PT':
        if (f === 3 || f === 4) {
          if (fueraDeNivel()) { goCompen('TRISEC', 'OCC_TRISEC'); return true; }
          if (f === 3) { playLaserBeep(); setTrisecAng({ V: envV, HA: envHD }); }
          else startMeasurement(() => { leerDistanciometro(); setTrisecAng({ V: envV, HA: envHD }); });
        }
        return true;
      case 'OBS':
        if (activeField === 1) {
          commitCurrentField();
          const cd = (inputBuffer.trim() || target.CD).toUpperCase();
          setCodeTarget('OBS');
          if (f === 1) { setCodeSearchBuffer(cd); setScreenState('CODE_ADD'); }
          else if (f === 2) { const i = codeList.indexOf(cd); setCodeIdx(i >= 0 ? i : 0); setScreenState('CODE_LIST'); }
          else if (f === 3) { setCodeSearchBuffer(''); setCodeIdx(0); setScreenState('CODE_SEARCH'); }
          return true;
        }
        if ((f === 3 || f === 4) && fueraDeNivel()) { commitCurrentField(); goCompen('OBS', obsReturn); return true; }
        return false;
      case 'REPL_OBS':
        if (f === 1) registrarPuntoObservado();
        else if (f === 2) setMedView(v => (v === 'GHV' ? 'NORMAL' : 'GHV'));
        else if (f === 3) setLcdMessage('← → DESPLAZAR\nVISTA DE REPLANTEO');
        else if (fueraDeNivel()) goCompen('REPL', 'REPLANTEO_MENU');
        else startMeasurement(() => { leerDistanciometro(); });
        return true;
      case 'OCC_ORIEN':
        if (activeField === 5) setCodeTarget('OCC');
        return false;
      default:
        return false;
    }
  };

  const ov2Enter = (): boolean => {
    if (measureAnim.active) return false;
    if (isStarMenuOpen && starMode === 'SETTINGS') {
      if (starField === 0) { setStarMode('MENU'); setStarMenuIdx(0); }
      else setStarField(i => (i + 1) % STAR_FIELDS.length);
      return true;
    }
    if (isStarMenuOpen) return false;
    switch (screenState) {
      case 'USB_MENU':
        genOpen('usbType', usbMenuSelection === 1 ? 'T' : 'S');
        return true;
      case 'DATO_MENU':
        abrirDatoItem(Math.min(3, Math.max(1, menuSelection)));
        return true;
      case 'JOB_MENU':
        if (jobMenuSelection === 4) { genOpen('salida'); return true; }
        if (jobMenuSelection === 5) { genOpen('comCfg'); return true; }
        if (jobMenuSelection === 2) { setActiveField(0); setInputMode('ALF'); setScreenState('JOB_DETAILS'); return true; }
        return false;
      case 'JOB_SELECT':
        setScreenState('JOB_MENU');
        return true;
      case 'JOB_DETAILS':
        commitJobDetails();
        setActiveField(f => (f === 0 ? 1 : 0));
        return true;
      case 'JOB_DELETE_LIST': {
        const job = jobsList[selectedJobIdx];
        if (!job) return true;
        if (job.startsWith('*')) genOpen('msg', '|Enviar 1ro||  Pulsar Tecla');
        else genOpen('jobDelConfirm', String(selectedJobIdx));
        return true;
      }
      case 'KNOWN_MENU':
        abrirKnownItem(Math.min(6, Math.max(1, knownMenuSelection)));
        return true;
      case 'KNOWN_DEL':
        if (knownPoints.length > 0) setScreenState('KNOWN_DEL_CONFIRM');
        return true;
      case 'OBS': {
        commitCurrentField();
        const pos = OBS2_ORDER.indexOf(activeField);
        setActiveField(OBS2_ORDER[(pos + 1) % OBS2_ORDER.length]);
        return true;
      }
      case 'REPL_DATA':
        if (replDisplayMode === 'COORD') {
          commitReplCoord();
          setActiveField(f => (f + 1) % 4);
          return true;
        }
        return false;
      case 'REPL_OBS':
        return true;
      case 'TOPO_MENU':
        if (topoMenuSelection === 1) { goObservacion('TOPO_MENU'); return true; }
        return false;
      case 'REPLANTEO_MENU':
        if (replMenuSelection === 3) { goCompen('REPL', 'REPLANTEO_MENU'); return true; }
        if (replMenuSelection === 1) setOccReturn('REPLANTEO_MENU');
        return false;
      case 'COORD_MENU':
        if (menuSelection === 1) setOccReturn('COORD_MENU');
        return false;
      case 'DESPLZ_MENU':
        if (desplzReturn === 'OBS') { setLcdMessage('DESPLZ:\nEN DESARROLLO'); return true; }
        if (desplzMenuSelection === 1) setOccReturn('DESPLZ_MENU');
        return false;
      default:
        return false;
    }
  };

  const ov2Esc = (): boolean => {
    if (measureAnim.active || isStarMenuOpen) return false;
    switch (screenState) {
      case 'ROOT':
        setScreenState('MED');
        setMedPage(1);
        return true;
      case 'COMPEN':
        if (compenCtx === 'OBS') { goObservacion(compenReturn); return true; }
        return false;
      case 'OCC_ORIEN':
        commitCurrentField();
        setActiveField(0);
        setScreenState(occReturn === 'GEN' && genStack.length === 0 ? 'COORD_MENU' : occReturn);
        return true;
      case 'USB_SAVE_JOB':
        setGenReturn('USB_MENU');
        setGenStack([{ id: 'usbType', idx: 0, param: usbTypeMode }]);
        setScreenState('GEN');
        return true;
      case 'REPL_OBS':
        setInputBuffer('');
        setActiveField(0);
        setReplDisplayMode('COORD');
        setScreenState('REPL_DATA');
        return true;
      case 'JOB_DETAILS':
        setInputBuffer('');
        setActiveField(0);
        setScreenState('JOB_MENU');
        return true;
      case 'CODE_LIST':
      case 'CODE_SEARCH':
      case 'CODE_ADD':
        codeReturnScreen();
        return true;
      default:
        return false;
    }
  };

  const ov2Arrow = (dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'): boolean => {
    if (measureAnim.active) return false;
    const vert = dir === 'UP' || dir === 'DOWN';
    const d = dir === 'DOWN' || dir === 'RIGHT' ? 1 : -1;
    if (isStarMenuOpen && starMode === 'SETTINGS') {
      if (vert) setStarField(i => (i + d + STAR_FIELDS.length) % STAR_FIELDS.length);
      else {
        const fld = STAR_FIELDS[starField];
        if (fld.level) {
          const cur = parseInt(starGet(fld.key), 10) || 0;
          starSet(fld.key, String(Math.max(fld.level[0], Math.min(fld.level[1], cur + d))));
        } else if (fld.opts) starSet(fld.key, cycleOption(fld.opts, starGet(fld.key), d as 1 | -1));
      }
      return true;
    }
    if (isStarMenuOpen) return false;
    switch (screenState) {
      case 'TILT':
        if (vert) setCompenY(y => Math.max(-COMPEN_LIMIT, Math.min(COMPEN_LIMIT, y + (dir === 'UP' ? 10 : -10))));
        else setCompenX(x => Math.max(-COMPEN_LIMIT, Math.min(COMPEN_LIMIT, x + d * 10)));
        return true;
      case 'DATO_MENU':
        if (vert) setMenuSelection(s => ((s - 1 + d + 3) % 3) + 1);
        return true;
      case 'KNOWN_MENU':
        if (vert) setKnownMenuSelection(s => ((s - 1 + d + 6) % 6) + 1);
        return true;
      case 'JOB_DETAILS':
        if (vert) { commitJobDetails(); setActiveField(f => (f === 0 ? 1 : 0)); }
        return true;
      case 'OBS':
        if (vert) {
          commitCurrentField();
          const pos = OBS2_ORDER.indexOf(activeField);
          setActiveField(OBS2_ORDER[(pos + d + OBS2_ORDER.length) % OBS2_ORDER.length]);
        }
        return true;
      case 'REPL_DATA':
        if (replDisplayMode === 'COORD') {
          if (vert) { commitReplCoord(); setActiveField(f => (f + d + 4) % 4); }
          return true;
        }
        return false;
      case 'DESPLZ_MENU':
        if (desplzReturn === 'OBS') {
          if (vert) setDesplzMenuSelection(s => ((s - 1 + d + 3) % 3) + 1);
          return true;
        }
        return false;
      default:
        return false;
    }
  };

  const ov2Key = (key: string): boolean => {
    if (measureAnim.active || isStarMenuOpen) return false;
    switch (screenState) {
      case 'DATO_MENU':
        if (/^[123]$/.test(key)) abrirDatoItem(Number(key));
        return true;
      case 'KNOWN_MENU':
        if (/^[1-6]$/.test(key)) abrirKnownItem(Number(key));
        return true;
      case 'USB_MENU':
        if (key === '1' || key === '2') { setUsbMenuSelection(Number(key)); genOpen('usbType', key === '1' ? 'T' : 'S'); }
        return true;
      case 'JOB_MENU':
        if (key === '4') { setJobMenuSelection(4); genOpen('salida'); return true; }
        if (key === '5') { setJobMenuSelection(5); genOpen('comCfg'); return true; }
        if (key === '2') { setJobMenuSelection(2); setActiveField(0); setInputMode('ALF'); setScreenState('JOB_DETAILS'); return true; }
        return false;
      case 'JOB_DETAILS':
        if (activeField === 1) { setInputBuffer(applyNumericKey(key, inputBuffer)); return true; }
        return false;
      case 'COORD_MENU':
        if (key === '1') setOccReturn('COORD_MENU');
        return false;
      case 'TOPO_MENU':
        if (key === '1') { setTopoMenuSelection(1); goObservacion('TOPO_MENU'); return true; }
        return false;
      case 'REPLANTEO_MENU':
        if (key === '3') { setReplMenuSelection(3); goCompen('REPL', 'REPLANTEO_MENU'); return true; }
        if (key === '1') setOccReturn('REPLANTEO_MENU');
        return false;
      case 'REPL_DATA':
        if (replDisplayMode === 'COORD') { setInputBuffer(applyNumericKey(key, inputBuffer)); return true; }
        return false;
      default:
        return false;
    }
  };

  // Orden: pantallas genéricas (14-10) -> correcciones 14-10 -> correcciones 12-10 -> manejadores originales
  overrideRef.current = {
    fkey: f => genHandle({ type: 'f', f }) || ov2FKey(f) || ovFKey(f),
    enter: () => genHandle({ type: 'enter' }) || ov2Enter() || ovEnter(),
    esc: () => genHandle({ type: 'esc' }) || ov2Esc() || ovEsc(),
    arrow: dir => genHandle({ type: 'arrow', dir }) || ov2Arrow(dir) || ovArrow(dir),
    key: key => genHandle({ type: 'key', key }) || ov2Key(key) || ovKey(key),
    shift: ovShift,
    func: () => (screenState === 'GEN' ? true : ovFunc()),
    center: () => {
      genHandle({ type: 'center' });
    }
  };

  // Soporte directo para teclado físico de PC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Teclado de PC en campos de texto: escribe el carácter tal cual (sin multi-pulsación)
      if (isCurrentFieldAlpha && e.key.length === 1 && /^[a-zA-Z0-9_\-\s.]$/.test(e.key)) {
        e.preventDefault();
        handleKeypadPress(`RAW:${e.key.toUpperCase()}`);
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        handleKeypadPress(e.key);
      } else if (e.key === '.') {
        handleKeypadPress('.');
      } else if (e.key === '-') {
        handleKeypadPress('-');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleKeypadPress('BS');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleEnterPress();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleEscPress();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleArrow('UP');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleArrow('DOWN');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleArrow('LEFT');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleArrow('RIGHT');
      } else if (e.key === 'F1') {
        e.preventDefault();
        handleFKey(1);
      } else if (e.key === 'F2') {
        e.preventDefault();
        handleFKey(2);
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleFKey(3);
      } else if (e.key === 'F4') {
        e.preventDefault();
        handleFKey(4);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeypadPress, handleEnterPress, handleEscPress, handleArrow, handleFKey, isCurrentFieldAlpha]);

  // Etiquetas dinámicas para F1-F4 según la máquina de estados
  const getFKeyLabels = (): [string, string, string, string] => {
    const ovLabels = overrideFKeyLabels();
    if (ovLabels) return ovLabels;
    switch (screenState) {
      case 'TILT':
        return ['OK', '', '', 'TILT'];
      case 'COMPEN':
        return ['OK', 'PLGETT', '', ''];
      case 'ROOT':
        return ['OBS', 'USB', 'DATO', 'CNFG'];
      case 'MED':
        if (showTaraSoftkey) return ['', '', '', 'TARA'];
        if (medPage === 1) return ['MENU', 'COMP', 'RNG H', 'EDM'];
        if (medPage === 2) return ['MDR', 'DESPLZ', 'TOPO', 'REPL'];
        return ['MED', 'G V', 'AZ-0', 'COORD'];
      case 'MAIN':
        return mainPage === 1
          ? ['DIST', 'SHV', 'OSET', 'COORD']
          : ['DATO', 'USB', 'TILT', 'COORD'];
      case 'OCC_LOAD_LIST':
        return ['1RO', 'ULTIM', 'BUSC', ''];
      case 'OCC_LOAD_SEARCH':
        return ['', '', '', 'OK'];
      case 'OCC_ACLER':
        return ['REG', '', '', 'OK'];
      case 'GRAPHIC_MENU':
      case 'REPLANTEO_MENU':
      case 'TOPO_MENU':
      case 'OCC_TRISEC':
      case 'COORD_MENU':
      case 'DATO_MENU':
      case 'JOB_MENU':
      case 'KNOWN_MENU':
      case 'USB_MENU':
      case 'USB_TTYPE':
      case 'DESPLZ_MENU':
        return ['', '', '', 'ENT'];
      case 'EDM_MENU':
        return ['', '', '', ''];
      case 'REPL_DATA':
        return ['CARG', 'DISP', '', 'OK'];
      case 'TOPO_NOTA':
        return ['', '', '', 'OK'];
      case 'TOPO_VER':
        return [topoVerPage === 1 ? 'P-1' : 'P-2', '1RO', 'ULTIM', 'BUSC'];
      case 'KNOWN_INPUT':
        return ['', '', isAlphaKeyboardOpen ? 'NUM' : 'ALF', 'OK'];
      case 'KNOWN_DEL':
        return ['ANT', 'SIG', 'ESC', 'BORR'];
      case 'KNOWN_DEL_CONFIRM':
        return ['', '', 'NO', 'SI'];
      case 'KNOWN_VIEW':
        return ['ANT', 'SIG', '', 'ESC'];
      case 'JOB_SELECT':
        return ['LIST', '', '', 'OK'];
      case 'JOB_LIST':
        return ['ANT', 'SIG', 'ESC', 'ENT'];
      case 'JOB_DETAILS':
        return ['', '', isAlphaKeyboardOpen ? 'NUM' : 'ALF', 'OK'];
      case 'JOB_DELETE_LIST':
        return ['ANT', 'SIG', 'ESC', 'ENT'];
      case 'JOB_DELETE_CONFIRM':
        return ['', '', 'NO', 'SI'];
      case 'USB_SAVE_JOB':
        return ['ANT', 'SIG', 'ESC', 'ENT'];
      case 'USB_FORMAT':
        return ['', '', 'ESC', 'ENT'];
      case 'JOB':
        return ['LIST', '', isAlphaKeyboardOpen ? 'NUM' : 'ALF', 'ENT'];
      case 'KNOWN_PTS':
        return ['NUEV', 'ANT', 'SIG', 'SALIR'];
      case 'KNOWN_NEW':
        return ['', '', isAlphaKeyboardOpen ? 'NUM' : 'ALF', 'REG'];
      case 'SELECT_KNOWN_PT':
        return ['ANT', 'SIG', 'ESC', 'CARG'];
      case 'OCC_ORIEN':
        return ['CARG', 'ACLE.R', 'E.RXYZ', 'TRISEC'];
      case 'ERXYZ':
        return ['CARG', '', 'AZIM', 'OK'];
      case 'CHECK_BS':
        return ['REG', 'MED', 'NO', 'SI'];
      case 'CHECK_BS_DIST':
        return ['REG', 'ALT', '', 'OK'];
      case 'OBS':
        return ['REG', 'DESPLZ', 'AUTO', 'MED'];
      default:
        return ['', '', '', ''];
    }
  };

  const fLabels = getFKeyLabels();


  // Arte dinámico SVG/LCD para las opciones del Menú Gráfico Principal
  const renderGraphicMenuSvg = (id: string) => {
    switch (id) {
      case 'coord':
        // Opción Coord: Ícono por defecto (Punto y líneas)
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <line x1="40" y1="8" x2="40" y2="72" strokeWidth="2" />
            <line x1="8" y1="40" x2="72" y2="40" strokeWidth="2" />
            <polygon points="40,5 37,11 43,11" fill="currentColor" />
            <polygon points="75,40 69,37 69,43" fill="currentColor" />
            <circle cx="40" cy="40" r="3" fill="currentColor" />
            <circle cx="58" cy="22" r="4" fill="currentColor" />
            <line x1="58" y1="22" x2="58" y2="40" strokeWidth="1.5" strokeDasharray="2,2" />
            <line x1="58" y1="22" x2="40" y2="22" strokeWidth="1.5" strokeDasharray="2,2" />
            <circle cx="40" cy="40" r="24" strokeWidth="1" strokeDasharray="3,3" />
          </svg>
        );
      case 'replanteo':
        // Opción RePlanteo: Ícono de un martillo y un clavo
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <line x1="10" y1="68" x2="70" y2="68" strokeWidth="2.5" />
            <rect x="33" y="42" width="14" height="4" rx="1" fill="currentColor" />
            <line x1="40" y1="46" x2="40" y2="68" strokeWidth="3.5" strokeLinecap="round" />
            <polygon points="38,68 42,68 40,73" fill="currentColor" />
            <g transform="rotate(-25 40 40)">
              <rect x="24" y="24" width="22" height="12" rx="1.5" fill="currentColor" />
              <rect x="22" y="26" width="3" height="8" fill="currentColor" />
              <line x1="35" y1="24" x2="35" y2="-12" strokeWidth="5" strokeLinecap="round" />
            </g>
            <line x1="28" y1="36" x2="22" y2="34" strokeWidth="1.5" />
            <line x1="30" y1="46" x2="24" y2="48" strokeWidth="1.5" />
            <line x1="50" y1="38" x2="56" y2="36" strokeWidth="1.5" />
          </svg>
        );
      case 'desplz':
        // Opción DesPlz.: Ícono de un cilindro hueco (prisma)
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <ellipse cx="40" cy="22" rx="22" ry="9" strokeWidth="2" />
            <ellipse cx="40" cy="22" rx="13" ry="5.5" strokeWidth="1.8" fill="rgba(0,0,0,0.15)" />
            <polygon points="40,24 35,32 45,32" fill="currentColor" />
            <line x1="18" y1="22" x2="18" y2="54" strokeWidth="2" />
            <line x1="62" y1="22" x2="62" y2="54" strokeWidth="2" />
            <path d="M 18,54 A 22,9 0 0,0 62,54" strokeWidth="2" />
            <path d="M 14,68 L 66,68 M 19,65 L 14,68 L 19,71 M 61,65 L 66,68 L 61,71" strokeWidth="1.8" />
          </svg>
        );
      case 'topo':
        // Opción ToPografia: Ícono de cuatro puntos conectados formando una figura/terreno
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <polygon points="18,28 62,18 64,54 22,62" strokeWidth="2" strokeLinejoin="round" fill="rgba(0,0,0,0.06)" />
            <path d="M 20,44 Q 40,32 63,36" strokeWidth="1.2" strokeDasharray="3,2" />
            <path d="M 21,53 Q 42,44 63,47" strokeWidth="1.2" strokeDasharray="3,2" />
            <circle cx="18" cy="28" r="4.5" fill="currentColor" />
            <circle cx="62" cy="18" r="4.5" fill="currentColor" />
            <circle cx="64" cy="54" r="4.5" fill="currentColor" />
            <circle cx="22" cy="62" r="4.5" fill="currentColor" />
          </svg>
        );
      case 'mdr':
        // Opción MDR: Ícono de una línea angulada con altura
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <line x1="10" y1="68" x2="70" y2="68" strokeWidth="2" />
            <polygon points="18,68 14,62 22,62" fill="currentColor" />
            <line x1="18" y1="62" x2="58" y2="52" strokeWidth="2" />
            <circle cx="58" cy="52" r="3.5" fill="currentColor" />
            <line x1="18" y1="62" x2="58" y2="20" strokeWidth="1.5" strokeDasharray="3,2" />
            <circle cx="58" cy="20" r="3.5" fill="currentColor" />
            <line x1="58" y1="20" x2="58" y2="52" strokeWidth="2.5" />
            <polygon points="58,18 55,24 61,24" fill="currentColor" />
            <polygon points="58,54 55,48 61,48" fill="currentColor" />
            <path d="M 28,62 A 12,12 0 0,0 26,56" strokeWidth="1.5" />
          </svg>
        );
      case 'mer':
        // Opción MER: Medición de Elevación Remota (prisma abajo, punto alto encima)
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <line x1="8" y1="70" x2="72" y2="70" strokeWidth="2" />
            <line x1="56" y1="70" x2="56" y2="14" strokeWidth="2.5" />
            <circle cx="56" cy="14" r="4" fill="currentColor" />
            <polygon points="56,62 51,70 61,70" fill="currentColor" />
            <line x1="16" y1="64" x2="56" y2="62" strokeWidth="1.5" />
            <line x1="16" y1="64" x2="56" y2="14" strokeWidth="1.5" strokeDasharray="3,2" />
            <rect x="12" y="62" width="8" height="8" fill="currentColor" />
          </svg>
        );
      case 'intersec':
        // Opción Intersec.: intersección de dos líneas
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <line x1="10" y1="66" x2="70" y2="18" strokeWidth="2" />
            <line x1="10" y1="22" x2="70" y2="62" strokeWidth="2" />
            <circle cx="10" cy="66" r="3" fill="currentColor" />
            <circle cx="10" cy="22" r="3" fill="currentColor" />
            <circle cx="40" cy="42" r="5" strokeWidth="2" />
          </svg>
        );
      case 'calc_area':
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <polygon points="16,36 34,16 66,26 60,62 26,66" strokeWidth="2" fill="rgba(0,0,0,0.12)" strokeLinejoin="round" />
            <line x1="22" y1="46" x2="56" y2="24" strokeWidth="1" strokeDasharray="2,2" />
            <line x1="28" y1="60" x2="62" y2="38" strokeWidth="1" strokeDasharray="2,2" />
            <circle cx="16" cy="36" r="3" fill="currentColor" />
            <circle cx="34" cy="16" r="3" fill="currentColor" />
            <circle cx="66" cy="26" r="3" fill="currentColor" />
            <circle cx="60" cy="62" r="3" fill="currentColor" />
            <circle cx="26" cy="66" r="3" fill="currentColor" />
          </svg>
        );
      case 'repl_linea':
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <line x1="12" y1="58" x2="68" y2="22" strokeWidth="2.5" />
            <circle cx="12" cy="58" r="3.5" fill="currentColor" />
            <circle cx="68" cy="22" r="3.5" fill="currentColor" />
            <circle cx="48" cy="52" r="4" fill="currentColor" />
            <line x1="48" y1="52" x2="40" y2="40" strokeWidth="1.8" strokeDasharray="2,2" />
            <path d="M 40,40 L 44,43 L 42,45" strokeWidth="1.2" />
          </svg>
        );
      case 'repl_arco':
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <circle cx="20" cy="65" r="3" fill="currentColor" />
            <path d="M 22,25 A 45,45 0 0,1 68,62" strokeWidth="2.5" />
            <line x1="20" y1="65" x2="48" y2="34" strokeWidth="1.5" strokeDasharray="3,2" />
            <circle cx="48" cy="34" r="3.5" fill="currentColor" />
            <circle cx="22" cy="25" r="3" fill="currentColor" />
            <circle cx="68" cy="62" r="3" fill="currentColor" />
          </svg>
        );
      case 'proyecto_p':
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <line x1="12" y1="60" x2="68" y2="40" strokeWidth="2.5" />
            <circle cx="40" cy="18" r="4" fill="currentColor" />
            <line x1="40" y1="18" x2="40" y2="50" strokeWidth="2" strokeDasharray="3,2" />
            <circle cx="40" cy="50" r="3" fill="currentColor" />
            <path d="M 40,43 L 46,41 L 46,48" strokeWidth="1.2" />
          </svg>
        );
      case 'pt_a_linea':
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <line x1="14" y1="64" x2="66" y2="32" strokeWidth="2.5" />
            <circle cx="14" cy="64" r="3" fill="currentColor" />
            <circle cx="66" cy="32" r="3" fill="currentColor" />
            <circle cx="32" cy="26" r="4" fill="currentColor" />
            <line x1="32" y1="26" x2="44" y2="46" strokeWidth="2" strokeDasharray="2,2" />
            <polygon points="44,46 41,40 47,43" fill="currentColor" />
          </svg>
        );
      case 'poligonal':
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <polyline points="14,64 28,34 52,48 68,18" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="14" cy="64" r="3.5" fill="currentColor" />
            <circle cx="28" cy="34" r="3.5" fill="currentColor" />
            <circle cx="52" cy="48" r="3.5" fill="currentColor" />
            <circle cx="68" cy="18" r="3.5" fill="currentColor" />
            <path d="M 24,42 A 8,8 0 0,0 34,40" strokeWidth="1.2" />
            <path d="M 46,44 A 8,8 0 0,0 56,40" strokeWidth="1.2" />
          </svg>
        );
      case 'vial':
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <path d="M 12,68 C 24,52 28,38 34,14" strokeWidth="2.5" />
            <path d="M 68,68 C 56,52 52,38 46,14" strokeWidth="2.5" />
            <path d="M 40,68 C 40,52 40,38 40,14" strokeWidth="1.8" strokeDasharray="5,4" />
          </svg>
        );
      case 'per_trans':
        return (
          <svg viewBox="0 0 80 80" className="w-full h-full" stroke="currentColor" fill="none">
            <path d="M 10,48 Q 40,38 70,30" strokeWidth="1.5" strokeDasharray="3,2" />
            <polyline points="14,56 26,42 54,42 66,56" strokeWidth="2.5" strokeLinejoin="round" />
            <line x1="40" y1="20" x2="40" y2="66" strokeWidth="1.5" strokeDasharray="4,2" />
            <circle cx="40" cy="42" r="3" fill="currentColor" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#F3EFE7] text-[#26231E] antialiased select-none font-sans justify-between">
      
      {/* BARRA SUPERIOR CON LOGO OFICIAL, FONDO GRIS-CREMA Y MOSTAZA */}
      <header className="border-b border-[#DDD6C7] bg-[#FAF8F5]/95 px-5 py-2.5 backdrop-blur flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <img
            src="/topcon-logo.jpg"
            alt="Topcon ES-105"
            className="w-9 h-9 rounded-full object-cover border-2 border-[#D99414] shadow-xs"
          />
          <div className="bg-[#D99414] text-white font-black px-2.5 py-0.5 rounded text-xs tracking-wider shadow-xs">
            TOPCON
          </div>
          <div>
            <h1 className="text-sm font-bold text-[#26231E] flex items-center gap-2">
              Emulador Físico Topcon ES-105
              <span className="text-xs font-mono font-medium bg-[#EFEAE0] text-[#945F03] px-2 py-0.5 rounded border border-[#DDD6C7]">
                100% On-Board • Sin Interfaz Web
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowKeyboardHelp(k => !k)}
            className="p-1.5 rounded-lg border border-[#DDD6C7] bg-[#EFEAE0] hover:bg-white text-[#544E43] hover:text-[#26231E] text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Ver controles"
          >
            <Keyboard size={14} className="text-[#D99414]" />
            <span className="hidden sm:inline">Guía de Teclas</span>
          </button>

          <button
            onClick={() => setSoundEnabled(s => !s)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              soundEnabled
                ? 'bg-[#EFEAE0] border-[#D99414]/50 text-[#945F03]'
                : 'bg-[#F3EFE7] border-[#DDD6C7] text-[#8C8373]'
            }`}
            title="Audio de zumbador físico"
          >
            {soundEnabled ? <Volume2 size={14} className="text-[#D99414]" /> : <VolumeX size={14} />}
            <span className="hidden sm:inline">{soundEnabled ? 'Audio ON' : 'Audio OFF'}</span>
          </button>
        </div>
      </header>

      {/* MODAL GUÍA DE OPERACIÓN */}
      {showKeyboardHelp && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-[#FAF8F5] border border-[#DDD6C7] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl animate-in zoom-in-95 text-[#26231E]">
            <div className="flex items-center justify-between border-b border-[#E8E2D5] pb-2">
              <h3 className="text-sm font-bold text-[#945F03] flex items-center gap-2">
                <Keyboard size={16} className="text-[#D99414]" />
                Instrucciones de Operación en el Equipo
              </h3>
              <button onClick={() => setShowKeyboardHelp(false)} className="text-[#8C8373] hover:text-[#26231E] text-sm cursor-pointer">
                ✕
              </button>
            </div>
            <div className="space-y-2 text-xs text-[#544E43] leading-relaxed font-sans">
              <p>• <b>Arranque:</b> Al encender, el LCD muestra el Nivel Electrónico. Pulsa <b className="text-[#945F03]">[F1 OK]</b> para ingresar.</p>
              <p>• <b>Menú DATO y USB:</b> Pulsa <b className="text-rose-600">[ESC]</b> en la pantalla principal. Entra a <b className="text-[#945F03]">1. TRABAJO</b> para nombrar el proyecto o a <b className="text-emerald-700">3. EXPORTAR A USB</b> para descargar el CSV.</p>
              <p>• <b>Botón [SHIFT]:</b> En campos de texto cambia el modo de escritura: <b>NUM</b> (números) → <b>ALF</b> (letras) → <b>SIM</b> (signos). En ALF pulsa la misma tecla varias veces para elegir la letra (7 = A, B, C).</p>
              <p>• <b>Botón [FUNC]:</b> Cambia entre las 3 páginas de MED y salta de pantalla en Estacionamiento.</p>
              <p>• <b>Reflector EDM:</b> Se cambia en MED Pág 2 → <b>EDM</b> o en COORD → <b>3. EDM</b>.</p>
              <p>• <b>Levantamiento:</b> En Observación, <b className="text-[#945F03]">[F4 MED]</b> mide y habilita <b>[F1 REG]</b>; <b className="text-[#945F03]">[F3 AUTO]</b> mide y registra de una vez.</p>
            </div>
          </div>
        </div>
      )}

      {/* ÁREA CENTRAL PRINCIPAL: ESTACIÓN TOTAL (PROTAGONISTA) + PANEL DE REGULADORES */}
      <main className="flex-1 flex flex-col 2xl:flex-row items-center justify-center p-4 lg:p-6 gap-6 max-w-[1550px] w-full mx-auto">
        
        {/* ============================================================== */}
        {/* CENTRO: HARDWARE ESTACIÓN TOTAL (Topcon ES-105)               */}
        {/* ============================================================== */}
        <section className="flex flex-col items-center">
          
          {/* CHASIS APAISADO / RECTÁNGULO HORIZONTAL (bg-neutral-900) */}
          <div className="w-full max-w-[940px] bg-neutral-900 rounded-3xl p-5 md:p-6 shadow-2xl border-4 border-neutral-800 relative flex flex-col gap-4">
            
            {/* Grabados en carcasa industrial y placa de marca */}
            <div className="flex items-center justify-between px-2 pb-2 border-b border-neutral-800">
              <div className="flex items-center gap-3">
                <span className="text-white font-black tracking-widest text-lg italic">
                  TOPCON
                </span>
                <span className="text-amber-400 font-mono text-xs font-extrabold tracking-wider bg-neutral-950 px-2.5 py-0.5 rounded border border-neutral-800">
                  ES-105
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-mono font-bold tracking-widest text-neutral-400 uppercase hidden sm:inline">
                  LongLink™ • TSshield™ • IP66 WATERPROOF
                </span>
                <div className="flex items-center gap-1.5 bg-neutral-950 px-2.5 py-0.5 rounded-full border border-neutral-800">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-[9px] font-mono font-bold text-emerald-400">READY</span>
                </div>
              </div>
            </div>

            {/* DISTRIBUCIÓN EN 2 COLUMNAS INTERNAS (GRID) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
              
              {/* ========================================================== */}
              {/* LADO IZQUIERDO DEL PANEL (md:col-span-7)                   */}
              {/* ========================================================== */}
              <div className="md:col-span-7 flex flex-col gap-3 min-w-0">
                
                {/* MARCO RECESIVO DE LA PANTALLA LCD */}
                <div className="bg-neutral-950 p-2.5 rounded-2xl border-2 border-neutral-800 shadow-inner flex flex-col min-w-0">
              
              {/* PANTALLA LCD RETROILUMINADA (verde, como el equipo real) */}
              <div
                className={`lcd-screen relative w-full h-[236px] rounded-md px-2.5 pt-2 pb-1.5 transition-colors duration-300 border-2 border-neutral-700 flex flex-col justify-between overflow-hidden min-w-0 ${
                  isBacklightOn ? 'lcd-on' : 'lcd-off'
                }`}
                style={{
                  // Contraste del LCD (Estrella / Config.Instr): 0 = muy tenue, 15 = máximo
                  filter: `contrast(${0.55 + (Math.min(15, Math.max(0, parseInt(cfg['contraste'], 10) || 11)) / 15) * 0.65})`
                }}
              >
                {/* MODAL / OVERLAY AJUSTES RÁPIDOS (BOTÓN FÍSICO DE ESTRELLA ★) */}
                {isStarMenuOpen && (
                  <div className="absolute inset-x-0 top-0 bottom-[28px] lcd-bg z-40 px-2.5 pt-2 pb-1 flex flex-col justify-between font-mono select-none">
                    {starMode === 'SETTINGS' ? (() => {
                      // 9 opciones en 3 pantallas de 4 (Ent. Menu, ComPens., Contraste, Niv Retic / Reflector, Plom Laser, Niv. Laser, Mant.Illum / Punteo-L)
                      const page = Math.floor(starField / 4);
                      const rows = STAR_FIELDS.slice(page * 4, page * 4 + 4);
                      const cur = STAR_FIELDS[starField];
                      return (
                        <div className="relative flex flex-col h-full text-[13px] leading-[1.15]">
                          <div className="flex-1">
                            {rows.map((fld, i) => {
                              const idx = page * 4 + i;
                              const isCur = idx === starField;
                              return (
                                <div key={fld.key} onClick={() => setStarField(idx)} className="flex cursor-pointer whitespace-nowrap">
                                  {!fld.opts && !fld.level ? (
                                    <span className={isCur ? 'lcd-inv px-0.5' : 'px-0.5'}>{fld.label}</span>
                                  ) : (
                                    <>
                                      <span className="w-[48%] shrink-0">{fld.label}</span>
                                      <span>:</span>
                                      <span className={isCur ? 'lcd-inv px-0.5' : 'px-0.5'}>{starGet(fld.key)}</span>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {cur.level ? (
                            <div className="flex items-center gap-2">
                              <span>Niv.</span>
                              <span className="tracking-[-2px]">{'▶'.repeat(parseInt(starGet(cur.key), 10) || 0)}</span>
                              <span className="lcd-inv px-0.5 ml-auto">{starGet(cur.key)}</span>
                            </div>
                          ) : page === 0 ? (
                            <div className="text-center">Pulse &lt;ENT&gt; tecl.</div>
                          ) : null}
                          <span className="absolute right-0 top-0 text-[14px] leading-none">
                            {page > 0 ? '▲' : ''}
                            {page < 2 ? '▼' : ''}
                          </span>
                        </div>
                      );
                    })() : (
                      <div className="flex h-full gap-2">
                        <div className="flex-1 space-y-0.5 text-xs pt-1">
                          {STAR_MENU_ITEMS.map((item, i) => (
                            <div
                              key={item.name}
                              onClick={() => setStarMenuIdx(i)}
                              className={`px-1.5 py-0.5 rounded cursor-pointer ${starMenuIdx === i ? 'lcd-inv font-black' : ''}`}
                            >
                              {item.name}
                            </div>
                          ))}
                        </div>
                        <div className="w-24 flex flex-col items-center justify-center border border-neutral-800/40 rounded bg-black/5">
                          <svg viewBox="0 0 60 50" className="w-16 h-14" fill="none" stroke="#171717" strokeWidth="2">
                            <path d="M6 14 h16 l5 5 h27 v25 h-48 z" />
                            <path d="M6 22 h48" />
                          </svg>
                          <span className="text-[10px] font-black">{STAR_MENU_ITEMS[starMenuIdx].name}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. ÁREA CENTRAL DE PANTALLA LCD + COLUMNA DE ICONOS A LA DERECHA (como el equipo real) */}
                <div className="flex-1 flex min-h-0 gap-1">
                <div className="flex-1 py-0.5 flex flex-col justify-start text-xs leading-tight min-w-0 overflow-hidden">
                  
                  {/* ALERTA TEMPORAL EN PANTALLA LCD */}
                  {lcdMessage ? (
                    <div className="lcd-inv p-2 rounded shadow border border-neutral-800 text-center font-bold whitespace-pre-line text-xs break-words overflow-hidden max-w-full">
                      {lcdMessage}
                    </div>
                  ) : measureAnim.active || isMeasuring ? (
                    // Medición de distancia: "Dist" + modo EDM + PPm, la línea con el láser avanza a la derecha
                    <div className="flex flex-col justify-between h-full font-mono px-1 py-0.5">
                      <div className="flex justify-between items-start">
                        <div className="leading-tight">
                          <div className="text-[15px] font-black tracking-wide">Dist</div>
                          <div className="text-[15px] font-black tracking-wide">{edmCfg.modo}</div>
                        </div>
                        <div className="flex items-center gap-3 pt-5 text-[14px] font-bold">
                          <span>PPm</span>
                          <span className="font-black">{stationAtm.ppm}</span>
                        </div>
                      </div>
                      <div className="relative h-6 mb-1">
                        <div
                          className="absolute left-0 top-1/2 h-[2px] bg-neutral-900"
                          style={{ width: `${Math.max(4, (measureAnim.active ? measureAnim.progress : 0.6) * 92)}%` }}
                        />
                        <span
                          className="absolute top-1/2 -translate-y-1/2 text-[20px] font-black leading-none animate-pulse"
                          style={{ left: `calc(${Math.max(4, (measureAnim.active ? measureAnim.progress : 0.6) * 92)}% - 4px)` }}
                        >
                          ✷
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* ESTADO 'TILT': COMPENSADOR DIGITAL DE ARRANQUE */}
                      {/* ESTADO 'GEN': PANTALLAS GENÉRICAS (menús, ajustes, avisos, confirmaciones) */}
                      {screenState === 'GEN' && genView && genTop && (() => {
                        const VISIBLE = 5;
                        const scrollWindow = <T,>(arr: T[], sel: number, size: number) => {
                          const start = Math.max(0, Math.min(sel - Math.floor(size / 2), arr.length - size));
                          return { start, items: arr.slice(start, start + size) };
                        };
                        const moreAbove = (start: number) => start > 0;
                        const moreBelow = (start: number, size: number, total: number) => start + size < total;
                        const arrows = (up: boolean, down: boolean) => (
                          <span className="absolute right-0 top-0 text-[14px] leading-none">{up ? '▲' : ''}{down ? '▼' : ''}</span>
                        );
                        if (genView.kind === 'menu') {
                          const size = genView.title ? VISIBLE - 1 : VISIBLE;
                          const { start, items } = scrollWindow(genView.items, genTop.idx, size);
                          return (
                            <div className="relative text-[13px] leading-[1.15]">
                              {genView.title && <div>{genView.title}</div>}
                              {items.map((it, i) => (
                                <div
                                  key={it.label}
                                  onClick={() => { genSetIdx(start + i); it.onSelect(); }}
                                  className="pl-3 cursor-pointer"
                                >
                                  <span className={start + i === genTop.idx ? 'lcd-inv px-0.5' : 'px-0.5'}>{it.label}</span>
                                </div>
                              ))}
                              {arrows(moreAbove(start), moreBelow(start, size, genView.items.length))}
                            </div>
                          );
                        }
                        if (genView.kind === 'form') {
                          const size = genView.title ? genView.rowsPerPage - 1 : genView.rowsPerPage;
                          const page = Math.floor(genTop.idx / size);
                          const fieldsPage = genView.fields.slice(page * size, page * size + size);
                          const totalPages = Math.ceil(genView.fields.length / size);
                          return (
                            <div className="relative text-[13px] leading-[1.15]">
                              {genView.title && <div>{genView.title}</div>}
                              {fieldsPage.map((fld, i) => {
                                const isCur = page * size + i === genTop.idx;
                                const shown = isCur && (fld.kind === 'num' || fld.kind === 'text') && inputBuffer !== '' ? `${inputBuffer}_` : fld.value ?? '';
                                return (
                                  <div
                                    key={fld.key}
                                    onClick={() => { commitGenField(); genSetIdx(page * size + i); }}
                                    className="flex cursor-pointer whitespace-nowrap"
                                  >
                                    {fld.kind === 'link' ? (
                                      <span className={`pl-3 ${isCur ? 'lcd-inv px-0.5' : 'px-0.5'}`}>{fld.label}</span>
                                    ) : (
                                      <>
                                        <span className="w-[46%] shrink-0 truncate">{fld.label}</span>
                                        <span>:</span>
                                        <span className={`truncate ${isCur ? 'lcd-inv px-0.5' : 'px-0.5'}`}>{shown}</span>
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                              {arrows(page > 0, page < totalPages - 1)}
                            </div>
                          );
                        }
                        if (genView.kind === 'list') {
                          const { start, items } = scrollWindow(genView.rows, genTop.idx, genView.title ? VISIBLE - 1 : VISIBLE);
                          return (
                            <div className="relative text-[13px] leading-[1.15]">
                              {genView.title && <div>{genView.title}</div>}
                              {items.map((r, i) => (
                                <div
                                  key={r.left + (start + i)}
                                  onClick={() => genSetIdx(start + i)}
                                  onDoubleClick={() => handleEnterPress()}
                                  className={`flex justify-between pr-4 cursor-pointer ${start + i === genTop.idx ? 'lcd-inv' : ''}`}
                                >
                                  <span className="px-0.5">{r.left}</span>
                                  <span>{r.right ?? ''}</span>
                                </div>
                              ))}
                              {genView.rows.length === 0 && <div>&nbsp;</div>}
                              {arrows(moreAbove(start), moreBelow(start, VISIBLE, genView.rows.length))}
                            </div>
                          );
                        }
                        if (genView.kind === 'msg' || genView.kind === 'confirm') {
                          return (
                            <div className="text-[13px] leading-[1.2] whitespace-pre">
                              {genView.lines.map((l, i) => <div key={i}>{l || '\u00A0'}</div>)}
                            </div>
                          );
                        }
                        if (genView.kind === 'input') {
                          return (
                            <div className="text-[13px] leading-[1.2]">
                              {genView.lines.map((l, i) => <div key={i} className="whitespace-pre">{l}</div>)}
                              <div className="flex">
                                <span>:</span>
                                <span className="lcd-inv px-0.5 min-w-[60%]">{inputBuffer}_</span>
                              </div>
                            </div>
                          );
                        }
                        return <div className="text-[13px] leading-[1.2] space-y-0">{genView.render()}</div>;
                      })()}

                      {/* 1. ESTADO 'ROOT': PANTALLA RAÍZ TOPCON ES-105 */}
                      {screenState === 'ROOT' && (
                        <div className="space-y-1.5 font-mono text-xs px-1 py-1">
                          <div className="flex justify-between items-center font-bold text-[13px] border-b border-neutral-800/30 pb-0.5">
                            <span>ES-105</span>
                            <span className="text-[12px] text-neutral-800 font-bold">N/S GZ6409</span>
                          </div>
                          <div className="text-neutral-900 font-bold text-xs pt-0.5">
                            Ver. 2.57U1-10
                          </div>
                          <div className="text-neutral-900 font-bold text-xs">
                            1.03_02
                          </div>
                          <div className="flex justify-between items-center font-bold text-xs pt-1 border-t border-neutral-800/30 min-w-0">
                            <span className="shrink-0">Tra.</span>
                            <span className="truncate max-w-[75%] overflow-hidden text-right font-mono">{jobName}</span>
                          </div>
                        </div>
                      )}

                      {/* 2. ESTADO 'MED': PANTALLA DE MEDICIÓN (Pág 1: MED/GHV/AZ-0/COORD, Pág 2: MENU/COMP/ANG.H/EDM, Pág 3: MDR/DESPLZ/TOPO/REPL) */}
                      {screenState === 'MED' && (
                        <div className="flex flex-col justify-between h-full font-mono text-[13px] px-1 py-0.5">
                          <div className="flex justify-between items-center border-b border-neutral-800/30 pb-0.5">
                            <span className="text-[13px] tracking-wider text-neutral-950 font-black">MED</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold text-neutral-800">PPm</span>
                              <span className="text-[11px] font-black text-neutral-950">{stationAtm.ppm}</span>
                              {medView === 'GHV' && <Lock size={11} className="stroke-[2.5] text-neutral-900" />}
                            </div>
                          </div>

                          {medView === 'GHV' ? (
                            // Vista GHV: Distancia Geométrica (GD), Horizontal (HD) y Vertical (VD)
                            <div className="space-y-1.5 py-1 text-left font-bold text-neutral-950">
                              <div className="flex justify-between"><span>GD</span><span className="font-black">{lastMeas ? `${lastMeas.SD.toFixed(3)}m` : ''}</span></div>
                              <div className="flex justify-between"><span>HD</span><span className="font-black">{lastMeas ? `${lastMeas.HD.toFixed(3)}m` : ''}</span></div>
                              <div className="flex justify-between"><span>VD</span><span className="font-black">{lastMeas ? `${lastMeas.VD.toFixed(3)}m` : ''}</span></div>
                            </div>
                          ) : (
                            <div className="space-y-1.5 py-1 text-left font-bold text-neutral-950">
                              <div className="flex justify-between"><span>HD</span><span className="font-black">{lastMeas ? `${lastMeas.HD.toFixed(3)}m` : ''}</span></div>
                              <div className={lastMeas ? 'flex justify-between' : 'flex gap-3'}><span>AV</span><span>{lastMeas ? formatDMS(lastMeas.V) : 'Rango exced.'}</span></div>
                              <div className="flex justify-between"><span>HA-D</span><span className="font-black">{lastMeas ? formatDMS(lastMeas.HA) : ''}</span></div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ESTADO 'COMPEN': COMPENSADOR ComPen con sliders de nivelación (X = tornillos A+B, Y = tornillo C) */}
                      {(screenState === 'COMPEN' || screenState === 'TILT') && (() => {
                        const xDisplay = Math.abs(compenX) > 210 ? '* * * *' : formatTiltDMS(compenX);
                        const yDisplay = Math.abs(compenY) > 210 ? '* * * *' : formatTiltDMS(compenY);

                        return (
                          <div className="flex flex-col justify-between h-full font-mono text-xs select-none">
                            <div className="flex justify-between items-center border-b border-neutral-800/30 pb-0.5 px-0.5">
                              <span className="font-black text-sm text-neutral-950 tracking-wider">ComPen</span>
                              <span className="text-[10px] text-neutral-800 font-bold">Nivel Electrónico</span>
                            </div>

                            <div className="flex items-center justify-between gap-1 px-1 flex-1 min-h-0">
                              {/* Lecturas X / Y */}
                              <div className="flex flex-col justify-center space-y-3 pl-1 text-[14px] font-bold text-neutral-950 leading-tight">
                                <div className="flex items-center gap-2">
                                  <span className="font-black text-neutral-900">X:</span>
                                  <span className="font-mono tracking-wider">{xDisplay}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-black text-neutral-900">Y:</span>
                                  <span className="font-mono tracking-wider">{yDisplay}</span>
                                </div>
                              </div>

                              {/* Diana + sliders monocromáticos */}
                              <div className="flex items-start gap-1.5 pr-1">
                                <div className="flex flex-col items-center gap-1">
                                  <svg viewBox="0 0 100 100" className="w-[84px] h-[84px]">
                                    <line x1="2" y1="50" x2="98" y2="50" stroke="#171717" strokeWidth="1.2" />
                                    <line x1="50" y1="2" x2="50" y2="98" stroke="#171717" strokeWidth="1.2" />
                                    <circle cx="50" cy="50" r="42" fill="none" stroke="#171717" strokeWidth="3" />
                                    <circle cx="50" cy="50" r="28" fill="none" stroke="#171717" strokeWidth="1.4" />
                                    <circle cx="50" cy="50" r="15" fill="none" stroke="#171717" strokeWidth="1.4" />
                                    <circle cx={bubblePos.x} cy={bubblePos.y} r="6" fill="#0a0a0a" />
                                  </svg>
                                  <LcdSlider
                                    orientation="horizontal"
                                    value={compenX}
                                    min={-COMPEN_LIMIT}
                                    max={COMPEN_LIMIT}
                                    onChange={setCompenX}
                                    title="Eje X: tornillos A y B (se mueven juntos)"
                                  />
                                  <span className="text-[8px] font-black leading-none">A+B</span>
                                </div>
                                <div className="flex flex-col items-center gap-1 pt-1">
                                  <LcdSlider
                                    orientation="vertical"
                                    value={compenY}
                                    min={-COMPEN_LIMIT}
                                    max={COMPEN_LIMIT}
                                    onChange={setCompenY}
                                    title="Eje Y: tornillo C"
                                  />
                                  <span className="text-[8px] font-black leading-none">C</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* ESTADO 'MAIN': PANTALLA PRINCIPAL (Pág 1 / Pág 2 - compatibilidad) */}
                      {screenState === 'MAIN' && (
                        <div className="space-y-1 font-mono text-[13px]">
                          <div className="flex justify-between items-center bg-black/5 px-1.5 py-0.5 rounded">
                            <span className="font-bold">V0 :</span>
                            <span className="font-black text-right">{formatDMS(envV)}</span>
                          </div>
                          <div className="flex justify-between items-center bg-black/5 px-1.5 py-0.5 rounded">
                            <span className="font-bold">HR :</span>
                            <span className="font-black text-right">{formatDMS(envHD)}</span>
                          </div>
                          <div className="flex justify-between items-center bg-black/5 px-1.5 py-0.5 rounded">
                            <span className="font-bold">SD :</span>
                            <span className="font-black text-right">{envSD.toFixed(3)} m</span>
                          </div>
                          <div className="text-[10px] text-neutral-700 pt-0.5 flex justify-between font-sans font-bold">
                            <span>Pág {mainPage}/2 (Botón FUNC)</span>
                            <span>ESC = ROOT</span>
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'DATO_MENU': Dato (TRABJ, Datos Conocidos, Cod.) */}
                      {screenState === 'DATO_MENU' &&
                        renderLcdMenu('Dato', ['TRABJ', 'Datos Conocidos', 'Cod.'], Math.min(2, Math.max(0, menuSelection - 1)), i => abrirDatoItem(i + 1))}

                      {/* ESTADO 'JOB_MENU': TRABJ */}
                      {screenState === 'JOB_MENU' &&
                        renderLcdMenu(
                          'TRABJ',
                          ['Selec TRABJ', 'Detalles de TRABJ', 'Borrar TRABJ', 'Salida Comunic.', 'Config.Comunic.'],
                          jobMenuSelection - 1,
                          i => { setJobMenuSelection(i + 1); handleKeypadPress(String(i + 1)); }
                        )}

                      {/* 2. ESTADO 'JOB_SELECT': Selec. TRABJ / Busca Coord TRABJ (F1 = LIST) */}
                      {screenState === 'JOB_SELECT' && (
                        <div className="text-[13px] leading-[1.15]">
                          <div>Selec. TRABJ</div>
                          <div onClick={() => setJobSelectField(0)} className="cursor-pointer">
                            :<span className={jobSelectField === 0 ? 'lcd-inv px-0.5 inline-block min-w-[70%]' : 'px-0.5'}>{jobClean(jobName)}</span>
                          </div>
                          <div>Busca Coord TRABJ</div>
                          <div onClick={() => setJobSelectField(1)} className="cursor-pointer">
                            :<span className={jobSelectField === 1 ? 'lcd-inv px-0.5 inline-block min-w-[70%]' : 'px-0.5'}>{jobClean(coordJobName)}</span>
                          </div>
                        </div>
                      )}

                      {/* 2. ESTADO 'JOB_LIST': LISTA VISUAL DE TRABAJOS CON ASTERISCO */}
                      {screenState === 'JOB_LIST' && (() => {
                        const currentPage = Math.floor(selectedJobIdx / 5);
                        const visibleJobs = jobsList.slice(currentPage * 5, (currentPage + 1) * 5);
                        return (
                          <div className="space-y-1 font-mono text-xs px-1">
                            <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5 font-mono">
                              <span>LISTA TRABJ</span>
                              <span className="text-[10px] font-bold">[{currentPage + 1}/2]</span>
                            </div>
                            <div className="space-y-0.5">
                              {visibleJobs.map((job, localIdx) => {
                                const globalIdx = currentPage * 5 + localIdx;
                                const isSelected = selectedJobIdx === globalIdx;
                                return (
                                  <div
                                    key={job + globalIdx}
                                    onClick={() => setSelectedJobIdx(globalIdx)}
                                    className={`px-2 py-0.5 rounded cursor-pointer flex justify-between items-center text-xs min-w-0 font-mono ${
                                      isSelected
                                        ? 'lcd-inv font-black'
                                        : 'hover:bg-black/10 text-neutral-900 font-semibold'
                                    }`}
                                  >
                                    <span className="truncate max-w-[80%] overflow-hidden">{job}</span>
                                    
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9.5px] text-neutral-800 text-center pt-0.5 font-mono truncate lcd-hint">
                              * No exportado a USB - [ENT] Seleccionar
                            </div>
                          </div>
                        );
                      })()}

                      {/* 3. ESTADO 'JOB_DETAILS': Detalles de TRABJ (Nom. TRA y ESCAL editables) */}
                      {screenState === 'JOB_DETAILS' && (
                        <div className="text-[13px] leading-[1.15]">
                          <div>Detalles de TRABJ</div>
                          <div className="pl-1">Nom. TRA</div>
                          <div onClick={() => setActiveField(0)} className="cursor-pointer">
                            :<span className={activeField === 0 ? 'lcd-inv px-0.5 inline-block min-w-[70%]' : 'px-0.5'}>
                              {activeField === 0 ? `${inputBuffer}_` : jobClean(jobName)}
                            </span>
                          </div>
                          <div onClick={() => setActiveField(1)} className="cursor-pointer flex">
                            <span>ESCAL:</span>
                            <span className={activeField === 1 ? 'lcd-inv px-0.5' : 'px-0.5'}>
                              {activeField === 1 ? `${inputBuffer}_` : jobScale}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* 4. ESTADO 'JOB_DELETE_LIST': Borrar TRABJ (nombre y cantidad de puntos) */}
                      {screenState === 'JOB_DELETE_LIST' && (() => {
                        const size = 4;
                        const start = Math.max(0, Math.min(selectedJobIdx - 1, jobsList.length - size));
                        return (
                          <div className="relative text-[13px] leading-[1.15]">
                            <div>Borrar TRABJ</div>
                            {jobsList.slice(start, start + size).map((job, i) => {
                              const idx = start + i;
                              return (
                                <div
                                  key={job + idx}
                                  onClick={() => setSelectedJobIdx(idx)}
                                  onDoubleClick={() => handleEnterPress()}
                                  className={`flex justify-between pr-4 cursor-pointer ${idx === selectedJobIdx ? 'lcd-inv' : ''}`}
                                >
                                  <span className="px-0.5">{job}</span>
                                  <span>{jobCountAt(idx)}</span>
                                </div>
                              );
                            })}
                            <span className="absolute right-0 top-0 text-[14px] leading-none">
                              {start > 0 ? '▲' : ''}
                              {start + size < jobsList.length ? '▼' : ''}
                            </span>
                          </div>
                        );
                      })()}

                      {/* 4. ESTADO 'JOB_DELETE_CONFIRM': AVISO DE CONFIRMACIÓN CON [NO] Y [SI] */}
                      {screenState === 'JOB_DELETE_CONFIRM' && (
                        <div className="flex flex-col items-center justify-center h-full py-4 space-y-1.5 font-mono text-center">
                          <div className="text-base font-bold text-neutral-950 truncate max-w-[90%]">
                            {jobDeleteTarget ? jobDeleteTarget.replace(/^\*/, '') : 'GRAMA'}
                          </div>
                          <div className="text-xs font-semibold text-neutral-900">
                            borrado
                          </div>
                          <div className="text-xs font-semibold text-neutral-900">
                            Confir ?
                          </div>
                          <div className="text-[10px] text-neutral-700 font-sans pt-2">
                            F3=[NO] • F4=[SI]
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'JOB': EDICIÓN ALFANUMÉRICA (compatibilidad) */}
                      {screenState === 'JOB' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>SELECCIÓN TRABAJO</span>
                            <span className="text-[10px] font-black">F4=[ENT]</span>
                          </div>
                          <div className="lcd-inv px-2 py-1 rounded flex justify-between items-center font-bold min-w-0">
                            <span className="shrink-0">TRAB:</span>
                            <span className="font-mono truncate max-w-[65%] overflow-hidden text-right">{inputBuffer}_</span>
                          </div>
                          <div className="text-[11px] text-neutral-800 space-y-0.5 pt-0.5 min-w-0">
                            <div className="flex justify-between items-center">
                              <span className="shrink-0">PUNTOS LEVANTADOS:</span>
                              <span className="font-bold">{points.length}</span>
                            </div>
                            <div className="flex justify-between items-center min-w-0">
                              <span className="shrink-0">DESTINO USB:</span>
                              <span className="font-bold truncate max-w-[55%] overflow-hidden text-right">{inputBuffer || 'TRAB'}.csv</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* SUBMENÚ DATOS CONOCIDOS */}
                      {screenState === 'KNOWN_MENU' &&
                        renderLcdMenu('Datos Conocidos', KNOWN_ITEMS, knownMenuSelection - 1, i => abrirKnownItem(i + 1), `Tra.${jobClean(jobName)}`)}

                      {screenState === 'KNOWN_INPUT' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>ENTRADA COORDS</span>
                            <span className="text-[10px] font-black">F4=[OK]</span>
                          </div>
                          {[
                            { label: 'Y', val: knownCoordsInput.Y },
                            { label: 'X', val: knownCoordsInput.X },
                            { label: 'Z', val: knownCoordsInput.Z },
                            { label: 'PTO', val: knownCoordsInput.PTO }
                          ].map((item, idx) => {
                            const isCur = activeField === idx;
                            return (
                              <div
                                key={item.label}
                                onClick={() => {
                                  commitCurrentField();
                                  setActiveField(idx);
                                }}
                                className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer min-w-0 ${
                                  isCur ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span className="shrink-0">{item.label}:</span>
                                <span className="truncate max-w-[65%] overflow-hidden text-right font-mono">
                                  {isCur ? `${inputBuffer}_` : (item.val !== '' ? item.val : '---')}
                                </span>
                              </div>
                            );
                          })}
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            [ENT]: Sig. Campo • F4=[OK]: Guardar y Loop
                          </div>
                        </div>
                      )}

                      {/* BORRAR PUNTOS CONOCIDOS */}
                      {screenState === 'KNOWN_DEL' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>BORRAR COORD.</span>
                            <span className="text-[10px] font-bold">
                              {knownPoints.length > 0 ? `[${selectedKnownIdx + 1}/${knownPoints.length}]` : '[0/0]'}
                            </span>
                          </div>
                          {knownPoints.length === 0 ? (
                            <div className="text-center py-4 text-neutral-800 font-sans">
                              Sin puntos cargados.<br />Pulse [ESC] para volver.
                            </div>
                          ) : (
                            <div className="space-y-0.5 bg-black/5 p-1 rounded">
                              <div className="flex justify-between items-center font-bold min-w-0">
                                <span className="truncate max-w-[65%] overflow-hidden">PTO: {knownPoints[selectedKnownIdx]?.PTO}</span>
                                <span className="text-[10px] lcd-inv px-1 rounded shrink-0 truncate max-w-[30%]">
                                  {knownPoints[selectedKnownIdx]?.CD || 'BASE'}
                                </span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>Y: {knownPoints[selectedKnownIdx]?.N.toFixed(3)}</span>
                                <span>X: {knownPoints[selectedKnownIdx]?.E.toFixed(3)}</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>Z: {knownPoints[selectedKnownIdx]?.Z.toFixed(3)}</span>
                                <span className="text-[10px] font-bold text-red-800 font-sans">F4=[BORR]</span>
                              </div>
                            </div>
                          )}
                          <div className="text-[10px] text-neutral-700 text-center pt-0.5 font-sans">
                            ▲ / ▼: Seleccionar • F4 o [ENT]: Borrar
                          </div>
                        </div>
                      )}

                      {/* CONFIRMAR BORRADO DE PUNTO CONOCIDO */}
                      {screenState === 'KNOWN_DEL_CONFIRM' && (
                        <div className="flex flex-col items-center justify-center h-full py-4 space-y-2 font-mono text-center">
                          <div className="text-xs font-bold bg-black/10 px-2 py-1 rounded truncate max-w-[80%] overflow-hidden">
                            {knownPoints[selectedKnownIdx]?.PTO || 'PUNTO'}
                          </div>
                          <div className="text-sm font-black text-neutral-900">
                            borrado Confir ?
                          </div>
                          <div className="text-[10px] text-neutral-700 font-sans pt-2">
                            F3=[NO] Cancelar • F4=[SI] Confirmar
                          </div>
                        </div>
                      )}

                      {/* VER PUNTOS CONOCIDOS */}
                      {screenState === 'KNOWN_VIEW' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>VER COORDS</span>
                            <span className="text-[10px] font-bold">
                              {knownPoints.length > 0 ? `[${viewKnownIdx + 1}/${knownPoints.length}]` : '[0/0]'}
                            </span>
                          </div>
                          {knownPoints.length === 0 ? (
                            <div className="text-center py-4 text-neutral-800 font-sans">
                              Sin puntos cargados.<br />Pulse [ESC] para volver.
                            </div>
                          ) : (
                            <div className="space-y-0.5 bg-black/5 p-1 rounded">
                              <div className="flex justify-between items-center font-bold min-w-0">
                                <span className="truncate max-w-[65%] overflow-hidden">PTO: {knownPoints[viewKnownIdx]?.PTO}</span>
                                <span className="text-[10px] lcd-inv px-1 rounded shrink-0 truncate max-w-[30%]">
                                  {knownPoints[viewKnownIdx]?.CD || 'BASE'}
                                </span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>Y: {knownPoints[viewKnownIdx]?.N.toFixed(3)}</span>
                                <span>X: {knownPoints[viewKnownIdx]?.E.toFixed(3)}</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>Z: {knownPoints[viewKnownIdx]?.Z.toFixed(3)}</span>
                              </div>
                            </div>
                          )}
                          <div className="text-[10px] text-neutral-700 text-center pt-0.5 font-sans">
                            ▲ / ▼: Navegar • ESC: Salir
                          </div>
                        </div>
                      )}

                      {/* COMPATIBILIDAD CON KNOWN_PTS Y KNOWN_NEW */}
                      {screenState === 'KNOWN_PTS' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>DATOS CONOCIDOS</span>
                            <span className="text-[10px] font-bold">
                              {knownPoints.length > 0 ? `[${viewKnownIdx + 1}/${knownPoints.length}]` : '[0/0]'}
                            </span>
                          </div>
                          {knownPoints.length === 0 ? (
                            <div className="text-center py-4 text-neutral-800 font-sans">
                              Sin bases cargadas.<br />Pulse [ESC] para volver.
                            </div>
                          ) : (
                            <div className="space-y-0.5 bg-black/5 p-1 rounded">
                              <div className="flex justify-between items-center font-bold min-w-0">
                                <span className="truncate max-w-[65%] overflow-hidden">PTO: {knownPoints[viewKnownIdx]?.PTO}</span>
                                <span className="text-[10px] lcd-inv px-1 rounded shrink-0 truncate max-w-[30%]">
                                  {knownPoints[viewKnownIdx]?.CD || 'BASE'}
                                </span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>Y: {knownPoints[viewKnownIdx]?.N.toFixed(3)}</span>
                                <span>X: {knownPoints[viewKnownIdx]?.E.toFixed(3)}</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>Z: {knownPoints[viewKnownIdx]?.Z.toFixed(3)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {screenState === 'KNOWN_NEW' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>INGRESAR BASE</span>
                            <span className="text-[10px] font-black">F4=[REG]</span>
                          </div>
                          {[
                            { label: 'PTO', val: newKnownPoint.PTO },
                            { label: 'N', val: `${newKnownPoint.N.toFixed(3)} m` },
                            { label: 'E', val: `${newKnownPoint.E.toFixed(3)} m` },
                            { label: 'Z', val: `${newKnownPoint.Z.toFixed(3)} m` },
                            { label: 'CD', val: newKnownPoint.CD || '' }
                          ].map((item, idx) => {
                            const isCur = activeField === idx;
                            return (
                              <div
                                key={item.label}
                                onClick={() => setActiveField(idx)}
                                className={`flex justify-between items-center px-1.5 py-0.2 rounded cursor-pointer min-w-0 ${
                                  isCur ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span className="shrink-0">{item.label}:</span>
                                <span className="truncate max-w-[65%] overflow-hidden text-right font-mono">
                                  {isCur ? `${inputBuffer}_` : item.val}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* 2. ESTADO 'SELECT_KNOWN_PT': CARGAR BASE CON [LEER] */}
                      {screenState === 'SELECT_KNOWN_PT' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>LEER BASE {readTargetContext === 'OCC' ? '(ESTACIÓN)' : '(P. ATRÁS)'}</span>
                            <span className="text-[10px] font-bold">[{viewKnownIdx + 1}/{knownPoints.length}]</span>
                          </div>
                          {knownPoints.length === 0 ? (
                            <div className="text-center py-4 text-neutral-800 font-sans">
                              No hay bases registradas.<br />ESC para volver.
                            </div>
                          ) : (
                            <div className="space-y-0.5 bg-black/5 p-1 rounded">
                              <div className="flex justify-between items-center font-bold min-w-0">
                                <span className="truncate max-w-[65%] overflow-hidden">PTO: {knownPoints[viewKnownIdx]?.PTO}</span>
                                <span className="text-[10px] lcd-inv px-1 rounded shrink-0 truncate max-w-[30%]">
                                  {knownPoints[viewKnownIdx]?.CD || 'BASE'}
                                </span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>N: {knownPoints[viewKnownIdx]?.N.toFixed(3)}</span>
                                <span>E: {knownPoints[viewKnownIdx]?.E.toFixed(3)}</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>Z: {knownPoints[viewKnownIdx]?.Z.toFixed(3)}</span>
                                <span className="text-[10px] font-bold text-neutral-900 font-sans">F4=[CARG]</span>
                              </div>
                            </div>
                          )}
                          <div className="text-[10px] text-neutral-700 text-center pt-0.5 font-sans">
                            ▲ / ▼: Seleccionar • F4 o [ENT]: Cargar
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'GRAPHIC_MENU': MENÚ GRÁFICO PRINCIPAL CON ARTE SVG DINÁMICO */}
                      {screenState === 'GRAPHIC_MENU' && (() => {
                        const visibleCount = 4;
                        const startIdx = Math.max(0, Math.min(graphicMenuIdx - 1, GRAPHIC_MENU_ITEMS.length - visibleCount));
                        const visibleItems = GRAPHIC_MENU_ITEMS.slice(startIdx, startIdx + visibleCount);
                        const currentItem = GRAPHIC_MENU_ITEMS[graphicMenuIdx];

                        return (
                          <div className="flex flex-col h-full justify-between font-mono text-xs">
                            <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                              <span className="tracking-wide">--- MENÚ PRINCIPAL ---</span>
                              <span className="text-[10px] font-bold">[{graphicMenuIdx + 1}/{GRAPHIC_MENU_ITEMS.length}]</span>
                            </div>

                            <div className="grid grid-cols-12 gap-1.5 items-center py-0.5 flex-1 min-h-0">
                              {/* Lista a la izquierda */}
                              <div className="col-span-7 space-y-0.5 min-w-0">
                                {visibleItems.map((item, localIdx) => {
                                  const realIdx = startIdx + localIdx;
                                  const isSel = graphicMenuIdx === realIdx;
                                  return (
                                    <div
                                      key={item.id}
                                      onClick={() => setGraphicMenuIdx(realIdx)}
                                      className={`px-1.5 py-0.5 rounded cursor-pointer flex items-center justify-between text-[11px] min-w-0 ${
                                        isSel ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                      }`}
                                    >
                                      <span className="truncate">{realIdx + 1}. {item.name}</span>
                                      {isSel && <span className="text-[9px] shrink-0 font-bold ml-0.5">▶</span>}
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Ícono dinámico a la derecha */}
                              <div className="col-span-5 h-[104px] border border-neutral-800/50 rounded bg-black/5 flex flex-col items-center justify-center p-1 relative overflow-hidden shadow-inner">
                                <div className="w-[62px] h-[62px] flex items-center justify-center text-neutral-950">
                                  {renderGraphicMenuSvg(currentItem.id)}
                                </div>
                                <span className="text-[9px] font-black tracking-tight text-neutral-900 text-center truncate max-w-full mt-0.5 border-t border-neutral-800/20 w-full pt-0.5">
                                  {currentItem.name}
                                </span>
                              </div>
                            </div>

                            <div className="text-[9px] text-neutral-700 text-center pt-0.5 border-t border-neutral-800/20 font-sans">
                              ▲ ▼ Seleccionar • [ENT] Entrar
                            </div>
                          </div>
                        );
                      })()}

                      {/* ESTADO 'REPLANTEO_MENU': MENÚ REPLANTEO */}
                      {screenState === 'REPLANTEO_MENU' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center text-[11px]">
                            <span>--- REPLANTEO ---</span>
                            <span className="text-[10px] font-bold">[{replMenuSelection}/4]</span>
                          </div>
                          {[
                            { id: 1, label: '1. Occ.Orien.' },
                            { id: 2, label: '2. Datos de RePlant.' },
                            { id: 3, label: '3. Observacion' },
                            { id: 4, label: '4. EDM' }
                          ].map(item => {
                            const isSel = replMenuSelection === item.id;
                            return (
                              <div
                                key={item.id}
                                onClick={() => {
                                  setReplMenuSelection(item.id);
                                  handleKeypadPress(String(item.id));
                                }}
                                className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between text-[11px] ${
                                  isSel ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                
                              </div>
                            );
                          })}
                          <div className="text-[10px] text-neutral-700 text-center pt-1 font-sans">
                            ▲ ▼ Seleccionar - [ENT] Entrar
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'REPL_DATA': DATOS DE REPLANT. (COORD: punto cargado con CARG / DISP: DistH y Ang H editables) */}
                      {screenState === 'REPL_DATA' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="space-y-0.5 px-0.5">
                            {replDisplayMode === 'COORD' ? (
                              <>
                                <div className="font-bold">REP Coord{replPoint ? `   PTO ${replPoint.PTO}` : ''}</div>
                                {[
                                  { label: 'XP:', f: 0, v: replPoint ? replPoint.E.toFixed(3) : '0.000' },
                                  { label: 'YP:', f: 1, v: replPoint ? replPoint.N.toFixed(3) : '0.000' },
                                  { label: 'ZP:', f: 2, v: replPoint ? replPoint.Z.toFixed(3) : '0.000' },
                                  { label: 'HD', f: 3, v: `${target.HR.toFixed(3)}m` }
                                ].map(row => (
                                  <div
                                    key={row.label}
                                    onClick={() => { commitReplCoord(); setActiveField(row.f); }}
                                    className="flex justify-between items-center text-xs cursor-pointer"
                                  >
                                    <span>{row.label}</span>
                                    <span className={`px-0.5 ${activeField === row.f ? 'lcd-inv' : ''}`}>
                                      {activeField === row.f && inputBuffer !== '' ? `${inputBuffer}_` : row.v}
                                    </span>
                                  </div>
                                ))}
                              </>
                            ) : (
                              <>
                                {[
                                  { label: 'DistH', value: activeField === 0 && inputBuffer !== '' ? `${inputBuffer}_` : `${replDisp.distH.toFixed(3)}m` },
                                  { label: 'Ang H', value: activeField === 1 && inputBuffer !== '' ? `${inputBuffer}_` : formatDMS(replDisp.angH) }
                                ].map((row, i) => (
                                  <div
                                    key={row.label}
                                    onClick={() => { commitReplDispField(); setActiveField(i); }}
                                    className={`flex justify-between items-center text-xs px-1 rounded cursor-pointer ${
                                      activeField === i ? 'lcd-inv font-black' : ''
                                    }`}
                                  >
                                    <span className="font-bold">{row.label}:</span>
                                    <span className="font-mono font-bold">{row.value}</span>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>

                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            {replDisplayMode === 'DISP'
                              ? 'Escriba DistH (m) o Ang H (ddd.mmss) • F4=[OK] ComPen'
                              : 'F1=[CARG] Punto • F2=[DISP] • F4=[OK] ComPen'}
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'REPL_OBS': OBSERVACIÓN DE REPLANTEO (REG / DISP / ← → / MED) */}
                      {screenState === 'REPL_OBS' && (
                        <div className="text-[13px] leading-[1.15] pr-1">
                          {medView === 'GHV' ? (
                            <>
                              <div className="flex justify-between"><span>GD</span><span>{lastMeas ? `${lastMeas.SD.toFixed(3)}m` : ''}</span></div>
                              <div className="flex justify-between"><span>HD</span><span>{lastMeas ? `${lastMeas.HD.toFixed(3)}m` : ''}</span></div>
                              <div className="flex justify-between"><span>VD</span><span>{lastMeas ? `${lastMeas.VD.toFixed(3)}m` : ''}</span></div>
                            </>
                          ) : (
                            <>
                              <div className="text-right">{lastMeas ? `${lastMeas.HD.toFixed(3)}m` : '\u00A0'}</div>
                              <div>{lastMeas ? 'HD' : '\u00A0'}</div>
                              <div className={lastMeas ? 'flex justify-between' : 'flex gap-3'}><span>AV</span><span>{lastMeas ? formatDMS(lastMeas.V) : 'Rango exced.'}</span></div>
                              <div className="flex justify-between"><span>HA-D</span><span>{lastMeas ? formatDMS(lastMeas.HA) : ''}</span></div>
                            </>
                          )}
                        </div>
                      )}

                      {/* ESTADO 'TOPO_MENU': MENÚ TOPO */}
                      {screenState === 'TOPO_MENU' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center text-[11px]">
                            <span>--- TOPOGRAFIA ---</span>
                            <span className="text-[10px] font-bold">[{topoMenuSelection}/4]</span>
                          </div>
                          {[
                            { id: 1, label: '1. Dist*Coord' },
                            { id: 2, label: '2. Nota' },
                            { id: 3, label: '3. Ver' },
                            { id: 4, label: '4. Borrar' }
                          ].map(item => {
                            const isSel = topoMenuSelection === item.id;
                            return (
                              <div
                                key={item.id}
                                onClick={() => {
                                  setTopoMenuSelection(item.id);
                                  handleKeypadPress(String(item.id));
                                }}
                                className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between text-[11px] ${
                                  isSel ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                
                              </div>
                            );
                          })}
                          <div className="text-[10px] text-neutral-700 text-center pt-1 font-sans">
                            ▲ ▼ Seleccionar - [ENT] Entrar
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'TOPO_NOTA': NOTA TOPO */}
                      {screenState === 'TOPO_NOTA' && (
                        <div className="space-y-1.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                            <span>NOTA</span>
                            <span className="text-[10px] font-bold">[TOPO]</span>
                          </div>
                          <div className="space-y-1 bg-black/5 p-2 rounded">
                            <div className="text-xs font-bold text-neutral-950">
                              REU Nota 6247
                            </div>
                            <div className="text-xs font-bold text-neutral-800">
                              LEVC
                            </div>
                          </div>
                          <div className="text-[9px] text-neutral-700 text-center pt-1 font-sans">
                            F4=[OK] Guardar • [ESC] Volver
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'TOPO_PTTRN': Dist*Coord — patrón de observación */}
                      {screenState === 'TOPO_PTTRN' && (
                        <div className="space-y-0.5 font-mono text-[13px] px-1 pt-0.5">
                          <div className="font-black">PTTRN:{topoModels[0] || 'CLEV'}</div>
                          {[
                            { label: 'Num. SETs', value: String(topoPttrn.sets) },
                            { label: 'Num. Obs', value: String(topoPttrn.obs) },
                            { label: 'ObsdesP1/2', value: topoPttrn.obsP12 },
                            { label: 'PreenterPt', value: topoPttrn.preenter }
                          ].map((row, i) => (
                            <div
                              key={row.label}
                              onClick={() => setTopoPttrn(p => ({ ...p, field: i }))}
                              className="flex items-center gap-1 font-bold cursor-pointer"
                            >
                              <span className="w-28">{row.label}</span>
                              <span>:</span>
                              <span className={`px-1 ${topoPttrn.field === i ? 'lcd-inv font-black' : ''}`}>{row.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ESTADO 'TOPO_MODEL': Selec. Modelo Obs */}
                      {screenState === 'TOPO_MODEL' && (
                        <div className="space-y-0.5 font-mono text-[13px] px-1 pt-0.5">
                          <div className="font-black">Selec. Modelo Obs</div>
                          {topoModels.map((m, i) => (
                            <div
                              key={i}
                              onClick={() => setTopoModelIdx(i)}
                              className={`flex gap-1 font-bold px-1 rounded cursor-pointer ${topoModelIdx === i ? 'lcd-inv font-black' : ''}`}
                            >
                              <span>{String(i + 1).padStart(2, '0')}:</span>
                              <span>{m}</span>
                            </div>
                          ))}
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            ◄ ► Cambiar modelo • F2=[REG] / F4=[OK]
                          </div>
                        </div>
                      )}

                      {/* ESTADOS 'CODE_LIST' / 'CODE_SEARCH': LISTA Y BÚSQUEDA DE CÓDIGOS Cd */}
                      {(screenState === 'CODE_LIST' || screenState === 'CODE_SEARCH') && (() => {
                        const list = screenState === 'CODE_LIST' ? codeList : filteredCodes;
                        const VISIBLE = screenState === 'CODE_LIST' ? 5 : 4;
                        const startIdx = Math.max(0, Math.min(codeIdx - 2, list.length - VISIBLE));
                        return (
                          <div className="font-mono text-[13px] h-full flex flex-col">
                            {screenState === 'CODE_SEARCH' && (
                              <div className="font-bold px-1.5 border-b border-neutral-800/30 pb-0.5">Cd: {codeSearchBuffer}_</div>
                            )}
                            <div className="flex-1 pt-0.5">
                              {list.slice(startIdx, startIdx + VISIBLE).map((c, li) => {
                                const idx = startIdx + li;
                                return (
                                  <div
                                    key={c + idx}
                                    onClick={() => setCodeIdx(idx)}
                                    onDoubleClick={() => handleEnterPress()}
                                    className={`px-1.5 py-[1px] rounded cursor-pointer font-bold ${codeIdx === idx ? 'lcd-inv font-black' : ''}`}
                                  >
                                    {c}
                                  </div>
                                );
                              })}
                              {list.length === 0 && <div className="px-1.5 text-neutral-700">Sin coincidencias</div>}
                            </div>
                            <div className="text-[9px] text-neutral-700 flex justify-between font-sans border-t border-neutral-800/20 pt-0.5">
                              <span>▲▼ • [ENT] Elegir Cd</span>
                              <span>[{list.length ? codeIdx + 1 : 0}/{list.length}]</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* ESTADO 'CODE_ADD': AGREGAR CÓDIGO (Sob.escri?) */}
                      {screenState === 'CODE_ADD' && (
                        <div className="font-mono text-[13px] px-1 pt-0.5 space-y-0.5 font-bold">
                          <div>Cd</div>
                          <div className="lcd-inv px-1.5 rounded font-black">:{codeSearchBuffer}</div>
                          <div>Operador</div>
                          <div>:{stationAtm.operador}</div>
                          <div className="text-center pt-1 font-black">Sob.escri?</div>
                        </div>
                      )}

                      {/* ESTADO 'COORD_MENU': MENÚ COORD (1. Occ.Orien., 2. Observación, 3. EDM) */}
                      {screenState === 'COORD_MENU' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide">
                            --- COORDENADAS ---
                          </div>
                          {[
                            { id: 1, label: '1. Occ.Orien.' },
                            { id: 2, label: '2. Observación' },
                            { id: 3, label: '3. EDM' }
                          ].map(item => (
                            <div
                              key={item.id}
                              onClick={() => { setMenuSelection(item.id); handleKeypadPress(String(item.id)); }}
                              className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between ${
                                menuSelection === item.id ? 'lcd-inv font-black' : 'hover:bg-black/10'
                              }`}
                            >
                              <span>{item.label}</span>
                              
                            </div>
                          ))}
                          <div className="text-[10px] text-neutral-700 text-center pt-1 font-sans">
                            Pulse 1, 2 o 3 / ▲ ▼ y [ENT]
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'OCC_ORIEN': ESTACIONAMIENTO, 14 campos en 4 pantallas como el equipo:
                          Y0 X0 Z0 PTO HI | Cd Operador | Fech Tiem Clima Viento | Temp Pres PPm */}
                      {screenState === 'OCC_ORIEN' && (() => {
                        const now = new Date();
                        const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
                        const fech = `${meses[now.getMonth()]}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
                        const tiem = now.toLocaleTimeString('es-PE', { hour12: false });
                        const editing = (f: number, normal: string) =>
                          activeField === f ? `${inputBuffer}_` : normal;
                        const fields: { label: string; value: string }[] = [
                          { label: 'Y0', value: editing(0, `${station.N.toFixed(3)} m`) },
                          { label: 'X0', value: editing(1, `${station.E.toFixed(3)} m`) },
                          { label: 'Z0', value: editing(2, `${station.Z.toFixed(3)} m`) },
                          { label: 'PTO', value: editing(3, station.PTO || 'PTO 1') },
                          { label: 'HI', value: editing(4, `${station.HI.toFixed(3)} m`) },
                          { label: 'Cd', value: editing(5, stationAtm.CD) },
                          { label: 'Operador', value: editing(6, stationAtm.operador) },
                          { label: 'Fech', value: fech },
                          { label: 'Tiem', value: tiem },
                          { label: 'Clima', value: activeField === 9 ? `◄ ${stationAtm.clima} ►` : stationAtm.clima },
                          { label: 'Viento', value: activeField === 10 ? `◄ ${stationAtm.viento} ►` : stationAtm.viento },
                          { label: 'Temp.', value: editing(11, `${stationAtm.temp}°C`) },
                          { label: 'Pres.', value: editing(12, `${stationAtm.pres}hPa`) },
                          { label: 'PPm', value: editing(13, stationAtm.ppm) }
                        ];
                        const page = OCC_PAGES[occPageOf(activeField)];
                        const stacked = page.includes(5); // Cd y Operador: etiqueta arriba y valor debajo (":TN")

                        return (
                          <div className="space-y-0.5 font-mono text-xs">
                            <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                              <span>ESTACIONAMIENTO</span>
                              <span className="text-[10px] font-bold">▲▼ [{activeField + 1}/14]</span>
                            </div>
                            <div className="space-y-0.5 py-0.5">
                              {page.map(f => {
                                const item = fields[f];
                                const isCur = activeField === f;
                                if (stacked) {
                                  return (
                                    <div key={item.label} onClick={() => { commitCurrentField(); setActiveField(f); }} className="cursor-pointer">
                                      <div className="px-1.5 font-bold">{item.label}</div>
                                      <div className={`px-1.5 py-0.5 rounded min-w-0 truncate ${isCur ? 'lcd-inv font-black' : ''}`}>
                                        :{item.value}
                                      </div>
                                    </div>
                                  );
                                }
                                return (
                                  <div
                                    key={item.label}
                                    onClick={() => { commitCurrentField(); setActiveField(f); }}
                                    className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer min-w-0 ${
                                      isCur ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                    }`}
                                  >
                                    <span className="shrink-0">{item.label}:</span>
                                    <span className="truncate max-w-[65%] overflow-hidden text-right font-mono">{item.value}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                              {activeField === 9 || activeField === 10
                                ? '◄ ► Cambiar opción • ▲ ▼ Campo'
                                : activeField === 7 || activeField === 8
                                ? 'Fecha y hora automáticas • ▲ ▼ Campo'
                                : '▲ ▼ Campo • [FUNC] Siguiente pantalla'}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ESTADO 'OCC_LOAD_LIST': LISTA DE REGISTROS DE MEMORIA (Occ / PTO / Ref. / Crd), 5 filas con desplazamiento */}
                      {screenState === 'OCC_LOAD_LIST' && (() => {
                        const VISIBLE = 5;
                        const n = pointRecords.length;
                        const startIdx = Math.max(0, Math.min(selectedOccLoadIdx - 2, n - VISIBLE));
                        const visible = pointRecords.slice(startIdx, startIdx + VISIBLE);

                        return (
                          <div className="font-mono text-[13px] h-full flex flex-col">
                            <div className="flex-1 space-y-0 pt-0.5">
                              {visible.map((rec, localIdx) => {
                                const realIdx = startIdx + localIdx;
                                const isSel = selectedOccLoadIdx === realIdx;
                                return (
                                  <div
                                    key={rec.tag + rec.PTO + realIdx}
                                    onClick={() => setSelectedOccLoadIdx(realIdx)}
                                    onDoubleClick={() => handleEnterPress()}
                                    className={`flex items-center gap-3 px-1.5 py-[1px] rounded cursor-pointer min-w-0 ${
                                      isSel ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                    }`}
                                  >
                                    <span className="w-9 shrink-0 font-bold">{rec.tag}</span>
                                    <span className="truncate font-bold">{rec.PTO}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9px] text-neutral-700 flex justify-between font-sans border-t border-neutral-800/20 pt-0.5">
                              <span>{pickCtx === 'VER' ? 'VER DATOS' : 'CARGAR'} • ▲▼ • [ENT]</span>
                              <span>[{n ? selectedOccLoadIdx + 1 : 0}/{n}]</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* ESTADO 'OCC_LOAD_SEARCH': BUSCAR PUNTO (PTO, Criteria, Direct.) */}
                      {screenState === 'OCC_LOAD_SEARCH' && (
                        <div className="space-y-1 font-mono text-[13px] px-0.5 pt-1">
                          {[
                            { label: 'PTO', value: `${occSearchBuffer}${searchField === 0 ? '_' : ''}` },
                            { label: 'Criteria', value: searchField === 1 ? `◄ ${searchCriteria} ►` : searchCriteria },
                            { label: 'Direct.', value: searchField === 2 ? `◄ ${searchDirection} ►` : searchDirection }
                          ].map((row, i) => (
                            <div
                              key={row.label}
                              onClick={() => setSearchField(i)}
                              className={`flex items-center gap-2 px-1.5 py-0.5 rounded cursor-pointer min-w-0 ${
                                searchField === i ? 'lcd-inv font-black' : ''
                              }`}
                            >
                              <span className="shrink-0 font-bold w-20">{row.label}</span>
                              <span className="font-bold">:</span>
                              <span className="truncate font-bold">{row.value}</span>
                            </div>
                          ))}
                          <div className="text-[9px] text-neutral-700 text-center pt-1 font-sans">
                            Escriba el PTO • ◄ ► Criterio / Dirección • F4=[OK]
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'VER_DETAIL': DETALLE DEL REGISTRO (TOPO > Ver) */}
                      {screenState === 'VER_DETAIL' && (() => {
                        const rec = pointRecords[verDetailIdx];
                        if (!rec) return null;
                        return (
                          <div className="space-y-0.5 font-mono text-[13px] px-1 pt-0.5">
                            {[
                              { label: rec.tag, value: rec.PTO },
                              { label: 'Y', value: `${rec.N.toFixed(3)} m` },
                              { label: 'X', value: `${rec.E.toFixed(3)} m` },
                              { label: 'Z', value: `${rec.Z.toFixed(3)} m` },
                              { label: 'Cd', value: rec.CD || '' }
                            ].map(row => (
                              <div key={row.label} className="flex justify-between font-bold">
                                <span>{row.label}</span>
                                <span className="font-black">{row.value}</span>
                              </div>
                            ))}
                            <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                              ▲ ▼ Registro anterior/siguiente • [ESC] Lista
                            </div>
                          </div>
                        );
                      })()}

                      {/* ESTADO 'OCC_ACLER': ORIENTACIÓN ACLE.R */}
                      {screenState === 'OCC_ACLER' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                            <span>ACLE.R</span>
                          </div>
                          <div className="space-y-1 bg-black/5 p-1.5 rounded text-xs text-left">
                            <div className="text-left font-mono py-0.5 border-b border-neutral-800/10">
                              Pto. Ref.
                            </div>
                            <div className="text-left font-mono py-0.5 border-b border-neutral-800/10">
                              Lect.Ref
                            </div>
                            <div className="text-left font-mono py-0.5 border-b border-neutral-800/10 font-bold text-neutral-900">
                              AV Rango exced.
                            </div>
                            <div className="text-left font-mono py-0.5 border-b border-neutral-800/10">
                              HA-D
                            </div>
                            <div className="flex items-center gap-2 text-left font-mono py-0.5">
                              <span className="shrink-0">HA-D</span>
                              <span className="inline-flex items-center lcd-inv px-2 py-0.5 min-w-[70px] h-[18px] rounded-sm shadow-inner font-mono text-[11px] font-bold">
                                {inputBuffer !== '' ? `${inputBuffer}_` : <span className="inline-block w-1.5 h-3 bg-current animate-pulse" />}
                              </span>
                            </div>
                          </div>
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            F1=[REG] • F4=[OK]
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'OCC_TRISEC': MENÚ TRISECCIÓN (1. YXZ, 2. Cota, 3. Ajustes) */}
                      {screenState === 'OCC_TRISEC' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center">
                            <span>--- TRISECCIÓN ---</span>
                            <span className="text-[10px] font-bold">[{trisecSelection}/3]</span>
                          </div>
                          {[
                            { id: 1, label: '1. YXZ' },
                            { id: 2, label: '2. Cota' },
                            { id: 3, label: '3. Ajustes' }
                          ].map(item => {
                            const isSel = trisecSelection === item.id;
                            return (
                              <div
                                key={item.id}
                                onClick={() => handleKeypadPress(String(item.id))}
                                className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between ${
                                  isSel ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                
                              </div>
                            );
                          })}
                          <div className="text-[10px] text-neutral-700 text-center pt-0.5 font-sans">
                            ▲ ▼ Seleccionar - [ENT] Entrar
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'TRISEC_PT': Triseccn. 1roPto (F3 = ANGUL, F4 = MED) */}
                      {screenState === 'TRISEC_PT' && (
                        <div className="text-[13px] leading-[1.15] pr-1">
                          <div className="flex gap-6"><span>Triseccn.</span><span>1roPto</span></div>
                          <div className="flex justify-between"><span>GD</span><span>{lastMeas && trisecAng ? `${lastMeas.SD.toFixed(3)}m` : ''}</span></div>
                          <div className={trisecAng ? 'flex justify-between' : 'flex gap-3'}><span>AV</span><span>{trisecAng ? formatDMS(trisecAng.V) : 'Rango exced.'}</span></div>
                          <div className="flex justify-between"><span>HA-D</span><span>{trisecAng ? formatDMS(trisecAng.HA) : ''}</span></div>
                        </div>
                      )}

                      {/* ESTADO 'TRISEC_AJ': Ajustes de Trisección */}
                      {screenState === 'TRISEC_AJ' && (
                        <div className="space-y-1 font-mono text-[13px] px-1 pt-0.5">
                          <div className="font-black">Ajustes</div>
                          {[
                            { label: 'Obs cara1/2', value: trisecAj.obsCara },
                            { label: 'Z', value: trisecAj.z }
                          ].map((row, i) => (
                            <div key={row.label} className="flex items-center gap-2 font-bold">
                              <span className="w-28">{row.label}</span>
                              <span>:</span>
                              <span className={`px-1 ${trisecAj.field === i ? 'lcd-inv font-black' : ''}`}>{row.value}</span>
                            </div>
                          ))}
                          <div className="text-[9px] text-neutral-700 text-center pt-2 font-sans">
                            ▲ ▼ Campo • ◄ ► Cambiar • [ENT]/[ESC] Volver
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'ERXYZ': Estc. Ref. (Yref, Xref, Zref) — F1=[CARG], F4=[OK] */}
                      {screenState === 'ERXYZ' && (
                        <div className="space-y-0.5 font-mono text-[13px]">
                          <div className="font-black border-b border-neutral-800/30 pb-0.5 px-0.5">Estc. Ref.</div>
                          {[
                            { label: 'Yref', val: backsight.N },
                            { label: 'Xref', val: backsight.E },
                            { label: 'Zref', val: backsight.Z }
                          ].map((item, idx) => {
                            const isCur = activeField === idx;
                            return (
                              <div
                                key={item.label}
                                onClick={() => { commitCurrentField(); setActiveField(idx); }}
                                className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer min-w-0 font-bold ${
                                  isCur ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span className="shrink-0">{item.label}</span>
                                <span className="truncate max-w-[70%] overflow-hidden text-right font-mono">
                                  {isCur ? `${inputBuffer}_` : Number(item.val).toFixed(3)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* 4. ESTADO 'CHECK_BS': COMPROBACIÓN DE ORIENTACIÓN (AZ, HA-D, Acim) */}
                      {screenState === 'CHECK_BS' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5 min-w-0 items-center">
                            <span className="shrink-0">COMPROB. ORIEN.</span>
                            <span className="text-[10px] font-bold truncate max-w-[45%] overflow-hidden text-right">PTO: {backsight.PTO || 'BS-1'}</span>
                          </div>
                          <div className="space-y-0.5 bg-black/5 p-1 rounded">
                            <div className="text-[11px] font-bold text-neutral-900 border-b border-neutral-800/20 pb-0.5">
                              Estc. Ref.
                            </div>
                            <div className="text-[11px] font-bold text-neutral-900 border-b border-neutral-800/20 pb-0.5">
                              Lect. Ref.
                            </div>
                            <div className="flex justify-between items-center text-xs pt-0.5">
                              <span className="font-bold">AZ   :</span>
                              <span className="font-mono font-bold">{formatDMS(checkBsData.azTeo)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-bold">HA-D :</span>
                              <span className="font-mono font-bold">{formatDMS(checkBsData.haD)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-bold">Acim :</span>
                              <span className="font-mono font-bold">{formatDMS(checkBsData.acim)}</span>
                            </div>
                          </div>
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            F2=[MED]: Comprobar dDH • F4=[SI]: Fijar AZ
                          </div>
                        </div>
                      )}

                      {/* 5. ESTADO 'CHECK_BS_DIST': Ref.DisH ver (dDH = Obs H - Calc DH) */}
                      {screenState === 'CHECK_BS_DIST' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5 min-w-0 items-center">
                            <span className="shrink-0">Ref.DisH ver</span>
                            <span className="text-[10px] font-bold truncate max-w-[45%] overflow-hidden text-right">PTO: {backsight.PTO || 'BS-1'}</span>
                          </div>
                          <div className="space-y-1 bg-black/5 p-1.5 rounded">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-black">dDH    :</span>
                              <span className={`font-mono font-black ${Math.abs(checkBsData.dDH) <= 0.005 ? 'text-emerald-950' : 'text-amber-950'}`}>
                                {checkBsData.dDH >= 0 ? '+' : ''}{checkBsData.dDH.toFixed(3)} m
                              </span>
                            </div>
                            <div className="flex justify-between items-center text-[11px] text-neutral-800">
                              <span>Calc DH:</span>
                              <span className="font-mono">{checkBsData.calcDH.toFixed(3)} m</span>
                            </div>
                            <div className="flex justify-between items-center text-[11px] text-neutral-800">
                              <span>Obs H  :</span>
                              <span className="font-mono">{checkBsData.obsH.toFixed(3)} m</span>
                            </div>
                          </div>
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            F2=[ALT]: Re-medir • F4=[OK]: Fijar Azimut
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'EDM_MENU': CONFIGURACIÓN EDM (2 páginas, ◄ ► cambia, números para valores) */}
                      {screenState === 'EDM_MENU' && (() => {
                        const val = (f: number, normal: string) => (edmField === f && edmBuffer !== '' ? `${edmBuffer}_` : normal);
                        const rows = [
                          { label: 'Modo', value: edmCfg.modo },
                          { label: 'Reflector', value: currentReflectorName },
                          { label: 'CP', value: val(2, String(edmCfg.cp)) },
                          { label: 'Mant.Ilum.', value: edmCfg.mantIlum },
                          { label: 'Luz guía', value: edmCfg.luzGuia },
                          { label: 'Temp.', value: val(5, `${stationAtm.temp}°C`) },
                          { label: 'Pres.', value: val(6, `${stationAtm.pres}hPa`) },
                          { label: 'PPm', value: val(7, `${stationAtm.ppm}ppm`) }
                        ];
                        const page = edmField < 4 ? 0 : 1;
                        return (
                          <div className="space-y-0.5 font-mono text-[13px] px-0.5">
                            <div className="font-black flex justify-between border-b border-neutral-800/30 pb-0.5">
                              <span>EDM</span>
                              <span className="text-[10px]">{page + 1}/2</span>
                            </div>
                            {rows.slice(page * 4, page * 4 + 4).map((row, i) => {
                              const f = page * 4 + i;
                              const isCur = edmField === f;
                              return (
                                <div
                                  key={row.label}
                                  onClick={() => { commitEdmField(); setEdmField(f); }}
                                  className="flex items-center gap-1 font-bold cursor-pointer"
                                >
                                  <span className="w-24 shrink-0">{row.label}</span>
                                  <span>:</span>
                                  <span className={`px-1 truncate ${isCur ? 'lcd-inv font-black' : ''}`}>
                                    {row.value}
                                  </span>
                                </div>
                              );
                            })}
                            <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                              ▲ ▼ Campo • ◄ ► Cambiar • [ESC] Volver
                            </div>
                          </div>
                        );
                      })()}

                      {/* ESTADO 'DESPLZ_MENU' desde Observación: Despl (Despl/Dist, Despl/Ang, Despl./2D) con su dibujo */}
                      {screenState === 'DESPLZ_MENU' && desplzReturn === 'OBS' && (
                        <div className="flex text-[13px] leading-[1.15]">
                          <div className="flex-1">
                            <div>DesPl</div>
                            {['DesPl/Dist', 'DesPl/Ang', 'DesPl./2D'].map((l, i) => (
                              <div key={l} className="pl-3 cursor-pointer" onClick={() => setDesplzMenuSelection(i + 1)}>
                                <span className={desplzMenuSelection === i + 1 ? 'lcd-inv px-0.5' : 'px-0.5'}>{l}</span>
                              </div>
                            ))}
                          </div>
                          <svg viewBox="0 0 90 70" className="w-[92px] h-[72px]" fill="none" stroke="currentColor" strokeWidth="1.4">
                            <text x="14" y="12" fontSize="10" fill="currentColor" stroke="none">L</text>
                            <text x="62" y="12" fontSize="10" fill="currentColor" stroke="none">Out</text>
                            <text x="4" y="44" fontSize="10" fill="currentColor" stroke="none">In</text>
                            <text x="80" y="44" fontSize="10" fill="currentColor" stroke="none">R</text>
                            <line x1="20" y1="14" x2="70" y2="40" strokeDasharray="3 2" />
                            <line x1="70" y1="14" x2="18" y2="40" strokeDasharray="3 2" />
                            <circle cx="44" cy="27" r="3" fill="currentColor" />
                            <rect x="36" y="48" width="12" height="18" />
                            <line x1="42" y1="48" x2="44" y2="30" />
                          </svg>
                        </div>
                      )}

                      {/* ESTADO 'DESPLZ_MENU': MENÚ DESPLAZAMIENTO */}
                      {screenState === 'DESPLZ_MENU' && desplzReturn !== 'OBS' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center text-[11px]">
                            <span>--- DESPLZ ---</span>
                            <span className="text-[10px] text-neutral-800 font-bold">[{desplzMenuSelection}/5]</span>
                          </div>
                          {[
                            { id: 1, label: '1. Occ.Orien.' },
                            { id: 2, label: '2. DesPl/Dist' },
                            { id: 3, label: '3. DesPl/Ang' },
                            { id: 4, label: '4. DesPl/2D' },
                            { id: 5, label: '5. DesPl/Plan.' }
                          ].map(item => {
                            const isSel = desplzMenuSelection === item.id;
                            return (
                              <div
                                key={item.id}
                                onClick={() => {
                                  setDesplzMenuSelection(item.id);
                                  if (item.id === 1) {
                                    setScreenState('OCC_ORIEN');
                                    setActiveField(0);
                                    setOccPage(1);
                                  } else {
                                    setLcdMessage('DESPLZ:\nEN DESARROLLO');
                                  }
                                }}
                                className={`px-1.5 py-0.5 rounded cursor-pointer flex items-center justify-between text-[11px] ${
                                  isSel ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                
                              </div>
                            );
                          })}
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            ▲ / ▼: Seleccionar • [ENT]: Entrar
                          </div>
                        </div>
                      )}

                      {/* 3. ESTADO 'USB_MENU': MENÚ USB PANTALLA 1 (TIPO T / TIPO S) */}
                      {screenState === 'USB_MENU' &&
                        renderLcdMenu('USB', ['tiPo T', 'tiPo S'], usbMenuSelection - 1, i => handleKeypadPress(String(i + 1)))}

                      {/* ESTADO 'USB_TTYPE': MENÚ USB PANTALLA 2 (TIPO T / TIPO S) */}
                      {screenState === 'USB_TTYPE' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center text-[11px]">
                            <span>--- TIPO {usbTypeMode} ---</span>
                            <span className="text-[10px] text-neutral-800 font-bold">[{usbTTypeSelection}/5]</span>
                          </div>
                          {[
                            { id: 1, label: '1. Guardar Datos' },
                            { id: 2, label: '2. Cargar Pto.Conoc' },
                            { id: 3, label: '3. Guardar codigo' },
                            { id: 4, label: '4. Cargar codigo' },
                            { id: 5, label: '5. Estado de fich.' }
                          ].map(item => {
                            const isSel = usbTTypeSelection === item.id;
                            return (
                              <div
                                key={item.id}
                                onClick={() => {
                                  setUsbTTypeSelection(item.id);
                                  if (item.id === 1) {
                                    setScreenState('USB_SAVE_JOB');
                                    setSelectedJobIdx(0);
                                  } else if (item.id === 2) {
                                    setLcdMessage('CARGAR PTO.CONOC:\nDISPOSITIVO NO CONECTADO');
                                  } else if (item.id === 3) {
                                    setLcdMessage('GUARDAR CODIGO:\nSIN CODIGOS EXTERNOS');
                                  } else if (item.id === 4) {
                                    setLcdMessage('CARGAR CODIGO:\nDISPOSITIVO NO CONECTADO');
                                  } else if (item.id === 5) {
                                    setLcdMessage('ESTADO DE FICH.:\nMEMORIA USB LISTA');
                                  }
                                }}
                                className={`px-1.5 py-0.5 rounded cursor-pointer flex items-center justify-between text-[11px] ${
                                  isSel ? 'lcd-inv font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                
                              </div>
                            );
                          })}
                          <div className="text-[10px] text-neutral-800 text-center pt-1 font-mono lcd-hint">
                            ▲ ▼ Seleccionar - [ENT] Entrar
                          </div>
                        </div>
                      )}

                      {/* 3. ESTADO 'USB_SAVE_JOB': SELECCIONAR TRABAJO PARA EXPORTAR */}
                      {screenState === 'USB_SAVE_JOB' && (() => {
                        const currentPage = Math.floor(selectedJobIdx / 5);
                        const visibleJobs = jobsList.slice(currentPage * 5, (currentPage + 1) * 5);
                        return (
                          <div className="space-y-1 font-mono text-xs px-1">
                            <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5 font-mono">
                              <span>SELEC TRABAJO USB</span>
                              <span className="text-[10px] font-bold">[{currentPage + 1}/2]</span>
                            </div>
                            <div className="space-y-0.5">
                              {visibleJobs.map((job, localIdx) => {
                                const globalIdx = currentPage * 5 + localIdx;
                                const isSelected = selectedJobIdx === globalIdx;
                                return (
                                  <div
                                    key={job + globalIdx}
                                    onClick={() => setSelectedJobIdx(globalIdx)}
                                    className={`px-2 py-0.5 rounded cursor-pointer flex justify-between items-center text-xs min-w-0 font-mono ${
                                      isSelected
                                        ? 'lcd-inv font-black'
                                        : 'hover:bg-black/10 text-neutral-900 font-semibold'
                                    }`}
                                  >
                                    <span className="truncate max-w-[80%] overflow-hidden">{job}</span>
                                    
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9.5px] text-neutral-800 text-center pt-0.5 font-mono truncate lcd-hint">
                              * No exportado a USB - [ENT] Seleccionar Trabajo
                            </div>
                          </div>
                        );
                      })()}

                      {/* 3. ESTADO 'USB_FORMAT': SELECCIÓN DE FORMATOS GTS / SSS */}
                      {screenState === 'USB_FORMAT' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center text-[11px]">
                            <span>FORMATO EXPORT.</span>
                            <span className="text-[10px] text-neutral-800 font-bold">[{usbFormatSelection}/4]</span>
                          </div>
                          {[
                            { id: 1, label: '1. GTS(Obs)' },
                            { id: 2, label: '2. GTS(Coord)' },
                            { id: 3, label: '3. SSS(Obs)' },
                            { id: 4, label: '4. SSS(Coord)' }
                          ].map(item => (
                            <div
                              key={item.id}
                              onClick={() => {
                                setUsbFormatSelection(item.id);
                                if (item.id === 4) {
                                  exportarAUSB(usbSelectedJob);
                                } else {
                                  setLcdMessage('FORMATO NO DISP.\nBAJE A 4. SSS(Coord)');
                                }
                              }}
                              className={`px-1.5 py-0.5 rounded cursor-pointer flex items-center justify-between text-[11px] ${
                                usbFormatSelection === item.id ? 'lcd-inv font-black' : 'hover:bg-black/10'
                              }`}
                            >
                              <span>{item.label}</span>
                              
                            </div>
                          ))}
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            Baje a 4. SSS(Coord) y pulse [ENT] para descargar CSV
                          </div>
                        </div>
                      )}

                      {/* 1. ESTADO 'OBS': OBSERVACIÓN como el equipo: X, Y, Z, HD (altura prisma), Cd — y PTO en su propia pantalla */}
                      {screenState === 'OBS' && (() => {
                        const radV = envV * (Math.PI / 180);
                        let liveAz = azimutInicial + envHD;
                        liveAz = ((liveAz % 360) + 360) % 360;
                        const liveAzRad = liveAz * (Math.PI / 180);
                        const liveDH = envSD * Math.sin(radV);
                        const liveDV = envSD * Math.cos(radV);
                        const bufHR = parseFloat(inputBuffer);
                        const hr = activeField === 2 && !isNaN(bufHR) ? bufHR : target.HR;
                        const show = obsMeasured || obsShotFlash;
                        const liveY = station.N + (liveDH * Math.cos(liveAzRad));
                        const liveX = station.E + (liveDH * Math.sin(liveAzRad));
                        const liveZ = station.Z + station.HI + liveDV - hr;
                        const cell = (f: number, normal: string) => (
                          <span
                            onClick={() => { commitCurrentField(); setActiveField(f); }}
                            className={`flex-1 text-right px-0.5 cursor-pointer truncate ${activeField === f ? 'lcd-inv' : ''}`}
                          >
                            {activeField === f ? `${inputBuffer}_` : normal}
                          </span>
                        );

                        if (activeField === 0) {
                          // Pantalla de PTO
                          return (
                            <div className="text-[13px] leading-[1.15] pr-1">
                              <div className="flex gap-2">
                                <span className="w-10 shrink-0">PTO</span>
                                {cell(0, target.PTO)}
                              </div>
                              {obsShotFlash && <div className="pt-6 text-center">Registrado</div>}
                            </div>
                          );
                        }
                        return (
                          <div className="text-[13px] leading-[1.15] pr-1">
                            <div className="flex justify-between"><span>X</span><span>{show ? liveX.toFixed(3) : ''}</span></div>
                            <div className="flex justify-between"><span>Y</span><span>{show ? liveY.toFixed(3) : ''}</span></div>
                            <div className="flex justify-between"><span>Z</span><span>{show ? liveZ.toFixed(3) : ''}</span></div>
                            <div className="flex gap-2"><span className="w-10 shrink-0">HD</span>{cell(2, `${target.HR.toFixed(3)}m`)}</div>
                            <div className="flex gap-2"><span className="w-10 shrink-0">Cd</span>{cell(1, target.CD)}</div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>

                {/* Iconos del LCD real: batería, compensador, página de MED y modo de entrada */}
                <div className="w-[16px] shrink-0 flex flex-col items-center gap-1 pt-0.5 text-neutral-950" aria-hidden="true">
                  <svg viewBox="0 0 10 16" className="w-[9px] h-[14px]" fill="currentColor">
                    <rect x="3" y="0" width="4" height="2" />
                    <rect x="0.5" y="2" width="9" height="13.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <rect x="2" y="4" width="6" height="10" />
                  </svg>
                  {cfg['obs.compens'] !== 'No' && (
                    <svg viewBox="0 0 14 14" className="w-[12px] h-[12px]" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <rect x="1" y="1" width="12" height="12" />
                      <line x1="7" y1="1" x2="7" y2="13" />
                      <line x1="1" y1="7" x2="13" y2="7" />
                    </svg>
                  )}
                  {screenState === 'MED' && <span className="lcd-inv text-[11px] leading-none px-[1px]">P{medPage}</span>}
                  {isCurrentFieldAlpha && (
                    <span className="lcd-inv text-[11px] leading-none px-[2px]">{inputMode === 'ALF' ? 'A' : inputMode === 'SIM' ? 'S' : '1'}</span>
                  )}
                  {cfg['plomLaser'] === 'On' && <span className="text-[11px] leading-none">✶</span>}
                </div>
                </div>

                {/* 3. BASE LCD: 4 ETIQUETAS DINÁMICAS (F1-F4) — invertidas como en el equipo */}
                <div className="grid grid-cols-4 gap-1 pt-1 text-center text-[13px] leading-none">
                  {fLabels.map((lbl, idx) => (
                    <div key={idx} className={`py-[3px] rounded-[2px] truncate ${lbl ? 'lcd-inv' : ''}`}>
                      {lbl || '\u00A0'}
                    </div>
                  ))}
                </div>
              </div>
            </div>

                {/* FILA F1-F4: JUSTO DEBAJO DE LA PANTALLA (AMARILLO OSCURO, TEXTO NEGRO) */}
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map(num => (
                    <button
                      key={num}
                      onClick={() => handleFKey(num as 1 | 2 | 3 | 4)}
                      className="h-9 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-neutral-950 font-black text-xs rounded-md shadow-md border-b-3 border-amber-700 active:border-b-0 active:translate-y-0.5 transition-all flex flex-col items-center justify-center cursor-pointer select-none"
                    >
                      <span className="leading-tight">F{num}</span>
                      <span className="text-[8px] font-bold text-neutral-900 leading-none truncate max-w-full px-0.5">
                        {fLabels[num - 1] || '•'}
                      </span>
                    </button>
                  ))}
                </div>

                {/* FILA DE SISTEMA: [ESC] (Negro), [B.S.] (Negro), [SHIFT] (Azul claro), [FUNC] (Amarillo oscuro) */}
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={handleEscPress}
                    className="h-9 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-white font-bold text-xs rounded-md shadow-md border-b-3 border-neutral-950 active:border-b-0 active:translate-y-0.5 transition-all flex items-center justify-center cursor-pointer select-none"
                    title="ESC: Salir o ir a Menú DATO"
                  >
                    ESC
                  </button>
                  <button
                    onClick={() => handleKeypadPress('BS')}
                    className="h-9 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-white font-bold text-xs rounded-md shadow-md border-b-3 border-neutral-950 active:border-b-0 active:translate-y-0.5 transition-all flex items-center justify-center cursor-pointer select-none"
                    title="B.S.: Borrar carácter"
                  >
                    B.S.
                  </button>
                  <button
                    onClick={handleShiftPress}
                    className="h-9 bg-sky-400 hover:bg-sky-300 active:bg-sky-500 text-neutral-950 font-black text-xs rounded-md shadow-md border-b-3 border-sky-600 active:border-b-0 active:translate-y-0.5 transition-all flex items-center justify-center gap-1 cursor-pointer select-none"
                    title="SHIFT: Cambiar modo de escritura (Números / Letras / Signos)"
                  >
                    <span className="text-[10px] leading-none">⇧</span>
                    <span className="text-[10px] font-black tracking-tight">SHIFT</span>
                  </button>
                  <button
                    onClick={handleFuncPress}
                    className="h-9 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-neutral-950 font-black text-xs rounded-md shadow-md border-b-3 border-amber-700 active:border-b-0 active:translate-y-0.5 transition-all flex items-center justify-center cursor-pointer select-none"
                    title="FUNC: Alternar Pág 1 / Pág 2"
                  >
                    FUNC
                  </button>
                </div>

                {/* BARRA ALFANUMÉRICA COMPACTA (Desplegada en campos de texto) */}
                {(isCurrentFieldAlpha || isAlphaKeyboardOpen) && (
                  <div className="bg-neutral-950 p-2 rounded-xl border border-neutral-800 space-y-1 animate-in fade-in">
                    <div className="flex justify-between items-center text-[10px] text-amber-400 font-bold px-1">
                      <span>
                        TEXTO • MODO {inputMode === 'NUM' ? 'NÚMEROS' : inputMode === 'ALF' ? 'LETRAS' : 'SIGNOS'}
                      </span>
                      <span className="text-slate-400 text-[9px]">SHIFT cambia el modo</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {['BM-', 'P-', 'E-', 'EST-', 'PTO-'].map(pref => (
                        <button
                          key={pref}
                          onClick={() => {
                            playBeep(1200, 0.04);
                            setInputBuffer(pref);
                          }}
                          className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded text-[10px] font-mono font-bold cursor-pointer"
                        >
                          {pref}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {['A', 'B', 'C', 'D', 'E', 'M', 'P', 'R', 'V', '_'].map(char => (
                        <button
                          key={char}
                          onClick={() => {
                            playBeep(1150, 0.04);
                            setInputBuffer(prev => prev + char);
                          }}
                          className="w-6 h-6 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-[11px] font-mono font-bold flex items-center justify-center cursor-pointer border border-neutral-700"
                        >
                          {char}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ========================================================== */}
              {/* LADO DERECHO DEL PANEL (md:col-span-5)                    */}
              {/* ========================================================== */}
              <div className="md:col-span-5 flex flex-col gap-3">
                
                {/* FILA SUPERIOR ESPECIAL: 3 BOTONES PEQUEÑOS (ESTRELLA, ILUMINACIÓN/SOL, ENCENDIDO POWER) */}
                <div className="flex items-center justify-between gap-2 bg-neutral-950/70 p-1.5 rounded-xl border border-neutral-800">
                  <button
                    onClick={handleStarPress}
                    className="flex-1 h-8 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-amber-400 rounded-md shadow-md border-b-2 border-neutral-950 active:border-b-0 active:translate-y-0.5 flex items-center justify-center cursor-pointer transition-all"
                    title="Tecla Rápida ★ (Ajustes Rápidos)"
                  >
                    <Star size={14} className="fill-amber-400 text-amber-400" />
                  </button>

                  <button
                    onClick={() => {
                      playBeep(1350, 0.05);
                      setIsBacklightOn(b => !b);
                    }}
                    className="flex-1 h-8 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-yellow-300 rounded-md shadow-md border-b-2 border-neutral-950 active:border-b-0 active:translate-y-0.5 flex items-center justify-center cursor-pointer transition-all"
                    title="Iluminación Pantalla (Backlight)"
                  >
                    <Sun size={15} />
                  </button>

                  <button
                    onClick={() => {
                      playBeep(850, 0.08);
                      setScreenState('TILT');
                    }}
                    className="flex-1 h-8 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-neutral-950 font-bold rounded-md shadow-md border-b-2 border-emerald-700 active:border-b-0 active:translate-y-0.5 flex items-center justify-center gap-1 cursor-pointer transition-all"
                    title="Encendido / Reset a TILT"
                  >
                    <Power size={13} className="stroke-[2.5]" />
                    <span className="text-[10px] font-black uppercase">PWR</span>
                  </button>
                </div>

                {/* TECLADO ALFANUMÉRICO (GRID 3x4): BOTONES DE COLOR BLANCO CON TEXTO NEGRO */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { num: '7', sub: 'ABC', val: '7' },
                    { num: '8', sub: 'DEF', val: '8' },
                    { num: '9', sub: 'GHI', val: '9' },
                    { num: '4', sub: 'JKL', val: '4' },
                    { num: '5', sub: 'MNO', val: '5' },
                    { num: '6', sub: 'PQR', val: '6' },
                    { num: '1', sub: 'STU', val: '1' },
                    { num: '2', sub: 'VWX', val: '2' },
                    { num: '3', sub: 'YZ!', val: '3' },
                    { num: '0', sub: '/_&', val: '0' },
                    { num: '.', sub: '*?$', val: '.' },
                    { num: '±', sub: '+/-', val: '-' }
                  ].map(item => (
                    <button
                      key={item.num + item.sub}
                      onClick={() => handleKeypadPress(item.val)}
                      className="h-10 bg-white hover:bg-gray-100 active:bg-gray-200 text-neutral-900 rounded-lg shadow-md border-b-3 border-gray-400 active:border-b-0 active:translate-y-0.5 transition-all flex flex-col items-center justify-center cursor-pointer select-none"
                    >
                      <span className="font-extrabold text-sm leading-tight text-neutral-950 font-mono">
                        {item.num}
                      </span>
                      <span className="text-[9px] font-bold text-neutral-600 tracking-tighter leading-none">
                        {item.sub}
                      </span>
                    </button>
                  ))}
                </div>

                {/* NAVEGACIÓN (ABAJO A LA DERECHA): PAD CIRCULAR BLANCO (D-PAD) + BOTÓN [ENT] AZUL CLARO */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  
                  {/* Pad circular blanco (D-pad) grande con 4 flechas negras integradas */}
                  <div className="relative w-28 h-28 bg-gradient-to-b from-white to-gray-200 rounded-full shadow-lg border-2 border-gray-300 flex items-center justify-center p-1 select-none shrink-0">
                    {/* Flecha ARRIBA */}
                    <button
                      onClick={() => handleArrow('UP')}
                      className="absolute top-1 left-1/2 -translate-x-1/2 w-8 h-7 text-neutral-900 hover:text-black active:scale-90 flex items-center justify-center cursor-pointer transition-transform"
                      title="Navegar Arriba"
                    >
                      <span className="text-base font-black">▲</span>
                    </button>

                    {/* Flecha IZQUIERDA */}
                    <button
                      onClick={() => handleArrow('LEFT')}
                      className="absolute left-1 top-1/2 -translate-y-1/2 w-7 h-8 text-neutral-900 hover:text-black active:scale-90 flex items-center justify-center cursor-pointer transition-transform"
                      title="Navegar Izquierda"
                    >
                      <span className="text-base font-black">◄</span>
                    </button>

                    {/* Centro D-Pad: botón (cambia el valor en pantallas de ajustes, como el equipo) */}
                    <button
                      onClick={() => { playBeep(1050, 0.04); overrideRef.current?.center(); }}
                      className="w-8 h-8 rounded-full bg-gray-100 hover:bg-white active:scale-90 border border-gray-300 shadow-inner flex items-center justify-center cursor-pointer transition-transform"
                      title="Centro: cambiar valor"
                    >
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-400"></div>
                    </button>

                    {/* Flecha DERECHA */}
                    <button
                      onClick={() => handleArrow('RIGHT')}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-8 text-neutral-900 hover:text-black active:scale-90 flex items-center justify-center cursor-pointer transition-transform"
                      title="Navegar Derecha"
                    >
                      <span className="text-base font-black">►</span>
                    </button>

                    {/* Flecha ABAJO */}
                    <button
                      onClick={() => handleArrow('DOWN')}
                      className="absolute bottom-1 left-1/2 -translate-x-1/2 w-8 h-7 text-neutral-900 hover:text-black active:scale-90 flex items-center justify-center cursor-pointer transition-transform"
                      title="Navegar Abajo"
                    >
                      <span className="text-base font-black">▼</span>
                    </button>
                  </div>

                  {/* Botón [ENT] cuadrado/rectangular de color Azul claro */}
                  <button
                    onClick={handleEnterPress}
                    className="flex-1 h-28 bg-sky-400 hover:bg-sky-300 active:bg-sky-500 text-neutral-950 font-black rounded-2xl shadow-lg border-b-4 border-r border-sky-600 active:border-b-0 active:translate-y-0.5 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer select-none"
                    title="Aceptar / Confirmar (ENT)"
                  >
                    <CornerDownLeft size={24} className="stroke-[3]" />
                    <span className="text-sm font-black tracking-wider">ENT</span>
                  </button>
                </div>

              </div>

            </div>

            {/* Pie de chasis con estado de nivel */}
            <div className="flex items-center justify-between pt-2 border-t border-neutral-800 text-[10px] text-neutral-400">
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  Compensador Bi-axial Calibrado
                </span>
                {cfg['plomLaser'] === 'On' && (
                  <span className="flex items-center gap-1 text-rose-400 font-bold">
                    <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_2px_rgba(244,63,94,0.8)] animate-pulse"></span>
                    Plomada láser ON (Niv. {cfg['nivLaser']})
                  </span>
                )}
              </span>
              <span className="font-mono text-[9px] text-neutral-500">
                TOPCON POSITIONING SYSTEMS, INC.
              </span>
            </div>
          </div>
        </section>

        {/* ============================================================== */}
        {/* PANEL DE REGULADORES: SIMULACIÓN DEL MUNDO FÍSICO EXTERIOR     */}
        {/* ============================================================== */}
        <aside className="w-full max-w-[420px] bg-[#FAF8F5]/95 border border-[#DDD6C7] p-5 rounded-2xl shadow-xl flex flex-col gap-5 text-[#26231E]">
          <div className="border-b border-[#E8E2D5] pb-3">
            <h2 className="text-sm font-bold text-[#945F03] flex items-center gap-2">
              <Sliders size={16} className="text-[#D99414]" />
              Reguladores de Terreno (Mundo Físico)
            </h2>
            <p className="text-xs text-[#6B6355] mt-1 leading-relaxed">
              Alimenta al distanciómetro EDM. En Observación, pulsar <b className="text-[#945F03]">[F3 AUTO]</b> lee estos valores, calcula la posición y avanza el PTO.
            </p>
          </div>

          {/* 1. Ángulo Horizontal (HD) */}
          <div className="space-y-1.5 bg-[#F3EFE7] p-3 rounded-xl border border-[#DDD6C7]">
            <div className="flex justify-between items-center text-xs">
              <label className="font-semibold text-[#544E43]">Ángulo Horizontal (HD)</label>
              <span className="font-mono font-bold text-[#945F03] bg-[#D99414]/15 px-2 py-0.5 rounded border border-[#D99414]/30">
                {formatDMS(envHD)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                max="360"
                value={envHD}
                onChange={e => setEnvHD(parseFloat(e.target.value) || 0)}
                className="w-full bg-white border border-[#DDD6C7] focus:border-[#D99414] rounded px-2.5 py-1 text-xs font-mono text-[#26231E] outline-none"
              />
              <span className="text-[11px] font-mono text-[#8C8373]">deg</span>
            </div>
            <input
              type="range"
              min="0"
              max="359.99"
              step="0.1"
              value={envHD}
              onChange={e => setEnvHD(parseFloat(e.target.value))}
              className="w-full accent-[#D99414] cursor-pointer"
            />
          </div>

          {/* 2. Ángulo Cenital (V) */}
          <div className="space-y-1.5 bg-[#F3EFE7] p-3 rounded-xl border border-[#DDD6C7]">
            <div className="flex justify-between items-center text-xs">
              <label className="font-semibold text-[#544E43]">Ángulo Cenital (V)</label>
              <span className="font-mono font-bold text-[#945F03] bg-[#D99414]/15 px-2 py-0.5 rounded border border-[#D99414]/30">
                {formatDMS(envV)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="45"
                max="135"
                value={envV}
                onChange={e => setEnvV(parseFloat(e.target.value) || 90)}
                className="w-full bg-white border border-[#DDD6C7] focus:border-[#D99414] rounded px-2.5 py-1 text-xs font-mono text-[#26231E] outline-none"
              />
              <span className="text-[11px] font-mono text-[#8C8373]">deg</span>
            </div>
            <input
              type="range"
              min="60"
              max="120"
              step="0.1"
              value={envV}
              onChange={e => setEnvV(parseFloat(e.target.value))}
              className="w-full accent-[#D99414] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#8C8373]">
              <span>60° (Elevación)</span>
              <span className="text-[#945F03] font-bold">90° (Horiz.)</span>
              <span>120° (Depresión)</span>
            </div>
          </div>

          {/* 3. Distancia Inclinada Real (SD) */}
          <div className="space-y-1.5 bg-[#F3EFE7] p-3 rounded-xl border border-[#DDD6C7]">
            <div className="flex justify-between items-center text-xs">
              <label className="font-semibold text-[#544E43]">Distancia Inclinada (SD)</label>
              <span className="font-mono font-bold text-[#945F03] bg-[#D99414]/15 px-2 py-0.5 rounded border border-[#D99414]/30">
                {envSD.toFixed(3)} m
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.05"
                min="1"
                max="500"
                value={envSD}
                onChange={e => setEnvSD(parseFloat(e.target.value) || 1)}
                className="w-full bg-white border border-[#DDD6C7] focus:border-[#D99414] rounded px-2.5 py-1 text-xs font-mono text-[#26231E] outline-none"
              />
              <span className="text-[11px] font-mono text-[#8C8373]">m</span>
            </div>
            <input
              type="range"
              min="1"
              max="200"
              step="0.5"
              value={envSD}
              onChange={e => setEnvSD(parseFloat(e.target.value))}
              className="w-full accent-[#D99414] cursor-pointer"
            />
          </div>

          {/* 4. Altura del Prisma (HR) */}
          <div className="space-y-1.5 bg-[#F3EFE7] p-3 rounded-xl border border-[#DDD6C7]">
            <div className="flex justify-between items-center text-xs">
              <label className="font-semibold text-[#544E43]">Altura del Prisma (HR)</label>
              <span className="font-mono font-bold text-emerald-700 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/30">
                {target.HR.toFixed(3)} m
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.001"
                min="0"
                max="5"
                value={target.HR}
                onChange={e => setTarget(prev => ({ ...prev, HR: parseFloat(e.target.value) || 0 }))}
                className="w-full bg-white border border-[#DDD6C7] focus:border-emerald-600 rounded px-2.5 py-1 text-xs font-mono text-[#26231E] outline-none"
              />
              <span className="text-[11px] font-mono text-[#8C8373]">m</span>
            </div>
            <input
              type="range"
              min="0"
              max="5"
              step="0.01"
              value={target.HR}
              onChange={e => setTarget(prev => ({ ...prev, HR: parseFloat(e.target.value) || 0 }))}
              className="w-full accent-emerald-600 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#8C8373]">
              <span>0m (Suelo)</span>
              <span className="text-emerald-700 font-bold">1.5m (Estándar)</span>
              <span>5m (Max)</span>
            </div>
          </div>

          {/* Estado de Memoria y Descarga USB */}
          <div className="bg-[#F3EFE7] p-3 rounded-xl border border-[#DDD6C7] text-xs space-y-1">
            <div className="flex justify-between text-[#544E43]">
              <span>Trabajo On-Board:</span>
              <span className="font-bold text-[#945F03] font-mono">{jobName}</span>
            </div>
            <div className="flex justify-between text-[#6B6355] text-[11px]">
              <span>Puntos en Memoria:</span>
              <span className="font-mono text-emerald-700 font-bold">{points.length} puntos</span>
            </div>
            <div className="text-[10px] text-[#8C8373] italic pt-1 border-t border-[#DDD6C7]">
              * Para exportar a USB: En MED (Pág 2 con [FUNC]) pulsa [F2 USB] &gt; 1. Guardar Datos &gt; Selecciona Trabajo &gt; 4. SSS(Coord).
            </div>
          </div>
        </aside>

      </main>

      {/* FOOTER ACADÉMICO */}
      <footer className="border-t border-[#DDD6C7] bg-[#FAF8F5]/90 px-6 py-2.5 text-xs text-[#6B6355] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-[#26231E] font-semibold">Flujo de Campo Real:</span>
          <span>1. Nivel [F1 OK]</span>
          <span>→</span>
          <span>2. Trabajo ([ESC] DATO)</span>
          <span>→</span>
          <span>3. Estacionar y Orientar ([COORD])</span>
          <span>→</span>
          <span>4. Radiar ([F3 AUTO])</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-[#8C8373]">
          <span>TOPCON ES-105 • EDM SIN REFLECTOR 500M • PRISMA 4000M</span>
        </div>
      </footer>
    </div>
  );
}
