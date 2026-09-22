import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createGame,publicGame,practiceDecision,decisionState,lockChoice,playRound} from './game.mjs';
import {decideWithJev} from './jev.mjs';
const root=fileURLToPath(new URL('./public/',import.meta.url));
export function createApp({fetcher=fetch,defaultKey='',defaultModel='jev-latest',allowedHosts=['127.0.0.1','localhost','[::1]']}={}){
  const acceptedHosts=new Set(allowedHosts.flatMap((value)=>String(value).split(',').map((item)=>item.trim()).filter(Boolean)));
  const sessions=new Map();
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  function prepare(session){
    const game=session.game;
    if(!game||game.pending)return Promise.resolve();
    if(session.preparing)return session.preparing;
    const round=game.round,controller=new AbortController();session.controller=controller;game.phase='preparing';game.error=null;
    const work=(async()=>{
      try{
        const result=game.mode==='jev'?await decideWithJev(session.configuration,decisionState(game),{fetcher,signal:controller.signal}):practiceDecision(game);
        if(!controller.signal.aborted&&session.game===game&&game.round===round)lockChoice(game,result);
      }catch(error){if(!controller.signal.aborted&&session.game===game&&game.round===round){game.phase='error';game.error=error.message;}}
    })();
    session.preparing=work;
    void work.finally(()=>{if(session.preparing===work){session.preparing=null;session.controller=null;}});
    return work;
  }
  const server=createServer(async(req,res)=>{
    try{
      const hostHeader=String(req.headers.host||'');
      let hostName='';try{hostName=new URL(`http://${hostHeader}`).hostname;}catch{}
      if(!acceptedHosts.has(hostHeader)&&!acceptedHosts.has(hostName))return send(res,403,{error:'访问地址不受支持。'});
      const url=new URL(req.url,'http://localhost');
      if(!url.pathname.startsWith('/api/')){
        const files={'/':'index.html','/app.js':'app.js','/art.js':'art.js','/style.css':'style.css','/favicon.svg':'favicon.svg','/manifest.webmanifest':'manifest.webmanifest'};const file=files[url.pathname];
        if(!file||req.method!=='GET')return send(res,404,{error:'页面不存在。'});
        const data=await readFile(join(root,file));const contentType=file.endsWith('.html')?'text/html;charset=utf-8':file.endsWith('.css')?'text/css;charset=utf-8':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webmanifest')?'application/manifest+json':'text/javascript;charset=utf-8';res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(data);return;
      }
      const origin=req.headers.origin;
      const sameOrigin=!origin||origin===`http://${hostHeader}`||origin===`https://${hostHeader}`;
      if(req.method==='POST'&&(!sameOrigin||!String(req.headers['content-type']).startsWith('application/json')))return send(res,403,{error:'请求来源或格式无效。'});
      const now=Date.now();for(const[id,s]of sessions)if(now-s.touched>6*3600000){s.controller?.abort();sessions.delete(id);}
      let id=String(req.headers.cookie||'').match(/(?:^|;\s*)catch_session=([a-f0-9]{48})/)?.[1];
      if(!id||!sessions.has(id)){if(sessions.size>=100)return send(res,503,{error:'当前会话较多，请稍后重试。'});id=randomBytes(24).toString('hex');sessions.set(id,{game:null,configuration:defaultKey?{key:defaultKey,model:defaultModel}:null,verified:false,preparing:null,controller:null,testing:false,touched:now});res.setHeader('Set-Cookie',`catch_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=21600`);}
      const session=sessions.get(id);session.touched=now;
      const state=()=>({game:session.game?publicGame(session.game):null,connection:{configured:!!session.configuration,model:session.configuration?.model||defaultModel,verified:session.verified}});
      if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,state());
      if(req.method!=='POST')return send(res,405,{error:'请使用 JSON POST。'});
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw new Error('请求内容过大。');}
      let body;try{body=JSON.parse(raw);}catch{throw new Error('请求格式无效。');}if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('请求格式无效。');
      if(url.pathname==='/api/game'){
        if(body.mode==='jev'&&!session.configuration)throw new Error('请先连接 Jev，或选择本地练习。');
        const game=createGame(body.mode);session.controller?.abort();session.preparing=null;session.game=game;
        // The first round needs a decision before the buttons become usable.
        // Practice mode resolves synchronously; Jev mode loads in the
        // background and the client polls until its commitment is ready.
        if(game.mode==='practice')await prepare(session);else void prepare(session);
        return send(res,200,state());
      }
      if(url.pathname==='/api/prepare'){
        if(!session.game||body.gameId!==session.game.id||body.round!==session.game.round)throw new Error('对局或回合已更新，请刷新。');
        const game=session.game;await prepare(session);if(session.game!==game)throw new Error('对局已切换。');return send(res,200,state());
      }
      if(url.pathname==='/api/choice'){
        const game=session.game;if(!game||body.gameId!==game.id)throw new Error('对局已切换，请刷新。');
        const result=playRound(game,body);
        // Start the next decision while the client plays this round's reveal
        // animation. Never hold the choice request open for model latency: the
        // client can show the result immediately and poll for the next round.
        void prepare(session);
        return send(res,200,{...state(),result});
      }
      if(url.pathname==='/api/connection'||url.pathname==='/api/connection/test'){
        if(session.testing)return send(res,409,{error:'连接测试正在进行，请稍候。'});
        if(body.clear){session.configuration=null;session.verified=false;return send(res,200,state());}
        const key=body.key===undefined||body.key===''?session.configuration?.key:body.key,model=body.model||defaultModel;
        if(typeof key!=='string'||!key.trim()||key.length>2048)throw new Error('请输入有效的 Jev API Key。');
        if(typeof model!=='string'||!model.trim()||model.length>160)throw new Error('请输入有效模型名。');
        const configuration={key:key.trim(),model:model.trim()};
        if(url.pathname.endsWith('/test')){
          session.testing=true;try{const result=await decideWithJev(configuration,{task:'Test connection. Choose left.'},{fetcher,test:true});if(configuration.key===session.configuration?.key&&configuration.model===session.configuration?.model)session.verified=true;return send(res,200,{ok:true,model:result.model,elapsedMs:result.elapsedMs});}finally{session.testing=false;}
        }
        const unchanged=configuration.key===session.configuration?.key&&configuration.model===session.configuration?.model;session.configuration=configuration;if(!unchanged)session.verified=false;return send(res,200,state());
      }
      return send(res,404,{error:'接口不存在。'});
    }catch(error){send(res,400,{error:error instanceof Error?error.message:'操作失败，请重试。'});}
  });
  server.on('close',()=>{for(const session of sessions.values())session.controller?.abort();});return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||8791);const host=process.env.HOST||'127.0.0.1';const allowedHosts=(process.env.ALLOWED_HOSTS||'127.0.0.1,localhost,[::1]').split(',').concat(process.env.RENDER_EXTERNAL_HOSTNAME||'').map((item)=>item.trim()).filter(Boolean);createApp({defaultKey:process.env.TYPESAFE_API_KEY||'',defaultModel:process.env.JEV_MODEL||'jev-latest',allowedHosts}).listen(port,host,()=>console.log(`Beat Jev · 打败 Jev → http://${host}:${port}`));}
