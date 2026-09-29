# BKKFLOOD — แผนที่น้ำท่วม กทม. + ปริมณฑล

เว็บแอป (Vite + MapLibre + Firebase) — ดู `PLAN.md` สำหรับแผนทั้งหมด

## สถานะ: เฟส 1 (MVP) เสร็จ พร้อมทดลองในเครื่อง — ยังไม่ได้ deploy

| ทำแล้ว | ยังไม่ได้ทำ |
|---|---|
| แผนที่ + สถานีวัดน้ำ กทม./ปริมณฑล (34 จุด รวม 5 จุดน้ำเหนือ) + เรดาร์ฝน | เชื่อม Firebase จริง (ต้องใส่ค่าใน `src/firebase-config.js`) |
| พยากรณ์ฝน 48 ชม. (3 โมเดล) + น้ำทะเลหนุน + แนวโน้มน้ำเหนือ | แจ้งเตือนล่วงหน้า (Web Push/LINE) — เฟส 2 |
| คะแนนความเสี่ยงแบบอธิบายเหตุผลได้ (v0, เกณฑ์ยังไม่ได้ปรับกับเหตุการณ์จริง) | ขอความช่วยเหลือ (ตัดออกเพราะไม่มีทีมดูแล — มีแค่เบอร์ฉุกเฉิน) |
| แจ้งจุดท่วม + รูป (บีบอัด/ลบ EXIF ในเครื่อง) + โหวต ยังท่วม/น้ำลด/ผิด + หมดอายุ 4 ชม. | ตั้งเวลารีเฟรชข้อมูลสถานีอัตโนมัติ (ดูด้านล่าง) |
| จุดของฉัน (บ้าน/ที่จอดรถ/ที่ทำงาน) เก็บในเครื่อง | |

## วาดเส้นถนน / พื้นที่ที่ท่วม
ปุ่ม "แจ้งจุดน้ำท่วม" มี 3 โหมด: ปักหมุดจุด · วาดถนนช่วงที่ท่วม (แตะตามแนวถนน 2–40 จุด) · วาดพื้นที่ (3–40 จุด) แสดงความยาว/ขนาดอัตโนมัติ เก็บใน Firestore เป็น `kind` + `geom` (`[lat,lng,lat,lng,...]`) โค้ดอยู่ `src/lib/shape.js`, กฎตรวจใน `firestore.rules` (ทดสอบด้วย `npm run test:rules`)
ยังไม่มีการ "ปรับเส้นให้ตรงถนนอัตโนมัติ" — ลอง OSRM map-matching แล้วผลเพี้ยน (confidence 0)

## รันในเครื่อง
```bash
npm install
npm run data     # ดึงสถานีวัดน้ำล่าสุดเป็น public/data/stations.json
npm run dev      # http://127.0.0.1:5173
npm test         # ทดสอบ logic (ความเสี่ยง, แปลงข้อมูล, พยากรณ์)
npm run test:rules   # ทดสอบกฎ Firestore (ต้องมี Java — ใช้ emulator)
```
ถ้ายังไม่ใส่ค่า Firebase แอปจะอยู่ใน **โหมดทดลอง** (รายงานเก็บใน localStorage ของเครื่องนั้นเท่านั้น)

## เชื่อม Firebase (ครั้งเดียว)
1. Firebase console → โปรเจกต์ → **Build → Firestore Database** → Create (โหมด production)
2. **Build → Authentication → Sign-in method → Anonymous → Enable** (ผู้ใช้ไม่ต้องล็อกอิน แต่ได้ uid ไว้จำกัดสแปม/โหวตซ้ำ)
3. **Project settings → Your apps → Web app** → คัดลอก config ไปวางใน `src/firebase-config.js`
4. (ต้องเปิด billing/Blaze) Firestore → **TTL policy**: collection group `reports`, field `expiresAt` ลบรายงานเก่าอัตโนมัติ — บนแผนฟรีทำไม่ได้ (gcloud ตอบ "billing disabled") รายงานจะหายจากแผนที่ใน 4 ชม. แต่ข้อมูลยังค้างในฐานข้อมูล ต้องลบเองเป็นระยะ: `firebase firestore:delete /reports --recursive --force --project bkkflood-d54cc` (ลบทั้งหมด ใช้ตอนไม่มีรายงานที่ต้องเก็บ)
5. `npx firebase deploy --only firestore:rules,hosting --project <PROJECT_ID>`

