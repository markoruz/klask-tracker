/* =============================================================================
   KLASKLIGAN — shared.js
   Gemensam kod för index.html, player.html, players.html och lottning.html.
   Exponerar ett enda globalt namespace: window.Klask
   Laddas som klassiskt script EFTER Supabase-SDK:n:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="shared.js"></script>
   Inga ES-moduler (filerna ska kunna öppnas direkt från disk).
   ============================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------------
     1. Supabase-klient (enda källan för URL + anon key)
     --------------------------------------------------------------------------- */
  const SUPABASE_URL = 'https://kqfrpvlelpoabfpkqjwn.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxZnJwdmxlbHBvYWJmcGtxanduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MDI3OTMsImV4cCI6MjEwMzQ3ODc5M30.GS747AnOYChYZbpvwKMrrEwQcDMaIBIP5apFlhczPi0';

  const sdk = window.supabase;
  if (!sdk || typeof sdk.createClient !== 'function') {
    console.error('Supabase-SDK:n är inte laddad. Ladda supabase-js före shared.js.');
  }
  const sb = (sdk && typeof sdk.createClient === 'function')
    ? sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  /* ---------------------------------------------------------------------------
     2. Små hjälpfunktioner
     --------------------------------------------------------------------------- */
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));

  // Text som ska hamna i en JS-sträng inuti ett HTML-attribut (onerror=...).
  // Citattecken/backslash tas bort helt så att attributet aldrig kan brytas.
  const escAttrJs = s => esc(String(s ?? '').replace(/[\\'"`]/g, ''));

  let toastTimer = null;
  function toastElement() {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(t);
    }
    return t;
  }
  /** Notis nere till höger (samma utseende/timing som index.html hade). */
  function toast(msg) {
    const t = toastElement();
    t.textContent = String(msg ?? '');
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /** "Anna Andersson" -> "AA". Max antal tecken styrs av max (default 2). */
  function initials(name, max) {
    const n = Number(max) > 0 ? Number(max) : 2;
    const out = String(name || '?')
      .split(/\s+/).filter(Boolean)
      .map(x => x[0]).join('')
      .slice(0, n).toUpperCase();
    return out || '?';
  }

  /* ---------------------------------------------------------------------------
     3. Avatar — EN implementation (ersätter de 5 gamla varianterna)
     --------------------------------------------------------------------------- */
  /**
   * @param {{id:number|string,name:string}} player
   * @param {{image_url?:string}|null|undefined} profile  profilrad från klask_player_profiles
   * @param {{className?:string,maxInitials?:number,alt?:string,lazy?:boolean}} [opts]
   * @returns {string} HTML-sträng
   */
  function renderAvatar(player, profile, opts) {
    const o = opts || {};
    const p = player || {};
    const cls = o.className || 'avatar';
    const url = String((profile && profile.image_url) || p.image_url || '').trim();
    const fallback = initials(p.name, o.maxInitials);
    const alt = o.alt != null ? o.alt : '';
    if (url) {
      const loading = o.lazy === false ? '' : ' loading="lazy"';
      return `<span class="${esc(cls)}"><img src="${esc(url)}" alt="${esc(alt)}"${loading} referrerpolicy="no-referrer" onerror="this.parentElement.textContent='${escAttrJs(fallback)}'"></span>`;
    }
    return `<span class="${esc(cls)}" aria-hidden="true">${esc(fallback)}</span>`;
  }

  /* ---------------------------------------------------------------------------
     4. Auth — cachad adminkontroll (fixar dubbelanropet i player.html)
     --------------------------------------------------------------------------- */
  let adminCache = null;             // null = okänt, true/false = cachat svar
  let adminInFlight = null;          // dedupar parallella anrop
  const canEditCache = new Map();    // playerId -> boolean
  let myPlayerIdCache = undefined;   // undefined = ej hämtat, null = ingen koppling, number = spelar-id
  let myPlayerIdInFlight = null;

  function invalidateAuthCaches() {
    adminCache = null;
    adminInFlight = null;
    canEditCache.clear();
    myPlayerIdCache = undefined;
    myPlayerIdInFlight = null;
    myPlayerNameCache.clear();
  }

  async function getSession() {
    if (!sb) return { data: { session: null }, error: new Error('Supabase saknas') };
    return sb.auth.getSession();
  }

  async function currentSession(sessionOverride) {
    if (sessionOverride !== undefined) return sessionOverride;
    const { data } = await getSession();
    return (data && data.session) || null;
  }

  /**
   * Är den inloggade användaren Klask-admin? Resultatet cachas per session och
   * nollställs automatiskt vid inloggning/utloggning, så RPC:n körs bara en gång.
   * @param {object} [sessionOverride] redan hämtad session (sparar ett anrop)
   */
  async function isAdmin(sessionOverride) {
    if (adminCache !== null) return adminCache;
    if (adminInFlight) return adminInFlight;
    adminInFlight = (async () => {
      const session = await currentSession(sessionOverride);
      if (!session) { adminCache = false; return false; }
      const { data, error } = await sb.rpc('is_klask_admin');
      if (error) {
        // Cacha inte fel – ett tillfälligt nätverksfel ska kunna göras om.
        console.error('Kunde inte kontrollera adminroll', error);
        return false;
      }
      adminCache = data === true;
      return adminCache;
    })();
    try { return await adminInFlight; }
    finally { adminInFlight = null; }
  }

  /** Får den inloggade användaren redigera den här spelarprofilen? (cachas) */
  async function canEditPlayer(playerId) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return false;
    if (canEditCache.has(id)) return canEditCache.get(id);
    const session = await currentSession();
    if (!session) { canEditCache.set(id, false); return false; }
    const { data, error } = await sb.rpc('can_edit_klask_player', { p_player_id: id });
    if (error) {
      console.error('Kunde inte kontrollera redigeringsbehörighet', error);
      return false;
    }
    const allowed = data === true;
    canEditCache.set(id, allowed);
    return allowed;
  }

  /**
   * Vilket spelar-id är den inloggade användaren kopplad till (klask_player_accounts)?
   * null = inloggad men ingen koppling ännu (visa claim.html). Cachas per session.
   */
  async function myPlayerId(sessionOverride) {
    if (myPlayerIdCache !== undefined) return myPlayerIdCache;
    if (myPlayerIdInFlight) return myPlayerIdInFlight;
    myPlayerIdInFlight = (async () => {
      const session = await currentSession(sessionOverride);
      if (!session) { myPlayerIdCache = null; return null; }
      const { data, error } = await sb.from('klask_player_accounts')
        .select('player_id').eq('user_id', session.user.id).maybeSingle();
      if (error) {
        console.error('Kunde inte hämta kopplad spelarprofil', error);
        return null;
      }
      myPlayerIdCache = data ? Number(data.player_id) : null;
      return myPlayerIdCache;
    })();
    try { return await myPlayerIdInFlight; }
    finally { myPlayerIdInFlight = null; }
  }

  /** Kopplar den inloggade användaren till en (ledig) spelarprofil. */
  async function claimPlayer(playerId) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return { data: null, error: new Error('Ogiltigt spelar-id') };
    const { data, error } = await sb.rpc('claim_klask_player', { p_player_id: id });
    if (!error && data === true) myPlayerIdCache = id;
    return { data, error };
  }

  async function signIn(email, password) {
    return sb.auth.signInWithPassword({ email, password });
  }
  async function signUp(email, password) {
    return sb.auth.signUp({ email, password });
  }
  async function signOut() {
    invalidateAuthCaches();
    return sb.auth.signOut();
  }
  /**
   * Lyssna på inloggning/utloggning. Callbacken körs uppskjuten (setTimeout 0)
   * eftersom supabase-js v2 kan låsa sig om man anropar auth-API:er direkt
   * inuti en onAuthStateChange-callback.
   */
  function onChange(callback) {
    if (!sb) return { data: { subscription: { unsubscribe() {} } } };
    return sb.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        try { callback(event, session); }
        catch (e) { console.error('Fel i auth-lyssnare', e); }
      }, 0);
    });
  }

  // Master-lyssnare: nollställ cachen FÖRE sidornas (uppskjutna) callbacks.
  if (sb) sb.auth.onAuthStateChange(() => { invalidateAuthCaches(); });

  const auth = {
    signIn, signUp, signOut, getSession, onChange, isAdmin, canEditPlayer,
    myPlayerId, claimPlayer, invalidateCache: invalidateAuthCaches
  };

  /* ---------------------------------------------------------------------------
     5. Tema (ljust/mörkt)
     Attributet <html data-theme="dark"> styr CSS-tokens i global.css. Sparas i
     localStorage så det överlever sidnavigering (statiska sidor, ingen SPA).
     Varje sidas <head> sätter attributet synkront innan render för att undvika
     flimmer — se den lilla inline-scripten längst upp i varje HTML-fil.
     --------------------------------------------------------------------------- */
  const THEME_KEY = 'klask-theme';

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function syncThemeButton() {
    const btn = document.getElementById('siteThemeToggle');
    if (!btn) return;
    const dark = getTheme() === 'dark';
    btn.textContent = dark ? '☀️' : '🌙';
    const label = dark ? 'Byt till ljust läge' : 'Byt till mörkt läge';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
  function setTheme(theme) {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* privat läge etc. */ }
    syncThemeButton();
    document.dispatchEvent(new CustomEvent('klask:themechange', { detail: { theme } }));
  }
  function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }
  function onThemeChange(cb) {
    document.addEventListener('klask:themechange', e => cb(e.detail.theme));
  }

  /* ---------------------------------------------------------------------------
     6. Header/nav + inloggningsmodal (injiceras i platshållare)
     --------------------------------------------------------------------------- */
  const NAV_LINKS = [
    { page: 'index', href: 'index.html', label: 'Tabell' },
    { page: 'players', href: 'players.html', label: 'Spelarprofiler' },
    { page: 'highlights', href: 'highlights.html', label: 'Highlights' },
    { page: 'lottning', href: 'lottning.html', label: 'Lottning', id: 'lotteryNavLink', adminOnly: true }
  ];

  let headerSignedIn = false;
  let authModalMounted = false;
  let authModalOptions = {};

  function slot(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      (document.body || document.documentElement).appendChild(el);
    }
    return el;
  }

  function headerMarkup(activePage) {
    // player.html räknas som "Spelarprofiler" i navigationen (som idag).
    const active = activePage === 'player' ? 'players' : String(activePage || '');
    const links = NAV_LINKS.map(n => {
      const classes = [];
      if (n.adminOnly) classes.push('admin-only-nav');
      if (n.page === active) classes.push('active');
      const attrs = [
        n.id ? `id="${n.id}"` : '',
        classes.length ? `class="${classes.join(' ')}"` : '',
        `href="${n.href}"`
      ].filter(Boolean).join(' ');
      return `<a ${attrs}>${esc(n.label)}</a>`;
    }).join('');
    return `<header class="site-header"><div class="site-header-inner">` +
      `<div class="site-header-left">` +
      `<a class="site-brand" href="index.html" aria-label="Klaskligan startsida">KLASKLIGAN</a>` +
      `<nav class="site-nav" aria-label="Huvudmeny">${links}</nav>` +
      `</div>` +
      `<div class="site-header-right">` +
      `<button id="siteThemeToggle" type="button" class="site-theme-toggle" aria-label="Byt tema" title="Byt tema"></button>` +
      `<div class="site-auth-menu">` +
      `<button id="siteAuthBtn" type="button" class="site-admin-link site-auth-btn">` +
      `<span class="chev-label">Logga in</span><span class="chev">&#9662;</span></button>` +
      `<div id="siteAuthDropdown" class="site-auth-dropdown hidden" role="menu">` +
      `<a id="siteAuthMyAccount" class="site-auth-dropdown-item" href="claim.html" role="menuitem">Min profil</a>` +
      `<a class="site-auth-dropdown-item" href="settings.html" role="menuitem">Inställningar</a>` +
      `<button id="siteAuthSignOut" type="button" class="site-auth-dropdown-item" role="menuitem">Logga ut</button>` +
      `</div>` +
      `</div>` +
      `</div>` +
      `</div></header>`;
  }

  /** Cache för det egna spelarnamnet (visas i inloggningsknappen istället för "Logga ut"). */
  let myPlayerNameCache = new Map(); // playerId -> name

  /** Slår upp namnet för den inloggade användarens kopplade spelare (om någon). */
  async function myPlayerName(sessionOverride) {
    const id = await myPlayerId(sessionOverride);
    if (id == null) return null;
    if (myPlayerNameCache.has(id)) return myPlayerNameCache.get(id);
    const { data } = await loadState();
    const p = (data.players || []).find(pl => Number(pl.id) === Number(id));
    const name = p ? p.name : null;
    if (name) myPlayerNameCache.set(id, name);
    return name;
  }

  async function syncAuthButton(sessionOverride) {
    const btn = document.getElementById('siteAuthBtn');
    const label = btn && btn.querySelector('.chev-label');
    if (!label) return;
    if (!headerSignedIn) { label.textContent = 'Logga in'; return; }
    const name = await myPlayerName(sessionOverride);
    label.textContent = name || 'Min profil';
  }

  function closeAuthDropdown() {
    const d = document.getElementById('siteAuthDropdown');
    if (d) d.classList.add('hidden');
  }

  /**
   * Läs om sessionen, uppdatera inloggningsknappen (namn/"Logga in") och
   * body.is-admin (som styr synligheten för Lottning-länken via .admin-only-nav).
   * @returns {Promise<{signedIn:boolean,isAdmin:boolean,session:object|null}>}
   */
  async function refreshAuthUI(sessionOverride) {
    const session = await currentSession(sessionOverride);
    headerSignedIn = !!session;
    const admin = session ? await isAdmin(session) : false;
    if (document.body) document.body.classList.toggle('is-admin', admin);
    await syncAuthButton(session);
    await syncMyAccountLink(session);
    if (!headerSignedIn) closeAuthDropdown();
    return { signedIn: headerSignedIn, isAdmin: admin, session };
  }

  /** Pekar "Min profil"-länken i dropdownen mot player.html?id=... om kopplad, annars claim.html. */
  async function syncMyAccountLink(session) {
    const link = document.getElementById('siteAuthMyAccount');
    if (!link) return;
    if (!session) { link.setAttribute('href', 'claim.html'); return; }
    const pid = await myPlayerId(session);
    link.setAttribute('href', pid != null ? `player.html?id=${pid}` : 'claim.html');
  }

  /**
   * Injicera header/nav i <div id="site-header-slot"></div>.
   * @param {'index'|'players'|'player'|'lottning'} activePage
   */
  async function mountHeader(activePage) {
    slot('site-header-slot').innerHTML = headerMarkup(activePage);
    const btn = document.getElementById('siteAuthBtn');
    const dropdown = document.getElementById('siteAuthDropdown');
    const signOutBtn = document.getElementById('siteAuthSignOut');
    if (btn) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!headerSignedIn) { openAuthModal(); return; }
        if (dropdown) dropdown.classList.toggle('hidden');
      });
    }
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        await signOut();
        location.href = 'index.html';
      });
    }
    // Stäng dropdownen vid klick utanför eller Escape.
    document.addEventListener('click', e => {
      if (dropdown && !dropdown.classList.contains('hidden') && e.target !== btn && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAuthDropdown(); });
    const themeBtn = document.getElementById('siteThemeToggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', toggleTheme);
      syncThemeButton();
    }
    // Håll header + body.is-admin i synk vid in-/utloggning i vilken flik som helst.
    onChange(async (_event, session) => {
      await refreshAuthUI(session || null);
      if (!session) closeAuthModal();
    });
    const state = await refreshAuthUI();
    // index.html öppnade inloggningen automatiskt på #admin (t.ex. från lottning.html).
    if (location.hash === '#admin' && !state.signedIn) openAuthModal();
    return state;
  }

  let authMode = 'signin'; // 'signin' | 'signup'

  function authModalMarkup() {
    return `<div id="authModal" class="modal modal-auth hidden" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">` +
      `<div class="modal-card modal-card-sm panel">` +
      `<button id="authModalClose" class="modal-close" type="button" aria-label="Stäng">&times;</button>` +
      `<h2 id="authModalTitle" class="modal-title">Logga in</h2>` +
      `<div class="field"><label for="siteAuthEmail">E-post</label>` +
      `<input id="siteAuthEmail" type="email" placeholder="E-post" autocomplete="username"></div>` +
      `<div class="field"><label for="siteAuthPassword">Lösenord</label>` +
      `<input id="siteAuthPassword" type="password" placeholder="Lösenord" autocomplete="current-password"></div>` +
      `<button id="siteAuthSubmit" class="btn btn-primary btn-block" type="button">Logga in</button>` +
      `<div id="siteAuthError" class="form-error" role="alert"></div>` +
      `<button id="siteAuthModeToggle" class="auth-mode-toggle" type="button">Ny här? Skapa konto</button>` +
      `</div></div>`;
  }

  /** Växlar modalens läge mellan inloggning och kontoskapande. */
  function setAuthMode(mode) {
    authMode = mode === 'signup' ? 'signup' : 'signin';
    const title = document.getElementById('authModalTitle');
    const submit = document.getElementById('siteAuthSubmit');
    const toggle = document.getElementById('siteAuthModeToggle');
    const passEl = document.getElementById('siteAuthPassword');
    const err = document.getElementById('siteAuthError');
    if (title) title.textContent = authMode === 'signup' ? 'Skapa konto' : 'Logga in';
    if (submit) submit.textContent = authMode === 'signup' ? 'Skapa konto' : 'Logga in';
    if (toggle) toggle.textContent = authMode === 'signup' ? 'Har du redan ett konto? Logga in' : 'Ny här? Skapa konto';
    if (passEl) passEl.setAttribute('autocomplete', authMode === 'signup' ? 'new-password' : 'current-password');
    if (err) err.textContent = '';
  }

  /**
   * @param {'signin'|'signup'} [mode] vilket läge modalen ska öppnas i (default 'signin').
   */
  function openAuthModal(mode) {
    const m = document.getElementById('authModal');
    if (!m) return;
    setAuthMode(mode || 'signin');
    m.classList.remove('hidden');
    document.body.classList.add('modal-open');
    setTimeout(() => { const e = document.getElementById('siteAuthEmail'); if (e) e.focus(); }, 40);
  }
  function closeAuthModal() {
    const m = document.getElementById('authModal');
    if (m) m.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  /** @param {string|function(object):string} message statisk text eller (state)=>text */
  async function finishSignedInSubmit(message) {
    invalidateAuthCaches();
    const state = await refreshAuthUI();
    toast(typeof message === 'function' ? message(state) : message);
    if (typeof authModalOptions.onSignIn === 'function') authModalOptions.onSignIn(state);
    else if (authModalOptions.reloadOnSignIn) location.reload();
    return state;
  }

  async function submitAuthModal() {
    const emailEl = document.getElementById('siteAuthEmail');
    const passEl = document.getElementById('siteAuthPassword');
    const err = document.getElementById('siteAuthError');
    const email = emailEl ? emailEl.value.trim() : '';
    const password = passEl ? passEl.value : '';
    if (err) err.textContent = '';
    if (!email || !password) {
      if (err) err.textContent = 'Fyll i e-post och lösenord.';
      return false;
    }

    if (authMode === 'signup') {
      const { data, error } = await signUp(email, password);
      if (error) {
        if (err) err.textContent = 'Kunde inte skapa konto: ' + error.message;
        return false;
      }
      if (!data || !data.session) {
        // E-postbekräftelse krävs (styrs i Supabase Auth-inställningarna) — ingen session än.
        toast('Konto skapat! Kolla din e-post för att bekräfta kontot innan du loggar in.');
        setAuthMode('signin');
        return true;
      }
      if (passEl) passEl.value = '';
      closeAuthModal();
      await finishSignedInSubmit('Konto skapat och inloggad.');
      return true;
    }

    const { error } = await signIn(email, password);
    if (error) {
      if (err) err.textContent = 'Kunde inte logga in: ' + error.message;
      return false;
    }
    if (passEl) passEl.value = '';
    closeAuthModal();
    await finishSignedInSubmit(state => state.isAdmin ? 'Inloggad som admin.' : 'Inloggad.');
    return true;
  }

  /**
   * Injicera EN gemensam inloggningsmodal i <div id="auth-modal-slot"></div>.
   * @param {{reloadOnSignIn?:boolean,onSignIn?:function}} [options]
   *        reloadOnSignIn: ladda om sidan efter lyckad inloggning
   *        (players.html/player.html gjorde det förut). onSignIn tar över helt.
   *        Utan någotdera uppdateras bara header/adminläge och sidan får
   *        själv rendera om via Klask.auth.onChange.
   */
  function mountAuthModal(options) {
    authModalOptions = options || {};
    if (authModalMounted) return;
    authModalMounted = true;
    slot('auth-modal-slot').innerHTML = authModalMarkup();
    const modal = document.getElementById('authModal');
    const close = document.getElementById('authModalClose');
    const submit = document.getElementById('siteAuthSubmit');
    const pass = document.getElementById('siteAuthPassword');
    const modeToggle = document.getElementById('siteAuthModeToggle');
    if (close) close.addEventListener('click', closeAuthModal);
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeAuthModal(); });
    if (submit) submit.addEventListener('click', submitAuthModal);
    if (pass) pass.addEventListener('keydown', e => { if (e.key === 'Enter') submitAuthModal(); });
    if (modeToggle) modeToggle.addEventListener('click', () => setAuthMode(authMode === 'signup' ? 'signin' : 'signup'));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeAuthModal();
    });
  }

  /* ---------------------------------------------------------------------------
     7. Datanormalisering (flyttad från index.html, oförändrat beteende)
     --------------------------------------------------------------------------- */
  function currentSeasonKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function emptyData() {
    return {
      players: [], rounds: [], nextPlayerId: 1, nextRoundId: 1,
      listName: '',
      seasonKey: currentSeasonKey(),
      periodClosed: false,
      periodStartedAt: new Date().toISOString(),
      periodEndedAt: null,
      periodPlannedEndAt: null,
      inactivePlayerIds: []
    };
  }

  /** Identisk logik med gamla index.html normalizeLoaded(x). */
  function normalizeLoaded(x) {
    x = x || {};
    let seasonKey = typeof x.seasonKey === 'string' ? x.seasonKey : '';
    if (!seasonKey && Array.isArray(x.rounds) && x.rounds.length) {
      const dated = x.rounds.map(r => new Date(r.played_at)).filter(d => !Number.isNaN(d.getTime())).sort((a, b) => b - a);
      if (dated.length) seasonKey = currentSeasonKey(dated[0]);
    }
    if (!seasonKey) seasonKey = currentSeasonKey();
    return {
      players: Array.isArray(x.players) ? x.players : [],
      rounds: Array.isArray(x.rounds) ? x.rounds : [],
      nextPlayerId: Number(x.nextPlayerId) || 1,
      nextRoundId: Number(x.nextRoundId) || 1,
      listName: typeof x.listName === 'string' ? x.listName : '',
      seasonKey,
      periodClosed: x.periodClosed === true,
      periodStartedAt: (() => {
        if (typeof x.periodStartedAt === 'string' && x.periodStartedAt) return x.periodStartedAt;
        const dated = (Array.isArray(x.rounds) ? x.rounds : []).map(r => new Date(r.played_at)).filter(d => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
        return dated.length ? dated[0].toISOString() : new Date().toISOString();
      })(),
      periodEndedAt: typeof x.periodEndedAt === 'string' && x.periodEndedAt ? x.periodEndedAt : null,
      periodPlannedEndAt: typeof x.periodPlannedEndAt === 'string' && x.periodPlannedEndAt ? x.periodPlannedEndAt : null,
      inactivePlayerIds: Array.isArray(x.inactivePlayerIds) ? x.inactivePlayerIds.map(Number).filter(Number.isFinite) : [],
      pendingDraw: (x.pendingDraw && Array.isArray(x.pendingDraw.player_ids))
        ? { player_ids: x.pendingDraw.player_ids.map(Number).filter(Number.isFinite), created_at: x.pendingDraw.created_at || null }
        : null,
      feedEvents: Array.isArray(x.feedEvents) ? x.feedEvents.filter(e => e && e.type !== 'achievement') : [],
      feedProgress: (x.feedProgress && typeof x.feedProgress === 'object')
        ? x.feedProgress
        : { rivalryMilestones: { ...((x.achievementProgress && x.achievementProgress.rivalryMilestones) || {}) } }
    };
  }

  /* ---------------------------------------------------------------------------
     8. Spelare + profiler — EN sammanslagning (ersätter de 2–3 gamla)
     --------------------------------------------------------------------------- */
  function toProfileMap(profiles) {
    if (profiles instanceof Map) return profiles;
    const map = new Map();
    if (Array.isArray(profiles)) {
      profiles.forEach(p => { if (p) map.set(Number(p.player_id ?? p.id), p); });
    } else if (profiles && typeof profiles === 'object') {
      Object.keys(profiles).forEach(k => map.set(Number(k), profiles[k]));
    }
    return map;
  }

  /**
   * Slår ihop nuvarande spelare + arkiverade spelarsnapshots (unika på id) och
   * hänger på profilfälten (motto, image_url) från profillistan/-mappen.
   * Profilfält läses ALLTID härifrån och skrivs aldrig tillbaka till
   * data.players eller arkivsnapshots.
   *
   * @param {Array<{id:number,name:string}>} players            data.players
   * @param {Map|Array|Object} profilesMap                      klask_player_profiles
   * @param {Array<{players?:Array}>} [archive]                 archive-kolumnen
   * @param {{sort?:boolean}} [opts]                            sort=false behåller inläsningsordning
   * @returns {Array<object>} nya objekt: {...spelare, id, motto, image_url}
   */
  function mergePlayersWithProfiles(players, profilesMap, archive, opts) {
    const o = opts || {};
    const profiles = toProfileMap(profilesMap);
    const archived = Array.isArray(archive)
      ? archive.flatMap(a => (a && Array.isArray(a.players)) ? a.players : [])
      : [];
    const map = new Map();
    [...(Array.isArray(players) ? players : []), ...archived].forEach(p => {
      if (!p || p.id == null) return;
      const id = Number(p.id);
      if (!Number.isFinite(id)) return;
      const existing = map.get(id);
      // Tidigare källor (data.players) vinner; senare snapshots fyller bara luckor.
      map.set(id, existing ? { ...p, ...existing, id } : { ...p, id });
    });
    const merged = [...map.values()].map(p => {
      const profile = profiles.get(Number(p.id)) || null;
      return {
        ...p,
        id: Number(p.id),
        motto: (profile && profile.motto) || '',
        image_url: (profile && profile.image_url) || '',
        profile
      };
    });
    if (o.sort === false) return merged;
    return merged.sort((a, b) => String(a.name).localeCompare(String(b.name), 'sv'));
  }

  /* ---------------------------------------------------------------------------
     9. Rankingformel (oförändrad) + sortering
     --------------------------------------------------------------------------- */
  const BAYESIAN_M = 18;
  const MIN_MATCHES = 18;

  /** Viktad förlustprocent mot gruppsnittet. Lägre = bättre. */
  function computeRankingScore(games, losses) {
    if (!Number.isFinite(games) || games <= 0) return null;
    const m = BAYESIAN_M;
    const C = 0.25;
    const R = losses / games;
    return 100 * ((games / (games + m)) * R + (m / (games + m)) * C);
  }

  /**
   * Sorterar spelarrader {games, losses, loss_pct, rank_score, name}.
   * Kvalificerade (>= MIN_MATCHES) först, sedan DNQ närmast kvalificering.
   */
  function rankingOrder(players) {
    return [...players].sort((a, b) => {
      const aQualified = a.games >= MIN_MATCHES;
      const bQualified = b.games >= MIN_MATCHES;

      // Kvalificerade spelare visas alltid före DNQ-spelare.
      if (aQualified !== bQualified) return aQualified ? -1 : 1;

      if (aQualified && bQualified) {
        if (a.rank_score !== b.rank_score) return a.rank_score - b.rank_score;
        if (b.games !== a.games) return b.games - a.games;
        if (a.loss_pct !== b.loss_pct) return a.loss_pct - b.loss_pct;
        return a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' });
      }

      // DNQ: närmast kvalificering först, därefter Bayesian score och namn.
      if (b.games !== a.games) return b.games - a.games;
      if (a.rank_score !== b.rank_score) {
        if (a.rank_score == null) return 1;
        if (b.rank_score == null) return -1;
        return a.rank_score - b.rank_score;
      }
      return a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' });
    });
  }

  /**
   * Hämtar alla profilrader (motto, image_url, ...) från klask_player_profiles
   * och returnerar en Map<number, profile> redo för mergePlayersWithProfiles.
   * @param {string} [columns] valfri kolumnlista, default alla fält sidorna använder.
   */
  async function loadProfiles(columns) {
    const cols = columns || 'player_id,motto,image_url,image_path';
    const { data, error } = await sb.from('klask_player_profiles').select(cols);
    if (error) {
      console.error('Kunde inte hämta spelarprofiler', error);
      return new Map();
    }
    return toProfileMap(data || []);
  }

  /* ---------------------------------------------------------------------------
     10. Läs/skriv klask_state
     --------------------------------------------------------------------------- */
  /**
   * Hämtar raden id=1, normaliserar och returnerar {data, archive}.
   * Vid fel/saknad rad: felnotis + tomma säkra defaults (ingen seed-data).
   */
  async function loadState() {
    try {
      const { data: row, error } = await sb.from('klask_state').select('data,archive').eq('id', 1).maybeSingle();
      if (error) throw error;
      if (!row) {
        console.error('klask_state saknar raden id=1.');
        toast('Kunde inte läsa data från databasen.');
        return { data: normalizeLoaded({}), archive: [] };
      }
      return {
        data: normalizeLoaded(row.data || {}),
        archive: Array.isArray(row.archive) ? row.archive : []
      };
    } catch (e) {
      console.error('Kunde inte hämta data från Supabase', e);
      toast('Kunde inte ansluta till databasen.');
      return { data: normalizeLoaded({}), archive: [] };
    }
  }

  /**
   * Skriver tillbaka data (+ archive om det skickas med).
   * OBS: skicka alltid med det archive du läste in om du har det, annars
   * lämnas archive-kolumnen orörd.
   * @returns {Promise<boolean>} true om det sparades
   */
  async function saveState(data, archive) {
    try {
      const patch = { data, updated_at: new Date().toISOString() };
      if (archive !== undefined) patch.archive = archive;
      const { error } = await sb.from('klask_state').update(patch).eq('id', 1);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('Kunde inte spara', e);
      toast('Kunde inte spara ändringen (inte inloggad som admin?).');
      return false;
    }
  }

  /* ---------------------------------------------------------------------------
     11. Publikt API
     --------------------------------------------------------------------------- */
  window.Klask = {
    // Supabase
    supabase: sb,
    SUPABASE_URL,

    // Hjälpfunktioner
    esc,
    toast,
    initials,
    renderAvatar,

    // Auth
    auth,
    refreshAuthUI,

    // Tema
    theme: { get: getTheme, set: setTheme, toggle: toggleTheme, onChange: onThemeChange },

    // UI-montering
    mountHeader,
    mountAuthModal,
    openAuthModal,
    closeAuthModal,

    // Data
    currentSeasonKey,
    emptyData,
    normalizeLoaded,
    mergePlayersWithProfiles,
    loadProfiles,
    loadState,
    saveState,

    // Ranking
    BAYESIAN_M,
    MIN_MATCHES,
    computeRankingScore,
    rankingOrder
  };
})();
