import React, { useState } from 'react';
import type { ReactNode } from 'react';
import { Lock, Mail, User, KeyRound, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

interface AuthWrapperProps {
  children: ReactNode;
}

export const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  // 1. Estado de Token y Modo
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [isLoginMode, setIsLoginMode] = useState<boolean>(true);

  // 2. Campos del Formulario
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [authCode, setAuthCode] = useState<string>('');

  // 3. Estados de Carga y Feedback
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Si ya existe sesión activa, renderiza directamente el simulador
  if (token) {
    return <>{children}</>;
  }

  // Petición de Inicio de Sesión
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
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
        throw new Error(data.detail || data.message || data.error || 'Credenciales incorrectas o error en servidor');
      }

      const receivedToken = data.access_token || data.token;
      if (!receivedToken) {
        throw new Error('Respuesta inválida: no se recibió access_token');
      }

      localStorage.setItem('token', receivedToken);
      setToken(receivedToken);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Error al conectar con http://localhost:8000');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Petición de Registro
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          name,
          email,
          password,
          auth_code: authCode,
          code: authCode
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.message || data.error || 'No se pudo completar el registro');
      }

      const receivedToken = data.access_token || data.token;
      if (receivedToken) {
        localStorage.setItem('token', receivedToken);
        setToken(receivedToken);
      } else {
        // Si el registro no retorna token inmediato, pasa a Login con mensaje
        setIsLoginMode(true);
        setErrorMessage(null);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Error al conectar con http://localhost:8000');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-slate-950 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 to-slate-950 text-slate-100 font-sans relative overflow-hidden select-none">
      
      {/* Resplandor ambiental flotante (Efecto Antigravity) */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-orange-600/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Tarjeta Glassmorphic Flotante */}
      <div className="relative w-full max-w-md bg-white/5 backdrop-blur-md border border-white/10 shadow-[0_0_40px_-10px_rgba(245,158,11,0.15)] rounded-3xl p-8 transition-all duration-300 z-10">
        
        {/* Cabecera Industrial Topcon */}
        <div className="text-center space-y-2 mb-6">
          <div className="inline-flex items-center gap-2 bg-neutral-900/80 border border-neutral-800 px-3 py-1 rounded-full shadow-inner">
            <span className="bg-amber-500 text-slate-950 font-black px-2 py-0.5 rounded text-[10px] tracking-wider uppercase shadow">
              TOPCON
            </span>
            <span className="text-xs font-mono font-bold text-neutral-300">
              ES-105 SYSTEM
            </span>
          </div>

          <h1 className="text-2xl font-black tracking-tight text-white pt-1">
            {isLoginMode ? 'Iniciar Sesión' : 'Registro de Operador'}
          </h1>
          <p className="text-xs text-neutral-400">
            {isLoginMode
              ? 'Accede a la consola de control y simulación topográfica'
              : 'Completa tus datos y código de estación para registrarte'}
          </p>
        </div>

        {/* Pestañas de Alternancia (Tabs) */}
        <div className="flex bg-neutral-900/70 p-1 rounded-2xl border border-white/5 mb-6 text-xs font-semibold">
          <button
            type="button"
            onClick={() => { setIsLoginMode(true); setErrorMessage(null); }}
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
            onClick={() => { setIsLoginMode(false); setErrorMessage(null); }}
            className={`flex-1 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
              !isLoginMode
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Registrarse
          </button>
        </div>

        {/* Mensaje de Error */}
        {errorMessage && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5 animate-fadeIn">
            <AlertCircle size={16} className="shrink-0 text-rose-400" />
            <span className="leading-tight">{errorMessage}</span>
          </div>
        )}

        {/* Formulario */}
        <form onSubmit={isLoginMode ? handleLogin : handleRegister} className="space-y-4">
          
          {/* Campo Nombre (Solo Registro) */}
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
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 focus:border-amber-500 text-white rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-colors placeholder:text-neutral-500"
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
                className="w-full bg-white/5 border border-white/10 focus:border-amber-500 text-white rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-colors placeholder:text-neutral-500"
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
                className="w-full bg-white/5 border border-white/10 focus:border-amber-500 text-white rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-colors placeholder:text-neutral-500"
              />
            </div>
          </div>

          {/* Campo Código de Autorización (Solo Registro - Resaltado Especial) */}
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
                <input
                  type="text"
                  required
                  placeholder="Ej. ES105-GEO-2026"
                  value={authCode}
                  onChange={e => setAuthCode(e.target.value)}
                  className="w-full bg-amber-500/5 border border-amber-500/40 focus:border-amber-400 text-amber-200 rounded-xl px-4 py-2.5 text-xs font-mono font-bold outline-none transition-all placeholder:text-amber-500/40 shadow-inner"
                />
              </div>
              <p className="text-[10px] text-neutral-400 italic">
                Clave de acceso institucional para habilitar la estación.
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
        <div className="mt-6 pt-4 border-t border-white/5 text-center text-[10px] text-neutral-500 flex justify-between items-center">
          <span>Topcon ES Series Total Station</span>
          <span className="font-mono text-neutral-400">v2.57</span>
        </div>
      </div>
    </div>
  );
};

export default AuthWrapper;
