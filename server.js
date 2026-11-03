import {initializeNotifications,retryNotification} from './notifications.js';
import {ownerAccess,publicOrigin} from "./owner-access.js";
import { consumeBudget, initializeBudgets } from "./request-budget.js";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const root = dirname(fileURLToPath(import.meta.url));
export function createDb(file = resolve(root, "data", "nestly.db")) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
    const initialized = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='listings'",
      )
      .get();
    db.exec(
      `CREATE TABLE IF NOT EXISTS listings(id INTEGER PRIMARY KEY,title TEXT,district TEXT,address TEXT,rooms INTEGER,area REAL,floor INTEGER,price INTEGER,style TEXT,accent TEXT,features TEXT,available INTEGER);CREATE TABLE IF NOT EXISTS inquiries(id INTEGER PRIMARY KEY AUTOINCREMENT,listing_id INTEGER,name TEXT,phone TEXT,message TEXT,created_at TEXT);`,
    );
    if (!initialized)
      db.exec(
        `INSERT INTO listings VALUES(1,'Светлая квартира у парка','Хамовники','Усачёва, 15',2,54,7,145000,'olive','#899477','балкон,гардеробная,парк',1),(2,'Лофт с панорамными окнами','Пресня','Мантулинская, 9',1,47,18,128000,'brick','#b66e52','панорама,консьерж,спортзал',1),(3,'Тихая квартира в старом доме','Чистые пруды','Покровка, 31',3,78,4,189000,'classic','#c5a56d','камин,кабинет,двор',1),(4,'Минималистичная студия','Даниловский','Хавская, 24',1,32,11,89000,'blue','#718995','мебель,коворкинг,метро',1),(5,'Семейная квартира с террасой','Раменки','Мосфильмовская, 70',4,112,22,265000,'sand','#b59a7c','терраса,паркинг,детская',1),(6,'Двухуровневые апартаменты','Басманный','Бауманская, 7',2,69,6,157000,'dark','#666c65','антресоль,кирпич,охрана',1);`,
      );
    const columns = db
      .prepare("PRAGMA table_info(inquiries)")
      .all()
      .map((c) => c.name);
    for (const column of ["request_key", "request_hash"])
      if (!columns.includes(column))
        db.exec(`ALTER TABLE inquiries ADD COLUMN ${column} TEXT`);
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS inquiries_request_key ON inquiries(request_key); CREATE INDEX IF NOT EXISTS listings_price_id ON listings(price,id); COMMIT",
    );
    db.exec(`CREATE TABLE IF NOT EXISTS occupancy(id INTEGER PRIMARY KEY AUTOINCREMENT,listing_id INTEGER NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,CHECK(start_date<end_date));
      CREATE INDEX IF NOT EXISTS occupancy_dates ON occupancy(listing_id,start_date,end_date);
      CREATE TABLE IF NOT EXISTS inquiry_events(id INTEGER PRIMARY KEY AUTOINCREMENT,inquiry_id INTEGER NOT NULL UNIQUE,created_at TEXT NOT NULL,delivered_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,last_error TEXT);`);
    initializeNotifications(db);
    initializeBudgets(db);
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}
export function createApp(db = createDb(), { now = Date.now } = {}) {
  const app = express();
  const hostedOrigin=publicOrigin();
  const retentionDays=Number(process.env.CONTACT_RETENTION_DAYS || 90);
  if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>3650)throw new Error('Invalid contact retention');
  let sweep=-Infinity;
  app.use('/api',(_req,_res,next)=>{const time=now();if(time-sweep>=3600000){db.prepare("UPDATE inquiries SET name='[removed]',phone='',message='' WHERE created_at<? AND phone!=''").run(new Date(time-retentionDays*86400000).toISOString());sweep=time;}next();});
  app.use("/api", (req, res, next) => {
    if (hostedOrigin ? req.get("host") !== hostedOrigin.host : !["localhost", "127.0.0.1", "::1", "[::1]"].includes(req.hostname))
      return res.status(403).json({ message: "Используйте локальный адрес" });
    if (
      !["GET","HEAD","OPTIONS"].includes(req.method) &&
      (req.get("sec-fetch-site") === "cross-site" ||
        (req.get("origin") &&
          req.get("origin") !== (hostedOrigin?.origin || `${req.protocol}://${req.get("host")}`)))
    )
      return res
        .status(403)
        .json({ message: "Запрос с другого сайта запрещён" });
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.param("id", (req, res, next, id) =>
    /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
      ? next()
      : res.status(400).json({ message: "Некорректный идентификатор" }),
  );
  app.get("/api/listings", (req, res) => {
    const parsed = z
      .object({
        district: z.string().trim().max(80).default(""),
        rooms: z.coerce.number().int().min(0).max(10).default(0),
        maxPrice: z.coerce.number().int().min(0).max(10000000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(100),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      })
      .strict()
      .safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ message: "Проверьте фильтры" });
    const { district, rooms, maxPrice: max, limit, offset } = parsed.data;
    const clauses = ["available=1"],
      params = {};
    if (district && district !== "all") {
      clauses.push("district=$district");
      params.$district = district;
    }
    if (rooms) {
      clauses.push("rooms>=$rooms");
      params.$rooms = rooms;
    }
    if (max) {
      clauses.push("price<=$max");
      params.$max = max;
    }
    const rows = db
      .prepare(
        `SELECT * FROM listings WHERE ${clauses.join(" AND ")} ORDER BY price,id LIMIT $limit OFFSET $offset`,
      )
      .all({ ...params, $limit: limit, $offset: offset })
      .map((r) => ({ ...r, features: r.features.split(",") }));
    res.json(rows);
  });
  app.get("/api/listings/:id", (req, res) => {
    const row = db
      .prepare("SELECT * FROM listings WHERE id=? AND available=1")
      .get(Number(req.params.id));
    return row
      ? res.json({ ...row, features: row.features.split(",") })
      : res.status(404).json({ message: "Квартира не найдена" });
  });
  const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
  app.get('/api/listings/:id/availability',(req,res)=>res.json(db.prepare('SELECT id,start_date,end_date FROM occupancy WHERE listing_id=? ORDER BY start_date').all(Number(req.params.id))));
  app.get('/api/owner/inquiries',ownerAccess(),(_req,res)=>res.json(db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT 100').all()));
  app.get('/api/owner/notifications',ownerAccess(),(_req,res)=>res.json(db.prepare('SELECT id,inquiry_id,attempts,delivered_at,next_attempt_at,last_error FROM inquiry_events ORDER BY id DESC LIMIT 100').all()));
  app.post('/api/owner/notifications/:id/retry',ownerAccess(),(req,res)=>res.status(retryNotification(db,Number(req.params.id),now())?200:409).json({message:'Повтор разрешён только после пяти неудачных попыток и завершения текущей доставки'}));
  app.post('/api/owner/listings/:id/occupancy',ownerAccess(),(req,res)=>{
    const p=z.object({startDate:date,endDate:date}).strict().refine(v=>v.startDate<v.endDate).safeParse(req.body);
    if(!p.success)return res.status(400).json({message:'Проверьте даты'});
    if(!db.prepare('SELECT id FROM listings WHERE id=?').get(Number(req.params.id)))return res.status(404).json({message:'Квартира не найдена'});
    const out=db.prepare('INSERT INTO occupancy(listing_id,start_date,end_date) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM occupancy WHERE listing_id=? AND start_date<? AND end_date>?)').run(Number(req.params.id),p.data.startDate,p.data.endDate,Number(req.params.id),p.data.endDate,p.data.startDate);
    return out.changes?res.status(201).json({id:Number(out.lastInsertRowid)}):res.status(409).json({message:'Период уже занят'});
  });
  app.delete('/api/owner/occupancy/:id',ownerAccess(),(req,res)=>{db.prepare('DELETE FROM occupancy WHERE id=?').run(Number(req.params.id));res.status(204).end();});
  app.post("/api/inquiries", (req, res) => {
    const time = now();
    if(req.body?.website!==undefined && req.body.website!=='')return res.status(400).json({message:'Проверьте поля формы'});
    const budget = consumeBudget(db, 'submit', 20, time);
    if (!budget.allowed) return res.set('Retry-After', String(budget.retryAfter)).status(429).json({ message: 'Слишком много запросов. Повторите позже' });
    const p = z
      .object({
        listingId: z.number().int().positive(),
        name: z.string().trim().min(2).max(80),
        phone: z
          .string()
          .trim()
          .min(7)
          .max(32)
          .regex(/^\+?[\d\s()-]+$/)
          .refine((v) => {
            const digits = v.replace(/\D/g, "").length;
            return digits >= 7 && digits <= 15;
          }),
        message: z.string().trim().max(500).default(""),
      })
      .safeParse(req.body);
    if (!p.success)
      return res.status(400).json({ message: "Проверьте контактные данные" });
    const key = req.get("Idempotency-Key") ?? null;
    if (key !== null && !/^[A-Za-z0-9_-]{8,100}$/.test(key))
      return res.status(400).json({ message: "Некорректный ключ операции" });
    const hash = createHash("sha256")
      .update(JSON.stringify(p.data))
      .digest("hex");
    if(hostedOrigin && !(key && db.prepare('SELECT id FROM inquiries WHERE request_key=?').get(key))) {
      const contact=createHmac('sha256',process.env.APP_OWNER_TOKEN).update(p.data.phone.replace(/\D/g,'')).digest('hex');
      db.prepare("DELETE FROM request_budgets WHERE key LIKE 'contact:%' AND reset_at<=?").run(time);
      const contactBudget=consumeBudget(db,'contact:'+contact,5,time,3600000);
      if(!contactBudget.allowed)return res.set('Retry-After',String(contactBudget.retryAfter)).status(429).json({message:'Слишком много заявок с этим контактом. Повторите позже'});
    }
    const out = db
      .prepare(
        "INSERT INTO inquiries(listing_id,name,phone,message,created_at,request_key,request_hash) SELECT id,?,?,?,?,?,? FROM listings WHERE id=? AND available=1 ON CONFLICT(request_key) DO NOTHING",
      )
      .run(
        p.data.name,
        p.data.phone,
        p.data.message,
        new Date(time).toISOString(),
        key,
        hash,
        p.data.listingId,
      );
    const replay = key
      ? db
          .prepare("SELECT id,request_hash FROM inquiries WHERE request_key=?")
          .get(key)
      : null;
    if (replay && replay.request_hash !== hash)
      return res
        .status(409)
        .json({ message: "Ключ операции уже использован с другими данными" });
    if (!out.changes && !replay)
      return res.status(404).json({ message: "Объект недоступен" });
    res.status(out.changes ? 201 : 200).json({
      id: replay?.id ?? Number(out.lastInsertRowid),
      status: "received",
    });
  });
  app.use(express.static(resolve(root, "public")));
  app.get(/^(?!\/api).*/, (_q, res) =>
    res.sendFile(resolve(root, "public", "index.html")),
  );
  app.use((error, _req, res, _next) => {
    const status =
      error?.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError
          ? 400
          : 503;
    if (status === 503)
      console.error({ event: "request_error", error: "internal_error" });
    res.status(status).json({ message: "Не удалось обработать запрос" });
  });
  return app;
}
if (process.env.NODE_ENV !== "test") {
  if (
    !process.env.APP_PUBLIC_ORIGIN && process.env.HOST &&
    !["127.0.0.1", "localhost", "::1"].includes(process.env.HOST)
  )
    throw new Error("Nestly requires a loopback HOST");
  createApp().listen(
    process.env.PORT || 4600,
    process.env.HOST || "127.0.0.1",
    () => console.log("Nestly: http://localhost:4600"),
  );
}
