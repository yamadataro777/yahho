const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compareChecks = [...document.querySelectorAll('input[name="compare"]')];
function updateCompare(changed) {
 let selected = compareChecks.filter(input=>input.checked);
 if (selected.length > 3 && changed) { changed.checked=false; selected=compareChecks.filter(input=>input.checked); }
 const bar = document.getElementById('compare-bar');
 if (bar) { bar.hidden = !selected.length; document.getElementById('compare-count').textContent = `${selected.length} / 3件を選択`; document.getElementById('compare-link').href = '/compare?tools='+selected.map(input=>encodeURIComponent(input.value)).join(','); }
 compareChecks.forEach(input=>{ input.disabled = selected.length>=3 && !input.checked; });
}
compareChecks.forEach(input=>input.addEventListener('change',()=>updateCompare(input)));
document.getElementById('compare-clear')?.addEventListener('click',()=>{compareChecks.forEach(input=>input.checked=false);updateCompare();});
const diagnosisForm = document.getElementById('diagnosis-form');
diagnosisForm?.addEventListener('submit',async event=>{
 event.preventDefault(); const button=diagnosisForm.querySelector('button[type="submit"]'), message=document.getElementById('diagnosis-message'), results=document.getElementById('diagnosis-results');
 button.disabled=true; message.textContent='条件に合う候補を探しています…';
 try {
  const response=await fetch('/api/recommend',{method:'POST',headers:{'Content-Type':'application/json',...(window.shigotoMetrics?.enabled()===false?{'x-analytics-opt-out':'1'}:{})},body:JSON.stringify(Object.fromEntries(new FormData(diagnosisForm)))});
  const data=await response.json(); if(!response.ok) throw new Error(data.error??'診断できませんでした。');
  results.innerHTML='<h2>あなたに合う候補と、その理由。</h2><p>診断は掲載ツールの用途と条件による選定です。無料枠・機能の最新条件は公式サイトで確認してください。</p><div class="tool-grid">'+data.recommendations.map((item,index)=>`<article class="tool-card"><div class="card-top"><span class="chip">候補 ${index+1}</span><span class="tool-icon ${html(item.tool.id)}">${html(item.tool.icon)}</span></div><h3>${html(item.tool.name)}</h3><p class="tagline">${html(item.tool.tagline)}</p><ul class="reasons">${item.reasons.map(reason=>`<li>${html(reason)}</li>`).join('')}</ul><a class="button primary" href="/tools/${encodeURIComponent(item.tool.id)}">条件と注意点を見る →</a></article>`).join('')+'</div><p><a class="text-link" href="/compare?tools='+data.recommendations.map(item=>encodeURIComponent(item.tool.id)).join(',')+'">この候補を並べて比較する →</a></p>';
  void window.shigotoMetrics?.diagnosis(new FormData(diagnosisForm).get('useCase'));
  message.textContent='診断が完了しました。候補の理由をご確認ください。'; results.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
 } catch(error) { message.textContent=error.message || '接続を確認して、もう一度お試しください。'; }
 finally {button.disabled=false;}
});
