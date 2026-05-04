// ========================================================
// Veloce Taller — App principal (Supabase backend)
// ========================================================

const TIPOS_TRABAJO=['Mantenimiento ruta/MTB','Mantenimiento ebike','Mantenimiento suspensión','Alistada','Lavada','Encerar cadena','Parchada','Cambio de llanta','Cambio de neumático','Armada','Desarmada','Otro'];
const HORARIO_TALLER={0:[],1:[[600,720],[780,1140]],2:[[600,720],[780,1140]],3:[[660,780],[840,1140]],4:[[600,720],[780,1140]],5:[[600,720],[780,1140]],6:[[660,1020]]};
const DURACION_MIN={'Mantenimiento':180,'Mantenimiento ruta/MTB':180,'Mantenimiento ebike':240,'Mantenimiento suspensión':180,'Lavada':20,'Alistada':90,'Encerar cadena':30,'Parchada':30,'Cambio de llanta':30,'Cambio de neumático':30,'Armada':120,'Desarmada':90};

// Estado en memoria (cache, se sincroniza con Supabase)
let state = { clientes: [], ordenes: [], mecanicos: ['Carlos','Andrés','Juan'], nextId: 1001 };
let selectedTipos=[], currentView='asesor', mecFilter='pending', clienteActivo=null, biciActiva=null;
let fotosIngreso=[];

