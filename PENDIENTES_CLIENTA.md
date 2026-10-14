# Pendientes con la clienta — Simulador Topcon ES-105

Lista de decisiones tomadas de forma provisional y de funciones grandes que se dejaron para más adelante.
Actualizado: 14-10-2026.

## 1. Por confirmar con la clienta

| # | Tema | Qué hace hoy el simulador | Qué hay que confirmar |
|---|------|---------------------------|-----------------------|
| 1 | USB → "Inserte USB / Pulsar Tecla" | Las 6 opciones de Tipo T y Tipo S muestran el aviso. En **Guardar Datos**, al pulsar una tecla se sigue a la elección de trabajo y se descarga el CSV. | ¿Está bien que Guardar Datos siga funcionando así? Si no lo quiere, se revierte y solo queda el aviso. |
| 2 | "AV Rango exced." en MED | La pantalla MED principal ahora dice **AV** (antes AZ), igual que Trisección, MDR y Replanteo en sus fotos. | ¿Confirma que en MED también es AV? |
| 3 | Códigos Cd por defecto | TN, LIN, DREN, TL, CA, PMT, COL, CASE + 255, TAZA, CALLE, ACEQ, V, HITO (leídos de las fotos). | Lista exacta de los 8 códigos que trae su equipo. |
| 4 | EDM página 2 | Orden según su tabla: Luz guía, Temp., Pres., PPm. | Su maqueta mostraba 5. Temp, 6. Pres, 7. PPM. ¿Cuál es el orden real? |
| 5 | Campo HD en Observación | Es la altura del prisma (como en su maqueta). | ¿Es correcto? |
| 6 | Unidades (CNFG) | Se guardan y se muestran, pero no convierten los valores (la presión se sigue mostrando en hPa en Estacionamiento y EDM). | ¿Quiere que al cambiar a mmHg, °F, pie, etc. se conviertan los valores en todas las pantallas? |
| 7 | Burbuja fuera de nivel | MED, AUTO, MDR, ANGUL y la medición de Replanteo mandan a ComPen si X o Y muestran "****". | ¿Debe aplicarse en todas las mediciones o solo en Observación? |
| 8 | Fecha y hora (CNFG) | Se pueden editar en su pantalla, pero Estacionamiento sigue usando el reloj de la computadora. | ¿Debe la fecha/hora editada reemplazar la del reloj? |

## 2. Funciones pesadas anotadas para después

1. **Tecla func → Definir / Registro / Reclamar**: hoy son solo pantallas. Falta que permitan reordenar de verdad las teclas F1–F4 de MED y guardar/cargar esas configuraciones como Usuario1, Usuario2 y Por defecto.
2. **Puntos por trabajo (separar los datos por TRABJ)**: hoy hay una sola lista de puntos para todos los trabajos. En Borrar TRABJ y Salida Comunic. cada trabajo muestra una cantidad **inventada** (como pidió la clienta); solo el trabajo activo muestra sus puntos reales. La mejora sería que cada trabajo guarde sus propios puntos: al cambiar de trabajo se ven solo los suyos, el contador es real, borrar elimina sus puntos y el CSV exporta solo ese trabajo.
3. **Datos guardados al recargar**: los puntos, trabajos y ajustes se pierden al recargar la página (no se guardan en el navegador ni en el backend).
4. **Funciones del menú que solo muestran un mensaje**: Despl/Dist, Despl/Ang, Despl/2D, Despl/Plan, Calc.Área, RePl Línea, RePl Arco, Proyecto-P, Pt.a.Línea, Intersec., Poligonal, Vial, Per.Trans., MER y TSshield.
