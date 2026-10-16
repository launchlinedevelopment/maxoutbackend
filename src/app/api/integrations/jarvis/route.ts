import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {db,init} from '../../../../lib/db';
export const dynamic='force-dynamic';
function authorized(req:Request){
 const expected=process.env.JARVIS_INTEGRATION_TOKEN;
 const header=req.headers.get('authorization')||'';
 if(!expected||expected.length<32||!header.startsWith('Bearer '))return false;
 const actual=header.slice(7);
 const a=Buffer.from(actual),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export async function GET(req:Request){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'no-store'}});
 const kind=new URL(req.url).searchParams.get('kind')||'overview';
 if(!['overview','products','inventory','sales','tasks'].includes(kind))return NextResponse.json({error:'Unsupported report'},{status:400});
 try{
  await init();
  const result=await db().query('SELECT data FROM maxout_records WHERE kind=$1 ORDER BY id DESC LIMIT 1000',[kind==='overview'?'sales':kind]);
  const rows=result.rows.map(r=>r.data||{});
  if(kind==='overview'||kind==='sales'){
   const today=new Date().toISOString().slice(0,10);
   const todayRows=rows.filter(r=>String(r.date||r.order_date||r.created_at||'').slice(0,10)===today);
   const total=(a:any[])=>Math.round(a.reduce((n,r)=>n+(Number(r.revenue)||Number(r.total)||0),0)*100)/100;
   return NextResponse.json({report:kind,recordCount:rows.length,todayCount:todayRows.length,todayRevenue:total(todayRows),recordedRevenue:total(rows),note:'Figures reflect recorded backend sales, not necessarily live storefront orders.'},{headers:{'Cache-Control':'no-store'}});
  }
  if(kind==='products'||kind==='inventory')return NextResponse.json({report:kind,count:rows.length,items:rows.slice(0,100).map(r=>({name:String(r.name||r.product||'').slice(0,100),sku:String(r.sku||'').slice(0,60),status:String(r.status||'').slice(0,50),stock:Number.isFinite(Number(r.quantity??r.stock))?Number(r.quantity??r.stock):null}))},{headers:{'Cache-Control':'no-store'}});
  return NextResponse.json({report:kind,count:rows.length,items:rows.slice(0,100).map(r=>({title:String(r.title||r.name||'').slice(0,120),status:String(r.status||'').slice(0,50)}))},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Report unavailable'},{status:503})}
}
