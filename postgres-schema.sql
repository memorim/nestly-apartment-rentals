CREATE TABLE listings(id INTEGER PRIMARY KEY,title TEXT,district TEXT,address TEXT,rooms INTEGER,area DOUBLE PRECISION,floor INTEGER,price INTEGER,style TEXT,accent TEXT,features TEXT,available INTEGER);
CREATE TABLE inquiries(id BIGSERIAL PRIMARY KEY,listing_id INTEGER REFERENCES listings(id),name TEXT,phone TEXT,message TEXT,created_at TEXT,request_key TEXT UNIQUE,request_hash TEXT);
CREATE INDEX listings_price_id ON listings(price,id);
CREATE TABLE occupancy(id BIGSERIAL PRIMARY KEY,listing_id INTEGER NOT NULL REFERENCES listings(id),start_date TEXT NOT NULL,end_date TEXT NOT NULL,CHECK(start_date<end_date));
CREATE INDEX occupancy_dates ON occupancy(listing_id,start_date,end_date);
CREATE TABLE inquiry_events(id BIGSERIAL PRIMARY KEY,inquiry_id BIGINT NOT NULL UNIQUE REFERENCES inquiries(id),created_at TEXT NOT NULL,delivered_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at BIGINT NOT NULL DEFAULT 0,last_error TEXT,lease_until BIGINT NOT NULL DEFAULT 0,lease_token TEXT);
CREATE TABLE request_budgets(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at BIGINT NOT NULL);
