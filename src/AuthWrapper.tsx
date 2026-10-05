import React, { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Lock,
  Mail,
  User,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowRight,
  LogOut
} from 'lucide-react';

interface AuthWrapperProps {
  children: ReactNode;
}

export const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  // 1. Estado de Sesión y Modo
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [isLoginMode, setIsLoginMode] = useState<boolean>(true);

  // 2. Estados de Formulario
  const [nombre, setNombre] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [codigoInvitacion, setCodigoInvitacion] = useState<string>('');

  // 3. Feedback Visual y Carga
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Función para Cerrar Sesión
  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    window.location.reload();
  };

  // Si existe el token, retorna la app envuelta con el botón flotante discreto de Cerrar Sesión
  if (token) {
    return (
      <>
        {/* Botón Flotante y Discreto de Cerrar Sesión */}
        <aside aria-label="Control de Sesión" className="fixed top-2.5 right-3 z-50">
          <button
            onClick={handleLogout}
            title="Cerrar Sesión del Simulador"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-900/80 hover:bg-neutral-800 text-neutral-400 hover:text-amber-400 border border-neutral-700/60 hover:border-amber-500/40 text-xs font-semibold backdrop-blur-md shadow-lg transition-all duration-200 cursor-pointer group"
          >
            <LogOut size={13} className="text-neutral-400 group-hover:text-amber-400 transition-colors" />
            <span>Cerrar Sesión</span>
          </button>
        </aside>
        {children}
      </>
    );
  }

  // Petición de Inicio de Sesión (Login)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.message || data.error || 'Credenciales incorrectas o error en el servidor');
      }

      const receivedToken = data.access_token || data.token;
      if (!receivedToken) {
        throw new Error('Respuesta inválida del servidor: no se recibió access_token');
      }

      localStorage.setItem('token', receivedToken);
      setToken(receivedToken);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('No se pudo conectar con el servidor (http://localhost:8000)');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Petición de Registro (Crear Cuenta)
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          nombre,
          name: nombre,
          email,
          password,
          codigo_invitacion: codigoInvitacion,
          auth_code: codigoInvitacion
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.message || data.error || 'No se pudo completar el registro');
      }

      // Registro exitoso: cambiar a modo Login y mostrar mensaje de éxito
      setIsLoginMode(true);
      setSuccessMessage(data.message || '¡Cuenta creada con éxito! Ya puedes iniciar sesión con tus credenciales.');
      setPassword('');
      setCodigoInvitacion('');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('No se pudo conectar con el servidor (http://localhost:8000)');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-slate-950 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 to-slate-950 text-slate-100 font-sans relative overflow-hidden select-none">
      
      {/* Fondos desenfocados ambientales en esquinas opuestas (Profundidad Antigravity) */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Tarjeta Glassmorphism Flotante */}
      <div className="relative w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 shadow-[0_0_50px_-12px_rgba(245,158,11,0.15)] rounded-3xl p-8 transition-all duration-300 z-10">
        
        {/* Cabecera con Logo Tipográfico 'ES' y Título Dinámico */}
        <div className="flex flex-col items-center text-center space-y-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 font-black text-xl flex items-center justify-center shadow-lg shadow-amber-500/25 font-mono">
            ES
          </div>

          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              {isLoginMode ? 'Acceso al Simulador' : 'Crear Cuenta'}
            </h1>
            <p className="text-xs text-neutral-400 pt-1">
              {isLoginMode
                ? 'Estación Total Topcon ES-105 • Sistema Académico'
                : 'Registro de operador con código de autorización'}
            </p>
          </div>
        </div>

        {/* Pestañas de Alternancia (Tabs) */}
        <div className="flex bg-neutral-900/70 p-1 rounded-2xl border border-white/5 mb-6 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setIsLoginMode(true);
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
              isLoginMode
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Iniciar Sesión
          </button>
          <button
            type="button"
            onClick={() => {
              setIsLoginMode(false);
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
              !isLoginMode
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Crear Cuenta
          </button>
        </div>

        {/* Alerta de Error */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
            <AlertCircle size={16} className="shrink-0 text-rose-400" />
            <span className="leading-tight">{errorMessage}</span>
          </div>
        )}

        {/* Alerta de Éxito */}
        {successMessage && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2.5">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
            <span className="leading-tight">{successMessage}</span>
          </div>
        )}

        {/* Formulario */}
        <form onSubmit={isLoginMode ? handleLogin : handleRegister} className="space-y-4">
          
          {/* Campo Nombre (Solo en Modo Registro) */}
          {!isLoginMode && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider block">
                Nombre Completo
              </label>
              <div className="relative">
                <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  required
                  placeholder="Ing. Topógrafo"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  className="w-full bg-black/20 text-white border border-white/10 focus:border-amber-500/50 rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-colors placeholder:text-neutral-500"
                />
              </div>
            </div>
          )}

          {/* Campo Email */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider block">
              Correo Electrónico
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="email"
                required
                placeholder="operador@topografia.edu"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-black/20 text-white border border-white/10 focus:border-amber-500/50 rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-colors placeholder:text-neutral-500"
              />
            </div>
          </div>

          {/* Campo Contraseña */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider block">
              Contraseña
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-black/20 text-white border border-white/10 focus:border-amber-500/50 rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-colors placeholder:text-neutral-500"
              />
            </div>
          </div>

          {/* Campo Especial: Código de Autorización (Solo en Modo Registro) */}
          {!isLoginMode && (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound size={13} className="text-amber-400" />
                  Código de Autorización
                </label>
                <span className="text-[9px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.2 rounded font-mono font-bold">
                  REQUERIDO
                </span>
              </div>
              <div className="relative">
                <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-amber-400/70" />
                <input
                  type="text"
                  required
                  placeholder="Ej. ES105-GEO-2026"
                  value={codigoInvitacion}
                  onChange={e => setCodigoInvitacion(e.target.value)}
                  className="w-full bg-amber-500/5 border border-amber-500/30 text-amber-100 focus:border-amber-400 rounded-xl pl-10 pr-4 py-2.5 text-xs font-mono font-bold outline-none transition-all placeholder:text-amber-500/40 shadow-inner"
                />
              </div>
              <p className="text-[10px] text-neutral-400 italic">
                Código institucional para habilitación de la consola.
              </p>
            </div>
          )}

          {/* Botón Principal de Acción */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 font-black text-xs tracking-wider uppercase shadow-[0_0_25px_rgba(245,158,11,0.25)] hover:shadow-[0_0_35px_rgba(245,158,11,0.45)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Procesando...</span>
              </>
            ) : (
              <>
                <span>{isLoginMode ? 'Ingresar a la Estación' : 'Registrar y Habilitar'}</span>
                <ArrowRight size={15} className="stroke-[2.5]" />
              </>
            )}
          </button>
        </form>

        {/* Pie de Tarjeta */}
        <div className="mt-6 pt-4 border-t border-white/5 text-center text-[10px] text-neutral-500 flex justify-between items-center font-mono">
          <span>TOPCON ES-105 STATION</span>
          <span className="text-neutral-400 font-bold">ON-BOARD OS</span>
        </div>
      </div>
    </div>
  );
};

export default AuthWrapper;
