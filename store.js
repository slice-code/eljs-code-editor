import { attachJustifiedRowsLayout } from './justified-rows-layout.js';

/** Jumlah item per request — di bawah batas API (maks 50). */
const STORE_PAGE_LIMIT = 24;

/** Lebar minimum viewport untuk grid Store 3 kolom (tanpa justified JS). */
const STORE_DESKTOP_GRID_MQ = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(min-width: 1024px)')
  : { matches: false, addEventListener: function() {} };

export function createStorePage() {
  const refs = {};
  let disposeListLayout = null;
  /** Urutan fetch agar respons lama tidak menimpa hasil pencarian baru. */
  let storeFetchGeneration = 0;
  let loadMoreObserver = null;

  const listState = {
    /** Urutan daftar: `popular` (mirip App Store) atau `latest` — dikirim ke query `sort` API. */
    sort: 'popular',
    keyword: '',
    page: 1,
    total: 0,
    loadedCount: 0,
    hasMore: false,
    loadingMore: false,
    /** Pesan error muat halaman berikutnya; dibersihkan saat fetch sukses atau pencarian baru. */
    loadMoreErrorMsg: '',
    /** Cegah spam request saat sentinel tetap di viewport setelah error. */
    loadMoreCooldownUntil: 0
  };

  function tearDownListLayout() {
    if (disposeListLayout) {
      disposeListLayout();
    }
    disposeListLayout = null;
  }

  function stripStoreGridDesktopClass() {
    if (refs.storeList) refs.storeList.classList.remove('store-list--grid-desktop');
  }

  function detachLoadMoreObserver() {
    if (loadMoreObserver) {
      loadMoreObserver.disconnect();
      loadMoreObserver = null;
    }
  }

  function isStoreDesktopGrid() {
    try {
      return STORE_DESKTOP_GRID_MQ.matches;
    } catch (e) {
      return false;
    }
  }

  /** Hapus posisi absolut dari justified layout saat beralih ke grid desktop. */
  function clearStoreCardsLayoutOverrides(listEl) {
    if (!listEl) return;
    const cards = listEl.querySelectorAll('[data-justified-card]');
    for (let i = 0; i < cards.length; i++) {
      const s = cards[i].style;
      s.removeProperty('position');
      s.removeProperty('left');
      s.removeProperty('top');
      s.removeProperty('width');
      s.removeProperty('height');
      s.removeProperty('margin');
      s.removeProperty('box-sizing');
    }
  }

  /** Cari kontainer scroll vertikal (layout memakai overflow:auto di page content). */
  function findVerticalScrollParent(node) {
    let el = node && node.parentElement;
    while (el) {
      const y = window.getComputedStyle(el).overflowY;
      if (y === 'auto' || y === 'scroll') return el;
      el = el.parentElement;
    }
    return null;
  }

  function attachLoadMoreObserver() {
    detachLoadMoreObserver();
    const sentinel = refs.storeSentinel;
    const listEl = refs.storeList;
    if (!sentinel || !listEl || !listState.hasMore) return;

    const root = findVerticalScrollParent(listEl);
    loadMoreObserver = new IntersectionObserver(
      function(entries) {
        for (let i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          if (!listState.hasMore || listState.loadingMore) continue;
          loadMoreStorePage();
          break;
        }
      },
      { root: root || null, rootMargin: '320px', threshold: 0 }
    );
    loadMoreObserver.observe(sentinel);
  }

  function syncSentinelText() {
    const n = refs.storeSentinel;
    if (!n) return;
    if (listState.loadMoreErrorMsg) {
      n.textContent = listState.loadMoreErrorMsg;
      n.style.color = '#dc2626';
      return;
    }
    if (listState.loadingMore) {
      n.textContent = 'Memuat lebih banyak...';
      n.style.color = '#64748b';
    } else if (!listState.hasMore && listState.loadedCount > 0) {
      n.textContent = '— Akhir daftar —';
      n.style.color = '#cbd5e1';
    } else {
      n.textContent = '';
      n.style.color = '#94a3b8';
    }
  }

  function ensureSentinel() {
    if (!refs.storeList) return;
    if (!refs.storeSentinel || !refs.storeSentinel.isConnected) {
      refs.storeSentinel = document.createElement('div');
      refs.storeSentinel.setAttribute('data-store-sentinel', '1');
      refs.storeSentinel.style.minHeight = '12px';
      refs.storeSentinel.style.padding = '10px 8px';
      refs.storeSentinel.style.textAlign = 'center';
      refs.storeSentinel.style.fontSize = '0.85rem';
    }
    if (refs.storeSentinel.parentNode !== refs.storeList) {
      refs.storeList.appendChild(refs.storeSentinel);
    }
    syncSentinelText();
  }

  function removeSentinel() {
    detachLoadMoreObserver();
    if (refs.storeSentinel && refs.storeSentinel.parentNode) {
      refs.storeSentinel.parentNode.removeChild(refs.storeSentinel);
    }
    refs.storeSentinel = null;
  }

  function formatDate(isoString) {
    try {
      return new Date(isoString).toLocaleString();
    } catch (e) {
      return isoString || '-';
    }
  }

  function getSafeText(text, fallback = '-') {
    const raw = (text || '').trim();
    return raw || fallback;
  }

  function setLoading(message) {
    if (!refs.storeList) return;
    detachLoadMoreObserver();
    removeSentinel();
    tearDownListLayout();
    stripStoreGridDesktopClass();
    el(refs.storeList).empty().child(
      el('div').css({
        border: '1px dashed #cbd5e1',
        borderRadius: '0.85rem',
        background: '#ffffff',
        color: '#64748b',
        padding: '1.1rem'
      }).text(message || 'Loading...')
    ).get();
  }

  function setError(message) {
    if (!refs.storeList) return;
    detachLoadMoreObserver();
    removeSentinel();
    tearDownListLayout();
    stripStoreGridDesktopClass();
    el(refs.storeList).empty().child(
      el('div').css({
        border: '1px solid #fecaca',
        borderRadius: '0.85rem',
        background: '#fff1f2',
        color: '#dc2626',
        padding: '1.1rem'
      }).text(message || 'Failed to load store.')
    ).get();
  }

  function storeCardForItem(item) {
    const title = getSafeText(item.name, 'Untitled Project');
    const description = getSafeText(item.description, 'No description');
    const authorName = getSafeText(item.author && item.author.name, 'Unknown');
    const views = (item.stats && item.stats.views) || 0;
    const likes = (item.stats && item.stats.likes) || 0;
    const publishedDate = formatDate(item.published_at);
    return el('div')
      .attr('data-justified-card', '1')
      .css({
        border: '1px solid #e5e7eb',
        borderRadius: '0.95rem',
        background: '#fff',
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: '0 10px 30px rgba(15,23,42,0.06)',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
      })
      .mouseover(function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = '0 16px 36px rgba(15,23,42,0.12)';
      })
      .mouseout(function() {
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = '0 10px 30px rgba(15,23,42,0.06)';
      })
      .child([
        el('div')
          .css({
            flex: '0 0 42%',
            minHeight: '0',
            maxHeight: '52%',
            overflow: 'hidden',
            background: '#f1f5f9',
            flexShrink: '0'
          })
          .child(
            el('img')
              .attr('src', item.thumbnail_url || './images/todolist.png')
              .attr('alt', item.name || 'thumbnail')
              .css({
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
              })
          ),
        el('div')
          .css({
            flex: '1 1 auto',
            minHeight: '0',
            overflow: 'hidden',
            padding: '0.75rem 0.9rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.2rem'
          })
          .child([
            el('div').text(title).css({
              fontWeight: '700',
              color: '#0f172a',
              marginBottom: '0.35rem',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }),
            el('div').css({ marginBottom: '0.25rem' }).child([
              el('div').text('Description').css({
                fontSize: '0.68rem',
                fontWeight: '700',
                color: '#94a3b8',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: '0.2rem'
              }),
              el('div').text(description).css({
                color: '#475569',
                fontSize: '0.9rem',
                minHeight: '2.8em',
                lineHeight: '1.45',
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              })
            ]),
            el('div')
              .css({
                marginTop: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem'
              })
              .child([
                el('div').css({ fontSize: '0.78rem', color: '#64748b' }).text('by ' + authorName),
                el('div').css({ fontSize: '0.74rem', color: '#94a3b8' }).text(publishedDate)
              ]),
            el('div')
              .css({
                marginTop: '0.55rem',
                display: 'flex',
                gap: '0.45rem',
                flexWrap: 'wrap'
              })
              .child([
                el('span')
                  .css({
                    fontSize: '0.73rem',
                    color: '#334155',
                    background: '#f1f5f9',
                    border: '1px solid #e2e8f0',
                    borderRadius: '999px',
                    padding: '0.2rem 0.45rem'
                  })
                  .text('Views ' + views),
                el('span')
                  .css({
                    fontSize: '0.73rem',
                    color: '#334155',
                    background: '#f1f5f9',
                    border: '1px solid #e2e8f0',
                    borderRadius: '999px',
                    padding: '0.2rem 0.45rem'
                  })
                  .text('Likes ' + likes)
              ])
          ])
      ])
      .click(function() {
        const slug = getSafeText(item.slug, '');
        if (!slug) return;
        window.location.hash = '/store-detail?slug=' + encodeURIComponent(slug);
      });
  }

  function syncStoreSortChips() {
    const sp = refs.sortPopularBtn;
    const sl = refs.sortLatestBtn;
    if (!sp || !sl) return;
    const isPopular = listState.sort === 'popular';
    function apply(btn, active) {
      if (active) {
        btn.style.background = '#0f172a';
        btn.style.color = '#fff';
        btn.style.borderColor = '#0f172a';
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.style.background = '#f8fafc';
        btn.style.color = '#64748b';
        btn.style.borderColor = '#e2e8f0';
        btn.setAttribute('aria-pressed', 'false');
      }
    }
    apply(sp, isPopular);
    apply(sl, !isPopular);
  }

  async function fetchStorePage(page, keyword) {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(STORE_PAGE_LIMIT));
    params.set('sort', listState.sort === 'latest' ? 'latest' : 'popular');
    if (keyword) params.set('search', keyword);
    const res = await fetch('https://slice-code.com/api/editor/store?' + params.toString(), {
      credentials: 'include'
    });
    const body = await res.json();
    if (!res.ok || body.success === false) {
      throw new Error((body && body.error && body.error.message) || body.message || 'Store request failed');
    }
    const items = Array.isArray(body.data) ? body.data : [];
    const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
    const limitFromApi = typeof meta.limit === 'number' && meta.limit > 0 ? meta.limit : STORE_PAGE_LIMIT;
    const totalFromApi = typeof meta.total === 'number' ? meta.total : null;
    return { items, totalFromApi, limitFromApi };
  }

  function applyLayoutAndObserve() {
    const list = refs.storeList;
    if (!list) return;

    tearDownListLayout();

    if (isStoreDesktopGrid()) {
      list.classList.add('store-list--grid-desktop');
      clearStoreCardsLayoutOverrides(list);
      list.style.height = '';
      list.style.position = 'relative';
      disposeListLayout = null;
      attachLoadMoreObserver();
      return;
    }

    list.classList.remove('store-list--grid-desktop');
    clearStoreCardsLayoutOverrides(list);
    const layoutOpts = {
      gap: 14,
      minRowHeight: 112,
      maxRowHeight: 300,
      baseMeasureWidth: 280
    };
    disposeListLayout = attachJustifiedRowsLayout(list, layoutOpts);
    attachLoadMoreObserver();
  }

  async function loadMoreStorePage() {
    const genAtStart = storeFetchGeneration;
    if (Date.now() < listState.loadMoreCooldownUntil) return;
    if (!listState.hasMore || listState.loadingMore) return;
    listState.loadMoreErrorMsg = '';
    listState.loadingMore = true;
    syncSentinelText();
    const nextPage = listState.page + 1;
    try {
      const { items, totalFromApi, limitFromApi } = await fetchStorePage(nextPage, listState.keyword);
      if (genAtStart !== storeFetchGeneration) return;

      if (!items.length) {
        listState.hasMore = false;
        listState.page = nextPage;
        listState.loadMoreErrorMsg = '';
        syncSentinelText();
        detachLoadMoreObserver();
        return;
      }

      listState.loadMoreErrorMsg = '';
      tearDownListLayout();
      for (let i = 0; i < items.length; i++) {
        const before = refs.storeSentinel && refs.storeSentinel.parentNode === refs.storeList ? refs.storeSentinel : null;
        const node = storeCardForItem(items[i]).get();
        if (before) {
          refs.storeList.insertBefore(node, before);
        } else {
          refs.storeList.appendChild(node);
        }
      }

      listState.page = nextPage;
      listState.loadedCount += items.length;
      if (totalFromApi != null) {
        listState.total = totalFromApi;
        listState.hasMore = listState.loadedCount < listState.total;
      } else {
        listState.hasMore = items.length >= limitFromApi;
      }

      ensureSentinel();
      syncSentinelText();
      applyLayoutAndObserve();
    } catch (err) {
      if (genAtStart !== storeFetchGeneration) return;
      listState.loadMoreErrorMsg = 'Gagal memuat — scroll untuk mencoba lagi.';
      listState.loadMoreCooldownUntil = Date.now() + 1800;
      syncSentinelText();
    } finally {
      if (genAtStart === storeFetchGeneration) {
        listState.loadingMore = false;
        syncSentinelText();
      }
    }
  }

  async function loadStoreList(keyword, sortOverride) {
    const kw = typeof keyword === 'string' ? keyword.trim() : '';
    if (sortOverride === 'popular' || sortOverride === 'latest') {
      listState.sort = sortOverride;
    }
    syncStoreSortChips();

    storeFetchGeneration += 1;
    const myGen = storeFetchGeneration;

    listState.keyword = kw;
    listState.page = 1;
    listState.loadedCount = 0;
    listState.total = 0;
    listState.hasMore = false;
    listState.loadingMore = false;
    listState.loadMoreErrorMsg = '';
    listState.loadMoreCooldownUntil = 0;

    setLoading('Loading store...');
    try {
      const { items, totalFromApi, limitFromApi } = await fetchStorePage(1, kw);
      if (myGen !== storeFetchGeneration) return;

      detachLoadMoreObserver();
      removeSentinel();
      tearDownListLayout();

      if (items.length === 0) {
        stripStoreGridDesktopClass();
        el(refs.storeList).empty().child(
          el('div')
            .css({
              border: '1px dashed #cbd5e1',
              borderRadius: '0.85rem',
              background: '#ffffff',
              color: '#64748b',
              padding: '1.1rem'
            })
            .text('Belum ada project publish.')
        ).get();
        return;
      }

      el(refs.storeList).empty();
      for (let i = 0; i < items.length; i++) {
        refs.storeList.appendChild(storeCardForItem(items[i]).get());
      }

      listState.page = 1;
      listState.loadedCount = items.length;
      if (totalFromApi != null) {
        listState.total = totalFromApi;
        listState.hasMore = listState.loadedCount < listState.total;
      } else {
        listState.hasMore = items.length >= limitFromApi;
      }

      ensureSentinel();
      syncSentinelText();
      applyLayoutAndObserve();
    } catch (error) {
      if (myGen !== storeFetchGeneration) return;
      setError('Gagal memuat store: ' + (error.message || error));
    }
  }

  const page = el('div')
    .css({
      width: '100%',
      maxWidth: 'none',
      margin: 0,
      boxSizing: 'border-box',
      padding: 'clamp(0.75rem, 2vw, 1.35rem)',
      fontFamily: 'Roboto, sans-serif'
    })
    .child([
      el('div')
        .css({
          marginBottom: '1rem',
          border: '1px solid #dbeafe',
          borderRadius: '0.95rem',
          background: 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 60%, #f8fafc 100%)',
          padding: '1rem'
        })
        .child([
          el('div').text('Store').css({ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.28rem' }),
          el('div')
            .text(
              'Discover published projects from creators — pilih Populer atau Terbaru; scroll untuk memuat lebih banyak, lalu buka detail.'
            )
            .css({ color: '#334155', fontSize: '0.92rem' })
        ]),
      el('div')
        .css({
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap'
        })
        .child([
          el('span')
            .text('Urutan')
            .css({ fontSize: '0.78rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }),
          el('button')
            .link(refs, 'sortPopularBtn')
            .attr('type', 'button')
            .attr('aria-pressed', 'true')
            .text('Populer')
            .css({
              border: '1px solid #0f172a',
              borderRadius: '999px',
              padding: '0.45rem 1.15rem',
              cursor: 'pointer',
              fontWeight: '700',
              fontSize: '0.9rem',
              background: '#0f172a',
              color: '#fff',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s'
            })
            .click(function() {
              if (listState.sort === 'popular') return;
              loadStoreList(refs.searchInput ? refs.searchInput.value.trim() : '', 'popular');
            }),
          el('button')
            .link(refs, 'sortLatestBtn')
            .attr('type', 'button')
            .attr('aria-pressed', 'false')
            .text('Terbaru')
            .css({
              border: '1px solid #e2e8f0',
              borderRadius: '999px',
              padding: '0.45rem 1.15rem',
              cursor: 'pointer',
              fontWeight: '700',
              fontSize: '0.9rem',
              background: '#f8fafc',
              color: '#64748b',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s'
            })
            .click(function() {
              if (listState.sort === 'latest') return;
              loadStoreList(refs.searchInput ? refs.searchInput.value.trim() : '', 'latest');
            })
        ]),
      el('div').css({ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }).child([
        el('input')
          .link(refs, 'searchInput')
          .attr('type', 'text')
          .attr('placeholder', 'Cari project publish...')
          .css({
            flex: '1',
            minWidth: '240px',
            border: '1px solid #cbd5e1',
            borderRadius: '0.6rem',
            padding: '0.62rem 0.75rem',
            background: '#fff'
          })
          .on('keydown', function(e) {
            if (e.key === 'Enter') {
              const keyword = refs.searchInput ? refs.searchInput.value.trim() : '';
              loadStoreList(keyword);
            }
          }),
        el('button')
          .text('Search')
          .css({
            background: '#0ea5e9',
            color: '#fff',
            border: 'none',
            borderRadius: '0.6rem',
            padding: '0.6rem 0.95rem',
            cursor: 'pointer',
            fontWeight: '600'
          })
          .click(function() {
            const keyword = refs.searchInput ? refs.searchInput.value.trim() : '';
            loadStoreList(keyword);
          })
      ]),
      el('div').link(refs, 'storeList').class('store-list-masonry')
    ]);
  try {
    STORE_DESKTOP_GRID_MQ.addEventListener('change', function onStoreDesktopMqChange() {
      if (!refs.storeList || !refs.storeList.isConnected) return;
      applyLayoutAndObserve();
    });
  } catch (eMq) {
    try {
      STORE_DESKTOP_GRID_MQ.addListener(function onStoreDesktopMqChangeLegacy() {
        if (!refs.storeList || !refs.storeList.isConnected) return;
        applyLayoutAndObserve();
      });
    } catch (eMq2) {}
  }
  setTimeout(function() {
    loadStoreList('');
  }, 20);
  return page;
}
