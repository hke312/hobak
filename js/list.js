(function (global) {
  'use strict';

  const Store = global.HobakStore;
  const PAGE_SIZE = 9;

  const state = {
    query: '',
    region: '방어진 생활권',
    category: 'all',
    availableOnly: false,
    sort: 'latest',
    tab: '중고거래',
    page: 1,
    showMoreTags: false
  };

  const els = {};

  async function init() {
    els.searchForm = document.getElementById('search-form');
    els.searchInput = document.getElementById('search-input');
    els.searchClear = document.getElementById('search-clear');
    els.navPills = document.querySelectorAll('.nav-pill-btn');
    els.regionSelect = document.getElementById('region-select');
    els.listHeadingText = document.getElementById('list-heading-text');
    els.listCount = document.getElementById('list-count');
    els.resetFilterBtn = document.getElementById('filter-reset');
    els.availableOnlyBtn = document.getElementById('filter-available');
    els.categorySelect = document.getElementById('filter-category');
    els.sortSelect = document.getElementById('filter-sort');
    els.productGrid = document.getElementById('product-grid');
    els.pagination = document.getElementById('pagination');
    els.popularTags = document.getElementById('popular-tags');
    els.serviceNotice = document.getElementById('service-notice');

    hydrateFromUrl();
    populateOptions();
    bindEvents();

    if (els.productGrid) {
      els.productGrid.innerHTML =
        '<div class="empty-state"><p>동네 매물을 불러오는 중...</p></div>';
    }

    try {
      await Promise.all([Store.fetchProducts(), Store.fetchPopularTags()]);
      render();
    } catch (err) {
      console.error('Failed to load Hobak products:', err);
      if (els.productGrid) {
        els.productGrid.innerHTML =
          '<div class="empty-state"><h2>매물을 불러오지 못했어요</h2><p>네트워크 연결 또는 Supabase 설정을 확인한 뒤 새로고침 해주세요.</p></div>';
      }
      renderPopularTags();
    }
  }

  function hydrateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('q')) state.query = params.get('q') || '';
    if (params.has('category')) state.category = params.get('category') || 'all';
    if (params.has('region')) state.region = params.get('region') || '방어진 생활권';
    if (els.searchInput) els.searchInput.value = state.query;
  }

  function populateOptions() {
    if (els.categorySelect) {
      Store.CATEGORIES.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        els.categorySelect.append(opt);
      });
      els.categorySelect.value = state.category;
    }

    if (els.regionSelect) {
      els.regionSelect.innerHTML = '';
      const regions = ['방어진 생활권', '방어진', '화정동', '대송동', '일산동', '전하동'];
      regions.forEach((reg) => {
        const opt = document.createElement('option');
        opt.value = reg;
        opt.textContent = reg === '방어진 생활권' ? '방어진 ∨' : reg;
        els.regionSelect.append(opt);
      });
      els.regionSelect.value = state.region;
    }
  }

  function bindEvents() {
    if (els.searchForm) {
      els.searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        state.query = els.searchInput.value.trim();
        state.page = 1;
        if (state.query) {
          Store.recordSearchKeyword(state.query);
        }
        render();
      });
    }

    if (els.searchInput) {
      els.searchInput.addEventListener('input', () => {
        state.query = els.searchInput.value.trim();
        state.page = 1;
        render();
      });
    }

    if (els.searchClear) {
      els.searchClear.addEventListener('click', () => {
        els.searchInput.value = '';
        state.query = '';
        state.page = 1;
        els.searchInput.focus();
        render();
      });
    }

    els.navPills.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab || '중고거래';
        els.navPills.forEach((b) => {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        render();
      });
    });

    if (els.regionSelect) {
      els.regionSelect.addEventListener('change', () => {
        state.region = els.regionSelect.value;
        state.page = 1;
        render();
      });
    }

    if (els.resetFilterBtn) {
      els.resetFilterBtn.addEventListener('click', () => {
        state.query = '';
        state.category = 'all';
        state.availableOnly = false;
        state.sort = 'latest';
        state.region = '방어진 생활권';
        state.page = 1;
        if (els.searchInput) els.searchInput.value = '';
        if (els.categorySelect) els.categorySelect.value = 'all';
        if (els.sortSelect) els.sortSelect.value = 'latest';
        if (els.regionSelect) els.regionSelect.value = '방어진 생활권';
        render();
      });
    }

    if (els.availableOnlyBtn) {
      els.availableOnlyBtn.addEventListener('click', () => {
        state.availableOnly = !state.availableOnly;
        state.page = 1;
        render();
      });
    }

    if (els.categorySelect) {
      els.categorySelect.addEventListener('change', () => {
        state.category = els.categorySelect.value;
        state.page = 1;
        render();
      });
    }

    if (els.sortSelect) {
      els.sortSelect.addEventListener('change', () => {
        state.sort = els.sortSelect.value;
        state.page = 1;
        render();
      });
    }
  }

  function getFilteredProducts() {
    let items = Store.getProducts();

    if (state.region !== '방어진 생활권' && state.region !== '전체 동네') {
      items = items.filter(
        (item) => item.region === state.region || item.location.includes(state.region)
      );
    }

    if (state.category !== 'all') {
      items = items.filter((item) => item.category === state.category);
    }

    if (state.availableOnly) {
      items = items.filter((item) => item.status === 'sold');
    }

    if (state.query) {
      const q = state.query.toLowerCase();
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.location.toLowerCase().includes(q)
      );
    }

    items.sort((a, b) => {
      if (state.sort === 'popular') return (b.likes || 0) - (a.likes || 0);
      if (state.sort === 'price-asc') return (a.price || 0) - (b.price || 0);
      if (state.sort === 'price-desc') return (b.price || 0) - (a.price || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    return items;
  }

  function render() {
    const allFiltered = getFilteredProducts();
    const totalPages = Math.max(1, Math.ceil(allFiltered.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;

    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = allFiltered.slice(start, start + PAGE_SIZE);

    if (els.searchClear) {
      els.searchClear.hidden = !state.query;
    }

    if (els.availableOnlyBtn) {
      els.availableOnlyBtn.setAttribute('aria-pressed', String(state.availableOnly));
    }

    if (els.resetFilterBtn) {
      const isClean =
        !state.query &&
        state.category === 'all' &&
        !state.availableOnly &&
        state.region === '방어진 생활권';
      els.resetFilterBtn.setAttribute('aria-pressed', String(isClean));
    }

    if (els.listHeadingText) {
      const regionLabel = state.region === '방어진 생활권' ? '방어진' : state.region;
      if (state.query) {
        els.listHeadingText.textContent = `${regionLabel} '${state.query}' 중고거래 검색 결과`;
      } else if (state.category !== 'all') {
        els.listHeadingText.textContent = `${regionLabel} ${state.category} 매물`;
      } else {
        els.listHeadingText.textContent = `${regionLabel} 중고거래 검색 결과`;
      }
    }

    if (els.listCount) {
      els.listCount.textContent = `총 ${allFiltered.length}개`;
    }

    if (els.serviceNotice) {
      if (state.tab !== '중고거래' && state.tab !== '전체') {
        els.serviceNotice.hidden = false;
        els.serviceNotice.textContent = `'${state.tab}' 탭은 데모 안내 화면입니다. 아래에서는 우리 동네 중고거래 매물을 계속 확인하실 수 있어요.`;
      } else {
        els.serviceNotice.hidden = true;
      }
    }

    renderGrid(pageItems);
    renderPagination(totalPages);
    renderPopularTags();
    syncUrl();
  }

  function syncUrl() {
    try {
      const params = new URLSearchParams();
      if (state.query) params.set('q', state.query);
      if (state.category !== 'all') params.set('category', state.category);
      if (state.region !== '방어진 생활권') params.set('region', state.region);
      const qs = params.toString();
      const nextUrl = qs ? `?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', nextUrl);
    } catch {
      // Ignore under restricted file:// contexts
    }
  }

  function getStatusBadgeHtml(item) {
    return `<div class="product-card-badges">${Store.getStatusBadgesHtml(item)}</div>`;
  }

  function renderGrid(items) {
    if (!els.productGrid) return;

    if (items.length === 0) {
      els.productGrid.innerHTML = `
        <div class="empty-state">
          <h2>조건에 맞는 상품이 없어요</h2>
          <p>검색어를 바꾸거나 필터를 초기화해서 다른 동네 물품을 구경해보세요.</p>
          <button type="button" class="btn btn-primary" id="empty-reset-btn">전체 상품 보기</button>
        </div>
      `;
      const btn = document.getElementById('empty-reset-btn');
      if (btn && els.resetFilterBtn) {
        btn.addEventListener('click', () => els.resetFilterBtn.click());
      }
      return;
    }

    els.productGrid.innerHTML = items
      .map((item, idx) => {
        const thumb = (item.images && item.images[0]) || 'assets/products/rc-1.svg';
        const priceText = Store.formatPrice(item.price, item.tradeType);
        const priceClass =
          item.tradeType === 'share' ? 'product-price product-price--share' : 'product-price';
        const relTime = Store.formatRelativeTime(item.createdAt, item.bumpedLabel);
        const sellerName = item.seller?.name || '헤엄치는오리';
        const priorityAttr = idx === 0 ? 'fetchpriority="high"' : 'loading="lazy"';
        const isSold = item.status === 'sold';
        const conditionBadge =
          item.condition === '새상품'
            ? '<span class="product-subtag">새상품</span>'
            : `<span class="product-subtag product-stats-mini">관심 ${item.likes || 0} · 채팅 ${item.chats || 0}</span>`;

        return `
          <article class="product-card${isSold ? ' product-card--sold' : ''}">
            <a class="product-card-link" href="detail.html?id=${encodeURIComponent(item.id)}">
              <div class="product-thumb-wrap">
                <img
                  class="product-thumb"
                  src="${Store.escapeHtml(thumb)}"
                  alt="${Store.escapeHtml(item.title)}"
                  width="400"
                  height="400"
                  ${priorityAttr}
                >
                ${getStatusBadgeHtml(item)}
              </div>
              <div class="product-card-body">
                <h2 class="product-title">${Store.escapeHtml(item.title)}</h2>
                <div class="${priceClass} tabular-nums">${Store.escapeHtml(priceText)}</div>
                <div class="product-meta">${Store.escapeHtml(item.location)} · ${Store.escapeHtml(relTime)}</div>
                <div class="product-seller">
                  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                    <path d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 1.5c-3.3 0-6 1.7-6 3.8V17h12v-1.7c0-2.1-2.7-3.8-6-3.8Z" fill="currentColor"/>
                  </svg>
                  <span>${Store.escapeHtml(sellerName)}</span>
                </div>
                ${conditionBadge}
              </div>
            </a>
          </article>
        `;
      })
      .join('');
  }

  function renderPagination(totalPages) {
    if (!els.pagination) return;
    if (totalPages <= 1) {
      els.pagination.innerHTML = '';
      return;
    }

    const buttons = [];
    buttons.push(
      `<button type="button" class="page-btn" data-page="${state.page - 1}" aria-label="이전 페이지" ${
        state.page <= 1 ? 'disabled' : ''
      }>&lsaquo;</button>`
    );

    for (let p = 1; p <= totalPages; p += 1) {
      buttons.push(
        `<button type="button" class="page-btn tabular-nums" data-page="${p}" ${
          p === state.page ? 'aria-current="page"' : ''
        }>${p}</button>`
      );
    }

    buttons.push(
      `<button type="button" class="page-btn" data-page="${state.page + 1}" aria-label="다음 페이지" ${
        state.page >= totalPages ? 'disabled' : ''
      }>&rsaquo;</button>`
    );

    els.pagination.innerHTML = buttons.join('');
    els.pagination.querySelectorAll('.page-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextPage = Number(btn.dataset.page);
        if (!Number.isNaN(nextPage) && nextPage >= 1 && nextPage <= totalPages) {
          state.page = nextPage;
          render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  function renderPopularTags() {
    if (!els.popularTags) return;
    const tags = state.showMoreTags
      ? Store.POPULAR_TAGS.concat(Store.EXTRA_TAGS)
      : Store.POPULAR_TAGS;

    const tagsHtml = tags
      .map((tag) => {
        const active = state.query.toLowerCase() === tag.toLowerCase();
        return `<button type="button" class="tag-chip" data-tag="${Store.escapeHtml(
          tag
        )}" aria-pressed="${active}">${Store.escapeHtml(tag)}</button>`;
      })
      .join('');

    const moreBtnHtml = `<button type="button" class="tag-chip tag-chip--more" id="more-tags-btn" aria-expanded="${state.showMoreTags}">${
      state.showMoreTags ? '접기' : '더보기'
    }</button>`;

    els.popularTags.innerHTML = tagsHtml + moreBtnHtml;

    els.popularTags.querySelectorAll('[data-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        state.query = state.query === tag ? '' : tag;
        if (els.searchInput) els.searchInput.value = state.query;
        state.page = 1;
        if (state.query) {
          Store.recordSearchKeyword(state.query);
        }
        render();
      });
    });

    const moreBtn = document.getElementById('more-tags-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        state.showMoreTags = !state.showMoreTags;
        renderPopularTags();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      Store.fetchProducts().then(render).catch(() => {});
    }
  });
})(window);
