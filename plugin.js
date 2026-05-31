// ==Plugin==
// name: Weather & Moon
// description: Journal title weather/moon icons (page date), status bar today readout, frosted forecast popover. Open-Meteo + Plugin Backend settings.
// icon: ti-cloud
// ==/Plugin==

/**
 * Global plugin — Option B layout:
 * - Inline icon cluster left of journal date (weather + moon for that page's date)
 * - Status bar whisper for today (H/L, condition, days to full/new moon)
 * - Click either → upward frosted popover (Dashboard Status Shortcuts pattern)
 */

// @generated BEGIN thymer-plugin-settings (source: plugins/public repo/plugin-settings/ThymerPluginSettingsRuntime.js — run: npm run embed-plugin-settings)
/**
 * ThymerPluginSettings — workspace **Plugin Backend** collection + optional localStorage mirror
 * for global plugins that do not own a collection. (Legacy name **Plugin Settings** is still found until renamed.)
 *
 * Edit this file, then from repo root: npm run embed-plugin-settings
 *
 * Debug: console filter `[ThymerExt/PluginBackend]`. Off by default; to enable:
 *   localStorage.setItem('thymerext_debug_collections', '1'); location.reload();
 *
 * Create dedupe: Web Locks + **per-workspace** localStorage lease/recent-create keys (workspaceGuid from
 * `data.getActiveUsers()[0]`), plus abort if an exact-named Plugin Backend collection already exists.
 *
 * Rows:
 * - **Vault** (`record_kind` = `vault`): one per `plugin_id` — holds synced localStorage payload JSON.
 * - **Other rows** (`record_kind` = `log`, `config`, …): same **Plugin** field (`plugin`) for filtering;
 *   use a **distinct** `plugin_id` per row (e.g. `habit-tracker:log:2026-04-24`) so vault lookup stays unambiguous.
 *
 * API: ThymerPluginSettings.init({ plugin, pluginId, modeKey, mirrorKeys, label, data, ui })
 *      ThymerPluginSettings.scheduleFlush(plugin, mirrorKeys)
 *      ThymerPluginSettings.flushNow(data, pluginId, mirrorKeys)
 *      ThymerPluginSettings.openStorageDialog({ plugin, pluginId, modeKey, mirrorKeys, label, data, ui })
 *      ThymerPluginSettings.listRows(data, { pluginSlug, recordKind? })
 *      ThymerPluginSettings.createDataRow(data, { pluginSlug, recordKind, rowPluginId, recordTitle?, settingsDoc? })
 *      ThymerPluginSettings.upgradeCollectionSchema(data) — merge missing `plugin` / `record_kind` fields into existing collection
 *      ThymerPluginSettings.registerPluginSlug(data, { slug, label? }) — ensure `plugin` choice includes this slug (call once per plugin)
 */
