'use strict';
const http=require('node:http');
const {URL}=require('node:url');
const port=Number(process.env.PORT||10000);
const site='https://alrowad-sofa.onrender.com';
const allowed=new Set([site]);
const pixel=process.env.TIKTOK_PIXEL_ID;
const token=process.env.TIKTOK_ACCESS_TOKEN;
const recent=new Map();
function output(res,status,payload,origin){
 res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':allowed.has(origin)?origin:site,'Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'});
 res.end(JSON.stringify(payload));
}
http.createServer(async(req,res)=>{
 const origin=String(req.headers.origin||'');
 if(req.method==='GET' && req.url==='/health'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
   return res.end(JSON.stringify({ok:true,configured:!!(pixel&&token)}));
 }
 if(req.url!=='/events'||!allowed.has(origin))return output(res,403,{error:'not_allowed'},origin);
 if(req.method==='OPTIONS')return output(res,204,{},origin);
 if(req.method!=='POST')return output(res,405,{error:'method'},origin);
 if(!pixel||!token)return output(res,503,{error:'not_configured'},origin);
 const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,90);
 const now=Date.now(), rec=recent.get(ip)||{start:now,count:0};
 if(now-rec.start>60000){rec.start=now;rec.count=0}
 rec.count++;recent.set(ip,rec);
 if(recent.size>4000)recent.clear();
 if(rec.count>80)return output(res,429,{error:'rate_limited'},origin);
 try {
  let raw='';
  for await(const part of req){raw+=part.toString();if(raw.length>4096)return output(res,413,{error:'body_too_big'},origin)}
  const data=JSON.parse(raw);
  if(data.event!=='ClickButton'||!['WhatsApp','Phone'].includes(data.channel)||!/^[a-zA-Z0-9_-]{12,96}$/.test(data.event_id||''))return output(res,422,{error:'invalid_event'},origin);
  let page;
  try{page=new URL(data.page_url)}catch{return output(res,422,{error:'invalid_url'},origin)}
  if(page.origin!==site)return output(res,422,{error:'invalid_url'},origin);
  const ua=String(req.headers['user-agent']||'').slice(0,350);
  const user={ip,user_agent:ua};
  if(typeof data.ttp==='string'&&data.ttp.length<220)user.ttp=data.ttp;
  if(typeof data.ttclid==='string'&&data.ttclid.length<220)user.ttclid=data.ttclid;
  const evt={event:'ClickButton',event_time:Math.floor(Date.now()/1000),event_id:data.event_id,user,page:{url:page.href},properties:{description:data.channel+' button click',button_name:data.channel}};
  const response=await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/',{method:'POST',headers:{'Access-Token':token,'Content-Type':'application/json'},body:JSON.stringify({event_source:'web',event_source_id:pixel,data:[evt]}),signal:AbortSignal.timeout(12000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.code!==0){console.error('TikTok response',response.status,result.code);return output(res,502,{error:'tiktok_rejected',code:result.code??null},origin)}
  console.log('TikTok accepted',data.event_id,data.channel,result.request_id||'');
  return output(res,200,{ok:true,request_id:result.request_id||null},origin);
 }catch(err){console.error('Relay processing failed',err?.message);return output(res,500,{error:'relay_error'},origin)}
}).listen(port,'0.0.0.0',()=>console.log('Events relay active',port));
