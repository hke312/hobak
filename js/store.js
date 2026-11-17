(function (global) {
  'use strict';

  const STORAGE_KEY = 'hobak_market_products_v1';
  const LIKES_KEY = 'hobak_market_likes_v1';
  const DRAFT_KEY = 'hobak_market_write_draft_v1';
  const ACTOR_KEY = 'hobak_anon_actor_id_v1';

  const CATEGORIES = [
    '디지털기기',
    '생활가전',
    '가구/인테리어',
    '생활/주방',
    '유아동',
    '여성의류',
    '여성잡화',
    '남성패션/잡화',
    '스포츠/레저',
    '취미/게임/음반',
    '도서',
    '반려동물용품',
    '식물',
    '기타 중고물품'
  ];

  const REGIONS = ['전체 동네', '방어진', '화정동', '대송동', '일산동', '전하동'];

  let POPULAR_TAGS = [
    'RC 조종기',
    '자전거',
    '냉장고',
    '세탁기',
    '노트북',
    '키보드',
    '의자',
    '캠핑',
    '니트',
    '가방',
    '책',
    '수신기'
  ];

  let EXTRA_TAGS = ['에어컨', '책상', '소파', '유모차', '모니터', '원목'];

  const min = 60 * 1000;

  const cfg = global.HOBAK_SUPABASE_CONFIG;
  const sb =
    global.supabase && cfg?.url && cfg?.publishableKey
      ? global.supabase.createClient(cfg.url, cfg.publishableKey)
      : null;

  let cachedActorId = null;
  let cachedAuthUser = null;
  let cachedProfile = null;
  let authListenerBound = false;
  const authListeners = new Set();
  let cachedProducts = null;
  let cachedLikedIds = new Set();
  let likesHydrated = false;

  function safeParse(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function generateUuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getOrCreateLocalActorId() {
    if (cachedActorId) return cachedActorId;
    let stored = null;
    try {
      stored = localStorage.getItem(ACTOR_KEY);
    } catch {
      stored = null;
    }
    if (!stored || !/^[0-9a-f-]{36}$/i.test(stored)) {
      stored = generateUuid();
      try {
        localStorage.setItem(ACTOR_KEY, stored);
      } catch {
        // Ignore storage quota errors
      }
    }
    cachedActorId = stored;
    return cachedActorId;
  }

  function notifyAuthListeners() {
    const payload = { user: cachedAuthUser, profile: cachedProfile };
    authListeners.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        // Ignore listener errors
      }
    });
  }

  function extractNicknameFromUser(user) {
    const metaNick = user?.user_metadata?.nickname;
    if (typeof metaNick === 'string' && metaNick.trim()) {
      return metaNick.trim().slice(0, 20);
    }
    const emailLocal = user?.email ? String(user.email).split('@')[0] : '';
    return (emailLocal && emailLocal.trim().slice(0, 20)) || '호박이웃';
  }

  async function ensureProfileForUser(user, explicitNickname) {
    if (!sb || !user?.id) return null;
    const cleanExplicit = typeof explicitNickname === 'string' ? explicitNickname.trim().slice(0, 20) : '';
    const desiredNick = cleanExplicit || extractNicknameFromUser(user);

    const { data: existing } = await sb
      .from('profiles')
      .select('id, nickname, default_region, manner_temp, temp_emoji')
      .eq('id', user.id)
      .maybeSingle();

    if (existing) {
      if (cleanExplicit && existing.nickname !== cleanExplicit) {
        const { data: updated } = await sb
          .from('profiles')
          .update({ nickname: cleanExplicit })
          .eq('id', user.id)
          .select('id, nickname, default_region, manner_temp, temp_emoji')
          .maybeSingle();
        if (updated) {
          return { ...updated, manner_temp: Number(updated.manner_temp ?? 36.5) };
        }
      }
      return { ...existing, manner_temp: Number(existing.manner_temp ?? 36.5) };
    }

    const { data: upserted } = await sb
      .from('profiles')
      .upsert({ id: user.id, nickname: desiredNick }, { onConflict: 'id' })
      .select('id, nickname, default_region, manner_temp, temp_emoji')
      .maybeSingle();

    if (upserted) {
      return { ...upserted, manner_temp: Number(upserted.manner_temp ?? 36.5) };
    }

    const { data: rpcRow } = await sb.rpc('ensure_anon_profile', {
      p_profile_id: user.id,
      p_nickname: desiredNick
    });
    if (rpcRow) {
      return { ...rpcRow, manner_temp: Number(rpcRow.manner_temp ?? 36.5) };
    }

    return {
      id: user.id,
      nickname: desiredNick,
      default_region: '화정동, 대송동',
      manner_temp: 36.5,
      temp_emoji: '😊'
    };
  }

  function bindAuthListener() {
    if (!sb || authListenerBound) return;
    authListenerBound = true;
    sb.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user || null;
      const prevId = cachedAuthUser?.id || null;
      const nextId = nextUser?.id || null;

      cachedAuthUser = nextUser;
      if (nextUser) {
        cachedActorId = nextUser.id;
        if (prevId !== nextId) {
          cachedProfile = null;
        }
      } else {
        cachedActorId = null;
        cachedProfile = null;
        cachedLikedIds = new Set();
        likesHydrated = false;
      }
      notifyAuthListeners();
    });
  }

  async function initSession() {
    if (sb) {
      bindAuthListener();
      try {
        const { data } = await sb.auth.getSession();
        if (data?.session?.user?.id) {
          cachedAuthUser = data.session.user;
          cachedActorId = data.session.user.id;
          return cachedActorId;
        }
      } catch {
        // Fallback to non-PII local UUID
      }
      cachedAuthUser = null;
      cachedProfile = null;
      cachedActorId = null;
    }
    return getOrCreateLocalActorId();
  }

  function getCurrentActorId() {
    if (cachedAuthUser?.id) return cachedAuthUser.id;
    return getOrCreateLocalActorId();
  }

  function isAuthenticated() {
    return Boolean(cachedAuthUser?.id);
  }

  function getCurrentUser() {
    return cachedAuthUser;
  }

  function getCachedProfile() {
    return cachedProfile;
  }

  function onAuthChange(callback) {
    if (typeof callback !== 'function') return function () {};
    authListeners.add(callback);
    return function () {
      authListeners.delete(callback);
    };
  }

  async function signInWithEmail(email, password) {
    if (!sb) {
      throw new Error('Supabase 클라이언트가 초기화되지 않았습니다.');
    }
    const { data, error } = await sb.auth.signInWithPassword({
      email: String(email || '').trim(),
      password: String(password || '')
    });
    if (error) throw error;
    cachedAuthUser = data.user || data.session?.user || null;
    cachedActorId = cachedAuthUser?.id || null;
    cachedProfile = cachedAuthUser ? await ensureProfileForUser(cachedAuthUser) : null;
    notifyAuthListeners();
    return {
      user: cachedAuthUser,
      session: data.session || null,
      profile: cachedProfile
    };
  }

  async function signUpWithEmail(email, password, nickname) {
    if (!sb) {
      throw new Error('Supabase 클라이언트가 초기화되지 않았습니다.');
    }
    const cleanNick = String(nickname || '').trim().slice(0, 20);
    if (!cleanNick) {
      throw new Error('닉네임을 입력해주세요.');
    }
    const { data, error } = await sb.auth.signUp({
      email: String(email || '').trim(),
      password: String(password || ''),
      options: {
        data: {
          nickname: cleanNick
        }
      }
    });
    if (error) throw error;

    if (data?.session?.user) {
      cachedAuthUser = data.session.user;
      cachedActorId = data.session.user.id;
      cachedProfile = await ensureProfileForUser(data.session.user, cleanNick);
      notifyAuthListeners();
    }

    return {
      user: data?.user || null,
      session: data?.session || null,
      profile: cachedProfile
    };
  }

  async function signOut() {
    if (sb) {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
    }
    cachedAuthUser = null;
    cachedProfile = null;
    cachedActorId = null;
    cachedLikedIds = new Set();
    likesHydrated = false;
    notifyAuthListeners();
  }

  function mapDbProduct(row) {
    if (!row) return null;
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : Date.now();
    const bumpedAt = row.bumped_at ? new Date(row.bumped_at).getTime() : createdAt;
    const images = Array.isArray(row.product_images)
      ? row.product_images
          .filter((img) => img && img.is_active !== false && img.storage_path)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((img) => img.storage_path)
      : [];

    return {
      id: row.id,
      sellerId: row.seller_id,
      title: row.title,
      category: row.category,
      tradeType: row.trade_type || 'sell',
      price: Number(row.price ?? 0),
      negotiable: Boolean(row.negotiable),
      condition: row.condition || '중고',
      location: row.location,
      region: row.region,
      status: row.status || 'available',
      bumpedAt,
      createdAt,
      bumpedLabel: bumpedAt > createdAt + min ? '끌올 ' + formatRelativeTime(bumpedAt) : null,
      likes: Number(row.likes_count ?? 0),
      chats: Number(row.chats_count ?? 0),
      views: Number(row.views_count ?? 0),
      seller: {
        id: row.seller?.id || row.seller_id,
        name: row.seller?.nickname || '헤엄치는오리',
        temp: Number(row.seller?.manner_temp ?? 37.2),
        emoji: row.seller?.temp_emoji || '😊'
      },
      images: images.length > 0 ? images : ['assets/products/rc-1.svg'],
      description: row.description || ''
    };
  }

  const PRODUCT_SELECT =
    'id, seller_id, title, category, trade_type, price, negotiable, condition, location, region, status, description, likes_count, chats_count, views_count, bumped_at, created_at, seller:profiles!seller_id(id, nickname, default_region, manner_temp, temp_emoji), product_images(storage_path, sort_order, is_active)';

  function upsertCacheItem(item) {
    if (!item) return;
    if (!Array.isArray(cachedProducts)) {
      cachedProducts = [item];
      return;
    }
    const idx = cachedProducts.findIndex((p) => p.id === item.id);
    if (idx === -1) {
      cachedProducts.unshift(item);
    } else {
      cachedProducts[idx] = item;
    }
  }

  async function fetchProducts() {
    if (!sb) {
      cachedProducts = safeParse(localStorage.getItem(STORAGE_KEY), []);
      return cachedProducts;
    }
    const { data, error } = await sb
      .from('products')
      .select(PRODUCT_SELECT)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }
    cachedProducts = (data || []).map(mapDbProduct);
    return cachedProducts;
  }

  function getProducts() {
    if (Array.isArray(cachedProducts)) return cachedProducts;
    return safeParse(localStorage.getItem(STORAGE_KEY), []);
  }

  async function fetchProductById(id) {
    if (!id) return null;
    if (!sb) {
      return getProducts().find((item) => item.id === id) || null;
    }
    const { data, error } = await sb
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw error;
    }
    const mapped = mapDbProduct(data);
    if (mapped) upsertCacheItem(mapped);
    return mapped;
  }

  function getProductById(id) {
    return getProducts().find((item) => item.id === id) || null;
  }

  async function incrementViews(id) {
    if (!sb || !id) return null;
    const { data, error } = await sb.rpc('increment_product_views', {
      target_product_id: id
    });
    if (error) return null;
    const item = getProductById(id);
    if (item && typeof data === 'number') {
      item.views = data;
    }
    return data;
  }

  async function fetchPopularTags() {
    if (!sb) {
      return { popular: POPULAR_TAGS, extra: EXTRA_TAGS };
    }
    const { data, error } = await sb
      .from('popular_keywords')
      .select('keyword, is_featured, sort_order, search_count')
      .order('is_featured', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('search_count', { ascending: false })
      .limit(24);

    if (error || !Array.isArray(data) || data.length === 0) {
      return { popular: POPULAR_TAGS, extra: EXTRA_TAGS };
    }

    const featured = data.filter((row) => row.is_featured).map((row) => row.keyword);
    const extra = data.filter((row) => !row.is_featured).map((row) => row.keyword);

    if (featured.length > 0) {
      POPULAR_TAGS = featured;
      EXTRA_TAGS = extra;
    } else {
      POPULAR_TAGS = data.slice(0, 12).map((row) => row.keyword);
      EXTRA_TAGS = data.slice(12).map((row) => row.keyword);
    }

    global.HobakStore.POPULAR_TAGS = POPULAR_TAGS;
    global.HobakStore.EXTRA_TAGS = EXTRA_TAGS;
    return { popular: POPULAR_TAGS, extra: EXTRA_TAGS };
  }

  async function recordSearchKeyword(keyword) {
    const cleaned = String(keyword || '').trim();
    if (!sb || !cleaned) return;
    try {
      await sb.rpc('record_search_keyword', { target_keyword: cleaned });
    } catch {
      // Non-critical analytics
    }
  }

  async function fetchCurrentProfile() {
    const actorId = await initSession();
    if (!sb) {
      return {
        id: actorId,
        nickname: '헤엄치는오리',
        default_region: '화정동, 대송동',
        manner_temp: 37.2,
        temp_emoji: '😊'
      };
    }

    if (cachedAuthUser) {
      const profile = await ensureProfileForUser(cachedAuthUser);
      cachedProfile = profile;
      return profile;
    }

    const { data, error } = await sb
      .from('profiles')
      .select('id, nickname, default_region, manner_temp, temp_emoji')
      .eq('id', actorId)
      .maybeSingle();

    if (error || !data) {
      return {
        id: actorId,
        nickname: '헤엄치는오리',
        default_region: '화정동, 대송동',
        manner_temp: 37.2,
        temp_emoji: '😊'
      };
    }
    return {
      ...data,
      manner_temp: Number(data.manner_temp ?? 37.2)
    };
  }

  async function fetchUserLikes() {
    const actorId = await initSession();
    if (!sb) {
      const map = safeParse(localStorage.getItem(LIKES_KEY), {});
      cachedLikedIds = new Set(Object.keys(map).filter((k) => map[k]));
      likesHydrated = true;
      return cachedLikedIds;
    }
    const { data, error } = await sb.rpc('get_user_liked_product_ids', {
      p_user_id: actorId
    });
    if (!error && Array.isArray(data)) {
      cachedLikedIds = new Set(data);
      likesHydrated = true;
    }
    return cachedLikedIds;
  }

  function isLiked(id) {
    if (likesHydrated) return cachedLikedIds.has(id);
    const map = safeParse(localStorage.getItem(LIKES_KEY), {});
    return Boolean(map[id]);
  }

  async function toggleLike(id) {
    const actorId = await initSession();
    if (!sb) {
      const likesMap = safeParse(localStorage.getItem(LIKES_KEY), {});
      const nextState = !likesMap[id];
      likesMap[id] = nextState;
      localStorage.setItem(LIKES_KEY, JSON.stringify(likesMap));
      if (nextState) cachedLikedIds.add(id);
      else cachedLikedIds.delete(id);
      return nextState;
    }

    const { data: nextState, error } = await sb.rpc('toggle_product_like', {
      p_user_id: actorId,
      p_product_id: id
    });
    if (error) throw error;

    const liked = Boolean(nextState);
    if (liked) cachedLikedIds.add(id);
    else cachedLikedIds.delete(id);
    likesHydrated = true;

    const item = getProductById(id);
    if (item) {
      item.likes = Math.max(0, (item.likes || 0) + (liked ? 1 : -1));
    }
    return liked;
  }

  async function uploadImageBlob(blob, ext) {
    if (!sb) return null;
    const actorId = await initSession();
    const safeExt = (ext || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
    const prefix = isAuthenticated() ? actorId : `uploads/${actorId}`;
    const fileName = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

    const { error } = await sb.storage.from('product-images').upload(fileName, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: false
    });
    if (error) throw error;

    const { data } = sb.storage.from('product-images').getPublicUrl(fileName);
    return data?.publicUrl || null;
  }

  async function addProduct(data) {
    const actorId = await initSession();
    if (!sb) {
      throw new Error('Supabase 클라이언트가 초기화되지 않았습니다.');
    }

    const tradeType = data.tradeType === 'share' ? 'share' : 'sell';
    const images =
      Array.isArray(data.images) && data.images.length > 0
        ? data.images.slice(0, 10)
        : ['assets/products/rc-1.svg'];

    const { data: newId, error } = await sb.rpc('create_product_post', {
      p_seller_id: actorId,
      p_nickname: (data.sellerName || '헤엄치는오리').trim(),
      p_title: data.title.trim(),
      p_category: data.category,
      p_trade_type: tradeType,
      p_price: tradeType === 'share' ? 0 : Number(data.price) || 0,
      p_negotiable: tradeType === 'share' ? false : Boolean(data.negotiable),
      p_condition: data.condition || '중고',
      p_location: data.location.trim(),
      p_description: data.description.trim(),
      p_images: images
    });

    if (error) throw error;
    return (await fetchProductById(newId)) || { id: newId };
  }

  async function updateProduct(id, patch) {
    const actorId = await initSession();
    if (!sb) {
      throw new Error('Supabase 클라이언트가 초기화되지 않았습니다.');
    }

    const { error } = await sb.rpc('update_product_post', {
      p_seller_id: actorId,
      p_product_id: id,
      p_title: patch.title ?? null,
      p_category: patch.category ?? null,
      p_trade_type: patch.tradeType ?? null,
      p_price: patch.price !== undefined ? Number(patch.price) : null,
      p_negotiable: patch.negotiable !== undefined ? Boolean(patch.negotiable) : null,
      p_condition: patch.condition ?? null,
      p_location: patch.location ?? null,
      p_status: patch.status ?? null,
      p_description: patch.description ?? null,
      p_nickname: patch.seller?.name ?? null,
      p_images: Array.isArray(patch.images) ? patch.images.slice(0, 10) : null
    });

    if (error) throw error;
    return await fetchProductById(id);
  }

  async function deleteProduct(id) {
    const actorId = await initSession();
    if (!sb) {
      throw new Error('Supabase 클라이언트가 초기화되지 않았습니다.');
    }

    const { error } = await sb.rpc('delete_product_post', {
      p_seller_id: actorId,
      p_product_id: id
    });
    if (error) throw error;
    if (Array.isArray(cachedProducts)) {
      cachedProducts = cachedProducts.filter((item) => item.id !== id);
    }
    return true;
  }

  async function fetchChatMessages(productId) {
    if (!sb) return [];
    const actorId = await initSession();
    const { data, error } = await sb.rpc('get_chat_messages_for_product', {
      p_actor_id: actorId,
      p_product_id: productId
    });
    if (error) return [];
    return Array.isArray(data) ? data : [];
  }

  async function sendChatMessage(productId, content) {
    if (!sb) {
      throw new Error('Supabase 클라이언트가 초기화되지 않았습니다.');
    }
    const actorId = await initSession();
    const { data, error } = await sb.rpc('send_chat_message', {
      p_sender_id: actorId,
      p_product_id: productId,
      p_content: content
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    const item = getProductById(productId);
    if (item && row && typeof row.chats_count === 'number') {
      item.chats = row.chats_count;
    }
    return row;
  }

  function getDraft() {
    return safeParse(localStorage.getItem(DRAFT_KEY), null);
  }

  async function fetchDraft() {
    const local = getDraft();
    if (!sb) return local;
    try {
      const actorId = await initSession();
      const { data, error } = await sb.rpc('get_product_draft', { p_user_id: actorId });
      if (!error && data && typeof data === 'object' && Object.keys(data).length > 0) {
        return data;
      }
    } catch {
      // Fallback to local draft
    }
    return local;
  }

  async function saveDraft(draft) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    if (!sb) return;
    const actorId = await initSession();
    const { error } = await sb.rpc('save_product_draft', {
      p_user_id: actorId,
      p_draft_data: draft
    });
    if (error) throw error;
  }

  async function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    if (!sb) return;
    try {
      const actorId = await initSession();
      await sb.rpc('clear_product_draft', { p_user_id: actorId });
    } catch {
      // Non-critical
    }
  }

  function formatPrice(price, tradeType) {
    if (tradeType === 'share' || Number(price) === 0) {
      return '나눔';
    }
    return Number(price).toLocaleString('ko-KR') + '원';
  }

  function formatRelativeTime(createdAt, fallbackLabel) {
    if (fallbackLabel) {
      return fallbackLabel;
    }
    const diff = Math.max(0, Date.now() - Number(createdAt || Date.now()));
    const mins = Math.floor(diff / min);
    if (mins < 1) return '방금 전';
    if (mins < 60) return mins + '분 전';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + '시간 전';
    const days = Math.floor(hrs / 24);
    return days + '일 전';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  const STATUS_META = {
    available: { label: '판매중', badgeClass: 'status-badge--available' },
    reserved: { label: '예약중', badgeClass: 'status-badge--reserved' },
    sold: { label: '거래완료', badgeClass: 'status-badge--sold' }
  };

  function getStatusMeta(status) {
    return STATUS_META[status] || STATUS_META.available;
  }

  function getStatusBadgesHtml(item, extraClass) {
    const meta = getStatusMeta(item?.status);
    const cls = extraClass ? ` ${extraClass}` : '';
    const badges = [
      `<span class="status-badge ${meta.badgeClass}${cls}">${escapeHtml(meta.label)}</span>`
    ];
    if (item?.tradeType === 'share') {
      badges.push(`<span class="status-badge status-badge--share${cls}">나눔</span>`);
    }
    return badges.join('');
  }

  global.HobakStore = {
    CATEGORIES,
    REGIONS,
    POPULAR_TAGS,
    EXTRA_TAGS,
    hasSupabase: function () {
      return Boolean(sb);
    },
    initSession,
    isAuthenticated,
    getCurrentUser,
    getCurrentActorId,
    getCachedProfile,
    onAuthChange,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    fetchCurrentProfile,
    fetchProducts,
    getProducts,
    fetchProductById,
    getProductById,
    incrementViews,
    fetchPopularTags,
    recordSearchKeyword,
    addProduct,
    updateProduct,
    deleteProduct,
    uploadImageBlob,
    fetchUserLikes,
    isLiked,
    toggleLike,
    fetchChatMessages,
    sendChatMessage,
    getDraft,
    fetchDraft,
    saveDraft,
    clearDraft,
    formatPrice,
    formatRelativeTime,
    escapeHtml,
    getStatusMeta,
    getStatusBadgesHtml
  };
})(window);
