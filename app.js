// app.js - Version final Tema 5.3 (Background Sync + postMessage + fallback)

const API_URL = 'https://jsonplaceholder.typicode.com/posts';

const form = document.getElementById('form-incidencia');
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const listaOutbox = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');

if ('serviceWorker' in navigator) {
  // Escuchar los avisos que manda sw.js cuando termina de sincronizar
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });

  // Registro del Service Worker (ruta relativa para GitHub Pages)
  navigator.serviceWorker.register('./sw.js')
    .then((reg) => {
      console.log('[SW] Registrado con scope:', reg.scope);
    })
    .catch((error) => {
      console.error('[SW] Error al registrar:', error);
    });
}

// Indicador de red en el header
function actualizarIndicadorRed() {
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

// Formatear la fecha a hora legible
function formatearHora(timestamp) {
  const fecha = new Date(timestamp);
  return fecha.toLocaleString('es-MX');
}

// READ: dibujar la cola de IndexedDB en pantalla
function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      listaOutbox.innerHTML = '';

      if (registros.length === 0) {
        listaOutbox.innerHTML = '<li class="vacio">No hay registros en la bandeja.</li>';
        return;
      }

      registros.forEach((item) => {
        const li = document.createElement('li');
        li.className = item.estado;
        li.innerHTML = `
          <div>
            <strong>#${item.id} - ${item.titulo}</strong>
            <span class="hora">${formatearHora(item.fechaCreacion)}</span>
          </div>
          <span class="estado ${item.estado}">${item.estado}</span>
        `;
        listaOutbox.appendChild(li);
      });
    })
    .catch((error) => {
      console.error('Error al leer IndexedDB:', error);
    });
}

// CREATE: intentar enviar; si falla, guardar como pendiente y registrar sync
function procesarEnvioReporte(datosFormulario) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Se envio bien: guardar en bitacora local como sincronizado
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Si el navegador soporta Background Sync, le dejamos el trabajo al SW
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              })
              .catch((error) => {
                console.error('[Outbox] No se pudo registrar el sync:', error);
              });
          }
        });
    })
    .then(() => {
      return renderizarColaOutbox();
    });
}

// Fallback (antes sincronizarPendientes): solo para navegadores sin SyncManager
function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// Envio del formulario
form.addEventListener('submit', (e) => {
  e.preventDefault();

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  procesarEnvioReporte(datos)
    .then(() => {
      form.reset();
    })
    .catch((error) => {
      console.error('Error al procesar el reporte:', error);
    });
});

// DELETE: purgar los registros ya sincronizados
btnPurgar.addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      const promesasBorrado = sincronizados.map((item) => eliminarRegistro(item.id));
      return Promise.all(promesasBorrado);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('Error al purgar registros:', error);
    });
});

// Eventos de red
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradacion elegante: solo sincronizar desde la UI si NO hay SyncManager (Safari/iOS, Firefox)
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// Al cargar la pagina: rescatar lo que hay en IndexedDB
actualizarIndicadorRed();
renderizarColaOutbox();
