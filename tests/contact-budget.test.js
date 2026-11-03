import test from 'node:test';import assert from 'node:assert/strict';import request from 'supertest';
process.env.NODE_ENV='test';const {createDb,createApp}=await import('../server.js');
test('public contact budget normalizes phone, survives app recreation and preserves retries',async()=>{
 const before={...process.env};process.env.APP_PUBLIC_ORIGIN='https://nestly.example';process.env.APP_OWNER_TOKEN='z'.repeat(40);const db=createDb(':memory:');let time=1000;
 try{let app=createApp(db,{now:()=>time});const payload={listingId:1,name:'Test Viewer',phone:'+7 999 000-11-22',message:'Viewing'};const send=(key,body=payload)=>request(app).post('/api/inquiries').set('Host','nestly.example').set('Idempotency-Key',key).send(body);
 assert.equal((await send('trap-test-key',{...payload,website:'https://spam.example'})).status,400);assert.equal(db.prepare('SELECT count(*) n FROM inquiries').get().n,0);
 for(let n=0;n<5;n++)assert.equal((await send('contact-key-'+n)).status,201);
 app=createApp(db,{now:()=>time});assert.equal((await send('contact-key-0')).status,200);
 const blocked=await send('contact-key-5',{...payload,phone:'+79990001122'});assert.equal(blocked.status,429);assert.ok(blocked.headers['retry-after']);
 const rows=db.prepare("SELECT key FROM request_budgets WHERE key LIKE 'contact:%'").all();assert.equal(rows.length,1);assert.ok(!rows[0].key.includes('7999'));
 time+=3600001;assert.equal((await send('contact-key-6')).status,201);assert.equal(db.prepare('SELECT count(*) n FROM inquiry_events').get().n,6);
 }finally{db.close();for(const key of ['APP_PUBLIC_ORIGIN','APP_OWNER_TOKEN'])if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}
});
