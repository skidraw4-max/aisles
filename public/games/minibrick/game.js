const COLS=10, ROWS=20, BLOCK=30;
const COLORS={I:'#22d3ee',O:'#facc15',T:'#c084fc',S:'#4ade80',Z:'#fb7185',J:'#60a5fa',L:'#fb923c'};
const SHAPES={I:[[0,1],[1,1],[2,1],[3,1]],O:[[1,0],[2,0],[1,1],[2,1]],T:[[1,0],[0,1],[1,1],[2,1]],S:[[1,0],[2,0],[0,1],[1,1]],Z:[[0,0],[1,0],[1,1],[2,1]],J:[[0,0],[0,1],[1,1],[2,1]],L:[[2,0],[0,1],[1,1],[2,1]]};
const TYPES=Object.keys(SHAPES);
const API_CONFIG=window.MINIBRICK_API_CONFIG||{enabled:false};
let canvas,ctx,nextCanvas,nextCtx,board,active,nextPiece,timer,last=0,running=false,paused=false,mode='normal',score=0,lines=0,level=1,currentStage=1,stageStartLines=0,stageTransitioning=false,stageClearTimer=null,playerId,profileName,pointerStart=null,playStartedAt=0,currentSessionId='';
let bgCanvas,bgCtx,bgBoard,bgActive,bgNext,bgRunning=false,bgLast=0,bgFrame=0,bgReduceMotion=false;
const AUDIO_SETTINGS_KEY='minibrickAudioSettings';
const AUDIO_MASTER_GAIN=1.8;
let audioCtx=null,musicTimer=null,musicStep=0,audioSettings={music:true,sfx:true},audioUnlockPromise=null,rankingRequestSeq=0,gameLoopId=0;
function safeUUID(){try{if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID()}catch(err){}return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16)})}
function stopGameLoop(){if(gameLoopId){cancelAnimationFrame(gameLoopId);gameLoopId=0}}
const dummy={normal:[['Nova',88200],['Mino',72100],['Blocker',65400],['Han',60000],['Kai',55200],['Tess',50100],['Blue',47000],['Jin',44000],['Luna',41000],['Zero',39000]],endless:[['Orbit',121300],['Stack',110400],['Yuri',100200],['Ace',95000],['Mia',88100],['Sol',82000],['Max',77000],['Rin',72000],['Eon',69000],['Pico',65000]]};
function $(id){return document.getElementById(id)}
function setPauseButton(isPaused){
  const btn=$('pauseBtn');
  if(!btn)return;
  btn.setAttribute('aria-label',isPaused?'계속하기':'일시정지');
  btn.innerHTML=`<span class="control-icon" aria-hidden="true">${isPaused?'▶':'⏸'}</span>`;
}
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');if(id==='screen-main')startMainBackground();else stopMainBackground();if(id!=='screen-game')stopMusic()}
function init(){canvas=$('board');ctx=canvas&&canvas.getContext('2d');nextCanvas=$('nextCanvas');nextCtx=nextCanvas&&nextCanvas.getContext('2d');if(!canvas||!ctx||!nextCanvas||!nextCtx){console.error('canvas init failed');return}setupMainBackground();playerId=localStorage.getItem('playerId')||safeUUID();localStorage.setItem('playerId',playerId);profileName=localStorage.getItem('profileName')||'Player';$('profileName').value=profileName;setupAudioSettings();bind();renderStageSelect();startMainBackground();renderRanking('normal')}
function bind(){
  $('saveProfileBtn').onclick=()=>{profileName=($('profileName').value||'Player').trim();localStorage.setItem('profileName',profileName);playSfx('button');renderRanking(mode)};
  const settingsGear=$('settingsGearBtn');
  if(settingsGear)settingsGear.onclick=()=>{playSfx('button');setSettingsPopupVisible(true)};
  const settingsClose=$('settingsCloseBtn');
  if(settingsClose)settingsClose.onclick=()=>{playSfx('button');setSettingsPopupVisible(false)};
  const settingsPopup=$('settingsPopup');
  if(settingsPopup)settingsPopup.addEventListener('click',e=>{if(e.target&&e.target.dataset&&e.target.dataset.settingsClose){playSfx('button');setSettingsPopupVisible(false)}});
  const musicToggle=$('musicToggleBtn');
  if(musicToggle)musicToggle.onclick=()=>toggleAudioSetting('music');
  const sfxToggle=$('sfxToggleBtn');
  if(sfxToggle)sfxToggle.onclick=()=>toggleAudioSetting('sfx');
  $('normalBtn').onclick=()=>{renderStageSelect();setStageSelectVisible(true)};
  $('endlessBtn').onclick=()=>start('endless');
  const closeStageBtn=$('stageSelectCloseBtn');
  if(closeStageBtn)closeStageBtn.onclick=()=>{playSfx('button');setStageSelectVisible(false)};
  const stageSelectPanel=$('stageSelectPanel');
  if(stageSelectPanel)stageSelectPanel.addEventListener('click',e=>{if(e.target&&e.target.dataset&&e.target.dataset.stageSelectClose){playSfx('button');setStageSelectVisible(false)}});
  const clearHomeBtn=$('stageClearHomeBtn');
  if(clearHomeBtn)clearHomeBtn.onclick=goHomeFromStageClear;
  const clearNextBtn=$('stageClearNextBtn');
  if(clearNextBtn)clearNextBtn.onclick=advanceToNextStage;
  document.querySelectorAll('.rank-tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.rank-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderRanking(b.dataset.mode)});
  $('leftBtn').onclick=()=>move(-1); $('rightBtn').onclick=()=>move(1); $('rotateBtn').onclick=rotate; $('downBtn').onclick=()=>softDrop(); $('dropBtn').onclick=hardDrop;
  $('pauseBtn').onclick=()=>{if(stageTransitioning)return;paused=!paused;setPauseButton(paused);playSfx('button');paused?stopMusic():startMusic()};
  $('retryBtn').onclick=()=>start(mode,mode==='normal'?currentStage:1);
  $('homeBtn').onclick=()=>{playSfx('button');running=false;stopGameLoop();stopMusic();show('screen-main');renderRanking(mode);renderStageSelect()};
  setupBoardPointerControls();
  setupAudioUnlock();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('settingsPopup')&&$('settingsPopup').classList.contains('show')){setSettingsPopupVisible(false);return;}if(e.key==='Escape'&&$('stageSelectPanel')&&$('stageSelectPanel').classList.contains('show')){setStageSelectVisible(false);return;}if(!running||stageTransitioning)return; if(e.key==='ArrowLeft')move(-1); if(e.key==='ArrowRight')move(1); if(e.key==='ArrowUp')rotate(); if(e.key==='ArrowDown')softDrop(); if(e.code==='Space')hardDrop()});
  if(window.matchMedia){const media=window.matchMedia('(prefers-reduced-motion: reduce)');media.addEventListener&&media.addEventListener('change',e=>{bgReduceMotion=e.matches;e.matches?stopMainBackground():startMainBackground()})}
}

