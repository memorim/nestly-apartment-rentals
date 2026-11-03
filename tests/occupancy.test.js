import test from 'node:test';import assert from 'node:assert/strict';import request from 'supertest';process.env.NODE_ENV='test';const {createDb,createApp}=await import('../server.js');
test('owner access protects contacts and occupancy rejects overlapping ranges',async()=>{
 const db=createDb(':memory:'),old=process.env.APP_OWNER_TOKEN;process.env.APP_OWNER_TOKEN='z'.repeat(40);
 try {const app=createApp(db),token='z'.repeat(40);
 assert.equal((await request(app).get('/api/owner/inquiries')).status,401);
 const block=()=>request(app).post('/api/owner/listings/1/occupancy').auth(token,{type:'bearer'});
 assert.equal((await block().send({startDate:'2026-12-01',endDate:'2026-12-10'})).status,201);
 assert.equal((await block().send({startDate:'2026-12-05',endDate:'2026-12-15'})).status,409);
 assert.equal((await block().send({startDate:'2026-12-10',endDate:'2026-12-15'})).status,201);
 assert.equal((await block().send({startDate:'2026-02-30',endDate:'2026-12-15'})).status,400);
 assert.equal((await request(app).get('/api/listings/1/availability')).body.length,2);
 const body={listingId:1,name:'Owner Test',phone:'+79990001122',message:'Viewing'};
 for(let n=0;n<2;n++)await request(app).post('/api/inquiries').set('Idempotency-Key','inquiry-event-key').send(body);
 assert.equal(db.prepare('SELECT count(*) n FROM inquiry_events').get().n,1);
 db.prepare("UPDATE inquiries SET created_at='2000-01-01T00:00:00Z'").run();await request(createApp(db)).get('/api/listings');assert.equal(db.prepare('SELECT phone FROM inquiries LIMIT 1').get().phone,'');
 }finally{if(old===undefined)delete process.env.APP_OWNER_TOKEN;else process.env.APP_OWNER_TOKEN=old;db.close();}
});
