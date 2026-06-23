// PWA Service Worker — v12：彻底修复更新流 + 精确URL匹配
// 1) HTML 永远网络优先（不会被缓存拦截）
// 2) SW 自身永远网络优先（避免新 SW 装不上的死锁）
// 3) version.json 永远网络优先
// 4) 其他静态资源 stale-while-revalidate

const CACHE = 'jzb-v12';

// 只预缓存最核心的（保证离线能开）
const PRE_CACHE = [
  './',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
];

// 永远走网络的资源（避免缓存导致代码更新失败）
const NETWORK_ONLY = [
  'index.html',
  'sw.js',
  'version.json',
];

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRE_CACHE))
  );
  // 立即接管，不等旧 SW
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    (async () => {
      // 清理所有旧缓存
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.startsWith('chrome-extension://')) return;

  const url = e.request.url;

  // 解析 pathname 用于精确匹配
  let pathname = '';
  try { pathname = new URL(url).pathname; } catch(_) { pathname = url; }
  const basename = pathname.split('/').pop() || '';

  // 1) index.html / sw.js / version.json → 永远网络优先（精确匹配文件名）
  if (NETWORK_ONLY.some(p => basename === p)) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 2) 根路径 → 网络优先
  if (pathname === '/' || pathname === '' || url.endsWith(self.location.pathname)) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => caches.match('index.html'))
    );
    return;
  }

  // 3) 其他资源（图片、字体、JS 库）→ stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(netRes => {
        if (netRes && netRes.ok) {
          const clone = netRes.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return netRes;
      }).catch(() => null);
      return cached || fetchPromise;
    })
  );
});