(function pluginSettingsRuntime(g) {
  if (g.ThymerPluginSettings) return;

  const COL_NAME = 'Plugin Backend';
  const COL_NAME_LEGACY = 'Plugin Settings';
  const KIND_VAULT = 'vault';
  const FIELD_PLUGIN = 'plugin';
  const FIELD_KIND = 'record_kind';
  const q = [];
  let busy = false;

  /**
   * Collection ensure diagnostics (read browser console for `[ThymerExt/PluginBackend]`.
   * Opt-in: `localStorage.setItem('thymerext_debug_collections','1')` then reload.
   * Opt-out: remove the key or set to `0` / `off` / `false`.
   */
  const DEBUG_COLLECTIONS = (() => {
    try {
      const o = localStorage.getItem('thymerext_debug_collections');
      if (o === '0' || o === 'off' || o === 'false') return false;
      return o === '1' || o === 'true' || o === 'on';
    } catch (_) {}
    return false;
  })();
  const DEBUG_PATHB_ID =
    'pb-' + (Date.now() & 0xffffffff).toString(16) + '-' + Math.random().toString(36).slice(2, 7);

  /** In-flight dedupe: parallel plugin `init()` calls share one `getAllCollections()` snapshot. */
  const DATA_GET_ALL_P = '__thymerExtGetAllCollectionsInflight';

  function preferDeferredHeavyWork() {
    try {
      if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
    } catch (_) {}
    try {
      return Number(navigator?.maxTouchPoints) > 0;
    } catch (_) {}
    return false;
  }

  const MOBILE_GRACE_UNTIL_KEY = '__thymerExtMobileGraceUntil';
  const MOBILE_HIDDEN_AT_KEY = '__thymerExtMobileHiddenAt';
  const MOBILE_INTERACT_THROTTLE_AT_KEY = '__thymerExtMobileInteractThrottleAt';
  /** Pause footer scans / Path B until host sidebar is up — keep short so navigation is not blocked for ~2 min. */
  const MOBILE_GRACE_MS = 45000;
  const MOBILE_RESUME_GRACE_MS = 35000;
  const MOBILE_RESUME_AWAY_MS = 15000;
  /** Interaction only pauses the heavy-work queue briefly — do not extend MOBILE_GRACE (that delayed page change until ~2 min). */
  const MOBILE_HEAVY_PAUSE_ON_INTERACT_MS = 10000;
  const MOBILE_INTERACTION_THROTTLE_MS = 2500;
  const HEAVY_QUEUE_PAUSED_UNTIL_KEY = '__thymerExtHeavyQueuePausedUntil';

  // Heavy work scheduler: many plugins "wake up" together after mobile grace ends.
  // Running them concurrently causes long-task storms that block navigation.
  const HEAVY_Q_KEY = '__thymerExtHeavyWorkQueue';
  const HEAVY_BUSY_KEY = '__thymerExtHeavyWorkBusy';

  function ensureMobileLoadGraceStarted(extraMs) {
    if (!preferDeferredHeavyWork()) return;
    const until = Date.now() + (extraMs > 0 ? extraMs : MOBILE_GRACE_MS);
    try {
      if (!g[MOBILE_GRACE_UNTIL_KEY] || g[MOBILE_GRACE_UNTIL_KEY] < until) {
        g[MOBILE_GRACE_UNTIL_KEY] = until;
      }
    } catch (_) {}
  }

  function inMobileLoadGrace() {
    if (!preferDeferredHeavyWork()) return false;
    try {
      return Date.now() < (g[MOBILE_GRACE_UNTIL_KEY] || 0);
    } catch (_) {
      return false;
    }
  }

  function bumpMobileLoadGrace(ms) {
    if (!preferDeferredHeavyWork()) return;
    const until = Date.now() + (ms > 0 ? ms : MOBILE_RESUME_GRACE_MS);
    try {
      if (!g[MOBILE_GRACE_UNTIL_KEY] || g[MOBILE_GRACE_UNTIL_KEY] < until) {
        g[MOBILE_GRACE_UNTIL_KEY] = until;
      }
    } catch (_) {}
  }

  function installMobileResumeGraceListener() {
    if (g.__thymerExtMobileGraceListenerInstalled) return;
    g.__thymerExtMobileGraceListenerInstalled = true;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    document.addEventListener(
      'visibilitychange',
      () => {
        try {
          if (document.visibilityState === 'hidden') {
            g[MOBILE_HIDDEN_AT_KEY] = Date.now();
          } else if (document.visibilityState === 'visible') {
            const hiddenAt = g[MOBILE_HIDDEN_AT_KEY] || 0;
            const away = hiddenAt ? Date.now() - hiddenAt : 0;
            if (away >= MOBILE_RESUME_AWAY_MS) bumpMobileLoadGrace(MOBILE_RESUME_GRACE_MS);
          }
        } catch (_) {}
      },
      { passive: true }
    );
  }

  function pauseHeavyWorkQueue(ms) {
    if (!preferDeferredHeavyWork()) return;
    const until = Date.now() + (ms > 0 ? ms : MOBILE_HEAVY_PAUSE_ON_INTERACT_MS);
    try {
      if (!g[HEAVY_QUEUE_PAUSED_UNTIL_KEY] || g[HEAVY_QUEUE_PAUSED_UNTIL_KEY] < until) {
        g[HEAVY_QUEUE_PAUSED_UNTIL_KEY] = until;
      }
    } catch (_) {}
  }

  function isHeavyWorkQueuePaused() {
    try {
      return Date.now() < (g[HEAVY_QUEUE_PAUSED_UNTIL_KEY] || 0);
    } catch (_) {
      return false;
    }
  }

  /** True during startup window: skip footer mount / panel scans so page navigation stays responsive. */
  function shouldDeferPanelFooterWork() {
    return inMobileLoadGrace();
  }

  function installMobileInteractionGraceListener() {
    if (g.__thymerExtMobileInteractGraceInstalled) return;
    g.__thymerExtMobileInteractGraceInstalled = true;
    if (!preferDeferredHeavyWork()) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

    const onInteract = () => {
      try {
        const now = Date.now();
        const prev = g[MOBILE_INTERACT_THROTTLE_AT_KEY] || 0;
        if (now - prev < MOBILE_INTERACTION_THROTTLE_MS) return;
        g[MOBILE_INTERACT_THROTTLE_AT_KEY] = now;
        pauseHeavyWorkQueue(MOBILE_HEAVY_PAUSE_ON_INTERACT_MS);
      } catch (_) {}
    };

    for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
      try {
        document.addEventListener(ev, onInteract, { passive: true, capture: true });
      } catch (_) {}
    }
  }

  async function yieldToHostOneTick() {
    await new Promise((r) => {
      try {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      } catch (_) {
        setTimeout(r, 0);
      }
    });
  }

  async function runNextHeavyWork() {
    if (g[HEAVY_BUSY_KEY]) return;
    const q = g[HEAVY_Q_KEY];
    if (!Array.isArray(q) || q.length === 0) return;
    g[HEAVY_BUSY_KEY] = true;
    try {
      while (Array.isArray(g[HEAVY_Q_KEY]) && g[HEAVY_Q_KEY].length) {
        if (inMobileLoadGrace() || isHeavyWorkQueuePaused()) break;
        const job = g[HEAVY_Q_KEY].shift();
        if (!job || typeof job.run !== 'function') continue;
        try {
          await yieldToHostOneTick();
        } catch (_) {}
        // Prefer running during idle; fallback is still serialized.
        try {
          if (typeof requestIdleCallback === 'function') {
            await new Promise((resolve) => requestIdleCallback(resolve, { timeout: 1200 }));
          }
        } catch (_) {}
        try {
          await job.run();
        } catch (_) {}
        // Yield after each heavy job so navigation events can be processed.
        try {
          await yieldToHostOneTick();
        } catch (_) {}
      }
    } finally {
      g[HEAVY_BUSY_KEY] = false;
      // If we stopped due to grace, try again later.
      if (Array.isArray(g[HEAVY_Q_KEY]) && g[HEAVY_Q_KEY].length) {
        setTimeout(() => runNextHeavyWork(), 1500);
      }
    }
  }

  function enqueueHeavyWork(run, opts) {
    if (typeof run !== 'function') return;
    if (!g[HEAVY_Q_KEY]) g[HEAVY_Q_KEY] = [];
    const delayMs = Math.max(0, Number(opts?.delayMs) || 0);
    const push = () => {
      try {
        g[HEAVY_Q_KEY].push({ run });
      } catch (_) {}
      setTimeout(() => runNextHeavyWork(), 0);
    };
    if (delayMs > 0) setTimeout(push, delayMs);
    else push();
  }

  async function yieldToHostBeforePathB() {
    await new Promise((r) => {
      try {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      } catch (_) {
        r();
      }
    });
    await new Promise((resolve) => {
      try {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(() => resolve(), {
            timeout: preferDeferredHeavyWork() ? 8000 : 1500,
          });
        } else {
          setTimeout(resolve, preferDeferredHeavyWork() ? 48 : 16);
        }
      } catch (_) {
        setTimeout(resolve, 32);
      }
    });
  }

  async function getAllCollectionsDeduped(data) {
    if (!data || typeof data.getAllCollections !== 'function') return [];
    const inflight = data[DATA_GET_ALL_P];
    if (inflight && typeof inflight.then === 'function') {
      try {
        return await inflight;
      } catch (_) {
        // fall through to fresh fetch
      }
    }
    const p = Promise.resolve()
      .then(() => data.getAllCollections())
      .then((all) => (Array.isArray(all) ? all : []))
      .finally(() => {
        try {
          if (data[DATA_GET_ALL_P] === p) delete data[DATA_GET_ALL_P];
        } catch (_) {}
      });
    data[DATA_GET_ALL_P] = p;
    return p;
  }

  /** If true, Thymer ignores programmatic field updates — force off on every schema save. */
  const MANAGED_UNLOCK = { fields: false, views: false, sidebar: false };

  /**
   * Ensure Plugin Backend collection without duplicate `createCollection` calls.
   * Sibling **plugin iframes** are often not `window` siblings — walking `parent` can stop at
   * each plugin’s *own* frame, so a promise on “hierarchy best” is **not** one shared object.
   * **`window.top` is the same** for all same-tab iframes and, when not cross-origin, is the
   * one place to attach a cross-iframe lock. Fallback: walk the parent chain for opaque frames.
   */
  function getSharedDeduplicationWindow() {
    try {
      if (typeof window === 'undefined') return g;
      const t = window.top;
      if (t) {
        void t.document;
        return t;
      }
    } catch (_) {
      /* cross-origin top */
    }
    try {
      let w = typeof window !== 'undefined' ? window : null;
      let best = w || g;
      while (w) {
        try {
          void w.document;
          best = w;
        } catch (_) {
          break;
        }
        if (w === w.top) break;
        w = w.parent;
      }
      return best;
    } catch (_) {
      return typeof window !== 'undefined' ? window : g;
    }
  }

  const PB_ENSURE_GLOBAL_P = '__thymerPluginBackendEnsureGlobalP';
  const SERIAL_DATA_CREATE_P = '__thymerExtSerializedDataCreateP_v1';
  /** `getAllCollections` can briefly return [] (host UI / race) after a valid non-empty read — refuse create in that window. */
  const GETALL_COLLECTIONS_SANITY = '__thymerExtGetAllCollectionsSanityV1';
  function touchGetAllSanityFromCount(len) {
    const n = Number(len) || 0;
    const h = getSharedDeduplicationWindow();
    if (!h[GETALL_COLLECTIONS_SANITY]) h[GETALL_COLLECTIONS_SANITY] = { nLast: 0, tLast: 0 };
    const s = h[GETALL_COLLECTIONS_SANITY];
    if (n > 0) {
      s.nLast = n;
      s.tLast = Date.now();
    }
  }
  function isSuspiciousEmptyAfterRecentNonEmptyList(currentLen) {
    const c = Number(currentLen) || 0;
    if (c > 0) {
      touchGetAllSanityFromCount(c);
      return false;
    }
    const h = getSharedDeduplicationWindow();
    const s = h[GETALL_COLLECTIONS_SANITY];
    if (!s || s.nLast <= 0 || !s.tLast) return false;
    return Date.now() - s.tLast < 60_000;
  }

  function chainPluginBackendEnsure(data, work) {
    const root = getSharedDeduplicationWindow();
    try {
      if (!root[PB_ENSURE_GLOBAL_P]) root[PB_ENSURE_GLOBAL_P] = Promise.resolve();
    } catch (_) {
      return Promise.resolve().then(work);
    }
    root[PB_ENSURE_GLOBAL_P] = root[PB_ENSURE_GLOBAL_P].catch(() => {}).then(work);
    return root[PB_ENSURE_GLOBAL_P];
  }

  function withUnlockedManaged(base) {
    return { ...(base && typeof base === 'object' ? base : {}), managed: MANAGED_UNLOCK };
  }

  /** Index of the “Plugin” column (`id` **plugin**, or legacy label match). */
  function findPluginColumnFieldIndex(fields) {
    const arr = Array.isArray(fields) ? fields : [];
    let i = arr.findIndex((f) => f && f.id === FIELD_PLUGIN);
    if (i >= 0) return i;
    i = arr.findIndex(
      (f) =>
        f &&
        String(f.label || '')
          .trim()
          .toLowerCase() === 'plugin' &&
        (f.type === 'text' || f.type === 'plaintext' || f.type === 'string')
    );
    return i;
  }

  /** Keep internal column identity when replacing field shape (text → choice). */
  function copyStableFieldKeys(prev, next) {
    if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return;
    for (const k of ['guid', 'colguid', 'colGuid', 'field_guid']) {
      if (prev[k] != null && next[k] == null) next[k] = prev[k];
    }
  }

  function getPluginFieldDef(coll) {
    if (!coll || typeof coll.getConfiguration !== 'function') return null;
    try {
      const fields = coll.getConfiguration()?.fields || [];
      const i = findPluginColumnFieldIndex(fields);
      return i >= 0 ? fields[i] : null;
    } catch (_) {
      return null;
    }
  }

  function pluginColumnPropId(coll, requestedId) {
    if (requestedId !== FIELD_PLUGIN || !coll) return requestedId;
    const f = getPluginFieldDef(coll);
    return (f && f.id) || FIELD_PLUGIN;
  }

  function cloneFieldDef(f) {
    if (!f || typeof f !== 'object') return f;
    try {
      return structuredClone(f);
    } catch (_) {
      try {
        return JSON.parse(JSON.stringify(f));
      } catch (__) {
        return { ...f };
      }
    }
  }

  const PLUGIN_SETTINGS_SHAPE = {
    ver: 1,
    name: COL_NAME,
    icon: 'ti-adjustments',
    color: null,
    home: false,
    page_field_ids: [FIELD_PLUGIN, FIELD_KIND, 'plugin_id', 'created_at', 'updated_at', 'settings_json'],
    item_name: 'Setting, Config, or Log',
    description: 'Workspace storage for plugins: Use the Plugin column to filter by plugin.',
    show_sidebar_items: true,
    show_cmdpal_items: false,
    fields: [
      {
        icon: 'ti-apps',
        id: FIELD_PLUGIN,
        label: 'Plugin',
        type: 'choice',
        read_only: false,
        active: true,
        many: false,
        choices: [
          { id: 'quick-notes', label: 'quick-notes', color: '0', active: true },
          { id: 'habit-tracker', label: 'Habit Tracker', color: '0', active: true },
          { id: 'ynab', label: 'ynab', color: '0', active: true },
        ],
      },
      {
        icon: 'ti-category',
        id: FIELD_KIND,
        label: 'Record kind',
        type: 'text',
        read_only: false,
        active: true,
        many: false,
      },
      {
        icon: 'ti-id',
        id: 'plugin_id',
        label: 'Plugin ID',
        type: 'text',
        read_only: false,
        active: true,
        many: false,
      },
      {
        icon: 'ti-clock-plus',
        id: 'created_at',
        label: 'Created',
        many: false,
        read_only: true,
        active: true,
        type: 'datetime',
      },
      {
        icon: 'ti-clock-edit',
        id: 'updated_at',
        label: 'Modified',
        many: false,
        read_only: true,
        active: true,
        type: 'datetime',
      },
      {
        icon: 'ti-code',
        id: 'settings_json',
        label: 'Settings JSON',
        type: 'text',
        read_only: false,
        active: true,
        many: false,
      },
      {
        icon: 'ti-abc',
        id: 'title',
        label: 'Title',
        many: false,
        read_only: false,
        active: true,
        type: 'text',
      },
      {
        icon: 'ti-photo',
        id: 'banner',
        label: 'Banner',
        many: false,
        read_only: false,
        active: true,
        type: 'banner',
      },
      {
        icon: 'ti-align-left',
        id: 'icon',
        label: 'Icon',
        many: false,
        read_only: false,
        active: true,
        type: 'text',
      },
    ],
    sidebar_record_sort_dir: 'desc',
    sidebar_record_sort_field_id: 'updated_at',
    managed: { fields: false, views: false, sidebar: false },
    custom: {},
    views: [
      {
        id: 'V0YBPGDDZ0MHRSQ',
        shown: true,
        icon: 'ti-table',
        label: 'All',
        description: '',
        field_ids: ['title', FIELD_PLUGIN, FIELD_KIND, 'plugin_id', 'created_at', 'updated_at'],
        type: 'table',
        read_only: false,
        group_by_field_id: null,
        sort_dir: 'desc',
        sort_field_id: 'updated_at',
        opts: {},
      },
      {
        id: 'VPGAWVGVKZD57C9',
        shown: true,
        icon: 'ti-layout-kanban',
        label: 'By Plugin...',
        description: '',
        field_ids: ['title', FIELD_KIND, 'created_at', 'updated_at'],
        type: 'board',
        read_only: false,
        group_by_field_id: FIELD_PLUGIN,
        sort_dir: 'desc',
        sort_field_id: 'updated_at',
        opts: {},
      },
    ],
  };

  function cloneShape() {
    try {
      return structuredClone(PLUGIN_SETTINGS_SHAPE);
    } catch (_) {
      return JSON.parse(JSON.stringify(PLUGIN_SETTINGS_SHAPE));
    }
  }

  /** Append default views from the canonical shape when the workspace collection is missing them (by view `id`). */
  function mergeViewsArray(baseViews, desiredViews) {
    const desired = Array.isArray(desiredViews) ? desiredViews.map((v) => cloneFieldDef(v)) : [];
    const cur = Array.isArray(baseViews) ? baseViews.map((v) => cloneFieldDef(v)) : [];
    if (cur.length === 0) {
      return { views: desired, changed: desired.length > 0 };
    }
    const ids = new Set(cur.map((v) => v && v.id).filter(Boolean));
    let changed = false;
    for (const v of desired) {
      if (v && v.id && !ids.has(v.id)) {
        cur.push(cloneFieldDef(v));
        ids.add(v.id);
        changed = true;
      }
    }
    return { views: cur, changed };
  }

  /** Slug before first colon, else whole id (e.g. `habit-tracker:log:2026-04-24` → `habit-tracker`). */
  function inferPluginSlugFromPid(pid) {
    if (!pid) return '';
    const s = String(pid).trim();
    const i = s.indexOf(':');
    if (i <= 0) return s;
    return s.slice(0, i);
  }

  function inferRecordKindFromPid(pid, slug) {
    if (!pid || !slug) return '';
    const p = String(pid);
    if (p === slug) return KIND_VAULT;
    if (p === `${slug}:config`) return 'config';
    if (p.startsWith(`${slug}:log:`)) return 'log';
    return '';
  }

  function colorForSlug(slug) {
    const colors = ['0', '1', '2', '3', '4', '5', '6', '7'];
    let h = 0;
    const s = String(slug || '');
    for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) % colors.length;
    return colors[h];
  }

  /** Normalize Thymer choice option (object or legacy string). */
  function normalizeChoiceOption(c) {
    if (c == null) return null;
    if (typeof c === 'string') {
      const s = c.trim();
      if (!s) return null;
      return { id: s, label: s, color: colorForSlug(s), active: true };
    }
    const id = String(c.id ?? c.label ?? '')
      .trim();
    if (!id) return null;
    return {
      id,
      label: String(c.label ?? id).trim() || id,
      color: String(c.color != null ? c.color : colorForSlug(id)),
      active: c.active !== false,
    };
  }

  /**
   * Fresh choice field object (no legacy keys). Thymer often ignores `type` changes when merging
   * onto an existing text field’s full config — same pattern as markdown importer choice fields.
   */
  function cleanPluginChoiceField(prev, desiredPlugin, choicesList) {
    const fieldId = (prev && prev.id) || FIELD_PLUGIN;
    const next = {
      id: fieldId,
      label: (prev && prev.label) || desiredPlugin.label || 'Plugin',
      icon: (prev && prev.icon) || desiredPlugin.icon || 'ti-apps',
      type: 'choice',
      many: false,
      read_only: false,
      active: prev ? prev.active !== false : true,
      choices: Array.isArray(choicesList) ? choicesList : [],
    };
    copyStableFieldKeys(prev, next);
    return next;
  }

  /**
   * Ensure the `plugin` field is a choice field and its options cover every slug
   * already present on rows (migrates legacy `type: 'text'` definitions).
   */
  async function reconcilePluginFieldAsChoice(coll, curFields, desired) {
    const desiredPlugin = desired.fields.find((f) => f && f.id === FIELD_PLUGIN);
    if (!desiredPlugin) return { fields: curFields, changed: false };

    const idx = findPluginColumnFieldIndex(curFields);
    const prev = idx >= 0 ? curFields[idx] : null;

    const choices = [];
    const seen = new Set();
    const pushOpt = (opt) => {
      const n = normalizeChoiceOption(opt);
      if (!n || seen.has(n.id)) return;
      seen.add(n.id);
      choices.push(n);
    };

    if (prev && prev.type === 'choice' && Array.isArray(prev.choices)) {
      for (const c of prev.choices) pushOpt(c);
    }

    let records = [];
    try {
      records = await coll.getAllRecords();
    } catch (_) {}

    const plugCol = pluginColumnPropId(coll, FIELD_PLUGIN);
    const slugSet = new Set();
    for (const r of records) {
      const a = rowField(r, plugCol);
      if (a) slugSet.add(a.trim());
      const inf = inferPluginSlugFromPid(rowField(r, 'plugin_id'));
      if (inf) slugSet.add(inf);
    }
    for (const slug of [...slugSet].sort()) {
      if (!slug) continue;
      pushOpt({ id: slug, label: slug, color: colorForSlug(slug), active: true });
    }

    const useClean = !prev || prev.type !== 'choice';
    const nextPluginField = useClean
      ? cleanPluginChoiceField(prev, desiredPlugin, choices)
      : (() => {
          const merged = {
            ...desiredPlugin,
            type: 'choice',
            choices,
            icon: (prev && prev.icon) || desiredPlugin.icon,
            label: (prev && prev.label) || desiredPlugin.label,
            id: (prev && prev.id) || desiredPlugin.id || FIELD_PLUGIN,
          };
          copyStableFieldKeys(prev, merged);
          return merged;
        })();

    let changed = false;
    if (idx < 0) {
      curFields.push(nextPluginField);
      changed = true;
    } else if (JSON.stringify(prev) !== JSON.stringify(nextPluginField)) {
      curFields[idx] = nextPluginField;
      changed = true;
    }

    return { fields: curFields, changed };
  }

  async function registerPluginSlug(data, { slug, label } = {}) {
    const id = (slug || '').trim();
    if (!id || !data) return;
    await ensurePluginSettingsCollection(data);
    const coll = await findColl(data);
    if (!coll || typeof coll.getConfiguration !== 'function' || typeof coll.saveConfiguration !== 'function') return;
    await upgradePluginSettingsSchema(data, coll);
    let slugRegisterSavedOk = false;
    try {
      const base = coll.getConfiguration() || {};
      const fields = Array.isArray(base.fields) ? [...base.fields] : [];
      const idx = findPluginColumnFieldIndex(fields);
      if (idx < 0) {
        await rewritePluginChoiceCells(coll);
        return;
      }
      const prev = fields[idx];
      if (prev.type !== 'choice') {
        await rewritePluginChoiceCells(coll);
        return;
      }
      const prevChoices = Array.isArray(prev.choices) ? prev.choices : [];
      const normalized = prevChoices.map((c) => normalizeChoiceOption(c)).filter(Boolean);
      const byId = new Map(normalized.map((c) => [c.id, c]));
      const existing = byId.get(id);
      if (existing) {
        if (label && String(existing.label) !== String(label)) {
          byId.set(id, { ...existing, label: String(label) });
        } else {
          await rewritePluginChoiceCells(coll);
          return;
        }
      } else {
        byId.set(id, { id, label: label || id, color: colorForSlug(id), active: true });
      }
      const prevOrder = normalized.map((c) => c.id);
      const out = [];
      const used = new Set();
      for (const pid of prevOrder) {
        if (byId.has(pid) && !used.has(pid)) {
          out.push(byId.get(pid));
          used.add(pid);
        }
      }
      for (const [pid, opt] of byId) {
        if (!used.has(pid)) {
          out.push(opt);
          used.add(pid);
        }
      }
      const next = { ...prev, type: 'choice', choices: out };
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        fields[idx] = next;
        const ok = await coll.saveConfiguration(withUnlockedManaged({ ...base, fields }));
        if (ok === false) console.warn('[ThymerPluginSettings] registerPluginSlug: saveConfiguration returned false');
        else slugRegisterSavedOk = true;
      }
    } catch (e) {
      console.error('[ThymerPluginSettings] registerPluginSlug', e);
    }
    if (slugRegisterSavedOk) await rewritePluginChoiceCells(coll);
  }

  /**
   * Merge missing field definitions into the Plugin Backend collection
   * (e.g. after Thymer auto-created a minimal schema, or older two-field configs).
   */
  async function upgradePluginSettingsSchema(data, collOpt) {
    await ensurePluginSettingsCollection(data);
    const coll = collOpt || (await findColl(data));
    if (!coll || typeof coll.getConfiguration !== 'function' || typeof coll.saveConfiguration !== 'function') return;
    try {
      let base = coll.getConfiguration() || {};
      try {
        if (typeof coll.getExistingCodeAndConfig === 'function') {
          const pack = coll.getExistingCodeAndConfig();
          if (pack && pack.json && typeof pack.json === 'object') {
            base = { ...base, ...pack.json };
          }
        }
      } catch (_) {}
      const desired = cloneShape();
      const curFields = Array.isArray(base.fields) ? base.fields.map((f) => cloneFieldDef(f)) : [];
      const curIds = new Set(curFields.map((f) => (f && f.id ? f.id : null)).filter(Boolean));
      let changed = false;
      for (const f of desired.fields) {
        if (!f || !f.id || curIds.has(f.id)) continue;
        if (f.id === FIELD_PLUGIN && findPluginColumnFieldIndex(curFields) >= 0) continue;
        curFields.push(cloneFieldDef(f));
        curIds.add(f.id);
        changed = true;
      }
      const rec = await reconcilePluginFieldAsChoice(coll, curFields, desired);
      if (rec.changed) changed = true;
      const finalFields = rec.fields;

      const vMerge = mergeViewsArray(base.views, desired.views);
      if (vMerge.changed) changed = true;
      const finalViews = vMerge.views;

      const curPages = [...(base.page_field_ids || [])];
      const wantPages = [...(desired.page_field_ids || [])];
      const mergedPages = [...new Set([...wantPages, ...curPages])];
      if (JSON.stringify(curPages) !== JSON.stringify(mergedPages)) changed = true;
      if ((base.description || '') !== desired.description) changed = true;
      if ((base.item_name || '') !== (desired.item_name || '')) changed = true;
      if (String(base.name || '').trim() !== COL_NAME) changed = true;
      if (changed) {
        const merged = withUnlockedManaged({
          ...base,
          name: COL_NAME,
          description: desired.description,
          fields: finalFields,
          page_field_ids: mergedPages.length ? mergedPages : wantPages,
          item_name: desired.item_name || base.item_name,
          icon: desired.icon || base.icon,
          color: desired.color !== undefined ? desired.color : base.color,
          home: desired.home !== undefined ? desired.home : base.home,
          views: finalViews,
          sidebar_record_sort_field_id: desired.sidebar_record_sort_field_id || base.sidebar_record_sort_field_id,
          sidebar_record_sort_dir: desired.sidebar_record_sort_dir || base.sidebar_record_sort_dir,
        });
        const ok = await coll.saveConfiguration(merged);
        if (ok === false) console.warn('[ThymerPluginSettings] saveConfiguration returned false (schema not applied?)');
        else {
          try {
            const pf = getPluginFieldDef(coll);
            if (pf && pf.type !== 'choice') {
              console.error(
                '[ThymerPluginSettings] saveConfiguration succeeded but "plugin" field is still type',
                pf.type,
                '— check collection General tab or re-import plugins/public repo/plugin-settings/Plugin Backend.json.'
              );
            }
          } catch (_) {}
        }
      }
      if (changed) await rewritePluginChoiceCells(coll);
    } catch (e) {
      console.error('[ThymerPluginSettings] upgrade schema', e);
    }
  }

  /** Re-apply `plugin` via setChoice so rows are not stuck as “(Other)” after text→choice migration. */
  async function rewritePluginChoiceCells(coll) {
    if (!coll || typeof coll.getAllRecords !== 'function') return;
    try {
      const pluginField = getPluginFieldDef(coll);
      if (!pluginField || pluginField.type !== 'choice') return;
    } catch (_) {
      return;
    }
    let records = [];
    try {
      records = await coll.getAllRecords();
    } catch (_) {
      return;
    }
    for (const r of records) {
      let slug = inferPluginSlugFromPid(rowField(r, 'plugin_id'));
      if (!slug) slug = rowField(r, pluginColumnPropId(coll, FIELD_PLUGIN));
      if (!slug) continue;
      setRowField(r, FIELD_PLUGIN, slug, coll);
      // Rows written while setRowField wrongly skipped p.set() for plugin_id (setChoice branch).
      const pidNow = rowField(r, 'plugin_id').trim();
      if (!pidNow) {
        const kind = (rowField(r, FIELD_KIND) || '').trim();
        let legacyVault = false;
        if (!kind) {
          try {
            const raw = rowField(r, 'settings_json');
            if (raw && String(raw).includes('"storageMode"')) legacyVault = true;
          } catch (_) {}
        }
        if (kind === KIND_VAULT || legacyVault) {
          setRowField(r, 'plugin_id', slug, coll);
        } else if (kind === 'config') {
          setRowField(r, 'plugin_id', `${slug}:config`, coll);
        } else if (kind === 'log') {
          let ds = '';
          try {
            const raw = rowField(r, 'settings_json');
            if (raw) {
              const j = JSON.parse(raw);
              if (j && j.date) ds = String(j.date).trim();
            }
          } catch (_) {}
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ds) && typeof r.getName === 'function') {
            ds = String(r.getName() || '').trim();
          }
          if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
            setRowField(r, 'plugin_id', `${slug}:log:${ds}`, coll);
          }
        }
      }
    }
  }

  function rowField(r, id) {
    if (!r) return '';
    try {
      const p = r.prop?.(id);
      if (p && typeof p.choice === 'function') {
        const c = p.choice();
        if (c != null && String(c).trim() !== '') return String(c).trim();
      }
    } catch (_) {}
    let v = '';
    try {
      v = r.text?.(id);
    } catch (_) {}
    if (v != null && String(v).trim() !== '') return String(v).trim();
    try {
      const p = r.prop?.(id);
      if (p && typeof p.get === 'function') {
        const g = p.get();
        return g == null ? '' : String(g).trim();
      }
      if (p && typeof p.text === 'function') {
        const t = p.text();
        return t == null ? '' : String(t).trim();
      }
    } catch (_) {}
    return '';
  }

  /** Thymer `setChoice` matches option **label** (see YNAB plugins); return label for slug `id`, else slug. */
  function pluginChoiceSetName(coll, slug) {
    const s = String(slug || '').trim();
    if (!s || !coll || typeof coll.getConfiguration !== 'function') return s;
    try {
      const f = getPluginFieldDef(coll);
      if (!f || f.type !== 'choice' || !Array.isArray(f.choices)) return s;
      const opt = f.choices.find((c) => c && String(c.id || '').trim() === s);
      if (opt && opt.label != null && String(opt.label).trim() !== '') return String(opt.label).trim();
    } catch (_) {}
    return s;
  }

  /**
   * @param coll Optional collection — pass when writing `plugin` so setChoice uses the correct option **label**.
   */
  function setRowField(r, id, value, coll = null) {
    if (!r) return;
    const raw = value == null ? '' : String(value);
    const s = raw.trim();
    const propId = pluginColumnPropId(coll, id);
    try {
      const p = r.prop?.(propId);
      if (!p) return;
      // Thymer exposes setChoice on many property types; it returns false for non-choice fields.
      // Only use setChoice for the Plugin **slug** column — otherwise we return early and never p.set().
      const isPluginChoiceCol = id === FIELD_PLUGIN;
      if (isPluginChoiceCol && typeof p.setChoice === 'function') {
        if (!s) {
          if (typeof p.set === 'function') p.set('');
          return;
        }
        const nameTry = coll != null ? pluginChoiceSetName(coll, s) : s;
        if (p.setChoice(nameTry)) return;
        if (nameTry !== s && p.setChoice(s)) return;
        if (typeof p.set === 'function') {
          try {
            p.set(s);
            return;
          } catch (_) {
            /* continue to warn */
          }
        }
        console.warn('[ThymerPluginSettings] setChoice: no option matched field', id, 'slug', s, 'tried', nameTry);
        return;
      }
      if (typeof p.set === 'function') p.set(raw);
    } catch (e) {
      console.warn('[ThymerPluginSettings] setRowField', id, e);
    }
  }

  /** True for the single mirror row per logical plugin (plugin_id === pluginId and kind vault or legacy). */
  function isVaultRow(r, pluginId) {
    const pid = rowField(r, 'plugin_id');
    if (pid !== pluginId) return false;
    const kind = rowField(r, FIELD_KIND);
    if (kind === KIND_VAULT) return true;
    if (!kind) return true;
    return false;
  }

  /** Parse ISO-ish timestamps for vault row scoring (duplicates: pick freshest, not first in list). */
  function parseVaultIsoMs(s) {
    const n = Date.parse(String(s || ''));
    return Number.isFinite(n) ? n : 0;
  }

  function vaultRowFreshnessScore(r) {
    let score = 0;
    let raw = '';
    try {
      raw = rowField(r, 'settings_json');
    } catch (_) {}
    if (raw && String(raw).trim()) {
      try {
        const j = JSON.parse(raw);
        if (j && typeof j.updatedAt === 'string') {
          const ms = parseVaultIsoMs(j.updatedAt);
          if (ms > score) score = ms;
        }
      } catch (_) {}
    }
    try {
      const ua = rowField(r, 'updated_at');
      if (ua) {
        const ms = parseVaultIsoMs(ua);
        if (ms > score) score = ms;
      }
    } catch (_) {}
    return score;
  }

  function settingsJsonPayloadLen(r) {
    try {
      return String(rowField(r, 'settings_json') || '').length;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Prefer the **newest** vault row when duplicates exist (same `plugin_id`, multiple vault-shaped rows).
   * Previously the first list match could be stale while a newer row held the real payload.
   */
  function findVaultRecord(records, pluginId) {
    if (!records) return null;
    let best = null;
    let bestScore = -1;
    for (const x of records) {
      if (!isVaultRow(x, pluginId)) continue;
      const sc = vaultRowFreshnessScore(x);
      if (sc > bestScore) {
        bestScore = sc;
        best = x;
      } else if (sc === bestScore && best) {
        const lenX = settingsJsonPayloadLen(x);
        const lenB = settingsJsonPayloadLen(best);
        if (lenX > lenB) best = x;
      }
    }
    return best;
  }

  function applyVaultRowMeta(r, pluginId, coll) {
    setRowField(r, 'plugin_id', pluginId);
    setRowField(r, FIELD_PLUGIN, pluginId, coll);
    setRowField(r, FIELD_KIND, KIND_VAULT);
  }

  function drain() {
    if (busy || !q.length) return;
    busy = true;
    const job = q.shift();
    Promise.resolve(typeof job === 'function' ? job() : job)
      .catch((e) => console.error('[ThymerPluginSettings]', e))
      .finally(() => {
        busy = false;
        if (q.length) setTimeout(drain, 450);
      });
  }

  function enqueue(job) {
    q.push(job);
    drain();
  }

  /** Sidebar / command palette title may be `getName()` or only `getConfiguration().name`. */
  function collectionDisplayName(c) {
    if (!c) return '';
    let s = '';
    try {
      s = String(c.getName?.() || '').trim();
    } catch (_) {}
    if (s) return s;
    try {
      s = String(c.getConfiguration?.()?.name || '').trim();
    } catch (_) {}
    return s;
  }

  /** Configured collection name only (avoids duplicating `collectionDisplayName` fallbacks). */
  function collectionBackendConfiguredTitle(c) {
    if (!c) return '';
    try {
      return String(c.getConfiguration?.()?.name || '').trim();
    } catch (_) {
      return '';
    }
  }

  /**
   * When plugin iframes are opaque (blob/sandbox), `navigator.locks` and `window.top` globals do not
   * dedupe across realms. First `localStorage` we can reach on the Thymer app origin is shared.
   */
  function getSharedThymerLocalStorage() {
    const seen = new Set();
    const tryWin = (w) => {
      if (!w || seen.has(w)) return null;
      seen.add(w);
      try {
        const ls = w.localStorage;
        void ls.length;
        return ls;
      } catch (_) {
        return null;
      }
    };
    try {
      const t = tryWin(window.top);
      if (t) return t;
    } catch (_) {}
    try {
      const t = tryWin(window);
      if (t) return t;
    } catch (_) {}
    try {
      let w = window;
      for (let i = 0; i < 10 && w; i++) {
        const t = tryWin(w);
        if (t) return t;
        if (w === w.parent) break;
        w = w.parent;
      }
    } catch (_) {}
    return null;
  }

  /** Unscoped keys (legacy); runtime uses {@link scopedPbLsKey} per workspace. */
  const LS_CREATE_LEASE_BASE = 'thymerext_plugin_backend_create_lease_v1';
  const LS_RECENT_CREATE_BASE = 'thymerext_plugin_backend_recent_create_v1';
  const LS_RECENT_CREATE_ATTEMPT_BASE = 'thymerext_plugin_backend_recent_create_attempt_v1';

  function workspaceSlugFromData(data) {
    try {
      const u = data && typeof data.getActiveUsers === 'function' ? data.getActiveUsers() : null;
      const g = u && u[0] && u[0].workspaceGuid;
      const s = g != null ? String(g).trim() : '';
      if (s) return s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120);
    } catch (_) {}
    return '_unknown_ws';
  }

  function scopedPbLsKey(base, data) {
    return `${base}__${workspaceSlugFromData(data)}`;
  }

  /** Count collections whose sidebar/title name is exactly Plugin Backend (or legacy). */
  async function countExactPluginBackendNamedCollections(data) {
    let all;
    try {
      all = await getAllCollectionsDeduped(data);
    } catch (_) {
      return 0;
    }
    if (!Array.isArray(all)) return 0;
    let n = 0;
    for (const c of all) {
      try {
        const nm = collectionDisplayName(c);
        if (nm === COL_NAME || nm === COL_NAME_LEGACY) n += 1;
      } catch (_) {}
    }
    return n;
  }

  /**
   * Cross-realm mutex for `createCollection` + first `saveConfiguration` only.
   * Lease keys are **per workspace** so switching workspaces does not inherit another vault’s lease / cooldown.
   * @returns {{ denied: boolean, release: () => void }}
   */
  async function acquirePluginBackendCreationLease(maxWaitMs, data) {
    const locksOk =
      typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function';
    const noop = { denied: false, release() {} };
    const ls = getSharedThymerLocalStorage();
    if (!ls) {
      if (locksOk) return noop;
      if (DEBUG_COLLECTIONS) {
        dlogPathB('lease_denied_no_localstorage_no_locks', { ws: workspaceSlugFromData(data) });
      }
      return { denied: true, release() {} };
    }
    const leaseKey = scopedPbLsKey(LS_CREATE_LEASE_BASE, data);
    const holder =
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + (Number(maxWaitMs) > 0 ? maxWaitMs : 12000);
    let acquired = false;
    let sawContention = false;
    while (Date.now() < deadline) {
      try {
        const raw = ls.getItem(leaseKey);
        let busy = false;
        if (raw) {
          let j = null;
          try {
            j = JSON.parse(raw);
          } catch (_) {
            j = null;
          }
          if (j && typeof j.exp === 'number' && j.h !== holder && j.exp > Date.now()) busy = true;
        }
        if (busy) {
          sawContention = true;
          await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 70)));
          continue;
        }
        const exp = Date.now() + 45000;
        const payload = JSON.stringify({ h: holder, exp });
        ls.setItem(leaseKey, payload);
        await new Promise((r) => setTimeout(r, 0));
        if (ls.getItem(leaseKey) === payload) {
          acquired = true;
          if (DEBUG_COLLECTIONS) dlogPathB('lease_acquired', { via: 'localStorage', sawContention, leaseKey });
          break;
        }
      } catch (_) {
        return locksOk ? noop : { denied: true, release() {} };
      }
      await new Promise((r) => setTimeout(r, 30 + Math.floor(Math.random() * 50)));
    }
    if (!acquired) {
      if (DEBUG_COLLECTIONS) dlogPathB('lease_timeout_abort_create', { sawContention, leaseKey });
      return { denied: true, release() {} };
    }
    return {
      denied: false,
      release() {
        if (!acquired) return;
        acquired = false;
        try {
          const cur = ls.getItem(leaseKey);
          if (!cur) return;
          let j = null;
          try {
            j = JSON.parse(cur);
          } catch (_) {
            return;
          }
          if (j && j.h === holder) ls.removeItem(leaseKey);
        } catch (_) {}
      },
    };
  }

  function noteRecentPluginBackendCreate(data) {
    const ls = getSharedThymerLocalStorage();
    if (!ls || !data) return;
    try {
      ls.setItem(scopedPbLsKey(LS_RECENT_CREATE_BASE, data), String(Date.now()));
    } catch (_) {}
  }

  function getRecentPluginBackendCreateAgeMs(data) {
    const ls = getSharedThymerLocalStorage();
    if (!ls || !data) return null;
    try {
      const raw = ls.getItem(scopedPbLsKey(LS_RECENT_CREATE_BASE, data));
      const ts = Number(raw);
      if (!Number.isFinite(ts) || ts <= 0) return null;
      return Date.now() - ts;
    } catch (_) {
      return null;
    }
  }

  function noteRecentPluginBackendCreateAttempt(data) {
    const ls = getSharedThymerLocalStorage();
    if (!ls || !data) return;
    try {
      ls.setItem(scopedPbLsKey(LS_RECENT_CREATE_ATTEMPT_BASE, data), String(Date.now()));
    } catch (_) {}
  }

  function getRecentPluginBackendCreateAttemptAgeMs(data) {
    const ls = getSharedThymerLocalStorage();
    if (!ls || !data) return null;
    try {
      const raw = ls.getItem(scopedPbLsKey(LS_RECENT_CREATE_ATTEMPT_BASE, data));
      const ts = Number(raw);
      if (!Number.isFinite(ts) || ts <= 0) return null;
      return Date.now() - ts;
    } catch (_) {
      return null;
    }
  }

  /** When Thymer omits names on `getAllCollections()` entries, match our Path B schema. */
  function pathBCollectionScore(c) {
    if (!c) return 0;
    try {
      const conf = c.getConfiguration?.() || {};
      const fields = Array.isArray(conf.fields) ? conf.fields : [];
      const ids = new Set(fields.map((f) => f && f.id).filter(Boolean));
      if (!ids.has('plugin_id') || !ids.has('settings_json')) return 0;
      let s = 2;
      if (ids.has(FIELD_PLUGIN)) s += 2;
      if (ids.has(FIELD_KIND)) s += 1;
      const nm = collectionDisplayName(c).toLowerCase();
      if (nm && (nm.includes('plugin') && (nm.includes('backend') || nm.includes('setting')))) s += 1;
      return s;
    } catch (_) {
      return 0;
    }
  }

  function pickPathBCollectionHeuristic(all) {
    const list = Array.isArray(all) ? all : [];
    const cands = [];
    let bestS = 0;
    for (const c of list) {
      const sc = pathBCollectionScore(c);
      if (sc > bestS) {
        bestS = sc;
        cands.length = 0;
        cands.push(c);
      } else if (sc === bestS && sc >= 2) {
        cands.push(c);
      }
    }
    if (!cands.length) return null;
    const named = cands.find((c) => {
      const n = collectionDisplayName(c);
      const cfg = collectionBackendConfiguredTitle(c);
      return n === COL_NAME || n === COL_NAME_LEGACY || cfg === COL_NAME || cfg === COL_NAME_LEGACY;
    });
    return named || cands[0];
  }

  function pickCollFromAll(all) {
    try {
      const pick = (allIn) => {
        const list = Array.isArray(allIn) ? allIn : [];
        return (
          list.find((c) => collectionDisplayName(c) === COL_NAME) ||
          list.find((c) => collectionDisplayName(c) === COL_NAME_LEGACY) ||
          list.find((c) => collectionBackendConfiguredTitle(c) === COL_NAME) ||
          list.find((c) => collectionBackendConfiguredTitle(c) === COL_NAME_LEGACY) ||
          null
        );
      };
      return pick(all) || pickPathBCollectionHeuristic(all) || null;
    } catch (_) {
      return null;
    }
  }

  function hasPluginBackendInAll(all) {
    if (!Array.isArray(all) || all.length === 0) return false;
    for (const c of all) {
      const nm = collectionDisplayName(c);
      if (nm === COL_NAME || nm === COL_NAME_LEGACY) return true;
      const cfg = collectionBackendConfiguredTitle(c);
      if (cfg === COL_NAME || cfg === COL_NAME_LEGACY) return true;
    }
    return !!pickPathBCollectionHeuristic(all);
  }

  async function findColl(data) {
    try {
      const all = await getAllCollectionsDeduped(data);
      return pickCollFromAll(all);
    } catch (_) {
      return null;
    }
  }

  /** Brute list scan — catches a Backend another iframe just created if `findColl` lags. */
  async function hasPluginBackendOnWorkspace(data) {
    try {
      const all = await getAllCollectionsDeduped(data);
      return hasPluginBackendInAll(all);
    } catch (_) {
      return false;
    }
  }

  const PB_LOCK_NAME = 'thymer-ext-plugin-backend-ensure-v1';
  const DATA_ENSURE_P = '__thymerExtDataPluginBackendEnsureP';
  /** Per-workspace: Plugin Backend already ensured — skip repeat bodies (avoids getAllCollections / lock storms). */
  const WS_ENSURE_OK_MAP = '__thymerExtPbWorkspaceEnsureOkMap_v1';

  function markWorkspacePluginBackendEnsureDone(data) {
    try {
      const slug = workspaceSlugFromData(data);
      const h = getSharedDeduplicationWindow();
      if (!h[WS_ENSURE_OK_MAP] || typeof h[WS_ENSURE_OK_MAP] !== 'object') h[WS_ENSURE_OK_MAP] = Object.create(null);
      h[WS_ENSURE_OK_MAP][slug] = true;
    } catch (_) {}
  }

  function isWorkspacePluginBackendEnsureDone(data) {
    try {
      const slug = workspaceSlugFromData(data);
      const h = getSharedDeduplicationWindow();
      const m = h[WS_ENSURE_OK_MAP];
      return !!(m && m[slug]);
    } catch (_) {
      return false;
    }
  }

  function dlogPathB(phase, extra) {
    if (!DEBUG_COLLECTIONS) return;
    try {
      const row = { runId: DEBUG_PATHB_ID, phase, t: (typeof performance !== 'undefined' && performance.now) ? +performance.now().toFixed(1) : 0, ...extra };
      console.info('[ThymerExt/PluginBackend]', row);
    } catch (_) {
      void 0;
    }
  }

  function pathBWindowSnapshot() {
    const snap = { runId: DEBUG_PATHB_ID, topReadable: null, hasLocks: null };
    try {
      if (typeof window !== 'undefined' && window.top) {
        void window.top.document;
        snap.topReadable = true;
      }
    } catch (e) {
      snap.topReadable = false;
      try {
        snap.topErr = String((e && e.name) || e) || 'top-doc-threw';
      } catch (_) {
        snap.topErr = 'top-doc-threw';
      }
    }
    const host = getSharedDeduplicationWindow();
    try {
      snap.hasLocks = !!(typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request);
    } catch (_) {
      snap.hasLocks = 'err';
    }
    try {
      snap.locationHref = typeof location !== 'undefined' ? String(location.href) : '';
    } catch (_) {
      snap.locationHref = '';
    }
    try {
      snap.hasSelf = typeof self !== 'undefined' && self === window;
      snap.selfIsTop = typeof window !== 'undefined' && window === window.top;
      snap.hostIsTop = host === (typeof window !== 'undefined' ? window.top : null);
      snap.hostIsSelf = host === (typeof window !== 'undefined' ? window : null);
      snap.hostType = (host && host.constructor && host.constructor.name) || '';
    } catch (_) {
      void 0;
    }
    try {
      snap.gHasPbP = host && host[PB_ENSURE_GLOBAL_P] != null;
      snap.gHasCreateQ = host && host[SERIAL_DATA_CREATE_P] != null;
    } catch (_) {
      void 0;
    }
    return snap;
  }

  function queueDataCreateOnSharedWindow(factory) {
    const host = getSharedDeduplicationWindow();
    if (DEBUG_COLLECTIONS) {
      dlogPathB('queueDataCreate_enter', { ...pathBWindowSnapshot() });
    }
    try {
      if (!host[SERIAL_DATA_CREATE_P] || typeof host[SERIAL_DATA_CREATE_P].then !== 'function') {
        host[SERIAL_DATA_CREATE_P] = Promise.resolve();
      }
      const out = (host[SERIAL_DATA_CREATE_P] = host[SERIAL_DATA_CREATE_P].catch(() => {}).then(factory));
      if (DEBUG_COLLECTIONS) dlogPathB('queueDataCreate_chained', { gHasCreateQ: !!host[SERIAL_DATA_CREATE_P] });
      return out;
    } catch (e) {
      if (DEBUG_COLLECTIONS) dlogPathB('queueDataCreate_fallback', { err: String((e && e.message) || e) });
      return factory();
    }
  }

  async function runPluginBackendEnsureBody(data) {
    if (data && isWorkspacePluginBackendEnsureDone(data)) return;
    if (DEBUG_COLLECTIONS) {
      dlogPathB('ensureBody_start', { pathB: pathBWindowSnapshot() });
      try {
        if (data && data.getAllCollections) {
          const a = await getAllCollectionsDeduped(data);
          const list = Array.isArray(a) ? a : [];
          const collNames = list.map((c) => {
            try { return String(collectionDisplayName(c) || '').trim() || '(no-name)'; } catch (__) { return '(err)'; }
          });
          dlogPathB('ensureBody_collections', { count: (collNames && collNames.length) || 0, names: (collNames || []).slice(0, 40) });
          if (data && data.getAllCollections) touchGetAllSanityFromCount((collNames && collNames.length) || 0);
          const dupExact = list.filter((c) => {
            try {
              const nm = collectionDisplayName(c);
              return nm === COL_NAME || nm === COL_NAME_LEGACY;
            } catch (__) {
              return false;
            }
          });
          if (dupExact.length > 1) {
            dlogPathB('duplicate_plugin_backend_named_collections', {
              count: dupExact.length,
              guids: dupExact.map((c) => {
                try {
                  return c.getGuid?.() || null;
                } catch (__) {
                  return null;
                }
              }),
              doc: 'docs/PLUGIN_BACKEND_DUPLICATE_HYGIENE.md',
            });
          }
        }
      } catch (e) {
        dlogPathB('ensureBody_getAll_failed', { err: String((e && e.message) || e) });
      }
    }
    try {
      const markPbOk = () => markWorkspacePluginBackendEnsureDone(data);
      let existing = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        let allAttempt;
        try {
          allAttempt = await getAllCollectionsDeduped(data);
        } catch (_) {
          allAttempt = null;
        }
        if (allAttempt != null) {
          existing = pickCollFromAll(allAttempt);
          if (existing) {
            markPbOk();
            return;
          }
          if (hasPluginBackendInAll(allAttempt)) {
            markPbOk();
            return;
          }
        } else {
          existing = await findColl(data);
          if (existing) {
            markPbOk();
            return;
          }
          if (await hasPluginBackendOnWorkspace(data)) {
            markPbOk();
            return;
          }
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 50 + attempt * 50));
      }
      let allPost;
      try {
        allPost = await getAllCollectionsDeduped(data);
      } catch (_) {
        allPost = null;
      }
      if (allPost != null) {
        existing = pickCollFromAll(allPost);
        if (existing) {
          markPbOk();
          return;
        }
        if (hasPluginBackendInAll(allPost)) {
          markPbOk();
          return;
        }
      } else {
        existing = await findColl(data);
        if (existing) {
          markPbOk();
          return;
        }
        if (await hasPluginBackendOnWorkspace(data)) {
          markPbOk();
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 120));
      let allAfterWait;
      try {
        allAfterWait = await getAllCollectionsDeduped(data);
      } catch (_) {
        allAfterWait = null;
      }
      if (allAfterWait != null) {
        if (pickCollFromAll(allAfterWait)) {
          markPbOk();
          return;
        }
        if (hasPluginBackendInAll(allAfterWait)) {
          markPbOk();
          return;
        }
      } else {
        if (await findColl(data)) {
          markPbOk();
          return;
        }
        if (await hasPluginBackendOnWorkspace(data)) {
          markPbOk();
          return;
        }
      }
      let preCreateLen = 0;
      try {
        if (data && data.getAllCollections) {
          const all0 = await getAllCollectionsDeduped(data);
          preCreateLen = Array.isArray(all0) ? all0.length : 0;
          if (preCreateLen > 0) touchGetAllSanityFromCount(preCreateLen);
        }
        if (preCreateLen === 0) {
          await new Promise((r) => setTimeout(r, 150));
          if (data && data.getAllCollections) {
            const all1 = await getAllCollectionsDeduped(data);
            preCreateLen = Array.isArray(all1) ? all1.length : 0;
            if (preCreateLen > 0) touchGetAllSanityFromCount(preCreateLen);
          }
        }
        if (preCreateLen > 0) {
          let allPre;
          try {
            allPre = await getAllCollectionsDeduped(data);
          } catch (_) {
            allPre = null;
          }
          if (allPre != null) {
            if (pickCollFromAll(allPre)) {
              markPbOk();
              return;
            }
            if (hasPluginBackendInAll(allPre)) {
              markPbOk();
              return;
            }
          } else {
            if (await findColl(data)) {
              markPbOk();
              return;
            }
            if (await hasPluginBackendOnWorkspace(data)) {
              markPbOk();
              return;
            }
          }
        }
        if (isSuspiciousEmptyAfterRecentNonEmptyList(preCreateLen) && preCreateLen === 0) {
          if (DEBUG_COLLECTIONS) {
            try {
              const h = getSharedDeduplicationWindow();
              dlogPathB('refuse_create_flaky_getall_empty', { pathB: pathBWindowSnapshot(), s: h[GETALL_COLLECTIONS_SANITY] || null });
            } catch (_) {
              dlogPathB('refuse_create_flaky_getall_empty', { pathB: pathBWindowSnapshot() });
            }
          }
          return;
        }
      } catch (_) {
        void 0;
      }
      if (DEBUG_COLLECTIONS) dlogPathB('ensureBody_about_to_create', { pathB: pathBWindowSnapshot() });
      const lease = await acquirePluginBackendCreationLease(14000, data);
      if (lease.denied) return;
      try {
        let allLease;
        try {
          allLease = await getAllCollectionsDeduped(data);
        } catch (_) {
          allLease = null;
        }
        if (allLease != null) {
          if (pickCollFromAll(allLease)) {
            markPbOk();
            return;
          }
          if (hasPluginBackendInAll(allLease)) {
            markPbOk();
            return;
          }
        } else {
          if (await findColl(data)) {
            markPbOk();
            return;
          }
          if (await hasPluginBackendOnWorkspace(data)) {
            markPbOk();
            return;
          }
        }
        const recentAttemptAge = getRecentPluginBackendCreateAttemptAgeMs(data);
        if (recentAttemptAge != null && recentAttemptAge >= 0 && recentAttemptAge < 120000) {
          // Another plugin iframe attempted creation very recently. Avoid burst duplicate creates.
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 130 + i * 70));
            let allCont;
            try {
              allCont = await getAllCollectionsDeduped(data);
            } catch (_) {
              allCont = null;
            }
            if (allCont != null) {
              if (pickCollFromAll(allCont)) {
                markPbOk();
                return;
              }
              if (hasPluginBackendInAll(allCont)) {
                markPbOk();
                return;
              }
            } else {
              if (await findColl(data)) {
                markPbOk();
                return;
              }
              if (await hasPluginBackendOnWorkspace(data)) {
                markPbOk();
                return;
              }
            }
          }
          return;
        }
        const recentAge = getRecentPluginBackendCreateAgeMs(data);
        if (recentAge != null && recentAge >= 0 && recentAge < 90000) {
          // Another plugin/runtime likely just created it; let collection list/indexing settle first.
          for (let i = 0; i < 8; i++) {
            await new Promise((r) => setTimeout(r, 120 + i * 60));
            let allSettle;
            try {
              allSettle = await getAllCollectionsDeduped(data);
            } catch (_) {
              allSettle = null;
            }
            if (allSettle != null) {
              if (pickCollFromAll(allSettle)) {
                markPbOk();
                return;
              }
              if (hasPluginBackendInAll(allSettle)) {
                markPbOk();
                return;
              }
            } else {
              if (await findColl(data)) {
                markPbOk();
                return;
              }
              if (await hasPluginBackendOnWorkspace(data)) {
                markPbOk();
                return;
              }
            }
          }
        }
        noteRecentPluginBackendCreateAttempt(data);
        const exactN = await countExactPluginBackendNamedCollections(data);
        if (exactN >= 1) {
          if (DEBUG_COLLECTIONS) {
            dlogPathB('abort_create_exact_backend_name_exists', { exactN, ws: workspaceSlugFromData(data) });
          }
          markPbOk();
          return;
        }
        const coll = await queueDataCreateOnSharedWindow(() => data.createCollection());
        if (!coll || typeof coll.getConfiguration !== 'function' || typeof coll.saveConfiguration !== 'function') {
          return;
        }
        const conf = cloneShape();
        const base = coll.getConfiguration();
        if (base && typeof base.ver === 'number') conf.ver = base.ver;
        let ok = await coll.saveConfiguration(conf);
        if (ok === false) {
          // Transient host races can reject the first save; retry before giving up.
          await new Promise((r) => setTimeout(r, 180));
          ok = await coll.saveConfiguration(conf);
        }
        if (ok === false) return;
        noteRecentPluginBackendCreate(data);
        markPbOk();
        await new Promise((r) => setTimeout(r, 250));
      } finally {
        try {
          lease.release();
        } catch (_) {}
      }
    } catch (e) {
      console.error('[ThymerPluginSettings] ensure collection', e);
    }
  }

  function runPluginBackendEnsureWithLocksOrChain(data) {
    try {
      if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        if (DEBUG_COLLECTIONS) dlogPathB('ensure_route', { via: 'locks', lockName: PB_LOCK_NAME, pathB: pathBWindowSnapshot() });
        return navigator.locks.request(PB_LOCK_NAME, () => runPluginBackendEnsureBody(data));
      }
    } catch (e) {
      if (DEBUG_COLLECTIONS) dlogPathB('ensure_locks_threw', { err: String((e && e.message) || e) });
    }
    if (DEBUG_COLLECTIONS) dlogPathB('ensure_route', { via: 'hierarchyChain', pathB: pathBWindowSnapshot() });
    return chainPluginBackendEnsure(data, () => runPluginBackendEnsureBody(data));
  }

  function ensurePluginSettingsCollection(data) {
    if (!data || typeof data.getAllCollections !== 'function' || typeof data.createCollection !== 'function') {
      return Promise.resolve();
    }
    if (isWorkspacePluginBackendEnsureDone(data)) {
      return Promise.resolve();
    }
    if (DEBUG_COLLECTIONS) {
      let dHint = 'no-data';
      try {
        dHint = data
          ? `ctor=${(data && data.constructor && data.constructor.name) || '?'},eqPrev=${(data && data === g.__th_lastDataPb) || false},keys=${
            Object.keys(data).filter((k) => k && (k.includes('thymer') || k.includes('__'))).length
          }`
          : 'null';
        g.__th_lastDataPb = data;
      } catch (_) {
        dHint = 'err';
      }
      dlogPathB('ensurePluginSettingsCollection', { dataHint: dHint, dataExpand: (() => { try { if (!data) return { ok: false }; return { hasDataEnsure: !!data[DATA_ENSURE_P] }; } catch (_) { return { ok: 'throw' }; } })(), pathB: pathBWindowSnapshot() });
    }
    try {
      if (!data[DATA_ENSURE_P] || typeof data[DATA_ENSURE_P].then !== 'function') {
        data[DATA_ENSURE_P] = Promise.resolve();
      }
      if (DEBUG_COLLECTIONS) dlogPathB('data_ensure_p_chained', { hasPriorTail: true });
      const next = data[DATA_ENSURE_P]
        .catch(() => {})
        .then(() => runPluginBackendEnsureWithLocksOrChain(data));
      data[DATA_ENSURE_P] = next;
      return next;
    } catch (e) {
      if (DEBUG_COLLECTIONS) dlogPathB('data_ensure_p_throw', { err: String((e && e.message) || e) });
      return runPluginBackendEnsureWithLocksOrChain(data);
    }
  }

  async function readDoc(data, pluginId) {
    const coll = await findColl(data);
    if (!coll) return null;
    let records;
    try {
      records = await coll.getAllRecords();
    } catch (_) {
      return null;
    }
    const r = findVaultRecord(records, pluginId);
    if (!r) return null;
    let raw = '';
    try {
      raw = r.text?.('settings_json') || '';
    } catch (_) {}
    if (!raw || !String(raw).trim()) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  async function writeDoc(data, pluginId, doc) {
    const coll = await findColl(data);
    if (!coll) return;
    await upgradePluginSettingsSchema(data, coll);
    const json = JSON.stringify(doc);
    let records;
    try {
      records = await coll.getAllRecords();
    } catch (_) {
      return;
    }
    let r = findVaultRecord(records, pluginId);
    if (!r) {
      let guid = null;
      try {
        guid = coll.createRecord?.(pluginId);
      } catch (_) {}
      if (guid) {
        for (let i = 0; i < 30; i++) {
          await new Promise((res) => setTimeout(res, i < 8 ? 100 : 200));
          try {
            const again = await coll.getAllRecords();
            r = again.find((x) => x.guid === guid) || findVaultRecord(again, pluginId);
            if (r) break;
          } catch (_) {}
        }
      }
    }
    if (!r) return;
    applyVaultRowMeta(r, pluginId, coll);
    try {
      const pj = r.prop?.('settings_json');
      if (pj && typeof pj.set === 'function') pj.set(json);
    } catch (_) {}
  }

  const LOCAL_MIRROR_META_PREFIX = 'thymerext_ps_local_meta_v1:';

  function localMirrorMetaKey(pluginId) {
    return LOCAL_MIRROR_META_PREFIX + encodeURIComponent(String(pluginId || 'unknown'));
  }

  function parseIsoMs(s) {
    const n = Date.parse(String(s || ''));
    return Number.isFinite(n) ? n : 0;
  }

  function readLocalMirrorMeta(pluginId) {
    try {
      const raw = localStorage.getItem(localMirrorMetaKey(pluginId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
    return {};
  }

  function writeLocalMirrorMeta(pluginId, meta) {
    try {
      localStorage.setItem(localMirrorMetaKey(pluginId), JSON.stringify(meta || {}));
    } catch (_) {}
  }

  function markLocalMirrorKeys(pluginId, keys, updatedAt) {
    if (!pluginId || !Array.isArray(keys)) return;
    const meta = readLocalMirrorMeta(pluginId);
    const ts = updatedAt || new Date().toISOString();
    let changed = false;
    for (const k of keys) {
      if (!k) continue;
      let exists = false;
      try {
        exists = localStorage.getItem(k) !== null;
      } catch (_) {}
      if (!exists) continue;
      meta[k] = { updatedAt: ts };
      changed = true;
    }
    if (changed) writeLocalMirrorMeta(pluginId, meta);
  }

  function collectLocalMirrorPayload(keys) {
    const payload = {};
    if (!Array.isArray(keys)) return payload;
    for (const k of keys) {
      if (!k) continue;
      try {
        const v = localStorage.getItem(k);
        if (v !== null) payload[k] = v;
      } catch (_) {}
    }
    return payload;
  }

  function localPayloadMatchesRemote(keys, remote) {
    if (!remote || !remote.payload || typeof remote.payload !== 'object') return false;
    if (!Array.isArray(keys)) return true;
    for (const k of keys) {
      if (!k) continue;
      let localValue = null;
      try {
        localValue = localStorage.getItem(k);
      } catch (_) {}
      const remoteValue = remote.payload[k];
      if (localValue === null && typeof remoteValue !== 'string') continue;
      if (localValue !== remoteValue) return false;
    }
    return true;
  }

  function applyRemoteMirrorPayload(pluginId, keys, remote) {
    const result = { needsFlush: false };
    if (!remote || !remote.payload || typeof remote.payload !== 'object') return result;
    const meta = readLocalMirrorMeta(pluginId);
    const remoteUpdatedAt = String(remote.updatedAt || '');
    const remoteMs = parseIsoMs(remoteUpdatedAt);
    let metaChanged = false;
    for (const k of keys) {
      if (!k) continue;
      const remoteValue = remote.payload[k];
      if (typeof remoteValue !== 'string') continue;

      let localValue = null;
      try {
        localValue = localStorage.getItem(k);
      } catch (_) {}

      if (localValue === remoteValue) {
        if (remoteUpdatedAt && (!meta[k] || !meta[k].updatedAt)) {
          meta[k] = { updatedAt: remoteUpdatedAt };
          metaChanged = true;
        }
        continue;
      }

      if (localValue === null) {
        try {
          localStorage.setItem(k, remoteValue);
          if (remoteUpdatedAt) {
            meta[k] = { updatedAt: remoteUpdatedAt };
            metaChanged = true;
          }
        } catch (_) {}
        continue;
      }

      const localMs = parseIsoMs(meta[k]?.updatedAt);
      if (localMs && remoteMs && remoteMs > localMs + 1000) {
        try {
          localStorage.setItem(k, remoteValue);
          meta[k] = { updatedAt: remoteUpdatedAt };
          metaChanged = true;
        } catch (_) {}
        continue;
      }

      // When freshness is ambiguous, preserve the browser's current settings and let flushNow repair the vault row.
      result.needsFlush = true;
      if (!localMs) {
        meta[k] = { updatedAt: new Date().toISOString() };
        metaChanged = true;
      }
      console.warn('[ThymerPluginSettings] Kept local settings instead of overwriting with older/ambiguous synced payload', {
        pluginId,
        key: k,
        localUpdatedAt: meta[k]?.updatedAt || null,
        remoteUpdatedAt: remoteUpdatedAt || null,
      });
    }
    if (metaChanged) writeLocalMirrorMeta(pluginId, meta);
    return result;
  }

  function shouldFlushMirrorOnInit(keys, remote, applyResult) {
    if (applyResult?.needsFlush) return true;
    if (remote && remote.payload && typeof remote.payload === 'object') {
      return !localPayloadMatchesRemote(keys, remote);
    }
    return Object.keys(collectLocalMirrorPayload(keys)).length > 0;
  }

  async function listRows(data, { pluginSlug, recordKind } = {}) {
    const slug = (pluginSlug || '').trim();
    if (!slug) return [];
    const coll = await findColl(data);
    if (!coll) return [];
    let records;
    try {
      records = await coll.getAllRecords();
    } catch (_) {
      return [];
    }
    const plugCol = pluginColumnPropId(coll, FIELD_PLUGIN);
    return records.filter((r) => {
      const pid = rowField(r, 'plugin_id');
      let rowSlug = rowField(r, plugCol);
      if (!rowSlug) rowSlug = inferPluginSlugFromPid(pid);
      if (rowSlug !== slug) return false;
      if (recordKind != null && String(recordKind) !== '') {
        const rk = rowField(r, FIELD_KIND) || inferRecordKindFromPid(pid, slug);
        return rk === String(recordKind);
      }
      return true;
    });
  }

  async function createDataRow(data, { pluginSlug, recordKind, rowPluginId, recordTitle, settingsDoc } = {}) {
    const ps = (pluginSlug || '').trim();
    const rid = (rowPluginId || '').trim();
    const kind = (recordKind || '').trim();
    if (!ps || !rid || !kind) {
      console.warn('[ThymerPluginSettings] createDataRow: pluginSlug, recordKind, and rowPluginId are required');
      return null;
    }
    if (rid === ps && kind !== KIND_VAULT) {
      console.warn('[ThymerPluginSettings] createDataRow: rowPluginId must differ from plugin slug unless record_kind is vault');
    }
    await ensurePluginSettingsCollection(data);
    const coll = await findColl(data);
    if (!coll) return null;
    await upgradePluginSettingsSchema(data, coll);
    const title = (recordTitle || rid).trim() || rid;
    let guid = null;
    try {
      guid = coll.createRecord?.(title);
    } catch (e) {
      console.error('[ThymerPluginSettings] createDataRow createRecord', e);
      return null;
    }
    if (!guid) return null;
    let r = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((res) => setTimeout(res, i < 8 ? 100 : 200));
      try {
        const again = await coll.getAllRecords();
        r = again.find((x) => x.guid === guid) || again.find((x) => rowField(x, 'plugin_id') === rid);
        if (r) break;
      } catch (_) {}
    }
    if (!r) return null;
    setRowField(r, 'plugin_id', rid);
    setRowField(r, FIELD_PLUGIN, ps, coll);
    setRowField(r, FIELD_KIND, kind);
    const json =
      settingsDoc !== undefined && settingsDoc !== null
        ? typeof settingsDoc === 'string'
          ? settingsDoc
          : JSON.stringify(settingsDoc)
        : '{}';
    try {
      const pj = r.prop?.('settings_json');
      if (pj && typeof pj.set === 'function') pj.set(json);
    } catch (_) {}
    return r;
  }

  function showFirstRunDialog(ui, label, preferred, onPick) {
    const id = 'thymerext-ps-first-' + Math.random().toString(36).slice(2);
    const box = document.createElement('div');
    box.id = id;
    box.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    const card = document.createElement('div');
    card.style.cssText =
      'max-width:420px;width:100%;background:var(--panel-bg-color,#1d1915);border:1px solid var(--border-default,#3f3f46);border-radius:12px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
    const title = document.createElement('div');
    title.textContent = label + ' — where to store settings?';
    title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:10px;';
    const hint = document.createElement('div');
    hint.textContent = 'Change later via Command Palette → “Storage location…”';
    hint.style.cssText = 'font-size:12px;color:var(--text-muted,#888);margin-bottom:16px;line-height:1.45;';
    const mk = (t, sub, prim) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText =
        'display:block;width:100%;text-align:left;padding:12px 14px;margin-bottom:10px;border-radius:8px;cursor:pointer;font-size:14px;border:1px solid var(--border-default,#3f3f46);background:' +
        (prim ? 'rgba(167,139,250,0.25)' : 'transparent') +
        ';color:inherit;';
      const x = document.createElement('div');
      x.textContent = t;
      x.style.fontWeight = '600';
      b.appendChild(x);
      if (sub) {
        const s = document.createElement('div');
        s.textContent = sub;
        s.style.cssText = 'font-size:11px;opacity:0.75;margin-top:4px;line-height:1.35;';
        b.appendChild(s);
      }
      return b;
    };
    const bLoc = mk('This device only', 'Browser localStorage only.', preferred === 'local');
    const bSyn = mk(
      'Sync across devices',
      'Store in the workspace “' + COL_NAME + '” collection (same account on any browser).',
      preferred === 'synced'
    );
    const fin = (m) => {
      try {
        box.remove();
      } catch (_) {}
      onPick(m);
    };
    bLoc.addEventListener('click', () => fin('local'));
    bSyn.addEventListener('click', () => fin('synced'));
    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(bLoc);
    card.appendChild(bSyn);
    box.appendChild(card);
    document.body.appendChild(box);
  }

  g.ThymerPluginSettings = {
    COL_NAME,
    COL_NAME_LEGACY,
    FIELD_PLUGIN,
    FIELD_RECORD_KIND: FIELD_KIND,
    RECORD_KIND_VAULT: KIND_VAULT,
    enqueue,
    rowField,
    findVaultRecord,
    listRows,
    createDataRow,
    upgradeCollectionSchema: (data) => upgradePluginSettingsSchema(data),
    registerPluginSlug,
    preferDeferredHeavyWork,
    yieldToHostBeforePathB,
    ensureMobileLoadGraceStarted,
    inMobileLoadGrace,
    bumpMobileLoadGrace,
    installMobileResumeGraceListener,

    async init(opts) {
      ensureMobileLoadGraceStarted();
      installMobileResumeGraceListener();
      installMobileInteractionGraceListener();
      await yieldToHostBeforePathB();
      const { plugin, pluginId, modeKey, mirrorKeys, label, data, ui } = opts;

      let mode = null;
      try {
        mode = localStorage.getItem(modeKey);
      } catch (_) {}

      const remote = await readDoc(data, pluginId);
      if (!mode && remote && (remote.storageMode === 'synced' || remote.storageMode === 'local')) {
        mode = remote.storageMode;
        try {
          localStorage.setItem(modeKey, mode);
        } catch (_) {}
      }

      if (!mode) {
        const coll = await findColl(data);
        const preferred = coll ? 'synced' : 'local';
        await new Promise((r) => {
          requestAnimationFrame(() => requestAnimationFrame(() => r()));
        });
        await new Promise((outerResolve) => {
          enqueue(async () => {
            const picked = await new Promise((r) => {
              showFirstRunDialog(ui, label, preferred, r);
            });
            try {
              localStorage.setItem(modeKey, picked);
            } catch (_) {}
            outerResolve(picked);
          });
        });
        try {
          mode = localStorage.getItem(modeKey);
        } catch (_) {}
      }

      plugin._pluginSettingsSyncMode = mode === 'synced' ? 'synced' : 'local';
      plugin._pluginSettingsPluginId = pluginId;
      const keys = typeof mirrorKeys === 'function' ? mirrorKeys() : mirrorKeys;
      let initFlushNeeded = false;

      if (plugin._pluginSettingsSyncMode === 'synced' && remote && remote.payload && typeof remote.payload === 'object') {
        const applyResult = applyRemoteMirrorPayload(pluginId, keys, remote);
        initFlushNeeded = shouldFlushMirrorOnInit(keys, remote, applyResult);
      } else if (plugin._pluginSettingsSyncMode === 'synced') {
        initFlushNeeded = shouldFlushMirrorOnInit(keys, remote, null);
      }

      if (plugin._pluginSettingsSyncMode === 'synced' && initFlushNeeded) {
        try {
          markLocalMirrorKeys(pluginId, keys);
          await g.ThymerPluginSettings.flushNow(data, pluginId, keys);
        } catch (_) {}
      }
    },

    scheduleFlush(plugin, mirrorKeys) {
      if (plugin._pluginSettingsSyncMode !== 'synced') return;
      const keys = typeof mirrorKeys === 'function' ? mirrorKeys() : mirrorKeys;
      markLocalMirrorKeys(plugin._pluginSettingsPluginId, keys);
      if (plugin._pluginSettingsFlushTimer) clearTimeout(plugin._pluginSettingsFlushTimer);
      plugin._pluginSettingsFlushTimer = setTimeout(() => {
        plugin._pluginSettingsFlushTimer = null;
        const pdata = plugin.data;
        const pid = plugin._pluginSettingsPluginId;
        if (!pid || !pdata) return;
        g.ThymerPluginSettings.flushNow(pdata, pid, keys).catch((e) => console.error('[ThymerPluginSettings] flush', e));
      }, 500);
    },

    async flushNow(data, pluginId, mirrorKeys) {
      await ensurePluginSettingsCollection(data);
      await upgradePluginSettingsSchema(data);
      const keys = typeof mirrorKeys === 'function' ? mirrorKeys() : mirrorKeys;
      const payload = {};
      for (const k of keys) {
        try {
          const v = localStorage.getItem(k);
          if (v !== null) payload[k] = v;
        } catch (_) {}
      }
      const doc = {
        v: 1,
        storageMode: 'synced',
        updatedAt: new Date().toISOString(),
        payload,
      };
      await writeDoc(data, pluginId, doc);
    },

    async openStorageDialog(opts) {
      const { plugin, pluginId, modeKey, mirrorKeys, label, data, ui } = opts;
      const cur = plugin._pluginSettingsSyncMode === 'synced' ? 'synced' : 'local';
      const pick = await new Promise((resolve) => {
        const close = (v) => {
          try {
            box.remove();
          } catch (_) {}
          resolve(v);
        };
        const box = document.createElement('div');
        box.style.cssText =
          'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';
        box.addEventListener('click', (e) => {
          if (e.target === box) close(null);
        });
        const card = document.createElement('div');
        card.style.cssText =
          'max-width:400px;width:100%;background:var(--panel-bg-color,#1d1915);border:1px solid var(--border-default,#3f3f46);border-radius:12px;padding:18px;';
        card.addEventListener('click', (e) => e.stopPropagation());
        const t = document.createElement('div');
        t.textContent = label + ' — storage';
        t.style.cssText = 'font-weight:700;margin-bottom:12px;';
        const b1 = document.createElement('button');
        b1.type = 'button';
        b1.textContent = 'This device only';
        const b2 = document.createElement('button');
        b2.type = 'button';
        b2.textContent = 'Sync across devices';
        [b1, b2].forEach((b) => {
          b.style.cssText =
            'display:block;width:100%;padding:10px 12px;margin-bottom:8px;border-radius:8px;cursor:pointer;border:1px solid var(--border-default,#3f3f46);background:transparent;color:inherit;text-align:left;';
        });
        b1.addEventListener('click', () => close('local'));
        b2.addEventListener('click', () => close('synced'));
        const bx = document.createElement('button');
        bx.type = 'button';
        bx.textContent = 'Cancel';
        bx.style.cssText =
          'margin-top:8px;padding:8px 14px;border-radius:8px;cursor:pointer;border:1px solid var(--border-default,#3f3f46);background:transparent;color:inherit;';
        bx.addEventListener('click', () => close(null));
        card.appendChild(t);
        card.appendChild(b1);
        card.appendChild(b2);
        card.appendChild(bx);
        box.appendChild(card);
        document.body.appendChild(box);
      });
      if (!pick || pick === cur) return;
      try {
        localStorage.setItem(modeKey, pick);
      } catch (_) {}
      plugin._pluginSettingsSyncMode = pick === 'synced' ? 'synced' : 'local';
      const keyList = typeof mirrorKeys === 'function' ? mirrorKeys() : mirrorKeys;
      if (pick === 'synced') {
        markLocalMirrorKeys(pluginId, keyList);
        await g.ThymerPluginSettings.flushNow(data, pluginId, keyList);
      }
      ui.addToaster?.({
        title: label,
        message: pick === 'synced' ? 'Settings will sync across devices.' : 'Settings stay on this device only.',
        dismissible: true,
        autoDestroyTime: 3500,
      });
    },
  };

  g.thymerExtEnsureMobileLoadGrace = ensureMobileLoadGraceStarted;
  g.thymerExtInMobileLoadGrace = inMobileLoadGrace;
  g.thymerExtShouldDeferPanelFooterWork = shouldDeferPanelFooterWork;
  g.thymerExtBumpMobileLoadGrace = bumpMobileLoadGrace;
  g.thymerExtPauseHeavyWorkQueue = pauseHeavyWorkQueue;
  g.thymerExtInstallMobileResumeGrace = installMobileResumeGraceListener;
  g.thymerExtInstallMobileInteractionGrace = installMobileInteractionGraceListener;
  g.thymerExtEnqueueHeavyWork = enqueueHeavyWork;
})(typeof globalThis !== 'undefined' ? globalThis : window);
// @generated END thymer-plugin-settings

