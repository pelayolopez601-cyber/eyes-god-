// src/data/aircraftEmergencyAnalyst.test.mjs
// Source-to-analyst fixture: an OpenSky state vector squawking 7700 and an
// adsb.lol (readsb) aircraft whose ADS-B `emergency` field says `general`
// on an ordinary code must reach the analyst with the same kind but distinct
// provenance, so a summary never flattens one into the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSkySnapshot, readsbSnapshot } from '../sources/live/index.js';
import { FlightRecords } from '../layers/flights/records.js';
import { MilitaryFlightRecords } from '../layers/military/records.js';
import { mapAnalystRecord as mapFlight } from './flights.js';
import { mapAnalystRecord as mapMilitary } from './militaryFlights.js';
import { createAnalystEngine } from './analystEngine.js';
import { normalizeAdsbLolPointResponse } from './adsbLolFallback.js';
import { createGevActionRunner } from '../voice/gevActions.js';

const NOW_MS = 1800000000000;

test('fallback status belongs to the first valid admitted aircraft row', () => {
  const valid = { hex: 'a1b2c3', lat: 30, lon: -97, squawk: '1200' };
  for (const status of [undefined, 'general', 'none']) {
    const payload = normalizeAdsbLolPointResponse({
      now: NOW_MS,
      ac: [
        { ...valid, lat: 100, emergency: 'general' },
        { ...valid, emergency: status },
        { ...valid, lat: null, emergency: 'general' },
        { ...valid, emergency: status === 'general' ? 'none' : 'general' },
      ],
    });
    const snapshot = openSkySnapshot(payload, { now: NOW_MS });
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.records[0].emergency, status ?? null);
    assert.equal(snapshot.records[0].latitude, 30);
  }
});

function civilStore() {
  return new FlightRecords({
    geoidHeight: () => 0,
    cachedGroundFloor: () => null,
    floorAltitudeM: (value) => value,
    approxDistanceKm: () => 0,
  });
}
const receiveContext = {
  viewerLatDeg: null,
  viewerLonDeg: null,
  trackedId: null,
  floorWarmPoints: [],
};

test('real civil fallback preserves ADS-B emergency and priority, then clears', () => {
  const store = civilStore();
  const aircraft = {
    hex: 'a1b2c3',
    flight: 'TEST1',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    gs: 150,
    track: 90,
    squawk: '1200',
    seen: 3,
    seen_pos: 1,
  };
  for (const [status, expectedKind, flagged] of [
    ['general', 'general', true],
    ['minfuel', 'minfuel', false],
    ['none', null, false],
  ]) {
    const payload = normalizeAdsbLolPointResponse({
      now: NOW_MS,
      ac: [{ ...aircraft, emergency: status }],
    });
    assert.equal(
      payload.states[0].length,
      18,
      'fallback vectors retain the OpenSky shape',
    );
    const [observation] = openSkySnapshot(payload, { now: NOW_MS }).records;
    const result = mapFlight(
      aircraft.hex,
      store.receive(observation, receiveContext).meta,
    );
    assert.equal(result.emergency, flagged);
    assert.equal(result.emergencyKind, expectedKind);
    assert.equal(result.emergencySource, expectedKind ? 'ads-b' : null);
    assert.equal(result.lastContactAtMs, NOW_MS - 3000);
  }
});

