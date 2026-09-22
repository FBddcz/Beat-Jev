import { randomUUID, randomBytes, randomInt, createHash } from 'node:crypto';

export const SCENES = [
  { id:'forest',name:'晨雾森林',en:'THE MISTY WOODS',left:'左边树洞',right:'右边树洞',hint:'树叶轻轻响，你会躲向哪一边？',color:'#dce8c7' },
  { id:'candy',name:'软糖小镇',en:'CANDY CORNER',left:'薄荷糖屋',right:'草莓糖屋',hint:'甜甜的岔路，藏着你的小心思。',color:'#f4dce4' },
  { id:'beach',name:'贝壳海湾',en:'SHELL BAY',left:'左边贝壳',right:'右边贝壳',hint:'海浪来了，选一枚贝壳躲起来。',color:'#d7eeee' },
  { id:'cloud',name:'云朵邮局',en:'CLOUD POST',left:'左边云朵',right:'右边云朵',hint:'轻轻一跳，把自己的规律藏好。',color:'#e4e3f3' },
  { id:'garden',name:'午后花园',en:'AFTERNOON GARDEN',left:'雏菊花丛',right:'郁金花丛',hint:'最后一次躲避，然后换你来抓。',color:'#eaeacb' },
  { id:'space',name:'月亮车站',en:'MOON STATION',left:'左边月舱',right:'右边月舱',hint:'换你来抓！猜猜对手会落在哪一边。',color:'#dcdff3' },
  { id:'snow',name:'雪糕山谷',en:'FROZEN VALLEY',left:'左边冰屋',right:'右边冰屋',hint:'雪地上两串脚印，哪一串是真的？',color:'#deeded' },
  { id:'mushroom',name:'蘑菇秘境',en:'MUSHROOM HOLLOW',left:'左边菇伞',right:'右边菇伞',hint:'小蘑菇在摇头，对手也许正在换方向。',color:'#eee0d1' },
  { id:'desert',name:'落日沙丘',en:'SUNSET DUNES',left:'左边绿洲',right:'右边绿洲',hint:'别被之前的选择带偏，再相信一次直觉。',color:'#f0dfc5' },
  { id:'night',name:'星光露营地',en:'STARRY CAMP',left:'左边帐篷',right:'右边帐篷',hint:'最后一回合，抓住那一点点灵感。',color:'#d8e4e0' },
];
export const TOTAL=SCENES.length;
export const HISTORY_LIMIT=60;
export function sceneAt(round){return SCENES[round%SCENES.length];}
export function roleAt(round){return Math.floor(round/5)%2===0?'evader':'catcher';}
export function createGame(mode='practice'){
  if(!['practice','jev'].includes(mode))throw new Error('请选择练习或 Jev 对战。');
  return {id:randomUUID(),mode,round:0,playerScore:0,rivalScore:0,streak:0,bestStreak:0,history:[],pending:null,phase:'preparing',error:null,createdAt:new Date().toISOString()};
}
export function hashChoice(gameId,round,choice,salt){return createHash('sha256').update(`${gameId}:${round}:${choice}:${salt}`).digest('hex');}
export function lockChoice(game,result){
  if(game.pending)return game.pending.commitment;
  if(!['left','right'].includes(result.choice))throw new Error('对手返回了无效方向。');
  const salt=randomBytes(24).toString('hex');
  game.pending={choice:result.choice,salt,commitment:hashChoice(game.id,game.round,result.choice,salt),model:result.model,elapsedMs:result.elapsedMs,probability:result.probability??null};
  game.phase='ready';game.error=null;return game.pending.commitment;
}
export function decisionState(game){
  return {game:'Beat Jev',round:game.round+1,totalRounds:'endless',role:roleAt(game.round)==='evader'?'You are the catcher. Predict the human escape direction. Same direction wins you 100 points.':'You are the evader. Predict the human blocking direction, then escape in the opposite direction. Different directions win you 100 points.',rules:'Choose left or right before seeing the human current move. Exactly one participant earns 100 points per round. The scene is decorative; neither lane has a gameplay advantage. Only completed rounds are provided. The human can adapt to your previous choices. The role changes every five rounds and the game continues until the human stops.',history:game.history.slice(-40).map(row=>({round:row.round,humanRole:row.role,humanChoice:row.playerChoice,yourChoice:row.rivalChoice,humanWon:row.playerWon}))};
}
export function practiceDecision(game,random=()=>randomInt(10000)/10000){
  // A lightweight, noisy history-based opponent, always labelled LOCAL in the UI.
  const history=game.history.filter(row=>row.role===roleAt(game.round));
  const last=history.slice(-4);const left=(last.filter(r=>r.playerChoice==='left').length+1)/(last.length+2);
  const predict=random()<(left*.7+.15)?'left':'right';
  return {choice:roleAt(game.round)==='evader'?predict:predict==='left'?'right':'left',model:'本地习惯机器人',elapsedMs:0,probability:null};
}
export function playRound(game,{round,choice,commitment}){
  if(round!==game.round)throw new Error('回合已更新，请刷新页面。');
  if(!['left','right'].includes(choice))throw new Error('请选择左边或右边。');
  if(game.phase!=='ready'||!game.pending)throw new Error('对手还没有锁定选择，请稍候。');
  if(commitment!==game.pending.commitment)throw new Error('选择凭证已变化，请刷新页面。');
  const role=roleAt(game.round),pending=game.pending;
  const playerWon=role==='evader'?choice!==pending.choice:choice===pending.choice;
  if(playerWon){game.playerScore+=100;game.streak++;game.bestStreak=Math.max(game.bestStreak,game.streak);}else{game.rivalScore+=100;game.streak=0;}
  const result={round:game.round+1,scene:sceneAt(game.round).id,role,playerChoice:choice,rivalChoice:pending.choice,playerWon,playerScore:game.playerScore,rivalScore:game.rivalScore,model:pending.model,elapsedMs:pending.elapsedMs,probability:pending.probability,commitment:pending.commitment,salt:pending.salt};
  game.history.push(result);if(game.history.length>HISTORY_LIMIT)game.history.shift();game.round++;game.pending=null;game.error=null;game.phase='preparing';return result;
}
export function publicGame(game){return {id:game.id,mode:game.mode,round:game.round,totalRounds:null,role:roleAt(game.round),scene:sceneAt(game.round),scenes:SCENES.map(({id,name,en,color})=>({id,name,en,color})),phase:game.phase,error:game.error,playerScore:game.playerScore,rivalScore:game.rivalScore,streak:game.streak,bestStreak:game.bestStreak,commitment:game.pending?.commitment??null,history:game.history};}
