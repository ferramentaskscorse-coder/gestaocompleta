/* =====================================================
   GESTÃO COMPLETA — sistema de gestão para profissionais
   Espelha a lógica da planilha: hora real (do fluxo) +
   markup + categoria transversal. Dados na nuvem.
   ===================================================== */

// ---------- Estado ----------
function estadoInicial(){
  return {
    categorias: ["Geral"],                 // negócios/categorias (marcador transversal)
    config: { horasDia:8, diasMes:22 },    // base do valor da hora
    materiais: [],   // {id, nome, categoria, precoEmb, qtdEmb, unidade}
    produtos: [],    // {id, nome, categoria, tempo, taxaCartao, taxaImposto, margem, markup, materiais:[{matId,qtd}]}
    clientes: [],    // {id, nome, telefone, email, cidade, status, obs, criadoEm}
    lancamentos: [], // {id, data, tipo:Receita|Despesa, fixoVar:Fixo|Variável, categoria, descricao, forma, valor, status, clienteId?, produtoId?}
    metas: [],       // {id, ano, mes, metaReceita, metaDespesa, metaQtd}
    proxNum: { lanc:1 }
  };
}
let state = estadoInicial();

let salvarTimer = null;
function salvar(){
  clearTimeout(salvarTimer);
  salvarTimer = setTimeout(()=>{ if(window.cloudSave) window.cloudSave(state); }, 900);
}

// ---------- Unidades ----------
const UNIDADES = {
  "g":{base:"g",fator:1}, "kg":{base:"g",fator:1000},
  "ml":{base:"ml",fator:1}, "L":{base:"ml",fator:1000},
  "un":{base:"un",fator:1}, "m":{base:"m",fator:1}, "cm":{base:"m",fator:0.01}
};
const NOME_BASE = {g:"g",ml:"ml",un:"un",m:"m"};
const FORMAS_PGTO = ["Dinheiro","PIX","Débito","Crédito","Boleto","Transferência","Débito Automático"];
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

// ---------- Utilidades ----------
const $ = id => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2,9);
const brl = v => (isFinite(v)?v:0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const pct = v => (isFinite(v)?v:0).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:1})+"%";
const num = el => { const v = parseFloat(String(el.value).replace(",", ".")); return isNaN(v)?0:v; };
const hoje = () => new Date().toISOString().slice(0,10);
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.remove("show"),2200); }

// categoria ativa do filtro global
let catAtiva = "__all__";
function casaCategoria(catItem){ return catAtiva==="__all__" || catItem===catAtiva; }

// ---------- Cálculos centrais (lógica da planilha) ----------
// Valor da hora = despesa do mês corrente / horas / dias  (FLUXO DE CAIXA!M1)
function despesaMes(ano, mes){
  return state.lancamentos
    .filter(l=>l.tipo==="Despesa")
    .filter(l=>{ const d=new Date(l.data+"T12:00"); return d.getFullYear()===ano && d.getMonth()===mes; })
    .reduce((s,l)=>s+(l.valor||0),0);
}
function valorHora(){
  const ag = new Date();
  const desp = despesaMes(ag.getFullYear(), ag.getMonth());
  const h = state.config.horasDia||8, d = state.config.diasMes||22;
  if(h<=0||d<=0) return 0;
  return desp / (h*d);
}
function custoUnitMaterial(m){
  if(!m.precoEmb||!m.qtdEmb) return 0;
  const u = UNIDADES[m.unidade]||UNIDADES.un;
  return m.precoEmb / (m.qtdEmb * u.fator);
}
function unidadeBase(m){ const u=UNIDADES[m.unidade]||UNIDADES.un; return NOME_BASE[u.base]; }

// preço de um produto/procedimento — espelha colunas P..Y da planilha
function calcProduto(p){
  let custoMat = 0;
  (p.materiais||[]).forEach(mm=>{
    const m = state.materiais.find(x=>x.id===mm.matId);
    if(m) custoMat += custoUnitMaterial(m) * (mm.qtd||0);
  });
  const vh = valorHora();
  const maoObra = vh * ((p.tempo||0)/60);                       // S = hora * (min/60)
  const taxaCartaoPct = p.taxaCartao||0, taxaImpostoPct = p.taxaImposto||0;
  const valorCartao = (custoMat + maoObra) * taxaCartaoPct/100;  // T
  const valorImposto = (custoMat + maoObra) * taxaImpostoPct/100;// U
  const custoTotal = custoMat + maoObra + valorCartao + valorImposto; // V
  const margemPct = (p.margem==null?30:p.margem);
  const valorMargem = custoTotal * margemPct/100;                // W
  const markup = p.markup||1;                                    // X
  const preco = (custoTotal + valorMargem) * markup;             // Y = (V+W)*markup
  const lucro = preco - custoTotal;                              // sobra acima do custo
  return {
    custoMat, maoObra, valorCartao, valorImposto, custoTotal,
    margemPct, valorMargem, markup, preco, lucro, vh,
    taxasReais: valorCartao + valorImposto
  };
}

// agregados do fluxo respeitando o filtro de categoria
function fluxo(filtroData){
  let rec=0, desp=0;
  state.lancamentos.forEach(l=>{
    if(!casaCategoria(l.categoria)) return;
    if(filtroData && !filtroData(new Date(l.data+"T12:00"))) return;
    if(l.tipo==="Receita") rec+=l.valor||0; else desp+=l.valor||0;
  });
  return { rec, desp, saldo:rec-desp };
}

// ---------- Navegação ----------
function irPara(panel){
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
  $("panel-"+panel).classList.add("active");
  document.querySelector(`.tab-btn[data-panel="${panel}"]`).classList.add("active");
  window.scrollTo({top:0});
  renderPainelAtivo(panel);
}
document.querySelectorAll(".tab-btn").forEach(b=>b.addEventListener("click",()=>irPara(b.dataset.panel)));

function renderPainelAtivo(panel){
  ({painel:renderPainel, precos:renderPrecos, materiais:renderMateriais,
    caixa:renderCaixa, crm:renderCrm, metas:renderMetas, config:renderConfig}[panel]||(()=>{}))();
}

// ---------- Filtro de categoria global ----------
function renderCatFilter(){
  const sel = $("catGlobal");
  const atual = sel.value || "__all__";
  sel.innerHTML = `<option value="__all__">Todos</option>` +
    state.categorias.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = state.categorias.includes(atual)||atual==="__all__" ? atual : "__all__";
  catAtiva = sel.value;
}
$("catGlobal").addEventListener("change", ()=>{
  catAtiva = $("catGlobal").value;
  renderTudo();
});

function opcoesCategoria(selecionada){
  return state.categorias.map(c=>`<option value="${esc(c)}"${c===selecionada?" selected":""}>${esc(c)}</option>`).join("");
}

