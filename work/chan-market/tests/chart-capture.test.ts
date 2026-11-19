// Adicionado em trend-workbench-br: captura do gráfico.
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFileName } from '../lib/chart-capture.ts';

test('chart screenshots get a safe, dated file name', () => {
  assert.equal(captureFileName('XAUUSD', '1h', new Date(2026, 10, 19, 21, 5)), 'XAUUSD-1h-2026-11-19_21-05.png');
  assert.equal(captureFileName('^BVSP', '1d', new Date(2026, 0, 2, 9, 30)), '^BVSP-1d-2026-01-02_09-30.png');
  assert.equal(captureFileName('BTC/USDT', '4h', new Date(2026, 0, 2, 9, 30)), 'BTC-USDT-4h-2026-01-02_09-30.png');
});
