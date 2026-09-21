import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/services/sse.js';

describe('sse hub', ()=>{
  it('broadcast and disconnect', async()=>{
    const hub=createHub();
    // mock res
    const res1={ write: (s)=>{ res1.data=(res1.data||'')+s; }, on:(e,fn)=>{res1._close=fn;}, closed:false };
    const res2={ write: (s)=>{ res2.data=(res2.data||'')+s; }, on:(e,fn)=>{res2._close=fn;}, closed:false };
    hub.add('room1', res1);
    hub.add('room1', res2);
    assert.equal(hub.count('room1'),2);
    hub.broadcast('room1','odds',{yesPrice:0.6});
    assert.ok(res1.data.includes('odds'));
    assert.ok(res2.data.includes('odds'));
    // simulate close
    res1._close();
    assert.equal(hub.count('room1'),1);
    assert.equal(hub.size(),1);
    hub.stop();
  });
});
