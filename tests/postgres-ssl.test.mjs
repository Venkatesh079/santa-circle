import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { postgresPoolConfig } from '../lib/postgres.ts';

// Synthetic PEM fixture: no network handshake is performed in these config tests.
const ca = '-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----';
test('custom CA survives pg connection-string parsing with verified TLS', () => {
  for (const suffix of ['', '?sslmode=verify-full', '?sslmode=require&application_name=santa']) {
    const config = postgresPoolConfig('postgresql://user:p%40ss@db.example.com:6543/postgres' + suffix, ca, true);
    const client = new pg.Client(config);
    assert.equal(client.ssl.ca, ca);
    assert.equal(client.ssl.rejectUnauthorized, true);
    assert.equal(client.connectionParameters.password, 'p@ss');
    assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
    if (suffix.includes('application_name')) assert.equal(client.connectionParameters.application_name, 'santa');
  }
});
test('CA env supports escaped newlines and rejects incomplete PEM', () => {
  assert.equal(postgresPoolConfig('postgresql://host/db', ca.replaceAll('\n', '\\n'), true).ssl.ca, ca);
  assert.throws(() => postgresPoolConfig('postgresql://host/db', 'incomplete certificate', true), /complete PEM certificate/);
});
test('without a custom CA, hosted connections still require TLS and loopback development works', () => {
  const remote = new pg.Client(postgresPoolConfig('postgresql://host/db', '', true));
  assert.ok(remote.ssl);
  assert.notEqual(remote.ssl.rejectUnauthorized, false);
  const local = new pg.Client(postgresPoolConfig('postgresql://localhost/db', '', false));
  assert.equal(local.ssl, false);
});