const WM_PLUGIN_ID = 'weather-moon';
const WM_SETTINGS_KEY = 'weather_moon_settings_v1';
const WM_DAY_PINS_KEY = 'weather_moon_day_pins_v1';
const WM_DAY_PIN_MAX = 400;
const WM_RECENT_CITIES_MAX = 8;
const WM_PINNED_CITIES_MAX = 12;
const WM_CACHE_PREFIX = 'wm_wx_v3:';
const WM_MOON_SYNODIC = 29.530588853;
const WM_JD_EPOCH = 2451549.5;

// ─── Moon (client-side only) ─────────────────────────────────────────────────

function wmToJulian(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.getTime() / 86400000 + 2440587.5;
}

function wmMoonPhaseForDate(d) {
  const jd = wmToJulian(d);
  let days = (jd - WM_JD_EPOCH) % WM_MOON_SYNODIC;
  if (days < 0) days += WM_MOON_SYNODIC;
  const phase = days / WM_MOON_SYNODIC;
  const waxing = phase < 0.5;
  const illum = Math.round((1 - Math.cos(phase * 2 * Math.PI)) * 50);
  let name;
  if (phase < 0.03 || phase > 0.97) name = 'New moon';
  else if (phase < 0.22) name = waxing ? 'Waxing crescent' : 'Waning crescent';
  else if (phase < 0.28) name = 'First quarter';
  else if (phase < 0.47) name = waxing ? 'Waxing gibbous' : 'Waning gibbous';
  else if (phase < 0.53) name = 'Full moon';
  else if (phase < 0.72) name = 'Waning gibbous';
  else if (phase < 0.78) name = 'Last quarter';
  else name = 'Waning crescent';

  let daysToEvent;
  let eventLabel;
  if (waxing) {
    daysToEvent = Math.max(0, Math.round((0.5 - phase) * WM_MOON_SYNODIC));
    eventLabel = 'full';
  } else {
    daysToEvent = Math.max(0, Math.round((1 - phase) * WM_MOON_SYNODIC));
    eventLabel = 'new';
  }
  if (daysToEvent === 0) daysToEvent = 1;

  return { phase, illum, waxing, name, daysToEvent, eventLabel };
}

