// ========================================================
// Veloce Taller — App principal (Supabase backend)
// ========================================================

const TIPOS_TRABAJO=['Mantenimiento ruta/MTB','Mantenimiento ebike','Mantenimiento suspensión','Alistada','Lavada','Encerar cadena','Parchada','Cambio de llanta','Cambio de neumático','Armada','Desarmada','Otro'];
const HORARIO_TALLER={0:[],1:[[600,720],[780,1140]],2:[[600,720],[780,1140]],3:[[660,780],[840,1140]],4:[[600,720],[780,1140]],5:[[600,720],[780,1140]],6:[[660,1020]]};
const DURACION_MIN={'Mantenimiento':180,'Mantenimiento ruta/MTB':180,'Mantenimiento ebike':240,'Mantenimiento suspensión':180,'Lavada':20,'Alistada':90,'Encerar cadena':30,'Parchada':30,'Cambio de llanta':30,'Cambio de neumático':30,'Armada':120,'Desarmada':90};

// Estado en memoria (cache, se sincroniza con Supabase)
let state = { clientes: [], ordenes: [], mecanicos: ['Carlos','Andrés','Juan'], nextId: 1001, consignaciones: [] };
let selectedTipos=[], currentView='asesor', mecFilter='pending', clienteActivo=null, biciActiva=null;
let progDiaSel=null, progModo='estado', _ordenAbierta=null;
let fotosIngreso=[];

