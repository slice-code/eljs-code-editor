export function createStorePage() {
  const refs = {};
  let selectedSlug = null;

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

  async function loadStoreList(keyword = '') {
    setLoading('Loading store...');
    try {
      const q = keyword ? `?search=${encodeURIComponent(keyword)}` : '';
      const res = await fetch(`https://slice-code.com/api/editor/store${q}`, { credentials: 'include' });
      const body = await res.json();
      if (!res.ok || body.success === false) {
        throw new Error((body && body.error && body.error.message) || body.message || 'Store request failed');
      }

      const items = (body.data || []);
      if (items.length === 0) {
        el(refs.storeList).empty().child(
          el('div').css({
            border: '1px dashed #cbd5e1',
            borderRadius: '0.85rem',
            background: '#ffffff',
            color: '#64748b',
            padding: '1.1rem'
          }).text('Belum ada project publish.')
        ).get();
        return;
      }

      el(refs.storeList).empty().child(
        items.map(function(item) {
          const title = getSafeText(item.name, 'Untitled Project');
          const description = getSafeText(item.description, 'No description');
          const authorName = getSafeText(item.author && item.author.name, 'Unknown');
          const views = (item.stats && item.stats.views) || 0;
          const likes = (item.stats && item.stats.likes) || 0;
          const publishedDate = formatDate(item.published_at);
          return el('div').css({
            border: '1px solid #e5e7eb',
            borderRadius: '0.95rem',
            background: '#fff',
            overflow: 'hidden',
            cursor: 'pointer',
            boxShadow: '0 10px 30px rgba(15,23,42,0.06)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            breakInside: 'avoid',
            WebkitColumnBreakInside: 'avoid',
            marginBottom: '0.95rem',
            display: 'inline-block',
            width: '100%'
          }).mouseover(function() {
            this.style.transform = 'translateY(-2px)';
            this.style.boxShadow = '0 16px 36px rgba(15,23,42,0.12)';
          }).mouseout(function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '0 10px 30px rgba(15,23,42,0.06)';
          }).child([
            el('img').attr('src', item.thumbnail_url || './images/todolist.png').attr('alt', item.name || 'thumbnail').css({
              width: '100%',
              height: 'auto',
              objectFit: 'contain',
              background: '#f1f5f9'
            }),
            el('div').css({ padding: '0.95rem' }).child([
              el('div').text(title).css({
                fontWeight: '700',
                color: '#0f172a',
                marginBottom: '0.35rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }),
              el('div').text(description).css({
                color: '#475569',
                fontSize: '0.9rem',
                minHeight: '2.8em',
                lineHeight: '1.45'
              }),
              el('div').css({
                marginTop: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem'
              }).child([
                el('div').css({ fontSize: '0.78rem', color: '#64748b' }).text('by ' + authorName),
                el('div').css({ fontSize: '0.74rem', color: '#94a3b8' }).text(publishedDate)
              ]),
              el('div').css({
                marginTop: '0.55rem',
                display: 'flex',
                gap: '0.45rem',
                flexWrap: 'wrap'
              }).child([
                el('span').css({
                  fontSize: '0.73rem',
                  color: '#334155',
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  borderRadius: '999px',
                  padding: '0.2rem 0.45rem'
                }).text('Views ' + views),
                el('span').css({
                  fontSize: '0.73rem',
                  color: '#334155',
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  borderRadius: '999px',
                  padding: '0.2rem 0.45rem'
                }).text('Likes ' + likes)
              ])
            ])
          ]).click(function() { loadStoreDetail(item.slug); });
        })
      ).get();
    } catch (error) {
      setError('Gagal memuat store: ' + (error.message || error));
    }
  }

  async function loadStoreDetail(slug) {
    if (!slug || !refs.detailPanel) return;
    el(refs.detailPanel).empty().child(
      el('div').text('Loading detail...').css({ color: '#64748b' })
    ).get();
    try {
      const res = await fetch(`https://slice-code.com/api/editor/store/${encodeURIComponent(slug)}`, { credentials: 'include' });
      const body = await res.json();
      if (!res.ok || body.success === false) {
        throw new Error((body && body.error && body.error.message) || body.message || 'Detail request failed');
      }
      const data = body.data || {};
      el(refs.detailPanel).empty().child([
        el('img').attr('src', data.thumbnail_url || './images/todolist.png').attr('alt', data.name || 'thumbnail').css({
          width: '100%',
          height: '165px',
          objectFit: 'cover',
          borderRadius: '0.7rem',
          background: '#f1f5f9',
          marginBottom: '0.9rem'
        }),
        el('h3').text(getSafeText(data.name, 'Untitled')).css({ fontSize: '1.2rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.5rem', lineHeight: '1.3' }),
        el('div').text(getSafeText(data.description)).css({ color: '#334155', marginBottom: '0.75rem', lineHeight: '1.5' }),
        el('div').css({ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.2rem' }).text('Author: ' + getSafeText(data.author && data.author.name, 'Unknown')),
        el('div').css({ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.2rem' }).text('Published: ' + formatDate(data.published_at)),
        el('div').css({ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.9rem' }).text('Views: ' + ((data.stats && data.stats.views) || 0) + ' | Likes: ' + ((data.stats && data.stats.likes) || 0)),
        el('a').attr('href', data.published_url || '#').attr('target', '_blank').text('Open Published URL').css({
          display: 'inline-block',
          background: '#2563eb',
          color: '#fff',
          padding: '0.52rem 0.85rem',
          borderRadius: '0.5rem',
          textDecoration: 'none',
          fontSize: '0.85rem',
          fontWeight: '600'
        })
      ]).get();
    } catch (error) {
      el(refs.detailPanel).empty().child(
        el('div').text('Gagal memuat detail: ' + (error.message || error)).css({ color: '#dc2626' })
      ).get();
    }
  }

  function openRequestedDetailIfAny() {
    let slug = selectedSlug;
    if (!slug) {
      try {
        slug = sessionStorage.getItem('store:selectedSlug') || '';
      } catch (e) {
        slug = '';
      }
    }
    if (slug) {
      selectedSlug = slug;
      loadStoreDetail(slug);
      try { sessionStorage.removeItem('store:selectedSlug'); } catch (e) {}
    }
  }

  const page = el('div').css({
    maxWidth: '1240px',
    margin: '0 auto',
    padding: '1.15rem',
    fontFamily: 'Roboto, sans-serif'
  }).child([
    el('div').css({
      marginBottom: '1rem',
      border: '1px solid #dbeafe',
      borderRadius: '0.95rem',
      background: 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 60%, #f8fafc 100%)',
      padding: '1rem'
    }).child([
      el('div').text('Store').css({ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.28rem' }),
      el('div').text('Temukan project publish dari creator, cari cepat, lalu lihat detailnya.').css({ color: '#334155', fontSize: '0.92rem' })
    ]),
    el('div').css({ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }).child([
      el('input').link(refs, 'searchInput').attr('type', 'text').attr('placeholder', 'Cari project publish...').css({
        flex: '1',
        minWidth: '240px',
        border: '1px solid #cbd5e1',
        borderRadius: '0.6rem',
        padding: '0.62rem 0.75rem',
        background: '#fff'
      }).on('keydown', function(e) {
        if (e.key === 'Enter') {
          const keyword = refs.searchInput ? refs.searchInput.value.trim() : '';
          loadStoreList(keyword);
        }
      }),
      el('button').text('Search').css({
        background: '#0ea5e9',
        color: '#fff',
        border: 'none',
        borderRadius: '0.6rem',
        padding: '0.6rem 0.95rem',
        cursor: 'pointer',
        fontWeight: '600'
      }).click(function() {
        const keyword = refs.searchInput ? refs.searchInput.value.trim() : '';
        loadStoreList(keyword);
      })
    ]),
    el('div').css({ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: '1rem' }).child([
      el('div').link(refs, 'storeList').css({
        columnWidth: '240px',
        columnCount: 'auto',
        columnGap: '0.95rem',
        width: '100%'
      }),
      el('div').link(refs, 'detailPanel').css({
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: '0.95rem',
        padding: '1rem',
        minHeight: '240px',
        boxShadow: '0 10px 28px rgba(15,23,42,0.06)'
      }).child(
        el('div').text('Pilih project untuk melihat detail.').css({ color: '#64748b' })
      )
    ])
  ]);

  setTimeout(function() { loadStoreList(''); }, 20);
  openRequestedDetailIfAny();
  window.addEventListener('elcode:store-open-detail', function(e) {
    const slug = e && e.detail && e.detail.slug ? String(e.detail.slug) : '';
    if (!slug) return;
    selectedSlug = slug;
    loadStoreDetail(slug);
  });
  return page;
}
