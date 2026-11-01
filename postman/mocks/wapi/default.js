const http = require('http');
const sent = new Map();
const server = http.createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 const key=String(req.headers.authorization||'').replace('Bearer ','');
 const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(!key.startsWith('test-'))return reply(401,{success:false});
 if(path==='/api/v1/account')return reply(200,{success:true,isActive:true,credits:1000});
 if(path==='/api/v1/devices')return reply(200,{success:true,devices:[{id:1,name:'Simulation device',status:'connected',isReady:true}]});
 if(path.startsWith('/api/v1/messages/'))return reply(200,{success:true,messageId:path.split('/').pop(),status:'completed',sent:1,failed:0});
 if(req.method!=='POST'||path!=='/api/v1/send/document')return reply(404,{success:false});
 let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
  let body;try{body=JSON.parse(raw);}catch{return reply(400,{success:false});}
  if(!body.fileName?.endsWith('.pdf')||Buffer.from(body.documentBase64||'','base64').subarray(0,5).toString()!=='%PDF-'||body.recipients?.length!==1||!/^\+\d+$/.test(body.recipients[0]))return reply(422,{success:false});
  const count=(sent.get(key)||0)+1;sent.set(key,count);
  // A second submission with this key fails: worker tests must poll, never POST twice.
  if(count>1)return reply(409,{success:false});
  if(key.includes('timeout'))return setTimeout(()=>reply(200,{success:true,messageId:42,status:'completed',sent:1,failed:0}),250);
  if(key.includes('server-error'))return reply(500,{success:false});
  if(key.includes('invalid-json')){res.writeHead(200);return res.end('invalid');}
  if(key.includes('queued'))return reply(200,{success:true,messageId:42,status:'queued',sent:0,failed:0});
  if(key.includes('failed'))return reply(200,{success:true,messageId:42,status:'failed',sent:0,failed:1});
  return reply(200,{success:true,messageId:42,status:'completed',sent:1,failed:0});
 });
});
module.exports=server;
if(require.main===module)server.listen(process.env.PORT||4500);