// ===== Helpers =====
function esc(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
// Escapa un valor para usarlo dentro de una cadena JS entre comillas simples, en un atributo HTML (ej: onclick="fn('...')")
function jsStr(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\r\n]/g,' ')}
function toast(msg,type){const w=document.getElementById('toast-wrap');if(!w)return;const t=document.createElement('div');t.className='toast '+(type||'info');t.textContent=msg;w.appendChild(t);setTimeout(()=>{t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(()=>t.remove(),300)},2500)}
function waLink(tel,msg){const clean=String(tel||'').replace(/\D/g,'');const num=clean.length===10?'57'+clean:clean;return`https://wa.me/${num}?text=${encodeURIComponent(msg)}`}
function fmtDate(iso){return new Date(iso).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'})}
function statusLabel(s){return{pending:'Pendiente','in-progress':'En progreso','waiting-parts':'Esperando repuesto',done:'Terminada',delivered:'Entregada'}[s]||s}
function totalOrden(o){return(o.reparaciones||[]).reduce((s,r)=>s+(parseFloat(r.precio)||0),0)}
const SKU_MANO_OBRA='17598'; // SKU de taller / mano de obra
function esManoDeObra(codigo){return String(codigo||'').trim().replace(/\/+$/,'').trim()===SKU_MANO_OBRA}
function manoObraOrden(o){return(o.reparaciones||[]).filter(r=>esManoDeObra(r.codigo)).reduce((s,r)=>s+(parseFloat(r.precio)||0),0)}
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
  const rank=o=>o.status==='in-progress'?0:1; // en progreso va primero (ya está en el banco)
  const cola=state.ordenes.filter(o=>o.status==='pending'||o.status==='in-progress').sort((a,b)=>rank(a)-rank(b)||(prio[a.prioridad]??1)-(prio[b.prioridad]??1)||new Date(a.creado)-new Date(b.creado));
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
  const views=['asesor','mecanico','programacion','caja','historial','consignacion','notif'];
  views.forEach(x=>document.getElementById('view-'+x).style.display=x===v?'block':'none');
  document.querySelectorAll('.nav-btn').forEach((b,i)=>b.classList.toggle('active',views[i]===v));
  if(v==='mecanico')renderMecanico();if(v==='programacion')renderProgramacion();if(v==='historial')renderHistorial();if(v==='notif')renderNotif();if(v==='asesor')renderOrdenesRecientes();if(v==='caja')renderCaja();if(v==='consignacion')renderConsignacion();
  updateBadges();
}
function updateBadges(){
  const pend=state.ordenes.filter(o=>o.status==='pending').length;
  const mb=document.getElementById('mec-badge');if(mb){mb.textContent=pend;mb.style.display=pend>0?'':'none'}
  const pb=document.getElementById('prog-badge');if(pb){const cP=calcularCola();const hoyD=new Date();let pt=0;state.ordenes.forEach(o=>{if(o.status==='pending'||o.status==='in-progress'){const e=cP.get(o.id);const f=o.diaProgramado?new Date(o.diaProgramado+'T00:00:00'):(e?e.fin:(o.fechaCompromiso?new Date(o.fechaCompromiso):null));if(f&&_mismoDia(f,hoyD))pt++}});pb.textContent=pt;pb.style.display=pt>0?'':'none'}
  const al=getAlertas().length;const nb=document.getElementById('notif-badge');if(nb){nb.textContent=al;nb.style.display=al>0?'':'none'}
  const disp=(state.consignaciones||[]).filter(c=>c.status==='disponible').length;
  const cb=document.getElementById('cons-badge');if(cb){cb.textContent=disp;cb.style.display=disp>0?'':'none'}
}
async function refrescarVista(){
  await reloadState();
  if(currentView==='mecanico')renderMecanico();
  if(currentView==='programacion')renderProgramacion();
  if(currentView==='caja')renderCaja();
  if(currentView==='historial')renderHistorial();
  if(currentView==='asesor')renderOrdenesRecientes();
  if(currentView==='notif')renderNotif();
  if(currentView==='consignacion')renderConsignacion();
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
    document.getElementById('cliente-datos').innerHTML=clienteDatosHTML(cli);
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
function filtrarMec(f){mecFilter=f;const order=['pending','in-progress','waiting-parts','done','all'];document.querySelectorAll('#view-mecanico .tab').forEach((t,i)=>t.classList.toggle('active',order[i]===f));renderMecanico()}
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

// ===== Programación (Agenda + Kanban) =====
function _localKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function _mismoDia(a,b){return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
function minutosDisponibles(date){
  const slots=HORARIO_TALLER[date.getDay()]||[];const ahora=new Date();const esHoy=_mismoDia(date,ahora);
  const nowMin=esHoy?ahora.getHours()*60+ahora.getMinutes():0;let total=0;
  for(const [s,e] of slots){const ini=Math.max(s,esHoy?nowMin:0);if(e>ini)total+=e-ini}
  return total;
}
function filtrarProgDia(key){progDiaSel=key;renderProgramacion()}
function setProgModo(m){progModo=m;renderProgramacion()}
async function reasignarMecanico(oid,mec){
  const o=state.ordenes.find(o=>o.id===oid);if(!o)return;
  try{await window.db.updateOrden(oid,{mecanico:mec});o.mecanico=mec;renderProgramacion();toast('Reasignada a '+mec,'info')}catch(err){toast('Error: '+err.message,'error')}
}
function proximosDiasHabiles(n){const out=[];const c=new Date();c.setHours(0,0,0,0);let g=0;while(out.length<n&&g<45){g++;if((HORARIO_TALLER[c.getDay()]||[]).length)out.push(new Date(c));c.setDate(c.getDate()+1)}return out}
function _labelDiaKey(k){const d=new Date(k+'T00:00:00');const h=new Date();h.setHours(0,0,0,0);const m=new Date(h.getTime()+86400000);return _mismoDia(d,h)?'Hoy':_mismoDia(d,m)?'Mañana':d.toLocaleDateString('es-CO',{weekday:'short',day:'2-digit',month:'short'})}
async function setDiaProgramado(oid,val){
  const o=state.ordenes.find(o=>o.id===oid);if(!o)return;
  try{
    await window.db.updateOrden(oid,{diaProgramado:val||null});
    o.diaProgramado=val||null;
    renderProgramacion();updateBadges();
    toast(val?('Reprogramada a '+_labelDiaKey(val)):'Programación automática','info');
  }catch(err){toast('Error: '+err.message,'error')}
}

async function cambiarEstadoOrden(oid,estado,opts){
  opts=opts||{};const o=state.ordenes.find(o=>o.id===oid);if(!o)return;
  if(opts.guardar){guardarRepEnMemoria(oid);aplicarEditsEnMemoria(oid)}
  const patch={status:estado};
  if(estado==='done'&&!o.fechaTerminado)patch.fechaTerminado=new Date().toISOString();
  if(opts.guardar)Object.assign(patch,{mecanico:o.mecanico,prioridad:o.prioridad,descripcion:o.descripcion,notas:o.notas});
  try{
    await window.db.updateOrden(oid,patch);
    if(opts.guardar)await window.db.setReparaciones(oid,o.reparaciones);
    if(opts.cerrar)cerrarModal();
    await refrescarVista();
    toast('→ '+statusLabel(estado),'info');
  }catch(err){toast('Error: '+err.message,'error')}
}

function progCard(o,finDe,modo){
  modo=modo||'estado';
  const fin=finDe(o);
  const activa=o.status==='pending'||o.status==='in-progress';
  const atrasada=activa&&!o.diaProgramado&&fin&&fin<new Date();
  const urg=o.prioridad==='urgente'?'<span class="kb-urg">⚡</span>':'';
  let acc='';
  if(o.status==='pending')acc=`<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();cambiarEstadoOrden(${o.id},'in-progress')">▶ Iniciar</button><button class="btn btn-sm" onclick="event.stopPropagation();cambiarEstadoOrden(${o.id},'waiting-parts')">⏸ Repuesto</button>`;
  else if(o.status==='in-progress')acc=`<button class="btn btn-sm btn-success" onclick="event.stopPropagation();cambiarEstadoOrden(${o.id},'done')">✓ Terminar</button><button class="btn btn-sm" onclick="event.stopPropagation();cambiarEstadoOrden(${o.id},'waiting-parts')">⏸ Repuesto</button>`;
  else if(o.status==='waiting-parts')acc=`<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();cambiarEstadoOrden(${o.id},'in-progress')">▶ Reanudar</button><button class="btn btn-sm" onclick="event.stopPropagation();cambiarEstadoOrden(${o.id},'pending')">↩ Pendiente</button>`;
  else if(o.status==='done')acc=`<button class="btn btn-sm" onclick="event.stopPropagation();cambiarEstadoOrden(${o.id},'delivered')">📦 Entregar</button><button class="btn btn-sm" onclick="event.stopPropagation();cambiarEstadoOrden(${o.id},'in-progress')">↩ Reabrir</button>`;
  // Selector de día (solo órdenes activas)
  let diaSel='';
  if(activa){
    const opts=proximosDiasHabiles(10);
    const keys=opts.map(_localKey);
    let inner=`<option value="">📅 Auto</option>`;
    if(o.diaProgramado&&!keys.includes(o.diaProgramado))inner+=`<option value="${o.diaProgramado}" selected>📌 ${_labelDiaKey(o.diaProgramado)}</option>`;
    inner+=opts.map(d=>{const k=_localKey(d);return `<option value="${k}" ${o.diaProgramado===k?'selected':''}>${_labelDiaKey(k)}</option>`}).join('');
    diaSel=`<select class="kb-day" onclick="event.stopPropagation()" onchange="setDiaProgramado(${o.id},this.value)">${inner}</select>`;
  }
  const diaInfo=o.diaProgramado
    ?`<div class="kb-card-meta kb-pin">📌 Fijada: ${_labelDiaKey(o.diaProgramado)}</div>`
    :(activa&&fin?`<div class="kb-card-meta" style="color:#185FA5">📅 ${fmtFechaHora(fin)}</div>`:'');
  const statusBadge=modo==='mecanico'?`<span class="status s-${o.status}" style="font-size:10px">${statusLabel(o.status)}</span>`:'';
  const mecSel=modo==='mecanico'?`<select class="kb-day" onclick="event.stopPropagation()" onchange="reasignarMecanico(${o.id},this.value)">${renderMecanicoOptions(o.mecanico)}</select>`:'';
  const mecInfo=modo==='estado'&&o.mecanico&&o.mecanico!=='Sin asignar'?`<div class="kb-card-meta">🔧 ${esc(o.mecanico)}</div>`:'';
  return `<div class="kb-card" data-oid="${o.id}">
    <div class="kb-card-title">#${o.id} ${urg}${statusBadge}${atrasada?'<span class="kb-overdue">Atrasada</span>':''}</div>
    <div class="kb-card-meta"><strong>${esc(o.bici.marca)} ${esc(o.bici.modelo)}</strong></div>
    <div class="kb-card-meta">${esc(o.clienteNombre)}</div>
    <div class="kb-card-meta">${esc((o.tiposTrabajo||[]).join(', '))} · ${fmtDur(duracionOrden(o))}</div>
    ${mecInfo}${diaInfo}
    <div class="kb-actions">${acc}${diaSel}${mecSel}</div>
  </div>`;
}

function renderProgramacion(){
  const cont=document.getElementById('prog-contenido');if(!cont)return;
  const hoy=new Date();hoy.setHours(0,0,0,0);
  if(progDiaSel===null)progDiaSel=_localKey(hoy);
  const cola=calcularCola();
  const activos=state.ordenes.filter(o=>o.status==='pending'||o.status==='in-progress');
  const finDe=o=>{const e=cola.get(o.id);return e?e.fin:(o.fechaCompromiso?new Date(o.fechaCompromiso):new Date())};
  const diaDe=o=>o.diaProgramado?new Date(o.diaProgramado+'T00:00:00'):finDe(o); // día efectivo (fijado o calculado)

  // Tira de días hábiles
  const dias=[];let cur=new Date(hoy);let g=0;
  while(dias.length<6&&g<25){g++;if((HORARIO_TALLER[cur.getDay()]||[]).length)dias.push(new Date(cur));cur.setDate(cur.getDate()+1)}
  const mañana=new Date(hoy.getTime()+86400000);
  const diasHTML=dias.map(d=>{
    const key=_localKey(d);
    const ords=activos.filter(o=>_mismoDia(diaDe(o),d));
    const usados=ords.reduce((s,o)=>s+duracionOrden(o),0);
    const disp=minutosDisponibles(d);
    const pct=disp>0?usados/disp:(usados>0?1.5:0);
    const color=pct>1?'#E24B4A':pct>=0.7?'#E0A23B':'#1D9E75';
    const etq=_mismoDia(d,hoy)?'Hoy':_mismoDia(d,mañana)?'Mañana':d.toLocaleDateString('es-CO',{weekday:'short'});
    return `<div class="prog-day${key===progDiaSel?' sel':''}" onclick="filtrarProgDia('${key}')">
      <div class="prog-day-date">${etq}</div>
      <div class="prog-day-sub">${d.toLocaleDateString('es-CO',{day:'2-digit',month:'short'})}</div>
      <div class="prog-day-count">${ords.length} bici${ords.length===1?'':'s'}</div>
      <div class="cap-bar"><div class="cap-fill" style="width:${Math.min(100,pct*100)}%;background:${color}"></div></div>
      <div class="prog-day-cap">${fmtDur(usados)} / ${disp>0?fmtDur(disp):'cerrado'}</div>
    </div>`;
  }).join('');
  const stripHTML=`<div class="card" style="padding:14px">
    <div class="card-header"><h2 style="font-size:16px">Programación del taller</h2></div>
    <div class="prog-days">
      <div class="prog-day prog-day-all${progDiaSel==='todas'?' sel':''}" onclick="filtrarProgDia('todas')"><div class="prog-day-date">Todas</div><div class="prog-day-sub">los días</div><div class="prog-day-count">${activos.length} activas</div></div>
      ${diasHTML}
    </div>
  </div>`;

  // Kanban
  const filtraDia=o=>progDiaSel==='todas'||_localKey(diaDe(o))===progDiaSel;
  const pend=activos.filter(o=>o.status==='pending'&&filtraDia(o)).sort((a,b)=>diaDe(a)-diaDe(b));
  const prog=activos.filter(o=>o.status==='in-progress'&&filtraDia(o)).sort((a,b)=>diaDe(a)-diaDe(b));
  const esper=state.ordenes.filter(o=>o.status==='waiting-parts').sort((a,b)=>new Date(b.creado)-new Date(a.creado));
  const listas=state.ordenes.filter(o=>o.status==='done').sort((a,b)=>new Date(b.creado)-new Date(a.creado));
  let ctx;
  if(progDiaSel==='todas')ctx='todos los días';
  else{const d=dias.find(x=>_localKey(x)===progDiaSel);ctx=d?(_mismoDia(d,hoy)?'hoy':d.toLocaleDateString('es-CO',{weekday:'long',day:'2-digit',month:'short'})):'el día seleccionado'}

  const col=(titulo,ords,accent,dropStatus)=>`<div class="kb-col" data-drop-status="${dropStatus}">
    <div class="kb-col-head" style="color:${accent};border-bottom:2px solid ${accent}"><span>${titulo}</span><span class="kb-col-count">${ords.length}</span></div>
    ${ords.length?ords.map(o=>progCard(o,finDe)).join(''):'<div class="kb-empty">—</div>'}
  </div>`;

  const toggle=`<div class="prog-modo"><button class="pm-btn ${progModo==='estado'?'active':''}" onclick="setProgModo('estado')">Por estado</button><button class="pm-btn ${progModo==='mecanico'?'active':''}" onclick="setProgModo('mecanico')">Por mecánico</button></div>`;

  let bodyHTML;
  if(progModo==='mecanico'){
    const noFin=state.ordenes.filter(o=>o.status==='pending'||o.status==='in-progress'||o.status==='waiting-parts');
    const hayManual=noFin.some(o=>!state.mecanicos.includes(o.mecanico));
    const lanes=hayManual?[...state.mecanicos,'Sin asignar']:[...state.mecanicos];
    const rankS={'in-progress':0,'pending':1,'waiting-parts':2};
    const lanesHTML=lanes.map(mec=>{
      const sinAsig=mec==='Sin asignar';
      const match=o=>sinAsig?!state.mecanicos.includes(o.mecanico):o.mecanico===mec;
      const ords=noFin.filter(o=>match(o)&&(o.status==='waiting-parts'||filtraDia(o))).sort((a,b)=>rankS[a.status]-rankS[b.status]||diaDe(a)-diaDe(b));
      const horas=ords.filter(o=>o.status!=='waiting-parts').reduce((s,o)=>s+duracionOrden(o),0);
      let cap='';
      if(progDiaSel!=='todas'){const d=dias.find(x=>_localKey(x)===progDiaSel)||new Date(progDiaSel+'T00:00:00');const disp=minutosDisponibles(d);const pct=disp>0?horas/disp:(horas>0?1.5:0);const color=pct>1?'#E24B4A':pct>=0.7?'#E0A23B':'#1D9E75';cap=`<div class="cap-bar" style="margin-top:5px"><div class="cap-fill" style="width:${Math.min(100,pct*100)}%;background:${color}"></div></div>`}
      return `<div class="kb-col" data-drop-mec="${esc(mec)}"><div class="kb-col-head"><span>🔧 ${esc(mec)}</span><span class="kb-col-count">${ords.length}</span></div><div class="lane-load">${fmtDur(horas)} ${progDiaSel!=='todas'?'programadas':'activas'}</div>${cap}${ords.length?ords.map(o=>progCard(o,finDe,'mecanico')).join(''):'<div class="kb-empty">—</div>'}</div>`;
    }).join('');
    bodyHTML=`<div class="kb-context">Carga por mecánico para <strong>${ctx}</strong>. <span style="color:#888">Cambia el mecánico desde cada tarjeta para balancear.</span></div><div class="kanban">${lanesHTML}</div>`;
  } else {
    bodyHTML=`<div class="kb-context">Programadas para <strong>${ctx}</strong>. <span style="color:#888">Esperando repuesto y Listas se muestran siempre.</span></div>
    <div class="kanban">
      ${col('Por iniciar',pend,'#94560A','pending')}
      ${col('En proceso',prog,'#0C447C','in-progress')}
      ${col('⏸ Esperando repuesto',esper,'#B5481B','waiting-parts')}
      ${col('Listas',listas,'#1D7A4D','done')}
    </div>`;
  }
  cont.innerHTML=stripHTML+toggle+bodyHTML;
  setupDragKanban();
}

// ===== Drag & drop del tablero =====
let _drag=null,_dragSetup=false;
function setupDragKanban(){
  if(_dragSetup)return;_dragSetup=true;
  document.addEventListener('pointerdown',onDragDown,{passive:false});
  document.addEventListener('pointermove',onDragMove,{passive:false});
  document.addEventListener('pointerup',onDragUp,{passive:false});
  document.addEventListener('pointercancel',onDragEnd,{passive:false});
}
function _colUnder(x,y){const el=document.elementFromPoint(x,y);return el?el.closest('.kb-col'):null}
function onDragDown(e){
  if(currentView!=='programacion')return;
  if(e.button!==undefined&&e.button>0)return;
  const card=e.target.closest('.kb-card');if(!card)return;
  if(e.target.closest('button,select,a,input,textarea,label'))return;
  const oid=+card.dataset.oid;if(!oid)return;
  _drag={oid,card,sx:e.clientX,sy:e.clientY,lastX:e.clientX,lastY:e.clientY,active:false,touch:e.pointerType==='touch'};
  if(_drag.touch)_drag.timer=setTimeout(()=>{if(_drag&&!_drag.active)activarDrag(_drag.lastX,_drag.lastY)},230);
}
function activarDrag(x,y){
  if(!_drag)return;_drag.active=true;
  const r=_drag.card.getBoundingClientRect();
  _drag.offX=x-r.left;_drag.offY=y-r.top;
  const c=_drag.card.cloneNode(true);
  c.classList.add('kb-dragging');c.style.width=r.width+'px';
  c.style.left=(x-_drag.offX)+'px';c.style.top=(y-_drag.offY)+'px';
  document.body.appendChild(c);_drag.clone=c;
  _drag.card.classList.add('kb-card-ghost');
  if(navigator.vibrate)try{navigator.vibrate(12)}catch(e){}
}
function onDragMove(e){
  if(!_drag)return;
  _drag.lastX=e.clientX;_drag.lastY=e.clientY;
  const dist=Math.hypot(e.clientX-_drag.sx,e.clientY-_drag.sy);
  if(!_drag.active){
    if(_drag.touch){if(dist>12){clearTimeout(_drag.timer);_drag=null}return}
    else{if(dist>5)activarDrag(e.clientX,e.clientY);else return}
  }
  if(!_drag||!_drag.active)return;
  e.preventDefault();
  _drag.clone.style.left=(e.clientX-_drag.offX)+'px';
  _drag.clone.style.top=(e.clientY-_drag.offY)+'px';
  const col=_colUnder(e.clientX,e.clientY);
  if(_drag.overCol&&_drag.overCol!==col)_drag.overCol.classList.remove('kb-col-over');
  if(col)col.classList.add('kb-col-over');
  _drag.overCol=col;
}
function onDragUp(e){
  if(!_drag)return;
  clearTimeout(_drag.timer);
  if(_drag.active){
    e.preventDefault();
    const col=_colUnder(e.clientX,e.clientY);const oid=_drag.oid;
    const o=state.ordenes.find(o=>o.id===oid);
    if(col&&o){
      if(progModo==='estado'){const st=col.dataset.dropStatus;if(st&&o.status!==st)cambiarEstadoOrden(oid,st)}
      else{const mec=col.dataset.dropMec;if(mec&&o.mecanico!==mec)reasignarMecanico(oid,mec)}
    }
    _cleanupDrag();
  }else{
    const dist=Math.hypot(e.clientX-_drag.sx,e.clientY-_drag.sy);const oid=_drag.oid;_drag=null;
    if(dist<8)abrirOrden(oid);
  }
}
function onDragEnd(){_cleanupDrag()}
function _cleanupDrag(){
  if(!_drag)return;
  if(_drag.clone)_drag.clone.remove();
  if(_drag.card)_drag.card.classList.remove('kb-card-ghost');
  if(_drag.overCol)_drag.overCol.classList.remove('kb-col-over');
  _drag=null;
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
  _ordenAbierta=id;
  document.getElementById('modal-titulo').textContent=`Orden #${o.id} · ${o.bici.marca} ${o.bici.modelo}`;
  const reps=o.reparaciones||[];const total=reps.reduce((s,r)=>s+(parseFloat(r.precio)||0),0);
  const prioOpts=['normal','urgente','espera'];
  const cola=calcularCola();const entry=cola.get(o.id);
  const dur=duracionOrden(o);
  const compromisoTxt=o.fechaCompromiso?`<span class="meta">📅 Compromiso: ${fmtFechaHora(new Date(o.fechaCompromiso))}</span>`:'';
  const entregaActual=entry?`<span class="meta" style="color:#185FA5">🔄 Estimación actual: ${fmtFechaHora(entry.fin)}</span>`:'';
  document.getElementById('modal-contenido').innerHTML=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center"><span class="status s-${o.status}">${statusLabel(o.status)}</span><span class="meta">Ingresó: ${fmtDate(o.creado)}</span><span class="meta">⏱ ${fmtDur(dur)}</span>${compromisoTxt}${entregaActual}</div><div class="cliente-info" id="modal-cliente-info">${clienteInfoModalHTML(o)}</div><div class="grid2"><div class="section"><label>Mecánico</label><select id="edit-mec-${o.id}">${renderMecanicoOptions(o.mecanico)}</select></div><div class="section"><label>Prioridad</label><select id="edit-prio-${o.id}">${prioOpts.map(p=>`<option value="${p}" ${o.prioridad===p?'selected':''}>${p}</option>`).join('')}</select></div></div><div style="margin-bottom:8px"><span style="font-size:12px;font-weight:500;color:#888">Tipo de trabajo: </span><span style="font-size:12px">${esc((o.tiposTrabajo||[]).join(' · '))}</span></div><div class="section"><label>Descripción / observaciones</label><textarea id="edit-desc-${o.id}">${esc(o.descripcion||'')}</textarea></div><div class="section"><label>Fotos</label>${renderFotosOrden(o)}</div><hr class="divider"><div id="cl-wrap-${o.id}">${renderChecklist(o)}</div><hr class="divider"><h3 style="margin-bottom:8px">Trabajo realizado y repuestos</h3><div id="reps-list-${o.id}">${reps.map((r,i)=>`<div class="repair-row"><input value="${esc(r.codigo||'')}" placeholder="SKU" id="rep-c-${o.id}-${i}" style="flex:1;min-width:70px;max-width:110px"><input value="${esc(r.desc)}" placeholder="Servicios y repuestos" id="rep-d-${o.id}-${i}" style="flex:2" oninput="recalcTotal(${o.id})"><input value="${esc(r.precio)}" type="number" placeholder="$ Valor" id="rep-p-${o.id}-${i}" style="flex:1;min-width:80px" oninput="recalcTotal(${o.id})"><button class="btn btn-sm" onclick="eliminarRep(${o.id},${i})">✕</button></div>`).join('')}</div><button class="btn btn-sm" onclick="agregarRep(${o.id})" style="margin-bottom:8px">+ Agregar línea</button><div class="total-box"><span style="font-weight:500;font-size:14px">Total orden</span><span style="font-size:18px;font-weight:500" id="total-${o.id}">$ ${total.toLocaleString('es-CO')}</span></div><hr class="divider"><div class="section"><label>Notas internas del mecánico</label><textarea id="notas-${o.id}">${esc(o.notas||'')}</textarea></div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn" onclick="guardarOrden(${o.id})">💾 Guardar</button>${o.status==='pending'?`<button class="btn btn-primary" onclick="iniciarOrden(${o.id})">▶ Iniciar trabajo</button>`:''} ${o.status==='in-progress'?`<button class="btn" onclick="pausarOrden(${o.id})">⏸ Volver a pendiente</button>`:''} ${(o.status==='pending'||o.status==='in-progress')?`<button class="btn" onclick="cambiarEstadoOrden(${o.id},'waiting-parts',{cerrar:true,guardar:true})">📦 Esperando repuesto</button>`:''} ${o.status==='waiting-parts'?`<button class="btn btn-primary" onclick="cambiarEstadoOrden(${o.id},'in-progress',{cerrar:true,guardar:true})">▶ Reanudar trabajo</button>`:''} ${o.status!=='done'&&o.status!=='delivered'?`<button class="btn btn-success" onclick="terminarOrden(${o.id})">✓ Terminar y notificar</button>`:''} ${o.status==='done'?`<button class="btn" onclick="marcarEntregada(${o.id})">📦 Marcar entregada</button>`:''} ${o.status==='done'||o.status==='delivered'?`<button class="btn btn-sm" onclick="verReporte(${o.id})">Ver reporte</button>`:''} <button class="btn btn-sm" onclick="imprimirRecibo(${o.id})">🖨 Imprimir</button> <button class="btn btn-sm" onclick="mostrarAccionesIngreso(${o.id})">📱 WhatsApp ingreso</button> <button class="btn btn-sm" style="margin-left:auto;color:#E24B4A;border-color:#E24B4A" onclick="eliminarOrden(${o.id})">🗑 Eliminar</button></div>`;
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
function cerrarModal(){document.getElementById('modal-orden').style.display='none';_ordenAbierta=null}

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
  div.innerHTML=clientes.map(cli=>{const ords=state.ordenes.filter(o=>o._clienteUuid===cli._uuid);const cid=encodeURIComponent(cli.id);return`<div class="card"><div class="card-header"><div style="cursor:pointer;flex:1" onclick="toggleHist('hc-${cid}')"><h3>${esc(cli.nombre)}</h3><div class="meta">${esc(cli.tel)} · ${ords.length} servicio(s)</div></div><div style="display:flex;gap:4px"><a class="btn btn-sm wa-btn" href="${waLink(cli.tel,'Hola '+cli.nombre)}" target="_blank" rel="noopener" style="padding:2px 8px;font-size:11px">📱</a><button class="btn btn-sm" onclick="editarCliente('${jsStr(cli.id)}')">✏ Editar</button><button class="btn btn-sm" style="color:#E24B4A;border-color:#E24B4A" onclick="eliminarCliente('${jsStr(cli.id)}')">🗑</button></div></div><div id="hc-${cid}" style="display:none"><hr class="divider">${(cli.bicicletas||[]).map((b,bi)=>{const bo=ords.filter(o=>o._biciUuid===b._id);return`<div class="hist-bici"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="font-weight:500;font-size:13px">${esc(b.marca)} ${esc(b.modelo)}${b.color?' · '+esc(b.color):''}${b.año?' ('+esc(b.año)+')':''}</div><button class="btn btn-sm" style="color:#E24B4A;border-color:#E24B4A;padding:2px 6px" onclick="eliminarBici('${b._id}')">🗑</button></div>${bo.map(o=>`<div class="hist-entry"><div style="display:flex;justify-content:space-between"><span style="font-size:12px;font-weight:500">#${o.id} · ${fmtDate(o.creado)}</span><span class="status s-${o.status}">${statusLabel(o.status)}</span></div><div class="meta">${esc((o.tiposTrabajo||[]).join(', '))}</div>${o.reparaciones&&o.reparaciones.length?`<div class="meta">${esc(o.reparaciones.map(r=>r.desc).filter(Boolean).join(', '))}</div>`:''}<button class="btn btn-sm" style="margin-top:4px" onclick="abrirOrden(${o.id})">Ver detalle</button></div>`).join('')}</div>`}).join('')}</div></div>`}).join('');
}
function clienteInfoModalHTML(o){return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><div><strong>${esc(o.clienteNombre)}</strong> · ${esc(o.clienteTel)}</div><div style="display:flex;gap:4px"><button class="btn btn-sm" style="padding:2px 8px;font-size:11px" onclick="editarClienteDeOrden(${o.id})">✏ Editar cliente</button><a class="btn btn-sm wa-btn" style="padding:2px 8px;font-size:11px" href="${waLink(o.clienteTel,'Hola '+o.clienteNombre)}" target="_blank" rel="noopener">📱 WhatsApp</a></div></div>`}
function clienteDatosHTML(cli){return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><div><strong>${esc(cli.nombre)}</strong> · ${esc(cli.tel)}${cli.email?' · '+esc(cli.email):''}</div><button class="btn btn-sm" style="padding:2px 8px;font-size:11px" onclick="editarCliente('${jsStr(cli.id)}')">✏ Editar datos</button></div>`}
function _abrirModalEditarCliente(c){
  if(!c){toast('Cliente no encontrado','error');return}
  document.getElementById('ec-cid').value=c.id;
  document.getElementById('ec-uuid').value=c._uuid||'';
  document.getElementById('ec-nombre').value=c.nombre||'';
  document.getElementById('ec-tel').value=c.tel||'';
  document.getElementById('ec-email').value=c.email||'';
  document.getElementById('ec-cedula-display').value=c._cedula||'Sin cédula';
  const msg=document.getElementById('ec-msg');msg.style.display='none';msg.textContent='';
  const btn=document.getElementById('ec-save-btn');btn.disabled=false;btn.textContent='Guardar cambios';
  document.getElementById('modal-editar-cliente').style.display='block';
}
function editarCliente(cid){_abrirModalEditarCliente(state.clientes.find(x=>x.id===cid))}
function editarClienteDeOrden(oid){const o=state.ordenes.find(x=>x.id===oid);if(!o)return;_abrirModalEditarCliente(state.clientes.find(x=>x._uuid===o._clienteUuid))}
function cerrarModalEditarCliente(){document.getElementById('modal-editar-cliente').style.display='none'}
async function guardarEdicionCliente(){
  const uuid=document.getElementById('ec-uuid').value;
  const nombre=document.getElementById('ec-nombre').value.trim();
  const tel=document.getElementById('ec-tel').value.trim();
  const email=document.getElementById('ec-email').value.trim();
  const msg=document.getElementById('ec-msg');
  const showErr=t=>{msg.style.display='block';msg.style.background='#fef2f2';msg.style.color='#b91c1c';msg.textContent=t};
  if(!nombre){showErr('El nombre es obligatorio.');return}
  if(!uuid){showErr('No se pudo identificar el cliente.');return}
  const btn=document.getElementById('ec-save-btn');btn.disabled=true;btn.textContent='Guardando...';
  try{
    await window.db.updateClienteByUuid(uuid,{nombre,tel,email});
    // Actualiza el estado en memoria sin recargar, para no descartar ediciones no guardadas del modal de orden
    const c=state.clientes.find(x=>x._uuid===uuid);
    if(c){c.nombre=nombre;c.tel=tel;c.email=email}
    state.ordenes.forEach(o=>{if(o._clienteUuid===uuid){o.clienteNombre=nombre;o.clienteTel=tel}});
    if(clienteActivo&&clienteActivo._uuid===uuid){clienteActivo.nombre=nombre;clienteActivo.tel=tel;clienteActivo.email=email}
    cerrarModalEditarCliente();
    // Refresca solo lo visible (sin re-render del modal de orden, que tiene campos en edición)
    if(_ordenAbierta!=null&&document.getElementById('modal-orden').style.display==='block'){
      const o=state.ordenes.find(x=>x.id===_ordenAbierta);const cinfo=document.getElementById('modal-cliente-info');
      if(o&&cinfo)cinfo.innerHTML=clienteInfoModalHTML(o);
    }
    const cdat=document.getElementById('cliente-datos');
    if(cdat&&clienteActivo&&clienteActivo._uuid===uuid&&document.getElementById('cliente-encontrado').style.display!=='none')cdat.innerHTML=clienteDatosHTML(clienteActivo);
    if(currentView==='historial')renderHistorial();
    else if(currentView==='mecanico')renderMecanico();
    else if(currentView==='programacion')renderProgramacion();
    else if(currentView==='caja')renderCaja();
    else if(currentView==='asesor')renderOrdenesRecientes();
    toast('Cliente actualizado','success');
  }catch(err){
    showErr('Error: '+err.message);
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
    if(o.status==='delivered'&&!o.recordatorioEnviado){const dias=Math.floor((ahora-new Date(o.fechaTerminado||o.creado))/86400000);if(dias>=45)al.push({tipo:'record45',orden:o,dias})}
    if(o.status==='done'){const dias=Math.floor((ahora-new Date(o.fechaTerminado||o.creado))/86400000);if(dias>=3)al.push({tipo:'sinrecoger',orden:o,dias})}
  });return al;
}
function buildMensajeRecordatorio(o,tipo,dias){
  if(tipo==='record45'){
    return `Hola ${o.clienteNombre} 👋, te saludamos de *Veloce Bicicletas*. Vemos que tu *${o.bici.marca} ${o.bici.modelo}* tuvo su último servicio hace ${dias} días. Para mantenerla rodando como nueva, te recomendamos traerla a una revisión / mantenimiento. ¿Te ayudamos a agendar? 🚴`;
  }
  return `Hola ${o.clienteNombre} 👋, te recordamos que tu *${o.bici.marca} ${o.bici.modelo}* (Orden #${o.id}) ya está lista y te espera en *Veloce Bicicletas*. ¿Cuándo te queda bien pasar a recogerla? 🚴`;
}
function renderNotif(){
  const al=getAlertas(),div=document.getElementById('alertas-lista');
  if(!al.length){div.innerHTML=`<div class="card"><div class="empty">Sin alertas pendientes</div></div><div class="card"><div class="card-header"><h2>Recordatorios automáticos</h2></div><div style="font-size:13px;color:#888">A los 45 días del último servicio se genera el recordatorio de mantenimiento para WhatsApp.</div></div>`;return}
  div.innerHTML=`<div class="card"><div class="card-header"><h2>Alertas (${al.length})</h2></div>${al.map(a=>{
    const o=a.orden;const msg=buildMensajeRecordatorio(o,a.tipo,a.dias);
    const tel=(o.clienteTel||'').replace(/\D/g,'');
    const wa=tel?`<a class="btn btn-sm wa-btn" href="${waLink(o.clienteTel,msg)}" target="_blank" rel="noopener">📱 WhatsApp</a>`:`<span class="meta" style="color:#E24B4A">Sin teléfono registrado</span>`;
    const titulo=a.tipo==='record45'
      ?`<div style="font-weight:500;font-size:12px">🔧 Mantenimiento — ${esc(o.clienteNombre)}</div><div>Último servicio hace ${a.dias} días · Orden #${o.id} · ${esc(o.bici.marca)} ${esc(o.bici.modelo)}</div>`
      :`<div style="font-weight:500;font-size:12px">📦 Sin recoger — ${esc(o.clienteNombre)}</div><div>Orden #${o.id} lista hace ${a.dias} días · ${esc(o.bici.marca)} ${esc(o.bici.modelo)}</div>`;
    const extra=a.tipo==='record45'
      ?`<button class="btn btn-sm" onclick="marcarRecordatorio(${o.id})">✓ Marcar enviado</button>`
      :'';
    return `<div class="notif"><div style="flex:1">${titulo}<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${wa}<button class="btn btn-sm" onclick="abrirOrden(${o.id})">Ver orden</button>${extra}</div></div></div>`;
  }).join('')}</div>`;
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
  const w=window.open('','_blank','width=380,height=800');if(!w){toast('Habilita popups para imprimir','error');return}
  const logoUrl = location.origin + location.pathname.replace(/[^/]*$/,'') + 'logo.png';
  const reps2 = reps.filter(r => r.desc || r.codigo || r.precio);
  const html=`<!DOCTYPE html><html><head><title>Recibo orden #${o.id}</title><style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:'Arial Black','Helvetica',sans-serif;font-weight:700;color:#000}
  @page{size:80mm auto;margin:0}
  html,body{width:70mm}
  body{margin:0 auto;padding:2mm 4mm;color:#000;font-size:11px;line-height:1.32}
  .logo{text-align:center;border-bottom:2px solid #000;padding-bottom:5px;margin-bottom:6px}
  .logo img{max-width:46mm;height:auto;display:block;margin:0 auto 3px}
  .logo p{font-size:9px;margin-top:2px;letter-spacing:.2px}
  .row{display:flex;justify-content:space-between;gap:6px;margin-bottom:2px}
  .row strong{flex-shrink:0}
  .row span{text-align:right;overflow-wrap:anywhere;min-width:0}
  h2{font-size:11px;margin:7px 0 3px;padding-bottom:2px;border-bottom:1px solid #000;text-transform:uppercase;letter-spacing:.2px}
  .box{padding:3px 0;margin-bottom:5px;font-size:11px}
  .total{display:flex;justify-content:space-between;font-size:14px;border-top:2px solid #000;padding-top:5px;margin-top:5px}
  .footer{text-align:center;margin-top:12px;padding-top:6px;border-top:1px dashed #000;font-size:10px;line-height:1.4}
  .orden-num{text-align:center;font-size:13px;margin:5px 0;border:2px solid #000;padding:4px;text-transform:uppercase;letter-spacing:.2px}
  .srv-head{display:grid;grid-template-columns:12mm 1fr 13mm;gap:2px;font-size:9px;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:2px;text-transform:uppercase}
  .srv-row{display:grid;grid-template-columns:12mm 1fr 13mm;gap:2px;font-size:10px;padding:2px 0;border-bottom:1px dotted #999;overflow-wrap:anywhere}
  .srv-row .v,.srv-head .v{text-align:right}
  .tip{background:#fffae6;border:1px dashed #c08010;padding:6px;border-radius:4px;font-size:11px;font-family:sans-serif;margin-bottom:10px;color:#5a3d00}
  .noprint{text-align:center;margin-top:14px}
  .btn-print{background:#111;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:700;margin:0 3px;font-family:sans-serif}
  @media print{.tip,.noprint{display:none}}
  </style></head><body>
  <div class="tip"><strong>Tip impresión TM-20:</strong> en el diálogo, selecciona "Más opciones" → Márgenes: <strong>Ninguno</strong> · Escala: <strong>100%</strong> · Tamaño papel: <strong>Roll Paper 80×297</strong>.</div>
  <div class="logo"><img src="${logoUrl}" alt="Veloce"><p>TALLER ESPECIALIZADO · MEDELLÍN</p></div>
  <div class="orden-num">ORDEN #${o.id}</div>
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
  <div class="box">${esc((o.tiposTrabajo||[]).join(' · '))}${o.descripcion?`<div style="margin-top:4px;padding-top:4px;border-top:1px dotted #999">${esc(o.descripcion)}</div>`:''}</div>
  ${reps2.length>0?`<h2>Servicios / Repuestos</h2>
  <div class="srv-head"><span>SKU</span><span>Producto</span><span class="v">Valor</span></div>
  ${reps2.map(r=>`<div class="srv-row"><span>${esc(r.codigo||'-')}</span><span>${esc(r.desc||'')}</span><span class="v">$ ${(parseFloat(r.precio)||0).toLocaleString('es-CO')}</span></div>`).join('')}
  <div class="total"><span>TOTAL</span><span>$ ${total.toLocaleString('es-CO')}</span></div>`:''}
  <div class="footer">Conserve este recibo<br>para retirar su bicicleta.<br><br>Gracias por confiar en<br>VELOCE BICICLETAS</div>
  <div class="noprint"><button class="btn-print" onclick="window.print()">Imprimir</button><button class="btn-print" style="background:#666" onclick="window.close()">Cerrar</button></div>
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
  <div class="card"><div class="card-header"><h2>Producción por mecánico</h2><span class="meta">Mano de obra · este mes</span></div>${statsMec.length===0?'<div class="empty">Sin datos</div>':(()=>{const tMO=statsMec.reduce((s,m)=>s+m.manoObra,0),tRep=statsMec.reduce((s,m)=>s+m.repuestos,0);return`<div style="display:flex;gap:14px;margin-bottom:12px;font-size:12px"><span>🔧 Mano de obra: <strong style="color:#1D9E75">${fmt(tMO)}</strong></span><span>🔩 Repuestos: <strong>${fmt(tRep)}</strong></span></div>`+statsMec.map(m=>`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px;align-items:baseline"><span style="font-weight:500;font-size:13px">${esc(m.nombre)}</span><span style="font-weight:600;font-size:14px;color:#1D9E75">${fmt(m.manoObra)}</span></div><div style="display:flex;align-items:center;gap:8px"><div class="bar-wrap"><div class="bar-fill" style="width:${m.pct}%;background:#1D9E75"></div></div><span class="meta">${m.count} órdenes</span></div><div class="meta" style="margin-top:2px">Repuestos: ${fmt(m.repuestos)} · Total facturado: ${fmt(m.total)}</div></div>`).join('')})()}</div>
  <div class="card"><div class="card-header"><h2>Órdenes facturadas del mes</h2><button class="btn btn-sm" onclick="exportarCajaCSV()">⬇ CSV</button></div>${sMes.ordenes.length===0?'<div class="empty">Sin movimientos este mes</div>':sMes.ordenes.slice().reverse().map(o=>`<div class="work-item done" onclick="abrirOrden(${o.id})"><div style="display:flex;justify-content:space-between"><span style="font-size:13px">#${o.id} · ${esc(o.clienteNombre)}</span><span style="font-weight:500">${fmt(totalOrden(o))}</span></div><div class="meta">${fmtDate(o.fechaTerminado||o.creado)} · ${esc(o.bici.marca)} ${esc(o.bici.modelo)}</div></div>`).join('')}</div>`;
}
function statsMecanicos(){
  const now=new Date(),iniMes=new Date(now.getFullYear(),now.getMonth(),1);
  const ords=state.ordenes.filter(o=>(o.status==='done'||o.status==='delivered')&&new Date(o.fechaTerminado||o.creado)>=iniMes);
  const by={};
  ords.forEach(o=>{const m=o.mecanico||'Sin asignar';if(!by[m])by[m]={nombre:m,count:0,total:0,manoObra:0};by[m].count++;by[m].total+=totalOrden(o);by[m].manoObra+=manoObraOrden(o)});
  const arr=Object.values(by).sort((a,b)=>b.manoObra-a.manoObra||b.total-a.total);
  const max=Math.max(1,...arr.map(m=>m.manoObra));
  arr.forEach(m=>{m.pct=Math.round(m.manoObra/max*100);m.repuestos=m.total-m.manoObra});
  return arr;
}
function csvEscape(v){const s=String(v==null?'':v);return/[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportarCajaCSV(){
  const now=new Date(),iniMes=new Date(now.getFullYear(),now.getMonth(),1);
  const ords=state.ordenes.filter(o=>(o.status==='done'||o.status==='delivered')&&new Date(o.fechaTerminado||o.creado)>=iniMes);
  if(!ords.length){toast('No hay órdenes facturadas este mes','error');return}
  const headers=['Orden','Fecha terminada','Cliente','Teléfono','Marca','Modelo','Color','Mecánico','Tipo trabajo','Servicios','Mano de obra','Repuestos','Total','Estado'];
  const rows=ords.map(o=>{const mo=manoObraOrden(o),tot=totalOrden(o);return[o.id,new Date(o.fechaTerminado||o.creado).toLocaleDateString('es-CO'),o.clienteNombre,o.clienteTel,o.bici.marca,o.bici.modelo,o.bici.color||'',o.mecanico,(o.tiposTrabajo||[]).join(' | '),(o.reparaciones||[]).filter(r=>r.desc).map(r=>`${r.desc} ($${r.precio})`).join(' | '),mo,tot-mo,tot,statusLabel(o.status)]});
  const total=ords.reduce((s,o)=>s+totalOrden(o),0);
  const totalMO=ords.reduce((s,o)=>s+manoObraOrden(o),0);
  rows.push(['','','','','','','','','','TOTAL',totalMO,total-totalMO,total,'']);
  const csv='\ufeff'+[headers,...rows].map(r=>r.map(csvEscape).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`veloce-caja-${now.toISOString().slice(0,7)}.csv`;a.click();URL.revokeObjectURL(url);toast(`${ords.length} órdenes exportadas`,'success');
}

// ===== Consignación =====

let consFilter = 'disponible';

const CONS_STATUS_LABEL = { disponible: 'Disponible', vendida: 'Vendida', retirada: 'Retirada' };
const CONS_STATUS_CLASS = { disponible: 's-cons-disp', vendida: 's-cons-vend', retirada: 's-cons-ret' };
const COMISION_PCT_DEFAULT = 8; // % por defecto

function calcComision(precio, pct){
  const p = parseFloat(precio) || 0;
  const pp = pct != null ? parseFloat(pct) : COMISION_PCT_DEFAULT;
  const comision = Math.round(p * pp / 100);
  const propietario = p - comision;
  return { precio: p, pct: pp, comision, propietario };
}

function renderConsignacion(){
  const lista = document.getElementById('cons-lista');
  if(!lista) return;
  const fmt = n => '$ '+n.toLocaleString('es-CO');
  const items = (state.consignaciones||[]).filter(c => consFilter==='todas' || c.status===consFilter);

  // Resumen totales del filtro actual
  const totVentas = items.reduce((s,c)=>s+(parseFloat(c.precio)||0),0);
  const totComision = items.reduce((s,c)=>s+calcComision(c.precio,c.comisionPct).comision,0);
  const totPropietario = totVentas - totComision;
  const resumen = items.length ? `<div class="cons-resumen">
    <div><span class="cons-resumen-lbl">${items.length} bici(s) · ${CONS_STATUS_LABEL[consFilter]||'Todas'}</span></div>
    <div class="cons-resumen-row"><span>Total ventas</span><strong>${fmt(totVentas)}</strong></div>
    <div class="cons-resumen-row"><span>Comisión taller</span><strong style="color:#1D9E75">${fmt(totComision)}</strong></div>
    <div class="cons-resumen-row"><span>A propietarios</span><strong>${fmt(totPropietario)}</strong></div>
  </div>` : '';

  if(!items.length){
    lista.innerHTML='<div class="empty">No hay bicicletas '+(consFilter==='todas'?'registradas':consFilter+'s')+'</div>';
    return;
  }
  lista.innerHTML = resumen + items.map(c => {
    const calc = calcComision(c.precio, c.comisionPct);
    const wa = c.contactoTel ? `<a href="${waLink(c.contactoTel,'Hola '+esc(c.contactoNombre)+', te contactamos por la bicicleta '+esc(c.producto)+' que dejaste en consignación en Veloce.')}" target="_blank" class="btn btn-sm wa-btn" style="text-decoration:none">WhatsApp</a>` : '';
    const acciones = c.status==='disponible'
      ? `<button class="btn btn-sm btn-success" onclick="cambiarStatusConsignacion(${c.id},'vendida')">Vendida</button>
         <button class="btn btn-sm" onclick="cambiarStatusConsignacion(${c.id},'retirada')">Retirada</button>`
      : `<button class="btn btn-sm" onclick="cambiarStatusConsignacion(${c.id},'disponible')">Disponible</button>`;
    return `<div class="cons-card">
      <div class="cons-card-top">
        <div>
          <span class="cons-producto">${esc(c.producto)}</span>
          <span class="status ${CONS_STATUS_CLASS[c.status]||'s-pending'}" style="margin-left:6px">${CONS_STATUS_LABEL[c.status]||c.status}</span>
        </div>
        <span class="cons-precio">${fmt(calc.precio)}</span>
      </div>
      <div class="cons-tags">
        <span class="cons-tag">${esc(c.tipo)}</span>
        <span class="cons-tag">Talla ${esc(c.talla)}</span>
        <span class="cons-tag">${esc(c.color)}</span>
      </div>
      <div class="cons-comision">
        <div><span>Comisión taller (${calc.pct}%)</span><strong style="color:#1D9E75">${fmt(calc.comision)}</strong></div>
        <div><span>Recibe propietario</span><strong>${fmt(calc.propietario)}</strong></div>
      </div>
      <div class="cons-contacto">
        <span>👤 ${esc(c.contactoNombre)}</span>
        <span>📞 ${esc(c.contactoTel)}</span>
      </div>
      ${c.notas ? `<div class="cons-notas">${esc(c.notas)}</div>` : ''}
      <div class="cons-actions">
        ${acciones}
        ${wa}
        <button class="btn btn-sm" onclick="editarConsignacion(${c.id})">Editar</button>
        <button class="btn btn-sm" style="color:#c0392b" onclick="eliminarConsignacion(${c.id})">Eliminar</button>
      </div>
    </div>`;
  }).join('');
}

function actualizarComisionPreview(){
  const precio = parseFloat(document.getElementById('cons-precio').value) || 0;
  const pct = parseFloat(document.getElementById('cons-comision-pct').value);
  const calc = calcComision(precio, isNaN(pct) ? COMISION_PCT_DEFAULT : pct);
  const prev = document.getElementById('cons-comision-preview');
  if(!prev) return;
  const fmt = n => '$ '+n.toLocaleString('es-CO');
  if(precio <= 0){ prev.style.display='none'; return; }
  prev.style.display='block';
  prev.innerHTML = `<div><span>Comisión taller (${calc.pct}%)</span><strong style="color:#1D9E75">${fmt(calc.comision)}</strong></div>
                    <div><span>Recibe el propietario</span><strong>${fmt(calc.propietario)}</strong></div>`;
}

function filtrarConsignacion(f){
  consFilter = f;
  document.querySelectorAll('#cons-tabs .tab').forEach((t,i)=>{
    t.classList.toggle('active',['disponible','vendida','retirada','todas'][i]===f);
  });
  renderConsignacion();
}

function abrirFormConsignacion(id){
  const modal = document.getElementById('modal-consignacion');
  const titulo = document.getElementById('cons-modal-titulo');
  document.getElementById('cons-edit-id').value = '';
  document.getElementById('cons-producto').value = '';
  document.getElementById('cons-tipo').value = 'MTB';
  document.getElementById('cons-talla').value = 'M';
  document.getElementById('cons-color').value = '';
  document.getElementById('cons-precio').value = '';
  document.getElementById('cons-comision-pct').value = COMISION_PCT_DEFAULT;
  document.getElementById('cons-contacto-nombre').value = '';
  document.getElementById('cons-contacto-tel').value = '';
  document.getElementById('cons-notas').value = '';
  const msg = document.getElementById('cons-modal-msg');
  msg.style.display='none';

  if(id){
    const c = (state.consignaciones||[]).find(x=>x.id===id);
    if(!c) return;
    titulo.textContent = 'Editar consignación';
    document.getElementById('cons-edit-id').value = c.id;
    document.getElementById('cons-producto').value = c.producto;
    document.getElementById('cons-tipo').value = c.tipo;
    document.getElementById('cons-talla').value = c.talla;
    document.getElementById('cons-color').value = c.color;
    document.getElementById('cons-precio').value = c.precio;
    document.getElementById('cons-comision-pct').value = c.comisionPct != null ? c.comisionPct : COMISION_PCT_DEFAULT;
    document.getElementById('cons-contacto-nombre').value = c.contactoNombre;
    document.getElementById('cons-contacto-tel').value = c.contactoTel;
    document.getElementById('cons-notas').value = c.notas;
  } else {
    titulo.textContent = 'Agregar consignación';
  }
  actualizarComisionPreview();
  modal.style.display = 'flex';
}

function cerrarModalConsignacion(){
  document.getElementById('modal-consignacion').style.display='none';
}

async function guardarConsignacion(){
  const editId = document.getElementById('cons-edit-id').value;
  const producto = document.getElementById('cons-producto').value.trim();
  const tipo = document.getElementById('cons-tipo').value;
  const talla = document.getElementById('cons-talla').value;
  const color = document.getElementById('cons-color').value.trim();
  const precio = parseFloat(document.getElementById('cons-precio').value) || 0;
  const comisionPctRaw = parseFloat(document.getElementById('cons-comision-pct').value);
  const comisionPct = isNaN(comisionPctRaw) ? COMISION_PCT_DEFAULT : Math.max(0, Math.min(100, comisionPctRaw));
  const contactoNombre = document.getElementById('cons-contacto-nombre').value.trim();
  const contactoTel = document.getElementById('cons-contacto-tel').value.trim();
  const notas = document.getElementById('cons-notas').value.trim();
  const msg = document.getElementById('cons-modal-msg');

  if(!producto){msg.textContent='El producto es obligatorio.';msg.style.cssText='display:block;background:#FCEBEB;color:#501313;padding:8px 12px;border-radius:8px;font-size:13px;margin-top:8px';return}
  if(!contactoNombre){msg.textContent='El nombre del propietario es obligatorio.';msg.style.cssText='display:block;background:#FCEBEB;color:#501313;padding:8px 12px;border-radius:8px;font-size:13px;margin-top:8px';return}
  if(!contactoTel){msg.textContent='El teléfono es obligatorio.';msg.style.cssText='display:block;background:#FCEBEB;color:#501313;padding:8px 12px;border-radius:8px;font-size:13px;margin-top:8px';return}

  const btn = document.getElementById('cons-save-btn');
  btn.disabled=true;btn.textContent='Guardando...';
  try {
    const data = {producto,tipo,talla,color,precio,comisionPct,contactoNombre,contactoTel,notas};
    if(editId){
      await window.db.updateConsignacion(parseInt(editId), data);
      toast('Consignación actualizada','success');
    } else {
      await window.db.createConsignacion(data);
      toast('Consignación registrada','success');
    }
    cerrarModalConsignacion();
    await reloadState();
    renderConsignacion();
    updateBadges();
  } catch(err){
    msg.textContent='Error: '+err.message;
    msg.style.cssText='display:block;background:#FCEBEB;color:#501313;padding:8px 12px;border-radius:8px;font-size:13px;margin-top:8px';
  } finally {
    btn.disabled=false;btn.textContent='Guardar';
  }
}

function editarConsignacion(id){ abrirFormConsignacion(id); }

async function cambiarStatusConsignacion(id, nuevoStatus){
  try {
    await window.db.updateConsignacion(id, {status: nuevoStatus});
    await reloadState();
    renderConsignacion();
    updateBadges();
    toast('Estado actualizado','success');
  } catch(err){ toast('Error: '+err.message,'error'); }
}

async function eliminarConsignacion(id){
  if(!confirm('¿Eliminar esta consignación?')) return;
  try {
    await window.db.deleteConsignacion(id);
    await reloadState();
    renderConsignacion();
    updateBadges();
    toast('Consignación eliminada');
  } catch(err){ toast('Error: '+err.message,'error'); }
}

// ===== PWA =====
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})})}

// ===== Init =====
init();
