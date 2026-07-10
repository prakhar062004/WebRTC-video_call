import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../server.js';

test('startServer should be able to run over HTTP on an ephemeral port', async () => {
  const { server } = await startServer({ port: 0, useHttps: false });

  assert.ok(server.listening);

  await new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

test('startServer should fall back to the next available port when the requested port is busy', async () => {
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(3000, '127.0.0.1', resolve));

  try {
    const { server, port } = await startServer({ port: 3000, useHttps: false });
    assert.notEqual(port, 3000);
    assert.ok(server.listening);

    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    await new Promise((resolve, reject) => {
      blocker.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
});