function wmMoonSvg(phase, size = 16) {
  const r = 8.5;
  const cx = 12;
  const cy = 12;
  const p = ((phase % 1) + 1) % 1;
  const illum = (1 - Math.cos(p * 2 * Math.PI)) / 2;
  const ring =
    `<circle cx="${cx}" cy="${cy}" r="${r + 0.55}" fill="none" stroke="#8E8E93" stroke-width="1.1" opacity="0.35"/>`;
  const lit = '#D1D1D6';

  if (illum >= 0.97) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
      `aria-hidden="true" class="wm-moon-svg" overflow="visible" shape-rendering="geometricPrecision">` +
      ring +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${lit}" opacity="0.98"/>` +
      `</svg>`
    );
  }
  if (illum <= 0.03) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
      `aria-hidden="true" class="wm-moon-svg" overflow="visible" shape-rendering="geometricPrecision">` +
      ring +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#8E8E93" stroke-width="1.15" opacity="0.65"/>` +
      `</svg>`
    );
  }

  const dx = -Math.cos(p * 2 * Math.PI) * r;
  const maskId = `wm-moon-${Math.round(p * 10000)}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `aria-hidden="true" class="wm-moon-svg" overflow="visible" shape-rendering="geometricPrecision">` +
    `<defs><mask id="${maskId}"><rect width="24" height="24" fill="white"/>` +
    `<circle cx="${(cx + dx).toFixed(2)}" cy="${cy}" r="${r + 0.35}" fill="black"/></mask></defs>` +
    ring +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${lit}" opacity="0.98" mask="url(#${maskId})"/>` +
    `</svg>`
  );
}

function wmMoonEventEmoji(eventLabel) {
  return eventLabel === 'full' ? '🌕' : '🌑';
}

function wmMoonEmoji(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.03 || p > 0.97) return '🌑';
  if (p < 0.22) return p < 0.5 ? '🌒' : '🌘';
  if (p < 0.28) return p < 0.5 ? '🌓' : '🌗';
  if (p < 0.47) return p < 0.5 ? '🌔' : '🌖';
  if (p < 0.53) return '🌕';
  if (p < 0.72) return '🌖';
  if (p < 0.78) return '🌗';
  return '🌘';
}

function wmMoonEmojiHtml(phase, size = 18) {
  const px = Math.max(14, Math.round(Number(size) || 18));
  return (
    `<span class="wm-moon-emoji" style="font-size:${px}px;line-height:1" aria-hidden="true">` +
    `${wmMoonEmoji(phase)}</span>`
  );
}

function wmFormatDisplayDate(dateKey) {
  return String(dateKey || '').replace(/-/g, '.');
}

const WM_WEATHER_EMOJI = {
  clear: '☀️',
  partly: '🌤️',
  cloud: '☁️',
  fog: '🌫️',
  drizzle: '🌦️',
  rain: '🌧️',
  showers: '🌦️',
  snow: '🌨️',
  storm: '⛈️',
};

function wmWeatherEmoji(kind) {
  return WM_WEATHER_EMOJI[kind] || '☁️';
}

function wmWeatherEmojiFromCode(code) {
  return wmWeatherEmoji(wmWeatherKind(code));
}

function wmWeatherIconHtml(kind, size = 18) {
  const px = Math.max(14, Math.round(Number(size) || 18));
  return (
    `<span class="wm-weather-emoji" style="font-size:${px}px;line-height:1" aria-hidden="true">` +
    `${wmWeatherEmoji(kind)}</span>`
  );
}

function wmWeatherIconFromCode(code, size = 18) {
  return wmWeatherIconHtml(wmWeatherKind(code), size);
}

function wmFormatSunTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return '—';
  }
}

function wmFormatPrecipPct(n, withDrop = false) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const pct = `${Math.round(Number(n))}%`;
  return withDrop ? `💧 ${pct}` : pct;
}

const WM_SUN_ICON = {
  base:
    '<path d="M4 17h16"/>' +
    '<path d="M8 17a4 4 0 0 1 8 0"/>' +
    '<path d="M6.2 14.2 5 13" stroke-dasharray="1.6 1.8"/>' +
    '<path d="M12 13.5V11.2" stroke-dasharray="1.6 1.8"/>' +
    '<path d="M17.8 14.2 19 13" stroke-dasharray="1.6 1.8"/>',
  rise: '<path d="M12 5.5v2.2"/><path d="m10.1 8.2 1.9-1.4 1.9 1.4"/>',
  set: '<path d="M12 8.3v2.2"/><path d="m10.1 8.2 1.9 1.4 1.9-1.4"/>',
};

function wmSunIcon(kind, size = 14) {
  const body = WM_SUN_ICON.base + (kind === 'sunset' ? WM_SUN_ICON.set : WM_SUN_ICON.rise);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `aria-hidden="true" class="wm-sun-ico" fill="none" stroke="currentColor" ` +
    `stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">${body}</svg>`
  );
}

function wmSunLine(sunrise, sunset) {
  if (!sunrise && !sunset) return '';
  const up = wmFormatSunTime(sunrise);
  const down = wmFormatSunTime(sunset);
  if (up === '—' && down === '—') return '';
  return `↑ ${up}  ↓ ${down}`;
}

function wmSunTimesHtml(sunrise, sunset) {
  if (!sunrise && !sunset) return '';
  const up = wmFormatSunTime(sunrise);
  const down = wmFormatSunTime(sunset);
  if (up === '—' && down === '—') return '';
  let html = '<span class="wm-sun-times">';
  if (up !== '—') {
    html += `<span class="wm-sun-slot">${wmSunIcon('sunrise', 14)}<span>${up}</span></span>`;
  }
  if (down !== '—') {
    html += `<span class="wm-sun-slot">${wmSunIcon('sunset', 14)}<span>${down}</span></span>`;
  }
  return html + '</span>';
}

// ─── Weather codes (WMO) ─────────────────────────────────────────────────────

function wmWeatherLabel(code) {
  const c = Number(code);
  if (c === 0) return 'Clear';
  if (c <= 3) return 'Partly cloudy';
  if (c <= 48) return 'Fog';
  if (c <= 55) return 'Drizzle';
  if (c <= 57) return 'Freezing drizzle';
  if (c <= 65) return 'Rain';
  if (c <= 67) return 'Freezing rain';
  if (c <= 77) return 'Snow';
  if (c <= 82) return 'Showers';
  if (c <= 86) return 'Snow showers';
  if (c >= 95) return 'Thunderstorm';
  return 'Cloudy';
}

function wmWeatherKind(code) {
  const c = Number(code);
  if (c === 0) return 'clear';
  if (c <= 3) return 'partly';
  if (c <= 48) return 'fog';
  if (c <= 57) return 'drizzle';
  if (c <= 67) return 'rain';
  if (c <= 77) return 'snow';
  if (c <= 82) return 'showers';
  if (c >= 95) return 'storm';
  return 'cloud';
}

function wmWeatherIconFromCode(code, size = 18) {
  return wmWeatherIconHtml(wmWeatherKind(code), size);
}

function wmDateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function wmTodayKey() {
  return wmDateKey(new Date());
}

