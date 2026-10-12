import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProviderCommands,
  readVoiceProvider,
} from './providerCommands.js';
import { createVoiceCommands as bind } from './sessionCommands.js';
import { VOICE_INACTIVITY_STORAGE_KEY } from './inactivity.js';
import { VOICE_PREVIEW_STORAGE_KEY } from './voicePreview.js';

function element(properties = {}) {
  const target = new EventTarget();
  Object.assign(target, properties);
  target.attributes = {};
  target.setAttribute = (name, value) => {
    target.attributes[name] = String(value);
  };
  target.getAttribute = (name) => target.attributes[name] ?? null;
  target.focus = () => {
    target.focused = true;
  };
  return target;
}

function control(withPreview = false) {
  const button = element();
  button.setAttribute = () => {};
  const select = element();
  const customInput = element({ value: '5' });
  customInput.setCustomValidity = () => {};
  const view = {
    root: {
      dataset: {},
      remove() {
        this.removed = true;
      },
    },
    button,
    providerSelect: select,
    voiceSettingsButton: element(),
    voiceSettingsPanel: element({ hidden: true }),
    voiceSettingsClose: element(),
    inactivitySelect: element({ value: '' }),
    inactivityCustomRow: { hidden: true },
    inactivityCustomInput: customInput,
    inactivityNote: {},
    providerLimitNote: {},
    providerField: {
      remove() {
        this.removed = true;
      },
    },
    status: {},
    detail: {},
    tierButton: {},
    costValue: {},
    helpDetail: {},
  };
  if (withPreview) {
    view.voicePreviewInput = element({ checked: true });
    view.voicePanel = element({ hidden: true, dataset: {} });
    view.previewPanel = element({ hidden: true });
    view.previewTab = element();
    view.settingsTab = element();
    view.previewEmpty = element({ hidden: true });
    const dock = { id: 'command-dock' };
    view.root.id = 'gev-voice-control';
    view.root.parentElement = view.providerField.parentElement = dock;
    view.card = element({ hidden: false });
    view.root.preview = view.card;
    const panelElements = [
      view.voicePanel,
      view.previewPanel,
      view.voiceSettingsPanel,
      view.previewTab,
      view.settingsTab,
      view.card,
    ];
    view.root.contains = (candidate) => panelElements.includes(candidate);
    view.voicePanel.contains = (candidate) =>
      panelElements.includes(candidate) ||
      candidate === view.inactivityCustomInput;
    view.voiceSettingsPanel.contains = (candidate) =>
      candidate === view.inactivityCustomInput;
    view.previewPanel.contains = (candidate) => candidate === view.card;
    view.providerField.classList = {
      contains: (name) => name === 'gev-voice-provider-field',
    };
    view.voiceSettingsPanel.classList = {
      contains: (name) => name === 'gev-voice-settings-panel',
    };
    view.card.classList = { contains: (name) => name === 'gev-voice-card' };
  }
  return view;
}
function setup(
  t,
  {
    value = null,
    runner = async () => ({ ok: true }),
    deferredStart,
    startGate,
    startOptionsAvailable = true,
    withPreview = false,
    previewPreference,
    previewStorageBlocked = false,
    inactivityPreference,
    inactivityStorageBlocked = false,
    storedValues = new Map(),
  } = {},
) {
  const prior = globalThis.window;
  globalThis.window = new EventTarget();
  const lifetime = new AbortController();
  const hooks = {};
  const starts = [];
  const stops = [];
  const views = [];
  const sourceEvents = [];
  const mountedControls = [];
  const instances = [];
  const values = storedValues;
  const storageWrites = [];
  if (value != null) values.set('gev.voice.provider', value);
  if (typeof previewPreference === 'boolean')
    values.set(VOICE_PREVIEW_STORAGE_KEY, String(previewPreference));
  if (inactivityPreference !== undefined)
    values.set(
      VOICE_INACTIVITY_STORAGE_KEY,
      inactivityPreference === null ? 'none' : String(inactivityPreference),
    );
  const storage = {
    getItem: (key) => {
      if (previewStorageBlocked && key === VOICE_PREVIEW_STORAGE_KEY)
        throw new Error('Preview storage unavailable');
      if (inactivityStorageBlocked && key === VOICE_INACTIVITY_STORAGE_KEY)
        throw new Error('Inactivity storage unavailable');
      return values.get(key) ?? null;
    },
    setItem: (key, next) => {
      if (previewStorageBlocked && key === VOICE_PREVIEW_STORAGE_KEY)
        throw new Error('Preview storage unavailable');
      if (inactivityStorageBlocked && key === VOICE_INACTIVITY_STORAGE_KEY)
        throw new Error('Inactivity storage unavailable');
      storageWrites.push([key, next]);
      values.set(key, next);
    },
  };
  const factories = Object.fromEntries(
    ['openai', 'gemini'].map((provider) => [
      provider,
      (h) => {
        hooks[provider] = h;
        let startGeneration = 0;
        const instance = {
          provider,
          id: instances.length,
          hooks: h,
          startSettings: [],
          stopSettings: [],
          starts: [],
          input: { pushToTalkMode: false, pushToTalkKeyHeld: false },
          microphoneEnabled: false,
        };
        instances.push(instance);
        const adapter = {
          capabilities: {
            costControls: provider === 'openai',
            pushToTalk: true,
          },
          start: (settings = {}) => {
            const generation = ++startGeneration;
            starts.push(provider);
            instance.startSettings.push({ ...settings });
            instance.input.pushToTalkMode = Boolean(settings.pushToTalk);
            h.emit({ type: 'state', state: 'connecting', detail: provider });
            const promise = (async () => {
              const gate =
                startGate?.(instance) ??
                (provider === 'openai' ? deferredStart : null);
              if (gate) await gate;
              // Real adapters own a startup generation and suppress work after
              // stop/disposal. Model that contract, not an impossible late emit.
              if (generation !== startGeneration || h.signal.aborted) return;
              instance.microphoneEnabled =
                !instance.input.pushToTalkMode ||
                instance.input.pushToTalkKeyHeld;
              h.emit({ type: 'state', state: 'listening', detail: provider });
            })();
            instance.starts.push(promise);
            return promise;
          },
          stop: (settings = {}) => {
            startGeneration++;
            stops.push(provider);
            instance.stopSettings.push({ ...settings });
            instance.input.pushToTalkMode = false;
            instance.input.pushToTalkKeyHeld = false;
            instance.microphoneEnabled = false;
          },
          sendText: (text) => provider + ':' + text,
          sendMapEvent: () => true,
        };
        if (startOptionsAvailable)
          adapter.getStartOptions = () => ({
            pushToTalk: instance.input.pushToTalkMode,
          });
        instance.adapter = adapter;
        return adapter;
      },
    ]),
  );
  const controls = createProviderCommands(
    {
      runner,
      signal: lifetime.signal,
      createControl: () => {
        const view = control(withPreview);
        views.push(view);
        return view;
      },
      createCard: () => ({
        enabled: true,
        setEnabled(value) {
          this.enabled = value;
        },
        handle() {},
        destroy() {},
      }),
    },
    {
      bind: (options) => {
        sourceEvents.push(options.onSessionEvent);
        const mounted = bind(options);
        mountedControls.push(mounted);
        return mounted;
      },
      factories,
      storage,
    },
  );
  t.after(() => {
    controls.destroy();
    globalThis.window = prior;
  });
  return {
    controls,
    hooks,
    starts,
    stops,
    views,
    sourceEvents,
    mountedControls,
    instances,
    storageWrites,
    lifetime,
    stored: () => values.get('gev.voice.provider') ?? null,
    storedValue: (key) => values.get(key) ?? null,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settleStarts(instance) {
  await Promise.allSettled(instance.starts);
  await Promise.resolve(); // Let createVoiceSession publish any caught failure.
}

test('provider preference defaults to OpenAI and ignores invalid or unavailable storage', () => {
  assert.equal(readVoiceProvider({ getItem: () => 'gemini' }), 'gemini');
  for (const value of [null, '', 'other', 'GEMINI']) {
    assert.equal(readVoiceProvider({ getItem: () => value }), 'openai');
  }
  assert.equal(
    readVoiceProvider({
      getItem() {
        throw new Error('denied');
      },
    }),
    'openai',
  );
});

test('selector stops the active provider, persists the choice, and keeps one public facade', async (t) => {
  const f = setup(t);
  const original = f.controls;
  await original.start();
  assert.equal(original.status, 'listening');
  assert.equal(f.views[0].tierButton.hidden, false);
  assert.equal(original.setVoiceSettingsOpen(true), true);
  assert.equal(f.views[0].voiceSettingsPanel.hidden, false);
  assert.equal(original.setVoiceInactivityMinutes(3), true);
  assert.equal(f.views[0].inactivitySelect.value, '3');
  assert.equal(f.storedValue(VOICE_INACTIVITY_STORAGE_KEY), '3');
  f.views[0].providerSelect.value = 'gemini';
  f.views[0].providerSelect.dispatchEvent(new Event('change'));
  assert.equal(window.__gevVoiceCommands, original);
  assert.equal(original.provider, 'gemini');
  assert.equal(f.stored(), 'gemini');
  assert.equal(f.views[0].root.removed, true);
  assert.equal(f.views[0].providerField.removed, true);
  assert.equal(f.views[1].tierButton.hidden, true);
  assert.equal(f.views[1].voiceSettingsPanel.hidden, false);
  assert.equal(
    f.views[1].voiceSettingsButton.attributes['aria-expanded'],
    'true',
  );
  assert.deepEqual(f.starts, ['openai', 'gemini']);
  assert.deepEqual(f.instances[1].startSettings, [{ pushToTalk: false }]);
  assert.equal(original.sendTextCommand('hello'), 'gemini:hello');
  assert.equal(original.status, 'listening');
  assert.deepEqual(f.stops, ['openai']);
  f.views[0].providerSelect.value = 'openai';
  f.views[0].providerSelect.dispatchEvent(new Event('change'));
  assert.equal(
    original.provider,
    'gemini',
    'old selector listener was released',
  );
});

test('the shared action runner keeps its identity and remains callable across provider switches', async (t) => {
  const calls = [];
  const result = { ok: true, hudVariant: 'minimal' };
  const runner = async (...args) => {
    calls.push(args);
    return result;
  };
  const f = setup(t, { runner });
  const args = { variant: 'minimal' };
  const options = { signal: new AbortController().signal };
  for (const provider of ['openai', 'gemini', 'openai']) {
    f.controls.setProvider(provider);
    assert.equal(f.controls.runner, runner);
    assert.equal(window.__gevVoiceCommands.runner, runner);
    assert.equal(
      await f.controls.runner('set_hud_variant', args, options),
      result,
    );
    assert.equal(f.controls.status, 'idle');
  }
  assert.deepEqual(
    calls,
    Array.from({ length: 3 }, () => ['set_hud_variant', args, options]),
  );
  assert.deepEqual(
    f.starts,
    [],
    'direct map actions do not start a voice connection',
  );
});

test('switch during tool execution aborts old work without disturbing the new session', async (t) => {
  let resolve;
  let actionSignal;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const f = setup(t, {
    runner: async (_name, _args, options) => {
      actionSignal = options.signal;
      return pending;
    },
  });
  await f.controls.start();
  const oldAction = f.hooks.openai.runAction('fly_to_location', {});
  f.controls.setProvider('gemini');
  assert.equal(actionSignal.aborted, true);
  assert.deepEqual(f.starts, ['openai', 'gemini']);
  resolve({ ok: true });
  await assert.rejects(oldAction, { name: 'AbortError' });
  assert.equal(f.controls.status, 'listening');
  assert.equal(f.controls.provider, 'gemini');
});

test('provider swaps retain the shared runner and facade lifetime until final teardown', async (t) => {
  let disposed = false;
  let disposals = 0;
  let resets = 0;
  const runner = async () => {
    assert.equal(
      disposed,
      false,
      'replacement must not permanently dispose the runner',
    );
    return { ok: true };
  };
  runner.resetConversation = () => resets++;
  runner.dispose = () => {
    disposed = true;
    disposals++;
  };
  const f = setup(t, { runner });
  const lifetime = f.controls.signal;
  let lifetimeAborts = 0;
  lifetime.addEventListener('abort', () => lifetimeAborts++);
  await f.controls.start();
  for (const provider of ['gemini', 'openai']) {
    const outgoing = f.controls.session.signal;
    f.controls.setProvider(provider);
    assert.equal(outgoing.aborted, true);
    assert.equal(f.controls.signal, lifetime);
    assert.equal(lifetime.aborted, false);
    assert.equal(disposals, 0);
    assert.equal(f.controls.status, 'listening');
    assert.deepEqual(await f.hooks[provider].runAction('zoom_to_globe', {}), {
      ok: true,
    });
  }
  assert.equal(resets, 2, 'each retired adapter forgets conversation state');
  f.controls.destroy();
  f.controls.destroy();
  f.controls.stop({ removeUi: true });
  f.lifetime.abort();
  assert.equal(lifetime.aborted, true);
  assert.equal(lifetimeAborts, 1);
  assert.equal(disposals, 1);
});

test('late startup cannot revive a replaced provider; app teardown removes the latest controls', async (t) => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const f = setup(t, { deferredStart: pending });
  const first = f.controls.start();
  f.controls.setProvider('gemini');
  assert.deepEqual(f.starts, ['openai', 'gemini']);
  resolve();
  await first;
  assert.equal(f.controls.status, 'listening');
  assert.equal(f.views[1].detail.textContent, 'gemini');
  f.lifetime.abort();
  assert.equal(f.controls.disposed, true);
  assert.equal(f.views[1].root.removed, true);
  assert.equal(f.views[1].providerField.removed, true);
  assert.equal(f.controls.setProvider('openai'), false);
  assert.equal(f.controls.start(), false);
  assert.equal(f.controls.sendTextCommand('late'), false);
});

test('restored Gemini choice retains the action runner without creating duplicate lifetimes', async (t) => {
  const result = { ok: true, hudVariant: 'tactical' };
  const runner = async (name) => {
    assert.equal(name, 'get_current_view_state');
    return result;
  };
  const f = setup(t, { value: 'gemini', runner });
  assert.equal(f.controls.provider, 'gemini');
  assert.equal(f.controls.runner, runner);
  assert.equal(await f.controls.runner('get_current_view_state'), result);
  assert.equal(f.controls.setProvider('gemini'), false);
  assert.equal(f.controls.setProvider('unrecognized'), false);
  assert.equal(f.views.length, 1);
  assert.deepEqual(f.starts, []);
});

test('a voice-requested OpenAI provider change waits for drained reply, then remounts once', async (t) => {
  const f = setup(t);
  await f.controls.start();

  assert.deepEqual(f.controls.requestProviderChange('gemini'), {
    ok: true,
    changed: true,
    pending: true,
    previousProvider: 'openai',
  });
  assert.equal(f.controls.provider, 'openai');
  assert.equal(f.views.length, 1);
  assert.deepEqual(f.starts, ['openai']);

  f.hooks.openai.emit({
    type: 'completion',
    status: 'completed',
  });
  assert.equal(
    f.controls.provider,
    'openai',
    'generation completion is not playback completion',
  );
  f.hooks.openai.emit({
    type: 'reply-complete',
    status: 'completed',
  });
  assert.equal(f.controls.provider, 'gemini');
  assert.equal(f.views.length, 2);
  assert.equal(f.stored(), 'gemini');
  assert.deepEqual(f.stops, ['openai']);
  assert.deepEqual(f.starts, ['openai', 'gemini']);
  assert.equal(f.controls.status, 'listening');
});

test('Gemini switches after drained completion and a newer user turn cancels a queued switch', async (t) => {
  const f = setup(t, { value: 'gemini' });
  await f.controls.start();
  assert.equal(f.controls.requestProviderChange('openai').pending, true);
  f.hooks.gemini.emit({ type: 'interruption', reason: 'user-speech' });
  f.hooks.gemini.emit({ type: 'completion', status: 'completed' });
  assert.equal(f.controls.provider, 'gemini');
  assert.equal(f.controls.requestProviderChange('openai').pending, true);
  f.hooks.gemini.emit({ type: 'completion', status: 'completed' });
  assert.equal(f.controls.provider, 'openai');
  assert.equal(f.views.length, 2);
  assert.deepEqual(f.starts, ['gemini', 'openai']);
  assert.equal(f.controls.status, 'listening');
});

test('a retired observer cannot complete or cancel the successor provider request', async (t) => {
  const f = setup(t);
  const retired = f.sourceEvents[0];
  f.controls.setProvider('gemini');
  await f.controls.start();
  assert.equal(f.controls.requestProviderChange('openai').pending, true);
  retired({ type: 'completion', status: 'completed' });
  retired({ type: 'interruption', reason: 'user-speech' });
  assert.equal(f.controls.provider, 'gemini');
  f.sourceEvents[1]({ type: 'completion', status: 'completed' });
  assert.equal(f.controls.provider, 'openai');
});

test('provider replacement preserves a shared seven-minute inactivity preference', (t) => {
  const f = setup(t, { withPreview: true });
  const first = f.views[0];
  assert.equal(first.inactivitySelect.value, '5');
  first.inactivitySelect.value = 'custom';
  first.inactivitySelect.dispatchEvent(new Event('change'));
  first.inactivityCustomInput.value = '7';
  first.inactivityCustomInput.dispatchEvent(new Event('input'));
  assert.equal(f.storedValue(VOICE_INACTIVITY_STORAGE_KEY), '7');
  for (const provider of ['gemini', 'openai']) {
    f.controls.setProvider(provider);
    const view = f.views.at(-1);
    assert.equal(f.controls.getVoiceInactivityMinutes(), 7);
    assert.equal(view.inactivitySelect.value, 'custom');
    assert.equal(view.inactivityCustomInput.value, '7');
    assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
  }
  assert.deepEqual(f.starts, []);
});

test('both providers retain usable settings through terminal routes', async (t) => {
  for (const provider of ['openai', 'gemini']) {
    for (const route of [
      'public-stop',
      'session-stop',
      'session-preserve-status',
      'preserve-status',
      'button-stop',
      'error',
      'goAway',
    ]) {
      await t.test(`${provider}: ${route}`, async (t) => {
        const f = setup(t, { value: provider, withPreview: true });
        await f.controls.start();
        f.controls.setVoiceInactivityMinutes(12);
        f.controls.setVoiceSettingsOpen(true);
        assert.equal(f.controls.deferVoiceSettingsUntilCockpitExit(), true);
        const view = f.views[0];
        view.voiceSettingsPanel.ownerDocument = {
          activeElement: view.inactivityCustomInput,
        };
        view.voiceSettingsPanel.contains = (candidate) =>
          candidate === view.inactivityCustomInput;
        if (route === 'public-stop') f.controls.stop();
        if (route === 'session-stop') f.controls.session.stop();
        if (route === 'session-preserve-status')
          f.controls.session.stop({ preserveStatus: true });
        if (route === 'preserve-status')
          f.controls.stop({ preserveStatus: true });
        if (route === 'button-stop')
          view.button.dispatchEvent(new Event('click'));
        if (route === 'error' || route === 'goAway') {
          f.hooks[provider].emit({
            type: 'state',
            state: 'error',
            detail: route,
          });
        }
        globalThis.window.dispatchEvent(
          new CustomEvent('gev:cockpit-mode-changed', {
            detail: { active: false },
          }),
        );
        await Promise.resolve();
        assert.equal(view.voiceSettingsPanel.hidden, false);
        assert.equal(
          view.voiceSettingsButton.attributes['aria-expanded'],
          'true',
        );
        assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
        assert.equal(f.controls.setVoiceInactivityMinutes(7), true);
        assert.equal(f.controls.getVoiceInactivityMinutes(), 7);
        assert.equal(f.storedValue(VOICE_INACTIVITY_STORAGE_KEY), '7');
        if (!['preserve-status', 'session-preserve-status'].includes(route))
          assert.equal(f.controls.isActive(), false);
      });
    }
  }
});

test('terminal provider replacement selects settings without restarting voice', async (t) => {
  for (const provider of ['openai', 'gemini']) {
    for (const route of [
      'public-stop',
      'session-stop',
      'preserve-status',
      'session-preserve-status',
      'error',
    ]) {
      await t.test(`${provider}: ${route}`, async (t) => {
        const f = setup(t, { value: provider, withPreview: true });
        await f.controls.start();
        f.controls.setVoiceSettingsOpen(true);
        const successor = provider === 'openai' ? 'gemini' : 'openai';
        assert.equal(f.controls.requestProviderChange(successor).pending, true);
        if (route === 'public-stop') f.controls.stop();
        if (route === 'session-stop') f.controls.session.stop();
        if (route === 'preserve-status')
          f.controls.stop({ preserveStatus: true });
        if (route === 'session-preserve-status')
          f.controls.session.stop({ preserveStatus: true });
        if (route === 'error')
          f.hooks[provider].emit({ type: 'state', state: 'error' });
        assert.equal(f.controls.provider, successor);
        assert.equal(f.views.length, 2);
        assert.equal(f.controls.status, 'idle');
        assert.deepEqual(
          f.starts,
          [provider],
          'terminal selection must not restart voice',
        );
        assert.equal(f.views[0].root.removed, true);
        assert.equal(f.views[1].voiceSettingsPanel.hidden, false);
        assert.equal(
          f.views[1].voiceSettingsButton.attributes['aria-expanded'],
          'true',
        );
        assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
      });
    }
  }
});

test('closing settings keeps voice active and disposed provider events cannot close its successor', async (t) => {
  for (const provider of ['openai', 'gemini']) {
    await t.test(provider, async (t) => {
      const f = setup(t, { value: provider, withPreview: true });
      await f.controls.start();
      f.controls.setVoiceSettingsOpen(true);
      f.views[0].voiceSettingsClose.dispatchEvent(new Event('click'));
      assert.equal(f.views[0].voiceSettingsPanel.hidden, true);
      assert.equal(f.controls.isActive(), true);
      assert.deepEqual(f.stops, []);
      f.controls.setVoiceSettingsOpen(true);
      const oldHooks = f.hooks[provider];
      f.controls.setProvider(provider === 'openai' ? 'gemini' : 'openai');
      assert.equal(f.controls.status, 'listening');
      const view = f.views[1];
      assert.equal(view.voiceSettingsPanel.hidden, false);
      for (const event of [
        { type: 'state', state: 'error' },
        { type: 'state', state: 'idle' },
        { type: 'completion', status: 'completed' },
      ])
        oldHooks.emit(event);
      assert.equal(view.voiceSettingsPanel.hidden, false);
      assert.equal(
        view.voiceSettingsButton.attributes['aria-expanded'],
        'true',
      );
      assert.equal(f.controls.state, 'listening');
    });
  }
});

for (const provider of ['openai', 'gemini']) {
  test(`${provider} button activation resumes exactly once after a selector change`, async (t) => {
    const f = setup(t, { value: provider });
    const successor = provider === 'openai' ? 'gemini' : 'openai';
    f.views[0].button.dispatchEvent(new Event('click'));
    assert.equal(f.controls.state, 'listening');
    assert.deepEqual(f.instances[0].startSettings, [{ pushToTalk: false }]);
    f.views[0].providerSelect.value = successor;
    f.views[0].providerSelect.dispatchEvent(new Event('change'));
    assert.equal(f.controls.provider, successor);
    assert.equal(f.controls.state, 'listening');
    assert.deepEqual(f.starts, [provider, successor]);
    assert.deepEqual(f.instances[1].startSettings, [{ pushToTalk: false }]);
    await f.controls.start();
    assert.deepEqual(
      f.starts,
      [provider, successor],
      'an already active successor is not started twice',
    );
  });
}

for (const route of [
  'public-stop',
  'session-stop',
  'button-stop',
  'preserve-status',
  'session-preserve-status',
]) {
  test(`provider selection stays OFF after ${route}, even if a stale active state arrives`, async (t) => {
    const f = setup(t, { withPreview: true });
    await f.controls.start();
    f.controls.selectVoicePanelView('settings');
    if (route === 'public-stop') f.controls.stop();
    if (route === 'session-stop') f.controls.session.stop();
    if (route === 'button-stop')
      f.views[0].button.dispatchEvent(new Event('click'));
    if (route === 'preserve-status') f.controls.stop({ preserveStatus: true });
    if (route === 'session-preserve-status')
      f.controls.session.stop({ preserveStatus: true });
    // A stopped adapter may still have a queued presentation event. It must
    // not re-create the user's ON intent without a new connecting transition.
    f.hooks.openai.emit({
      type: 'state',
      state: 'listening',
      detail: 'late display state',
    });
    f.hooks.openai.emit({
      type: 'transcript',
      role: 'user',
      text: 'Show flights over London',
      final: true,
    });
    assert.equal(
      f.controls.getVoicePanelOrderState().view,
      'settings',
      'stale activity cannot rearm presentation after Stop',
    );
    f.controls.setProvider('gemini');
    assert.equal(f.controls.provider, 'gemini');
    assert.equal(f.controls.state, 'idle');
    assert.deepEqual(f.starts, ['openai']);
    assert.deepEqual(f.instances[1].startSettings, []);
  });
}

test('a rejected old connect cannot stop the automatically connecting successor', async (t) => {
  const oldGate = deferred();
  const nextGate = deferred();
  const f = setup(t, {
    startGate: ({ id }) => (id === 0 ? oldGate.promise : nextGate.promise),
  });
  const first = f.controls.start();
  assert.equal(f.controls.state, 'connecting');
  f.controls.setProvider('gemini');
  assert.deepEqual(f.starts, ['openai', 'gemini']);
  assert.equal(f.controls.state, 'connecting');
  oldGate.reject(new Error('retired connect failed'));
  await first;
  assert.equal(f.controls.provider, 'gemini');
  assert.equal(f.controls.state, 'connecting');
  assert.deepEqual(f.instances[1].stopSettings, []);
  nextGate.resolve();
  await settleStarts(f.instances[1]);
  assert.equal(f.controls.state, 'listening');
});

test('rapid active switches start each replacement once and only the newest mount can finish', async (t) => {
  const gates = [deferred(), deferred(), deferred()];
  const f = setup(t, { startGate: ({ id }) => gates[id].promise });
  const first = f.controls.start();
  f.controls.setProvider('gemini');
  f.controls.setProvider('openai');
  assert.equal(f.controls.provider, 'openai');
  assert.equal(f.controls.state, 'connecting');
  assert.deepEqual(f.starts, ['openai', 'gemini', 'openai']);
  assert.equal(f.instances[0].hooks.signal.aborted, true);
  assert.equal(f.instances[1].hooks.signal.aborted, true);
  assert.equal(f.instances[2].hooks.signal.aborted, false);
  gates[1].resolve();
  gates[0].resolve();
  await first;
  await settleStarts(f.instances[1]);
  for (const instance of f.instances.slice(0, 2)) {
    instance.hooks.emit({ type: 'state', state: 'error', detail: 'retired' });
    instance.hooks.emit({ type: 'state', state: 'listening' });
  }
  assert.equal(f.controls.state, 'connecting');
  gates[2].resolve();
  await settleStarts(f.instances[2]);
  assert.equal(f.controls.state, 'listening');
  assert.equal(f.controls.session.signal, f.instances[2].hooks.signal);
  assert.deepEqual(
    f.instances.map((instance) => instance.startSettings.length),
    [1, 1, 1],
  );
});

for (const route of [
  'public-stop',
  'session-stop',
  'button-stop',
  'destroy',
  'parent-abort',
]) {
  test(`${route} defeats an automatic successor startup that has not settled`, async (t) => {
    const nextGate = deferred();
    const f = setup(t, {
      startGate: ({ provider }) =>
        provider === 'gemini' ? nextGate.promise : null,
    });
    await f.controls.start();
    f.controls.setProvider('gemini');
    assert.deepEqual(f.starts, ['openai', 'gemini']);
    assert.equal(f.controls.state, 'connecting');
    if (route === 'public-stop') f.controls.stop();
    if (route === 'session-stop') f.controls.session.stop();
    if (route === 'button-stop')
      f.views[1].button.dispatchEvent(new Event('click'));
    if (route === 'destroy') f.controls.destroy();
    if (route === 'parent-abort') f.lifetime.abort();
    nextGate.resolve();
    await settleStarts(f.instances[1]);
    assert.equal(f.controls.state, 'idle');
    assert.equal(f.instances[1].microphoneEnabled, false);
    assert.equal(f.instances[1].stopSettings.length, 1);
    assert.deepEqual(f.starts, ['openai', 'gemini']);
    if (route === 'destroy' || route === 'parent-abort') {
      assert.equal(f.controls.disposed, true);
      assert.equal(f.views[1].root.removed, true);
    } else {
      f.controls.setProvider('openai');
      assert.equal(f.controls.state, 'idle');
      assert.deepEqual(f.starts, ['openai', 'gemini']);
    }
  });
}

test('failed automatic startup keeps the selected provider in error without fallback or retries', async (t) => {
  const nextGate = deferred();
  const f = setup(t, {
    withPreview: true,
    startGate: ({ provider }) =>
      provider === 'gemini' ? nextGate.promise : null,
  });
  await f.controls.start();
  f.controls.setProvider('gemini');
  assert.equal(f.controls.state, 'connecting');
  assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
  nextGate.reject(new Error('Microphone permission denied'));
  await settleStarts(f.instances[1]);
  assert.equal(f.controls.provider, 'gemini');
  assert.equal(f.stored(), 'gemini');
  assert.equal(f.controls.state, 'error');
  assert.equal(f.controls.getVoicePanelOrderState().settingsOpen, true);
  assert.equal(f.views[1].detail.textContent, 'Microphone permission denied');
  assert.equal(f.instances[0].hooks.signal.aborted, true);
  assert.deepEqual(f.instances[1].stopSettings, [{ preserveStatus: true }]);
  assert.deepEqual(f.starts, ['openai', 'gemini']);
  f.controls.setProvider('openai');
  assert.equal(f.controls.state, 'idle', 'failure cleared the resume intent');
  assert.deepEqual(f.starts, ['openai', 'gemini']);
});

for (const provider of ['openai', 'gemini']) {
  for (const pushToTalk of [false, true]) {
    test(`${provider} direct adapter activation preserves ${pushToTalk ? 'PTT' : 'open-mic'} mode without transferring a held key`, async (t) => {
      const f = setup(t, { value: provider });
      const original = f.instances[0];
      original.input.pushToTalkKeyHeld = pushToTalk;
      // Native PTT starts the controller rather than facade.start(). The
      // adapter emits connecting, then the common session observes its state.
      await original.adapter.start({ pushToTalk });
      assert.equal(f.controls.state, 'listening');
      f.controls.setProvider(provider === 'openai' ? 'gemini' : 'openai');
      const successor = f.instances[1];
      assert.equal(f.controls.state, 'listening');
      assert.deepEqual(successor.startSettings, [{ pushToTalk }]);
      assert.equal(
        original.input.pushToTalkMode,
        false,
        'retirement resets the old input after its settings were captured',
      );
      assert.equal(successor.input.pushToTalkKeyHeld, false);
      assert.equal(
        successor.microphoneEnabled,
        !pushToTalk,
        'PTT waits muted for a new physical hold',
      );
    });
  }
}

test('an adapter without resume options still resumes an active session in open-mic mode', async (t) => {
  const f = setup(t, { startOptionsAvailable: false });
  await f.controls.start();
  f.controls.setProvider('gemini');
  assert.equal(f.controls.state, 'listening');
  assert.deepEqual(f.instances[1].startSettings, [{ pushToTalk: false }]);
});

for (const provider of ['openai', 'gemini']) {
  test(`${provider} facade delegates selected views to the current mount without transferring input ownership`, async (t) => {
    const f = setup(t, { value: provider, withPreview: true });
    await f.controls.start({ pushToTalk: true });
    f.controls.setVoiceSettingsOpen(true);
    const facade = f.controls;
    const order = facade.setVoicePanelOrder;
    const selectView = facade.selectVoicePanelView;
    const closeView = facade.closeVoicePanelView;
    const originalView = f.views[0];
    const originalSession = facade.session;
    const originalControls = f.mountedControls[0];
    const retiredSelect = originalControls.selectVoicePanelView;
    const retiredClose = originalControls.closeVoicePanelView;
    const oldHooks = f.hooks[provider];
    const inputBefore = { ...f.instances[0].input };
    const startsBefore = [...f.starts];
    const stopsBefore = [...f.stops];
    const writesBefore = [...f.storageWrites];
    const ordered = order('voice-settings', 'front');
    assert.equal(ordered.ok, true);
    assert.equal(ordered.changed, false);
    assert.equal(ordered.view, 'settings');
    assert.equal(ordered.frontPanelId, 'voice-settings');
    assert.equal(ordered.settingsOpen, true);
    assert.equal(ordered.previewVisible, false);
    assert.equal(ordered.previewEnabled, true);
    oldHooks.emit({ type: 'interruption' });
    assert.equal(originalView.settingsTab.attributes['aria-selected'], 'true');
    assert.deepEqual(f.instances[0].input, inputBefore);
    assert.deepEqual(f.starts, startsBefore);
    assert.deepEqual(f.stops, stopsBefore);
    assert.deepEqual(f.storageWrites, writesBefore);
    assert.equal(f.controls.provider, provider);
    assert.equal(selectView('preview').view, 'preview');
    assert.equal(originalView.voiceSettingsPanel.hidden, true);
    assert.equal(originalView.previewPanel.hidden, false);
    assert.equal(closeView('settings').changed, false);
    assert.equal(closeView('preview').panelOpen, false);
    assert.equal(facade.session, originalSession);
    assert.deepEqual(f.instances[0].input, inputBefore);
    assert.deepEqual(f.starts, startsBefore);
    assert.deepEqual(f.stops, stopsBefore);
    assert.deepEqual(f.storageWrites, writesBefore);

    const successor = provider === 'openai' ? 'gemini' : 'openai';
    f.controls.setProvider(successor);
    assert.equal(f.controls, facade);
    assert.equal(originalView.root.removed, true);
    assert.equal(originalSession.disposed, true);
    assert.notEqual(facade.session, originalSession);
    const nextView = f.views[1];
    assert.equal(nextView.voiceSettingsPanel.hidden, false);
    assert.equal(nextView.previewPanel.hidden, true);
    assert.equal(nextView.settingsTab.attributes['aria-selected'], 'true');
    assert.equal(retiredSelect('preview').reason, 'disposed');
    assert.equal(retiredClose('settings').reason, 'disposed');
    assert.equal(
      selectView('preview').ok,
      true,
      'a retained facade method targets the new provider',
    );
    assert.equal(nextView.previewTab.attributes['aria-selected'], 'true');
    assert.equal(selectView('settings').view, 'settings');
    assert.equal(order('voice-settings', 'front').ok, true);
    oldHooks.emit({ type: 'state', state: 'idle' });
    oldHooks.emit({ type: 'interruption' });
    f.hooks[successor].emit({ type: 'interruption' });
    assert.equal(nextView.settingsTab.attributes['aria-selected'], 'true');
    f.controls.destroy();
    for (const invoke of [
      () => order('voice-preview', 'front'),
      () => selectView('preview'),
      () => closeView('settings'),
    ]) {
      const refused = invoke();
      assert.equal(refused.ok, false);
      assert.equal(refused.reason, 'disposed');
      assert.equal(refused.frontPanelId, null);
      assert.equal(refused.settingsOpen, false);
      assert.equal(refused.previewVisible, false);
    }
  });
}

for (const provider of ['openai', 'gemini']) {
  for (const previewStorageBlocked of [false, true]) {
    test(`${provider} preview preference survives an idle provider remount with ${previewStorageBlocked ? 'blocked' : 'working'} storage`, (t) => {
      const f = setup(t, {
        value: provider,
        withPreview: true,
        previewStorageBlocked,
      });
      const setter = f.controls.setVoicePreviewEnabled;
      const getter = f.controls.getVoicePreviewEnabled;
      const original = f.mountedControls[0];
      const retiredSetter = original.setVoicePreviewEnabled;
      original.voiceCard.content = 'Old provider content';
      const inputBefore = { ...f.instances[0].input };
      assert.equal(f.views[0].voiceSettingsPanel.hidden, true);
      assert.deepEqual(setter(false), {
        ok: true,
        enabled: false,
        changed: true,
        persisted: !previewStorageBlocked,
        previewVisible: false,
      });
      assert.equal(getter(), false);
      assert.equal(f.views[0].voicePreviewInput.checked, false);
      assert.equal(original.voiceCard.enabled, false);
      assert.deepEqual(f.instances[0].input, inputBefore);
      assert.deepEqual(f.starts, []);
      assert.deepEqual(f.stops, []);
      const previewWrites = () =>
        f.storageWrites.filter(([key]) => key === VOICE_PREVIEW_STORAGE_KEY);
      const writesBefore = [...previewWrites()];
      f.controls.setProvider(provider === 'openai' ? 'gemini' : 'openai');
      const successor = f.mountedControls[1];
      assert.equal(f.controls.state, 'idle');
      assert.deepEqual(
        f.starts,
        [],
        'carrying a presentation preference does not start voice',
      );
      assert.equal(getter(), false, 'the live choice survives storage failure');
      assert.equal(f.views[1].voicePreviewInput.checked, false);
      assert.equal(successor.voiceCard.enabled, false);
      assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
      assert.equal(f.views[1].voiceSettingsPanel.hidden, false);
      assert.equal(f.views[1].previewPanel.hidden, true);
      assert.notEqual(successor.voiceCard, original.voiceCard);
      assert.equal(successor.voiceCard.content, undefined);
      assert.deepEqual(
        previewWrites(),
        writesBefore,
        'remount does not persist again',
      );
      assert.equal(original.getVoicePreviewEnabled(), undefined);
      assert.equal(retiredSetter(true).reason, 'disposed');
      f.views[0].voicePreviewInput.checked = true;
      f.views[0].voicePreviewInput.dispatchEvent(new Event('change'));
      assert.equal(getter(), false);
      assert.deepEqual(previewWrites(), writesBefore);
      assert.equal(setter('false').reason, 'invalid-enabled');
      assert.equal(getter(), false);
      assert.equal(setter(true).persisted, !previewStorageBlocked);
      assert.equal(
        getter(),
        true,
        'retained facade setter targets current controls',
      );
      assert.equal(f.views[1].voicePreviewInput.checked, true);
      f.views[1].voicePreviewInput.checked = false;
      f.views[1].voicePreviewInput.dispatchEvent(new Event('change'));
      assert.equal(
        getter(),
        false,
        'checkbox commits through the same preference controller',
      );
      const writesBeforeDestroy = [...f.storageWrites];
      f.controls.destroy();
      assert.equal(getter(), undefined);
      assert.deepEqual(setter(true), {
        ok: false,
        enabled: null,
        changed: false,
        reason: 'disposed',
        error: 'Voice Preview controls are no longer available.',
      });
      assert.deepEqual(f.storageWrites, writesBeforeDestroy);
    });
  }
}

test('saved preview-off preference survives active provider replacement without an extra voice start', async (t) => {
  const f = setup(t, { withPreview: true, previewPreference: false });
  assert.equal(f.controls.getVoicePreviewEnabled(), false);
  await f.controls.start({ pushToTalk: true });
  const starts = [...f.starts];
  const input = { ...f.instances[0].input };
  assert.equal(f.controls.setVoicePreviewEnabled(false).changed, false);
  assert.deepEqual(f.starts, starts);
  assert.deepEqual(f.instances[0].input, input);
  f.controls.setProvider('gemini');
  assert.equal(f.controls.getVoicePreviewEnabled(), false);
  assert.equal(f.views[1].voicePreviewInput.checked, false);
  assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
  assert.equal(f.views[1].settingsTab.attributes['aria-selected'], 'true');
  assert.equal(f.controls.state, 'listening');
  assert.deepEqual(f.starts, ['openai', 'gemini']);
  assert.deepEqual(f.instances[1].startSettings, [{ pushToTalk: true }]);
});

for (const provider of ['openai', 'gemini']) {
  test(`${provider} actual replacement selects Settings from closed or selected Preview`, (t) => {
    const f = setup(t, { value: provider, withPreview: true });
    assert.equal(f.controls.getVoicePanelOrderState().panelOpen, false);
    const successor = provider === 'openai' ? 'gemini' : 'openai';
    assert.equal(f.controls.setProvider(successor), true);
    assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
    assert.equal(f.controls.getVoicePanelOrderState().panelOpen, true);
    f.controls.selectVoicePanelView('preview');
    assert.equal(f.controls.setProvider(successor), false);
    assert.equal(
      f.controls.getVoicePanelOrderState().view,
      'preview',
      'same-provider selection does not invent a replacement intent',
    );
    assert.equal(f.controls.setProvider(provider), true);
    assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
    assert.equal(f.views.at(-1).previewPanel.hidden, true);
    assert.equal(f.views.at(-1).voiceSettingsPanel.hidden, false);
    assert.deepEqual(f.starts, []);
    assert.equal(f.controls.state, 'idle');
  });

  for (const minutes of [7, null]) {
    test(`${provider} carries live Preview and ${minutes ?? 'None'}-minute inactivity choices when preference storage is blocked`, (t) => {
      const f = setup(t, {
        value: provider,
        withPreview: true,
        previewStorageBlocked: true,
        inactivityStorageBlocked: true,
      });
      assert.equal(f.controls.setVoicePreviewEnabled(false).persisted, false);
      assert.equal(f.controls.setVoiceInactivityMinutes(minutes), true);
      assert.equal(f.controls.getVoiceInactivityMinutes(), minutes);
      const retired = f.mountedControls[0];
      const retiredInactivity = retired.setVoiceInactivityMinutes;
      const successor = provider === 'openai' ? 'gemini' : 'openai';
      for (const next of [successor, provider]) {
        f.controls.setProvider(next);
        assert.equal(f.controls.getVoicePreviewEnabled(), false);
        assert.equal(f.controls.getVoiceInactivityMinutes(), minutes);
        assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
        const view = f.views.at(-1);
        assert.equal(view.voicePreviewInput.checked, false);
        assert.equal(
          view.inactivitySelect.value,
          minutes === null ? 'none' : 'custom',
        );
        if (minutes !== null)
          assert.equal(view.inactivityCustomInput.value, String(minutes));
      }
      retiredInactivity(23);
      assert.equal(f.controls.getVoiceInactivityMinutes(), minutes);
      assert.equal(f.storedValue(VOICE_INACTIVITY_STORAGE_KEY), null);
      assert.equal(f.storedValue(VOICE_PREVIEW_STORAGE_KEY), null);
      assert.deepEqual(f.starts, []);
    });
  }
}

test('a fresh mount reloads the shared seven-minute and Preview-off choices', async (t) => {
  const storedValues = new Map();
  await t.test('save shared preferences', (t) => {
    const f = setup(t, { withPreview: true, storedValues });
    f.controls.setVoiceInactivityMinutes(7);
    f.controls.setVoicePreviewEnabled(false);
    f.controls.setProvider('gemini');
    assert.equal(f.storedValue(VOICE_INACTIVITY_STORAGE_KEY), '7');
    assert.equal(f.storedValue(VOICE_PREVIEW_STORAGE_KEY), 'false');
    assert.deepEqual(f.starts, []);
  });
  await t.test('reload and replace without rewriting preferences', (t) => {
    const f = setup(t, { withPreview: true, storedValues });
    assert.equal(f.controls.provider, 'gemini');
    assert.equal(f.controls.getVoiceInactivityMinutes(), 7);
    assert.equal(f.controls.getVoicePreviewEnabled(), false);
    f.controls.setProvider('openai');
    assert.equal(f.controls.getVoiceInactivityMinutes(), 7);
    assert.equal(f.controls.getVoicePreviewEnabled(), false);
    assert.equal(f.controls.getVoicePanelOrderState().view, 'settings');
    assert.deepEqual(f.storageWrites, [['gev.voice.provider', 'openai']]);
    assert.deepEqual(f.starts, []);
  });
});

test('a retired inactivity setter cannot overwrite the current shared preference', (t) => {
  const f = setup(t, { withPreview: true });
  f.controls.setVoiceInactivityMinutes(7);
  const retiredSet = f.mountedControls[0].setVoiceInactivityMinutes;
  f.controls.setProvider('gemini');
  const writes = [...f.storageWrites];
  assert.equal(retiredSet(23), false);
  assert.equal(f.controls.getVoiceInactivityMinutes(), 7);
  assert.equal(f.storedValue(VOICE_INACTIVITY_STORAGE_KEY), '7');
  assert.deepEqual(f.storageWrites, writes);
});

test('facade refuses unavailable panel views without changing the session or preferences', (t) => {
  const f = setup(t);
  const session = f.controls.session;
  for (const method of ['selectVoicePanelView', 'closeVoicePanelView']) {
    const result = f.controls[method]('settings');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unavailable');
    assert.equal(result.panelOpen, false);
  }
  assert.equal(f.controls.session, session);
  assert.deepEqual(f.storageWrites, []);
  assert.deepEqual(f.starts, []);
  assert.deepEqual(f.stops, []);
});

test('facade refuses preview changes when the mounted control has no card', (t) => {
  const f = setup(t);
  assert.equal(f.controls.getVoicePreviewEnabled(), undefined);
  const result = f.controls.setVoicePreviewEnabled(false);
  assert.equal(result.ok, false);
  assert.equal(result.enabled, null);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'preview-unavailable');
  assert.deepEqual(f.storageWrites, []);
  assert.deepEqual(f.starts, []);
  assert.deepEqual(f.stops, []);
});
