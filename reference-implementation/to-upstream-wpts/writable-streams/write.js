'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/test-utils.js');
  self.importScripts('../resources/recording-streams.js');
}

function writeArrayToStream(array, writableStreamWriter) {
  array.forEach(chunk => writableStreamWriter.write(chunk));
  return writableStreamWriter.close();
}

promise_test(t => {
  let storage;
  const ws = new WritableStream({
    start() {
      storage = [];
    },

    write(chunk) {
      return delay(0).then(() => storage.push(chunk));
    },

    close() {
      return delay(0);
    }
  });

  const writer = ws.getWriter();

  const input = [1, 2, 3, 4, 5];
  return writeArrayToStream(input, writer)
      .then(() => assert_array_equals(storage, input, 'correct data should be relayed to underlying sink'));
}, 'WritableStream should complete asynchronous writes before close resolves');

promise_test(t => {
  let storage;
  const ws = recordingWritableStream();

  const writer = ws.getWriter();

  const input = [1, 2, 3, 4, 5];
  return writeArrayToStream(input, writer)
      .then(() => assert_array_equals(ws.events, ['write', 1, 'write', 2, 'write', 3, 'write', 4, 'write', 5, 'close'],
                                      'correct data should be relayed to underlying sink'));
}, 'WritableStream should complete synchronous writes before close resolves');

promise_test(t => {
  const ws = new WritableStream({
    write() {
      return 'Hello';
    }
  });

  const writer = ws.getWriter();

  const writePromise = writer.write('a');
  return writePromise
      .then(value => assert_equals(value, undefined, 'fulfillment value must be undefined'));
}, 'fulfillment value of ws.write() call should be undefined even if the underlying sink returns a non-undefined ' +
    'value');

promise_test(t => {
  let resolveSinkWritePromise;
  const ws = new WritableStream({
    write() {
      return new Promise(resolve => {
        resolveSinkWritePromise = resolve;
      });
    }
  });

  const writer = ws.getWriter();

  assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');

  return writer.ready.then(() => {
    const writePromise = writer.write('a');
    let writePromiseResolved = false;
    assert_not_equals(resolveSinkWritePromise, undefined, 'resolveSinkWritePromise should not be undefined');

    assert_equals(writer.desiredSize, 0, 'desiredSize should be 0 after writer.write()');

    return Promise.all([
      writePromise.then(value => {
        writePromiseResolved = true;
        assert_equals(resolveSinkWritePromise, undefined, 'sinkWritePromise should be fulfilled before writePromise');

        assert_equals(value, undefined, 'writePromise should be fulfilled with undefined');
      }),
      writer.ready.then(value => {
        assert_equals(resolveSinkWritePromise, undefined, 'sinkWritePromise should be fulfilled before writer.ready');
        assert_true(writePromiseResolved, 'writePromise should be fulfilled before writer.ready');

        assert_equals(writer.desiredSize, 1, 'desiredSize should be 1 again');

        assert_equals(value, undefined, 'writePromise should be fulfilled with undefined');
      }),
      delay(100).then(() => {
        resolveSinkWritePromise();
        resolveSinkWritePromise = undefined;
      })
    ]);
  });
}, 'WritableStream should transition to waiting until write is acknowledged');

promise_test(t => {
  let sinkWritePromiseRejectors = [];
  const ws = new WritableStream({
    write() {
      const sinkWritePromise = new Promise((r, reject) => sinkWritePromiseRejectors.push(reject));
      return sinkWritePromise;
    }
  });

  const writer = ws.getWriter();

  assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');

  return writer.ready.then(() => {
    const writePromise = writer.write('a');
    assert_equals(sinkWritePromiseRejectors.length, 1, 'there should be 1 rejector');
    assert_equals(writer.desiredSize, 0, 'desiredSize should be 0');

    const writePromise2 = writer.write('b');
    assert_equals(sinkWritePromiseRejectors.length, 1, 'there should be still 1 rejector');
    assert_equals(writer.desiredSize, -1, 'desiredSize should be -1');

    const closedPromise = writer.close();

    assert_equals(writer.desiredSize, -1, 'desiredSize should still be -1');

    const passedError = new Error('horrible things');

    return Promise.all([
      promise_rejects(t, passedError, closedPromise, 'closedPromise should reject with passedError')
          .then(() => assert_equals(sinkWritePromiseRejectors.length, 0,
                                    'sinkWritePromise should reject before closedPromise')),
      promise_rejects(t, passedError, writePromise, 'writePromise should reject with passedError')
          .then(() => assert_equals(sinkWritePromiseRejectors.length, 0,
                                    'sinkWritePromise should reject before writePromise')),
      promise_rejects(t, passedError, writePromise2, 'writePromise2 should reject with passedError')
          .then(() => assert_equals(sinkWritePromiseRejectors.length, 0,
                                    'sinkWritePromise should reject before writePromise2')),
      delay(100).then(() => {
        sinkWritePromiseRejectors[0](passedError);
        sinkWritePromiseRejectors = [];
      })
    ]);
  });
}, 'when write returns a rejected promise, queued writes and close should be cleared');

promise_test(t => {
  const thrownError = new Error('throw me');
  const ws = new WritableStream({
    write() {
      throw thrownError;
    }
  });

  const writer = ws.getWriter();

  return promise_rejects(t, thrownError, writer.write('a'), 'write() should reject with thrownError')
      .then(() => promise_rejects(t, new TypeError(), writer.close(), 'close() should be rejected'));
}, 'when sink\'s write throws an error, the stream should become errored and the promise should reject');

promise_test(t => {
  const numberOfWrites = 10000;

  let resolveFirstWritePromise;
  let writeCount = 0;
  const ws = new WritableStream({
    write() {
      ++writeCount;
      if (!resolveFirstWritePromise) {
        return new Promise(resolve => {
          resolveFirstWritePromise = resolve;
        });
      }
      return Promise.resolve();
    }
  });

  const writer = ws.getWriter();
  return writer.ready.then(() => {
    for (let i = 1; i < numberOfWrites; ++i) {
      writer.write('a');
    }
    const writePromise = writer.write('a');

    assert_equals(writeCount, 1, 'should have called sink\'s write once');

    resolveFirstWritePromise();

    return writePromise
        .then(() =>
          assert_equals(writeCount, numberOfWrites, `should have called sink's write ${numberOfWrites} times`));
  });
}, 'a large queue of writes should be processed completely');