// ===== Helpers =====
function esc(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function toast(msg,type){const w=document.getElementById('toast-wrap');if(!w)return;const t=document.createElement('div');t.className='toast '+(type||'info');t.textContent=msg;w.appendChild(t);setTimeout(()=>{t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(()=>t.remove(),300)},2500)}
function waLink(tel,msg){const clean=String(tel||'').replace(/\D/g,'');const num=clean.length===10?'57'+clean:clean;return`https://wa.me/${num}?text=${encodeURIComponent(msg)}`}
function fmtDate(iso){return new Date(iso).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'})}
function statusLabel(s){return{pending:'Pendiente','in-progress':'En progreso',done:'Terminada',delivered:'Entregada'}[s]||s}
function totalOrden(o){return(o.reparaciones||[]).reduce((s,r)=>s+(parseFloat(r.precio)||0),0)}
function duracionTipo(t){if(DURACION_MIN[t]!=null)return DURACION_MIN[t];if(t&&t.startsWith('Otro'))return 30;return 30}
function duracionOrden(o){return(o.tiposTrabajo||[]).reduce((s,t)=>s+duracionTipo(t),0)}
function fmtDur(min){const h=Math.floor(min/60),m=min%60;if(h&&m)return`${h}h ${m}min`;if(h)return`${h}h`;return`${m}min`}
function fmtFechaHora(d){if(!(d instanceof Date))d=new Date(d);return d.toLocaleDateString('es-CO',{weekday:'short',day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',hour12:false})}

function addWorkMinutes(start,minutes){
  const cur=new Date(start);let remaining=minutes;let iters=0;
  while(remaining>0&&iters<120){
    iters++;
    const day=cur.getDay();const slots=HORARIO_TALLER[day]||[];
    const curMin=cur.getHours()*60+cur.getMinutes();
    for(const [sStart,sEnd] of slots){
      if(curMin>=sEnd)continue;
      const slotBegin=Math.max(curMin,sStart);const capacity=sEnd-slotBegin;
      if(capacity<=0)continue;
      if(curMin<slotBegin){cur.setHours(Math.floor(slotBegin/60),slotBegin%60,0,0)}
      if(remaining<=capacity){const end=slotBegin+remaining;cur.setHours(Math.floor(end/60),end%60,0,0);remaining=0;break}
      remaining-=capacity;cur.setHours(Math.floor(sEnd/60),sEnd%60,0,0);
    }
    if(remaining>0){cur.setDate(cur.getDate()+1);cur.setHours(0,0,0,0)}
  }
  return cur;
}

function calcularCola(){
  const prio={urgente:0,normal:1,espera:2};
  const cola=state.ordenes.filter(o=>o.status==='pending'||o.status==='in-progress').sort((a,b)=>(prio[a.prioridad]??1)-(prio[b.prioridad]??1)||new Date(a.creado)-new Date(b.creado));
  const map=new Map();let cursor=new Date();
  for(const o of cola){
    const dur=duracionOrden(o);
    const inicio=new Date(Math.max(cursor.getTime(),new Date(o.creado).getTime()));
    const fin=addWorkMinutes(inicio,dur);
    map.set(o.id,{inicio,fin,duracion:dur});cursor=new Date(fin);
  }
  return map;
}

// ===== Recarga state desde Supabase =====
async function reloadState(){
  try {
    state = await window.db.loadAll();
  } catch(err) {
    console.error(err);
    toast('Error de conexión: '+err.message, 'error');
    throw err;
  }
}

// ===== Auth / Login =====
async function handleLogin(e){
  e.preventDefault();
  const email=document.getElementById('login-email').value.trim();
  const password=document.getElementById('login-password').value;
  const errDiv=document.getElementById('login-error');
  const btn=document.getElementById('login-btn');
  errDiv.style.display='none';
  btn.disabled=true;btn.textContent='Ingresando...';
  try{
    await window.auth.signIn(email,password);
    await bootApp();
  }catch(err){
    errDiv.textContent=err.message||'Credenciales inválidas';
    errDiv.style.display='block';
    btn.disabled=false;btn.textContent='Ingresar al taller';
  }
}

async function handleLogout(){
  if(!confirm('¿Cerrar sesión?'))return;
  await window.auth.signOut();
  location.reload();
}

async function bootApp(){
  document.getElementById('login-screen').style.display='none';
  document.getElementById('loading-screen').style.display='flex';
  try{
    await reloadState();
    const session=await window.auth.getSession();
    document.getElementById('user-email').textContent=session?.user?.email||'';
    document.getElementById('loading-screen').style.display='none';
    document.getElementById('app').style.display='block';
    initTipos();refreshMecanicoSelects();updateBadges();renderOrdenesRecientes();
  }catch(err){
    document.getElementById('loading-screen').style.display='none';
    document.getElementById('login-screen').style.display='flex';
    const errDiv=document.getElementById('login-error');
    errDiv.textContent='Error cargando datos: '+err.message;
    errDiv.style.display='block';
  }
}

async function init(){
  const session=await window.auth.getSession();
  if(session){
    await bootApp();
  } else {
    document.getElementById('loading-screen').style.display='none';
    document.getElementById('login-screen').style.display='flex';
  }
}

// ===== Mecánicos =====
function renderMecanicoOptions(selectedVal){return`<option value="Sin asignar">Sin asignar</option>`+state.mecanicos.map(m=>`<option value="${esc(m)}" ${m===selectedVal?'selected':''}>${esc(m)}</option>`).join('')}
function refreshMecanicoSelects(){const s=document.getElementById('ing-mecanico');if(s){const cur=s.value;s.innerHTML=renderMecanicoOptions(cur)}}
async function gestionarMecanicos(){
  const nombres=prompt('Mecánicos (separados por coma):',state.mecanicos.join(', '));
  if(nombres===null)return;
  const lista=nombres.split(',').map(n=>n.trim()).filter(Boolean);
  const final=lista.length?lista:['Sin asignar'];
  try{
    await window.db.setMecanicos(final);
    state.mecanicos=final;
    refreshMecanicoSelects();
    toast('Mecánicos actualizados','success');
  }catch(err){toast('Error: '+err.message,'error')}
}

// ===== Navegación =====
function showView(v){
  currentView=v;
  const views=['asesor','mecanico','caja','historial','notif'];
  views.forEach(x=>document.getElementById('view-'+x).style.display=x===v?'block':'none');
  document.querySelectorAll('.nav-btn').forEach((b,i)=>b.classList.toggle('active',views[i]===v));
  if(v==='mecanico')renderMecanico();if(v==='historial')renderHistorial();if(v==='notif')renderNotif();if(v==='asesor')renderOrdenesRecientes();if(v==='caja')renderCaja();
  updateBadges();
}
function updateBadges(){
  const pend=state.ordenes.filter(o=>o.status==='pending').length;
  const mb=document.getElementById('mec-badge');if(mb){mb.textContent=pend;mb.style.display=pend>0?'':'none'}
  const al=getAlertas().length;const nb=document.getElementById('notif-badge');if(nb){nb.textContent=al;nb.style.display=al>0?'':'none'}
}
async function refrescarVista(){
  await reloadState();
  if(currentView==='mecanico')renderMecanico();
  if(currentView==='caja')renderCaja();
  if(currentView==='historial')renderHistorial();
  if(currentView==='asesor')renderOrdenesRecientes();
  if(currentView==='notif')renderNotif();
  updateBadges();
}

// ===== Tipos de trabajo =====
function initTipos(){document.getElementById('tipo-grid').innerHTML=TIPOS_TRABAJO.map(t=>`<div class="tipo-chip" id="chip-${t.replace(/\s/g,'_')}" onclick="toggleTipo('${t}')">${t}</div>`).join('')}
function toggleTipo(t){
  selectedTipos.includes(t)?selectedTipos=selectedTipos.filter(x=>x!==t):selectedTipos.push(t);
  TIPOS_TRABAJO.forEach(tp=>{const el=document.getElementById('chip-'+tp.replace(/\s/g,'_'));if(el)el.classList.toggle('sel',selectedTipos.includes(tp))});
  document.getElementById('otro-input-wrap').style.display=selectedTipos.includes('Otro')?'block':'none';
  if(!selectedTipos.includes('Otro'))document.getElementById('otro-texto').value='';
}
function getTiposFinales(){
  const tipos=[...selectedTipos];
  if(tipos.includes('Otro')){const txt=document.getElementById('otro-texto').value.trim();tipos[tipos.indexOf('Otro')]=txt?`Otro: ${txt}`:'Otro'}
  return tipos;
}

// ===== Cliente / Bici en el form de asesor =====
function buscarCliente(){
  const id=document.getElementById('cli-id').value.trim();if(!id)return;
  const cli=state.clientes.find(c=>c.id===id||c._cedula===id||c.nombre.toLowerCase().includes(id.toLowerCase()));
  if(cli){
    clienteActivo=cli;document.getElementById('cliente-encontrado').style.display='block';document.getElementById('form-nuevo-cliente').style.display='none';
    document.getElementById('cliente-datos').innerHTML=`<strong>${esc(cli.nombre)}</strong> · ${esc(cli.tel)}${cli.email?' · '+esc(cli.email):''}`;
    if(cli.bicicletas&&cli.bicicletas.length>0){
      document.getElementById('bici-select-div').style.display='block';
      const sel=document.getElementById('bici-select');sel.innerHTML='<option value="">— Seleccionar bicicleta —</option>';
      cli.bicicletas.forEach((b,i)=>sel.innerHTML+=`<option value="${i}">${esc(b.marca)} ${esc(b.modelo)}${b.color?' ('+esc(b.color)+')':''}</option>`);
      sel.innerHTML+='<option value="nueva">+ Nueva bicicleta</option>';
    }
  }else{toast('Cliente no encontrado. Usa + Nuevo.','error')}
}
function mostrarFormNuevoCliente(){document.getElementById('form-nuevo-cliente').style.display='block';document.getElementById('cliente-encontrado').style.display='none';document.getElementById('bici-select-div').style.display='none';clienteActivo=null;biciActiva=null}
function seleccionarBici(val){
  if(val===''||val==='nueva'){biciActiva=null;['bici-marca','bici-modelo','bici-color','bici-serie','bici-año'].forEach(id=>document.getElementById(id).value='');return}
  const b=clienteActivo.bicicletas[parseInt(val)];biciActiva=b;
  document.getElementById('bici-marca').value=b.marca||'';document.getElementById('bici-modelo').value=b.modelo||'';
  document.getElementById('bici-color').value=b.color||'';document.getElementById('bici-serie').value=b.serie||'';document.getElementById('bici-año').value=b.año||'';
}

// ===== Crear orden =====
async function crearIngreso(){
  const idCli=document.getElementById('cli-id').value.trim(),nombre=document.getElementById('cli-nombre').value.trim(),tel=document.getElementById('cli-tel').value.trim(),email=document.getElementById('cli-email').value.trim();
  const marca=document.getElementById('bici-marca').value.trim(),modelo=document.getElementById('bici-modelo').value.trim(),color=document.getElementById('bici-color').value.trim(),serie=document.getElementById('bici-serie').value.trim(),año=document.getElementById('bici-año').value.trim();
  const descripcion=document.getElementById('ing-descripcion').value.trim(),prioridad=document.getElementById('ing-prioridad').value,mecanico=document.getElementById('ing-mecanico').value;
  if(!marca||!modelo){toast('Ingresa marca y modelo','error');return}
  if(selectedTipos.length===0){toast('Selecciona al menos un tipo de trabajo','error');return}
  if(selectedTipos.includes('Otro')&&!document.getElementById('otro-texto').value.trim()){toast('Describe el tipo de trabajo en Otro','error');return}
  const btn=document.querySelector('[onclick="crearIngreso()"]');if(btn){btn.disabled=true;btn.textContent='Creando...'}
  try{
    let clienteUuid;
    if(clienteActivo){
      clienteUuid=clienteActivo._uuid;
    }else{
      if(!nombre||!tel){toast('Ingresa nombre y teléfono','error');btn&&(btn.disabled=false,btn.textContent='Crear ingreso');return}
      clienteUuid=await window.db.upsertCliente({cedula:idCli,nombre,tel,email});
    }
    let biciUuid;
    if(biciActiva&&biciActiva._id){
      biciUuid=biciActiva._id;
    }else{
      biciUuid=await window.db.createBici(clienteUuid,{marca,modelo,color,serie,año});
    }
    // Calcular compromiso con la cola actual
    const duracionEst=selectedTipos.reduce((s,t)=>s+duracionTipo(t.startsWith('Otro')?'Otro':t),0);
    const cola=calcularCola();
    let cursor=new Date();
    for(const [,e] of cola)cursor=new Date(Math.max(cursor.getTime(),e.fin.getTime()));
    const fechaCompromiso=addWorkMinutes(cursor,duracionEst);

    const ordenData={
      tiposTrabajo:getTiposFinales(),descripcion,prioridad,mecanico,
      fotos:fotosIngreso,
      fechaCompromiso:fechaCompromiso.toISOString(),
      duracionMinutos:duracionEst
    };
    const oid=await window.db.createOrden(ordenData,clienteUuid,biciUuid);
    await reloadState();
    limpiarFormulario();updateBadges();renderOrdenesRecientes();
    toast(`Orden #${oid} creada`,'success');
    mostrarAccionesIngreso(oid);
  }catch(err){
    toast('Error: '+err.message,'error');
    console.error(err);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Crear ingreso'}
  }
}

function buildMensajeIngreso(o){
  let msg=`Hola ${o.clienteNombre} 👋, hemos recibido tu *${o.bici.marca} ${o.bici.modelo}*${o.bici.color?' ('+o.bici.color+')':''} en *Veloce Bicicletas*.\n\n`;
  msg+=`📋 *Orden:* #${o.id}\n`;
  msg+=`🔧 *Trabajo solicitado:* ${(o.tiposTrabajo||[]).join(', ')}\n`;
  if(o.duracionMinutos)msg+=`⏱ *Duración estimada:* ${fmtDur(o.duracionMinutos)}\n`;
  if(o.fechaCompromiso)msg+=`📅 *Entrega estimada:* ${fmtFechaHora(new Date(o.fechaCompromiso))}\n`;
  if(o.descripcion)msg+=`\n📝 *Observaciones:* ${o.descripcion}\n`;
  msg+=`\nTe avisaremos apenas esté lista. ¡Gracias por confiar en nosotros! 🚴`;
  return msg;
}
function mostrarAccionesIngreso(oid){
  const o=state.ordenes.find(o=>o.id===oid);if(!o)return;
  const msg=buildMensajeIngreso(o);
  const entregaInfo=o.fechaCompromiso?`<div class="report-block"><div style="font-size:13px;line-height:1.6">⏱ Duración estimada: <strong>${fmtDur(o.duracionMinutos||0)}</strong><br>📅 Entrega estimada: <strong>${fmtFechaHora(new Date(o.fechaCompromiso))}</strong></div></div>`:'';
  document.getElementById('modal-titulo').textContent=`✓ Orden #${o.id} recibida`;
  document.getElementById('modal-contenido').innerHTML=`<div class="cliente-info"><strong>${esc(o.clienteNombre)}</strong> · ${esc(o.clienteTel)}<br><span class="meta">${esc(o.bici.marca)} ${esc(o.bici.modelo)}${o.bici.color?' · '+esc(o.bici.color):''}</span></div>${entregaInfo}<div class="section" style="margin-top:12px"><label>Mensaje de confirmación para el cliente</label><textarea id="msg-ingreso" style="min-height:160px;font-size:12px">${esc(msg)}</textarea></div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><a class="btn btn-sm wa-btn" href="${waLink(o.clienteTel,msg)}" target="_blank" rel="noopener">📱 Enviar por WhatsApp</a><button class="btn btn-sm" onclick="copiarMensajeIngreso()">📋 Copiar mensaje</button><button class="btn btn-sm" onclick="imprimirRecibo(${o.id})">🖨 Imprimir recibo</button><button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="cerrarModal()">Listo</button></div>`;
  document.getElementById('modal-orden').style.display='block';
}
function copiarMensajeIngreso(){const el=document.getElementById('msg-ingreso');if(el){navigator.clipboard.writeText(el.value).then(()=>toast('Mensaje copiado','success')).catch(()=>{el.select();document.execCommand('copy');toast('Mensaje copiado','success')})}}

function limpiarFormulario(){
  ['cli-id','cli-nombre','cli-tel','cli-email','bici-marca','bici-modelo','bici-color','bici-serie','bici-año','ing-descripcion','otro-texto'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('form-nuevo-cliente').style.display='none';document.getElementById('cliente-encontrado').style.display='none';document.getElementById('bici-select-div').style.display='none';document.getElementById('otro-input-wrap').style.display='none';
  selectedTipos=[];initTipos();clienteActivo=null;biciActiva=null;fotosIngreso=[];renderFotosIngreso();
}

// ===== Listados =====
function renderOrdenesRecientes(){
  const div=document.getElementById('ordenes-recientes');const recientes=state.ordenes.slice(0,5);
  if(!recientes.length){div.innerHTML='';return}
  div.innerHTML=`<div class="card"><div class="card-header"><h2>Últimos ingresos</h2></div>${recientes.map(o=>`<div class="work-item ${o.status==='in-progress'?'in-progress':o.status==='done'?'done':''}" onclick="abrirOrden(${o.id})"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:500;font-size:13px">Orden #${o.id} · ${esc(o.bici.marca)} ${esc(o.bici.modelo)}</span><span class="status s-${o.status}">${statusLabel(o.status)}</span></div><div class="meta">${esc(o.clienteNombre)} · ${fmtDate(o.creado)} · ${esc((o.tiposTrabajo||[]).join(', '))}</div></div>`).join('')}</div>`;
}
function filtrarMec(f){mecFilter=f;document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',['pending','in-progress','done','all'][i]===f));renderMecanico()}
function renderMecanico(){
  const div=document.getElementById('lista-mecanico');const cola=calcularCola();
  const prio={urgente:0,normal:1,espera:2};
  let ordenes=state.ordenes.filter(o=>mecFilter==='all'||o.status===mecFilter);
  if(mecFilter==='pending'||mecFilter==='in-progress')ordenes.sort((a,b)=>(prio[a.prioridad]??1)-(prio[b.prioridad]??1)||new Date(a.creado)-new Date(b.creado));
  else ordenes.sort((a,b)=>new Date(b.creado)-new Date(a.creado));
  let agendaHoyHTML='';
  if(mecFilter==='pending'||mecFilter==='in-progress'||mecFilter==='all'){
    const hoy=new Date();hoy.setHours(0,0,0,0);const mañana=new Date(hoy);mañana.setDate(hoy.getDate()+1);
    const hoyOrds=[...cola.entries()].filter(([oid,e])=>e.fin>=hoy&&e.fin<mañana).sort((a,b)=>a[1].inicio-b[1].inicio);
    if(hoyOrds.length){
      const totalMin=hoyOrds.reduce((s,[_,e])=>s+e.duracion,0);
      agendaHoyHTML=`<div class="card" style="background:#FAECE7;border-color:#F0997B"><div class="card-header"><h2>Agenda de hoy</h2><span class="meta">${hoyOrds.length} trabajos · ${fmtDur(totalMin)}</span></div>${hoyOrds.map(([oid,e])=>{const o=state.ordenes.find(x=>x.id===oid);const h=e.inicio.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',hour12:false})+' → '+e.fin.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',hour12:false});return`<div class="work-item ${o.prioridad==='urgente'?'':'in-progress'}" onclick="abrirOrden(${oid});event.stopPropagation()"><div style="display:flex;justify-content:space-between"><span style="font-weight:500;font-size:13px">${h} · #${oid}</span><span class="meta">${fmtDur(e.duracion)}</span></div><div class="meta">${esc(o.clienteNombre)} · ${esc(o.bici.marca)} ${esc(o.bici.modelo)}</div></div>`}).join('')}</div>`;
    }
  }
  if(!ordenes.length){div.innerHTML=agendaHoyHTML+'<div class="empty">No hay órdenes aquí</div>';return}
  div.innerHTML=agendaHoyHTML+ordenes.map(o=>{
    const entry=cola.get(o.id);
    const entregaInfo=entry?`<div class="meta" style="color:#185FA5">⏱ ${fmtDur(entry.duracion)} · 📅 ${fmtFechaHora(entry.fin)}</div>`:(o.fechaCompromiso?`<div class="meta" style="color:#185FA5">📅 ${fmtFechaHora(new Date(o.fechaCompromiso))}</div>`:'');
    const urgenteBadge=o.prioridad==='urgente'?'<span class="status" style="background:#E24B4A;color:#fff">⚡ Urgente</span>':'';
    return`<div class="card" style="cursor:pointer" onclick="abrirOrden(${o.id})"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px"><span style="font-weight:500">#${o.id} · ${esc(o.bici.marca)} ${esc(o.bici.modelo)}${o.bici.color?' ('+esc(o.bici.color)+')':''}</span><div style="display:flex;gap:4px;align-items:center">${urgenteBadge}<span class="status s-${o.status}">${statusLabel(o.status)}</span></div></div><div class="meta" style="margin-bottom:4px">${esc(o.clienteNombre)} · ${esc((o.tiposTrabajo||[]).join(', '))}</div>${entregaInfo}${o.descripcion?`<div style="font-size:12px;color:#888;margin-top:4px">${esc(o.descripcion)}</div>`:''}</div>`;
  }).join('');
}

// ===== Checklist =====
function renderChecklist(o){
  const cl=o.checklist||{};
  const pct5=['0%','25%','50%','75%','100%'],pct3=['0%','50%','100%'],nm=['4nm','5nm','6nm'];
  function pctRow(field,label,opts){return`<div class="cl-row"><span class="cl-label">${label}</span><div class="cl-opts">${opts.map(v=>`<button class="cl-btn ${cl[field]===v?'sel-'+v.replace('%',''):''}" onclick="setCL(${o.id},'${field}','${v}')">${v}</button>`).join('')}</div></div>`}
  function tqRow(field,label){return`<div class="torque-row"><span class="cl-label" style="font-size:12px">${label}</span><div class="torque-opts">${nm.map(v=>`<button class="tq-btn ${cl[field]===v?'sel':''}" onclick="setCL(${o.id},'${field}','${v}')">${v}</button>`).join('')}</div></div>`}
  return`<div class="checklist-section"><div style="font-weight:500;font-size:13px;margin-bottom:10px">Checklist de estado</div>${pctRow('cadena','Cadena',pct5)}${pctRow('frenoDel','Pastillas freno delantero',pct5)}${pctRow('frenoTras','Pastillas freno trasero',pct5)}${pctRow('llantaDel','Llanta delantera',pct3)}${pctRow('llantaTras','Llanta trasera',pct3)}<div style="border-top:0.5px solid #e0e0e0;margin:10px 0;padding-top:10px"><div style="font-weight:500;font-size:12px;margin-bottom:8px;color:#888">Torques</div>${tqRow('torqueSillin','Tubo de sillín')}${tqRow('torqueEspiga','Espiga tija')}${tqRow('torqueManubrio','Espiga manubrio')}</div></div>`;
}
async function setCL(oid,field,val){
  const o=state.ordenes.find(o=>o.id===oid);if(!o)return;
  if(!o.checklist)o.checklist={};
  o.checklist[field]=val;
  try{
    await window.db.updateChecklist(oid,field,val);
    const wrap=document.getElementById('cl-wrap-'+oid);if(wrap)wrap.innerHTML=renderChecklist(o);
  }catch(err){toast('Error guardando: '+err.message,'error')}
}

// ===== Fotos =====
function comprimirImagen(file,maxSize=900,quality=0.75){return new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>{const img=new Image();img.onload=()=>{let w=img.width,h=img.height;if(w>h&&w>maxSize){h=h*maxSize/w;w=maxSize}else if(h>maxSize){w=w*maxSize/h;h=maxSize}const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);c.toBlob(blob=>res(blob),'image/jpeg',quality)};img.onerror=rej;img.src=e.target.result};r.onerror=rej;r.readAsDataURL(file)})}
async function agregarFotosIngreso(input){
  const files=[...(input.files||[])];if(!files.length)return;
  toast(`Subiendo ${files.length} foto(s)...`,'info');
  for(const f of files){
    try{
      const blob=await comprimirImagen(f);
      const url=await window.db.uploadFoto(blob);
      fotosIngreso.push(url);
    }catch(e){toast('Error: '+e.message,'error')}
  }
  input.value='';renderFotosIngreso();toast('Fotos subidas','success');
}
function renderFotosIngreso(){const div=document.getElementById('ing-fotos-preview');if(!div)return;div.innerHTML=fotosIngreso.map((src,i)=>`<div class="foto-thumb" onclick="abrirLightbox('${i}','ingreso')"><img src="${src}"><button class="foto-del" onclick="event.stopPropagation();fotosIngreso.splice(${i},1);renderFotosIngreso()">✕</button></div>`).join('')}
function abrirLightbox(idx,source,oid){let src;if(source==='ingreso')src=fotosIngreso[idx];else{const o=state.ordenes.find(o=>o.id===oid);src=o?.fotos?.[idx]}if(!src)return;document.getElementById('lightbox-img').src=src;document.getElementById('lightbox').style.display='flex'}
async function agregarFotosOrden(input,oid){
  const files=[...(input.files||[])];if(!files.length)return;
  const o=state.ordenes.find(o=>o.id===oid);if(!o)return;
  toast(`Subiendo ${files.length} foto(s)...`,'info');
  const newFotos=[...(o.fotos||[])];
  for(const f of files){
    try{
      const blob=await comprimirImagen(f);
      const url=await window.db.uploadFoto(blob);
      newFotos.push(url);
    }catch(e){toast('Error: '+e.message,'error')}
  }
  input.value='';
  try{
    await window.db.updateOrden(oid,{fotos:newFotos});
    o.fotos=newFotos;
    abrirOrden(oid);toast('Fotos subidas','success');
  }catch(err){toast('Error guardando: '+err.message,'error')}
}
async function eliminarFotoOrden(oid,idx){
  const o=state.ordenes.find(o=>o.id===oid);if(!o||!o.fotos)return;
  if(!confirm('¿Eliminar foto?'))return;
  const url=o.fotos[idx];
  const newFotos=o.fotos.filter((_,i)=>i!==idx);
  try{
    await window.db.updateOrden(oid,{fotos:newFotos});
    if(url)window.db.deleteFoto(url).catch(()=>{});
    o.fotos=newFotos;abrirOrden(oid);
  }catch(err){toast('Error: '+err.message,'error')}
}
function renderFotosOrden(o){const fotos=o.fotos||[];return`<div class="foto-upload" onclick="document.getElementById('foto-input-${o.id}').click()">📷 Agregar fotos</div><input id="foto-input-${o.id}" type="file" accept="image/*" multiple capture="environment" style="display:none" onchange="agregarFotosOrden(this,${o.id})"><div class="fotos-grid">${fotos.map((src,i)=>`<div class="foto-thumb" onclick="abrirLightbox(${i},'orden',${o.id})"><img src="${src}"><button class="foto-del" onclick="event.stopPropagation();eliminarFotoOrden(${o.id},${i})">✕</button></div>`).join('')}</div>`}

// ===== Modal orden =====
function abrirOrden(id){
  const o=state.ordenes.find(o=>o.id===id);if(!o)return;
  document.getElementById('modal-titulo').textContent=`Orden #${o.id} · ${o.bici.marca} ${o.bici.modelo}`;
  const reps=o.reparaciones||[];const total=reps.reduce((s,r)=>s+(parseFloat(r.precio)||0),0);
  const prioOpts=['normal','urgente','espera'];
  const cola=calcularCola();const entry=cola.get(o.id);
  const dur=duracionOrden(o);
  const compromisoTxt=o.fechaCompromiso?`<span class="meta">📅 Compromiso: ${fmtFechaHora(new Date(o.fechaCompromiso))}</span>`:'';
  const entregaActual=entry?`<span class="meta" style="color:#185FA5">🔄 Estimación actual: ${fmtFechaHora(entry.fin)}</span>`:'';
  document.getElementById('modal-contenido').innerHTML=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center"><span class="status s-${o.status}">${statusLabel(o.status)}</span><span class="meta">Ingresó: ${fmtDate(o.creado)}</span><span class="meta">⏱ ${fmtDur(dur)}</span>${compromisoTxt}${entregaActual}</div><div class="cliente-info"><strong>${esc(o.clienteNombre)}</strong> · ${esc(o.clienteTel)} <a class="btn btn-sm wa-btn" style="float:right;padding:2px 8px;font-size:11px" href="${waLink(o.clienteTel,'Hola '+o.clienteNombre)}" target="_blank" rel="noopener">📱 WhatsApp</a></div><div class="grid2"><div class="section"><label>Mecánico</label><select id="edit-mec-${o.id}">${renderMecanicoOptions(o.mecanico)}</select></div><div class="section"><label>Prioridad</label><select id="edit-prio-${o.id}">${prioOpts.map(p=>`<option value="${p}" ${o.prioridad===p?'selected':''}>${p}</option>`).join('')}</select></div></div><div style="margin-bottom:8px"><span style="font-size:12px;font-weight:500;color:#888">Tipo de trabajo: </span><span style="font-size:12px">${esc((o.tiposTrabajo||[]).join(' · '))}</span></div><div class="section"><label>Descripción / observaciones</label><textarea id="edit-desc-${o.id}">${esc(o.descripcion||'')}</textarea></div><div class="section"><label>Fotos</label>${renderFotosOrden(o)}</div><hr class="divider"><div id="cl-wrap-${o.id}">${renderChecklist(o)}</div><hr class="divider"><h3 style="margin-bottom:8px">Trabajo realizado y repuestos</h3><div id="reps-list-${o.id}">${reps.map((r,i)=>`<div class="repair-row"><input value="${esc(r.codigo||'')}" placeholder="SKU" id="rep-c-${o.id}-${i}" style="flex:1;min-width:70px;max-width:110px"><input value="${esc(r.desc)}" placeholder="Servicios y repuestos" id="rep-d-${o.id}-${i}" style="flex:2" oninput="recalcTotal(${o.id})"><input value="${esc(r.precio)}" type="number" placeholder="$ Valor" id="rep-p-${o.id}-${i}" style="flex:1;min-width:80px" oninput="recalcTotal(${o.id})"><button class="btn btn-sm" onclick="eliminarRep(${o.id},${i})">✕</button></div>`).join('')}</div><button class="btn btn-sm" onclick="agregarRep(${o.id})" style="margin-bottom:8px">+ Agregar línea</button><div class="total-box"><span style="font-weight:500;font-size:14px">Total orden</span><span style="font-size:18px;font-weight:500" id="total-${o.id}">$ ${total.toLocaleString('es-CO')}</span></div><hr class="divider"><div class="section"><label>Notas internas del mecánico</label><textarea id="notas-${o.id}">${esc(o.notas||'')}</textarea></div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn" onclick="guardarOrden(${o.id})">💾 Guardar</button>${o.status==='pending'?`<button class="btn btn-primary" onclick="iniciarOrden(${o.id})">▶ Iniciar trabajo</button>`:''} ${o.status==='in-progress'?`<button class="btn" onclick="pausarOrden(${o.id})">⏸ Volver a pendiente</button>`:''} ${o.status!=='done'&&o.status!=='delivered'?`<button class="btn btn-success" onclick="terminarOrden(${o.id})">✓ Terminar y notificar</button>`:''} ${o.status==='done'?`<button class="btn" onclick="marcarEntregada(${o.id})">📦 Marcar entregada</button>`:''} ${o.status==='done'||o.status==='delivered'?`<button class="btn btn-sm" onclick="verReporte(${o.id})">Ver reporte</button>`:''} <button class="btn btn-sm" onclick="imprimirRecibo(${o.id})">🖨 Imprimir</button> <button class="btn btn-sm" onclick="mostrarAccionesIngreso(${o.id})">📱 WhatsApp ingreso</button> <button class="btn btn-sm" style="margin-left:auto;color:#E24B4A;border-color:#E24B4A" onclick="eliminarOrden(${o.id})">🗑 Eliminar</button></div>`;
  document.getElementById('modal-orden').style.display='block';
}
function recalcTotal(oid){const o=state.ordenes.find(o=>o.id===oid);if(!o)return;const total=(o.reparaciones||[]).reduce((s,_,i)=>s+(parseFloat(document.getElementById(`rep-p-${oid}-${i}`)?.value)||0),0);const el=document.getElementById('total-'+oid);if(el)el.textContent='$ '+total.toLocaleString('es-CO')}
function agregarRep(oid){const o=state.ordenes.find(o=>o.id===oid);if(!o)return;guardarRepEnMemoria(oid);o.reparaciones.push({codigo:'',desc:'',precio:0});abrirOrden(oid)}
function eliminarRep(oid,idx){const o=state.ordenes.find(o=>o.id===oid);if(!o)return;guardarRepEnMemoria(oid);o.reparaciones.splice(idx,1);abrirOrden(oid)}
function guardarRepEnMemoria(oid){const o=state.ordenes.find(o=>o.id===oid);if(!o)return;o.reparaciones=(o.reparaciones||[]).map((_,i)=>({codigo:document.getElementById(`rep-c-${oid}-${i}`)?.value||'',desc:document.getElementById(`rep-d-${oid}-${i}`)?.value||'',precio:parseFloat(document.getElementById(`rep-p-${oid}-${i}`)?.value)||0}))}
function aplicarEditsEnMemoria(oid){const o=state.ordenes.find(o=>o.id===oid);if(!o)return;const mec=document.getElementById(`edit-mec-${oid}`);const prio=document.getElementById(`edit-prio-${oid}`);const desc=document.getElementById(`edit-desc-${oid}`);const notas=document.getElementById(`notas-${oid}`);if(mec)o.mecanico=mec.value;if(prio)o.prioridad=prio.value;if(desc)o.descripcion=desc.value;if(notas)o.notas=notas.value}

async function guardarOrden(oid){
  const o=state.ordenes.find(o=>o.id===oid);if(!o)return;
  guardarRepEnMemoria(oid);aplicarEditsEnMemoria(oid);
  try{
    await window.db.updateOrden(oid,{mecanico:o.mecanico,prioridad:o.prioridad,descripcion:o.descripcion,notas:o.notas});
    await window.db.setReparaciones(oid,o.reparaciones);
    cerrarModal();await refrescarVista();toast('Orden guardada','success');
  }catch(err){toast('Error: '+err.message,'error')}
}
async function iniciarOrden(oid){const o=state.ordenes.find(o=>o.id===oid);if(!o)return;guardarRepEnMemoria(oid);aplicarEditsEnMemoria(oid);try{await window.db.updateOrden(oid,{mecanico:o.mecanico,prioridad:o.prioridad,descripcion:o.descripcion,notas:o.notas,status:'in-progress'});await window.db.setReparaciones(oid,o.reparaciones);cerrarModal();await refrescarVista();toast('Orden en progreso','info')}catch(err){toast('Error: '+err.message,'error')}}
async function pausarOrden(oid){const o=state.ordenes.find(o=>o.id===oid);if(!o)return;guardarRepEnMemoria(oid);aplicarEditsEnMemoria(oid);try{await window.db.updateOrden(oid,{mecanico:o.mecanico,prioridad:o.prioridad,descripcion:o.descripcion,notas:o.notas,status:'pending'});await window.db.setReparaciones(oid,o.reparaciones);cerrarModal();await refrescarVista();toast('Vuelta a pendiente','info')}catch(err){toast('Error: '+err.message,'error')}}
async function eliminarOrden(oid){if(!confirm('¿Eliminar esta orden? No se puede deshacer.'))return;try{await window.db.deleteOrden(oid);cerrarModal();await refrescarVista();toast('Orden eliminada','success')}catch(err){toast('Error: '+err.message,'error')}}
async function terminarOrden(oid){const o=state.ordenes.find(o=>o.id===oid);if(!o)return;guardarRepEnMemoria(oid);aplicarEditsEnMemoria(oid);try{await window.db.updateOrden(oid,{mecanico:o.mecanico,prioridad:o.prioridad,descripcion:o.descripcion,notas:o.notas,status:'done',fechaTerminado:new Date().toISOString()});await window.db.setReparaciones(oid,o.reparaciones);await refrescarVista();toast(`Orden #${oid} terminada`,'success');verReporte(oid)}catch(err){toast('Error: '+err.message,'error')}}
async function marcarEntregada(oid){try{await window.db.updateOrden(oid,{status:'delivered'});cerrarModal();await refrescarVista()}catch(err){toast('Error: '+err.message,'error')}}
function cerrarModal(){document.getElementById('modal-orden').style.display='none'}

// ===== Mensaje + Reporte =====
function buildMensajeCliente(o){
  const cl=o.checklist||{},reps=o.reparaciones||[];const total=reps.reduce((s,r)=>s+(parseFloat(r.precio)||0),0);
  const emojiPct=v=>{const p=parseInt(v||'0');return p<=25?'🔴':p<=50?'🟡':'🟢'};
  let msg=`Hola ${o.clienteNombre} 👋, tu *${o.bici.marca} ${o.bici.modelo}* ya está lista en *Veloce Bicicletas*.\n\n`;
  msg+=`📋 *Trabajo realizado:* ${(o.tiposTrabajo||[]).join(', ')}\n\n`;
  if(reps.length>0){msg+=`🔧 *Detalle del servicio:*\n`;reps.forEach(r=>{if(r.desc)msg+=`• ${r.desc}: $${(parseFloat(r.precio)||0).toLocaleString('es-CO')}\n`});msg+=`\n💰 *Total: $${total.toLocaleString('es-CO')}*\n\n`}
  if([cl.cadena,cl.frenoDel,cl.frenoTras,cl.llantaDel,cl.llantaTras].some(Boolean)){
    msg+=`📊 *Estado de tu bicicleta:*\n`;
    if(cl.cadena)msg+=`${emojiPct(cl.cadena)} Cadena: ${cl.cadena}\n`;
    if(cl.frenoDel)msg+=`${emojiPct(cl.frenoDel)} Freno delantero: ${cl.frenoDel}\n`;
    if(cl.frenoTras)msg+=`${emojiPct(cl.frenoTras)} Freno trasero: ${cl.frenoTras}\n`;
    if(cl.llantaDel)msg+=`${emojiPct(cl.llantaDel)} Llanta delantera: ${cl.llantaDel}\n`;
    if(cl.llantaTras)msg+=`${emojiPct(cl.llantaTras)} Llanta trasera: ${cl.llantaTras}\n`;msg+=`\n`;
  }
  if([cl.torqueSillin,cl.torqueEspiga,cl.torqueManubrio].some(Boolean)){msg+=`🔩 *Torques aplicados:*\n`;if(cl.torqueSillin)msg+=`• Tubo de sillín: ${cl.torqueSillin}\n`;if(cl.torqueEspiga)msg+=`• Espiga tija: ${cl.torqueEspiga}\n`;if(cl.torqueManubrio)msg+=`• Espiga manubrio: ${cl.torqueManubrio}\n`;msg+=`\n`}
  if(o.notas)msg+=`💬 *Nota del mecánico:* ${o.notas}\n\n`;
  msg+=`¡Te esperamos en el taller para que la recojas! 🚴‍♂️\n\n`;
  msg+=`⚠️ *Nota:* A partir del tercer día después de finalizado el servicio, se cobrarán *$1.500 pesos diarios* por concepto de bodegaje.`;
  return msg;
}
function verReporte(oid){
  const o=state.ordenes.find(o=>o.id===oid);if(!o)return;
  const msg=buildMensajeCliente(o),cl=o.checklist||{},reps=o.reparaciones||[];const total=reps.reduce((s,r)=>s+(parseFloat(r.precio)||0),0);
  function pctBar(val){if(!val)return'<span style="font-size:11px;color:#888">No registrado</span>';const p=parseInt(val);const col=p<=25?'#E24B4A':p<=50?'#EF9F27':p<=75?'#639922':'#1D9E75';return`<div style="display:flex;align-items:center;gap:6px;flex:1"><div class="bar-wrap"><div class="bar-fill" style="width:${p}%;background:${col}"></div></div><span class="pct-val" style="color:${col}">${val}</span></div>`}
  document.getElementById('modal-titulo').textContent=`Reporte cliente — Orden #${o.id}`;
  document.getElementById('modal-contenido').innerHTML=`<div class="report-block"><div class="report-title">${esc(o.bici.marca)} ${esc(o.bici.modelo)}${o.bici.color?' · '+esc(o.bici.color):''}</div><div class="meta">${esc(o.clienteNombre)} · ${fmtDate(o.creado)}</div><div style="margin-top:6px;font-size:12px"><strong>Trabajo:</strong> ${esc((o.tiposTrabajo||[]).join(', '))}</div></div>${[['cadena','Cadena'],['frenoDel','Freno delantero'],['frenoTras','Freno trasero'],['llantaDel','Llanta delantera'],['llantaTras','Llanta trasera']].some(([f])=>cl[f])?`<div class="report-block"><div class="report-title">Estado de la bicicleta</div>${[['cadena','Cadena'],['frenoDel','Freno delantero'],['frenoTras','Freno trasero'],['llantaDel','Llanta delantera'],['llantaTras','Llanta trasera']].filter(([f])=>cl[f]).map(([f,l])=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:12px;min-width:140px">${l}</span>${pctBar(cl[f])}</div>`).join('')}</div>`:''} ${[cl.torqueSillin,cl.torqueEspiga,cl.torqueManubrio].some(Boolean)?`<div class="report-block"><div class="report-title">Torques aplicados</div>${cl.torqueSillin?`<div class="meta" style="margin-bottom:4px">Tubo de sillín: <strong>${esc(cl.torqueSillin)}</strong></div>`:''} ${cl.torqueEspiga?`<div class="meta" style="margin-bottom:4px">Espiga tija: <strong>${esc(cl.torqueEspiga)}</strong></div>`:''} ${cl.torqueManubrio?`<div class="meta">Espiga manubrio: <strong>${esc(cl.torqueManubrio)}</strong></div>`:''}</div>`:''} ${reps.length>0?`<div class="report-block"><div class="report-title">Servicios y repuestos</div>${reps.filter(r=>r.desc).map(r=>`<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>${esc(r.desc)}</span><span style="font-weight:500">$ ${(parseFloat(r.precio)||0).toLocaleString('es-CO')}</span></div>`).join('')}<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:500;border-top:0.5px solid #e0e0e0;padding-top:8px;margin-top:8px"><span>Total</span><span>$ ${total.toLocaleString('es-CO')}</span></div></div>`:''} ${o.notas?`<div class="report-block"><div class="report-title">Nota del mecánico</div><div style="font-size:13px">${esc(o.notas)}</div></div>`:''}<div style="margin-top:12px"><label style="margin-bottom:6px">Mensaje WhatsApp</label><textarea id="msg-wp" style="min-height:120px;font-size:12px">${esc(msg)}</textarea><div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><a class="btn btn-sm wa-btn" href="${waLink(o.clienteTel,msg)}" target="_blank" rel="noopener">📱 Abrir WhatsApp</a><button class="btn btn-sm" onclick="copiarMensaje()">Copiar mensaje</button></div></div>`;
}
function copiarMensaje(){const el=document.getElementById('msg-wp');if(el){navigator.clipboard.writeText(el.value).then(()=>toast('Mensaje copiado','success')).catch(()=>{el.select();document.execCommand('copy');toast('Mensaje copiado','success')})}}

// ===== Historial =====
function renderHistorial(){buscarHistorial()}
function buscarHistorial(){
  const q=(document.getElementById('hist-search')?.value||'').toLowerCase();const div=document.getElementById('hist-resultados');
  const clientes=q?state.clientes.filter(c=>c.nombre.toLowerCase().includes(q)||String(c.id).toLowerCase().includes(q)||String(c.tel||'').toLowerCase().includes(q)||(c.bicicletas||[]).some(b=>(b.marca+' '+b.modelo+' '+(b.color||'')+' '+(b.serie||'')).toLowerCase().includes(q))):state.clientes;
  if(!clientes.length){div.innerHTML='<div class="empty">Sin resultados</div>';return}
  div.innerHTML=clientes.map(cli=>{const ords=state.ordenes.filter(o=>o._clienteUuid===cli._uuid);const cid=encodeURIComponent(cli.id);return`<div class="card"><div class="card-header"><div style="cursor:pointer;flex:1" onclick="toggleHist('hc-${cid}')"><h3>${esc(cli.nombre)}</h3><div class="meta">${esc(cli.tel)} · ${ords.length} servicio(s)</div></div><div style="display:flex;gap:4px"><a class="btn btn-sm wa-btn" href="${waLink(cli.tel,'Hola '+cli.nombre)}" target="_blank" rel="noopener" style="padding:2px 8px;font-size:11px">📱</a><button class="btn btn-sm" onclick="editarCliente('${esc(cli.id)}')">✏</button><button class="btn btn-sm" style="color:#E24B4A;border-color:#E24B4A" onclick="eliminarCliente('${esc(cli.id)}')">🗑</button></div></div><div id="hc-${cid}" style="display:none"><hr class="divider">${(cli.bicicletas||[]).map((b,bi)=>{const bo=ords.filter(o=>o._biciUuid===b._id);return`<div class="hist-bici"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="font-weight:500;font-size:13px">${esc(b.marca)} ${esc(b.modelo)}${b.color?' · '+esc(b.color):''}${b.año?' ('+esc(b.año)+')':''}</div><button class="btn btn-sm" style="color:#E24B4A;border-color:#E24B4A;padding:2px 6px" onclick="eliminarBici('${b._id}')">🗑</button></div>${bo.map(o=>`<div class="hist-entry"><div style="display:flex;justify-content:space-between"><span style="font-size:12px;font-weight:500">#${o.id} · ${fmtDate(o.creado)}</span><span class="status s-${o.status}">${statusLabel(o.status)}</span></div><div class="meta">${esc((o.tiposTrabajo||[]).join(', '))}</div>${o.reparaciones&&o.reparaciones.length?`<div class="meta">${esc(o.reparaciones.map(r=>r.desc).filter(Boolean).join(', '))}</div>`:''}<button class="btn btn-sm" style="margin-top:4px" onclick="abrirOrden(${o.id})">Ver detalle</button></div>`).join('')}</div>`}).join('')}</div></div>`}).join('');
}
function editarCliente(cid){
  const c=state.clientes.find(x=>x.id===cid);if(!c)return;
  document.getElementById('ec-cid').value=cid;
  document.getElementById('ec-uuid').value=c._uuid||'';
  document.getElementById('ec-nombre').value=c.nombre||'';
  document.getElementById('ec-tel').value=c.tel||'';
  document.getElementById('ec-email').value=c.email||'';
  document.getElementById('ec-cedula-display').value=c._cedula||'Sin cédula';
  const msg=document.getElementById('ec-msg');msg.style.display='none';msg.textContent='';
  document.getElementById('ec-save-btn').disabled=false;
  document.getElementById('modal-editar-cliente').style.display='block';
}
function cerrarModalEditarCliente(){document.getElementById('modal-editar-cliente').style.display='none'}
async function guardarEdicionCliente(){
  const uuid=document.getElementById('ec-uuid').value;
  const nombre=document.getElementById('ec-nombre').value.trim();
  const tel=document.getElementById('ec-tel').value.trim();
  const email=document.getElementById('ec-email').value.trim();
  const msg=document.getElementById('ec-msg');
  if(!nombre){msg.style.display='block';msg.style.background='#fef2f2';msg.style.color='#b91c1c';msg.textContent='El nombre es obligatorio.';return}
  const btn=document.getElementById('ec-save-btn');btn.disabled=true;btn.textContent='Guardando...';
  try{
    await window.db.updateClienteByUuid(uuid,{nombre,tel,email});
    await refrescarVista();
    cerrarModalEditarCliente();
    toast('Cliente actualizado','success');
  }catch(err){
    msg.style.display='block';msg.style.background='#fef2f2';msg.style.color='#b91c1c';msg.textContent='Error: '+err.message;
    btn.disabled=false;btn.textContent='Guardar cambios';
  }
}
async function eliminarCliente(cid){
  const ords=state.ordenes.filter(o=>o.clienteId===cid).length;
  if(!confirm(`¿Eliminar cliente y sus ${ords} orden(es)? No se puede deshacer.`))return;
  try{await window.db.deleteClienteByCedula(cid);await refrescarVista();toast('Cliente eliminado','success')}catch(err){toast('Error: '+err.message,'error')}
}
async function eliminarBici(biciUuid){
  if(!confirm('¿Eliminar esta bicicleta?'))return;
  try{await window.db.deleteBici(biciUuid);await refrescarVista();toast('Bicicleta eliminada','success')}catch(err){toast('Error: '+err.message,'error')}
}
function toggleHist(id){const el=document.getElementById(id);if(el)el.style.display=el.style.display==='none'?'block':'none'}

// ===== Alertas =====
function getAlertas(){
  const ahora=new Date(),al=[];
  state.ordenes.forEach(o=>{
    if((o.status==='done'||o.status==='delivered')&&!o.recordatorioEnviado){const dias=Math.floor((ahora-new Date(o.fechaTerminado||o.creado))/86400000);if(dias>=45)al.push({tipo:'record45',orden:o,dias})}
    if(o.status==='done'){const dias=Math.floor((ahora-new Date(o.fechaTerminado||o.creado))/86400000);if(dias>=3)al.push({tipo:'sinrecoger',orden:o,dias})}
  });return al;
}
function renderNotif(){
  const al=getAlertas(),div=document.getElementById('alertas-lista');
  if(!al.length){div.innerHTML=`<div class="card"><div class="empty">Sin alertas pendientes</div></div><div class="card"><div class="card-header"><h2>Recordatorios automáticos</h2></div><div style="font-size:13px;color:#888">A los 45 días del último servicio se genera el recordatorio de mantenimiento para WhatsApp.</div></div>`;return}
  div.innerHTML=`<div class="card"><div class="card-header"><h2>Alertas (${al.length})</h2></div>${al.map(a=>`<div class="notif"><div style="flex:1">${a.tipo==='record45'?`<div style="font-weight:500;font-size:12px">Recordatorio — ${esc(a.orden.clienteNombre)}</div><div>Han pasado ${a.dias} días · Orden #${a.orden.id} · ${esc(a.orden.bici.marca)} ${esc(a.orden.bici.modelo)}</div><button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="marcarRecordatorio(${a.orden.id})">Marcar enviado</button>`:`<div style="font-weight:500;font-size:12px">Sin recoger — ${esc(a.orden.clienteNombre)}</div><div>Orden #${a.orden.id} terminada hace ${a.dias} días</div><button class="btn btn-sm" style="margin-top:4px" onclick="abrirOrden(${a.orden.id})">Ver orden</button>`}</div></div>`).join('')}</div>`;
}
async function marcarRecordatorio(oid){try{await window.db.updateOrden(oid,{recordatorioEnviado:true});await refrescarVista()}catch(err){toast('Error: '+err.message,'error')}}

// ===== Búsqueda global =====
function busquedaGlobal(q){
  const div=document.getElementById('search-results');q=(q||'').trim().toLowerCase();
  if(!q){div.style.display='none';return}
  const resultados=[];
  const numMatch=q.match(/^#?(\d+)$/);
  if(numMatch){const id=parseInt(numMatch[1]);const o=state.ordenes.find(o=>o.id===id);if(o)resultados.push({tipo:'orden',orden:o})}
  state.ordenes.forEach(o=>{if(resultados.some(r=>r.orden&&r.orden.id===o.id))return;const t=(o.clienteNombre+' '+(o.clienteTel||'')+' '+o.bici.marca+' '+o.bici.modelo+' '+(o.bici.color||'')+' '+(o.bici.serie||'')+' '+(o.tiposTrabajo||[]).join(' ')+' '+(o.descripcion||'')).toLowerCase();if(t.includes(q))resultados.push({tipo:'orden',orden:o})});
  state.clientes.forEach(c=>{const t=(c.nombre+' '+c.id+' '+(c.tel||'')).toLowerCase();if(t.includes(q))resultados.push({tipo:'cliente',cliente:c})});
  const limitados=resultados.slice(0,15);
  if(!limitados.length){div.innerHTML='<div class="search-result"><span class="meta">Sin resultados</span></div>';div.style.display='block';return}
  div.innerHTML=limitados.map(r=>{if(r.tipo==='orden'){const o=r.orden;return`<div class="search-result" onclick="irAOrden(${o.id})"><span class="search-result-type">Orden</span><strong>#${o.id}</strong> · ${esc(o.bici.marca)} ${esc(o.bici.modelo)} <span class="status s-${o.status}">${statusLabel(o.status)}</span><div class="meta">${esc(o.clienteNombre)} · ${fmtDate(o.creado)}</div></div>`}else{const c=r.cliente;const ords=state.ordenes.filter(o=>o._clienteUuid===c._uuid);return`<div class="search-result" onclick="irACliente('${esc(c.id)}')"><span class="search-result-type">Cliente</span><strong>${esc(c.nombre)}</strong><div class="meta">${esc(c.tel)} · ${ords.length} orden(es)</div></div>`}}).join('');
  div.style.display='block';
}
function irAOrden(oid){document.getElementById('search-results').style.display='none';document.getElementById('global-search').value='';abrirOrden(oid)}
function irACliente(cid){document.getElementById('search-results').style.display='none';document.getElementById('global-search').value='';showView('historial');setTimeout(()=>{document.getElementById('hist-search').value=state.clientes.find(c=>c.id===cid)?.nombre||'';buscarHistorial();const el=document.getElementById('hc-'+encodeURIComponent(cid));if(el)el.style.display='block'},100)}

// ===== Imprimir recibo =====
function imprimirRecibo(oid){
  const o=state.ordenes.find(o=>o.id===oid);if(!o)return;
  const reps=o.reparaciones||[];const total=reps.reduce((s,r)=>s+(parseFloat(r.precio)||0),0);
  const w=window.open('','_blank','width=600,height=800');if(!w){toast('Habilita popups para imprimir','error');return}
  const html=`<!DOCTYPE html><html><head><title>Recibo orden #${o.id}</title><style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
  body{padding:24px;color:#111;max-width:500px;margin:0 auto;font-size:13px}
  .logo{text-align:center;border-bottom:2px solid #D85A30;padding-bottom:12px;margin-bottom:16px}
  .logo h1{font-size:22px;color:#D85A30;letter-spacing:1px}
  .logo p{font-size:11px;color:#888;margin-top:2px}
  .row{display:flex;justify-content:space-between;margin-bottom:6px}
  .row strong{min-width:100px;display:inline-block}
  h2{font-size:14px;margin:14px 0 6px;padding-bottom:4px;border-bottom:0.5px solid #ccc}
  .box{background:#f5f5f5;padding:10px;border-radius:6px;margin-bottom:10px;font-size:12px}
  .total{display:flex;justify-content:space-between;font-size:16px;font-weight:600;border-top:1px solid #111;padding-top:8px;margin-top:8px}
  .footer{text-align:center;margin-top:20px;padding-top:12px;border-top:0.5px dashed #999;font-size:11px;color:#666}
  .orden-num{text-align:center;font-size:18px;font-weight:600;margin:8px 0;background:#FAECE7;padding:8px;border-radius:6px;color:#4A1B0C}
  @media print{body{padding:0;max-width:none}button{display:none}}
  .noprint{text-align:center;margin-top:16px}
  .btn-print{background:#D85A30;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;margin:0 4px}
  </style></head><body>
  <div class="logo"><h1>VELOCE BICICLETAS</h1><p>Taller especializado · Medellín</p></div>
  <div class="orden-num">RECIBO DE INGRESO · ORDEN #${o.id}</div>
  <div style="text-align:center;margin:10px 0"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent('VELOCE#'+o.id)}" alt="QR" style="width:110px;height:110px" onerror="this.style.display='none'"><div style="font-size:10px;color:#888;margin-top:4px">Código: VELOCE#${o.id}</div></div>
  <div class="row"><strong>Fecha:</strong><span>${new Date(o.creado).toLocaleString('es-CO')}</span></div>
  <div class="row"><strong>Prioridad:</strong><span>${esc(o.prioridad)}</span></div>
  <div class="row"><strong>Mecánico:</strong><span>${esc(o.mecanico)}</span></div>
  ${o.duracionMinutos?`<div class="row"><strong>Duración:</strong><span>${fmtDur(o.duracionMinutos)}</span></div>`:''}
  ${o.fechaCompromiso?`<div class="row"><strong>Entrega:</strong><span>${fmtFechaHora(new Date(o.fechaCompromiso))}</span></div>`:''}
  <h2>Cliente</h2>
  <div class="box"><div class="row"><strong>Nombre:</strong><span>${esc(o.clienteNombre)}</span></div><div class="row"><strong>Teléfono:</strong><span>${esc(o.clienteTel)}</span></div></div>
  <h2>Bicicleta</h2>
  <div class="box"><div class="row"><strong>Marca:</strong><span>${esc(o.bici.marca)}</span></div><div class="row"><strong>Modelo:</strong><span>${esc(o.bici.modelo)}</span></div>${o.bici.color?`<div class="row"><strong>Color:</strong><span>${esc(o.bici.color)}</span></div>`:''}${o.bici.serie?`<div class="row"><strong>No. serie:</strong><span>${esc(o.bici.serie)}</span></div>`:''}${o.bici.año?`<div class="row"><strong>Año:</strong><span>${esc(o.bici.año)}</span></div>`:''}</div>
  <h2>Trabajo solicitado</h2>
  <div class="box">${esc((o.tiposTrabajo||[]).join(' · '))}${o.descripcion?`<div style="margin-top:8px;padding-top:8px;border-top:0.5px solid #ccc;font-style:italic">${esc(o.descripcion)}</div>`:''}</div>
  ${reps.length>0&&total>0?`<h2>Servicios realizados</h2><div class="box">${reps.filter(r=>r.desc).map(r=>`<div class="row"><span>${esc(r.desc)}</span><span>$ ${(parseFloat(r.precio)||0).toLocaleString('es-CO')}</span></div>`).join('')}<div class="total"><span>TOTAL</span><span>$ ${total.toLocaleString('es-CO')}</span></div></div>`:''}
  <div class="footer">Conserve este recibo para retirar su bicicleta.<br>Gracias por confiar en Veloce Bicicletas 🚴</div>
  <div class="noprint"><button class="btn-print" onclick="window.print()">🖨 Imprimir</button><button class="btn-print" style="background:#888" onclick="window.close()">Cerrar</button></div>
  </body></html>`;
  w.document.write(html);w.document.close();setTimeout(()=>w.print(),400);
}

// ===== Caja =====
function renderCaja(){
  const div=document.getElementById('caja-contenido');
  const now=new Date(),hoy=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const iniSem=new Date(hoy);iniSem.setDate(hoy.getDate()-((hoy.getDay()+6)%7));
  const iniMes=new Date(now.getFullYear(),now.getMonth(),1);
  const facturables=state.ordenes.filter(o=>o.status==='done'||o.status==='delivered');
  function rangoStats(desde){const ord=facturables.filter(o=>new Date(o.fechaTerminado||o.actualizado||o.creado)>=desde);return{count:ord.length,total:ord.reduce((s,o)=>s+totalOrden(o),0),ordenes:ord}}
  const sHoy=rangoStats(hoy),sSem=rangoStats(iniSem),sMes=rangoStats(iniMes);
  const pendCobro=state.ordenes.filter(o=>o.status==='done');
  const totalPendCobro=pendCobro.reduce((s,o)=>s+totalOrden(o),0);
  const fmt=n=>'$ '+n.toLocaleString('es-CO');
  function card(titulo,stats,color){return`<div class="card" style="border-left:3px solid ${color}"><div class="meta" style="text-transform:uppercase;letter-spacing:.5px;font-size:10px">${titulo}</div><div style="font-size:22px;font-weight:500;margin:4px 0">${fmt(stats.total)}</div><div class="meta">${stats.count} orden(es)</div></div>`}
  const statsMec=statsMecanicos();
  div.innerHTML=`<div class="grid3">${card('Hoy',sHoy,'#1D9E75')}${card('Esta semana',sSem,'#185FA5')}${card('Este mes',sMes,'#D85A30')}</div>
  <div class="card"><div class="card-header"><h2>Pendientes de cobro</h2><span class="meta">${pendCobro.length} orden(es) · ${fmt(totalPendCobro)}</span></div>${pendCobro.length===0?'<div class="empty">Todo cobrado ✓</div>':pendCobro.map(o=>`<div class="work-item done" onclick="abrirOrden(${o.id})"><div style="display:flex;justify-content:space-between"><span style="font-weight:500;font-size:13px">#${o.id} · ${esc(o.clienteNombre)}</span><span style="font-weight:500">${fmt(totalOrden(o))}</span></div><div class="meta">${esc(o.bici.marca)} ${esc(o.bici.modelo)} · terminada ${fmtDate(o.fechaTerminado||o.creado)}</div></div>`).join('')}</div>
  <div class="card"><div class="card-header"><h2>Producción por mecánico</h2><span class="meta">Último mes</span></div>${statsMec.length===0?'<div class="empty">Sin datos</div>':statsMec.map(m=>`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:500;font-size:13px">${esc(m.nombre)}</span><span style="font-weight:500;font-size:13px">${fmt(m.total)}</span></div><div style="display:flex;align-items:center;gap:8px"><div class="bar-wrap"><div class="bar-fill" style="width:${m.pct}%;background:#185FA5"></div></div><span class="meta">${m.count} órdenes</span></div></div>`).join('')}</div>
  <div class="card"><div class="card-header"><h2>Órdenes facturadas del mes</h2><button class="btn btn-sm" onclick="exportarCajaCSV()">⬇ CSV</button></div>${sMes.ordenes.length===0?'<div class="empty">Sin movimientos este mes</div>':sMes.ordenes.slice().reverse().map(o=>`<div class="work-item done" onclick="abrirOrden(${o.id})"><div style="display:flex;justify-content:space-between"><span style="font-size:13px">#${o.id} · ${esc(o.clienteNombre)}</span><span style="font-weight:500">${fmt(totalOrden(o))}</span></div><div class="meta">${fmtDate(o.fechaTerminado||o.creado)} · ${esc(o.bici.marca)} ${esc(o.bici.modelo)}</div></div>`).join('')}</div>`;
}
function statsMecanicos(){
  const now=new Date(),iniMes=new Date(now.getFullYear(),now.getMonth(),1);
  const ords=state.ordenes.filter(o=>(o.status==='done'||o.status==='delivered')&&new Date(o.fechaTerminado||o.creado)>=iniMes);
  const by={};
  ords.forEach(o=>{const m=o.mecanico||'Sin asignar';if(!by[m])by[m]={nombre:m,count:0,total:0};by[m].count++;by[m].total+=totalOrden(o)});
  const arr=Object.values(by).sort((a,b)=>b.total-a.total);
  const max=Math.max(1,...arr.map(m=>m.total));
  arr.forEach(m=>m.pct=Math.round(m.total/max*100));
  return arr;
}
function csvEscape(v){const s=String(v==null?'':v);return/[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportarCajaCSV(){
  const now=new Date(),iniMes=new Date(now.getFullYear(),now.getMonth(),1);
  const ords=state.ordenes.filter(o=>(o.status==='done'||o.status==='delivered')&&new Date(o.fechaTerminado||o.creado)>=iniMes);
  if(!ords.length){toast('No hay órdenes facturadas este mes','error');return}
  const headers=['Orden','Fecha terminada','Cliente','Teléfono','Marca','Modelo','Color','Mecánico','Tipo trabajo','Servicios','Total','Estado'];
  const rows=ords.map(o=>[o.id,new Date(o.fechaTerminado||o.creado).toLocaleDateString('es-CO'),o.clienteNombre,o.clienteTel,o.bici.marca,o.bici.modelo,o.bici.color||'',o.mecanico,(o.tiposTrabajo||[]).join(' | '),(o.reparaciones||[]).filter(r=>r.desc).map(r=>`${r.desc} ($${r.precio})`).join(' | '),totalOrden(o),statusLabel(o.status)]);
  const total=ords.reduce((s,o)=>s+totalOrden(o),0);
  rows.push(['','','','','','','','','','TOTAL',total,'']);
  const csv='\ufeff'+[headers,...rows].map(r=>r.map(csvEscape).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`veloce-caja-${now.toISOString().slice(0,7)}.csv`;a.click();URL.revokeObjectURL(url);toast(`${ords.length} órdenes exportadas`,'success');
}

// ===== PWA =====
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})})}

// ===== Init =====
init();