/** Open-Meteo geocoding rejects many "City, ST" strings — try simpler queries too. */
function wmGeocodeQueries(raw) {
  const q = String(raw || '').trim();
  if (!q) return [];
  const out = [];
  const add = (s) => {
    const t = String(s || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(q);
  add(q.split(',')[0]);
  add(q.replace(/,.*$/, '').trim());
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 2) add(words.slice(0, 2).join(' '));
  return out;
}

async function wmGeocodeSearch(raw) {
  const queries = wmGeocodeQueries(raw);
  let lastErr = null;
  for (const name of queries) {
    try {
      const url =
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}` +
        `&count=8&language=en&format=json`;
      const r = await fetch(url);
      if (!r.ok) {
        lastErr = new Error(`Geocode HTTP ${r.status}`);
        continue;
      }
      const j = await r.json();
      if (Array.isArray(j.results) && j.results.length) {
        return { results: j.results, queryUsed: name };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return { results: [], queryUsed: queries[0] || String(raw || '').trim() };
}

function wmLocationFromGeocodeResult(it) {
  if (!it) return null;
  const admin = [it.admin1, it.country].filter(Boolean).join(', ');
  return {
    name: `${it.name}${admin ? `, ${admin}` : ''}`,
    latitude: it.latitude,
    longitude: it.longitude,
    timezone: it.timezone || 'auto',
  };
}

function wmFormatTemp(n, units) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Math.round(Number(n));
  return units === 'celsius' ? `${v}°C` : `${v}°F`;
}
function wmWindSpeedUnit(units) {
  return units === 'celsius' ? 'kmh' : 'mph';
}

function wmFormatWind(speed, units) {
  if (speed == null || Number.isNaN(Number(speed))) return '—';
  const v = Math.round(Number(speed));
  return units === 'celsius' ? `${v} km/h` : `${v} mph`;
}

function wmFormatHumidity(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Math.round(Number(n))}%`;
}

function wmIsNightAt(isoTime, sunrise, sunset) {
  if (!isoTime) return false;
  try {
    const t = new Date(isoTime).getTime();
    const sr = sunrise ? new Date(sunrise).getTime() : NaN;
    const ss = sunset ? new Date(sunset).getTime() : NaN;
    if (!Number.isNaN(sr) && !Number.isNaN(ss)) return t < sr || t >= ss;
    const h = new Date(isoTime).getHours();
    return h < 6 || h >= 20;
  } catch (_) {
    return false;
  }
}

function wmHourWeatherIcon(code, timeIso, sunrise, sunset, size = 18) {
  const kind = wmWeatherKind(code);
  if (wmIsNightAt(timeIso, sunrise, sunset)) {
    if (kind === 'clear') {
      const px = Math.max(14, Math.round(Number(size) || 18));
      return `<span class="wm-weather-emoji" style="font-size:${px}px;line-height:1" aria-hidden="true">🌙</span>`;
    }
    if (kind === 'partly') {
      const px = Math.max(14, Math.round(Number(size) || 18));
      return `<span class="wm-weather-emoji" style="font-size:${px}px;line-height:1" aria-hidden="true">☁️</span>`;
    }
  }
  return wmWeatherIconFromCode(code, size);
}

function wmSliceHourlyFromNow(hourly, count = 24) {
  const times = hourly?.time || [];
  if (!times.length) return [];
  const now = Date.now() - 30 * 60 * 1000;
  let start = 0;
  for (let i = 0; i < times.length; i++) {
    if (new Date(times[i]).getTime() >= now) {
      start = i;
      break;
    }
  }
  const out = [];
  for (let i = start; i < Math.min(start + count, times.length); i++) {
    out.push({
      time: times[i],
      temp: hourly.temperature_2m?.[i],
      code: hourly.weather_code?.[i],
      precip: hourly.precipitation_probability?.[i],
      precipMm: hourly.precipitation?.[i],
      humidity: hourly.relative_humidity_2m?.[i],
      wind: hourly.wind_speed_10m?.[i],
      feels: hourly.apparent_temperature?.[i],
    });
  }
  return out;
}

function wmFeelsLikeNote(temp, apparent, wind, units) {
  if (apparent == null || temp == null) return '';
  const diff = Math.round(Number(apparent) - Number(temp));
  if (Math.abs(diff) >= 3) {
    if (diff < 0) {
      return wind != null && Number(wind) >= 8
        ? 'Wind is making it feel cooler.'
        : 'Feels cooler than the actual temperature.';
    }
    return 'Feels warmer than the actual temperature.';
  }
  if (wind != null && Number(wind) >= 12) {
    return `Wind gusts up to ${Math.round(Number(wind))} ${units === 'celsius' ? 'km/h' : 'mph'}.`;
  }
  return '';
}

function wmConditionBlurb(bundle, units) {
  return wmWeatherInsights(bundle, units, { compact: true }).join(' ');
}

function wmPrecipInsight(bundle, hourly, daily, todayKey) {
  const rainCode = (c) => {
    const n = Number(c);
    return (n >= 51 && n <= 67) || n >= 80;
  };
  const now = Date.now();
  for (const h of hourly || []) {
    const t = new Date(h.time).getTime();
    if (t < now - 60000) continue;
    const p = Number(h.precip);
    const code = Number(h.code);
    const mm = Number(h.precipMm);
    if (!(p >= 20 || (rainCode(code) && p >= 10) || (!Number.isNaN(mm) && mm >= 0.05))) continue;
    const when = new Date(h.time);
    const isToday = wmDateKey(when) === todayKey;
    const name = wmWeatherLabel(code).toLowerCase();
    const timeStr = when.toLocaleTimeString([], { hour: 'numeric' });
    const pct = p >= 10 ? ` (${Math.round(p)}%)` : '';
    if (isToday) return `${name.charAt(0).toUpperCase() + name.slice(1)} likely around ${timeStr}${pct}.`;
    return `Next ${name} likely ${when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}${pct}.`;
  }
  for (let i = 1; i < (daily || []).length; i++) {
    const d = daily[i];
    if (Number(d.precip) >= 25) {
      const when = new Date(String(d.date) + 'T12:00:00');
      return `Next rain likely ${when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} (${Math.round(Number(d.precip))}%).`;
    }
  }
  const sum = Number(bundle?.precipSum);
  if (!Number.isNaN(sum) && sum >= 0.05) {
    return `About ${sum.toFixed(2)} in expected today.`;
  }
  return 'No significant precipitation expected in the next 10 days.';
}

function wmNextPrecipText(hourly, daily, todayKey) {
  return wmPrecipInsight({ precipSum: null }, hourly, daily, todayKey);
}

function wmWeatherInsights(bundle, units, opts = {}) {
  const { compact = false, hourly, daily, todayKey } = opts;
  const lines = [];
  const labelLower = String(bundle?.label || '').toLowerCase();
  const feel = wmFeelsLikeNote(bundle?.temp, bundle?.feelsLike, bundle?.wind, units);

  if (bundle?.isHistorical) {
    if (bundle.hi != null && bundle.lo != null) {
      const spread = Number(bundle.hi) - Number(bundle.lo);
      if (spread >= 12) {
        lines.push(`Temperatures ranged ${wmFormatTemp(bundle.lo, units)} to ${wmFormatTemp(bundle.hi, units)}.`);
      }
    }
    if (feel) lines.push(feel);
    return lines.slice(0, compact ? 1 : 2);
  }

  if (compact) {
    if (bundle?.timing) {
      lines.push(`${bundle.timing.charAt(0).toUpperCase()}${bundle.timing.slice(1)}.`);
    } else {
      const night = wmIsNightAt(new Date().toISOString(), bundle?.sunrise, bundle?.sunset);
      if (night && labelLower.includes('clear')) lines.push('Stays clear through the morning.');
      else if (night && labelLower.includes('partly')) lines.push('Clouds break up toward morning.');
    }
    if (feel && lines.length < 2) lines.push(feel);
    return lines.slice(0, 2);
  }

  const precipLine = wmPrecipInsight(bundle, hourly, daily, todayKey);
  if (precipLine) lines.push(precipLine);

  const night = wmIsNightAt(new Date().toISOString(), bundle?.sunrise, bundle?.sunset);
  if (night && (labelLower.includes('clear') || labelLower.includes('partly'))) {
    const sky = labelLower.includes('clear') ? 'Stays clear through the morning.' : 'Clouds break up toward morning.';
    if (!lines.some((l) => /morning/i.test(l))) lines.unshift(sky);
  }

  if (feel && lines.length < 2 && !lines.some((l) => /feel|wind/i.test(l))) lines.push(feel);

  if (!compact && bundle?.timing) {
    const t = `${bundle.timing.charAt(0).toUpperCase()}${bundle.timing.slice(1)}.`;
    if (!lines.some((l) => l.toLowerCase().includes(bundle.timing.toLowerCase().slice(0, 8)))) {
      lines.unshift(t);
    }
  }

  return lines.slice(0, 2);
}

function wmChartSamplePoints(hourly, count = 8) {
  const pts = (hourly || []).slice(0, 24);
  if (pts.length < 2) return pts;
  if (pts.length <= count) return pts;
  const out = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / (count - 1)) * (pts.length - 1));
    if (!out.length || out[out.length - 1].time !== pts[idx].time) out.push(pts[idx]);
  }
  return out;
}

function wmChartValueLabel(metric, value, units) {
  const v = Number(value);
  if (Number.isNaN(v)) return '—';
  if (metric === 'temp') return `${Math.round(v)}°`;
  if (metric === 'wind') return units === 'celsius' ? `${Math.round(v)}` : `${Math.round(v)}`;
  return `${Math.round(v)}%`;
}

