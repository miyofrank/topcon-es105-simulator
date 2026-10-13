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
  LogOut,
  ArrowLeft
} from 'lucide-react';

interface AuthWrapperProps {
  children: ReactNode;
}

export const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  // 1. Estado de Sesión y Modo
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [isLoginMode, setIsLoginMode] = useState<boolean>(true);

  // 1B. Recuperación de contraseña: 'main' = Login/Registro, 'forgot' = pedir enlace, 'reset' = nueva contraseña
  const [resetToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get('reset_token'));
  const [authView, setAuthView] = useState<'main' | 'forgot' | 'reset'>(() =>
    new URLSearchParams(window.location.search).get('reset_token') ? 'reset' : 'main'
  );
  const [confirmPassword, setConfirmPassword] = useState<string>('');

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

  // Si existe el token (y no se está abriendo un enlace de recuperación), retorna la app con el botón de Cerrar Sesión
  if (token && authView !== 'reset') {
    return (
      <>
        {/* Botón Flotante y Discreto de Cerrar Sesión */}
        <aside aria-label="Control de Sesión" className="fixed top-2.5 right-3 z-50">
          <button
            onClick={handleLogout}
            title="Cerrar Sesión del Simulador"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FAF8F5]/95 hover:bg-white text-[#544E43] hover:text-[#945F03] border border-[#DDD6C7] hover:border-[#D99414] text-xs font-semibold backdrop-blur-md shadow-md transition-all duration-200 cursor-pointer group"
          >
            <LogOut size={13} className="text-[#8C8373] group-hover:text-[#D99414] transition-colors" />
            <span>Cerrar Sesión</span>
          </button>
        </aside>
        {children}
      </>
    );
  }

  // Función auxiliar robusta para realizar peticiones a la API con fallback y lectura segura de JSON
  const sendApiRequest = async (endpoint: string, body: Record<string, unknown>) => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(body)
      });

      // Si da 404 en la ruta relativa /api (ej. en Vite dev sin proxy activo), reintentar directamente a http://localhost:8000
      if (response.status === 404 && endpoint.startsWith('/api')) {
        try {
          const directRes = await fetch(`http://localhost:8000${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(body)
          });
          if (directRes.ok || directRes.status !== 404) {
            response = directRes;
          }
        } catch {
          // Mantener la respuesta original si el fallback no responde
        }
      }
    } catch {
      // Si la conexión falló a nivel red con /api, intentar conectar directamente con http://localhost:8000
      if (endpoint.startsWith('/api')) {
        try {
          response = await fetch(`http://localhost:8000${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(body)
          });
        } catch {
          throw new Error('No se pudo conectar con el servidor de autenticación (http://localhost:8000). Asegúrate de que el backend esté encendido.');
        }
      } else {
        throw new Error('No se pudo conectar con el servidor de autenticación.');
      }
    }

    // Lectura segura del cuerpo como texto para evitar "Unexpected end of JSON input"
    const responseText = await response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = {};
    if (responseText && responseText.trim().length > 0) {
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { message: responseText };
      }
    }

    if (!response.ok) {
      const errorDetail = Array.isArray(data?.detail)
        ? data.detail.map((item: { msg?: string }) => item.msg || 'Dato inválido').join(', ')
        : (typeof data?.detail === 'string'
            ? data.detail
            : (data?.message || data?.error || (response.status === 401 ? 'Credenciales inválidas. Verifica tu correo y contraseña.' : (response.status === 404 ? 'Servicio no encontrado (/api). Verifica la conexión con el backend.' : `Error del servidor (${response.status})`))));
      throw new Error(errorDetail);
    }

    return data;
  };

  // Petición de Inicio de Sesión (Login)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const data = await sendApiRequest('/api/login', { email, password });

      const receivedToken = data.access_token || data.token;
      if (!receivedToken) {
        throw new Error('Respuesta inválida del servidor: no se recibió access_token');
      }

      if (data.nombre) {
        localStorage.setItem('user_name', data.nombre);
      }

      localStorage.setItem('token', receivedToken);
      setToken(receivedToken);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('No se pudo conectar con el servidor');
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
      const data = await sendApiRequest('/api/register', {
        nombre,
        name: nombre,
        email,
        password,
        codigo_invitacion: codigoInvitacion,
        auth_code: codigoInvitacion
      });

      // Registro exitoso: cambiar a modo Login y mostrar mensaje de éxito
      setIsLoginMode(true);
      setSuccessMessage(data.mensaje || data.message || '¡Cuenta creada con éxito! Ya puedes iniciar sesión con tus credenciales.');
      setPassword('');
      setCodigoInvitacion('');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('No se pudo conectar con el servidor');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Solicitar enlace de recuperación por correo
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);
    try {
      const data = await sendApiRequest('/api/forgot-password', { email });
      setSuccessMessage(
        data.mensaje || 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.'
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo conectar con el servidor');
    } finally {
      setIsLoading(false);
    }
  };

  // Guardar la nueva contraseña usando el token del enlace
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    if (password.length < 8) {
      setErrorMessage('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Las contraseñas no coinciden.');
      return;
    }
    setIsLoading(true);
    try {
      const data = await sendApiRequest('/api/reset-password', {
        token: resetToken,
        new_password: password
      });
      // Limpiar el token de la URL y volver al login
      window.history.replaceState({}, '', window.location.pathname);
      localStorage.removeItem('token');
      setToken(null);
      setPassword('');
      setConfirmPassword('');
      setAuthView('main');
      setIsLoginMode(true);
      setSuccessMessage(data.mensaje || 'Contraseña actualizada. Ya puedes iniciar sesión.');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo conectar con el servidor');
    } finally {
      setIsLoading(false);
    }
  };

  const volverAlLogin = () => {
    window.history.replaceState({}, '', window.location.pathname);
    setAuthView('main');
    setIsLoginMode(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setPassword('');
    setConfirmPassword('');
  };

  const inputClass =
    'w-full bg-white text-[#26231E] border border-[#DCD5C6] focus:border-[#D99414] focus:ring-2 focus:ring-[#D99414]/20 rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-all placeholder:text-[#9C9485] shadow-xs';
  const primaryButtonClass =
    'w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-[#D99414] to-[#DF961A] hover:from-[#C8850A] hover:to-[#D48806] text-white font-black text-xs tracking-wider uppercase shadow-[0_4px_16px_rgba(217,148,20,0.35)] hover:shadow-[0_6px_22px_rgba(217,148,20,0.45)] hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2';

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-[#F3EFE7] text-[#26231E] font-sans relative overflow-hidden select-none">
      
      {/* Fondos desenfocados ambientales en esquinas opuestas (Tono Mostaza y Crema Pastel) */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-[#D99414]/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-[#E8DCC4]/60 rounded-full blur-3xl pointer-events-none" />

      {/* Tarjeta Glassmorphism Flotante en Tono Pastel Crema */}
      <div className="relative w-full max-w-md bg-[#FAF8F5]/95 backdrop-blur-xl border border-[#E2DDD1] shadow-[0_12px_45px_-10px_rgba(74,68,56,0.14)] rounded-3xl p-8 transition-all duration-300 z-10">
        
        {/* Cabecera con Logo Oficial Topcon ES-105 y Título Dinámico */}
        <div className="flex flex-col items-center text-center space-y-3 mb-6">
          <div className="relative group">
            <img
              src="/topcon-logo.jpg"
              alt="Topcon ES-105 Total Station"
              className="w-24 h-24 rounded-full object-cover shadow-lg border-2 border-[#D99414] ring-4 ring-[#F3EFE7] transition-transform duration-300 group-hover:scale-105"
            />
          </div>

          <div>
            <h1 className="text-2xl font-black tracking-tight text-[#26231E]">
              {authView === 'forgot'
                ? 'Recuperar Contraseña'
                : authView === 'reset'
                  ? 'Nueva Contraseña'
                  : isLoginMode ? 'Acceso al Simulador' : 'Crear Cuenta'}
            </h1>
            <p className="text-xs text-[#6B6355] pt-1">
              {authView === 'forgot'
                ? 'Te enviaremos un enlace a tu correo para crear una nueva contraseña'
                : authView === 'reset'
                  ? 'Escribe tu nueva contraseña para el simulador'
                  : isLoginMode
                    ? 'Estación Total Topcon ES-105 • Sistema Académico'
                    : 'Registro de operador con código de autorización'}
            </p>
          </div>
        </div>

        {/* Pestañas de Alternancia (Tabs) en tonos pastel con acento mostaza */}
        {authView === 'main' && (
        <div className="flex bg-[#EFEAE0] p-1 rounded-2xl border border-[#E2DDD1] mb-6 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setIsLoginMode(true);
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
              isLoginMode
                ? 'bg-white text-[#945F03] border border-[#D99414]/40 font-bold shadow-xs'
                : 'text-[#6B6355] hover:text-[#26231E]'
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
                ? 'bg-white text-[#945F03] border border-[#D99414]/40 font-bold shadow-xs'
                : 'text-[#6B6355] hover:text-[#26231E]'
            }`}
          >
            Crear Cuenta
          </button>
        </div>
        )}

        {/* Alerta de Error */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2.5">
            <AlertCircle size={16} className="shrink-0 text-rose-500" />
            <span className="leading-tight">{errorMessage}</span>
          </div>
        )}

        {/* Alerta de Éxito */}
        {successMessage && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
            <span className="leading-tight">{successMessage}</span>
          </div>
        )}

        {/* Formulario: Solicitar enlace de recuperación */}
        {authView === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-[#544E43] uppercase tracking-wider block">
                Correo Electrónico
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C8373]" />
                <input
                  type="email"
                  required
                  placeholder="operador@topografia.edu"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <button type="submit" disabled={isLoading} className={primaryButtonClass}>
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Enviando...</span>
                </>
              ) : (
                <>
                  <span>Enviar enlace</span>
                  <ArrowRight size={15} className="stroke-[2.5]" />
                </>
              )}
            </button>
            <button
              type="button"
              onClick={volverAlLogin}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#6B6355] hover:text-[#945F03] cursor-pointer"
            >
              <ArrowLeft size={13} /> Volver a Iniciar Sesión
            </button>
          </form>
        )}

        {/* Formulario: Crear nueva contraseña (desde el enlace del correo) */}
        {authView === 'reset' && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-[#544E43] uppercase tracking-wider block">
                Nueva Contraseña
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C8373]" />
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-[#544E43] uppercase tracking-wider block">
                Confirmar Contraseña
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C8373]" />
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Repite la contraseña"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <button type="submit" disabled={isLoading} className={primaryButtonClass}>
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <span>Guardar contraseña</span>
                  <ArrowRight size={15} className="stroke-[2.5]" />
                </>
              )}
            </button>
            <button
              type="button"
              onClick={volverAlLogin}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#6B6355] hover:text-[#945F03] cursor-pointer"
            >
              <ArrowLeft size={13} /> Volver a Iniciar Sesión
            </button>
          </form>
        )}

        {/* Formulario */}
        {authView === 'main' && (
        <form onSubmit={isLoginMode ? handleLogin : handleRegister} className="space-y-4">
          
          {/* Campo Nombre (Solo en Modo Registro) */}
          {!isLoginMode && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-[#544E43] uppercase tracking-wider block">
                Nombre Completo
              </label>
              <div className="relative">
                <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C8373]" />
                <input
                  type="text"
                  required
                  placeholder="Ing. Topógrafo"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  className="w-full bg-white text-[#26231E] border border-[#DCD5C6] focus:border-[#D99414] focus:ring-2 focus:ring-[#D99414]/20 rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-all placeholder:text-[#9C9485] shadow-xs"
                />
              </div>
            </div>
          )}

          {/* Campo Email */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#544E43] uppercase tracking-wider block">
              Correo Electrónico
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C8373]" />
              <input
                type="email"
                required
                placeholder="operador@topografia.edu"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-white text-[#26231E] border border-[#DCD5C6] focus:border-[#D99414] focus:ring-2 focus:ring-[#D99414]/20 rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-all placeholder:text-[#9C9485] shadow-xs"
              />
            </div>
          </div>

          {/* Campo Contraseña */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#544E43] uppercase tracking-wider block">
              Contraseña
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C8373]" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-white text-[#26231E] border border-[#DCD5C6] focus:border-[#D99414] focus:ring-2 focus:ring-[#D99414]/20 rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none transition-all placeholder:text-[#9C9485] shadow-xs"
              />
            </div>
            {isLoginMode && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setAuthView('forgot');
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className="text-[11px] font-semibold text-[#945F03] hover:text-[#D99414] hover:underline cursor-pointer"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            )}
          </div>

          {/* Campo Especial: Código de Autorización (Solo en Modo Registro) */}
          {!isLoginMode && (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-bold text-[#945F03] uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound size={13} className="text-[#D99414]" />
                  Código de Autorización
                </label>
                <span className="text-[9px] bg-[#D99414]/15 text-[#945F03] border border-[#D99414]/30 px-1.5 py-0.2 rounded font-mono font-bold">
                  REQUERIDO
                </span>
              </div>
              <div className="relative">
                <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#D99414]" />
                <input
                  type="text"
                  required
                  placeholder="Ej. ES105-GEO-2026"
                  value={codigoInvitacion}
                  onChange={e => setCodigoInvitacion(e.target.value)}
                  className="w-full bg-[#FFFBF0] border border-[#D99414]/40 text-[#734A02] focus:border-[#D99414] focus:ring-2 focus:ring-[#D99414]/20 rounded-xl pl-10 pr-4 py-2.5 text-xs font-mono font-bold outline-none transition-all placeholder:text-[#B57404]/50 shadow-inner"
                />
              </div>
              <p className="text-[10px] text-[#6B6355] italic">
                Código institucional para habilitación de la consola.
              </p>
            </div>
          )}

          {/* Botón Principal de Acción (Color Mostaza Topcon) */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-[#D99414] to-[#DF961A] hover:from-[#C8850A] hover:to-[#D48806] text-white font-black text-xs tracking-wider uppercase shadow-[0_4px_16px_rgba(217,148,20,0.35)] hover:shadow-[0_6px_22px_rgba(217,148,20,0.45)] hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
        )}

        {/* Pie de Tarjeta */}
        <div className="mt-6 pt-4 border-t border-[#E8E2D5] text-center text-[10px] text-[#8C8373] flex justify-between items-center font-mono">
          <span>TOPCON ES-105 STATION</span>
          <span className="text-[#544E43] font-bold">ON-BOARD OS</span>
        </div>
      </div>
    </div>
  );
};

export default AuthWrapper;
