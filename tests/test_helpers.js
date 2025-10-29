const assert = require('assert');
const nh = require('../node_helper');

// Access helper methods on the exported module
console.log('Running helper tests...');

// toMinutes tests via exposed _toMinutes
assert.strictEqual(nh._toMinutes('7:40'), 7 * 60 + 40, '7:40 -> minutes');
assert.strictEqual(nh._toMinutes('0740'), 7 * 60 + 40, '0740 -> minutes');
assert.strictEqual(nh._toMinutes('0:00'), 0, '0:00 -> minutes');
assert.strictEqual(isNaN(nh._toMinutes(null)), true, 'null -> NaN');

// _formatErr
assert.strictEqual(nh._formatErr(new Error('boom')), 'boom');
assert.strictEqual(nh._formatErr('strerr'), 'strerr');

// _normalizeHomeworks
assert.deepStrictEqual(nh._normalizeHomeworks([{ id: 1 }]), [{ id: 1 }]);
assert.deepStrictEqual(nh._normalizeHomeworks({ homeworks: [{ id: 2 }] }), [{ id: 2 }]);
assert.deepStrictEqual(nh._normalizeHomeworks({ homework: [{ id: 3 }] }), [{ id: 3 }]);
assert.deepStrictEqual(nh._normalizeHomeworks(null), []);

console.log('All helper tests passed');
