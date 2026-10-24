(() => {
  'use strict';

  const basePath = (document.querySelector('meta[name="portal-base-path"]')?.content || '/pancake-development-team/pancake/docs').replace(/\/$/, '');
  const apiBase = (document.querySelector('meta[name="api-base"]')?.content || '').trim().replace(/\/$/, '');
  const accessTokenKey = 'pancakePluginPortalAccessToken';
  const viewerKey = 'pancakeDocsViewerId';
  const defaultSocialImage = 'https://suitedxd.github.io/pancake-development-team/assets/pancake/pancake-social_02.png';

  function readAccessToken() {
    try { return localStorage.getItem(accessTokenKey) || ''; } catch { return ''; }
  }
  function saveAccessToken(value) {
    try { if (value) localStorage.setItem(accessTokenKey, value); else localStorage.removeItem(accessTokenKey); } catch { /* Anonymous reading remains available. */ }
  }
  function getViewerId() {
    try {
      let id = localStorage.getItem(viewerKey);
      if (!id) {
        id = window.crypto?.randomUUID ? window.crypto.randomUUID() : `docs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(viewerKey, id);
      }
      return id;
    } catch { return `docs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
  }

  const state = {
    accessToken: readAccessToken(), viewerId: getViewerId(), user: null, canAccessAdmin: false,
    adminUnlocked: false, currentMode: 'catalogue', allDocuments: [], categories: [],
    selectedCategory: '', selectedTag: '', query: '',
    sort: { official: 'newest', community: 'newest' },
    selectedDocument: null, feedback: null, pendingChange: null,
    adminData: { documents: [], requests: [] }, editorMode: 'submission', editorDocumentId: '',
    editorOrder: 0, previewVisible: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function formatDate(value) {
    if (!value) return 'Recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }
  function formatNumber(value) { return new Intl.NumberFormat('en-US').format(Number(value) || 0); }
  function numericValue(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
  }
  function getViews(item) { return numericValue(item?.views, item?.viewCount, item?.stats?.views, item?.metrics?.views); }
  function getUsefulCount(item) {
    return numericValue(
      item?.usefulCount, item?.helpfulCount, item?.peopleHelped, item?.feedbackYes, item?.usefulnessYes, item?.usefulVotesYes, item?.yesCount,
      item?.feedback?.yes, item?.useful?.yes, item?.usefulness?.yes, item?.usefulVotes?.yes,
      item?.stats?.helpful, item?.metrics?.helpful
    );
  }
  function getTags(item) {
    return Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  }
  function getSource(item) {
    if (!item) return 'community';
    if (item.isOfficial === true || item.official === true || item.createdByAdmin === true || item.isStaffDoc === true || item.publishedByAdmin === true || item.isPancakeDoc === true) return 'official';
    if (item.isCommunity === true) return 'community';
    const source = [item.source, item.section, item.collection, item.documentType, item.origin, item.type, item.official]
      .filter((value) => typeof value === 'string').join(' ').toLowerCase();
    if (/community|user|contributor|submission/.test(source)) return 'community';
    if (/official|pancake|staff|team/.test(source)) return 'official';
    const author = String(item.authorDisplayName || item.authorName || '').trim().toLowerCase();
    if (/^pancake( development team| team| official)?$/.test(author) || /official documentation/.test(author)) return 'official';
    // Older records may not have source metadata. Keep them visible in Community Docs
    // until an administrator assigns a collection in the editor.
    return 'community';
  }
  function safeHttpsUrl(value) {
    try {
      const url = new URL(String(value || ''), window.location.href);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  async function api(path, options = {}) {
    if (!apiBase || apiBase.includes('YOUR-RENDER-SERVICE')) throw new Error('Set the API URL in the api-base meta tag first.');
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if (state.accessToken) headers.set('Authorization', `Bearer ${state.accessToken}`);
    if (state.viewerId) headers.set('X-Portal-Viewer', state.viewerId);
    let body = options.body;
    if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    const response = await fetch(`${apiBase}${path}`, { method, headers, body, credentials: 'omit', cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : {};
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function notify(message, kind = 'info') {
    let toast = $('.docs-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'docs-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      $('.docs-shell')?.prepend(toast);
    }
    toast.className = `docs-toast${kind === 'error' ? ' is-error' : ''}`;
    toast.textContent = message;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.remove(), 5000);
  }

  function setMode(mode) {
    if (state.currentMode === 'admin' && mode !== 'admin' && state.adminUnlocked && state.accessToken) {
      api('/api/admin/leave', { method: 'POST', body: {} }).catch(() => {});
      state.adminUnlocked = false;
    }
    state.currentMode = mode;
    $('#catalogue-view').hidden = mode !== 'catalogue';
    $('#detail-view').hidden = mode !== 'detail';
    $('#library-view').hidden = mode !== 'library';
    $('#admin-view').hidden = mode !== 'admin';
  }

  function avatarMarkup(user, className = 'docs-avatar') {
    const avatar = safeHttpsUrl(user?.avatarUrl || user?.avatar || '');
    return avatar
      ? `<img class="${className}" src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer" loading="lazy" />`
      : `<span class="${className} docs-avatar-fallback" aria-hidden="true">${escapeHtml(String(user?.displayName || user?.username || 'U').trim().slice(0, 1).toUpperCase() || 'U')}</span>`;
  }
  function updateAccountButtons() {
    $('#login-button').hidden = Boolean(state.user);
    $('#submit-doc-button').hidden = !state.user;
    $('#library-button').hidden = !state.user;
    $('#logout-button').hidden = !state.user;
    $('#admin-button').hidden = !(state.user && state.canAccessAdmin);
    if (state.user) $('#library-button').innerHTML = `${avatarMarkup(state.user, 'docs-avatar docs-header-avatar')} <span>My Library</span>`;
  }

  async function refreshSession() {
    try {
      const result = await api('/api/auth/me');
      state.user = result.user || null;
      state.canAccessAdmin = Boolean(result.canAccessAdmin);
      if (!state.user && state.accessToken) { state.accessToken = ''; saveAccessToken(''); }
      updateAccountButtons();
      return result;
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        state.accessToken = ''; state.user = null; state.canAccessAdmin = false; saveAccessToken(''); updateAccountButtons();
      } else console.warn('Documents account check failed:', error.message);
      return null;
    }
  }
  function login() {
    if (!apiBase) { notify('The API URL has not been configured yet.', 'error'); return; }
    const current = new URL(window.location.href);
    current.hash = '';
    window.location.assign(`${apiBase}/api/auth/discord?returnTo=${encodeURIComponent(current.toString())}`);
  }
  async function exchangeAuthCode() {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const params = new URLSearchParams(hash);
    const code = params.get('auth_code');
    if (!code) return;
    try {
      const result = await api('/api/auth/exchange', { method: 'POST', body: { code } });
      state.accessToken = result.accessToken || '';
      if (state.accessToken) saveAccessToken(state.accessToken);
      const cleanUrl = new URL(window.location.href); cleanUrl.hash = '';
      history.replaceState({}, '', cleanUrl.toString());
      await refreshSession();
      notify('Signed in with Discord. Welcome back!');
    } catch (error) { notify(error.message || 'Discord sign-in could not be completed.', 'error'); }
  }

  function slugify(value) {
    return String(value || '').trim().toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'section';
  }

  function renderMarkdown(value, extraClass = '') {
    const source = String(value ?? '').trim();
    const className = `docs-markdown${extraClass ? ` ${extraClass}` : ''}`;
    if (!source) return `<div class="${escapeHtml(className)}"></div>`;
    let html = escapeHtml(source).replace(/\r?\n/g, '<br>');
    if (window.marked && window.DOMPurify) {
      try {
        html = window.DOMPurify.sanitize(window.marked.parse(source, { gfm: true, breaks: true }), { USE_PROFILES: { html: true } });
      } catch (error) { console.warn('Markdown rendering failed; showing plain text instead.', error); }
    }
    const container = document.createElement('div');
    container.className = className;
    container.innerHTML = html;
    const usedSlugs = new Set();
    container.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading) => {
      const baseSlug = slugify(heading.textContent);
      let slug = baseSlug;
      let suffix = 2;
      while (usedSlugs.has(slug)) slug = `${baseSlug}-${suffix++}`;
      usedSlugs.add(slug);
      heading.id = slug;
      heading.classList.add('docs-md-heading');
      const anchor = document.createElement('a');
      anchor.className = 'markdown-heading-anchor';
      anchor.href = `#${slug}`;
      anchor.dataset.docAnchor = slug;
      anchor.setAttribute('aria-label', `Link to ${heading.textContent.trim()}`);
      anchor.title = 'Jump to section';
      anchor.textContent = '#';
      heading.prepend(anchor);
    });
    container.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (href.startsWith('#')) {
        link.dataset.docAnchor = decodeURIComponentSafe(href.slice(1));
      } else {
        link.target = '_blank'; link.rel = 'noopener noreferrer';
      }
    });
    container.querySelectorAll('img').forEach((image) => {
      image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      image.classList.add('docs-md-image');
      if (!image.alt) image.alt = 'Documentation image';
    });
    container.querySelectorAll('pre').forEach((pre) => {
      if (pre.closest('.docs-code-block')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'docs-code-block';
      pre.parentNode.insertBefore(wrapper, pre); wrapper.appendChild(pre);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'docs-code-copy';
      button.setAttribute('data-copy-code', ''); button.setAttribute('aria-label', 'Copy code block'); button.title = 'Copy code';
      const image = document.createElement('img'); image.src = '../../assets/copy.png'; image.alt = ''; image.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = 'Copied';
      button.append(image, label); wrapper.appendChild(button);
    });
    return container.outerHTML;
  }
  function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch { return value; } }

  function docPageUrl(documentId) { return `${window.location.origin}${basePath}/?doc=${encodeURIComponent(documentId)}`; }
  function shareUrl(documentId) { return `${apiBase}/share/docs/${encodeURIComponent(documentId)}`; }
  function socialImageFor(item) {
    const direct = safeHttpsUrl(item?.coverImage || item?.imageUrl || item?.thumbnail || item?.socialImage || '');
    if (direct) return direct;
    const content = String(item?.content || '');
    const match = content.match(/!\[[^\]]*\]\(\s*(https:\/\/[^\s)]+)(?:\s+["'][^)]*["'])?\s*\)/i);
    return safeHttpsUrl(match?.[1] || '') || defaultSocialImage;
  }
  function updateShareMetadata(item) {
    const description = String(item.summary || item.description || item.content || 'Explore Pancake documentation and community guides.')
      .replace(/[#*_`>\[\]()!]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    const title = `${item.title || 'Documentation'} — Pancake Documentation`;
    const canonicalShareUrl = shareUrl(item.documentId);
    const setMeta = (selector, attribute, value) => {
      let node = document.head.querySelector(selector);
      if (!node) { node = document.createElement('meta'); document.head.appendChild(node); }
      node.setAttribute(attribute, value);
    };
    document.title = title;
    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:type"]', 'content', 'article');
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:url"]', 'content', canonicalShareUrl);
    setMeta('meta[property="og:image"]', 'content', socialImageFor(item));
    setMeta('meta[property="og:image:width"]', 'content', '1200');
    setMeta('meta[property="og:image:height"]', 'content', '630');
    setMeta('meta[property="og:image:alt"]', 'content', item.title || 'Pancake Documentation');
    setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', description);
    setMeta('meta[name="twitter:image"]', 'content', socialImageFor(item));
  }

  function resetShareMetadata() {
    const title = 'PANCAKE — Documentation';
    const description = 'Explore official Pancake documentation, guides, and community knowledge.';
    const canonical = `${window.location.origin}${basePath}/`;
    const setMeta = (selector, attribute, value) => {
      let node = document.head.querySelector(selector);
      if (!node) { node = document.createElement('meta'); document.head.appendChild(node); }
      node.setAttribute(attribute, value);
    };
    document.title = title;
    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:type"]', 'content', 'website');
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:url"]', 'content', canonical);
    setMeta('meta[property="og:image"]', 'content', defaultSocialImage);
    setMeta('meta[property="og:image:alt"]', 'content', 'PANCAKE Documentation');
    setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', description);
    setMeta('meta[name="twitter:image"]', 'content', defaultSocialImage);
  }

  function cardMarkup(item, { pending = false } = {}) {
    const category = item.category || 'General';
    const tags = getTags(item).slice(0, 6).map((tag) => `<button type="button" class="docs-tag${state.selectedTag.toLowerCase() === tag.toLowerCase() ? ' is-active' : ''}" data-tag-filter="${escapeHtml(tag)}" aria-pressed="${state.selectedTag.toLowerCase() === tag.toLowerCase()}">#${escapeHtml(tag)}</button>`).join('');
    const updatedDate = formatDate(item.updatedAt || item.createdAt);
    const source = getSource(item);
    const href = pending ? '' : docPageUrl(item.documentId);
    const metrics = `<div class="docs-card-metrics"><span title="Views"><span aria-hidden="true">◉</span> ${formatNumber(getViews(item))} views</span><span title="People who found this useful"><span aria-hidden="true">✓</span> ${formatNumber(getUsefulCount(item))} found this helpful</span></div>`;
    return `
      <article class="docs-card${pending ? ' is-pending' : ''}" ${pending ? '' : `data-card-href="${escapeHtml(href)}" tabindex="0" role="link" aria-label="Open document ${escapeHtml(item.title)}"`}>
        <div class="docs-card-main">
          <div class="docs-card-eyebrow"><button class="docs-topic-pill docs-topic-pill-button" type="button" data-topic-filter="${escapeHtml(category)}" aria-label="Filter by ${escapeHtml(category)}">${escapeHtml(category)}</button><span class="docs-card-dot">·</span><span>${source === 'official' ? 'PANCAKE OFFICIAL' : 'COMMUNITY DOCUMENTATION'}</span></div>
          <h3>${pending ? escapeHtml(item.title || 'Untitled submission') : `<a class="docs-card-link" data-open-doc="${escapeHtml(item.documentId)}" href="${escapeHtml(href)}">${escapeHtml(item.title)}</a>`}</h3>
          <p class="docs-card-summary">${escapeHtml(item.summary || 'Open this document to read the full guide.')}</p>
          ${tags ? `<div class="docs-card-tags">${tags}</div>` : ''}
          ${metrics}
          <div class="docs-card-footer"><span>By <strong>${escapeHtml(item.authorDisplayName || item.authorName || 'Unknown')}</strong></span><span>${pending ? 'Submitted' : 'Updated'} <strong>${escapeHtml(updatedDate)}</strong></span>${pending ? '<span class="docs-status-pill">Pending for approval</span>' : ''}</div>
        </div>
        <span class="docs-card-arrow" aria-hidden="true">${pending ? '◷' : '↗'}</span>
      </article>`;
  }

  function renderTopics() {
    const wrap = $('#docs-topic-filters');
    const allActive = state.selectedCategory === '';
    const all = `<button class="docs-topic-button${allActive ? ' is-active' : ''}" data-topic="" type="button" aria-pressed="${allActive}">All topics <span>${formatNumber(state.allDocuments.length)}</span></button>`;
    const topics = state.categories.map((category) => {
      const active = state.selectedCategory === category;
      const count = state.allDocuments.filter((item) => item.category === category).length;
      return `<button class="docs-topic-button${active ? ' is-active' : ''}" data-topic="${escapeHtml(category)}" type="button" aria-pressed="${active}">${escapeHtml(category)} <span>${formatNumber(count)}</span></button>`;
    }).join('');
    wrap.innerHTML = all + topics;
    const uniqueTags = [...new Set(state.allDocuments.flatMap(getTags))].sort((a, b) => a.localeCompare(b));
    $('#docs-tag-filters').innerHTML = [`<button type="button" class="docs-topic-button docs-tag-filter${!state.selectedTag ? ' is-active' : ''}" data-tag-filter="" aria-pressed="${!state.selectedTag}">All tags</button>`, ...uniqueTags.map((tag) => `<button type="button" class="docs-topic-button docs-tag-filter${state.selectedTag.toLowerCase() === tag.toLowerCase() ? ' is-active' : ''}" data-tag-filter="${escapeHtml(tag)}" aria-pressed="${state.selectedTag.toLowerCase() === tag.toLowerCase()}">#${escapeHtml(tag)}</button>`)].join('');
  }
  function sortDocuments(items, sort) {
    const list = [...items];
    const dateValue = (item) => new Date(item.createdAt || item.updatedAt || 0).getTime() || 0;
    if (sort === 'views') return list.sort((a, b) => getViews(b) - getViews(a) || dateValue(b) - dateValue(a));
    if (sort === 'helpful') return list.sort((a, b) => getUsefulCount(b) - getUsefulCount(a) || dateValue(b) - dateValue(a));
    if (sort === 'az') return list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    return list.sort((a, b) => dateValue(b) - dateValue(a));
  }
  function renderCatalogue() {
    renderTopics();
    const search = state.query.trim().toLowerCase();
    const matches = state.allDocuments.filter((item) => {
      if (state.selectedCategory && String(item.category || '') !== state.selectedCategory) return false;
      if (state.selectedTag && !getTags(item).some((tag) => tag.toLowerCase() === state.selectedTag.toLowerCase())) return false;
      if (!search) return true;
      const haystack = [item.title, item.summary, item.content, item.category, item.authorDisplayName, ...getTags(item)].join(' ').toLowerCase();
      return haystack.includes(search);
    });
    const official = sortDocuments(matches.filter((item) => getSource(item) === 'official'), state.sort.official);
    const community = sortDocuments(matches.filter((item) => getSource(item) !== 'official'), state.sort.community);
    $('#docs-result-count').textContent = `${formatNumber(matches.length)} document${matches.length === 1 ? '' : 's'}${search || state.selectedCategory || state.selectedTag ? ' found' : ' available'}`;
    $('#clear-search-button').hidden = !state.query && !state.selectedCategory && !state.selectedTag;
    $('#reset-search-button').hidden = !state.query && !state.selectedCategory && !state.selectedTag;
    $('#official-count').textContent = formatNumber(official.length);
    $('#community-count').textContent = formatNumber(community.length);
    $('#official-docs-list').innerHTML = official.map((item) => cardMarkup(item)).join('') || '<div class="docs-inline-empty">No official documents match these filters yet.</div>';
    $('#community-docs-list').innerHTML = community.map((item) => cardMarkup(item)).join('') || '<div class="docs-inline-empty">No community documents match these filters yet.</div>';
    $('#docs-empty-state').hidden = matches.length !== 0;
  }

  async function loadCatalogue() {
    $('#official-docs-list').innerHTML = '<div class="docs-loading"><span class="docs-loader" aria-hidden="true"></span><span>Gathering official documents…</span></div>';
    $('#community-docs-list').innerHTML = '<div class="docs-loading"><span class="docs-loader" aria-hidden="true"></span><span>Gathering community documents…</span></div>';
    try {
      const data = await api('/api/docs');
      state.allDocuments = Array.isArray(data.documents) ? data.documents : [];
      state.categories = Array.isArray(data.categories) ? data.categories : [...new Set(state.allDocuments.map((item) => item.category).filter(Boolean))].sort();
      renderCatalogue();
    } catch (error) {
      state.allDocuments = []; state.categories = [];
      $('#official-docs-list').innerHTML = '';
      $('#community-docs-list').innerHTML = '';
      $('#docs-empty-state').hidden = false;
      $('#docs-empty-state').innerHTML = `<span class="docs-empty-mark" aria-hidden="true">!</span><h3>Documents are not connected yet</h3><p>${escapeHtml(error.message)} The API needs the Documents routes deployed before the catalogue can load.</p><button class="docs-small-button" type="button" id="retry-docs-button">Try again</button>`;
      $('#docs-result-count').textContent = 'Catalogue unavailable';
    }
  }

  function buildToc() {
    const body = $('.docs-article-body');
    const toc = $('#docs-toc-links');
    if (!body || !toc) return;
    const headings = $$('.docs-article-body h1,.docs-article-body h2,.docs-article-body h3,.docs-article-body h4', body);
    if (!headings.length) { toc.innerHTML = '<span class="docs-toc-empty">This page has no section headings.</span>'; return; }
    toc.innerHTML = headings.map((heading) => {
      const depth = Number(heading.tagName.slice(1));
      const name = heading.textContent.replace(/^#\s*/, '').trim();
      return `<a href="#${encodeURIComponent(heading.id)}" data-doc-anchor="${escapeHtml(heading.id)}" data-depth="${depth}">${escapeHtml(name)}</a>`;
    }).join('');
  }

  function scrollToSection(id, { updateUrl = true } = {}) {
    const targetId = decodeURIComponentSafe(id || '').replace(/^#/, '');
    if (!targetId) return false;
    const target = document.getElementById(targetId);
    if (!target) return false;
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.hash = targetId;
      history.pushState({}, '', url.toString());
    }
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    return true;
  }

  function renderDetail(documentItem, feedback, pendingChange = null) {
    state.selectedDocument = documentItem;
    state.feedback = feedback || { yes: 0, no: 0, yourVote: null };
    state.pendingChange = pendingChange;
    updateShareMetadata(documentItem);
    const owner = Boolean(state.user && String(state.user.discordId) === String(documentItem.authorId || ''));
    const category = documentItem.category || 'General';
    const favoriteLabel = documentItem.favorite ? 'Saved to favorites' : 'Save to favorites';
    const vote = state.feedback.yourVote;
    const pendingNotice = pendingChange ? '<div class="docs-pending-note">You have edits waiting for administrator review. The published version is still shown to everyone.</div>' : '';
    const detailTags = getTags(documentItem).map((tag) => `<button type="button" class="docs-tag" data-tag-filter="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('');
    $('#detail-view').innerHTML = `
      <div class="docs-detail-top"><a href="${basePath}/" class="docs-back-button" data-go-catalogue>← Back to all docs</a><span class="docs-topic-pill">${escapeHtml(category)}</span></div>
      <div class="docs-reading-layout">
        <article class="docs-article">
          <header class="docs-article-header">
            <span class="docs-article-category">${getSource(documentItem) === 'official' ? 'Pancake Official Documentation' : 'Community Docs'}</span>
            <h1 class="docs-article-title">${escapeHtml(documentItem.title)}</h1>
            ${documentItem.summary ? `<p class="docs-article-summary">${escapeHtml(documentItem.summary)}</p>` : ''}
            <div class="docs-article-meta"><span>By <strong>${escapeHtml(documentItem.authorDisplayName || 'Unknown')}</strong></span><span aria-hidden="true">·</span><span>Published <strong>${escapeHtml(formatDate(documentItem.createdAt))}</strong></span><span aria-hidden="true">·</span><span>Last updated <strong>${escapeHtml(formatDate(documentItem.updatedAt || documentItem.createdAt))}</strong></span></div>
            ${detailTags ? `<div class="docs-detail-tags" aria-label="Document tags">${detailTags}</div>` : ''}
            <div class="docs-article-actions">
              <button type="button" class="docs-action-button${documentItem.favorite ? ' is-active' : ''}" data-action="favorite-document" data-document-id="${escapeHtml(documentItem.documentId)}">☆ <span>${escapeHtml(favoriteLabel)}</span></button>
              ${owner ? `<button type="button" class="docs-action-button" data-action="edit-document" data-document-id="${escapeHtml(documentItem.documentId)}">✎ <span>Edit doc</span></button>` : ''}
              <button type="button" class="docs-action-button" data-action="share-document" data-document-id="${escapeHtml(documentItem.documentId)}">↗ <span>Share link</span></button>
              <div class="docs-detail-metrics"><span><strong>${formatNumber(getViews(documentItem))}</strong> views</span><span><strong>${formatNumber(getUsefulCount(documentItem))}</strong> found this helpful</span></div>
            </div>
            ${pendingNotice}
          </header>
          ${renderMarkdown(documentItem.content, 'docs-article-body')}
          <section class="docs-useful-panel" aria-labelledby="docs-useful-heading">
            <div class="docs-useful-copy"><h2 id="docs-useful-heading">Was this useful?</h2><p>Your feedback helps us improve these documents. No sign-in required.</p><p id="docs-feedback-status" class="docs-feedback-status">${vote === true ? 'Thanks — you marked this helpful.' : vote === false ? 'Thanks — your feedback has been recorded.' : ''}</p></div>
            <div class="docs-useful-actions"><button class="docs-action-button${vote === true ? ' is-active' : ''}" data-action="vote-useful" data-useful="true" data-document-id="${escapeHtml(documentItem.documentId)}" type="button" aria-pressed="${vote === true}">Yes</button><button class="docs-action-button${vote === false ? ' is-active' : ''}" data-action="vote-useful" data-useful="false" data-document-id="${escapeHtml(documentItem.documentId)}" type="button" aria-pressed="${vote === false}">No</button></div>
          </section>
        </article>
        <aside class="docs-toc" aria-label="On this page"><h2>On this page</h2><nav id="docs-toc-links" class="docs-toc-links"></nav></aside>
      </div>`;
    setMode('detail');
    buildToc();
    const hash = window.location.hash;
    if (hash && !hash.startsWith('#auth_code')) {
      const id = decodeURIComponentSafe(hash.slice(1));
      requestAnimationFrame(() => scrollToSection(id, { updateUrl: false }));
    } else window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function loadDocument(documentId) {
    setMode('detail');
    $('#detail-view').innerHTML = '<div class="docs-loading"><span class="docs-loader" aria-hidden="true"></span><span>Opening document…</span></div>';
    try {
      const result = await api(`/api/docs/${encodeURIComponent(documentId)}`);
      if (result.document) {
        state.allDocuments = state.allDocuments.map((item) => item.documentId === result.document.documentId
          ? { ...item, views: getViews(result.document), usefulCount: getUsefulCount(result.document) }
          : item);
      }
      renderDetail(result.document, result.feedback, result.pendingChange);
    } catch (error) {
      $('#detail-view').innerHTML = `<div class="docs-empty-state"><span class="docs-empty-mark" aria-hidden="true">!</span><h3>Could not open this document</h3><p>${escapeHtml(error.message)}</p><button class="docs-small-button" data-go-catalogue type="button">← Back to all docs</button></div>`;
    }
  }
  function navigateCatalogue(updateHistory = true) {
    if (updateHistory) history.pushState({}, '', `${basePath}/`);
    state.selectedCategory = ''; state.selectedTag = ''; state.query = '';
    resetShareMetadata();
    if ($('#docs-search')) $('#docs-search').value = '';
    setMode('catalogue'); renderCatalogue(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function navigateDocument(documentId, updateHistory = true) {
    if (updateHistory) history.pushState({}, '', `${basePath}/?doc=${encodeURIComponent(documentId)}`);
    loadDocument(documentId);
  }
  function openDialog(id) {
    const dialog = document.getElementById(id); if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function closeDialog(id) {
    const dialog = document.getElementById(id); if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  }
  function requireLoginThen(callback) {
    if (!state.user) { notify('Sign in with Discord to save documents or submit your own.', 'info'); login(); return; }
    callback();
  }

  function openDocForm(mode, documentItem = null) {
    if (!state.user && mode !== 'admin-create' && mode !== 'admin-edit') { login(); return; }
    state.editorMode = mode; state.editorDocumentId = documentItem?.documentId || '';
    state.editorOrder = Number(documentItem?.order) || 0; state.previewVisible = false;
    const form = $('#doc-form'); form.reset(); $('#doc-form-error').hidden = true; $('#markdown-preview').hidden = true;
    $('#toggle-markdown-preview').textContent = 'Preview Markdown ↗';
    form.elements.title.value = documentItem?.title || '';
    form.elements.category.value = documentItem?.category || '';
    form.elements.tags.value = getTags(documentItem).join(', ');
    form.elements.summary.value = documentItem?.summary || '';
    form.elements.content.value = documentItem?.content || '';
    const sourceField = $('#doc-source-field');
    sourceField.hidden = !mode.startsWith('admin-');
    if (form.elements.source) form.elements.source.value = documentItem ? getSource(documentItem) : 'official';
    const title = mode === 'edit' ? 'Suggest edits' : mode === 'admin-create' ? 'Create a document' : mode === 'admin-edit' ? 'Edit document' : 'Submit documentation';
    const kicker = mode.startsWith('admin-') ? 'DOCUMENTATION ADMINISTRATION' : 'CONTRIBUTE TO THE KNOWLEDGE BASE';
    const copy = mode === 'edit'
      ? 'Suggest corrections or improvements. Your changes will be reviewed before the public version is updated.'
      : mode === 'admin-create'
        ? 'Create and publish an official document or a community resource. You can update or reorder it later from this panel.'
        : mode === 'admin-edit'
          ? 'Update this published document. Changes are saved immediately.'
          : 'Share a useful guide with the Pancake community. New submissions are reviewed before publishing.';
    const submitLabel = mode === 'edit' || mode === 'submission' ? 'Send for review' : mode === 'admin-create' ? 'Publish document' : 'Save changes';
    $('#doc-form-title').textContent = title; $('#doc-form-kicker').textContent = kicker; $('#doc-form-copy').textContent = copy;
    $('#doc-form-submit').innerHTML = `${escapeHtml(submitLabel)} <span aria-hidden="true">↗</span>`;
    openDialog('doc-form-dialog');
  }

  async function submitDocForm(event) {
    event.preventDefault();
    const form = event.currentTarget, errorBox = $('#doc-form-error'), submitButton = $('#doc-form-submit');
    errorBox.hidden = true;
    const oldHtml = submitButton.innerHTML; submitButton.disabled = true; submitButton.textContent = 'Saving…';
    const fields = {
      title: form.elements.title.value.trim(), category: form.elements.category.value.trim(),
      tags: form.elements.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean),
      summary: form.elements.summary.value.trim(), content: form.elements.content.value.trim(),
      source: state.editorMode.startsWith('admin-') ? (form.elements.source?.value || 'official') : 'community'
    };
    try {
      let response;
      if (state.editorMode === 'submission' || state.editorMode === 'edit') {
        if (state.editorMode === 'edit') fields.documentId = state.editorDocumentId;
        response = await api('/api/docs/submissions', { method: 'POST', body: fields });
      } else if (state.editorMode === 'admin-create') {
        response = await api('/api/docs/admin/documents', { method: 'POST', body: fields });
      } else {
        response = await api(`/api/docs/admin/documents/${encodeURIComponent(state.editorDocumentId)}`, { method: 'PUT', body: { ...fields, order: state.editorOrder } });
      }
      closeDialog('doc-form-dialog'); notify(response.message || 'Documentation saved.');
      if (state.editorMode.startsWith('admin-')) { await loadAdminDashboard(false); await loadCatalogue(); }
      else if (state.editorMode === 'edit' && state.selectedDocument) await loadDocument(state.editorDocumentId);
      else navigateCatalogue();
    } catch (error) { errorBox.textContent = error.message || 'Could not save this document.'; errorBox.hidden = false; }
    finally { submitButton.disabled = false; submitButton.innerHTML = oldHtml; }
  }

  async function toggleFavorite(documentId) {
    if (!state.user) { login(); return; }
    try {
      const result = await api(`/api/docs/${encodeURIComponent(documentId)}/favorite`, { method: 'POST', body: {} });
      if (state.selectedDocument?.documentId === documentId) {
        state.selectedDocument.favorite = Boolean(result.favorited);
        renderDetail(state.selectedDocument, state.feedback, state.pendingChange);
      }
      state.allDocuments = state.allDocuments.map((item) => item.documentId === documentId ? { ...item, favorite: Boolean(result.favorited) } : item);
      notify(result.favorited ? 'Saved to My Library.' : 'Removed from saved documents.');
    } catch (error) { notify(error.message, 'error'); }
  }
  async function voteUseful(documentId, useful) {
    try {
      const result = await api(`/api/docs/${encodeURIComponent(documentId)}/useful`, { method: 'POST', body: { useful } });
      state.feedback = result;
      if (state.selectedDocument?.documentId === documentId) {
        state.selectedDocument.usefulCount = numericValue(result.yes, result.usefulCount, result.helpfulCount, state.selectedDocument.usefulCount);
        renderDetail(state.selectedDocument, result, state.pendingChange);
        updateCatalogueCountFor(documentId, state.selectedDocument.usefulCount);
      }
      notify('Thanks for helping us improve the documentation.');
    } catch (error) { notify(error.message, 'error'); }
  }
  function updateCatalogueCountFor(documentId, count) {
    state.allDocuments = state.allDocuments.map((item) => item.documentId === documentId ? { ...item, usefulCount: count } : item);
    if (state.currentMode === 'catalogue') renderCatalogue();
  }
  async function copyText(text, button = null, successMessage = 'Copied to clipboard.') {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement('textarea'); textarea.value = text;
        textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select();
        const copied = document.execCommand('copy'); textarea.remove(); if (!copied) throw new Error('Copy was blocked by this browser.');
      }
      if (button) {
        button.classList.add('is-copied'); const label = $('span', button); if (label) label.textContent = 'Copied';
        setTimeout(() => button.classList.remove('is-copied'), 1300);
      } else notify(successMessage);
    } catch (error) { notify(error.message || 'Could not copy to clipboard.', 'error'); }
  }

  function pendingSubmissionCard(request) {
    const item = { ...(request.fields || request.document || request), title: request.fields?.title || request.title || 'Untitled submission',
      summary: request.fields?.summary || request.summary || '', category: request.fields?.category || request.category || 'General',
      tags: request.fields?.tags || request.tags || [], authorDisplayName: request.authorDisplayName || request.author?.displayName || state.user?.displayName,
      createdAt: request.createdAt || request.submittedAt, source: 'community' };
    return cardMarkup(item, { pending: true });
  }
  function profilePendingList(data) {
    const possible = data.pendingForApproval ?? data.pendingSubmissions ?? data.pending ?? data.submissions ?? data.requests ?? data.waitingForReview;
    if (!Array.isArray(possible)) return [];
    return possible.filter((item) => {
      const status = String(item?.status || item?.reviewStatus || item?.state || '').toLowerCase();
      return !status || /pending|review|waiting|submitted|requested/.test(status);
    });
  }
  async function openLibrary() {
    if (!state.user) { login(); return; }
    setMode('library');
    $('#library-view').innerHTML = '<div class="docs-loading"><span class="docs-loader" aria-hidden="true"></span><span>Opening your library…</span></div>';
    try {
      const data = await api('/api/docs/profile');
      const favorites = Array.isArray(data.favorites) ? data.favorites : [];
      const authored = Array.isArray(data.authored) ? data.authored : [];
      const pending = profilePendingList(data);
      $('#library-view').innerHTML = `
        <header class="docs-page-heading docs-library-heading"><div><div class="docs-library-title-line">${avatarMarkup(state.user, 'docs-avatar docs-library-avatar')}<div><div class="kicker">YOUR PANCAKE LIBRARY</div><h2 id="library-heading">My Library</h2></div></div><p>Keep your saved references, published guides, and submissions in one place.</p></header>
        <section class="docs-library-section"><div class="docs-library-section-heading"><div><h3>Saved favorites <span class="docs-count-pill">${formatNumber(favorites.length)}</span></h3><p>Documents you bookmarked for later.</p></div><button class="docs-text-button" type="button" data-go-catalogue>Browse docs ↗</button></div><div class="docs-library-grid">${favorites.map((item) => cardMarkup(item)).join('') || '<div class="docs-inline-empty">You have not saved any documents yet.</div>'}</div></section>
        <section class="docs-library-section"><div class="docs-library-section-heading"><div><h3>Published by you <span class="docs-count-pill">${formatNumber(authored.length)}</span></h3><p>Your documentation that has been approved and published.</p></div></div><div class="docs-library-grid">${authored.map((item) => cardMarkup(item)).join('') || '<div class="docs-inline-empty">You have not published any documents yet.</div>'}</div></section>
        <section class="docs-library-section"><div class="docs-library-section-heading"><div><h3>Pending for approval <span class="docs-count-pill">${formatNumber(pending.length)}</span></h3><p>Submissions and edits waiting for the documentation team to review.</p></div></div><div class="docs-library-grid">${pending.map(pendingSubmissionCard).join('') || '<div class="docs-inline-empty">You have no documents waiting for approval.</div>'}</div></section>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      $('#library-view').innerHTML = `<div class="docs-empty-state"><h3>Could not load your library</h3><p>${escapeHtml(error.message)}</p><button class="docs-small-button" type="button" data-go-catalogue>← Back to all docs</button></div>`;
    }
  }

  function renderAdmin() {
    const data = state.adminData || { documents: [], requests: [] };
    const documents = [...(data.documents || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.title).localeCompare(String(b.title)));
    const requests = data.requests || [];
    const categories = new Set(documents.map((item) => item.category).filter(Boolean));
    const requestRows = requests.map((request) => {
      const fields = request.fields || {};
      const typeLabel = request.requestType === 'edit' ? 'EDIT REQUEST' : 'NEW SUBMISSION';
      return `<article class="docs-admin-row docs-request-row"><div class="docs-admin-row-main"><strong>${escapeHtml(fields.title || 'Untitled submission')}</strong><p>${escapeHtml(fields.summary || 'No summary provided.')}</p><div class="docs-admin-row-meta"><span>${typeLabel}</span><span>By ${escapeHtml(request.authorDisplayName || 'Unknown')}</span><span>Submitted ${escapeHtml(formatDate(request.createdAt))}</span>${fields.category ? `<span>${escapeHtml(fields.category)}</span>` : ''}</div></div><div class="docs-admin-row-actions"><button class="docs-small-button" type="button" data-action="toggle-request-preview">Preview</button><button class="docs-small-button" type="button" data-action="approve-request" data-request-id="${escapeHtml(request.requestId)}">Approve</button><button class="docs-small-button" type="button" data-action="reject-request" data-request-id="${escapeHtml(request.requestId)}">Reject</button></div><div class="docs-request-preview" hidden><div class="docs-admin-row-meta"><span>Markdown submission</span>${(fields.tags || []).map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>${renderMarkdown(fields.content || '', 'docs-request-markdown')}</div></article>`;
    }).join('');
    const documentRows = documents.map((item, index) => `<article class="docs-admin-row"><div class="docs-admin-row-main"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary || 'No summary provided.')}</p><div class="docs-admin-row-meta"><span>${escapeHtml(item.category || 'General')}</span><span>${getSource(item) === 'official' ? 'Official' : 'Community'}</span><span>By ${escapeHtml(item.authorDisplayName || 'Unknown')}</span><span>Updated ${escapeHtml(formatDate(item.updatedAt || item.createdAt))}</span><span>Order ${index + 1}</span></div></div><div class="docs-admin-row-actions"><div class="docs-order-buttons"><button type="button" data-action="move-doc" data-document-id="${escapeHtml(item.documentId)}" data-delta="-1" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-action="move-doc" data-document-id="${escapeHtml(item.documentId)}" data-delta="1" aria-label="Move down" ${index === documents.length - 1 ? 'disabled' : ''}>↓</button></div><button type="button" class="docs-small-button" data-action="edit-admin-document" data-document-id="${escapeHtml(item.documentId)}">Edit</button><button type="button" class="docs-small-button" data-action="delete-admin-document" data-document-id="${escapeHtml(item.documentId)}">Delete</button></div></article>`).join('');
    $('#admin-view').innerHTML = `
      <header class="docs-page-heading"><div><div class="kicker">EDITORIAL WORKSPACE</div><h2 id="admin-heading">Documents admin</h2><p>Review submissions, maintain published articles, and decide how the knowledge base is organized.</p></div><div class="docs-heading-actions"><button class="docs-back-button" type="button" data-go-catalogue>← Back to all docs</button><button class="docs-small-button docs-primary-small" type="button" data-action="new-admin-document">＋ New document</button></div></header>
      <div class="docs-admin-summary"><div class="docs-admin-stat"><span>Published documents</span><strong>${formatNumber(documents.length)}</strong></div><div class="docs-admin-stat"><span>Waiting for review</span><strong>${formatNumber(requests.length)}</strong></div><div class="docs-admin-stat"><span>Topics</span><strong>${formatNumber(categories.size)}</strong></div></div>
      <section class="docs-admin-section docs-admin-review"><div class="docs-admin-section-header"><div><h3>Submissions &amp; suggested edits</h3><p>Approve to publish a new page or replace the existing page with the author's suggested update.</p></div></div><div class="docs-admin-rows">${requestRows || '<div class="docs-inline-empty">The review queue is clear. No submissions are waiting.</div>'}</div></section>
      <section class="docs-admin-section"><div class="docs-admin-section-header"><div><h3>Published documents</h3><p>Use the arrows to change public reading order. Select Official or Community when editing a document.</p></div><button class="docs-small-button" type="button" data-action="refresh-admin">Refresh</button></div><div class="docs-admin-rows">${documentRows || '<div class="docs-inline-empty">No documents have been published yet. Create the first one.</div>'}</div></section>
      <p class="docs-admin-status" id="docs-admin-status">Administrator changes use the same Discord authorization and additional admin verification as Plugin Portal.</p>`;
  }
  async function loadAdminDashboard(enterMode = true) {
    try {
      state.adminData = await api('/api/docs/admin/dashboard'); state.adminUnlocked = true;
      if (enterMode) setMode('admin'); renderAdmin(); return true;
    } catch (error) {
      if (enterMode) setMode('catalogue'); notify(error.message || 'Could not open Documents administration.', 'error'); return false;
    }
  }
  async function openAdminPanel() {
    if (!state.user) { login(); return; }
    if (!state.canAccessAdmin) { notify('This Discord account is not an authorized administrator.', 'error'); return; }
    $('#admin-auth-error').hidden = true; $('#admin-auth-form').reset(); openDialog('admin-auth-dialog');
  }
  async function submitAdminAuth(event) {
    event.preventDefault();
    const form = event.currentTarget, errorBox = $('#admin-auth-error'), submit = $('button[type="submit"]', form);
    errorBox.hidden = true; const oldText = submit.textContent; submit.disabled = true; submit.textContent = 'Verifying…';
    try {
      state.adminUnlocked = false;
      const data = await api('/api/docs/admin/access', { method: 'POST', body: { adminAuth: { username: form.elements.username.value.trim(), password: form.elements.password.value } } });
      state.adminData = { documents: data.documents || [], requests: data.requests || [] }; state.adminUnlocked = true;
      closeDialog('admin-auth-dialog'); setMode('admin'); renderAdmin(); notify('Documents administration unlocked.');
    } catch (error) { errorBox.textContent = error.message || 'Admin verification failed.'; errorBox.hidden = false; }
    finally { submit.disabled = false; submit.textContent = oldText; }
  }
  async function reorderDocuments(documentId, delta) {
    const sorted = [...(state.adminData.documents || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.title).localeCompare(String(b.title)));
    const index = sorted.findIndex((item) => item.documentId === documentId), next = index + delta;
    if (index < 0 || next < 0 || next >= sorted.length) return;
    [sorted[index], sorted[next]] = [sorted[next], sorted[index]];
    try { await api('/api/docs/admin/reorder', { method: 'PUT', body: { documentIds: sorted.map((item) => item.documentId) } }); await loadAdminDashboard(false); notify('Document order saved.'); }
    catch (error) { notify(error.message, 'error'); }
  }
  async function reviewRequest(requestId, approved) {
    const action = approved ? 'approve' : 'reject';
    if (!window.confirm(approved ? 'Approve and publish this documentation?' : 'Reject this documentation submission?')) return;
    try {
      const result = await api(`/api/docs/admin/requests/${encodeURIComponent(requestId)}/${action}`, { method: 'POST', body: {} });
      notify(result.message || 'Review action completed.'); await loadAdminDashboard(false); await loadCatalogue();
    } catch (error) { notify(error.message, 'error'); }
  }
  async function deleteAdminDocument(documentId) {
    const item = (state.adminData.documents || []).find((candidate) => candidate.documentId === documentId);
    if (!window.confirm(`Delete "${item?.title || 'this document'}" permanently? Its saved favorites and usefulness votes will also be removed.`)) return;
    try {
      const result = await api(`/api/docs/admin/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE', body: {} });
      notify(result.message || 'Document deleted.'); await loadAdminDashboard(false); await loadCatalogue();
      if (state.selectedDocument?.documentId === documentId) navigateCatalogue();
    } catch (error) { notify(error.message, 'error'); }
  }

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target) return;

    const closeButton = target.closest('[data-close-dialog]');
    if (closeButton) { closeDialog(closeButton.dataset.closeDialog); return; }

    const sectionAnchor = target.closest('[data-doc-anchor]');
    if (sectionAnchor) {
      const id = sectionAnchor.dataset.docAnchor || sectionAnchor.getAttribute('href')?.slice(1) || '';
      if (scrollToSection(id)) { event.preventDefault(); return; }
    }

    const tagFilter = target.closest('[data-tag-filter]');
    if (tagFilter) {
      event.preventDefault(); state.selectedTag = tagFilter.dataset.tagFilter || '';
      if (state.currentMode !== 'catalogue') history.pushState({}, '', `${basePath}/`);
      resetShareMetadata(); setMode('catalogue'); renderCatalogue(); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
    }
    const topicFilter = target.closest('[data-topic-filter]');
    if (topicFilter) {
      event.preventDefault(); state.selectedCategory = topicFilter.dataset.topicFilter || '';
      if (state.currentMode !== 'catalogue') history.pushState({}, '', `${basePath}/`);
      resetShareMetadata(); setMode('catalogue'); renderCatalogue(); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
    }
    const docLink = target.closest('[data-open-doc]');
    if (docLink) { event.preventDefault(); navigateDocument(docLink.dataset.openDoc); return; }

    const topicButton = target.closest('[data-topic]');
    if (topicButton) { state.selectedCategory = topicButton.dataset.topic || ''; state.selectedTag = ''; setMode('catalogue'); renderCatalogue(); return; }
    const goCatalogue = target.closest('[data-go-catalogue]');
    if (goCatalogue) { event.preventDefault(); navigateCatalogue(); return; }

    const card = target.closest('[data-card-href]');
    if (card && !target.closest('a,button,input,select,textarea')) {
      navigateDocument(card.dataset.cardHref.match(/[?&]doc=([^&]+)/)?.[1] ? decodeURIComponentSafe(card.dataset.cardHref.match(/[?&]doc=([^&]+)/)[1]) : '');
      return;
    }
    const copyCodeButton = target.closest('[data-copy-code]');
    if (copyCodeButton) { const code = copyCodeButton.closest('.docs-code-block')?.querySelector('pre code,pre')?.textContent || ''; await copyText(code, copyCodeButton); return; }

    if (target.closest('#login-button')) { login(); return; }
    if (target.closest('#submit-doc-button, #sidebar-submit-button')) { requireLoginThen(() => openDocForm('submission')); return; }
    if (target.closest('#library-button')) { await openLibrary(); return; }
    if (target.closest('#admin-button')) { await openAdminPanel(); return; }
    if (target.closest('#logout-button')) {
      try { if (state.accessToken) await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* Clear local sign-in even if logout endpoint is unavailable. */ }
      state.accessToken = ''; state.user = null; state.canAccessAdmin = false; state.adminUnlocked = false; saveAccessToken(''); updateAccountButtons();
      navigateCatalogue(); await loadCatalogue(); notify('You have been signed out.'); return;
    }
    if (target.closest('#clear-search-button, #reset-search-button, [data-reset-filters]')) {
      state.query = ''; state.selectedCategory = ''; state.selectedTag = ''; $('#docs-search').value = '';
      setMode('catalogue'); renderCatalogue(); return;
    }
    if (target.closest('#retry-docs-button')) { await loadCatalogue(); return; }
    if (target.closest('#toggle-markdown-preview')) {
      state.previewVisible = !state.previewVisible; $('#markdown-preview').hidden = !state.previewVisible;
      $('#toggle-markdown-preview').textContent = state.previewVisible ? 'Hide Markdown preview ↑' : 'Preview Markdown ↗';
      if (state.previewVisible) $('#markdown-preview').innerHTML = renderMarkdown($('#doc-form').elements.content.value, 'docs-preview-content'); return;
    }

    const actionButton = target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action, documentId = actionButton.dataset.documentId;
    if (action === 'favorite-document') { await toggleFavorite(documentId); return; }
    if (action === 'vote-useful') { await voteUseful(documentId, actionButton.dataset.useful === 'true'); return; }
    if (action === 'share-document') {
      const url = shareUrl(documentId);
      await copyText(url, null, 'Share link copied to clipboard.'); return;
    }
    if (action === 'edit-document') { if (state.selectedDocument?.documentId === documentId) requireLoginThen(() => openDocForm('edit', state.selectedDocument)); return; }
    if (action === 'new-admin-document') { openDocForm('admin-create'); return; }
    if (action === 'edit-admin-document') { const item = (state.adminData.documents || []).find((candidate) => candidate.documentId === documentId); if (item) openDocForm('admin-edit', item); return; }
    if (action === 'delete-admin-document') { await deleteAdminDocument(documentId); return; }
    if (action === 'move-doc') { await reorderDocuments(documentId, Number(actionButton.dataset.delta) || 0); return; }
    if (action === 'refresh-admin') { await loadAdminDashboard(false); notify('Administration refreshed.'); return; }
    if (action === 'approve-request') { await reviewRequest(actionButton.dataset.requestId, true); return; }
    if (action === 'reject-request') { await reviewRequest(actionButton.dataset.requestId, false); return; }
    if (action === 'toggle-request-preview') {
      const row = actionButton.closest('.docs-request-row'), preview = $('.docs-request-preview', row);
      if (preview) preview.hidden = !preview.hidden;
      actionButton.textContent = preview && !preview.hidden ? 'Hide preview' : 'Preview';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target instanceof Element ? event.target.closest('[data-card-href]') : null;
    if (card && event.target === card) {
      event.preventDefault();
      const match = card.dataset.cardHref.match(/[?&]doc=([^&]+)/);
      if (match) navigateDocument(decodeURIComponentSafe(match[1]));
    }
  });
  $('#docs-search').addEventListener('input', (event) => {
    state.query = event.currentTarget.value;
    if (state.currentMode !== 'catalogue') { history.pushState({}, '', `${basePath}/`); setMode('catalogue'); }
    renderCatalogue();
  });
  $('#official-sort').addEventListener('change', (event) => { state.sort.official = event.currentTarget.value; renderCatalogue(); });
  $('#community-sort').addEventListener('change', (event) => { state.sort.community = event.currentTarget.value; renderCatalogue(); });
  $('#admin-auth-form').addEventListener('submit', submitAdminAuth);
  $('#doc-form').addEventListener('submit', submitDocForm);
  $('#doc-form').elements.content.addEventListener('input', () => {
    if (state.previewVisible) $('#markdown-preview').innerHTML = renderMarkdown($('#doc-form').elements.content.value, 'docs-preview-content');
  });
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search), documentId = params.get('doc');
    if (documentId && /^\d{1,40}$/.test(documentId)) {
      if (state.currentMode === 'detail' && String(state.selectedDocument?.documentId || '') === String(documentId)) {
        if (window.location.hash) scrollToSection(window.location.hash.slice(1), { updateUrl: false });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      } else loadDocument(documentId);
    } else { resetShareMetadata(); setMode('catalogue'); renderCatalogue(); }
  });

  async function init() {
    $('#year').textContent = String(new Date().getFullYear());
    await exchangeAuthCode();
    const params = new URLSearchParams(window.location.search), authStatus = params.get('auth');
    if (authStatus === 'cancelled') notify('Discord sign-in was cancelled.', 'error');
    if (authStatus === 'error') notify('Discord sign-in could not be completed. Please try again.', 'error');
    if (authStatus) { params.delete('auth'); const cleanUrl = new URL(window.location.href); cleanUrl.search = params.toString(); history.replaceState({}, '', cleanUrl.toString()); }
    await refreshSession(); await loadCatalogue();
    const documentId = new URLSearchParams(window.location.search).get('doc');
    if (documentId && /^\d{1,40}$/.test(documentId)) await loadDocument(documentId);
  }
  init();
})();