// ---------- Gerenciar categorias ----------
$("btnGerirCat").addEventListener("click", abrirGerirCat);
function abrirGerirCat(){
  const box = $("modalBox");
  box.innerHTML = `
    <h1 style="font-size:1.3rem">Negócios / categorias</h1>
    <p>Cada categoria separa um negócio ou área. Tudo que você cadastrar carrega uma — assim dá pra ver de onde vem cada lucro e cada despesa.</p>
    <div id="catList" style="text-align:left;margin-bottom:14px"></div>
    <div class="row">
      <input type="text" id="novaCat" placeholder="Ex: Cozinha, Manicure, Odonto">
      <button class="btn-small" id="addCat">+ Adicionar</button>
    </div>
    <button class="btn" id="fecharCat" style="margin-top:14px">Pronto</button>`;
  $("modalOverlay").classList.remove("hidden");
  const pintaLista = ()=>{
    $("catList").innerHTML = state.categorias.map(c=>`
      <div class="list-item">
        <span class="li-name">${esc(c)}</span>
        ${state.categorias.length>1?`<button class="btn-del" data-rmcat="${esc(c)}" aria-label="Remover">✕</button>`:""}
      </div>`).join("");
    $("catList").querySelectorAll("[data-rmcat]").forEach(b=>{
      b.addEventListener("click",()=>{
        const c = b.dataset.rmcat;
        const usada = state.materiais.some(m=>m.categoria===c)||state.produtos.some(p=>p.categoria===c)||state.lancamentos.some(l=>l.categoria===c);
        if(usada && !confirm(`"${c}" está em uso. Remover mesmo assim? Os itens ficam sem categoria.`)) return;
        state.categorias = state.categorias.filter(x=>x!==c);
        salvar(); pintaLista(); renderCatFilter();
      });
    });
  };
  pintaLista();
  $("addCat").addEventListener("click",()=>{
    const v = $("novaCat").value.trim();
    if(!v) return;
    if(state.categorias.includes(v)){ toast("Essa categoria já existe"); return; }
    state.categorias.push(v); $("novaCat").value="";
    salvar(); pintaLista(); renderCatFilter();
  });
  $("fecharCat").addEventListener("click",()=>{ $("modalOverlay").classList.add("hidden"); renderTudo(); });
}

// ---------- Ícones de informação ----------
document.addEventListener("click", e=>{
  const btn = e.target.closest(".tip-btn");
  document.querySelectorAll(".info-tip.aberto").forEach(t=>{ if(!btn||t!==btn.parentElement) t.classList.remove("aberto"); });
  if(btn) btn.parentElement.classList.toggle("aberto");
});

// ---------- Render geral ----------
function renderTudo(){
  renderCatFilter();
  const ativo = document.querySelector(".tab-btn.active");
  renderPainelAtivo(ativo?ativo.dataset.panel:"painel");
}

// ================= PAINEL =================
function renderPainel(){
  const el = $("panel-painel");
  const ag = new Date();
  const ini7 = new Date(ag); ini7.setDate(ag.getDate()-7);
  const mesAtual = d => d.getMonth()===ag.getMonth() && d.getFullYear()===ag.getFullYear();
  const fMes = fluxo(mesAtual);
  const fSem = fluxo(d=>d>=ini7);
  const fAno = fluxo(d=>d.getFullYear()===ag.getFullYear());

  // meta do mês atual (respeitando categoria? metas são globais por mês)
  const meta = state.metas.find(m=>m.ano===ag.getFullYear() && m.mes===ag.getMonth());
  const metaRec = meta?meta.metaReceita:0;
  const progPct = metaRec>0 ? Math.min(100, fMes.rec/metaRec*100) : 0;

  // mais vendido no mês (por produto, via lançamentos de receita com produtoId)
  const vendasMes = state.lancamentos.filter(l=>l.tipo==="Receita" && l.produtoId && casaCategoria(l.categoria) && mesAtual(new Date(l.data+"T12:00")));
  const cont = {};
  vendasMesContagem(vendasMes, cont);
  const ranking = Object.entries(cont).sort((a,b)=>b[1].valor-a[1].valor).slice(0,3);

  const catLabel = catAtiva==="__all__" ? "todos os negócios" : catAtiva;

  el.innerHTML = `
    <h2>Painel</h2>
    <p class="sub">Visão de ${esc(catLabel)} — ${MESES[ag.getMonth()]}/${ag.getFullYear()}</p>

    <div class="dash-grid">
      <div class="dash-card big">
        <div class="dash-label">Saldo do mês</div>
        <div class="dash-num">${brl(fMes.saldo)}</div>
        <div class="dash-sub">Entrou ${brl(fMes.rec)} · saiu ${brl(fMes.desp)}</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">Últimos 7 dias</div>
        <div class="dash-num">${brl(fSem.rec)}</div>
        <div class="dash-sub">recebido</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">No ano</div>
        <div class="dash-num">${brl(fAno.rec)}</div>
        <div class="dash-sub">saldo ${brl(fAno.saldo)}</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">Sua hora vale</div>
        <div class="dash-num">${brl(valorHora())}</div>
        <div class="dash-sub">com base nas despesas</div>
      </div>
    </div>

    <div class="card">
      <h3>Meta de receita — ${MESES[ag.getMonth()]}</h3>
      ${metaRec>0?`
        <div class="progress"><span style="width:${progPct}%"></span></div>
        <p class="hint" style="margin-top:8px">${brl(fMes.rec)} de ${brl(metaRec)} — ${pct(metaRec>0?fMes.rec/metaRec*100:0)} da meta</p>
      `:`<p class="hint">Sem meta definida pra este mês. Defina na aba <b>Metas</b>.</p>`}
    </div>

    <div class="card">
      <h3>Mais vendidos do mês</h3>
      ${ranking.length?ranking.map(([nome,info],i)=>`
        <div class="list-item">
          <div class="li-name">${["🥇","🥈","🥉"][i]||""} ${esc(nome)}</div>
          <span class="li-value">${info.qtd}× · ${brl(info.valor)}</span>
        </div>`).join(""):`<div class="empty">Sem vendas registradas este mês. Registre na aba Caixa (receita ligada a um produto).</div>`}
    </div>`;
}
function vendasMesContagem(vendas, cont){
  vendas.forEach(l=>{
    const p = state.produtos.find(x=>x.id===l.produtoId);
    const nome = p?p.nome:(l.descricao||"Outro");
    if(!cont[nome]) cont[nome]={qtd:0,valor:0};
    cont[nome].qtd += 1;
    cont[nome].valor += l.valor||0;
  });
}

