import { get, put, head, list, del } from '@vercel/blob';
import JSZip from 'jszip';
import { randomUUID, randomBytes, createHmac, timingSafeEqual, scryptSync } from 'node:crypto';

// Vercel Blob adapter for the existing JSON document store.
// Create a PRIVATE Blob store and connect BLOB_READ_WRITE_TOKEN in Vercel.
const STORE = {
  async get(key, options = {}) {
    const result = await get(key, { access: 'private' });
    if (!result) return null;
    const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
    if (options.type === 'json') return JSON.parse(buffer.toString('utf8'));
    if (options.type === 'arrayBuffer') return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return buffer;
  },
  async getWithMetadata(key, options = {}) {
    const result = await get(key, { access: 'private' });
    if (!result) return null;
    const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
    return { data: options.type === 'json' ? JSON.parse(buffer.toString('utf8')) : buffer, etag: result.blob.etag };
  },
  async setJSON(key, value, options = {}) {
    const body = JSON.stringify(value);
    try {
      if (options.onlyIfMatch) {
        await put(key, body, { access: 'private', addRandomSuffix: false, allowOverwrite: true, ifMatch: options.onlyIfMatch, contentType: 'application/json' });
      } else if (options.onlyIfNew) {
        try { await head(key); return { modified: false }; }
        catch {
          await put(key, body, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
        }
      } else {
        await put(key, body, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
      }
      return { modified: true };
    } catch (error) {
      if (error?.name === 'BlobPreconditionFailedError' || error?.name === 'BlobAlreadyExistsError' || error?.status === 409 || error?.status === 412 || error?.statusCode === 409 || error?.statusCode === 412) return { modified: false };
      throw error;
    }
  },
  async set(key, value, options = {}) {
    await put(key, value, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: options.metadata?.contentType || 'application/octet-stream' });
  },
  async getMetadata(key) {
    try { const metadata = await head(key); return { metadata: { contentType: metadata.contentType }, etag: metadata.etag }; }
    catch { return null; }
  },
  async list(options = {}) {
    const blobs = []; let cursor;
    do {
      const page = await list({ prefix: options.prefix || '', limit: 1000, cursor });
      blobs.push(...page.blobs.map(blob => ({ key: blob.pathname })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return { blobs };
  },
  async delete(key) { await del(key); }
};
const DB_KEY = 'database.json';
const json = (statusCode, data, headers={}) => ({ statusCode, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers }, body: JSON.stringify(data) });
const bytes = (statusCode, body, contentType, headers={}) => ({ statusCode, headers: { 'content-type':contentType, 'cache-control':'no-store', ...headers }, body: Buffer.from(body).toString('base64'), isBase64Encoded:true });
const emptyDB = () => ({ version:1, users:[], products:[], categories:[], inventory:[], orders:[] });
const safeDB = d => ({ version:1, users:Array.isArray(d?.users)?d.users:[], products:Array.isArray(d?.products)?d.products:[], categories:Array.isArray(d?.categories)?d.categories:[], inventory:Array.isArray(d?.inventory)?d.inventory:[], orders:Array.isArray(d?.orders)?d.orders:[] });
async function readDB(){ return safeDB(await STORE.get(DB_KEY,{type:'json'}) || emptyDB()); }
async function updateDB(mutator){
  for(let i=0;i<10;i++){
    const current=await STORE.getWithMetadata(DB_KEY,{type:'json'});
    const db=safeDB(current?.data || emptyDB()); const result=await mutator(db);
    const write=current?.etag ? await STORE.setJSON(DB_KEY,db,{onlyIfMatch:current.etag}) : await STORE.setJSON(DB_KEY,db,{onlyIfNew:true});
    if(write.modified)return result;
  }
  throw new Error('Data sedang diperbarui oleh proses lain. Coba lagi.');
}
const b64 = v => Buffer.from(v).toString('base64url');
function sign(value){ const secret=process.env.SESSION_SECRET||''; if(secret.length<32)throw new Error('SESSION_SECRET belum diatur atau terlalu pendek.'); return createHmac('sha256',secret).update(value).digest('base64url'); }
function cookieValue(event,name){const raw=event.headers?.cookie||event.headers?.Cookie||'';return raw.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';}
function makeSession(identity){const payload=b64(JSON.stringify({...identity,exp:Date.now()+12*60*60*1000}));return `${payload}.${sign(payload)}`;}
function sessionUser(event){try{const token=cookieValue(event,'ng_session');const [payload,sig]=token.split('.');if(!payload||!sig)return null;const expected=sign(payload);const a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))return null;const data=JSON.parse(Buffer.from(payload,'base64url').toString());if(!data.exp||data.exp<Date.now()||!data.u||!['admin','user'].includes(data.role))return null;if(data.role==='admin'&&data.u!==process.env.ADMIN_USERNAME)return null;return data;}catch{return null;}}
function requireAuth(event){const user=sessionUser(event);if(!user)throw Object.assign(new Error('Silakan login terlebih dahulu.'),{status:401});return user;}
function requireAdmin(event){const user=requireAuth(event);if(user.role!=='admin')throw Object.assign(new Error('Akses khusus admin.'),{status:403});return user;}
function passwordHash(password,salt=randomBytes(16).toString('hex')){return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
function passwordMatches(password,stored){try{const [salt,hash]=String(stored||'').split(':');if(!salt||!hash)return false;const actual=scryptSync(password,salt,64);const expected=Buffer.from(hash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}catch{return false;}}
function sameSecret(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
const sessionCookie = token => `ng_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`;
const clearSessionCookie = 'ng_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
const bodyJSON = event => {try{return JSON.parse(event.body||'{}')}catch{throw Object.assign(new Error('Format JSON tidak valid.'),{status:400})}};
const clean = s => String(s??'').trim();
const slug = s => clean(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const baseURL = () => (process.env.NEXAPAYZ_BASE_URL||'https://nexapayz.alluffystore.my.id').replace(/\/$/,'');
async function gateway(path, init={}){if(!process.env.NEXAPAYZ_API_KEY)throw new Error('NEXAPAYZ_API_KEY belum diatur di Vercel.');const res=await fetch(`${baseURL()}${path}`,{...init,headers:{'x-api-key':process.env.NEXAPAYZ_API_KEY,'accept':'application/json',...(init.headers||{})},cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.message||data.error||`NexaPayz error (${res.status})`);return data;}
const unwrap = d => d?.data && typeof d.data==='object'?d.data:d;
const orderPublic = o => ({order_code:o.order_code,product_name:o.product_name,total:o.total,status:o.status,payment_link:o.payment_link,qris_image:o.qris_image});
async function verifyAndFulfill(orderCode){
  const db=await readDB();const order=db.orders.find(o=>o.order_code===orderCode);if(!order)throw new Error('Pesanan tidak ditemukan.');if(order.status==='paid'||order.status==='expired')return order;
  const raw=await gateway(`/api/invoice/status?id=${encodeURIComponent(order.invoice_id)}`);const d=unwrap(raw);const state=String(d.status||d.payment_status||d.transaction_status||'').toLowerCase();
  if(['paid','success','settlement','completed','berhasil'].includes(state)){
    await updateDB(async data=>{const o=data.orders.find(x=>x.order_code===orderCode);if(!o||o.status==='paid')return;let delivery=o.delivery_value||'';if(o.delivery_type==='code'){const item=data.inventory.find(x=>x.product_id===o.product_id&&!x.is_used);if(item){item.is_used=true;item.order_code=o.order_code;delivery=item.secret_value;}else delivery='Pembayaran berhasil, tetapi stok kode sedang kosong. Silakan hubungi admin dengan kode pesanan '+o.order_code+'.';}o.delivery_value=delivery;o.status='paid';o.paid_at=new Date().toISOString();});
  }else if(['expired','expire','cancelled','canceled','failed'].includes(state)){await updateDB(data=>{const o=data.orders.find(x=>x.order_code===orderCode);if(o&&o.status==='pending')o.status='expired';});}
  return (await readDB()).orders.find(o=>o.order_code===orderCode);
}
async function route(event){
  const path=(event.path||new URL(event.rawUrl).pathname).replace(/^\/.+?\/functions\/api/,'').replace(/^\/api/,'').replace(/\/$/,'')||'/';
  const method=event.httpMethod||'GET';
  if(method==='GET'&&path==='/health'){let storage='not-configured';if(process.env.BLOB_READ_WRITE_TOKEN){try{await STORE.get(DB_KEY,{type:'json'});storage='connected';}catch{storage='unavailable';}}return json(200,{ok:true,service:'NEXTGEN STORE API',runtime:'Vercel Functions',storage,sessionSecretConfigured:Boolean(process.env.SESSION_SECRET&&process.env.SESSION_SECRET.length>=32),adminConfigured:Boolean(process.env.ADMIN_USERNAME&&process.env.ADMIN_PASSWORD),paymentConfigured:Boolean(process.env.NEXAPAYZ_API_KEY)});}
  if(method==='GET'&&path==='/products'){requireAuth(event);const db=await readDB();const categories=db.categories;const products=db.products.filter(p=>p.is_active).map(p=>({...p,category_name:categories.find(c=>c.id===p.category_id)?.name||''}));return json(200,{products,categories});}
  if(method==='GET'&&path==='/image'){requireAuth(event);const key=clean(new URL(event.rawUrl).searchParams.get('key'));if(!/^images\/[a-zA-Z0-9._-]+$/.test(key))return json(400,{error:'Key gambar tidak valid.'});const data=await STORE.get(key,{type:'arrayBuffer'});const meta=await STORE.getMetadata(key);if(!data)return json(404,{error:'Gambar tidak ditemukan.'});const type=meta?.metadata?.contentType||'application/octet-stream';return bytes(200,Buffer.from(data),type,{'cache-control':'private, no-store', 'x-content-type-options':'nosniff'});}
  if(method==='POST'&&path==='/checkout'){
    const auth=requireAuth(event);if(auth.role!=='user')throw Object.assign(new Error('Akun admin tidak dapat melakukan checkout.'),{status:403});const b=bodyJSON(event);const db=await readDB();const p=db.products.find(x=>x.id===b.product_id&&x.is_active);if(!p)throw Object.assign(new Error('Produk tidak tersedia.'),{status:404});if(p.delivery_type==='code'&&!db.inventory.some(x=>x.product_id===p.id&&!x.is_used))throw new Error('Stok produk sedang habis.');
    const buyer=db.users.find(u=>u.id===auth.id);if(!buyer)throw Object.assign(new Error('Akun tidak ditemukan. Silakan login kembali.'),{status:401});const name=buyer.display_name,email=buyer.email;
    const invoiceRaw=await gateway(`/api/invoice?amount=${encodeURIComponent(String(p.price))}`);const inv=unwrap(invoiceRaw);const invoiceId=String(inv.invoice_id||inv.invoiceId||inv.id||inv.reference||'');if(!invoiceId)throw new Error('NexaPayz tidak mengembalikan ID invoice. Periksa format respons gateway.');
    const orderCode='NG-'+randomUUID().replace(/-/g,'').slice(0,10).toUpperCase();const asset = value => { if(!value)return null; try{return new URL(value,baseURL()+'/').toString();}catch{return null;} };
    const order={id:randomUUID(),user_id:auth.id,order_code:orderCode,customer_name:name,customer_email:email,product_id:p.id,product_name:p.name,amount:Number(p.price),fee:Number(inv.fee||0),total:Number(inv.total||inv.amount||p.price),status:'pending',invoice_id:invoiceId,payment_link:asset(inv.payment_url||inv.payment_link||inv.checkout_url||inv.url),qris_image:asset(inv.qris_image||inv.qr_image||inv.qr_url),delivery_type:p.delivery_type,delivery_value:p.delivery_type==='code'?'':p.delivery_value||'',created_at:new Date().toISOString(),paid_at:null};
    await updateDB(data=>{data.orders.unshift(order);});return json(201,{order:orderPublic(order)});
  }
  if(method==='GET'&&path==='/orders/status'){const auth=requireAuth(event);const code=clean(new URL(event.rawUrl).searchParams.get('code'));const existing=(await readDB()).orders.find(item=>item.order_code===code);if(!existing||(auth.role!=='admin'&&existing.user_id!==auth.id))throw Object.assign(new Error('Pesanan tidak ditemukan.'),{status:404});const order=await verifyAndFulfill(code);return json(200,{order:{...orderPublic(order),delivery_value:order.status==='paid'?order.delivery_value:null}});}
  if(method==='GET'&&path==='/account/orders'){const auth=requireAuth(event);if(auth.role!=='user')return json(200,{orders:[]});const db=await readDB();const orders=db.orders.filter(o=>o.user_id===auth.id).map(o=>({...orderPublic(o),created_at:o.created_at,delivery_value:o.status==='paid'?o.delivery_value:null}));return json(200,{orders});}
  if(method==='POST'&&path==='/auth/register'){const b=bodyJSON(event);const username=clean(b.username).toLowerCase(),email=clean(b.email).toLowerCase(),displayName=clean(b.display_name),password=String(b.password||'');if(!/^[a-z0-9_]{3,24}$/.test(username))throw Object.assign(new Error('Username harus 3–24 karakter: huruf kecil, angka, atau underscore.'),{status:400});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>120)throw Object.assign(new Error('Format email tidak valid.'),{status:400});if(displayName.length<2||displayName.length>80)throw Object.assign(new Error('Nama lengkap harus 2–80 karakter.'),{status:400});if(password.length<8||password.length>128)throw Object.assign(new Error('Password harus 8–128 karakter.'),{status:400});if(username===(process.env.ADMIN_USERNAME||'').toLowerCase())throw Object.assign(new Error('Username tidak tersedia.'),{status:409});let created;await updateDB(db=>{if(db.users.some(u=>u.username===username||u.email===email))throw Object.assign(new Error('Username atau email sudah digunakan.'),{status:409});created={id:randomUUID(),username,email,display_name:displayName,password_hash:passwordHash(password),created_at:new Date().toISOString()};db.users.push(created);});const token=makeSession({id:created.id,u:created.username,role:'user'});return json(201,{ok:true,user:{id:created.id,username:created.username,email:created.email,display_name:created.display_name,role:'user'}},{'set-cookie':sessionCookie(token)});}
  if(method==='POST'&&path==='/auth/login'){const b=bodyJSON(event);const identity=clean(b.identity).toLowerCase(),password=String(b.password||'');if(!identity||!password)throw Object.assign(new Error('Username/email dan password wajib diisi.'),{status:400});if(process.env.ADMIN_USERNAME&&process.env.ADMIN_PASSWORD&&identity===process.env.ADMIN_USERNAME.toLowerCase()&&sameSecret(password,process.env.ADMIN_PASSWORD)){const token=makeSession({id:'admin',u:process.env.ADMIN_USERNAME,role:'admin'});return json(200,{ok:true,user:{username:process.env.ADMIN_USERNAME,role:'admin'}},{'set-cookie':sessionCookie(token)});}const db=await readDB();const user=db.users.find(u=>u.username===identity||u.email===identity);if(!user||!passwordMatches(password,user.password_hash))throw Object.assign(new Error('Akun atau password tidak cocok.'),{status:401});const token=makeSession({id:user.id,u:user.username,role:'user'});return json(200,{ok:true,user:{id:user.id,username:user.username,email:user.email,display_name:user.display_name,role:'user'}},{'set-cookie':sessionCookie(token)});}
  if(method==='POST'&&path==='/auth/logout')return json(200,{ok:true},{'set-cookie':clearSessionCookie});
  if(method==='GET'&&path==='/auth/me'){const auth=requireAuth(event);if(auth.role==='admin')return json(200,{user:{username:auth.u,role:'admin'}});const db=await readDB();const user=db.users.find(u=>u.id===auth.id);if(!user)throw Object.assign(new Error('Akun tidak ditemukan. Silakan login kembali.'),{status:401});return json(200,{user:{id:user.id,username:user.username,email:user.email,display_name:user.display_name,role:'user'}});}
  if(method==='GET'&&path==='/admin/products'){requireAdmin(event);const db=await readDB();return json(200,{products:db.products.map(p=>({...p,category_name:db.categories.find(c=>c.id===p.category_id)?.name||''})),categories:db.categories});}
  if(method==='POST'&&path==='/admin/products'){
    requireAdmin(event);const b=bodyJSON(event);const name=clean(b.name),price=Number(b.price),category=clean(b.category);if(name.length<2||!Number.isFinite(price)||price<1||!category)throw Object.assign(new Error('Nama, harga, dan kategori wajib diisi.'),{status:400});if(!['text','code'].includes(b.delivery_type))throw Object.assign(new Error('Jenis pengiriman tidak valid.'),{status:400});
    let imageURL='';if(b.image?.data){const buf=Buffer.from(b.image.data,'base64');if(buf.length>3*1024*1024)throw new Error('Gambar maksimal 3 MB.');const type=String(b.image.type||'');if(!['image/jpeg','image/png','image/webp'].includes(type))throw new Error('Format gambar harus JPG, PNG, atau WEBP.');const key=`images/${randomUUID()}.${type==='image/png'?'png':type==='image/webp'?'webp':'jpg'}`;await STORE.set(key,buf,{metadata:{contentType:type}});imageURL=`/api/image?key=${encodeURIComponent(key)}`;}
    const product={id:randomUUID(),name,slug:slug(name),description:clean(b.description),image_url:imageURL,price,category_id:null,delivery_type:b.delivery_type,delivery_value:b.delivery_type==='text'?clean(b.delivery_value):'',is_active:true,created_at:new Date().toISOString()};
    await updateDB(db=>{let c=db.categories.find(x=>x.slug===slug(category));if(!c){c={id:randomUUID(),name:category,slug:slug(category),created_at:new Date().toISOString()};db.categories.push(c);}product.category_id=c.id;db.products.unshift(product);if(b.delivery_type==='code'){const codes=String(b.delivery_value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);for(const code of codes)db.inventory.push({id:randomUUID(),product_id:product.id,secret_value:code,is_used:false,order_code:null});}});
    return json(201,{ok:true,product});
  }
  if(method==='PATCH'&&path==='/admin/products'){requireAdmin(event);const b=bodyJSON(event);await updateDB(db=>{const p=db.products.find(x=>x.id===b.id);if(!p)throw Object.assign(new Error('Produk tidak ditemukan.'),{status:404});p.is_active=Boolean(b.is_active);});return json(200,{ok:true});}
  if(method==='DELETE'&&path==='/admin/products'){requireAdmin(event);const b=bodyJSON(event);await updateDB(db=>{db.products=db.products.filter(x=>x.id!==b.id);db.inventory=db.inventory.filter(x=>x.product_id!==b.id||x.is_used);});return json(200,{ok:true});}
  if(method==='GET'&&path==='/admin/orders'){requireAdmin(event);const db=await readDB();return json(200,{orders:db.orders});}
  if(method==='GET'&&path==='/admin/backup'){
    requireAdmin(event);const db=await readDB();const backupDB={...db,users:[]};const zip=new JSZip();zip.file('database.json',JSON.stringify(backupDB,null,2));const listed=await STORE.list({prefix:'images/'});const folder=zip.folder('images');for(const item of listed.blobs){const data=await STORE.get(item.key,{type:'arrayBuffer'});if(data)folder.file(item.key.slice(7),Buffer.from(data));}zip.file('BACKUP-INFO.txt',`NEXTGEN STORE BACKUP\nCreated: ${new Date().toISOString()}\nContains database.json and images/.\nSecrets are intentionally excluded.\n`);const archive=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});if(archive.length>4*1024*1024)throw new Error('Ukuran backup melebihi batas aman Vercel Functions (4 MB). Kurangi ukuran/jumlah gambar lalu coba lagi.');return bytes(200,archive,'application/zip',{'content-disposition':`attachment; filename="nextgen-store-backup-${new Date().toISOString().slice(0,10)}.zip"`});
  }
  if(method==='POST'&&path==='/admin/restore'){
    requireAdmin(event);const req=new Request(event.rawUrl,{method:'POST',headers:event.headers,body:event.isBase64Encoded?Buffer.from(event.body||'','base64'):event.body});const form=await req.formData();const file=form.get('backup');if(!file||typeof file.arrayBuffer!=='function')throw Object.assign(new Error('File backup ZIP tidak ditemukan.'),{status:400});if(file.size>50*1024*1024)throw new Error('Ukuran backup maksimal 4 MB pada konfigurasi Vercel Functions ini.');const zip=await JSZip.loadAsync(await file.arrayBuffer());const dbFile=zip.file('database.json');if(!dbFile)throw new Error('Backup tidak valid: database.json tidak ditemukan.');let parsed;try{parsed=JSON.parse(await dbFile.async('string'));}catch{throw new Error('File database.json rusak.');}const db=safeDB(parsed);if(parsed.version!==1)throw new Error('Versi backup tidak didukung.');const images=[];for(const [name,item] of Object.entries(zip.files)){if(item.dir||!name.startsWith('images/'))continue;const filename=name.slice(7);if(!/^[a-zA-Z0-9._-]+$/.test(filename))continue;const buf=await item.async('nodebuffer');const ext=filename.split('.').pop().toLowerCase();const contentType=ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg';images.push({key:`images/${filename}`,buf,contentType});}
    const old=await STORE.list({prefix:'images/'});for(const item of old.blobs)await STORE.delete(item.key);for(const image of images)await STORE.set(image.key,image.buf,{metadata:{contentType:image.contentType}});const current=await readDB();db.users=current.users;await STORE.setJSON(DB_KEY,db);return json(200,{ok:true,products:db.products.length,orders:db.orders.length,images:images.length});
  }
  return json(404,{error:'Endpoint tidak ditemukan.'});
}
export const handler=async event=>{try{return await route(event);}catch(error){console.error('NEXTGEN API:',error);return json(error.status||500,{error:error.message||'Terjadi kesalahan server.'});}};
