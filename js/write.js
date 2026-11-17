(function (global) {
  'use strict';

  const Store = global.HobakStore;
  const Validation = global.HobakValidation;

  const MAX_PHOTOS = 10;
  const SAMPLE_PHOTOS = [
    'assets/products/rc-1.svg',
    'assets/products/rc-2.svg',
    'assets/products/rc-3.svg',
    'assets/products/bag.svg',
    'assets/products/bike.svg',
    'assets/products/camping.svg',
    'assets/products/chair.svg',
    'assets/products/keyboard.svg',
    'assets/products/knit.svg',
    'assets/products/laptop.svg'
  ];

  let uploadedImages = [];
  let editingProduct = null;
  let lastSellPrice = '';
  let toastTimer = null;
  let validationCtrl = null;

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

  function populateCategories(selectEl) {
    if (!selectEl || !Store?.CATEGORIES) return;
    const fragment = document.createDocumentFragment();
    Store.CATEGORIES.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      fragment.append(option);
    });
    selectEl.append(fragment);
  }

  function getSelectedTradeType(form) {
    const checked = form.querySelector('input[name="tradeType"]:checked');
    return checked ? checked.value : 'sell';
  }

  function parseDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function formatCommaDigits(digits) {
    if (!digits) return '';
    return Number(digits).toLocaleString('ko-KR');
  }

  function syncTradeTypeUI(form, options) {
    const opts = options || {};
    const priceInput = document.getElementById('post-price');
    const negotiableInput = document.getElementById('post-negotiable');
    if (!priceInput) return;

    const tradeType = getSelectedTradeType(form);
    const isShare = tradeType === 'share';

    if (isShare) {
      if (!priceInput.disabled && priceInput.value) {
        lastSellPrice = priceInput.value;
      }
      priceInput.disabled = true;
      priceInput.required = false;
      priceInput.value = '';
      priceInput.placeholder = '나눔 (무료)';
      priceInput.setCustomValidity('');
      if (negotiableInput) {
        negotiableInput.checked = false;
        negotiableInput.disabled = true;
      }
    } else {
      priceInput.disabled = false;
      priceInput.required = true;
      priceInput.placeholder = '가격을 입력해주세요';
      if (!opts.keepCurrentValue && !priceInput.value && lastSellPrice) {
        priceInput.value = lastSellPrice;
      }
      if (negotiableInput) {
        negotiableInput.disabled = false;
      }
    }

    if (validationCtrl) {
      validationCtrl.refresh();
    }
  }

  function syncSellerStrip() {
    const nameInput = document.getElementById('post-seller-name');
    const locationInput = document.getElementById('post-location');
    const previewName = document.getElementById('preview-seller-name');
    const previewRegion = document.getElementById('preview-seller-region');

    if (previewName && nameInput) {
      previewName.textContent = nameInput.value.trim() || '헤엄치는오리';
    }
    if (previewRegion && locationInput) {
      previewRegion.textContent = locationInput.value.trim() || '화정동, 대송동';
    }
  }

  function renderPhotoList() {
    const listEl = document.getElementById('photo-preview-list');
    const countEl = document.getElementById('photo-count');
    if (countEl) {
      countEl.textContent = String(uploadedImages.length);
    }
    if (!listEl) return;

    listEl.innerHTML = uploadedImages
      .map(
        (src, idx) => `
          <div class="photo-thumb-item">
            <img src="${Store.escapeHtml(src)}" alt="등록된 상품 사진 ${idx + 1}">
            ${idx === 0 ? '<span class="photo-cover-badge">대표</span>' : ''}
            <button
              type="button"
              class="photo-remove-btn"
              data-photo-index="${idx}"
              aria-label="${idx + 1}번째 사진 삭제"
            >✕</button>
          </div>
        `
      )
      .join('');
  }

  function resizeImageToBlobAndUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (file.type === 'image/svg+xml') {
          resolve({ blob: file, ext: 'svg', fallbackUrl: dataUrl });
          return;
        }
        const img = new Image();
        img.onload = () => {
          const maxDim = 800;
          let width = img.naturalWidth || maxDim;
          let height = img.naturalHeight || maxDim;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ blob: file, ext: 'jpg', fallbackUrl: dataUrl });
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const fallbackUrl = canvas.toDataURL('image/jpeg', 0.82);
          canvas.toBlob(
            (blob) => {
              resolve({ blob: blob || file, ext: 'jpg', fallbackUrl });
            },
            'image/jpeg',
            0.82
          );
        };
        img.onerror = () => resolve({ blob: file, ext: 'jpg', fallbackUrl: dataUrl });
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handlePhotoUpload(files) {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const remaining = MAX_PHOTOS - uploadedImages.length;
    if (remaining <= 0) {
      showToast('사진은 최대 10장까지 등록할 수 있어요.');
      return;
    }

    const targets = imageFiles.slice(0, remaining);
    if (imageFiles.length > remaining) {
      showToast(`최대 ${MAX_PHOTOS}장까지만 추가되어 ${remaining}장만 등록했어요.`);
    }

    for (const file of targets) {
      try {
        const prepared = await resizeImageToBlobAndUrl(file);
        let finalUrl = prepared.fallbackUrl;
        if (typeof Store.uploadImageBlob === 'function') {
          try {
            const uploadedUrl = await Store.uploadImageBlob(prepared.blob, prepared.ext);
            if (uploadedUrl) finalUrl = uploadedUrl;
          } catch (uploadErr) {
            console.warn('Storage upload failed, using data URL fallback:', uploadErr);
          }
        }
        if (uploadedImages.length < MAX_PHOTOS) {
          uploadedImages.push(finalUrl);
        }
      } catch {
        showToast('일부 이미지를 불러오지 못했어요.');
      }
    }
    renderPhotoList();
  }

  function handleFillSamplePhotos() {
    if (uploadedImages.length >= MAX_PHOTOS) {
      showToast('사진은 최대 10장까지 등록할 수 있어요.');
      return;
    }

    if (uploadedImages.length === 0) {
      uploadedImages = SAMPLE_PHOTOS.slice(0, 3);
      renderPhotoList();
      showToast('기본 샘플 사진 3장을 채웠어요.');
      return;
    }

    const available = SAMPLE_PHOTOS.filter((src) => !uploadedImages.includes(src));
    const pool = available.length > 0 ? available : SAMPLE_PHOTOS;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    uploadedImages.push(picked);
    renderPhotoList();
    showToast('샘플 사진을 추가했어요.');
  }

  function collectFormState(form) {
    const titleInput = document.getElementById('post-title');
    const categorySelect = document.getElementById('post-category');
    const priceInput = document.getElementById('post-price');
    const negotiableInput = document.getElementById('post-negotiable');
    const conditionSelect = document.getElementById('post-condition');
    const locationInput = document.getElementById('post-location');
    const sellerNameInput = document.getElementById('post-seller-name');
    const descInput = document.getElementById('post-description');

    const tradeType = getSelectedTradeType(form);
    const digits = parseDigits(priceInput ? priceInput.value : '');
    const numericPrice = tradeType === 'share' ? 0 : Number(digits || 0);

    return {
      title: titleInput ? titleInput.value.trim() : '',
      category: categorySelect ? categorySelect.value : '',
      tradeType,
      price: numericPrice,
      rawPriceDigits: digits,
      negotiable: tradeType === 'share' ? false : Boolean(negotiableInput?.checked),
      condition: conditionSelect ? conditionSelect.value : '중고',
      location: locationInput ? locationInput.value.trim() : '화정동, 대송동',
      sellerName: sellerNameInput ? sellerNameInput.value.trim() || '헤엄치는오리' : '헤엄치는오리',
      description: descInput ? descInput.value.trim() : '',
      images: uploadedImages.slice()
    };
  }

  function applyStateToForm(form, state) {
    const titleInput = document.getElementById('post-title');
    const categorySelect = document.getElementById('post-category');
    const priceInput = document.getElementById('post-price');
    const negotiableInput = document.getElementById('post-negotiable');
    const conditionSelect = document.getElementById('post-condition');
    const locationInput = document.getElementById('post-location');
    const sellerNameInput = document.getElementById('post-seller-name');
    const descInput = document.getElementById('post-description');

    if (titleInput && typeof state.title === 'string') titleInput.value = state.title;
    if (categorySelect && typeof state.category === 'string') categorySelect.value = state.category;

    const tradeType = state.tradeType === 'share' ? 'share' : 'sell';
    const tradeRadio = form.querySelector(`input[name="tradeType"][value="${tradeType}"]`);
    if (tradeRadio) tradeRadio.checked = true;

    if (priceInput) {
      if (tradeType === 'sell' && state.price !== '' && state.price != null) {
        const digits = parseDigits(state.price);
        priceInput.value = formatCommaDigits(digits);
        lastSellPrice = priceInput.value;
      } else {
        priceInput.value = '';
      }
    }

    if (negotiableInput) {
      negotiableInput.checked = Boolean(state.negotiable);
    }
    if (conditionSelect && state.condition) {
      conditionSelect.value = state.condition;
    }
    if (locationInput && typeof state.location === 'string' && state.location) {
      locationInput.value = state.location;
    }
    if (sellerNameInput && typeof state.sellerName === 'string' && state.sellerName) {
      sellerNameInput.value = state.sellerName;
    }
    if (descInput && typeof state.description === 'string') {
      descInput.value = state.description;
    }
    if (Array.isArray(state.images)) {
      uploadedImages = state.images.slice(0, MAX_PHOTOS);
    }

    syncTradeTypeUI(form, { keepCurrentValue: true });
    syncSellerStrip();
    renderPhotoList();
    if (validationCtrl) {
      validationCtrl.refresh();
    }
  }

  function renderPreviewModal(form) {
    const bodyEl = document.getElementById('preview-dialog-body');
    const dialog = document.getElementById('preview-dialog');
    if (!bodyEl || !dialog) return;

    const state = collectFormState(form);
    const images = state.images.length > 0 ? state.images : ['assets/products/rc-1.svg'];
    const heroImage = images[0];
    const priceText =
      state.tradeType === 'share'
        ? '나눔'
        : state.rawPriceDigits
          ? Store.formatPrice(state.price, 'sell')
          : '가격 미입력';
    const condBadgeHtml =
      state.condition && state.condition !== '중고'
        ? `<span class="status-badge" style="background-color: var(--color-surface-muted); color: var(--color-text-secondary);">${Store.escapeHtml(state.condition)}</span>`
        : '';
    const shareBadgeHtml =
      state.tradeType === 'share'
        ? '<span class="status-badge status-badge--share" style="position: absolute; inset-block-end: 0.75rem; inset-inline-start: 0.75rem;">나눔</span>'
        : '';
    const countBadgeHtml =
      images.length > 1
        ? `<span style="position: absolute; inset-block-end: 0.75rem; inset-inline-end: 0.75rem; padding: 0.2rem 0.55rem; border-radius: 9999px; background-color: rgb(0 0 0 / 0.65); color: #ffffff; font-size: 0.75rem; font-weight: 700;">1 / ${images.length}</span>`
        : '';

    const negotiableText =
      state.tradeType === 'share'
        ? '무료 나눔'
        : state.negotiable
          ? '가격 제안 가능'
          : '가격 제안 불가';

    bodyEl.innerHTML = `
      <article class="preview-card">
        <div class="preview-card-hero" style="position: relative;">
          <img src="${Store.escapeHtml(heroImage)}" alt="${Store.escapeHtml(state.title || '상품 대표 사진')}">
          ${shareBadgeHtml}
          ${countBadgeHtml}
        </div>
        <div class="write-seller-strip" style="background-color: var(--color-bg);">
          <div class="write-seller-left">
            <div class="write-seller-avatar" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5Zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5Z" />
              </svg>
            </div>
            <div class="write-seller-meta">
              <span class="write-seller-name">${Store.escapeHtml(state.sellerName)}</span>
              <span class="write-seller-region">${Store.escapeHtml(state.location || '동네 미입력')}</span>
            </div>
          </div>
          <span class="write-seller-temp">37.2°C 😊</span>
        </div>
        <div style="padding: 1.25rem;">
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-block-end: 0.35rem;">
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; line-height: 1.35;">${Store.escapeHtml(state.title || '상품 제목을 입력해주세요')}</h3>
            ${condBadgeHtml}
          </div>
          <div style="font-size: 0.8125rem; color: var(--color-text-muted); margin-block-end: 0.65rem;">
            <span>${Store.escapeHtml(state.category || '카테고리 미선택')}</span>
            <span aria-hidden="true"> · </span>
            <span>방금 전</span>
          </div>
          <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-block-end: 1rem;">
            <strong class="tabular-nums" style="font-size: 1.125rem; font-weight: 800; color: ${state.tradeType === 'share' ? 'var(--color-badge-share)' : 'var(--color-text)'};">${Store.escapeHtml(priceText)}</strong>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">${Store.escapeHtml(negotiableText)}</span>
          </div>
          <p style="margin: 0; font-size: 0.9375rem; line-height: 1.65; white-space: pre-line; word-break: keep-all; color: var(--color-text);">${Store.escapeHtml(state.description || '아직 작성된 상품 설명이 없어요.')}</p>
        </div>
      </article>
    `;

    dialog.showModal();
  }

  function setupPreviewDialog() {
    const dialog = document.getElementById('preview-dialog');
    const closeBtn = document.getElementById('preview-close-btn');
    const dismissBtn = document.getElementById('preview-dismiss-btn');
    if (!dialog) return;

    if (closeBtn) {
      closeBtn.addEventListener('click', () => dialog.close('close'));
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => dialog.close('dismiss'));
    }

    // Light-dismiss fallback for browsers without native closedby="any"
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isInside =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!isInside) {
          dialog.close('cancel');
        }
      });
    }
  }

  async function setupEditOrDraftMode(form) {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit');

    if (editId) {
      let target = null;
      try {
        target = await Store.fetchProductById(editId);
      } catch {
        target = null;
      }

      if (target && target.sellerId && target.sellerId !== Store.getCurrentActorId()) {
        showToast('작성자 본인만 게시글을 수정할 수 있어요.');
        target = null;
      }

      if (target) {
        editingProduct = target;
        document.title = '중고거래 글 수정하기 | 호박마켓';

        const pageTitle = document.getElementById('write-page-title');
        const submitBtn = document.getElementById('submit-post-btn');
        const previewSubmitBtn = document.getElementById('preview-submit-btn');
        const closeLink = document.getElementById('write-close-link');
        const cancelLink = document.getElementById('write-cancel-link');

        if (pageTitle) pageTitle.textContent = '중고거래 글 수정하기';
        if (submitBtn) submitBtn.textContent = '수정 완료';
        if (previewSubmitBtn) previewSubmitBtn.textContent = '수정 완료';
        const detailHref = `detail.html?id=${encodeURIComponent(target.id)}`;
        if (closeLink) closeLink.href = detailHref;
        if (cancelLink) cancelLink.href = detailHref;

        applyStateToForm(form, {
          title: target.title,
          category: target.category,
          tradeType: target.tradeType,
          price: target.tradeType === 'share' ? '' : target.price,
          negotiable: target.negotiable,
          condition: target.condition,
          location: target.location,
          sellerName: target.seller?.name || '헤엄치는오리',
          description: target.description,
          images: target.images
        });
        return;
      }
      if (!target) {
        showToast('수정할 게시글을 찾지 못해 새 글 작성으로 전환했어요.');
      }
    }

    const profile = await Store.fetchCurrentProfile().catch(() => null);
    if (profile) {
      const sellerNameInput = document.getElementById('post-seller-name');
      const locationInput = document.getElementById('post-location');
      const tempBadge = document.querySelector('.write-seller-temp');
      if (sellerNameInput && profile.nickname) sellerNameInput.value = profile.nickname;
      if (locationInput && profile.default_region) locationInput.value = profile.default_region;
      if (tempBadge) {
        const temp = Number(profile.manner_temp ?? 37.2).toFixed(1);
        const emoji = profile.temp_emoji || '😊';
        tempBadge.innerHTML = `${temp}°C <span aria-hidden="true">${Store.escapeHtml(emoji)}</span>`;
      }
      syncSellerStrip();
    }

    const draft = await Store.fetchDraft();
    if (draft && typeof draft === 'object') {
      const hasContent =
        Boolean(draft.title) ||
        Boolean(draft.category) ||
        Boolean(draft.description) ||
        (Array.isArray(draft.images) && draft.images.length > 0) ||
        Boolean(draft.rawPriceDigits);
      if (hasContent) {
        applyStateToForm(form, {
          ...draft,
          sellerName: profile?.nickname || draft.sellerName,
          price: draft.rawPriceDigits || draft.price || ''
        });
        showToast('임시저장된 글을 불러왔어요.');
      }
    }
  }

  async function handleFormSubmit(form, event) {
    event.preventDefault();

    if (global.HobakAuth && Store.hasSupabase?.() && !Store.isAuthenticated?.()) {
      const authed = await global.HobakAuth.ensureLoggedIn({
        mode: 'signin',
        notice: '글을 등록하려면 먼저 로그인해주세요.'
      });
      if (!authed) return;
    }

    const previewDialog = document.getElementById('preview-dialog');
    if (previewDialog && previewDialog.open) {
      previewDialog.close('submit');
    }

    const priceInput = document.getElementById('post-price');
    const tradeType = getSelectedTradeType(form);
    if (priceInput && tradeType === 'sell') {
      const digits = parseDigits(priceInput.value);
      if (!digits) {
        priceInput.value = '';
      } else {
        priceInput.value = formatCommaDigits(digits);
      }
    }

    if (!form.checkValidity()) {
      if (validationCtrl) {
        validationCtrl.focusFirstInvalid();
      }
      showToast('입력하지 않은 필수 항목을 확인해주세요.');
      return;
    }

    const submitBtn = document.getElementById('submit-post-btn');
    const previewSubmitBtn = document.getElementById('preview-submit-btn');
    if (submitBtn) submitBtn.disabled = true;
    if (previewSubmitBtn) previewSubmitBtn.disabled = true;

    const state = collectFormState(form);
    const imagesToSave = state.images.length > 0 ? state.images : ['assets/products/rc-1.svg'];

    try {
      if (editingProduct) {
        const updated = await Store.updateProduct(editingProduct.id, {
          title: state.title,
          category: state.category,
          tradeType: state.tradeType,
          price: state.price,
          negotiable: state.negotiable,
          condition: state.condition,
          location: state.location,
          images: imagesToSave,
          description: state.description,
          seller: {
            name: state.sellerName
          }
        });
        const targetId = updated ? updated.id : editingProduct.id;
        window.location.href = `detail.html?id=${encodeURIComponent(targetId)}`;
        return;
      }

      const saved = await Store.addProduct({
        title: state.title,
        category: state.category,
        tradeType: state.tradeType,
        price: state.price,
        negotiable: state.negotiable,
        condition: state.condition,
        location: state.location,
        sellerName: state.sellerName,
        images: imagesToSave,
        description: state.description
      });
      await Store.clearDraft();
      window.location.href = `detail.html?id=${encodeURIComponent(saved.id)}`;
    } catch (err) {
      console.error('Failed to save product:', err);
      showToast(err?.message || '게시글 저장 중 오류가 발생했어요.');
      if (submitBtn) submitBtn.disabled = false;
      if (previewSubmitBtn) previewSubmitBtn.disabled = false;
    }
  }

  async function init() {
    const form = document.getElementById('write-form');
    if (!form || !Store) return;

    const categorySelect = document.getElementById('post-category');
    populateCategories(categorySelect);

    validationCtrl = Validation ? Validation.initFormValidation(form) : null;

    const photoInput = document.getElementById('photo-input');
    const photoList = document.getElementById('photo-preview-list');
    const sampleBtn = document.getElementById('sample-photo-btn');
    const priceInput = document.getElementById('post-price');
    const sellerNameInput = document.getElementById('post-seller-name');
    const locationInput = document.getElementById('post-location');
    const saveDraftBtn = document.getElementById('save-draft-btn');
    const previewBtn = document.getElementById('preview-btn');

    if (photoInput) {
      photoInput.addEventListener('change', async () => {
        await handlePhotoUpload(photoInput.files);
        photoInput.value = '';
      });
    }

    if (photoList) {
      photoList.addEventListener('click', (event) => {
        const removeBtn = event.target.closest('.photo-remove-btn');
        if (!removeBtn) return;
        const idx = Number(removeBtn.dataset.photoIndex);
        if (Number.isNaN(idx)) return;
        uploadedImages.splice(idx, 1);
        renderPhotoList();
      });
    }

    if (sampleBtn) {
      sampleBtn.addEventListener('click', handleFillSamplePhotos);
    }

    form.querySelectorAll('input[name="tradeType"]').forEach((radio) => {
      radio.addEventListener('change', () => syncTradeTypeUI(form));
    });

    if (priceInput) {
      priceInput.addEventListener('input', () => {
        const digits = parseDigits(priceInput.value);
        priceInput.value = formatCommaDigits(digits);
        priceInput.setCustomValidity('');
        if (getSelectedTradeType(form) === 'sell') {
          lastSellPrice = priceInput.value;
        }
      });
    }

    if (sellerNameInput) {
      sellerNameInput.addEventListener('input', syncSellerStrip);
    }
    if (locationInput) {
      locationInput.addEventListener('input', syncSellerStrip);
    }

    if (saveDraftBtn) {
      saveDraftBtn.addEventListener('click', async () => {
        const state = collectFormState(form);
        try {
          await Store.saveDraft(state);
          showToast('작성 중인 내용을 임시저장했어요.');
        } catch {
          showToast('임시저장에 실패했어요. 잠시 후 다시 시도해주세요.');
        }
      });
    }

    if (previewBtn) {
      previewBtn.addEventListener('click', () => renderPreviewModal(form));
    }

    setupPreviewDialog();
    if (global.HobakAuth) {
      await global.HobakAuth.getReadyPromise();
      if (Store.hasSupabase?.() && !Store.isAuthenticated?.()) {
        const authed = await global.HobakAuth.ensureLoggedIn({
          mode: 'signin',
          notice: '글쓰기는 로그인 후 이용할 수 있어요.'
        });
        if (!authed) {
          showToast('로그인 후 글을 작성할 수 있어요. 목록으로 이동할게요.');
          setTimeout(() => {
            window.location.href = 'index.html';
          }, 900);
          return;
        }
      }
    } else {
      await Store.initSession();
    }
    await setupEditOrDraftMode(form);
    syncTradeTypeUI(form, { keepCurrentValue: true });
    syncSellerStrip();
    renderPhotoList();

    form.addEventListener('submit', (event) => handleFormSubmit(form, event));
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