// ================= MATERIAIS =================
function renderMateriais(){
  const el = $("panel-materiais");
  const lista = state.materiais.filter(m=>casaCategoria(m.categoria));
  el.innerHTML = `
    <h2>Materiais</h2>
    <p class="sub">Cadastre o que você compra. A ferramenta calcula o custo de cada pedacinho.</p>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <h3 style="margin-bottom:0">Adicionar material</h3>
        <button class="btn-small" id="btnFalarMat">🎤 Falar vários</button>
      </div>
      <p class="hint" style="margin-top:6px">Diga ou digite: nome, quanto pagou, quanto vem na embalagem e a medida.</p>
      <div class="field"><label>Nome</label><input type="text" id="matNome" placeholder="Ex: Farinha de trigo"></div>
      <div class="row">
        <div class="field"><label>Categoria</label><select id="matCat">${opcoesCategoria(catAtiva!=="__all__"?catAtiva:state.categorias[0])}</select></div>
        <div class="field prefix-wrap"><label>Quanto pagou?</label><span class="prefix">R$</span><input type="number" id="matPreco" min="0" step="0.01" placeholder="8,90" inputmode="decimal"></div>
      </div>
      <div class="row">
        <div class="field"><label>Quanto vem?</label><input type="number" id="matQtd" min="0" step="0.01" placeholder="1000" inputmode="decimal"></div>
        <div class="field"><label>Medida</label><select id="matUn">
          <option value="g">gramas (g)</option><option value="kg">quilos (kg)</option>
          <option value="ml">mililitros (ml)</option><option value="L">litros (L)</option>
          <option value="un">unidades</option><option value="m">metros</option><option value="cm">centímetros</option>
        </select></div>
      </div>
      <button class="btn" id="btnAddMat">Adicionar</button>
    </div>
    <div class="card">
      <h3>Materiais cadastrados</h3>
      <div id="listaMat"></div>
    </div>`;

  $("btnAddMat").addEventListener("click", ()=>{
    const nome=$("matNome").value.trim(), preco=num($("matPreco")), qtd=num($("matQtd"));
    if(!nome||preco<=0||qtd<=0){ toast("Preencha nome, preço e quantidade"); return; }
    state.materiais.push({id:uid(),nome,categoria:$("matCat").value,precoEmb:preco,qtdEmb:qtd,unidade:$("matUn").value});
    salvar(); toast("Adicionado!"); renderMateriais();
  });
  $("btnFalarMat").addEventListener("click", ()=>abrirVozMateriais($("matCat").value));
  pintaListaMat();
}
function pintaListaMat(){
  const el = $("listaMat"); if(!el) return;
  const lista = state.materiais.filter(m=>casaCategoria(m.categoria));
  if(!lista.length){ el.innerHTML = `<div class="empty">Nenhum material ainda nesta categoria.</div>`; return; }
  el.innerHTML = lista.map(m=>{
    const cu=custoUnitMaterial(m), ub=unidadeBase(m);
    return `<div class="list-item">
      <div><div class="li-name">${esc(m.nome)}<span class="tag-cat">${esc(m.categoria)}</span></div>
        <div class="li-detail">${brl(m.precoEmb)} por ${m.qtdEmb.toLocaleString("pt-BR")} ${m.unidade}</div></div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="li-value">${brl4(cu)}/${ub}</span>
        <button class="btn-del" data-del="${m.id}" aria-label="Remover ${esc(m.nome)}">✕</button></div>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
    const usado = state.produtos.some(p=>(p.materiais||[]).some(mm=>mm.matId===b.dataset.del));
    if(usado && !confirm("Esse material está em uso num preço. Remover mesmo assim?")) return;
    state.materiais = state.materiais.filter(m=>m.id!==b.dataset.del);
    state.produtos.forEach(p=>{ p.materiais=(p.materiais||[]).filter(mm=>mm.matId!==b.dataset.del); });
    salvar(); pintaListaMat();
  }));
}
function brl4(v){ if(!isFinite(v))v=0; if(v>=0.1)return brl(v); return "R$ "+v.toLocaleString("pt-BR",{minimumFractionDigits:4,maximumFractionDigits:4}); }

// ================= PREÇOS =================
function renderPrecos(){
  const el = $("panel-precos");
  el.innerHTML = `
    <h2>Preços</h2>
    <p class="sub">Monte cada produto ou procedimento e veja quanto cobrar — com seu tempo, taxas, margem e markup.</p>
    <div class="card"><button class="btn" id="btnNovoProd">+ Criar novo</button></div>
    <div id="listaProd"></div>`;
  $("btnNovoProd").addEventListener("click", ()=>{
    state.produtos.unshift({id:uid(),nome:"",categoria:(catAtiva!=="__all__"?catAtiva:state.categorias[0]),
      tempo:60,taxaCartao:0,taxaImposto:0,margem:30,markup:1.5,materiais:[]});
    salvar(); pintaListaProd(); toast("Dê um nome ao novo item");
  });
  pintaListaProd();
}
function pintaListaProd(){
  const el = $("listaProd"); if(!el) return;
  const lista = state.produtos.filter(p=>casaCategoria(p.categoria));
  if(!lista.length){ el.innerHTML=`<div class="empty">Nenhum item ainda. Toque em <b>+ Criar novo</b>.</div>`; return; }
  el.innerHTML = lista.map(p=>htmlProduto(p)).join("");
  lista.forEach(p=>bindProduto(p));
}
function htmlProduto(p){
  const r = calcProduto(p);
  const opts = state.materiais.filter(m=>casaCategoria(m.categoria))
    .map(m=>`<option value="${m.id}">${esc(m.nome)}</option>`).join("");
  const matRows = (p.materiais||[]).map((mm,idx)=>{
    const m = state.materiais.find(x=>x.id===mm.matId); const ub = m?unidadeBase(m):"";
    return `<div class="mat-row">
      <select data-mat-sel="${idx}" aria-label="Material">${`<option value="">Escolha…</option>`+opts}</select>
      <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="Qtd" value="${mm.qtd??""}" data-mat-qtd="${idx}">
      <span class="mat-unit">${ub}</span>
      <button class="btn-del" data-mat-del="${idx}" aria-label="Remover">✕</button></div>`;
  }).join("");

  let barra="", legenda="";
  if(r.preco>0){
    const w = x => Math.max(0,(x/r.preco)*100);
    barra = `<div class="break-bar" aria-hidden="true">
      <span class="bb-mat" style="width:${w(r.custoMat)}%"></span>
      <span class="bb-mao" style="width:${w(r.maoObra)}%"></span>
      <span class="bb-tax" style="width:${w(r.taxasReais)}%"></span>
      <span class="bb-luc" style="width:${w(r.preco-r.custoTotal)}%"></span>
    </div>
    <div class="legend">
      <span><span class="dot bb-mat"></span>Materiais: <b>${brl(r.custoMat)}</b></span>
      <span><span class="dot bb-mao"></span>Seu trabalho: <b>${brl(r.maoObra)}</b></span>
      <span><span class="dot bb-tax"></span>Taxas: <b>${brl(r.taxasReais)}</b></span>
      <span><span class="dot bb-luc"></span>Sobra: <b>${brl(r.preco-r.custoTotal)}</b></span>
    </div>`;
  }
  return `<div class="card" data-prod="${p.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <input type="text" value="${esc(p.nome)}" placeholder="Ex: Botox, Bolo de pote" data-p-nome
        style="font-weight:700;font-size:1.05rem;border:none;border-bottom:2px solid var(--line);border-radius:0;padding:6px 2px;flex:1" aria-label="Nome">
      <button class="btn-del" data-p-del aria-label="Remover">✕</button>
    </div>
    <div class="field" style="margin-top:10px"><label>Categoria</label><select data-p-cat>${opcoesCategoria(p.categoria)}</select></div>
    <div style="margin-top:6px">
      <label>Materiais usados</label>
      ${matRows||`<p class="hint">Nenhum ainda.</p>`}
      <button class="btn-small" data-p-addmat>+ Usar material</button>
    </div>
    <div class="row" style="margin-top:14px">
      <div class="field suffix-wrap"><label>Tempo</label><span class="suffix">min</span>
        <input type="number" min="0" step="5" inputmode="numeric" value="${p.tempo??""}" data-p-tempo></div>
      <div class="field suffix-wrap"><label>Cartão</label><span class="suffix">%</span>
        <input type="number" min="0" max="50" step="0.1" inputmode="decimal" value="${p.taxaCartao??0}" data-p-cartao></div>
      <div class="field suffix-wrap"><label>Imposto</label><span class="suffix">%</span>
        <input type="number" min="0" max="50" step="0.1" inputmode="decimal" value="${p.taxaImposto??0}" data-p-imposto></div>
    </div>
    <div class="row">
      <div class="field suffix-wrap"><label>Margem de lucro<span class="info-tip"><button type="button" class="tip-btn" aria-label="ajuda">?</button><span class="tip-box" role="tooltip">Percentual aplicado sobre o custo, antes do markup. É o ganho que você quer embutir além de cobrir os custos.</span></span></label><span class="suffix">%</span>
        <input type="number" min="0" max="200" step="1" inputmode="numeric" value="${p.margem??30}" data-p-margem></div>
      <div class="field suffix-wrap"><label>Markup<span class="info-tip"><button type="button" class="tip-btn" aria-label="ajuda">?</button><span class="tip-box" role="tooltip">Multiplicador final do preço (ex: 1,5 = preço 50% acima do custo+margem). Dá folga pra descontos, imprevistos e posicionamento.</span></span></label><span class="suffix">×</span>
        <input type="number" min="1" max="5" step="0.05" inputmode="decimal" value="${p.markup??1.5}" data-p-markup></div>
    </div>
    <div class="price-tag">
      <span class="pt-label">Preço de venda</span>
      <div class="pt-value">${brl(r.preco)}</div>
      <div class="pt-line">Custo total: <strong style="color:#FFD58A">${brl(r.custoTotal)}</strong> · Sobra: <strong>${brl(r.preco-r.custoTotal)}</strong></div>
    </div>
    ${barra}${legenda}
    ${r.vh<=0?`<div class="alert info">Dica: cadastre suas despesas na aba <b>Caixa</b> pra calcular o valor real da sua hora de trabalho.</div>`:""}
  </div>`;
}
function bindProduto(p){
  const card = document.querySelector(`[data-prod="${p.id}"]`); if(!card) return;
  const q=s=>card.querySelector(s), qa=s=>card.querySelectorAll(s);
  const rerender=()=>{ salvar(); pintaListaProd(); };
  const onInput=(sel,fn)=>{ const e=q(sel); if(e) e.addEventListener("input",()=>{fn(e);salvar();refresh();}); };
  q("[data-p-nome]").addEventListener("change",e=>{ p.nome=e.target.value.trim(); salvar(); });
  q("[data-p-cat]").addEventListener("change",e=>{ p.categoria=e.target.value; rerender(); });
  onInput("[data-p-tempo]",e=>p.tempo=num(e));
  onInput("[data-p-cartao]",e=>p.taxaCartao=num(e));
  onInput("[data-p-imposto]",e=>p.taxaImposto=num(e));
  onInput("[data-p-margem]",e=>p.margem=num(e));
  onInput("[data-p-markup]",e=>p.markup=num(e)||1);
  q("[data-p-del]").addEventListener("click",()=>{ if(confirm("Remover este item?")){ state.produtos=state.produtos.filter(x=>x.id!==p.id); rerender(); }});
  q("[data-p-addmat]").addEventListener("click",()=>{
    if(!state.materiais.filter(m=>casaCategoria(m.categoria)).length){ toast("Cadastre materiais nesta categoria primeiro"); return; }
    p.materiais=p.materiais||[]; p.materiais.push({matId:"",qtd:null}); rerender();
  });
  qa("[data-mat-sel]").forEach(sel=>{ const i=+sel.dataset.matSel; sel.value=p.materiais[i].matId||"";
    sel.addEventListener("change",()=>{ p.materiais[i].matId=sel.value; rerender(); }); });
  qa("[data-mat-qtd]").forEach(inp=>{ const i=+inp.dataset.matQtd;
    inp.addEventListener("input",()=>{ p.materiais[i].qtd=num(inp); salvar(); refresh(); }); });
  qa("[data-mat-del]").forEach(b=>{ const i=+b.dataset.matDel;
    b.addEventListener("click",()=>{ p.materiais.splice(i,1); rerender(); }); });
  function refresh(){
    const r=calcProduto(p);
    const v=q(".price-tag .pt-value"); if(v) v.textContent=brl(r.preco);
    const l=q(".price-tag .pt-line"); if(l) l.innerHTML=`Custo total: <strong style="color:#FFD58A">${brl(r.custoTotal)}</strong> · Sobra: <strong>${brl(r.preco-r.custoTotal)}</strong>`;
  }
  qa("input,select").forEach(inp=>inp.addEventListener("blur",()=>pintaListaProd()));
}

// ================= CAIXA (Fluxo) =================
function renderCaixa(){
  const el = $("panel-caixa");
  const ag=new Date();
  const f = fluxo(d=>d.getMonth()===ag.getMonth()&&d.getFullYear()===ag.getFullYear());
  const prodOpts = state.produtos.filter(p=>casaCategoria(p.categoria)).map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join("");
  const cliOpts = state.clientes.map(c=>`<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  el.innerHTML = `
    <h2>Caixa</h2>
    <p class="sub">Registre entradas e saídas. É daqui que sai o valor da sua hora e o realizado das metas.</p>
    <div class="dash-grid">
      <div class="dash-card"><div class="dash-label">Entrou no mês</div><div class="dash-num" style="color:var(--green)">${brl(f.rec)}</div></div>
      <div class="dash-card"><div class="dash-label">Saiu no mês</div><div class="dash-num" style="color:var(--red)">${brl(f.desp)}</div></div>
      <div class="dash-card"><div class="dash-label">Saldo</div><div class="dash-num">${brl(f.saldo)}</div></div>
    </div>
    <div class="card">
      <h3>Novo lançamento</h3>
      <div class="row">
        <div class="field"><label>Tipo</label><select id="lncTipo"><option>Receita</option><option>Despesa</option></select></div>
        <div class="field"><label>Fixo ou variável</label><select id="lncFixoVar"><option>Variável</option><option>Fixo</option></select></div>
        <div class="field"><label>Categoria / negócio</label><select id="lncCat">${opcoesCategoria(catAtiva!=="__all__"?catAtiva:state.categorias[0])}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Descrição</label><input type="text" id="lncDesc" placeholder="Ex: Aluguel, Venda Botox"></div>
        <div class="field prefix-wrap"><label>Valor</label><span class="prefix">R$</span><input type="number" id="lncValor" min="0" step="0.01" inputmode="decimal"></div>
      </div>
      <div class="row">
        <div class="field"><label>Data</label><input type="date" id="lncData" value="${hoje()}"></div>
        <div class="field"><label>Forma de pagamento</label><select id="lncForma">${FORMAS_PGTO.map(f=>`<option>${f}</option>`).join("")}</select></div>
      </div>
      <div class="row" id="lncExtra" style="display:none">
        <div class="field"><label>Produto (opcional)</label><select id="lncProd"><option value="">—</option>${prodOpts}</select></div>
        <div class="field"><label>Cliente (opcional)</label><select id="lncCli"><option value="">—</option>${cliOpts}</select></div>
      </div>
      <button class="btn" id="btnAddLanc">Registrar</button>
    </div>
    <div class="card"><h3>Lançamentos do mês</h3><div id="listaLanc"></div></div>`;

  const toggleExtra=()=>{ $("lncExtra").style.display = $("lncTipo").value==="Receita"?"flex":"none"; };
  $("lncTipo").addEventListener("change", toggleExtra); toggleExtra();
  // ao escolher produto, sugere o valor de venda
  $("lncProd") && $("lncProd").addEventListener("change", ()=>{
    const p = state.produtos.find(x=>x.id===$("lncProd").value);
    if(p){ const r=calcProduto(p); if(r.preco>0) $("lncValor").value=r.preco.toFixed(2); if(!$("lncDesc").value) $("lncDesc").value=p.nome; }
  });
  $("btnAddLanc").addEventListener("click", ()=>{
    const valor=num($("lncValor")), desc=$("lncDesc").value.trim();
    if(valor<=0){ toast("Informe o valor"); return; }
    if(!desc){ toast("Informe a descrição"); return; }
    state.lancamentos.unshift({
      id:uid(), num:state.proxNum.lanc++, data:$("lncData").value||hoje(),
      tipo:$("lncTipo").value, fixoVar:$("lncFixoVar").value, categoria:$("lncCat").value,
      descricao:desc, forma:$("lncForma").value, valor,
      produtoId: $("lncProd")?$("lncProd").value||null:null,
      clienteId: $("lncCli")?$("lncCli").value||null:null, status:"Pago"
    });
    salvar(); toast("Lançamento registrado!"); renderCaixa();
  });
  pintaListaLanc();
}
function pintaListaLanc(){
  const el=$("listaLanc"); if(!el) return;
  const ag=new Date();
  const lista = state.lancamentos
    .filter(l=>casaCategoria(l.categoria))
    .filter(l=>{ const d=new Date(l.data+"T12:00"); return d.getMonth()===ag.getMonth()&&d.getFullYear()===ag.getFullYear(); });
  if(!lista.length){ el.innerHTML=`<div class="empty">Nenhum lançamento neste mês/categoria.</div>`; return; }
  el.innerHTML = lista.map(l=>{
    const d=new Date(l.data+"T12:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
    const cor = l.tipo==="Receita"?"var(--green)":"var(--red)";
    const sinal = l.tipo==="Receita"?"+":"−";
    return `<div class="list-item">
      <div><div class="li-name">${esc(l.descricao)}<span class="tag-cat">${esc(l.categoria)}</span></div>
        <div class="li-detail">${d} · ${esc(l.fixoVar)} · ${esc(l.forma)}</div></div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="li-value" style="color:${cor}">${sinal}${brl(l.valor)}</span>
        <button class="btn-del" data-del="${l.id}" aria-label="Remover">✕</button></div></div>`;
  }).join("");
  el.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
    if(!confirm("Remover este lançamento?")) return;
    state.lancamentos = state.lancamentos.filter(l=>l.id!==b.dataset.del);
    salvar(); renderCaixa();
  }));
}

