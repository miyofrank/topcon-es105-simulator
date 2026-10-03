import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Battery,
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
  HI: number;
}

interface Backsight {
  N: number;
  E: number;
  Z: number;
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
// 'MED'            : Pantalla de Medición (G-0, H-0, V-0, PPm 11). Pág 1/2/3 alternadas con [FUNC]
// 'MAIN'           : Pantalla de compatibilidad
// 'COORD_MENU'     : Menú COORD (1. Occ.Orien., 2. Observación)
// 'OCC_ORIEN'      : Estacionamiento (N0, E0, Z0, HI). F1=[LEER], F3=[E.RXYZ], F4=[REG]
// 'ERXYZ'          : Orientar por Punto Atrás (NBS, EBS, ZBS). F1=[LEER], F4=[OK] -> Comprobación
// 'CHECK_BS'       : Comprobación de Orientación con disparo EDM. Muestra dHD, dZ. F1=[REMED], F4=[OK]
// 'SELECT_KNOWN_PT': Selector de Base/Datos conocidos para [LEER]. F4=[CARG]
// 'OBS'            : Levantamiento (HR, CD, PTO). F3=[AUTO] dispara distanciómetro y auto-incrementa PTO
// 'DATO_MENU'      : Menú DATO accesible con ESC o Pág 2 (1. TRABAJO, 2. DATOS CONOCIDOS)
// 'JOB'            : Edición de Nombre de Proyecto (Alfanumérico, ej: PROYECTO1)
// 'KNOWN_PTS'      : Visor y gestión de coordenadas base (knownPoints). F1=[NUEV]
// 'KNOWN_NEW'      : Formulario de ingreso de nueva base (PTO, N, E, Z, CD). F4=[REG]
// 'USB_MENU'       : Menú USB principal (1. T-Type, 2. S-Type)
// 'USB_TTYPE'      : Menú T-Type (1. Guardar Datos, 2. Cargar Datos)
// 'USB_SAVE_JOB'   : Guardar datos a USB (Seleccionar Trabajo y [ENT] para exportar CSV)
type ScreenState =
  | 'TILT'
  | 'ROOT'
  | 'MED'
  | 'MAIN'
  | 'COORD_MENU'
  | 'OCC_ORIEN'
  | 'ERXYZ'
  | 'CHECK_BS'
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
  | 'USB_SAVE_JOB';

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

export default function App() {
  // =========================================================================
  // 2. ARQUITECTURA DE ESTADOS TOPOGRÁFICOS (React State)
  // =========================================================================
  const [station, setStation] = useState<Station>({
    N: 1000.0,
    E: 1000.0,
    Z: 100.0,
    HI: 1.55,
  });

  const [backsight, setBacksight] = useState<Backsight>({
    N: 1050.0,
    E: 1050.0,
    Z: 100.0,
  });

  const [azimutInicial, setAzimutInicial] = useState<number>(45.0); // Calculado tras orientar

  const [target, setTarget] = useState<Target>({
    HR: 1.6,
    CD: 'LINDERO',
    PTO: 'BM-1',
  });

  const [jobName, setJobName] = useState<string>('PROYECTO1');

  // Gestión de Trabajos (Menú TRABJ): Trabajos guardados con asterisco por defecto (* no exportado)
  const [jobsList, setJobsList] = useState<string[]>([
    '*PROYECTO1',
    '*JOB02',
    '*TOPOGRAFIA'
  ]);
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

  // Datos para comprobación de orientación y cálculo de error delta
  const [checkBsData, setCheckBsData] = useState<{
    dHD: number;
    dZ: number;
    azTeo: number;
    dhTeo: number;
    dhMed: number;
  }>({ dHD: 0, dZ: 0, azTeo: 45, dhTeo: 70.71, dhMed: 70.71 });

  // Selección en menús USB
  const [usbMenuSelection, setUsbMenuSelection] = useState<number>(1);

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
      const vals = [station.N, station.E, station.Z, station.HI];
      setInputBuffer(String(vals[activeField] ?? ''));
    } else if (screenState === 'ERXYZ') {
      const vals = [backsight.N, backsight.E, backsight.Z];
      setInputBuffer(String(vals[activeField] ?? ''));
    } else if (screenState === 'OBS') {
      if (activeField === 0) setInputBuffer(String(target.HR));
      if (activeField === 1) setInputBuffer(target.CD);
      if (activeField === 2) setInputBuffer(target.PTO);
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
  }, [screenState, activeField, station, backsight, target, jobName, knownCoordsInput, newKnownPoint]);

  // Verificar si el campo actual admite texto alfanumérico
  const isCurrentFieldAlpha = useMemo(() => {
    if (screenState === 'JOB' || screenState === 'JOB_DETAILS') return true;
    if (screenState === 'OBS' && (activeField === 1 || activeField === 2)) return true; // CD o PTO
    if (screenState === 'KNOWN_NEW' && (activeField === 0 || activeField === 4)) return true; // PTO o CD de base
    if (screenState === 'KNOWN_INPUT' && activeField === 3) return true; // PTO de Datos Conocidos
    return false;
  }, [screenState, activeField]);

  // Guardar campo editado
  const commitCurrentField = useCallback(() => {
    const val = parseFloat(inputBuffer);
    if (screenState === 'OCC_ORIEN') {
      if (activeField === 0 && !isNaN(val)) setStation(s => ({ ...s, N: val }));
      if (activeField === 1 && !isNaN(val)) setStation(s => ({ ...s, E: val }));
      if (activeField === 2 && !isNaN(val)) setStation(s => ({ ...s, Z: val }));
      if (activeField === 3 && !isNaN(val)) setStation(s => ({ ...s, HI: val }));
    } else if (screenState === 'ERXYZ') {
      if (activeField === 0 && !isNaN(val)) setBacksight(b => ({ ...b, N: val }));
      if (activeField === 1 && !isNaN(val)) setBacksight(b => ({ ...b, E: val }));
      if (activeField === 2 && !isNaN(val)) setBacksight(b => ({ ...b, Z: val }));
    } else if (screenState === 'OBS') {
      if (activeField === 0 && !isNaN(val)) setTarget(t => ({ ...t, HR: val }));
      if (activeField === 1) setTarget(t => ({ ...t, CD: inputBuffer }));
      if (activeField === 2) setTarget(t => ({ ...t, PTO: inputBuffer.trim() || '1' }));
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

  // =========================================================================
  // 5. ACCIÓN ESPECIAL: DESCARGA AUTOMÁTICA A USB (DESDE EL FLUJO USB REAL)
  // =========================================================================
  const exportarAUSB = useCallback(() => {
    playLaserBeep();
    setLcdMessage('* LEYENDO MEMORIA... *\n* EXPORTANDO A USB *');

    setTimeout(() => {
      const headers = 'PTO,NORTE,ESTE,COTA,CODIGO\n';
      const rows = points
        .map(p => `${p.PTO},${p.N.toFixed(3)},${p.E.toFixed(3)},${p.Z.toFixed(3)},${p.CD}`)
        .join('\n');

      const cleanJob = (jobName || 'PROYECTO1').trim().replace(/^\*/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
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
    }, 600);
  }, [points, jobName, playLaserBeep]);

  // =========================================================================
  // 6. MÓDULO DE CÁLCULOS TOPOGRÁFICOS Y COMPROBACIÓN
  // =========================================================================

  // 4. CÁLCULO DEL ERROR DE ORIENTACIÓN: Disparo de comprobación leyendo Distancia Inclinada (SD)
  const iniciarComprobacionOrientacion = useCallback(() => {
    setIsMeasuring(true);
    playLaserBeep();

    setTimeout(() => {
      setIsMeasuring(false);

      // Coordenadas teóricas entre estación y punto atrás
      const deltaN = backsight.N - station.N;
      const deltaE = backsight.E - station.E;
      const dhTeo = Math.sqrt(deltaN * deltaN + deltaE * deltaE);
      const azTeo = ((Math.atan2(deltaE, deltaN) * (180 / Math.PI)) + 360) % 360;

      // Lectura del distanciómetro simulado (Panel de Reguladores)
      const radV = envV * (Math.PI / 180);
      const dhMed = envSD * Math.sin(radV);
      const dvMed = envSD * Math.cos(radV);
      const zMed = station.Z + station.HI + dvMed - target.HR;

      // Cálculo estricto del error delta
      const dHD = dhMed - dhTeo;
      const dZ = zMed - backsight.Z;

      setCheckBsData({
        dHD: parseFloat(dHD.toFixed(3)),
        dZ: parseFloat(dZ.toFixed(3)),
        azTeo,
        dhTeo,
        dhMed
      });

      setScreenState('CHECK_BS');
    }, 380);
  }, [backsight, station, target.HR, envV, envSD, playLaserBeep]);

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
        { PTO: 'EST-1', N: station.N, E: station.E, Z: station.Z, CD: 'ESTACION', type: 'station' },
        { PTO: 'BS-1', N: backsight.N, E: backsight.E, Z: backsight.Z, CD: 'PTO_ATRAS', type: 'backsight' },
        ...sinBase
      ];
    });

    playLaserBeep();
    const signDHD = checkBsData.dHD >= 0 ? '+' : '';
    setLcdMessage(`¡ESTACIÓN FIJADA!\nAZ: ${formatDMS(azimut)}\ndHD: ${signDHD}${checkBsData.dHD.toFixed(3)}m\nDH: ${distDH.toFixed(3)}m`);

    setTimeout(() => {
      setScreenState('COORD_MENU');
    }, 1800);
  }, [backsight, station, checkBsData.dHD, playBeep, playLaserBeep]);

  // Disparo Láser y Levantamiento [AUTO]
  const ejecutarLevantamientoAuto = useCallback(() => {
    if (isMeasuring) return;
    setIsMeasuring(true);
    playBeep(2100, 0.05);

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
        PTO: target.PTO,
        N: parseFloat(Norte_Nuevo.toFixed(3)),
        E: parseFloat(Este_Nuevo.toFixed(3)),
        Z: parseFloat(Cota_Nueva.toFixed(3)),
        CD: target.CD.trim() || 'PTO',
        type: 'radial',
        date: new Date().toLocaleTimeString()
      };

      setPoints(prev => [...prev, nuevoPunto]);

      // Bip acústico láser y mensaje de confirmación
      playLaserBeep();
      setLcdMessage(`PTO ${target.PTO} GUARDADO\nN: ${nuevoPunto.N.toFixed(3)}\nE: ${nuevoPunto.E.toFixed(3)}\nZ: ${nuevoPunto.Z.toFixed(3)}`);

      // 7. Auto-incremento inteligente del PTO si termina en número
      const proxPTO = incrementPointId(target.PTO);
      setTarget(prev => ({
        ...prev,
        PTO: proxPTO
      }));

      setIsMeasuring(false);
    }, 450);
  }, [isMeasuring, envHD, envV, envSD, azimutInicial, station, target, playBeep, playLaserBeep]);

  // =========================================================================
  // 7. BOTONERA FÍSICA Y MÁQUINA DE ESTADOS TOPCON
  // =========================================================================

  // Tecla física [SFT]: Cicla entre Prisma, Tarjeta y Lectura Directa
  const handleShiftPress = useCallback(() => {
    playBeep(1200, 0.05);
    setEdmMode(prev => {
      if (prev === 'prism') return 'sheet';
      if (prev === 'sheet') return 'non_prism';
      return 'prism';
    });
    // Si está en un campo de texto, también despliega u oculta la ayuda alfanumérica
    if (isCurrentFieldAlpha) {
      setIsAlphaKeyboardOpen(k => !k);
    }
  }, [playBeep, isCurrentFieldAlpha]);

  // Tecla física [FUNC]: Alterna páginas de MED (Pág 1/2/3) o Pantalla Principal (Pág 1 / Pág 2)
  const handleFuncPress = useCallback(() => {
    playBeep(1200, 0.05);
    if (screenState === 'MED') {
      setMedPage(p => (p === 1 ? 2 : p === 2 ? 3 : 1));
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
      else if (key === '2') { setScreenState('USB_MENU'); setUsbMenuSelection(1); }
      else if (key === '3') { setScreenState('DATO_MENU'); setMenuSelection(1); }
      return;
    }

    // Selección numérica en menú COORD
    if (screenState === 'COORD_MENU') {
      if (key === '1') { setScreenState('OCC_ORIEN'); setActiveField(0); }
      else if (key === '2') { setScreenState('OBS'); setActiveField(0); }
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

    // Selección numérica en menú USB
    if (screenState === 'USB_MENU') {
      if (key === '1') { setScreenState('USB_TTYPE'); setUsbMenuSelection(1); }
      else if (key === '2') { setLcdMessage('MODO S-TYPE NO DISPONIBLE\nUSE 1. T-TYPE'); }
      return;
    }

    // Selección numérica en menú USB T-TYPE
    if (screenState === 'USB_TTYPE') {
      if (key === '1') { setScreenState('USB_SAVE_JOB'); }
      else if (key === '2') { setLcdMessage('CARGAR DATOS USB:\nDISPOSITIVO NO CONECTADO'); }
      return;
    }

    if (
      screenState === 'TILT' ||
      screenState === 'MED' ||
      screenState === 'MAIN' ||
      screenState === 'KNOWN_DEL' ||
      screenState === 'KNOWN_DEL_CONFIRM' ||
      screenState === 'KNOWN_VIEW' ||
      screenState === 'KNOWN_PTS' ||
      screenState === 'SELECT_KNOWN_PT' ||
      screenState === 'CHECK_BS' ||
      screenState === 'JOB_SELECT' ||
      screenState === 'JOB_LIST' ||
      screenState === 'JOB_DELETE_LIST' ||
      screenState === 'JOB_DELETE_CONFIRM'
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

    // Menú COORD
    if (screenState === 'COORD_MENU') {
      if (menuSelection === 1) {
        setScreenState('OCC_ORIEN');
        setActiveField(0);
      } else {
        setScreenState('OBS');
        setActiveField(0);
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
      const selected = jobsList[selectedJobIdx] || '*PROYECTO1';
      setJobName(selected.replace(/^\*/, ''));
      playLaserBeep();
      setLcdMessage(`TRABJ SELECCIONADO:\n${selected}`);
      setTimeout(() => {
        setScreenState('JOB_SELECT');
      }, 1000);
      return;
    }

    // 3. Detalles de TRABJ
    if (screenState === 'JOB_DETAILS') {
      const clean = inputBuffer.trim() || 'PROYECTO1';
      const oldClean = jobName.replace(/^\*/, '');
      setJobName(clean);
      setJobsList(prev =>
        prev.map(j => (j.replace(/^\*/, '') === oldClean ? (j.startsWith('*') ? `*${clean}` : clean) : j))
      );
      playLaserBeep();
      setLcdMessage(`DETALLES GUARDADOS:\n${clean}`);
      setTimeout(() => {
        setScreenState('JOB_MENU');
      }, 1200);
      return;
    }

    // 4. Borrar TRABJ - Selección
    if (screenState === 'JOB_DELETE_LIST') {
      const target = jobsList[selectedJobIdx];
      if (target) {
        setJobDeleteTarget(target);
        setScreenState('JOB_DELETE_CONFIRM');
      }
      return;
    }

    // 4. Borrar TRABJ - Confirmación con [ENT]
    if (screenState === 'JOB_DELETE_CONFIRM') {
      setJobsList(prev => {
        const filtered = prev.filter(j => j !== jobDeleteTarget);
        return filtered.length > 0 ? filtered : ['*TRAB_01'];
      });
      playLaserBeep();
      setLcdMessage(`${jobDeleteTarget}\nBORRADO`);
      setTimeout(() => {
        setSelectedJobIdx(0);
        setScreenState('JOB_DELETE_LIST');
      }, 1200);
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

    // 2. Cargar base seleccionada con [LEER]
    if (screenState === 'SELECT_KNOWN_PT') {
      const selected = knownPoints[viewKnownIdx];
      if (selected) {
        playLaserBeep();
        if (readTargetContext === 'OCC') {
          setStation(s => ({
            ...s,
            N: selected.N,
            E: selected.E,
            Z: selected.Z
          }));
          setLcdMessage(`BASE ${selected.PTO}\nCARGADA EN N0,E0,Z0`);
          setScreenState('OCC_ORIEN');
          setActiveField(3); // Pasa a Altura Instrumento HI
        } else {
          setBacksight({
            N: selected.N,
            E: selected.E,
            Z: selected.Z
          });
          setLcdMessage(`BASE ${selected.PTO}\nCARGADA EN PTO ATRÁS`);
          setScreenState('ERXYZ');
          setActiveField(0);
        }
      }
      return;
    }

    // Formulario de Estacionamiento
    if (screenState === 'OCC_ORIEN') {
      if (activeField < 3) {
        setActiveField(f => f + 1);
      } else {
        setActiveField(0);
        setLcdMessage('DATOS ESTACIÓN\nGUARDADOS');
      }
      return;
    }

    // Formulario de Orientación: lanza disparo de comprobación
    if (screenState === 'ERXYZ') {
      if (activeField < 2) {
        setActiveField(f => f + 1);
      } else {
        iniciarComprobacionOrientacion();
      }
      return;
    }

    // 4. Confirmación de Orientación tras disparo de comprobación
    if (screenState === 'CHECK_BS') {
      ejecutarOrientacionFinal();
      return;
    }

    // Observación
    if (screenState === 'OBS') {
      if (activeField < 2) {
        setActiveField(f => f + 1);
      } else {
        setActiveField(0);
      }
      return;
    }

    // 3. Menú USB: T-Type vs S-Type
    if (screenState === 'USB_MENU') {
      if (usbMenuSelection === 1) {
        setScreenState('USB_TTYPE');
        setUsbMenuSelection(1);
      } else {
        setLcdMessage('MODO S-TYPE NO DISPONIBLE\nUSE 1. T-TYPE');
      }
      return;
    }

    // Menú USB T-Type: Guardar vs Cargar
    if (screenState === 'USB_TTYPE') {
      if (usbMenuSelection === 1) {
        setScreenState('USB_SAVE_JOB');
      } else {
        setLcdMessage('CARGAR DATOS USB:\nDISPOSITIVO NO CONECTADO');
      }
      return;
    }

    // Pantalla de Descarga de Trabajo a USB
    if (screenState === 'USB_SAVE_JOB') {
      exportarAUSB();
      setTimeout(() => {
        setScreenState('ROOT');
      }, 1600);
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
    usbMenuSelection,
    playBeep,
    playLaserBeep
  ]);

  // Botón físico ESC (Al pulsar repetidamente desde cualquier estado, llega a 'ROOT')
  const handleEscPress = useCallback(() => {
    playBeep(900, 0.07);
    commitCurrentField();
    setLcdMessage(null);

    if (screenState === 'ROOT') {
      // Ya estamos en la raíz (ROOT); se mantiene
      return;
    } else if (screenState === 'MED') {
      setScreenState('ROOT');
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
    } else if (screenState === 'COORD_MENU') {
      setScreenState('MED');
    } else if (screenState === 'OCC_ORIEN' || screenState === 'OBS') {
      setScreenState('COORD_MENU');
      setActiveField(0);
    } else if (screenState === 'ERXYZ') {
      setScreenState('OCC_ORIEN');
      setActiveField(0);
    } else if (screenState === 'CHECK_BS') {
      setScreenState('ERXYZ');
    } else if (screenState === 'USB_MENU') {
      setScreenState('ROOT');
    } else if (screenState === 'USB_TTYPE') {
      setScreenState('USB_MENU');
    } else if (screenState === 'USB_SAVE_JOB') {
      setScreenState('USB_TTYPE');
    } else if (screenState === 'TILT') {
      setScreenState('ROOT');
    } else {
      setScreenState('ROOT');
    }
  }, [screenState, readTargetContext, commitCurrentField, playBeep]);

  // Flechas direccionales en cruz
  const handleArrow = useCallback((dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT') => {
    playBeep(1050, 0.04);
    commitCurrentField();

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

    if (screenState === 'USB_MENU' || screenState === 'USB_TTYPE') {
      if (dir === 'UP' || dir === 'DOWN') {
        setUsbMenuSelection(prev => (prev === 1 ? 2 : 1));
      }
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

    if (screenState === 'KNOWN_INPUT') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 3));
      if (dir === 'DOWN') setActiveField(f => (f < 3 ? f + 1 : 0));
      return;
    }

    if (screenState === 'OCC_ORIEN') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 3));
      if (dir === 'DOWN') setActiveField(f => (f < 3 ? f + 1 : 0));
    } else if (screenState === 'ERXYZ') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 2));
      if (dir === 'DOWN') setActiveField(f => (f < 2 ? f + 1 : 0));
    } else if (screenState === 'KNOWN_NEW') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 4));
      if (dir === 'DOWN') setActiveField(f => (f < 4 ? f + 1 : 0));
    } else if (screenState === 'OBS') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 2));
      if (dir === 'DOWN') setActiveField(f => (f < 2 ? f + 1 : 0));
    }
  }, [screenState, knownPoints.length, jobsList.length, commitCurrentField, playBeep]);

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

    // 1. ESTADO ROOT (Raíz): F1=[OBS], F2=[USB], F3=[DATO], F4=[CNFG]
    if (screenState === 'ROOT') {
      if (fNum === 1) {
        // F1=[OBS] -> va a Observación (pantalla MED)
        setScreenState('MED');
        setMedPage(1);
      } else if (fNum === 2) {
        // F2=[USB] -> menú USB
        setScreenState('USB_MENU');
        setUsbMenuSelection(1);
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
      if (medPage === 1) {
        // Pág 1: [MENU] [COMP] [ANG-H] [EDM]
        if (fNum === 1) {
          setScreenState('COORD_MENU');
          setMenuSelection(1);
        } else if (fNum === 2) {
          setScreenState('TILT');
        } else if (fNum === 3) {
          setLcdMessage(`ÁNGULO H RETENIDO:\n${formatDMS(envHD)}`);
        } else if (fNum === 4) {
          handleShiftPress();
        }
      } else if (medPage === 2) {
        // Pág 2: [MDR] [DESPLZ] [TOPO] [REPL]
        if (fNum === 1) {
          setIsMeasuring(true);
          setTimeout(() => { setIsMeasuring(false); playLaserBeep(); }, 350);
        } else if (fNum === 2) {
          setLcdMessage('MODO DESPLAZAMIENTO\n(OFFSET) ACTIVO');
        } else if (fNum === 3) {
          setScreenState('OBS');
          setActiveField(0);
        } else if (fNum === 4) {
          setLcdMessage('MODO REPLANTEO (S-O)\nSELECCIONE PTO');
        }
      } else {
        // Pág 3: [MED] [GHV] [AZ-0] [COORD]
        if (fNum === 1) {
          setIsMeasuring(true);
          setTimeout(() => { setIsMeasuring(false); playLaserBeep(); }, 350);
        } else if (fNum === 2) {
          const radV = envV * (Math.PI / 180);
          const az = ((azimutInicial + envHD) % 360) * (Math.PI / 180);
          const dh = envSD * Math.sin(radV);
          const n = station.N + dh * Math.cos(az);
          const e = station.E + dh * Math.sin(az);
          const z = station.Z + station.HI + envSD * Math.cos(radV) - target.HR;
          setLcdMessage(`COORD EN VIVO:\nN: ${n.toFixed(3)}\nE: ${e.toFixed(3)}\nZ: ${z.toFixed(3)}`);
        } else if (fNum === 3) {
          setEnvHD(0);
          setLcdMessage('ÁNGULO HORIZONTAL\nSETEADO A 0°');
        } else if (fNum === 4) {
          // En la Pág 3, si el usuario pulsa F4 (COORD), el estado pasa a COORD_MENU
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
          setUsbMenuSelection(1);
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

    // Menús USB
    if (screenState === 'USB_MENU' || screenState === 'USB_TTYPE') {
      if (fNum === 4) handleEnterPress();
      return;
    }

    // Guardar Trabajo USB
    if (screenState === 'USB_SAVE_JOB') {
      if (fNum === 3) setScreenState('JOB_SELECT');
      else if (fNum === 4) handleEnterPress();
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
        setSelectedJobIdx(0);
      } else if (fNum === 4) {
        setScreenState('JOB_MENU');
      }
      return;
    }

    // 2. Lista visual de TRABJ: F1=[ANT], F2=[SIG], F3=[ESC], F4=[ENT]
    if (screenState === 'JOB_LIST') {
      if (fNum === 1) {
        setSelectedJobIdx(i => (i > 0 ? i - 1 : jobsList.length - 1));
      } else if (fNum === 2) {
        setSelectedJobIdx(i => (i < jobsList.length - 1 ? i + 1 : 0));
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
        setSelectedJobIdx(i => (i > 0 ? i - 1 : jobsList.length - 1));
      } else if (fNum === 2) {
        setSelectedJobIdx(i => (i < jobsList.length - 1 ? i + 1 : 0));
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
        // [NO]: Cancelar
        setScreenState('JOB_DELETE_LIST');
      } else if (fNum === 4) {
        // [SI]: Solo si se presiona F4, el trabajo se elimina del array
        setJobsList(prev => {
          const filtered = prev.filter(j => j !== jobDeleteTarget);
          return filtered.length > 0 ? filtered : ['*TRAB_01'];
        });
        playLaserBeep();
        setLcdMessage(`${jobDeleteTarget}\nBORRADO`);
        setTimeout(() => {
          setSelectedJobIdx(0);
          setScreenState('JOB_DELETE_LIST');
        }, 1200);
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

    // Estacionamiento: F1=[LEER], F3=[E.RXYZ], F4=[REG]
    if (screenState === 'OCC_ORIEN') {
      if (fNum === 1) {
        setReadTargetContext('OCC');
        setViewKnownIdx(0);
        setScreenState('SELECT_KNOWN_PT');
      } else if (fNum === 3) {
        setScreenState('ERXYZ');
        setActiveField(0);
      } else if (fNum === 4) {
        commitCurrentField();
        setLcdMessage('ESTACIÓN FIJADA');
        setScreenState('COORD_MENU');
      }
      return;
    }

    // Orientar Punto Atrás: F1=[LEER], F4=[OK] -> Comprobación
    if (screenState === 'ERXYZ') {
      if (fNum === 1) {
        setReadTargetContext('BS');
        setViewKnownIdx(0);
        setScreenState('SELECT_KNOWN_PT');
      } else if (fNum === 4) {
        commitCurrentField();
        iniciarComprobacionOrientacion();
      }
      return;
    }

    // 4. Comprobación de Orientación: F1=[REMED], F3=[ESC], F4=[OK]
    if (screenState === 'CHECK_BS') {
      if (fNum === 1) {
        iniciarComprobacionOrientacion();
      } else if (fNum === 3) {
        setScreenState('ERXYZ');
      } else if (fNum === 4) {
        ejecutarOrientacionFinal();
      }
      return;
    }

    // Observación (Levantamiento): F3=[AUTO]
    if (screenState === 'OBS') {
      if (fNum === 3) {
        ejecutarLevantamientoAuto();
      } else if (fNum === 1) {
        setIsMeasuring(true);
        setTimeout(() => { setIsMeasuring(false); playLaserBeep(); }, 300);
      } else if (fNum === 2) {
        const radV = envV * (Math.PI / 180);
        const az = ((azimutInicial + envHD) % 360) * (Math.PI / 180);
        const dh = envSD * Math.sin(radV);
        const n = station.N + dh * Math.cos(az);
        const e = station.E + dh * Math.sin(az);
        const z = station.Z + station.HI + envSD * Math.cos(radV) - target.HR;
        setLcdMessage(`COORD INST:\nN: ${n.toFixed(3)}\nE: ${e.toFixed(3)}\nZ: ${z.toFixed(3)}`);
      }
    }
  }, [
    screenState,
    medPage,
    mainPage,
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

      if (isCurrentFieldAlpha && ((e.key >= 'a' && e.key <= 'z') || (e.key >= 'A' && e.key <= 'Z') || e.key === '_')) {
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
      case 'ROOT':
        return ['OBS', 'USB', 'DATO', 'CNFG'];
      case 'MED':
        if (medPage === 1) return ['MENU', 'COMP', 'ANG-H', 'EDM'];
        if (medPage === 2) return ['MDR', 'DESPLZ', 'TOPO', 'REPL'];
        return ['MED', 'GHV', 'AZ-0', 'COORD'];
      case 'MAIN':
        return mainPage === 1
          ? ['DIST', 'SHV', 'OSET', 'COORD']
          : ['DATO', 'USB', 'TILT', 'COORD'];
      case 'COORD_MENU':
      case 'DATO_MENU':
      case 'JOB_MENU':
      case 'KNOWN_MENU':
      case 'USB_MENU':
      case 'USB_TTYPE':
        return ['', '', '', 'ENT'];
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
        return ['', '', 'LIST', 'ENT'];
      case 'JOB':
        return ['LIST', '', isAlphaKeyboardOpen ? 'NUM' : 'ALF', 'ENT'];
      case 'KNOWN_PTS':
        return ['NUEV', 'ANT', 'SIG', 'SALIR'];
      case 'KNOWN_NEW':
        return ['', '', isAlphaKeyboardOpen ? 'NUM' : 'ALF', 'REG'];
      case 'SELECT_KNOWN_PT':
        return ['ANT', 'SIG', 'ESC', 'CARG'];
      case 'OCC_ORIEN':
        return ['LEER', '', 'E.RXYZ', 'REG'];
      case 'ERXYZ':
        return ['LEER', '', 'AZIM', 'OK'];
      case 'CHECK_BS':
        return ['REMED', '', 'ESC', 'OK'];
      case 'OBS':
        return ['DIST', 'COORD', 'AUTO', 'OFS'];
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
              <div className="md:col-span-7 flex flex-col gap-3">
                
                {/* MARCO RECESIVO DE LA PANTALLA LCD */}
                <div className="bg-neutral-950 p-2.5 rounded-2xl border-2 border-neutral-800 shadow-inner flex flex-col">
              
              {/* PANTALLA LCD RETROILUMINADA (Fondo exacto #9CA3AF) */}
              <div
                className={`relative w-full h-[230px] rounded-lg p-2.5 font-mono transition-colors duration-300 shadow-inner border-2 border-neutral-700 flex flex-col justify-between overflow-hidden ${
                  isBacklightOn ? 'bg-[#9CA3AF] text-neutral-950' : 'bg-[#7a8390] text-neutral-900'
                }`}
                style={{
                  backgroundImage: 'radial-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 0)',
                  backgroundSize: '4px 4px',
                }}
              >
                {/* 1. BARRA SUPERIOR LCD (Compensador, Modo EDM ciclante por SFT, Batería) */}
                <div className="flex items-center justify-between border-b border-neutral-800/40 pb-1 text-[11px] font-bold tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <span className="bg-neutral-900 text-[#9CA3AF] px-1 py-0.2 rounded text-[10px]">
                      {screenState === 'TILT'
                        ? 'TIL'
                        : screenState === 'ROOT'
                        ? 'ROOT'
                        : screenState === 'MED'
                        ? `P${medPage}`
                        : screenState === 'MAIN'
                        ? `P${mainPage}`
                        : screenState === 'OBS'
                        ? 'REC'
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
                    <div className="flex items-center gap-1 font-bold text-neutral-950" title="Batería 100%">
                      <Battery size={13} className="stroke-[2.5]" />
                      <span className="text-[10px]">100%</span>
                    </div>
                  </div>
                </div>

                {/* 2. ÁREA CENTRAL DE PANTALLA LCD SEGÚN MÁQUINA DE ESTADOS */}
                <div className="flex-1 py-1 flex flex-col justify-center text-xs leading-relaxed">
                  
                  {/* ALERTA TEMPORAL EN PANTALLA LCD */}
                  {lcdMessage ? (
                    <div className="bg-neutral-950 text-[#9CA3AF] p-2 rounded shadow border border-neutral-800 text-center font-bold whitespace-pre-line text-xs">
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
                          <div className="flex justify-between items-center font-bold text-xs pt-1 border-t border-neutral-800/30">
                            <span>Tra. {jobName}</span>
                          </div>
                        </div>
                      )}

                      {/* 2. ESTADO 'MED': PANTALLA DE MEDICIÓN CON PAGINACIÓN P1, P2, P3 */}
                      {screenState === 'MED' && (
                        <div className="space-y-1 font-mono text-[13px]">
                          <div className="flex justify-between items-center text-xs font-black border-b border-neutral-800/30 pb-0.5">
                            <span className="text-[13px] tracking-wider text-neutral-950 font-black">MED</span>
                            <div className="flex items-center gap-2 font-bold">
                              <span className="text-[11px] text-neutral-800">PPm 11</span>
                              <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 py-0.2 rounded font-mono font-bold">
                                P{medPage}
                              </span>
                            </div>
                          </div>
                          <div className="flex justify-between items-center bg-black/5 px-1.5 py-0.5 rounded">
                            <span className="font-bold">G-0 :</span>
                            <span className="font-black text-right">{envSD.toFixed(3)} m</span>
                          </div>
                          <div className="flex justify-between items-center bg-black/5 px-1.5 py-0.5 rounded">
                            <span className="font-bold">H-0 :</span>
                            <span className="font-black text-right">{formatDMS(envHD)}</span>
                          </div>
                          <div className="flex justify-between items-center bg-black/5 px-1.5 py-0.5 rounded">
                            <span className="font-bold">V-0 :</span>
                            <span className="font-black text-right">{formatDMS(envV)}</span>
                          </div>
                          <div className="text-[10px] text-neutral-700 flex justify-between font-sans font-bold pt-0.5">
                            <span>Pág {medPage}/3 (FUNC)</span>
                            <span>ESC = ROOT</span>
                          </div>
                        </div>
                      )}

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
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide flex justify-between items-center text-[11px]">
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
                              className={`px-1.5 py-0.2 rounded cursor-pointer flex items-center justify-between text-[11px] ${
                                jobMenuSelection === item.id ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                              }`}
                            >
                              <span>{item.label}</span>
                              {jobMenuSelection === item.id && <span className="text-[10px]">[ENT]</span>}
                            </div>
                          ))}
                          <div className="text-[9px] text-neutral-700 text-center pt-0.5 font-sans">
                            ▲ / ▼: Seleccionar • [ENT]: Entrar
                          </div>
                        </div>
                      )}

                      {/* 2. ESTADO 'JOB_SELECT': SELECCIONAR TRABJ (DOS LÍNEAS) */}
                      {screenState === 'JOB_SELECT' && (
                        <div className="space-y-1.5 font-mono text-xs px-1">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide text-[11px]">
                            --- SELEC TRABJ ---
                          </div>
                          <div className="space-y-1 pt-1">
                            <div
                              onClick={() => setJobSelectField(0)}
                              className={`p-1.5 rounded cursor-pointer flex items-center justify-between border ${
                                jobSelectField === 0
                                  ? 'bg-neutral-900 text-[#9CA3AF] border-neutral-800 font-black'
                                  : 'bg-black/5 border-transparent text-neutral-950 font-bold'
                              }`}
                            >
                              <span>Selec TRABJ:</span>
                              <span className="font-mono">{jobsList.find(j => j.replace(/^\*/, '') === jobName.replace(/^\*/, '')) || `*${jobName}`}</span>
                            </div>
                            <div
                              onClick={() => setJobSelectField(1)}
                              className={`p-1.5 rounded cursor-pointer flex items-center justify-between border ${
                                jobSelectField === 1
                                  ? 'bg-neutral-900 text-[#9CA3AF] border-neutral-800 font-black'
                                  : 'bg-black/5 border-transparent text-neutral-950 font-bold'
                              }`}
                            >
                              <span>Busca Coord TRABJ:</span>
                              <span className="font-mono">{jobsList.find(j => j.replace(/^\*/, '') === jobName.replace(/^\*/, '')) || `*${jobName}`}</span>
                            </div>
                          </div>
                          <div className="text-[10px] text-neutral-800 text-center pt-1 font-sans font-bold">
                            Presione [F1 LIST] para ver lista de trabajos
                          </div>
                        </div>
                      )}

                      {/* 2. ESTADO 'JOB_LIST': LISTA VISUAL DE TRABAJOS CON ASTERISCO */}
                      {screenState === 'JOB_LIST' && (
                        <div className="space-y-1 font-mono text-xs px-1">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>LISTA TRABJ</span>
                            <span className="text-[10px] font-bold">[{selectedJobIdx + 1}/{jobsList.length}]</span>
                          </div>
                          <div className="space-y-0.5 max-h-[110px] overflow-hidden">
                            {jobsList.map((job, idx) => (
                              <div
                                key={job + idx}
                                onClick={() => setSelectedJobIdx(idx)}
                                className={`px-2 py-1 rounded cursor-pointer flex justify-between items-center text-xs ${
                                  selectedJobIdx === idx
                                    ? 'bg-neutral-900 text-[#9CA3AF] font-black'
                                    : 'hover:bg-black/10 text-neutral-900 font-semibold'
                                }`}
                              >
                                <span>{job}</span>
                                {selectedJobIdx === idx && <span className="text-[10px] font-mono">[ENT]</span>}
                              </div>
                            ))}
                          </div>
                          <div className="text-[10px] text-neutral-700 text-center pt-0.5 font-sans">
                            * No exportado a USB • [ENT] Seleccionar
                          </div>
                        </div>
                      )}

                      {/* 3. ESTADO 'JOB_DETAILS': DETALLES DE TRABJ CON ESCAL: 1.00000000 */}
                      {screenState === 'JOB_DETAILS' && (
                        <div className="space-y-1 font-mono text-xs px-1">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>DETALLES DE TRABJ</span>
                            <span className="text-[10px] font-black">F4=[OK]</span>
                          </div>
                          <div className="bg-neutral-900 text-[#9CA3AF] px-2 py-1.5 rounded flex justify-between items-center font-bold text-xs">
                            <span>TRAB:</span>
                            <span className="font-mono">{inputBuffer}_</span>
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
                      {screenState === 'JOB_DELETE_LIST' && (
                        <div className="space-y-1 font-mono text-xs px-1">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5 text-rose-950">
                            <span>BORRAR TRABJ</span>
                            <span className="text-[10px] font-bold">[{selectedJobIdx + 1}/{jobsList.length}]</span>
                          </div>
                          <div className="space-y-0.5 max-h-[110px] overflow-hidden">
                            {jobsList.map((job, idx) => (
                              <div
                                key={job + idx}
                                onClick={() => setSelectedJobIdx(idx)}
                                className={`px-2 py-1 rounded cursor-pointer flex justify-between items-center text-xs ${
                                  selectedJobIdx === idx
                                    ? 'bg-neutral-900 text-[#9CA3AF] font-black'
                                    : 'hover:bg-black/10 text-neutral-900 font-semibold'
                                }`}
                              >
                                <span>{job}</span>
                                {selectedJobIdx === idx && <span className="text-[10px] font-mono">[ENT]</span>}
                              </div>
                            ))}
                          </div>
                          <div className="text-[10px] text-neutral-700 text-center pt-0.5 font-sans">
                            Seleccione trabajo y pulse [ENT] para confirmar
                          </div>
                        </div>
                      )}

                      {/* 4. ESTADO 'JOB_DELETE_CONFIRM': AVISO DE CONFIRMACIÓN CON [NO] Y [SI] */}
                      {screenState === 'JOB_DELETE_CONFIRM' && (
                        <div className="space-y-2 font-mono text-xs px-1 py-3 text-center">
                          <div className="font-bold text-xs text-neutral-950 uppercase border-b border-neutral-800/30 pb-1">
                            CONFIRMAR BORRADO
                          </div>
                          <div className="bg-neutral-900 text-[#9CA3AF] p-2.5 rounded font-black text-xs shadow-inner">
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
                          <div className="bg-neutral-900 text-[#9CA3AF] px-2 py-1 rounded flex justify-between items-center font-bold">
                            <span>TRAB:</span>
                            <span>{inputBuffer}_</span>
                          </div>
                          <div className="text-[11px] text-neutral-800 space-y-0.5 pt-0.5">
                            <div className="flex justify-between">
                              <span>PUNTOS LEVANTADOS:</span>
                              <span className="font-bold">{points.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>DESTINO USB:</span>
                              <span className="font-bold truncate max-w-[130px]">{inputBuffer || 'TRAB'}.csv</span>
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
                                className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer ${
                                  isCur ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}:</span>
                                <span>{isCur ? `${inputBuffer}_` : (item.val !== '' ? item.val : '---')}</span>
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
                              <div className="flex justify-between font-bold">
                                <span>PTO: {knownPoints[selectedKnownIdx]?.PTO}</span>
                                <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 rounded">
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
                          <div className="text-xs font-bold bg-black/10 px-2 py-1 rounded">
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
                              <div className="flex justify-between font-bold">
                                <span>PTO: {knownPoints[viewKnownIdx]?.PTO}</span>
                                <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 rounded">
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
                              <div className="flex justify-between font-bold">
                                <span>PTO: {knownPoints[viewKnownIdx]?.PTO}</span>
                                <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 rounded">
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
                                className={`flex justify-between items-center px-1.5 py-0.2 rounded cursor-pointer ${
                                  isCur ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}:</span>
                                <span>{isCur ? `${inputBuffer}_` : item.val}</span>
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
                              <div className="flex justify-between font-bold">
                                <span>PTO: {knownPoints[viewKnownIdx]?.PTO}</span>
                                <span className="text-[10px] bg-neutral-900 text-[#9CA3AF] px-1 rounded">
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

                      {/* ESTADO 'OCC_ORIEN': ESTACIONAMIENTO (N0, E0, Z0, HI) */}
                      {screenState === 'OCC_ORIEN' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>ESTACIONAMIENTO</span>
                            <span className="text-[10px] font-normal">F1=[LEER] • F3=[E.RXYZ]</span>
                          </div>
                          {[
                            { label: 'N0', val: station.N },
                            { label: 'E0', val: station.E },
                            { label: 'Z0', val: station.Z },
                            { label: 'HI', val: station.HI }
                          ].map((item, idx) => {
                            const isCur = activeField === idx;
                            return (
                              <div
                                key={item.label}
                                onClick={() => setActiveField(idx)}
                                className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer ${
                                  isCur ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}:</span>
                                <span>{isCur ? `${inputBuffer}_` : `${item.val.toFixed(3)} m`}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* ESTADO 'ERXYZ': ORIENTAR PUNTO ATRÁS (NBS, EBS, ZBS) */}
                      {screenState === 'ERXYZ' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>ORIENTAR (PTO ATRÁS)</span>
                            <span className="text-[10px] font-black">F1=[LEER] • F4=[OK]</span>
                          </div>
                          {[
                            { label: 'NBS', val: backsight.N },
                            { label: 'EBS', val: backsight.E },
                            { label: 'ZBS', val: backsight.Z }
                          ].map((item, idx) => {
                            const isCur = activeField === idx;
                            return (
                              <div
                                key={item.label}
                                onClick={() => setActiveField(idx)}
                                className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer ${
                                  isCur ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                                }`}
                              >
                                <span>{item.label}:</span>
                                <span>{isCur ? `${inputBuffer}_` : `${item.val.toFixed(3)} m`}</span>
                              </div>
                            );
                          })}
                          <div className="text-[10px] text-neutral-800 text-center font-bold pt-0.5 font-sans">
                            [F1] LEER Base • [F4] Comprobar Error con EDM
                          </div>
                        </div>
                      )}

                      {/* 4. ESTADO 'CHECK_BS': COMPROBACIÓN DE ORIENTACIÓN (ERROR DELTA) */}
                      {screenState === 'CHECK_BS' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>COMPROBAR ORIEN.</span>
                            <span className="text-[10px] font-black">F4=[OK]</span>
                          </div>
                          <div className="space-y-0.5 bg-black/5 p-1 rounded">
                            <div className="flex justify-between font-black">
                              <span>dHD :</span>
                              <span className={Math.abs(checkBsData.dHD) <= 0.01 ? 'text-emerald-950 font-bold' : 'text-amber-950 font-bold'}>
                                {checkBsData.dHD >= 0 ? '+' : ''}{checkBsData.dHD.toFixed(3)} m
                              </span>
                            </div>
                            <div className="flex justify-between font-black">
                              <span>dZ  :</span>
                              <span className={Math.abs(checkBsData.dZ) <= 0.01 ? 'text-emerald-950 font-bold' : 'text-amber-950 font-bold'}>
                                {checkBsData.dZ >= 0 ? '+' : ''}{checkBsData.dZ.toFixed(3)} m
                              </span>
                            </div>
                            <div className="flex justify-between text-[11px]">
                              <span>AZIM :</span>
                              <span>{formatDMS(checkBsData.azTeo)}</span>
                            </div>
                            <div className="flex justify-between text-[10px] text-neutral-700 border-t border-neutral-800/20 pt-0.5">
                              <span>DH Med: {checkBsData.dhMed.toFixed(3)}m</span>
                              <span>Teo: {checkBsData.dhTeo.toFixed(3)}m</span>
                            </div>
                          </div>
                          <div className="text-[10px] text-neutral-800 text-center font-bold pt-0.5 font-sans">
                            F1=[REMED] • F4=[OK] para fijar estación
                          </div>
                        </div>
                      )}

                      {/* 3. ESTADO 'USB_MENU': MENÚ PRINCIPAL USB */}
                      {screenState === 'USB_MENU' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide">
                            --- MODO USB ---
                          </div>
                          {[
                            { id: 1, label: '1. T-Type' },
                            { id: 2, label: '2. S-Type' }
                          ].map(item => (
                            <div
                              key={item.id}
                              onClick={() => {
                                setUsbMenuSelection(item.id);
                                if (item.id === 1) setScreenState('USB_TTYPE');
                                else setLcdMessage('MODO S-TYPE NO DISPONIBLE\nUSE 1. T-TYPE');
                              }}
                              className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between ${
                                usbMenuSelection === item.id ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                              }`}
                            >
                              <span>{item.label}</span>
                              {usbMenuSelection === item.id && <span>[ENT]</span>}
                            </div>
                          ))}
                          <div className="text-[10px] text-neutral-700 text-center pt-1 font-sans">
                            Seleccione 1. T-Type y pulse [ENT]
                          </div>
                        </div>
                      )}

                      {/* 3. ESTADO 'USB_TTYPE': SUBMENÚ T-TYPE */}
                      {screenState === 'USB_TTYPE' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide">
                            --- T-Type ---
                          </div>
                          {[
                            { id: 1, label: '1. Guardar Datos' },
                            { id: 2, label: '2. Cargar Datos' }
                          ].map(item => (
                            <div
                              key={item.id}
                              onClick={() => {
                                setUsbMenuSelection(item.id);
                                if (item.id === 1) setScreenState('USB_SAVE_JOB');
                                else setLcdMessage('CARGAR DATOS USB:\nDISPOSITIVO NO CONECTADO');
                              }}
                              className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between ${
                                usbMenuSelection === item.id ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                              }`}
                            >
                              <span>{item.label}</span>
                              {usbMenuSelection === item.id && <span>[ENT]</span>}
                            </div>
                          ))}
                          <div className="text-[10px] text-neutral-700 text-center pt-1 font-sans">
                            Seleccione 1. Guardar Datos
                          </div>
                        </div>
                      )}

                      {/* 3. ESTADO 'USB_SAVE_JOB': SELECCIONAR TRABAJO Y EXPORTAR A USB */}
                      {screenState === 'USB_SAVE_JOB' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>GUARDAR DATOS A USB</span>
                            <span className="text-[10px] font-black">F4=[ENT]</span>
                          </div>
                          <div className="bg-neutral-900 text-[#9CA3AF] px-2 py-1 rounded flex justify-between items-center font-bold">
                            <span>TRAB:</span>
                            <span>{jobName}</span>
                          </div>
                          <div className="text-[11px] text-neutral-800 space-y-0.5 pt-0.5">
                            <div className="flex justify-between">
                              <span>FORMATO:</span>
                              <span className="font-bold">GTS (CSV)</span>
                            </div>
                            <div className="flex justify-between">
                              <span>PUNTOS:</span>
                              <span className="font-bold">{points.length} puntos</span>
                            </div>
                          </div>
                          <div className="text-[10px] text-neutral-900 text-center font-bold pt-1 font-sans bg-black/5 rounded py-0.5">
                            Pulse [ENT] para descargar CSV
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'OBS': OBSERVACIÓN (HR, CD, PTO alfanumérico) */}
                      {screenState === 'OBS' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>OBSERVACIÓN</span>
                            <span className="text-[10px] font-black">F3=[AUTO]</span>
                          </div>

                          <div
                            onClick={() => setActiveField(0)}
                            className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer ${
                              activeField === 0 ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                            }`}
                          >
                            <span>HR :</span>
                            <span>{activeField === 0 ? `${inputBuffer}_` : `${target.HR.toFixed(3)} m`}</span>
                          </div>

                          <div
                            onClick={() => setActiveField(1)}
                            className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer ${
                              activeField === 1 ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                            }`}
                          >
                            <span>CD :</span>
                            <span>{activeField === 1 ? `${inputBuffer}_` : target.CD}</span>
                          </div>

                          <div
                            onClick={() => setActiveField(2)}
                            className={`flex justify-between items-center px-1.5 py-0.5 rounded cursor-pointer ${
                              activeField === 2 ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                            }`}
                          >
                            <span>PTO:</span>
                            <span className="font-bold">
                              {activeField === 2 ? `${inputBuffer}_` : target.PTO}
                            </span>
                          </div>

                          <div className="text-[10px] text-neutral-800 flex justify-between border-t border-neutral-800/20 pt-0.5 font-bold">
                            <span>HD:{formatDMS(envHD)}</span>
                            <span>V:{formatDMS(envV)}</span>
                          </div>
                        </div>
                      )}
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
                    onClick={() => playBeep(1600, 0.05)}
                    className="flex-1 h-8 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-amber-400 rounded-md shadow-md border-b-2 border-neutral-950 active:border-b-0 active:translate-y-0.5 flex items-center justify-center cursor-pointer transition-all"
                    title="Tecla Rápida ★"
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

          {/* Presets de puntería rápida */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
              Posiciones Rápidas de Prisma:
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { name: 'Pto Atrás (BS)', hd: 0.0, v: 90.0, sd: 70.71 },
                { name: 'Vértice 1', hd: 28.5, v: 88.75, sd: 54.3 },
                { name: 'Esquina Muro', hd: 75.2, v: 89.9, sd: 35.8 },
                { name: 'Límite Parcela', hd: 142.1, v: 91.2, sd: 68.4 }
              ].map(preset => (
                <button
                  key={preset.name}
                  onClick={() => {
                    setEnvHD(preset.hd);
                    setEnvV(preset.v);
                    setEnvSD(preset.sd);
                    playBeep(1250, 0.03);
                  }}
                  className="px-2.5 py-1.5 bg-neutral-950 hover:bg-neutral-800 text-neutral-300 hover:text-white rounded-lg text-[11px] border border-neutral-800 flex items-center justify-between transition-colors cursor-pointer"
                >
                  <span>{preset.name}</span>
                  <span className="font-mono text-[9px] text-amber-400">{preset.sd}m</span>
                </button>
              ))}
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
              * Para descargar el CSV: Pulsa [ESC] en el equipo y entra a 3. EXPORTAR A USB.
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
