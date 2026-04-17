// ========================================================
// db.js — Capa de acceso a Supabase
// Traduce entre el schema de la DB y la forma que usa la app
// ========================================================

const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// ===== Adaptadores: DB row → App shape =====

function adaptBici(row){
  if(!row) return null;
  return {
    _id: row.id,
    marca: row.marca,
    modelo: row.modelo,
    color: row.color || '',
    serie: row.numero_serie || '',
    año: row.anio ?? '',
    creado: row.created_at
  };
}

function adaptCliente(row, bicis){
  if(!row) return null;
  return {
    id: row.cedula || row.id,
    _uuid: row.id,
    _cedula: row.cedula,
    nombre: row.nombre,
    tel: row.telefono,
    email: row.email,
    bicicletas: (bicis || []).map(adaptBici)
  };
}

function adaptOrden(row, cliente, bici, repuestos, checklist){
  return {
    id: row.id,
    clienteId: cliente?.cedula || cliente?.id,
    _clienteUuid: row.cliente_id,
    _biciUuid: row.bicicleta_id,
    clienteNombre: cliente?.nombre || '',
    clienteTel: cliente?.telefono || '',
    bici: {
      _id: bici?.id,
      marca: bici?.marca || '',
      modelo: bici?.modelo || '',
      color: bici?.color || '',
      serie: bici?.numero_serie || '',
      año: bici?.anio ?? ''
    },
    tiposTrabajo: row.tipos_trabajo || [],
    descripcion: row.descripcion || '',
    prioridad: row.prioridad || 'normal',
    mecanico: row.mecanico_asignado || 'Sin asignar',
    status: row.status || 'pending',
    reparaciones: (repuestos || []).map(r => ({
      desc: r.descripcion || '',
      precio: parseFloat(r.precio) || 0,
      codigo: r.codigo || ''
    })),
    notas: row.notas_mecanico || '',
    fotos: row.fotos || [],
    checklist: checklist ? {
      cadena: checklist.cadena,
      frenoDel: checklist.freno_del,
      frenoTras: checklist.freno_tras,
      llantaDel: checklist.llanta_del,
      llantaTras: checklist.llanta_tras,
      torqueSillin: checklist.torque_sillin,
      torqueEspiga: checklist.torque_espiga,
      torqueManubrio: checklist.torque_manubrio
    } : {},
    creado: row.created_at,
    actualizado: row.updated_at,
    fechaTerminado: row.fecha_terminado,
    fechaCompromiso: row.fecha_compromiso,
    duracionMinutos: row.duracion_minutos,
    recordatorioEnviado: row.recordatorio_enviado
  };
}

// ===== Cargar todo =====

async function dbLoadAll(){
  const [clRes, bcRes, ordRes, rpRes, chkRes, setRes] = await Promise.all([
    sb.from('clientes').select('*'),
    sb.from('bicicletas').select('*'),
    sb.from('ordenes').select('*').order('created_at', { ascending: false }),
    sb.from('repuestos').select('*'),
    sb.from('checklist').select('*'),
    sb.from('settings').select('*').eq('key', 'mecanicos').maybeSingle()
  ]);
  const errors = [clRes.error, bcRes.error, ordRes.error, rpRes.error, chkRes.error, setRes.error].filter(Boolean);
  if(errors.length) throw new Error('Error cargando datos: ' + errors.map(e => e.message).join('; '));

  const cliByUuid = new Map((clRes.data||[]).map(c => [c.id, c]));
  const biciByCliente = new Map();
  const biciByUuid = new Map();
  (bcRes.data||[]).forEach(b => {
    biciByUuid.set(b.id, b);
    if(!biciByCliente.has(b.cliente_id)) biciByCliente.set(b.cliente_id, []);
    biciByCliente.get(b.cliente_id).push(b);
  });
  const rpByOrden = new Map();
  (rpRes.data||[]).forEach(r => {
    if(!rpByOrden.has(r.orden_id)) rpByOrden.set(r.orden_id, []);
    rpByOrden.get(r.orden_id).push(r);
  });
  const chkByOrden = new Map((chkRes.data||[]).map(c => [c.orden_id, c]));

  const clientes = (clRes.data||[]).map(c => adaptCliente(c, biciByCliente.get(c.id)));
  const ordenes = (ordRes.data||[]).map(o => adaptOrden(
    o,
    cliByUuid.get(o.cliente_id),
    biciByUuid.get(o.bicicleta_id),
    rpByOrden.get(o.id),
    chkByOrden.get(o.id)
  ));
  const mecanicos = (setRes.data && setRes.data.value) || ['Carlos','Andrés','Juan'];
  const nextId = ordenes.reduce((m,o)=>Math.max(m,o.id),1000) + 1;

  return { clientes, ordenes, mecanicos, nextId };
}

