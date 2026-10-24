/* Optional UI guard for moderator-only limits. The API enforces every permission independently. */
(() => {
  'use strict';

  let adminRole = '';
  let discordUserId = '';
  let adminDashboard = null;
  let applyQueued = false;

  const normalizeId = (value) => String(value || '');
  const getPlugins = () => Array.isArray(adminDashboard?.plugins) ? adminDashboard.plugins : [];
  const getDrafts = () => Array.isArray(adminDashboard?.drafts) ? adminDashboard.drafts : [];
  const pluginById = (id) => getPlugins().find((plugin) => normalizeId(plugin.pluginId) === normalizeId(id));
  const draftById = (id) => getDrafts().find((draft) => normalizeId(draft.draftId) === normalizeId(id));

  function canUseDraft(draft) {
    if (!draft || !discordUserId || normalizeId(draft.createdBy) !== discordUserId) return false;
    if (!draft.pluginId) return true;
    const plugin = pluginById(draft.pluginId);
    return Boolean(plugin && normalizeId(plugin.authorId) === discordUserId);
  }

  function applyRestrictions() {
    applyQueued = false;
    const adminView = document.querySelector('#admin-view');
    if (!adminView || adminRole !== 'moderator') return;

    // Moderators may edit only their own published plugins, and cannot delete published plugins.
    adminView.querySelectorAll('[data-edit-plugin]').forEach((button) => {
      const plugin = pluginById(button.dataset.editPlugin);
      button.hidden = !(plugin && discordUserId && normalizeId(plugin.authorId) === discordUserId);
    });
    adminView.querySelectorAll('[data-delete-plugin]').forEach((button) => { button.hidden = true; });

    // Saved drafts remain available only to the moderator who created them and, if applicable,
    // only when the draft targets one of their own plugins.
    for (const attribute of ['data-edit-draft', 'data-publish-draft', 'data-discard-draft']) {
      adminView.querySelectorAll(`[${attribute}]`).forEach((button) => {
        const draft = draftById(button.getAttribute(attribute));
        button.hidden = !canUseDraft(draft);
      });
    }

    // A moderator must not assign a plugin to someone else by changing the author ID in the form.
    const form = adminView.querySelector('#admin-plugin-form');
    if (form && discordUserId) {
      const authorIdInput = form.elements?.namedItem('authorId');
      if (authorIdInput) {
        authorIdInput.value = discordUserId;
        const authorField = authorIdInput.closest('.admin-author-field');
        if (authorField) authorField.hidden = true;
      }
    }
  }

  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    Promise.resolve().then(applyRestrictions);
  }

  // Capture the role and ownership data already returned by the existing API calls;
  // do not replace or reimplement the site's current portal.js features.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function patchedPortalFetch(input, init) {
    const response = await originalFetch(input, init);
    const url = typeof input === 'string' ? input : (input && typeof input.url === 'string' ? input.url : '');

    if (response.ok && (url.includes('/api/admin/access') || url.includes('/api/admin/dashboard'))) {
      response.clone().json().then((data) => {
        if (data && (data.adminRole === 'moderator' || data.adminRole === 'admin')) adminRole = data.adminRole;
        if (data && (Array.isArray(data.plugins) || Array.isArray(data.drafts))) adminDashboard = data;
        queueApply();
      }).catch(() => {});
    }
    if (response.ok && (url.includes('/api/auth/me') || url.includes('/api/auth/exchange'))) {
      response.clone().json().then((data) => {
        const user = data?.user || data;
        if (user?.discordId) discordUserId = normalizeId(user.discordId);
        queueApply();
      }).catch(() => {});
    }
    return response;
  };

  const adminView = document.querySelector('#admin-view');
  if (adminView && typeof MutationObserver === 'function') {
    new MutationObserver(queueApply).observe(adminView, { childList: true, subtree: true });
  }
  document.addEventListener('visibilitychange', queueApply);
  queueApply();
})();
