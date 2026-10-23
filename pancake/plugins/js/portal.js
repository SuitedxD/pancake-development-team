// portal.js

(() => {
  'use strict';

  const basePath = (document.querySelector('meta[name="portal-base-path"]')?.content || '/pancake/plugins').replace(/\/$/, '');
  const apiBase = (document.querySelector('meta[name="api-base"]')?.content || '').trim().replace(/\/$/, '');
  const accessTokenKey = 'pancakePluginPortalAccessToken';
  const anonymousViewerKey = 'pancakePluginPortalViewerId';
  const categoriesFallback = [
    'Fun', 'Moderation', 'Utility', 'Media', 'Social', 'Info', 'Tools', 'Loggin',
    'Security', 'Only Admin', 'Permissions', 'Levels', 'Roles', 'Messages', 'Experimental', 'Other'
  ];

  const state = {
    accessToken: localStorage.getItem(accessTokenKey) || '',
    user: null,
    canAccessAdmin: false,
    categories: categoriesFallback,
    selectedCategory: '',
    query: '',
    sort: 'newest',
    currentPlugin: null,
    adminDashboard: null,
    editingPluginId: null,
    editingDraftId: null,
    authorEditingPluginId: null,
    adminAuthResolver: null,
    currentMode: 'catalogue',
    adminPanelVerified: false
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
        const usedSlugs = new Set();
        container.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading) => {
          const baseSlug = heading.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
          if (!baseSlug) return;
          const isNotesSection = extraClass.split(/\s+/).includes('plugin-notes');
          const scope = extraClass.split(/\s+/).filter(Boolean).join('-').replace(/[^a-z0-9-]/gi, '') || 'markdown';
          const prefixedSlug = isNotesSection ? baseSlug : `${scope}-${baseSlug}`;
          let slug = prefixedSlug;
          let suffix = 2;
          while (usedSlugs.has(slug)) slug = `${prefixedSlug}-${suffix++}`;
          usedSlugs.add(slug);
          heading.id = slug;
          const anchor = document.createElement('a');
          anchor.className = 'markdown-heading-anchor';
          anchor.href = `#${slug}`;
          anchor.setAttribute('aria-label', `Copyable link to ${heading.textContent.trim()}`);
          anchor.setAttribute('title', `Link to ${heading.textContent.trim()}`);
          anchor.textContent = '#';
          heading.prepend(anchor);
        });
        container.querySelectorAll('a[href]').forEach((link) => {
          const href = link.getAttribute('href') || '';
          if (href.startsWith('#')) return;
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

  function getAnonymousViewerId() {
    try {
      let id = localStorage.getItem(anonymousViewerKey);
      if (!id) {
        id = window.crypto?.randomUUID ? window.crypto.randomUUID() : `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(anonymousViewerKey, id);
      }
      return id;
    } catch {
      return '';
    }
  }

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    const viewerId = getAnonymousViewerId();
    if (viewerId) headers.set('X-Portal-Viewer', viewerId);
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
      const error = new Error(data.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
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
    if (state.currentMode === 'admin' && mode !== 'admin') {
      state.adminPanelVerified = false;
      api('/api/admin/leave', { method: 'POST', body: {} }).catch(() => {});
    }
    state.currentMode = mode;
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
        localStorage.removeItem(accessTokenKey);
      }
      updateAuthButtons();
      return result;
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        state.accessToken = '';
        state.user = null;
        state.canAccessAdmin = false;
        localStorage.removeItem(accessTokenKey);
        updateAuthButtons();
      }
      console.warn('Plugin Portal API is not reachable yet:', error.message);
      $('#plugin-grid').innerHTML = emptyState(
        'Portal backend not connected',
        'The interface is ready, but the catalogue, views, likes, favorites and Discord sign-in require a separately deploy. Check the API.'
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
      profileButton.innerHTML = `${state.user.avatarUrl ? `<img class="portal-avatar" src="${escapeHtml(state.user.avatarUrl)}" alt="" referrerpolicy="no-referrer" />` : '<span class="portal-avatar-fallback">◉</span>'} <span>My Library</span>`;
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

  function emptyState(title, message, actionLabel = '', allowHtml = false) {
    return `<div class="portal-empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${allowHtml ? message : escapeHtml(message)}</p>
      ${actionLabel ? `<button class="portal-user-button empty-state-action" type="button">${escapeHtml(actionLabel)}</button>` : ''}
    </div>`;
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
    const pluginUrl = `${basePath}/?plugin=${encodeURIComponent(plugin.pluginId)}`;
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
    grid.innerHTML = `<div class="portal-empty-state"><span class="portal-loader" aria-hidden="true"></span><p>Almost ready…</p></div>`;
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.selectedCategory) params.set('category', state.selectedCategory);
    params.set('sort', state.sort);
    try {
      const data = await api(`/api/plugins?${params.toString()}`);
      grid.innerHTML = data.plugins.length
        ? data.plugins.map(pluginCard).join('')
        : emptyState('No plugins found', 'Try a different search term or choose another category.');
      $('#results-summary').textContent = `${formatNumber(data.total)} plugin${data.total === 1 ? '' : 's'} found.`;
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
    setMeta('meta[property="og:url"]', 'content', `${apiBase}/share/${encodeURIComponent(plugin.pluginId)}`);
    setMeta('meta[property="og:image"]', 'content', plugin.coverImage || 'https://suitedxd.github.io/pancake-development-team/assets/pancake/pancake-social_02.png');
    setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', description);
    setMeta('meta[name="twitter:image"]', 'content', plugin.coverImage || 'https://suitedxd.github.io/pancake-development-team/assets/pancake/pancake-social_02.png');
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
          ${state.user && String(state.user.discordId) === String(plugin.authorId) ? `<button class="plugin-action-button" type="button" data-author-edit>✎ <span>Edit plugin</span></button>${plugin.pendingChange?.fields ? '<button class="plugin-action-button" type="button" data-preview-author-change>◉ <span>Preview unreviewed changes</span></button>' : ''}` : ''}
          <button class="plugin-action-button" type="button" data-share-plugin="${escapeHtml(plugin.pluginId)}">↗ <span>Share</span></button>
          <div class="plugin-detail-metrics"><span><strong id="detail-like-count">${formatNumber(plugin.likesCount)}</strong> likes</span><span><strong>${formatNumber(plugin.views)}</strong> views</span><span><strong>${formatNumber(plugin.commandCount)}</strong> commands</span></div>
        </div>
      </header>
      <div class="plugin-detail-columns">
        <aside class="portal-panel plugin-details-panel" aria-labelledby="plugin-details-title">
          <h2 id="plugin-details-title">Plugin details</h2>
          <div class="plugin-detail-info">
            <div class="portal-id-panel"><span>Author:</span><strong>${escapeHtml(plugin.authorDisplayName || 'Unknown')}</strong></div>
            <div class="portal-id-panel"><span>Last Updated:</span><strong>${escapeHtml(formatDate(plugin.updatedAt))}</strong></div>
            <div class="portal-id-panel portal-version-panel"><span>Plugin Version:</span><strong>${escapeHtml(plugin.version || '—')}</strong></div>
            <div class="portal-id-panel portal-install-panel"><span>Install With:</span><div class="install-copy-row"><code>${escapeHtml(plugin.installWith)}</code><button class="plugin-action-button install-copy-button" type="button" data-copy-install="${escapeHtml(plugin.installWith)}" aria-label="Copy install command" title="Copy install command"><img src="../../assets/copy.png" alt="" aria-hidden="true" /></button></div></div>
          </div>
          ${categories ? `<div class="plugin-detail-categories"><span class="plugin-detail-categories-label">Categories:</span><div class="plugin-detail-category-list">${categories}</div></div>` : ''}
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
    if (window.location.hash) {
      setTimeout(() => {
        let targetId = window.location.hash.slice(1);
        try { targetId = decodeURIComponent(targetId); } catch { }
        document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 40);
    }
  }

  async function loadPluginDetail(pluginId) {
    showMode('detail');
    $('#detail-view').innerHTML = emptyState('Adding some syrup…', 'Your order will be ready at any moment.');
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
    return `<article class="portal-library-card" data-card-href="${basePath}/?plugin=${encodeURIComponent(plugin.pluginId)}" tabindex="0" role="link"><h3>${escapeHtml(plugin.title)}</h3><p>By ${escapeHtml(plugin.authorDisplayName || 'Unknown')} · ${formatNumber(plugin.likesCount)} likes · ${formatNumber(plugin.views)} views</p>${renderMarkdown(plugin.description, 'library-card-markdown')}</article>`;
  }

  async function loadProfile() {
    if (!state.user) return login();
    showMode('profile');
    $('#profile-view').innerHTML = `<div class="portal-empty-state"><span class="portal-loader" aria-hidden="true"></span><p>Loading your Library…</p></div>`;
    try {
      const data = await api('/api/profile');
      $('#profile-view').innerHTML = `
        <div class="portal-page-heading"><div><h1 id="profile-title">My Library</h1><p>Browse your favorites, liked plugins, and published ones you authored.</p></div><button class="portal-user-button" type="button" data-back-catalogue>← Browse plugins</button></div>
        <section class="portal-library-section"><h2>Saved favorites: <span class="plugin-command-count">${data.favorites.length}</span></h2><div class="portal-library-grid">${data.favorites.length ? data.favorites.map(renderLibraryCard).join('') : emptyState('No favorites yet', 'Open a plugin and choose “Add to favorites” to keep it here.')}</div></section>
        <section class="portal-library-section"><h2>Liked plugins: <span class="plugin-command-count">${data.liked.length}</span></h2><div class="portal-library-grid">${data.liked.length ? data.liked.map(renderLibraryCard).join('') : emptyState('No likes yet', 'Like a plugin to find it here later.')}</div></section>
        <section class="portal-library-section"><h2>Published by you: <span class="plugin-command-count">${(data.authored || []).length}</span></h2><div class="portal-library-grid">${(data.authored || []).length ? data.authored.map(renderLibraryCard).join('') : emptyState('No published plugins yet', 'Plugins authored by your Discord account will appear here. For more info about creating your own plugins, check our <a href="https://github.com/SuitedxD/Pancake/blob/main/docs/plugins-guide.md" target="_blank" rel="noopener noreferrer">Plugin Creation Guide</a>.', '', true)}</div></section>`;
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

  function configurePluginForm(form, { initialData = null, actionLabel = 'Publish changes', authorEditing = false } = {}) {
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
        state.editingDraftId = null;
      }
    });
    $('.save-plugin-button', form).textContent = actionLabel;
    const authorField = $('.admin-author-field', form);
    if (authorEditing && authorField) authorField.hidden = true;
    const draftButton = $('.save-draft-button', form);
    if (draftButton) {
      draftButton.hidden = authorEditing;
      draftButton.textContent = initialData ? 'Save changes' : 'Save draft';
      draftButton.addEventListener('click', () => saveAdminDraftFromForm(form));
    }
    const previewButton = $('.preview-plugin-button', form);
    if (previewButton) {
      previewButton.addEventListener('click', () => {
        if (!form.reportValidity()) return;
        try {
          const payload = getFormPayload(form);
          openPluginPreview(payload, {
            title: `Preview — ${payload.title || 'Untitled plugin'}`,
            pluginId: form.id === 'author-edit-form' ? state.authorEditingPluginId : (state.editingPluginId || ''),
            published: form.id === 'admin-plugin-form' && state.editingPluginId
              ? state.adminDashboard?.plugins?.find((item) => String(item.pluginId) === String(state.editingPluginId)) || null
              : null
          });
        } catch (error) {
          setFormError(form, error.message);
        }
      });
    }
    if (initialData) {
      for (const key of ['title', 'authorId', 'description', 'installWith', 'notes', 'coverImage', 'version', 'visibility']) {
        const field = form.elements.namedItem(key);
        if (field) field.value = initialData[key] || (key === 'visibility' ? 'public' : '');
      }
      form.elements.namedItem('mediaImages').value = (initialData.mediaImages || []).join('\n');
      form.elements.namedItem('youtubeVideos').value = (initialData.youtubeVideos || []).join('\n');
    } else {
      const visibility = form.elements.namedItem('visibility');
      if (visibility) visibility.value = 'public';
    }
  }

  function openPluginPreview(plugin, { title = 'Plugin preview', pluginId = '', published = null } = {}) {
    let dialog = $('#plugin-preview-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'plugin-preview-dialog';
      dialog.className = 'portal-dialog portal-dialog-wide plugin-preview-dialog';
      dialog.innerHTML = '<div class="dialog-header"><div><div class="kicker">Preview</div><h2 class="plugin-preview-title">Plugin preview</h2></div><button class="dialog-close" type="button" data-close-dialog="plugin-preview-dialog" aria-label="Close preview">×</button></div><div class="plugin-preview-content"></div><div class="form-actions"><button class="btn btn-secondary" type="button" data-close-dialog="plugin-preview-dialog">Close preview</button></div>';
      document.body.append(dialog);
    }
    $('.plugin-preview-title', dialog).textContent = title;
    const renderContent = (item, label = '') => {
      const safeTitle = escapeHtml(item.title || 'Untitled plugin');
      const cover = /^https:\/\//i.test(item.coverImage || '')
        ? `<img class="preview-cover" src="${escapeHtml(item.coverImage)}" alt="${safeTitle} cover" referrerpolicy="no-referrer" />`
        : '';
      const categories = (item.categories || []).map((value) => `<span class="plugin-mini-tag">${escapeHtml(value)}</span>`).join('');
      const commands = (item.commands || []).map((command) => `<tr><td>${escapeHtml(command.command)}</td><td>${renderMarkdown(command.description, 'command-description-markdown')}</td></tr>`).join('');
      const images = (item.mediaImages || []).filter((url) => /^https:\/\//i.test(url)).map((url) => `<img class="plugin-media-image" src="${escapeHtml(url)}" alt="Additional plugin media" loading="lazy" />`).join('');
      const videos = (item.youtubeVideos || []).map(youtubeEmbedUrl).filter(Boolean).map((url) => `<iframe class="plugin-video-frame" src="${url}" title="Plugin video preview" loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; web-share" allowfullscreen></iframe>`).join('');
      const knownAuthor = item.authorDisplayName
        || state.adminDashboard?.plugins?.find((candidate) => String(candidate.authorId || '') === String(item.authorId || ''))?.authorDisplayName
        || (state.user && String(state.user.discordId) === String(item.authorId) ? state.user.displayName : '')
        || 'Author not set';
      return `<section class="preview-plugin-surface">${label ? `<div class="preview-state-label">${escapeHtml(label)}</div>` : ''}${cover}<h3>${safeTitle}</h3><p class="preview-byline">By ${escapeHtml(knownAuthor)} · Version ${escapeHtml(item.version || '—')} · ${item.visibility === 'admin' ? 'Admin panel only' : 'Public'}</p>${renderMarkdown(item.description, 'plugin-detail-markdown')}<div class="plugin-detail-categories"><span class="plugin-detail-categories-label">Categories</span><div class="plugin-detail-category-list">${categories || '<span class="plugin-mini-tag">Other</span>'}</div></div><div class="portal-id-panel preview-install"><span>Install with:</span><div class="install-copy-row"><code>${escapeHtml(item.installWith || '')}</code></div></div><h4>Commands</h4><div class="command-table-wrap"><table class="portal-command-table"><thead><tr><th>Command(s)</th><th>Description</th></tr></thead><tbody>${commands}</tbody></table></div>${item.notes ? `<h4>Additional notes</h4>${renderMarkdown(item.notes, 'plugin-notes')}` : ''}${images ? `<h4>Images</h4><div class="plugin-media-grid">${images}</div>` : ''}${videos ? `<h4>Videos</h4><div class="plugin-media-grid">${videos}</div>` : ''}</section>`;
    };
    $('.plugin-preview-content', dialog).innerHTML = published
      ? `<div class="preview-comparison-grid">${renderContent(published, 'Currently published')}${renderContent(plugin, 'Proposed changes')}</div>`
      : renderContent(plugin, pluginId ? `Plugin ID: ${pluginId}` : 'Not published yet');
    if (!dialog.open) dialog.showModal();
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
      version: form.elements.namedItem('version')?.value.trim() || '',
      visibility: form.elements.namedItem('visibility')?.value || 'public',
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

  function openAuthorEditor(plugin) {
    if (!state.user || String(state.user.discordId) !== String(plugin.authorId)) return notify('Only the plugin author can request edits.', 'error');
    state.authorEditingPluginId = plugin.pluginId;
    const existing = $('#author-edit-dialog');
    if (!existing) {
      const dialog = document.createElement('dialog'); dialog.id = 'author-edit-dialog'; dialog.className = 'portal-dialog portal-dialog-wide';
      dialog.innerHTML = '<div class="dialog-header"><div><div class="kicker">Author workspace</div><h2>Request plugin changes</h2></div><button class="dialog-close" type="button" data-close-dialog="author-edit-dialog">×</button></div><p class="dialog-copy"> Welcome to this space exclusively for authors! Here, you can request changes to your plugin page. Change requests are manually reviewed by our administrators, so please ensure there are no errors or inconsistencies. Your plugin page will remain unchanged until the new updates are approved. Submitting multiple identical requests will not improve your position in the queue or speed up the approval process. Please note that once the changes have been applied, they cannot be reversed.</p><form id="author-edit-form" class="portal-form"></form>';
      document.body.append(dialog);
      const form = $('#author-edit-form'); configurePluginForm(form, { initialData: plugin, actionLabel: 'Submit for review', authorEditing: true });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (form.dataset.submitting === 'true' || !form.reportValidity()) return;

        let payload;
        try {
          payload = getFormPayload(form);
        } catch (error) {
          setFormError(form, error.message);
          return;
        }

        const submitButton = $('.save-plugin-button', form);
        form.dataset.submitting = 'true';
        form.setAttribute('aria-busy', 'true');
        setFormError(form, '');
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = 'Submitting for review…';
        }

        const pluginId = state.authorEditingPluginId;
        try {
          const result = await api(`/api/plugins/${encodeURIComponent(pluginId)}/change-request`, { method: 'POST', body: payload });
          if (state.currentPlugin && String(state.currentPlugin.pluginId) === String(pluginId)) {
            state.currentPlugin.pendingChange = result.pendingChange || { fields: payload };
            renderPluginDetail(state.currentPlugin);
          }
          dialog.close();
          notify('Change request submitted for admin review.', 'success');
        } catch (error) {
          setFormError(form, error.message);
        } finally {
          form.dataset.submitting = 'false';
          form.removeAttribute('aria-busy');
          if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Submit for review';
          }
        }
      });
    } else {
      configurePluginForm($('#author-edit-form'), { initialData: plugin, actionLabel: 'Submit for review', authorEditing: true });
    }
    $('#author-edit-dialog').showModal();
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
    // Repeated clicks while the panel is already open must not trigger another prompt.
    if (state.currentMode === 'admin' && state.adminPanelVerified) {
      try { await refreshAdminDashboard(); }
      catch (error) {
        state.adminPanelVerified = false;
        notify(error.message, 'error');
      }
      return;
    }
    try {
      await api('/api/admin/leave', { method: 'POST', body: {} });
      const adminAuth = await requestAdminAuth();
      const dashboard = await api('/api/admin/access', { method: 'POST', body: { adminAuth } });
      state.adminPanelVerified = true;
      state.adminDashboard = dashboard;
      renderAdminPanel();
      showMode('admin');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function adminItem(plugin) {
    return `<article class="admin-item"><div class="admin-item-copy"><strong>${escapeHtml(plugin.title)}</strong><code>ID: ${escapeHtml(plugin.pluginId)}</code><p>By ${escapeHtml(plugin.authorDisplayName || 'Unknown')} · ${formatNumber(plugin.commandCount)} commands · ${formatNumber(plugin.likesCount)} likes · ${formatNumber(plugin.views)} views · ${plugin.visibility === 'admin' ? 'Admin only' : 'Public'}</p></div><div class="admin-item-actions"><button class="admin-small-button" type="button" data-edit-plugin="${escapeHtml(plugin.pluginId)}">Edit</button><button class="admin-small-button danger" type="button" data-delete-plugin="${escapeHtml(plugin.pluginId)}">Delete</button></div></article>`;
  }

  function adminDraftItem(draft) {
    return `<article class="admin-item"><div class="admin-item-copy"><strong>${escapeHtml(draft.fields?.title || 'Untitled draft')}</strong><code>${draft.pluginId ? `Plugin ID: ${escapeHtml(draft.pluginId)}` : 'New plugin · not published'} · Draft updated ${escapeHtml(formatDate(draft.updatedAt || draft.createdAt))}</code><p>${escapeHtml(draft.fields?.description || 'No description')}</p></div><div class="admin-item-actions"><button class="admin-small-button" type="button" data-edit-draft="${escapeHtml(draft.draftId)}">Edit draft</button><button class="admin-small-button" type="button" data-publish-draft="${escapeHtml(draft.draftId)}">Publish changes</button><button class="admin-small-button danger" type="button" data-discard-draft="${escapeHtml(draft.draftId)}">Discard</button></div></article>`;
  }

  function renderAdminPanel() {
    const dashboard = state.adminDashboard || { plugins: [], pendingChanges: [], drafts: [] };
    dashboard.plugins = dashboard.plugins || [];
    dashboard.pendingChanges = dashboard.pendingChanges || [];
    dashboard.drafts = dashboard.drafts || [];
    $('#admin-view').innerHTML = `
      <div class="portal-page-heading"><div><div class="kicker">Restricted area</div><h1 id="admin-title">Plugin Portal admin</h1><p>Your Discord admin allowlist and separate site admin key are verified when entering this panel. Save drafts, preview, and publish without re-entering the key.</p></div><button class="portal-user-button" type="button" data-back-catalogue>← Back to portal</button></div>
      <section class="admin-section"><div class="admin-section-top"><h2>Published plugins</h2><button class="btn btn-primary" type="button" id="admin-add-plugin">＋ Add plugin</button></div>
        <div id="admin-plugin-editor" class="portal-panel" hidden><div class="dialog-header"><div><div class="kicker">Plugin editor</div><h2 id="admin-editor-title">Add a plugin</h2></div><button class="dialog-close" type="button" id="admin-editor-close" aria-label="Close editor">×</button></div><p class="portal-panel-intro">Preview your plugin before publishing. “Save changes” stores a draft without changing what the public sees; “Publish changes” applies it. Plugin IDs never change when editing an existing plugin.</p><form id="admin-plugin-form" class="portal-form"></form></div>
        <div class="admin-plugin-list">${dashboard.plugins.length ? dashboard.plugins.map(adminItem).join('') : emptyState('No published plugins', 'Add your first plugin to begin the catalogue.')}</div>
      </section>
      <section class="admin-section"><h2>Saved drafts <span class="plugin-command-count">${dashboard.drafts.length}</span></h2><div class="admin-plugin-list">${dashboard.drafts.length ? dashboard.drafts.map(adminDraftItem).join('') : emptyState('No saved drafts', 'Save changes from the editor to keep unpublished work here.')}</div></section>
      <section class="admin-section"><h2>Pending changes <span class="plugin-command-count">${dashboard.pendingChanges.length}</span></h2><p class="portal-panel-intro">Author-submitted changes remain private until an administrator previews and publishes them.</p><div class="admin-plugin-list">${dashboard.pendingChanges.length ? dashboard.pendingChanges.map((request) => `<article class="admin-item"><div class="admin-item-copy"><strong>${escapeHtml(request.fields?.title || request.pluginId)} — change request</strong><code>Plugin ID: ${escapeHtml(request.pluginId)} · Request: ${escapeHtml(String(request._id))}</code><p>${escapeHtml(request.fields?.description || 'No description')}</p></div><div class="admin-item-actions"><button class="admin-small-button" type="button" data-preview-change="${escapeHtml(String(request._id))}">Preview changes</button><button class="admin-small-button" type="button" data-approve-change="${escapeHtml(String(request._id))}">Publish changes</button><button class="admin-small-button danger" type="button" data-reject-change="${escapeHtml(String(request._id))}">Reject</button></div></article>`).join('') : emptyState('No pending changes', 'Author-submitted plugin edits will appear here for review.')}</div></section>`;

    $('#admin-add-plugin').addEventListener('click', () => openAdminEditor(null));
    $('#admin-editor-close').addEventListener('click', () => {
      $('#admin-plugin-editor').hidden = true;
      state.editingPluginId = null;
      state.editingDraftId = null;
    });
    $('#admin-plugin-form').addEventListener('submit', saveAdminPlugin);
  }

  function openAdminEditor(plugin, { draftId = null, pluginId = null } = {}) {
    state.editingPluginId = pluginId || plugin?.pluginId || null;
    state.editingDraftId = draftId;
    const editor = $('#admin-plugin-editor');
    editor.hidden = false;
    $('#admin-editor-title').textContent = plugin ? `${draftId ? 'Edit draft' : 'Edit'} ${plugin.title || 'plugin'}` : 'Add a plugin';
    const form = $('#admin-plugin-form');
    configurePluginForm(form, { initialData: plugin, actionLabel: state.editingPluginId ? 'Publish changes' : 'Publish plugin' });
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveAdminDraftFromForm(form) {
    if (form.id !== 'admin-plugin-form') return;
    setFormError(form, '');
    if (!form.reportValidity()) return;
    let payload;
    try { payload = getFormPayload(form); } catch (error) { setFormError(form, error.message); return; }
    const previousPluginId = state.editingPluginId;
    const previousDraftId = state.editingDraftId;
    const button = $('.save-draft-button', form);
    const restore = setButtonBusy(button, true, 'Saving…');
    try {
      const result = await api('/api/admin/drafts', {
        method: 'POST',
        body: { ...payload, pluginId: previousPluginId || '', draftId: previousDraftId || '' }
      });
      await refreshAdminDashboard();
      openAdminEditor(payload, { draftId: result.draftId, pluginId: previousPluginId });
      notify('Draft saved. The public plugin has not changed.', 'success');
    } catch (error) {
      setFormError(form, error.message);
    } finally {
      restore();
    }
  }

  async function saveAdminPlugin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setFormError(form, '');
    if (!form.reportValidity()) return;
    let payload;
    try { payload = getFormPayload(form); } catch (error) { setFormError(form, error.message); return; }
    const editingId = state.editingPluginId;
    const draftId = state.editingDraftId;
    const path = editingId ? `/api/admin/plugins/${encodeURIComponent(editingId)}` : '/api/admin/plugins';
    const method = editingId ? 'PUT' : 'POST';
    const button = $('.save-plugin-button', form);
    const restore = setButtonBusy(button, true, 'Publishing…');
    try {
      const result = await api(path, { method, body: payload });
      if (draftId) await api(`/api/admin/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE', body: {} });
      state.editingPluginId = null;
      state.editingDraftId = null;
      await refreshAdminDashboard();
      notify(`${result.message || 'Plugin changes published.'}${result.pluginId ? ` Plugin ID: ${result.pluginId}` : ''}`, 'success');
    } catch (error) {
      setFormError(form, error.message);
    } finally {
      restore();
    }
  }

  async function publishDraft(draftId) {
    const draft = state.adminDashboard?.drafts?.find((item) => item.draftId === draftId);
    if (!draft) return;
    if (!window.confirm(`Publish changes for “${draft.fields?.title || 'Untitled plugin'}”?`)) return;
    try {
      const path = draft.pluginId ? `/api/admin/plugins/${encodeURIComponent(draft.pluginId)}` : '/api/admin/plugins';
      const result = await api(path, { method: draft.pluginId ? 'PUT' : 'POST', body: draft.fields });
      await api(`/api/admin/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE', body: {} });
      await refreshAdminDashboard();
      notify(`${result.message || 'Draft published.'}${result.pluginId ? ` Plugin ID: ${result.pluginId}` : ''}`, 'success');
    } catch (error) { notify(error.message, 'error'); }
  }

  async function discardDraft(draftId) {
    if (!window.confirm('Discard this saved draft? This cannot be undone.')) return;
    try {
      await api(`/api/admin/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE', body: {} });
      await refreshAdminDashboard();
      notify('Draft discarded.', 'success');
    } catch (error) { notify(error.message, 'error'); }
  }

  async function adminMutation(path, method, payload = {}, confirmMessage = '') {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    try {
      const result = await api(path, { method, body: payload });
      await refreshAdminDashboard();
      notify(result.message || 'Change completed.', 'success');
    } catch (error) {
      notify(error.message, 'error');
      if (error.status === 401) notify('Admin verification expired. Leave and re-enter the admin panel to verify again.', 'warning');
    }
  }

  async function refreshAdminDashboard() {
    const dashboard = await api('/api/admin/dashboard');
    state.adminDashboard = dashboard;
    renderAdminPanel();
    showMode('admin');
    return dashboard;
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

  async function returnToCatalogue() {
    if (state.currentMode === 'admin' && state.accessToken) {
      try { await api('/api/admin/leave', { method: 'POST', body: {} }); } catch { }
    }
    state.currentMode = 'catalogue';
    state.adminPanelVerified = false;
    state.editingPluginId = null;
    state.editingDraftId = null;
    window.location.assign(`${basePath}/`);
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch (error) {
      console.warn('Server-side sign-out could not complete:', error.message);
    } finally {
      state.accessToken = '';
      localStorage.removeItem(accessTokenKey);
      state.user = null;
      state.canAccessAdmin = false;
      state.adminPanelVerified = false;
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
      if (event.target.closest('[data-author-edit]')) { if (state.currentPlugin) openAuthorEditor(state.currentPlugin); return; }
      if (event.target.closest('[data-preview-author-change]')) {
        const plugin = state.currentPlugin;
        if (plugin?.pendingChange?.fields) {
          openPluginPreview(plugin.pendingChange.fields, {
            title: `Unreviewed changes — ${plugin.pendingChange.fields.title || plugin.title}`,
            pluginId: plugin.pluginId,
            published: plugin
          });
        }
        return;
      }
      if (event.target.closest('[data-detail-favorite]')) { await handleDetailAction('favorite'); return; }
      const copyInstall = event.target.closest('[data-copy-install]');
      if (copyInstall) { try { await navigator.clipboard.writeText(copyInstall.dataset.copyInstall || ''); notify('Installation command copied.', 'success'); } catch { notify('Could not access the clipboard. Copy the command manually.', 'error'); } return; }
      if (event.target.closest('[data-back-catalogue]')) { returnToCatalogue(); return; }
      const editButton = event.target.closest('[data-edit-plugin]');
      if (editButton) {
        const plugin = state.adminDashboard?.plugins.find((item) => item.pluginId === editButton.dataset.editPlugin);
        if (plugin) openAdminEditor(plugin);
        return;
      }
      const approveChange = event.target.closest('[data-approve-change]');
      if (approveChange) { await adminMutation(`/api/admin/change-requests/${encodeURIComponent(approveChange.dataset.approveChange)}/approve`, 'POST', {}, 'Approve and publish these plugin changes?'); return; }
      const rejectChange = event.target.closest('[data-reject-change]');
      if (rejectChange) { await adminMutation(`/api/admin/change-requests/${encodeURIComponent(rejectChange.dataset.rejectChange)}/reject`, 'POST', {}, 'Reject this plugin change request?'); return; }
      const shareButton = event.target.closest('[data-share-plugin]');
      if (shareButton) {
        const pluginId = shareButton.dataset.sharePlugin;
        const shareUrl = `${apiBase}/share/${encodeURIComponent(pluginId)}${window.location.hash || ''}`;
        try { await navigator.clipboard.writeText(shareUrl); notify('Share link copied to clipboard.', 'success'); }
        catch { window.prompt('Copy this plugin share link:', shareUrl); }
        return;
      }
      const previewChange = event.target.closest('[data-preview-change]');
      if (previewChange) {
        const change = state.adminDashboard?.pendingChanges?.find((item) => String(item._id) === previewChange.dataset.previewChange);
        if (change) {
          const published = state.adminDashboard?.plugins?.find((item) => String(item.pluginId) === String(change.pluginId)) || null;
          openPluginPreview(change.fields || {}, { title: `Pending changes — ${change.fields?.title || change.pluginId}`, pluginId: change.pluginId, published });
        }
        return;
      }
      const editDraftButton = event.target.closest('[data-edit-draft]');
      if (editDraftButton) {
        const draft = state.adminDashboard?.drafts?.find((item) => item.draftId === editDraftButton.dataset.editDraft);
        if (draft) openAdminEditor(draft.fields, { draftId: draft.draftId, pluginId: draft.pluginId || null });
        return;
      }
      const publishDraftButton = event.target.closest('[data-publish-draft]');
      if (publishDraftButton) { await publishDraft(publishDraftButton.dataset.publishDraft); return; }
      const discardDraftButton = event.target.closest('[data-discard-draft]');
      if (discardDraftButton) { await discardDraft(discardDraftButton.dataset.discardDraft); return; }
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
        localStorage.setItem(accessTokenKey, result.accessToken);
        state.user = result.user || null;
        state.canAccessAdmin = Boolean(result.canAccessAdmin);
        updateAuthButtons();
        notify(`Signed in${state.user ? ` as ${state.user.displayName || 'Unknown'}` : ''}.`, 'success');
      } catch (error) {
        state.accessToken = '';
        localStorage.removeItem(accessTokenKey);
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
      if (pathMatch && !queryPlugin) history.replaceState({}, '', `${basePath}/?plugin=${encodeURIComponent(pluginId)}${window.location.hash}`);
      await loadPluginDetail(pluginId);
    } else {
      showMode('catalogue');
      await refreshCatalogue();
    }
  }

  initialize();
})();