test('changed status without contact time retains general contact, including voice projection', async () => {
  const store = civilStore();
  const [observation] = readsbSnapshot(
    {
      ac: [
        {
          hex: 'a1b2c3',
          flight: 'TEST1',
          lat: 30,
          lon: -97,
          alt_baro: 10000,
          gs: 150,
          track: 90,
          squawk: '1200',
          emergency: 'general',
          seen: 3,
          seen_pos: 1,
        },
      ],
    },
    { observedAtMs: NOW_MS, now: NOW_MS },
  ).records;
  store.receive(observation, receiveContext);
  const meta = store.receive(
    { ...observation, contactTimeMs: null, squawk: '7600', emergency: 'none' },
    receiveContext,
  ).meta;
  const record = mapFlight(observation.id, meta);
  assert.equal(record.emergencyKind, 'nordo');
  assert.equal(record.lastContactAtMs, NOW_MS - 3000);
  assert.equal(Object.hasOwn(record, 'observedAtMs'), false);
  globalThis.window = globalThis.window || {
    clearTimeout,
    setTimeout,
    requestIdleCallback: null,
  };
  const flights = {
    id: 'flights',
    source: 'fixture',
    getStats: () => ({ count: 1 }),
    getAnalystRecords: () => [record],
  };
  const runner = createGevActionRunner({
    viewer: {
      clock: { onTick: { addEventListener: () => () => {} } },
      scene: { canvas: { addEventListener() {}, removeEventListener() {} } },
      camera: {
        moveEnd: { addEventListener() {} },
        positionCartographic: {
          height: 300000,
          latitude: 0.52,
          longitude: -1.71,
        },
      },
    },
    styleManager: {
      getContextModeState: () => ({ mode: null, active: false }),
      getCockpitState: () => ({ active: false }),
    },
    dataManager: {
      layers: new Map([['flights', { module: flights }]]),
      isEnabled: (id) => id === 'flights',
      getAll: () => [
        { id: 'flights', name: 'Flights', enabled: true, stats: { count: 1 } },
      ],
    },
  });
  try {
    const result = await runner('analyst_query', {
      layers: ['flights'],
      scope: { kind: 'anywhere' },
      filters: [{ field: 'emergency', op: 'eq', value: true }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.items[0].emergency, true);
    assert.equal(result.items[0].lastContactAtMs, NOW_MS - 3000);
    assert.equal(result.items[0].emergencySource, 'squawk');
    assert.equal(
      result.items[0].emergencyBroadcast,
      'broadcasting squawk 7600 (radio failure)',
    );
    assert.equal(
      Object.hasOwn(result.items[0], 'time'),
      false,
      'general contact is not a generic incident timestamp',
    );
  } finally {
    runner.dispose?.();
  }
});

// OpenSky /states/all: [icao24, callsign, origin_country, time_position,
// last_contact, lon, lat, baro_alt, on_ground, velocity, true_track,
// vertical_rate, sensors, geo_alt, squawk, spi, position_source, category].
const OPENSKY = {
  time: NOW_MS / 1000,
  states: [
    [
      'a1b2c3',
      'SWA696  ',
      'United States',
      NOW_MS / 1000 - 6,
      NOW_MS / 1000 - 3,
      -97.67,
      30.19,
      3000,
      false,
      150,
      180,
      -5,
      null,
      3040,
      '7700',
      false,
      0,
      4,
    ],
  ],
};

// adsb.lol /v2/mil: readsb aircraft with `seen`/`seen_pos` ages in seconds.
const ADSB_LOL = {
  ac: [
    {
      hex: 'ae01ce',
      flight: 'RCH123  ',
      t: 'C17',
      lat: 31.1,
      lon: -97.4,
      alt_baro: 18000,
      gs: 300,
      track: 90,
      squawk: '1200',
      emergency: 'general',
      seen: 1.5,
      seen_pos: 2,
    },
  ],
};

function civilAnalystRecord() {
  const [row] = openSkySnapshot(OPENSKY, { now: NOW_MS }).records;
  const store = new FlightRecords({
    geoidHeight: () => 0,
    cachedGroundFloor: () => null,
    floorAltitudeM: (altitude) => altitude,
    approxDistanceKm: () => 0,
  });
  const { meta } = store.receive(row, {
    viewerLatDeg: null,
    viewerLonDeg: null,
    trackedId: null,
    floorWarmPoints: [],
  });
  return mapFlight(row.id, meta);
}

function militaryAnalystRecord() {
  const [row] = readsbSnapshot(ADSB_LOL, {
    observedAtMs: NOW_MS,
    now: NOW_MS,
  }).records;
  const store = new MilitaryFlightRecords({
    geoidHeight: () => 0,
    cachedGroundFloor: () => null,
    floorAltitudeM: (altitude) => altitude,
  });
  const { meta } = store.receive(row, {
    observedAtMs: NOW_MS,
    floorWarmPoints: [],
    modelOwnsVisual: false,
  });
  return mapMilitary(row.id, meta);
}

test('OpenSky 7700 and adsb.lol emergency=general differ only in provenance', () => {
  const civil = civilAnalystRecord();
  const military = militaryAnalystRecord();

  assert.equal(civil.emergency, true);
  assert.equal(civil.emergencyKind, 'general');
  assert.equal(civil.squawk, '7700');
  assert.equal(civil.emergencySource, 'squawk');
  assert.equal(
    civil.emergencyBroadcast,
    'broadcasting squawk 7700 (general emergency)',
  );
  assert.equal(civil.lastContactAtMs, NOW_MS - 3000, 'OpenSky last_contact');

  assert.equal(military.emergency, true);
  assert.equal(military.emergencyKind, 'general');
  assert.equal(military.squawk, '1200', 'the code is not an emergency code');
  assert.equal(military.emergencySource, 'ads-b');
  assert.equal(military.emergencyBroadcast, 'ADS-B reports general emergency');
  assert.equal(military.lastContactAtMs, NOW_MS - 1500, 'snapshot time - seen');
});

test('the analyst can filter emergencies by source', async () => {
  const records = {
    flights: [civilAnalystRecord()],
    military: [militaryAnalystRecord()],
  };
  const engine = createAnalystEngine({
    getRecords: (key) => records[key] || [],
    resolveRegionRing: async () => null,
    getViewContext: () => ({ lat: 30.5, lon: -97.5, viewRadiusKm: 500 }),
  });
  const query = (value) =>
    engine.query({
      layers: ['flights', 'military'],
      scope: { kind: 'anywhere' },
      filters: [
        { field: 'emergency', op: 'eq', value: true },
        { field: 'emergencySource', op: 'eq', value },
      ],
    });
  const bySquawk = await query('squawk');
  assert.deepEqual(
    bySquawk.items.map((item) => [item.icao24, item.emergencyBroadcast]),
    [['a1b2c3', 'broadcasting squawk 7700 (general emergency)']],
  );
  const byAdsb = await query('ads-b');
  assert.deepEqual(
    byAdsb.items.map((item) => [item.icao24, item.emergencyBroadcast]),
    [['ae01ce', 'ADS-B reports general emergency']],
  );
});

test('military status changes retain only the latest known general contact', () => {
  const store = new MilitaryFlightRecords({
    geoidHeight: () => 0,
    cachedGroundFloor: () => null,
    floorAltitudeM: (v) => v,
  });
  const [observation] = readsbSnapshot(ADSB_LOL, {
    observedAtMs: NOW_MS,
    now: NOW_MS,
  }).records;
  const context = {
    observedAtMs: NOW_MS,
    floorWarmPoints: [],
    modelOwnsVisual: false,
  };
  const unknown = mapMilitary(
    observation.id,
    store.receive({ ...observation, contactTimeMs: null }, context).meta,
  );
  assert.equal(unknown.lastContactAtMs, null);
  store.receive(observation, context);
  const changed = mapMilitary(
    observation.id,
    store.receive(
      {
        ...observation,
        contactTimeMs: null,
        squawk: '7600',
        emergency: 'none',
      },
      context,
    ).meta,
  );
  assert.equal(changed.emergencyKind, 'nordo');
  assert.equal(changed.lastContactAtMs, NOW_MS - 1500);
});