// ===== Clientes =====

async function dbUpsertCliente(data){
  const { cedula, nombre, tel, email } = data;
  let uuid;
  if(cedula){
    const { data: existing } = await sb.from('clientes').select('id').eq('cedula', cedula).maybeSingle();
    if(existing){
      uuid = existing.id;
      const dbPatch = {};
      if(nombre) dbPatch.nombre = nombre;
      if(tel) dbPatch.telefono = tel;
      if(email !== undefined) dbPatch.email = email || null;
      if(Object.keys(dbPatch).length) await sb.from('clientes').update(dbPatch).eq('id', uuid);
      return uuid;
    }
  }
  const { data: nc, error } = await sb.from('clientes').insert({
    cedula: cedula || null,
    nombre, telefono: tel, email: email || null
  }).select('id').single();
  if(error) throw error;
  return nc.id;
}

async function dbUpdateClienteByCedula(cedula, patches){
  const dbPatch = {};
  if(patches.nombre !== undefined) dbPatch.nombre = patches.nombre;
  if(patches.tel !== undefined) dbPatch.telefono = patches.tel;
  if(patches.email !== undefined) dbPatch.email = patches.email || null;
  const { error } = await sb.from('clientes').update(dbPatch).eq('cedula', cedula);
  if(error) throw error;
}

async function dbDeleteClienteByCedula(cedula){
  const { data: c } = await sb.from('clientes').select('id').eq('cedula', cedula).maybeSingle();
  if(!c) return;
  const { data: ords } = await sb.from('ordenes').select('id').eq('cliente_id', c.id);
  if(ords && ords.length){
    const ids = ords.map(o => o.id);
    await sb.from('repuestos').delete().in('orden_id', ids);
    await sb.from('checklist').delete().in('orden_id', ids);
    await sb.from('ordenes').delete().in('id', ids);
  }
  await sb.from('bicicletas').delete().eq('cliente_id', c.id);
  await sb.from('clientes').delete().eq('id', c.id);
}

// ===== Bicicletas =====

async function dbCreateBici(clienteUuid, b){
  const { data, error } = await sb.from('bicicletas').insert({
    cliente_id: clienteUuid,
    marca: b.marca, modelo: b.modelo,
    color: b.color || null,
    numero_serie: b.serie || null,
    anio: b.año ? parseInt(b.año) : null
  }).select('id').single();
  if(error) throw error;
  return data.id;
}

async function dbDeleteBici(biciUuid){
  const { error } = await sb.from('bicicletas').delete().eq('id', biciUuid);
  if(error) throw error;
}

// ===== Órdenes =====

async function dbCreateOrden(orden, clienteUuid, biciUuid){
  const { data, error } = await sb.from('ordenes').insert({
    cliente_id: clienteUuid,
    bicicleta_id: biciUuid,
    tipos_trabajo: orden.tiposTrabajo || [],
    descripcion: orden.descripcion || '',
    prioridad: orden.prioridad || 'normal',
    mecanico_asignado: orden.mecanico || 'Sin asignar',
    status: 'pending',
    notas_mecanico: '',
    fotos: orden.fotos || [],
    fecha_compromiso: orden.fechaCompromiso || null,
    duracion_minutos: orden.duracionMinutos || null
  }).select().single();
  if(error) throw error;
  await sb.from('checklist').insert({ orden_id: data.id });
  return data.id;
}