function wmSparkChartSvg(hourly, metric, units) {
  const pts = wmChartSamplePoints(hourly, 8);
  if (pts.length < 2) return '';
  const W = 320;
  const H = 96;
  const pad = { t: 20, r: 8, b: 20, l: 8 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const values = pts.map((h) => {
    if (metric === 'temp') return Number(h.temp);
    if (metric === 'precip') return Number(h.precip) || 0;
    if (metric === 'wind') return Number(h.wind) || 0;
    return 0;
  });
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = maxV - minV || 1;
  const coords = values.map((v, i) => {
    const x = pad.l + (i / (values.length - 1)) * innerW;
    const y = pad.t + innerH - ((v - minV) / span) * innerH;
    return [x, y, v];
  });
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} L${coords[0][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;
  const colors = { temp: '#f5a623', precip: '#5ac8fa', wind: '#a78bfa' };
  const stroke = colors[metric] || '#888';
  const valueLabels = coords
    .map((c) => {
      const text = wmChartValueLabel(metric, c[2], units);
      return `<text x="${c[0].toFixed(1)}" y="${Math.max(11, c[1] - 6).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="currentColor" opacity="0.92">${text}</text>`;
    })
    .join('');
  const timeLabels = coords
    .map((c, i) => {
      const h = new Date(pts[i].time);
      const txt = i === 0 ? 'Now' : h.toLocaleTimeString([], { hour: 'numeric' });
      return `<text x="${c[0].toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="8" fill="currentColor" opacity="0.5">${txt}</text>`;
    })
    .join('');
  return (
    `<svg class="wm-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-hidden="true">` +
    `<path d="${area}" fill="${stroke}" opacity="0.2"/>` +
    `<path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    valueLabels +
    timeLabels +
    `</svg>`
  );
}


function wmNormalizeLoc(loc) {
  if (!loc) return null;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    name: String(loc.name || 'Location').trim() || 'Location',
    latitude: lat,
    longitude: lon,
    timezone: loc.timezone || 'auto',
  };
}

function wmLocKey(loc) {
  const n = wmNormalizeLoc(loc);
  if (!n) return '';
  return `${n.latitude.toFixed(4)},${n.longitude.toFixed(4)}`;
}

function wmDefaultPinStore() {
  return { v: 1, pins: {}, skipAutoPin: [] };
}

function wmJournalDateFromRecord(record) {
  if (!record) return null;
  try {
    const g = String(record.guid || '');
    const m = g.match(/(?:^|[-_:])(\d{4})(\d{2})(\d{2})$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      if (y >= 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return new Date(y, mo - 1, d);
      }
    }
  } catch (_) {}
  try {
    const jd = record.getJournalDetails?.()?.date;
    if (jd instanceof Date && !isNaN(jd.getTime())) {
      return new Date(jd.getFullYear(), jd.getMonth(), jd.getDate());
    }
  } catch (_) {}
  return null;
}

class Plugin extends AppPlugin {
  onLoad() {
    this._panelStates = new Map();
    this._eventIds = [];
    this._wxCache = new Map();
    this._fetchInflight = new Map();
    if (typeof super.onLoad === 'function') super.onLoad();
    this._statusItem = null;
    this._popoverEl = null;
    this._popoverSource = null;
    this._popoverContextDate = null;
    this._boundDocMouse = null;
    this._boundDocClick = null;
    this._boundDocKey = null;
    this._boundWinResize = null;
    this._boundWinScroll = null;
    this._lockObserver = null;
    this._cssInjected = false;
    this._settings = this._loadSettingsLocal();
    this._todayRefreshTimer = null;
    this._titleObserver = null;

    this._injectCss();
    this._subscribeEvents();

    (async () => {
      try {
        await (globalThis.ThymerPluginSettings?.init?.({
          plugin: this,
          pluginId: WM_PLUGIN_ID,
          modeKey: 'thymerext_ps_mode_weather-moon',
          mirrorKeys: () => [WM_SETTINGS_KEY],
          label: 'Weather & Moon',
          data: this.data,
          ui: this.ui,
        }) ?? Promise.resolve());
        await globalThis.ThymerPluginSettings?.registerPluginSlug?.(this.data, {
          slug: WM_PLUGIN_ID,
          label: 'Weather & Moon',
        });
        this._settings = this._loadSettingsLocal();
      } catch (e) {
        console.warn('[Weather & Moon] Plugin Backend init', e);
      }

      this._mountStatusBar();
      this._refreshTodayStatusBar();
      this._scheduleTodayRefresh();
      this._registerCommands();

      const panel = this.ui?.getActivePanel?.();
      if (panel) {
        setTimeout(() => this._handlePanel(panel), 400);
        setTimeout(() => this._handlePanel(panel), 1800);
      }
    })().catch((e) => console.warn('[Weather & Moon] onLoad', e));
  }

  _registerCommands() {
    try {
      this.ui.addCommandPaletteCommand({
        label: 'Weather & Moon: Configure',
        icon: 'ti-cloud',
        onSelected: () => this._openConfigureDialog(),
      });
      this.ui.addCommandPaletteCommand({
        label: 'Weather & Moon: Storage location…',
        icon: 'ti-database',
        onSelected: () => {
          globalThis.ThymerPluginSettings?.openStorageDialog?.({
            plugin: this,
            pluginId: WM_PLUGIN_ID,
            modeKey: 'thymerext_ps_mode_weather-moon',
            mirrorKeys: () => [WM_SETTINGS_KEY],
            label: 'Weather & Moon',
            data: this.data,
            ui: this.ui,
          });
        },
      });
      this.ui.addCommandPaletteCommand({
        label: 'Weather & Moon: Choose location for this journal day…',
        icon: 'ti-map-pin',
        onSelected: () => this._cmdChooseJournalDayLocation(),
      });
      this.ui.addCommandPaletteCommand({
        label: 'Weather & Moon: Apply current location to this journal day',
        icon: 'ti-location',
        onSelected: () => this._cmdApplyCurrentToJournalDay(),
      });
      this.ui.addCommandPaletteCommand({
        label: 'Weather & Moon: Clear location override for this journal day',
        icon: 'ti-map-pin-off',
        onSelected: () => this._cmdClearJournalDayLocation(),
      });
    } catch (e) {
      console.warn('[Weather & Moon] commands', e);
    }
  }

  onUnload() {
    for (const id of this._eventIds || []) {
      try {
        this.events.off(id);
      } catch (_) {}
    }
    this._eventIds = [];
    if (this._todayRefreshTimer) {
      clearInterval(this._todayRefreshTimer);
      this._todayRefreshTimer = null;
    }
    try {
      this._closePopover();
    } catch (_) {}
    try {
      this._removeDocListeners();
    } catch (_) {}
    if (this._panelStates) {
      for (const [, st] of this._panelStates) {
        try {
          st.titleObserver?.disconnect?.();
        } catch (_) {}
        try {
          st.titleCluster?.remove?.();
        } catch (_) {}
      }
      try {
        this._panelStates.clear();
      } catch (_) {}
    }
    try {
      this._statusItem?.remove?.();
    } catch (_) {}
    this._statusItem = null;
    try {
      this._wxCache?.clear?.();
    } catch (_) {}
    try {
      this._fetchInflight?.clear?.();
    } catch (_) {}
  }

  _loadSettingsLocal() {
    try {
      const raw = localStorage.getItem(WM_SETTINGS_KEY);
      if (raw) return { ...this._defaultSettings(), ...JSON.parse(raw) };
    } catch (_) {}
    return this._defaultSettings();
  }

  _defaultSettings() {
    return {
      locationName: '',
      latitude: null,
      longitude: null,
      units: 'fahrenheit',
      timezone: 'auto',
      recentCities: [],
      pinnedCities: [],
    };
  }

  async _saveSettings(next) {
    this._settings = { ...this._defaultSettings(), ...next };
    if (next.locationName != null || next.latitude != null) {
      const loc = this._globalLocation();
      if (loc) this._touchRecentCity(loc);
    }
    try {
      localStorage.setItem(WM_SETTINGS_KEY, JSON.stringify(this._settings));
    } catch (_) {}
    try {
      globalThis.ThymerPluginSettings?.scheduleFlush?.(this, [WM_SETTINGS_KEY]);
      if (this._pluginSettingsSyncMode === 'synced') {
        await globalThis.ThymerPluginSettings?.flushNow?.(this.data, WM_PLUGIN_ID, [WM_SETTINGS_KEY]);
      }
    } catch (e) {
      console.warn('[Weather & Moon] settings flush', e);
    }
    this._clearWeatherCache();
    this._refreshTodayStatusBar();
    if (this._panelStates) {
      for (const [, st] of this._panelStates) this._refreshPanelTitle(st);
    }
  }

  _hasLocation() {
    const lat = Number(this._settings?.latitude);
    const lon = Number(this._settings?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon);
  }

  _unitsParam() {
    return this._settings?.units === 'celsius' ? 'celsius' : 'fahrenheit';
  }

  _loadPinStore() {
    try {
      const raw = localStorage.getItem(WM_DAY_PINS_KEY);
      if (!raw) return wmDefaultPinStore();
      const parsed = JSON.parse(raw);
      return {
        v: 1,
        pins: parsed?.pins && typeof parsed.pins === 'object' ? parsed.pins : {},
        skipAutoPin: Array.isArray(parsed?.skipAutoPin) ? parsed.skipAutoPin : [],
      };
    } catch (_) {
      return wmDefaultPinStore();
    }
  }

  _savePinStore(store) {
    try {
      localStorage.setItem(WM_DAY_PINS_KEY, JSON.stringify(store));
    } catch (_) {}
  }

  _trimPinStore(store) {
    const keys = Object.keys(store.pins || {});
    if (keys.length <= WM_DAY_PIN_MAX) return store;
    keys.sort((a, b) => {
      const ta = Date.parse(store.pins[a]?.pinnedAt || 0) || 0;
      const tb = Date.parse(store.pins[b]?.pinnedAt || 0) || 0;
      return ta - tb;
    });
    const drop = keys.length - WM_DAY_PIN_MAX;
    for (let i = 0; i < drop; i++) delete store.pins[keys[i]];
    return store;
  }

  _getDayPin(dateKey) {
    if (!dateKey) return null;
    const pin = this._loadPinStore().pins?.[dateKey];
    return wmNormalizeLoc(pin);
  }

  _isDayPinSkipped(dateKey) {
    if (!dateKey) return false;
    return this._loadPinStore().skipAutoPin.includes(dateKey);
  }

  _setDayPin(dateKey, loc) {
    const normalized = wmNormalizeLoc(loc);
    if (!dateKey || !normalized) return false;
    const store = this._loadPinStore();
    store.pins[dateKey] = { ...normalized, pinnedAt: new Date().toISOString() };
    store.skipAutoPin = (store.skipAutoPin || []).filter((k) => k !== dateKey);
    this._savePinStore(this._trimPinStore(store));
    this._clearWeatherCache();
    return true;
  }

  _clearDayPin(dateKey) {
    if (!dateKey) return false;
    const store = this._loadPinStore();
    if (!store.pins?.[dateKey] && !store.skipAutoPin?.includes(dateKey)) return false;
    delete store.pins[dateKey];
    if (!store.skipAutoPin.includes(dateKey)) store.skipAutoPin.push(dateKey);
    this._savePinStore(store);
    this._clearWeatherCache();
    return true;
  }

  _maybeAutoPinDay(dateKey) {
    if (!dateKey || this._getDayPin(dateKey) || this._isDayPinSkipped(dateKey)) return;
    const global = this._globalLocation();
    if (!global) return;
    const store = this._loadPinStore();
    store.pins[dateKey] = { ...global, pinnedAt: new Date().toISOString() };
    this._savePinStore(this._trimPinStore(store));
  }

  _globalLocation() {
    return wmNormalizeLoc({
      name: this._settings?.locationName,
      latitude: this._settings?.latitude,
      longitude: this._settings?.longitude,
      timezone: this._settings?.timezone,
    });
  }

  _resolveLocationForDate(dateKey) {
    return this._getDayPin(dateKey) || this._globalLocation();
  }

  _hasLocationForDate(dateKey) {
    return !!this._resolveLocationForDate(dateKey);
  }

  _clearWeatherCache() {
    try {
      this._wxCache?.clear?.();
    } catch (_) {}
    try {
      const prefix = WM_CACHE_PREFIX;
      const drop = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(prefix)) drop.push(k);
      }
      for (const k of drop) sessionStorage.removeItem(k);
    } catch (_) {}
  }

  _touchRecentCity(loc) {
    const normalized = wmNormalizeLoc(loc);
    if (!normalized) return;
    const key = wmLocKey(normalized);
    let recent = Array.isArray(this._settings.recentCities) ? [...this._settings.recentCities] : [];
    recent = recent.filter((c) => wmLocKey(c) !== key);
    recent.unshift(normalized);
    recent = recent.slice(0, WM_RECENT_CITIES_MAX);
    this._settings = { ...this._settings, recentCities: recent };
    try {
      localStorage.setItem(WM_SETTINGS_KEY, JSON.stringify(this._settings));
    } catch (_) {}
    try {
      globalThis.ThymerPluginSettings?.scheduleFlush?.(this, [WM_SETTINGS_KEY]);
    } catch (_) {}
  }

  _togglePinnedCity(loc) {
    const normalized = wmNormalizeLoc(loc);
    if (!normalized) return false;
    const key = wmLocKey(normalized);
    let pinned = Array.isArray(this._settings.pinnedCities) ? [...this._settings.pinnedCities] : [];
    const idx = pinned.findIndex((c) => wmLocKey(c) === key);
    if (idx >= 0) pinned.splice(idx, 1);
    else {
      pinned.unshift(normalized);
      pinned = pinned.slice(0, WM_PINNED_CITIES_MAX);
    }
    this._settings = { ...this._settings, pinnedCities: pinned };
    try {
      localStorage.setItem(WM_SETTINGS_KEY, JSON.stringify(this._settings));
    } catch (_) {}
    try {
      globalThis.ThymerPluginSettings?.scheduleFlush?.(this, [WM_SETTINGS_KEY]);
    } catch (_) {}
    return idx < 0;
  }

  _isPinnedCity(loc) {
    const key = wmLocKey(loc);
    if (!key) return false;
    return (this._settings.pinnedCities || []).some((c) => wmLocKey(c) === key);
  }

  _getActiveJournalState() {
    try {
      const panel = this.ui?.getActivePanel?.();
      const panelId = panel?.getId?.();
      if (!panelId) return null;
      const panelEl = panel?.getElement?.();
      const record = panel?.getActiveRecord?.();
      if (!this._isJournalRecord(record, panelEl)) return null;
      let state = this._panelStates?.get(panelId);
      if (state?.journalDateKey) return state;
      const journalDate = wmJournalDateFromRecord(record) || new Date();
      return {
        panelId,
        panel,
        journalDate,
        journalDateKey: wmDateKey(journalDate),
      };
    } catch (_) {
      return null;
    }
  }

  _refreshJournalPanel(dateKey) {
    if (!dateKey || !this._panelStates) return;
    for (const [, st] of this._panelStates) {
      if (st.journalDateKey === dateKey) this._refreshPanelTitle(st);
    }
  }

  _cacheGet(key) {
    if (this._wxCache.has(key)) return this._wxCache.get(key);
    try {
      const raw = sessionStorage.getItem(WM_CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.exp && Date.now() > parsed.exp) return null;
      this._wxCache.set(key, parsed.data);
      return parsed.data;
    } catch (_) {
      return null;
    }
  }

  _cacheSet(key, data, ttlMs) {
    this._wxCache.set(key, data);
    try {
      sessionStorage.setItem(
        WM_CACHE_PREFIX + key,
        JSON.stringify({ exp: Date.now() + ttlMs, data })
      );
    } catch (_) {}
  }

  async _fetchWeatherBundle(dateKey, opts = {}) {
    const useGlobal = opts.useGlobal === true;
    const loc = useGlobal ? this._globalLocation() : this._resolveLocationForDate(dateKey);
    if (!loc) return null;
    const lat = loc.latitude;
    const lon = loc.longitude;
    const units = this._unitsParam();
    const tz = encodeURIComponent(loc.timezone || 'auto');
    const cacheKey = `${lat},${lon},${units},${dateKey}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    if (this._fetchInflight.has(cacheKey)) return this._fetchInflight.get(cacheKey);

    const today = wmTodayKey();
    const p = (async () => {
      try {
        let bundle;
        if (dateKey === today) {
          bundle = await this._fetchForecastToday(lat, lon, units, tz);
        } else if (dateKey < today) {
          bundle = await this._fetchArchiveDay(lat, lon, units, tz, dateKey);
        } else {
          bundle = await this._fetchForecastDay(lat, lon, units, tz, dateKey);
        }
        if (bundle) {
          const ttl = dateKey === today ? 15 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
          this._cacheSet(cacheKey, bundle, ttl);
        }
        return bundle;
      } finally {
        this._fetchInflight.delete(cacheKey);
      }
    })();
    this._fetchInflight.set(cacheKey, p);
    return p;
  }

  async _fetchForecastToday(lat, lon, units, tz) {
    const wu = wmWindSpeedUnit(units);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,apparent_temperature` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset` +
      `&hourly=weather_code,temperature_2m,precipitation_probability,precipitation,relative_humidity_2m,wind_speed_10m,apparent_temperature&timezone=${tz}` +
      `&forecast_days=10&past_days=0&temperature_unit=${units}&precipitation_unit=inch&wind_speed_unit=${wu}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    const j = await r.json();
    const cur = j.current || {};
    const daily = j.daily || {};
    const hourly = j.hourly || {};
    const hi = daily.temperature_2m_max?.[0];
    const lo = daily.temperature_2m_min?.[0];
    const code = cur.weather_code ?? daily.weather_code?.[0];
    const precip = daily.precipitation_probability_max?.[0];
    const timing = this._precipTimingLine(hourly.time, hourly.precipitation_probability, hourly.weather_code);
    const days = (daily.time || []).slice(0, 10).map((t, i) => ({
      date: t,
      hi: daily.temperature_2m_max?.[i],
      lo: daily.temperature_2m_min?.[i],
      code: daily.weather_code?.[i],
      precip: daily.precipitation_probability_max?.[i],
    }));
    const hourlyFromNow = wmSliceHourlyFromNow(hourly, 48);
    return {
      dateKey: wmTodayKey(),
      temp: cur.temperature_2m,
      hi,
      lo,
      code,
      precip,
      precipSum: daily.precipitation_sum?.[0],
      humidity: cur.relative_humidity_2m,
      wind: cur.wind_speed_10m,
      feelsLike: cur.apparent_temperature,
      label: wmWeatherLabel(code),
      kind: wmWeatherKind(code),
      timing,
      sunrise: daily.sunrise?.[0] || null,
      sunset: daily.sunset?.[0] || null,
      hourly: hourlyFromNow.length ? hourlyFromNow : this._sliceHourly(hourly, 0, 24),
      hourlyChart: hourlyFromNow.length ? hourlyFromNow : this._sliceHourly(hourly, 0, 48),
      daily: days,
      isHistorical: false,
    };
  }

  async _fetchForecastDay(lat, lon, units, tz, dateKey) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
      `&hourly=weather_code,temperature_2m,precipitation_probability&timezone=${tz}` +
      `&start_date=${dateKey}&end_date=${dateKey}&temperature_unit=${units}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    const j = await r.json();
    const daily = j.daily || {};
    const hourly = j.hourly || {};
    const code = daily.weather_code?.[0];
    return {
      dateKey,
      temp: daily.temperature_2m_max?.[0],
      hi: daily.temperature_2m_max?.[0],
      lo: daily.temperature_2m_min?.[0],
      code,
      precip: daily.precipitation_probability_max?.[0],
      label: wmWeatherLabel(code),
      kind: wmWeatherKind(code),
      timing: this._precipTimingLine(hourly.time, hourly.precipitation_probability, hourly.weather_code),
      sunrise: daily.sunrise?.[0] || null,
      sunset: daily.sunset?.[0] || null,
      hourly: this._sliceHourly(hourly, 0, 24),
      daily: [],
      isHistorical: false,
    };
  }

  async _fetchArchiveDay(lat, lon, units, tz, dateKey) {
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=${dateKey}&end_date=${dateKey}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset` +
      `&timezone=${tz}&temperature_unit=${units}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Archive ${r.status}`);
    const j = await r.json();
    const daily = j.daily || {};
    const code = daily.weather_code?.[0];
    const hi = daily.temperature_2m_max?.[0];
    const lo = daily.temperature_2m_min?.[0];
    return {
      dateKey,
      temp: hi,
      hi,
      lo,
      code,
      precip: null,
      label: wmWeatherLabel(code),
      kind: wmWeatherKind(code),
      timing: null,
      sunrise: daily.sunrise?.[0] || null,
      sunset: daily.sunset?.[0] || null,
      hourly: [],
      daily: [],
      isHistorical: true,
    };
  }

  _sliceHourly(hourly, start, count) {
    const out = [];
    const times = hourly?.time || [];
    for (let i = start; i < Math.min(start + count, times.length); i++) {
      out.push({
        time: times[i],
        temp: hourly.temperature_2m?.[i],
        code: hourly.weather_code?.[i],
        precip: hourly.precipitation_probability?.[i],
        precipMm: hourly.precipitation?.[i],
        humidity: hourly.relative_humidity_2m?.[i],
        wind: hourly.wind_speed_10m?.[i],
        feels: hourly.apparent_temperature?.[i],
      });
    }
    return out;
  }

  _isFullForecastSource(source) {
    return source === 'status';
  }

  _popoverHeadConditionHtml(bundle, isToday, units) {
    const daily0 = bundle.daily?.[0];
    const dayLabel = daily0 ? wmWeatherLabel(daily0.code) : bundle.label;
    let cond = this._escapeHtml(dayLabel || bundle.label || '—');
    if (isToday && !bundle.isHistorical && bundle.label && dayLabel && dayLabel !== bundle.label) {
      cond += `<span class="wm-head-now"> · now ${this._escapeHtml(String(bundle.label).toLowerCase())}</span>`;
    }
    return cond;
  }

  _popoverHeadIconKind(bundle, isToday) {
    const daily0 = bundle.daily?.[0];
    if (isToday && daily0?.code != null) return wmWeatherKind(daily0.code);
    return bundle.kind;
  }

  _appendPopoverMoon(card, moon) {
    const mRow = document.createElement('div');
    mRow.className = 'wm-moon-row wm-detail-line';
    mRow.innerHTML =
      `${wmMoonEmojiHtml(moon.phase, 16)}` +
      `<span>${this._escapeHtml(moon.name)} · ${moon.illum}% · ${moon.daysToEvent}d → ${wmMoonEventEmoji(moon.eventLabel)}</span>`;
    card.appendChild(mRow);
  }

  _appendPopoverHourly(card, bundle, units) {
    if (!bundle.hourly?.length || bundle.isHistorical) return;
    const lab = document.createElement('div');
    lab.className = 'wm-section-label';
    lab.textContent = 'Hourly';
    card.appendChild(lab);
    const row = document.createElement('div');
    row.className = 'wm-hourly';
    for (const h of bundle.hourly.slice(0, 18)) {
      const cell = document.createElement('div');
      cell.className = 'wm-hour';
      const hr = new Date(h.time);
      const label = hr.toLocaleTimeString([], { hour: 'numeric' });
      const pPct = wmFormatPrecipPct(h.precip, true) || '💧 0%';
      cell.innerHTML =
        `<div>${wmHourWeatherIcon(h.code, h.time, bundle.sunrise, bundle.sunset, 18)}</div>` +
        `<div class="wm-hour-t">${this._escapeHtml(label)}</div>` +
        `<div class="wm-hour-t">${wmFormatTemp(h.temp, units)}</div>` +
        `<div class="wm-hour-p">${pPct}</div>`;
      row.appendChild(cell);
    }
    card.appendChild(row);
  }

  _appendPopoverExpandSection(card, bundle, units, useGlobalWx) {
    const wrap = document.createElement('div');
    wrap.className = 'wm-expand-section';
    let chartCtrl = null;
    if (!bundle.isHistorical) {
      chartCtrl = this._appendWeatherCharts(wrap, bundle, units);
    }
    if (bundle.daily?.length) {
      this._appendDailyTiles(wrap, bundle, units, useGlobalWx, chartCtrl);
    }
    if (wrap.childNodes.length) card.appendChild(wrap);
    return wrap.childNodes.length > 0;
  }

  _appendExpandToggle(card, positionFn, show) {
    if (!show) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wm-expand-btn wm-detail-line';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      `<span class="wm-expand-label">More forecast</span>` +
      `<span class="wm-expand-chevron" aria-hidden="true">▾</span>`;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const open = card.classList.toggle('wm-card--expanded');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.querySelector('.wm-expand-label').textContent = open ? 'Less' : 'More forecast';
      try {
        positionFn?.();
      } catch (_) {}
    });
    card.appendChild(btn);
  }

  async _mergeTodayDashboard(bundle, targetKey, useGlobalWx) {
    if (!bundle || targetKey !== wmTodayKey()) return bundle;
    let next = await this._ensureTodayDashboard(bundle, targetKey, { useGlobal: useGlobalWx });
    try {
      const todayFull = await this._fetchWeatherBundle(wmTodayKey(), { useGlobal: useGlobalWx });
      if (todayFull) {
        if (todayFull.daily?.length) next.daily = todayFull.daily;
        if (todayFull.hourly?.length) next.hourly = todayFull.hourly;
        if (todayFull.hourlyChart?.length) next.hourlyChart = todayFull.hourlyChart;
        if (todayFull.timing) next.timing = todayFull.timing;
        if (todayFull.humidity != null) next.humidity = todayFull.humidity;
        if (todayFull.wind != null) next.wind = todayFull.wind;
        if (todayFull.feelsLike != null) next.feelsLike = todayFull.feelsLike;
        if (todayFull.precipSum != null) next.precipSum = todayFull.precipSum;
      }
    } catch (_) {}
    return next;
  }

  _statusBarVisible() {
    try {
      const el = this._statusItem?.getElement?.();
      return !!(el && el.isConnected && el.offsetParent !== null);
    } catch (_) {
      return false;
    }
  }

  async _ensureTodayDashboard(bundle, targetKey, opts = {}) {
    if (!bundle || targetKey !== wmTodayKey()) return bundle;
    if (Array.isArray(bundle.daily) && bundle.daily.length >= 7) return bundle;
    const loc = opts.useGlobal ? this._globalLocation() : this._resolveLocationForDate(targetKey);
    if (!loc) return bundle;
    const lat = loc.latitude;
    const lon = loc.longitude;
    const units = this._unitsParam();
    const cacheKey = `${lat},${lon},${units},${targetKey}`;
    try {
      this._wxCache.delete(cacheKey);
      sessionStorage.removeItem(WM_CACHE_PREFIX + cacheKey);
    } catch (_) {}
    return (await this._fetchWeatherBundle(targetKey, opts)) || bundle;
  }

  _appendMetricsRow(card, bundle, units) {
    if (bundle.humidity == null && bundle.wind == null && bundle.feelsLike == null) return;
    const row = document.createElement('div');
    row.className = 'wm-metrics wm-detail-line';
    const bits = [];
    if (bundle.feelsLike != null) bits.push(`Feels ${wmFormatTemp(bundle.feelsLike, units)}`);
    if (bundle.humidity != null) bits.push(`Humidity ${wmFormatHumidity(bundle.humidity)}`);
    if (bundle.wind != null) bits.push(`Wind ${wmFormatWind(bundle.wind, units)}`);
    row.textContent = bits.join(' · ');
    card.appendChild(row);
  }

  _appendBlurb(card, text, className = 'wm-blurb wm-detail-line') {
    const t = String(text || '').trim();
    if (!t) return;
    const el = document.createElement('div');
    el.className = className;
    el.textContent = t;
    card.appendChild(el);
  }

  _appendInsights(card, bundle, units, opts = {}) {
    const lines = wmWeatherInsights(bundle, units, opts);
    const cls = opts.compact ? 'wm-blurb wm-blurb--compact wm-detail-line' : 'wm-blurb wm-detail-line';
    for (const line of lines) this._appendBlurb(card, line, cls);
  }

  _appendWeatherCharts(host, bundle, units) {
    const chartData = bundle.hourlyChart || bundle.hourly;
    if (!chartData?.length || bundle.isHistorical) return null;
    const wrap = document.createElement('div');
    wrap.className = 'wm-charts';
    const tabs = document.createElement('div');
    tabs.className = 'wm-chart-tabs';
    const pane = document.createElement('div');
    pane.className = 'wm-chart-pane';
    const defs = [
      ['temp', 'Temperature'],
      ['precip', 'Precipitation'],
      ['wind', 'Wind'],
    ];
    let active = 'temp';
    let series = chartData;
    const render = () => {
      pane.innerHTML = wmSparkChartSvg(series, active, units);
    };
    for (const [id, label] of defs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wm-chart-tab' + (id === active ? ' is-active' : '');
      btn.textContent = label;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        active = id;
        tabs.querySelectorAll('.wm-chart-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
        render();
      });
      tabs.appendChild(btn);
    }
    render();
    wrap.appendChild(tabs);
    wrap.appendChild(pane);
    host.appendChild(wrap);
    return {
      setChartData(data) {
        series = data?.length ? data : chartData;
        render();
      },
    };
  }

  _appendDailyTiles(host, bundle, units, useGlobalWx, chartCtrl) {
    if (!bundle.daily?.length) return;
    const lab = document.createElement('div');
    lab.className = 'wm-section-label';
    lab.textContent = '10-day';
    host.appendChild(lab);

    const strip = document.createElement('div');
    strip.className = 'wm-daily-strip';

    const detail = document.createElement('div');
    detail.className = 'wm-daily-detail wm-detail-line';
    detail.style.setProperty('--wm-text-indent', '0px');

    const formatDetail = (d, idx) => {
      const label = wmWeatherLabel(d.code);
      const precip = wmFormatPrecipPct(d.precip, true);
      const dayNote = idx === 0 && d.date === wmTodayKey() ? ' · day overall' : '';
      return `${label}${dayNote}${precip ? ` · ${precip}` : ''} · ${wmFormatTemp(d.hi, units)} / ${wmFormatTemp(d.lo, units)}`;
    };

    let activeIdx = 0;
    const selectTile = async (idx) => {
      activeIdx = idx;
      strip.querySelectorAll('.wm-daily-tile').forEach((el, i) => {
        el.classList.toggle('is-active', i === idx);
      });
      const d = bundle.daily[idx];
      detail.textContent = formatDetail(d, idx);
      if (!chartCtrl) return;
      const today = wmTodayKey();
      if (d.date === today || idx === 0) {
        chartCtrl.setChartData(bundle.hourlyChart || bundle.hourly);
        return;
      }
      detail.textContent = `${formatDetail(d, idx)} · loading chart…`;
      try {
        const dayBundle = await this._fetchWeatherBundle(d.date, { useGlobal: useGlobalWx });
        chartCtrl.setChartData(dayBundle?.hourly?.length ? dayBundle.hourly : []);
        detail.textContent = formatDetail(d, idx);
      } catch (_) {
        detail.textContent = formatDetail(d, idx);
      }
    };

    bundle.daily.forEach((d, i) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'wm-daily-tile' + (i === 0 ? ' is-active' : '');
      const dow = new Date(d.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
      tile.innerHTML =
        `<span class="wm-daily-tile-dow">${this._escapeHtml(dow)}</span>` +
        `<span class="wm-daily-tile-ico">${wmWeatherIconFromCode(d.code, 20)}</span>` +
        `<span class="wm-daily-tile-hi">${wmFormatTemp(d.hi, units)}</span>` +
        `<span class="wm-daily-tile-lo">${wmFormatTemp(d.lo, units)}</span>`;
      tile.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void selectTile(i);
      });
      strip.appendChild(tile);
    });

    detail.textContent = formatDetail(bundle.daily[0], 0);
    host.appendChild(strip);
    host.appendChild(detail);
  }

  _precipTimingLine(times, precipArr, codeArr) {
    if (!Array.isArray(times) || !times.length) return null;
    const now = Date.now();
    const todayKey = wmTodayKey();
    const rainCode = (code) => {
      const c = Number(code);
      return (c >= 51 && c <= 67) || c >= 80;
    };
    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i]).getTime();
      if (t < now - 3600000) continue;
      if (wmDateKey(new Date(times[i])) !== todayKey) continue;
      const p = Number(precipArr?.[i]);
      const code = Number(codeArr?.[i]);
      // Open-Meteo often assigns drizzle/rain codes while precip % stays low — trust probability.
      if (!(p >= 30 || (rainCode(code) && p >= 20))) continue;
      const mins = Math.max(0, Math.round((t - now) / 60000));
      const label = wmWeatherLabel(code).toLowerCase();
      if (mins <= 5) return `${label} now`;
      if (mins < 90) return `${label} in ~${mins} min`;
      const when = new Date(times[i]).toLocaleTimeString([], { hour: 'numeric' });
      return `${label} around ${when}`;
    }
    return null;
  }

  _moonSummaryLine(date) {
    const m = wmMoonPhaseForDate(date);
    const d = m.daysToEvent;
    const unit = d === 1 ? 'day' : 'days';
    return `${d}${unit[0]} to ${m.eventLabel}`;
  }

  _statusReadoutHtml(bundle, date = new Date()) {
    if (!this._hasLocation()) {
      return '<span class="wm-status-readout wm-status-readout--muted">Weather — configure</span>';
    }
    if (!bundle) {
      return '<span class="wm-status-readout wm-status-readout--muted">Weather…</span>';
    }
    const moon = wmMoonPhaseForDate(date);
    const hi = wmFormatTemp(bundle.hi, this._settings.units);
    const lo = wmFormatTemp(bundle.lo, this._settings.units);
    const cond = (bundle.label || '—').toLowerCase();
    const moonBit = `${moon.daysToEvent}d → ${wmMoonEventEmoji(moon.eventLabel)}`;
    return (
      `<span class="wm-status-readout">` +
      `<span class="wm-status-temps">${hi}<span class="wm-status-sep"> / </span>${lo}</span>` +
      `<span class="wm-status-dot">·</span>` +
      `<span class="wm-status-cond">${this._escapeHtml(cond)}</span>` +
      `<span class="wm-status-dot">·</span>` +
      `<span class="wm-status-moon">${this._escapeHtml(moonBit)}</span>` +
      `</span>`
    );
  }

  _escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async _refreshTodayStatusBar() {
    if (!this._statusItem) return;
    let bundle = null;
    if (this._hasLocation()) {
      try {
        bundle = await this._fetchWeatherBundle(wmTodayKey(), { useGlobal: true });
      } catch (e) {
        console.warn('[Weather & Moon] today fetch', e);
      }
    }
    try {
      const sunTip = bundle ? wmSunLine(bundle.sunrise, bundle.sunset) : '';
      this._statusItem.setHtmlLabel?.(this._statusReadoutHtml(bundle));
      this._statusItem.setTooltip?.(
        bundle
          ? `Weather — ${bundle.label}${sunTip ? ` · ${sunTip}` : ''}; click for forecast`
          : 'Weather & Moon — click to configure'
      );
    } catch (_) {}
  }

  _scheduleTodayRefresh() {
    if (this._todayRefreshTimer) clearInterval(this._todayRefreshTimer);
    this._todayRefreshTimer = setInterval(() => this._refreshTodayStatusBar(), 30 * 60 * 1000);
  }

  _mountStatusBar() {
    if (typeof this.ui?.addStatusBarItem !== 'function') return;
    try {
      this._statusItem = this.ui.addStatusBarItem({
        htmlLabel: this._statusReadoutHtml(null),
        tooltip: 'Weather & Moon',
        onClick: () =>
          this._togglePopover('status', this._statusItem?.getElement?.(), wmTodayKey()),
      });
    } catch (e) {
      console.warn('[Weather & Moon] status bar', e);
      return;
    }
    setTimeout(() => this._moveStatusToEnd(), 800);
  }

  _moveStatusToEnd() {
    try {
      const el = this._statusItem?.getElement?.();
      const p = el?.parentNode;
      if (el && p && p.lastElementChild !== el) p.appendChild(el);
    } catch (_) {}
  }

  _subscribeEvents() {
    const onPanel = (ev) => {
      const delay = ev?.type === 'panel.navigated' ? 450 : 80;
      setTimeout(() => this._handlePanel(ev?.panel), delay);
    };
    try {
      this._eventIds.push(this.events.on('panel.navigated', onPanel));
      this._eventIds.push(this.events.on('panel.focused', onPanel));
      this._eventIds.push(this.events.on('panel.closed', (ev) => this._disposePanel(ev?.panel?.getId?.())));
    } catch (_) {}
  }

  _isJournalRecord(record, panelEl) {
    if (!record && !panelEl) return false;
    try {
      const d = record?.getJournalDetails?.()?.date;
      if (d instanceof Date && !isNaN(d.getTime())) return true;
    } catch (_) {}
    try {
      const collName = String(record?.getCollection?.()?.getName?.() || '').trim();
      const title = String(record?.getName?.() || '').trim();
      const g = String(record?.guid || '');
      if (/journal/i.test(g) && /(?:^|[-_:])\d{8}$/.test(g)) return true;
      const looksLikeJournalCollection = /^(journal|journal pages?|daily|to\.?day)$/i.test(collName);
      const looksLikeDateTitle =
        /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Z][a-z]{2}\s+\d{1,2}$/.test(title) ||
        /^\d{4}-\d{2}-\d{2}$/.test(title);
      const guidHasDateSuffix = /(?:^|[-_:])\d{8}$/.test(g);
      if (looksLikeJournalCollection && (looksLikeDateTitle || guidHasDateSuffix)) return true;
      if (/^daily$/i.test(collName)) return true;
      if (looksLikeDateTitle && panelEl) {
        const scope = panelEl.closest?.('.panel') || panelEl;
        if (scope?.querySelector?.('h1.id--h1, input#h1-edit')) return true;
      }
    } catch (_) {}
    return false;
  }

  _getPanelTitleScopes(panelEl, container) {
    const scopes = [];
    const add = (el) => {
      if (el && !scopes.includes(el)) scopes.push(el);
    };
    add(panelEl?.closest?.('.panel.has-focus'));
    add(panelEl?.closest?.('.panel'));
    add(panelEl?.closest?.('.panel-bar'));
    add(panelEl);
    add(container);
    try {
      const focused = document.querySelector('.panel.has-focus');
      add(focused);
    } catch (_) {}
    let node = panelEl;
    for (let i = 0; i < 8 && node; i++) {
      add(node);
      node = node.parentElement;
    }
    return scopes;
  }

  _isVisibleTitleEl(el) {
    try {
      if (!el?.isConnected) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) {
      return true;
    }
  }

  _pickBestTitleCandidate(nodes, expected) {
    const list = Array.isArray(nodes) ? nodes : [];
    const visible = list.filter((el) => !this._shouldSkipTitleNode(el) && this._isVisibleTitleEl(el));
    if (!visible.length) return null;
    for (let i = visible.length - 1; i >= 0; i--) {
      if (this._titleMatchesRecord(visible[i], expected)) return visible[i];
    }
    return visible[visible.length - 1];
  }

  /** Prefer the last match — Thymer may leave stale layers after journal navigation. */
  _findContainer(panelEl) {
    if (!panelEl) return null;
    for (const sel of [
      '.panel-body',
      '.panel-heading',
      '.panel-bar',
      '.page-content',
      '.editor-wrapper',
      '.editor-panel',
      '#editor',
    ]) {
      if (panelEl.matches?.(sel)) return panelEl;
      const all = panelEl.querySelectorAll?.(sel);
      if (all && all.length) return all[all.length - 1];
    }
    try {
      if (panelEl.matches?.('.panel, .panel-normal, [class*="panel-"]')) return panelEl;
    } catch (_) {}
    return panelEl;
  }

  _titleText(el) {
    if (!el) return '';
    try {
      if ('value' in el && el.value != null && String(el.value).trim()) return String(el.value).trim();
    } catch (_) {}
    return String(el.textContent || '').trim();
  }

  _shouldSkipTitleNode(el) {
    return (
      !el ||
      el.closest?.('.wm-title-cluster, .jhs-shell, .tn-footer, .ht-sidebar, .wm-shell, .banner-container') ||
      el.classList?.contains?.('wm-title-cluster')
    );
  }

  _titleMatchesRecord(el, expected) {
    const text = this._titleText(el);
    if (!text) return false;
    if (!expected) return true;
    if (text === expected) return true;
    return text.length < 80 && (text.includes(expected) || expected.includes(text));
  }

  /**
   * Thymer journal titles: h1.title.id--h1 (view) or input#h1-edit.heading-title (edit).
   * Parent row is usually a flex container inside .id--h1-area / .panel-body.
   */
  _findJournalTitleEl(container, record, panelEl) {
    const expected = String(record?.getName?.() || '').trim();
    const scopes = this._getPanelTitleScopes(panelEl, container);
    if (!scopes.length) return null;

    const thymerSelectors = [
      'h1.title.id--h1',
      'h1.id--h1',
      '.id--h1-area h1.title',
      'input#h1-edit.heading-title',
      'input.heading-title',
      'h1.title',
      'h1',
    ];

    for (const sel of thymerSelectors) {
      const found = [];
      for (const scope of scopes) {
        try {
          found.push(...scope.querySelectorAll(sel));
        } catch (_) {}
      }
      const pick = this._pickBestTitleCandidate(found, expected);
      if (pick) return pick;
    }
    return null;
  }

  _findTitleMountParent(titleEl) {
    if (!titleEl?.parentElement) return null;
    const parent = titleEl.parentElement;
    try {
      if (parent.closest?.('.id--h1-area') || parent.querySelector?.('h1.id--h1, input#h1-edit')) {
        return parent;
      }
    } catch (_) {}
    return parent;
  }

  _handlePanel(panel) {
    const panelId = panel?.getId?.();
    if (!panelId) return;
    const panelEl = panel?.getElement?.();
    const record = panel?.getActiveRecord?.();
    if (!this._isJournalRecord(record, panelEl)) {
      this._disposePanel(panelId);
      return;
    }
    const container = this._findContainer(panelEl);
    if (!panelEl) return;

    let state = this._panelStates.get(panelId);
    if (!state) {
      state = {
        panelId,
        panel,
        container,
        titleEl: null,
        titleCluster: null,
        titleObserver: null,
        titleAnchorObserver: null,
        journalDate: null,
        journalDateKey: null,
      };
      this._panelStates.set(panelId, state);
    }
    state.panel = panel;
    state.container = container || panelEl;
    state.journalDate = wmJournalDateFromRecord(record) || new Date();
    state.journalDateKey = wmDateKey(state.journalDate);

    this._mountTitleCluster(state, record, panelEl);
    this._ensureTitleAnchorObserver(state, panelEl, record);
  }

  _ensureTitleAnchorObserver(state, panelEl, record) {
    if (!state || state.titleAnchorObserver) return;
    const panelRoot = panelEl?.closest?.('.panel') || panelEl;
    if (!panelRoot) return;

    const sync = () => {
      if (!this._panelStates.has(state.panelId)) return;
      const activeRecord = state.panel?.getActiveRecord?.();
      if (!this._isJournalRecord(activeRecord, panelRoot)) return;

      let titleEl = state.titleEl;
      if (!titleEl?.isConnected) {
        titleEl = this._findJournalTitleEl(state.container, activeRecord, panelRoot);
        state.titleEl = titleEl;
      }
      if (!titleEl) return;

      const clusterOk =
        state.titleCluster?.isConnected && state.titleCluster.nextElementSibling === titleEl;
      if (!clusterOk) {
        this._mountTitleCluster(state, activeRecord, panelRoot);
      }
    };

    state.titleAnchorObserver = new MutationObserver(() => {
      try {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(sync);
        else sync();
      } catch (_) {
        sync();
      }
    });
    try {
      state.titleAnchorObserver.observe(panelRoot, { childList: true, subtree: true });
    } catch (_) {}
    sync();
  }

  _mountTitleCluster(state, record, panelEl) {
    const container = state.container;
    const titleEl = this._findJournalTitleEl(container, record, panelEl || state.panel?.getElement?.());
    if (!titleEl) {
      return;
    }
    state.titleEl = titleEl;

    let cluster = state.titleCluster;
    if (!cluster || !cluster.isConnected || cluster.nextElementSibling !== titleEl) {
      if (cluster && cluster.isConnected) {
        try {
          cluster.remove();
        } catch (_) {}
      }
      cluster = document.createElement('button');
      cluster.type = 'button';
      cluster.className = 'wm-title-cluster button-none';
      cluster.setAttribute('aria-label', 'Weather and moon for this journal day');
      cluster.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this._togglePopover('title', cluster, state.journalDateKey);
      });
      state.titleCluster = cluster;

      const parent = this._findTitleMountParent(titleEl);
      if (parent) {
        parent.classList.add('wm-title-row');
        parent.insertBefore(cluster, titleEl);
      } else {
        titleEl.insertAdjacentElement('beforebegin', cluster);
      }
    }

    this._renderTitleCluster(state, null);
    this._refreshPanelTitle(state);
  }

  _renderTitleCluster(state, bundle) {
    const cluster = state.titleCluster;
    if (!cluster) return;
    const date = state.journalDate || new Date();
    const moon = wmMoonPhaseForDate(date);
    const moonHtml = wmMoonEmojiHtml(moon.phase, 22);
    let weatherHtml;
    if (!this._hasLocationForDate(state.journalDateKey)) {
      weatherHtml = wmWeatherIconHtml('cloud', 26);
      cluster.classList.add('wm-title-cluster--muted');
    } else if (!bundle) {
      weatherHtml = wmWeatherIconHtml('partly', 26);
      cluster.classList.add('wm-title-cluster--loading');
    } else {
      weatherHtml = wmWeatherIconHtml(bundle.kind, 26);
      cluster.classList.remove('wm-title-cluster--muted', 'wm-title-cluster--loading');
    }
    cluster.innerHTML =
      `<span class="wm-title-diagonal">` +
      `<span class="wm-title-weather">${weatherHtml}</span>` +
      `<span class="wm-title-slash" aria-hidden="true"></span>` +
      `<span class="wm-title-moon">${moonHtml}</span>` +
      `</span>`;
    const sunTip = bundle ? wmSunLine(bundle.sunrise, bundle.sunset) : '';
    const precipTip = bundle ? wmFormatPrecipPct(bundle.precip) : '';
    const timingTip =
      bundle?.timing && state.journalDateKey === wmTodayKey()
        ? bundle.timing.charAt(0).toUpperCase() + bundle.timing.slice(1)
        : '';
    const locName = this._resolveLocationForDate(state.journalDateKey)?.name;
    const locTip = locName ? ` · ${locName}` : '';
    const tip = bundle
      ? `${bundle.label} · ${wmFormatTemp(bundle.hi, this._settings.units)} / ${wmFormatTemp(bundle.lo, this._settings.units)}${precipTip ? ` · ${precipTip}` : ''}${sunTip ? ` · ${sunTip}` : ''}${timingTip ? ` · ${timingTip}` : ''}${locTip} · ${moon.name}`
      : 'Weather & Moon — configure in command palette';
    cluster.title = tip;
  }

  async _refreshPanelTitle(state) {
    if (!state?.journalDateKey || !state.titleCluster) return;
    if (!this._hasLocationForDate(state.journalDateKey)) {
      this._renderTitleCluster(state, null);
      return;
    }
    try {
      if (typeof globalThis.thymerExtInMobileLoadGrace === 'function' && globalThis.thymerExtInMobileLoadGrace()) {
        setTimeout(() => this._refreshPanelTitle(state), 3000);
        return;
      }
    } catch (_) {}
    this._maybeAutoPinDay(state.journalDateKey);
    let bundle = null;
    try {
      bundle = await this._fetchWeatherBundle(state.journalDateKey);
    } catch (e) {
      console.warn('[Weather & Moon] journal date fetch', e);
    }
    if (!this._panelStates.has(state.panelId)) return;
    this._renderTitleCluster(state, bundle);
  }

  _disposePanel(panelId) {
    if (!panelId) return;
    const state = this._panelStates.get(panelId);
    if (!state) return;
    try {
      state.titleObserver?.disconnect();
    } catch (_) {}
    try {
      state.titleAnchorObserver?.disconnect();
    } catch (_) {}
    try {
      state.titleCluster?.remove();
    } catch (_) {}
    try {
      state.titleEl?.parentElement?.classList?.remove?.('wm-title-row');
    } catch (_) {}
    this._panelStates.delete(panelId);
  }

  // ─── Popover (DSS-style) ───────────────────────────────────────────────────

  _injectCss() {
    if (this._cssInjected) return;
    this._cssInjected = true;
    try {
      this.ui.injectCSS(`
        .wm-title-row .wm-title-cluster {
          margin-right: 4px;
        }
        .wm-title-cluster {
          display: inline-flex !important;
          flex-shrink: 0;
          cursor: pointer;
          color: var(--text-secondary, color-mix(in srgb, CanvasText 78%, Canvas));
          opacity: 0.92;
          padding: 1px 2px;
          border-radius: 6px;
          line-height: 0;
          vertical-align: middle;
          transition: opacity 0.12s ease, color 0.12s ease;
          position: relative;
          z-index: 2;
        }
        .id--h1-area .wm-title-cluster,
        .panel-body .wm-title-cluster,
        .panel-bar .wm-title-cluster {
          align-self: center;
        }
        .wm-title-cluster:hover {
          opacity: 1;
          color: CanvasText;
          background: color-mix(in srgb, CanvasText 6%, transparent);
        }
        .wm-title-cluster--loading { opacity: 0.55; }
        .wm-title-cluster--muted { opacity: 0.45; }
        .wm-title-diagonal {
          position: relative;
          display: block;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
        }
        .wm-title-weather,
        .wm-title-moon {
          position: absolute;
          display: inline-flex;
          align-items: center;
          line-height: 0;
        }
        .wm-title-weather { top: 0; left: 0; }
        .wm-title-moon { bottom: 0; right: 0; opacity: 0.9; }
        .wm-title-weather svg,
        .wm-title-moon svg {
          display: block;
          overflow: visible;
        }
        .wm-title-slash {
          position: absolute;
          inset: 3px;
          pointer-events: none;
        }
        .wm-title-slash::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          width: 130%;
          height: 1px;
          background: currentColor;
          opacity: 0.24;
          transform: translate(-50%, -50%) rotate(-42deg);
        }

        .wm-status-readout {
          display: inline-flex;
          align-items: baseline;
          gap: 0;
          font-size: 11px;
          letter-spacing: 0.01em;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
          white-space: nowrap;
          max-width: min(52vw, 420px);
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--text-secondary, color-mix(in srgb, CanvasText 82%, Canvas));
        }
        .wm-status-readout--muted { opacity: 0.55; }
        .wm-status-temps { font-weight: 600; }
        .wm-status-sep { opacity: 0.5; font-weight: 400; }
        .wm-status-dot { opacity: 0.35; margin: 0 0.35em; }
        .wm-status-cond { font-weight: 450; }
        .wm-status-moon { opacity: 0.78; }

        .wm-shell {
          position: fixed;
          z-index: 200000;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          max-width: min(420px, calc(100vw - 16px));
          pointer-events: auto;
        }
        .wm-card {
          width: 100%;
          --wm-text-indent: 32px;
          max-height: min(340px, 52vh);
          overflow-y: auto;
          padding: 10px 12px 12px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
          background: color-mix(in srgb, Canvas 42%, transparent);
          color: CanvasText;
          -webkit-backdrop-filter: blur(18px) saturate(1.25);
          backdrop-filter: blur(18px) saturate(1.25);
          box-shadow:
            0 0 0 1px color-mix(in srgb, CanvasText 8%, transparent),
            0 -6px 28px color-mix(in srgb, CanvasText 18%, transparent),
            0 0 22px color-mix(in srgb, Highlight 24%, transparent);
        }
        .wm-shell--title .wm-card {
          max-height: none;
          overflow: visible;
          --wm-text-indent: 32px;
        }
        .wm-shell--title.wm-shell--scroll .wm-card {
          overflow-y: auto;
        }
        .wm-weather-emoji,
        .wm-sun-emoji {
          display: inline-block;
          vertical-align: middle;
        }
        .wm-head-ico .wm-weather-emoji { margin-top: 1px; }
        .wm-head {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 4px;
          --wm-text-indent: 32px;
        }
        .wm-head-ico { line-height: 0; flex-shrink: 0; color: color-mix(in srgb, CanvasText 88%, Canvas); width: 22px; }
        .wm-head-text { min-width: 0; flex: 1; }
        .wm-head-title { font-weight: 650; font-size: 14px; line-height: 1.25; }
        .wm-head-sub { font-size: 11px; opacity: 0.72; margin-top: 2px; }
        .wm-head-now { opacity: 0.72; font-weight: 450; }
        .wm-detail-line {
          padding-left: var(--wm-text-indent, 32px);
          font-size: 11px;
          margin: 0 0 6px;
        }
        .wm-timing {
          opacity: 0.82;
          font-style: italic;
        }
        .wm-sun-line {
          opacity: 0.78;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.01em;
        }
        .wm-sun-times {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }
        .wm-sun-slot {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .wm-sun-ico { opacity: 0.82; flex-shrink: 0; line-height: 0; }
        .wm-section-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.55;
          margin: 10px 0 6px;
        }
        .wm-hourly {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .wm-hour {
          flex: 0 0 auto;
          text-align: center;
          font-size: 10px;
          opacity: 0.88;
          min-width: 42px;
        }
        .wm-hour-t { font-variant-numeric: tabular-nums; margin-top: 3px; }
        .wm-hour-p { font-size: 9px; opacity: 0.62; margin-top: 2px; font-variant-numeric: tabular-nums; }
        .wm-daily-row {
          display: grid;
          grid-template-columns: 2.2em 1fr auto auto auto;
          gap: 6px;
          align-items: center;
          font-size: 11px;
          padding: 3px 0;
        }
        .wm-daily-precip { opacity: 0.62; font-variant-numeric: tabular-nums; text-align: right; min-width: 2.2em; }
        .wm-daily-row + .wm-daily-row { border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent); }
        .wm-daily-strip {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding: 2px 0 8px;
          scrollbar-width: thin;
        }
        .wm-daily-tile {
          flex: 0 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 52px;
          padding: 8px 6px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
          background: color-mix(in srgb, CanvasText 4%, transparent);
          color: inherit;
          cursor: pointer;
          font: inherit;
          font-size: 10px;
          font-variant-numeric: tabular-nums;
        }
        .wm-daily-tile:hover {
          background: color-mix(in srgb, CanvasText 8%, transparent);
        }
        .wm-daily-tile.is-active {
          border-color: color-mix(in srgb, Highlight 50%, transparent);
          background: color-mix(in srgb, Highlight 14%, transparent);
        }
        .wm-daily-tile-dow {
          font-weight: 650;
          font-size: 10px;
          opacity: 0.85;
        }
        .wm-daily-tile-ico { line-height: 0; }
        .wm-daily-tile-hi { font-weight: 600; font-size: 11px; }
        .wm-daily-tile-lo { opacity: 0.55; font-size: 10px; }
        .wm-daily-detail {
          font-size: 10px;
          opacity: 0.72;
          margin-top: -2px;
          margin-bottom: 6px;
          padding-left: 0 !important;
        }
        .wm-shell--below { flex-direction: column; }
        .wm-shell--below .wm-caret {
          order: -1;
          transform: rotate(180deg);
          margin-top: 0;
          margin-bottom: -1px;
        }
        .wm-chart-pane { min-height: 96px; }
        .wm-moon-row {
          display: flex;
          align-items: center;
          gap: 6px;
          opacity: 0.88;
        }
        .wm-moon-emoji { display: inline-block; vertical-align: middle; line-height: 1; }
        .wm-metrics { opacity: 0.78; font-variant-numeric: tabular-nums; }
        .wm-blurb { opacity: 0.88; line-height: 1.35; }
        .wm-blurb--compact { font-style: italic; opacity: 0.82; }
        .wm-blurb-secondary { opacity: 0.72; font-size: 10px; }
        .wm-expand-section { display: none; }
        .wm-card--expanded .wm-expand-section { display: block; }
        .wm-shell--status .wm-card { /* status opens expanded */ }
        .wm-shell--status .wm-expand-section { display: block; }
        .wm-shell--status .wm-expand-btn { display: none; }
        .wm-expand-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: calc(100% - var(--wm-text-indent, 32px));
          margin-left: var(--wm-text-indent, 32px);
          margin-top: 4px;
          padding: 6px 0 2px;
          border: none;
          background: transparent;
          color: color-mix(in srgb, CanvasText 72%, Canvas);
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          font-weight: 500;
          text-align: left;
        }
        .wm-expand-btn:hover { color: CanvasText; }
        .wm-expand-chevron {
          display: inline-block;
          font-size: 12px;
          opacity: 0.7;
          transition: transform 0.15s ease;
        }
        .wm-card--expanded .wm-expand-chevron { transform: rotate(180deg); }
        .wm-charts { margin: 8px 0 4px; }
        .wm-chart-tabs { display: flex; gap: 4px; margin-bottom: 6px; }
        .wm-chart-tab {
          flex: 1;
          padding: 4px 6px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font: inherit;
          font-size: 10px;
          opacity: 0.65;
          background: color-mix(in srgb, CanvasText 6%, transparent);
          color: inherit;
        }
        .wm-chart-tab.is-active {
          opacity: 1;
          font-weight: 650;
          background: color-mix(in srgb, Highlight 16%, transparent);
        }
        .wm-chart-pane {
          border-radius: 8px;
          background: color-mix(in srgb, CanvasText 4%, transparent);
          padding: 4px 2px;
        }
        .wm-chart-svg { display: block; color: CanvasText; }
        .wm-caret {
          display: block;
          margin-top: -1px;
          flex-shrink: 0;
          filter: drop-shadow(0 2px 6px color-mix(in srgb, CanvasText 22%, transparent));
        }
        .wm-caret-path {
          fill: color-mix(in srgb, Canvas 76%, transparent);
          stroke: color-mix(in srgb, CanvasText 28%, transparent);
          stroke-width: 0.6;
        }
        .wm-config-overlay {
          position: fixed; inset: 0; z-index: 300000;
          background: rgba(0,0,0,0.45);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
        }
        .wm-config-card {
          width: min(420px, 94vw);
          padding: 16px 18px;
          border-radius: 12px;
          background: color-mix(in srgb, Canvas 92%, transparent);
          color: CanvasText;
          border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
          box-shadow: 0 20px 50px rgba(0,0,0,0.35);
        }
        .wm-config-title { font-weight: 700; font-size: 15px; margin-bottom: 10px; }
        .wm-config-row { margin-bottom: 10px; }
        .wm-config-row label { display: block; font-size: 11px; opacity: 0.7; margin-bottom: 4px; }
        .wm-config-input {
          width: 100%; box-sizing: border-box;
          padding: 7px 10px; border-radius: 8px;
          border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
          background: color-mix(in srgb, Canvas 88%, transparent);
          color: inherit; font: inherit;
        }
        .wm-config-results { max-height: 140px; overflow-y: auto; margin-top: 6px; }
        .wm-config-result {
          display: block; width: 100%; text-align: left;
          padding: 6px 8px; border: none; background: transparent;
          color: inherit; cursor: pointer; border-radius: 6px; font: inherit; font-size: 12px;
        }
        .wm-config-result:hover { background: color-mix(in srgb, CanvasText 8%, transparent); }
        .wm-config-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
        .wm-btn {
          padding: 6px 12px; border-radius: 8px; border: none; cursor: pointer; font: inherit; font-size: 12px;
        }
        .wm-btn-primary { background: color-mix(in srgb, Highlight 70%, Canvas); color: Canvas; }
        .wm-btn-ghost { background: transparent; color: inherit; opacity: 0.8; }
        .wm-config-sub {
          font-size: 11px;
          opacity: 0.72;
          margin: -4px 0 10px;
          line-height: 1.35;
        }
        .wm-config-section-label {
          font-size: 10px;
          font-weight: 650;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.55;
          margin: 8px 0 6px;
        }
        .wm-config-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 4px;
        }
        .wm-config-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: 100%;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
          background: color-mix(in srgb, CanvasText 5%, transparent);
          color: inherit;
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          line-height: 1.2;
        }
        .wm-config-chip:hover {
          background: color-mix(in srgb, CanvasText 10%, transparent);
        }
        .wm-config-chip.is-selected {
          border-color: color-mix(in srgb, Highlight 45%, transparent);
          background: color-mix(in srgb, Highlight 12%, transparent);
        }
        .wm-config-chip-star {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 0 2px;
          font: inherit;
          font-size: 11px;
          line-height: 1;
          opacity: 0.55;
        }
        .wm-config-chip-star.is-pinned { opacity: 1; }
      `);
    } catch (_) {}
  }

  _togglePopover(source, anchorEl, dateKey) {
    const dk = dateKey || wmTodayKey();
    const canShow =
      source === 'status' ? this._hasLocation() : this._hasLocationForDate(dk);
    if (!canShow) {
      if (source === 'title') {
        this._openLocationDialog({ mode: 'journalDay', dateKey: dk });
      } else {
        this._openConfigureDialog();
      }
      return;
    }
    if (this._popoverEl && this._popoverSource === source) {
      this._closePopover();
      return;
    }
    this._openPopover(source, anchorEl, dateKey);
  }

  async _openPopover(source, anchorEl, dateKey) {
    this._closePopover();
    if (!anchorEl?.isConnected) return;
    try {
      if (document.querySelector('.tal-overlay')) return;
    } catch (_) {}

    const targetKey = dateKey || wmTodayKey();
    this._popoverContextDate = targetKey;

    let bundle = null;
    const statusExpanded = source === 'status';
    const useGlobalWx = source === 'status';
    try {
      bundle = await this._fetchWeatherBundle(targetKey, { useGlobal: useGlobalWx });
      if (bundle && (statusExpanded || source === 'title') && targetKey === wmTodayKey()) {
        bundle = await this._mergeTodayDashboard(bundle, targetKey, useGlobalWx);
      } else if (statusExpanded && targetKey === wmTodayKey()) {
        bundle = await this._ensureTodayDashboard(bundle, targetKey, { useGlobal: useGlobalWx });
      }
      if (bundle && statusExpanded) {
        const todayFull =
          targetKey === wmTodayKey() && useGlobalWx
            ? bundle
            : await this._fetchWeatherBundle(wmTodayKey(), { useGlobal: true });
        if (todayFull) {
          if (todayFull.daily?.length) bundle.daily = todayFull.daily;
          if (todayFull.hourly?.length) bundle.hourly = todayFull.hourly;
          if (todayFull.hourlyChart?.length) bundle.hourlyChart = todayFull.hourlyChart;
          if (todayFull.timing) bundle.timing = todayFull.timing;
          if (todayFull.humidity != null) bundle.humidity = todayFull.humidity;
          if (todayFull.wind != null) bundle.wind = todayFull.wind;
          if (todayFull.feelsLike != null) bundle.feelsLike = todayFull.feelsLike;
          if (todayFull.precipSum != null) bundle.precipSum = todayFull.precipSum;
        }
      } else if (bundle && targetKey === wmTodayKey() && source === 'title') {
        const todayFull = await this._fetchWeatherBundle(wmTodayKey(), { useGlobal: useGlobalWx });
        if (todayFull?.timing) bundle.timing = todayFull.timing;
        if (todayFull?.humidity != null) bundle.humidity = todayFull.humidity;
        if (todayFull?.wind != null) bundle.wind = todayFull.wind;
        if (todayFull?.feelsLike != null) bundle.feelsLike = todayFull.feelsLike;
      }
    } catch (e) {
      console.warn('[Weather & Moon] popover fetch', e);
    }

    const dateForMoon = targetKey === wmTodayKey() ? new Date() : new Date(targetKey + 'T12:00:00');
    const moon = wmMoonPhaseForDate(dateForMoon);

    const shell = document.createElement('div');
    shell.className =
      source === 'title' ? 'wm-shell wm-shell--title wm-shell--below' : 'wm-shell wm-shell--status wm-shell--above';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-label', 'Weather forecast');

    const card = document.createElement('div');
    card.className = 'wm-card' + (statusExpanded ? ' wm-card--expanded' : '');

    if (!bundle) {
      card.innerHTML = `<div style="padding:8px;opacity:0.75;font-size:12px;">Could not load weather.</div>`;
    } else {
      const units = this._settings.units;
      const isToday = targetKey === wmTodayKey();
      const hi = wmFormatTemp(bundle.hi, units);
      const lo = wmFormatTemp(bundle.lo, units);
      const resolvedLoc = useGlobalWx ? this._globalLocation() : this._resolveLocationForDate(targetKey);
      const loc = this._escapeHtml(resolvedLoc?.name || 'Location');
      const sunTimesHtml = wmSunTimesHtml(bundle.sunrise, bundle.sunset);
      const precipBit = wmFormatPrecipPct(bundle.precip, true);
      const condHtml = this._popoverHeadConditionHtml(bundle, isToday, units);
      const headIcon = this._popoverHeadIconKind(bundle, isToday);
      const head = document.createElement('div');
      head.className = 'wm-head';
      head.innerHTML =
        `<span class="wm-head-ico">${wmWeatherIconHtml(headIcon, 22)}</span>` +
        `<div class="wm-head-text">` +
        `<div class="wm-head-title">${hi} / ${lo} · ${condHtml}${precipBit ? ` · ${precipBit}` : ''}</div>` +
        `<div class="wm-head-sub">${loc} · ${wmFormatDisplayDate(targetKey)}</div>` +
        `</div>`;
      card.appendChild(head);

      if (sunTimesHtml) {
        const sun = document.createElement('div');
        sun.className = 'wm-sun-line wm-detail-line';
        sun.innerHTML = sunTimesHtml;
        card.appendChild(sun);
      }

      if (isToday && !bundle.isHistorical) {
        this._appendMetricsRow(card, bundle, units);
      }

      const insightOpts = {
        compact: !statusExpanded,
        hourly: bundle.hourlyChart || bundle.hourly,
        daily: bundle.daily,
        todayKey: wmTodayKey(),
      };
      this._appendInsights(card, bundle, units, insightOpts);

      this._appendPopoverMoon(card, moon);
      this._appendPopoverHourly(card, bundle, units);

      const hasExpandable =
        !bundle.isHistorical &&
        ((bundle.hourlyChart || bundle.hourly)?.length || bundle.daily?.length);
      if (hasExpandable) {
        this._appendPopoverExpandSection(card, bundle, units, useGlobalWx);
      }

      if (source === 'title' && hasExpandable) {
        this._appendExpandToggle(card, () => reposition(), true);
      }
    }

    shell.appendChild(card);

    const NS = 'http://www.w3.org/2000/svg';
    const caret = document.createElementNS(NS, 'svg');
    caret.classList.add('wm-caret');
    caret.setAttribute('width', '20');
    caret.setAttribute('height', '9');
    caret.setAttribute('viewBox', '0 0 20 9');
    caret.setAttribute('aria-hidden', 'true');
    const caretPath = document.createElementNS(NS, 'path');
    caretPath.classList.add('wm-caret-path');
    caretPath.setAttribute('d', 'M0 1 L10 9 L20 1 Z');
    caret.appendChild(caretPath);
    shell.appendChild(caret);

    document.body.appendChild(shell);
    this._popoverEl = shell;
    this._popoverSource = source;

    let reposition = () => {};
    const position = () => {
      if (!this._popoverEl || !anchorEl.isConnected) return;
      const r = anchorEl.getBoundingClientRect();
      const gap = 6;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      shell.style.visibility = 'hidden';
      shell.style.left = '0';
      shell.style.top = '0';
      shell.style.bottom = 'auto';
      const sw = shell.offsetWidth;
      const sh = shell.offsetHeight;
      shell.style.visibility = '';
      let left = r.left + r.width / 2 - sw / 2;
      left = Math.max(margin, Math.min(left, vw - sw - margin));

      const spaceAbove = r.top - margin;
      const spaceBelow = vh - r.bottom - margin;
      let placeBelow = source === 'title';
      if (source === 'status') placeBelow = false;
      if (placeBelow && spaceBelow < sh + gap && spaceAbove > spaceBelow) placeBelow = false;
      if (!placeBelow && spaceAbove < sh + gap && spaceBelow > spaceAbove) placeBelow = true;

      shell.classList.toggle('wm-shell--below', placeBelow);
      shell.classList.toggle('wm-shell--above', !placeBelow);
      shell.classList.toggle('wm-shell--scroll', true);

      if (placeBelow) {
        shell.style.top = `${Math.round(r.bottom + gap)}px`;
        shell.style.bottom = 'auto';
      } else {
        shell.style.top = 'auto';
        shell.style.bottom = `${Math.round(vh - r.top + gap)}px`;
      }
      shell.style.left = `${Math.round(left)}px`;

      const avail = placeBelow ? spaceBelow : spaceAbove;
      card.style.maxHeight = `${Math.min(560, Math.max(140, avail - gap - 10))}px`;
      card.style.overflow = 'auto';

      const anchorCenter = r.left + r.width / 2;
      const caretW = 20;
      const caretLeft = Math.max(8, Math.min(anchorCenter - left - caretW / 2, sw - caretW - 8));
      caret.style.marginLeft = `${Math.round(caretLeft)}px`;
    };
    reposition = position;

    position();

    this._boundDocMouse = (ev) => {
      const t = ev.target;
      if (!this._popoverEl) return;
      if (this._popoverEl.contains(t)) return;
      if (anchorEl.contains(t)) return;
      this._closePopover();
    };
    this._boundDocClick = this._boundDocMouse;
    this._boundDocKey = (ev) => {
      if (ev.key === 'Escape') this._closePopover();
    };
    this._boundWinResize = () => position();
    this._boundWinScroll = () => position();

    setTimeout(() => {
      document.addEventListener('mousedown', this._boundDocMouse, true);
      document.addEventListener('click', this._boundDocClick, true);
      document.addEventListener('keydown', this._boundDocKey, true);
      window.addEventListener('resize', this._boundWinResize);
      window.addEventListener('scroll', this._boundWinScroll, true);
    }, 0);

    this._startLockObserver();
  }

  _startLockObserver() {
    this._stopLockObserver();
    try {
      if (document.querySelector('.tal-overlay')) {
        this._closePopover();
        return;
      }
      this._lockObserver = new MutationObserver(() => {
        if (document.querySelector('.tal-overlay')) this._closePopover();
      });
      this._lockObserver.observe(document.body, { childList: true });
    } catch (_) {}
  }

  _stopLockObserver() {
    if (this._lockObserver) {
      try {
        this._lockObserver.disconnect();
      } catch (_) {}
      this._lockObserver = null;
    }
  }

  _removeDocListeners() {
    this._stopLockObserver();
    if (this._boundDocMouse) {
      try {
        document.removeEventListener('mousedown', this._boundDocMouse, true);
      } catch (_) {}
      this._boundDocMouse = null;
    }
    if (this._boundDocClick) {
      try {
        document.removeEventListener('click', this._boundDocClick, true);
      } catch (_) {}
      this._boundDocClick = null;
    }
    if (this._boundDocKey) {
      try {
        document.removeEventListener('keydown', this._boundDocKey, true);
      } catch (_) {}
      this._boundDocKey = null;
    }
    if (this._boundWinResize) {
      try {
        window.removeEventListener('resize', this._boundWinResize);
      } catch (_) {}
      this._boundWinResize = null;
    }
    if (this._boundWinScroll) {
      try {
        window.removeEventListener('scroll', this._boundWinScroll, true);
      } catch (_) {}
      this._boundWinScroll = null;
    }
  }

  _closePopover() {
    this._removeDocListeners();
    try {
      this._popoverEl?.remove();
    } catch (_) {}
    this._popoverEl = null;
    this._popoverSource = null;
  }

  // ─── Settings UI ───────────────────────────────────────────────────────────

  _cmdChooseJournalDayLocation() {
    const st = this._getActiveJournalState();
    if (!st?.journalDateKey) {
      this.ui.addToaster?.({
        title: 'Open a journal page',
        message: 'Open the journal day you want, then run this command again.',
        dismissible: true,
        autoDestroyTime: 4200,
      });
      return;
    }
    this._openLocationDialog({ mode: 'journalDay', dateKey: st.journalDateKey });
  }

  _cmdApplyCurrentToJournalDay() {
    const st = this._getActiveJournalState();
    if (!st?.journalDateKey) {
      this.ui.addToaster?.({
        title: 'Open a journal page',
        message: 'Open the journal day you want, then run this command again.',
        dismissible: true,
        autoDestroyTime: 4200,
      });
      return;
    }
    if (!this._hasLocation()) {
      this.ui.addToaster?.({
        title: 'Set a default location first',
        message: 'Use Weather & Moon: Configure, then apply it to this journal day.',
        dismissible: true,
        autoDestroyTime: 4500,
      });
      return;
    }
    const loc = this._globalLocation();
    this._setDayPin(st.journalDateKey, loc);
    this._touchRecentCity(loc);
    this._refreshJournalPanel(st.journalDateKey);
    this.ui.addToaster?.({
      title: 'Journal location updated',
      message: `${wmFormatDisplayDate(st.journalDateKey)} → ${loc.name}`,
      dismissible: true,
      autoDestroyTime: 3200,
    });
  }

  _cmdClearJournalDayLocation() {
    const st = this._getActiveJournalState();
    if (!st?.journalDateKey) {
      this.ui.addToaster?.({
        title: 'Open a journal page',
        message: 'Open the journal day you want, then run this command again.',
        dismissible: true,
        autoDestroyTime: 4200,
      });
      return;
    }
    const hadPin = !!this._getDayPin(st.journalDateKey);
    this._clearDayPin(st.journalDateKey);
    this._refreshJournalPanel(st.journalDateKey);
    this.ui.addToaster?.({
      title: hadPin ? 'Override cleared' : 'Using default location',
      message: hadPin
        ? `${wmFormatDisplayDate(st.journalDateKey)} now follows your default location.`
        : `${wmFormatDisplayDate(st.journalDateKey)} already uses your default location.`,
      dismissible: true,
      autoDestroyTime: 3200,
    });
  }

  _openConfigureDialog() {
    this._openLocationDialog({ mode: 'global' });
  }

  _openLocationDialog({ mode = 'global', dateKey = null } = {}) {
    const existing = document.querySelector('.wm-config-overlay');
    if (existing) existing.remove();

    this._settings = this._loadSettingsLocal();
    const isJournalDay = mode === 'journalDay' && dateKey;
    const dk = isJournalDay ? dateKey : null;

    const overlay = document.createElement('div');
    overlay.className = 'wm-config-overlay';
    const card = document.createElement('div');
    card.className = 'wm-config-card';

    const title = document.createElement('div');
    title.className = 'wm-config-title';
    title.textContent = isJournalDay
      ? `Location for ${wmFormatDisplayDate(dk)}`
      : 'Weather & Moon';

    const subtitle = document.createElement('div');
    subtitle.className = 'wm-config-sub';
    if (isJournalDay) {
      const pin = this._getDayPin(dk);
      const global = this._globalLocation();
      if (pin) {
        subtitle.textContent = `${pin.name} for this day. Status bar still uses ${global?.name || 'your default'}.`;
      } else if (global) {
        subtitle.textContent = `Using default: ${global.name}. Pick a city to set this journal day separately.`;
      } else {
        subtitle.textContent = 'Pick a city for weather on this journal day.';
      }
    } else {
      subtitle.textContent = 'Default location for today, the status bar, and new journal days.';
    }

    const cityRow = document.createElement('div');
    cityRow.className = 'wm-config-row';
    cityRow.innerHTML = '<label>City search (Open-Meteo geocoding)</label>';
    const cityInput = document.createElement('input');
    cityInput.className = 'wm-config-input';
    cityInput.type = 'text';
    cityInput.placeholder = 'e.g. Brooklyn (city name only works best)';
    const initialLoc = isJournalDay ? this._getDayPin(dk) || this._globalLocation() : this._globalLocation();
    cityInput.value = initialLoc?.name || this._settings.locationName || '';
    cityRow.appendChild(cityInput);

    const chipsHost = document.createElement('div');

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'wm-btn wm-btn-primary';
    searchBtn.textContent = 'Search';
    searchBtn.style.marginTop = '6px';

    const results = document.createElement('div');
    results.className = 'wm-config-results';

    const unitsRow = document.createElement('div');
    unitsRow.className = 'wm-config-row';
    unitsRow.innerHTML = '<label>Temperature</label>';
    const unitsSel = document.createElement('select');
    unitsSel.className = 'wm-config-input';
    unitsSel.innerHTML =
      '<option value="fahrenheit">Fahrenheit (°F)</option><option value="celsius">Celsius (°C)</option>';
    unitsSel.value = this._settings.units === 'celsius' ? 'celsius' : 'fahrenheit';
    unitsRow.appendChild(unitsSel);
    if (isJournalDay) unitsRow.style.display = 'none';

    let picked = initialLoc ? wmNormalizeLoc(initialLoc) : null;

    const showPickedHint = () => {
      if (!picked?.name) return;
      results.innerHTML = '';
      const ok = document.createElement('div');
      ok.style.cssText = 'font-size:11px;opacity:0.75;padding:4px 0;';
      ok.textContent = `Selected: ${picked.name}`;
      results.appendChild(ok);
    };

    const selectLoc = (loc) => {
      picked = wmNormalizeLoc(loc);
      if (!picked) return;
      cityInput.value = picked.name;
      showPickedHint();
      renderCityChips();
    };

    const renderChipSection = (label, cities, showStar) => {
      const list = (cities || []).map(wmNormalizeLoc).filter(Boolean);
      if (!list.length) return null;
      const wrap = document.createElement('div');
      const lab = document.createElement('div');
      lab.className = 'wm-config-section-label';
      lab.textContent = label;
      wrap.appendChild(lab);
      const row = document.createElement('div');
      row.className = 'wm-config-chips';
      for (const loc of list) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'wm-config-chip';
        if (picked && wmLocKey(picked) === wmLocKey(loc)) chip.classList.add('is-selected');
        const name = loc.name.split(',')[0];
        chip.textContent = name.length > 22 ? `${name.slice(0, 20)}…` : name;
        chip.title = loc.name;
        chip.addEventListener('click', () => selectLoc(loc));
        if (showStar) {
          const star = document.createElement('button');
          star.type = 'button';
          star.className = 'wm-config-chip-star' + (this._isPinnedCity(loc) ? ' is-pinned' : '');
          star.textContent = '★';
          star.title = this._isPinnedCity(loc) ? 'Unpin' : 'Pin';
          star.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this._togglePinnedCity(loc);
            renderCityChips();
          });
          chip.appendChild(star);
        }
        row.appendChild(chip);
      }
      wrap.appendChild(row);
      return wrap;
    };

    const renderCityChips = () => {
      chipsHost.innerHTML = '';
      const pinned = renderChipSection('Pinned cities', this._settings.pinnedCities, true);
      const recent = renderChipSection('Recent cities', this._settings.recentCities, true);
      if (pinned) chipsHost.appendChild(pinned);
      if (recent) chipsHost.appendChild(recent);
    };

    const renderResults = (items, hint) => {
      results.innerHTML = '';
      if (!items?.length) {
        results.textContent =
          hint || 'No results — try the city name only (e.g. Brooklyn instead of Brooklyn, NY).';
        return;
      }
      if (hint) {
        const note = document.createElement('div');
        note.style.cssText = 'font-size:10px;opacity:0.65;padding:0 0 6px;';
        note.textContent = hint;
        results.appendChild(note);
      }
      for (const it of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wm-config-result';
        const admin = [it.admin1, it.country].filter(Boolean).join(', ');
        btn.textContent = `${it.name}${admin ? ` — ${admin}` : ''}`;
        btn.addEventListener('click', () => selectLoc(wmLocationFromGeocodeResult(it)));
        results.appendChild(btn);
      }
    };

    renderCityChips();
    if (picked?.name) showPickedHint();

    const runSearch = async () => {
      const q = cityInput.value.trim();
      if (!q) return;
      searchBtn.disabled = true;
      searchBtn.textContent = 'Searching…';
      try {
        const { results: items, queryUsed } = await wmGeocodeSearch(q);
        const hint = queryUsed && queryUsed !== q ? `Showing results for “${queryUsed}”` : '';
        renderResults(items, items.length ? hint : null);
        if (items.length === 1) selectLoc(wmLocationFromGeocodeResult(items[0]));
      } catch (e) {
        results.textContent = 'Search failed — check network or try again.';
        console.warn('[Weather & Moon] geocode', e);
      } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
      }
    };

    searchBtn.addEventListener('click', () => {
      void runSearch();
    });
    cityInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        void runSearch();
      }
    });

    const actions = document.createElement('div');
    actions.className = 'wm-config-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'wm-btn wm-btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => overlay.remove());

    let clearBtn = null;
    if (isJournalDay) {
      clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'wm-btn wm-btn-ghost';
      clearBtn.textContent = 'Use default';
      clearBtn.addEventListener('click', () => {
        this._clearDayPin(dk);
        this._refreshJournalPanel(dk);
        overlay.remove();
        this.ui.addToaster?.({
          title: 'Override cleared',
          message: `${wmFormatDisplayDate(dk)} now follows your default location.`,
          dismissible: true,
          autoDestroyTime: 3200,
        });
      });
    }

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'wm-btn wm-btn-primary';
    save.textContent = isJournalDay ? 'Pin for this day' : 'Save';
    save.addEventListener('click', () => {
      void (async () => {
        save.disabled = true;
        save.textContent = 'Saving…';
        try {
          let loc = picked;
          const typed = cityInput.value.trim();
          if (!loc?.latitude && typed) {
            try {
              const { results: items } = await wmGeocodeSearch(typed);
              if (items.length === 1) loc = wmLocationFromGeocodeResult(items[0]);
              else if (items.length > 1) {
                renderResults(items, 'Multiple matches — pick one, then Save again.');
                this.ui.addToaster?.({
                  title: 'Select a city',
                  message: 'Multiple matches found — choose one from the list.',
                  dismissible: true,
                  autoDestroyTime: 4000,
                });
                return;
              }
            } catch (e) {
              console.warn('[Weather & Moon] save geocode', e);
            }
          }
          loc = wmNormalizeLoc(loc);
          if (!loc?.latitude) {
            results.textContent = typed
              ? 'No matching city found. Try the city name only (e.g. Brooklyn).'
              : 'Enter a city and search, or pick a result.';
            this.ui.addToaster?.({
              title: 'Pick a location',
              message: 'Search for a city and select a result (city name only often works best).',
              dismissible: true,
              autoDestroyTime: 4500,
            });
            return;
          }

          if (isJournalDay) {
            this._setDayPin(dk, loc);
            this._touchRecentCity(loc);
            this._refreshJournalPanel(dk);
            overlay.remove();
            this.ui.addToaster?.({
              title: 'Journal location saved',
              message: `${wmFormatDisplayDate(dk)} → ${loc.name}`,
              dismissible: true,
              autoDestroyTime: 3200,
            });
            return;
          }

          if (!loc?.latitude && !this._hasLocation()) {
            results.textContent = 'Enter a city and search, or pick a result.';
            return;
          }
          const next = {
            ...this._settings,
            units: unitsSel.value === 'celsius' ? 'celsius' : 'fahrenheit',
          };
          next.locationName = loc.name;
          next.latitude = loc.latitude;
          next.longitude = loc.longitude;
          next.timezone = loc.timezone || 'auto';
          await this._saveSettings(next);
          overlay.remove();
          this.ui.addToaster?.({
            title: 'Weather & Moon',
            message: `Saved — ${loc.name}`,
            dismissible: true,
            autoDestroyTime: 2800,
          });
        } finally {
          save.disabled = false;
          save.textContent = isJournalDay ? 'Pin for this day' : 'Save';
        }
      })();
    });

    actions.appendChild(cancel);
    if (clearBtn) actions.appendChild(clearBtn);
    actions.appendChild(save);

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(chipsHost);
    card.appendChild(cityRow);
    card.appendChild(searchBtn);
    card.appendChild(results);
    if (!isJournalDay) card.appendChild(unitsRow);
    card.appendChild(actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    cityInput.focus();
  }

  openSettings() {
    this._openConfigureDialog();
  }
}
