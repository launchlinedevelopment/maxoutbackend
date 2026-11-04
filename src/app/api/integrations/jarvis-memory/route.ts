import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {db} from "../../../../lib/db";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const noStore={"Cache-Control":"private, no-store"};
const MAX_CONTENT=4000;
type MemoryRow={id:string;role:string;content:string;origin:string;created_at:string};
function secure(request:NextRequest){
 const header=request.headers.get("authorization")||"";
 const secret=process.env.JARVIS_MEMORY_TOKEN||"";
 if(!header.startsWith("Bearer ")||secret.length<32)return false;
 const given=Buffer.from(header.slice(7)),expected=Buffer.from(secret);
 return given.length===expected.length&&timingSafeEqual(given,expected);
}
let initialized:Promise<void>|undefined;
function initialize(){if(!initialized)initialized=(async()=>{
 await db().query("CREATE SCHEMA IF NOT EXISTS jarvis_private");
 await db().query(`CREATE TABLE IF NOT EXISTS jarvis_private.conversation_messages (
   id BIGSERIAL PRIMARY KEY,
   role TEXT NOT NULL CHECK (role IN ('user','assistant')),
   content TEXT NOT NULL CHECK (length(content) <= 4000),
   origin TEXT NOT NULL CHECK (origin IN ('LIFE','OS')),
   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await db().query("CREATE INDEX IF NOT EXISTS jarvis_private_messages_created_idx ON jarvis_private.conversation_messages(created_at DESC)");
})().catch(e=>{initialized=undefined;throw e});return initialized}
function error(message:string,status:number){return NextResponse.json({error:message},{status,headers:noStore})}
export async function GET(req:NextRequest){
 if(!secure(req))return error("Unauthorized",401);
 try{
  await initialize();
  const mode=req.nextUrl.searchParams.get("mode")||"recent";
  if(mode==="health"){
   const client=await db().connect();
   try{
    await client.query("BEGIN");
    const row=await client.query<{id:string}>("INSERT INTO jarvis_private.conversation_messages(role,content,origin) VALUES('user','JARVIS_MEMORY_SELF_TEST','OS') RETURNING id::text");
    const found=await client.query("SELECT id FROM jarvis_private.conversation_messages WHERE id=$1",[row.rows[0].id]);
    await client.query("ROLLBACK");
    return NextResponse.json({status:"ready",readWrite:found.rowCount===1,rolledBack:true},{headers:noStore});
   }catch(e){await client.query("ROLLBACK");throw e}
   finally{client.release()}
  }
  const query=(req.nextUrl.searchParams.get("q")||"").trim().slice(0,180);
  const searchTerms=(query.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).slice(0,8).join(" | ");
  const amount=Math.max(1,Math.min(Number(req.nextUrl.searchParams.get("limit")||30)||30,100));
  const results=mode==="search"&&searchTerms.length>1?
   await db().query<MemoryRow>(`SELECT id::text,role,content,origin,created_at::text
     FROM jarvis_private.conversation_messages
     WHERE to_tsvector('english',content) @@ to_tsquery('english',$1)
     ORDER BY created_at DESC LIMIT $2`,[searchTerms,amount]):
   await db().query<MemoryRow>(`SELECT id::text,role,content,origin,created_at::text
     FROM jarvis_private.conversation_messages
     ORDER BY created_at DESC LIMIT $1`,[amount]);
  return NextResponse.json({messages:results.rows.reverse(),mode,stored:true},{headers:noStore});
 }catch{return error("Memory database unavailable",503)}
}
export async function POST(req:NextRequest){
 if(!secure(req))return error("Unauthorized",401);
 let payload:unknown;try{payload=await req.json()}catch{return error("Invalid JSON",400)}
 const input=payload as {messages?:{role:string;content:string;origin:string}[]};
 if(!Array.isArray(input?.messages)||input.messages.length<1||input.messages.length>2)return error("Invalid memory messages",400);
 const messages=input.messages;
 if(messages.some(m=>!m||!["user","assistant"].includes(m.role)||!["LIFE","OS"].includes(m.origin)||typeof m.content!=="string"||!m.content.trim()||m.content.length>MAX_CONTENT))return error("Invalid memory entry",400);
 try{
  await initialize();
  const client=await db().connect();
  try{
   await client.query("BEGIN");
   for(const m of messages)await client.query("INSERT INTO jarvis_private.conversation_messages(role,content,origin) VALUES($1,$2,$3)",[m.role,m.content,m.origin]);
   // Keep approximately the most recent 3000 utterances until explicitly cleared.
   await client.query("DELETE FROM jarvis_private.conversation_messages WHERE id IN (SELECT id FROM jarvis_private.conversation_messages ORDER BY id DESC OFFSET 3000)");
   await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
  return NextResponse.json({saved:true,count:messages.length},{headers:noStore});
 }catch{return error("Could not save conversation",503)}
}
export async function DELETE(req:NextRequest){
 if(!secure(req))return error("Unauthorized",401);
 try{await initialize();await db().query("DELETE FROM jarvis_private.conversation_messages");return NextResponse.json({cleared:true},{headers:noStore})}
 catch{return error("Could not clear memory",503)}
}