async function dbUpdateOrden(oid, patches){
  const dbPatch = { updated_at: new Date().toISOString() };
  if(patches.mecanico !== undefined) dbPatch.mecanico_asignado = patches.mecanico;
  if(patches.prioridad !== undefined) dbPatch.prioridad = patches.prioridad;
  if(patches.descripcion !== undefined) dbPatch.descripcion = patches.descripcion;
  if(patches.notas !== undefined) dbPatch.notas_mecanico = patches.notas;
  if(patches.status !== undefined) dbPatch.status = patches.status;
  if(patches.fechaTerminado !== undefined) dbPatch.fecha_terminado = patches.fechaTerminado;
  if(patches.fechaCompromiso !== undefined) dbPatch.fecha_compromiso = patches.fechaCompromiso;
  if(patches.duracionMinutos !== undefined) dbPatch.duracion_minutos = patches.duracionMinutos;
  if(patches.recordatorioEnviado !== undefined) dbPatch.recordatorio_enviado = patches.recordatorioEnviado;
  if(patches.fotos !== undefined) dbPatch.fotos = patches.fotos;
  const { error } = await sb.from('ordenes').update(dbPatch).eq('id', oid);
  if(error) throw error;
}

async function dbDeleteOrden(oid){
  await sb.from('repuestos').delete().eq('orden_id', oid);
  await sb.from('checklist').delete().eq('orden_id', oid);
  const { error } = await sb.from('ordenes').delete().eq('id', oid);
  if(error) throw error;
}

// ===== Checklist =====

const CHK_FIELDS = {
  cadena: 'cadena',
  frenoDel: 'freno_del',
  frenoTras: 'freno_tras',
  llantaDel: 'llanta_del',
  llantaTras: 'llanta_tras',
  torqueSillin: 'torque_sillin',
  torqueEspiga: 'torque_espiga',
  torqueManubrio: 'torque_manubrio'
};

async function dbUpdateChecklist(oid, field, value){
  const dbField = CHK_FIELDS[field];
  if(!dbField) return;
  const { data: existing } = await sb.from('checklist').select('id').eq('orden_id', oid).maybeSingle();
  if(existing){
    await sb.from('checklist').update({ [dbField]: value }).eq('orden_id', oid);
  } else {
    await sb.from('checklist').insert({ orden_id: oid, [dbField]: value });
  }
}

// ===== Reparaciones (repuestos) =====

async function dbSetReparaciones(oid, reparaciones){
  await sb.from('repuestos').delete().eq('orden_id', oid);
  if(reparaciones && reparaciones.length){
    const rows = reparaciones
      .filter(r => r.desc || r.precio || r.codigo)
      .map(r => ({
        orden_id: oid,
        descripcion: r.desc || '',
        precio: parseFloat(r.precio) || 0,
        codigo: r.codigo || null
      }));
    if(rows.length) await sb.from('repuestos').insert(rows);
  }
}

// ===== Settings =====

async function dbSetMecanicos(lista){
  const { error } = await sb.from('settings').upsert({ key: 'mecanicos', value: lista });
  if(error) throw error;
}

// ===== Storage (fotos) =====

async function dbUploadFoto(blob, ext = 'jpg'){
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2,10)}.${ext}`;
  const { error } = await sb.storage.from('fotos').upload(filename, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false
  });
  if(error) throw error;
  const { data: { publicUrl } } = sb.storage.from('fotos').getPublicUrl(filename);
  return publicUrl;
}

async function dbDeleteFoto(url){
  // extract filename from URL
  const m = /\/fotos\/(.+)$/.exec(url);
  if(!m) return;
  await sb.storage.from('fotos').remove([m[1]]);
}

// Expose globally for app.js
window.db = {
  loadAll: dbLoadAll,
  upsertCliente: dbUpsertCliente,
  updateClienteByCedula: dbUpdateClienteByCedula,
  deleteClienteByCedula: dbDeleteClienteByCedula,
  createBici: dbCreateBici,
  deleteBici: dbDeleteBici,
  createOrden: dbCreateOrden,
  updateOrden: dbUpdateOrden,
  deleteOrden: dbDeleteOrden,
  updateChecklist: dbUpdateChecklist,
  setReparaciones: dbSetReparaciones,
  setMecanicos: dbSetMecanicos,
  uploadFoto: dbUploadFoto,
  deleteFoto: dbDeleteFoto,
  sb
};
