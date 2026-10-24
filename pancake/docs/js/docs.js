// pancake/docs/js/docs.js
(() => {
  'use strict';

  const basePath = (document.querySelector('meta[name="portal-base-path"]')?.content || '/pancake-development-team/pancake/docs').replace(/\/$/, '');
  const apiBase = (document.querySelector('meta[name="api-base"]')?.content || '').trim().replace(/\/$/, '');
  const accessTokenKey = 'pancakePluginPortalAccessToken';
  const viewerKey = 'pancakeDocsViewerId';

  function readAccessToken() {
    try { return localStorage.getItem(accessTokenKey) || ''; } catch { return ''; }
  }

  function saveAccessToken(value) {
    try { if (value) localStorage.setItem(accessTokenKey, value); else localStorage.removeItem(accessTokenKey); } catch { /* The portal can still run for anonymous readers. */ }
  }

  const state = {
    accessToken: readAccessToken(),
    viewerId: getViewerId(),
    user: null,
    canAccessAdmin: false,
    adminUnlocked: false,
    currentMode: 'catalogue',
    allDocuments: [],
    categories: [],
    selectedCategory: '',
    query: '',
    selectedDocument: null,
    feedback: null,
    pendingChange: null,
    adminData: { documents: [], requests: [] },
    editorMode: 'submission',
    editorDocumentId: '',
    editorOrder: 0,
    previewVisible: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function getViewerId() {
    try {
      let id = localStorage.getItem(viewerKey);
      if (!id) {
        id = window.crypto?.randomUUID ? window.crypto.randomUUID() : `docs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(viewerKey, id);
      }
      return id;
    } catch {
      return `docs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function formatDate(value) {
    if (!value) return 'Recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('en-US').format(Number(value) || 0);
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
    notify.timer = setTimeout(() => toast.remove(), 5500);
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

  function updateAccountButtons() {
    $('#login-button').hidden = Boolean(state.user);
    $('#submit-doc-button').hidden = !state.user;
    $('#library-button').hidden = !state.user;
    $('#logout-button').hidden = !state.user;
    $('#admin-button').hidden = !(state.user && state.canAccessAdmin);
  }

  async function refreshSession() {
    try {
      const result = await api('/api/auth/me');
      state.user = result.user || null;
      state.canAccessAdmin = Boolean(result.canAccessAdmin);
      if (!state.user && state.accessToken) {
        state.accessToken = '';
        saveAccessToken('');
      }
      updateAccountButtons();
      return result;
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        state.accessToken = '';
        state.user = null;
        state.canAccessAdmin = false;
        saveAccessToken('');
        updateAccountButtons();
      } else {
        console.warn('Documents account check failed:', error.message);
      }
      return null;
    }
  }

  function login() {
    if (!apiBase) {
      notify('The API URL has not been configured yet.', 'error');
      return;
    }
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
      const cleanUrl = new URL(window.location.href);
      cleanUrl.hash = '';
      history.replaceState({}, '', cleanUrl.toString());
      await refreshSession();
      notify('Signed in with Discord. Welcome back!');
    } catch (error) {
      notify(error.message || 'Discord sign-in could not be completed.', 'error');
    }
  }

  function slugify(value) {
    return String(value || '')
      .trim().toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section';
  }

  function renderMarkdown(value, extraClass = '') {
    const source = String(value ?? '').trim();
    if (!source) return `<div class="docs-markdown ${escapeHtml(extraClass)}"></div>`;
    const className = `docs-markdown${extraClass ? ` ${extraClass}` : ''}`;
    let html = escapeHtml(source).replace(/\r?\n/g, '<br>');
    if (window.marked && window.DOMPurify) {
      try {
        html = window.DOMPurify.sanitize(window.marked.parse(source, { gfm: true, breaks: true }), { USE_PROFILES: { html: true } });
      } catch (error) {
        console.warn('Markdown rendering failed; showing plain text instead.', error);
      }
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
      const anchor = document.createElement('a');
      anchor.className = 'markdown-heading-anchor';
      anchor.href = `#${slug}`;
      anchor.setAttribute('aria-label', `Link to ${heading.textContent.trim()}`);
      anchor.title = 'Link to this section';
      anchor.textContent = '#';
      heading.prepend(anchor);
    });
    container.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });
    container.querySelectorAll('pre').forEach((pre) => {
      if (pre.closest('.docs-code-block')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'docs-code-block';
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'docs-code-copy';
      button.setAttribute('data-copy-code', '');
      button.setAttribute('aria-label', 'Copy code block');
      button.title = 'Copy code';
      const image = document.createElement('img');
      image.src = '../../assets/copy.png';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = 'Copied';
      button.append(image, label);
      wrapper.appendChild(button);
    });
    return container.outerHTML;
  }

  function cardMarkup(documentItem) {
    const category = documentItem.category ? `<span class="docs-topic-pill">${escapeHtml(documentItem.category)}</span>` : '<span class="docs-topic-pill">General</span>';
    const tags = (documentItem.tags || []).slice(0, 5).map((tag) => `<span class="docs-tag">${escapeHtml(tag)}</span>`).join('');
    const updatedDate = formatDate(documentItem.updatedAt || documentItem.createdAt);
    return `
      <article class="docs-card">
        <div class="docs-card-main">
          <div class="docs-card-eyebrow">${category}<span>·</span><span>DOCUMENTATION</span></div>
          <h3><a class="docs-card-link" data-open-doc="${escapeHtml(documentItem.documentId)}" href="${basePath}/?doc=${encodeURIComponent(documentItem.documentId)}">${escapeHtml(documentItem.title)}</a></h3>
          <p class="docs-card-summary">${escapeHtml(documentItem.summary || 'Open this document to read the full guide.')}</p>
          ${tags ? `<div class="docs-card-tags">${tags}</div>` : ''}
          <div class="docs-card-footer"><span>By <strong>${escapeHtml(documentItem.authorDisplayName || 'Unknown')}</strong></span><span>Updated <strong>${escapeHtml(updatedDate)}</strong></span></div>
        </div>
        <span class="docs-card-arrow" aria-hidden="true">↗</span>
      </article>`;
  }

  function renderTopics() {
    const wrap = $('#docs-topic-filters');
    const allActive = state.selectedCategory === '';
    const all = `<button class="docs-topic-button${allActive ? ' is-active' : ''}" data-topic="" type="button" aria-pressed="${allActive}">All documents <span>${formatNumber(state.allDocuments.length)}</span></button>`;
    const topics = state.categories.map((category) => {
      const active = state.selectedCategory === category;
      const count = state.allDocuments.filter((item) => item.category === category).length;
      return `<button class="docs-topic-button${active ? ' is-active' : ''}" data-topic="${escapeHtml(category)}" type="button" aria-pressed="${active}">${escapeHtml(category)} <span>${formatNumber(count)}</span></button>`;
    }).join('');
    wrap.innerHTML = all + topics;
  }

  function renderCatalogue() {
    renderTopics();
    const search = state.query.trim().toLowerCase();
    const matches = state.allDocuments.filter((item) => {
      if (state.selectedCategory && item.category !== state.selectedCategory) return false;
      if (!search) return true;
      const haystack = [item.title, item.summary, item.content, item.category, item.authorDisplayName, ...(item.tags || [])].join(' ').toLowerCase();
      return haystack.includes(search);
    });
    $('#docs-result-count').textContent = `${formatNumber(matches.length)} document${matches.length === 1 ? '' : 's'}${search ? ' found' : ' available'}`;
    $('#clear-search-button').hidden = !state.query && !state.selectedCategory;
    $('#docs-list').hidden = matches.length === 0;
    $('#docs-empty-state').hidden = matches.length !== 0;
    $('#docs-list').innerHTML = matches.map(cardMarkup).join('');
  }

  async function loadCatalogue() {
    $('#docs-list').hidden = false;
    $('#docs-list').innerHTML = '<div class="docs-loading"><span class="docs-loader" aria-hidden="true"></span><span>Gathering the pages…</span></div>';
    try {
      const data = await api('/api/docs');
      state.allDocuments = Array.isArray(data.documents) ? data.documents : [];
      state.categories = Array.isArray(data.categories) ? data.categories : [];
      renderCatalogue();
    } catch (error) {
      state.allDocuments = [];
      state.categories = [];
      $('#docs-list').hidden = true;
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
    if (!headings.length) {
      toc.innerHTML = '<span class="docs-toc-empty">This page has no section headings.</span>';
      return;
    }
    toc.innerHTML = headings.map((heading) => {
      const depth = Number(heading.tagName.slice(1));
      const name = heading.textContent.replace(/^#\s*/, '').trim();
      return `<a href="#${encodeURIComponent(heading.id)}" data-depth="${depth}">${escapeHtml(name)}</a>`;
    }).join('');
  }

  function renderDetail(documentItem, feedback, pendingChange = null) {
    state.selectedDocument = documentItem;
    state.feedback = feedback || { yes: 0, no: 0, yourVote: null };
    state.pendingChange = pendingChange;
    const owner = Boolean(state.user && String(state.user.discordId) === String(documentItem.authorId || ''));
    const category = documentItem.category || 'General';
    const favoriteLabel = documentItem.favorite ? 'Saved to favorites' : 'Save to favorites';
    const vote = state.feedback.yourVote;
    const pendingNotice = pendingChange ? '<div class="docs-pending-note">You have edits waiting for administrator review. The published version is still shown to everyone.</div>' : '';
    $('#detail-view').innerHTML = `
      <div class="docs-detail-top"><a href="${basePath}/" class="docs-back-link" data-go-catalogue>← All documents</a><span class="docs-topic-pill">${escapeHtml(category)}</span></div>
      <div class="docs-reading-layout">
        <article class="docs-article">
          <header class="docs-article-header">
            <span class="docs-article-category">${escapeHtml(category)}</span>
            <h1 class="docs-article-title">${escapeHtml(documentItem.title)}</h1>
            ${documentItem.summary ? `<p class="docs-article-summary">${escapeHtml(documentItem.summary)}</p>` : ''}
            <div class="docs-article-meta"><span>By <strong>${escapeHtml(documentItem.authorDisplayName || 'Unknown')}</strong></span><span>·</span><span>Published ${escapeHtml(formatDate(documentItem.createdAt))}</span><span>·</span><span>Last updated <strong>${escapeHtml(formatDate(documentItem.updatedAt || documentItem.createdAt))}</strong></span></div>
            <div class="docs-article-actions">
              <button type="button" class="docs-action-button${documentItem.favorite ? ' is-active' : ''}" data-action="favorite-document" data-document-id="${escapeHtml(documentItem.documentId)}">☆ <span>${escapeHtml(favoriteLabel)}</span></button>
              ${owner ? '<button type="button" class="docs-action-button" data-action="edit-document" data-document-id="'+escapeHtml(documentItem.documentId)+'">✎ <span>Edit doc</span></button>' : ''}
              <button type="button" class="docs-action-button" data-action="copy-document-link" data-document-id="${escapeHtml(documentItem.documentId)}">↗ <span>Copy link</span></button>
            </div>
            ${pendingNotice}
          </header>
          ${renderMarkdown(documentItem.content, 'docs-article-body')}
          <section class="docs-useful-panel" aria-labelledby="docs-useful-heading">
            <div class="docs-useful-copy"><h2 id="docs-useful-heading">Was this useful?</h2><p>Your feedback helps us improve these documents. No sign-in required.</p><p id="docs-feedback-status" class="docs-feedback-status">${vote === true ? 'Thanks — you marked this helpful.' : vote === false ? 'Thanks — your feedback has been recorded.' : ''}</p></div>
            <div class="docs-useful-actions"><button class="docs-action-button${vote === true ? ' is-active' : ''}" data-action="vote-useful" data-useful="true" data-document-id="${escapeHtml(documentItem.documentId)}" type="button" aria-pressed="${vote === true}">Yes <span class="docs-useful-count">${formatNumber(state.feedback.yes)}</span></button><button class="docs-action-button${vote === false ? ' is-active' : ''}" data-action="vote-useful" data-useful="false" data-document-id="${escapeHtml(documentItem.documentId)}" type="button" aria-pressed="${vote === false}">No <span class="docs-useful-count">${formatNumber(state.feedback.no)}</span></button></div>
          </section>
        </article>
        <aside class="docs-toc" aria-label="On this page"><h2>On this page</h2><nav id="docs-toc-links" class="docs-toc-links"></nav></aside>
      </div>`;
    setMode('detail');
    buildToc();
    if (window.location.hash && !window.location.hash.startsWith('#auth_code')) {
      let target = window.location.hash.slice(1);
      try { target = decodeURIComponent(target); } catch { /* Keep the raw anchor. */ }
      setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  async function loadDocument(documentId) {
    setMode('detail');
    $('#detail-view').innerHTML = '<div class="docs-loading"><span class="docs-loader" aria-hidden="true"></span><span>Opening document…</span></div>';
    try {
      const result = await api(`/api/docs/${encodeURIComponent(documentId)}`);
      renderDetail(result.document, result.feedback, result.pendingChange);
    } catch (error) {
      $('#detail-view').innerHTML = `<div class="docs-empty-state"><span class="docs-empty-mark" aria-hidden="true">!</span><h3>Could not open this document</h3><p>${escapeHtml(error.message)}</p><button class="docs-small-button" data-go-catalogue type="button">Back to Documents</button></div>`;
    }
  }

  function navigateCatalogue(updateHistory = true) {
    if (updateHistory) history.pushState({}, '', `${basePath}/`);
    state.selectedCategory = '';
    setMode('catalogue');
    renderCatalogue();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function navigateDocument(documentId, updateHistory = true) {
    if (updateHistory) history.pushState({}, '', `${basePath}/?doc=${encodeURIComponent(documentId)}`);
    loadDocument(documentId);
  }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function requireLoginThen(callback) {
    if (!state.user) {
      notify('Sign in with Discord to save documents or submit your own.', 'info');
      login();
      return;
    }
    callback();
  }

  function openDocForm(mode, documentItem = null) {
    if (!state.user && mode !== 'admin-create' && mode !== 'admin-edit') {
      login();
      return;
    }
    state.editorMode = mode;
    state.editorDocumentId = documentItem?.documentId || '';
    state.editorOrder = Number(documentItem?.order) || 0;
    state.previewVisible = false;
    const form = $('#doc-form');
    form.reset();
    $('#doc-form-error').hidden = true;
    $('#markdown-preview').hidden = true;
    $('#toggle-markdown-preview').textContent = 'Preview Markdown ↗';
    form.elements.title.value = documentItem?.title || '';
    form.elements.category.value = documentItem?.category || '';
    form.elements.tags.value = (documentItem?.tags || []).join(', ');
    form.elements.summary.value = documentItem?.summary || '';
    form.elements.content.value = documentItem?.content || '';
    const title = mode === 'edit' ? 'Suggest edits' : mode === 'admin-create' ? 'Create a document' : mode === 'admin-edit' ? 'Edit document' : 'Submit documentation';
    const kicker = mode.startsWith('admin-') ? 'DOCUMENTATION ADMINISTRATION' : 'CONTRIBUTE TO THE KNOWLEDGE BASE';
    const copy = mode === 'edit'
      ? 'Suggest corrections or improvements. Your changes will be reviewed before the public version is updated.'
      : mode === 'admin-create'
        ? 'Create and publish an official document. You can update or reorder it later from this panel.'
        : mode === 'admin-edit'
          ? 'Update this published document. Changes are saved immediately.'
          : 'Share a useful guide with the Pancake community. New submissions are reviewed before publishing.';
    const submitLabel = mode === 'edit' || mode === 'submission' ? 'Send for review' : mode === 'admin-create' ? 'Publish document' : 'Save changes';
    $('#doc-form-title').textContent = title;
    $('#doc-form-kicker').textContent = kicker;
    $('#doc-form-copy').textContent = copy;
    $('#doc-form-submit').innerHTML = `${escapeHtml(submitLabel)} <span aria-hidden="true">↗</span>`;
    openDialog('doc-form-dialog');
  }

  async function submitDocForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = $('#doc-form-error');
    errorBox.hidden = true;
    const submitButton = $('#doc-form-submit');
    const oldHtml = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.textContent = 'Saving…';
    const fields = {
      title: form.elements.title.value.trim(),
      category: form.elements.category.value.trim(),
      tags: form.elements.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean),
      summary: form.elements.summary.value.trim(),
      content: form.elements.content.value.trim()
    };
    try {
      let response;
      if (state.editorMode === 'submission' || state.editorMode === 'edit') {
        if (state.editorMode === 'edit') fields.documentId = state.editorDocumentId;
        response = await api('/api/docs/submissions', { method: 'POST', body: fields });
      } else if (state.editorMode === 'admin-create') {
        response = await api('/api/docs/admin/documents', { method: 'POST', body: fields });
      } else {
        response = await api(`/api/docs/admin/documents/${encodeURIComponent(state.editorDocumentId)}`, {
          method: 'PUT', body: { ...fields, order: state.editorOrder }
        });
      }
      closeDialog('doc-form-dialog');
      notify(response.message || 'Documentation saved.');
      if (state.editorMode.startsWith('admin-')) {
        await loadAdminDashboard(false);
        await loadCatalogue();
      } else if (state.editorMode === 'edit' && state.selectedDocument) {
        await loadDocument(state.editorDocumentId);
      } else {
        navigateCatalogue();
      }
    } catch (error) {
      errorBox.textContent = error.message || 'Could not save this document.';
      errorBox.hidden = false;
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = oldHtml;
    }
  }

  async function toggleFavorite(documentId) {
    if (!state.user) {
      login();
      return;
    }
    try {
      const result = await api(`/api/docs/${encodeURIComponent(documentId)}/favorite`, { method: 'POST', body: {} });
      if (state.selectedDocument?.documentId === documentId) {
        state.selectedDocument.favorite = Boolean(result.favorited);
        renderDetail(state.selectedDocument, state.feedback, state.pendingChange);
      }
      state.allDocuments = state.allDocuments.map((item) => item.documentId === documentId ? { ...item, favorite: Boolean(result.favorited) } : item);
      notify(result.favorited ? 'Saved to My Library.' : 'Removed from saved documents.');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function voteUseful(documentId, useful) {
    try {
      const result = await api(`/api/docs/${encodeURIComponent(documentId)}/useful`, { method: 'POST', body: { useful } });
      state.feedback = result;
      if (state.selectedDocument?.documentId === documentId) renderDetail(state.selectedDocument, result, state.pendingChange);
      notify('Thanks for helping us improve the documentation.');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function copyText(text, button = null) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy was blocked by this browser.');
      }
      if (button) {
        button.classList.add('is-copied');
        const label = $('span', button);
        if (label) label.textContent = 'Copied';
        setTimeout(() => button.classList.remove('is-copied'), 1300);
      } else {
        notify('Link copied to clipboard.');
      }
    } catch (error) {
      notify(error.message || 'Could not copy to clipboard.', 'error');
    }
  }

  async function openLibrary() {
    if (!state.user) { login(); return; }
    setMode('library');
    $('#library-view').innerHTML = '<div class="docs-loading"><span class="docs-loader" aria-hidden="true"></span><span>Opening your library…</span></div>';
    try {
      const data = await api('/api/docs/profile');
      $('#library-view').innerHTML = `
        <header class="docs-page-heading"><div><div class="kicker">YOUR PANCAKE LIBRARY</div><h2 id="library-heading">My Library</h2><p>Keep your essential references close and revisit the documents you published.</p></div><button class="docs-small-button" type="button" data-go-catalogue>Browse Documents ↗</button></header>
        <section class="docs-library-section"><h3>Saved favorites</h3><p>Documents you bookmarked for later.</p><div class="docs-library-grid">${(data.favorites || []).map(cardMarkup).join('') || '<div class="docs-inline-empty">You have not saved any documents yet.</div>'}</div></section>
        <section class="docs-library-section"><h3>Published by you</h3><p>Your documentation that has been approved and published.</p><div class="docs-library-grid">${(data.authored || []).map(cardMarkup).join('') || '<div class="docs-inline-empty">You have not published any documents yet.</div>'}</div></section>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      $('#library-view').innerHTML = `<div class="docs-empty-state"><h3>Could not load your library</h3><p>${escapeHtml(error.message)}</p><button class="docs-small-button" type="button" data-go-catalogue>Back to Documents</button></div>`;
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
      return `<article class="docs-admin-row docs-request-row">
        <div class="docs-admin-row-main"><strong>${escapeHtml(fields.title || 'Untitled submission')}</strong><p>${escapeHtml(fields.summary || 'No summary provided.')}</p><div class="docs-admin-row-meta"><span>${typeLabel}</span><span>By ${escapeHtml(request.authorDisplayName || 'Unknown')}</span><span>Submitted ${escapeHtml(formatDate(request.createdAt))}</span>${fields.category ? `<span>${escapeHtml(fields.category)}</span>` : ''}</div></div>
        <div class="docs-admin-row-actions"><button class="docs-small-button" type="button" data-action="toggle-request-preview">Preview</button><button class="docs-small-button" type="button" data-action="approve-request" data-request-id="${escapeHtml(request.requestId)}">Approve</button><button class="docs-small-button" type="button" data-action="reject-request" data-request-id="${escapeHtml(request.requestId)}">Reject</button></div>
        <div class="docs-request-preview" hidden><div class="docs-admin-row-meta"><span>Markdown submission</span>${(fields.tags || []).map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>${renderMarkdown(fields.content || '', 'docs-request-markdown')}</div>
      </article>`;
    }).join('');
    const documentRows = documents.map((item, index) => `<article class="docs-admin-row">
      <div class="docs-admin-row-main"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary || 'No summary provided.')}</p><div class="docs-admin-row-meta"><span>${escapeHtml(item.category || 'General')}</span><span>By ${escapeHtml(item.authorDisplayName || 'Unknown')}</span><span>Updated ${escapeHtml(formatDate(item.updatedAt || item.createdAt))}</span><span>Order ${index + 1}</span></div></div>
      <div class="docs-admin-row-actions"><div class="docs-order-buttons"><button type="button" data-action="move-doc" data-document-id="${escapeHtml(item.documentId)}" data-delta="-1" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-action="move-doc" data-document-id="${escapeHtml(item.documentId)}" data-delta="1" aria-label="Move down" ${index === documents.length - 1 ? 'disabled' : ''}>↓</button></div><button type="button" class="docs-small-button" data-action="edit-admin-document" data-document-id="${escapeHtml(item.documentId)}">Edit</button><button type="button" class="docs-small-button" data-action="delete-admin-document" data-document-id="${escapeHtml(item.documentId)}">Delete</button></div>
      </article>`).join('');
    $('#admin-view').innerHTML = `
      <header class="docs-page-heading"><div><div class="kicker">EDITORIAL WORKSPACE</div><h2 id="admin-heading">Documents admin</h2><p>Review submissions, maintain published articles, and decide how the knowledge base is organized.</p></div><button class="docs-small-button" type="button" data-action="new-admin-document">＋ New document</button></header>
      <div class="docs-admin-summary"><div class="docs-admin-stat"><span>Published documents</span><strong>${formatNumber(documents.length)}</strong></div><div class="docs-admin-stat"><span>Waiting for review</span><strong>${formatNumber(requests.length)}</strong></div><div class="docs-admin-stat"><span>Topics</span><strong>${formatNumber(categories.size)}</strong></div></div>
      <section class="docs-admin-section docs-admin-review"><div class="docs-admin-section-header"><div><h3>Submissions & suggested edits</h3><p>Approve to publish a new page or replace the existing page with the author's suggested update.</p></div></div><div class="docs-admin-rows">${requestRows || '<div class="docs-inline-empty">The review queue is clear. No submissions are waiting.</div>'}</div></section>
      <section class="docs-admin-section"><div class="docs-admin-section-header"><div><h3>Published documents</h3><p>Use the arrows to change public reading order. Changes are saved automatically.</p></div><button class="docs-small-button" type="button" data-action="refresh-admin">Refresh</button></div><div class="docs-admin-rows">${documentRows || '<div class="docs-inline-empty">No documents have been published yet. Create the first one.</div>'}</div></section>
      <p class="docs-admin-status" id="docs-admin-status">Administrator changes use the same Discord authorization and additional admin verification as Plugin Portal.</p>`;
  }

  async function loadAdminDashboard(enterMode = true) {
    try {
      state.adminData = await api('/api/docs/admin/dashboard');
      state.adminUnlocked = true;
      if (enterMode) setMode('admin');
      renderAdmin();
      return true;
    } catch (error) {
      if (enterMode) setMode('catalogue');
      notify(error.message || 'Could not open Documents administration.', 'error');
      return false;
    }
  }

  async function openAdminPanel() {
    if (!state.user) { login(); return; }
    if (!state.canAccessAdmin) { notify('This Discord account is not an authorized administrator.', 'error'); return; }
    $('#admin-auth-error').hidden = true;
    $('#admin-auth-form').reset();
    openDialog('admin-auth-dialog');
  }

  async function submitAdminAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = $('#admin-auth-error');
    errorBox.hidden = true;
    const submit = $('button[type="submit"]', form);
    const oldText = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Verifying…';
    try {
      state.adminUnlocked = false;
      const data = await api('/api/docs/admin/access', {
        method: 'POST',
        body: { adminAuth: { username: form.elements.username.value.trim(), password: form.elements.password.value } }
      });
      state.adminData = { documents: data.documents || [], requests: data.requests || [] };
      state.adminUnlocked = true;
      closeDialog('admin-auth-dialog');
      setMode('admin');
      renderAdmin();
      notify('Documents administration unlocked.');
    } catch (error) {
      errorBox.textContent = error.message || 'Admin verification failed.';
      errorBox.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = oldText;
    }
  }

  async function reorderDocuments(documentId, delta) {
    const sorted = [...(state.adminData.documents || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.title).localeCompare(String(b.title)));
    const index = sorted.findIndex((item) => item.documentId === documentId);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= sorted.length) return;
    [sorted[index], sorted[next]] = [sorted[next], sorted[index]];
    try {
      await api('/api/docs/admin/reorder', { method: 'PUT', body: { documentIds: sorted.map((item) => item.documentId) } });
      await loadAdminDashboard(false);
      notify('Document order saved.');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function reviewRequest(requestId, approved) {
    const action = approved ? 'approve' : 'reject';
    const prompt = approved ? 'Approve and publish this documentation?' : 'Reject this documentation submission?';
    if (!window.confirm(prompt)) return;
    try {
      const result = await api(`/api/docs/admin/requests/${encodeURIComponent(requestId)}/${action}`, { method: 'POST', body: {} });
      notify(result.message || 'Review action completed.');
      await loadAdminDashboard(false);
      await loadCatalogue();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function deleteAdminDocument(documentId) {
    const item = (state.adminData.documents || []).find((documentItem) => documentItem.documentId === documentId);
    if (!window.confirm(`Delete "${item?.title || 'this document'}" permanently? Its saved favorites and usefulness votes will also be removed.`)) return;
    try {
      const result = await api(`/api/docs/admin/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE', body: {} });
      notify(result.message || 'Document deleted.');
      await loadAdminDashboard(false);
      await loadCatalogue();
      if (state.selectedDocument?.documentId === documentId) navigateCatalogue();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target) return;

    const closeButton = target.closest('[data-close-dialog]');
    if (closeButton) { closeDialog(closeButton.dataset.closeDialog); return; }

    const docLink = target.closest('[data-open-doc]');
    if (docLink) {
      event.preventDefault();
      navigateDocument(docLink.dataset.openDoc);
      return;
    }

    const topicButton = target.closest('[data-topic]');
    if (topicButton) {
      state.selectedCategory = topicButton.dataset.topic || '';
      setMode('catalogue');
      renderCatalogue();
      return;
    }

    const goCatalogue = target.closest('[data-go-catalogue]');
    if (goCatalogue) { event.preventDefault(); navigateCatalogue(); return; }

    const copyCodeButton = target.closest('[data-copy-code]');
    if (copyCodeButton) {
      const code = copyCodeButton.closest('.docs-code-block')?.querySelector('pre code,pre')?.textContent || '';
      await copyText(code, copyCodeButton);
      return;
    }

    if (target.closest('#login-button')) { login(); return; }
    if (target.closest('#submit-doc-button, #sidebar-submit-button')) {
      requireLoginThen(() => openDocForm('submission'));
      return;
    }
    if (target.closest('#library-button')) { await openLibrary(); return; }
    if (target.closest('#admin-button')) { await openAdminPanel(); return; }
    if (target.closest('#logout-button')) {
      try { if (state.accessToken) await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* Local sign-out still clears this browser token. */ }
      state.accessToken = '';
      state.user = null;
      state.canAccessAdmin = false;
      state.adminUnlocked = false;
      saveAccessToken('');
      updateAccountButtons();
      navigateCatalogue();
      await loadCatalogue();
      notify('You have been signed out.');
      return;
    }
    if (target.closest('#clear-search-button, #reset-search-button')) {
      state.query = '';
      state.selectedCategory = '';
      $('#docs-search').value = '';
      setMode('catalogue');
      renderCatalogue();
      return;
    }
    if (target.closest('#retry-docs-button')) { await loadCatalogue(); return; }
    if (target.closest('#toggle-markdown-preview')) {
      state.previewVisible = !state.previewVisible;
      $('#markdown-preview').hidden = !state.previewVisible;
      $('#toggle-markdown-preview').textContent = state.previewVisible ? 'Hide Markdown preview ↑' : 'Preview Markdown ↗';
      if (state.previewVisible) $('#markdown-preview').innerHTML = renderMarkdown($('#doc-form').elements.content.value, 'docs-preview-content');
      return;
    }

    const actionButton = target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    const documentId = actionButton.dataset.documentId;
    if (action === 'favorite-document') { await toggleFavorite(documentId); return; }
    if (action === 'vote-useful') { await voteUseful(documentId, actionButton.dataset.useful === 'true'); return; }
    if (action === 'copy-document-link') { await copyText(`${window.location.origin}${basePath}/?doc=${encodeURIComponent(documentId)}`); return; }
    if (action === 'edit-document') {
      if (state.selectedDocument?.documentId === documentId) requireLoginThen(() => openDocForm('edit', state.selectedDocument));
      return;
    }
    if (action === 'new-admin-document') { openDocForm('admin-create'); return; }
    if (action === 'edit-admin-document') {
      const item = (state.adminData.documents || []).find((documentItem) => documentItem.documentId === documentId);
      if (item) openDocForm('admin-edit', item);
      return;
    }
    if (action === 'delete-admin-document') { await deleteAdminDocument(documentId); return; }
    if (action === 'move-doc') { await reorderDocuments(documentId, Number(actionButton.dataset.delta) || 0); return; }
    if (action === 'refresh-admin') { await loadAdminDashboard(false); notify('Administration refreshed.'); return; }
    if (action === 'approve-request') { await reviewRequest(actionButton.dataset.requestId, true); return; }
    if (action === 'reject-request') { await reviewRequest(actionButton.dataset.requestId, false); return; }
    if (action === 'toggle-request-preview') {
      const row = actionButton.closest('.docs-request-row');
      const preview = $('.docs-request-preview', row);
      if (preview) preview.hidden = !preview.hidden;
      actionButton.textContent = preview && !preview.hidden ? 'Hide preview' : 'Preview';
    }
  });

  $('#docs-search').addEventListener('input', (event) => {
    state.query = event.currentTarget.value;
    if (state.currentMode !== 'catalogue') { history.pushState({}, '', `${basePath}/`); setMode('catalogue'); }
    renderCatalogue();
  });
  $('#admin-auth-form').addEventListener('submit', submitAdminAuth);
  $('#doc-form').addEventListener('submit', submitDocForm);
  $('#doc-form').elements.content.addEventListener('input', () => {
    if (state.previewVisible) $('#markdown-preview').innerHTML = renderMarkdown($('#doc-form').elements.content.value, 'docs-preview-content');
  });
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const documentId = params.get('doc');
    if (documentId && /^\d{20,30}$/.test(documentId)) loadDocument(documentId);
    else { setMode('catalogue'); renderCatalogue(); }
  });

  async function init() {
    $('#year').textContent = String(new Date().getFullYear());
    await exchangeAuthCode();
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get('auth');
    if (authStatus === 'cancelled') notify('Discord sign-in was cancelled.', 'error');
    if (authStatus === 'error') notify('Discord sign-in could not be completed. Please try again.', 'error');
    if (authStatus) {
      params.delete('auth');
      const cleanUrl = new URL(window.location.href);
      cleanUrl.search = params.toString();
      history.replaceState({}, '', cleanUrl.toString());
    }
    await refreshSession();
    await loadCatalogue();
    const documentId = new URLSearchParams(window.location.search).get('doc');
    if (documentId && /^\d{20,30}$/.test(documentId)) await loadDocument(documentId);
  }

  init();
})();
