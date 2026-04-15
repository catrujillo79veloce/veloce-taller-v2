// ========================================================
// auth.js — Autenticación y control de sesión
// ========================================================

async function authSignIn(email, password){
  const { data, error } = await window.db.sb.auth.signInWithPassword({ email, password });
  if(error) throw error;
  return data;
}

async function authSignOut(){
  await window.db.sb.auth.signOut();
}

async function authGetSession(){
  const { data: { session } } = await window.db.sb.auth.getSession();
  return session;
}

function authOnChange(cb){
  window.db.sb.auth.onAuthStateChange((_e, session) => cb(session));
}

window.auth = { signIn: authSignIn, signOut: authSignOut, getSession: authGetSession, onChange: authOnChange };
