/* 정보처리기사 필기 기출 트레이너
   데이터: window.EXAMS / EXAM_EXPL / EXAM_META  (data/*.js)
   저장:  localStorage 'jbg-exam-v1' — 접근이 막힌 환경에서는 메모리로만 동작합니다. */
(function(){
"use strict";

/* ── 저장소 ── 사파리 프라이빗 모드 등에서 localStorage 접근이 예외를 던지므로 감쌉니다. */
var KEY='jbg-exam-v1', mem=null;
function load(){
  if(mem) return mem;
  try{ var s=localStorage.getItem(KEY); mem = s? JSON.parse(s):{}; }
  catch(e){ mem={}; }
  if(!mem.hist) mem.hist={};
  if(!mem.opt)  mem.opt={shuffle:true,uniq:true,instant:true,count:20};
  if(!mem.runs) mem.runs=[];
  return mem;
}
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(mem)); }catch(e){} }
var ST=load();

/* ── 데이터 인덱스 ── */
var META=window.EXAM_META, EXPL=window.EXAM_EXPL;
var ALL=[];  EXAM_LIST.forEach(function(sid){ ALL=ALL.concat(EXAMS[sid]); });
/* uid별 대표 문항 하나 = 고유 문항. 가장 최근 회차본을 대표로 씁니다. */
var UNIQ=(function(){
  var m={}; ALL.forEach(function(q){ if(!m[q.u] || q.src>m[q.u].src) m[q.u]=q; });
  return Object.keys(m).map(function(k){ return m[k]; });
})();
var SUBJ=META.subjects, TYPES=META.types;

/* last: 'o' 확신 정답 · 'g' 찍어 맞힘 · 'u' 모르겠음 · 'w' 오답 */
function hist(u){ var h=ST.hist[u]; if(!h) h=ST.hist[u]={n:0,w:0};
  if(h.lucky==null) h.lucky=0; if(h.unsure==null) h.unsure=0; return h; }
function seen(u){ var h=ST.hist[u]; return h && h.n>0; }
/* 다시 볼 문항 = 틀렸거나, 찍어서 맞혔거나, 모르겠다고 한 문항 */
function reviewNow(u){ var h=ST.hist[u]; return !!h && (h.last==='w'||h.last==='g'||h.last==='u'); }