function setSettingsPopupVisible(visible){
  const popup=$('settingsPopup'),gear=$('settingsGearBtn');
  if(!popup)return;
  popup.classList.toggle('show',Boolean(visible));
  popup.setAttribute('aria-hidden',visible?'false':'true');
  if(gear)gear.setAttribute('aria-expanded',visible?'true':'false');
  document.body.classList.toggle('settings-open',Boolean(visible));
}
function loadAudioSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY)||'{}');
    audioSettings={music:saved.music!==false,sfx:saved.sfx!==false};
  }catch(err){
    audioSettings={music:true,sfx:true};
  }
}
function saveAudioSettings(){localStorage.setItem(AUDIO_SETTINGS_KEY,JSON.stringify(audioSettings))}
function setupAudioSettings(){loadAudioSettings();renderAudioSettings()}
function renderAudioSettings(){
  const musicBtn=$('musicToggleBtn'),sfxBtn=$('sfxToggleBtn'),status=$('audioStatus');
  const sync=(btn,on)=>{if(!btn)return;btn.classList.toggle('is-off',!on);btn.setAttribute('aria-pressed',on?'true':'false');const label=btn.querySelector('span');if(label)label.textContent=on?'ON':'OFF'};
  sync(musicBtn,audioSettings.music);
  sync(sfxBtn,audioSettings.sfx);
  if(status)status.textContent=`음악 ${audioSettings.music?'ON':'OFF'} · 효과음 ${audioSettings.sfx?'ON':'OFF'}`;
}
function toggleAudioSetting(kind){
  ensureAudio();
  audioSettings[kind]=!audioSettings[kind];
  saveAudioSettings();
  renderAudioSettings();
  if(kind==='music')audioSettings.music?startMusic():stopMusic();
  if(kind==='sfx'&&audioSettings.sfx)playSfx('toggle',true);
  if(kind==='music')playSfx('toggle');
}
function ensureAudio(){
  if(!window.AudioContext&&!window.webkitAudioContext)return null;
  if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  return audioCtx;
}
function unlockAudio(){
  const ac=ensureAudio();
  if(!ac)return Promise.resolve(null);
  if(ac.state==='running')return Promise.resolve(ac);
  if(!audioUnlockPromise){
    audioUnlockPromise=ac.resume().catch(()=>null).then(()=>{
      if(ac.state==='running'){
        try{
          const osc=ac.createOscillator(),amp=ac.createGain();
          amp.gain.setValueAtTime(0.0001,ac.currentTime);
          osc.connect(amp).connect(ac.destination);
          osc.start();
          osc.stop(ac.currentTime+0.01);
        }catch(err){}
      }
      return ac;
    }).finally(()=>{audioUnlockPromise=null});
  }
  return audioUnlockPromise;
}
function setupAudioUnlock(){
  const unlock=()=>unlockAudio();
  ['pointerdown','touchstart','keydown'].forEach(type=>document.addEventListener(type,unlock,{capture:true,once:true,passive:true}));
}
function playTone(freq,duration=0.08,type='sine',gain=0.045,delay=0){
  try{
    const ac=ensureAudio();
    if(!ac)return;
    if(ac.state==='suspended'){unlockAudio().then(unlocked=>{if(unlocked&&unlocked.state==='running')playTone(freq,duration,type,gain,delay)});return;}
    const osc=ac.createOscillator(),amp=ac.createGain();
    const now=ac.currentTime+delay;
    osc.type=type;
    osc.frequency.setValueAtTime(freq,now);
    amp.gain.setValueAtTime(0.0001,now);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002,Math.min(0.12,gain*AUDIO_MASTER_GAIN)),now+0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001,now+duration);
    osc.connect(amp).connect(ac.destination);
    osc.start(now);
    osc.stop(now+duration+0.025);
  }catch(err){}
}
function playSfx(name,force=false){
  if(!force&&!audioSettings.sfx)return;
  switch(name){
    case 'button': playTone(520,.055,'triangle',.025); break;
    case 'toggle': playTone(660,.06,'triangle',.03); playTone(990,.07,'sine',.022,.035); break;
    case 'start': playTone(392,.08,'triangle',.035); playTone(587,.10,'triangle',.03,.07); playTone(784,.12,'sine',.028,.14); break;
    case 'move': playTone(210,.045,'square',.018); break;
    case 'rotate': playTone(420,.055,'triangle',.024); playTone(630,.05,'triangle',.018,.035); break;
    case 'soft': playTone(160,.04,'sine',.014); break;
    case 'drop': playTone(130,.09,'sawtooth',.026); playTone(90,.08,'sine',.018,.055); break;
    case 'lock': playTone(95,.055,'triangle',.02); break;
    case 'line': playTone(523,.07,'triangle',.032); playTone(659,.08,'triangle',.026,.055); break;
    case 'tetris': [523,659,784,1046].forEach((f,i)=>playTone(f,.075,'triangle',.032,i*.045)); break;
    case 'stageclear': [523,659,784,1046,1318].forEach((f,i)=>playTone(f,.12,'triangle',.04,i*.07)); break;
    case 'gameover': [330,247,196,147].forEach((f,i)=>playTone(f,.14,'sawtooth',.03,i*.09)); break;
  }
}
function startMusic(){
  if(!audioSettings.music||!running||paused||musicTimer)return;
  unlockAudio().then(()=>scheduleMusic());
}
function stopMusic(){
  if(musicTimer){clearTimeout(musicTimer);musicTimer=null;}
}
function scheduleMusic(){
  if(!audioSettings.music||!running||paused){musicTimer=null;return;}
  const melody=[392,494,587,494,440,554,659,554,392,523,659,784,659,587,494,440];
  const bass=[98,123.47,146.83,123.47];
  const note=melody[musicStep%melody.length];
  const base=bass[Math.floor(musicStep/4)%bass.length];
  playTone(note,.18,'triangle',.018);
  if(musicStep%4===0)playTone(base,.28,'sine',.014);
  musicStep++;
  musicTimer=setTimeout(scheduleMusic,360);
}

