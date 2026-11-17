(function (global) {
  'use strict';

  const Store = global.HobakStore;
  const Validation = global.HobakValidation;

  let dialogEl = null;
  let signinForm = null;
  let signupForm = null;
  let signinValidation = null;
  let signupValidation = null;
  let currentMode = 'signin';
  let pendingRedirect = null;
  let pendingResolver = null;
  let readyPromise = null;
  let toastTimer = null;

  function showToast(message) {
    let toast = document.getElementById('toast-banner');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast-banner';
      toast.className = 'toast-banner';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.hidden = true;
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  }

  function translateAuthError(err) {
    const raw = String(err?.message || err || '').trim();
    const lower = raw.toLowerCase();

    if (!raw) return '요청 처리 중 문제가 발생했어요. 다시 시도해주세요.';
    if (lower.includes('invalid login credentials')) {
      return '이메일 또는 비밀번호가 올바르지 않아요.';
    }
    if (lower.includes('email not confirmed')) {
      return '이메일 인증이 아직 완료되지 않았어요. 메일함을 확인한 뒤 로그인해주세요.';
    }
    if (lower.includes('user already registered') || lower.includes('already been registered')) {
      return '이미 가입된 이메일이에요. 로그인 탭에서 로그인해주세요.';
    }
    if (lower.includes('password should be at least')) {
      return '비밀번호는 6자 이상 입력해주세요.';
    }
    if (lower.includes('unable to validate email') || lower.includes('invalid email')) {
      return '올바른 이메일 형식을 입력해주세요.';
    }
    if (lower.includes('email rate limit') || err?.code === 'over_email_send_rate_limit') {
      return '인증 메일 발송 한도를 초과했어요. 잠시 후 다시 시도하거나 Supabase에서 Confirm email을 꺼주세요.';
    }
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return '요청이 너무 많아요. 잠시 후 다시 시도해주세요.';
    }
    if (lower.includes('signup is disabled')) {
      return '현재 신규 회원가입이 제한되어 있어요.';
    }
    return raw;
  }

  function getDisplayNickname(user, profile) {
    if (profile?.nickname && String(profile.nickname).trim()) {
      return String(profile.nickname).trim();
    }
    const metaNick = user?.user_metadata?.nickname;
    if (typeof metaNick === 'string' && metaNick.trim()) {
      return metaNick.trim();
    }
    if (user?.email) {
      return String(user.email).split('@')[0];
    }
    return '호박이웃';
  }

  function updateHeaderButtons(user, profile) {
    const loginBtn = document.getElementById('auth-login-btn');
    const nicknameBtn = document.getElementById('auth-nickname-btn');
    const logoutBtn = document.getElementById('auth-logout-btn');

    const loggedIn = Boolean(user?.id);

    if (loginBtn) {
      loginBtn.hidden = loggedIn;
    }
    if (nicknameBtn) {
      nicknameBtn.hidden = !loggedIn;
      if (loggedIn) {
        nicknameBtn.textContent = getDisplayNickname(user, profile);
      }
    }
    if (logoutBtn) {
      logoutBtn.hidden = !loggedIn;
    }
  }

  function ensureAuthDialog() {
    if (dialogEl) return dialogEl;
    const existing = document.getElementById('auth-dialog');
    if (existing) {
      dialogEl = existing;
      return dialogEl;
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <dialog id="auth-dialog" class="hobak-dialog auth-dialog" closedby="any" aria-labelledby="auth-dialog-title">
        <div class="dialog-header">
          <h2 id="auth-dialog-title" class="dialog-title">로그인</h2>
          <button type="button" class="dialog-close" command="close" commandfor="auth-dialog" aria-label="닫기">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="dialog-body">
          <p id="auth-context-notice" class="auth-context-notice" role="status" hidden></p>

          <div class="auth-tabs" role="tablist" aria-label="계정 메뉴">
            <button
              type="button"
              role="tab"
              id="auth-tab-signin"
              class="auth-tab-btn"
              aria-selected="true"
              aria-controls="auth-panel-signin"
              data-auth-mode="signin"
            >로그인</button>
            <button
              type="button"
              role="tab"
              id="auth-tab-signup"
              class="auth-tab-btn"
              aria-selected="false"
              aria-controls="auth-panel-signup"
              data-auth-mode="signup"
            >회원가입</button>
          </div>

          <section id="auth-panel-signin" class="auth-panel" role="tabpanel" aria-labelledby="auth-tab-signin">
            <form id="auth-signin-form" class="auth-form" method="post" novalidate>
              <div class="field">
                <label for="signin-email" class="auth-label">이메일 <span aria-hidden="true">*</span></label>
                <input
                  type="email"
                  id="signin-email"
                  name="email"
                  class="auth-input"
                  required
                  autocomplete="username"
                  autocorrect="off"
                  autocapitalize="none"
                  spellcheck="false"
                  enterkeyhint="next"
                  autofocus
                  data-error="signin-email-error"
                  placeholder="you@example.com"
                >
                <div id="signin-email-error" class="error-msg">
                  <span role="img" aria-label="오류">❌</span> 올바른 이메일 주소를 입력해주세요.
                </div>
              </div>

              <div class="field">
                <label for="signin-password" class="auth-label">비밀번호 <span aria-hidden="true">*</span></label>
                <div class="auth-pw-wrap">
                  <input
                    type="password"
                    id="signin-password"
                    name="password"
                    class="auth-input auth-input--pw"
                    required
                    minlength="6"
                    autocomplete="current-password"
                    enterkeyhint="done"
                    data-error="signin-password-error"
                    placeholder="비밀번호를 입력해주세요"
                  >
                  <button
                    type="button"
                    class="auth-pw-toggle"
                    data-pw-target="signin-password"
                    aria-pressed="false"
                    aria-label="비밀번호 표시"
                  >보기</button>
                </div>
                <div id="signin-password-error" class="error-msg">
                  <span role="img" aria-label="오류">❌</span> 비밀번호를 6자 이상 입력해주세요.
                </div>
              </div>

              <p id="signin-server-error" class="auth-server-error" role="alert" hidden></p>

              <button type="submit" id="signin-submit-btn" class="btn btn-primary auth-submit-btn">로그인</button>

              <p class="auth-switch-row">
                아직 회원이 아니신가요?
                <button type="button" class="auth-switch-link" data-switch-mode="signup">회원가입</button>
              </p>
            </form>
          </section>

          <section id="auth-panel-signup" class="auth-panel" role="tabpanel" aria-labelledby="auth-tab-signup" hidden>
            <form id="auth-signup-form" class="auth-form" method="post" novalidate>
              <div class="field">
                <label for="signup-email" class="auth-label">이메일 <span aria-hidden="true">*</span></label>
                <input
                  type="email"
                  id="signup-email"
                  name="email"
                  class="auth-input"
                  required
                  autocomplete="username"
                  autocorrect="off"
                  autocapitalize="none"
                  spellcheck="false"
                  enterkeyhint="next"
                  data-error="signup-email-error"
                  placeholder="you@example.com"
                >
                <div id="signup-email-error" class="error-msg">
                  <span role="img" aria-label="오류">❌</span> 올바른 이메일 주소를 입력해주세요.
                </div>
              </div>

              <div class="field">
                <label for="signup-password" class="auth-label">비밀번호 <span aria-hidden="true">*</span></label>
                <span id="signup-password-hint" class="auth-hint">영문 또는 숫자를 포함해 6자 이상 입력해주세요.</span>
                <div class="auth-pw-wrap">
                  <input
                    type="password"
                    id="signup-password"
                    name="password"
                    class="auth-input auth-input--pw"
                    required
                    minlength="6"
                    autocomplete="new-password"
                    aria-describedby="signup-password-hint"
                    enterkeyhint="next"
                    data-error="signup-password-error"
                    placeholder="6자 이상 비밀번호"
                  >
                  <button
                    type="button"
                    class="auth-pw-toggle"
                    data-pw-target="signup-password"
                    aria-pressed="false"
                    aria-label="비밀번호 표시"
                  >보기</button>
                </div>
                <div id="signup-password-error" class="error-msg">
                  <span role="img" aria-label="오류">❌</span> 비밀번호를 6자 이상 입력해주세요.
                </div>
              </div>

              <div class="field">
                <label for="signup-nickname" class="auth-label">닉네임 <span aria-hidden="true">*</span></label>
                <span id="signup-nickname-hint" class="auth-hint">게시글과 프로필에 표시될 이름이에요 (1~20자).</span>
                <input
                  type="text"
                  id="signup-nickname"
                  name="nickname"
                  class="auth-input"
                  required
                  minlength="1"
                  maxlength="20"
                  autocomplete="nickname"
                  aria-describedby="signup-nickname-hint"
                  enterkeyhint="done"
                  data-error="signup-nickname-error"
                  placeholder="예: 따뜻한호박"
                >
                <div id="signup-nickname-error" class="error-msg">
                  <span role="img" aria-label="오류">❌</span> 닉네임을 입력해주세요.
                </div>
              </div>

              <p id="signup-server-error" class="auth-server-error" role="alert" hidden></p>

              <button type="submit" id="signup-submit-btn" class="btn btn-primary auth-submit-btn">회원가입</button>

              <p class="auth-switch-row">
                이미 계정이 있으신가요?
                <button type="button" class="auth-switch-link" data-switch-mode="signin">로그인</button>
              </p>
            </form>
          </section>
        </div>
      </dialog>
    `;

    dialogEl = wrapper.firstElementChild;
    document.body.append(dialogEl);

    signinForm = document.getElementById('auth-signin-form');
    signupForm = document.getElementById('auth-signup-form');

    if (Validation) {
      signinValidation = Validation.initFormValidation(signinForm);
      signupValidation = Validation.initFormValidation(signupForm);
    }

    bindDialogEvents();
    return dialogEl;
  }

  function clearServerErrors() {
    const signinErr = document.getElementById('signin-server-error');
    const signupErr = document.getElementById('signup-server-error');
    if (signinErr) {
      signinErr.textContent = '';
      signinErr.hidden = true;
    }
    if (signupErr) {
      signupErr.textContent = '';
      signupErr.hidden = true;
    }
  }

  function showServerError(mode, message) {
    const el = document.getElementById(mode === 'signup' ? 'signup-server-error' : 'signin-server-error');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function setMode(mode) {
    currentMode = mode === 'signup' ? 'signup' : 'signin';
    const titleEl = document.getElementById('auth-dialog-title');
    const signinTab = document.getElementById('auth-tab-signin');
    const signupTab = document.getElementById('auth-tab-signup');
    const signinPanel = document.getElementById('auth-panel-signin');
    const signupPanel = document.getElementById('auth-panel-signup');

    const isSignup = currentMode === 'signup';
    if (titleEl) titleEl.textContent = isSignup ? '회원가입' : '로그인';
    if (signinTab) signinTab.setAttribute('aria-selected', String(!isSignup));
    if (signupTab) signupTab.setAttribute('aria-selected', String(isSignup));
    if (signinPanel) signinPanel.hidden = isSignup;
    if (signupPanel) signupPanel.hidden = !isSignup;

    clearServerErrors();

    const focusTarget = document.getElementById(isSignup ? 'signup-email' : 'signin-email');
    if (focusTarget && dialogEl?.open) {
      requestAnimationFrame(() => focusTarget.focus());
    }
  }

  function finishAuthSuccess(user, profile) {
    const redirectTarget = pendingRedirect;
    const resolver = pendingResolver;
    pendingRedirect = null;
    pendingResolver = null;

    updateHeaderButtons(user, profile);
    if (dialogEl?.open) {
      dialogEl.close('authenticated');
    }

    if (resolver) {
      resolver(true);
    }

    if (redirectTarget) {
      global.location.href = redirectTarget;
      return;
    }

    const nick = getDisplayNickname(user, profile);
    showToast(`${nick}님, 환영해요!`);
  }

  function bindDialogEvents() {
    if (!dialogEl) return;

    if (!('commandForElement' in HTMLButtonElement.prototype)) {
      dialogEl.querySelectorAll('.dialog-close[command="close"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          dialogEl.close('cancel');
        });
      });
    }

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (e) => {
        const r = dialogEl.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      dialogEl.addEventListener('pointerdown', (e) => {
        pressedOutside = isOutside(e);
      });
      dialogEl.addEventListener('pointerup', (e) => {
        if (pressedOutside && isOutside(e)) {
          dialogEl.close('cancel');
        }
      });
    }

    dialogEl.addEventListener('close', () => {
      const rv = dialogEl.returnValue;
      dialogEl.returnValue = '';
      if (rv !== 'authenticated') {
        pendingRedirect = null;
        if (pendingResolver) {
          const resolve = pendingResolver;
          pendingResolver = null;
          resolve(false);
        }
      }
    });

    dialogEl.querySelectorAll('[data-auth-mode], [data-switch-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.authMode || btn.dataset.switchMode || 'signin';
        setMode(nextMode);
      });
    });

    dialogEl.querySelectorAll('.auth-pw-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.pwTarget;
        const input = targetId ? document.getElementById(targetId) : null;
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(show));
        btn.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 표시');
        btn.textContent = show ? '숨김' : '보기';
      });
    });

    if (signinForm) {
      signinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearServerErrors();

        if (!signinForm.checkValidity()) {
          signinValidation?.focusFirstInvalid();
          return;
        }

        const emailInput = document.getElementById('signin-email');
        const pwInput = document.getElementById('signin-password');
        const submitBtn = document.getElementById('signin-submit-btn');

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = '로그인 중...';
        }

        try {
          const result = await Store.signInWithEmail(emailInput.value, pwInput.value);
          signinForm.reset();
          signinValidation?.refresh();
          finishAuthSuccess(result.user, result.profile);
        } catch (err) {
          showServerError('signin', translateAuthError(err));
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '로그인';
          }
        }
      });
    }

    if (signupForm) {
      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearServerErrors();

        const nickInput = document.getElementById('signup-nickname');
        if (nickInput) {
          const trimmedNick = nickInput.value.trim();
          if (!trimmedNick) {
            nickInput.setCustomValidity('닉네임을 입력해주세요.');
          } else {
            nickInput.setCustomValidity('');
          }
        }

        if (!signupForm.checkValidity()) {
          signupValidation?.focusFirstInvalid();
          return;
        }

        const emailInput = document.getElementById('signup-email');
        const pwInput = document.getElementById('signup-password');
        const submitBtn = document.getElementById('signup-submit-btn');

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = '가입 처리 중...';
        }

        try {
          const enteredEmail = emailInput.value.trim();
          const enteredNick = nickInput.value.trim();
          const result = await Store.signUpWithEmail(enteredEmail, pwInput.value, enteredNick);

          if (result.session && result.user) {
            signupForm.reset();
            signupValidation?.refresh();
            finishAuthSuccess(result.user, result.profile);
            return;
          }

          // When email confirmation is enabled in Supabase project settings
          signupForm.reset();
          signupValidation?.refresh();
          setMode('signin');
          const signinEmail = document.getElementById('signin-email');
          if (signinEmail) signinEmail.value = enteredEmail;
          const noticeEl = document.getElementById('auth-context-notice');
          if (noticeEl) {
            noticeEl.textContent = '회원가입이 완료되었어요! 이메일 인증 링크를 확인한 뒤 로그인해주세요.';
            noticeEl.hidden = false;
          }
        } catch (err) {
          showServerError('signup', translateAuthError(err));
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '회원가입';
          }
        }
      });

      const nickInput = document.getElementById('signup-nickname');
      if (nickInput) {
        nickInput.addEventListener('input', () => {
          nickInput.setCustomValidity('');
        });
      }
    }
  }

  function openModal(options) {
    const opts = options || {};
    ensureAuthDialog();

    pendingRedirect = opts.redirectTo || null;
    if (pendingResolver) {
      pendingResolver(false);
      pendingResolver = null;
    }

    const noticeEl = document.getElementById('auth-context-notice');
    if (noticeEl) {
      if (opts.notice) {
        noticeEl.textContent = opts.notice;
        noticeEl.hidden = false;
      } else {
        noticeEl.textContent = '';
        noticeEl.hidden = true;
      }
    }

    setMode(opts.mode || 'signin');
    if (!dialogEl.open) {
      dialogEl.showModal();
    }

    return new Promise((resolve) => {
      pendingResolver = resolve;
    });
  }

  async function ensureLoggedIn(options) {
    if (readyPromise) {
      await readyPromise;
    } else if (Store?.initSession) {
      await Store.initSession();
    }
    if (Store?.isAuthenticated?.()) {
      return true;
    }
    return openModal(options);
  }

  function bindHeaderControls() {
    const loginBtn = document.getElementById('auth-login-btn');
    const logoutBtn = document.getElementById('auth-logout-btn');
    const nicknameBtn = document.getElementById('auth-nickname-btn');

    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        openModal({ mode: 'signin' });
      });
    }

    if (nicknameBtn) {
      nicknameBtn.addEventListener('click', () => {
        const user = Store?.getCurrentUser?.();
        const profile = Store?.getCachedProfile?.();
        const nick = getDisplayNickname(user, profile);
        showToast(`${nick}님으로 로그인되어 있어요.`);
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        logoutBtn.disabled = true;
        try {
          await Store.signOut();
          updateHeaderButtons(null, null);
          showToast('로그아웃되었어요.');
        } catch (err) {
          showToast(translateAuthError(err));
        } finally {
          logoutBtn.disabled = false;
        }
      });
    }

    document.querySelectorAll('[data-requires-auth="write"]').forEach((linkEl) => {
      linkEl.addEventListener('click', async (event) => {
        if (readyPromise) {
          if (!Store?.isAuthenticated?.()) {
            event.preventDefault();
            await readyPromise;
            if (Store?.isAuthenticated?.()) {
              global.location.href = linkEl.getAttribute('href') || 'write.html';
              return;
            }
            openModal({
              mode: 'signin',
              redirectTo: linkEl.getAttribute('href') || 'write.html',
              notice: '글쓰기는 로그인 후 이용할 수 있어요.'
            });
          }
          return;
        }

        if (!Store?.isAuthenticated?.()) {
          event.preventDefault();
          openModal({
            mode: 'signin',
            redirectTo: linkEl.getAttribute('href') || 'write.html',
            notice: '글쓰기는 로그인 후 이용할 수 있어요.'
          });
        }
      });
    });
  }

  async function init() {
    if (!Store) return;
    ensureAuthDialog();
    bindHeaderControls();

    Store.onAuthChange(async ({ user, profile }) => {
      if (user && !profile) {
        const fetched = await Store.fetchCurrentProfile().catch(() => null);
        updateHeaderButtons(user, fetched);
      } else {
        updateHeaderButtons(user, profile);
      }
    });

    readyPromise = (async () => {
      await Store.initSession();
      const user = Store.getCurrentUser();
      const profile = user ? await Store.fetchCurrentProfile().catch(() => null) : null;
      updateHeaderButtons(user, profile);
      return { user, profile };
    })();

    await readyPromise;
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
  });

  global.HobakAuth = {
    openModal,
    ensureLoggedIn,
    refreshUI: async function () {
      const user = Store?.getCurrentUser?.() || null;
      const profile = user ? await Store.fetchCurrentProfile().catch(() => null) : null;
      updateHeaderButtons(user, profile);
    },
    getReadyPromise: function () {
      return readyPromise || Promise.resolve(null);
    }
  };
})(window);