> `firebase.json` ตั้งไว้ที่ hosting site `bkkflood` (https://bkkflood.web.app) ในโปรเจกต์ `bkkflood-d54cc`

## โควตาฟรี (Spark) — ข้อควรรู้
- Firestore อ่านได้ **50,000 ครั้ง/วัน** แอปอ่านเฉพาะรายงานที่ยัง active และ cache ในเครื่อง แต่ถ้าคนเข้าหลักพัน/วันอาจเต็ม
  → ถ้าใช้งานจริงหนัก ให้อัปเกรดเป็น Blaze + ตั้ง budget alert (ค่าใช้จ่ายช่วงนี้ต่ำมาก)
- ไม่มี Cloud Functions/Storage บนแผนฟรี → รูปถูกบีบเหลือ ~130 KB เก็บใน Firestore (3 รูป/รายงาน)
- แผนที่ใช้ tile ของ OpenStreetMap (ห้ามใช้หนัก) — ถ้าคนเยอะให้เปลี่ยนเป็น MapTiler/Longdo ใน `src/main.js`

## จุดน้ำท่วมจาก กทม. (Traffy Fondue)
เรื่องร้องเรียน "น้ำท่วม" ของประชาชนใน กทม. ดึงจาก API สาธารณะ แล้วจัดระดับ หนัก/ปานกลาง/เล็กน้อย **จากข้อความที่ผู้แจ้งเขียน** (ระดับน้ำเป็น ซม., คำว่าเข่า/เอว, รถผ่านไม่ได้, น้ำเข้าบ้าน ฯลฯ + จำนวนเรื่องใกล้เคียง 300 ม.) — กฎอยู่ใน `src/lib/traffy.js` มีเทสต์ใน `tests/traffy.test.js`
- API ตัวจริงหนัก ~2 MB และกรองประเภทเองไม่ได้ จึงมี `npm run data` สร้าง `public/data/floods.json` (~260 KB, ~60 KB gzip) ให้ CDN เสิร์ฟ
- ถ้า snapshot เก่ากว่า 2 ชม. เว็บจะไปดึง API ตัวจริงโดยตรง (หนักทั้งฝั่งผู้ใช้และ Traffy) → **ควรตั้งเวลารัน `npm run data` + build + deploy ทุก ~10–15 นาที**
- **อัปเดตอัตโนมัติด้วย GitHub Actions (ใช้งานจริงอยู่):** repo `realsuperman-hub/bkkflood` (public) · workflow `.github/workflows/refresh.yml` รันทุก ~15 นาที (GitHub อาจล่าช้าได้หลายนาที) ดึงข้อมูล → build → deploy ขึ้น bkkflood.web.app
  - รหัสลับ: secret `FIREBASE_SERVICE_ACCOUNT` = คีย์ของบัญชีบริการ `bkkflood-deployer@bkkflood-d54cc.iam.gserviceaccount.com` (สิทธิ์ Firebase Hosting Admin เท่านั้น) — ถ้ารั่วให้ลบคีย์ที่ Google Cloud → IAM → Service Accounts แล้วสร้างใหม่
  - **ทุกการ push เข้า `main` จะ deploy ขึ้นเว็บจริงทันที**
  - GitHub จะ **ปิด schedule อัตโนมัติถ้า repo ไม่มีกิจกรรมเลย 60 วัน** — ถ้าข้อมูลบนเว็บค้าง ให้เข้าแท็บ Actions แล้วกด Enable/Run workflow
  - งาน Windows `BKKFLOOD-refresh` (`scripts/refresh.ps1`) **ปิดไว้แล้ว** เพราะมันจะ deploy โค้ด dist เก่าจากเครื่องทับของใหม่ ห้ามเปิดพร้อมกัน
- ยังไม่ได้ตรวจเงื่อนไขการใช้งานข้อมูล Traffy Fondue อย่างเป็นทางการ

## ข้อมูลสถานีวัดน้ำ
ผู้เข้าเว็บแต่ละคนจะโหลดจาก ThaiWater โดยตรง (1.4 MB) เมื่อไม่มี snapshot ที่สดกว่า 30 นาที
เพื่อลดภาระ ให้รัน `npm run data && npm run build && firebase deploy --only hosting` เป็นระยะ (เช่น GitHub Actions ทุก 20 นาที)
แล้วผู้ใช้จะโหลด `data/stations.json` (~10 KB) จาก CDN แทน

## ข้อจำกัดที่ต้องบอกผู้ใช้ตรงๆ
- ThaiWater ใช้ endpoint ที่เว็บเขาใช้เอง (ไม่ใช่ API ทางการ) อาจเปลี่ยนโครงสร้างได้
- สถานีใน กทม.+ปริมณฑลมีแค่ ~29 จุด ระดับน้ำในคลอง ≠ น้ำบนถนนหน้าบ้าน
- ความสูงพื้นที่ (DEM ~90 ม.) หยาบ คลาดเคลื่อนได้ ±1 ม.
- ยังไม่ได้เชื่อมข้อมูล กทม. (สำนักการระบายน้ำ), GISTDA, เขื่อน, กรมอุตุฯ (ต้องขอ token/หา endpoint)
- คะแนนความเสี่ยงเป็นกฎเริ่มต้น ต้องเทียบกับเหตุการณ์จริงก่อนเชื่อถือสูง
