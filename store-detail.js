export function createStoreDetailPage() {
  const refs = {};

  function getStoreSlugFromLocation() {
    const hash = window.location.hash || '';
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) return '';
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    return (params.get('slug') || '').trim();
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
          height: '220px',
          objectFit: 'cover',
          borderRadius: '0.7rem',
          background: '#f1f5f9',
          marginBottom: '0.9rem'
        }),
        el('h3').text(getSafeText(data.name, 'Untitled')).css({ fontSize: '1.35rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.5rem', lineHeight: '1.3' }),
        el('div').text(getSafeText(data.description)).css({ color: '#334155', marginBottom: '0.75rem', lineHeight: '1.6' }),
        el('div').css({ fontSize: '0.9rem', color: '#64748b', marginBottom: '0.2rem' }).text('Author: ' + getSafeText(data.author && data.author.name, 'Unknown')),
        el('div').css({ fontSize: '0.9rem', color: '#64748b', marginBottom: '0.2rem' }).text('Published: ' + formatDate(data.published_at)),
        el('div').css({ fontSize: '0.9rem', color: '#64748b', marginBottom: '0.9rem' }).text('Views: ' + ((data.stats && data.stats.views) || 0) + ' | Likes: ' + ((data.stats && data.stats.likes) || 0)),
        el('div').css({ display: 'flex', gap: '8px', flexWrap: 'wrap' }).child([
          el('button').text('Back to Store').css({
            display: 'inline-flex',
            background: '#475569',
            color: '#fff',
            padding: '0.55rem 0.95rem',
            borderRadius: '0.5rem',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: '600'
          }).click(function() {
            window.location.hash = '/store';
          }),
          el('button').text('Open in Editor').css({
            display: 'inline-flex',
            background: '#2563eb',
            color: '#fff',
            padding: '0.55rem 0.95rem',
            borderRadius: '0.5rem',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: '600'
          }).click(function() {
            const targetSlug = getSafeText(data.slug || slug, '');
            if (!targetSlug) return;
            try { sessionStorage.setItem('editor:storeSlug', targetSlug); } catch (e) {}
            window.location.hash = '/editor';
          })
        ])
      ]).get();
    } catch (error) {
      el(refs.detailPanel).empty().child(
        el('div').text('Gagal memuat detail: ' + (error.message || error)).css({ color: '#dc2626' })
      ).get();
    }
  }

  const page = el('div').css({
    maxWidth: '920px',
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
      el('div').text('Store Detail').css({ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.28rem' }),
      el('div').text('Detail project publish dari Store.').css({ color: '#334155', fontSize: '0.92rem' })
    ]),
    el('div').link(refs, 'detailPanel').css({
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: '0.95rem',
      padding: '1rem',
      minHeight: '300px',
      boxShadow: '0 10px 28px rgba(15,23,42,0.06)'
    }).child(
      el('div').text('Memuat detail project...').css({ color: '#64748b' })
    )
  ]);

  const slug = getStoreSlugFromLocation();
  if (!slug) {
    el(refs.detailPanel).empty().child(
      el('div').text('Slug detail tidak ditemukan. Buka dari halaman Store.').css({ color: '#dc2626' })
    ).get();
  } else {
    loadStoreDetail(slug);
  }

  return page;
}
