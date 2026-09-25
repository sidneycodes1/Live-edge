import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHub } from '../src/services/sse.js';

function makeMockRes() {
  const ee = new EventEmitter();
  ee.write = (s) => { ee.data = (ee.data || '') + s; };
    ee.on = (e, fn) => { EventEmitter.prototype.on.call(ee, e, fn); };
  ee.destroy = () => { ee.emit('close'); };
  return ee;
}

describe('sse hub', ()=>{
  it('broadcast and disconnect', async()=>{
    const hub=createHub();
    const res1=makeMockRes();
    const res2=makeMockRes();
    hub.add('room1', res1);
    hub.add('room1', res2);
    assert.equal(hub.count('room1'),2);
    hub.broadcast('room1','odds',{yesPrice:0.6});
    assert.ok(res1.data.includes('odds'));
    assert.ok(res2.data.includes('odds'));
    res1.destroy();
    assert.equal(hub.count('room1'),1);
    assert.equal(hub.size(),1);
    hub.stop();
  });
});
