import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFirmsCsv } from './firmsCsv.js';
import { adaptFirmsRecords } from './firmsAdapt.js';
test('missing positions do not become fire detections at zero coordinates', () => {
  const csv =
    'latitude,longitude,acq_date,acq_time,confidence,frp\n,1,2026-07-16,1200,n,1\n1, ,2026-07-16,1200,n,1\n95,1,2026-07-16,1200,n,1\n1,181,2026-07-16,1200,n,1\n0,0,2026-07-16,1200,n,1\n-90,-180,2026-07-16,1200,n,1';
  assert.deepEqual(
    parseFirmsCsv(csv).map((r) => [r.lat, r.lon]),
    [
      [0, 0],
      [-90, -180],
    ],
  );
  const records = [
    { lat: null, lon: 1 },
    { lat: '', lon: 1 },
    { lat: false, lon: 1 },
    { lat: 95, lon: 1 },
    { lat: 1, lon: 181 },
    { lat: '0', lon: 0 },
    { lat: -90, lon: -180 },
  ];
  assert.deepEqual(
    adaptFirmsRecords(records).map((r) => [r.index, r.lat, r.lon]),
    [
      [0, 0, 0],
      [1, -90, -180],
    ],
  );
});