// ================= CRM =================
function renderCrm(){
  const el=$("panel-crm");
  el.innerHTML = `
    <h2>Clientes</h2>
    <p class="sub">Sua base de clientes e o histórico de cada uma.</p>
    <div class="card">
      <h3>Novo cliente</h3>
      <div class="row">
        <div class="field"><label>Nome</label><input type="text" id="cliNome" placeholder="Nome completo"></div>
        <div class="field"><label>Telefone</label><input type="tel" id="cliTel" placeholder="(11) 99999-9999"></div>
      </div>
      <div class="row">
        <div class="field"><label>E-mail</label><input type="email" id="cliEmail" placeholder="opcional"></div>
        <div class="field"><label>Cidade</label><input type="text" id="cliCidade" placeholder="opcional"></div>
      </div>
      <div class="field"><label>Observações</label><textarea id="cliObs" rows="2" placeholder="Preferências, alergias, anotações…"></textarea></div>
      <button class="btn" id="btnAddCli">Adicionar cliente</button>
    </div>
    <div class="card"><h3>Clientes (<span id="cliCount">0</span>)</h3><div id="listaCli"></div></div>`;
  $("btnAddCli").addEventListener("click", ()=>{
    const nome=$("cliNome").value.trim();
    if(!nome){ toast("Informe o nome"); return; }
    state.clientes.unshift({id:uid(),nome,telefone:$("cliTel").value.trim(),email:$("cliEmail").value.trim(),
      cidade:$("cliCidade").value.trim(),obs:$("cliObs").value.trim(),status:"Ativo",criadoEm:hoje()});
    salvar(); toast("Cliente adicionado!"); renderCrm();
  });
  pintaListaCli();
}
function pintaListaCli(){
  const el=$("listaCli"); if(!el) return;
  $("cliCount").textContent = state.clientes.length;
  if(!state.clientes.length){ el.innerHTML=`<div class="empty">Nenhum cliente ainda.</div>`; return; }
  el.innerHTML = state.clientes.map(c=>{
    const gasto = state.lancamentos.filter(l=>l.clienteId===c.id&&l.tipo==="Receita").reduce((s,l)=>s+(l.valor||0),0);
    return `<div class="list-item">
      <div><div class="li-name">${esc(c.nome)}</div>
        <div class="li-detail">${[c.telefone,c.cidade].filter(Boolean).map(esc).join(" · ")||"sem contato"}${gasto>0?" · já gastou "+brl(gasto):""}</div></div>
      <button class="btn-del" data-del="${c.id}" aria-label="Remover">✕</button></div>`;
  }).join("");
  el.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
    if(!confirm("Remover este cliente?")) return;
    state.clientes = state.clientes.filter(c=>c.id!==b.dataset.del);
    salvar(); pintaListaCli();
  }));
}

