import{describe,it}from'node:test';import assert from'node:assert/strict';import request from'supertest';process.env.NODE_ENV='test';const{createApp,createDb}=await import('../server.js');const app=createApp(createDb(':memory:'));describe('Nestly API',()=>{it('returns listing catalog',async()=>{const r=await request(app).get('/api/listings');assert.equal(r.status,200);assert.equal(r.body.length,6)});it('filters by budget',async()=>{const r=await request(app).get('/api/listings?maxPrice=100000');assert.equal(r.body.length,1)});it('accepts viewing inquiry',async()=>{const r=await request(app).post('/api/inquiries').send({listingId:1,name:'Роман',phone:'+79990000000',message:'Удобно вечером'});assert.equal(r.status,201);assert.equal(r.body.status,'received')});});

describe('Input validation and missing records', () => {
  it('rejects invalid input', async () => { assert.equal((await request(app).post('/api/inquiries').send({})).status, 400); });
  it('returns 404 for a missing record', async () => { assert.equal((await request(app).get('/api/listings/999')).status, 404); });
});
