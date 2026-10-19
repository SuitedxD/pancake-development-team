// portal.js

(() => {
  'use strict';

  const basePath = (document.querySelector('meta[name="portal-base-path"]')?.content || '/pancake/plugins').replace(/\/$/, '');
  const apiBase = (document.querySelector('meta[name="api-base"]')?.content || '').trim().replace(/\/$/, '');
  const accessTokenKey = 'pancakePluginPortalAccessToken';
  const categoriesFallback = [
    'Fun', 'Moderation', 'Utility', 'Media', 'Social', 'Info', 'Tools', 'Loggin',
    'Security', 'Only Admin', 'Permissions', 'Levels', 'Roles', 'Messages', 'Experimental', 'Other'
  ];

  const state = {
    accessToken: sessionStorage.getItem(accessTokenKey) || '',
    user: null,
    canAccessAdmin: false,
    categories: categoriesFallback,
    selectedCategory: '',
    query: '',
    sort: 'newest',
    currentPlugin: null,
    adminDashboard: null,
    editingPluginId: null,
    adminAuthResolver: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function renderMarkdown(value, extraClass = '') {
    const source = String(value ?? '').trim();
    if (!source) return '';
    const className = `portal-markdown${extraClass ? ` ${extraClass}` : ''}`;
    if (window.marked && window.DOMPurify) {
      try {
        const parsed = window.marked.parse(source, { gfm: true, breaks: true });
        const safeHtml = window.DOMPurify.sanitize(parsed, { USE_PROFILES: { html: true } });
        const container = document.createElement('div');
        container.innerHTML = safeHtml;
        container.querySelectorAll('a[href]').forEach((link) => {
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
        });
        return `<div class="${className}">${container.innerHTML}</div>`;
      } catch (error) {
        console.warn('Markdown rendering failed; showing escaped plain text instead.', error);
      }
    }
    return `<div class="${className}">${escapeHtml(source).replace(/\r?\n/g, '<br>')}</div>`;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('en-US').format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return 'Recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    let body = options.body;
    if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (state.accessToken) headers.set('Authorization', `Bearer ${state.accessToken}`);
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body,
      credentials: 'omit',
      cache: 'no-store'
    });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : {};
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith('/api/admin/')) {
        // The caller can decide whether to start Discord login.
      }
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return data;
  }

  function notify(message, kind = 'info') {
    let toast = $('.portal-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'portal-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      $('.portal-shell')?.prepend(toast);
    }
    toast.className = `portal-toast is-${kind}`;
    toast.textContent = message;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.remove(), 6000);
  }

  function setButtonBusy(button, busy, busyText = 'Working…') {
    if (!button) return () => {};
    const oldText = button.textContent;
    button.disabled = busy;
    if (busy) button.textContent = busyText;
    return () => {
      button.disabled = false;
      button.textContent = oldText;
    };
  }

  function login() {
    if (!apiBase || apiBase.includes('YOUR-RENDER-SERVICE')) {
      notify('Set the Render API URL in the api-base meta tag before enabling Discord sign-in.', 'error');
      return;
    }
    const detailMatch = window.location.pathname.match(new RegExp(`^${basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d{20,30})/?$`));
    const pluginId = detailMatch?.[1] || new URLSearchParams(window.location.search).get('plugin');
    const returnTo = pluginId && /^\d{20,30}$/.test(pluginId)
      ? `${basePath}/?plugin=${encodeURIComponent(pluginId)}`
      : `${basePath}/`;
    window.location.assign(`${apiBase}/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`);
  }

  function showMode(mode) {
    const catalogueMode = mode === 'catalogue';
    $('.portal-toolbar').hidden = !catalogueMode;
    $('.portal-category-section').hidden = !catalogueMode;
    $('#catalogue-view').hidden = !catalogueMode;
    $('#detail-view').hidden = mode !== 'detail';
    $('#profile-view').hidden = mode !== 'profile';
    $('#admin-view').hidden = mode !== 'admin';
    $('.portal-hero').hidden = false;
    $('.portal-toolbar').hidden = !catalogueMode;
  }

  async function refreshSession() {
    try {
      const result = await api('/api/auth/me');
      state.user = result.user || null;
      state.canAccessAdmin = Boolean(result.canAccessAdmin);
      if (!state.user && state.accessToken) {
        state.accessToken = '';
        sessionStorage.removeItem(accessTokenKey);
      }
      updateAuthButtons();
      return result;
    } catch (error) {
      console.warn('Plugin Portal API is not reachable yet:', error.message);
      $('#plugin-grid').innerHTML = emptyState(
        'Portal backend not connected',
        'The interface is ready, but the catalogue, views, likes, favorites and Discord sign-in require the separately deployed pancake-development-team-api service and MongoDB. Check the API repository README.'
      );
      $('#results-summary').textContent = 'Waiting for backend connection';
      $('#login-button').textContent = 'Backend setup required';
      $('#login-button').disabled = true;
      return null;
    }
  }

  function updateAuthButtons() {
    const loginButton = $('#login-button');
    const profileButton = $('#profile-button');
    const adminButton = $('#admin-button');
    const logoutButton = $('#logout-button');
    if (state.user) {
      loginButton.hidden = true;
      profileButton.hidden = false;
      logoutButton.hidden = false;
      profileButton.textContent = `My library · ${state.user.displayName || 'Unknown'}`;
      adminButton.hidden = !state.canAccessAdmin;
    } else {
      loginButton.hidden = false;
      loginButton.disabled = false;
      loginButton.textContent = 'Sign in with Discord ↗';
      profileButton.hidden = true;
      adminButton.hidden = true;
      logoutButton.hidden = true;
    }
  }

  function emptyState(title, message, actionLabel = '') {
    return `<div class="portal-empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>${actionLabel ? `<button class="portal-user-button empty-state-action" type="button">${escapeHtml(actionLabel)}</button>` : ''}</div>`;
  }

  function renderCategoryFilters() {
    const wrap = $('#category-filters');
    const names = ['All categories', ...state.categories];
    wrap.innerHTML = names.map((name) => {
      const value = name === 'All categories' ? '' : name;
      const active = state.selectedCategory === value;
      return `<button type="button" class="portal-category-chip${active ? ' is-active' : ''}" data-category-filter="${escapeHtml(value)}" aria-pressed="${active}">${escapeHtml(name)}</button>`;
    }).join('');
    $('#category-count').textContent = `${state.categories.length} categories`;
  }

  function pluginCard(plugin) {
    const cats = (plugin.categories || []).slice(0, 3).map((category) => `<a class="plugin-mini-tag plugin-category-link" href="${basePath}/?category=${encodeURIComponent(category)}" aria-label="Browse ${escapeHtml(category)} plugins">${escapeHtml(category)}</a>`).join('');
    const cover = plugin.coverImage
      ? `<img class="plugin-card-cover" src="${escapeHtml(plugin.coverImage)}" alt="${escapeHtml(plugin.title)} cover" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
      : `<div class="plugin-card-cover-placeholder" aria-hidden="true">P</div>`;
    const pluginUrl = `${basePath}/${encodeURIComponent(plugin.pluginId)}`;
    return `
      <article class="plugin-card" data-card-href="${escapeHtml(pluginUrl)}" tabindex="0" role="link" aria-label="Open plugin ${escapeHtml(plugin.title)}">
        <div class="plugin-card-cover-wrap">${cover}</div>
        <div class="plugin-card-content">
          <div class="plugin-card-topline"><div class="plugin-card-categories">${cats || '<span class="plugin-mini-tag">Other</span>'}</div><span class="plugin-card-open" aria-hidden="true">↗</span></div>
          <h3>${escapeHtml(plugin.title)}</h3>
          <p class="plugin-author">By ${escapeHtml(plugin.authorDisplayName || 'Unknown')}</p>
          <div class="plugin-description">${renderMarkdown(plugin.description, 'plugin-card-markdown')}</div>
          <div class="plugin-card-footer"><div class="plugin-card-metrics"><span title="Likes"><b class="metric-icon" aria-hidden="true">♡</b>${formatNumber(plugin.likesCount)}</span><span title="Views"><b class="metric-icon" aria-hidden="true">◉</b>${formatNumber(plugin.views)}</span></div><span class="plugin-command-count">${formatNumber(plugin.commandCount ?? plugin.commands?.length)} commands</span></div>
        </div>
      </article>`;
  }

  async function refreshCatalogue() {
    const grid = $('#plugin-grid');
    grid.innerHTML = `<div class="portal-empty-state"><span class="portal-loader" aria-hidden="true"></span><p>Loading the catalogue…</p></div>`;
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.selectedCategory) params.set('category', state.selectedCategory);
    params.set('sort', state.sort);
    try {
      const data = await api(`/api/plugins?${params.toString()}`);
      grid.innerHTML = data.plugins.length
        ? data.plugins.map(pluginCard).join('')
        : emptyState('No plugins found', 'Try a different search term or choose another category.');
      $('#results-summary').textContent = `${formatNumber(data.total)} plugin${data.total === 1 ? '' : 's'} found`;
    } catch (error) {
      grid.innerHTML = emptyState('Could not load plugins', error.message);
      $('#results-summary').textContent = 'Catalogue unavailable';
    }
  }

  function youtubeEmbedUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
      let id = '';
      if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
      else if (['youtube.com', 'youtube-nocookie.com'].includes(host)) {
        id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1] || '';
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : '';
    } catch { return ''; }
  }

  function updateShareMetadata(plugin) {
    const description = String(plugin.description || '').replace(/[#*_`>\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    const title = `${plugin.title || 'Plugin'} — Plugin Portal`;
    document.title = title;
    const setMeta = (selector, attr, value) => {
      let node = document.head.querySelector(selector);
      if (!node) { node = document.createElement('meta'); document.head.appendChild(node); }
      node.setAttribute(attr, value);
    };
    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:type"]', 'content', 'website');
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:url"]', 'content', window.location.href);
    setMeta('meta[property="og:image"]', 'content', 'https://suitedxd.github.io/pancake-development-team/assets/pancake/pancake-social_02.png');
    setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', description);
    setMeta('meta[name="twitter:image"]', 'content', 'https://suitedxd.github.io/pancake-development-team/assets/pancake/pancake-social_02.png');
  }

  function renderPluginDetail(plugin) {
    updateShareMetadata(plugin);
    const categories = (plugin.categories || []).map((category) => `<a class="plugin-mini-tag plugin-category-link" href="${basePath}/?category=${encodeURIComponent(category)}" aria-label="Browse ${escapeHtml(category)} plugins">${escapeHtml(category)}</a>`).join('');
    const commands = (plugin.commands || []).map((command) => `<tr><td>${escapeHtml(command.command)}</td><td>${renderMarkdown(command.description, 'command-description-markdown')}</td></tr>`).join('');
    const mediaImages = (plugin.mediaImages || []).filter((url) => typeof url === 'string' && /^https:\/\//i.test(url));
    const youtubeVideos = (plugin.youtubeVideos || []).map(youtubeEmbedUrl).filter(Boolean);
    const mediaSection = mediaImages.length || youtubeVideos.length ? `
      <section class="plugin-media-section" aria-labelledby="plugin-media-title"><h2 id="plugin-media-title">Media</h2>
        ${mediaImages.length ? `<div class="plugin-media-grid">${mediaImages.map((url, index) => `<img class="plugin-media-image" src="${escapeHtml(url)}" alt="${escapeHtml(plugin.title)} image ${index + 1}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`).join('')}</div>` : ''}
        ${youtubeVideos.length ? `<div class="plugin-media-grid plugin-video-grid">${youtubeVideos.map((url, index) => `<iframe class="plugin-video-frame" src="${url}" title="${escapeHtml(plugin.title)} video ${index + 1}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`).join('')}</div>` : ''}
      </section>` : '';
    $('#detail-view').innerHTML = `
      <a class="portal-back" href="${basePath}/">← Back to all plugins</a>
      <header class="plugin-detail-header">
        ${plugin.coverImage && /^https:\/\//i.test(plugin.coverImage) ? `<img class="plugin-detail-cover" src="${escapeHtml(plugin.coverImage)}" alt="${escapeHtml(plugin.title)} cover" decoding="async" referrerpolicy="no-referrer" />` : ''}
        <h1>${escapeHtml(plugin.title)}</h1>
        <p class="plugin-detail-author">By ${escapeHtml(plugin.authorDisplayName || 'Unknown')} <span aria-hidden="true">·</span> Added ${escapeHtml(formatDate(plugin.createdAt))}</p>
        ${renderMarkdown(plugin.description, 'plugin-detail-markdown')}
        <div class="plugin-detail-actions">
          <button class="plugin-action-button${plugin.liked ? ' is-active' : ''}" id="detail-like-button" type="button" data-detail-like>♡ <span>${plugin.liked ? 'Liked' : 'Like'}</span></button>
          <button class="plugin-action-button${plugin.favorited ? ' is-active' : ''}" id="detail-favorite-button" type="button" data-detail-favorite>☆ <span>${plugin.favorited ? 'Saved to favorites' : 'Add to favorites'}</span></button>
          <div class="plugin-detail-metrics"><span><strong id="detail-like-count">${formatNumber(plugin.likesCount)}</strong> likes</span><span><strong>${formatNumber(plugin.views)}</strong> views</span><span><strong>${formatNumber(plugin.commandCount)}</strong> commands</span></div>
        </div>
      </header>
      <div class="plugin-detail-columns">
        <aside class="portal-panel plugin-details-panel" aria-labelledby="plugin-details-title">
          <h2 id="plugin-details-title">Plugin details</h2>
          <div class="plugin-detail-info">
            <div class="portal-id-panel"><span>Author</span><strong>${escapeHtml(plugin.authorDisplayName || 'Unknown')}</strong></div>
            <div class="portal-id-panel"><span>Last updated</span><strong>${escapeHtml(formatDate(plugin.updatedAt))}</strong></div>
            <div class="portal-id-panel portal-install-panel"><span>Install with</span><code>${escapeHtml(plugin.installWith)}</code></div>
          </div>
          ${categories ? `<div class="plugin-detail-categories"><span class="plugin-detail-categories-label">Categories</span><div class="plugin-detail-category-list">${categories}</div></div>` : ''}
        </aside>
        <section class="portal-panel plugin-commands-panel" aria-labelledby="plugin-commands-title">
          <h2 id="plugin-commands-title">Commands</h2>
          <p class="portal-panel-intro">${formatNumber(plugin.commandCount)} command${plugin.commandCount === 1 ? '' : 's'} included with this plugin.</p>
          <div class="command-table-wrap"><table class="portal-command-table"><thead><tr><th>Command(s)</th><th>Description</th></tr></thead><tbody>${commands}</tbody></table></div>
          ${plugin.notes ? renderMarkdown(plugin.notes, 'plugin-notes') : ''}
        </section>
      </div>
      ${mediaSection}`;
    showMode('detail');
  }

  async function loadPluginDetail(pluginId) {
    showMode('detail');
    $('#detail-view').innerHTML = emptyState('Loading plugin…', 'Fetching plugin details.');
    try {
      const data = await api(`/api/plugins/${encodeURIComponent(pluginId)}`);
      state.currentPlugin = data.plugin;
      renderPluginDetail(data.plugin);
    } catch (error) {
      state.currentPlugin = null;
      $('#detail-view').innerHTML = `<a class="portal-back" href="${basePath}/">← Back to all plugins</a>${emptyState('Plugin unavailable', error.message)}`;
      showMode('detail');
    }
  }

  function renderLibraryCard(plugin) {
    return `<article class="portal-library-card" data-card-href="${basePath}/${encodeURIComponent(plugin.pluginId)}" tabindex="0" role="link"><h3>${escapeHtml(plugin.title)}</h3><p>By ${escapeHtml(plugin.authorDisplayName || 'Unknown')} · ${formatNumber(plugin.likesCount)} likes · ${formatNumber(plugin.views)} views</p>${renderMarkdown(plugin.description, 'library-card-markdown')}</article>`;
  }

  async function loadProfile() {
    if (!state.user) return login();
    showMode('profile');
    $('#profile-view').innerHTML = `<div class="portal-empty-state"><span class="portal-loader" aria-hidden="true"></span><p>Loading your library…</p></div>`;
    try {
      const data = await api('/api/profile');
      $('#profile-view').innerHTML = `
        <div class="portal-page-heading"><div><div class="kicker">Your account</div><h1 id="profile-title">My library</h1><p>Signed in as ${escapeHtml(state.user.displayName || 'Unknown')}. Your profile only shows the plugins you liked or saved.</p></div><button class="portal-user-button" type="button" data-back-catalogue>← Browse plugins</button></div>
        <section class="portal-library-section"><h2>Saved favorites <span class="plugin-command-count">${data.favorites.length}</span></h2><div class="portal-library-grid">${data.favorites.length ? data.favorites.map(renderLibraryCard).join('') : emptyState('No favorites yet', 'Open a plugin and choose “Add to favorites” to keep it here.')}</div></section>
        <section class="portal-library-section"><h2>Liked plugins <span class="plugin-command-count">${data.liked.length}</span></h2><div class="portal-library-grid">${data.liked.length ? data.liked.map(renderLibraryCard).join('') : emptyState('No likes yet', 'Like a plugin to find it here later.')}</div></section>`;
    } catch (error) {
      $('#profile-view').innerHTML = `${emptyState('Could not load your library', error.message)}<div class="form-actions"><button class="portal-user-button" type="button" data-back-catalogue>Back to plugins</button></div>`;
    }
    showMode('profile');
  }

  function renderFormCategories(form, selected = []) {
    const target = $('.form-category-options', form);
    target.innerHTML = state.categories.map((category) => {
      const checked = selected.includes(category) ? ' checked' : '';
      return `<label class="form-category-chip"><input type="checkbox" name="categories" value="${escapeHtml(category)}"${checked}><span>${escapeHtml(category)}</span></label>`;
    }).join('');
  }

  function updateCommandCount(form) {
    const count = $$('.command-field-row', form).length;
    const badge = $('.command-count-badge', form);
    if (badge) badge.textContent = `${count} command${count === 1 ? '' : 's'}`;
  }

  function appendCommandRow(form, initial = {}) {
    const target = $('.command-fields', form);
    const template = $('#command-field-template');
    const fragment = template.content.cloneNode(true);
    const row = $('.command-field-row', fragment);
    $('[name="command"]', row).value = initial.command || '';
    $('[name="commandDescription"]', row).value = initial.description || '';
    $('.remove-command-button', row).addEventListener('click', () => {
      if ($$('.command-field-row', form).length <= 1) {
        notify('A plugin needs at least one command field.', 'warning');
        return;
      }
      row.remove();
      updateCommandCount(form);
    });
    target.append(fragment);
    updateCommandCount(form);
  }

  function configurePluginForm(form, { initialData = null, actionLabel = 'Save plugin' } = {}) {
    form.replaceChildren($('#plugin-fields-template').content.cloneNode(true));
    renderFormCategories(form, initialData?.categories || []);
    const commands = Array.isArray(initialData?.commands) && initialData.commands.length ? initialData.commands : [{}];
    commands.forEach((command) => appendCommandRow(form, command));
    $('.add-command-button', form).addEventListener('click', () => appendCommandRow(form));
    $('.cancel-form-button', form).addEventListener('click', () => {
      const dialog = form.closest('dialog');
      if (dialog) dialog.close();
      else {
        $('#admin-plugin-editor').hidden = true;
        state.editingPluginId = null;
      }
    });
    $('.save-plugin-button', form).textContent = actionLabel;
    if (initialData) {
      for (const key of ['title', 'authorId', 'description', 'installWith', 'notes', 'coverImage']) {
        const field = form.elements.namedItem(key);
        if (field) field.value = initialData[key] || '';
      }
      form.elements.namedItem('mediaImages').value = (initialData.mediaImages || []).join('\n');
      form.elements.namedItem('youtubeVideos').value = (initialData.youtubeVideos || []).join('\n');
    }
  }

  function getFormPayload(form) {
    const categories = $$('[name="categories"]:checked', form).map((input) => input.value);
    if (!categories.length) throw new Error('Choose at least one category.');
    const commands = $$('.command-field-row', form).map((row) => ({
      command: $('[name="command"]', row).value.trim(),
      description: $('[name="commandDescription"]', row).value.trim()
    }));
    if (!commands.length || commands.some((command) => !command.command || !command.description)) {
      throw new Error('Fill out every command and its description.');
    }
    const payload = {
      title: form.elements.namedItem('title').value.trim(),
      description: form.elements.namedItem('description').value.trim(),
      installWith: form.elements.namedItem('installWith').value.trim(),
      notes: form.elements.namedItem('notes').value.trim(),
      coverImage: form.elements.namedItem('coverImage').value.trim(),
      mediaImages: form.elements.namedItem('mediaImages').value.split('\n').map((url) => url.trim()).filter(Boolean),
      youtubeVideos: form.elements.namedItem('youtubeVideos').value.split('\n').map((url) => url.trim()).filter(Boolean),
      categories,
      commands,
      authorId: form.elements.namedItem('authorId').value.trim()
    };
    return payload;
  }

  function setFormError(form, message = '') {
    const target = $('.form-error', form);
    if (!target) return;
    target.textContent = message;
    target.hidden = !message;
  }

  function promptAdminCredentials() {
    return new Promise((resolve) => {
      const form = $('#admin-auth-form');
      form.reset();
      $('#admin-auth-error').hidden = true;
      $('#admin-auth-error').textContent = '';
      state.adminAuthResolver = resolve;
      $('#admin-auth-dialog').showModal();
      $('[name="username"]', form).focus();
    });
  }

  $('#admin-auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const resolver = state.adminAuthResolver;
    state.adminAuthResolver = null;
    const auth = {
      username: form.elements.namedItem('username').value.trim(),
      password: form.elements.namedItem('password').value
    };
    $('#admin-auth-dialog').close();
    if (resolver) resolver(auth);
  });

  $('#admin-auth-dialog').addEventListener('cancel', () => {
    const resolver = state.adminAuthResolver;
    state.adminAuthResolver = null;
    if (resolver) resolver(null);
  });
  $('#admin-auth-dialog').addEventListener('close', () => {
    const resolver = state.adminAuthResolver;
    state.adminAuthResolver = null;
    if (resolver) resolver(null);
  });

  async function requestAdminAuth() {
    const auth = await promptAdminCredentials();
    if (!auth) throw new Error('Admin action cancelled.');
    return auth;
  }

  async function openAdminPanel() {
    if (!state.user) return login();
    if (!state.canAccessAdmin) {
      notify('This Discord account is not on the Plugin Portal admin allowlist.', 'warning');
      return;
    }
    try {
      const adminAuth = await requestAdminAuth();
      const dashboard = await api('/api/admin/access', { method: 'POST', body: { adminAuth } });
      state.adminDashboard = { plugins: dashboard.plugins };
      renderAdminPanel();
      showMode('admin');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function adminItem(plugin) {
    return `<article class="admin-item"><div class="admin-item-copy"><strong>${escapeHtml(plugin.title)}</strong><code>ID: ${escapeHtml(plugin.pluginId)}</code><p>By ${escapeHtml(plugin.authorDisplayName || 'Unknown')} · ${formatNumber(plugin.commandCount)} commands · ${formatNumber(plugin.likesCount)} likes · ${formatNumber(plugin.views)} views</p></div><div class="admin-item-actions"><button class="admin-small-button" type="button" data-edit-plugin="${escapeHtml(plugin.pluginId)}">Edit</button><button class="admin-small-button danger" type="button" data-delete-plugin="${escapeHtml(plugin.pluginId)}">Delete</button></div></article>`;
  }

  function renderAdminPanel() {
    const dashboard = state.adminDashboard || { plugins: [] };
    $('#admin-view').innerHTML = `
      <div class="portal-page-heading"><div><div class="kicker">Restricted area</div><h1 id="admin-title">Plugin Portal admin</h1><p>Discord allowlist and a separate site admin key are both required. Re-enter the key for every change.</p></div><button class="portal-user-button" type="button" data-back-catalogue>← Back to portal</button></div>
      <section class="admin-section"><div class="admin-section-top"><h2>Published plugins</h2><button class="btn btn-primary" type="button" id="admin-add-plugin">＋ Add plugin</button></div>
        <div id="admin-plugin-editor" class="portal-panel" hidden><div class="dialog-header"><div><div class="kicker">Plugin editor</div><h2 id="admin-editor-title">Add a plugin</h2></div><button class="dialog-close" type="button" id="admin-editor-close" aria-label="Close editor">×</button></div><p class="portal-panel-intro">A unique 24-digit plugin ID is generated automatically for new plugins. Existing IDs never change. Add a cover image and optional image or YouTube media URLs.</p><form id="admin-plugin-form" class="portal-form"></form></div>
        <div class="admin-plugin-list">${dashboard.plugins.length ? dashboard.plugins.map(adminItem).join('') : emptyState('No published plugins', 'Add your first plugin to begin the catalogue.')}</div>
      </section>`;

    {
      $('#admin-add-plugin').addEventListener('click', () => openAdminEditor(null));
      $('#admin-editor-close').addEventListener('click', () => { $('#admin-plugin-editor').hidden = true; state.editingPluginId = null; });
      $('#admin-plugin-form').addEventListener('submit', saveAdminPlugin);
    }
  }

  function openAdminEditor(plugin) {
    state.editingPluginId = plugin?.pluginId || null;
    const editor = $('#admin-plugin-editor');
    editor.hidden = false;
    $('#admin-editor-title').textContent = plugin ? `Edit ${plugin.title}` : 'Add a plugin';
    const form = $('#admin-plugin-form');
    configurePluginForm(form, { initialData: plugin, actionLabel: plugin ? 'Save changes' : 'Create plugin' });
    $('.save-plugin-button', form).textContent = plugin ? 'Save changes' : 'Create plugin';
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveAdminPlugin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setFormError(form, '');
    if (!form.reportValidity()) return;
    let payload;
    try { payload = getFormPayload(form); } catch (error) { setFormError(form, error.message); return; }
    const isEdit = Boolean(state.editingPluginId);
    const path = isEdit ? `/api/admin/plugins/${encodeURIComponent(state.editingPluginId)}` : '/api/admin/plugins';
    const method = isEdit ? 'PUT' : 'POST';
    const button = $('.save-plugin-button', form);
    const restore = setButtonBusy(button, true, 'Verifying…');
    try {
      const adminAuth = await requestAdminAuth();
      const result = await api(path, { method, body: { ...payload, adminAuth } });
      await refreshAdminDashboard(adminAuth);
      state.editingPluginId = null;
      notify(`${result.message}${result.pluginId ? ` Plugin ID: ${result.pluginId}` : ''}`, 'success');
    } catch (error) {
      setFormError(form, error.message);
    } finally {
      restore();
    }
  }

  async function adminMutation(path, method, payload = {}, confirmMessage = '') {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    try {
      const adminAuth = await requestAdminAuth();
      const result = await api(path, { method, body: { ...payload, adminAuth } });
      await refreshAdminDashboard(adminAuth);
      notify(result.message || 'Change completed and verified.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function refreshAdminDashboard(adminAuth) {
    const dashboard = await api('/api/admin/access', { method: 'POST', body: { adminAuth } });
    state.adminDashboard = { plugins: dashboard.plugins };
    renderAdminPanel();
    showMode('admin');
  }

  async function handleDetailAction(kind) {
    if (!state.currentPlugin) return;
    if (!state.user) return login();
    const button = kind === 'like' ? $('[data-detail-like]') : $('[data-detail-favorite]');
    const previousHTML = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      if (kind === 'like') {
        const result = await api(`/api/plugins/${encodeURIComponent(state.currentPlugin.pluginId)}/like`, { method: 'POST', body: {} });
        state.currentPlugin.liked = result.liked;
        state.currentPlugin.likesCount = result.likesCount;
        button.classList.toggle('is-active', result.liked);
        button.innerHTML = `♡ <span>${result.liked ? 'Liked' : 'Like'}</span>`;
        $('#detail-like-count').textContent = formatNumber(result.likesCount);
      } else {
        const result = await api(`/api/plugins/${encodeURIComponent(state.currentPlugin.pluginId)}/favorite`, { method: 'POST', body: {} });
        state.currentPlugin.favorited = result.favorited;
        button.classList.toggle('is-active', result.favorited);
        button.innerHTML = `☆ <span>${result.favorited ? 'Saved to favorites' : 'Add to favorites'}</span>`;
      }
    } catch (error) {
      button.innerHTML = previousHTML;
      if (/sign in with discord/i.test(error.message)) return login();
      notify(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function returnToCatalogue() {
    window.location.assign(`${basePath}/`);
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch (error) {
      console.warn('Server-side sign-out could not complete:', error.message);
    } finally {
      state.accessToken = '';
      sessionStorage.removeItem(accessTokenKey);
      state.user = null;
      state.canAccessAdmin = false;
      updateAuthButtons();
      notify('You have signed out.', 'success');
      returnToCatalogue();
    }
  }

  function attachEvents() {
    $('#login-button').addEventListener('click', login);
    $('#profile-button').addEventListener('click', loadProfile);
    $('#admin-button').addEventListener('click', openAdminPanel);
    $('#logout-button').addEventListener('click', logout);
    $('#plugin-search').addEventListener('input', (event) => {
      state.query = event.currentTarget.value.trim();
      clearTimeout(attachEvents.searchTimer);
      attachEvents.searchTimer = setTimeout(refreshCatalogue, 230);
    });
    $('#plugin-sort').addEventListener('change', (event) => { state.sort = event.currentTarget.value; refreshCatalogue(); });
    $('#category-filters').addEventListener('click', (event) => {
      const button = event.target.closest('[data-category-filter]');
      if (!button) return;
      state.selectedCategory = button.dataset.categoryFilter || '';
      const categoryUrl = new URL(window.location.href);
      if (state.selectedCategory) categoryUrl.searchParams.set('category', state.selectedCategory);
      else categoryUrl.searchParams.delete('category');
      history.replaceState({}, '', `${categoryUrl.pathname}${categoryUrl.search}${categoryUrl.hash}`);
      renderCategoryFilters();
      refreshCatalogue();
    });
    document.addEventListener('click', async (event) => {
      const navigableCard = event.target.closest('[data-card-href]');
      if (navigableCard && !event.target.closest('a,button,input,textarea,select,summary,[role=button]')) {
        window.location.assign(navigableCard.dataset.cardHref);
        return;
      }
      const closeButton = event.target.closest('[data-close-dialog]');
      if (closeButton) { document.getElementById(closeButton.dataset.closeDialog)?.close(); return; }
      if (event.target.closest('[data-detail-like]')) { await handleDetailAction('like'); return; }
      if (event.target.closest('[data-detail-favorite]')) { await handleDetailAction('favorite'); return; }
      if (event.target.closest('[data-back-catalogue]')) { returnToCatalogue(); return; }
      const editButton = event.target.closest('[data-edit-plugin]');
      if (editButton) {
        const plugin = state.adminDashboard?.plugins.find((item) => item.pluginId === editButton.dataset.editPlugin);
        if (plugin) openAdminEditor(plugin);
        return;
      }
      const deleteButton = event.target.closest('[data-delete-plugin]');
      if (deleteButton) {
        const plugin = state.adminDashboard?.plugins.find((item) => item.pluginId === deleteButton.dataset.deletePlugin);
        await adminMutation(`/api/admin/plugins/${encodeURIComponent(deleteButton.dataset.deletePlugin)}`, 'DELETE', {}, `Delete “${plugin?.title || deleteButton.dataset.deletePlugin}”? This permanently removes the plugin and its likes/favorites.`);
        return;
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const card = event.target.closest?.('[data-card-href]');
      if (!card || event.target.closest?.('a,button,input,textarea,select,[role=button]')) return;
      event.preventDefault();
      window.location.assign(card.dataset.cardHref);
    });
  }

  async function consumeOAuthReturn() {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const code = fragment.get('auth_code');
    if (code) {
      // Remove the one-time code from the visible URL before making any other requests.
      history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
      try {
        const result = await api('/api/auth/exchange', { method: 'POST', body: { code } });
        state.accessToken = result.accessToken;
        sessionStorage.setItem(accessTokenKey, result.accessToken);
        state.user = result.user || null;
        state.canAccessAdmin = Boolean(result.canAccessAdmin);
        updateAuthButtons();
        notify(`Signed in${state.user ? ` as ${state.user.displayName || 'Unknown'}` : ''}.`, 'success');
      } catch (error) {
        state.accessToken = '';
        sessionStorage.removeItem(accessTokenKey);
        notify(`Discord sign-in could not be completed: ${error.message}`, 'error');
      }
    }

    const query = new URLSearchParams(window.location.search);
    if (query.has('auth')) {
      const authResult = query.get('auth');
      if (authResult === 'cancelled') notify('Discord sign-in was cancelled.', 'warning');
      else if (authResult === 'error') notify('Discord sign-in failed. Please try again.', 'error');
      query.delete('auth');
      const queryText = query.toString();
      history.replaceState({}, '', `${window.location.pathname}${queryText ? `?${queryText}` : ''}`);
    }
  }

  async function initialize() {
    attachEvents();
    await consumeOAuthReturn();
    try {
      const config = await api('/api/portal-config');
      if (Array.isArray(config.categories) && config.categories.length) state.categories = config.categories;
    } catch { }
    renderCategoryFilters();
    await refreshSession();
    const query = new URLSearchParams(window.location.search);
    state.selectedCategory = query.get('category') || '';
    const queryPlugin = query.get('plugin');
    const pathMatch = window.location.pathname.match(new RegExp(`^${basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d{20,30})/?$`));
    const pluginId = pathMatch?.[1] || (/^\d{20,30}$/.test(queryPlugin || '') ? queryPlugin : null);
    if (pluginId) {
      if (queryPlugin) history.replaceState({}, '', `${basePath}/${pluginId}`);
      await loadPluginDetail(pluginId);
    } else {
      showMode('catalogue');
      await refreshCatalogue();
    }
  }

  initialize();
})();