// ================= METAS =================
function renderMetas(){
  const el=$("panel-metas"); const ag=new Date();
  el.innerHTML = `
    <h2>Metas</h2>
    <p class="sub">Defina a meta de cada mês e acompanhe o realizado (vindo do Caixa).</p>
    <div class="card">
      <h3>Definir meta</h3>
      <div class="row">
        <div class="field"><label>Ano</label><input type="number" id="metaAno" value="${ag.getFullYear()}" min="2020" max="2100"></div>
        <div class="field"><label>Mês</label><select id="metaMes">${MESES.map((m,i)=>`<option value="${i}"${i===ag.getMonth()?" selected":""}>${m}</option>`).join("")}</select></div>
      </div>
      <div class="row">
        <div class="field prefix-wrap"><label>Meta de receita</label><span class="prefix">R$</span><input type="number" id="metaRec" min="0" step="100" inputmode="decimal"></div>
        <div class="field prefix-wrap"><label>Meta de despesa</label><span class="prefix">R$</span><input type="number" id="metaDesp" min="0" step="100" inputmode="decimal"></div>
        <div class="field suffix-wrap"><label>Meta de vendas</label><span class="suffix">un</span><input type="number" id="metaQtd" min="0" step="1" inputmode="numeric"></div>
      </div>
      <button class="btn" id="btnAddMeta">Salvar meta</button>
    </div>
    <div class="card"><h3>Acompanhamento ${ag.getFullYear()}</h3><div class="tabela-wrap" id="tabMetas"></div></div>`;
  $("btnAddMeta").addEventListener("click", ()=>{
    const ano=parseInt($("metaAno").value,10), mes=parseInt($("metaMes").value,10);
    const mr=num($("metaRec")), md=num($("metaDesp")), mq=num($("metaQtd"));
    if(mr<=0&&md<=0&&mq<=0){ toast("Preencha ao menos uma meta"); return; }
    const ex = state.metas.find(m=>m.ano===ano&&m.mes===mes);
    if(ex){ ex.metaReceita=mr; ex.metaDespesa=md; ex.metaQtd=mq; }
    else state.metas.push({id:uid(),ano,mes,metaReceita:mr,metaDespesa:md,metaQtd:mq});
    salvar(); toast("Meta salva!"); renderMetas();
  });
  pintaTabMetas();
}
function pintaTabMetas(){
  const el=$("tabMetas"); if(!el) return; const ag=new Date(); const ano=ag.getFullYear();
  const metasAno = state.metas.filter(m=>m.ano===ano).sort((a,b)=>a.mes-b.mes);
  if(!metasAno.length){ el.innerHTML=`<div class="empty">Nenhuma meta definida pra ${ano}.</div>`; return; }
  const linhas = metasAno.map(m=>{
    const f = fluxo(d=>d.getFullYear()===ano&&d.getMonth()===m.mes);
    const ating = m.metaReceita>0 ? f.rec/m.metaReceita*100 : 0;
    const cls = ating>=100?"pos":(ating>=70?"":"neg");
    return `<tr>
      <td>${MESES[m.mes]}</td>
      <td class="num">${brl(m.metaReceita)}</td>
      <td class="num">${brl(f.rec)}</td>
      <td class="num ${cls}">${pct(ating)}</td>
      <td class="num">${brl(f.saldo)}</td></tr>`;
  }).join("");
  el.innerHTML = `<table class="grade">
    <thead><tr><th>Mês</th><th class="num">Meta</th><th class="num">Realizado</th><th class="num">% atingido</th><th class="num">Saldo</th></tr></thead>
    <tbody>${linhas}</tbody></table>
    <p class="hint" style="margin-top:10px">Realizado e saldo vêm dos lançamentos do Caixa${catAtiva!=="__all__"?` (categoria: ${esc(catAtiva)})`:""}.</p>`;
}

