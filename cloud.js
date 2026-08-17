/* ============================================================
   NUVEM (Firebase) — login Google + controle de assinatura
   - Coleção "gestao": dados de cada usuária (um doc por login)
   - Coleção "assinantes": controle de acesso (só a dona escreve)
   ============================================================ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCcQmj4goOCaYqAZs8ly4nrWodbrlHh5OU",
  authDomain: "precificacao-59078.firebaseapp.com",
  projectId: "precificacao-59078",
  storageBucket: "precificacao-59078.firebasestorage.app",
  messagingSenderId: "573270984618",
  appId: "1:573270984618:web:28e8d1755c39fd12cb0dd3"
};

// ---------- Configurações do negócio ----------
const EMAIL_DONA = "ferramentaskscorse@gmail.com";  // acesso vitalício + painel da dona
const DIAS_TESTE = 7;                                // período de teste grátis
const LINK_KIWIFY = "COLE_O_LINK_KIWIFY_AQUI";       // link de assinatura Kiwify

if(FIREBASE_CONFIG.apiKey === "COLE_AQUI"){
  window.mostrarAvisoConfig && window.mostrarAvisoConfig();
} else {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const { getFirestore, doc, getDoc, setDoc, collection, getDocs } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let uid = null;

  const hojeISO = () => new Date().toISOString().slice(0,10);
  const emailKey = (e) => (e||"").toLowerCase().trim();

  window.cloudLogin = async ()=>{
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch(e){ window.toastGlobal && window.toastGlobal("Não consegui entrar — tente de novo"); }
  };
  window.cloudLogout = ()=>signOut(auth);

  window.cloudSave = async (dados)=>{
    if(!uid) return;
    try {
      await setDoc(doc(db, "gestao", uid), {
        dados: JSON.stringify(dados),
        atualizadoEm: new Date().toISOString()
      });
    } catch(e){
      window.toastGlobal && window.toastGlobal("Falha ao salvar na nuvem — verifique a internet");
    }
  };

  window.LINK_KIWIFY = LINK_KIWIFY;

  // ---------- Controle de acesso (assinatura / teste) ----------
  function diasAte(iso){
    const alvo = new Date(iso+"T23:59:59");
    const diff = Math.ceil((alvo - new Date())/(1000*60*60*24));
    return Math.max(0, diff);
  }
  async function verificarAcesso(user){
    const email = emailKey(user.email);
    if(email === emailKey(EMAIL_DONA)){
      return { liberado:true, dona:true, tipo:"dona" };
    }
    const ref = doc(db, "assinantes", email);
    let snap = null;
    try { snap = await getDoc(ref); } catch(e){}

    if(snap && snap.exists()){
      const a = snap.data();
      if(a.status === "bloqueado") return { liberado:false, dona:false, tipo:"bloqueado" };
      const venceu = a.validoAte && a.validoAte < hojeISO();
      if(a.status === "teste"){
        if(venceu) return { liberado:false, dona:false, tipo:"teste_expirado", validoAte:a.validoAte };
        return { liberado:true, dona:false, tipo:"teste", validoAte:a.validoAte, diasRestantes:diasAte(a.validoAte) };
      }
      if(venceu) return { liberado:false, dona:false, tipo:"assinatura_expirada", validoAte:a.validoAte };
      return { liberado:true, dona:false, tipo:"assinante", validoAte:a.validoAte };
    }

    // primeira vez: cria o teste grátis
    const fim = new Date(); fim.setDate(fim.getDate() + DIAS_TESTE);
    const validoAte = fim.toISOString().slice(0,10);
    try {
      await setDoc(ref, { email, status:"teste", validoAte, inicioTeste:hojeISO(), criadoEm:new Date().toISOString() });
    } catch(e){}
    return { liberado:true, dona:false, tipo:"teste", validoAte, diasRestantes:DIAS_TESTE };
  }

  // ---------- Painel da dona ----------
  window.donaListarAssinantes = async ()=>{
    const out = [];
    try {
      const qs = await getDocs(collection(db, "assinantes"));
      qs.forEach(d=>out.push(d.data()));
    } catch(e){ window.toastGlobal && window.toastGlobal("Não consegui carregar a lista"); }
    return out;
  };
  window.donaSalvarAssinante = async (email, validoAte, status)=>{
    const e = emailKey(email);
    if(!e || !e.includes("@")){ window.toastGlobal && window.toastGlobal("Email inválido"); return false; }
    try {
      await setDoc(doc(db, "assinantes", e),
        { email:e, validoAte, status:(status||"ativo"), atualizadoEm:new Date().toISOString() },
        { merge:true });
      return true;
    } catch(err){ window.toastGlobal && window.toastGlobal("Falha ao salvar assinante"); return false; }
  };

  // ---------- Fluxo de autenticação ----------
  onAuthStateChanged(auth, async user=>{
    if(user){
      uid = user.uid;
      const acesso = await verificarAcesso(user);
      if(!acesso.liberado){ window.appAcessoNegado(user, acesso); return; }
      let dados = null;
      try {
        const snap = await getDoc(doc(db, "gestao", uid));
        if(snap.exists() && snap.data().dados) dados = JSON.parse(snap.data().dados);
      } catch(e){
        window.toastGlobal && window.toastGlobal("Não consegui carregar seus dados — recarregue a página");
      }
      window.appAoEntrar(user, dados, acesso);
    } else {
      uid = null;
      window.appAoSair();
    }
  });
}
