const STORAGE_KEY = 'gev.voice.provider';

export function readVoiceProvider(storage) {
  try {
    return (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY) ===
      'gemini'
      ? 'gemini'
      : 'openai';
  } catch {
    return 'openai';
  }
}

/** Keep one public controller identity while replacing each provider's lifetime. */
export function createProviderCommands(options, { bind, factories, storage }) {
  window.__gevVoiceCommands?.stop?.({ removeUi: true });
  let provider = readVoiceProvider(storage);
  let current;
  let disposed = false;
  const lifetime = new AbortController();
  let pendingProvider = null;
  let mountGeneration = 0;
  let voiceEnabled = false;
  const stored = () => {
    try {
      return storage ?? globalThis.localStorage;
    } catch {
      return null;
    }
  };
  const stop = (settings = {}) => {
    if (disposed) return;
    voiceEnabled = false;
    if (settings.removeUi) {
      disposed = true;
      pendingProvider = null;
      options.signal?.removeEventListener('abort', destroy);
    }
    try {
      current?.cancelDeferredVoiceSettings?.();
      current?.session.stop(settings);
    } finally {
      if (settings.removeUi) {
        lifetime.abort();
        options.runner.dispose?.();
      }
    }
  };
  const destroy = () => stop({ removeUi: true });
  const selectProvider = (next) => {
    if (disposed || !Object.hasOwn(factories, next) || next === provider)
      return false;
    pendingProvider = null;
    const voicePreviewEnabled = current?.getVoicePreviewEnabled?.();
    const voiceInactivityMinutes = current?.getVoiceInactivityMinutes?.();
    const resume = voiceEnabled && current.session.isActive();
    // Carry the input mode, never a held key, microphone or conversation.
    const pushToTalk = Boolean(
      current.session.adapter.getStartOptions?.().pushToTalk,
    );
    current.session.destroy();
    provider = next;
    try {
      stored()?.setItem(STORAGE_KEY, provider);
    } catch {
      /* Storage is optional. */
    }
    mount({
      voiceSettingsOpen: true,
      voicePreviewEnabled,
      voiceInactivityMinutes,
    });
    if (resume && !disposed) void current.session.start({ pushToTalk });
    globalThis.document?.getElementById('gev-voice-provider')?.focus();
    return true;
  };
  const requestProviderChange = (next) => {
    const previousProvider = provider;
    if (disposed || !Object.hasOwn(factories, next))
      return {
        ok: false,
        changed: false,
        pending: false,
        previousProvider,
        error: `Unknown voice provider: ${next || 'missing'}`,
      };
    if (next === provider) {
      pendingProvider = null;
      return {
        ok: true,
        changed: false,
        pending: false,
        previousProvider,
      };
    }
    if (voiceEnabled && current?.session?.isActive()) {
      pendingProvider = next;
      return {
        ok: true,
        changed: true,
        pending: true,
        previousProvider,
      };
    }
    return {
      ok: true,
      changed: selectProvider(next),
      pending: false,
      previousProvider,
    };
  };
  const handleSessionEvent = (event) => {
    // Button and Space starts bypass the facade. Observe the session instead;
    // a status-preserving Stop must also revoke replacement's resume intent.
    if (event?.type === 'state' && event.state === 'connecting')
      voiceEnabled = true;
    if (
      event?.type === 'stop' ||
      (event?.type === 'state' && ['idle', 'error'].includes(event.state))
    )
      voiceEnabled = false;
    if (!pendingProvider) return;
    if (event?.type === 'interruption') {
      pendingProvider = null;
      return;
    }
    if (
      (provider === 'openai'
        ? event?.type === 'reply-complete'
        : event?.type === 'completion') ||
      event?.type === 'stop' ||
      (event?.type === 'state' && ['idle', 'error'].includes(event.state))
    ) {
      const next = pendingProvider;
      pendingProvider = null;
      selectProvider(next);
    }
  };
  const unavailablePanelView = () => ({
    ok: false,
    changed: false,
    reason: disposed ? 'disposed' : 'unavailable',
    error: disposed
      ? 'Voice controls are no longer available.'
      : 'Voice panel views are not available.',
    view: null,
    panelOpen: false,
    settingsOpen: false,
    previewVisible: false,
    previewEnabled: false,
    frontPanelId: null,
    ...(!disposed ? current?.getVoicePanelOrderState?.() : {}),
  });
  const api = {
    // The shared action surface is independent of an active voice connection.
    runner: options.runner,
    signal: lifetime.signal,
    get provider() {
      return provider;
    },
    get session() {
      return current?.session;
    },
    get status() {
      return current?.status ?? current?.session.state ?? 'idle';
    },
    get state() {
      return current?.session.state ?? 'idle';
    },
    get disposed() {
      return disposed;
    },
    start: (settings) => !disposed && current.session.start(settings),
    stop,
    destroy,
    isActive: () => !disposed && current.session.isActive(),
    sendTextCommand: (text) => !disposed && current.session.sendText(text),
    sendText: (text) => !disposed && current.session.sendText(text),
    notifyMapEvent: (event) => !disposed && current.session.sendMapEvent(event),
    setVoiceSettingsOpen: (open) =>
      !disposed && current?.setVoiceSettingsOpen?.(open),
    selectVoicePanelView: (view) =>
      !disposed && typeof current?.selectVoicePanelView === 'function'
        ? current.selectVoicePanelView(view)
        : unavailablePanelView(),
    closeVoicePanelView: (view) =>
      !disposed && typeof current?.closeVoicePanelView === 'function'
        ? current.closeVoicePanelView(view)
        : unavailablePanelView(),
    getVoicePreviewEnabled: () =>
      !disposed ? current?.getVoicePreviewEnabled?.() : undefined,
    setVoicePreviewEnabled: (enabled) => {
      if (!disposed && current?.setVoicePreviewEnabled)
        return current.setVoicePreviewEnabled(enabled);
      return {
        ok: false,
        enabled: !disposed
          ? (current?.getVoicePreviewEnabled?.() ?? null)
          : null,
        changed: false,
        reason: disposed ? 'disposed' : 'preview-unavailable',
        error: disposed
          ? 'Voice Preview controls are no longer available.'
          : 'Voice Preview is not available.',
      };
    },
    setVoicePanelOrder: (panelId, position) => {
      if (!disposed && current?.setVoicePanelOrder)
        return current.setVoicePanelOrder(panelId, position);
      return {
        ok: false,
        panelId,
        position,
        reason: disposed ? 'disposed' : 'unavailable',
        error: disposed
          ? 'Voice controls are no longer available.'
          : 'Voice panel ordering is not available.',
        frontPanelId: null,
        settingsOpen: false,
        previewVisible: false,
        previewEnabled: false,
        ...current?.getVoicePanelOrderState?.(),
      };
    },
    setVoiceInactivityMinutes: (minutes) =>
      !disposed && current?.setVoiceInactivityMinutes?.(minutes),
    getVoiceInactivityMinutes: () =>
      !disposed ? current?.getVoiceInactivityMinutes?.() : undefined,
    setProvider: selectProvider,
    requestProviderChange,
  };
  // Existing diagnostic and controller accessors continue to reflect the active provider.
  const facade = new Proxy(api, {
    get(target, name, receiver) {
      if (Reflect.has(target, name)) return Reflect.get(target, name, receiver);
      const value = current?.[name];
      return typeof value === 'function' ? value.bind(current) : value;
    },
  });
  function mount({
    voiceSettingsOpen = false,
    voicePreviewEnabled,
    voiceInactivityMinutes,
  } = {}) {
    voiceEnabled = false;
    const generation = ++mountGeneration;
    current = bind({
      ...options,
      signal: lifetime.signal,
      resetExisting: false,
      disposeRunner: false,
      provider,
      onProviderChange: selectProvider,
      onSessionEvent: (event) => {
        if (!disposed && generation === mountGeneration)
          handleSessionEvent(event);
      },
      storage: stored(),
      voiceSettingsOpen,
      voicePreviewEnabled,
      voiceInactivityMinutes,
      createSession: factories[provider],
    });
    window.__gevVoiceCommands = facade;
  }
  mount();
  options.signal?.addEventListener('abort', destroy, { once: true });
  if (options.signal?.aborted) destroy();
  return facade;
}