// ================= CONFIG =================
function renderConfig(){
  const el=$("panel-config");
  el.innerHTML = `
    <h2>Ajustes</h2>
    <p class="sub">Base do cálculo do valor da sua hora de trabalho.</p>
    <div class="card">
      <h3>Sua rotina de trabalho<span class="info-tip"><button type="button" class="tip-btn" aria-label="ajuda">?</button><span class="tip-box" role="tooltip">O valor da sua hora é calculado assim: total de despesas do mês ÷ horas por dia ÷ dias trabalhados. Quanto mais você produz, mais sua hora "rende" pra cobrir a estrutura.</span></span></h3>
      <div class="row">
        <div class="field suffix-wrap"><label>Horas por dia</label><span class="suffix">h</span><input type="number" id="cfgHoras" min="1" max="24" step="1" value="${state.config.horasDia}"></div>
        <div class="field suffix-wrap"><label>Dias por mês</label><span class="suffix">dias</span><input type="number" id="cfgDias" min="1" max="31" step="1" value="${state.config.diasMes}"></div>
      </div>
      <div class="chips"><span class="chip amber">Sua hora vale <strong>${brl(valorHora())}</strong></span>
        <span class="chip">Despesa do mês: <strong>${brl(despesaMes(new Date().getFullYear(),new Date().getMonth()))}</strong></span></div>
    </div>
    <div class="card">
      <h3>Backup dos dados</h3>
      <p class="hint">Seus dados já ficam salvos na nuvem. Mas você pode baixar uma cópia de segurança.</p>
      <button class="btn-small" id="btnBackup2">Baixar cópia</button>
      <button class="btn-small" id="btnRestore2">Restaurar cópia</button>
    </div>`;
  $("cfgHoras").addEventListener("input",e=>{ state.config.horasDia=num(e.target)||8; salvar(); renderConfig(); });
  $("cfgDias").addEventListener("input",e=>{ state.config.diasMes=num(e.target)||22; salvar(); renderConfig(); });
  $("btnBackup2").addEventListener("click", baixarBackup);
  $("btnRestore2").addEventListener("click", ()=>$("fileImport").click());
}

