import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Battery,
  BatteryLow,
  BatteryMedium,
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
  | 'DESPLZ_MENU';

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

// 10 Slots de Trabajos por defecto Topcon ES-105 (* no exportados a USB)
const DEFAULT_JOB_SLOTS = [
  '*PROYECTO01',
  '*PRUEBA',
  '*PROYECTO1',
  '*TOPOGRAFIA',
  '*CANTERA',
  '*OBRA_SUR',
  '*PARQUE',
  '*JOB08',
  '*JOB09',
  '*JOB10'
];

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
    CD: 'BASE',
    operador: localStorage.getItem('user_name') || 'TOPOGRAFO',
    clima: 'DESPEJADO',
    viento: 'Calma',
    temp: '20°C',
    pres: '760mmHg',
    ppm: '11'
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

  const [jobName, setJobName] = useState<string>('PROYECTO01');
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
  const [isOriented, setIsOriented] = useState<boolean>(true);
  const [isAlphaKeyboardOpen, setIsAlphaKeyboardOpen] = useState<boolean>(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState<boolean>(false);

  // Estados para pantalla MED y Compensador ComPen (AZ-0)
  const [isMeasuringFast, setIsMeasuringFast] = useState<boolean>(false);
  const [showTaraSoftkey, setShowTaraSoftkey] = useState<boolean>(false);
  const [compenX, setCompenX] = useState<number>(-167); // Representa -2' 47"
  const [compenY, setCompenY] = useState<number>(245);  // > 210" -> * * * *
  const [isDraggingBubble, setIsDraggingBubble] = useState<boolean>(false);
  const compenSvgRef = useRef<SVGSVGElement | null>(null);

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
  const [edmReflector, setEdmReflector] = useState<'N-Prism' | 'Prisma' | 'Diana' | 'N-Prisma'>('N-Prism');
  const [desplzMenuSelection, setDesplzMenuSelection] = useState<number>(1);
  const [isStarMenuOpen, setIsStarMenuOpen] = useState<boolean>(false);
  const [usbTTypeSelection, setUsbTTypeSelection] = useState<number>(1);
  const [usbTypeMode, setUsbTypeMode] = useState<'T' | 'S'>('S');

  const GRAPHIC_MENU_ITEMS = useMemo(() => [
    { id: 'coord', name: 'Coord' },
    { id: 'replanteo', name: 'RePlanteo' },
    { id: 'desplz', name: 'DesPlz.' },
    { id: 'topo', name: 'ToPografia' },
    { id: 'mdr', name: 'MDR' },
    { id: 'calc_area', name: 'Calc.Area' },
    { id: 'repl_linea', name: 'RePl Linea' },
    { id: 'repl_arco', name: 'RePl Arco' },
    { id: 'proyecto_p', name: 'Proyecto-P' },
    { id: 'pt_a_linea', name: 'Pt.a.Linea' },
    { id: 'poligonal', name: 'Poligonal' },
    { id: 'vial', name: 'Vial' },
    { id: 'per_trans', name: 'Per.Trans.' }
  ], []);

  const occLoadPoints = useMemo<TopoPoint[]>(() => {
    const defaultPts: TopoPoint[] = [
      { PTO: 'PTO 1', N: 1000.0, E: 1000.0, Z: 100.0, CD: 'BASE' },
      { PTO: 'PTO 2', N: 1025.5, E: 1018.2, Z: 101.4, CD: 'REF' }
    ];
    const userPts = [...points, ...knownPoints];
    const combined = [...defaultPts];
    for (const p of userPts) {
      if (!combined.some(c => c.PTO.toLowerCase() === p.PTO.toLowerCase())) {
        combined.push(p);
      }
    }
    return combined;
  }, [points, knownPoints]);

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

  const updateBubbleFromPointer = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const svg = compenSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = 100 / rect.width;
    let dx = (e.clientX - rect.left) * scale - 50;
    let dy = (e.clientY - rect.top) * scale - 50;

    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxR = 36;
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }

    const newSecX = Math.round(dx * 8);
    const newSecY = Math.round(-dy * 8);

    setCompenX(newSecX);
    setCompenY(newSecY);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setIsDraggingBubble(true);
    updateBubbleFromPointer(e);
  }, [updateBubbleFromPointer]);

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (isDraggingBubble) {
      updateBubbleFromPointer(e);
    }
  }, [isDraggingBubble, updateBubbleFromPointer]);

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    setIsDraggingBubble(false);
  }, []);

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
      const vals = [
        station.N,
        station.E,
        station.Z,
        station.PTO || 'EST-1',
        station.HI,
        stationAtm.CD,
        stationAtm.operador,
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
    } else if (screenState === 'JOB' || screenState === 'JOB_DETAILS') {
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
  }, [screenState, activeField, station, stationAtm, backsight, target, jobName, knownCoordsInput, newKnownPoint]);

  // Verificar si el campo actual admite texto alfanumérico
  const isCurrentFieldAlpha = useMemo(() => {
    if (screenState === 'JOB' || screenState === 'JOB_DETAILS') return true;
    if (screenState === 'OCC_LOAD_SEARCH') return true;
    if (screenState === 'OBS') return true; // Tanto PTO como Cd admiten alfanumérico
    if (screenState === 'KNOWN_NEW' && (activeField === 0 || activeField === 4)) return true; // PTO o CD de base
    if (screenState === 'KNOWN_INPUT' && activeField === 3) return true; // PTO de Datos Conocidos
    if (screenState === 'ERXYZ' && activeField === 3) return true; // PTO de E.RXYZ
    if (screenState === 'OCC_ORIEN' && (activeField === 3 || (activeField >= 5 && activeField <= 8))) return true; // PTO, Cd, Operador, Clima, Viento
    return false;
  }, [screenState, activeField]);

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
      else if (activeField === 7) setStationAtm(a => ({ ...a, clima: inputBuffer.trim() || 'DESPEJADO' }));
      else if (activeField === 8) setStationAtm(a => ({ ...a, viento: inputBuffer.trim() || 'Calma' }));
      else if (activeField === 9) setStationAtm(a => ({ ...a, temp: inputBuffer.trim() || '20°C' }));
      else if (activeField === 10) setStationAtm(a => ({ ...a, pres: inputBuffer.trim() || '760mmHg' }));
      else if (activeField === 11) setStationAtm(a => ({ ...a, ppm: inputBuffer.trim() || '11' }));
    } else if (screenState === 'ERXYZ') {
      if (activeField === 0 && !isNaN(val)) setBacksight(b => ({ ...b, N: val }));
      else if (activeField === 1 && !isNaN(val)) setBacksight(b => ({ ...b, E: val }));
      else if (activeField === 2 && !isNaN(val)) setBacksight(b => ({ ...b, Z: val }));
      else if (activeField === 3) setBacksight(b => ({ ...b, PTO: inputBuffer.trim() || 'BS-1' }));
    } else if (screenState === 'OBS') {
      if (activeField === 0) setTarget(t => ({ ...t, PTO: inputBuffer.trim() || '1' }));
      if (activeField === 1) setTarget(t => ({ ...t, CD: inputBuffer.trim() || 'PTO' }));
    } else if (screenState === 'JOB' || screenState === 'JOB_DETAILS') {
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

  // Disparo Láser y Levantamiento [AUTO]
  const ejecutarLevantamientoAuto = useCallback(() => {
    if (isMeasuring) return;
    setIsMeasuring(true);
    playBeep(2100, 0.05);

    // Asegurar buffer actual si el usuario estaba editando PTO o Cd
    const currentPTO = activeField === 0 ? (inputBuffer.trim() || target.PTO) : target.PTO;
    const currentCD = activeField === 1 ? (inputBuffer.trim() || target.CD) : target.CD;

    setTimeout(() => {
      // 1. Extraer valores del Panel de Reguladores Externos
      const HD_grados = envHD;
      const V_cenital_grados = envV;
      const SD_metros = envSD;

      // 2. Conversión a Radianes (Math.PI / 180)
      const V_rad = V_cenital_grados * (Math.PI / 180);

      // 3. Calcular Azimut Actual
      let Azimut = azimutInicial + HD_grados;
      Azimut = ((Azimut % 360) + 360) % 360;
      const Azimut_rad = Azimut * (Math.PI / 180);

      // 4. Distancia Horizontal y Desnivel
      const DH = SD_metros * Math.sin(V_rad);
      const DV = SD_metros * Math.cos(V_rad);

      // 5. Coordenadas Tridimensionales
      const Norte_Nuevo = station.N + (DH * Math.cos(Azimut_rad));
      const Este_Nuevo = station.E + (DH * Math.sin(Azimut_rad));
      const Cota_Nueva = station.Z + station.HI + DV - target.HR;

      // 6. Guardado en la memoria de la estación con PTO alfanumérico
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

      // Bip acústico láser
      playLaserBeep();

      // 7. Auto-incremento inteligente del PTO si termina en número
      const proxPTO = incrementPointId(currentPTO);
      setTarget(prev => ({
        ...prev,
        PTO: proxPTO,
        CD: currentCD
      }));

      if (activeField === 0) {
        setInputBuffer(proxPTO);
      }

      // Flash visual breve para confirmar disparo sin salir de la pantalla de Observación
      setObsShotFlash(true);
      setTimeout(() => setObsShotFlash(false), 350);

      setIsMeasuring(false);
    }, 350);
  }, [
    isMeasuring,
    activeField,
    inputBuffer,
    envHD,
    envV,
    envSD,
    azimutInicial,
    station,
    target,
    playBeep,
    playLaserBeep
  ]);

  // =========================================================================
  // 7. BOTONERA FÍSICA Y MÁQUINA DE ESTADOS TOPCON
  // =========================================================================

  // Tecla física [SFT]: Cicla entre Prisma, Tarjeta y Lectura Directa
  const handleShiftPress = useCallback(() => {
    playBeep(1200, 0.05);
    setEdmMode(prev => {
      const next = prev === 'prism' ? 'sheet' : prev === 'sheet' ? 'non_prism' : 'prism';
      setEdmReflector(next === 'prism' ? 'Prisma' : next === 'sheet' ? 'Diana' : 'N-Prisma');
      return next;
    });
    // Si está en un campo de texto, también despliega u oculta la ayuda alfanumérica
    if (isCurrentFieldAlpha) {
      setIsAlphaKeyboardOpen(k => !k);
    }
  }, [playBeep, isCurrentFieldAlpha]);

  // Tecla física [FUNC]: Alterna páginas de MED (Pág 1/2/3), Estacionamiento (Pág 1 / Pág 2) o Pantalla Principal (Pág 1 / Pág 2)
  const handleFuncPress = useCallback(() => {
    playBeep(1200, 0.05);
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

    // 4. Borrar TRABJ - Selección y confirmación con [ENT]
    // LÓGICA ESTRICTA: El slot NO se elimina de la lista de 10, sino que recicla su nombre original predeterminado (JOB01..JOB10) sin asterisco.
    if (screenState === 'JOB_DELETE_LIST' || screenState === 'JOB_DELETE_CONFIRM') {
      const target = jobsList[selectedJobIdx];
      if (target) {
        setJobDeleteTarget(target);
        const defaultSlotName = `JOB${String(selectedJobIdx + 1).padStart(2, '0')}`;
        setJobsList(prev => {
          const nextList = [...prev];
          nextList[selectedJobIdx] = defaultSlotName;
          return nextList;
        });
        if (jobName.replace(/^\*/, '') === target.replace(/^\*/, '')) {
          setJobName(defaultSlotName);
        }
        if (coordJobName.replace(/^\*/, '') === target.replace(/^\*/, '')) {
          setCoordJobName(defaultSlotName);
        }
        playLaserBeep();
        setLcdMessage(`${target}\nBORRADO`);
        setTimeout(() => {
          setLcdMessage(null);
          if (screenState === 'JOB_DELETE_CONFIRM') {
            setScreenState('JOB_DELETE_LIST');
          }
        }, 1200);
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
          setIsMeasuringFast(false);
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
          setIsMeasuringFast(true);
          setShowTaraSoftkey(true);
          setTimeout(() => {
            setIsMeasuringFast(false);
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

  // Soporte directo para teclado físico de PC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (isCurrentFieldAlpha && e.key.length === 1 && /^[a-zA-Z0-9_\-\s]$/.test(e.key)) {
        e.preventDefault();
        handleKeypadPress(e.key.toUpperCase());
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

  // Etiqueta del modo EDM en la barra superior
  const getEdmBadge = () => {
    if (edmMode === 'prism') return 'P1:PRISMA';
    if (edmMode === 'sheet') return 'SHT:DIANA';
    return 'NP:DIRECTA';
  };

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
    <div className="flex flex-col min-h-screen bg-neutral-950 text-slate-100 antialiased select-none font-sans justify-between">
      
      {/* BARRA SUPERIOR MINIMALISTA */}
      <header className="border-b border-neutral-800 bg-neutral-900/90 px-5 py-2.5 backdrop-blur flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-amber-500 text-neutral-950 font-black px-2.5 py-0.5 rounded text-xs tracking-wider shadow">
            TOPCON
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              Emulador Físico Topcon ES-105
              <span className="text-xs font-mono font-normal bg-neutral-800 text-amber-400 px-2 py-0.5 rounded border border-neutral-700">
                100% On-Board • Sin Interfaz Web
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowKeyboardHelp(k => !k)}
            className="p-1.5 rounded-lg border border-neutral-700 bg-neutral-800 text-slate-300 hover:text-white text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Ver controles"
          >
            <Keyboard size={14} className="text-amber-400" />
            <span className="hidden sm:inline">Guía de Teclas</span>
          </button>

          <button
            onClick={() => setSoundEnabled(s => !s)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              soundEnabled
                ? 'bg-neutral-800 border-neutral-700 text-amber-400'
                : 'bg-neutral-900 border-neutral-800 text-slate-500'
            }`}
            title="Audio de zumbador físico"
          >
            {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span className="hidden sm:inline">{soundEnabled ? 'Audio ON' : 'Audio OFF'}</span>
          </button>
        </div>
      </header>

      {/* MODAL GUÍA DE OPERACIÓN */}
      {showKeyboardHelp && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
                <Keyboard size={16} />
                Instrucciones de Operación en el Equipo
              </h3>
              <button onClick={() => setShowKeyboardHelp(false)} className="text-slate-400 hover:text-white text-sm cursor-pointer">
                ✕
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-300 leading-relaxed font-sans">
              <p>• <b>Arranque:</b> Al encender, el LCD muestra el Nivel Electrónico. Pulsa <b className="text-amber-400">[F1 OK]</b> para ingresar.</p>
              <p>• <b>Menú DATO y USB:</b> Pulsa <b className="text-rose-400">[ESC]</b> en la pantalla principal. Entra a <b className="text-amber-400">1. TRABAJO</b> para nombrar el proyecto o a <b className="text-emerald-400">3. EXPORTAR A USB</b> para descargar el CSV.</p>
              <p>• <b>Botón [SFT]:</b> Pulsa <b className="text-amber-400">[SFT]</b> para ciclar entre Prisma, Tarjeta y Lectura Directa.</p>
              <p>• <b>Botón [FUNC]:</b> Alterna las etiquetas F1-F4 entre Pág 1 y Pág 2.</p>
              <p>• <b>Levantamiento:</b> En Observación, pulsa el botón físico <b className="text-amber-400">[F3 AUTO]</b> para disparar y auto-incrementar el PTO.</p>
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
              
              {/* PANTALLA LCD RETROILUMINADA (Fondo exacto #9CA3AF) */}
              <div
                className={`relative w-full h-[230px] rounded-lg p-2.5 font-mono transition-colors duration-300 shadow-inner border-2 border-neutral-700 flex flex-col justify-between overflow-hidden min-w-0 ${
                  isBacklightOn ? 'bg-[#9CA3AF] text-neutral-950' : 'bg-[#7a8390] text-neutral-900'
                }`}
                style={{
                  backgroundImage: 'radial-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 0)',
                  backgroundSize: '4px 4px',
                }}
              >
                {/* MODAL / OVERLAY AJUSTES RÁPIDOS (BOTÓN FÍSICO DE ESTRELLA ★) */}
                {isStarMenuOpen && (
                  <div
                    onClick={() => setIsStarMenuOpen(false)}
                    className="absolute inset-0 bg-[#9CA3AF] text-neutral-950 z-40 p-2.5 flex flex-col justify-between font-mono select-none"
                  >
                    <div className="border-b border-neutral-800/40 pb-0.5 flex justify-between items-center text-xs font-bold">
                      <span>AJUSTES RÁPIDOS</span>
                      <span className="text-[11px]">★</span>
                    </div>
                    <div className="flex-1 py-2 flex flex-col justify-center space-y-2 text-xs">
                      <div className="flex justify-between items-center px-1">
                        <span>Compens.</span>
                        <span className="font-bold">X(H, V)</span>
                      </div>
                      <div className="flex justify-between items-center px-1">
                        <span>Contraste</span>
                        <span className="font-bold">5</span>
                      </div>
                      <div className="flex justify-between items-center px-1">
                        <span>Niv Retic</span>
                        <span className="font-bold">3</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-center border-t border-neutral-800/40 pt-1 font-bold">
                      Pulse &lt;ENT&gt; para salir (o ESC)
                    </div>
                  </div>
                )}

                {/* 1. BARRA SUPERIOR LCD (Compensador, Modo EDM ciclante por SFT, Batería) */}
                <div className="flex items-center justify-between border-b border-neutral-800/40 pb-1 text-[11px] font-bold tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <span className="bg-neutral-900 text-[#9CA3AF] px-1 py-0.2 rounded text-[10px]">
                      {screenState === 'TILT' || screenState === 'COMPEN'
                        ? 'TIL'
                        : screenState === 'ROOT'
                        ? 'ROOT'
                        : screenState === 'MED'
                        ? `P${medPage}`
                        : screenState === 'MAIN'
                        ? `P${mainPage}`
                        : screenState === 'OBS'
                        ? 'REC'
                        : screenState === 'OCC_ORIEN'
                        ? `P${occPage}`
                        : screenState === 'OCC_LOAD_LIST'
                        ? 'LIST'
                        : screenState === 'OCC_LOAD_SEARCH'
                        ? 'BUSC'
                        : screenState === 'OCC_ACLER'
                        ? 'ACLR'
                        : screenState === 'OCC_TRISEC'
                        ? 'TRIS'
                        : screenState === 'GRAPHIC_MENU'
                        ? 'MENU'
                        : screenState === 'REPLANTEO_MENU'
                        ? 'REPL'
                        : screenState === 'REPL_DATA'
                        ? 'DATA'
                        : screenState === 'TOPO_MENU'
                        ? 'TOPO'
                        : screenState === 'TOPO_NOTA'
                        ? 'NOTA'
                        : screenState === 'TOPO_VER'
                        ? 'VER'
                        : screenState === 'EDM_MENU'
                        ? 'EDM'
                        : screenState === 'DESPLZ_MENU'
                        ? 'OFFS'
                        : screenState === 'USB_MENU' || screenState === 'USB_TTYPE'
                        ? 'USB'
                        : 'MENU'}
                    </span>

                    {/* Modo EDM ciclado por botón físico SFT */}
                    <span
                      onClick={handleShiftPress}
                      className="cursor-pointer bg-neutral-800/20 hover:bg-neutral-800/30 px-1 rounded text-[10px]"
                      title="Pulsa SFT para cambiar de Prisma a Tarjeta o Directa"
                    >
                      [{getEdmBadge()}]
                    </span>

                    <span className="text-neutral-900 text-[10px]">
                      {isCurrentFieldAlpha ? '[ALP]' : '[NUM]'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isOriented && (
                      <span className="text-[9px] bg-neutral-800/25 px-1 rounded font-bold">
                        ORI:OK
                      </span>
                    )}
                    <span className="text-[9px] bg-neutral-800/20 px-1 rounded font-mono font-bold truncate max-w-[80px]" title={`Proyecto: ${jobName}`}>
                      {jobName}
                    </span>
                    {(() => {
                      const isMed = screenState === 'MED';
                      const pct = isMed ? (medPage === 1 ? '20%' : '70%') : '100%';
                      return (
                        <div className="flex items-center gap-1 font-bold text-neutral-950" title={`Batería ${pct}`}>
                          {isMed && medPage === 1 ? (
                            <BatteryLow size={13} className="stroke-[2.5]" />
                          ) : isMed ? (
                            <BatteryMedium size={13} className="stroke-[2.5]" />
                          ) : (
                            <Battery size={13} className="stroke-[2.5]" />
                          )}
                          <span className="text-[10px]">{pct}</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* 2. ÁREA CENTRAL DE PANTALLA LCD SEGÚN MÁQUINA DE ESTADOS */}
                <div className="flex-1 py-1 flex flex-col justify-center text-xs leading-relaxed min-w-0 overflow-hidden">
                  
                  {/* ALERTA TEMPORAL EN PANTALLA LCD */}
                  {lcdMessage ? (
                    <div className="bg-neutral-950 text-[#9CA3AF] p-2 rounded shadow border border-neutral-800 text-center font-bold whitespace-pre-line text-xs break-words overflow-hidden max-w-full">
                      {lcdMessage}
                    </div>
                  ) : isMeasuring ? (
                    <div className="text-center py-4 space-y-2">
                      <div className="text-sm font-black animate-pulse tracking-widest">
                        * MEDIANDO EDM *
                      </div>
                      <div className="text-[11px] font-mono text-neutral-800">
                        DISTANCIA & COORDENADAS...
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* ESTADO 'TILT': COMPENSADOR DIGITAL DE ARRANQUE */}
                      {screenState === 'TILT' && (
                        <div className="space-y-1 text-center font-mono">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 pb-0.5">
                            --- NIVEL ELECTRÓNICO (TILT) ---
                          </div>
                          
                          {/* Diana Gráfica de Burbuja Electrónica */}
                          <div className="flex items-center justify-center py-1">
                            <div className="relative w-24 h-12 border-2 border-neutral-800 rounded-full flex items-center justify-center bg-black/5">
                              <div className="absolute w-full h-[1px] bg-neutral-800/40"></div>
                              <div className="absolute h-full w-[1px] bg-neutral-800/40"></div>
                              <div className="w-5 h-5 rounded-full border border-neutral-900 flex items-center justify-center">
                                <div className="w-2.5 h-2.5 rounded-full bg-neutral-900 animate-ping"></div>
                              </div>
                            </div>
                          </div>

                          <div className="flex justify-around text-xs font-bold text-neutral-950">
                            <span>X : 0°00&apos;04&quot;</span>
                            <span>Y : -0°00&apos;02&quot;</span>
                          </div>
                          <div className="text-[10px] text-neutral-700 italic">
                            Compensador de doble eje calibrado. Pulse [F1 OK].
                          </div>
                        </div>
                      )}

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

                      {/* 2. ESTADO 'MED': PANTALLA DE MEDICIÓN CON PAGINACIÓN P1, P2, P3 */}
                      {screenState === 'MED' && (
                        <div className="flex flex-col justify-between h-full font-mono text-[13px] px-1 py-0.5">
                          {/* Cabecera: MED (arriba), srapido (parpadeando momentáneamente) y PPm (centro superior derecho) */}
                          <div className="flex justify-between items-center border-b border-neutral-800/30 pb-0.5">
                            <span className="text-[13px] tracking-wider text-neutral-950 font-black">MED</span>
                            <div className="flex items-center gap-2">
                              {isMeasuringFast && (
                                <span className="animate-pulse text-[11px] font-black text-neutral-950 tracking-wider">
                                  srapido
                                </span>
                              )}
                              <span className="text-[11px] font-bold text-neutral-800">PPm</span>
                              <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 rounded font-bold">
                                P{medPage}
                              </span>
                            </div>
                          </div>

                          {/* Contenido principal alineado a la izquierda con espaciado en blanco a la derecha */}
                          <div className="space-y-2 py-1.5 text-left font-bold text-neutral-950">
                            <div>HD</div>
                            <div className="tracking-tight text-neutral-900">AZ Rango exced.</div>
                            <div>HA-D</div>
                          </div>

                          {/* Pie informativo sutil */}
                          <div className="text-[9.5px] text-neutral-700 flex justify-between font-mono pt-0.5 border-t border-neutral-800/20">
                            <span>Pág {medPage}/3 (FUNC)</span>
                            <span>ESC = ROOT</span>
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'COMPEN': PANTALLA AZ-0 SIMULADOR DEL MUNDO FÍSICO (ComPen) */}
                      {screenState === 'COMPEN' && (() => {
                        const xDisplay = Math.abs(compenX) > 210 ? '* * * *' : formatTiltDMS(compenX);
                        const yDisplay = Math.abs(compenY) > 210 ? '* * * *' : formatTiltDMS(compenY);

                        return (
                          <div className="flex flex-col justify-between h-full font-mono text-xs select-none">
                            {/* Cabecera superior izquierda: ComPen */}
                            <div className="flex justify-between items-center border-b border-neutral-800/30 pb-0.5 px-0.5">
                              <span className="font-black text-sm text-neutral-950 tracking-wider">ComPen</span>
                              <span className="text-[10px] text-neutral-800 font-bold">Nivel Electrónico</span>
                            </div>

                            {/* Cuerpo principal en 2 columnas: Datos textuales a la izquierda, Gráfico interactivo a la derecha */}
                            <div className="flex items-center justify-between gap-2 px-1 flex-1 py-1">
                              {/* Columna Izquierda: Datos textuales */}
                              <div className="flex flex-col justify-center space-y-3 pl-1 text-[13px] font-bold text-neutral-950 leading-tight">
                                <div className="flex items-center gap-3">
                                  <span className="font-black text-neutral-900 w-3">X</span>
                                  <span className="font-mono tracking-wider">{xDisplay}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-black text-neutral-900 w-3">Y</span>
                                  <span className="font-mono tracking-wider">{yDisplay}</span>
                                </div>
                              </div>

                              {/* Columna Derecha: Gráfico con dos círculos concéntricos cruzados por ejes X e Y, y burbuja negra arrastrable */}
                              <div className="flex flex-col items-center justify-center pr-2">
                                <div className="relative p-1">
                                  <svg
                                    ref={compenSvgRef}
                                    viewBox="0 0 100 100"
                                    className="w-24 h-24 touch-none cursor-grab active:cursor-grabbing select-none"
                                    onPointerDown={handlePointerDown}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUp}
                                    onPointerCancel={handlePointerUp}
                                  >
                                    {/* Fondo del sensor */}
                                    <circle cx="50" cy="50" r="44" fill="#000000" fillOpacity="0.04" />

                                    {/* Eje X (horizontal) */}
                                    <line x1="8" y1="50" x2="92" y2="50" stroke="#171717" strokeWidth="1" strokeDasharray="3 3" />
                                    {/* Eje Y (vertical) */}
                                    <line x1="50" y1="8" x2="50" y2="92" stroke="#171717" strokeWidth="1" strokeDasharray="3 3" />

                                    {/* Círculo concéntrico exterior */}
                                    <circle
                                      cx="50"
                                      cy="50"
                                      r="38"
                                      fill="none"
                                      stroke="#171717"
                                      strokeWidth="1.8"
                                    />

                                    {/* Círculo concéntrico interior */}
                                    <circle
                                      cx="50"
                                      cy="50"
                                      r="18"
                                      fill="none"
                                      stroke="#171717"
                                      strokeWidth="1.2"
                                    />

                                    {/* Punto central de calibración */}
                                    <circle cx="50" cy="50" r="1.5" fill="#171717" />

                                    {/* Punto negro (burbuja) arrastrable con el ratón */}
                                    <circle
                                      cx={bubblePos.x}
                                      cy={bubblePos.y}
                                      r="6"
                                      fill="#0a0a0a"
                                      className="drop-shadow-sm transition-transform duration-75"
                                    />
                                  </svg>
                                </div>
                                <span className="text-[9px] text-neutral-700 font-sans font-medium">
                                  Arrastra la burbuja
                                </span>
                              </div>
                            </div>

                            {/* Pie informativo */}
                            <div className="text-[9.5px] text-neutral-700 flex justify-between font-mono pt-0.5 border-t border-neutral-800/20 px-0.5">
                              <span>F1=[OK] Guardar</span>
                              <span>[ESC] Volver</span>
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

                      {/* ESTADO 'DATO_MENU': MENÚ DATO (1. TRABAJO, 2. DATOS CONOCIDOS) */}
                      {screenState === 'DATO_MENU' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide">
                            --- MENÚ DATO ---
                          </div>
                          {[
                            { id: 1, label: '1. TRABAJO' },
                            { id: 2, label: '2. DATOS CONOCIDOS' }
                          ].map(item => (
                            <div
                              key={item.id}
                              onClick={() => {
                                setMenuSelection(item.id);
                                if (item.id === 1) { setScreenState('JOB_MENU'); setJobMenuSelection(1); }
                                else if (item.id === 2) { setScreenState('KNOWN_MENU'); setKnownMenuSelection(1); }
                              }}
                              className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between ${
                                menuSelection === item.id ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                              }`}
                            >
                              <span>{item.label}</span>
                              {menuSelection === item.id && <span>[ENT]</span>}
                            </div>
                          ))}
                          <div className="text-[10px] text-neutral-700 text-center pt-1 font-sans">
                            Seleccione opción y pulse [ENT]
                          </div>
                        </div>
                      )}

                      {/* 1. SUBMENÚ TRABJ (5 OPCIONES ESTRICTAS) */}
                      {screenState === 'JOB_MENU' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 pb-0.5 uppercase tracking-wide flex justify-between items-center text-[11px] font-mono">
                            <span>--- TRABJ ---</span>
                            <span className="text-[10px] text-neutral-800 font-bold">[{jobMenuSelection}/5]</span>
                          </div>
                          {[
                            { id: 1, label: '1. Selec TRABJ' },
                            { id: 2, label: '2. Detalles de TRABJ' },
                            { id: 3, label: '3. Borrar TRABJ' },
                            { id: 4, label: '4. Salida Comunic.' },
                            { id: 5, label: '5. Config.Comunic.' }
                          ].map(item => (
                            <div
                              key={item.id}
                              onClick={() => {
                                setJobMenuSelection(item.id);
                                if (item.id === 1) setScreenState('JOB_SELECT');
                                else if (item.id === 2) { setScreenState('JOB_DETAILS'); setInputBuffer(jobName.replace(/^\*/, '')); }
                                else if (item.id === 3) { setScreenState('JOB_DELETE_LIST'); setSelectedJobIdx(0); }
                                else if (item.id === 4) setLcdMessage('SALIDA COMUNIC:\nENVIANDO DATOS RS-232C');
                                else if (item.id === 5) setLcdMessage('CONFIG. COMUNIC:\nBAUD: 1200\nPARIDAD: NONE');
                              }}
                              className={`px-1.5 py-0.5 rounded cursor-pointer flex items-center justify-between text-[11px] font-mono min-w-0 ${
                                jobMenuSelection === item.id ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10 text-neutral-900 font-semibold'
                              }`}
                            >
                              <span className="truncate">{item.label}</span>
                              {jobMenuSelection === item.id && <span className="text-[10px] font-mono shrink-0">[ENT]</span>}
                            </div>
                          ))}
                          <div className="text-[9.5px] text-neutral-800 text-center pt-0.5 font-mono font-medium">
                            ▲ ▼ Seleccionar - [ENT] Entrar
                          </div>
                        </div>
                      )}

                      {/* 2. ESTADO 'JOB_SELECT': SELECCIONAR TRABJ (DOS LÍNEAS) */}
                      {screenState === 'JOB_SELECT' && (
                        <div className="space-y-1.5 font-mono text-xs px-1">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide text-[11px] font-mono">
                            --- SELEC TRABJ ---
                          </div>
                          <div className="space-y-1 pt-0.5">
                            <div
                              onClick={() => setJobSelectField(0)}
                              className={`p-1.5 rounded cursor-pointer flex items-center justify-between border min-w-0 font-mono text-xs ${
                                jobSelectField === 0
                                  ? 'bg-neutral-900 text-[#9CA3AF] border-neutral-800 font-black'
                                  : 'bg-black/5 border-transparent text-neutral-950 font-bold'
                              }`}
                            >
                              <span className="shrink-0">Selec TRABJ:</span>
                              <span className="font-mono truncate max-w-[60%] overflow-hidden text-right">
                                {jobsList.find(j => j.replace(/^\*/, '') === jobName.replace(/^\*/, '')) || (jobName.startsWith('JOB') ? jobName : `*${jobName}`)}
                              </span>
                            </div>
                            <div
                              onClick={() => setJobSelectField(1)}
                              className={`p-1.5 rounded cursor-pointer flex items-center justify-between border min-w-0 font-mono text-xs ${
                                jobSelectField === 1
                                  ? 'bg-neutral-900 text-[#9CA3AF] border-neutral-800 font-black'
                                  : 'bg-black/5 border-transparent text-neutral-950 font-bold'
                              }`}
                            >
                              <span className="shrink-0">Busca Coord TRABJ:</span>
                              <span className="font-mono truncate max-w-[50%] overflow-hidden text-right">
                                {jobsList.find(j => j.replace(/^\*/, '') === coordJobName.replace(/^\*/, '')) || (coordJobName.startsWith('JOB') ? coordJobName : `*${coordJobName}`)}
                              </span>
                            </div>
                          </div>
                          <div className="text-[10px] text-neutral-800 text-center pt-1 font-mono font-bold">
                            Presione [F1 LIST] para ver lista de trabajos
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
                                        ? 'bg-neutral-900 text-[#9CA3AF] font-black'
                                        : 'hover:bg-black/10 text-neutral-900 font-semibold'
                                    }`}
                                  >
                                    <span className="truncate max-w-[80%] overflow-hidden">{job}</span>
                                    {isSelected && <span className="text-[10px] font-mono shrink-0">[ENT]</span>}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9.5px] text-neutral-800 text-center pt-0.5 font-mono truncate">
                              * No exportado a USB - [ENT] Seleccionar
                            </div>
                          </div>
                        );
                      })()}

                      {/* 3. ESTADO 'JOB_DETAILS': DETALLES DE TRABJ CON ESCAL: 1.00000000 */}
                      {screenState === 'JOB_DETAILS' && (
                        <div className="space-y-1 font-mono text-xs px-1">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>DETALLES DE TRABJ</span>
                            <span className="text-[10px] font-black">F4=[OK]</span>
                          </div>
                          <div className="bg-neutral-900 text-[#9CA3AF] px-2 py-1.5 rounded flex justify-between items-center font-bold text-xs min-w-0">
                            <span className="shrink-0">TRAB:</span>
                            <span className="font-mono truncate max-w-[65%] overflow-hidden text-right">{inputBuffer}_</span>
                          </div>
                          <div className="bg-black/5 px-2 py-1.5 rounded border border-neutral-800/20 text-neutral-950 font-bold flex justify-between items-center">
                            <span>ESCAL:</span>
                            <span className="font-mono font-black text-xs">1.00000000</span>
                          </div>
                          <div className="text-[10px] text-neutral-700 flex justify-between pt-0.5 font-sans font-bold">
                            <span>PUNTOS: {points.length}</span>
                            <span>F4 = [OK]</span>
                          </div>
                        </div>
                      )}

                      {/* 4. ESTADO 'JOB_DELETE_LIST': SELECCIONAR TRABAJO PARA BORRAR */}
                      {screenState === 'JOB_DELETE_LIST' && (() => {
                        const currentPage = Math.floor(selectedJobIdx / 5);
                        const visibleJobs = jobsList.slice(currentPage * 5, (currentPage + 1) * 5);
                        return (
                          <div className="space-y-1 font-mono text-xs px-1">
                            <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5 font-mono text-rose-950">
                              <span>BORRAR TRABJ</span>
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
                                        ? 'bg-neutral-900 text-[#9CA3AF] font-black'
                                        : 'hover:bg-black/10 text-neutral-900 font-semibold'
                                    }`}
                                  >
                                    <span className="truncate max-w-[80%] overflow-hidden">{job}</span>
                                    {isSelected && <span className="text-[10px] font-mono shrink-0">[ENT]</span>}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9.5px] text-neutral-800 text-center pt-0.5 font-mono truncate">
                              Seleccione trabajo y pulse [ENT] para confirmar
                            </div>
                          </div>
                        );
                      })()}

                      {/* 4. ESTADO 'JOB_DELETE_CONFIRM': AVISO DE CONFIRMACIÓN CON [NO] Y [SI] */}
                      {screenState === 'JOB_DELETE_CONFIRM' && (
                        <div className="space-y-2 font-mono text-xs px-1 py-3 text-center">
                          <div className="font-bold text-xs text-neutral-950 uppercase border-b border-neutral-800/30 pb-1">
                            CONFIRMAR BORRADO
                          </div>
                          <div className="bg-neutral-900 text-[#9CA3AF] p-2.5 rounded font-black text-xs shadow-inner truncate max-w-full overflow-hidden">
                            {jobDeleteTarget} borrado Confir ?
                          </div>
                          <div className="text-[10px] text-neutral-800 font-bold font-sans pt-1">
                            F3: [NO] • F4: [SI]
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
                          <div className="bg-neutral-900 text-[#9CA3AF] px-2 py-1 rounded flex justify-between items-center font-bold min-w-0">
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
                      {screenState === 'KNOWN_MENU' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center text-[11px]">
                            <span>DATOS CONOCIDOS</span>
                            <span className="text-[10px] text-neutral-800 font-bold">[{knownMenuSelection}/3]</span>
                          </div>
                          {[
                            { id: 1, label: '1. Entrada Coords' },
                            { id: 2, label: '2. Borrar' },
                            { id: 3, label: '3. Ver' }
                          ].map(item => (
                            <div
                              key={item.id}
                              onClick={() => {
                                setKnownMenuSelection(item.id);
                                if (item.id === 1) {
                                  setScreenState('KNOWN_INPUT');
                                  setActiveField(0);
                                  setInputBuffer(knownCoordsInput.Y);
                                } else if (item.id === 2) {
                                  setScreenState('KNOWN_DEL');
                                  setSelectedKnownIdx(0);
                                } else if (item.id === 3) {
                                  setScreenState('KNOWN_VIEW');
                                  setViewKnownIdx(0);
                                }
                              }}
                              className={`px-1.5 py-1 rounded cursor-pointer flex items-center justify-between text-[11px] ${
                                knownMenuSelection === item.id ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                              }`}
                            >
                              <span>{item.label}</span>
                              {knownMenuSelection === item.id && <span>[ENT]</span>}
                            </div>
                          ))}
                          <div className="text-[10px] text-neutral-700 text-center pt-1 font-sans">
                            Seleccione opción y pulse [ENT]
                          </div>
                        </div>
                      )}

                      {/* 3. INTERFAZ DE ENTRADA COORDS (FORMULARIO ESTRICTO Y, X, Z, PTO) */}
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
                                  isCur ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
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
                                <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 rounded shrink-0 truncate max-w-[30%]">
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
                                <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 rounded shrink-0 truncate max-w-[30%]">
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
                                <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 rounded shrink-0 truncate max-w-[30%]">
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
                                  isCur ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
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
                                <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 rounded shrink-0 truncate max-w-[30%]">
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
                                        isSel ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
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
                                  if (item.id === 1) {
                                    setScreenState('OCC_ORIEN');
                                    setActiveField(0);
                                    setOccPage(1);
                                  } else if (item.id === 2) {
                                    setScreenState('REPL_DATA');
                                    setReplDisplayMode('COORD');
                                  } else if (item.id === 3) {
                                    setScreenState('OBS');
                                    setActiveField(0);
                                  } else if (item.id === 4) {
                                    handleShiftPress();
                                  }
                                }}
                                className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between text-[11px] ${
                                  isSel ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                {isSel && <span className="text-[10px]">[ENT]</span>}
                              </div>
                            );
                          })}
                          <div className="text-[10px] text-neutral-700 text-center pt-1 font-sans">
                            ▲ ▼ Seleccionar - [ENT] Entrar
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'REPL_DATA': DATOS DE REPLANT. */}
                      {screenState === 'REPL_DATA' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                            <span>DATOS DE REPLANT.</span>
                            <span className="text-[10px] font-bold">[{replDisplayMode}]</span>
                          </div>

                          <div className="space-y-1 bg-black/5 p-2 rounded">
                            {replDisplayMode === 'COORD' ? (
                              <>
                                <div className="font-bold text-neutral-900 text-xs border-b border-neutral-800/10 pb-0.5">
                                  P Coord
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="font-bold">XP:</span>
                                  <span className="font-mono font-bold">9095533.595</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="font-bold">ZP:</span>
                                  <span className="font-mono font-bold">4008.540</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="font-bold">HD</span>
                                  <span className="font-mono font-bold">0.000m</span>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="flex justify-between items-center text-xs border-b border-neutral-800/10 pb-0.5">
                                  <span className="font-bold">DistG</span>
                                  <span className="font-mono font-bold">0.000m</span>
                                </div>
                                <div className="flex justify-between items-center text-xs py-0.5">
                                  <span className="font-bold">Ang H:</span>
                                  <span className="font-mono font-bold">113° 45' 58"</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="font-bold">HD</span>
                                  <span className="font-mono font-bold">0.000m</span>
                                </div>
                              </>
                            )}
                          </div>

                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            F2=[DISP] Alternar • F4=[OK] Ir a ComPen
                          </div>
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
                                  if (item.id === 1) {
                                    setScreenState('OBS');
                                    setActiveField(0);
                                  } else if (item.id === 2) {
                                    setScreenState('TOPO_NOTA');
                                  } else if (item.id === 3) {
                                    setScreenState('TOPO_VER');
                                    setTopoVerPage(1);
                                  } else if (item.id === 4) {
                                    setLcdMessage('BORRAR TOPO:\nSIN REGISTROS');
                                  }
                                }}
                                className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between text-[11px] ${
                                  isSel ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                {isSel && <span className="text-[10px]">[ENT]</span>}
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

                      {/* ESTADO 'TOPO_VER': VER DATOS TOPO */}
                      {screenState === 'TOPO_VER' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                            <span>DATOS TOPO</span>
                            <span className="text-[10px] font-bold">[{topoVerPage === 1 ? 'P-1' : 'P-2'}]</span>
                          </div>
                          <div className="space-y-0.5 bg-black/5 p-1.5 rounded">
                            {topoVerPage === 1 ? (
                              <>
                                <div className="flex justify-between items-center text-xs py-0.5">
                                  <span className="font-bold">PTO</span>
                                  <span className="font-mono font-bold">165</span>
                                </div>
                                <div className="flex justify-between items-center text-xs py-0.5">
                                  <span className="font-bold">Ref.</span>
                                  <span className="font-mono font-bold">165</span>
                                </div>
                                <div className="flex justify-between items-center text-xs py-0.5">
                                  <span className="font-bold">Crd</span>
                                  <span className="font-mono font-bold">3</span>
                                </div>
                                <div className="flex justify-between items-center text-xs py-0.5">
                                  <span className="font-bold">Crd</span>
                                  <span className="font-mono font-bold">4</span>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="flex justify-between items-center text-[11px] py-0.5">
                                  <span className="font-bold">Y :</span>
                                  <span className="font-mono">9095533.595 m</span>
                                </div>
                                <div className="flex justify-between items-center text-[11px] py-0.5">
                                  <span className="font-bold">X :</span>
                                  <span className="font-mono">4008.540 m</span>
                                </div>
                                <div className="flex justify-between items-center text-[11px] py-0.5">
                                  <span className="font-bold">Z :</span>
                                  <span className="font-mono">102.350 m</span>
                                </div>
                                <div className="flex justify-between items-center text-[11px] py-0.5">
                                  <span className="font-bold">Cd:</span>
                                  <span className="font-mono font-bold">LEVC</span>
                                </div>
                              </>
                            )}
                          </div>
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            F1=[P-1/2] • F2=[1RO] • F3=[ULTIM] • F4=[BUSC]
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'COORD_MENU': MENÚ COORD (1. Occ.Orien, 2. Observación) */}
                      {screenState === 'COORD_MENU' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide">
                            --- COORDENADAS ---
                          </div>
                          <div
                            onClick={() => { setMenuSelection(1); setScreenState('OCC_ORIEN'); setActiveField(0); }}
                            className={`px-2 py-1 rounded cursor-pointer flex items-center justify-between ${
                              menuSelection === 1 ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                            }`}
                          >
                            <span>1. Occ.Orien.</span>
                            {menuSelection === 1 && <span>[ENT]</span>}
                          </div>
                          <div
                            onClick={() => { setMenuSelection(2); setScreenState('OBS'); setActiveField(0); }}
                            className={`px-2 py-1 rounded cursor-pointer flex items-center justify-between ${
                              menuSelection === 2 ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                            }`}
                          >
                            <span>2. Observación</span>
                            {menuSelection === 2 && <span>[ENT]</span>}
                          </div>
                          <div className="text-[10px] text-neutral-700 text-center pt-1 font-sans">
                            Pulse 1 o 2 y luego [ENT]
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'OCC_ORIEN': ESTACIONAMIENTO (Y0, X0, Z0, PTO 1, HI) */}
                      {screenState === 'OCC_ORIEN' && (() => {
                        const stationItems = [
                          {
                            label: 'Y0',
                            fieldIdx: 0,
                            display: activeField === 0
                              ? `${inputBuffer !== '' ? inputBuffer : (station.N === 1000 ? '1000' : station.N.toFixed(3))}_`
                              : `${station.N.toFixed(3)} m`
                          },
                          {
                            label: 'X0',
                            fieldIdx: 1,
                            display: activeField === 1
                              ? `${inputBuffer !== '' ? inputBuffer : (station.E === 1000 ? '1000' : station.E.toFixed(3))}_`
                              : `${station.E.toFixed(3)} m`
                          },
                          {
                            label: 'Z0',
                            fieldIdx: 2,
                            display: activeField === 2
                              ? `${inputBuffer !== '' ? inputBuffer : (station.Z === 100 ? '100' : station.Z.toFixed(3))}_`
                              : `${station.Z.toFixed(3)} m`
                          },
                          {
                            label: 'PTO',
                            fieldIdx: 3,
                            display: activeField === 3
                              ? `${inputBuffer !== '' ? inputBuffer : (station.PTO || 'PTO 1')}_`
                              : (station.PTO || 'PTO 1')
                          },
                          {
                            label: 'HI',
                            fieldIdx: 4,
                            display: activeField === 4
                              ? `${inputBuffer !== '' ? inputBuffer : station.HI.toFixed(3)}_`
                              : `${station.HI.toFixed(3)} m`
                          }
                        ];

                        return (
                          <div className="space-y-0.5 font-mono text-xs">
                            <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                              <span>ESTACIONAMIENTO</span>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-bold">*[1/12]</span>
                              </div>
                            </div>
                            <div className="space-y-0.5 py-0.5">
                              {stationItems.map(item => {
                                const isCur = activeField === item.fieldIdx;
                                return (
                                  <div
                                    key={item.label}
                                    onClick={() => {
                                      commitCurrentField();
                                      setActiveField(item.fieldIdx);
                                    }}
                                    className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer min-w-0 ${
                                      isCur ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                    }`}
                                  >
                                    <span className="shrink-0">{item.label}:</span>
                                    <span className="truncate max-w-[65%] overflow-hidden text-right font-mono">
                                      {item.display}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                              F1=[CARG] • F2=[ACLE.R] • F3=[E.RXYZ] • F4=[TRISEC]
                            </div>
                          </div>
                        );
                      })()}

                      {/* ESTADO 'OCC_LOAD_LIST': LISTA DE PUNTOS CARGADOS (PTO 1, PTO 2) */}
                      {screenState === 'OCC_LOAD_LIST' && (() => {
                        const startIdx = Math.max(0, Math.min(selectedOccLoadIdx - 1, occLoadPoints.length - 4));
                        const visiblePoints = occLoadPoints.slice(startIdx, startIdx + 4);

                        return (
                          <div className="space-y-0.5 font-mono text-xs">
                            <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                              <span>LISTA PUNTOS</span>
                              <span className="text-[10px] font-bold">[{selectedOccLoadIdx + 1}/{occLoadPoints.length}]</span>
                            </div>
                            <div className="space-y-0.5 py-0.5">
                              {visiblePoints.map((pt, localIdx) => {
                                const realIdx = startIdx + localIdx;
                                const isSel = selectedOccLoadIdx === realIdx;
                                return (
                                  <div
                                    key={pt.PTO + realIdx}
                                    onClick={() => {
                                      setSelectedOccLoadIdx(realIdx);
                                      cargarPuntoSeleccionado();
                                    }}
                                    className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer min-w-0 ${
                                      isSel ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                    }`}
                                  >
                                    <span className="font-bold truncate max-w-[50%]">{pt.PTO}</span>
                                    <span className="text-[10px] truncate max-w-[50%] font-mono text-neutral-800">
                                      Y:{pt.N.toFixed(1)} X:{pt.E.toFixed(1)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                              ▲ ▼ Seleccionar • [ENT] Cargar • F3=[BUSC]
                            </div>
                          </div>
                        );
                      })()}

                      {/* ESTADO 'OCC_LOAD_SEARCH': BUSCAR PUNTO (Criteria:Completo, Direct.: _) */}
                      {screenState === 'OCC_LOAD_SEARCH' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                            <span>BUSCAR PTO</span>
                            <span className="text-[10px] font-bold">[CRIT]</span>
                          </div>
                          <div className="space-y-1 bg-black/5 p-1.5 rounded">
                            <div className="text-xs">
                              <span className="text-neutral-700">Criteria:</span>
                              <span className="font-bold ml-1 text-neutral-900">Completo</span>
                            </div>
                            <div className="flex items-center text-xs">
                              <span className="shrink-0 text-neutral-700">Direct.:</span>
                              <span className="font-bold font-mono ml-1 truncate max-w-[70%] bg-black/10 px-1 py-0.5 rounded">
                                {occSearchBuffer}_
                              </span>
                            </div>
                          </div>
                          <div className="text-[9px] text-neutral-700 text-center pt-1 font-sans">
                            Escriba PTO • F4=[OK] Buscar • [ESC] Volver
                          </div>
                        </div>
                      )}

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
                              AZ Rango exced.
                            </div>
                            <div className="text-left font-mono py-0.5 border-b border-neutral-800/10">
                              HA-D
                            </div>
                            <div className="flex items-center gap-2 text-left font-mono py-0.5">
                              <span className="shrink-0">HA-D</span>
                              <span className="inline-flex items-center bg-neutral-900 text-[#9CA3AF] px-2 py-0.5 min-w-[70px] h-[18px] rounded-sm shadow-inner font-mono text-[11px] font-bold">
                                {inputBuffer !== '' ? `${inputBuffer}_` : <span className="inline-block w-1.5 h-3 bg-[#9CA3AF]/80 animate-pulse" />}
                              </span>
                            </div>
                          </div>
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            F1=[REG] • F4=[OK]
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'OCC_TRISEC': MENÚ TRISECCIÓN */}
                      {screenState === 'OCC_TRISEC' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center">
                            <span>--- TRISECCIÓN ---</span>
                            <span className="text-[10px] font-bold">[{trisecSelection}/4]</span>
                          </div>
                          {[
                            { id: 1, label: '1. A' },
                            { id: 2, label: '2. YXZ' },
                            { id: 3, label: '3. Cota' },
                            { id: 4, label: '4. Ajustes' }
                          ].map(item => {
                            const isSel = trisecSelection === item.id;
                            return (
                              <div
                                key={item.id}
                                onClick={() => {
                                  setTrisecSelection(item.id);
                                  if (item.id === 2) {
                                    setScreenState('COMPEN');
                                  } else {
                                    setLcdMessage('TRISEC SELECCIONADA');
                                  }
                                }}
                                className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between ${
                                  isSel ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                {isSel && <span>[ENT]</span>}
                              </div>
                            );
                          })}
                          <div className="text-[10px] text-neutral-700 text-center pt-0.5 font-sans">
                            ▲ ▼ Seleccionar - [ENT] Entrar
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'ERXYZ': ORIENTAR PUNTO ATRÁS (Yref, Xref, Zref, PTO) */}
                      {screenState === 'ERXYZ' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>ORIENTAR (P. ATRÁS)</span>
                            <span className="text-[10px] font-black">F1=[CARG] • F4=[OK]</span>
                          </div>
                          {[
                            { label: 'Yref', val: backsight.N },
                            { label: 'Xref', val: backsight.E },
                            { label: 'Zref', val: backsight.Z },
                            { label: 'PTO', val: backsight.PTO || 'BS-1' }
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
                                  isCur ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span className="shrink-0">{item.label}:</span>
                                <span className="truncate max-w-[65%] overflow-hidden text-right font-mono">
                                  {isCur
                                    ? `${inputBuffer}_`
                                    : idx === 3
                                    ? String(item.val)
                                    : `${Number(item.val).toFixed(3)} m`}
                                </span>
                              </div>
                            );
                          })}
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            [F1] CARG Base • [F4] OK (Comprobar Orientación)
                          </div>
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

                      {/* ESTADO 'EDM_MENU': MENÚ CONFIGURACIÓN EDM */}
                      {screenState === 'EDM_MENU' && (
                        <div className="space-y-1 font-mono text-xs px-1">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                            <span>--- EDM ---</span>
                          </div>
                          <div className="space-y-1 bg-black/5 p-1.5 rounded">
                            <div className="flex justify-between items-center text-xs">
                              <span>Modo</span>
                              <span>: <span className="bg-neutral-900 text-[#9CA3AF] px-1 py-0.2 font-bold">Srapido</span></span>
                            </div>
                            <div
                              onClick={cycleEdmReflector}
                              className="flex justify-between items-center text-xs cursor-pointer hover:bg-black/10 px-0.5 rounded"
                              title="Clic o [ENT] para alternar reflector"
                            >
                              <span>Reflector</span>
                              <span>: <span className="font-bold underline decoration-dotted">{edmReflector}</span></span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span>cp</span>
                              <span className="font-mono">: 0</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span>Mant.Illum</span>
                              <span className="font-mono">: Laser</span>
                            </div>
                          </div>
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            [ENT] / Clic: Cambiar Reflector • [ESC]: Volver
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'DESPLZ_MENU': MENÚ DESPLAZAMIENTO */}
                      {screenState === 'DESPLZ_MENU' && (
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
                                  isSel ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                {isSel && <span className="text-[10px]">[ENT]</span>}
                              </div>
                            );
                          })}
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            ▲ / ▼: Seleccionar • [ENT]: Entrar
                          </div>
                        </div>
                      )}

                      {/* 3. ESTADO 'USB_MENU': MENÚ USB PANTALLA 1 (TIPO T / TIPO S) */}
                      {screenState === 'USB_MENU' && (
                        <div className="space-y-1 font-mono text-xs px-1">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center text-[11px]">
                            <span>--- MENÚ USB ---</span>
                            <span className="text-[10px] text-neutral-800 font-bold">[{usbMenuSelection}/2]</span>
                          </div>
                          <div className="space-y-1 pt-1">
                            {[
                              { id: 1, label: '1. Tipo T' },
                              { id: 2, label: '2. Tipo S' }
                            ].map(item => {
                              const isSel = usbMenuSelection === item.id;
                              return (
                                <div
                                  key={item.id}
                                  onClick={() => {
                                    setUsbMenuSelection(item.id);
                                    setUsbTypeMode(item.id === 1 ? 'T' : 'S');
                                    setScreenState('USB_TTYPE');
                                    setUsbTTypeSelection(1);
                                  }}
                                  className={`px-2 py-1 rounded cursor-pointer flex items-center justify-between text-xs ${
                                    isSel ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                  }`}
                                >
                                  <span>{item.label}</span>
                                  {isSel && <span className="text-[10px]">[ENT]</span>}
                                </div>
                              );
                            })}
                          </div>
                          <div className="text-[10px] text-neutral-800 text-center pt-2 font-mono">
                            ▲ ▼ Seleccionar - [ENT] Entrar
                          </div>
                        </div>
                      )}

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
                                  isSel ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}</span>
                                {isSel && <span className="text-[10px]">[ENT]</span>}
                              </div>
                            );
                          })}
                          <div className="text-[10px] text-neutral-800 text-center pt-1 font-mono">
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
                                        ? 'bg-neutral-900 text-[#9CA3AF] font-black'
                                        : 'hover:bg-black/10 text-neutral-900 font-semibold'
                                    }`}
                                  >
                                    <span className="truncate max-w-[80%] overflow-hidden">{job}</span>
                                    {isSelected && <span className="text-[10px] font-mono shrink-0">[ENT]</span>}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9.5px] text-neutral-800 text-center pt-0.5 font-mono truncate">
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
                                usbFormatSelection === item.id ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                              }`}
                            >
                              <span>{item.label}</span>
                              {usbFormatSelection === item.id && <span className="text-[10px]">[ENT]</span>}
                            </div>
                          ))}
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            Baje a 4. SSS(Coord) y pulse [ENT] para descargar CSV
                          </div>
                        </div>
                      )}

                      {/* 1. ESTADO 'OBS': OBSERVACIÓN (Y, X, Z ARRIBA, HD EN MEDIO, PTO ABAJO, CD CON FLECHA ABAJO) */}
                      {screenState === 'OBS' && (() => {
                        const radV = envV * (Math.PI / 180);
                        let liveAz = azimutInicial + envHD;
                        liveAz = ((liveAz % 360) + 360) % 360;
                        const liveAzRad = liveAz * (Math.PI / 180);
                        const liveDH = envSD * Math.sin(radV);
                        const liveDV = envSD * Math.cos(radV);
                        const liveY = station.N + (liveDH * Math.cos(liveAzRad));
                        const liveX = station.E + (liveDH * Math.sin(liveAzRad));
                        const liveZ = station.Z + station.HI + liveDV - target.HR;

                        return (
                          <div className="space-y-1 font-mono text-xs px-0.5">
                            {/* Barra de cabecera con indicación REC / flash */}
                            <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between items-center pb-0.5">
                              <span className="flex items-center gap-1.5 font-black text-neutral-950">
                                <span>OBSERVACIÓN</span>
                                {obsShotFlash && (
                                  <span className="bg-neutral-950 text-emerald-400 px-1 py-0.2 rounded text-[9px] font-black">
                                    *REG*
                                  </span>
                                )}
                              </span>
                              <span className="text-[10px] font-bold text-neutral-800">
                                HR: {target.HR.toFixed(3)}m
                              </span>
                            </div>

                            {/* Y, X, Z (ARRIBA) */}
                            <div className="space-y-0.5 bg-black/5 p-1 rounded border border-neutral-800/15">
                              <div className="flex justify-between items-center text-[12px]">
                                <span className="font-bold text-neutral-900">Y :</span>
                                <span className="font-mono font-black">{liveY.toFixed(3)} m</span>
                              </div>
                              <div className="flex justify-between items-center text-[12px]">
                                <span className="font-bold text-neutral-900">X :</span>
                                <span className="font-mono font-black">{liveX.toFixed(3)} m</span>
                              </div>
                              <div className="flex justify-between items-center text-[12px]">
                                <span className="font-bold text-neutral-900">Z :</span>
                                <span className="font-mono font-black">{liveZ.toFixed(3)} m</span>
                              </div>
                            </div>

                            {/* HD (EN MEDIO) */}
                            <div className="flex justify-between items-center bg-black/5 px-2 py-0.5 rounded text-[12px] border border-neutral-800/15">
                              <span className="font-bold text-neutral-900">HD:</span>
                              <span className="font-mono font-black">{formatDMS(envHD)}</span>
                            </div>

                            {/* PTO (ABAJO) / Cd (AL PULSAR FLECHA ABAJO) */}
                            {activeField === 0 ? (
                              <div
                                onClick={() => setActiveField(0)}
                                className="flex justify-between items-center bg-neutral-900 text-[#9CA3AF] px-2 py-0.5 rounded cursor-pointer font-bold text-xs shadow-inner min-w-0"
                              >
                                <span className="shrink-0">PTO:</span>
                                <div className="flex items-center gap-2 min-w-0 max-w-[65%] justify-end">
                                  <span className="font-mono font-black truncate max-w-full overflow-hidden">{inputBuffer}_</span>
                                  <span className="text-[9px] text-neutral-400 font-normal shrink-0">▼ Cd</span>
                                </div>
                              </div>
                            ) : (
                              <div
                                onClick={() => setActiveField(1)}
                                className="flex justify-between items-center bg-neutral-900 text-[#9CA3AF] px-2 py-0.5 rounded cursor-pointer font-bold text-xs shadow-inner min-w-0"
                              >
                                <span className="shrink-0">Cd :</span>
                                <div className="flex items-center gap-2 min-w-0 max-w-[65%] justify-end">
                                  <span className="font-mono font-black truncate max-w-full overflow-hidden">{inputBuffer}_</span>
                                  <span className="text-[9px] text-neutral-400 font-normal shrink-0">▲ PTO</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>

                {/* 3. BASE LCD: 4 ETIQUETAS DINÁMICAS (F1-F4) */}
                <div className="grid grid-cols-4 gap-1 pt-1 border-t border-neutral-800/30 text-center font-black text-[11px]">
                  {fLabels.map((lbl, idx) => (
                    <div
                      key={idx}
                      className={`py-0.5 rounded border border-neutral-900/40 text-neutral-950 font-bold ${
                        lbl ? 'bg-neutral-800/20' : 'bg-transparent'
                      }`}
                    >
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
                    title="SHIFT: Alternar modo prisma / alfanumérico"
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
                      <span>TEXTO ALFANUMÉRICO ACTIVO</span>
                      <span className="text-slate-400 text-[9px]">Usa teclas blancas o atajos</span>
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

                    {/* Centro D-Pad */}
                    <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-300 shadow-inner flex items-center justify-center pointer-events-none">
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-400"></div>
                    </div>

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
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                Compensador Bi-axial Calibrado
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
        <aside className="w-full max-w-[420px] bg-neutral-900/95 border border-neutral-800 p-5 rounded-2xl shadow-2xl flex flex-col gap-5">
          <div className="border-b border-neutral-800 pb-3">
            <h2 className="text-sm font-bold text-amber-400 flex items-center gap-2">
              <Sliders size={16} />
              Reguladores de Terreno (Mundo Físico)
            </h2>
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              Alimenta al distanciómetro EDM. En Observación, pulsar <b className="text-amber-400">[F3 AUTO]</b> lee estos valores, calcula la posición y avanza el PTO.
            </p>
          </div>

          {/* 1. Ángulo Horizontal (HD) */}
          <div className="space-y-1.5 bg-neutral-950 p-3 rounded-xl border border-neutral-800">
            <div className="flex justify-between items-center text-xs">
              <label className="font-semibold text-neutral-300">Ángulo Horizontal (HD)</label>
              <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
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
                className="w-full bg-neutral-900 border border-neutral-700 focus:border-amber-500 rounded px-2.5 py-1 text-xs font-mono text-white outline-none"
              />
              <span className="text-[11px] font-mono text-neutral-500">deg</span>
            </div>
            <input
              type="range"
              min="0"
              max="359.99"
              step="0.1"
              value={envHD}
              onChange={e => setEnvHD(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          {/* 2. Ángulo Cenital (V) */}
          <div className="space-y-1.5 bg-neutral-950 p-3 rounded-xl border border-neutral-800">
            <div className="flex justify-between items-center text-xs">
              <label className="font-semibold text-neutral-300">Ángulo Cenital (V)</label>
              <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
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
                className="w-full bg-neutral-900 border border-neutral-700 focus:border-amber-500 rounded px-2.5 py-1 text-xs font-mono text-white outline-none"
              />
              <span className="text-[11px] font-mono text-neutral-500">deg</span>
            </div>
            <input
              type="range"
              min="60"
              max="120"
              step="0.1"
              value={envV}
              onChange={e => setEnvV(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-neutral-500">
              <span>60° (Elevación)</span>
              <span className="text-amber-400 font-bold">90° (Horiz.)</span>
              <span>120° (Depresión)</span>
            </div>
          </div>

          {/* 3. Distancia Inclinada Real (SD) */}
          <div className="space-y-1.5 bg-neutral-950 p-3 rounded-xl border border-neutral-800">
            <div className="flex justify-between items-center text-xs">
              <label className="font-semibold text-neutral-300">Distancia Inclinada (SD)</label>
              <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
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
                className="w-full bg-neutral-900 border border-neutral-700 focus:border-amber-500 rounded px-2.5 py-1 text-xs font-mono text-white outline-none"
              />
              <span className="text-[11px] font-mono text-neutral-500">m</span>
            </div>
            <input
              type="range"
              min="1"
              max="200"
              step="0.5"
              value={envSD}
              onChange={e => setEnvSD(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          {/* 4. Altura del Prisma (HR) */}
          <div className="space-y-1.5 bg-neutral-950 p-3 rounded-xl border border-neutral-800">
            <div className="flex justify-between items-center text-xs">
              <label className="font-semibold text-neutral-300">Altura del Prisma (HR)</label>
              <span className="font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
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
                className="w-full bg-neutral-900 border border-neutral-700 focus:border-emerald-500 rounded px-2.5 py-1 text-xs font-mono text-white outline-none"
              />
              <span className="text-[11px] font-mono text-neutral-500">m</span>
            </div>
            <input
              type="range"
              min="0"
              max="5"
              step="0.01"
              value={target.HR}
              onChange={e => setTarget(prev => ({ ...prev, HR: parseFloat(e.target.value) || 0 }))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-neutral-500">
              <span>0m (Suelo)</span>
              <span className="text-emerald-400 font-bold">1.5m (Estándar)</span>
              <span>5m (Max)</span>
            </div>
          </div>

          {/* Estado de Memoria y Descarga USB */}
          <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 text-xs space-y-1">
            <div className="flex justify-between text-neutral-300">
              <span>Trabajo On-Board:</span>
              <span className="font-bold text-amber-400 font-mono">{jobName}</span>
            </div>
            <div className="flex justify-between text-neutral-400 text-[11px]">
              <span>Puntos en Memoria:</span>
              <span className="font-mono text-emerald-400 font-bold">{points.length} puntos</span>
            </div>
            <div className="text-[10px] text-neutral-500 italic pt-1 border-t border-neutral-800/80">
              * Para exportar a USB: En MED (Pág 2 con [FUNC]) pulsa [F2 USB] &gt; 1. Guardar Datos &gt; Selecciona Trabajo &gt; 4. SSS(Coord).
            </div>
          </div>
        </aside>

      </main>

      {/* FOOTER ACADÉMICO */}
      <footer className="border-t border-neutral-800 bg-neutral-900/80 px-6 py-2 text-xs text-neutral-400 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-neutral-300 font-semibold">Flujo de Campo Real:</span>
          <span>1. Nivel [F1 OK]</span>
          <span>→</span>
          <span>2. Trabajo ([ESC] DATO)</span>
          <span>→</span>
          <span>3. Estacionar y Orientar ([COORD])</span>
          <span>→</span>
          <span>4. Radiar ([F3 AUTO])</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-500">
          <span>TOPCON ES-105 • EDM SIN REFLECTOR 500M • PRISMA 4000M</span>
        </div>
      </footer>
    </div>
  );
}
