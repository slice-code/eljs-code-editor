import { attachJustifiedRowsLayout } from './justified-rows-layout.js';

/**
 * Halaman daftar publish milik user (GET /api/editor/store/me).
 * Buka project di editor dengan mengganti project lokal bernama sama (hanya dari alur ini).
 */
export function createMyPublishPage() {
  const refs = {};
  let disposeListLayout = null;

  function tearDownListLayout() {
    if (disposeListLayout) {
      disposeListLayout();
      disposeListLayout = null;
    }
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
    if (!refs.listEl) return;
    tearDownListLayout();
    el(refs.listEl).empty().child(
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
    if (!refs.listEl) return;
    tearDownListLayout();
    el(refs.listEl).empty().child(
      el('div').css({
        border: '1px solid #fecaca',
        borderRadius: '0.85rem',
        background: '#fff1f2',
        color: '#dc2626',
        padding: '1.1rem'
      }).text(message || 'Gagal memuat data.')
    ).get();
  }

  function openInEditor(slug) {
    const s = getSafeText(slug, '');
    if (!s) return;
    try {
      sessionStorage.setItem('editor:storeSlug', s);
      sessionStorage.setItem('editor:storeImportSource', 'my-publish');
    } catch (e) {}
    window.location.hash = '/editor';
    try {
      if (typeof window.__elcode_processStoreImport === 'function') {
        window.__elcode_processStoreImport();
      }
    } catch (e2) {}
  }

  async function loadList() {
    setLoading('Memuat publish Anda...');
    try {
      const res = await fetch('https://slice-code.com/api/editor/store/me', { credentials: 'include' });
      const body = await res.json();
      if (res.status === 401) {
        tearDownListLayout();
        el(refs.listEl).empty().child([
          el('div').text('Anda belum login. Buka Editor untuk login terlebih dahulu.').css({
            color: '#92400e',
            marginBottom: '0.75rem'
          }),
          el('button').text('Ke Editor').css({
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            padding: '0.55rem 1rem',
            cursor: 'pointer',
            fontWeight: '600'
          }).click(function() {
            window.location.hash = '/editor';
          })
        ]).get();
        return;
      }
      if (!res.ok || body.success === false) {
        throw new Error((body && body.error && body.error.message) || body.message || 'Request gagal');
      }

      const items = Array.isArray(body.data) ? body.data : [];
      if (items.length === 0) {
        tearDownListLayout();
        el(refs.listEl).empty().child(
          el('div').css({
            border: '1px dashed #cbd5e1',
            borderRadius: '0.85rem',
            background: '#ffffff',
            color: '#64748b',
            padding: '1.1rem'
          }).text('Belum ada project yang dipublish.')
        ).get();
        return;
      }

      el(refs.listEl).empty().child(
        items.map(function(item) {
          const projectId = item.project_id;
          const name = getSafeText(item.name, 'Untitled');
          const slug = getSafeText(item.slug, '');
          const url = item.published_url || '';
          const thumb = item.thumbnail_url || './images/todolist.png';
          const isPublished = !!item.is_published;
          const publishedAt = formatDate(item.published_at);
          const rowRef = {};

          function setRowBusy(loading) {
            if (!rowRef.unpublishBtn) return;
            rowRef.unpublishBtn.disabled = !!loading;
            rowRef.unpublishBtn.style.opacity = loading ? '0.7' : '1';
            rowRef.unpublishBtn.style.cursor = loading ? 'progress' : 'pointer';
            rowRef.unpublishBtn.textContent = loading ? 'Unpublishing...' : 'Unpublish';
          }

          return el('div')
            .attr('data-justified-card', '1')
            .css({
              border: '1px solid #e5e7eb',
              borderRadius: '0.95rem',
              background: '#fff',
              overflow: 'hidden',
              boxShadow: '0 10px 30px rgba(15,23,42,0.06)',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box'
            }).child([
            el('div').css({
              flex: '0 0 40%',
              minHeight: '0',
              maxHeight: '50%',
              overflow: 'hidden',
              background: '#f1f5f9',
              flexShrink: '0'
            }).child(
              el('img').attr('src', thumb).attr('alt', name).css({
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
              })
            ),
            el('div').css({
              flex: '1 1 auto',
              minHeight: '0',
              overflow: 'hidden',
              padding: '0.75rem 0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem'
            }).child([
              el('div').text(name).css({
                fontWeight: '700',
                color: '#0f172a',
                marginBottom: '0.35rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }),
              el('div').css({ color: '#64748b', fontSize: '0.78rem', marginBottom: '0.5rem', fontFamily: 'ui-monospace, monospace' }).text('slug: ' + (slug || '-')),
              el('div').css({ color: '#94a3b8', fontSize: '0.74rem', marginBottom: '0.65rem', wordBreak: 'break-all', minHeight: '0', overflow: 'hidden' }).text(url || '—'),
              el('div').css({ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.75rem' }).text('Published: ' + publishedAt),
              el('div').css({
                marginBottom: '0.65rem'
              }).child(
                el('span').css({
                  fontSize: '0.73rem',
                  color: isPublished ? '#15803d' : '#b91c1c',
                  background: isPublished ? '#dcfce7' : '#fee2e2',
                  borderRadius: '999px',
                  padding: '0.2rem 0.5rem',
                  fontWeight: '600'
                }).text(isPublished ? 'Published' : 'Unpublished')
              ),
              el('div').css({ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }).child([
                el('button').text('Detail').css({
                  padding: '0.4rem 0.65rem',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.45rem',
                  cursor: slug ? 'pointer' : 'not-allowed',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  opacity: slug ? '1' : '0.5'
                }).click(function() {
                  if (!slug) return;
                  window.location.hash = '/store-detail?slug=' + encodeURIComponent(slug) + '&from=my-publish';
                }),
                el('button').text('Buka di Editor').css({
                  padding: '0.4rem 0.65rem',
                  background: '#0ea5e9',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.45rem',
                  cursor: slug ? 'pointer' : 'not-allowed',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  opacity: slug ? '1' : '0.5'
                }).click(function() {
                  if (!slug) return;
                  openInEditor(slug);
                }),
                el('button').link(rowRef, 'unpublishBtn').text('Unpublish').css({
                  padding: '0.4rem 0.65rem',
                  background: '#b91c1c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.45rem',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: '600'
                }).hover(
                  function() { this.style.background = '#dc2626'; },
                  function() { this.style.background = '#b91c1c'; }
                ).click(function() {
                  if (!projectId) return;
                  if (!confirm('Unpublish project "' + name + '"?')) return;
                  setRowBusy(true);
                  fetch('https://slice-code.com/api/editor/projects/' + encodeURIComponent(projectId) + '/unpublish', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' }
                  }).then(function(r) {
                    return r.json().then(function(j) {
                      if (!r.ok || j.success === false) {
                        throw new Error((j && j.error && j.error.message) || j.message || 'Unpublish gagal');
                      }
                      loadList();
                    });
                  }).catch(function(err) {
                    alert(err.message || String(err));
                  }).finally(function() {
                    setRowBusy(false);
                  });
                })
              ])
            ])
          ]);
        })
      ).get();
      disposeListLayout = attachJustifiedRowsLayout(refs.listEl, {
        gap: 14,
        minRowHeight: 118,
        maxRowHeight: 320,
        baseMeasureWidth: 280
      });
    } catch (error) {
      setError('Gagal memuat daftar publish: ' + (error.message || error));
    }
  }

  const page = el('div').css({
    width: '100%',
    maxWidth: 'none',
    margin: 0,
    boxSizing: 'border-box',
    padding: 'clamp(0.75rem, 2vw, 1.35rem)',
    fontFamily: 'Roboto, sans-serif'
  }).child([
    el('div').css({
      marginBottom: '1rem',
      border: '1px solid #ddd6fe',
      borderRadius: '0.95rem',
      background: 'linear-gradient(135deg, #ede9fe 0%, #f5f3ff 55%, #f8fafc 100%)',
      padding: '1rem'
    }).child([
      el('div').text('My Published').css({ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.28rem' }),
      el('div').text('Kelola project yang Anda publish. Buka di Editor akan mengganti project lokal dengan nama yang sama (hanya dari halaman ini).').css({ color: '#334155', fontSize: '0.92rem' })
    ]),
    el('div').css({ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }).child([
      el('button').text('← Store').css({
        background: '#e2e8f0',
        color: '#0f172a',
        border: '1px solid #cbd5e1',
        borderRadius: '0.6rem',
        padding: '0.5rem 0.85rem',
        cursor: 'pointer',
        fontWeight: '600',
        fontSize: '0.85rem'
      }).click(function() {
        window.location.hash = '/store';
      }),
      el('button').text('Refresh').css({
        background: '#0f172a',
        color: '#fff',
        border: 'none',
        borderRadius: '0.6rem',
        padding: '0.5rem 0.85rem',
        cursor: 'pointer',
        fontWeight: '600',
        fontSize: '0.85rem'
      }).click(function() {
        loadList();
      })
    ]),
    el('div').link(refs, 'listEl').class('store-list-masonry')
  ]);

  setTimeout(function() { loadList(); }, 20);
  return page;
}