// ================= BACKUP =================
function baixarBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="gestao-backup.json"; a.click();
  URL.revokeObjectURL(a.href); toast("Cópia baixada");
}
$("btnExport").addEventListener("click", baixarBackup);
$("fileImport").addEventListener("change", e=>{
  const file=e.target.files[0]; if(!file) return;
  const rd=new FileReader();
  rd.onload=()=>{ try{ const d=JSON.parse(rd.result); if(!d||!("produtos"in d))throw 0;
    state=Object.assign(estadoInicial(),d); salvar(); renderTudo(); toast("Dados restaurados!");
  }catch(err){ toast("Arquivo inválido"); } };
  rd.readAsText(file); e.target.value="";
});

// ================= VOZ (materiais em lote) =================
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec=null, ouvindo=false, falaFinal="", vozCategoria="Geral", itensRevisao=[];

function abrirVozMateriais(categoria){
  if(!Rec){ toast("Seu navegador não tem reconhecimento de voz. Use o Chrome."); return; }
  vozCategoria = categoria || state.categorias[0];
  falaFinal="";
  const box=$("modalBox");
  box.innerHTML=`
    <div id="vozEscuta">
      <h1 style="font-size:1.25rem">Pode falar 🎤</h1>
      <p>Fale um material e diga <b>"próximo"</b> antes do seguinte. Ex: "Farinha de trigo, 5 e 50, 1 quilo… próximo… Açúcar, 4 reais, 1 quilo".</p>
      <div class="voice-live" id="vozLive" aria-live="polite"></div>
      <button class="btn" id="vozPronto">Pronto, revisar</button>
      <button class="btn-small" id="vozCancela" style="width:100%;margin-top:8px">Cancelar</button>
    </div>
    <div id="vozReview" style="display:none">
      <h1 style="font-size:1.25rem">Confira o que entendi</h1>
      <p>Corrija o que precisar. Tudo entra na categoria <b>${esc(vozCategoria)}</b>.</p>
      <div class="modal-rows" id="vozRows"></div>
      <button class="btn" id="vozAdd">Adicionar todos</button>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn-small" id="vozMais" style="flex:1">🎤 Falar mais</button>
        <button class="btn-small" id="vozCancela2" style="flex:1">Cancelar</button>
      </div>
    </div>`;
  $("modalOverlay").classList.remove("hidden");
  $("vozPronto").addEventListener("click", ()=>{
    pararRec(); const itens=dividirItens(falaFinal);
    if(!itens.length){ toast("Não entendi. Tente de novo."); fecharVoz(); return; }
    renderRevisao(itens.map(parseItem));
  });
  $("vozCancela").addEventListener("click", fecharVoz);
  $("vozCancela2").addEventListener("click", fecharVoz);
  $("vozMais").addEventListener("click", ()=>{ $("vozEscuta").style.display="block"; $("vozReview").style.display="none"; iniciarRec(); });
  $("vozAdd").addEventListener("click", confirmarVoz);
  iniciarRec();
}
function iniciarRec(){
  rec=new Rec(); rec.lang="pt-BR"; rec.continuous=true; rec.interimResults=true;
  rec.onresult=e=>{ let interim="";
    for(let i=e.resultIndex;i<e.results.length;i++){ const r=e.results[i];
      if(r.isFinal) falaFinal+=r[0].transcript+", "; else interim+=r[0].transcript; }
    if($("vozLive")) $("vozLive").textContent=(falaFinal+interim).trim();
  };
  rec.onerror=ev=>{ if(ev.error==="not-allowed"){ toast("Permita o microfone"); fecharVoz(); } };
  rec.onend=()=>{ if(ouvindo){ try{rec.start();}catch(e){} } };
  ouvindo=true; try{rec.start();}catch(e){ouvindo=false;}
}
function pararRec(){ ouvindo=false; if(rec){ try{rec.stop();}catch(e){} } }
function fecharVoz(){ pararRec(); $("modalOverlay").classList.add("hidden"); }