function setupBoardPointerControls(){
  if(!canvas)return;
  canvas.addEventListener('pointerdown',e=>{
    if(!running||paused||stageTransitioning)return;
    e.preventDefault();
    pointerStart={x:e.clientX,y:e.clientY,t:Date.now()};
    if(canvas.setPointerCapture)canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup',e=>{
    if(!running||paused||!pointerStart)return;
    e.preventDefault();
    const start=pointerStart;
    pointerStart=null;
    const dx=e.clientX-start.x, dy=e.clientY-start.y;
    const rect=canvas.getBoundingClientRect();
    if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)){move(dx<0?-1:1);return;}
    if(dy>55&&Math.abs(dy)>Math.abs(dx)){dy>140?hardDrop():softDrop();return;}
    const zone=(e.clientX-rect.left)/rect.width;
    if(zone<0.33)move(-1);else if(zone>0.67)move(1);else rotate();
  });
  canvas.addEventListener('pointercancel',()=>{pointerStart=null});
}
function emptyBoard(){return Array.from({length:ROWS},()=>Array(COLS).fill(null))}
function getMaxUnlockedStage(){return Math.max(1,Number(localStorage.getItem('minibrickMaxUnlockedStage')||'1')||1)}
function unlockStage(stage){const next=Math.max(getMaxUnlockedStage(),Number(stage)||1);localStorage.setItem('minibrickMaxUnlockedStage',String(next));renderStageSelect()}
function setStageSelectVisible(visible){const panel=$('stageSelectPanel');if(!panel)return;panel.classList.toggle('show',Boolean(visible));panel.setAttribute('aria-hidden',visible?'false':'true');document.body.classList.toggle('stage-select-open',Boolean(visible))}
function renderStageSelect(){const grid=$('stageSelectGrid');if(!grid)return;const max=getMaxUnlockedStage();const hint=$('stageSelectHint');if(hint)hint.textContent=`현재 STAGE ${max}까지 열렸습니다. 높은 스테이지부터 선택할 수 있습니다.`;grid.innerHTML=Array.from({length:max},(_,i)=>{const stage=max-i;const goal=stageLineGoal(stage);const profile=stageDifficultyProfile(stage);return `<button class="stage-choice" data-stage="${stage}" aria-label="스테이지 ${stage} 시작"><strong>STAGE ${stage}</strong><span>${goal} Lines · 장애물 ${profile.obstacleRows}행</span></button>`}).join('');grid.querySelectorAll('.stage-choice').forEach(btn=>btn.onclick=()=>{const stage=Number(btn.dataset.stage)||1;playSfx('button');setStageSelectVisible(false);start('normal',stage)})}
function randomPiece(){const t=TYPES[Math.floor(Math.random()*TYPES.length)];return{type:t,cells:SHAPES[t].map(p=>[p[0],p[1]]),x:3,y:0}}
function start(m,stage=1){
  try{
    stopGameLoop();
    stopMusic();
    ensureAudio();
    mode=m;
    score=0;
    lines=0;
    currentStage=mode==='normal'?Math.max(1,Number(stage)||1):1;
    level=mode==='normal'?currentStage:1;
    stageStartLines=0;
    stageTransitioning=false;
    if(stageClearTimer)clearTimeout(stageClearTimer);
    stageClearTimer=null;
    setStageClearOverlay(false);
    running=true;
    paused=false;
    last=0;
    playStartedAt=Date.now();
    currentSessionId=`${playerId}_${playStartedAt}_${safeUUID()}`;
    board=emptyBoard();
    if(mode==='normal')applyStageObstacles(currentStage);
    active=randomPiece();
    nextPiece=randomPiece();
    const hudMode=$('hudMode');
    if(hudMode)hudMode.textContent=mode==='normal'?'일반':'무한';
    setPauseButton(false);
    show('screen-game');
    updateHud();
    requestAnimationFrame(()=>{
      if(!running)return;
      try{draw()}catch(err){console.warn('draw failed',err)}
      playSfx('start');
      startMusic();
      last=0;
      gameLoopId=requestAnimationFrame(loop);
    });
  }catch(err){
    console.error('start failed',err);
    running=false;
    stopGameLoop();
    show('screen-main');
  }
}
function loop(t){
  if(!running){gameLoopId=0;return}
  gameLoopId=requestAnimationFrame(loop);
  if(!last)last=t;
  const interval=Math.max(120,800-(level-1)*55);
  if(!paused&&!stageTransitioning&&t-last>interval){tick();last=t}
  try{draw()}catch(err){console.warn('draw failed',err)}
}
function valid(piece,dx=0,dy=0,cells=piece.cells){return cells.every(([cx,cy])=>{const x=piece.x+cx+dx,y=piece.y+cy+dy;return x>=0&&x<COLS&&y<ROWS&&(y<0||!board[y][x])})}
function move(dx){if(!running||paused||stageTransitioning)return;if(valid(active,dx,0)){active.x+=dx;playSfx('move');draw()}}
function rotate(){if(!running||paused||stageTransitioning)return; if(active.type==='O')return; const rotated=active.cells.map(([x,y])=>[2-y,x]); const kicks=[0,-1,1,-2,2]; for(const k of kicks){if(valid(active,k,0,rotated)){active.x+=k;active.cells=rotated;playSfx('rotate');draw();return}}}
function softDrop(){if(!running||paused||stageTransitioning)return;if(valid(active,0,1)){active.y++;score+=1;playSfx('soft')}else lock()}
function hardDrop(){if(!running||paused||stageTransitioning)return;let d=0;while(valid(active,0,1)){active.y++;d++}score+=d*2;playSfx('drop');lock()}
function tick(){if(valid(active,0,1))active.y++;else lock()}
function lock(){active.cells.forEach(([cx,cy])=>{const x=active.x+cx,y=active.y+cy;if(y>=0&&y<ROWS)board[y][x]=active.type});playSfx('lock');clearLines();if(stageTransitioning){updateHud();return}active=nextPiece;nextPiece=randomPiece();if(!valid(active)){endGame()}updateHud()}
function clearLines(){let removed=0;for(let y=ROWS-1;y>=0;y--){if(board[y].every(Boolean)){board.splice(y,1);board.unshift(Array(COLS).fill(null));removed++;y++}}if(removed){lines+=removed;score += [0,100,300,500,800][removed]*level;playSfx(removed>=4?'tetris':'line');if(mode==='endless'){level=Math.floor(lines/8)+1}else{level=currentStage;if(stageProgress()>=stageLineGoal(currentStage))beginStageClearTransition()}}}
function stageLineGoal(stage){return Math.min(20,10+Math.max(0,stage-1)*2)}
function stageProgress(){return Math.max(0,lines-stageStartLines)}
function stageDifficultyProfile(stage){return{stage,lineGoal:stageLineGoal(stage),fallLevel:stage,obstacleRows:stage<=1?0:Math.min(8,Math.floor((stage+1)/2)),holeCount:stage<=1?0:Math.max(1,4-Math.floor(stage/3)),stagger:Math.min(4,Math.floor(stage/2))}}
function applyStageObstacles(stage){const profile=stageDifficultyProfile(stage);if(!profile.obstacleRows)return;const startRow=ROWS-profile.obstacleRows;for(let y=startRow;y<ROWS;y++){const rowIndex=y-startRow;const holes=new Set();for(let h=0;h<profile.holeCount;h++){holes.add((stage*3+rowIndex*2+h*(2+profile.stagger))%COLS)}for(let x=0;x<COLS;x++){if(!holes.has(x))board[y][x]=TYPES[(stage+x*2+y*3)%TYPES.length]}}}
function setStageClearOverlay(visible,nextStage=currentStage){const overlay=$('stageClearOverlay');if(!overlay)return;overlay.classList.toggle('show',Boolean(visible));overlay.setAttribute('aria-hidden',visible?'false':'true');const label=$('stageClearNext');if(label)label.textContent=visible?`NEXT · STAGE ${nextStage}`:''}
function beginStageClearTransition(){if(stageTransitioning)return;const clearedStage=currentStage;stageTransitioning=true;paused=false;stopMusic();playSfx('stageclear');score+=Math.max(1,clearedStage)*500;currentStage=clearedStage+1;level=currentStage;unlockStage(currentStage);setPauseButton(false);setStageClearOverlay(true,currentStage);updateHud();draw()}
function advanceToNextStage(){if(!stageTransitioning)return;playSfx('start');stageStartLines=lines;board=emptyBoard();applyStageObstacles(currentStage);active=randomPiece();nextPiece=randomPiece();stageTransitioning=false;paused=false;last=0;setStageClearOverlay(false);setPauseButton(false);updateHud();draw();startMusic()}
function goHomeFromStageClear(){playSfx('button');if(stageClearTimer)clearTimeout(stageClearTimer);stageClearTimer=null;stageTransitioning=false;running=false;paused=false;stopGameLoop();stopMusic();setStageClearOverlay(false);setPauseButton(false);show('screen-main');renderStageSelect();renderRanking(mode)}
function updateHud(){$('hudScore').textContent=score;$('hudLines').textContent=lines;$('hudLevel').textContent=level;const goal=$('goalText');if(goal)goal.textContent=mode==='normal'?`STAGE ${currentStage} · ${stageProgress()}/${stageLineGoal(currentStage)} Lines`:'Survive'}
function drawCell(c,x,y,s=BLOCK){const g=ctx.createLinearGradient(x*s,y*s,(x+1)*s,(y+1)*s);g.addColorStop(0,'rgba(255,255,255,.22)');g.addColorStop(1,COLORS[c]);ctx.fillStyle=g;ctx.fillRect(x*s+1,y*s+1,s-2,s-2);ctx.strokeStyle='rgba(15,23,42,.38)';ctx.strokeRect(x*s+1,y*s+1,s-2,s-2)}
function draw(){if(!ctx||!canvas)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#020617';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='rgba(148,163,184,.14)';for(let x=0;x<=COLS;x++){ctx.beginPath();ctx.moveTo(x*BLOCK,0);ctx.lineTo(x*BLOCK,ROWS*BLOCK);ctx.stroke()}for(let y=0;y<=ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*BLOCK);ctx.lineTo(COLS*BLOCK,y*BLOCK);ctx.stroke()}board.forEach((r,y)=>r.forEach((c,x)=>c&&drawCell(c,x,y))); if(active)active.cells.forEach(([cx,cy])=>drawCell(active.type,active.x+cx,active.y+cy)); drawNext()}
function drawNext(){if(!nextCtx||!nextCanvas)return;nextCtx.clearRect(0,0,96,96);if(!nextPiece)return;nextPiece.cells.forEach(([x,y])=>{nextCtx.fillStyle=COLORS[nextPiece.type];nextCtx.fillRect(x*20+16,y*20+16,18,18)})}
function recordScoreLocal(){const key='scores_'+mode;const arr=JSON.parse(localStorage.getItem(key)||'[]');arr.push({playerId,profileName,score,lines,level,at:new Date().toISOString()});localStorage.setItem(key,JSON.stringify(arr));return getMyRank(mode)}
function getLocalBest(m){const arr=JSON.parse(localStorage.getItem('scores_'+m)||'[]');const best={};arr.forEach(r=>{if(!best[r.playerId]||r.score>best[r.playerId].score)best[r.playerId]=r});return Object.values(best)}
function rankingData(m){return dummy[m].map(([profileName,score],i)=>({playerId:'dummy'+i,profileName,score,rank:i+1})).concat(getLocalBest(m)).sort((a,b)=>b.score-a.score).map((r,i)=>({...r,rank:i+1}))}
function getMyRank(m){return rankingData(m).findIndex(r=>r.playerId===playerId)+1||'-'}
function apiEnabled(){return Boolean(API_CONFIG.enabled&&API_CONFIG.endpoint)}
function withTimeout(promise,timeoutMs=8000){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),timeoutMs))])}
async function fetchRemoteRanking(m){
  if(!apiEnabled())return null;
  const url=new URL(API_CONFIG.endpoint);
  url.searchParams.set('mode',m);
  url.searchParams.set('playerId',playerId);
  const res=await withTimeout(fetch(url.toString(),{method:'GET',cache:'no-store'}),API_CONFIG.timeoutMs||8000);
  const json=await res.json();
  if(!json.ok)throw new Error(json.error||'ranking_fetch_failed');
  return json.ranking||null;
}
async function submitRemoteScore(){
  if(!apiEnabled()||!API_CONFIG.token)return null;
  const payload={token:API_CONFIG.token,playerId,profileName,mode,score,stage:mode==='normal'?currentStage:0,level,lines,playTimeSec:Math.max(0,Math.round((Date.now()-playStartedAt)/1000)),appVersion:API_CONFIG.appVersion||'webpreview-mvp',playSessionId:currentSessionId};
  const res=await withTimeout(fetch(API_CONFIG.endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),cache:'no-store'}),API_CONFIG.timeoutMs||8000);
  const json=await res.json();
  if(!json.ok)throw new Error(json.error||'score_submit_failed');
  return json.ranking||null;
}
function setRankingLoading(isLoading){const panel=$('rankingList')&&$('rankingList').closest('.ranking-panel');if(panel)panel.classList.toggle('is-loading',Boolean(isLoading))}
function renderRankingRows(rows){setRankingLoading(false);$('rankingList').innerHTML=rows.slice(0,10).map((r,i)=>`<li><strong>${r.rank||i+1}. ${escapeHtml(r.profileName||'Player')}</strong> <span>${Number(r.score||0).toLocaleString()}점</span></li>`).join('')||'<li><strong>기록 없음</strong> <span>첫 기록에 도전하세요</span></li>'}
function renderMyRankFromLocal(m) {const mine=rankingData(m).find(r=>r.playerId===playerId);$('myRank').textContent=mine?`내 순위: ${getMyRank(m)}위 · ${Number(mine.score||0).toLocaleString()}점`:'내 순위: 아직 기록 없음'}
function renderMyRankFromRemote(ranking) {const me=ranking&&ranking.me;const total=ranking&&Number.isFinite(ranking.totalPlayers)?ranking.totalPlayers:0;$('myRank').textContent=me?`내 순위: ${me.rank}위 · ${Number(me.score||0).toLocaleString()}점`:`내 순위: 아직 기록 없음 · 총 ${total}명`}
function renderRankingLoading(){setRankingLoading(true);$('rankingList').innerHTML=Array.from({length:10},()=>'<li class="ranking-placeholder"><strong>&nbsp;</strong><span>&nbsp;</span></li>').join('');$('myRank').textContent='내 순위: 순위표 동기화 중'}
async function renderRanking(m){
  const requestId=++rankingRequestSeq;
  if(!apiEnabled()){
    renderRankingRows(rankingData(m));
    renderMyRankFromLocal(m);
    return;
  }
  renderRankingLoading();
  try{
    const remote=await fetchRemoteRanking(m);
    if(requestId!==rankingRequestSeq)return;
    if(remote&&remote.top10&&remote.top10.length){renderRankingRows(remote.top10);renderMyRankFromRemote(remote)}
    else {renderRankingRows([]);renderMyRankFromRemote(remote)}
  }catch(err){
    if(requestId!==rankingRequestSeq)return;
    console.warn('ranking api failed',err);
    renderRankingRows(rankingData(m));
    renderMyRankFromLocal(m);
  }
}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
async function endGame(cleared=false){
  if(!running)return;
  playSfx('gameover');
  stopMusic();
  stopGameLoop();
  running=false;
  const localRank=recordScoreLocal();
  $('resultTitle').textContent=cleared?'스테이지 클리어':'게임 종료';
  $('resultScore').textContent=score.toLocaleString();
  $('resultLines').textContent=lines;
  $('resultLevel').textContent=level;
  $('resultRank').textContent=localRank==='-'?'-':localRank+'위';
  $('resultMessage').textContent=apiEnabled()?'기록을 로컬에 저장했으며, 순위표에 동기화 중입니다.':'기록이 로컬에 저장되었습니다. 순위표에서 일반모드와 무한모드 기록을 분리해 확인할 수 있습니다.';
  show('screen-result');
  if(apiEnabled()){
    try{
      const remote=await submitRemoteScore();
      if(remote&&remote.me){$('resultRank').textContent=remote.me.rank+'위';$('resultMessage').textContent='순위표에 기록이 저장되었습니다. 메인 순위표에서 최신 기록을 확인할 수 있습니다.';}
      else {$('resultMessage').textContent='순위표에 기록이 저장되었지만 내 순위 정보가 비어 있습니다. 메인 순위표를 새로 확인해 주세요.';}
    }catch(err){
      console.warn('score api failed',err);
      $('resultMessage').textContent='순위표 동기화에 실패해 로컬 기록으로 저장했습니다. 네트워크 연결을 확인해 주세요.';
    }
  }
}
function setupMainBackground(){
  bgCanvas=$('mainBgCanvas');
  if(!bgCanvas)return;
  bgCtx=bgCanvas.getContext('2d');
  bgReduceMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  bgBoard=createBackgroundBoard();
  bgActive=randomBackgroundPiece();
  bgNext=randomBackgroundPiece();
  drawMainBackground();
}
function createBackgroundBoard(){
  const demo=emptyBoard();
  const seed=['I','O','T','S','Z','J','L'];
  for(let y=12;y<ROWS;y++){
    for(let x=0;x<COLS;x++){
      if(Math.random()<0.46+(y-12)*0.035)demo[y][x]=seed[(x+y)%seed.length];
    }
  }
  return demo;
}
function randomBackgroundPiece(){
  const p=randomPiece();
  p.x=2+Math.floor(Math.random()*4);
  p.y=-1;
  return p;
}
function startMainBackground(){
  if(!bgCanvas||bgReduceMotion||bgRunning)return;
  bgRunning=true;
  bgLast=0;
  requestAnimationFrame(mainBackgroundLoop);
}
function stopMainBackground(){bgRunning=false}
function mainBackgroundLoop(t){
  if(!bgRunning)return;
  if(!bgLast)bgLast=t;
  if(t-bgLast>420){stepMainBackground();bgLast=t}
  if(++bgFrame%3===0)drawMainBackground();
  requestAnimationFrame(mainBackgroundLoop);
}
function stepMainBackground(){
  if(!bgActive)return;
  const sway=Math.random();
  if(sway<.28&&validBackground(bgActive,-1,0))bgActive.x--;
  else if(sway>.72&&validBackground(bgActive,1,0))bgActive.x++;
  if(Math.random()<.18)rotateBackgroundPiece();
  if(validBackground(bgActive,0,1))bgActive.y++;
  else lockBackgroundPiece();
}
function validBackground(piece,dx=0,dy=0,cells=piece.cells){
  return cells.every(([cx,cy])=>{const x=piece.x+cx+dx,y=piece.y+cy+dy;return x>=0&&x<COLS&&y<ROWS&&(y<0||!bgBoard[y][x])})
}
function rotateBackgroundPiece(){
  if(!bgActive||bgActive.type==='O')return;
  const rotated=bgActive.cells.map(([x,y])=>[2-y,x]);
  for(const k of [0,-1,1]){if(validBackground(bgActive,k,0,rotated)){bgActive.x+=k;bgActive.cells=rotated;return}}
}
function lockBackgroundPiece(){
  bgActive.cells.forEach(([cx,cy])=>{const x=bgActive.x+cx,y=bgActive.y+cy;if(y>=0&&y<ROWS)bgBoard[y][x]=bgActive.type});
  for(let y=ROWS-1;y>=0;y--){if(bgBoard[y].every(Boolean)){bgBoard.splice(y,1);bgBoard.unshift(Array(COLS).fill(null));y++}}
  if(bgBoard[2].some(Boolean))bgBoard=createBackgroundBoard();
  bgActive=bgNext;
  bgNext=randomBackgroundPiece();
}
function drawMainBackground(){
  if(!bgCtx)return;
  const s=BLOCK;
  bgCtx.clearRect(0,0,bgCanvas.width,bgCanvas.height);
  bgCtx.fillStyle='rgba(2,6,23,.95)';
  bgCtx.fillRect(0,0,bgCanvas.width,bgCanvas.height);
  bgCtx.strokeStyle='rgba(147,197,253,.12)';
  for(let x=0;x<=COLS;x++){bgCtx.beginPath();bgCtx.moveTo(x*s,0);bgCtx.lineTo(x*s,ROWS*s);bgCtx.stroke()}
  for(let y=0;y<=ROWS;y++){bgCtx.beginPath();bgCtx.moveTo(0,y*s);bgCtx.lineTo(COLS*s,y*s);bgCtx.stroke()}
  bgBoard.forEach((r,y)=>r.forEach((c,x)=>c&&drawBackgroundCell(c,x,y,s)));
  if(bgActive)bgActive.cells.forEach(([cx,cy])=>drawBackgroundCell(bgActive.type,bgActive.x+cx,bgActive.y+cy,s,true));
}
function drawBackgroundCell(c,x,y,s,activeGlow=false){
  if(y<0)return;
  const px=x*s,py=y*s;
  const g=bgCtx.createLinearGradient(px,py,px+s,py+s);
  g.addColorStop(0,'rgba(255,255,255,.34)');
  g.addColorStop(1,COLORS[c]);
  bgCtx.fillStyle=g;
  bgCtx.fillRect(px+1,py+1,s-2,s-2);
  bgCtx.strokeStyle=activeGlow?'rgba(255,255,255,.42)':'rgba(15,23,42,.34)';
  bgCtx.strokeRect(px+1,py+1,s-2,s-2);
}
window.addEventListener('load',init);
