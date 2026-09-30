import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Battery,
  Sliders,
  Volume2,
  VolumeX,
  Keyboard
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

// Modos de medición EDM Topcon (Ciclados con la tecla física [SFT])
type EdmMode = 'prism' | 'sheet' | 'non_prism';

// ESTADOS ESTRICTOS DE LA MÁQUINA LCD TOPCON ES-105:
// 'TILT'      : Compensador Digital de arranque (Nivel Electrónico X/Y). F1=[OK]
// 'MAIN'      : Pantalla Principal en vivo (V, HD, SD). Botón FUNC alterna Pág 1 / Pág 2.
// 'COORD_MENU': Menú COORD (1. Occ.Orien., 2. Observación)
// 'OCC_ORIEN' : Estacionamiento (N0, E0, Z0, HI). F3=[E.RXYZ], F4=[REG]
// 'ERXYZ'     : Orientar por Punto Atrás (NBS, EBS, ZBS). F4=[OK] -> Calcula Azimut Inicial
// 'OBS'       : Levantamiento (HR, CD, PTO). F3=[AUTO] dispara distanciómetro y auto-incrementa PTO
// 'DATO_MENU' : Menú DATO accesible con ESC (1. TRABAJO, 2. DATOS CONOCIDOS, 3. EXPORTAR A USB)
// 'JOB'       : Edición de Nombre de Proyecto (Alfanumérico, ej: PROYECTO1)
// 'KNOWN_PTS' : Visor interno en LCD de puntos guardados en la memoria interna
type ScreenState =
  | 'TILT'
  | 'MAIN'
  | 'COORD_MENU'
  | 'OCC_ORIEN'
  | 'ERXYZ'
  | 'OBS'
  | 'DATO_MENU'
  | 'JOB'
  | 'KNOWN_PTS';

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

  // Memoria interna de puntos de la Estación Total
  const [points, setPoints] = useState<TopoPoint[]>([
    { PTO: 'EST-1', N: 1000.0, E: 1000.0, Z: 100.0, CD: 'ESTACION', type: 'station' },
    { PTO: 'BS-1', N: 1050.0, E: 1050.0, Z: 100.0, CD: 'PTO_ATRAS', type: 'backsight' }
  ]);

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
  const [mainPage, setMainPage] = useState<1 | 2>(1); // Pág 1 / Pág 2 alternada con botón FUNC
  const [edmMode, setEdmMode] = useState<EdmMode>('prism'); // Alternado con botón SFT
  const [menuSelection, setMenuSelection] = useState<number>(1);
  const [activeField, setActiveField] = useState<number>(0);
  const [viewPointIdx, setViewPointIdx] = useState<number>(0); // Para visor LCD de DATOS CONOCIDOS
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
    } else if (screenState === 'JOB') {
      setInputBuffer(jobName);
    }
  }, [screenState, activeField, station, backsight, target, jobName]);

  // Verificar si el campo actual admite texto alfanumérico
  const isCurrentFieldAlpha = useMemo(() => {
    if (screenState === 'JOB') return true;
    if (screenState === 'OBS' && (activeField === 1 || activeField === 2)) return true; // CD o PTO
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
    } else if (screenState === 'JOB') {
      if (inputBuffer.trim()) {
        setJobName(inputBuffer.trim());
      }
    }
  }, [screenState, activeField, inputBuffer]);

  // =========================================================================
  // 5. ACCIÓN ESPECIAL: DESCARGA AUTOMÁTICA A USB (¡CERO BOTONES WEB!)
  // =========================================================================
  const exportarAUSB = useCallback(() => {
    playLaserBeep();
    setLcdMessage('* LEYENDO MEMORIA... *\n* EXPORTANDO A USB *');

    setTimeout(() => {
      const headers = 'PTO,NORTE,ESTE,COTA,CODIGO\n';
      const rows = points
        .map(p => `${p.PTO},${p.N.toFixed(3)},${p.E.toFixed(3)},${p.Z.toFixed(3)},${p.CD}`)
        .join('\n');

      const cleanJob = (jobName || 'PROYECTO1').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
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

      setLcdMessage(`¡ÉXITO EN USB!\nARCHIVO: ${fileName}\nPUNTOS: ${points.length}`);
    }, 600);
  }, [points, jobName, playLaserBeep]);

  // =========================================================================
  // 6. MÓDULO DE CÁLCULOS TOPOGRÁFICOS (REQUISITO CRÍTICO GEODÉSICO)
  // =========================================================================

  // Orientación por Punto Atrás (E.RXYZ)
  const ejecutarOrientacion = useCallback(() => {
    playBeep(1600, 0.09);
    const deltaN = backsight.N - station.N;
    const deltaE = backsight.E - station.E;

    // Azimut Inicial = Math.atan2(deltaE, deltaN) * (180 / Math.PI)
    let azimut = Math.atan2(deltaE, deltaN) * (180 / Math.PI);
    if (azimut < 0) {
      azimut += 360;
    }

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
    setLcdMessage(`¡ORIENTADO OK!\nAZ: ${formatDMS(azimut)}\nDH: ${distDH.toFixed(3)}m`);

    setTimeout(() => {
      setScreenState('COORD_MENU');
    }, 1800);
  }, [backsight, station, playBeep, playLaserBeep]);

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

  // Tecla física [FUNC]: Alterna páginas de la Pantalla Principal (Pág 1 / Pág 2)
  const handleFuncPress = useCallback(() => {
    playBeep(1200, 0.05);
    if (screenState === 'MAIN') {
      setMainPage(p => (p === 1 ? 2 : 1));
    } else {
      setIsBacklightOn(b => !b);
    }
  }, [screenState, playBeep]);

  // Teclado físico numérico y de símbolos
  const handleKeypadPress = useCallback((key: string) => {
    playBeep(1150, 0.04);

    // Selección numérica en menú COORD
    if (screenState === 'COORD_MENU') {
      if (key === '1') { setScreenState('OCC_ORIEN'); setActiveField(0); }
      else if (key === '2') { setScreenState('OBS'); setActiveField(0); }
      return;
    }

    // Selección numérica en menú DATO
    if (screenState === 'DATO_MENU') {
      if (key === '1') { setScreenState('JOB'); setInputBuffer(jobName); }
      else if (key === '2') { setScreenState('KNOWN_PTS'); setViewPointIdx(0); }
      else if (key === '3') { exportarAUSB(); }
      return;
    }

    if (screenState === 'TILT' || screenState === 'MAIN' || screenState === 'KNOWN_PTS') return;

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
  }, [screenState, inputBuffer, jobName, exportarAUSB, playBeep]);

  // Botón físico central AZUL: ENTER
  const handleEnterPress = useCallback(() => {
    playBeep(1450, 0.07);
    commitCurrentField();

    // Arranque
    if (screenState === 'TILT') {
      setScreenState('MAIN');
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
        setScreenState('JOB');
        setInputBuffer(jobName);
      } else if (menuSelection === 2) {
        setScreenState('KNOWN_PTS');
        setViewPointIdx(0);
      } else if (menuSelection === 3) {
        exportarAUSB();
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

    // Formulario de Estacionamiento
    if (screenState === 'OCC_ORIEN') {
      if (activeField < 3) {
        setActiveField(f => f + 1);
      } else {
        setActiveField(0);
        setLcdMessage('DATOS ESTACIÓN\nGUARDADOS');
      }
    } else if (screenState === 'ERXYZ') {
      if (activeField < 2) {
        setActiveField(f => f + 1);
      } else {
        ejecutarOrientacion();
      }
    } else if (screenState === 'OBS') {
      if (activeField < 2) {
        setActiveField(f => f + 1);
      } else {
        setActiveField(0);
      }
    }
  }, [screenState, menuSelection, activeField, commitCurrentField, ejecutarOrientacion, exportarAUSB, inputBuffer, jobName, playBeep, playLaserBeep]);

  // Botón físico ESC (Accede al menú DATO o regresa jerárquicamente)
  const handleEscPress = useCallback(() => {
    playBeep(900, 0.07);
    commitCurrentField();
    setLcdMessage(null);

    if (screenState === 'MAIN') {
      // Desde la pantalla principal, ESC abre directamente el Menú DATO
      setScreenState('DATO_MENU');
      setMenuSelection(1);
    } else if (screenState === 'DATO_MENU') {
      setScreenState('MAIN');
    } else if (screenState === 'JOB' || screenState === 'KNOWN_PTS') {
      setScreenState('DATO_MENU');
    } else if (screenState === 'COORD_MENU') {
      setScreenState('MAIN');
    } else if (screenState === 'OCC_ORIEN' || screenState === 'OBS') {
      setScreenState('COORD_MENU');
      setActiveField(0);
    } else if (screenState === 'ERXYZ') {
      setScreenState('OCC_ORIEN');
      setActiveField(0);
    }
  }, [screenState, commitCurrentField, playBeep]);

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
      if (dir === 'UP') setMenuSelection(prev => (prev > 1 ? prev - 1 : 3));
      if (dir === 'DOWN') setMenuSelection(prev => (prev < 3 ? prev + 1 : 1));
      return;
    }

    if (screenState === 'KNOWN_PTS') {
      if (dir === 'UP' || dir === 'LEFT') setViewPointIdx(i => (i > 0 ? i - 1 : points.length - 1));
      if (dir === 'DOWN' || dir === 'RIGHT') setViewPointIdx(i => (i < points.length - 1 ? i + 1 : 0));
      return;
    }

    if (screenState === 'OCC_ORIEN') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 3));
      if (dir === 'DOWN') setActiveField(f => (f < 3 ? f + 1 : 0));
    } else if (screenState === 'ERXYZ') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 2));
      if (dir === 'DOWN') setActiveField(f => (f < 2 ? f + 1 : 0));
    } else if (screenState === 'OBS') {
      if (dir === 'UP') setActiveField(f => (f > 0 ? f - 1 : 2));
      if (dir === 'DOWN') setActiveField(f => (f < 2 ? f + 1 : 0));
    }
  }, [screenState, points.length, commitCurrentField, playBeep]);

  // Botones de función F1-F4 según la máquina de estados
  const handleFKey = useCallback((fNum: 1 | 2 | 3 | 4) => {
    playBeep(1300, 0.06);
    commitCurrentField();

    // Estado TILT (Compensador de arranque): F1=[OK]
    if (screenState === 'TILT') {
      if (fNum === 1) {
        setScreenState('MAIN');
      } else if (fNum === 4) {
        setIsOriented(false);
        setScreenState('MAIN');
      }
      return;
    }

    // Pantalla Principal (Pág 1 y Pág 2)
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
        // Pág 2: F1=[DATO], F2=[MENU], F3=[TILT], F4=[COORD]
        if (fNum === 1) {
          setScreenState('DATO_MENU');
          setMenuSelection(1);
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

    // Pantalla TRABAJO
    if (screenState === 'JOB') {
      if (fNum === 3) setIsAlphaKeyboardOpen(k => !k);
      else if (fNum === 4) handleEnterPress();
      return;
    }

    // Visor de Puntos Guardados
    if (screenState === 'KNOWN_PTS') {
      if (fNum === 1) setViewPointIdx(i => (i > 0 ? i - 1 : points.length - 1));
      else if (fNum === 2) setViewPointIdx(i => (i < points.length - 1 ? i + 1 : 0));
      else if (fNum === 4) setScreenState('DATO_MENU');
      return;
    }

    // Estacionamiento
    if (screenState === 'OCC_ORIEN') {
      if (fNum === 3) {
        setScreenState('ERXYZ');
        setActiveField(0);
      } else if (fNum === 4) {
        commitCurrentField();
        setLcdMessage('ESTACIÓN FIJADA');
        setScreenState('COORD_MENU');
      }
      return;
    }

    // Orientar Punto Atrás
    if (screenState === 'ERXYZ') {
      if (fNum === 4) {
        commitCurrentField();
        ejecutarOrientacion();
      }
      return;
    }

    // Observación (Levantamiento): F3=[AUTO]
    if (screenState === 'OBS') {
      if (fNum === 3) {
        ejecutarLevantamientoAuto();
      } else if (fNum === 1) {
        // Medir distancia previa
        setIsMeasuring(true);
        setTimeout(() => { setIsMeasuring(false); playLaserBeep(); }, 300);
      } else if (fNum === 2) {
        // Ver coordenadas instantáneas calculadas
        const radV = envV * (Math.PI / 180);
        const az = ((azimutInicial + envHD) % 360) * (Math.PI / 180);
        const dh = envSD * Math.sin(radV);
        const n = station.N + dh * Math.cos(az);
        const e = station.E + dh * Math.sin(az);
        const z = station.Z + station.HI + envSD * Math.cos(radV) - target.HR;
        setLcdMessage(`COORD INST:\nN: ${n.toFixed(3)}\nE: ${e.toFixed(3)}\nZ: ${z.toFixed(3)}`);
      }
    }
  }, [screenState, mainPage, commitCurrentField, handleEnterPress, ejecutarOrientacion, ejecutarLevantamientoAuto, envHD, envV, envSD, azimutInicial, station, target.HR, points.length, playBeep, playLaserBeep]);

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
      case 'MAIN':
        return mainPage === 1
          ? ['DIST', 'SHV', 'OSET', 'COORD']
          : ['DATO', 'MENU', 'TILT', 'COORD'];
      case 'COORD_MENU':
        return ['', '', '', 'ENT'];
      case 'DATO_MENU':
        return ['', '', '', 'ENT'];
      case 'JOB':
        return ['LIST', '', isAlphaKeyboardOpen ? 'NUM' : 'ALF', 'ENT'];
      case 'KNOWN_PTS':
        return ['ANT', 'SIG', '', 'SALIR'];
      case 'OCC_ORIEN':
        return ['LIST', '', 'E.RXYZ', 'REG'];
      case 'ERXYZ':
        return ['LIST', '', 'AZIM', 'OK'];
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
      <main className="flex-1 flex flex-col xl:flex-row items-center justify-center p-4 lg:p-8 gap-8 max-w-[1550px] w-full mx-auto">
        
        {/* ============================================================== */}
        {/* CENTRO: HARDWARE ESTACIÓN TOTAL (Topcon ES-105)               */}
        {/* ============================================================== */}
        <section className="flex flex-col items-center">
          
          {/* CHASIS AMARILLO INDUSTRIAL TOPCON CON TEXTURAS Y RELIEVE */}
          <div className="w-full max-w-[490px] bg-gradient-to-b from-amber-500 via-amber-600 to-amber-700 rounded-3xl p-5 shadow-2xl border-4 border-amber-400/70 relative flex flex-col gap-4">
            
            {/* Grabados en carcasa industrial */}
            <div className="flex justify-between items-center px-2">
              <span className="text-[10px] font-mono font-bold tracking-widest text-amber-950/80 uppercase">
                LongLink™ • TSshield™
              </span>
              <span className="text-[10px] font-mono font-bold tracking-widest text-amber-950/80 uppercase">
                IP66 WATERPROOF
              </span>
            </div>

            {/* Placa de Marca frontal Topcon */}
            <div className="flex items-center justify-between bg-neutral-900 px-4 py-2 rounded-xl border border-neutral-700 shadow-inner">
              <span className="text-white font-black tracking-widest text-base italic">
                TOPCON
              </span>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-sm shadow-emerald-500"></span>
                <span className="text-amber-400 font-mono text-xs font-extrabold tracking-wider bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">
                  ES-105
                </span>
              </div>
            </div>

            {/* MARCO RECESIVO DE LA PANTALLA LCD */}
            <div className="bg-neutral-950 p-3 rounded-2xl border-2 border-neutral-800 shadow-2xl flex flex-col">
              
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

                      {/* ESTADO 'MAIN': PANTALLA PRINCIPAL (Pág 1 / Pág 2) */}
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
                            <span>ESC = Menú DATO</span>
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'DATO_MENU': MENÚ DATO (1. TRABAJO, 2. DATOS CONOCIDOS, 3. EXPORTAR A USB) */}
                      {screenState === 'DATO_MENU' && (
                        <div className="space-y-1 font-mono text-xs">
                          <div className="font-bold border-b border-neutral-800/30 text-center pb-0.5 uppercase tracking-wide">
                            --- MENÚ DATO ---
                          </div>
                          {[
                            { id: 1, label: '1. TRABAJO' },
                            { id: 2, label: '2. DATOS CONOCIDOS' },
                            { id: 3, label: '3. EXPORTAR A USB' }
                          ].map(item => (
                            <div
                              key={item.id}
                              onClick={() => {
                                setMenuSelection(item.id);
                                if (item.id === 1) { setScreenState('JOB'); setInputBuffer(jobName); }
                                else if (item.id === 2) { setScreenState('KNOWN_PTS'); setViewPointIdx(0); }
                                else if (item.id === 3) { exportarAUSB(); }
                              }}
                              className={`px-2 py-0.5 rounded cursor-pointer flex items-center justify-between ${
                                menuSelection === item.id ? 'bg-neutral-900 text-[#9CA3AF] font-black' : 'hover:bg-black/10'
                              }`}
                            >
                              <span>{item.label}</span>
                              {menuSelection === item.id && <span>[ENT]</span>}
                            </div>
                          ))}
                          <div className="text-[10px] text-neutral-700 text-center pt-0.5 font-sans">
                            Seleccione opción y pulse [ENT]
                          </div>
                        </div>
                      )}

                      {/* ESTADO 'JOB': EDICIÓN ALFANUMÉRICA DEL NOMBRE DE PROYECTO */}
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

                      {/* ESTADO 'KNOWN_PTS': VISOR ON-BOARD DE MEMORIA INTERNA */}
                      {screenState === 'KNOWN_PTS' && (
                        <div className="space-y-0.5 font-mono text-xs">
                          <div className="font-bold text-[11px] border-b border-neutral-800/30 flex justify-between pb-0.5">
                            <span>DATOS CONOCIDOS</span>
                            <span className="text-[10px] font-bold">[{viewPointIdx + 1}/{points.length}]</span>
                          </div>
                          {points.length === 0 ? (
                            <div className="text-center py-4 text-neutral-700 font-sans">Sin puntos en memoria</div>
                          ) : (
                            <div className="space-y-0.5 bg-black/5 p-1 rounded">
                              <div className="flex justify-between font-bold">
                                <span>PTO: {points[viewPointIdx].PTO}</span>
                                <span>CD: {points[viewPointIdx].CD}</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>N: {points[viewPointIdx].N.toFixed(3)}</span>
                                <span>E: {points[viewPointIdx].E.toFixed(3)}</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>Z: {points[viewPointIdx].Z.toFixed(3)}</span>
                                <span className="uppercase text-[10px] font-sans">({points[viewPointIdx].type || 'RAD'})</span>
                              </div>
                            </div>
                          )}
                          <div className="text-[10px] text-neutral-700 text-center pt-0.5 font-sans">
                            Flechas ▲ / ▼ para navegar puntos
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
                            <span className="text-[10px] font-normal">F3=[E.RXYZ]</span>
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
                            <span className="text-[10px] font-black">F4=[OK]</span>
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
                            Presione [F4] OK para calcular Azimut Inicial
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

            {/* BOTONERA FÍSICA CON RELIEVE Y SOMBRAS */}
            <div className="bg-neutral-900 p-4 rounded-2xl border-2 border-neutral-800 shadow-2xl flex flex-col gap-3">
              
              {/* FILA SUPERIOR: [F1] [F2] [F3] [F4] */}
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map(num => (
                  <button
                    key={num}
                    onClick={() => handleFKey(num as 1 | 2 | 3 | 4)}
                    className="h-10 bg-gradient-to-b from-neutral-700 to-neutral-800 hover:from-neutral-600 hover:to-neutral-700 active:from-neutral-900 active:to-neutral-950 text-amber-300 font-bold text-xs rounded-lg shadow-md border-b-4 border-r border-neutral-950 active:border-b active:translate-y-0.5 transition-all flex flex-col items-center justify-center cursor-pointer"
                  >
                    <span>F{num}</span>
                    <span className="text-[9px] text-slate-300 font-normal">
                      {fLabels[num - 1] || '•'}
                    </span>
                  </button>
                ))}
              </div>

              {/* BARRA ALFANUMÉRICA COMPACTA (Desplegada en campos de texto) */}
              {(isCurrentFieldAlpha || isAlphaKeyboardOpen) && (
                <div className="bg-neutral-950 p-2 rounded-xl border border-neutral-800 space-y-1 animate-in fade-in">
                  <div className="flex justify-between items-center text-[10px] text-amber-400 font-bold px-1">
                    <span>TECLADO ALFANUMÉRICO ACTIVO</span>
                    <span className="text-slate-400 text-[9px]">SFT alterna</span>
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

              {/* SECCIÓN INFERIOR: TECLADO NUMÉRICO (IZQ) Y FLECHAS CON ENTER AZUL (DER) */}
              <div className="grid grid-cols-12 gap-3 pt-1">
                
                {/* LADO IZQUIERDO: SISTEMA + NUMÉRICO (7 cols) */}
                <div className="col-span-7 flex flex-col gap-2">
                  
                  {/* Botones de sistema grises: [ESC], [BS], [SFT], [FUNC] */}
                  <div className="grid grid-cols-4 gap-1.5">
                    <button
                      onClick={handleEscPress}
                      className="h-8 bg-neutral-600 hover:bg-neutral-500 active:bg-neutral-700 text-white font-bold text-[10px] rounded shadow-md border-b-2 border-neutral-800 active:border-b-0 active:translate-y-0.5 transition-all cursor-pointer"
                      title="ESC: Salir o ir a Menú DATO"
                    >
                      ESC
                    </button>
                    <button
                      onClick={() => handleKeypadPress('BS')}
                      className="h-8 bg-neutral-600 hover:bg-neutral-500 active:bg-neutral-700 text-white font-bold text-[10px] rounded shadow-md border-b-2 border-neutral-800 active:border-b-0 active:translate-y-0.5 transition-all cursor-pointer"
                      title="Backspace / Borrar carácter"
                    >
                      BS
                    </button>
                    <button
                      onClick={handleShiftPress}
                      className="h-8 bg-neutral-600 hover:bg-neutral-500 active:bg-neutral-700 text-amber-300 font-bold text-[10px] rounded shadow-md border-b-2 border-neutral-800 active:border-b-0 active:translate-y-0.5 transition-all cursor-pointer"
                      title="Shift: Ciclar modo Prisma / Tarjeta / Directa"
                    >
                      SFT
                    </button>
                    <button
                      onClick={handleFuncPress}
                      className="h-8 bg-neutral-600 hover:bg-neutral-500 active:bg-neutral-700 text-amber-300 font-bold text-[10px] rounded shadow-md border-b-2 border-neutral-800 active:border-b-0 active:translate-y-0.5 transition-all cursor-pointer"
                      title="FUNC: Alternar Pág 1 / Pág 2"
                    >
                      FUNC
                    </button>
                  </div>

                  {/* Teclado numérico, punto y signo negativo */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '-'].map(key => (
                      <button
                        key={key}
                        onClick={() => handleKeypadPress(key)}
                        className="h-9 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-white font-mono font-bold text-sm rounded shadow-md border-b-2 border-r border-neutral-950 active:border-b-0 active:translate-y-0.5 transition-all flex items-center justify-center cursor-pointer"
                      >
                        {key}
                      </button>
                    ))}
                  </div>
                </div>

                {/* LADO DERECHO: FLECHAS EN CRUZ + BOTÓN ENTER AZUL (5 cols) */}
                <div className="col-span-5 flex flex-col items-center justify-center gap-1.5 p-1 bg-neutral-950/60 rounded-xl border border-neutral-800">
                  
                  {/* Flecha ARRIBA */}
                  <button
                    onClick={() => handleArrow('UP')}
                    className="w-10 h-8 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-slate-300 rounded shadow-md border-b-2 border-neutral-950 active:border-b-0 active:translate-y-0.5 flex items-center justify-center cursor-pointer"
                    title="Navegar Arriba"
                  >
                    ▲
                  </button>

                  {/* Fila Central: IZQ - ENTER AZUL - DER */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleArrow('LEFT')}
                      className="w-8 h-10 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-slate-300 rounded shadow-md border-b-2 border-neutral-950 active:border-b-0 active:translate-y-0.5 flex items-center justify-center cursor-pointer"
                      title="Navegar Izquierda"
                    >
                      ◄
                    </button>

                    {/* BOTÓN ENTER CENTRAL EN COLOR AZUL (Distintivo Topcon ES) */}
                    <button
                      onClick={handleEnterPress}
                      className="w-12 h-12 bg-gradient-to-b from-blue-500 via-blue-600 to-blue-700 hover:from-blue-400 hover:to-blue-600 active:from-blue-800 active:to-blue-900 text-white font-black text-xs rounded-full shadow-lg border-b-4 border-r-2 border-blue-950 active:border-b active:translate-y-0.5 transition-all flex flex-col items-center justify-center cursor-pointer"
                      title="Aceptar / Confirmar (Enter)"
                    >
                      <span>ENT</span>
                    </button>

                    <button
                      onClick={() => handleArrow('RIGHT')}
                      className="w-8 h-10 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-slate-300 rounded shadow-md border-b-2 border-neutral-950 active:border-b-0 active:translate-y-0.5 flex items-center justify-center cursor-pointer"
                      title="Navegar Derecha"
                    >
                      ►
                    </button>
                  </div>

                  {/* Flecha ABAJO */}
                  <button
                    onClick={() => handleArrow('DOWN')}
                    className="w-10 h-8 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-slate-300 rounded shadow-md border-b-2 border-neutral-950 active:border-b-0 active:translate-y-0.5 flex items-center justify-center cursor-pointer"
                    title="Navegar Abajo"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* Pie de chasis con estado de nivel */}
              <div className="flex items-center justify-between pt-1 border-t border-neutral-800/80 text-[10px] text-neutral-400">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  Compensador Dual Activo
                </span>
                <span className="font-mono text-[9px] text-neutral-500">
                  TOPCON CORP. TOKYO
                </span>
              </div>
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