const NUM_PALAVRA={"um":"1","uma":"1","dois":"2","duas":"2","tres":"3","três":"3","quatro":"4","cinco":"5","seis":"6","sete":"7","oito":"8","nove":"9","dez":"10","onze":"11","doze":"12","meio":"0,5","meia":"0,5"};
const UNIDADE_FALADA={"quilo":"kg","quilos":"kg","kg":"kg","kilo":"kg","kilos":"kg","grama":"g","gramas":"g","g":"g","litro":"L","litros":"L","l":"L","mililitro":"ml","mililitros":"ml","ml":"ml","unidade":"un","unidades":"un","un":"un","ovos":"un","metro":"m","metros":"m","m":"m","centimetro":"cm","centimetros":"cm","cm":"cm"};
const RE_UN="quilos?|kilos?|kg|gramas?|g|litros?|l|mililitros?|ml|unidades?|un|metros?|m|cent[ií]metros?|cm";
function normalizar(t){
  t=" "+t.toLowerCase().replace(/r\$/g," ")+" ";
  t=t.replace(/\b(uma?\s+)?d[uú]zias?\b/g," 12 unidades ");
  t=t.replace(/\b(um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|meio|meia)\b/g,m=>NUM_PALAVRA[m]);
  return t;
}
function dividirItens(fala){
  const texto=normalizar(fala).replace(/\b(e\s+)?pr[oó]xim[oa](\s+item)?\b/g," | ");
  return texto.split("|").flatMap(dividirSeg).filter(Boolean);
}
function dividirSeg(seg){
  const pedacos=seg.split(/[,.;](?!\d)/).map(s=>s.trim()).filter(Boolean);
  const itens=[]; let buf="";
  const reCont=new RegExp("^(?:(?:o|a|por|cada)\\s+)?(?:"+RE_UN+")\\b");
  pedacos.forEach(p=>{ const cn=/^\d/.test(p), cu=reCont.test(p), bn=/\d/.test(buf);
    if(buf&&bn&&!cn&&!cu){ itens.push(buf); buf=p; } else buf=buf?buf+" "+p:p; });
  if(buf.trim()) itens.push(buf);
  return itens.flatMap(explodir);
}
function explodir(s){
  const re=new RegExp("\\d+(?:[.,]\\d+)?\\s*(?:"+RE_UN+")\\b","g");
  const partes=[]; let ult=0,m;
  while((m=re.exec(s))){ const fim=m.index+m[0].length; const parte=s.slice(ult,fim); const resto=s.slice(fim);
    const nNums=(parte.match(/\d+(?:[.,]\d+)?/g)||[]).length;
    const rl=resto.replace(/\b(reais|real|centavos|e|o|a|de|por|cada)\b/g," ");
    if(nNums>=2&&/\d/.test(resto)&&/[a-zà-úç]{3,}/.test(rl)){ partes.push(parte.trim()); ult=fim; } }
  const resto=s.slice(ult).trim(); if(resto) partes.push(resto);
  return partes.filter(Boolean);
}
function parseItem(texto){
  let t=" "+texto+" "; let nome="",preco=null,qtd=null,unidade=null;
  const reQtd=new RegExp("(\\d+(?:[.,]\\d+)?)\\s*("+RE_UN+")\\b");
  let m=t.match(reQtd);
  if(m){ qtd=parseFloat(m[1].replace(",",".")); unidade=UNIDADE_FALADA[m[2]]||null; t=t.replace(m[0]," "); }
  else{ const ms=t.match(/\b(?:o|a|por|cada)\s+(quilo|kilo|litro|grama|metro|unidade)\b/);
    if(ms){ qtd=1; unidade=UNIDADE_FALADA[ms[1]]||null; t=t.replace(ms[0]," "); } }
  if(qtd==null){ m=t.match(/^\s*(\d+)\s+(?=[a-zà-úç])/);
    if(m&&(t.match(/\d+(?:[.,]\d+)?/g)||[]).length>=2){ qtd=parseInt(m[1],10); unidade="un"; t=t.replace(m[0]," "); } }
  m=t.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real)\s*(?:e\s*(\d{1,2})(?:\s*centavos)?)?/);
  if(m){ preco=parseFloat(m[1].replace(",","."))+(m[2]?parseInt(m[2],10)/100:0); t=t.replace(m[0]," "); }
  else{ m=t.match(/(\d+)\s+e\s+(\d{1,2})\b/);
    if(m){ preco=parseInt(m[1],10)+parseInt(m[2],10)/100; t=t.replace(m[0]," "); }
    else{ m=t.match(/(\d+(?:[.,]\d{1,2})?)/); if(m){ preco=parseFloat(m[1].replace(",",".")); t=t.replace(m[0]," "); } } }
  if(qtd==null){ m=t.match(/(\d+(?:[.,]\d+)?)/); if(m){ qtd=parseFloat(m[1].replace(",",".")); unidade=unidade||"un"; t=t.replace(m[0]," "); } }
  nome=t.replace(/\b(custa|custou|paguei|pago|por|cada|embalagem|pacote|caixa)\b/g," ").replace(/\s+/g," ").trim()
    .replace(/^(de|da|do|a|o)\s+/,"").replace(/\s+(de|da|do|a|o)$/,"");
  if(nome) nome=nome.charAt(0).toUpperCase()+nome.slice(1);
  return {nome,preco,qtd,unidade:unidade||"un"};
}
function renderRevisao(itens){
  itensRevisao=itens; $("vozEscuta").style.display="none"; $("vozReview").style.display="block";
  const el=$("vozRows");
  el.innerHTML=itens.map((it,i)=>`
    <div class="vrow" data-vrow="${i}">
      <input type="text" value="${esc(it.nome)}" placeholder="Nome" data-v-nome="${i}">
      <div class="vrow-grid">
        <div class="prefix-wrap"><span class="prefix">R$</span><input type="number" min="0" step="0.01" inputmode="decimal" value="${it.preco??""}" placeholder="Preço" data-v-preco="${i}"></div>
        <input type="number" min="0" step="0.01" inputmode="decimal" value="${it.qtd??""}" placeholder="Qtd" data-v-qtd="${i}">
        <select data-v-un="${i}"><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="L">L</option><option value="un">un</option><option value="m">m</option><option value="cm">cm</option></select>
        <button class="btn-del" data-v-del="${i}" aria-label="Remover">✕</button>
      </div>
    </div>`).join("");
  itens.forEach((it,i)=>{ el.querySelector(`[data-v-un="${i}"]`).value=it.unidade||"un"; });
  el.querySelectorAll("[data-v-del]").forEach(b=>b.addEventListener("click",()=>{
    itensRevisao.splice(+b.dataset.vDel,1); if(!itensRevisao.length){fecharVoz();return;} renderRevisao(itensRevisao); }));
}
function confirmarVoz(){
  const el=$("vozRows"); let inval=false;
  const novos=itensRevisao.map((_,i)=>{
    const nome=el.querySelector(`[data-v-nome="${i}"]`).value.trim();
    const preco=parseFloat(String(el.querySelector(`[data-v-preco="${i}"]`).value).replace(",","."))||0;
    const qtd=parseFloat(String(el.querySelector(`[data-v-qtd="${i}"]`).value).replace(",","."))||0;
    const unidade=el.querySelector(`[data-v-un="${i}"]`).value;
    const ok=nome&&preco>0&&qtd>0;
    el.querySelector(`[data-vrow="${i}"]`).classList.toggle("vrow-erro",!ok);
    if(!ok) inval=true;
    return {id:uid(),nome,categoria:vozCategoria,precoEmb:preco,qtdEmb:qtd,unidade};
  });
  if(inval){ toast("Complete os campos em vermelho ou remova a linha"); return; }
  novos.forEach(n=>state.materiais.push(n));
  salvar(); fecharVoz(); toast(novos.length+(novos.length===1?" material adicionado!":" materiais adicionados!"));
  renderMateriais();
}

// ================= INICIALIZAÇÃO =================
if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
window.toastGlobal=toast;
window.appAoEntrar=(user,dados)=>{
  state=estadoInicial();
  if(dados) state=Object.assign(state,dados);
  if(!state.categorias||!state.categorias.length) state.categorias=["Geral"];
  $("authOverlay").classList.add("hidden");
  $("btnSair").style.display="";
  $("userInfo").textContent=(user.displayName||user.email||"").split(" ")[0];
  renderTudo();
};
window.appAoSair=()=>{ state=estadoInicial(); $("authOverlay").classList.remove("hidden"); $("btnSair").style.display="none"; $("userInfo").textContent=""; };
window.mostrarAvisoConfig=()=>{ $("authMsg").innerHTML="<b>Falta um passo:</b> cole a configuração do Firebase no arquivo cloud.js (procure por COLE_AQUI)."; };
$("btnEntrar").addEventListener("click",()=>{ if(window.cloudLogin) window.cloudLogin(); else toast("Configure o Firebase primeiro"); });
$("btnSair").addEventListener("click",()=>{ if(window.cloudLogout) window.cloudLogout(); });
renderTudo();