/* ── 유틸 ── */
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function shuffle(a){ for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i];a[i]=a[j];a[j]=t; } return a; }
function isMono(t){ return /\n/.test(t) || /[{};]\s|#include|System\.out|printf|SELECT\s|→/.test(t); }
function pct(a,b){ return b? Math.round(a/b*100):0; }
function lvl(p){ return p>=80?'hi':p>=60?'mid':'low'; }
function fmt(s){ var h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60;
  var mm=(m<10?'0':'')+m, ss=(x<10?'0':'')+x;
  return h>0 ? h+':'+mm+':'+ss : mm+':'+ss; }

/* ── 화면 상태 ── */
var V={}, S=null, tick=null;
function app(h){ document.getElementById('app').innerHTML=h; }
function foot(h){ document.getElementById('foot').innerHTML=h||''; }
function on(id,fn){ var e=document.getElementById(id); if(e) e.onclick=fn; }

/* ══════════ 홈 ══════════ */
var pick={subj:null, exam:null, type:null};

V.home=function(){
  if(tick){ clearInterval(tick); tick=null; }
  var done=0, solid=0, tries=0, review=0;
  Object.keys(ST.hist).forEach(function(u){
    var h=ST.hist[u];
    if(h.n>0){ done++; tries+=h.n; solid+=(h.n-h.w-(h.lucky||0)-(h.unsure||0)); }
    if(h.last==='w'||h.last==='g'||h.last==='u') review++;
  });
  var o=ST.opt;
  var h=[];
  h.push('<div class="card"><h2>진도<span>고유 '+META.unique+'문항 · 전체 '+META.total+'문항</span></h2>'+
    '<div class="stats4">'+
    '<div class="s4"><b>'+done+'</b><small>푼 문항</small></div>'+
    '<div class="s4"><b>'+pct(done,META.unique)+'%</b><small>진도율</small></div>'+
    '<div class="s4"><b>'+pct(solid,tries)+'%</b><small>확신 정답률</small></div>'+
    '<div class="s4"><b>'+review+'</b><small>다시 볼 문항</small></div>'+
    '</div></div>');

  h.push('<div class="card"><h2>학습 방식</h2><div class="modes">'+
    mode('m-all','d-blue','전체 랜덤','13개 회차 전 범위에서 무작위로 출제합니다.')+
    mode('m-subj','d-teal','과목별 랜덤','설계·개발·DB·언어·구축관리 중 골라서 집중합니다.')+
    mode('m-exam','d-amber','회차별','한 회차를 1번부터 순서대로 풉니다.')+
    mode('m-type','d-mag','유형별','계산·코드·틀린문장찾기 등 문제 유형으로 골라 풉니다.')+
    mode('m-mock','d-ink','회차 모의고사','100문항 150분. 과목별 40점 과락까지 판정합니다.')+
    mode('m-wrong','d-mag','다시 볼 문항','틀린 것 + 찍어서 맞힌 것 + 모르겠다고 한 것. ('+review+'문항)', review===0)+
    mode('m-rep','d-teal','반복 출제 우선','여러 회차에 되풀이 나온 문항부터 풉니다.')+
    mode('m-new','d-blue','안 푼 문항','아직 한 번도 안 본 문항만 골라 풉니다.', done>=META.unique)+
    '</div></div>');

  h.push('<div class="card"><h2>설정</h2>'+
    optRow('문항 수','한 회에 몇 문항씩 풀지','<select id="o-count">'+
      [10,20,30,50,100].map(function(n){ return '<option value="'+n+'"'+(o.count===n?' selected':'')+'>'+n+'문항</option>'; }).join('')+'</select>')+
    optRow('보기 순서 섞기','외운 위치가 아니라 내용으로 판단하게 합니다','<button class="sw'+(o.shuffle?' on':'')+'" id="o-shuffle"><i></i></button>')+
    optRow('중복 문항 제외','같은 문항이 여러 회차에 나와도 한 번만 출제합니다','<button class="sw'+(o.uniq?' on':'')+'" id="o-uniq"><i></i></button>')+
    optRow('즉시 채점','고르는 즉시 정답과 해설을 보여줍니다','<button class="sw'+(o.instant?' on':'')+'" id="o-instant"><i></i></button>')+
    '</div>');

  h.push('<div class="card"><h2>기록</h2><div class="row spread">'+
    '<button class="btn btn-ghost btn-sm" id="go-stats">통계 보기</button>'+
    '<div class="row"><button class="btn btn-ghost btn-sm" id="do-export">내보내기</button>'+
    '<button class="btn btn-mag btn-sm" id="do-reset">기록 초기화</button></div></div></div>');
  app(h.join(''));
  foot('출처 · 2022년 1회 ~ 2026년 1회 필기 기출 '+META.total+'문항 (중복 제거 '+META.unique+'문항)<br>'+
       '자료 신뢰도 · 시나공(길벗) 배포본 기준. Q-Net 공식 공개본 여부는 확인되지 않음');

  on('m-all',function(){ start(poolAll(),'전체 랜덤',{shuffleQ:true}); });
  on('m-subj',V.pickSubj); on('m-exam',V.pickExam); on('m-type',V.pickType); on('m-mock',V.pickMock);
  on('m-wrong',function(){
    var p=poolAll().filter(function(q){ return reviewNow(q.u); });
    start(p,'다시 볼 문항',{shuffleQ:true,count:p.length});
  });
  on('m-rep',function(){
    var p=poolAll().filter(function(q){ return q.rep>=2; })
      .sort(function(a,b){ return b.rep-a.rep; });
    start(p,'반복 출제 우선',{shuffleQ:false});
  });
  on('m-new',function(){
    start(poolAll().filter(function(q){ return !seen(q.u); }),'안 푼 문항',{shuffleQ:true});
  });
  on('o-shuffle',function(){ o.shuffle=!o.shuffle; save(); V.home(); });
  on('o-uniq',function(){ o.uniq=!o.uniq; save(); V.home(); });
  on('o-instant',function(){ o.instant=!o.instant; save(); V.home(); });
  var sel=document.getElementById('o-count');
  if(sel) sel.onchange=function(){ o.count=+sel.value; save(); };
  on('go-stats',V.stats); on('do-reset',doReset); on('do-export',doExport);
};
function mode(id,dot,t,d,dis){
  return '<button class="mode" id="'+id+'"'+(dis?' disabled':'')+'>'+
    '<div class="mt"><span class="dot '+dot+'"></span>'+t+'</div><div class="md">'+d+'</div></button>';
}
function optRow(t,d,ctl){
  return '<div class="opt-row"><div class="ol"><b>'+t+'</b><small>'+d+'</small></div>'+ctl+'</div>';
}
function poolAll(){
  return ST.opt.uniq ? UNIQ.slice() : ALL.slice();
}

/* ── 하위 선택 화면 ── */
function chipPage(title,desc,chips,backFn){
  app('<div class="card"><h2>'+title+'<span>'+desc+'</span></h2><div class="chips">'+chips+'</div>'+
      '<div class="row" style="margin-top:14px"><button class="btn btn-ghost btn-sm" id="back">← 뒤로</button></div></div>');
  on('back',backFn||V.home);
}
V.pickSubj=function(){
  var pool=poolAll();
  var chips=Object.keys(SUBJ).map(function(k){
    var n=pool.filter(function(q){ return q.s==k; }).length;
    return '<button class="chip" data-s="'+k+'">'+k+'과목 · '+SUBJ[k]+'<small>'+n+'</small></button>';
  }).join('');
  chipPage('과목별 랜덤','과목을 하나 고르세요',chips);
  bindChips('data-s',function(v){
    start(pool.filter(function(q){ return q.s==v; }), v+'과목 · '+SUBJ[v], {shuffleQ:true});
  });
};
V.pickExam=function(){
  var chips=META.exams.map(function(sid){
    var y=sid.split('-');
    return '<button class="chip" data-e="'+sid+'">'+y[0]+'년 '+y[1]+'회<small>100</small></button>';
  }).join('');
  chipPage('회차별','회차를 고르면 1번부터 순서대로 나옵니다','<button class="chip" data-e="ALL">전 회차 섞기<small>'+META.total+'</small></button>'+chips);
  bindChips('data-e',function(v){
    if(v==='ALL'){ start(ALL.slice(),'전 회차 섞기',{shuffleQ:true}); return; }
    start(EXAMS[v].slice(), v.replace('-','년 ')+'회', {shuffleQ:false, count:100, forceAll:true});
  });
};
V.pickType=function(){
  var pool=poolAll();
  var chips=TYPES.map(function(t){
    var n=pool.filter(function(q){ return q.ty===t; }).length;
    return '<button class="chip" data-t="'+esc(t)+'">'+t+'<small>'+n+'</small></button>';
  }).join('');
  chipPage('유형별','문제 유형을 고르세요',chips);
  bindChips('data-t',function(v){
    start(pool.filter(function(q){ return q.ty===v; }), '유형 · '+v, {shuffleQ:true});
  });
};
V.pickMock=function(){
  var chips=META.exams.map(function(sid){
    var y=sid.split('-');
    return '<button class="chip" data-m="'+sid+'">'+y[0]+'년 '+y[1]+'회</button>';
  }).join('');
  chipPage('회차 모의고사','100문항 · 150분 · 과목별 40점 미만이면 과락','<button class="chip" data-m="MIX">랜덤 조합 100문항</button>'+chips);
  bindChips('data-m',function(v){
    var qs = v==='MIX' ? mixMock() : EXAMS[v].slice();
    start(qs, v==='MIX'?'모의고사 · 랜덤 조합':'모의고사 · '+v.replace('-','년 ')+'회',
      {shuffleQ:false, count:100, forceAll:true, mock:true, secs:150*60});
  });
};
function mixMock(){
  var out=[];
  Object.keys(SUBJ).forEach(function(k){
    out=out.concat(shuffle(UNIQ.filter(function(q){ return q.s==k; })).slice(0,20));
  });
  return out;
}
function bindChips(attr,fn){
  [].forEach.call(document.querySelectorAll('.chip['+attr+']'),function(b){
    b.onclick=function(){ fn(b.getAttribute(attr)); };
  });
}

/* ══════════ 출제 ══════════ */
function start(pool,label,cfg){
  cfg=cfg||{};
  if(!pool.length){ alert('출제할 문항이 없습니다.'); return; }
  var qs=pool.slice();
  if(cfg.shuffleQ) shuffle(qs);
  var n = cfg.forceAll ? qs.length : Math.min(cfg.count||ST.opt.count, qs.length);
  qs=qs.slice(0,n);

  S={ label:label, qs:qs, i:0, ans:new Array(qs.length), mark:new Array(qs.length),
      order:[], mock:!!cfg.mock,
      graded:!cfg.mock && ST.opt.instant, left:cfg.secs||0, t0:Date.now() };
  qs.forEach(function(q){
    var idx=[0,1,2,3];
    if(ST.opt.shuffle && !q.fig) shuffle(idx);
    S.order.push(idx);
  });
  if(S.mock && S.left>0){
    tick=setInterval(function(){
      S.left--; 
      var el=document.getElementById('tmr');
      if(el){ el.textContent='남은 시간 '+fmt(S.left); el.className='timerbar'+(S.left<600?' hot':''); }
      if(S.left<=0){ clearInterval(tick); tick=null; V.result(); }
    },1000);
  }
  V.quiz();
}

V.quiz=function(){
  var q=S.qs[S.i], ord=S.order[S.i], a=S.ans[S.i], mk=S.mark[S.i];
  var shown = (S.graded && a!=null) || mk==='u';   /* 정답·해설이 드러난 상태 */
  var mono=isMono(q.q);
  var h=[];
  h.push('<div class="card">');
  h.push('<div class="row spread"><div class="meta">'+
    '<span class="tag">'+esc(S.label)+'</span>'+
    '<span class="tag t5">'+(S.i+1)+' / '+S.qs.length+'</span>'+
    '</div>'+ (S.mock? '<span class="timerbar" id="tmr">남은 시간 '+fmt(S.left)+'</span>' :
      '<button class="btn btn-ghost btn-sm" id="quit">그만두기</button>') +'</div>');
  h.push('<div class="progress"><i style="width:'+((S.i)/S.qs.length*100)+'%"></i></div>');

  h.push('<div class="meta">'+
    '<span class="tag t4">'+q.s+'과목 '+SUBJ[q.s]+'</span>'+
    '<span class="tag t2">'+q.src.replace('-','년 ')+'회 '+q.n+'번</span>'+
    '<span class="tag t3">'+esc(q.ty)+'</span>'+
    (q.rep>1 ? '<span class="tag">'+q.rep+'회 출제</span>' : '')+
    '</div>');
  h.push('<div class="qtext'+(mono?' mono':'')+'">'+esc(q.q)+'</div>');
  if(q.fig) h.push('<div class="warn">이 문항은 원본에 그림이 있어 텍스트만으로는 정답이 하나로 정해지지 않습니다. 참고용으로만 보세요.</div>');

  h.push('<div class="opts">');
  ord.forEach(function(oi,pos){
    var cls='opt'+(isMono(q.c[oi])?' mono':'');
    if(shown){
      cls+=' dis';
      if(oi===q.a) cls+=' ok';
      else if(oi===a) cls+=' no';
    } else if(a===oi) cls+=' sel';
    h.push('<button class="'+cls+'" data-o="'+oi+'"><span class="n">'+'①②③④'[pos]+'</span><span>'+esc(q.c[oi])+'</span></button>');
  });
  h.push('</div>');

  if(shown){
    var good = (mk!=='u') && (a===q.a);
    var vd = mk==='u' ? '모르겠음 — 정답과 해설'
           : mk==='g' && good ? '찍어서 맞힘 — 아직 아는 문제가 아닙니다'
           : good ? '정답' : '오답';
    var st2 = ST.hist[q.u]||{};
    h.push('<div class="expl'+(good&&mk!=='g'?'':' bad')+'"><div class="vd">'+vd+'</div>'+
      (mk==='u' ? '<p style="font-weight:700">정답 · '+esc(q.c[q.a])+'</p>' : '')+
      '<p>'+esc(EXPL[q.u]||'해설 준비 중')+'</p>'+
      '<div class="srcline">'+q.src.replace('-','년 ')+'회 '+q.n+'번'+
        (q.rep>1?' · 같은 문항이 '+q.rep+'회 출제됨':'')+
        (st2.n?' · 누적 '+st2.n+'회 중 확신 정답 '+(st2.n-st2.w-(st2.lucky||0)-(st2.unsure||0))+
          ((st2.lucky||0)?' · 찍어 맞힘 '+st2.lucky:'')+((st2.unsure||0)?' · 모름 '+st2.unsure:''):'')+
      '</div>'+
      (good && mk!=='g' ? '<button class="btn btn-ghost btn-sm" style="margin-top:10px" id="admit">사실 찍었습니다 — 다시 볼 문항으로</button>' : '')+
      '</div>');
  }

  /* 즉시 채점 모드에서는 '모르겠음'(답을 안 고르고 정답 보기),
     답안지 모드·모의고사에서는 '찍음' 표시(나중에 채점되므로 확신도만 기록) */
  if(!shown){
    if(S.graded){
      h.push('<div class="row" style="margin-top:12px">'+
        '<button class="btn btn-ghost btn-sm" id="unsure">❓ 모르겠음 — 답과 해설 보기</button></div>');
    } else {
      h.push('<div class="row" style="margin-top:12px">'+
        '<button class="btn '+(mk==='g'?'btn-mag':'btn-ghost')+' btn-sm" id="guess">'+
        (mk==='g'?'🎲 찍음으로 표시됨 (해제)':'🎲 확신 없음 — 찍었다고 표시')+'</button>'+
        '<button class="btn '+(mk==='u'?'btn-mag':'btn-ghost')+' btn-sm" id="dunno">'+
        (mk==='u'?'❓ 모름으로 표시됨 (해제)':'❓ 모르겠음')+'</button></div>');
    }
  }
  h.push('<div class="row spread" style="margin-top:16px">'+
    '<button class="btn btn-ghost btn-sm" id="prev"'+(S.i===0?' disabled':'')+'>← 이전</button>'+
    '<div class="row">'+
      (!S.graded && !S.mock ? '<button class="btn btn-teal btn-sm" id="grade"'+(a==null?' disabled':'')+'>채점</button>':'')+
      '<button class="btn btn-primary btn-sm" id="next">'+(S.i===S.qs.length-1?'끝내기 →':'다음 →')+'</button>'+
    '</div></div>');
  h.push('</div>');

  if(S.mock || !ST.opt.instant){
    h.push('<div class="card"><h2>답안지<span>번호를 눌러 바로 이동</span></h2><div class="sheet" id="sheet"></div>'+
      '<div class="row" style="margin-top:12px"><button class="btn btn-mag btn-sm" id="submit">답안 제출하고 채점</button>'+
      '<button class="btn btn-ghost btn-sm" id="quit2">그만두기</button></div></div>');
  }
  app(h.join(''));

  [].forEach.call(document.querySelectorAll('.opt[data-o]'),function(b){
    b.onclick=function(){
      if(shown) return;
      S.ans[S.i]=+b.getAttribute('data-o');
      if(S.mark[S.i]==='u') S.mark[S.i]=null;
      if(S.graded) record(S.i);
      V.quiz();
    };
  });
  on('unsure',function(){                    /* 즉시 채점 모드 — 답을 고르지 않고 정답 공개 */
    S.ans[S.i]=null; S.mark[S.i]='u'; record(S.i); V.quiz();
  });
  on('dunno',function(){                     /* 답안지 모드 — 모름 표시만 해 두고 나중에 채점 */
    S.mark[S.i] = (S.mark[S.i]==='u') ? null : 'u';
    if(S.mark[S.i]==='u') S.ans[S.i]=null;
    V.quiz();
  });
  on('guess',function(){
    S.mark[S.i] = (S.mark[S.i]==='g') ? null : 'g'; V.quiz();
  });
  on('admit',function(){                     /* 맞혔지만 사실은 찍은 경우 */
    S.mark[S.i]='g'; unrecord(S.i); record(S.i); V.quiz();
  });
  on('prev',function(){ if(S.i>0){ S.i--; V.quiz(); } });
  on('next',function(){
    if(S.i===S.qs.length-1) V.result();
    else { S.i++; V.quiz(); }
  });
  on('grade',function(){ S.graded=true; record(S.i); V.quiz(); });
  on('quit',quit); on('quit2',quit); on('submit',function(){
    if(confirm('제출하고 채점할까요?')) V.result();
  });
  paintSheet();
};
function paintSheet(){
  var el=document.getElementById('sheet'); if(!el) return;
  var h='';
  for(var i=0;i<S.qs.length;i++){
    var mk=S.mark[i];
    var c='sq'+(S.ans[i]!=null?' done':'')+(mk==='u'?' no':'')+(mk==='g'?' warnq':'')+(i===S.i?' cur':'');
    h+='<button class="'+c+'" data-i="'+i+'">'+(i+1)+'</button>';
  }
  el.innerHTML=h;
  [].forEach.call(el.querySelectorAll('.sq'),function(b){
    b.onclick=function(){ S.i=+b.getAttribute('data-i'); V.quiz(); };
  });
}
function record(i){
  var q=S.qs[i], h=hist(q.u), mk=S.mark[i];
  h.n++;
  if(mk==='u'){ h.unsure++; h.last='u'; }                 /* 모르겠음 */
  else if(S.ans[i]!==q.a){ h.w++; h.last='w'; }           /* 오답 */
  else if(mk==='g'){ h.lucky++; h.last='g'; }             /* 찍어서 맞힘 */
  else h.last='o';                                        /* 확신 정답 */
  S.done=S.done||{}; S.done[i]=1;
  save();
}
/* '사실 찍었습니다' 로 판정을 바꿀 때 직전 기록을 되돌립니다. */
function unrecord(i){
  var q=S.qs[i], h=hist(q.u);
  if(!(S.done&&S.done[i])) return;
  h.n--;
  if(h.last==='u') h.unsure--;
  else if(h.last==='w') h.w--;
  else if(h.last==='g') h.lucky--;
  delete S.done[i];
  save();
}
function quit(){
  if(!confirm('그만두면 지금까지 푼 결과는 저장되지 않습니다. 계속할까요?')) return;
  if(tick){ clearInterval(tick); tick=null; }
  V.home();
}

/* ══════════ 결과 ══════════ */
V.result=function(){
  if(tick){ clearInterval(tick); tick=null; }
  if(!S.graded){ S.qs.forEach(function(q,i){ record(i); }); }
  var ok=0, solid=0, lucky=0, dunno=0, bySub={}, byType={};
  S.qs.forEach(function(q,i){
    var mk=S.mark[i], good=(mk!=='u') && (S.ans[i]===q.a);
    if(good) ok++;
    if(mk==='u') dunno++;
    else if(good && mk==='g') lucky++;
    else if(good) solid++;
    (bySub[q.s]=bySub[q.s]||{n:0,o:0}).n++; if(good) bySub[q.s].o++;
    (byType[q.ty]=byType[q.ty]||{n:0,o:0}).n++; if(good) byType[q.ty].o++;
  });
  var score=pct(ok,S.qs.length);
  var mins=Math.round((Date.now()-S.t0)/60000);
  ST.runs.push({t:Date.now(),label:S.label,n:S.qs.length,ok:ok,solid:solid,g:lucky,u:dunno}); 
  if(ST.runs.length>60) ST.runs=ST.runs.slice(-60);
  save();

  var h=[];
  var passed=null, why='';
  if(S.mock){
    var fails=Object.keys(bySub).filter(function(k){ return pct(bySub[k].o,bySub[k].n)<40; });
    passed = score>=60 && fails.length===0;
    why = fails.length? fails.map(function(k){ return k+'과목 과락'; }).join(' · ')
        : (score<60? '평균 60점 미만' : '평균 60점 이상 · 과락 없음');
  }
  h.push('<div class="card" style="text-align:center">'+
    '<h2 style="text-align:left">'+esc(S.label)+'<span>'+mins+'분 소요</span></h2>'+
    '<div class="big'+(S.mock?(passed?' pass':' fail'):'')+'">'+score+'<span style="font-size:22px">점</span></div>'+
    '<div style="color:var(--ink2);font-size:14px;margin-top:4px">'+S.qs.length+'문항 중 '+ok+'문항 정답</div>'+
    '<div class="stats4" style="margin-top:14px">'+
      '<div class="s4"><b style="color:var(--teal)">'+solid+'</b><small>확신 정답</small></div>'+
      '<div class="s4"><b style="color:var(--amber)">'+lucky+'</b><small>찍어서 맞힘</small></div>'+
      '<div class="s4"><b style="color:var(--ink3)">'+dunno+'</b><small>모르겠음</small></div>'+
      '<div class="s4"><b style="color:var(--mag)">'+(S.qs.length-ok-dunno)+'</b><small>틀림</small></div>'+
    '</div>'+
    (lucky||dunno ? '<div style="font-size:12.5px;color:var(--ink2);margin-top:10px">'+
      '찍어서 맞힌 '+lucky+'문항과 모르겠다고 한 '+dunno+'문항은 아직 아는 문제가 아닙니다. '+
      '<b>다시 볼 문항</b>에 담아 두었습니다.</div>' : '')+
    (S.mock? '<div style="margin-top:10px;font-weight:700;color:'+(passed?'var(--teal)':'var(--mag)')+'">'+
       (passed?'합격':'불합격')+' — '+why+'</div>':'')+
    '</div>');

  h.push('<div class="card"><h2>과목별</h2><div class="bars">'+
    Object.keys(bySub).sort().map(function(k){
      var p=pct(bySub[k].o,bySub[k].n);
      return bar(k+'과목 '+SUBJ[k], p, bySub[k].o+'/'+bySub[k].n);
    }).join('')+'</div></div>');

  h.push('<div class="card"><h2>유형별</h2><div class="bars">'+
    Object.keys(byType).map(function(k){
      var p=pct(byType[k].o,byType[k].n);
      return bar(k,p,byType[k].o+'/'+byType[k].n);
    }).join('')+'</div></div>');

  var wrongs=[];
  S.qs.forEach(function(q,i){
    var mk=S.mark[i], good=(mk!=='u') && (S.ans[i]===q.a);
    if(!good || mk==='g') wrongs.push({q:q,a:S.ans[i],mk:mk,good:good});
  });
  if(wrongs.length){
    h.push('<div class="card"><h2>다시 볼 문항<span>'+wrongs.length+'문항</span></h2>'+
      wrongs.map(function(w){
        var q=w.q;
        var badge = w.mk==='u' ? '<span class="tag t3">모르겠음</span>'
                  : w.mk==='g' && w.good ? '<span class="tag t2">찍어서 맞힘</span>'
                  : '<span class="tag t3">오답</span>';
        return '<div class="rev"><div class="meta" style="margin-bottom:6px">'+badge+
          '<span class="tag t5">'+q.src.replace('-','년 ')+'회 '+q.n+'번</span></div>'+
          '<div class="rq'+(isMono(q.q)?' mono':'')+'">'+esc(q.q)+'</div>'+
          '<div class="ra"><span class="mine">고른 답 · '+
            (w.mk==='u'?'모르겠음':(w.a==null?'무응답':esc(q.c[w.a])))+'</span><br>'+
          '<span class="right">정답 · '+esc(q.c[q.a])+'</span></div>'+
          '<div class="re">'+esc(EXPL[q.u]||'')+'</div></div>';
      }).join('')+'</div>');
  }
  h.push('<div class="row" style="margin-top:4px">'+
    (wrongs.length?'<button class="btn btn-mag btn-sm" id="again">이것만 다시 풀기</button>':'')+
    '<button class="btn btn-primary btn-sm" id="home">홈으로</button></div>');
  app(h.join('')); foot('');
  on('home',V.home);
  on('again',function(){ start(wrongs.map(function(w){return w.q;}),'다시 풀기',{shuffleQ:true,forceAll:true}); });
};
function bar(label,p,v){
  return '<div class="bar"><div class="bl">'+esc(label)+'</div>'+
    '<div class="bt"><i class="'+lvl(p)+'" style="width:'+p+'%"></i></div>'+
    '<div class="bv">'+p+'% <small>'+v+'</small></div></div>';
}

/* ══════════ 통계 ══════════ */
V.stats=function(){
  var bySub={}, byType={}, byExam={}, tot={n:0,o:0,g:0,u:0,w:0};
  UNIQ.forEach(function(q){
    var h=ST.hist[q.u]; if(!h||!h.n) return;
    add(bySub,q.s,h); add(byType,q.ty,h);
    tot.n+=h.n; tot.w+=h.w; tot.g+=(h.lucky||0); tot.u+=(h.unsure||0);
    tot.o+=(h.n-h.w-(h.lucky||0)-(h.unsure||0));
  });
  EXAM_LIST.forEach(function(sid){
    EXAMS[sid].forEach(function(q){ var h=ST.hist[q.u]; if(h&&h.n) add(byExam,sid,h); });
  });
  /* 정답률은 '확신 정답' 기준입니다. 찍어 맞힌 것은 아는 문제로 치지 않습니다. */
  function add(m,k,h){ var o=m[k]=m[k]||{n:0,o:0};
    o.n+=h.n; o.o+=(h.n-h.w-(h.lucky||0)-(h.unsure||0)); }
  function block(title,m,fmtk){
    var ks=Object.keys(m); if(!ks.length) return '';
    return '<div class="card"><h2>'+title+'</h2><div class="bars">'+ks.sort().map(function(k){
      var p=pct(m[k].o,m[k].n); return bar(fmtk?fmtk(k):k, p, m[k].o+'/'+m[k].n);
    }).join('')+'</div></div>';
  }
  var recent=ST.runs.slice(-10).reverse().map(function(r){
    var d=new Date(r.t);
    var extra = (r.g||r.u) ? ' · 찍음 '+(r.g||0)+' · 모름 '+(r.u||0) : '';
    return '<div class="opt-row"><div class="ol"><b>'+esc(r.label)+'</b><small>'+
      (d.getMonth()+1)+'/'+d.getDate()+' · '+r.n+'문항'+extra+'</small></div>'+
      '<div style="font-family:var(--mono);font-weight:700;color:'+(pct(r.ok,r.n)>=60?'var(--teal)':'var(--mag)')+'">'+pct(r.ok,r.n)+'점</div></div>';
  }).join('');
  var summary = tot.n ? '<div class="card"><h2>응답 분포<span>확신 정답률 '+pct(tot.o,tot.n)+'%</span></h2>'+
    '<div class="stats4">'+
      '<div class="s4"><b style="color:var(--teal)">'+tot.o+'</b><small>확신 정답</small></div>'+
      '<div class="s4"><b style="color:var(--amber)">'+tot.g+'</b><small>찍어서 맞힘</small></div>'+
      '<div class="s4"><b style="color:var(--ink3)">'+tot.u+'</b><small>모르겠음</small></div>'+
      '<div class="s4"><b style="color:var(--mag)">'+tot.w+'</b><small>틀림</small></div>'+
    '</div>'+
    '<div style="font-size:12px;color:var(--ink3);margin-top:10px">'+
      '아래 정답률은 모두 <b>확신 정답</b> 기준입니다. 찍어서 맞힌 것과 모르겠다고 한 것은 아는 문제로 치지 않습니다.'+
    '</div></div>' : '';
  var body = summary +
    block('과목별 확신 정답률',bySub,function(k){ return k+'과목 '+SUBJ[k]; })+
    block('유형별 확신 정답률',byType)+
    block('회차별 확신 정답률',byExam,function(k){ return k.replace('-','년 ')+'회'; })+
    (recent? '<div class="card"><h2>최근 기록</h2>'+recent+'</div>':'');
  if(!body) body='<div class="card"><h2>통계</h2><div style="color:var(--ink2);font-size:14px">'+
    '아직 푼 문항이 없습니다. 홈에서 학습 방식을 골라 시작해 보세요.</div></div>';
  app(body+'<div class="row"><button class="btn btn-primary btn-sm" id="home">홈으로</button></div>');
  foot(''); on('home',V.home);
};

/* ══════════ 기록 관리 ══════════ */
function doReset(){
  if(!confirm('푼 기록과 오답 노트를 모두 지웁니다. 계속할까요?')) return;
  ST.hist={}; ST.runs=[]; save(); V.home();
}
function doExport(){
  var blob=new Blob([JSON.stringify({hist:ST.hist,runs:ST.runs},null,1)],{type:'application/json'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='정처기기출-기록.json'; a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); },1000);
}

V.home();
})();
