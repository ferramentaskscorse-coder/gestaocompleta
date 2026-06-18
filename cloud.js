/* ============================================================
   NUVEM (Firebase) — login Google + dados por usuária
   A coleção usada aqui é "gestao", separada do Preço Certo.
   ============================================================ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCcQmj4goOCaYqAZs8ly4nrWodbrlHh5OU",
  authDomain: "precificacao-59078.firebaseapp.com",
  projectId: "precificacao-59078",
  storageBucket: "precificacao-59078.firebasestorage.app",
  messagingSenderId: "573270984618",
  appId: "1:573270984618:web:28e8d1755c39fd12cb0dd3"
};

if(FIREBASE_CONFIG.apiKey === "COLE_AQUI"){
  window.mostrarAvisoConfig && window.mostrarAvisoConfig();
} else {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const { getFirestore, doc, getDoc, setDoc } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let uid = null;

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

  onAuthStateChanged(auth, async user=>{
    if(user){
      uid = user.uid;
      let dados = null;
      try {
        const snap = await getDoc(doc(db, "gestao", uid));
        if(snap.exists() && snap.data().dados) dados = JSON.parse(snap.data().dados);
      } catch(e){
        window.toastGlobal && window.toastGlobal("Não consegui carregar seus dados — recarregue a página");
      }
      window.appAoEntrar(user, dados);
    } else {
      uid = null;
      window.appAoSair();
    }
  });
}
