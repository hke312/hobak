(function (global) {
  'use strict';

  /**
   * Synchronizes visual :user-invalid state (with WeakMap fallback for older browsers),
   * aria-invalid, dynamic aria-describedby error linking, and polite live-region announcements.
   * Implements the modern-web-guidance "validate-input-after-interaction" pattern.
   */
  function initFormValidation(form) {
    if (!form) return { refresh: function () {} };

    const supportsUserInvalid = typeof CSS !== 'undefined' && CSS.supports('selector(:user-invalid)');
    const dirtyState = new WeakMap();
    const flagged = new WeakSet();
    const announced = new WeakSet();

    const announcer = document.createElement('div');
    announcer.setAttribute('aria-live', 'polite');
    announcer.className = 'visually-hidden';
    document.body.append(announcer);

    let announceTimer = null;
    let announcedField = null;

    function linkError(el, shown) {
      const errorId = el.dataset.error;
      if (!errorId) return;
      const ids = (el.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (shown) ids.push(errorId);
      if (ids.length) {
        el.setAttribute('aria-describedby', ids.join(' '));
      } else {
        el.removeAttribute('aria-describedby');
      }
    }

    function spokenText(node) {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
        n.replaceWith(n.getAttribute('aria-label') + ': ');
      });
      return copy.textContent.replace(/\s+/g, ' ').trim();
    }

    function announceError(el) {
      const errorEl = document.getElementById(el.dataset.error);
      if (!errorEl) return;
      const label = el.labels && el.labels[0] ? spokenText(el.labels[0]) + ': ' : '';
      clearTimeout(announceTimer);
      announcer.textContent = '';
      announcedField = el;
      announceTimer = setTimeout(() => {
        announcer.textContent = label + spokenText(errorEl);
      }, 450);
    }

    function isFieldUserInvalid(el) {
      if (supportsUserInvalid) {
        return el.matches(':user-invalid');
      }
      return el.classList.contains('user-invalid-fallback');
    }

    function syncAria(el, announce) {
      if (!el || !el.matches || !el.matches('input, select, textarea')) return;
      const invalid = isFieldUserInvalid(el);
      if (invalid) {
        if (announce && !announced.has(el)) {
          announceError(el);
          announced.add(el);
        }
        el.setAttribute('aria-invalid', 'true');
        linkError(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
        el.setAttribute('aria-invalid', 'false');
        linkError(el, false);
        flagged.delete(el);
        announced.delete(el);
        if (announcedField === el) {
          clearTimeout(announceTimer);
          announcer.textContent = '';
        }
      }
    }

    function updateFallbackState(el, announce) {
      const isValid = el.validity.valid;
      el.classList.toggle('user-invalid-fallback', !isValid);
      el.classList.toggle('user-valid-fallback', isValid);
      syncAria(el, announce);
    }

    function refreshAll() {
      form.querySelectorAll('input, select, textarea').forEach((el) => {
        if (!supportsUserInvalid && dirtyState.get(el)?.hasBlurred) {
          updateFallbackState(el, false);
        } else {
          syncAria(el, false);
        }
      });
    }

    form.querySelectorAll('input, select, textarea').forEach((el) => syncAria(el, false));

    form.addEventListener(
      'blur',
      (e) => {
        const el = e.target;
        if (!el.matches?.('input, select, textarea')) return;
        if (!supportsUserInvalid) {
          const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
          state.hasBlurred = true;
          dirtyState.set(el, state);
          if (state.hasInteracted) {
            updateFallbackState(el, true);
          }
        } else {
          syncAria(el, true);
        }
      },
      true
    );

    form.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.matches?.('input, select, textarea')) return;
      if (!supportsUserInvalid) {
        const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
        state.hasInteracted = true;
        dirtyState.set(el, state);
        if (state.hasBlurred) {
          updateFallbackState(el, false);
        }
      } else if (el.hasAttribute('aria-invalid')) {
        syncAria(el, false);
      }
    });

    form.addEventListener(
      'change',
      (e) => {
        const el = e.target;
        if (!el.matches?.('input, select, textarea')) return;
        if (!supportsUserInvalid) {
          dirtyState.set(el, { hasInteracted: true, hasBlurred: true });
          updateFallbackState(el, true);
        } else {
          syncAria(el, true);
        }
      },
      true
    );

    form.addEventListener(
      'invalid',
      (e) => {
        const el = e.target;
        announced.add(el);
        if (!supportsUserInvalid) {
          dirtyState.set(el, { hasInteracted: true, hasBlurred: true });
          updateFallbackState(el, false);
        } else {
          syncAria(el, false);
        }
      },
      true
    );

    form.addEventListener(
      'reset',
      () => {
        setTimeout(() => {
          form.querySelectorAll('input, select, textarea').forEach((el) => {
            dirtyState.delete(el);
            el.classList.remove('user-invalid-fallback', 'user-valid-fallback');
            syncAria(el, false);
          });
        });
      },
      true
    );

    return {
      refresh: refreshAll,
      focusFirstInvalid: function () {
        const firstInvalid = form.querySelector(':invalid');
        if (firstInvalid) {
          firstInvalid.focus();
        }
      }
    };
  }

  global.HobakValidation = {
    initFormValidation
  };
})(window);
