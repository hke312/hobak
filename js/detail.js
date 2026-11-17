(function (global) {
  'use strict';

  const Store = global.HobakStore;
  let currentProduct = null;
  let toastTimer = null;

  function showToast(message) {
    const toast = document.getElementById('toast-banner');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2400);
  }

  function isOwner(item) {
    if (!item?.sellerId) return false;
    const actorId = Store.getCurrentActorId?.();
    if (!actorId) return false;
    return String(item.sellerId).toLowerCase() === String(actorId).toLowerCase();
  }

  function syncOwnerStatusButtons(status) {
    const current = status || 'available';
    document.querySelectorAll('.owner-status-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.status === current));
    });
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    try {
      if (global.HobakAuth?.getReadyPromise) {
        await global.HobakAuth.getReadyPromise();
      } else {
        await Store.initSession();
      }
      if (id) {
        currentProduct = await Store.fetchProductById(id);
      } else {
        const list = await Store.fetchProducts();
        currentProduct = list[0] || null;
      }
    } catch (err) {
      console.error('Failed to load product detail:', err);
      renderMissing();
      return;
    }

    if (!currentProduct) {
      renderMissing();
      return;
    }

    const [, nextViews, allProducts] = await Promise.all([
      Store.fetchUserLikes().catch(() => null),
      Store.incrementViews(currentProduct.id).catch(() => null),
      Store.fetchProducts().catch(() => [currentProduct])
    ]);

    if (typeof nextViews === 'number') {
      currentProduct.views = nextViews;
    }

    renderProduct(currentProduct);
    renderRelated(currentProduct, allProducts);
    initCarousel();
    initDialogs();
    initActions();

    if (typeof Store.onAuthChange === 'function') {
      Store.onAuthChange(async () => {
        if (!currentProduct) return;
        const ownerTools = document.querySelector('.detail-owner-tools');
        if (ownerTools) {
          ownerTools.hidden = !isOwner(currentProduct);
        }
        await Store.fetchUserLikes().catch(() => null);
        updateStatsAndWish();
      });
    }
  }

  function renderMissing() {
    const main = document.getElementById('detail-main');
    if (!main) return;
    main.innerHTML = `
      <div style="padding: 3rem 1.5rem; text-align: center;">
        <h1 style="margin: 0 0 0.5rem; font-size: 1.25rem;">게시글을 찾을 수 없어요</h1>
        <p style="margin: 0 0 1.25rem; color: var(--color-text-muted);">삭제되었거나 존재하지 않는 상품입니다.</p>
        <a href="index.html" class="btn btn-primary">상품 목록으로 돌아가기</a>
      </div>
    `;
  }

  function renderProduct(item) {
    document.title = `${item.title} | 호박마켓`;

    const images =
      Array.isArray(item.images) && item.images.length > 0
        ? item.images
        : ['assets/products/rc-1.svg'];

    // Render carousel slides
    const track = document.getElementById('carousel-track');
    if (track) {
      track.innerHTML = images
        .map(
          (src, index) => `
          <div
            class="carousel-slide"
            role="group"
            aria-roledescription="slide"
            aria-label="${images.length}장 중 ${index + 1}번째 사진"
            data-marker-name="${index + 1}번째 사진으로 이동"
          >
            <img
              src="${Store.escapeHtml(src)}"
              alt="${Store.escapeHtml(item.title)} 사진 ${index + 1}"
              width="800"
              height="600"
              ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}
            >
          </div>
        `
        )
        .join('');
    }

    // Status badge over hero
    const badgeSlot = document.getElementById('hero-status-badge');
    if (badgeSlot) {
      badgeSlot.innerHTML = Store.getStatusBadgesHtml(item);
    }

    // Seller info
    const sellerName = document.getElementById('seller-name');
    const sellerLocation = document.getElementById('seller-location');
    const sellerTemp = document.getElementById('seller-temp');
    if (sellerName) sellerName.textContent = item.seller?.name || '헤엄치는오리';
    if (sellerLocation) sellerLocation.textContent = item.location || '화정동, 대송동';
    if (sellerTemp) {
      const tempVal = (item.seller?.temp ?? 37.2).toFixed(1);
      const emoji = item.seller?.emoji || '😊';
      sellerTemp.textContent = `${tempVal}°C ${emoji}`;
    }

    // Product text fields
    const titleEl = document.getElementById('detail-title');
    const categoryEl = document.getElementById('detail-category');
    const timeEl = document.getElementById('detail-time');
    const priceEl = document.getElementById('detail-price');
    const descEl = document.getElementById('detail-description');
    const condBadge = document.getElementById('detail-condition-badge');

    if (titleEl) titleEl.textContent = item.title;
    if (categoryEl) {
      categoryEl.textContent = item.category;
      categoryEl.href = `index.html?category=${encodeURIComponent(item.category)}`;
    }
    if (timeEl) {
      timeEl.textContent = Store.formatRelativeTime(item.createdAt, item.bumpedLabel);
    }

    const priceText = Store.formatPrice(item.price, item.tradeType);
    if (priceEl) {
      priceEl.textContent = priceText;
      priceEl.classList.toggle('detail-price--share', item.tradeType === 'share');
    }

    if (condBadge) {
      if (item.condition && item.condition !== '중고') {
        condBadge.hidden = false;
        condBadge.textContent = item.condition;
      } else {
        condBadge.hidden = true;
      }
    }

    if (descEl) descEl.textContent = item.description;

    // Bottom bar price & negotiability
    const bottomPrice = document.getElementById('bottom-price');
    const bottomNeg = document.getElementById('bottom-negotiable');
    if (bottomPrice) bottomPrice.textContent = priceText;
    if (bottomNeg) {
      if (item.tradeType === 'share') {
        bottomNeg.textContent = '무료 나눔';
      } else {
        bottomNeg.textContent = item.negotiable ? '가격 제안 가능' : '가격 제안 불가';
      }
    }

    const editLink = document.getElementById('edit-post-link');
    if (editLink) {
      editLink.href = `write.html?edit=${encodeURIComponent(item.id)}`;
    }

    syncOwnerStatusButtons(item.status);

    const ownerTools = document.querySelector('.detail-owner-tools');
    if (ownerTools) {
      ownerTools.hidden = !isOwner(item);
    }

    updateStatsAndWish();
  }

  function updateStatsAndWish() {
    if (!currentProduct) return;
    const latest = Store.getProductById(currentProduct.id) || currentProduct;
    currentProduct = latest;

    const statsEl = document.getElementById('detail-stats');
    if (statsEl) {
      statsEl.textContent = `관심 ${latest.likes || 0} · 채팅 ${latest.chats || 0} · 조회 ${latest.views || 1}`;
    }

    const wishBtn = document.getElementById('wish-btn');
    if (wishBtn) {
      const liked = Store.isLiked(latest.id);
      wishBtn.setAttribute('aria-pressed', String(liked));
      wishBtn.setAttribute('aria-label', liked ? '관심 목록에서 제거' : '관심 목록에 추가');
      const icon = wishBtn.querySelector('svg path');
      if (icon) {
        icon.setAttribute('fill', liked ? 'currentColor' : 'none');
      }
    }
  }

  function renderRelated(item, allItems) {
    const grid = document.getElementById('related-grid');
    if (!grid) return;
    const source = Array.isArray(allItems) && allItems.length > 0 ? allItems : Store.getProducts();
    const others = source.filter((p) => p.id !== item.id).slice(0, 6);

    grid.innerHTML = others
      .map((p) => {
        const thumb = (p.images && p.images[0]) || 'assets/products/rc-1.svg';
        const priceText = Store.formatPrice(p.price, p.tradeType);
        const meta = Store.getStatusMeta(p.status);
        const isSold = p.status === 'sold';
        return `
          <article class="${isSold ? 'related-card--sold' : ''}">
            <a href="detail.html?id=${encodeURIComponent(p.id)}">
              <div class="related-card-thumb">
                <img src="${Store.escapeHtml(thumb)}" alt="${Store.escapeHtml(p.title)}" width="300" height="300" loading="lazy">
                <span class="status-badge ${meta.badgeClass} related-card-badge">${Store.escapeHtml(meta.label)}</span>
              </div>
              <h3 class="related-card-title">${Store.escapeHtml(p.title)}</h3>
              <div class="related-card-price tabular-nums">${Store.escapeHtml(priceText)}</div>
            </a>
          </article>
        `;
      })
      .join('');
  }

  /**
   * Accessible native scroll-snap carousel following modern-web-guidance "carousel":
   * - Real scroll position tracking
   * - Rapid click resolution with pendingTarget
   * - rAF-throttled marker updates
   * - Single settled handler (scrollend with debounced fallback)
   */
  function initCarousel() {
    const track = document.getElementById('carousel-track');
    const prevBtn = document.querySelector('.carousel-btn[data-direction="previous"]');
    const nextBtn = document.querySelector('.carousel-btn[data-direction="next"]');
    const markersNav = document.getElementById('carousel-markers');
    const statusRegion = document.getElementById('carousel-status');

    if (!track) return;
    const slides = Array.from(track.children);
    if (slides.length === 0) return;

    if (slides.length === 1) {
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      if (markersNav) markersNav.innerHTML = '';
      return;
    }

    // Build marker buttons
    if (markersNav) {
      markersNav.innerHTML = slides
        .map(
          (slide, idx) =>
            `<button type="button" data-slide-index="${idx}" aria-label="${Store.escapeHtml(
              slide.dataset.markerName || `${idx + 1}번째 사진`
            )}"></button>`
        )
        .join('');
    }

    const markerButtons = markersNav ? Array.from(markersNav.querySelectorAll('button')) : [];
    let settledIndex = 0;
    let activeMarkerIndex = -1;
    let pendingTarget = null;
    let scrollRafId = null;
    let settleFallbackTimer = null;
    const supportsScrollEnd = 'onscrollend' in window;

    function getNearestIndex() {
      const trackCenter = track.scrollLeft + track.clientWidth / 2;
      let nearestIdx = 0;
      let minDist = Infinity;
      slides.forEach((slide, idx) => {
        const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
        const dist = Math.abs(slideCenter - trackCenter);
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = idx;
        }
      });
      return nearestIdx;
    }

    function setActiveMarker(index) {
      if (index === activeMarkerIndex) return;
      activeMarkerIndex = index;
      markerButtons.forEach((btn, idx) => {
        if (idx === index) {
          btn.setAttribute('aria-current', 'true');
        } else {
          btn.removeAttribute('aria-current');
        }
      });
    }

    function updateControlButtons(index) {
      if (prevBtn) prevBtn.disabled = index <= 0;
      if (nextBtn) nextBtn.disabled = index >= slides.length - 1;
    }

    function scrollToSlide(targetIdx) {
      const clamped = Math.max(0, Math.min(slides.length - 1, targetIdx));
      pendingTarget = clamped;
      setActiveMarker(clamped);
      const targetSlide = slides[clamped];
      const delta = targetSlide.offsetLeft - track.scrollLeft;
      track.scrollBy({ left: delta });
    }

    function handleSettled(announce) {
      const currentIdx = getNearestIndex();
      pendingTarget = null;
      setActiveMarker(currentIdx);
      updateControlButtons(currentIdx);

      if (announce && currentIdx !== settledIndex && statusRegion) {
        statusRegion.textContent = `${slides.length}장 중 ${currentIdx + 1}번째 사진`;
      }
      settledIndex = currentIdx;
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        const base = pendingTarget !== null ? pendingTarget : getNearestIndex();
        if (base > 0) scrollToSlide(base - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const base = pendingTarget !== null ? pendingTarget : getNearestIndex();
        if (base < slides.length - 1) scrollToSlide(base + 1);
      });
    }

    markerButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.slideIndex);
        if (!Number.isNaN(idx)) scrollToSlide(idx);
      });
    });

    track.addEventListener('scroll', () => {
      if (pendingTarget === null && scrollRafId === null) {
        scrollRafId = requestAnimationFrame(() => {
          scrollRafId = null;
          setActiveMarker(getNearestIndex());
        });
      }
      if (!supportsScrollEnd) {
        clearTimeout(settleFallbackTimer);
        settleFallbackTimer = setTimeout(() => handleSettled(true), 140);
      }
    });

    if (supportsScrollEnd) {
      track.addEventListener('scrollend', () => {
        if (pendingTarget !== null && Math.abs(getNearestIndex() - pendingTarget) > 0) {
          return;
        }
        handleSettled(true);
      });
    }

    // Initial silent sync
    handleSettled(false);
  }

  function renderChatHistory(messages) {
    const historyEl = document.getElementById('chat-history');
    if (!historyEl) return;
    if (!Array.isArray(messages) || messages.length === 0) {
      historyEl.innerHTML = '';
      historyEl.hidden = true;
      return;
    }
    const actorId = Store.getCurrentActorId();
    historyEl.innerHTML = messages
      .map((msg) => {
        const isMine = msg.sender_id === actorId;
        const timeStr = new Date(msg.created_at).toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit'
        });
        return `
          <div class="chat-bubble ${isMine ? '' : 'chat-bubble--seller'}">
            <span>${Store.escapeHtml(msg.content)}</span>
            <span class="chat-bubble-time">${Store.escapeHtml(timeStr)}</span>
          </div>
        `;
      })
      .join('');
    historyEl.hidden = false;
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function initDialogs() {
    const appBtn = document.getElementById('app-view-btn');
    const appDialog = document.getElementById('app-dialog');
    const tempBtn = document.getElementById('manner-temp-btn');
    const tempDialog = document.getElementById('temp-dialog');
    const chatBtn = document.getElementById('chat-btn');
    const chatDialog = document.getElementById('chat-dialog');
    const deleteBtn = document.getElementById('delete-post-btn');
    const deleteDialog = document.getElementById('delete-dialog');

    if (appBtn && appDialog) {
      appBtn.addEventListener('click', () => appDialog.showModal());
    }
    if (tempBtn && tempDialog) {
      tempBtn.addEventListener('click', () => tempDialog.showModal());
    }
    if (chatBtn && chatDialog) {
      chatBtn.addEventListener('click', async () => {
        if (currentProduct?.sellerId && currentProduct.sellerId === Store.getCurrentActorId()) {
          showToast('내가 등록한 상품에는 채팅을 보낼 수 없어요.');
          return;
        }
        const chatTarget = document.getElementById('chat-seller-name');
        if (chatTarget && currentProduct) {
          chatTarget.textContent = `${currentProduct.seller?.name || '판매자'}님과 채팅하기`;
        }
        renderChatHistory([]);
        chatDialog.showModal();
        if (currentProduct) {
          const history = await Store.fetchChatMessages(currentProduct.id);
          renderChatHistory(history);
        }
      });
    }
    if (deleteBtn && deleteDialog) {
      deleteBtn.addEventListener('click', () => deleteDialog.showModal());
    }

    // Backdrop light-dismiss fallback for browsers without closedby="any"
    document.querySelectorAll('dialog.hobak-dialog').forEach((dlg) => {
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close('cancel');
      });
    });

    const chatForm = document.getElementById('chat-form');
    if (chatForm && chatDialog) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgInput = document.getElementById('chat-message-input');
        const text = msgInput ? msgInput.value.trim() : '';
        if (!text || !currentProduct) return;

        const submitBtn = chatDialog.querySelector('button[type="submit"][form="chat-form"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
          await Store.sendChatMessage(currentProduct.id, text);
          updateStatsAndWish();
          if (msgInput) msgInput.value = '';
          chatDialog.close('sent');
          showToast('판매자에게 채팅 메시지를 보냈어요!');
        } catch (err) {
          showToast(err?.message || '채팅 메시지를 보내지 못했어요.');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    if (confirmDeleteBtn && deleteDialog) {
      confirmDeleteBtn.addEventListener('click', async () => {
        if (!currentProduct) return;
        confirmDeleteBtn.disabled = true;
        try {
          await Store.deleteProduct(currentProduct.id);
          deleteDialog.close('deleted');
          window.location.href = 'index.html';
        } catch (err) {
          showToast(err?.message || '게시글을 삭제하지 못했어요.');
          confirmDeleteBtn.disabled = false;
        }
      });
    }
  }

  function initActions() {
    const wishBtn = document.getElementById('wish-btn');
    if (wishBtn) {
      wishBtn.addEventListener('click', async () => {
        if (!currentProduct || wishBtn.disabled) return;
        wishBtn.disabled = true;
        try {
          const liked = await Store.toggleLike(currentProduct.id);
          updateStatsAndWish();
          showToast(liked ? '관심 목록에 담았어요.' : '관심 목록에서 제외했어요.');
        } catch {
          showToast('관심 목록 반영에 실패했어요.');
        } finally {
          wishBtn.disabled = false;
        }
      });
    }

    const statusButtons = Array.from(document.querySelectorAll('.owner-status-btn'));
    const setStatusButtonsDisabled = (disabled) => {
      statusButtons.forEach((btn) => {
        btn.disabled = disabled;
      });
    };

    statusButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!currentProduct || !isOwner(currentProduct)) return;
        const nextStatus = btn.dataset.status;
        if (!nextStatus || nextStatus === (currentProduct.status || 'available')) return;

        const prevStatus = currentProduct.status;
        setStatusButtonsDisabled(true);
        syncOwnerStatusButtons(nextStatus);
        try {
          currentProduct =
            (await Store.updateProduct(currentProduct.id, { status: nextStatus })) ||
            currentProduct;
          renderProduct(currentProduct);
          const statusLabel = Store.getStatusMeta(currentProduct.status).label;
          showToast(`거래 상태가 '${statusLabel}'(으)로 변경되었어요.`);
        } catch (err) {
          syncOwnerStatusButtons(prevStatus);
          showToast(err?.message || '거래 상태를 변경하지 못했어요.');
        } finally {
          setStatusButtonsDisabled(false);
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
