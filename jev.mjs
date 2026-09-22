export async function decideWithJev(configuration,state,{fetcher=fetch,signal,test=false}={}){
  if(!configuration?.key)throw new Error('先连接你的 Jev API Key，或切换到本地练习。');
  const started=performance.now();let response;
  try{
    response=await fetcher('https://api.typesafe.ai/v1/systemone',{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${configuration.key}`},body:JSON.stringify({model:configuration.model||'jev-latest',state,questions:{direction:{type:'choice',instructions:test?'Connection test: choose left.':'Choose your direction in this two-lane evasion game. Follow your assigned role. Use only the completed history to anticipate the human. Do not assume you see the current human move. Return one of the two legal directions.',criteria:{left:{name:'Left',description:'Choose the left lane.'},right:{name:'Right',description:'Choose the right lane.'}}}}})});
  }catch{throw new Error(signal?.aborted?'请求已取消。':'Jev 连接失败或等待超过 20 秒。请重试，本回合未扣分。');}
  if(!response.ok){const errors={401:'API Key 无效，请检查连接设置。',403:'当前 Key 无权使用这个模型。',429:'Jev 调用频率或额度已达上限，请稍后重试。'};throw new Error(errors[response.status]||`Jev 返回 HTTP ${response.status}，本回合未扣分。`);}
  const reader=response.body?.getReader();if(!reader)throw new Error('Jev 返回了空响应，请重试。');
  let bytes=0;const chunks=[];try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>100000){await reader.cancel();throw new Error('Jev 响应过大，请重试。');}chunks.push(value);}}finally{reader.releaseLock();}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Jev 响应格式无效，请重试。');}
  const answer=data?.answers?.direction;
  if(answer?.type!=='choice'||!['left','right'].includes(answer.choice))throw new Error('Jev 未返回有效的左右选择，请重试。');
  const probability=answer.probabilities?.[answer.choice];
  return {choice:answer.choice,model:typeof data.model==='string'?data.model:configuration.model,elapsedMs:Math.round(performance.now()-started),probability:typeof probability==='number'&&probability>=0&&probability<=1?probability:null};
}
