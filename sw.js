// sw.js - Version final Tema 5.3 (App Shell + Background Sync)

// Importar el mini-wrapper de IndexedDB en el contexto del Service Worker
importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v2';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const API_URL = 'https://jsonplaceholder.typicode.com/posts';

// Instalacion: guardar el App Shell en cache
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando', CACHE_STATIC_NAME);
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

// Activacion: borrar caches viejas (ej. static-outbox-v1)
self.addEventListener('activate', (event) => {
  console.log('[SW] Activado');
  event.waitUntil(
    caches.keys()
      .then((nombres) => {
        return Promise.all(
          nombres
            .filter((nombre) => nombre !== CACHE_STATIC_NAME)
            .map((nombre) => caches.delete(nombre))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: cache first para GET; los POST pasan directo a la red
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then((respuesta) => {
        return respuesta || fetch(event.request);
      })
      .catch(() => caches.match('./index.html'))
  );
});

// Avisar a las pestañas abiertas que ya se sincronizo
function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

// Motor de sincronizacion en segundo plano
function sincronizarPendientesSW() {
  console.log('[SW-Sync] Ejecutando barrido de transacciones pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[SW-Sync] Cola limpia. Nada por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.titulo,
            body: item.descripcion
          })
        })
          .then((respuesta) => {
            if (!respuesta.ok) {
              throw new Error(`Error HTTP ${respuesta.status} al sincronizar ID ${item.id}`);
            }
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio)
        .then(() => notificarClientesActualizacion());
    });
}

// Evento sync: el navegador lo dispara cuando detecta conexion
self.addEventListener('sync', (event) => {
  console.log('[SW-Sync] Evento sync disparado con etiqueta:', event.tag);

  if (event.tag === 'sync-reportes') {
    event.waitUntil(
      sincronizarPendientesSW()
        .catch((error) => {
          console.error('[SW-Sync] Falla en sincronización; el navegador reintentará luego:', error);
          // Relanzar el error para que el navegador programe un reintento
          throw error;
        })
    );
  }
});
